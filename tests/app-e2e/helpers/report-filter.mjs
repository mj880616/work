import {expect} from '@playwright/test';
// S52-22 TEAM-맨위한줄: 사업 보고 사업영역·회의명 고르기는 맨 위 한 줄의 공용 고르기 상자(<select>)다(예전 [거르기 ▾] 창은 없앰).
// - 사업영역: #reportAreaSelect(전체·각 사업영역·사업영역 없음).
// - 회의명: 모든 폭에서 [종류 ▾](#reportKindSelect) 안 '회의명' 묶음(값 'name:…', 회의명 전체 = 'kind:meeting').
//   BIZ-위쪽정돈PC(명진 11/09 10:52 A): PC(1200px~)의 종류 칩 줄·[회의명 ▾](#reportNameSelect) 상자는 없앴다 — 폰과 같은 상자 하나.
// 시험은 사람이 하듯 상자에서 고른다. 줄 글자는 첫 줄을 '전체'로 맞춰 돌려준다.
export const reportAreaSelect=page=>page.locator('#reportAreaSelect');
export const reportNameSelect=page=>page.locator('#reportKindSelect');
export const reportFilterSelect=(page,key)=>key==='area'?reportAreaSelect(page):reportNameSelect(page);
async function nameValue(page,pick){
  if(typeof pick==='object'){
    const opts=reportNameSelect(page).locator('optgroup[label="회의명"] option');
    const values=await opts.evaluateAll((els,label)=>els.filter(e=>e.textContent.trim()===label).map(e=>e.value),pick.label);
    if(!values.length)throw new Error('회의명 줄 없음: '+pick.label);return values[0];
  }
  return pick==='all'?'kind:meeting':'name:'+pick;
}
// pick: 값('all'·'__none__'·회의명·사업영역 id) 또는 {label}.
export async function pickReportFilter(page,key,pick){
  const sel=reportFilterSelect(page,key);await expect(sel).toBeVisible();
  if(key==='area'){if(typeof pick==='object')await sel.selectOption({label:pick.label});else await sel.selectOption(pick);return}
  // MTG-기본종류전체(11/15 명진): 사업 보고는 [종류 전체]로 열린다. 회의명 묶음은 [회의]를 고른 뒤에만 있으므로 사람처럼 [회의]부터 고른다.
  if(!(await sel.locator('optgroup[label="회의명"]').count())&&await sel.inputValue()!=='kind:meeting'){await sel.selectOption('kind:meeting');await expect(sel).toHaveValue('kind:meeting')}
  await sel.selectOption(await nameValue(page,pick));
}
// 한 묶음의 줄 글자(순서대로, 첫 줄은 '전체').
export async function reportFilterLabels(page,key){
  const sel=reportFilterSelect(page,key);
  if(key==='name')return ['전체',...(await sel.locator('optgroup[label="회의명"] option').allTextContents()).map(t=>t.trim())];
  const labels=(await sel.locator('option').allTextContents()).map(t=>t.trim());labels[0]='전체';return labels;
}
// 지금 고를 수 있는 묶음 이름들('area'·'name').
export async function reportFilterKeys(page){
  const keys=[];
  if(await reportAreaSelect(page).isVisible().catch(()=>false))keys.push('area');
  if(await page.locator('#reportKindSelect optgroup[label="회의명"]').count())keys.push('name');
  return keys;
}
// 고른 줄의 글자.
export async function reportFilterPicked(page,key){return reportFilterSelect(page,key).evaluate(s=>s.selectedOptions[0]?.textContent.trim()||'')}
// 종류 고르기: 모든 폭에서 [종류 ▾] 상자. label은 종류 글자('전체'·'회의'·'언론' …).
export async function pickReportKind(page,label){
  const sel=page.locator('#reportKindSelect');await expect(sel).toBeVisible();
  await sel.selectOption({label:label==='전체'?'종류 전체':label});
}
// 지금 고른 종류 글자(고른 줄; 회의명 묶음이면 '회의', '종류 전체'는 '전체').
export async function pickedReportKind(page){
  const t=await page.locator('#reportKindSelect').evaluate(s=>s.selectedOptions[0]?.closest('optgroup')?'회의':s.selectedOptions[0]?.textContent.trim()||'');
  return t==='종류 전체'?'전체':t;
}
