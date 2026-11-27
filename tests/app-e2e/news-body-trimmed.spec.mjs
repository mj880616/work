import { test, expect } from '@playwright/test';
import { start, openNews } from './helpers/news-server.mjs';
// S73-01 NEWS-본문하루(사용자 결정 2026-11-27 17:34 "하루 지난 기사는 원래 사이트에서 읽으면 된다"):
// 매일 정리(public.app_news_trim_bodies)가 본문을 비운 기사는 블록 줄이 비운 표시 줄(rule trim@1, failed·no_body)이다.
// 글 보기 원문 칸: 까닭 한 줄 '지난 기사라 본문은 보관하지 않아요 · 원래 사이트 ↗'(기존 원래 사이트 링크 부품), 새 큰 단추 없음.
// 까닭 줄 [원문 다시 가져오기]·[직접 넣기] 없음, 열 때 저절로 다시 읽지 않음(news-feed open 안 부름). 요약(남긴 요약 재료)은 그대로 보인다.
// 서버는 흉내(모두 가짜 example.org).
const detail = page => page.locator('#outsideRoot [data-now-detail] .nd');
const row = (page, id) => page.locator(`#newsRoot [data-nc-item="${id}"]`);
const NOW_DETAIL = { ok: true, kind: 'now_detail', detail: { level: 'full', summary: '가짜 남긴 요약.', key_sentences: [], relevance: null, implications: null, related: [], generated_at: '2026-10-06T01:00:00Z', context_at: null }, stale: false };

for (const width of [412, 1280]) {
  test(`본문을 비운 지난 기사 ${width}: 까닭 한 줄 + 원래 사이트 링크, 다시 읽지 않음`, async ({ page }, info) => {
    test.setTimeout(60000);
    const { errors } = await start(page, width);
    const opens = [];
    await page.route('**/rest/v1/app_news_article_bodies*', route => {
      const id = (new URL(route.request().url()).searchParams.get('article_id') || '').replace(/^eq\./, '');
      const body = id === 'c1' ? [{ state: 'failed', reason: 'no_body', rule: 'trim@1', blocks: [] }] : [];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.route('**/functions/v1/news-feed?action=open', route => { opens.push(1); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'ok' }) }); });
    await page.route('**/functions/v1/ai-assist', route => {
      const b = route.request().postDataJSON();
      if (b?.kind !== 'now_detail') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NOW_DETAIL) });
    });
    await openNews(page, width);
    await row(page, 'c1').locator('[data-nc-open="c1"]').click();
    const nd = detail(page);
    const why = nd.locator('[data-nd-why]');
    await expect(why).toContainText('지난 기사라 본문은 보관하지 않아요');
    await expect(why.locator('a[data-nd-link]')).toHaveAttribute('href', 'https://example.org/c1');
    await expect(why.locator('a[data-nd-link]')).toHaveText('원래 사이트 ↗');
    await expect(nd.locator('[data-nd-refetch]')).toHaveCount(0);
    await expect(nd.locator('[data-nd-hand]')).toHaveCount(0);
    await expect(nd.locator('[data-nd-prose]')).toHaveCount(0);
    await expect(nd.locator('[data-nd-translate]')).toHaveCount(0);
    await expect(nd).toContainText('가짜 남긴 요약.');
    await expect(nd.locator('.nd-title')).toHaveText('가짜 채널 기사');
    expect(opens).toHaveLength(0);
    await page.screenshot({ path: info.outputPath(`news-body-trimmed-${width}.png`) });
    expect(errors).toEqual([]);
  });
}
