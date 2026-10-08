import {test,expect} from '@playwright/test';
import {openEmphasisFixture} from './helpers/calendar-task-emphasis.mjs';
const NOW=Date.parse('2026-10-08T03:00:00Z');
const task=(id,due=null,extra={})=>({id,title:id,taskListId:'@default',taskListTitle:'내 할 일',due,status:'needsAction',...extra});
async function open(page,tasks,options={}){await openEmphasisFixture(page,{view:'list',now:NOW,events:[],tasks,...options});await page.evaluate(()=>window.KPTURouter.go('tasks'));await expect(page.locator('[data-gt-count]')).toHaveText(`할 일 ${tasks.filter(t=>t.status!=='completed').length}개`);}
for(const width of [360,1280]){
 test(`nonempty groups, compact linked metadata and controls ${width}`,async({page})=>{
  await page.setViewportSize({width,height:844});
  const title='아주 긴 할 일 제목을 두 줄까지 보여 주고 나머지는 말줄임으로 처리하는 제목입니다 '.repeat(3);
  await open(page,[task('today','2026-10-08T00:00:00Z',{title,notes:'목록에서 숨길 메모'}),task('undated'),task('org')],{links:[{google_task_id:'today',project_id:'p',status:'confirmed'},{google_task_id:'org',organization_id:'o',status:'confirmed'}],projects:[{id:'p',name:'아주 긴 연결 프로젝트 이름 '.repeat(8),workspace_id:'qa-ws',owner_id:'qa-user',metadata:{project_system:'v2'},status:'active'}]});
  expect(await page.locator('#gtTaskBody>.gt-group .gt-group-head').allTextContents()).toEqual(['오늘 1','기한 없음 2']);
  await expect(page.locator('#gtCompleted,[data-gt-overdue],[data-gt-week],[data-gt-later]')).toHaveCount(0);
  const row=page.locator('[data-google-task="today"]');
  await expect(row.locator('.gt-project')).toContainText(' · 아주 긴 연결 프로젝트 이름');
  await expect(page.locator('[data-google-task="org"] .gt-project')).toHaveCount(0);
  await expect(page.locator('[data-google-task="undated"] .gt-meta')).toHaveCount(0);
  await expect(page.locator('#gtTaskBody')).not.toContainText('연결 안 됨');await expect(page.locator('#gtTaskBody')).not.toContainText('내 할 일');await expect(page.locator('#gtTaskBody')).not.toContainText('목록에서 숨길 메모');
  const metrics=await row.evaluate(el=>{const title=el.querySelector('b'),meta=el.querySelector('.gt-meta'),project=el.querySelector('.gt-project'),menu=el.querySelector('[data-gt-menu]');return {font:getComputedStyle(title).fontSize,clamp:getComputedStyle(title).webkitLineClamp,meta:getComputedStyle(meta).fontSize,whiteSpace:getComputedStyle(project).whiteSpace,ellipsis:getComputedStyle(project).textOverflow,menu:menu.getBoundingClientRect().toJSON(),scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth};});
  expect(metrics.font).toBe('14px');expect(metrics.clamp).toBe('2');expect(metrics.meta).toBe('12px');expect(metrics.whiteSpace).toBe('nowrap');expect(metrics.ellipsis).toBe('ellipsis');expect(metrics.menu.width).toBeGreaterThanOrEqual(44);expect(metrics.menu.height).toBeGreaterThanOrEqual(44);expect(metrics.scroll).toBeLessThanOrEqual(metrics.client+1);
  if(width===360&&process.env.TASK_SCREEN_SHOTS)await page.screenshot({path:'/workspace/artifacts/task-screen-360.png'});
  await row.locator('[data-gt-menu]').click();await expect(page.locator('#gtTaskMenu')).toBeVisible();
  if(width===360&&process.env.TASK_SCREEN_SHOTS)await page.screenshot({path:'/workspace/artifacts/task-menu-360.png'});await expect(page.locator('#gtTaskMenu button').first()).toBeFocused();
  await page.keyboard.press('Escape');await expect(page.locator('#gtTaskMenu')).toBeHidden();await expect(row.locator('[data-gt-menu]')).toBeFocused();
  await row.locator('[data-gt-menu]').click();await page.goBack();await expect(page.locator('#gtTaskMenu')).toBeHidden();await expect(row.locator('[data-gt-menu]')).toBeFocused();
  await row.locator('[data-gt-menu]').click();await page.locator('#gtTaskMenu').getByRole('button',{name:'편집',exact:true}).click();await expect(page.locator('#gtTaskModal')).toBeVisible();await expect(page.locator('#gtEditTitle')).toHaveValue(title);await page.locator('[data-gt-close]').click();
  await row.locator('[data-gt-edit]').click();await expect(page.locator('#gtTaskModal')).toBeVisible();await page.locator('[data-gt-close]').click();
  await page.evaluate(()=>window.KPTURouter.go('calendar'));await page.locator('[data-date="2026-10-08"] .clv-tasks').first().click();await expect(page.locator('#calendarDayTasks .gt-project')).toContainText('아주 긴 연결 프로젝트 이름');await expect(page.locator('#calendarDayTasks')).not.toContainText('연결 안 됨');
 });
 test(`empty state and scope information ${width}`,async({page})=>{
  await page.setViewportSize({width,height:844});await open(page,[]);
  await expect(page.locator('#gtTaskBody')).toHaveText('할 일이 없습니다');
  if(width===360&&process.env.TASK_SCREEN_SHOTS)await page.screenshot({path:'/workspace/artifacts/task-empty-360.png'});await expect(page.locator('#gtTaskBody .gt-group')).toHaveCount(0);await expect(page.locator('#newTaskBtn')).toHaveText('+ 할 일');
  await expect(page.locator('#gtTaskSection .gt-scope-note')).toHaveCount(0);await expect(page.locator('#gtTaskSection')).not.toContainText('Google 할 일');
  const info=page.getByRole('button',{name:'할 일 목록 안내',exact:true});const box=await info.boundingBox();expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);
  await info.click();await expect(page.locator('#gtScopeModal')).toContainText('Google "내 할 일" 목록만 보입니다.');await page.locator('#gtScopeModal [data-gt-scope-close]').click();await expect(page.locator('#gtScopeModal')).toBeHidden();await expect(info).toBeFocused();
  await info.click();await page.goBack();await expect(page.locator('#gtScopeModal')).toBeHidden();await expect(info).toBeFocused();
 });
 test(`overdue color and completed-only empty state ${width}`,async({page})=>{
  await page.setViewportSize({width,height:844});await open(page,[task('late','2026-10-07T00:00:00Z'),task('done',null,{status:'completed',completed:new Date(NOW).toISOString()})]);
  await expect(page.locator('[data-gt-overdue]')).toBeVisible();expect(await page.locator('.gt-row.overdue .gt-due').evaluate(el=>getComputedStyle(el).color)).toBe(await page.locator('#gt-overdue-head').evaluate(el=>getComputedStyle(el).color));await expect(page.locator('#gtCompleted')).not.toHaveAttribute('open','');
  await page.locator('[data-gt-toggle="late"]').click();await expect(page.locator('#gtTaskBody')).toContainText('할 일이 없습니다',{timeout:5000});await expect(page.locator('[data-gt-overdue]')).toHaveCount(0);await expect(page.locator('#gtCompleted')).toBeVisible();
 });
}

for(const dismiss of ['Escape','edit'])test(`late link lookup keeps open menu and keyboard focus through ${dismiss}`, async({page})=>{
 let release,started=false;const wait=new Promise(resolve=>release=resolve);
 await open(page,[task('delayed','2026-10-08')],{onLinks:async()=>{started=true;await wait;}});
 await expect.poll(()=>started).toBe(true);
 const trigger=page.locator('[data-gt-menu="delayed"]'),menu=page.locator('#gtTaskMenu');
 await trigger.click();await expect(menu.locator('button').first()).toBeFocused();
 release();await expect.poll(()=>page.evaluate(()=>window.KPTUGoogleTasks.peekTasks().tasks.find(t=>t.id==='delayed')?.unlinked)).toBe(true);
 await expect(menu).toBeVisible();await expect(menu.locator('button').first()).toBeFocused();
 if(dismiss==='Escape')await page.keyboard.press('Escape');else{await menu.getByRole('button',{name:'편집',exact:true}).click();await expect(page.locator('#gtTaskModal')).toBeVisible();await page.locator('[data-gt-close]').click();}
 await expect(menu).toBeHidden();await expect(trigger).toBeFocused();
});
