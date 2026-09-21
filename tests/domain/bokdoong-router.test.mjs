import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import router from '../../cloudflare/bokdoong-router.mjs';

async function request(url, { method = 'GET', upstream = new Response('ok'), headers = {} } = {}) {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    calls.push(input);
    return upstream;
  };
  try {
    const response = await router.fetch(new Request(url, {
      method,
      headers: { Cookie: 'session=private', Authorization: 'Bearer private', ...headers }
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


test('portal favicon requests serve the correct PNG and ICO assets with image MIME types', async () => {
  for (const [path, type] of [['/favicon.png', 'image/png'], ['/favicon.ico', 'image/x-icon']]) {
    const { response, calls } = await request(`https://bokdoong.com${path}?v=20260920`, {
      upstream: new Response('icon bytes', { headers: { 'Content-Type': 'application/octet-stream' } })
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), type);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `https://mj880616.github.io/work/personal/portal${path}?v=20260920`);
  }
});

test('portal icon files contain PNG and ICO image data', async () => {
  const png = await readFile(new URL('../../personal/portal/favicon.png', import.meta.url));
  const ico = await readFile(new URL('../../personal/portal/favicon.ico', import.meta.url));
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.deepEqual(ico.subarray(0, 4), Buffer.from([0, 0, 1, 0]));
  assert.ok(ico.readUInt16LE(4) >= 3, 'ICO includes multiple icon sizes');
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

test('unversioned proxied pages and assets bypass Cloudflare cache and revalidate browser caches', async () => {
  for (const url of [
    'https://bokdoong.com/',
    'https://work.bokdoong.com/work/',
    'https://work.bokdoong.com/work/assets/web1-design-lite.css',
    'https://read.bokdoong.com/read-think-write/src/app-entry.js',
    'https://arsenal.bokdoong.com/work/personal/arsenal-match-archive/matches.js'
  ]) {
    const { response, calls } = await request(url, {
      upstream: new Response('current version', {
        headers: { 'Cache-Control': 'max-age=14400', ETag: '"current"' }
      })
    });
    assert.equal(calls.length, 1, url);
    assert.equal(calls[0].cache, 'no-store', url);
    assert.equal(response.headers.get('Cache-Control'), 'no-cache, must-revalidate', url);
    assert.equal(response.headers.get('ETag'), '"current"', url);
    assert.equal(await response.text(), 'current version', url);
  }
});


test('desk versioned static assets are reusable without network revalidation', async () => {
  for (const url of [
    'https://desk.bokdoong.com/work/app/app.js?v=58',
    'https://desk.bokdoong.com/work/app/loader-v2.js?v=170',
    'https://desk.bokdoong.com/work/app/styles.css?v=31'
  ]) {
    const { response } = await request(url, {
      upstream: new Response('versioned asset', { headers: { 'Cache-Control': 'max-age=0' } })
    });
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable', url);
  }
  const serviceWorker = await request('https://desk.bokdoong.com/work/app/sw.js?v=2', {
    upstream: new Response('service worker', { headers: { 'Cache-Control': 'max-age=0' } })
  });
  assert.equal(serviceWorker.response.headers.get('Cache-Control'), 'no-cache, must-revalidate');

  const html = await request('https://desk.bokdoong.com/work/app/?v=58', {
    upstream: new Response('<!doctype html>', { headers: { 'Cache-Control': 'max-age=0' } })
  });
  assert.equal(html.response.headers.get('Cache-Control'), 'no-cache, must-revalidate');
});

test('conditional and range requests retain HTTP semantics while revalidating', async () => {
  const conditional = await request('https://arsenal.bokdoong.com/work/personal/arsenal-match-archive/matches.js', {
    headers: { 'If-None-Match': '"old"' },
    upstream: new Response(null, { status: 304, headers: { ETag: '"current"' } })
  });
  assert.equal(conditional.calls[0].headers.get('If-None-Match'), '"old"');
  assert.equal(conditional.calls[0].cache, 'no-store');
  assert.equal(conditional.response.status, 304);
  assert.equal(conditional.response.headers.get('Cache-Control'), 'no-cache, must-revalidate');

  const partial = await request('https://desk.bokdoong.com/work/app/app.js', {
    headers: { Range: 'bytes=0-3' },
    upstream: new Response('data', { status: 206, headers: { 'Content-Range': 'bytes 0-3/10' } })
  });
  assert.equal(partial.calls[0].headers.get('Range'), 'bytes=0-3');
  assert.equal(partial.response.status, 206);
  assert.equal(partial.response.headers.get('Content-Range'), 'bytes 0-3/10');
  assert.equal(partial.response.headers.get('Cache-Control'), 'no-cache, must-revalidate');
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

test('read document deep links recover through the app root without an upstream 404', async () => {
  const { response, calls } = await request(
    'https://read.bokdoong.com/read-think-write/records/?tab=recent',
    {
      upstream: new Response('missing', { status: 404 }),
      headers: { 'Sec-Fetch-Dest': 'document', Accept: 'text/html' }
    }
  );
  assert.equal(response.status, 302);
  assert.equal(
    response.headers.get('Location'),
    'https://read.bokdoong.com/read-think-write/?redirect=%2Frecords%2F%3Ftab%3Drecent'
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://mj880616.github.io/read-think-write/records/?tab=recent');

  const asset = await request('https://read.bokdoong.com/read-think-write/src/missing.js', {
    upstream: new Response('missing', { status: 404 }),
    headers: { 'Sec-Fetch-Dest': 'script', Accept: '*/*' }
  });
  assert.equal(asset.response.status, 404);
});

test('read and Arsenal favicon requests do not return 404 or reach unrelated origins', async () => {
  for (const host of ['read', 'arsenal']) {
    const { response, calls } = await request(`https://${host}.bokdoong.com/favicon.ico`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'image/svg+xml; charset=utf-8');
    assert.match(await response.text(), /<svg\b/);
    assert.equal(calls.length, 0);

    const head = await request(`https://${host}.bokdoong.com/favicon.ico`, { method: 'HEAD' });
    assert.equal(head.response.status, 200);
    assert.equal(await head.response.text(), '');
    assert.equal(head.calls.length, 0);
  }
});
