// UI-작은알림자리(2026-10-28 명진 결정 10:52): 작은 알림 2초·올려 두면 멈춤, 되돌리기 기록 10개·Ctrl+Z 규칙.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NOTICE_MS, NOTICE_UNDO_MS, UNDO_LIMIT, holdTimer, recordUndo, dropUndo, clearUndo, undoLabels, undoLast, undoLabel,
  undoResultLine, isUndoKey, ownsUndo} from '../app/small-notice.js';

test('작은 알림은 2초, 되돌리기 기록은 최근 10개', () => {
  assert.equal(NOTICE_MS, 2000);
  assert.equal(NOTICE_UNDO_MS, 2000);
  assert.equal(UNDO_LIMIT, 10);
});

test('올려 두는 동안(마우스·손가락·초점)은 사라지지 않고, 떠나면 2초를 처음부터 다시 잰다', t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const box = new EventTarget(); box.contains = () => false;
  let done = 0; holdTimer(box, 2000, () => done++);
  t.mock.timers.tick(1500); box.dispatchEvent(new Event('pointerenter'));
  t.mock.timers.tick(5000); assert.equal(done, 0);
  box.dispatchEvent(new Event('pointerleave'));
  t.mock.timers.tick(1999); assert.equal(done, 0);
  t.mock.timers.tick(1); assert.equal(done, 1);
  const box2 = new EventTarget(); box2.contains = () => false;
  let done2 = 0; const c = holdTimer(box2, 2000, () => done2++);
  box2.dispatchEvent(new Event('focusin')); t.mock.timers.tick(9000); assert.equal(done2, 0);
  c.stop(); box2.dispatchEvent(new Event('focusout')); t.mock.timers.tick(9000); assert.equal(done2, 0);
});

test('Ctrl+Z는 최근 것부터 하나씩, 10개를 넘으면 오래된 것이 빠진다', async () => {
  clearUndo();
  const ran = [];
  for (let i = 1; i <= 12; i++) recordUndo({label: `일 ${i}`, undo: () => { ran.push(i); }});
  assert.equal(undoLabels().length, 10);
  assert.deepEqual(undoLabels().slice(0, 2), ['일 3', '일 4']);
  assert.equal(await undoLast(), true);
  assert.equal(await undoLast(), true);
  assert.deepEqual(ran, [12, 11]);
  const id = recordUndo({label: '지울 것', undo: () => ran.push('x')});
  dropUndo(id); await undoLast();
  assert.deepEqual(ran, [12, 11, 10]);
  clearUndo(); assert.equal(await undoLast(), false);
});

test('같은 되돌리기는 한 번만 돈다(실패해도 기록에서 빠진다)', async () => {
  clearUndo();
  let n = 0; recordUndo({label: '실패', undo: () => { n++; throw new Error('x'); }});
  assert.equal(await undoLast(), true); assert.equal(await undoLast(), false); assert.equal(n, 1);
});

test('결과 한 줄: 되돌림·실패·다른 곳에서 바뀜·화면이 직접 알림', () => {
  assert.deepEqual(undoResultLine('폴더 옮기기 3개', undefined), {text: '되돌렸어요: 폴더 옮기기 3개', error: false});
  assert.deepEqual(undoResultLine('a', {status: 'restored', message: '되돌렸어요.'}), {text: '되돌렸어요: a', error: false});
  assert.deepEqual(undoResultLine('a', false), {text: '되돌리지 못했어요: a', error: true});
  assert.deepEqual(undoResultLine('a', {status: 'failed', message: '서버가 거절했어요.'}), {text: '서버가 거절했어요.', error: true});
  assert.deepEqual(undoResultLine('a', {status: 'conflict'}), {text: '다른 곳에서 바뀌어 되돌리지 않았어요: a', error: true});
  assert.equal(undoResultLine('a', {silent: true}), null);
  assert.equal(undoLabel('휴지통으로 옮겼어요. 30일 뒤 지워져요.'), '휴지통으로 옮겼어요');
});

test('Ctrl+Z(⌘Z)만 받고, 글 쓰는 칸·편집기 안이면 그 칸의 글자 되돌리기를 둔다', () => {
  assert.equal(isUndoKey({ctrlKey: true, key: 'z'}), true);
  assert.equal(isUndoKey({metaKey: true, key: 'Z'}), true);
  assert.equal(isUndoKey({ctrlKey: true, shiftKey: true, key: 'z'}), false);
  assert.equal(isUndoKey({key: 'z'}), false);
  const el = sel => ({closest: q => q.split(',').some(part => part.trim() === sel) ? {} : null});
  for (const sel of ['input', 'textarea', 'select', '.ed-editor', '[data-own-undo]']) assert.equal(ownsUndo(el(sel)), true, sel);
  assert.equal(ownsUndo(el('button')), false);
  assert.equal(ownsUndo(null), false);
});

test('기기에 저장하지 않는다(기록은 화면 메모리뿐)', () => {
  const js = readFileSync(new URL('../app/small-notice.js', import.meta.url), 'utf8');
  assert.doesNotMatch(js, /localStorage|sessionStorage|indexedDB/);
});
