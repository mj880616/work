import {expect} from '@playwright/test';
// UI-전수디자인점검 F01: 사업 보고 사업영역·회의명 거르기는 칸 칩 줄 끝 [거르기 ▾] 하나가 여는 공용 고르기 창(#reportFilterSheet)이다.
// 시험은 사람이 하듯 버튼을 눌러 창을 열고 묶음(data-report-filter="area"|"name") 안의 줄을 누른다. 줄을 누르면 창은 닫힌다.
export const reportFilterButton=page=>page.locator('#reportFilterBtn');
export const reportFilterSheet=page=>page.locator('#reportFilterSheet');
const option=(page,key,pick)=>{
  const group=reportFilterSheet(page).locator(`[data-report-filter="${key}"]`);
  return typeof pick==='object'?group.getByRole('button',{name:pick.label,exact:true}):group.locator(`[data-sheet-value="${key}:${pick}"]`);
};
export async function openReportFilter(page){
  const sheet=reportFilterSheet(page);
  if(await sheet.isVisible().catch(()=>false))return sheet;
  await reportFilterButton(page).click();await expect(sheet).toBeVisible();return sheet;
}
export async function closeReportFilter(page){
  const sheet=reportFilterSheet(page);
  if(!await sheet.isVisible().catch(()=>false))return;
  await page.keyboard.press('Escape');await expect(sheet).toBeHidden();
}
// pick: 값('all'·'__none__'·회의명·사업영역 id) 또는 {label}.
export async function pickReportFilter(page,key,pick){
  await openReportFilter(page);await option(page,key,pick).click();await expect(reportFilterSheet(page)).toBeHidden();
}
// 한 묶음의 줄 글자(순서대로). 창을 열었다가 닫는다.
export async function reportFilterLabels(page,key){
  const sheet=await openReportFilter(page);
  const labels=await sheet.locator(`[data-report-filter="${key}"] .home-choice-name`).allTextContents();
  await closeReportFilter(page);return labels;
}
// 지금 창에 있는 묶음 이름들. 버튼이 없으면 [].
export async function reportFilterKeys(page){
  if(!await reportFilterButton(page).isVisible().catch(()=>false))return [];
  const sheet=await openReportFilter(page);
  const keys=await sheet.locator('[data-report-filter]').evaluateAll(els=>els.map(e=>e.dataset.reportFilter));
  await closeReportFilter(page);return keys;
}
