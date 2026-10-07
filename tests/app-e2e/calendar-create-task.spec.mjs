import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
test.use({timezoneId:'Asia/Seoul',viewport:{width:360,height:844}});
async function open(page){
 const result=await openHome(page,{query:'?view=calendar'});
 await expect(page.locator('#calendarView')).toBeVisible();
 await page.waitForFunction(()=>window.KPTUCalendarPlus&&window.KPTUCalendarTasks);
 await page.locator('#newEventBtn').click();return result;
}
test('registration always opens as event; task mode keeps title/date and hides event fields',async({page})=>{
 await open(page);await expect(page.locator('#eventModalTitle')).toHaveText('일정 등록');
 await expect(page.locator('#eventModal .eyebrow')).toHaveCount(0);
 await page.locator('#eventTitle').fill('QA');await page.locator('#eventStartDate').fill('2026-10-09');
 await page.locator('[data-event-mode="task"]').click();await expect(page.locator('#eventModalTitle')).toHaveText('할 일 등록');
 for(const id of ['eventGoogleOptions','eventAllDay','eventStartTime','eventEndDate','eventEndTime','eventLocation','soEventOrganizations'])await expect(page.locator('#'+id)).toBeHidden();
 await expect(page.locator('#eventTitle')).toHaveValue('QA');await expect(page.locator('#eventStartDate')).toHaveValue('2026-10-09');
 await page.locator('[data-event-mode="event"]').click();await expect(page.locator('#eventGoogleOptions')).toBeVisible();await expect(page.locator('#eventStartDate')).toHaveValue('2026-10-09');
 await page.locator('[data-event-mode="task"]').click();await page.locator('[data-close="eventModal"]').click();await page.locator('#newEventBtn').click();
 await expect(page.locator('[data-event-mode="event"]')).toHaveAttribute('aria-pressed','true');
 const boxes=await page.locator('[data-event-mode]').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {top:r.top,height:r.height,target:parseFloat(getComputedStyle(e,'::after').height),right:r.right}}));expect(boxes[0].top).toBe(boxes[1].top);expect(boxes.every(r=>r.height===36&&r.target>=44&&r.right<=360)).toBeTruthy();
});
test('monthly blank cell supplies the task date',async({page})=>{
 await open(page);await page.locator('[data-close="eventModal"]').click();await page.locator('[data-calendar-view="month"]').click();
 await page.locator('.cal-cell[data-date="2026-10-12"]').click({position:{x:15,y:70}});
 await expect(page.locator('#eventModal')).toBeVisible();await page.locator('[data-event-mode="task"]').click();await expect(page.locator('#eventStartDate')).toHaveValue('2026-10-12');
});
test('task uses shared save path with date-only, project and notes; refreshes calendar and home',async({page})=>{
 await open(page);const bodies=[];
 await page.route(SB+'/functions/v1/google-tasks?action=create',r=>{bodies.push(r.request().postDataJSON());return r.fulfill({json:{task:{id:'created'}}});});
 await page.locator('[data-event-mode="task"]').click();await page.locator('#eventTitle').fill('QA');await page.locator('#eventStartDate').fill('2026-10-06');await page.locator('#eventDescription').fill('QA notes');
 await page.locator('#eventTaskProject').click();await page.locator('#eventProjectSheet').getByRole('button',{name:'자식 프로젝트',exact:true}).click();await expect(page.locator('#eventTaskProject')).toBeFocused();
 let overview=0;await page.route(SB+'/functions/v1/google-tasks?action=overview*',r=>{overview++;return r.fulfill({json:{connected:true,authorized:true,tasks:[{id:'created',title:'QA',due:'2026-10-06',status:'needsAction'}]}});});
 await page.locator('#saveEventBtn').click();await expect(page.locator('#eventModal')).toBeHidden();await expect(page.locator('#toast')).toHaveText('할 일을 추가했습니다.');
 expect(bodies).toEqual([{action:'create',task_id:null,title:'QA',due:'2026-10-06',links:[{project_id:'child'}],notes:'QA notes'}]);await expect.poll(()=>overview).toBeGreaterThan(0);
 await expect(page.locator('#calendarList [data-date="2026-10-06"] .clv-tasks')).toContainText('할 일 1개');
 await page.evaluate(()=>window.KPTURouter.go('home'));await expect(page.locator('[data-home-cards]')).toContainText('QA');
});
test('task failure retains draft and blocks repeated saves; undated and partial success are supported',async({page})=>{
 await open(page);await page.locator('[data-event-mode="task"]').click();await page.locator('#eventTitle').fill('QA');await page.locator('#eventStartDate').fill('');
 const bodies=[];let release;const gate=new Promise(r=>release=r);let fail=true;
 await page.route(SB+'/functions/v1/google-tasks?action=create',async r=>{bodies.push(r.request().postDataJSON());await gate;return r.fulfill({status:fail?500:200,json:fail?{message:'QA error'}:{task:{id:'created'},link_error:true}});});
 await page.locator('#saveEventBtn').click();await expect(page.locator('[data-event-mode="event"]')).toBeDisabled();await page.locator('#saveEventBtn').dispatchEvent('click');release();await expect(page.locator('#eventStatus')).toContainText('QA error');await expect(page.locator('#eventTitle')).toHaveValue('QA');expect(bodies).toHaveLength(1);expect(bodies[0].due).toBeNull();
 fail=false;await page.locator('#saveEventBtn').click();await expect(page.locator('#eventModal')).toBeHidden();await expect(page.locator('#toast')).toContainText('프로젝트 연결 실패');
});
test('event mode still sends the existing calendar request',async({page})=>{
 await open(page);const writes=[];await page.route(SB+'/functions/v1/google-calendar',r=>{writes.push(r.request().postDataJSON());return r.fulfill({json:{ok:true}});});
 await page.locator('#eventTitle').fill('QA');await page.locator('#saveEventBtn').click();await expect(page.locator('#eventModal')).toBeHidden();expect(writes[0]).toMatchObject({action:'create-event',title:'QA',all_day:false});expect(writes[0]).toHaveProperty('start_iso');expect(writes[0]).not.toHaveProperty('links');
});
test('project selection survives token refresh; sheet Back and Escape preserve registration',async({page})=>{
 await open(page);await page.locator('[data-event-mode="task"]').click();await page.locator('#eventTaskProject').click();
 await page.locator('#eventProjectSheet').getByRole('button',{name:'자식 프로젝트',exact:true}).click();await expect(page.locator('#eventTaskProject')).toBeFocused();
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('kptu:session-changed',{detail:{session:window.KPTURuntime.session.read()}})));
 await expect(page.locator('#eventTaskProject')).toContainText('자식 프로젝트');
 for(const close of ['Escape','Back']){
  await page.locator('#eventTaskProject').click();await expect(page.locator('#eventProjectSheet')).toBeVisible();
  if(close==='Escape')await page.keyboard.press('Escape');else await page.goBack();
  await expect(page.locator('#eventProjectSheet')).toBeHidden();await expect(page.locator('#eventModal')).toBeVisible();await expect(page.locator('#eventTaskProject')).toBeFocused();
 }
});
test('pending event save locks mode changes',async({page})=>{
 await open(page);await page.locator('#eventTitle').fill('QA');let release;const gate=new Promise(r=>release=r);
 await page.route(SB+'/functions/v1/google-calendar',async r=>{await gate;return r.fulfill({json:{ok:true}});});
 await page.locator('#saveEventBtn').click();await expect(page.locator('[data-event-mode="task"]')).toBeDisabled();release();await expect(page.locator('#eventModal')).toBeHidden();
});
test('desktop task registration keeps fields and shared project sheet usable',async({page})=>{
 await page.setViewportSize({width:1280,height:900});await open(page);await page.locator('[data-event-mode="task"]').click();
 await expect(page.getByLabel('날짜 (선택)',{exact:true})).toHaveValue('2026-10-06');await page.locator('#eventTaskProject').click();
 await page.locator('#eventProjectSheet').getByRole('button',{name:'프로젝트 없음',exact:true}).click();await expect(page.locator('#eventTaskProject')).toBeFocused();await expect(page.locator('#eventModal')).toBeVisible();
});
test('project button retains its transparent 44px target',async({page})=>{
 await open(page);await page.locator('[data-event-mode="task"]').click();const b=page.locator('#eventTaskProject');
 const point=await b.evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top-2}});
 expect(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('button')?.id,point)).toBe('eventTaskProject');
 await page.mouse.click(point.x,point.y);await expect(page.locator('#eventProjectSheet')).toBeVisible();
});
