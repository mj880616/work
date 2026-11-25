import { test, expect } from '@playwright/test';
import { routeMemos } from './helpers/memo-server.mjs';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S48-27 OUTSIDE-글상세·관심환류 ③④(docs/design/outside-statements.md 12절, 요청함 11/01 23:12, 명진 결정 23:14·23:16):
// 메뉴 'News' 하나(S51-17 P5 이름 바꿈) + 탭 [전체] [사회운동] [언론] [보관](S51-8, 마지막 탭 서버 기억 news_tab), 글 줄 전체 누름 → 상세
// (꼬리 줄·요약·시사점(주요 문장·나와의 연관 접기)·원문 전체·함께 볼 것(접기) + [☆ 별표] [메모] [관심 없음] … [원래 사이트 ↗], S51-14 P4c; S67-09 [보관] 단추는 별표로 합침),
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
  // S68-27: 보관의 원본은 읽을 거리 줄(제목은 한국어 제목이 있으면 그것 — DB와 같음). P2는 옛 '보관'(→ 별표)을 DB(20261122230000)가 읽을 거리 줄로 옮긴 뒤 모양 — 읽을 거리 [News]에 보여야 한다.
  // 사회운동 글 표시 표(marks)에는 관심 없음만 둔다.
  const line = (id, saved_at) => ({ id: 'r-' + id, url: POSTS.find(x => x.id === id).url, title: POSTS.find(x => x.id === id).title_ko || POSTS.find(x => x.id === id).title, site: null, saved_at, read_at: '2026-10-06T00:00:00Z',
    body_state: 'ok', body_at: saved_at, business_area_id: null, updated_at: saved_at, origin: 'outside', news_article_id: null, outside_article_id: id });
  const s = { calls: [], marks: [], reading: [line(P2, '2026-10-05T02:00:00Z')], signals: [], notes: [], interests: [{ id: 'i1', topic: '철도 민영화', state: 'candidate', origin: 'ai', reason: '별표 2건', decided_at: null, created_at: '2026-10-05T00:00:00Z' }] };
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
    if (/^app_(outside_|now_|news_|reading_)|^rpc\/app_reading_keep/.test(table)) s.calls.push({ what: table, method, query: decodeURIComponent(u.search), body });
    if (table === 'rpc/app_reading_keep') {
      const was = s.reading.find(r => r.outside_article_id === body.p_article);
      if (body.p_on) { if (!was) s.reading.push(line(body.p_article, body.p_saved_at || new Date().toISOString())); const r = s.reading.find(x => x.outside_article_id === body.p_article); return ok({ ok: true, on: true, id: r.id, saved_at: r.saved_at, created: !was }); }
      s.reading = s.reading.filter(r => r !== was); return ok({ ok: true, on: false, removed: was ? 1 : 0, saved_at: was?.saved_at ?? null });
    }
    if (table === 'app_reading_items') {
      // S68-45: 줄을 열면 읽음(read_at만 고침) — 내 작업공간 열쇠로만.
      if (method === 'PATCH') {
        const id = (u.searchParams.get('id') || '').replace(/^eq\./, ''), r = s.reading.find(x => x.id === id);
        if (r && u.searchParams.get('workspace_id') === 'eq.w') Object.assign(r, body);
        return ok(r ? [r] : []);
      }
      const want = u.searchParams.get('outside_article_id');
      if (want) return ok(s.reading.filter(r => want === 'not.is.null' || r.outside_article_id === want.replace(/^eq\./, '')).map(r => ({ ...r, app_outside_articles: POSTS.find(x => x.id === r.outside_article_id) })));
      if (u.searchParams.get('news_article_id')) return ok([]);
      return ok([...s.reading].sort((a, b) => String(b.saved_at).localeCompare(String(a.saved_at))));
    }
    if (table === 'app_outside_articles') {
      const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      return ok(id ? POSTS.filter(x => x.id === id) : POSTS);
    }
    if (table === 'app_outside_sources') return ok([{ source_key: 'kctu', enabled: true, last_ok_at: '2026-10-05T09:07:00Z', last_error: null }, { source_key: 'jacobin', enabled: true, last_ok_at: '2026-10-05T09:07:00Z', last_error: null }]);
    if (table === 'app_outside_seen') return ok([{ seen_at: '2026-10-06T00:00:00Z' }]);
    // NEWS-모두에게열기 ③: 사회운동 글 표시는 내 표시 표(app_outside_article_marks, article_id). 흉내 서버 안 줄은 옛 이름(post_id)으로 든다.
    if (table === 'app_outside_article_marks') {
      const post = (u.searchParams.get('article_id') || '').replace(/^eq\./, '');
      const out = m => ({ article_id: m.post_id, starred_at: m.starred_at ?? null, archived_at: m.archived_at ?? null, dismissed_at: m.dismissed_at ?? null });
      if (method === 'PATCH') { const row = s.marks.find(m => m.post_id === post); if (!row) return ok([]); Object.assign(row, body); return ok([out(row)]); }
      if (method === 'POST') { const { article_id, ...rest } = body; const row = { post_id: article_id, ...rest }; s.marks.push(row); return ok([out(row)], 201); }
      if (method === 'POST') { s.marks.push({ ...body }); return route.fulfill({ status: 201 }); }
      if (post) return ok(s.marks.filter(m => m.post_id === post).map(out));
      return ok(s.marks.filter(m => m.dismissed_at).map(out));
    }
    if (table === 'app_outside_now_signals' || table === 'app_news_now_signals') { if (method === 'POST') s.signals.push(body); return method === 'POST' ? route.fulfill({ status: 201 }) : ok([]); }
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
  server.memoTable = await routeMemos(page);
  return { errors, server, prefs };
}
async function openNow(page, width) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: '읽을 거리' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '읽을 거리', exact: true }).click();
  await expect(page.locator('#outsideView')).toBeVisible();
}
const root = page => page.locator('#outsideRoot');
const detail = page => root(page).locator('[data-now-detail]');
const noWideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const width of [412, 884, 1280]) {
  test(`Now ${width}: 메뉴 하나·탭·글 상세·별표·메모·관심 주제 확정`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, server, prefs } = await start(page, width);
    await openNow(page, width);
    // 메뉴 'News' 하나(뉴스 클리핑 칸 없음), 탭 [전체][사회운동][언론][밑줄](S68-24 [보관] 탭 없앰), 처음은 [전체] → [사회운동]으로.
    await expect(page.locator('#osTitle')).toHaveText('읽을 거리');
    await expect(page.locator('.nav-btn[data-view="news"], #mobileMenu [data-view="news"]')).toHaveCount(0);
    await expect(root(page).getByRole('tab')).toHaveText(['전체', '사회운동', '언론', '밑줄', '메모']);
    await expect(root(page).getByRole('tab', { name: '전체' })).toHaveAttribute('aria-selected', 'true');
    if (width > 760) await expect(detail(page).locator('.nd-title')).toHaveText('[성명] 가상 철도 민영화 반대'); // [전체]에서 맨 위 글을 한 번 연 뒤 탭을 옮긴다
    await root(page).getByRole('tab', { name: '사회운동' }).click();
    // S63-11: 국내 단체 글 먼저, 국제(Jacobin) 글은 아래 접힌 '국제' 묶음(펼치기 전에는 줄을 그리지 않음).
    await expect(root(page).locator('[data-os-list] [data-nw-key]')).toHaveCount(1);
    await expect(root(page).locator('[data-os-list] details[data-os-intl] summary')).toHaveText(/^국제 · 1건/);

    // 관심 주제 후보가 있으면 화면 머리 ⋯ 메뉴 안 한 줄(S69-70 — 목록 위 줄은 없음). 서버에 후보를 만들지 묻는다(규칙은 서버).
    await expect(root(page).locator('[data-now-cand]')).toHaveCount(0);
    await root(page).locator('[data-os-more]').click();
    await expect(page.locator('#osMenu [data-os-cand]')).toHaveText('관심 주제 후보 1');
    await page.keyboard.press('Escape');
    await expect(page.locator('#osMenu')).toBeHidden();
    await expect.poll(() => server.calls.some(c => c.what === 'ai' && c.body?.kind === 'now_interests')).toBe(true);
    expect(server.calls.find(c => c.body?.kind === 'now_interests').body).toEqual({ kind: 'now_interests' });

    // PC는 목록 맨 위 글이 바로 열려 빈 안내 칸이 없고(UI-Now PC정돈) 폭 끌기 경계가 있다, 폰은 상세 칸이 없다.
    if (width > 760) {
      await expect(detail(page).locator('.nd-title')).toHaveText('[성명] 가상 철도 민영화 반대');
      await expect(detail(page).locator('[data-nd-empty]')).toHaveCount(0);
      await expect(root(page).locator('.split-resize-handle')).toHaveCount(1);
    } else await expect(detail(page)).toBeHidden();

    // 글 줄 전체가 눌린다(매체 이름 글자를 눌러도 상세). 서버에는 글 id만 보낸다.
    // 그 자리를 누르면 그 위를 덮은 제목 단추가 받는다(Playwright 직접 클릭은 덮개 때문에 거절하므로 그 자리를 마우스로 누름).
    const lead = await root(page).locator(`[data-os-list] [data-nw-key="outside:${P1}"] .nw-src`).boundingBox();
    await page.mouse.click(lead.x + lead.width / 2, lead.y + lead.height / 2);
    const nd = detail(page).locator('.nd');
    await expect(nd).toBeVisible();
    await expect.poll(() => server.calls.filter(c => c.what === 'ai' && c.body?.kind === 'now_detail').length).toBe(1);
    expect(server.calls.find(c => c.body?.kind === 'now_detail')).toMatchObject({ body: { kind: 'now_detail', outside_post_id: P1 }, auth: expect.stringMatching(/^Bearer /) });
    await expect(nd.locator('.nd-meta')).toContainText('민주노총');
    await expect(nd.locator('.nd-meta')).toContainText('성명');
    await expect(nd.locator('.nd-meta')).toContainText('2026. 10. 6. 09:30');
    await expect(nd.locator('.nd-title')).toHaveText('[성명] 가상 철도 민영화 반대');
    const link = nd.locator('.nd-acts .nd-site');
    await expect(link).toHaveText('원래 사이트 ↗');
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
      await expect(root(page).locator(`[data-os-list] [data-nw-key="outside:${P1}"]`)).toHaveClass(/is-open/);
      await expect(root(page).locator('[data-os-list] [data-nw-key]').first()).toBeVisible();
    } else await expect(root(page).locator('#nowMain')).toBeHidden();
    expect(await noWideScroll(page)).toBe(true);

    // [☆ 별표]: 보관 = 내 읽을 거리 한 줄(서버 함수 app_reading_keep, S68-27) + 환류 기록 한 줄(글 id·동작만). 표시 표에는 쓰지 않는다.
    // S67-09: 사회운동 글에도 따로 [보관] 단추가 없다(보관 = 별표).
    await expect(nd.locator('[data-nd-act="archive"]')).toHaveCount(0);
    await expect(nd.locator('[data-nd-act="star"]')).toHaveText('저장');
    await expect(nd.locator('[data-nd-act="dismiss"]')).toHaveText('관심 없음'); // 읽을 거리에서 연 글은 [관심 없음] 그대로(S69-03)
    await nd.locator('[data-nd-act="star"]').click();
    await expect(nd.locator('[data-nd-act="star"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(nd.locator('[data-nd-act="star"]')).toHaveText('저장됨 ✓'); // S69-03: 눌린 상태 글자
    expect(server.calls.filter(c => c.what === 'rpc/app_reading_keep').at(-1).body).toEqual({ p_workspace: 'w', p_source: 'outside', p_article: P1, p_on: true, p_saved_at: null });
    expect(server.calls.some(c => c.what === 'app_outside_article_marks' && c.method !== 'GET')).toBe(false);
    await expect.poll(() => server.signals).toEqual([{ workspace_id: 'w', article_id: P1, action: 'star' }]);
    // [원문 ↗] 열기도 기록(새 창은 막아 둔다).
    await page.evaluate(() => { window.open = () => null; document.querySelectorAll('[data-nd-link]').forEach(a => a.addEventListener('click', e => e.preventDefault(), { once: true })); });
    await link.click();
    await expect.poll(() => server.signals.map(x => x.action)).toEqual(['star', 'open']);

    // S69-94 메모 = 글 아래 메모 칸(app_memos 한 줄: 대상 outside·이 글·제목 사본) + 기록. [메모] 칩은 그 칸 쓰기 칸으로.
    await nd.locator('[data-nd-memo-go]').click();
    await expect(nd.locator('[data-nd-memos] [data-cm-text]')).toBeFocused();
    await nd.locator('[data-nd-memos] [data-cm-text]').fill('가상 메모');
    await nd.locator('[data-nd-memos] [data-cm-save]').click();
    await expect(nd.locator('[data-nd-memos] .memo-th-row')).toContainText('가상 메모');
    await expect(nd.locator('[data-nd-memo-go]')).toHaveText('메모 1');
    expect(server.memoTable.posts).toEqual([{ workspace_id: 'w', target_type: 'outside', target_id: P1, target_title: '[성명] 가상 철도 민영화 반대', body: '가상 메모' }]);
    expect(server.notes).toEqual([]);
    await expect.poll(() => server.signals.map(x => x.action)).toEqual(['star', 'open', 'memo']);

    // 시사점 칸 안 접기(주요 문장·나와의 연관), 함께 볼 것은 원문 아래 접기(S51-14 P4c).
    await expect(nd.locator('[data-nd-implications] [data-nd-more]')).not.toHaveAttribute('open', '');
    await expect(nd.locator('[data-nd-body] ~ [data-nd-relslot] [data-nd-relatedbox]')).toHaveCount(1);
    // 함께 볼 것: 같은 Now 글은 그 상세로.
    await nd.locator('[data-nd-relatedbox] > summary').click();
    await nd.locator('.nd-rel').first().click();
    await expect(detail(page).locator('.nd-title')).toHaveText('가상의 외국 글');
    await expect(detail(page).locator('.nd-orig')).toHaveText('An Imaginary Article');
    // 제목은 머리(목록 줄)에서 바로 바뀌고 상세 요청은 그 뒤에 나간다 → 요청이 기록될 때까지 기다려 본다.
    await expect.poll(() => server.calls.filter(c => c.body?.kind === 'now_detail').at(-1).body).toEqual({ kind: 'now_detail', outside_post_id: P2 });

    // 폰: 뒤로가기 한 번 = 목록(Now 화면 그대로).
    if (width <= 760) {
      await page.goBack();
      await expect(root(page).locator('#nowMain')).toBeVisible();
      await expect(detail(page)).toBeHidden();
      await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('news');
    }

    // 관심 주제 후보 → [ㅇ 확정](state·decided_at·updated_at만 고침) → 목록 줄에 작은 표시.
    await root(page).locator('[data-os-more]').click();
    await page.locator('#osMenu [data-os-cand]').click();
    const box = root(page).locator('[data-now-interests-box]');
    await expect(box.locator('[data-ni-row="i1"]')).toContainText('철도 민영화');
    await box.locator('[data-ni-confirm="i1"]').click();
    await expect(box.locator('[data-ni-row="i1"]')).toHaveAttribute('data-state', 'confirmed');
    const patch = server.calls.filter(c => c.what === 'app_now_interests' && c.method === 'PATCH').at(-1);
    expect(Object.keys(patch.body).sort()).toEqual(['decided_at', 'state', 'updated_at']);
    // 더하기: 확정으로 바로(origin은 화면이 보내지 않음).
    await box.locator('[data-ni-add-input]').fill('공공 돌봄');
    await box.locator('[data-ni-add-input]').press('Enter');
    await expect(box.locator('.ni-topic')).toHaveText(['공공 돌봄', '철도 민영화']); // 가나다(NEWS-출처목록가나다)
    expect(server.calls.filter(c => c.what === 'app_now_interests' && c.method === 'POST').at(-1).body).toMatchObject({ workspace_id: 'w', topic: '공공 돌봄', state: 'confirmed' });
    expect('origin' in server.calls.filter(c => c.what === 'app_now_interests' && c.method === 'POST').at(-1).body).toBe(false);
    await page.goBack();
    await expect(root(page).locator('[data-now-interests]')).toBeHidden();
    await expect(root(page).locator(`[data-os-list] [data-nw-key="outside:${P1}"] .now-hit`)).toHaveText('철도 민영화');
    await root(page).locator('[data-os-more]').click();
    await expect(page.locator('#osMenu')).toBeVisible();
    await expect(page.locator('#osMenu [data-os-cand]')).toHaveCount(0); // 후보 0개면 메뉴 줄도 없음
    await page.keyboard.press('Escape');

    // 읽을 거리로 보낸 글(S68-24·S68-27·S68-28·S68-29): News 탭 줄에는 '보관' 길이 없고, 메뉴 '읽을 거리' [전체]에 방금 보낸 사회운동 글(P1) + 옮겨 온 글(P2) — 평범한 줄([News] 칩·꼬리표 없음).
    await expect(root(page).locator('[data-os-tabs] button')).toHaveText(['전체', '사회운동', '언론', '밑줄', '메모']);
    await page.evaluate(() => window.KPTURouter.go('reading'));
    const rd = page.locator('#readingView');
    await expect(rd).toBeVisible();
    await rd.locator('.rd-switch [data-filter-value="all"]').click();
    await expect(rd.locator('.rd-switch [data-filter-value="all"]')).toHaveAttribute('aria-checked', 'true');
    await expect(rd.locator('.rd-switch [data-filter-value="news"]')).toHaveCount(0);
    await expect(rd.locator(`[data-rd-open="r-${P1}"]`)).toContainText('[성명] 가상 철도 민영화 반대');
    await expect(rd.locator(`[data-rd-open="r-${P2}"]`)).toContainText('가상의 외국 글');
    await expect(rd.locator('.rd-row-news, .rd-src-tag')).toHaveCount(0);
    if (process.env.S68_24_SHOTS) await page.screenshot({ path: `${process.env.S68_24_SHOTS}/saved-${width}.png` });
    // 뒤로 = News. 마지막 탭은 서버에 기억(view_prefs.news_tab), 새로고침해도 그 탭.
    await page.goBack();
    await expect(page.locator('#outsideView')).toBeVisible();
    await root(page).getByRole('tab', { name: '전체' }).click();
    await expect.poll(() => prefs.value?.news_tab).toBe('all');
    await page.reload();
    await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
    await expect(page.locator('#outsideView')).toBeVisible();
    await expect(root(page).getByRole('tab', { name: '전체' })).toHaveAttribute('aria-selected', 'true');
    expect(errors).toEqual([]);
  });
}

// S68-45(명진 11/23 11:08 "안읽은 글 눌러서 읽었는데 읽음 처리 안됨"): 저장한 글에서 읽을 거리(기사 화면)에서 온 안 읽은 줄을 누르면
// 기사 원문 보기로 넘어가면서 그 줄도 읽음으로 서버에 저장 → 뒤로 오면 점이 꺼져 있고, 새로고침 뒤에도 그대로.
for (const width of [412, 1280]) {
  test(`저장한 글 ${width}: 읽을 거리에서 온 안 읽은 줄을 눌러 열면 읽음 — 뒤로·새로고침 뒤에도 점 꺼짐`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, server } = await start(page, width);
    server.reading.push({ id: 'r-' + P1, url: POSTS[0].url, title: POSTS[0].title, site: null, saved_at: '2026-10-06T00:50:00Z', read_at: null,
      body_state: 'ok', body_at: '2026-10-06T00:50:00Z', business_area_id: null, updated_at: '2026-10-06T00:50:00Z', origin: 'outside', news_article_id: null, outside_article_id: P1 });
    await page.evaluate(() => window.KPTURouter.go('reading'));
    const rd = page.locator('#readingView');
    await expect(rd).toBeVisible();
    const line = rd.locator(`.rd-row[data-rd-open="r-${P1}"]`);
    await expect(line).toHaveClass(/is-unread/);
    await line.click();
    await expect(page.locator('#outsideView')).toBeVisible();
    await expect(detail(page).locator('.nd-title')).toContainText('가상 철도 민영화 반대');
    await expect.poll(() => server.calls.filter(c => c.what === 'app_reading_items' && c.method === 'PATCH').length).toBe(1);
    const patch = server.calls.find(c => c.what === 'app_reading_items' && c.method === 'PATCH');
    expect(patch.query).toContain(`id=eq.r-${P1}`);
    expect(Object.keys(patch.body).sort()).toEqual(['read_at', 'updated_at']);
    expect(patch.body.read_at).toBeTruthy();
    await page.goBack();
    await expect(rd).toBeVisible();
    await rd.locator('.rd-switch [data-filter-value="all"]').click();
    await expect(line).toBeVisible();
    await expect(line).not.toHaveClass(/is-unread/);
    await page.reload();
    await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
    await page.evaluate(() => window.KPTURouter.go('reading'));
    await rd.locator('.rd-switch [data-filter-value="all"]').click();
    await expect(line).not.toHaveClass(/is-unread/);
    await expect(rd.locator('.rd-switch [data-filter-value="unread"]')).toHaveText('안 읽음');
    // 이미 읽은 줄은 다시 열어도 또 저장하지 않는다.
    expect(server.calls.filter(c => c.what === 'app_reading_items' && c.method === 'PATCH').length).toBe(1);
    expect(errors).toEqual([]);
  });
}

// S69-03(명진 11/24 06:43 "삭제 메모 관심 없음 버튼 모양 / 그리고 여긴 저장한 글인데 / 관심없음은 좀 이상", 06:48 "글자도 저장됨v 이런식으로 바뀌면 인정"):
// 저장한 글에서 연 글 보기 아래 줄 = [저장됨 ✓](눌림) [메모] … [원래 사이트 ↗] — [관심 없음] 없음, 칩 모양 하나(공용 ④ 칩).
// [저장됨 ✓]을 누르면 저장한 글에서 삭제 + 5초 [되돌리기], 되돌리면 다시 [저장됨 ✓].
for (const width of [412, 1280]) {
  test(`저장한 글 ${width}: 연 글 아래 줄 [저장됨 ✓]·칩 한 모양·[관심 없음] 없음 · 누르면 삭제 + [되돌리기]`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, server } = await start(page, width);
    await page.evaluate(() => window.KPTURouter.go('reading'));
    const rd = page.locator('#readingView');
    await expect(rd).toBeVisible();
    await rd.locator('.rd-switch [data-filter-value="all"]').click();
    await rd.locator(`.rd-row[data-rd-open="r-${P2}"]`).click();
    await expect(page.locator('#outsideView')).toBeVisible();
    const nd = detail(page);
    await expect(nd.locator('.nd-title')).toHaveText('가상의 외국 글');
    const acts = nd.locator('[data-nd-acts]');
    const star = acts.locator('[data-nd-act="star"]');
    await expect(star).toHaveText('저장됨 ✓');
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    await expect(star).toHaveAttribute('aria-label', '저장됨 — 누르면 저장한 글에서 삭제');
    await expect(acts.locator('[data-nd-act="dismiss"]')).toHaveCount(0);
    await expect(acts.locator('button')).toHaveText(['저장됨 ✓', '메모']);
    // 단추 줄 칩은 한 모양: 모두 공용 칩, 높이·둥글기·글자 크기가 같다.
    const looks = await acts.locator('button').evaluateAll(bs => bs.map(b => { const c = getComputedStyle(b); return { chip: b.classList.contains('ds-chip'), h: b.getBoundingClientRect().height, r: c.borderTopLeftRadius, f: c.fontSize, bw: c.borderTopWidth }; }));
    expect(looks.every(l => l.chip)).toBe(true);
    expect(new Set(looks.map(l => JSON.stringify({ h: l.h, r: l.r, f: l.f, bw: l.bw }))).size).toBe(1);
    await acts.scrollIntoViewIfNeeded();
    if (process.env.S69_03_SHOTS) await page.screenshot({ path: `${process.env.S69_03_SHOTS}/saved-detail-${width}.png` });

    // 누르면 저장한 글에서 삭제(app_reading_keep 끄기) → [저장], 5초 [되돌리기] → 다시 [저장됨 ✓](원래 저장 시각).
    await star.click();
    await expect(star).toHaveText('저장');
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    expect(server.calls.filter(c => c.what === 'rpc/app_reading_keep').at(-1).body).toEqual({ p_workspace: 'w', p_source: 'outside', p_article: P2, p_on: false, p_saved_at: null });
    await expect(page.locator('#kptuNotice:not([hidden]) .kptu-notice-text')).toHaveText('저장한 글에서 삭제했어요');
    await page.waitForTimeout(2500);
    await page.locator('#kptuNotice .kptu-notice-undo').click();
    await expect(star).toHaveText('저장됨 ✓');
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    expect(server.calls.filter(c => c.what === 'rpc/app_reading_keep').at(-1).body).toMatchObject({ p_article: P2, p_on: true, p_saved_at: '2026-10-05T02:00:00Z' });
    await expect(acts.locator('[data-nd-act="dismiss"]')).toHaveCount(0);

    // 같은 글이라도 읽을 거리 목록에서 열면 [관심 없음]이 있다.
    if (width <= 760) { // 폰: 뒤로 한 번 = 저장한 글, 그다음 메뉴로 읽을 거리
      await page.goBack();
      await expect(rd).toBeVisible();
      await page.evaluate(() => window.KPTURouter.go('outside'));
      await expect(page.locator('#outsideView')).toBeVisible();
    }
    await root(page).getByRole('tab', { name: '사회운동' }).click();
    await root(page).locator(`[data-os-list] [data-nw-key="outside:${P1}"] .now-open`).first().click();
    await expect(nd.locator('.nd-title')).toHaveText('[성명] 가상 철도 민영화 반대');
    await expect(acts.locator('[data-nd-act="dismiss"]')).toHaveText('관심 없음');
    await expect(acts.locator('button')).toHaveText(['저장', '메모', '관심 없음']);
    if (process.env.S69_03_SHOTS) await page.screenshot({ path: `${process.env.S69_03_SHOTS}/news-detail-${width}.png` });
    expect(errors).toEqual([]);
  });
}

// S51-17 NEWS P5(설계 7.2·7.3): 주소는 ?view=news가 정식, 옛 ?view=outside·?view=now도 같은 화면을 연다. 주소는 탭을 정하지 않고(마지막 탭),
// 옛 저장 값 now_tab은 news_tab이 없을 때 한 번 바꿔 옮겨 적는다(옛 값은 지우지 않음).
for (const query of ['?view=news', '?view=outside', '?view=now']) {
  test(`주소 ${query}는 News를 연다`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 1280, height: 900 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await openHome(page, { query });
    await nowServer(page);
    await expect(page.locator('#outsideView')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('#osTitle')).toHaveText('읽을 거리');
    await expect(page.locator('#appView>.app-nav').getByRole('link', { name: '읽을 거리', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(root(page).getByRole('tab', { name: '전체' })).toHaveAttribute('aria-selected', 'true');
    if (query === '?view=now') await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('news');
    expect(errors).toEqual([]);
  });
}

test('옛 저장 값 now_tab=news는 [언론]으로 한 번 옮겨 적고 옛 값은 그대로', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await installViewPrefsServer(page, { now_tab: 'news' });
  const { prefs } = await openHome(page, { query: '?view=news' });
  await nowServer(page);
  await expect(page.locator('#outsideView')).toBeVisible({ timeout: 20000 });
  await expect(root(page).getByRole('tab', { name: '언론' })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => prefs.value?.news_tab).toBe('media');
  expect(prefs.value?.now_tab).toBe('news');
  expect(errors).toEqual([]);
});
