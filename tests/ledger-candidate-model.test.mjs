import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateProblem, candidateFilePayload, candidateView, editPayload, confirmError, undoError, UNDO_SECONDS } from '../app/ledger-candidate-model.mjs';

// AI-서버연동 S7-c: 원장 후보 모양 검사·Claude 후보 파일 묶음·[고쳐서 확정] 내용. 가상 값만.
const ID = '11111111-1111-4111-8111-111111111111';
const row = (over = {}) => ({ id: ID, origin: 'web2_ai', status: 'pending', action: 'new', kind: 'event', title: '가상 사건', sensitivity: 'S1',
  payload: { record: { summary: '가상 요지', date_start: '2026-10-20', date_precision: 'day' }, sources: [{ new: { title: 'Web2 업데이트 2026-10-20', location: 'web2:basket:x' } }],
    links: [{ target_organization: 'ORG-0901', relation: 'direct' }], origin_ref: { kind: 'basket', id: ID, day: '2026-10-20' } }, ...over });

test('후보 모양: 칸·종류·대상·날짜·출처·연결', () => {
  assert.equal(candidateProblem({ kind: 'event', title: '가' }), '');
  assert.equal(candidateProblem({ kind: 'event', title: '가', extra: 1 }), '모르는 칸');
  assert.equal(candidateProblem({ kind: 'note', title: '가' }), '종류');
  assert.equal(candidateProblem({ kind: 'event', title: ' ' }), '제목');
  assert.equal(candidateProblem({ kind: 'event', title: '가', action: 'add_source' }), '대상 기록');
  assert.equal(candidateProblem({ kind: 'event', title: '가', target: 'EVT-0901' }), '대상 기록');
  assert.equal(candidateProblem({ kind: 'event', title: '가', action: 'add_source', target: 'EVT-0901' }), '');
  assert.equal(candidateProblem({ kind: 'event', title: '가', payload: { record: { superseded_by: 'x' } } }), '기록 칸');
  assert.equal(candidateProblem({ kind: 'event', title: '가', payload: { record: { date_start: '2026-02-30' } } }), '날짜');
  assert.equal(candidateProblem({ kind: 'event', title: '가', payload: { record: { validity: 'superseded' } } }), '유효상태');
  assert.equal(candidateProblem({ kind: 'event', title: '가', payload: { sources: [{ source: 'SRC-0901', new: { title: '가' } }] } }), '출처');
  assert.equal(candidateProblem({ kind: 'event', title: '가', payload: { links: [{ target_record: 'EVT-0901', target_organization: 'ORG-0901' }] } }), '연결 대상');
});

test('Claude 후보 파일: S3·개인정보 모양은 빼고 개수만, 모양이 틀리면 거부', () => {
  const r = candidateFilePayload({ format: 'kptu-ledger-import', version: 1, kind: 'candidates', label: '가상 이관', candidates: [
    { kind: 'event', title: '가상 사건' }, { kind: 'commitment', title: '가상 약속', payload: { record: { counterparty: '가상 기관' } } },
    { kind: 'event', title: '가상 민감', sensitivity: 'S3' }, { kind: 'event', title: '연락처 010-1234-5678' }] }, 'a'.repeat(64));
  assert.deepEqual({ excluded: r.excluded, personal: r.personal, invalid: r.invalid, kinds: r.kinds }, { excluded: 1, personal: 1, invalid: [], kinds: { event: 1, commitment: 1 } });
  assert.equal(r.payload.candidates.length, 2);
  assert.equal(r.payload.sha256, 'a'.repeat(64));
  assert.deepEqual(r.payload.report, { total: 4, excluded: 1, personal: 1 });
  assert.ok(!JSON.stringify(r.payload).includes('010-1234-5678'));
  const bad = candidateFilePayload({ candidates: [{ kind: 'event' }] }, 'b'.repeat(64));
  assert.deepEqual(bad.invalid, [{ index: 0, reason: '제목' }]);
  assert.equal(candidateFilePayload({}, 'c'.repeat(64)).invalid[0].reason, 'candidates 배열');
});

test('표시: 모양이 맞는 행만, 원래 Web2 기록·날짜', () => {
  const v = candidateView(row());
  assert.equal(v.kindLabel, '일어난 일'); assert.equal(v.kindHint, '추적할 일 하나(원장의 사건)'); assert.equal(v.originLabel, 'Web2 AI'); assert.equal(v.date, '2026-10-20');
  assert.deepEqual(v.originRef, { label: '업데이트', day: '2026-10-20' });
  assert.equal(candidateView(row({ id: 'x' })), null);
  assert.equal(candidateView(row({ kind: 'bogus' })), null);
  assert.equal(candidateView(row({ payload: null })), null);
});

test('[고쳐서 확정]: 고친 칸만 내용에 넣고, 출처·연결은 그대로', () => {
  const v = candidateView(row({ kind: 'commitment' }));
  assert.match(editPayload(v, { title: '가상 약속', sensitivity: 'S1' }).error, /상대측/);
  assert.match(editPayload(v, { title: '가상 약속', sensitivity: 'S3', counterparty: '가' }).error, /S3/);
  assert.match(editPayload(v, { title: '', sensitivity: 'S1' }).error, /제목/);
  assert.match(editPayload(v, { title: '가', sensitivity: 'S1', counterparty: '가', follow_up_on: '2026-13-01', date_start: '2026-10-20' }).error, /후속확인일/);
  const { edit } = editPayload(v, { title: '  가상 기관 자료 회신 ', sensitivity: 'S2', summary: '고친 요지', date_start: '2026-10-21', scope: 'work', counterparty: '가상 기관', commitment_status: 'waiting', follow_up_on: '2026-10-30', note: '' });
  assert.equal(edit.title, '가상 기관 자료 회신'); assert.equal(edit.sensitivity, 'S2');
  assert.deepEqual(edit.payload.record, { summary: '고친 요지', date_start: '2026-10-21', date_precision: 'day', scope: 'work', counterparty: '가상 기관', commitment_status: 'waiting', follow_up_on: '2026-10-30' });
  assert.deepEqual(edit.payload.sources, v.payload.sources); assert.deepEqual(edit.payload.links, v.payload.links);
  // 기준일을 지우면 날짜 모름으로.
  const cleared = editPayload(candidateView(row()), { title: '가', sensitivity: 'S1', date_start: '' }).edit.payload.record;
  assert.equal(cleared.date_precision, 'unknown'); assert.equal(cleared.date_start, undefined);
});

test('확정 오류는 일상어로', () => {
  assert.match(confirmError({ message: 'LEDGER_CANDIDATE_DECIDED: x' }), /이미 확정하거나 버린/);
  assert.match(confirmError({ message: 'LEDGER_CANDIDATE_BROKEN_REF: record EVT-0999' }), /EVT-0999/);
  assert.match(confirmError({ message: 'LEDGER_ID_PREFIX_MISSING: no id prefix for event' }), /번호표/);
  assert.match(confirmError({ message: 'something else' }), /확정하지 못했습니다/);
});

test('확정 취소 오류는 일상어로, 되돌리기 시간은 10초', () => {
  assert.equal(UNDO_SECONDS, 10);
  assert.match(undoError({ message: 'LEDGER_UNDO_RECORD_CHANGED: the record was edited after confirmation' }), /확정 뒤 이 기록/);
  assert.match(undoError({ message: 'LEDGER_UNDO_REFERENCED: another record' }), /가리키고 있어/);
  assert.match(undoError({ message: 'LEDGER_UNDO_TARGET_CHANGED: x' }), /대체한 기록/);
  assert.match(undoError({ message: 'LEDGER_UNDO_IMPORTED: x' }), /가져오기/);
  assert.match(undoError({ message: 'LEDGER_UNDO_DUPLICATE_PENDING: x' }), /같은 내용의 대기 후보/);
  assert.match(undoError({ message: 'LEDGER_UNDO_NOT_CONFIRMED: x' }), /이미 대기로/);
  assert.match(undoError({ message: 'permission denied for function' }), /소유자만/);
  assert.match(undoError({ status: 0, message: 'network' }), /연결이 끊겨/);
  assert.match(undoError({ message: 'something else' }), /확정을 취소하지 못했습니다/);
});
