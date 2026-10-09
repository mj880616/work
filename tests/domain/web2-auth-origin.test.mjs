import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '../..');

for (const origin of ['https://mj880616.github.io', 'https://desk.bokdoong.com']) {
  test(`login API retains password sign-in without account creation on ${origin}`, async () => {
    const source = readFileSync(resolve(root, 'app/auth-service.js'), 'utf8');
    const calls = [];
    const window = {KPTURuntime: {config: {url: 'https://example.test', key: 'synthetic'}, session: {write() {}}}};
    const context = vm.createContext({window, location: {origin, pathname: '/work/app/'}, URL, fetch: async (url, init) => {
      calls.push({url, body: JSON.parse(init.body)});
      return {ok: true, json: async () => ({access_token: 'synthetic'})};
    }});
    vm.runInContext(source, context);
    assert.equal(window.KPTUAuth.signUp, undefined);
    await window.KPTUAuth.signIn('test@example.test', 'synthetic-password');
    assert.equal(calls[0].url, 'https://example.test/auth/v1/token?grant_type=password');
    assert.equal(calls[0].body.email, 'test@example.test');
    assert.equal(window.KPTUAuth.safeReturn(`${origin}/work/app/?view=tasks`), `${origin}/work/app/?view=tasks`);
  });
}
