import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readNoteDocs, createNoteDoc, saveNoteDoc, moveToNote, moveToBasket, validateNoteTitle, validateNoteBody, suggestNoteTitle, setNoteSource, saveImportedNote } from '../app/basket-data.js';

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

// NOTE-주소로 가져오기 2단계: 원문 정보는 기존 metadata 칸(metadata.source) 하나. 주소·이름은 가짜(example.com).
const SRC = {url:'https://news.example.com/a/1', state:'fetching'};
test('an imported note is created through the same insert with metadata.source, its folder and AI material off', async () => {
  const calls = [];
  const rt = runtime(async (path, options) => { calls.push({path, options}); return [{id:'n', ...options.body}]; });
  await createNoteDoc({title:'news.example.com', raw_text:SRC.url, markdown:false, doc:{v:'ed1', doc:{type:'doc', content:[]}}, ai_export_allowed:false,
    folder:{id:'11111111-1111-4111-8111-111111111111', name:'읽을거리'}, source:SRC}, rt);
  const body = calls[0].options.body;
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(body.metadata, {markdown:false, folder_id:'11111111-1111-4111-8111-111111111111', folder:'읽을거리', source:SRC});
  assert.deepEqual([body.kind, body.workspace_id, body.ai_export_allowed], ['note', 'w', false]);
  // 모양이 다른 source는 보내지 않는다.
  await createNoteDoc({title:'제목', raw_text:'본문', source:'https://news.example.com'}, rt);
  await createNoteDoc({title:'제목', raw_text:'본문', source:{state:'ok'}}, rt);
  assert.equal(calls[1].options.body.metadata, undefined); assert.equal(calls[2].options.body.metadata, undefined);
});

test('setNoteSource changes only metadata.source, keeps the other keys and the edit time, and guards the version read', async () => {
  const calls = [], meta = {pinned_at:'2026-10-06T01:00:00.000Z', folder:'읽을거리', folder_id:'f1', board:{x:1, y:2, r:0, z:1}, source:SRC};
  const rt = runtime(async (path, options = {}) => { calls.push({path, options}); return options.method === 'PATCH' ? [{id:'n', updated_at:'v1', metadata:options.body.metadata}] : [{id:'n', updated_at:'v1', metadata:meta}]; });
  const saved = await setNoteSource({id:'n'}, old => ({...old, state:'failed', reason:'robots'}), rt);
  const patch = calls[1], p = q(patch.path);
  assert.deepEqual([patch.options.method, p.get('id'), p.get('workspace_id'), p.get('kind'), p.get('updated_at')], ['PATCH', 'eq.n', 'eq.w', 'eq.note', 'eq.v1']);
  assert.equal(p.get('metadata->>pinned_at'), 'eq.2026-10-06T01:00:00.000Z'); assert.equal(p.get('metadata->>folder_id'), 'eq.f1');
  assert.deepEqual(Object.keys(patch.options.body), ['metadata']);
  assert.deepEqual(patch.options.body.metadata, {...meta, source:{...SRC, state:'failed', reason:'robots'}});
  assert.equal(saved.metadata.source.reason, 'robots');
  // change가 객체를 돌려주지 않으면 쓰지 않는다. 원문 정보가 없던 노트는 null을 받는다.
  const seen = [];
  const rt2 = runtime(async (path, options = {}) => { seen.push(options.method || 'GET'); return [{id:'n', updated_at:'v1', metadata:{}}]; });
  let got = 'x';
  await setNoteSource({id:'n'}, old => { got = old; return null; }, rt2);
  assert.equal(got, null); assert.deepEqual(seen, ['GET']);
  // 그사이 바뀐 노트는 거절(덮어쓰지 않음).
  await assert.rejects(setNoteSource({id:'n'}, () => SRC, runtime(async (path, options = {}) => options.method === 'PATCH' ? [] : [{id:'n', updated_at:'v1', metadata:{}}])), e => e.code === 'note_changed');
});

test('saveImportedNote writes title, letters, saved form and source in one PATCH on the version read, and never over an edited note', async () => {
  const calls = [], meta = {folder:'읽을거리', folder_id:'f1', source:SRC}, doc = {v:'ed1', doc:{type:'doc', content:[]}}, done = {...SRC, state:'ok', site:'예시일보'};
  const rt = runtime(async (path, options = {}) => { calls.push({path, options}); return options.method === 'PATCH' ? [{id:'n', ...options.body}] : [{id:'n', updated_at:'2026-10-06T00:00:00.123456Z', raw_text:SRC.url, metadata:meta}]; });
  const row = await saveImportedNote('n', {title:'예시 글 제목', raw_text:'첫 문단', doc, source:done, check:fresh => fresh.raw_text === SRC.url}, rt);
  assert.equal(calls.length, 2);
  assert.deepEqual([q(calls[0].path).get('id'), q(calls[0].path).get('kind'), calls[0].options.method], ['eq.n', 'eq.note', undefined]);
  const p = q(calls[1].path), body = calls[1].options.body;
  assert.deepEqual([calls[1].options.method, p.get('id'), p.get('workspace_id'), p.get('kind'), p.get('updated_at')], ['PATCH', 'eq.n', 'eq.w', 'eq.note', 'eq.2026-10-06T00:00:00.123456Z']);
  assert.equal(p.get('metadata->>pinned_at'), 'is.null'); assert.equal(p.get('metadata->>folder'), 'eq.읽을거리');
  assert.deepEqual(Object.keys(body).sort(), ['doc', 'metadata', 'raw_text', 'title', 'updated_at']);
  assert.deepEqual(body.metadata, {folder:'읽을거리', folder_id:'f1', source:done});
  assert.equal(row.title, '예시 글 제목');
  assert.ok(!Object.hasOwn(body, 'workspace_id') && !Object.hasOwn(body, 'ai_export_allowed'));
  // 그사이 사람이 본문을 수정했으면(check false) 쓰지 않는다.
  const writes = [];
  const edited = runtime(async (path, options = {}) => { writes.push(options.method || 'GET'); return [{id:'n', updated_at:'v2', raw_text:'내가 쓴 글', metadata:meta}]; });
  await assert.rejects(saveImportedNote('n', {title:'제목', raw_text:'본문', doc, source:done, check:fresh => fresh.raw_text === SRC.url}, edited), e => e.code === 'note_edited' && e.row.raw_text === '내가 쓴 글');
  assert.deepEqual(writes, ['GET']);
  // 없는 노트·그사이 바뀐 판·모양이 다른 값.
  await assert.rejects(saveImportedNote('n', {title:'제목', raw_text:'본문', doc, source:done}, runtime(async () => [])), e => e.code === 'note_missing');
  await assert.rejects(saveImportedNote('n', {title:'제목', raw_text:'본문', doc, source:done}, runtime(async (path, options = {}) => options.method === 'PATCH' ? [] : [{id:'n', updated_at:'v1', metadata:{}}])), e => e.code === 'note_changed');
  await assert.rejects(saveImportedNote('n', {title:'제목', raw_text:'본문', doc, source:null}, rt), /서식/);
  await assert.rejects(saveImportedNote('n', {title:'', raw_text:'본문', doc, source:done}, rt), /제목/);
});
