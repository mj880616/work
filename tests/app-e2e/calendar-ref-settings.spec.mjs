import { appOrigin } from './helpers/test-origin.mjs';
import {test,expect} from '@playwright/test';

// CAL-조직참고캘린더(요청함 10/30 16:03): 내 프로필의 '조직 참고 캘린더' 한 줄 — [조직 고르기 ▾] 참고 캘린더 [캘린더 고르기 ▾].
// 내 담당조직에서 하나, 구독한 캘린더에서 하나. 바꾸면 바로 서버(내 프로필 칸)에 저장하고, 일정은 읽지도 저장하지도 않는다.
// 예전 '내 일정 색'·'내가 만든 일정도 포함'은 없다. 가상 조직·캘린더만 쓴다.
const url=`${appOrigin}/tests/app-e2e/profile-workplaces-fixture.html`;
const ORG='30000000-0000-4000-8000-0000000000aa';
async function open(page,{saved}={}){
  await page.goto(url);
  await page.evaluate(({ORG,saved})=>{
    const s=window.__state;
    s.organizations.push({id:ORG,name:'가상 조직노조',aliases:[],active:true});
    s.assignments.push({organization_id:ORG,user_id:'u1',assigned_by:'admin',created_at:'2026-09-01T00:00:00Z'});
    if(saved)s.profile[0].ledger_calendar=saved;
  },{ORG,saved});
  await page.click('#userBadge');
  await expect(page.locator('#psCalRefPanel [data-ps-calref-calendar]')).toBeVisible();
}
const state=page=>page.evaluate(()=>window.__state);
const writes=page=>page.evaluate(()=>window.__state.calls.filter(c=>c.method!=='GET').map(c=>`${c.method} ${c.path.split('?')[0]}`));

for(const width of [390,1280])test(`한 줄: 조직 고르기(내 담당조직만) + 참고 캘린더 고르기, 색·체크 칸 없음, 넘치지 않음 ${width}`,async({page})=>{
  await page.setViewportSize({width,height:800});
  await open(page);
  const panel=page.locator('#psCalRefPanel');
  await expect(panel.locator('h3')).toHaveText('조직 참고 캘린더');
  await expect(panel.locator('.ps-calref-row')).toHaveCount(1);
  await expect(panel.locator('.ps-calref-row')).toContainText('참고 캘린더');
  await expect(panel.locator('[data-ps-calref-org]')).toHaveValue('');
  await expect(panel.locator('[data-ps-calref-calendar]')).toHaveValue('');
  // 담당조직 규칙: 담당으로 지정된 조직만(다른 조직·비활성 조직 없음).
  await expect(panel.locator('[data-ps-calref-org] option').first()).toHaveText('조직 고르기');
  expect((await panel.locator('[data-ps-calref-org] option').allTextContents()).slice(1).sort()).toEqual(['가상 조직노조','철도노조'].sort());
  await expect(panel.locator('[data-ps-calref-calendar] option')).toHaveText(['캘린더 고르기','가상 공유 캘린더','다른 캘린더']);
  await expect(panel.locator('[data-ps-calref-color],[data-ps-calref-mine],input[type=checkbox]')).toHaveCount(0);
  await expect(panel).not.toContainText('내 일정 색');
  await expect(panel).not.toContainText('내가 만든 일정');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  expect(await writes(page)).toEqual([]);
});

test('고르면 바로 프로필 칸에만 저장하고, 일정은 읽거나 저장하지 않는다',async({page})=>{
  await open(page);
  await page.selectOption('[data-ps-calref-calendar]','cal-a');
  await expect(page.locator('[data-ps-calref-state]')).toContainText('둘 다 고르면');
  expect((await state(page)).profile[0].ledger_calendar).toEqual({calendar:'cal-a'});
  await page.selectOption('[data-ps-calref-org]',ORG);
  await expect(page.locator('[data-ps-calref-state]')).toContainText('그 조직 칸에 추천');
  const s=await state(page);
  expect(s.profile[0].ledger_calendar).toEqual({calendar:'cal-a',org:ORG});
  expect(await writes(page)).toEqual(['PATCH /rest/v1/app_profiles','PATCH /rest/v1/app_profiles']);
  expect(s.calls.some(c=>c.path.includes('action=events')||c.path.includes('app_calendar_work_refs'))).toBe(false);
  expect(s.refs).toEqual([]);
});

test('예전 값(색·내 일정)이 있어도 읽어 보이고, 캘린더를 바꾸거나 비워도 쌓인 참고 일정은 지우지 않는다',async({page})=>{
  await open(page,{saved:{calendar:'cal-a',colors:['3'],mine:true}});
  await page.evaluate(()=>{window.__state.refs.push({id:'old-1',day:'2026-10-01',title:'예전 참고 줄'})});
  await expect(page.locator('[data-ps-calref-calendar]')).toHaveValue('cal-a');
  const messages=[];page.on('dialog',async d=>{messages.push(d.message());await d.dismiss()});
  await page.selectOption('[data-ps-calref-calendar]','cal-b');
  await expect(page.locator('[data-ps-calref-state]')).toContainText('저장했어요');
  await page.selectOption('[data-ps-calref-calendar]','');
  await expect(page.locator('[data-ps-calref-state]')).toHaveText('비웠어요');
  const s=await state(page);
  expect(s.profile[0].ledger_calendar).toEqual({});
  expect(s.refs).toHaveLength(1);
  expect(messages).toEqual([]);
  expect((await writes(page)).filter(w=>w.startsWith('DELETE'))).toEqual([]);
});

test('저장이 거절되면(서버 준비 전 등) 한 줄로 알리고 고른 값은 이전 그대로',async({page})=>{
  await open(page);
  await page.evaluate(()=>window.__state.fail.push({method:'PATCH',path:'/rest/v1/app_profiles'}));
  await page.selectOption('[data-ps-calref-org]','30000000-0000-4000-8000-0000000000aa');
  await expect(page.locator('[data-ps-calref-state]')).toHaveText('저장하지 못했어요. 다시 골라 주세요.');
  await expect(page.locator('[data-ps-calref-org]')).toHaveValue('');
});
