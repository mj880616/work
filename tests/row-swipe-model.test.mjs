// UI-목록밀기: 폰 목록 줄 밀기의 셈(row-swipe-model.mjs)과 공용 연결(정리함·노트·챙길 것·할 일, 텔레그램과 같은 손동작 기준).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {swipeIntent, swipeEdge, rowOffset, rowSettle, openOffset, fullDistance, SWIPE_BTN} from '../app/row-swipe-model.mjs';
import * as tg from '../app/tg-day-model.mjs';
const read = f => readFileSync(new URL('../app/' + f, import.meta.url), 'utf8');

test('가로로 충분히 민 뒤에만 밀기(세로 스크롤과 구분), 가장자리 시작은 무시', () => {
  assert.equal(swipeIntent(5, 2), 'wait');
  assert.equal(swipeIntent(20, 4), 'swipe');
  assert.equal(swipeIntent(14, 12), 'scroll');
  assert.equal(swipeIntent(3, 30), 'scroll');
  assert.equal(swipeEdge(10, 412), true); assert.equal(swipeEdge(406, 412), true); assert.equal(swipeEdge(200, 412), false);
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
test('목록마다 공용 부품을 붙이고, 지우기는 휴지통 길(묻지 않음 + 되돌리기)만 쓴다', () => {
  const basket = read('basket.js'), notes = read('basket-notes.js'), todos = read('inbox-todos.js'), tasks = read('google-tasks.js');
  assert.match(basket, /bindRowSwipe\(root\.querySelector\('\[data-basket-rows\]'\),\{row:'\[data-basket-row-item\]'/);
  assert.match(basket, /if\(key==='delete'\)void deleteFromList\(id,\{confirmed:true\}\)/);
  assert.match(basket, /deleteNoteOriginal\(id,\{rt,isCurrent:current,trash:true,confirmed\}\)/);
  assert.match(notes, /bindRowSwipe\(list, \{row:'\[data-nx-note\]'/);
  assert.match(notes, /deleteNoteOriginal\(id, \{rt, isCurrent:current, trash:true, confirmed\}\)/);
  assert.match(notes, /claimedSince\(s\.t\)/); // 줄 위 밀기는 보기 전환보다 먼저
  assert.match(todos, /bindRowSwipe\(host, \{row:'\[data-inbox-todo-row\]'/);
  assert.match(tasks, /bindRowSwipe\(body,\{row:'\.gt-row\[data-google-task\]'/);
});
test('⋯ 메뉴는 높이를 320px로 묶지 않고, 창보다 길 때만 아래 흐림', () => {
  assert.doesNotMatch(read('basket.js'), /placeAnchored\(rowMenuEl,trigger,\{maxWidth:220,maxHeight:320\}\)/);
  assert.doesNotMatch(read('basket-notes.js'), /placeAnchored\(el, trigger, \{maxWidth: 220, maxHeight: 320\}\)/);
  assert.match(read('anchored-popup.js'), /export function markScrollMore\(panel\)/);
  assert.match(read('anchored-menu.js'), /down=below>=panel\.scrollHeight\|\|below>=above;/);
  assert.match(read('base-ui.css'), /\[data-scroll-below\]\{-webkit-mask-image:linear-gradient/);
});
