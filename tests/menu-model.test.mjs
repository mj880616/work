import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ITEMS, BAR_MAX, DEFAULT_BAR, DEFAULT_REST, DEFAULT_TAIL, TAIL_MARK, defaultLayout, normalizeLayout, isDefaultLayout, layoutToPrefs, moveItem, stepItem, pcOrder, pcSplit, pcMoveFor, barItemForView, menuSheetViews, withFeatures} from '../app/menu-model.mjs';
import {dropIndex, dropIndexGrid} from '../app/reorder-drag.js';
import {validValue} from '../app/view-prefs.js';

// MENU-HOME-편집 · MENU-세칸: 메뉴 순서의 결정 규칙을 한 곳에서 시험한다(PC 왼쪽 메뉴·폰 하단바·폰 [메뉴] 창이 모두 이 규칙을 읽는다).
const ALL = () => ITEMS.map(i => i.id).sort();
const flat = l => [...l.bar, ...l.rest, ...l.tail, ...(l.hidden || [])].sort();
// MULTI-하단바기본노트: 11/13까지의 기본 구성을 저장해 둔 사람(명진처럼 저장값이 있는 계정)의 모양. 옮기기·끌기 규칙 시험의 출발점으로 쓴다.
// S68-09: 저장값에 [읽을 거리]가 없던 사람은 위 메뉴 끝에 붙는다(기본 앞 항목 잊지 말기가 하단바에 있으므로) — 그 뒤 저장한 모양.
// NAV-조직사업합침(2026-11-28): 옛 [사업 관리](meetings)·[조직 관리](team) 두 칸은 [조직·사업](team) 한 칸이 되었다(아래 'NAV-조직사업합침' 시험).
// 옮기기·끌기 규칙 시험의 출발점은 하단바가 가득 찬 모양이 필요해 meetings 자리에 [저장한 글](reading)을 둔 모양을 쓴다.
const SAVED_OLD = {bar: ['home', 'basket', 'calendar', 'reading', 'team'], rest: ['note', 'library', 'files', 'brief', 'photos', 'outside', TAIL_MARK, 'calls', 'telegram', 'arsenal']};
const oldLayout = () => normalizeLayout(SAVED_OLD);
test('기본 구성은 지금 화면과 같고 모든 항목이 정확히 한 번 나온다(세 칸)', () => {
  const d = defaultLayout();
  // MULTI-하단바기본노트(명진 11/13 15:24): 잊지 말기는 위 메뉴 맨 앞. S68-37(명진 11/23 08:01): 처음 하단바는 홈·노트·일정·자료실·사진.
  assert.deepEqual(d.bar, ['home', 'note', 'calendar', 'library', 'photos']);
  // PHOTO-사진메뉴: [사진]은 원장 다음. OUTSIDE-바깥성명 ④: [바깥 성명]은 처음 자리가 위 메뉴 끝(사진 다음). MENU-세칸: 통화·텔레그램 소식·아스날은 아래 붙는 메뉴 칸.
  // FILES-클라우드탐색기 ④: [파일]은 처음 자리가 자료실 바로 아래(명진 결정 F5).
  // OUTSIDE-글상세·관심환류 ③: 사회운동 Now·뉴스 클리핑은 'News' 한 칸(id outside, S51-17 P5에서 Now → News).
  // S68-09 READ-읽을거리함: [읽을 거리]는 처음 자리가 잊지 말기 다음. S68-37: 하단바에서 빠진 조직 관리·사업 관리는 그 다음.
  // NAV-조직사업합침: 그 두 칸은 [조직·사업](team) 한 칸.
  assert.deepEqual(d.rest, ['basket', 'reading', 'team', 'files', 'brief', 'outside']);
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
  const over = normalizeLayout({bar: ['home', 'basket', 'calendar', 'note', 'reading', 'team', 'library'], rest: []});
  assert.equal(over.bar.length, BAR_MAX); assert.deepEqual(over.rest.slice(0, 2), ['team', 'library'], '넘친 칸은 위 메뉴 맨 앞');
  const marked = normalizeLayout({bar: ['home'], rest: ['note', TAIL_MARK, 'photos', 'note', 'zzz']});
  assert.deepEqual(marked.tail.slice(0, 1), ['photos'], '표시 뒤는 아래 칸, 겹친 이름은 앞 칸이 이긴다');
  assert.equal(marked.rest[0], 'note'); assert.deepEqual(flat(marked), ALL());
  assert.ok(['calls', 'telegram', 'arsenal'].every(id => marked.tail.includes(id)), '빠진 feed 메뉴는 기본 자리인 아래 칸 끝');
});

test('옛 저장값({bar, rest}, 표시 없음)은 지금 화면 그대로 옮겨 담는다: 끝에 이어진 통화·텔레그램·아스날 = 아래 칸', () => {
  const old = normalizeLayout({bar: ['home', 'basket', 'calendar', 'reading'], rest: ['team', 'note', 'library', 'hwp', 'ledger', 'photos', 'calls', 'telegram', 'arsenal']});
  assert.deepEqual(old.tail, ['calls', 'telegram', 'arsenal']);
  assert.deepEqual(old.rest, ['team', 'note', 'library', 'files', 'brief', 'photos', 'outside'], '그때 없던 바깥 성명은 기본 앞 항목(사진) 뒤, 파일은 자료실 뒤(아래 칸 feed 묶음을 깨지 않음)');
  const up = normalizeLayout({bar: ['home', 'basket', 'calendar', 'reading', 'team'], rest: ['calls', 'note', 'library', 'hwp', 'ledger', 'photos', 'telegram', 'arsenal']});
  assert.deepEqual(up.tail, ['telegram', 'arsenal'], '위로 옮겨 둔 통화는 위 메뉴 그대로');
  assert.equal(up.rest[0], 'calls');
  const noArsenal = normalizeLayout({bar: ['home', 'basket', 'calendar', 'reading', 'team'], rest: ['note', 'library', 'hwp', 'ledger', 'photos', 'calls', 'telegram']});
  assert.deepEqual(noArsenal.tail, ['calls', 'telegram', 'arsenal'], '그때 없던 아스날도 끝에 붙어 아래 칸');
  const back = normalizeLayout(layoutToPrefs(old));
  assert.deepEqual(back, old, '새 모양으로 저장해도 같은 구성으로 읽는다');
});

test('옮기기: 홈은 고정, 하단바는 5칸까지, 세 칸 사이로 넣고 뺀다', () => {
  const d = oldLayout();
  assert.equal(moveItem(d, 'home', 'rest', 0).reason, 'fixed');
  assert.equal(moveItem(d, 'home', 'tail', 0).reason, 'fixed');
  assert.equal(moveItem(d, 'note', 'bar', 1).reason, 'full', '가득 찬 하단바에는 못 넣는다');
  const out = moveItem(d, 'team', 'rest', 0);
  assert.ok(out.ok); assert.deepEqual(out.layout.bar, ['home', 'basket', 'calendar', 'reading']); assert.equal(out.layout.rest[0], 'team');
  const back = moveItem(out.layout, 'note', 'bar', 0);
  assert.deepEqual(back.layout.bar, ['home', 'note', 'basket', 'calendar', 'reading'], '하단바 0번은 홈 자리라 1부터');
  assert.equal(moveItem(d, 'basket', 'bar', 3).layout.bar.join(), 'home,calendar,reading,basket,team');
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
  let l = oldLayout();
  assert.equal(stepItem(l, 'basket', -1).ok, false, '홈 바로 아래는 더 못 올라간다');
  l = stepItem(l, 'team', 1).layout;
  assert.equal(l.rest[0], 'team', '하단바 맨 아래에서 아래로 = 위 메뉴 맨 위');
  l = stepItem(l, 'team', -1).layout;
  assert.equal(l.bar.at(-1), 'team', '위 메뉴 맨 위에서 위로 = 하단바 맨 아래');
  assert.equal(stepItem(oldLayout(), 'note', -1).reason, 'full');
  assert.equal(stepItem(defaultLayout(), 'basket', -1).reason, 'full', '처음 구성: 위 메뉴 맨 위 잊지 말기도 가득 찬 하단바로는 못 올라간다');
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
  // MULTI-하단바기본노트: 바꾸지 않은 사람도 같은 규칙 — PC 왼쪽 메뉴가 폰 하단바 기본값 순서로 시작한다.
  assert.deepEqual(pcOrder(defaultLayout()).slice(0, 6), ['home', 'note', 'calendar', 'library', 'photos', 'basket']);
  assert.deepEqual(pcOrder(oldLayout()), [...SAVED_OLD.bar, ...SAVED_OLD.rest.filter(x => x !== TAIL_MARK)], '저장값이 있는 사람은 그 순서 그대로');
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
  assert.equal(barItemForView(defaultLayout(), 'basket', true), 'note', '처음 구성: 노트 화면은 하단바 [노트] 칸');
  assert.equal(barItemForView(defaultLayout(), 'basket'), null, '잊지 말기는 [메뉴] 칸 화면');
  const d = oldLayout();
  assert.equal(barItemForView(d, 'tasks'), 'calendar'); assert.equal(barItemForView(d, 'library'), null); assert.equal(barItemForView(d, 'basket', true), null);
  // NAV-조직사업합침: [조직·사업] 칸은 큰 탭 세 화면(조직 관리·사업 관리·주간 보고)과 사업영역 관리(projects, 사업 관리 위 창)를 맡는다.
  for (const view of ['team', 'meetings', 'projects', 'weekly']) assert.equal(barItemForView(d, view), 'team', view);
  assert.equal(barItemForView(d, 'home'), 'home', '홈([하루])은 홈 칸');
  const l = moveItem(moveItem(d, 'team', 'rest', 0).layout, 'note', 'bar', 1).layout;
  assert.equal(barItemForView(l, 'basket', true), 'note');
  for (const view of ['team', 'meetings', 'projects', 'weekly']) {
    assert.equal(barItemForView(l, view), null, view);
    assert.ok(menuSheetViews(l).includes(view), `[조직·사업]을 [메뉴] 쪽으로 빼면 ${view}도 [메뉴] 칸 화면`);
  }
  assert.ok(menuSheetViews(l).includes('library'));
  assert.ok(!menuSheetViews(d).includes('meetings') && !menuSheetViews(d).includes('weekly'));
});

test('저장 값: 바꾸면 {bar, rest(위 메뉴, 표시, 아래 칸)}, 기본으로 돌아오면 null', () => {
  const l = moveItem(defaultLayout(), 'team', 'rest', 0).layout;
  assert.deepEqual(layoutToPrefs(l), {bar: l.bar, rest: [...l.rest, TAIL_MARK, ...l.tail]});
  assert.deepEqual(Object.keys(layoutToPrefs(l)).sort(), ['bar', 'rest'], 'DB 검사가 받는 칸 이름만(새 칸 없음)');
  assert.ok(validValue('menu_layout', layoutToPrefs(l)), '서버 저장 모양 검사를 통과');
  assert.equal(layoutToPrefs(defaultLayout()), null);
  assert.deepEqual(DEFAULT_BAR.length + DEFAULT_REST.length + DEFAULT_TAIL.length, ITEMS.length);
});

test('MULTI-하단바기본노트: 기본값이 바뀌어도 저장값이 있는 사람(11/13까지의 기본 모양 그대로 저장한 사람 포함)은 그대로', () => {
  const saved = oldLayout();
  assert.deepEqual(saved.bar, SAVED_OLD.bar);
  assert.equal(isDefaultLayout(SAVED_OLD), false, '옛 기본 모양 저장값은 이제 처음 구성이 아니다');
  assert.deepEqual(layoutToPrefs(saved), SAVED_OLD, '다시 저장해도 같은 값(처음대로 지워지지 않음)');
  assert.deepEqual(normalizeLayout(null).bar, ['home', 'note', 'calendar', 'library', 'photos'], '저장값 없음 = 새 기본(S68-37)');
  // S68-37: 11/13~11/22 기본 모양(홈·노트·일정·조직·사업)을 저장해 둔 사람도 그대로 — 새 기본으로 바뀌지 않고 다시 저장해도 같은 값.
  // NAV-조직사업합침: 그 하단바의 조직·사업 두 칸은 [조직·사업] 한 칸(먼저 나온 조직 자리)이 되고, 하단바 한 칸이 빈다(새 기본으로 바뀌지 않음).
  const prev = {bar: ['home', 'note', 'calendar', 'team', 'meetings'], rest: ['basket', 'reading', 'library', 'files', 'brief', 'photos', 'outside', TAIL_MARK, 'calls', 'telegram', 'arsenal']};
  const merged = {bar: ['home', 'note', 'calendar', 'team'], rest: prev.rest};
  assert.deepEqual(normalizeLayout(prev).bar, merged.bar); assert.equal(isDefaultLayout(prev), false); assert.deepEqual(layoutToPrefs(prev), merged);
  // 빠진 항목을 끼워 넣는 자리도 예전 그대로(파일 = 자료실 바로 아래): 처음 구성이 바뀌어도 저장값 쪽 결과는 같다.
  const noFiles = normalizeLayout({bar: prev.bar, rest: prev.rest.filter(id => id !== 'files')});
  assert.equal(noFiles.rest[noFiles.rest.indexOf('library') + 1], 'files');
});

test('끌어 놓을 자리: 가운데 위치 목록과 y로 몇 번째 앞인지', () => {
  assert.equal(dropIndex([], 5), 0);
  assert.equal(dropIndex([10, 30, 50], 0), 0); assert.equal(dropIndex([10, 30, 50], 20), 1); assert.equal(dropIndex([10, 30, 50], 99), 3);
});

test('FILES-클라우드탐색기 ④: 저장된 순서에 없던 [파일]은 자료실 바로 아래로 들어간다(F5), 자료실을 옮겨 둔 사람은 그 뒤', () => {
  const saved = normalizeLayout({bar: ['home', 'basket', 'calendar', 'meetings', 'team'], rest: ['note', 'library', 'hwp', 'ledger', 'photos', 'outside', 'news', TAIL_MARK, 'calls', 'telegram', 'arsenal']});
  assert.deepEqual(saved.rest, ['note', 'library', 'files', 'brief', 'photos', 'outside', 'reading']);
  const moved = normalizeLayout({bar: ['home', 'library', 'calendar', 'meetings', 'team'], rest: ['note', 'basket', 'hwp', TAIL_MARK, 'calls', 'telegram', 'arsenal']});
  assert.equal(moved.bar.includes('files'), false, '하단바는 사용자가 고른 그대로');
  // MULTI-하단바기본노트: 기본 위 메뉴에서 자료실 바로 앞은 잊지 말기라 그 뒤에 선다.
  assert.deepEqual(moved.rest.slice(0, 4), ['note', 'basket', 'reading', 'files'], '자료실이 하단바에 있으면 기본 순서에서 그 앞(잊지 말기·읽을 거리) 뒤');
  assert.deepEqual(flat(moved), ALL());
  const tailLib = normalizeLayout({bar: ['home'], rest: ['note', TAIL_MARK, 'library', 'calls']});
  assert.ok(tailLib.rest.includes('files') && !tailLib.tail.includes('files'), '새 항목은 위 메뉴 칸에만 들어간다');
});

test('OUTSIDE-글상세·관심환류 ③: 옛 메뉴 id news(뉴스 클리핑)는 Now(outside)로 읽는다 — 저장된 메뉴 순서가 깨지지 않음', () => {
  assert.equal(ITEMS.some(i => i.id === 'news'), false, '뉴스 클리핑 칸은 없다');
  assert.equal(ITEMS.find(i => i.id === 'outside').label, '읽을 거리'); // S68-34: 'News' → '읽을 거리'(id·주소는 그대로)
  // 뉴스만 하단바에 두었던 사람: 그 자리에 Now가 선다(위 메뉴에서 다시 나오지 않음).
  const onlyNews = normalizeLayout({bar: ['home', 'basket', 'news', 'team'], rest: ['note', 'library', 'photos', TAIL_MARK, 'calls', 'telegram', 'arsenal']});
  assert.deepEqual(onlyNews.bar, ['home', 'basket', 'outside', 'team']);
  assert.equal(onlyNews.rest.includes('outside'), false);
  // 둘 다 있던 사람: 먼저 나온 자리 하나만.
  const both = normalizeLayout({bar: ['home', 'basket', 'calendar', 'meetings', 'team'], rest: ['note', 'news', 'library', 'outside', TAIL_MARK, 'calls', 'telegram', 'arsenal']});
  assert.equal(both.rest.filter(id => id === 'outside').length, 1);
  assert.equal(both.rest.indexOf('outside'), 1);
  // 아래 칸에 뉴스를 두었던 사람: 아래 칸 그 자리에 Now.
  const tail = normalizeLayout({bar: ['home', 'basket', 'calendar', 'meetings', 'team'], rest: ['note', 'library', TAIL_MARK, 'news', 'calls']});
  assert.equal(tail.tail[0], 'outside');
  assert.equal(tail.rest.includes('outside'), false);
});

// MENU-숨김(2026-11-03): 메뉴를 숨겨 두기. 숨긴 메뉴는 모델의 네 번째 목록이고, 저장은 rest 안 'hidden' 표시 뒤(DB 검사 변경 없음).
import {HIDDEN_MARK, hideItem, showItem} from '../app/menu-model.mjs';
test('MENU-숨김: 숨기기·꺼내기, 홈은 못 숨김, 어느 칸에서든 숨길 수 있다', () => {
  assert.equal(ITEMS.some(i => i.id === HIDDEN_MARK), false, '숨김 표시는 메뉴 이름과 겹치지 않는다');
  assert.deepEqual(defaultLayout().hidden, []);
  assert.equal(hideItem(defaultLayout(), 'home').reason, 'fixed');
  let l = hideItem(defaultLayout(), 'brief').layout;
  l = hideItem(l, 'reading').layout;
  l = hideItem(l, 'team').layout; // 하단바 칸 메뉴도 숨길 수 있다(하단바가 한 칸 줄어듦)
  l = hideItem(l, 'calls').layout; // 아래 칸 메뉴도
  assert.deepEqual(l.hidden, ['brief', 'reading', 'team', 'calls']);
  assert.ok(!l.rest.includes('brief') && !l.bar.includes('team') && !l.tail.includes('calls'));
  assert.deepEqual(flat(l), ALL(), '숨겨도 모든 항목이 정확히 한 번');
  const shown = showItem(l, 'brief').layout;
  assert.deepEqual(shown.hidden, ['reading', 'team', 'calls']); assert.equal(shown.rest.at(-1), 'brief', '꺼내면 위 메뉴 맨 끝');
  assert.equal(moveItem(l, 'reading', 'hidden', 0).layout.hidden[0], 'reading', '숨긴 칸 안에서 순서도 바꾼다');
});

test('MENU-숨김: 저장 모양 {bar, rest[... bottom, ... hidden, ...]}로 왕복하고 서버 검사(validValue)를 통과', () => {
  const l = hideItem(hideItem(defaultLayout(), 'brief').layout, 'reading').layout;
  const prefs = layoutToPrefs(l);
  assert.deepEqual(Object.keys(prefs).sort(), ['bar', 'rest'], 'DB 검사가 받는 칸 이름만(새 칸 없음)');
  assert.deepEqual(prefs.rest.slice(-3), [HIDDEN_MARK, 'brief', 'reading']);
  assert.ok(prefs.rest.includes(TAIL_MARK) && prefs.rest.indexOf(TAIL_MARK) < prefs.rest.indexOf(HIDDEN_MARK));
  assert.ok(validValue('menu_layout', prefs));
  assert.deepEqual(normalizeLayout(prefs), l);
  assert.equal(layoutToPrefs(normalizeLayout(layoutToPrefs(l))).rest.filter(x => x === HIDDEN_MARK).length, 1);
  // 숨긴 메뉴가 없으면 표시도 저장하지 않는다.
  const moved = moveItem(defaultLayout(), 'team', 'rest', 0).layout;
  assert.ok(!layoutToPrefs(moved).rest.includes(HIDDEN_MARK));
  // 모든 메뉴를 숨겨도 rest 24개 안(검사 한도).
  let all = defaultLayout();
  for (const item of ITEMS) { const r = hideItem(all, item.id); if (r.ok) all = r.layout; }
  assert.ok(validValue('menu_layout', layoutToPrefs(all)));
  assert.equal(all.hidden.length, ITEMS.length - 1);
});

test('MENU-숨김: 이상한 저장값·옛 저장값·표시를 모르는 옛 화면', () => {
  // 홈·모르는 이름·다른 칸과 겹친 이름은 숨김에서 버린다(앞 칸이 이긴다).
  const n = normalizeLayout({bar: ['home', 'basket'], rest: ['note', TAIL_MARK, 'calls', HIDDEN_MARK, 'home', 'zzz', 'brief', 'note', 'calls']});
  assert.deepEqual(n.hidden, ['brief']);
  assert.deepEqual(flat(n), ALL());
  // 표시만 있고 비어 있어도 올바른 구성.
  assert.deepEqual(normalizeLayout({bar: [], rest: [HIDDEN_MARK]}), defaultLayout());
  // 숨김 표시가 없는 옛 저장값은 숨김 없음.
  assert.deepEqual(normalizeLayout({bar: ['home', 'basket'], rest: ['note', TAIL_MARK, 'calls']}).hidden, []);
  // 숨긴 메뉴는 새 항목 자리 채우기에서도 빠진 것으로 세지 않는다(숨김 유지).
  const h = normalizeLayout({bar: ['home', 'basket', 'calendar', 'meetings', 'team'], rest: ['note', 'library', 'files', 'photos', 'outside', TAIL_MARK, 'calls', 'telegram', 'arsenal', HIDDEN_MARK, 'brief', 'reading']});
  assert.deepEqual(h.hidden, ['brief', 'reading']); assert.ok(!h.rest.includes('brief'));
  // 표시를 모르는 옛 화면의 읽기: 'hidden' 이름은 메뉴 이름이 아니라 버리고, 숨긴 메뉴는 아래 칸 뒤에 이어져 그대로 보인다(깨지지 않음).
  const legacyRead = normalizeLayout({bar: ['home', 'basket', 'calendar', 'meetings', 'team'], rest: ['note', TAIL_MARK, 'calls', 'brief', 'reading']});
  assert.deepEqual(legacyRead.tail, ['calls', 'brief', 'reading', 'telegram', 'arsenal']);
});

test('MENU-숨김: PC 왼쪽 메뉴는 위 줄·맨 아래 묶음에서 숨긴 메뉴가 빠지고 어디에도 나오지 않는다(접힌 줄 없음)', () => {
  const l = hideItem(hideItem(defaultLayout(), 'brief').layout, 'reading').layout;
  const s = pcSplit(l);
  assert.equal('hidden' in s, false, 'pcSplit은 숨긴 묶음을 돌려주지 않는다');
  assert.ok(!s.main.includes('brief') && !s.main.includes('reading') && !s.tail.includes('brief'));
  assert.deepEqual([...s.main, ...s.tail, ...l.hidden].sort(), ALL());
  assert.ok(menuSheetViews(l).includes('brief'), '숨긴 메뉴 화면도 [메뉴] 칸이 지금 화면(하단바 칸 아님)');
});

// MENU-왼쪽메뉴바로끌기: PC 왼쪽 메뉴에서 끌어 놓은 자리(앞·뒤 이웃) → 어느 칸 몇 번째인지. 저장은 메뉴 편집 창과 같은 moveItem 한 길이다.
const applyPc = (layout, id, slot) => { const to = pcMoveFor(layout, id, slot); return moveItem(layout, id, to.to, to.index); };
const pcMain = l => pcSplit(l).main.filter(x => x !== 'home');
// 처음 모양이 아닌 구성(PC 위 줄이 '하단바 칸 메뉴가 위, 위 메뉴가 그 아래'로 보이는 상태): [사진]을 위 메뉴 맨 앞으로 옮겨 둔 것.
const changed = () => moveItem(oldLayout(), 'photos', 'rest', 0).layout;
test('MENU-왼쪽메뉴바로끌기: 위 메뉴 줄을 같은 칸 안에서 끌면 그 칸 순서만 바뀐다', () => {
  const l = changed(), base = pcMain(l);
  assert.deepEqual(base, ['basket', 'calendar', 'reading', 'team', 'photos', 'note', 'library', 'files', 'brief', 'outside']);
  // [바깥 성명(News)]을 [자료실] 앞으로: 위 메뉴 안에서만 움직인다(하단바 그대로).
  const r = applyPc(l, 'outside', {part: 'main', index: base.filter(x => x !== 'outside').indexOf('library')});
  assert.ok(r.ok && r.changed);
  assert.deepEqual(r.layout.bar, l.bar);
  assert.deepEqual(r.layout.rest, ['photos', 'note', 'outside', 'library', 'files', 'brief']);
  // 하단바 칸 안에서도(홈 아래 첫 줄 앞 = 하단바 칸 맨 앞 자리, 홈은 그대로 맨 앞).
  const b = applyPc(l, 'team', {part: 'main', index: 0});
  assert.deepEqual(b.layout.bar, ['home', 'team', 'basket', 'calendar', 'reading']);
});
test('MENU-왼쪽메뉴바로끌기: 하단바 칸 끝과 위 메뉴 첫 줄 사이는 끌던 줄이 있던 칸에 남고, 칸 사이 깊이 들어갈 때만 칸이 바뀐다', () => {
  const l = changed(), main = pcMain(l); // 앞 4개 하단바(홈 뺀 것), 뒤는 위 메뉴
  // 위 메뉴 첫 줄이던 [사진]을 하단바 끝(팀) 바로 아래로 끌면 그대로 위 메뉴 맨 앞.
  const seq = main.filter(x => x !== 'photos');
  const toBoundary = applyPc(l, 'photos', {part: 'main', index: seq.indexOf('team') + 1});
  assert.ok(toBoundary.ok); assert.deepEqual(toBoundary.layout.bar, l.bar); assert.equal(toBoundary.changed, false);
  // 하단바 칸이던 [팀]을 같은 경계로 끌면 하단바 칸에 남는다(맨 뒤).
  const stay = applyPc(l, 'team', {part: 'main', index: main.filter(x => x !== 'team').indexOf('photos')});
  assert.deepEqual(stay.layout.bar, l.bar); assert.equal(stay.changed, false);
  // 하단바 칸 메뉴들 사이로 [사진]을 끌면 하단바 칸이 되는데, 하단바가 가득 차 있으면 'full'로 거절한다(칸 수 제한 그대로).
  const full = applyPc(l, 'photos', {part: 'main', index: seq.indexOf('calendar')});
  assert.equal(full.ok, false); assert.equal(full.reason, 'full');
  // 하단바에 자리가 있으면 들어간다.
  const room = moveItem(l, 'team', 'rest', 0).layout;
  const seqRoom = pcMain(room).filter(x => x !== 'outside');
  const into = applyPc(room, 'outside', {part: 'main', index: seqRoom.indexOf('reading')});
  assert.ok(into.ok); assert.deepEqual(into.layout.bar, ['home', 'basket', 'calendar', 'outside', 'reading']);
});
test('MENU-왼쪽메뉴바로끌기: 위 줄 맨 끝은 위 메뉴 끝이고, 맨 아래 묶음으로·묶음에서 끌어 옮긴다', () => {
  const l = defaultLayout();
  const seq = pcMain(l).filter(x => x !== 'files');
  const end = applyPc(l, 'files', {part: 'main', index: seq.length});
  assert.deepEqual(end.layout.rest.at(-1), 'files'); assert.deepEqual(end.layout.bar, l.bar);
  const toTail = applyPc(l, 'photos', {part: 'tail', index: 1});
  assert.deepEqual(toTail.layout.tail, ['calls', 'photos', 'telegram', 'arsenal']);
  assert.ok(!toTail.layout.rest.includes('photos'));
  // 맨 아래 묶음에서 위 줄로: 끌어 놓은 자리 앞·뒤 이웃이 위 메뉴면 위 메뉴로 들어간다(하단바로 새지 않는다).
  const up = applyPc(l, 'calls', {part: 'main', index: pcMain(l).indexOf('files')}); // S68-37: 자료실은 기본 하단바라 위 메뉴 줄인 파일 앞에 놓는다
  assert.ok(up.ok && up.layout.bar.length === BAR_MAX && !up.layout.bar.includes('calls'));
  assert.ok(up.layout.rest.includes('calls') && !up.layout.tail.includes('calls'));
  // 맨 아래 묶음이 비었어도 그 묶음 맨 앞 자리로 들어간다.
  const empty = {...l, tail: [], rest: [...l.rest, 'calls', 'telegram', 'arsenal']};
  const first = applyPc(empty, 'library', {part: 'tail', index: 0});
  assert.deepEqual(first.layout.tail, ['library']);
});
test('MENU-왼쪽메뉴바로끌기: 홈은 위 줄에 없고 옮길 수 없다. 이상한 자리 값도 칸 안으로 맞춘다', () => {
  const l = defaultLayout();
  assert.equal(applyPc(l, 'home', {part: 'main', index: 3}).reason, 'fixed');
  const wild = pcMoveFor(l, 'files', {part: 'main', index: 999});
  assert.ok(moveItem(l, 'files', wild.to, wild.index).ok);
  assert.deepEqual(pcMoveFor(l, 'files', {part: 'tail', index: -5}), {to: 'tail', index: 0});
  assert.deepEqual(pcMoveFor(l, 'files', {part: 'main', index: NaN}).to, 'rest');
});
test('MENU-왼쪽메뉴바로끌기: 끌어 옮긴 결과는 항상 올바른 구성(모든 항목이 정확히 한 번)이다', () => {
  for (const base of [defaultLayout(), changed()]) {
    for (const id of ITEMS.map(i => i.id).filter(x => x !== 'home')) {
      for (const part of ['main', 'tail']) {
        for (let index = 0; index <= 14; index += 2) {
          const r = applyPc(base, id, {part, index});
          const next = r.ok ? r.layout : base;
          assert.deepEqual(flat(next), ALL(), `${id} ${part} ${index}`);
          assert.deepEqual(normalizeLayout(next), next);
          if (r.ok && part === 'tail') assert.equal(pcSplit(next).tail.indexOf(id), Math.min(index, pcSplit(base).tail.filter(x => x !== id).length));
        }
      }
    }
  }
});

test('MENU-왼쪽메뉴바로끌기: 두 칸 격자(폰 [메뉴] 창)의 놓을 자리는 가까운 칸의 앞·뒤로 정한다', () => {
  // 한 줄 150 높이 40, 두 칸(왼쪽 0~100, 오른쪽 110~210), 줄 사이 8: 노트|자료실 / 파일|HWP / 공유 하나.
  const cell = (col, row) => ({left: col * 110, right: col * 110 + 100, top: row * 48, bottom: row * 48 + 40});
  const rects = [cell(0, 0), cell(1, 0), cell(0, 1), cell(1, 1), cell(0, 2)];
  assert.equal(dropIndexGrid([], 5, 5), 0);
  assert.equal(dropIndexGrid(rects, 10, 20), 0, '첫 칸 왼쪽 반 = 그 칸 앞');
  assert.equal(dropIndexGrid(rects, 90, 20), 1, '첫 칸 오른쪽 반 = 그 칸 다음(둘째 칸 앞)');
  assert.equal(dropIndexGrid(rects, 120, 20), 1, '둘째 칸 왼쪽 반 = 둘째 칸 앞');
  assert.equal(dropIndexGrid(rects, 200, 20), 2, '둘째 칸 오른쪽 반 = 다음 줄 첫 칸 앞');
  assert.equal(dropIndexGrid(rects, 120, 70), 3, '둘째 줄 오른쪽 칸 왼쪽 반');
  assert.equal(dropIndexGrid(rects, 190, 120), 5, '마지막 줄 빈 오른쪽 자리 = 맨 끝');
  assert.equal(dropIndexGrid(rects, 40, 500), 5, '모든 칸 아래 = 맨 끝');
  assert.equal(dropIndexGrid(rects, 40, -30), 0, '모든 칸 위 = 맨 앞');
  // 한 칸짜리 세로 목록이면 세로 가운데 기준(dropIndex와 같은 결과).
  const col = [0, 1, 2, 3].map(r => ({left: 0, right: 300, top: r * 44, bottom: r * 44 + 40}));
  for (const y of [-5, 10, 30, 50, 70, 100, 140, 200]) assert.equal(dropIndexGrid(col, 150, y), dropIndex(col.map(r => (r.top + r.bottom) / 2), y), `y=${y}`);
});

// MULTI-처음쓰는사람 ④(docs/design/new-user-start.md 2-1): 원장은 모든 계정 메뉴에서 빠지고, 운영자 기능 메뉴는 서버 기능 답에 따라 목록에서 뺀다.
test('MULTI-처음쓰는사람 ④: 원장은 메뉴 목록에 없고, 저장된 순서의 ledger는 버린다', () => {
  assert.equal(ITEMS.some(i => i.id === 'ledger'), false);
  const saved = normalizeLayout({bar: ['home', 'basket', 'calendar', 'meetings', 'team'], rest: ['note', 'ledger', 'library', TAIL_MARK, 'calls', HIDDEN_MARK, 'ledger']});
  assert.ok(![...saved.bar, ...saved.rest, ...saved.tail, ...saved.hidden].includes('ledger'));
  assert.deepEqual(saved.rest.slice(0, 2), ['note', 'library']);
});
test('MULTI-처음쓰는사람 ④·S62-11: withFeatures — 답 전(null)은 그대로, 기능 없는 계정은 통화·텔레그램·아스날·News를 뺀다([파일]은 모두에게), 운영자는 그대로', () => {
  const d = defaultLayout();
  const before = withFeatures(d, null);
  assert.deepEqual(before.off, []); assert.deepEqual(before.rest, d.rest); assert.deepEqual(before.tail, d.tail);
  const none = withFeatures(d, []);
  assert.deepEqual(none.off.sort(), ['arsenal', 'calls', 'outside', 'telegram']);
  assert.deepEqual(none.bar, d.bar);
  assert.deepEqual(none.rest, ['basket', 'reading', 'team', 'files', 'brief'], 'S62-11: [파일]은 기능 키 없이도 보인다');
  assert.deepEqual(none.bar, ['home', 'note', 'calendar', 'library', 'photos'], 'S68-37: 기능 키 없는 새 계정도 하단바 다섯 칸이 다 찬다(자료실·사진은 기능 키 없음)');
  assert.equal(ITEMS.find(i => i.id === 'files').feature, undefined);
  assert.deepEqual(none.tail, []);
  const op = withFeatures(d, ['calls', 'telegram', 'files', 'gdrive_photos', 'arsenal', 'outside', 'family']);
  assert.deepEqual(op.off, []); assert.deepEqual({bar: op.bar, rest: op.rest, tail: op.tail, hidden: op.hidden}, d);
  // 일부만(예: 아스날·News 키가 아직 없는 운영자 — DB 적용 전): 그 둘만 빠진다. 그래서 DB 적용이 먼저다.
  assert.deepEqual(withFeatures(d, ['calls', 'telegram', 'files']).off.sort(), ['arsenal', 'outside']);
  // 숨긴 메뉴·하단바에 둔 운영자 메뉴도 빠진다. 저장값(normalizeLayout 결과)은 건드리지 않는다.
  const custom = normalizeLayout({bar: ['home', 'calls', 'calendar'], rest: ['note', TAIL_MARK, 'telegram', HIDDEN_MARK, 'arsenal']});
  const v = withFeatures(custom, []);
  assert.deepEqual(v.bar, ['home', 'calendar']); assert.deepEqual(v.hidden, []);
  assert.deepEqual(custom.bar, ['home', 'calls', 'calendar']);
});

// MULTI-하단바기본노트: 메뉴를 한 번도 바꾸지 않은 사람은 index.html의 처음 모양을 그대로 본다(menu-layout.js·topbar-actions.js가 다시 그리지 않음).
// 그래서 처음 모양(폰 하단바·[메뉴] 창·PC 왼쪽 메뉴)이 기본 구성과 같은 순서인지 여기서 묶어 둔다.
test('MULTI-하단바기본노트: index.html 처음 모양 = 기본 구성(폰 하단바·[메뉴] 창·PC 왼쪽 메뉴)', async () => {
  const {readFile} = await import('node:fs/promises');
  const html = await readFile(new URL('../app/index.html', import.meta.url), 'utf8');
  const idOf = tag => /data-basket-kind-nav="note"/.test(tag) ? 'note' : (tag.match(/data-view="([^"]+)"/) || [])[1];
  const ids = (block, re) => [...block.matchAll(re)].map(m => idOf(m[0])).filter(Boolean);
  const tabs = html.match(/<nav class="mobile-tabs"[\s\S]*?<\/nav>/)[0];
  const d = defaultLayout();
  assert.deepEqual(ids(tabs, /<button type="button" data-[^>]*>/g), d.bar);
  const sheet = html.match(/<nav aria-label="더 보기">[\s\S]*?<\/nav>/)[0];
  const [top, bottom] = sheet.split('data-menu-tail-line');
  assert.deepEqual(ids(top, /<button type="button" data-[^>]*>/g), d.rest);
  assert.deepEqual(ids(bottom, /<button type="button" data-[^>]*>/g), d.tail);
  const side = html.match(/<nav id="appNav"[\s\S]*?<\/nav>/)[0];
  // S69-71: '쓰는 법'은 왼쪽 메뉴에 없다(계정 메뉴 '앱 정보' 아래).
  assert.doesNotMatch(side, /nav-help|data-view="help"/);
  const [main, feed] = side.split('sidebar-spacer');
  assert.deepEqual(ids(main, /<a class="nav-btn[^"]*"[^>]*>/g), pcSplit(d).main);
  assert.deepEqual(ids(feed, /<a class="nav-btn[^"]*"[^>]*>/g), pcSplit(d).tail);
});


// S71-61 HWP-노트안으로(2026-11-26 사용자 결정 "노트 안에서만 열게 하자"): [HWP 편집]은 메뉴 항목이 아니다 — 메뉴 모델 한 곳에서 빠지고,
// 저장된 메뉴 설정에 'hwp'가 있어도(하단바·위 메뉴·아래 칸·숨긴 메뉴 어디든) 모르는 이름으로 건너뛰어 나머지 순서가 그대로다.
test('S71-61: HWP 편집은 메뉴에 없고, 저장된 메뉴 설정의 hwp는 건너뛴다', () => {
  assert.equal(ITEMS.some(i => i.id === 'hwp' || i.view === 'hwp'), false, '메뉴 목록에 HWP 편집 없음');
  const d = defaultLayout();
  assert.ok(![...d.bar, ...d.rest, ...d.tail].includes('hwp'));
  assert.ok(!pcOrder(d).includes('hwp') && !menuSheetViews(d).includes('hwp'));
  for (const saved of [
    {bar: ['home', 'hwp', 'note'], rest: ['basket', 'library']},
    {bar: ['home', 'note'], rest: ['basket', 'hwp', 'library', TAIL_MARK, 'calls']},
    {bar: ['home', 'note'], rest: ['basket', TAIL_MARK, 'hwp', 'calls']},
    {bar: ['home', 'note'], rest: ['basket', TAIL_MARK, 'calls', HIDDEN_MARK, 'hwp', 'reading']},
  ]) {
    const n = normalizeLayout(saved);
    assert.deepEqual(flat(n), ALL(), JSON.stringify(saved));
    assert.ok(!flat(n).includes('hwp'));
    assert.deepEqual(n.bar, saved.bar.filter(id => id !== 'hwp'), '하단바는 hwp만 빠지고 그대로');
    assert.ok(validValue('menu_layout', layoutToPrefs(n) ?? {bar: [], rest: []}));
  }
  // hwp만 저장돼 있던 값은 처음 구성으로.
  assert.deepEqual(normalizeLayout({bar: ['hwp'], rest: ['hwp']}), defaultLayout());
  assert.equal(moveItem(d, 'hwp', 'rest', 0).reason, 'unknown');
});

// NAV-조직사업합침(2026-11-28 사용자 결정 10:22~10:55): 왼쪽 메뉴·하단바의 [사업 관리](meetings)·[조직 관리](team)는 [조직·사업] 한 칸(id team)이다.
// 저장된 메뉴 구성에 옛 두 칸이 있으면 한 칸으로 합쳐 자리를 지킨다(먼저 나온 자리 — 하단바 → 위 메뉴 → 아래 칸 → 숨긴 메뉴 순).
test('NAV-조직사업합침: 메뉴는 [조직·사업] 하나, 저장된 옛 두 칸은 먼저 나온 자리 한 칸으로 합친다', () => {
  assert.equal(ITEMS.some(i => i.id === 'meetings'), false, '[사업 관리] 메뉴 칸은 없다');
  const team = ITEMS.find(i => i.id === 'team');
  assert.equal(team.label, '조직·사업'); assert.equal(team.view, 'team', '누르면 늘 맨 앞 [조직 관리]');
  assert.deepEqual(team.group, ['team', 'meetings', 'projects', 'weekly']);
  const once = l => assert.deepEqual(flat(l), ALL(), JSON.stringify(l));
  // 하단바: 사업 관리가 먼저 나오면 그 자리에, 조직 관리는 빠진다.
  const a = normalizeLayout({bar: ['home', 'meetings', 'calendar', 'team'], rest: ['note', 'basket', TAIL_MARK, 'calls', 'telegram', 'arsenal']});
  assert.deepEqual(a.bar, ['home', 'team', 'calendar']); once(a);
  // 하단바(사업) + 위 메뉴(조직): 하단바 자리.
  const b = normalizeLayout({bar: ['home', 'note', 'meetings'], rest: ['team', 'basket', TAIL_MARK, 'calls']});
  assert.deepEqual(b.bar, ['home', 'note', 'team']); assert.ok(!b.rest.includes('team')); once(b);
  // 위 메뉴 안 두 칸: 먼저 나온 자리 하나.
  const c = normalizeLayout({bar: ['home', 'note'], rest: ['basket', 'meetings', 'library', 'team', TAIL_MARK, 'calls']});
  assert.deepEqual(c.rest.filter(id => ['basket', 'team', 'library'].includes(id)), ['basket', 'team', 'library']); assert.equal(c.rest.filter(id => id === 'team').length, 1); once(c);
  // 하나는 숨기고 하나는 보였으면 보이는 쪽.
  const h = normalizeLayout({bar: ['home', 'note'], rest: ['basket', 'team', TAIL_MARK, 'calls', HIDDEN_MARK, 'meetings']});
  assert.deepEqual(h.hidden, []); assert.ok(h.rest.includes('team')); once(h);
  // 둘 다 숨겼으면 숨긴 채 하나.
  const both = normalizeLayout({bar: ['home', 'note'], rest: ['basket', TAIL_MARK, 'calls', HIDDEN_MARK, 'meetings', 'team']});
  assert.deepEqual(both.hidden, ['team']); once(both);
  // 사업 관리만 있던 값도 그 자리에 [조직·사업].
  const only = normalizeLayout({bar: ['home', 'meetings'], rest: ['note', TAIL_MARK, 'calls']});
  assert.deepEqual(only.bar, ['home', 'team']); once(only);
  // 다시 저장하면 한 칸(meetings 이름 없음) — 서버 검사 그대로 통과.
  const saved = layoutToPrefs(a);
  assert.ok(!saved.bar.includes('meetings') && !saved.rest.includes('meetings'));
  assert.ok(validValue('menu_layout', saved)); assert.deepEqual(normalizeLayout(saved), a);
  assert.equal(moveItem(defaultLayout(), 'meetings', 'rest', 0).reason, 'unknown', '옛 이름으로는 옮기지 않는다');
});
