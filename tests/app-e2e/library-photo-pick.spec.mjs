import {test,expect} from '@playwright/test';
import {expandLibraryTree,libraryTopMenu} from './helpers/library-tree.mjs';
import {bootLibrary,libFolder,libDoc,press,movePicker,moveFolder} from './helpers/library-folder-server.mjs';
// S69-14(명진 11/24 08:15 '사진도 선택해서 옮길 수 있게', 08:16 '사진 우클릭하면 브라우저 메뉴'): 자료실 폴더 안 [사진 n]을 펼친 작은 그림도
// 문서 줄과 같은 선택 모드(네모 칸·위 막대 'n개 선택됨 · … · 폴더로 옮기기 · 삭제 · 취소')로 고르고, 같은 폴더 고르기 창으로 옮기고, '옮겼어요 · 되돌리기'.
// 폰은 작은 그림 꾹 누르기 = 그 사진이 골라진 채로 선택 모드. PC 우클릭은 브라우저 메뉴가 아니라 그 사진의 ⋯ 메뉴(선택 모드에서도).
// 모든 이름·번호는 지어낸 것이다.
const P1='00000000-0000-4000-8000-000000000001',P2='00000000-0000-4000-8000-000000000002',P3='00000000-0000-4000-8000-000000000003'; // 작은 그림 길은 자료 번호 모양(uuid)만 받는다.
const FOLDERS=[libFolder('fa',null,{name:'가상 A',sort_order:1024}),libFolder('fn',null,{name:'가상 N',sort_order:2048})];
const pic=(id,extra={})=>libDoc(id,null,{title:'사진 '+id.slice(-1),file_name:id+'.jpg',mime_type:'image/jpeg',file_id:'drive-'+id,...extra});
const DOCS=[pic(P1),pic(P2),pic(P3),libDoc('d-1',null)];
const ITEMS=[P1,P2,P3,'d-1'].map(document_id=>({folder_id:'fa',document_id}));
const bar=page=>page.locator('#librarySelectBar');
const line=page=>page.locator('#libraryFolderStatusLine');
const fold=page=>page.locator('#documentList [data-lu-photos="f:fa"]');
const thumb=(page,id)=>page.locator(`#documentList .photo-fold-tile [data-lu-document="${id}"]`);
const inFolder=(s,fid)=>s.items.filter(x=>x.folder_id===fid).map(x=>x.document_id).sort();
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const shot=(page,name)=>page.screenshot({path:test.info().outputPath(name+'.png')});

async function boot(page,width){
  const r=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,docs:structuredClone(DOCS),group:'폴더'});
  await page.route('**/functions/v1/library-files*',route=>route.fulfill({status:200,contentType:'image/png',body:PNG}));
  // S69-28 LIB-한칸탐색기: 넓은 화면 한 칸은 왼쪽 나무에서 가상 A를 열면 오른쪽에 그 폴더 자료·[사진 n].
  if(width>=600)await page.locator('#libraryFolderNav [data-lu-nav="fa"]').click();else await expandLibraryTree(page);
  await expect(fold(page)).toHaveText(/사진 3/);
  await press(page,fold(page),width);
  await expect(thumb(page,P1)).toBeVisible();
  return r;
}

for(const width of [412,1440])test.describe(`자료실 사진 고르기 ${width}`,()=>{
  test.use({hasTouch:width<761});
  test(`사진 2장 고르기 → 다른 폴더로 옮기기 → 되돌리기 ${width}`,async({page})=>{
    const {s,errors}=await boot(page,width);
    if(width<761){
      // 폰: 꾹 누르기(브라우저 contextmenu) = 그 사진이 골라진 채로 선택 모드, 다른 사진은 누르면 더한다.
      await thumb(page,P1).dispatchEvent('contextmenu',{bubbles:true,cancelable:true});
      await expect(bar(page)).toBeVisible();
      await expect(page.locator('#luMorePanel')).toBeHidden();
      await thumb(page,P2).tap();
    }else{
      await libraryTopMenu(page,'select');
      await page.locator(`[data-lu-pick="${P1}"]`).check();
      await thumb(page,P2).click();
    }
    await expect(page.locator('#librarySelectCount')).toHaveText('2개 선택됨');
    await expect(page.locator(`[data-lu-pick="${P1}"]`)).toBeChecked();
    await expect(page.locator(`[data-lu-pick="${P2}"]`)).toBeChecked();
    await expect(page.locator(`[data-lu-pick="${P3}"]`)).not.toBeChecked();
    await expect(page.locator('#documentModal')).toBeHidden();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await shot(page,`photo-pick-${width}`);
    await press(page,bar(page).getByRole('button',{name:'폴더로 옮기기',exact:true}),width);
    await expect(movePicker(page)).toBeVisible();
    await press(page,moveFolder(page,'fn'),width);
    await expect(movePicker(page)).toBeHidden();
    await expect.poll(()=>inFolder(s,'fn')).toEqual([P1,P2].sort());
    expect(inFolder(s,'fa')).toEqual(['d-1',P3].sort());
    await expect(line(page)).toContainText('옮겼어요 2개 → 가상 N 폴더');
    await expect(bar(page)).toBeHidden();
    await expect(fold(page)).toHaveText(/사진 1/);
    await shot(page,`photo-moved-${width}`);
    await press(page,line(page).locator('.lu-undo'),width);
    await expect.poll(()=>inFolder(s,'fa')).toEqual(['d-1',P1,P2,P3].sort());
    await expect(fold(page)).toHaveText(/사진 3/);
    expect(errors).toEqual([]);
  });

  test(`문서와 사진을 함께 골라 한 번에 옮긴다 ${width}`,async({page})=>{
    const {s,errors}=await boot(page,width);
    await libraryTopMenu(page,'select',{tap:width<761});
    await page.locator('[data-lu-pick="d-1"]').check();
    await page.locator(`[data-lu-pick="${P3}"]`).check();
    await expect(page.locator('#librarySelectCount')).toHaveText('2개 선택됨');
    await press(page,bar(page).getByRole('button',{name:'폴더로 옮기기',exact:true}),width);
    await press(page,moveFolder(page,'fn'),width);
    await expect.poll(()=>inFolder(s,'fn')).toEqual(['d-1',P3].sort());
    expect(errors).toEqual([]);
  });
});

test.describe('PC 우클릭 1440',()=>{
  test('사진 작은 그림 우클릭은 브라우저 메뉴 대신 그 사진의 ⋯ 메뉴(선택 모드에서도)',async({page})=>{
    const {errors}=await boot(page,1440);
    const panel=page.locator('#luMorePanel');
    const prevented=()=>thumb(page,P1).evaluate(el=>{const r=el.getBoundingClientRect();const ev=new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+20,clientY:r.top+30,button:2});el.dispatchEvent(ev);return ev.defaultPrevented});
    expect(await prevented()).toBe(true);
    await expect(panel).toBeVisible();
    for(const name of ['선택','이름 바꾸기','내려받기','삭제'])await expect(panel.getByRole('button',{name,exact:false}).first()).toBeVisible();
    await expect(panel.locator(`[data-lu-move-open="${P1}"]`)).toBeVisible();
    await shot(page,'photo-context-1440');
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    // 선택 모드: 우클릭 = 고른 것 모두에 대한 메뉴(누른 사진이 안 골라졌으면 더함) — 문서 줄과 같은 규칙.
    await libraryTopMenu(page,'select');
    await page.locator(`[data-lu-pick="${P2}"]`).check();
    expect(await prevented()).toBe(true);
    await expect(panel).toBeVisible();
    await expect(panel.locator('.lu-menu-head')).toHaveText('2개 선택됨');
    await expect(page.locator('#librarySelectCount')).toHaveText('2개 선택됨');
    expect(errors).toEqual([]);
  });
});

// 명진 캡처의 PC 두 칸 보기: 칸 안 [사진 n]도 같은 네모 칸·같은 위 막대·같은 우클릭 메뉴.
test.describe('PC 두 칸 보기 1440',()=>{
  test('두 칸 안 사진도 고르기·옮기기·우클릭 메뉴',async({page})=>{
    const {s,errors}=await bootLibrary(page,1440,{folders:FOLDERS,items:[],docs:structuredClone(DOCS),group:'폴더',init:{viewPrefs:null}});
    await page.route('**/functions/v1/library-files*',route=>route.fulfill({status:200,contentType:'image/png',body:PNG}));
    await expect(page.locator('#documentList [data-lu-two]')).toBeVisible();
    const paneFold=page.locator('#documentList [data-lu-two] [data-lu-photos="x:out"]').last();
    await paneFold.click();
    const tile=id=>page.locator(`#documentList [data-lu-two] .photo-fold-tile [data-lu-document="${id}"]`).last();
    await expect(tile(P1)).toBeVisible();
    await tile(P1).click({button:'right'});
    await expect(page.locator('#luMorePanel')).toBeVisible();
    await page.keyboard.press('Escape');
    await libraryTopMenu(page,'select');
    await tile(P1).click();await tile(P2).click();
    await expect(page.locator('#librarySelectCount')).toHaveText('2개 선택됨');
    await shot(page,'photo-pick-two-pane-1440');
    await bar(page).getByRole('button',{name:'폴더로 옮기기',exact:true}).click();
    await moveFolder(page,'fn').click();
    await expect.poll(()=>inFolder(s,'fn')).toEqual([P1,P2].sort());
    await expect(line(page)).toContainText('옮겼어요 2개');
    await line(page).locator('.lu-undo').click();
    await expect.poll(()=>inFolder(s,'fn')).toEqual([]);
    expect(errors).toEqual([]);
  });
});
