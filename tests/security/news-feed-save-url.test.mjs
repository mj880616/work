// S62-22 APP-공유로뉴스보관 ②: news-feed ?action=save_url — 폰 공유로 받은 기사 주소 하나를 그 사람 News 보관에.
// 거절 시험: 로그인 없음·owner 아님·주소(내부·IP·포트·문서·텔레그램·단축·평문 아닌 스킴·너무 김)·몸통 칸·하루 상한·리다이렉트로 내부.
// 네트워크 없음(합성 글·example 주소). 서버 함수 app_news_user_save는 흉내(실제 DB 시험은 tests/auth-handoff/news-user-save-db.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';

const H = await import('../../supabase/functions/news-feed/handler.ts');
const NOW = Date.parse('2026-11-15T03:00:00Z');
const SB = 'https://synthetic.supabase.test', SECRET = 'synthetic-news-feed-cron-secret-0123456789abc';
const WS = 'a0000000-0000-4000-8000-000000000002', OP = 'a0000000-0000-4000-8000-000000000001';
const USER = 'b0000000-0000-4000-8000-000000000002', JWT = 'synthetic.user.jwt-owner-0002';
const FN = `${SB}/functions/v1/news-feed`;
const LONG = '합성 도시의 노동자들이 오늘 안전 인력 부족에 항의해 작업을 멈췄다. '.repeat(12);
const PAGE = `<html lang="ko"><head><meta property="og:title" content="합성 파업 기사"><meta property="og:site_name" content="합성 매체"></head><body><article><p>${LONG}</p></article></body></html>`;
const PAYWALL = `<html lang="ko"><head><meta property="og:title" content="합성 유료 기사"><meta property="og:description" content="합성 리드 한 문단."></head><body><div class="paywall">구독</div><article><p>${LONG}</p></article></body></html>`;
const BOT = '<html><head><title>Just a moment...</title></head><body>Checking your browser before accessing. Enable JavaScript and cookies to continue</body></html>';
const uuid = n => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function world({sites = {}, members = [{user_id: USER, workspace_id: WS}], articles = [], days = [], failRpc = false, newsWs = members[0]?.workspace_id ?? null} = {}) {
  const db = {app_news_articles: structuredClone(articles), app_news_marks: [], app_news_days: structuredClone(days), app_news_article_bodies: []};
  const calls = {site: [], rest: [], rpc: []};
  let n = 100;
  const res = (v, s = 200) => new Response(v === null ? null : JSON.stringify(v), {status: s, headers: {'content-type': 'application/json'}});
  const doFetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method ?? 'GET', body = init.body ? JSON.parse(init.body) : undefined;
    if (u.origin !== SB) {
      calls.site.push(u.href);
      const s = sites[u.href];
      if (s === undefined) return new Response('', {status: 404});
      if (s.redirect) return new Response('', {status: 302, headers: {location: s.redirect}});
      return new Response(s, {status: 200, headers: {'content-type': 'text/html'}});
    }
    if (u.pathname === '/auth/v1/user') return init.headers.Authorization === `Bearer ${JWT}` ? res({id: USER}) : res({}, 401);
    const p = u.pathname.replace('/rest/v1/', '');
    calls.rest.push({method, p, q: u.search, body});
    if (p === 'app_workspace_members') return res(members.filter(m => `eq.${m.user_id}` === u.searchParams.get('user_id')).map(m => ({workspace_id: m.workspace_id})));
    // NEWS-운영자만(S63-03): 'outside' 키 작업공간(기본은 누르는 사람).
    if (p === 'rpc/app_operator_feature_workspace') return res(body?.p_feature === 'outside' ? newsWs : null);
    if (p === 'rpc/app_news_user_save') {
      calls.rpc.push(body);
      if (failRpc) return res({message: 'x'}, 400);
      const hit = db.app_news_articles.find(a => a.url_key === body.p_url_key);
      if (hit?.origin === 'tg_scrap' && body.p_workspace !== OP) return res({code: '42501', message: 'NEWSSAVE_UNAVAILABLE'}, 403);
      let art = hit, created = false;
      if (!art) {
        if (body.p_page === null) return res({ok: true, found: false});
        art = {id: uuid(n++), origin: 'user', lane: 'channel', url: body.p_url, url_key: body.p_url_key, ...body.p_page};
        db.app_news_articles.push(art); created = true;
      }
      const m = db.app_news_marks.find(x => x.workspace_id === body.p_workspace && x.article_id === art.id);
      if (m) { m.starred_at ??= 'now'; m.hidden_at = null; } else db.app_news_marks.push({workspace_id: body.p_workspace, article_id: art.id, starred_at: 'now'});
      return res({ok: true, found: true, created, article_id: art.id, state: art.state});
    }
    const t = db[p];
    if (!t) throw new Error('unexpected table ' + method + ' ' + p);
    const f = [...u.searchParams].filter(([k]) => !['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k));
    const pick = () => t.filter(r => f.every(([k, v]) => String(r[k] ?? '') === decodeURIComponent(v.slice(3))));
    if (method === 'GET') return res(pick().slice(0, Number(u.searchParams.get('limit') || 1000)));
    if (method === 'PATCH') { for (const r of pick()) Object.assign(r, body); return res(null, 204); }
    if (method === 'POST') { t.push(body); return res(null, 201); }
    return res(null, 204);
  };
  const handler = H.createNewsFeedHandler({env: k => ({SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key', SUPABASE_ANON_KEY: 'synthetic-anon', NEWS_FEED_CRON_SECRET: SECRET})[k],
    fetch: doFetch, now: () => NOW, sleep: async () => {}, log: () => {}});
  const call = (body, {auth = `Bearer ${JWT}`, action = 'save_url', headers = {}} = {}) =>
    handler(new Request(`${FN}?action=${action}`, {method: 'POST', headers: {'content-type': 'application/json', ...(auth ? {authorization: auth} : {}), ...headers}, body: JSON.stringify(body)}));
  return {db, calls, call};
}
const out = async r => ({status: r.status, body: await r.json()});

test('save_url: login and owner required; cron key cannot use it', async () => {
  const w = world({sites: {'https://news.example.org/a/1': PAGE}});
  assert.equal((await w.call({url: 'https://news.example.org/a/1'}, {auth: null})).status, 401);
  assert.equal((await w.call({url: 'https://news.example.org/a/1'}, {auth: 'Bearer bad.jwt.value-000000000000'})).status, 401);
  assert.deepEqual(await out(await w.call({url: 'https://news.example.org/a/1'}, {auth: null, headers: {'x-news-feed-cron-secret': SECRET}})), {status: 400, body: {ok: false, error: 'UNKNOWN_ACTION'}});
  for (const members of [[], [{user_id: USER, workspace_id: WS}, {user_id: USER, workspace_id: OP}]]) {
    const v = world({members, sites: {'https://news.example.org/a/1': PAGE}});
    assert.equal((await v.call({url: 'https://news.example.org/a/1'})).status, 403);
    assert.equal(v.calls.site.length, 0);assert.equal(v.calls.rpc.length, 0);
  }
  assert.equal(w.calls.site.length, 0);
});

test('save_url: refused addresses and bodies never fetch and never reach the database function', async () => {
  const w = world();
  const bad = ['https://127.0.0.1/a', 'https://10.0.0.1/a', 'http://192.168.0.1/a', 'https://[::1]/a', 'https://localhost/a', 'https://intra/a', 'https://srv.internal/a',
    'https://a.local/a', 'https://news.example.org:8443/a', 'https://user:pw@news.example.org/a', 'ftp://news.example.org/a', 'javascript:alert(1)', 'file:///etc/passwd',
    'https://docs.google.com/document/d/x', 'https://drive.google.com/file/d/x', 'https://t.me/channel/1', 'https://naver.me/abc', 'https://bit.ly/abc',
    'https://desk.bokdoong.com/app/', 'https://abc.supabase.co/rest/v1/x', 'https://2130706433/a', 'https://0x7f000001/a', '', '   ', 'https://news.example.org/' + 'a'.repeat(2100)];
  for (const url of bad) assert.deepEqual(await out(await w.call({url})), {status: 400, body: {ok: false, error: 'URL_REFUSED'}}, url);
  for (const body of [{}, {url: 1}, {url: null}, {url: 'https://news.example.org/a', workspace_id: OP}, {url: 'https://news.example.org/a', origin: 'tg_scrap'}, []])
    assert.equal((await w.call(body)).status, 400, JSON.stringify(body));
  assert.equal(w.calls.site.length, 0);assert.equal(w.calls.rpc.length, 0);
  assert.equal(w.db.app_news_days.length, 0, '거절은 하루 횟수를 쓰지 않음');
});

test('save_url: new article read once (http → https, tracking dropped), saved and starred; same address again = same row, no fetch', async () => {
  const w = world({sites: {'https://news.example.org/a/1': PAGE}});
  const a = await out(await w.call({url: 'http://news.example.org/a/1?utm_source=share#top'}));
  assert.equal(a.status, 200);assert.equal(a.body.status, 'saved');assert.match(a.body.id, /^c0000000-/);
  assert.deepEqual(Object.keys(a.body).sort(), ['id', 'ok', 'status'], '응답에 제목·주소·본문 없음');
  assert.deepEqual(w.calls.site.filter(u => !u.endsWith('/robots.txt')), ['https://news.example.org/a/1']);
  const art = w.db.app_news_articles[0];
  assert.equal(art.url, 'https://news.example.org/a/1');assert.equal(art.url_key, 'news.example.org/a/1');
  assert.equal(art.title, '합성 파업 기사');assert.equal(art.publisher, '합성 매체');assert.equal(art.body_kind, 'full');assert.equal(art.state, 'ok');
  assert.equal(w.db.app_news_article_bodies.length, 1);
  assert.deepEqual(w.calls.rpc.map(r => [r.p_workspace, r.p_page === null]), [[WS, true], [WS, false]], '작업공간은 서버가 정한 것');
  const before = w.calls.site.length;
  const b = await out(await w.call({url: 'https://www.news.example.org/a/1/'}));
  assert.equal(b.body.id, a.body.id);assert.equal(w.calls.site.length, before, '같은 기사 — 원문을 다시 읽지 않음');
  assert.equal(w.db.app_news_articles.length, 1);assert.equal(w.db.app_news_marks.length, 1);
  assert.equal(w.db.app_news_days[0].save_n, 2);
  assert.ok(w.calls.rest.every(c => ['app_workspace_members', 'app_news_days', 'app_news_articles', 'app_news_article_bodies', 'rpc/app_news_user_save', 'rpc/app_operator_feature_workspace'].includes(c.p)),
    '텔레그램·가족·통화 표로 가는 요청 없음');
});

test('save_url: paywall keeps the lead only; bot check and unreadable pages keep address only (no_body)', async () => {
  const w = world({sites: {'https://news.example.org/p/1': PAYWALL, 'https://news.example.org/b/1': BOT}});
  assert.equal((await out(await w.call({url: 'https://news.example.org/p/1'}))).body.status, 'saved');
  const pay = w.db.app_news_articles.find(a => a.url_key === 'news.example.org/p/1');
  assert.equal(pay.state, 'paywall');assert.equal(pay.body_kind, 'lead');assert.equal(pay.body, '합성 리드 한 문단.');
  assert.equal((await out(await w.call({url: 'https://news.example.org/b/1'}))).body.status, 'no_body');
  const bot = w.db.app_news_articles.find(a => a.url_key === 'news.example.org/b/1');
  assert.deepEqual([bot.state, bot.title, bot.body, bot.body_kind], ['bot_check', null, null, null]);
  assert.equal((await out(await w.call({url: 'https://news.example.org/missing'}))).body.status, 'no_body');
  assert.equal(w.db.app_news_articles.find(a => a.url_key === 'news.example.org/missing').state, 'failed');
});

test('save_url: a redirect into an internal address is not followed', async () => {
  const w = world({sites: {'https://news.example.org/r/1': {redirect: 'http://169.254.169.254/latest/meta-data'}, 'https://news.example.org/r/2': {redirect: 'https://localhost/x'}}});
  for (const url of ['https://news.example.org/r/1', 'https://news.example.org/r/2']) assert.equal((await out(await w.call({url}))).body.status, 'no_body');
  assert.ok(w.calls.site.every(u => u.startsWith('https://news.example.org/')), w.calls.site.join(' '));
  assert.ok(w.db.app_news_articles.every(a => a.state === 'blocked'));
});

test('save_url: daily cap per person; telegram scrap row is unavailable to others; store failure is 503', async () => {
  const w = world({days: [{workspace_id: WS, day: '2026-11-15', save_n: H.SAVE_DAILY}], sites: {'https://news.example.org/a/1': PAGE}});
  assert.deepEqual(await out(await w.call({url: 'https://news.example.org/a/1'})), {status: 429, body: {ok: false, error: 'DAILY_LIMIT'}});
  assert.equal(w.calls.site.length, 0);assert.equal(w.calls.rpc.length, 0);
  const s = world({articles: [{id: uuid(1), origin: 'tg_scrap', lane: 'channel', url: 'https://news.example.org/s/1', url_key: 'news.example.org/s/1', state: 'pending'}]});
  assert.deepEqual(await out(await s.call({url: 'https://news.example.org/s/1'})), {status: 409, body: {ok: false, error: 'UNAVAILABLE'}});
  assert.equal(s.db.app_news_marks.length, 0);assert.equal(s.calls.site.length, 0);
  const f = world({failRpc: true});
  assert.equal((await f.call({url: 'https://news.example.org/a/9'})).status, 503);
});

test("NEWS-운영자만(S63-03): 'outside' 키가 없는 사람의 공유 보관은 원문 읽기·저장 없이 403", async () => {
  const w = world({sites: {'https://news.example.org/a/1': PAGE}, newsWs: OP});
  const r = await w.call({url: 'https://news.example.org/a/1'});
  assert.equal(r.status, 403);
  assert.equal(w.calls.site.length, 0); assert.equal(w.calls.rpc.length, 0);
  assert.equal(w.db.app_news_articles.length, 0); assert.equal(w.db.app_news_days.length, 0);
});
