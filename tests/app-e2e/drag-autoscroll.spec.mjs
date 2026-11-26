import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder,libDoc} from './helpers/library-folder-server.mjs';
import {expandLibraryTree} from './helpers/library-tree.mjs';
// S70-10 UI-끌기자동스크롤(사용자 11/25 09:43 "이렇게 드래그할 때 스크롤 되어야 해 / 전수조사해서 모든 곳 고쳐요"): 자료실 한 칸 폴더 보기는
// 처음 20개 + '20개 더 보기'라, 화면이 끝까지 구른 뒤에는 더 내려가지 않았다(고치기 전 main에서 이 파일의 시험이 실패: 줄 20개 그대로).
// 끄는 동안 아래 가장자리에 머물면 '더 보기'가 저절로 열려 계속 굴러가고, 위 가장자리로 다시 올라가 왼쪽 나무 폴더에 놓을 수 있다. 이름은 지어낸 것.
const FOLDERS=[libFolder('w',null,{name:'가상 주간',sort_order:1024}),libFolder('z',null,{name:'가상 끝',sort_order:4096})];
const docs=Array.from({length:40},(_,i)=>libDoc('d'+String(i).padStart(2,'0'),null,{title:'가상 자료 '+String(i).padStart(2,'0')}));
const ITEMS=docs.map(d=>({document_id:d.id,folder_id:'w'}));
const folderOf=(s,doc)=>s.items.find(x=>x.document_id===doc)?.folder_id||null;
const center=(page,sel)=>page.locator(sel).first().evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}});
const rows=page=>page.locator('#documentList [data-lu-document]').count();
const pageTop=page=>page.evaluate(()=>document.scrollingElement.scrollTop);
const startDrag=(page,src)=>page.evaluate(sel=>{window.__dt=new DataTransfer();document.querySelector(sel).dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:__dt}))},src);
const holdAt=(page,x,y)=>page.evaluate(({x,y})=>{clearInterval(window.__hold);const go=()=>document.elementFromPoint(x,y)?.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:__dt,clientX:x,clientY:y}));go();window.__hold=setInterval(go,50)},{x,y});
const dropAt=(page,x,y)=>page.evaluate(({x,y})=>{clearInterval(window.__hold);const el=document.elementFromPoint(x,y);el.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:__dt,clientX:x,clientY:y}));
  el.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:__dt,clientX:x,clientY:y}));document.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:__dt}))},{x,y});

test('PC 1280 한 칸: 파일을 아래 가장자리로 끌고 머물면 \'더 보기\'가 열려 계속 굴러가고, 위로 올라가 나무 폴더에 놓는다',async({page})=>{
  test.setTimeout(60000);
  const {s,errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS,docs,group:'폴더',init:{viewPrefs:null}});
  await page.getByRole('button',{name:'한 칸'}).click();
  await page.locator('#libraryFolderNav [data-lu-nav="w"]').dblclick();
  await expect(page.locator('#documentList .ft-more-row')).toContainText('20개 더 보기');
  expect(await rows(page)).toBe(20);
  const vh=await page.evaluate(()=>innerHeight);
  const src='#documentList [data-lu-document="d00"]',from=await center(page,src);
  await startDrag(page,src);
  await holdAt(page,from.x,vh-6);
  // 화면 끝까지 구른 뒤 머물면 '더 보기'가 열리고(줄 40개) 화면이 이어 굴러 맨 아래 줄이 화면 안으로 들어온다.
  await expect.poll(()=>rows(page),{timeout:8000}).toBe(40);
  const last=()=>page.locator('#documentList [data-lu-document="d39"]').evaluate(el=>el.getBoundingClientRect().bottom);
  await expect.poll(last,{timeout:8000}).toBeLessThan(vh);
  // 위 가장자리로 올라가면 화면이 맨 위까지 굴러간다.
  const down=await pageTop(page);expect(down).toBeGreaterThan(0);
  await holdAt(page,from.x,4);
  await expect.poll(()=>pageTop(page),{timeout:8000}).toBe(0);
  // 왼쪽 나무 '가상 끝' 폴더에 놓는다(끌기는 '더 보기'로 목록이 다시 그려져도 이어진다).
  const to=await center(page,'#libraryFolderNav [data-lu-nav="z"]');
  await dropAt(page,to.x,to.y);
  await expect.poll(()=>folderOf(s,'d00')).toBe('z');
  const a=await pageTop(page);await page.waitForTimeout(300);
  expect(await pageTop(page)).toBe(a);
  expect(errors).toEqual([]);
});

test('PC 1280 한 칸: 가운데에서는 \'더 보기\'를 열지 않는다',async({page})=>{
  const {errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS,docs,group:'폴더',init:{viewPrefs:null}});
  await page.getByRole('button',{name:'한 칸'}).click();
  await page.locator('#libraryFolderNav [data-lu-nav="w"]').dblclick();
  await expect(page.locator('#documentList .ft-more-row')).toBeVisible();
  const src='#documentList [data-lu-document="d00"]',from=await center(page,src);
  await startDrag(page,src);
  await holdAt(page,from.x,from.y+60);await page.waitForTimeout(1200);
  expect(await rows(page)).toBe(20);
  await page.evaluate(()=>{clearInterval(window.__hold);document.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:__dt}))});
  expect(errors).toEqual([]);
});

test.describe('폰 390 길게 눌러 끌기',()=>{
  test.use({hasTouch:true});
  const touch=(cdp,type,pts)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pts.map((p,i)=>({x:p.x,y:p.y,id:i}))});
  test('파일을 길게 눌러 화면 아래 가장자리에 머물면 \'더 보기\'가 열려 계속 굴러가고 아래 폴더에 놓는다',async({page})=>{
    test.setTimeout(60000);
    const {s,errors}=await bootLibrary(page,390,{folders:FOLDERS,items:ITEMS,docs,group:'폴더'});
    const src='#documentList [data-lu-document="d00"]',target='#documentList details[data-lu-node="f:z"] > summary';
    await expandLibraryTree(page);
    await expect(page.locator('#documentList .ft-more-row')).toBeVisible();
    expect(await rows(page)).toBe(20);
    await page.locator(src).scrollIntoViewIfNeeded();
    const vh=await page.evaluate(()=>innerHeight);
    const cdp=await page.context().newCDPSession(page);
    const from=await center(page,src+' .lu-row-title');
    await touch(cdp,'touchStart',[from]);await page.waitForTimeout(700);
    await expect(page.locator(src)).toHaveClass(/lu-grabbed/);
    const edge={x:from.x,y:vh-6};
    for(const f of [0.25,0.5,0.75,1])await touch(cdp,'touchMove',[{x:from.x,y:from.y+(edge.y-from.y)*f}]);
    await expect.poll(()=>rows(page),{timeout:10000}).toBe(40);
    const targetTop=()=>page.locator(target).evaluate(el=>el.getBoundingClientRect().top);
    await expect.poll(targetTop,{timeout:10000}).toBeLessThan(vh-120);
    const to=await center(page,target);
    for(const f of [0.5,1])await touch(cdp,'touchMove',[{x:to.x,y:edge.y+(to.y-edge.y)*f}]);
    await expect(page.locator(target)).toHaveClass(/lu-drop-into/);
    await touch(cdp,'touchEnd',[]);
    await expect.poll(()=>folderOf(s,'d00')).toBe('z');
    expect(errors).toEqual([]);
  });
});
