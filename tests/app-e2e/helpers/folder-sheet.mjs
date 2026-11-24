// S69-62 폴더 고르기 창 하나([파일] '옮길 곳' 창과 같은 창, app/folder-dest-sheet.js) 시험 도움.
// 줄 이름(data-fx-dest-name)으로 차례로 누르면 고르기 + 펼치기, [여기에 옮기기](data-fx-dest-go)로만 옮긴다.
import {expect} from '@playwright/test';

export const folderSheet = page => page.locator('dialog[data-fd-sheet][open]');
export const sheetRow = (page, name) => folderSheet(page).locator(`.fx-dest-tree [data-fx-dest-pick][data-fx-dest-name="${String(name).replace(/"/g, '\\"')}"]`);
export const sheetGo = page => folderSheet(page).locator('[data-fx-dest-go]');

// path: 위에서부터 누를 줄 이름들(맨 위 줄 이름 포함 가능). go:false면 고르기만 하고 [여기에 옮기기]는 누르지 않는다.
export async function pickInSheet(page, path, {go = true} = {}) {
  const box = folderSheet(page);
  await expect(box).toBeVisible();
  for (const name of [].concat(path)) {
    const row = sheetRow(page, name).first();
    await expect(row).toBeVisible();
    await row.click();
  }
  if (go) {
    await expect(sheetGo(page)).toBeEnabled();
    await sheetGo(page).click();
    await expect(box).toHaveCount(0);
  }
}
