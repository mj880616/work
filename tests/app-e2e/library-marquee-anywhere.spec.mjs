import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder,libDoc} from './helpers/library-folder-server.mjs';
import {screenFind} from './helpers/screen-find.mjs';
import { treeEnter } from './helpers/tree-enter.mjs';
// S69(명진 11/24): 자료실 한 칸 탐색기(왼쪽 나무 | 오른쪽 그 폴더 내용)에서
// ① "드래그가 저 창 안에서만 되는데 창 밖에서도 창 안으로" · "이 드래그가 어느곳에서든 자유롭게" — 사각형 고르기를 카드 아래 빈 바탕·왼쪽 나무 칸 빈 곳에서도 시작,
//    사각형은 칸 경계에 갇히지 않고 오른쪽 목록 줄(자료 줄·하위 폴더 줄)에 닿은 것을 고른다. 줄 위 시작 = 끌어 옮기기 그대로, 단추 위 시작 = 사각형 없음.
// ② "선택된거 클릭하면 선택해제돼야지" — 고르는 중 ✓ 줄을 다시 누르면 풀리고, 폴더 줄 본문도 고르기·풀기, '−'(일부) 폴더를 누르면 그 안 것 모두 풀림.
// 이름은 모두 지어낸 것이다. 가짜 서버만 쓴다.
const FOLDERS=[0,1,2,3].map(i=>libFolder('f'+i,null,{name:'가상 묶음 '+i,sort_order:1024*(i+1)}));
const DOCS=[libDoc('a1',null),libDoc('a2',null),libDoc('b1',null),libDoc('c1',null),libDoc('e1',null),libDoc('o1',null,{title:'가상 밖 1'}),libDoc('o2',null,{title:'가상 밖 2'}),libDoc('o3',null,{title:'가상 밖 3'})];
const ITEMS=[{document_id:'a1',folder_id:'f0'},{document_id:'a2',folder_id:'f0'},{document_id:'b1',folder_id:'f1'},{document_id:'c1',folder_id:'f2'},{document_id:'e1',folder_id:'f3'}];
const OUT=['o1','o2','o3'];
const count=page=>page.locator('#librarySelectCount');
const docRow=id=>`#documentList .lu-row[data-lu-document="${id}"]`;
const folderRow=key=>`#documentList details[data-lu-enter][data-lu-node="${key}"] > summary`;
const box=(page,sel)=>page.locator(sel).first().evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,x:r.left+r.width/2,y:r.top+r.height/2}});
const checkedDocs=page=>page.locator('#documentList [data-lu-pick]').evaluateAll(xs=>xs.filter(x=>x.checked).map(x=>x.dataset.luPick).sort());
const nodeState=(page,key)=>page.locator(`#documentList [data-lu-pick-node="${key}"]`).evaluate(x=>x.checked?'✓':x.indeterminate?'−':'');
async function boot(page){
  const r=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS,docs:DOCS,init:{viewPrefs:{library_two:false}}});
  await page.locator('#libraryGroupBy').selectOption({label:'폴더'});
  await expect(page.locator('#libraryFolderNav')).toBeVisible();
  for(const id of OUT)await expect(page.locator(docRow(id))).toBeVisible();
  await expect(page.locator(folderRow('f:f3'))).toBeVisible();
  return r;
}
// from → to(점 또는 그때 재는 함수). 처음 고르면 위에 선택 막대가 나타나 줄이 조금 내려가므로, 사람처럼 그 뒤 화면을 보고 끝점을 잡는다.
async function marquee(page,from,to,mods=[]){
  for(const k of mods)await page.keyboard.down(k);
  await page.mouse.move(from.x,from.y);await page.mouse.down();
  await page.mouse.move(from.x+8,from.y-8,{steps:3});
  await expect(page.locator('.marquee-box')).toBeVisible();
  if(typeof to==='function'){const first=await to();await page.mouse.move(first.x,first.y,{steps:6});await page.waitForTimeout(80);to=await to()}
  await page.mouse.move(to.x,to.y,{steps:6});
  await page.mouse.up();
  for(const k of mods)await page.keyboard.up(k);
  await expect(page.locator('.marquee-box')).toHaveCount(0);
}

test('PC 1280 한 칸: 카드 아래 빈 바탕에서 끌어 자료 줄 3개를 덮으면 3개가 골라진다(사각형은 카드 밖에서도 그려짐)',async({page})=>{
  test.setTimeout(60000);
  const {errors}=await boot(page);
  const card=await box(page,'#libraryListCard');
  const list=await box(page,'#documentList');
  expect(await page.evaluate(()=>innerHeight)).toBeGreaterThan(card.bottom+40); // 카드 아래 빈 바탕이 있다
  const from={x:list.x,y:card.bottom+24};
  // 시작점은 카드 밖(자료실 화면 바탕).
  expect(await page.evaluate(({x,y})=>{const t=document.elementFromPoint(x,y);return !document.querySelector('#libraryListCard').contains(t)&&!t.closest('.app-nav')},from)).toBe(true);
  await page.mouse.move(from.x,from.y);await page.mouse.down();
  await page.mouse.move(from.x+8,from.y-30,{steps:3});
  // 사각형은 창 기준 — 카드 밖 시작점부터 그려진다(칸 경계에 잘리지 않음).
  const mb=await box(page,'.marquee-box');
  expect(mb.bottom).toBeGreaterThan(card.bottom+10);
  // 처음 고르면 위에 선택 막대가 나타나 줄이 내려간다 — 그 뒤 화면에서 o1 가운데를 다시 잰다.
  let o1=await box(page,docRow('o1'));
  await page.mouse.move(from.x+40,o1.y,{steps:8});
  await expect(page.locator('#librarySelectBar')).toBeVisible();
  await page.waitForTimeout(80);
  o1=await box(page,docRow('o1'));
  await page.mouse.move(from.x+40,o1.y,{steps:4});
  await page.mouse.up();
  await expect(page.locator('.marquee-box')).toHaveCount(0);
  await expect(page.locator('#librarySelectBar')).toBeVisible();
  await expect(count(page)).toHaveText('3개 선택됨');
  expect(await checkedDocs(page)).toEqual(OUT);
  // 끈 뒤 떼어도 자료가 열리지 않는다.
  await expect(page.locator('#libraryPreviewModal:not(.hidden), .lu-viewer:visible')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('PC 1280 한 칸: 왼쪽 나무 칸 빈 곳에서 시작해 오른쪽 폴더 줄을 덮으면 그 폴더가 폴더째 골라진다',async({page})=>{
  test.setTimeout(60000);
  const {errors}=await boot(page);
  const nav=await box(page,'#libraryFolderNav');
  const lastTree=await box(page,'#libraryFolderNav .ft-row >> nth=-1');
  const card=await box(page,'#libraryListCard');
  const o3=await box(page,docRow('o3'));
  const from={x:nav.left+40,y:Math.max(lastTree.bottom+10,o3.bottom+6)};
  expect(from.y).toBeLessThan(card.bottom-2); // 카드 안, 나무 줄 아래 빈 곳
  expect(from.x).toBeLessThan((await box(page,'#documentList')).left); // 왼쪽 나무 칸 쪽
  expect(await page.evaluate(({x,y})=>{const t=document.elementFromPoint(x,y);return !t.closest('.ft-row,#documentList')},from)).toBe(true);
  // 오른쪽 '가상 묶음 1'·'가상 묶음 2' 줄까지(위로·오른쪽으로) 끈다.
  await marquee(page,from,async()=>{const f1=await box(page,folderRow('f:f1'));return {x:f1.left+60,y:f1.y}});
  // f1 아래(f2·f3·자료 줄 o1~o3)까지 덮였다: 폴더 f1·f2·f3(폴더째 — S69-69 LIB-사각형폴더) + 자료 o1~o3.
  await expect(count(page)).toHaveText('폴더 3 · 파일 3 선택됨');
  await expect(page.locator(folderRow('f:f1'))).toHaveClass(/lu-folder-picked/);
  expect(await nodeState(page,'f:f1')).toBe('✓');
  expect(await nodeState(page,'f:f0')).toBe('');
  expect(await checkedDocs(page)).toEqual(OUT);
  expect(errors).toEqual([]);
});

test('PC 1280 한 칸: 자료 줄 위에서 시작하면 사각형 없이 끌어 옮기기, 단추 위에서 시작하면 사각형 없음',async({page})=>{
  test.setTimeout(60000);
  const {s,errors}=await boot(page);
  // 단추(오른쪽 위 [한 칸]) 위에서 끌기 → 사각형 없음.
  const b=await box(page,'#libraryOneBtn');
  await page.mouse.move(b.x,b.y);await page.mouse.down();
  await page.mouse.move(b.x+10,b.y+80,{steps:5});
  await expect(page.locator('.marquee-box')).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator('#librarySelectBar')).toBeHidden();
  // 검색칸에 초점이 있을 때 카드 아래 빈 바탕을 누르면 보통처럼 초점이 빠진다(빈 곳 누르기가 글자 고르기만 막고 초점은 놓는다).
  await (await screenFind(page)).focus();
  const card=await box(page,'#libraryListCard');
  await page.mouse.click(card.x,card.bottom+20);
  await expect((await screenFind(page))).not.toBeFocused();
  // 자료 줄 이름 위에서 끌어 왼쪽 나무 '가상 묶음 3'에 놓기 → 옮겨진다(사각형 없음).
  const t=await box(page,docRow('o2')+' .lu-row-title');
  const to=await box(page,'#libraryFolderNav [data-lu-nav="f3"]');
  await page.mouse.move(t.left+10,t.y);await page.mouse.down();
  await page.mouse.move(t.left+10,t.y+12,{steps:3});
  await expect(page.locator('.marquee-box')).toHaveCount(0);
  await page.mouse.move(to.x,to.y,{steps:10});
  await page.mouse.up();
  await expect.poll(()=>s.items.find(x=>x.document_id==='o2')?.folder_id||null).toBe('f3');
  await expect(page.locator('#librarySelectBar')).toBeHidden();
  expect(errors).toEqual([]);
});

test('PC 1280 한 칸: 고르는 중 ✓ 줄·폴더 줄을 다시 누르면 풀리고, \'−\' 폴더를 누르면 그 안 것이 모두 풀린다',async({page})=>{
  test.setTimeout(60000);
  const {errors}=await boot(page);
  // '가상 묶음 0'에 들어가 a1만 고른 뒤(Ctrl+클릭) 맨 위로 — 묶음 0 칸은 '−'(일부).
  await treeEnter(page.locator('#libraryFolderNav [data-lu-nav="f0"]'));
  await expect(page.locator(docRow('a1'))).toBeVisible();
  await page.locator(docRow('a1')+' .lu-row-title').click({modifiers:['Control']});
  await expect(count(page)).toHaveText('1개 선택됨');
  await page.locator('#libraryFolderNav .lu-fnav-root [data-lu-nav]').click();
  await expect(page.locator(docRow('o1'))).toBeVisible();
  await expect(count(page)).toHaveText('1개 선택됨 — 접힌 1개 포함');
  expect(await nodeState(page,'f:f0')).toBe('−');
  // 자료 줄 o1 누르기 = 고름, 다시 누르기 = 풀림(숫자도 같이).
  await page.locator(docRow('o1')+' .lu-row-title').click();
  await expect(count(page)).toHaveText('2개 선택됨 — 접힌 1개 포함');
  await page.locator(docRow('o1')+' .lu-row-title').click();
  await expect(count(page)).toHaveText('1개 선택됨 — 접힌 1개 포함');
  expect(await checkedDocs(page)).toEqual([]);
  // 체크칸도 같다.
  await page.locator('#documentList [data-lu-pick="o2"]').click();
  await expect(page.locator('#documentList [data-lu-pick="o2"]')).toBeChecked();
  await page.locator('#documentList [data-lu-pick="o2"]').click();
  await expect(page.locator('#documentList [data-lu-pick="o2"]')).not.toBeChecked();
  await expect(count(page)).toHaveText('1개 선택됨 — 접힌 1개 포함');
  // 폴더 줄 본문(이름) 누르기 = 그 폴더 고르기(들어가지 않음), 다시 누르기 = 풀기.
  await page.locator(folderRow('f:f1')).click();
  await expect(page.locator(docRow('o1'))).toBeVisible(); // 그대로 맨 위
  expect(await nodeState(page,'f:f1')).toBe('✓');
  await expect(count(page)).toHaveText('2개 선택됨 — 접힌 2개 포함');
  await page.locator(folderRow('f:f1')).click();
  expect(await nodeState(page,'f:f1')).toBe('');
  await expect(count(page)).toHaveText('1개 선택됨 — 접힌 1개 포함');
  // '−' 폴더(묶음 0) 체크칸 누르기 = 그 안 것 모두 풀림.
  await page.locator('#documentList [data-lu-pick-node="f:f0"]').click();
  expect(await nodeState(page,'f:f0')).toBe('');
  await expect(count(page)).toHaveText('0개 선택됨');
  // 아무것도 없을 때 폴더 칸 누르기 = 모두 고름(✓), 다시 = 모두 풀림.
  await page.locator('#documentList [data-lu-pick-node="f:f0"]').click();
  expect(await nodeState(page,'f:f0')).toBe('✓');
  await expect(count(page)).toHaveText('2개 선택됨 — 접힌 2개 포함');
  await page.locator(folderRow('f:f0')).click();
  expect(await nodeState(page,'f:f0')).toBe('');
  await expect(count(page)).toHaveText('0개 선택됨');
  expect(errors).toEqual([]);
});
