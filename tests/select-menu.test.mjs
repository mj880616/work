import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectItems, startPosition, stepPosition, edgePosition, matchPosition, placeMenu, eligible} from '../app/select-menu.js';

// 브라우저 없이 쓰는 최소 select 흉내(옵션·그룹·선택 위치).
function fakeSelect(spec, selectedIndex = 0) {
  let index = 0;
  const mk = o => ({tagName: 'OPTION', value: o.v, label: o.l, textContent: o.l, hidden: !!o.hidden, disabled: !!o.disabled, index: index++});
  const children = spec.map(x => x.group ? {tagName: 'OPTGROUP', label: x.group, hidden: false, disabled: !!x.disabled, children: x.options.map(mk)} : mk(x));
  return {children, selectedIndex};
}

test('옵션·그룹 목록: 숨김 옵션은 빼고, 비활성·고른 줄을 표시', () => {
  const s = fakeSelect([{v: '', l: '모든 방'}, {v: 'a', l: '가상지부 단톡'}, {v: 'h', l: '숨김', hidden: true}, {group: '묶음', options: [{v: 'b', l: '예시 간부방'}, {v: 'c', l: '', disabled: true}]}], 1);
  const items = selectItems(s);
  assert.deepEqual(items.map(x => x.type === 'group' ? 'G:' + x.label : x.label + (x.selected ? '*' : '') + (x.disabled ? '!' : '')), ['모든 방', '가상지부 단톡*', 'G:묶음', '예시 간부방', '—!']);
});

test('시작 위치·화살표 이동은 고를 수 있는 줄만, 끝에서 멈춘다', () => {
  const items = selectItems(fakeSelect([{group: 'g', options: [{v: 'x', l: '가'}, {v: 'y', l: '나', disabled: true}, {v: 'z', l: '다'}]}], 2));
  assert.equal(startPosition(items), 3);
  assert.equal(stepPosition(items, 1, 1), 3);
  assert.equal(stepPosition(items, 3, 1), 3);
  assert.equal(stepPosition(items, 1, -1), 1);
  assert.equal(edgePosition(items, 1), 1);
  assert.equal(edgePosition(items, -1), 3);
  assert.equal(startPosition(selectItems(fakeSelect([{v: '', l: 'x', disabled: true}]))), -1);
});

test('글자 입력으로 찾기: 같은 글자 반복은 다음 줄로, 긴 글자는 접두어', () => {
  const items = selectItems(fakeSelect([{v: '1', l: '가나'}, {v: '2', l: '다라'}, {v: '3', l: '가다'}]));
  assert.equal(matchPosition(items, '가', 0), 2);
  assert.equal(matchPosition(items, '가', 2), 0);
  assert.equal(matchPosition(items, '가다', 0), 2);
  assert.equal(matchPosition(items, '파', 0), -1);
});

const view = {left: 0, top: 0, width: 390, bottom: 800};
test('목록 위치: 칸 바로 아래, 칸과 같은 폭', () => {
  const p = placeMenu({anchor: {left: 20, top: 100, bottom: 132, width: 200}, view, inset: 56, contentH: 120});
  assert.equal(p.side, 'below'); assert.equal(p.left, 20); assert.equal(p.width, 200); assert.equal(p.top, 134); assert.equal(p.height, 120);
});

test('목록 위치: 아래가 하단바에 가리면 위로 펼치고, 긴 목록은 높이를 줄여 안에서 스크롤', () => {
  const up = placeMenu({anchor: {left: 20, top: 650, bottom: 682, width: 200}, view, inset: 56, contentH: 200});
  assert.equal(up.side, 'above'); assert.equal(up.top + up.height, 648);
  const tall = placeMenu({anchor: {left: 20, top: 100, bottom: 132, width: 200}, view, inset: 56, contentH: 2000});
  assert.equal(tall.side, 'below'); assert.equal(tall.height, 320); assert.ok(tall.top + tall.height <= 800 - 56 - 8);
  const edge = placeMenu({anchor: {left: 20, top: 400, bottom: 432, width: 200}, view, inset: 56, contentH: 2000, maxHeight: 2000});
  assert.ok(edge.top + edge.height <= 800 - 56 - 8);
});

test('목록 위치: 좁은 칸은 최소 폭, 오른쪽 끝 칸은 화면 안으로', () => {
  const p = placeMenu({anchor: {left: 350, top: 10, bottom: 42, width: 40}, view, contentH: 50});
  assert.equal(p.width, 96); assert.equal(p.left, 390 - 96 - 8);
  assert.equal(placeMenu({anchor: {left: 0, top: 10, bottom: 42, width: 900}, view, contentH: 50}).width, 374);
});

test('대상: 여러 줄 고르기·비활성·data-native-select는 앱 목록으로 바꾸지 않는다', () => {
  const base = {tagName: 'SELECT', multiple: false, size: 0, disabled: false, hasAttribute: () => false};
  assert.equal(eligible(base), true);
  assert.equal(eligible({...base, multiple: true}), false);
  assert.equal(eligible({...base, size: 4}), false);
  assert.equal(eligible({...base, disabled: true}), false);
  assert.equal(eligible({...base, hasAttribute: n => n === 'data-native-select'}), false);
  assert.equal(eligible({...base, tagName: 'INPUT'}), false);
});
