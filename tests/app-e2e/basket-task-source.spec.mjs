import {showBasketRow} from './helpers/basket-more.mjs';
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// BASKET-할일출처: a task made from a basket note is listed on the note (metadata.tasks),
// and the task view links back to the note. No new table or RPC.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-10-06T01:00:00.123456+00:00';
const n='10000000-0000-4000-8000-000000000001',o='30000000-0000-4000-8000-000000000001',p='20000000-0000-4000-8000-000000000001';
const RAW='10/20 기자회견 준비 회의\n장소: 본사 앞\n참석 30명';
async function fixture(page,{metadata={keep:'그대로'}}={}){
 const home=await openHome(page),errors=[],patches=[],sourceReads=[],confirms=[];
 const note={id:n,workspace_id:'w',occurred_at:stamp,updated_at:stamp,raw_text:RAW,ai_export_allowed:true,archived_at:null,attachments:[],metadata};
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 const tables={app_suborganizations:[{id:o,workspace_id:'w',name:'합성 한빛지부',active:true}],app_suborganization_assignees:[{organization_id:o,user_id:'home-test'}],app_spaces:[{id:p,workspace_id:'w',owner_id:'home-test',name:'합성 기자회견 준비',status:'active',metadata:{project_system:'v2'}}]};
 for(const [table,items] of Object.entries(tables))await page.route(SB+'/rest/v1/'+table+'?**',route=>{const q=new URL(route.request().url()).searchParams;return route.fulfill({json:items.slice(Number(q.get('offset')||0),Number(q.get('offset')||0)+Number(q.get('limit')||items.length))});});
 const db={failWrites:false,hold:null};
 await page.route(SB+'/rest/v1/app_notes?**',async route=>{
  const req=route.request(),q=new URL(req.url()).searchParams;
  if(req.method()==='PATCH'){
   patches.push({query:Object.fromEntries(q),body:req.postDataJSON()});await db.hold;
   const first=Array.isArray(note.metadata?.tasks)?note.metadata.tasks[0]?.task_id:null,guard=q.get('metadata->tasks->0->>task_id');
   if(db.failWrites||q.get('updated_at')!=='eq.'+note.updated_at||(guard==='is.null'?first!=null:guard!=='eq.'+first))return route.fulfill({json:[]});
   note.metadata=req.postDataJSON().metadata;return route.fulfill({json:[{id:n,updated_at:note.updated_at,metadata:note.metadata}]});
  }
  if(q.get('metadata')==='cs.{"tasks":[]}'){sourceReads.push(Object.fromEntries(q));return route.fulfill({json:Array.isArray(note.metadata?.tasks)?[{id:n,tasks:note.metadata.tasks}]:[]});}
  const rows=q.get('id')&&q.get('id')!=='eq.'+n?[]:[note];
  return route.fulfill({json:rows.slice(Number(q.get('offset')||0))});
 });
 await page.route(SB+'/rest/v1/app_record_links?**',route=>route.fulfill({json:[]}));
 await page.route(SB+'/rest/v1/rpc/app_basket_confirm_links',route=>{const body=route.request().postDataJSON();confirms.push(body);
  return route.fulfill({json:body.p_note_updated_at===note.updated_at?{ok:true,created:body.p_targets.length,existing:0}:{ok:false,error:'NOTE_CHANGED',created:0,existing:0}});});
 return {home,note,errors,patches,sourceReads,confirms,db};
}
async function tap(page,locator,width){await expect(locator).toBeVisible();if(width<761)await locator.tap();else await locator.click();}
async function openNote(page,width){
 await page.evaluate(()=>window.KPTURouter.go('basket'));await showBasketRow(page,n);
 await tap(page,page.locator(`[data-basket-row="${n}"]`),width);await expect(page.locator('[data-basket-read-text]')).toBeVisible();
 return page.locator('[data-basket-detail]');
}
async function makeTask(page,detail,width,title='기자회견 장소 확정'){
 await tap(page,detail.getByRole('button',{name:'할 일 만들기'}),width);
 await detail.locator('[data-manual-task-title]').fill(title);
 await tap(page,detail.getByRole('button',{name:'할 일 만들기',exact:true}),width);
}
const noWideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);

for(const width of [390,1280])test(`a task made from a note is listed on the note and links back from the task view ${width}`,async({page},info)=>{
 // 390 wide; tall enough that the save button needs no scroll (main shows the same touch-emulation
 // scroll jump on a scrolled save tap, outside this change).
 await page.setViewportSize({width,height:width<761?1200:900});const f=await fixture(page),detail=await openNote(page,width);
 await expect(detail.locator('[data-basket-note-tasks]')).toBeHidden();
 await makeTask(page,detail,width);
 await expect(detail.locator('[data-basket-status]')).toHaveText('Google 할 일을 만들었어요. 이 메모에 기록했어요.');
 const list=detail.locator('[data-basket-note-tasks]');
 await expect(list).toBeVisible();await expect(list.getByRole('heading')).toHaveText('이 메모로 만든 할 일 1');await expect(list).toContainText('기자회견 장소 확정');
 // One metadata-only write: other keys kept, the original's version (updated_at) unchanged.
 expect(f.patches).toHaveLength(1);expect(Object.keys(f.patches[0].body)).toEqual(['metadata']);
 expect(f.patches[0].query).toMatchObject({id:'eq.'+n,workspace_id:'eq.w',updated_at:'eq.'+stamp,'metadata->tasks->0->>task_id':'is.null'});
 expect(f.note.metadata.keep).toBe('그대로');expect(f.note.metadata.tasks).toEqual([{task_id:'home-created-5',task_list_id:'@default',title:'기자회견 장소 확정',created_at:expect.any(String)}]);
 expect(f.note.updated_at).toBe(stamp);expect(f.home.tasks).toHaveLength(6);
 expect(await noWideScroll(page)).toBe(true);
 if(width===390)await page.screenshot({path:info.outputPath('note-tasks-390.png'),fullPage:true});
 // The note → task: the task view opens with that task's editor, which links back to the note.
 await tap(page,list.getByRole('button',{name:'기자회견 장소 확정 할 일 화면에서 보기'}),width);
 await expect(page.locator('#tasksView')).toBeVisible();await expect(page.locator('#gtTaskModal')).toBeVisible();
 await expect(page.locator('#gtEditTitle')).toHaveValue('기자회견 장소 확정');
 const editorLink=page.locator('#gtSourceNote [data-gt-source-note]');await expect(editorLink).toHaveText('출처 메모');await expect(editorLink).toHaveAttribute('href',`./?view=basket&note=${n}`);
 // One contains query per list load, never one per task.
 expect(f.sourceReads).toHaveLength(1);expect(f.sourceReads[0]).toMatchObject({workspace_id:'eq.w',select:'id,tasks:metadata->tasks'});
 await page.locator('#gtTaskModal [data-gt-close]').click();await expect(page.locator('#gtTaskModal')).toBeHidden();
 const rowLink=page.locator('[data-google-task="home-created-5"] [data-gt-source-note]');await expect(rowLink).toHaveText('출처 메모');
 await expect(page.locator('[data-google-task="today"] [data-gt-source-note]')).toHaveCount(0);
 expect(await noWideScroll(page)).toBe(true);
 if(width===390)await page.screenshot({path:info.outputPath('task-source-link-390.png'),fullPage:true});
 // The task → note: the basket opens that note's read view in-app.
 await tap(page,rowLink,width);
 await expect(page.locator('#basketView')).toBeVisible();await expect(page.locator('[data-basket-read-text]')).toContainText('10/20 기자회견 준비 회의');
 await expect(page.locator('[data-basket-note-tasks]')).toContainText('기자회견 장소 확정');
 expect(f.errors).toEqual([]);
});

test('after a recorded task the AI and link flows keep the same note version',async({page})=>{
 const f=await fixture(page),detail=await openNote(page,1280);
 await makeTask(page,detail,1280);await expect(detail.locator('[data-basket-status]')).toHaveText('Google 할 일을 만들었어요. 이 메모에 기록했어요.');
 // The AI handoff copies updated_at as the version a pasted result must match; it must not move.
 expect(await page.evaluate(id=>import('./basket-data.js').then(m=>m.readBasket()).then(r=>r.notes.find(x=>x.id===id).updated_at),n)).toBe(stamp);
 await detail.getByRole('button',{name:'연결하기'}).click();
 await detail.locator('[data-manual-pick="organization"]').click();await page.locator('#basketLinkChoiceSheet').getByRole('button',{name:'합성 한빛지부',exact:true}).click();
 await detail.locator(`[data-manual-summary="organization:${o}"]`).fill('10/20 본사 앞 30명');
 await detail.getByRole('button',{name:'연결',exact:true}).click();await expect(detail.locator('[data-basket-status]')).toHaveText('1곳에 연결했어요.');
 expect(f.confirms).toHaveLength(1);expect(f.confirms[0].p_note_updated_at).toBe(stamp);expect(f.errors).toEqual([]);
});

test('a second task goes first and a third writer race is guarded by the first listed task',async({page})=>{
 const f=await fixture(page,{metadata:{tasks:[{task_id:'older',task_list_id:'@default',title:'예전 할 일',created_at:'2026-10-01T00:00:00.000Z'}]}}),detail=await openNote(page,1280);
 await expect(detail.locator('[data-basket-note-tasks] li')).toHaveCount(1);
 await makeTask(page,detail,1280,'두 번째');await expect(detail.locator('[data-basket-status]')).toHaveText('Google 할 일을 만들었어요. 이 메모에 기록했어요.');
 await expect(detail.locator('[data-basket-note-tasks] li')).toHaveText([/두 번째/,/예전 할 일/]);
 expect(f.patches[0].query['metadata->tasks->0->>task_id']).toBe('eq.older');expect(f.errors).toEqual([]);
});

test('a failed record is reported once and never makes the task again',async({page})=>{
 const f=await fixture(page),detail=await openNote(page,1280);f.db.failWrites=true;
 await makeTask(page,detail,1280);
 await expect(detail.locator('[data-basket-status]')).toHaveText('할 일은 만들었지만 메모에 기록하지 못했어요.');
 await expect(detail.locator('[data-manual-task]')).toHaveCount(0);await expect(detail.locator('[data-basket-note-tasks]')).toBeHidden();
 // One task, at most two guarded writes (one re-read after a lost race), nothing else.
 expect(f.home.tasks).toHaveLength(6);expect(f.patches.length).toBeLessThanOrEqual(2);expect(f.note.metadata).toEqual({keep:'그대로'});
 expect(f.errors).toEqual([]);
});

test('a record that lands after an account switch is not shown',async({page})=>{
 const f=await fixture(page),detail=await openNote(page,1280);
 let release;f.db.hold=new Promise(r=>release=r);
 const reached=page.waitForRequest(r=>r.method()==='PATCH'&&r.url().includes('/rest/v1/app_notes'));
 await makeTask(page,detail,1280);await reached;
 await expect(detail.locator('[data-basket-status]')).toHaveText('');
 await page.evaluate(()=>{const rt=window.KPTURuntime;const c=rt.context.read();rt.context.set({...c,workspace:{...c.workspace,id:'other-workspace'}});window.dispatchEvent(new CustomEvent('kptu:session-changed',{detail:{session:rt.session.read()}}));});
 await expect(page.locator('[data-basket-detail]')).toBeHidden();
 const done=page.waitForResponse(r=>r.request().method()==='PATCH'&&r.url().includes('/rest/v1/app_notes'));release();await done;
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,50))));
 await expect(page.locator('[data-basket-detail]')).toBeHidden();await expect(page.locator('[data-basket-status]')).toHaveCount(0);await expect(page.locator('[data-basket-note-tasks]')).toHaveCount(0);
 expect(f.home.tasks).toHaveLength(6);expect(f.errors).toEqual([]);
});

test('a source-note address opens the note on a full load',async({page})=>{
 await fixture(page,{metadata:{tasks:[{task_id:'today',task_list_id:'default',title:'오늘 항목',created_at:'2026-10-01T00:00:00.000Z'}]}});
 await page.evaluate(()=>window.KPTURouter.go('tasks'));
 const link=page.locator('[data-google-task="today"] [data-gt-source-note]');await expect(link).toHaveAttribute('href',`./?view=basket&note=${n}`);
 await page.goto(new URL(`./?view=basket&note=${n}`,page.url()).href);
 await expect(page.locator('[data-basket-read-text]')).toContainText('10/20 기자회견 준비 회의');await expect(page.locator('[data-basket-note-tasks]')).toContainText('오늘 항목');
});
