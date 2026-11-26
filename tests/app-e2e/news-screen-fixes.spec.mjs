import { test, expect } from '@playwright/test';
import { start, openNews } from './helpers/news-server.mjs';
// S63-11(사용자 11/16 '3·5 고쳐'): ③ 본문은 저장돼 있는데 제목이 아직 '읽기 전'인 기사를 열면 서버 열기를 한 번 불러 제목을 채우고,
// 목록 줄과 상세 머리가 바로 새 제목. ⑤ PC 두 칸에서 탭을 옮겨 그 탭 목록에 없는 글이면 오른쪽에 남기지 않는다.
// 서버는 흉내(시계 2026-10-06 10:00 서울), 기사·주소는 모두 가짜(example.org).
const NOW_DETAIL = { ok: true, kind: 'now_detail', detail: { level: 'full', summary: '가짜 기사 한 줄 요약입니다.', key_sentences: [], relevance: null, implications: null, related: [], generated_at: '2026-10-06T01:00:00Z', context_at: null }, stale: false };
const row = page => page.locator('#newsRoot [data-nc-item="w1"]');
const detail = page => page.locator('#outsideRoot [data-now-detail]');

for (const width of [412, 1280]) {
  test(`뉴스 제목 반영 ${width}: 본문은 있고 읽기 전인 기사를 열면 목록·상세가 새 제목`, async ({ page }) => {
    test.setTimeout(60000);
    const { errors, server } = await start(page, width);
    let opened = 0;
    await page.route('**/rest/v1/app_news_article_bodies*', route => {
      const id = (new URL(route.request().url()).searchParams.get('article_id') || '').replace(/^eq\./, '');
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(id === 'w1' ? [{ state: 'ok', reason: null, blocks: [{ t: 'p', text: '저장된 가짜 본문.' }] }] : []) });
    });
    // S69-02: 넓은 화면은 첫 글(c1 — 피드 소개만 있고 원문 줄 없음)을 저절로 열며 그 글도 한 번 읽는다. 여기서는 누른 w1의 열기만 센다.
    await page.route('**/functions/v1/news-feed?action=open', route => {
      if (route.request().postDataJSON()?.id !== 'w1') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'stored' }) });
      opened++;
      Object.assign(server.items.find(i => i.id === 'w1'), { state: 'ok', title: '서버가 채운 가짜 제목' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'titled' }) });
    });
    await page.route('**/functions/v1/ai-assist', route => (route.request().postDataJSON()?.kind === 'now_detail' ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NOW_DETAIL) }) : route.fallback()));
    await openNews(page, width);
    await expect(row(page).locator('.nw-title')).toHaveText('가짜 대기 기사'); // S69: '제목 읽기 전' 없음 — 주소 경로 조각(S70-17b: 그것도 없으면 목록에서 빠진다)
    await row(page).locator('[data-nc-open="w1"]').click();
    const nd = detail(page).locator('.nd');
    await expect(nd.locator('[data-nd-prose]')).toHaveText('저장된 가짜 본문.');
    await expect(nd.locator('.nd-title')).toHaveText('서버가 채운 가짜 제목');
    expect(opened).toBe(1);
    if (width <= 760) await page.goBack();
    await expect(row(page).locator('.nw-title')).toHaveText('서버가 채운 가짜 제목');
    expect(errors).toEqual([]);
  });
}

test('PC 두 칸 1280: 탭을 옮겨 그 탭 목록에 없는 글이면 오른쪽에 남기지 않는다', async ({ page }) => {
  test.setTimeout(60000);
  const { errors } = await start(page, 1280);
  await page.route('**/functions/v1/ai-assist', route => (route.request().postDataJSON()?.kind === 'now_detail' ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NOW_DETAIL) }) : route.fallback()));
  await openNews(page, 1280);
  await page.locator('#newsRoot [data-nc-item="c1"] [data-nc-open="c1"]').click();
  await expect(detail(page).locator('.nd-title')).toHaveText('가짜 채널 기사');
  // [사회운동] 목록에는 이 기사가 없다 → 상세를 닫는다(글이 없는 목록이라 한 칸).
  await page.locator('#outsideRoot [data-os-tab="movement"]').click();
  await expect(detail(page).locator('.nd')).toHaveCount(0);
  await expect(page.locator('#outsideRoot')).not.toHaveAttribute('data-detail', 'open');
  await expect.poll(() => new URL(page.url()).searchParams.get('item')).toBeNull();
  // [전체]에는 같은 기사가 있으면 그대로 둔다.
  await page.locator('#outsideRoot [data-os-tab="media"]').click();
  await page.locator('#newsRoot [data-nc-item="c1"] [data-nc-open="c1"]').click();
  await page.locator('#outsideRoot [data-os-tab="all"]').click();
  await expect(page.locator('#outsideRoot [data-nw-all] [data-nw-key="news:c1"]')).toBeVisible();
  await expect(detail(page).locator('.nd-title')).toHaveText('가짜 채널 기사');
  expect(errors).toEqual([]);
});
