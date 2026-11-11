// UI-폴더누르기한규칙(S57-5): ftPressToggle — 폴더 이름 누르기 = 아이콘 단추 누르기(펼치기·접기), 들어가지 않음. 화면 없이 가짜 요소로 시험.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ftPressToggle, FOLDER_ENTER_LABEL, folderPressAction, FOLDER_PRESS_ENTER, FOLDER_PRESS_TOGGLE, createLeafWait} from '../app/folder-tree-press.mjs';

const fakeRow = ({hasTog = true, tog = true, expanded = 'false'} = {}) => {
  const log = [];
  const togEl = tog ? {click: () => log.push('tog'), getAttribute: () => expanded} : null;
  const row = {matches: sel => sel === '.ft-has-tog' && hasTog, querySelector: () => togEl};
  const main = {classList: {contains: c => c === 'ft-main'}, closest: sel => (sel === '.ft-row' ? row : null), attributes: []};
  return {main, log};
};

test('ftPressToggle: 아이콘 단추가 있는 폴더 줄 이름 누르기 = 아이콘 단추를 눌러 처리했다고 알린다', () => {
  const {main, log} = fakeRow();
  assert.equal(ftPressToggle(main), true);
  assert.deepEqual(log, ['tog']);
});

test('ftPressToggle: 하위 폴더가 없는 폴더(아이콘 단추 없음)는 한 번 누르면 그 폴더를 연다(OPS-빠진일2차 1, 명진 11/11 14:55 가)', () => {
  const {main, log} = fakeRow({tog: false});
  assert.equal(ftPressToggle(main, () => log.push('enter')), true);
  assert.deepEqual(log, ['enter']);
  // 여는 길을 넘기지 않은 곳은 처리만 하고 아무 일도 하지 않는다(펼치지 않음).
  const other = fakeRow({tog: false});
  assert.equal(ftPressToggle(other.main), true);
  assert.deepEqual(other.log, []);
});

test('ftPressToggle: 아이콘 단추가 있는(하위 폴더가 있거나 아직 모르는) 폴더는 열지 않고 펼치기·접기만', () => {
  const {main, log} = fakeRow();
  assert.equal(ftPressToggle(main, () => log.push('enter')), true);
  assert.deepEqual(log, ['tog']);
});

test('folderPressAction: 펼쳐 보일 것이 있으면 펼치기, 없으면 열기, 모르면 펼치며 읽기 — 모든 나무·목록이 같은 판정', () => {
  // 폴더만 보이는 나무(PC·폴드 왼쪽 나무): 하위 폴더가 없는 폴더 = 열기
  assert.equal(folderPressAction(3), FOLDER_PRESS_TOGGLE);
  assert.equal(folderPressAction(1), FOLDER_PRESS_TOGGLE);
  assert.equal(folderPressAction(true), FOLDER_PRESS_TOGGLE);
  assert.equal(folderPressAction(0), FOLDER_PRESS_ENTER);
  assert.equal(folderPressAction(false), FOLDER_PRESS_ENTER);
  assert.equal(folderPressAction(null), FOLDER_PRESS_TOGGLE);
  assert.equal(folderPressAction(undefined), FOLDER_PRESS_TOGGLE);
  // 안 자료까지 들여 보이는 목록·폰 나무: 하위 폴더가 없어도 안 자료가 있으면 그 자리 펼치기(처음 5개 + n개 더 보기, 펼친 폴더 안 놓기 그대로), 빈 폴더만 열기
  assert.equal(folderPressAction(0, 4), FOLDER_PRESS_TOGGLE);
  assert.equal(folderPressAction(0, 0), FOLDER_PRESS_ENTER);
  assert.equal(folderPressAction(2, 0), FOLDER_PRESS_TOGGLE);
  assert.equal(folderPressAction(0, null), FOLDER_PRESS_TOGGLE); // 장수를 모르면 있다고 본다
});

test('createLeafWait: 읽기 전 폴더를 눌렀다가, 읽어 보니 하위 폴더가 없으면 그때 연다 — 다른 것을 누르면 잊는다', () => {
  const w = createLeafWait(), log = [];
  w.arm('a');
  assert.equal(w.key, 'a');
  assert.equal(w.done('b', 0, () => log.push('b')), false); // 다른 폴더의 읽기는 상관없음
  assert.equal(w.done('a', 0, () => log.push('a')), true);
  assert.deepEqual(log, ['a']);
  assert.equal(w.key, null);
  w.arm('c');
  assert.equal(w.done('c', 2, () => log.push('c')), false); // 하위 폴더가 있으면 열지 않음(펼친 채)
  w.arm('e');
  assert.equal(w.done('e', 0, () => log.push('e'), 3), false); // 안 자료가 있으면 열지 않음(펼친 채)
  w.arm('d'); w.clear();
  assert.equal(w.done('d', 0, () => log.push('d')), false); // 그 사이 다른 것을 누름
  assert.deepEqual(log, ['a']);
});

test('ftPressToggle: toggle 줄이 아니면(자료실 전체·폴더 밖 등) 처리하지 않는다', () => {
  const {main, log} = fakeRow({hasTog: false});
  assert.equal(ftPressToggle(main), false);
  assert.deepEqual(log, []);
  assert.equal(ftPressToggle(null), false);
  assert.equal(ftPressToggle({classList: {contains: () => false}, closest: () => null}), false);
});

test('그 폴더만 보기 메뉴 글자는 화면마다 같다', () => {
  assert.equal(FOLDER_ENTER_LABEL, '이 폴더로 들어가기');
});
