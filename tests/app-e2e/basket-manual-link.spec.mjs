import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-10-06T01:00:00Z',changedStamp='2026-10-06T02:00:00Z';
const n='10000000-0000-4000-8000-000000000001',p='20000000-0000-4000-8000-000000000001',o='30000000-0000-4000-8000-000000000001',o2='30000000-0000-4000-8000-000000000002';
const RAW='10/20 기자회견 준비 회의\n장소: 본사 앞\n참석 30명';
async function fixture(page,{linked=[]}={}){
 await openHome(page);const errors=[],calls=[],tasks=[],note={id:n,workspace_id:'w',occurred_at:stamp,updated_at:stamp,raw_text:RAW,ai_export_allowed:true,archived_at:null,attachments:[]};
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 const links=linked.map((row,i)=>({id:'40000000-0000-4000-8000-00000000009'+i,workspace_id:'w',note_id:n,status:'confirmed',summary:'이전 요약',...row}));
 const tables={app_notes:[note],app_suborganizations:[{id:o,workspace_id:'w',name:'합성 한빛지부',active:true},{id:o2,workspace_id:'w',name:'합성 새벽지부',active:true}],app_suborganization_assignees:[{organization_id:o,user_id:'home-test'},{organization_id:o2,user_id:'home-test'}],app_spaces:[{id:p,workspace_id:'w',owner_id:'home-test',name:'합성 기자회견 준비',status:'active',metadata:{project_system:'v2'}}],app_suborganization_updates:[]};
 for(const [table,items] of Object.entries(tables))await page.route(SB+'/rest/v1/'+table+'?**',route=>{
  const q=new URL(route.request().url()).searchParams;let rows=items;
  // BASKET-할일출처: metadata-only PATCH guarded by the original's version.
  if(table==='app_notes'&&route.request().method()==='PATCH'){
   if(q.get('updated_at')!=='eq.'+note.updated_at)return route.fulfill({json:[]});
   note.metadata=route.request().postDataJSON().metadata;return route.fulfill({json:[note]});
  }
  for(const key of ['id','organization_id']){const filter=q.get(key);if(filter?.startsWith('eq.'))rows=rows.filter(x=>x[key]===filter.slice(3));}
  return route.fulfill({json:rows.slice(Number(q.get('offset')||0),Number(q.get('offset')||0)+Number(q.get('limit')||rows.length))});
 });
 await page.route(SB+'/rest/v1/app_record_links?**',route=>{
  const q=new URL(route.request().url()).searchParams;let rows=q.has('google_task_id')?[]:links;
  for(const key of ['id','organization_id','project_id','note_id']){const filter=q.get(key);if(filter?.startsWith('eq.'))rows=rows.filter(x=>x[key]===filter.slice(3));}
  const names={[o]:'합성 한빛지부',[o2]:'합성 새벽지부'};
  return route.fulfill({json:rows.map(row=>({...row,note,organization:row.organization_id?{name:names[row.organization_id]}:null,project:row.project_id?{name:'합성 기자회견 준비'}:null}))});
 });
 const rpc={next:null};
 await page.route(SB+'/rest/v1/rpc/app_basket_confirm_links',route=>{
  const body=route.request().postDataJSON();calls.push(body);
  if(rpc.next){const reply=rpc.next;rpc.next=null;if(reply.error==='NOTE_CHANGED')note.updated_at=changedStamp;return route.fulfill({json:reply});}
  if(body.p_note_updated_at!==note.updated_at)return route.fulfill({json:{ok:false,error:'NOTE_CHANGED',created:0,existing:0}});
  for(const target of body.p_targets)links.push({id:'40000000-0000-4000-8000-'+String(links.length+1).padStart(12,'0'),workspace_id:'w',note_id:n,status:'confirmed',summary:target.summary,[target.kind==='project'?'project_id':'organization_id']:target.target_id});
  return route.fulfill({json:{ok:true,created:body.p_targets.length,existing:0}});
 });
 const google={fail:0};
 await page.route(SB+'/functions/v1/google-tasks?action=create',route=>{
  const body=route.request().postDataJSON();tasks.push(body);
  if(google.fail){google.fail--;return route.fulfill({status:502,json:{message:'QA 실패'}});}
  return route.fulfill({json:{ok:true,task:{id:'made-'+tasks.length,taskListId:'@default',title:body.title,notes:body.notes,due:body.due,status:'needsAction'},links:body.links.map(l=>({...l,status:'confirmed'})),meeting_links:[]}});
 });
 return {note,links,calls,tasks,errors,rpc,google};
}
async function tap(page,locator,width){await expect(locator).toBeVisible();if(width<761){await locator.scrollIntoViewIfNeeded();const b=await locator.boundingBox();await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);}else await locator.click();}
async function openNote(page,width){
 await page.evaluate(()=>window.KPTURouter.go('basket'));await page.locator('[data-basket-filter="all"]').click();
 await tap(page,page.locator(`[data-basket-row="${n}"]`),width);await expect(page.locator('[data-basket-read-text]')).toBeVisible();
 return page.locator('[data-basket-detail]');
}
async function pick(page,detail,kind,name,width){
 await tap(page,detail.locator(`[data-manual-pick="${kind}"]`),width);
 const sheet=page.locator('#basketLinkChoiceSheet');await expect(sheet).toBeVisible();
 await tap(page,sheet.getByRole('button',{name,exact:true}),width);await expect(sheet).toBeHidden();
}
const summary=(detail,id,kind)=>detail.locator(`[data-manual-summary="${kind}:${id}"]`);
const noWideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);

for(const width of [390,1280])test(`one organization linked by hand shows its written summary in the organization ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});const f=await fixture(page),detail=await openNote(page,width);
 await tap(page,detail.getByRole('button',{name:'연결하기'}),width);
 await expect(detail.locator('[data-basket-read-actions]')).toBeHidden();await expect(detail.locator('[data-basket-edit]')).toBeHidden();
 await pick(page,detail,'organization','합성 한빛지부',width);
 const box=summary(detail,o,'organization');await expect(box).toHaveValue('');await expect(box).toHaveAttribute('placeholder','일시·장소·누가·숫자를 빠짐없이');await expect(box).toBeFocused();
 await detail.locator('[data-manual-original] summary').click();await expect(detail.locator('[data-manual-original]')).toContainText('참석 30명');
 await box.fill('10/20 14시 본사 앞 기자회견, 한빛지부 30명 참석');
 expect(await noWideScroll(page)).toBe(true);
 if(width===390)await page.screenshot({path:info.outputPath('manual-link-panel-390.png'),fullPage:true});
 await page.evaluate(()=>{window.__linkEvents=0;addEventListener('kptu:basket-links-changed',()=>window.__linkEvents++);});
 await tap(page,detail.getByRole('button',{name:'연결',exact:true}),width);
 await expect(detail.locator('[data-basket-status]')).toHaveText('1곳에 연결했어요.');await expect(detail.locator('[data-manual-link]')).toHaveCount(0);
 await expect(detail.locator('[data-basket-state]')).toContainText('담당조직: 합성 한빛지부');await expect(detail.locator('[data-basket-link-open]')).toBeFocused();
 expect(f.calls).toEqual([{p_note_id:n,p_note_updated_at:stamp,p_targets:[{kind:'organization',target_id:o,reason:'직접 연결',summary:'10/20 14시 본사 앞 기자회견, 한빛지부 30명 참석'}]}]);
 expect(await page.evaluate(()=>window.__linkEvents)).toBe(1);
 await tap(page,detail.locator('[data-basket-close]'),width);await page.locator('[data-basket-filter="unclassified"]').click();await expect(page.locator(`[data-basket-row="${n}"]`)).toHaveCount(0);
 await page.evaluate(async id=>{await window.KPTUViewLoader.load('team');await window.KPTUWorkplace.open(id);},o);await expect(page.locator('#wdModal')).toBeVisible();
 await expect(page.locator('#wdUpdates')).toContainText('10/20 14시 본사 앞 기자회견, 한빛지부 30명 참석');expect(f.errors).toEqual([]);
});

test('organization and project linked together in one call, each with its own summary',async({page})=>{
 const f=await fixture(page),detail=await openNote(page,1280);await detail.getByRole('button',{name:'연결하기'}).click();
 await pick(page,detail,'organization','합성 한빛지부',1280);await pick(page,detail,'project','합성 기자회견 준비',1280);
 await summary(detail,o,'organization').fill('조직 요약');await summary(detail,p,'project').fill('프로젝트 요약');
 await detail.getByRole('button',{name:'연결',exact:true}).click();await expect(detail.locator('[data-basket-status]')).toHaveText('2곳에 연결했어요.');
 expect(f.calls).toHaveLength(1);expect(f.calls[0].p_targets).toEqual([{kind:'organization',target_id:o,reason:'직접 연결',summary:'조직 요약'},{kind:'project',target_id:p,reason:'직접 연결',summary:'프로젝트 요약'}]);
 await expect(detail.locator('[data-basket-state]')).toContainText('프로젝트: 합성 기자회견 준비');expect(f.errors).toEqual([]);
});

test('an already linked place is shown as linked and cannot be chosen again; a removed pick is not sent',async({page})=>{
 const f=await fixture(page,{linked:[{organization_id:o}]}),detail=await openNote(page,1280);await detail.getByRole('button',{name:'연결하기'}).click();
 await detail.locator('[data-manual-pick="organization"]').click();const sheet=page.locator('#basketLinkChoiceSheet');await expect(sheet).toBeVisible();
 await expect(sheet.getByText('합성 한빛지부 · 이미 연결됨')).toBeVisible();await expect(sheet.getByRole('button',{name:/합성 한빛지부/})).toHaveCount(0);
 await sheet.getByText('합성 한빛지부 · 이미 연결됨').click();await expect(sheet).toBeVisible();await expect(detail.locator('[data-manual-target]')).toHaveCount(0);
 await sheet.getByRole('button',{name:'합성 새벽지부',exact:true}).click();await expect(sheet).toBeHidden();
 await pick(page,detail,'project','합성 기자회견 준비',1280);await detail.getByRole('button',{name:'합성 기자회견 준비 빼기'}).click();
 await summary(detail,o2,'organization').fill('새벽지부 요약');await detail.getByRole('button',{name:'연결',exact:true}).click();
 await expect(detail.locator('[data-basket-status]')).toHaveText('1곳에 연결했어요.');expect(f.calls[0].p_targets).toEqual([{kind:'organization',target_id:o2,reason:'직접 연결',summary:'새벽지부 요약'}]);expect(f.errors).toEqual([]);
});

test('an empty summary or no pick never calls the database',async({page})=>{
 const f=await fixture(page),detail=await openNote(page,1280);await detail.getByRole('button',{name:'연결하기'}).click();
 await detail.getByRole('button',{name:'연결',exact:true}).click();await expect(detail.locator('[data-manual-status]')).toHaveText('연결할 담당조직이나 프로젝트를 골라 주세요.');
 await pick(page,detail,'organization','합성 한빛지부',1280);await summary(detail,o,'organization').fill('   ');
 await detail.getByRole('button',{name:'연결',exact:true}).click();await expect(detail.locator('[data-manual-status]')).toHaveText('합성 한빛지부: 기록 요약을 입력해 주세요.');
 await expect(summary(detail,o,'organization')).toBeFocused();expect(f.calls).toEqual([]);expect(f.errors).toEqual([]);
});

test('a note changed meanwhile is reloaded with the picks and summaries kept, then linked with the new version',async({page})=>{
 const f=await fixture(page),detail=await openNote(page,1280);await detail.getByRole('button',{name:'연결하기'}).click();
 await pick(page,detail,'organization','합성 한빛지부',1280);await summary(detail,o,'organization').fill('바뀌기 전에 쓴 요약');
 f.rpc.next={ok:false,error:'NOTE_CHANGED',created:0,existing:0};f.note.raw_text=RAW+'\n추가된 줄';
 await detail.getByRole('button',{name:'연결',exact:true}).click();
 await expect(detail.locator('[data-manual-status]')).toHaveText('메모가 그사이 바뀌었어요. 최신 메모를 다시 불러왔어요. 원문을 확인하고 다시 [연결]을 눌러 주세요.');
 await expect(detail.locator('[data-basket-read-text]')).toContainText('추가된 줄');await expect(summary(detail,o,'organization')).toHaveValue('바뀌기 전에 쓴 요약');expect(f.links).toHaveLength(0);
 await detail.getByRole('button',{name:'연결',exact:true}).click();await expect(detail.locator('[data-basket-status]')).toHaveText('1곳에 연결했어요.');
 expect(f.calls.map(c=>c.p_note_updated_at)).toEqual([stamp,changedStamp]);expect(f.errors).toEqual([]);
});

test('cancel asks only when something was picked, and leaving the view asks about the draft',async({page})=>{
 const f=await fixture(page),detail=await openNote(page,1280);
 await detail.getByRole('button',{name:'연결하기'}).click();page.on('dialog',()=>{throw Error('unexpected dialog');});
 await detail.getByRole('button',{name:'취소'}).click();await expect(detail.locator('[data-manual-link]')).toHaveCount(0);await expect(detail.locator('[data-basket-link-open]')).toBeFocused();
 page.removeAllListeners('dialog');
 await detail.getByRole('button',{name:'연결하기'}).click();await pick(page,detail,'organization','합성 한빛지부',1280);await summary(detail,o,'organization').fill('쓰던 요약');
 const asked=[];page.once('dialog',d=>{asked.push(d.message());d.dismiss();});await detail.getByRole('button',{name:'취소'}).click();
 await expect(summary(detail,o,'organization')).toHaveValue('쓰던 요약');
 page.once('dialog',d=>{asked.push(d.message());d.dismiss();});await page.evaluate(()=>window.KPTURouter.go('home'));
 await expect(page.locator('#basketView')).toBeVisible();await expect(summary(detail,o,'organization')).toHaveValue('쓰던 요약');
 page.once('dialog',d=>{asked.push(d.message());d.accept();});await page.keyboard.press('Escape');await expect(detail.locator('[data-manual-link]')).toHaveCount(0);
 expect(asked).toEqual(['고른 곳과 쓰던 요약을 버리고 닫을까요?','작성 중인 연결·할 일 입력을 버리고 다른 화면으로 갈까요?','고른 곳과 쓰던 요약을 버리고 닫을까요?']);
 expect(f.calls).toEqual([]);expect(f.errors).toEqual([]);
});

for(const width of [390,1280])test(`a Google task is made from the note with the home quick input options ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});const f=await fixture(page),detail=await openNote(page,width);
 await tap(page,detail.getByRole('button',{name:'할 일 만들기'}),width);
 await expect(detail.locator('[data-manual-task-title]')).toHaveValue('10/20 기자회견 준비 회의');await expect(detail.locator('[data-manual-task-notes]')).toHaveValue(RAW);
 await detail.locator('[data-manual-task-title]').fill('기자회견 장소 확정');
 await tap(page,detail.locator('[data-manual-task-day="tomorrow"]'),width);await expect(detail.locator('[data-manual-task-day="tomorrow"]')).toHaveAttribute('aria-pressed','true');
 await tap(page,detail.locator('[data-manual-task-project]'),width);const sheet=page.locator('#basketLinkChoiceSheet');await tap(page,sheet.getByRole('button',{name:'합성 기자회견 준비'}),width);await expect(sheet).toBeHidden();
 await expect(detail.locator('[data-manual-task-project]')).toHaveText('합성 기자회견 준비 ▾');await expect(detail).toContainText('만든 할 일은 이 메모의 ‘이 메모로 만든 할 일’에 기록돼요.');
 expect(await noWideScroll(page)).toBe(true);
 if(width===390)await page.screenshot({path:info.outputPath('manual-task-form-390.png'),fullPage:true});
 await tap(page,detail.getByRole('button',{name:'할 일 만들기',exact:true}),width);
 await expect(detail.locator('[data-basket-status]')).toHaveText('Google 할 일을 만들었어요. 이 메모에 기록했어요.');await expect(detail.locator('[data-manual-task]')).toHaveCount(0);
 expect(f.tasks).toEqual([{action:'create',task_id:null,title:'기자회견 장소 확정',notes:RAW,due:'2026-10-07',links:[{project_id:p}]}]);
 expect(f.calls).toEqual([]);expect(f.errors).toEqual([]);
});

test('an unclear task result is never retried by itself; checking the list unlocks a retry only when nothing was made',async({page})=>{
 const f=await fixture(page),detail=await openNote(page,1280);f.google.fail=1;
 await detail.getByRole('button',{name:'할 일 만들기'}).click();await detail.getByRole('button',{name:'할 일 만들기',exact:true}).click();
 await expect(detail.locator('[data-manual-task-status]')).toHaveText('할 일을 만들었는지 확인하지 못했어요. 겹치지 않게 다시 만들지 않아요. 할 일 목록에서 확인해 주세요.');
 await expect(detail.locator('[data-manual-task-save]')).toBeDisabled();expect(f.tasks).toHaveLength(1);
 await detail.getByRole('button',{name:'할 일 목록에서 확인'}).click();
 await expect(detail.locator('[data-manual-task-status]')).toHaveText('목록에서 찾지 못했어요. 입력을 확인한 뒤 다시 [할 일 만들기]를 눌러 주세요.');
 await detail.getByRole('button',{name:'할 일 만들기',exact:true}).click();await expect(detail.locator('[data-basket-status]')).toHaveText('Google 할 일을 만들었어요. 이 메모에 기록했어요.');
 expect(f.tasks).toHaveLength(2);expect(f.errors.filter(e=>!/502/.test(e))).toEqual([]);
});

test('a late link result after a workspace or account switch is not painted, and the view stays put while linking',async({page})=>{
 const f=await fixture(page),detail=await openNote(page,1280);await detail.getByRole('button',{name:'연결하기'}).click();
 await pick(page,detail,'organization','합성 한빛지부',1280);await summary(detail,o,'organization').fill('늦은 요약');
 let release;const held=new Promise(r=>release=r);await page.route(SB+'/rest/v1/rpc/app_basket_confirm_links',async route=>{await held;await route.fallback();});
 await detail.getByRole('button',{name:'연결',exact:true}).click();await expect(detail.getByRole('button',{name:'연결',exact:true})).toBeDisabled();
 await page.evaluate(()=>window.KPTURouter.go('home'));await expect(page.locator('#basketView')).toBeVisible();await expect(summary(detail,o,'organization')).toHaveValue('늦은 요약');
 await page.evaluate(()=>{const rt=window.KPTURuntime;const c=rt.context.read();rt.context.set({...c,workspace:{...c.workspace,id:'other-workspace'}});window.dispatchEvent(new CustomEvent('kptu:session-changed',{detail:{session:rt.session.read()}}));});
 await expect(page.locator('[data-basket-detail]')).toBeHidden();
 const done=page.waitForResponse(r=>r.url().endsWith('/app_basket_confirm_links'));release();await done;
 await expect(page.locator('[data-manual-link]')).toHaveCount(0);await expect(page.locator('[data-basket-detail]')).toBeHidden();await expect(page.locator('[data-basket-status]')).toHaveCount(0);
 expect(f.calls).toHaveLength(1);expect(f.errors).toEqual([]);
});

test('the task form is not rebuilt when the project list arrives, so a tap in progress keeps its button',async({page})=>{
 const f=await fixture(page),detail=await openNote(page,1280);
 let release;const held=new Promise(r=>release=r);await page.route(SB+'/rest/v1/app_spaces?**',async route=>{await held;await route.fallback();});
 const loaded=page.waitForResponse(r=>r.url().includes('/rest/v1/app_spaces'));
 await detail.getByRole('button',{name:'할 일 만들기'}).click();await detail.locator('[data-manual-task-title]').fill('쓰는 중');
 await page.evaluate(()=>{document.querySelector('[data-manual-task-day="tomorrow"]').dataset.marker='same';document.querySelector('[data-manual-task-title]').dataset.marker='same';});
 release();await loaded;await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0))));
 await expect(detail.locator('[data-manual-task-day="tomorrow"][data-marker="same"]')).toHaveCount(1);
 await expect(detail.locator('[data-manual-task-title][data-marker="same"]')).toHaveValue('쓰는 중');await expect(detail.locator('[data-manual-task-title]')).toBeFocused();
 await expect(detail.locator('[data-manual-task-project]')).toHaveText('프로젝트 ▾');expect(f.errors).toEqual([]);
});
