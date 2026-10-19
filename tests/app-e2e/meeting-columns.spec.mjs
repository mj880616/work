// UI-PC회의(2026-10-20 사용자 확정): PC(≥1024) 회의 결과는 회의 유형별 열, 폰은 지금 한 줄 목록 그대로.
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';

test.use({timezoneId:'Asia/Seoul'});

// 궤도협의회 6건(4건 + 더 보기 2), 노사협의회 2건(가장 최근), 안전위원회 1건(가장 오래됨), 회의명 미지정 1건.
function columnState(){
  const s=baseState();s.meetingWrites=[];
  const row=(id,name,round,at)=>({id,workspace_id:s.workspace.id,title:name,series_name:name,round_no:round,meeting_at:at,transcript_text:'원문',created_by:s.user.id});
  s.meetings=[
    ...[1,2,3,4,5,6].map(n=>row(`rail-${n}`,'궤도협의회',n,`2026-09-0${n}T01:00:00Z`)),
    row('labor-1','노사협의회',1,'2026-10-01T01:00:00Z'),row('labor-2','노사협의회',2,'2026-10-12T05:30:00Z'),
    row('safety-1','안전위원회',3,'2026-08-01T01:00:00Z'),
    row('blank-1','',null,'2026-08-20T01:00:00Z')
  ];
  s.docs.push({id:'rail-doc-1',workspace_id:s.workspace.id,project_id:null,title:'궤도 자료 1',meeting_id:'rail-6',category:'회의자료',tags:[]},{id:'rail-doc-2',workspace_id:s.workspace.id,project_id:null,title:'궤도 자료 2',meeting_id:'rail-6',category:'회의자료',tags:[]});
  return s;
}
async function open(page,s,width){
  await page.setViewportSize({width,height:900});await mockApp(page,s);
  await signIn(page,'http://127.0.0.1:8123/app/?view=meetings');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
}
const columns=page=>page.locator('#meetingList .mcol');
const names=page=>page.locator('#meetingList .mcol .mcol-name');

for(const width of [1280,1440])test(`PC ${width}: 회의 유형별 열, 최근 결과 순, 열당 4건 + 더 보기`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=columnState();await open(page,s,width);
  await expect(page.locator('#meetingList .meeting-list-row')).toHaveCount(0);
  await expect(page.locator('#meetingTypeFilter')).toBeHidden();
  await expect(names(page)).toHaveText(['노사협의회','궤도협의회','회의명 미지정','안전위원회']);
  const rail=page.locator('[data-meeting-column="궤도협의회"]');
  await expect(rail.locator('.mcol-count')).toHaveText('6');
  // 색 점은 지금 목록과 같은 회의 색.
  expect(await rail.locator('.mcol-dot').evaluate(e=>getComputedStyle(e).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  // 최신 위, 최근 4건, 차수 / 날짜·시각 / 자료 N.
  await expect(rail.locator('.mcol-card .mcol-round')).toHaveText(['6차','5차','4차','3차']);
  await expect(rail.locator('[data-mrd-meeting="rail-6"] .mcol-docs')).toHaveText('자료 2');
  await expect(rail.locator('[data-mrd-meeting="rail-5"] .mcol-docs')).toHaveCount(0);
  await expect(page.locator('[data-mrd-meeting="labor-2"] .mcol-when')).toContainText('10. 12. 오후 02:30');
  const more=rail.locator('[data-meeting-more]');await expect(more).toHaveText('더 보기 2');await expect(more).toHaveAttribute('aria-expanded','false');
  await more.click();await expect(rail.locator('.mcol-card')).toHaveCount(6);
  await expect(rail.locator('[data-meeting-more]')).toHaveText('접기');await expect(rail.locator('[data-meeting-more]')).toHaveAttribute('aria-expanded','true');await expect(rail.locator('[data-meeting-more]')).toBeFocused();
  await rail.locator('[data-meeting-more]').click();await expect(rail.locator('.mcol-card')).toHaveCount(4);
  await expect(page.locator('[data-meeting-column="노사협의회"] [data-meeting-more]')).toHaveCount(0);
  // 열마다 따로 상자, 최소 너비 240px, 줄바꿈 없이 한 줄.
  const boxes=await columns(page).evaluateAll(cols=>cols.map(c=>{const r=c.getBoundingClientRect();return {w:r.width,top:Math.round(r.top)}}));
  for(const b of boxes)expect(b.w).toBeGreaterThanOrEqual(240);
  expect(new Set(boxes.map(b=>b.top)).size).toBe(1);
  // 카드를 누르면 지금처럼 그 회의 결과 창.
  await page.locator('[data-mrd-meeting="rail-6"]').click();await expect(page.locator('#meetingRoundDetailModal')).toBeVisible();await expect(page.locator('#mrdTitle')).toContainText('궤도협의회');
  await page.locator('#mrdClose').click();await expect(page.locator('#meetingRoundDetailModal')).toBeHidden();
  // 키보드: 카드는 Enter로 연다.
  await page.locator('[data-mrd-meeting="labor-2"]').focus();await page.keyboard.press('Enter');await expect(page.locator('#meetingRoundDetailModal')).toBeVisible();await page.locator('#mrdClose').click();
  // 오른쪽 위 [+ 회의 결과] 유지, 높이는 입력칸과 같은 공용 기준(36px), 누르는 범위 44px.
  const add=page.locator('#newMeetingBtn');await expect(add).toBeVisible();
  const h=await add.evaluate(e=>({box:e.getBoundingClientRect().height,touch:parseFloat(getComputedStyle(e,'::after').height)||parseFloat(getComputedStyle(e,'::after').minHeight)}));
  expect(h.box).toBe(36);expect(h.touch).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('PC: 보일 열 고르기는 열을 숨기고 이 기기에 기억, 결과 0건 유형은 열이 없음',async({page})=>{
  const s=columnState();await open(page,s,1280);
  const picker=page.locator('#meetingColumnPicker');await expect(picker).toBeVisible();
  await expect(picker.locator('button')).toHaveText(['노사협의회','궤도협의회','회의명 미지정','안전위원회']);
  await expect(picker.locator('[aria-pressed="true"]')).toHaveCount(4);
  await picker.getByRole('button',{name:'안전위원회'}).click();
  await expect(picker.getByRole('button',{name:'안전위원회'})).toHaveAttribute('aria-pressed','false');await expect(picker.getByRole('button',{name:'안전위원회'})).toBeFocused();
  await expect(names(page)).toHaveText(['노사협의회','궤도협의회','회의명 미지정']);
  // 키보드로도 고른다.
  await picker.getByRole('button',{name:'회의명 미지정'}).focus();await page.keyboard.press('Enter');
  await expect(names(page)).toHaveText(['노사협의회','궤도협의회']);
  // 기기 저장소에는 회의명이 아니라 짧은 기호만 남는다.
  const stored=await page.evaluate(()=>Object.entries(localStorage).filter(([k])=>k.includes('meeting-columns')));
  expect(stored).toHaveLength(1);expect(stored[0][1]).not.toContain('안전위원회');
  await page.reload();await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  await expect(names(page)).toHaveText(['노사협의회','궤도협의회']);
  await expect(page.locator('#meetingColumnPicker [aria-pressed="false"]')).toHaveCount(2);
  await page.locator('#meetingColumnPicker').getByRole('button',{name:'안전위원회'}).click();await page.locator('#meetingColumnPicker').getByRole('button',{name:'회의명 미지정'}).click();
  await expect(names(page)).toHaveCount(4);
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes('meeting-columns')))).toEqual([]);
  // 결과가 하나도 없는 유형은 열·고르기 칩 모두 없다(안전위원회 결과를 지운 뒤 다시 그림).
  s.meetings=s.meetings.filter(m=>m.series_name!=='안전위원회');
  await page.evaluate(()=>window.__KPTU_RELOAD_MEETINGS__());
  await expect(names(page)).toHaveText(['노사협의회','궤도협의회','회의명 미지정']);
  await expect(page.locator('#meetingColumnPicker button')).toHaveCount(3);
});

test('PC: 저장소가 막혀 있으면 기억 없이 전부 보인다',async({page})=>{
  await page.addInitScript(()=>{const p=Storage.prototype,get=p.getItem,set=p.setItem;p.getItem=function(k){if(String(k).includes('meeting-columns'))throw new Error('blocked');return get.call(this,k)};p.setItem=function(k,v){if(String(k).includes('meeting-columns'))throw new Error('blocked');return set.call(this,k,v)}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=columnState();await open(page,s,1280);
  await expect(names(page)).toHaveCount(4);
  await page.locator('#meetingColumnPicker').getByRole('button',{name:'안전위원회'}).click();await expect(names(page)).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('PC: 열 아래 [+ 이 회의 결과]는 유형이 미리 고른 기존 만들기 창, 회의명 미지정은 비운 채',async({page})=>{
  const s=columnState();await open(page,s,1440);
  await page.locator('[data-meeting-column="궤도협의회"] [data-meeting-add]').click();
  await expect(page.locator('#meetingModal')).toBeVisible();
  await expect(page.locator('#meetingNameSelect')).toHaveValue('궤도협의회');await expect(page.locator('#meetingTitle')).toHaveValue('궤도협의회');
  // 기존 창의 차수 제안(최대 차수 + 1)도 그대로.
  await expect(page.locator('#meetingRoundNo')).toHaveValue('7');
  await page.locator('[data-close="meetingModal"]').click();await expect(page.locator('#meetingModal')).toBeHidden();
  await page.locator('[data-meeting-column="__none__"] [data-meeting-add]').click();
  await expect(page.locator('#meetingTitle')).toHaveValue('');
  await page.locator('[data-close="meetingModal"]').click();
  // 오른쪽 위 [+ 회의 결과]는 지금처럼 회의명 없이 연다(기존 동작: 직접 입력 칸).
  await page.locator('#newMeetingBtn').click();await expect(page.locator('#meetingNameSelect')).toHaveValue('__other__');await expect(page.locator('#meetingTitle')).toHaveValue('');
});

test('PC: 열이 많으면 열 영역만 가로로 넘기고 키보드로도 넘긴다',async({page})=>{
  const s=columnState();
  for(let i=0;i<6;i++)s.meetings.push({id:`extra-${i}`,workspace_id:s.workspace.id,title:`추가 회의 ${i}`,series_name:`추가 회의 ${i}`,round_no:1,meeting_at:`2026-07-0${i+1}T01:00:00Z`,transcript_text:'원문',created_by:s.user.id});
  await open(page,s,1280);
  await expect(columns(page)).toHaveCount(10);
  const scroller=page.locator('#meetingList .mcol-scroller');
  const g=await scroller.evaluate(e=>({sw:e.scrollWidth,cw:e.clientWidth,overflow:getComputedStyle(e).overflowX,wrap:getComputedStyle(e).flexWrap}));
  expect(g.sw).toBeGreaterThan(g.cw);expect(g.overflow).toBe('auto');expect(g.wrap).toBe('nowrap');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  await scroller.focus();await expect(scroller).toBeFocused();await page.keyboard.press('ArrowRight');await page.keyboard.press('End');
  await expect.poll(()=>scroller.evaluate(e=>e.scrollLeft)).toBeGreaterThan(0);
  // 맨 끝 열(가장 오래된 유형)의 카드에 키보드 포커스가 가면 열 영역이 그 카드를 보이게 넘긴다.
  await scroller.evaluate(e=>{e.scrollLeft=0});
  const last=page.locator('#meetingList .mcol').last().locator('.mcol-card').first();await expect(last).toHaveAttribute('data-mrd-meeting','extra-0');
  await last.focus();await expect(last).toBeFocused();
  expect(await last.evaluate(e=>{const a=e.getBoundingClientRect(),b=e.closest('.mcol-scroller').getBoundingClientRect();return a.right<=b.right+1&&a.left>=b.left-1})).toBe(true);
});

test('폰 390: 지금 한 줄 목록 그대로(열 없음)',async({page})=>{
  const s=columnState();await open(page,s,390);
  await expect(page.locator('#meetingList .mcol')).toHaveCount(0);await expect(page.locator('#meetingColumnPicker')).toBeHidden();
  await expect(page.locator('#meetingTypeFilter')).toBeVisible();
  await expect(page.locator('#meetingList .meeting-list-row')).toHaveCount(s.meetings.length);
  await expect(page.locator('[data-mrd-meeting="rail-6"] p')).toContainText('자료 2개');
});
