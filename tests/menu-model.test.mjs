import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ITEMS, BAR_MAX, DEFAULT_BAR, DEFAULT_REST, DEFAULT_TAIL, TAIL_MARK, defaultLayout, normalizeLayout, isDefaultLayout, layoutToPrefs, moveItem, stepItem, pcOrder, pcSplit, barItemForView, menuSheetViews} from '../app/menu-model.mjs';
import {dropIndex} from '../app/reorder-drag.js';
import {validValue} from '../app/view-prefs.js';

// MENU-HOME-편집 · MENU-세칸: 메뉴 순서의 결정 규칙을 한 곳에서 시험한다(PC 왼쪽 메뉴·폰 하단바·폰 [메뉴] 창이 모두 이 규칙을 읽는다).
const ALL = () => ITEMS.map(i => i.id).sort();
const flat = l => [...l.bar, ...l.rest, ...l.tail].sort();
test('기본 구성은 지금 화면과 같고 모든 항목이 정확히 한 번 나온다(세 칸)', () => {
  const d = defaultLayout();
  // MTG-프로젝트합치기 3단계: [프로젝트] 메뉴가 없어지고 하단바 4번째 칸이 [사업 보고]다.
  assert.deepEqual(d.bar, ['home', 'basket', 'calendar', 'meetings', 'team']);
  // PHOTO-사진메뉴: [사진]은 원장 다음. OUTSIDE-바깥성명 ④: [바깥 성명]은 처음 자리가 위 메뉴 끝(사진 다음). MENU-세칸: 통화·텔레그램 소식·아스날은 아래 붙는 메뉴 칸.
  assert.deepEqual(d.rest, ['note', 'library', 'hwp', 'pages', 'ledger', 'photos', 'outside']);
  assert.deepEqual(d.tail, ['calls', 'telegram', 'arsenal']);
  assert.equal(ITEMS.some(i => i.id === 'projects'), false, '[프로젝트] 메뉴 항목은 없다');
  assert.deepEqual(flat(d), ALL());
  assert.equal(d.bar.length, BAR_MAX);
  assert.ok(isDefaultLayout(d)); assert.equal(layoutToPrefs(d), null);
  assert.equal(ITEMS.some(i => i.id === TAIL_MARK), false, '아래 칸 표시는 메뉴 이름과 겹치지 않는다');
});

test('저장된 값이 이상해도 언제나 올바른 구성으로 읽는다', () => {
  for (const bad of [null, undefined, 5, 'x', [], {}, {bar: 'home'}, {bar: [1, null], rest: {}}, {bar: [], rest: [TAIL_MARK]}]) assert.deepEqual(normalizeLayout(bad), defaultLayout(), JSON.stringify(bad));
  const n = normalizeLayout({bar: ['note', 'zzz', 'note', 'home', 'team'], rest: ['team', 'library', 'library']});
  assert.deepEqual(n.bar, ['home', 'note', 'team'], '홈 맨 앞, 겹침·모르는 이름 제거');
  assert.ok(n.rest.includes('library') && !n.rest.includes('team') && !n.rest.includes('note'));
  assert.deepEqual(flat(n), ALL(), '빠진 항목은 기본 자리 칸 끝에 붙는다');
  const over = normalizeLayout({bar: ['home', 'basket', 'calendar', 'note', 'meetings', 'team', 'library'], rest: []});
  assert.equal(over.bar.length, BAR_MAX); assert.deepEqual(over.rest.slice(0, 2), ['team', 'library'], '넘친 칸은 위 메뉴 맨 앞');
  const marked = normalizeLayout({bar: ['home'], rest: ['note', TAIL_MARK, 'photos', 'note', 'zzz']});
  assert.deepEqual(marked.tail.slice(0, 1), ['photos'], '표시 뒤는 아래 칸, 겹친 이름은 앞 칸이 이긴다');
  assert.equal(marked.rest[0], 'note'); assert.deepEqual(flat(marked), ALL());
  assert.ok(['calls', 'telegram', 'arsenal'].every(id => marked.tail.includes(id)), '빠진 feed 메뉴는 기본 자리인 아래 칸 끝');
});

test('옛 저장값({bar, rest}, 표시 없음)은 지금 화면 그대로 옮겨 담는다: 끝에 이어진 통화·텔레그램·아스날 = 아래 칸', () => {
  const old = normalizeLayout({bar: ['home', 'basket', 'calendar', 'meetings'], rest: ['team', 'note', 'library', 'hwp', 'pages', 'ledger', 'photos', 'calls', 'telegram', 'arsenal']});
  assert.deepEqual(old.tail, ['calls', 'telegram', 'arsenal']);
  assert.deepEqual(old.rest, ['team', 'note', 'library', 'hwp', 'pages', 'ledger', 'photos', 'outside'], '그때 없던 바깥 성명은 위 메뉴 끝(아래 칸 feed 묶음을 깨지 않음)');
  const up = normalizeLayout({bar: ['home', 'basket', 'calendar', 'meetings', 'team'], rest: ['calls', 'note', 'library', 'hwp', 'pages', 'ledger', 'photos', 'telegram', 'arsenal']});
  assert.deepEqual(up.tail, ['telegram', 'arsenal'], '위로 옮겨 둔 통화는 위 메뉴 그대로');
  assert.equal(up.rest[0], 'calls');
  const noArsenal = normalizeLayout({bar: ['home', 'basket', 'calendar', 'meetings', 'team'], rest: ['note', 'library', 'hwp', 'pages', 'ledger', 'photos', 'calls', 'telegram']});
  assert.deepEqual(noArsenal.tail, ['calls', 'telegram', 'arsenal'], '그때 없던 아스날도 끝에 붙어 아래 칸');
  const back = normalizeLayout(layoutToPrefs(old));
  assert.deepEqual(back, old, '새 모양으로 저장해도 같은 구성으로 읽는다');
});

test('옮기기: 홈은 고정, 하단바는 5칸까지, 세 칸 사이로 넣고 뺀다', () => {
  const d = defaultLayout();
  assert.equal(moveItem(d, 'home', 'rest', 0).reason, 'fixed');
  assert.equal(moveItem(d, 'home', 'tail', 0).reason, 'fixed');
  assert.equal(moveItem(d, 'note', 'bar', 1).reason, 'full', '가득 찬 하단바에는 못 넣는다');
  const out = moveItem(d, 'team', 'rest', 0);
  assert.ok(out.ok); assert.deepEqual(out.layout.bar, ['home', 'basket', 'calendar', 'meetings']); assert.equal(out.layout.rest[0], 'team');
  const back = moveItem(out.layout, 'note', 'bar', 0);
  assert.deepEqual(back.layout.bar, ['home', 'note', 'basket', 'calendar', 'meetings'], '하단바 0번은 홈 자리라 1부터');
  assert.equal(moveItem(d, 'basket', 'bar', 3).layout.bar.join(), 'home,calendar,meetings,basket,team');
  assert.equal(moveItem(d, 'nope', 'bar', 1).reason, 'unknown');
  assert.equal(moveItem(d, 'note', 'side', 0).reason, 'unknown');
  const photo = moveItem(d, 'photos', 'tail', 1).layout;
  assert.deepEqual(photo.tail, ['calls', 'photos', 'telegram', 'arsenal'], '사진을 아래 칸으로');
  assert.ok(!photo.rest.includes('photos'));
  const call = moveItem(d, 'calls', 'rest', 99).layout;
  assert.equal(call.rest.at(-1), 'calls', '통화를 위 메뉴로'); assert.deepEqual(call.tail, ['telegram', 'arsenal']);
  const fromBar = moveItem(d, 'team', 'tail', 0).layout;
  assert.equal(fromBar.tail[0], 'team'); assert.equal(fromBar.bar.includes('team'), false, '하단바에서 아래 칸으로 바로');
  for (const r of [moveItem(d, 'note', 'rest', 99), moveItem(d, 'basket', 'rest', -4), moveItem(d, 'arsenal', 'bar', 2)]) assert.deepEqual(flat(r.layout), ALL());
});

test('키보드 한 칸 옮기기는 세 칸 경계를 넘나든다', () => {
  let l = defaultLayout();
  assert.equal(stepItem(l, 'basket', -1).ok, false, '홈 바로 아래는 더 못 올라간다');
  l = stepItem(l, 'team', 1).layout;
  assert.equal(l.rest[0], 'team', '하단바 맨 아래에서 아래로 = 위 메뉴 맨 위');
  l = stepItem(l, 'team', -1).layout;
  assert.equal(l.bar.at(-1), 'team', '위 메뉴 맨 위에서 위로 = 하단바 맨 아래');
  assert.equal(stepItem(defaultLayout(), 'note', -1).reason, 'full');
  const down = stepItem(defaultLayout(), 'outside', 1).layout;
  assert.equal(down.tail[0], 'outside', '위 메뉴 맨 아래에서 아래로 = 아래 칸 맨 위');
  const up = stepItem(defaultLayout(), 'calls', -1).layout;
  assert.equal(up.rest.at(-1), 'calls', '아래 칸 맨 위에서 위로 = 위 메뉴 맨 아래');
  // 주소 개편 ②: 아래 칸 맨 아래는 [아스날]이라 그 아래로는 못 간다.
  assert.equal(stepItem(defaultLayout(), 'arsenal', 1).ok, false);
  assert.equal(stepItem(defaultLayout(), 'telegram', 1).layout.tail.at(-1), 'telegram');
});

test('PC 왼쪽 메뉴: 하단바·위 메뉴가 위, 맨 아래 묶음은 저장된 아래 칸 그대로', () => {
  const l = moveItem(defaultLayout(), 'team', 'rest', 0).layout;
  assert.deepEqual(pcOrder(l), [...l.bar, ...l.rest, ...l.tail]);
  assert.deepEqual(pcOrder(defaultLayout()), ITEMS.map(item => item.id), '바꾸지 않았으면 지금까지의 PC 순서 그대로');
  assert.deepEqual(pcSplit(defaultLayout()), {main: pcOrder(defaultLayout()).slice(0, -3), tail: ['calls', 'telegram', 'arsenal']});
  const moved = moveItem(defaultLayout(), 'calls', 'rest', 0).layout;
  assert.deepEqual(pcSplit(moved).tail, ['telegram', 'arsenal']);
  assert.ok(pcSplit(moved).main.includes('calls'));
  const photo = moveItem(defaultLayout(), 'photos', 'tail', 0).layout;
  assert.deepEqual(pcSplit(photo).tail, ['photos', 'calls', 'telegram', 'arsenal'], '사진도 맨 아래 묶음에 붙는다(feed 규칙 아님)');
  let empty = defaultLayout();
  for (const id of ['calls', 'telegram', 'arsenal']) empty = moveItem(empty, id, 'rest', 99).layout;
  assert.deepEqual(pcSplit(empty).tail, [], '아래 칸이 비면 맨 아래 묶음도 없다');
  assert.deepEqual(normalizeLayout(layoutToPrefs(empty)).tail, [], '빈 아래 칸도 그대로 저장·복원');
});

test('하단바에서 지금 화면이 어느 칸인지', () => {
  const d = defaultLayout();
  assert.equal(barItemForView(d, 'tasks'), 'calendar'); assert.equal(barItemForView(d, 'library'), null); assert.equal(barItemForView(d, 'basket', true), null);
  // MTG-프로젝트합치기 3단계: 사업영역 관리(라우터 이름 projects)는 사업 보고 칸의 화면이다.
  assert.equal(barItemForView(d, 'meetings'), 'meetings'); assert.equal(barItemForView(d, 'projects'), 'meetings');
  const l = moveItem(moveItem(d, 'team', 'rest', 0).layout, 'note', 'bar', 1).layout;
  assert.equal(barItemForView(l, 'basket', true), 'note'); assert.equal(barItemForView(l, 'team'), null);
  assert.equal(barItemForView(l, 'projects'), 'meetings');
  assert.ok(menuSheetViews(l).includes('team') && menuSheetViews(l).includes('library'));
  assert.ok(!menuSheetViews(l).includes('meetings') && !menuSheetViews(l).includes('projects'));
  const out = moveItem(d, 'meetings', 'rest', 0).layout;
  assert.ok(menuSheetViews(out).includes('meetings') && menuSheetViews(out).includes('projects'), '사업 보고를 [메뉴] 쪽으로 빼면 사업영역 관리도 [메뉴] 칸 화면');
});

test('저장 값: 바꾸면 {bar, rest(위 메뉴, 표시, 아래 칸)}, 기본으로 돌아오면 null', () => {
  const l = moveItem(defaultLayout(), 'team', 'rest', 0).layout;
  assert.deepEqual(layoutToPrefs(l), {bar: l.bar, rest: [...l.rest, TAIL_MARK, ...l.tail]});
  assert.deepEqual(Object.keys(layoutToPrefs(l)).sort(), ['bar', 'rest'], 'DB 검사가 받는 칸 이름만(새 칸 없음)');
  assert.ok(validValue('menu_layout', layoutToPrefs(l)), '서버 저장 모양 검사를 통과');
  assert.equal(layoutToPrefs(defaultLayout()), null);
  assert.deepEqual(DEFAULT_BAR.length + DEFAULT_REST.length + DEFAULT_TAIL.length, ITEMS.length);
});

test('끌어 놓을 자리: 가운데 위치 목록과 y로 몇 번째 앞인지', () => {
  assert.equal(dropIndex([], 5), 0);
  assert.equal(dropIndex([10, 30, 50], 0), 0); assert.equal(dropIndex([10, 30, 50], 20), 1); assert.equal(dropIndex([10, 30, 50], 99), 3);
});
