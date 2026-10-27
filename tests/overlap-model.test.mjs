// MTG-기록겹침거르기 3단계(화면 ①): 후보 고르기·요청 본문·답 해석·연결 계획의 순수 규칙.
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeRef, orderPair, pairKey, windowOf, dayGap, rankCandidates, buildRequest, sameCandidates, candidateLine, userVerdictPayload, linkPlan, mergeTarget, OVERLAP_MAX_CANDIDATES} from '../app/overlap-model.mjs';

const U = n => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P = {kind: 'project', id: U(900)};
const rec = {ref: makeRef('project_update', U(1)), kind: 'project_update', day: '2026-10-21', text: '철도 파업 출정 기자회견 진행', title: '', target: P};
const meet = (n, day, title, target = null) => ({ref: makeRef('meeting', U(n)), kind: 'meeting', day, title, text: '', typeLabel: '언론', target});

test('쌍은 서버와 같은 순서(a < b)이고 키는 방향과 무관하다', () => {
  const x = makeRef('meeting', U(2)), y = makeRef('basket', U(1));
  assert.deepEqual(orderPair(x, y), {a: y, b: x});
  assert.equal(pairKey(x, y), pairKey(y, x));
  assert.equal(makeRef('meeting', U(2).toUpperCase()), x);
});

test('날짜 범위는 앞뒤 14일, 틀린 날짜는 null', () => {
  assert.deepEqual(windowOf('2026-10-21'), {from: '2026-10-07', to: '2026-11-04'});
  assert.equal(windowOf('2026-13-40x'), null);
  assert.equal(dayGap('2026-10-21', '2026-10-19'), 2);
});

test('후보는 점수 순으로 6건까지: 범위 밖 날짜·자기 자신·중복·틀린 참조는 뺀다', () => {
  const list = [
    meet(2, '2026-10-01', '철도 파업 출정 기자회견'),        // 20일 차이: 뺀다
    meet(3, '2026-10-20', '무관한 회의'),
    meet(4, '2026-10-21', '철도 파업 출정 기자회견'),        // 낱말 겹침 + 같은 날: 1등
    meet(4, '2026-10-21', '중복'),
    {...meet(5, '2026-10-21', '틀린'), ref: 'meeting:not-a-uuid'},
    {...meet(1, '2026-10-21', '자기'), ref: rec.ref},
    ...[6, 7, 8, 9, 10, 11, 12].map(n => meet(n, '2026-10-22', '다른 일 ' + n)),
  ];
  const out = rankCandidates(rec, list);
  assert.equal(out[0].ref, makeRef('meeting', U(4)));
  assert.equal(out.length, OVERLAP_MAX_CANDIDATES);
  assert.ok(!out.some(c => c.ref === makeRef('meeting', U(2)) || c.ref === rec.ref || c.ref.includes('not-a-uuid')));
  assert.equal(new Set(out.map(c => c.ref)).size, out.length);
});

test('같은 프로젝트에 연결된 후보가 앞선다', () => {
  const out = rankCandidates(rec, [meet(2, '2026-10-21', '가'), meet(3, '2026-10-21', '나', P)]);
  assert.equal(out[0].ref, makeRef('meeting', U(3)));
});

test('요청 본문: 후보가 없으면 null(AI를 부르지 않음), 있으면 정렬된 쌍', () => {
  assert.equal(buildRequest(rec, []), null);
  const body = buildRequest(rec, [meet(2, '2026-10-21', '가')]);
  assert.equal(body.kind, 'overlap_check');
  assert.deepEqual(body.pairs, [orderPair(rec.ref, makeRef('meeting', U(2)))]);
});

test('서버 답에서 같은 일(judged·decided + same)만 고르고 모양이 틀리면 빈 목록', () => {
  const ranked = [meet(2, '2026-10-21', '가'), meet(3, '2026-10-21', '나'), meet(4, '2026-10-21', '다')];
  const res = (c, state, verdict) => ({...orderPair(rec.ref, c.ref), state, verdict});
  const data = {results: [res(ranked[0], 'judged', 'unsure'), res(ranked[1], 'judged', 'same'), res(ranked[2], 'decided', 'same')]};
  assert.deepEqual(sameCandidates(rec, ranked, data).map(c => c.ref), [ranked[1].ref, ranked[2].ref]);
  assert.deepEqual(sameCandidates(rec, ranked, {results: [{...res(ranked[0], 'unreadable', 'same')}]}), []);
  assert.deepEqual(sameCandidates(rec, ranked, null), []);
  assert.deepEqual(sameCandidates(rec, ranked, {results: 'x'}), []);
});

test('물음 한 줄은 날짜·종류·제목이고 길면 줄인다', () => {
  assert.equal(candidateLine(meet(2, '2026-10-21', '철도 파업 출정 기자회견')), '10.21 · 언론 · 철도 파업 출정 기자회견');
  assert.ok([...candidateLine(meet(2, '2026-10-21', '가'.repeat(100)))].length < 60);
});

test('사용자 판정 본문: 순서를 맞추고 same·different만, 같은 참조는 거절', () => {
  const c = makeRef('meeting', U(2));
  const body = userVerdictPayload('w', rec.ref, c, 'same');
  assert.deepEqual(body.p_pairs, [{a_ref: orderPair(rec.ref, c).a, b_ref: orderPair(rec.ref, c).b, verdict: 'same', decided_by: 'user'}]);
  assert.equal(userVerdictPayload('w', rec.ref, c, 'unsure'), null);
  assert.equal(userVerdictPayload('w', rec.ref, rec.ref, 'same'), null);
  assert.equal(userVerdictPayload('w', 'x', c, 'same'), null);
});

test('연결 계획: 프로젝트 기록 → 사업 보고에 프로젝트와 쓴 글을 메모로, 사업 보고 → 후보의 곳(메모 없음), 곳을 모르면 null', () => {
  const m = meet(2, '2026-10-21', '가');
  assert.deepEqual(linkPlan(rec, m), {meetingId: U(2), target: P, summary: rec.text});
  const mr = {ref: makeRef('meeting', U(5)), kind: 'meeting', day: '2026-10-21', text: '', target: null};
  const pu = {ref: makeRef('project_update', U(6)), kind: 'project_update', target: P};
  assert.deepEqual(linkPlan(mr, pu), {meetingId: U(5), target: P, summary: null});
  assert.equal(linkPlan(mr, {...pu, target: null}), null);
  assert.equal(linkPlan({...rec, target: null}, m), null);
  assert.equal([...linkPlan({...rec, text: 'a'.repeat(3000)}, m).summary].length, 2000);
});

test('연결 합치기: 새 곳은 더하고 메모를 붙이며, 이미 메모가 있으면 덮어쓰지 않는다', () => {
  const plan = {meetingId: U(2), target: P, summary: '글'};
  const a = mergeTarget([{kind: 'organization', id: U(7), hasSummary: true}], plan);
  assert.deepEqual(a.targets, [{kind: 'organization', id: U(7)}, P]);
  assert.equal(a.summary, '글'); assert.equal(a.added, true);
  const b = mergeTarget([{...P, hasSummary: true}], plan);
  assert.equal(b.summary, null); assert.equal(b.added, false); assert.equal(b.keptSummary, true);
  const c = mergeTarget([{...P, hasSummary: false}], plan);
  assert.equal(c.summary, '글'); assert.equal(c.added, false);
});
