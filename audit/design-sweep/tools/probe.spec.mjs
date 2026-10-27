import {test} from '@playwright/test';
import {install} from './fake.mjs';
import {enterLogin} from '../../../tests/app-e2e/helpers/login-entry.mjs';
import {signInWithSession} from '../../../tests/app-e2e/helpers/session-login.mjs';
import {readFileSync} from 'node:fs';
test.use({timezoneId:'Asia/Seoul',locale:'ko-KR'});
// PROBE: JSON 파일 [{w,view,pre(js 문자열, 선택),js}] 를 차례로 실행하고 결과 출력
const jobs=JSON.parse(readFileSync(process.env.PROBE,'utf8'));
test('probe',async({browser})=>{let page;
  test.setTimeout(300000);
  let curW=0;
  for(const j of jobs){
    if(j.w!==curW){
      if(page)await page.context().close();page=await (await browser.newContext({timezoneId:'Asia/Seoul',locale:'ko-KR'})).newPage();
      await page.setViewportSize({width:j.w,height:j.w===390?844:j.w===1920?1080:800});
      await install(page);await page.goto('http://127.0.0.1:8123/app/?view=home');await enterLogin(page);await signInWithSession(page,'owner@example.org');
      await page.waitForFunction(()=>document.querySelector('#appView')?.classList.contains('kptu-ui-ready'),null,{timeout:15000});curW=j.w;
    }
    if(j.view)await page.evaluate(async v=>{if(v==='profile'||1){try{await window.KPTUViewLoader?.load?.(v)}catch{}}window.KPTURouter.go(v)},j.view);
    await page.waitForTimeout(1200);
    if(j.pre){await page.evaluate(j.pre).catch(e=>console.log('preERR',e.message));await page.waitForTimeout(800)}
    const r=await page.evaluate(j.js).catch(e=>'ERR '+e.message);
    console.log('### '+(j.name||j.view)+' '+j.w+'\n'+(typeof r==='string'?r:JSON.stringify(r)));
  }
});
