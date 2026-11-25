// UI-목록밀기: 폰 목록 줄 밀기의 셈(row-swipe-model.mjs)과 공용 연결(정리함·노트·챙길 것·할 일, 텔레그램과 같은 손동작 기준).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {swipeIntent, swipeEdge, rowOffset, rowSettle, openOffset, fullDistance, SWIPE_BTN, endCells, sides, cellWidth, isDanger, holdFull, pickedLabel, SWIPE_END_MAX} from '../app/row-swipe-model.mjs';
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
test('조금 밀면 버튼만 보이고 멈춤, 끝까지 밀면 바로 실행, 덜 밀면 닫힘', () => {
  const has = {start:true, end:true}, w = 400;
  assert.equal(fullDistance(w), 180); assert.equal(fullDistance(200), 140);
  assert.deepEqual(rowSettle(-40, has, w), {side:'end', run:false});
  assert.deepEqual(rowSettle(40, has, w), {side:'start', run:false});
  assert.deepEqual(rowSettle(-200, has, w), {side:'end', run:true});
  assert.deepEqual(rowSettle(190, has, w), {side:'start', run:true});
  assert.deepEqual(rowSettle(20, has, w), {side:'', run:false});
  assert.deepEqual(rowSettle(-300, {start:true, end:false}, w), {side:'', run:false});
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
test('끝까지 밀기: 맨 오른쪽이 삭제가 아니면 바로 실행, 삭제면 바로 지우지 않고 칸만 연다', () => {
  const w = 400, del = {key:'delete', label:'삭제', tone:'danger'}, hide = {key:'hide', label:'숨기기'}, save = {key:'save', label:'보관'};
  const withDel = sides({start:{key:'select'}, end:[save, del]}), withHide = sides({start:{key:'select'}, end:[save, hide]});
  assert.deepEqual(withDel, {start:1, end:2, startFull:true, endFull:false, startPick:true});
  assert.deepEqual(rowSettle(-300, withDel, w), {side:'end', run:false});
  assert.deepEqual(rowSettle(-300, withHide, w), {side:'end', run:true});
  assert.deepEqual(rowSettle(300, withDel, w), {side:'start', run:true});
  assert.deepEqual(rowSettle(-40, withDel, w), {side:'end', run:false});
  assert.deepEqual(sides({start:null, end:null}), {start:0, end:0, startFull:false, endFull:false});
  assert.equal(rowOffset(-80, 0, sides({start:{key:'select'}, end:null}), 400), 0);
});
test('S70-64 오른쪽 밀기 = 고르기만: 반 칸 넘게 밀고 떼면 칸을 열어 두지 않고 바로 고른다', () => {
  const w = 412, has = sides({start:{key:'select'}, end:[{key:'delete', label:'삭제', tone:'danger'}]});
  assert.equal(has.startPick, true);
  assert.deepEqual(rowSettle(40, has, w), {side:'start', run:true}); // 조금(반 칸 넘게)만 밀어도 고르기
  assert.deepEqual(rowSettle(20, has, w), {side:'', run:false}); // 반 칸이 안 되면 제자리
  assert.deepEqual(rowSettle(300, has, w), {side:'start', run:true});
  assert.equal(sides({start:{key:'other'}, end:null}).startPick, undefined); // [선택]이 아닌 옛 칸은 옛 규칙
  // 열린 왼쪽 칸(3칸)을 되미는 짧은 밀기는 닫기만(고르지 않음).
  const open3 = openOffset('end', 1);
  assert.deepEqual(rowSettle(open3 + 40, has, w, open3), {side:'', run:false});
  const swipe = read('row-swipe.js');
  assert.match(swipe, /start:select && a\.start \? PICK : null/); // 오른쪽 밀기에는 다른 동작을 두지 않는다
  assert.match(swipe, /sbAllHtml\(\{attrs:'data-row-pick-all', on:all/); // [전체 선택] 켜짐(체크 표시)
  assert.match(swipe, /if \(!pick\.size\) stopPicking\(\)/); // 0개면 고르기 끝
});
test('S68-50: 이름이 \'삭제\'인 칸(News [저장한 글]의 차분한 색 [삭제])도 끝까지 밀면 칸만 열린다 — 삭제는 직접 누를 때만', () => {
  const release = {key:'release', label:'삭제', tone:'info'}, hide = {key:'hide', label:'숨기기', tone:'muted'}, save = {key:'save', label:'저장', tone:'info'};
  assert.equal(holdFull(release), true); assert.equal(holdFull({key:'purge', label:'영구 삭제', tone:'danger'}), true); assert.equal(holdFull(hide), false);
  assert.equal(isDanger(release), false); // 칸 순서(위험한 칸은 맨 오른쪽)는 그대로
  const saved = sides({start:{key:'select'}, end:[release, null]});
  assert.equal(saved.endFull, false);
  assert.deepEqual(rowSettle(-300, saved, 400), {side:'end', run:false});
  assert.equal(sides({start:{key:'select'}, end:[release, hide]}).endFull, true); // 맨 끝이 [숨기기]면 그대로 바로
  assert.deepEqual(endCells([release, hide]).map(a => a.key), ['release', 'hide']);
  assert.match(read('now-row-acts.js'), /RELEASE_LABEL = '삭제'/);
});
test('S68-50: 열린 줄은 닫는 쪽으로 반 칸(32px)만 되밀어도 닫힌다, 더 밀면 반대쪽', () => {
  const has = {start:1, end:3, startFull:true, endFull:false}, w = 412, open3 = openOffset('end', 3);
  assert.deepEqual(rowSettle(open3 + 60, has, w, open3), {side:'', run:false});
  assert.deepEqual(rowSettle(open3 + 20, has, w, open3), {side:'end', run:false});
  assert.deepEqual(rowSettle(open3 - 40, has, w, open3), {side:'end', run:false});
  assert.deepEqual(rowSettle(open3 + 260, has, w, open3), {side:'start', run:false});
  assert.deepEqual(rowSettle(SWIPE_BTN - 40, has, w, SWIPE_BTN), {side:'', run:false});
  assert.deepEqual(rowSettle(-120, has, w), {side:'end', run:false}); // 닫힌 줄에서 시작하면 전과 같다
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
