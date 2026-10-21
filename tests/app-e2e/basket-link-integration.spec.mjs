import {test,expect} from '@playwright/test';
import {linkAction} from './helpers/basket-link-menu.mjs';
import {openHome} from './helpers/home-entry.mjs';
import {openBasketMore,openClassification,requestClassification,handoffLine} from './helpers/basket-more.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-10-06T01:00:00Z';
const n='10000000-0000-4000-8000-000000000001',p='20000000-0000-4000-8000-000000000001',o='30000000-0000-4000-8000-000000000001';
async function fixture(page){
 const requests=[];page.on('request',request=>{const u=new URL(request.url());if(u.origin===SB)requests.push({path:u.pathname,query:u.search})});await openHome(page);const errors=[],calls=[],links=[],note={id:n,workspace_id:'w',occurred_at:stamp,updated_at:stamp,raw_text:'합성 원문 <script>만 표시</script>',ai_export_allowed:true,archived_at:null,attachments:[]};
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 const tables={app_notes:[note],app_suborganizations:[{id:o,workspace_id:'w',name:'합성 한빛지부',active:true,created_by:'home-test'}],app_suborganization_assignees:[{organization_id:o,user_id:'home-test'}],app_spaces:[{id:p,workspace_id:'w',owner_id:'home-test',name:'합성 기자회견 준비',status:'active',metadata:{project_system:'v2'}}],app_suborganization_updates:[]};
 for(const [table,items] of Object.entries(tables))await page.route(SB+'/rest/v1/'+table+'?**',route=>{
  const q=new URL(route.request().url()).searchParams;let rows=items;
  for(const key of ['id','organization_id']){const filter=q.get(key);if(filter?.startsWith('eq.'))rows=rows.filter(x=>x[key]===filter.slice(3));}
  return route.fulfill({json:rows.slice(Number(q.get('offset')||0),Number(q.get('offset')||0)+Number(q.get('limit')||rows.length))});
 });
 await page.route(SB+'/rest/v1/app_record_links?**',route=>{
  const q=new URL(route.request().url()).searchParams;let rows=q.has('google_task_id')?[]:links;
  for(const key of ['id','organization_id','project_id','note_id']){const filter=q.get(key);if(filter?.startsWith('eq.'))rows=rows.filter(x=>x[key]===filter.slice(3));}
  return route.fulfill({json:rows.map(row=>({...row,note,organization:{name:'합성 한빛지부'},project:{name:'합성 기자회견 준비'}}))});
 });
 await page.route(SB+'/rest/v1/rpc/app_basket_confirm_links',route=>{
  const body=route.request().postDataJSON();calls.push(body);for(const target of body.p_targets)links.push({id:'40000000-0000-4000-8000-'+String(links.length+1).padStart(12,'0'),workspace_id:'w',note_id:n,status:'confirmed',summary:target.summary,[target.kind==='project'?'project_id':'organization_id']:target.target_id});
  return route.fulfill({json:{ok:true,created:body.p_targets.length,existing:0}});
 });
 await page.route(SB+'/rest/v1/rpc/app_basket_update_link_summary',route=>{
  const body=route.request().postDataJSON();calls.push(body);const row=links.find(row=>row.id===body.p_link_id);if(row.summary!==body.p_expected_summary)return route.fulfill({json:{ok:false,error:'SUMMARY_CHANGED'}});row.summary=body.p_summary;return route.fulfill({json:{ok:true}});
 });
 return {links,note,calls,errors,requests};
}
async function connect(page,capture=null){
 await page.evaluate(()=>window.KPTURouter.go('basket'));await expect(page.locator('[data-basket-row]')).toHaveCount(1);await openClassification(page);
 await page.locator('[data-classification-input]').fill(JSON.stringify({schema_version:1,copied_at:stamp,items:[{note_id:n,note_updated_at:stamp,destinations:[{kind:'organization',target_id:o,reason:'옛 AI 조직 이유'},{kind:'project',target_id:p,reason:'옛 AI 프로젝트 이유'}]}]}));
 await page.locator('[data-classification-preview]').click();await page.locator('[data-classification-summary="0:0"]').fill('한빛지부, 10/20 기자회견 예정');await page.locator('[data-classification-summary="0:1"]').fill('기자회견 장소 협의 중');
 await page.locator('[data-classification-choice="0:0"]').check();await page.locator('[data-classification-choice="0:1"]').check();if(capture)await page.screenshot({path:capture,fullPage:true});await page.locator('[data-classification-confirm]').click();await expect(page.locator('[data-classification-status]')).toContainText('2개 연결했어요');
}
async function org(page){await page.evaluate(async id=>{await window.KPTUViewLoader.load('team');await window.KPTUWorkplace.open(id);},o);await expect(page.locator('#wdModal')).toBeVisible();}
async function cleanHome(page,f){
 await expect(page.locator('#homeView')).toBeVisible();
 await page.waitForFunction(()=>window.KPTUHome?.metrics.readyAt>0);
 await expect(page.locator('[data-home-card="updates"],[data-home-unlinked]')).toHaveCount(0);
 const key=await page.evaluate(()=>KPTURuntime.ownerCache.prefix+'home-read-v1:home-test'),cdp=await page.context().newCDPSession(page);
 let cache;try{const {entries}=await cdp.send('DOMStorage.getDOMStorageItems',{storageId:{securityOrigin:new URL(page.url()).origin,isLocalStorage:true}});cache=JSON.parse(entries.find(([k])=>k===key)[1]);}finally{await cdp.detach();}
 expect(cache.cards.updates).toBeUndefined();expect(cache.cards.tasks.unlinkedCount).toBeUndefined();
 expect(await page.evaluate(()=>KPTUHome.metrics.requests.updates||KPTUHome.metrics.requests['basket-updates']||0)).toBe(0);
}
const homeRecords=reads=>reads.filter(r=>r.path.endsWith('app_suborganization_updates')||r.path.endsWith('app_notes')||(r.path.endsWith('app_record_links')&&r.query.includes('note_id=not.is.null')));
for(const width of [390,1280])test(`approved summaries stay in organization and project records with a clean home and archived original ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:1000});const f=await fixture(page);await connect(page,info.outputPath(`basket-summary-preview-${width}.png`));expect(f.calls[0].p_targets.map(t=>t.summary)).toEqual(['한빛지부, 10/20 기자회견 예정','기자회견 장소 협의 중']);
 await org(page);await expect(page.locator('#wdUpdates')).toContainText('한빛지부, 10/20 기자회견 예정');await expect(page.locator('#wdUpdates [data-wd-up-del],#wdUpdates [data-wd-up-menu]')).toHaveCount(0);await page.screenshot({path:info.outputPath(`basket-linked-organization-${width}.png`),fullPage:true});
 const row=page.locator('#wdUpdates [data-basket-link]');await linkAction(row,'요약 수정');await row.locator('textarea').fill('한빛지부, 기자회견 취소 확인');await row.getByRole('button',{name:'저장',exact:true}).click();await expect(row).toContainText('한빛지부, 기자회견 취소 확인');
 await page.locator('[data-wd-close="wdModal"]').click();await page.evaluate(async id=>{await window.KPTUViewLoader.load('projects');await window.KPTUProjects.open(id);},p);const projectRows=page.locator('#ps3-progress [data-ps3-records]');await expect(projectRows).toContainText('기자회견 장소 협의 중');await expect(projectRows.locator('[data-basket-link] a')).toHaveAttribute('href',/view=basket&note=/);await expect(projectRows.locator('button:not([data-ps3-record-menu^="basket:"])')).toHaveCount(0);await expect(page.locator('[data-ps3-record]')).toHaveCount(0);await page.screenshot({path:info.outputPath(`basket-linked-project-${width}.png`),fullPage:true});await page.locator('[data-ps3-close="ps3DetailModal"]').click();
 const beforeHome=f.requests.length;await page.evaluate(()=>window.KPTURouter.go('home'));await cleanHome(page,f);expect(homeRecords(f.requests.slice(beforeHome))).toEqual([]);
 await page.screenshot({path:info.outputPath(`basket-linked-home-${width}.png`),fullPage:true});
 f.note.archived_at=stamp;f.note.ai_export_allowed=false;await org(page);await expect(page.locator('#wdUpdates')).toContainText('한빛지부, 기자회견 취소 확인');await page.locator('#wdUpdates a[data-basket-link-open]').first().click();
 // UI-모바일업데이트겹쳐보기: on a phone the tap shows the record as a card over the detail; [바구니에서 열기] then opens the basket.
 if(width<=760){const sheet=page.locator('#kptuRecordSheet');await expect(sheet).toBeVisible();await expect(sheet.locator('[data-record-sheet-text]')).toHaveText(f.note.raw_text);await expect(page.locator('#wdModal')).toBeVisible();await sheet.getByRole('button',{name:'바구니에서 열기'}).click()}
 await expect(page.locator('#wdModal')).toBeHidden();await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe('basket');await expect(page.locator('[data-basket-text]')).toHaveValue(f.note.raw_text);await expect(page.locator('[data-basket-archive]')).toHaveText('보관 해제');expect(f.errors).toEqual([]);
});
test('a summary saved after leaving detail keeps home clean and is retrievable from the organization without restoring the old editor',async({page})=>{
 const f=await fixture(page);await connect(page);await org(page);const row=page.locator('#wdUpdates [data-basket-link]');await linkAction(row,'요약 수정');await row.locator('textarea').fill('늦게 저장된 승인 요약');
 let release;const held=new Promise(resolve=>release=resolve);await page.route(SB+'/rest/v1/rpc/app_basket_update_link_summary',async route=>{await held;await route.fallback();});await row.getByRole('button',{name:'저장',exact:true}).click();await expect(row.locator('textarea')).toBeDisabled();
 page.once('dialog',dialog=>dialog.accept());await page.evaluate(()=>{window.__lateSummaryEvents=0;addEventListener('kptu:basket-links-changed',()=>window.__lateSummaryEvents++);window.KPTURouter.go('home')});await expect(page.locator('#wdModal')).toBeHidden();await cleanHome(page,f);const before=f.requests.length;const saved=page.waitForResponse(r=>r.url().endsWith('/app_basket_update_link_summary'));release();await saved;await expect.poll(()=>page.evaluate(()=>window.__lateSummaryEvents)).toBe(1);
 await expect.poll(()=>f.calls.filter(c=>c.p_link_id).length).toBe(1);await cleanHome(page,f);expect(homeRecords(f.requests.slice(before))).toEqual([]);await expect(page.locator('#wdModal')).toBeHidden();await expect(page.locator('[data-link-summary-form]')).toHaveCount(0);expect(f.calls.filter(c=>c.p_link_id)).toHaveLength(1);await org(page);await expect(page.locator('#wdUpdates')).toContainText('늦게 저장된 승인 요약');await expect(page.locator('[data-link-summary-form]')).toHaveCount(0);expect(f.errors).toEqual([]);
});
test('an uncertain save rechecks records even when navigation closes its pending recovery read',async({page})=>{
 const f=await fixture(page);await connect(page);await org(page);const row=page.locator('#wdUpdates [data-basket-link]');await linkAction(row,'요약 수정');await row.locator('textarea').fill('통신 결과가 늦게 확인된 요약');
 await page.evaluate(()=>{const rt=KPTURuntime,api=rt.api;rt.api=async(path,...args)=>{if(path.endsWith('/app_basket_update_link_summary'))throw Error('synthetic uncertain response');return api(path,...args);};});
 let release,entered=false;const held=new Promise(resolve=>release=resolve);await page.route(SB+'/rest/v1/app_record_links?**',async route=>{if(new URL(route.request().url()).searchParams.has('id')){entered=true;await held;}await route.fallback();});
 await row.getByRole('button',{name:'저장',exact:true}).click();await expect.poll(()=>entered).toBe(true);page.once('dialog',dialog=>dialog.accept());await page.evaluate(()=>{window.__lateSummaryEvents=0;addEventListener('kptu:basket-links-changed',()=>window.__lateSummaryEvents++);KPTURouter.go('home')});await cleanHome(page,f);const before=f.requests.length;
 f.links.find(row=>row.organization_id===o).summary='통신 결과가 늦게 확인된 요약';const recovered=page.waitForResponse(r=>{const u=new URL(r.url());return u.pathname.endsWith('/app_record_links')&&u.searchParams.has('id')});release();await recovered;await expect.poll(()=>page.evaluate(()=>window.__lateSummaryEvents)).toBe(1);await cleanHome(page,f);expect(homeRecords(f.requests.slice(before))).toEqual([]);await expect(page.locator('#wdModal')).toBeHidden();await expect(page.locator('[data-link-summary-form]')).toHaveCount(0);await org(page);await expect(page.locator('#wdUpdates')).toContainText('통신 결과가 늦게 확인된 요약');expect(f.calls.filter(c=>c.p_link_id)).toHaveLength(0);expect(f.errors).toEqual([]);
});
