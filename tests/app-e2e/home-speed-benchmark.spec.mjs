import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {openHome} from './helpers/home-entry.mjs';
test('measure home before and after with identical simulated device latency',async({browser})=>{
  const result={delays:{status:1200,events:1200,overview:1000,app_record_links:400}};
  for(const version of ['before','after']){
    const context=await browser.newContext({viewport:{width:390,height:1000}}),page=await context.newPage();
    if(version==='before'){
      const source=execFileSync('git',['show','6d33ccfcbc45194a0737cfd68f3ccb9c9eb223fb:app/home-read.js'],{encoding:'utf8'});
      await page.route('**/app/home-read.js?*',route=>route.fulfill({contentType:'application/javascript',body:source}));
    }
    await page.addInitScript(()=>{
      window.homeMeasure={at:0,first:{}};
      new MutationObserver(()=>{
        const m=window.homeMeasure;
        if(!m.at&&document.querySelector('[data-home-card]'))m.at=performance.now();
        for(const el of document.querySelectorAll('[data-home-card]'))if(el.dataset.state)m.first[el.dataset.homeCard]??=Math.round(performance.now()-m.at);
        if(document.querySelector('[data-home-unlinked]'))m.first.unlinked??=Math.round(performance.now()-m.at);
      }).observe(document,{childList:true,subtree:true,attributes:true});
    });
    const c=await openHome(page,{delays:{...result.delays}});
    const sample=async()=>{
      await page.waitForFunction(()=>KPTUHome.metrics.readyAt);
      const timing=await page.evaluate(()=>({first:homeMeasure.first,latest:Object.fromEntries(Object.entries(KPTUHome.metrics.cards).map(([k,v])=>[k,Math.round(v-homeMeasure.at)]))}));
      return {...timing,requests:Object.fromEntries(['status','events','overview','links'].map(k=>[k,c.requests.filter(r=>k==='links'?r.path.endsWith('app_record_links'):r.action===k).length]))};
    };
    result[version]={first:await sample()};c.requests.length=0;
    await page.evaluate(()=>{homeMeasure={at:performance.now(),first:{}};KPTUHome.start();});
    result[version].reentry=await sample();
    await context.close();
  }
  expect(result.after.first.first.tasks).toBeLessThan(result.before.first.first.tasks);
  expect(result.after.reentry.first.calendar).toBeLessThan(500);
  expect(result.after.reentry.latest.calendar).toBeLessThan(1800);
  expect(result.after.reentry.requests).toEqual({status:1,events:1,overview:1,links:1});
  mkdirSync('test-results',{recursive:true});writeFileSync('test-results/home-speed-measurement.json',JSON.stringify(result,null,2));
  console.log('HOME_SPEED_MEASUREMENT '+JSON.stringify(result));
});
