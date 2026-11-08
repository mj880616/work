// CAL-다른화면일정등록: 달력 화면을 한 번도 열지 않은 채 다른 화면의 [일정으로]를 눌러도 일정 등록 창의 Google 세부 캘린더·색이 채워지고,
// 종일을 켜면 시간 칸이 빠지고, [저장]하면 Google Calendar 저장 길(google-calendar create-event)로 들어간다.
// 창은 team.js KPTUEventCreate.open 한 곳에서 달력 묶음(KPTUViewLoader.load('calendar'))을 먼저 불러온 뒤 채운다.
// 못 불러오면 창 안에 한 줄 + [다시], [저장]은 잠긴다(무반응 없음). 서버는 흉내, 글은 모두 지어낸 것.
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const cid=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const fid=n=>`a0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const uid=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const famId='f0000000-0000-4000-8000-000000000001';
const cand=n=>({id:cid(n),kind:'request',summary:`가짜 요청 ${n}`,due:null,source_kind:'telegram',source_id:fid(n),source_day:'2026-10-06',evidence:'근거',project_id:null,organization_id:null,status:'open',task_id:null,task_due:null,created_at:`2026-10-06T0${n}:00:00Z`,decided_at:null});
const family=()=>[{id:famId,kind:'plan',body:'지어낸 약속 한 줄',said_when:null,firmness:'planned',origin:'telegram',origin_day:'2026-10-05',status:'new',created_at:'2026-10-06T02:30:00Z'}];
const base={workspace_id:'w',kind:'basket',title:null,created_at:'2026-10-06T00:00:00Z',updated_at:'2026-10-06T00:00:00Z',archived_at:null,ai_export_allowed:true,metadata:{},attachments:[]};
const notes=()=>[{...base,id:uid(1),raw_text:'지어낸 업데이트 하나',occurred_at:'2026-10-06T04:00:00Z'}];
const CALENDARS=[{id:'cal-a',summary:'가상 업무',accessRole:'owner',primary:true},{id:'cal-b',summary:'가상 개인',accessRole:'writer'}];
const COLORS={1:{background:'#a4bdfc',foreground:'#1d1d1d'},2:{background:'#7ae7bf',foreground:'#1d1d1d'}};

async function fixture(page,{width=390,failCalendarModule=false}={}){
  await page.setViewportSize({width,height:900});
  const writes=[],famPatches=[],candPatches=[],cands=[cand(1)];
  await openHome(page,{beforeLoad:async()=>{
    if(failCalendarModule)await page.route(/\/calendar-plus\.js(\?|$)/,r=>r.abort());
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_my_features',r=>r.fulfill({json:['telegram','family']}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_todo_candidates',async r=>{
      const req=r.request(),q=new URL(req.url()).searchParams;
      if(req.method()==='PATCH'){const id=q.get('id').replace(/^eq\./,''),body=req.postDataJSON(),row=cands.find(c=>c.id===id);candPatches.push({id,body});if(!row)return r.fulfill({json:[]});Object.assign(row,body);return r.fulfill({json:[{id,status:row.status,task_id:row.task_id,decided_at:row.decided_at}]});}
      const st=q.get('status');return r.fulfill({json:st==='eq.open'?cands.filter(c=>c.status==='open'):st?.startsWith('in.')?cands.filter(c=>c.status!=='open'):cands});
    });
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_todo_feedback',r=>r.request().method()==='POST'?r.fulfill({status:201,json:[{id:'e0000000-0000-4000-8000-000000000001'}]}):r.fulfill({json:[]}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_feed_items',r=>r.fulfill({json:[{id:fid(1),room_key:'room-a',room_label:'가상 지부방'}]}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_family_notes',r=>{
      const req=r.request();
      if(req.method()==='PATCH'){famPatches.push(req.postDataJSON());return r.fulfill({json:[{id:famId}]});}
      return r.fulfill({json:family()});
    });
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',r=>{
      const req=r.request(),q=new URL(req.url()).searchParams;
      if(req.method()==='GET')return r.fulfill({json:q.get('metadata')?[]:notes().filter(row=>!q.get('kind')||'eq.'+row.kind===q.get('kind'))});
      return r.fulfill({json:[]});
    });
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_record_links',r=>r.fulfill({json:[]}));
    await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/google-calendar',r=>{
      const req=r.request(),a=new URL(req.url()).searchParams.get('action');
      if(req.method()==='POST'){
        const body=req.postDataJSON();writes.push(body);
        return r.fulfill({json:{ok:true,event:{id:'created-event',calendarId:body.calendar_id,title:body.title,description:body.memo||'',location:body.location||'',allDay:body.all_day,start:body.start_iso||body.start_date,end:body.end_iso||body.end_date,organizationIds:[],colorId:null,color:null,htmlLink:'',recurring:false,source:'google'}}});
      }
      if(a==='events')return r.fulfill({json:{events:[],eventColors:COLORS}});
      return r.fulfill({json:{connected:true,enabled:true,selected:['cal-a'],calendars:CALENDARS,colors:{},eventColors:COLORS}});
    });
  }});
  await page.evaluate(()=>window.KPTURouter.go('basket'));
  await expect(page.locator('#basketView [data-forget-section]')).toBeVisible();
  // 이 시험의 전제: 달력 화면 묶음은 아직 불러오지 않았다.
  expect(await page.evaluate(()=>window.KPTUViewLoader.isLoaded('calendar'))).toBe(false);
  return {writes,famPatches,candPatches};
}
const line=(page,key)=>page.locator(`#basketView [data-nbx-row="${key}"]`);
const modal=page=>page.locator('#eventModal');

async function expectReadyAndSave(page,{writes},title){
  await expect(modal(page)).toBeVisible();
  await expect(page.locator('#eventTitle')).toHaveValue(title);
  // 세부 캘린더 목록과 색 칩이 채워진다.
  await expect(page.locator('#eventGoogleCalendar option')).toHaveText(['가상 업무 (기본)','가상 개인']);
  await expect(page.locator('#eventGoogleCalendar')).toHaveValue('cal-a');
  await expect(page.locator('#eventGoogleColor button').first()).toBeVisible();
  // 종일을 켜면 시간 칸이 빠지고, 끄면 돌아온다(달력 화면 창과 같은 규칙).
  await expect(page.locator('#eventAllDay')).toBeEnabled();
  await page.locator('#eventAllDay').check();
  await expect(page.locator('#eventStartTime')).toBeHidden();
  await expect(page.locator('#eventEndTime')).toBeHidden();
  await page.locator('#eventAllDay').uncheck();
  await expect(page.locator('#eventStartTime')).toBeVisible();
  await page.locator('#eventGoogleCalendar').selectOption('cal-b');
  await expect(page.locator('#saveEventBtn')).toBeEnabled();
  await page.locator('#saveEventBtn').click();
  await expect(modal(page)).toBeHidden();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({action:'create-event',calendar_id:'cal-b',title,all_day:false});
}

for(const width of [390,1280])test(`${width}px: 달력을 안 연 채 가족 줄 [일정으로] → 세부 캘린더·색·종일·저장`,async({page})=>{
  const s=await fixture(page,{width});
  await line(page,`f:${famId}`).locator('[data-nbx-act="event"]').click();
  await expectReadyAndSave(page,s,'지어낸 약속 한 줄');
  await expect.poll(()=>s.famPatches.length).toBe(1);
  expect(s.famPatches[0]).toMatchObject({status:'scheduled'});
});

test('달력을 안 연 채 텔레그램 요청 줄 [일정으로] → 저장되고 줄은 처리됨',async({page})=>{
  const s=await fixture(page);
  await line(page,`c:${cid(1)}`).locator('[data-nbx-act="event"]').click();
  await expectReadyAndSave(page,s,'가짜 요청 1');
  await expect.poll(()=>s.candPatches.length).toBe(1);
  expect(s.candPatches[0]).toMatchObject({id:cid(1),body:{status:'done'}});
});

test('달력을 안 연 채 업데이트 줄 [일정으로] → 세부 캘린더·색이 채워지고 저장된다',async({page})=>{
  const s=await fixture(page,{width:884});
  await line(page,`u:${uid(1)}`).locator('[data-nbx-act="event"]').click();
  await expectReadyAndSave(page,s,'지어낸 업데이트 하나');
});

test('달력 묶음을 못 불러오면 창 안에 한 줄 + [다시], [저장]·종일은 잠긴다',async({page})=>{
  const s=await fixture(page,{failCalendarModule:true});
  await line(page,`f:${famId}`).locator('[data-nbx-act="event"]').click();
  await expect(modal(page)).toBeVisible();
  const fail=page.locator('#eventStatus [data-wait-fail]');
  await expect(fail).toContainText('일정 창을 준비하지 못했어요');
  await expect(fail.getByRole('button',{name:'다시'})).toBeVisible();
  await expect(page.locator('#saveEventBtn')).toBeDisabled();
  await expect(page.locator('#eventAllDay')).toBeDisabled();
  expect(s.writes).toHaveLength(0);
});
