import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'p6-benchmark-user',email:'p6@example.org',user_metadata:{display_name:'P6 측정'}};
const workspace={id:'p6-benchmark-workspace',name:'공공기관사업팀 Workspace'};
const session={access_token:'p6-benchmark-access',refresh_token:'p6-benchmark-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user};
const routes=['home','calendar','tasks','projects','library'];
const viewports={
  desktop:{width:1280,height:800},
  mobile:{width:390,height:844}
};

async function mockApi(context,{latencyMs=0}={}){
  await context.route(SB+'/**',async route=>{
    if(latencyMs)await new Promise(resolve=>setTimeout(resolve,latencyMs));
    const url=new URL(route.request().url()),path=url.pathname;
    const data=path==='/auth/v1/token'?{...session,expires_in:3600}:
      path==='/auth/v1/user'?user:
      path==='/rest/v1/app_workspace_members'?[{workspace_id:workspace.id,user_id:user.id,role:'owner',workspace}]:
      path==='/rest/v1/app_workspaces'?[workspace]:
      path==='/rest/v1/app_profiles'?[{user_id:user.id,display_name:'P6 측정'}]:
      path==='/functions/v1/google-calendar'?{connected:false,enabled:false,selected:[],calendars:[],events:[]}:
      path==='/functions/v1/google-tasks'?{authorized:false,connected:false,tasks:[],lists:[]}:
      path==='/functions/v1/push-notifications'?{enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'}:
      path.startsWith('/rest/v1/')?[]:{};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
}

async function instrument(context,requestedView){
  await context.addInitScript(view=>{
    const metric=window.__P6_BENCHMARK__={
      requestedView:view,topbarMs:null,shellMs:null,homeDataMs:null,homeUsableMs:null,
      requestedShellMs:null,requestedViewMs:null,requestedReadyMarkMs:null,allModulesMs:null,initialImports:null,initialApiRequests:null,
      apiByPath:{},featureImports:[]
    };
    const snapshot=()=>{
      const resources=performance.getEntriesByType('resource');
      const scripts=resources.filter(r=>/\/app\/[^?#]+\.js(?:\?|$)/.test(r.name)).map(r=>r.name);
      metric.featureImports=[...new Set(scripts)];
      metric.initialImports=metric.featureImports.length;
      const api=resources.filter(r=>r.name.startsWith('https://xmlkxfjeagycwttklxjw.supabase.co/'));
      metric.initialApiRequests=api.length;
      for(const r of api){
        const u=new URL(r.name);
        const key=u.pathname+(u.searchParams.get('action')?('?action='+u.searchParams.get('action')):'');
        metric.apiByPath[key]=(metric.apiByPath[key]||0)+1;
      }
    };
    const visible=el=>!!el&&!el.classList.contains('hidden')&&getComputedStyle(el).visibility==='visible'&&getComputedStyle(el).display!=='none';
    window.addEventListener('kptu:startup-mark',event=>{
      if(event.detail?.name==='allInitialModulesComplete')metric.allModulesMs=performance.now();
      if(event.detail?.name==='requestedViewReady')metric.requestedReadyMarkMs=performance.now();
    });
    const timer=setInterval(()=>{
      const now=performance.now(),app=document.querySelector('#appView'),nav=app?.querySelector('.app-nav');
      if(metric.topbarMs===null&&document.querySelector('.topbar'))metric.topbarMs=now;
      if(metric.shellMs===null&&visible(app)&&visible(nav))metric.shellMs=now;
      if(metric.homeDataMs===null&&document.querySelector('#hdvProjects')?.children.length)metric.homeDataMs=now;
      if(metric.homeUsableMs===null&&metric.homeDataMs!==null&&visible(app))metric.homeUsableMs=now;
      const target=document.querySelector('#'+view+'View');
      if(metric.requestedShellMs===null&&visible(app)&&visible(target))metric.requestedShellMs=now;
      if(metric.requestedViewMs===null&&visible(app)&&visible(target)&&app?.classList.contains('kptu-ui-ready')){
        metric.requestedViewMs=now;snapshot();clearInterval(timer);
      }
    },5);
  },requestedView);
}

async function waitForStartup(page){
  await page.waitForFunction(()=>typeof window.__P6_BENCHMARK__?.requestedViewMs==='number',null,{timeout:30000});
  return page.evaluate(()=>window.__P6_BENCHMARK__);
}

const routeUrl=(base,view)=>view==='home'?base:base+'?view='+encodeURIComponent(view);

async function coldLoad(page,base,view){
  const url=routeUrl(base,view);
  const login=new URL('/app/login/',base);
  login.searchParams.set('return',url);
  await page.goto(login.href,{waitUntil:'domcontentloaded',timeout:30000});
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill(user.email);
  await page.locator('#authPassword').fill('benchmark-password');
  await page.locator('#authSubmit').click();
  await page.waitForURL(url,{timeout:30000});
  return waitForStartup(page);
}

async function warmLoad(page,base,view){
  const url=routeUrl(base,view);
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  return waitForStartup(page);
}

function median(rows,key){
  const nums=rows.map(row=>row[key]).filter(Number.isFinite).sort((a,b)=>a-b);
  return nums.length?Math.round(nums[Math.floor(nums.length/2)]*10)/10:null;
}

const browser=await chromium.launch({headless:true});
const results={
  environment:'GitHub Actions ubuntu-latest, Chromium/Playwright 1.55.0, mocked Supabase responses, 0ms artificial API latency',
  baselineCommit:'1b6f502dae5c558550649a368eab086b62f274bb',
  routes,viewports,samples:{}
};
try{
  for(const [label,port] of [['before',8124],['after',8123]]){
    results.samples[label]={};
    for(const [viewportName,viewport] of Object.entries(viewports)){
      results.samples[label][viewportName]={};
      for(const view of routes){
        const cold=[],warm=[];
        for(let i=0;i<3;i++){
          const context=await browser.newContext({viewport,serviceWorkers:'block'});
          await mockApi(context);await instrument(context,view);
          const page=await context.newPage(),base='http://127.0.0.1:'+port+'/app/';
          cold.push(await coldLoad(page,base,view));
          warm.push(await warmLoad(page,base,view));
          await context.close();
        }
        const keys=['topbarMs','shellMs','homeDataMs','homeUsableMs','requestedShellMs','requestedViewMs','requestedReadyMarkMs','allModulesMs','initialImports','initialApiRequests'];
        const medianCold={},medianWarm={};
        for(const key of keys){medianCold[key]=median(cold,key);medianWarm[key]=median(warm,key)}
        results.samples[label][viewportName][view]={cold,warm,medianCold,medianWarm};
      }
    }
  }
  writeFileSync('/tmp/p6-startup-measurement.json',JSON.stringify(results,null,2));
  console.log('P6_STARTUP_BENCHMARK '+JSON.stringify(results));
}finally{await browser.close()}
