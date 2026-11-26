import {expect} from '@playwright/test';
// S67-75 UI-걸러보기칩하나(2026-11-21 명진 A안): 폰 사업 관리 윗줄의 고르기 상자 네 개(종류·사업영역·기간·보기)는 줄에 다 안 들어가면
// 칩 하나(#reportFilterChip)로 묶이고, 상자는 그 칩이 여는 작은 창에 있다. 하나를 고르면 반영되고 창은 닫힌다.
// 시험은 사람이 하듯: 칩이 보이면 칩을 눌러 창을 열고 상자에서 고른다. 다 들어가는 폭(폴드 펼침·PC)은 칩이 없어 그대로 고른다.
const CHIP='#reportFilterChip',BAR='#reportFilterBar'; // BIZ-머리한줄(S71-23): 첫 줄은 폰·폴드에서 앱 머리 줄로 가므로 #meetingsView 안이라고 가정하지 않는다
// 칩 하나인지(상자가 창 안에 있는지). 칩과 상자 줄 중 하나가 보일 때까지 기다린 뒤 판단한다.
// BIZ-머리한줄(S71-23): 첫 줄이 앱 머리 줄로 옮겨 간 직후 한 그림 차례 동안 상자 네 개가 넘친 채 보일 수 있다(다음 차례에 칩으로 묶음) —
// 상자 쪽은 줄에 다 들어가 있을 때만 '네 개'로 본다(openReportBoxes와 같은 기준).
export async function reportBoxesInChip(page){
  await expect.poll(async()=>await page.locator(CHIP).isVisible()||(await page.locator(BAR).isVisible()&&await barFits(page))).toBe(true);
  return page.locator(CHIP).isVisible();
}
// 네 개가 줄에 다 들어가는지(화면이 칩으로 묶는 기준과 같음, report-filter-chip.js layout). 넓은 화면(761px~)은 늘 네 개.
const barFits=page=>page.locator(BAR).evaluate(bar=>matchMedia('(min-width:761px)').matches||bar.scrollWidth<=bar.clientWidth+1);
// 상자가 보이게 한다(칩이면 창을 연다). 칩이었으면 true. want: 꼭 보여야 하는 상자(선택).
// 칩/네 개는 실제 폭으로 정해지므로(스크롤 막대가 생기는 등 폭이 바뀌면 다시 잼) 판단과 누르기를 한 묶음으로 다시 해 본다.
// S68-47: 사업 관리가 막 보인 순간에는 칩이 아직 숨은 채 네 개가 넘치게 놓여 있다가(화면이 폭을 재는 다음 그림 차례에 칩으로 묶음)
// 바뀐다. 그 순간을 '네 개'로 판단하면 곧 상자 줄이 숨어 기간 상자가 끝내 안 보였다(CI 390에서 실패). 네 개로 판단할 때는
// 화면 기준대로 줄에 다 들어가 있어야 하고(넘치면 곧 칩으로 바뀌므로 다시 판단), 고를 상자가 실제로 보여야 끝낸다.
export async function openReportBoxes(page,want=null){
  let inChip=false;
  await expect(async()=>{
    inChip=await reportBoxesInChip(page);
    const chip=page.locator(CHIP);
    if(inChip&&await chip.getAttribute('aria-expanded')!=='true')await chip.click({timeout:1000});
    await expect(page.locator(BAR)).toBeVisible({timeout:1000});
    if(!inChip)expect(await barFits(page)).toBe(true);
    if(want)await expect(want).toBeVisible({timeout:1000});
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
  await openReportBoxes(page,page.locator(selector));
  await page.locator(selector).selectOption(value);
}
