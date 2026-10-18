const PAGES_ORIGIN = 'https://mj880616.github.io';
const SERVICES = Object.freeze({
  'work.bokdoong.com': { root: '/work/', prefix: '/work/' },
  'desk.bokdoong.com': { root: '/work/app/', prefix: '/work/app/' },
  'arsenal.bokdoong.com': {
    root: '/work/personal/arsenal-match-archive/',
    prefix: '/work/personal/arsenal-match-archive/'
  }
});

function allowedPath(host, path) {
  if (host === 'bokdoong.com') return path === '/' || path === '/favicon.png' || path === '/favicon.ico';
  return Boolean(SERVICES[host] && path.startsWith(SERVICES[host].prefix));
}

function upstreamPath(host, path) {
  if (host === 'bokdoong.com') {
    if (path === '/favicon.png' || path === '/favicon.ico') return `/work/personal/portal${path}`;
    return '/work/personal/portal/';
  }
  return path;
}

// Expected ?v= and SHA-256 per Web2 asset, written into the Pages build output by scripts/build-pages.mjs.
// Fetched fresh from GitHub Pages; reused for a short time so a cold page load fetches it once.
const MANIFEST_URL = `${PAGES_ORIGIN}/work/app/asset-manifest.json`;
const MANIFEST_REUSE_MS = 30000;
let manifestMemo = null;

function loadManifest(now = Date.now()) {
  if (manifestMemo && now - manifestMemo.at < MANIFEST_REUSE_MS) return manifestMemo.promise;
  const promise = fetch(new Request(`${MANIFEST_URL}?t=${now}`, { cache: 'no-store', redirect: 'manual' }))
    .then(response => (response.status === 200 ? response.json() : null))
    .then(data => (data && typeof data.assets === 'object' ? data.assets : null))
    .catch(() => null);
  manifestMemo = { at: now, promise };
  return promise;
}

async function matchesManifest(pathname, version, bytes) {
  const assets = await loadManifest();
  const entry = assets?.[pathname.replace(/^\/work\//, '')];
  if (!entry || !Array.isArray(entry.v) || !entry.v.includes(version)) return false;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') === entry.sha256;
}

// Browsers that already hold old bytes as immutable never ask again. Each browser gets one
// Clear-Site-Data: "cache" on its next Web2 page load per epoch; a cookie remembers it was done.
// Raise CACHE_EPOCH (and deploy) to flush every browser once more. The cookie is never forwarded.
const CACHE_EPOCH = '2026-10-17';
const EPOCH_COOKIE = 'kptu_cache_epoch';

function hasCurrentEpoch(request) {
  return (request.headers.get('Cookie') || '').split(';')
    .some(part => part.trim() === `${EPOCH_COOKIE}=${CACHE_EPOCH}`);
}

// GitHub Pages serves HTML with max-age=600 and its CDN may answer an unchanged URL with a copy up
// to 10 minutes old, so a fresh deploy would stay invisible to page loads and to app/version-notice.js
// (which fetches /work/app/index.html). For desk HTML only, the Worker appends a value that changes
// every 15 seconds to the Pages URL (like ?t= for the manifest). The visitor's URL, the response
// headers and the edge cache key are unchanged; ?v= assets never get it.
const FRESH_PARAM = '__fresh';
const FRESH_WINDOW_MS = 15000;

function deskDocument(host, url) {
  return host === 'desk.bokdoong.com'
    && url.pathname.startsWith('/work/app/')
    && !url.searchParams.has('v')
    && (url.pathname.endsWith('/') || /\.html$/i.test(url.pathname));
}

function withFreshness(search, now = Date.now()) {
  const value = `${FRESH_PARAM}=${Math.floor(now / FRESH_WINDOW_MS)}`;
  return search && search !== '?' ? `${search}&${value}` : `?${value}`;
}

function withoutFreshness(url) {
  if (url.searchParams.has(FRESH_PARAM)) url.searchParams.delete(FRESH_PARAM);
}

export function resetManifestMemo() {
  manifestMemo = null;
}

export default {
  async fetch(request, env, context) {
    const incoming = new URL(request.url);
    const host = incoming.hostname.toLowerCase();
    if (!SERVICES[host] && host !== 'bokdoong.com') return new Response('Not found', { status: 404 });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    if (incoming.protocol !== 'https:') {
      incoming.protocol = 'https:';
      return Response.redirect(incoming.href, 301);
    }
    if (incoming.pathname === '/favicon.ico' && host === 'arsenal.bokdoong.com') {
      const icon = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#a5232a"/><text x="16" y="23" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="22" font-weight="700">A</text></svg>';
      return new Response(request.method === 'HEAD' ? null : icon, {
        headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' }
      });
    }
    if (incoming.pathname === '/' && host !== 'bokdoong.com') {
      incoming.pathname = SERVICES[host].root;
      return Response.redirect(incoming.href, 302);
    }
    if (host === 'desk.bokdoong.com' && incoming.pathname === '/work/app') {
      incoming.pathname = '/work/app/';
      return Response.redirect(incoming.href, 302);
    }
    if (host === 'desk.bokdoong.com' && incoming.pathname.startsWith('/work/') && !incoming.pathname.startsWith('/work/app/')) {
      incoming.hostname = 'work.bokdoong.com';
      return Response.redirect(incoming.href, 302);
    }
    if (!allowedPath(host, incoming.pathname)) return new Response('Not found', { status: 404 });

    const originUrl = new URL(upstreamPath(host, incoming.pathname), PAGES_ORIGIN);
    const freshDocument = deskDocument(host, incoming);
    originUrl.search = freshDocument ? withFreshness(incoming.search) : incoming.search;
    const headers = new Headers();
    for (const name of ['Accept', 'Accept-Language', 'If-None-Match', 'If-Modified-Since', 'Range']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const versionedAsset = host === 'desk.bokdoong.com'
      && incoming.searchParams.has('v')
      && !incoming.pathname.endsWith('/sw.js')
      && /\.(?:js|css|svg|png|ico|webp)$/i.test(incoming.pathname);
    const edgeCacheable = versionedAsset
      && request.method === 'GET'
      && !headers.has('Range');
    if (edgeCacheable) {
      // A browser holding an unverified no-cache copy revalidates; answer with the full,
      // verified body so it can be promoted to immutable instead of revalidating forever.
      headers.delete('If-None-Match');
      headers.delete('If-Modified-Since');
    }
    const edgeCache = edgeCacheable ? globalThis.caches?.default : undefined;
    const cacheKey = new Request(incoming.href);
    if (edgeCache) {
      const cached = await edgeCache.match(cacheKey);
      if (cached) return cached;
    }
    const upstream = await fetch(new Request(originUrl, {
      method: request.method,
      headers,
      redirect: 'manual',
      cache: 'no-store'
    }));
    const responseHeaders = new Headers(upstream.headers);
    if (host === 'bokdoong.com' && upstream.ok) {
      if (incoming.pathname === '/favicon.png') responseHeaders.set('Content-Type', 'image/png');
      if (incoming.pathname === '/favicon.ico') responseHeaders.set('Content-Type', 'image/x-icon');
    }
    // HTML, unversioned assets and unverified versioned assets must revalidate so deployments stay current.
    // A versioned Web2 asset is immutable in the browser and the edge only when its bytes match
    // app/asset-manifest.json for this exact ?v=; old bytes served while a deploy propagates are never pinned.
    let body = upstream.body;
    let immutableAsset = false;
    if (edgeCacheable && upstream.status === 200) {
      body = await upstream.arrayBuffer();
      immutableAsset = await matchesManifest(incoming.pathname, incoming.searchParams.get('v'), body);
    }
    responseHeaders.set(
      'Cache-Control',
      immutableAsset ? 'public, max-age=31536000, immutable' : 'no-cache, must-revalidate'
    );
    const location = responseHeaders.get('Location');
    if (location) {
      const target = new URL(location, originUrl);
      if (target.origin === PAGES_ORIGIN && allowedPath(host, target.pathname)) {
        target.hostname = host;
        if (freshDocument) withoutFreshness(target);
        responseHeaders.set('Location', target.href);
      }
    }
    const webPage = host === 'desk.bokdoong.com'
      && request.method === 'GET'
      && upstream.status === 200
      && /^text\/html\b/i.test(responseHeaders.get('Content-Type') || '');
    if (webPage && !hasCurrentEpoch(request)) {
      responseHeaders.set('Clear-Site-Data', '"cache"');
      responseHeaders.append('Set-Cookie', `${EPOCH_COOKIE}=${CACHE_EPOCH}; Path=/work/app/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax`);
    }
    const response = new Response(body, { status: upstream.status, headers: responseHeaders });
    if (immutableAsset && edgeCache) {
      const stored = edgeCache.put(cacheKey, response.clone());
      if (context?.waitUntil) context.waitUntil(stored); else await stored;
    }
    return response;
  }
};
