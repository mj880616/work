import {chromium} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {openSeoulApp} from '../../../tests/app-e2e/helpers/seoul-time-fixture.mjs';
const [stage='after',origin='http://127.0.0.1:8123']=process.argv.slice(2);
const output=new URL('./'+stage+'/',import.meta.url);mkdirSync(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
for(const width of [390,1280]){
 const context=await browser.newContext({viewport:{width,height:900},timezoneId:'Europe/Rome'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await openSeoulApp(page,{target:origin+'/app/?view=calendar'});
 const shot=async name=>{await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))});await page.screenshot({path:new URL(name+'-'+width+'.png',output).pathname,fullPage:true})};
 await page.waitForFunction(()=>window.KPTUCalendarPersistence?.events?.()?.length||window.__KPTU_GOOGLE_EVENTS__?.length);
 await shot('month');
 await page.locator('#newEventBtn').click();await shot('new-event');await page.locator('[data-close="eventModal"]').click();
 await page.locator('#calendarGrid [data-google-event="early"]').first().click();await page.locator('#ciGoogleSave').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#ciGoogleSave').disabled);await shot('edit-event');await page.locator('#ciGoogleClose').click();
 await page.locator('[data-calendar-view="list"]').click();await page.locator('#calendarList .clv-event').first().waitFor();await shot('list');
 if(width===1280){await page.locator('[data-calendar-view="week"]').click();await page.locator('#calendarWeek .cwv-day').first().waitFor();await shot('week')}
 await page.evaluate(()=>window.KPTURouter.go('projects'));await page.locator('[data-ps3-project="top-a"]').click();await page.locator('#ps3-milestones summary').click();await shot('project');
 await page.locator('[data-ps3-edit-milestone="seoul-mile"]').click();await shot('milestone-input');await page.locator('[data-ps3-close="ps3MilestoneModal"]').click();await page.locator('[data-ps3-close="ps3DetailModal"]').click();
 await page.evaluate(()=>window.KPTURouter.go('meetings'));await page.locator('[data-mrd-meeting="seoul-meeting"]').waitFor();await shot('meetings');
 await page.evaluate(()=>window.KPTURouter.go('home'));await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('home'));await page.locator('#homeView').getByText('한국 00:30',{exact:true}).first().waitFor();await shot('home');
 writeFileSync(new URL('errors-'+width+'.json',output),JSON.stringify(errors,null,2)+'\n');console.log(stage,width,'console/page errors',errors.length);await context.close();
}
await browser.close();
