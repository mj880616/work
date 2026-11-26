import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {selectKeyAction, renameTarget, createSelectKeys, confirmDelete, deleteNeedsConfirm} from '../app/select-keys.js';

// UI-목록공용키(S70-18): 키 → 할 일 결정 표(docs/design/standard-interactions.md S5·K1·K2).
const TABLE = [
  [{key:'a', ctrlKey:true}, 'all'],
  [{key:'A', ctrlKey:true}, 'all'],
  [{key:'a', metaKey:true}, 'all'],
  [{key:'a', ctrlKey:true, shiftKey:true}, null],
  [{key:'a', ctrlKey:true, altKey:true}, null],
  [{key:'a'}, null],
  [{key:'Delete'}, 'delete'],
  [{key:'Delete', shiftKey:true}, null],
  [{key:'Delete', ctrlKey:true}, null],
  [{key:'Backspace'}, null],
  [{key:'F2'}, 'rename'],
  [{key:'F2', altKey:true}, null],
  [{key:'F2', ctrlKey:true}, null],
  [{key:'Escape'}, 'clear'],
  [{key:'Enter'}, null],
  // 글 쓰는 칸·창·한글 조합 중에는 글자 동작 그대로.
  [{key:'a', ctrlKey:true, typing:true}, null],
  [{key:'Delete', typing:true}, null],
  [{key:'F2', typing:true}, null],
  [{key:'Escape', typing:true}, null],
  [{key:'Delete', boxOpen:true}, null],
  [{key:'a', ctrlKey:true, isComposing:true}, null],
];
for (const [k, want] of TABLE) test(`selectKeyAction ${JSON.stringify(k)} → ${want}`, () => assert.equal(selectKeyAction(k), want));

test('renameTarget: 고른 것 하나 → 그것, 없으면 커서 줄, 여럿이면 없음', () => {
  assert.equal(renameTarget(['x'], 'y'), 'x');
  assert.equal(renameTarget([], 'y'), 'y');
  assert.equal(renameTarget(new Set(), 'y'), 'y');
  assert.equal(renameTarget(['x', 'z'], 'y'), null);
  assert.equal(renameTarget([], null), null);
});

test('createSelectKeys: 화면 함수가 true면 기본 동작을 막고, false·없음·꺼짐이면 그대로 둔다', () => {
  const ev = over => ({key:'Delete', target:null, defaultPrevented:false, prevented:0, preventDefault() { this.prevented++; }, ...over});
  let ran = 0;
  const on = createSelectKeys({delete: () => { ran++; return true; }, rename: () => false});
  const a = ev(); assert.equal(on.handle(a), true); assert.equal(a.prevented, 1); assert.equal(ran, 1);
  const b = ev({key:'F2'}); assert.equal(on.handle(b), false); assert.equal(b.prevented, 0);
  const c = ev({key:'a', ctrlKey:true}); assert.equal(on.handle(c), false); assert.equal(c.prevented, 0);
  const d = ev(); assert.equal(on.handle(d, ['clear']), false); assert.equal(ran, 1);
  const e = ev({defaultPrevented:true}); assert.equal(on.handle(e), false);
  const off = createSelectKeys({delete: () => true}, {active: () => false});
  assert.equal(off.handle(ev()), false);
  const menu = createSelectKeys({delete: () => true}, {blocked: () => true});
  assert.equal(menu.handle(ev()), false);
});

test('자료실·노트·[파일]이 같은 공용 키 부품을 쓴다(화면마다 따로 F2·Delete·Ctrl+A 처리 없음)', () => {
  const files = readFileSync(new URL('../app/files.js', import.meta.url), 'utf8');
  const lib = readFileSync(new URL('../app/library-upload.js', import.meta.url), 'utf8');
  const notes = readFileSync(new URL('../app/basket-notes.js', import.meta.url), 'utf8');
  for (const src of [files, lib, notes]) assert.match(src, /from '\.\/select-keys\.js'/);
  assert.doesNotMatch(files, /event\.key === 'F2'\) \{ const list = actRows/);
  assert.doesNotMatch(files, /mod && k === 'a' && rows\.length/);
  assert.doesNotMatch(notes, /e\.key === 'F2' && \(!selected/);
});

// K1 지우기 한 규칙(I-6, 2026-11-25 명진 결정 6): 되돌리기가 있으면 확인 없이 바로, 없으면 확인 창.
test('confirmDelete: 되돌리기 있음 → 확인 창을 열지 않고 바로 지움', async () => {
  let asked = 0;
  assert.equal(deleteNeedsConfirm({undo:true}), false);
  assert.equal(await confirmDelete({undo:true, ask:async () => { asked++; return false; }}), true);
  assert.equal(await confirmDelete({undo:true}), true);
  assert.equal(asked, 0);
});
test('confirmDelete: 되돌리기 없음 → 확인 창, 답대로(취소면 지우지 않음)', async () => {
  let asked = 0;
  assert.equal(deleteNeedsConfirm({undo:false}), true);
  assert.equal(deleteNeedsConfirm(), true);
  assert.equal(await confirmDelete({undo:false, ask:async () => { asked++; return true; }}), true);
  assert.equal(await confirmDelete({undo:false, ask:async () => { asked++; return false; }}), false);
  assert.equal(asked, 2);
  assert.equal(await confirmDelete({undo:false}), false, '확인 창도 되돌리기도 없으면 지우지 않는다');
});

test('K1 언제 묻나는 공용 규칙 하나: 자료실·노트·노트 보드·[파일]이 confirmDelete를 쓰고, 노트 보드 상자 지우기는 따로 묻지 않는다', () => {
  const read = f => readFileSync(new URL('../app/' + f, import.meta.url), 'utf8');
  const board = read('note-board.js'), lib = read('library-upload.js'), notes = read('basket-notes.js'), files = read('files.js');
  for (const src of [board, lib, notes, files]) assert.match(src, /confirmDelete|deleteNeedsConfirm/);
  // 노트 보드: '아래 가지가 있으면 묻는다' 따로 규칙이 없다(되돌리기 있으면 confirmDelete가 묻지 않음).
  assert.doesNotMatch(board, /if \(below\) \{\s*const short/);
  assert.match(board, /confirmDelete\(\{undo:!!onRemoveItems/);
  // 자료실 선택 [삭제]: '여럿·폴더면 묻기' 따로 규칙이 없다.
  assert.doesNotMatch(lib, /if\(fids\.length\|\|ids\.length>1\)\{/);
  // [파일] 휴지통: 직접 askConfirm 대신 confirmDelete를 거친다.
  assert.doesNotMatch(files, /if \(!\(await askConfirm\(anchor, \{text: (one|ask\.text)/);
});
