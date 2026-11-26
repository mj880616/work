// S71-56 NOTE-보드 표·파일 칸: 계산(note-board-cell-model.mjs)·서버 줄 읽기(nodeShape·parseText)·저장 길(note-board-links-data.js)·그리기 escape 정적 검사.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanCell, parseCells, newCells, addRow, removeRow, addCol, removeCol, setCell, stepCell, tableText, tableTitle, fitsBytes, fileRef, fileFields, fileSpec, tableSpec,
  fileType, sizeText, isHwpName, pickAttachments, ROWS_MAX, COLS_MAX, CELL_MAX, BYTES_MAX } from '../app/note-board-cell-model.mjs';
import { nodeShape, NODE_KINDS, buildTree } from '../app/note-board-mindmap-model.mjs';
import { parseText } from '../app/note-board-links-model.mjs';
import { duplicateSpec } from '../app/note-board-decor-model.mjs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const U1 = '30000000-0000-4000-8000-000000000001', U2 = '20000000-0000-4000-8000-000000000002';

test('표 글: 네모 모양만 받고, 칸 글은 줄바꿈만 남기며 길이를 자른다', () => {
  assert.deepEqual(parseCells([['a', 'b'], ['c', 'd']]), [['a', 'b'], ['c', 'd']]);
  for (const bad of [null, [], [[]], [['a'], ['b', 'c']], [[1]], [['a']].concat(Array.from({length:ROWS_MAX}, () => ['b'])), [Array.from({length:COLS_MAX + 1}, () => 'a')], {a:1}, 'x'])
    assert.equal(parseCells(bad), null, JSON.stringify(bad).slice(0, 40));
  assert.equal(cleanCell('a\r\nb\u0001c\u0007'), 'a\nbc');
  assert.equal([...cleanCell('가'.repeat(CELL_MAX + 10))].length, CELL_MAX);
  assert.equal(cleanCell(5), '');
  assert.deepEqual(newCells(), [['', '', ''], ['', '', ''], ['', '', '']]);
});

test('줄·칸 더하기·빼기: 자리(누른 칸 뒤)·한도·하나뿐이면 못 뺌, 원본은 그대로', () => {
  const c = [['a', 'b'], ['c', 'd']];
  assert.deepEqual(addRow(c, 0), [['a', 'b'], ['', ''], ['c', 'd']]);
  assert.deepEqual(addRow(c), [['a', 'b'], ['c', 'd'], ['', '']]);
  assert.deepEqual(removeRow(c, 0), [['c', 'd']]);
  assert.deepEqual(addCol(c, 0), [['a', '', 'b'], ['c', '', 'd']]);
  assert.deepEqual(removeCol(c), [['a'], ['c']]);
  assert.deepEqual(c, [['a', 'b'], ['c', 'd']]);
  assert.equal(removeRow([['a']]), null); assert.equal(removeCol([['a']]), null);
  assert.equal(addRow(Array.from({length:ROWS_MAX}, () => ['a'])), null);
  assert.equal(addCol([Array.from({length:COLS_MAX}, () => 'a')]), null);
  assert.deepEqual(setCell(c, 1, 1, 'x\u0002'), [['a', 'b'], ['c', 'x']]);
});

test('표 안 Tab: 다음 칸 → 다음 줄 → 마지막 칸이면 줄 더하기, Shift+Tab은 앞 칸', () => {
  const c = newCells(2, 2);
  assert.deepEqual(stepCell(c, 0, 0), {r:0, c:1});
  assert.deepEqual(stepCell(c, 0, 1), {r:1, c:0});
  assert.deepEqual(stepCell(c, 1, 1), {r:2, c:0, grow:true});
  assert.deepEqual(stepCell(c, 1, 0, true), {r:0, c:1});
  assert.deepEqual(stepCell(c, 0, 0, true), {r:0, c:0});
  assert.deepEqual(stepCell(Array.from({length:ROWS_MAX}, () => ['a']), ROWS_MAX - 1, 0), {r:ROWS_MAX - 1, c:0});
});

test('찾기·내보내기 글과 크기 한도', () => {
  assert.equal(tableText([['가', ' 나 '], ['', ''], ['다', 'x\ny']]), '가 | 나\n다 | x y');
  assert.equal(tableTitle([['', ''], ['', ' 첫 글 ']]), '첫 글');
  assert.equal(fitsBytes([['a']]), true);
  assert.equal(fitsBytes([Array.from({length:11}, () => 'x'.repeat(2000))]), false);
  assert.ok(BYTES_MAX === 20000);
});

test('파일 칸: 가리키는 곳은 자료 하나 또는 노트 첨부 하나, 모양이 틀리면 보내지 않는다', () => {
  assert.deepEqual(fileFields({kind:'doc', ref:U1}), {file_doc:U1});
  assert.deepEqual(fileFields({kind:'att', ref:`${U2}/drive_A-1`}), {file_note:U2, file_drive:'drive_A-1'});
  for (const bad of [{kind:'doc', ref:'../x'}, {kind:'doc', ref:''}, {kind:'att', ref:`${U2}/a/b`}, {kind:'att', ref:`${U2}/a b`}, {kind:'att', ref:'x/y'}, {kind:'link', ref:'https://a.b/'}, null])
    assert.equal(fileFields(bad), null, JSON.stringify(bad));
  assert.equal(fileSpec('bcel0001', {kind:'doc', ref:'nope'}, {x:0, y:0}), null);
  assert.deepEqual(fileSpec('bcel0001', {kind:'doc', ref:U1}, {x:1.4, y:2.6}, 3), {board_id:'bcel0001', kind:'file', shape:'rect', body:'', file_doc:U1, x:1, y:3, w:220, z:3});
  assert.deepEqual(tableSpec('bcel0001', {x:10, y:20}).cells, newCells());
  assert.deepEqual(fileRef({file_doc:U1}), {kind:'doc', doc:U1});
  assert.equal(fileRef({file_doc:U1, file_note:U2, file_drive:'a'}), null);
  assert.equal(fileRef({file_note:U2, file_drive:'a/b'}), null);
});

test('파일 종류·크기 글·HWP·노트 첨부 고르기(잠긴 노트 빼고, 내 노트만)', () => {
  assert.equal(fileType('계획.HWPX'), 'hwp'); assert.equal(fileType('x', 'image/png'), 'image'); assert.equal(fileType('x.bin'), 'other'); assert.equal(fileType('a.pdf'), 'pdf');
  assert.equal(sizeText(24576), '24KB'); assert.equal(sizeText(1536), '1.5KB'); assert.equal(sizeText(0), ''); assert.equal(sizeText(5 * 1024 * 1024), '5MB');
  assert.equal(isHwpName('a.hwp'), true); assert.equal(isHwpName('a.pdf'), false);
  const notes = [{id:U2, updated_at:'2026-10-02', attachments:[{drive_file_id:'f_1', file_name:'회의록.pdf'}, {drive_file_id:'bad id', file_name:'x'}]},
    {id:'30000000-0000-4000-8000-000000000009', updated_at:'2026-10-03', locked:true, attachments:[{drive_file_id:'f_2', file_name:'잠긴.pdf'}]}];
  const rows = pickAttachments(notes, '', {hidden:n => !!n.locked, titleOf:() => '노트'});
  assert.deepEqual(rows.map(r => r.ref), [`${U2}/f_1`]);
  assert.equal(pickAttachments(notes, '없는', {hidden:n => !!n.locked}).length, 0);
});

test('서버 줄 읽기: 표·파일 칸도 빈 글을 받고, 표 글·파일이 가리키는 곳을 칸 모양으로 둔다(틀린 값은 버림)', () => {
  assert.ok(NODE_KINDS.includes('table') && NODE_KINDS.includes('file'));
  const row = {id:'t1', board_id:'bcel0001', body:'', x:0, y:0, kind:'table', cells:[['a', 'b']]};
  const t = nodeShape(parseText(row), row);
  assert.deepEqual(t.cells, [['a', 'b']]); assert.equal(t.kind, 'table');
  const bad = {...row, cells:[['a'], ['b', 'c']]};
  assert.deepEqual(nodeShape(parseText(bad), bad).cells, [['']]);
  const f = {id:'f1', board_id:'bcel0001', body:'', x:0, y:0, kind:'file', file_note:U2, file_drive:'f_1'};
  assert.deepEqual((({file_doc, file_note, file_drive}) => ({file_doc, file_note, file_drive}))(nodeShape(parseText(f), f)), {file_doc:null, file_note:U2, file_drive:'f_1'});
  assert.equal(parseText({id:'x', board_id:'bcel0001', body:'', kind:'topic'}), null);
  // 표·파일 칸도 나무에 들어가 가지를 가진다
  const tree = buildTree([t, nodeShape(parseText({id:'c', board_id:'bcel0001', body:'가지', x:0, y:0}), {parent_id:'t1'})]);
  assert.equal(tree.parentOf.get('c'), 't1');
  // 복제는 표 글·가리키는 곳 그대로
  assert.deepEqual(duplicateSpec(t, [t]).cells, [['a', 'b']]);
});

test('그리기·저장 정적 검사: 표 칸 글·파일 이름은 escape, 작업공간은 로그인한 사람 것, 파일이 가리키는 곳은 넣을 때만', () => {
  const board = read('app/note-board.js');
  const draw = board.slice(board.indexOf('// ---- S71-56 표·파일 칸 그리기'), board.indexOf('const cellLabel'));
  assert.match(draw, /<td data-nb-cell="\$\{r\},\$\{k\}">\$\{esc\(c\)\}<\/td>/);
  assert.match(draw, /<span class="nb-file-name">\$\{esc\(f\.name \|\| '파일'\)\}<\/span>/);
  assert.match(draw, /<small class="nb-file-meta">\$\{esc\(meta\)\}<\/small>/);
  assert.doesNotMatch(board.slice(board.indexOf('function paintTable'), board.indexOf('function moveCell')), /innerHTML = (?!tableHtml\()/);
  const data = read('app/note-board-links-data.js');
  assert.match(data, /const sent = \{workspace_id:ws\(rt\), board_id, body/);
  assert.match(data, /\.\.\.\(cells && branch \? \(insert \? CELL_KEYS : \['cells'\]\) : \[\]\)/, '고치기는 표 글만(파일이 가리키는 곳은 넣을 때만)');
  const host = read('app/basket-notes.js');
  assert.match(host, /app_documents\?workspace_id=eq\.\$\{encodeURIComponent\(ws\)\}&id=in\./);
  assert.match(host, /app_documents\?id=eq\.\$\{encodeURIComponent\(f\.doc\)\}&workspace_id=eq\.\$\{encodeURIComponent\(ws\)\}/);
  assert.match(host, /pickAttachments\(notes, query, \{hidden:note => pinLock\.noteHidden\(note\)/, '노트 첨부는 이미 읽은 내 노트에서, 잠긴 노트 빼고');
  assert.match(read('app/note-board-export.js'), /\.nb-file-meta,/, '내보내기에서 파일은 이름만');
});
