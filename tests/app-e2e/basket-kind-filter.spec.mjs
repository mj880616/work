import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
// MEMO-노트 PR 2: app_notes also holds note/work/diary rows. The mock honours PostgREST kind filters,
// so a read that forgets kind=eq.basket would show the synthetic note row in the basket list.
const rows=[
 {id:'b1',kind:'basket',raw_text:'합성 정리함 메모',occurred_at:'2026-10-17T01:00:00Z',updated_at:'2026-10-17T01:00:00Z',ai_export_allowed:true,archived_at:null,attachments:[],metadata:{}},
 {id:'n1',kind:'note',title:'합성 노트 제목',raw_text:'NOTE_ROW_MUST_NOT_SHOW',occurred_at:'2026-10-17T02:00:00Z',updated_at:'2026-10-17T02:00:00Z',ai_export_allowed:true,archived_at:null,attachments:[],metadata:{}},
 {id:'d1',kind:'diary',journal_day:'2026-10-17',raw_text:'DIARY_ROW_MUST_NOT_SHOW',occurred_at:'2026-10-17T03:00:00Z',updated_at:'2026-10-17T03:00:00Z',ai_export_allowed:false,archived_at:null,attachments:[],metadata:{}},
];
for(const width of [390,1280]){
 test(`basket list reads kind=basket only and never shows note or diary rows ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const errors=[],reads=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await openHome(page);
  await page.route(SB+'/rest/v1/app_notes?**',r=>{
   const q=new URL(r.request().url()).searchParams;if(r.request().method()!=='GET')return r.fulfill({status:500,json:{}});
   reads.push(q.get('kind'));if(q.get('metadata'))return r.fulfill({json:[]});
   const kind=q.get('kind');return r.fulfill({json:rows.filter(n=>!kind||'eq.'+n.kind===kind).slice(Number(q.get('offset')||0))});
  });
  await page.route(SB+'/rest/v1/app_record_links?**',r=>new URL(r.request().url()).searchParams.has('note_id')?r.fulfill({json:[]}):r.fallback());
  await page.evaluate(()=>window.KPTURouter.go('basket'));
  await expect(page.locator('[data-basket-row]')).toHaveCount(1);
  await expect(page.locator('[data-basket-row="b1"]')).toContainText('합성 정리함 메모');
  await expect(page.locator('#basketView')).not.toContainText('NOTE_ROW_MUST_NOT_SHOW');
  await expect(page.locator('#basketView')).not.toContainText('DIARY_ROW_MUST_NOT_SHOW');
  expect(reads.length).toBeGreaterThan(0);expect(reads.every(k=>k==='eq.basket')).toBe(true);
  expect(errors).toEqual([]);
 });
}
