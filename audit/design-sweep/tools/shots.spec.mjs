import {test} from '@playwright/test';
import {install} from './fake.mjs';
import {ITEMS} from './items.mjs';
import {enterLogin} from '../../../tests/app-e2e/helpers/login-entry.mjs';
import {signInWithSession} from '../../../tests/app-e2e/helpers/session-login.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
const OUT=process.env.SWEEP_OUT;
const only=process.env.ONLY?process.env.ONLY.split(','):null;
test.use({timezoneId:'Asia/Seoul',locale:'ko-KR'});
test('shots',async({browser})=>{
  test.setTimeout(1500000);
  mkdirSync(OUT+'/raw',{recursive:true});
  const log={};
  for(const it of ITEMS){
    if(only&&!only.includes(it.key))continue;
    const ctx=await browser.newContext({timezoneId:'Asia/Seoul',locale:'ko-KR',viewport:{width:it.w,height:it.w===390?844:it.w===1920?1080:800}});
    const page=await ctx.newPage();
    try{
      await install(page);await page.goto('http://127.0.0.1:8123/app/?view=home');await enterLogin(page);await signInWithSession(page,'owner@example.org');
      await page.waitForFunction(()=>document.querySelector('#appView')?.classList.contains('kptu-ui-ready'),null,{timeout:15000});
      await page.evaluate(async v=>{try{await window.KPTUViewLoader?.load?.(v)}catch{}window.KPTURouter.go(v)},it.view);
      await page.waitForTimeout(1500);
      if(it.pre){await page.evaluate(it.pre).catch(()=>{});await page.waitForTimeout(1000)}
      const box=async()=>{if(!it.clip)return null;return page.evaluate(([sels,pad])=>{for(const s of sels.split(',')){const e=document.querySelector(s.trim());if(e){const r=e.getBoundingClientRect();if(r.width>10&&r.height>10){const x=Math.max(0,r.x-pad),y=Math.max(0,r.y-pad);return {x,y,width:Math.min(innerWidth-x,r.width+pad*2),height:Math.min(innerHeight-y,r.height+pad*2)}}}}return null},[it.clip,it.pad||12])};
      const b1=await box();
      await page.screenshot({path:`${OUT}/raw/${it.key}-before.png`,...(b1?{clip:b1}:{})});
      if(it.css){
        await page.addStyleTag({content:it.css});await page.waitForTimeout(500);
        if(it.pre&&/scrollTo/.test(it.pre))await page.evaluate(it.pre);
        await page.waitForTimeout(300);
        const b2=await box();
        await page.screenshot({path:`${OUT}/raw/${it.key}-after.png`,...(b2?{clip:b2}:{})});
      }
      log[it.key]='ok';
    }catch(e){log[it.key]='ERR '+String(e).slice(0,200)}
    await ctx.close();
  }
  writeFileSync(`${OUT}/shots-log.json`,JSON.stringify(log,null,1));
});
