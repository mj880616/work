import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// LIB-글자채우기야간: home "예전 자료 글자 읽기 끝남 (N개)" line (app/text-backfill-notice.js). drive-summary is mocked;
// nothing here calls a real server. The line shares the collection card's one GET ?action=status.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const answer=text_backfill=>({ok:true,checked_at:'2026-10-06T01:00:00.000Z',copy:{state:'found',last_success_at:'2026-10-05T21:17:00.000Z',last_failure_at:null,last_failure_code:null},text_backfill});

async function fixture(page,{status=answer({done_at:'2026-10-05T18:25:00.000Z',count:42,dismissed_at:null}),dismiss=200,width=1280}={}){
  await page.setViewportSize({width,height:900});
  await openHome(page);
  const calls=[];
  await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/drive-summary',route=>{
    const req=route.request();
    if(req.method()==='OPTIONS')return route.fulfill({status:204});
    const action=new URL(req.url()).searchParams.get('action');
    calls.push({method:req.method(),action});
    if(action==='text_backfill_dismiss')return dismiss===200?route.fulfill({json:{ok:true,dismissed_at:'2026-10-06T01:05:00.000Z'}}):route.fulfill({status:dismiss,json:{ok:false,error:'DRIVE_STATUS_WRITE_FAILED'}});
    if(status==='missing')return route.fulfill({status:405,json:{ok:false,error:'METHOD_NOT_ALLOWED'}});
    return route.fulfill({json:status});
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_todo_radar_state',route=>route.fulfill({json:[{last_success_at:'2026-10-06T00:30:00Z'}]}));
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  await expect(page.locator('#homeView')).toBeVisible();
  return {calls,line:page.locator('[data-home-text-done]')};
}

for(const width of [1280,390])test(`shows one line when done, ✕ saves the dismissal on the server and hides it (${width})`,async({page})=>{
  const {calls,line}=await fixture(page,{width});
  await expect(line).toBeVisible();
  await expect(line.locator('.text-done-label')).toHaveText('예전 자료 글자 읽기 끝남 (42개)');
  expect(calls.filter(c=>c.action==='status')).toHaveLength(1);
  const box=await line.boundingBox();
  expect(box.height).toBeLessThanOrEqual(40);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await line.locator('[data-text-done-dismiss]').click();
  await expect(line).toBeHidden();
  expect(calls.filter(c=>c.action==='text_backfill_dismiss')).toEqual([{method:'POST',action:'text_backfill_dismiss'}]);
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>/text|backfill|done/i.test(k)))).toEqual([]);
});

for(const [name,status] of [['already dismissed',answer({done_at:'2026-10-05T18:25:00.000Z',count:3,dismissed_at:'2026-10-05T23:00:00.000Z'})],['not done yet',answer(null)],['function not deployed','missing']])test(`${name}: no line`,async({page})=>{
  const {line}=await fixture(page,{status});
  await page.waitForFunction(()=>window.KPTUHome?.metrics?.readyAt);
  await page.waitForTimeout(300);
  await expect(line).toBeHidden();
  await expect(page.locator('#homeView')).not.toContainText('글자 읽기 끝남');
});

test('a failed ✕ keeps the line with a short note',async({page})=>{
  const {line}=await fixture(page,{dismiss:502});
  await line.locator('[data-text-done-dismiss]').click();
  await expect(line.locator('.text-done-failed')).toHaveText('닫지 못함');
  await expect(line).toBeVisible();
});
