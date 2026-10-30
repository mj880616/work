import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// OPS-수집점검: "마지막 수집 시각" card (app/collection-status.js). HOME-업무일지홈: 옛 홈 칸에서 내 프로필 '수집·사용량' 칸
// (#psStatusPanel [data-ps-collect], profile-status.js)으로 옮겼고 폭과 상관없이 같은 칸 하나다(옛 폰 홈 경고 줄·메뉴 판 칸은 없앴다). drive-summary GET ?action=status and
// app_todo_radar_state are mocked; nothing here calls a real server. Clock: 2026-10-06 10:00 KST (openHome).
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const status=copy=>({ok:true,checked_at:'2026-10-06T01:00:00.000Z',copy:{state:'found',last_failure_at:null,last_failure_code:null,...copy}});

async function fixture(page,{copy=status({last_success_at:'2026-10-05T21:17:00.000Z'}),state=[{last_success_at:'2026-10-06T00:30:00Z'}],width=1280}={}){
  await page.setViewportSize({width,height:900});
  await openHome(page,{query:'?view=profile'});
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
  await expect(page.locator('#profileView')).toBeVisible();
  return {calls,card:page.locator('#psStatusPanel [data-ps-collect]')};
}

for(const width of [1280,390])test(`shows each source, 확인 불가 for outside programs, and reads without rebuilding (${width})`,async({page})=>{
  const f=await fixture(page,{width}),{calls,card}=f;
  await expect(card).toBeVisible();
  // 옛 홈 경고 줄·메뉴 판 칸은 없다.
  await expect(page.locator('[data-home-collect-alert],[data-home-collect-ok],[data-menu-collect]')).toHaveCount(0);
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
  await expect.poll(()=>f.calls.filter(c=>!c.table).length).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  await expect(f.card).toBeHidden();
  await expect(page.locator('#profileView')).not.toContainText('수집 시각');
});

// OPS-수집점검 2단계: collectors in the same status answer (heartbeat from the call-transcript Apps Script).
const withCollectors=collectors=>({...status({last_success_at:'2026-10-05T21:17:00.000Z'}),collectors});
for(const width of [1280,390])test(`telegram and call lines show the heartbeat time, telegram and call counts and 조용함 when files are old (${width})`,async({page})=>{
  const f=await fixture(page,{width,copy:withCollectors({
    telegram:{last_at:'2026-10-04T22:30:00.000Z',count:7,reported_at:'2026-10-06T00:40:00.000Z'},
    transcript:{last_at:'2026-10-05T23:05:00.000Z',count:3,reported_at:'2026-10-06T00:40:00.000Z'},
  })}),{calls,card}=f;
  await expect(card).toBeVisible();
  await expect(card).not.toContainText('확인 불가');
  await expect(card.locator('[data-collect="telegram"]')).toHaveAttribute('data-collect-state','quiet');
  await expect(card.locator('[data-collect="telegram"]')).toContainText('07:30');
  await expect(card.locator('[data-collect="telegram"]')).toContainText('조용함');
  await expect(card.locator('[data-collect="telegram"]')).toContainText('24시간 7건');
  await expect(card.locator('[data-collect="telegram"] .collect-warn')).toHaveCount(0);
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

const staleTelegram=withCollectors({
  telegram:{last_at:'2026-10-04T22:30:00.000Z',count:null,reported_at:'2026-10-05T20:00:00.000Z'},
  transcript:{last_at:'2026-10-05T23:05:00.000Z',count:3,reported_at:'2026-10-06T00:40:00.000Z'},
});
for(const width of [1280,390])test(`a stale signal is 주의 in the card (no separate warning line) (${width})`,async({page})=>{
  {
    const f=await fixture(page,{width,copy:staleTelegram});
    await expect(f.card).toBeVisible();
    await expect(f.card.locator('[data-collect="telegram"]')).toHaveAttribute('data-collect-state','silent');
    await expect(f.card.locator('[data-collect="telegram"] .collect-warn')).toHaveText('주의 · 점검 신호 끊김');
    await expect(page.locator('[data-home-collect-alert],[data-menu-collect]')).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
});
test('old files with a healthy signal show 조용함 only, no warning (390)',async({page})=>{
  const {card}=await fixture(page,{width:390,copy:withCollectors({
    telegram:{last_at:'2026-10-04T22:30:00.000Z',count:null,reported_at:'2026-10-06T00:40:00.000Z'},
    transcript:{last_at:'2026-10-01T23:05:00.000Z',count:0,reported_at:'2026-10-06T00:40:00.000Z'},
  })});
  await expect(card.locator('[data-collect="telegram"]')).toHaveAttribute('data-collect-state','quiet');
  await expect(card.locator('[data-collect="call"]')).toHaveAttribute('data-collect-state','quiet');
  await expect(card.locator('.collect-warn')).toHaveCount(0);
});

// HOME-수집시각정렬: 네 줄의 시각이 같은 세로선(오른쪽 끝)에 서고, 건수는 시각 앞 별도 칸(없는 줄은 빈칸). 배치만 본다.
const rightEdges=(scope)=>scope.locator('[data-collect] .collect-value').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect(),row=el.closest('[data-collect]').getBoundingClientRect();return {key:el.closest('[data-collect]').dataset.collect,right:r.right,rowRight:row.right,w:r.width};}));
const alignCases={
  'count on call only (ok)':withCollectors({
    telegram:{last_at:'2026-10-04T22:30:00.000Z',count:null,reported_at:'2026-10-06T00:40:00.000Z'},
    transcript:{last_at:'2026-10-05T23:05:00.000Z',count:34,reported_at:'2026-10-06T00:40:00.000Z'},
  }),
  'warnings and quiet notes':staleTelegram,
};
for(const width of [1280,390])for(const [name,copy] of Object.entries(alignCases))test(`four times share one right edge, count cell apart from time (${name}, ${width})`,async({page})=>{
  const {card}=await fixture(page,{width,copy});
  await expect(card).toBeVisible();
  await expect(card.locator('[data-collect]')).toHaveCount(4);
  const edges=await rightEdges(card);
  expect(edges.map(e=>e.key)).toEqual(['telegram','call','copy','radar']);
  for(const e of edges){expect(Math.abs(e.right-edges[0].right)).toBeLessThanOrEqual(1);expect(Math.abs(e.right-e.rowRight)).toBeLessThanOrEqual(1);expect(e.w).toBeGreaterThan(0);}
  // 건수 칸: 통화 줄만 채워지고 나머지는 비어 있으며, 건수는 시각의 왼쪽에 겹치지 않게 선다.
  const counts=await card.locator('[data-collect]').evaluateAll(els=>els.map(el=>{const c=el.querySelector('.collect-count'),v=el.querySelector('.collect-value');return {key:el.dataset.collect,text:c.textContent,cRight:c.getBoundingClientRect().right,vLeft:v.getBoundingClientRect().left};}));
  expect(counts.filter(c=>c.text).map(c=>c.key)).toEqual(['call']);
  expect(counts.find(c=>c.key==='call').text).toBe('24시간 34건'.replace('34',String(copy.collectors.transcript.count)));
  for(const c of counts)expect(c.cRight).toBeLessThanOrEqual(c.vLeft+1);
  // 글자 크기는 지금처럼 콤팩트(12px) 그대로.
  expect(await card.locator('.collect-row').first().evaluate(el=>getComputedStyle(el).fontSize)).toBe('12px');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
});
// OPS-수집멈춤알림: 보내기 스크립트 오류와 수집기 긴 멈춤은 주의, 하루 상한은 경고가 아니다(HOME-업무일지홈: 칸 안에서만 표시).
test('a send error and a long collector stall are 주의; a daily cap is not (390)',async({page})=>{
  const {card}=await fixture(page,{width:390,copy:withCollectors({
    telegram:{last_at:'2026-10-02T22:30:00.000Z',count:null,reported_at:'2026-10-06T00:40:00.000Z'},
    transcript:null,
    telegram_send:{last_at:'2026-10-05T23:05:00.000Z',state:'broken',reported_at:'2026-10-06T00:30:00.000Z'},
    call_send:{last_at:'2026-10-05T23:05:00.000Z',state:'limit_day',reported_at:'2026-10-06T00:30:00.000Z'},
  })});
  await expect(card.locator('[data-collect="telegram"]')).toHaveAttribute('data-collect-state','stalled');
  await expect(card.locator('[data-collect="telegram"] .collect-warn')).toHaveCount(1);
  await expect(card.locator('[data-collect="telegramSend"]')).toHaveAttribute('data-collect-state','broken');
  await expect(card.locator('[data-collect="telegramSend"] .collect-warn')).toHaveCount(1);
  await expect(card.locator('[data-collect="callSend"]')).toHaveAttribute('data-collect-state','limit_day');
  await expect(card.locator('[data-collect="callSend"] .collect-warn')).toHaveCount(0);
});
