import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createHash } from 'node:crypto';
import router, { resetManifestMemo } from '../../cloudflare/bokdoong-router.mjs';

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


const MANIFEST = 'https://mj880616.github.io/work/app/asset-manifest.json';
const sha256 = text => createHash('sha256').update(text).digest('hex');

// Router with a synthetic GitHub Pages (asset bytes + manifest) and a synthetic edge cache.
async function versioned(url, { body = 'current bytes', manifest, manifestStatus = 200, cache = new Map(), method = 'GET' } = {}) {
  resetManifestMemo();
  const calls = [];
  const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
  globalThis.caches = {
    default: {
      match: async key => cache.get(key.url)?.clone(),
      put: async (key, response) => { cache.set(key.url, response); }
    }
  };
  globalThis.fetch = async input => {
    calls.push(input);
    if (input.url.startsWith(MANIFEST + '?')) return new Response(JSON.stringify(manifest ?? {}), { status: manifestStatus });
    return new Response(body, { headers: { 'Cache-Control': 'max-age=600', ETag: '"pages"' } });
  };
  try {
    const response = await router.fetch(new Request(url, { method }));
    return { response, calls, cache };
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.caches = originalCaches;
  }
}

test('desk versioned assets are immutable in browser and edge only when bytes match the manifest', async () => {
  for (const [url, path, version] of [
    ['https://desk.bokdoong.com/work/app/app.js?v=58', 'app/app.js', '58'],
    ['https://desk.bokdoong.com/work/app/project-system-v3.css?v=29', 'app/project-system-v3.css', '29'],
    ['https://desk.bokdoong.com/work/app/app-icon.svg?v=20260924-unicorn2', 'app/app-icon.svg', '20260924-unicorn2']
  ]) {
    const manifest = { assets: { [path]: { v: [version], sha256: sha256('current bytes') } } };
    const { response, calls, cache } = await versioned(url, { manifest });
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable', url);
    assert.equal(await response.text(), 'current bytes', url);
    assert.equal(calls.find(call => !call.url.startsWith(MANIFEST)).cache, 'no-store', url);
    assert.equal(cache.size, 1, url);
    // A later request is answered from the edge cache without reaching GitHub Pages.
    const again = await versioned(url, { manifest, cache });
    assert.equal(again.calls.length, 0, url);
    assert.equal(await again.response.text(), 'current bytes', url);
    assert.equal(again.response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable', url);
  }
});

test('old bytes served for a new ?v= during a deploy are neither pinned at the edge nor immutable', async () => {
  const url = 'https://desk.bokdoong.com/work/app/project-system-v3.css?v=29';
  const cases = [
    ['bytes from the previous deploy', { body: 'old bytes', manifest: { assets: { 'app/project-system-v3.css': { v: ['29'], sha256: sha256('new bytes') } } } }],
    ['manifest from the previous deploy', { body: 'old bytes', manifest: { assets: { 'app/project-system-v3.css': { v: ['28'], sha256: sha256('old bytes') } } } }],
    ['asset missing from the manifest', { manifest: { assets: {} } }],
    ['manifest unavailable', { manifestStatus: 404 }],
    ['manifest malformed', { manifest: { nope: true } }]
  ];
  for (const [name, options] of cases) {
    const { response, cache } = await versioned(url, options);
    assert.equal(response.status, 200, name);
    assert.equal(response.headers.get('Cache-Control'), 'no-cache, must-revalidate', name);
    assert.equal(response.headers.get('ETag'), '"pages"', name);
    assert.equal(cache.size, 0, name);
  }
});

test('one manifest fetch serves the burst of asset misses on a cold page load', async () => {
  resetManifestMemo();
  const manifest = { assets: { 'app/a.js': { v: ['1'], sha256: sha256('current bytes') }, 'app/b.js': { v: ['1'], sha256: sha256('current bytes') } } };
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    calls.push(input.url);
    return input.url.startsWith(MANIFEST + '?') ? new Response(JSON.stringify(manifest)) : new Response('current bytes');
  };
  try {
    for (const name of ['a', 'b']) {
      const response = await router.fetch(new Request(`https://desk.bokdoong.com/work/app/${name}.js?v=1`));
      assert.equal(response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls.filter(url => url.startsWith(MANIFEST)).length, 1);
});

test('service worker, HTML and HEAD requests are never immutable', async () => {
  const manifest = { assets: { 'app/sw.js': { v: ['2'], sha256: sha256('current bytes') }, 'app/app.js': { v: ['58'], sha256: sha256('current bytes') } } };
  for (const [url, method] of [
    ['https://desk.bokdoong.com/work/app/sw.js?v=2', 'GET'],
    ['https://desk.bokdoong.com/work/app/?v=58', 'GET'],
    ['https://desk.bokdoong.com/work/app/app.js?v=58', 'HEAD']
  ]) {
    const { response, cache } = await versioned(url, { manifest, method });
    assert.equal(response.headers.get('Cache-Control'), 'no-cache, must-revalidate', url);
    assert.equal(cache.size, 0, url);
  }
});

test('the committed manifest matches the repository files it lists', async () => {
  const { assets } = JSON.parse(await readFile(new URL('../../app/asset-manifest.json', import.meta.url), 'utf8'));
  assert.ok(Object.keys(assets).length > 50);
  for (const path of ['app/app.js', 'app/loader-v2.js', 'app/view-loader.js', 'app/project-system-v3.css', 'app/project-system-v3.js', 'app/theme-tokens.css']) {
    const bytes = await readFile(new URL(`../../${path}`, import.meta.url));
    assert.equal(assets[path]?.sha256, createHash('sha256').update(bytes).digest('hex'), path);
  }
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

test('range requests bypass the edge cache; conditional versioned requests get the verified body', async () => {
  const range = await request('https://desk.bokdoong.com/work/app/app.js?v=86', {
    headers: { Range: 'bytes=0-3' },
    upstream: new Response('data', { status: 206, headers: { 'Content-Range': 'bytes 0-3/10' } })
  });
  assert.equal(range.calls[0].cache, 'no-store');
  assert.equal(range.calls.length, 1);
  assert.equal(range.response.headers.get('Cache-Control'), 'no-cache, must-revalidate');

  resetManifestMemo();
  const manifest = { assets: { 'app/app.js': { v: ['86'], sha256: sha256('current bytes') } } };
  const seen = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    seen.push(input);
    return input.url.startsWith(MANIFEST + '?') ? new Response(JSON.stringify(manifest)) : new Response('current bytes');
  };
  try {
    const response = await router.fetch(new Request('https://desk.bokdoong.com/work/app/app.js?v=86', {
      headers: { 'If-None-Match': '"old"', 'If-Modified-Since': 'Thu, 01 Jan 2026 00:00:00 GMT' }
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
    const asset = seen.find(call => !call.url.startsWith(MANIFEST));
    assert.equal(asset.headers.get('If-None-Match'), null);
    assert.equal(asset.headers.get('If-Modified-Since'), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test('read is neither routed to the shared Worker nor proxied by it', async () => {
  const config = await readFile(new URL('../../cloudflare/wrangler.toml', import.meta.url), 'utf8');
  const routes = [...config.matchAll(/^pattern = "([^"]+)"$/gm)].map((match) => match[1]);
  assert.deepEqual(routes, [
    'bokdoong.com', 'work.bokdoong.com', 'desk.bokdoong.com', 'arsenal.bokdoong.com'
  ]);
  for (const path of ['/', '/favicon.ico', '/read-think-write/records/?tab=recent']) {
    const { response, calls } = await request(`https://read.bokdoong.com${path}`);
    assert.equal(response.status, 404);
    assert.equal(calls.length, 0);
  }
});

test('Arsenal favicon requests do not return 404 or reach unrelated origins', async () => {
  const url = 'https://arsenal.bokdoong.com/favicon.ico';
  const { response, calls } = await request(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'image/svg+xml; charset=utf-8');
  const svg = await response.text();
  assert.match(svg, /<svg\b/);
  assert.match(svg, /fill="#a5232a"/);
  assert.match(svg, />A<\/text>/);
  assert.equal(calls.length, 0);

  const head = await request(url, { method: 'HEAD' });
  assert.equal(head.response.status, 200);
  assert.equal(await head.response.text(), '');
  assert.equal(head.calls.length, 0);
});

test('each browser clears its HTTP cache once per epoch on its next Web2 page load', async () => {
  const page = () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  const first = await request('https://desk.bokdoong.com/work/app/', { upstream: page() });
  assert.equal(first.response.headers.get('Clear-Site-Data'), '"cache"');
  const cookie = first.response.headers.get('Set-Cookie');
  assert.match(cookie, /^kptu_cache_epoch=[\w-]+; Path=\/work\/app\/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax$/);
  // The cookie (like every cookie) is not forwarded to GitHub Pages.
  assert.equal(first.calls[0].headers.get('Cookie'), null);

  const value = cookie.split(';')[0];
  const later = await request('https://desk.bokdoong.com/work/app/login/', { upstream: page(), headers: { Cookie: `other=1; ${value}` } });
  assert.equal(later.response.headers.get('Clear-Site-Data'), null);
  assert.equal(later.response.headers.get('Set-Cookie'), null);

  const oldEpoch = await request('https://desk.bokdoong.com/work/app/', { upstream: page(), headers: { Cookie: 'kptu_cache_epoch=1999-01-01' } });
  assert.equal(oldEpoch.response.headers.get('Clear-Site-Data'), '"cache"');
});

test('cache clearing is limited to successful desk pages', async () => {
  const html = (status = 200) => new Response('<!doctype html>', { status, headers: { 'Content-Type': 'text/html' } });
  for (const [url, upstream] of [
    ['https://work.bokdoong.com/work/', html()],
    ['https://bokdoong.com/', html()],
    ['https://desk.bokdoong.com/work/app/missing/', html(404)],
    ['https://desk.bokdoong.com/work/app/auth-service.js', new Response('js', { headers: { 'Content-Type': 'text/javascript' } })]
  ]) {
    const { response } = await request(url, { upstream });
    assert.equal(response.headers.get('Clear-Site-Data'), null, url);
    assert.equal(response.headers.get('Set-Cookie'), null, url);
  }
});
