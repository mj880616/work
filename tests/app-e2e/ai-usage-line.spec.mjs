import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// AI-비용보기 6단계: 내 프로필 '사용 현황' 칸 'AI 비용' 줄. 기간을 맨 위에, 월말 예상을 요약에, 펼치면 공급자 두 줄·접힌 기능별 표·접힌 한도·자동 충전 입력(서버 저장). 잔액 줄은 없음.
// drive-summary GET ?action=status만 가짜로 답한다(진짜 서버 호출 없음). 시계: 2026-10-06 10:00 서울(openHome).
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const usage=(over={})=>({ok:true,month:'2026-10',warn:[],
  openai:{krw:393,estimate_krw:393,ratio:null,actual:false,assist_krw:156,telegram_krw:237,call_krw:0,limit_assist_krw:15000,limit_feed_krw:6000,balance:{topup_krw:30000,topup_on:'2026-10-04',left_krw:9000},last_bill:{month:'2026-09',krw:7000}},
  gemini:{krw:0,estimate_krw:0,ratio:null,actual:false,transcript_krw:0,analysis_krw:0,calls:0,unknown_models:[],balance:null,last_bill:null},
  entries:[{id:'00000000-0000-4000-8000-000000000001',provider:'openai',kind:'topup',amount_krw:30000,month:null,created_at:'2026-10-04T03:00:00Z'}],...over});
const status=ai=>({ok:true,checked_at:'2026-10-06T01:00:00.000Z',copy:{state:'found',last_success_at:'2026-10-05T21:17:00.000Z',last_failure_at:null,last_failure_code:null},ai_usage:ai});

// AI-비용보기 6단계: 서버 표(app_ai_cost_entries)를 흉내 내는 상태. 넣은 한도(cap)·자동 충전(reload)이 다음 상태 답 forecast에 들어간다(서버 계산과 같은 자리).
function withEntries(ai,entries){
  const last=kind=>entries.filter(e=>e.kind===kind&&e.amount_krw>0).at(-1)?.amount_krw??null;
  const f=ai.forecast||{openai:{month_end_krw:2030,suggest_reload_krw:10000},gemini:{month_end_krw:0,suggest_cap_krw:0,raise_cap:false}};
  return {...ai,forecast:{openai:{...f.openai,reload_krw:last('reload'),reloads_per_month:last('reload')?0.1:null},gemini:{...f.gemini,cap_krw:last('cap'),cap_day:f.gemini.cap_day??null}}};
}
async function fixture(page,{width,ai=usage(),entries=[]}){
  await page.setViewportSize({width,height:900});
  await openHome(page,{query:'?view=profile'});
  await page.waitForLoadState('networkidle'); // S71-36: 앞 화면의 늦은 사용 현황 읽기가 끝난 뒤 세기 시작
  const writes=[],posts=[];let reads=0;
  await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/drive-summary',route=>{
    const req=route.request();
    if(req.method()==='OPTIONS')return route.fulfill({status:204});
    if(req.method()!=='GET')writes.push(req.method());
    reads++;
    return route.fulfill({json:status(withEntries(ai,entries))});
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_ai_cost_entries',route=>{
    const req=route.request();
    if(req.method()==='OPTIONS')return route.fulfill({status:204});
    writes.push(req.method());
    if(req.method()==='POST'){const b=req.postDataJSON();posts.push(b);entries.push(b);return route.fulfill({status:201,body:''});}
    return route.fulfill({json:[]});
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_todo_radar_state',route=>route.fulfill({json:[{last_success_at:'2026-10-06T00:30:00Z'}]}));
  // MULTI-다른담당자맞춤 ④: 수집·사용량 줄은 서버 운영자 기능(app_my_features)이 있는 작업공간에서만 그린다.
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_my_features',route=>route.fulfill({json:['calls']}));
  // S71-36: 운영자 기능 답을 정한 뒤 '사용 현황' 장(?view=profile&pane=status)을 연다(먼저 열면 운영자 아님으로 읽어 첫 화면으로 돌아간다).
  await page.goto(new URL('?view=profile&pane=status',page.url()).href);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  await expect(page.locator('#profileView')).toBeVisible();
  return {writes,posts,entries,reads:()=>reads,line:page.locator('#psStatusPanel [data-ps-ai-usage]')};
}
const noSideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
// 칸 안 모든 것이 칸 폭 안에 있는지(가로로 삐져나오지 않음).
const insideBox=line=>line.evaluate(el=>{const r=el.getBoundingClientRect();return [...el.querySelectorAll('*')].filter(n=>n.getClientRects().length).every(n=>{const b=n.getBoundingClientRect();return b.left>=r.left-1&&b.right<=r.right+1;});});

for(const width of [390,880,1440])test(`AI 비용: 한 줄 요약 → 공급자 두 줄 → 접힌 기능별·한도 (${width})`,async({page})=>{
  const {line,writes}=await fixture(page,{width});
  await expect(line).toBeVisible();
  const head=line.locator('[data-aiu-toggle]');
  await expect(head.locator('.aiu-title')).toHaveText('AI 비용 · 10월 1일~6일 (이번 달, 추정)');
  await expect(head.locator('.aiu-sum')).toHaveText('OpenAI 393원 · Gemini 0원 · 월말 약 2,030원');
  await expect(head).toHaveAttribute('aria-expanded','false');
  expect((await head.boundingBox()).height).toBeLessThanOrEqual(48);
  await head.click();
  await expect(head).toHaveAttribute('aria-expanded','true');
  const panel=line.locator('.aiu-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-aiu-prov]')).toHaveCount(2);
  await expect(panel.locator('[data-aiu-prov="openai"]')).toContainText('OpenAI 선불393원');
  await expect(panel.locator('[data-aiu-prov="openai"] .aiu-sub')).toHaveText('월말 약 2,030원 · 권장 자동 충전 10,000원');
  // 기능별: 평소 접힌 한 문장, 펼치면 큰 순 표 + 서버 상한 한 줄
  const feat=panel.locator('[data-aiu-fold="feat"]');
  await expect(feat.locator('summary')).toHaveText('기능별 2개 · 가장 큰 곳 텔레그램·통화 판정 237원');
  await expect(feat.locator('.aiu-feat')).toBeHidden();
  await feat.locator('summary').click();
  await expect(feat.locator('[data-aiu-feature]')).toHaveCount(2);
  await expect(feat.locator('[data-aiu-feature]').nth(0)).toContainText('텔레그램·통화 판정237원');
  await expect(feat.locator('[data-aiu-feature]').nth(1)).toContainText('AI 기능(기능 구분 전)156원');
  await expect(feat).toContainText('서버 상한 · WORK ON+ AI 156원/15,000원 · 판정 237원/6,000원');
  // 한도·자동 충전: 접힌 한 줄, 펼치면 입력 두 칸 + [저장] 한 줄
  const limits=panel.locator('[data-aiu-fold="limits"]');
  await expect(limits.locator('summary')).toHaveText('한도·자동 충전 · Gemini 미입력 · OpenAI 미입력');
  await limits.locator('summary').click();
  await expect(limits.locator('input')).toHaveCount(2);
  // 폴드 펼침·PC는 입력 두 칸 + [저장]이 한 줄(가운데 높이가 같음). 폰은 두 줄까지.
  const mids=await limits.locator('.aiu-inputs > *').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return (r.top+r.bottom)/2;}));
  if(width>=880)expect(Math.max(...mids)-Math.min(...mids)).toBeLessThanOrEqual(4);
  else expect(Math.max(...mids)-Math.min(...mids)).toBeLessThanOrEqual(50);
  // 다른 곳 잔액 줄·버튼 늘리기 없음: 줄 자기 버튼은 펼치기·저장 둘
  await expect(line).not.toContainText('잔액');
  await expect(line.locator('button')).toHaveCount(2);
  expect(await noSideScroll(page)).toBe(true);
  expect(await insideBox(line)).toBe(true);
  await head.click();
  await expect(panel).toBeHidden();
  expect(writes).toEqual([]);
});

for(const width of [390,1440])test(`한도·자동 충전 금액: 서버에 저장되고 다시 열면 보임 (${width})`,async({page})=>{
  const entries=[];
  const {line,posts,reads}=await fixture(page,{width,entries});
  await line.locator('[data-aiu-toggle]').click();
  const limits=line.locator('[data-aiu-fold="limits"]');
  await limits.locator('summary').click();
  await limits.locator('input[name="cap"]').fill('80,000');
  await limits.locator('input[name="reload"]').fill('20000');
  const before=reads();
  await limits.locator('[data-aiu-save]').click();
  await expect(line.locator('[data-aiu-msg]')).toHaveText('저장했어요');
  expect(posts.map(p=>[p.provider,p.kind,p.amount_krw])).toEqual([['gemini','cap',80000],['openai','reload',20000]]);
  for(const p of posts){expect(typeof p.workspace_id).toBe('string');expect(Object.keys(p).sort()).toEqual(['amount_krw','kind','provider','workspace_id']);}
  expect(reads()).toBeGreaterThan(before); // 저장 뒤 서버 답을 새로 받음
  // 다시 그려도 펼친 칸은 그대로, 요약·입력칸에 서버 값
  await expect(limits).toHaveAttribute('open','');
  await expect(limits.locator('summary')).toHaveText('한도·자동 충전 · Gemini 80,000원 · OpenAI 20,000원');
  await expect(line.locator('[data-aiu-prov="gemini"] .aiu-sub')).toContainText('한도 80,000원 중 0%');
  // 바뀐 게 없으면 다시 보내지 않음
  await limits.locator('[data-aiu-save]').click();
  await expect(line.locator('[data-aiu-msg]')).toHaveText('바뀐 금액이 없어요');
  expect(posts.length).toBe(2);
  // 틀린 값은 보내지 않음
  await limits.locator('input[name="cap"]').fill('-5');
  await limits.locator('[data-aiu-save]').click();
  await expect(line.locator('[data-aiu-msg]')).toHaveText('금액은 0~1억 원 숫자로 넣어 주세요');
  expect(posts.length).toBe(2);
  // 기기 저장 없음은 모델 시험(tests/ai-usage-model.test.mjs)이 화면 코드에서 본다. 여기서는 서버 답으로만 다시 보이는지 본다.
  // 다시 열기(새로 불러오기): 서버 표에 남은 값이 보인다
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  await line.locator('[data-aiu-toggle]').click();
  await line.locator('[data-aiu-fold="limits"] summary').click();
  await expect(line.locator('input[name="cap"]')).toHaveValue('80,000');
  await expect(line.locator('input[name="reload"]')).toHaveValue('20,000');
  expect(await noSideScroll(page)).toBe(true);
});

test('잔액 경고 코드가 와도 노란 줄이 되지 않음',async({page})=>{
  const {line}=await fixture(page,{width:390,ai:usage({warn:['openai_balance']})});
  await expect(line).toBeVisible();
  await expect(line.locator('[data-aiu-toggle]')).not.toHaveAttribute('data-warn','');
  await expect(line.locator('.aiu-title')).toHaveText('AI 비용 · 10월 1일~6일 (이번 달, 추정)');
});
test('월 상한 80%는 노란 줄, 펼치면 기간·요약이 맨 위',async({page})=>{
  const {line}=await fixture(page,{width:390,ai:usage({warn:['openai_balance','openai_limit'],openai:{...usage().openai,assist_krw:12500}})});
  const head=line.locator('[data-aiu-toggle]');
  await expect(head).toHaveAttribute('data-warn','');
  await expect(head).toHaveText(/WORK ON\+ AI 이번 달 상한 80% 넘음 \(12,500원 \/ 15,000원\)/);
  await expect(head).not.toContainText('외 1건');
  await head.click();
  await expect(line.locator('.aiu-head-line')).toContainText('AI 비용 · 10월 1일~6일 (이번 달, 추정)');
  expect(await noSideScroll(page)).toBe(true);
});
test('Gemini 한도 도달 예상이 가장 먼저 노란 줄',async({page})=>{
  const ai=usage({warn:['gemini_cap','openai_limit'],forecast:{openai:{month_end_krw:2030,suggest_reload_krw:10000},gemini:{month_end_krw:9000,cap_day:'2026-10-24',suggest_cap_krw:12000,raise_cap:true}}});
  const {line}=await fixture(page,{width:390,ai,entries:[{provider:'gemini',kind:'cap',amount_krw:5000}]});
  const head=line.locator('[data-aiu-toggle]');
  await expect(head).toHaveText(/이 속도면 10월 24일에 Gemini 한도 — 회의·통화 전사가 멈춰요 외 1건/);
  await head.click();
  await expect(line.locator('[data-aiu-prov="gemini"] .aiu-bar')).toBeVisible();
  await expect(line.locator('[data-aiu-prov="gemini"] .aiu-sub')).toContainText('10월 24일 한도');
});

// HOME-업무일지홈: 홈(업무일지)에는 AI 사용량 줄이 없고, 내 프로필 '수집·사용량' 칸에만 있다(홈 ⋯·홈 편집은 없앴다).
for(const width of [390,880,1440])test(`AI 비용은 내 프로필에만, 홈에는 없음 (${width})`,async({page})=>{
  const {line}=await fixture(page,{width});
  await expect(line).toBeVisible();
  await expect(page.locator('#profileView [data-ps-page="status"] .sl-page-title')).toHaveText('사용 현황');
  await page.evaluate(()=>window.KPTURouter.go('home'));
  await expect(page.locator('#homeView')).toBeVisible();
  await expect(page.locator('#homeView [data-aiu-toggle],#homeView .home-ai-usage,[data-he-more]')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
