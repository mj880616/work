// APP-위여백(요청함 11/01 00:30): 폰 앱 홈 위쪽 빈 칸.
// 원인: HOME-업무일지홈(#1560)이 폰 머리줄(.mobile-shell-header)에서 홈 날짜를 빼, 홈에서는 머리줄이 빈 채로 44px + 아래 12px 자리를 차지했다.
// 고침: 머리줄은 화면 이름이 있을 때만 자리를 차지한다(topbar-actions.js가 소유). 412px 폰 앱(KPTUAndroid) 흉내로 모든 탭의 맨 위가 붙는지 본다.
import {testOrigin} from './helpers/test-origin.mjs';
import {test,expect} from '@playwright/test';
import {loginEntry} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
const app=testOrigin+'/app/';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const ANDROID='Mozilla/5.0 (Linux; Android 15; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.4.3';
test.use({viewport:{width:412,height:915},userAgent:ANDROID,hasTouch:true,isMobile:true});
async function open(page,view){
  const user={id:'gap-qa',email:'gap-qa@example.org'};
  await page.route(`${SB}/**`,route=>{
    const p=new URL(route.request().url()).pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    if(p==='/auth/v1/token')return ok({access_token:'gap-access',refresh_token:'gap-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user});
    if(p==='/auth/v1/user')return ok(user);
    if(p==='/rest/v1/app_workspace_members')return ok([{workspace_id:'gap-ws',role:'owner',workspace:{id:'gap-ws',name:'QA',slug:'kptu-work'}}]);
    if(p.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
  await page.goto(loginEntry(app+'?view='+view));
  await signInWithSession(page,user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
}
// 지금 화면 맨 위에 보이는 첫 글자(머리줄 이름 또는 화면 본문)의 위치.
const firstTop=page=>page.evaluate(()=>{
  const head=document.querySelector('#appView>.mobile-shell-header');
  const panel=document.querySelector('#appView .view-panel:not(.hidden)');
  const tops=[head,panel].filter(n=>n&&n.getClientRects().length).flatMap(n=>[...n.querySelectorAll('*')])
    .filter(n=>n.children.length===0&&n.textContent.trim()&&n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden')
    .map(n=>n.getBoundingClientRect()).filter(r=>r.height>0&&r.width>0).map(r=>r.top);
  return Math.min(...tops);
});
const go=(page,view)=>page.evaluate(v=>window.KPTURouter.go(v),view);
test('home top has no empty header gap, and the header comes back on other tabs',async({page})=>{
  await open(page,'home');
  const head=page.locator('#appView>.mobile-shell-header');
  await expect(page.locator('#homeView [data-journal-title]')).toBeVisible();
  await expect(head).toBeHidden();
  // 날짜 제목이 main 위 여백(8px) 바로 아래에 붙는다(빈 머리줄 56px이 끼면 60px 넘게 내려간다).
  expect((await page.locator('#homeView [data-journal-title]').boundingBox()).y).toBeLessThan(24);
  await go(page,'basket');
  await expect(head).toBeVisible();await expect(head.locator('[data-mobile-view-name]')).toHaveText('정리함');
  await go(page,'home');
  await expect(head).toBeHidden();
  expect((await page.locator('#homeView [data-journal-title]').boundingBox()).y).toBeLessThan(24);
});
for(const view of ['basket','calendar','meetings','team','photos','diary','library','profile','search','outside'])test(`${view} starts right under the top at 412px phone app`,async({page})=>{
  await open(page,'home');
  await go(page,view);
  await expect(page.locator(`#${view}View`)).toBeVisible();
  await expect.poll(()=>firstTop(page)).toBeLessThan(40);
});
test('photos opened directly also starts at the top',async({page})=>{
  await open(page,'photos');
  await expect(page.locator('#appView>.mobile-shell-header [data-mobile-view-name]')).toHaveText('사진');
  await expect.poll(()=>firstTop(page)).toBeLessThan(40);
});
