import { expect } from '@playwright/test';
import { loginEntry } from './login-entry.mjs';

const ORIGIN=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const NOW=Date.parse('2026-10-15T03:00:00.000Z');
const task=(id,title,date,done=false)=>({
  id,title,taskListId:'@default',taskListTitle:'QA',due:date+'T00:00:00.000Z',notes:'',
  status:done?'completed':'needsAction',source:'google-task',
  ...(done?{completed:'2026-10-14T03:00:00.000Z'}:{})
});
const TASKS=[
  task('pending','미완료 시험 항목','2026-10-20'),
  task('done','완료 시험 항목','2026-10-20',true),
  task('overdue','기한 지난 시험 항목','2026-10-10'),
  task('overflow-pending','미완료 시험 항목','2026-10-21'),
  task('overflow-done','완료 시험 항목','2026-10-21',true),
  ...Array.from({length:16},(_,i)=>task('dense-'+i,'추가 시험 항목 '+(i+1),'2026-10-21'))
];
// Actual blue values used by the renderer default and the Google event preset fallback.
export const BLUE_COLORS=['#4285f4','#a4bdfc','#5484ed'];
const EVENTS=[
  ...BLUE_COLORS.map((color,i)=>({id:'blue-'+i,calendarId:'qa-cal',source:'google',
    title:'파란 일정 시험 '+(i+1),start:`2026-10-${20+i*2}`,end:`2026-10-${21+i*2}`,allDay:true,color})),
  {id:'overflow-event',calendarId:'qa-cal',source:'google',title:'목록 시험 일정',
    start:'2026-10-21',end:'2026-10-22',allDay:true,color:'#4285f4'}
];

export async function openEmphasisFixture(page){
  const calls=[],external=[];
  await page.clock.setFixedTime(new Date(NOW));
  // Catch every remote request: all API responses are synthetic and no production request can leave the browser.
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(url.origin===ORIGIN)return route.continue();
    const ok=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    if(url.hostname!=='xmlkxfjeagycwttklxjw.supabase.co'){external.push(url.origin);return route.abort()}
    calls.push({path,action:url.searchParams.get('action'),method:request.method()});
    const user={id:'qa-user',email:'qa@example.org',user_metadata:{display_name:'QA'}};
    if(path==='/auth/v1/token')return ok({access_token:'qa',refresh_token:'qa',expires_in:3600,expires_at:4102444800,user});
    if(path==='/auth/v1/user')return ok(user);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'qa-ws',user_id:'qa-user',role:'owner'}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'qa-ws',name:'QA Workspace'}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:'qa-user',display_name:'QA'}]);
    if(path==='/functions/v1/google-calendar')return ok({connected:true,enabled:true,calendars:[{id:'qa-cal',summary:'QA',backgroundColor:'#4285f4',accessRole:'owner'}],calendar_ids:['qa-cal'],events:EVENTS});
    if(path==='/functions/v1/google-tasks')return ok(url.searchParams.get('action')==='links'
      ?{links:[],meeting_links:[]}:{connected:true,authorized:true,needs_reconnect:false,tasks:TASKS,pending_scope:'all'});
    return ok([]);
  });
  await page.goto(loginEntry(ORIGIN+'/app/'));
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('qa@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  await expect(page.locator('#calendarGrid [data-calendar-task="pending"]')).toBeVisible();
  await expect(page.locator('#calendarGrid [data-google-event="blue-0"]')).toBeVisible();
  return {calls,external};
}

export function taskChip(page,id,root='#calendarGrid'){
  return page.locator(`${root} [data-calendar-task="${id}"]`);
}
