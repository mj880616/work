import test from 'node:test';
import assert from 'node:assert/strict';
import {cellKeys, cellId, parseCellId, summaryKey, orgKey, makeDraft, readDraft, placeDraft, merge3, sameDraft, hasContent, baseDigest,
  readWeekDraft, writeWeekDraft, missingDraft, DRAFT_MAX_BYTES} from '../app/weekly-draft-store.js';

// WEEKLY-임시저장: 주간보고 한글 파일 상자 임시저장(app/weekly-draft-store.js). 이름·조직은 모두 가짜.
const START = '2026-10-19';

test('칸 열쇠: 줄 번호가 아니라 칸 이름, 같은 이름이 두 번이면 몇 번째(n)', () => {
  const rows = [{area:'사업영역 가', task:'과제 1'}, {area:'사업영역  가', task:'과제 1'}, {area:'사업영역 나', task:''}];
  assert.deepEqual(cellKeys(rows, summaryKey), [{key:'사업영역 가›과제 1', n:0}, {key:'사업영역 가›과제 1', n:1}, {key:'사업영역 나›', n:0}]);
  assert.deepEqual(cellKeys([{org:'가상 노동조합'}, {org:'나 모임'}], orgKey).map(k => k.key), ['가상 노동조합', '나 모임']);
  const id = cellId('orgs', '가상 노동조합', 0);
  assert.deepEqual(parseCellId(id), {section:'orgs', key:'가상 노동조합', n:0});
});

test('고친 칸만 저장하고, 바탕이 바뀌면 이름이 맞는 칸만 넣고 못 넣은 칸은 남긴다(버리지 않음)', () => {
  const a = cellId('summary', '가›1', 0), b = cellId('orgs', '가상 노동조합', 0), c = cellId('orgs', '없어진 조직', 0);
  const initial = new Map([[a, ['- 바탕 가']], [b, ['- 바탕 조직']], [c, ['- 바탕 c']]]);
  const cells = new Map([[a, ['- 바탕 가']], [b, ['- 바탕 조직', '- 고친 줄']], [c, ['- 고친 c']]]);
  const d = makeDraft({base:{from:'library', document_id:'doc', file_name:'t.hwpx', digest:'x'}, cells, initial, titles:new Map([['c:e1', {title:'고친 제목', place:''}]])});
  assert.deepEqual(d.rows.map(r => [r.section, r.key, r.lines]), [['orgs', '가상 노동조합', ['- 바탕 조직', '- 고친 줄']], ['orgs', '없어진 조직', ['- 고친 c']]]);
  assert.deepEqual(d.titles, [{event:'c:e1', title:'고친 제목', place:''}]);
  assert.equal(d.v, 1);
  // 다른 바탕: '없어진 조직' 칸이 없다.
  const placed = placeDraft(readDraft(JSON.parse(JSON.stringify(d))), new Set([a, b]));
  assert.deepEqual([...placed.cells], [[b, ['- 바탕 조직', '- 고친 줄']]]);
  assert.deepEqual(placed.unplaced.map(r => r.key), ['없어진 조직']);
  // 못 넣은 칸은 다시 저장할 때 그대로 남는다.
  const again = makeDraft({cells:new Map([[a, ['- 바탕 가']], [b, ['- 바탕 조직']]]), initial:new Map([[a, ['- 바탕 가']], [b, ['- 바탕 조직']]]), keep:placed.unplaced});
  assert.deepEqual(again.rows.map(r => r.key), ['없어진 조직']);
  assert.equal(hasContent(again), true);
  assert.equal(hasContent(makeDraft({})), false);
});

test('읽기: 모양이 틀린 값은 버린다(서버는 형태·크기만 검사)', () => {
  assert.equal(readDraft(null), null);
  assert.equal(readDraft({v:2}), null);
  const d = readDraft({v:1, rows:[{section:'summary', key:'가', n:0, lines:['a']}, {section:'nope', key:'x', n:0, lines:[]}, {section:'orgs', key:'y', n:-1, lines:[]}], titles:[{event:''}, {event:'c:e', title:'t'}], me:3});
  assert.deepEqual(d.rows, [{section:'summary', key:'가', n:0, lines:['a']}]);
  assert.deepEqual(d.titles, [{event:'c:e', title:'t', place:''}]);
  assert.equal(d.me, '3');
});

const D = (rows = {}, extra = {}) => ({v:1, base:null, me:'', me_from:'', date:'', titles:[], ...extra,
  rows:Object.entries(rows).map(([key, lines]) => ({section:'orgs', key, n:0, lines}))});

test('3자 비교: 한쪽만 고친 칸은 합치고, 같은 칸을 양쪽이 다르게 고치면 그 칸만 묻는다(합친 판엔 서버 값)', () => {
  const base = D({가:['- 가 0'], 나:['- 나 0']});
  const mine = D({가:['- 가 이 기기'], 나:['- 나 0'], 다:['- 다 이 기기']}, {date:'2026년 10월 26일(월) 오전'});
  const theirs = D({가:['- 가 0'], 나:['- 나 다른 기기']}, {me:'다른 이름', me_from:'typed', titles:[{event:'c:e', title:'폰 제목', place:''}]});
  const {draft, conflicts} = merge3(base, mine, theirs);
  assert.deepEqual(conflicts, []);
  assert.deepEqual(Object.fromEntries(draft.rows.map(r => [r.key, r.lines])), {가:['- 가 이 기기'], 나:['- 나 다른 기기'], 다:['- 다 이 기기']});
  assert.equal(draft.date, '2026년 10월 26일(월) 오전');
  assert.equal(draft.me, '다른 이름'); assert.equal(draft.me_from, 'typed');
  assert.deepEqual(draft.titles, [{event:'c:e', title:'폰 제목', place:''}]);

  const both = merge3(base, D({가:['- PC'], 나:['- 나 0']}), D({가:['- 폰'], 나:['- 나 0']}));
  assert.deepEqual(both.conflicts, [{cell:`row:${cellId('orgs', '가', 0)}`, mine:['- PC'], theirs:['- 폰']}]);
  assert.deepEqual(both.draft.rows.find(r => r.key === '가').lines, ['- 폰']);
  // 같은 값으로 고쳤으면 충돌이 아니다. 한쪽이 바탕으로 되돌린 칸은 다른 쪽 값.
  assert.deepEqual(merge3(base, D({가:['- 같음']}), D({가:['- 같음']})).conflicts, []);
  const reverted = merge3(D({가:['- 고침']}), D({}), D({가:['- 고침']}));
  assert.deepEqual(reverted.conflicts, []); assert.deepEqual(reverted.draft.rows, []);
  // 마지막으로 같았던 판이 없으면(처음 저장 전) 양쪽이 다른 칸은 묻는다.
  assert.equal(merge3(null, D({가:['- a']}), D({가:['- b']})).conflicts.length, 1);
  // 서버가 비워졌으면(다른 기기의 [처음부터]) 이 기기에서 그 뒤 고친 칸만 남는다.
  const cleared = merge3(D({가:['- 옛']}), D({가:['- 옛'], 나:['- 새']}), null);
  assert.deepEqual(cleared.conflicts, []); assert.deepEqual(cleared.draft.rows.map(r => r.key), ['나']);
  assert.equal(sameDraft(D({가:['x']}), D({가:['x']})), true);
  assert.equal(sameDraft(D({가:['x']}), D({가:['y']})), false);
});

test('바탕 지문: 같은 칸 글이면 같은 값, 다르면 다른 값(16자)', async () => {
  const a = await baseDigest(new Map([['b', ['1']], ['a', ['2']]])), b = await baseDigest(new Map([['a', ['2']], ['b', ['1']]]));
  assert.equal(a, b); assert.equal(a.length, 16);
  assert.notEqual(a, await baseDigest(new Map([['a', ['3']]])));
});

// A fake PostgREST for the week row: draft_saved_at=eq./is.null conditions, 409 on a second row, no updated_at change by drafts.
function fakeRt({missing = 0, rows = []} = {}) {
  const calls = [];
  let clock = 0;
  const rt = {
    context:{read:() => ({workspace:{id:'w'}})},
    async api(path, {method = 'GET', body = null} = {}) {
      const url = new URL(path, 'https://x'), q = url.searchParams;
      calls.push({method, query:Object.fromEntries(q), body});
      if (missing) throw Object.assign(new Error(missing === 400 ? 'column app_weekly_exec_requests.draft does not exist' : 'not found'), {status:missing});
      const hit = () => rows.filter(r => (!q.has('week_start') || q.get('week_start') === `eq.${r.week_start}`) &&
        (!q.has('draft_saved_at') || (q.get('draft_saved_at') === 'is.null' ? r.draft_saved_at == null : q.get('draft_saved_at') === `eq.${r.draft_saved_at}`)));
      if (method === 'GET') return hit().map(r => ({id:r.id, draft:r.draft, draft_saved_at:r.draft_saved_at}));
      if (method === 'POST') {
        if (rows.some(r => r.week_start === body.week_start)) throw Object.assign(new Error('dup'), {status:409});
        const row = {id:`r${rows.length}`, updated_at:'U0', ...body}; rows.push(row); return [row];
      }
      if (method === 'PATCH') { const list = hit(); for (const r of list) Object.assign(r, body); return list; }
      throw new Error('method');
    },
  };
  return {rt, calls, rows, now:() => `2026-10-19T0${++clock}:00:00.000Z`};
}

test('조건부 쓰기: 행이 없으면 items=[]로 만들고, 그 뒤엔 draft_saved_at 조건 PATCH. updated_at은 보내지 않는다', async () => {
  const f = fakeRt();
  assert.deepEqual(await readWeekDraft(START, f.rt), {missing:false, row:{exists:false, draft:null, saved_at:null}});
  const d1 = D({가:['- 1']});
  const r1 = await writeWeekDraft({start:START, known:{exists:false}, draft:d1, now:f.now}, f.rt);
  assert.equal(r1.ok, true); assert.equal(r1.row.saved_at, '2026-10-19T01:00:00.000Z');
  assert.deepEqual(f.calls.at(-1).body, {workspace_id:'w', week_start:START, items:[], draft:d1, draft_saved_at:'2026-10-19T01:00:00.000Z'});
  const r2 = await writeWeekDraft({start:START, known:r1.row, draft:D({가:['- 2']}), now:f.now}, f.rt);
  assert.equal(r2.ok, true);
  assert.equal(f.calls.at(-1).method, 'PATCH');
  assert.equal(f.calls.at(-1).query.draft_saved_at, 'eq.2026-10-19T01:00:00.000Z');
  assert.equal('updated_at' in f.calls.at(-1).body, false);
  assert.equal(f.rows[0].updated_at, 'U0');
  // 요청 표만 있는 행(draft_saved_at 비어 있음)은 is.null 조건.
  const g = fakeRt({rows:[{id:'r0', week_start:START, items:[], updated_at:'U0', draft:null, draft_saved_at:null}]});
  const read = await readWeekDraft(START, g.rt);
  await writeWeekDraft({start:START, known:read.row, draft:d1, now:g.now}, g.rt);
  assert.equal(g.calls.at(-1).query.draft_saved_at, 'is.null');
});

test('조건부 쓰기 충돌: 다른 기기가 먼저 저장했으면 0행 → 다시 읽은 서버 판을 돌려준다(덮어쓰지 않음)', async () => {
  const f = fakeRt();
  const first = await writeWeekDraft({start:START, known:{exists:false}, draft:D({가:['- 폰']}), now:f.now}, f.rt);
  // PC는 행이 없던 때를 기억한다 → POST 409 → 충돌.
  const pc = await writeWeekDraft({start:START, known:{exists:false}, draft:D({가:['- PC']}), now:f.now}, f.rt);
  assert.equal(pc.conflict, true);
  assert.deepEqual(pc.row.draft.rows[0].lines, ['- 폰']);
  // 옛 판(첫 저장 전)을 조건으로 PATCH → 0행 → 충돌, 서버 값은 그대로.
  const stale = await writeWeekDraft({start:START, known:{exists:true, saved_at:null}, draft:D({가:['- PC']}), now:f.now}, f.rt);
  assert.equal(stale.conflict, true);
  assert.deepEqual(f.rows[0].draft.rows[0].lines, ['- 폰']);
  // 다시 읽은 판으로 합쳐 쓰면 된다.
  const merged = merge3(null, D({가:['- PC'], 나:['- PC 나']}), stale.row.draft);
  const ok = await writeWeekDraft({start:START, known:stale.row, draft:merged.draft, now:f.now}, f.rt);
  assert.equal(ok.ok, true);
  assert.equal(first.row.saved_at !== ok.row.saved_at, true);
  // 비우기(처음부터)는 draft=null.
  const cleared = await writeWeekDraft({start:START, known:ok.row, draft:null, now:f.now}, f.rt);
  assert.equal(cleared.ok, true); assert.equal(cleared.row.draft, null);
});

test('칸 준비 전(표 404, 칸 400)은 missing — 화면은 "준비 중"으로 지금처럼 동작. 너무 크면 보내지 않음', async () => {
  for (const status of [404, 400]) {
    const f = fakeRt({missing:status});
    assert.deepEqual(await readWeekDraft(START, f.rt), {missing:true, row:null});
    assert.deepEqual(await writeWeekDraft({start:START, known:{exists:true, saved_at:null}, draft:D({}), now:f.now}, f.rt), {missing:true});
  }
  assert.equal(missingDraft({status:400, message:'invalid input syntax'}), false);
  const f = fakeRt();
  await assert.rejects(writeWeekDraft({start:START, known:{exists:false}, draft:D({가:['x'.repeat(DRAFT_MAX_BYTES)]}), now:f.now}, f.rt), {code:'too_big'});
  assert.equal(f.calls.length, 0);
  await assert.rejects(readWeekDraft('2026-1-1', f.rt));
});
