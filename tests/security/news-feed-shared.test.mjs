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
function world({tables = {}, sites = {}, ai = {summary: '합성 한 문장 요약.'}, members = [{user_id: USER, workspace_id: WS2}]} = {}) {
  const db = {app_news_articles: [], app_news_items: [], app_news_marks: [], app_outside_sources: [], app_news_keywords: [], app_news_days: [], ...structuredClone(tables)};
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
    calls.rest.push({method, p, q: u.search, body, prefer: init.headers?.Prefer});
    if (p === 'rpc/app_operator_feature_workspace') return res(OP);
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
  const h = H.createNewsFeedHandler({env: n => ({SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role-key', NEWS_FEED_CRON_SECRET: SECRET, WEB2_OPENAI_API_KEY: 'synthetic-openai-key-000000000000'})[n], fetch: doFetch, now: () => NOW, sleep: async () => {}, log: () => {}});
  const cron = async b => (await h(new Request(`${FN}?action=run`, {method: 'POST', headers: {[H.CRON_HEADER]: SECRET, 'content-type': 'application/json'}, body: JSON.stringify(b)}))).json();
  const user = async (action, b) => { const r = await h(new Request(`${FN}?action=${action}`, {method: 'POST', headers: {authorization: `Bearer ${JWT}`, 'content-type': 'application/json'}, body: JSON.stringify(b)})); return {status: r.status, body: await r.json()}; };
  return {db, calls, cron, user};
}
const recent = new Date(NOW - 3600000).toISOString();

test('매체 단계: 두 작업공간이 같은 매체를 켜도 공용 기사는 한 줄(작업공간·키워드 칸 없음), 키워드는 각자 표시로, 운영자 옛 줄은 같은 id', async () => {
  const s = C.newsSourceByKey('news-labortoday');
  const rss = `<rss><channel><item><title>합성 철도 파업 기사</title><link>https://www.labortoday.co.kr/news/articleView.html?idxno=1</link><description>합성 소개</description></item>
<item><title>합성 버스 기사</title><link>https://www.labortoday.co.kr/news/articleView.html?idxno=2</link></item></channel></rss>`;
  const w = world({tables: {
    app_outside_sources: [{workspace_id: OP, source_key: 'news-labortoday', enabled: true}, {workspace_id: WS2, source_key: 'news-labortoday', enabled: true}],
    app_news_keywords: [{workspace_id: OP, word: '철도', enabled: true, created_at: '1'}, {workspace_id: WS2, word: '버스', enabled: true, created_at: '1'}],
  }, sites: {[s.lists[0]]: rss, 'https://www.labortoday.co.kr/robots.txt': 'User-agent: *\nAllow: /\n'}});
  const out = await w.cron({step: 'media', source: 'news-labortoday'});
  assert.equal(out.ok, true);
  assert.equal(w.db.app_news_articles.length, 2, '기사마다 한 줄');
  for (const a of w.db.app_news_articles) {
    assert.equal(a.origin, 'site');
    for (const k of ['workspace_id', 'keywords', 'starred_at', 'hidden_at', 'folder_id']) assert.ok(!(k in a), `공용 기사에 ${k} 칸 없음`);
  }
  assert.equal(w.db.app_news_items.length, 4, '옮기는 동안 옛 표에도 작업공간마다');
  const rail = w.db.app_news_articles.find(a => a.title.includes('철도'));
  assert.equal(w.db.app_news_items.find(r => r.workspace_id === OP && r.url_key === rail.url_key).id, rail.id, '운영자 옛 줄 id = 공용 id');
  assert.notEqual(w.db.app_news_items.find(r => r.workspace_id === WS2 && r.url_key === rail.url_key).id, rail.id);
  const marks = w.db.app_news_marks.map(m => [m.workspace_id, w.db.app_news_articles.find(a => a.id === m.article_id).title, m.keywords]).sort();
  assert.deepEqual(marks, [[OP, '합성 철도 파업 기사', ['철도']], [WS2, '합성 버스 기사', ['버스']]], '자기 키워드만 자기 표시에');
  // 두 번째 실행: 공용 기사·표시는 늘지 않음.
  await w.cron({step: 'media', source: 'news-labortoday'});
  assert.equal(w.db.app_news_articles.length, 2);
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

test('제목 번역: 같은 외국어 기사를 두 작업공간이 가져도 AI 1번, 이미 번역된 공용 기사는 옮겨 적기만(AI 0)', async () => {
  const mk = (n, ws, key) => ({id: id(n), workspace_id: ws, lane: 'media', url: `https://${key}`, url_key: key, lang: 'en', title: `Synthetic title ${key}`, summary: 'Synthetic lead.', created_at: recent});
  const w = world({ai: {titles: [{i: 1, ko: '합성 제목 번역', sum_ko: '합성 소개 번역'}]}, tables: {
    app_news_articles: [{id: id(10), origin: 'site', lane: 'media', url: 'https://x.example.org/1', url_key: 'x.example.org/1', lang: 'en', title: 'Synthetic title x.example.org/1', summary: 'Synthetic lead.', state: 'ok', created_at: recent},
      {id: id(11), origin: 'site', lane: 'media', url: 'https://x.example.org/2', url_key: 'x.example.org/2', lang: 'en', title: 'T2', title_ko: '이미 있는 번역', summary: '이미 한국어 소개', translated_at: recent, state: 'ok', created_at: recent}],
    app_news_items: [mk(12, OP, 'x.example.org/1'), mk(13, WS2, 'x.example.org/1'), mk(14, WS2, 'x.example.org/2')],
  }});
  await w.cron({step: 'titles'});
  assert.equal(w.calls.ai, 1, '기사마다 한 번');
  assert.equal(w.db.app_news_articles[0].title_ko, '합성 제목 번역');
  for (const r of w.db.app_news_items.slice(0, 2)) assert.deepEqual([r.title_ko, r.summary], ['합성 제목 번역', '합성 소개 번역']);
  assert.deepEqual([w.db.app_news_items[2].title_ko, w.db.app_news_items[2].summary], ['이미 있는 번역', '이미 한국어 소개'], '옮겨 적기');
  assert.deepEqual(w.db.app_news_days.map(d => d.workspace_id), [OP], 'AI는 운영자 작업공간에 셈');
});

test('키워드 표시: 공용 기사 하나에 작업공간마다 자기 키워드만, 끈 키워드는 비움(별표는 그대로)', async () => {
  const w = world({tables: {
    app_news_articles: [{id: id(20), origin: 'site', lane: 'media', url: 'https://k.example.org/1', url_key: 'k.example.org/1', title: '합성 철도 버스 기사', state: 'ok', created_at: recent}],
    app_news_keywords: [{workspace_id: OP, word: '철도', enabled: true, created_at: '1'}, {workspace_id: WS2, word: '버스', enabled: true, created_at: '1'}],
    app_outside_sources: [{workspace_id: 'a0000000-0000-4000-8000-000000000003', source_key: 'news-khan', enabled: true}],
    app_news_marks: [{workspace_id: 'a0000000-0000-4000-8000-000000000003', article_id: id(20), keywords: ['옛말'], starred_at: recent}],
  }});
  const out = await w.cron({step: 'keywords'});
  assert.equal(out.marks, 3);
  const m = Object.fromEntries(w.db.app_news_marks.map(x => [x.workspace_id, x]));
  assert.deepEqual(m[OP].keywords, ['철도']); assert.deepEqual(m[WS2].keywords, ['버스']);
  assert.deepEqual(m['a0000000-0000-4000-8000-000000000003'].keywords, []); assert.equal(m['a0000000-0000-4000-8000-000000000003'].starred_at, recent);
});

test('[번역] 재사용: 같은 본문의 공용 기사에 번역이 있으면 AI·하루 한도 없이 저장본, 처음 번역은 공용 기사에도 저장', async () => {
  const key = 'n.example.org/1', base = {lane: 'media', url: 'https://n.example.org/1', url_key: key, lang: 'en', title: 'T', body: 'Synthetic body.', body_kind: 'full', state: 'ok', created_at: recent};
  const w = world({ai: {title_ko: '합성 제목', body_ko: '합성 본문 번역'}, tables: {
    app_news_articles: [{id: id(30), origin: 'site', ...base}],
    app_news_items: [{id: id(31), workspace_id: WS2, ...base}],
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
