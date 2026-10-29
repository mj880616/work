import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CARDS, DEFAULT_ORDER, normalizeCards, cardsToPrefs, isDefaultCards, removeCard, addCard, addable, visibleCards, moveCard, stepCard, placement} from '../app/home-cards-model.mjs';

// MENU-HOME-편집: 홈 칸의 기본 순서·빼기·더하기·옮기기 규칙.
test('기본 순서는 지금 홈과 같다: 폰은 한 칸, PC는 왼쪽·오른쪽 칸', () => {
  assert.deepEqual(DEFAULT_ORDER, ['quiet', 'calendar', 'tasks', 'missed', 'inbox', 'tomorrow', 'dday', 'radar', 'meetings', 'collect']);
  assert.deepEqual(placement(DEFAULT_ORDER, true), {main: DEFAULT_ORDER, aside: []});
  assert.deepEqual(placement(DEFAULT_ORDER, false), {main: ['calendar', 'tasks', 'meetings'], aside: ['quiet', 'dday', 'radar', 'collect']});
  assert.ok(isDefaultCards(undefined)); assert.equal(cardsToPrefs(DEFAULT_ORDER), null);
});
test('저장된 값이 이상해도 올바른 목록으로 읽고, 빈 목록은 전부 뺀 것', () => {
  assert.deepEqual(normalizeCards(null), DEFAULT_ORDER); assert.deepEqual(normalizeCards('x'), DEFAULT_ORDER); assert.deepEqual(normalizeCards({}), DEFAULT_ORDER);
  assert.deepEqual(normalizeCards(['tasks', 'zzz', 'tasks', 'calendar', 5]), ['tasks', 'calendar']);
  assert.deepEqual(normalizeCards([]), []);
});
test('빼기·더하기: 뺀 칸은 더하기 목록에 나오고 더하면 맨 아래로 간다', () => {
  const out = removeCard(DEFAULT_ORDER, 'radar');
  assert.ok(!out.includes('radar')); assert.ok(addable(out, true).some(c => c.id === 'radar'));
  assert.deepEqual(addCard(out, 'radar').at(-1), 'radar'); assert.deepEqual(addCard(out, 'zzz'), out); assert.deepEqual(addCard(DEFAULT_ORDER, 'tasks'), DEFAULT_ORDER);
  assert.deepEqual(addable(DEFAULT_ORDER, true).map(c => c.id), ['links', 'notes', 'docs'], '새 칸 셋');
  assert.ok(CARDS.filter(c => c.extra).length === 3);
});
test('PC에서는 폰 전용 칸을 보이지 않고 더하기에도 내놓지 않는다', () => {
  assert.ok(!visibleCards(DEFAULT_ORDER, false).includes('missed'));
  assert.ok(!addable(removeCard(DEFAULT_ORDER, 'missed'), false).some(c => c.id === 'missed'));
  assert.ok(addable(removeCard(DEFAULT_ORDER, 'missed'), true).some(c => c.id === 'missed'));
});
test('옮기기: 보이는 칸 기준 자리, 안 보이는 칸은 제자리', () => {
  const l = moveCard(DEFAULT_ORDER, 'meetings', 0, true);
  assert.equal(l[0], 'meetings'); assert.equal(l.length, DEFAULT_ORDER.length);
  const pc = moveCard(DEFAULT_ORDER, 'meetings', 0, false);
  assert.equal(pc.indexOf('meetings') < pc.indexOf('calendar'), true); assert.deepEqual(pc.filter(x => ['missed', 'inbox', 'tomorrow'].includes(x)), ['missed', 'inbox', 'tomorrow']);
  assert.equal(moveCard(DEFAULT_ORDER, 'calendar', 99, true).at(-1), 'calendar');
  assert.deepEqual(moveCard(DEFAULT_ORDER, 'zzz', 0), DEFAULT_ORDER);
  assert.deepEqual(stepCard(DEFAULT_ORDER, 'quiet', -1, true), DEFAULT_ORDER);
  assert.equal(stepCard(DEFAULT_ORDER, 'calendar', -1, true)[0], 'calendar');
  assert.equal(stepCard(DEFAULT_ORDER, 'calendar', 1, true)[1], 'tasks');
});
