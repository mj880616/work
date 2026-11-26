import { expect } from '@playwright/test';
// S71-25 PHOTO-머리한줄: 사진 맨 위 한 줄(screen-find.js 단추 자리 [data-sf-tools="photos"])의 단추와 그 메뉴를 시험에서 함께 쓰는 길.
// 가져올 곳 = 단추 하나 → #photosSrcMenu 줄([data-photos-src="onedrive|gdrive|phone"]), ⋯ = #photosHeadMenu(크기 [－][＋]·새 앨범).
export const head = page => page.locator('[data-sf-tools="photos"]');
export const srcPick = page => head(page).locator('[data-photos-src-pick]');
export const srcRow = (page, name) => page.locator(`#photosSrcMenu [data-photos-src="${name}"]`);
export async function openSrcMenu(page) {
  if (!(await page.locator('#photosSrcMenu').isVisible())) await srcPick(page).click();
  await expect(page.locator('#photosSrcMenu')).toBeVisible();
}
// 가져올 곳 메뉴를 열어 그 줄을 누른다(메뉴는 닫힌다 — 예전 큰 단추 하나 누르기와 같은 일).
export async function pickSource(page, name) {
  await openSrcMenu(page);
  await srcRow(page, name).click();
}
// 메뉴를 열어 그 줄 속성을 읽고 닫는다.
export async function sourceAttr(page, name, attr) {
  await openSrcMenu(page);
  const v = await srcRow(page, name).getAttribute(attr);
  await page.keyboard.press('Escape');
  await expect(page.locator('#photosSrcMenu')).toBeHidden();
  return v;
}
export const moreBtn = page => head(page).locator('[data-photos-head-more]');
export async function openHeadMenu(page) {
  if (!(await page.locator('#photosHeadMenu').isVisible())) await moreBtn(page).click();
  await expect(page.locator('#photosHeadMenu')).toBeVisible();
}
export const sizeBtn = (page, dir) => page.locator(`#photosHeadMenu [data-photo-size="${dir}"]`);
