import { WEB2_CSP, WEB2_REFERRER_POLICY, web2CspPage } from './web2-csp.mjs';

const PAGES_ORIGIN = 'https://mj880616.github.io';
const SERVICES = Object.freeze({
  'work.bokdoong.com': { root: '/work/', prefix: '/work/' },
  // Redirect-only since DOMAIN-주소이전 ①-D1: movesToWeb2() sends / and /work/app/** to bokdoong.com first.
  'desk.bokdoong.com': { root: '/work/app/', prefix: '/work/app/' },
  'arsenal.bokdoong.com': {
    root: '/work/personal/arsenal-match-archive/',
    prefix: '/work/personal/arsenal-match-archive/'
  }
});

// DOMAIN-주소이전 ①-D1: Web2 (/work/app/**) is served on bokdoong.com only, with the Web2 rules (HTML freshness,
// verified immutable ?v= assets, once-per-epoch cache clearing). bokdoong.com/ (the old portal) sends visitors
// to Web2. desk.bokdoong.com (/ and /work/app/**) and work.bokdoong.com/work/app/** send visitors to the same path
// and ?query on bokdoong.com with 302; the browser keeps the #fragment. Web1 on work, the share page and arsenal
// are unchanged. The portal favicon stays until the C1 clean-up.
const WEB2_HOST = 'bokdoong.com';
const WEB2_ORIGIN = `https://${WEB2_HOST}`;
const WEB2_PREFIX = '/work/app/';

function web2Path(host, path) {
  return host === WEB2_HOST && path.startsWith(WEB2_PREFIX);
}

function isWeb2Route(path) {
  return path === '/work/app' || path.startsWith(WEB2_PREFIX);
}

function movesToWeb2(host, path) {
  if (host === WEB2_HOST) return path === '/' || path === '/work/app';
  if (host === 'desk.bokdoong.com') return path === '/' || isWeb2Route(path);
  if (host === 'work.bokdoong.com') return isWeb2Route(path);
  return false;
}

// Same path (/ and /work/app become /work/app/) and the same ?query on bokdoong.com.
function web2Redirect(incoming) {
  const target = new URL(WEB2_ORIGIN);
  target.pathname = incoming.pathname.startsWith(WEB2_PREFIX) ? incoming.pathname : WEB2_PREFIX;
  target.search = incoming.search;
  return Response.redirect(target.href, 302);
}

function allowedPath(host, path) {
  if (host === WEB2_HOST) {
    return path === '/favicon.png' || path === '/favicon.ico' || path.startsWith(WEB2_PREFIX);
  }
  return Boolean(SERVICES[host] && path.startsWith(SERVICES[host].prefix));
}

function upstreamPath(host, path) {
  if (host === WEB2_HOST && (path === '/favicon.png' || path === '/favicon.ico')) return `/work/personal/portal${path}`;
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
// (which fetches /work/app/index.html). For Web2 HTML only (bokdoong.com/work/app/), the Worker appends a value that changes
// every 15 seconds to the Pages URL (like ?t= for the manifest). The visitor's URL, the response
// headers and the edge cache key are unchanged; ?v= assets never get it.
const FRESH_PARAM = '__fresh';
const FRESH_WINDOW_MS = 15000;

function web2Document(host, url) {
  return web2Path(host, url.pathname)
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

// SHARE-미리보기제목: link-preview bots (Telegram, KakaoTalk, …) do not run JS and never send what is after #, so a share
// link that should show its page title is /work/share/?t=<link value>. For that address only, and only when the
// request comes from a known preview bot, the Worker asks share-page-read (POST body, never the address) for the
// page and puts its title, HTML-escaped, into og:title/twitter:title/<title>. Nothing else from the page is used.
// Any other case (not a bot, malformed value, unknown/expired/off/draft link, error, slow lookup) gets the shared
// card unchanged, so a preview never tells whether a link exists. The link value is never sent to GitHub Pages,
// never logged (no console calls; Workers Logs are off in wrangler.toml) and these responses are never cached.
const SHARE_PAGE = '/work/share/';
const SHARE_READ_URL = 'https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/share-page-read';
const SHARE_TOKEN = /^[0-9a-f]{64}$/;
// SHARE-보관함·HTML공유: short address = name (a-z 0-9, single hyphens, 2-40) + "-" + 8 letters the DB made (no l·o·0·1).
// Sent as bokdoong.com/s/<it>; people are sent (302) to the share page on work (not the Web2 host), preview bots get the card here.
const SHARE_SLUG = /^(?=[a-z0-9-]{11,49}$)[a-z0-9]+(?:-[a-z0-9]+)*-[a-km-np-z2-9]{8}$/;
const SHORT_PREFIX = '/s/';
export function shortSlugOf(path) {
  if (!path.startsWith(SHORT_PREFIX)) return null;
  const slug = path.slice(SHORT_PREFIX.length).replace(/\/$/, '');
  return SHARE_SLUG.test(slug) && slug.slice(0, -9).length >= 2 ? slug : null;
}
export const SHARE_TITLE_TIMEOUT_MS = 1500;
const SHARE_READ_MAX_CHARS = 600000;
const SHARE_TITLE_MAX = 200;
// Link-preview fetchers only. Search engine crawlers are left out on purpose (the page is noindex).
const PREVIEW_BOT = /TelegramBot|kakaotalk-scrap|facebookexternalhit|Facebot|Twitterbot|Slackbot|Discordbot|WhatsApp|LinkedInBot|SkypeUriPreview|line-poker|Iframely|Embedly|redditbot|vkShare/i;

function shareTokenOf(url) {
  const values = url.searchParams.getAll('t');
  return values.length === 1 && SHARE_TOKEN.test(values[0]) ? values[0] : null;
}
// What the preview lookup asks for: {token} from ?t= or {slug} from ?s= (exactly one, well formed), else null.
function shareAskOf(url) {
  const token = shareTokenOf(url);
  if (token) return { token };
  const values = url.searchParams.getAll('s');
  if (url.searchParams.has('t') || values.length !== 1) return null;
  return shortSlugOf(SHORT_PREFIX + values[0]) ? { slug: values[0] } : null;
}

function previewBot(request) {
  return PREVIEW_BOT.test(request.headers.get('User-Agent') || '');
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

// Resolves to the page title or null; never rejects and never waits longer than SHARE_TITLE_TIMEOUT_MS.
// ask is {token} or {slug}; head:true asks for the title only (an HTML page can be 5MB).
function shareTitle(ask, timeoutMs = SHARE_TITLE_TIMEOUT_MS) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => { controller.abort(); resolve(null); }, timeoutMs);
  });
  const lookup = (async () => {
    const response = await fetch(new Request(SHARE_READ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...ask, head: true }),
      redirect: 'manual',
      signal: controller.signal
    }));
    if (response.status !== 200) return null;
    if (Number(response.headers.get('Content-Length')) > SHARE_READ_MAX_CHARS) return null;
    const text = await response.text();
    if (text.length > SHARE_READ_MAX_CHARS) return null;
    const data = JSON.parse(text);
    const title = data && data.ok === true && data.page && typeof data.page.title === 'string' ? data.page.title.trim() : '';
    return title && title.length <= SHARE_TITLE_MAX && !/[\u0000-\u001f\u007f]/.test(title) ? title : null;
  })().catch(() => null);
  return Promise.race([lookup, timeout]).finally(() => clearTimeout(timer));
}

export function withShareTitle(html, title) {
  const safe = escapeHtml(title);
  // Replacement functions, so "$&" and similar in a title stay literal.
  return html
    .replace(/<meta property="og:title" content="[^"]*">/, () => `<meta property="og:title" content="${safe}">`)
    .replace(/<meta name="twitter:title" content="[^"]*">/, () => `<meta name="twitter:title" content="${safe}">`)
    .replace(/<title>[^<]*<\/title>/, () => `<title>${safe} · 공유 페이지</title>`)
    // The shared og:url would let a preview service merge every link into one card.
    .replace(/<meta property="og:url" content="[^"]*">\n?/, '');
}

async function sharePreview(upstreamRequest, ask) {
  const [upstream, title] = await Promise.all([fetch(upstreamRequest), shareTitle(ask)]);
  const headers = new Headers(upstream.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  headers.set('Referrer-Policy', 'no-referrer');
  if (upstream.status !== 200 || !/^text\/html\b/i.test(headers.get('Content-Type') || '')) {
    return new Response(upstream.body, { status: upstream.status, headers });
  }
  const html = await upstream.text();
  for (const name of ['Content-Length', 'Content-Encoding', 'ETag', 'Last-Modified']) headers.delete(name);
  return new Response(title ? withShareTitle(html, title) : html, { status: 200, headers });
}

export function resetManifestMemo() {
  manifestMemo = null;
}

export default {
  async fetch(request, env, context) {
    const incoming = new URL(request.url);
    const host = incoming.hostname.toLowerCase();
    if (!SERVICES[host] && host !== WEB2_HOST) return new Response('Not found', { status: 404 });
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
    if (movesToWeb2(host, incoming.pathname)) return web2Redirect(incoming);
    if (incoming.pathname === '/' && SERVICES[host]) {
      incoming.pathname = SERVICES[host].root;
      return Response.redirect(incoming.href, 302);
    }
    if ((host === WEB2_HOST || host === 'desk.bokdoong.com') && incoming.pathname.startsWith('/work/') && !isWeb2Route(incoming.pathname)) {
      incoming.hostname = 'work.bokdoong.com';
      return Response.redirect(incoming.href, 302);
    }
    // SHARE-보관함·HTML공유: bokdoong.com/s/<short address>. A malformed one is 404 (nothing is looked up).
    if (host === WEB2_HOST && incoming.pathname.startsWith(SHORT_PREFIX)) {
      const slug = shortSlugOf(incoming.pathname);
      if (!slug || incoming.search) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive' } });
      if (request.method === 'GET' && previewBot(request)) {
        return sharePreview(new Request(new URL(SHARE_PAGE, PAGES_ORIGIN), { method: 'GET', headers: { Accept: 'text/html' }, redirect: 'manual', cache: 'no-store' }), { slug });
      }
      return new Response(null, { status: 302, headers: {
        Location: `https://work.bokdoong.com${SHARE_PAGE}?s=${slug}`,
        'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow, noarchive' } });
    }
    const sharePage = host === 'work.bokdoong.com' && incoming.pathname === SHARE_PAGE;
    if (host === 'work.bokdoong.com' && incoming.pathname === '/work/share' && (incoming.searchParams.has('t') || incoming.searchParams.has('s'))) {
      // GitHub Pages would add the slash but drop the link value (it is never sent there).
      incoming.pathname = SHARE_PAGE;
      return Response.redirect(incoming.href, 301);
    }
    if (!allowedPath(host, incoming.pathname)) return new Response('Not found', { status: 404 });

    const originUrl = new URL(upstreamPath(host, incoming.pathname), PAGES_ORIGIN);
    const freshDocument = web2Document(host, incoming);
    originUrl.search = freshDocument ? withFreshness(incoming.search) : incoming.search;
    const shareAsk = sharePage ? shareAskOf(incoming) : null;
    // The share page is one static file: nothing after ? is needed by Pages, and it may hold a link value.
    if (sharePage) originUrl.search = '';
    const headers = new Headers();
    for (const name of ['Accept', 'Accept-Language', 'If-None-Match', 'If-Modified-Since', 'Range']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const versionedAsset = web2Path(host, incoming.pathname)
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
    if (shareAsk && request.method === 'GET' && previewBot(request)) {
      // The bot gets the full page every time: no conditional or partial answers to rewrite.
      for (const name of ['If-None-Match', 'If-Modified-Since', 'Range']) headers.delete(name);
      return sharePreview(new Request(originUrl, { method: 'GET', headers, redirect: 'manual', cache: 'no-store' }), shareAsk);
    }
    const upstream = await fetch(new Request(originUrl, {
      method: request.method,
      headers,
      redirect: 'manual',
      cache: 'no-store'
    }));
    const responseHeaders = new Headers(upstream.headers);
    if (host === WEB2_HOST && upstream.ok) {
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
      immutableAsset ? 'public, max-age=31536000, immutable' : (sharePage && incoming.search ? 'no-store' : 'no-cache, must-revalidate')
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
    const webPage = web2Path(host, incoming.pathname)
      && request.method === 'GET'
      && upstream.status === 200
      && /^text\/html\b/i.test(responseHeaders.get('Content-Type') || '');
    if (webPage && !hasCurrentEpoch(request)) {
      responseHeaders.set('Clear-Site-Data', '"cache"');
      responseHeaders.append('Set-Cookie', `${EPOCH_COOKIE}=${CACHE_EPOCH}; Path=/work/app/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax`);
    }
    // SEC-Web2CSP 1단계: Web2 첫 화면·로그인 화면에만 보고 전용 CSP(막지 않음)와 Referrer-Policy. 304에도 붙여 저장된 헤더를 갱신한다.
    if (web2Path(host, incoming.pathname) && web2CspPage(incoming.pathname) && (upstream.status === 200 || upstream.status === 304)) {
      responseHeaders.set('Content-Security-Policy-Report-Only', WEB2_CSP);
      responseHeaders.set('Referrer-Policy', WEB2_REFERRER_POLICY);
    }
    const response = new Response(body, { status: upstream.status, headers: responseHeaders });
    if (immutableAsset && edgeCache) {
      const stored = edgeCache.put(cacheKey, response.clone());
      if (context?.waitUntil) context.waitUntil(stored); else await stored;
    }
    return response;
  }
};
