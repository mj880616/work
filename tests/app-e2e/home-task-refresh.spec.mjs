import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
for(const source of ['events','toggle','quick'])test(`initial pending links coalesce ${source} mutations into one fresh read`,async({page})=>{
 let release;const pending=new Promise(r=>release=r);
 const c=await openHome(page,{holds:{app_record_links:pending}});
 await expect(page.locator('[data-home-toggle="today"]')).toBeVisible();
 await expect.poll(()=>c.requests.filter(r=>r.path.endsWith('app_record_links')).length).toBe(1);
 await expect(page.locator('[data-home-card="calendar"]')).toHaveAttribute('data-state','ready');
 await expect(page.locator('[data-home-card="updates"]')).toHaveAttribute('data-state','ready');
 const untouched=()=>c.requests.filter(r=>r.path.includes('google-calendar')||(r.path.endsWith('app_suborganization_updates')&&!r.query.includes('created_by='))).length;
 const initialOtherReads=untouched();
 try {
  if(source==='toggle'){
   await page.locator('[data-home-toggle="today"]').click();
   await expect(page.locator('[data-home-task="today"]')).toHaveClass(/completed/);
  }else{
   if(source==='quick'){
    await page.route(SB+'/functions/v1/google-tasks?action=create',r=>{c.tasks.push({id:'queued',title:'QA queued',status:'needsAction',due:'2026-10-06'});return r.fulfill({json:{task:{id:'queued'}}});});
    await page.locator('[data-quick-input]').fill('QA queued');
    await page.locator('[data-quick-save]').click();
    await expect.poll(()=>c.tasks.some(t=>t.id==='queued')).toBe(true);
    await expect(page.locator('[data-quick-input]')).toHaveValue('');
   }else c.tasks.push({id:'queued',title:'QA queued',status:'needsAction',due:'2026-10-06'});
   await page.evaluate(()=>{for(let i=0;i<3;i++){dispatchEvent(new CustomEvent('kptu:tasks-changed'));dispatchEvent(new CustomEvent('kptu:google-tasks-changed'));}});
  }
  expect(c.requests.filter(r=>r.action==='overview')).toHaveLength(1);
 }finally{release();}
 await expect.poll(()=>c.requests.filter(r=>r.action==='overview').length).toBe(2);
 if(source==='toggle'){
  await expect(page.locator('[data-home-task="today"]')).toHaveClass(/completed/);
  await page.clock.runFor(3001);
  await expect(page.locator('[data-home-task="today"]')).toHaveCount(0);
 }else await expect(page.locator('[data-home-card="tasks"]')).toContainText('QA queued');
 await expect.poll(()=>c.requests.filter(r=>r.path.endsWith('app_record_links')).length).toBe(2);
 if(source==='quick')await expect(page.locator('[data-quick-input]')).toHaveValue('');
 await expect.poll(()=>page.evaluate(()=>!!KPTUHome.metrics.readyAt)).toBe(true);
 expect(c.requests.filter(r=>r.action==='overview')).toHaveLength(2);
 expect(untouched()).toBe(initialOtherReads);
});
