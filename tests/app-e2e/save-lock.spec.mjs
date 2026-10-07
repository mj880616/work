import {test,expect} from '@playwright/test';

test.use({timezoneId:'Asia/Seoul'});

// TASK-저장잠금: 자료 등록(saveDocument)·Google 일정 저장(cmSaveGoogle)·회의 수정 저장(mrdSaveEdit)은
// 저장 중 두 번 눌러도 서버 요청이 한 번만 가고, 실패한 뒤에는 다시 저장할 수 있어야 한다.
const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const meeting={
  id:'meeting-1',workspace_id:'lock-ws',project_id:null,title:'저장 잠금 회의',series_name:'저장 잠금 회의',round_no:1,
  meeting_at:'2026-09-17T10:00:00Z',notes:'',transcript_text:'원문',created_by:'lock-user'
};

// writes[kind]: 서버에 도착한 저장 요청 수. hold가 true면 release() 전까지 응답을 미룬다. failNext면 다음 저장 1번을 500으로 돌려준다.
async function mock(page,{calendars=[{id:'primary',summary:'기본',primary:true,accessRole:'owner'},{id:'union',summary:'공공운수노조',accessRole:'writer'}]}={}){
  const state={writes:{event:0,googleEdit:0,document:0,meeting:0},hold:false,failNext:false,waiters:[],googleEvents:[],eventReads:0};
  state.release=()=>{state.hold=false;for(const w of state.waiters.splice(0))w()};
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),path=new URL(req.url()).pathname,method=req.method();
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    const write=async(kind,data)=>{
      state.writes[kind]++;
      if(state.hold)await new Promise(resolve=>state.waiters.push(resolve));
      if(state.failNext){state.failNext=false;return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'임시 저장 실패'})})}
      return ok(data);
    };
    if(path==='/auth/v1/token')return ok({access_token:'lock-access',refresh_token:'lock-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'lock-user'}});
    if(path==='/auth/v1/user')return ok({id:'lock-user',email:'lock@example.org',user_metadata:{display_name:'잠금 QA'}});
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'lock-ws',user_id:'lock-user',role:'owner',email:'lock@example.org',workspace:{id:'lock-ws',name:'QA Workspace'}}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'lock-ws',name:'QA Workspace'}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:'lock-user',display_name:'잠금 QA'}]);
    if(path==='/rest/v1/app_events'){state.eventReads++;return ok([])}
    if(path==='/rest/v1/app_documents'&&method==='POST')return write('document',[{id:'document-new',title:'잠금 자료'}]);
    if(path==='/rest/v1/app_meetings'){
      if(method==='PATCH')return write('meeting',[{id:meeting.id}]);
      return ok([meeting]);
    }
    if(path==='/functions/v1/google-calendar'){const action=new URL(req.url()).searchParams.get('action');const body=method==='POST'?req.postDataJSON():null;if(action==='event')return ok({event:state.googleEvents.find(e=>e.id===new URL(req.url()).searchParams.get('eventId')),eventColors:{}});if(action==='events')return ok({events:state.googleEvents,eventColors:{}});if(body?.action==='create-event'){const result=await write('event',{ok:true,event:{id:'google-new',calendarId:body.calendar_id,title:body.title,start:body.start_iso,end:body.end_iso,allDay:false}});if(!state.failNext)state.googleEvents=[{id:'google-new',calendarId:body.calendar_id,title:body.title,start:body.start_iso,end:body.end_iso,allDay:false}];return result}if(body?.action==='update-event')return write('googleEdit',{ok:true,event:{id:body.event_id,calendarId:body.calendar_id}});return ok({connected:true,enabled:true,selected:['primary'],calendars,events:state.googleEvents,eventColors:{}})}
    if(path==='/functions/v1/google-tasks')return ok({tasks:[],needs_reconnect:false});
    if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path.startsWith('/rest/v1/')||path.startsWith('/functions/v1/'))return ok([]);
    return ok({});
  });
  return state;
}

async function signIn(page,view,options){
  const state=await mock(page,options);
  const returnTo=`${BASE}/app/?view=${view}`;
  await page.goto(`${BASE}/app/login/?return=${encodeURIComponent(returnTo)}`);
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('lock@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  if(view==='calendar'){
    // UI 공개만으로는 초기 status/events 조회가 끝났다고 볼 수 없다.
    await expect.poll(()=>page.evaluate(()=>!!window.__KPTU_CALENDAR_PERSISTENCE_READY__)).toBe(true);
    await page.evaluate(()=>window.__KPTU_CALENDAR_PERSISTENCE_READY__);
  }
  return state;
}

function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date())}

// 두 번 빠르게 누르고(dblclick), 버튼 비활성화를 거치지 않는 재진입(onclick 직접 호출)까지 더한 뒤 요청 수를 센다.
async function pressTwiceWhileSaving(page,state,selector,kind,label){
  const button=page.locator(selector);
  state.hold=true;
  await button.dblclick();
  await expect.poll(()=>state.writes[kind]).toBe(1);
  await expect(button).toBeDisabled();
  await expect(button).toHaveText('저장 중…');
  await page.evaluate(sel=>{const b=document.querySelector(sel);b.onclick?.call(b,new MouseEvent('click'))},selector);
  await page.waitForTimeout(300);
  expect(state.writes[kind]).toBe(1);
  state.release();
  await expect(button).toHaveText(label);
  await expect(button).toBeEnabled();
  expect(state.writes[kind]).toBe(1);
}

async function failThenRetry(page,state,selector,kind,label,statusSelector){
  const button=page.locator(selector),before=state.writes[kind];
  state.failNext=true;
  await button.click();
  await expect.poll(()=>state.writes[kind]).toBe(before+1);
  await expect(page.locator(statusSelector)).toContainText('임시 저장 실패');
  await expect(button).toBeEnabled();
  await expect(button).toHaveText(label);
  await button.click();
  await expect.poll(()=>state.writes[kind]).toBe(before+2);
}

async function openEvent(page){
  await page.locator('#newEventBtn').click();
  await expect(page.locator('#eventModal')).toBeVisible();
  await page.locator('#eventTitle').fill('잠금 일정');
  const day=today();
  await page.locator('#eventStartDate').fill(day);
  await page.locator('#eventStartTime').fill('10:00');
  await page.locator('#eventEndDate').fill(day);
  await page.locator('#eventEndTime').fill('11:00');
}

async function openDocument(page){
  await page.locator('#newDocumentBtn').click();
  await expect(page.locator('#documentModal')).toBeVisible();
  await page.locator('#docTitle').fill('잠금 자료');
}

async function openMeetingEdit(page){
  // 수정 저장이 성공하면 회의 상세가 다시 열린 상태로 남는다.
  if(!(await page.locator('#meetingRoundDetailModal').isVisible()))await page.locator('[data-mrd-meeting="meeting-1"]').click();
  await page.locator('#mrdEdit').click();
  await expect(page.locator('#mrdSaveEdit')).toBeVisible();
}

test('Google event save sends one request on double press and unlocks after failure',async({page})=>{
  const state=await signIn(page,'calendar');
  await expect(page.locator('#calendarView')).toBeVisible();
  expect(state.eventReads).toBe(0);
  await openEvent(page);
  await expect(page.locator('#eventGoogleCalendar')).toHaveValue('union');
  await pressTwiceWhileSaving(page,state,'#saveEventBtn','event','저장');
  await expect(page.locator('#eventModal')).toBeHidden();
  await openEvent(page);
  await failThenRetry(page,state,'#saveEventBtn','event','저장','#eventStatus');
  await expect(page.locator('#eventModal')).toBeHidden();
});

test('Google event edit sends one request on double press and unlocks after failure',async({page})=>{
  const state=await signIn(page,'calendar');
  await openEvent(page);
  await page.locator('#saveEventBtn').click();
  await expect(page.locator('.cp-event[data-google-event="google-new"]')).toBeVisible();
  await page.locator('.cp-event[data-google-event="google-new"]').click();
  await expect(page.locator('#ciGoogleModal')).toBeVisible();
  await pressTwiceWhileSaving(page,state,'#ciGoogleSave','googleEdit','변경사항 저장');
  await expect(page.locator('#ciGoogleModal')).toBeHidden();
  await page.locator('.cp-event[data-google-event="google-new"]').click();
  await failThenRetry(page,state,'#ciGoogleSave','googleEdit','변경사항 저장','#ciGoogleStatus');
  await expect(page.locator('#ciGoogleModal')).toBeHidden();
});

// 목록은 전역에 직접 주입하지 않고 모든 status 응답에서 동일하게 제공한다.
// 늦은 status/events 응답이 다른 목록으로 되돌리는 경쟁을 없앤다.
for(const namedCount of [2,0]){
  test(`calendar name fallback keeps the selected writable Google calendar (${namedCount} named calendars)`,async({page})=>{
    const calendars=[
      {id:'primary',summary:'기본',primary:true,accessRole:'owner'},
      ...Array.from({length:namedCount},(_,i)=>({id:`union-${i}`,summary:'공공운수노조',accessRole:'writer'}))
    ];
    await signIn(page,'calendar',{calendars});
    await page.locator('#newEventBtn').click();
    await expect(page.locator('#eventGoogleCalendar option')).toHaveCount(calendars.length);
    await expect(page.locator('#eventGoogleCalendar')).toHaveValue('primary');
  });
}

test('document save sends one request on double press and unlocks after failure',async({page})=>{
  const state=await signIn(page,'library');
  await expect(page.locator('#libraryView')).toBeVisible();
  await openDocument(page);
  await pressTwiceWhileSaving(page,state,'#saveDocumentBtn','document','등록');
  await expect(page.locator('#documentModal')).toBeHidden();
  await openDocument(page);
  await failThenRetry(page,state,'#saveDocumentBtn','document','등록','#documentStatus');
  await expect(page.locator('#documentModal')).toBeHidden();
});

test('meeting edit save sends one request on double press and unlocks after failure',async({page})=>{
  const state=await signIn(page,'meetings');
  await expect(page.locator('#meetingsView')).toBeVisible();
  await openMeetingEdit(page);
  await pressTwiceWhileSaving(page,state,'#mrdSaveEdit','meeting','수정 저장');
  await openMeetingEdit(page);
  await failThenRetry(page,state,'#mrdSaveEdit','meeting','수정 저장','#mrdEditStatus');
});
