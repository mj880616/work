// NOTE-붙여넣기문단사라짐: the pure parts of ed-paste.mjs (line counting, blank-line split of a pasted slice) and the copy
// samples the browser test pastes (tests/fixtures/ed-paste-sources.mjs; the reader that needs a browser runs in
// tests/app-e2e/ed-paste-paragraphs.spec.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {letterLines, splitBlankLines} from '../app/ed-paste.mjs';
import {PASTE_SOURCES} from './fixtures/ed-paste-sources.mjs';

const t = text => ({type: 'text', text});
const br = {type: 'hard_break'};
const p = (...content) => ({type: 'paragraph', attrs: {style: 'body2'}, content});
const letters = n => (n.content || []).map(c => (c.type === 'hard_break' ? '\n' : c.text)).join('');

test('letterLines counts lines with letters (blank lines, spaces and CRLF do not add)', () => {
  assert.equal(letterLines('가\n\n나\r\n다'), 3);
  assert.equal(letterLines('  \n\t\n'), 0);
  assert.equal(letterLines(''), 0);
});

test('a blank line (two or more breaks) splits the paragraph; one break stays; edge breaks go', () => {
  const out = splitBlankLines({content: [p(br, t('가'), br, br, br, t('나'), br, t('다'), br)], openStart: 0, openEnd: 0});
  assert.deepEqual(out.content.map(letters), ['가', '나\n다']);
  assert.deepEqual(out.content.map(n => n.attrs), [{style: 'body2'}, {style: 'body2'}]);
});

test('nothing to split: the same slice back', () => {
  const slice = {content: [p(t('가'), br, t('나'))], openStart: 1, openEnd: 1};
  assert.equal(splitBlankLines(slice), slice);
  assert.equal(splitBlankLines(null), null);
});

test('inline-only paste (one <span> copied from a chat box) becomes open paragraphs with the given style', () => {
  const out = splitBlankLines({content: [t('하나'), br, br, {type: 'text', text: '둘', marks: [{type: 'strong'}]}]}, {style: 'body1'});
  assert.equal(out.openStart, 1);
  assert.equal(out.openEnd, 1);
  assert.deepEqual(out.content.map(n => [n.type, n.attrs.style, letters(n)]), [['paragraph', 'body1', '하나'], ['paragraph', 'body1', '둘']]);
  assert.deepEqual(out.content[1].content[0].marks, [{type: 'strong'}]);
});

test('paragraphs in lists, quotes and table cells split too; code blocks never', () => {
  const list = {type: 'bullet_list', attrs: {marker: null}, content: [{type: 'list_item', content: [p(t('가'), br, br, t('나'))]}]};
  const code = {type: 'code_block', content: [t('a\n\nb')]};
  const out = splitBlankLines({content: [list, code], openStart: 0, openEnd: 0});
  assert.deepEqual(out.content[0].content[0].content.map(letters), ['가', '나']);
  assert.equal(out.content[1], code);
});

test('copy samples: every place named, each with its plain letters and the paragraphs it should give', () => {
  const names = PASTE_SOURCES.map(s => s.name).join(' ');
  for (const place of ['Claude', 'ChatGPT', 'Google 문서', '한글', '카카오톡', '텔레그램', '파이어폭스']) assert.match(names, new RegExp(place));
  for (const s of PASTE_SOURCES) {
    assert.ok(s.text && Array.isArray(s.expect) && s.expect.length, s.name);
    // The plain letters hold every expected line (the formatted copy must not give fewer).
    assert.ok(letterLines(s.text) >= s.expect.filter(x => /\S/.test(x)).join('\n').split('\n').length, s.name);
  }
  // The reported case: Claude's answer of seven paragraphs comes as one pre-wrap box.
  const claude = PASTE_SOURCES[0];
  assert.match(claude.html, /white-space: pre-wrap/);
  assert.equal(claude.expect.length, 7);
});

test('the editor reads every paste from outside through ed-paste.mjs (one place for every opener)', () => {
  const src = readFileSync('app/ed-editor.js', 'utf8');
  assert.match(src, /import \{keepLetterBreaks, splitBlankLines\} from '\.\/ed-paste\.mjs'/);
  assert.match(src, /if \(!\/data-pm-slice\/\.test\(html\)\) keepLetterBreaks\(doc, plain\)/);
  assert.match(src, /splitBlankLines\(json,/);
});
