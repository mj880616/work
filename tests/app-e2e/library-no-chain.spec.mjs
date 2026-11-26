import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder,libDoc} from './helpers/library-folder-server.mjs';
import { treeEnter } from './helpers/tree-enter.mjs';
// LIB-외줄합치기없애기(명진 2026-11-26 08:43 '합치기를 없애기'): 파일 없이 하위 폴더 하나만 든 폴더도 '가 › 나'로 접지 않는다.
// 어디서나(PC 한 칸 탐색기 왼쪽·오른쪽, PC 두 칸, 폰) '07. 사업 · 폴더 1'(그 폴더 자신의 개수)로 보이고, 누르면 안에 '2026 사업'이 나온다. 이름은 지어낸 것.
const FOLDERS=[
  libFolder('s1',null,{name:'07. 사업',sort_order:1024}),
  libFolder('s2',null,{name:'2026 사업',parent_id:'s1',sort_order:0}),
  libFolder('k1',null,{name:'가상 갈래 1',parent_id:'s2',sort_order:0}),
  libFolder('k2',null,{name:'가상 갈래 2',parent_id:'s2',sort_order:1}),
  libFolder('k3',null,{name:'가상 갈래 3',parent_id:'s2',sort_order:2}),
  libFolder('o1',null,{name:'가상 다른 폴더',sort_order:2048})
];
const DOCS=[libDoc('d1',null),libDoc('d2',null)];
const ITEMS=[{document_id:'d1',folder_id:'k1'},{document_id:'d2',folder_id:'o1'}];
const head=key=>`#documentList details[data-lu-node="${key}"] > summary`;
async function boot(page,width,two=false){
  const r=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,docs:DOCS,init:{viewPrefs:{library_two:two}}});
  await page.locator('#libraryGroupBy').selectOption({label:'폴더'});
  return r;
}
// 폴더 줄 머리에 '›' 경로·외줄 표시가 없고 이름·개수가 그 폴더 자신의 것.
async function plainRow(page,key,name,count){
  await expect(page.locator(`${head(key)} .lu-node-name`)).toHaveText(name);
  await expect(page.locator(`${head(key)} .lu-node-count`)).toHaveText(count);
  await expect(page.locator(head(key))).not.toContainText('›');
}
const noChainLeft=async page=>{
  await expect(page.locator('#documentList .lu-chain-rest, #documentList [data-lu-chain]')).toHaveCount(0);
};

test('PC 1280 한 칸 탐색기: 왼쪽·오른쪽 모두 "07. 사업 · 폴더 1", 오른쪽에서 누르면 안에 "2026 사업"',async({page})=>{
  const {errors}=await boot(page,1280);
  await expect(page.locator('#libraryFolderNav')).toBeVisible();
  // 왼쪽 나무: 이름 그대로, '›' 없음.
  const leftRow=page.locator('#libraryFolderNav [data-lu-nav="s1"]').locator('xpath=ancestor::div[contains(@class,"ft-row")][1]');
  await expect(leftRow).toContainText('07. 사업');await expect(leftRow).not.toContainText('›');
  // 오른쪽(자료실 맨 위): 같은 모양, 개수는 그 폴더 자신의 것(하위 폴더 1).
  await plainRow(page,'f:s1','07. 사업','폴더 1');
  await noChainLeft(page);
  // 누르면 그 자리 펼치기 → 안에 '2026 사업'(자기 줄, 자기 개수).
  await page.locator(head('f:s1')).click();
  await expect(page.locator('#documentList details[data-lu-node="f:s1"]')).toHaveAttribute('open','');
  await expect(page.locator(head('f:s2'))).toBeVisible();
  await plainRow(page,'f:s2','2026 사업','폴더 3');
  // 다시 누르면 접힘(펼치기·접기 동작 그대로).
  await page.locator(head('f:s1')).click();
  await expect(page.locator('#documentList details[data-lu-node="f:s1"]')).not.toHaveAttribute('open','');
  // 왼쪽 나무로 들어가기도 그대로: 오른쪽에 '2026 사업' 한 줄.
  await treeEnter(page.locator('#libraryFolderNav [data-lu-nav="s1"]'));
  await expect(page.locator('#libraryPath')).toContainText('07. 사업');
  await plainRow(page,'f:s2','2026 사업','폴더 3');
  await noChainLeft(page);
  expect(errors).toEqual([]);
});

test('PC 1440 두 칸: 양쪽 칸 모두 "07. 사업"만(›없음), 들어가면 "2026 사업"',async({page})=>{
  const {errors}=await boot(page,1440,true);
  await expect(page.locator('#documentList [data-lu-two]')).toBeVisible();
  for(const i of [0,1]){
    const row=page.locator(`#documentList [data-lu-pane-i="${i}"] [data-lu-nav="s1"]`).locator('xpath=ancestor::div[contains(@class,"ft-row")][1]');
    await expect(row).toContainText('07. 사업');await expect(row).not.toContainText('2026 사업');await expect(row).not.toContainText('›');
  }
  await page.locator('#documentList [data-lu-pane-i="1"] [data-lu-nav="s1"]').click({button:'right'});
  await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click();
  await expect(page.locator('#documentList [data-lu-pane-i="1"] .lu-pane-here')).toHaveText('07. 사업');
  await expect(page.locator('#documentList [data-lu-pane-i="1"] [data-lu-nav="s2"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('폰 390: "07. 사업 · 폴더 1"(›없음), 누르면 그 자리에서 안에 "2026 사업"',async({page})=>{
  const {errors}=await boot(page,390);
  await plainRow(page,'f:s1','07. 사업','폴더 1');
  await noChainLeft(page);
  await page.locator(`${head('f:s1')} .lu-node-name`).click({force:true});
  await expect(page.locator('#documentList details[data-lu-node="f:s1"]')).toHaveAttribute('open','');
  await expect(page.locator(head('f:s2'))).toBeVisible();
  await plainRow(page,'f:s2','2026 사업','폴더 3');
  // 한 단계 더 펼쳐도 따로 줄(이어 펼치지 않음).
  await expect(page.locator('#documentList details[data-lu-node="f:s2"]')).not.toHaveAttribute('open','');
  expect(errors).toEqual([]);
});
