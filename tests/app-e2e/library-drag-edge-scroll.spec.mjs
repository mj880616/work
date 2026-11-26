import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder,libDoc} from './helpers/library-folder-server.mjs';
import {expandLibraryTree} from './helpers/library-tree.mjs';
// S69-15 UI-끌기가장자리스크롤(사용자 11/24 08:19 "자료를 클릭해서 드래그할 때 스크롤이 가능해야 함."): 자료를 끄는 동안
// 포인터(손가락) 아래 칸의 위·아래 가장자리에 오면 그 칸이 저절로 굴러, 화면 밖 폴더에 놓을 수 있다. 이름은 지어낸 것.
// PC 1440 = 두 칸 보기 오른쪽 칸 목록(.lu-pane-list, 칸마다 따로 굴러감)을 실제 마우스 끌기로, 폰 412 = 한 칸 목록을 길게 눌러 끌기로.
const MANY=Array.from({length:40},(_,i)=>libFolder('g'+String(i).padStart(2,'0'),null,{name:'가상 묶음 '+String(i).padStart(2,'0'),sort_order:2048+i*1024}));
const FOLDERS=[libFolder('src',null,{name:'가상 시작',sort_order:1024}),...MANY];
const LAST='g39';
const docs=[libDoc('d-1',null,{title:'가상 끌 자료'})];
const ITEMS=[{document_id:'d-1',folder_id:'src'}];
const folderOf=(s,doc)=>s.items.find(x=>x.document_id===doc)?.folder_id||null;
const center=(page,sel)=>page.locator(sel).evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}});

// HTML 끌기는 브라우저 끌기 신호(dragstart → 그 점의 dragover 되풀이 → drop)를 그대로 보낸다. 손을 멈춰도 브라우저는 dragover를 계속 보내므로 되풀이로 흉내 낸다.
const startDrag=(page,src)=>page.evaluate(sel=>{window.__dt=new DataTransfer();document.querySelector(sel).dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:__dt}))},src);
const holdAt=(page,x,y)=>page.evaluate(({x,y})=>{clearInterval(window.__hold);const go=()=>document.elementFromPoint(x,y)?.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:__dt,clientX:x,clientY:y}));go();window.__hold=setInterval(go,50)},{x,y});
const dropAt=(page,src,x,y)=>page.evaluate(({src,x,y})=>{clearInterval(window.__hold);const el=document.elementFromPoint(x,y);el.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:__dt,clientX:x,clientY:y}));
  el.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:__dt,clientX:x,clientY:y}));document.querySelector(src)?.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:__dt}))},{src,x,y});
const pane=i=>`#documentList [data-lu-pane-i="${i}"]`,list=`${pane(1)} .lu-pane-list`,src=`${pane(0)} [data-lu-document="d-1"]`;
const scrollTop=page=>page.locator(list).evaluate(el=>el.scrollTop);
async function bootTwo(page){
  const r=await bootLibrary(page,1440,{folders:FOLDERS,items:ITEMS,docs,group:'폴더',init:{viewPrefs:null}});
  // 왼쪽 칸은 '가상 시작' 폴더 안(끌 자료 하나), 오른쪽 칸은 맨 위(폴더 41개 — 칸 목록이 넘친다).
  await page.locator(`${pane(0)} [data-lu-nav="src"]`).click({button:'right'});
  await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click();
  await expect(page.locator(src)).toBeVisible();
  const box=await page.locator(list).evaluate(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:Math.min(innerHeight,r.bottom),left:r.left,width:r.width,sh:el.scrollHeight,ch:el.clientHeight}});
  expect(box.sh).toBeGreaterThan(box.ch+200);
  return {...r,box};
}

test('PC 1440 두 칸: 자료를 오른쪽 칸 아래 가장자리로 끌면 그 칸이 저절로 굴러 화면 밖 폴더에 놓을 수 있다',async({page})=>{
  test.setTimeout(60000);
  const {s,errors,box}=await bootTwo(page);
  const target=`${pane(1)} [data-lu-nav="${LAST}"]`;
  expect(await scrollTop(page)).toBe(0);
  // 놓을 폴더는 처음엔 칸 밖(칸 아래)에 있다.
  expect(await page.locator(target).evaluate(el=>el.getBoundingClientRect().top)).toBeGreaterThan(box.bottom);
  await startDrag(page,src);
  // 가운데에서는 굴러가지 않는다.
  await holdAt(page,box.left+box.width/2,(box.top+box.bottom)/2);await page.waitForTimeout(300);
  expect(await scrollTop(page)).toBe(0);
  // 오른쪽 칸 아래 가장자리 안(6px)에 들고 있으면 그 칸 목록이 끝까지 굴러간다(전에는 칸 바깥만 굴러 칸 목록은 그대로였다). 칸이 끝이면 화면이 이어 굴러간다.
  await holdAt(page,box.left+box.width/2,box.bottom-6);
  await expect.poll(()=>scrollTop(page),{timeout:8000}).toBeGreaterThan(box.sh-box.ch-4);
  // 칸 안으로 들어온 폴더 위에 놓는다.
  const to=await center(page,target);
  expect(to.y).toBeLessThan(box.bottom);expect(to.y).toBeGreaterThan(box.top);
  await dropAt(page,src,to.x,to.y);
  await expect.poll(()=>folderOf(s,'d-1')).toBe(LAST);
  await expect(page.locator('#libraryFolderStatusLine')).toContainText('가상 묶음 39 폴더');
  // 끌기가 끝나면 더 굴러가지 않는다.
  const after=await scrollTop(page);await page.waitForTimeout(300);
  expect(await scrollTop(page)).toBe(after);
  expect(errors).toEqual([]);
});

test('PC 1440 두 칸: 칸 위 가장자리로 끌면 위로 굴러가고, 끄는 소식이 끊기면 멈춘다',async({page})=>{
  const {errors,box}=await bootTwo(page);
  await page.locator(list).evaluate(el=>{el.scrollTop=el.scrollHeight});
  const end=await scrollTop(page);expect(end).toBeGreaterThan(200);
  await startDrag(page,src);
  await holdAt(page,box.left+box.width/2,box.top+6);
  await expect.poll(()=>scrollTop(page),{timeout:8000}).toBe(0);
  // 아래 가장자리에서 한 번만 dragover(이후 소식 없음, 끝 신호도 없음) → 잠시 뒤 멈춘다(끝없이 굴러가지 않음).
  await page.evaluate(()=>clearInterval(window.__hold));
  await page.evaluate(({x,y})=>document.elementFromPoint(x,y).dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:__dt,clientX:x,clientY:y})),{x:box.left+box.width/2,y:box.bottom-2});
  await page.waitForTimeout(2200);
  const a=await scrollTop(page);await page.waitForTimeout(300);
  expect(await scrollTop(page)).toBe(a);
  expect(a).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test.describe('폰 412 길게 눌러 끌기',()=>{
  test.use({hasTouch:true});
  const touch=(cdp,type,pts)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pts.map((p,i)=>({x:p.x,y:p.y,id:i}))});
  test('자료를 길게 눌러 화면 아래 가장자리로 끌면 목록이 저절로 굴러 화면 밖 폴더에 놓을 수 있다',async({page})=>{
    test.setTimeout(60000);
    const {s,errors}=await bootLibrary(page,412,{folders:FOLDERS,items:ITEMS,docs,group:'폴더'});
    await expandLibraryTree(page);
    const src='#documentList [data-lu-document="d-1"]',target=`#documentList details[data-lu-node="f:${LAST}"] > summary`;
    await page.locator(src).scrollIntoViewIfNeeded();
    const vh=await page.evaluate(()=>innerHeight);
    const targetTop=()=>page.locator(target).evaluate(el=>el.getBoundingClientRect().top);
    expect(await targetTop()).toBeGreaterThan(vh);
    const cdp=await page.context().newCDPSession(page);
    const from=await center(page,src+' .lu-row-title');
    await touch(cdp,'touchStart',[from]);await page.waitForTimeout(700);
    await expect(page.locator(src)).toHaveClass(/lu-grabbed/);
    // 화면 아래 가장자리 안(6px)까지 끌고 손가락을 멈춘다 → 놓을 폴더가 화면 안으로 올라올 때까지 저절로 굴러간다.
    const edge={x:from.x,y:vh-6};
    for(const f of [0.25,0.5,0.75,1])await touch(cdp,'touchMove',[{x:from.x,y:from.y+(edge.y-from.y)*f}]);
    await expect.poll(targetTop,{timeout:10000}).toBeLessThan(vh-120);
    const to=await center(page,target);
    for(const f of [0.5,1])await touch(cdp,'touchMove',[{x:to.x,y:edge.y+(to.y-edge.y)*f}]);
    await expect(page.locator(target)).toHaveClass(/lu-drop-into/);
    await touch(cdp,'touchEnd',[]);
    await expect.poll(()=>folderOf(s,'d-1')).toBe(LAST);
    await expect(page.locator('#libraryFolderStatusLine')).toContainText('옮겼어요');
    expect(errors).toEqual([]);
  });
});
