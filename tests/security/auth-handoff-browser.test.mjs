import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const bridge = readFileSync(new URL('../../app/native-auth-bridge.js', import.meta.url), 'utf8');
const client = readFileSync(new URL('../../app/auth-handoff-client.js', import.meta.url), 'utf8');
const calendar = readFileSync(new URL('../../app/calendar-return-bridge.js', import.meta.url), 'utf8');
function browser(url, fetch) {
  const location = new URL(url);
  const elements = Object.fromEntries(['#handoffStatus', '#backToApp', '#authStatus'].map(k => [k, { style: {}, textContent: '', removeAttribute(name) { delete this[name]; } }]));
  const storage = new Map();
  let requests = 0;
  const ctx = vm.createContext({ location, URL, URLSearchParams,
    history: { replaceState: (_, __, path) => { location.href = new URL(path, location).href; } },
    document: { documentElement: { innerHTML: '' }, querySelector: q => elements[q] },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    fetch: async (...args) => { requests++; return fetch(location, ...args); },
    setTimeout: fn => fn(), window: {}, console
  });
  return { ctx, elements, storage, location, requests: () => requests };
}
const json = (data, ok = true) => ({ ok, json: async () => data });
const callback = 'https://desk.bokdoong.com/work/app/native-callback.html?native=android';

test('native seal failure erases OAuth URL before network and never exposes raw fallback', async () => {
  for (const suffix of ['#access_token=synthetic-access&refresh_token=synthetic-refresh&provider_token=synthetic-provider', '&access_token=synthetic-access&refresh_token=synthetic-refresh']) {
    for (const mode of ['error', 'throw', 'malformed']) {
      const b = browser(callback + suffix, async location => {
        assert.doesNotMatch(location.href, /synthetic-|access_token|refresh_token|provider_token/);
        if (mode === 'throw') throw new Error('synthetic-private');
        return mode === 'error' ? json({ error: 'synthetic-private' }, false) : json({});
      });
      vm.runInContext(bridge, b.ctx);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(b.requests(), 1);
      assert.doesNotMatch(b.location.href, /synthetic-|access_token|refresh_token/);
      assert.equal(b.elements['#backToApp'].href, undefined);
      assert.doesNotMatch(b.elements['#handoffStatus'].textContent, /synthetic-private/);
      assert.match(b.elements['#handoffStatus'].textContent, /새.*로그인/);
    }
  }
});

test('native success emits only opaque handoff through existing Android and Windows query contract', async () => {
  for (const platform of ['android', 'windows']) {
    const b = browser(callback.replace('android', platform) + '#access_token=synthetic-access&refresh_token=synthetic-refresh', async location => {
      assert.doesNotMatch(location.href, /synthetic-/);
      return json({ token: 'opaque-sealed-handoff' });
    });
    vm.runInContext(bridge, b.ctx);
    await new Promise(resolve => setImmediate(resolve));
    assert.match(b.elements['#backToApp'].href, /auth\?handoff=opaque-sealed-handoff/);
    assert.doesNotMatch(b.elements['#backToApp'].href, /payload|access_token|refresh_token|synthetic-/);
  }
});

test('native malformed or denied OAuth callback is scrubbed without launching app', async () => {
  const b = browser(callback + '#error=access_denied&error_description=synthetic-private&access_token=synthetic-access', () => { throw new Error('unexpected network'); });
  vm.runInContext(bridge, b.ctx);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(b.requests(), 0);
  assert.equal(b.elements['#backToApp'].href, undefined);
  assert.doesNotMatch(b.location.href, /synthetic-|error_description/);
});

test('consume removes handoff before request; failed consume cannot replay on reload or import', async () => {
  for (const outcome of ['error', 'throw', 'malformed']) {
    const b = browser('https://desk.bokdoong.com/work/app/?handoff=opaque&keep=1#access_token=synthetic-access&refresh_token=synthetic-refresh', async location => {
      assert.doesNotMatch(location.href, /handoff|synthetic-/);
      if (outcome === 'throw') throw new Error('synthetic-private');
      return outcome === 'error' ? json({ error: 'synthetic-private' }, false) : json({});
    });
    await vm.runInContext('(async()=>{' + client + '})()', b.ctx);
    await vm.runInContext('(async()=>{' + client + '})()', b.ctx);
    assert.equal(b.requests(), 1);
    assert.equal(b.storage.size, 0);
    assert.equal(b.location.search, '?keep=1');
    assert.doesNotMatch(b.elements['#authStatus'].textContent, /synthetic-/);
    assert.match(b.elements['#authStatus'].textContent, /새.*로그인/);
  }
});

test('successful consume stores session once and leaves ordinary desktop OAuth untouched', async () => {
  const b = browser('https://desk.bokdoong.com/work/app/?handoff=opaque', async location => {
    assert.equal(location.search, '');
    return json({ session: { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600, user: { id: 'synthetic-user' } } });
  });
  await vm.runInContext('(async()=>{' + client + '})()', b.ctx);
  assert.equal(b.storage.size, 1);
  assert.equal(b.requests(), 1);
  const desktop = browser('https://desk.bokdoong.com/work/app/#access_token=synthetic-access&refresh_token=synthetic-refresh', () => { throw new Error('unexpected network'); });
  vm.runInContext(bridge, desktop.ctx);
  await vm.runInContext('(async()=>{' + client + '})()', desktop.ctx);
  assert.match(desktop.location.hash, /access_token/);
  assert.equal(desktop.requests(), 0);
});

test('native login bridge leaves Google Calendar returns and ordinary native app visits untouched', () => {
  for (const query of ['?google=connected&native=android', '?google=error&native=android', '?native=android', '?google=connected&native=windows']) {
    const b = browser('https://desk.bokdoong.com/work/app/' + query, () => { throw new Error('unexpected network'); });
    b.ctx.document.documentElement.innerHTML = 'calendar-owned-content';
    vm.runInContext(bridge, b.ctx);
    assert.equal(b.ctx.window.__KPTU_NATIVE_BRIDGE__, undefined);
    assert.equal(b.ctx.document.documentElement.innerHTML, 'calendar-owned-content');
    assert.equal(b.requests(), 0);
  }
});

test('Calendar return has one DOM owner regardless of bridge import ordering or Android UA', () => {
  for (const app of [false, true]) for (const order of [[calendar, bridge], [bridge, calendar]]) {
    const b = browser('https://desk.bokdoong.com/work/app/?google=connected&native=android', () => { throw new Error('unexpected network'); });
    b.ctx.navigator = { userAgent: app ? 'KPTUAndroid/0.1.13' : 'Chrome' };
    b.ctx.setTimeout = () => {};
    b.elements['#openKptuApp'] = {};
    for (const source of order) vm.runInContext('(()=>{' + source + '})()', b.ctx);
    assert.equal(b.ctx.window.__KPTU_NATIVE_BRIDGE__, undefined);
    if (app) assert.equal(b.ctx.window.__KPTU_CALENDAR_BRIDGE__, undefined);
    else {
      assert.equal(b.ctx.window.__KPTU_CALENDAR_BRIDGE__, true);
      assert.match(b.ctx.document.documentElement.innerHTML, /Google Calendar/);
      assert.equal(b.elements['#openKptuApp'].href, 'kptuwork://auth?google=connected');
    }
  }
});
