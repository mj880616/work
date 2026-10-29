// UI-업데이트안내: 새 버전 알림 한 줄 문구(바뀐 것)와 내 프로필 맨 아래 [업데이트 기록] 접힌 칸.
// 기록 파일(app/release-notes.json)은 배포물에만 생기므로 여기서는 page.route로 흉내 낸다.
import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import {serveBuiltShell,shellVersion} from './helpers/built-shell.mjs';
import { signInWithSession } from './helpers/session-login.mjs';

const origin=appOrigin,current=shellVersion;
const note=(v,changes,checks=[])=>({v,date:'2026-10-29',changes,checks});
const list=notes=>({schema:1,current:notes[0]?.v??null,notes});
async function boot(page,{view='calendar',notes=()=>null}={}){
  await page.addInitScript(()=>Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true}));
  await serveBuiltShell(page,origin);
  const user={id:'notes-user',email:'notes@example.org'},workspace={id:'notes-workspace',name:'QA',slug:'qa'};
  await page.route('https://xmlkxfjeagycwttklxjw.supabase.co/**',route=>{
    const path=new URL(route.request().url()).pathname;let data=[];
    if(path==='/auth/v1/token')data={access_token:'qa',refresh_token:'qa-refresh',expires_in:86400,expires_at:Math.floor(Date.now()/1000)+86400,user};
    else if(path==='/auth/v1/user')data=user;
    else if(path==='/rest/v1/app_workspace_members')data=[{workspace_id:workspace.id,user_id:user.id,role:'owner'}];
    else if(path==='/rest/v1/app_workspaces')data=[workspace];
    else if(path==='/rest/v1/app_profiles')data=[{user_id:user.id,display_name:'QA'}];
    else if(path.startsWith('/functions/'))data={connected:false,enabled:false,tasks:[],events:[],calendars:[]};
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  // 배포 번호(d)마다 다른 기록을 돌려준다. null이면 404(파일 없음).
  await page.route(url=>url.origin===origin&&url.pathname==='/app/release-notes.json',route=>{
    const body=notes(new URL(route.request().url()).searchParams.get('d'));
    return body===null?route.fulfill({status:404,body:''}):route.fulfill({contentType:'application/json',body:typeof body==='string'?body:JSON.stringify(body)});
  });
  await page.goto(origin+'/app/login/?return='+encodeURIComponent(origin+`/app/?view=${view}`));
  await signInWithSession(page,user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
}
const deploy=(page,version)=>page.route(origin+'/app/index.html',route=>route.fulfill({contentType:'text/html',body:`<script src="./app.js?v=${version}" defer></script>`}));
const status=page=>page.locator('#versionNotice [role="status"]');
async function baseline(page){
  // 알림은 열린 뒤 3초쯤 이번 배포의 기록을 한 번 읽어 마지막 버전명을 기억한다.
  await page.waitForResponse(r=>r.url().includes('/app/release-notes.json')&&r.url().includes(`d=${current}`),{timeout:10000});
}
const visible=page=>page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));

test('새 기록 1건이면 알림 한 줄에 그 바뀐 점이 보인다',async({page})=>{
  const old=note('10/29-1',['옛 변경']),fresh=note('10/29-2',['일정 목록이 더 빨리 열려요'],['일정 탭 열어 보기']);
  const loaded=baseline(page).catch(()=>null);
  await boot(page,{notes:d=>d===String(current)?list([old]):list([fresh,old])});
  await loaded;
  await deploy(page,current+1);await visible(page);
  await expect(status(page)).toHaveText('새 버전: 일정 목록이 더 빨리 열려요');
  // 한 줄 유지(높이 그대로, 가로 넘침 없음)
  const box=await page.locator('#versionNotice').boundingBox();expect(box.height).toBeLessThanOrEqual(34);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});

test('여러 건이면 건수, 모양이 틀린 기록은 빼고 글자는 실행되지 않는다',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const old=note('10/28-1',['옛 변경']);
  const loaded=baseline(page).catch(()=>null);
  await boot(page,{notes:d=>d===String(current)?list([old]):list([note('10/29-2',['둘째']),{v:'10/29-9',date:'2026-10-29',changes:['<img src=x onerror="window.__pwned=1">']},note('10/29-1',['첫째']),old])});
  await loaded;
  await deploy(page,current+1);await visible(page);
  await expect(status(page)).toHaveText('새 버전 · 바뀐 것 2건');
  expect(await page.evaluate(()=>window.__pwned)).toBeUndefined();expect(errors).toEqual([]);
});

for(const mode of ['missing','broken','unknown-baseline'])test(`기록을 못 쓰면 지금 문구 그대로 (${mode})`,async({page})=>{
  const loaded=baseline(page).catch(()=>null);
  await boot(page,{notes:d=>mode==='missing'?null:mode==='broken'?'{not json':d===String(current)?list([note('9/1-1',['다른 기록'])]):list([note('10/29-1',['새것'])])});
  await loaded;
  await deploy(page,current+1);await visible(page);
  await expect(page.locator('#versionNotice')).toBeVisible();
  await expect(status(page)).toHaveText('새 버전이 있어요');
});

for(const width of [390,1280])test(`내 프로필 맨 아래 업데이트 기록: 접힘·지금 표시·20건씩 (${width}px)`,async({page})=>{
  await page.setViewportSize({width,height:844});
  const notes=Array.from({length:23},(_,i)=>note(`10/${29-Math.floor(i/3)}-${3-i%3}`,[`바뀐 점 ${i+1}`],i===0?['메뉴 → 내 프로필 열어 보기']:[]));
  await boot(page,{view:'profile',notes:()=>list(notes)});
  await expect(page.locator('#profileView')).toBeVisible({timeout:15000});
  const panel=page.locator('#psReleaseNotes');
  await expect(panel).toBeVisible();
  // 프로필 칸들 중 맨 아래, 처음엔 접혀 있다.
  expect(await page.evaluate(()=>document.querySelector('#profileView .ps-profile-grid').lastElementChild.id)).toBe('psReleaseNotes');
  await expect(panel).not.toHaveAttribute('open','');
  await expect(panel.locator('summary.rn-title')).toContainText('업데이트 기록');
  await expect(panel.locator('summary.rn-title')).toContainText('현재 10/29-3');
  await panel.locator('summary.rn-title').click();
  const rows=panel.locator('.rn-note');
  await expect(rows).toHaveCount(20);
  await expect(rows.first()).toHaveAttribute('open','');
  await expect(rows.first().locator('.rn-now')).toHaveText('지금');
  await expect(rows.first().locator('.rn-check')).toContainText('폰에서 볼 것');
  await expect(rows.nth(1)).not.toHaveAttribute('open','');
  await expect(rows.nth(1).locator('.rn-one')).toHaveText('바뀐 점 2');
  // 키보드로도 펼친다.
  await rows.nth(1).locator('summary').focus();await page.keyboard.press('Enter');
  await expect(rows.nth(1)).toHaveAttribute('open','');
  await panel.getByRole('button',{name:'이전 기록 더 보기'}).click();
  await expect(rows).toHaveCount(23);
  await expect(panel.getByRole('button',{name:'이전 기록 더 보기'})).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.screenshot({path:`test-results/release-notes-profile-${width}.png`,fullPage:true});
});

test('기록이 없으면 업데이트 기록 칸은 숨긴 채',async({page})=>{
  await boot(page,{view:'profile'});
  await expect(page.locator('#profileView')).toBeVisible({timeout:15000});
  await expect(page.locator('#psReleaseNotes')).toBeHidden();
});

// UI-업데이트기록줄바꿈(요청 10/29 08:13): 긴 줄도 자르지 않고 접는다. 폰은 버전·날짜 한 줄, 바뀐 것은 그 아래.
for(const width of [412,884,1440])test(`업데이트 기록 긴 줄이 폰 폭을 넘지 않고 다음 줄로 접힌다 (${width}px)`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const long='일정 창에서 색을 고르면 고른 색 그대로 보이고 그 위에 체크 표시만 더해져요. 다른 색으로 바뀌어 보이지 않아요.';
  const notes=[note('10/29-12',[long,long],['내 프로필 열어 참고 일정 색 하나 골라 보기']),note('10/29-11',['띄어쓰기없이아주길게이어진한줄도폰폭에서잘리지않고다음줄로접혀야해요'.repeat(2)+' '+long.slice(0,30)]),note('10/29-10',['짧은 줄'])];
  await boot(page,{view:'profile',notes:()=>list(notes)});
  await expect(page.locator('#profileView')).toBeVisible({timeout:15000});
  const panel=page.locator('#psReleaseNotes');
  await panel.locator('summary.rn-title').click();
  const rows=panel.locator('.rn-note');await expect(rows).toHaveCount(3);
  const head=rows.nth(1).locator('.rn-head');
  const geo=await head.evaluate(el=>{const box=el.getBoundingClientRect(),r=sel=>{const b=el.querySelector(sel).getBoundingClientRect();return {top:b.top,bottom:b.bottom,right:b.right}};const one=el.querySelector('.rn-one');return {box:{l:box.left,r:box.right},ver:r('.rn-ver'),date:r('.rn-date'),one:r('.rn-one'),oneScroll:one.scrollWidth<=one.clientWidth+1}});
  // 버전·날짜는 같은 한 줄
  expect(Math.abs(geo.ver.top-geo.date.top)).toBeLessThanOrEqual(4);
  // 바뀐 것은 잘리지 않고(가로 넘침 없음) 줄 안에 머문다
  expect(geo.oneScroll).toBe(true);
  expect(geo.one.right).toBeLessThanOrEqual(geo.box.r+1);
  if(width<=700)expect(geo.one.top).toBeGreaterThanOrEqual(geo.ver.bottom-1); // 폰: 그 아래 줄
  await expect(rows.nth(1).locator('.rn-one')).toHaveCSS('white-space','normal');
  // 지금 기록 펼친 본문도 넘치지 않는다
  for(const sel of ['.rn-changes li','.rn-check'])for(const el of await rows.first().locator(sel).all())expect(await el.evaluate(n=>n.scrollWidth<=n.clientWidth+1&&n.getBoundingClientRect().right<=innerWidth)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.screenshot({path:`test-results/release-notes-wrap-${width}.png`,fullPage:true});
});
