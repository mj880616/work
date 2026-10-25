import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planOverlaps, reviveEdges, weekCandidates, refOfOpen, cleanRows, batches, WEEK_MAX_PAIRS, PRIORITY,
} from '../app/overlap-weekly.mjs';
import {readOverlapRows, askPairs, reviveOverlaps} from '../app/overlap-weekly-data.js';
import {weekMaterial} from '../app/weekly-hwpx/draft.mjs';

// MTG-기록겹침거르기 4단계: 주간 정리에서 겹침 거르기. 이름·글은 모두 지어낸 값.
const mod = import('../app/journal-weekly.js');
const id = n => `f0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const M1 = `meeting:${id(1)}`, M2 = `meeting:${id(2)}`;
const P1 = `project_update:${id(3)}`, P2 = `project_update:${id(4)}`;
const O1 = `org_update:${id(5)}`, B1 = `basket:${id(6)}`;
const row = (x, y, verdict = 'same', decided_by = 'ai', reason = '') => { const [a, b] = x < y ? [x, y] : [y, x]; return {a_ref: a, b_ref: b, verdict, decided_by, reason}; };

test('planOverlaps: 사업 보고만 남기고 낮은 쪽을 뺀다 / different·unsure·보이지 않는 줄과의 짝은 빼지 않는다', () => {
  const shown = new Set([M1, P1, P2, O1]);
  const gone = planOverlaps(shown, [row(M1, P1, 'same', 'ai', '같은 기자회견'), row(M1, P2, 'different'), row(M1, O1, 'unsure')]);
  assert.deepEqual([...gone.keys()], [P1]);
  assert.deepEqual(gone.get(P1).keep, [M1]);
  // 남길 줄이 이 주에 없으면(다른 주·보고 안 함 종류) 뺄 것이 없다.
  assert.equal(planOverlaps(new Set([P1, O1]), [row(M2, P1)]).size, 0);
  // user·link 판정도 같은 same이다.
  assert.deepEqual([...planOverlaps(shown, [row(M1, P1, 'same', 'user'), row(M1, O1, 'same', 'link')]).keys()].sort(), [O1, P1].sort());
  assert.ok(PRIORITY.meeting > PRIORITY.project_update && PRIORITY.project_update > PRIORITY.org_update && PRIORITY.org_update > PRIORITY.basket);
});

test('planOverlaps: 이어진 묶음은 하나만 남고, 같은 우선순위끼리는 모두 남는다', () => {
  const shown = new Set([M1, P1, B1, P2]);
  const gone = planOverlaps(shown, [row(P1, B1), row(B1, M1), row(P1, P2)]);
  assert.deepEqual([...gone.keys()].sort(), [B1, P1, P2].sort());
  // 사업 보고가 없는 묶음: 프로젝트 기록 둘은 서로 안 뺀다.
  assert.equal(planOverlaps(new Set([P1, P2]), [row(P1, P2)]).size, 0);
  // 모양이 틀린 행은 버린다.
  assert.equal(planOverlaps(shown, [{a_ref: 'x', b_ref: M1, verdict: 'same'}, null, row(M1, M1)]).size, 0);
});

test('reviveEdges: 되살릴 줄에서 우선순위가 같거나 높은 쪽과의 짝을 끊고, 돌아 이어져 있으면 닿은 짝을 모두 끊는다', () => {
  const shown = new Set([M1, P1, B1]);
  const rows = [row(M1, P1), row(P1, B1)];
  const cut = reviveEdges(P1, shown, rows);
  assert.deepEqual(cut.map(p => `${p.a}|${p.b}`), [row(M1, P1)].map(r => `${r.a_ref}|${r.b_ref}`));
  // 끊은 뒤 그 줄이 남는다.
  const after = rows.filter(r => !cut.some(p => p.a === r.a_ref && p.b === r.b_ref)).concat(cut.map(p => ({a_ref: p.a, b_ref: p.b, verdict: 'different'})));
  assert.equal(planOverlaps(shown, after).has(P1), false);
  // 낮은 줄 B1이 사업 보고로도 이어져 있으면(P1~B1~M1) 닿은 짝을 모두 끊어야 P1이 돌아온다.
  const bridge = [row(P1, B1), row(B1, M1)];
  const all = reviveEdges(P1, shown, bridge);
  assert.deepEqual(all.map(p => `${p.a}|${p.b}`), [row(P1, B1)].map(r => `${r.a_ref}|${r.b_ref}`));
});

test('weekCandidates: 이미 판정된 짝은 빼고, 서로 이어질 만한 짝만 점수 순으로 위 24쌍', () => {
  const meetings = [{ref: M1, day: '2026-10-06', title: '철도 파업 출정 기자회견', targets: [{kind: 'project', id: 'pa'}]}, {ref: M2, day: '2026-10-08', title: '운영위원회', targets: []}];
  const records = [
    {ref: P1, day: '2026-10-06', text: '출정 기자회견 진행', title: '', target: {kind: 'project', id: 'pa'}},
    {ref: P2, day: '2026-10-07', text: '전혀 다른 이야기', title: '', target: {kind: 'project', id: 'pz'}},
    {ref: M2, day: '2026-10-08', text: '사업 보고는 후보 쪽이 아님', title: '', target: null},
  ];
  const first = weekCandidates(records, meetings, []);
  assert.deepEqual(first, [{a: M1, b: P1 > M1 ? P1 : M1}].map(() => first[0]));
  assert.equal(first.length, 1);
  assert.deepEqual([first[0].a, first[0].b].sort(), [M1, P1].sort());
  assert.equal(first[0].a < first[0].b, true);
  assert.deepEqual(weekCandidates(records, meetings, [row(M1, P1, 'unsure')]), []);
  const many = Array.from({length: 40}, (_, i) => ({ref: `project_update:${id(100 + i)}`, day: '2026-10-06', text: '기자회견', title: '', target: null}));
  assert.equal(weekCandidates(many, meetings.slice(0, 1), []).length, WEEK_MAX_PAIRS);
  assert.deepEqual(batches(Array.from({length: 17}, (_, i) => i)).map(b => b.length), [8, 8, 1]);
});

test('refOfOpen: 화면 줄이 가리키는 원래 기록에서 겹침 참조를 만든다', () => {
  assert.equal(refOfOpen({type: 'project', project: 'p', record: `progress:${id(3).toUpperCase()}`, note: null}), P1);
  assert.equal(refOfOpen({type: 'org', org: 'o', record: `up:${id(5)}`, note: null}), O1);
  assert.equal(refOfOpen({type: 'org', org: 'o', record: 'link:x', note: id(6)}), B1);
  assert.equal(refOfOpen({type: 'project', project: 'p', record: 'progress:not-a-uuid'}), null);
  assert.equal(refOfOpen(null), null);
  assert.equal(cleanRows([row(M1, P1)]).length, 1);
});

const ok = items => ({status: 'ok', items});
const base = {start: '2026-10-05', lines: new Map(), linesState: 'ok', today: '2026-10-06'};
const tree = [{project: {id: 'pa', name: '사업영역 A'}, depth: 0}];
const materials = (overlaps) => ({
  basket: ok({notes: [], links: [], docs: []}),
  projectUpdates: ok([
    {id: id(3), project_id: 'pa', project: {name: '사업영역 A'}, summary: '출정 기자회견 진행', effective_on: '2026-10-06', created_at: '2026-10-06T01:00:00Z'},
    {id: id(4), project_id: 'pa', project: {name: '사업영역 A'}, summary: '별도 협의', effective_on: '2026-10-07', created_at: '2026-10-07T01:00:00Z'},
  ]),
  orgUpdates: ok(Object.assign([{id: id(5), organization_id: 'o1', organization: {name: '가 조직'}, occurred_at: '2026-10-06T02:00:00Z', raw_text: '출정 기자회견 참석'}], {mine: new Set(['o1']), orgs: [{id: 'o1', name: '가 조직'}]})),
  catalog: ok(tree),
  meetings: ok([{id: id(1), title: '철도 파업 출정 기자회견', series_name: null, round_no: null, meeting_at: '2026-10-06T05:00:00Z', link_targets: [{kind: 'project', id: 'pa'}]}]),
  ...(overlaps ? {overlaps} : {}),
});
const rows = [row(M1, P1, 'same', 'ai', '같은 기자회견을 두 번 적음'), row(M1, O1, 'same', 'user')];

test('weeklySummary: 같은 일은 사업 보고만 남고 요약·조직 소식에서 빠지며 [보기]용 목록과 개수가 생긴다', async () => {
  const m = await mod, w = m.weeklySummary({...base, materials: materials(ok({missing: false, rows}))});
  const lines = w.summary.areas.flatMap(a => a.rows.flatMap(r => r.items.map(i => i.text)));
  assert.deepEqual(lines, ['별도 협의']);
  assert.equal(w.summary.count, 1);
  assert.deepEqual(w.summary.overlapped.map(i => [i.ref, i.text, i.reason, i.kept.map(k => k.text)]), [[P1, '출정 기자회견 진행', '같은 기자회견을 두 번 적음', ['14:00 철도 파업 출정 기자회견']]]);
  assert.deepEqual(w.orgs.sections, []);
  assert.deepEqual(w.orgs.overlapped.map(i => i.ref), [O1]);
  assert.equal(w.meetings.items.length, 1);
  assert.deepEqual(w.overlap, {checking: false, count: 2});
  assert.ok(w.overlapSource.refs.includes(M1) && w.overlapSource.records.some(r => r.ref === P1 && r.target.id === 'pa'));
});

test('weeklySummary: 확인 중·표 없음·읽기 실패·판정 없음이면 아무것도 빼지 않는다', async () => {
  const m = await mod;
  const everything = w => JSON.stringify([w.summary.areas, w.orgs.sections]);
  const plain = m.weeklySummary({...base, materials: materials()});
  assert.ok(everything(plain).includes('출정 기자회견 진행') && everything(plain).includes('출정 기자회견 참석'));
  for (const overlaps of [{status: 'loading'}, {status: 'failed'}, ok({missing: true, rows: []}), ok({missing: false, rows: [row(M1, P1, 'unsure'), row(M1, O1, 'different', 'user')]})]) {
    const w = m.weeklySummary({...base, materials: materials(overlaps)});
    assert.equal(everything(w), everything(plain));
    assert.equal(w.overlap.count, 0);
    assert.equal(w.overlap.checking, overlaps.status === 'loading');
  }
});

test('weeklySummary: 보고 안 함 종류가 된 사업 보고는 남길 줄이 아니라서 다른 줄을 빼지 않는다', async () => {
  const m = await mod;
  const kinds = {status: 'ok', list: ['철도파업출정기자회견']};
  const w = m.weeklySummary({...base, kinds, materials: materials(ok({missing: false, rows}))});
  assert.equal(w.meetings.items.length, 0);
  assert.equal(w.overlap.count, 0);
  assert.ok(JSON.stringify(w.summary.areas).includes('출정 기자회견 진행'));
});

test('화면 모델·초안 복사·한글 파일 재료가 같은 결과다 / 되살리면 줄이 돌아온다', async () => {
  const m = await mod;
  const withOv = m.weeklySummary({...base, materials: materials(ok({missing: false, rows}))});
  const text = m.weeklyReportText(withOv);
  assert.equal(text.includes('출정 기자회견 진행') || text.includes('출정 기자회견 참석'), false);
  assert.ok(text.includes('별도 협의') && text.includes('철도 파업 출정 기자회견'));
  const material = weekMaterial(withOv, [{index: 0, area: '사업영역 A', task: ''}], [{index: 0, org: '가 조직', lines: []}]);
  const hwpx = JSON.stringify({rows: [...material.byRow], orgs: [...material.byOrg], rest: [material.unmatched, material.orgUnmatched]});
  assert.equal(hwpx.includes('출정 기자회견 진행'), false);
  assert.ok(hwpx.includes('별도 협의'));
  const shown = new Set(withOv.overlapSource.refs);
  const cut = reviveEdges(P1, shown, rows);
  const revived = rows.filter(r => !cut.some(p => p.a === r.a_ref && p.b === r.b_ref)).concat(cut.map(p => ({a_ref: p.a, b_ref: p.b, verdict: 'different', decided_by: 'user'})));
  const back = m.weeklySummary({...base, materials: materials(ok({missing: false, rows: revived}))});
  assert.ok(m.weeklyReportText(back).includes('출정 기자회견 진행'));
  assert.equal(back.overlap.count, 1);
});

const runtime = handler => { const calls = []; return {calls, context: {read: () => ({workspace: {id: 'w'}})}, api: async (path, opts) => { calls.push({path, opts}); return handler(path, opts); }}; };

test('readOverlapRows: 소유자 작업공간의 행을 양쪽 칸으로 읽고, 표가 없으면 missing, 다른 실패는 던진다', async () => {
  const rt = runtime(path => path.includes('a_ref=in.') ? [row(M1, P1)] : [row(M1, P1), row(M2, P1)]);
  const read = await readOverlapRows([M1, P1, 'bad'], rt);
  assert.equal(read.rows.length, 2);
  assert.ok(rt.calls.every(c => c.path.startsWith('/rest/v1/app_record_overlaps?workspace_id=eq.w&') && !c.opts));
  assert.deepEqual(await readOverlapRows([], rt), {missing: false, rows: []});
  assert.deepEqual(await readOverlapRows([M1], runtime(() => { throw Object.assign(new Error('nope'), {status: 404}); })), {missing: true, rows: []});
  await assert.rejects(readOverlapRows([M1], runtime(() => { throw Object.assign(new Error('boom'), {status: 500}); })));
});

test('askPairs: 8쌍씩 서버에 묻고 실패·한도에서 조용히 멈춘다 / reviveOverlaps: 사용자 판정 different를 쓴다', async () => {
  const sent = [];
  const rt = {context: {read: () => ({workspace: {id: 'w'}})}, config: {url: 'https://x.example', key: 'k'}, session: {ensure: async () => true, read: () => ({access_token: 't'})}};
  let n = 0;
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body); sent.push(body); n++;
    if (n === 2) return {ok: false, status: 429, text: async () => JSON.stringify({ok: false, error: 'daily_limit'})};
    return {ok: true, status: 200, text: async () => JSON.stringify({ok: true, kind: 'overlap_check', results: body.pairs.map(p => ({...p, state: 'judged', verdict: 'same'}))})};
  };
  const pairs = Array.from({length: 20}, (_, i) => ({a: `meeting:${id(1)}`, b: `project_update:${id(200 + i)}`}));
  const judged = await askPairs(pairs, {rt, fetcher});
  assert.equal(judged, 8);
  assert.deepEqual(sent.map(b => [b.kind, b.pairs.length]), [['overlap_check', 8], ['overlap_check', 8]]);
  const api = runtime(() => null);
  assert.equal(await reviveOverlaps([{a: M1, b: P1}], api), true);
  const call = api.calls[0];
  assert.equal(call.path, '/rest/v1/rpc/app_record_overlap_set');
  assert.deepEqual(call.opts.body.p_pairs, [{a_ref: M1, b_ref: P1, verdict: 'different', decided_by: 'user'}]);
  assert.equal(await reviveOverlaps([], api), false);
});
