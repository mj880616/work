// FAMILY-기억알림: 가족 '잊지 말기' 노트 줄을 돌아가며 보여 주는 규칙(app/family-remind-model.mjs). 글은 모두 지어낸 것.
import test from 'node:test';
import assert from 'node:assert/strict';
import {lineKey, remindLines, readRemind, pickToday, pickOther, takeLine, putLine, pastLine, pushText} from '../app/family-remind-model.mjs';

const P = t => ({type: 'paragraph', attrs: {style: 'body2'}, content: t ? [{type: 'text', text: t}] : []});
const DOC = (...l) => ({type: 'doc', content: l.map(P)});
const texts = d => d.doc.content.map(n => (n.content || []).map(c => c.text).join(''));
const L = ['☐ 가짜 하나', '가짜 둘', '가짜 셋', '가짜 넷', '가짜 다섯'];

test('줄 = 글이 있는 맨 위 문단, 같은 글은 한 번, 열쇠는 글이 같으면 같다', () => {
  const lines = remindLines(DOC(L[0], '', L[1], L[1], '  ', L[2]));
  assert.deepEqual(lines.map(l => l.text), [L[0], L[1], L[2]]);
  assert.deepEqual(lines.map(l => l.index), [0, 2, 5]);
  assert.equal(lineKey('가'), lineKey('가'));
  assert.notEqual(lineKey('가'), lineKey('나'));
  assert.match(lineKey(L[0]), /^[0-9a-z]{1,13}$/);
  assert.deepEqual(remindLines(null), []);
});

test('본 기록 모양: 다른 모양은 버린다(글은 저장하지 않고 열쇠·날짜만)', () => {
  assert.deepEqual(readRemind(null), {day: '', picks: [], seen: {}});
  assert.deepEqual(readRemind({remind: {day: '2026-1-1', picks: ['ok', 'BAD!', 3], seen: {ok: '2026-10-06', x: 'no', 'BAD!': '2026-10-06'}}}), {day: '', picks: ['ok'], seen: {ok: '2026-10-06'}});
});

test('하루 3줄: 안 본 줄 먼저, 같은 날은 같은 줄(다시 쓰지 않음), 다음 날은 오래 못 본 줄', () => {
  const lines = remindLines(DOC(...L));
  const a = pickToday(lines, readRemind({}), '2026-10-06');
  assert.deepEqual(a.picks.map(p => p.text), L.slice(0, 3));
  assert.equal(a.total, 5);
  assert.equal(a.next.day, '2026-10-06');
  assert.equal(JSON.stringify(a.next).includes('가짜'), false);
  const again = pickToday(lines, readRemind({remind: a.next}), '2026-10-06');
  assert.deepEqual(again.picks.map(p => p.text), L.slice(0, 3));
  assert.equal(again.next, null);
  const tomorrow = pickToday(lines, readRemind({remind: a.next}), '2026-10-07');
  assert.deepEqual(tomorrow.picks.map(p => p.text), [L[0], L[3], L[4]]); // 안 본 둘 + 가장 앞(같은 날 본 셋 중 노트 순서)
  assert.deepEqual(tomorrow.picks.map(p => p.text).filter(t => t !== L[0]), [L[3], L[4]]);
});

test('[↻ 다른 줄]: 지금 줄을 빼고 다음 줄, 줄이 3개 이하면 그대로', () => {
  const lines = remindLines(DOC(...L));
  const a = pickToday(lines, readRemind({}), '2026-10-06');
  const b = pickOther(lines, readRemind({remind: a.next}), '2026-10-06');
  assert.ok(b.picks.some(p => p.text === L[3]) && b.picks.some(p => p.text === L[4]));
  assert.equal(b.picks.length, 3);
  const few = remindLines(DOC(L[0], L[1]));
  assert.deepEqual(pickOther(few, readRemind({}), '2026-10-06').picks.map(p => p.text), [L[0], L[1]]);
});

test('오늘 고른 줄이 노트에서 빠지면 그 자리만 다음 줄로', () => {
  const a = pickToday(remindLines(DOC(...L)), readRemind({}), '2026-10-06');
  const b = pickToday(remindLines(DOC(L[0], L[2], L[3], L[4])), readRemind({remind: a.next}), '2026-10-06');
  assert.deepEqual(b.picks.map(p => p.text), [L[0], L[2], L[3]]);
});

test('줄 빼기·제자리 넣기·과거 기록 줄·폰 알림 글', () => {
  const took = takeLine({v: 'ed1', doc: DOC(...L)}, ' 가짜 둘 ');
  assert.equal(took.index, 1);
  assert.deepEqual(texts(took.doc), [L[0], ...L.slice(2)]);
  assert.equal(takeLine(DOC(...L), '없는 줄'), null);
  assert.deepEqual(texts(putLine(took.doc, took.index, took.node)), L);
  assert.equal(putLine(DOC(...L), 1, took.node), null, '이미 있으면 두 번 넣지 않음');
  const only = takeLine(DOC(L[0]), L[0]);
  assert.deepEqual(texts(putLine(only.doc, 0, only.node)), [L[0]]);
  assert.equal(pastLine('줄', '2026-11-02'), '11/2 · 줄');
  const push = pushText([{text: '☐ 가짜 하나'}, {text: '가'.repeat(40)}]);
  assert.equal(push.title, '가족 · 이번 주 기억할 것 2');
  assert.equal(push.body, `가짜 하나 · ${'가'.repeat(23)}…`);
});
