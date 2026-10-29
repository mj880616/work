import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// MTG-한줄업데이트(요청함 10/29 08:59, 명진 09:01 '추천대로'): 사업 보고 [+] 메뉴 맨 위 [한 줄 업데이트] — 저장 몸통, 칸·칩,
// 주간보고 ② 사업 요약 표(문장 그대로, AI 한 줄보다 먼저)·③ 회의·활동 결과 제외, 미리보기. 가짜 이름·가짜 id만 쓴다.
const model = await import('../app/report-oneline-model.mjs');
const kinds = await import('../app/report-kinds.mjs');
const m = await import('../app/business-area-model.mjs');
const weekly = await import('../app/journal-weekly.js');
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const LINE = '가상 산안법 개정은 단기 접근이 어려워 연구·토론으로 요구안을 먼저 정돈하기로 함';

test('저장 몸통: 칸 oneline·꼬리표·서울 0시·제목=한 줄·다음 할 일, 빠진 칸은 화면 글자', () => {
  const body = model.onelineBody({workspaceId:'w', userId:'u', areaId:A, day:'2026-10-29', text:` ${LINE}\n `, plan:'- 토론회 날짜 잡기', now:new Date('2026-10-29T02:00:00Z')});
  assert.deepEqual(body, {workspace_id:'w', activity_kind:'oneline', project_id:null, business_area_id:A, next_plan:'- 토론회 날짜 잡기', title:LINE, series_name:LINE,
    round_no:null, meeting_at:'2026-10-28T15:00:00.000Z', notes:'', transcript_text:'', result_status:'final', finalized_at:'2026-10-29T02:00:00.000Z', created_by:'u'});
  assert.equal(model.onelineBody({workspaceId:'w', userId:'u', areaId:A, day:'2026-10-29', text:'x', plan:'  '}).next_plan, null);
  assert.equal(model.onelineText('가\n\n나   다'), '가 나 다');
  assert.throws(() => model.onelineText('가'.repeat(model.ONELINE_MAX + 1)), {code:'too_long'});
  assert.equal(model.onelineMissing({areaId:'', day:'2026-10-29', text:'x'}), '사업영역을 골라 주세요.');
  assert.equal(model.onelineMissing({areaId:A, day:'', text:'x'}), '날짜를 골라 주세요.');
  assert.equal(model.onelineMissing({areaId:A, day:'2026-10-29', text:'  '}), '한 줄을 써 주세요.');
  assert.equal(model.onelineMissing({areaId:A, day:'2026-10-29', text:'x'}), '');
  assert.equal(model.onelineAt('2026-13-45x'), '');
});

test('칸: oneline은 [한 줄]로 보이고 여덟 칸 고르기에는 없다, [한 줄] 칩은 한 줄 업데이트가 있을 때만', () => {
  assert.equal(kinds.reportKindOf({activity_kind:'oneline'}), 'oneline');
  assert.equal(kinds.reportKindLabel('oneline'), '한 줄');
  assert.equal(kinds.isReportKind('oneline'), false);
  assert.equal(kinds.REPORT_KINDS.length, 8);
  assert.equal(kinds.isReportChip('oneline'), true);assert.equal(kinds.isReportChip('all'), true);assert.equal(kinds.isReportChip('x'), false);
  assert.deepEqual(kinds.reportKindChips().map(c => c.label), ['전체','회의','정책','교섭','언론','국회','투쟁','교육','기타']);
  assert.deepEqual(kinds.reportKindChips([{activity_kind:'oneline'}]).map(c => c.label).at(-1), '한 줄');
  assert.deepEqual(kinds.filterByReportKind([{id:1, activity_kind:'oneline'}, {id:2}], 'oneline').map(r => r.id), [1]);
  // DB 검사(20261029160000)와 같은 값.
  assert.match(read('supabase/migrations/20261029160000_bizreport_oneline_kind.sql'), /'education', 'other', 'oneline'\)\);/);
});

const tree = [{project:{id:A, name:'사업영역 가'}, depth:0}, {project:{id:B, name:'사업영역 나'}, depth:0}];
const meetings = [
  {id:'r1', series_name:'가상 간담회', title:'가상 간담회', activity_kind:'meeting', meeting_at:'2026-10-26T01:00:00Z', business_area_id:A, next_plan:'후속 면담'},
  {id:'o1', series_name:LINE, title:LINE, activity_kind:'oneline', meeting_at:'2026-10-28T15:00:00Z', business_area_id:A, next_plan:'토론회 날짜 잡기'},
  {id:'r3', series_name:'나 회의', title:'나 회의', activity_kind:'meeting', meeting_at:'2026-10-28T01:00:00Z', business_area_id:B, next_plan:null},
];
const ok = items => ({status:'ok', items});
const days = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29'];

test('주간보고 ② 재료: 한 줄 업데이트는 문장 그대로(칸 글자·시각 없음) + 이후, AI 한 줄로 바꾸지 않는다', () => {
  const line = x => `[칸] ${x.series_name}`;
  const records = days.flatMap(day => m.weeklyAreaRecords(meetings, day, line).map(r => ({...r, day})));
  assert.deepEqual(records.map(r => r.text), ['[칸] 가상 간담회 → 이후: 후속 면담', '[칸] 나 회의', `${LINE} → 이후: 토론회 날짜 잡기`]);
  const out = m.summarizeAreaRecords(records, meetings, {[A]:{text:'가 AI 한 줄', edited:false}});
  // AI 한 줄의 '이후'는 한 줄 업데이트의 다음 할 일을 다시 싣지 않는다(한 줄 업데이트 줄에 이미 있음).
  assert.deepEqual(out.map(r => r.text), ['가 AI 한 줄 → 이후: 후속 면담', '[칸] 나 회의', `${LINE} → 이후: 토론회 날짜 잡기`]);
  // 같은 칸이면 한 줄 업데이트가 먼저(날짜가 늦어도).
  const placed = weekly.placeRecords(out, tree);
  assert.deepEqual(placed.areas[0].rows[0].items.map(i => i.text), [`${LINE} → 이후: 토론회 날짜 잡기`, '가 AI 한 줄 → 이후: 후속 면담']);
});

test('주간보고 화면 모델: ② 사업 요약 표에 문장 그대로, ③ 회의·활동 결과에는 없다', () => {
  const base = {start:'2026-10-26', lines:new Map(), linesState:'ok', today:'2026-10-29', kinds:{status:'ok', list:[]},
    materials:{basket:ok({notes:[], links:[], docs:[]}), projectUpdates:ok([]), catalog:ok(tree), meetings:ok(meetings), orgUpdates:ok(Object.assign([], {mine:new Set()}))}};
  const w = weekly.weeklySummary(base);
  const lines = w.summary.areas.flatMap(a => a.rows.flatMap(r => r.items.map(weekly.summaryLine)));
  assert.deepEqual(lines, [`${LINE} → 이후: 토론회 날짜 잡기`, '가상 간담회 → 이후: 후속 면담', '나 회의']);
  assert.equal(w.meetings.items.some(i => i.text.includes(LINE)), false);
  assert.equal(w.meetings.items.length, 2);
});

test('미리보기 재료: 한 줄 업데이트는 표의 칸에(oneline·first), 2) 세부 내용 목록에서는 빠진다', () => {
  const {records, all} = m.previewRecords(meetings, {from:'2026-10-26', to:'2026-11-01', lineOf:x => `줄 ${x.series_name}`});
  const one = records.find(r => r.meeting === 'o1');
  assert.equal(one.text, LINE);assert.equal(one.oneline, true);assert.equal(one.first, true);
  assert.deepEqual(one.requests, ['토론회 날짜 잡기']);
  assert.deepEqual(all.map(x => x.id), ['r1', 'r3']);
});

test('화면 연결(정적 확인): [+] 메뉴 맨 위 줄, [한 줄] 칩의 [+], 창의 칸·저장 경로, 기기 저장 없음', () => {
  const sheet = read('app/report-kind-sheet.js'), team = read('app/team.js'), ui = read('app/report-oneline.js'), preview = read('app/report-summary-preview.js');
  assert.match(sheet, /html:\(active\?\.onOneline\?ONELINE_ROW:''\)\+REPORT_KINDS\.map/);
  assert.match(sheet, /data-report-oneline title="사업영역에 진행 상황 한 줄"><span class="home-choice-check" aria-hidden="true">✎<\/span><span class="home-choice-name">한 줄 업데이트<\/span>/);
  assert.doesNotMatch(sheet.match(/const ONELINE_ROW=`[^`]*`/)[0], /data-sheet-value/);
  assert.match(team, /function newReport\(trigger\)\{if\(reportChip===ONELINE_KIND\)\{openOnelineEntry\(trigger\);return\}/);
  assert.match(team, /onOneline:\(\)=>openOnelineEntry\(trigger\)/);
  assert.match(ui, /type="date" class="oneline-day" data-ol-day/);
  assert.match(ui, /<details class="biz-next-plan" data-ol-plan-box><summary>\+ 다음 할 일/);
  assert.match(ui, /rt\.api\('\/rest\/v1\/app_meetings',\{method:'POST',body,prefer:'return=representation'\}\)/);
  assert.match(ui, /saveReportTargets\(row,\[\{kind:'project',id:body\.business_area_id\},\.\.\.\(state\?\.orgs\|\|\[\]\)\]\)/);
  assert.match(preview, /if\(p\.rec\?\.oneline\)\{ones\.push\(p\);continue\}/);
});
