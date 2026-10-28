// Web1 공개 함수 중 로그인 없이 서버 키로 쓰는 두 함수(pc0914-checklist, pc0921-board 공개 편집 보드)는
// 허용 주소의 브라우저에서 온 쓰기만 받는다. Origin이 없는 POST는 DB에 닿기 전에 403으로 거절한다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '../..');

function load(name) {
  const writes = [];
  const reads = [];
  const table = (t) => {
    const chain = {
      select() { reads.push(t); return chain; },
      eq() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      then(ok) { return Promise.resolve({ data: [], error: null }).then(ok); },
      upsert(row) { writes.push({ t, row }); return Promise.resolve({ error: null }); }
    };
    return chain;
  };
  const createClient = () => ({ from: table, auth: { getUser: async () => ({ data: { user: null }, error: new Error('no') }) } });
  const source = readFileSync(resolve(root, `supabase/functions/${name}/index.ts`), 'utf8')
    .replace(/^import .+;\r?\n/gm, '');
  let handler;
  vm.runInNewContext(stripTypeScriptTypes(source), {
    Deno: { env: { get() { return 'test'; } }, serve(fn) { handler = fn; } },
    createClient, Request, Response, URL, Set, Map, JSON, Array, Number, String, Date
  });
  assert.equal(typeof handler, 'function');
  return { handler, writes, reads };
}

const post = (url, origin, body) => new Request(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
  body: JSON.stringify(body)
});

test('pc0914-checklist: Origin 없는 쓰기는 DB에 닿기 전에 403', async () => {
  const { handler, writes } = load('pc0914-checklist');
  const res = await handler(post('https://x.supabase.co/functions/v1/pc0914-checklist', null, { item_key: 'i0', checked: true }));
  assert.equal(res.status, 403);
  assert.equal(writes.length, 0);
});

test('pc0914-checklist: 허용 주소 브라우저 쓰기·읽기와 preflight는 그대로', async () => {
  const { handler, writes } = load('pc0914-checklist');
  const ok = await handler(post('https://x.supabase.co/functions/v1/pc0914-checklist', 'https://mj880616.github.io', { item_key: 'i0', checked: true }));
  assert.equal(ok.status, 200);
  assert.equal(writes.length, 1);
  const bad = await handler(post('https://x.supabase.co/functions/v1/pc0914-checklist', 'https://untrusted.example', { item_key: 'i0', checked: true }));
  assert.equal(bad.status, 403);
  assert.equal(writes.length, 1);
  const get = await handler(new Request('https://x.supabase.co/functions/v1/pc0914-checklist', { headers: { Origin: 'https://mj880616.github.io' } }));
  assert.equal(get.status, 200);
  const pre = await handler(new Request('https://x.supabase.co/functions/v1/pc0914-checklist', { method: 'OPTIONS', headers: { Origin: 'https://mj880616.github.io' } }));
  assert.equal(pre.status, 204);
});

test('pc0921-board: Origin 없는 쓰기는 모든 모드에서 DB에 닿기 전에 403', async () => {
  const { handler, writes, reads } = load('pc0921-board');
  for (const q of ['?board=pc0921', '?board=pc2in1', '?board=sanbyeol', '?mode=summary', '?mode=bargaining']) {
    const res = await handler(post(`https://x.supabase.co/functions/v1/pc0921-board${q}`, null, { item_key: 'done_a', value: true, action: 'create', password: 'xxxx', id: 1 }));
    assert.equal(res.status, 403, q);
  }
  assert.equal(writes.length, 0);
  assert.equal(reads.length, 0);
});

test('pc0921-board: 허용 주소 공개 편집 보드 쓰기·읽기는 그대로', async () => {
  const { handler, writes } = load('pc0921-board');
  for (const origin of ['https://mj880616.github.io', 'https://work.bokdoong.com']) {
    const res = await handler(post('https://x.supabase.co/functions/v1/pc0921-board?board=pc0921', origin, { item_key: 'done_a', value: true }));
    assert.equal(res.status, 200, origin);
  }
  assert.equal(writes.length, 2);
  const admin = await handler(post('https://x.supabase.co/functions/v1/pc0921-board?board=sanbyeol', 'https://work.bokdoong.com', { item_key: 'san_a', value: 'x' }));
  assert.equal(admin.status, 403);
  assert.equal(writes.length, 2);
  const get = await handler(new Request('https://x.supabase.co/functions/v1/pc0921-board?board=pc0921', { headers: { Origin: 'https://work.bokdoong.com' } }));
  assert.equal(get.status, 200);
});
