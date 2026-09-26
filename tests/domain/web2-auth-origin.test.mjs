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

  test(`password recovery stays on ${origin}`, async () => {
    const source = readFileSync(resolve(root, 'app/password-reset.js'), 'utf8');
    const calls = [];
    const status = { textContent: '', className: '' };
    const document = {
      body: { insertAdjacentHTML() {} },
      querySelector(selector) {
        if (selector === '#recoverEmail') return { value: 'reader@example.com' };
        if (selector === '#passwordResetStatus') return status;
        return null;
      }
    };
    const context = vm.createContext({
      document,
      location: { origin, pathname: '/work/app/', hash: '', search: '' },
      URL,
      URLSearchParams,
      fetch: async url => { calls.push(url); return { ok: true, json: async () => ({}) }; }
    });
    vm.runInContext(source, context);
    await vm.runInContext('sendRecovery()', context);
    const redirect = new URL(calls[0]).searchParams.get('redirect_to');
    assert.equal(redirect, `${origin}/work/app/`);
  });
}
