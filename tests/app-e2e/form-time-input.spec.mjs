import {test,expect} from '@playwright/test';
import {openSeoulApp} from './helpers/seoul-time-fixture.mjs';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';

// FORM-시간입력: one 4-digit time cell for every form, event end follows the start, events keep a place.
// Fixture time is 2026-10-01 00:10 in Korea; every request is answered by the synthetic fixture.
for(const width of [390,1280])test.describe(`${width}px`,()=>{
  test.use({timezoneId:'Europe/Rome',viewport:{width,height:900}});

  test('일정 만들기: 4자리 시간·잘못된 시각 안내·종료 자동과 길이 유지',async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
    const s=await openSeoulApp(page);await page.locator('#newEventBtn').click();
    const start=page.locator('#eventStartTime'),end=page.locator('#eventEndTime'),endDate=page.locator('#eventEndDate');
    await expect(start).toHaveAttribute('inputmode','numeric');await expect(start).toHaveAttribute('type','text');
    await expect(page.getByRole('textbox',{name:'시작 시간'})).toBeVisible();await expect(page.locator('#eventStartDate')).toHaveAttribute('type','date');

    // Four digits are tidied while typing; the untouched end is start + 2 hours.
    await page.locator('#eventTitle').fill('시간 입력');await start.fill('0900');
    await expect(start).toHaveValue('09:00');await expect(end).toHaveValue('11:00');await expect(endDate).toHaveValue('2026-10-01');
    // Three digits are tidied when the cell is left.
    await start.fill('930');await start.press('Tab');await expect(start).toHaveValue('09:30');await expect(end).toHaveValue('11:30');

    // The user sets the end (3 hours) — moving the start keeps that length.
    await end.fill('1230');await expect(end).toHaveValue('12:30');
    await start.fill('1405');await expect(start).toHaveValue('14:05');await expect(end).toHaveValue('17:05');
    // Past midnight the end date moves to the next day.
    await start.fill('2300');await expect(end).toHaveValue('02:00');await expect(endDate).toHaveValue('2026-10-02');

    // A wrong time stays as typed with a hint under the cell, and nothing is saved.
    await start.fill('2599');await start.press('Tab');
    const hint=page.locator('#'+await start.getAttribute('data-time-hint'));
    await expect(start).toHaveValue('2599');await expect(start).toHaveAttribute('aria-invalid','true');await expect(hint).toBeVisible();await expect(hint).toContainText('0930');
    await expect(start).toHaveAttribute('aria-describedby',await hint.getAttribute('id'));
    await page.locator('#saveEventBtn').click();await expect(page.locator('#eventStatus')).toContainText('시간을 확인');expect(s.writes).toEqual([]);
    await start.fill('1405');await expect(hint).toBeHidden();await expect(start).not.toHaveAttribute('aria-invalid','true');await expect(end).toHaveValue('17:05');await expect(endDate).toHaveValue('2026-10-01');

    // All-day events are left alone.
    await page.locator('#eventAllDay').check();await page.locator('#eventStartDate').fill('2026-10-05');await page.locator('#eventStartDate').dispatchEvent('change');
    await expect(endDate).toHaveValue('2026-10-01');await page.locator('#eventAllDay').uncheck();

    // Back to a timed event: the end (10-01 17:05) is now before the start (10-05), so it restarts at start + 2 hours.
    await page.locator('#eventStartDate').fill('2026-10-01');await expect(end).toHaveValue('16:05');await expect(endDate).toHaveValue('2026-10-01');
    await page.locator('#eventLocation').fill('본부 회의실');
    await page.locator('#saveEventBtn').click();await expect(page.locator('#eventModal')).toBeHidden();
    expect(s.writes[0]).toMatchObject({action:'create-event',location:'본부 회의실',start_iso:'2026-10-01T05:05:00.000Z',end_iso:'2026-10-01T07:05:00.000Z'});
    expect(errors).toEqual([]);
  });

  test('일정 수정: 장소 칸 불러오기·저장, 시작을 옮기면 기존 길이 유지',async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
    const s=await openSeoulApp(page);s.events.find(e=>e.id==='exec').location='본부 3층';
    await page.locator('#prevMonthBtn').click();await page.locator('#calendarGrid [data-google-event="exec"]').first().click();
    const place=page.getByRole('textbox',{name:'장소'});
    await expect(place).toBeVisible();await expect(page.locator('#ciGoogleLocation')).toHaveValue('본부 3층');
    await expect(page.locator('#ciGoogleStartTime')).toHaveValue('10:00');await expect(page.locator('#ciGoogleEndTime')).toHaveValue('11:00');
    await page.locator('#ciGoogleStartTime').fill('1330');await expect(page.locator('#ciGoogleEndTime')).toHaveValue('14:30');
    await place.fill('서울역 회의실');await page.locator('#ciGoogleSave').click();await expect(page.locator('#ciGoogleModal')).toBeHidden();
    expect(s.writes[0]).toMatchObject({action:'update-event',event_id:'exec',location:'서울역 회의실',start_iso:'2026-09-15T04:30:00.000Z',end_iso:'2026-09-15T05:30:00.000Z'});
    // Reopening keeps the previous values until the event is read again; wait until the editor is ready.
    await page.locator('#calendarGrid [data-google-event="exec"]').first().click();await expect(page.locator('#ciGoogleSave')).toBeEnabled();await expect(page.locator('#ciGoogleLocation')).toHaveValue('서울역 회의실');
    // Leaving the place empty clears it.
    await place.fill('');await page.locator('#ciGoogleSave').click();await expect(page.locator('#ciGoogleModal')).toBeHidden();expect(s.writes[1].location).toBe('');
    expect(errors).toEqual([]);
  });

  test('회의 일시: 날짜 고르기 + 4자리 시간, 잘못된 시각은 저장 안 함',async({page})=>{
    const s=baseState();s.meetingWrites=[];s.meetings=[];await mockApp(page,s);await signIn(page,'http://127.0.0.1:8123/app/?view=meetings');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
    await page.locator('#newMeetingBtn').click();
    const date=page.locator('#meetingAtDate'),time=page.locator('#meetingAtTime');
    await expect(date).toHaveAttribute('type','date');await expect(time).toHaveAttribute('inputmode','numeric');
    await expect(page.getByRole('textbox',{name:'일시 시간'})).toBeVisible();
    await page.locator('#meetingTitle').fill('시간 입력 회의');await date.fill('2026-10-11');await time.fill('2460');await time.press('Tab');
    await expect(time).toHaveAttribute('aria-invalid','true');await page.locator('#meetingTranscript').fill('원문');await page.locator('#saveMeetingBtn').click();
    await expect(page.locator('#meetingStatus')).toContainText('일시');expect(s.meetingWrites).toEqual([]);
    await time.fill('1405');await expect(time).toHaveValue('14:05');await expect(page.locator('#meetingAt')).toHaveValue('2026-10-11T14:05');
    await page.locator('#saveMeetingBtn').click();await expect.poll(()=>s.meetingWrites.at(-1)?.meeting_at).toBe('2026-10-11T05:05:00.000Z');
  });
});
