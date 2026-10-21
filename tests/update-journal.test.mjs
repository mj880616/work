import test from 'node:test';
import assert from 'node:assert/strict';

// BASKET-일지로남기기: the work-journal memo mark lives in the update's existing metadata jsonb (metadata.journal_at).
import {noteJournalAt, journalGuard, setNoteJournal} from '../app/update-journal.js';
import {noteClassified, visibleNotes, notePlaces, canKeepInJournal, noteHasOrgOrProject} from '../app/basket-data.js';
import {noteTaskGuard} from '../app/basket-note-tasks.js';
import {selectHandoffNotes} from '../app/basket-ai-handoff.js';
import {dayMaterials, journalMemosOn, orgNewsOn, weeklyDraft} from '../app/journal-data.js';

const AT = '2026-10-21T02:00:00.000Z';
const runtime = fresh => {
  const calls = [];
  return {calls, rt:{context:{read:() => ({workspace:{id:'w'}})}, api:async (path, options = {}) => {
    calls.push({path, options});
    if (!options.method) return [fresh];
    return [{...fresh, metadata:options.body.metadata}];
  }}};
};

test('the mark is read only as a valid time string', () => {
  assert.equal(noteJournalAt({metadata:{journal_at:AT}}), AT);
  for (const metadata of [{}, {journal_at:'nope'}, {journal_at:1}, [], null]) assert.equal(noteJournalAt({metadata}), null);
  assert.equal(journalGuard({}), '&metadata->>journal_at=is.null');
  assert.equal(journalGuard({journal_at:AT}), `&metadata->>journal_at=eq.${encodeURIComponent(AT)}`);
  assert.equal(journalGuard({journal_at:5}), '');
});

test('keeping writes metadata only, keeps every other key, never touches updated_at, and is guarded', async () => {
  const fresh = {id:'n1', updated_at:'2026-10-10T00:00:00.123456Z', metadata:{tasks:[{task_id:'t'}], requests:['discussion'], other:1}};
  const {calls, rt} = runtime(fresh);
  const saved = await setNoteJournal('n1', true, rt, new Date(AT));
  assert.deepEqual(saved.metadata, {tasks:[{task_id:'t'}], requests:['discussion'], other:1, journal_at:AT});
  const patch = calls[1];
  assert.equal(patch.options.method, 'PATCH');
  assert.deepEqual(Object.keys(patch.options.body), ['metadata']);
  assert.match(patch.path, /kind=eq\.basket/);
  assert.match(patch.path, /workspace_id=eq\.w/);
  assert.match(patch.path, /updated_at=eq\.2026-10-10T00%3A00%3A00\.123456Z/);
  assert.match(patch.path, /metadata->>journal_at=is\.null/);
  assert.match(patch.path, /metadata->tasks->0->>task_id=eq\.t/);
  assert.match(patch.path, /metadata->>requests=eq\./);
  assert.match(patch.path, /metadata->write_request->>marked_at=is\.null/);
});

test('removing deletes only the mark; a row already in the wanted state is not written', async () => {
  const kept = {id:'n1', updated_at:'2026-10-10T00:00:00Z', metadata:{journal_at:AT, pinned_at:AT}};
  const off = runtime(kept);
  assert.deepEqual((await setNoteJournal('n1', false, off.rt)).metadata, {pinned_at:AT});
  assert.match(off.calls[1].path, /metadata->>journal_at=eq\./);
  const already = runtime(kept);
  assert.equal(await setNoteJournal('n1', true, already.rt), kept);
  assert.equal(already.calls.length, 1);
  const plain = runtime({id:'n1', updated_at:'x', metadata:{}});
  await setNoteJournal('n1', false, plain.rt);
  assert.equal(plain.calls.length, 1);
});

test('a lost race or a missing row is reported, never retried blindly', async () => {
  const rt = {context:{read:() => ({workspace:{id:'w'}})}, api:async (path, options = {}) => options.method ? [] : [{id:'n1', updated_at:'x', metadata:{}}]};
  await assert.rejects(setNoteJournal('n1', true, rt), {code:'note_changed'});
  const none = {context:{read:() => ({workspace:{id:'w'}})}, api:async () => []};
  await assert.rejects(setNoteJournal('n1', true, none), {code:'note_missing'});
});

test('the task writer guards the mark too, so it never drops it', () => {
  assert.match(noteTaskGuard({updated_at:'u', metadata:{journal_at:AT}}), /metadata->>journal_at=eq\./);
  assert.match(noteTaskGuard({updated_at:'u', metadata:{}}), /metadata->>journal_at=is\.null/);
});

test('a kept update leaves 미분류, shows under 분류 완료 · 업무일지, and leaves the AI classification batch', () => {
  const kept = {id:'k', metadata:{journal_at:AT}, ai_export_allowed:true, occurred_at:'2026-10-20T00:00:00Z'};
  const plain = {id:'p', metadata:{}, ai_export_allowed:true, occurred_at:'2026-10-20T00:00:00Z'};
  assert.equal(noteClassified(kept, []), true);
  assert.deepEqual(visibleNotes([kept, plain], [], 'unclassified').map(n => n.id), ['p']);
  assert.deepEqual(visibleNotes([kept, plain], [], 'classified', [], 'journal').map(n => n.id), ['k']);
  assert.deepEqual([...notePlaces(kept, [])], ['journal']);
  assert.equal(noteClassified({...kept, archived_at:AT}, []), false);
  assert.deepEqual(selectHandoffNotes([kept, plain], [], new Date('2026-10-21T00:00:00Z')).map(n => n.id), ['p']);
});

test('the offer is only for an update that went to no organization and no project', () => {
  const note = {id:'n', metadata:{}, attachments:[{drive_file_id:'f'}]};
  assert.equal(canKeepInJournal(note, []), true);
  assert.equal(canKeepInJournal(note, [{note_id:'n', status:'confirmed', organization_id:'o'}]), false);
  assert.equal(canKeepInJournal(note, [{note_id:'n', status:'confirmed', project_id:'p'}]), false);
  assert.equal(canKeepInJournal(note, [{note_id:'n', status:'suggested', project_id:'p'}]), true);
  assert.equal(canKeepInJournal(note, [], [{file_id:'f', project_id:'p'}]), false);
  assert.equal(noteHasOrgOrProject(note, [], [{file_id:'f', organization_id:'o'}]), true);
  assert.equal(canKeepInJournal({...note, archived_at:AT}, []), false);
  assert.equal(canKeepInJournal({...note, metadata:{journal_at:AT}}, []), false);
});

test('the journal day card: 기타 메모 holds the day\'s kept updates and they leave 조직 소식 미분류', () => {
  const basket = {notes:[
    {id:'k1', raw_text:'가상 메모 하나\n둘째 줄', occurred_at:'2026-10-06T01:00:00Z', metadata:{journal_at:AT}},
    {id:'k0', raw_text:'가상 메모 앞', occurred_at:'2026-10-06T00:00:00Z', metadata:{journal_at:AT}},
    {id:'p', raw_text:'그냥 업데이트', occurred_at:'2026-10-06T02:00:00Z', metadata:{}},
    {id:'other', raw_text:'다른 날', occurred_at:'2026-10-07T02:00:00Z', metadata:{journal_at:AT}},
    {id:'linked', raw_text:'연결된 메모', occurred_at:'2026-10-06T03:00:00Z', metadata:{journal_at:AT}},
  ], links:[{note_id:'linked', status:'confirmed', organization_id:'o', organization:{name:'가상 지부'}}], docs:[]};
  assert.deepEqual(journalMemosOn(basket, '2026-10-06'), ['가상 메모 앞', '가상 메모 하나']);
  assert.deepEqual(orgNewsOn({basket, orgUpdates:[]}, '2026-10-06'), [{name:'가상 지부', items:['연결된 메모']}, {name:'미분류', items:['그냥 업데이트']}]);
  const materials = {basket:{status:'ok', items:basket}, orgUpdates:{status:'ok', items:[]}, projectUpdates:{status:'ok', items:[]}};
  const memos = dayMaterials(materials, '2026-10-06').find(g => g.key === 'memos');
  assert.equal(memos.label, '기타 메모');
  assert.deepEqual(memos.items, ['가상 메모 앞', '가상 메모 하나']);
  assert.equal(dayMaterials({...materials, basket:{status:'failed'}}, '2026-10-06').find(g => g.key === 'memos').failed[0], 'basket');
  const draft = weeklyDraft({start:'2026-10-05', lines:new Map(), materials, today:'2026-10-06'}).split('\n');
  assert.ok(draft.includes('- 기타 메모: 가상 메모 앞'));
  assert.ok(draft.includes('- 기타 메모: 가상 메모 하나'));
  assert.ok(draft.indexOf('- 기타 메모: 다른 날') > draft.indexOf('■ 10월 7일(수)'));
});
