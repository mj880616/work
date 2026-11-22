import { test, expect } from '@playwright/test';
import { start, openNews } from './helpers/news-server.mjs';
import { noticeText } from './helpers/small-notice.mjs';
// S68-27 READ-보관기록일원화 PR-2 화면(명진 11/22 21:37 "저장된 기록도 일원화 하지 왜?"): 보관한 글의 원본은 읽을 거리 표 하나.
// ① News [언론] 상세 [☆ 별표] → 서버 보관 한 길(app_reading_keep) → 읽을 거리에 그 기사 한 줄(꼬리표 News, [News] 칩), News 줄 ★은 켜진 채(읽을 거리 줄을 붙여 읽음).
// ② 그 기사의 밑줄(종류 news, 원래 기사 id)은 옮기지 않았어도 읽을 거리 [밑줄] 칩에 잡힌다(연결 칸으로 찾음).
// ③ News 찾기 '보관한 글': 30일 넘은 옛 기사도 읽을 거리 줄로 보관돼 있으면 찾는다(최근 기사 읽기에는 없음).
// ④ 읽을 거리 ⋯ [보관 풀기] → 줄이 빠지고 News ★도 꺼짐, 5초 [되돌리기] → 같은 시각으로 다시(원래 자리).
// 서버는 흉내(helpers/news-server.mjs — 기사 한 줄의 starred_at = 그 기사를 가리키는 읽을 거리 줄의 저장 시각). 기사·주소는 모두 가짜(example.org).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const OLD = { id: 'o1', lane: 'keyword', url: 'https://example.org/old', title: '보관낱말 들어간 옛 가짜 기사', lang: 'ko', publisher: '가짜일보', source_key: null, keywords: [], published_at: '2026-08-01T00:00:00Z', scrapped_at: null, created_at: '2026-08-01T00:10:00Z', state: 'ok', summary: '옛 가짜 요약.', body_kind: null, title_ko: null, translated_at: null, starred_at: '2026-08-02T00:00:00Z', folder_id: null, _body: null };
const HL = { id: 'c7000000-0000-4000-8000-000000000001', source_type: 'news', source_id: 'c1', quote: '가짜 채널 기사 한 문장', quote_prefix: '', quote_suffix: '', memo: null, source_title: '가짜 채널 기사', source_media: '가짜노동신문', source_date: '2026-10-06T00:00:00Z', source_url: 'https://example.org/c1', created_at: '2026-10-06T02:00:00Z', updated_at: '2026-10-06T02:00:00Z' };

const rlist = page => page.locator('#readingView [data-rd-list]');
const item = (page, id) => page.locator(`#newsRoot [data-nc-item="${id}"]`);
async function goReading(page, width) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: '읽을 거리' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '읽을 거리', exact: true }).click();
  await expect(page.locator('#readingView')).toBeVisible();
}

for (const width of [412, 1280]) {
  test(`보관 한 표 ${width}: News ★ → 읽을 거리 한 줄·★ 켜진 채 · 밑줄 칩 · 찾기 '보관한 글' · 보관 풀기 + 되돌리기`, async ({ page }) => {
    test.setTimeout(120000);
    const { errors, server } = await start(page, width);
    server.items.push({ ...OLD });
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_news_highlights', r => r.fulfill({ json: r.request().method() === 'GET' ? [HL] : [] }));
    await openNews(page, width);

    // ① 상세 [☆ 별표] → 보관 한 길. 옛 별표 칸(app_news_marks.starred_at)에는 쓰지 않는다.
    await item(page, 'c1').locator('[data-nc-open="c1"]').click();
    await page.locator('#nowDetail [data-nd-act="star"]').click();
    await expect(page.locator('#nowDetail [data-nd-act="star"]')).toHaveAttribute('aria-pressed', 'true');
    expect(server.calls.filter(c => c.what === 'keep').map(c => c.body)).toEqual([{ p_workspace: 'w', p_source: 'news', p_article: 'c1', p_on: true, p_saved_at: null }]);
    expect(server.calls.filter(c => c.what === 'app_news_marks' && c.method !== 'GET').some(c => 'starred_at' in (c.body || {}))).toBe(false);
    if (width <= 760) await page.goBack();
    await expect(item(page, 'c1').locator('.nw-star')).toHaveCount(1);

    // 읽을 거리: 그 기사가 한 줄(News에서 보관한 줄 — 꼬리표 News), [News] 칩에 옛 보관 글과 함께 둘.
    await goReading(page, width);
    await rlist(page).locator('.rd-chips [data-filter-value="news"]').click();
    const rows = rlist(page).locator('.rd-row');
    await expect.poll(() => rows.evaluateAll(els => els.map(e => e.dataset.rdNews))).toEqual(['news:c1', 'news:o1']);
    await expect(rlist(page).locator('.rd-row[data-rd-news="news:c1"]')).toContainText('가짜 채널 기사');
    await expect(rlist(page).locator('.rd-row[data-rd-news="news:c1"] .rd-src-tag')).toHaveText('News');
    // ② 밑줄은 원래 기사 id 그대로 — 연결 칸으로 [밑줄] 칩에 잡힌다.
    await expect(rlist(page).locator('.rd-chips [data-filter-value]')).toHaveText(['안 읽음 0', '전체', '밑줄 1', 'News 2']);
    await rlist(page).locator('.rd-chips [data-filter-value="marks"]').click();
    await expect.poll(() => rows.evaluateAll(els => els.map(e => e.dataset.rdNews))).toEqual(['news:c1']);
    // 읽을 거리 화면은 읽을 거리 표 하나만 읽는다(News 별표 칸을 따로 읽어 합치지 않음).
    expect(server.calls.filter(c => c.what === 'app_news_marks' && c.method === 'GET' && /starred_at/.test(c.query))).toEqual([]);

    // News로 돌아와도 ★ 켜진 채(기사에 읽을 거리 줄을 붙여 읽음).
    await openNews(page, width);
    await expect(item(page, 'c1').locator('.nw-star')).toHaveCount(1);
    expect(server.calls.filter(c => c.what === 'app_news_articles').at(-1).query).toContain('app_reading_items(id,saved_at)');

    // ③ 찾기 '보관한 글': 30일 넘은 옛 기사(o1)는 최근 기사 읽기에 없고, 읽을 거리 보관 줄로 찾는다.
    await page.locator('#outsideRoot [data-nw-find]').fill('보관낱말');
    await expect(item(page, 'o1')).toBeVisible();
    await expect(item(page, 'o1').locator('.nw-star')).toHaveCount(1);
    const keptQ = server.calls.filter(c => c.what === 'app_reading_items' && c.query.includes('app_news_articles!inner(')).at(-1)?.query || '';
    expect(keptQ).toContain('workspace_id=eq.w'); expect(keptQ).toContain('news_article_id=not.is.null'); expect(keptQ).toContain('app_news_articles.or=');
    await page.locator('#outsideRoot [data-nw-find]').fill('');

    // ④ 읽을 거리 ⋯ [보관 풀기] → 줄이 빠지고 서버 보관도 꺼짐, 5초 [되돌리기] → 같은 시각으로 원래 자리.
    const savedAt = server.items.find(i => i.id === 'c1').starred_at;
    await goReading(page, width);
    await rlist(page).locator('.rd-chips [data-filter-value="news"]').click();
    await rlist(page).locator('.rd-row[data-rd-news="news:c1"] [data-rd-more]').click();
    await expect(page.locator('#rdRowMenu button')).toHaveText(['News에서 열기', '보관 풀기']);
    await page.locator('#rdRowMenu button', { hasText: '보관 풀기' }).click();
    await expect(rlist(page).locator('.rd-row[data-rd-news="news:c1"]')).toHaveCount(0);
    expect(await noticeText(page)).toBe('보관에서 뺐어요');
    expect(server.items.find(i => i.id === 'c1').starred_at).toBeNull();
    expect(server.calls.filter(c => c.what === 'keep').at(-1).body).toMatchObject({ p_article: 'c1', p_on: false });
    await page.locator('#kptuNotice .kptu-notice-undo').click();
    await expect.poll(() => rows.evaluateAll(els => els.map(e => e.dataset.rdNews))).toEqual(['news:c1', 'news:o1']);
    expect(server.calls.filter(c => c.what === 'keep').at(-1).body).toEqual({ p_workspace: 'w', p_source: 'news', p_article: 'c1', p_on: true, p_saved_at: savedAt });
    expect(server.items.find(i => i.id === 'c1').starred_at).toBe(savedAt);

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
