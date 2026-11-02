import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// S48-27 OUTSIDE-글상세·관심환류 ③④(docs/design/outside-statements.md 12절, 요청함 11/01 23:12, 명진 결정 23:14·23:16):
// 메뉴 'Now' 하나 + 탭 [사회운동] [뉴스] [보관] [문장 찾기](마지막 탭 서버 기억), 글 줄 전체 누름 → 상세
// (꼬리 줄·[원문 ↗]·핵심 요약·주요 문장·나와의 연관·시사점·함께 볼 것 + [☆ 별표] [보관] [메모] [관심 없음]),
// 폰은 상세 전체 화면(뒤로가기 = 목록), PC는 목록 | 상세 두 칸. 누른 것은 환류 기록(app_now_signals)으로, 관심 주제 후보 → [ㅇ 확정] → 목록 작은 표시.
// 서버는 흉내 낸다(시계 2026-10-06 10:00 서울, home-entry.mjs). 글·주제는 모두 가상.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const P1 = 'a1000000-0000-4000-8000-000000000001', P2 = 'a1000000-0000-4000-8000-000000000002', N1 = 'b1000000-0000-4000-8000-000000000001';
const CATALOG = [{ key: 'kctu', name: '민주노총', group: 'labor', lang: 'ko' }, { key: 'jacobin', name: 'Jacobin', group: 'foreign', lang: 'en' }];
const POSTS = [
  { id: P1, source_key: 'kctu', kind: 'statement', lang: 'ko', title: '[성명] 가상 철도 민영화 반대', title_ko: null, url: 'https://nodong.org/statement/101', published_at: '2026-10-06T00:30:00Z', fetched_at: '2026-10-06T00:40:00Z', summary_ko: '가상 성명 한 문장 요약이다.', key_sentences: [], has_body: true },
  { id: P2, source_key: 'jacobin', kind: 'article', lang: 'en', title: 'An Imaginary Article', title_ko: '가상의 외국 글', url: 'https://jacobin.com/2026/10/imaginary', published_at: '2026-10-05T01:00:00Z', fetched_at: '2026-10-05T09:07:00Z', summary_ko: '가상 외국 요약.', key_sentences: [], has_body: false },
];
const DETAIL = {
  level: 'full', summary: '가상 요약 첫 문장. 가상 요약 둘째 문장.',
  key_sentences: [{ orig: '가상 주요 문장 하나.', ko: null }, { orig: '가상 주요 문장 둘.', ko: null }],
  relevance: { topics: ['철도 민영화'], reason: '가상 이유 한 줄.' },
  implications: { kptu: '가상 공공운수노조 시사점.', labor: '가상 노동운동 시사점.' },
  related: [{ kind: 'outside', id: P2, title: '가상의 외국 글' }, { kind: 'ledger', id: 'x1', title: '가상 원장 줄' }],
  generated_at: '2026-10-06T01:00:00Z', context_at: null,
};

async function nowServer(page) {
  const s = { calls: [], marks: [], signals: [], notes: [], interests: [{ id: 'i1', topic: '철도 민영화', state: 'candidate', origin: 'ai', reason: '별표 2건', decided_at: null, created_at: '2026-10-05T00:00:00Z' }] };
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const body = req.postDataJSON?.() ?? null;
    if (p === '/functions/v1/outside-feed') return ok({ ok: true, sources: CATALOG });
    if (p === '/functions/v1/news-feed') return ok({ ok: true, sources: [], limits: {} });
    if (p === '/functions/v1/ai-assist') {
      s.calls.push({ what: 'ai', body, auth: req.headers().authorization || '' });
      if (body?.kind === 'now_detail') return ok({ ok: true, kind: 'now_detail', detail: DETAIL, stale: false });
      if (body?.kind === 'now_interests') return ok({ ok: true, kind: 'now_interests', ran: false, added: 0 });
      return route.fallback();
    }
    const table = p.startsWith('/rest/v1/') ? p.slice('/rest/v1/'.length) : '';
    if (/^app_(outside_|now_|news_)/.test(table)) s.calls.push({ what: table, method, query: decodeURIComponent(u.search), body });
    if (table === 'app_outside_posts') {
      const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      return ok(id ? POSTS.filter(x => x.id === id) : POSTS);
    }
    if (table === 'app_outside_sources') return ok([{ source_key: 'kctu', enabled: true, last_ok_at: '2026-10-05T09:07:00Z', last_error: null }, { source_key: 'jacobin', enabled: true, last_ok_at: '2026-10-05T09:07:00Z', last_error: null }]);
    if (table === 'app_outside_seen') return ok([{ seen_at: '2026-10-06T00:00:00Z' }]);
    if (table === 'app_outside_marks') {
      const post = (u.searchParams.get('post_id') || '').replace(/^eq\./, '');
      if (method === 'PATCH') { const row = s.marks.find(m => m.post_id === post); if (!row) return ok([]); Object.assign(row, body); return ok([{ post_id: post }]); }
      if (method === 'POST') { s.marks.push({ ...body }); return route.fulfill({ status: 201 }); }
      if (post) return ok(s.marks.filter(m => m.post_id === post));
      return ok(s.marks.filter(m => m.starred_at || m.archived_at).map(m => ({ ...m, app_outside_posts: POSTS.find(x => x.id === m.post_id) })));
    }
    if (table === 'app_now_signals') { if (method === 'POST') s.signals.push(body); return method === 'POST' ? route.fulfill({ status: 201 }) : ok([]); }
    if (table === 'app_now_interests') {
      const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      if (method === 'PATCH') { const row = s.interests.find(r => r.id === id); Object.assign(row, body); return ok([row]); }
      if (method === 'POST') { const row = { id: 'i' + (s.interests.length + 1), origin: 'user', reason: null, created_at: '2026-10-06T01:00:00Z', ...body }; s.interests.push(row); return ok([row], 201); }
      return ok(s.interests);
    }
    if (table.startsWith('app_news_') || table.startsWith('app_now_')) return ok([]);
    if (table === 'app_notes' && (u.searchParams.get('metadata->>outside_post_id') || (method === 'POST' && body?.metadata?.outside_post_id))) {
      if (method === 'POST') { const row = { id: 'c0000000-0000-4000-8000-0000000000aa', title: body.title, raw_text: body.raw_text, metadata: body.metadata, updated_at: '2026-10-06T01:00:00Z', doc: null }; s.notes.push({ body }); return ok([row], 201); }
      return ok([]);
    }
    return route.fallback();
  });
  return s;
}

async function start(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const { prefs } = await openHome(page);
  const server = await nowServer(page);
  return { errors, server, prefs };
}
async function openNow(page, width) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: 'Now' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('button', { name: 'Now', exact: true }).click();
  await expect(page.locator('#outsideView')).toBeVisible();
}
const root = page => page.locator('#outsideRoot');
const detail = page => root(page).locator('[data-now-detail]');
const noWideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const width of [412, 1280]) {
  test(`Now ${width}: 메뉴 하나·탭 넷·글 상세·별표·메모·관심 주제 확정`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, server, prefs } = await start(page, width);
    await openNow(page, width);
    // 메뉴 'Now' 하나(뉴스 클리핑 칸 없음), 탭 넷, 처음은 [사회운동].
    await expect(page.locator('#osTitle')).toHaveText('Now');
    await expect(page.locator('.nav-btn[data-view="news"], #mobileMenu [data-view="news"]')).toHaveCount(0);
    await expect(root(page).getByRole('tab')).toHaveText(['사회운동', '뉴스', '보관', '문장 찾기']);
    await expect(root(page).getByRole('tab', { name: '사회운동' })).toHaveAttribute('aria-selected', 'true');
    await expect(root(page).locator('[data-os-post]')).toHaveCount(2);

    // 관심 주제 후보가 있으면 목록 위 한 줄. 서버에 후보를 만들지 묻는다(규칙은 서버).
    await expect(root(page).locator('[data-now-cand]')).toContainText('관심 주제 후보 1');
    await expect.poll(() => server.calls.some(c => c.what === 'ai' && c.body?.kind === 'now_interests')).toBe(true);
    expect(server.calls.find(c => c.body?.kind === 'now_interests').body).toEqual({ kind: 'now_interests' });

    // PC는 처음부터 오른쪽 상세 칸(빈 안내 한 줄) + 폭 끌기 경계, 폰은 상세 칸이 없다.
    if (width > 760) {
      await expect(detail(page).locator('[data-nd-empty]')).toBeVisible();
      await expect(root(page).locator('.split-resize-handle')).toHaveCount(1);
    } else await expect(detail(page)).toBeHidden();

    // 글 줄 전체가 눌린다(요약 글자를 눌러도 상세). 서버에는 글 id만 보낸다.
    // 요약 글자 자리를 누르면 그 위를 덮은 제목 단추가 받는다(Playwright 직접 클릭은 덮개 때문에 거절하므로 그 자리를 마우스로 누름).
    const lead = await root(page).locator(`[data-os-post="${P1}"] .os-lead`).boundingBox();
    await page.mouse.click(lead.x + lead.width / 2, lead.y + lead.height / 2);
    const nd = detail(page).locator('.nd');
    await expect(nd).toBeVisible();
    await expect.poll(() => server.calls.filter(c => c.what === 'ai' && c.body?.kind === 'now_detail').length).toBe(1);
    expect(server.calls.find(c => c.body?.kind === 'now_detail')).toMatchObject({ body: { kind: 'now_detail', outside_post_id: P1 }, auth: expect.stringMatching(/^Bearer /) });
    await expect(nd.locator('.nd-meta')).toContainText('민주노총');
    await expect(nd.locator('.nd-meta')).toContainText('국내');
    await expect(nd.locator('.nd-meta')).toContainText('2026. 10. 6. 09:30');
    await expect(nd.locator('.nd-title')).toHaveText('[성명] 가상 철도 민영화 반대');
    const link = nd.getByRole('link', { name: /원문/ });
    await expect(link).toHaveAttribute('href', 'https://nodong.org/statement/101');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(nd.locator('.nd-sum')).toHaveText(DETAIL.summary);
    await expect(nd.locator('.nd-sents li')).toHaveCount(2);
    await expect(nd.locator('.nd-topic')).toHaveText(['철도 민영화']);
    await expect(nd.locator('.nd-reason')).toHaveText('가상 이유 한 줄.');
    await expect(nd.locator('.nd-imp')).toHaveText(['공공운수노조 운동 가상 공공운수노조 시사점.', '한국 노동운동 가상 노동운동 시사점.']);
    await expect(nd.locator('.nd-rel')).toHaveText(['사회운동가상의 외국 글', '원장가상 원장 줄']);
    if (width > 760) {
      // 두 칸: 목록이 그대로 보이고 고른 줄 표시.
      await expect(root(page).locator(`[data-os-post="${P1}"]`)).toHaveClass(/is-open/);
      await expect(root(page).locator('[data-os-post]').first()).toBeVisible();
    } else await expect(root(page).locator('#nowMain')).toBeHidden();
    expect(await noWideScroll(page)).toBe(true);

    // [☆ 별표]: 사회운동 글 표시 줄이 없으면 넣는다(post_id·workspace_id·starred_at만) + 환류 기록 한 줄(글 id·동작만).
    await nd.locator('[data-nd-act="star"]').click();
    await expect(nd.locator('[data-nd-act="star"]')).toHaveAttribute('aria-pressed', 'true');
    const post = server.calls.filter(c => c.what === 'app_outside_marks' && c.method === 'POST').at(-1);
    expect(Object.keys(post.body).sort()).toEqual(['post_id', 'starred_at', 'workspace_id']);
    expect(post.body).toMatchObject({ post_id: P1, workspace_id: 'w' });
    await expect.poll(() => server.signals).toEqual([{ workspace_id: 'w', outside_post_id: P1, action: 'star' }]);
    // [원문 ↗] 열기도 기록(새 창은 막아 둔다).
    await page.evaluate(() => { window.open = () => null; document.querySelector('[data-nd-link]').addEventListener('click', e => e.preventDefault(), { once: true }); });
    await link.click();
    await expect.poll(() => server.signals.map(x => x.action)).toEqual(['star', 'open']);

    // [메모] = 노트 하나(metadata.outside_post_id) + 기록.
    await nd.locator('[data-nd-act="memo"]').click();
    await nd.locator('[data-nd-memo-input]').fill('가상 메모');
    await nd.getByRole('button', { name: '저장' }).click();
    await expect(nd.locator('[data-nd-memo-text]')).toContainText('가상 메모');
    expect(server.notes[0].body).toMatchObject({ kind: 'note', raw_text: '가상 메모', metadata: { outside_post_id: P1 } });
    await expect.poll(() => server.signals.map(x => x.action)).toEqual(['star', 'open', 'memo']);

    // 함께 볼 것: 같은 Now 글은 그 상세로.
    await nd.locator('.nd-rel').first().click();
    await expect(detail(page).locator('.nd-title')).toHaveText('가상의 외국 글');
    await expect(detail(page).locator('.nd-orig')).toHaveText('An Imaginary Article');
    expect(server.calls.filter(c => c.body?.kind === 'now_detail').at(-1).body).toEqual({ kind: 'now_detail', outside_post_id: P2 });

    // 폰: 뒤로가기 한 번 = 목록(Now 화면 그대로).
    if (width <= 760) {
      await page.goBack();
      await expect(root(page).locator('#nowMain')).toBeVisible();
      await expect(detail(page)).toBeHidden();
      await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('outside');
    }

    // 관심 주제 후보 → [ㅇ 확정](state·decided_at·updated_at만 고침) → 목록 줄에 작은 표시.
    await root(page).locator('[data-now-interests-open]').click();
    const box = root(page).locator('[data-now-interests-box]');
    await expect(box.locator('[data-ni-row="i1"]')).toContainText('철도 민영화');
    await box.locator('[data-ni-confirm="i1"]').click();
    await expect(box.locator('[data-ni-row="i1"]')).toHaveAttribute('data-state', 'confirmed');
    const patch = server.calls.filter(c => c.what === 'app_now_interests' && c.method === 'PATCH').at(-1);
    expect(Object.keys(patch.body).sort()).toEqual(['decided_at', 'state', 'updated_at']);
    // 더하기: 확정으로 바로(origin은 화면이 보내지 않음).
    await box.locator('[data-ni-add-input]').fill('공공 돌봄');
    await box.locator('[data-ni-add-input]').press('Enter');
    await expect(box.locator('.ni-topic')).toHaveText(['철도 민영화', '공공 돌봄']);
    expect(server.calls.filter(c => c.what === 'app_now_interests' && c.method === 'POST').at(-1).body).toMatchObject({ workspace_id: 'w', topic: '공공 돌봄', state: 'confirmed' });
    expect('origin' in server.calls.filter(c => c.what === 'app_now_interests' && c.method === 'POST').at(-1).body).toBe(false);
    await page.goBack();
    await expect(root(page).locator('[data-now-interests]')).toBeHidden();
    await expect(root(page).locator(`[data-os-post="${P1}"] .now-hit`)).toHaveText('철도 민영화');
    await expect(root(page).locator('[data-now-cand]')).toBeHidden();

    // [보관] 탭: 별표한 사회운동 글이 보인다. 탭은 서버에 기억(view_prefs.now_tab).
    await root(page).getByRole('tab', { name: '보관' }).click();
    await expect(root(page).locator('[data-ns-row]')).toHaveCount(1);
    await expect(root(page).locator('[data-ns-row]')).toContainText('[성명] 가상 철도 민영화 반대');
    await expect.poll(() => prefs.value?.now_tab).toBe('saved');
    // 새로고침해도 마지막 탭.
    await page.reload();
    await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
    await expect(page.locator('#outsideView')).toBeVisible();
    await expect(root(page).getByRole('tab', { name: '보관' })).toHaveAttribute('aria-selected', 'true');
    expect(errors).toEqual([]);
  });
}

test('옛 주소 ?view=news는 Now [뉴스] 탭으로', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page, { query: '?view=news' });
  await nowServer(page);
  await expect(page.locator('#outsideView')).toBeVisible({ timeout: 20000 });
  await expect(root(page).getByRole('tab', { name: '뉴스' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#nowPanelNews #newsRoot')).toBeVisible();
  expect(errors).toEqual([]);
});
