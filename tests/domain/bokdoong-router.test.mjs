import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import router from '../../cloudflare/bokdoong-router.mjs';

async function request(url, { method = 'GET', upstream = new Response('ok'), headers = {} } = {}) {
  const calls = [];
  const fetchInits = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    calls.push(input);
    fetchInits.push(init);
    return upstream;
  };
  try {
    const response = await router.fetch(new Request(url, {
      method,
      headers: { Cookie: 'session=private', Authorization: 'Bearer private', ...headers }
    }));
    return { response, calls, fetchInits };
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


test('desk versioned static assets are reusable in browser and Cloudflare edge caches', async () => {
  for (const url of [
    'https://desk.bokdoong.com/work/app/app.js?v=58',
    'https://desk.bokdoong.com/work/app/loader-v2.js?v=170',
    'https://desk.bokdoong.com/work/app/styles.css?v=31',
    'https://desk.bokdoong.com/work/app/app-icon.svg?v=20260924-unicorn2'
  ]) {
    const { response, calls, fetchInits } = await request(url, {
      upstream: new Response('versioned asset', { headers: { 'Cache-Control': 'max-age=0' } })
    });
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable', url);
    assert.equal(calls[0].cache, 'default', url);
    assert.equal(fetchInits[0]?.cf?.cacheEverything, true, url);
    assert.equal(fetchInits[0]?.cf?.cacheTtlByStatus?.['200-299'], 31536000, url);
    assert.equal(fetchInits[0]?.cf?.cacheTtlByStatus?.['404'], 0, url);
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

test('failed versioned Web2 assets never receive immutable browser caching', async () => {
  for (const status of [404, 500]) {
    const { response } = await request('https://desk.bokdoong.com/work/app/app.js?v=poison-check', {
      upstream: new Response('missing', { status, headers: { 'Cache-Control': 'max-age=31536000' } })
    });
    assert.equal(response.status, status);
    assert.equal(response.headers.get('Cache-Control'), 'no-cache, must-revalidate');
  }
});

test('conditional or range requests bypass the immutable edge-cache path', async () => {
  const conditional = await request('https://desk.bokdoong.com/work/app/app.js?v=86', {
    headers: { 'If-None-Match': '"old"' },
    upstream: new Response(null, { status: 304, headers: { ETag: '"current"' } })
  });
  assert.equal(conditional.calls[0].cache, 'no-store');
  assert.equal(conditional.fetchInits[0], undefined);

  const range = await request('https://desk.bokdoong.com/work/app/app.js?v=86', {
    headers: { Range: 'bytes=0-3' },
    upstream: new Response('data', { status: 206, headers: { 'Content-Range': 'bytes 0-3/10' } })
  });
  assert.equal(range.calls[0].cache, 'no-store');
  assert.equal(range.fetchInits[0], undefined);
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

test('read root retains its existing redirect and query', async () => {
  const { response, calls } = await request('https://read.bokdoong.com/?a=1&b=2', {
    headers: { Accept: 'text/html' }
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), 'https://read.bokdoong.com/read-think-write/?a=1&b=2');
  assert.equal(calls.length, 0);
});

for (const path of [
  '/notes/',
  '/notes/?a=1&b=2',
  '/notes/one/two/',
  '/없는-화면/한글/?검색=책 읽기&기호=%26%3D%23%2B&literal=+',
  '/notes/a%2Fb/%25/?next=%2Fnotes%2F%3Fa%3D1',
  '/unknown-screen/'
]) {
  test(`read short document ${path} recovers once with the full path and query`, async () => {
    for (const headers of [{ 'Sec-Fetch-Dest': 'document' }, { Accept: 'text/html,application/xhtml+xml' }]) {
      const { response, calls } = await request(`https://read.bokdoong.com${path}`, { headers });
      assert.equal(response.status, 302);
      assert.equal(calls.length, 0, 'short document must not request an upstream missing page');
      const location = new URL(response.headers.get('Location'));
      const original = new URL(`https://read.bokdoong.com${path}`);
      assert.equal(location.origin, original.origin);
      assert.equal(location.pathname, '/read-think-write/');
      assert.equal(location.searchParams.get('redirect'), original.pathname + original.search);
      assert.equal(await response.text(), '', 'do not serve HTML at a short path');
      if (path === '/notes/?a=1&b=2') {
        assert.equal(location.search, '?redirect=%2Fnotes%2F%3Fa%3D1%26b%3D2');
      }
      const shell = await request(location.href, {
        headers, upstream: new Response('app shell', { headers: { 'Content-Type': 'text/html' } })
      });
      assert.equal(shell.response.status, 200);
      assert.equal(shell.response.headers.get('Location'), null, 'app shell must not redirect back');
      assert.equal(shell.calls.length, 1);
      assert.equal(shell.calls[0].url, `https://mj880616.github.io/read-think-write/${location.search}`);
      assert.equal(await shell.response.text(), 'app shell');
    }
  });
}

test('read short non-document requests and non-GET methods retain their rejection', async () => {
  for (const [path, method, headers, status] of [
    ['/src/styles.xxx.css', 'GET', { 'Sec-Fetch-Dest': 'style', Accept: 'text/css,*/*;q=0.1' }, 404],
    ['/src/missing.js', 'GET', { 'Sec-Fetch-Dest': 'script', Accept: '*/*' }, 404],
    ['/missing.png', 'GET', { 'Sec-Fetch-Dest': 'image', Accept: 'image/*' }, 404],
    ['/notes/', 'GET', { Accept: 'application/json' }, 404],
    ['/notes/', 'GET', {}, 404],
    ['/notes/', 'HEAD', { Accept: 'text/html', 'Sec-Fetch-Dest': 'document' }, 404],
    ['/notes/', 'POST', { Accept: 'text/html' }, 405]
  ]) {
    const { response, calls } = await request(`https://read.bokdoong.com${path}`, { method, headers });
    assert.equal(response.status, status, `${method} ${path}`);
    assert.equal(response.headers.get('Location'), null);
    assert.equal(calls.length, 0);
  }
});

test('read prefixed documents and missing assets preserve their upstream behavior', async () => {
  const page = await request('https://read.bokdoong.com/read-think-write/existing/?a=1', {
    headers: { Accept: 'text/html' }, upstream: new Response('existing document')
  });
  assert.equal(page.response.status, 200);
  assert.equal(page.response.headers.get('Location'), null);
  assert.equal(page.calls[0].url, 'https://mj880616.github.io/read-think-write/existing/?a=1');
  for (const path of ['/read-think-write/', '/read-think-write/src/missing.css']) {
    const { response, calls } = await request(`https://read.bokdoong.com${path}`, {
      headers: { Accept: path.endsWith('.css') ? 'text/css' : 'text/html' },
      upstream: new Response('missing', { status: 404 })
    });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('Location'), null);
    assert.equal(response.headers.get('Cache-Control'), 'no-cache, must-revalidate');
    assert.equal(calls.length, 1);
  }
});

test('short document recovery does not extend to other hosts', async () => {
  for (const host of ['bokdoong.com', 'work.bokdoong.com', 'desk.bokdoong.com', 'arsenal.bokdoong.com', 'unknown.bokdoong.com']) {
    const { response, calls } = await request(`https://${host}/notes/?a=1`, {
      headers: { Accept: 'text/html', 'Sec-Fetch-Dest': 'document' }
    });
    assert.equal(response.status, 404, host);
    assert.equal(response.headers.get('Location'), null, host);
    assert.equal(calls.length, 0, host);
  }
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
