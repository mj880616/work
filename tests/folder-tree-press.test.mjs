// S69-38·S70-81b TREE-탐색기꺾쇠(T10): ftExplorePress — 탐색기 나무 폴더 이름 누르기(한 번 = 오른쪽 그 폴더, 두 번 = + 펼치기/접기). 화면 없이 가짜 요소로 시험.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ftExplorePress, explorePressPlan, FOLDER_ENTER_LABEL} from '../app/folder-tree-press.mjs';
import * as press from '../app/folder-tree-press.mjs';

let seq = 0;
const fakeRow = ({tog = true, expanded = 'false', current = false} = {}) => {
  const log = [];
  const id = `r${++seq}`;
  const togEl = tog ? {click: () => { log.push('tog'); expanded = expanded === 'true' ? 'false' : 'true'; }, getAttribute: () => expanded, attributes: []} : null;
  const row = {querySelector: () => togEl, classList: {contains: c => c === 'ft-current' && current}};
  const main = {classList: {contains: c => c === 'ft-main'}, closest: () => row, attributes: [{name: 'data-k', value: id}], getAttribute: () => null, isConnected: true, tagName: 'BUTTON', focus: () => log.push('focus')};
  return {main, log};
};
// 가짜 요소라 document·CSS가 없다 — 선택자 만들기에 쓰는 CSS.escape만 둔다.
globalThis.CSS ??= {escape: v => String(v)};
globalThis.document ??= {querySelector: () => null, querySelectorAll: () => []};

test('explorePressPlan: TREE-탐색기꺾쇠(T10, 명진 11/26 09:25) — 이름 한 번 = 오른쪽에 그 폴더(펼침 그대로), 두 번 = 펼치기/접기 + 그 폴더', () => {
  assert.deepEqual(explorePressPlan({canOpen: true}), {enter: true, toggle: false});
  assert.deepEqual(explorePressPlan({canOpen: false}), {enter: true, toggle: false});
  assert.deepEqual(explorePressPlan({canOpen: true, current: true}), {enter: false, toggle: false});
  assert.deepEqual(explorePressPlan({canOpen: true, count: 2}), {enter: true, toggle: true});
  assert.deepEqual(explorePressPlan({canOpen: true, current: true, count: 2}), {enter: false, toggle: true});
  assert.deepEqual(explorePressPlan({canOpen: false, current: true, count: 2}), {enter: false, toggle: false});
  // 키보드 Enter(누르기 수 0)는 한 번 누르기.
  assert.deepEqual(explorePressPlan({canOpen: true, count: 0}), {enter: true, toggle: false});
});

test('ftExplorePress: 닫힌 다른 폴더 이름 한 번 = 오른쪽에 그 폴더만(펼치지 않음), 다시 눌러도 접거나 펼치지 않음', () => {
  const {main, log} = fakeRow();
  const enter = () => log.push('enter');
  assert.equal(ftExplorePress(main, enter, {count: 1}), true);
  assert.deepEqual(log, ['focus', 'enter', 'focus']);
  const open = fakeRow({expanded: 'true'});
  ftExplorePress(open.main, () => open.log.push('enter'), {count: 1});
  assert.deepEqual(open.log, ['focus', 'enter', 'focus']);
  const cur = fakeRow({expanded: 'true', current: true});
  ftExplorePress(cur.main, () => cur.log.push('enter'), {count: 1});
  assert.deepEqual(cur.log, ['focus']);
});

test('ftExplorePress: 두 번 누르기(더블클릭 두 번째) = 펼치기/접기(꺾쇠와 같은 길), 하위 없는 폴더는 그 폴더만', () => {
  // 더블클릭 = 첫 누르기(오른쪽 그 폴더 → 지금 폴더가 됨) + 두 번째 누르기(펼치기).
  const {main, log} = fakeRow({current: true});
  ftExplorePress(main, () => log.push('enter'), {count: 2});
  assert.deepEqual(log, ['tog']);
  ftExplorePress(main, () => log.push('enter'), {count: 2});
  assert.deepEqual(log, ['tog', 'tog']); // 다시 두 번 = 접기
  const leaf = fakeRow({tog: false});
  ftExplorePress(leaf.main, () => leaf.log.push('enter'), {count: 2});
  assert.deepEqual(leaf.log, ['focus', 'enter', 'focus']);
});

test('ftExplorePress: 읽기를 기다린 뒤 다시 그린 줄에 초점 · 여는 길이 없으면 처리하지 않는다', async () => {
  const p = fakeRow({expanded: 'true'});
  let done;
  ftExplorePress(p.main, () => { p.log.push('enter'); return new Promise(r => { done = r; }); }, {count: 1});
  assert.deepEqual(p.log, ['focus', 'enter']);
  done(); await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(p.log, ['focus', 'enter', 'focus']);
  assert.equal(ftExplorePress(p.main), false);
  assert.equal(ftExplorePress(null, () => {}), false);
});

test('ftHoverExpander: 같은 폴더 위에 약 1초 머무르면 한 번 펼치고, 옮기거나 끝나면 취소', async () => {
  const opened = [];
  const h = press.ftHoverExpander(k => opened.push(k), 20);
  h.over('a'); h.over('a');
  await new Promise(r => setTimeout(r, 40));
  assert.deepEqual(opened, ['a']);
  h.over('b'); h.over('c');
  await new Promise(r => setTimeout(r, 40));
  assert.deepEqual(opened, ['a', 'c']);
  h.over('d'); h.stop();
  h.over('e', false);
  await new Promise(r => setTimeout(r, 40));
  assert.deepEqual(opened, ['a', 'c']);
  assert.equal(press.HOVER_EXPAND_MS, 1000);
});

test('UI-폴더이름펼치기(명진 11/24 18:09): 하위 없는 폴더 = 한 번에 열기 판정(folderPressAction·createLeafWait)은 없앴다 — 그 자리 펼치는 목록은 늘 펼치기·접기', () => {
  assert.equal(press.folderPressAction, undefined);
  assert.equal(press.createLeafWait, undefined);
  assert.equal(press.FOLDER_PRESS_ENTER, undefined);
});

test('그 폴더만 보기 메뉴 글자는 화면마다 같다', () => {
  assert.equal(FOLDER_ENTER_LABEL, '이 폴더로 들어가기');
});
