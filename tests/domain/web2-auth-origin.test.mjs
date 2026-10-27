import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '../..');

for (const origin of ['https://mj880616.github.io', 'https://desk.bokdoong.com']) {
  test(`login API is Google-only (no password sign-in, no account creation) on ${origin}`, async () => {
    const source = readFileSync(resolve(root, 'app/auth-service.js'), 'utf8');
    const calls = [];
    const window = {KPTURuntime: {config: {url: 'https://example.test', key: 'synthetic'}, session: {write() {}}}};
    const context = vm.createContext({window, location: {origin, pathname: '/work/app/'}, URL, fetch: async (url, init) => {
      calls.push({url, body: init?.body});
      return {ok: true, json: async () => ({access_token: 'synthetic'})};
    }});
    vm.runInContext(source, context);
    assert.equal(window.KPTUAuth.signUp, undefined);
    assert.equal(window.KPTUAuth.signIn, undefined);
    assert.equal(calls.length, 0);
    const google = new URL(window.KPTUAuth.googleUrl(`${origin}/work/app/?view=tasks`));
    assert.equal(google.origin + google.pathname, 'https://example.test/auth/v1/authorize');
    assert.equal(google.searchParams.get('provider'), 'google');
    assert.equal(google.searchParams.get('redirect_to'), `${origin}/work/app/?view=tasks`);
    assert.equal(window.KPTUAuth.safeReturn(`${origin}/work/app/?view=tasks`), `${origin}/work/app/?view=tasks`);
    assert.equal(window.KPTUAuth.safeReturn('https://evil.example/work/app/'), `${origin}/work/app/`);
  });
}
