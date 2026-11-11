import {test,expect} from '@playwright/test';
import {loginEntry} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {installViewPrefsServer} from './helpers/view-prefs-server.mjs';

// S57-20 BIZ-보고할일정 PR A(설계 docs/design/biz-report-plan-link.md 4-2·4-3, 시안 docs/design/mockups/biz-report-plan-link.html ②).
// 일정 메뉴(PC 우클릭 = 공용 줄 메뉴 #rowMenu)·일정 창에서 [보고할 일정]을 켜고 끄면 서버 표(app_calendar_report_plans)에 저장되고 새로 고쳐도 유지된다.
// [결과 남기기]로 쓴 사업 보고는 그 일정 id와 이어져 저장된다. 표·칸이 없는 서버(적용 전·되돌린 뒤)에서는 표시 없이 예전 그대로.
// 서버는 흉내(시험 쪽 메모리), 일정·이름은 모두 가짜다.
const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
test.use({timezoneId:'Asia/Seoul'});
const iso=(d,t)=>new Date(`${d}T${t}:00+09:00`).toISOString();
const event=(id,title,day,extra={})=>({id,calendarId:'own',title,start:iso(day,'10:00'),end:iso(day,'11:00'),allDay:false,description:'',location:'',organizationIds:[],recurring:false,source:'google',...extra});
const EVENTS=()=>[
  event('wk1','주간 점검 회의','2026-11-11',{location:'가짜 회의실'}),
  event('wk2','주간 점검 회의','2026-11-18'),
  event('wk3','주간 점검 회의','2026-11-25'),
  event('etc1','자료 정리','2026-11-12'),
  event('ref1','참고 일정','2026-11-13',{calendarId:'ref'})
];
// store=false: 새 표·새 칸이 아직 없는 서버.
function server({store=true}={}){return {store,plans:[],reports:[],seq:0,planWrites:[],reportPosts:[],events:EVENTS()}}
async function open(page,state,{width=1280,height=844}={}){
  await page.setViewportSize({width,height});
  await page.clock.setFixedTime(new Date('2026-11-10T00:00:00Z'));
  await installViewPrefsServer(page,{calendar_view:'month'});
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url()),method=req.method();
    if(url.origin===BASE)return route.continue();
    if(url.origin!==SB)return route.abort();
    const ok=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    const eq=name=>{const v=url.searchParams.get(name);return v&&v.startsWith('eq.')?v.slice(3):null};
    const user={id:'rp-user',email:'qa@example.org',user_metadata:{display_name:'QA'}};
    if(url.pathname==='/auth/v1/token')return ok({access_token:'synthetic',refresh_token:'synthetic',expires_at:4102444800,user});
    if(url.pathname==='/auth/v1/user')return ok(user);
    if(url.pathname==='/rest/v1/app_workspace_members')return ok([{workspace_id:'rp-ws',user_id:user.id,role:'owner'}]);
    if(url.pathname==='/rest/v1/app_workspaces')return ok([{id:'rp-ws',name:'QA'}]);
    if(url.pathname==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'QA'}]);
    if(url.pathname==='/rest/v1/app_calendar_report_plans'){
      if(!state.store)return ok({code:'PGRST205',message:"Could not find the table 'public.app_calendar_report_plans' in the schema cache"},404);
      if(method==='GET'){const id=eq('google_event_id');return ok(state.plans.filter(p=>!id||p.google_event_id===id))}
      const body=req.postDataJSON?.()??null;
      state.planWrites.push({method,query:url.search,body});
      if(method==='POST'){
        if(state.plans.some(p=>p.google_event_id===body.google_event_id))return ok({code:'23505',message:'duplicate key value violates unique constraint "app_calendar_report_plans_event_key"'},409);
        const row={id:'plan-'+(++state.seq),...body};state.plans.push(row);return ok([row],201);
      }
      if(method==='PATCH'){const row=state.plans.find(p=>p.id===eq('id'));if(!row)return ok([]);Object.assign(row,body);return ok([row])}
      if(method==='DELETE'){state.plans=state.plans.filter(p=>p.google_event_id!==eq('google_event_id'));return ok([])}
      return ok({message:'method'},405);
    }
    if(url.pathname==='/rest/v1/app_meetings'){
      const wantsLink=/google_event_id/.test(url.search);
      if(method==='GET'){
        if(wantsLink&&!state.store)return ok({code:'42703',message:'column app_meetings.google_event_id does not exist'},400);
        return ok(wantsLink?state.reports.filter(r=>r.google_event_id):state.reports);
      }
      if(method==='POST'){
        const body=req.postDataJSON();state.reportPosts.push(body);
        if(!state.store&&('google_event_id' in body||'google_calendar_id' in body))return ok({code:'PGRST204',message:"Could not find the 'google_event_id' column of 'app_meetings' in the schema cache"},400);
        const row={id:'report-'+(++state.seq),created_at:new Date().toISOString(),updated_at:new Date().toISOString(),...body};state.reports.push(row);return ok([row],201);
      }
      return ok([]);
    }
    if(url.pathname==='/functions/v1/google-calendar'){
      const action=url.searchParams.get('action');
      if(method==='POST')return ok({ok:true});
      if(action==='event')return ok({event:state.events.find(e=>e.id===url.searchParams.get('eventId')),eventColors:{}});
      const status={connected:true,enabled:true,selected:['own','ref'],calendars:[{id:'own',summary:'내 캘린더',accessRole:'owner',backgroundColor:'#336699'},{id:'ref',summary:'참고 캘린더',accessRole:'reader',backgroundColor:'#7a8a2a'}],colors:{},eventColors:{}};
      return ok(action==='events'?{...status,events:state.events.map(e=>({...e}))}:status);
    }
    if(url.pathname==='/functions/v1/google-tasks'){
      if(url.searchParams.get('action')==='links')return ok({links:[],meeting_links:[]});
      return ok({connected:true,authorized:true,needs_reconnect:false,tasks:[],links:[],meeting_links:[],pending_scope:'all'});
    }
    return ok([]);
  });
  await page.goto(loginEntry(BASE+'/app/?view=calendar'));
  await signInWithSession(page,'qa@example.org');
  await ready(page);
  return state;
}
async function ready(page){
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  await expect(bar(page,'wk1')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>!!window.__KPTU_CALENDAR_CONTEXT_MENU__&&!!window.KPTUCalendarEvents?.planOf&&!!window.KPTUCalendarEvents?.setPlan)).toBe(true);
}
// 표가 있는 서버: 달력이 '보고할 일정' 줄을 읽어 둘 때까지(메뉴가 누른 자리에서 바로 열리려면 미리 읽어 둔 값이 있어야 한다).
const plansRead=page=>expect.poll(()=>page.evaluate(()=>window.KPTUCalendarEvents.planOf('wk1','own')!==null)).toBe(true);
const bar=(page,id)=>page.locator(`#calendarGrid [data-google-event="${id}"]`).first();
const menu=page=>page.locator('#rowMenu');
const labels=page=>menu(page).locator('button').allTextContents().then(a=>a.map(s=>s.trim()));
async function rightClick(page,id){const b=await bar(page,id).boundingBox(),x=Math.round(b.x+b.width/2),y=Math.round(b.y+b.height/2);await page.mouse.move(x,y);await page.mouse.click(x,y,{button:'right'});await expect(menu(page)).toBeVisible()}
const closeMenu=async page=>{await page.keyboard.press('Escape');await expect(menu(page)).toBeHidden()};
const planRow=page=>page.locator('#ciGooglePlanRow');
const planBox=page=>page.locator('#ciGooglePlan');
// 창을 열고 맨 아래('보고할 일정' 칸·버튼 줄)까지 내린다(창 안이 길어 스크롤되는 폭이 있다).
async function openWindow(page,id){
  await bar(page,id).click();await expect(page.locator('#ciGoogleModal')).toBeVisible();await expect(page.locator('#ciGoogleSave')).toBeEnabled();
  await page.evaluate(()=>{const card=document.querySelector('#ciGoogleModal .modal-card');card.scrollTop=card.scrollHeight});
}
const closeWindow=async page=>{await page.locator('#ciGoogleClose').click();await expect(page.locator('#ciGoogleModal')).toBeHidden()};

test('1280 우클릭: [보고할 일정] 켜기 → 서버 저장 → ✓, 새로 고쳐도 유지, 끄면 그 줄 고치기',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const state=await open(page,server());await plansRead(page);
  await rightClick(page,'etc1');
  expect(await labels(page)).toEqual(['수정','보고할 일정','담당조직 연결','결과 남기기','삭제']);
  await expect(menu(page).locator('button').last()).toHaveClass(/row-menu-last/);
  await menu(page).getByRole('button',{name:'보고할 일정'}).click();
  await expect(page.locator('#toast')).toHaveText('보고할 일정으로 표시했어요.');
  // 창을 열지 않고 그 자리에서 저장한다.
  await expect(page.locator('#ciGoogleModal')).toBeHidden();
  expect(state.planWrites).toHaveLength(1);
  expect(state.planWrites[0].method).toBe('POST');
  expect(state.planWrites[0].body).toMatchObject({workspace_id:'rp-ws',google_event_id:'etc1',google_calendar_id:'own',state:'on',decided_by:'user',title:'자료 정리',event_day:'2026-11-12',starts_at:iso('2026-11-12','10:00')});
  expect(Object.keys(state.planWrites[0].body)).not.toContain('created_at');
  await rightClick(page,'etc1');
  expect(await labels(page)).toEqual(['수정','보고할 일정 ✓','담당조직 연결','결과 남기기','삭제']);
  await closeMenu(page);
  // 다른 이름의 일정은 그대로 꺼져 있다.
  await rightClick(page,'wk1');expect(await labels(page)).toContain('보고할 일정');await closeMenu(page);
  // 새로 고쳐도(서버에서 다시 읽어도) 유지.
  await page.reload();await ready(page);await plansRead(page);
  await rightClick(page,'etc1');
  expect(await labels(page)).toContain('보고할 일정 ✓');
  await menu(page).getByRole('button',{name:'보고할 일정 ✓'}).click();
  await expect(page.locator('#toast')).toHaveText('보고할 일정 표시를 껐어요.');
  expect(state.planWrites).toHaveLength(2);
  expect(state.planWrites[1].method).toBe('PATCH');
  expect(state.planWrites[1].query).toContain('id=eq.plan-1');
  expect(state.planWrites[1].body).toMatchObject({state:'off',decided_by:'user'});
  // 고칠 수 없는 칸(작업공간·일정 id)은 보내지 않는다.
  expect(Object.keys(state.planWrites[1].body).sort()).toEqual(['decided_at','decided_by','state']);
  await rightClick(page,'etc1');
  expect(await labels(page)).toEqual(['수정','보고할 일정','담당조직 연결','결과 남기기','삭제']);
  expect(state.plans).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("1280 같은 이름 기억: 하나를 켜면 같은 이름 일정도 ✓, '끔'은 그 일정 하나만",async({page})=>{
  const state=await open(page,server());await plansRead(page);
  await rightClick(page,'wk1');
  await menu(page).getByRole('button',{name:'보고할 일정'}).click();
  await expect(page.locator('#toast')).toHaveText('보고할 일정으로 표시했어요.');
  // 같은 이름의 다음 주 일정: 줄은 없지만 기억으로 켜져 보인다.
  await rightClick(page,'wk2');expect(await labels(page)).toContain('보고할 일정 ✓');
  // 그 일정만 끈다 → 그 일정의 줄(off)이 새로 생긴다.
  await menu(page).getByRole('button',{name:'보고할 일정 ✓'}).click();
  await expect(page.locator('#toast')).toHaveText('보고할 일정 표시를 껐어요.');
  expect(state.planWrites.at(-1)).toMatchObject({method:'POST',body:{google_event_id:'wk2',state:'off',decided_by:'user'}});
  await rightClick(page,'wk2');expect(await labels(page)).toContain('보고할 일정');await closeMenu(page);
  // 처음 켠 일정과 같은 이름의 다른 주 일정은 그대로 켜져 있다.
  await rightClick(page,'wk1');expect(await labels(page)).toContain('보고할 일정 ✓');await closeMenu(page);
  await rightClick(page,'wk3');expect(await labels(page)).toContain('보고할 일정 ✓');await closeMenu(page);
  // 다른 이름은 기억과 상관없다.
  await rightClick(page,'etc1');expect(await labels(page)).toContain('보고할 일정');await closeMenu(page);
  expect(state.plans.map(p=>[p.google_event_id,p.state]).sort()).toEqual([['wk1','on'],['wk2','off']]);
});

test('1280 쓰기 권한이 없는 캘린더의 일정: [열기] 아래 [보고할 일정]만(표시는 Web2 서버에만 적는다)',async({page})=>{
  const state=await open(page,server());await plansRead(page);
  await rightClick(page,'ref1');
  expect(await labels(page)).toEqual(['열기','보고할 일정']);
  await menu(page).getByRole('button',{name:'보고할 일정'}).click();
  await expect(page.locator('#toast')).toHaveText('보고할 일정으로 표시했어요.');
  expect(state.planWrites[0].body).toMatchObject({google_event_id:'ref1',google_calendar_id:'ref',state:'on'});
  await rightClick(page,'ref1');expect(await labels(page)).toEqual(['열기','보고할 일정 ✓']);
});

for(const width of [412,1280])test(`${width} 일정 창: '보고할 일정' 칸을 누르면 바로 서버 저장, 새로 고쳐도 유지, 메뉴와 같은 값`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const state=await open(page,server(),{width,height:width<=760?900:844});await plansRead(page);
  await openWindow(page,'wk1');
  await expect(planRow(page)).toBeVisible();
  await expect(planRow(page)).toHaveText('보고할 일정');
  await expect(planBox(page)).not.toBeChecked();
  // 메모·담당조직 줄 아래, [결과 남기기] 버튼 줄 바로 위 한 줄. 창 밖으로 넘치지 않고 버튼 줄에 가리지 않는다.
  expect(await page.evaluate(()=>{const after=(a,b)=>!!(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING),row=document.querySelector('#ciGooglePlanRow');return after(document.querySelector('#ciGoogleMemo'),row)&&after(row,document.querySelector('#ciGoogleModal .modal-action-footer'))})).toBe(true);
  const [row,footer,card]=await Promise.all([planRow(page).boundingBox(),page.locator('#ciGoogleModal .modal-action-footer').boundingBox(),page.locator('#ciGoogleModal .modal-card').boundingBox()]);
  expect(row.y+row.height).toBeLessThanOrEqual(footer.y+1);
  expect(row.x).toBeGreaterThanOrEqual(card.x);expect(row.x+row.width).toBeLessThanOrEqual(card.x+card.width+1);
  expect(row.height).toBeLessThanOrEqual(48);
  await planBox(page).check();
  await expect.poll(()=>state.planWrites.length).toBe(1);
  expect(state.planWrites[0]).toMatchObject({method:'POST',body:{workspace_id:'rp-ws',google_event_id:'wk1',state:'on',decided_by:'user',title:'주간 점검 회의',event_day:'2026-11-11'}});
  await expect(planBox(page)).toBeEnabled();await expect(planBox(page)).toBeChecked();
  // Google 일정은 건드리지 않는다: [변경사항 저장]을 누르지 않아도 저장됐고, 창은 열린 채다.
  await expect(page.locator('#ciGoogleModal')).toBeVisible();
  await closeWindow(page);
  await page.reload();await ready(page);await plansRead(page);
  await openWindow(page,'wk1');
  await expect(planBox(page)).toBeChecked();
  await closeWindow(page);
  // 같은 이름의 다른 일정은 처음부터 켜져 나온다(기억). 끄면 그 일정만.
  await openWindow(page,'wk2');
  await expect(planBox(page)).toBeChecked();
  await planBox(page).uncheck();
  await expect.poll(()=>state.planWrites.length).toBe(2);
  expect(state.planWrites[1]).toMatchObject({method:'POST',body:{google_event_id:'wk2',state:'off',decided_by:'user'}});
  await expect(planBox(page)).toBeEnabled();await expect(planBox(page)).not.toBeChecked();
  await closeWindow(page);
  await openWindow(page,'wk1');await expect(planBox(page)).toBeChecked();
  await planBox(page).uncheck();
  await expect.poll(()=>state.planWrites.length).toBe(3);
  expect(state.planWrites[2]).toMatchObject({method:'PATCH',body:{state:'off',decided_by:'user'}});
  await closeWindow(page);
  if(width>760){await rightClick(page,'wk1');expect(await labels(page)).toContain('보고할 일정');await closeMenu(page)}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('1280 저장 실패: 칸이 누르기 전으로 돌아가고 한 줄로 알린다, 다시 누르면 저장',async({page})=>{
  const state=await open(page,server());await plansRead(page);
  let fail=true;const failedPosts=[];
  await page.route(`${SB}/rest/v1/app_calendar_report_plans**`,route=>{
    if(route.request().method()!=='POST'||!fail)return route.fallback();
    failedPosts.push(route.request().postDataJSON());
    return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'server error'})});
  });
  await openWindow(page,'etc1');
  await expect(planBox(page)).toBeEnabled();await expect(planBox(page)).not.toBeChecked();
  // 여기는 check()가 아니라 click()으로 누른다. check()는 누른 뒤 칸이 켜져 있는지 한 번 더 읽는데, 저장 실패 답이 그보다 먼저 오면
  // 화면이 칸을 이미 누르기 전으로 돌려놓아(이 시험이 바라는 동작) 'Clicking the checkbox did not change its state'로 끝난다.
  // 누름이 먹었는지는 '켬' 저장 요청이 한 번 나갔는지로 본다.
  await planBox(page).click();
  await expect(page.locator('#ciGoogleStatus')).toHaveText('보고할 일정 표시를 저장하지 못했어요. 다시 눌러 주세요.');
  expect(failedPosts).toHaveLength(1);
  expect(failedPosts[0]).toMatchObject({google_event_id:'etc1',state:'on',decided_by:'user'});
  await expect(planBox(page)).toBeEnabled();await expect(planBox(page)).not.toBeChecked();
  expect(state.plans).toHaveLength(0);
  fail=false;
  await planBox(page).check();
  await expect.poll(()=>state.plans.length).toBe(1);
  await expect(planBox(page)).toBeChecked();
  await expect(page.locator('#ciGoogleStatus')).toHaveText('');
});

for(const width of [412,1280])test(`${width} [결과 남기기]로 쓴 보고는 그 일정과 이어져 저장되고, 같은 이름 일정은 저절로 켜진다`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const state=await open(page,server(),{width,height:width<=760?900:844});await plansRead(page);
  await openWindow(page,'wk1');
  await page.locator('#ciGoogleReport').click();
  const sheet=page.locator('#reportKindSheet');await expect(sheet).toBeVisible();
  await sheet.locator('[data-sheet-value="press"]').click();
  await expect(page.locator('#meetingModal')).toBeVisible();
  await expect(page.locator('#meetingTitle')).toHaveValue('주간 점검 회의');
  await expect(page.locator('#meetingLocation')).toHaveValue('가짜 회의실');
  await page.locator('#meetingTranscript').fill('가짜 결과 내용');
  await page.locator('#saveMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeHidden();
  expect(state.reportPosts).toHaveLength(1);
  expect(state.reportPosts[0]).toMatchObject({workspace_id:'rp-ws',series_name:'주간 점검 회의',google_event_id:'wk1',google_calendar_id:'own'});
  // 일정에 이어 쓴 보고가 있는 이름 → 같은 이름의 다른 일정은 처음부터 켜져 나온다(줄을 따로 만들지 않아도).
  await expect.poll(()=>page.evaluate(()=>window.KPTUCalendarEvents.planOf('wk2','own')?.on)).toBe(true);
  expect(await page.evaluate(()=>window.KPTUCalendarEvents.planOf('etc1','own')?.on)).toBe(false);
  expect(state.planWrites).toHaveLength(0);
  // [+]로 그냥 쓰는 보고에는 일정 연결이 남지 않는다(앞 창의 일정이 따라오지 않음).
  await page.evaluate(()=>window.KPTUReportEntry.open({name:'가짜 보고',kind:'press',at:'2026-11-12T10:00'}));
  await expect(page.locator('#meetingModal')).toBeVisible();
  await page.locator('#meetingTranscript').fill('가짜 내용');
  await page.locator('#saveMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeHidden();
  expect(state.reportPosts).toHaveLength(2);
  expect(Object.keys(state.reportPosts[1])).not.toContain('google_event_id');
  expect(Object.keys(state.reportPosts[1])).not.toContain('google_calendar_id');
  expect(errors).toEqual([]);
});

for(const width of [412,1280])test(`${width} 표·칸이 없는 서버(적용 전·되돌린 뒤): 메뉴·창·보고 저장이 예전 그대로`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const state=await open(page,server({store:false}),{width,height:width<=760?900:844});
  // 읽기가 '없음'으로 끝날 때까지 기다린 뒤 본다.
  await expect.poll(()=>page.evaluate(async()=>{const m=await import('./report-plan-data.js');const s=await m.loadReportPlans();return s?[s.plans,s.reports]:'none'})).toEqual([null,null]);
  if(width>760){
    await rightClick(page,'wk1');
    expect(await labels(page)).toEqual(['수정','담당조직 연결','결과 남기기','삭제']);
    await closeMenu(page);
    await rightClick(page,'ref1');expect(await labels(page)).toEqual(['열기']);await closeMenu(page);
  }
  await openWindow(page,'wk1');
  await expect(planRow(page)).toBeHidden();
  await page.locator('#ciGoogleReport').click();
  await page.locator('#reportKindSheet [data-sheet-value="press"]').click();
  await expect(page.locator('#meetingModal')).toBeVisible();
  await page.locator('#meetingTranscript').fill('가짜 결과 내용');
  await page.locator('#saveMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeHidden();
  expect(state.reportPosts).toHaveLength(1);
  expect(Object.keys(state.reportPosts[0])).not.toContain('google_event_id');
  expect(Object.keys(state.reportPosts[0])).not.toContain('google_calendar_id');
  expect(state.planWrites).toHaveLength(0);
  expect(errors).toEqual([]);
});
