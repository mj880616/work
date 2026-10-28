// UI-화면정리(2026-10-28 명진 요청 20:03): 세 폭(폰 접은 412·펼친 884·PC 1440) 화면 사진. 가짜 서버(filter-chip-fixture)만 쓰고 운영 서버는 부르지 않는다.
// 사진은 test-results/ui-audit/에 남고 app-e2e-check.yml이 ui-audit-<shard> artifact로 올린다(전후 비교용). 사진만 찍으며 화면을 고치거나 판정하지 않는다.
import {test} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';

const WIDTHS=[[412,915],[884,1000],[1440,900]];
const VIEWS=['home','calendar','tasks','journal','diary','basket','library','team','projects','profile','telegram','calls','ledger','hwp'];
const DIR='test-results/ui-audit';

for(const [width,height] of WIDTHS){
  test(`화면 사진 ${width}px`,async({page})=>{
    test.setTimeout(240000);
    mkdirSync(DIR,{recursive:true});
    await page.setViewportSize({width,height});
    const state=baseState();state.meetings=[];state.meetingWrites=[];state.downloads=[];state.deletes=[];
    await mockApp(page,state);
    await signIn(page);
    for(const view of VIEWS){
      try{
        await page.evaluate(v=>window.KPTURouter?.go?.(v),view);
        await page.waitForTimeout(1200);
        await page.evaluate(()=>window.scrollTo(0,0));
        await page.screenshot({path:`${DIR}/${view}-${width}.png`});
        // 목록 끝(폰 [+]·아래 전환 줄이 가리는지)도 한 장.
        if(width<=884){await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await page.waitForTimeout(300);await page.screenshot({path:`${DIR}/${view}-${width}-end.png`});}
      }catch(error){console.log(`ui-audit ${view} ${width}: ${error?.message||error}`);}
    }
  });
}
