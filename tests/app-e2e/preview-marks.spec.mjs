import {testOrigin} from './helpers/test-origin.mjs';
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// BUG-미리보기기호: a record line in 담당조직 (a basket update linked there, a note, a direct update) shows plain letters only
// (no ###, |, **, no 2026\.&#x20; leftovers; table cells joined with ' · '); [더보기] opens the same text as headings and a table.
// Project progress lines use the same function. All names and texts are synthetic.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-10-12T01:00:00Z';
const n='10000000-0000-4000-8000-000000000001',o='30000000-0000-4000-8000-000000000001',p='20000000-0000-4000-8000-000000000001';
const RAW='### 합성 간담회 결과\n\n| 일시 | 위치·장소 | 참석 |\n|---|---|---|\n| 2026\\.&#x20;10\\.&#x20;21\\. | **합성 본사** | 12명 |\n\n- 다음 주 재논의\n- 자료 보강\n- 확인 사항 하나\n- 확인 사항 둘\n- 확인 사항 셋';
const MARKS=/###|\||\*\*|&#x20;|\\\./;
async function fixture(page){
 await openHome(page);const errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 const note={id:n,workspace_id:'w',kind:'basket',title:null,occurred_at:stamp,updated_at:stamp,created_at:stamp,raw_text:RAW,ai_export_allowed:true,archived_at:null,attachments:[],metadata:{}};
 const tables={app_notes:[note],app_suborganizations:[{id:o,workspace_id:'w',name:'합성 한빛지부',active:true,created_by:'home-test'}],app_suborganization_assignees:[{organization_id:o,user_id:'home-test'}],app_spaces:[{id:p,workspace_id:'w',owner_id:'home-test',name:'합성 기자회견 준비',status:'active',metadata:{project_system:'v2'}}],
  app_suborganization_updates:[{id:'u1',workspace_id:'w',organization_id:o,occurred_at:'2026-10-13T01:00:00Z',raw_text:'## 직접 쓴 업데이트\n**굵게** '+'합성 문장 '.repeat(40),detail_text:null,created_at:stamp}]};
 for(const [table,items] of Object.entries(tables))await page.route(SB+'/rest/v1/'+table+'?**',route=>{
  const q=new URL(route.request().url()).searchParams;let rows=items;
  for(const key of ['id','organization_id']){const filter=q.get(key);if(filter?.startsWith('eq.'))rows=rows.filter(x=>x[key]===filter.slice(3));}
  return route.fulfill({json:rows.slice(Number(q.get('offset')||0),Number(q.get('offset')||0)+Number(q.get('limit')||rows.length))});
 });
 await page.route(SB+'/rest/v1/app_record_links?**',route=>{
  const q=new URL(route.request().url()).searchParams;let rows=[{id:'40000000-0000-4000-8000-000000000001',workspace_id:'w',note_id:n,organization_id:o,project_id:null,status:'confirmed',summary:null}];
  if(q.has('google_task_id'))rows=[];
  for(const key of ['id','organization_id','project_id','note_id']){const filter=q.get(key);if(filter?.startsWith('eq.'))rows=rows.filter(x=>x[key]===filter.slice(3));}
  return route.fulfill({json:rows.map(row=>({...row,note,organization:{name:'합성 한빛지부'}}))});
 });
 return {errors};
}
for(const width of [390,1280])test(`organization record lines show plain letters and open as markdown ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const f=await fixture(page);
 await page.addStyleTag({content:'#wdUpdates .kptu-clamp{-webkit-line-clamp:1!important;line-clamp:1!important}'});
 await page.evaluate(async()=>{await KPTUViewLoader.load('team');KPTURouter.go('team');});
 await expect(page.locator('[data-so-org]')).toHaveCount(1);
 if(width<1024)await page.locator('[data-so-org]').click();
 const link=page.locator('#wdUpdates [data-link-summary-text]'),own=page.locator('#wdUpdates .wd-log-main p');
 await expect(link).toHaveCount(1);await expect(own).toHaveCount(1);
 const line=(await link.textContent())||'';
 expect(line).toContain('합성 간담회 결과 일시 · 위치·장소 · 참석');expect(line).toContain('2026. 10. 21.');expect(line).toContain('합성 본사 · 12명');expect(line).not.toMatch(MARKS);
 expect(((await own.textContent())||'').trim()).toMatch(/^직접 쓴 업데이트 굵게 합성 문장/);expect((await own.textContent())||'').not.toMatch(MARKS);
 // opened: the same text as a heading and a table. The 4-line cut is made certain by a 1-line clamp so [더보기] always shows.
 const more=page.locator('#wdUpdates .kptu-clamp-more');await expect(more).toHaveCount(2);
 await more.first().click();
 const open=page.locator('#wdUpdates [data-link-summary-text], #wdUpdates .wd-log-main p').filter({has:page.locator('table, h2')});
 await expect(open).toHaveCount(1);
 await more.nth(1).click();
 await expect(page.locator('#wdUpdates table')).toHaveCount(1);await expect(page.locator('#wdUpdates h3')).toContainText('합성 간담회 결과');await expect(page.locator('#wdUpdates h2')).toContainText('직접 쓴 업데이트');
 await expect(page.locator('#wdUpdates tbody td').first()).toContainText('2026. 10. 21.');
 await page.locator('#wdUpdates .kptu-clamp-more').first().click();await page.locator('#wdUpdates .kptu-clamp-more').last().click();
 await expect(page.locator('#wdUpdates table')).toHaveCount(0);expect(((await link.textContent())||'')).not.toMatch(MARKS);
 expect(f.errors).toEqual([]);
});
