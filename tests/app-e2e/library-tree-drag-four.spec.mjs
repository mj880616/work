import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder} from './helpers/library-folder-server.mjs';
// S55-08 LIB-나무로끌기안됨 + LIB-폴더이름칸닫힘 (2026-11-09 명진 요청).
// 끌기는 실제 브라우저 끌기(Playwright 마우스 끌기 → 크롬 HTML 끌어 놓기)로 네 방향을 본다:
//   ⓐ 오른쪽 자료 → 왼쪽 나무 폴더  ⓑ 왼쪽 나무 폴더 → 오른쪽 목록 폴더  ⓒ 오른쪽 자료 → 오른쪽 폴더  ⓓ 왼쪽 나무 폴더 → 왼쪽 나무 다른 폴더
// 자기·자기 아래 폴더 안으로는 막고, 화면이 모르는 폴더는 '폴더 밖'으로 바꿔 받지 않는다. 이름은 지어낸 것.
const FOLDERS=[
  libFolder('fa','top-a',{name:'가상 A',sort_order:1024}),
  libFolder('fc','child-a1',{name:'가상 C',parent_id:'fa',sort_order:0}),
  libFolder('fn',null,{name:'가상 N',sort_order:2048}),
  libFolder('fz',null,{name:'가상 Z',sort_order:3072})
];
const ITEMS=[{document_id:'a-1',folder_id:'fc'},{document_id:'n-1',folder_id:'fa'}];
const nav=id=>`#libraryFolderNav [data-lu-nav="${id}"]`;
const row=id=>`#documentList [data-lu-document="${id}"]`;
const head=key=>`#documentList details[data-lu-node="${key}"] > summary`;
const line=page=>page.locator('#libraryFolderStatusLine');
const openNode=(page,key)=>page.locator(`#documentList details[data-lu-node="${key}"]`).evaluate(d=>{d.open=true});
const folderOf=(s,doc)=>s.items.find(x=>x.document_id===doc)?.folder_id||null;
const parentOf=(s,id)=>s.folders.find(f=>f.id===id)?.parent_id||null;

for(const width of [1440,884])test.describe(`자료실 ${width} 두 칸 폴더 보기 끌어 옮기기 네 방향`,()=>{
  test('ⓐ 오른쪽 자료 → 왼쪽 나무 폴더, ⓒ 오른쪽 자료 → 오른쪽 폴더, 나무 \'자료실 전체\' = 폴더 밖',async({page})=>{
    test.setTimeout(90000);
    const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,group:'폴더'});
    await expect(page.locator('#libraryFolderNav')).toBeVisible();
    await expect(page.locator(nav('fn'))).toHaveAttribute('draggable','true');
    // ⓐ
    await openNode(page,'x:out');
    await page.locator(row('a-2')).dragTo(page.locator(nav('fn')));
    await expect.poll(()=>folderOf(s,'a-2')).toBe('fn');
    await expect(line(page)).toContainText('가상 N 폴더');await expect(line(page).locator('.lu-undo')).toHaveText('되돌리기');
    // ⓒ
    await openNode(page,'x:out');
    await page.locator(row('a1-1')).dragTo(page.locator(head('f:fz')));
    await expect.poll(()=>folderOf(s,'a1-1')).toBe('fz');
    await expect(line(page)).toContainText('가상 Z 폴더');
    // 폴더 안 자료를 나무 '자료실 전체'에 놓으면 폴더 밖으로.
    await openNode(page,'f:fn');
    await page.locator(row('a-2')).dragTo(page.locator(nav('')));
    await expect.poll(()=>folderOf(s,'a-2')).toBeNull();
    await expect(line(page)).toContainText('폴더 밖');
    // 이미 든 폴더(나무 줄)에는 놓을 수 없다: 쓰기 없음.
    await openNode(page,'f:fz');const n=s.writes.length;
    await page.locator(row('a1-1')).dragTo(page.locator(nav('fz')));
    await page.waitForLoadState('networkidle');expect(s.writes.length).toBe(n);
    expect(errors).toEqual([]);
  });

  test('ⓑ 왼쪽 나무 폴더 → 오른쪽 목록 폴더, ⓓ 왼쪽 나무 폴더 → 왼쪽 나무 다른 폴더, 자기·자기 아래는 막음',async({page})=>{
    test.setTimeout(90000);
    const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,group:'폴더'});
    // ⓓ 가상 N → 가상 Z(나무 → 나무)
    await page.locator(nav('fn')).dragTo(page.locator(nav('fz')));
    await expect.poll(()=>parentOf(s,'fn')).toBe('fz');
    await expect(line(page)).toContainText('폴더를 옮겼어요 → 가상 Z 폴더');
    // ⓑ 가상 Z(나무) → 오른쪽 목록의 가상 A 머리
    await page.locator(nav('fz')).dragTo(page.locator(head('f:fa')));
    await expect.poll(()=>parentOf(s,'fz')).toBe('fa');
    await expect(line(page)).toContainText('가상 A 폴더');
    // 자기 아래(가상 A 안의 가상 C)로 가상 A를 넣을 수 없고, 자기 자신에도 놓을 수 없다.
    await page.locator(nav('fa')).click();await expect(page.locator(nav('fc'))).toBeVisible();
    const n=s.writes.length;
    await page.locator(nav('fa')).dragTo(page.locator(nav('fc')));
    await page.locator(nav('fa')).dragTo(page.locator(nav('fa')),{targetPosition:{x:40,y:8}});
    await page.waitForLoadState('networkidle');expect(s.writes.length).toBe(n);
    expect(parentOf(s,'fa')).toBeNull();
    // 나무 '자료실 전체'에 놓으면 맨 위로.
    await page.locator(nav('fz')).dragTo(page.locator(nav('')));
    await expect.poll(()=>parentOf(s,'fz')).toBeNull();
    await expect(line(page)).toContainText('맨 위');
    expect(errors).toEqual([]);
  });
});

for(const width of [1440,884,412])test(`자료실 ${width}: 폴더 이름 칸 안을 눌러도 닫히지 않고 커서를 옮겨 고친 뒤 Enter로 저장`,async({page})=>{
  test.setTimeout(60000);
  const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,group:'폴더'});
  const details=page.locator('#documentList details[data-lu-node="f:fn"]');
  const wasOpen=await details.evaluate(d=>d.open);
  await page.locator(head('f:fn')).focus();await page.keyboard.press('F2');
  const input=page.locator(head('f:fn')+' input.lu-folder-rename');await expect(input).toBeFocused();
  const box=await input.boundingBox();
  // 칸 안 맨 앞을 누르면 닫히지 않고 커서가 맨 앞으로 간다.
  await page.mouse.click(box.x+3,box.y+box.height/2);
  await expect(input).toBeFocused();
  expect(await input.evaluate(i=>[i.selectionStart,i.selectionEnd])).toEqual([0,0]);
  expect(await details.evaluate(d=>d.open)).toBe(wasOpen);
  // 두 번 눌러 단어 고르기(PC).
  if(width>=761){await input.dblclick({position:{x:Math.min(20,box.width/2),y:box.height/2}});await expect(input).toBeFocused();expect(await input.evaluate(i=>i.selectionEnd-i.selectionStart)).toBeGreaterThan(0);expect(await details.evaluate(d=>d.open)).toBe(wasOpen)}
  await input.press('Home');await page.keyboard.type('새 ');
  await page.keyboard.press('Enter');
  await expect.poll(()=>s.folders.find(f=>f.id==='fn').name).toBe('새 가상 N');
  await expect(page.locator(head('f:fn')+' .lu-node-name')).toHaveText('새 가상 N');
  expect(errors).toEqual([]);
});

test('자료실 1440: 자료 이름 칸(줄 안 이름 바꾸기) 안을 눌러도 닫히지 않는다',async({page})=>{
  test.setTimeout(60000);
  const {s,errors}=await bootLibrary(page,1440,{folders:FOLDERS,items:ITEMS,group:'폴더'});
  await openNode(page,'x:out');
  await page.locator(row('a-2')).focus();await page.keyboard.press('F2');
  const input=page.locator(row('a-2')+' input.lu-rename-input, '+row('a-2')+' input.fr-input').first();
  await expect(input).toBeFocused();
  const box=await input.boundingBox();await page.mouse.click(box.x+3,box.y+box.height/2);
  await expect(input).toBeFocused();
  expect(await input.evaluate(i=>i.selectionStart)).toBe(0);
  await page.keyboard.press('Escape');await expect(input).toHaveCount(0);
  expect(s.writes).toEqual([]);
  expect(errors).toEqual([]);
});
