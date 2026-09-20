const PAGES_ORIGIN = 'https://mj880616.github.io';
const SERVICES = Object.freeze({
  'work.bokdoong.com': { root: '/work/', prefix: '/work/' },
  'desk.bokdoong.com': { root: '/work/app/', prefix: '/work/' },
  'read.bokdoong.com': { root: '/read-think-write/', prefix: '/read-think-write/' },
  'arsenal.bokdoong.com': {
    root: '/work/personal/arsenal-match-archive/',
    prefix: '/work/personal/arsenal-match-archive/'
  }
});

function allowedPath(host, path) {
  if (host === 'bokdoong.com') return path === '/';
  return Boolean(SERVICES[host] && path.startsWith(SERVICES[host].prefix));
}

function upstreamPath(host, path) {
  return host === 'bokdoong.com' ? '/work/personal/portal/' : path;
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
    if (incoming.pathname === '/' && host !== 'bokdoong.com') {
      incoming.pathname = SERVICES[host].root;
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
    const upstream = await fetch(new Request(originUrl, { method: request.method, headers, redirect: 'manual' }));
    const responseHeaders = new Headers(upstream.headers);
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
