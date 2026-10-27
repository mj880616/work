// MTG-고치기바로(명진 2026-10-27): PC 사업 보고 세 번째 칸이 읽는 화면 겸 고치는 화면이다.
// 사업 보고 창 요소 하나를 팝업과 세 번째 칸 사이에서 옮겨 붙인다(두 번 그리지 않음). 같은 입력칸·같은 저장 함수를 쓴다.
// 이 시험은 소스 구조(붙임·저장 단일 경로·정리된 옛 길)를 지킨다. 화면 동작은 app-e2e의 meeting-columns·report-kinds·meeting-entry가 본다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=p=>readFileSync(new URL(`../app/${p}`,import.meta.url),'utf8');
const detail=src('meeting-round-detail.js'),team=src('team.js'),columns=src('meeting-columns.js'),css=src('meeting-ui.css');

test('고치는 화면은 하나: 저장 함수 mrdSaveEdit 하나, 입력칸 id 한 벌',()=>{
  assert.equal((detail.match(/async function mrdSaveEdit\(/g)||[]).length,1);
  assert.equal((detail.match(/id="mrdEditTitle"/g)||[]).length,1);
  assert.equal((detail.match(/id="mrdSaveEdit"/g)||[]).length,1);
  // 세 번째 칸에는 따로 그린 입력칸이 없다.
  assert.doesNotMatch(team,/mrdEdit|mrdSaveEdit/);
});

test('칸 배치: 제목 / 차수 | 짧은 이름 / 일시 | 장소 / 연결할 곳',()=>{
  const at=id=>detail.indexOf(`id="${id}"`);
  const order=['mrdEditTitle','mrdEditRound','mrdEditShortName','mrdEditAt','mrdEditLocation','mrdEditPlaces'].map(at);
  assert.ok(order.every(i=>i>0),'칸 id가 모두 있다');
  assert.deepEqual([...order].sort((a,b)=>a-b),order,'위에서 아래, 왼쪽에서 오른쪽 순서');
  assert.equal((detail.match(/<div class="two-col">/g)||[]).length,2);
});

test('세 번째 칸 붙임: dock/undock을 내보내고 team.js가 다시 그리기 전에 떼고 뒤에 붙인다',()=>{
  assert.match(detail,/window\.KPTUMeetingRoundDetail=\{[^}]*dock:mrdDock[^}]*undock:mrdUndock[^}]*guardLeave:mrdGuardLeave/);
  assert.match(team,/function undockReport\(/);assert.match(team,/function dockReport\(/);
  const top=team.slice(team.indexOf('function renderMeetings(')),draw=team.slice(team.indexOf('function renderMeetingColumns('));
  assert.ok(top.indexOf('undockReport()')>0&&top.indexOf('undockReport()')<top.indexOf('renderMeetingColumns('),'다시 그리기 전에 뗀다');
  assert.ok(draw.indexOf('box.innerHTML=columnsHtml(')<draw.indexOf('dockReport()'),'다시 그린 뒤에 붙인다');
});

test('옛 읽기 전용 세 번째 칸과 따로 있던 ⋯ 메뉴는 없다(기능은 사업 보고 창 요소 하나가 가진다)',()=>{
  for(const gone of ['mcolMenu','data-meeting-more','changeReportKind','mountMeetingPhotos','downloadMeetingDocument'])assert.ok(!team.includes(gone),`team.js에 ${gone}`);
  for(const gone of ['resultHtml(','tasksHtml(','resultText('])assert.ok(!columns.includes(`function ${gone}`)&&!columns.includes(`export function ${gone}`),`meeting-columns.js에 ${gone}`);
  // 후속 할 일·사진·회의자료 추가·삭제는 붙은 요소 안에 그대로 있다.
  for(const id of ['mrdAddTask','mrdTasks','mrdPickPhotos','mrdPhotos','mrdPickFiles','mrdMaterials','mrdMakeTodos'])assert.ok(detail.includes(`id="${id}"`),id);
  for(const act of ['edit','kind','delete'])assert.ok(detail.includes(`data-mrd-more="${act}"`),act);
});

test('고친 내용이 있을 때 다른 곳을 누르면 그 자리 한 줄 안내([저장] [버리기])',()=>{
  assert.match(detail,/id="mrdLeave"[^>]*><span>고친 내용을 저장할까요\?<\/span><button id="mrdLeaveSave"[^>]*>저장<\/button><button id="mrdLeaveDiscard"[^>]*>버리기<\/button>/);
  assert.match(team,/function leaveReport\(/);
  // 칸·차수·보기 바꾸기 길이 모두 같은 지킴이를 거친다.
  for(const fn of ['selectReportView','selectReportChip','selectMeetingKind','selectMeetingRound'])assert.match(team,new RegExp(`leaveReport\\([^)]*\\)[\\s\\S]{0,400}${fn}|${fn}[\\s\\S]{0,200}leaveReport`),fn);
});

test('폰: 같은 창이 고치는 화면으로 바뀌고 뒤로가기는 고치는 화면 → 보는 화면',()=>{
  assert.match(detail,/kptuMrdEdit/);assert.match(detail,/addEventListener\('popstate'/);
  assert.match(detail,/mrdSetEdit\(/);
});

test('세 번째 칸 고치는 중 [취소][저장]은 맨 위 오른쪽의 작은 단추',()=>{
  assert.match(css,/\.mrd-docked \.mrd-head-ends \.mrd-editor-actions button\{[^}]*height:var\(--ds-compact-height/);
  assert.match(detail,/mrdSaveLabel=\(\)=>mrdDocked\?'저장':'수정 저장'/);
});
