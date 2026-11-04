import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pastedName, namePasted, clipboardFiles, bindPaste } from '../app/paste-files.mjs';
// UPD-그림붙여넣기: names of pasted pictures, what a paste carries, and the one paste listener.
const at = new Date(2026, 10, 4, 16, 18);
const png = (name = 'image.png') => new File(['x'], name, {type: 'image/png'});

test('a screenshot gets 붙여넣은 그림 MM-DD HH:MM.ext; a real file name is kept', () => {
  assert.equal(pastedName(png(), at), '붙여넣은 그림 11-04 16:18.png');
  assert.equal(pastedName(new File(['x'], '', {type: 'image/jpeg'}), at), '붙여넣은 그림 11-04 16:18.jpg');
  assert.equal(pastedName(png('현장.png'), at), '현장.png');
  assert.equal(pastedName(new File(['x'], 'a.pdf', {type: 'application/pdf'}), at), 'a.pdf');
});
test('pictures pasted in the same minute get (2), (3) and never repeat a name already chosen', () => {
  const first = namePasted([png(), png()], {now: at});
  assert.deepEqual(first.map(f => f.name), ['붙여넣은 그림 11-04 16:18.png', '붙여넣은 그림 11-04 16:18 (2).png']);
  const next = namePasted([png()], {now: at, taken: first.map(f => f.name)});
  assert.equal(next[0].name, '붙여넣은 그림 11-04 16:18 (3).png');
  assert.equal(first[0].type, 'image/png');
});
test('clipboardFiles reads files, falls back to file items, and ignores letters', () => {
  assert.deepEqual(clipboardFiles(null), []);
  assert.equal(clipboardFiles({files: [png()]}).length, 1);
  const f = png();
  assert.deepEqual(clipboardFiles({files: [], items: [{kind: 'string'}, {kind: 'file', getAsFile: () => f}]}), [f]);
  assert.deepEqual(clipboardFiles({files: [], items: [{kind: 'string'}]}), []);
});
function fakeTarget() {
  const listeners = [];
  return {listeners, addEventListener: (t, fn) => listeners.push([t, fn]), removeEventListener: (t, fn) => { const i = listeners.findIndex(l => l[1] === fn); if (i >= 0) listeners.splice(i, 1); }};
}
const paste = (files, text = '') => { const e = {clipboardData: {files, getData: () => text}, defaultPrevented: false, prevented: 0, preventDefault() { this.prevented++; }}; return e; };
test('bindPaste takes a picture, keeps default paste when letters come along, and leaves handled or refused pastes alone', () => {
  const target = fakeTarget(), got = []; let allow = true;
  bindPaste(target, files => got.push(files.map(f => f.name)), {canTake: () => allow, now: () => at});
  const run = e => target.listeners[0][1](e);
  const alone = paste([png()]); run(alone);
  assert.equal(alone.prevented, 1); assert.deepEqual(got, [['붙여넣은 그림 11-04 16:18.png']]);
  const withText = paste([png()], '글'); run(withText);
  assert.equal(withText.prevented, 0); assert.equal(got.length, 2);
  const textOnly = paste([], '글'); run(textOnly); assert.equal(got.length, 2); assert.equal(textOnly.prevented, 0);
  const done = paste([png()]); done.defaultPrevented = true; run(done); assert.equal(got.length, 2);
  allow = false; const busy = paste([png()]); run(busy); assert.equal(got.length, 2); assert.equal(busy.prevented, 0);
});
test('binding the same key on the same target again replaces the listener', () => {
  const target = fakeTarget();
  bindPaste(target, () => {}, {key: 'k'}); bindPaste(target, () => {}, {key: 'k'});
  assert.equal(target.listeners.length, 1);
  bindPaste(target, () => {}, {key: 'other'});
  assert.equal(target.listeners.length, 2);
});
