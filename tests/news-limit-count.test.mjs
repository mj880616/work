// S69-72(사용자 11/24 "내가 60번, 40번을 쓴 적이 없어"): 하루 한도는 사람이 실제로 쓴 것만 센다.
// - 읽기(news-feed fetch_n, OPEN_DAILY): 사람이 글을 눌러 사이트를 실제로 새로 읽은 횟수만. 한 번 열기 = 1(전에는 2),
//   수집 때 읽기(대기 기사·영상) = 0, 못 읽음 = 0, 이미 읽힌 글 다시 열기 = 0, 한도에 닿으면 사이트를 읽지 않고 429.
// - 상세(ai-assist now_detail, NOW_DETAIL_DAILY): 그날 AI로 새로 만든 상세(full)만. 저장본 다시 보기 = 0, AI 한도에 걸려 AI 없이 남긴 줄 = 0.
// 한도 숫자는 그대로(바꿀지는 사용자 결정 대기). 네트워크 없음(합성 글·example 주소).
import test from 'node:test';
import assert from 'node:assert/strict';

const H = await import('../supabase/functions/news-feed/handler.ts');
const D = await import('../supabase/functions/ai-assist/now-detail.ts');
const NOW = Date.parse('2026-11-24T03:00:00Z');
const DAY = '2026-11-24';
const SB = 'https://synthetic.supabase.test', SECRET = 'synthetic-news-feed-cron-secret-0123456789abc', ANON = 'synthetic-anon-key';
const WS = 'a0000000-0000-4000-8000-000000000001', USER = 'b0000000-0000-4000-8000-000000000001', JWT = 'synthetic.user.jwt-owner-0001';
const FN = `${SB}/functions/v1/news-feed`;
const id = n => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LONG = '합성 도시의 노동자들이 오늘 안전 인력 부족에 항의해 일손을 멈췄다. '.repeat(12);
const PAGE = `<html lang="ko"><head><meta property="og:title" content="합성 파업 기사"></head><body><article><p>${LONG}</p></article></body></html>`;
const recent = new Date(NOW - 3600000).toISOString();

const res = (v, s = 200) => new Response(v === null ? null : JSON.stringify(v), {status: s, headers: {'content-type': 'application/json'}});
// 아주 작은 PostgREST 흉내: eq·neq·is·in·gte·lt 거르기와 or(…gte…) 묶음, select·order·limit, POST(merge/ignore), PATCH.
function cellTest(row, k, v) {
  if (k === 'or') {
    const parts = v.slice(1, -1).split(',');
    return parts.some(p => { const i = p.indexOf('.'); return cellTest(row, p.slice(0, i), p.slice(i + 1)); });
  }
  const neg = v.startsWith('not.'); if (neg) v = v.slice(4);
  const i = v.indexOf('.'), op = v.slice(0, i), val = v.slice(i + 1), cell = row[k];
  let ok;
  if (op === 'eq') ok = String(cell ?? '') === val;
  else if (op === 'neq') ok = String(cell ?? '') !== val;
  else if (op === 'is') ok = val === 'null' ? cell == null : val === 'true' ? cell === true : cell === false;
  else if (op === 'in') ok = val.slice(1, -1).split(',').map(x => x.replace(/^"|"$/g, '')).includes(String(cell));
  else if (op === 'gte') ok = cell != null && String(cell) >= val;
  else if (op === 'gt') ok = cell != null && String(cell) > val;
  else if (op === 'lt') ok = cell != null && String(cell) < val;
  else if (op === 'lte') ok = cell != null && String(cell) <= val;
  else if (op === 'like') ok = new RegExp('^' + val.replace(/\*/g, '.*') + '$').test(String(cell));
  else throw new Error('filter ' + k + '=' + v);
  return neg ? !ok : ok;
}
function table(db, method, p, search, body, prefer = '') {
  const u = new URLSearchParams(search);
  const t = db[p] ?? (db[p] = []);
  const f = [...u].filter(([k]) => !['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k));
  const pick = () => t.filter(r => f.every(([k, v]) => cellTest(r, k, v)));
  if (method === 'GET') return pick().slice(0, Number(u.get('limit') || 10000));
  if (method === 'PATCH') { for (const r of pick()) Object.assign(r, body); return null; }
  if (method === 'DELETE') { for (const r of pick()) t.splice(t.indexOf(r), 1); return null; }
  const list = Array.isArray(body) ? body : [body];
  const conflict = (u.get('on_conflict') ?? (p === 'app_news_articles' ? 'url_key' : 'id')).split(',');
  const out = [];
  for (const row of list) {
    const hit = t.find(r => conflict.every(c => r[c] === row[c]));
    if (hit) { if (prefer.includes('merge-duplicates')) Object.assign(hit, row); out.push(hit); continue; }
    const nr = {id: row.id ?? `gen-${p}-${t.length}`, created_at: new Date(NOW).toISOString(), ...row};
    t.push(nr); out.push(nr);
  }
  return out;
}

// ---- news-feed ------------------------------------------------------------------------------------------------------
function feedWorld({tables = {}, sites = {}} = {}) {
  const db = {app_news_articles: [], app_news_items: [], app_news_marks: [], app_news_id_map: [], app_news_article_bodies: [], app_feed_bodies: [], app_outside_sources: [], app_news_keywords: [], app_news_days: [], ...structuredClone(tables)};
  const calls = {site: []};
  const doFetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method ?? 'GET', body = init.body ? JSON.parse(init.body) : undefined;
    if (u.hostname === 'api.openai.com') return res({status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify({summary: '합성 한 문장 요약.'})}]}], usage: {input_tokens: 10, output_tokens: 5}});
    if (u.origin !== SB) {
      calls.site.push(u.href);
      const s = sites[u.href];
      if (s === undefined) return new Response('', {status: 404});
      return new Response(s.body, {status: 200, headers: {'content-type': s.type}});
    }
    if (u.pathname === '/auth/v1/user') return init.headers.Authorization === `Bearer ${JWT}` ? res({id: USER}) : res({}, 401);
    const p = u.pathname.replace('/rest/v1/', '');
    if (init.headers?.apikey === ANON) {
      if (p === 'rpc/app_news_article_of') return res([]);
      if (p === 'app_news_articles' && method === 'GET') return res(db.app_news_articles.filter(a => `eq.${a.id}` === u.searchParams.get('id')));
      throw new Error('user login used for ' + method + ' ' + p);
    }
    if (p === 'rpc/app_operator_feature_workspace') return res(WS);
    if (p === 'rpc/app_workspace_ai_month') return res({month: '2026-11', exempt: true, cap_krw: 3000, openai_input_tokens: 0, openai_output_tokens: 0, gemini: []});
    if (p === 'app_workspace_members') return res([{workspace_id: WS}]);
    if (p.startsWith('rpc/')) return res(0);
    const out = table(db, method, p, u.search, body, init.headers?.Prefer ?? '');
    return method === 'GET' || (init.headers?.Prefer ?? '').includes('return=representation') ? res(out ?? []) : res(null, 204);
  };
  const h = H.createNewsFeedHandler({env: n => ({SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role-key', SUPABASE_ANON_KEY: ANON, NEWS_FEED_CRON_SECRET: SECRET, WEB2_OPENAI_API_KEY: 'synthetic-openai-key-000000000000'})[n],
    fetch: doFetch, now: () => NOW, sleep: async () => {}, log: () => {}, resolve: async () => ['93.184.216.34']});
  const user = async (action, b) => { const r = await h(new Request(`${FN}?action=${action}`, {method: 'POST', headers: {authorization: `Bearer ${JWT}`, 'content-type': 'application/json'}, body: JSON.stringify(b)})); return {status: r.status, body: await r.json()}; };
  const cron = async b => (await h(new Request(`${FN}?action=run`, {method: 'POST', headers: {[H.CRON_HEADER]: SECRET, 'content-type': 'application/json'}, body: JSON.stringify(b)}))).json();
  const fetchN = () => db.app_news_days.filter(r => r.workspace_id === WS).reduce((n, r) => n + (Number(r.fetch_n) || 0), 0);
  return {db, calls, user, cron, fetchN};
}
const URL1 = 'https://news.example.org/a/1', KEY1 = 'news.example.org/a/1';
const art = extra => ({id: id(1), origin: 'tg_room', lane: 'channel', url: URL1, url_key: KEY1, state: 'pending', title: null, lang: 'ko', body: null, body_kind: null, summary: null, created_at: recent, ...extra});
const SITE = {[URL1]: {body: PAGE, type: 'text/html; charset=utf-8'}};

test('읽기: 사람이 한 번 열어 사이트를 새로 읽으면 하루 열기 횟수 1(두 번 세지 않음)', async () => {
  const w = feedWorld({tables: {app_news_articles: [art()], app_news_items: [{id: id(1), workspace_id: WS, lane: 'channel', url: URL1, url_key: KEY1, state: 'pending', created_at: recent}]}, sites: SITE});
  const out = await w.user('open', {id: id(1)});
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.status, 'ok');
  assert.equal(w.calls.site.filter(u => u === URL1).length, 1, '사이트 한 번');
  assert.equal(w.fetchN(), 1, '한 번 열기 = 1');
});

test('읽기: 옛 줄 없이 공용 기사만 있어도 한 번 열기 = 1', async () => {
  const w = feedWorld({tables: {app_news_articles: [art()]}, sites: SITE});
  const out = await w.user('open', {id: id(1)});
  assert.equal(out.body.status, 'ok', JSON.stringify(out.body));
  assert.equal(w.fetchN(), 1);
});

test('읽기: 사이트가 본문을 주지 않으면(실패) 세지 않는다', async () => {
  const w = feedWorld({tables: {app_news_articles: [art()]}, sites: {}});
  const out = await w.user('open', {id: id(1)});
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.notEqual(out.body.status, 'ok');
  assert.equal(w.calls.site.filter(u => u === URL1).length, 1, '읽으려 했음');
  assert.equal(w.fetchN(), 0, '실패 = 0');
});

test('읽기: 이미 읽힌 글을 다시 열면 사이트를 읽지 않고 세지 않는다', async () => {
  const w = feedWorld({tables: {app_news_articles: [art({state: 'ok', title: '합성 파업 기사', body: LONG, body_kind: 'full'})]}, sites: SITE});
  for (let i = 0; i < 3; i++) {
    const out = await w.user('open', {id: id(1)});
    assert.equal(out.status, 200);
    assert.equal(out.body.status, 'stored');
  }
  assert.equal(w.calls.site.length, 0);
  assert.equal(w.fetchN(), 0, '같은 글 다시 열기 = 0');
});

test('읽기: 영상 글은 원문(영상)으로 — 세지 않는다', async () => {
  const yt = 'https://www.youtube.com/watch?v=abcDEF12345';
  const w = feedWorld({tables: {app_news_articles: [art({url: yt, url_key: 'www.youtube.com/watch?v=abcDEF12345'})]}});
  const out = await w.user('open', {id: id(1)});
  assert.equal(out.body.status, 'original_only');
  assert.equal(w.fetchN(), 0);
});

test('읽기: 한도(OPEN_DAILY)에 닿으면 사이트를 읽지 않고 429, 횟수도 그대로', async () => {
  const w = feedWorld({tables: {app_news_articles: [art()], app_news_days: [{workspace_id: WS, day: DAY, fetch_n: H.OPEN_DAILY}]}, sites: SITE});
  const out = await w.user('open', {id: id(1)});
  assert.equal(out.status, 429);
  assert.equal(w.calls.site.length, 0);
  assert.equal(w.fetchN(), H.OPEN_DAILY, '한도 숫자는 그대로(60)');
  assert.equal(H.OPEN_DAILY, 60);
});

test('수집: 예약 대기 기사 읽기(일반 글·영상)는 사람 하루 열기 횟수를 쓰지 않는다', async () => {
  const yt = 'https://www.youtube.com/watch?v=abcDEF12345', ytKey = 'www.youtube.com/watch?v=abcDEF12345';
  const w = feedWorld({tables: {
    app_news_articles: [art(), art({id: id(2), url: yt, url_key: ytKey})],
    app_news_items: [{id: id(1), workspace_id: WS, lane: 'channel', url: URL1, url_key: KEY1, state: 'pending', created_at: recent},
      {id: id(2), workspace_id: WS, lane: 'channel', url: yt, url_key: ytKey, state: 'pending', created_at: recent}],
  }, sites: {...SITE, 'https://news.example.org/robots.txt': {body: 'User-agent: *\nAllow: /\n', type: 'text/plain'}}});
  const out = await w.cron({step: 'pending'});
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.ok(w.calls.site.includes(URL1), '대기 기사를 읽었다');
  assert.ok(w.calls.site.some(u => u.includes('youtube.com/oembed')), '영상 제목을 읽었다');
  assert.equal(w.fetchN(), 0, '수집 때 읽기·영상 = 0');
});

// ---- ai-assist now_detail -------------------------------------------------------------------------------------------
const NEWS = id(50);
function detailWorld({details = [], aiLimit = null} = {}) {
  const db = {
    app_news_articles: [{id: NEWS, lane: 'channel', url: 'https://news.example.org/b/1', url_key: 'news.example.org/b/1', title: '합성 파업 기사', lang: 'ko', publisher: '합성일보', summary: '합성 요약.', body: LONG, body_kind: 'full', state: 'ok'}],
    app_news_now_details: structuredClone(details), app_outside_now_details: [],
  };
  const calls = {ai: 0, writes: 0};
  const rest = async path => { const [p, q] = path.split('?'); return table(db, 'GET', p, q, undefined); };
  const doFetch = async (url, init = {}) => {
    const u = new URL(url), p = u.pathname.replace('/rest/v1/', ''), prefer = init.headers?.Prefer ?? '';
    calls.writes++;
    const out = table(db, init.method ?? 'GET', p, u.search, init.body ? JSON.parse(init.body) : undefined, prefer);
    return prefer.includes('return=representation') ? res(out ?? []) : res(null, 204);
  };
  const answer = body => (JSON.stringify(body).includes('now_context')
    ? {relevance: null, implications: {kptu: '합성 시사점.', labor: ''}, related: []}
    : {summary: '합성 상세 요약.', key_sentences: []});
  const kit = {
    ctx: {sb: SB, anon: ANON, token: JWT, userId: USER, workspaceId: WS, doFetch, log: () => {}},
    env: n => ({SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role-key'})[n],
    now: () => NOW, sleep: async () => {}, rest, rpc: async () => [],
    aiConfig: () => ({key: 'synthetic-openai-key', model: 'synthetic-model', price: {input: 0, output: 0}}),
    budget: async () => { if (aiLimit) throw Object.assign(new Error(aiLimit), {code: aiLimit}); return {day: DAY, requests: 0, input: 0, output: 0}; },
    usage: async () => {},
    ai: async (_key, body) => { calls.ai++; return {ok: true, raw: {status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify(answer(body))}]}]}, usage: {input: 10, output: 5}}; },
    fail: (status, code) => Object.assign(new Error(code), {status, code}),
    failCode: e => e?.code ?? null,
  };
  const open = () => D.runNowDetail(kit, {kind: 'now_detail', item: {type: 'news', id: NEWS}});
  return {db, calls, open};
}
// 오늘 다른 글 n개에 상세를 만든 줄(level 칸 지정).
const todayRows = (n, level) => Array.from({length: n}, (_, i) => ({workspace_id: WS, article_id: id(100 + i), level, generated_at: '2026-11-24T01:00:00.000Z', context_at: null, summary: '합성.', body_key: 'k'}));

test('상세: 처음 열면 AI로 만들고(full), 다시 열면 저장본 — AI·하루 셈이 늘지 않는다', async () => {
  const w = detailWorld();
  const a = await w.open();
  assert.equal(a.detail.level, 'full');
  assert.equal(w.calls.ai, 2, '요약·시사점 두 요청(하루 한도는 한 번)');
  const b = await w.open();
  assert.equal(b.detail.level, 'full');
  assert.equal(w.calls.ai, 2, '상세 다시 보기 = AI 0');
  assert.equal(w.db.app_news_now_details.length, 1, '글마다 한 줄 — 하루 셈 1');
});

test('상세: AI 한도에 걸려 AI 없이 남긴 요약 줄(basic)은 하루 상세 한도에 세지 않는다', async () => {
  const w = detailWorld({details: [...todayRows(D.NOW_DETAIL_DAILY - 1, 'full'), ...todayRows(5, 'basic').map((r, i) => ({...r, article_id: id(300 + i)}))]});
  const out = await w.open();
  assert.equal(out.detail.level, 'full', '오늘 AI로 만든 것은 39개 — 아직 한도 안(전에는 basic 5줄까지 세어 44로 한도 넘음)');
});

test('상세: AI로 만든 상세가 한도(40)에 닿으면 요약까지만(basic), 한도 숫자는 그대로', async () => {
  assert.equal(D.NOW_DETAIL_DAILY, 40);
  const w = detailWorld({details: todayRows(D.NOW_DETAIL_DAILY, 'full')});
  const out = await w.open();
  assert.equal(out.detail.level, 'basic');
});

test('상세: 어제 만든 상세는 오늘 셈에 들지 않는다', async () => {
  const w = detailWorld({details: todayRows(D.NOW_DETAIL_DAILY, 'full').map(r => ({...r, generated_at: '2026-11-23T05:00:00.000Z'}))});
  const out = await w.open();
  assert.equal(out.detail.level, 'full');
});
