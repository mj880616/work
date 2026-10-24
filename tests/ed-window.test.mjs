import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {plainToDoc, plainToDocKeep} from '../app/ed-markdown.mjs';
import {toPlain} from '../app/ed-text.mjs';
import {cleanDoc, docBytes, emptyDoc} from '../app/ed-schema.mjs';
import {startDoc, isChanged, prepareSave, jsonbBytes, DOC_MAX_BYTES} from '../app/ed-window-model.mjs';
// ED③-창: the new write window's logic with no browser. Old letters → saved form keeps every line break (no extra blank line),
// the letters come back out unchanged, a change is told from "opened and closed", the opener's limits are checked before its save.
const p = (text, attrs = {style: 'body2'}) => ({type: 'paragraph', attrs, ...(text ? {content: [{type: 'text', text}]} : {})});
const doc = (...content) => ({v: 'ed1', doc: {type: 'doc', content}});

const SAMPLES = {
  update: '2026.10.21. 교섭\n- 사측 안 제시\n\n다음 주 재교섭',
  numbered: '1. 첫째\n2. 둘째\n3. 셋째\n\n가. 하위\n  나. 들여쓴 줄',
  dates: '10/21(수) 14:00 본교섭\n10/28(수) 재교섭\n\n※ 참고: 1.5배 → 2배',
  single: '한 줄만 있는 글',
  hyphens: '- a\n- b\n\n- c',
  quotes: '> 인용처럼 보이는 글\n# 제목처럼 보이는 글\n**굵게처럼** 보이는 글',
  blocks: '가\n\n나\n\n다',
};

test('the old per-line conversion adds a blank line between every two lines (the problem 설계 11.3 measured)', () => {
  const out = toPlain(plainToDoc(SAMPLES.update));
  assert.equal(out, '2026.10.21. 교섭\n\n- 사측 안 제시\n\n다음 주 재교섭');
  assert.notEqual(out, SAMPLES.update);
});

test('plainToDocKeep: the letters come back exactly, for text with and without blank lines', () => {
  for (const [name, text] of Object.entries(SAMPLES)) assert.equal(toPlain(plainToDocKeep(text)), text, name);
});

test('plainToDocKeep: a run of lines is one paragraph with hard breaks; blank lines separate paragraphs; nothing is read as format', () => {
  const made = plainToDocKeep(SAMPLES.update).doc.content;
  assert.equal(made.length, 2);
  assert.deepEqual(made[0].content.map(n => n.type), ['text', 'hard_break', 'text']);
  assert.ok(made.every(n => n.type === 'paragraph'));
  const kept = plainToDocKeep(SAMPLES.numbered).doc.content;
  assert.ok(kept.every(n => n.type === 'paragraph'), '"1." and "-" stay letters in a paragraph, never a list');
  assert.equal(kept[0].content[0].text, '1. 첫째');
});

test('plainToDocKeep: Windows and old Mac line ends, spaces-only lines, blank ends', () => {
  assert.equal(toPlain(plainToDocKeep('가\r\n나\r\n\r\n다')), '가\n나\n\n다');
  assert.equal(toPlain(plainToDocKeep('가\n   \n나')), '가\n\n나', 'a line of only spaces is a blank line (toPlain tidy does the same)');
  assert.equal(toPlain(plainToDocKeep('\n\n가\n나\n\n')), '가\n나');
});

test('plainToDocKeep: empty and missing text give one empty paragraph; the result is a clean saved form', () => {
  for (const empty of ['', null, undefined, '\n\n']) {
    const made = plainToDocKeep(empty);
    assert.deepEqual(made.doc.content, [{type: 'paragraph', attrs: {style: 'body2'}}]);
    assert.equal(toPlain(made), '');
  }
  const made = plainToDocKeep(SAMPLES.update);
  assert.deepEqual(cleanDoc(made), made);
});

test('startDoc: the row\'s own doc wins; old letters use convert, else plainToDocKeep; a bad convert falls back', () => {
  const own = doc(p('서식 글'));
  assert.deepEqual(startDoc({doc: own, text: '옛 글'}), cleanDoc(own));
  assert.deepEqual(startDoc({doc: null, text: SAMPLES.update}), plainToDocKeep(SAMPLES.update));
  assert.deepEqual(startDoc({text: '가', convert: () => doc(p('변환'))}), cleanDoc(doc(p('변환'))));
  assert.deepEqual(startDoc({text: SAMPLES.single, convert: () => { throw new Error('x'); }}), plainToDocKeep(SAMPLES.single));
  assert.deepEqual(startDoc({text: SAMPLES.single, convert: () => 'not a doc'}), plainToDocKeep(SAMPLES.single));
  assert.deepEqual(startDoc({doc: {junk: 1}, text: '글'}), plainToDocKeep('글'));
});

test('isChanged: the same document (even rebuilt) is not a change; text, marks or an added block are', () => {
  const a = plainToDocKeep(SAMPLES.update);
  assert.equal(isChanged(a, JSON.parse(JSON.stringify(a))), false, 'opening and closing alone');
  assert.equal(isChanged(a, plainToDocKeep(SAMPLES.update + '!')), true);
  const bold = doc(p('가'));
  const boldMark = doc({type: 'paragraph', attrs: {style: 'body2'}, content: [{type: 'text', text: '가', marks: [{type: 'strong'}]}]});
  assert.equal(isChanged(bold, boldMark), true, 'a format alone is a change even when the letters are the same');
  assert.equal(isChanged(emptyDoc(), emptyDoc()), false);
  assert.equal(isChanged(emptyDoc(), plainToDocKeep('글')), true);
});

test('prepareSave: hands the saved form and the letters; the letters are what toPlain takes out', () => {
  const value = plainToDocKeep(SAMPLES.update);
  const out = prepareSave({value});
  assert.equal(out.ok, true);
  assert.equal(out.text, SAMPLES.update);
  assert.deepEqual(out.value, cleanDoc(value));
});

test('prepareSave: textOnly gives letters and no document', () => {
  const out = prepareSave({value: plainToDocKeep('가\n나'), textOnly: true});
  assert.equal(out.ok, true);
  assert.equal(out.value, null);
  assert.equal(out.text, '가\n나');
});

test('prepareSave: the letter limit counts the letters taken out (500 for a project record) and refuses over it', () => {
  const at = prepareSave({value: plainToDocKeep('가'.repeat(500)), limit: 500});
  assert.equal(at.ok, true);
  const over = prepareSave({value: plainToDocKeep('가'.repeat(501)), limit: 500});
  assert.equal(over.ok, false);
  assert.match(over.message, /500자/);
  assert.match(over.message, /501자/);
  assert.equal(over.value, undefined, 'nothing to save is handed out');
  // The count is of the taken-out letters: a bullet list adds "- " marks, a table adds " | ".
  const list = doc({type: 'bullet_list', content: [{type: 'list_item', content: [p('가가가')]}]});
  assert.equal(prepareSave({value: list, limit: 5}).ok, true);
  assert.equal(prepareSave({value: list, limit: 4}).ok, false);
  assert.equal(prepareSave({value: plainToDocKeep('가'.repeat(100000)), limit: 0}).ok, true, 'no limit');
});

test('jsonbBytes counts the way the database prints jsonb (a space after every ":" and ",")', () => {
  assert.equal(jsonbBytes({a: 1, b: [1, 2]}), '{"a": 1, "b": [1, 2]}'.length);
  assert.equal(jsonbBytes({}), 2);
  assert.equal(jsonbBytes([]), 2);
  assert.equal(jsonbBytes({t: '가나'}), new TextEncoder().encode('{"t": "가나"}').length);
  assert.equal(jsonbBytes(null), 4);
  assert.ok(jsonbBytes(plainToDocKeep(SAMPLES.update)) > docBytes(plainToDocKeep(SAMPLES.update)));
});

test('prepareSave: a saved form over the size limit is refused (the database check), but textOnly does not store it', () => {
  const big = doc(...Array.from({length: 40}, (_, i) => p('가나다라마바사아자차카타파하' + i)));
  const size = jsonbBytes(cleanDoc(big));
  assert.equal(prepareSave({value: big, maxBytes: size}).ok, true, 'exactly at the limit');
  const out = prepareSave({value: big, maxBytes: size - 1});
  assert.equal(out.ok, false);
  assert.match(out.message, /서식/);
  assert.equal(prepareSave({value: big, maxBytes: size - 1, textOnly: true}).ok, true);
  assert.equal(prepareSave({value: 'junk'}).ok, false);
});

test('prepareSave: the size is counted as jsonb text, not as plain JSON (a form between the two is refused)', () => {
  const value = doc(...Array.from({length: 40}, (_, i) => p('가나다라마바사아자차카타파하' + i)));
  const clean = cleanDoc(value);
  const plain = docBytes(clean), jsonb = jsonbBytes(clean);
  assert.ok(jsonb > plain);
  assert.equal(prepareSave({value, maxBytes: plain}).ok, false);
});

test('a real-size document stays under the default limit: the cleaning caps letters and nodes first', () => {
  const value = doc(...Array.from({length: 3000}, (_, i) => p('가나다라마바사아자차카타파하'.repeat(5) + i)));
  assert.ok(jsonbBytes(cleanDoc(value)) < DOC_MAX_BYTES);
  assert.equal(prepareSave({value}).ok, true);
});

test('opened and closed untouched: the editor value equals the start, so no save is asked for (any sample)', () => {
  for (const text of Object.values(SAMPLES)) {
    const start = plainToDocKeep(text);
    // The editor hands back its own cleaned copy of what it was given.
    const back = cleanDoc(JSON.parse(JSON.stringify(start)));
    assert.equal(isChanged(start, back), false, text);
    assert.equal(toPlain(back), text);
  }
});

// ED③ 노트 (설계 11.4 순서 2): only the note screens open the new window (through note-window.js). Updates, diary and records keep the old one
// until their own PRs.
test('the new write window is opened by the note screens only (note-window.js); the other screens keep the old one', () => {
  const files = ['home-quick.js', 'basket.js', 'write-window.js', 'workplace-detail.js', 'project-system-v3.js', 'diary.js', 'home-read.js', 'journal.js', 'basket-notes.js', 'topbar-actions.js'];
  for (const f of files) {
    const src = readFileSync(`app/${f}`, 'utf8');
    assert.ok(!/ed-window\.js/.test(src), f);
  }
  assert.match(readFileSync('app/note-window.js', 'utf8'), /from '\.\/ed-window\.js'/);
  assert.match(readFileSync('app/basket-notes.js', 'utf8'), /import\('\.\/note-window\.js'\)/);
  assert.match(readFileSync('app/topbar-actions.js', 'utf8'), /import\('\.\/note-window\.js'\)/);
});

test('the old editor still exports copyText (moved to copy-text.js) and both windows are counted by bigWindowOpen', () => {
  assert.match(readFileSync('app/md-editor.js', 'utf8'), /export \{copyText\}/);
  assert.match(readFileSync('app/copy-text.js', 'utf8'), /export async function copyText/);
  const src = readFileSync('app/big-window-open.js', 'utf8');
  assert.ok(src.includes("'#mdEditor'") && src.includes("'#edWindow'"));
});
