import {test} from '@playwright/test';
import {install} from './fake.mjs';
import {enterLogin} from '../../../tests/app-e2e/helpers/login-entry.mjs';
import {signInWithSession} from '../../../tests/app-e2e/helpers/session-login.mjs';
import {writeFileSync,mkdirSync} from 'node:fs';
const OUT=process.env.SWEEP_OUT;
const O='http://127.0.0.1:8123';
test.use({timezoneId:'Asia/Seoul',locale:'ko-KR'});
const VIEWS=['home','basket','calendar','tasks','journal','diary','projects','meetings','library','pages','team','ledger','calls','telegram','hwp'];
const WIDTHS=(process.env.SWEEP_W||'1920,1280,390').split(',').map(Number);
export const measure=()=>{
  const vis=e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&r.bottom>0&&r.top<innerHeight*3};
  const name=e=>e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(typeof e.className==='string'&&e.className.trim()?'.'+e.className.trim().split(/\s+/).slice(0,2).join('.'):'');
  const view=document.querySelector('.view-panel:not(.hidden)')||document.body;
  const btns=[...view.querySelectorAll('button,a.button,[role=button],summary.icon-btn,select,input:not([type=hidden]):not([type=checkbox]):not([type=radio]),textarea')].filter(vis);
  const b=btns.map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {n:name(e),t:(e.textContent||e.value||e.placeholder||e.getAttribute('aria-label')||'').trim().slice(0,18),tag:e.tagName,h:Math.round(r.height),w:Math.round(r.width),fs:s.fontSize,fw:s.fontWeight,br:s.borderRadius,ff:s.fontFamily.slice(0,30),x:Math.round(r.x),y:Math.round(r.y),bg:s.backgroundColor}});
  const texts=[...view.querySelectorAll('*')].filter(e=>vis(e)&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()));
  const fs={},ff={},fw={};for(const e of texts){const s=getComputedStyle(e);fs[s.fontSize]=(fs[s.fontSize]||0)+1;ff[s.fontFamily.slice(0,40)]=(ff[s.fontFamily.slice(0,40)]||0)+1;fw[s.fontWeight]=(fw[s.fontWeight]||0)+1;}
  const headings=[...view.querySelectorAll('h1,h2,h3,h4')].filter(vis).map(e=>({n:name(e),t:e.textContent.trim().slice(0,24),fs:getComputedStyle(e).fontSize,fw:getComputedStyle(e).fontWeight}));
  // overflow
  const W=innerWidth,sw=document.documentElement.scrollWidth;
  const clipped=[...view.querySelectorAll('button,a,span,b,h2,h3,label')].filter(e=>vis(e)&&e.scrollWidth>e.clientWidth+2&&getComputedStyle(e).overflow!=='visible'&&getComputedStyle(e).textOverflow!=='ellipsis').slice(0,8).map(e=>({n:name(e),t:e.textContent.trim().slice(0,20),sw:e.scrollWidth,cw:e.clientWidth}));
  // fixed bottom bars
  const fixed=[...document.querySelectorAll('body *')].filter(e=>{const s=getComputedStyle(e);return (s.position==='fixed'||s.position==='sticky')&&vis(e)}).map(e=>{const r=e.getBoundingClientRect();return {n:name(e),top:Math.round(r.top),bottom:Math.round(r.bottom),h:Math.round(r.height),w:Math.round(r.width)}}).filter(x=>x.h<300);
  // overlapping buttons
  const ov=[];for(let i=0;i<b.length;i++)for(let j=i+1;j<b.length;j++){const a=b[i],c=b[j];if(a.x<c.x+c.w-2&&c.x<a.x+a.w-2&&a.y<c.y+c.h-2&&c.y<a.y+a.h-2&&!(a.x>=c.x&&a.y>=c.y&&a.x+a.w<=c.x+c.w&&a.y+a.h<=c.y+c.h)&&!(c.x>=a.x&&c.y>=a.y&&c.x+c.w<=a.x+a.w&&c.y+c.h<=a.y+a.h))ov.push([a.n+':'+a.t,c.n+':'+c.t]);if(ov.length>6)break}
  const content=view.getBoundingClientRect();
  return {view:view.id,W,H:innerHeight,sw,docH:document.documentElement.scrollHeight,contentW:Math.round(content.width),contentX:Math.round(content.x),buttons:b,fs,ff,fw,headings,clipped,fixed,ov};
};
async function signIn(page,target){
  await install(page);
  await page.goto(target);await enterLogin(page);await signInWithSession(page,'owner@example.org');
  await page.waitForFunction(()=>document.querySelector('#appView')?.classList.contains('kptu-ui-ready'),null,{timeout:15000});
}
export async function openView(page,v){
  return page.evaluate(async v=>{try{await window.KPTUViewLoader?.load?.(v);window.KPTURouter.go(v);return true}catch(e){return String(e)}},v);
}
for(const width of WIDTHS)test('capture '+width,async({page})=>{
  test.setTimeout(400000);
  const H=width===390?844:width===1920?1080:800;
  await page.setViewportSize({width,height:H});
  const errs=[];page.on('pageerror',e=>errs.push(e.message));
  await signIn(page,O+'/app/?view=home');
  mkdirSync(OUT,{recursive:true});
  const metrics={};
  for(const v of VIEWS){
    const r=await openView(page,v);
    await page.waitForTimeout(1500);
    await page.evaluate(()=>scrollTo(0,0));
    const m=await page.evaluate(measure).catch(e=>({err:String(e)}));
    m.open=r;metrics[v]=m;
    await page.screenshot({path:`${OUT}/${v}-${width}.png`,fullPage:false});
  }
  metrics._errors=errs;
  writeFileSync(`${OUT}/metrics-${width}.json`,JSON.stringify(metrics,null,1));
});
