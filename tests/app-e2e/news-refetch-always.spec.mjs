import { test, expect } from '@playwright/test';
import { start, openNews } from './helpers/news-server.mjs';
// S69-02(사용자 11/24 06:40·06:43): 수집 때 본문을 읽지 않는 매체(조선일보 등) 기사는 피드 소개(리드)만 있고 저장 원문 줄이 없었다 —
// 글 보기에 '공개된 앞부분만'만 보이고 [원문 다시 가져오기]도 없었다. 이제
// ① 그런 기사(원문 줄 없음·전문 아님)는 열 때 한 번 서버 news-feed open으로 읽어 전문을 그린다.
// ② 그래도 못 읽으면 까닭 줄 끝에 [원문 다시 가져오기]가 있다(옛 글 글자로 그린 경우도).
// ③ 다 읽은 글은 원문 칸 ⋯ 메뉴에 [원문 다시 가져오기] — 누르면 {id, again:true}로 한 번, 더 긴 전문이면 바뀐다.
// 읽을 거리(News 목록)와 저장한 글(읽을 거리 보관 줄 → News 글 보기) 두 길에서 같은 글 보기다. 서버는 흉내, 기사·주소는 모두 가짜(example.org).
const NOW_DETAIL = { ok: true, kind: 'now_detail', detail: { level: 'full', summary: '가짜 요약.', key_sentences: [], relevance: null, implications: null, related: [], generated_at: '2026-11-24T01:00:00Z', context_at: null }, stale: false };
const detail = page => page.locator('#outsideRoot [data-now-detail] .nd');
const row = (page, id) => page.locator(`#newsRoot [data-nc-item="${id}"]`);
const LEAD_ITEM = { id: 'x1', lane: 'media', url: 'https://www.example.org/x1', title: '가짜 리드뿐 기사', lang: 'ko', publisher: '가짜일보', source_key: 'news-fake-b', keywords: [], published_at: '2026-11-12T02:04:00Z', scrapped_at: null,
  created_at: '2026-11-12T02:10:00Z', state: 'ok', summary: '가짜 소개 한 문단.', body_kind: 'lead', title_ko: null, translated_at: null, starred_at: '2026-11-24T00:00:00Z', folder_id: null, _body: '가짜 소개 한 문단.', author: null, manual_at: null };

async function setup(page, width, { openResult = 'full', item = LEAD_ITEM, bodies0 = {} } = {}) {
  const { errors, server } = await start(page, width);
  server.items.unshift({ ...item });
  const bodies = { ...bodies0 };
  const opens = [];
  await page.route('**/rest/v1/app_news_article_bodies*', route => {
    const id = (new URL(route.request().url()).searchParams.get('article_id') || '').replace(/^eq\./, '');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bodies[id] ? [bodies[id]] : []) });
  });
  await page.route('**/functions/v1/news-feed?action=open', route => {
    const b = route.request().postDataJSON();
    opens.push(b);
    const it = server.items.find(i => i.id === b.id);
    if (openResult === 'full') {
      Object.assign(it, { body_kind: 'full', _body: '가짜 전문 첫 문단.\n가짜 전문 둘째 문단.' });
      bodies[b.id] = { state: 'ok', reason: null, blocks: [{ t: 'p', text: '가짜 전문 첫 문단.' }, { t: 'h', text: '가짜 소제목' }, { t: 'p', text: '가짜 전문 둘째 문단.' }] };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'ok' }) });
    }
    if (openResult === 'longer') {
      bodies[b.id] = { state: 'ok', reason: null, blocks: [...bodies[b.id].blocks, { t: 'p', text: '가짜 더 읽은 문단.' }] };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'ok' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'error' }) });
  });
  await page.route('**/functions/v1/ai-assist', route => {
    const b = route.request().postDataJSON();
    if (b?.kind !== 'now_detail') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NOW_DETAIL) });
  });
  return { errors, server, opens, bodies };
}
async function openFromNews(page, width, id = 'x1') {
  await openNews(page, width);
  await expect(row(page, id)).toBeVisible();
  await row(page, id).locator(`[data-nc-open="${id}"]`).click();
}

for (const width of [412, 1280]) {
  test(`읽을 거리 ${width}: 원문 줄 없는 리드뿐 기사 → 열 때 한 번 읽어 전문(문단·소제목), 그 뒤 ⋯ [원문 다시 가져오기]`, async ({ page }) => {
    test.setTimeout(60000);
    const { errors, opens } = await setup(page, width);
    await openFromNews(page, width);
    const nd = detail(page);
    await expect(nd.locator('[data-nd-prose] > *')).toHaveText(['가짜 전문 첫 문단.', '가짜 소제목', '가짜 전문 둘째 문단.']);
    expect(opens).toEqual([{ id: 'x1' }]);
    await expect(nd.locator('[data-nd-body] [data-nd-why]')).toHaveCount(0);
    await nd.locator('[data-nd-ob-more]').click();
    await expect(page.locator('#ndObMenu [data-nd-menu="refetch"]')).toHaveText('원문 다시 가져오기');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('읽을 거리: 열 때 읽어도 못 가져오면 까닭 줄 끝에 [원문 다시 가져오기](원문 줄 없는 옛 글 모양에도) → 누르면 그 기사 하나만', async ({ page }) => {
  test.setTimeout(60000);
  const { opens } = await setup(page, 1280, { openResult: 'error' });
  await openFromNews(page, 1280);
  const nd = detail(page);
  const why = nd.locator('[data-nd-body] [data-nd-why]');
  await expect(why).toContainText('공개된 앞부분만');
  const btn = why.getByRole('button', { name: '원문 다시 가져오기' });
  await expect(btn).toBeVisible();
  await expect.poll(() => opens.length).toBe(1);
  await btn.click();
  await expect.poll(() => opens.length).toBe(2);
  expect(opens[1]).toEqual({ id: 'x1' });
  await expect(why.getByRole('button', { name: '원문 다시 가져오기' })).toBeVisible();
});

test('읽을 거리: 다 읽은 글 ⋯ [원문 다시 가져오기] → {id, again:true}로 한 번, 더 긴 전문이면 바뀐다', async ({ page }) => {
  test.setTimeout(60000);
  const full = { ...LEAD_ITEM, body_kind: 'full', _body: '가짜 옛 전문.' };
  const { opens } = await setup(page, 1280, { openResult: 'longer', item: full, bodies0: { x1: { state: 'ok', reason: null, blocks: [{ t: 'p', text: '가짜 옛 전문.' }] } } });
  await openFromNews(page, 1280);
  const nd = detail(page);
  await expect(nd.locator('[data-nd-prose] p')).toHaveText(['가짜 옛 전문.']);
  expect(opens).toEqual([], '다 읽은 글은 열 때 읽지 않음');
  await nd.locator('[data-nd-ob-more]').click();
  await page.locator('#ndObMenu [data-nd-menu="refetch"]').click();
  await expect.poll(() => opens).toEqual([{ id: 'x1', again: true }]);
  await expect(nd.locator('[data-nd-prose] p')).toHaveText(['가짜 옛 전문.', '가짜 더 읽은 문단.']);
});

test('저장한 글 → News 글 보기: 같은 글 보기에서 같은 단추(못 읽은 글은 까닭 줄 단추)', async ({ page }) => {
  test.setTimeout(60000);
  // 저장한 글의 News 연결 칸은 uuid만 받는다(reading-model isId) — 이 시험의 기사 id는 uuid.
  const AID = 'd6900000-0000-4000-8000-000000000201';
  const { opens, server } = await setup(page, 1280, { openResult: 'error', item: { ...LEAD_ITEM, id: AID } });
  const RID = 'a6900000-0000-4000-8000-000000000201';
  const readRow = { id: RID, url: LEAD_ITEM.url, title: LEAD_ITEM.title, site: '가짜일보', saved_at: '2026-11-24T00:00:00Z', read_at: null, body_state: 'paywall', body_at: '2026-11-24T00:00:10Z',
    business_area_id: null, updated_at: '2026-11-24T00:00:10Z', origin: 'news', news_article_id: AID, outside_article_id: null, body: '가짜 소개 한 문단.' };
  // 저장한 글이 News 연결 줄을 News 글 보기로 여는 것은 News 기능 키가 있을 때만(운영자 계정 흉내).
  await page.route('**/rest/v1/rpc/app_my_features', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(['outside']) }));
  await page.route('**/rest/v1/app_reading_items*', route => {
    const u = new URL(route.request().url());
    if (route.request().method() !== 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([readRow]) });
    if (u.searchParams.has('news_article_id')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: RID, saved_at: readRow.saved_at }]) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([readRow]) });
  });
  await page.locator('#appView>.app-nav').getByRole('link', { name: '저장한 글', exact: true }).click();
  await expect(page.locator('#readingView')).toBeVisible();
  await page.locator(`#readingView .rd-row[data-rd-open="${RID}"]`).click();
  // S70-58 READ-두칸보기: PC 두 칸은 줄을 누르면 오른쪽 칸 — 읽을 거리 글 보기는 글 보기 머리 ⋯ [읽을 거리에서 보기].
  await page.locator('#readingView [data-rd-detail] [data-rd-head-more]').click();
  await page.locator('#rdRowMenu [data-rd-act="news"]').click();
  await expect(page.locator('#outsideView')).toBeVisible();
  const nd = detail(page);
  const why = nd.locator('[data-nd-body] [data-nd-why]');
  await expect(why.getByRole('button', { name: '원문 다시 가져오기' })).toBeVisible();
  await expect.poll(() => opens.length).toBe(1);
  expect(opens[0]).toEqual({ id: AID });
  expect(server.items.find(i => i.id === AID)).toBeTruthy();
});
