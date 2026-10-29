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

test('bokdoong.com root sends visitors to Web2 with 302, keeping ?query, and never reaches Pages', async () => {
  // DOMAIN-주소이전 ①-D1: the portal is no longer served at bokdoong.com/.
  for (const [path, location] of [
    ['/', 'https://bokdoong.com/work/app/'],
    ['/?q=1', 'https://bokdoong.com/work/app/?q=1'],
    ['/?view=calendar&date=2026-10-29', 'https://bokdoong.com/work/app/?view=calendar&date=2026-10-29']
  ]) {
    for (const method of ['GET', 'HEAD']) {
      const { response, calls } = await request(`https://bokdoong.com${path}`, { method });
      assert.equal(response.status, 302, path);
      assert.equal(response.headers.get('Location'), location, path);
      assert.equal(calls.length, 0, path);
    }
  }
  // Other paths stay closed.
  for (const path of ['/other/', '/work', '/personal/portal/', '/read-think-write/']) {
    const unknown = await request(`https://bokdoong.com${path}`);
    assert.equal(unknown.response.status, 404, path);
    assert.equal(unknown.calls.length, 0, path);
  }
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
    ['https://bokdoong.com/work/app/sw.js?v=2', 'https://mj880616.github.io/work/app/sw.js?v=2'],
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
    ['https://bokdoong.com/work/app/app.js?v=58', 'app/app.js', '58'],
    ['https://bokdoong.com/work/app/project-system-v3.css?v=29', 'app/project-system-v3.css', '29'],
    ['https://bokdoong.com/work/app/app-icon.svg?v=20260924-unicorn2', 'app/app-icon.svg', '20260924-unicorn2']
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
  const url = 'https://bokdoong.com/work/app/project-system-v3.css?v=29';
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
      const response = await router.fetch(new Request(`https://bokdoong.com/work/app/${name}.js?v=1`));
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
    ['https://bokdoong.com/work/app/sw.js?v=2', 'GET'],
    ['https://bokdoong.com/work/app/?v=58', 'GET'],
    ['https://bokdoong.com/work/app/app.js?v=58', 'HEAD']
  ]) {
    const { response, cache } = await versioned(url, { manifest, method });
    assert.equal(response.headers.get('Cache-Control'), 'no-cache, must-revalidate', url);
    assert.equal(cache.size, 0, url);
  }
});

// CI-버전자동화 3단계: the manifest exists only in the Pages build output, made from the same bytes it
// lists. scripts/build-pages-repo.test.mjs builds this repository and checks every listed asset
// against this router (scripts/check-pages-build.mjs (c)).
test('the manifest is not committed; the Pages build writes it next to the files it lists', async () => {
  await assert.rejects(readFile(new URL('../../app/asset-manifest.json', import.meta.url)), { code: 'ENOENT' });
  const build = await readFile(new URL('../../scripts/build-pages.mjs', import.meta.url), 'utf8');
  assert.match(build, /export const manifestPath = 'app\/asset-manifest\.json';/);
  assert.ok(MANIFEST.endsWith('/work/app/asset-manifest.json'));
});

test('failed versioned Web2 assets never receive immutable browser caching', async () => {
  for (const status of [404, 500]) {
    const { response } = await request('https://bokdoong.com/work/app/app.js?v=poison-check', {
      upstream: new Response('missing', { status, headers: { 'Cache-Control': 'max-age=31536000' } })
    });
    assert.equal(response.status, status);
    assert.equal(response.headers.get('Cache-Control'), 'no-cache, must-revalidate');
  }
});

test('range requests bypass the edge cache; conditional versioned requests get the verified body', async () => {
  const range = await request('https://bokdoong.com/work/app/app.js?v=86', {
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
    const response = await router.fetch(new Request('https://bokdoong.com/work/app/app.js?v=86', {
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

  const partial = await request('https://bokdoong.com/work/app/app.js', {
    headers: { Range: 'bytes=0-3' },
    upstream: new Response('data', { status: 206, headers: { 'Content-Range': 'bytes 0-3/10' } })
  });
  assert.equal(partial.calls[0].headers.get('Range'), 'bytes=0-3');
  assert.equal(partial.response.status, 206);
  assert.equal(partial.response.headers.get('Content-Range'), 'bytes 0-3/10');
  assert.equal(partial.response.headers.get('Cache-Control'), 'no-cache, must-revalidate');
});

test('bokdoong.com keeps authenticated app assets; desk still sends public pages to work origin', async () => {
  const app = await request('https://bokdoong.com/work/app/auth-service.js');
  assert.equal(app.response.status, 200);
  assert.equal(app.calls[0].url, 'https://mj880616.github.io/work/app/auth-service.js');

  const appWithoutSlash = await request('https://bokdoong.com/work/app');
  assert.equal(appWithoutSlash.response.headers.get('Location'), 'https://bokdoong.com/work/app/');
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
  const first = await request('https://bokdoong.com/work/app/', { upstream: page() });
  assert.equal(first.response.headers.get('Clear-Site-Data'), '"cache"');
  const cookie = first.response.headers.get('Set-Cookie');
  assert.match(cookie, /^kptu_cache_epoch=[\w-]+; Path=\/work\/app\/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax$/);
  // The cookie (like every cookie) is not forwarded to GitHub Pages.
  assert.equal(first.calls[0].headers.get('Cookie'), null);

  const value = cookie.split(';')[0];
  const later = await request('https://bokdoong.com/work/app/login/', { upstream: page(), headers: { Cookie: `other=1; ${value}` } });
  assert.equal(later.response.headers.get('Clear-Site-Data'), null);
  assert.equal(later.response.headers.get('Set-Cookie'), null);

  const oldEpoch = await request('https://bokdoong.com/work/app/', { upstream: page(), headers: { Cookie: 'kptu_cache_epoch=1999-01-01' } });
  assert.equal(oldEpoch.response.headers.get('Clear-Site-Data'), '"cache"');
});

test('cache clearing is limited to successful bokdoong.com Web2 pages', async () => {
  const html = (status = 200) => new Response('<!doctype html>', { status, headers: { 'Content-Type': 'text/html' } });
  for (const [url, upstream] of [
    ['https://work.bokdoong.com/work/', html()],
    ['https://bokdoong.com/work/app/missing/', html(404)],
    ['https://bokdoong.com/work/app/auth-service.js', new Response('js', { headers: { 'Content-Type': 'text/javascript' } })]
  ]) {
    const { response } = await request(url, { upstream });
    assert.equal(response.headers.get('Clear-Site-Data'), null, url);
    assert.equal(response.headers.get('Set-Cookie'), null, url);
  }
});

// BUG-배포캐시-후속 안 A: GitHub Pages keeps HTML up to 10 minutes (max-age=600) in its CDN, so the
// Worker adds a 15-second value to desk HTML requests (page loads and version-notice.js checks).
async function atTime(now, url, options) {
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    return await request(url, options);
  } finally {
    Date.now = originalNow;
  }
}

const deskPage = () => new Response('<!doctype html>', {
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'max-age=600', ETag: '"pages"' }
});

test('desk HTML and the version check skip the GitHub Pages copy with a 15-second value', async () => {
  const start = 1_800_000_000_000; // a multiple of 15 seconds
  const bucket = start / 15000;
  for (const [url, origin] of [
    ['https://bokdoong.com/work/app/', `https://mj880616.github.io/work/app/?__fresh=${bucket}`],
    // app/version-notice.js fetches ./index.html next to app.js.
    ['https://bokdoong.com/work/app/index.html', `https://mj880616.github.io/work/app/index.html?__fresh=${bucket}`],
    ['https://bokdoong.com/work/app/login/', `https://mj880616.github.io/work/app/login/?__fresh=${bucket}`],
    ['https://bokdoong.com/work/app/?route=calendar', `https://mj880616.github.io/work/app/?route=calendar&__fresh=${bucket}`]
  ]) {
    const { response, calls } = await atTime(start, url, { upstream: deskPage() });
    assert.equal(calls.length, 1, url);
    assert.equal(calls[0].url, origin, url);
    assert.equal(calls[0].cache, 'no-store', url);
    // Response cache rules are unchanged.
    assert.equal(response.headers.get('Cache-Control'), 'no-cache, must-revalidate', url);
    assert.equal(response.headers.get('ETag'), '"pages"', url);
  }

  const url = 'https://bokdoong.com/work/app/index.html';
  const sameWindow = await atTime(start + 14999, url, { upstream: deskPage() });
  assert.equal(sameWindow.calls[0].url, `https://mj880616.github.io/work/app/index.html?__fresh=${bucket}`);
  const nextWindow = await atTime(start + 15000, url, { upstream: deskPage() });
  assert.equal(nextWindow.calls[0].url, `https://mj880616.github.io/work/app/index.html?__fresh=${bucket + 1}`);
});

test('assets, Web1, arsenal and the favicon are forwarded without the freshness value', async () => {
  for (const [url, origin] of [
    ['https://bokdoong.com/work/app/app.js?v=abc', 'https://mj880616.github.io/work/app/app.js?v=abc'],
    ['https://bokdoong.com/work/app/project-system-v3.css?v=29', 'https://mj880616.github.io/work/app/project-system-v3.css?v=29'],
    ['https://bokdoong.com/work/app/sw.js', 'https://mj880616.github.io/work/app/sw.js'],
    ['https://bokdoong.com/work/app/auth-service.js', 'https://mj880616.github.io/work/app/auth-service.js'],
    ['https://bokdoong.com/work/app/?v=58', 'https://mj880616.github.io/work/app/?v=58'],
    ['https://work.bokdoong.com/work/', 'https://mj880616.github.io/work/'],
    ['https://work.bokdoong.com/work/p/index.html', 'https://mj880616.github.io/work/p/index.html'],
    ['https://arsenal.bokdoong.com/work/personal/arsenal-match-archive/', 'https://mj880616.github.io/work/personal/arsenal-match-archive/'],
    ['https://bokdoong.com/favicon.png', 'https://mj880616.github.io/work/personal/portal/favicon.png']
  ]) {
    const { calls } = await request(url);
    assert.equal(calls[0].url, origin, url);
    assert.doesNotMatch(calls[0].url, /__fresh/, url);
  }
});

test('versioned asset edge cache keys and immutable rules are unaffected by the freshness value', async () => {
  const url = 'https://bokdoong.com/work/app/app.js?v=58';
  const manifest = { assets: { 'app/app.js': { v: ['58'], sha256: sha256('current bytes') } } };
  const { response, calls, cache } = await versioned(url, { manifest });
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
  assert.deepEqual([...cache.keys()], [url]);
  assert.doesNotMatch(calls.find(call => !call.url.startsWith(MANIFEST)).url, /__fresh/);
});

test('the freshness value never leaks into redirects shown to the visitor', async () => {
  const start = 1_800_000_000_000;
  const upstream = new Response(null, {
    status: 301,
    headers: { Location: `https://mj880616.github.io/work/app/login/?__fresh=${start / 15000}` }
  });
  const { response, calls } = await atTime(start, 'https://bokdoong.com/work/app/index.html', { upstream });
  assert.match(calls[0].url, /__fresh=/);
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('Location'), 'https://bokdoong.com/work/app/login/');

  const withQuery = await atTime(start, 'https://bokdoong.com/work/app/?route=a', {
    upstream: new Response(null, { status: 302, headers: { Location: `/work/app/next/?route=a&__fresh=${start / 15000}` } })
  });
  assert.equal(withQuery.response.headers.get('Location'), 'https://bokdoong.com/work/app/next/?route=a');
});

test('Clear-Site-Data still applies once per epoch to desk pages fetched with the freshness value', async () => {
  const { response, calls } = await request('https://bokdoong.com/work/app/', { upstream: deskPage() });
  assert.match(calls[0].url, /\?__fresh=\d+$/);
  assert.equal(response.headers.get('Clear-Site-Data'), '"cache"');
  assert.equal(calls[0].headers.get('Cookie'), null);
});

// SHARE-미리보기제목: link-preview cards show the share page's title. Fake titles only.
const SHARE_HTML = (await readFile(new URL('../../share/index.html', import.meta.url), 'utf8'));
const SHARE_TOKEN = '3c'.repeat(32);
const SHARE_READ = 'https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/share-page-read';
const TELEGRAM = 'TelegramBot (like TwitterBot)';
const BROWSER = 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36';

async function shareRequest(url, { ua = TELEGRAM, read = () => Response.json({ ok: true, page: { title: '가짜 제목', blocks: [{ type: 'summary', text: '본문 비밀' }] } }), method = 'GET', headers = {} } = {}) {
  const pages = [];
  const reads = [];
  const logged = [];
  const originalFetch = globalThis.fetch;
  const originalConsole = {};
  for (const name of ['log', 'info', 'warn', 'error', 'debug']) {
    originalConsole[name] = console[name];
    console[name] = (...args) => logged.push(args.join(' '));
  }
  globalThis.fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    if (req.url.startsWith('https://xmlkxfjeagycwttklxjw.supabase.co/')) {
      reads.push({ url: req.url, method: req.method, type: req.headers.get('Content-Type'), body: await req.text(), signal: req.signal, headers: [...req.headers.keys()] });
      return read(req);
    }
    pages.push(req);
    return new Response(SHARE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', ETag: '"pages"', 'Content-Length': String(Buffer.byteLength(SHARE_HTML)) } });
  };
  try {
    const response = await router.fetch(new Request(url, { method, headers: { 'User-Agent': ua, ...headers } }));
    const text = method === 'HEAD' ? '' : await response.text();
    return { response, text, pages, reads, logged };
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(console, originalConsole);
  }
}
const ogTitle = html => /<meta property="og:title" content="([^"]*)">/.exec(html)?.[1];

test('a preview bot opening a valid ?t= share link gets the page title only, escaped, with no-store', async () => {
  const { response, text, pages, reads, logged } = await shareRequest(`https://work.bokdoong.com/work/share/?t=${SHARE_TOKEN}`, {
    read: () => Response.json({ ok: true, page: { title: '가짜 <b>"제목"</b> & \'따옴표\' $& $1', blocks: [{ type: 'summary', text: '본문 비밀' }] } })
  });
  assert.equal(response.status, 200);
  const safe = '가짜 &lt;b&gt;&quot;제목&quot;&lt;/b&gt; &amp; &#39;따옴표&#39; $&amp; $1';
  assert.equal(ogTitle(text), safe);
  assert.match(text, new RegExp(`<meta name="twitter:title" content="${safe.replace(/[$&]/g, '\\$&')}">`));
  assert.ok(text.includes(`<title>${safe} · 공유 페이지</title>`));
  assert.ok(!text.includes('<b>'));
  // Only the title: no blocks, the shared description stays, the shared og:url is dropped, the token is never echoed.
  assert.ok(!text.includes('본문 비밀'));
  assert.match(text, /<meta property="og:description" content="링크를 받은 사람만 볼 수 있는 페이지">/);
  assert.ok(!text.includes('og:url'));
  assert.ok(!text.includes(SHARE_TOKEN));
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
  assert.equal(response.headers.get('ETag'), null);
  assert.equal(response.headers.get('Content-Length'), null);
  // The token goes to share-page-read in a POST body only; GitHub Pages never sees it.
  assert.equal(reads.length, 1);
  assert.equal(reads[0].url, SHARE_READ);
  assert.equal(reads[0].method, 'POST');
  assert.equal(reads[0].type, 'application/json');
  assert.deepEqual(JSON.parse(reads[0].body), { token: SHARE_TOKEN, head: true });
  assert.deepEqual(reads[0].headers.sort(), ['content-type']);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].url, 'https://mj880616.github.io/work/share/');
  assert.equal(pages[0].headers.get('Cookie'), null);
  assert.deepEqual(logged, []);
});

test('invalid, expired, off, draft or failing lookups all give the unchanged shared card', async () => {
  const replies = [
    () => Response.json({ error: 'not_found' }, { status: 404 }),
    () => Response.json({ error: 'unavailable' }, { status: 503 }),
    () => new Response('not json', { status: 200 }),
    () => Response.json({ ok: true, page: { title: '', blocks: [] } }),
    () => Response.json({ ok: true, page: { title: 12, blocks: [] } }),
    () => Response.json({ ok: true, page: { title: '줄\n바꿈', blocks: [] } }),
    () => Response.json({ ok: true, page: { title: '가'.repeat(201), blocks: [] } }),
    () => Response.json({ ok: false, page: { title: '가짜 제목' } }),
    () => new Response(null, { status: 302, headers: { Location: 'https://example.org/' } }),
    () => { throw new TypeError('network down'); }
  ];
  for (const read of replies) {
    const { response, text, logged } = await shareRequest(`https://work.bokdoong.com/work/share/?t=${SHARE_TOKEN}`, { read });
    assert.equal(response.status, 200);
    assert.equal(text, SHARE_HTML);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(logged, []);
  }
});

test('a slow lookup is cut off at the time limit and the shared card is served', async () => {
  const { SHARE_TITLE_TIMEOUT_MS } = await import('../../cloudflare/bokdoong-router.mjs');
  assert.ok(SHARE_TITLE_TIMEOUT_MS > 0 && SHARE_TITLE_TIMEOUT_MS <= 2000);
  let aborted = false;
  const started = Date.now();
  const { response, text } = await shareRequest(`https://work.bokdoong.com/work/share/?t=${SHARE_TOKEN}`, {
    read: req => new Promise(resolve => {
      req.signal.addEventListener('abort', () => { aborted = true; });
      setTimeout(() => resolve(Response.json({ ok: true, page: { title: '늦은 가짜 제목', blocks: [] } })), 10000).unref();
    })
  });
  const elapsed = Date.now() - started;
  assert.equal(response.status, 200);
  assert.equal(text, SHARE_HTML);
  assert.ok(elapsed >= SHARE_TITLE_TIMEOUT_MS - 50 && elapsed < SHARE_TITLE_TIMEOUT_MS + 1000, `elapsed ${elapsed}`);
  assert.ok(aborted, 'the lookup request is aborted');
});

test('people opening a share link get the static page without any lookup, and the token never reaches Pages', async () => {
  for (const ua of [BROWSER, '', 'Googlebot/2.1 (+http://www.google.com/bot.html)']) {
    const { response, text, pages, reads } = await shareRequest(`https://work.bokdoong.com/work/share/?t=${SHARE_TOKEN}`, { ua });
    assert.equal(response.status, 200);
    assert.equal(text, SHARE_HTML);
    assert.equal(reads.length, 0);
    assert.equal(pages[0].url, 'https://mj880616.github.io/work/share/');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  // Old #t= links: the browser sends no token at all; unchanged behaviour and caching.
  const old = await shareRequest('https://work.bokdoong.com/work/share/', { ua: BROWSER });
  assert.equal(old.reads.length, 0);
  assert.equal(old.text, SHARE_HTML);
  assert.equal(old.response.headers.get('Cache-Control'), 'no-cache, must-revalidate');
});

test('bots get the shared card without a lookup for malformed values, other paths and hosts', async () => {
  for (const url of [
    'https://work.bokdoong.com/work/share/',
    'https://work.bokdoong.com/work/share/?t=short',
    `https://work.bokdoong.com/work/share/?t=${'A'.repeat(64)}`,
    `https://work.bokdoong.com/work/share/?t=${SHARE_TOKEN}&t=${SHARE_TOKEN}`,
    `https://work.bokdoong.com/work/share/?x=${SHARE_TOKEN}`,
    `https://work.bokdoong.com/work/share/index.html?t=${SHARE_TOKEN}`,
    `https://work.bokdoong.com/work/p/?t=${SHARE_TOKEN}`
  ]) {
    const { reads, pages } = await shareRequest(url);
    assert.equal(reads.length, 0, url);
    if (new URL(url).pathname === '/work/share/') assert.equal(pages[0].url, 'https://mj880616.github.io/work/share/', url);
  }
  const head = await shareRequest(`https://work.bokdoong.com/work/share/?t=${SHARE_TOKEN}`, { method: 'HEAD' });
  assert.equal(head.reads.length, 0);
  assert.ok(!head.pages[0].url.includes(SHARE_TOKEN));
  // desk is not the share host: it sends Web1 paths to work as before, without a lookup.
  const desk = await shareRequest(`https://desk.bokdoong.com/work/share/?t=${SHARE_TOKEN}`);
  assert.equal(desk.response.status, 302);
  assert.equal(desk.reads.length, 0);
});

test('a share link without the trailing slash keeps its value on the redirect', async () => {
  const { response, reads, pages } = await shareRequest(`https://work.bokdoong.com/work/share?t=${SHARE_TOKEN}`);
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('Location'), `https://work.bokdoong.com/work/share/?t=${SHARE_TOKEN}`);
  assert.equal(reads.length, 0);
  assert.equal(pages.length, 0);
});

test('Workers Logs are off so request URLs carrying link values are not stored', async () => {
  const config = await readFile(new URL('../../cloudflare/wrangler.toml', import.meta.url), 'utf8');
  assert.match(config, /^\[observability\]\nenabled = false$/m);
  assert.match(config, /^\[observability\.logs\]\nenabled = false\ninvocation_logs = false$/m);
  const source = await readFile(new URL('../../cloudflare/bokdoong-router.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /console\./);
});


// DOMAIN-주소이전 ①-E5·D1 (docs/design/domain-move.md 1.1·1.2): bokdoong.com/work/app/** is the Web2 address.
test('bokdoong.com serves Web2 under /work/app/ without forwarding credentials', async () => {
  for (const [url, origin] of [
    ['https://bokdoong.com/work/app/auth-service.js', 'https://mj880616.github.io/work/app/auth-service.js'],
    ['https://bokdoong.com/work/app/sw.js', 'https://mj880616.github.io/work/app/sw.js'],
    ['https://bokdoong.com/work/app/onedrive-return.html', null],
    ['https://bokdoong.com/work/app/login/confirmed.html', null]
  ]) {
    const { response, calls } = await request(url);
    assert.equal(response.status, 200, url);
    assert.equal(calls.length, 1, url);
    if (origin) assert.equal(calls[0].url, origin, url);
    assert.ok(calls[0].url.startsWith('https://mj880616.github.io/work/app/'), url);
    assert.equal(calls[0].headers.get('Cookie'), null, url);
    assert.equal(calls[0].headers.get('Authorization'), null, url);
  }
});

test('bokdoong.com Web2 redirects: slash added, Web1 paths go to work', async () => {
  const appWithoutSlash = await request('https://bokdoong.com/work/app?view=calendar');
  assert.equal(appWithoutSlash.response.status, 302);
  assert.equal(appWithoutSlash.response.headers.get('Location'), 'https://bokdoong.com/work/app/?view=calendar');
  assert.equal(appWithoutSlash.calls.length, 0);

  for (const path of ['/work/p/?slug=example', '/work/share/', '/work/press/', '/work/']) {
    const { response, calls } = await request(`https://bokdoong.com${path}`);
    assert.equal(response.status, 302, path);
    assert.equal(response.headers.get('Location'), `https://work.bokdoong.com${path}`, path);
    assert.equal(calls.length, 0, path);
  }
});

test('bokdoong.com Web2 HTML gets the 15-second freshness value and keeps no-cache', async () => {
  const start = 1_800_000_000_000;
  const bucket = start / 15000;
  for (const [url, origin] of [
    ['https://bokdoong.com/work/app/', `https://mj880616.github.io/work/app/?__fresh=${bucket}`],
    ['https://bokdoong.com/work/app/index.html', `https://mj880616.github.io/work/app/index.html?__fresh=${bucket}`],
    ['https://bokdoong.com/work/app/?view=calendar', `https://mj880616.github.io/work/app/?view=calendar&__fresh=${bucket}`]
  ]) {
    const { response, calls } = await atTime(start, url, { upstream: deskPage() });
    assert.equal(calls[0].url, origin, url);
    assert.equal(calls[0].cache, 'no-store', url);
    assert.equal(response.headers.get('Cache-Control'), 'no-cache, must-revalidate', url);
  }
  // The favicon is not Web2 HTML: no freshness value.
  const icon = await atTime(start, 'https://bokdoong.com/favicon.ico', { upstream: deskPage() });
  assert.equal(icon.calls[0].url, 'https://mj880616.github.io/work/personal/portal/favicon.ico');
});

test('bokdoong.com Web2 versioned assets are immutable only when bytes match the manifest', async () => {
  const url = 'https://bokdoong.com/work/app/app.js?v=58';
  const good = { assets: { 'app/app.js': { v: ['58'], sha256: sha256('current bytes') } } };
  const ok = await versioned(url, { manifest: good });
  assert.equal(ok.response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
  assert.deepEqual([...ok.cache.keys()], [url]);
  assert.doesNotMatch(ok.calls.find(call => !call.url.startsWith(MANIFEST)).url, /__fresh/);

  const stale = await versioned(url, { manifest: { assets: { 'app/app.js': { v: ['58'], sha256: sha256('other') } } } });
  assert.equal(stale.response.headers.get('Cache-Control'), 'no-cache, must-revalidate');
  assert.equal(stale.cache.size, 0);

  // desk no longer serves Web2 assets: it redirects, so nothing is fetched or stored at the edge for it.
  const cache = new Map();
  const desk = await versioned('https://desk.bokdoong.com/work/app/app.js?v=58', { manifest: good, cache });
  assert.equal(desk.response.status, 302);
  assert.equal(desk.response.headers.get('Location'), url);
  assert.equal(desk.calls.length, 0);
  assert.equal(cache.size, 0);

  // sw.js and the portal favicon are never pinned.
  for (const other of ['https://bokdoong.com/work/app/sw.js?v=2', 'https://bokdoong.com/favicon.png?v=20260920']) {
    const { response, cache: none } = await versioned(other, { manifest: good });
    assert.notEqual(response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable', other);
    assert.equal(none.size, 0, other);
  }
});

test('bokdoong.com Web2 pages clear the browser cache once per epoch; the root redirect never does', async () => {
  const page = () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  const first = await request('https://bokdoong.com/work/app/', { upstream: page() });
  assert.equal(first.response.headers.get('Clear-Site-Data'), '"cache"');
  const cookie = first.response.headers.get('Set-Cookie');
  assert.match(cookie, /^kptu_cache_epoch=[\w-]+; Path=\/work\/app\/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax$/);
  const later = await request('https://bokdoong.com/work/app/', { upstream: page(), headers: { Cookie: cookie.split(';')[0] } });
  assert.equal(later.response.headers.get('Clear-Site-Data'), null);
  const root = await request('https://bokdoong.com/', { upstream: page() });
  assert.equal(root.response.status, 302);
  assert.equal(root.response.headers.get('Clear-Site-Data'), null);
  assert.equal(root.response.headers.get('Set-Cookie'), null);
});

test('bokdoong.com Web2 upstream redirects stay on bokdoong.com without the freshness value', async () => {
  const start = 1_800_000_000_000;
  const upstream = new Response(null, {
    status: 301,
    headers: { Location: `https://mj880616.github.io/work/app/login/?__fresh=${start / 15000}` }
  });
  const { response } = await atTime(start, 'https://bokdoong.com/work/app/index.html', { upstream });
  assert.equal(response.headers.get('Location'), 'https://bokdoong.com/work/app/login/');
});

// DOMAIN-주소이전 ①-D1 (docs/design/domain-move.md 1.1): desk and work send Web2 visitors to bokdoong.com.
test('desk / and /work/app/** go to the same path and ?query on bokdoong.com with 302', async () => {
  for (const [url, location] of [
    ['https://desk.bokdoong.com/', 'https://bokdoong.com/work/app/'],
    ['https://desk.bokdoong.com/?view=basket', 'https://bokdoong.com/work/app/?view=basket'],
    ['https://desk.bokdoong.com/work/app', 'https://bokdoong.com/work/app/'],
    ['https://desk.bokdoong.com/work/app?view=calendar', 'https://bokdoong.com/work/app/?view=calendar'],
    ['https://desk.bokdoong.com/work/app/', 'https://bokdoong.com/work/app/'],
    ['https://desk.bokdoong.com/work/app/?view=library&drive=connected', 'https://bokdoong.com/work/app/?view=library&drive=connected'],
    ['https://desk.bokdoong.com/work/app/?view=calendar&google=connected&native=android', 'https://bokdoong.com/work/app/?view=calendar&google=connected&native=android'],
    ['https://desk.bokdoong.com/work/app/native-callback.html?native=android', 'https://bokdoong.com/work/app/native-callback.html?native=android'],
    ['https://desk.bokdoong.com/work/app/onedrive-return.html?code=abc&state=xyz', 'https://bokdoong.com/work/app/onedrive-return.html?code=abc&state=xyz'],
    ['https://desk.bokdoong.com/work/app/login/', 'https://bokdoong.com/work/app/login/'],
    ['https://desk.bokdoong.com/work/app/app.js?v=58', 'https://bokdoong.com/work/app/app.js?v=58'],
    ['https://DESK.bokdoong.com/work/app/sw.js', 'https://bokdoong.com/work/app/sw.js'],
    ['https://desk.bokdoong.com/work/app/a%20b/?q=%ED%95%9C', 'https://bokdoong.com/work/app/a%20b/?q=%ED%95%9C']
  ]) {
    for (const method of ['GET', 'HEAD']) {
      const { response, calls } = await request(url, { method });
      assert.equal(response.status, 302, url);
      assert.equal(response.headers.get('Location'), location, url);
      assert.equal(response.headers.get('Set-Cookie'), null, url);
      assert.equal(calls.length, 0, url);
    }
  }
  // The #fragment is never sent to the server; the browser carries it over the redirect.
  const hash = await request('https://desk.bokdoong.com/work/app/#access_token=synthetic');
  assert.equal(hash.response.headers.get('Location'), 'https://bokdoong.com/work/app/');
  // http is upgraded on desk first, then the https request is redirected.
  const http = await request('http://desk.bokdoong.com/work/app/?view=notes');
  assert.equal(http.response.status, 301);
  assert.equal(http.response.headers.get('Location'), 'https://desk.bokdoong.com/work/app/?view=notes');
  // Other desk paths are unchanged: Web1 goes to work, anything else is 404.
  const other = await request('https://desk.bokdoong.com/other/');
  assert.equal(other.response.status, 404);
  assert.equal(other.calls.length, 0);
});

test('work /work/app/** goes to bokdoong.com; Web1, the share page and arsenal stay as they were', async () => {
  for (const [url, location] of [
    ['https://work.bokdoong.com/work/app', 'https://bokdoong.com/work/app/'],
    ['https://work.bokdoong.com/work/app/', 'https://bokdoong.com/work/app/'],
    ['https://work.bokdoong.com/work/app/?view=calendar&google=connected', 'https://bokdoong.com/work/app/?view=calendar&google=connected'],
    ['https://work.bokdoong.com/work/app/login/', 'https://bokdoong.com/work/app/login/']
  ]) {
    const { response, calls } = await request(url);
    assert.equal(response.status, 302, url);
    assert.equal(response.headers.get('Location'), location, url);
    assert.equal(calls.length, 0, url);
  }
  // Not Web2: /work/apps/ and /work/application are Web1 paths on work.
  for (const path of ['/work/apps/', '/work/application']) {
    const { calls } = await request(`https://work.bokdoong.com${path}`);
    assert.equal(calls[0].url, `https://mj880616.github.io${path}`, path);
  }
  const workRoot = await request('https://work.bokdoong.com/');
  assert.equal(workRoot.response.headers.get('Location'), 'https://work.bokdoong.com/work/');
  const web1 = await request('https://work.bokdoong.com/work/p/?slug=example');
  assert.equal(web1.calls[0].url, 'https://mj880616.github.io/work/p/?slug=example');
  const share = await request('https://work.bokdoong.com/work/share/');
  assert.equal(share.response.status, 200);
  assert.equal(share.calls[0].url, 'https://mj880616.github.io/work/share/');
  const arsenalRoot = await request('https://arsenal.bokdoong.com/');
  assert.equal(arsenalRoot.response.headers.get('Location'), 'https://arsenal.bokdoong.com/work/personal/arsenal-match-archive/');
  const arsenalApp = await request('https://arsenal.bokdoong.com/work/app/');
  assert.equal(arsenalApp.response.status, 404);
});

// SHARE-보관함·HTML공유: bokdoong.com/s/<name>-<8 letters>.
const SLUG = 'minja-rail-k7q2m9xa';
test('a person opening bokdoong.com/s/<short address> is sent to the share page on work, nothing is looked up', async () => {
  const { response, reads, pages } = await shareRequest(`https://bokdoong.com/s/${SLUG}`, { ua: 'Mozilla/5.0 (Linux; Android 14) SamsungBrowser/26.0' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), `https://work.bokdoong.com/work/share/?s=${SLUG}`);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
  assert.equal(reads.length, 0); assert.equal(pages.length, 0);
});
test('a preview bot on bokdoong.com/s/ gets the shared card with the page title (title only, by short address)', async () => {
  const { response, text, reads, pages } = await shareRequest(`https://bokdoong.com/s/${SLUG}`, {
    read: () => Response.json({ ok: true, page: { title: '민자철도 <현황>' } }) });
  assert.equal(response.status, 200);
  assert.equal(ogTitle(text), '민자철도 &lt;현황&gt;');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(JSON.parse(reads[0].body), { slug: SLUG, head: true });
  assert.equal(pages[0].url, 'https://mj880616.github.io/work/share/');
  assert.ok(!text.includes(SLUG));
});
test('a preview bot on work /work/share/?s= also gets the title; malformed short addresses are 404 or the plain card', async () => {
  const work = await shareRequest(`https://work.bokdoong.com/work/share/?s=${SLUG}`, { read: () => Response.json({ ok: true, page: { title: '제목' } }) });
  assert.equal(ogTitle(work.text), '제목');
  assert.deepEqual(JSON.parse(work.reads[0].body), { slug: SLUG, head: true });
  assert.equal(work.pages[0].url, 'https://mj880616.github.io/work/share/');
  for (const bad of ['minja-rail', 'minja-rail-k7q2', 'MINJA-rail-k7q2m9xa', 'minja-rail-k7q2m9x0', 'a-k7q2m9xa', 'x--y-k7q2m9xa', `${SLUG}/x`]) {
    const r = await shareRequest(`https://bokdoong.com/s/${bad}`);
    assert.equal(r.response.status, 404, bad); assert.equal(r.reads.length, 0, bad);
  }
  assert.equal((await shareRequest(`https://bokdoong.com/s/${SLUG}?x=1`)).response.status, 404);
  const plain = await shareRequest('https://work.bokdoong.com/work/share/?s=minja-rail-k7q2');
  assert.equal(plain.reads.length, 0); assert.equal(ogTitle(plain.text), '공유 페이지');
});
