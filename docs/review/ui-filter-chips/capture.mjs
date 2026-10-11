import {chromium} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {baseState,mockApp,signIn} from '../../../tests/app-e2e/helpers/filter-chip-fixture.mjs';
const stage=process.argv[2]||'after',origin=process.argv[3]||'http://127.0.0.1:8123';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const out=new URL(`./${stage}/`,import.meta.url);mkdirSync(out,{recursive:true});
for(const width of [390,1280]){
 const context=await browser.newContext({viewport:{width,height:900},timezoneId:'Asia/Seoul',hasTouch:true});const page=await context.newPage();await page.clock.install({time:new Date('2026-10-11T01:00:00Z')});
 const metrics={};
 const measure=async key=>{metrics[key]=await page.locator('#meetingTypeFilter,#documentProject,#libraryViewFilter,.home-quick-modes').evaluateAll(es=>es.filter(e=>e.getBoundingClientRect().width).map(e=>({id:e.id||e.className,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,scrollWidth:e.scrollWidth,wrap:getComputedStyle(e).flexWrap,buttons:[...e.querySelectorAll('button')].map(b=>({label:b.textContent,height:b.getBoundingClientRect().height,targetHeight:getComputedStyle(b,'::after').height}))}))) };
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 // All remote requests are intercepted; snapshots contain synthetic fixtures only.
 await page.route('**/*',r=>r.request().url().startsWith(origin)||r.request().url().includes('.supabase.co/')?r.continue():r.abort());
 const s=baseState();s.meetingWrites=[];s.meetings=['궤도협의회','노사협의회','안전위원회','정책회의','현안회의','후속회의',''].map((name,i)=>({id:`meeting-${i}`,workspace_id:s.workspace.id,title:name,series_name:name,round_no:i+1,meeting_at:'2026-10-11T01:00:00Z',transcript_text:'원문',created_by:s.user.id}));
 s.docs.push({id:'meeting-doc',workspace_id:s.workspace.id,project_id:'child-a1',title:'회의 연결 자료',meeting_id:'meeting-0',category:'회의자료'});await mockApp(page,s);
 await signIn(page,origin+'/app/?view=meetings');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));await measure('meetings');await page.screenshot({path:new URL(`meetings-${width}.png`,out).pathname,fullPage:true});
 await page.evaluate(()=>window.KPTURouter.go('library'));await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('library'));await measure('library');await page.screenshot({path:new URL(`library-${width}.png`,out).pathname,fullPage:true});
 const project=page.locator('#documentProject');if(await project.evaluate(e=>e.tagName==='SELECT'))await project.selectOption('top-a');else await project.locator('[data-filter-value="top-a"]').click();await measure('project');await page.screenshot({path:new URL(`project-${width}.png`,out).pathname,fullPage:true});
 await page.evaluate(()=>window.KPTURouter.go('home'));await page.waitForFunction(()=>!!document.querySelector('.home-quick-modes'));await measure('home');await page.screenshot({path:new URL(`home-${width}.png`,out).pathname,fullPage:true});
 writeFileSync(new URL(`metrics-${width}.json`,out),JSON.stringify(metrics,null,2)+'\n');
 writeFileSync(new URL(`errors-${width}.json`,out),JSON.stringify(errors));await context.close();
}
await browser.close();
