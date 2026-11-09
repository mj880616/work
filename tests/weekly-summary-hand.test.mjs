import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// WEEKLY-요약표수기(S49-39): 사업요약표 미리보기·HWP·홈 주간 정리가 같은 값을 읽고, 내부 정례 회의는 어느 길에도 안 나오고, 진행/담당은 직접 쓴 값이 그대로 들어간다.
// 가상 이름만 쓴다(실제 조직·사람·보고 내용 없음).
const h = await import('../app/weekly-summary-hand.mjs');
const d = await import('../app/weekly-draft-store.js');
const m = await import('../app/business-area-model.mjs');
const weekly = await import('../app/journal-weekly.js');
const kinds = await import('../app/journal-meeting-kinds.js');
const hwpx = await import('../app/weekly-hwpx/draft.mjs');
const read = p => readFileSync(new URL(`../app/${p}`, import.meta.url), 'utf8');
const A = '11111111-1111-4111-8111-111111111111', T1 = '33333333-3333-4333-8333-333333333333', T2 = '44444444-4444-4444-8444-444444444444';

test('칸 이름 맞추기: 사업영역·세부 과제가 맞는 칸 → 없으면 그 사업영역의 세부 과제 없는 칸 → 없으면 새 이름(띄어쓰기·가운뎃점 무시)', () => {
  const keys = ['가 사업›과제 일', '가 사업›', '나 사업›과제 이'];
  assert.equal(h.summaryCellKey(keys, '가 사업', '과제일'), '가 사업›과제 일');
  assert.equal(h.summaryCellKey(keys, '가사업', '없는 과제'), '가 사업›');
  assert.equal(h.summaryCellKey(keys, '가 사업', ''), '가 사업›');
  assert.equal(h.summaryCellKey(keys, '다 사업', '과제'), '다 사업›과제');
  assert.equal(h.summaryCellKey([], '다 사업', ''), '다 사업›');
  assert.equal(h.summaryCellKey(['나‧사업›x'], '나·사업', 'x'), '나‧사업›x');
});

test('담당 규칙: 한 줄·60자·칸 이름 모양만, 빈 글이면 지움', () => {
  assert.deepEqual(h.readOwners({'가›나': ' 가상  이름 ', '모양없음': 'x', '다›': '', '라›': '가'.repeat(61)}), {'가›나': '가상 이름'});
  assert.deepEqual(h.readOwners(null), {});
  assert.deepEqual(h.withOwner({'가›나': 'A'}, '가›나', 'B'), {'가›나': 'B'});
  assert.deepEqual(h.withOwner({'가›나': 'A'}, '가›나', ''), {});
  assert.throws(() => h.withOwner({}, '가›나', '가'.repeat(61)), e => e.code === 'too_long');
  assert.throws(() => h.withOwner({}, '모양없음', 'x'), e => e.code === 'cell');
});

const baseDraft = () => d.readDraft({v:1, base:null, me:'', me_from:'', date:'', rows:[], titles:[]});

test('진행 칸 직접 쓰기: 홈 [주간 정리] 1) 요약과 같은 칸(summary 칸)에 줄로 저장 — 한 곳에 쓰면 두 곳이 같다', () => {
  const draft = d.withSummaryText(baseDraft(), {area:'가 사업', task:'과제 일', text:'첫째 진행\n- 둘째 진행\n\n'});
  assert.deepEqual(draft.rows, [{section:'summary', key:'가 사업›과제 일', n:0, lines:['- 첫째 진행', '- 둘째 진행']}]);
  // 홈이 읽는 같은 함수(weekCells/flowCells 재료)로 같은 줄이 보인다.
  assert.deepEqual(d.cellVisibleLines(draft, {section:'summary', key:'가 사업›과제 일'}), ['- 첫째 진행', '- 둘째 진행']);
  // 사업영역만 있는 줄(보고 없음)에도 쓸 수 있다.
  const only = d.withSummaryText(draft, {area:'나 사업', task:'', text:'아직 보고 없음'});
  assert.ok(only.rows.some(r => r.key === '나 사업›' && r.lines[0] === '- 아직 보고 없음'));
  // 이름이 비슷하면 홈에 이미 있는 칸에 쓴다(새 칸을 만들지 않음).
  const again = d.withSummaryText(draft, {area:'가사업', task:'과제일', text:'고침'});
  assert.equal(again.rows.length, 1);
  assert.deepEqual(again.rows[0].lines, ['- 고침']);
  assert.throws(() => d.withSummaryText(baseDraft(), {area:'가', task:'나', text:'가'.repeat(d.CELL_LINE_MAX + 1)}), e => e.code === 'too_long');
  // 원본은 바뀌지 않는다.
  assert.deepEqual(baseDraft().rows, []);
});

test('담당 칸 저장: owners 는 readDraft·makeDraft·keepDocsOnly·merge3 에서 보존되고 칸마다 3자 비교', () => {
  const mine = d.withOwnerEdit(baseDraft(), '가 사업›과제 일', '가상 담당');
  assert.deepEqual(mine.owners, {'가 사업›과제 일': '가상 담당'});
  assert.deepEqual(d.readDraft(mine).owners, mine.owners);
  assert.deepEqual(d.makeDraft({owners:d.draftOwners(mine)}).owners, mine.owners);
  assert.equal('owners' in d.makeDraft({}), false);
  assert.deepEqual(d.keepDocsOnly(mine).owners, mine.owners);
  assert.equal(d.hasContent(d.readDraft(mine)), false);
  const theirs = d.withOwnerEdit(baseDraft(), '나 사업›', '다른 담당');
  const merged = d.merge3(baseDraft(), mine, theirs);
  assert.deepEqual(merged.conflicts, []);
  assert.deepEqual(merged.draft.owners, {'가 사업›과제 일': '가상 담당', '나 사업›': '다른 담당'});
  const clash = d.merge3(baseDraft(), mine, d.withOwnerEdit(baseDraft(), '가 사업›과제 일', '충돌 담당'));
  assert.deepEqual(clash.conflicts, [{cell:'owner:가 사업›과제 일', mine:'가상 담당', theirs:'충돌 담당'}]);
  assert.deepEqual(d.withOwnerEdit(mine, '가 사업›과제 일', '').owners, undefined);
});

test('저장 쓰기: 다시 읽고 그 칸만 바꿔 조건부 쓰기(다른 칸은 서버 것 그대로), 칸이 없으면 missing', async () => {
  const server = {row:{id:'r', draft:{v:1, base:null, me:'', me_from:'', date:'', rows:[{section:'orgs', key:'x', n:0, lines:['다른 칸']}], titles:[], docs:[{id:'f', drop:true}], area_summaries:{[A]:{text:'옛 AI 값', hash:'', edited:false, at:''}}}, draft_saved_at:'2026-11-02T00:00:00.000Z'}, calls:[]};
  const rt = {context:{read:() => ({workspace:{id:'w'}})}, async api(url, opts = {}) {
    server.calls.push({url, method:opts.method ?? 'GET', body:opts.body});
    if (!opts.method) return [server.row];
    const guard = decodeURIComponent(url.match(/draft_saved_at=eq\.([^&]+)/)?.[1] ?? '');
    if (guard !== server.row.draft_saved_at) return [];
    server.row = {...server.row, ...opts.body}; return [server.row];
  }};
  const r = await d.changeWeekSummaryText({start:'2026-11-02', area:'가 사업', task:'과제 일', text:'직접 씀'}, rt);
  assert.equal(r.ok, true);
  assert.deepEqual(server.row.draft.docs, [{id:'f', drop:true}]);
  assert.deepEqual(server.row.draft.rows.map(x => `${x.section}:${x.key}`).sort(), ['orgs:x', 'summary:가 사업›과제 일']);
  assert.ok(server.row.draft.area_summaries[A], '예전에 저장된 AI 값은 지우지 않고 그대로 둔다');
  const o = await d.changeWeekOwner({start:'2026-11-02', area:'가 사업', task:'과제 일', text:'가상 담당'}, rt);
  assert.equal(o.ok, true);
  assert.deepEqual(server.row.draft.owners, {'가 사업›과제 일': '가상 담당'});
  assert.ok(server.calls.filter(c => c.method === 'PATCH').every(c => !('updated_at' in c.body)));
  const missing = {context:rt.context, async api() { throw Object.assign(new Error('x'), {status:404}); }};
  assert.deepEqual(await d.changeWeekSummaryText({start:'2026-11-02', area:'가', task:'나', text:'x'}, missing), {missing:true});
});

test('한글 파일: 담당 칸에 직접 쓴 글이 그대로(고치지 않음), 진행 칸은 같은 칸 줄 그대로', () => {
  const base = {summary:[{area:['가 사업'], rows:[{task:['과제 일'], progress:['- 옛 진행'], paras:[], owner:['원래 담당']}, {task:null, progress:[], paras:[], owner:null}]}], orgs:[], sites:[]};
  const out = hwpx.assembleDraft(base, {summary:new Map([[0, ['- 직접 쓴 진행']]]), owners:new Map([[0, '가상 담당 A / 가상 담당 B']])});
  assert.deepEqual(out.summary[0].rows[0].owner, ['가상 담당 A / 가상 담당 B']);
  assert.deepEqual(out.summary[0].rows[0].progress.map(l => l.text ?? l), ['- 직접 쓴 진행']);
  // 담당을 안 쓴 줄은 바탕 그대로, 빈 글은 무시.
  const keep = hwpx.assembleDraft(base, {owners:new Map([[0, '  ']])});
  assert.deepEqual(keep.summary[0].rows[0].owner, ['원래 담당']);
  assert.deepEqual(base.summary[0].rows[0].owner, ['원래 담당'], '원본은 그대로');
});

test('미리보기 표 줄: 보고가 없는 사업영역·세부 과제 줄도 트리 차례대로 나온다', () => {
  const tree = [{project:{id:A, name:'가 사업'}, depth:0}, {project:{id:T1, name:'과제 일'}, depth:1}, {project:{id:T2, name:'과제 이'}, depth:1}, {project:{id:'55555555-5555-4555-8555-555555555555', name:'보고 없는 사업'}, depth:0}];
  const placed = [{id:A, name:'가 사업', rows:[{task:{id:T2, name:'과제 이'}, items:[{day:'2026-11-03', text:'가상 보고'}], folded:[], dropped:[]}]}];
  const out = m.fullTable(placed, tree);
  assert.deepEqual(out.map(a => [a.name, a.rows.map(r => r.task?.name ?? null)]), [['가 사업', ['과제 일', '과제 이']], ['보고 없는 사업', [null]]]);
  assert.equal(out[0].rows[1].items.length, 1, '있던 보고는 그대로');
  assert.equal(placed[0].rows.length, 1, '원본은 그대로');
  assert.deepEqual(m.fullTable(placed, null), placed);
});

// ---- 내부 정례 회의: 길마다 같은 한 곳(reportsMeeting)을 읽는다 ----
const INTERNAL = ['노조 상집 45차', '노조 중집', '본부 집행위 42차', '궤도 집행국 회의 40차'];
const mk = (id, name, day, extra = {}) => ({id, series_name:name, title:name, meeting_at:`2026-11-0${day}T01:00:00Z`, business_area_id:A, project_id:null, next_plan:'후속', ...extra});
const meetings = [...INTERNAL.map((n, i) => mk(`i${i}`, n, 2 + (i % 3))), mk('ok1', '가상 간담회', 3), mk('hid', '가상 늘 빼는 종류', 4)];
const ok = items => ({status:'ok', items});

test('내부 정례 회의는 목록을 못 읽어도 빠지고, 늘 빼기로 정한 종류도 같은 한 곳에서 빠진다', () => {
  for (const name of INTERNAL) assert.equal(kinds.reportsMeeting({series_name:name}, null), false, name);
  assert.equal(kinds.reportsMeeting({series_name:'가상 간담회'}, null), true);
  assert.equal(kinds.reportsMeeting({series_name:'가상 늘 빼는 종류'}, [kinds.meetingKindKey('가상 늘 빼는 종류')]), false);
});

test('홈 주간 정리: 사업 요약 줄·회의·활동 결과 어디에도 내부 정례 회의와 늘 빼는 종류가 없다', () => {
  const tree = [{project:{id:A, name:'가 사업'}, depth:0}];
  const base = {start:'2026-11-02', lines:new Map(), linesState:'ok', today:'2026-11-05',
    materials:{basket:ok({notes:[], links:[], docs:[]}), projectUpdates:ok([]), catalog:ok(tree), meetings:ok(meetings), orgUpdates:ok(Object.assign([], {mine:new Set()}))}};
  for (const kindsArg of [null, {status:'ok', list:[kinds.meetingKindKey('가상 늘 빼는 종류')]}]) {
    const w = weekly.weeklySummary({...base, kinds:kindsArg});
    const summaryText = w.summary.areas.flatMap(a => a.rows.flatMap(r => r.items.map(weekly.summaryLine))).join('\n');
    const detailText = (w.meetings.items || []).map(i => i.text).join('\n');
    for (const name of INTERNAL) { assert.ok(!summaryText.includes(name), `요약에 ${name}`); assert.ok(!detailText.includes(name), `세부에 ${name}`); }
    assert.ok(summaryText.includes('가상 간담회') && detailText.includes('가상 간담회'));
    if (kindsArg) { assert.ok(!summaryText.includes('늘 빼는') && !detailText.includes('늘 빼는')); } else assert.ok(summaryText.includes('늘 빼는'));
  }
});

test('사업요약표 미리보기: 같은 한 곳으로 거른 보고만 표·세부 내용에 들어간다(정적 확인 + 재료 계산)', () => {
  const src = read('weekly-summary-table.js');
  assert.match(src, /import\('\.\/journal-meeting-kinds\.js'\)/);
  assert.match(src, /state\.meetings\(\)\.filter\(m=>kinds\.reportsMeeting\(m,hidden\)\)/);
  assert.match(src, /readKinds\(\)/);
  assert.ok(!/뺀 회의|다시 올리기/.test(src), '뺀 n건 안내·다시 올리기 없음');
  const shown = meetings.filter(x => kinds.reportsMeeting(x, [kinds.meetingKindKey('가상 늘 빼는 종류')]));
  const { records, all, untagged } = m.previewRecords(shown, {from:'2026-11-02', to:'2026-11-08'});
  assert.deepEqual(all.map(x => x.id), ['ok1']);
  assert.deepEqual(records.map(r => r.meeting), ['ok1']);
  assert.deepEqual(untagged, []);
});

test('사업요약표 미리보기: 칸을 누르면 글 칸, Ctrl+Enter 저장, 서버 저장, AI 호출 없음, 보고 없는 줄도 쓰기 (정적 확인)', () => {
  const src = read('weekly-summary-table.js');
  assert.match(src, /e\.ctrlKey\|\|e\.metaKey/);
  assert.match(src, /changeWeekOwner\(\{start:week,area:ref\.area,task:ref\.task,text\}\)/);
  assert.match(src, /changeWeekSummaryText\(\{start:week,area:ref\.area,task:ref\.task,text\}\)/);
  assert.match(src, /fullTable\(placed\.areas/);
  assert.ok(!/callAiAssist|basket-ai-summary|area_week_summary/.test(src.replace(/^\s*\/\/.*$/gm, '')));
  // 기기 저장 금지는 audit 검사(브라우저 저장소 사용 금지)가 본다.
  assert.ok(!/console\./.test(src));
});

test('한글 파일 상자: owners 를 읽은 그대로 다시 싣고(데이터 보존) 담당 칸 값을 파일에 넣는다 (정적 확인)', () => {
  const src = read('journal-hwpx.js');
  assert.match(src, /owners:s\.owners \?\? null/);
  assert.match(src, /state\.owners = draftOwners\(saved\?\.row\?\.draft\)/);
  // WEEKLY-메뉴짝짓기 P6: 4. 1)·3. 2)는 주별 조직보고 표. BIZ-기록하나로 B-4 ①: 2. 1)·담당은 옛 주 = 임시저장 칸(owners), 전환 주부터 = 사업요약 창.
  assert.match(src, /\{base:state\.base, summary:state\.edits\.summary, owners:ownerEdits\(state\)\}/);
  assert.match(src, /\{\.\.\.state\.edits, summary:sum\.summary, orgs:week\.orgs, sites:week\.sites, owners:sum\.owners\}/);
  assert.match(src, /c\.cell\.startsWith\('owner:'\)/);
});
