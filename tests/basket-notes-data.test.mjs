import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readNoteDocs, createNoteDoc, saveNoteDoc, moveToNote, moveToBasket, validateNoteTitle, validateNoteBody, suggestNoteTitle } from '../app/basket-data.js';

// MEMO-노트 PR 3: notes reuse the owner-RLS app_notes REST path; every write carries the kind it expects.
const runtime = api => ({context:{read:()=>({workspace:{id:'w'}, user:{id:'u'}})}, api});
const q = path => new URL(path, 'http://x').searchParams;

test('note list reads kind=note newest change first, with its links', async () => {
  const calls = [];
  const result = await readNoteDocs(runtime(async path => { calls.push(path); return path.includes('app_record_links') ? [{note_id:'n', status:'confirmed'}] : Number(q(path).get('offset')) ? [] : [{id:'n', title:'노트'}]; }));
  assert.deepEqual(result, {notes:[{id:'n', title:'노트'}], links:[{note_id:'n', status:'confirmed'}]});
  assert.equal(q(calls[0]).get('kind'), 'eq.note'); assert.equal(q(calls[0]).get('order'), 'updated_at.desc,id.desc');
  assert.match(q(calls[0]).get('select'), /(^|,)title(,|$)/);
  assert.equal(q(calls[1]).get('note_id'), 'in.(n)');
});

test('title and body limits match the database checks', () => {
  for (const bad of ['', '   ', '두\n줄', '가'.repeat(201)]) assert.throws(() => validateNoteTitle(bad));
  assert.equal(validateNoteTitle('😀'.repeat(200)), '😀'.repeat(200));
  assert.equal(validateNoteBody(''), '');
  assert.equal(validateNoteBody('가'.repeat(100000)).length, 100000);
  assert.throws(() => validateNoteBody('가'.repeat(100001)), /100,000/);
});

test('suggested title is the first non-empty line, else the first file name, capped at 200', () => {
  assert.equal(suggestNoteTitle({raw_text:'\n  첫 줄  \n둘째'}), '첫 줄');
  assert.equal(suggestNoteTitle({raw_text:'', attachments:[{file_name:'회의록.hwp'}]}), '회의록.hwp');
  assert.equal([...suggestNoteTitle({raw_text:'가'.repeat(300)})].length, 200);
});

test('save and move back are single PATCHes scoped by id, workspace and the shown kind', async () => {
  const calls = [];
  const rt = runtime(async (path, options) => { calls.push({path, options}); return [{id:'n', ...options.body}]; });
  await saveNoteDoc('n', {title:'제목', raw_text:'본문'}, rt);
  await moveToBasket({id:'n', raw_text:'본문', attachments:[]}, rt);
  assert.deepEqual(calls.map(c => [c.options.method, q(c.path).get('id'), q(c.path).get('workspace_id'), q(c.path).get('kind')]),
    [['PATCH', 'eq.n', 'eq.w', 'eq.note'], ['PATCH', 'eq.n', 'eq.w', 'eq.note']]);
  assert.deepEqual(Object.keys(calls[0].options.body).sort(), ['raw_text', 'title', 'updated_at']);
  assert.deepEqual({kind:calls[1].options.body.kind, title:calls[1].options.body.title}, {kind:'basket', title:null});
  assert.ok(calls.every(c => !Object.hasOwn(c.options.body, 'workspace_id') && !Object.hasOwn(c.options.body, 'ai_export_allowed')));
});

// 5-2 A: [노트로 옮기기] leaves metadata.moved_from_update_at; every other metadata key stays, and the write only applies to the version read.
test('move to note reads the update, keeps its other metadata, adds the moved mark and guards the version read', async () => {
  const calls = [];
  const meta = {tasks:[{task_id:'t1'}], other:'keep', journal_at:'2026-10-06T01:00:00.000Z', requests:['discussion']};
  const rt = runtime(async (path, options = {}) => { calls.push({path, options}); return options.method === 'PATCH' ? [{id:'m', ...options.body}] : [{id:'m', updated_at:'2026-10-06T00:00:00.123456Z', metadata:meta}]; });
  await moveToNote('m', '첫 줄', rt, new Date('2026-10-07T03:00:00Z'));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, undefined);
  assert.equal(q(calls[0].path).get('kind'), 'eq.basket');
  const patch = calls[1], p = q(patch.path);
  assert.deepEqual([patch.options.method, p.get('id'), p.get('workspace_id'), p.get('kind')], ['PATCH', 'eq.m', 'eq.w', 'eq.basket']);
  assert.equal(p.get('updated_at'), 'eq.2026-10-06T00:00:00.123456Z');
  assert.equal(p.get('metadata->>moved_from_update_at'), 'is.null');
  assert.equal(p.get('metadata->>journal_at'), 'eq.2026-10-06T01:00:00.000Z');
  assert.equal(p.get('metadata->tasks->0->>task_id'), 'eq.t1');
  assert.deepEqual(patch.options.body.metadata, {...meta, moved_from_update_at:'2026-10-07T03:00:00.000Z'});
  assert.deepEqual({kind:patch.options.body.kind, title:patch.options.body.title}, {kind:'note', title:'첫 줄'});
  assert.deepEqual(meta.other, 'keep');
});

test('move to note with no metadata at all sets only the mark; an update changed in between is refused', async () => {
  const rt = runtime(async (path, options = {}) => options.method === 'PATCH' ? [{id:'m', ...options.body}] : [{id:'m', updated_at:'2026-10-06T00:00:00Z', metadata:null}]);
  const saved = await moveToNote('m', '제목', rt, new Date('2026-10-07T03:00:00Z'));
  assert.deepEqual(saved.metadata, {moved_from_update_at:'2026-10-07T03:00:00.000Z'});
  const raced = runtime(async (path, options = {}) => options.method === 'PATCH' ? [] : [{id:'m', updated_at:'2026-10-06T00:00:00Z', metadata:{}}]);
  await assert.rejects(moveToNote('m', '제목', raced), e => e.code === 'note_changed');
  const gone = runtime(async () => []);
  await assert.rejects(moveToNote('m', '제목', gone), e => e.code === 'note_missing');
  await assert.rejects(moveToNote('m', '두\n줄', runtime(async () => { throw new Error('must not read'); })), /한 줄/);
});

test('a note that the basket rules would refuse is not sent back', async () => {
  const rt = runtime(async () => { throw new Error('must not write'); });
  assert.throws(() => moveToBasket({id:'n', raw_text:'  ', attachments:[]}, rt), /본문과 첨부가 없는/);
  assert.throws(() => moveToBasket({id:'n', raw_text:'가'.repeat(20001), attachments:[]}, rt), /20,000/);
  await assert.rejects(moveToBasket({id:'n', raw_text:'', attachments:[{drive_file_id:'f'}]}, runtime(async () => [])), /저장 결과/);
});

test('a new note is one owner-RLS insert of kind=note, checked before it is sent', async () => {
  const calls = [];
  const rt = runtime(async (path, options) => { calls.push({path, options}); return [{id:'new', ...options.body}]; });
  assert.deepEqual(await createNoteDoc({title:'새 노트', raw_text:''}, rt), {id:'new', workspace_id:'w', kind:'note', title:'새 노트', raw_text:''});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/rest/v1/app_notes');
  assert.deepEqual({method:calls[0].options.method, prefer:calls[0].options.prefer}, {method:'POST', prefer:'return=representation'});
  assert.deepEqual(Object.keys(calls[0].options.body).sort(), ['kind', 'raw_text', 'title', 'workspace_id']);
  const refuse = runtime(async () => { throw new Error('must not write'); });
  await assert.rejects(createNoteDoc({title:' ', raw_text:'본문'}, refuse), /제목/);
  await assert.rejects(createNoteDoc({title:'가'.repeat(201), raw_text:''}, refuse), /200자/);
  await assert.rejects(createNoteDoc({title:'제목', raw_text:'가'.repeat(100001)}, refuse), /100,000/);
  await assert.rejects(createNoteDoc({title:'제목', raw_text:''}, runtime(async () => [])), /저장 결과/);
});

// ED③ 노트: the new editor's save writes title + letters + doc in one PATCH guarded by the version the edit opened (updated_at),
// never metadata; a row changed meanwhile is refused (note_changed) and nothing is overwritten. A new note may carry its doc.
test('saveNoteDoc with doc: one PATCH, guarded by the opened version, no metadata; changed rows are refused', async () => {
  const doc = {v:'ed1', doc:{type:'doc', content:[{type:'paragraph', content:[{type:'text', text:'본문'}]}]}};
  const calls = [];
  const rt = runtime(async (path, options = {}) => { calls.push({path, options}); return [{id:'n', ...options.body}]; });
  const saved = await saveNoteDoc('n', {title:'제목', raw_text:'본문', doc, version:'2026-10-21T01:00:00Z'}, rt);
  assert.equal(calls.length, 1);
  const p = q(calls[0].path);
  assert.equal(calls[0].options.method, 'PATCH');
  assert.deepEqual([p.get('id'), p.get('workspace_id'), p.get('kind'), p.get('updated_at')], ['eq.n', 'eq.w', 'eq.note', 'eq.2026-10-21T01:00:00Z']);
  assert.deepEqual(Object.keys(calls[0].options.body).sort(), ['doc', 'raw_text', 'title', 'updated_at']);
  assert.deepEqual(saved.doc, doc);
  await assert.rejects(saveNoteDoc('n', {title:'제목', raw_text:'본문', doc, version:'2026-10-21T01:00:00Z'}, runtime(async () => [])), e => e.code === 'note_changed');
  await assert.rejects(saveNoteDoc('n', {title:'제목', raw_text:'본문', doc}, rt), e => e.code === 'note_changed');
  const bodies = [];
  await createNoteDoc({title:'새', raw_text:'본문', markdown:false, doc}, runtime(async (path, options) => { bodies.push(options.body); return [{id:'x', ...options.body}]; }));
  assert.deepEqual(bodies[0].doc, doc);
});
