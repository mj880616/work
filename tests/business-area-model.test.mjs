import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// MTG-프로젝트합치기 2단계: 사업 보고 사업영역 꼬리표·다음 할 일 — 규칙(business-area-model.mjs), 주간보고 ② 재료, 미리보기 표, 화면 연결.
// 가짜 이름만 쓴다.
const m = await import('../app/business-area-model.mjs');
const weekly = await import('../app/journal-weekly.js');
const ok = items => ({status:'ok', items});
const tree = [
  {project:{id:'A', name:'사업영역 A'}, depth:0},
  {project:{id:'A1', name:'세부 과제 A-1'}, depth:1},
  {project:{id:'A1x', name:'사안 가'}, depth:2},
  {project:{id:'B', name:'사업영역 B'}, depth:0},
];

test('꼬리표: 직접 단 것이 먼저, 빈 옛 보고는 첫 연결 프로젝트를 화면에서만 빌림(결정 ②)', () => {
  assert.deepEqual(m.shownArea({business_area_id:'A1', project_id:'B'}), {id:'A1', legacy:false});
  assert.deepEqual(m.shownArea({business_area_id:null, project_id:'B'}), {id:'B', legacy:true});
  assert.deepEqual(m.shownArea({}), {id:'', legacy:false});
  assert.equal(m.areaIdOf({project_id:'B'}), '');
});

test('다음 할 일: 줄 나누기·표시 빼기, 1000자 한도, 빈 값은 null', () => {
  assert.deepEqual(m.nextPlanLines('- 면담 잡기\n\n· 자료 보내기 \n• 셋째'), ['면담 잡기', '자료 보내기', '셋째']);
  assert.equal(m.nextPlanValue('  \n '), null);
  assert.equal(m.nextPlanValue(' 한 줄\r\n둘 '), '한 줄\n둘');
  assert.throws(() => m.nextPlanValue('가'.repeat(1001)), /1000자/);
  assert.equal(m.nextPlanValue('가'.repeat(1000)).length, 1000);
});

test('사업영역 경로와 주(서울 월~일)', () => {
  assert.deepEqual(m.areaTrail(tree, 'A1x'), ['사업영역 A', '세부 과제 A-1', '사안 가']);
  assert.equal(m.areaLabel(tree, 'B'), '사업영역 B');
  assert.equal(m.areaLabel(tree, 'none'), '');
  assert.deepEqual(m.weekOf('2026-10-28'), {from:'2026-10-26', to:'2026-11-01'});
  assert.deepEqual(m.weekOf('2026-11-01'), {from:'2026-10-26', to:'2026-11-01'});
  assert.equal(m.shiftDays('2026-10-26', -7), '2026-10-19');
});

const meetings = [
  {id:'r1', series_name:'가상 간담회', meeting_at:'2026-10-05T23:30:00Z', business_area_id:'A1', next_plan:'후속 면담'}, // 서울 10.6
  {id:'r2', series_name:'옛 보고', meeting_at:'2026-10-07T01:00:00Z', business_area_id:null, project_id:'B'},
  {id:'r3', series_name:'사안 회의', meeting_at:'2026-10-08T01:00:00Z', business_area_id:'A1x', next_plan:null},
  {id:'r4', series_name:'다음 주', meeting_at:'2026-10-12T01:00:00Z', business_area_id:'A'},
];

test('미리보기 재료: 기간 안 꼬리표 단 보고만 표로, 안 단 보고는 따로, 세부 내용은 날짜순 전부', () => {
  const p = m.previewRecords(meetings, {from:'2026-10-05', to:'2026-10-11'});
  assert.deepEqual(p.records.map(r => [r.id, r.day, r.text, r.requests, r.meeting]), [['A1', '2026-10-06', '가상 간담회', ['후속 면담'], 'r1'], ['A1x', '2026-10-08', '사안 회의', [], 'r3']]);
  assert.deepEqual(p.untagged.map(x => x.id), ['r2']);
  assert.deepEqual(p.all.map(x => x.id), ['r1', 'r2', 'r3']);
  const placed = weekly.placeRecords(p.records, tree);
  assert.deepEqual(placed.areas.map(a => [a.name, a.rows.map(r => [r.task?.name, r.items.map(weekly.summaryLine)])]),
    [['사업영역 A', [['세부 과제 A-1', ['세부 과제 A-1: 가상 간담회', '세부 과제 A-1 › 사안 가: 사안 회의']]]]]);
});

test('주간보고 ②: 꼬리표 단 사업 보고가 사업영역 줄에 "보고 → 이후: 다음 할 일"로, 옛 보고(꼬리표 빈 것)는 넣지 않음', () => {
  const empty = ok([]);
  const w = weekly.weeklySummary({start:'2026-10-05', lines:new Map(), linesState:'ok', today:'2026-10-06',
    materials:{basket:ok({notes:[], links:[], docs:[]}), projectUpdates:empty, catalog:ok(tree), meetings:ok(meetings), orgUpdates:ok(Object.assign([], {mine:new Set()}))}});
  const lines = w.summary.areas.flatMap(a => a.rows.flatMap(r => r.items.map(weekly.summaryLine)));
  assert.deepEqual(lines, ['세부 과제 A-1: 가상 간담회 → 이후: 후속 면담', '세부 과제 A-1 › 사안 가: 사안 회의']);
  assert.equal(w.summary.count, 2);
  assert.equal(JSON.stringify(w.summary).includes('옛 보고'), false);
  // ③ 회의·활동 결과는 지금처럼 그 주 사업 보고 전부.
  assert.equal(w.meetings.items.length, 3);
});

test('화면 연결: 쓰기 창·고치기 창·보기 면·미리보기·⋯ 사업영역 관리·바구니 문구 (정적 확인)', () => {
  const read = p => readFileSync(new URL(`../app/${p}`, import.meta.url), 'utf8');
  const html = read('index.html'), team = read('team.js'), mrd = read('meeting-round-detail.js'), fields = read('business-area-fields.js');
  assert.match(html, /id="meetingAreaFields"/);
  assert.match(html, /id="reportPreviewBtn"[^>]*>사업요약표 미리보기</);
  assert.match(html, /<details id="reportMore"[^]*?data-report-areas data-view="projects">사업영역 관리</);
  assert.match(team, /activity_kind:entryKind\(\),project_id:projectId,\.\.\.areaBody,/);
  assert.match(team, /openReportPreview\(t,\{meetings:\(\)=>meetings\}\)/);
  assert.match(mrd, /id="mrdEditArea"/); assert.match(mrd, /id="mrdAreaView"/);
  assert.match(mrd, /Object\.assign\(body,await \(mrdAreaFields\?\.body\(\{only:true\}\)/);
  // [할 일로]는 기존 할 일 만들기 길(google-tasks create)만 쓴다(기기 저장 금지는 audit 검사가 본다).
  assert.match(fields, /\/functions\/v1\/google-tasks\?action=create/);
  assert.match(read('basket-manual-link.js'), /data-manual-pick="project"[^>]*>사업영역 꼬리표 달기 ▾</);
  assert.match(read('journal.js'), /show:showDay, showWeek\};/);
  assert.match(read('report-links.js'), /select=business_area_id,next_plan&limit=1/);
});

test('사업영역 칩: 보고가 있는 1단만(트리 순서), 옛 보고는 빌린 꼬리표로, 꼬리표 없음 n', () => {
  const list = [...meetings, {id:'r5', series_name:'아무 데도', meeting_at:'2026-10-09T01:00:00Z'}];
  assert.deepEqual(m.areaChipOptions(list, tree), [{value:'all', label:'전체'}, {value:'A', label:'사업영역 A'}, {value:'B', label:'사업영역 B'}, {value:m.NO_AREA, label:'꼬리표 없음 1'}]);
  const roots = m.areaRoots(tree);
  assert.equal(roots.get('A1x'), 'A');
  assert.deepEqual(list.filter(x => m.matchesAreaChip(x, 'A', roots)).map(x => x.id), ['r1', 'r3', 'r4']);
  assert.deepEqual(list.filter(x => m.matchesAreaChip(x, 'B', roots)).map(x => x.id), ['r2']);
  assert.deepEqual(list.filter(x => m.matchesAreaChip(x, m.NO_AREA, roots)).map(x => x.id), ['r5']);
  assert.equal(list.filter(x => m.matchesAreaChip(x, 'all', roots)).length, 5);
  // 칩·목록 연결(정적): 거르기는 목록·달력·사진·PC 세 칸이 함께 쓰는 reportRows·meetingColumnList 한 곳에서.
  const team = readFileSync(new URL('../app/team.js', import.meta.url), 'utf8');
  // MTG-프로젝트합치기 3단계: [목록] 보기의 주 거르기(weekMatch)가 사업영역 거르기 바깥에 한 겹 더 걸린다(같은 두 곳).
  assert.match(team, /function reportRows\(\)\{return weekMatch\(areaMatch\(filterByReportKind\(meetings,reportChip\)\)\)\}/);
  assert.match(team, /meetingColumns\(weekMatch\(areaMatch\(filterByReportKind\(meetings,DEFAULT_KIND\)\)\)/);
  assert.match(team, /resetPrivateState\(\)\{reportChip=DEFAULT_KIND;areaChip='all';reportWeek=null;reportWeekAll=false;areaTree=null;/);
});
