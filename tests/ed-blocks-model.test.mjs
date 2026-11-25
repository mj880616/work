// NOTE-노션편집 ①(나): 문서 모델 — 접기(toggle)·할 일 체크(check 목록, checked)의 저장 모양, 옛 문서 호환, 내보내기 글자,
// 블록 옮기기 자리 계산, '/' 목록 거르기. 브라우저 없이 본다(화면은 tests/app-e2e/note-blocks.spec.mjs).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cleanDoc, CHECK_MARKER, bulletGlyph} from '../app/ed-schema.mjs';
import {toPlain, toTelegram, toHangul} from '../app/ed-text.mjs';
import {docToMarkdown} from '../app/ed-markdown-out.mjs';
import {movedIndex, slashMatches, SLASH_ITEMS, TURN_ITEMS} from '../app/ed-blocks.js';

const p = (text, attrs = {style: 'body2'}) => ({type: 'paragraph', attrs, ...(text ? {content: [{type: 'text', text}]} : {})});
const doc = (...content) => ({v: 'ed1', doc: {type: 'doc', content}});
const li = (text, attrs) => ({type: 'list_item', ...(attrs ? {attrs} : {}), content: [p(text)]});

test('접기: open false is saved, open true is the default (not written); the first line is always a paragraph', () => {
  const folded = cleanDoc(doc({type: 'toggle', attrs: {open: false}, content: [p('제목 줄'), p('안쪽')]}));
  assert.deepEqual(folded.doc.content[0], {type: 'toggle', attrs: {open: false}, content: [p('제목 줄'), p('안쪽')]});
  const open = cleanDoc(doc({type: 'toggle', attrs: {open: true}, content: [p('줄')]}));
  assert.deepEqual(open.doc.content[0], {type: 'toggle', content: [p('줄')]});
  // A toggle starting with a list gets an empty ▸ line; an empty toggle keeps one empty line; a bad open value is the default.
  const odd = cleanDoc(doc({type: 'toggle', attrs: {open: 'no'}, content: [{type: 'bullet_list', content: [li('가')]}]}, {type: 'toggle'}));
  assert.equal(odd.doc.content[0].attrs, undefined);
  assert.equal(odd.doc.content[0].content[0].type, 'paragraph');
  assert.equal(odd.doc.content[0].content[1].type, 'bullet_list');
  assert.deepEqual(odd.doc.content[1], {type: 'toggle', content: [{type: 'paragraph', attrs: {style: 'body2'}}]});
  // A toggle inside a toggle, a quote and a list item is kept.
  const nested = cleanDoc(doc({type: 'blockquote', content: [{type: 'toggle', content: [p('a'), {type: 'toggle', attrs: {open: false}, content: [p('b')]}]}]}));
  assert.equal(nested.doc.content[0].content[0].content[1].attrs.open, false);
});

test('할 일 체크: the check marker and checked true are kept; other values are not', () => {
  const v = cleanDoc(doc({type: 'bullet_list', attrs: {marker: CHECK_MARKER}, content: [li('한 일', {checked: true}), li('할 일', {checked: false}), li('이상한 값', {checked: 'yes'})]}));
  const list = v.doc.content[0];
  assert.deepEqual(list.attrs, {marker: 'check'});
  assert.deepEqual(list.content.map(x => x.attrs), [{checked: true}, undefined, undefined]);
  assert.equal(bulletGlyph('check', 0), '☐');
  assert.equal(cleanDoc(doc({type: 'bullet_list', attrs: {marker: 'tick'}, content: [li('x')]})).doc.content[0].attrs, undefined);
});

test('옛 문서 호환: a document saved before (no toggle, no check) comes back exactly the same', () => {
  const old = doc(p('첫 줄'), {type: 'heading', attrs: {level: 2}, content: [{type: 'text', text: '제목'}]},
    {type: 'bullet_list', attrs: {marker: 'dash'}, content: [li('가'), li('나')]}, {type: 'ordered_list', attrs: {order: 1}, content: [li('하나')]},
    {type: 'blockquote', content: [p('인용')]}, {type: 'horizontal_rule'}, {type: 'code_block', content: [{type: 'text', text: 'x = 1'}]});
  assert.deepEqual(cleanDoc(old), old);
  assert.deepEqual(cleanDoc(cleanDoc(old)), old);
});

test('내보내기: 접기 is its first line and what is under it (folded or not, no fold sign in letters); check items are ☐ / ☑; markdown has - [ ] / - [x]', () => {
  const v = doc({type: 'toggle', attrs: {open: false}, content: [p('회의 안건'), p('세부 내용')]},
    {type: 'bullet_list', attrs: {marker: 'check'}, content: [li('보고서', {checked: true}), li('전화')]});
  assert.equal(toPlain(v), '회의 안건\n\n세부 내용\n\n☑ 보고서\n☐ 전화');
  assert.ok(toTelegram(v).startsWith('회의 안건\n\n세부 내용'));
  assert.ok(toTelegram(v).includes('☐ 전화'));
  const h = toHangul(v);
  assert.ok(h.text.includes('회의 안건') && h.text.includes('세부 내용') && h.text.includes('☑ 보고서'));
  assert.ok(h.html.includes('회의 안건</p>'));
  const md = docToMarkdown(v);
  assert.ok(md.includes('회의 안건') && md.includes('세부 내용'), md);
  assert.ok(md.includes('- [x] 보고서') && md.includes('- [ ] 전화'), md);
});

test('블록 옮기기: the gap a block is dropped in → its new place (dropping it on either side of itself is no move)', () => {
  // three blocks [A, B, C]; gaps 0..3
  assert.equal(movedIndex(2, 0), 0); // C to the top
  assert.equal(movedIndex(0, 3), 2); // A to the end
  assert.equal(movedIndex(0, 2), 1); // A after B
  assert.equal(movedIndex(1, 1), -1);
  assert.equal(movedIndex(1, 2), -1);
  const order = (list, from, to) => { const at = movedIndex(from, to); if (at < 0) return list; const out = list.slice(); const [x] = out.splice(from, 1); out.splice(at, 0, x); return out; };
  assert.deepEqual(order(['A', 'B', 'C'], 2, 0), ['C', 'A', 'B']);
  assert.deepEqual(order(['A', 'B', 'C'], 0, 3), ['B', 'C', 'A']);
});

test("'/' 목록: every asked kind is there; letters typed after / narrow it (Korean and English words)", () => {
  assert.deepEqual(SLASH_ITEMS.map(x => x[0]), ['h1', 'h2', 'h3', 'bullet', 'ordered', 'check', 'quote', 'rule', 'table', 'photo', 'toggle', 'code']);
  assert.deepEqual(slashMatches('').length, SLASH_ITEMS.length);
  assert.deepEqual(slashMatches('제목').map(x => x[0]), ['h1', 'h2', 'h3']);
  assert.deepEqual(slashMatches('접기').map(x => x[0]), ['toggle']);
  assert.deepEqual(slashMatches('h2').map(x => x[0]), ['h2']);
  assert.equal(slashMatches('todo')[0][0], 'check');
  assert.equal(slashMatches('표')[0][0], 'table');
  assert.deepEqual(slashMatches('없는말'), []);
  assert.deepEqual(TURN_ITEMS.map(x => x[0]), ['p', 'h1', 'h2', 'h3', 'bullet', 'ordered', 'check', 'quote', 'toggle', 'code']);
});

test('the Edge copy of ed-schema.mjs stays the same as the app file (below its banner)', () => {
  const app = readFileSync(new URL('../app/ed-schema.mjs', import.meta.url), 'utf8');
  const edge = readFileSync(new URL('../supabase/functions/_shared/ed-schema.mjs', import.meta.url), 'utf8');
  assert.equal(edge.split('\n').slice(2).join('\n'), app);
});

test('블록 편집 기본값은 서버 화면 기억(view_prefs.note_blocks), 노트마다 고른 값은 metadata.block_edit — 기기 저장 없음', () => {
  const notes = readFileSync(new URL('../app/basket-notes.js', import.meta.url), 'utf8');
  const blocks = readFileSync(new URL('../app/ed-blocks.js', import.meta.url), 'utf8');
  assert.match(notes, /noteBlockEdit\(selected\) \?\? \(viewPrefs\.get\('note_blocks'\) === true\)/);
  assert.match(notes, /viewPrefs\.set\('note_blocks', on, \{rejectable:true\}\)/);
  for (const src of [notes, blocks]) assert.doesNotMatch(src, new RegExp(['local', 'session'].map(w => w + 'Storage').join('|')));
});
