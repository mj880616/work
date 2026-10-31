// NOTE-보드여러개: 포스트잇 보드 여러 개의 규칙(app/note-boards-model.mjs)과 화면 연결의 약속.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ALL, BOARD_LIMITS, parseBoards, boardsToPrefs, pickBoard, validateBoardName, newBoardId, addBoard, renameBoard, removeBoard,
  boardPlaceOf, onBoard, notesOnBoard, boardsOfNote, withBoardPlace, dropPlace} from '../app/note-boards-model.mjs';
import {layoutBoard, boardOf, CARD, tiltFor} from '../app/note-board-model.mjs';
import {validValue} from '../app/view-prefs.js';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const P = (x, y, z = 0) => ({x, y, r:1, z});
const note = (id, metadata = {}) => ({id, updated_at:'2026-10-30T01:00:00Z', metadata});

test('보드 목록: 서버 값의 틀린 칸·겹친 id는 버리고 12개까지, 보낼 모양은 DB 검사를 지난다', () => {
  const good = [{id:'b1a2b3c4', name:'국회 대응'}, {id:'bq0q0q0q', name:'교섭'}];
  assert.deepEqual(parseBoards([...good, {id:'b1a2b3c4', name:'겹침'}, {id:'B1', name:'x'}, {id:'b9999999'}, {id:'b8888888', name:''}, {id:'b7777777', name:'x', z:1}, null, 'b']), good);
  assert.deepEqual(parseBoards(null), []); assert.deepEqual(parseBoards({}), []);
  const many = Array.from({length:15}, (_, i) => ({id:'b' + String(i).padStart(7, '0'), name:'보드' + i}));
  assert.equal(parseBoards(many).length, BOARD_LIMITS.count);
  assert.ok(validValue('note_boards', boardsToPrefs(parseBoards(many))));
});
test('마지막에 연 보드: 목록에 있으면 그 보드, 없으면 [전체]', () => {
  const boards = [{id:'b1a2b3c4', name:'가'}];
  assert.equal(pickBoard('b1a2b3c4', boards), 'b1a2b3c4');
  for (const v of ['b0000000', null, undefined, 1, ALL]) assert.equal(pickBoard(v, boards), ALL);
});
test('만들기·이름 바꾸기·지우기', () => {
  let seq = 0; const random = () => ((seq++ * 7) % 36) / 36;
  let {boards, board} = addBoard([], '  국회   대응 ', random);
  assert.equal(board.name, '국회 대응'); assert.match(board.id, /^b[0-9a-z]{8}$/); assert.ok(validValue('note_board', board.id));
  assert.throws(() => addBoard(boards, '국회 대응', random), /같은 이름/);
  for (const bad of ['', '   ', '전체', '가'.repeat(21), '줄\n바꿈']) assert.throws(() => validateBoardName(bad, boards), Error, JSON.stringify(bad));
  assert.equal(validateBoardName('가'.repeat(20), boards), '가'.repeat(20));
  const two = addBoard(boards, '교섭', random); boards = two.boards;
  assert.notEqual(two.board.id, board.id);
  boards = renameBoard(boards, board.id, '국회');
  assert.equal(boards[0].name, '국회');
  assert.throws(() => renameBoard(boards, board.id, '교섭'), /같은 이름/);
  assert.doesNotThrow(() => renameBoard(boards, board.id, '국회'), '제 이름 그대로는 됨');
  assert.deepEqual(removeBoard(boards, board.id).map(b => b.id), [two.board.id]);
  const full = Array.from({length:12}, (_, i) => ({id:'b' + String(i).padStart(7, '0'), name:'보드' + i}));
  assert.throws(() => addBoard(full, '새', random), /12개까지/);
  assert.throws(() => newBoardId([{id:'bzzzzzzzz'}], () => 0.999999), /만들지 못했어요/);
});
test('노트 자리: 보드마다 metadata.boards[id], [전체] metadata.board와 따로. 같은 노트를 여러 보드에', () => {
  const n = note('n1', {board:P(10, 10), folder_id:'f', boards:{b1a2b3c4:P(40, 50, 3), bq0q0q0q:P(5, 6), bbad0000:{x:'1'}}});
  assert.deepEqual(boardPlaceOf(n, 'b1a2b3c4'), P(40, 50, 3));
  assert.equal(boardPlaceOf(n, 'bbad0000'), null, '모양이 틀린 자리는 없음');
  assert.equal(boardPlaceOf(n, 'bzzzzzzz'), null);
  assert.equal(boardPlaceOf(note('x', {boards:[1]}), 'b1a2b3c4'), null);
  assert.deepEqual(boardOf(n), P(10, 10), '[전체] 자리는 그대로');
  assert.deepEqual(boardsOfNote(n, [{id:'b1a2b3c4', name:'a'}, {id:'bq0q0q0q', name:'b'}, {id:'bnone000', name:'c'}]), ['b1a2b3c4', 'bq0q0q0q']);
  assert.deepEqual(notesOnBoard([n, note('n2'), note('n3', {boards:{b1a2b3c4:P(0, 0)}})], 'b1a2b3c4').map(x => x.id), ['n1', 'n3']);
  assert.equal(onBoard(note('n2'), 'b1a2b3c4'), false);
});
test('붙이기·옮기기·빼기는 다른 metadata 키를 그대로 두고, 바뀐 것이 없으면 쓰지 않는다', () => {
  const meta = {folder_id:'f', pinned_at:'2026-10-30T00:00:00Z', board:P(1, 2), ai_off:true};
  const on = withBoardPlace(meta, 'b1a2b3c4', P(40, 50, 3));
  assert.deepEqual(on, {...meta, boards:{b1a2b3c4:P(40, 50, 3)}});
  assert.equal(meta.boards, undefined, '받은 값은 바꾸지 않음');
  assert.equal(withBoardPlace(on, 'b1a2b3c4', P(40, 50, 3)), null, '같은 자리면 쓰지 않음');
  const two = withBoardPlace(on, 'bq0q0q0q', P(7, 8));
  assert.deepEqual(Object.keys(two.boards).sort(), ['b1a2b3c4', 'bq0q0q0q']);
  const off = withBoardPlace(two, 'b1a2b3c4', null);
  assert.deepEqual(off.boards, {bq0q0q0q:P(7, 8)}); assert.deepEqual(off.board, P(1, 2)); assert.equal(off.folder_id, 'f');
  const none = withBoardPlace(off, 'bq0q0q0q', null);
  assert.equal('boards' in none, false, '빈 boards는 키를 지움');
  assert.equal(withBoardPlace(none, 'bq0q0q0q', null), null, '없는 것 빼기는 쓰지 않음');
  assert.deepEqual(withBoardPlace(null, 'b1a2b3c4', P(1, 1)), {boards:{b1a2b3c4:P(1, 1)}});
});
test('끌어 놓은 곳에 칸 가운데, 맨 위 순서. 누르기·고르기는 붙은 칸과 겹치지 않는 빈 곳', () => {
  const places = new Map([['a', {...P(0, 0, 4), saved:true}], ['b', {...P(300, 0, 9), saved:true}]]);
  assert.deepEqual(dropPlace('n', {x:400, y:300}, places), {x:400 - CARD / 2, y:300 - CARD / 2, r:tiltFor('n'), z:10});
  assert.deepEqual(dropPlace('n', {x:10, y:10}, new Map()), {x:0, y:0, r:tiltFor('n'), z:0}, '판 밖으로 나가지 않음');
  const on = [note('a', {boards:{b1a2b3c4:P(24, 24, 2)}})], add = [note('n1'), note('n2')];
  const set = new Set(['n1', 'n2']);
  const layout = layoutBoard([...on, ...add], () => null, n => (set.has(n.id) ? null : boardPlaceOf(n, 'b1a2b3c4')));
  const a = layout.get('a'), overlap = (p, q) => p.x < q.x + CARD && q.x < p.x + CARD && p.y < q.y + CARD && q.y < p.y + CARD;
  assert.equal(a.saved, true);
  for (const id of ['n1', 'n2']) { assert.ok(!overlap(layout.get(id), a), id); assert.ok(layout.get(id).z > a.z, id); }
  assert.ok(!overlap(layout.get('n1'), layout.get('n2')));
});
test('화면 연결: 보드 칸 줄·PC 끌어 놓기·폰 고르기·서버 저장 길(기기 저장 없음)', () => {
  const js = read('app/note-boards.js'), notes = read('app/basket-notes.js'), board = read('app/note-board.js'), data = read('app/basket-data.js'), css = read('app/basket.css');
  assert.match(js, /viewPrefs\.set\('note_boards', boardsToPrefs\(boards\), \{rejectable:true\}\)/);
  assert.match(js, /viewPrefs\.set\('note_board', current, \{rejectable:true\}\)/);
  assert.match(js, /setNoteBoardPlace\(note, boardId, place, rt\)/);
  assert.match(data, /export function setNoteBoardPlace\(note, boardId, place, rt = window\.KPTURuntime\) \{\n  return patchNoteMetadata\(note, metadata => withBoardPlace\(metadata, boardId, place\), rt\);/);
  assert.match(js, /data-nbb-new>\+ 새 보드</); assert.match(js, /data-nbb-pick>\+ 노트 붙이기</); assert.match(js, />전체</);
  assert.match(js, /왼쪽 노트를 끌어다 놓으세요/);
  assert.match(js, /treeRows\(\{folders:folders\(\), notes:all/, 'PC 왼쪽 목록은 노트 화면의 같은 폴더 나무');
  assert.match(js, /e\.dataTransfer\.setData\(NOTE_DRAG/); assert.match(board, /scroll\.addEventListener\('drop'/);
  assert.match(js, /bar\.addEventListener\('contextmenu'/); assert.match(js, /LONG_MS/);
  assert.match(js, /data-nbb-rename>이름 바꾸기</); assert.match(js, /data-nbb-delete>보드 지우기</);
  assert.match(notes, /\['data-nbb-detach', '보드에서 빼기'\]/); assert.match(board, /data-nb-remove=/);
  assert.match(notes, /import \{ createNoteBoards \} from '\.\/note-boards\.js'/);
  // UI-칸폭끌기전수: 왼쪽 목록 | 보드 경계를 끌어 폭 조절(공용 split-resize.js, 기본 16:84·목록 최소 150px, 서버 이름 noteboard).
  assert.match(css, /\.nbw-body\.nbw-split \{ --ds-split-list:16fr; --ds-split-detail:84fr; --ds-split-list-min:150px; display:grid; grid-template-columns:minmax\(var\(--ds-split-list-min\), var\(--ds-split-list\)\) minmax\(0, var\(--ds-split-detail\)\)/, '왼쪽 목록 끌어 폭 조절');
  assert.doesNotMatch(js + notes, /\?v=/);
  const deviceStore = new RegExp(['local' + 'Storage', 'session' + 'Storage', 'indexed' + 'DB'].join('|'));
  for (const src of [js, board, read('app/note-boards-model.mjs')]) assert.doesNotMatch(src, deviceStore);
});
