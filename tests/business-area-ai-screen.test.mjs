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

test('임시저장 칸: readDraft·makeDraft·keepDocsOnly가 area_summaries를 다시 실어 보낸다(모르는·틀린 항목은 버림)', () => {
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

test('고친 줄: withAreaEdit는 그 사업영역만 edited로, 빈 글이면 지움(다음 요청 때 AI 줄)', () => {
  const base = {v:1, base:null, me:'', me_from:'', date:'', rows:[], titles:[], docs:[{id:'f', drop:true}], area_summaries:{[A]:ai('AI 줄'), [B]:ai('B 줄')}};
  const edited = d.withAreaEdit(base, A, '  고친   한 줄 ', 'T');
  assert.deepEqual(edited.area_summaries, {[A]:{text:'고친 한 줄', hash:'', edited:true, at:'T'}, [B]:ai('B 줄')});
  assert.deepEqual(edited.docs, [{id:'f', drop:true}]);
  assert.deepEqual(d.withAreaEdit(edited, A, '', 'T').area_summaries, {[B]:ai('B 줄')});
  assert.deepEqual(d.withAreaEdit(null, A, '새 줄', 'T').area_summaries, {[A]:{text:'새 줄', hash:'', edited:true, at:'T'}});
  assert.throws(() => d.withAreaEdit(base, 'x', '줄'), /area/);
  assert.throws(() => d.withAreaEdit(base, A, '가'.repeat(201)), e => e.code === 'too_long');
});

test('3자 비교: 고친 줄은 칸(area:<id>)으로 묻고, AI 줄은 더 나중 것, 고친 줄을 지웠으면 옛 AI 줄도 두지 않음', () => {
  const base = d.readDraft({v:1, rows:[], titles:[], area_summaries:{[A]:ai('옛 AI', '2026-10-27T00:00:00.000Z')}});
  const theirs = d.readDraft({v:1, rows:[], titles:[], area_summaries:{[A]:ai('새 AI'), [B]:ai('B AI')}});
  const merged = d.merge3(base, base, theirs);
  assert.deepEqual(merged.conflicts, []);
  assert.deepEqual(merged.draft.area_summaries, {[A]:ai('새 AI'), [B]:ai('B AI')});
  // 이 기기가 고친 줄은 서버 AI 줄보다 앞선다.
  const edited = d.withAreaEdit(base, A, '이 기기 고침', 'T1');
  assert.deepEqual(d.merge3(base, edited, theirs).draft.area_summaries[A], {text:'이 기기 고침', hash:'', edited:true, at:'T1'});
  // 양쪽이 다르게 고치면 묻는다(합친 판에는 서버 값).
  const clash = d.merge3(base, edited, d.withAreaEdit(base, A, '다른 기기 고침', 'T2'));
  assert.deepEqual(clash.conflicts, [{cell:`area:${A}`, mine:'이 기기 고침', theirs:'다른 기기 고침'}]);
  assert.equal(clash.draft.area_summaries[A].text, '다른 기기 고침');
  // 한쪽에서 고친 줄을 지움(AI 줄로 되돌리기) → 그 사업영역 줄 없음.
  const back = d.merge3(edited, d.withAreaEdit(edited, A, ''), edited);
  assert.equal(A in (back.draft.area_summaries ?? {}), false);
  // sameDraft는 고친 줄만 본다(AI 줄 차이는 '고친 것 없음').
  assert.equal(d.sameDraft(base, theirs), true);
  assert.equal(d.sameDraft(base, edited), false);
});

test('changeWeekAreaSummary: 다시 읽고 그 사업영역만 바꿔 조건부 쓰기, 다른 칸은 서버 것 그대로, 칸이 없으면 missing', async () => {
  const server = {row:{id:'r', draft:{v:1, base:null, me:'', me_from:'', date:'', rows:[{section:'orgs', key:'가', n:0, lines:['x']}], titles:[], area_summaries:{[B]:ai('B AI')}}, draft_saved_at:'2026-10-27T01:00:00.000Z'}, calls:[]};
  const rt = {context:{read:() => ({workspace:{id:'w'}})}, async api(url, opts = {}) {
    server.calls.push({url, method:opts.method ?? 'GET', body:opts.body});
    if (!opts.method) return [server.row];
    const guard = decodeURIComponent(url.match(/draft_saved_at=eq\.([^&]+)/)?.[1] ?? '');
    if (guard !== server.row.draft_saved_at) return [];
    server.row = {...server.row, ...opts.body}; return [server.row];
  }};
  const r = await d.changeWeekAreaSummary({start:'2026-10-26', areaId:A, text:'고친 줄', now:() => 'T'}, rt);
  assert.equal(r.ok, true);
  assert.deepEqual(server.row.draft.area_summaries, {[B]:ai('B AI'), [A]:{text:'고친 줄', hash:'', edited:true, at:'T'}});
  assert.deepEqual(server.row.draft.rows, [{section:'orgs', key:'가', n:0, lines:['x']}]);
  assert.ok(server.calls.filter(c => c.method === 'PATCH').every(c => !('updated_at' in c.body)));
  const missing = {context:rt.context, async api() { throw Object.assign(new Error('x'), {status:404}); }};
  assert.deepEqual(await d.changeWeekAreaSummary({start:'2026-10-26', areaId:A, text:'x'}, missing), {missing:true});
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

test('summarizeAreaRecords: 한 줄이 있는 사업영역은 보고 줄들 대신 "한 줄 → 이후: 다음 할 일"(겹침 없이), 없으면 그대로', () => {
  const line = x => x.series_name;
  const records = ['2026-10-26', '2026-10-27', '2026-10-28'].flatMap(day => m.weeklyAreaRecords(meetings, day, line).map(r => ({...r, day})));
  assert.equal(m.summarizeAreaRecords(records, meetings, {}), records);
  const out = m.summarizeAreaRecords(records, meetings, {[A]:{text:'가 사업영역 한 줄', edited:false}});
  assert.deepEqual(out.map(r => [r.id, r.text]), [[A, '가 사업영역 한 줄 → 이후: 후속 면담 / 자료 보내기'], [B, '나 회의']]);
});

test('주간보고 ②: 그 주 임시저장의 사업영역 한 줄이 사업영역 줄로(한글 파일·복사도 같은 모델)', () => {
  const empty = ok([]);
  const draft = {v:1, base:null, me:'', me_from:'', date:'', rows:[], titles:[], area_summaries:{[A]:mine('가 한 줄(고침)')}};
  const base = {start:'2026-10-26', lines:new Map(), linesState:'ok', today:'2026-10-28', kinds:{status:'ok', list:[]},
    materials:{basket:ok({notes:[], links:[], docs:[]}), projectUpdates:empty, catalog:ok(tree), meetings:ok(meetings), orgUpdates:ok(Object.assign([], {mine:new Set()}))}};
  const lines = w => w.summary.areas.flatMap(a => a.rows.flatMap(r => r.items.map(weekly.summaryLine)));
  assert.deepEqual(lines(weekly.weeklySummary(base)), ['가상 간담회 → 이후: 후속 면담', '가상 토론회 → 이후: 후속 면담 / 자료 보내기', '나 회의']);
  const w = weekly.weeklySummary({...base, materials:{...base.materials, weekDraft:ok({missing:false, row:{exists:true, draft, saved_at:'x'}})}});
  assert.deepEqual(lines(w), ['가 한 줄(고침) → 이후: 후속 면담 / 자료 보내기', '나 회의']);
});
function ok(items) { return {status:'ok', items}; }

test('화면 연결: 미리보기 AI 한 줄·[고치기]·조용한 실패, 쓰기 창 [AI 추천] 칩(누를 때만), 한글 파일 상자가 칸을 다시 실음 (정적 확인)', () => {
  const preview = read('report-summary-preview.js'), fields = read('business-area-fields.js'), hwpx = read('journal-hwpx.js');
  // 한 주일 때만, 표의 꼬리표 id로 한 번(20개까지), 공용 ai-assist 호출.
  assert.match(preview, /if\(isWeek\(from,to\)&&state\.areas\.size\)void loadAi\(run,records\)/);
  assert.match(preview, /callAiAssist\(\{kind:'area_week_summary',week_start:week,area_ids:ids\}\)/);
  assert.match(preview, /const MAX_AREAS=20;/);
  // 실패·한도: 보고 줄 그대로 + 위 줄 작은 안내, 고친 줄만 임시저장에서.
  assert.match(preview, /· 보고 줄로 보여요`\);return keepEdited\(run,week\)/);
  assert.match(preview, /monthly_limit:'이번 달 AI 한도에 닿았어요',daily_limit:'오늘 AI 횟수를 다 썼어요'/);
  // 고친 줄 저장은 주간 임시저장 칸(결정 ⑤).
  assert.match(preview, /changeWeekAreaSummary\(\{start:week,areaId:id,text\}\)/);
  // 기기 저장 금지는 audit 검사(브라우저 저장소 사용 금지)가 본다.
  // 쓰기 창: 누를 때만 area_suggest, 칩을 눌러야 꼬리표(자동 확정 없음).
  assert.match(fields, /aiBtn\?\.addEventListener\('click',async\(\)=>\{/);
  assert.match(fields, /callAiAssist\(\{kind:'area_suggest',title,text\}\)/);
  assert.match(fields, /onclick:\(\)=>\{area=x\.id;legacy=false;touched=true;clearSugs\(\);void paint\(\)\}/);
  assert.match(read('team.js'), /material:\(\)=>\(\{title:\$\('#meetingTitle'\)\?\.value\|\|'',text:\$\('#meetingTranscript'\)\?\.value\|\|''\}\)/);
  assert.match(read('meeting-round-detail.js'), /material:\(\)=>\(\{title:document\.querySelector\('#mrdEditTitle'\)/);
  // 한글 파일 상자: 읽은 area_summaries를 저장 때 다시 싣는다.
  assert.match(hwpx, /docs:s\.docs \?\? \[\], areas:s\.areas \?\? null,/);
  assert.match(hwpx, /s\.areas = draftAreaSummaries\(merged\);/);
});
