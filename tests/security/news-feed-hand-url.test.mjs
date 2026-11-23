// S68-39 NEWS-직접넣기원문주소: news-feed ?action=hand_fill 몸통의 url(선택) — 손으로 넣는 기사에 원문 주소를 넣거나 바로잡는다.
// 시험: 주소 모양 검사(http·https만, 거절 목록·길이·빈칸 → 400 INVALID_URL, 쓰기 없음), http는 https로, 같은 주소면 그대로,
// 다른 공용 기사가 이미 그 주소면 409 URL_TAKEN(쓰기 없음), 바뀌면 공용 기사 url·url_key + 내 옛 줄만(다른 작업공간 줄 안 건드림),
// 권한은 그대로(로그인·운영자 기능 키·읽을 수 있는 공용 기사만), 바깥 사이트 안 읽음. 네트워크 없음(합성 글·example 주소).
import test from 'node:test';
import assert from 'node:assert/strict';

const H = await import('../../supabase/functions/news-feed/handler.ts');
const NOW = Date.parse('2026-11-19T00:00:00Z');
const SB = 'https://synthetic.supabase.test', SECRET = 'synthetic-news-feed-cron-secret-0123456789abc';
const WS = 'a0000000-0000-4000-8000-000000000001', OTHER = 'a0000000-0000-4000-8000-000000000002';
const USER = 'b0000000-0000-4000-8000-000000000001', JWT = 'synthetic.user.jwt-owner-0001';
const ART = 'c0000000-0000-4000-8000-000000000010', OLD = 'd0000000-0000-4000-8000-000000000010', HIDDEN = 'c0000000-0000-4000-8000-000000000099';
const FN = `${SB}/functions/v1/news-feed`;
const baseArt = extra => ({id: ART, origin: 'tg_room', lane: 'channel', url: 'https://news.example.org/a/1', url_key: 'news.example.org/a/1', title: null, title_key: null, lang: 'ko', publisher: null,
  published_at: null, state: 'failed', fetched_at: '2026-11-18T22:35:00Z', summary: null, body: null, body_kind: null, title_ko: null, body_ko: null, translated_at: null, source_key: null, ...extra});

function world({articles = [baseArt()], olds = [], bodies = [], details = [], newsWs = WS, members = [{user_id: USER, workspace_id: WS}]} = {}) {
  const db = {app_news_articles: structuredClone(articles), app_news_article_bodies: structuredClone(bodies), app_news_items: structuredClone(olds), app_feed_bodies: [],
    app_news_now_details: structuredClone(details), app_now_details: structuredClone(details.map(d => ({workspace_id: d.workspace_id, news_item_id: OLD})))};
  const calls = {site: 0, ai: 0, writes: []};
  const res = (v, s = 200) => new Response(v === null ? null : JSON.stringify(v), {status: s, headers: {'content-type': 'application/json'}});
  const doFetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method ?? 'GET', body = init.body ? JSON.parse(init.body) : undefined;
    if (u.origin !== SB) { calls.site++; calls.ai += /openai/.test(u.host) ? 1 : 0; return new Response('', {status: 404}); }
    if (u.pathname === '/auth/v1/user') return init.headers.Authorization === `Bearer ${JWT}` ? res({id: USER}) : res({}, 401);
    const p = u.pathname.replace('/rest/v1/', '');
    const user = init.headers?.apikey === 'synthetic-anon';
    if (user) {
      // 사용자 로그인 읽기(RLS 흉내): 지도 함수는 빈 답, 공용 기사는 HIDDEN 말고 읽힘.
      if (p === 'rpc/app_news_article_of') return res([]);
      if (p === 'app_news_articles') { const id = u.searchParams.get('id')?.slice(3); return res(db.app_news_articles.filter(a => a.id === id && a.id !== HIDDEN)); }
      throw new Error('unexpected user read ' + p);
    }
    if (p === 'app_workspace_members') return res(members.filter(m => `eq.${m.user_id}` === u.searchParams.get('user_id')).map(m => ({workspace_id: m.workspace_id})));
    if (p === 'rpc/app_operator_feature_workspace') return res(body?.p_feature === 'outside' ? newsWs : null);
    const t = db[p];
    if (!t) throw new Error('unexpected table ' + method + ' ' + p);
    if (method !== 'GET') calls.writes.push({method, p, q: decodeURIComponent(u.search), body});
    const f = [...u.searchParams].filter(([k]) => !['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k));
    const pick = () => t.filter(r => f.every(([k, v]) => {
      const val = decodeURIComponent(v);
      if (val.startsWith('in.(')) return val.slice(4, -1).split(',').includes(String(r[k] ?? ''));
      return String(r[k] ?? '') === val.slice(3);
    }));
    if (method === 'GET') return res(pick().slice(0, Number(u.searchParams.get('limit') || 1000)));
    if (method === 'PATCH') { for (const r of pick()) Object.assign(r, body); return res(null, 204); }
    if (method === 'DELETE') { const gone = new Set(pick()); db[p] = t.filter(r => !gone.has(r)); return res(null, 204); }
    if (method === 'POST') {
      const key = u.searchParams.get('on_conflict');
      const hit = key ? t.find(r => key.split(',').every(k => r[k] === body[k])) : null;
      if (hit) Object.assign(hit, body); else t.push(body);
      return res(null, 201);
    }
    return res(null, 204);
  };
  const handler = H.createNewsFeedHandler({env: k => ({SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key', SUPABASE_ANON_KEY: 'synthetic-anon', NEWS_FEED_CRON_SECRET: SECRET})[k],
    fetch: doFetch, now: () => NOW, sleep: async () => {}, log: () => {}});
  const call = (body, {auth = `Bearer ${JWT}`, headers = {}, raw = null} = {}) =>
    handler(new Request(`${FN}?action=hand_fill`, {method: 'POST', headers: {'content-type': 'application/json', ...(auth ? {authorization: auth} : {}), ...headers}, body: raw ?? JSON.stringify(body)}));
  return {db, calls, call};
}
const out = async r => ({status: r.status, body: await r.json()});
const HEAD = {id: ART, title: '합성 기사 제목', publisher: '합성 매체', author: null, published_at: null};
const OLD_ROW = {id: OLD, workspace_id: WS, lane: 'channel', url: 'https://news.example.org/a/1', url_key: 'news.example.org/a/1', title: null, state: 'failed', fetched_at: null};
const OTHER_ROW = {id: 'd0000000-0000-4000-8000-000000000011', workspace_id: OTHER, lane: 'channel', url: 'https://news.example.org/a/1', url_key: 'news.example.org/a/1', title: null, state: 'failed', fetched_at: null};

test('hand_fill url: bad addresses are refused before any write', async () => {
  const w = world({olds: [OLD_ROW]});
  const bad = ['javascript:alert(1)', 'ftp://news.example.org/a', 'news.example.org/a/2', 'https://news.example.org/a b', 'https://bit.ly/abc', 'https://t.me/x/1',
    'https://user:pw@news.example.org/a', 'https://localhost/a', `https://news.example.org/${'a'.repeat(2001)}`, 7, {}, ['https://news.example.org/a/2']];
  for (const url of bad) assert.deepEqual(await out(await w.call({...HEAD, url})), {status: 400, body: {ok: false, error: 'INVALID_URL'}}, String(url).slice(0, 60));
  assert.equal(w.calls.writes.length, 0);
  assert.equal(w.calls.site, 0);
  assert.deepEqual(w.db.app_news_articles[0], baseArt());
});

test('hand_fill url: login, the operator feature key and a readable article are still required', async () => {
  const w = world();
  assert.equal((await w.call({...HEAD, url: 'https://news.example.org/a/2'}, {auth: null})).status, 401);
  const v = world({newsWs: OTHER});
  assert.deepEqual(await out(await v.call({...HEAD, url: 'https://news.example.org/a/2'})), {status: 403, body: {ok: false, error: 'FEATURE_OFF'}});
  assert.equal(v.calls.writes.length, 0);
  const h = world({articles: [baseArt(), baseArt({id: HIDDEN, url_key: 'news.example.org/h', url: 'https://news.example.org/h', origin: 'tg_scrap'})]});
  assert.deepEqual(await out(await h.call({...HEAD, id: HIDDEN, url: 'https://news.example.org/a/2'})), {status: 404, body: {ok: false, error: 'NOT_FOUND'}});
  assert.equal(h.calls.writes.length, 0);
  assert.equal(h.db.app_news_articles[1].url, 'https://news.example.org/h');
});

test('hand_fill url: a new address moves the shared article and my old row only; http becomes https; nothing is fetched', async () => {
  const w = world({olds: [OLD_ROW, OTHER_ROW]});
  const r = await out(await w.call({...HEAD, url: '  http://news.example.org/a/2  ', body: '손으로 넣은 본문.'}));
  assert.deepEqual(r, {status: 200, body: {ok: true, status: 'filled', id: ART}});
  const a = w.db.app_news_articles[0];
  assert.equal(a.url, 'https://news.example.org/a/2');
  assert.equal(a.url_key, H.saveTarget('https://news.example.org/a/2').key);
  assert.equal(a.title, '합성 기사 제목'); assert.ok(a.manual_at);
  assert.equal(w.db.app_news_items[0].url, 'https://news.example.org/a/2');
  assert.equal(w.db.app_news_items[0].url_key, a.url_key);
  assert.deepEqual(w.db.app_news_items[1], OTHER_ROW, 'another workspace row is untouched');
  assert.ok(w.calls.writes.filter(x => x.p === 'app_news_items').every(x => x.q.includes(`workspace_id=eq.${WS}`)));
  assert.equal(w.calls.writes.some(x => x.p === 'app_reading_items'), false);
  assert.equal(w.calls.site, 0); assert.equal(w.calls.ai, 0);
});

test('hand_fill url: the same address (or empty / null) keeps url and url_key as they are', async () => {
  for (const url of ['https://news.example.org/a/1', 'http://news.example.org/a/1', '', '   ', null]) {
    const w = world();
    assert.equal((await w.call({...HEAD, url})).status, 200, String(url));
    const a = w.db.app_news_articles[0];
    assert.equal(a.url, 'https://news.example.org/a/1'); assert.equal(a.url_key, 'news.example.org/a/1');
    const patch = w.calls.writes.find(x => x.p === 'app_news_articles');
    assert.equal('url' in patch.body, false); assert.equal('url_key' in patch.body, false);
  }
});

test('hand_fill url: an address another shared article already has is refused with 409 and nothing is written', async () => {
  const two = 'c0000000-0000-4000-8000-000000000020';
  const w = world({articles: [baseArt(), baseArt({id: two, url: 'https://news.example.org/a/2', url_key: H.saveTarget('https://news.example.org/a/2').key})], olds: [OLD_ROW]});
  assert.deepEqual(await out(await w.call({...HEAD, url: 'https://news.example.org/a/2', body: '본문.'})), {status: 409, body: {ok: false, error: 'URL_TAKEN'}});
  assert.equal(w.calls.writes.length, 0);
  assert.deepEqual(w.db.app_news_articles[0], baseArt());
});

test('hand_fill url: parse keeps url optional and checks it like save_url', () => {
  assert.equal(H.parseHandFill({...HEAD}, NOW).url, null);
  assert.deepEqual(H.parseHandFill({...HEAD, url: 'https://news.example.org/a/9?utm_source=x'}, NOW).url, H.saveTarget('https://news.example.org/a/9?utm_source=x'));
  assert.equal(H.HAND_LIMITS.url, 2000);
});
