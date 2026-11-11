import { test, expect } from '@playwright/test';
import { start, openNews } from './helpers/news-server.mjs';
// S59-1 NEWS-키워드살리기(11/11 명진 결정): 키워드는 밖(구글 뉴스)에서 새로 찾지 않고, 받은 매체 글 가운데 서버가 keywords 칸에 적어 둔 글을
// ⋯ [키워드 수정] 칸의 키워드 줄 아래에 켠 키워드마다 모아 보인다(새 것부터 20건, 같은 매체 연달아는 접기). 누르면 공용 상세.
// 서버는 흉내 낸다(시계 2026-10-06 10:00 서울). 기사·매체·주소는 모두 가짜(example.org).
const root = page => page.locator('#newsRoot');
const hits = page => root(page).locator('[data-nc-kw-hits]');
const noWideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const media = (id, title, keywords, at) => ({ id, lane: 'media', url: `https://example.org/${id}`, title, lang: 'ko', publisher: '가짜노동신문', source_key: 'news-fake-a', keywords,
  published_at: at, scrapped_at: null, created_at: at, state: 'ok', summary: '가짜 요약.', body_kind: null, title_ko: null, translated_at: null, starred_at: null, folder_id: null });

for (const width of [412, 1280]) {
  test(`News [언론] ${width}: 키워드 수정 칸 아래에 켠 키워드마다 받은 글이 모이고, 켜고 끄면 묶음이 따라 바뀐다`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, server } = await start(page, width);
    server.items.push(media('m1', '가짜 철도 파업 기사', ['가짜어', '꺼진말'], '2026-10-06T00:30:00Z'), media('m2', '가짜 꺼진말 기사', ['꺼진말'], '2026-10-06T00:20:00Z'));
    server.keywords = [{ word: '가짜어', enabled: true, created_at: '2026-10-01T00:00:00Z' }, { word: '꺼진말', enabled: false, created_at: '2026-10-02T00:00:00Z' },
      { word: '새말', enabled: true, created_at: '2026-10-03T00:00:00Z' }];
    await openNews(page, width);
    await page.locator('#outsideRoot [data-os-more]').click();
    await page.locator('#osMenu').getByRole('button', { name: '키워드 수정' }).click();
    await expect(root(page).locator('[data-nc-kw]')).toHaveCount(3);
    // 켠 키워드만, 걸린 글이 있는 것만 묶음(꺼진말은 꺼짐, 새말은 아직 걸린 글 없음). 머리 글자 = 키워드 · 건수 · 새 글.
    await expect(hits(page).locator('.nw-day-head')).toHaveText(['가짜어 · 2건 · 새 글 2']);
    await expect(hits(page).locator('[data-nc-kw-item]')).toHaveCount(2);
    await expect(hits(page).locator('[data-nc-kw-item="m1"] .nw-title')).toHaveText('가짜 철도 파업 기사');
    // 읽기는 켠 키워드마다 한 번: 자기 작업공간·지우지 않은 줄·keywords 칸에 그 낱말이 있는 글만. 꺼진 키워드는 묻지 않는다.
    const kwReads = () => server.calls.filter(c => c.what === 'app_news_items' && c.method === 'GET' && c.query.includes('keywords=cs.')).map(c => c.query);
    await expect.poll(() => kwReads().length).toBe(2);
    for (const q of kwReads()) { expect(q).toContain('workspace_id=eq.w'); expect(q).toContain('hidden_at=is.null'); expect(q).toContain('limit=21'); }
    expect(kwReads().some(q => q.includes('keywords=cs.{"가짜어"}'))).toBe(true);
    expect(kwReads().some(q => q.includes('꺼진말'))).toBe(false);
    expect(await noWideScroll(page)).toBe(true);
    if (process.env.S59_SHOT) await page.screenshot({ path: `${process.env.S59_SHOT}/keyword-hits-${width}.png`, fullPage: false });

    // 누르면 공용 상세(목록과 같은 길). 폰은 뒤로 키 한 번이면 이 칸으로 돌아온다.
    await hits(page).locator('[data-nc-kw-item="m1"] [data-nc-open="m1"]').click();
    await expect(page.locator('#outsideRoot [data-now-detail] .nd .nd-title')).toHaveText('가짜 철도 파업 기사');
    if (width <= 760) {
      await page.goBack();
      await expect(hits(page).locator('[data-nc-kw-item="m1"]')).toBeVisible();
    }

    // 꺼진말을 켜면 그 묶음이 생기고, 가짜어를 끄면 그 묶음이 빠진다(서버 저장).
    await root(page).locator('[data-nc-kw="꺼진말"]').click();
    await expect(root(page).locator('[data-nc-kw="꺼진말"]')).toHaveAttribute('aria-checked', 'true');
    await expect(hits(page).locator('.nw-day-head')).toHaveText([/^가짜어 · 2건/, /^꺼진말 · 2건/]);
    await root(page).locator('[data-nc-kw="가짜어"]').click();
    await expect(root(page).locator('[data-nc-kw="가짜어"]')).toHaveAttribute('aria-checked', 'false');
    await expect(hits(page).locator('.nw-day-head')).toHaveText([/^꺼진말 · 2건/]);
    // 걸린 글이 있는 켠 키워드를 모두 끄면 '키워드에 걸린 글 없음' 한 줄(새말은 켜져 있지만 걸린 글 없음).
    await root(page).locator('[data-nc-kw="꺼진말"]').click();
    await expect(root(page).locator('[data-nc-kw="꺼진말"]')).toHaveAttribute('aria-checked', 'false');
    await expect(hits(page).locator('[data-nc-kw-empty]')).toHaveText('키워드에 걸린 글 없음');
    // 뒤로 = 목록. 키워드 칸 줄은 목록 줄과 섞이지 않는다.
    await page.goBack();
    await expect(root(page).locator('[data-nc-kw-hits]')).toHaveCount(0);
    await expect(root(page).locator('[data-nc-item]')).toHaveCount(7);
    expect(errors).toEqual([]);
  });
}
