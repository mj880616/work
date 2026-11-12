import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {revealLibraryRow} from './helpers/library-tree.mjs';
import {bootLibrary,libDoc,libFolder,menuButton,press} from './helpers/library-folder-server.mjs';
// S60-27 LIB-나누기메뉴모양: 받는 폴더 메뉴의 [폴더로 나누기](③ 글자 버튼 row-act)가 다른 메뉴 줄과 같은 모양(메뉴 안 row-act는 메뉴 줄 공용 모양).
// S60-27 LIB-추천넣기안열기: 폴더 밖 자료의 점선 추천 '📁 ○○?'으로 넣을 때 받는 폴더를 펼치지 않고 화면 자리를 그대로 둔다
// (되돌리기·Ctrl+Z는 그대로). 가짜 서버·지어낸 이름만. MENU_SHOTS에 폴더를 주면 PR 사진을 남긴다.
const u=n=>`5f270000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const RECV=u(1),GYO=u(2);
const IN1=u(101),O1=u(201),O2=u(202),O3=u(203),O4=u(204);
const FOLDERS=[libFolder(GYO,null,{name:'가상 교섭',sort_order:1024}),libFolder(RECV,null,{name:'잡동사니',sort_order:2048})];
// 폴더 밖 자료 O1~O3은 제목 첫 낱말('가상메모')이 잡동사니 안 자료와 같아 '잡동사니?' 추천을 받는다.
const DOCS=[libDoc(IN1,null,{title:'가상메모 0'}),libDoc(O1,null,{title:'가상메모 1'}),libDoc(O2,null,{title:'가상메모 2'}),libDoc(O3,null,{title:'가상메모 3'}),libDoc(O4,null,{title:'다른 자료'})];
const ITEMS=[{document_id:IN1,folder_id:RECV}];
const SHOTS=process.env.MENU_SHOTS||'';
const shot=async(page,name,info)=>{if(SHOTS){mkdirSync(SHOTS,{recursive:true});await page.screenshot({path:`${SHOTS}/${name}`})}await page.screenshot({path:info.outputPath(name)})};
const folderOf=(s,id)=>s.items.find(x=>x.document_id===id)?.folder_id||null;
const recvOpen=page=>page.locator(`#documentList details[data-lu-node="f:${RECV}"]`).evaluate(d=>d.open);
const looks=loc=>loc.evaluate(b=>{const c=getComputedStyle(b);return {size:c.fontSize,color:c.color,weight:c.fontWeight,lineHeight:c.lineHeight,padding:c.padding,bg:c.backgroundColor,width:Math.round(b.getBoundingClientRect().width),height:Math.round(b.getBoundingClientRect().height)}});

for(const width of [1280,412])test.describe(`폴더 메뉴 [폴더로 나누기] 모양 ${width}`,()=>{
  test.use(width<761?{hasTouch:true,isMobile:true}:{hasTouch:false});
  test(`[폴더로 나누기]가 [✓ 폴더 안 정한 자료 받기] 바로 아래, 같은 크기·색, 누르면 창 ${width}`,async({page},info)=>{
    const {errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,docs:DOCS,group:'폴더',init:{viewPrefs:{library_two:false},receiveFolder:RECV}});
    await page.route('**/functions/v1/ai-assist',route=>route.request().method()==='OPTIONS'?route.fulfill({status:204,body:''}):route.fulfill({json:{ok:true,kind:'library_sort',items:[]}}));
    await press(page,menuButton(page,'f:'+RECV),width);
    const menu=page.locator('#luFolderMenu');
    const sort=menu.locator('[data-lu-folder-action="sort"]'),recv=menu.locator('[data-lu-folder-action="receive"]');
    await expect(sort).toHaveText('폴더로 나누기');
    // 자리: 받기 줄 바로 다음.
    expect(await recv.evaluate(b=>b.nextElementSibling?.dataset.luFolderAction)).toBe('sort');
    const a=await looks(sort),b=await looks(recv);
    expect(a).toEqual(b);
    // 메뉴 안 글자 버튼(row-act)도 메뉴 줄 모양: 누르는 범위 덧칸(::after) 없음, 줄 높이·글자·색이 다른 줄과 같음.
    expect(await sort.evaluate(b=>getComputedStyle(b,'::after').content)).toBe('none');
    await shot(page,`folder-menu-${width}.png`,info);
    await press(page,sort,width);
    await expect(page.locator('#librarySortModal')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('점선 추천으로 넣기 PC 1280',()=>{
  test.use({hasTouch:false});
  test('폴더 밖 자료 3개를 차례로 \'잡동사니?\'로 넣어도 잡동사니는 닫힌 채·화면 자리 그대로, 되돌리기·Ctrl+Z',async({page},info)=>{
    const {s,errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS,docs:DOCS,group:'폴더',init:{viewPrefs:{library_two:false}}});
    const out=page.locator('#documentList details[data-lu-node="x:out"]');
    await revealLibraryRow(page,O1);
    await expect(out).toHaveJSProperty('open',true);
    expect(await recvOpen(page)).toBe(false);
    const tip=id=>page.locator(`[data-lu-document="${id}"] [data-lu-suggest]`);
    await expect(tip(O1)).toHaveText('잡동사니?');
    await shot(page,'suggest-before-1280.png',info);
    for(const id of [O1,O2,O3]){
      const y=await page.evaluate(()=>scrollY);
      const top=await out.boundingBox();
      await tip(id).click();
      await expect.poll(()=>folderOf(s,id)).toBe(RECV);
      await expect(page.locator(`#documentList details[data-lu-node="x:out"] [data-lu-document="${id}"]`)).toHaveCount(0);
      await expect(page.locator('#libraryFolderStatusLine')).toContainText('잡동사니');
      expect(await recvOpen(page)).toBe(false);
      expect(await page.evaluate(()=>scrollY)).toBe(y);
      // 첫 번째에만 목록 위 알림 줄('옮겼어요 → … · 되돌리기', 공용)이 나타나 그 높이만큼 내려간다. 그 뒤로는 자리 그대로.
      const dy=Math.round((await out.boundingBox()).y-top.y);
      if(id===O1){const line=await page.locator('#libraryFolderStatusLine').boundingBox();expect(Math.abs(dy-Math.round(line.height+(await page.locator('#libraryFolderStatusLine').evaluate(e=>parseFloat(getComputedStyle(e).marginTop)+parseFloat(getComputedStyle(e).marginBottom)))))).toBeLessThanOrEqual(12)}
      else expect(dy).toBe(0);
    }
    await shot(page,'suggest-after-1280.png',info);
    // 남은 폴더 밖 자료(다른 자료)는 그대로 바로 누를 수 있다.
    await expect(page.locator(`#documentList details[data-lu-node="x:out"] [data-lu-document="${O4}"]`)).toBeVisible();
    // 되돌리기(줄) — 마지막에 넣은 O3이 폴더 밖으로.
    await page.locator('#libraryFolderStatusLine .lu-undo').click();
    await expect.poll(()=>folderOf(s,O3)).toBe(null);
    // Ctrl+Z — 한 번 더 넣고 키로 되돌린다.
    await tip(O3).click();
    await expect.poll(()=>folderOf(s,O3)).toBe(RECV);
    await page.locator('body').click({position:{x:2,y:2}});
    await page.keyboard.press('Control+z');
    await expect.poll(()=>folderOf(s,O3)).toBe(null);
    expect(await recvOpen(page)).toBe(false);
    expect(errors).toEqual([]);
  });
  test('다른 옮기기(⋯ [옮기기…])는 지금처럼 받는 폴더를 펼친다',async({page})=>{
    const {s,errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS,docs:DOCS,group:'폴더',init:{viewPrefs:{library_two:false}}});
    await revealLibraryRow(page,O4);
    expect(await recvOpen(page)).toBe(false);
    await page.locator(`[data-lu-menu="${O4}"]`).click();
    await page.locator(`#luMorePanel [data-lu-move-open="${O4}"]`).click();
    await page.locator('#luMovePicker').locator(`[data-lu-move-folder="${RECV}"]`).last().click();
    await expect.poll(()=>folderOf(s,O4)).toBe(RECV);
    await expect.poll(()=>recvOpen(page)).toBe(true);
    expect(errors).toEqual([]);
  });
});

test.describe('점선 추천으로 넣기 폰 412',()=>{
  test.use({hasTouch:true,isMobile:true});
  test('추천을 눌러 넣어도 잡동사니는 닫힌 채, 줄의 [되돌리기]로 원래대로',async({page},info)=>{
    const {s,errors}=await bootLibrary(page,412,{folders:FOLDERS,items:ITEMS,docs:DOCS,group:'폴더'});
    await revealLibraryRow(page,O1);
    const tip=id=>page.locator(`[data-lu-document="${id}"] [data-lu-suggest]`);
    for(const id of [O1,O2]){await tip(id).tap();await expect.poll(()=>folderOf(s,id)).toBe(RECV);expect(await recvOpen(page)).toBe(false)}
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await shot(page,'suggest-after-412.png',info);
    await page.locator('#libraryFolderStatusLine .lu-undo').tap();
    await expect.poll(()=>folderOf(s,O2)).toBe(null);
    expect(errors).toEqual([]);
  });
});
