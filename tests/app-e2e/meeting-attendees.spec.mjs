// S56-31 MTG-참석인원칸: [회의] '회의 결과' 맨 위 참석인원 한 줄 — 쓰기 창 저장, 다른 칸에는 없음, 상세 머리 줄·고치기, 서버 칸이 없으면 숨김.
// 모든 이름·글은 합성 값. KPTU_SHOTS=1이면 docs/design/screens/s56-31/에 사진을 남긴다(PR 첨부용).
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {fillDateTime} from './helpers/date-time.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {showAllReportWeeks} from './helpers/report-week.mjs';
import {mrdMenu,openMeetingResult} from './helpers/meeting-open.mjs';
import {pickReportKind} from './helpers/report-filter.mjs';

import {addReport} from './helpers/report-add.mjs';
test.use({timezoneId:'Asia/Seoul'});
const SHOTS=process.env.KPTU_SHOTS==='1';
const shot=async(target,name)=>{if(SHOTS)await target.screenshot({path:`docs/design/screens/s56-31/${name}.png`})};

function state({column=true}={}){
  const s=baseState();s.meetingWrites=[];
  const row=(id,name,at,extra={})=>({id,workspace_id:s.workspace.id,title:name,series_name:name,round_no:null,meeting_at:at,transcript_text:'합성 결과 '+id,location:'합성 회의실',created_by:s.user.id,...extra});
  s.meetings=[
    row('m-1','합성 운영위원회','2026-10-08T01:00:00Z',{round_no:3,activity_kind:'meeting',...(column?{attendees:'12명 (위원장 외 11명)'}:{})}),
    row('q-1','합성 정책 토론회','2026-10-15T05:00:00Z',{activity_kind:'policy',...(column?{attendees:null}:{})})
  ];
  return s;
}
async function open(page,s,width,{column=true}={}){
  await page.setViewportSize({width,height:width>760?900:915});await mockApp(page,s);
  // 서버에 참석인원 칸이 아직 없을 때(적용 전): 그 칸을 묻는 요청만 400.
  if(!column)await page.route(/\/rest\/v1\/app_meetings\?select=attendees&limit=1/,route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'42703',message:'column app_meetings.attendees does not exist'})}));
  await signIn(page,testOrigin+'/app/?view=reports');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  await expect(page.locator('#meetingsView')).toBeVisible();await showAllReportWeeks(page);
}
// [회의] 칸은 회의명 고르기가 먼저 보일 수 있다: 사람이 하듯 [직접 입력]을 고른다.
const nameOther=async page=>{if(await page.locator('#meetingNameSelect').isVisible())await page.locator('#meetingNameSelect').selectOption('__other__')};
const above=async(page,a,b)=>page.evaluate(([a,b])=>document.querySelector(a).getBoundingClientRect().bottom<=document.querySelector(b).getBoundingClientRect().top+1,[a,b]);

for(const width of [412,1280])test(`${width}: 쓰기 창 [회의] 칸 — 회의 결과 맨 위 참석인원, 저장 본문에 attendees, 다른 칸은 숨김·안 보냄`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=state();await open(page,s,width);
  await pickReportKind(page,'회의');await addReport(page);
  const modal=page.locator('#meetingModal');await expect(modal).toBeVisible();
  const row=page.locator('#meetingAttendeesRow'),input=page.locator('#meetingAttendees');
  await expect(row).toBeVisible();await expect(row).toContainText('참석인원');await expect(row).toContainText('안 써도 됨');
  await expect(input).toHaveValue('');await expect(input).toHaveAttribute('maxlength','200');
  expect(await above(page,'#meetingAttendeesRow','#meetingTranscript')).toBe(true);
  // 장소 칸과 같은 부품·높이.
  const [h1,h2]=await page.evaluate(()=>['#meetingAttendees','#meetingLocation'].map(s=>Math.round(document.querySelector(s).getBoundingClientRect().height)));
  expect(h1).toBe(h2);
  await nameOther(page);await page.locator('#meetingTitle').fill('합성 운영위원회');await fillDateTime(page,'#meetingAt','2026-10-22T10:00');
  await input.fill('8명 (위원장 외 7명)');await page.locator('#meetingTranscript').fill('합성 결과 원문');
  await row.evaluate(el=>el.scrollIntoView({block:'center'}));await shot(modal.locator('.modal-card'),width>760?'pc-1280-write':'phone-412-write');
  // 다른 칸으로 바꾸면 숨고, 다시 [회의]면 쓴 값이 남는다.
  const pick=page.locator('#meetingKindPick');
  await pick.getByRole('radio',{name:'정책',exact:true}).click();await expect(row).toBeHidden();
  await pick.getByRole('radio',{name:'회의',exact:true}).click();await expect(row).toBeVisible();await expect(input).toHaveValue('8명 (위원장 외 7명)');
  await page.locator('#saveMeetingBtn').click();
  await expect.poll(()=>s.meetingWrites.at(-1)?.attendees).toBe('8명 (위원장 외 7명)');
  expect(s.meetingWrites.at(-1)).toMatchObject({activity_kind:'meeting',transcript_text:'합성 결과 원문'});
  await expect(modal).toBeHidden();
  // 다른 칸 저장은 참석인원을 보내지 않는다. 창을 다시 열면 빈 칸.
  await pickReportKind(page,'정책');await addReport(page,'policy');await expect(modal).toBeVisible();
  await expect(row).toBeHidden();
  await page.locator('#meetingTitle').fill('합성 정책 토론');await fillDateTime(page,'#meetingAt','2026-10-23T10:00');
  await page.locator('#saveMeetingBtn').click();
  await expect.poll(()=>s.meetingWrites.at(-1)?.activity_kind).toBe('policy');
  expect(Object.hasOwn(s.meetingWrites.at(-1),'attendees')).toBe(false);
  expect(errors).toEqual([]);
});

for(const width of [412,1280])test(`${width}: 보고 상세 머리 줄에 참석, 고치기에서 같은 칸 — 바꾸면 PATCH, 비우면 null, 다른 칸 기록에는 없음`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=state();await open(page,s,width);
  await pickReportKind(page,'회의');await openMeetingResult(page,'m-1');
  await expect(page.locator('#mrdMeta')).toContainText('장소 합성 회의실 · 참석 12명 (위원장 외 11명)');
  await shot(page,width>760?'pc-1280-detail':'phone-412-detail');
  await mrdMenu(page,'edit');
  const row=page.locator('#mrdEditAttendeesRow'),input=page.locator('#mrdEditAttendees');
  await expect(row).toBeVisible();await expect(input).toHaveValue('12명 (위원장 외 11명)');
  expect(await above(page,'#mrdEditAttendeesRow','#mrdEditTranscript')).toBe(true);
  await input.fill('13명 (위원장 외 12명)');
  await row.evaluate(el=>el.scrollIntoView({block:'center'}));await shot(page,width>760?'pc-1280-edit':'phone-412-edit');
  await page.locator('#mrdSaveEdit').click();
  await expect.poll(()=>s.meetingWrites.at(-1)?.attendees).toBe('13명 (위원장 외 12명)');
  await expect(page.locator('#mrdMeta')).toContainText('참석 13명 (위원장 외 12명)');
  // 비우면 null.
  await mrdMenu(page,'edit');await input.fill('');await page.locator('#mrdSaveEdit').click();
  await expect.poll(()=>s.meetingWrites.at(-1)?.attendees===null).toBe(true);
  await expect(page.locator('#mrdMeta')).not.toContainText('참석');
  expect(errors).toEqual([]);
});

test('1280: 다른 칸 기록 고치기에는 참석인원 줄이 없고 보내지도 않는다',async({page})=>{
  const s=state();await open(page,s,1280);
  await pickReportKind(page,'정책');
  await expect(page.locator('#meetingList #mcolResult')).toHaveAttribute('data-meeting-result','q-1');
  await mrdMenu(page,'edit');await expect(page.locator('#mrdEditAttendeesRow')).toBeHidden();
  await page.locator('#mrdEditTranscript').fill('합성 정책 결과 고침');await page.locator('#mrdSaveEdit').click();
  await expect.poll(()=>s.meetingWrites.at(-1)?.transcript_text).toBe('합성 정책 결과 고침');
  expect(Object.hasOwn(s.meetingWrites.at(-1),'attendees')).toBe(false);
});

test('412: 서버에 칸이 아직 없으면 쓰기 창·고치기 모두 참석인원 줄을 숨기고 보내지 않는다',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=state({column:false});await open(page,s,412,{column:false});
  await pickReportKind(page,'회의');await addReport(page);
  await expect(page.locator('#meetingModal')).toBeVisible();await expect(page.locator('#meetingLocationRow')).toBeVisible();
  await expect(page.locator('#meetingAttendeesRow')).toBeHidden();
  await nameOther(page);await page.locator('#meetingTitle').fill('합성 운영위원회');await fillDateTime(page,'#meetingAt','2026-10-22T10:00');
  await page.locator('#meetingAttendees').evaluate(el=>{el.value='숨은 값'});
  await page.locator('#saveMeetingBtn').click();
  await expect.poll(()=>s.meetingWrites.at(-1)?.series_name).toBe('합성 운영위원회');
  expect(Object.hasOwn(s.meetingWrites.at(-1),'attendees')).toBe(false);
  await expect(page.locator('#meetingModal')).toBeHidden();
  await openMeetingResult(page,'m-1');await mrdMenu(page,'edit');
  await expect(page.locator('#mrdEditLocationRow')).toBeVisible();await expect(page.locator('#mrdEditAttendeesRow')).toBeHidden();
  await page.locator('#mrdEditTranscript').fill('합성 결과 고침');await page.locator('#mrdSaveEdit').click();
  await expect.poll(()=>s.meetingWrites.at(-1)?.transcript_text).toBe('합성 결과 고침');
  expect(Object.hasOwn(s.meetingWrites.at(-1),'attendees')).toBe(false);
  expect(errors).toEqual([]);
});
