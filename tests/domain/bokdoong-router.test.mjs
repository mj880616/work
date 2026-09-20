import assert from 'node:assert/strict';
import test from 'node:test';
import router from '../../cloudflare/bokdoong-router.mjs';

async function request(url, { method = 'GET', upstream = new Response('ok') } = {}) {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    calls.push(input);
    return upstream;
  };
  try {
    const response = await router.fetch(new Request(url, {
      method,
      headers: { Cookie: 'session=private', Authorization: 'Bearer private' }
    }));
    return { response, calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('portal root serves only its own static entry without forwarding credentials', async () => {
  const { response, calls } = await request('https://bokdoong.com/?q=1');
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://mj880616.github.io/work/personal/portal/?q=1');
  assert.equal(calls[0].headers.get('Cookie'), null);
  assert.equal(calls[0].headers.get('Authorization'), null);
  const unknown = await request('https://bokdoong.com/work/app/');
  assert.equal(unknown.response.status, 404);
  assert.equal(unknown.calls.length, 0);
});

test('service roots stay on their vanity hosts and retain deployed base paths', async () => {
  for (const [host, path] of [
    ['work', '/work/'],
    ['desk', '/work/app/'],
    ['read', '/read-think-write/'],
    ['arsenal', '/work/personal/arsenal-match-archive/']
  ]) {
    const { response, calls } = await request(`https://${host}.bokdoong.com/`);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('Location'), `https://${host}.bokdoong.com${path}`);
    assert.equal(calls.length, 0);
  }
});

test('only the selected GitHub Pages trees are proxied', async () => {
  const cases = [
    ['https://work.bokdoong.com/work/assets/web1-design-lite.css?v=1', 'https://mj880616.github.io/work/assets/web1-design-lite.css?v=1'],
    ['https://desk.bokdoong.com/work/app/sw.js?v=2', 'https://mj880616.github.io/work/app/sw.js?v=2'],
    ['https://read.bokdoong.com/read-think-write/src/app-entry.js', 'https://mj880616.github.io/read-think-write/src/app-entry.js'],
    ['https://arsenal.bokdoong.com/work/personal/arsenal-match-archive/matches.js', 'https://mj880616.github.io/work/personal/arsenal-match-archive/matches.js']
  ];
  for (const [vanity, origin] of cases) {
    const { response, calls } = await request(vanity);
    assert.equal(response.status, 200);
    assert.equal(calls[0].url, origin);
  }
  const denied = await request('https://arsenal.bokdoong.com/work/app/');
  assert.equal(denied.response.status, 404);
  assert.equal(denied.calls.length, 0);
});

test('desk keeps authenticated app assets and sends public pages to work origin', async () => {
  const app = await request('https://desk.bokdoong.com/work/app/auth-service.js');
  assert.equal(app.response.status, 200);
  assert.equal(app.calls[0].url, 'https://mj880616.github.io/work/app/auth-service.js');

  const appWithoutSlash = await request('https://desk.bokdoong.com/work/app');
  assert.equal(appWithoutSlash.response.headers.get('Location'), 'https://desk.bokdoong.com/work/app/');
  assert.equal(appWithoutSlash.calls.length, 0);

  const publicPage = await request('https://desk.bokdoong.com/work/p/?slug=example');
  assert.equal(publicPage.response.status, 302);
  assert.equal(publicPage.response.headers.get('Location'), 'https://work.bokdoong.com/work/p/?slug=example');
  assert.equal(publicPage.calls.length, 0);
});

test('upstream directory redirects keep the requested hostname', async () => {
  const upstream = new Response(null, {
    status: 301,
    headers: { Location: 'https://mj880616.github.io/work/press/' }
  });
  const { response } = await request('https://work.bokdoong.com/work/press', { upstream });
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('Location'), 'https://work.bokdoong.com/work/press/');
});

test('unknown hosts and non-static methods do not reach GitHub Pages', async () => {
  for (const [url, method, status] of [
    ['https://wrong.bokdoong.com/work/', 'GET', 404],
    ['https://work.bokdoong.com/work/', 'POST', 405]
  ]) {
    const { response, calls } = await request(url, { method });
    assert.equal(response.status, status);
    assert.equal(calls.length, 0);
  }
});
