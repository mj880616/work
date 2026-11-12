import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {bootLibrary,libFolder,libDoc} from './helpers/library-folder-server.mjs';
import {start,openFiles,treeGo} from './helpers/files-server.mjs';
// S60-13 UI-펼친폴더안놓기전체(명진 11/12 09:23, ★급★): "a폴더(파일·파일·파일 a) b폴더(파일 *·파일·파일)에서 * 파일을 끌어서 '파일 a' 쪽에만 가져가도
// 드롭이 가능하게. 비슷한 인터페이스는 모두". 공용 규칙(app/drop-open-folder.mjs): 펼친 폴더 묶음 안 아무 자리(자료 줄·[사진 n]·줄 사이) = 그 폴더.
// 표시: 놓일 묶음 전체 옅은 바탕 + 그 폴더 줄 '여기에 놓기'. 명진 예 그대로(실제 마우스 끌기). 이름은 모두 지어낸 것.
// 화면 사진: S60_13_SHOTS=docs/design/screens/s60-13 일 때만 저장.
const SHOTS=process.env.S60_13_SHOTS||'';
const shot=async(page,name)=>{if(SHOTS){mkdirSync(SHOTS,{recursive:true});await page.screenshot({path:`${SHOTS}/${name}.png`})}};
const FOLDERS=[libFolder('fa',null,{name:'가상 A',sort_order:1024}),libFolder('fb',null,{name:'가상 B',sort_order:2048})];
const DOCS=[libDoc('a1',null),libDoc('a2',null),libDoc('a3',null,{title:'파일 a'}),libDoc('ap',null,{file_id:'f-ap',file_name:'ap.jpg',mime_type:'image/jpeg'}),
  libDoc('b1',null,{title:'파일 *'}),libDoc('b2',null),libDoc('b3',null),libDoc('o1',null)];
const ITEMS=[...['a1','a2','a3','ap'].map(d=>({document_id:d,folder_id:'fa'})),...['b1','b2','b3'].map(d=>({document_id:d,folder_id:'fb'}))];
const folderOf=(s,doc)=>s.items.find(x=>x.document_id===doc)?.folder_id||null;
const line=page=>page.locator('#libraryFolderStatusLine');
// 끄는 도중(놓기 전) 표시를 읽고 사진을 찍은 뒤 놓는다(실제 마우스).
async function dragHold(page,from,to,{read=async()=>null,name=''}={}){
  await from.hover();await page.mouse.down();
  const b=await to.boundingBox();await page.mouse.move(b.x+Math.min(60,b.width/2),b.y+b.height/2,{steps:8});await page.mouse.move(b.x+Math.min(70,b.width/2),b.y+b.height/2,{steps:2});
  const seen=await read();if(name)await shot(page,name);
  await page.mouse.up();return seen;
}

for(const two of [false,true])test(`자료실 PC 1280 ${two?'두 칸':'한 칸'}: 명진 예 — b폴더 '파일 *'를 a폴더 '파일 a' 줄 위에 놓으면 a폴더 · 묶음 표시 · 되돌리기 · [사진 n] 위도 그 폴더`,async({page})=>{
  test.setTimeout(90000);
  const {s,errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS,docs:DOCS,group:'폴더',init:{viewPrefs:two?null:{library_two:false}}});
  const root=two?'#documentList [data-lu-pane-i="0"]':'#documentList';
  if(two){for(const k of ['fa','fb'])await page.locator(`${root} [data-lu-nav="${k}"]`).click()}
  else for(const k of ['fa','fb']){const n=page.locator(`#documentList details[data-lu-node="f:${k}"]`);if(!(await n.evaluate(e=>e.open)))await n.locator(':scope > summary').click()}
  const doc=id=>page.locator(`${root} [data-lu-document="${id}"]`).first();
  await expect(doc('a3')).toBeVisible();await expect(doc('b1')).toBeVisible();
  const seen=await dragHold(page,doc('b1'),doc('a3'),{name:two?'pc-1280-library-two-drag':'pc-1280-library-one-drag',read:()=>page.evaluate(({two})=>{
    const head=two?document.querySelector('#documentList [data-lu-pane-i="0"] [data-lu-nav="fa"]').closest('.ft-row'):document.querySelector('#documentList details[data-lu-node="f:fa"] > summary');
    const row=document.querySelector(`${two?'#documentList [data-lu-pane-i="0"] ':'#documentList '}[data-lu-document="a3"]`);
    return {head:head.className,group:!!row.closest('.lu-drop-group'),label:getComputedStyle(head.matches('summary')?head:head.querySelector('.ft-main'),'::after').content};
  },{two})});
  expect(seen.head).toMatch(/lu-drop-into/);expect(seen.group).toBe(true);expect(seen.label).toContain('여기에 놓기');
  await expect.poll(()=>folderOf(s,'b1')).toBe('fa');
  await expect(line(page)).toContainText('옮겼어요 1개 → 가상 A 폴더');await expect(line(page).locator('.lu-undo')).toHaveText('되돌리기');
  await expect(page.locator('#documentList .lu-drop-group,#documentList .lu-drop-into')).toHaveCount(0);
  await line(page).locator('.lu-undo').click();await expect.poll(()=>folderOf(s,'b1')).toBe('fb');
  // #2448 뒤 묶음 끝 [사진 n] 위에 놓아도 그 폴더(한 칸 목록은 전에 아무 일도 없었다).
  await expect(doc('b2')).toBeVisible();
  await doc('b2').dragTo(page.locator(`${root} .lu-photo-fold`).first());
  await expect.poll(()=>folderOf(s,'b2')).toBe('fa');
  expect(errors).toEqual([]);
});

test('자료실 PC 1280 두 칸: 아래 여백 — 두 칸 높이 같음, 마지막 줄 아래 빈 자리(약 60px)에 놓으면 그 칸의 지금 폴더',async({page})=>{
  test.setTimeout(60000);
  const {s,errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS,docs:DOCS,group:'폴더',init:{viewPrefs:null}});
  const pane=i=>page.locator(`#documentList [data-lu-pane-i="${i}"]`);
  await page.locator('#documentList [data-lu-pane-i="1"] [data-lu-nav="fa"]').click({button:'right'});
  await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click();
  await expect(pane(1).locator('.lu-pane-here')).toHaveText('가상 A');
  const [h0,h1]=[await pane(0).boundingBox(),await pane(1).boundingBox()];expect(Math.abs(h0.height-h1.height)).toBeLessThan(1);
  const gap=await pane(1).locator('.lu-pane-list').evaluate(l=>{const last=[...l.children].pop().getBoundingClientRect();return l.getBoundingClientRect().bottom-last.bottom});
  expect(gap).toBeGreaterThanOrEqual(56);
  await shot(page,'pc-1280-library-two-bottom');
  // 오른쪽 칸(가상 A) 아래 빈 자리에 왼쪽 맨 위 자료(폴더 밖 o1)를 놓으면 가상 A.
  const list=pane(1).locator('.lu-pane-list'),b=await list.boundingBox();
  await page.locator('#documentList [data-lu-pane-i="0"] [data-lu-document="o1"]').dragTo(list,{targetPosition:{x:b.width/2,y:b.height-20}});
  await expect.poll(()=>folderOf(s,'o1')).toBe('fa');
  expect(errors).toEqual([]);
});

// [파일] 목록: a폴더 = 가짜 문서함(안내문·예산표·메모), b폴더 = 가짜 사진함(명단 *, 사진 1장, 하위 폴더).
for(const width of [1280,884])test(`파일 ${width} 목록: 명진 예 — 사진함 '명단'을 문서함 '메모' 줄 위에 놓으면 문서함 · 묶음 표시 · [사진 n] 위도 그 폴더`,async({page})=>{
  test.setTimeout(90000);
  const {errors,server}=await start(page,width);
  server.items.push({source:'od',item_id:'OD!21',parent_id:'OD!2',name:'가짜 행사',is_folder:true,size_bytes:null,mime:null,modified_at:'2026-10-01T01:00:00Z',hash:null,trashed:false,starred:false,library_doc_id:null},
    {source:'od',item_id:'OD!22',parent_id:'OD!2',name:'가짜 명단.pdf',is_folder:false,size_bytes:2000,mime:'application/pdf',modified_at:'2026-10-02T01:00:00Z',hash:null,trashed:false,starred:false,library_doc_id:null});
  await openFiles(page,width);await treeGo(page,'od');
  const list=page.locator('#filesRoot [data-fx-pane-i="0"] [data-fx-list]'),row=key=>list.locator(`[data-fx-row="${key}"]`);
  for(const k of ['od:OD!1','od:OD!2']){await row(k).click();await expect(row(k)).toHaveAttribute('aria-expanded','true')}
  await expect(row('od:OD!13')).toBeVisible();await expect(row('od:OD!22')).toBeVisible();
  const seen=await dragHold(page,row('od:OD!22'),row('od:OD!13'),{name:`files-${width}-drag`,read:()=>page.evaluate(()=>{
    const l=document.querySelector('#filesRoot [data-fx-pane-i="0"] [data-fx-list]');
    return {head:l.querySelector('[data-fx-row="od:OD!1"]').className,memo:l.querySelector('[data-fx-row="od:OD!13"]').className,label:getComputedStyle(l.querySelector('[data-fx-row="od:OD!1"]'),'::after').content};
  })});
  expect(seen.head).toMatch(/fx-drop-on/);expect(seen.head).toMatch(/fx-drop-head/);expect(seen.memo).toMatch(/fx-drop-group/);expect(seen.label).toContain('여기에 놓기');
  await expect.poll(()=>server.items.find(i=>i.item_id==='OD!22').parent_id).toBe('OD!1');
  await expect(page.locator('#filesRoot .fx-drop-on,#filesRoot .fx-drop-group')).toHaveCount(0);
  // 사진함 묶음 끝 [사진 1] 위에 문서함 '안내문'을 놓으면 사진함.
  const fold=list.locator('[data-fx-photos="od:OD!2"]');await expect(fold).toBeVisible();
  await row('od:OD!11').dragTo(fold);
  await expect.poll(()=>server.items.find(i=>i.item_id==='OD!11').parent_id).toBe('OD!2');
  expect(errors).toEqual([]);
});

// 폰 412 손가락: 길게 눌러 끌기(같은 판정·같은 표시).
test.describe('폰 412 손가락',()=>{
  test.use({hasTouch:true});
  const center=(page,sel)=>page.locator(sel).first().evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.left+Math.min(r.width/2,120),y:r.top+r.height/2}});
  const touch=(cdp,type,pts)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pts.map((p,i)=>({x:p.x,y:p.y,id:i}))});
  test('자료실 폰 412: b폴더 \'파일 *\'를 길게 눌러 a폴더 \'파일 a\' 줄 위에 놓으면 a폴더 · 묶음 표시',async({page})=>{
    test.setTimeout(60000);
    const {s,errors}=await bootLibrary(page,412,{folders:FOLDERS,items:ITEMS,docs:DOCS,group:'폴더',init:{viewPrefs:null}});
    for(const k of ['fa','fb']){const n=page.locator(`#documentList details[data-lu-node="f:${k}"]`);if(!(await n.evaluate(e=>e.open)))await n.locator(':scope > summary').click()}
    await expect(page.locator('#documentList [data-lu-document="b1"]')).toBeVisible();
    await page.locator('#documentList [data-lu-document="b1"]').scrollIntoViewIfNeeded();
    const cdp=await page.context().newCDPSession(page);
    const from=await center(page,'#documentList [data-lu-document="b1"] .lu-row-title');
    await touch(cdp,'touchStart',[from]);await page.waitForTimeout(700);
    await expect(page.locator('#documentList [data-lu-document="b1"]')).toHaveClass(/lu-grabbed/);
    const to=await center(page,'#documentList [data-lu-document="a3"]');
    for(const f of [0.25,0.5,0.75,1])await touch(cdp,'touchMove',[{x:from.x+(to.x-from.x)*f,y:from.y+(to.y-from.y)*f}]);
    await expect(page.locator('#documentList details[data-lu-node="f:fa"] > summary')).toHaveClass(/lu-drop-into/);
    await expect(page.locator('#documentList details[data-lu-node="f:fa"]')).toHaveClass(/lu-drop-group/);
    await shot(page,'phone-412-library-drag');
    await touch(cdp,'touchEnd',[]);
    await expect.poll(()=>folderOf(s,'b1')).toBe('fa');
    await expect(line(page)).toContainText('가상 A 폴더');
    expect(errors).toEqual([]);
  });
});
