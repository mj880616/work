import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { basketKindButton, openKindMenu } from './helpers/basket-kind.mjs';
import { noteMenuAction } from './helpers/note-menu.mjs';
// S69-98 NOTE-에버노트 ⑧(사용자 11/25 "좋아 모두 다 넣어!", S69-96 '@ 노트 연결'과 하나로): 노트 고치기에서 '[[' → 노트 고르기 목록 →
// Enter = 그 노트 제목 링크(보통 링크, 주소는 이 앱의 그 노트). 저장은 기존 노트 저장 하나(doc 안 링크). 읽기 화면에서 누르면 앱 안에서 그 노트,
// 그 노트 아래 '가리키는 노트' 한 줄. 새 칸·새 표 없음. 합성 데이터, 390·1280.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const A='a6900000-0000-4000-8000-000000000001',B='a6900000-0000-4000-8000-000000000002',L='a6900000-0000-4000-8000-000000000009';
const note=(id,title,raw,at,extra={})=>({id,workspace_id:'w',kind:'note',title,raw_text:raw,occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{},doc:null,...extra});
async function fixture(page,width){
 await page.setViewportSize({width,height:900});
 const notes=[note(A,'회의 메모','오늘 회의 정리','2026-11-20T01:00:00Z'),note(B,'임금 교섭 일정','교섭 날짜','2026-11-19T01:00:00Z'),note(L,'임금 비밀','잠긴 글','2026-11-18T01:00:00Z')];
 const writes=[],errors=[];let stamp=10;
 page.on('pageerror',e=>errors.push(e.message));
 await openHome(page);
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
  const req=r.request(),q=new URL(req.url()).searchParams,method=req.method();
  const pick=row=>(!q.get('kind')||'eq.'+row.kind===q.get('kind'))&&(!q.get('id')||'eq.'+row.id===q.get('id'))&&(!q.get('updated_at')||'eq.'+row.updated_at===q.get('updated_at'));
  if(method==='GET'){if(q.get('metadata'))return r.fulfill({json:[]});return r.fulfill({json:notes.filter(pick).map(x=>structuredClone(x))});}
  if(method==='PATCH'){const body=req.postDataJSON();writes.push({query:Object.fromEntries(q),body});const hit=notes.filter(pick);for(const row of hit)Object.assign(row,body,{updated_at:`2026-11-21T00:00:${String(stamp++).padStart(2,'0')}Z`});return r.fulfill({json:hit.map(x=>structuredClone(x))});}
  return r.fulfill({status:500,json:{}});
 });
 await page.route(SB+'/rest/v1/app_record_links?**',r=>r.fulfill({json:[]}));
 await page.route(SB+'/rest/v1/rpc/app_search_records',r=>r.fulfill({json:{words:[],groups:[]}}));
 await page.evaluate(()=>window.KPTURouter.go('basket'));
 await openKindMenu(page,'note');const kind=basketKindButton(page,'note');await expect(kind).toBeVisible();await kind.click();
 await expect(page.locator(`[data-note-row="${A}"]`)).toBeVisible();
 return {notes,writes,errors};
}
for(const width of [390,1280]){
 test(`[[ 노트 연결: 고르기 → 링크 저장 → 누르면 그 노트 · 가리키는 노트 한 줄 (${width})`,async({page})=>{
  test.setTimeout(60000);
  const f=await fixture(page,width);
  await page.locator(`[data-note-row="${A}"]`).click();
  await noteMenuAction(page,'data-note-edit',{width});
  const field=page.locator('[data-note-detail] [data-note-body-field] .ProseMirror');
  await expect(field).toBeVisible();
  await field.click();await page.keyboard.press('Control+End');
  await page.keyboard.type(' 참고 [[');
  const pop=page.locator('.ed-notelink');
  await expect(pop).toBeVisible();
  // 자기 자신은 없다(잠긴 노트 흉내가 없으므로 둘).
  await expect(pop.locator('[data-ed-note-link]')).toHaveCount(2);
  await page.keyboard.type('임금 교');
  await expect(pop.locator('[data-ed-note-link]')).toHaveCount(1);
  await expect(pop.locator('[data-ed-note-link]')).toHaveText('임금 교섭 일정');
  await page.keyboard.press('Enter');
  await expect(pop).toBeHidden();
  const link=field.locator('a').filter({hasText:'임금 교섭 일정'});
  await expect(link).toHaveCount(1);
  await expect(field).not.toContainText('[[');
  // 저장: 기존 노트 저장 PATCH 하나, doc 안 보통 링크(이 앱의 그 노트 주소).
  await page.locator('[data-note-detail] [data-note-save]').click();
  await expect.poll(()=>f.writes.length).toBe(1);
  const saved=JSON.stringify(f.writes[0].body.doc);
  expect(saved).toContain(`?view=basket&note=${B}`);
  expect(Object.keys(f.writes[0].body).sort()).toEqual(expect.arrayContaining(['doc','raw_text']));
  // 읽기 화면에서 누르면 새 창이 아니라 그 노트가 열린다.
  const readLink=page.locator('[data-note-detail] [data-basket-read-text] a').filter({hasText:'임금 교섭 일정'});
  await expect(readLink).toBeVisible();
  const popups=[];page.on('popup',p=>popups.push(p));
  await readLink.click();
  await expect(page.locator('[data-note-detail] [data-basket-read-text]')).toContainText('교섭 날짜');
  expect(popups).toEqual([]);
  // 그 노트 아래 '가리키는 노트' 한 줄 → 누르면 처음 노트로.
  const back=page.locator('[data-note-detail] [data-note-linkedby]');
  await expect(back).toBeVisible();
  await expect(back.locator(`[data-note-linkedby-id="${A}"]`)).toHaveText('회의 메모');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await back.locator(`[data-note-linkedby-id="${A}"]`).click();
  await expect(page.locator('[data-note-detail] [data-basket-read-text]')).toContainText('오늘 회의 정리');
  expect(f.errors).toEqual([]);
 });
}
test('[[ 목록 Esc: 목록만 닫고 친 글자는 그대로 (1280)',async({page})=>{
 const f=await fixture(page,1280);
 await page.locator(`[data-note-row="${A}"]`).click();
 await noteMenuAction(page,'data-note-edit',{width:1280});
 const field=page.locator('[data-note-detail] [data-note-body-field] .ProseMirror');
 await field.click();await page.keyboard.press('Control+End');
 await page.keyboard.type(' [[임금');
 await expect(page.locator('.ed-notelink')).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page.locator('.ed-notelink')).toBeHidden();
 await expect(field).toContainText('[[임금');
 await expect(page.locator('[data-note-detail] [data-note-body-field]')).toBeVisible();
 expect(f.errors).toEqual([]);
});
