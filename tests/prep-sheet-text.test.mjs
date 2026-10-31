import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// PREP-서식: line-text rules shared by the next-week box and the pre-meeting sheet (prep-sheet-text.mjs), and the renderer's shape. Synthetic data only.
const t = await import('../app/prep-sheet-text.mjs');

test('wordClip: short text stays; long text is cut before a word, ends with …, stays within max', () => {
  assert.equal(t.wordClip('  짧은   줄  ', 120), '짧은 줄');
  const long = '가상 노동조합 투쟁현장을 확인하고 결과를 정리해 전달하기 '.repeat(6);
  const out = t.wordClip(long, 120);
  assert.ok([...out].length <= 120, 'within max');
  assert.ok(out.endsWith('…'));
  const words = long.trim().split(' ');
  for (const w of out.slice(0, -1).split(' ')) assert.ok(words.includes(w), `no broken word: ${w}`);
  assert.equal([...t.wordClip('가'.repeat(200), 120)].length, 120, 'no space → hard cut with …');
  assert.doesNotMatch(t.wordClip('줄\n바꿈​있음', 120), /[\n​]/);
});

test('tidyCut: an old line already cut at max (mid-word) is shown cut before the word; shorter lines unchanged', () => {
  assert.equal(t.tidyCut('가상 회의 준비', 120), '가상 회의 준비');
  const cut = [...('가상 노동조합 투쟁현장을 확인하고 결과를 정리해 전달하기 '.repeat(6))].slice(0, 120).join('');
  const out = t.tidyCut(cut, 120);
  assert.ok(out.endsWith('…'));assert.ok([...out].length <= 120);
  assert.doesNotMatch(out, /확…$|정리해 전…$/);
  const whole = '가'.repeat(119) + '.';
  assert.equal(t.tidyCut(whole, 120), whole, 'a line ending at a sentence end is kept');
});

test('splitLead: first sentence always shown, the rest folded; no split inside numbers or short heads', () => {
  assert.deepEqual(t.splitLead('가상 현장 방문 확인. 결과를 정리해 전달하기.'), {lead:'가상 현장 방문 확인.', rest:'결과를 정리해 전달하기.'});
  assert.deepEqual(t.splitLead('인상률 3.5% 이견 남음'), {lead:'인상률 3.5% 이견 남음', rest:''});
  assert.deepEqual(t.splitLead('1. 가상 안건 정리하기'), {lead:'1. 가상 안건 정리하기', rest:''});
  assert.deepEqual(t.splitLead('한 문장뿐임.'), {lead:'한 문장뿐임.', rest:''});
  assert.deepEqual(t.splitLead(''), {lead:'', rest:''});
});

test('numberGroups: visible groups are numbered in order with no gap', () => {
  const out = t.numberGroups([{key:'a', label:'① 다음 주 일정'}, {key:'b', label:'② 기한 있는 할 일'}, {key:'d', label:'④ 넘어가는 할 일'}, {key:'e', label:'⑤ 남은 챙길 것'}]);
  assert.deepEqual(out.map(g => g.label), ['① 다음 주 일정', '② 기한 있는 할 일', '③ 넘어가는 할 일', '④ 남은 챙길 것']);
  assert.deepEqual(t.numberGroups([]), []);
});

test('renderer: top lines are plain text with a small "근거 ›" tag; refs jump through one shared helper', () => {
  const view = readFileSync(new URL('../app/prep-sheet-view.js', import.meta.url), 'utf8');
  const journal = readFileSync(new URL('../app/journal.js', import.meta.url), 'utf8');
  const sheet = readFileSync(new URL('../app/pre-meeting-sheet.js', import.meta.url), 'utf8');
  assert.match(view, /-top-text/);
  assert.doesNotMatch(view, /button\(S\.open, t\.text/, 'a top line is not a whole-line button');
  assert.match(view, /'근거 ›'/);
  assert.match(view, /numberGroups\(v\.groups\)/);
  assert.match(view, /export function jumpToPrepRef/);
  assert.match(journal, /jumpToPrepRef\(/);assert.match(sheet, /jumpToPrepRef\(/);
  assert.doesNotMatch(view, new RegExp(['local', 'Storage|session', 'Storage'].join('')), 'no device storage');
});
