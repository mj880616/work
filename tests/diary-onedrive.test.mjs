import { test } from 'node:test';
import assert from 'node:assert/strict';
// JOURNAL-일기원드라이브 2단계: 일기의 원드라이브 사진·별표 데이터 층. 지어낸 runtime만 쓴다(네트워크 없음).
const mod = import('../app/diary-onedrive.js');
function runtime(reply = () => ({})) {
  const calls = [];
  return {calls, config:{url:'https://x.invalid', key:'k'}, context:{read:() => ({user:{id:'u'}, workspace:{id:'w'}})},
    session:{ensure:async () => true, read:() => ({access_token:'t'})},
    api:async (path, options = {}) => { calls.push({path, ...options}); return reply(path, options); }};
}

test('status keeps only the safe fields; auth-start follows only the Microsoft sign-in address', async () => {
  const m = await mod;
  assert.deepEqual(await m.odStatus(runtime(() => ({configured:true, connected:true, folder:{name:'카메라'}, can_delete:true, refresh_token:'x'}))), {configured:true, connected:true, folder:{name:'카메라'}, canDelete:true});
  assert.deepEqual(await m.odStatus(runtime(() => ({}))), {configured:false, connected:false, folder:null, canDelete:false});
  assert.equal(await m.odAuthStart(runtime(() => ({url:'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?x=1'}))), 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?x=1');
  for (const url of ['https://evil.example/x', 'http://login.microsoftonline.com/x', 'javascript:alert(1)', null]) await assert.rejects(m.odAuthStart(runtime(() => ({url}))), /onedrive_unavailable/);
});

test('every Edge call is a POST with one action; delete always carries confirm', async () => {
  const m = await mod, rt = runtime(() => ({folders:[{id:'F1', name:'가'}, {id:5}], deleted:true}));
  assert.deepEqual(await m.odFolders(rt), [{id:'F1', name:'가'}]);
  await m.odFolders(rt, 'F1'); await m.odFolderSet(rt, 'F1'); await m.odDelete(rt, 'A1'); await m.odDisconnect(rt); await m.odAuthFinish(rt, {code:'c', state:'s'});
  assert.deepEqual(rt.calls.map(c => c.body), [{action:'folders'}, {action:'folders', parent_id:'F1'}, {action:'folder-set', folder_id:'F1'}, {action:'photo-delete', id:'A1', confirm:true}, {action:'disconnect'}, {action:'auth-finish', code:'c', state:'s'}]);
  assert.ok(rt.calls.every(c => c.method === 'POST' && c.path === '/functions/v1/onedrive-photos' && c.singleFlight === false));
});

test('month photos: asks the month, drops malformed days and entries', async () => {
  const m = await mod;
  const rt = runtime(() => ({days:{'2026-10-03':[{id:'A', name:'a.jpg', taken_at:'2026-10-03T01:00:00Z', approx:true}, {name:'no id'}], 'bad':[{id:'B'}], '2026-10-04':'x'}, truncated:true}));
  assert.deepEqual(await m.odPhotos(rt, 2026, 9), {days:{'2026-10-03':[{id:'A', name:'a.jpg', taken_at:'2026-10-03T01:00:00Z', approx:true}]}, truncated:true});
  assert.equal(rt.calls[0].body.month, '2026-10');
});

test('stars: month read is workspace + day range; add sends the four columns and treats 409 as done; remove is exact', async () => {
  const m = await mod, rt = runtime(() => [{source:'onedrive', item_key:'A!1', taken_day:'2026-10-03'}, {source:'other', item_key:'x'}]);
  assert.deepEqual(await m.readStars(2026, 9, rt), [{source:'onedrive', item_key:'A!1', taken_day:'2026-10-03'}]);
  const q = new URL(rt.calls[0].path, 'https://x.invalid').searchParams;
  assert.equal(q.get('workspace_id'), 'eq.w'); assert.deepEqual(q.getAll('taken_day'), ['gte.2026-10-01', 'lte.2026-10-31']);
  await assert.rejects(m.readStars(2026, 9, runtime(() => ({}))));
  const add = runtime(); await m.addStar({source:'upload', key:'f1', day:'2026-10-03'}, add);
  assert.deepEqual(add.calls[0].body, {workspace_id:'w', source:'upload', item_key:'f1', taken_day:'2026-10-03'}); assert.equal(add.calls[0].method, 'POST');
  await m.addStar({source:'upload', key:'f1', day:'2026-10-03'}, runtime(() => { throw Object.assign(new Error('dup'), {status:409}); }));
  await assert.rejects(m.addStar({source:'upload', key:'f1', day:'2026-10-03'}, runtime(() => { throw Object.assign(new Error('x'), {status:500}); })));
  for (const bad of [{source:'x', key:'a', day:'2026-10-03'}, {source:'upload', key:'', day:'2026-10-03'}, {source:'upload', key:'a', day:'nope'}]) await assert.rejects(m.addStar(bad, runtime()));
  const rm = runtime(); await m.removeStar({source:'onedrive', key:'A!1'}, rm);
  assert.equal(rm.calls[0].method, 'DELETE'); assert.match(rm.calls[0].path, /workspace_id=eq\.w&source=eq\.onedrive&item_key=eq\.A!1$/);
});

test('day items: uploads first, then OneDrive; the star key tells the sources apart; label shows Seoul time', async () => {
  const m = await mod;
  const row = {id:'d1', attachments:[{drive_file_id:'f1', mime_type:'image/jpeg'}, {drive_file_id:'doc', mime_type:'application/pdf'}]};
  const month = {days:{'2026-10-03':[{id:'A', name:'a.jpg', taken_at:'2026-10-03T05:30:00Z', approx:false}, {id:'B', name:'b.jpg', taken_at:'2026-10-03T06:00:00Z', approx:true}]}};
  const items = m.dayItems('2026-10-03', row, month);
  assert.deepEqual(items.map(i => m.starKey(i.source, i.key)), ['upload:f1', 'onedrive:A', 'onedrive:B']);
  assert.deepEqual(m.dayItems('2026-10-04', null, month), []);
  assert.deepEqual(m.dayItems('2026-10-03', null, null), []);
  assert.equal(m.takenLabel(items[1]), '14:30'); assert.equal(m.takenLabel(items[2]), '대략 15:00'); assert.equal(m.takenLabel({taken_at:'x'}), '');
});

test('return values from the Microsoft round trip are read once and cleared from the address', async () => {
  const m = await mod, replaced = [];
  const loc = {hash:'#onedrive_code=abc&onedrive_state=s.t&keep=1', pathname:'/work/app/', search:'?view=diary'};
  const hist = {state:{k:1}, replaceState:(...a) => replaced.push(a)};
  assert.deepEqual(m.takeOdReturn(loc, hist), {code:'abc', state:'s.t'});
  assert.deepEqual(replaced, [[{k:1}, '', '/work/app/?view=diary#keep=1']]);
  assert.equal(m.takeOdReturn({hash:'', pathname:'/', search:''}, hist), null);
  assert.equal(m.takeOdReturn({hash:'#other=1', pathname:'/', search:''}, hist), null);
  assert.deepEqual(m.takeOdReturn({hash:'#onedrive_error=access_denied', pathname:'/', search:''}, hist), {error:'access_denied'});
  assert.deepEqual(m.takeOdReturn({hash:'#onedrive_error=%3Cscript%3E', pathname:'/', search:''}, hist), {error:'unknown'});
  assert.deepEqual(m.takeOdReturn({hash:'#onedrive_code=only', pathname:'/', search:''}, hist), {error:'unknown'});
});

test('error text comes from the Edge error code and never shows raw server text', async () => {
  const m = await mod;
  assert.match(m.odErrorText(new Error('onedrive_reconnect_needed')), /다시 연결/);
  assert.match(m.odErrorText(new Error('onedrive_outside_folder')), /폴더 밖/);
  assert.match(m.odErrorText(Object.assign(new Error('x'), {status:401})), /로그인/);
  assert.match(m.odErrorText(new Error('SELECT secret FROM t')), /실패했어요/);
});

test('photo bytes: one POST per photo and size, kept in memory; a failed read is not cached', async () => {
  const m = await mod, rt = runtime(), urls = [], seen = [];
  globalThis.URL.createObjectURL = () => { const u = 'blob:' + urls.length; urls.push(u); return u; };
  globalThis.URL.revokeObjectURL = () => {};
  let ok = true;
  const fetcher = async (url, init) => { seen.push({url, body:JSON.parse(init.body), auth:init.headers.Authorization}); return ok ? new Response(new Blob(['x']), {headers:{'content-type':'image/jpeg'}}) : new Response('{}', {status:502}); };
  const a = await m.odPhotoUrl('A1', 'small', {rt, fetcher}), b = await m.odPhotoUrl('A1', 'small', {rt, fetcher});
  assert.equal(a, b); assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].body, {action:'photo', id:'A1', size:'small'}); assert.equal(seen[0].url, 'https://x.invalid/functions/v1/onedrive-photos'); assert.equal(seen[0].auth, 'Bearer t');
  await m.odPhotoUrl('A1', 'large', {rt, fetcher}); assert.equal(seen.length, 2);
  ok = false;
  await assert.rejects(m.odPhotoUrl('Z', 'small', {rt, fetcher})); ok = true;
  await m.odPhotoUrl('Z', 'small', {rt, fetcher}); assert.equal(seen.length, 4);
});
