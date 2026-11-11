import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// FOLD-넓은화면 A(S57-21, 요청함 11/06 01:18 ① · 시안 docs/design/mockups/fold-wide-screens.html A): 폴드 펼침(600~760px, 폰 틀)은
// 제목만 있던 큰 줄(44px + 아래 12px) 대신 '제목 · 찾기' 낮은 한 줄(36px + 아래 8px). 찾기는 폰 메뉴 창 맨 위와 같은 입구(누르면 화면 전체 검색).
// 접은 폰(600px 미만)은 그대로(큰 줄·입구 없음), PC 틀(761px~)은 위 한 줄(지금 위치 · 전체 검색)이라 이 줄이 없다.
// 사진은 화면 첫 줄이 제목이라 앱 머리가 없고, 폴드 펼침에서는 제목 · 도구 줄 · 출처가 한 줄이다(접은 폰은 두 줄 그대로).
// 가짜 서버·가짜 자료만 쓴다(openHome).
const FOLD = [[690, 1000], [750, 1000]];
const VIEWS = [['tasks', '할 일'], ['ledger', '원장'], ['outside', 'News'], ['basket', '잊지 말기'], ['diary', '일기']];
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
    // 홈은 날짜가 제목이라 머리 줄 자체가 없다(그대로).
    expect((await head(page)).shown).toBe(false);
    for (const [view, title] of VIEWS) {
      await go(page, view);
      // 찾기 입구는 전체 검색 모듈이 뜬 뒤에 붙는다(메뉴 창 입구와 같은 때). 붙은 뒤에 잰다 — 바쁜 러너에서 그 전에 재면 입구가 아직 없다.
      await expect(page.locator('#appView > .mobile-shell-header .gs-menu-entry'), view).toBeVisible({ timeout: 15000 });
      const m = await head(page);
      expect(m.shown, view).toBe(true);
      expect(m.name.text, view).toBe(title);
      // 큰 줄(44 + 12 = 56px) → 낮은 한 줄(36 + 8 = 44px).
      expect(Math.round(m.h), view).toBe(36);
      expect(m.gap, view).toBe(8);
      // 제목과 찾기가 같은 줄(세로 가운데가 같다), 찾기는 제목 오른쪽에서 줄 끝까지.
      expect(m.entry, view).not.toBeNull();
      expect(Math.abs(m.entry.mid - m.name.mid), view).toBeLessThanOrEqual(1.5);
      expect(m.entry.x, view).toBeGreaterThanOrEqual(m.name.right + 8);
      expect(Math.abs(m.entry.right - m.right), view).toBeLessThanOrEqual(1);
      expect(m.entry.h, view).toBe(36);
      expect(m.docW, view).toBeLessThanOrEqual(m.vw);
    }
    // 찾기 입구: 키보드로 닿고(Enter) 화면 전체 검색으로 간다. 검색 화면에는 검색칸이 있어 입구를 두지 않는다. 뒤로 가면 원래 화면.
    const entry = page.locator('#appView > .mobile-shell-header .gs-menu-entry');
    await expect(entry).toHaveAccessibleName('전체 검색 열기');
    await entry.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#searchView')).toBeVisible();
    await expect(page.locator('#searchView input[type="search"], #searchView .gs-input').first()).toBeVisible();
    await expect(entry).toBeHidden();
    await page.goBack();
    await expect(page.locator('#diaryView')).toBeVisible();
    await expect(entry).toBeVisible();
    expect(errors).toEqual([]);
  });

  test(`폴드 펼침 ${width}: 사진은 제목 · 도구 줄 · 출처가 한 줄`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openHome(page);
    await go(page, 'photos');
    await expect(page.locator('#appView > .mobile-shell-header')).toBeHidden();
    const m = await page.locator('#photosRoot [data-photos-bar]').evaluate(bar => {
      const mid = e => { const b = e.getBoundingClientRect(); return b.y + b.height / 2; }, box = e => e.getBoundingClientRect();
      const title = bar.querySelector('.photos-title'), tools = bar.querySelector('[data-photos-tools]'), srcs = bar.querySelector('.photos-srcs');
      return { title: mid(title), tools: mid(tools), srcs: mid(srcs), titleRight: box(title).right, toolsLeft: box(tools).left, toolsRight: box(tools).right, srcsLeft: box(srcs).left,
        srcsRight: box(srcs).right, barRight: box(bar).right, titleW: box(title).width, h: box(bar).height };
    });
    expect(m.titleW).toBeGreaterThan(20);
    expect(Math.abs(m.title - m.tools)).toBeLessThanOrEqual(2);
    expect(Math.abs(m.srcs - m.tools)).toBeLessThanOrEqual(2);
    expect(m.toolsLeft).toBeGreaterThanOrEqual(m.titleRight);
    expect(m.srcsLeft).toBeGreaterThanOrEqual(m.toolsRight - 0.5);
    expect(m.srcsRight).toBeLessThanOrEqual(m.barRight + 0.5);
    expect(m.h).toBeLessThanOrEqual(48);
  });
}

test('접은 폰 412: 앱 머리는 큰 줄 그대로(찾기 입구는 메뉴 창)', async ({ page }) => {
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
  // 사진은 두 줄 그대로(제목·출처 / 도구 줄).
  await go(page, 'photos');
  const rows = await page.locator('#photosRoot [data-photos-bar]').evaluate(bar => { const b = e => e.getBoundingClientRect(); return { titleBottom: b(bar.querySelector('.photos-title')).bottom, toolsTop: b(bar.querySelector('[data-photos-tools]')).top }; });
  expect(rows.toolsTop).toBeGreaterThanOrEqual(rows.titleBottom - 8);
});

for (const width of [884, 1280]) test(`PC 틀 ${width}: 앱 머리 없음(위 한 줄이 지금 위치 · 전체 검색)`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await openHome(page);
  await go(page, 'tasks');
  await expect(page.locator('#appView > .mobile-shell-header')).toBeHidden();
  await expect(page.locator('#appView > .app-topline [data-search-slot] input')).toBeVisible();
});
