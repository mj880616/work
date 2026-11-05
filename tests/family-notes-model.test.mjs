// FAMILY-잊지말기 4단계: 홈 '잊지 말기' 칸 규칙(app/family-notes-model.mjs). 글은 지어낸 값.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanNotes, suggestions, memoryGroups, metaLine, draftOf, decisionBody, doneBody, openedFromPush, shortDay, NOTE_SELECT} from '../app/family-notes-model.mjs';
const id = n => `f0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rows = [
  {id: id(1), kind: 'plan', body: '토요일에 산책\n가자고 함', said_when: '토요일', firmness: 'planned', origin: 'telegram', origin_day: '2026-11-05', status: 'new'},
  {id: id(2), kind: 'like', body: '소금빵 좋아함', firmness: 'firm', origin: 'call', origin_day: '2026-11-06', status: 'kept', drive_url: 'javascript:alert(1)'},
  {id: id(3), kind: 'ask', body: '우유 사 오기', firmness: 'firm', origin: 'telegram', origin_day: '2026-11-01', status: 'tasked', done_at: '2026-11-02T00:00:00Z'},
  {id: 'not-a-uuid', kind: 'plan', body: 'x', status: 'new'},
  {id: id(5), kind: 'feelings', body: 'x', status: 'new'},
  {id: id(6), kind: 'gift', body: '   ', status: 'new'},
];
test('줄 다듬기: 모양이 틀린 줄은 버리고, 제어문자는 빈칸, 이상한 링크는 비운다', () => {
  const n = cleanNotes(rows);
  assert.deepEqual(n.map(x => x.id), [id(1), id(2), id(3)]);
  assert.equal(n[0].body, '토요일에 산책 가자고 함');
  assert.equal(n[1].driveUrl, '');
  assert.equal(cleanNotes(null).length, 0);
  assert.doesNotMatch(NOTE_SELECT, /raw|text|transcript/);
});
test('제안·기억 나누기와 한 줄 정보', () => {
  const n = cleanNotes(rows);
  assert.deepEqual(suggestions(n).map(x => x.id), [id(1)]);
  const g = memoryGroups(n);
  assert.deepEqual(g.map(x => x.key), ['taste', 'todo']);
  assert.equal(g[1].done.length, 1);
  assert.equal(metaLine(n[0]), '말한 때: 토요일 · 텔레그램 · 11/5');
  assert.equal(shortDay('bad'), '');
  assert.deepEqual(draftOf(n[0]), {title: '토요일에 산책 가자고 함', memo: '말한 때: 토요일'});
});
test('고치는 칸은 상태 칸뿐(제안으로 되돌리면 결정 시각을 비움), 했음은 하자고 한 것 묶음만', () => {
  assert.deepEqual(Object.keys(decisionBody('kept', 't')).sort(), ['decided_at', 'status', 'updated_at']);
  assert.equal(decisionBody('new', 't').decided_at, null);
  assert.equal(decisionBody('deleted', 't'), null);
  const n = cleanNotes(rows);
  assert.deepEqual(Object.keys(doneBody(n[2], true, 't')).sort(), ['done_at', 'updated_at']);
  assert.equal(doneBody(n[1], true, 't'), null);
  assert.equal(openedFromPush('?view=home&family=1'), true);
  assert.equal(openedFromPush('?view=home'), false);
});
