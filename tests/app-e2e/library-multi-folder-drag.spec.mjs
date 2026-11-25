import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder,libDoc} from './helpers/library-folder-server.mjs';
// S70-08 LIB-여러폴더끌기(명진 11/25 09:39 "선택해서 드래그하면 다 드래그되어야하는데 하나만 드래그됨"):
// 자료실 두 칸 보기 오른쪽 칸에서 폴더 여럿을 고른 뒤(상자 끌기 + Ctrl+클릭으로 하나 빼기) 그중 한 폴더를 잡아 다른 폴더로 끌면
// 고른 것 모두가 그 안으로 옮겨진다(위로·아래로 어느 방향이든). [되돌리기]는 모두. 이름은 모두 지어낸 것, 가짜 서버만 쓴다.
const KIDS=['k1','k2','k3','k4','k5','k6'];
const pane=i=>`#documentList [data-lu-pane-i="${i}"]`;
const navIn=(i,id)=>`${pane(i)} [data-lu-nav="${id}"]`;
const rowIn=(i,id)=>`${pane(i)} .ft-row:has(> [data-lu-nav="${id}"])`;
const parentOf=(s,id)=>s.folders.find(f=>f.id===id)?.parent_id||null;
const folderOf=(s,doc)=>s.items.find(x=>x.document_id===doc)?.folder_id||null;
const count=page=>page.locator('#librarySelectCount');
const line=page=>page.locator('#libraryFolderStatusLine');
const box=(page,sel)=>page.locator(sel).first().evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,x:r.left+r.width/2,y:r.top+r.height/2}});
// dstFirst=true: 놓을 폴더가 맨 위(위로 끌기), false: 맨 아래(사진 모양 — 아래로 끌기). withDocs: 그 폴더 안 자료 두 개(폴더+파일 섞어 고르기).
function setup({dstFirst=false,withDocs=false}={}){
  const folders=[libFolder('top',null,{name:'가상 본부',sort_order:1024}),libFolder('side',null,{name:'가상 옆',sort_order:2048})];
  KIDS.forEach((id,i)=>folders.push(libFolder(id,null,{name:`가상 ${i+1}차`,parent_id:'top',sort_order:1024*(i+2)})));
  folders.push(libFolder('dst',null,{name:'가상 묶음',parent_id:'top',sort_order:dstFirst?1:1024*20}));
  const docs=[libDoc('d1',null,{title:'가상 자료 1'}),libDoc('d2',null,{title:'가상 자료 2'})];
  const items=withDocs?[{document_id:'d1',folder_id:'top'},{document_id:'d2',folder_id:'top'}]:[{document_id:'d1',folder_id:'side'},{document_id:'d2',folder_id:'side'}];
  return {folders,docs,items};
}
async function boot(page,width,opt){
  const {folders,docs,items}=setup(opt);
  const r=await bootLibrary(page,width,{folders,items,docs,group:'폴더',init:{viewPrefs:null}});
  await page.locator(navIn(1,'top')).click({button:'right'});
  await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click();
  await expect(page.locator(`${pane(1)} .lu-pane-here`)).toHaveText('가상 본부');
  for(const id of [...KIDS,'dst'])await expect(page.locator(navIn(1,id))).toBeVisible();
  return r;
}
// 오른쪽 칸 마지막 줄 아래 빈 곳에서 맨 위 줄까지 상자로 끌어 모두 고른다(선택 막대가 나타나면 줄이 내려가므로 한 번 더 잰다).
async function marqueeAll(page,firstId){
  const list=await box(page,`${pane(1)} .lu-pane-list`);
  const rows=await page.locator(`${pane(1)} .lu-pane-list .ft-row, ${pane(1)} .lu-pane-list .lu-row[data-lu-document]`).evaluateAll(xs=>xs.map(x=>x.getBoundingClientRect().bottom));
  const from={x:list.x,y:Math.min(list.bottom-8,Math.max(...rows)+30)};
  await page.mouse.move(from.x,from.y);await page.mouse.down();
  await page.mouse.move(from.x+8,from.y-8,{steps:3});
  await expect(page.locator('.marquee-box')).toBeVisible();
  let t=await box(page,rowIn(1,firstId));await page.mouse.move(from.x+20,t.top+4,{steps:8});
  await page.waitForTimeout(80);
  t=await box(page,rowIn(1,firstId));await page.mouse.move(from.x+20,t.top+3,{steps:4});
  await page.mouse.up();
  await expect(page.locator('.marquee-box')).toHaveCount(0);
}
// PC 마우스로 한 폴더 줄을 잡아 다른 폴더 줄 가운데에 놓는다(HTML 끌기).
async function dragTo(page,fromSel,toSel){
  const a=await box(page,fromSel);
  await page.mouse.move(a.x,a.y);await page.mouse.down();
  await page.mouse.move(a.x+4,a.y+6,{steps:3});
  const b=await box(page,toSel);
  await page.mouse.move(b.x,b.y,{steps:12});
  await page.mouse.move(b.x+2,b.y,{steps:2});
  await page.mouse.up();
}

for(const dir of ['아래로','위로'])test(`PC 1280 두 칸: 폴더 6개 고르기(상자+Ctrl로 하나 빼기) → ${dir} 놓을 폴더로 끌기 = 6개 모두 그 안, [되돌리기] = 모두 제자리`,async({page})=>{
  test.setTimeout(90000);
  const dstFirst=dir==='위로';
  const {s,errors}=await boot(page,1280,{dstFirst});
  await marqueeAll(page,dstFirst?'dst':'k1');
  await expect(count(page)).toHaveText('폴더 7 선택됨');
  await page.locator(navIn(1,'dst')).click({modifiers:['Control']});
  await expect(count(page)).toHaveText('폴더 6 선택됨');
  // 아래로: 놓을 폴더 바로 위 줄(6차)을 잡아 아래로. 위로: 놓을 폴더 바로 아래 줄(1차)을 잡아 위로.
  await dragTo(page,rowIn(1,dstFirst?'k1':'k6'),rowIn(1,'dst'));
  await expect.poll(()=>KIDS.map(id=>parentOf(s,id))).toEqual(KIDS.map(()=>'dst'));
  await expect(line(page)).toContainText('옮겼어요 폴더 6개 → 가상 묶음 폴더');
  // 원래 칸에 남은 줄·흐린 줄·따라오는 조각이 없다.
  for(const id of KIDS)await expect(page.locator(navIn(1,id))).toHaveCount(0);
  await expect(page.locator('#documentList .lu-dragging, #documentList .lu-grabbed')).toHaveCount(0);
  await expect(page.locator('.dg-ghost, .td-ghost')).toHaveCount(0);
  await expect(page.locator('#librarySelectBar')).toBeHidden();
  // [되돌리기] = 6개 모두 제자리.
  await line(page).getByRole('button',{name:'되돌리기'}).click();
  await expect.poll(()=>KIDS.map(id=>parentOf(s,id))).toEqual(KIDS.map(()=>'top'));
  for(const id of KIDS)await expect(page.locator(navIn(1,id))).toBeVisible();
  expect(errors).toEqual([]);
});

test('PC 1280 두 칸: 폴더+파일 섞어 고른 끌기도 모두 옮긴다',async({page})=>{
  test.setTimeout(90000);
  const {s,errors}=await boot(page,1280,{withDocs:true});
  await marqueeAll(page,'k1');
  await expect(count(page)).toHaveText('폴더 7 · 파일 2 선택됨');
  await page.locator(navIn(1,'dst')).click({modifiers:['Control']});
  await expect(count(page)).toHaveText('폴더 6 · 파일 2 선택됨');
  // 파일 줄을 잡아 끌어도 고른 폴더까지 모두.
  await dragTo(page,`${pane(1)} [data-lu-document="d1"]`,rowIn(1,'dst'));
  await expect.poll(()=>[...KIDS.map(id=>parentOf(s,id)),folderOf(s,'d1'),folderOf(s,'d2')]).toEqual([...KIDS.map(()=>'dst'),'dst','dst']);
  await expect(line(page)).toContainText('폴더 6개 · 자료 2개');
  await line(page).getByRole('button',{name:'되돌리기'}).click();
  await expect.poll(()=>[...KIDS.map(id=>parentOf(s,id)),folderOf(s,'d1'),folderOf(s,'d2')]).toEqual([...KIDS.map(()=>'top'),'top','top']);
  expect(errors).toEqual([]);
});

// 메뉴 [폴더로 옮기기] 창과 같은 규칙: 고른 폴더(와 그 아래)에는 놓을 수 없다 — '놓을 수 없음' 표시, 쓰기 없음, 고른 것 그대로.
test('PC 1280 두 칸: 놓을 폴더가 고른 것에 들어 있으면 놓을 수 없고(표시) 아무것도 옮기지 않는다',async({page})=>{
  test.setTimeout(90000);
  const {s,errors}=await boot(page,1280);
  await marqueeAll(page,'k1');
  await expect(count(page)).toHaveText('폴더 7 선택됨');
  const a=await box(page,rowIn(1,'k6'));
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(a.x+4,a.y+6,{steps:3});
  const b=await box(page,rowIn(1,'dst'));await page.mouse.move(b.x,b.y,{steps:10});
  await expect(page.locator(rowIn(1,'dst'))).toHaveClass(/lu-drop-no/);
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(s.writes.filter(w=>w.table==='folders')).toEqual([]);
  expect([...KIDS,'dst'].map(id=>parentOf(s,id))).toEqual([...KIDS,'dst'].map(()=>'top'));
  await expect(count(page)).toHaveText('폴더 7 선택됨');
  await expect(page.locator('#documentList .lu-dragging')).toHaveCount(0);
  expect(errors).toEqual([]);
});

// 폰 390(폴더 나무): 꾹 눌러 하나 고르고 나머지 폴더 줄을 눌러 더한 뒤, 고른 폴더 하나를 꾹 눌러 끌어 놓을 폴더에 놓으면 모두 옮긴다.
test.describe('폰 390 꾹 눌러 끌기',()=>{
  test.use({hasTouch:true});
  const head=id=>`#documentList details[data-lu-node="f:${id}"] > summary`;
  const center=(page,sel)=>page.locator(sel).evaluate(el=>{el.scrollIntoView({block:'center',behavior:'instant'});const r=el.getBoundingClientRect();return {x:r.left+Math.min(r.width/2,120),y:r.top+r.height/2}});
  const touch=(cdp,type,pts)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pts.map((p,i)=>({x:p.x,y:p.y,id:i}))});
  for(const dir of ['아래로','위로'])test(`폴더 6개 고른 뒤 ${dir} 꾹 눌러 끌기 = 6개 모두 그 안, [되돌리기] = 모두 제자리`,async({page})=>{
    test.setTimeout(90000);
    const dstFirst=dir==='위로',{folders,docs,items}=setup({dstFirst});
    const {s,errors}=await bootLibrary(page,390,{folders,items,docs,group:'폴더',init:{viewPrefs:null}});
    await page.locator(head('top')).tap();
    for(const id of [...KIDS,'dst'])await expect(page.locator(head(id))).toBeVisible();
    const cdp=await page.context().newCDPSession(page);
    // 꾹 눌렀다 떼기 = 고르기 시작(폴더째), 그 뒤 누르기 = 더하기.
    let p=await center(page,head('k1'));
    await touch(cdp,'touchStart',[p]);await page.waitForTimeout(700);await touch(cdp,'touchEnd',[]);
    await expect(count(page)).toHaveText('폴더 1 선택됨');
    await page.waitForTimeout(700); // 꾹 누른 뒤 따라오는 누르기는 잠깐 먹는다
    for(const id of KIDS.slice(1))await page.locator(head(id)).tap();
    await expect(count(page)).toHaveText('폴더 6 선택됨');
    const from=await center(page,head(dstFirst?'k1':'k6')),to=await center(page,head('dst'));
    await touch(cdp,'touchStart',[from]);await page.waitForTimeout(700);
    for(const f of [0.25,0.5,0.75,1])await touch(cdp,'touchMove',[{x:from.x+(to.x-from.x)*f+2,y:from.y+(to.y-from.y)*f}]);
    await expect(page.locator(head('dst'))).toHaveClass(/lu-drop-into/);
    await expect(page.locator('.td-ghost')).toContainText('폴더 6개');
    await touch(cdp,'touchEnd',[]);
    await expect.poll(()=>KIDS.map(id=>parentOf(s,id))).toEqual(KIDS.map(()=>'dst'));
    await expect(line(page)).toContainText('옮겼어요 폴더 6개 → 가상 묶음 폴더');
    await expect(page.locator('#documentList .lu-dragging, #documentList .lu-grabbed')).toHaveCount(0);
    await expect(page.locator('.dg-ghost, .td-ghost')).toHaveCount(0);
    await expect(page.locator('#librarySelectBar')).toBeHidden();
    await page.waitForTimeout(700);
    await line(page).getByRole('button',{name:'되돌리기'}).tap();
    await expect.poll(()=>KIDS.map(id=>parentOf(s,id))).toEqual(KIDS.map(()=>'top'));
    expect(errors).toEqual([]);
  });
});
