import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder,libDoc} from './helpers/library-folder-server.mjs';
import {start,openFiles} from './helpers/files-server.mjs';
// LIB-최근폴더로가기(S61-12, 요청함 V28 11/13 04:40 명진 ㅇ): 자료실 '최근 올린 파일' 줄 우클릭(폰은 꾹 누르기) 메뉴 맨 위 [폴더로 가기]
// → 그 파일이 든 폴더 안(그 폴더만)으로 들어가 그 줄을 잠깐 강조, 뒤로 = 앞 화면. 폴더 밖 파일은 '폴더 밖'으로. 줄 그냥 누르기는 그대로(나무에서 그 자리).
// 요청함 방 추천(커맨드센터 채택): 검색 결과·'자료실 전체' 자료 줄 메뉴에도 같은 항목, 이미 그 폴더 안이면 없음. 이름은 모두 지어낸 것.
const shotDir=process.env.S61_12_SHOTS||'';
const shot=(page,name)=>page.screenshot({path:shotDir?`${shotDir}/${name}.png`:test.info().outputPath(name+'.png')});
const FOLDERS=[libFolder('fa',null,{name:'가상 협약',sort_order:1024}),libFolder('fc',null,{name:'가상 임금',parent_id:'fa',sort_order:0}),libFolder('fn',null,{name:'가상 성명',sort_order:2048})];
const at=m=>new Date(Date.now()-m*60000).toISOString();
const DOCS=[
  libDoc('agree',null,{title:'가상 합의서',file_name:'agree.pdf',created_at:at(1)}),
  libDoc('press',null,{title:'가상 보도자료',file_name:'press.hwp',created_at:at(2)}),
  libDoc('loose',null,{title:'가상 메모',file_name:'loose.pdf',created_at:at(3)}),
  libDoc('pic',null,{title:'가상 현장',file_name:'pic.jpg',file_id:'drive-pic',created_at:at(4)}),
  ...Array.from({length:6},(_,i)=>libDoc('old-'+i,null,{title:'가상 지난 '+i,file_name:`old${i}.pdf`,created_at:'2026-09-01T00:00:00Z'}))
];
const ITEMS=[{document_id:'agree',folder_id:'fc'},{document_id:'pic',folder_id:'fc'},{document_id:'press',folder_id:'fn'},...Array.from({length:6},(_,i)=>({document_id:'old-'+i,folder_id:'fc'}))];
const recentRow=id=>`#libraryRecent [data-lu-recent="${id}"]`;
const panel=page=>page.locator('#luMorePanel');
// 우클릭(PC)·꾹 누르기(폰 = 브라우저 contextmenu)는 같은 길.
async function rowMenu(page,sel,width){
  const el=page.locator(sel);await el.scrollIntoViewIfNeeded();
  if(width>=761)await el.click({button:'right'});
  else await el.evaluate(x=>{const r=x.getBoundingClientRect();x.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+20,clientY:r.top+r.height/2}))});
  await expect(panel(page)).toBeVisible();
}
const tops=page=>page.locator('#documentList > details').evaluateAll(xs=>xs.map(x=>x.dataset.luNode));
const P1='#documentList [data-lu-pane-i="1"] ';
const CASES=[{width:412,two:false,name:'폰 412'},{width:1280,two:false,name:'PC 1280 한 칸(나무 | 목록)'},{width:1280,two:true,name:'PC 1280 두 칸'}];
for(const {width,two,name} of CASES)test(`자료실 ${name}: 최근 줄 메뉴 맨 위 [폴더로 가기] → 그 폴더 안, 그 줄 강조, 뒤로 = 앞 화면`,async({page})=>{
  test.setTimeout(90000);
  const {errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,docs:DOCS,group:'폴더',init:two?{viewPrefs:null}:{}});
  if(two)await expect(page.locator('#documentList [data-lu-two]')).toBeVisible();
  else await expect(page.locator('#documentList [data-lu-two]')).toHaveCount(0);
  const scope=two?P1:'#documentList ';
  const shown=id=>page.locator(`${scope}.lu-row[data-lu-document="${id}"]`);
  // 지금 보이는 곳: 한 칸 = 맨 위 묶음 열쇠들, 두 칸 = 오른쪽 칸 위치 이름.
  const here=()=>two?page.locator(`${P1}.lu-pane-here`).textContent():tops(page).then(x=>x.join(','));
  await expect(page.locator(recentRow('agree'))).toBeVisible();
  const before=await here();
  // 1. 최근 줄 우클릭(폰 꾹 누르기) → 맨 위 [폴더로 가기].
  await rowMenu(page,recentRow('agree'),width);
  await expect(panel(page).locator('button').first()).toHaveText('폴더로 가기');
  await shot(page,`library-recent-menu-${width}${two?'-two':''}`);
  await panel(page).locator('button').first().click();
  // 그 폴더(가상 임금)만 보이는 화면, 그 줄 강조.
  await expect.poll(here).toBe(two?'가상 임금':'f:fc');
  const row=shown('agree');
  await expect(row).toBeVisible();await expect(row).toHaveClass(/lu-flash/);
  await shot(page,`library-goto-${width}${two?'-two':''}`);
  await expect(row).not.toHaveClass(/lu-flash/,{timeout:4000});
  // 그 폴더 안 줄 메뉴에는 [폴더로 가기]가 없다(이미 그 폴더 안).
  await row.locator('[data-lu-menu]').click();await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole('button',{name:'폴더로 가기'})).toHaveCount(0);
  await page.keyboard.press('Escape');await expect(panel(page)).toBeHidden();
  // ‹ 뒤로 = 앞 화면.
  await page.goBack();
  await expect.poll(here).toBe(before);
  await expect(page.locator(recentRow('agree'))).toBeVisible();
  // 2. 폴더 밖 파일 → '폴더 밖'(두 칸은 맨 위 = 폴더 밖 자료가 보이는 곳).
  await rowMenu(page,recentRow('loose'),width);
  await panel(page).getByRole('button',{name:'폴더로 가기'}).click();
  await expect.poll(here).toBe(two?'자료실':'x:out');
  await expect(shown('loose')).toHaveClass(/lu-flash/);
  if(!two)await page.goBack();
  // 3. 최근 사진(작은 그림 칸 ⋯)도 → 그 폴더의 [사진 n]이 펼쳐지고 그 칸 강조.
  await page.locator('#libraryRecent [data-lu-recent-photos]').click();
  await page.locator('#libraryRecent [data-photo-tile="pic"] [data-lu-menu]').click();
  await panel(page).getByRole('button',{name:'폴더로 가기'}).click();
  await expect.poll(here).toBe(two?'가상 임금':'f:fc');
  await expect(page.locator(`${scope}[data-photo-tile="pic"]`)).toHaveClass(/lu-flash/);
  await page.goBack();await expect.poll(here).toBe(before);
  // 4. 줄 그냥 누르기는 지금 그대로(나무에서 그 자리, 폴더 안으로 들어가지 않음).
  if(!two){await page.locator(recentRow('press')).click();await expect.poll(here).toBe(before);await expect(page.locator('#documentList .lu-row[data-lu-document="press"]')).toHaveClass(/lu-flash/)}
  // 5. 검색 결과 줄 ⋯에도 [폴더로 가기].
  if(width<761)await page.locator('#librarySearchOpen').click();
  await page.locator('#documentSearch').fill('보도자료');
  const hit=page.locator(`${two?'#documentList [data-lu-pane-i="0"] ':'#documentList '}.lu-row[data-lu-document="press"]`).first();
  // 두 칸: 찾는 중에는 맞는 자료가 든 폴더가 칸 안에서 펼쳐져 있다(왼쪽 칸 = 자료실 맨 위).
  await expect(hit).toBeVisible();
  await hit.locator('[data-lu-menu]').click();
  await expect(panel(page).locator('button').first()).toHaveText('폴더로 가기');
  await panel(page).locator('button').first().click();
  await expect.poll(here).toBe(two?'가상 성명':'f:fn');
  await expect(shown('press')).toHaveClass(/lu-flash/);
  await shot(page,`library-search-goto-${width}${two?'-two':''}`);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=1)).toBe(true);
  expect(errors).toEqual([]);
});

// [파일] '최근' 상자(폰 한 칸 나무에만 있음, files.js solo): 같은 [폴더로 가기] → '그 폴더만', 뒤로 = 나무. 이름은 지어낸 것(files-server 기본 가짜 파일).
for(const width of [412])test(`파일 ${width}: '최근' 줄 ⋯ 맨 위 [폴더로 가기] → 그 폴더, 그 줄 강조`,async({page})=>{
  test.setTimeout(90000);
  const {errors,server}=await start(page,width);
  await openFiles(page,width);
  const box=page.locator('#filesRoot [data-fx-tree] [data-fx-box="recent"]');
  await expect(box.locator('[data-fx-tfile]').first()).toBeVisible();
  const key=await box.locator('[data-fx-tfile]').first().getAttribute('data-fx-tfile');
  const item=server.items.find(i=>'od:'+i.item_id===key||'gd:'+i.item_id===key);
  const parent=server.items.find(i=>i.item_id===item.parent_id);
  await box.locator(`[data-fx-tmenu="${key}"]`).click();
  const menu=page.locator('#rowMenu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('button').first()).toHaveText('폴더로 가기');
  await shot(page,`files-recent-menu-${width}`);
  await menu.locator('button').first().click();
  const row=page.locator(`#filesRoot [data-fx-pane-i="0"] [data-fx-row="${key}"]`);
  await expect(row).toBeVisible();await expect(row).toHaveClass(/fx-flash/);
  if(parent)await expect(page.locator('#filesRoot [data-fx-pane-i="0"]')).toContainText(parent.name);
  await shot(page,`files-goto-${width}`);
  // 뒤로 = 앞 화면('최근' 상자가 있는 나무).
  await page.goBack();
  await expect(box.locator(`[data-fx-tfile="${key}"]`)).toBeVisible();
  // 꾹 누르기(브라우저 contextmenu)도 같은 메뉴.
  await box.locator(`[data-fx-tfile="${key}"]`).evaluate(x=>{const r=x.getBoundingClientRect();x.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+20,clientY:r.top+r.height/2}))});
  await expect(menu).toBeVisible();await expect(menu.locator('button').first()).toHaveText('폴더로 가기');
  expect(errors).toEqual([]);
});

// 노트 '최근'(폰 첫 화면 '최근' 상자, PC 처음 '최근' 목록): 같은 [폴더로 가기] → 그 폴더(없으면 '폴더 없음'), 그 줄 강조, 뒤로 = 앞 화면.
for(const width of [412,1280])test(`노트 ${width}: '최근' 줄 메뉴 맨 위 [폴더로 가기] → 그 폴더, 그 줄 강조`,async({page})=>{
  test.setTimeout(90000);
  const {openHome}=await import('./helpers/home-entry.mjs');
  const {chooseBasketKind}=await import('./helpers/basket-kind.mjs');
  const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
  await page.setViewportSize({width,height:900});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await openHome(page);
  const F1='00000000-0000-4000-8000-000000000001',F2='00000000-0000-4000-8000-000000000002';
  const folders=[{id:F1,workspace_id:'w',parent_id:null,name:'가상 회의',sort_order:1024,created_at:'2026-10-01T00:00:00Z'},{id:F2,workspace_id:'w',parent_id:null,name:'가상 성명',sort_order:2048,created_at:'2026-10-01T00:00:00Z'}];
  const rows=Array.from({length:6},(_,i)=>({id:'n'+i,workspace_id:'w',kind:'note',title:`가상 노트 ${i}`,raw_text:'본문',occurred_at:`2026-10-0${i+1}T01:00:00Z`,created_at:`2026-10-0${i+1}T01:00:00Z`,updated_at:`2026-10-0${i+1}T01:00:00Z`,archived_at:null,ai_export_allowed:true,attachments:[],metadata:i===5?{folder_id:F2}:i===4?{}:{folder_id:F1}}));
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',r=>r.request().method()==='GET'?r.fulfill({json:structuredClone(rows)}):r.fulfill({status:500,json:{}}));
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_note_folders',r=>r.request().method()==='GET'?r.fulfill({json:structuredClone(folders)}):r.fulfill({status:500,json:{}}));
  await page.route(SB+'/rest/v1/app_record_links?**',r=>{const q=new URL(r.request().url()).searchParams;return q.has('note_id')?r.fulfill({json:[]}):r.fallback()});
  await page.evaluate(()=>window.KPTURouter.go('basket'));
  await chooseBasketKind(page,'note');
  const recent=width<761?page.locator('[data-nx-recent] [data-nx-recent-row]'):page.locator('#noteRows [data-nx-recent-row]');
  await expect(recent.first()).toBeVisible();
  const open=async id=>{const more=page.locator(`${width<761?'[data-nx-recent]':'#noteRows'} [data-note-row-more="${id}"]`);await more.click();await expect(page.locator('#noteDocMenu')).toBeVisible()};
  // 가장 최근(가상 노트 5) = 가상 성명 폴더.
  await open('n5');
  await expect(page.locator('#noteDocMenu button').first()).toHaveText('폴더로 가기');
  await shot(page,`notes-recent-menu-${width}`);
  await page.locator('#noteDocMenu button').first().click();
  const row=page.locator('#noteRows [data-nx-note="n5"]');
  await expect(row).toBeVisible();await expect(row).toHaveClass(/nx-flash/);
  await expect(page.locator('#noteRows [data-nx-note="n0"]')).toHaveCount(0);
  await shot(page,`notes-goto-${width}`);
  // 그 폴더 안 줄 메뉴에는 없다('최근' 줄이 아님).
  await page.locator('#noteRows [data-note-row-more="n5"]').click();
  await expect(page.locator('#noteDocMenu')).toBeVisible();
  await expect(page.locator('#noteDocMenu').getByRole('button',{name:'폴더로 가기'})).toHaveCount(0);
  await page.keyboard.press('Escape');
  // 뒤로 = 앞 화면('최근').
  await page.goBack();
  await expect(recent.first()).toBeVisible();
  // 폴더 없는 노트(가상 노트 4) → '폴더 없음'.
  await open('n4');
  await page.locator('#noteDocMenu').getByRole('button',{name:'폴더로 가기'}).click();
  await expect(page.locator('#noteRows [data-nx-note="n4"]')).toHaveClass(/nx-flash/);
  await expect(page.locator('#noteRows [data-nx-note="n5"]')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=1)).toBe(true);
  expect(errors).toEqual([]);
});
