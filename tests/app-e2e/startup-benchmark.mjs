import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'p6-benchmark-user',email:'p6@example.org',user_metadata:{display_name:'P6 측정'}};
const workspace={id:'p6-benchmark-workspace',name:'공공기관사업팀 Workspace'};
const session={access_token:'p6-benchmark-access',refresh_token:'p6-benchmark-refresh',expires_at:Math.floor(Date.now()/1000)+3600};

async function mockApi(context){
  await context.route(SB+'/**',async route=>{
    const url=new URL(route.request().url()),path=url.pathname;
    const data=path==='/auth/v1/user'?user:
      path==='/rest/v1/app_workspace_members'?[{workspace_id:workspace.id,user_id:user.id,role:'owner'}]:
      path==='/rest/v1/app_workspaces'?[workspace]:
      path==='/rest/v1/app_profiles'?[{user_id:user.id,display_name:'P6 측정'}]:
      path==='/functions/v1/google-calendar'?{connected:false,enabled:false,selected:[],calendars:[],events:[]}:
      path==='/functions/v1/push-notifications'?{enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'}:
      path.startsWith('/rest/v1/')?[]:{};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
}

async function instrument(context){
  await context.addInitScript(value=>{
    try{if(location.pathname.startsWith('/app/'))localStorage.setItem('kptu_collab_session_v1',JSON.stringify(value))}catch{}
    const metric=window.__P6_BENCHMARK__={shellMs:null,authMs:null,homeDataMs:null,homeUsableMs:null,allModulesMs:null,initialImports:null,initialApiRequests:null};
    const snapshot=()=>{
      const resources=performance.getEntriesByType('resource');
      metric.initialImports=new Set(resources.filter(r=>/\/app\/[^?#]+\.js(?:\?|$)/.test(r.name)).map(r=>r.name)).size;
      metric.initialApiRequests=resources.filter(r=>r.name.startsWith('https://xmlkxfjeagycwttklxjw.supabase.co/')).length;
    };
    window.addEventListener('kptu:app-ui-ready',()=>{
      if(!window.__KPTU_STARTUP__&&metric.allModulesMs===null)metric.allModulesMs=performance.now();
    });
    window.addEventListener('kptu:startup-mark',event=>{
      if(event.detail?.name==='allInitialModulesComplete')metric.allModulesMs=performance.now();
    });
    const timer=setInterval(()=>{
      const now=performance.now();
      if(metric.shellMs===null&&document.querySelector('.topbar'))metric.shellMs=now;
      if(metric.authMs===null&&document.querySelector('#workspaceRole')?.textContent?.includes('내 권한'))metric.authMs=now;
      if(metric.homeDataMs===null&&document.querySelector('#hdvProjects')?.children.length)metric.homeDataMs=now;
      const app=document.querySelector('#appView');
      if(metric.homeUsableMs===null&&metric.homeDataMs!==null&&app&&!app.classList.contains('hidden')&&getComputedStyle(app).visibility==='visible'){
        metric.homeUsableMs=now;snapshot();clearInterval(timer);
      }
    },5);
  },session);
}

async function measure(page,url){
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>typeof window.__P6_BENCHMARK__?.homeUsableMs==='number',null,{timeout:30000});
  await page.waitForFunction(()=>typeof window.__P6_BENCHMARK__?.allModulesMs==='number',null,{timeout:15000}).catch(()=>{});
  return page.evaluate(()=>window.__P6_BENCHMARK__);
}

function median(rows,key){
  const nums=rows.map(row=>row[key]).filter(Number.isFinite).sort((a,b)=>a-b);
  return nums.length?Math.round(nums[Math.floor(nums.length/2)]*10)/10:null;
}

const browser=await chromium.launch({headless:true});
const results={environment:'GitHub Actions ubuntu-latest, Chromium/Playwright 1.55.0, 1280x800, mocked Supabase responses without added latency',baseCommit:'3d84e8e18a822c84015bf7a8a4a556b42d7f2f1c',samples:{}};
try{
  for(const [label,port] of [['before',8124],['after',8123]]){
    const cold=[],warm=[];
    for(let i=0;i<3;i++){
      const context=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block'});
      await mockApi(context);await instrument(context);
      const page=await context.newPage(),url='http://127.0.0.1:'+port+'/app/';
      cold.push(await measure(page,url));
      warm.push(await measure(page,url));
      await context.close();
    }
    results.samples[label]={cold,warm,medianCold:{},medianWarm:{}};
    for(const key of ['shellMs','authMs','homeDataMs','homeUsableMs','allModulesMs','initialImports','initialApiRequests']){
      results.samples[label].medianCold[key]=median(cold,key);
      results.samples[label].medianWarm[key]=median(warm,key);
    }
  }
  writeFileSync('/tmp/p6-startup-measurement.json',JSON.stringify(results,null,2));
  console.log('P6_STARTUP_BENCHMARK '+JSON.stringify(results));
}finally{await browser.close()}

