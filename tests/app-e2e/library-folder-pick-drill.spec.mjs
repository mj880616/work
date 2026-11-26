import {test,expect} from '@playwright/test';
import {expandLibraryTree} from './helpers/library-tree.mjs';
import {bootLibrary,libFolder,libDoc,press,openMove,movePicker,moveFolder} from './helpers/library-folder-server.mjs';
import { treeEnter } from './helpers/tree-enter.mjs';
// LIB-폴더개수·LIB-폴더창들어가기(명진 11/24 18:04): ① 폴더 줄 개수는 하위 폴더가 있으면 '폴더 N · 파일 M'(M = 바로 안, 0이면 '폴더 N'),
// ② [폴더로 옮기기] 창(S69-62부터 [파일] '옮길 곳' 창)은 상위 폴더를 누르면 선택·펼치기만(옮기지 않음), [여기에 옮기기]를 눌러야 옮긴다. 닫으면 그대로.
// 이름은 모두 지어낸 것이다.
const KIDS=Array.from({length:13},(_,i)=>libFolder('o'+(i+1),null,{name:'가상 조직 '+(i+1),parent_id:'org',sort_order:1024*(i+1)}));
const FOLDERS=[libFolder('g03',null,{name:'03. 가상 궤도',sort_order:1024}),libFolder('meet',null,{name:'가상 회의',parent_id:'g03',sort_order:1024}),
  libFolder('org',null,{name:'가상 조직',parent_id:'g03',sort_order:2048}),libFolder('fight',null,{name:'가상 투쟁',parent_id:'g03',sort_order:3072}),...KIDS];
const DOCS=[libDoc('d1',null),libDoc('d2',null),libDoc('d3',null)];
const ITEMS=[{document_id:'d2',folder_id:'g03'},{document_id:'d3',folder_id:'o1'}];
const count=(page,key)=>page.locator(`#documentList details[data-lu-node="${key}"] > summary .lu-node-count`);

for(const width of [390,1280])test.describe(`폴더 개수·옮기기 창 ${width}`,()=>{
  test.use({hasTouch:width<761});

  test(`폴더 줄 개수: 하위 폴더가 있으면 '폴더 N · 파일 M', 바로 안 자료가 없으면 '폴더 N' ${width}`,async({page})=>{
    const {errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,docs:DOCS,group:'폴더'});
    if(width>=761){
      await expect(page.locator('#libraryFolderNav [data-lu-nav="g03"] .ft-num')).toHaveText('폴더 3 · 파일 1');
      await treeEnter(page.locator('#libraryFolderNav [data-lu-nav="g03"]'));
    }else{
      await expect(count(page,'f:g03')).toHaveText('폴더 3 · 파일 1');
      await expect(count(page,'f:g03')).toHaveAttribute('aria-label','폴더 3개 · 자료 1건');
      await page.locator('#documentList details[data-lu-node="f:g03"] > summary').tap();
    }
    await expect(count(page,'f:org')).toHaveText('폴더 13');
    await expect(count(page,'f:org')).toHaveAttribute('aria-label','폴더 13개');
    await expect(count(page,'f:meet')).toHaveText('0');
    await expect(count(page,'f:fight')).toHaveText('0');
    expect(errors).toEqual([]);
  });

  // S69-62: 옮기기 창은 [파일] '옮길 곳' 창 하나(folder-dest-sheet.js). 상위 폴더를 누르면 선택 + 펼치기(옮기지 않음), [여기에 옮기기]에만 옮기고, ✕면 그대로.
  test(`옮기기 창: 상위 폴더를 누르면 펼쳐지고 옮기지 않는다, 선택 뒤 [여기에 옮기기]에만 옮긴다, 닫으면 그대로 ${width}`,async({page})=>{
    const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,docs:DOCS,group:'폴더'});
    await expandLibraryTree(page);
    await openMove(page,'d1',width);
    const p=movePicker(page),ok=p.locator('[data-fx-dest-go]');
    await expect(moveFolder(page,'org')).toHaveCount(0);
    await press(page,moveFolder(page,'g03'),width);
    await expect(p).toBeVisible();
    await expect(moveFolder(page,'g03')).toHaveAttribute('aria-current','true');
    await expect(p.locator('.fx-dest-at')).toHaveText('자료실 › 03. 가상 궤도');
    await press(page,moveFolder(page,'org'),width);
    await expect(p.locator('.fx-dest-tree [data-fx-dest-pick^="o"]:not([data-fx-dest-pick="org"])')).toHaveCount(13);
    await press(page,moveFolder(page,'o2'),width);
    await expect(moveFolder(page,'o2')).toHaveAttribute('aria-current','true');
    await expect(ok).toBeEnabled();
    expect(s.writes).toEqual([]);
    await press(page,p.locator('[data-fx-dest-close]'),width);
    await expect(p).toHaveCount(0);
    expect(s.writes).toEqual([]);
    // 다시 열어 상위 폴더 선택 → [여기에 옮기기]에만 옮긴다.
    await openMove(page,'d1',width);
    await press(page,moveFolder(page,'g03'),width);
    expect(s.writes).toEqual([]);
    await press(page,ok,width);
    await expect(p).toHaveCount(0);
    await expect.poll(()=>s.writes.at(-1)).toEqual({table:'items',method:'POST',id:null,body:{document_id:'d1',folder_id:'g03',workspace_id:'workspace-1'}});
    expect(s.writes.length).toBe(1);
    expect(errors).toEqual([]);
  });

  test(`옮기기 창 키보드: Enter = 선택·펼치기, Esc = 닫기(옮기지 않음) ${width}`,async({page})=>{
    test.skip(width<761,'키보드는 PC');
    const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,docs:DOCS,group:'폴더'});
    await expandLibraryTree(page);
    await openMove(page,'d1',width);
    const p=movePicker(page);
    await moveFolder(page,'g03').focus();
    await page.keyboard.press('Enter');
    await expect(moveFolder(page,'g03')).toHaveAttribute('aria-current','true');
    await expect(moveFolder(page,'meet')).toBeVisible();
    await moveFolder(page,'meet').focus();
    await page.keyboard.press('Enter');
    await expect(moveFolder(page,'meet')).toHaveAttribute('aria-current','true');
    await page.keyboard.press('Escape');
    await expect(p).toHaveCount(0);
    expect(s.writes).toEqual([]);
    expect(errors).toEqual([]);
  });
});
