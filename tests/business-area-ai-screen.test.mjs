import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// MTG-프로젝트합치기 사업영역 AI 화면 연결(docs/design/project-into-report.md 13절): 주간 임시저장 area_summaries 칸(결정 ⑤),
// 주간보고 ② 한 줄, 미리보기·쓰기 창 연결. 가짜 이름·가짜 id만 쓴다.
const d = await import('../app/weekly-draft-store.js');
const m = await import('../app/business-area-model.mjs');
const weekly = await import('../app/journal-weekly.js');
const read = p => readFileSync(new URL(`../app/${p}`, import.meta.url), 'utf8');
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const HASH = 'a1:' + '0'.repeat(32);
const ai = (text, at = '2026-10-28T01:00:00.000Z') => ({text, hash:HASH, edited:false, at});
const mine = (text, at = '2026-10-28T02:00:00.000Z') => ({text, hash:'', edited:true, at});

test('임시저장 칸(저장된 값 보존): readDraft·makeDraft·keepDocsOnly가 area_summaries를 다시 실어 보낸다(모르는·틀린 항목은 버림)', () => {
  const raw = {v:1, base:null, me:'', me_from:'', date:'', rows:[], titles:[], area_summaries:{[A]:ai('가상 한 줄'), [B.toUpperCase()]:mine('고친 줄'), 'not-a-uuid':ai('x'), [crypto.randomUUID()]:{text:''}}};
  const r = d.readDraft(raw);
  assert.deepEqual(r.area_summaries, {[A]:ai('가상 한 줄'), [B]:mine('고친 줄')});
  assert.deepEqual(d.makeDraft({areas:r.area_summaries}).area_summaries, r.area_summaries);
  assert.equal('area_summaries' in d.makeDraft({}), false);
  // [처음부터]: 상자 칸은 비우되 사업영역 줄은 남김.
  assert.deepEqual(d.keepDocsOnly({...r, rows:[{section:'orgs', key:'k', n:0, lines:['x']}]}), {v:1, base:null, me:'', me_from:'', date:'', rows:[], titles:[], area_summaries:r.area_summaries});
  // 상자에서 고친 것이 아니므로 이어 쓰기 판단(hasContent)에는 들어가지 않는다.
  assert.equal(d.hasContent(r), false);
  // 고친 줄의 hash는 비우고, 200자 넘는 줄은 버린다.
  assert.deepEqual(d.draftAreaSummaries({area_summaries:{[A]:{text:'x', hash:HASH, edited:true, at:''}, [B]:{text:'가'.repeat(201)}}}), {[A]:{text:'x', hash:'', edited:true, at:''}});
});

test('3자 비교(저장된 값 보존): 고친 줄은 칸(area:<id>)으로 묻고, AI 줄은 더 나중 것, 고친 줄을 지웠으면 옛 AI 줄도 두지 않음', () => {
  const base = d.readDraft({v:1, rows:[], titles:[], area_summaries:{[A]:ai('옛 AI', '2026-10-27T00:00:00.000Z')}});
  const theirs = d.readDraft({v:1, rows:[], titles:[], area_summaries:{[A]:ai('새 AI'), [B]:ai('B AI')}});
  const merged = d.merge3(base, base, theirs);
  assert.deepEqual(merged.conflicts, []);
  assert.deepEqual(merged.draft.area_summaries, {[A]:ai('새 AI'), [B]:ai('B AI')});
  // 이 기기가 고친 줄은 서버 AI 줄보다 앞선다.
  const edit = (draft, id, text, at) => d.readDraft({...draft, area_summaries:{...draft.area_summaries, ...(text ? {[id]:{text, hash:'', edited:true, at}} : {})}});
  const edited = edit(base, A, '이 기기 고침', 'T1');
  assert.deepEqual(d.merge3(base, edited, theirs).draft.area_summaries[A], {text:'이 기기 고침', hash:'', edited:true, at:'T1'});
  // 양쪽이 다르게 고치면 묻는다(합친 판에는 서버 값).
  const clash = d.merge3(base, edited, edit(base, A, '다른 기기 고침', 'T2'));
  assert.deepEqual(clash.conflicts, [{cell:`area:${A}`, mine:'이 기기 고침', theirs:'다른 기기 고침'}]);
  assert.equal(clash.draft.area_summaries[A].text, '다른 기기 고침');
  // 한쪽에서 고친 줄을 지움(AI 줄로 되돌리기) → 그 사업영역 줄 없음.
  const back = d.merge3(edited, d.readDraft({...edited, area_summaries:{}}), edited);
  assert.equal(A in (back.draft.area_summaries ?? {}), false);
  // sameDraft는 고친 줄만 본다(AI 줄 차이는 '고친 것 없음').
  assert.equal(d.sameDraft(base, theirs), true);
  assert.equal(d.sameDraft(base, edited), false);
});

const tree = [
  {project:{id:A, name:'사업영역 가'}, depth:0},
  {project:{id:B, name:'사업영역 나'}, depth:0},
];
const meetings = [
  {id:'r1', series_name:'가상 간담회', meeting_at:'2026-10-26T01:00:00Z', business_area_id:A, next_plan:'후속 면담'},
  {id:'r2', series_name:'가상 토론회', meeting_at:'2026-10-27T01:00:00Z', business_area_id:A, next_plan:'- 후속 면담\n자료 보내기'},
  {id:'r3', series_name:'나 회의', meeting_at:'2026-10-28T01:00:00Z', business_area_id:B, next_plan:null},
];

test('주간보고 ②(S49-39): 저장된 사업영역 한 줄(AI·고친 줄)은 더 이상 요약 줄을 바꾸지 않는다 — 데이터는 두고 화면에서만 보이지 않음', () => {
  const empty = ok([]);
  const draft = {v:1, base:null, me:'', me_from:'', date:'', rows:[], titles:[], area_summaries:{[A]:mine('가 한 줄(고침)')}};
  const base = {start:'2026-10-26', lines:new Map(), linesState:'ok', today:'2026-10-28', kinds:{status:'ok', list:[]},
    materials:{basket:ok({notes:[], links:[], docs:[]}), projectUpdates:empty, catalog:ok(tree), meetings:ok(meetings), orgUpdates:ok(Object.assign([], {mine:new Set()}))}};
  const lines = w => w.summary.areas.flatMap(a => a.rows.flatMap(r => r.items.map(weekly.summaryLine)));
  assert.deepEqual(lines(weekly.weeklySummary(base)), ['가상 간담회 → 이후: 후속 면담', '가상 토론회 → 이후: 후속 면담 / 자료 보내기', '나 회의']);
  const w = weekly.weeklySummary({...base, materials:{...base.materials, weekDraft:ok({missing:false, row:{exists:true, draft, saved_at:'x'}})}});
  assert.deepEqual(lines(w), ['가상 간담회 → 이후: 후속 면담', '가상 토론회 → 이후: 후속 면담 / 자료 보내기', '나 회의']);
});
function ok(items) { return {status:'ok', items}; }

test('화면 연결(S49-39): 미리보기·주간 정리에 AI 한 줄이 없다, 서버 호출 삭제, 쓰기 창 [AI 추천]·저장된 값 보존은 그대로', () => {
  const preview = read('report-summary-preview.js'), fields = read('business-area-fields.js'), hwpx = read('journal-hwpx.js');
  for (const gone of ['area_week_summary', 'callAiAssist', 'loadAi', 'keepEdited', '(고침)', 'changeWeekAreaSummary', 'basket-ai-summary']) assert.equal(preview.includes(gone) && !preview.split('\n').filter(l => l.includes(gone)).every(l => l.trim().startsWith('//')), false, gone);
  assert.equal(read('journal-weekly.js').includes('summarizeAreaRecords'), false);
  assert.equal(d.withAreaEdit, undefined);
  assert.equal(d.changeWeekAreaSummary, undefined);
  assert.equal(m.summarizeAreaRecords, undefined);
  // 쓰기 창: 누를 때만 area_suggest, 칩을 눌러야 꼬리표(자동 확정 없음).
  assert.match(fields, /aiBtn\?\.addEventListener\('click',async\(\)=>\{/);
  assert.match(fields, /callAiAssist\(\{kind:'area_suggest',title,text\}\)/);
  assert.match(fields, /onclick:\(\)=>\{clearSugs\(\);pickArea\(x\.id\)\}/);
  assert.match(read('team.js'), /material:\(\)=>\(\{title:\$\('#meetingTitle'\)\?\.value\|\|'',text:\$\('#meetingTranscript'\)\?\.value\|\|''\}\)/);
  assert.match(read('meeting-round-detail.js'), /material:\(\)=>\(\{title:document\.querySelector\('#mrdEditTitle'\)/);
  // 한글 파일 상자: 읽은 area_summaries를 저장 때 다시 싣는다(데이터 보존).
  assert.match(hwpx, /docs:s\.docs \?\? \[\], areas:s\.areas \?\? null,/);
  assert.match(hwpx, /s\.areas = draftAreaSummaries\(merged\);/);
  // 서버: 호출·표 모두 삭제(kind 이름은 설명 글에만 남음).
  const handler = readFileSync(new URL('../supabase/functions/ai-assist/handler.ts', import.meta.url), 'utf8');
  assert.equal(handler.split('\n').filter(l => l.includes('area_week_summary') && !l.trim().startsWith('//')).length, 0);
});
