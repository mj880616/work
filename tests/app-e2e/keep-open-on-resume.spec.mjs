// S71-20 A1(결정 장부 docs/design/standard-interactions.md 13절): 다른 앱에 갔다 와도 열어 둔 입력 창·쓰던 글·창 안 스크롤이 그대로다.
// 명진 11/26 17:20 "사업보고 입력 화면 띄워놓고 다른 앱 갔다 오면 화면이 닫혀있네 유지됐으면. 마찬가지로 나머지 화면도".
// 다른 앱으로 갔다 오면 웹 화면이 받는 것: 화면 숨김(visibilitychange hidden·blur·pagehide) → 화면 보임(visibilitychange visible·pageshow·focus).
// 폰 앱(안드로이드 WebView)·폰 브라우저 모두 같은 사건이다. 이 사건들 뒤 돌아올 때 하는 새로 읽기(달력·할 일·사업 기록·새 판 확인 등)가
// 창을 닫거나 글을 지우거나 화면을 통째로 다시 열면(새 문서) 안 된다. 상단 [+ 추가]의 여섯 입력 창 모두(같은 열기 길) 폰 390에서 본다.
// 안드로이드가 뒤에 있던 앱·화면 엔진을 메모리 때문에 끈 경우(새 문서로 다시 열림)는 웹 사건이 아니라 이 시험 밖이다 — 설계 docs/design/input-resume.md.
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';

// 다른 앱으로 갔다(hidden) 돌아온다(visible). 브라우저가 실제로 보내는 차례대로.
async function leaveAndReturn(page){
  const step=state=>page.evaluate(state=>{
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>state});
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>state==='hidden'});
    if(state==='hidden'){window.dispatchEvent(new Event('blur'));document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));}
    else{window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:false}));document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));}
  },state);
  await step('hidden');await page.waitForTimeout(300);await step('visible');
  // 돌아온 뒤 새로 읽기(250ms 뒤 달력 상태·사업 기록 다시 읽기·새 판 확인 등)가 끝날 때까지 둔다.
  await page.waitForTimeout(1500);
}

// [+ 추가] 목록 종류 → 열리는 창, 글 칸.
const WINDOWS=[
  {kind:'report',name:'사업 보고',box:'#meetingModal',field:'#meetingTranscript'},
  {kind:'update',name:'잊지 말기(업데이트)',box:'#edWindow',field:'#edWindow .ed-window-body .ProseMirror'},
  {kind:'note',name:'노트',box:'#edWindow',field:'#edwNoteTitle'},
  {kind:'task',name:'할 일',box:'#eventModal',field:'#eventTitle'},
  {kind:'event',name:'일정',box:'#eventModal',field:'#eventTitle'},
  {kind:'diary',name:'하루 기록',box:'#diaryView',field:'#diaryView .ProseMirror'},
];
const valueOf=locator=>locator.evaluate(el=>'value' in el&&el.tagName!=='DIV'?el.value:el.textContent);

for(const w of WINDOWS)test(`A1 폰 390 ${w.name}: 쓰던 중 다른 앱에 갔다 와도 창·글 그대로, 화면을 새로 열지 않음`,async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await openHome(page);
  // 폰에는 상단 줄이 보이지 않는다. 폰 앱 위젯 쓰기 칸과 같은 [+ 추가] 열기 길을 쓴다(눌러 연 창과 같은 창).
  await page.locator('#appView>.app-topline [data-quick-add]').evaluate(b=>b.click());
  await page.locator(`#toplineAddMenu [data-topline-add="${w.kind}"]`).evaluate(b=>b.click());
  if(w.kind==='report'){const sheet=page.locator('#reportKindSheet');await expect(sheet).toBeVisible();await sheet.locator('[data-sheet-value="meeting"]').click();}
  const box=page.locator(w.box),field=page.locator(w.field).first();
  await expect(box).toBeVisible();await expect(field).toBeVisible();
  await field.click();await page.keyboard.type('쓰던 글 S71-20');
  await expect.poll(()=>valueOf(field)).toContain('쓰던 글 S71-20');
  // 같은 칸이 그대로 붙어 있는지(다시 그려 바뀐 칸이 아닌지) 표시해 둔다.
  await field.evaluate(el=>{el.dataset.a1Mark='1'});
  let navigations=0;page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++});
  const view=await page.evaluate(()=>window.KPTURouter.current),url=page.url();
  await leaveAndReturn(page);
  expect(navigations,'다른 앱에 갔다 와도 화면을 새로 열지 않는다').toBe(0);
  await expect(box).toBeVisible();
  await expect(page.locator(`${w.field}[data-a1-mark="1"]`).first()).toBeVisible();
  expect(await valueOf(field)).toContain('쓰던 글 S71-20');
  expect(await page.evaluate(()=>window.KPTURouter.current)).toBe(view);
  expect(page.url()).toBe(url);
  // 두 번 갔다 와도 같다.
  await leaveAndReturn(page);
  await expect(page.locator(`${w.field}[data-a1-mark="1"]`).first()).toBeVisible();
  expect(await valueOf(field)).toContain('쓰던 글 S71-20');
  expect(errors).toEqual([]);
});

test('A1 폰 390 사업 보고: 창 안에서 내려 본 자리도 그대로',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await openHome(page);
  await page.locator('#appView>.app-topline [data-quick-add]').evaluate(b=>b.click());
  await page.locator('#toplineAddMenu [data-topline-add="report"]').evaluate(b=>b.click());
  const sheet=page.locator('#reportKindSheet');await expect(sheet).toBeVisible();await sheet.locator('[data-sheet-value="meeting"]').click();
  const modal=page.locator('#meetingModal');await expect(modal).toBeVisible();
  await page.locator('#meetingTranscript').fill('합성 결과 원문');
  // 창 안에서 스크롤되는 칸(창 자신 또는 카드)을 끝까지 내린다.
  const place=()=>page.evaluate(()=>{const m=document.querySelector('#meetingModal');const els=[m,...m.querySelectorAll('*')].filter(el=>el.scrollHeight>el.clientHeight+20&&['auto','scroll'].includes(getComputedStyle(el).overflowY));return els.map(el=>el.scrollTop)});
  await page.evaluate(()=>{const m=document.querySelector('#meetingModal');for(const el of [m,...m.querySelectorAll('*')])if(el.scrollHeight>el.clientHeight+20&&['auto','scroll'].includes(getComputedStyle(el).overflowY))el.scrollTop=el.scrollHeight});
  const before=await place();
  expect(before.some(top=>top>0),'창 안에 내려 볼 칸이 있다').toBe(true);
  await leaveAndReturn(page);
  await expect(modal).toBeVisible();
  expect(await place()).toEqual(before);
  await expect(page.locator('#meetingTranscript')).toHaveValue('합성 결과 원문');
});
