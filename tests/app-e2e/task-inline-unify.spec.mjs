import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {laidOutBox} from './helpers/laid-out.mjs';
// TASK-바로처리통일 (2026-10-23 사용자 결정 00:06): 업무일지 할 일 / 한 일의 바로 처리(동그라미 완료 + 5초 [되돌리기], 줄 ⋯ = 내일로 · 기한 바꾸기 ·
// 고치기 · 지우기 / 끝낸 줄 다시 할 일로 · 고치기, PC hover·초점 줄에만 ⋯, 폰은 늘)를 홈 할 일 칸(HOME-업무일지홈: 홈 = 업무일지)·담당조직·프로젝트 상세 연결 할 일에도 같은
// 공용 부품(task-inline.js)으로. 담당조직·프로젝트의 [연결 해제]는 ⋯ 안에 그대로 남는다. 달력 날짜 목록은 task-ops-unify.spec.mjs, 업무일지는 journal.spec.mjs.
// 모의 자료만 쓴다(openHome). 이름은 모두 합성 값이다.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const opacity=loc=>loc.evaluate(e=>getComputedStyle(e).opacity);
// Google 할 일 요청만 기록하고 바꾼다(update·delete는 이 시험이 답하고, 나머지는 openHome 이 답한다).
async function taskCalls(page,c){
 const calls={update:[],delete:[],toggle:[],unlink:[]};
 await page.route(SB+'/functions/v1/google-tasks?**',route=>{
  const req=route.request(),a=new URL(req.url()).searchParams.get('action'),body=req.method()==='POST'?req.postDataJSON():null;
  if(a==='toggle')calls.toggle.push(body);
  if(a==='update'){calls.update.push(body);const t=c.tasks.find(x=>x.id===body.task_id);Object.assign(t,{title:body.title,notes:body.notes,due:body.due});return route.fulfill({json:{ok:true,task:{...t,due:body.due+'T00:00:00.000Z'}}});}
  if(a==='delete'){calls.delete.push(body);c.tasks.splice(c.tasks.findIndex(x=>x.id===body.task_id),1);return route.fulfill({json:{ok:true}});}
  return route.fallback();
 });
 return calls;
}

for(const width of [390,1280]){
 test(`홈 할 일 칸: 동그라미 완료 + 5초 되돌리기, 줄 ⋯(PC hover·초점 / 폰 늘), 내일로·기한 바꾸기·고치기·지우기 ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const c=await openHome(page);const calls=await taskCalls(page,c);
  const card=page.locator('#homeView [data-journal-group="todo"]'),row=card.locator('li[data-journal-task="today"]'),more=row.locator('[data-journal-task-menu]');
  const fold=card.locator('[data-journal-overdue]'),openFold=async()=>{if(!(await fold.evaluate(d=>d.open)))await fold.locator(':scope > summary').click();};
  await expect(row).toBeVisible();await expect(more).toBeEnabled();
  await expect(more).toHaveAccessibleName('오늘 항목 더 보기');
  // 작은 칸: 보이는 ⋯는 28px 안, 누르는 폭은 ::after 로 44px.
  // 홈 할 일 칸은 자료가 올 때마다 다시 그려진다(journal.js renderTasks). 붙어 있는 ⋯를 잰다.
  const b=await laidOutBox(more);expect(b.height).toBeLessThanOrEqual(32);expect(b.width).toBeLessThanOrEqual(32);
  if(width>=761){
   await page.mouse.move(5,5);await expect.poll(()=>opacity(more)).toBe('0');
   await row.hover();await expect.poll(()=>opacity(more)).toBe('1');
   await page.mouse.move(5,5);await expect.poll(()=>opacity(more)).toBe('0');
   await row.locator('.journal-item-open').focus();await expect.poll(()=>opacity(more)).toBe('1');
   await page.mouse.move(5,5);
  }else await expect.poll(()=>opacity(more)).toBe('1');
  // ⋯ 항목
  await row.hover();await more.click();
  const menu=page.locator('#journalTaskMenu');
  await expect(menu.getByRole('button')).toHaveText(['내일로','기한 바꾸기','고치기','지우기']);
  for(const btn of await menu.getByRole('button').all())expect((await btn.boundingBox()).height).toBeLessThanOrEqual(40);
  await page.screenshot({path:info.outputPath(`home-menu-${width}.png`)});
  // 고치기 = 할 일 화면의 수정 창
  await menu.getByRole('button',{name:'고치기'}).click();
  await expect(page.locator('#gtTaskModal')).toBeVisible();await expect(page.locator('#gtEditTitle')).toHaveValue('오늘 항목');
  await page.locator('#gtTaskModal [data-gt-close]').click();await expect(page.locator('#gtTaskModal')).toBeHidden();
  // 기한 바꾸기 = 달력 날짜 칸 → [바꾸기]: 수정 창과 같은 update, 제목·메모 그대로
  await row.hover();await more.click();await menu.getByRole('button',{name:'기한 바꾸기'}).click();
  const input=page.locator('#taskDuePopup [data-task-due-input]');
  await expect(input).toBeVisible();await expect(input).toHaveAttribute('type','date');await expect(input).toHaveValue('2026-10-06');
  await input.fill('2026-10-09');await page.locator('#taskDuePopup').getByRole('button',{name:'바꾸기'}).click();
  await expect.poll(()=>calls.update.length).toBe(1);
  expect(calls.update[0]).toEqual({action:'update',task_id:'today',task_list_id:'default',title:'오늘 항목',notes:'',due:'2026-10-09'});
  await expect(page.locator('#toast')).toHaveText("'오늘 항목' 기한을 10월 9일(금)로 바꿨어요.");
  // 그날 기한이 아니게 됐으니 홈 할 일 칸에서 빠진다.
  await expect(row).toHaveCount(0);
  // 동그라미: 지난 항목을 완료 → 5초 되돌리기 → 완료 취소
  // 동그라미: 기한 지난 것(접힌 줄 안)을 완료 → 한 일 칸으로 → 5초 되돌리기 → 다시 할 일
  const late=card.locator('li[data-journal-task="overdue"]'),doneLate=page.locator('#homeView [data-journal-group="done"] li[data-journal-task="overdue"]');
  await openFold();
  await late.locator('[data-journal-complete]').click();
  await expect(doneLate).toBeVisible();await expect(late).toHaveCount(0);
  const undo=page.locator('[data-undo-notice]');
  await expect(undo).toContainText("'지연 항목'을 끝냈어요.");
  await undo.getByRole('button',{name:'되돌리기'}).click();
  await expect(undo).toContainText('다시 할 일로 돌려놨어요.');
  await expect(doneLate).toHaveCount(0);await expect(late).toHaveCount(1);
  await expect.poll(()=>calls.toggle.map(x=>x.completed)).toEqual([true,false]);
  // 내일로
  await openFold();await late.hover();await late.locator('[data-journal-task-menu]').click();await menu.getByRole('button',{name:'내일로'}).click();
  await expect.poll(()=>calls.update.length).toBe(2);expect(calls.update[1].due).toBe('2026-10-07');
  await expect(page.locator('#toast')).toHaveText("'지연 항목' 기한을 내일로 옮겼어요.");
  expect(errors).toEqual([]);
 });
}

test('홈 할 일 칸 ⋯ 지우기: 확인 한 번, 취소하면 그대로, 확인하면 delete 요청 1번 390',async({page})=>{
 await page.setViewportSize({width:390,height:1000});
 const c=await openHome(page);const calls=await taskCalls(page,c);
 const row=page.locator('#homeView [data-journal-group="todo"] li[data-journal-task="today"]'),menu=page.locator('#journalTaskMenu');
 let accept=false;const dialogs=[];page.on('dialog',d=>{dialogs.push(d.message());void(accept?d.accept():d.dismiss());});
 await row.locator('[data-journal-task-menu]').click();await menu.getByRole('button',{name:'지우기'}).click();
 await expect.poll(()=>dialogs.length).toBe(1);expect(dialogs[0]).toBe('이 Google 할 일을 삭제할까요?');
 expect(calls.delete).toEqual([]);await expect(row).toBeVisible();
 accept=true;
 await row.locator('[data-journal-task-menu]').click();await menu.getByRole('button',{name:'지우기'}).click();
 await expect(row).toHaveCount(0);
 expect(calls.delete).toEqual([{action:'delete',task_list_id:'default',task_id:'today'}]);
 await expect(page.locator('#toast')).toHaveText('할 일을 삭제했어요.');
});

// 담당조직·프로젝트 상세: 연결된 할 일 줄도 같은 공용 줄. [연결 해제]는 ⋯ 안에 그대로.
const ORGS=[{id:'oa',workspace_id:'w',name:'합성 가 지부',active:true,created_by:'home-test',updated_at:'2026-09-15T01:00:00Z'}];
async function linkedFixture(page,width){
 await page.setViewportSize({width,height:900});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const c=await openHome(page);
 const state={tasks:[
  {id:'l-1',title:'합성 연결 할 일',taskListId:'@default',due:'2026-10-06T00:00:00.000Z',status:'needsAction',source:'google-task',notes:''},
  {id:'l-2',title:'합성 끝낸 일',taskListId:'@default',due:null,status:'completed',completed:'2026-10-05T01:00:00.000Z',source:'google-task'}],calls:{toggle:[],update:[],delete:[],unlink:[]}};
 const list=(route,rows)=>{const q=new URL(route.request().url()).searchParams;const o=Number(q.get('offset')||0);return route.fulfill({json:rows.slice(o,o+Number(q.get('limit')||rows.length||1))})};
 await page.route(SB+'/rest/v1/app_suborganizations?**',route=>{const q=new URL(route.request().url()).searchParams,id=q.get('id');return route.fulfill({json:id?ORGS.filter(o=>'eq.'+o.id===id):ORGS})});
 await page.route(SB+'/rest/v1/app_suborganization_assignees?**',route=>{const q=new URL(route.request().url()).searchParams;return route.fulfill({json:q.get('user_id')?[{user_id:'home-test'}]:ORGS.map(o=>({organization_id:o.id,user_id:'home-test'}))})});
 await page.route(SB+'/rest/v1/app_suborganization_updates?**',route=>list(route,[]));
 await page.route(SB+'/rest/v1/app_documents?**',route=>list(route,[]));
 await page.route(SB+'/functions/v1/google-tasks?**',route=>{
  const req=route.request(),a=new URL(req.url()).searchParams.get('action'),body=req.method()==='POST'?req.postDataJSON():null,find=id=>state.tasks.find(t=>t.id===id);
  if(a==='linked')return route.fulfill({json:{tasks:state.tasks.map(t=>({...t}))}});
  if(a==='toggle'){state.calls.toggle.push(body);const t=find(body.task_id);Object.assign(t,body.completed?{status:'completed',completed:'2026-10-06T01:00:00.000Z'}:{status:'needsAction',completed:null});return route.fulfill({json:{ok:true,task:{...t}}});}
  if(a==='update'){state.calls.update.push(body);const t=find(body.task_id);Object.assign(t,{title:body.title,notes:body.notes,due:body.due+'T00:00:00.000Z'});return route.fulfill({json:{ok:true,task:{...t}}});}
  if(a==='delete'){state.calls.delete.push(body);state.tasks=state.tasks.filter(t=>t.id!==body.task_id);return route.fulfill({json:{ok:true}});}
  if(a==='unlink'){state.calls.unlink.push(body);state.tasks=state.tasks.filter(t=>t.id!==body.task_id);return route.fulfill({json:{ok:true}});}
  return route.fallback();
 });
 return {c,state,errors};
}
for(const width of [390,1280])test(`담당조직 상세 연결 할 일: 동그라미 완료·되돌리기, ⋯(PC hover / 폰 늘) 항목, 연결 해제 유지, 기한 바꾸기·지우기 ${width}`,async({page},info)=>{
 const {state,errors}=await linkedFixture(page,width);
 await clickView(page,'team');
 if(width<761)await page.locator('#soOrganizationList [data-so-org="oa"]').click();
 const body=page.locator('#wdTaskBody'),row=body.locator('[data-google-task="l-1"]'),more=row.locator('[data-gt-linked-more]');
 await expect(row).toBeVisible();
 if(width>=761){
  await page.mouse.move(5,5);await expect.poll(()=>opacity(more)).toBe('0');
  await row.hover();await expect.poll(()=>opacity(more)).toBe('1');
 }else await expect.poll(()=>opacity(more)).toBe('1');
 await more.click();
 const menu=page.locator('#gtLinkedMenu');
 await expect(menu.getByRole('button')).toHaveText(['내일로','기한 바꾸기','고치기','연결 해제','지우기']);
 if(width<761)expect(await menu.evaluate(m=>!!m.closest('#wdModal'))).toBe(true);
 await page.screenshot({path:info.outputPath(`org-menu-${width}.png`)});
 await page.keyboard.press('Escape');await expect(menu).toBeHidden();
 // 끝낸 줄
 const done=body.locator('[data-google-task="l-2"]');await done.hover();await done.locator('[data-gt-linked-more]').click();
 await expect(menu.getByRole('button')).toHaveText(['다시 할 일로','고치기','연결 해제']);await page.keyboard.press('Escape');
 // 동그라미 → 되돌리기
 await row.locator('[data-gt-linked-toggle]').click();
 await expect(row).toHaveClass(/completed/);
 const undo=page.locator('[data-undo-notice]');await expect(undo).toContainText("'합성 연결 할 일'을 끝냈어요.");
 await undo.getByRole('button',{name:'되돌리기'}).click();
 await expect(body.locator('[data-google-task="l-1"]')).toHaveClass(/pending/);
 await expect.poll(()=>state.calls.toggle.map(x=>x.completed)).toEqual([true,false]);
 // 기한 바꾸기
 await row.hover();await row.locator('[data-gt-linked-more]').click();await menu.getByRole('button',{name:'기한 바꾸기'}).click();
 const input=page.locator('#taskDuePopup [data-task-due-input]');await expect(input).toHaveValue('2026-10-06');
 await input.fill('2026-10-12');await page.locator('#taskDuePopup').getByRole('button',{name:'바꾸기'}).click();
 await expect.poll(()=>state.calls.update.length).toBe(1);
 expect(state.calls.update[0]).toEqual({action:'update',task_id:'l-1',task_list_id:'@default',title:'합성 연결 할 일',notes:'',due:'2026-10-12'});
 // HOME-업무일지홈 C: 연결 할 일 줄 기한은 공용 기한 글자(task-due.mjs dueLabel, .task-due-text 진회색).
 await expect(row.locator('[data-gt-linked-due]')).toHaveText('10.12 (월)');await expect(row.locator('[data-gt-linked-due]')).toHaveClass(/task-due-text/);
 // 고치기 = 수정 창
 await row.hover();await row.locator('[data-gt-linked-more]').click();await menu.getByRole('button',{name:'고치기'}).click();
 await expect(page.locator('#gtTaskModal')).toBeVisible();await expect(page.locator('#gtEditTitle')).toHaveValue('합성 연결 할 일');
 await page.locator('#gtTaskModal [data-gt-close]').click();await expect(page.locator('#gtTaskModal')).toBeHidden();
 // 연결 해제(화면 고유 동작) 그대로
 await done.hover();await done.locator('[data-gt-linked-more]').click();await menu.getByRole('button',{name:'연결 해제'}).click();
 await expect(done).toHaveCount(0);
 expect(state.calls.unlink).toEqual([{action:'unlink',task_id:'l-2',links:[{organization_id:'oa'}]}]);
 // 지우기: 확인 한 번
 page.once('dialog',d=>d.accept());
 await row.hover();await row.locator('[data-gt-linked-more]').click();await menu.getByRole('button',{name:'지우기'}).click();
 await expect.poll(()=>state.calls.delete.length).toBe(1);
 await expect(body.locator('[data-wait-empty]')).toHaveText('없음');
 expect(errors).toEqual([]);
});
for(const width of [390,1280])test(`프로젝트 상세 연결 할 일: 같은 공용 줄(⋯ 항목, 연결 해제 유지, 동그라미 되돌리기) ${width}`,async({page})=>{
 const {state,errors}=await linkedFixture(page,width);
 await page.evaluate(()=>window.KPTURouter.go('projects'));
 await page.locator('#projectGrid [data-ps3-project="p"]').first().click();
 const panel=page.locator('#ps3-tasks [data-ps3-gtasks]'),row=panel.locator('[data-google-task="l-1"]'),more=row.locator('[data-gt-linked-more]');
 await expect(row).toBeVisible();
 if(width>=761){await page.mouse.move(5,5);await expect.poll(()=>opacity(more)).toBe('0');}
 else await expect.poll(()=>opacity(more)).toBe('1');
 await row.hover();await more.click();
 const menu=page.locator('#gtLinkedMenu');
 await expect(menu.getByRole('button')).toHaveText(['내일로','기한 바꾸기','고치기','연결 해제','지우기']);
 await menu.getByRole('button',{name:'내일로'}).click();
 await expect.poll(()=>state.calls.update.length).toBe(1);expect(state.calls.update[0].due).toBe('2026-10-07');
 await row.locator('[data-gt-linked-toggle]').click();
 const undo=page.locator('[data-undo-notice]');await expect(undo).toContainText("'합성 연결 할 일'을 끝냈어요.");
 await undo.getByRole('button',{name:'되돌리기'}).click();
 await expect.poll(()=>state.calls.toggle.map(x=>x.completed)).toEqual([true,false]);
 await row.hover();await more.click();await menu.getByRole('button',{name:'연결 해제'}).click();
 await expect.poll(()=>state.calls.unlink.length).toBe(1);
 expect(state.calls.unlink[0]).toEqual(expect.objectContaining({task_id:'l-1',links:[{project_id:'p'}]}));
 expect(errors).toEqual([]);
});
