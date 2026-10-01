// Local-only D-1 screenshots. Requires a static server rooted at this checkout.
import {createRequire} from 'node:module';
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.DESIGN_AUDIT_PLAYWRIGHT||'playwright');
const origin=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw Error('Use a local loopback HTTP origin');
const sb='https://xmlkxfjeagycwttklxjw.supabase.co', out=resolve('docs/design-audit/shots');
const widths=[360,412,720,759,760,761,884,1280,1440], results=[];
const user={id:'audit-user',email:'audit@example.invalid',user_metadata:{display_name:'검사'}};
const project={id:'p1',workspace_id:'audit-ws',owner_id:user.id,name:'교섭 준비',status:'active',sort_order:1,metadata:{project_system:'v2'}};
// Same organization names and group boundaries as organization-detail-tasks.spec.mjs.
const orgs=['공항철도지부','용인경전철지부','서울교통공사9호선지부','인천교통공사노동조합','신분당선지부','전국철도노동조합','메트로9호선노동조합','부산지하철노동조합','김포도시철도지부','서해선지부','대구교통공사노동조합','지티엑스에이운영지부','서울교통공사노동조합','국민연금지부'].map((name,i)=>({id:`o${i}`,workspace_id:'audit-ws',name,active:true,organization_type:'담당조직'}));
const day=new Date().toISOString().slice(0,10);
const task={id:'t1',title:'회의 자료 정리',taskListId:'@default',taskListTitle:'내 할 일',due:`${day}T00:00:00Z`,status:'needsAction',source:'google-task'};
const json=(route,data)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
async function mock(page){await page.route('**/*',route=>{
  const u=new URL(route.request().url()),p=u.pathname;
  if(u.origin===origin)return route.continue();
  if(u.origin!==sb)return route.abort();
  if(p==='/auth/v1/token')return json(route,{access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user});
  if(p==='/auth/v1/user')return json(route,user);
  if(p==='/rest/v1/app_workspace_members')return json(route,[{workspace_id:'audit-ws',user_id:user.id,role:'owner',workspace:{id:'audit-ws',name:'검사 공간'}}]);
  if(p==='/rest/v1/app_workspaces')return json(route,[{id:'audit-ws',name:'검사 공간'}]);
  if(p==='/rest/v1/app_profiles')return json(route,[{user_id:user.id,display_name:'검사'}]);
  if(p==='/rest/v1/app_spaces')return json(route,[project]);
  if(p==='/rest/v1/app_suborganizations')return json(route,orgs);
  if(p==='/rest/v1/app_suborganization_assignees')return json(route,orgs.map(o=>({organization_id:o.id,user_id:user.id})));
  if(p==='/rest/v1/app_meetings')return json(route,[{id:'m1',workspace_id:'audit-ws',project_id:'p1',title:'주간 대책 회의',meeting_at:`${day}T01:00:00Z`,notes:'후속 업무 확인',decisions:'다음 일정 논의',round_no:1,created_by:user.id}]);
  if(p==='/rest/v1/app_events')return json(route,[{id:'e1',workspace_id:'audit-ws',title:'현장 일정',start_at:`${day}T09:00:00+09:00`,end_at:`${day}T10:00:00+09:00`,event_type:'meeting',project_id:'p1'}]);
  if(p==='/rest/v1/app_documents')return json(route,[{id:'d1',workspace_id:'audit-ws',title:'회의 참고 자료',project_id:'p1'}]);
  if(p==='/functions/v1/google-tasks'){
    const action=u.searchParams.get('action');
    if(action==='links')return json(route,{links:[],meeting_links:[]});
    if(action==='linked'||action==='unlinked')return json(route,{tasks:[task]});
    if(action==='status')return json(route,{connected:true,authorized:true,needs_reconnect:false});
    return json(route,{connected:true,authorized:true,needs_reconnect:false,pending_scope:'all',tasks:[task]});
  }
  if(p==='/functions/v1/google-calendar')return json(route,{connected:false,enabled:false,selected:[],calendars:[],events:[]});
  if(p==='/functions/v1/push-notifications')return json(route,{enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
  if(p.startsWith('/rest/v1/rpc/'))return json(route,null);
  if(p.startsWith('/rest/v1/')||p.startsWith('/functions/v1/'))return json(route,[]);
  return json(route,{});
});}
async function measure(page){return page.evaluate(()=>{
  const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0&&!!e.closest('.view-panel:not(.hidden),.modal:not(.hidden),.app-nav,.topbar,.login-shell')};
  const els=[...document.querySelectorAll('body *')].filter(visible);
  const tally=fn=>Object.entries(els.reduce((a,e)=>{const v=fn(getComputedStyle(e));if(v)a[v]=(a[v]||0)+1;return a},{})).sort((a,b)=>b[1]-a[1]);
  const buttons=els.filter(e=>e.matches('button')).map(e=>{const r=e.getBoundingClientRect();return {label:(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,40),id:e.id,width:Math.round(r.width),height:Math.round(r.height)}});
  const nav=document.querySelector('.app-nav');
  return {fontSizes:tally(s=>s.fontSize==='0px'?null:s.fontSize),colors:tally(s=>s.color),backgrounds:tally(s=>s.backgroundColor==='rgba(0, 0, 0, 0)'?null:s.backgroundColor),radii:tally(s=>s.borderRadius==='0px'?null:s.borderRadius),buttonHeights:Object.entries(buttons.reduce((a,b)=>(a[b.height]=(a[b.height]||0)+1,a),{})).sort((a,b)=>Number(a[0])-Number(b[0])),smallButtons:buttons.filter(b=>b.width<44||b.height<44),documentOverflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),nav:nav?{direction:getComputedStyle(nav).flexDirection,scrollWidth:nav.scrollWidth,clientWidth:nav.clientWidth}:null};
});}
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
try{for(const width of widths){
  const context=await browser.newContext({viewport:{width,height:900},timezoneId:'Asia/Seoul',deviceScaleFactor:1});
  const page=await context.newPage();await mock(page);
  const shot=async(name,action)=>{try{if(action)await action();await page.waitForTimeout(300);const file=`${name}-${width}.jpg`;await page.screenshot({path:resolve(out,file),type:'jpeg',quality:50,fullPage:true,animations:'disabled'});results.push({screen:name,width,file,metrics:await measure(page)});}catch(e){results.push({screen:name,width,error:String(e.message||e).slice(0,240)});}};
  const view=async name=>{await page.evaluate(v=>window.KPTURouter.go(v,{source:'design-audit'}),name);await page.locator(`#${name}View:not(.hidden)`).waitFor({timeout:15000});};
  await page.goto(`${origin}/app/login/?return=${encodeURIComponent(origin+'/app/')}`);await shot('login');
  await page.locator('#emailAuthToggle').click();await page.locator('#authEmail').fill(user.email);await page.locator('#authPassword').fill('password123');await page.locator('#authSubmit').click();await page.locator('#appView.kptu-ui-ready').waitFor({timeout:20000});
  if([759,760,761].includes(width)){await shot('navigation-boundary',()=>view('calendar'));await context.close();console.log(`${width}: boundary shot`);continue;}
  await shot('calendar',()=>view('calendar'));
  await shot('calendar-new',async()=>{await page.locator('#newEventBtn').click();await page.locator('#eventModal:not(.hidden)').waitFor();});await page.locator('#eventModal [data-close]').click();
  await shot('tasks',()=>view('tasks'));
  await shot('tasks-edit',async()=>{await page.locator('#gtTaskSection .gt-row').first().click({timeout:8000});await page.locator('#gtTaskModal:not(.hidden)').waitFor();});await shot('tasks-edit-bottom',async()=>{await page.locator('#gtTaskModal .modal-card').evaluate(e=>e.scrollTop=e.scrollHeight)});if(await page.locator('#gtTaskModal:not(.hidden)').count())await page.locator('#gtTaskModal [data-gt-close]').click();
  await shot('projects',()=>view('projects'));
  await shot('projects-detail',async()=>{await page.locator('#projectGrid [data-ps3-project]').first().click({timeout:8000});await page.locator('#ps3DetailModal:not(.hidden)').waitFor();});if(await page.locator('#ps3DetailModal:not(.hidden)').count())await page.locator('#ps3DetailModal [data-ps3-close]').click();
  await shot('meetings',()=>view('meetings'));
  await shot('meetings-detail',async()=>{await page.locator('#meetingList [data-mrd-meeting]').first().click({timeout:8000});await page.locator('#meetingRoundDetailModal:not(.hidden)').waitFor({timeout:8000});});if(await page.locator('#meetingRoundDetailModal:not(.hidden)').count())await page.locator('#mrdClose').click();
  await shot('meetings-new',async()=>{await page.locator('#newMeetingBtn').click();await page.locator('#meetingModal:not(.hidden)').waitFor();});if(await page.locator('#meetingModal:not(.hidden)').count())await page.locator('#meetingModal [data-close]').click();
  await shot('organizations',()=>view('team'));
  await shot('organizations-detail',async()=>{await page.locator('#soOrganizationList .so-card').first().click({timeout:8000});await page.locator('#wdModal:not(.hidden)').waitFor();});if(await page.locator('#wdModal:not(.hidden)').count())await page.locator('#wdModal [data-wd-close="wdModal"]').click();
  await shot('calendar-new-org',async()=>{await view('calendar');await page.locator('#newEventBtn').click();await page.locator('#eventModal:not(.hidden)').waitFor();await page.locator('#soEventOrgChecks .so-org-check').first().waitFor({timeout:5000});await page.locator('#eventModal .modal-card').evaluate(e=>e.scrollTop=e.scrollHeight);});if(await page.locator('#eventModal:not(.hidden)').count())await page.locator('#eventModal [data-close]').click();
  await shot('library',()=>view('library'));await shot('press',()=>view('media'));await shot('board',()=>view('pages'));await shot('navigation',()=>view('calendar'));
  await context.close();console.log(`${width}: ${results.filter(r=>r.width===width&&r.file).length} shots`);
}}finally{await browser.close();await writeFile(resolve('docs/design-audit/measurements.json'),JSON.stringify({origin,widths,results},null,2));}
