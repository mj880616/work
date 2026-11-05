// S50-36(2026-11-06 명진 결정 "할 일 기한 전부 오늘"): 새로 넣는 모든 할 일은 기한을 고르지 않으면 오늘(한국 날짜), 고르면 그날,
// 이미 있는 할 일을 고칠 때는 그 기한 그대로. 규칙은 app/task-due.mjs newTaskDue 한 곳이다.
// 이 파일: ① 할 일 쓰기 창(할 일 화면·담당조직·프로젝트 상세 [할 일 추가]·홈 가족 제안 [할 일로]가 같이 쓰는 창)
//          ② 사업 보고 보기 면 '다음 할 일' 줄의 [할 일로]
// 다른 곳: 홈 입력칸(home-task-default-today), 공유하기(share-note-task), 업데이트 → 할 일(basket-manual-link),
//          사업 보고 쓰기 창 후속 할 일(meeting-entry). 모든 이름·글은 합성 값.
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {openMeetingResult} from './helpers/meeting-open.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';

async function watchTaskCalls(page,c){
 const creates=[],updates=[];
 await page.route(SB+'/functions/v1/google-tasks?**',route=>{const req=route.request(),action=new URL(req.url()).searchParams.get('action');
  if(action==='create'){const b=req.postDataJSON();creates.push(b);return route.fulfill({json:{ok:true,task:{id:'new-'+creates.length,title:b.title,notes:b.notes||'',status:'needsAction',taskListId:'@default',due:b.due?b.due+'T00:00:00.000Z':null},links:[]}});}
  if(action==='update'&&c){const b=req.postDataJSON();updates.push(b);const t=c.tasks.find(x=>x.id===b.task_id);if(t)Object.assign(t,{title:b.title,notes:b.notes,due:b.due});
   return route.fulfill({json:{ok:true,task:{...t,due:b.due?b.due+'T00:00:00.000Z':null}}});}
  return route.fallback();});
 return {creates,updates};
}
async function openNewEditor(page,title){
 await page.evaluate(async()=>{if(!window.KPTUGoogleTasks)await import('/app/google-tasks.js');});
 await page.waitForFunction(()=>!!window.KPTUGoogleTasks?.openEditor);
 await page.evaluate(t=>window.KPTUGoogleTasks.openEditor(null,{title:t}),title);
 await expect(page.locator('#gtTaskModal')).toBeVisible();
 await expect(page.locator('#gtSaveBtn')).toBeEnabled();
}

for(const width of [390,1280])test(`할 일 쓰기 창: 새로 열면 기한 칸에 오늘이 채워져 있고 그대로 저장하면 오늘 ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 const c=await openHome(page);const {creates}=await watchTaskCalls(page,c);
 await openNewEditor(page,'합성 창 할 일');
 await expect(page.locator('#gtTaskHeading')).toHaveText('Google 할 일 추가');
 await expect(page.locator('#gtEditDue')).toHaveValue('2026-10-06');
 await expect(page.locator('#gtTaskModal .date-field:has(#gtEditDue)')).toHaveAttribute('data-date-text','10.6 (화)');
 await page.locator('#gtSaveBtn').click();
 await expect.poll(()=>creates.length).toBe(1);
 expect(creates[0]).toMatchObject({action:'create',title:'합성 창 할 일',due:'2026-10-06'});
});

test('할 일 쓰기 창: 고른 날은 그날, 기한 칸을 지우면 기한 없음',async({page})=>{
 const c=await openHome(page);const {creates}=await watchTaskCalls(page,c);
 await openNewEditor(page,'합성 고른 날');
 await page.locator('#gtEditDue').fill('2026-10-20');
 await page.locator('#gtSaveBtn').click();
 await expect.poll(()=>creates.length).toBe(1);expect(creates[0].due).toBe('2026-10-20');
 await expect(page.locator('#gtTaskModal')).toBeHidden();
 await openNewEditor(page,'합성 기한 없음');
 await expect(page.locator('#gtEditDue')).toHaveValue('2026-10-06');
 await page.locator('#gtEditDue').fill('');
 await page.locator('#gtSaveBtn').click();
 await expect.poll(()=>creates.length).toBe(2);expect(creates[1].due).toBeNull();
});

test('할 일 쓰기 창: 기한 없는 할 일을 고쳐도 오늘로 바뀌지 않음',async({page})=>{
 const c=await openHome(page);const {creates,updates}=await watchTaskCalls(page,c);
 c.tasks.push({id:'undated-1',title:'합성 기한 없는 일',notes:'',status:'needsAction',taskListId:'@default',due:null,source:'google-task'});
 await page.evaluate(async()=>{if(!window.KPTUGoogleTasks)await import('/app/google-tasks.js');});
 await page.waitForFunction(()=>!!window.KPTUGoogleTasks?.openEditor);
 await page.evaluate(()=>window.KPTUGoogleTasks.openEditor({id:'undated-1',title:'합성 기한 없는 일',notes:'',status:'needsAction',taskListId:'@default',due:null}));
 await expect(page.locator('#gtTaskHeading')).toHaveText('Google 할 일 수정');
 await expect(page.locator('#gtEditDue')).toHaveValue('');
 await page.locator('#gtEditTitle').fill('합성 고친 제목');
 await page.locator('#gtSaveBtn').click();
 await expect.poll(()=>updates.length).toBe(1);
 expect(updates[0]).toMatchObject({action:'update',task_id:'undated-1',title:'합성 고친 제목',due:null});
 expect(creates).toEqual([]);
});

test.describe('사업 보고 다음 할 일',()=>{
 test.use({timezoneId:'Asia/Seoul'});
 test('보기 면 [할 일로]로 만든 할 일은 기한이 오늘 390',async({page})=>{
  const s=baseState();
  s.meetings=[{id:'m-1',workspace_id:s.workspace.id,title:'합성 정기 회의',series_name:'합성 정기 회의',round_no:1,meeting_at:'2026-10-08T01:00:00Z',transcript_text:'합성 결과',activity_kind:'meeting',business_area_id:'top-a',next_plan:'합성 다음 일',created_by:s.user.id,updated_at:'2026-10-08T01:00:00Z'}];
  await page.setViewportSize({width:390,height:900});await mockApp(page,s);
  const {creates}=await watchTaskCalls(page,null);
  await signIn(page,testOrigin+'/app/?view=reports');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  await openMeetingResult(page,'m-1');
  const plan=page.locator('#mrdAreaView [data-biz-plan-task]').first();
  await expect(plan).toBeVisible();await plan.click();
  await expect.poll(()=>creates.length).toBe(1);
  const today=await page.evaluate(()=>new Date(Date.now()+9*3600e3).toISOString().slice(0,10));
  expect(creates[0]).toMatchObject({action:'create',title:'합성 다음 일',due:today,links:[{meeting_id:'m-1'},{project_id:'top-a'}]});
 });
});
