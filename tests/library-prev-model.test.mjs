// LIB-이전파일정리: 자료실 [이전 파일 ▾]의 30일·보관 규칙(화면과 서버가 같은 모델을 쓴다). 순수 함수 시험.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRUNE_DAYS, entryState, deleteLabel, setKeep, visibleEntries, markPruned } from '../app/library-prev-model.mjs';

const NOW = Date.parse('2026-11-30T09:00:00Z'), DAY = 86400000;
const e = (days, extra = {}) => ({ file_id: 'f1', replaced_at: new Date(NOW - days * DAY).toISOString(), ...extra });

test('30일, 남은 날 표시, 보관 표시', () => {
  assert.equal(PRUNE_DAYS, 30);
  assert.equal(deleteLabel(e(18), NOW), '12일 뒤 삭제');
  assert.equal(deleteLabel(e(0), NOW), '30일 뒤 삭제');
  assert.equal(deleteLabel(e(30), NOW), '곧 삭제');
  assert.equal(deleteLabel(e(90, { keep_at: new Date(NOW).toISOString() }), NOW), '보관');
  assert.equal(deleteLabel(e(1, { replaced_at: '이상한 값' }), NOW), '');
});

test('보관 해제하면 그날부터 새로 30일, 정리된 항목은 목록에서 빠지고 보관할 수 없음', () => {
  const kept = setKeep([e(90)], 'f1', true, new Date(NOW).toISOString()).list;
  const released = setKeep(kept, 'f1', false, new Date(NOW).toISOString()).list;
  assert.equal(entryState(released[0], NOW).daysLeft, 30);
  const pruned = markPruned([e(40)], 'f1', 'trashed', new Date(NOW).toISOString()).list;
  assert.equal(visibleEntries(pruned).length, 0);
  assert.equal(setKeep(pruned, 'f1', true, new Date(NOW).toISOString()).error, 'already_pruned');
});
