import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// OPS-수집점검: home "마지막 수집 시각" card (app/collection-status.js). drive-summary GET ?action=status and
// app_todo_radar_state are mocked; nothing here calls a real server. Clock: 2026-10-06 10:00 KST (openHome).
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const status=copy=>({ok:true,checked_at:'2026-10-06T01:00:00.000Z',copy:{state:'found',last_failure_at:null,last_failure_code:null,...copy}});

async function fixture(page,{copy=status({last_success_at:'2026-10-05T21:17:00.000Z'}),state=[{last_success_at:'2026-10-06T00:30:00Z'}],width=1280}={}){
  await page.setViewportSize({width,height:900});
  await openHome(page);
  const calls=[];
  await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/drive-summary',route=>{
    const req=route.request();
    if(req.method()==='OPTIONS')return route.fulfill({status:204});
    calls.push({method:req.method(),action:new URL(req.url()).searchParams.get('action'),body:req.postData()});
    if(copy==='abort')return route.abort('failed');
    if(copy==='missing')return route.fulfill({status:405,json:{ok:false,error:'METHOD_NOT_ALLOWED'}});
    return route.fulfill({json:copy});
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_todo_radar_state',route=>{
    calls.push({method:route.request().method(),table:true,query:new URL(route.request().url()).search});
    if(state==='missing')return route.fulfill({status:404,json:{code:'PGRST205',message:"Could not find the table 'public.app_todo_radar_state' in the schema cache"}});
    return route.fulfill({json:state});
  });
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  await expect(page.locator('#homeView')).toBeVisible();
  return {calls,card:page.locator('[data-home-card="collect"]')};
}

// HOME-수집경보: 폰·중간 폭(1023px 이하)은 홈 칸 대신 위쪽 경고 줄·맨 아래 '수집 정상 ✓'이고, 같은 전체 칸이 폰 메뉴 창 안에 있다.
for(const width of [1280,390])test(`shows each source, 확인 불가 for outside programs, and reads without rebuilding (${width})`,async({page})=>{
  const f=await fixture(page,{width}),{calls}=f,card=width<1024?page.locator('[data-menu-collect]'):f.card;
  if(width<1024){
    await expect(f.card).toBeHidden();
    await expect(page.locator('[data-home-collect-ok]')).toBeVisible();
    await expect(page.locator('[data-home-collect-ok]')).toHaveText('수집 정상 ✓');
    await expect(page.locator('[data-home-collect-alert]')).toBeHidden();
    await page.locator('#mobileMenuTab').click();
  }
  await expect(card).toBeVisible();
  await expect(card.locator('h3')).toHaveText('마지막 수집 시각');
  await expect(card.locator('[data-collect="telegram"]')).toContainText('확인 불가');
  await expect(card.locator('[data-collect="call"]')).toContainText('확인 불가');
  await expect(card.locator('[data-collect="copy"]')).toHaveAttribute('data-collect-state','ok');
  await expect(card.locator('[data-collect="copy"]')).toContainText('06:17');
  await expect(card.locator('[data-collect="copy"] .collect-label')).toHaveText('Claude용 Drive 사본');
  await expect(card.locator('[data-collect="radar"]')).toHaveAttribute('data-collect-state','ok');
  await expect(card.locator('.collect-warn')).toHaveCount(0);
  const fn=calls.filter(c=>!c.table);
  expect(fn).toEqual([{method:'GET',action:'status',body:null}]);
  expect(calls.filter(c=>c.table)).toHaveLength(1);
  expect(calls.filter(c=>c.table)[0].query).toContain('select=last_success_at');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('stale copy and a failure newer than success are marked 주의',async({page})=>{
  const {card}=await fixture(page,{copy:status({last_success_at:'2026-10-04T21:17:00.000Z'}),state:[{last_success_at:'2026-10-03T00:00:00Z'}]});
  await expect(card.locator('[data-collect="copy"]')).toHaveAttribute('data-collect-state','stale');
  await expect(card.locator('[data-collect="copy"] .collect-warn')).toHaveText('주의 · 오래됨');
  await expect(card.locator('[data-collect="radar"]')).toHaveAttribute('data-collect-state','stale');
});
test('a failed last copy attempt is 주의 · 최근 실패 without showing the code',async({page})=>{
  const {card}=await fixture(page,{copy:status({last_success_at:'2026-10-05T21:17:00.000Z',last_failure_at:'2026-10-06T00:17:00.000Z',last_failure_code:'DRIVE_UPLOAD_FAILED'})});
  await expect(card.locator('[data-collect="copy"] .collect-warn')).toHaveText('주의 · 최근 실패');
  await expect(card).not.toContainText('DRIVE_UPLOAD_FAILED');
});
test('missing radar table hides only that line',async({page})=>{
  const f=await fixture(page,{state:'missing'});
  await expect(f.card.locator('[data-collect="copy"]')).toBeVisible();
  await expect(f.card.locator('[data-collect="radar"]')).toHaveCount(0);
});
for(const copy of ['missing','abort'])test(`function not deployed (${copy}) and table missing hide the whole card`,async({page})=>{
  const f=await fixture(page,{copy,state:'missing'});
  await page.waitForFunction(()=>window.KPTUHome?.metrics?.readyAt);
  await page.waitForTimeout(300);
  await expect(f.card).toBeHidden();
  await expect(page.locator('#homeView')).not.toContainText('수집 시각');
});

// OPS-수집점검 2단계: collectors in the same status answer (heartbeat from the call-transcript Apps Script).
const withCollectors=collectors=>({...status({last_success_at:'2026-10-05T21:17:00.000Z'}),collectors});
for(const width of [1280,390])test(`telegram and call lines show the heartbeat time, call count and 주의 when old (${width})`,async({page})=>{
  const f=await fixture(page,{width,copy:withCollectors({
    telegram:{last_at:'2026-10-04T22:30:00.000Z',count:null,reported_at:'2026-10-06T00:40:00.000Z'},
    transcript:{last_at:'2026-10-05T23:05:00.000Z',count:3,reported_at:'2026-10-06T00:40:00.000Z'},
  })}),{calls}=f,card=width<1024?page.locator('#homeCollectPanel'):f.card;
  if(width<1024){
    await expect(f.card).toBeHidden();
    await expect(page.locator('[data-home-collect-ok]')).toBeHidden();
    await page.locator('[data-collect-expand]').click();
  }
  await expect(card).toBeVisible();
  await expect(card).not.toContainText('확인 불가');
  await expect(card.locator('[data-collect="telegram"]')).toHaveAttribute('data-collect-state','stale');
  await expect(card.locator('[data-collect="telegram"]')).toContainText('07:30');
  await expect(card.locator('[data-collect="telegram"] .collect-warn')).toHaveText('주의 · 오래됨');
  await expect(card.locator('[data-collect="call"]')).toHaveAttribute('data-collect-state','ok');
  await expect(card.locator('[data-collect="call"]')).toContainText('08:05');
  await expect(card.locator('[data-collect="call"]')).toContainText('24시간 3건');
  await expect(card.locator('[data-collect="copy"]')).toHaveAttribute('data-collect-state','ok');
  expect(calls.filter(c=>!c.table)).toEqual([{method:'GET',action:'status',body:null}]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('no heartbeat yet says 점검 신호 없음; a heartbeat older than 3 hours is 주의 · 점검 신호 끊김',async({page})=>{
  const {card}=await fixture(page,{copy:withCollectors({
    telegram:null,
    transcript:{last_at:'2026-10-05T20:00:00.000Z',count:0,reported_at:'2026-10-05T21:00:00.000Z'},
  })});
  await expect(card.locator('[data-collect="telegram"]')).toHaveAttribute('data-collect-state','never');
  await expect(card.locator('[data-collect="telegram"]')).toContainText('점검 신호 없음');
  await expect(card.locator('[data-collect="telegram"] .collect-warn')).toHaveCount(0);
  await expect(card.locator('[data-collect="call"]')).toHaveAttribute('data-collect-state','silent');
  await expect(card.locator('[data-collect="call"] .collect-warn')).toHaveText('주의 · 점검 신호 끊김');
});

// HOME-수집경보(폰): 하나라도 주의면 홈 위쪽 얇은 경고 한 줄 → 누르면 전체 칸, ✕는 오늘 하루 숨김(다시 열어도 숨김), 전체 칸은 메뉴 창에도.
const staleTelegram=withCollectors({
  telegram:{last_at:'2026-10-04T22:30:00.000Z',count:null,reported_at:'2026-10-06T00:40:00.000Z'},
  transcript:{last_at:'2026-10-05T23:05:00.000Z',count:3,reported_at:'2026-10-06T00:40:00.000Z'},
});
test('phone: one thin warning line opens the full card, ✕ hides it for today, menu keeps the full card',async({page})=>{
  const f=await fixture(page,{width:390,copy:staleTelegram});
  const alert=page.locator('[data-home-collect-alert]'),open=alert.locator('[data-collect-expand]'),panel=page.locator('#homeCollectPanel');
  await expect(alert).toBeVisible();
  await expect(f.card).toBeHidden();
  await expect(page.locator('[data-home-collect-ok]')).toBeHidden();
  await expect(open).toHaveText('텔레그램 수집이 10/5 오전 이후 멈췄어요›');
  // 홈 위쪽: 오늘 일정 칸보다 위, 한 줄 높이.
  const box=await alert.locator('.collect-alert-line').boundingBox(),cal=await page.locator('[data-home-card="calendar"]').boundingBox();
  expect(box.y+box.height).toBeLessThanOrEqual(cal.y);
  expect(box.height).toBeLessThanOrEqual(34);
  const lines=await open.locator('span').first().evaluate(el=>Math.round(el.getBoundingClientRect().height/parseFloat(getComputedStyle(el).lineHeight)));
  expect(lines).toBe(1);
  // 누르는 범위는 44px(::after).
  for(const b of [open,alert.locator('[data-collect-dismiss]')])expect(await b.evaluate(el=>getComputedStyle(el,'::after').height)).toBe('44px');
  await expect(panel).toBeHidden();
  await open.click();
  await expect(open).toHaveAttribute('aria-expanded','true');
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-collect="telegram"] .collect-warn')).toHaveText('주의 · 오래됨');
  await page.screenshot({path:'test-results/home-collect-alert-390.png',fullPage:true});
  await open.click();
  await expect(panel).toBeHidden();
  await alert.locator('[data-collect-dismiss]').click();
  await expect(alert).toBeHidden();
  // 같은 날 다시 열어도 숨김. 메뉴 창의 전체 칸은 그대로.
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  await expect(page.locator('[data-menu-collect] [data-collect="telegram"]')).toHaveAttribute('data-collect-state','stale');
  await expect(alert).toBeHidden();
  await expect(page.locator('[data-home-collect-ok]')).toBeHidden();
  await page.locator('#mobileMenuTab').click();
  const menu=page.locator('[data-menu-collect]');
  await expect(menu).toBeVisible();
  await expect(menu.locator('h3')).toHaveText('마지막 수집 시각');
  await expect(menu.locator('[data-collect="telegram"] .collect-warn')).toHaveText('주의 · 오래됨');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/home-collect-menu-390.png'});
});
test('phone: blocked device storage still shows the warning and ✕ hides it for this view',async({page})=>{
  await page.addInitScript(()=>{const get=Storage.prototype.getItem,set=Storage.prototype.setItem,hit=k=>String(k).includes('collect-alert-hidden');Storage.prototype.getItem=function(k){if(hit(k))throw new Error('blocked');return get.call(this,k)};Storage.prototype.setItem=function(k,v){if(hit(k))throw new Error('blocked');return set.call(this,k,v)}});
  await fixture(page,{width:390,copy:staleTelegram});
  const alert=page.locator('[data-home-collect-alert]');
  await expect(alert).toBeVisible();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await alert.locator('[data-collect-dismiss]').click();
  expect(errors).toEqual([]);
  await expect(page.locator('[data-menu-collect] [data-collect="telegram"]')).toHaveAttribute('data-collect-state','stale');
});
test('PC keeps the right-column card and never shows the phone lines (1280)',async({page})=>{
  const f=await fixture(page,{width:1280,copy:staleTelegram});
  await expect(f.card).toBeVisible();
  await expect(f.card.locator('[data-collect="telegram"]')).toHaveAttribute('data-collect-state','stale');
  await expect(page.locator('[data-home-collect-alert]')).toBeHidden();
  await expect(page.locator('[data-home-collect-ok]')).toBeHidden();
  const aside=await page.locator('[data-home-column="aside"]').boundingBox(),card=await f.card.boundingBox();
  expect(card.x).toBeGreaterThanOrEqual(aside.x);
});
