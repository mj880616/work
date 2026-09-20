import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '../..');
const allowed = [
  'https://mj880616.github.io',
  'https://work.bokdoong.com',
  'https://desk.bokdoong.com'
];

function handlerFor(name) {
  const source = readFileSync(resolve(root, `supabase/functions/${name}/index.ts`), 'utf8')
    .replace(/^import .+;\r?\n/gm, '');
  const javascript = stripTypeScriptTypes(source);
  let handler;
  const context = {
    Deno: { env: { get() { return 'test'; } }, serve(fn) { handler = fn; } },
    Request, Response, URL, Set, Map
  };
  vm.runInNewContext(javascript, context);
  assert.equal(typeof handler, 'function');
  return handler;
}

for (const name of ['public-page-edit', 'pc0921-board']) {
  test(`${name} allows only the existing and two owned work origins`, async () => {
    const handler = handlerFor(name);
    for (const origin of allowed) {
      const response = await handler(new Request(`https://example.supabase.co/functions/v1/${name}`, {
        method: 'OPTIONS', headers: { Origin: origin }
      }));
      assert.equal(response.status, 204, `${origin} preflight`);
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
      assert.equal(response.headers.get('Vary'), 'Origin');
    }
    const denied = await handler(new Request(`https://example.supabase.co/functions/v1/${name}`, {
      method: 'OPTIONS', headers: { Origin: 'https://untrusted.example' }
    }));
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
  });
}

test('public page editing still requires a bearer token from a new origin', async () => {
  const handler = handlerFor('public-page-edit');
  const response = await handler(new Request('https://example.supabase.co/functions/v1/public-page-edit', {
    method: 'POST', headers: { Origin: 'https://work.bokdoong.com' }
  }));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://work.bokdoong.com');
});
