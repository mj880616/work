import {test,expect} from '@playwright/test';
import {expandLibraryTree,libraryNode,libraryNodeHead} from './helpers/library-tree.mjs';
import {bootLibrary,libFolder,libDoc,childrenOf,menuButton,folderMenuItem,press,openMove,moveFolder,moveEnabledNames,movePicker} from './helpers/library-folder-server.mjs';
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
  test(`묶기 '폴더': 프로젝트와 무관한 나무, 맨 위 '폴더 밖', 건수·들여쓰기 ${width}`,async({page},info)=>{
    const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS});
    await radio(page,'폴더').click();await expect(radio(page,'폴더')).toHaveAttribute('aria-checked','true');
    expect(await tops(page)).toEqual(['x:out','f:fa','f:fn']);
    await expect(libraryNodeHead(page,'x:out').locator('.lu-node-name')).toHaveText('폴더 밖');
    // LIB-폴더보기: 폴더 묶기의 폴더 줄은 ▸ 대신 📁/📂 글자, '폴더 밖'은 🗂.
    await expect(libraryNodeHead(page,'x:out').locator('.lu-folder-emoji')).toHaveText('\u{1F5C2}');await expect(libraryNodeHead(page,'f:fa').locator('.lu-folder-emoji .lu-fe-closed')).toBeVisible();
    await expect(libraryNodeHead(page,'f:fa').locator('.lu-folder-emoji .lu-fe-closed')).toHaveText('\u{1F4C1}');await expect(libraryNodeHead(page,'f:fa').locator('.lu-folder-icon')).toHaveCount(0);
    // 들어올 때는 모두 접힘(결정 D13). 폴더 안 폴더는 프로젝트가 달라도 parent_id를 따른다. 건수는 그 안 전체.
    await expect(page.locator('#documentList details[open]')).toHaveCount(0);
    await expect(count(page,'x:out')).toHaveText('2');await expect(count(page,'f:fa')).toHaveText('2');await expect(count(page,'f:fn')).toHaveText('0');
    await expandLibraryTree(page);
    expect(await childrenOf(page,'x:out')).toEqual(['a-2','a1-1']);
    expect(await childrenOf(page,'f:fa')).toEqual(['f:fc','n-1']);expect(await childrenOf(page,'f:fc')).toEqual(['a-1']);
    await expect(libraryNode(page,'f:fc')).toHaveAttribute('style',/--lu-depth:\s*1/);
    // 프로젝트 묶기에서는 틀이 다른 연결(n-1은 프로젝트 없음인데 폴더 fa는 top-a)을 '폴더에 없는 것'으로 본다(이전 동작 그대로).
    await radio(page,'사업영역').click();await expandLibraryTree(page);
    expect(await childrenOf(page,'p:none')).toContain('n-1');expect(await childrenOf(page,'f:fa')).toEqual([]);
    await radio(page,'폴더').click();
    expect(s.writes).toEqual([]);
    expect(await noScroll(page)).toBe(true);expect(errors).toEqual([]);
    if(width<761)await page.screenshot({path:info.outputPath('folder-view-390.png'),fullPage:true});
  });

  // LIB-폴더묶기기억(2026-10-26 사용자 결정 '기억'): 폴더 묶기도 다른 묶기와 똑같이 서버(library_view.group_by)에 저장하고, 다른 기기에서도 폴더로 열린다.
  test(`폴더 묶기를 서버에 기억해 다른 기기에서도 폴더로 열린다 ${width}`,async({page,browser})=>{
    const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS});
    await radio(page,'폴더').click();
    await expect.poll(()=>(s.profilePatches||[]).length,{timeout:5000}).toBe(1);
    expect(s.profilePatches[0]).toEqual({library_view:{group_by:'folder'}});expect(s.libraryView).toEqual({group_by:'folder'});
    const other=await browser.newPage();
    try{
      const o=await bootLibrary(other,width,{state:s});
      await expect(radio(other,'폴더')).toHaveAttribute('aria-checked','true');
      expect(await tops(other)).toEqual(['x:out','f:fa','f:fn']);
      // 다른 묶기로 바꾸면 그 값으로 바뀐다(폴더도 다른 값과 똑같이 덮어쓴다).
      await radio(other,'사업영역').click();
      await expect.poll(()=>s.libraryView?.group_by,{timeout:5000}).toBe('project');
      expect(o.errors).toEqual([]);
    }finally{await other.close()}
    expect(s.writes).toEqual([]);expect(errors).toEqual([]);
  });

  test(`기억된 폴더 묶기는 폴더 표를 읽은 뒤 폴더로 열린다 ${width}`,async({page})=>{
    const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,init:{libraryView:{group_by:'folder'}}});
    // 폴더 표가 읽히므로 폴더로 열린다.
    await expect(radio(page,'폴더')).toHaveAttribute('aria-checked','true');
    expect(s.profilePatches||[]).toEqual([]);expect(errors).toEqual([]);
  });

  test(`DB 적용 전 서버에서도 화면이 깨지지 않는다: 폴더는 이번 방문만, 종류 칩 기억은 그대로 ${width}`,async({page})=>{
    const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,init:{libraryViewNoFolder:true,libraryView:{group_by:'month'}}});
    await radio(page,'폴더').click();
    await expect.poll(()=>(s.profilePatches||[]).length,{timeout:5000}).toBe(2);
    // 첫 요청은 검사에 거절되고(400), 폴더만 빼고 앞서 기억한 묶기 그대로 다시 보낸다.
    expect(s.profilePatches[0]).toEqual({library_view:{group_by:'folder'}});expect(s.profilePatches[1]).toEqual({library_view:{group_by:'month'}});
    expect(s.libraryView).toEqual({group_by:'month'});
    await expect(radio(page,'폴더')).toHaveAttribute('aria-checked','true');expect(await tops(page)).toEqual(['x:out','f:fa','f:fn']);
    // 폴더 보기에서 종류 칩을 눌러도 기억은 저장된다(폴더 때문에 막히지 않음).
    const chip=page.locator('#libraryCategoryFilter [data-lu-category]:not([data-lu-category="all"])').first();const name=await chip.getAttribute('data-lu-category');
    const before=(await chip.getAttribute('aria-pressed'))==='true';
    await chip.click();
    await expect.poll(()=>s.libraryView?.categories_off?.includes(name),{timeout:5000}).toBe(before);
    expect(s.libraryView.group_by).toBe('month');
    await expect(radio(page,'폴더')).toHaveAttribute('aria-checked','true');
    expect(s.writes).toEqual([]);expect(errors).toEqual([]);
  });

  test(`폴더 메뉴: 이름 바꾸기 F2·안에 새 폴더·접기/펼치기·구분선·폴더 지우기, 폴더 밖 ⋯는 새 폴더만 ${width}`,async({page})=>{
    const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,group:'폴더'});
    await press(page,menuButton(page,'f:fa'),width);
    await expect(page.locator('#luFolderMenu button')).toHaveText(['이름 바꾸기F2','안에 새 폴더','펼치기','이 폴더로 들어가기','아래로','옮기기…','폴더 지우기']);
    await expect(page.locator('#luFolderMenu hr[role="separator"]')).toHaveCount(1);
    // 구분선은 [폴더 지우기] 바로 앞.
    await expect(page.locator('#luFolderMenu > :nth-last-child(2)')).toHaveAttribute('role','separator');
    await press(page,folderMenuItem(page,'펼치기'),width);await expect(libraryNode(page,'f:fa')).toHaveAttribute('open','');
    await press(page,menuButton(page,'f:fa'),width);await expect(folderMenuItem(page,'접기')).toBeVisible();
    await press(page,folderMenuItem(page,'접기'),width);await expect(libraryNode(page,'f:fa')).not.toHaveAttribute('open','');
    // 폴더 밖 줄의 ⋯는 [새 폴더]만.
    await press(page,menuButton(page,'x:out'),width);await expect(page.locator('#luFolderMenu button')).toHaveText(['새 폴더','전체 고르기']);await page.keyboard.press('Escape');
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
    await openMove(page,'a-2',width);
    expect(await moveEnabledNames(page)).toEqual(['가상 A','가상 C','가상 N']);
    await press(page,moveFolder(page,'fn'),width);await expect(movePicker(page)).toBeHidden();
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
    await openMove(page,'a-2',width);
    await press(page,moveFolder(page,'fn'),width);
    await expect(page.locator('#libraryFolderStatusLine')).toContainText('아직 준비 중이에요');await expect(page.locator('#libraryFolderStatusLine')).toHaveClass(/error/);
    await expect(movePicker(page)).toBeHidden();
    expect(s.items.map(x=>x.document_id).sort()).toEqual(['a-1','n-1']);
    await expect(page.locator('#documentList details[data-lu-node="x:out"] [data-lu-document="a-2"]')).toBeAttached();
    // 같은 틀(top-a) 안: a-2 → fa 는 된다.
    await openMove(page,'a-2',width);
    await press(page,moveFolder(page,'fa'),width);await expect(movePicker(page)).toBeHidden();
    await expect.poll(()=>s.items.find(x=>x.document_id==='a-2')?.folder_id).toBe('fa');
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
    await expect(page.locator('#luFolderMenu')).toBeVisible();await expect(page.locator('#luFolderMenu button')).toHaveText(['새 폴더','전체 고르기']);
    const box=await page.locator('#luFolderMenu').boundingBox();expect(Math.abs(box.x-420)).toBeLessThan(40);expect(Math.abs(box.y-360)).toBeLessThan(40);
    await page.keyboard.press('Escape');await expect(page.locator('#luFolderMenu')).toBeHidden();
    // 열린 폴더 본문의 빈 곳 = 그 폴더 메뉴.
    await libraryNodeHead(page,'f:fa').click();await expect(libraryNode(page,'f:fa')).toHaveAttribute('open','');
    await page.evaluate(()=>document.querySelector('#documentList details[data-lu-node="f:fa"] > .lu-node-body').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:500,clientY:300})));
    await expect(page.locator('#luFolderMenu button')).toHaveText(['이름 바꾸기F2','안에 새 폴더','접기','이 폴더로 들어가기','아래로','옮기기…','폴더 지우기']);
    await page.keyboard.press('Escape');
    // 파일 줄 위 우클릭은 [새 폴더]를 열지 않는다(파일 ⋯ 메뉴).
    await page.locator('#documentList [data-lu-document="n-1"]').click({button:'right'});
    await expect(page.locator('#luFolderMenu')).toBeHidden();await expect(page.locator('#luMorePanel')).toBeVisible();await page.keyboard.press('Escape');
    // 폴더 줄 우클릭 = 그 줄의 ⋯ 메뉴(공용 우클릭 규칙). 열린 위쪽 폴더의 고정 머리가 아래 줄을 가리지 않게 먼저 접는다.
    await libraryNodeHead(page,'f:fa').click();await expect(libraryNode(page,'f:fa')).not.toHaveAttribute('open','');
    await libraryNodeHead(page,'f:fn').click({button:'right',position:{x:40,y:8}});
    await expect(page.locator('#luFolderMenu button').first()).toContainText('이름 바꾸기');await page.keyboard.press('Escape');
    expect(s.writes).toEqual([]);expect(errors).toEqual([]);
  });

  // LIB-폴더100단 ②(2026-10-28 10:34): 깊은 폴더는 [이 폴더로 들어가기](PC는 폴더 줄 두 번 누르기도) → 그 폴더만 보이고 위치 줄 '자료실 › …'.
  // 위치 줄의 칸을 누르면 그 단계로, '자료실'은 처음 목록으로. 들어간 폴더의 들여쓰기는 그 폴더 기준 0단부터. 묶기를 바꾸면 처음으로.
});

for(const width of [390,1280])test.describe(`폴더 들어가기 ${width}`,()=>{
  test.use({hasTouch:width<761});
  test(`폴더 들어가기와 위치 줄 ${width}`,async({page})=>{
    const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS});
    await radio(page,'폴더').click();
    const path=page.locator('#libraryPath');
    await expect(path).toHaveCount(0);
    await press(page,menuButton(page,'f:fa'),width);await press(page,folderMenuItem(page,'이 폴더로 들어가기'),width);
    expect(await tops(page)).toEqual(['f:fa']);await expect(libraryNode(page,'f:fa')).toHaveAttribute('open','');
    await expect(libraryNode(page,'f:fa')).toHaveAttribute('style',/--lu-depth:\s*0/);
    await expect(path).toBeVisible();await expect(path).toHaveText('자료실›가상 A');await expect(path.locator('[aria-current="location"]')).toHaveText('가상 A');
    // 안의 폴더로 한 단계 더(폰은 메뉴, PC는 두 번 누르기).
    if(width<761){await press(page,menuButton(page,'f:fc'),width);await press(page,folderMenuItem(page,'이 폴더로 들어가기'),width)}
    else await libraryNodeHead(page,'f:fc').locator('.lu-node-name').dispatchEvent('dblclick');// PC 두 번 누르기(더블클릭 이벤트). 실제 두 번 누름의 펼침·접힘은 이 시험의 관심 밖.
    expect(await tops(page)).toEqual(['f:fc']);await expect(libraryNode(page,'f:fc')).toHaveAttribute('style',/--lu-depth:\s*0/);
    await expect(path).toHaveText('자료실›가상 A›가상 C');expect(await childrenOf(page,'f:fc')).toEqual(['a-1']);
    // 위치 줄의 '가상 A'를 누르면 그 단계로.
    await path.getByRole('button',{name:'가상 A'}).click();expect(await tops(page)).toEqual(['f:fa']);await expect(path).toHaveText('자료실›가상 A');
    // '자료실'을 누르면 처음 목록.
    await path.getByRole('button',{name:'자료실'}).click();expect(await tops(page)).toEqual(['x:out','f:fa','f:fn']);await expect(path).toBeHidden();
    // 들어간 채 묶기를 바꾸면 처음으로 돌아오고 위치 줄은 사라진다.
    await press(page,menuButton(page,'f:fn'),width);await press(page,folderMenuItem(page,'이 폴더로 들어가기'),width);expect(await tops(page)).toEqual(['f:fn']);
    await radio(page,'사업영역').click();await expect(path).toBeHidden();await radio(page,'폴더').click();expect(await tops(page)).toEqual(['x:out','f:fa','f:fn']);
    // 프로젝트 묶기의 폴더 메뉴에는 [이 폴더로 들어가기]가 없다(폴더 보기 전용).
    expect(s.writes).toEqual([]);expect(await noScroll(page)).toBe(true);expect(errors).toEqual([]);
  });

  // LIB-폴더100단(10:34): 들어간 폴더에서 뒤로가기(폰 갤럭시 뒤로·브라우저 뒤로) = 한 단계 위. 맨 위에 닿으면 처음 목록, 자료실에 남는다.
  test(`폴더 안에서 뒤로가기는 한 단계 위 ${width}`,async({page})=>{
    const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS});
    await radio(page,'폴더').click();
    const path=page.locator('#libraryPath');
    await press(page,menuButton(page,'f:fa'),width);await press(page,folderMenuItem(page,'이 폴더로 들어가기'),width);
    await expect(path).toHaveText('자료실›가상 A');
    await press(page,menuButton(page,'f:fc'),width);await press(page,folderMenuItem(page,'이 폴더로 들어가기'),width);
    await expect(path).toHaveText('자료실›가상 A›가상 C');
    await page.goBack();
    await expect(path).toHaveText('자료실›가상 A');expect(await tops(page)).toEqual(['f:fa']);
    await expect(page).toHaveURL(/[?&]folder=fa(?:&|$)/);
    await page.goBack();
    await expect(path).toBeHidden();await expect.poll(()=>tops(page)).toEqual(['x:out','f:fa','f:fn']);
    await expect(page).not.toHaveURL(/[?&]folder=/);await expect(page.locator('#libraryView')).toBeVisible();
    expect(s.writes).toEqual([]);expect(errors).toEqual([]);
  });

  // LIB-정리보충(10:34): '폴더 밖'이 비면 그 줄은 없고, 맨 위 새 폴더는 맨 위 폴더 메뉴 첫 줄 [맨 위에 새 폴더].
  test(`폴더 밖이 비면 그 줄 없음·맨 위에 새 폴더 ${width}`,async({page})=>{
    const items=[...ITEMS,{document_id:'a-2',folder_id:'fn'},{document_id:'a1-1',folder_id:'fa'}];
    const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items,group:'폴더'});
    expect(await tops(page)).toEqual(['f:fa','f:fn']);
    await press(page,menuButton(page,'f:fa'),width);
    await expect(page.locator('#luFolderMenu button')).toHaveText(['맨 위에 새 폴더','이름 바꾸기F2','안에 새 폴더','펼치기','이 폴더로 들어가기','아래로','옮기기…','폴더 지우기']);
    await press(page,folderMenuItem(page,'맨 위에 새 폴더'),width);
    await expect(page.locator('#libraryFolderHint')).toContainText('폴더 밖(맨 위)에 만들어요');
    await page.locator('#libraryFolderName').fill('가상 새것');await page.keyboard.press('Enter');await expect(page.locator('#libraryFolderModal')).toBeHidden();
    expect(s.writes.at(-1)).toMatchObject({table:'folders',method:'POST',body:{project_id:null,parent_id:null,name:'가상 새것'}});
    const made=s.folders.at(-1).id;await expect.poll(()=>tops(page)).toEqual(['f:fa','f:fn','f:'+made]);
    expect(errors).toEqual([]);
  });
});

// LIB-정리보충 ③(10:41): '폴더 밖' 비우기 — ⋯ [전체 고르기]로 폴더 밖 자료 모두 고르기, 자료마다 작은 폴더 추천 '📁 ○○?'(AI 없음, 제목 첫 낱말이 같은 자료가 든 폴더).
for(const width of [390,1280])test.describe(`폴더 밖 정리 ${width}`,()=>{test.use({hasTouch:width<761});test(`폴더 밖 전체 고르기·폴더 추천 ${width}`,async({page})=>{
  const docs=[libDoc('a-1','top-a',{title:'임단협 1차 회의'}),libDoc('a-2','top-a',{title:'임단협 2차 회의'}),libDoc('a1-1','child-a1',{title:'성명 초안'}),libDoc('n-1',null,{title:'투쟁속보 10호'})];
  const {s,errors}=await bootLibrary(page,width,{docs,folders:FOLDERS,items:ITEMS,group:'폴더'});
  await expandLibraryTree(page);
  // a-2('임단협…')는 a-1이 든 '가상 C'를 추천. a1-1('성명…')은 같은 첫 낱말이 없어 추천 없음.
  const tip=page.locator('[data-lu-document="a-2"] [data-lu-suggest]');
  await expect(tip).toHaveText('📁 가상 C?');await expect(page.locator('[data-lu-document="a1-1"] [data-lu-suggest]')).toHaveCount(0);
  expect(await noScroll(page)).toBe(true);
  // 추천을 누르면 자료는 열리지 않고 그 폴더로 옮겨진다.
  await press(page,tip,width);
  await expect.poll(()=>s.items.find(x=>x.document_id==='a-2')?.folder_id).toBe('fc');
  await expect(page).toHaveURL(/view=library/);
  // ⋯ [전체 고르기] → 폴더 밖에 남은 자료(a1-1) 모두 골라진 선택 모드.
  await press(page,menuButton(page,'x:out'),width);await press(page,folderMenuItem(page,'전체 고르기'),width);
  await expect(page.locator('#documentList .lu-row input.lu-pick:checked')).toHaveCount(1);
  await expect(page.locator('[data-lu-document="a1-1"] input.lu-pick')).toBeChecked();
  expect(errors).toEqual([]);
});});
