import {test,expect} from '@playwright/test';
import {loginEntry} from './helpers/login-entry.mjs';

const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const calendars=[{id:'source',summary:'기존 캘린더',accessRole:'owner',backgroundColor:'#336699'},{id:'target',summary:'새 캘린더',accessRole:'writer',backgroundColor:'#aa5533'},{id:'read-only',summary:'읽기 전용',accessRole:'reader'},{id:'unknown',summary:'권한 미확인'}];
test.use({timezoneId:'Asia/Seoul',viewport:{width:360,height:844}});
async function open(page,{view='list',recurring=false,partial=false,timed=false}={}){
  const state={writes:[],reads:0,event:{id:'move-event',title:'합성 이동 시험',calendarId:'source',...(timed?{start:'2026-10-20T01:00:00.000Z',end:'2026-10-20T02:00:00.000Z',allDay:false}:{start:'2026-10-20',end:'2026-10-21',allDay:true}),color:null,colorId:null,organizationIds:['org-a'],recurring,source:'google'}};
  await page.clock.setFixedTime(new Date('2026-10-20T03:00:00Z'));
  await page.addInitScript(view=>localStorage.setItem('kptu-calendar-view',view),view);
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin===BASE)return route.continue();
    if(url.origin!==SB)return route.abort();
    const ok=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    const user={id:'move-user',email:'qa@example.org',user_metadata:{display_name:'QA'}};
    if(url.pathname==='/auth/v1/token')return ok({access_token:'synthetic',refresh_token:'synthetic',expires_at:4102444800,user});
    if(url.pathname==='/auth/v1/user')return ok(user);
    if(url.pathname==='/rest/v1/app_workspace_members')return ok([{workspace_id:'move-ws',user_id:user.id,role:'owner'}]);
    if(url.pathname==='/rest/v1/app_workspaces')return ok([{id:'move-ws',name:'QA'}]);
    if(url.pathname==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'QA'}]);
    if(url.pathname==='/functions/v1/google-calendar'){
      const action=url.searchParams.get('action');
      if(req.method()==='POST'){
        const body=req.postDataJSON();state.writes.push(body);if(state.writeGate)await state.writeGate;
        if(body.action==='update-event'){
          if(state.reject)return route.fulfill({status:state.reject.status,contentType:'application/json',body:JSON.stringify({error:state.reject.error})});
          if(state.convert)Object.assign(state.event,body.all_day?{allDay:true,start:body.start_date,end:new Date(Date.parse(body.end_date+'T00:00:00Z')+86400000).toISOString().slice(0,10)}:{allDay:false,start:body.start_iso,end:body.end_iso});
          state.event.calendarId=body.target_calendar_id||body.calendar_id;
          if(!partial)state.event.title=body.title;if(state.empty)return ok(null);
          return ok(partial?{ok:false,moved:true,partial_failure:true,failed_stage:'contents',message:'캘린더는 옮겨졌지만 일부 내용 저장에 실패했습니다.',event:state.event}:{ok:true,moved:!!body.target_calendar_id,event:state.event});
        }
      }
      if(action==='event'){state.reads++;if(state.readGate)await state.readGate;if(state.readFail)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'합성 조회 실패'})});return ok({event:state.event,eventColors:{}})}
      return ok({connected:true,enabled:true,selected:['source','target'],calendars,events:[state.event],colors:{},eventColors:{}});
    }
    if(url.pathname==='/functions/v1/google-tasks')return ok({connected:true,authorized:true,tasks:[],links:[],meeting_links:[]});
    return ok([]);
  });
  await page.goto(loginEntry(BASE+'/app/?view=calendar'));
  await page.locator('#emailAuthToggle').click();await page.locator('#authEmail').fill('qa@example.org');await page.locator('#authPassword').fill('password123');await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  await expect(page.locator('[data-google-event="move-event"]').first()).toBeVisible();
  return state;
}
async function edit(page){await page.locator('[data-google-event="move-event"]').first().click();await expect(page.locator('#ciGoogleModal')).toBeVisible();await expect(page.locator('#ciGoogleSave')).toBeEnabled()}
test('current calendar is selected; only writable choices; unchanged save omits target',async({page})=>{
  const state=await open(page);await edit(page);
  await expect(page.locator('#ciGoogleCalendar')).toHaveValue('source');
  expect(await page.locator('#ciGoogleCalendar option').evaluateAll(rows=>rows.map(r=>r.value))).toEqual(['source','target']);
  await page.locator('#ciGoogleSave').click();await expect(page.locator('#ciGoogleModal')).toBeHidden();
  expect(state.writes[0]).not.toHaveProperty('target_calendar_id');expect(state.writes[0].organization_ids).toEqual(['org-a']);
});
for(const view of ['list','week','month'])test('move persists destination color and editor across '+view,async({page})=>{
  if(view==='week')await page.setViewportSize({width:1280,height:844});
  const state=await open(page,{view});await edit(page);await page.locator('#ciGoogleCalendar').selectOption('target');await page.locator('#ciGoogleSave').click();await expect(page.locator('#ciGoogleModal')).toBeHidden();
  expect(state.writes[0]).toMatchObject({calendar_id:'source',event_id:'move-event',target_calendar_id:'target'});
  const root=view==='month'?'#calendarGrid':view==='week'?'#calendarWeek':'#calendarList';
  const moved=page.locator(root+' [data-google-event="move-event"]');await expect(moved.first()).toHaveAttribute('data-google-calendar','target');
  const color=await moved.first().evaluate(el=>{const dot=el.querySelector('.clv-color');if(dot)return getComputedStyle(dot).backgroundColor;const probe=document.createElement('i');probe.style.backgroundColor=getComputedStyle(el).getPropertyValue('--cmv-google-source');el.append(probe);const color=getComputedStyle(probe).backgroundColor;probe.remove();return color});
  expect(color).toBe('rgb(170, 85, 51)');
  await edit(page);await expect(page.locator('#ciGoogleCalendar')).toHaveValue('target');
});
test('date dialog uses same editor and selection',async({page})=>{
  await open(page,{view:'month'});await page.locator('.cal-cell[data-date="2026-10-20"] .cmv-date-list').click();await expect(page.locator('#calendarDayModal')).toBeVisible();
  await page.locator('#calendarDayModal [data-google-event="move-event"]').click();await expect(page.locator('#ciGoogleCalendar')).toHaveValue('source');
});
test('recurring event locks calendar but keeps existing edits',async({page})=>{
  const state=await open(page,{recurring:true});await edit(page);await expect(page.locator('#ciGoogleCalendar')).toBeDisabled();await expect(page.locator('#ciGoogleCalendarHint')).toHaveText('반복 일정은 Google 캘린더에서 옮겨 주세요');
  await page.locator('#ciGoogleSave').click();await expect(page.locator('#ciGoogleModal')).toBeHidden();expect(state.writes[0]).not.toHaveProperty('target_calendar_id');
});
test('partial save reads actual destination and preserves warning for retry',async({page})=>{
  const state=await open(page,{partial:true});await edit(page);await page.locator('#ciGoogleCalendar').selectOption('target');await page.locator('#ciGoogleTitle').fill('합성 수정 입력');await page.locator('#ciGoogleSave').click();
  await expect(page.locator('#ciGoogleStatus')).toContainText('캘린더는 옮겨졌지만 일부 내용 저장에 실패했습니다');await expect(page.locator('#ciGoogleCalendar')).toHaveValue('target');await expect(page.locator('#ciGoogleTitle')).toHaveValue('합성 수정 입력');expect(state.reads).toBeGreaterThan(0);
  await page.locator('#ciGoogleSave').click();await expect.poll(()=>state.writes.length).toBe(2);expect(state.writes[1].calendar_id).toBe('target');expect(state.writes[1]).not.toHaveProperty('target_calendar_id');
});
test('failed reread retains server-confirmed destination and allows a correct retry',async({page})=>{
  const state=await open(page,{partial:true});await edit(page);state.readFail=true;
  await page.locator('#ciGoogleCalendar').selectOption('target');await page.locator('#ciGoogleSave').click();
  await expect(page.locator('#ciGoogleStatus')).toContainText('최신 조회도 실패');await expect(page.locator('#ciGoogleCalendar')).toHaveValue('target');await expect(page.locator('#ciGoogleSave')).toBeEnabled();
  await page.locator('#ciGoogleSave').click();await expect.poll(()=>state.writes.length).toBe(2);expect(state.writes[1].calendar_id).toBe('target');
});
test('late partial reread cannot overwrite another event editor',async({page})=>{
  const state=await open(page,{partial:true});await edit(page);let release;state.readGate=new Promise(resolve=>release=resolve);
  await page.locator('#ciGoogleCalendar').selectOption('target');await page.locator('#ciGoogleSave').click();await expect.poll(()=>state.reads).toBe(1);
  await page.locator('#ciGoogleClose').click();
  await page.evaluate(()=>{const event={...window.__KPTU_GOOGLE_EVENTS__[0],id:'other-event',title:'합성 다른 일정',calendarId:'source'};window.__KPTU_GOOGLE_EVENTS__.push(event);const item=document.querySelector('[data-google-event="move-event"]');item.dataset.googleEvent=event.id;item.click()});
  await expect(page.locator('#ciGoogleTitle')).toHaveValue('합성 다른 일정');release();
  await expect(page.locator('#ciGoogleSave')).toBeEnabled();await expect(page.locator('#ciGoogleStatus')).toBeEmpty();await expect(page.locator('#ciGoogleTitle')).toHaveValue('합성 다른 일정');await expect(page.locator('#ciGoogleCalendar')).toHaveValue('source');
});
test('desktop uses the same keyboard-accessible calendar selector',async({page})=>{
  await page.setViewportSize({width:1280,height:900});await open(page);await edit(page);
  await expect(page.getByLabel('캘린더',{exact:true})).toHaveValue('source');await page.locator('#ciGoogleCalendar').focus();await page.keyboard.press('ArrowDown');await expect(page.locator('#ciGoogleCalendar')).toHaveValue('target');
});
test('primary alias selects the named current calendar without a duplicate destination',async({page})=>{
  await open(page);await page.evaluate(()=>{window.__KPTU_GOOGLE_EVENTS__[0].calendarId='primary';window.__KPTU_GOOGLE_STATE__.calendars[0].primary=true;document.querySelector('[data-google-event="move-event"]').dataset.googleCalendar='primary'});await edit(page);
  await expect(page.locator('#ciGoogleCalendar')).toHaveValue('primary');expect(await page.locator('#ciGoogleCalendar option').evaluateAll(rows=>rows.map(r=>({value:r.value,disabled:r.disabled,label:r.textContent})))).toEqual([{value:'primary',disabled:false,label:'기존 캘린더 (기본)'},{value:'target',disabled:false,label:'새 캘린더'}]);
});

for(const width of [390,1280])test(`partial move preserves full current draft ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const s=await open(page,{partial:true});await edit(page);await page.locator('#ciGoogleCalendar').selectOption('target');await page.locator('#ciGoogleTitle').fill('새 제목');await page.locator('#ciGoogleMemo').fill('새 메모');await page.locator('#ciGoogleStartDate').fill('2026-10-21');await page.locator('#ciGoogleEndDate').fill('2026-10-22');await page.locator('#ciGoogleColor button').nth(2).click();const color=await page.locator('#ciGoogleColor').getAttribute('data-selected-color');await page.locator('#ciGoogleSave').click();await expect(page.locator('#ciGoogleStatus')).toContainText('수정 입력');await expect(page.locator('#ciGoogleTitle')).toHaveValue('새 제목');await expect(page.locator('#ciGoogleMemo')).toHaveValue('새 메모');await expect(page.locator('#ciGoogleStartDate')).toHaveValue('2026-10-21');await expect(page.locator('#ciGoogleEndDate')).toHaveValue('2026-10-22');await expect(page.locator('#ciGoogleColor')).toHaveAttribute('data-selected-color',color);expect(s.writes[0].organization_ids).toEqual(['org-a']);
});
test('new input during event edit success remains open',async({page})=>{
 const s=await open(page);await edit(page);let release;s.writeGate=new Promise(r=>release=r);await page.locator('#ciGoogleSave').click();await expect.poll(()=>s.writes.length).toBe(1);await page.locator('#ciGoogleMemo').fill('늦은 입력');release();await expect(page.locator('#ciGoogleSave')).toBeEnabled();await expect(page.locator('#ciGoogleModal')).toBeVisible();await expect(page.locator('#ciGoogleMemo')).toHaveValue('늦은 입력');
});
test('unconfirmed move checks actual address before another write',async({page})=>{
 const s=await open(page);await edit(page);s.empty=true;await page.locator('#ciGoogleCalendar').selectOption('target');await page.locator('#ciGoogleTitle').fill('보존 입력');await page.locator('#ciGoogleSave').click();await expect(page.locator('#ciGoogleStatus')).toContainText('확인');s.empty=false;await page.locator('#ciGoogleSave').click();await expect(page.locator('#ciGoogleStatus')).toContainText('위치를 확인');expect(s.writes).toHaveLength(1);await expect(page.locator('#ciGoogleTitle')).toHaveValue('보존 입력');await page.locator('#ciGoogleSave').click();await expect(page.locator('#ciGoogleModal')).toBeHidden();expect(s.writes[1].calendar_id).toBe('target');expect(s.writes[1]).not.toHaveProperty('target_calendar_id');
});
test('same event reopened during a save waits without losing new input',async({page})=>{
 const s=await open(page);await edit(page);let release;s.writeGate=new Promise(r=>release=r);await page.locator('#ciGoogleSave').click();await expect.poll(()=>s.writes.length).toBe(1);await page.locator('#ciGoogleClose').click();await page.locator('[data-google-event="move-event"]').first().click();await expect(page.locator('#ciGoogleModal')).toBeVisible();await expect(page.locator('#ciGoogleSave')).toBeDisabled();await page.locator('#ciGoogleTitle').fill('같은 일정 새 초안');release();await expect(page.locator('#ciGoogleSave')).toBeEnabled();await expect(page.locator('#ciGoogleSave')).toHaveText('변경사항 저장');await expect(page.locator('#ciGoogleSave')).not.toHaveAttribute('aria-busy','true');await expect(page.locator('#ciGoogleTitle')).toHaveValue('같은 일정 새 초안');
});

test('unknown move address confirmation preserves a newly chosen destination',async({page})=>{
 const s=await open(page);await edit(page);s.empty=true;await page.locator('#ciGoogleCalendar').selectOption('target');await page.locator('#ciGoogleSave').click();await expect(page.locator('#ciGoogleStatus')).toContainText('확인');s.empty=false;await page.locator('#ciGoogleCalendar').selectOption('source');await page.locator('#ciGoogleSave').click();await expect(page.locator('#ciGoogleStatus')).toContainText('위치를 확인');await expect(page.locator('#ciGoogleCalendar')).toHaveValue('source');expect(s.writes).toHaveLength(1);await page.locator('#ciGoogleSave').click();await expect(page.locator('#ciGoogleModal')).toBeHidden();expect(s.writes[1]).toMatchObject({calendar_id:'target',target_calendar_id:'source'});
});

// BUG-일정시간전환: 종일↔시간 전환 저장과 저장 안내 문구
test('all-day event switched to timed sends Seoul times and closes after save',async({page})=>{
 const s=await open(page);s.convert=true;await edit(page);await expect(page.locator('#ciGoogleAllDay')).toBeChecked();
 await page.locator('#ciGoogleAllDay').uncheck();await expect(page.locator('#ciGoogleStartTime')).toBeVisible();
 await page.locator('#ciGoogleStartDate').fill('2026-10-23');await page.locator('#ciGoogleStartTime').fill('10:30');
 await page.locator('#ciGoogleEndDate').fill('2026-10-23');await page.locator('#ciGoogleEndTime').fill('12:30');
 await page.locator('#ciGoogleSave').click();await expect(page.locator('#ciGoogleModal')).toBeHidden();
 expect(s.writes).toHaveLength(1);expect(s.writes[0]).toMatchObject({action:'update-event',all_day:false,start_iso:'2026-10-23T01:30:00.000Z',end_iso:'2026-10-23T03:30:00.000Z'});
 await edit(page);await expect(page.locator('#ciGoogleAllDay')).not.toBeChecked();await expect(page.locator('#ciGoogleStartTime')).toHaveValue('10:30');await expect(page.locator('#ciGoogleEndTime')).toHaveValue('12:30');
});
test('timed event switched to all-day sends dates only and closes after save',async({page})=>{
 const s=await open(page,{timed:true});s.convert=true;await edit(page);await expect(page.locator('#ciGoogleAllDay')).not.toBeChecked();
 await page.locator('#ciGoogleAllDay').check();await expect(page.locator('#ciGoogleStartTime')).toBeHidden();
 await page.locator('#ciGoogleSave').click();await expect(page.locator('#ciGoogleModal')).toBeHidden();
 expect(s.writes[0]).toMatchObject({all_day:true,start_date:'2026-10-20',end_date:'2026-10-20'});expect(s.writes[0]).not.toHaveProperty('start_iso');
 await edit(page);await expect(page.locator('#ciGoogleAllDay')).toBeChecked();await expect(page.locator('#ciGoogleEndDate')).toHaveValue('2026-10-20');
});
test('Google time rejection shows Korean guidance only and the next click saves directly',async({page})=>{
 const s=await open(page);await edit(page);s.reject={status:400,error:'Invalid start time.'};
 await page.locator('#ciGoogleAllDay').uncheck();await page.locator('#ciGoogleStartTime').fill('10:30');await page.locator('#ciGoogleEndTime').fill('12:30');await page.locator('#ciGoogleSave').click();
 const status=page.locator('#ciGoogleStatus');await expect(status).toContainText('Google 캘린더가 시작·종료 시각을 받지 않아 저장하지 않았습니다.');await expect(status).toContainText('일정은 바뀌지 않았고 입력은 유지했습니다.');
 await expect(status).not.toContainText('Invalid');await expect(status).not.toContainText('위치를 확인');await expect(page.locator('#ciGoogleStartTime')).toHaveValue('10:30');await expect(page.locator('#ciGoogleSave')).toBeEnabled();
 s.reject=null;await page.locator('#ciGoogleSave').click();await expect(page.locator('#ciGoogleModal')).toBeHidden();expect(s.writes).toHaveLength(2);expect(s.reads).toBe(0);
});
test('unknown result explains the check-then-save retry in Korean',async({page})=>{
 const s=await open(page);await edit(page);s.reject={status:502,error:'upstream connect error'};
 await page.locator('#ciGoogleTitle').fill('합성 재저장');await page.locator('#ciGoogleSave').click();
 const status=page.locator('#ciGoogleStatus');await expect(status).toContainText('저장 결과를 확인하지 못했습니다. 입력은 유지했습니다.');await expect(status).toContainText('[변경사항 저장]을 다시 누르면 Google에 저장된 상태를 먼저 확인합니다.');await expect(status).not.toContainText('upstream');
 s.reject=null;await page.locator('#ciGoogleSave').click();await expect(status).toContainText('앞선 저장의 위치를 확인했습니다. 일정은 지금 「기존 캘린더」 캘린더에 있습니다.');await expect(status).toContainText('[변경사항 저장]을 한 번 더 눌러 주세요.');
 expect(s.writes).toHaveLength(1);await expect(page.locator('#ciGoogleTitle')).toHaveValue('합성 재저장');
 await page.locator('#ciGoogleSave').click();await expect(page.locator('#ciGoogleModal')).toBeHidden();expect(s.writes).toHaveLength(2);expect(s.writes[1].title).toBe('합성 재저장');
});
