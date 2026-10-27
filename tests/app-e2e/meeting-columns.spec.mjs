// UI-PC회의(2026-10-20) → MEET-결과정리(시안 C) → MEET-결과3단(2026-10-21 시안 승인): PC(≥1024) 회의 결과는 왼쪽 회의 종류 / 가운데 차수·날짜·시간 /
// 오른쪽 고른 차수의 회의 결과(읽기용, 고칠 때는 ⋯ → 수정) 3단, 폰은 지금 한 줄 목록 그대로. ① 카드 시각(직접 지정 → 결과 글의 일시 → 날짜만) ② 종류별 색 겹침 없음 ③ 차수 대신 짧은 이름 ④ [+ 회의 결과] 하나.
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {fillDateTime} from './helpers/date-time.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {selectMeetingRound,openMeetingResult,mrdMenu} from './helpers/meeting-open.mjs';
import {toplineItem} from './helpers/screen-title.mjs';

test.use({timezoneId:'Asia/Seoul'});

// 궤도협의회 6건, 노사협의회 2건(가장 최근), 안전위원회 1건(가장 오래됨), 회의명 미지정 1건. 모두 가짜 회의 이름.
function columnState(){
  const s=baseState();s.meetingWrites=[];
  const row=(id,name,round,at,extra={})=>({id,workspace_id:s.workspace.id,title:name,series_name:name,round_no:round,meeting_at:at,transcript_text:'원문',created_by:s.user.id,...extra});
  s.meetings=[
    ...[1,2,3,4,5,6].map(n=>row(`rail-${n}`,'궤도협의회',n,`2026-09-0${n}T01:00:00Z`)),
    row('labor-1','노사협의회',1,'2026-10-01T01:00:00Z'),row('labor-2','노사협의회',2,'2026-10-12T05:30:00Z'),
    row('safety-1','안전위원회',3,'2026-08-01T01:00:00Z'),
    row('blank-1','',null,'2026-08-20T01:00:00Z')
  ];
  s.docs.push({id:'rail-doc-1',workspace_id:s.workspace.id,project_id:null,title:'궤도 자료 1',meeting_id:'rail-6',category:'회의자료',tags:[]},{id:'rail-doc-2',workspace_id:s.workspace.id,project_id:null,title:'궤도 자료 2',meeting_id:'rail-6',category:'회의자료',tags:[]});
  return s;
}
async function open(page,s,width,height=900,{routes=async()=>{}}={}){
  await page.setViewportSize({width,height});await mockApp(page,s);await routes();
  await signIn(page,testOrigin+'/app/?view=meetings');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
}
const kinds=page=>page.locator('#meetingList .mcol-kinds [data-meeting-kind]');
const kindNames=page=>page.locator('#meetingList .mcol-kinds .mcol-name');
const kind=(page,key)=>page.locator(`#meetingList [data-meeting-kind="${key}"]`);
const detail=page=>page.locator('#meetingList .mcol-rounds');
// UI-중복제목삭제: 결과 칸 머리에는 제목·차수 줄이 없다 - 이름과 차수는 상단 줄(사업 보고 › 이름 차수)이 보인다.
const result=page=>page.locator('#meetingList #mcolResult');
const round=(page,id)=>page.locator(`#meetingList [data-meeting-round="${id}"]`);

for(const width of [1280,1440])test(`PC ${width}: 3단 — 왼쪽 회의 종류 / 가운데 차수·날짜·시간 / 오른쪽 고른 차수의 결과(종류+차수 1/3, 결과 2/3)`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=columnState();
  s.meetings.find(m=>m.id==='labor-2').transcript_text='가상 노사협의회 2차 결과 원문\n둘째 줄';
  s.meetings.find(m=>m.id==='rail-6').notes='가상 특이사항';
  await open(page,s,width);
  await expect(page.locator('#meetingList .meeting-list-row')).toHaveCount(0);
  // 위쪽 회의 종류 칩 줄은 PC에서 없다(왼쪽 목록과 겹침).
  await expect(page.locator('#meetingsView .meeting-toolbar')).toBeHidden();await expect(page.locator('#meetingTypeFilter')).toBeHidden();
  await expect(page.locator('#meetingColumnPicker')).toHaveCount(0);
  // 왼쪽: 가장 최근 결과가 있는 순, 색 점·이름·건수. 처음엔 맨 위(가장 최근 결과가 있는) 종류를 고른 상태.
  await expect(kindNames(page)).toHaveText(['노사협의회','궤도협의회','회의명 미지정','안전위원회']);
  await expect(kind(page,'궤도협의회').locator('.mcol-count')).toHaveText('6');
  await expect(page.locator('#meetingList [data-meeting-kind][aria-current="true"]')).toHaveCount(1);
  await expect(kind(page,'노사협의회')).toHaveAttribute('aria-current','true');
  expect(await kind(page,'궤도협의회').locator('.mcol-dot').evaluate(e=>getComputedStyle(e).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  await expect(detail(page).locator('.mcol-head .mcol-name')).toHaveText('노사협의회');
  await expect(detail(page).locator('.mcol-card .mcol-round')).toHaveText(['2차','1차']);
  await expect(round(page,'labor-2').locator('.mcol-when')).toContainText('10. 12. 오후 02:30');
  // 처음 열면 가장 최근 차수(노사협의회 2차)가 오른쪽에 바로 보인다. 창은 열리지 않는다.
  await expect(round(page,'labor-2')).toHaveAttribute('aria-current','true');
  await expect(result(page)).toHaveAttribute('data-meeting-result','labor-2');
  await expect(toplineItem(page)).toHaveText('노사협의회 2차');await expect(result(page).locator('h3')).toHaveCount(0);
  await expect(result(page).locator('.mcol-result-meta')).toContainText('2026. 10. 12. 오후 02:30');
  await expect(result(page).locator('.mcol-text').first()).toHaveText('가상 노사협의회 2차 결과 원문\n둘째 줄');
  await expect(page.locator('#meetingRoundDetailModal')).toBeHidden();
  // 오른쪽은 읽기용: 입력칸·저장 버튼 없음, 고치는 곳은 머리의 ⋯ 하나.
  await expect(result(page).locator('input,textarea,select,[contenteditable="true"]')).toHaveCount(0);
  await expect(result(page).locator('button:not(.file-line-open)')).toHaveCount(1);await expect(result(page).locator('[data-meeting-more]')).toHaveAttribute('aria-label','사업 보고 관리');
  // 종류를 고르면 가운데에 그 회의의 차수 전부(최신 위), 오른쪽은 그 종류의 가장 최근 차수. 가운데 줄에는 "회의자료 있음"이 없다(날짜·시간만).
  await kind(page,'궤도협의회').click();
  await expect(kind(page,'궤도협의회')).toHaveAttribute('aria-current','true');await expect(kind(page,'노사협의회')).not.toHaveAttribute('aria-current','true');
  await expect(kind(page,'궤도협의회')).toBeFocused();
  await expect(detail(page).locator('.mcol-card .mcol-round')).toHaveText(['6차','5차','4차','3차','2차','1차']);
  await expect(page.locator('#meetingList :is([data-meeting-add],.mcol-scroller,.mcol-docs)')).toHaveCount(0);
  await expect(detail(page)).not.toContainText('회의자료');
  await expect(result(page)).toHaveAttribute('data-meeting-result','rail-6');
  // 오른쪽에 회의자료(이름·크기)·특이사항이 결과 창처럼 보인다. 자료가 없는 차수는 "회의자료가 없습니다."
  await expect(result(page).locator('.mcol-file')).toHaveCount(2);await expect(result(page).locator('.mcol-file').first()).toContainText('궤도 자료 1');
  await expect(result(page).locator('.mcol-notes')).toHaveText('가상 특이사항');
  // 차수를 고르면 오른쪽만 바뀐다(창 없이).
  await round(page,'rail-5').click();
  await expect(round(page,'rail-5')).toHaveAttribute('aria-current','true');await expect(round(page,'rail-6')).not.toHaveAttribute('aria-current','true');
  await expect(round(page,'rail-5')).toBeFocused();
  await expect(result(page)).toHaveAttribute('data-meeting-result','rail-5');await expect(toplineItem(page)).toContainText('5차');
  await expect(result(page).locator('.mcol-file')).toHaveCount(0);await expect(result(page)).toContainText('회의자료가 없습니다.');
  await expect(result(page).locator('.mcol-notes')).toHaveCount(0);
  await expect(page.locator('#meetingRoundDetailModal')).toBeHidden();
  // 배치: 종류 | 차수 | 결과 가로로 나란히, 위 끝 맞춤, 종류+차수 두 칸 합 : 결과 = 1 : 2, 셋 다 화면 아래 끝 가까이까지, 가로 넘침 없음.
  const g=await page.evaluate(()=>{const r=s=>{const b=document.querySelector(s).getBoundingClientRect();return {l:b.left,r:b.right,t:b.top,b:b.bottom,w:b.width}};return {k:r('#meetingList .mcol-kinds'),d:r('#meetingList .mcol-rounds'),x:r('#meetingList .mcol-result'),vh:innerHeight,sw:document.documentElement.scrollWidth-innerWidth,sh:document.documentElement.scrollHeight-innerHeight}});
  expect(g.k.r).toBeLessThanOrEqual(g.d.l);expect(g.d.r).toBeLessThanOrEqual(g.x.l);
  expect(Math.abs(g.k.t-g.d.t)).toBeLessThanOrEqual(1);expect(Math.abs(g.k.t-g.x.t)).toBeLessThanOrEqual(1);
  // MTG-3칸폭끌기: 세 칸이 한 줄 격자라 틈이 같고(칸 사이 12px), 비율은 틈을 뺀 칸 폭끼리 잰다.
  const lists=g.k.w+g.d.w;expect(Math.abs(g.x.w/lists-2)).toBeLessThan(0.08);
  expect(Math.abs(g.k.w-g.d.w)).toBeLessThanOrEqual(1);
  for(const box of [g.k,g.d,g.x])expect(g.vh-box.b).toBeLessThanOrEqual(40);
  expect(g.sw).toBeLessThanOrEqual(1);expect(g.sh).toBeLessThanOrEqual(1);
  // ⋯ → [수정]: 누른 자리 바로 아래에 펼치고, 지금의 회의 결과 창(수정 단추가 있는 창)을 그 차수로 연다.
  const more=result(page).locator('[data-meeting-more]');await more.click();
  const menu=page.locator('#mcolMenu');await expect(menu).toBeVisible();await expect(more).toHaveAttribute('aria-expanded','true');
  // MTG-사업보고 4단계: 메뉴는 [수정] [칸 바꾸기] 두 줄, 열면 [수정]에 초점.
  await expect(menu.locator('button')).toHaveText(['수정','칸 바꾸기']);await expect(menu.locator('button').first()).toBeFocused();
  const pos=await page.evaluate(()=>{const a=document.querySelector('#meetingList [data-meeting-more]').getBoundingClientRect(),b=document.querySelector('#mcolMenu').getBoundingClientRect();return {gap:b.top-a.bottom,right:b.right<=innerWidth,left:b.left>=0}});
  expect(pos.gap).toBeGreaterThanOrEqual(0);expect(pos.gap).toBeLessThanOrEqual(12);expect(pos.right&&pos.left).toBe(true);
  // Esc는 메뉴만 닫고 ⋯로 돌아간다. 바깥을 눌러도 닫힌다.
  await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(more).toBeFocused();await expect(more).toHaveAttribute('aria-expanded','false');
  await more.click();await expect(menu).toBeVisible();await result(page).locator('.mcol-text').first().click();await expect(menu).toBeHidden();
  await more.click();await menu.locator('[data-meeting-menu="edit"]').click();
  await expect(page.locator('#meetingRoundDetailModal')).toBeVisible();await expect(page.locator('#mrdTitle')).toContainText('궤도협의회');await expect(page.locator('#mrdMeta')).toContainText('5차');
  await expect(page.locator('#mrdMore')).toBeVisible();
  await page.locator('#mrdClose').click();await expect(page.locator('#meetingRoundDetailModal')).toBeHidden();
  // 키보드: 종류 목록은 위·아래 화살표로 옮겨 다니고 Enter로 고른다. 가운데 차수 목록도 화살표·Enter.
  await kind(page,'궤도협의회').focus();await page.keyboard.press('ArrowDown');await expect(kind(page,'__none__')).toBeFocused();
  await page.keyboard.press('End');await expect(kind(page,'안전위원회')).toBeFocused();await page.keyboard.press('Home');await expect(kind(page,'노사협의회')).toBeFocused();
  await kind(page,'궤도협의회').focus();await page.keyboard.press('Enter');
  await round(page,'rail-6').focus();await page.keyboard.press('ArrowDown');await expect(round(page,'rail-5')).toBeFocused();await page.keyboard.press('End');await expect(round(page,'rail-1')).toBeFocused();
  await page.keyboard.press('Enter');await expect(result(page)).toHaveAttribute('data-meeting-result','rail-1');await expect(round(page,'rail-1')).toBeFocused();
  await kind(page,'안전위원회').focus();await page.keyboard.press('Enter');
  await expect(kind(page,'안전위원회')).toHaveAttribute('aria-current','true');await expect(kind(page,'안전위원회')).toBeFocused();
  await expect(detail(page).locator('.mcol-card .mcol-round')).toHaveText(['3차']);await expect(result(page)).toHaveAttribute('data-meeting-result','safety-1');
  // 오른쪽 위 [+ 회의 결과] 하나, 높이는 입력칸과 같은 공용 기준(36px), 누르는 범위 44px.
  const add=page.locator('#newMeetingBtn');await expect(add).toBeVisible();
  const h=await add.evaluate(e=>({box:e.getBoundingClientRect().height,touch:parseFloat(getComputedStyle(e,'::after').height)||parseFloat(getComputedStyle(e,'::after').minHeight)}));
  expect(h.box).toBe(36);expect(h.touch).toBeGreaterThanOrEqual(44);
  expect(errors).toEqual([]);
});

test('PC 오른쪽 결과: 후속 할 일(읽기)·프로젝트·회의자료 내려받기, 결과 창에서 고친 내용이 오른쪽에 반영',async({page})=>{
  const s=columnState();
  s.spaces.push({id:'project-meet',workspace_id:s.workspace.id,name:'가상 프로젝트',status:'active',parent_id:null,sort_order:99,owner_id:s.user.id});
  Object.assign(s.meetings.find(m=>m.id==='labor-2'),{project_id:'project-meet'});
  s.docs.push({id:'labor-doc',workspace_id:s.workspace.id,project_id:null,title:'가상 안건지',file_name:'가상 안건지.hwp',file_id:'drive-labor-doc',file_size:20480,meeting_id:'labor-2',category:'회의자료',tags:[]});
  const reads=[];s.downloads=[];
  const routes=()=>page.route('**/functions/v1/google-tasks**',route=>{const url=new URL(route.request().url());const action=url.searchParams.get('action');if(action==='linked'){reads.push(url.searchParams.get('meeting_id'));const id=url.searchParams.get('meeting_id');return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({tasks:id==='labor-2'?[{id:'t1',title:'가상 후속 할 일',due:'2026-10-25T00:00:00Z',status:'needsAction'},{id:'t2',title:'끝난 가상 할 일',status:'completed'}]:[]})})}return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({connected:true,authorized:true,tasks:[]})})});
  await open(page,s,1440,900,{routes});
  await expect(result(page)).toHaveAttribute('data-meeting-result','labor-2');
  await expect(result(page).locator('.mcol-result-meta')).toContainText('연결 가상 프로젝트');
  await expect(result(page).locator('.mcol-task')).toHaveCount(2);
  await expect(result(page).locator('.mcol-task').first()).toContainText('가상 후속 할 일');await expect(result(page).locator('.mcol-task').first().locator('.mcol-task-due')).toHaveText('10. 25. (일)');
  await expect(result(page).locator('.mcol-task.completed')).toContainText('끝난 가상 할 일');
  // 같은 차수를 다시 그려도 할 일을 또 읽지 않는다(고른 차수가 바뀔 때만).
  expect(reads.filter(id=>id==='labor-2').length).toBe(1);
  await round(page,'labor-1').click();await expect(result(page).locator('.mcol-tasks')).toContainText('후속 할 일이 없습니다.');
  await round(page,'labor-2').click();await expect(result(page).locator('.mcol-task')).toHaveCount(2);
  // 결과 창(⋯ → 수정)에서 원문을 고쳐 저장하면 창을 닫은 뒤 오른쪽도 새 원문.
  await openMeetingResult(page,'labor-2');await mrdMenu(page,'edit');await page.locator('#mrdEditTranscript').fill('고친 가상 원문');await page.locator('#mrdSaveEdit').click();
  await expect.poll(()=>s.meetingWrites.at(-1)?.transcript_text).toBe('고친 가상 원문');
  await page.locator('#mrdClose').click();
  await expect(result(page).locator('.mcol-text').first()).toHaveText('고친 가상 원문');await expect(result(page)).toHaveAttribute('data-meeting-result','labor-2');
  // 회의자료 이름을 누르면 내려받기(결과 창과 같은 경로). 다른 주소로 넘어가므로 맨 끝에 본다.
  await result(page).locator('[data-meeting-doc="labor-doc"]').click();
  await expect.poll(()=>s.downloads.at(-1)?.document_id).toBe('labor-doc');
});

test('PC: 차수가 많으면 가운데 목록만, 종류가 많으면 왼쪽 목록만, 결과 글이 길면 오른쪽 결과만 세로로 넘긴다',async({page})=>{
  const s=columnState();
  for(let n=7;n<=40;n++)s.meetings.push({id:`rail-${n}`,workspace_id:s.workspace.id,title:'궤도협의회',series_name:'궤도협의회',round_no:n,meeting_at:`2026-07-${String(1+n%28).padStart(2,'0')}T01:00:00Z`,transcript_text:'원문',created_by:s.user.id});
  for(let i=0;i<20;i++)s.meetings.push({id:`extra-${i}`,workspace_id:s.workspace.id,title:`추가 회의 ${i}`,series_name:`추가 회의 ${i}`,round_no:1,meeting_at:`2026-06-${String(i+1).padStart(2,'0')}T01:00:00Z`,transcript_text:'원문',created_by:s.user.id});
  s.meetings.find(m=>m.id==='rail-6').transcript_text=Array.from({length:120},(_,i)=>`가상 결과 줄 ${i+1}`).join('\n');
  await open(page,s,1280,800);
  await kind(page,'궤도협의회').click();
  await expect(detail(page).locator('.mcol-card')).toHaveCount(40);
  await round(page,'rail-6').click();
  const list=page.locator('#meetingList .mcol-cards'),side=page.locator('#meetingList .mcol-kinds'),body=page.locator('#meetingList .mcol-result-body');
  for(const box of [list,side,body]){
    const m=await box.evaluate(e=>({sh:e.scrollHeight,ch:e.clientHeight,oy:getComputedStyle(e).overflowY}));
    expect(m.sh).toBeGreaterThan(m.ch);expect(m.oy).toBe('auto');
  }
  expect(await page.evaluate(()=>({w:document.documentElement.scrollWidth-innerWidth,h:document.documentElement.scrollHeight-innerHeight}))).toEqual({w:0,h:0});
  // 맨 아래 줄에 키보드 포커스가 가면 목록이 그 카드를 보이게 넘긴다.
  const last=detail(page).locator('.mcol-card').last();await last.focus();await expect(last).toBeFocused();
  expect(await last.evaluate(e=>{const a=e.getBoundingClientRect(),b=e.closest('.mcol-cards').getBoundingClientRect();return a.bottom<=b.bottom+1&&a.top>=b.top-1})).toBe(true);
  // 다른 종류를 고르면 가운데 목록은 맨 위부터.
  await list.evaluate(e=>{e.scrollTop=e.scrollHeight});await kind(page,'노사협의회').click();
  await expect.poll(()=>list.evaluate(e=>e.scrollTop)).toBe(0);
});

test('PC ④: [+ 회의 결과]는 화면에 하나, 왼쪽에서 고른 종류를 미리 고른 기존 만들기 창(회의명 미지정은 비운 채)',async({page})=>{
  const s=columnState();await open(page,s,1440);
  await expect(page.locator('#meetingsView button:visible').filter({hasText:'사업 보고'})).toHaveCount(1);
  await kind(page,'궤도협의회').click();await page.locator('#newMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeVisible();
  await expect(page.locator('#meetingNameSelect')).toHaveValue('궤도협의회');await expect(page.locator('#meetingTitle')).toHaveValue('궤도협의회');
  // 기존 창의 차수 제안(최대 차수 + 1)도 그대로.
  await expect(page.locator('#meetingRoundNo')).toHaveValue('7');
  await page.locator('[data-close="meetingModal"]').click();await expect(page.locator('#meetingModal')).toBeHidden();
  await kind(page,'__none__').click();await page.locator('#newMeetingBtn').click();
  await expect(page.locator('#meetingNameSelect')).toHaveValue('__other__');await expect(page.locator('#meetingTitle')).toHaveValue('');
  await page.locator('[data-close="meetingModal"]').click();
});

test('② 서로 다른 회의 종류는 서로 다른 색(예전 방식에서 같은 색이던 두 종류 포함), 밝은·어두운 화면 모두',async({page})=>{
  const s=columnState();
  // 예전 방식(이름 해시 % 8)에서 같은 칸이 되는 가짜 회의 이름을 더한다.
  const key=n=>n.replace(/\s+/g,'').toLowerCase(),old=n=>{let h=0;for(const c of key(n))h=(Math.imul(h,31)+c.codePointAt(0))>>>0;return h%8};
  const taken=new Map(s.meetings.filter(m=>m.series_name).map(m=>[old(m.series_name),m.series_name]));
  const clash=Array.from({length:200},(_,i)=>`가짜회의${i}`).find(n=>taken.has(old(n)));
  expect(clash).toBeTruthy();
  for(let i=0;i<4;i++)s.meetings.push({id:`more-${i}`,workspace_id:s.workspace.id,title:i?`가짜 위원회 ${i}`:clash,series_name:i?`가짜 위원회 ${i}`:clash,round_no:1,meeting_at:`2026-07-0${i+1}T01:00:00Z`,transcript_text:'원문',created_by:s.user.id});
  await open(page,s,1280);const seen=[];
  for(const scheme of ['light','dark']){
    await page.emulateMedia({colorScheme:scheme});
    const colors=await page.locator('#meetingList .mcol-kinds [data-meeting-kind]:not([data-meeting-kind="__none__"]) .mcol-dot').evaluateAll(dots=>dots.map(d=>getComputedStyle(d).backgroundColor));
    expect(colors).toHaveLength(7);expect(new Set(colors).size).toBe(7);
    // 오른쪽 머리 점은 고른 종류와 같은 색, 폰 목록·필터 칩도 같은 값을 쓴다.
    expect(await detail(page).locator('.mcol-head .mcol-dot').evaluate(e=>getComputedStyle(e).backgroundColor)).toBe(colors[0]);
    seen.push(colors.join());
  }
  // 어두운 화면은 같은 칸의 밝은 값으로 바뀐다(바탕 대비 유지).
  expect(seen[0]).not.toBe(seen[1]);
  await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.querySelector('#meetingList .meeting-list-row'));
  const meetingColor=e=>getComputedStyle(e).getPropertyValue('--meeting-color').trim();
  const row=await page.locator('[data-mrd-meeting="labor-2"]').evaluate(meetingColor);
  expect(row).toMatch(/^#[0-9a-f]{6}$/);
  await page.setViewportSize({width:1280,height:900});await page.waitForFunction(()=>document.querySelector('#meetingList .mcol-kinds'));
  expect(await kind(page,'노사협의회').evaluate(meetingColor)).toBe(row);
});

test('① 카드 시각: 직접 지정 → 회의 결과 글의 일시 → 날짜만, ③ 차수 없는 파생회의는 짧은 이름',async({page})=>{
  const s=columnState();
  s.meetings.push(
    // 파일로 만들기에서 시각을 못 읽어 0시 0분으로 저장된 결과: 글 안의 "일시: … 오후 2시"를 보인다. 차수 없이 짧은 이름.
    {id:'rail-derived',workspace_id:s.workspace.id,title:'파생 간담회',series_name:'궤도협의회',round_no:null,meeting_at:'2026-10-18T15:00:00Z',transcript_text:'궤도협의회 간담회 결과\n일시: 2026. 10. 19.(월) 오후 2시\n장소: 가상 회의실',created_by:s.user.id},
    // 저장 순간 시각(초·밀리초)이 들어간 결과, 글에 일시 없음: 시각 없이 날짜만.
    {id:'rail-upload',workspace_id:s.workspace.id,title:'궤도협의회',series_name:'궤도협의회',round_no:null,meeting_at:'2026-10-20T03:12:37.481Z',transcript_text:'회의 결과 원문',created_by:s.user.id}
  );
  await open(page,s,1280);
  await expect(kind(page,'궤도협의회')).toHaveAttribute('aria-current','true');
  await expect(detail(page).locator('.mcol-card .mcol-round').first()).toHaveText('차수 없음');
  const derived=round(page,'rail-derived'),upload=round(page,'rail-upload');
  await expect(derived.locator('.mcol-round')).toHaveText('파생 간담회');await expect(derived.locator('.mcol-when')).toHaveText('10. 19. 오후 02:00');
  await expect(upload.locator('.mcol-round')).toHaveText('차수 없음');await expect(upload.locator('.mcol-when')).toHaveText('10. 20.');
  // 직접 지정한 시각은 그대로.
  await expect(round(page,'rail-6').locator('.mcol-when')).toHaveText('9. 6. 오전 10:00');
  // 오른쪽 결과 머리와 결과 창 머리 글자도 같은 규칙(연도 포함), 짧은 이름을 앞에.
  await derived.click();await expect(toplineItem(page)).toContainText('파생 간담회');await expect(result(page).locator('.mcol-result-meta')).toContainText('2026. 10. 19. 오후 02:00');
  await openMeetingResult(page,'rail-derived');await expect(page.locator('#mrdMeta')).toContainText('파생 간담회');await expect(page.locator('#mrdMeta')).toContainText('2026. 10. 19. 오후 02:00');
  await expect(page.locator('#mrdMeta')).not.toContainText('기존 제목');
  // 수정 창의 짧은 이름 칸: 지금 짧은 이름이 들어 있고, 바꾸면 제목(title)만 바뀐다(종류 이름·저장된 시각은 그대로).
  await mrdMenu(page,'edit');await expect(page.locator('#mrdEditShortName')).toHaveValue('파생 간담회');
  await page.locator('#mrdEditShortName').fill('파생 토론회');await page.locator('#mrdSaveEdit').click();
  await expect.poll(()=>s.meetingWrites.at(-1)?.title).toBe('파생 토론회');
  expect(s.meetingWrites.at(-1).series_name).toBeUndefined();expect(s.meetingWrites.at(-1).meeting_at).toBe('2026-10-18T15:00:00.000Z');
  await page.locator('#mrdClose').click();
  await expect(round(page,'rail-derived').locator('.mcol-round')).toHaveText('파생 토론회');await expect(toplineItem(page)).toContainText('파생 토론회');
  // 짧은 이름을 비우면 제목은 종류 이름과 같게 → 다시 '차수 없음'.
  await openMeetingResult(page,'rail-derived');await mrdMenu(page,'edit');await page.locator('#mrdEditShortName').fill('');await page.locator('#mrdSaveEdit').click();
  await expect.poll(()=>s.meetingWrites.at(-1)?.title).toBe('궤도협의회');await page.locator('#mrdClose').click();
  await expect(round(page,'rail-derived').locator('.mcol-round')).toHaveText('차수 없음');
});

test('③ 새 회의 결과에서 짧은 이름: 종류 이름은 그대로, 제목만 짧은 이름',async({page})=>{
  const s=columnState();await open(page,s,1280);
  await kind(page,'궤도협의회').click();await page.locator('#newMeetingBtn').click();
  await page.locator('#meetingRoundNo').fill('');await page.locator('#meetingShortName').fill('파생 간담회');
  await fillDateTime(page,'#meetingAt','2026-10-19T14:00');await page.locator('#meetingTranscript').fill('가상 원문');await page.locator('#saveMeetingBtn').click();
  await expect.poll(()=>s.meetingWrites.at(-1)?.series_name).toBe('궤도협의회');
  expect(s.meetingWrites.at(-1).title).toBe('파생 간담회');expect(s.meetingWrites.at(-1).round_no).toBeNull();
  await expect(round(page,'new-meeting').locator('.mcol-round')).toHaveText('파생 간담회');
  // 다시 열면 짧은 이름 칸은 비어 있다.
  await page.locator('#newMeetingBtn').click();await expect(page.locator('#meetingShortName')).toHaveValue('');
});

test('폰 390: 지금 한 줄 목록 그대로(종류 목록·차수 목록 없음), 시각·짧은 이름 규칙은 같다',async({page})=>{
  const s=columnState();
  s.meetings.push({id:'rail-derived',workspace_id:s.workspace.id,title:'파생 간담회',series_name:'궤도협의회',round_no:null,meeting_at:'2026-10-18T15:00:00Z',transcript_text:'일시: 2026. 10. 19.(월) 14:00',created_by:s.user.id});
  await open(page,s,390);
  await expect(page.locator('#meetingList :is(.mcol-layout,.mcol-kinds,.mcol-detail)')).toHaveCount(0);
  await expect(page.locator('#meetingsView .meeting-toolbar')).toBeVisible();await expect(page.locator('#meetingTypeFilter')).toBeVisible();
  await expect(page.locator('#meetingList .meeting-list-row')).toHaveCount(s.meetings.length);
  // 폰도 PC처럼 최신이 위: 시각 내림차순(받은 순서에 기대지 않음).
  expect(await page.locator('#meetingList [data-mrd-meeting]').evaluateAll(els=>els.map(e=>e.dataset.mrdMeeting))).toEqual(['rail-derived','labor-2','labor-1','rail-6','rail-5','rail-4','rail-3','rail-2','rail-1','blank-1','safety-1']);
  await expect(page.locator('[data-mrd-meeting="rail-6"] p')).toContainText('회의자료 있음');
  await expect(page.locator('[data-mrd-meeting="rail-6"] p')).not.toContainText('2개');
  await expect(page.locator('[data-mrd-meeting="rail-5"] p')).not.toContainText('회의자료');
  await expect(page.locator('[data-mrd-meeting="rail-derived"] p')).toHaveText('파생 간담회 · 10. 19. 오후 02:00');
  await expect(page.locator('[data-mrd-meeting="blank-1"] p')).toHaveText('8. 20. 오전 10:00');
  // 폰의 [+ 회의 결과]는 지금처럼 회의명 없이 연다.
  await page.locator('#newMeetingBtn').click();await expect(page.locator('#meetingNameSelect')).toHaveValue('__other__');await expect(page.locator('#meetingTitle')).toHaveValue('');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
});

// UI-화면점검 ①: 1024~1279px에서는 회의 종류·차수 칸이 각각 120px 안팎이다. 글자는 줄임표(+title)로 줄이고, 고른 줄의 배경은 칸 안에 머문다(칸 밖으로 잘리지 않음).
for(const width of [1024,1100,1279])test(`PC ${width}: 회의 종류·차수 칸 글자는 줄임표, 선택 배경이 칸 안에 머문다`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=columnState();
  s.meetings.find(m=>m.id==='rail-6').series_name='아주 긴 이름의 가상 협의회 정기 회의';s.meetings.find(m=>m.id==='rail-6').title='아주 긴 이름의 가상 협의회 정기 회의';
  await open(page,s,width);
  const longKind=page.locator('#meetingList .mcol-kind',{hasText:'아주 긴 이름'});await longKind.click();
  await expect(longKind).toHaveAttribute('aria-current','true');
  const m=await page.evaluate(()=>{
    const r=e=>e.getBoundingClientRect(),within=(e,box)=>r(e).left>=r(box).left-0.5&&r(e).right<=r(box).right+0.5;
    const kinds=document.querySelector('#meetingList .mcol-kinds'),rounds=document.querySelector('#meetingList .mcol-rounds'),cards=document.querySelector('#meetingList .mcol-cards');
    const names=[...document.querySelectorAll('#meetingList .mcol-kind')].map(b=>({text:b.querySelector('.mcol-name').textContent.trim(),title:b.querySelector('.mcol-name').title,inside:within(b,kinds),on:b.getAttribute('aria-current')==='true',count:within(b.querySelector('.mcol-count'),kinds),ell:getComputedStyle(b.querySelector('.mcol-name')).textOverflow,clipped:b.querySelector('.mcol-name').scrollWidth>b.querySelector('.mcol-name').clientWidth}));
    const rows=[...document.querySelectorAll('#meetingList .mcol-card')].map(b=>{const w=b.querySelector('.mcol-when'),ro=b.querySelector('.mcol-round');return {inside:within(b,cards),insideRounds:within(b,rounds),whenEll:getComputedStyle(w).textOverflow,whenTitle:w.title,roundTitle:ro.title,whenInside:within(w,b),roundInside:within(ro,b)}});
    return {names,rows,kindsOverflowX:kinds.scrollWidth-kinds.clientWidth,cardsOverflowX:cards.scrollWidth-cards.clientWidth,doc:document.documentElement.scrollWidth-innerWidth,
      kindsW:r(kinds).width,roundsW:r(rounds).width,resultW:r(document.querySelector('#meetingList #mcolResult')).width};
  });
  for(const n of m.names){expect(n.inside,`${n.text} 종류 줄이 칸 안`).toBe(true);expect(n.count,`${n.text} 건수가 칸 안`).toBe(true);expect(n.ell).toBe('ellipsis');expect(n.title).toBe(n.text)}
  expect(m.names.find(n=>n.on).clipped,'고른 긴 종류 이름은 줄임표로 줄어듦').toBe(true);
  for(const n of m.rows){expect(n.inside).toBe(true);expect(n.insideRounds).toBe(true);expect(n.whenEll).toBe('ellipsis');expect(n.whenInside).toBe(true);expect(n.roundInside).toBe(true);expect(n.whenTitle).not.toBe('');expect(n.roundTitle).not.toBe('')}
  expect(m.kindsOverflowX,'종류 칸 가로 넘침 없음').toBeLessThanOrEqual(0);expect(m.cardsOverflowX,'차수 칸 가로 넘침 없음').toBeLessThanOrEqual(0);expect(m.doc).toBeLessThanOrEqual(1);
  // 비율은 그대로: 종류+차수(+칸 사이) 1/3 : 결과 2/3 근처(좁은 폭은 list-min 240px 때문에 1/3보다 조금 넓다).
  expect(m.resultW).toBeGreaterThan((m.kindsW+m.roundsW)*1.5);
  expect(errors).toEqual([]);
});

// MEET-폰순서(2026-10-21): 폰(좁은 화면) 회의 목록도 PC처럼 최신이 위. 서버가 오래된 것부터 주거나 시각이 같아도 차수 큰 쪽이 위. PC 3단은 그대로.
test('폰 390: 회의 목록은 최신 차수가 위(6차→1차), 시각이 같으면 차수 큰 쪽이 위, 종류 거르기 뒤에도 같음 / PC 1280 3단 순서는 그대로',async({page})=>{
  const s=columnState();
  // 같은 날 같은 시각에 열린 연속 차수를 오래된 차수부터 받는 경우(가상 데이터).
  s.meetings=[1,2,3,4,5,6].map(n=>({id:`tie-${n}`,workspace_id:s.workspace.id,title:'궤도협의회',series_name:'궤도협의회',round_no:n,meeting_at:'2026-09-01T01:00:00Z',transcript_text:'원문',created_by:s.user.id}));
  s.meetings.push({id:'labor-1',workspace_id:s.workspace.id,title:'노사협의회',series_name:'노사협의회',round_no:1,meeting_at:'2026-10-01T01:00:00Z',transcript_text:'원문',created_by:s.user.id});
  await open(page,s,390);
  const order=()=>page.locator('#meetingList [data-mrd-meeting]').evaluateAll(els=>els.map(e=>e.dataset.mrdMeeting));
  expect(await order()).toEqual(['labor-1','tie-6','tie-5','tie-4','tie-3','tie-2','tie-1']);
  await expect(page.locator('#meetingList .meeting-list-row').nth(1).locator('h3')).toHaveText('궤도협의회');
  // 회의 종류 칩으로 거른 뒤에도 최신이 위.
  await page.locator('#meetingTypeFilter').getByRole('radio',{name:'궤도협의회',exact:true}).click();
  expect(await order()).toEqual(['tie-6','tie-5','tie-4','tie-3','tie-2','tie-1']);
  // PC 3단: 가운데 차수 목록은 지금처럼 6차→1차, 왼쪽 종류 순서도 그대로.
  await page.setViewportSize({width:1280,height:900});await page.waitForFunction(()=>document.querySelector('#meetingList .mcol-kinds'));
  await expect(kindNames(page)).toHaveText(['노사협의회','궤도협의회']);
  await kind(page,'궤도협의회').click();await expect(detail(page).locator('.mcol-card .mcol-round')).toHaveText(['6차','5차','4차','3차','2차','1차']);
});

// FILE-사업보고⋯(2026-10-24 명진 결정): 사업 보고 자료 줄에도 담당조직·프로젝트 자료 줄과 같은 ⋯([Drive에서 열기]·[내려받기], file-actions.js).
// 줄 전체를 누르면 지금처럼 종류별 동작(PDF는 Drive 보기 새 탭, HWP는 내려받기). ⋯는 그 누르기 자리 밖이라 누르면 메뉴만 열린다.
// 내려받기는 화면 주소를 바꾸므로 각 시험의 맨 끝에 한 번만 본다(HWP 줄 누르기 = 내려받기는 위 'PC 오른쪽 결과' 시험이 본다).
const fileState=()=>{const s=columnState();s.downloads=[];
  s.docs.push({id:'labor-hwp',workspace_id:s.workspace.id,project_id:null,title:'가상 안건지',file_name:'가상 안건지.hwp',mime_type:'application/x-hwp',file_id:'drive-labor-hwp',drive_url:'https://drive.google.com/file/d/drive-labor-hwp/view',file_size:20480,meeting_id:'labor-2',category:'회의자료',tags:[]},
    {id:'labor-pdf',workspace_id:s.workspace.id,project_id:null,title:'가상 공문',file_name:'가상 공문.pdf',mime_type:'application/pdf',file_id:'drive-labor-pdf',drive_url:'https://drive.google.com/file/d/drive-labor-pdf/view',file_size:4096,meeting_id:'labor-2',category:'회의자료',tags:[]});
  return s};
async function checkFileMenu(page,s,rows,width){
  await page.context().route('https://drive.google.com/**',r=>r.fulfill({status:200,contentType:'text/html',body:'ok'}));
  const row=rows.filter({hasText:'가상 안건지.hwp'}),pdf=rows.filter({hasText:'가상 공문.pdf'});
  const more=row.locator('details.file-line-more'),summary=more.locator('summary');
  await expect(summary).toBeVisible();await expect(summary).toHaveAccessibleName('파일 메뉴: 가상 안건지.hwp');
  const box=await summary.boundingBox();expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);
  // 줄 누르기는 그대로: PDF 줄을 누르면 Drive 보기 새 탭(내려받기 없음).
  const [view]=await Promise.all([page.waitForEvent('popup'),pdf.locator('.file-line-main').click({force:true})]);
  await view.waitForURL('https://drive.google.com/file/d/drive-labor-pdf/view');await view.close();expect(s.downloads).toEqual([]);
  // ⋯를 누르면 메뉴만 열리고 내려받기는 시작하지 않는다.
  await summary.click();await expect(more).toHaveAttribute('open','');
  const items=more.locator('.file-line-more-panel button');await expect(items).toHaveText(['Drive에서 열기','내려받기']);
  for(const b of await items.all()){const r=await b.boundingBox();expect(r.height).toBeGreaterThanOrEqual(44);expect(r.x+r.width).toBeLessThanOrEqual(width+1)}
  expect(s.downloads).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  // [Drive에서 열기]: HWP라도 같은 파일의 Drive 보기를 새 탭으로 열고 메뉴는 닫힌다.
  const [tab]=await Promise.all([page.waitForEvent('popup'),items.first().click()]);
  await tab.waitForURL('https://drive.google.com/file/d/drive-labor-hwp/view');await tab.close();
  await expect(more).not.toHaveAttribute('open','');expect(s.downloads).toEqual([]);
  // [내려받기]: 자료실 자료라 서버 토큰 길(workspace-drive download-token). 화면 주소가 바뀌므로 맨 끝.
  await summary.click();await more.locator('[data-fa-menu="download"]').click();
  await expect.poll(()=>s.downloads.at(-1)?.document_id).toBe('labor-hwp');
}

test('PC 1280 오른쪽 결과 칸: 사업 보고 자료 줄 ⋯ [Drive에서 열기]·[내려받기], 줄 누르기는 그대로',async({page})=>{
  const s=fileState();await open(page,s,1280);
  // ⋯가 없는 옛 자료(파일 번호·주소 없음)는 메뉴 없이 줄만.
  await selectMeetingRound(page,'rail-6');await expect(result(page).locator('.mcol-file')).toHaveCount(2);await expect(result(page).locator('.file-line-more')).toHaveCount(0);
  await selectMeetingRound(page,'labor-2');await expect(result(page).locator('.mcol-file')).toHaveCount(2);
  await checkFileMenu(page,s,result(page).locator('.mcol-file'),1280);
});

for(const width of [390,1280])test(`사업 보고 결과 창 ${width}: 자료 줄 ⋯ [Drive에서 열기]·[내려받기], ×·줄 누르기는 그대로`,async({page})=>{
  const s=fileState();await open(page,s,width);
  await openMeetingResult(page,'labor-2');
  const rows=page.locator('#mrdMaterials .mrd-file-row'),row=rows.filter({hasText:'가상 안건지.hwp'});
  await expect(row).toBeVisible();
  // 한 줄 순서: 종류 · 이름 · ⋯ · ×. ⋯와 ×가 겹치지 않는다.
  const x=row.locator('[data-mrd-delete-document]'),summary=row.locator('.file-line-more summary');
  await expect(x).toBeVisible();const a=await summary.boundingBox(),b=await x.boundingBox();expect(a.x+a.width).toBeLessThanOrEqual(b.x+1);
  await checkFileMenu(page,s,rows,width);
});
