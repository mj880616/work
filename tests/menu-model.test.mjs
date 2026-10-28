import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ITEMS, BAR_MAX, DEFAULT_BAR, DEFAULT_REST, defaultLayout, normalizeLayout, isDefaultLayout, layoutToPrefs, moveItem, stepItem, pcOrder, pcSplit, midKeys, barItemForView, menuSheetViews} from '../app/menu-model.mjs';
import {dropIndex} from '../app/reorder-drag.js';

// MENU-HOME-편집: 메뉴 순서의 결정 규칙을 한 곳에서 시험한다(PC 왼쪽 메뉴·폰 하단바·폰 [메뉴] 창이 모두 이 규칙을 읽는다).
test('기본 구성은 지금 화면과 같고 모든 항목이 정확히 한 번 나온다', () => {
  const d = defaultLayout();
  assert.deepEqual(d.bar, ['home', 'basket', 'calendar', 'projects', 'team']);
  // PHOTO-사진메뉴: [사진]은 처음 자리가 [메뉴] 창 안(원장 다음, 통화·텔레그램 위).
  assert.deepEqual(d.rest, ['note', 'meetings', 'library', 'hwp', 'pages', 'ledger', 'photos', 'calls', 'telegram', 'arsenal']);
  assert.deepEqual([...d.bar, ...d.rest].sort(), ITEMS.map(i => i.id).sort());
  assert.equal(d.bar.length, BAR_MAX);
  assert.ok(isDefaultLayout(d)); assert.equal(layoutToPrefs(d), null);
});

test('저장된 값이 이상해도 언제나 올바른 구성으로 읽는다', () => {
  for (const bad of [null, undefined, 5, 'x', [], {}, {bar: 'home'}, {bar: [1, null], rest: {}}]) assert.deepEqual(normalizeLayout(bad), defaultLayout(), JSON.stringify(bad));
  const n = normalizeLayout({bar: ['note', 'zzz', 'note', 'home', 'team'], rest: ['team', 'library', 'library']});
  assert.deepEqual(n.bar, ['home', 'note', 'team'], '홈 맨 앞, 겹침·모르는 이름 제거');
  assert.ok(n.rest.includes('library') && !n.rest.includes('team') && !n.rest.includes('note'));
  assert.deepEqual([...n.bar, ...n.rest].sort(), ITEMS.map(i => i.id).sort(), '빠진 항목은 [메뉴] 쪽 끝에 붙는다');
  const over = normalizeLayout({bar: ['home', 'basket', 'calendar', 'note', 'projects', 'team', 'library'], rest: []});
  assert.equal(over.bar.length, BAR_MAX); assert.deepEqual(over.rest.slice(0, 2), ['team', 'library'], '넘친 칸은 [메뉴] 쪽 맨 앞');
});

test('옮기기: 홈은 고정, 하단바는 5칸까지, 위·아래 칸 사이로 넣고 뺀다', () => {
  const d = defaultLayout();
  assert.equal(moveItem(d, 'home', 'rest', 0).reason, 'fixed');
  assert.equal(moveItem(d, 'note', 'bar', 1).reason, 'full', '가득 찬 하단바에는 못 넣는다');
  const out = moveItem(d, 'team', 'rest', 0);
  assert.ok(out.ok); assert.deepEqual(out.layout.bar, ['home', 'basket', 'calendar', 'projects']); assert.equal(out.layout.rest[0], 'team');
  const back = moveItem(out.layout, 'note', 'bar', 0);
  assert.deepEqual(back.layout.bar, ['home', 'note', 'basket', 'calendar', 'projects'], '하단바 0번은 홈 자리라 1부터');
  assert.equal(moveItem(d, 'basket', 'bar', 3).layout.bar.join(), 'home,calendar,projects,basket,team');
  assert.equal(moveItem(d, 'nope', 'bar', 1).reason, 'unknown');
  for (const r of [moveItem(d, 'note', 'rest', 99), moveItem(d, 'basket', 'rest', -4)]) assert.deepEqual([...r.layout.bar, ...r.layout.rest].sort(), ITEMS.map(i => i.id).sort());
});

test('키보드 한 칸 옮기기는 칸 경계를 넘나든다', () => {
  let l = defaultLayout();
  assert.equal(stepItem(l, 'basket', -1).ok, false, '홈 바로 아래는 더 못 올라간다');
  l = stepItem(l, 'team', 1).layout;
  assert.equal(l.rest[0], 'team', '하단바 맨 아래에서 아래로 = [메뉴] 맨 위');
  l = stepItem(l, 'team', -1).layout;
  assert.equal(l.bar.at(-1), 'team', '[메뉴] 맨 위에서 위로 = 하단바 맨 아래');
  assert.equal(stepItem(defaultLayout(), 'note', -1).reason, 'full');
  // 주소 개편 ②: [메뉴] 맨 아래는 [아스날]이라 그 아래로는 못 간다.
  assert.equal(stepItem(defaultLayout(), 'arsenal', 1).ok, false);
  assert.equal(stepItem(defaultLayout(), 'telegram', 1).layout.rest.at(-1), 'telegram');
});

test('PC 왼쪽 메뉴는 하단바 메뉴가 위, 나머지가 그 아래 같은 순서이고 통화·텔레그램은 끝에서 따로 붙는다', () => {
  const l = moveItem(defaultLayout(), 'team', 'rest', 0).layout;
  assert.deepEqual(pcOrder(l), [...l.bar, ...l.rest]);
  assert.deepEqual(pcOrder(defaultLayout()), ITEMS.map(item => item.id), '바꾸지 않았으면 지금까지의 PC 순서 그대로');
  assert.deepEqual(pcSplit(defaultLayout()), {main: pcOrder(defaultLayout()).slice(0, -3), tail: ['calls', 'telegram', 'arsenal']});
  const moved = moveItem(defaultLayout(), 'calls', 'rest', 0).layout;
  assert.deepEqual(pcSplit(moved).tail, ['telegram', 'arsenal']);
  assert.ok(pcSplit(moved).main.includes('calls'));
  assert.deepEqual(midKeys(defaultLayout()).slice(0, 8), ['home', 'basket', 'pane:update', 'pane:todo', 'calendar', 'tasks', 'journal', 'diary']);
  assert.equal(midKeys(defaultLayout()).length, 20);
});

test('하단바에서 지금 화면이 어느 칸인지', () => {
  const d = defaultLayout();
  assert.equal(barItemForView(d, 'tasks'), 'calendar'); assert.equal(barItemForView(d, 'meetings'), null); assert.equal(barItemForView(d, 'basket', true), null);
  const l = moveItem(moveItem(d, 'team', 'rest', 0).layout, 'note', 'bar', 1).layout;
  assert.equal(barItemForView(l, 'basket', true), 'note'); assert.equal(barItemForView(l, 'team'), null);
  assert.ok(menuSheetViews(l).includes('team') && !menuSheetViews(l).includes('meetings') === false);
});

test('저장 값: 바꾸면 {bar, rest}, 기본으로 돌아오면 null', () => {
  const l = moveItem(defaultLayout(), 'team', 'rest', 0).layout;
  assert.deepEqual(layoutToPrefs(l), l);
  assert.equal(layoutToPrefs(defaultLayout()), null);
  assert.deepEqual(DEFAULT_BAR.concat(DEFAULT_REST).length, ITEMS.length);
});

test('끌어 놓을 자리: 가운데 위치 목록과 y로 몇 번째 앞인지', () => {
  assert.equal(dropIndex([], 5), 0);
  assert.equal(dropIndex([10, 30, 50], 0), 0); assert.equal(dropIndex([10, 30, 50], 20), 1); assert.equal(dropIndex([10, 30, 50], 99), 3);
});
