import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
// ED③ 1단계 PR A: 노트 폴더 ⋯ 의 1회용 [옛 마크다운 노트 변환] (합성 데이터). 백업 표(app_ed3_text_backups)는 번호·시각만 흉내 낸다.
// 백업 없으면 시작 안 함 · 대조 창(원문 ↔ 바꾼 모양) 뒤에만 저장 · 한 건씩 조건 저장 · 다시 누르면 빠진 것만 · 충돌은 건너뜀. 390·1280.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const at='2026-10-20T01:00:00Z';
function store(){
 const row=(id,title,raw_text,metadata={},updated=at)=>({id,workspace_id:'w',kind:'note',title,raw_text,occurred_at:at,created_at:at,updated_at:updated,archived_at:null,ai_export_allowed:true,attachments:[],metadata,doc:null});
 return [
  row('n-md1','합성 쟁점 정리','## 쟁점\n\n2026. 10. 21. 교섭\n\n- **기본급** 인상',{markdown:true}),
  row('n-md2','합성 표 노트','| 항목 | 값 |\n|---|---|\n| 가 | 1 |',{}),
  row('n-md3','합성 충돌 노트','## 다른 탭에서 고침',{markdown:true}),
  row('n-plain','합성 통화 메모','1. 첫째 할 일\n- 둘째 줄',{markdown:false}),
 ];
}
async function fixture(page,{backups=true,conflict=null}={}){
 const rows=store(),writes=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
 await openHome(page);
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_ed3_text_backups',r=>{
  const q=new URL(r.request().url()).searchParams;
  if(!backups)return r.fulfill({status:404,json:{code:'42P01',message:'relation does not exist'}});
  if(q.get('select')!=='row_id,row_updated_at')return r.fulfill({status:403,json:{message:'only ids'}});
  return r.fulfill({json:Number(q.get('offset'))?[]:store().map(x=>({row_id:x.id,row_updated_at:'2026-10-20T01:00:00+00:00'}))});
 });
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
  const req=r.request(),q=new URL(req.url()).searchParams;
  const pick=x=>(!q.get('kind')||'eq.'+x.kind===q.get('kind'))&&(!q.get('id')||'eq.'+x.id===q.get('id'))&&(!q.get('updated_at')||'eq.'+x.updated_at===q.get('updated_at'))&&(q.get('doc')!=='is.null'||!x.doc);
  if(req.method()==='GET'){if(q.get('metadata'))return r.fulfill({json:[]});return r.fulfill({json:rows.filter(pick).slice(Number(q.get('offset')||0)).map(x=>structuredClone(x))});}
  if(req.method()==='PATCH'){
   const body=req.postDataJSON();writes.push({query:Object.fromEntries(q),body});
   if(conflict&&q.get('id')==='eq.'+conflict){const x=rows.find(n=>n.id===conflict);x.updated_at='2026-10-24T09:00:00Z';}
   const hit=rows.filter(pick);for(const x of hit)Object.assign(x,body);
   return r.fulfill({json:hit.map(x=>({id:x.id}))});
  }
  return r.fulfill({status:500,json:{}});
 });
 await page.route(SB+'/rest/v1/app_record_links?**',r=>{const q=new URL(r.request().url()).searchParams;if(!q.has('note_id'))return r.fallback();return r.fulfill({json:[]});});
 await page.evaluate(()=>window.KPTURouter.go('basket'));
 await chooseBasketKind(page,'note');
 await expect(page.locator('[data-note-host] [data-note-row]')).toHaveCount(4);
 return {rows,writes,errors};
}
async function pressConvert(page){
 await page.locator('[data-note-folder-more]').click();
 await page.locator('#noteDocMenu [data-note-convert]').click();
}
const status=page=>page.locator('[data-note-folder-status]');

for(const width of [390,1280]){
 test(`without a backup the button does not start and writes nothing ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page,{backups:false});
  await pressConvert(page);
  await expect(status(page)).toContainText('원본 보관(백업)이 아직 없어');
  await expect(page.locator('#noteConvertCheck')).toHaveCount(0);
  expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
 });

 test(`side-by-side check first, cancel writes nothing; start converts markdown notes one by one and keeps the plain one ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page,{conflict:'n-md3'});
  await pressConvert(page);
  const dialog=page.locator('#noteConvertCheck');await expect(dialog).toBeVisible();
  await expect(dialog.locator('.note-convert-item')).toHaveCount(3);
  const md1=dialog.locator('.note-convert-item').filter({hasText:'합성 쟁점 정리'});
  await expect(md1.locator('.note-convert-old')).toContainText('## 쟁점');
  await expect(md1.locator('.note-convert-new h2, .note-convert-new .ed-h2, .note-convert-new [class*="heading"]').first()).toBeVisible();
  await expect(md1.locator('.note-convert-new')).toContainText('2026. 10. 21. 교섭');
  await expect(md1.locator('.note-convert-new ol')).toHaveCount(0);
  await expect(dialog.locator('.note-convert-item').filter({hasText:'합성 표 노트'}).locator('.note-convert-new table')).toHaveCount(1);
  // Nothing in the dialog leaves the screen sideways.
  expect(await dialog.evaluate(d=>d.getBoundingClientRect().right<=document.documentElement.clientWidth+1)).toBe(true);
  await dialog.locator('[data-note-convert-cancel]').click();
  await expect(dialog).toHaveCount(0);await expect(status(page)).toHaveText('변환을 시작하지 않았어요.');
  expect(f.writes).toEqual([]);
  await pressConvert(page);
  await page.locator('#noteConvertCheck [data-note-convert-start]').click();
  await expect(status(page)).toContainText('바꿈 2 · 건너뜀 1');
  await page.locator('[data-note-convert-skipped] summary').click();
  await expect(page.locator('[data-note-convert-skipped] li')).toHaveText(['합성 충돌 노트 — 그사이 바뀜']);
  expect(f.writes).toHaveLength(3);
  for(const w of f.writes){expect(Object.keys(w.body).sort()).toEqual(['doc','raw_text']);expect(w.query).toMatchObject({kind:'eq.note',doc:'is.null',updated_at:'eq.'+at});}
  const md1row=f.rows.find(x=>x.id==='n-md1');expect(md1row.doc.v).toBe('ed1');expect(md1row.raw_text).toBe('쟁점\n\n2026. 10. 21. 교섭\n\n- 기본급 인상');expect(md1row.updated_at).toBe(at);
  expect(f.rows.find(x=>x.id==='n-plain').doc).toBeNull();
  // Pressed again: only what is left (the conflicted note now has a newer time than its backup → skipped, nothing written).
  await pressConvert(page);
  await expect(status(page)).toContainText('바꿈 0 · 건너뜀 1 · 이미 바뀜 2');
  expect(f.writes).toHaveLength(3);expect(f.errors).toEqual([]);
 });
}
