import {test,expect} from '@playwright/test';
import {openEmphasisFixture} from './helpers/calendar-task-emphasis.mjs';
const task=(id,date,status='needsAction')=>({id,title:id,taskListId:'@default',due:date?date+'T00:00:00.000Z':null,status,...(status==='completed'?{completed:'2026-10-08T03:00:00Z'}:{})});
const orgs=['전국철도노동조합','서울교통공사노동조합','부산지하철노동조합','서해선지부','공항철도지부','김포도시철도지부'].map((name,i)=>({id:'d4c-org-'+i,name,active:true}));
for(const zone of ['Asia/Seoul','America/Los_Angeles'])for(const now of ['2026-10-08T14:59:59.999Z','2026-10-08T15:00:00.000Z']){
  test(`KST task buckets ${zone} ${now}`,async({browser})=>{
    const context=await browser.newContext({timezoneId:zone}),page=await context.newPage();
    const today=now.includes('14:59')?'2026-10-08':'2026-10-09';
    const date=n=>new Date(Date.parse(today+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
    await openEmphasisFixture(page,{view:'list',now:Date.parse(now),events:[],tasks:[task('overdue',date(-1)),task('today',date(0)),task('tomorrow',date(1)),task('seventh',date(7)),task('eighth',date(8)),task('undated'),task('done',date(0),'completed')]});
    await page.evaluate(()=>window.KPTURouter.go('tasks'));
    await expect(page.locator('#gt-today-head')).toHaveText('오늘 1');
    await expect(page.locator('#gt-week-head')).toHaveText('7일 안 2');
    for(const [group,ids] of [['overdue',['overdue']],['today',['today']],['week',['tomorrow','seventh']],['later',['eighth']],['undated',['undated']]]){
      await expect(page.locator(`[data-gt-${group}] [data-google-task]`)).toHaveCount(ids.length);
      expect(await page.locator(`[data-gt-${group}] [data-google-task]`).evaluateAll(es=>es.map(e=>e.dataset.googleTask))).toEqual(ids);
    }
    expect(await page.locator('#gtTaskBody>.gt-group .gt-group-head').allTextContents()).toEqual(['기한 지남 1','오늘 1','7일 안 2','나중 1','기한 없음 1','완료 1 ▸']);
    await page.locator('#gtCompleted summary').click();await expect(page.locator('#gtCompleted [data-google-task="done"]')).toBeVisible();
    await context.close();
  });
}
for(const width of [360,1280])for(const view of ['list','week'])test(`pending counts and retained done day rows ${width} ${view}`,async({page})=>{
  await page.setViewportSize({width,height:844});
  await openEmphasisFixture(page,{view,events:[],now:Date.parse('2026-10-08T03:00:00Z'),tasks:[task('late','2026-10-07'),task('late-done','2026-10-07','completed'),task('pending','2026-10-08'),task('done','2026-10-08','completed'),task('only-done','2026-10-09','completed')]});
  const week=view==='week'&&width>=1024,control=week?'.cmv-task-count':'.clv-tasks';
  const day=date=>page.locator(`${week?'#calendarWeek .cwv-day':'#calendarList .clv-day'}[data-date="${date}"]`);
  const pending=day('2026-10-08').locator(control);await expect(pending).toHaveText(week?'1':'일정 없음 · 할 일 1개 ›');
  await expect(day('2026-10-09').locator(control)).toHaveCount(0);
  if(week){await expect(day('2026-10-09').locator('.cwv-items .clv-event')).toHaveCount(0);await expect(day('2026-10-09').locator('.cwv-create')).toBeVisible()}else await expect(day('2026-10-09')).toContainText('일정 없음');
  await pending.click();await expect(page.locator('#calendarDayTasks [data-calendar-task]')).toHaveCount(2);await expect(page.locator('#calendarDayTasks [data-calendar-task="done"]')).toHaveClass(/done/);
  await page.locator('[data-close="calendarDayModal"]').click();
  if(!week)await page.locator('#prevMonthBtn').click();
  const late=day('2026-10-07').locator(control);await expect(late).toHaveText(week?'1':'일정 없음 · 할 일 1개 ›');
  await expect.poll(()=>late.evaluate(el=>getComputedStyle(el).color)).toBe(await page.evaluate(()=>{const e=document.createElement('span');e.style.color='var(--kptu-danger)';document.body.append(e);const color=getComputedStyle(e).color;e.remove();return color}));
});
for(const width of [360,1280])test(`modal titles and organization group boxes ${width}`,async({page})=>{
  await page.setViewportSize({width,height:640});
  await openEmphasisFixture(page,{view:'list',orgs});
  await page.waitForFunction(()=>window.__KPTU_RELOAD_SUBORGANIZATIONS__&&window.KPTUGoogleTasks);
  await page.evaluate(()=>window.__KPTU_RELOAD_SUBORGANIZATIONS__());
  async function groups(root,group,row){
    await expect(page.locator(root+' '+group)).toHaveCount(4);
    await expect(page.locator(root+' '+group).first()).toBeVisible();
    const sizes=await page.locator(root+' '+group).evaluateAll((es,row)=>es.map(e=>({background:getComputedStyle(e).backgroundColor,border:getComputedStyle(e).borderTopWidth,children:[...e.querySelectorAll(row)].map(x=>({height:x.getBoundingClientRect().height,border:getComputedStyle(x).borderTopWidth,background:getComputedStyle(x).backgroundColor}))})),row);
    expect(sizes.map(x=>x.children.length)).toEqual([1,2,2,1]);
    for(const g of sizes){expect(g.border).toBe('1px');expect(g.background).not.toBe('rgba(0, 0, 0, 0)');for(const r of g.children){expect(r.height).toBeGreaterThanOrEqual(44);expect(r.border).toBe('0px');expect(r.background).toBe('rgba(0, 0, 0, 0)')}}
  }
  await page.locator('#newEventBtn').click();await groups('#soEventOrgChecks','.so-org-group','label');await page.locator('[data-close="eventModal"]').click();
  await page.locator('[data-google-event="blue-0"]').first().click();await groups('#soGoogleEditOrgChecks','.so-org-group','label');await title('ciGoogleModal');await page.locator('#ciGoogleClose').click();
  await page.evaluate(()=>window.KPTUGoogleTasks.openEditor());await groups('#gtEditLinkBody [aria-label="조직"]','.gt-org-group','label');await title('gtTaskModal');await page.locator('[data-gt-close]').click();
  await page.evaluate(()=>window.KPTUGoogleTasks.openLinkPicker({project_id:'d4c-project'}));await title('gtPickModal');await page.locator('[data-gt-pick-close]').click();
  await page.evaluate(async()=>{await import('/app/task-layout.js');window.KPTUTaskLayout.openCreate()});await title('taskModal');await page.locator('[data-close="taskModal"]').click();
  await page.evaluate(()=>window.KPTURouter.go('team'));await groups('#soOrganizationList','.so-org-group','.so-card');
  async function title(id){
    await expect(page.locator('#'+id)).toBeVisible();await expect(page.locator('#'+id+' .modal-head .eyebrow')).toHaveCount(0);await expect(page.locator('#'+id+' h2')).toBeVisible();
    expect(await page.locator('#'+id+' h2').evaluate(el=>el.getBoundingClientRect().top-el.closest('.modal-head').getBoundingClientRect().top)).toBeLessThanOrEqual(1);
  }
});
