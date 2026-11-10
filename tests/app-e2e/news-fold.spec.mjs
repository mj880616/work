import { test, expect } from '@playwright/test';
import { start, openNews } from './helpers/news-server.mjs';
// NEWS-도배막기(명진 11/09, 결정 11/10 A + C): News 목록에서
//  A. 같은 언론 매체가 연달아 나오면 첫 기사 한 줄 + 작게 '○○ 외 N건'(누르면 그 자리에서 펼침·다시 누르면 접힘, 다시 그려도 그대로).
//     단체 성명·논평 줄은 묶지 않는다.
//  C. 확정 관심 주제에 걸린 최근 글은 위 칸 '관심 주제'에 먼저(시간순), 나머지는 아래 날짜별 시간순.
// [전체]·[언론] 두 탭이 같은 규칙(app/news-fold.mjs). 서버는 흉내(시계 2026-10-06 10:00 서울). 기사·단체·주제는 모두 가짜.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const news = (id, source_key, publisher, minute, title) => ({ id, lane: 'media', url: `https://example.org/${id}`, title, lang: 'ko', publisher, source_key, keywords: [],
  published_at: `2026-10-06T00:${minute}:00Z`, scrapped_at: null, created_at: `2026-10-06T00:${minute}:00Z`, state: 'ok', summary: '가짜 요약.', body_kind: null, title_ko: null, translated_at: null, starred_at: null, folder_id: null, _body: null });
// 시간순(최신 먼저): 가짜일보 넷 연달아 → 단체 성명 둘 → 가짜노동신문 하나 → 가짜일보 하나. 관심 주제 '가짜주제'에 걸린 기사는 맨 아래 시각.
const ITEMS = [
  news('b1', 'news-fake-b', '가짜일보', '50', '가짜일보 기사 하나'),
  news('b2', 'news-fake-b', '가짜일보', '49', '가짜일보 기사 둘'),
  news('b3', 'news-fake-b', '가짜일보', '48', '가짜일보 기사 셋'),
  news('b4', 'news-fake-b', '가짜일보', '47', '가짜일보 기사 넷'),
  news('a1', 'news-fake-a', '가짜노동신문', '30', '가짜노동신문 기사'),
  news('b5', 'news-fake-b', '가짜일보', '20', '가짜일보 기사 다섯'),
  news('h1', 'news-fake-a', '가짜노동신문', '05', '가짜주제 관련 기사'),
];
const post = (id, minute, title) => ({ id, source_key: 'kctu', kind: 'statement', lang: 'ko', title, title_ko: null, url: `https://example.org/s/${id}`, published_at: `2026-10-06T00:${minute}:00Z`, fetched_at: `2026-10-06T00:${minute}:00Z`, summary_ko: '가짜 성명 요약.', key_sentences: [], has_body: false, author: null });
const POSTS = [post('s1', '40', '[성명] 가짜 성명 하나'), post('s2', '39', '[성명] 가짜 성명 둘')];

async function begin(page, width) {
  const { errors, server } = await start(page, width);
  server.items = ITEMS.map(x => ({ ...x }));
  server.sources.set('kctu', { source_key: 'kctu', enabled: true, last_ok_at: '2026-10-06T00:07:00Z', last_error: null });
  // 사회운동 글·확정 관심 주제(나중에 단 길이 먼저 잡는다).
  await page.route(SB + '/rest/v1/app_outside_posts**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(POSTS) }));
  await page.route(SB + '/rest/v1/app_now_interests**', route => (route.request().method() === 'GET'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'i1', topic: '가짜주제', state: 'confirmed', origin: 'user', reason: null, decided_at: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z' }]) })
    : route.fallback()));
  return { errors, server };
}
const keysIn = (page, sel) => page.locator(`${sel} [data-nw-key]:visible`).evaluateAll(els => els.map(el => el.dataset.nwKey));
const noWideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const width of [390, 884, 1440]) {
  test(`News 도배막기 ${width}: 같은 매체 연달아 → '외 N건' 한 줄, 성명은 그대로, 관심 주제 글 위로 · [전체]·[언론] 같은 규칙`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors } = await begin(page, width);
    await openNews(page, width);

    // [언론]: 위 칸 '관심 주제'(걸린 기사) → 오늘 묶음. 가짜일보 넷은 첫 줄 + '가짜일보 외 3건'.
    const media = '#newsRoot';
    await expect(page.locator(`${media} .nw-day-head`)).toHaveText([/^관심 주제/, /^오늘/]);
    await expect.poll(() => keysIn(page, media)).toEqual(['news:h1', 'news:b1', 'news:a1', 'news:b5']);
    const fold = page.locator(`${media} details[data-nw-fold="fold:news:b1"]`);
    await expect(fold.locator('summary')).toHaveText('가짜일보 외 3건');
    expect(await noWideScroll(page)).toBe(true);
    // 누르면 그 자리에서 펼침 → 묶인 기사 다 보임. 다시 그려도(관심 주제 다시 읽기 등) 펼친 그대로.
    await fold.locator('summary').click();
    await expect.poll(() => keysIn(page, media)).toEqual(['news:h1', 'news:b1', 'news:b2', 'news:b3', 'news:b4', 'news:a1', 'news:b5']);
    await page.evaluate(() => window.KPTUNews.repaint());
    await expect(page.locator(`${media} details[data-nw-fold="fold:news:b1"]`)).toHaveAttribute('open', '');
    // 다시 누르면 접힘.
    await page.locator(`${media} details[data-nw-fold="fold:news:b1"] summary`).click();
    await expect.poll(() => keysIn(page, media)).toEqual(['news:h1', 'news:b1', 'news:a1', 'news:b5']);
    // 펼친 묶음 안 기사도 키보드로 연다(줄 단추 그대로).
    await page.locator(`${media} details[data-nw-fold="fold:news:b1"] summary`).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(`${media} [data-nw-key="news:b3"]`)).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator(`${media} [data-nw-key="news:b3"]`)).toBeHidden();

    // [전체]: 성명·논평과 여러 매체 기사가 섞여 보이고, 성명 둘은 연달아도 묶지 않는다. 관심 주제 기사는 위.
    await page.locator('#outsideRoot [data-os-tab="all"]').click();
    const all = '#outsideRoot [data-nw-all]';
    await expect(page.locator(`${all} .nw-day-head`)).toHaveText([/^관심 주제/, /^오늘/]);
    await expect.poll(() => keysIn(page, all)).toEqual(['news:h1', 'news:b1', 'outside:s1', 'outside:s2', 'news:a1', 'news:b5']);
    await expect(page.locator(`${all} details[data-nw-fold]`)).toHaveCount(1);
    await expect(page.locator(`${all} details[data-nw-fold="fold:news:b1"] summary`)).toHaveText('가짜일보 외 3건');
    // 첫 화면에 한 매체가 여러 줄을 차지하지 않는다(보이는 줄 중 가짜일보 2줄 이하).
    const shown = await keysIn(page, all);
    expect(shown.filter(k => /^news:b/.test(k)).length).toBeLessThanOrEqual(2);
    expect(await noWideScroll(page)).toBe(true);
    if (process.env.FOLD_SHOT) await page.screenshot({ path: `/tmp/claude-0/fold-${width}.png` });
    expect(errors).toEqual([]);
  });
}
