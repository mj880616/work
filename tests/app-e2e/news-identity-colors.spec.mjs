import { test, expect } from '@playwright/test';
import { start } from './helpers/news-server.mjs';
// NEWS-고유색 ①(명진 11/10, 시안 docs/design/mockups/news-identity-colors.html): News 목록 왼쪽 막대·이름 글자가 단체 고유색.
// 정당 4곳 진한 고유색(정의당 막대 샛노랑, 이름은 진한 노랑), 금속노조 네이비, 공공운수노조 막대 하나에 네이비·회색·빨강 3색(이름 네이비).
// 민주노총은 ②(S57-11)에서 고정 색이 됐다(나머지 단체·언론 고정 색 표는 tests/news-colors.test.mjs). 매체 고르기 창 점도 막대와 같은 색. 서버는 흉내(글은 모두 가짜).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const SOURCES = [
  { key: 'kctu', name: '민주노총', group: 'labor', lang: 'ko' },
  { key: 'kptu', name: '공공운수노조', group: 'labor', lang: 'ko' },
  { key: 'kmwu', name: '금속노조', group: 'labor', lang: 'ko' },
  { key: 'laborparty', name: '노동당', group: 'party', lang: 'ko' },
  { key: 'kgreens', name: '녹색당', group: 'party', lang: 'ko' },
  { key: 'jinboparty', name: '진보당', group: 'party', lang: 'ko' },
  { key: 'justice', name: '정의당', group: 'party', lang: 'ko' },
];
const post = (id, source_key, minute) => ({ id, source_key, kind: 'statement', lang: 'ko', title: `[논평] 가짜 글 ${id}`, title_ko: null, url: `https://example.org/s/${id}`, published_at: `2026-10-06T00:${minute}:00Z`, fetched_at: `2026-10-06T00:${minute}:00Z`, summary_ko: '가짜 요약.', key_sentences: [], has_body: false, author: null });
const POSTS = [post('p1', 'justice', '50'), post('p2', 'jinboparty', '48'), post('p3', 'kgreens', '46'), post('p4', 'laborparty', '44'), post('p5', 'kptu', '42'), post('p6', 'kmwu', '40'), post('p7', 'kctu', '38')];

const LIGHT = { justice: ['rgb(255, 204, 0)', 'rgb(148, 111, 0)'], jinboparty: ['rgb(255, 122, 0)', 'rgb(184, 90, 0)'], kgreens: ['rgb(31, 163, 74)', 'rgb(24, 133, 58)'], laborparty: ['rgb(230, 0, 18)', 'rgb(230, 0, 18)'], kmwu: ['rgb(27, 42, 92)', 'rgb(27, 42, 92)'], kctu: ['rgb(168, 24, 42)', 'rgb(168, 24, 42)'] };
const DARK = { justice: ['rgb(255, 204, 0)', 'rgb(255, 204, 0)'], kmwu: ['rgb(138, 162, 230)', 'rgb(138, 162, 230)'], laborparty: ['rgb(255, 77, 85)', 'rgb(255, 77, 85)'], kctu: ['rgb(208, 30, 52)', 'rgb(231, 84, 102)'] };

async function openAll(page, width, scheme) {
  await page.emulateMedia({ colorScheme: scheme });
  const { errors, server } = await start(page, width);
  server.items = [];
  for (const s of SOURCES) server.sources.set(s.key, { source_key: s.key, enabled: true, last_ok_at: '2026-10-06T00:07:00Z', last_error: null });
  await page.route(SB + '/functions/v1/outside-feed**', route => {
    const action = new URL(route.request().url()).searchParams.get('action');
    return action === 'catalog' ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, sources: SOURCES }) }) : route.fallback();
  });
  await page.route(SB + '/rest/v1/app_outside_posts**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(POSTS) }));
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: 'News' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: 'News', exact: true }).click();
  await expect(page.locator('#outsideView')).toBeVisible();
  await page.locator('#outsideRoot [data-os-tab="all"]').click();
  await expect(page.locator('#outsideRoot [data-nw-all] [data-nw-key="outside:p7"]')).toBeVisible();
  return errors;
}
const paint = (page, id) => page.locator(`#outsideRoot [data-nw-all] [data-nw-key="outside:${id}"]`).evaluate(row => {
  const bar = getComputedStyle(row.querySelector('.nw-bar')), src = getComputedStyle(row.querySelector('.nw-src'));
  return { bg: bar.backgroundColor, img: bar.backgroundImage, ink: src.color };
});

for (const [width, scheme] of [[1280, 'light'], [412, 'light'], [412, 'dark'], [1280, 'dark']]) {
  test(`News 고유색 ${width} ${scheme}: 정당 4곳·금속노조·공공운수노조 3색 막대·민주노총`, async ({ page }) => {
    test.setTimeout(90000);
    const errors = await openAll(page, width, scheme);
    const want = scheme === 'dark' ? DARK : LIGHT;
    const ids = { justice: 'p1', jinboparty: 'p2', kgreens: 'p3', laborparty: 'p4', kmwu: 'p6', kctu: 'p7' };
    for (const [key, [bar, ink]] of Object.entries(want)) {
      const got = await paint(page, ids[key]);
      expect(got.bg, `${key} 막대`).toBe(bar);
      expect(got.ink, `${key} 이름`).toBe(ink);
    }
    // 공공운수노조: 막대 하나에 세 색 띠(그라데이션), 이름 글자는 금속노조와 같은 네이비.
    const kptu = await paint(page, 'p5');
    expect(kptu.img).toMatch(/^linear-gradient/);
    expect(kptu.img.match(/rgb\(/g) || []).toHaveLength(6);
    expect(kptu.ink).toBe((await paint(page, 'p6')).ink);
    // 민주노총도 NEWS-고유색 ②(S57-11)부터 고정 색: 막대는 한 색(띠 아님), 값은 위 표(밝은 화면은 막대 = 이름 색, 어두운 화면은 이름만 밝게).
    expect((await paint(page, 'p7')).img).toBe('none');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (process.env.ID_SHOT) await page.screenshot({ path: `${process.env.ID_SHOT}/news-${width}-${scheme}.png` });
    // 매체 고르기 창 점도 막대와 같은 색(공공운수노조 3색).
    if (width === 1280 && scheme === 'light') {
      await page.locator('[data-nw-media]').click();
      const dot = page.locator('#nwMediaPicker [data-lu-move-folder="s:kptu"] .lu-move-dot');
      await expect(dot).toBeVisible();
      expect(await dot.evaluate(el => getComputedStyle(el).backgroundImage)).toMatch(/^linear-gradient/);
      if (process.env.ID_SHOT) await page.screenshot({ path: `${process.env.ID_SHOT}/picker-${width}-${scheme}.png` });
    }
    expect(errors).toEqual([]);
  });
}
