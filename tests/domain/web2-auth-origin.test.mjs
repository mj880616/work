import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '../..');

for (const origin of ['https://mj880616.github.io', 'https://desk.bokdoong.com']) {
  test(`email confirmation stays on ${origin}`, async () => {
    const html = readFileSync(resolve(root, 'app/index.html'), 'utf8');
    const script = html.match(/<script>(\(\(\)=>\{const f=window\.fetch[\s\S]*?)<\/script>/)?.[1];
    assert.ok(script, 'signup redirect hook exists');
    const calls = [];
    const window = { fetch: async url => { calls.push(url); return {}; } };
    const context = vm.createContext({ window, location: { origin, href: `${origin}/work/app/` }, URL });
    vm.runInContext(script, context);
    await window.fetch('https://xmlkxfjeagycwttklxjw.supabase.co/auth/v1/signup');
    const redirect = new URL(calls[0]).searchParams.get('redirect_to');
    assert.equal(redirect, `${origin}/work/app/confirmed.html`);
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
