import { test } from 'node:test';
import assert from 'node:assert/strict';
// JOURNAL-일기 1차: diary rows (kind=diary) through the owner-RLS REST paths and basket-files uploads, one photo at a time.
const mod = import('../app/diary-data.js');
function runtime(reply = () => []) {
  const calls = [];
  return {calls, context:{read:() => ({user:{id:'u'}, workspace:{id:'w'}})}, api:async (path, options = {}) => { calls.push({path, ...options}); return reply(path, options); }};
}
const row = (extra = {}) => ({id:'d1', journal_day:'2026-10-03', raw_text:'글', attachments:[], updated_at:'2026-10-03T01:00:00Z', ...extra});
const photo = id => ({drive_file_id:id, file_name:id + '.jpg', mime_type:'image/jpeg', size_bytes:10});

test('month and day reads are kind=diary in the signed-in workspace only', async () => {
  const m = await mod, rt = runtime();
  await m.readDiaryMonth(2026, 9, rt); await m.readDiaryDay('2026-10-03', rt);
  const [month, day] = rt.calls.map(c => new URL(c.path, 'https://x.invalid').searchParams);
  assert.equal(month.get('workspace_id'), 'eq.w'); assert.equal(month.get('kind'), 'eq.diary');
  assert.deepEqual(month.getAll('journal_day'), ['gte.2026-10-01', 'lte.2026-10-31']);
  assert.equal(day.get('kind'), 'eq.diary'); assert.equal(day.get('journal_day'), 'eq.2026-10-03');
  await assert.rejects(m.readDiaryDay('2026-02-30', rt), /날짜/);
});

test('create sends kind diary, the day and ai_export_allowed=false; a photo-only day holds one space; 409 means the day exists', async () => {
  const m = await mod;
  let rt = runtime((path, o) => [{id:'d1', ...o.body}]);
  await m.createDiary({day:'2026-10-06', text:'오늘'}, rt);
  assert.deepEqual(rt.calls[0].body, {workspace_id:'w', kind:'diary', journal_day:'2026-10-06', raw_text:'오늘', ai_export_allowed:false});
  await m.createDiary({day:'2026-10-07'}, rt);
  assert.equal(rt.calls[1].body.raw_text, ' ');
  rt = runtime(() => { throw Object.assign(new Error('dup'), {status:409}); });
  await assert.rejects(m.createDiary({day:'2026-10-06', text:'x'}, rt), error => error.code === 'diary_exists');
  await assert.rejects(m.createDiary({day:'2026-10-06', text:'가'.repeat(20001)}, runtime()), /20,000/);
});

test('text save refuses a day with neither text nor photo; an empty text with photos is stored as empty', async () => {
  const m = await mod, rt = runtime((path, o) => [{...row(), ...o.body}]);
  await assert.rejects(m.saveDiaryText(row(), '  ', rt), /사진이나 글/);
  assert.equal(rt.calls.length, 0);
  await m.saveDiaryText(row({attachments:[photo('a')]}), '  ', rt);
  assert.equal(rt.calls[0].body.raw_text, ''); assert.match(rt.calls[0].path, /kind=eq\.diary&id=eq\.d1$/);
});

test('removing one photo is a compare-and-set PATCH; the last photo of a text-less day is refused', async () => {
  const m = await mod, rt = runtime((path, o) => [{...row(), ...o.body}]);
  await m.removeDiaryPhoto(row({attachments:[photo('a'), photo('b')]}), 'a', rt);
  assert.deepEqual(rt.calls[0].body.attachments, [photo('b')]);
  assert.match(rt.calls[0].path, /&updated_at=eq\.2026-10-03T01%3A00%3A00Z$/);
  await assert.rejects(m.removeDiaryPhoto(row({raw_text:'', attachments:[photo('a')]}), 'a', rt), error => error.code === 'last_photo');
  await assert.rejects(m.removeDiaryPhoto(row({raw_text:' ', attachments:[photo('a')]}), 'a', rt), error => error.code === 'last_photo');
  await m.removeDiaryPhoto(row({attachments:[photo('a')]}), 'a', rt);
  assert.equal(rt.calls.length, 2);
  const changed = runtime(() => []);
  await assert.rejects(m.removeDiaryPhoto(row({attachments:[photo('a'), photo('b')]}), 'a', changed), error => error.code === 'note_changed');
});

test('uploads go one at a time onto the day row; a failure stops the rest and keeps what is up', async () => {
  const m = await mod, sent = [];
  const file = name => new File(['x'], name, {type:'image/jpeg'});
  const request = async fd => {
    sent.push({id:fd.get('note_id'), name:fd.get('file').name, count:fd.getAll('file').length, raw:fd.get('raw_text')});
    if (sent.length === 2) throw Object.assign(new Error('x'), {status:503, code:'drive_folder_failed'});
    return {ok:true, note_id:'d1', attachments:sent.map(s => photo(s.name))};
  };
  const result = await m.uploadDiaryPhotos(row(), [file('1.jpg'), file('2.jpg'), file('3.jpg')], {rt:runtime(), shrink:async f => f, request});
  assert.deepEqual(sent.map(s => [s.id, s.count, s.raw]), [['d1', 1, null], ['d1', 1, null]]);
  assert.equal(result.done, 1); assert.equal(result.failed, '2.jpg'); assert.equal(result.attachments.length, 1);
  assert.match(result.message, /저장 결과를 확인하지 못했어요/);
  await assert.rejects(m.uploadDiaryPhotos(row({attachments:Array.from({length:19}, (_, i) => photo('p' + i))}), [file('a'), file('b')], {rt:runtime(), shrink:async f => f, request}), /20장/);
  const wrong = await m.uploadDiaryPhotos(row(), [file('a')], {rt:runtime(), shrink:async f => f, request:async () => ({ok:true, note_id:'other', attachments:[]})});
  assert.equal(wrong.done, 0); assert.ok(wrong.failed);
});

test('a non-photo file is refused before any upload', async () => {
  const m = await mod;
  await assert.rejects(m.shrinkPhoto(new File(['x'], 'a.pdf', {type:'application/pdf'})), /사진이 아니에요/);
  await assert.rejects(m.shrinkPhoto(new File([], 'empty.jpg', {type:'image/jpeg'})), /빈 파일/);
});

test('photo comments: kept in metadata.photo_comments only (other metadata stays), 200 chars, one line, only for photos still on the day', async () => {
  const m = await mod, rt = runtime((path, o) => [{...row(), ...o.body}]);
  const base = row({attachments:[photo('a'), photo('b')], metadata:{tasks:[1], photo_comments:{a:'하나', gone:'없는 사진', b:'  '}}});
  assert.deepEqual(m.photoComments(base), {a:'하나'});
  assert.deepEqual(m.photoComments(row()), {}); assert.deepEqual(m.photoComments(null), {});
  assert.deepEqual(m.photoComments(row({attachments:[photo('a')], metadata:{photo_comments:['x']}})), {});
  assert.equal(m.cleanComment('  두 줄\n로  쓴  글 '), '두 줄 로 쓴 글');
  assert.equal(m.cleanComment('가'.repeat(200)).length, 200);
  assert.throws(() => m.cleanComment('가'.repeat(201)), /200자/);
  assert.equal(m.cleanComment('😀'.repeat(200)).length, 400);
  await m.saveDiaryComments(base, {a:'하나', b:' 둘 '}, rt);
  assert.deepEqual(Object.keys(rt.calls[0].body).sort(), ['metadata', 'updated_at']);
  assert.deepEqual(rt.calls[0].body.metadata, {tasks:[1], photo_comments:{a:'하나', b:'둘'}});
  // Nothing changed: no write. The last comment removed drops the key.
  const same = await m.saveDiaryComments(row({attachments:[photo('a')], metadata:{photo_comments:{a:'하나'}}}), {a:'하나'}, rt);
  assert.equal(rt.calls.length, 1); assert.equal(same.id, 'd1');
  await m.saveDiaryComments(row({attachments:[photo('a')], metadata:{x:1, photo_comments:{a:'하나'}}}), {a:''}, rt);
  assert.deepEqual(rt.calls[1].body.metadata, {x:1});
  await m.saveDiaryComments(row({attachments:[photo('a')]}), {a:'가'.repeat(201)}, rt).then(() => assert.fail('over 200'), error => assert.match(error.message, /200자/));
  assert.equal(rt.calls.length, 2);
});

test('removing a photo takes its comment in the same write; a day without comments sends no metadata', async () => {
  const m = await mod, rt = runtime((path, o) => [{...row(), ...o.body}]);
  await m.removeDiaryPhoto(row({attachments:[photo('a'), photo('b')], metadata:{tasks:[1], photo_comments:{a:'하나', b:'둘'}}}), 'a', rt);
  assert.deepEqual(rt.calls[0].body.attachments, [photo('b')]);
  assert.deepEqual(rt.calls[0].body.metadata, {tasks:[1], photo_comments:{b:'둘'}});
  await m.removeDiaryPhoto(row({attachments:[photo('a'), photo('b')], metadata:{photo_comments:{a:'하나'}}}), 'a', rt);
  assert.deepEqual(rt.calls[1].body.metadata, {});
  await m.removeDiaryPhoto(row({attachments:[photo('a'), photo('b')], metadata:{}}), 'a', rt);
  assert.equal('metadata' in rt.calls[2].body, false);
});

// UI-PC일기 ①: the same owner's sign-in refresh (new token) keeps the photo object URLs; a real owner change or a
// sign-out drops and revokes them. A photo the browser could not draw is forgotten only if it is still that copy.
test('photo cache: same-owner token refresh keeps object URLs, owner change or sign-out revokes them', async () => {
  const m = await mod, revoked = [], realRevoke = URL.revokeObjectURL;
  URL.revokeObjectURL = url => { revoked.push(url); };
  try {
    const rt = {context:{read:() => ({user:{id:'u'}, workspace:{id:'w'}})}, config:{url:'https://x.invalid', key:'k'},
      session:{ensure:async () => true, read:() => ({access_token:'t', user:{id:'u'}})}};
    let reads = 0;
    const fetcher = async () => { reads++; return new Response(new Blob(['x'], {type:'image/png'}), {headers:{'content-type':'image/png'}}); };
    m.photoSessionChanged({user:{id:'u'}});
    const first = await m.diaryPhotoUrl('d1', 'a', 'small', {rt, fetcher});
    assert.equal(m.photoSessionChanged({access_token:'t2', user:{id:'u'}}), false);
    assert.equal(await m.diaryPhotoUrl('d1', 'a', 'small', {rt, fetcher}), first);
    assert.equal(reads, 1); assert.deepEqual(revoked, []);
    // A failed draw of an older copy does not drop a newer one; the failed copy itself is dropped and revoked.
    await m.forgetDiaryPhoto('d1', 'a', 'small', 'blob:other');
    assert.equal(await m.diaryPhotoUrl('d1', 'a', 'small', {rt, fetcher}), first); assert.equal(reads, 1);
    await m.forgetDiaryPhoto('d1', 'a', 'small', first);
    assert.deepEqual(revoked, [first]);
    const second = await m.diaryPhotoUrl('d1', 'a', 'small', {rt, fetcher});
    assert.equal(reads, 2); assert.notEqual(second, first);
    assert.equal(m.photoSessionChanged({user:{id:'other'}}), true);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(revoked, [first, second]);
    await m.diaryPhotoUrl('d1', 'a', 'small', {rt, fetcher});
    assert.equal(m.photoSessionChanged(null), true);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(revoked.length, 3);
  } finally { URL.revokeObjectURL = realRevoke; }
});

// JOURNAL-일기사진정리: the Drive original of a photo taken out of a day goes to the Drive trash through basket-files photo-prune.
function pruneRuntime() { return {session:{ensure:async () => true, read:() => ({access_token:'tok'})}, config:{url:'https://x.invalid', key:'anon'}}; }
test('pruneDiaryPhotos asks photo-prune with the plain ids and returns the counts', async () => {
  const m = await mod, calls = [];
  const fetcher = async (url, init) => { calls.push({url, init}); return new Response(JSON.stringify({ok:true, action:'photo-prune', requested:1, trashed:1, kept:0, failed:0, unknown:0, results:[]}), {status:200}); };
  assert.deepEqual(await m.pruneDiaryPhotos(['a', 'a'], {rt:pruneRuntime(), fetcher}), {trashed:1, kept:0, failed:0, unknown:0});
  assert.equal(calls[0].url, 'https://x.invalid/functions/v1/basket-files?action=photo-prune');
  assert.equal(calls[0].init.method, 'POST'); assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(calls[0].init.body), {action:'photo-prune', file_ids:['a']});
});
test('pruneDiaryPhotos never throws and never sends bad input; an old server or an error means null', async () => {
  const m = await mod, rt = pruneRuntime();
  const never = async () => { throw new Error('must not be called'); };
  assert.equal(await m.pruneDiaryPhotos([], {rt, fetcher:never}), null);
  assert.equal(await m.pruneDiaryPhotos(['a/b'], {rt, fetcher:never}), null);
  assert.equal(await m.pruneDiaryPhotos(Array.from({length:21}, (_, i) => 'f' + i), {rt, fetcher:never}), null);
  assert.equal(await m.pruneDiaryPhotos(['a'], {rt:{...rt, session:{ensure:async () => false, read:() => null}}, fetcher:never}), null);
  for (const reply of [() => new Response('{"code":"OCR_REQUEST_INVALID"}', {status:400}), () => new Response('x', {status:200}), () => { throw new Error('offline'); },
    () => new Response(JSON.stringify({ok:true, action:'note-delete'}), {status:200})]) assert.equal(await m.pruneDiaryPhotos(['a'], {rt, fetcher:async () => reply()}), null);
});
