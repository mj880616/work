// UI-PC회의(2026-10-20) → MEET-결과정리(시안 C) → MEET-결과3단(2026-10-21 시안 승인): PC(≥1024) 회의 결과는 왼쪽 회의 종류 / 가운데 차수·날짜·시간 /
// 오른쪽 고른 차수의 회의 결과(읽기용, 고칠 때는 ⋯ → 수정) 3단, 폰은 지금 한 줄 목록 그대로. ① 카드 시각(직접 지정 → 결과 글의 일시 → 날짜만) ② 종류별 색 겹침 없음 ③ 차수 대신 짧은 이름 ④ [+ 회의 결과] 하나.
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {fillDateTime} from './helpers/date-time.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {selectMeetingRound,openMeetingResult,mrdMenu,closeMeetingResult} from './helpers/meeting-open.mjs';
import {toplineItem} from './helpers/screen-title.mjs';
import {showAllReportWeeks,reportWeekButton} from './helpers/report-week.mjs';

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
// MTG-프로젝트합치기 3단계: [목록]은 한 주씩 보인다. 이 파일의 가짜 보고는 여러 주에 걸쳐 있어, 열자마자 주 줄의 [전체]로 모든 주를 본다
// (주 넘기기 자체는 맨 아래 '주 단위 목록' 시험이 allWeeks:false로 본다).
async function open(page,s,width,height=900,{routes=async()=>{},allWeeks=true}={}){
  await page.setViewportSize({width,height});await mockApp(page,s);await routes();
  await signIn(page,testOrigin+'/app/?view=meetings');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  if(allWeeks)await showAllReportWeeks(page);
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
  // MTG-3칸정리 ②: 가운데 칸 맨 위 제목 줄(첫 칸과 중복)은 없다. 칸 이름은 읽기 전용 이름표(aria-label)로만 남는다.
  await expect(detail(page).locator('.mcol-head')).toHaveCount(0);await expect(detail(page)).toHaveAttribute('aria-label','노사협의회 2건');
  await expect(detail(page).locator('.mcol-card .mcol-round')).toHaveText(['2차','1차']);
  // ③: 가운데 줄은 '2차' + 오른쪽 작은 날짜 '10.12'(시간 뺌, 전체 일시는 마우스를 올리면).
  await expect(round(page,'labor-2').locator('.mcol-date')).toHaveText('10.12');await expect(round(page,'labor-2').locator('.mcol-date')).toHaveAttribute('title',/14:30/);
  // 처음 열면 가장 최근 차수(노사협의회 2차)가 오른쪽 칸에 바로 붙는다. 팝업은 없다(그 칸에 사업 보고 창 요소 하나를 그대로 붙인 것).
  await expect(round(page,'labor-2')).toHaveAttribute('aria-current','true');
  await expect(result(page)).toHaveAttribute('data-meeting-result','labor-2');
  await expect(toplineItem(page)).toHaveText('노사협의회 2차');
  await expect(result(page).locator('#meetingRoundDetailModal.mrd-docked')).toBeVisible();await expect(page.locator('body>#meetingRoundDetailModal')).toHaveCount(0);
  await expect(result(page).locator('#mrdMeta')).toContainText('2026. 10. 12. 14:30');
  await expect(result(page).locator('#mrdResult')).toHaveText('가상 노사협의회 2차 결과 원문\n둘째 줄');
  // 보는 화면: 입력칸·저장 버튼은 없고, 고치는 곳은 머리의 ⋯ 하나(×는 칸에서 없다).
  await expect(result(page).locator('#mrdEditor')).toBeHidden();await expect(result(page).locator('#mrdClose')).toBeHidden();
  await expect(result(page).locator('#mrdMore')).toHaveAttribute('aria-label','사업 보고 관리');
  // 종류를 고르면 가운데에 그 회의의 차수 전부(최신 위), 오른쪽은 그 종류의 가장 최근 차수. 가운데 줄에는 "회의자료 있음"이 없다(날짜·시간만).
  await kind(page,'궤도협의회').click();
  await expect(kind(page,'궤도협의회')).toHaveAttribute('aria-current','true');await expect(kind(page,'노사협의회')).not.toHaveAttribute('aria-current','true');
  await expect(kind(page,'궤도협의회')).toBeFocused();
  await expect(detail(page).locator('.mcol-card .mcol-round')).toHaveText(['6차','5차','4차','3차','2차','1차']);
  await expect(page.locator('#meetingList :is([data-meeting-add],.mcol-scroller,.mcol-docs)')).toHaveCount(0);
  await expect(detail(page)).not.toContainText('회의자료');
  await expect(result(page)).toHaveAttribute('data-meeting-result','rail-6');
  // 오른쪽에 회의자료(이름·크기)·특이사항이 결과 창처럼 보인다. 자료가 없는 차수는 "회의자료가 없습니다."
  await expect(result(page).locator('#mrdMaterials .mrd-file-row')).toHaveCount(2);await expect(result(page).locator('#mrdMaterials .mrd-file-row').first()).toContainText('궤도 자료 1');
  await expect(result(page).locator('#mrdSpecial')).toHaveText('가상 특이사항');
  // 차수를 고르면 오른쪽만 바뀐다(창 없이).
  await round(page,'rail-5').click();
  await expect(round(page,'rail-5')).toHaveAttribute('aria-current','true');await expect(round(page,'rail-6')).not.toHaveAttribute('aria-current','true');
  await expect(round(page,'rail-5')).toBeFocused();
  await expect(result(page)).toHaveAttribute('data-meeting-result','rail-5');await expect(toplineItem(page)).toContainText('5차');
  await expect(result(page).locator('#mrdMaterials .mrd-file-row')).toHaveCount(0);
  await expect(result(page).locator('#mrdSpecialSection')).toBeHidden();
  // 배치: 종류 | 차수 | 결과 가로로 나란히, 위 끝 맞춤, 종류+차수 두 칸 합 : 결과 = 1 : 2, 셋 다 화면 아래 끝 가까이까지, 가로 넘침 없음.
  const g=await page.evaluate(()=>{const r=s=>{const b=document.querySelector(s).getBoundingClientRect();return {l:b.left,r:b.right,t:b.top,b:b.bottom,w:b.width}};return {k:r('#meetingList .mcol-kinds'),d:r('#meetingList .mcol-rounds'),x:r('#meetingList .mcol-result'),vh:innerHeight,sw:document.documentElement.scrollWidth-innerWidth,sh:document.documentElement.scrollHeight-innerHeight}});
  expect(g.k.r).toBeLessThanOrEqual(g.d.l);expect(g.d.r).toBeLessThanOrEqual(g.x.l);
  expect(Math.abs(g.k.t-g.d.t)).toBeLessThanOrEqual(1);expect(Math.abs(g.k.t-g.x.t)).toBeLessThanOrEqual(1);
  // MTG-3칸폭끌기: 세 칸이 한 줄 격자라 틈이 같고(칸 사이 12px), 비율은 틈을 뺀 칸 폭끼리 잰다.
  // MTG-3칸정리 ④: 가운데 칸은 첫 칸의 약 절반(기본 1 : 0.5 : 4.5), 남는 폭은 결과 칸이 쓴다.
  const lists=g.k.w+g.d.w;expect(g.x.w/lists).toBeGreaterThan(2.6);
  expect(g.d.w).toBeLessThan(g.k.w*0.75);expect(g.d.w).toBeGreaterThan(g.k.w*0.35);
  for(const box of [g.k,g.d,g.x])expect(g.vh-box.b).toBeLessThanOrEqual(40);
  expect(g.sw).toBeLessThanOrEqual(1);expect(g.sh).toBeLessThanOrEqual(1);
  // ⋯ → [수정]: 누른 자리 바로 아래에 메뉴가 펼쳐지고, 고르면 같은 칸이 그 자리에서 고치는 화면으로 바뀐다(팝업 없음).
  const more=result(page).locator('#mrdMore');await more.click();
  const menu=page.locator('#mrdMoreMenu');await expect(menu).toBeVisible();await expect(more).toHaveAttribute('aria-expanded','true');
  // 메뉴는 [수정] [칸 바꾸기] [삭제], 열면 [수정]에 초점.
  await expect(menu.locator('button')).toHaveText(['수정','칸 바꾸기','삭제']);await expect(menu.locator('button').first()).toBeFocused();
  const pos=await page.evaluate(()=>{const a=document.querySelector('#mrdMore').getBoundingClientRect(),b=document.querySelector('#mrdMoreMenu').getBoundingClientRect();return {gap:b.top-a.bottom,right:b.right<=innerWidth,left:b.left>=0}});
  expect(pos.gap).toBeGreaterThanOrEqual(0);expect(pos.gap).toBeLessThanOrEqual(12);expect(pos.right&&pos.left).toBe(true);
  // Esc는 메뉴만 닫고 ⋯로 돌아간다. 바깥을 눌러도 닫힌다.
  await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(more).toBeFocused();await expect(more).toHaveAttribute('aria-expanded','false');
  // UI-화면정리 C: ⋯ 점이 공용 .more-dots가 되어 머리줄이 낮아지면 메뉴가 결과 글 첫 줄을 덮을 수 있으므로, 바깥 누르기는 메뉴 밖인 머리 날짜 줄에서 잰다.
  await more.click();await expect(menu).toBeVisible();await result(page).locator('#mrdMeta').click({position:{x:4,y:4}});await expect(menu).toBeHidden();
  await more.click();await menu.locator('[data-mrd-more="edit"]').click();
  await expect(result(page).locator('#mrdEditor')).toBeVisible();await expect(result(page).locator('#mrdEditRound')).toHaveValue('5');
  await expect(page.locator('body>#meetingRoundDetailModal')).toHaveCount(0);
  // 고치는 중: 맨 위 오른쪽에 작은 [취소][저장], 아래쪽 단추 줄은 없다. [취소]는 보는 화면으로.
  await expect(result(page).locator('.modal-head #mrdCancelEdit')).toBeVisible();await expect(result(page).locator('.modal-head #mrdSaveEdit')).toHaveText('저장');
  await result(page).locator('#mrdCancelEdit').click();await expect(result(page).locator('#mrdEditor')).toBeHidden();await expect(result(page).locator('#mrdMeta')).toContainText('9. 5.');
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
  // 처음 붙는 차수(labor-2)의 할 일 읽기 횟수를 세므로, 그 읽기가 끝난 뒤에 [전체]를 누른다(labor-1은 다른 주).
  await open(page,s,1440,900,{routes,allWeeks:false});
  await expect(result(page)).toHaveAttribute('data-meeting-result','labor-2');
  await expect(result(page).locator('#mrdMeta')).toContainText('연결 가상 프로젝트');
  await expect(result(page).locator('#mrdTasks [data-mrd-task]')).toHaveCount(2);
  await expect(result(page).locator('#mrdTasks [data-mrd-task]').first()).toContainText('가상 후속 할 일');await expect(result(page).locator('#mrdTasks [data-mrd-task]').first()).toContainText('10. 25.');
  await expect(result(page).locator('#mrdTasks [data-mrd-task]').nth(1)).toContainText('끝난 가상 할 일');
  // 같은 차수를 다시 그려도 할 일을 또 읽지 않는다(고른 차수가 바뀔 때만).
  expect(reads.filter(id=>id==='labor-2').length).toBe(1);
  await showAllReportWeeks(page);await expect(result(page)).toHaveAttribute('data-meeting-result','labor-2');
  expect(reads.filter(id=>id==='labor-2').length).toBe(1);
  await round(page,'labor-1').click();await expect(result(page).locator('#mrdTasks')).toContainText('후속 할 일이 없습니다.');
  await round(page,'labor-2').click();await expect(result(page).locator('#mrdTasks [data-mrd-task]')).toHaveCount(2);
  // 오른쪽 칸에서 ⋯ → 수정으로 원문을 고쳐 [저장]하면 같은 칸이 보는 화면으로 돌아가 새 원문을 보인다(창 없음).
  await mrdMenu(page,'edit');await page.locator('#mrdEditTranscript').fill('고친 가상 원문');await page.locator('#mrdSaveEdit').click();
  await expect.poll(()=>s.meetingWrites.at(-1)?.transcript_text).toBe('고친 가상 원문');
  await expect(result(page).locator('#mrdEditor')).toBeHidden();
  await expect(result(page).locator('#mrdResult')).toHaveText('고친 가상 원문');await expect(result(page)).toHaveAttribute('data-meeting-result','labor-2');
  // 회의자료 줄 ⋯ → 내려받기(사업 보고 창과 같은 경로).
  await result(page).locator('#mrdMaterials .file-line-more summary').click();await result(page).locator('#mrdMaterials [data-fa-menu="download"]').click();
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
  const list=page.locator('#meetingList .mcol-cards'),side=page.locator('#meetingList .mcol-kinds'),body=page.locator('#meetingList #meetingRoundDetailModal.mrd-docked');
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
    // (가운데 칸 머리 점은 머리 줄과 함께 없어졌다. 폰 목록·필터 칩은 같은 색 값을 쓴다.)
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
  // ⑤: 차수·짧은 이름이 둘 다 없으면 왼쪽 자리에 날짜만 보인다.
  await expect(detail(page).locator('.mcol-card .mcol-round').first()).toHaveText('10.20');
  const derived=round(page,'rail-derived'),upload=round(page,'rail-upload');
  await expect(derived.locator('.mcol-round')).toHaveText('파생 간담회');await expect(derived.locator('.mcol-date')).toHaveText('10.19');await expect(derived.locator('.mcol-date')).toHaveAttribute('title','10. 19. 14:00');
  await expect(upload.locator('.mcol-round')).toHaveText('10.20');await expect(upload.locator('.mcol-date')).toHaveCount(0);
  // 직접 지정한 시각은 그대로.
  await expect(round(page,'rail-6').locator('.mcol-date')).toHaveText('9.6');await expect(round(page,'rail-6').locator('.mcol-date')).toHaveAttribute('title','9. 6. 10:00');
  // 오른쪽 결과 머리와 결과 창 머리 글자도 같은 규칙(연도 포함), 짧은 이름을 앞에.
  await derived.click();await expect(toplineItem(page)).toContainText('파생 간담회');await expect(result(page).locator('#mrdMeta')).toContainText('2026. 10. 19. 14:00');
  await openMeetingResult(page,'rail-derived');await expect(page.locator('#mrdMeta')).toContainText('파생 간담회');await expect(page.locator('#mrdMeta')).toContainText('2026. 10. 19. 14:00');
  await expect(page.locator('#mrdMeta')).not.toContainText('기존 제목');
  // 수정 창의 짧은 이름 칸: 지금 짧은 이름이 들어 있고, 바꾸면 제목(title)만 바뀐다(종류 이름·저장된 시각은 그대로).
  await mrdMenu(page,'edit');await expect(page.locator('#mrdEditShortName')).toHaveValue('파생 간담회');
  await page.locator('#mrdEditShortName').fill('파생 토론회');await page.locator('#mrdSaveEdit').click();
  await expect.poll(()=>s.meetingWrites.at(-1)?.title).toBe('파생 토론회');
  expect(s.meetingWrites.at(-1).series_name).toBeUndefined();expect(s.meetingWrites.at(-1).meeting_at).toBe('2026-10-18T15:00:00.000Z');
  await closeMeetingResult(page);
  await expect(round(page,'rail-derived').locator('.mcol-round')).toHaveText('파생 토론회');await expect(toplineItem(page)).toContainText('파생 토론회');
  // 짧은 이름을 비우면 제목은 종류 이름과 같게 → 다시 날짜만.
  await openMeetingResult(page,'rail-derived');await mrdMenu(page,'edit');await page.locator('#mrdEditShortName').fill('');await page.locator('#mrdSaveEdit').click();
  await expect.poll(()=>s.meetingWrites.at(-1)?.title).toBe('궤도협의회');await closeMeetingResult(page);
  await expect(round(page,'rail-derived').locator('.mcol-round')).toHaveText('10.19');
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
  await expect(page.locator('[data-mrd-meeting="rail-derived"] p')).toHaveText('파생 간담회 · 10. 19. 14:00');
  await expect(page.locator('[data-mrd-meeting="blank-1"] p')).toHaveText('8. 20. 10:00');
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
    const rows=[...document.querySelectorAll('#meetingList .mcol-card')].map(b=>{const ro=b.querySelector('.mcol-round'),w=b.querySelector('.mcol-date')||ro;return {inside:within(b,cards),insideRounds:within(b,rounds),whenEll:getComputedStyle(w).textOverflow,whenTitle:w.title,roundTitle:ro.title,whenInside:within(w,b),roundInside:within(ro,b)}});
    return {names,rows,kindsOverflowX:kinds.scrollWidth-kinds.clientWidth,cardsOverflowX:cards.scrollWidth-cards.clientWidth,doc:document.documentElement.scrollWidth-innerWidth,
      kindsW:r(kinds).width,roundsW:r(rounds).width,resultW:r(document.querySelector('#meetingList #mcolResult')).width};
  });
  for(const n of m.names){expect(n.inside,`${n.text} 종류 줄이 칸 안`).toBe(true);expect(n.count,`${n.text} 건수가 칸 안`).toBe(true);expect(n.ell).toBe('ellipsis');expect(n.title).toBe(n.text)}
  expect(m.names.find(n=>n.on).clipped,'고른 긴 종류 이름은 줄임표로 줄어듦').toBe(true);
  for(const n of m.rows){expect(n.inside).toBe(true);expect(n.insideRounds).toBe(true);expect(n.whenEll).toBe('ellipsis');expect(n.whenInside).toBe(true);expect(n.roundInside).toBe(true);expect(n.whenTitle).not.toBe('');expect(n.roundTitle).not.toBe('')}
  expect(m.kindsOverflowX,'종류 칸 가로 넘침 없음').toBeLessThanOrEqual(0);expect(m.cardsOverflowX,'차수 칸 가로 넘침 없음').toBeLessThanOrEqual(0);expect(m.doc).toBeLessThanOrEqual(1);
  // 비율: 결과 칸이 종류+차수보다 훨씬 넓다(기본 3/4).
  expect(m.resultW).toBeGreaterThan((m.kindsW+m.roundsW)*2);
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
  await selectMeetingRound(page,'rail-6');await expect(result(page).locator('#mrdMaterials .mrd-file-row')).toHaveCount(2);await expect(result(page).locator('.file-line-more')).toHaveCount(0);
  await selectMeetingRound(page,'labor-2');await expect(result(page).locator('#mrdMaterials .mrd-file-row')).toHaveCount(2);
  await checkFileMenu(page,s,result(page).locator('#mrdMaterials .mrd-file-row'),1280);
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

// MTG-프로젝트합치기 3단계(요청 10/28 19:07 ③): [목록] 보기는 한 주(서울 월~일)씩. 처음은 가장 최근 보고의 주(이번 주에 보고가 없을 때),
// ‹ ›로 주를 넘기고 [전체]로 모든 주를 본다(다시 누르면 주 단위). 다른 곳에서 고른 보고(select)가 지금 주에 없으면 그 주로 옮긴다. 폰 한 줄 목록·PC 3단 같은 규칙.
for(const width of [390,1280])test(`${width}: 사업 보고 [목록]은 주 단위 — 처음 최근 주, ‹ 앞 주, › 다시, [전체] 모든 주, 고른 보고의 주로 옮기기`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=baseState();s.meetingWrites=[];
  const row=(id,round,at)=>({id,workspace_id:s.workspace.id,title:'궤도협의회',series_name:'궤도협의회',round_no:round,meeting_at:at,transcript_text:'원문 '+id,created_by:s.user.id});
  // 두 주(10.12~10.18 / 10.19~10.25)에 하나씩. 둘 다 오늘보다 앞이라 처음 주는 더 최근 보고(10.20)의 주다.
  s.meetings=[row('week-old',1,'2026-10-13T01:00:00Z'),row('week-new',2,'2026-10-20T01:00:00Z')];
  await open(page,s,width,900,{allWeeks:false});
  const pc=width>=1024;
  const shown=()=>page.locator(pc?'#meetingList [data-meeting-round]':'#meetingList [data-mrd-meeting]').evaluateAll((els,pc)=>els.map(e=>pc?e.dataset.meetingRound:e.dataset.mrdMeeting),pc);
  const bar=page.locator('#meetingsView .report-week-bar'),label=page.locator('#reportWeekFilter .report-week-label');
  const prev=reportWeekButton(page,'prev'),next=reportWeekButton(page,'next'),all=reportWeekButton(page,'all');
  // 주 줄: 칩 줄 아래, ‹ 라벨(n건) › [전체] 한 줄.
  await expect(bar).toBeVisible();await expect(page.locator('#reportWeekFilter')).toHaveAttribute('role','group');
  await expect(prev).toHaveAttribute('aria-label','이전 주');await expect(next).toHaveAttribute('aria-label','다음 주');
  await expect(all).toHaveText('전체');await expect(all).toHaveAttribute('aria-pressed','false');
  const kindBar=await page.locator('#meetingsView .report-kind-bar').boundingBox(),weekBar=await bar.boundingBox();expect(weekBar.y).toBeGreaterThanOrEqual(kindBar.y+kindBar.height-1);
  const tops=await page.locator('#reportWeekFilter > *').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return Math.round(r.top+r.height/2)}));
  expect(Math.max(...tops)-Math.min(...tops)).toBeLessThanOrEqual(2);
  // 처음: 최근 주(10.19~10.25)의 보고만.
  await expect(label).toHaveText('10.19(월)~10.25(일) 1건');
  await expect.poll(shown).toEqual(['week-new']);
  if(pc){await expect(page.locator('#meetingList [data-meeting-kind="궤도협의회"] .mcol-count')).toHaveText('1');await expect(result(page)).toHaveAttribute('data-meeting-result','week-new')}
  // ‹: 앞 주(10.12~10.18)의 보고만.
  await prev.click();
  await expect(label).toHaveText('10.12(월)~10.18(일) 1건');
  await expect.poll(shown).toEqual(['week-old']);
  if(pc)await expect(result(page)).toHaveAttribute('data-meeting-result','week-old');
  // 보고가 없는 주도 넘길 수 있다(0건, 빈 목록).
  await prev.click();await expect(label).toHaveText('10.5(월)~10.11(일) 0건');await expect.poll(shown).toEqual([]);
  // ›: 다시 뒤 주로.
  await next.click();await next.click();
  await expect(label).toHaveText('10.19(월)~10.25(일) 1건');await expect.poll(shown).toEqual(['week-new']);
  await prev.click();await expect.poll(shown).toEqual(['week-old']);
  // [전체]: 모든 주(최신 위). 주 넘기기는 잠기고 라벨은 '모든 주'.
  await all.click();
  await expect(all).toHaveAttribute('aria-pressed','true');await expect(label).toHaveText('모든 주');
  await expect(prev).toBeDisabled();await expect(next).toBeDisabled();
  await expect.poll(shown).toEqual(['week-new','week-old']);
  if(pc)await expect(page.locator('#meetingList [data-meeting-kind="궤도협의회"] .mcol-count')).toHaveText('2');
  // 다시 누르면 보던 주(10.12~10.18)로.
  await all.click();
  await expect(all).toHaveAttribute('aria-pressed','false');await expect(label).toHaveText('10.12(월)~10.18(일) 1건');
  await expect.poll(shown).toEqual(['week-old']);
  // 다른 곳에서 고른 보고(KPTUMeetingColumns.select)가 지금 주에 없으면 그 보고의 주로 옮긴다.
  await page.evaluate(()=>window.KPTUMeetingColumns.select({id:'week-new'}));
  await expect(label).toHaveText('10.19(월)~10.25(일) 1건');await expect.poll(shown).toEqual(['week-new']);
  if(pc)await expect(result(page)).toHaveAttribute('data-meeting-result','week-new');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
