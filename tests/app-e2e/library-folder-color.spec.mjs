import {test,expect} from '@playwright/test';
import {expandLibraryTree,libraryNodeHead} from './helpers/library-tree.mjs';
import {bootLibrary,libFolder,menuButton,folderMenuItem,press,openMove,moveFolder} from './helpers/library-folder-server.mjs';
// FOLDER-순서·색 ③-1 (S49-47, docs/design/folder-color-order.md): 자료실 폴더 색 8가지.
// 폴더 ⋯ → [색 고르기…] → 동그라미 하나 → 바로 서버에 저장(서버 함수 app_library_folder_set_color), 새로고침해도 유지, 같은 폴더는 토글 머리·폴더 고르기 창에서 같은 색,
// [기본]은 지금 모양(노란 폴더 글자), 저장 실패는 그대로 두고 알림, DB 적용 전(color 칸·함수 없음)에도 목록이 그대로 뜬다. 폴더 이름은 모두 가짜.
// 순서(위·아래, 끌어서 줄 사이 = 순서·가운데 = 넣기)는 library-folder-drag.spec.mjs가 시험한다(이번 단계에서 바꾸지 않음).
const FOLDERS=[libFolder('fa','top-a',{name:'가상 A',sort_order:1024}),libFolder('fb','top-a',{name:'가상 B',sort_order:2048}),libFolder('fc','child-a1',{name:'가상 C',parent_id:'fa',sort_order:0})];
const ITEMS=[{document_id:'a-1',folder_id:'fa'}];
const RGB={light:{4:'rgb(63, 148, 134)',1:'rgb(180, 90, 82)'},dark:{4:'rgb(98, 179, 165)'}};
const radio=(page,name)=>page.locator('#libraryGroupBy').getByRole('radio',{name});
const mark=(page,key)=>libraryNodeHead(page,key).locator('.lu-folder-emoji');
const colorOfMark=el=>el.locator('svg').first().evaluate(x=>getComputedStyle(x).color);
async function pickColor(page,key,name,width){
  await press(page,menuButton(page,key),width);
  await press(page,folderMenuItem(page,'색 고르기…'),width);
  const choice=page.locator('#luFolderMenu .fl-choice');await expect(choice).toBeVisible();
  await press(page,choice.getByRole('radio',{name,exact:true}),width);
  await expect(page.locator('#luFolderMenu')).toBeHidden();
}

for(const width of [1440,412])test.describe(`자료실 폴더 색 ${width}`,()=>{
  test.use({hasTouch:width<761});
  test(`색을 고르면 저장되고 새로고침해도 유지, [기본]으로 되돌림, 같은 폴더는 다른 화면에서 같은 색 ${width}`,async({page},info)=>{
    const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,group:'폴더'});
    // 안 고른 폴더는 지금 모양 그대로(노란 폴더 글자), 색 번호 속성 없음.
    await expect(mark(page,'f:fa').locator('.lu-fe-closed')).toHaveText('\u{1F4C1}');await expect(page.locator('#documentList [data-fc]')).toHaveCount(0);
    // 메뉴: [색 고르기…]가 있고, 고르는 줄은 동그라미 8개 + [기본]이며 이름이 붙어 있다.
    await press(page,menuButton(page,'f:fa'),width);await press(page,folderMenuItem(page,'색 고르기…'),width);
    const choice=page.locator('#luFolderMenu .fl-choice');await expect(choice.getByRole('radio')).toHaveCount(9);
    await expect(choice.getByRole('radio',{name:'청록',exact:true})).toBeVisible();await expect(choice.getByRole('radio',{name:'기본',exact:true})).toHaveAttribute('aria-checked','true');
    const box=await page.locator('#luFolderMenu').boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');await expect(page.locator('#luFolderMenu')).toBeHidden();expect(s.colorCalls||[]).toEqual([]);

    // 청록(4) 고르기 → 서버 함수 한 번, 그 폴더만 칠한 그림, 값은 토큰 색.
    await pickColor(page,'f:fa','청록',width);
    await expect.poll(()=>s.colorCalls?.length||0).toBe(1);expect(s.colorCalls[0]).toEqual({p_id:'fa',p_color:4});
    await expect(mark(page,'f:fa')).toHaveAttribute('data-fc','4');await expect(mark(page,'f:fb')).not.toHaveAttribute('data-fc',/./);
    expect(await colorOfMark(mark(page,'f:fa'))).toBe(RGB.light[4]);
    await expect(mark(page,'f:fa').locator('.lu-fe-closed svg')).toBeVisible();
    // 다시 열면 고른 색에 표시(aria-checked).
    await press(page,menuButton(page,'f:fa'),width);await press(page,folderMenuItem(page,'색 고르기…'),width);
    await expect(page.locator('#luFolderMenu .fl-choice').getByRole('radio',{name:'청록',exact:true})).toHaveAttribute('aria-checked','true');
    await page.keyboard.press('Escape');

    // 새로고침해도 유지(서버 값). 폴더 보기를 다시 고른 뒤 같은 색.
    await page.reload();await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('library'));
    await expect(page.locator('#documentList details[data-lu-node]').first()).toBeAttached();
    if(!(await radio(page,'폴더').getAttribute('aria-checked')==='true'))await radio(page,'폴더').click();
    await expect(mark(page,'f:fa')).toHaveAttribute('data-fc','4');

    // 같은 폴더가 다른 화면에서도 같은 색: 사업영역 묶기의 폴더 머리, 폴더 고르기 창(자료 ⋯ → 폴더로 옮기기).
    await radio(page,'사업영역').click();await expandLibraryTree(page);
    const outline=libraryNodeHead(page,'f:fa').locator('.lu-folder-icon');await expect(outline).toHaveAttribute('data-fc','4');
    expect(await outline.evaluate(x=>getComputedStyle(x).color)).toBe(RGB.light[4]);
    await expect(libraryNodeHead(page,'f:fb').locator('.lu-folder-icon')).not.toHaveAttribute('data-fc',/./);
    await openMove(page,'a-2',width);
    const pickIcon=moveFolder(page,'fa').locator('.lu-move-ico');await expect(pickIcon).toHaveAttribute('data-fc','4');
    expect(await pickIcon.locator('svg').evaluate(x=>getComputedStyle(x).color)).toBe(RGB.light[4]);
    await expect(moveFolder(page,'fb').locator('.lu-move-ico')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // [기본]: 지금 모양(노란 폴더 글자)으로 돌아가고 서버에는 null이 간다. 이미 기본이면 저장하지 않는다.
    await radio(page,'폴더').click();
    await pickColor(page,'f:fa','기본',width);
    await expect.poll(()=>s.colorCalls.length).toBe(2);expect(s.colorCalls[1]).toEqual({p_id:'fa',p_color:null});
    await expect(page.locator('#documentList [data-fc]')).toHaveCount(0);await expect(mark(page,'f:fa').locator('.lu-fe-closed')).toHaveText('\u{1F4C1}');
    await pickColor(page,'f:fb','기본',width);expect(s.colorCalls.length).toBe(2);
    expect(s.writes.filter(w=>w.table==='folders')).toEqual([]);   // 색은 표를 직접 쓰지 않고 서버 함수로만
    expect(errors).toEqual([]);
    if(width<761)await page.screenshot({path:info.outputPath('library-folder-color-412.png')});
  });

  test(`어두운 테마에서는 어두운 색 값, 아래 폴더도 따로 칠한다 ${width}`,async({page})=>{
    const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,group:'폴더',scheme:'dark'});
    await pickColor(page,'f:fa','청록',width);await expect(mark(page,'f:fa')).toHaveAttribute('data-fc','4');
    expect(await colorOfMark(mark(page,'f:fa'))).toBe(RGB.dark[4]);
    await expandLibraryTree(page);
    await pickColor(page,'f:fc','벽돌',width);
    await expect(mark(page,'f:fc')).toHaveAttribute('data-fc','1');await expect(mark(page,'f:fa')).toHaveAttribute('data-fc','4');
    expect(s.colorCalls.map(c=>c.p_id)).toEqual(['fa','fc']);expect(errors).toEqual([]);
  });

  test(`저장이 실패하면 색은 그대로 두고 알린다 ${width}`,async({page})=>{
    const {s}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,group:'폴더',init:{colorFail:true}});
    await pickColor(page,'f:fa','자주',width);
    await expect.poll(()=>s.colorCalls?.length||0).toBe(1);
    await expect(page.locator('#documentList [data-fc]')).toHaveCount(0);
    await expect(page.locator('body')).toContainText('폴더 색을 저장하지 못했어요');
  });

  test(`DB 적용 전(color 칸·함수 없음)에도 목록은 그대로 뜨고 색 저장만 알림 ${width}`,async({page})=>{
    const {s}=await bootLibrary(page,width,{folders:FOLDERS.map(f=>({...f,color:3})),items:ITEMS,group:'폴더',init:{colorMissing:true}});
    await expect(libraryNodeHead(page,'f:fa').locator('.lu-node-name')).toHaveText('가상 A');
    await expect(page.locator('#documentList [data-fc]')).toHaveCount(0);
    await pickColor(page,'f:fb','회색',width);
    await expect(page.locator('body')).toContainText('폴더 색을 저장하지 못했어요');
    expect(s.colorCalls.length).toBe(1);
  });
});
