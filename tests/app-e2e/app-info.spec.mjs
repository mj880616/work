import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {appOrigin} from './helpers/test-origin.mjs';
import {serveBuiltShell,shellVersion} from './helpers/built-shell.mjs';
// S69-34 APP-업데이트확인(사용자 요청 "앱에 업데이트 확인 버튼 추가 현재 버전 몇인지도 알려주고"):
// 계정 메뉴 '앱 정보' → 작은 창(지금 쓰는 판 모두 + [업데이트 확인]).
// - 화면: Pages 빌드가 app.js에 붙인 판(여기서는 built-shell의 고정 판)과 build-info.json의 배포 시각. [업데이트 확인]은 배포된 index.html의 app.js 판과 비교.
// - 폰 앱: 사용자 에이전트의 앱 판, 앱 다리 update:check → 답(update:new / update:latest), [받기] = update:get.
const PC='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const APP='Mozilla/5.0 (Linux; Android 14; SM-F956N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 KPTUAndroid/0.5.28';
const AT='2026-11-24T05:06:00.000Z';
async function builtShell(page){
  await serveBuiltShell(page,appOrigin);
  await page.route('**/app/build-info.json*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({v:String(shellVersion),at:AT})}));
}
async function deployed(page,version){
  await page.unroute(appOrigin+'/app/index.html');
  await page.route(appOrigin+'/app/index.html',route=>route.fulfill({contentType:'text/html',body:`<script src="./app.js?v=${version}" defer></script>`}));
}
async function fakePhone(page,answer){
  await page.addInitScript(answer=>{
    const listeners=[],sent=[];window.__sent=sent;
    const say=data=>setTimeout(()=>listeners.forEach(fn=>fn({data})),0);
    window.KPTUAppShell={
      postMessage(m){m=String(m);sent.push(m);if(m==='update:check')say(answer)},
      addEventListener(type,fn){if(type==='message')listeners.push(fn)},
    };
  },answer);
}
async function openInfo(page,phone){
  if(phone){
    await page.locator('#mobileMenuTab').click();
    const row=page.locator('#mobileAccountGroup [data-app-info-open]');
    await expect(row).toBeVisible();
    return row;
  }
  await page.locator('#appView>.app-topline [data-account-open]:visible').click();
  const row=page.locator('.account-panel:not([hidden]) [data-app-info-open]');
  await expect(row).toBeVisible();
  return row;
}

test.describe('PC 브라우저',()=>{
  test.use({userAgent:PC,viewport:{width:1280,height:860}});
  test('앱 정보: 화면 판과 배포 시각, [업데이트 확인] → 최신이에요 / 새 판이면 [지금 바꾸기]',async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await builtShell(page);
    await openHome(page);
    const row=await openInfo(page,false);
    await expect(row.locator('.account-action-name')).toHaveText('앱 정보');
    await row.click();
    const modal=page.locator('#appInfoModal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('[data-apinfo="web"] dd')).toHaveText(`2026-11-24 14:06 배포 · ${shellVersion}`);
    await expect(modal.locator('[data-apinfo="phone"]')).toHaveCount(0);
    await deployed(page,shellVersion);
    await modal.locator('[data-apinfo-check]').click();
    await expect(modal.locator('[data-apinfo-result="web"]')).toHaveText('화면: 최신이에요');
    await expect(modal.locator('[data-apinfo-reload]')).toHaveCount(0);
    await deployed(page,shellVersion+1);
    await modal.locator('[data-apinfo-check]').click();
    await expect(modal.locator('[data-apinfo-result="web"]')).toContainText('화면: 새 화면이 있어요');
    const reload=modal.locator('[data-apinfo-reload]');
    if(process.env.SHOT_DIR)await page.screenshot({path:`${process.env.SHOT_DIR}/1280-app-info.png`});
    await expect(reload).toHaveText('지금 바꾸기');
    await page.evaluate(()=>{window.__beforeReload=1});
    await Promise.all([page.waitForEvent('framenavigated'),reload.click()]);
    await expect.poll(()=>page.evaluate(()=>window.__beforeReload??null)).toBe(null);
    expect(errors).toEqual([]);
  });
});

test.describe('폰 앱 안',()=>{
  test.use({userAgent:APP,viewport:{width:412,height:900}});
  test('메뉴 줄에 앱 판, 앱 정보에 폰 앱 판·판 종류, [업데이트 확인] → 새 앱 안내와 [받기](앱 다리)',async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await fakePhone(page,'update:new:0.5.29');
    await builtShell(page);
    await openHome(page);
    const row=await openInfo(page,true);
    await expect(row.locator('[data-app-info-ver]')).toHaveText('0.5.28');
    await row.click();
    const modal=page.locator('#appInfoModal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('[data-apinfo="phone"] dd')).toHaveText('0.5.28 · 직접 설치판');
    await deployed(page,shellVersion);
    await modal.locator('[data-apinfo-check]').click();
    await expect(modal.locator('[data-apinfo-result="phone"]')).toContainText('폰 앱: 새 앱 0.5.29이 있어요');
    await expect(modal.locator('[data-apinfo-result="web"]')).toHaveText('화면: 최신이에요');
    if(process.env.SHOT_DIR)await page.screenshot({path:`${process.env.SHOT_DIR}/412-app-info.png`});
    await modal.locator('[data-apinfo-get]').click();
    await expect.poll(()=>page.evaluate(()=>window.__sent.filter(m=>m.startsWith('update:')))).toEqual(['update:check','update:get']);
    expect(errors).toEqual([]);
  });
  test('최신이면 최신이에요 (판)',async({page})=>{
    await fakePhone(page,'update:latest:0.5.28');
    await builtShell(page);
    await openHome(page);
    await (await openInfo(page,true)).click();
    const modal=page.locator('#appInfoModal');
    await deployed(page,shellVersion);
    await modal.locator('[data-apinfo-check]').click();
    await expect(modal.locator('[data-apinfo-result="phone"]')).toHaveText('폰 앱: 최신이에요 (0.5.28)');
    await expect(modal.locator('[data-apinfo-get]')).toHaveCount(0);
  });
});
