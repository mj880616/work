import { test, expect } from '@playwright/test';
import { start, openNews } from './helpers/news-server.mjs';
// S68-25(사용자 11/22 "그냥 너도 다 해"): 원문 읽기는 robots.txt를 보지 않는다. 예전에 robots 때문에 원문이 빈 기사를 열면
// '원문을 읽어 오는 중' 한 줄 → 서버 news-feed open(그 기사 하나만) → 기존 원문 칸에 저장된 원문을 보인다. 다시 열면 저장본(다시 읽지 않음).
// 실패하면 까닭 한 줄 + [원래 사이트 ↗]. 목록을 열 때 여러 글을 한꺼번에 읽지 않는다. 서버는 흉내, 기사·주소는 모두 가짜(example.org).
const NOW_DETAIL = { ok: true, kind: 'now_detail', detail: { level: 'full', summary: '가짜 원문으로 만든 가짜 요약.', key_sentences: [], relevance: null, implications: null, related: [], generated_at: '2026-10-06T01:00:00Z', context_at: null }, stale: false };
const detail = page => page.locator('#outsideRoot [data-now-detail] .nd');
const row = (page, id) => page.locator(`#newsRoot [data-nc-item="${id}"]`);
const base = { lane: 'channel', title: null, lang: 'ko', publisher: null, source_key: null, keywords: [], published_at: null, scrapped_at: '2026-10-06T00:40:00Z', created_at: '2026-10-06T00:41:00Z', state: 'robots', summary: null, body_kind: null, title_ko: null, translated_at: null, starred_at: null, folder_id: null, _body: null, author: null, manual_at: null };

async function setup(page, width, { fail = false } = {}) {
  const { errors, server } = await start(page, width);
  // S70-17b: 제목을 끝내 못 얻은 줄은 목록에서 빠지므로 주소 경로에 읽을 만한 조각을 둔다(목록 제목 = 그 조각).
  server.items.unshift({ ...base, id: 'r1', url: 'https://www.example.org/news/fake-blocked-story-one' }, { ...base, id: 'r2', url: 'https://www.example.org/news/fake-blocked-story-two' });
  const bodies = { r1: { state: 'failed', reason: 'robots', blocks: [] }, r2: { state: 'failed', reason: 'robots', blocks: [] } };
  const opens = [];
  let release;
  const gate = new Promise(r => { release = r; });
  await page.route('**/rest/v1/app_news_article_bodies*', route => {
    const id = (new URL(route.request().url()).searchParams.get('article_id') || '').replace(/^eq\./, '');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bodies[id] ? [bodies[id]] : []) });
  });
  await page.route('**/functions/v1/news-feed?action=open', async route => {
    const id = route.request().postDataJSON()?.id;
    opens.push(id);
    await gate; // '읽어 오는 중' 줄을 볼 때까지 붙잡는다
    const it = server.items.find(i => i.id === id);
    if (fail) {
      Object.assign(it, { state: 'failed' });
      bodies[id] = { state: 'failed', reason: 'http_4xx', blocks: [] };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'failed' }) });
    }
    Object.assign(it, { state: 'ok', title: '가짜 기사 제목', body_kind: 'full', _body: '가짜 원문 첫 문단.\n가짜 원문 둘째 문단.' });
    bodies[id] = { state: 'ok', reason: null, blocks: [{ t: 'p', text: '가짜 원문 첫 문단.' }, { t: 'p', text: '가짜 원문 둘째 문단.' }] };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'ok' }) });
  });
  await page.route('**/functions/v1/ai-assist', route => {
    const b = route.request().postDataJSON();
    if (b?.kind !== 'now_detail') return route.fallback();
    const it = server.items.find(i => i.id === b.news_item_id);
    if (!it?.body_kind && !it?.summary) return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'no_material' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NOW_DETAIL) });
  });
  await openNews(page, width);
  return { errors, opens, release };
}

for (const width of [412, 1280]) {
  test(`robots로 비어 있던 기사 ${width}: 열면 그 한 쪽만 읽어 와 원문을 보이고, 다시 열면 읽지 않는다`, async ({ page }, info) => {
    test.setTimeout(60000);
    const { errors, opens, release } = await setup(page, width);
    await expect(row(page, 'r1')).toBeVisible();
    // 목록을 열 때 여러 글을 한꺼번에 읽지 않는다(넓은 화면은 맨 위 글 상세가 바로 열려 그 한 글만).
    expect(opens.filter(id => id !== 'r1'), '목록을 열 때는 다른 글을 읽지 않는다').toEqual([]);
    await row(page, 'r1').locator('[data-nc-open="r1"]').click();
    const nd = detail(page);
    await expect(nd.locator('[data-nd-fetching]')).toHaveText('원문을 읽어 오는 중');
    // '읽어 오는 중' 줄은 요청을 보내기 직전에 그려진다 — 요청이 가로채기에 닿을 때까지 기다려 본다(바쁜 러너에서 빈 배열로 보이던 경합, S68-43).
    await expect.poll(() => opens).toEqual(['r1']);
    if (width === 412) await page.screenshot({ path: info.outputPath('robots-open-fetching-412.png') });
    release();
    await expect(nd.locator('[data-nd-prose] p')).toHaveText(['가짜 원문 첫 문단.', '가짜 원문 둘째 문단.']);
    await expect(nd.locator('[data-nd-fetching]')).toHaveCount(0);
    expect(opens).toEqual(['r1']);
    await page.screenshot({ path: info.outputPath(`robots-open-done-${width}.png`) });
    // 다시 열기: 저장된 원문 그대로(서버 열기 없음).
    if (width <= 760) await page.goBack();
    await row(page, 'r1').locator('[data-nc-open="r1"]').click();
    await expect(detail(page).locator('[data-nd-prose] p').first()).toHaveText('가짜 원문 첫 문단.');
    expect(opens, '다시 열면 읽지 않고, 다른 글도 읽지 않는다').toEqual(['r1']);
    expect(errors).toEqual([]);
  });
}

test('robots로 비어 있던 기사 412: 읽어 와도 실패하면 까닭 한 줄 + [원래 사이트 ↗]', async ({ page }) => {
  test.setTimeout(60000);
  const { errors, opens, release } = await setup(page, 412, { fail: true });
  release();
  await row(page, 'r2').locator('[data-nc-open="r2"]').click();
  const why = detail(page).locator('[data-nd-body] [data-nd-why]');
  await expect(why).toContainText('사이트에서 글을 찾지 못함');
  await expect(why.getByRole('link', { name: /원래 사이트/ })).toHaveAttribute('href', 'https://www.example.org/news/fake-blocked-story-two');
  await expect(detail(page).locator('[data-nd-prose]')).toHaveCount(0);
  expect(opens).toEqual(['r2']);
  expect(errors).toEqual([]);
});
