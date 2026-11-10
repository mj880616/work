// S56-36 MTG-회의목록조직묶기(요청함 11/10 17:22): 사업 보고 회의 [목록] 왼쪽 회의명 칸도 회의명 고르기 창(#2271)과 같은 조직 머리글로 묶는다.
// 조직 목록 = 내 프로필 meeting_name_sorts, 묶는 함수 = meeting-name-sorts.mjs orgSections 하나(고르기 창과 같은 orgOf·같은 순서, 기타 맨 아래).
// 덧붙임(같은 화면): PC 1280 가운데 차수 칸이 '4.. 11...'로 잘리던 폭, 오른쪽 결과가 글 폭만큼 줄어 가운데에 몰리던 문제.
// 서버는 가짜, 이름은 모두 지어낸 값. 시계 2026-11-10(화) 10:00(서울).
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {installBusinessNowServer} from './helpers/business-now-server.mjs';

test.use({timezoneId:'Asia/Seoul'});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',NOW='2026-11-10T01:00:00Z';
const key=s=>s.replace(/\s+/g,'').toLowerCase();
const G1='gaaaaaa1',G2='gaaaaaa2',G3='gaaaaaa3';
const LINES=Array.from({length:30},(_,i)=>`합성 결과 줄 ${i+1}`).join('\n');
const SORTS={parents:[{id:G1,name:'가상본부'},{id:G2,name:'가상노조'},{id:G3,name:'가상협의회'}],
  orgs:{[key('가상노조 상집')]:G2,[key('가상본부 집행위')]:G1,[key('가상 집행국 회의')]:G3,[key('가상협의회 대표자 회의')]:G3}};

function state(sorts){
  const s=baseState();
  const row=(id,title,round,at,text='합성 결과 글')=>({id,workspace_id:s.workspace.id,title,series_name:title,round_no:round,meeting_at:at,transcript_text:text,activity_kind:'meeting',business_area_id:'child-a1',next_plan:'',created_by:s.user.id,created_at:at,updated_at:at,notes:'',decisions:''});
  s.meetings=[row('m1','가상노조 상집',46,'2026-11-10T00:00:00Z',LINES),row('m2','가상노조 상집',45,'2026-11-09T00:00:00Z'),row('m3','가상본부 집행위',9,'2026-11-09T05:00:00Z'),
    row('m4','가상 집행국 회의',6,'2026-11-09T03:00:00Z'),row('m5','가상협의회 대표자 회의',8,'2026-11-09T07:00:00Z'),row('m6','따로 모임',null,'2026-11-09T09:00:00Z')];
  if(sorts!==undefined)s.meetingNameSorts=sorts;
  return s;
}
async function open(page,s,{width=1280,height=900}={}){
  await page.setViewportSize({width,height});
  await page.clock.setFixedTime(new Date(NOW));
  await mockApp(page,s);
  await page.route(`${SB}/rest/v1/app_weekly_exec_requests**`,route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await installBusinessNowServer(page,{});
  await signIn(page,testOrigin+'/app/?view=reports');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
}
// 왼쪽 칸 차례: 머리글은 '# 이름', 회의명 줄은 '이름 건수'.
const kindsOrder=page=>page.locator('#meetingList .mcol-kinds li').evaluateAll(list=>list.map(li=>li.classList.contains('mcol-org')?`# ${li.textContent.trim()}`:`${li.querySelector('.mcol-name')?.textContent} ${li.querySelector('.mcol-count')?.textContent}`));
const WANT=['# 가상본부','가상본부 집행위 1','# 가상노조','가상노조 상집 2','# 가상협의회','가상협의회 대표자 회의 1','가상 집행국 회의 1','# 기타','따로 모임 1'];

test('PC 1280: 회의 [목록] 왼쪽 회의명이 조직 머리글 아래로 묶이고(조직 순서·기타 맨 아래), 조직 목록을 고치면 바로 따라간다',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=state(SORTS);await open(page,s);
  await expect.poll(()=>kindsOrder(page)).toEqual(WANT);
  // 머리글은 고를 수 없는 작은 글씨 한 줄, 회의명 줄의 색 점·건수는 그대로.
  const head=page.locator('#meetingList .mcol-kinds .mcol-org').first();
  expect(await head.locator('button').count()).toBe(0);
  expect(await head.evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeLessThan(await page.locator('#meetingList .mcol-kind').first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize)));
  await expect(page.locator('#meetingList .mcol-kind .mcol-dot')).toHaveCount(5);
  // 처음 고른 종류는 그대로 가장 최근 결과(가상노조 상집 46차).
  await expect(page.locator('#meetingList .mcol-kind[aria-current="true"] .mcol-name')).toHaveText('가상노조 상집');
  // 화살표는 머리글을 건너뛰고 회의명 줄만 오간다.
  await page.locator('#meetingList [data-meeting-kind]').first().focus();await page.keyboard.press('ArrowDown');
  await expect(page.locator('#meetingList [data-meeting-kind]:focus .mcol-name')).toHaveText('가상노조 상집');
  // 조직 목록 순서를 바꾸면(고르기 창 '조직 목록'과 같은 저장) 목록도 바로 따라간다.
  await page.evaluate(async()=>{const m=await import('/app/meeting-name-sorts.js');const r=await m.changeSorts(s=>({...s,parents:[s.parents[2],s.parents[0],s.parents[1]]}));if(!r.ok)throw new Error(r.reason)});
  await expect.poll(()=>kindsOrder(page)).toEqual(['# 가상협의회','가상협의회 대표자 회의 1','가상 집행국 회의 1','# 가상본부','가상본부 집행위 1','# 가상노조','가상노조 상집 2','# 기타','따로 모임 1']);
  expect(errors).toEqual([]);
});

test('PC 1280: 가운데 차수 칸은 "46차 11.10."이 한 줄로 다 보이고, 오른쪽 결과는 남은 폭을 다 쓴다',async({page})=>{
  await open(page,state(SORTS));
  await page.locator('#meetingList [data-meeting-round="m1"]').click();
  const card=page.locator('#meetingList [data-meeting-round="m1"]');
  await expect(card).toContainText('46차');
  const cut=await card.evaluate(b=>[...b.querySelectorAll('.mcol-round,.mcol-date')].map(e=>({t:e.textContent,over:e.scrollWidth-e.clientWidth})));
  expect(cut).toEqual([{t:'46차',over:0},{t:'11.10',over:0}]);
  const pane=page.locator('#meetingList .mcol-result');
  await expect(pane.locator('#meetingRoundDetailModal.mrd-docked')).toBeVisible();
  // 결과 카드가 글 폭만큼 줄어 가운데로 몰리지 않는다(칸 폭과 같음).
  const w=await pane.evaluate(e=>({pane:e.clientWidth,card:e.querySelector('.modal-card').getBoundingClientRect().width}));
  expect(Math.abs(w.pane-w.card)).toBeLessThanOrEqual(2);
});

test('PC 1280: 조직을 붙인 회의가 없는 옛 정리·정리를 못 읽으면 지금처럼 묶음 없이 보인다',async({page})=>{
  await open(page,state({parents:[{id:G1,name:'가상본부'}]}));
  await expect(page.locator('#meetingList .mcol-kind')).toHaveCount(5);
  await expect(page.locator('#meetingList .mcol-org')).toHaveCount(0);
});

test('폰 412: [회의 ▾] 상자의 회의명도 같은 조직 머리글 묶음(조직 순서·기타 맨 아래)',async({page})=>{
  await open(page,state(SORTS),{width:412,height:915});
  const groups=()=>page.locator('#reportKindSelect optgroup').evaluateAll(list=>list.map(g=>[g.label,...[...g.querySelectorAll('option')].map(o=>o.textContent)]));
  await expect.poll(groups).toEqual([['가상본부','가상본부 집행위'],['가상노조','가상노조 상집'],['가상협의회','가상 집행국 회의','가상협의회 대표자 회의'],['기타','따로 모임','회의명 미지정']]);
});
