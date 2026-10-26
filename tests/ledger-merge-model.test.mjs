// MTG-기록겹침거르기 5단계: 원장 겹친 기록 합치기(app/ledger-merge.js)의 순수 규칙. 합성 값만(09xx ID, 가상 이름).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { refOfLocation, samePairs, mergeCandidates, mergeRequest, previewText, dryRunMatches, recentMerges, originLabel, locationsOf, MERGE_REASON, MERGE_LIMIT } from '../app/ledger-merge-model.mjs';

const U = n => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const M = U(1), P = U(2), O = U(3), B = U(4);
const REF = { meeting: `meeting:${M}`, project_update: `project_update:${P}`, org_update: `org_update:${O}`, basket: `basket:${B}` };
const pair = (x, y, extra = {}) => ({ a_ref: x, b_ref: y, verdict: 'same', decided_by: 'ai', ...extra });
const rec = (id, ledger_id, title, kind = 'event', validity = 'current') => ({ id, ledger_id, kind, title, validity });
const src = (id, ledger_id, ref, status = 'active') => ({ id, ledger_id, location: `web2:${ref}`, status });
const link = (record_id, source_id) => ({ record_id, source_id });

// 사업 보고에서 뽑은 기록 EVT-0901(원문 M)과 프로젝트 기록에서 뽑은 기록 EVT-0902(원문 P).
const base = () => ({
  pairs: samePairs([pair(REF.meeting, REF.project_update)]),
  records: [rec('r1', 'EVT-0901', '가상 철도 파업 출정 기자회견'), rec('r2', 'EVT-0902', '철도 파업 출정 기자회견 진행')],
  sources: [src('s1', 'SRC-0901', REF.meeting), src('s2', 'SRC-0902', REF.project_update)],
  links: [link('r1', 's1'), link('r2', 's2')],
});

test('출처 위치 ↔ 겹침 참조: web2 위치만 인정하고 대소문자는 소문자로 맞춘다', () => {
  assert.equal(refOfLocation(`web2:meeting:${M.toUpperCase()}`), REF.meeting);
  assert.equal(refOfLocation('web2:note:' + M), null);
  assert.equal(refOfLocation('https://example.com/a'), null);
  assert.equal(refOfLocation(''), null);
  assert.deepEqual(locationsOf(samePairs([pair(REF.meeting, REF.project_update)])).sort(), [`web2:${REF.meeting}`, `web2:${REF.project_update}`].sort());
});

test('same 짝만 쓰고, 모양이 틀린 행·같은 짝 중복·different·unsure는 버린다', () => {
  const rows = [pair(REF.project_update, REF.meeting), pair(REF.meeting, REF.project_update), { ...pair(REF.meeting, REF.org_update), verdict: 'different' },
    { ...pair(REF.meeting, REF.basket), verdict: 'unsure' }, pair('x:1', REF.meeting), pair(REF.meeting, REF.meeting), null];
  const out = samePairs(rows);
  assert.equal(out.length, 1);
  assert.ok(out[0].a < out[0].b);
});

test('후보: 사업 보고 쪽 기록을 남기고 프로젝트 기록 쪽 기록을 합친다(근거 하나 추가)', () => {
  const [c] = mergeCandidates(base());
  assert.equal(c.keep.ledger_id, 'EVT-0901');
  assert.equal(c.drop.ledger_id, 'EVT-0902');
  assert.equal(c.keepRef, REF.meeting);
  assert.equal(c.dropRef, REF.project_update);
  assert.equal(c.addSource, 'SRC-0902');
  assert.deepEqual(c.drop.refs, [REF.project_update]);
});

test('우선순위: 사업 보고 > 프로젝트 기록 > 담당조직 기록 > 업데이트, 어느 쪽이 먼저 적혀도 같다', () => {
  for (const [x, y, keepKind] of [['basket', 'org_update', 'org_update'], ['org_update', 'project_update', 'project_update'], ['basket', 'meeting', 'meeting']]) {
    const args = { pairs: samePairs([pair(REF[x], REF[y])]), records: [rec('r1', 'EVT-0901', '가상 면담 결과'), rec('r2', 'EVT-0902', '면담 결과 정리')],
      sources: [src('s1', 'SRC-0901', REF[x]), src('s2', 'SRC-0902', REF[y])], links: [link('r1', 's1'), link('r2', 's2')] };
    const [c] = mergeCandidates(args);
    assert.equal(refOfLocation(`web2:${c.keepRef}`), c.keepRef);
    assert.ok(c.keepRef.startsWith(keepKind + ':'), `${x}/${y}`);
    const swapped = mergeCandidates({ ...args, records: [...args.records].reverse() });
    assert.equal(swapped[0].keep.ledger_id, c.keep.ledger_id);
  }
});

test('이미 한 기록이 두 원문을 다 가졌으면 합친 것이라 후보가 아니다', () => {
  const args = base();
  args.links.push(link('r1', 's2'));
  assert.deepEqual(mergeCandidates(args), []);
});

test('다른 종류(사건 ↔ 약속)·제목 낱말이 하나도 안 겹치는 기록·폐기된 기록은 짝짓지 않는다', () => {
  const kind = base(); kind.records[1].kind = 'commitment';
  assert.deepEqual(mergeCandidates(kind), []);
  const words = base(); words.records[1].title = '전혀 다른 내용';
  assert.deepEqual(mergeCandidates(words), []);
  const retired = base(); retired.records[1].validity = 'retired';
  assert.deepEqual(mergeCandidates(retired), []);
  const superseded = base(); superseded.records[0].validity = 'superseded';
  assert.deepEqual(mergeCandidates(superseded), []);
  const gone = base(); gone.sources[1].status = 'retired';
  assert.deepEqual(mergeCandidates(gone), []);
});

test('한 기록은 한 후보에만: 같은 원문에서 기록이 여럿이면 제목이 더 닮은 쪽끼리 맺는다', () => {
  const args = base();
  args.records.push(rec('r3', 'EVT-0903', '임금 교섭 일정'), rec('r4', 'EVT-0904', '임금 교섭 일정 조율'));
  args.links.push(link('r3', 's1'), link('r4', 's2'));
  const out = mergeCandidates(args);
  assert.deepEqual(out.map(c => [c.keep.ledger_id, c.drop.ledger_id]).sort(), [['EVT-0901', 'EVT-0902'], ['EVT-0903', 'EVT-0904']]);
});

test('버리는 쪽에 남는 쪽에 없는 근거가 둘 이상이면 올리지 않고, 이미 있으면 근거 추가 없이 폐기만 한다', () => {
  const many = base();
  many.sources.push(src('s3', 'SRC-0903', REF.basket)); many.links.push(link('r2', 's3'));
  assert.deepEqual(mergeCandidates(many), []);
  const shared = base();
  shared.links.push(link('r1', 's9')); shared.sources.push(src('s9', 'SRC-0909', REF.org_update));
  shared.links.push(link('r2', 's9'));
  const [c] = mergeCandidates(shared);
  assert.equal(c.addSource, 'SRC-0902');
  const same = base(); same.links.push(link('r1', 's2'));
  assert.deepEqual(mergeCandidates(same), []);
});

test('후보 수는 한도를 넘지 않는다', () => {
  const pairs = [], records = [], sources = [], links = [];
  for (let i = 0; i < MERGE_LIMIT + 5; i++) {
    const a = `meeting:${U(100 + i)}`, b = `project_update:${U(300 + i)}`;
    pairs.push(pair(a, b));
    records.push(rec(`m${i}`, `EVT-${String(1000 + i)}`, `행사 ${i}번 가상 보고`), rec(`p${i}`, `EVT-${String(2000 + i)}`, `행사 ${i}번 가상 기록`));
    sources.push(src(`sm${i}`, `SRC-${String(1000 + i)}`, a), src(`sp${i}`, `SRC-${String(2000 + i)}`, b));
    links.push(link(`m${i}`, `sm${i}`), link(`p${i}`, `sp${i}`));
  }
  assert.equal(mergeCandidates({ pairs: samePairs(pairs), records, sources, links }).length, MERGE_LIMIT);
});

test('수정 요청: 근거 추가 + 폐기(지우지 않음), 사용자가 보낸 것으로, 항목은 같은 기록을 두 번 가리키지 않는다', () => {
  const [c] = mergeCandidates(base());
  const req = mergeRequest(c);
  assert.deepEqual(req, { format: 'kptu-ledger-fix', version: 1, received_from: 'user', items: [
    { target: 'EVT-0901', do: 'add_source', source: { ledger_id: 'SRC-0902' }, reason: MERGE_REASON },
    { target: 'EVT-0902', do: 'retire', reason: `${MERGE_REASON} · EVT-0901에 근거를 모음` }] });
  assert.equal(new Set(req.items.map(i => i.target)).size, req.items.length);
  assert.equal(mergeRequest({ ...c, addSource: null }).items.length, 1);
  assert.equal(mergeRequest({ ...c, drop: { ...c.drop, ledger_id: c.keep.ledger_id } }), null);
  assert.equal(mergeRequest({ ...c, addSource: 'bad' }), null);
  assert.equal(mergeRequest(null), null);
});

test('미리보기 문구: 일상어, 고정 ID·"틀린 기록" 낱말 없음', () => {
  const [c] = mergeCandidates(base());
  const line = previewText(c);
  assert.match(line, /근거를 더하고/);
  assert.match(line, /지우지 않아요/);
  assert.doesNotMatch(line, /EVT-|SRC-|틀린/);
  assert.match(previewText({ ...c, addSource: null }), /이미 같은 근거/);
  assert.equal(originLabel(c.keep), '사업 보고');
});

test('해 보기 결과가 보낸 요청과 같을 때만 통과', () => {
  const [c] = mergeCandidates(base());
  const req = mergeRequest(c);
  const dry = { dry_run: true, items: [{ target: 'EVT-0901', do: 'add_source' }, { target: 'EVT-0902', do: 'retire' }] };
  assert.equal(dryRunMatches(dry, req), true);
  assert.equal(dryRunMatches({ ...dry, dry_run: false }, req), false);
  assert.equal(dryRunMatches({ ...dry, items: dry.items.slice(0, 1) }, req), false);
  assert.equal(dryRunMatches({ ...dry, items: [dry.items[0], { target: 'EVT-0903', do: 'retire' }] }, req), false);
  assert.equal(dryRunMatches(null, req), false);
});

test('최근 합침: 이 화면이 만든 요청만 인정하고 남은 기록 번호를 찾는다', () => {
  const [c] = mergeCandidates(base());
  const req = mergeRequest(c);
  const noAdd = mergeRequest({ ...c, addSource: null });
  const rows = [
    { id: 'f1', applied_at: '2026-10-26T01:00:00Z', request: req },
    { id: 'f2', applied_at: '2026-10-26T00:00:00Z', request: noAdd },
    { id: 'f3', request: { ...req, received_from: 'claude_chat' } },
    { id: 'f4', request: { ...req, items: [{ target: 'EVT-0902', do: 'retire', reason: '중복' }] } },
    { id: 'f5', request: { ...req, items: [req.items[0]] } },
    { id: 'f6', request: { format: 'kptu-ledger-fix', version: 1, received_from: 'user', items: [{ target: 'EVT-0902', do: 'replace', set: { title: 'x' }, reason: `${MERGE_REASON} x` }] } },
    null,
  ];
  assert.deepEqual(recentMerges(rows).map(r => [r.fixId, r.keep, r.drop]), [['f1', 'EVT-0901', 'EVT-0902'], ['f2', 'EVT-0901', 'EVT-0902']]);
});

test('화면 연결: 원장 화면 틀에 칸이 있고, 모듈은 기존 수정 요청 함수 둘만 쓰며 브라우저 저장소를 쓰지 않는다', () => {
  const read = f => readFileSync(new URL(`../app/${f}`, import.meta.url), 'utf8');
  assert.match(read('ledger-browse.js'), /id="ledgerMergeRoot"/);
  assert.match(read('view-loader.js'), /ledger-merge\.js/);
  const code = read('ledger-merge.js');
  assert.deepEqual([...new Set([...code.matchAll(/rpc\/(\w+)/g)].map(m => m[1]))].sort(), ['app_apply_ledger_fix', 'app_undo_ledger_fix']);
  assert.doesNotMatch(code, new RegExp(['local', 'session'].map(x => x + 'Storage').concat(['indexed' + 'DB']).join('|')));
  assert.doesNotMatch(code, /method:\s*'(PATCH|DELETE)'/);
});
