import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// AI-사람별한도(S61-35): 내 프로필 '수집·사용량' 칸의 '이번 달 AI 사용 ○원 / 한도 ○원' 한 줄.
// openHome 뒤에 ai-assist kind=ai_month만 가짜로 답한다(나중에 단 길이 먼저)(진짜 서버 호출 없음). 화면은 작업공간을 보내지 않는다. 운영자(exempt)는 줄이 없다.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const SHOT=process.env.S61_35_SHOTS||'';
const month=(over={})=>({ok:true,kind:'ai_month',month:'2026-10',used_krw:1240,cap_krw:3000,exempt:false,capped:false,...over});

async function fixture(page,{width,reply=month()}){
  await page.setViewportSize({width,height:900});
  await openHome(page,{query:'?view=profile'});
  const sent=[];
  await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/ai-assist',route=>{
    const req=route.request();
    if(req.method()==='OPTIONS')return route.fulfill({status:204});
    const body=JSON.parse(req.postData()||'{}');
    if(body.kind!=='ai_month')return route.fallback();
    sent.push(body);
    return typeof reply==='number'?route.fulfill({status:reply,json:{ok:false,error:'usage_unavailable'}}):route.fulfill({json:reply});
  });
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  await expect(page.locator('#profileView')).toBeVisible();
  return {sent,line:page.locator('#psStatusPanel [data-ps-ai-cap]')};
}

for(const width of [412,1280])test(`내 이번 달 AI 사용 한 줄 (${width})`,async({page})=>{
  const {line,sent}=await fixture(page,{width});
  await expect(line).toHaveText('이번 달 AI 사용 1,240원 / 한도 3,000원');
  await expect(line).not.toHaveAttribute('data-capped','');
  expect(sent.every(b=>JSON.stringify(b)==='{"kind":"ai_month"}')).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(SHOT){await line.scrollIntoViewIfNeeded();await page.locator('#psStatusPanel').screenshot({path:`${SHOT}/profile-ai-line-${width}.png`});}
});

for(const width of [412,1280])test(`한도를 다 쓰면 다음 달 1일 안내 한 줄 (${width})`,async({page})=>{
  const {line}=await fixture(page,{width,reply:month({used_krw:3010,capped:true})});
  await expect(line).toHaveText('이번 달 AI 사용 한도(3,000원)를 다 썼어요. 다음 달 1일에 다시 쓸 수 있어요.');
  await expect(line).toHaveAttribute('data-capped','');
  if(SHOT){await line.scrollIntoViewIfNeeded();await page.locator('#psStatusPanel').screenshot({path:`${SHOT}/profile-ai-capped-${width}.png`});}
});

test('운영자(한도 제외)·읽기 실패면 줄이 없다',async({page})=>{
  const {line}=await fixture(page,{width:412,reply:month({exempt:true})});
  await page.waitForTimeout(300);
  await expect(line).toBeHidden();
});
test('읽기 실패면 줄이 없다',async({page})=>{
  const {line}=await fixture(page,{width:412,reply:503});
  await page.waitForTimeout(300);
  await expect(line).toBeHidden();
});
