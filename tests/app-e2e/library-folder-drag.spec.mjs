import {test,expect} from '@playwright/test';
import {expandLibraryTree,libraryNodeHead} from './helpers/library-tree.mjs';
import {bootLibrary,libFolder,libDoc,childrenOf} from './helpers/library-folder-server.mjs';
// LIB-폴더탐색기 화면 ②(docs/design/library-tree.md 12절): 끌어 옮기기(폴더 보기는 프로젝트 틀과 무관), 놓을 곳 점선 표시,
// '옮겼어요 · 되돌리기', 여러 자료 한꺼번에 끌기, 화면 가장자리 자동 스크롤, 폰 길게 누르기(잡아 옮기기·떼면 메뉴·세로 스크롤과 구분).
const FOLDERS=[libFolder('fa','top-a',{name:'가상 A',sort_order:1024}),libFolder('fc','child-a1',{name:'가상 C',parent_id:'fa',sort_order:0}),libFolder('fn',null,{name:'가상 N',sort_order:2048})];
const ITEMS=[{document_id:'a-1',folder_id:'fc'},{document_id:'n-1',folder_id:'fa'}];
const head=key=>`#documentList details[data-lu-node="${key}"] > summary`;
const row=id=>`[data-lu-document="${id}"]`;
const line=page=>page.locator('#libraryFolderStatusLine');
async function dragTo(page,from,to,{edge='middle'}={}){
  await page.evaluate(({from,to,edge})=>{
    const src=document.querySelector(from),dst=document.querySelector(to),dt=new DataTransfer(),r=dst.getBoundingClientRect();
    const y=edge==='top'?r.top+2:edge==='bottom'?r.bottom-2:r.top+r.height/2,x=r.left+r.width/2;
    src.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt}));
    const over=new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:x,clientY:y});dst.dispatchEvent(over);
    window.__luDropAllowed=over.defaultPrevented;window.__luDropClass=dst.className;
    dst.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:x,clientY:y}));
    src.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));
  },{from,to,edge});
  return page.evaluate(()=>({allowed:window.__luDropAllowed,cls:window.__luDropClass}));
}

test.describe('PC 1280 폴더 보기 끌어 옮기기',()=>{
  test('자료를 다른 프로젝트 폴더로·폴더 밖으로, 놓을 곳 표시, 되돌리기, 자료의 프로젝트는 그대로',async({page})=>{
    const {s,errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS,group:'폴더'});
    await expandLibraryTree(page);
    await expect(page.locator(row('a-2'))).toHaveAttribute('draggable','true');await expect(page.locator(head('f:fa'))).toHaveAttribute('draggable','true');
    // a1-1(프로젝트 child-a1)을 폴더 A(top-a 틀)로: 틀이 달라도 놓을 수 있다. 놓을 곳에는 점선 표시가 붙는다.
    let r=await dragTo(page,row('a1-1'),head('f:fa'));expect(r.allowed).toBe(true);expect(r.cls).toContain('lu-drop-into');
    await expect.poll(()=>s.items.find(x=>x.document_id==='a1-1')?.folder_id).toBe('fa');
    await expect(line(page)).toContainText('옮겼어요');await expect(line(page).locator('.lu-undo')).toHaveText('되돌리기');
    expect(s.docs.find(d=>d.id==='a1-1').project_id).toBe('child-a1');
    await line(page).locator('.lu-undo').click();await expect(line(page)).toContainText('되돌렸어요');// 서버 쪽 반영만이 아니라 화면의 되돌리기 끝(다시 불러오기까지)을 기다린다. 끝나기 전 다음 끌기는 처리 중이라 무시된다.
    await expect.poll(()=>s.items.some(x=>x.document_id==='a1-1')).toBe(false);
    // 이미 들어 있는 폴더에는 놓을 수 없다. 폴더 안 자료를 '폴더 밖' 머리에 놓으면 폴더에서 나온다.
    await expandLibraryTree(page);
    r=await dragTo(page,row('n-1'),head('f:fa'));expect(r.allowed).toBe(false);expect(r.cls).toContain('lu-drop-no');
    r=await dragTo(page,row('n-1'),head('x:out'));expect(r.allowed).toBe(true);
    await expect.poll(()=>s.items.some(x=>x.document_id==='n-1')).toBe(false);
    await expect(line(page)).toContainText('옮겼어요');
    // 폴더 밖 자료는 '폴더 밖' 머리에 놓을 수 없다.
    await expandLibraryTree(page);
    r=await dragTo(page,row('a-2'),head('x:out'));expect(r.allowed).toBe(false);
    expect(errors).toEqual([]);
  });

  test('폴더를 다른 폴더 안으로·맨 위로 옮기고 되돌리기, 3단·자기 아래는 놓을 수 없음, 같은 상위 안 순서 바꾸기',async({page})=>{
    const {s,errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS,group:'폴더'});
    await expandLibraryTree(page);
    // 가상 N(프로젝트 없음)을 가상 A 안으로: 틀이 달라도 된다.
    let r=await dragTo(page,head('f:fn'),head('f:fa'));expect(r.allowed).toBe(true);expect(r.cls).toContain('lu-drop-into');
    await expect.poll(()=>s.folders.find(f=>f.id==='fn').parent_id).toBe('fa');
    await expect(line(page)).toContainText('폴더를 옮겼어요');
    await line(page).locator('.lu-undo').click();await expect(line(page)).toContainText('되돌렸어요');// 서버 쪽 반영만이 아니라 화면의 되돌리기 끝(다시 불러오기까지)을 기다린다. 끝나기 전 다음 끌기는 처리 중이라 무시된다.
    await expect.poll(()=>s.folders.find(f=>f.id==='fn').parent_id).toBeNull();
    await expandLibraryTree(page);
    // 자기 아래(가상 C는 가상 A 안)로 A를 넣을 수는 없다.
    const n=s.writes.length;r=await dragTo(page,head('f:fa'),head('f:fc'));expect(r.allowed).toBe(false);expect(r.cls).toContain('lu-drop-no');expect(s.writes.length).toBe(n);
    // 안에 있는 가상 C를 맨 위('폴더 밖' 머리)로.
    r=await dragTo(page,head('f:fc'),head('x:out'));expect(r.allowed).toBe(true);
    await expect.poll(()=>s.folders.find(f=>f.id==='fc').parent_id).toBeNull();
    // 같은 상위(맨 위) 안에서 N을 A 앞(위 끝)으로.
    await expandLibraryTree(page);
    r=await dragTo(page,head('f:fn'),head('f:fa'),{edge:'top'});expect(r.allowed).toBe(true);expect(r.cls).toContain('lu-drop-before');
    await expect.poll(()=>s.folders.filter(f=>!f.parent_id).sort((a,b)=>a.sort_order-b.sort_order)[0].id).toBe('fn');
    await expect(line(page)).toContainText('순서를 바꿨어요');
    expect(errors).toEqual([]);
  });

  test('고른 자료 여러 개를 한꺼번에 끌어 폴더로 옮기고 한 번에 되돌린다',async({page})=>{
    const {s,errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS,group:'폴더'});
    await expandLibraryTree(page);
    await page.locator('#librarySelectBtn').click();
    await page.locator('[data-lu-pick="a-2"]').check();await page.locator('[data-lu-pick="a1-1"]').check();
    const r=await dragTo(page,row('a-2'),head('f:fn'));expect(r.allowed).toBe(true);
    await expect.poll(()=>s.items.filter(x=>x.folder_id==='fn').map(x=>x.document_id).sort()).toEqual(['a-2','a1-1']);
    await expect(line(page)).toContainText('2개를 옮겼어요');
    await line(page).locator('.lu-undo').click();await expect(line(page)).toContainText('되돌렸어요');// 서버 쪽 반영만이 아니라 화면의 되돌리기 끝(다시 불러오기까지)을 기다린다. 끝나기 전 다음 끌기는 처리 중이라 무시된다.
    await expect.poll(()=>s.items.filter(x=>x.folder_id==='fn').length).toBe(0);
    expect(errors).toEqual([]);
  });

  test('안에서 시작한 끌기만 본다: 바깥 파일을 끌어 올 때(Files)는 폴더 표시가 생기지 않는다',async({page})=>{
    const {errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS,group:'폴더'});
    await expandLibraryTree(page);
    const marked=await page.evaluate(sel=>{const dst=document.querySelector(sel),dt=new DataTransfer();dt.items.add(new File(['x'],'x.pdf'));const r=dst.getBoundingClientRect();
      dst.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:r.left+5,clientY:r.top+r.height/2}));return dst.className},head('f:fa'));
    expect(marked).not.toMatch(/lu-drop-/);
    expect(errors).toEqual([]);
  });

  test('화면 가장자리 가까이 끌면 목록이 저절로 움직인다',async({page})=>{
    const docs=Array.from({length:60},(_,i)=>libDoc('m-'+i,null));
    const {errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:[],docs,group:'폴더'});
    await expandLibraryTree(page);
    await page.setViewportSize({width:1280,height:420});
    const top=()=>page.locator(row('m-0')).evaluate(el=>el.getBoundingClientRect().top);
    const before=await top();
    await page.evaluate(sel=>{const src=document.querySelector(sel),dt=new DataTransfer();src.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt}));
      window.__luOver=setInterval(()=>document.querySelector('#documentList').dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:300,clientY:innerHeight-8})),30)},row('m-0'));
    await expect.poll(top,{timeout:5000}).toBeLessThan(before-60);
    await page.evaluate(()=>{clearInterval(window.__luOver);document.querySelector('#documentList').dispatchEvent(new DragEvent('dragend',{bubbles:true}))});
    expect(errors).toEqual([]);
  });
});

test.describe('폰 390 길게 누르기',()=>{
  test.use({hasTouch:true});
  const center=async(page,sel)=>page.locator(sel).evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}});
  // 줄 위에 '최근 올린 파일' 칸이 생겨 목록이 화면 밖으로 밀릴 수 있으므로, 길게 누르기 전에 그 줄을 화면 안으로 가져온다.
  const centerView=async(page,sel)=>{await page.locator(sel).scrollIntoViewIfNeeded();return center(page,sel)};
  const touch=async(cdp,type,pts)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pts.map((p,i)=>({x:p.x,y:p.y,id:i}))});
  test('누른 채 움직이면 놓은 폴더로 옮기고, 움직이지 않고 떼면 같은 메뉴가 열리고, 짧게 움직이면 스크롤로 본다',async({page})=>{
    const {s,errors}=await bootLibrary(page,390,{folders:FOLDERS,items:ITEMS,group:'폴더'});
    await expandLibraryTree(page);
    const cdp=await page.context().newCDPSession(page);
    // 1) 자료 줄을 길게 누르고 폴더 A 머리까지 끌어 놓기.
    await page.locator(row('a-2')).scrollIntoViewIfNeeded();
    let from=await center(page,row('a-2'));
    await touch(cdp,'touchStart',[from]);await page.waitForTimeout(700);
    await expect(page.locator(row('a-2'))).toHaveClass(/lu-grabbed/);
    const to=await center(page,head('f:fa'));
    for(const f of [0.25,0.5,0.75,1])await touch(cdp,'touchMove',[{x:from.x+(to.x-from.x)*f,y:from.y+(to.y-from.y)*f}]);
    await expect(page.locator(head('f:fa'))).toHaveClass(/lu-drop-into/);
    await touch(cdp,'touchEnd',[]);
    await expect.poll(()=>s.items.find(x=>x.document_id==='a-2')?.folder_id).toBe('fa');
    await expect(line(page)).toContainText('옮겼어요');
    // 2) 폴더 머리를 길게 눌렀다가 그대로 떼면 폴더 메뉴.
    await expandLibraryTree(page);
    from=await centerView(page,head('f:fn')+' .lu-node-name');
    await touch(cdp,'touchStart',[from]);await page.waitForTimeout(700);await touch(cdp,'touchEnd',[]);
    await expect(page.locator('#luFolderMenu')).toBeVisible();await expect(page.locator('#luFolderMenu').getByRole('button',{name:'폴더 지우기',exact:true})).toBeVisible();
    await page.keyboard.press('Escape');
    // 3) 자료 줄을 길게 눌렀다가 그대로 떼면 자료 ⋯ 메뉴(자료는 열리지 않는다).
    await expandLibraryTree(page);
    from=await centerView(page,row('a1-1')+' .lu-row-title');
    await touch(cdp,'touchStart',[from]);await page.waitForTimeout(700);await touch(cdp,'touchEnd',[]);
    await expect(page.locator('#luMorePanel')).toBeVisible();
    await expect(page.locator('#documentModal')).toBeHidden();
    await page.keyboard.press('Escape');
    // 4) 누르자마자 세로로 움직이면(스크롤) 잡히지 않는다.
    from=await centerView(page,row('a1-1')+' .lu-row-title');
    await touch(cdp,'touchStart',[from]);await touch(cdp,'touchMove',[{x:from.x,y:from.y-40}]);await page.waitForTimeout(700);
    await expect(page.locator('#documentList .lu-grabbed')).toHaveCount(0);
    await touch(cdp,'touchEnd',[]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
});
