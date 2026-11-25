import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { basketKindButton, openKindMenu } from './helpers/basket-kind.mjs';
// S69-98 NOTE-에버노트 ⑦(명진 11/25 "좋아 모두 다 넣어!"): 노트 읽기 아래 '관련' 칸 — 태그·제목·글자가 겹치는 노트(최대 4)와
// 기존 전체 검색(app_search_records, 자료만·대표 낱말 하나)으로 찾은 자료(최대 2). 접을 수 있음, 누르면 그 노트·자료로.
// 합성 데이터, 390·1280.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const note=(id,title,raw,at)=>({id,workspace_id:'w',kind:'note',title,raw_text:raw,occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{},doc:null});
async function fixture(page,width){
 await page.setViewportSize({width,height:900});
 const notes=[
  note('n-me','교섭 준비 메모','임금 교섭 준비 #교섭\n사측 제안 검토','2026-11-20T01:00:00Z'),
  note('n-tag','지난 회의','이번 결과 #교섭','2026-11-19T01:00:00Z'),
  note('n-word','임금 교섭 일정','교섭 날짜 정리','2026-11-18T01:00:00Z'),
  note('n-other','여행 계획','바다 산','2026-11-17T01:00:00Z'),
 ];
 const rpc=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await openHome(page);
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
  const q=new URL(r.request().url()).searchParams;
  if(r.request().method()!=='GET')return r.fulfill({status:500,json:{}});
  if(q.get('metadata'))return r.fulfill({json:[]});
  const id=(q.get('id')||'').replace(/^eq\./,'');
  return r.fulfill({json:notes.filter(n=>(!q.get('kind')||'eq.'+n.kind===q.get('kind'))&&(!id||n.id===id)).map(x=>structuredClone(x))});
 });
 await page.route(SB+'/rest/v1/app_record_links?**',r=>r.fulfill({json:[]}));
 await page.route(SB+'/rest/v1/rpc/app_search_records',r=>{const b=r.request().postDataJSON();rpc.push(b);return r.fulfill({json:{words:[b.p_query],groups:[{kind:'document',total:1,items:[{kind:'document',source:'document',id:'d-1',title:'교섭 자료집',matched_in:'title'}]}]}});});
 await page.evaluate(()=>window.KPTURouter.go('basket'));
 await openKindMenu(page,'note');const kind=basketKindButton(page,'note');await expect(kind).toBeVisible();await kind.click();
 await expect(page.locator('[data-note-row="n-me"]')).toBeVisible();
 return {rpc,errors};
}
for(const width of [390,1280]){
 test(`관련 노트·자료: 겹치는 노트와 자료를 접는 칸에, 누르면 그 노트로 (${width})`,async({page})=>{
  const f=await fixture(page,width);
  await page.locator('[data-note-row="n-me"]').click();
  const box=page.locator('[data-note-detail] [data-note-related]');
  await expect(box).toBeVisible();
  const rows=box.locator('[data-note-rel]');
  await expect(rows).toHaveCount(3);
  await expect(box.locator('[data-note-rel="note"]')).toHaveCount(2);
  await expect(box.locator('[data-note-rel-id="n-other"]')).toHaveCount(0);
  await expect(box.locator('[data-note-rel-id="n-tag"]')).toContainText('#교섭');
  await expect(box.locator('[data-note-rel="document"]')).toContainText('교섭 자료집');
  // 자료는 기존 전체 검색을 자료 종류로만, 한 번. (AI를 부르지 않는 것은 단위 시험이 소스로 본다 — 이 화면 밖 AI 요청이 섞일 수 있어 여기서는 세지 않음.)
  expect(f.rpc).toHaveLength(1);
  expect(f.rpc[0]).toMatchObject({p_kind:'document',p_per_kind:2,p_kinds:null});
  // 접기·펴기
  await box.locator('summary').click();
  await expect(rows.first()).toBeHidden();
  await box.locator('summary').click();
  await expect(rows.first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  // 누르면 그 노트가 열린다(그 노트의 관련 칸으로 바뀜).
  await box.locator('[data-note-rel-id="n-word"]').click();
  await expect(page.locator('[data-note-detail] [data-basket-read-text]')).toContainText('교섭 날짜 정리');
  await expect(page.locator('[data-note-detail] [data-note-related] [data-note-rel-id="n-me"]')).toBeVisible();
  expect(f.errors).toEqual([]);
 });
}
