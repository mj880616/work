import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// AI-사용량줄 정리(10/28 요청함): 홈 'AI 사용량' 줄은 기간을 맨 위에, 월말 예상을 요약에, 충전·청구 입력과 잔액 줄은 없음.
// drive-summary GET ?action=status만 가짜로 답한다(진짜 서버 호출 없음). 시계: 2026-10-06 10:00 서울(openHome).
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const usage=(over={})=>({ok:true,month:'2026-10',warn:[],
  openai:{krw:393,estimate_krw:393,ratio:null,actual:false,assist_krw:156,telegram_krw:237,call_krw:0,limit_assist_krw:15000,limit_feed_krw:6000,balance:{topup_krw:30000,topup_on:'2026-10-04',left_krw:9000},last_bill:{month:'2026-09',krw:7000}},
  gemini:{krw:0,estimate_krw:0,ratio:null,actual:false,transcript_krw:0,analysis_krw:0,calls:0,unknown_models:[],balance:null,last_bill:null},
  entries:[{id:'00000000-0000-4000-8000-000000000001',provider:'openai',kind:'topup',amount_krw:30000,month:null,created_at:'2026-10-04T03:00:00Z'}],...over});
const status=ai=>({ok:true,checked_at:'2026-10-06T01:00:00.000Z',copy:{state:'found',last_success_at:'2026-10-05T21:17:00.000Z',last_failure_at:null,last_failure_code:null},ai_usage:ai});

async function fixture(page,{width,ai=usage()}){
  await page.setViewportSize({width,height:900});
  await openHome(page);
  const writes=[];
  await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/drive-summary',route=>{
    const req=route.request();
    if(req.method()==='OPTIONS')return route.fulfill({status:204});
    if(req.method()!=='GET')writes.push(req.method());
    return route.fulfill({json:status(ai)});
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_ai_cost_entries',route=>{writes.push(route.request().method());return route.fulfill({json:[]});});
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_todo_radar_state',route=>route.fulfill({json:[{last_success_at:'2026-10-06T00:30:00Z'}]}));
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  await expect(page.locator('#homeView')).toBeVisible();
  return {writes,line:page.locator('[data-home-ai-usage]')};
}

for(const width of [412,884,1440])test(`기간이 맨 위, 월말 예상, 입력·잔액 없음 (${width})`,async({page})=>{
  const {line,writes}=await fixture(page,{width});
  await expect(line).toBeVisible();
  const head=line.locator('[data-aiu-toggle]');
  await expect(head.locator('.aiu-title')).toHaveText('AI 사용량 · 10월 1일~6일 (이번 달, 추정)');
  await expect(head.locator('.aiu-sum')).toHaveText('OpenAI 393원 · Gemini 0원 · 이 속도면 월말 약 2,030원');
  await expect(head).toHaveAttribute('aria-expanded','false');
  await head.click();
  await expect(head).toHaveAttribute('aria-expanded','true');
  const panel=line.locator('.aiu-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.aiu-row')).toHaveCount(3);
  await expect(panel.locator('.aiu-row').nth(0)).toContainText('Web2 AI 기능');
  await expect(panel.locator('.aiu-row').nth(0).locator('.aiu-value')).toHaveText('156원 / 한 달 상한 15,000원');
  await expect(panel.locator('.aiu-row').nth(1).locator('.aiu-value')).toHaveText('237원 / 한 달 상한 6,000원');
  await expect(panel.locator('.aiu-row').nth(2)).toContainText('전사·분석(Gemini)');
  await expect(panel.locator('.aiu-row').nth(2).locator('.aiu-value')).toHaveText('0원');
  // 추정은 맨 위 한 곳만, 잔액·충전·청구·설명 문장·입력 없음
  expect(await line.evaluate(el=>(el.textContent.match(/추정/g)||[]).length)).toBe(1);
  await expect(line).not.toContainText(/잔액|충전|청구|돌려받은/);
  // 줄 자기 버튼은 펼치기 하나(폰·중간 폭은 제목 줄 끝에 홈 ⋯가 따로 들어온다, UI-점검1030손질 C6).
  await expect(line.locator('button:not([data-he-more])')).toHaveCount(1);
  await expect(line.locator('input,select,form,details')).toHaveCount(0);
  // 한 줄 높이가 커지지 않음(제목+요약 두 줄), 가로 넘침 없음
  expect((await head.boundingBox()).height).toBeLessThanOrEqual(48);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await head.click();
  await expect(panel).toBeHidden();
  expect(writes).toEqual([]);
});

test('잔액 경고 코드가 와도 노란 줄이 되지 않음',async({page})=>{
  const {line}=await fixture(page,{width:412,ai:usage({warn:['openai_balance']})});
  await expect(line).toBeVisible();
  await expect(line.locator('[data-aiu-toggle]')).not.toHaveAttribute('data-warn','');
  await expect(line.locator('.aiu-title')).toHaveText('AI 사용량 · 10월 1일~6일 (이번 달, 추정)');
});
test('월 상한 80%는 노란 줄, 펼치면 기간·요약이 맨 위',async({page})=>{
  const {line}=await fixture(page,{width:412,ai:usage({warn:['openai_balance','openai_limit'],openai:{...usage().openai,assist_krw:12500}})});
  const head=line.locator('[data-aiu-toggle]');
  await expect(head).toHaveAttribute('data-warn','');
  await expect(head).toHaveText(/Web2 AI 이번 달 상한 80% 넘음 \(12,500원 \/ 15,000원\)/);
  await expect(head).not.toContainText('외 1건');
  await head.click();
  await expect(line.locator('.aiu-head-line')).toContainText('AI 사용량 · 10월 1일~6일 (이번 달, 추정)');
  await expect(line.locator('input,form')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

// UI-점검1030손질 C6(UI-더보기제목줄): 폰·중간 폭에서 홈 ⋯는 홈 끝에 혼자 한 줄로 뜨지 않고 'AI 사용량' 제목 줄 오른쪽 끝에 같은 줄로 놓인다.
// PC(1024px~)는 지금 자리 그대로. 홈 편집을 열었다 닫아도 같은 자리로 돌아온다.
for(const width of [412,884,1440])test(`홈 ⋯는 AI 사용량 제목 줄 오른쪽 끝 (${width})`,async({page})=>{
  const {line}=await fixture(page,{width});
  await expect(line).toBeVisible();
  const more=page.locator('[data-he-more]');await expect(more).toBeVisible();
  const docked=line.locator('[data-aiu-top] [data-he-more]');
  if(width>=1024){await expect(docked).toHaveCount(0);return;}
  await expect(docked).toHaveCount(1);
  const place=async()=>{const m=await more.boundingBox(),t=await line.locator('[data-aiu-toggle]').boundingBox(),title=await line.locator('.aiu-title').boundingBox(),l=await line.boundingBox();return {m,t,title,l};};
  let {m,t,title,l}=await place();
  // 같은 줄: ⋯의 가운데가 제목 글자 줄 안, 오른쪽 끝(줄 오른쪽 안), 펼치기 버튼과 겹치지 않음.
  expect(m.y+m.height/2).toBeGreaterThanOrEqual(title.y-2);expect(m.y+m.height/2).toBeLessThanOrEqual(title.y+title.height+2);
  expect(m.x+m.width).toBeLessThanOrEqual(l.x+l.width+1);expect(m.x).toBeGreaterThanOrEqual(t.x+t.width-1);
  expect(m.height).toBeLessThanOrEqual(28.5);
  // 홈 편집을 열고 닫으면 ⋯는 다시 같은 자리.
  await more.click();await page.locator('[data-he-start]').click();
  await expect(page.locator('[data-he-done]')).toBeVisible();
  await page.locator('[data-he-done]').click();
  await expect(line.locator('[data-aiu-top] [data-he-more]')).toHaveCount(1);
  await expect(page.locator('[data-he-more]')).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
