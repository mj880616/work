// S69-38·S70-81 TREE-펼치기먼저: ftExplorePress — 탐색기 나무 폴더 이름 누르기(처음 = 펼치기만, 다시 = 오른쪽을 그 폴더로). 화면 없이 가짜 요소로 시험.
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

test('explorePressPlan: TREE-펼치기먼저(명진 11/26) — 다른 폴더 처음 누르기 = 펼치기만, 펼쳐진·골라진 폴더 = 들어가기, 지금 폴더 = 펼치기만', () => {
  assert.deepEqual(explorePressPlan({open: false, canOpen: true}), {enter: false, expand: true, collapse: false, arm: true});
  assert.deepEqual(explorePressPlan({open: false, canOpen: false}), {enter: false, expand: false, collapse: false, arm: true});
  assert.deepEqual(explorePressPlan({open: true, canOpen: true}), {enter: true, expand: false, collapse: false, arm: false});
  assert.deepEqual(explorePressPlan({open: false, canOpen: false, armed: true}), {enter: true, expand: false, collapse: false, arm: false});
  assert.deepEqual(explorePressPlan({open: false, canOpen: true, current: true}), {enter: false, expand: true, collapse: false, arm: false});
  assert.deepEqual(explorePressPlan({open: true, canOpen: true, current: true}), {enter: false, expand: false, collapse: false, arm: false});
});

test('ftExplorePress: 닫힌 다른 폴더는 첫 누르기에 펼치기만(오른쪽 그대로), 다시 누르면 들어가기 — 접지 않음', () => {
  const {main, log} = fakeRow();
  const enter = () => log.push('enter');
  assert.equal(ftExplorePress(main, enter), true);
  assert.deepEqual(log, ['tog']);
  ftExplorePress(main, enter);
  assert.deepEqual(log, ['tog', 'enter', 'focus']);
});

test('ftExplorePress: 이미 펼쳐진 다른 폴더는 한 번에 들어가기 · 하위 없는 폴더는 골라짐 뒤 두 번째에 · 지금 폴더 이름은 접지 않음', () => {
  const open = fakeRow({expanded: 'true'});
  ftExplorePress(open.main, () => open.log.push('enter'));
  assert.deepEqual(open.log, ['enter', 'focus']);
  const leaf = fakeRow({tog: false});
  ftExplorePress(leaf.main, () => leaf.log.push('enter'));
  assert.deepEqual(leaf.log, ['focus']);
  ftExplorePress(leaf.main, () => leaf.log.push('enter'));
  assert.deepEqual(leaf.log, ['focus', 'enter', 'focus']);
  const cur = fakeRow({expanded: 'true', current: true});
  ftExplorePress(cur.main, () => cur.log.push('enter'));
  assert.deepEqual(cur.log, ['focus']);
});

test('ftExplorePress: 다른 폴더를 누르면 앞 골라짐은 풀린다 · 여는 길이 없으면 처리하지 않는다', async () => {
  const a = fakeRow({tog: false}), b = fakeRow({tog: false});
  ftExplorePress(a.main, () => a.log.push('enter'));
  ftExplorePress(b.main, () => b.log.push('enter'));
  ftExplorePress(a.main, () => a.log.push('enter'));
  assert.deepEqual(a.log, ['focus', 'focus']); // b를 누른 사이 a 골라짐이 풀려 다시 골라짐만
  const p = fakeRow({expanded: 'true'});
  let done;
  ftExplorePress(p.main, () => { p.log.push('enter'); return new Promise(r => { done = r; }); });
  assert.deepEqual(p.log, ['enter']);
  done(); await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(p.log, ['enter', 'focus']);
  assert.equal(ftExplorePress(p.main), false);
  assert.equal(ftExplorePress(null, () => {}), false);
});

test('ftHoverExpander: 같은 폴더 위에 0.6초 머무르면 한 번 펼치고, 옮기거나 끝나면 취소', async () => {
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
  assert.equal(press.HOVER_EXPAND_MS, 600);
});

test('UI-폴더이름펼치기(명진 11/24 18:09): 하위 없는 폴더 = 한 번에 열기 판정(folderPressAction·createLeafWait)은 없앴다 — 그 자리 펼치는 목록은 늘 펼치기·접기', () => {
  assert.equal(press.folderPressAction, undefined);
  assert.equal(press.createLeafWait, undefined);
  assert.equal(press.FOLDER_PRESS_ENTER, undefined);
});

test('그 폴더만 보기 메뉴 글자는 화면마다 같다', () => {
  assert.equal(FOLDER_ENTER_LABEL, '이 폴더로 들어가기');
});
