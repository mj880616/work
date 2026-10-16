import {testOrigin} from './helpers/test-origin.mjs';
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {openBasketMore} from './helpers/basket-more.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-10-12T01:00:00Z';
// UI-디자인기준 3/3: the organization list shows the last record as "N일 전 기록" under the name; its <time datetime> keeps the
// record time, read here as the KST month.day it used to print on the right.
const recordDay=page=>page.locator('[data-so-sub] time').evaluateAll(t=>t.map(e=>{const d=new Date(Date.parse(e.dateTime)+9*3600000).toISOString();return Number(d.slice(5,7))+'.'+Number(d.slice(8,10))}).join(','));
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
 await team(page);await expect.poll(()=>recordDay(page)).toBe('10.12');
 f.links[0].summary='오늘 고친 요약';await page.evaluate(()=>dispatchEvent(new Event('kptu:basket-links-changed')));
 await expect.poll(()=>f.linkReads.length).toBeGreaterThan(1);await expect.poll(()=>recordDay(page)).toBe('10.12');expect(f.errors).toEqual([]);
});
for(const width of [390,1280])test.describe(`original list return ${width}`,()=>{
 test.use({hasTouch:width===390});
 test(`removes note only and reload keeps unclassified list`,async({page})=>{
 await page.setViewportSize({width,height:900});const f=await fixture(page);f.links.push({id:'linked',workspace_id:'w',note_id:n,organization_id:o,status:'confirmed',summary:'승인'});
 await page.goto(testOrigin+'/app/?view=basket&note='+n+'&unrelated=keep#anchor');await expect(page.locator('[data-basket-text]')).toHaveValue(f.note.raw_text);
 await page.evaluate(()=>history.replaceState({...history.state,custom:'preserve'},'',location.href));await page.locator('[data-basket-close]').focus();await page.keyboard.press('Enter');
 expect(new URL(page.url()).searchParams.has('note')).toBe(false);expect(new URL(page.url()).searchParams.get('unrelated')).toBe('keep');expect(new URL(page.url()).hash).toBe('#anchor');expect(await page.evaluate(()=>history.state.custom)).toBe('preserve');
 await page.reload();await expect(page.locator('[data-basket-detail]')).toBeHidden();await expect(page.locator('[data-basket-filter="unclassified"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-basket-row]')).toHaveCount(0);
 const activate=control=>width===390?control.tap():control.click();await activate(page.locator('[data-basket-filter="all"]'));await activate(page.locator('[data-basket-row]'));await expect(page.locator('[data-basket-text]')).toHaveValue(f.note.raw_text);expect(f.errors).toEqual([]);
 });
});
test('cancelled dirty menu movement preserves URL and editor; accepted movement clears note',async({page})=>{
 const f=await fixture(page);await page.goto(testOrigin+'/app/?view=basket&note='+n+'&keep=yes#here');await expect(page.locator('[data-basket-text]')).toHaveValue(f.note.raw_text);await page.evaluate(()=>KPTUViewLoader.load('home'));await page.locator('[data-basket-edit]').click();await page.locator('[data-basket-text]').fill('수정 중');const before=page.url();
 page.once('dialog',d=>d.dismiss());await page.evaluate(()=>KPTURouter.go('home'));expect(page.url()).toBe(before);await expect(page.locator('#basketView')).toBeVisible();await expect(page.locator('[data-basket-text]')).toHaveValue('수정 중');
 page.once('dialog',d=>d.accept());await page.evaluate(()=>KPTURouter.go('home'));await expect(page.locator('#homeView')).toBeVisible();expect(new URL(page.url()).searchParams.has('note')).toBe(false);expect(new URL(page.url()).searchParams.get('keep')).toBe('yes');expect(new URL(page.url()).hash).toBe('#here');
 await page.evaluate(()=>KPTURouter.go('basket'));await expect(page.locator('[data-basket-detail]')).toBeHidden();expect(f.errors).toEqual([]);
});

test('list batches all linked pages, excludes suggested/task/foreign links, and keeps task counts',async({page})=>{
 const f=await fixture(page);f.taskLinks.push({google_task_id:'overdue',organization_id:o,status:'confirmed'});
 f.links.push(...Array.from({length:105},(_,i)=>({id:'l'+i,workspace_id:'w',note_id:n,organization_id:o,status:'confirmed',summary:i===104?null:'승인'})));
 f.links.push({id:'suggested',workspace_id:'w',note_id:n,organization_id:o,status:'suggested'},{id:'foreign',workspace_id:'other',note_id:n,organization_id:o,status:'confirmed'},{id:'task',workspace_id:'w',note_id:null,organization_id:o,status:'confirmed',google_task_id:'today'});
 await team(page);await expect.poll(()=>recordDay(page)).toBe('10.12');await expect(page.locator('[data-so-summary] .so-task-count')).toHaveText('1');
 expect(f.linkReads.map(q=>q.offset)).toEqual(['0','100']);for(const q of f.linkReads){expect(q.select).not.toMatch(/raw_text|summary/);}
 f.links.forEach(l=>{if(l.id.startsWith('l'))l.status='suggested';});await page.evaluate(()=>dispatchEvent(new Event('kptu:basket-links-changed')));await expect(page.locator('[data-so-sub] time')).toHaveCount(0);await expect(page.locator('[data-so-summary] .so-task-count')).toHaveText('1');expect(f.errors).toEqual([]);
});
test('list takes the newest occurred_at of legacy and note and preserves read failure path',async({page})=>{
 const f=await fixture(page);f.links.push({id:'l',workspace_id:'w',note_id:n,organization_id:o,status:'confirmed',summary:null});f.updates.push({id:'old',organization_id:o,occurred_at:'2026-10-13T01:00:00Z'});
 await page.evaluate(()=>{const api=KPTURuntime.api;window.__failListLinks=true;KPTURuntime.api=(path,...args)=>{if(__failListLinks&&path.includes('note_id=not.is.null'))throw Error('synthetic read denied');return api(path,...args);};});
 await team(page);await expect(page.locator('[data-so-sub] time')).toHaveCount(0);await expect(page.locator('[data-so-org]')).toHaveCount(1);
 await page.evaluate(()=>{__failListLinks=false;dispatchEvent(new Event('kptu:basket-links-changed'));});await expect.poll(()=>recordDay(page)).toBe('10.13');expect(f.errors).toEqual([]);
});
async function holdListRead(page){
 await page.evaluate(()=>{const api=KPTURuntime.api;window.__heldList={count:0};KPTURuntime.api=async(path,...args)=>{const result=await api(path,...args);if(path.includes('note_id=not.is.null')&&KPTURouter.current==='team'){const h=__heldList;h.count++;if(h.count===1){h.waiting=true;await new Promise(r=>h.release=r);}}return result;};dispatchEvent(new Event('kptu:basket-links-changed'));});
 await expect.poll(()=>page.evaluate(()=>__heldList.waiting)).toBe(true);
}
test('list replays one fresh read after a change during an existing read',async({page})=>{
 const f=await fixture(page);f.links.push({id:'l',workspace_id:'w',note_id:n,organization_id:o,status:'confirmed',summary:null});await team(page);await expect.poll(()=>recordDay(page)).toBe('10.12');await holdListRead(page);
 f.note.occurred_at='2026-10-14T01:00:00Z';await page.evaluate(()=>{dispatchEvent(new Event('kptu:basket-links-changed'));dispatchEvent(new Event('kptu:basket-links-changed'));__heldList.release();});
 await expect.poll(()=>recordDay(page)).toBe('10.14');expect(await page.evaluate(()=>__heldList.count)).toBe(2);expect(f.errors).toEqual([]);
});
for(const retire of ['screen','session'])test(`list ${retire} transition retires old read and queued replay`,async({page})=>{
 const f=await fixture(page);f.links.push({id:'l',workspace_id:'w',note_id:n,organization_id:o,status:'confirmed',summary:null});await team(page);await expect.poll(()=>recordDay(page)).toBe('10.12');await holdListRead(page);
 await page.evaluate(()=>dispatchEvent(new Event('kptu:basket-links-changed')));f.note.occurred_at='2026-10-14T01:00:00Z';
 if(retire==='screen')await page.evaluate(()=>KPTURouter.go('home'));else await page.evaluate(()=>{const c=KPTURuntime.context.read();KPTURuntime.context.set({...c,workspace:{...c.workspace,id:'other'}});dispatchEvent(new CustomEvent('kptu:session-changed',{detail:{session:{user:c.user}}}));});
 await page.evaluate(async()=>{__heldList.release();for(let i=0;i<30;i++)await Promise.resolve();});
 if(retire==='screen'){await expect.poll(()=>recordDay(page)).toBe('10.12');await team(page);await expect.poll(()=>recordDay(page)).toBe('10.14');}else await expect(page.locator('[data-so-sub] time')).toHaveCount(0);
 expect(f.errors).toEqual([]);
});
test('archived original and browser Back remain explicit choices',async({page})=>{
 const f=await fixture(page);f.note.archived_at=stamp;f.links.push({id:'l',workspace_id:'w',note_id:n,organization_id:o,status:'confirmed',summary:null});await page.evaluate(()=>KPTURouter.go('basket'));await expect(page.locator('[data-basket-list]')).toBeVisible();await page.locator('[data-basket-filter="archived"]').click();await page.locator('[data-basket-row]').click();await expect(page.locator('[data-basket-text]')).toHaveValue(f.note.raw_text);await page.locator('[data-basket-close]').click();
 await page.goto(testOrigin+'/app/?view=basket&note='+n);await expect(page.locator('[data-basket-text]')).toHaveValue(f.note.raw_text);await page.locator('[data-basket-close]').click();await page.evaluate(async()=>{await KPTUViewLoader.load('home');KPTURouter.go('home',{source:'delegated'});});await expect(page.locator('#homeView')).toBeVisible();await page.goBack();await expect(page.locator('#basketView')).toBeVisible();await expect(page.locator('[data-basket-detail]')).toBeHidden();expect(new URL(page.url()).searchParams.has('note')).toBe(false);expect(f.errors).toEqual([]);
});

test('Back declined while editing restores the original URL, history state, and text',async({page})=>{
 const f=await fixture(page);await page.evaluate(async()=>{await KPTUViewLoader.load('basket');KPTURouter.go('basket');});await page.locator('[data-basket-filter="all"]').click();
 await page.evaluate(id=>{history.replaceState({marker:'prior'},'','?view=home&keep=yes#here');history.pushState({marker:'editor'},'','?view=basket&note='+id+'&keep=yes#here');},n);
 await page.locator('[data-basket-row]').click();await page.locator('[data-basket-edit]').click();await page.locator('[data-basket-text]').fill('뒤로가기 취소 원문');const address=page.url();page.once('dialog',d=>d.dismiss());await page.evaluate(()=>history.back());
 await expect(page).toHaveURL(address);await expect(page.locator('#basketView')).toBeVisible();await expect(page.locator('[data-basket-text]')).toHaveValue('뒤로가기 취소 원문');expect(await page.evaluate(()=>history.state.marker)).toBe('editor');expect(f.errors).toEqual([]);
});
test('failed destination loading preserves note URL and the opened original',async({page})=>{
 const f=await fixture(page);await page.goto(testOrigin+'/app/?view=basket&note='+n+'&keep=yes#here');await expect(page.locator('[data-basket-text]')).toHaveValue(f.note.raw_text);const address=page.url();
 await page.evaluate(()=>{const load=KPTUViewLoader.load;KPTUViewLoader.load=view=>view==='tasks'?Promise.reject(Error('synthetic route load failure')):load(view);KPTURouter.go('tasks');});
 await expect.poll(()=>f.errors.some(e=>e.includes('synthetic route load failure'))).toBe(true);expect(page.url()).toBe(address);await expect(page.locator('#basketView')).toBeVisible();await expect(page.locator('[data-basket-text]')).toHaveValue(f.note.raw_text);expect(f.errors).toHaveLength(1);
});

test('Back declined after lazy-loading an unopened target still restores note URL and text',async({page})=>{
 const f=await fixture(page);await page.evaluate(async()=>{await KPTUViewLoader.load('basket');KPTURouter.go('basket');});await page.locator('[data-basket-filter="all"]').click();expect(await page.evaluate(()=>KPTUViewLoader.isLoaded('calendar'))).toBe(false);
 await page.evaluate(id=>{history.replaceState({marker:'calendar'},'','?view=calendar&keep=yes#here');history.pushState({marker:'editor'},'','?view=basket&note='+id+'&keep=yes#here');},n);
 await page.locator('[data-basket-row]').click();await page.locator('[data-basket-edit]').click();await page.locator('[data-basket-text]').fill('지연 뒤로가기 취소 원문');const address=page.url();let prompted=false;page.once('dialog',d=>{prompted=true;return d.dismiss();});await page.evaluate(()=>history.back());await expect.poll(()=>prompted).toBe(true);
 await expect(page).toHaveURL(address);await expect(page.locator('#basketView')).toBeVisible();await expect(page.locator('[data-basket-text]')).toHaveValue('지연 뒤로가기 취소 원문');expect(await page.evaluate(()=>history.state.marker)).toBe('editor');expect(f.errors).toEqual([]);
});

// Load first, then build the same-document entries in a later task. An evaluate that is still
// returning while those URL changes run can be reported as a destroyed context.
async function historyStack(page){
 await page.evaluate(async()=>{await KPTUViewLoader.load('calendar');await KPTUViewLoader.load('basket');});
 await page.evaluate(id=>{window.__historyStackReady=false;setTimeout(()=>{
  KPTURouter.go('home',{source:'delegated'});history.replaceState({marker:'home',unrelated:{value:1}},'','?view=home&keep=1#home');
  KPTURouter.go('calendar',{source:'delegated'});history.replaceState({marker:'calendar',unrelated:{value:2}},'','?view=calendar&keep=1#calendar');
  KPTURouter.go('basket',{source:'delegated'});history.replaceState({marker:'editor',unrelated:{value:3}},'','?view=basket&note='+id+'&keep=1#basket');
  window.__historyStackReady=true;
 });},n);
 await expect.poll(()=>page.evaluate(()=>window.__historyStackReady)).toBe(true);
 await expect(page.locator('[data-basket-row]')).toHaveCount(1);
}
const historyProof=page=>page.evaluate(()=>({index:navigation.currentEntry.index,entries:navigation.entries().map(e=>({key:e.key,id:e.id,index:e.index,url:e.url})),state:history.state}));
for(const width of [390,1280])test(`declined Back retains history position and calendar entry for next Back/Forward ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const f=await fixture(page);await historyStack(page);await page.locator('[data-basket-row]').click();await page.locator('[data-basket-edit]').click();await page.locator('[data-basket-text]').fill('history 원문 유지');const before=await historyProof(page);let prompts=0;page.on('dialog',()=>prompts++);
 let prompted=false;page.once('dialog',d=>{prompted=true;return d.dismiss();});await page.evaluate(()=>history.back());await expect.poll(()=>prompted).toBe(true);await expect(page).toHaveURL(before.entries.find(e=>e.index===before.index).url);expect(await historyProof(page)).toEqual(before);expect(prompts).toBe(1);await expect(page.locator('[data-basket-text]')).toHaveValue('history 원문 유지');
 page.once('dialog',d=>d.accept());await page.locator('[data-basket-close]').click();expect(await page.evaluate(()=>history.state)).toEqual(before.state);
 await page.evaluate(()=>history.back());await expect(page.locator('#calendarView')).toBeVisible();await expect(page).toHaveURL(/view=calendar&keep=1#calendar/);expect(await page.evaluate(()=>history.state)).toEqual({marker:'calendar',unrelated:{value:2}});expect(await page.evaluate(()=>navigation.currentEntry.index)).toBe(before.index-1);
 await page.evaluate(()=>history.forward());await expect(page.locator('#basketView')).toBeVisible();expect(await page.evaluate(()=>history.state)).toEqual(before.state);expect(new URL(page.url()).searchParams.has('note')).toBe(false);await expect(page.locator('[data-basket-detail]')).toBeHidden();expect(f.errors).toEqual([]);
});
test('declined Forward restores its prior position without replacing the forward destination',async({page})=>{
 const f=await fixture(page);await historyStack(page);
 await page.evaluate(()=>history.pushState({marker:'future',unrelated:{value:4}},'','?view=calendar&keep=1#future'));await page.evaluate(()=>history.back());await expect(page).toHaveURL(/view=basket&note=/);
 await page.locator('[data-basket-row]').click();await page.locator('[data-basket-edit]').click();await page.locator('[data-basket-text]').fill('Forward 취소 원문');const before=await historyProof(page);let prompted=false;page.once('dialog',d=>{prompted=true;return d.dismiss();});await page.evaluate(()=>history.forward());await expect.poll(()=>prompted).toBe(true);await expect(page).toHaveURL(before.entries.find(e=>e.index===before.index).url);expect(await historyProof(page)).toEqual(before);
 page.once('dialog',d=>d.accept());await page.locator('[data-basket-close]').click();await page.evaluate(()=>history.forward());await expect(page.locator('#calendarView')).toBeVisible();await expect(page).toHaveURL(/view=calendar&keep=1#future/);expect(await page.evaluate(()=>history.state)).toEqual({marker:'future',unrelated:{value:4}});expect(f.errors).toEqual([]);
});
for(const operation of ['preview','confirm'])test(`blocked Back during classification ${operation} keeps route-owned history without an editor`,async({page})=>{
 const f=await fixture(page);await historyStack(page);await openBasketMore(page);await page.locator('[data-classification-open]').click();await expect(page.locator('[data-basket-text]')).toHaveCount(0);
 await page.locator('[data-classification-input]').fill(JSON.stringify({schema_version:1,copied_at:stamp,items:[{note_id:n,note_updated_at:stamp,destinations:[{kind:'organization',target_id:o,reason:'합성 후보'}]}]}));
 const target=operation==='preview'?'app_notes':'app_basket_confirm_links';await page.evaluate(target=>{const api=KPTURuntime.api;window.__classificationHistoryHold={target};KPTURuntime.api=async(path,...args)=>{if(path.split('?')[0].endsWith('/'+target)){__classificationHistoryHold.waiting=true;await new Promise(resolve=>__classificationHistoryHold.release=resolve);}return api(path,...args);};},target);
 await page.locator('[data-classification-preview]').click();
 if(operation==='confirm'){await expect(page.locator('[data-classification-choice]')).toHaveCount(1);await page.locator('[data-classification-choice]').check();await page.locator('[data-classification-confirm]').click();}
 await expect.poll(()=>page.evaluate(()=>__classificationHistoryHold.waiting)).toBe(true);const before=await historyProof(page);
 await page.evaluate(()=>history.back());await expect(page).toHaveURL(before.entries.find(e=>e.index===before.index).url);expect(await historyProof(page)).toEqual(before);await expect(page.locator('#basketView')).toBeVisible();expect(await page.evaluate(()=>KPTURouter.current)).toBe('basket');await expect(page.locator('[data-classification-panel]')).toBeVisible();await expect(page.locator('[data-classification-preview]')).toBeDisabled();
 await page.evaluate(()=>__classificationHistoryHold.release());await expect(page.locator('[data-classification-preview]')).toBeEnabled();await page.locator('[data-classification-close]').click();await page.evaluate(()=>history.back());await expect(page.locator('#calendarView')).toBeVisible();expect(await page.evaluate(()=>history.state)).toEqual({marker:'calendar',unrelated:{value:2}});expect(f.errors).toEqual([]);
});

test('API-disabled traversal keeps URL/current/screen consistent and retains the original draft for return',async({page})=>{
 const f=await fixture(page);await historyStack(page);await page.locator('[data-basket-row]').click();await page.locator('[data-basket-edit]').click();await page.locator('[data-basket-text]').fill('fallback 원문 유지');const before=await historyProof(page);let dialogs=0;page.on('dialog',d=>{dialogs++;return d.dismiss();});
 await page.evaluate(()=>{window.__navigationProof=window.navigation;Object.defineProperty(window,'navigation',{value:undefined,configurable:true});history.back();});
 await expect(page.locator('#calendarView')).toBeVisible();expect(await page.evaluate(()=>KPTURouter.current)).toBe('calendar');await expect(page).toHaveURL(/view=calendar&keep=1#calendar/);expect(await page.evaluate(()=>history.state)).toEqual({marker:'calendar',unrelated:{value:2}});expect(await page.evaluate(()=>__navigationProof.entries().map(e=>({key:e.key,id:e.id,index:e.index,url:e.url})))).toEqual(before.entries);await expect(page.locator('[data-basket-text]')).toHaveValue('fallback 원문 유지');
 await page.evaluate(()=>history.forward());await expect(page.locator('#basketView')).toBeVisible();await expect(page.locator('[data-basket-text]')).toHaveValue('fallback 원문 유지');expect(await page.evaluate(()=>history.state)).toEqual(before.state);expect(dialogs).toBe(0);expect(f.errors).toEqual([]);
});
for(const operation of ['preview','confirm'])test(`API-disabled Back keeps classification ${operation} in memory and commits destination consistently`,async({page})=>{
 const f=await fixture(page);await historyStack(page);await openBasketMore(page);await page.locator('[data-classification-open]').click();const proposal=JSON.stringify({schema_version:1,copied_at:stamp,items:[{note_id:n,note_updated_at:stamp,destinations:[{kind:'organization',target_id:o,reason:'fallback 후보'}]}]});await page.locator('[data-classification-input]').fill(proposal);
 const target=operation==='preview'?'app_notes':'app_basket_confirm_links';await page.evaluate(target=>{const api=KPTURuntime.api;window.__fallbackClass={};KPTURuntime.api=async(path,...args)=>{if(path.split('?')[0].endsWith('/'+target)){__fallbackClass.waiting=true;await new Promise(resolve=>__fallbackClass.release=resolve);}return api(path,...args);};},target);await page.locator('[data-classification-preview]').click();
 if(operation==='confirm'){await expect(page.locator('[data-classification-choice]')).toHaveCount(1);await page.locator('[data-classification-choice]').check();await page.locator('[data-classification-confirm]').click();}
 await expect.poll(()=>page.evaluate(()=>__fallbackClass.waiting)).toBe(true);const before=await historyProof(page);
 await page.evaluate(()=>{window.__navigationProof=window.navigation;Object.defineProperty(window,'navigation',{value:undefined,configurable:true});history.back();});await expect(page.locator('#calendarView')).toBeVisible();expect(await page.evaluate(()=>KPTURouter.current)).toBe('calendar');await expect(page).toHaveURL(/view=calendar&keep=1#calendar/);expect(await page.evaluate(()=>history.state)).toEqual({marker:'calendar',unrelated:{value:2}});expect(await page.evaluate(()=>__navigationProof.entries().map(e=>({key:e.key,id:e.id,index:e.index,url:e.url})))).toEqual(before.entries);
 await expect(page.locator('[data-classification-input]')).toHaveValue(proposal);await expect(page.locator('[data-classification-preview]')).toBeDisabled();await page.evaluate(()=>history.forward());await expect(page.locator('#basketView')).toBeVisible();await expect(page.locator('[data-classification-panel]')).toBeVisible();await expect(page.locator('[data-classification-input]')).toHaveValue(proposal);await page.evaluate(()=>__fallbackClass.release());await expect(page.locator('[data-classification-preview]')).toBeEnabled();expect(f.errors).toEqual([]);
});

for(const draft of ['original','classification'])test(`API-disabled retained ${draft} survives further menu movement before basket return`,async({page})=>{
 const f=await fixture(page);await historyStack(page);
 if(draft==='original'){await page.locator('[data-basket-row]').click();await page.locator('[data-basket-edit]').click();await page.locator('[data-basket-text]').fill('다른 메뉴 뒤에도 원문 유지');}
 else{await openBasketMore(page);await page.locator('[data-classification-open]').click();await page.locator('[data-classification-input]').fill(JSON.stringify({schema_version:1,copied_at:stamp,items:[{note_id:n,note_updated_at:stamp,destinations:[{kind:'organization',target_id:o,reason:'다른 메뉴 뒤에도 후보 유지'}]}]}));await page.evaluate(()=>{const api=KPTURuntime.api;window.__retainedClass={};KPTURuntime.api=async(path,...args)=>{if(path.split('?')[0].endsWith('/app_notes')){__retainedClass.waiting=true;await new Promise(resolve=>__retainedClass.release=resolve);}return api(path,...args);};});await page.locator('[data-classification-preview]').click();await expect.poll(()=>page.evaluate(()=>__retainedClass.waiting)).toBe(true);}
 const input=page.locator(draft==='original'?'[data-basket-text]':'[data-classification-input]'),text=await input.inputValue();await page.evaluate(()=>{Object.defineProperty(window,'navigation',{value:undefined,configurable:true});history.back();});await expect(page.locator('#calendarView')).toBeVisible();
 await page.evaluate(()=>KPTURouter.go('home',{source:'delegated'}));await expect(page.locator('#homeView')).toBeVisible();await expect(input).toHaveValue(text);
 await page.evaluate(()=>KPTURouter.go('basket',{source:'delegated'}));await expect(page.locator('#basketView')).toBeVisible();await expect(input).toBeVisible();await expect(input).toHaveValue(text);
 if(draft==='classification'){await expect(page.locator('[data-classification-preview]')).toBeDisabled();await page.evaluate(()=>__retainedClass.release());await expect(page.locator('[data-classification-preview]')).toBeEnabled();}expect(f.errors).toEqual([]);
});

test('returning Forward before a lazy Back target loads cannot prompt or commit the retired target',async({page})=>{
 const f=await fixture(page);await page.evaluate(async id=>{await KPTUViewLoader.load('basket');KPTURouter.go('basket');history.replaceState({marker:'calendar'},'','?view=calendar');history.pushState({marker:'editor'},'','?view=basket&note='+id);const load=KPTUViewLoader.load;window.__retiredLazy={};KPTUViewLoader.load=async view=>{if(view==='calendar'){__retiredLazy.waiting=true;await new Promise(resolve=>__retiredLazy.release=resolve);const result=await load(view);__retiredLazy.completed=true;return result;}return load(view);};},n);
 await expect(page.locator('[data-basket-row]')).toHaveCount(1);await page.locator('[data-basket-row]').click();await page.locator('[data-basket-edit]').click();await page.locator('[data-basket-text]').fill('늦은 이전 대상 원문 유지');const before=await historyProof(page);let prompts=0;page.on('dialog',d=>{prompts++;return d.dismiss();});
 await page.evaluate(()=>history.back());await expect.poll(()=>page.evaluate(()=>__retiredLazy.waiting)).toBe(true);await page.evaluate(()=>history.forward());await expect(page).toHaveURL(before.entries.find(e=>e.index===before.index).url);await page.evaluate(()=>__retiredLazy.release());await expect.poll(()=>page.evaluate(()=>__retiredLazy.completed)).toBe(true);
 expect(await page.evaluate(()=>KPTURouter.current)).toBe('basket');await expect(page.locator('#basketView')).toBeVisible();await expect(page.locator('[data-basket-text]')).toHaveValue('늦은 이전 대상 원문 유지');expect(await historyProof(page)).toEqual(before);expect(prompts).toBe(0);expect(f.errors).toEqual([]);
});
