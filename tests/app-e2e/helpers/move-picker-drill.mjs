import {expect} from '@playwright/test';
// LIB-폴더창들어가기(app/library-move-picker.js drill): 폴더 고르기 창은 '하위 폴더 있는 줄 = 들어가기, 다른 줄 = 선택만, 실행 단추로 끝'.
// 시험에서 폴더 하나를 골라 실행까지 하는 도우미. panel = 창(#luMovePicker 등), row = 창 안 폴더 줄,
// press = 누르는 방법(폰 tap·PC click). 하위 폴더가 있는 줄이면 들어가서 '이 폴더로'를 누른다.
// 들어가야 보이는 줄은 path(위에서부터 들어갈 줄들)로 먼저 들어간다.
export async function pickFolderIn(panel, row, {press = l => l.click(), path = []} = {}) {
  for (const step of path) await press(step);
  await expect(row).toBeVisible();
  if (await row.getAttribute('data-lu-move-kids') !== null) {
    await press(row);
    await press(panel.locator('[data-lu-move-here]'));
  } else await press(row);
  await expect(panel.locator('[data-lu-move-ok]')).toBeEnabled();
  await press(panel.locator('[data-lu-move-ok]'));
}
// [폴더 밖으로]·[맨 위]처럼 아래 단추로 고르는 자리: 선택 → 실행.
export async function pickOutIn(panel, {press = l => l.click()} = {}) {
  await press(panel.locator('[data-lu-move-out]'));
  await press(panel.locator('[data-lu-move-ok]'));
}
