import { appOrigin } from './helpers/test-origin.mjs';
import {test,expect} from '@playwright/test';

// 원장 재료 C-4: 내 프로필의 '참고 일정' 칸. 캘린더 하나 고르기 → 색(5개까지) → 내가 만든 일정. 바로 서버에 저장하고 한 번 맞춰 본다.
const url=`${appOrigin}/tests/app-e2e/profile-workplaces-fixture.html`;
async function open(page){
  await page.goto(url);
  await page.click('#userBadge');
  await expect(page.locator('#psCalRefPanel [data-ps-calref-calendar]')).toBeVisible();
}
const state=page=>page.evaluate(()=>window.__state);
const writes=page=>page.evaluate(()=>window.__state.calls.filter(c=>c.method!=='GET').map(c=>`${c.method} ${c.path.split('?')[0]}`));

test('처음에는 고르지 않음 상태이고 색·체크 줄이 없다, 폰에서도 가로로 넘치지 않는다',async({page})=>{
  await page.setViewportSize({width:390,height:800});
  await open(page);
  const panel=page.locator('#psCalRefPanel');
  await expect(panel.locator('h3')).toHaveText('참고 일정');
  await expect(panel.locator('[data-ps-calref-calendar]')).toHaveValue('');
  await expect(panel.locator('[data-ps-calref-color]')).toHaveCount(0);
  await expect(panel.locator('p,button.primary')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  expect((await state(page)).refs.length).toBe(0);
  expect(await writes(page)).toEqual([]);
});

test('캘린더를 고르면 서버에 저장하고, 업무·애매는 표에 넣고 개인은 넣지 않는다',async({page})=>{
  await open(page);
  await page.selectOption('[data-ps-calref-calendar]','cal-a');
  await expect(page.locator('[data-ps-calref-state]')).toContainText('참고 2개');
  await expect(page.locator('[data-ps-calref-state]')).toContainText('개인 1개 뺌');
  const s=await state(page);
  expect(s.profile[0].ledger_calendar).toEqual({calendar:'cal-a',colors:[],mine:true});
  expect(s.refs.map(r=>r.judged).sort()).toEqual(['unsure','work']);
  expect(s.refs.find(r=>r.judged==='unsure').included).toBe(false);
  expect(JSON.stringify(s.refs)).not.toContain('cal-a');
  expect(JSON.stringify(s.refs)).not.toContain('병원');
  await expect(page.locator('[data-ps-calref-color]')).toHaveCount(11);
  await expect(page.locator('[data-ps-calref-mine]')).toBeChecked();
});

test('색은 켜고 끌 수 있고 다섯 개를 넘기면 거절한다',async({page})=>{
  await open(page);
  await page.selectOption('[data-ps-calref-calendar]','cal-a');
  await expect(page.locator('[data-ps-calref-color]').first()).toBeEnabled();
  for(const id of ['1','2','3','4','5']){await page.click(`[data-ps-calref-color="${id}"]`);await expect(page.locator(`[data-ps-calref-color="${id}"]`)).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-ps-calref-color="1"]')).toBeEnabled()}
  await page.click('[data-ps-calref-color="6"]');
  await expect(page.locator('[data-ps-calref-state]')).toContainText('5개까지');
  expect((await state(page)).profile[0].ledger_calendar.colors).toEqual(['1','2','3','4','5']);
  await page.click('[data-ps-calref-color="2"]');
  await expect(page.locator('[data-ps-calref-color="2"]')).toHaveAttribute('aria-pressed','false');
  expect((await state(page)).profile[0].ledger_calendar.colors).toEqual(['1','3','4','5']);
});

test('비울 때 확인하고, 취소하면 그대로, 확인하면 표를 먼저 지운 뒤 고르기를 비운다',async({page})=>{
  await open(page);
  await page.selectOption('[data-ps-calref-calendar]','cal-a');
  await expect(page.locator('[data-ps-calref-state]')).toContainText('참고');
  let accept=false;const messages=[];
  page.on('dialog',async d=>{messages.push(d.message());if(accept)await d.accept();else await d.dismiss()});
  await page.evaluate(()=>window.__state.calls.length=0);
  await page.selectOption('[data-ps-calref-calendar]','');
  await expect(page.locator('[data-ps-calref-calendar]')).toHaveValue('cal-a');
  expect(messages.length).toBe(1);
  expect((await state(page)).refs.length).toBe(2);
  accept=true;
  await page.selectOption('[data-ps-calref-calendar]','');
  await expect(page.locator('[data-ps-calref-state]')).toHaveText('비웠어요');
  const s=await state(page);
  expect(s.refs).toEqual([]);
  expect(s.profile[0].ledger_calendar).toEqual({});
  const w=await writes(page);
  expect(w.indexOf('DELETE /rest/v1/app_calendar_work_refs')).toBeGreaterThanOrEqual(0);
  expect(w.indexOf('DELETE /rest/v1/app_calendar_work_refs')).toBeLessThan(w.indexOf('PATCH /rest/v1/app_profiles'));
});

test('서버(Edge)가 옛 판이라 다른 캘린더 일정이 오면 그것은 쓰지 않고 한 줄로 알린다',async({page})=>{
  await open(page);
  await page.evaluate(()=>{window.__state.calendarEvents=[{id:'x1',title:'가상 교섭 준비',calendarId:'cal-b',start:new Date().toISOString(),end:new Date().toISOString(),allDay:false,colorId:'3'}]});
  await page.selectOption('[data-ps-calref-calendar]','cal-a');
  await expect(page.locator('[data-ps-calref-state]')).toContainText('서버 갱신 전');
  expect((await state(page)).refs).toEqual([]);
});
