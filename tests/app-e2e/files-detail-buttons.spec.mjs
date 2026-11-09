import { test, expect } from '@playwright/test';
import { start, openFiles, treeGo } from './helpers/files-server.mjs';
// FILES-자세히버튼크기 ①: [파일] 자세히 보기 버튼 줄은 모든 버튼이 같은 작은 버튼(공용 secondary·danger)이라 높이가 하나다.
// 폭 세 가지: 폰 390 · 폴드 884 · PC 1440. 이름·id는 모두 가짜.
const root = page => page.locator('#filesRoot');
for (const width of [390, 884, 1440]) {
  test(`[파일] ${width}폭: 자세히 보기 버튼 줄은 모두 같은 높이 · 이름 옆 ← → 없음`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors } = await start(page, width);
    await openFiles(page, width);
    await treeGo(page, 'od');
    const list = root(page).locator('[data-fx-list]');
    await list.locator('[data-fx-row]', { hasText: '가짜 문서함' }).click();
    // 같은 종류: 파일을 고르면 나오는 막대(복사·옮기기·자료실로·이름·휴지통)도 높이 하나.
    await list.locator('[data-fx-row]', { hasText: '가짜 안내문.pdf' }).click({ modifiers: ['Control'] });
    const bar = root(page).locator('[data-fx-bar]:not([hidden]) button:visible');
    await expect(bar.first()).toBeVisible();
    expect(await bar.count()).toBeGreaterThanOrEqual(4);
    const bh = await bar.evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().height * 10) / 10));
    expect(new Set(bh).size, JSON.stringify(bh)).toBe(1);
    await list.locator('[data-fx-row]', { hasText: '가짜 안내문.pdf' }).click({ modifiers: ['Control'] });
    await list.locator('[data-fx-row]', { hasText: '가짜 안내문.pdf' }).click();
    const btns = root(page).locator('[data-fx-prev] .fx-pv-acts button:visible');
    await expect(btns.first()).toBeVisible();
    expect(await btns.count()).toBeGreaterThanOrEqual(5);
    await expect(btns.filter({ hasText: '자료실로 보내기' })).toHaveCount(1);
    await expect(btns.filter({ hasText: '옮기기' })).toHaveCount(1);
    const boxes = await btns.evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { h: Math.round(r.height * 10) / 10, cls: e.className }; }));
    const hs = new Set(boxes.map(b => b.h));
    expect([...hs], JSON.stringify(boxes)).toHaveLength(1);
    expect(boxes.every(b => /(^|\s)(secondary|danger)(\s|$)/.test(b.cls))).toBe(true);
    // ②: 이름 옆 ← → 단추는 없다(키보드 ←·→ 이동은 files-manager-finish에서 확인).
    await expect(root(page).locator('[data-fx-pv-step]')).toHaveCount(0);
    await expect(root(page).locator('.fx-pv-head button')).toHaveCount(await root(page).locator('.fx-pv-head [data-fx-close], .fx-pv-head [data-fx-star-one]').count());
    // 줄바꿈해도 가로로 넘치지 않는다.
    expect(await root(page).evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}
