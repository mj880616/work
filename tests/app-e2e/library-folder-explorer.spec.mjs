import {test,expect} from '@playwright/test';
import {expandLibraryTree,libraryNode,libraryNodeHead} from './helpers/library-tree.mjs';
import {bootLibrary,libFolder,childrenOf,menuButton,folderMenuItem,press} from './helpers/library-folder-server.mjs';
// LIB-폴더탐색기 화면 ①(docs/design/library-tree.md 12절): 묶기 '폴더'(프로젝트와 상관없는 폴더 나무), 폴더 메뉴(이름 바꾸기 F2·안에 새 폴더·접기/펼치기·폴더 지우기),
// 줄 안 이름 바꾸기, 빈 곳 우클릭 [새 폴더], 틀을 넘는 옮기기(DB 적용 전에는 '준비 중' 안내).
const FOLDERS=[libFolder('fa','top-a',{name:'가상 A',sort_order:1024}),libFolder('fc','child-a1',{name:'가상 C',parent_id:'fa',sort_order:0}),libFolder('fn',null,{name:'가상 N',sort_order:2048})];
const ITEMS=[{document_id:'a-1',folder_id:'fc'},{document_id:'n-1',folder_id:'fa'}];
const tops=page=>page.locator('#documentList > details').evaluateAll(xs=>xs.map(x=>x.dataset.luNode));
const noScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
const count=(page,key)=>libraryNodeHead(page,key).locator('.lu-node-count');
const radio=(page,name)=>page.locator('#libraryGroupBy').getByRole('radio',{name});

for(const width of [390,1280])test.describe(`폴더 보기 ${width}`,()=>{
  test.use({hasTouch:width<761});
  test(`묶기 '폴더': 프로젝트와 무관한 나무, 맨 위 '폴더 밖', 건수·들여쓰기, 서버 기억은 쓰지 않음 ${width}`,async({page},info)=>{
    const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS});
    await radio(page,'폴더').click();await expect(radio(page,'폴더')).toHaveAttribute('aria-checked','true');
    expect(await tops(page)).toEqual(['x:out','f:fa','f:fn']);
    await expect(libraryNodeHead(page,'x:out').locator('.lu-node-name')).toHaveText('폴더 밖');
    await expect(libraryNodeHead(page,'x:out').locator('.lu-folder-icon')).toHaveCount(0);await expect(libraryNodeHead(page,'f:fa').locator('.lu-folder-icon')).toHaveCount(1);
    // 들어올 때는 모두 접힘(결정 D13). 폴더 안 폴더는 프로젝트가 달라도 parent_id를 따른다. 건수는 그 안 전체.
    await expect(page.locator('#documentList details[open]')).toHaveCount(0);
    await expect(count(page,'x:out')).toHaveText('2');await expect(count(page,'f:fa')).toHaveText('2');await expect(count(page,'f:fn')).toHaveText('0');
    await expandLibraryTree(page);
    expect(await childrenOf(page,'x:out')).toEqual(['a-2','a1-1']);
    expect(await childrenOf(page,'f:fa')).toEqual(['f:fc','n-1']);expect(await childrenOf(page,'f:fc')).toEqual(['a-1']);
    await expect(libraryNode(page,'f:fc')).toHaveAttribute('style',/--lu-depth:\s*1/);
    // 프로젝트 묶기에서는 틀이 다른 연결(n-1은 프로젝트 없음인데 폴더 fa는 top-a)을 '폴더에 없는 것'으로 본다(이전 동작 그대로).
    await radio(page,'프로젝트').click();await expandLibraryTree(page);
    expect(await childrenOf(page,'p:none')).toContain('n-1');expect(await childrenOf(page,'f:fa')).toEqual([]);
    // 폴더 보기는 서버 기억(library_view)에 넣지 않는다(저장 값 검사가 네 값만 받음).
    await radio(page,'폴더').click();await page.waitForTimeout(900);
    expect((s.profilePatches||[]).filter(p=>JSON.stringify(p).includes('folder'))).toEqual([]);
    expect(s.writes).toEqual([]);
    expect(await noScroll(page)).toBe(true);expect(errors).toEqual([]);
    if(width<761)await page.screenshot({path:info.outputPath('folder-view-390.png'),fullPage:true});
  });

  test(`폴더 메뉴: 이름 바꾸기 F2·안에 새 폴더·접기/펼치기·구분선·폴더 지우기, 폴더 밖 ⋯는 새 폴더만 ${width}`,async({page})=>{
    const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,group:'폴더'});
    await press(page,menuButton(page,'f:fa'),width);
    await expect(page.locator('#luFolderMenu button')).toHaveText(['이름 바꾸기F2','안에 새 폴더','펼치기','아래로','옮기기…','폴더 지우기']);
    await expect(page.locator('#luFolderMenu hr[role="separator"]')).toHaveCount(1);
    // 구분선은 [폴더 지우기] 바로 앞.
    await expect(page.locator('#luFolderMenu > :nth-last-child(2)')).toHaveAttribute('role','separator');
    await press(page,folderMenuItem(page,'펼치기'),width);await expect(libraryNode(page,'f:fa')).toHaveAttribute('open','');
    await press(page,menuButton(page,'f:fa'),width);await expect(folderMenuItem(page,'접기')).toBeVisible();
    await press(page,folderMenuItem(page,'접기'),width);await expect(libraryNode(page,'f:fa')).not.toHaveAttribute('open','');
    // 폴더 밖 줄의 ⋯는 [새 폴더]만.
    await press(page,menuButton(page,'x:out'),width);await expect(page.locator('#luFolderMenu button')).toHaveText(['새 폴더']);await page.keyboard.press('Escape');
    expect(s.writes).toEqual([]);expect(await noScroll(page)).toBe(true);expect(errors).toEqual([]);
  });

  test(`새 폴더: 폴더 밖에서는 맨 위(프로젝트 틀 없음), 폴더 안에서는 그 폴더 아래(상위와 같은 틀) ${width}`,async({page})=>{
    const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,group:'폴더'});
    await press(page,menuButton(page,'x:out'),width);await press(page,folderMenuItem(page,'새 폴더'),width);
    await expect(page.locator('#libraryFolderHint')).toContainText('폴더 밖(맨 위)에 만들어요');await expect(page.locator('#libraryFolderHint')).toContainText('Drive 폴더는 바뀌지 않아요');
    await page.locator('#libraryFolderName').fill('가상 새것');await page.keyboard.press('Enter');await expect(page.locator('#libraryFolderModal')).toBeHidden();
    expect(s.writes.at(-1)).toEqual({table:'folders',method:'POST',id:null,body:{workspace_id:'workspace-1',project_id:null,parent_id:null,name:'가상 새것',sort_order:3072}});
    const made=s.folders.at(-1).id;await expect.poll(()=>tops(page)).toEqual(['x:out','f:fa','f:fn','f:'+made]);
    await press(page,menuButton(page,'f:fn'),width);await press(page,folderMenuItem(page,'안에 새 폴더'),width);
    await page.locator('#libraryFolderName').fill('가상 안');await page.keyboard.press('Enter');await expect(page.locator('#libraryFolderModal')).toBeHidden();
    expect(s.writes.at(-1).body).toMatchObject({project_id:null,parent_id:'fn',name:'가상 안'});
    await expect(libraryNode(page,'f:fn')).toHaveAttribute('open','');
    expect(await noScroll(page)).toBe(true);expect(errors).toEqual([]);
  });

  test(`줄 안 이름 바꾸기: F2·메뉴로 입력칸, Enter 저장·Esc 취소·빈 이름 거절, 되돌리기 ${width}`,async({page})=>{
    const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,group:'폴더'});
    const input=libraryNodeHead(page,'f:fn').locator('input.lu-folder-rename'),name=libraryNodeHead(page,'f:fn').locator('.lu-node-name');
    // 메뉴 → 입력칸(글자 전체 선택), 창은 뜨지 않는다. Esc는 아무것도 저장하지 않는다.
    await press(page,menuButton(page,'f:fn'),width);await press(page,folderMenuItem(page,'이름 바꾸기'),width);
    await expect(input).toBeFocused();await expect(input).toHaveValue('가상 N');await expect(page.locator('#libraryFolderModal')).toBeHidden();
    expect(await input.evaluate(el=>el.selectionStart===0&&el.selectionEnd===el.value.length)).toBe(true);
    await input.fill('다른 이름');await page.keyboard.press('Escape');await expect(input).toHaveCount(0);await expect(name).toHaveText('가상 N');await expect(libraryNode(page,'f:fn')).not.toHaveAttribute('open','');expect(s.writes).toEqual([]);
    // F2(줄에 초점) → Enter 저장. 입력칸 안의 Space는 토글을 열지 않는다.
    await libraryNodeHead(page,'f:fn').focus();await page.keyboard.press('F2');await expect(input).toBeFocused();
    await page.keyboard.type(' 가 나');await expect(libraryNode(page,'f:fn')).not.toHaveAttribute('open','');
    await input.fill('  가상 새 이름 ');await page.keyboard.press('Enter');
    await expect(name).toHaveText('가상 새 이름');expect(s.writes).toEqual([{table:'folders',method:'PATCH',id:'fn',body:{name:'가상 새 이름'}}]);
    await expect(libraryNodeHead(page,'f:fn')).toBeFocused();
    await expect(page.locator('#libraryFolderStatusLine')).toContainText('이름을 바꿨어요');
    await page.locator('#libraryFolderStatusLine .lu-undo').click();await expect(name).toHaveText('가상 N');expect(s.writes.at(-1)).toEqual({table:'folders',method:'PATCH',id:'fn',body:{name:'가상 N'}});
    // 빈 이름은 저장하지 않고 한 줄로 알린다. 바깥을 누르면(blur) 저장한다.
    const writes=s.writes.length;
    await libraryNodeHead(page,'f:fn').focus();await page.keyboard.press('F2');await input.fill('   ');await page.keyboard.press('Enter');
    await expect(page.locator('#libraryFolderStatusLine')).toHaveText('폴더 이름은 1~40자로 써 주세요.');expect(s.writes.length).toBe(writes);await expect(name).toHaveText('가상 N');
    await libraryNodeHead(page,'f:fn').focus();await page.keyboard.press('F2');await input.fill('가상 바깥');await page.locator('#documentSearch').click();
    await expect(name).toHaveText('가상 바깥');expect(s.writes.at(-1).body).toEqual({name:'가상 바깥'});
    expect(await noScroll(page)).toBe(true);expect(errors).toEqual([]);
  });

  test(`틀을 넘는 옮기기(폴더 보기): 자료 ⋯ 폴더로 옮기기…·폴더 옮기기…는 모든 폴더가 후보, DB 적용 뒤에는 되고 자료의 프로젝트는 그대로 ${width}`,async({page})=>{
    const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,group:'폴더',dbFree:true});
    await expandLibraryTree(page);
    await press(page,page.locator('[data-lu-menu="a-2"]'),width);await press(page,page.locator('#luMorePanel [data-lu-file-folder="a-2"]'),width);
    await expect(page.locator('#libraryFolderHint')).toContainText('자료의 프로젝트는 바뀌지 않아요');
    await expect(page.locator('#libraryFolderTargets [data-lu-target]')).toHaveText(['가상 A','가상 A › 가상 C','가상 N']);
    await press(page,page.locator('#libraryFolderTargets [data-lu-target="fn"]'),width);await press(page,page.locator('#libraryFolderSave'),width);await expect(page.locator('#libraryFolderModal')).toBeHidden();
    expect(s.writes.at(-1)).toEqual({table:'items',method:'POST',id:null,body:{document_id:'a-2',folder_id:'fn',workspace_id:'workspace-1'}});
    await expect(page.locator('#documentList details[data-lu-node="f:fn"] [data-lu-document="a-2"]')).toBeAttached();
    expect(s.docs.find(d=>d.id==='a-2').project_id).toBe('top-a');expect(s.patches).toEqual([]);
    // 폴더를 다른 틀의 폴더 안으로(맨 위 폴더 fn → fc 아래): 3단 안이라 허용.
    await press(page,menuButton(page,'f:fn'),width);await press(page,folderMenuItem(page,'옮기기…'),width);
    await expect(page.locator('#libraryFolderTargets [data-lu-target]')).toHaveText(['가상 A','가상 A › 가상 C']);
    await press(page,page.locator('#libraryFolderTargets [data-lu-target="fc"]'),width);await press(page,page.locator('#libraryFolderSave'),width);await expect(page.locator('#libraryFolderModal')).toBeHidden();
    expect(s.writes.at(-1)).toMatchObject({table:'folders',method:'PATCH',id:'fn',body:{parent_id:'fc'}});
    expect(await noScroll(page)).toBe(true);expect(errors).toEqual([]);
  });

  test(`DB 적용 전에는 틀을 넘는 옮기기가 '준비 중'으로 안내되고 화면은 그대로, 같은 틀 안 옮기기는 된다 ${width}`,async({page})=>{
    const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,group:'폴더',dbFree:false});
    await expandLibraryTree(page);
    await press(page,page.locator('[data-lu-menu="a-2"]'),width);await press(page,page.locator('#luMorePanel [data-lu-file-folder="a-2"]'),width);
    await press(page,page.locator('#libraryFolderTargets [data-lu-target="fn"]'),width);await press(page,page.locator('#libraryFolderSave'),width);
    await expect(page.locator('#libraryFolderStatusLine')).toContainText('아직 준비 중이에요');await expect(page.locator('#libraryFolderStatusLine')).toHaveClass(/error/);
    // 작은 창은 닫히지 않고 같은 안내를 창 안에서도 보여 준다(다른 곳을 다시 고를 수 있게).
    await expect(page.locator('#libraryFolderModal')).toBeVisible();await expect(page.locator('#libraryFolderStatus')).toContainText('아직 준비 중이에요');await press(page,page.locator('#libraryFolderCancel'),width);await expect(page.locator('#libraryFolderModal')).toBeHidden();
    expect(s.items.map(x=>x.document_id).sort()).toEqual(['a-1','n-1']);
    await expect(page.locator('#documentList details[data-lu-node="x:out"] [data-lu-document="a-2"]')).toBeAttached();
    // 같은 틀(top-a) 안: a-2 → fa 는 된다.
    await press(page,page.locator('[data-lu-menu="a-2"]'),width);await press(page,page.locator('#luMorePanel [data-lu-file-folder="a-2"]'),width);
    await press(page,page.locator('#libraryFolderTargets [data-lu-target="fa"]'),width);await press(page,page.locator('#libraryFolderSave'),width);await expect(page.locator('#libraryFolderModal')).toBeHidden();
    expect(s.items.find(x=>x.document_id==='a-2')?.folder_id).toBe('fa');
    // 폴더를 다른 틀 폴더 아래로 옮기려는 시도(fn → fa)도 같은 안내.
    await press(page,menuButton(page,'f:fn'),width);await press(page,folderMenuItem(page,'옮기기…'),width);await press(page,page.locator('#libraryFolderTargets [data-lu-target="fa"]'),width);await press(page,page.locator('#libraryFolderSave'),width);
    await expect(page.locator('#libraryFolderStatus')).toContainText('아직 준비 중이에요');expect(s.folders.find(f=>f.id==='fn').parent_id).toBeNull();
    expect(errors).toEqual([]);
  });
});

test.describe('빈 곳 우클릭(PC)',()=>{
  test.use({hasTouch:false});
  test('빈 곳 = 가장 가까운 토글의 메뉴: 목록 바탕은 [새 폴더](폴더 밖), 폴더 안 빈 곳은 그 폴더 메뉴, 폴더 줄 우클릭은 공용 우클릭이 연다',async({page})=>{
    const {s,errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS,group:'폴더'});
    // 목록 바탕(어느 토글도 아님): 포인터 자리에서 [새 폴더].
    await page.evaluate(()=>document.querySelector('#documentList').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:420,clientY:360})));
    await expect(page.locator('#luFolderMenu')).toBeVisible();await expect(page.locator('#luFolderMenu button')).toHaveText(['새 폴더']);
    const box=await page.locator('#luFolderMenu').boundingBox();expect(Math.abs(box.x-420)).toBeLessThan(40);expect(Math.abs(box.y-360)).toBeLessThan(40);
    await page.keyboard.press('Escape');await expect(page.locator('#luFolderMenu')).toBeHidden();
    // 열린 폴더 본문의 빈 곳 = 그 폴더 메뉴.
    await libraryNodeHead(page,'f:fa').click();await expect(libraryNode(page,'f:fa')).toHaveAttribute('open','');
    await page.evaluate(()=>document.querySelector('#documentList details[data-lu-node="f:fa"] > .lu-node-body').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:500,clientY:300})));
    await expect(page.locator('#luFolderMenu button')).toHaveText(['이름 바꾸기F2','안에 새 폴더','접기','아래로','옮기기…','폴더 지우기']);
    await page.keyboard.press('Escape');
    // 폴더 줄 우클릭 = 그 줄의 ⋯ 메뉴(공용 우클릭 규칙). 파일 줄 위 우클릭은 [새 폴더]를 열지 않는다.
    await libraryNodeHead(page,'f:fn').locator('.lu-node-name').click({button:'right'});
    await expect(page.locator('#luFolderMenu button').first()).toContainText('이름 바꾸기');await page.keyboard.press('Escape');
    await page.locator('#documentList [data-lu-document="n-1"]').click({button:'right'});
    await expect(page.locator('#luFolderMenu')).toBeHidden();await expect(page.locator('#luMorePanel')).toBeVisible();await page.keyboard.press('Escape');
    expect(s.writes).toEqual([]);expect(errors).toEqual([]);
  });
});
