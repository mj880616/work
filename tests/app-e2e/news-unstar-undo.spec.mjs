import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { noticeText } from './helpers/small-notice.mjs';
// S67-11 NEWS-보관빼기(명진 11/19 17:22 "보관기사 어떻게 없애? 저 별 클릭해서 해제 5초 되돌리기 안되나 / 아니면 삭제 가능하게") +
// S68-24 READ-보관하나로(명진 11/22 "2. A") + S68-27 READ-보관기록일원화(11/22 21:37 "저장된 기록도 일원화"): 보관의 원본은 읽을 거리 표 하나다.
// News에서 보관한 글도 읽을 거리 줄(원래 글 연결 칸 news_article_id·outside_article_id)이고, 보관·보관 풀기는 서버 함수 app_reading_keep 하나.
// ① S68-29(명진 11/23 02:23 "news 란을 만들라는 게 아니라 뉴스에서 보관하면 그냥 여기로 오는 개념"): 읽을 거리에 [News] 칩·'News' 꼬리표가 없다.
//    연결된 줄도 평범한 줄, 저장 시각순. ⋯ [삭제] = News와 같은 보관 빼기(app_reading_keep 끄기) → 줄이 빠지고 '삭제했어요 [되돌리기]' 5초.
//    되돌리면 원래 저장 시각·폴더로(원래 자리). 5초가 지나면 서버 줄은 지워진 채. 고른 줄 [삭제]도 같은 길, 알림 하나.
// ② News 탭 줄에 [보관] 탭도 '보관 ↗' 길도 없다(S68-28).
// ③ 연결된 줄을 누르면 News 지금 글 보기(상세)가 열리고 뒤로 한 번 = 읽을 거리. 내가 넣은 기사(origin 'user')는 상세 [삭제] → 읽을 거리·전체·언론 어디에도 없음
//    (공용 기사 행은 지우지 않고 내 숨김 표시만), [되돌리기]로 복귀.
// 서버는 흉내(기사·단체·주소는 모두 가짜).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const P1 = 'a1000000-0000-4000-8000-000000000011';
const N1 = 'b1000000-0000-4000-8000-000000000011', N2 = 'b1000000-0000-4000-8000-000000000012', N3 = 'b1000000-0000-4000-8000-000000000013';
const F1 = 'f1000000-0000-4000-8000-000000000011';
const R1 = 'c1000000-0000-4000-8000-000000000011', RN1 = 'c1000000-0000-4000-8000-000000000021', RN2 = 'c1000000-0000-4000-8000-000000000022';
const CATALOG = [{ key: 'kctu', name: '가짜총연맹', group: 'labor', lang: 'ko' }];
const POST = { id: P1, source_key: 'kctu', kind: 'statement', lang: 'ko', title: '[성명] 가짜 보관 성명', title_ko: null, url: 'https://example.org/s/1', published_at: '2026-10-05T00:30:00Z', fetched_at: '2026-10-05T00:40:00Z', summary_ko: null, key_sentences: [], has_body: false };
const line = extra => ({ url: '', title: null, site: null, read_at: '2026-10-06T06:00:00Z', body_state: 'ok', body_at: '2026-10-05T05:00:10Z', business_area_id: null, updated_at: '2026-10-05T06:00:00Z', origin: 'direct', news_article_id: null, outside_article_id: null, ...extra });
// 읽을 거리 줄 셋: 직접 저장했고 같은 주소의 사회운동 글(P1)에 연결된 줄 R1, News에서 보관한 기사 줄 RN1(N1)·RN2(N2).
const READING = () => [
  line({ id: R1, url: 'https://example.org/s/1', title: '읽을 거리에 넣은 같은 성명', site: 'example.org', saved_at: '2026-10-05T05:00:00Z', outside_article_id: P1 }),
  line({ id: RN1, url: 'https://example.org/n/11', title: '가짜 매체 기사 하나', site: '가짜일보', saved_at: '2026-10-06T00:00:00Z', origin: 'news', news_article_id: N1 }),
  line({ id: RN2, url: 'https://example.org/n/12', title: '내가 공유로 넣은 가짜 기사', site: '가짜신문', saved_at: '2026-10-04T00:00:00Z', origin: 'news', news_article_id: N2 }),
];
const art = (id, extra) => ({ id, lane: 'channel', url: `https://example.org/n/${id.slice(-2)}`, title: '가짜 기사 ' + id.slice(-2), lang: 'ko', publisher: '가짜일보', source_key: null, keywords: [], published_at: '2026-10-05T22:00:00Z', scrapped_at: null, created_at: '2026-10-05T22:10:00Z', state: 'ok', summary: '가짜 요약.', body_kind: null, title_ko: null, translated_at: null, author: null, manual_at: null, origin: 'site', ...extra });

async function server(page, { plain = false } = {}) {
  const s = {
    calls: [],
    posts: [POST],
    omarks: [],
    news: [art(N1, { title: '가짜 매체 기사 하나', publisher: '가짜일보' }), art(N2, { title: '내가 공유로 넣은 가짜 기사', origin: 'user', publisher: '가짜신문' }), art(N3, { title: '가짜 수집 기사 셋', publisher: '가짜방송' })],
    // 표시 표: 별표 폴더·숨김만(보관은 읽을 거리 줄). N2는 내가 넣은 기사라 표시 줄이 있어야 읽힌다(RLS 흉내).
    nmarks: new Map([[N1, { folder_id: F1, hidden_at: null, keywords: [] }], [N2, { folder_id: null, hidden_at: null, keywords: [] }]]),
    reading: plain ? [line({ id: R1, url: 'https://example.org/s/1', title: '읽을 거리에 넣은 같은 성명', site: 'example.org', saved_at: '2026-10-05T05:00:00Z' })] : READING(),
    made: 0,
  };
  const linkCol = src => (src === 'news' ? 'news_article_id' : 'outside_article_id');
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const body = req.postDataJSON?.() ?? null;
    if (p === '/functions/v1/outside-feed') return ok({ ok: true, sources: CATALOG });
    if (p === '/functions/v1/news-feed') return ok({ ok: true, sources: [], limits: {}, status: 'ok' });
    if (p === '/functions/v1/ai-assist') return ok({ ok: true, kind: body?.kind, detail: null, ran: false, added: 0 });
    const table = p.startsWith('/rest/v1/') ? p.slice('/rest/v1/'.length) : '';
    const eq = k => (u.searchParams.get(k) || '').replace(/^eq\./, '');
    if (/^app_(outside_|now_|news_|reading_)|^rpc\/app_reading_keep/.test(table)) s.calls.push({ what: table, method, query: decodeURIComponent(u.search), body });
    const savedOf = (col, id) => s.reading.filter(r => r[col] === id).map(r => ({ saved_at: r.saved_at }));
    if (table === 'rpc/app_reading_keep') {
      const col = linkCol(body.p_source), was = s.reading.find(r => r[col] === body.p_article);
      if (!body.p_on) {
        s.reading = s.reading.filter(r => r !== was);
        if (body.p_source === 'news' && s.nmarks.has(body.p_article)) s.nmarks.get(body.p_article).folder_id = null;
        return ok({ ok: true, on: false, removed: was ? 1 : 0, saved_at: was?.saved_at ?? null });
      }
      if (was) return ok({ ok: true, on: true, id: was.id, saved_at: was.saved_at, created: false });
      const a = body.p_source === 'news' ? s.news.find(n => n.id === body.p_article) : s.posts.find(x => x.id === body.p_article);
      const row = line({ id: `c1000000-0000-4000-8000-0000000009${String(s.made++).padStart(2, '0')}`, url: a.url, title: a.title, site: a.publisher || null, saved_at: body.p_saved_at || new Date().toISOString(), origin: body.p_source, [col]: body.p_article });
      s.reading.push(row);
      return ok({ ok: true, on: true, id: row.id, saved_at: row.saved_at, created: true });
    }
    if (table === 'app_reading_items') {
      if (eq('id')) return ok(s.reading.filter(r => r.id === eq('id')).map(r => ({ ...r, body: '읽을 거리 원문.' })));
      for (const col of ['news_article_id', 'outside_article_id']) {
        const want = u.searchParams.get(col);
        if (!want) continue;
        const ids = /^in\.\((.*)\)$/.exec(want)?.[1]?.split(',');
        const rows = s.reading.filter(r => r[col] && (want === 'not.is.null' || (ids ? ids.includes(r[col]) : r[col] === want.replace(/^eq\./, ''))));
        return ok(rows.map(r => ({ ...r, app_outside_articles: col === 'outside_article_id' ? s.posts.find(x => x.id === r[col]) : undefined,
          app_news_articles: col === 'news_article_id' ? { ...s.news.find(n => n.id === r[col]), app_news_marks: s.nmarks.has(r[col]) ? [{ ...s.nmarks.get(r[col]) }] : [] } : undefined })));
      }
      return ok([...s.reading].sort((x, y) => String(y.saved_at).localeCompare(String(x.saved_at))));
    }
    if (table === 'app_outside_articles') return ok(eq('id') ? s.posts.filter(x => x.id === eq('id')) : s.posts);
    if (table === 'app_outside_sources') return ok([{ source_key: 'kctu', enabled: true, last_ok_at: '2026-10-05T09:07:00Z', last_error: null }]);
    if (table === 'app_outside_article_marks') {
      const id = eq('article_id');
      if (method === 'PATCH') { const row = s.omarks.find(m => m.article_id === id); if (!row) return ok([]); Object.assign(row, body); delete row.updated_at; return ok([{ ...row }]); }
      if (method === 'POST') { const row = { dismissed_at: null, ...body }; delete row.workspace_id; s.omarks.push(row); return ok([row], 201); }
      if (id) return ok(s.omarks.filter(m => m.article_id === id));
      return ok(s.omarks.filter(m => m.dismissed_at));
    }
    if (table === 'app_news_articles') {
      const id = eq('id');
      const rows = s.news.filter(n => !id || n.id === id).filter(n => n.origin !== 'user' || s.nmarks.has(n.id)); // origin user = 표시가 있는 사람만(RLS 흉내)
      return ok(rows.map(n => ({ ...n, app_news_marks: s.nmarks.has(n.id) ? [{ ...s.nmarks.get(n.id) }] : [], app_reading_items: savedOf('news_article_id', n.id) })));
    }
    if (table === 'app_news_marks') {
      const id = eq('article_id');
      if (method === 'PATCH') { const m = s.nmarks.get(id); if (!m) return ok([]); const { updated_at, ...rest } = body; Object.assign(m, rest); return ok([{ article_id: id, folder_id: m.folder_id, hidden_at: m.hidden_at }]); }
      if (method === 'POST') { const m = { folder_id: null, hidden_at: null, keywords: [], ...body }; delete m.workspace_id; delete m.article_id; s.nmarks.set(body.article_id, m); return ok([{ article_id: body.article_id, ...m }], 201); }
      if (id) { const m = s.nmarks.get(id); return ok(m ? [{ ...m }] : []); }
      return ok([...s.nmarks.entries()].map(([aid, m]) => ({ ...m, app_news_articles: { ...s.news.find(n => n.id === aid), app_reading_items: savedOf('news_article_id', aid) } })));
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
    await page.locator('#mobileMenu nav button:visible', { hasText: '읽을 거리' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '읽을 거리', exact: true }).click();
  await expect(page.locator('#outsideView')).toBeVisible();
}
const root = page => page.locator('#outsideRoot');
const rlist = page => page.locator('#readingView [data-rd-list]');
const row = (page, title) => rlist(page).locator('.rd-row', { has: page.locator('.rd-nm', { hasText: title }) });
const tab = (page, name) => root(page).getByRole('tab', { name, exact: true }).click();
const noWideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const shots = process.env.S68_24_SHOTS;
async function goReading(page, width) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: '저장한 글' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '저장한 글', exact: true }).click();
  await expect(page.locator('#readingView')).toBeVisible();
}
const T_N1 = '가짜 매체 기사 하나', T_R1 = '읽을 거리에 넣은 같은 성명', T_N2 = '내가 공유로 넣은 가짜 기사';
// S70-58 READ-두칸보기: 두 칸(600px~)에서는 저장한 글 줄을 누르면 오른쪽 칸에 열린다 — 읽을 거리 글 보기는 글 보기 머리 ⋯ [읽을 거리에서 보기]. 폰은 줄을 누르면 바로.
// 오른쪽 칸이 방금 누른 글로 바뀐 뒤에 ⋯를 누른다(앞 글 머리 ⋯가 아직 보이는 사이에 누르면 앞 글이 열린다 — S71-03).
async function toNews(page, width, title) {
  if (width < 600) return;
  await expect(page.locator('#readingView [data-rd-detail] .ds-doc-title')).toHaveText(title);
  const more = page.locator('#readingView [data-rd-detail] [data-rd-head-more]');
  await expect(more).toBeVisible();
  await more.click();
  await page.locator('#rdRowMenu [data-rd-act="news"]').click();
}
const titles = page => rlist(page).locator('.rd-row .rd-nm').allTextContents();
const savedAt = (s, id) => s.reading.find(r => r.news_article_id === id)?.saved_at ?? null;

for (const width of [412, 884, 1280]) {
  test(`News ${width}: 탭 줄에 '보관' 없음 · 읽을 거리에 [News] 칩·꼬리표 없음 · ⋯ [삭제] + 5초 [되돌리기](원래 자리), 5초 뒤 서버 줄 지워짐`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, s } = await start(page, width);
    // ② News 탭 줄: [전체][사회운동][언론][밑줄][메모](S69-70)만 — '보관' 탭도 '보관 ↗' 길도 없다(S68-28). 읽을 거리는 메뉴로.
    await expect(root(page).locator('[data-os-tabs] button')).toHaveText(['전체', '사회운동', '언론', '밑줄', '메모']);
    await expect(root(page).locator('[data-now-panel-saved]')).toHaveCount(0);
    await page.evaluate(() => window.KPTURouter.go('reading'));
    await expect(page.locator('#readingView')).toBeVisible();
    await rlist(page).locator('.rd-switch [data-filter-value="all"]').click();
    await expect(rlist(page).locator('.rd-switch [data-filter-value]')).toHaveText(['전체', '안 읽음', '밑줄', '메모']);
    await expect(rlist(page).locator('.rd-switch [data-filter-value="news"]')).toHaveCount(0);
    // ① 한 표의 줄을 저장 시각순으로: N1(10/06) · R1(10/05, 같은 주소 사회운동 글에 연결) · N2(10/04). 연결된 줄도 꼬리표 없이 평범한 줄.
    await expect.poll(() => titles(page)).toEqual([T_N1, T_R1, T_N2]);
    await expect(rlist(page).locator('.rd-src-tag, .rd-row-news, .rd-sub')).toHaveCount(0);
    await expect(row(page, T_N1)).toContainText('가짜일보');
    await expect(row(page, T_N1)).toHaveAttribute('aria-label', '가짜 매체 기사 하나 · 가짜일보');
    if (shots) await page.screenshot({ path: `${shots}/reading-news-${width}.png` });

    await row(page, T_N1).locator('[data-rd-more]').click();
    await expect(page.locator('#rdRowMenu button')).toHaveText(['수정', '안 읽음으로', '사업에 연결', '폴더로 옮기기', '공유', '삭제']);
    await page.locator('#rdRowMenu button', { hasText: '삭제' }).click();
    await expect(row(page, T_N1)).toHaveCount(0);
    expect(await noticeText(page)).toBe('삭제했어요');
    await expect(page.locator('.kptu-ask')).toHaveCount(0); // 되돌릴 수 있어 묻지 않는다
    await expect(page.locator('#kptuNotice .kptu-notice-undo')).toBeVisible();
    // 서버: 보관 함수 하나(끄기) → 읽을 거리 줄 지움 + 별표 폴더 비움. 표시 표의 별표 칸은 없다.
    expect(s.calls.filter(c => c.what === 'rpc/app_reading_keep').at(-1).body).toEqual({ p_workspace: 'w', p_source: 'news', p_article: N1, p_on: false, p_saved_at: null });
    expect(savedAt(s, N1)).toBeNull();
    expect(s.nmarks.get(N1).folder_id).toBeNull();
    // 2초(보통 알림)를 넘겨도 [되돌리기]가 남아 있다(5초).
    await page.waitForTimeout(3000);
    await expect(page.locator('#kptuNotice .kptu-notice-undo')).toBeVisible();
    await page.locator('#kptuNotice .kptu-notice-undo').click();
    await expect(row(page, T_N1)).toHaveCount(1);
    expect(savedAt(s, N1)).toBe('2026-10-06T00:00:00Z'); // 원래 저장 시각
    expect(s.nmarks.get(N1).folder_id).toBe(F1); // 원래 폴더
    await expect.poll(() => titles(page)).toEqual([T_N1, T_R1, T_N2]); // 원래 자리

    // N2도 같은 동작. 5초 뒤 알림이 닫히고 서버 줄은 지워진 채, 다시 들어와도 없다.
    await row(page, T_N2).locator('[data-rd-more]').click();
    await page.locator('#rdRowMenu button', { hasText: '삭제' }).click();
    await expect(row(page, T_N2)).toHaveCount(0);
    await expect(page.locator('#kptuNotice:not([hidden]) .kptu-notice-text')).toHaveText('삭제했어요');
    await expect(page.locator('#kptuNotice')).toBeHidden({ timeout: 8000 });
    expect(savedAt(s, N2)).toBeNull();
    await expect.poll(() => s.calls.some(c => c.what === 'app_news_now_signals' && c.body?.action === 'unstar')).toBe(true);
    await page.reload();
    await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
    await expect(page.locator('#readingView')).toBeVisible();
    await rlist(page).locator('.rd-switch [data-filter-value="all"]').click();
    await expect.poll(() => titles(page)).toEqual([T_N1, T_R1]);
    // 표시 표에는 별표·옛 보관 칸을 쓰지 않았다.
    expect(s.calls.some(c => /app_(news|outside_article)_marks/.test(c.what) && c.body && ('starred_at' in c.body || 'archived_at' in c.body))).toBe(false);
    expect(await noWideScroll(page)).toBe(true);
    expect(errors).toEqual([]);
  });

  test(`News ${width}: 읽을 거리 보관 줄 → News 글 보기, 뒤로 한 번 = 읽을 거리 · 내가 넣은 기사 [삭제] → 어디에도 없음, [되돌리기]로 복귀`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, s } = await start(page, width);
    await tab(page, '전체');
    await expect(root(page).locator(`[data-nw-key="news:${N2}"]`).first()).toBeVisible();
    await goReading(page, width);
    await rlist(page).locator('.rd-switch [data-filter-value="all"]').click();
    await expect(row(page, T_N1)).toBeVisible();
    // 수집 기사(N1): 같은 상세(지금 News 글 보기), [삭제] 없음. 뒤로 한 번이면 읽을 거리 [전체] 그대로.
    await row(page, T_N1).click();
    await toNews(page, width, T_N1);
    const det = root(page).locator('[data-now-detail]');
    await expect(page.locator('#outsideView')).toBeVisible();
    await expect(det.locator('.nd-title')).toContainText('가짜 매체 기사 하나');
    await expect(det.locator('[data-nd-delete]')).toHaveCount(0);
    await page.goBack();
    await expect(page.locator('#readingView')).toBeVisible();
    await expect(rlist(page).locator('.rd-switch [data-filter-value="all"]')).toHaveAttribute('aria-checked', 'true');
    // 내가 넣은 기사(N2): 키보드(Enter)로도 열린다.
    await row(page, T_N2).focus();
    await page.keyboard.press('Enter');
    await toNews(page, width, T_N2);
    await expect(det.locator('.nd-title')).toContainText('내가 공유로 넣은 가짜 기사');
    await expect(det.locator('[data-nd-delete]')).toHaveText('기사 삭제'); // S68-34: 저장해 둔 내 기사는 [삭제](저장한 글에서 빼기)와 겹치지 않게 '기사 삭제'
    if (shots) await page.screenshot({ path: `${shots}/detail-from-reading-${width}.png` });
    await det.locator('[data-nd-delete]').click();
    expect(await noticeText(page)).toBe('삭제했어요');
    await expect.poll(() => savedAt(s, N2)).toBeNull();
    expect(s.nmarks.get(N2).hidden_at).toBeTruthy();
    expect(s.news.some(n => n.id === N2)).toBe(true); // 공용 기사 행은 그대로
    expect(s.calls.some(c => c.what === 'app_news_articles' && c.method !== 'GET')).toBe(false);
    await page.locator('#kptuNotice .kptu-notice-undo').click();
    await expect.poll(() => savedAt(s, N2)).toBe('2026-10-04T00:00:00Z');
    await expect.poll(() => s.nmarks.get(N2).hidden_at).toBeNull();

    // 되돌린 기사는 읽을 거리에 다시 보인다(들어올 때 다시 읽음). 다시 [삭제] → 5초 지나면 읽을 거리·전체·언론 어디에도 없다.
    await goReading(page, width);
    await rlist(page).locator('.rd-switch [data-filter-value="all"]').click();
    await expect.poll(() => titles(page)).toEqual([T_N1, T_R1, T_N2]);
    await row(page, T_N2).click();
    await toNews(page, width, T_N2);
    await expect(det.locator('[data-nd-delete]')).toHaveText('기사 삭제');
    await det.locator('[data-nd-delete]').click();
    await expect(page.locator('#kptuNotice:not([hidden]) .kptu-notice-text')).toHaveText('삭제했어요');
    await expect(page.locator('#kptuNotice')).toBeHidden({ timeout: 8000 });
    await goReading(page, width);
    await rlist(page).locator('.rd-switch [data-filter-value="all"]').click();
    await expect.poll(() => titles(page)).toEqual([T_N1, T_R1]);
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

test('읽을 거리 412: News에서 보낸 줄을 골라 [삭제] — 묻지 않고 한 번에, 알림 하나 \'2개 삭제했어요\' [되돌리기]로 둘 다 원래 자리', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, s } = await start(page, 412);
  await goReading(page, 412);
  await rlist(page).locator('.rd-switch [data-filter-value="all"]').click();
  await expect.poll(() => titles(page)).toEqual([T_N1, T_R1, T_N2]);
  // 오른쪽으로 밀면 바로 선택(공용 줄 밀기, S70-64 W3). 손가락 밀기는 포인터만 보낸다.
  await expect(async () => {
    const sent = await row(page, T_N1).evaluate(el => {
      if (!el.isConnected) return false;
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const fire = (type, cx) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: y }));
      fire('pointerdown', x); for (let i = 1; i <= 10; i++) fire('pointermove', x + 32 * i); fire('pointerup', x + 320);
      return true;
    });
    expect(sent).toBe(true);
  }).toPass({ timeout: 10000 });
  const bar = page.locator('#readingView .row-swipe-pickbar');
  // S70-64 W3: 오른쪽 밀기 = 바로 그 줄 선택([선택] 칸이 남지 않음).
  await expect(bar).toBeVisible();
  await expect(page.locator('#readingView [data-row-swipe-key="select"]')).toHaveCount(0);
  await row(page, T_N2).click();
  await expect(bar.locator('.row-swipe-pick-count')).toHaveText('2개 선택됨');
  await expect(bar.locator('[data-row-pick-act]')).toHaveText(['삭제']); // S70-64b: [전체 선택][삭제] 두 칸
  await bar.locator('[data-row-pick-act="delete"]').click();
  await expect(page.locator('#kptuNotice:not([hidden]) .kptu-notice-text')).toHaveText('2개 삭제했어요');
  await expect(page.locator('.kptu-ask')).toHaveCount(0);
  await expect.poll(() => titles(page)).toEqual([T_R1]);
  expect(savedAt(s, N1)).toBeNull();
  expect(savedAt(s, N2)).toBeNull();
  expect(s.calls.filter(c => c.what === 'rpc/app_reading_keep' && c.body?.p_on === false).map(c => c.body.p_article).sort()).toEqual([N1, N2].sort());
  await page.locator('#kptuNotice .kptu-notice-undo').click();
  await expect.poll(() => titles(page)).toEqual([T_N1, T_R1, T_N2]);
  expect(savedAt(s, N1)).toBe('2026-10-06T00:00:00Z');
  expect(savedAt(s, N2)).toBe('2026-10-04T00:00:00Z');
  expect(errors).toEqual([]);
});

test('읽을 거리: News 기능이 없는 사람은 [News] 칩이 없고 News 표시·보관 함수를 부르지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page, { features: [] });
  const s = await server(page, { plain: true });
  await goReading(page, 1280);
  await rlist(page).locator('.rd-switch [data-filter-value="all"]').click();
  await expect(rlist(page).locator('.rd-switch [data-filter-value]')).toHaveText(['전체', '안 읽음', '밑줄', '메모']);
  await expect.poll(() => titles(page)).toEqual([T_R1]);
  await expect(rlist(page).locator('.rd-src-tag')).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(s.calls.filter(c => c.what === 'app_news_marks' || c.what === 'app_outside_article_marks' || c.what === 'rpc/app_reading_keep')).toEqual([]);
  expect(errors).toEqual([]);
});

// S68-54(명진 11/23 14:57 "저장된 글에서 글을 클릭하면 한 번 읽을 거리 목록이 뜨고 그 글이 열림"): 저장한 글 줄을 누르면 글을 먼저 읽어 두고
// 화면을 옮기는 순간 글 보기를 바로 그린다. 폰은 읽을 거리 목록이 한 번도 보이지 않고, PC(목록|글 두 칸)는 오른쪽에 다른 글·빈 칸이 먼저 보이지 않는다.
// 뒤로 한 번 = 저장한 글. 폰은 읽을 거리를 처음 여는 경우(화면 프로그램을 그때 불러옴), PC는 읽을 거리를 먼저 봐서 맨 위 글이 저절로 열리던 경우.
async function watchOutside(page) {
  await page.evaluate(() => {
    const w = window.__s68_54 = { listSeen: false, titles: [] };
    const look = () => {
      const v = document.getElementById('outsideView');
      if (!v || v.classList.contains('hidden') || !v.checkVisibility()) return;
      const r = document.getElementById('outsideRoot');
      if (innerWidth <= 760 && [...(r?.querySelectorAll('.now-main') || [])].some(m => m.checkVisibility())) w.listSeen = true;
      const t = r?.querySelector('[data-now-detail] .nd-title');
      const text = t && t.checkVisibility() ? t.textContent.trim() : '';
      if (w.titles.at(-1) !== text) w.titles.push(text);
    };
    new MutationObserver(look).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    const tick = () => { look(); requestAnimationFrame(tick); };
    tick();
  });
}
for (const width of [412, 1280]) {
  test(`저장한 글 ${width}: 줄을 누르면 읽을 거리 목록을 거치지 않고 바로 글 보기, 뒤로 한 번 = 저장한 글`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await openHome(page);
    const s = await server(page);
    if (width > 760) {
      // PC: 읽을 거리를 먼저 보면 맨 위 글이 저절로 열린다 — 저장한 글에서 다른 글을 눌렀을 때 그 글이 먼저 보이면 안 된다.
      await goNews(page, width);
      await tab(page, '전체');
      await expect(root(page).locator('[data-now-detail] .nd-title')).toBeVisible();
    }
    await goReading(page, width);
    await rlist(page).locator('.rd-switch [data-filter-value="all"]').click();
    await expect(row(page, T_N2)).toBeVisible();
    if (width >= 600) { await row(page, T_N2).click(); await expect(page.locator('#readingView [data-rd-detail] .ds-doc-title')).toHaveText(T_N2); }
    await watchOutside(page);
    if (width >= 600) await toNews(page, width, T_N2); else await row(page, T_N2).click();
    const det = root(page).locator('[data-now-detail]');
    await expect(page.locator('#outsideView')).toBeVisible();
    await expect(det.locator('.nd-title')).toContainText(T_N2);
    const seen = await page.evaluate(() => window.__s68_54);
    expect(seen.listSeen).toBe(false);
    expect(seen.titles).toEqual([T_N2]);
    expect(s.calls.some(c => c.what === 'app_news_articles' && c.query.includes(N2))).toBe(true);
    await page.goBack();
    await expect(page.locator('#readingView')).toBeVisible();
    await expect(row(page, T_N2)).toBeVisible();
    expect(errors).toEqual([]);
  });
}
