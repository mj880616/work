// S71-54 NOTE-주제재료잇기: 주제 재료 계산(주소 검사 · 줄 읽기 · 보낼 줄 · 칩 · 끌어 놓기 · 반대 방향)과 화면 코드의 보안 줄(그릴 때 escape · 새 탭 noopener · 서버 길).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {safeUrl, cleanTitle, urlLabel, shorten, parseMaterial, materialBody, chipsOf, materialName, topicsFor, dropMaterial, pickNotes, pickDocs, exportLines,
  MATERIAL_CHIPS, TITLE_MAX, NOTE_REF_DRAG, DOC_REF_DRAG} from '../app/note-board-material-model.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const T = 't0000001', N = 'n0000001', D = 'd0000001';

test('safeUrl: http/https only; javascript:, data:, file:, blanks, control chars and logins are refused', () => {
  assert.equal(safeUrl('https://example.org/a?b=1#c'), 'https://example.org/a?b=1#c');
  assert.equal(safeUrl('  http://example.org  '), 'http://example.org/');
  assert.equal(safeUrl('HTTPS://Example.ORG/X'), 'https://example.org/X');
  assert.equal(safeUrl('www.example.org/글'), 'https://www.example.org/%EA%B8%80');
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:text/html,<b>x</b>', 'file:///etc/passwd', 'vbscript:x', 'ftp://example.org/',
    'https://exa mple.org', 'https://example.org/\nx', 'https://example.org/\u0000', 'https://user:pw@example.org/', '//example.org/x', 'example.org', '', null, 42, 'https://' + 'a'.repeat(2001)])
    assert.equal(safeUrl(bad), null, String(bad).slice(0, 40));
});
test('cleanTitle / urlLabel / shorten', () => {
  assert.equal(cleanTitle('  한 \n 줄\t이름 '), '한 줄 이름');
  assert.equal(cleanTitle(''), null);
  assert.equal([...cleanTitle('가'.repeat(60))].length, TITLE_MAX);
  assert.equal(urlLabel('https://www.example.org/a/b?c=1'), 'example.org/a/b?c=1');
  assert.equal(shorten('가나다라마바사아자차카타파하', 5), '가나다라마…');
});
test('parseMaterial: only material rows with a topic and exactly one end; addresses are checked again', () => {
  assert.deepEqual(parseMaterial({id:'m1', board_id:'bmat0001', kind:'material', from_text:T, mat_note:N, label:'이름'}),
    {id:'m1', board_id:'bmat0001', text:T, kind:'note', ref:N, title:'이름', pending:false});
  assert.equal(parseMaterial({id:'m2', board_id:'bmat0001', kind:'material', from_text:T, mat_doc:D}).kind, 'doc');
  assert.equal(parseMaterial({id:'m3', board_id:'bmat0001', kind:'material', from_text:T, mat_url:'https://example.org/'}).ref, 'https://example.org/');
  for (const bad of [{id:'m', board_id:'bmat0001', kind:'line', from_text:T, mat_note:N}, {id:'m', board_id:'bmat0001', kind:'material', mat_note:N}, {id:'m', board_id:'bmat0001', kind:'material', from_text:T, to_note:N},
    {id:'m', board_id:'bmat0001', kind:'material', from_text:T, mat_note:N, mat_doc:D}, {id:'m', board_id:'bmat0001', kind:'material', from_text:T, mat_url:'javascript:alert(1)'},
    {id:'m', board_id:'nope', kind:'material', from_text:T, mat_note:N}, null])
    assert.equal(parseMaterial(bad), null);
});
test('materialBody: the row sent to the server (no workspace from here, http/https only)', () => {
  assert.deepEqual(materialBody({board_id:'bmat0001', text:T, kind:'link', ref:' https://example.org/x ', title:' 기사 '}),
    {board_id:'bmat0001', kind:'material', from_text:T, mat_url:'https://example.org/x', label:'기사'});
  assert.deepEqual(materialBody({board_id:'bmat0001', text:T, kind:'doc', ref:D}), {board_id:'bmat0001', kind:'material', from_text:T, mat_doc:D, label:null});
  assert.equal(materialBody({board_id:'bmat0001', text:T, kind:'link', ref:'javascript:alert(1)'}), null);
  assert.equal(materialBody({board_id:'bmat0001', text:T, kind:'other', ref:D}), null);
  assert.equal('workspace_id' in materialBody({board_id:'bmat0001', text:T, kind:'note', ref:N}), false);
});
test('chips: 3 shown then +n; names use the current title, locked notes stay hidden', () => {
  const list = Array.from({length:5}, (_, i) => ({id:'m' + i}));
  assert.equal(MATERIAL_CHIPS, 3);
  assert.deepEqual(chipsOf(list).more, 2); assert.equal(chipsOf(list).shown.length, 3); assert.equal(chipsOf(list.slice(0, 2)).more, 0);
  const names = {noteTitle:id => (id === N ? '지금 제목' : null), docTitle:() => null, locked:id => id === 'locked'};
  assert.equal(materialName({kind:'note', ref:N, title:'옛 제목'}, names), '지금 제목');
  assert.equal(materialName({kind:'note', ref:'locked', title:'비밀'}, names), '잠긴 노트');
  assert.equal(materialName({kind:'doc', ref:D, title:'이을 때 이름'}, names), '이을 때 이름');
  assert.equal(materialName({kind:'link', ref:'https://www.example.org/p', title:null}, names), 'example.org/p');
});
test('topicsFor: the topics that hold this note or document, each once', () => {
  const all = [{kind:'note', ref:N, text:'a', board_id:'b1'}, {kind:'note', ref:N, text:'a', board_id:'b1'}, {kind:'doc', ref:N, text:'b', board_id:'b1'}, {kind:'note', ref:N, text:'c', board_id:'b2'}];
  assert.deepEqual(topicsFor(all, 'note', N), [{board:'b1', text:'a'}, {board:'b2', text:'c'}]);
});
test('dropMaterial: note rows, library rows and http(s) addresses; files and other text are not materials', () => {
  const dt = data => ({types:Object.keys(data), getData:t => data[t] ?? ''});
  const opts = {noteType:NOTE_REF_DRAG, docType:DOC_REF_DRAG};
  assert.deepEqual(dropMaterial(dt({[NOTE_REF_DRAG]:N}), opts), {kind:'note', ref:N});
  assert.deepEqual(dropMaterial(dt({[DOC_REF_DRAG]:D, 'text/plain':D}), opts), {kind:'doc', ref:D});
  assert.deepEqual(dropMaterial(dt({'text/uri-list':'# c\nhttps://example.org/a', 'text/x-moz-url':'https://example.org/a\n기사 제목'}), opts), {kind:'link', ref:'https://example.org/a', title:'기사 제목'});
  assert.deepEqual(dropMaterial(dt({'text/plain':'https://example.org/b', 'text/html':'<a href="https://example.org/b">A &amp; B</a>'}), opts), {kind:'link', ref:'https://example.org/b', title:'A & B'});
  assert.equal(dropMaterial(dt({'text/plain':'javascript:alert(1)'}), opts), null);
  assert.equal(dropMaterial(dt({'text/uri-list':'data:text/html,x'}), opts), null);
  assert.equal(dropMaterial(dt({'text/plain':'그냥 글'}), opts), null);
  assert.equal(dropMaterial(dt({Files:'', 'text/plain':'https://example.org/'}), opts), null);
});
test('picker lists: notes newest first without locked ones; library recent, find and folders', () => {
  const notes = [{id:'1', raw_text:'사과 이야기', updated_at:'2026-11-01'}, {id:'2', raw_text:'배', updated_at:'2026-11-03'}, {id:'3', raw_text:'잠긴 사과', updated_at:'2026-11-05'}];
  const opt = {titleOf:n => n.raw_text, hidden:n => n.id === '3'};
  assert.deepEqual(pickNotes(notes, '', opt).map(r => r.ref), ['2', '1']);
  assert.deepEqual(pickNotes(notes, '사 과', opt).map(r => r.ref), ['1']);
  const docs = [{id:'a', title:'회의 자료', created_at:'2026-11-02'}, {id:'b', file_name:'표.xlsx', created_at:'2026-11-01'}];
  assert.deepEqual(pickDocs(docs, '표').rows.map(r => r.ref), ['b']);
  const folders = [{id:'f1', name:'위', parent_id:null}, {id:'f2', name:'아래', parent_id:'f1'}];
  const got = pickDocs(docs, '', {view:'folder', folder:'f1', folders, itemFolder:new Map([['a', 'f1']])});
  assert.deepEqual(got.folders, [{id:'f2', name:'아래'}]); assert.deepEqual(got.rows.map(r => r.ref), ['a']); assert.deepEqual(got.path, [{id:'f1', name:'위'}]);
  assert.deepEqual(pickDocs(docs, '', {view:'folder', folder:null, folders, itemFolder:new Map([['a', 'f1']])}).rows.map(r => r.ref), ['b']);
});
test('export lines name every material', () => {
  assert.deepEqual(exportLines([{kind:'link', ref:'https://e.org/'}, {kind:'note', ref:N}], m => (m.kind === 'link' ? '기사' : '노트 제목')), ['링크 · 기사 (https://e.org/)', '노트 · 노트 제목']);
});

// ---- 화면 코드의 보안 줄 ----
test('board chips escape names and ids; links open in a new tab with noopener; materials are not drawn as lines', () => {
  const board = read('app/note-board.js');
  const chips = board.slice(board.indexOf('const matsHtml'), board.indexOf('const nodeHtml'));
  assert.ok(chips.length > 200);
  assert.match(chips, /esc\(m\.id\)/); assert.match(chips, /esc\(shorten\(m\.name\)\)/); assert.match(chips, /esc\(`\$\{what\} 열기`\)/);
  // 칩 글의 모든 \${…}은 esc() · 아이콘 · 종류·수·이미 만든 조각뿐(이름·주소·id를 그대로 넣지 않음). esc 안의 글 조각(what)은 esc로 감싼 줄에서만.
  const safeExpr = /^(esc\(|iconSvg\(|m\.kind$|m\.pending \?|more$|list\.length$|shown\.map\(|tail$|list\.map\(|MATERIAL_KIND_NAMES\[m\.kind\]$|m\.name$|what$)/;
  for (const line of chips.split('\n')) for (const m of line.matchAll(/\$\{([^{}]+(?:\{[^{}]*\}[^{}]*)*)\}/g)) {
    const e = m[1].trim(); assert.ok(safeExpr.test(e), `chip markup value: ${e}`);
    if (/^(m\.name|what)$/.test(e)) assert.ok(/const what = `|esc\(`/.test(line), `name only inside esc(): ${line.slice(0, 80)}`);
  }
  assert.doesNotMatch(chips, /href=/, 'chips are buttons, not links with stored addresses');
  const host = read('app/basket-notes.js');
  assert.match(host, /if \(m\.kind === 'link'\) \{ const url = safeUrl\(m\.ref\); if \(url\) window\.open\(url, '_blank', 'noopener,noreferrer'\)/);
  const data = read('app/note-board-links-data.js');
  assert.match(data, /links:rows\.filter\(r => !isMat\(r\)\)\.map\(parseLink\)/, 'material rows never become lines');
  assert.match(read('app/note-board-material-model.mjs'), /\[kind === 'note' \? 'mat_note' : 'mat_doc'\]/, 'note materials use mat_note, not the line end to_note (taking a card off a board keeps them)');
  assert.match(data, /body:\{workspace_id:ws\(rt\), \.\.\.body\}/, 'workspace comes from the signed-in session, never from the row');
});
test('picker and viewer write text with textContent or escape; viewer opens drive only for https', () => {
  const pick = read('app/note-board-material-pick.js'), view = read('app/note-board-material-view.js');
  for (const m of pick.matchAll(/\$\{([^}]+)\}/g)) {
    const e = m[1].trim();
    if (/^(esc\(|iconSvg\(|CSS\.escape\(|bottomInset\(|\[\.\.\.topic\]|tabs$|k$|n$|r\.kind$|p\.kind$|i$|ICON|doc \?|state\.(tab|view)|had \?|path|folders|got\.|on$|.*\? '|.*\.map\()/.test(e)) continue;
    assert.fail(`unescaped value in picker markup: ${e}`);
  }
  assert.doesNotMatch(view, /innerHTML\s*=\s*(?!\s|iconSvg)/, 'viewer builds nodes with textContent');
  assert.match(view, /\/\^https:\\\/\\\/\/\.test\(doc\.drive_url\)/);
});
test('library menu line and drag type use the shared owner-only read', () => {
  const lib = read('app/library-board-topics.js');
  assert.match(lib, /readMaterialTopics\('doc', id\)/);
  assert.doesNotMatch(lib, /innerHTML/);
  assert.match(read('app/library-folders.js'), /setData\(DOC_REF_DRAG,d\.id\)/);
  assert.match(read('app/note-boards.js'), /setData\(NOTE_REF_DRAG, n\.dataset\.nbbNote\)/);
});
