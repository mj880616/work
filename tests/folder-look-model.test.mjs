import test from 'node:test';
import assert from 'node:assert/strict';
import {dropZone, placeAt, stepPlan, isSamePlace, colorOf, isFolderColor, orderedSiblings, sortNotesManual, noteOrderOf, FOLDER_COLORS, ORDER_GAP} from '../app/folder-look-model.mjs';

test('색: 1~8 정수만, 나머지는 기본(null)', () => {
  assert.equal(FOLDER_COLORS.length, 8);
  for (const v of [1, 8]) assert.equal(isFolderColor(v), true);
  for (const v of [0, 9, 1.5, '3', null, undefined, NaN]) assert.equal(isFolderColor(v), false);
  assert.equal(colorOf({color: 4}), 4);
  assert.equal(colorOf({color: 12}), null);
  assert.equal(colorOf(null), null);
});

test('끌기 자리: 위 25%·가운데 50%·아래 25%', () => {
  const rect = {top: 100, height: 40};
  assert.equal(dropZone(rect, 105), 'before');
  assert.equal(dropZone(rect, 109.9), 'before');
  assert.equal(dropZone(rect, 110), 'inside');
  assert.equal(dropZone(rect, 120), 'inside');
  assert.equal(dropZone(rect, 130), 'inside');
  assert.equal(dropZone(rect, 130.1), 'after');
  assert.equal(dropZone(rect, 139), 'after');
  assert.equal(dropZone(rect, 119, {canInside: false}), 'before');
  assert.equal(dropZone(rect, 121, {canInside: false}), 'after');
  assert.equal(dropZone({top: 0, height: 0}, 5), 'after');
});

const rows = (...orders) => orders.map((o, i) => ({id: 'r' + i, sort_order: o}));
test('순서 값: 사이·맨 앞·맨 뒤·틈 없음', () => {
  const s = rows(1024, 2048, 3072);
  assert.deepEqual(placeAt(s, 'x', 0), [{id: 'x', order: 0}]);
  assert.deepEqual(placeAt(s, 'x', 1), [{id: 'x', order: 1536}]);
  assert.deepEqual(placeAt(s, 'x', 3), [{id: 'x', order: 4096}]);
  const tight = rows(10, 11, 12);
  const plan = placeAt(tight, 'x', 1);
  assert.equal(plan.length, 4);
  assert.deepEqual(plan.map(p => p.id), ['r0', 'x', 'r1', 'r2']);
  assert.deepEqual(plan.map(p => p.order), [1, 2, 3, 4].map(n => n * ORDER_GAP));
  assert.deepEqual(placeAt([], 'x', 0), [{id: 'x', order: ORDER_GAP}]);
});
test('순서 값: 끌고 있는 줄을 뺀 목록 기준, 값 없는 줄이 있으면 전체 다시 매김', () => {
  const s = rows(1024, 2048, 3072);
  // r0을 r1 뒤로(빼고 보면 [r1, r2]에서 자리 1)
  assert.deepEqual(placeAt(s, 'r0', 1), [{id: 'r0', order: 2560}]);
  const mixed = [{id: 'a', sort_order: 5}, {id: 'b'}, {id: 'c', sort_order: 9}];
  const plan = placeAt(mixed, 'c', 0);
  assert.deepEqual(plan.map(p => p.id), ['c', 'a', 'b']);
  assert.deepEqual(plan.map(p => p.order), [1024, 2048, 3072]);
});
test('위로·아래로, 제자리', () => {
  const s = rows(1024, 2048, 3072);
  assert.deepEqual(stepPlan(s, 'r1', -1), [{id: 'r1', order: 0}]);
  assert.deepEqual(stepPlan(s, 'r1', 1), [{id: 'r1', order: 4096}]);
  assert.deepEqual(stepPlan(s, 'r0', -1), []);
  assert.deepEqual(stepPlan(s, 'r2', 1), []);
  assert.deepEqual(stepPlan(s, 'none', 1), []);
  assert.equal(isSamePlace(s, 'r1', 1), true);
  assert.equal(isSamePlace(s, 'r1', 0), false);
});
test('형제 줄 세우기', () => {
  const list = [{id: 'b', sort_order: 2, created_at: '1'}, {id: 'a', sort_order: 1}, {id: 'c', sort_order: 2, created_at: '0'}];
  assert.deepEqual(orderedSiblings(list).map(r => r.id), ['a', 'c', 'b']);
});
test('노트 순서: 고정 위, 값 있는 노트 순서대로, 값 없는 노트는 고친 날 순으로 뒤', () => {
  const n = (id, order, updated, pin) => ({id, updated_at: updated, metadata: {...(order === undefined ? {} : {order}), ...(pin ? {pinned_at: pin} : {})}});
  const notes = [n('a', 3072, '2026-01-01'), n('b', 1024, '2026-01-02'), n('c', undefined, '2026-01-05'), n('d', undefined, '2026-01-09'), n('p', 5, '2026-01-01', '2026-02-01T00:00:00Z')];
  const pinned = x => x.metadata.pinned_at || null;
  assert.deepEqual(sortNotesManual(notes, pinned).map(x => x.id), ['p', 'b', 'a', 'd', 'c']);
  assert.equal(noteOrderOf({metadata: {order: 1.5}}), null);
  assert.equal(noteOrderOf({metadata: {order: '7'}}), null);
  assert.equal(noteOrderOf({metadata: {order: 7}}), 7);
});
test('칠한 폴더 그림 공용: 닫힘·열림 모양이 다르고 색 글자는 그림 안에 없다(색은 data-fc 한 곳)', async () => {
  const {folderShapeHtml} = await import('../app/folder-look-model.mjs');
  const closed = folderShapeHtml('closed'), open = folderShapeHtml('open');
  assert.notEqual(closed, open);
  assert.match(closed, /^<svg viewBox="0 0 16 16"/);
  assert.doesNotMatch(closed + open, /#[0-9a-f]{3,6}|rgb\(/i);
});

import {prefKey, prefsMapFrom, orderByPrefs, prefStepPlan, albumOrderOf, albumStepPlan} from '../app/folder-look-model.mjs';
test('prefs map: valid rows only, color checked, order integer or null', () => {
  const m = prefsMapFrom([{source: 'od', folder_key: 'a', color: 3, sort_order: 1024}, {source: 'gd', folder_key: 'a', color: 9, sort_order: 1.5}, {source: 'od'}, null, {source: 'od', folder_key: '', color: 1}]);
  assert.equal(m.size, 2);
  assert.deepEqual(m.get(prefKey('od', 'a')), {color: 3, sort_order: 1024});
  assert.deepEqual(m.get(prefKey('gd', 'a')), {color: null, sort_order: null});
  assert.deepEqual([...prefsMapFrom(null)], []);
});
test('orderByPrefs: set order first (by value, stable), the rest keep their name order after', () => {
  const list = ['가', '나', '다', '라', '마'].map(id => ({id}));
  const o = {'다': 1, '가': 5, '마': 5};
  assert.deepEqual(orderByPrefs(list, r => o[r.id] ?? null).map(r => r.id), ['다', '가', '마', '나', '라']);
  assert.deepEqual(orderByPrefs(list, () => null).map(r => r.id), ['가', '나', '다', '라', '마']);
});
test('prefStepPlan: renumbers all siblings when some have no order, one value when there is a gap, nothing at the ends', () => {
  const none = () => null;
  const first = prefStepPlan(['a', 'b', 'c'], 'c', -1, none);
  assert.deepEqual(first, [{k: 'a', o: 1024}, {k: 'c', o: 2048}, {k: 'b', o: 3072}]);
  const ord = {a: 1024, b: 2048, c: 3072};
  assert.deepEqual(prefStepPlan(['a', 'b', 'c'], 'c', -1, k => ord[k]), [{k: 'c', o: 1536}]);
  assert.deepEqual(prefStepPlan(['a', 'b', 'c'], 'a', -1, k => ord[k]), []);
  assert.deepEqual(prefStepPlan(['a', 'b', 'c'], 'c', 1, k => ord[k]), []);
  assert.deepEqual(prefStepPlan(['a', 'b', 'c'], 'zz', 1, k => ord[k]), []);
});
test('album order: 0 = not set; step plan uses the same renumber rule', () => {
  assert.equal(albumOrderOf({sort_order: 0}), null);
  assert.equal(albumOrderOf({sort_order: 2048}), 2048);
  assert.equal(albumOrderOf({}), null);
  assert.deepEqual(albumStepPlan(['x', 'y'], 'y', -1, () => null), [{id: 'y', o: 1024}, {id: 'x', o: 2048}]);
});
