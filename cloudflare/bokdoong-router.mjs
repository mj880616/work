const PAGES_ORIGIN = 'https://mj880616.github.io';
const SERVICES = Object.freeze({
  'work.bokdoong.com': { root: '/work/', prefix: '/work/' },
  'desk.bokdoong.com': { root: '/work/app/', prefix: '/work/app/' },
  'read.bokdoong.com': { root: '/read-think-write/', prefix: '/read-think-write/' },
  'arsenal.bokdoong.com': {
    root: '/work/personal/arsenal-match-archive/',
    prefix: '/work/personal/arsenal-match-archive/'
  }
});

function allowedPath(host, path) {
  if (host === 'bokdoong.com') return path === '/' || path === '/favicon.svg' || path === '/favicon.ico';
  return Boolean(SERVICES[host] && path.startsWith(SERVICES[host].prefix));
}

function upstreamPath(host, path) {
  if (host === 'bokdoong.com') {
    if (path === '/favicon.svg' || path === '/favicon.ico') return '/work/personal/portal/favicon.svg';
    return '/work/personal/portal/';
  }
  return path;
}

export default {
  async fetch(request) {
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
    if (incoming.pathname === '/favicon.ico' && (host === 'read.bokdoong.com' || host === 'arsenal.bokdoong.com')) {
      const mark = host === 'read.bokdoong.com' ? 'R' : 'A';
      const color = host === 'read.bokdoong.com' ? '#315d50' : '#a5232a';
      const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${color}"/><text x="16" y="23" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="22" font-weight="700">${mark}</text></svg>`;
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
    originUrl.search = incoming.search;
    const headers = new Headers();
    for (const name of ['Accept', 'Accept-Language', 'If-None-Match', 'If-Modified-Since', 'Range']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    // GitHub Pages publishes mutable files at stable URLs. Bypass Cloudflare's
    // subrequest cache entirely so each request sees the currently deployed origin.
    const upstream = await fetch(new Request(originUrl, {
      method: request.method, headers, redirect: 'manual', cache: 'no-store'
    }));
    if (host === 'read.bokdoong.com' && incoming.pathname !== SERVICES[host].root && upstream.status === 404 &&
        (request.headers.get('Sec-Fetch-Dest') === 'document' || request.headers.get('Accept')?.includes('text/html'))) {
      const recovery = new URL(SERVICES[host].root, incoming);
      recovery.searchParams.set('redirect', incoming.pathname.slice('/read-think-write'.length) + incoming.search);
      return Response.redirect(recovery.href, 302);
    }
    const responseHeaders = new Headers(upstream.headers);
    // The default Cloudflare browser TTL can turn GitHub's 10 minutes into
    // four hours. Require browsers to revalidate every proxied response.
    responseHeaders.set('Cache-Control', 'no-cache, must-revalidate');
    const location = responseHeaders.get('Location');
    if (location) {
      const target = new URL(location, originUrl);
      if (target.origin === PAGES_ORIGIN && allowedPath(host, target.pathname)) {
        target.hostname = host;
        responseHeaders.set('Location', target.href);
      }
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  }
};
