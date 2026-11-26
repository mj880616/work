import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder} from './helpers/library-folder-server.mjs';
import {openHome} from './helpers/home-entry.mjs';
import {chooseBasketKind} from './helpers/basket-kind.mjs';
// LIB-나무이름잘림(S70-59): 폴드 펼침 자료실 왼쪽 나무(한 칸 = 나무 | 목록)에서 개수·'받는 폴더' 표·⋯가 이름 칸을 밀어내
// '05. 교육'이 빈칸, '잡동사니'가 '잡' 한 글자로 보였다. 공용 폴더 줄(folder-tree.css .ft-main 기준 폭)에서 좁으면 표 → 개수 순으로 먼저 숨고,
// 이름은 최소 몇 글자(아래 MIN_EM 글자 폭) 또는 이름 전체가 보이고 잘리면 '…'로 끝난다. 자료실(한 칸·두 칸·폰)·노트 나무를 같은 검사로 본다. 이름은 지어낸 것.
const U=n=>'5e000000-0000-4000-8000-'+String(n).padStart(12,'0');
const MIN_EM=2.5;
const FOLDERS=[
  libFolder(U(1),null,{name:'02. 공공팀 사업 자료',sort_order:1024}),
  libFolder(U(2),null,{name:'04. 정책 (2026 하반기 검토 자료 모음)',sort_order:2048}),
  libFolder(U(3),null,{name:'05. 교육',sort_order:3072}),
  libFolder(U(4),null,{name:'06. 선전 (홍보물·현수막 시안)',sort_order:4096}),
  libFolder(U(5),U(2),{name:'하위 폴더 이름이 아주 긴 폴더',sort_order:0}),
  libFolder(U(6),null,{name:'잡동사니',sort_order:5120}),
];
const ITEMS=[{document_id:'a-1',folder_id:U(1)},{document_id:'a-2',folder_id:U(2)},{document_id:'a1-1',folder_id:U(5)},{document_id:'n-1',folder_id:U(6)}];

// 보이는 이름 줄마다: 이름 칸 폭 ≥ min(이름 전체 폭, MIN_EM 글자), 잘리면 '…'(text-overflow ellipsis).
async function namesReadable(scope,nameSel){
  const rows=await scope.locator(nameSel).evaluateAll((xs,min)=>xs.filter(x=>x.getClientRects().length).map(x=>{
    const cs=getComputedStyle(x),fs=parseFloat(cs.fontSize),w=x.getBoundingClientRect().width;
    return {name:x.textContent,w:Math.round(w),need:Math.round(Math.min(x.scrollWidth,min*fs)),cut:x.scrollWidth>x.clientWidth+1,ellipsis:cs.textOverflow==='ellipsis'};
  }),MIN_EM);
  expect(rows.length).toBeGreaterThan(0);
  for(const r of rows){
    expect(r.w,`'${r.name}' 이름 칸 ${r.w}px`).toBeGreaterThanOrEqual(r.need-1);
    if(r.cut)expect(r.ellipsis,`'${r.name}' 잘리면 …`).toBe(true);
  }
  return rows;
}

for(const width of [884,720])test(`자료실 한 칸 ${width}(폴드 펼침): 왼쪽 나무 폴더 이름이 빈칸·한 글자로 줄지 않음, 표·개수가 먼저 숨음`,async({page})=>{
  const {errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,group:'폴더',init:{viewPrefs:{library_two:false},receiveFolder:U(6)}});
  const nav=page.locator('#libraryFolderNav');
  await expect(nav.locator(`[data-lu-nav="${U(3)}"]`)).toBeVisible();
  // 하위 폴더도 보이게 펼친다(들여쓰기만큼 더 좁다).
  await nav.locator(`[data-lu-nav="${U(2)}"]`).click();
  await expect(nav.locator(`[data-lu-nav="${U(5)}"]`)).toBeVisible();
  const rows=await namesReadable(nav,'.ft-folder .ft-name');
  // 짧은 이름은 통째로 보인다.
  for(const n of ['05. 교육','잡동사니'])expect(rows.find(r=>r.name===n)?.cut,n).toBe(false);
  // 좁은 칸에서는 '받는 폴더' 표가 이름보다 먼저 숨는다(넓은 칸·두 칸에서는 보임 — library-receive-folder 시험).
  await expect(nav.locator(`[data-lu-nav="${U(6)}"] .ft-tag`)).toBeHidden();
  await page.screenshot({path:test.info().outputPath(`lib-one-${width}.png`)});
  expect(errors).toEqual([]);
});

test('자료실 두 칸 884: 칸 폭을 좁혀도 이름 먼저 보임, 넓으면 표·개수 그대로',async({page})=>{
  const {errors}=await bootLibrary(page,884,{folders:FOLDERS,items:ITEMS,group:'폴더',init:{viewPrefs:null,receiveFolder:U(6)}});
  const left=page.locator('#documentList [data-lu-pane-i="0"]');
  await expect(left.locator(`[data-lu-nav="${U(6)}"] .ft-tag`)).toHaveText('받는 폴더');
  await expect(left.locator(`[data-lu-nav="${U(3)}"] .ft-num`)).toBeVisible();
  await namesReadable(left,'.ft-folder .ft-name');
  expect(errors).toEqual([]);
});

test('자료실 폰 390: 폴더 줄 이름이 빈칸·한 글자로 줄지 않음',async({page})=>{
  const {errors}=await bootLibrary(page,390,{folders:FOLDERS,items:ITEMS,group:'폴더',init:{viewPrefs:null,receiveFolder:U(6)}});
  const list=page.locator('#documentList');
  await expect(list.locator('summary.lu-node-head').first()).toBeVisible();
  await namesReadable(list,'summary.lu-node-head .lu-node-name, .ft-folder .ft-name');
  expect(errors).toEqual([]);
});

// 노트 폴더 나무(같은 공용 줄): '00. …'·'01. 업무 …'처럼 잘리던 줄.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const note=(id,folder)=>({id,workspace_id:'w',kind:'note',title:'노트 '+id,raw_text:'본문',occurred_at:'2026-10-02T01:00:00Z',created_at:'2026-10-02T01:00:00Z',updated_at:'2026-10-02T01:00:00Z',archived_at:null,ai_export_allowed:true,attachments:[],metadata:folder?{folder_id:folder}:{}});
for(const [width,label] of [[884,'폴드 펼침'],[390,'폰']])test(`노트 ${label} ${width}: 폴더 나무 이름이 빈칸·한 글자로 줄지 않음`,async({page})=>{
  await page.setViewportSize({width,height:915});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await openHome(page);
  const folders=[
    {id:U(11),workspace_id:'w',parent_id:null,name:'00. 받은 자료 모음 (전체 공유)',sort_order:1024,created_at:'2026-10-01T00:00:00Z'},
    {id:U(12),workspace_id:'w',parent_id:null,name:'01. 업무 일지와 회의 기록',sort_order:2048,created_at:'2026-10-01T00:00:00Z'},
    {id:U(13),workspace_id:'w',parent_id:U(12),name:'하위 폴더 이름이 아주 긴 폴더',sort_order:1024,created_at:'2026-10-01T00:00:00Z'},
    {id:U(14),workspace_id:'w',parent_id:null,name:'교육',sort_order:3072,created_at:'2026-10-01T00:00:00Z'},
  ];
  const rows=[];for(let i=1;i<=12;i++)rows.push(note('a'+i,U(11)));rows.push(note('b1',U(12)),note('c1',U(13)),note('d1',U(14)));
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',r=>r.request().method()==='GET'?r.fulfill({json:structuredClone(rows)}):r.fulfill({status:500,json:{}}));
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_note_folders',r=>r.request().method()==='GET'?r.fulfill({json:structuredClone(folders)}):r.fulfill({status:500,json:{}}));
  await page.route(SB+'/rest/v1/app_record_links?**',r=>{const q=new URL(r.request().url()).searchParams;return q.has('note_id')?r.fulfill({json:[]}):r.fallback()});
  await page.evaluate(()=>window.KPTURouter.go('basket'));
  await chooseBasketKind(page,'note');
  const scope=width>760?page.locator('[data-nx-tree]'):page.locator('#noteRows');
  await expect(scope.locator(`[data-nx-folder="${U(12)}"]`)).toBeVisible();
  await scope.locator(`[data-nx-folder="${U(12)}"] .ft-main`).click();
  await expect(scope.locator(`[data-nx-folder="${U(13)}"]`)).toBeVisible();
  await namesReadable(scope,'.ft-folder .ft-name');
  await page.screenshot({path:test.info().outputPath(`notes-${width}.png`)});
  expect(errors).toEqual([]);
});
