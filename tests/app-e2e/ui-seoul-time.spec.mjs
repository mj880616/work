import { appOrigin } from './helpers/test-origin.mjs';
import {readFileSync} from 'node:fs';
import {test,expect} from '@playwright/test';
import {openSeoulApp} from './helpers/seoul-time-fixture.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {fillDateTime} from './helpers/date-time.mjs';
import {closeProjectDetail,expectProjectDetail} from './helpers/project-detail.mjs';
for(const timezoneId of ['Asia/Seoul','Europe/Rome','America/Los_Angeles'])for(const width of [390,1280])test.describe(`${timezoneId} ${width}`,()=>{
  test.use({timezoneId,viewport:{width,height:900}});
  test('월 날짜 칸·한국 오늘·자정·월 경계·종일',async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
    const s=await openSeoulApp(page);await expect(page.locator('.cal-cell.today')).toHaveAttribute('data-date','2026-10-01');
    await expect(page.locator('#calendarGrid [data-google-event="early"]').first()).toContainText('00:30');
    await expect(page.locator('#calendarGrid [data-google-event="late"]').first()).toContainText('23:30');
    for(const [id,date,time] of [['early','2026-10-01','00:30'],['late','2026-09-30','23:30'],['all','2026-10-01','종일']]){
      await page.evaluate(date=>window.KPTUCalendarDayOverflow.open(new Date(date+'T00:00:00+09:00'),window.KPTUCalendarMonthView.dayEvents(new Date(date+'T00:00:00+09:00'))),date);
      await expect(page.locator(`#calendarDayList [data-google-event="${id}"]`)).toContainText(time);
      const other=id==='early'?'late':id==='late'?'early':'late';await expect(page.locator(`#calendarDayList [data-google-event="${other}"]`)).toHaveCount(0);
      await page.locator('#calendarDayModal [data-close]').click();
    }
    expect(s.ranges.length).toBeGreaterThan(0);await expect.poll(()=>s.ranges.some(r=>r.min==='2026-09-26T15:00:00.000Z'&&r.max==='2026-10-31T15:00:00.000Z')).toBe(true);
    expect(await page.locator('#calendarGrid [data-google-event="boundary"]').first().evaluate(el=>el.style.gridColumn)).toBe('4 / span 2');
    await page.evaluate(()=>{const date=new Date('2026-10-01T00:00:00+09:00');window.KPTUCalendarDayOverflow.open(date,window.KPTUCalendarMonthView.dayEvents(date))});
    await expect(page.locator('#calendarDayList [data-google-event="boundary"]')).toBeVisible();await expect(page.locator('#calendarDayList [data-google-event="midnight-end"]')).toHaveCount(0);await page.locator('#calendarDayModal [data-close]').click();
    await page.locator('#prevMonthBtn').click();await expect(page.locator('#calendarGrid [data-google-event="exec"]').first()).toContainText('10:00');
    await page.locator('#calendarGrid [data-google-event="exec"]').first().click();await expect(page.locator('#ciGoogleStartDate')).toHaveValue('2026-09-15');await expect(page.locator('#ciGoogleStartTime')).toHaveValue('10:00');expect(errors).toEqual([]);
  });
  test('새 일정 저장·다시 열기·수정 저장·종일 왕복·목록/주간',async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
    const s=await openSeoulApp(page);await page.locator('#newEventBtn').click();
    await expect(page.locator('#eventStartDate')).toHaveValue('2026-10-01');await expect(page.locator('#eventStartTime')).toHaveValue('00:10');
    await page.locator('#eventTitle').fill('저장 왕복');for(const id of ['Start','End'])await page.locator('#event'+id+'Date').fill('2026-10-01');await page.locator('#eventStartTime').fill('00:30');await page.locator('#eventEndTime').fill('01:30');
    await page.locator('#saveEventBtn').click();await expect(page.locator('#eventModal')).toBeHidden();expect(s.writes[0].start_iso).toBe('2026-09-30T15:30:00.000Z');
    await page.locator('#calendarGrid [data-google-event="saved-1"]').first().click();await expect(page.locator('#ciGoogleStartTime')).toHaveValue('00:30');await expect(page.locator('#ciGoogleStartDate')).toHaveValue('2026-10-01');
    await page.locator('#ciGoogleTitle').fill('왕복 수정');await page.locator('#ciGoogleSave').click();await expect(page.locator('#ciGoogleModal')).toBeHidden();expect(s.writes[1].start_iso).toBe(s.writes[0].start_iso);expect(s.writes[1].end_iso).toBe(s.writes[0].end_iso);
    await page.locator('#calendarGrid [data-google-event="all"]').first().click();await expect(page.locator('#ciGoogleStartDate')).toHaveValue('2026-10-01');await expect(page.locator('#ciGoogleEndDate')).toHaveValue('2026-10-01');await page.locator('#ciGoogleSave').click();await expect(page.locator('#ciGoogleModal')).toBeHidden();expect(s.writes[2]).toMatchObject({all_day:true,start_date:'2026-10-01',end_date:'2026-10-01'});
    await page.locator('[data-calendar-view="list"]').click();await expect(page.locator('#calendarList [data-date="2026-10-01"] [data-google-event="early"]')).toContainText('00:30');await expect.poll(()=>s.ranges.some(r=>r.min==='2026-09-30T15:00:00.000Z'&&r.max==='2026-10-14T15:00:00.000Z')).toBe(true);
    if(width===1280){await page.locator('[data-calendar-view="week"]').click();await expect(page.locator('#calendarWeek [data-date="2026-10-01"] [data-google-event="early"]')).toContainText('00:30');await expect.poll(()=>s.ranges.some(r=>r.min==='2026-09-27T15:00:00.000Z'&&r.max==='2026-10-04T15:00:00.000Z')).toBe(true);}
    expect(errors).toEqual([]);
  });
  test('프로젝트 주요 일정·기록·오늘 기본값·회의·홈',async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
    const s=await openSeoulApp(page,{target:`${appOrigin}/app/?view=projects`});await page.locator('#projectGrid .ps3-plist [data-ps3-project="top-a"]').click();await expectProjectDetail(page,'top-a');
    await page.locator('#ps3-milestones summary').click();await expect(page.locator('#ps3-milestones')).toContainText('오전 12:30');await page.locator('[data-ps3-edit-milestone="seoul-mile"]').click();await expect(page.locator('#ps3MilestoneAt')).toHaveValue('2026-10-01T00:30');
    await page.locator('#ps3MilestoneSave').click();await expect(page.locator('#ps3MilestoneModal')).toBeHidden();expect(s.milestones[0].start_at).toBe('2026-09-30T15:30:00.000Z');
    await page.locator('[data-ps3-add-milestone]').click();await page.locator('#ps3MilestoneTitle').fill('새 한국 주요 일정');await fillDateTime(page,'#ps3MilestoneAt','2026-10-01T23:30');await page.locator('#ps3MilestoneSave').click();await expect(page.locator('#ps3MilestoneModal')).toBeHidden();expect(s.milestones.at(-1).start_at).toBe('2026-10-01T14:30:00.000Z');
    // UI-프로젝트화면정리: the memo box (with its Seoul time) is gone from the project detail.
    await expect(page.locator('#ps3-memos')).toHaveCount(0);
    // decisions() is currently dormant. Exercise its real renderer in a browser without exposing it in the app.
    const source=readFileSync(new URL('../../app/project-system-v3.js',import.meta.url),'utf8');
    const renderer=source.slice(source.indexOf('function decisions(d){'),source.indexOf('function pagesHtml(d){'));
    const fmt=source.match(/const fmt=[^;]+;/)[0];
    const html=await page.evaluate(async({renderer,fmt})=>{
      const {formatMeetingTime}=await import('/app/meeting-time.js');
      return new Function('formatMeetingTime','esc','moduleTitle','empty','data',fmt+'\n'+renderer+';return decisions(data)')(formatMeetingTime,String,(_d,_k,title)=>title,()=>'',{decisions:[{title:'한국 결정',body:'내용',decided_at:'2026-09-30T15:30:00Z'}],meetings:[]});
    },{renderer,fmt});expect(html).toContain('10. 1. 오전 12:30');
    await closeProjectDetail(page);await page.locator('#newProjectBtn').click();await expect(page.locator('#ps3CreateStart')).toHaveValue('2026-10-01');await page.locator('[data-ps3-close="ps3CreateModal"]').click();await clickView(page,'meetings');await expect(page.locator('#meetingList :is([data-mrd-meeting="seoul-meeting"],[data-meeting-round="seoul-meeting"])')).toContainText('오전 12:30');await clickView(page,'home');await expect(page.locator('#homeView')).toContainText('00:30');expect(errors).toEqual([]);
  });
});
