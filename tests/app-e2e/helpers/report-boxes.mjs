import {expect} from '@playwright/test';
// S67-75 UI-걸러보기칩하나(2026-11-21 명진 A안): 폰 사업 관리 윗줄의 고르기 상자 네 개(종류·사업영역·기간·보기)는 줄에 다 안 들어가면
// 칩 하나(#reportFilterChip)로 묶이고, 상자는 그 칩이 여는 작은 창에 있다. 하나를 고르면 반영되고 창은 닫힌다.
// 시험은 사람이 하듯: 칩이 보이면 칩을 눌러 창을 열고 상자에서 고른다. 다 들어가는 폭(폴드 펼침·PC)은 칩이 없어 그대로 고른다.
const CHIP='#reportFilterChip',BAR='#meetingsView .report-kind-bar';
// 칩 하나인지(상자가 창 안에 있는지). 칩과 상자 줄 중 하나가 보일 때까지 기다린 뒤 판단한다.
export async function reportBoxesInChip(page){
  await expect(page.locator(`${CHIP}:visible, ${BAR}:visible`).first()).toBeVisible();
  return page.locator(CHIP).isVisible();
}
// 상자가 보이게 한다(칩이면 창을 연다). 칩이었으면 true.
// 칩/네 개는 실제 폭으로 정해지므로(스크롤 막대가 생기는 등 폭이 바뀌면 다시 잼) 판단과 누르기를 한 묶음으로 다시 해 본다.
export async function openReportBoxes(page){
  let inChip=false;
  await expect(async()=>{
    inChip=await reportBoxesInChip(page);
    const chip=page.locator(CHIP);
    if(inChip&&await chip.getAttribute('aria-expanded')!=='true')await chip.click({timeout:1000});
    await expect(page.locator(BAR)).toBeVisible({timeout:1000});
  }).toPass();
  return inChip;
}
// 연 창을 닫는다(칩을 다시 누름). 열려 있지 않으면 그대로.
export async function closeReportBoxes(page){
  const chip=page.locator(CHIP);
  if(await chip.isVisible()&&await chip.getAttribute('aria-expanded')==='true'){await chip.click();await expect(chip).toHaveAttribute('aria-expanded','false')}
}
// 상자 하나에서 고른다(칩이면 창을 열고 고름 → 창은 저절로 닫힘).
export async function pickReportBox(page,selector,value){
  await openReportBoxes(page);
  await page.locator(selector).selectOption(value);
}
