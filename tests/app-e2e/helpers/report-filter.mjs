import {expect} from '@playwright/test';
// S52-22 TEAM-맨위한줄: 사업 보고 사업영역·회의명 고르기는 맨 위 한 줄의 공용 고르기 상자(<select>)다(예전 [거르기 ▾] 창은 없앰).
// - 사업영역: #reportAreaSelect(전체·각 사업영역·사업영역 없음).
// - 회의명: 폰·폴드(~1199px)는 [종류 ▾](#reportKindSelect) 안 '회의명' 묶음(값 'name:…', 회의명 전체 = 'kind:meeting'), PC(1200px~)는 #reportNameSelect.
// 시험은 사람이 하듯 상자에서 고른다. 줄 글자는 첫 줄을 '전체'로 맞춰 돌려준다.
const pcWide=page=>(page.viewportSize()?.width||0)>=1200;
export const reportAreaSelect=page=>page.locator('#reportAreaSelect');
export const reportNameSelect=page=>page.locator(pcWide(page)?'#reportNameSelect':'#reportKindSelect');
export const reportFilterSelect=(page,key)=>key==='area'?reportAreaSelect(page):reportNameSelect(page);
async function nameValue(page,pick){
  if(typeof pick==='object'){
    const sel=reportNameSelect(page),opts=pcWide(page)?sel.locator('option'):sel.locator('optgroup[label="회의명"] option');
    const values=await opts.evaluateAll((els,label)=>els.filter(e=>e.textContent.trim()===label).map(e=>e.value),pick.label);
    if(!values.length)throw new Error('회의명 줄 없음: '+pick.label);return values[0];
  }
  if(pcWide(page))return pick;
  return pick==='all'?'kind:meeting':'name:'+pick;
}
// pick: 값('all'·'__none__'·회의명·사업영역 id) 또는 {label}.
export async function pickReportFilter(page,key,pick){
  const sel=reportFilterSelect(page,key);await expect(sel).toBeVisible();
  if(key==='area'){if(typeof pick==='object')await sel.selectOption({label:pick.label});else await sel.selectOption(pick);return}
  await sel.selectOption(await nameValue(page,pick));
}
// 한 묶음의 줄 글자(순서대로, 첫 줄은 '전체').
export async function reportFilterLabels(page,key){
  const sel=reportFilterSelect(page,key);
  if(key==='name'&&!pcWide(page))return ['전체',...(await sel.locator('optgroup[label="회의명"] option').allTextContents()).map(t=>t.trim())];
  const labels=(await sel.locator('option').allTextContents()).map(t=>t.trim());labels[0]='전체';return labels;
}
// 지금 고를 수 있는 묶음 이름들('area'·'name').
export async function reportFilterKeys(page){
  const keys=[];
  if(await reportAreaSelect(page).isVisible().catch(()=>false))keys.push('area');
  if(pcWide(page)){if(await page.locator('#reportNameSelect').isVisible().catch(()=>false))keys.push('name')}
  else if(await page.locator('#reportKindSelect optgroup[label="회의명"]').count())keys.push('name');
  return keys;
}
// 고른 줄의 글자.
export async function reportFilterPicked(page,key){return reportFilterSelect(page,key).evaluate(s=>s.selectedOptions[0]?.textContent.trim()||'')}
// 종류 고르기: PC(1200px~)는 칩, 그 아래 폭은 [종류 ▾] 상자. label은 칩 글자('전체'·'회의'·'언론' …).
export async function pickReportKind(page,label){
  const chip=page.locator('#reportKindFilter').getByRole('radio',{name:label,exact:true});
  if(await chip.isVisible().catch(()=>false)){await chip.click();return}
  const sel=page.locator('#reportKindSelect');await expect(sel).toBeVisible();
  await sel.selectOption({label:label==='전체'?'종류 전체':label});
}
// 지금 고른 종류 글자(칩이면 고른 칩, 상자면 고른 줄; '종류 전체'는 '전체').
export async function pickedReportKind(page){
  const chip=page.locator('#reportKindFilter [aria-checked="true"]');
  if(await chip.isVisible().catch(()=>false))return (await chip.textContent()).trim();
  const t=await page.locator('#reportKindSelect').evaluate(s=>s.selectedOptions[0]?.closest('optgroup')?'회의':s.selectedOptions[0]?.textContent.trim()||'');
  return t==='종류 전체'?'전체':t;
}
