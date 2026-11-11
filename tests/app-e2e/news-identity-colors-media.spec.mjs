import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { start } from './helpers/news-server.mjs';
// NEWS-고유색 새 매체(S58-5, 명진 11/11 '추천대로'): NEWS-못넣은곳대안으로 더해진 언론도 News 목록 막대·이름 글자와 매체 고르기 점이 키별 고유색이다.
// S59-1: 길이 있는 6곳만 남고(자기 RSS), 길이 없어 카탈로그에서 뺀 8곳은 색 표에서도 빠졌다.
// 기존 매체(경향신문·한겨레·매일노동뉴스·연합뉴스)의 색은 그대로. 값은 theme-tokens.css에서 읽어 와서(확인 뒤 토큰만 바꿔도 이 시험은 그대로) 화면에 그려진 색과 맞춘다. 서버·기사는 모두 가짜.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const NEW6 = [
  ['news-worknworld', '노동과세계'], ['news-newsmin', '뉴스민'], ['news-redaily', '철도경제신문'], ['news-laborplus', '참여와혁신'], ['news-redian', '레디앙'], ['news-mt', '머니투데이'],
];
const OLD = [['news-khan', '경향신문'], ['news-hani', '한겨레'], ['news-labortoday', '매일노동뉴스'], ['news-yna', '연합뉴스']];
const ALL = [...NEW6, ...OLD];
const CATALOG = ALL.map(([key, name]) => ({ key, name, region: 'domestic', lang: 'ko', on: true }));
const ITEMS = ALL.map(([key, name], i) => ({
  id: `m${String(i + 1).padStart(2, '0')}`, lane: 'media', url: `https://example.org/m${i + 1}`, title: `가짜 기사 제목 ${i + 1} — ${name} 쪽 흉내 글`, lang: 'ko', publisher: name, source_key: key, keywords: [],
  published_at: `2026-10-06T0${Math.floor((17 - i) / 6)}:${String(59 - ((i * 7) % 50)).padStart(2, '0')}:00Z`, scrapped_at: null, created_at: '2026-10-06T00:10:00Z', state: 'ok', summary: '가짜 요약.',
  body_kind: 'lead', title_ko: null, translated_at: null, starred_at: null, folder_id: null, _body: null,
}));

const css = readFileSync(new URL('../../app/theme-tokens.css', import.meta.url), 'utf8');
const cut = css.indexOf('@media (prefers-color-scheme:dark)');
const PARTS = { light: css.slice(0, cut), dark: css.slice(cut) };
const rgb = hex => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
const want = (scheme, key) => ({
  bar: rgb(PARTS[scheme].match(new RegExp(`--ds-news-id-${key}-bar:(#[0-9a-f]{6});`))[1]),
  ink: rgb(PARTS[scheme].match(new RegExp(`--ds-news-id-${key}:(#[0-9a-f]{6});`))[1]),
});

async function openAll(page, width, scheme) {
  await page.emulateMedia({ colorScheme: scheme });
  const { errors, server } = await start(page, width);
  server.items = ITEMS.map(it => ({ ...it }));
  for (const [key] of ALL) server.sources.set(key, { source_key: key, enabled: true, last_ok_at: '2026-10-06T00:07:00Z', last_error: null });
  // 나중에 건 길이 먼저 받는다: 언론 목록(catalog)만 이 시험 값으로 바꾸고 나머지는 공용 흉내 서버가 그대로 받는다.
  await page.route(SB + '/functions/v1/news-feed**', route => {
    const action = new URL(route.request().url()).searchParams.get('action');
    return action === 'catalog'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, sources: CATALOG, limits: { fill: 10, translate: 20, open: 60, keywords: 30 }, ai: { month_capped: false } }) })
      : route.fallback();
  });
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: 'News' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: 'News', exact: true }).click();
  await expect(page.locator('#outsideView')).toBeVisible();
  await page.locator('#outsideRoot [data-os-tab="all"]').click();
  await expect(page.locator(`#outsideRoot [data-nw-all] [data-nw-key="news:${ITEMS[ITEMS.length - 1].id}"]`)).toBeVisible();
  return errors;
}
const paint = (page, id) => page.locator(`#outsideRoot [data-nw-all] [data-nw-key="news:${id}"]`).evaluate(row => {
  const bar = getComputedStyle(row.querySelector('.nw-bar')), src = getComputedStyle(row.querySelector('.nw-src'));
  return { bg: bar.backgroundColor, img: bar.backgroundImage, ink: src.color };
});

for (const [width, scheme] of [[1280, 'light'], [412, 'light'], [412, 'dark'], [1280, 'dark']]) {
  test(`News 새 언론 6곳 고유색 ${width} ${scheme}: 목록 막대·이름, 기존 매체 색 그대로`, async ({ page }) => {
    test.setTimeout(90000);
    const errors = await openAll(page, width, scheme);
    const seen = new Set();
    for (const [i, [key]] of ALL.entries()) {
      const got = await paint(page, ITEMS[i].id);
      const exp = want(scheme, key);
      expect(got.bg, `${key} 막대`).toBe(exp.bar);
      expect(got.img, `${key} 막대는 한 색`).toBe('none');
      expect(got.ink, `${key} 이름`).toBe(exp.ink);
      seen.add(got.bg);
    }
    // 10곳(새 6 + 기존 4) 막대가 모두 서로 다른 색: 묶음 돌려쓰기 4칸으로 되돌아가지 않았다.
    expect(seen.size).toBe(ALL.length);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (process.env.ID_SHOT) {
      await page.setViewportSize({ width, height: width > 760 ? 1180 : 1500 });
      await page.screenshot({ path: `${process.env.ID_SHOT}/news-list-${width}-${scheme}.png` });
    }
    // 매체 고르기 창 점도 같은 막대 색(밝은 화면 두 폭만 사진).
    if (scheme === 'light') {
      await page.locator('[data-nw-media]').click();
      for (const [key] of NEW6) {
        const dot = page.locator(`#nwMediaPicker [data-lu-move-folder="n:${key}"] .lu-move-dot`);
        await dot.scrollIntoViewIfNeeded();
        await expect(dot, `${key} 점`).toBeVisible();
        expect(await dot.evaluate(el => getComputedStyle(el).backgroundColor), `${key} 점 색`).toBe(want('light', key).bar);
      }
      if (process.env.ID_SHOT) {
        await page.locator(`#nwMediaPicker [data-lu-move-folder="n:${NEW6[0][0]}"]`).scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${process.env.ID_SHOT}/picker-${width}-${scheme}.png` });
      }
    }
    expect(errors).toEqual([]);
  });
}
