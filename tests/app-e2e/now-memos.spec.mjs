import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import {screenFind} from './helpers/screen-find.mjs';
// S69-70(명진 11/24 20:43~20:45): 읽을 거리 [메모] 탭 = 메모 있는 글(글에 [메모]로 남긴 노트, 저장하지 않은 글도).
// - 줄 = 글 줄 + 메모 첫 줄(작게). 관심 없음으로 목록에서 빠진 글·[전체]에 없는 기사도 id로 다시 읽어 보인다. 글을 못 찾으면 메모만 한 줄 → 노트로.
// - 종류마다 1000줄씩 읽고 넘으면 [더 보기]. 서버 읽기는 내 작업공간 노트만(workspace_id=eq.w, kind=eq.note, 보관 노트 빼고).
// - '관심 주제 후보 n'은 목록 위 줄이 아니라 ⋯ 메뉴 안(now-detail.spec.mjs가 본다).
// 서버는 흉내 낸다. 글·메모는 모두 가상.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const P1 = 'a1000000-0000-4000-8000-000000000001', P2 = 'a1000000-0000-4000-8000-000000000002', P3 = 'a1000000-0000-4000-8000-000000000003';
const N1 = 'b1000000-0000-4000-8000-000000000001';
const CATALOG = [{ key: 'kctu', name: '민주노총', group: 'labor', lang: 'ko' }];
const POSTS = [
  { id: P1, source_key: 'kctu', kind: 'statement', lang: 'ko', title: '[성명] 가상 철도 성명', title_ko: null, url: 'https://nodong.org/statement/101', published_at: '2026-10-06T00:30:00Z', fetched_at: '2026-10-06T00:40:00Z', summary_ko: '가상 요약.', key_sentences: [], has_body: true },
  // P2는 '관심 없음' — [사회운동] 목록에서는 빠지지만 [메모]에는 보여야 한다.
  { id: P2, source_key: 'kctu', kind: 'statement', lang: 'ko', title: '[성명] 관심 없음 표시한 글', title_ko: null, url: 'https://nodong.org/statement/102', published_at: '2026-09-01T00:30:00Z', fetched_at: '2026-09-01T00:40:00Z', summary_ko: '가상 요약 둘.', key_sentences: [], has_body: true },
];
const NEWS = [{ id: N1, lane: 'news', url: 'https://news.example/1', title: '가상 오래된 기사', lang: 'ko', publisher: '가상일보', source_key: 'news-x', published_at: '2026-08-01T00:00:00Z', scrapped_at: null, created_at: '2026-08-01T00:00:00Z', state: 'ok', summary: '가상 기사 요약.', body_kind: 'full', title_ko: null, author: null, manual_at: null, origin: null }];
const note = (id, at, text, meta) => ({ id, title: '메모', raw_text: text, updated_at: at, metadata: meta });

async function memoServer(page, { many = false } = {}) {
  const s = { calls: [] };
  const outsideNotes = [
    note('c0000000-0000-4000-8000-000000000001', '2026-11-24T05:00:00Z', '첫 줄 메모\n둘째 줄', { outside_post_id: P1 }),
    note('c0000000-0000-4000-8000-000000000002', '2026-11-23T05:00:00Z', '관심 없음 글 메모', { outside_post_id: P2 }),
    note('c0000000-0000-4000-8000-000000000004', '2026-11-21T05:00:00Z', '글이 사라진 메모', { outside_post_id: P3 }),
  ];
  // 1000줄 넘게: 같은 글(P1)에 단 옛 메모를 채워 1001번째가 오게 한다(같은 글은 한 줄).
  if (many) for (let i = 0; i < 1000; i++) outsideNotes.push(note(`d0000000-0000-4000-8000-${String(i).padStart(12, '0')}`, '2026-10-01T00:00:00Z', '옛 메모 ' + i, { outside_post_id: P1 }));
  const newsNotes = [note('c0000000-0000-4000-8000-000000000003', '2026-11-22T05:00:00Z', '기사 메모', { news_item_id: N1 })];
  const idsOf = v => (v || '').startsWith('in.(') ? v.slice(4, -1).split(',') : (v || '').startsWith('eq.') ? [v.slice(3)] : null;
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (p === '/functions/v1/outside-feed') return ok({ ok: true, sources: CATALOG });
    if (p === '/functions/v1/news-feed') return ok({ ok: true, sources: [], limits: {} });
    if (p === '/functions/v1/ai-assist') return ok({ ok: true, ran: false, added: 0 });
    const table = p.startsWith('/rest/v1/') ? p.slice('/rest/v1/'.length) : '';
    if (table === 'app_notes') {
      s.calls.push({ what: 'notes', method, query: decodeURIComponent(u.search) });
      const pick = (list, col) => {
        const v = u.searchParams.get(`metadata->>${col}`) || '';
        const rows = v === 'not.is.null' ? list : list.filter(n => `eq.${n.metadata[col]}` === v);
        const off = Number(u.searchParams.get('offset') || 0), lim = Number(u.searchParams.get('limit') || 1000);
        return rows.slice(off, off + lim);
      };
      if (u.searchParams.get('metadata->>outside_post_id')) return ok(pick(outsideNotes, 'outside_post_id'));
      if (u.searchParams.get('metadata->>news_item_id')) return ok(pick(newsNotes, 'news_item_id'));
      return route.fallback();
    }
    if (/^rpc\/app_(outside|news)_article_of$/.test(table)) return ok([]);
    if (table === 'app_outside_articles') {
      s.calls.push({ what: table, query: decodeURIComponent(u.search) });
      const ids = idsOf(u.searchParams.get('id'));
      return ok(ids ? POSTS.filter(x => ids.includes(x.id)) : POSTS);
    }
    if (table === 'app_news_articles') {
      s.calls.push({ what: table, query: decodeURIComponent(u.search) });
      const ids = idsOf(u.searchParams.get('id'));
      return ok(ids ? NEWS.filter(x => ids.includes(x.id)).map(x => ({ ...x, app_news_marks: [], app_reading_items: [] })) : []);
    }
    if (table === 'app_outside_article_marks') return ok(method === 'GET' ? [{ article_id: P2, dismissed_at: '2026-09-02T00:00:00Z' }] : []);
    if (table === 'app_outside_sources') return ok([{ source_key: 'kctu', enabled: true, last_ok_at: '2026-10-05T09:07:00Z', last_error: null }]);
    if (table === 'app_outside_seen') return ok([{ seen_at: '2026-10-06T00:00:00Z' }]);
    if (table === 'app_now_interests') return ok([]);
    if (table === 'app_reading_items') return ok([]);
    if (/^app_(outside_|news_|now_)/.test(table)) return method === 'GET' ? ok([]) : route.fulfill({ status: 201 });
    return route.fallback();
  });
  return s;
}
async function start(page, width, opts) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await openHome(page);
  const server = await memoServer(page, opts);
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: '읽을 거리' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '읽을 거리', exact: true }).click();
  await expect(page.locator('#outsideView')).toBeVisible();
  return { errors, server };
}
const root = page => page.locator('#outsideRoot');
const panel = page => root(page).locator('[data-now-panel-memos]');

for (const width of [412, 1280]) {
  test(`메모 있는 글 ${width}: [메모] 탭 — 저장 안 한·관심 없음·목록 밖 글도 메모와 함께, 글 없는 메모는 노트로`, async ({ page }) => {
    const { errors, server } = await start(page, width);
    await expect(root(page).getByRole('tab')).toHaveText(['전체', '사회운동', '언론', '밑줄', '메모']);
    // 목록 위 '관심 주제 후보' 줄은 없다(⋯ 메뉴 안으로).
    await expect(root(page).locator('[data-now-cand]')).toHaveCount(0);
    await root(page).getByRole('tab', { name: '메모' }).click();
    await expect(panel(page)).toBeVisible();
    const rows = panel(page).locator('[data-nm-list] > .nw-row');
    await expect(rows).toHaveCount(4);
    // 최근 고친 메모 먼저: P1 · P2(관심 없음) · N1(기사) · P3(글 없음)
    await expect(panel(page).locator('.now-row .nw-title')).toHaveText(['[성명] 가상 철도 성명', '[성명] 관심 없음 표시한 글', '가상 오래된 기사']);
    await expect(panel(page).locator('.now-row .nw-memo')).toHaveText(['메모첫 줄 메모', '메모관심 없음 글 메모', '메모기사 메모']);
    await expect(panel(page).locator('.nm-alone [data-nm-note]')).toHaveText('메모글이 사라진 메모');
    // 날짜 묶음 머리가 없으니 줄 시각 대신 글 날짜(MM/DD).
    await expect(panel(page).locator('.now-row .nw-time')).toHaveText(['10/06', '09/01', '08/01']);
    // 서버 읽기: 내 작업공간 노트만, 보관 노트 빼고, 1000+1줄씩.
    const reads = server.calls.filter(c => c.what === 'notes');
    expect(reads.length).toBeGreaterThanOrEqual(2);
    for (const r of reads.filter(c => /not\.is\.null/.test(c.query))) {
      expect(r.method).toBe('GET');
      expect(r.query).toContain('workspace_id=eq.w');
      expect(r.query).toContain('kind=eq.note');
      expect(r.query).toContain('archived_at=is.null');
      expect(r.query).toContain('limit=1001');
    }
    expect(server.calls.some(c => c.what === 'app_outside_articles' && c.query.includes(`id=in.(${P1},${P2},${P3})`))).toBe(true);
    expect(server.calls.some(c => c.what === 'app_news_articles' && c.query.includes(`id=in.(${N1})`))).toBe(true);
    // 위 찾기 칸 글자로 제목·메모를 거른다.
    await (await screenFind(page)).fill('기사 메모');
    await expect(panel(page).locator('.now-row .nw-title')).toHaveText(['가상 오래된 기사']);
    await (await screenFind(page)).fill('');
    await expect(rows).toHaveCount(4);
    // 관심 없음 글 줄을 누르면 그 글 상세(메모가 보인다).
    await panel(page).locator(`[data-nw-key="outside:${P2}"] .now-open`).click();
    const nd = root(page).locator('[data-now-detail] .nd');
    await expect(nd.locator('.nd-title')).toHaveText('[성명] 관심 없음 표시한 글');
    await expect(nd.locator('[data-nd-memo-text]')).toContainText('관심 없음 글 메모');
    if (width <= 760) { await page.goBack(); await expect(panel(page)).toBeVisible(); }
    // 글을 못 찾은 메모 → 노트로.
    await panel(page).locator('.nm-alone [data-nm-note]').click();
    await expect(page.locator('#basketView')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('메모 있는 글: 1000줄이 넘으면 [더 보기]로 이어 읽는다', async ({ page }) => {
  const { errors, server } = await start(page, 412, { many: true });
  await root(page).getByRole('tab', { name: '메모' }).click();
  const more = panel(page).locator('[data-nm-more]');
  await expect(more).toHaveText('더 보기');
  await expect(panel(page).locator('[data-nm-list] > .nw-row')).toHaveCount(4);
  await more.click();
  await expect.poll(() => server.calls.some(c => c.what === 'notes' && c.query.includes('metadata->>outside_post_id=not.is.null') && c.query.includes('offset=1000'))).toBe(true);
  await expect(more).toHaveCount(0);
  await expect(panel(page).locator('[data-nm-list] > .nw-row')).toHaveCount(4); // 같은 글의 옛 메모는 한 줄로
  expect(errors).toEqual([]);
});
