import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { noticeText } from './helpers/small-notice.mjs';
// S67-11 NEWS-보관빼기(명진 11/19 17:22 "보관기사 어떻게 없애? 저 별 클릭해서 해제 5초 되돌리기 안되나 / 아니면 삭제 가능하게") +
// S68-24 READ-보관하나로(명진 11/22 "2. A"): News 안 [보관] 탭은 없앴고, 보관한 글은 읽을 거리 한 목록([News] 칩, 줄 꼬리표 'News')에서 본다.
// ① 읽을 거리 [News]: 보관 글이 읽을 거리 줄과 시각순으로 함께, 같은 주소는 한 줄(읽을 거리 우선, 꼬리표 둘). ⋯ [보관 풀기] = News와 같은 보관 빼기 →
//    줄이 빠지고 '보관에서 뺐어요 [되돌리기]' 5초. 되돌리면 원래 별표 시각·폴더로(원래 자리). 5초가 지나면 서버 별표는 꺼진 채.
// ② News 탭 줄에 [보관] 탭이 없고, 그 자리 '보관 ↗'을 누르면 읽을 거리 [News].
// ③ 보관 글 줄을 누르면 News 지금 글 보기(상세)가 열리고 뒤로 한 번 = 읽을 거리. 내가 넣은 기사(origin 'user')는 상세 [삭제] → 읽을 거리·전체·언론 어디에도 없음
//    (공용 기사 행은 지우지 않고 내 숨김 표시만), [되돌리기]로 복귀.
// 서버는 흉내(기사·단체·주소는 모두 가짜).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const P1 = 'a1000000-0000-4000-8000-000000000011';
const N1 = 'b1000000-0000-4000-8000-000000000011', N2 = 'b1000000-0000-4000-8000-000000000012', N3 = 'b1000000-0000-4000-8000-000000000013';
const F1 = 'f1000000-0000-4000-8000-000000000011';
const R1 = 'c1000000-0000-4000-8000-000000000011';
const CATALOG = [{ key: 'kctu', name: '가짜총연맹', group: 'labor', lang: 'ko' }];
const POST = { id: P1, source_key: 'kctu', kind: 'statement', lang: 'ko', title: '[성명] 가짜 보관 성명', title_ko: null, url: 'https://example.org/s/1', published_at: '2026-10-05T00:30:00Z', fetched_at: '2026-10-05T00:40:00Z', summary_ko: null, key_sentences: [], has_body: false };
// 읽을 거리 줄 하나는 사회운동 보관 글(P1)과 같은 주소 → 읽을 거리 줄 하나로(꼬리표 둘).
const READING = { id: R1, url: 'https://example.org/s/1/', title: '읽을 거리에 넣은 같은 성명', site: 'example.org', saved_at: '2026-10-05T05:00:00Z', read_at: '2026-10-05T06:00:00Z', body_state: 'ok', body_at: '2026-10-05T05:00:10Z', business_area_id: null, updated_at: '2026-10-05T06:00:00Z' };
const art = (id, extra) => ({ id, lane: 'channel', url: `https://example.org/n/${id.slice(-2)}`, title: '가짜 기사 ' + id.slice(-2), lang: 'ko', publisher: '가짜일보', source_key: null, keywords: [], published_at: '2026-10-05T22:00:00Z', scrapped_at: null, created_at: '2026-10-05T22:10:00Z', state: 'ok', summary: '가짜 요약.', body_kind: null, title_ko: null, translated_at: null, author: null, manual_at: null, origin: 'site', ...extra });

async function server(page) {
  const s = {
    calls: [],
    posts: [POST],
    omarks: [{ article_id: P1, starred_at: '2026-10-05T03:00:00Z', archived_at: null, dismissed_at: null }],
    news: [art(N1, { title: '가짜 매체 기사 하나', publisher: '가짜일보' }), art(N2, { title: '내가 공유로 넣은 가짜 기사', origin: 'user', publisher: '가짜신문' }), art(N3, { title: '가짜 수집 기사 셋', publisher: '가짜방송' })],
    nmarks: new Map([[N1, { starred_at: '2026-10-06T00:00:00Z', folder_id: F1, hidden_at: null, keywords: [] }], [N2, { starred_at: '2026-10-04T00:00:00Z', folder_id: null, hidden_at: null, keywords: [] }]]),
  };
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const body = req.postDataJSON?.() ?? null;
    if (p === '/functions/v1/outside-feed') return ok({ ok: true, sources: CATALOG });
    if (p === '/functions/v1/news-feed') return ok({ ok: true, sources: [], limits: {}, status: 'ok' });
    if (p === '/functions/v1/ai-assist') return ok({ ok: true, kind: body?.kind, detail: null, ran: false, added: 0 });
    const table = p.startsWith('/rest/v1/') ? p.slice('/rest/v1/'.length) : '';
    const eq = k => (u.searchParams.get(k) || '').replace(/^eq\./, '');
    if (/^app_(outside_|now_|news_)/.test(table)) s.calls.push({ what: table, method, query: decodeURIComponent(u.search), body });
    if (table === 'app_reading_items') return ok(eq('id') ? [{ ...READING, body: '읽을 거리 원문.' }] : [READING]);
    if (table === 'app_outside_articles') return ok(eq('id') ? s.posts.filter(x => x.id === eq('id')) : s.posts);
    if (table === 'app_outside_sources') return ok([{ source_key: 'kctu', enabled: true, last_ok_at: '2026-10-05T09:07:00Z', last_error: null }]);
    if (table === 'app_outside_article_marks') {
      const id = eq('article_id');
      if (method === 'PATCH') { const row = s.omarks.find(m => m.article_id === id); if (!row) return ok([]); Object.assign(row, body); delete row.updated_at; return ok([{ ...row }]); }
      if (method === 'POST') { const row = { archived_at: null, dismissed_at: null, starred_at: null, ...body }; delete row.workspace_id; s.omarks.push(row); return ok([row], 201); }
      if (id) return ok(s.omarks.filter(m => m.article_id === id));
      return ok(s.omarks.filter(m => m.starred_at || m.dismissed_at).map(m => ({ ...m, app_outside_articles: s.posts.find(x => x.id === m.article_id) })));
    }
    if (table === 'app_news_articles') {
      const id = eq('id');
      const rows = s.news.filter(n => !id || n.id === id).filter(n => n.origin !== 'user' || s.nmarks.has(n.id)); // origin user = 표시가 있는 사람만(RLS 흉내)
      return ok(rows.map(n => ({ ...n, app_news_marks: s.nmarks.has(n.id) ? [{ ...s.nmarks.get(n.id) }] : [] })));
    }
    if (table === 'app_news_marks') {
      const id = eq('article_id');
      if (method === 'PATCH') { const m = s.nmarks.get(id); if (!m) return ok([]); const { updated_at, ...rest } = body; Object.assign(m, rest); return ok([{ article_id: id, starred_at: m.starred_at, folder_id: m.folder_id, hidden_at: m.hidden_at }]); }
      if (method === 'POST') { const m = { starred_at: null, folder_id: null, hidden_at: null, keywords: [], ...body }; delete m.workspace_id; delete m.article_id; s.nmarks.set(body.article_id, m); return ok([{ article_id: body.article_id, ...m }], 201); }
      if (id) { const m = s.nmarks.get(id); return ok(m ? [{ ...m }] : []); }
      const star = u.searchParams.get('starred_at');
      const list = [...s.nmarks.entries()].filter(([, m]) => !star || m.starred_at).sort((a, b) => String(b[1].starred_at).localeCompare(String(a[1].starred_at)));
      return ok(list.map(([aid, m]) => ({ ...m, app_news_articles: s.news.find(n => n.id === aid) })));
    }
    if (table.startsWith('rpc/app_news_article_of') || table.startsWith('rpc/app_outside_article_of')) return ok([]);
    if (table.startsWith('app_news_') || table.startsWith('app_now_') || table.startsWith('app_outside_') || table === 'app_feed_reads') return method === 'POST' ? route.fulfill({ status: 201 }) : ok([]);
    return route.fallback();
  });
  return s;
}

async function start(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await openHome(page);
  const s = await server(page);
  await goNews(page, width);
  return { errors, s };
}
async function goNews(page, width) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: 'News' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: 'News', exact: true }).click();
  await expect(page.locator('#outsideView')).toBeVisible();
}
const root = page => page.locator('#outsideRoot');
const rlist = page => page.locator('#readingView [data-rd-list]');
const newsRow = (page, key) => rlist(page).locator(`.rd-row[data-rd-news="${key}"]`);
const tab = (page, name) => root(page).getByRole('tab', { name, exact: true }).click();
const noWideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const shots = process.env.S68_24_SHOTS;
async function goReading(page, width) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: '읽을 거리' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '읽을 거리', exact: true }).click();
  await expect(page.locator('#readingView')).toBeVisible();
}
const keys = page => rlist(page).locator('.rd-row').evaluateAll(els => els.map(e => e.dataset.rdNews || e.dataset.rdOpen));

for (const width of [412, 884, 1280]) {
  test(`News ${width}: [보관] 탭 없음 · '보관 ↗' = 읽을 거리 [News] · ⋯ [보관 풀기] + 5초 [되돌리기](원래 자리), 5초 뒤 서버 별표 꺼짐`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, s } = await start(page, width);
    // ② News 탭 줄: [전체][사회운동][언론][밑줄] + 길 '보관 ↗'(탭 아님).
    await expect(root(page).getByRole('tab')).toHaveText(['전체', '사회운동', '언론', '밑줄']);
    await expect(root(page).locator('[data-now-panel-saved]')).toHaveCount(0);
    const go = root(page).locator('[data-now-go-saved]');
    await expect(go).toHaveAccessibleName('보관한 글은 읽을 거리에서');
    await go.click();
    await expect(page.locator('#readingView')).toBeVisible();
    await expect(rlist(page).locator('.rd-chips [data-filter-value]')).toHaveText(['안 읽음 0', '전체', '밑줄', 'News 3']);
    await expect(rlist(page).locator('.rd-chips [data-filter-value="news"]')).toHaveAttribute('aria-checked', 'true');
    // ① 시각순 한 목록: N1(10/06) · 읽을 거리 R1(10/05, P1과 같은 주소 → 한 줄) · N2(10/04).
    await expect.poll(() => keys(page)).toEqual([`news:${N1}`, R1, `news:${N2}`]);
    await expect(rlist(page).locator(`.rd-row[data-rd-open="${R1}"] .rd-src-tag`)).toHaveText(['읽을 거리', 'News']);
    await expect(newsRow(page, `news:${N1}`).locator('.rd-src-tag')).toHaveText('News');
    await expect(newsRow(page, `news:${N1}`)).toContainText('가짜 매체 기사 하나');
    await expect(newsRow(page, `news:${N1}`)).toContainText('가짜일보');
    if (shots) await page.screenshot({ path: `${shots}/reading-news-${width}.png` });

    await newsRow(page, `news:${N1}`).locator('[data-rd-more]').click();
    await expect(page.locator('#rdRowMenu button')).toHaveText(['News에서 열기', '보관 풀기']);
    await page.locator('#rdRowMenu button', { hasText: '보관 풀기' }).click();
    await expect(newsRow(page, `news:${N1}`)).toHaveCount(0);
    expect(await noticeText(page)).toBe('보관에서 뺐어요');
    await expect(page.locator('#kptuNotice .kptu-notice-undo')).toBeVisible();
    expect(s.nmarks.get(N1)).toMatchObject({ starred_at: null, folder_id: null });
    // 2초(보통 알림)를 넘겨도 [되돌리기]가 남아 있다(5초).
    await page.waitForTimeout(3000);
    await expect(page.locator('#kptuNotice .kptu-notice-undo')).toBeVisible();
    await page.locator('#kptuNotice .kptu-notice-undo').click();
    await expect(newsRow(page, `news:${N1}`)).toHaveCount(1);
    expect(s.nmarks.get(N1)).toMatchObject({ starred_at: '2026-10-06T00:00:00Z', folder_id: F1 }); // 원래 시각·폴더 그대로
    await expect.poll(() => keys(page)).toEqual([`news:${N1}`, R1, `news:${N2}`]); // 원래 자리

    // N2도 같은 동작. 5초 뒤 알림이 닫히고 서버 별표는 꺼진 채, 다시 들어와도 없다.
    await newsRow(page, `news:${N2}`).locator('[data-rd-more]').click();
    await page.locator('#rdRowMenu button', { hasText: '보관 풀기' }).click();
    await expect(newsRow(page, `news:${N2}`)).toHaveCount(0);
    await expect(page.locator('#kptuNotice:not([hidden]) .kptu-notice-text')).toHaveText('보관에서 뺐어요');
    await expect(page.locator('#kptuNotice')).toBeHidden({ timeout: 8000 });
    expect(s.nmarks.get(N2)).toMatchObject({ starred_at: null });
    await expect.poll(() => s.calls.some(c => c.what === 'app_news_now_signals' && c.body?.action === 'unstar')).toBe(true);
    await page.reload();
    await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
    await expect(page.locator('#readingView')).toBeVisible();
    await rlist(page).locator('.rd-chips [data-filter-value="news"]').click();
    await expect.poll(() => keys(page)).toEqual([`news:${N1}`, R1]);
    expect(await noWideScroll(page)).toBe(true);
    expect(errors).toEqual([]);
  });

  test(`News ${width}: 읽을 거리 보관 글 → News 글 보기, 뒤로 한 번 = 읽을 거리 · 내가 넣은 기사 [삭제] → 어디에도 없음, [되돌리기]로 복귀`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, s } = await start(page, width);
    await tab(page, '전체');
    await expect(root(page).locator(`[data-nw-key="news:${N2}"]`).first()).toBeVisible();
    await goReading(page, width);
    await rlist(page).locator('.rd-chips [data-filter-value="news"]').click();
    await expect(newsRow(page, `news:${N1}`)).toBeVisible();
    // 수집 기사(N1): 같은 상세(지금 News 글 보기), [삭제] 없음. 뒤로 한 번이면 읽을 거리 [News] 그대로.
    await newsRow(page, `news:${N1}`).click();
    const det = root(page).locator('[data-now-detail]');
    await expect(page.locator('#outsideView')).toBeVisible();
    await expect(det.locator('.nd-title')).toContainText('가짜 매체 기사 하나');
    await expect(det.locator('[data-nd-delete]')).toHaveCount(0);
    await page.goBack();
    await expect(page.locator('#readingView')).toBeVisible();
    await expect(rlist(page).locator('.rd-chips [data-filter-value="news"]')).toHaveAttribute('aria-checked', 'true');
    // 내가 넣은 기사(N2): 키보드(Enter)로도 열린다.
    await newsRow(page, `news:${N2}`).focus();
    await page.keyboard.press('Enter');
    await expect(det.locator('.nd-title')).toContainText('내가 공유로 넣은 가짜 기사');
    await expect(det.locator('[data-nd-delete]')).toHaveText('삭제');
    if (shots) await page.screenshot({ path: `${shots}/detail-from-reading-${width}.png` });
    await det.locator('[data-nd-delete]').click();
    expect(await noticeText(page)).toBe('삭제했어요');
    expect(s.nmarks.get(N2)).toMatchObject({ starred_at: null, folder_id: null });
    expect(s.nmarks.get(N2).hidden_at).toBeTruthy();
    expect(s.news.some(n => n.id === N2)).toBe(true); // 공용 기사 행은 그대로
    expect(s.calls.some(c => c.what === 'app_news_articles' && c.method !== 'GET')).toBe(false);
    await page.locator('#kptuNotice .kptu-notice-undo').click();
    await expect.poll(() => s.nmarks.get(N2)).toMatchObject({ starred_at: '2026-10-04T00:00:00Z', hidden_at: null });

    // 되돌린 기사는 읽을 거리에 다시 보인다(들어올 때 다시 읽음). 다시 [삭제] → 5초 지나면 읽을 거리·전체·언론 어디에도 없다.
    await goReading(page, width);
    await rlist(page).locator('.rd-chips [data-filter-value="news"]').click();
    await expect.poll(() => keys(page)).toEqual([`news:${N1}`, R1, `news:${N2}`]);
    await newsRow(page, `news:${N2}`).click();
    await expect(det.locator('[data-nd-delete]')).toHaveText('삭제');
    await det.locator('[data-nd-delete]').click();
    await expect(page.locator('#kptuNotice:not([hidden]) .kptu-notice-text')).toHaveText('삭제했어요');
    await expect(page.locator('#kptuNotice')).toBeHidden({ timeout: 8000 });
    await goReading(page, width);
    await rlist(page).locator('.rd-chips [data-filter-value="news"]').click();
    await expect.poll(() => keys(page)).toEqual([`news:${N1}`, R1]);
    await goNews(page, width);
    await tab(page, '전체');
    await expect(root(page).locator(`[data-nw-key="news:${N3}"]`).first()).toBeVisible();
    await expect(root(page).locator(`[data-nw-key="news:${N2}"]`)).toHaveCount(0);
    await tab(page, '언론');
    await expect(page.locator(`#newsRoot [data-nc-item="${N3}"]`)).toBeVisible();
    await expect(page.locator(`#newsRoot [data-nc-item="${N2}"]`)).toHaveCount(0);
    expect(await noWideScroll(page)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('읽을 거리: News 기능이 없는 사람은 [News] 칩·보관 글 줄이 없고 News 보관 읽기도 부르지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page, { features: [] });
  const s = await server(page);
  await goReading(page, 1280);
  await rlist(page).locator('.rd-chips [data-filter-value="all"]').click();
  await expect(rlist(page).locator('.rd-chips [data-filter-value]')).toHaveText(['안 읽음 0', '전체', '밑줄']);
  await expect.poll(() => keys(page)).toEqual([R1]);
  await expect(rlist(page).locator('.rd-src-tag')).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(s.calls.filter(c => c.what === 'app_news_marks' || c.what === 'app_outside_article_marks')).toEqual([]);
  expect(errors).toEqual([]);
});
