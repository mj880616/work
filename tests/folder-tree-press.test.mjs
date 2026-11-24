// S69-38 UI-탐색기나무누르기: ftExplorePress — 탐색기 나무 폴더 이름 누르기 = 오른쪽을 그 폴더로(enter) + 접혀 있으면 펼침. 화면 없이 가짜 요소로 시험.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ftExplorePress, explorePressPlan, FOLDER_ENTER_LABEL} from '../app/folder-tree-press.mjs';
import * as press from '../app/folder-tree-press.mjs';

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

test('UI-폴더이름펼치기(명진 11/24 18:09): 하위 없는 폴더 = 한 번에 열기 판정(folderPressAction·createLeafWait)은 없앴다 — 그 자리 펼치는 목록은 늘 펼치기·접기', () => {
  assert.equal(press.folderPressAction, undefined);
  assert.equal(press.createLeafWait, undefined);
  assert.equal(press.FOLDER_PRESS_ENTER, undefined);
});

test('그 폴더만 보기 메뉴 글자는 화면마다 같다', () => {
  assert.equal(FOLDER_ENTER_LABEL, '이 폴더로 들어가기');
});
