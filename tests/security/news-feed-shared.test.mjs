// NEWS-모두에게열기 ②: news-feed가 공용 기사(app_news_articles)에 한 번만 모으고, 사람별 키워드는 app_news_marks, 옮기는 동안 옛 표에도 쓴다.
// 비용 시험: 같은 기사를 여러 작업공간이 가져도 원문 읽기·요약·제목 번역 AI는 기사마다 한 번. 네트워크 없음(합성 글·example 주소).
import test from 'node:test';
import assert from 'node:assert/strict';

const H = await import('../../supabase/functions/news-feed/handler.ts');
const C = await import('../../supabase/functions/_shared/news-catalog.ts');
const NOW = Date.parse('2026-11-15T03:00:00Z');
const SB = 'https://synthetic.supabase.test', SECRET = 'synthetic-news-feed-cron-secret-0123456789abc';
const OP = 'a0000000-0000-4000-8000-000000000001', WS2 = 'a0000000-0000-4000-8000-000000000002';
const USER = 'b0000000-0000-4000-8000-000000000002', JWT = 'synthetic.user.jwt-owner-0002';
const FN = `${SB}/functions/v1/news-feed`;
const id = n => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LONG = 'Workers in the synthetic city walked out today over unsafe staffing levels. '.repeat(12);
const PAGE = `<html lang="en"><head><meta property="og:title" content="Synthetic strike story"></head><body><article><p>${LONG}</p></article></body></html>`;

// 아주 작은 PostgREST 흉내: eq·neq·is·in·gte·lt·not.is 거르기, select·order·limit·offset, POST(ignore/merge), PATCH.
const ANON = 'synthetic-anon-key';
// blocked: 누른 사람이 가입 차단 명단에 있음(공용 표 읽기 정책 private.app_news_reader_ok가 막음).
function world({tables = {}, sites = {}, ai = {summary: '합성 한 문장 요약.'}, members = [{user_id: USER, workspace_id: WS2}], blocked = false, newsWs = WS2, sleeps = []} = {}) {
  const db = {app_news_articles: [], app_news_items: [], app_news_marks: [], app_news_id_map: [], app_news_article_bodies: [], app_outside_sources: [], app_news_keywords: [], app_news_days: [], ...structuredClone(tables)};
  const calls = {ai: 0, site: [], rest: []};
  const res = (v, s = 200) => new Response(v === null ? null : JSON.stringify(v), {status: s, headers: {'content-type': 'application/json'}});
  const test1 = (row, k, v) => {
    if (k === 'or' || k === 'app_feed_bodies') return true;
    const neg = v.startsWith('not.'); if (neg) v = v.slice(4);
    const i = v.indexOf('.'), op = v.slice(0, i), val = v.slice(i + 1);
    const cell = row[k];
    let ok;
    if (op === 'eq') ok = String(cell ?? '') === val;
    else if (op === 'neq') ok = val === '{}' ? Array.isArray(cell) ? cell.length > 0 : String(cell) !== val : String(cell ?? '') !== val;
    else if (op === 'is') ok = val === 'null' ? cell == null : val === 'true' ? cell === true : cell === false;
    else if (op === 'in') ok = JSON.parse(`[${val.slice(1, -1).split(',').map(x => x.startsWith('"') ? x : JSON.stringify(x)).join(',')}]`).includes(String(cell));
    else if (op === 'gte') ok = String(cell ?? '') >= val;
    else if (op === 'lt') ok = String(cell ?? '') < val;
    else if (op === 'lte') ok = cell != null && String(cell) <= val;
    else if (op === 'gt') ok = cell != null && String(cell) > val;
    else if (op === 'like') ok = new RegExp('^' + val.replace(/\*/g, '.*') + '$').test(String(cell));
    else throw new Error('filter ' + k + '=' + v);
    return neg ? !ok : ok;
  };
  const doFetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method ?? 'GET', body = init.body ? JSON.parse(init.body) : undefined;
    if (u.hostname === 'api.openai.com') { calls.ai++; return res({status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify(typeof ai === 'function' ? ai(body) : ai)}]}], usage: {input_tokens: 100, output_tokens: 20}}); }
    if (u.origin !== SB) { calls.site.push(u.href); const s = sites[u.href]; return s === undefined ? new Response('', {status: 404}) : new Response(s, {status: 200, headers: {'content-type': 'text/html'}}); }
    if (u.pathname === '/auth/v1/user') return init.headers.Authorization === `Bearer ${JWT}` ? res({id: USER}) : res({}, 401);
    const p = u.pathname.replace('/rest/v1/', '');
    calls.rest.push({method, p, q: u.search, body, prefer: init.headers?.Prefer, user: init.headers?.apikey === ANON});
    // 사용자 로그인 읽기(E3): 공용 기사 읽기 정책 흉내 — 로그인 + owner 줄 1개 + 차단 아님, 채널 스크랩 줄은 운영자 작업공간만. 지도 함수는 자기 작업공간 옛 id만.
    if (init.headers?.apikey === ANON) {
      assert.equal(init.headers.Authorization, `Bearer ${JWT}`);
      const mine = members.filter(m => m.user_id === USER), ok = mine.length === 1 && !blocked, myWs = mine[0]?.workspace_id;
      const can = a => !!a && ok && (a.origin !== 'tg_scrap' || myWs === OP);
      if (p === 'rpc/app_news_article_of') return res(db.app_news_id_map.filter(m => body.p_old.includes(m.old_id) && m.workspace_id === myWs && can(db.app_news_articles.find(a => a.id === m.article_id))).map(m => ({old_id: m.old_id, article_id: m.article_id})));
      if (p === 'app_news_articles' && method === 'GET') return res(db.app_news_articles.filter(a => `eq.${a.id}` === u.searchParams.get('id') && can(a)));
      throw new Error('user login used for ' + method + ' ' + p);
    }
    // NEWS-운영자만(S63-03): 'outside' 키 작업공간은 정확히 한 곳(기본은 누르는 사람 WS2, 시험마다 newsWs로 바꿈). 'telegram'(운영자·AI 셈)은 OP.
    if (p === 'rpc/app_operator_feature_workspace') return res(body?.p_feature === 'outside' ? newsWs : OP);
    if (p === 'rpc/app_workspace_ai_month') return res({month: '2026-11', exempt: true, cap_krw: 3000, openai_input_tokens: 0, openai_output_tokens: 0, gemini: []});
    if (p === 'app_workspace_members') return res(members.filter(m => `eq.${m.user_id}` === u.searchParams.get('user_id')).map(m => ({workspace_id: m.workspace_id})));
    if (p.startsWith('rpc/')) return res(0);
    const t = db[p] ?? (db[p] = []);
    const f = [...u.searchParams].filter(([k]) => !['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k));
    const pick = () => t.filter(r => f.every(([k, v]) => test1(r, k, v)));
    if (method === 'GET') {
      const off = Number(u.searchParams.get('offset') || 0), lim = Number(u.searchParams.get('limit') || 10000);
      return res(pick().slice(off, off + lim));
    }
    if (method === 'PATCH') { for (const r of pick()) Object.assign(r, body); return res(null, 204); }
    if (method === 'POST') {
      const list = Array.isArray(body) ? body : [body];
      const conflict = (u.searchParams.get('on_conflict') ?? (p === 'app_news_articles' ? 'url_key' : 'id')).split(',');
      const out = [];
      for (const row of list) {
        const hit = t.find(r => conflict.every(c => r[c] === row[c]));
        if (hit) { if ((init.headers?.Prefer ?? '').includes('merge-duplicates')) Object.assign(hit, row); continue; }
        const nr = {id: row.id ?? `gen-${t.length}`, ...(p === 'app_news_marks' ? {keywords: []} : {}), created_at: new Date(NOW).toISOString(), ...row};
        t.push(nr); out.push(nr);
      }
      return (init.headers?.Prefer ?? '').includes('return=representation') ? res(out, 201) : res(null, 201);
    }
    return res(null, 204);
  };
  const h = H.createNewsFeedHandler({env: n => ({SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role-key', SUPABASE_ANON_KEY: ANON, NEWS_FEED_CRON_SECRET: SECRET, WEB2_OPENAI_API_KEY: 'synthetic-openai-key-000000000000'})[n], fetch: doFetch, now: () => NOW, sleep: async ms => { sleeps.push(ms); }, log: () => {}});
  const cronAt = async (action, b) => (await h(new Request(`${FN}?action=${action}`, {method: 'POST', headers: {[H.CRON_HEADER]: SECRET, 'content-type': 'application/json'}, body: JSON.stringify(b)}))).json();
  const cron = async b => (await h(new Request(`${FN}?action=run`, {method: 'POST', headers: {[H.CRON_HEADER]: SECRET, 'content-type': 'application/json'}, body: JSON.stringify(b)}))).json();
  const user = async (action, b) => { const r = await h(new Request(`${FN}?action=${action}`, {method: 'POST', headers: {authorization: `Bearer ${JWT}`, 'content-type': 'application/json'}, body: JSON.stringify(b)})); return {status: r.status, body: await r.json()}; };
  return {db, calls, cron, cronAt, user, sleeps};
}
const recent = new Date(NOW - 3600000).toISOString();

test('매체 단계: 공용 기사는 기사마다 한 줄(작업공간·키워드 칸 없음), 운영자 옛 줄은 같은 id. S63-03: \'outside\' 키 없는 WS2는 켠 매체·키워드가 있어도 줄·표시 없음', async () => {
  const s = C.newsSourceByKey('news-labortoday');
  const rss = `<rss><channel><item><title>합성 철도 파업 기사</title><link>https://www.labortoday.co.kr/news/articleView.html?idxno=1</link><description>합성 소개</description></item>
<item><title>합성 버스 기사</title><link>https://www.labortoday.co.kr/news/articleView.html?idxno=2</link></item></channel></rss>`;
  const w = world({tables: {
    app_outside_sources: [{workspace_id: OP, source_key: 'news-labortoday', enabled: true}, {workspace_id: WS2, source_key: 'news-labortoday', enabled: true}],
    app_news_keywords: [{workspace_id: OP, word: '철도', enabled: true, created_at: '1'}, {workspace_id: WS2, word: '버스', enabled: true, created_at: '1'}],
  }, sites: {[s.lists[0]]: rss, 'https://www.labortoday.co.kr/robots.txt': 'User-agent: *\nAllow: /\n'}, newsWs: OP});
  const out = await w.cron({step: 'media', source: 'news-labortoday'});
  assert.equal(out.ok, true);
  assert.equal(w.db.app_news_articles.length, 2, '기사마다 한 줄');
  for (const a of w.db.app_news_articles) {
    assert.equal(a.origin, 'site');
    for (const k of ['workspace_id', 'keywords', 'starred_at', 'hidden_at', 'folder_id']) assert.ok(!(k in a), `공용 기사에 ${k} 칸 없음`);
  }
  assert.equal(w.db.app_news_items.length, 2, '옮기는 동안 옛 표에도 — \'outside\' 키 작업공간(OP)만');
  assert.ok(!w.db.app_news_items.some(r => r.workspace_id === WS2), 'WS2 몫 줄 없음');
  const rail = w.db.app_news_articles.find(a => a.title.includes('철도'));
  assert.equal(w.db.app_news_items.find(r => r.workspace_id === OP && r.url_key === rail.url_key).id, rail.id, '운영자 옛 줄 id = 공용 id');
  const marks = w.db.app_news_marks.map(m => [m.workspace_id, w.db.app_news_articles.find(a => a.id === m.article_id).title, m.keywords]).sort();
  assert.deepEqual(marks, [[OP, '합성 철도 파업 기사', ['철도']]], '자기 키워드만 자기 표시에(WS2 키워드는 표시 안 함)');
  // E2: 옛 표에 넣은 줄마다 같은 주소 공용 기사로 지도 1줄(작업공간 그대로).
  assert.equal(w.db.app_news_id_map.length, 2);
  for (const m of w.db.app_news_id_map) {
    const old = w.db.app_news_items.find(r => r.id === m.old_id), art = w.db.app_news_articles.find(a => a.id === m.article_id);
    assert.ok(old && art, '옛 줄·기사 있음'); assert.equal(old.url_key, art.url_key); assert.equal(m.workspace_id, old.workspace_id);
    assert.deepEqual(Object.keys(m).filter(k => k !== 'created_at' && k !== 'id').sort(), ['article_id', 'old_id', 'workspace_id'], '지도 줄은 id 세 칸뿐');
  }
  // 두 번째 실행: 공용 기사·표시·지도는 늘지 않음.
  await w.cron({step: 'media', source: 'news-labortoday'});
  assert.equal(w.db.app_news_articles.length, 2);
  assert.equal(w.db.app_news_id_map.length, 2);
  assert.equal(w.calls.ai, 0, '수집 때 AI 없음');
});

test('비용: 두 작업공간 옛 대기 줄 + 공용 기사(같은 주소) → 원문 1번·요약 AI 1번, 결과는 공용 기사와 두 옛 줄 모두에', async () => {
  const url = 'https://news.example.org/a/1', key = 'news.example.org/a/1';
  const w = world({tables: {
    app_news_articles: [{id: id(1), origin: 'tg_scrap', lane: 'channel', url, url_key: key, state: 'pending', created_at: recent}],
    app_news_items: [{id: id(1), workspace_id: OP, lane: 'channel', url, url_key: key, state: 'pending', created_at: recent},
      {id: id(2), workspace_id: WS2, lane: 'channel', url, url_key: key, state: 'pending', created_at: recent}],
  }, sites: {'https://news.example.org/robots.txt': 'User-agent: *\nAllow: /\n', [url]: PAGE}});
  const out = await w.cron({step: 'pending'});
  assert.equal(out.done, 1, '한 묶음');
  assert.equal(w.calls.site.filter(u => u === url).length, 1, '원문 1번');
  assert.equal(w.calls.ai, 1, '요약 AI 1번');
  for (const r of [...w.db.app_news_items, ...w.db.app_news_articles]) { assert.equal(r.state, 'ok'); assert.equal(r.summary, '합성 한 문장 요약.'); assert.equal(r.title, 'Synthetic strike story'); }
  // E2: 공용 본문 블록은 기사마다 한 줄(작업공간 칸 없음), 두 옛 줄 모두 같은 기사로 지도.
  assert.equal(w.db.app_news_article_bodies.length, 1);
  const b = w.db.app_news_article_bodies[0];
  assert.equal(b.article_id, id(1)); assert.equal(b.state, 'ok'); assert.ok(b.chars > 0);
  for (const k of ['workspace_id', 'news_item_id', 'outside_post_id']) assert.ok(!(k in b), `공용 본문에 ${k} 칸 없음`);
  assert.deepEqual(w.db.app_news_id_map.map(m => [m.old_id, m.article_id]).sort(), [[id(1), id(1)], [id(2), id(1)]]);
});

test('공용 본문: 못 읽은 결과는 이미 있는 블록을 덮지 않는다(블록이 없을 때만 failed 한 줄)', async () => {
  const url = 'https://news.example.org/a/9', key = 'news.example.org/a/9';
  const okBody = {article_id: id(40), blocks: [{t: 'p', text: '합성'}], state: 'ok', chars: 2, images: 0};
  const w = world({tables: {
    app_news_articles: [{id: id(40), origin: 'tg_room', lane: 'channel', url, url_key: key, state: 'pending', created_at: recent},
      {id: id(41), origin: 'tg_room', lane: 'channel', url: url + '0', url_key: key + '0', state: 'pending', created_at: recent}],
    app_news_article_bodies: [okBody],
  }, sites: {'https://news.example.org/robots.txt': 'User-agent: *\nAllow: /\n'}});
  await w.cron({step: 'pending'});
  const bodies = Object.fromEntries(w.db.app_news_article_bodies.map(b => [b.article_id, b]));
  assert.equal(bodies[id(40)].state, 'ok', '읽힌 본문 그대로');
  assert.equal(bodies[id(41)].state, 'failed', '없던 기사는 failed 한 줄');
  const bodyCalls = w.calls.rest.filter(c => c.p === 'app_news_article_bodies');
  assert.ok(bodyCalls.filter(c => c.method === 'POST').every(c => /ignore-duplicates/.test(c.prefer)));
  // S68-25: 못 읽은 결과의 고치기(PATCH)는 예전 robots 실패 줄만 새 까닭으로 바꾼다(읽힌 본문·다른 실패 줄은 건드리지 않음).
  assert.ok(bodyCalls.filter(c => c.method === 'PATCH').every(c => /state=eq\.failed&reason=eq\.robots/.test(c.q)));
});

test('S68-25: 예전에 robots로 못 읽은 공용 본문 줄은 다시 읽어 실패해도 새 까닭으로 바뀌고, 읽힌 본문은 그대로', async () => {
  const url = 'https://news.example.org/a/12', key = 'news.example.org/a/12';
  const w = world({tables: {
    app_news_articles: [{id: id(42), origin: 'tg_room', lane: 'channel', url, url_key: key, state: 'robots', created_at: recent}],
    app_news_article_bodies: [{article_id: id(42), blocks: [], state: 'failed', reason: 'robots', rule: 'open@1', chars: 0, images: 0}],
  }, sites: {}});
  await w.cron({step: 'pending'});
  const b = w.db.app_news_article_bodies.find(x => x.article_id === id(42));
  assert.equal(b.state, 'failed'); assert.notEqual(b.reason, 'robots', '새 까닭으로');
  assert.notEqual(w.db.app_news_articles.find(a => a.id === id(42)).state, 'robots', '다시 고르지 않게 상태가 바뀐다(재시도 1번)');
  assert.equal(w.calls.site.filter(u => u.endsWith('/robots.txt')).length, 0, 'robots.txt는 읽지 않는다');
});

test('prune 단계: 지우기 앞에 보충 함수(서버 전용)를 한 번 부르고, 실패해도 지우기는 간다. 돌려받은 값은 줄 수만', async () => {
  const w = world();
  const out = await w.cron({step: 'prune'});
  assert.equal(out.ok, true);
  const rpcs = w.calls.rest.filter(c => c.p.startsWith('rpc/app_news_')).map(c => c.p);
  assert.deepEqual(rpcs, ['rpc/' + H.REFS_SYNC_FN, 'rpc/app_news_prune']);
  assert.deepEqual(w.calls.rest.find(c => c.p === 'rpc/' + H.REFS_SYNC_FN).body, {p_limit: H.REFS_SYNC_LIMIT});
  assert.deepEqual(H.refsCounts({map: 3, bodies: 0, reads: 2, details: 1, signals: 4, articles: 0, note: 'x', bad: -1}), {articles: 0, map: 3, bodies: 0, reads: 2, details: 1, signals: 4});
  assert.equal(H.refsCounts([1]), null); assert.equal(H.refsCounts(null), null);
  assert.deepEqual(H.refsCounts({map: 1.5, reads: '2'}), {});
});

test('공용 기사만 있는 대기 기사(뉴스방 수집분)도 예약 실행이 읽고, AI는 운영자 작업공간에 센다', async () => {
  const url = 'https://news.example.org/a/2';
  const w = world({tables: {app_news_articles: [{id: id(3), origin: 'tg_room', lane: 'channel', url, url_key: 'news.example.org/a/2', state: 'pending', created_at: recent}]},
    sites: {'https://news.example.org/robots.txt': 'User-agent: *\nAllow: /\n', [url]: PAGE}});
  await w.cron({step: 'pending'});
  assert.equal(w.db.app_news_articles[0].state, 'ok');
  assert.equal(w.db.app_news_articles[0].summary, '합성 한 문장 요약.');
  assert.deepEqual(w.db.app_news_days.map(d => d.workspace_id), [OP]);
});

test('재사용: 공용 기사가 이미 읽혔으면 옛 대기 줄은 원문·AI 없이 옮겨 적기만', async () => {
  const url = 'https://news.example.org/a/3', key = 'news.example.org/a/3';
  const w = world({tables: {
    app_news_articles: [{id: id(4), origin: 'site', lane: 'media', url, url_key: key, state: 'ok', title: '합성 제목', title_key: 'k', summary: '합성 요약', body: '합성 본문', body_kind: 'full', lang: 'ko', fetched_at: recent, created_at: recent}],
    app_news_items: [{id: id(5), workspace_id: OP, lane: 'channel', url, url_key: key, state: 'pending', created_at: recent}],
  }});
  await w.cron({step: 'pending'});
  assert.equal(w.calls.site.length, 0); assert.equal(w.calls.ai, 0);
  const r = w.db.app_news_items[0];
  assert.deepEqual([r.state, r.title, r.summary, r.body], ['ok', '합성 제목', '합성 요약', '합성 본문']);
});

test('제목 번역: 같은 외국어 기사는 AI 1번(공용 기사에 저장). S63-03: \'outside\' 키 없는 WS2 옛 줄은 번역·옮겨 적기 없음', async () => {
  const mk = (n, ws, key) => ({id: id(n), workspace_id: ws, lane: 'media', url: `https://${key}`, url_key: key, lang: 'en', title: `Synthetic title ${key}`, summary: 'Synthetic lead.', created_at: recent});
  const w = world({ai: {titles: [{i: 1, ko: '합성 제목 번역', sum_ko: '합성 소개 번역'}]}, tables: {
    app_news_articles: [{id: id(10), origin: 'site', lane: 'media', url: 'https://x.example.org/1', url_key: 'x.example.org/1', lang: 'en', title: 'Synthetic title x.example.org/1', summary: 'Synthetic lead.', state: 'ok', created_at: recent},
      {id: id(11), origin: 'site', lane: 'media', url: 'https://x.example.org/2', url_key: 'x.example.org/2', lang: 'en', title: 'T2', title_ko: '이미 있는 번역', summary: '이미 한국어 소개', translated_at: recent, state: 'ok', created_at: recent}],
    app_news_items: [mk(12, OP, 'x.example.org/1'), mk(13, WS2, 'x.example.org/1'), mk(14, WS2, 'x.example.org/2')],
  }, newsWs: OP});
  await w.cron({step: 'titles'});
  assert.equal(w.calls.ai, 1, '기사마다 한 번');
  assert.equal(w.db.app_news_articles[0].title_ko, '합성 제목 번역');
  assert.deepEqual([w.db.app_news_items[0].title_ko, w.db.app_news_items[0].summary], ['합성 제목 번역', '합성 소개 번역']);
  for (const r of w.db.app_news_items.slice(1)) assert.deepEqual([r.title_ko, r.summary], [undefined, 'Synthetic lead.'], 'WS2 옛 줄은 그대로');
  assert.deepEqual(w.db.app_news_days.map(d => d.workspace_id), [OP], 'AI는 운영자 작업공간에 셈');
});

test('키워드 표시: 공용 기사 하나에 자기 키워드만. S63-03: \'outside\' 키 없는 작업공간은 표시를 만들지도 비우지도 않음(보존)', async () => {
  const w = world({tables: {
    app_news_articles: [{id: id(20), origin: 'site', lane: 'media', url: 'https://k.example.org/1', url_key: 'k.example.org/1', title: '합성 철도 버스 기사', state: 'ok', created_at: recent}],
    app_news_keywords: [{workspace_id: OP, word: '철도', enabled: true, created_at: '1'}, {workspace_id: WS2, word: '버스', enabled: true, created_at: '1'}],
    app_outside_sources: [{workspace_id: 'a0000000-0000-4000-8000-000000000003', source_key: 'news-khan', enabled: true}],
    app_news_marks: [{workspace_id: 'a0000000-0000-4000-8000-000000000003', article_id: id(20), keywords: ['옛말'], starred_at: recent}],
  }, newsWs: OP});
  const out = await w.cron({step: 'keywords'});
  assert.equal(out.marks, 1);
  const m = Object.fromEntries(w.db.app_news_marks.map(x => [x.workspace_id, x]));
  assert.deepEqual(m[OP].keywords, ['철도']); assert.equal(m[WS2], undefined, 'WS2 키워드는 표시 안 함');
  assert.deepEqual(m['a0000000-0000-4000-8000-000000000003'].keywords, ['옛말'], '이미 있는 표시는 지우지 않음'); assert.equal(m['a0000000-0000-4000-8000-000000000003'].starred_at, recent);
});

test('[번역] 재사용: 같은 본문의 공용 기사에 번역이 있으면 AI·하루 한도 없이 저장본, 처음 번역은 공용 기사에도 저장', async () => {
  const key = 'n.example.org/1', base = {lane: 'media', url: 'https://n.example.org/1', url_key: key, lang: 'en', title: 'T', body: 'Synthetic body.', body_kind: 'full', state: 'ok', created_at: recent};
  const w = world({ai: {title_ko: '합성 제목', body_ko: '합성 본문 번역'}, tables: {
    app_news_articles: [{id: id(30), origin: 'site', ...base}],
    app_news_items: [{id: id(31), workspace_id: WS2, ...base}],
    app_news_id_map: [{old_id: id(31), workspace_id: WS2, article_id: id(30)}],
  }});
  const first = await w.user('translate', {id: id(31)});
  assert.equal(first.body.status, 'translated');
  assert.equal(w.db.app_news_articles[0].body_ko, '합성 본문 번역', '공용 기사에 저장');
  const ai = w.calls.ai;
  // 두 번째 사람(같은 기사): 옛 줄 번역을 지우고 다시 누름 → 저장본.
  w.db.app_news_items[0].body_ko = null; w.db.app_news_items[0].title_ko = null; w.db.app_news_items[0].translated_at = null;
  const days = JSON.stringify(w.db.app_news_days);
  const again = await w.user('translate', {id: id(31)});
  assert.equal(again.body.status, 'stored');
  assert.equal(w.calls.ai, ai, 'AI 다시 안 부름');
  assert.equal(JSON.stringify(w.db.app_news_days), days, '하루 한도 안 씀');
  assert.equal(w.db.app_news_items[0].body_ko, '합성 본문 번역');
});

// ---- NEWS-모두에게열기 E3: 화면 입구가 공용 기사 id로(옛 줄 id도 지도로) -----------------------------------------------------

const OTHER_USER_WS = 'a0000000-0000-4000-8000-000000000003';
const artRow = (n, extra = {}) => ({id: id(n), origin: 'site', lane: 'channel', url: `https://e3.example.org/${n}`, url_key: `e3.example.org/${n}`, state: 'pending', lang: 'en', title: 'Synthetic E3', created_at: recent, ...extra});
const e3Sites = n => ({'https://e3.example.org/robots.txt': 'User-agent: *\nAllow: /\n', [`https://e3.example.org/${n}`]: PAGE});

test('E3 open: 공용 id로 누르면 공용 기사를 읽어 채우고(옛 줄 없음), 하루 한도는 누른 사람 작업공간, 두 번째는 저장본(원문·AI 0)', async () => {
  const w = world({tables: {app_news_articles: [artRow(50)]}, sites: e3Sites(50)});
  const r = await w.user('open', {id: id(50)});
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.status, 'ok');
  const a = w.db.app_news_articles[0];
  assert.deepEqual([a.state, a.body_kind, a.summary], ['ok', 'full', '합성 한 문장 요약.']);
  assert.equal(w.db.app_news_article_bodies.length, 1, '공용 본문 한 줄');
  assert.deepEqual([...new Set(w.db.app_news_days.map(d => d.workspace_id))], [WS2], '한도·사용량은 누른 사람 작업공간');
  assert.equal(w.db.app_news_items.length, 0, '옛 줄을 만들지 않음');
  const site = w.calls.site.length, ai = w.calls.ai;
  const again = await w.user('open', {id: id(50)});
  assert.equal(again.body.status, 'stored'); assert.equal(w.calls.site.length, site); assert.equal(w.calls.ai, ai, '기사마다 1번');
  assert.ok(!w.calls.rest.some(c => c.method === 'POST' && c.p === 'app_news_articles'), '화면 입구는 공용 기사를 새로 만들지 않음');
});

test('E3 open: 옛 줄 id는 지도로 공용 기사로 바꾸고, 내 옛 줄에도 같은 결과(옮기는 동안). 이미 읽힌 기사는 옮겨 적기만', async () => {
  const key = 'e3.example.org/51', url = 'https://e3.example.org/51';
  const w = world({tables: {
    app_news_articles: [artRow(51)],
    app_news_items: [{id: id(52), workspace_id: WS2, lane: 'channel', url, url_key: key, state: 'pending', created_at: recent},
      {id: id(53), workspace_id: OTHER_USER_WS, lane: 'channel', url, url_key: key, state: 'pending', created_at: recent}],
    app_news_id_map: [{old_id: id(52), workspace_id: WS2, article_id: id(51)}, {old_id: id(53), workspace_id: OTHER_USER_WS, article_id: id(51)}],
  }, sites: e3Sites(51)});
  const r = await w.user('open', {id: id(52)});
  assert.equal(r.body.status, 'ok');
  assert.equal(w.db.app_news_articles[0].body_kind, 'full');
  assert.equal(w.db.app_news_items.find(i => i.id === id(52)).body_kind, 'full', '내 옛 줄에도');
  assert.equal(w.db.app_news_items.find(i => i.id === id(53)).state, 'pending', '남의 옛 줄은 건드리지 않음');
  assert.ok(!w.calls.rest.some(c => !c.user && c.p === 'app_news_items' && (c.q ?? '').includes(OTHER_USER_WS)), '남의 작업공간 줄을 읽지 않음');
  // 남의 옛 줄 id로 부르면: 지도는 내 것만 바꿔 주므로 그 id 그대로 공용 기사로 찾음 → 없음(404).
  assert.equal((await w.user('open', {id: id(53)})).status, 404);
  // 이미 읽힌 공용 기사 + 아직 빈 내 옛 줄: 원문·AI 없이 옮겨 적기.
  const w2 = world({tables: {
    app_news_articles: [artRow(54, {state: 'ok', body: '합성 본문', body_kind: 'full', title: '합성 제목', summary: '합성 요약'})],
    app_news_items: [{id: id(55), workspace_id: WS2, lane: 'channel', url: 'https://e3.example.org/54', url_key: 'e3.example.org/54', state: 'pending', created_at: recent}],
  }});
  assert.equal((await w2.user('open', {id: id(54)})).body.status, 'stored');
  assert.equal(w2.calls.site.length + w2.calls.ai, 0);
  assert.deepEqual([w2.db.app_news_items[0].state, w2.db.app_news_items[0].body], ['ok', '합성 본문']);
  assert.equal(w2.db.app_news_days.length, 0, '하루 한도 안 씀');
});

test('S63-11 open: 본문은 있는데 제목 없이 아직 읽기 전인 공용 기사는 내 옛 줄 제목·상태로 채운다(원문·AI·하루 한도 0)', async () => {
  const key = 'e3.example.org/56', url = 'https://e3.example.org/56';
  const w = world({tables: {
    app_news_articles: [artRow(56, {title: null, state: 'pending', body: '합성 본문', body_kind: 'full'})],
    app_news_items: [{id: id(57), workspace_id: WS2, lane: 'channel', url, url_key: key, state: 'ok', title: '합성 옛 줄 제목', body: '합성 본문', body_kind: 'full', created_at: recent}],
  }});
  const r = await w.user('open', {id: id(56)});
  assert.equal(r.body.status, 'titled');
  const a = w.db.app_news_articles[0];
  assert.deepEqual([a.title, a.state], ['합성 옛 줄 제목', 'ok']);
  assert.equal(w.calls.site.length + w.calls.ai, 0);
  assert.equal(w.db.app_news_days.length, 0, '하루 한도 안 씀');
  // 한 번 채운 뒤에는 저장본 그대로.
  assert.equal((await w.user('open', {id: id(56)})).body.status, 'stored');
  // 옛 줄에도 제목이 없으면 상태만 ok(제목은 그대로 비움).
  const H2 = H.headPatch({title: 'https://e3.example.org/9', state: 'pending', body_kind: 'full'}, [{title: 'https://e3.example.org/9'}], '2026-11-16T00:00:00Z');
  assert.deepEqual(Object.keys(H2).sort(), ['fetched_at', 'state', 'updated_at']);
  assert.equal(H.headPatch({title: '있는 제목', state: 'ok', body_kind: 'full'}, [], 'x'), null);
});

test('E3 거절: 차단 명단 사람·채널 스크랩(운영자 전용) 줄·owner 아닌 사람·없는 id는 공용 기사를 못 읽음(원문·AI·쓰기 0)', async () => {
  const tables = {app_news_articles: [artRow(60), artRow(61, {origin: 'tg_scrap'})]};
  const quiet = w => { assert.equal(w.calls.site.length + w.calls.ai, 0); assert.ok(!w.calls.rest.some(c => ['POST', 'PATCH', 'DELETE'].includes(c.method) && !c.p.startsWith('rpc/'))); };
  const blocked = world({tables, sites: e3Sites(60), blocked: true});
  for (const action of ['open', 'translate']) assert.equal((await blocked.user(action, {id: id(60)})).status, 404, action);
  quiet(blocked);
  const plain = world({tables, sites: e3Sites(61)});
  for (const action of ['open', 'translate']) assert.equal((await plain.user(action, {id: id(61)})).status, 404, '채널 스크랩 줄(텔레그램)은 운영자만');
  for (const action of ['open', 'translate']) assert.equal((await plain.user(action, {id: id(99)})).status, 404);
  quiet(plain);
  const stranger = world({tables, sites: e3Sites(60), members: []});
  assert.equal((await stranger.user('open', {id: id(60)})).status, 403); quiet(stranger);
  // 운영자는 채널 스크랩 줄을 읽는다(옮기는 동안 그대로).
  const op = world({tables, sites: e3Sites(61), members: [{user_id: USER, workspace_id: OP}], newsWs: OP});
  assert.equal((await op.user('open', {id: id(61)})).body.status, 'ok');
});

test('E3 translate: 공용 id로 번역하면 공용 기사에 1번 저장, 다른 사람은 저장본(AI·하루 한도 0), 옛 줄 없는 사람도 됨', async () => {
  const w = world({ai: {title_ko: '합성 제목', body_ko: '합성 본문 번역'}, tables: {app_news_articles: [artRow(70, {state: 'ok', body: 'Synthetic body.', body_kind: 'full'})]}});
  const r = await w.user('translate', {id: id(70)});
  assert.equal(r.body.status, 'translated');
  const a = w.db.app_news_articles[0];
  assert.deepEqual([a.title_ko, a.body_ko], ['합성 제목', '합성 본문 번역']); assert.ok(a.translated_at);
  const patch = w.calls.rest.find(c => c.method === 'PATCH' && c.p === 'app_news_articles');
  assert.match(patch.q, /body_ko=is\.null/, '이미 있는 번역은 덮지 않음');
  const ai = w.calls.ai, days = JSON.stringify(w.db.app_news_days);
  const second = world({tables: {app_news_articles: [structuredClone(a)]}, members: [{user_id: USER, workspace_id: OTHER_USER_WS}], newsWs: OTHER_USER_WS});
  assert.equal((await second.user('translate', {id: id(70)})).body.status, 'stored');
  assert.equal(second.calls.ai, 0); assert.equal(second.db.app_news_days.length, 0);
  assert.equal(w.calls.ai, ai); assert.equal(JSON.stringify(w.db.app_news_days), days);
});

test('E3 소스: 화면 입구(open·translate)는 공용 기사를 새로 만들지 않고, 텔레그램 방·글·가족 표를 읽거나 쓰지 않는다', async () => {
  const {readFileSync} = await import('node:fs');
  const src = readFileSync(new URL('../../supabase/functions/news-feed/handler.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  const screen = src.slice(src.indexOf('const who = await authorizeUser('), src.indexOf('} catch (e) {', src.indexOf('const who = await authorizeUser(')));
  assert.ok(screen.includes('readSharedArticle') || screen.includes('ownArticle('), '공용 기사는 사용자 로그인으로 읽음');
  assert.doesNotMatch(screen, /"POST", "app_news_articles|insertArticles\(/, '공용 기사 새로 만들기 없음');
  assert.doesNotMatch(screen, /app_feed_items|app_feed_rooms|app_family|app_tg_|app_call/, '텔레그램·가족·통화 표 없음');
  const shared = readFileSync(new URL('../../supabase/functions/_shared/shared-article.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(shared, /SERVICE_ROLE|Deno\.env|method: "(PATCH|DELETE|PUT)"/, '공용 글 찾기는 사용자 로그인 읽기만');
});

test('S62-22: 사람이 공유로 먼저 넣은 기사(origin user)를 매체 수집이 만나면 새 줄 없이 매체 기사로 넓힌다(모두의 목록에)', async () => {
  const s = C.newsSourceByKey('news-labortoday');
  const rss = `<rss><channel><item><title>합성 공유 먼저 기사</title><link>https://www.labortoday.co.kr/news/articleView.html?idxno=7</link></item></channel></rss>`;
  const w = world({tables: {
    app_outside_sources: [{workspace_id: OP, source_key: 'news-labortoday', enabled: true}],
    app_news_articles: [{id: id(70), origin: 'user', lane: 'channel', url: 'https://www.labortoday.co.kr/news/articleView.html?idxno=7', url_key: 'labortoday.co.kr/news/articleView.html?idxno=7', title: '합성 공유 먼저 기사', state: 'ok'},
      {id: id(71), origin: 'user', lane: 'channel', url: 'https://other.example.org/x', url_key: 'other.example.org/x', state: 'ok'}],
  }, sites: {[s.lists[0]]: rss, 'https://www.labortoday.co.kr/robots.txt': 'User-agent: *\nAllow: /\n'}, newsWs: OP});
  assert.equal((await w.cron({step: 'media', source: 'news-labortoday'})).ok, true);
  assert.equal(w.db.app_news_articles.length, 2, '새 줄 없음');
  const a = w.db.app_news_articles.find(x => x.id === id(70));
  assert.deepEqual([a.origin, a.lane, a.source_key], ['site', 'media', 'news-labortoday']);
  assert.equal(w.db.app_news_articles.find(x => x.id === id(71)).origin, 'user', '수집이 만나지 않은 공유 기사는 그대로(넣은 사람만)');
});

// ---- S68-25 NEWS 원문 robots 안 봄(사용자 결정 2026-11-22): 원문 미리 저장·다시 읽기·열기는 robots.txt를 읽지 않는다. 피드(RSS)는 그대로 지킨다. ----
const LT = 'https://www.labortoday.co.kr';
const ltPage = n => `${LT}/news/articleView.html?idxno=${n}`;
const LT_PAGE = `<html lang="ko"><head><meta property="og:title" content="합성 노동 기사"></head><body><article id="article-view-content-div"><p>${'합성 노동 기사 본문 문장이다. '.repeat(30)}</p></article></body></html>`;

test('S68-25 매체 단계: 피드는 robots.txt를 보고, 새 기사 원문은 robots.txt가 막아도 읽는다. 피드 뒤 원문 전에 GAP_MS 한 번 쉰다', async () => {
  const s = C.newsSourceByKey('news-labortoday');
  const rss = `<rss><channel><item><title>합성 노동 기사</title><link>${ltPage(1)}</link></item><item><title>합성 노동 기사 둘</title><link>${ltPage(2)}</link></item></channel></rss>`;
  const w = world({tables: {app_outside_sources: [{workspace_id: OP, source_key: s.key, enabled: true}]},
    sites: {[s.lists[0]]: rss, [`${LT}/robots.txt`]: 'User-agent: *\nDisallow: /news/\n', [ltPage(1)]: LT_PAGE, [ltPage(2)]: LT_PAGE}, newsWs: OP});
  const out = await w.cron({step: 'media', source: s.key});
  assert.equal(out.bodies, 2, '원문 2건 읽음');
  assert.equal(w.calls.site.filter(u => u.endsWith('/robots.txt')).length, 1, 'robots.txt는 피드 reader만 한 번');
  assert.deepEqual(w.calls.site.filter(u => u.includes('articleView')).sort(), [ltPage(1), ltPage(2)], '같은 기사는 한 번씩');
  assert.ok(w.db.app_news_articles.every(a => a.state === 'ok'));
  assert.ok(w.sleeps.includes(H.GAP_MS), '피드 → 원문 사이 같은 사이트 간격');
  // 피드 자체를 robots.txt가 막으면 피드는 읽지 않는다(피드 reader는 그대로).
  const w2 = world({tables: {app_outside_sources: [{workspace_id: OP, source_key: s.key, enabled: true}]},
    sites: {[s.lists[0]]: rss, [`${LT}/robots.txt`]: 'User-agent: *\nDisallow: /\n'}, newsWs: OP});
  const out2 = await w2.cron({step: 'media', source: s.key});
  assert.equal(out2.status, 'robots'); assert.equal(w2.calls.site.filter(u => u === s.lists[0]).length, 0, '막힌 피드는 부르지 않음');
});

test('S68-25 대기 단계: robots로 비어 있던 지난 기사는 한 번에 ROBOTS_RETRY_PER_RUN건까지만 새 것부터 다시 읽고, 기사마다 1번(다음 실행에 다시 고르지 않음)', async () => {
  const n = H.ROBOTS_RETRY_PER_RUN + 3;
  const arts = Array.from({length: n}, (_, i) => ({id: id(600 + i), origin: 'tg_room', lane: 'channel', url: `https://news.example.org/r/${i}`, url_key: `news.example.org/r/${i}`,
    state: 'robots', created_at: new Date(NOW - (i + 1) * 60000).toISOString()}));
  const old = {id: id(700), origin: 'tg_room', lane: 'channel', url: 'https://news.example.org/r/old', url_key: 'news.example.org/r/old', state: 'robots', created_at: new Date(NOW - (H.ROBOTS_RETRY_DAYS + 1) * 86400000).toISOString()};
  const sites = {'https://news.example.org/robots.txt': 'User-agent: *\nDisallow: /\n'};
  for (let i = 0; i < n - 1; i++) sites[`https://news.example.org/r/${i}`] = PAGE; // 마지막 하나는 없는 글(404)
  const w = world({tables: {app_news_articles: [...arts, old]}, sites});
  const out = await w.cron({step: 'pending'});
  assert.equal(out.robots_retry, H.ROBOTS_RETRY_PER_RUN, '한 번 실행당 상한');
  const read1 = w.calls.site.filter(u => u.includes('/r/'));
  assert.equal(read1.length, H.ROBOTS_RETRY_PER_RUN);
  assert.deepEqual(read1.sort(), arts.slice(0, H.ROBOTS_RETRY_PER_RUN).map(a => a.url).sort(), '새 것부터');
  assert.ok(!read1.includes(old.url), `받은 지 ${H.ROBOTS_RETRY_DAYS}일 넘은 기사는 읽지 않음`);
  assert.equal(w.calls.site.filter(u => u.endsWith('/robots.txt')).length, 0, 'robots.txt를 읽지 않음');
  // 다음 실행: 남은 것만(이미 다시 읽은 기사는 상태가 바뀌어 다시 고르지 않음). 없는 글(404)도 1번 읽고 끝.
  const out2 = await w.cron({step: 'pending'});
  assert.equal(out2.robots_retry, 3);
  const out3 = await w.cron({step: 'pending'});
  assert.equal(out3.robots_retry, 0, '무한 재시도 없음');
  const st = Object.fromEntries(w.db.app_news_articles.map(a => [a.url, a.state]));
  assert.equal(st[arts[n - 1].url], 'failed'); assert.equal(st[arts[0].url], 'ok'); assert.equal(st[old.url], 'robots');
  for (const u of arts.map(a => a.url)) assert.equal(w.calls.site.filter(x => x === u).length, 1, '기사마다 1번');
});

// ---- S69 NEWS-제목늘읽기(사용자 11/24 "제목은 읽어놔야 누르든 말든하지"): 원문 읽기에 실패해 제목 없이 남은 기사는 한 시간 뒤 대기 단계에서
// 그 주소 한 장만 다시 읽어 제목만 적는다(기사마다 한 번, 본문·상태는 그대로). 매체 기사·제목 있는 줄·띠 밖(막 실패·오래전 실패)은 고르지 않는다.
test('S69 제목 다시 읽기: 실패한 지 한 시간쯤 된 제목 없는 기사만 한 번, 그 주소 한 장만 읽어 제목만 적는다', async () => {
  const at = m => new Date(NOW - m * 60000).toISOString();
  const TPAGE = '<html><head><meta property="og:title" content="합성 다시 읽은 제목"></head><body>짧은 글</body></html>';
  const mk = (n, o) => ({id: id(900 + n), origin: 'tg_scrap', lane: 'channel', url: `https://news.example.org/t/${n}`, url_key: `news.example.org/t/${n}`, state: 'failed', title: null, created_at: at(200), ...o});
  const arts = [mk(1, {fetched_at: at(70)}), mk(2, {fetched_at: at(70)}), mk(3, {fetched_at: at(10)}), mk(4, {fetched_at: at(300)}),
    mk(5, {fetched_at: at(70), title: '있는 제목'}), mk(6, {fetched_at: at(70), lane: 'media', origin: 'site', source_key: 'news-labortoday'})];
  const w = world({tables: {app_news_articles: arts, app_news_items: [{id: id(901), workspace_id: OP, lane: 'channel', url: arts[0].url, url_key: arts[0].url_key, state: 'failed', title: null, created_at: at(200)}]},
    sites: {'https://news.example.org/t/1': TPAGE}}); // t/2는 없는 글(404)
  const out = await w.cron({step: 'pending'});
  assert.deepEqual([out.head_retry, out.head_read], [2, 1]);
  assert.deepEqual(w.calls.site.filter(u => u.includes('/t/')).sort(), ['https://news.example.org/t/1', 'https://news.example.org/t/2'], '띠 안 제목 없는 채널 기사만, 한 장씩');
  assert.equal(w.calls.site.filter(u => u.endsWith('/robots.txt')).length, 0);
  const a = Object.fromEntries(w.db.app_news_articles.map(r => [r.url.split('/').pop(), r]));
  assert.equal(a[1].title, '합성 다시 읽은 제목'); assert.ok(a[1].title_key); assert.equal(a[1].state, 'failed', '상태·본문은 그대로');
  assert.equal(w.db.app_news_items[0].title, '합성 다시 읽은 제목', '같은 주소 옛 줄도');
  assert.equal(a[2].title, null); assert.equal(a[2].fetched_at, at(70), '못 읽으면 아무것도 바꾸지 않음');
  assert.equal(a[5].title, '있는 제목');
});

test('S68-25 open: robots로 비어 있던 기사를 열면 그 한 쪽만 읽어 저장 → 다시 열면 저장본(원문 0)', async () => {
  const url = 'https://news.example.org/o/1';
  const w = world({tables: {app_news_articles: [{id: id(800), origin: 'tg_room', lane: 'channel', url, url_key: 'news.example.org/o/1', state: 'robots', created_at: recent}],
    app_news_article_bodies: [{article_id: id(800), blocks: [], state: 'failed', reason: 'robots', rule: 'open@1', chars: 0, images: 0}]},
  sites: {'https://news.example.org/robots.txt': 'User-agent: *\nDisallow: /\n', [url]: PAGE}});
  const r = await w.user('open', {id: id(800)});
  assert.equal(r.status, 200); assert.equal(r.body.status, 'ok');
  assert.deepEqual(w.calls.site, [url], '그 기사 한 쪽만(robots.txt 없음, 다른 기사 없음)');
  const a = w.db.app_news_articles[0], b = w.db.app_news_article_bodies[0];
  assert.deepEqual([a.state, a.body_kind, b.state], ['ok', 'full', 'ok'], '기존 원문 칸에 저장');
  const again = await w.user('open', {id: id(800)});
  assert.equal(again.body.status, 'stored'); assert.equal(w.calls.site.length, 1, '다시 열면 읽지 않음');
});

// S68-40(사용자 11/23 "아까 사진 넣었는데 없어짐"): 손으로 본문(글·내가 올린 사진)을 넣은 공용 기사는 원문 다시 뽑기·수집이 덮지 않는다.
// 같은 주소의 다른 작업공간 옛 줄이 다시 뽑기(refill)에 걸려 원문을 읽어도, 공용 기사 본문 블록·제목·본문 칸은 손으로 넣은 그대로.
test('S68-40: 손으로 넣은 기사 본문(사진 블록 포함)은 다시 뽑기가 덮지 않는다 — 손으로 넣지 않은 기사는 그대로 새 결과로', async () => {
  const LONGKO = '노동자들은 오늘 합성 견본 기사 문단을 차례로 읽는다. 이 문단은 시험용으로 지어낸 글이다. '.repeat(5);
  const page = `<html><head><meta property="og:title" content="합성 사이트 제목"></head><body><article id="article-view-content-div"><p>${LONGKO}</p></article></body></html>`;
  const url = 'https://www.beminor.com/news/articleView.html?idxno=4040', key = 'beminor.com/news/articleView.html?idxno=4040';
  const own = 'https://photo.web2.invalid/fakeDriveFile0001.png';
  const handBlocks = [{t: 'p', text: 'https://example.org/some/long/address'}, {t: 'img', src: own, cap: null, alt: null}];
  const make = manual => world({tables: {
    app_news_articles: [{id: id(61), origin: 'site', lane: 'media', source_key: 'news-beminor', url, url_key: key, state: 'ok', body_kind: 'full', title: '손으로 넣은 제목',
      body: 'https://example.org/some/long/address', manual_at: manual ? recent : null, created_at: recent}],
    app_news_article_bodies: [{article_id: id(61), blocks: structuredClone(handBlocks), state: 'ok', reason: null, rule: H.HAND_RULE, chars: 37, images: 1}],
    app_news_items: [{id: id(60), workspace_id: OP, lane: 'media', source_key: 'news-beminor', url, url_key: key, title: null, state: 'failed', created_at: recent}],
  }, sites: {[url]: page}});
  const w = make(true);
  const out = await w.cronAt('refill', {source: 'news-beminor'});
  assert.equal(out.done, 1, '옛 줄은 다시 뽑기에 걸려 원문을 읽는다');
  assert.equal(w.calls.site.filter(u => u === url).length, 1);
  const a = w.db.app_news_articles[0], b = w.db.app_news_article_bodies[0];
  assert.deepEqual(b.blocks, handBlocks, '손 본문 블록(사진 포함) 그대로');
  assert.equal(b.rule, H.HAND_RULE);
  assert.equal(a.title, '손으로 넣은 제목'); assert.equal(a.body, 'https://example.org/some/long/address');
  assert.equal(w.calls.rest.filter(c => c.method !== 'GET' && (c.p === 'app_news_article_bodies' || (c.p === 'app_news_articles' && c.q.includes(id(61))))).length, 0, '공용 기사·본문 쓰기 0');
  assert.equal(w.db.app_news_items[0].state, 'ok', '옛 줄은 새 결과');
  assert.equal(H.handOwned({manual_at: recent, body_kind: 'full'}), true);
  assert.equal(H.handOwned({manual_at: recent, body_kind: null}), false, '제목만 고친 못 읽은 기사는 다시 읽어 채울 수 있다');
  assert.equal(H.handOwned({manual_at: null, body_kind: 'full'}), false);
  // 대조: 손으로 넣지 않은 기사면 같은 다시 뽑기가 새 결과로 고친다(이 시험이 실제로 덮어쓰기를 잡는지 확인).
  const v = make(false);
  await v.cronAt('refill', {source: 'news-beminor'});
  assert.notDeepEqual(v.db.app_news_article_bodies[0].blocks, handBlocks);
});

// ---- S69-02(사용자 11/24 06:40 조선일보 '원문 다시 불러오기를 눌러도 원문을 못 가져오네') ----------------------------------------------
// 수집 때 본문을 읽지 않는 매체(카탈로그 extract:false — 조선일보 등)의 기사는 피드 소개(리드)만 저장돼 있었고, 사람이 열어 읽어도 본문 블록을 저장하지 않았다.
// 이제 사람이 연 읽기(open)는 그 매체도 본문 블록(문단·소제목·사진)을 저장한다. 페이지는 지어낸 Arc 모양(문장도 지어냄).
const ARC_P = n => `합성 기사 ${n}번째 문단이다. 노동자들은 지어낸 도시에서 지어낸 일자리 이야기를 차례로 나눈다. `.repeat(2).trim();
const ARC_PAGE = `<html lang="ko"><head><meta property="og:title" content="합성 Arc 기사"><meta property="og:description" content="합성 소개 한 문단."></head><body>
<div id="fusion-app"></div><script>window.Fusion=window.Fusion||{};Fusion.globalContent=${JSON.stringify({content_elements: [
  {type: 'text', content: ARC_P(1)}, {type: 'header', content: '합성 소제목'}, {type: 'image', url: 'https://images.example.org/arc/photo1.jpg', caption: '합성 사진 설명'},
  {type: 'text', content: ARC_P(2)}, {type: 'text', content: ARC_P(3)}, {type: 'text', content: '<a href="https://www.chosun.com/x">전체 내용보기</a>'}]})};Fusion.globalContentConfig={};</script></body></html>`;
const chosunArt = (n, extra = {}) => ({id: id(n), origin: 'site', lane: 'media', source_key: 'news-chosun', url: `https://www.chosun.com/national/2026/11/12/S69${n}/`, url_key: `www.chosun.com/national/2026/11/12/S69${n}`,
  state: 'ok', lang: 'ko', title: '합성 조선 기사', publisher: '조선일보', summary: '합성 소개 한 문단.', body: '합성 소개 한 문단.', body_kind: 'lead', fetched_at: recent, created_at: recent, ...extra});
const chosunSites = n => ({'https://www.chosun.com/robots.txt': 'User-agent: *\nAllow: /\n', [`https://www.chosun.com/national/2026/11/12/S69${n}/`]: ARC_PAGE});

test('S69-02 open: extract:false 매체(조선일보) 리드 기사를 사람이 열면 전문을 읽어 본문 블록(문단·소제목·사진)으로 저장, 사이트 링크 글자는 빠짐', async () => {
  assert.equal(C.newsSourceByKey('news-chosun').extract, false, '수집 때는 본문을 읽지 않는 매체');
  const w = world({tables: {app_news_articles: [chosunArt(70)]}, sites: chosunSites(70)});
  const r = await w.user('open', {id: id(70)});
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.status, 'ok');
  const a = w.db.app_news_articles[0];
  assert.equal(a.body_kind, 'full');
  assert.equal(w.db.app_news_article_bodies.length, 1, '사람이 연 읽기는 본문 블록을 저장');
  const b = w.db.app_news_article_bodies[0];
  assert.equal(b.state, 'ok');
  assert.deepEqual(b.blocks.map(x => x.t), ['p', 'h', 'img', 'p', 'p']);
  assert.equal(b.blocks[2].src, 'https://images.example.org/arc/photo1.jpg'); assert.equal(b.blocks[2].cap, '합성 사진 설명');
  assert.ok(!JSON.stringify(b.blocks).includes('전체 내용보기'), '사이트 링크 글자는 본문 문단이 아님');
  assert.ok(!a.body.includes('전체 내용보기'));
});

test('S69-02 open again: 전문이 있는 글도 ⋯ 다시 가져오기 — 간격 안이면 recent(읽기 0), 더 긴 전문이면 바꾸고, 같거나 짧으면 same(쓰기 0)', async () => {
  const old = new Date(NOW - 3 * 3600000).toISOString();
  const shortBody = {article_id: id(71), state: 'ok', reason: null, rule: 'news-chosun@1', blocks: [{t: 'p', text: '짧은 옛 본문.'}], chars: 7, images: 0};
  // 간격 안
  const w0 = world({tables: {app_news_articles: [chosunArt(71, {body_kind: 'full', body: '짧은 옛 본문.', fetched_at: new Date(NOW - 60000).toISOString()})], app_news_article_bodies: [{...shortBody}]}, sites: chosunSites(71)});
  assert.equal((await w0.user('open', {id: id(71), again: true})).body.status, 'recent');
  assert.equal(w0.calls.site.length, 0); assert.equal(w0.db.app_news_days.length, 0, '하루 한도 안 씀');
  // again 없이: 예전처럼 저장본
  const w1 = world({tables: {app_news_articles: [chosunArt(71, {body_kind: 'full', body: '짧은 옛 본문.', fetched_at: old})], app_news_article_bodies: [{...shortBody}]}, sites: chosunSites(71)});
  assert.equal((await w1.user('open', {id: id(71)})).body.status, 'stored');
  assert.equal(w1.calls.site.length, 0);
  // 더 긴 전문 → 바꿈
  const r = await w1.user('open', {id: id(71), again: true});
  assert.equal(r.body.status, 'ok');
  assert.equal(w1.db.app_news_article_bodies[0].blocks.length, 5);
  assert.ok(w1.db.app_news_article_bodies[0].chars > 7);
  // 같은 길이(이미 긴 본문) → same, 고치지 않음
  const long = structuredClone(w1.db.app_news_article_bodies[0]);
  const w2 = world({tables: {app_news_articles: [chosunArt(72, {body_kind: 'full', body: '합성', fetched_at: old})], app_news_article_bodies: [{...long, article_id: id(72)}]}, sites: chosunSites(72)});
  assert.equal((await w2.user('open', {id: id(72), again: true})).body.status, 'same');
  assert.ok(!w2.calls.rest.some(c => ['POST', 'PATCH'].includes(c.method) && /article_bodies|app_news_articles/.test(c.p)), '같으면 쓰지 않음');
  // 손 본문은 다시 읽지 않음, 이상한 몸통은 거절
  const w3 = world({tables: {app_news_articles: [chosunArt(73, {body_kind: 'full', body: '손', fetched_at: old})], app_news_article_bodies: [{...shortBody, article_id: id(73), rule: 'manual@1'}]}, sites: chosunSites(73)});
  assert.equal((await w3.user('open', {id: id(73), again: true})).body.status, 'stored');
  assert.equal(w3.calls.site.length, 0);
  for (const bad of [{id: id(73), again: false}, {id: id(73), again: 'yes'}, {id: id(73), again: true, x: 1}]) assert.equal((await w3.user('open', bad)).status, 400, JSON.stringify(bad));
});

test("S69-02 매체 단계: 피드 소개·본문 끝 '전체 내용보기' 링크 줄은 떼고, 그 줄이 붙은 피드 본문은 전문으로 치지 않는다(사람이 열 때 글 쪽을 읽음)", async () => {
  const s = C.newsSourceByKey('news-redaily');
  const long = '지어낸 철도 계획 문단이다. 지어낸 노선과 지어낸 예산을 길게 설명한다. '.repeat(6);
  const rss = `<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<item><title>합성 철도망 기사</title><link>https://www.redaily.co.kr/news/articleView.html?idxno=1</link>
<description><![CDATA[<p>합성 첫 문단.</p><p>합성 둘째 문단.</p><p><a href="https://www.redaily.co.kr/news/articleView.html?idxno=1">전체 내용보기</a></p>]]></description>
<content:encoded><![CDATA[<p>${long}</p><p><a href="https://www.redaily.co.kr/news/articleView.html?idxno=1">전체 내용보기</a></p>]]></content:encoded></item>
<item><title>합성 버스 기사</title><link>https://www.redaily.co.kr/news/articleView.html?idxno=2</link><description>합성 소개만.</description><content:encoded><![CDATA[<p>${long}</p>]]></content:encoded></item>
</channel></rss>`;
  const w = world({tables: {app_outside_sources: [{workspace_id: OP, source_key: 'news-redaily', enabled: true}]},
    sites: {[s.lists[0]]: rss, 'https://www.redaily.co.kr/robots.txt': 'User-agent: *\nAllow: /\n'}, newsWs: OP});
  assert.equal((await w.cron({step: 'media', source: 'news-redaily'})).ok, true);
  const rail = w.db.app_news_articles.find(a => a.title.includes('철도'));
  const bus = w.db.app_news_articles.find(a => a.title.includes('버스'));
  assert.ok(rail && bus);
  assert.equal(rail.body_kind, 'lead', '링크 줄이 붙은 피드 본문은 앞부분뿐');
  assert.ok(!rail.body.includes('전체 내용보기')); assert.ok(rail.body.includes('합성 둘째 문단'));
  assert.equal(bus.body_kind, 'full', '링크 줄 없는 피드 본문은 예전처럼 전문');
});
