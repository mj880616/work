import {expect} from '@playwright/test';
// BIZ-머리한줄(S71-23, 사용자 11/26 "녹음은 + 에 넣고"): 사업 관리 [녹음]은 첫 줄 [+] 메뉴의 한 줄이다(예전 첫 줄 #reportRecordBtn은 없앰).
// 시험은 사람처럼 [+]를 눌러 메뉴의 [녹음]을 누른다. 녹음기(meeting-recorder.js·폰 앱 phone-recorder.js)는 첫 화면 뒤에 붙으므로 붙은 뒤에 연다.
export const recMenuItem=page=>page.locator('#bizAddMenu [data-report-rec]');
const recorderReady=page=>page.waitForFunction(()=>!!(window.KPTUMeetingRecorder||window.KPTUPhoneRecorder));
export async function startRecord(page){
  await recorderReady(page);
  await page.locator('#newMeetingBtn').click();
  await recMenuItem(page).click();
  await expect(page.locator('#bizAddMenu')).toBeHidden();
}
// [+] 메뉴를 열어 [녹음] 줄 모양({text, disabled, pressed})을 읽고 닫는다. 그 기기에서 녹음할 수 없으면 null(줄 없음).
export async function readRecItem(page){
  await recorderReady(page);
  await page.locator('#newMeetingBtn').click();
  const menu=page.locator('#bizAddMenu');await expect(menu).toBeVisible();
  const it=recMenuItem(page);
  const out=await it.count()?{text:(await it.textContent()).trim(),disabled:await it.isDisabled(),pressed:await it.getAttribute('aria-pressed')}:null;
  await page.keyboard.press('Escape');await expect(menu).toBeHidden();
  return out;
}
