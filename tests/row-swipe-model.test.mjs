// UI-목록밀기: 폰 목록 줄 밀기의 셈(row-swipe-model.mjs)과 공용 연결(정리함·노트·챙길 것·할 일, 텔레그램과 같은 손동작 기준).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {swipeIntent, swipeEdge, rowOffset, rowSettle, openOffset, SWIPE_BTN, endCells, sides, cellWidth, isDanger, pickedLabel, SWIPE_END_MAX} from '../app/row-swipe-model.mjs';
import * as tg from '../app/tg-day-model.mjs';
const read = f => readFileSync(new URL('../app/' + f, import.meta.url), 'utf8');

test('가로로 충분히 민 뒤에만 밀기(세로 스크롤과 구분), 왼쪽 가장자리 시작만 무시', () => {
  assert.equal(swipeIntent(5, 2), 'wait');
  assert.equal(swipeIntent(20, 4), 'swipe');
  assert.equal(swipeIntent(14, 12), 'scroll');
  assert.equal(swipeIntent(3, 30), 'scroll');
  assert.equal(swipeEdge(10, 412), true); assert.equal(swipeEdge(23, 412), true); assert.equal(swipeEdge(24, 412), false); assert.equal(swipeEdge(200, 412), false);
  // S68-53: 오른쪽 끝(⋯ 단추 자리)에서 시작한 왼쪽 밀기도 줄 밀기다.
  assert.equal(swipeEdge(392, 412), false); assert.equal(swipeEdge(406, 412), false); assert.equal(swipeEdge(411, 412), false); assert.equal(swipeEdge(370, 390), false);
});
test('텔레그램 소식 밀기와 같은 기준을 쓴다', () => {
  assert.equal(tg.swipeIntent, swipeIntent); assert.equal(tg.swipeEdge, swipeEdge); assert.equal(tg.SWIPE_BTN, SWIPE_BTN);
});
test('버튼 없는 쪽으로는 움직이지 않고, 줄 폭보다 더 가지 않는다', () => {
  assert.equal(rowOffset(-80, 0, {start:true, end:false}, 400), 0);
  assert.equal(rowOffset(80, 0, {start:false, end:true}, 400), 0);
  assert.equal(rowOffset(900, 0, {start:true, end:true}, 400), 400);
  assert.equal(rowOffset(-30, -64, {start:true, end:true}, 400), -94);
});
test('밀면 칸만 보이고 멈춤, 덜 밀면 닫힘 — 바로 실행 값은 없다', () => {
  const has = {start:true, end:true}, w = 400;
  assert.deepEqual(rowSettle(-40, has, w), {side:'end'});
  assert.deepEqual(rowSettle(40, has, w), {side:'start'});
  assert.deepEqual(rowSettle(20, has, w), {side:''});
  assert.deepEqual(rowSettle(-300, {start:true, end:false}, w), {side:''});
  assert.equal(openOffset('start'), SWIPE_BTN); assert.equal(openOffset('end'), -SWIPE_BTN); assert.equal(openOffset(''), 0);
});
test('Raindrop식: 왼쪽 밀기 칸은 최대 3개, 삭제는 늘 맨 오른쪽, 옛 한 칸 모양도 받는다', () => {
  const share = {key:'share', label:'공유'}, move = {key:'move', label:'옮기기', tone:'move'}, del = {key:'delete', label:'삭제', tone:'danger'}, pin = {key:'pin', label:'고정'};
  assert.deepEqual(endCells([del, share, move]).map(a => a.key), ['share', 'move', 'delete']);
  assert.deepEqual(endCells([share, pin, move, del]).map(a => a.key), ['share', 'pin', 'delete']);
  assert.equal(endCells([share, pin, move, del]).length, SWIPE_END_MAX);
  assert.deepEqual(endCells([share, pin, move, {key:'hide', label:'숨기기'}]).map(a => a.key), ['share', 'pin', 'move']);
  assert.deepEqual(endCells(del).map(a => a.key), ['delete']);
  assert.deepEqual(endCells([null, share, undefined]).map(a => a.key), ['share']);
  assert.deepEqual(endCells(null), []);
  assert.equal(isDanger({key:'delete'}), true); assert.equal(isDanger({key:'x', tone:'danger'}), true); assert.equal(isDanger(share), false);
});
test('칸 여러 개: 멈춘 자리는 칸 수만큼, 밀수록 칸이 함께 넓어진다', () => {
  assert.equal(openOffset('end', 3), -3 * SWIPE_BTN); assert.equal(openOffset('end', 2), -128); assert.equal(openOffset('start', 3), SWIPE_BTN);
  assert.equal(cellWidth(-100, 3), SWIPE_BTN); assert.equal(cellWidth(-300, 3), 100); assert.equal(cellWidth(0, 2), SWIPE_BTN);
  assert.equal(pickedLabel(3), '3개 선택됨');
});
test('S70-60 UI-스와이프메뉴만: 끝까지 밀어도(어느 쪽·어떤 칸이든) 칸만 열고 바로 실행하지 않는다', () => {
  const del = {key:'delete', label:'삭제', tone:'danger'}, hide = {key:'hide', label:'숨기기', tone:'muted'}, save = {key:'save', label:'보관'}, release = {key:'release', label:'삭제', tone:'info'};
  for (const end of [[save, del], [save, hide], [release, null], [hide]]) {
    const has = sides({start:{key:'select'}, end});
    assert.deepEqual(Object.keys(has).sort(), ['end', 'start']); // 끝까지 밀기 허용 값(startFull·endFull)은 없다
    for (const w of [360, 390, 412, 880]) {
      for (const x of [-w, -w * 0.6, -200, -140]) assert.deepEqual(rowSettle(x, has, w), {side:'end'});
      for (const x of [w, w * 0.6, 200, 140]) assert.deepEqual(rowSettle(x, has, w), {side:'start'});
    }
  }
  assert.deepEqual(sides({start:null, end:null}), {start:0, end:0});
  assert.equal(rowOffset(-80, 0, sides({start:{key:'select'}, end:null}), 400), 0);
  assert.equal(isDanger(release), false); // 칸 순서(위험한 칸은 맨 오른쪽)는 그대로
  assert.deepEqual(endCells([release, hide]).map(a => a.key), ['release', 'hide']);
  // 공용 부품: 손을 뗄 때는 칸을 열거나 닫기만, 일은 칸을 누를 때(click)만.
  const swipe = read('row-swipe.js');
  assert.doesNotMatch(swipe, /run:now|fire\(d\.state/);
  assert.match(swipe, /fire\(open, b\.dataset\.rowSwipeKey\)/);
});
test('S68-50: 열린 줄은 닫는 쪽으로 반 칸(32px)만 되밀어도 닫힌다, 더 밀면 반대쪽', () => {
  const has = {start:1, end:3}, w = 412, open3 = openOffset('end', 3);
  assert.deepEqual(rowSettle(open3 + 60, has, w, open3), {side:''});
  assert.deepEqual(rowSettle(open3 + 20, has, w, open3), {side:'end'});
  assert.deepEqual(rowSettle(open3 - 40, has, w, open3), {side:'end'});
  assert.deepEqual(rowSettle(open3 + 260, has, w, open3), {side:'start'});
  assert.deepEqual(rowSettle(SWIPE_BTN - 40, has, w, SWIPE_BTN), {side:''});
  assert.deepEqual(rowSettle(-120, has, w), {side:'end'}); // 닫힌 줄에서 시작하면 전과 같다
});
test('S68-50: 줄 밀기 중 터치 움직임은 막고(다음 누름이 삼켜지지 않게), 열린 칸 위 밀기·열린 채 다른 곳 누름은 닫기만', () => {
  const swipe = read('row-swipe.js');
  assert.match(swipe, /addEventListener\('touchmove', e => \{ if \(drag\?\.on && e\.cancelable\) e\.preventDefault\(\); \}, \{passive:false\}\)/);
  assert.match(swipe, /const onCell = !!open && open\.el\.isConnected && open\.layer\.contains\(e\.target\);/);
  assert.match(swipe, /close\(\); swallow = shown;/);
  assert.match(swipe, /rowSettle\(d\.state\.x, d\.has, d\.el\.offsetWidth, d\.from\)/);
  assert.match(read('row-swipe.css'), /\.row-swipe-acts,\.row-swipe-act\{ touch-action:pan-y; \}/);
});
test('목록마다 공용 부품을 붙이고, 오른쪽 밀기는 [고르기], 지우기는 휴지통 길(묻지 않음 + 되돌리기)만 쓴다', () => {
  const basket = read('basket.js'), notes = read('basket-notes.js'), todos = read('inbox-todos.js'), tasks = read('google-tasks.js'), now = read('now-row-acts.js'), swipe = read('row-swipe.js');
  assert.match(basket, /bindRowSwipe\(root\.querySelector\('\[data-basket-rows\]'\),\{row:'\[data-basket-row-item\]'/);
  assert.match(basket, /if\(key==='delete'\)void deleteFromList\(id,\{confirmed:true\}\)/);
  assert.match(basket, /deleteNoteOriginal\(id,\{rt,isCurrent:current,trash:true,confirmed\}\)/);
  assert.match(notes, /bindRowSwipe\(list, \{row:'\[data-nx-note\]'/);
  assert.match(notes, /deleteNoteOriginal\(id, \{rt, isCurrent:current, trash:true, confirmed\}\)/);
  assert.match(notes, /select:\{attr:'data-nx-note', open:el => \{ if \(!selected && !busy\) startSelect\('n:' \+ el\.dataset\.nxNote\)/); // 노트는 이미 있는 선택 모드를 연다
  assert.match(notes, /key:'move', label:'옮기기', tone:'move'/);
  assert.match(notes, /claimedSince\(s\.t\)/); // 줄 위 밀기는 보기 전환보다 먼저
  assert.match(todos, /bindRowSwipe\(host, \{row:'\[data-inbox-todo-row\]'/);
  assert.match(tasks, /bindRowSwipe\(body,\{row:'\.gt-row\[data-google-task\]'/);
  for (const src of [basket, notes, todos, tasks, now]) assert.match(src, /start:PICK|start = attr \? PICK/);
  // S68-31(명진 11/23 02:24): ⋯에 [삭제]가 있는 할 일은 줄 밀기 맨 끝에도 [삭제] — ⋯와 같은 queueDelete(5초 되돌리기)만 부른다.
  const taskSwipe = tasks.slice(tasks.indexOf('bindRowSwipe(body'), tasks.indexOf('bindRowSwipe(body') + 700);
  assert.match(taskSwipe, /\{key:'delete',label:'삭제',tone:'danger'\}\]/);
  assert.match(taskSwipe, /else if\(key==='delete'\)queueDelete\(t\.id\)/);
  assert.match(tasks, /else queueDelete\(active\.id\)/); // ⋯ [삭제]와 같은 함수
  // 챙길 것은 ⋯에 삭제가 없으므로 줄 밀기에도 두지 않는다.
  assert.doesNotMatch(todos.slice(todos.indexOf('bindRowSwipe(host'), todos.indexOf('bindRowSwipe(host') + 600), /'delete'/);
  // 고르기 상태는 화면 메모리만(기기 저장 없음 — 기기 저장 사용은 Browser storage audit workflow가 막는다): 공용 선택 상태 부품을 쓴다.
  assert.match(swipe, /createSelectMode\(/);
});
test('⋯ 메뉴는 높이를 320px로 묶지 않고, 창보다 길 때만 아래 흐림', () => {
  assert.doesNotMatch(read('basket.js'), /placeAnchored\(rowMenuEl,trigger,\{maxWidth:220,maxHeight:320\}\)/);
  assert.doesNotMatch(read('basket-notes.js'), /placeAnchored\(el, trigger, \{maxWidth: 220, maxHeight: 320\}\)/);
  assert.match(read('anchored-popup.js'), /export function markScrollMore\(panel\)/);
  assert.match(read('anchored-menu.js'), /down=below>=panel\.scrollHeight\|\|below>=above;/);
  assert.match(read('base-ui.css'), /\[data-scroll-below\]\{-webkit-mask-image:linear-gradient/);
});
test('S70-64b 고르기 막대: [✕](선택 끝내기)·[그만]·보이는 개수 글자 없음, [전체 선택] 켜고 끄기, 0개면 끝', () => {
  const swipe = read('row-swipe.js');
  assert.match(swipe, /start:select && a\.start \? PICK : null/); // 오른쪽 밀기에는 [선택] 말고 다른 동작을 두지 않는다
  assert.match(swipe, /sbAllHtml\(\{attrs:'data-row-pick-all', on:all/); // [전체 선택] 켜짐(체크 표시)
  assert.match(swipe, /if \(!pick\.size\) stopPicking\(\)/); // 0개면 고르기 끝
  assert.doesNotMatch(swipe, /data-row-pick-stop|sbCloseHtml/); // 끝내기는 Esc·뒤로가기
  assert.match(swipe, /kptu-sb-count kptu-sb-sr row-swipe-pick-count/); // 개수는 화면 읽기에만
});
