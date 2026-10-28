import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNote, attachNoteDoc, saveUpdateDoc, updateNote, readBasket } from '../app/basket-data.js';
import { textLimitFor, saveUpdate } from '../app/update-places.js';

// ED③ 업데이트 (설계 11.4 순서 3): the update's saved form (doc) goes with the letters onto the basket update (ED③ 기록: and one organization's own record).
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

// MTG-프로젝트합치기 3단계: 프로젝트(사업영역) 하나도 진행 기록(500자 한 줄)이 아니라 바구니 업데이트 + 연결이므로 어느 곳이든 20000자다.
test('every place takes 20000 letters, one project (사업영역) included', () => {
  assert.equal(textLimitFor(null), 20000);
  assert.equal(textLimitFor([]), 20000);
  assert.equal(textLimitFor({kind:'organization', id:'o'}), 20000);
  assert.equal(textLimitFor([{kind:'organization', id:'o'}]), 20000);
  assert.equal(textLimitFor([{kind:'project', id:'p'}]), 20000);
  assert.equal(textLimitFor({kind:'project', id:'p'}), 20000);
  assert.equal(textLimitFor([{kind:'project', id:'p'}, {kind:'organization', id:'o'}]), 20000);
});

// 조직 하나는 그 조직 기록에 서식과 함께 한 번에 넣는다. 프로젝트 하나는 서식을 담은 바구니 업데이트를 만든 뒤
// 바구니 [연결하기]와 같은 app_basket_confirm_links(reason '직접 연결')로 그 프로젝트에 잇는다(진행 기록 표에는 쓰지 않는다).
test('one organization record is saved with its saved form in the same insert; one project is a basket update with the form, linked to it', async () => {
  const calls = [];
  const prev = {window:globalThis.window, CustomEvent:globalThis.CustomEvent};
  globalThis.window = {dispatchEvent:() => {}, addEventListener:() => {}};
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
  try {
    const rt = {context:{read:() => ({workspace:{id:'w'}, user:{id:'u'}})}, api:async (path, options) => {
      calls.push({path, body:options?.body});
      if (path.includes('app_basket_confirm_links')) return {ok:true, created:1, existing:0};
      if (path.startsWith('/rest/v1/app_notes')) return [{id:'n', updated_at:'2026-10-28T00:00:00Z', raw_text:options.body.raw_text}];
      return [{id:'r'}];
    }};
    await saveUpdate({places:[{kind:'organization', id:'o'}], text:'글', owner:'u', doc:DOC}, rt);
    const one = await saveUpdate({places:[{kind:'project', id:'p'}], text:'글', owner:'u', doc:DOC}, rt);
    await saveUpdate({places:[{kind:'organization', id:'o'}], text:'글', owner:'u'}, rt);
    await saveUpdate({places:[{kind:'project', id:'p'}], text:'글', owner:'u'}, rt);
    assert.deepEqual(calls.map(c => c.path.split('?')[0]), ['/rest/v1/app_suborganization_updates', '/rest/v1/app_notes', '/rest/v1/rpc/app_basket_confirm_links', '/rest/v1/app_suborganization_updates', '/rest/v1/app_notes', '/rest/v1/rpc/app_basket_confirm_links']);
    assert.deepEqual(calls[0].body, {organization_id:'o', raw_text:'글', created_by:'u', doc:DOC});
    assert.deepEqual(calls[1].body, {workspace_id:'w', raw_text:'글', doc:DOC});
    assert.deepEqual(calls[2].body, {p_note_id:'n', p_note_updated_at:'2026-10-28T00:00:00Z', p_targets:[{kind:'project', target_id:'p', reason:'직접 연결'}]});
    assert.equal(one.linkError, '');
    assert.deepEqual(calls[3].body, {organization_id:'o', raw_text:'글', created_by:'u'});
    assert.deepEqual(calls[4].body, {workspace_id:'w', raw_text:'글'});
    assert.ok(!calls.some(c => c.path.includes('app_project_progress_updates')));
  } finally { globalThis.window = prev.window; globalThis.CustomEvent = prev.CustomEvent; }
});

test('the update window has no switch to a note, no autosave and no browser storage; the entrances pass the form to the existing saves', () => {
  const win = readFileSync('app/update-window.js', 'utf8');
  // The browser-storage audit forbids these words in source text, so the check builds them.
  const banned = [['local', 'Storage'], ['session', 'Storage'], ['indexed', 'DB'], ['set', 'Interval']].map(parts => parts.join(''));
  for (const word of banned) assert.ok(!win.includes(word), word);
  assert.ok(!/import[^;]*(createNoteDoc|md-editor|write-window)/.test(win));
  assert.match(readFileSync('app/home-quick.js', 'utf8'), /updateVia:async\(letters,list,doc\)=>\{[^}]*save\(\{doc\}\)/);
  assert.match(readFileSync('app/basket.js', 'utf8'), /saveUpdateDoc\(id, \{raw_text:changes\.raw_text, doc:changes\.doc, version:changes\.version\}\)/);
});
