import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-10-12T01:00:00Z';
const n='10000000-0000-4000-8000-000000000001',p='20000000-0000-4000-8000-000000000001',o='30000000-0000-4000-8000-000000000001';
async function fixture(page){
 await openHome(page);const errors=[],calls=[],links=[],taskLinks=[],linkReads=[],note={id:n,workspace_id:'w',occurred_at:stamp,updated_at:stamp,raw_text:'합성 원문 <script>만 표시</script>',ai_export_allowed:true,archived_at:null,attachments:[]};
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 const tables={app_notes:[note],app_suborganizations:[{id:o,workspace_id:'w',name:'합성 한빛지부',active:true,created_by:'home-test'}],app_suborganization_assignees:[{organization_id:o,user_id:'home-test'}],app_spaces:[{id:p,workspace_id:'w',owner_id:'home-test',name:'합성 기자회견 준비',status:'active',metadata:{project_system:'v2'}}],app_suborganization_updates:[]};
 for(const [table,items] of Object.entries(tables))await page.route(SB+'/rest/v1/'+table+'?**',route=>{
  const q=new URL(route.request().url()).searchParams;let rows=items;
  for(const key of ['id','organization_id']){const filter=q.get(key);if(filter?.startsWith('eq.'))rows=rows.filter(x=>x[key]===filter.slice(3));}
  return route.fulfill({json:rows.slice(Number(q.get('offset')||0),Number(q.get('offset')||0)+Number(q.get('limit')||rows.length))});
 });
 await page.route(SB+'/rest/v1/app_record_links?**',route=>{
  const q=new URL(route.request().url()).searchParams;const basket=q.get('note_id')==='not.is.null';if(basket)linkReads.push(Object.fromEntries(q));let rows=q.has('google_task_id')?taskLinks:links;
  for(const key of ['id','organization_id','project_id','note_id']){const filter=q.get(key);if(filter?.startsWith('eq.'))rows=rows.filter(x=>x[key]===filter.slice(3));}
  const offset=Number(q.get('offset')||0),limit=Number(q.get('limit')||rows.length);return route.fulfill({json:rows.slice(offset,offset+limit).map(row=>({...row,note,organization:{name:'합성 한빛지부'},project:{name:'합성 기자회견 준비'}}))});
 });
 await page.route(SB+'/rest/v1/rpc/app_basket_confirm_links',route=>{
  const body=route.request().postDataJSON();calls.push(body);for(const target of body.p_targets)links.push({id:'40000000-0000-4000-8000-'+String(links.length+1).padStart(12,'0'),workspace_id:'w',note_id:n,status:'confirmed',summary:target.summary,[target.kind==='project'?'project_id':'organization_id']:target.target_id});
  return route.fulfill({json:{ok:true,created:body.p_targets.length,existing:0}});
 });
 await page.route(SB+'/rest/v1/rpc/app_basket_update_link_summary',route=>{
  const body=route.request().postDataJSON();calls.push(body);const row=links.find(row=>row.id===body.p_link_id);if(row.summary!==body.p_expected_summary)return route.fulfill({json:{ok:false,error:'SUMMARY_CHANGED'}});row.summary=body.p_summary;return route.fulfill({json:{ok:true}});
 });
 return {links,note,calls,errors,taskLinks,linkReads,updates:tables.app_suborganization_updates};
}

async function team(page){await page.evaluate(async()=>{await KPTUViewLoader.load('team');KPTURouter.go('team');});await expect(page.locator('[data-so-summary]')).toHaveCount(1);}
for(const width of [390,1280])test(`organization list combines occurred_at and rechecks after links change ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const f=await fixture(page);
 f.links.push({id:'linked',workspace_id:'w',note_id:n,organization_id:o,status:'confirmed',summary:null});f.note.archived_at=stamp;f.note.ai_export_allowed=false;
 await team(page);await expect(page.locator('[data-so-summary] time')).toHaveText('10.12');
 f.links[0].summary='오늘 고친 요약';await page.evaluate(()=>dispatchEvent(new Event('kptu:basket-links-changed')));
 await expect.poll(()=>f.linkReads.length).toBeGreaterThan(1);await expect(page.locator('[data-so-summary] time')).toHaveText('10.12');expect(f.errors).toEqual([]);
});
for(const width of [390,1280])test(`original list return removes note only and reload keeps unclassified list ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const f=await fixture(page);f.links.push({id:'linked',workspace_id:'w',note_id:n,organization_id:o,status:'confirmed',summary:'승인'});
 await page.goto('http://127.0.0.1:8123/app/?view=basket&note='+n+'&unrelated=keep#anchor');await expect(page.locator('[data-basket-text]')).toHaveValue(f.note.raw_text);
 await page.evaluate(()=>history.replaceState({...history.state,custom:'preserve'},'',location.href));await page.locator('[data-basket-close]').focus();await page.keyboard.press('Enter');
 expect(new URL(page.url()).searchParams.has('note')).toBe(false);expect(new URL(page.url()).searchParams.get('unrelated')).toBe('keep');expect(new URL(page.url()).hash).toBe('#anchor');expect(await page.evaluate(()=>history.state.custom)).toBe('preserve');
 await page.reload();await expect(page.locator('[data-basket-detail]')).toBeHidden();await expect(page.locator('[data-basket-filter="unclassified"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-basket-row]')).toHaveCount(0);
 await page.locator('[data-basket-filter="all"]').tap();await page.locator('[data-basket-row]').tap();await expect(page.locator('[data-basket-text]')).toHaveValue(f.note.raw_text);expect(f.errors).toEqual([]);
});
test('cancelled dirty menu movement preserves URL and editor; accepted movement clears note',async({page})=>{
 const f=await fixture(page);await page.goto('http://127.0.0.1:8123/app/?view=basket&note='+n+'&keep=yes#here');await expect(page.locator('[data-basket-text]')).toHaveValue(f.note.raw_text);await page.evaluate(()=>KPTUViewLoader.load('home'));await page.locator('[data-basket-text]').fill('수정 중');const before=page.url();
 page.once('dialog',d=>d.dismiss());await page.evaluate(()=>KPTURouter.go('home'));expect(page.url()).toBe(before);await expect(page.locator('#basketView')).toBeVisible();await expect(page.locator('[data-basket-text]')).toHaveValue('수정 중');
 page.once('dialog',d=>d.accept());await page.evaluate(()=>KPTURouter.go('home'));await expect(page.locator('#homeView')).toBeVisible();expect(new URL(page.url()).searchParams.has('note')).toBe(false);expect(new URL(page.url()).searchParams.get('keep')).toBe('yes');expect(new URL(page.url()).hash).toBe('#here');
 await page.evaluate(()=>KPTURouter.go('basket'));await expect(page.locator('[data-basket-detail]')).toBeHidden();expect(f.errors).toEqual([]);
});

test('list batches all linked pages, excludes suggested/task/foreign links, and keeps task counts',async({page})=>{
 const f=await fixture(page);f.taskLinks.push({google_task_id:'overdue',organization_id:o,status:'confirmed'});
 f.links.push(...Array.from({length:105},(_,i)=>({id:'l'+i,workspace_id:'w',note_id:n,organization_id:o,status:'confirmed',summary:i===104?null:'승인'})));
 f.links.push({id:'suggested',workspace_id:'w',note_id:n,organization_id:o,status:'suggested'},{id:'foreign',workspace_id:'other',note_id:n,organization_id:o,status:'confirmed'},{id:'task',workspace_id:'w',note_id:null,organization_id:o,status:'confirmed',google_task_id:'today'});
 await team(page);await expect(page.locator('[data-so-summary] time')).toHaveText('10.12');await expect(page.locator('[data-so-summary] .so-task-count')).toHaveText('1');
 expect(f.linkReads.map(q=>q.offset)).toEqual(['0','100']);
 f.links.forEach(l=>{if(l.id.startsWith('l'))l.status='suggested';});await page.evaluate(()=>dispatchEvent(new Event('kptu:basket-links-changed')));await expect(page.locator('[data-so-summary] time')).toHaveCount(0);await expect(page.locator('[data-so-summary] .so-task-count')).toHaveText('1');expect(f.errors).toEqual([]);
});
test('list takes the newest occurred_at of legacy and note and preserves read failure path',async({page})=>{
 const f=await fixture(page);f.links.push({id:'l',workspace_id:'w',note_id:n,organization_id:o,status:'confirmed',summary:null});f.updates.push({id:'old',organization_id:o,occurred_at:'2026-10-13T01:00:00Z'});
 await page.evaluate(()=>{const api=KPTURuntime.api;window.__failListLinks=true;KPTURuntime.api=(path,...args)=>{if(__failListLinks&&path.includes('note_id=not.is.null'))throw Error('synthetic read denied');return api(path,...args);};});
 await team(page);await expect(page.locator('[data-so-summary] time')).toHaveCount(0);await expect(page.locator('[data-so-org]')).toHaveCount(1);
 await page.evaluate(()=>{__failListLinks=false;dispatchEvent(new Event('kptu:basket-links-changed'));});await expect(page.locator('[data-so-summary] time')).toHaveText('10.13');expect(f.errors).toEqual([]);
});
async function holdListRead(page){
 await page.evaluate(()=>{const api=KPTURuntime.api;window.__heldList={count:0};KPTURuntime.api=async(path,...args)=>{const result=await api(path,...args);if(path.includes('note_id=not.is.null')&&KPTURouter.current==='team'){const h=__heldList;h.count++;if(h.count===1){h.waiting=true;await new Promise(r=>h.release=r);}}return result;};dispatchEvent(new Event('kptu:basket-links-changed'));});
 await expect.poll(()=>page.evaluate(()=>__heldList.waiting)).toBe(true);
}
test('list replays one fresh read after a change during an existing read',async({page})=>{
 const f=await fixture(page);f.links.push({id:'l',workspace_id:'w',note_id:n,organization_id:o,status:'confirmed',summary:null});await team(page);await expect(page.locator('[data-so-summary] time')).toHaveText('10.12');await holdListRead(page);
 f.note.occurred_at='2026-10-14T01:00:00Z';await page.evaluate(()=>{dispatchEvent(new Event('kptu:basket-links-changed'));dispatchEvent(new Event('kptu:basket-links-changed'));__heldList.release();});
 await expect(page.locator('[data-so-summary] time')).toHaveText('10.14');expect(await page.evaluate(()=>__heldList.count)).toBe(2);expect(f.errors).toEqual([]);
});
for(const retire of ['screen','session'])test(`list ${retire} transition retires old read and queued replay`,async({page})=>{
 const f=await fixture(page);f.links.push({id:'l',workspace_id:'w',note_id:n,organization_id:o,status:'confirmed',summary:null});await team(page);await expect(page.locator('[data-so-summary] time')).toHaveText('10.12');await holdListRead(page);
 await page.evaluate(()=>dispatchEvent(new Event('kptu:basket-links-changed')));f.note.occurred_at='2026-10-14T01:00:00Z';
 if(retire==='screen')await page.evaluate(()=>KPTURouter.go('home'));else await page.evaluate(()=>{const c=KPTURuntime.context.read();KPTURuntime.context.set({...c,workspace:{...c.workspace,id:'other'}});dispatchEvent(new CustomEvent('kptu:session-changed',{detail:{session:{user:c.user}}}));});
 await page.evaluate(async()=>{__heldList.release();for(let i=0;i<30;i++)await Promise.resolve();});
 if(retire==='screen'){await expect(page.locator('[data-so-summary] time')).toHaveText('10.12');await team(page);await expect(page.locator('[data-so-summary] time')).toHaveText('10.14');}else await expect(page.locator('[data-so-summary] time')).toHaveCount(0);
 expect(f.errors).toEqual([]);
});
test('archived original and browser Back remain explicit choices',async({page})=>{
 const f=await fixture(page);f.note.archived_at=stamp;f.links.push({id:'l',workspace_id:'w',note_id:n,organization_id:o,status:'confirmed',summary:null});await page.evaluate(()=>KPTURouter.go('basket'));await expect(page.locator('[data-basket-list]')).toBeVisible();await page.locator('[data-basket-filter="archived"]').tap();await page.locator('[data-basket-row]').tap();await expect(page.locator('[data-basket-text]')).toHaveValue(f.note.raw_text);await page.locator('[data-basket-close]').tap();
 await page.goto('http://127.0.0.1:8123/app/?view=basket&note='+n);await expect(page.locator('[data-basket-text]')).toHaveValue(f.note.raw_text);await page.locator('[data-basket-close]').tap();await page.evaluate(async()=>{await KPTUViewLoader.load('home');KPTURouter.go('home',{source:'delegated'});});await expect(page.locator('#homeView')).toBeVisible();await page.goBack();await expect(page.locator('#basketView')).toBeVisible();await expect(page.locator('[data-basket-detail]')).toBeHidden();expect(new URL(page.url()).searchParams.has('note')).toBe(false);expect(f.errors).toEqual([]);
});

test('Back declined while editing restores the original URL, history state, and text',async({page})=>{
 const f=await fixture(page);await page.evaluate(async()=>{await KPTUViewLoader.load('basket');KPTURouter.go('basket');});await page.locator('[data-basket-filter="all"]').click();
 await page.evaluate(id=>{history.replaceState({marker:'prior'},'','?view=home&keep=yes#here');history.pushState({marker:'editor'},'','?view=basket&note='+id+'&keep=yes#here');},n);
 await page.locator('[data-basket-row]').click();await page.locator('[data-basket-text]').fill('뒤로가기 취소 원문');const address=page.url();page.once('dialog',d=>d.dismiss());await page.evaluate(()=>history.back());
 await expect(page).toHaveURL(address);await expect(page.locator('#basketView')).toBeVisible();await expect(page.locator('[data-basket-text]')).toHaveValue('뒤로가기 취소 원문');expect(await page.evaluate(()=>history.state.marker)).toBe('editor');expect(f.errors).toEqual([]);
});
test('failed destination loading preserves note URL and the opened original',async({page})=>{
 const f=await fixture(page);await page.goto('http://127.0.0.1:8123/app/?view=basket&note='+n+'&keep=yes#here');await expect(page.locator('[data-basket-text]')).toHaveValue(f.note.raw_text);const address=page.url();
 await page.evaluate(()=>{const load=KPTUViewLoader.load;KPTUViewLoader.load=view=>view==='tasks'?Promise.reject(Error('synthetic route load failure')):load(view);KPTURouter.go('tasks');});
 await expect.poll(()=>f.errors.some(e=>e.includes('synthetic route load failure'))).toBe(true);expect(page.url()).toBe(address);await expect(page.locator('#basketView')).toBeVisible();await expect(page.locator('[data-basket-text]')).toHaveValue(f.note.raw_text);expect(f.errors).toHaveLength(1);
});
