// UI-폴드PC틀(2026-10-30 명진 시안 A): 폴드 펼침(884)·좁은 노트북 창(900)도 PC 틀이다. 화면 기준은 둘(≤760 폰 / ≥761 PC 틀).
// 761~1023px의 옛 셸(위쪽 한 줄 메뉴 + ☰)은 코드째 없다. 왼쪽 메뉴는 그림만 보이는 좁은 칸이고, 위쪽 줄 맨 왼쪽 버튼을 누르면 이름까지 펼친다.
// 위쪽 얇은 줄(‹ › · 지금 위치 · 검색 · + 추가 · 계정)도 PC와 같다. 모든 메뉴가 열리고 가로 넘침이 없다. 이름은 모두 합성 값.
import {appOrigin} from './helpers/test-origin.mjs';
import {test,expect} from '@playwright/test';
import {loginEntry} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
const app=`${appOrigin}/app/`;
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
async function open(page,url=app+'?view=home'){
  const user={id:'fold-qa',email:'fold-qa@example.org'};
  await page.route(`${SB}/**`,route=>{
    const p=new URL(route.request().url()).pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    if(p==='/auth/v1/token')return ok({access_token:'fold-qa-access',refresh_token:'fold-qa-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user});
    if(p==='/auth/v1/user')return ok(user);
    if(p==='/rest/v1/app_workspace_members')return ok([{workspace_id:'fold-workspace',role:'owner',workspace:{id:'fold-workspace',name:'QA',slug:'kptu-work'}}]);
    if(p==='/functions/v1/google-calendar')return ok({connected:false,calendars:[],events:[]});
    if(p==='/functions/v1/google-tasks')return ok({connected:false,tasks:[]});
    if(p.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
  await page.goto(loginEntry(url));
  await signInWithSession(page,user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
}
const nav=page=>page.locator('#appView>.app-nav');
const toggle=page=>page.locator('#appView>.app-topline [data-nav-toggle]');
const overflow=page=>page.evaluate(()=>{
  const w=innerWidth,root=document.documentElement;
  if(root.scrollWidth<=w)return null;
  const name=e=>e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(typeof e.className==='string'&&e.className?'.'+e.className.trim().split(/\s+/).slice(0,2).join('.'):'');
  return `scrollWidth ${root.scrollWidth} > ${w}; `+[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.right>w+1&&getComputedStyle(e).position!=='fixed'}).slice(0,4).map(name).join(', ');
});
// [이름, 왼쪽 메뉴 안 버튼, 라우터 화면 이름, 노트 쪽인가]. 할 일·업무일지·일기는 [일정] 아래 작은 메뉴(좁은 칸에서는 작은 그림).
const MENU=[
  ['홈','.sidebar-brand','home'],
  ['정리함','.nav-btn[data-view="basket"]','basket'],
  ['달력','.nav-btn[data-view="calendar"]','calendar'],
  ['할 일','.nav-sub-btn[data-view="tasks"]','tasks',false,true],
  ['업무일지','.nav-sub-btn[data-view="journal"]','journal',false,true],
  ['일기','.nav-sub-btn[data-view="diary"]','diary',false,true],
  ['노트','.nav-btn[data-basket-kind-nav="note"]','basket',true],
  ['사업 보고','.nav-btn[data-view="meetings"]','meetings'],
  ['자료실','.nav-btn[data-view="library"]','library'],
  ['공유 페이지','.nav-btn[data-view="pages"]','pages'],
  ['담당조직','.nav-btn[data-view="team"]','team'],
  ['HWP 편집','.nav-btn[data-view="hwp"]','hwp'],
  ['원장','.nav-btn[data-view="ledger"]','ledger'],
  ['사진','.nav-btn[data-view="photos"]','photos'],
  ['통화','.nav-btn[data-view="calls"]','calls'],
  ['텔레그램 소식','.nav-btn[data-view="telegram"]','telegram'],
  ['아스날','.nav-btn[data-view="arsenal"]','arsenal']
];
const SIZES=[{width:884,height:1104,rail:true},{width:1104,height:884,rail:false},{width:900,height:800,rail:true}];

for(const size of SIZES)test(`${size.width}×${size.height}: PC 틀 — 모든 메뉴가 열리고 가로 넘침이 없다`,async({page})=>{
  test.setTimeout(180000);
  await page.setViewportSize({width:size.width,height:size.height});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await open(page);
  // 폰 하단 탭·폰 머리줄·☰는 없다. 왼쪽 세로 메뉴와 위쪽 얇은 줄이 있다.
  await expect(page.locator('.mobile-tabs')).toBeHidden();
  await expect(page.locator('.mobile-shell-header')).toBeHidden();
  await expect(page.locator('#mobileMenuOpen')).toHaveCount(0);
  await expect(nav(page)).toBeVisible();
  const topline=page.locator('#appView>.app-topline');
  await expect(topline).toBeVisible();
  for(const sel of ['[data-nav-toggle]','[data-history-step="back"]','[data-history-step="forward"]','[data-topline-where]','[data-quick-add]','[data-account-open]'])await expect(topline.locator(sel)).toBeVisible();
  const n=await nav(page).boundingBox(),t=await topline.boundingBox();
  expect(n.height).toBeGreaterThan(n.width);
  expect(t.x).toBeGreaterThanOrEqual(n.x+n.width);
  if(size.rail)expect(n.width).toBeLessThanOrEqual(56);else expect(n.width).toBeGreaterThan(120);
  const bad=[];
  for(const [name,sel,view,note,sub] of MENU){
    const button=nav(page).locator(sel).first();
    await expect(button,name).toBeVisible();
    await button.click();
    await expect.poll(()=>page.evaluate(()=>window.KPTURouter?.current),{message:name}).toBe(view);
    if(view==='basket')await expect(page.locator('#basketView')).toHaveAttribute('data-kind',note?'note':'memo');
    await expect(page.locator(`#${view}View`)).toBeVisible();
    // 고르면 펼친 이름은 접힌다.
    await expect(page.locator('#appView')).not.toHaveClass(/nav-open/);
    await page.waitForTimeout(150);
    const o=await overflow(page);if(o)bad.push(`${name}: ${o}`);
  }
  // 내 프로필은 위쪽 줄 [계정 ▾] 안.
  await topline.locator('[data-account-open]').click();
  await page.locator('[data-profile-open]:visible').first().click();
  await expect(page.locator('#profileView')).toBeVisible();
  const o=await overflow(page);if(o)bad.push(`내 프로필: ${o}`);
  expect(bad,bad.join('\n')).toEqual([]);
  expect(errors).toEqual([]);
});

for(const size of SIZES.filter(s=>s.rail))test(`${size.width}×${size.height}: 좁은 메뉴 펼치기·접기, 펼친 상태에서 [+ 추가] 창이 가려지지 않는다`,async({page})=>{
  await page.setViewportSize({width:size.width,height:size.height});
  await open(page);
  const view=page.locator('#appView'),calendar=nav(page).locator('.nav-btn[data-view="calendar"]');
  // 접힌 칸: 그림만 보이고 이름은 읽기 프로그램용(버튼 이름은 그대로).
  await expect(calendar.locator('.nav-ico')).toBeVisible();
  expect((await calendar.locator('.nav-label').boundingBox())?.width??0).toBeLessThanOrEqual(1);
  await expect(calendar).toHaveAccessibleName('일정');
  // [일정] 아래 할 일·업무일지·일기는 접힌 칸에서도 작은 그림으로 보이고, [달력]은 [일정]과 같은 곳이라 접힌 칸에서는 빠진다.
  for(const v of ['tasks','journal','diary'])await expect(nav(page).locator(`.nav-sub-btn[data-view="${v}"] .nav-ico`)).toBeVisible();
  await expect(nav(page).locator('.nav-sub-btn[data-goto="calendar"]')).toBeHidden();
  await expect(nav(page).locator('.nav-home-mid')).toBeHidden();
  await expect(toggle(page)).toHaveAttribute('aria-expanded','false');
  await expect(toggle(page)).toHaveAccessibleName('메뉴 이름 펼치기');
  // 펼치기: 이름과 [일정] 아래 작은 메뉴가 보이고, 본문 칸 폭은 그대로(본문 위에 겹침).
  const before=await page.locator('#homeView').boundingBox();
  await toggle(page).click();
  await expect(view).toHaveClass(/nav-open/);
  await expect(toggle(page)).toHaveAttribute('aria-expanded','true');
  expect((await nav(page).boundingBox()).width).toBeGreaterThanOrEqual(180);
  expect((await calendar.locator('.nav-label').boundingBox()).width).toBeGreaterThan(10);
  await expect(nav(page).locator('.nav-sub[aria-label="일정"] [data-goto="calendar"]')).toBeVisible();
  expect((await nav(page).locator('.nav-sub-btn[data-view="tasks"] .nav-label').boundingBox()).width).toBeGreaterThan(10);
  const after=await page.locator('#homeView').boundingBox();
  expect(Math.abs(after.x-before.x)).toBeLessThan(1);expect(Math.abs(after.width-before.width)).toBeLessThan(1);
  // Esc로 접히고 초점은 그 버튼으로.
  await page.keyboard.press('Escape');
  await expect(view).not.toHaveClass(/nav-open/);
  await expect(toggle(page)).toBeFocused();
  // 펼친 채 [+ 추가]를 누르면 이름이 접히고, 열린 작은 창은 화면 안에 다 보이며 메뉴에 가려지지 않는다.
  await toggle(page).click();await expect(view).toHaveClass(/nav-open/);
  const add=page.locator('#appView>.app-topline [data-quick-add]');
  await add.click();
  await expect(view).not.toHaveClass(/nav-open/);
  await expect(add).toHaveAttribute('aria-expanded','true');
  const panel=page.locator('#toplineAddMenu');await expect(panel).toBeVisible();
  const covered=await panel.evaluate(panel=>{
    const r=panel.getBoundingClientRect();
    if(r.left<0||r.top<0||r.right>innerWidth||r.bottom>innerHeight)return 'outside '+JSON.stringify(r);
    for(const b of panel.querySelectorAll('button')){const q=b.getBoundingClientRect(),hit=document.elementFromPoint(q.left+q.width/2,q.top+q.height/2);if(!b.contains(hit))return b.textContent+' covered by '+(hit?.tagName||'none')+'.'+(hit?.className||'')}
    return null;
  });
  expect(covered).toBeNull();
  await page.keyboard.press('Escape');
  // 바깥(본문)을 누르면 접힌다.
  await toggle(page).click();await expect(view).toHaveClass(/nav-open/);
  await page.locator('#homeView').click({position:{x:Math.max(5,after.width-20),y:10}});
  await expect(view).not.toHaveClass(/nav-open/);
});

test('폴드 → PC → 폰으로 폭이 바뀌어도 메뉴가 한 벌이다',async({page})=>{
  await page.setViewportSize({width:884,height:1104});
  await open(page);
  await toggle(page).click();await expect(page.locator('#appView')).toHaveClass(/nav-open/);
  // 폭이 바뀌면 펼침은 접힌다(PC는 원래 이름 있는 사이드바).
  await page.setViewportSize({width:1280,height:900});
  await expect(page.locator('#appView')).not.toHaveClass(/nav-open/);
  await expect(nav(page).locator('.nav-btn[data-view="calendar"] .nav-ico')).toBeHidden();
  await expect(nav(page).locator('.nav-btn[data-view="calendar"] .nav-label')).toBeVisible();
  await expect(toggle(page)).toHaveAccessibleName('메뉴 숨기기');
  await page.setViewportSize({width:412,height:900});
  await expect(nav(page)).toBeHidden();
  await expect(page.locator('.mobile-tabs')).toBeVisible();
  await page.setViewportSize({width:900,height:800});
  await expect(nav(page)).toBeVisible();
  await expect(nav(page).locator('.nav-btn[data-view="calendar"]')).toHaveCount(1);
  expect(await page.locator('#mobileMenu nav .nav-btn').count()).toBe(0);
});
