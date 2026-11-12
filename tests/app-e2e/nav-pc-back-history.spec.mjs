// NAV-PC뒤로직전(명진 결정 11/11 15:37 '(나) 직전 화면 무조건 직전화면 b지부'): PC '목록 | 상세' 화면에서 사람이 누른 항목 바뀜이
// 뒤로가기 기록이 된다. A → B → C 에서 ‹ = B, ‹ = A, ‹ = 그 전 화면, › 는 같은 기록을 앞으로. 화면이 처음 들어올 때 스스로 연
// 항목은 기록하지 않는다. 기록은 라우터 한 곳(KPTURouter.pick)이 맡는다. 돌아간 항목이 지워졌으면 목록만(오류 없음).
// 폰 뒤로가기(상세 창·겹 닫기)는 그대로. 이름·내용은 모두 지어낸 것.
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {openEmphasisFixture} from './helpers/calendar-task-emphasis.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-09-15T01:00:00Z',owner='home-test';
const topBack=page=>page.locator('[data-history-step="back"]');
const topForward=page=>page.locator('[data-history-step="forward"]');

// ── 조직 보고(담당조직) ──
const orgs=[
 {id:'oa',workspace_id:'w',name:'합성 가 지부',active:true,created_by:owner,updated_at:stamp},
 {id:'ob',workspace_id:'w',name:'합성 나 지부',active:true,created_by:owner,updated_at:stamp},
 {id:'oc',workspace_id:'w',name:'합성 다 지부',active:true,created_by:owner,updated_at:stamp},
 {id:'od',workspace_id:'w',name:'합성 라 지부',active:true,created_by:owner,updated_at:stamp}
];
async function orgFixture(page,{width=1280}={}){
 await page.setViewportSize({width,height:800});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openHome(page);
 const state={orgs:[...orgs]};
 await page.route(SB+'/rest/v1/app_suborganizations?**',route=>{const q=new URL(route.request().url()).searchParams,id=q.get('id');return route.fulfill({json:id?state.orgs.filter(o=>'eq.'+o.id===id):state.orgs})});
 await page.route(SB+'/rest/v1/app_suborganization_assignees?**',route=>{const q=new URL(route.request().url()).searchParams;return route.fulfill({json:q.get('user_id')?[{user_id:owner}]:state.orgs.map(o=>({organization_id:o.id,user_id:owner}))})});
 await page.route(SB+'/rest/v1/app_suborganization_updates?**',route=>route.fulfill({json:[]}));
 await page.route(SB+'/rest/v1/app_record_links?**',route=>route.fulfill({json:[]}));
 return {state,errors};
}
const orgTitle=page=>page.locator('#wdTitle');
const orgRow=(page,id)=>page.locator(`#soOrganizationList [data-so-org="${id}"]`);

test('PC 1280 조직 보고: B → C → D 에서 ‹ = C, ‹ = B, ‹ = 그 전 화면, › = B → C (머리줄 ‹ › 와 브라우저 뒤로가 같다)',async({page})=>{
 const {errors}=await orgFixture(page);
 await clickView(page,'calendar');await expect(page.locator('#calendarView')).toBeVisible();
 await clickView(page,'team');
 // 화면이 스스로 연 첫 조직(맨 위)은 기록하지 않는다.
 await expect(orgTitle(page)).toHaveText('합성 가 지부');
 const start=await page.evaluate(()=>history.length);
 await orgRow(page,'ob').click();await expect(orgTitle(page)).toHaveText('합성 나 지부');
 await orgRow(page,'oc').click();await expect(orgTitle(page)).toHaveText('합성 다 지부');
 await orgRow(page,'od').click();await expect(orgTitle(page)).toHaveText('합성 라 지부');
 await expect(page).toHaveURL(/[?&]org=od(?:&|$)/);
 // 첫 고르기는 그 화면 칸에 적고, 그다음부터 한 칸씩: 기록은 2칸 늘었다.
 expect(await page.evaluate(()=>history.length)).toBe(start+2);
 await topBack(page).click();await expect(orgTitle(page)).toHaveText('합성 다 지부');await expect(page).toHaveURL(/[?&]org=oc(?:&|$)/);
 await expect(orgRow(page,'oc')).toHaveAttribute('aria-current','true');
 await page.goBack();await expect(orgTitle(page)).toHaveText('합성 나 지부');
 await topBack(page).click();await expect(page.locator('#calendarView')).toBeVisible();
 // › 는 같은 기록을 앞으로: 조직 보고(나 지부) → 다 지부.
 await topForward(page).click();await expect(page.locator('#teamView')).toBeVisible();await expect(orgTitle(page)).toHaveText('합성 나 지부');
 await topForward(page).click();await expect(orgTitle(page)).toHaveText('합성 다 지부');
 // 같은 줄을 다시 누르면 기록이 늘지 않는다.
 const now=await page.evaluate(()=>history.length);
 await orgRow(page,'oc').click();expect(await page.evaluate(()=>history.length)).toBe(now);
 expect(errors).toEqual([]);
});

test('PC 1280 조직 보고: 돌아간 조직이 지워졌으면 오류 없이 목록만',async({page})=>{
 const {state,errors}=await orgFixture(page);
 await clickView(page,'team');await expect(orgTitle(page)).toHaveText('합성 가 지부');
 await orgRow(page,'ob').click();await expect(orgTitle(page)).toHaveText('합성 나 지부');
 await orgRow(page,'oc').click();await expect(orgTitle(page)).toHaveText('합성 다 지부');
 // 나 지부가 다른 곳에서 지워지고 목록을 다시 읽었다.
 state.orgs=state.orgs.filter(o=>o.id!=='ob');
 await page.evaluate(()=>window.__KPTU_RELOAD_SUBORGANIZATIONS__());
 await expect(orgRow(page,'ob')).toHaveCount(0);
 await page.goBack();
 await expect(page.locator('#teamView')).toBeVisible();
 await expect(page.locator('#wdDetailPane')).not.toHaveClass(/has-org/);
 await expect(page.locator('#soOrganizationList [data-so-org][aria-current="true"]')).toHaveCount(0);
 expect(errors).toEqual([]);
});

test('폰 412 조직 보고: 지금처럼 상세 창 하나 — 뒤로 = 창 닫기(목록), 고른 조직 기록은 쌓지 않는다',async({page})=>{
 const {errors}=await orgFixture(page,{width:412});
 await page.evaluate(()=>window.KPTURouter.go('team'));
 await orgRow(page,'ob').click();await expect(page.locator('#wdModal')).toBeVisible();await expect(page.locator('#wdModal')).toHaveAttribute('role','dialog');
 expect(await page.evaluate(()=>history.state?.kptuPick||null)).toBe(null);
 await page.evaluate(()=>window.KPTURouter.back());
 await expect(page.locator('#wdModal')).toBeHidden();await expect(page.locator('#teamView')).toBeVisible();
 expect(errors).toEqual([]);
});

// ── 할 일 ──
const NOW=Date.parse('2026-10-08T03:00:00Z');
const task=(id,due=null)=>({id,title:'할 일 '+id,taskListId:'@default',taskListTitle:'내 할 일',due,status:'needsAction',notes:''});
async function openTasks(page,width,tasks){
 await page.setViewportSize({width,height:820});
 await openEmphasisFixture(page,{view:'list',now:NOW,events:[],tasks,projects:[],orgs:[],links:[]});
 await page.route('**/functions/v1/google-tasks**',async route=>{
  const action=new URL(route.request().url()).searchParams.get('action');
  const ok=json=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(json)});
  if(action==='links')return ok({links:[],meeting_links:[]});
  return ok({connected:true,authorized:true,needs_reconnect:false,tasks,pending_scope:'all'});
 });
 await page.evaluate(()=>window.KPTURouter.go('calendar'));await expect(page.locator('#calendarView')).toBeVisible();
 await page.evaluate(()=>window.KPTURouter.go('tasks'));
 await expect(page.locator('[data-gt-count]')).toHaveText(`할 일 ${tasks.length}개`);
}

test('PC 1280 할 일: a → b → c 에서 ‹ = b, ‹ = a, ‹ = 요약(목록만), ‹ = 그 전 화면, › = 요약 → a → b',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openTasks(page,1280,[task('a','2026-10-08'),task('b','2026-10-08'),task('c','2026-10-09')]);
 const titleField=page.locator('#gtEditTitle'),pane=page.locator('#gtDetailPane');
 for(const id of ['a','b','c']){await page.locator(`[data-gt-edit="${id}"]`).click();await expect(titleField).toHaveValue('할 일 '+id)}
 await expect(page).toHaveURL(/[?&]task=c(?:&|$)/);
 await topBack(page).click();await expect(titleField).toHaveValue('할 일 b');
 await expect(page.locator('#gtTaskBody .gt-row.is-selected [data-gt-edit="b"]')).toHaveCount(1);
 await page.goBack();await expect(titleField).toHaveValue('할 일 a');
 // 아무것도 안 고른 요약 상태가 한 칸(폰 뒤로가기처럼 상세를 닫음).
 await topBack(page).click();await expect(pane).not.toHaveClass(/has-task/);await expect(page.locator('#tasksView')).toBeVisible();
 await expect(page).not.toHaveURL(/[?&]task=/);
 await topBack(page).click();await expect(page.locator('#calendarView')).toBeVisible();
 await topForward(page).click();await expect(page.locator('#tasksView')).toBeVisible();await expect(pane).not.toHaveClass(/has-task/);
 await topForward(page).click();await expect(titleField).toHaveValue('할 일 a');
 await topForward(page).click();await expect(titleField).toHaveValue('할 일 b');
 expect(errors).toEqual([]);
});

// ── 노트(폴더 나무 | 노트) ──
const U=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const at='2026-10-05T01:00:00Z';
const note=(id,raw_text,extra={})=>({id,workspace_id:'w',kind:'note',title:raw_text,journal_day:null,raw_text,occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{},...extra});
async function bootNotes(page){
 await page.setViewportSize({width:1280,height:900});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const rows=[note('n1','가 노트'),note('n2','나 노트',{metadata:{folder:'회의'}}),note('n3','다 노트',{metadata:{folder:'교육'}})];
 const folders=[{id:U(1),workspace_id:'w',parent_id:null,name:'회의',sort_order:1024,created_at:at},{id:U(2),workspace_id:'w',parent_id:null,name:'교육',sort_order:2048,created_at:at}];
 await openHome(page,{beforeLoad:async()=>{
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',r=>{
   const q=new URL(r.request().url()).searchParams;
   const pick=x=>(!q.get('kind')||q.get('kind')==='eq.'+x.kind||(q.get('kind').startsWith('in.(')&&q.get('kind').slice(4,-1).split(',').includes(x.kind)))&&(!q.get('id')||q.get('id')==='eq.'+x.id);
   return r.request().method()==='GET'?r.fulfill({json:rows.filter(pick).map(x=>structuredClone(x))}):r.fulfill({json:[]});
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_note_folders',r=>r.fulfill({json:r.request().method()==='GET'?structuredClone(folders):[]}));
 }});
 return errors;
}
// PC 나무의 폴더 줄은 펼침·접힘만 하므로 들어가기는 그 폴더 ⋯ 메뉴의 [이 폴더로 들어가기].
async function enterFolder(page,name){
 await page.locator('[data-nx-tree]').getByRole('button',{name:`${name} 폴더 메뉴`}).click();
 await page.locator('[data-nx-enter]').click();
}

test('PC 1280 노트: 회의 → 교육 → 폴더 없음 에서 ‹ = 교육, ‹ = 회의, ‹ = 최근, ‹ = 그 전 화면, › = 최근 → 회의',async({page})=>{
 const errors=await bootNotes(page);
 await page.evaluate(()=>window.KPTURouter.go('calendar'));await expect(page.locator('#calendarView')).toBeVisible();
 await page.evaluate(()=>window.KPTURouter.go('basket',{sub:'note'}));
 await expect(page.locator('#basketView')).toHaveAttribute('data-kind','note');
 await expect(page.locator('[data-nx-tree] [data-nx-folder]').first()).toBeVisible();
 await enterFolder(page,'회의');await expect(page).toHaveURL(new RegExp(`[?&]folder=${U(1)}(?:&|$)`));
 await enterFolder(page,'교육');await expect(page).toHaveURL(new RegExp(`[?&]folder=${U(2)}(?:&|$)`));
 await page.locator('[data-nx-tree] [data-nx-outside]').first().click();await expect(page).toHaveURL(/[?&]folder=out(?:&|$)/);
 await topBack(page).click();await expect(page).toHaveURL(new RegExp(`[?&]folder=${U(2)}(?:&|$)`));
 await expect(page.locator('[data-note-host] [data-note-row="n3"]')).toBeVisible();
 await page.goBack();await expect(page).toHaveURL(new RegExp(`[?&]folder=${U(1)}(?:&|$)`));
 await expect(page.locator('[data-note-host] [data-note-row="n2"]')).toBeVisible();
 await topBack(page).click();await expect(page).not.toHaveURL(/[?&]folder=/);await expect(page.locator('#basketView')).toHaveAttribute('data-kind','note');
 await topBack(page).click();await expect(page.locator('#calendarView')).toBeVisible();
 await topForward(page).click();await expect(page.locator('#basketView')).toHaveAttribute('data-kind','note');await expect(page).not.toHaveURL(/[?&]folder=/);
 await topForward(page).click();await expect(page).toHaveURL(new RegExp(`[?&]folder=${U(1)}(?:&|$)`));
 await expect(page.locator('[data-note-host] [data-note-row="n2"]')).toBeVisible();
 expect(errors).toEqual([]);
});
