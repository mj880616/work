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

test('photo bytes: one POST per photo and size; 429 carries retry_after; 404/403 are final', async () => {
  const m = await mod, rt = runtime(), seen = [];
  globalThis.URL.createObjectURL = () => 'blob:1';
  let reply = () => new Response(new Blob(['x']), {headers:{'content-type':'image/jpeg'}});
  const fetcher = async (url, init) => { seen.push({url, body:JSON.parse(init.body), auth:init.headers.Authorization}); return reply(); };
  assert.equal(await m.odPhotoBytes(rt, 'A1', 'large', fetcher), 'blob:1');
  assert.deepEqual(seen[0].body, {action:'photo', id:'A1', size:'large'}); assert.equal(seen[0].url, 'https://x.invalid/functions/v1/onedrive-photos'); assert.equal(seen[0].auth, 'Bearer t');
  reply = () => new Response(JSON.stringify({error:'onedrive_throttled', retry_after:12}), {status:429, headers:{'content-type':'application/json'}});
  await assert.rejects(m.odPhotoBytes(rt, 'A1', 'small', fetcher), e => e.code === 'throttled' && e.retryAfter === 12);
  reply = () => new Response('{}', {status:404}); await assert.rejects(m.odPhotoBytes(rt, 'A1', 'small', fetcher), e => e.code === 'missing');
  reply = () => new Response('{}', {status:403}); await assert.rejects(m.odPhotoBytes(rt, 'A1', 'small', fetcher), e => e.code === 'outside');
  reply = () => new Response('{}', {status:502}); await assert.rejects(m.odPhotoBytes(rt, 'A1', 'small', fetcher), /photo/);
});

test('photo addresses: one POST for many ids; only safe https addresses are kept; old server and 429 are told apart', async () => {
  const m = await mod;
  const rt = runtime(() => ({urls:{A:'https://thumbs.example.test/a?x=1', B:'http://thumbs.example.test/b', C:'https://127.0.0.1/c', D:'javascript:alert(1)'}, failed:{E:'outside', F:7}, retry_after:5}));
  const out = await m.odPhotoUrls(rt, ['A', 'B', 'C', 'D', 'E', 'F'], 'small');
  assert.deepEqual(rt.calls[0].body, {action:'photo-urls', ids:['A', 'B', 'C', 'D', 'E', 'F'], size:'small'});
  assert.deepEqual([...out.urls], [['A', 'https://thumbs.example.test/a?x=1']]);
  assert.deepEqual([...out.failed], [['E', 'outside']]);
  assert.equal(out.retryAfter, 5);
  const proto = await m.odPhotoUrls(runtime(() => JSON.parse('{"urls":{}}')), ['__proto__'], 'small');
  assert.equal(proto.urls.size, 0);
  await assert.rejects(m.odPhotoUrls(runtime(() => { throw Object.assign(new Error('action_invalid'), {status:400}); }), ['A']), e => e.code === 'unsupported');
  await assert.rejects(m.odPhotoUrls(runtime(() => { throw Object.assign(new Error('onedrive_throttled'), {status:429, retryAfter:9}); }), ['A']), e => e.code === 'throttled' && e.retryAfter === 9);
  await assert.rejects(m.odPhotoUrls(runtime(() => { throw Object.assign(new Error('onedrive_unavailable'), {status:503}); }), ['A']), /onedrive_unavailable/);
  for (const bad of ['https://localhost/x', 'https://a.internal/x', 'https://u:p@a.example/x', 'https://[::1]/x', 'ftp://a.example/x', 7]) assert.equal(m.safeThumbUrl(bad), null, String(bad));
});

// 화면 단위: 지어낸 문서와 지어낸 IntersectionObserver로 칸이 보일 때만 받는지, 실패하면 간격을 두고 다시 받는지 본다.
function fakeDom() {
  const observers = [];
  const el = tag => {
    const node = {tagName:tag, dataset:{}, children:[], attrs:{}, isConnected:true, hidden:false,
      append(...k) { node.children.push(...k); }, remove() { node.isConnected = false; node.removed = true; },
      setAttribute(k, v) { node.attrs[k] = v; }, removeAttribute(k) { delete node.attrs[k]; if (k === 'src') node.src = undefined; }};
    return node;
  };
  globalThis.document = {createElement:el};
  globalThis.IntersectionObserver = class { constructor(cb, opts) { this.cb = cb; this.opts = opts; this.targets = new Set(); observers.push(this); }
    observe(t) { this.targets.add(t); } unobserve(t) { this.targets.delete(t); } };
  const show = (box, kind, on) => { for (const o of observers) if (!!o.opts === (kind === 'near') && o.targets.has(box)) o.cb([{target:box, isIntersecting:on}]); };
  return {observers, show};
}
// 모듈이 관찰자를 한 번만 만들므로 지어낸 문서도 하나만 쓴다.
let sharedDom = null;
const dom1 = () => (sharedDom ||= fakeDom());
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)); };

test('photo cell: asks only when on screen or about to be; a cell that leaves before its turn is taken back', async () => {
  const m = await mod, dom = dom1(), asked = [];
  const rt = runtime();
  m.odThumbLoader(rt, {fetchUrls:async ids => { asked.push(ids); return {urls:Object.fromEntries(ids.map(id => [id, 'https://t.example.test/' + id]))}; }, fetchBytes:async () => 'blob:x'});
  const boxes = ['A', 'B', 'C'].map(id => m.odPhotoElement({id}, 'small', {rt}));
  await flush();
  assert.deepEqual(asked, [], 'nothing until a cell is near the screen');
  assert.equal(dom.observers.find(o => o.opts).opts.rootMargin, '200px 0px 100% 0px');
  dom.show(boxes[0], 'view', true); dom.show(boxes[1], 'near', true); dom.show(boxes[2], 'near', true); dom.show(boxes[2], 'near', false);
  await flush();
  assert.deepEqual(asked, [['A', 'B']], 'visible first, the near one in the same batch, the one that left is not asked');
  const img = boxes[0].children[0];
  assert.equal(img.src, 'https://t.example.test/A'); assert.equal(img.referrerPolicy, 'no-referrer');
  img.onload(); assert.equal(boxes[0].dataset.state, 'shown');
  m.clearOdPhotoCache();
});

test('photo cell: a failed picture waits and tries again by itself, then rests with the 사진 mark until it comes back on screen', async () => {
  const m = await mod, dom = dom1(), rt = runtime();
  const timers = []; const realTimeout = globalThis.setTimeout;
  let calls = 0;
  m.odThumbLoader(rt, {fetchUrls:async () => { calls++; throw new Error('net'); }, fetchBytes:async () => 'blob:x'});
  globalThis.setTimeout = (f, ms) => { if (ms >= 1000) { timers.push({f, ms}); return 0; } return realTimeout(f, ms); };
  try {
    const box = m.odPhotoElement({id:'A'}, 'small', {rt});
    dom.show(box, 'view', true); await flush();
    for (const wait of [3000, 6000, 12000, 24000]) {
      assert.equal(box.dataset.state, 'retry'); assert.equal(timers.at(-1).ms, wait);
      timers.at(-1).f(); await flush();
    }
    assert.equal(calls, 5);
    assert.equal(box.dataset.state, 'link');
    assert.equal(box.children.at(-1).textContent, '사진');
    assert.equal(timers.length, 4, 'no endless retry while it stays on screen');
    // 화면에서 나갔다가 다시 들어오면(3초 넘게 지난 뒤) 처음부터 다시 받는다.
    const realNow = Date.now; Date.now = () => realNow() + 5000;
    try { dom.show(box, 'view', false); dom.show(box, 'view', true); await flush(); } finally { Date.now = realNow; }
    assert.equal(calls, 6); assert.equal(box.dataset.state, 'retry');
  } finally { globalThis.setTimeout = realTimeout; }
  m.clearOdPhotoCache();
});
