// STD C10 표 칸 메뉴(app/cell-menu.js) 시험 도구: PC 우클릭·폰 꾹 누르기로 칸 메뉴를 열고 항목을 누른다.
import {expect} from '@playwright/test';

export const rowMenu = page => page.locator('#rowMenu');
// PC 마우스 우클릭 → 칸 메뉴.
export async function cellMenu(page, cell) {
  await cell.scrollIntoViewIfNeeded();
  await cell.click({button: 'right', position: {x: 4, y: 4}});
  await expect(rowMenu(page)).toBeVisible();
  return rowMenu(page);
}
// 손가락 꾹 누르기(0.5초 넘게, 움직이지 않고 뗌) → 칸 메뉴.
export async function holdCell(page, cell) {
  await cell.scrollIntoViewIfNeeded();
  const fire = (type) => cell.evaluate((el, type) => { const r = el.getBoundingClientRect(), x = r.left + 6, y = r.top + 6;
    el.dispatchEvent(new PointerEvent(type, {bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y})); }, type);
  await fire('pointerdown');
  await page.waitForTimeout(650);
  await fire('pointerup');
  await expect(rowMenu(page)).toBeVisible();
  return rowMenu(page);
}
export async function cellAct(page, cell, item, {hold = false} = {}) {
  const menu = hold ? await holdCell(page, cell) : await cellMenu(page, cell);
  await menu.locator(`[data-row-item="${item}"]`).click();
}
export const editCell = (page, cell, opts) => cellAct(page, cell, 'edit', opts);
