import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {installViewPrefsServer} from './helpers/view-prefs-server.mjs';
// UI-앱안알림 2단계(docs/design/in-app-notices.md 4절 1·2): 맨 위 알림 줄의 '연결 끊김'·'수집 멈춤'(app/notice-lines.js).
// 서버는 모두 흉내 낸다. 시험 글·값은 가짜다. 폰(폴드 접음)·폴드 펼침·PC 세 폭.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
// openHome의 시계는 2026-10-06T01:00Z. Claude용 Drive 사본이 사흘 전 마지막 성공 → 내 프로필 수집 칸 기준으로 '주의 · 오래됨'.
const stalled={ok:true,checked_at:'2026-10-06T00:59:00.000Z',copy:{state:'found',last_success_at:'2026-10-03T03:00:00.000Z',last_failure_at:null,last_failure_code:null}};
const healthy={...stalled,copy:{...stalled.copy,last_success_at:'2026-10-06T00:30:00.000Z'}};
const line=(page,key)=>page.locator(`#noticeBar [data-notice="${key}"]`);

async function fixture(page,{width=1280,status=stalled,google='ok',prefs=null}={}){
  await page.setViewportSize({width,height:844});
  if(prefs)await installViewPrefsServer(page,prefs);
  await openHome(page);
  const calls=[];
  await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/drive-summary',route=>{
    const req=route.request();if(req.method()==='OPTIONS')return route.fulfill({status:204});
    calls.push(new URL(req.url()).searchParams.get('action'));
    return route.fulfill({json:status});
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_todo_radar_state',route=>route.fulfill({json:[{last_success_at:'2026-10-06T00:30:00Z'}]}));
  if(google==='broken')await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/google-tasks',route=>{
    const req=route.request();if(req.method()==='OPTIONS')return route.fulfill({status:204});
    return route.fulfill({json:{connected:true,authorized:false,needs_reconnect:true,tasks:[]}});
  });
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  return {calls};
}
const geometry=page=>page.evaluate(()=>{
  const bar=document.getElementById('noticeBar'),r=bar.getBoundingClientRect(),shown=[...bar.children].find(el=>!el.hidden);
  const text=shown.querySelector('[role="status"]');
  return {top:r.top,height:r.height,pad:parseFloat(getComputedStyle(document.body).paddingTop),bg:getComputedStyle(shown).backgroundColor,
    lines:Math.round(text.getBoundingClientRect().height/parseFloat(getComputedStyle(text).lineHeight)),overflow:document.documentElement.scrollWidth>innerWidth};
});

for(const width of [390,900,1280])test(`collection stall shows one warn line on other screens with the same rule as the profile card (${width}px)`,async({page})=>{
  const {calls}=await fixture(page,{width});
  await expect(line(page,'collect')).toBeVisible();
  await expect(line(page,'collect').getByRole('status')).toHaveText('Claude용 Drive 사본이 10/3 오후 이후 멈췄어요');
  const g=await geometry(page);
  expect(g).toMatchObject({top:0,lines:1,overflow:false});
  expect(g.height).toBeLessThanOrEqual(34);expect(g.pad).toBe(g.height);
  // 옅은 주황(톤다운) — 업데이트 안내의 옅은 테마색과 다르다. 빨간 배지·종 모양 없음.
  expect(g.bg).toBe(await page.evaluate(()=>{const p=document.createElement('p');p.style.background='var(--kptu-warning-soft)';document.body.append(p);const c=getComputedStyle(p).backgroundColor;p.remove();return c}));
  await expect(page.locator('#noticeBar svg.bell, #noticeBar .badge')).toHaveCount(0);
  // [보기]는 내 프로필 수집 칸으로. 그 칸이 보이는 동안 줄은 내려간다(같은 안내 두 곳 금지). 읽기는 칸과 함께 한 번.
  await line(page,'collect').getByRole('button',{name:'보기'}).click();
  await expect(page.locator('#profileView')).toBeVisible();
  await expect(page.locator('#psStatusPanel [data-collect="copy"]')).toBeVisible();
  await expect(page.locator('#noticeBar')).toHaveCount(0);
  expect(calls.filter(a=>a==='status')).toHaveLength(1);
  await page.evaluate(()=>window.KPTURouter.go('calendar'));
  await expect(line(page,'collect')).toBeVisible();
  expect(calls.filter(a=>a==='status')).toHaveLength(1);
});

test('collection stall ✕ hides it for today on the server (view_prefs.collect_hidden_on), no device storage',async({page})=>{
  const prefs=await installViewPrefsServer(page,{});
  await fixture(page);
  await line(page,'collect').getByRole('button',{name:'닫기'}).click();
  await expect(page.locator('#noticeBar')).toHaveCount(0);
  await expect.poll(()=>prefs.patches.at(-1)?.collect_hidden_on).toBe('2026-10-06');
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>/notice|collect/i.test(k)))).toEqual([]);
  // 다른 기기·새로고침: 서버 값이 오늘이라 안 뜬다.
  await page.reload();await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  await page.evaluate(()=>window.KPTURouter.go('calendar'));await page.waitForTimeout(300);
  await expect(page.locator('#noticeBar')).toHaveCount(0);
});

test('healthy collection and connected Google: no line',async({page})=>{
  await fixture(page,{status:healthy});
  await page.evaluate(()=>window.KPTURouter.go('tasks'));await page.waitForTimeout(500);
  await expect(page.locator('#noticeBar')).toHaveCount(0);
  expect(await page.evaluate(()=>document.body.classList.contains('kptu-notice-bar-open'))).toBe(false);
});

for(const width of [390,900,1280])test(`Google needs reconnect: link line first, '1/2' moves to the next line (${width}px)`,async({page})=>{
  await fixture(page,{width,google:'broken'});
  await page.evaluate(()=>window.KPTURouter.go('tasks'));
  await expect(line(page,'link')).toBeVisible();
  await expect(line(page,'link').getByRole('status')).toHaveText('Google 연결이 끊겨 일정·할 일 저장이 안 돼요');
  await expect(line(page,'link').getByRole('button',{name:'다시 연결'})).toBeVisible();
  await expect(line(page,'collect')).toBeHidden();
  const count=page.locator('#noticeBar .kptu-notice-bar-count');
  await expect(count).toHaveText('1/2');
  expect((await geometry(page)).lines).toBe(1);
  await count.click();
  await expect(line(page,'collect')).toBeVisible();await expect(line(page,'link')).toBeHidden();
  await expect(count).toHaveText('2/2');
  // 연결 끊김 ✕는 이 탭에서만(서버 기억은 DB 칸이 생긴 뒤). 수집 멈춤 줄은 그대로.
  await count.click();await line(page,'link').getByRole('button',{name:'닫기'}).click();
  await expect(line(page,'link')).toHaveCount(0);await expect(line(page,'collect')).toBeVisible();
  await expect(count).toHaveCount(0);
});

test('Google reconnect starts the same connect flow as the tasks screen',async({page})=>{
  await fixture(page,{google:'broken',status:healthy});
  let started=0;
  await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/google-tasks'&&u.searchParams.get('action')==='start',route=>{started++;return route.fulfill({json:{url:null}})});
  await page.evaluate(()=>window.KPTURouter.go('tasks'));
  await line(page,'link').getByRole('button',{name:'다시 연결'}).click();
  await expect.poll(()=>started).toBe(1);
});

test('a later healthy read clears the link line by itself',async({page})=>{
  await fixture(page,{status:healthy});
  // 같은 모듈을 쓰는 원드라이브 끊김 → 풀림 흐름을 앱 길로 흉내 낸다(사진 화면 없이): 실패 응답 뒤 성공 응답.
  let expired=true;const actions=[];
  await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/onedrive-photos',route=>{
    const req=route.request();if(req.method()==='OPTIONS')return route.fulfill({status:204});
    const action=req.postDataJSON()?.action;
    if(action==='status')return route.fulfill({json:{configured:true,connected:true,whole:true,folder:{name:'QA'}}});
    actions.push(action);
    if(expired)return route.fulfill({status:424,json:{error:'onedrive_auth_expired'}});
    return route.fulfill({json:{more:false,indexing:false,changed:0,items:[],months:[],days:[],photos:[]}});
  });
  await page.evaluate(()=>window.KPTURouter.go('photos'));
  await expect.poll(()=>actions.length,{timeout:15000}).toBeGreaterThan(0);
  await expect(line(page,'link')).toBeVisible();
  await expect(line(page,'link').getByRole('status')).toHaveText('원드라이브 연결이 풀려 사진을 못 읽어요');
  expired=false;
  await page.evaluate(()=>window.KPTURouter.go('home'));await page.evaluate(()=>window.KPTURouter.go('photos'));
  await expect(line(page,'link')).toHaveCount(0,{timeout:15000});
});
