// S69-38 UI-탐색기나무누르기: ftExplorePress — 탐색기 나무 폴더 이름 누르기 = 오른쪽을 그 폴더로(enter) + 접혀 있으면 펼침. 화면 없이 가짜 요소로 시험.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ftExplorePress, explorePressPlan, FOLDER_ENTER_LABEL, folderPressAction, FOLDER_PRESS_ENTER, FOLDER_PRESS_TOGGLE, createLeafWait} from '../app/folder-tree-press.mjs';

const fakeRow = ({tog = true, expanded = 'false', current = true} = {}) => {
  const log = [];
  const togEl = tog ? {click: () => log.push('tog'), getAttribute: () => expanded, attributes: []} : null;
  const row = {querySelector: () => togEl, classList: {contains: c => c === 'ft-current' && current}};
  const main = {classList: {contains: c => c === 'ft-main'}, closest: () => row, attributes: [], isConnected: true, tagName: 'BUTTON', focus: () => log.push('focus')};
  return {main, log};
};

test('explorePressPlan: 늘 그 폴더로 들어가고, 이름 누르기로 펼치기·접기(명진 11/24 15:42)', () => {
  assert.deepEqual(explorePressPlan({open: false, canOpen: true}), {enter: true, expand: true, collapse: false});
  assert.deepEqual(explorePressPlan({open: true, canOpen: true}), {enter: true, expand: false, collapse: true});
  assert.deepEqual(explorePressPlan({open: false, canOpen: false}), {enter: true, expand: false, collapse: false});
  assert.deepEqual(explorePressPlan({open: true, canOpen: true, current: false}), {enter: true, expand: true, collapse: false});
});

test('ftExplorePress: 하위 폴더가 있는 상위 폴더도 오른쪽을 그 폴더로 바꾸고 접혀 있으면 펼친다', () => {
  const {main, log} = fakeRow();
  assert.equal(ftExplorePress(main, () => log.push('enter')), true);
  assert.deepEqual(log, ['enter', 'tog']);
});

test('ftExplorePress: 이미 펼친 폴더는 들어가며 접고, 하위 폴더가 없는 폴더는 들어가기만', () => {
  const open = fakeRow({expanded: 'true'});
  ftExplorePress(open.main, () => open.log.push('enter'));
  assert.deepEqual(open.log, ['enter', 'tog']);
  const other = fakeRow({expanded: 'true', current: false}); // 펼쳐만 둔 다른 폴더 = 들어가기만(접지 않음)
  ftExplorePress(other.main, () => other.log.push('enter'));
  assert.deepEqual(other.log, ['enter', 'focus']);
  const leaf = fakeRow({tog: false});
  ftExplorePress(leaf.main, () => leaf.log.push('enter'));
  assert.deepEqual(leaf.log, ['enter', 'focus']);
});

test('ftExplorePress: enter가 서버에서 읽는 동안(Promise)은 끝난 뒤 펼친다 · 여는 길이 없으면 처리하지 않는다', async () => {
  const {main, log} = fakeRow();
  let done;
  ftExplorePress(main, () => { log.push('enter'); return new Promise(r => { done = r; }); });
  assert.deepEqual(log, ['enter']);
  done(); await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(log, ['enter', 'tog']);
  assert.equal(ftExplorePress(main), false);
  assert.equal(ftExplorePress(null, () => {}), false);
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

test('그 폴더만 보기 메뉴 글자는 화면마다 같다', () => {
  assert.equal(FOLDER_ENTER_LABEL, '이 폴더로 들어가기');
});
