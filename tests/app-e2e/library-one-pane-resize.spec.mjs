import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder,libDoc} from './helpers/library-folder-server.mjs';
// S69-29 LIB-한칸크기끌기(명진 11/24 "창 밑으로도 드래그 가능하게 · 정확히는 높이를 · 드래그로 늘릴 수 있게",
// "한칸보기에서 왼쪽 목록이랑 오른쪽 폴더 또는 자료 보기 사이 드래그가안되네"): 자료실 한 칸 탐색기(왼쪽 나무 | 오른쪽 그 폴더 내용).
// ① 카드 아래 테두리 끌기 = 카드 높이(서버 기억, 다시 열어도 그대로), 두 번 누르기 = 내용만큼. 늘린 빈 곳에서 사각형 고르기·파일 놓기(지금 폴더로).
// ② 두 칸 사이 세로 선 끌기 = 왼쪽 나무 칸 폭(서버 기억), 두 번 누르기 = 기본.
// ③ 오른쪽 자료(여러 개 고른 것 포함)를 왼쪽 나무 폴더에 끌어 놓기 + 끄는 동안 따라오는 반투명 조각(마우스·손가락).
// 가짜 서버만, 이름은 모두 지어낸 것이다.
const FOLDERS=[libFolder('t1',null,{name:'가상 일',sort_order:1}),libFolder('t2',null,{name:'가상 이',sort_order:2}),libFolder('t3',null,{name:'가상 삼',sort_order:3})];
const DOCS=['d1','d2','d3'].map((id,i)=>libDoc(id,null,{title:'가상 자료 '+(i+1)}));
const ITEMS=[{document_id:'d1',folder_id:'t1'},{document_id:'d2',folder_id:'t1'},{document_id:'d3',folder_id:'t1'}];
const nav=id=>`#libraryFolderNav [data-lu-nav="${id}"]`;
const card=page=>page.locator('#libraryListCard');
const heightGrip=page=>card(page).locator(':scope > .height-resize-handle');
const widthGrip=page=>card(page).locator(':scope > .split-resize-handle');
const navWidth=page=>page.locator('#libraryFolderNav').evaluate(e=>e.getBoundingClientRect().width);
const cardHeight=page=>card(page).evaluate(e=>e.getBoundingClientRect().height);
const lib=s=>s.viewPrefs?.col_widths?.library||{};
const folderOf=(s,doc)=>s.items.find(x=>x.document_id===doc)?.folder_id||null;
async function boot(page,width=1280,opt={}){
  const r=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,docs:DOCS,init:{viewPrefs:{library_two:false}},...opt});
  await page.locator('#libraryGroupBy').selectOption({label:'폴더'});
  await expect(page.locator('#libraryFolderNav')).toBeVisible();
  return r;
}
async function dragBy(page,grip,dx,dy){
  await grip.scrollIntoViewIfNeeded();
  const b=await grip.boundingBox(),x=b.x+Math.min(b.width/2,300),y=b.y+Math.min(b.height/2,60);
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:6});await page.mouse.up();
}
// 파일을 실은 DataTransfer로 그 점(카드 안 x,y)의 맨 위 요소에 dragenter → dragover → drop. 놓기 직전 안내 글을 돌려준다.
const dropFileAt=(page,x,y,name)=>page.evaluate(({x,y,name})=>{
  const dst=document.elementFromPoint(x,y),dt=new DataTransfer();dt.items.add(new File(['PK synthetic'],name,{type:'application/octet-stream'}));
  const fire=type=>{const ev=new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt,clientX:x,clientY:y});dst.dispatchEvent(ev);return ev};
  fire('dragenter');const over=fire('dragover');const hint=document.querySelector('#libraryDropOverlay')?.textContent||'';fire('drop');
  return {allowed:over.defaultPrevented,hint,inList:!!dst.closest('#documentList')};
},{x,y,name});

test('PC 1280 ① 카드 아래 테두리 끌기 = 높이(서버 기억·다시 열어도 그대로) · 늘린 빈 곳 사각형 고르기·파일 놓기 · 두 번 누르기 = 내용만큼',async({page,browser})=>{
  test.setTimeout(60000);
  const {errors,s}=await boot(page);
  await page.locator(nav('t1')).click();
  await expect(page.locator('#documentList [data-lu-document="d3"]')).toBeVisible();
  await expect(heightGrip(page)).toBeVisible();
  await expect(heightGrip(page)).toHaveAttribute('role','separator');
  await expect(card(page)).not.toHaveAttribute('data-lu-fixed-h','');
  const h0=await cardHeight(page);
  await dragBy(page,heightGrip(page),0,260);
  await expect(card(page)).toHaveAttribute('data-lu-fixed-h','');
  const h1=await cardHeight(page);
  expect(Math.abs(h1-(h0+260))).toBeLessThanOrEqual(4);
  await expect.poll(()=>lib(s).h2).toBe(Math.round(h1/2));
  // 왼쪽 나무·오른쪽 목록 칸이 카드 높이를 채운다(카드 밖으로 넘치지 않음).
  const cb=await card(page).evaluate(e=>e.getBoundingClientRect().bottom);
  for(const sel of ['#libraryFolderNav','#documentList']){const b=await page.locator(sel).evaluate(e=>e.getBoundingClientRect().bottom);expect(b).toBeLessThanOrEqual(cb+0.5);expect(b).toBeGreaterThan(cb-40)}
  // 늘린 빈 곳(마지막 줄 아래)에서 끌면 사각형 고르기가 시작된다.
  const last=await page.locator('#documentList [data-lu-document]').last().boundingBox();
  expect(cb-(last.y+last.height)).toBeGreaterThan(120); // 마지막 줄 아래에 늘린 빈 곳이 있다
  const from={x:last.x+last.width/2,y:(last.y+last.height+cb)/2};
  await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(from.x+6,from.y-8,{steps:3});
  await expect(page.locator('.marquee-box')).toBeVisible();
  await page.mouse.move(from.x+20,last.y+last.height/2,{steps:6});await page.mouse.up();
  await expect(page.locator('#librarySelectBar')).toBeVisible();
  await expect(page.locator('#librarySelectCount')).toHaveText(/[1-9]개 선택됨/);
  await page.keyboard.press('Escape'); // S70-64b: [✕] 대신 Esc
  // 늘린 빈 곳에 파일을 놓으면 지금 보는 폴더(가상 일)로 올라간다.
  const blank=await page.locator('#documentList [data-lu-document]').last().boundingBox();
  const r=await dropFileAt(page,blank.x+blank.width/2,(blank.y+blank.height+cb)/2,'new.pdf');
  expect(r).toMatchObject({allowed:true,hint:'놓으면 ‘가상 일’ 폴더로 올려요',inList:true});
  await expect.poll(()=>s.items.filter(x=>x.folder_id==='t1').length).toBe(4);
  // 다시 열어도(새 화면, 같은 서버) 그 높이.
  // 다시 열기 = 새 브라우저(같은 서버 상태).
  const ctx2=await browser.newContext(),page2=await ctx2.newPage();
  await boot(page2,1280,{state:s,init:{}}); // init 없이: 앞 화면이 저장한 서버 값 그대로
  await expect(card(page2)).toHaveAttribute('data-lu-fixed-h','');
  expect(Math.abs(await cardHeight(page2)-h1)).toBeLessThanOrEqual(2);
  // 두 번 누르기 = 내용만큼(서버 값도 지움).
  await heightGrip(page2).scrollIntoViewIfNeeded();
  await heightGrip(page2).dblclick({position:{x:300,y:6}});
  await expect(card(page2)).not.toHaveAttribute('data-lu-fixed-h','');
  await expect.poll(()=>lib(s).h2).toBeUndefined();
  await ctx2.close();
  expect(errors).toEqual([]);
});

test('PC 1280 ② 두 칸 사이 세로 선 끌기 = 왼쪽 나무 칸 폭(서버 기억·다시 열어도 그대로) · 두 번 누르기 = 기본',async({page,browser})=>{
  test.setTimeout(60000);
  const {errors,s}=await boot(page);
  await expect(widthGrip(page)).toBeVisible();
  await expect(widthGrip(page)).toHaveAttribute('aria-controls','libraryFolderNav');
  const w0=await navWidth(page),list0=await page.locator('#documentList').evaluate(e=>e.getBoundingClientRect().left);
  await dragBy(page,widthGrip(page),120,0);
  const w1=await navWidth(page);
  expect(Math.abs(w1-(w0+120))).toBeLessThanOrEqual(3);
  // 오른쪽 목록이 같이 밀린다(겹치지 않음).
  expect(await page.locator('#documentList').evaluate(e=>e.getBoundingClientRect().left)).toBeGreaterThan(list0+110);
  await expect.poll(()=>lib(s).fnav).toBe(Math.round(w1));
  // 다시 열기 = 새 브라우저(같은 서버 상태).
  const ctx2=await browser.newContext(),page2=await ctx2.newPage();
  await boot(page2,1280,{state:s,init:{}}); // init 없이: 앞 화면이 저장한 서버 값 그대로
  expect(Math.abs(await navWidth(page2)-w1)).toBeLessThanOrEqual(2);
  await widthGrip(page2).dblclick();
  expect(Math.abs(await navWidth(page2)-w0)).toBeLessThanOrEqual(3);
  await expect.poll(()=>lib(s).fnav).toBeUndefined();
  await ctx2.close();
  // 두 칸 보기에서는 이 손잡이 둘 다 보이지 않는다(두 칸 경계는 그 화면 것).
  await page.locator('#libraryTwoBtn').click();
  await expect(page.locator('#documentList [data-lu-two]')).toBeVisible();
  await expect(heightGrip(page)).toBeHidden();
  await expect(widthGrip(page)).toBeHidden();
  expect(errors).toEqual([]);
});

test('PC 1280 ③ 오른쪽 자료 여러 개를 왼쪽 나무 폴더에 끌어 놓기 + 따라오는 반투명 조각',async({page})=>{
  const {errors,s}=await boot(page);
  await page.evaluate(()=>{window.__ghost=[];const o=DataTransfer.prototype.setDragImage;DataTransfer.prototype.setDragImage=function(el,x,y){window.__ghost.push(el.textContent);return o.call(this,el,x,y)}});
  await page.locator(nav('t1')).click();
  // 둘을 고른 채(Ctrl+클릭) 하나를 끌면 둘 다 옮겨진다.
  await page.locator('#documentList [data-lu-document="d1"] .lu-row-title').click({modifiers:['Control']});
  await page.locator('#documentList [data-lu-document="d2"] .lu-row-title').click({modifiers:['Control']});
  await expect(page.locator('#librarySelectCount')).toHaveText('2개 선택됨');
  await page.locator('#documentList [data-lu-document="d1"]').dragTo(page.locator(nav('t3')));
  await expect.poll(()=>[folderOf(s,'d1'),folderOf(s,'d2'),folderOf(s,'d3')]).toEqual(['t3','t3','t1']);
  expect(await page.evaluate(()=>window.__ghost)).toEqual(['자료 2개']);
  // 하나만 끌면 그 제목.
  await page.locator('#documentList [data-lu-document="d3"]').dragTo(page.locator(nav('t2')));
  await expect.poll(()=>folderOf(s,'d3')).toBe('t2');
  expect(await page.evaluate(()=>window.__ghost)).toEqual(['자료 2개','가상 자료 3']);
  expect(errors).toEqual([]);
});

test.describe('펼친 폴드 800 손가락',()=>{
  test.use({hasTouch:true});
  const touch=(cdp,type,pts)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pts.map((p,i)=>({x:p.x,y:p.y,id:i}))});
  const center=(page,sel)=>page.locator(sel).first().evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.left+Math.min(r.width/2,120),y:r.top+r.height/2}});
  test('③ 길게 눌러 오른쪽 자료를 왼쪽 나무 폴더로 — 손가락을 따라오는 조각, 놓으면 사라짐',async({page})=>{
    const {errors,s}=await boot(page,800);
    await page.locator(nav('t1')).tap();
    await expect(page.locator('#documentList [data-lu-document="d1"]')).toBeVisible();
    const cdp=await page.context().newCDPSession(page);
    const from=await center(page,'#documentList [data-lu-document="d1"] .lu-row-title'),to=await center(page,nav('t2'));
    await touch(cdp,'touchStart',[from]);await page.waitForTimeout(700);
    await expect(page.locator('#documentList [data-lu-document="d1"]')).toHaveClass(/lu-grabbed/);
    for(const f of [0.25,0.5,0.75,1])await touch(cdp,'touchMove',[{x:from.x+(to.x-from.x)*f,y:from.y+(to.y-from.y)*f}]);
    await expect(page.locator('[data-drag-ghost]')).toHaveText('가상 자료 1');
    await expect(page.locator(nav('t2')).locator('xpath=..')).toHaveClass(/lu-drop-into/);
    await touch(cdp,'touchEnd',[]);
    await expect.poll(()=>folderOf(s,'d1')).toBe('t2');
    await expect(page.locator('[data-drag-ghost]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
  test('② 펼친 폴드에서도 두 칸 사이·카드 아래 손잡이가 있다',async({page})=>{
    const {errors}=await boot(page,800);
    await expect(widthGrip(page)).toBeVisible();
    await expect(heightGrip(page)).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test('폰 412: 손잡이 없음(나무 칸 없는 한 줄 목록 그대로)',async({page})=>{
  const {errors}=await bootLibrary(page,412,{folders:FOLDERS,items:ITEMS,docs:DOCS,init:{viewPrefs:{library_two:false}}});
  await page.locator('#libraryGroupBy').selectOption({label:'폴더'});
  await expect(page.locator('#documentList details[data-lu-node="f:t1"]')).toBeVisible();
  await expect(heightGrip(page)).toBeHidden();
  await expect(widthGrip(page)).toBeHidden();
  await expect(card(page)).not.toHaveAttribute('data-lu-fixed-h','');
  expect(errors).toEqual([]);
});
