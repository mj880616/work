import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import vm from 'node:vm';
// OD-폰보관: 원드라이브 작은 그림 사본 보관(app/od-thumb-cache.js)·서비스 워커의 Background Fetch 결과 넣기·미리 받기 도우미.
// 지어낸 Cache Storage(Map)만 쓴다(네트워크·브라우저 없음).

function fakeCaches() {
  const stores = new Map();
  const keyUrl = k => (typeof k === 'string' ? k : k.url);
  const make = () => {
    const rows = new Map(); // 넣은 순서 유지, 다시 넣으면 뒤로(Cache Storage와 같게)
    return {
      rows,
      async match(k) { const r = rows.get(keyUrl(k)); return r ? r.clone() : undefined; },
      async put(k, res) { const u = keyUrl(k); rows.delete(u); rows.set(u, res.clone()); },
      async delete(k) { return rows.delete(keyUrl(k)); },
      async keys() { return [...rows.keys()].map(url => ({url})); },
    };
  };
  return {
    stores,
    async open(name) { if (!stores.has(name)) stores.set(name, make()); return stores.get(name); },
    async delete(name) { return stores.delete(name); },
  };
}
let CS = fakeCaches();
const reset = () => { CS = fakeCaches(); globalThis.caches = CS; };
globalThis.caches = CS;
await import('../app/od-thumb-cache.js');
const api = globalThis.ODThumbCache;
const img = (n = 10, type = 'image/jpeg') => new Blob([new Uint8Array(n)], {type});
const ORIGIN = 'https://desk.example.test';
const rows = () => [...CS.stores.get(api.NAME)?.rows.keys() || []];

test('key is owner/size/month/id on this site only; only small image bytes inside the limits are kept', async () => {
  reset();
  const s = api.create({origin: ORIGIN});
  assert.equal(await s.put('u:w', 'A!1', 'small', '2026-10', img()), true);
  assert.deepEqual(rows(), [`${ORIGIN}/__od-thumb/v1/u%3Aw/small/2026-10/A!1`]);
  for (const bad of [
    ['u:w', 'B', 'large', '2026-10', img()], ['u:w', 'B', 'small', '2026-13', img()], ['', 'B', 'small', '2026-10', img()],
    ['u:w', 'B', 'small', '2026-10', img(10, 'text/html')], ['u:w', 'B', 'small', '2026-10', img(3 * 1024 * 1024)], ['u:w', 'B', 'small', '2026-10', 'https://x/thumb'],
  ]) assert.equal(await s.put(...bad), false, JSON.stringify(bad.slice(0, 4)));
  assert.equal(rows().length, 1);
  const stored = await CS.stores.get(api.NAME).match(rows()[0]);
  assert.deepEqual([...stored.headers.keys()].sort(), ['content-type', 'x-od-at', 'x-od-bytes'], 'only type, size and time; no address or token');
  const blob = await s.get('u:w', 'A!1', 'small', '2026-10');
  assert.equal(blob.size, 10); assert.equal(blob.type, 'image/jpeg');
  assert.equal(await s.get('u:w', 'A!1', 'small', '2026-09'), null);
  assert.equal(await s.count('u:w'), 1);
});

test('limits: other owners go, then the least recently used beyond the count; full prune also caps bytes', async () => {
  reset();
  let t = 0;
  const s = api.create({origin: ORIGIN, now: () => t, limits: {maxEntries: 3, maxBytes: 25, touchMs: 10, pruneEvery: 1000}});
  await s.put('other:w', 'Z', 'small', '2026-10', img());
  for (const id of ['A', 'B', 'C', 'D']) { t++; await s.put('u:w', id, 'small', '2026-10', img()); }
  t = 100; await s.get('u:w', 'A', 'small', '2026-10'); // 오래전에 넣은 A를 지금 씀 → 뒤로
  await new Promise(r => setTimeout(r, 0));
  await s.prune('u:w');
  assert.deepEqual([...await s.monthIds('u:w', 'small', '2026-10')].sort(), ['A', 'C', 'D'], 'B was least recently used');
  assert.equal(await s.count('other:w'), 0);
  await s.prune('u:w', {full: true});
  assert.deepEqual([...await s.monthIds('u:w', 'small', '2026-10')].sort(), ['A', 'D'], '30 bytes > 25: the oldest goes');
});

test('a month list cleans that month only; a deleted photo goes from every month; clear empties the copies', async () => {
  reset();
  const s = api.create({origin: ORIGIN});
  for (const [id, m] of [['A', '2026-10'], ['B', '2026-10'], ['C', '2026-09'], ['B', '2026-09']]) await s.put('u:w', id, 'small', m, img());
  assert.equal(await s.reconcileMonth('u:w', '2026-10', new Set(['A'])), 1, 'B was deleted on OneDrive or its folder was turned off');
  assert.deepEqual([...await s.monthIds('u:w', 'small', '2026-10')], ['A']);
  assert.deepEqual([...await s.monthIds('u:w', 'small', '2026-09')].sort(), ['B', 'C']);
  assert.equal(await s.remove('u:w', 'B'), 1);
  assert.equal(await s.count('u:w'), 2);
  assert.equal(await s.clear(), true);
  assert.equal(await s.count('u:w'), 0);
});

test('without Cache Storage nothing is kept and nothing throws', async () => {
  const saved = globalThis.caches; delete globalThis.caches;
  try {
    const s = api.create({origin: ORIGIN});
    assert.equal(s.available(), false);
    assert.equal(await s.put('u:w', 'A', 'small', '2026-10', img()), false);
    assert.equal(await s.get('u:w', 'A', 'small', '2026-10'), null);
    assert.equal(await s.count('u:w'), 0);
  } finally { globalThis.caches = saved; }
});

test('background request tag: which photo a finished download belongs to, kept after # (never sent to the server)', () => {
  const tagged = api.tagUrl('https://t.example.test/thumb?x=1#old', {owner: 'u:w', id: 'A!1', size: 'small', month: '2026-10'});
  assert.equal(tagged.split('#')[0], 'https://t.example.test/thumb?x=1');
  assert.deepEqual(api.untag(tagged), {owner: 'u:w', size: 'small', month: '2026-10', id: 'A!1'});
  for (const bad of ['https://t/x', 'https://t/x#od-thumb=u/large/2026-10/A', 'https://t/x#od-thumb=u/small/26-10/A', 'https://t/x#od-thumb=%E0/small/2026-10/A', 'https://t/x#other=1']) assert.equal(api.untag(bad), null, bad);
});

test('service worker: imports the one cache file, keeps only finished image bytes by photo id, never the address', async () => {
  const source = readFileSync(new URL('../app/sw.js', import.meta.url), 'utf8');
  assert.match(source, /^importScripts\('\.\/od-thumb-cache\.js'\);$/m);
  // 다른 저장 방식 이름은 감사가 이 시험 파일을 막지 않도록 조각으로 만든다.
  for (const word of ['local' + 'Storage', 'session' + 'Storage', 'indexed' + 'DB', 'cach' + 'es.']) assert.ok(!source.includes(word), word);
  const cs = fakeCaches(), handlers = {};
  const self = {location: {origin: ORIGIN}, addEventListener: (type, fn) => { handlers[type] = fn; }, skipWaiting() {}, clients: {claim: async () => {}}};
  self.self = self;
  const ctx = vm.createContext({self, caches: cs, Response, Blob, URL, encodeURIComponent, decodeURIComponent, String, Number, Set, Object, Promise});
  ctx.importScripts = () => vm.runInContext(readFileSync(new URL('../app/od-thumb-cache.js', import.meta.url), 'utf8'), ctx);
  vm.runInContext(source, ctx);
  assert.equal(typeof handlers.fetch, 'function');
  const thumb = 'https://t.example.test/thumb/secret-preauth';
  const record = (id, res) => ({request: {url: api.tagUrl(thumb + id, {owner: 'u:w', id, size: 'small', month: '2026-10'})}, responseReady: Promise.resolve(res)});
  let ui = null, waited = null;
  const event = {
    registration: {id: 'od-thumb-1', matchAll: async () => [record('A', new Response(img(), {status: 200})), record('B', new Response('no', {status: 404})), {request: {url: thumb}, responseReady: Promise.resolve(new Response(img()))}]},
    updateUI: async x => { ui = x; }, waitUntil: p => { waited = p; },
  };
  handlers.backgroundfetchsuccess(event); await waited;
  const keys = [...cs.stores.get(api.NAME).rows.keys()];
  assert.deepEqual(keys, [`${ORIGIN}/__od-thumb/v1/u%3Aw/small/2026-10/A`]);
  assert.ok(keys.every(k => !k.includes('secret-preauth')));
  assert.equal(ui.title, '원드라이브 작은 그림 1장 보관');
  // 다른 이름의 Background Fetch는 건드리지 않는다.
  handlers.backgroundfetchsuccess({...event, registration: {...event.registration, id: 'other'}, waitUntil: p => { waited = p; }}); await waited;
  assert.equal(cs.stores.get(api.NAME).rows.size, 1);
});

test('page helpers: newest photos first, stale or unsafe addresses are not handed off, CORS gives up after three blocks', async () => {
  const m = await import('../app/diary-onedrive.js');
  const month = {days: {'2026-10-01': [{id: 'a1'}, {id: 'a2'}], '2026-10-03': [{id: 'c1'}, {id: 'c2'}]}};
  assert.deepEqual(m.prefetchOrder(month).map(p => p.id), ['c2', 'c1', 'a2', 'a1']);
  const now = 10 * 60 * 60 * 1000;
  const out = m.handoffRequests([
    {owner: 'u:w', id: 'A', month: '2026-10', url: 'https://t.example.test/a', at: now - 1000},
    {owner: 'u:w', id: 'B', month: '2026-10', url: 'https://t.example.test/b', at: now - 31 * 60 * 1000},
    {owner: 'u:w', id: 'C', month: '2026-10', url: 'http://t.example.test/c', at: now},
  ], now);
  assert.deepEqual(out.map(u => api.untag(u)?.id), ['A']);
  const rt = {context: {read: () => ({user: {id: 'u'}, workspace: {id: 'w'}})}};
  reset();
  assert.deepEqual(m.keepOf({id: 'A', day: '2026-10-03'}, 'small', rt), {owner: 'u:w', month: '2026-10'});
  assert.equal(m.keepOf({id: 'A', day: '2026-10-03'}, 'large', rt), null, 'only the small picture is kept');
  assert.equal(m.keepOf({id: 'A'}, 'small', rt), null);
  const png = new Response(img(5, 'image/png'));
  let calls = 0;
  assert.equal((await m.grabThumb('blob:x', async () => png)).type, 'image/png');
  const blocked = async () => { calls++; throw new TypeError('Failed to fetch'); };
  for (let i = 0; i < 3; i++) assert.equal(await m.grabThumb('https://t.example.test/x' + i, blocked), null);
  assert.equal(m.corsBlocked(), true);
  assert.equal(await m.grabThumb('https://t.example.test/x9', blocked), null);
  assert.equal(calls, 3, 'no more CORS tries once it is clearly blocked');
});

test('audit: Cache Storage is allowed in exactly one file, and only that file uses it', () => {
  const audit = readFileSync(new URL('../.github/workflows/browser-storage-audit.yml', import.meta.url), 'utf8');
  assert.match(audit, /^ {10}cache_storage_allowed=\{'app\/od-thumb-cache\.js'\}$/m);
  assert.equal((audit.match(/cache_storage_allowed/g) || []).length, 2, 'declared once, used once');
  const allow = audit.indexOf("if kind=='CacheStorage' and path in cache_storage_allowed:\n                          continue\n");
  assert.ok(allow > 0 && allow < audit.indexOf("if kind in {'indexed" + "DB','CacheStorage'}:"), 'the one allowance sits right before the blanket block');
  const root = new URL('../', import.meta.url), users = [];
  const walk = dir => {
    for (const name of readdirSync(new URL(dir, root))) {
      if (['.git', 'node_modules', 'dist', 'build'].includes(name)) continue;
      const rel = dir + name;
      if (statSync(new URL(rel, root)).isDirectory()) walk(rel + '/');
      else if (/\.(?:html|js|mjs|ts|tsx|jsx)$/.test(name) && /\bcaches\s*\./.test(readFileSync(new URL(rel, root), 'utf8'))) users.push(rel);
    }
  };
  walk('');
  assert.deepEqual(users, ['app/od-thumb-cache.js']);
});
