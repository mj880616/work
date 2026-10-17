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

test('save, move to note and move back are single PATCHes scoped by id, workspace and the shown kind', async () => {
  const calls = [];
  const rt = runtime(async (path, options) => { calls.push({path, options}); return [{id:'n', ...options.body}]; });
  await saveNoteDoc('n', {title:'제목', raw_text:'본문'}, rt);
  await moveToNote('m', '첫 줄', rt);
  await moveToBasket({id:'n', raw_text:'본문', attachments:[]}, rt);
  assert.deepEqual(calls.map(c => [c.options.method, q(c.path).get('id'), q(c.path).get('workspace_id'), q(c.path).get('kind')]),
    [['PATCH', 'eq.n', 'eq.w', 'eq.note'], ['PATCH', 'eq.m', 'eq.w', 'eq.basket'], ['PATCH', 'eq.n', 'eq.w', 'eq.note']]);
  assert.deepEqual(Object.keys(calls[0].options.body).sort(), ['raw_text', 'title', 'updated_at']);
  assert.deepEqual({kind:calls[1].options.body.kind, title:calls[1].options.body.title}, {kind:'note', title:'첫 줄'});
  assert.deepEqual({kind:calls[2].options.body.kind, title:calls[2].options.body.title}, {kind:'basket', title:null});
  assert.ok(calls.every(c => !Object.hasOwn(c.options.body, 'workspace_id') && !Object.hasOwn(c.options.body, 'ai_export_allowed')));
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
