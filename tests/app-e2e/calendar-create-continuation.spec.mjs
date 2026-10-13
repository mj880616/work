import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
async function continued(page,{oldEdge=false,partial=false,readFail=false,lost=false,omitLocation=false}={}){
 await openHome(page,{query:'?view=calendar'});await page.waitForFunction(()=>window.KPTUCalendarPlus&&window.__KPTU_CALENDAR_PERSISTENCE_READY__);await page.evaluate(()=>window.__KPTU_CALENDAR_PERSISTENCE_READY__);
 const calendars=[{id:'source',summary:'기존 캘린더',accessRole:'owner'},{id:'target',summary:'새 캘린더',accessRole:'writer'}],state={writes:[],reads:[],event:null,partial,readFail,lost};let release;const gate=new Promise(r=>release=r);
 await page.evaluate(calendars=>window.__KPTU_GOOGLE_STATE__={connected:true,selected:['source'],calendars,colors:{}},calendars);
 await page.route(SB+'/functions/v1/google-calendar**',async r=>{
  const u=new URL(r.request().url()),body=r.request().method()==='POST'?r.request().postDataJSON():null;
  const ok=x=>r.fulfill({json:x});
  if(!body){if(u.searchParams.get('action')==='event'){const calendar=u.searchParams.get('calendarId');state.reads.push(calendar);if(state.readFail||state.event?.calendarId!==calendar)return r.fulfill({status:400,json:{error:'일정 조회 실패'}});return ok({event:state.event,eventColors:{}})}return ok(u.searchParams.get('action')==='events'?{events:state.event?[state.event]:[],eventColors:{}}:{connected:true,selected:['source'],calendars,colors:{}})}
  state.writes.push(body);if(body.action==='create-event')await gate;
  const moved=!!body.target_calendar_id&&body.target_calendar_id!==body.calendar_id;
  const previous=state.event;
  // Mirrors real normEvent and the audited update-event contract: the old Edge ignores
  // requested location; a partial move returns the actual destination with old content.
  state.event=state.partial&&moved?{...previous,calendarId:body.target_calendar_id}:{id:body.event_id||'created-event',calendarId:body.target_calendar_id||body.calendar_id,title:body.title,description:body.memo||'',location:body.action==='create-event'||!oldEdge?body.location||'':previous?.location||'',allDay:body.all_day,start:body.start_iso||body.start_date,end:body.end_iso||body.end_date,organizationIds:body.organization_ids||[],colorId:null,color:null,htmlLink:'',recurring:false,source:'google'};
  if(state.lost&&moved)return r.fulfill({status:503,json:{error:'이동 응답 불명'}});
  const responseEvent={...state.event};if(omitLocation&&body.action==='update-event')delete responseEvent.location;
  return ok(state.partial&&moved?{ok:false,moved:true,partial_failure:true,failed_stage:'contents',message:'일부 내용 저장 실패',event:responseEvent}:{ok:true,...(moved?{moved:true}:{}),event:responseEvent});
 });
 await page.locator('#newEventBtn').click();await expect(page.locator('#eventGoogleCalendar')).toHaveValue('source');await page.locator('#eventTitle').fill('처음 제목');await page.locator('#eventLocation').fill('Old venue');await page.locator('#saveEventBtn').click();await expect.poll(()=>state.writes.length).toBe(1);
 await page.locator('#eventTitle').fill('현재 제목');await page.locator('#eventLocation').fill('New venue');await page.locator('#eventDescription').fill('현재 메모');release();await expect(page.locator('#saveEventBtn')).toBeEnabled();await expect(page.locator('#eventModal')).toBeVisible();return state;
}
for(const width of [390,1280])test(`known event continuation sends its frozen address and selected destination ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const s=await continued(page);await page.locator('#eventGoogleCalendar').selectOption('target');await page.locator('#saveEventBtn').click();await expect(page.locator('#eventModal')).toBeHidden();expect(s.writes).toHaveLength(2);expect(s.writes[1]).toMatchObject({action:'update-event',event_id:'created-event',calendar_id:'source',target_calendar_id:'target',location:'New venue'});
});
test('old Edge location omission is partial and preserves the current form',async({page})=>{
 const s=await continued(page,{oldEdge:true});await page.locator('#saveEventBtn').click();await expect(page.locator('#eventStatus')).toContainText('장소');await expect(page.locator('#eventModal')).toBeVisible();await expect(page.locator('#eventLocation')).toHaveValue('New venue');await expect(page.locator('#eventTitle')).toHaveValue('현재 제목');expect(s.event.location).toBe('Old venue');await page.locator('#saveEventBtn').click();expect(s.writes.filter(x=>x.action==='create-event')).toHaveLength(1);
});
for(const readFail of [false,true])test(`continuation partial move keeps destination and the whole draft (fresh read fails=${readFail})`,async({page})=>{
 const s=await continued(page,{partial:true,readFail});await page.locator('#eventGoogleCalendar').selectOption('target');await page.locator('#eventStartDate').fill('2026-10-21');await page.locator('#eventEndDate').fill('2026-10-22');await page.locator('#eventGoogleColor button').nth(1).click();const color=await page.locator('#eventGoogleColor').getAttribute('data-selected-color');await page.locator('#saveEventBtn').click();await expect(page.locator('#eventStatus')).toContainText('입력');await expect(page.locator('#eventTitle')).toHaveValue('현재 제목');await expect(page.locator('#eventLocation')).toHaveValue('New venue');await expect(page.locator('#eventDescription')).toHaveValue('현재 메모');await expect(page.locator('#eventStartDate')).toHaveValue('2026-10-21');await expect(page.locator('#eventEndDate')).toHaveValue('2026-10-22');await expect(page.locator('#eventGoogleColor')).toHaveAttribute('data-selected-color',color);await expect(page.locator('#eventGoogleCalendar')).toHaveValue('target');s.partial=false;s.readFail=false;await page.locator('#saveEventBtn').click();await expect(page.locator('#eventModal')).toBeHidden();expect(s.writes[2].calendar_id).toBe('target');expect(s.writes[2]).not.toHaveProperty('target_calendar_id');expect(s.writes.filter(x=>x.action==='create-event')).toHaveLength(1);
});
test('unknown continuation move checks destination before another explicit save',async({page})=>{
 const s=await continued(page,{lost:true});await page.locator('#eventGoogleCalendar').selectOption('target');await page.locator('#saveEventBtn').click();await expect(page.locator('#eventStatus')).toContainText('확인');s.lost=false;await page.locator('#saveEventBtn').click();await expect(page.locator('#eventStatus')).toContainText('위치');expect(s.writes).toHaveLength(2);expect(s.reads).toContain('target');await expect(page.locator('#eventLocation')).toHaveValue('New venue');await page.locator('#saveEventBtn').click();await expect(page.locator('#eventModal')).toBeHidden();expect(s.writes[2].calendar_id).toBe('target');expect(s.writes[2]).not.toHaveProperty('target_calendar_id');
});

test('a missing returned location cannot confirm clearing the old venue',async({page})=>{
 const s=await continued(page,{oldEdge:true,omitLocation:true});await page.locator('#eventLocation').fill('');await page.locator('#saveEventBtn').click();await expect(page.locator('#eventStatus')).toContainText('장소');await expect(page.locator('#eventModal')).toBeVisible();await expect(page.locator('#eventLocation')).toHaveValue('');expect(s.event.location).toBe('Old venue');expect(s.writes.filter(x=>x.action==='create-event')).toHaveLength(1);
});
