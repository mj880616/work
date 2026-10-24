import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
const ready=page=>page.waitForFunction(()=>window.KPTUHome?.metrics.readyAt);
const recordReads=requests=>requests.filter(r=>r.path.endsWith('app_suborganization_updates')||r.path.endsWith('app_notes')||(r.path.endsWith('app_record_links')&&r.query.includes('note_id=not.is.null')));
for(const width of [390,1280])test(`home omits weekly records and unlinked shortcut without fetching record data ${width}`,async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width,height:900});const control=await openHome(page);await ready(page);
 await expect(page.locator('[data-home-card="updates"]')).toHaveCount(0);
 await expect(page.locator('[data-home-unlinked]')).toHaveCount(0);
 await expect(page.locator('[data-home-card="tasks"]')).toContainText('오늘 항목');
 await expect(page.locator('[data-home-card="tasks"]')).toContainText('테스트 프로젝트');
 await expect(page.locator('[data-home-card="calendar"]')).toContainText('오전 일정');
 expect(recordReads(control.requests)).toEqual([]);
 expect(control.requests.filter(r=>r.path.endsWith('app_suborganization_assignees'))).toEqual([]);
 await page.reload();await ready(page);
 await expect(page.locator('[data-home-card="updates"],[data-home-unlinked]')).toHaveCount(0);
 expect(recordReads(control.requests)).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);
 await info.attach(`home-clean-${width}`,{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
});
for(const width of [390,1280])test(`record mutation events no longer reload home records or disturb the draft ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const control=await openHome(page);await ready(page);
 const input=page.locator('[data-quick-input]');await input.fill('보존할 정리함 메모');const before=control.requests.length;
 await page.evaluate(async()=>{
  dispatchEvent(new CustomEvent('kptu:basket-links-changed'));
  dispatchEvent(new CustomEvent('kptu:api-saved',{detail:{path:'/rest/v1/app_suborganization_updates'}}));
  await new Promise(resolve=>requestAnimationFrame(resolve));
 });
 await expect(input).toHaveValue('보존할 정리함 메모');await expect(input).toBeFocused();
 expect(control.requests.slice(before)).toEqual([]);
 await expect(page.locator('[data-home-card="updates"],[data-home-unlinked]')).toHaveCount(0);
});
test('old weekly cache cannot restore retired cards and is pruned by current home reads',async({page})=>{
 await openHome(page);await ready(page);
 await page.evaluate(()=>{
  const copy=JSON.parse(localStorage.getItem('kptu_owner_cache:home-read-v1:home-test'));
  copy.cards.updates={savedAt:Date.now(),week:'2026-10-04T15:00:00.000Z',rows:[{organization_id:'o',name:'테스트 조직',date:'2026-10-06',text:'옛 조직 요약',type:'basket',note_id:'n'}]};
  copy.cards.tasks.unlinkedCount=3;
  localStorage.setItem('kptu_owner_cache:home-read-v1:home-test',JSON.stringify(copy));
 });
 await page.reload();await ready(page);
 await expect(page.locator('#homeView')).not.toContainText('옛 조직 요약');
 await expect(page.locator('[data-home-card="updates"],[data-home-unlinked]')).toHaveCount(0);
 const cache=await page.evaluate(()=>JSON.parse(localStorage.getItem('kptu_owner_cache:home-read-v1:home-test')));
 expect(cache.cards.updates).toBeUndefined();expect(cache.cards.tasks.unlinkedCount).toBeUndefined();
 expect(cache.cards.tasks.names).toContainEqual({id:'overdue',names:['테스트 프로젝트']});
});
