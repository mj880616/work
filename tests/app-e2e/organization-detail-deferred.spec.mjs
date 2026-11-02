import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {appOrigin} from './helpers/test-origin.mjs';
// PERF-첫로딩 P5(docs/design/first-load.md 4절): 담당조직 화면은 목록만 먼저 보이고, 조직 상세(workplace-detail.js)와 그 할 일 칸
// (project-catalog.js·google-tasks.js)은 목록이 보인 뒤 받는다. 받기 전의 첫 클릭·다른 화면에서 여는 길(KPTUWorkplace.open)은
// 받은 뒤 그대로 열린다(명진 결정 11/02: 첫 클릭이 0.5초쯤 늦어도 됨). 조직 이름은 home-entry.mjs의 합성 값.
const deferred=/\/app\/(workplace-detail|google-tasks|project-catalog)\.js(\?|$)/;
// workplace-detail.js 응답을 붙잡아 둔다(쉬는 틈 미리 받기 modulepreload도 같이 붙잡힘). release()로 놓는다.
async function holdDetail(page){
 let release;const gate=new Promise(r=>{release=r});
 await page.route(url=>/\/app\/workplace-detail\.js(\?|$)/.test(url.pathname+url.search),async route=>{await gate;await route.continue()});
 return ()=>release();
}
const row=page=>page.locator('#soOrganizationList [data-so-org="o"]');

test('폰 390: 상세를 받기 전에 조직 줄을 누르면 받은 뒤 상세 창이 열린다',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 // 쉬는 틈 미리 받기(modulepreload)가 먼저 받아 두지 않게 홈을 열기 전부터 붙잡는다.
 const release=await holdDetail(page);
 await openHome(page);
 await clickView(page,'team');
 await expect(row(page)).toBeVisible();
 // 목록은 보이지만 상세 프로그램은 아직 없다(받기 전 열기 길).
 expect(await page.evaluate(()=>window.KPTUWorkplace?.open?.name)).toBe('openBeforeDetail');
 await row(page).click();
 await expect(row(page)).toHaveAttribute('aria-busy','true');
 release();
 await expect(page.locator('#wdModal')).toBeVisible();
 await expect(page.locator('#wdTitle')).toHaveText('테스트 조직');
 await expect(row(page)).not.toHaveAttribute('aria-busy','true');
 expect(errors).toEqual([]);
});

test('다른 화면에서 KPTUWorkplace.open을 부르면 상세를 받은 뒤 그 조직이 열린다',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 // 쉬는 틈 미리 받기(modulepreload)가 먼저 받아 두지 않게 홈을 열기 전부터 붙잡는다.
 const release=await holdDetail(page);
 await openHome(page);
 // 홈에 그대로 있으면서(바구니·검색·원장이 쓰는 길과 같음) 담당조직 묶음만 받고 조직을 연다.
 const opened=page.evaluate(async()=>{await window.KPTUViewLoader.load('team');await window.KPTUWorkplace.open('o');return true});
 await expect.poll(()=>page.evaluate(()=>window.KPTUViewLoader.isLoaded('team'))).toBe(true);
 expect(await page.evaluate(()=>window.KPTUWorkplace?.open?.name)).toBe('openBeforeDetail');
 release();
 expect(await opened).toBe(true);
 await expect(page.locator('#wdModal')).toBeVisible();
 await expect(page.locator('#wdTitle')).toHaveText('테스트 조직');
 expect(errors).toEqual([]);
});

for(const width of [390,1280])test(`${width}: 담당조직으로 새로 열면 상세·할 일 프로그램은 화면이 보인 뒤에 받는다`,async({page})=>{
 await page.setViewportSize({width,height:844});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 // 화면이 보이는 순간(#appView.kptu-ui-ready)까지 요청한 파일 목록을 남긴다. openHome의 시계 흉내가 performance를 바꾸기 전에 진짜를 잡아 둔다.
 await page.addInitScript(()=>{
  const real=performance;real.setResourceTimingBufferSize(5000); // 기본 250개로는 모자란다
  const files=()=>real.getEntriesByType('resource').map(r=>new URL(r.name).pathname);
  window.__files=files;window.__beforeReady=null;
  new MutationObserver(()=>{if(window.__beforeReady===null&&document.querySelector('#appView')?.classList.contains('kptu-ui-ready'))window.__beforeReady=files()}).observe(document,{subtree:true,attributes:true,attributeFilter:['class'],childList:true});
 });
 await openHome(page);
 await page.goto(`${appOrigin}/app/?view=team`);
 await expect(row(page)).toBeVisible();
 // 화면이 보인 뒤 상세를 받아 둔다: PC는 오른쪽 칸에 첫 조직이 저절로 열리고, 폰은 줄을 누르면 바로 열린다.
 await expect.poll(()=>page.evaluate(()=>window.KPTUWorkplace?.open?.name)).toBe('wdOpen');
 const before=await page.evaluate(()=>window.__beforeReady);
 expect(before?.some(path=>path.endsWith('/app/suborganizations.js'))).toBe(true);
 expect(before.filter(path=>deferred.test(path))).toEqual([]);
 const after=await page.evaluate(()=>window.__files());
 expect(after.filter(path=>deferred.test(path)).length).toBeGreaterThanOrEqual(3);
 if(width>=1024)await expect(page.locator('#wdDetailPane #wdTitle')).toHaveText('테스트 조직');
 else{await expect(page.locator('#wdModal')).toBeHidden();await row(page).click();await expect(page.locator('#wdTitle')).toHaveText('테스트 조직')}
 expect(errors).toEqual([]);
});
