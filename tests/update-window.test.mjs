import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNote, attachNoteDoc, saveUpdateDoc, updateNote, readBasket } from '../app/basket-data.js';
import { keepsFormat, saveUpdate } from '../app/update-places.js';

// ED③ 업데이트 (설계 11.4 순서 3): the update's saved form (doc) goes with the letters onto the basket update only.
const runtime = api => ({context:{read:() => ({workspace:{id:'w'}, user:{id:'u'}})}, api});
const q = path => new URL(path, 'http://x').searchParams;
const DOC = {v:'ed1', doc:{type:'doc', content:[{type:'paragraph', content:[{type:'text', text:'글'}]}]}};

test('a new basket update carries its saved form in the same insert; without one the body is as before', async () => {
  const calls = [];
  const rt = runtime(async (path, options) => { calls.push(options.body); return [{id:'n', ...options.body}]; });
  await createNote({raw_text:'글', doc:DOC}, rt);
  await createNote({raw_text:'글'}, rt);
  assert.deepEqual(calls[0], {workspace_id:'w', raw_text:'글', doc:DOC});
  assert.deepEqual(calls[1], {workspace_id:'w', raw_text:'글'});
});

test('the form of an update made by the file upload is put on afterwards, only on a basket row that has none, letters untouched', async () => {
  const calls = [];
  const rt = runtime(async (path, options) => { calls.push({path, options}); return [{id:'n', updated_at:'2026-10-24T00:00:00Z'}]; });
  await attachNoteDoc('n', DOC, rt);
  const [{path, options}] = calls;
  assert.equal(options.method, 'PATCH');
  assert.deepEqual([q(path).get('id'), q(path).get('workspace_id'), q(path).get('kind'), q(path).get('doc')], ['eq.n', 'eq.w', 'eq.basket', 'is.null']);
  assert.deepEqual(Object.keys(options.body), ['doc']);
  await assert.rejects(attachNoteDoc('n', DOC, runtime(async () => [])), /서식/);
  assert.equal(await attachNoteDoc('n', null, rt), null);
});

test('saving letters and form together applies only while the update is still the version read; a changed update is refused', async () => {
  const calls = [];
  const rt = runtime(async (path, options) => { calls.push({path, options}); return calls.length === 1 ? [{id:'n'}] : []; });
  await saveUpdateDoc('n', {raw_text:'글', doc:DOC, version:'2026-10-24T00:00:00.000Z'}, rt);
  const [{path, options}] = calls;
  assert.deepEqual([q(path).get('id'), q(path).get('kind'), q(path).get('updated_at')], ['eq.n', 'eq.basket', 'eq.2026-10-24T00:00:00.000Z']);
  assert.deepEqual(Object.keys(options.body).sort(), ['doc', 'raw_text', 'updated_at']);
  await assert.rejects(saveUpdateDoc('n', {raw_text:'글', doc:DOC, version:'2026-10-24T00:00:00.000Z'}, rt), e => e.code === 'note_changed');
  await assert.rejects(saveUpdateDoc('n', {raw_text:'글', doc:DOC, version:''}, rt), e => e.code === 'note_changed');
  await assert.rejects(saveUpdateDoc('n', {raw_text:'', doc:DOC, version:'2026-10-24T00:00:00.000Z'}, rt));
  await assert.rejects(saveUpdateDoc('n', {raw_text:'글', doc:null, version:'2026-10-24T00:00:00.000Z'}, rt));
});

test('a letters-only edit of an update drops the saved form with the same write (letters and form never disagree)', async () => {
  let body = null;
  await updateNote('n', {raw_text:'다른 글'}, runtime(async (path, options) => { body = options.body; return [{id:'n'}]; }));
  assert.equal(body.doc, null);
});

test('the basket screen reads the saved form; the other readers of the basket keep reading letters only', async () => {
  const selects = [];
  const rt = runtime(async path => { if (path.includes('app_notes')) selects.push(q(path).get('select')); return []; });
  await readBasket(rt);
  await readBasket(rt, {doc:true});
  assert.ok(!/(^|,)doc(,|$)/.test(selects[0]));
  assert.match(selects[1], /(^|,)doc(,|$)/);
});

test('the saved form is kept for the basket, several places, a bundle or files; one organization or project record keeps letters only', () => {
  assert.equal(keepsFormat(null), true);
  assert.equal(keepsFormat([]), true);
  assert.equal(keepsFormat([{kind:'organization', id:'o'}, {kind:'project', id:'p'}]), true);
  assert.equal(keepsFormat([{kind:'reference', id:'r'}]), true);
  assert.equal(keepsFormat([{kind:'project', id:'p'}], 1), true);
  assert.equal(keepsFormat({kind:'organization', id:'o'}), false);
  assert.equal(keepsFormat([{kind:'project', id:'p'}]), false);
});

test('one organization or project record is saved as letters only even when a form is handed in', async () => {
  const calls = [];
  const rt = {context:{read:() => ({workspace:{id:'w'}, user:{id:'u'}})}, api:async (path, options) => { calls.push({path, body:options?.body}); return [{id:'r'}]; }};
  await saveUpdate({places:[{kind:'organization', id:'o'}], text:'글', owner:'u', doc:DOC}, rt);
  assert.ok(calls.length >= 1);
  for (const c of calls) assert.ok(!('doc' in (c.body || {})), c.path);
});

test('the update window has no switch to a note, no autosave and no browser storage; the entrances pass the form to the existing saves', () => {
  const win = readFileSync('app/update-window.js', 'utf8');
  assert.ok(!/localStorage|sessionStorage|indexedDB|setInterval/.test(win));
  assert.ok(!/import[^;]*(createNoteDoc|md-editor|write-window)/.test(win));
  assert.match(readFileSync('app/home-quick.js', 'utf8'), /updateVia:async\(letters,list,doc\)=>\{[^}]*save\(\{doc\}\)/);
  assert.match(readFileSync('app/basket.js', 'utf8'), /saveUpdateDoc\(id, \{raw_text:changes\.raw_text, doc:changes\.doc, version:changes\.version\}\)/);
});
