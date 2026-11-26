import { test, expect } from '@playwright/test';
import { start, openNews } from './helpers/news-server.mjs';
// S68-52(사용자 11/23 14:48 "원문 다시 가져오기를 글 눌렀을 때도 / 버튼 눌러도 원문 못 가져옴 조선일보 저 기사"): 유료벽이 아닌데 본문 칸을 못 뽑아
// 메타 설명(리드)만 남은 뉴스 기사(lead·no_body — 문단이 페이지 스크립트 데이터에 있는 매체)도 원문 칸 까닭 줄 끝에 [원문 다시 가져오기].
// 누르면 서버 news-feed open(기사 id만)을 한 번 부르고, 전문이 오면 본문으로 바꾼다. 또 앞부분이면 단추를 거두고 한 줄(요약을 다시 만들지 않음).
// 유료벽 리드(lead·paywall)에는 단추가 없다. 서버는 흉내, 기사·주소는 모두 가짜(example.org).
const NOW_DETAIL = { ok: true, kind: 'now_detail', detail: { level: 'full', summary: '가짜 요약.', key_sentences: [], relevance: null, implications: null, related: [], generated_at: '2026-11-23T01:00:00Z', context_at: null }, stale: false };
const detail = page => page.locator('#outsideRoot [data-now-detail] .nd');
const row = (page, id) => page.locator(`#newsRoot [data-nc-item="${id}"]`);
const base = { lane: 'channel', title: '가짜 리드만 기사', lang: 'ko', publisher: '가짜일보', source_key: null, keywords: [], published_at: '2026-11-12T00:00:00Z', scrapped_at: '2026-11-12T00:40:00Z', created_at: '2026-11-12T00:41:00Z',
  state: 'ok', summary: '가짜 공개 리드 한 줄.', body_kind: 'lead', title_ko: null, translated_at: null, starred_at: null, folder_id: null, _body: '가짜 공개 리드 한 줄.', author: null, manual_at: null };
const LEAD = { state: 'lead', reason: 'no_body', blocks: [{ t: 'p', text: '가짜 공개 리드 한 줄.' }] };

async function setup(page, width, { reason = 'no_body', after = 'ok' } = {}) {
  const { errors, server } = await start(page, width);
  server.items.unshift({ ...base, id: 'l1', url: 'https://www.example.org/l1' });
  const bodies = { l1: { ...LEAD, reason } };
  const opens = [], ai = [];
  await page.route('**/rest/v1/app_news_article_bodies*', route => {
    const id = (new URL(route.request().url()).searchParams.get('article_id') || '').replace(/^eq\./, '');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bodies[id] ? [bodies[id]] : []) });
  });
  await page.route('**/functions/v1/news-feed?action=open', async route => {
    const id = route.request().postDataJSON()?.id;
    opens.push(route.request().postDataJSON());
    const it = server.items.find(i => i.id === id);
    if (after === 'ok') {
      Object.assign(it, { body_kind: 'full', _body: '가짜 전문 첫 문단.\n가짜 전문 둘째 문단.' });
      bodies[id] = { state: 'ok', reason: null, blocks: [{ t: 'p', text: '가짜 전문 첫 문단.' }, { t: 'p', text: '가짜 전문 둘째 문단.' }] };
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: after === 'ok' ? 'ok' : 'lead' }) });
  });
  await page.route('**/functions/v1/ai-assist', route => {
    const b = route.request().postDataJSON();
    if (b?.kind !== 'now_detail') return route.fallback();
    ai.push(b.news_item_id);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NOW_DETAIL) });
  });
  await openNews(page, width);
  await expect(row(page, 'l1')).toBeVisible();
  await row(page, 'l1').locator('[data-nc-open="l1"]').click();
  return { errors, opens, ai };
}

for (const width of [412, 1280]) {
  test(`리드만 남은 뉴스 기사 ${width}: [원문 다시 가져오기] → 그 기사 하나만 다시 읽어 전문`, async ({ page }) => {
    test.setTimeout(60000);
    const { errors, opens } = await setup(page, width);
    const nd = detail(page);
    await expect(nd.locator('[data-nd-prose] p')).toHaveText(['가짜 공개 리드 한 줄.']);
    const btn = nd.locator('[data-nd-body] [data-nd-why]').getByRole('button', { name: '원문 다시 가져오기' });
    await expect(btn).toBeVisible();
    expect(opens, '열기만으로는 다시 읽지 않는다').toEqual([]);
    await btn.click();
    await expect.poll(() => opens).toEqual([{ id: 'l1' }]);
    await expect(nd.locator('[data-nd-prose] p')).toHaveText(['가짜 전문 첫 문단.', '가짜 전문 둘째 문단.']);
    await expect(nd.locator('[data-nd-body] [data-nd-why]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('리드만 남은 뉴스 기사: 다시 읽어도 앞부분이면 한 줄(단추는 그대로 — S69-02), 요약은 다시 만들지 않음', async ({ page }) => {
  test.setTimeout(60000);
  const { errors, opens, ai } = await setup(page, 1280, { after: 'lead' });
  const why = detail(page).locator('[data-nd-body] [data-nd-why]');
  await expect(detail(page).locator('.nd-sum')).toHaveText('가짜 요약.');
  const aiBefore = ai.length;
  await why.getByRole('button', { name: '원문 다시 가져오기' }).click();
  await expect.poll(() => opens.length).toBe(1);
  await expect(why.locator('[data-nd-refetch-note]')).toHaveText('다시 읽어도 사이트가 본문을 주지 않아요');
  await expect(why.getByRole('button', { name: '원문 다시 가져오기' })).toBeVisible();
  await expect(detail(page).locator('[data-nd-prose] p')).toHaveText(['가짜 공개 리드 한 줄.']);
  await page.waitForTimeout(300);
  expect(ai.length).toBe(aiBefore);
  expect(errors).toEqual([]);
});

// S69-02(사용자 11/24 "글 안에서도 원문 다시 불러오기 버튼"): 유료벽 리드에도 단추는 있다(누르면 서버가 다시 읽되 유료벽은 넘지 않음). 열기만으로는 읽지 않는다.
test('유료벽 리드(lead·paywall) 뉴스 기사에도 까닭 줄 단추가 있다(열 때 저절로 읽지는 않음)', async ({ page }) => {
  test.setTimeout(60000);
  const { opens } = await setup(page, 1280, { reason: 'paywall', after: 'lead' });
  const nd = detail(page);
  await expect(nd.locator('[data-nd-prose] p')).toHaveText(['가짜 공개 리드 한 줄.']);
  const btn = nd.locator('[data-nd-body] [data-nd-why]').getByRole('button', { name: '원문 다시 가져오기' });
  await expect(btn).toBeVisible();
  expect(opens).toEqual([]);
  await btn.click();
  await expect.poll(() => opens).toEqual([{ id: 'l1' }]);
});
