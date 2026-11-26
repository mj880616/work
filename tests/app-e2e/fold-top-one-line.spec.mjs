import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// FOLD-넓은화면 A(S57-21, 요청함 11/06 01:18 ① · 시안 docs/design/mockups/fold-wide-screens.html A): 폴드 펼침(600~760px, 폰 틀)은
// 제목만 있던 큰 줄(44px + 아래 12px) 대신 '제목 · 찾기' 낮은 한 줄(36px + 아래 8px). S70-57: 찾기는 그 화면 찾기 칸('<메뉴>에서 찾기'),
// 홈만 '전체 검색' 입구. 접은 폰(600px 미만)은 큰 줄(찾기는 돋보기), PC 틀(761px~)은 위 한 줄이라 이 줄이 없다.
// 사진(S70-57): 앱 머리 줄이 이름 · 찾기('사진에서 찾기') · 출처 아이콘이고, 화면 첫 줄은 도구 줄 한 줄이다(제목 없음).
// 가짜 서버·가짜 자료만 쓴다(openHome).
const FOLD = [[690, 1000], [750, 1000]];
const VIEWS = [['tasks', '할 일'], ['outside', '읽을 거리'], ['basket', '잊지 말기'], ['diary', '하루 기록']];
const go = async (page, view) => {
  await page.evaluate(v => window.KPTURouter.go(v), view);
  await page.waitForFunction(v => window.KPTURouter.current === v && !document.querySelector(`#${v}View`)?.classList.contains('hidden'), view);
};
const head = page => page.evaluate(() => {
  const h = document.querySelector('#appView > .mobile-shell-header'), name = h.querySelector('[data-mobile-view-name]'), entry = h.querySelector('.mobile-shell-search .gs-menu-entry');
  const s = getComputedStyle(h), box = e => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, mid: b.y + b.height / 2 }; };
  return { shown: s.display !== 'none' && !h.hidden, h: h.getBoundingClientRect().height, gap: parseFloat(s.marginBottom), right: h.getBoundingClientRect().right,
    name: { ...box(name), text: name.textContent }, entry: entry && getComputedStyle(entry.parentElement).display !== 'none' ? box(entry) : null, vw: innerWidth, docW: document.documentElement.scrollWidth };
});

for (const [width, height] of FOLD) {
  test(`폴드 펼침 ${width}: 앱 머리는 '제목 · 찾기' 낮은 한 줄`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize({ width, height });
    await openHome(page);
    // S70-57(사용자 11/26 "전체 검색은 홈에만") → S71-41 HOME-머리한줄: 홈에는 앱 머리 줄이 없고, '전체 검색' 입구는 날짜 줄 끝 돋보기 하나(36px).
    const entry = page.locator('#homeView [data-journal-find]');
    await expect(entry).toBeVisible({ timeout: 15000 });
    { const m = await head(page); expect(m.shown).toBe(false); const b = await entry.boundingBox(); expect(b.height).toBe(36); }
    for (const [view, title] of VIEWS) {
      await go(page, view);
      // 다른 화면은 입구 대신 그 화면 찾기 칸('<메뉴>에서 찾기', + 오른쪽 옮겨 온 단추)이 같은 자리·같은 높이다(S70-54·S70-57).
      const find = page.locator('#appView > .mobile-shell-header #gsScreenInput');
      await expect(find, view).toBeVisible({ timeout: 15000 });
      await expect(find, view).toHaveAttribute('placeholder', `${title}에서 찾기`);
      await expect(entry, view).toBeHidden();
      const f = await page.evaluate(() => { const h = document.querySelector('#appView > .mobile-shell-header'), n = h.querySelector('[data-mobile-view-name]'), nb = n.getBoundingClientRect(), b = h.querySelector('.mobile-shell-find .gs-field').getBoundingClientRect();
        return { h: h.getBoundingClientRect().height, gap: parseFloat(getComputedStyle(h).marginBottom), name: n.textContent, nameMid: nb.y + nb.height / 2, nameRight: nb.right, mid: b.y + b.height / 2, x: b.x, fh: b.height, docW: document.documentElement.scrollWidth, vw: innerWidth }; });
      expect(f.name, view).toBe(title);
      // 큰 줄(44 + 12 = 56px) → 낮은 한 줄(36 + 8 = 44px).
      expect(Math.round(f.h), view).toBe(36);
      expect(f.gap, view).toBe(8);
      expect(Math.abs(f.mid - f.nameMid), view).toBeLessThanOrEqual(1.5);
      expect(f.x, view).toBeGreaterThanOrEqual(f.nameRight + 8);
      expect(f.fh, view).toBe(36);
      expect(f.docW, view).toBeLessThanOrEqual(f.vw);
    }
    // 홈 돋보기: 누르면 화면 전체 검색으로 가고 머리 줄 '전체 검색' 칸에 바로 커서(S71-07 Q3 — 화면 안 두 번째 칸 없음). 칸은 돋보기가 있던 첫 줄 자리
    // (S71-41), 높이 36px + 아래 8px. 뒤로 가면 홈(머리 줄 없음).
    await go(page, 'home');
    await expect(entry).toHaveAccessibleName('전체 검색');
    const before = await entry.boundingBox();
    await entry.click();
    const input = page.locator('#gsHeadInput');
    await expect(page.locator('#searchView')).toBeVisible();
    await expect(input).toBeFocused();
    await expect(page.locator('#searchView input')).toHaveCount(0);
    { const b = await input.boundingBox(); expect(Math.abs((b.y + b.height / 2) - (before.y + before.height / 2))).toBeLessThanOrEqual(2); expect(b.height).toBe(36);
      const m = await head(page); expect(m.shown).toBe(true); expect(Math.round(m.h)).toBe(36); expect(m.gap).toBe(8); }
    await page.goBack();
    await expect(page.locator('#homeView')).toBeVisible();
    await expect(entry).toBeVisible();
    await expect(input).toBeHidden();
    expect(errors).toEqual([]);
  });

  // S70-57: 사진도 앱 머리 줄 = 이름 '사진' · 찾기 칸('사진에서 찾기'). S71-25 PHOTO-머리한줄: 보기·거르기·순서·가져올 곳·⋯도 그 한 줄, 화면 안 도구 줄 없음.
  test(`폴드 펼침 ${width}: 사진은 앱 머리 '사진 · [사진 ▾][전체 ▾] · 순서 · 가져올 곳 · 찾기 · ⋯' 한 줄, 도구 줄 없음`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openHome(page);
    await go(page, 'photos');
    const m = await head(page);
    expect(m.shown).toBe(true);
    expect(m.name.text).toBe('사진');
    const r = await page.evaluate(() => {
      const mid = e => { const b = e.getBoundingClientRect(); return b.y + b.height / 2; }, box = e => e.getBoundingClientRect();
      const h = document.querySelector('#appView > .mobile-shell-header'), find = h.querySelector('#gsScreenInput'), srcs = h.querySelector('[data-sf-tools="photos"] [data-photos-src-pick]');
      const view = h.querySelector('[data-sf-tools="photos"] [data-photos-view]'), more = h.querySelector('[data-sf-tools="photos"] [data-photos-head-more]');
      return { find: mid(find), srcs: mid(srcs), view: mid(view), more: mid(more), name: mid(h.querySelector('[data-mobile-view-name]')), place: find.placeholder, headH: box(h).height,
        srcsRight: box(srcs).right, moreRight: box(more).right, headRight: box(h).right, tools: !!document.querySelector('#photosRoot [data-photos-tools], #photosRoot [data-photos-bar]') };
    });
    expect(r.place).toBe('사진에서 찾기');
    for (const k of ['find', 'srcs', 'view', 'more']) expect(Math.abs(r[k] - r.name), k).toBeLessThanOrEqual(2);
    expect(r.moreRight).toBeLessThanOrEqual(r.headRight + 0.5);
    expect(r.tools).toBe(false);
    expect(r.headH).toBeLessThanOrEqual(56);
  });
}

test('접은 폰 412: 앱 머리는 큰 줄 그대로(전체 검색 입구 없음 — 홈에만)', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await openHome(page);
  for (const [view, title] of VIEWS) {
    await go(page, view);
    const m = await head(page);
    expect(m.shown, view).toBe(true);
    expect(m.name.text, view).toBe(title);
    expect(Math.round(m.h), view).toBe(44);
    expect(m.gap, view).toBe(12);
    expect(m.entry, view).toBeNull();
  }
  // S71-25 PHOTO-머리한줄: 사진은 앱 머리 줄 하나(이름 '사진' · [사진 ▾][전체 ▾] · 순서 · 가져올 곳 · 찾기 돋보기 · ⋯), 화면 안 도구 줄 없음.
  await go(page, 'photos');
  const m = await head(page);
  expect(m.shown).toBe(true);
  expect(m.name.text).toBe('사진');
  const rows = await page.evaluate(() => { const b = e => e.getBoundingClientRect(), h = document.querySelector('#appView > .mobile-shell-header');
    return { headH: b(h).height, view: !!h.querySelector('[data-photos-view]'), tools: !!document.querySelector('#photosRoot [data-photos-tools], #photosRoot [data-photos-bar]') }; });
  expect(rows.view).toBe(true);
  expect(rows.tools).toBe(false);
  expect(rows.headH).toBeLessThanOrEqual(56);
});

for (const width of [884, 1280]) test(`PC 틀 ${width}: 앱 머리 없음(위 한 줄이 지금 위치 · 전체 검색)`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await openHome(page);
  await go(page, 'tasks');
  await expect(page.locator('#appView > .mobile-shell-header')).toBeHidden();
  await expect(page.locator('#appView > .app-topline [data-search-slot] input')).toBeVisible();
});
