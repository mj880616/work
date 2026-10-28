import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMeetingDraft } from '../supabase/functions/meeting-ai-draft/parse.mjs';

test('parses schema output including Korean newlines', () => {
  const parsed = parseMeetingDraft('{"decisions":"- 확정\\n- 시행","actions":[{"task":"자료 작성","assignee":"김명진","due":"2026-09-20"}],"information":"공유"}');
  assert.equal(parsed.draft.decisions, '- 확정\n- 시행');
  assert.equal(parsed.draft.actions[0].task, '자료 작성');
  assert.deepEqual(parsed.warnings, []);
});

test('extracts JSON from a code fence with introductory text', () => {
  const parsed = parseMeetingDraft('회의 결과입니다.\n```json\n{"decisions":"확정","actions":[],"information":"경과"}\n```');
  assert.equal(parsed.draft.decisions, '확정');
});

test('preserves non-JSON output for human review', () => {
  const raw = '중요 결정 사항\n- 안전인력 요구';
  const parsed = parseMeetingDraft(raw);
  assert.equal(parsed.draft.information, raw);
  assert.deepEqual(parsed.draft.actions, []);
  assert.ok(parsed.warnings.length);
});

test('rejects empty output without losing the input in the caller', () => {
  assert.throws(() => parseMeetingDraft('  '), /비어/);
});

test('does not use malformed action objects as confirmed tasks', () => {
  const parsed = parseMeetingDraft('{"decisions":"","actions":[{"task":"확인","assignee":null,"due":""}],"information":""}');
  assert.deepEqual(parsed.draft.actions, []);
  assert.ok(parsed.draft.information.includes('확인'));
});

test('keeps valid fields and warns when other schema fields are missing', () => {
  const parsed = parseMeetingDraft('{"decisions":"안건 확정"}');
  assert.equal(parsed.draft.decisions, '안건 확정');
  assert.deepEqual(parsed.draft.actions, []);
  assert.ok(parsed.warnings.some(w => w.includes('필드')));
});

test('extracts JSON surrounded by an explanatory sentence', () => {
  const parsed = parseMeetingDraft('아래에 초안을 정리했습니다. {"decisions":"확정","actions":[],"information":"공유"} 검토해 주세요.');
  assert.equal(parsed.draft.information, '공유');
});

test('MTG-녹음초안: meeting_date·attendees are kept only in the expected shape', () => {
  const parsed = parseMeetingDraft('{"decisions":"확정함.","actions":[],"information":"","meeting_date":"2026-10-29","attendees":["김OO"," 이OO ","김OO","[확인 필요]",3]}');
  assert.equal(parsed.draft.meeting_date, '2026-10-29');
  assert.deepEqual(parsed.draft.attendees, ['김OO', '이OO']);
  assert.deepEqual(parsed.warnings, []);
  const bad = parseMeetingDraft('{"decisions":"확정함.","actions":[],"information":"","meeting_date":"10월 29일","attendees":[]}');
  assert.equal('meeting_date' in bad.draft, false);
  assert.equal('attendees' in bad.draft, false);
});
