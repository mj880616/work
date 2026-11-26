// S67-02 NEWS-직접넣기: news-feed ?action=hand_fill — 원문을 못 읽은(또는 잘못 읽은) 기사에 사람이 제목·매체·기자·기사 시각·본문을 넣는다.
// 시험: 로그인·운영자 기능 키(outside) 작업공간만, 읽을 수 있는 공용 기사만, 몸통 칸·길이·날짜 검사, 글자로만 저장(태그 그대로 글자),
// 공용 기사·본문 블록(manual@1)·내 옛 줄에 같은 값, 옛 번역·요약·내 '자세히' 저장본 지움, 본문 없이 보내면 본문은 그대로, 바깥 사이트·AI 안 부름.
// 네트워크 없음(합성 글·example 주소).
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
const FULL = {id: ART, title: '합성 파업 기사 제목', publisher: '합성 매체', author: '합성 기자', published_at: '2026-11-18T21:10:00.000Z',
  body: '첫 문단입니다 <b>굵게</b> <script>x()</script>.\n\n둘째 문단입니다.\n이어지는 줄.'};

test('hand_fill: login, owner and the operator feature key are required; cron key cannot use it', async () => {
  const w = world();
  assert.equal((await w.call(FULL, {auth: null})).status, 401);
  assert.equal((await w.call(FULL, {auth: 'Bearer bad.jwt.value-000000000000'})).status, 401);
  assert.deepEqual(await out(await w.call(FULL, {auth: null, headers: {'x-news-feed-cron-secret': SECRET}})), {status: 400, body: {ok: false, error: 'UNKNOWN_ACTION'}});
  // 운영자 기능 키 작업공간이 아니면 읽기·쓰기 없이 403.
  const v = world({newsWs: OTHER});
  assert.deepEqual(await out(await v.call(FULL)), {status: 403, body: {ok: false, error: 'FEATURE_OFF'}});
  assert.equal(v.calls.writes.length, 0);
  // owner 행이 없거나 둘이면 403.
  for (const members of [[], [{user_id: USER, workspace_id: WS}, {user_id: USER, workspace_id: OTHER}]]) {
    const m = world({members});
    assert.equal((await m.call(FULL)).status, 403);
    assert.equal(m.calls.writes.length, 0);
  }
  assert.equal(w.calls.writes.length, 0);
});

test('hand_fill: only an article the person can read; body fields are checked', async () => {
  const w = world({articles: [baseArt(), baseArt({id: HIDDEN, url_key: 'news.example.org/h', origin: 'tg_scrap'})]});
  assert.deepEqual(await out(await w.call({...FULL, id: HIDDEN})), {status: 404, body: {ok: false, error: 'NOT_FOUND'}});
  assert.deepEqual(await out(await w.call({...FULL, id: 'c0000000-0000-4000-8000-000000000077'})), {status: 404, body: {ok: false, error: 'NOT_FOUND'}});
  const bad = [
    [{...FULL, id: 'x'}, 'INVALID_BODY'],
    [{...FULL, extra: 1}, 'INVALID_BODY'],
    [(({author: _a, ...r}) => r)(FULL), 'INVALID_BODY'],
    [{...FULL, title: 7}, 'INVALID_TITLE'],
    [{...FULL, title: '가'.repeat(301)}, 'INVALID_TITLE'],
    [{...FULL, publisher: '가'.repeat(61)}, 'INVALID_PUBLISHER'],
    [{...FULL, author: '가'.repeat(81)}, 'INVALID_AUTHOR'],
    [{...FULL, author: 3}, 'INVALID_AUTHOR'],
    [{...FULL, published_at: '어제'}, 'INVALID_DATE'],
    [{...FULL, published_at: '2026-11-18'}, 'INVALID_DATE'],
    [{...FULL, published_at: '1980-01-01T00:00:00Z'}, 'INVALID_DATE'],
    [{...FULL, published_at: '2026-12-30T00:00:00Z'}, 'INVALID_DATE'],
    [{...FULL, body: 7}, 'INVALID_TEXT'],
    // S68-44: 제목·원문 주소·본문(글·사진)이 모두 빈 요청은 빈 기사라 거절.
    [{...FULL, title: '   ', body: ''}, 'EMPTY_ARTICLE'],
    [{...FULL, title: null, body: ' \n \n'}, 'EMPTY_ARTICLE'],
    [{id: ART, title: '', publisher: '합성 매체', author: null, published_at: null}, 'EMPTY_ARTICLE'],
    [{...FULL, body: '가'.repeat(50001)}, 'INVALID_TEXT'],
    [{...FULL, body: null}, 'INVALID_TEXT'],
  ];
  for (const [b, code] of bad) assert.deepEqual(await out(await w.call(b)), {status: 400, body: {ok: false, error: code}}, JSON.stringify(b).slice(0, 80));
  assert.equal((await w.call(null, {raw: '[1]'})).status, 400);
  assert.equal(w.calls.writes.length, 0);
  assert.deepEqual(w.db.app_news_articles[0], baseArt());
});

test('hand_fill: saves text only to the shared article, its body blocks (manual@1) and my old row; clears stale translation, summary and my detail', async () => {
  const w = world({
    articles: [baseArt({title_ko: '옛 번역 제목', body_ko: '옛 번역', translated_at: '2026-11-18T22:40:00Z', summary: '옛 요약'})],
    olds: [{id: OLD, workspace_id: WS, lane: 'channel', url: 'https://news.example.org/a/1', url_key: 'news.example.org/a/1', title: null, state: 'failed', fetched_at: null}],
    bodies: [{article_id: ART, blocks: [], state: 'failed', reason: 'timeout', rule: 'open@3', chars: 0, images: 0}],
    details: [{workspace_id: WS, article_id: ART}, {workspace_id: OTHER, article_id: ART}],
  });
  assert.deepEqual(await out(await w.call(FULL)), {status: 200, body: {ok: true, status: 'filled', id: ART}});
  const a = w.db.app_news_articles[0];
  assert.equal(a.title, '합성 파업 기사 제목'); assert.equal(a.publisher, '합성 매체'); assert.equal(a.author, '합성 기자');
  assert.equal(a.published_at, '2026-11-18T21:10:00.000Z'); assert.equal(a.manual_at, new Date(NOW).toISOString());
  assert.equal(a.state, 'ok'); assert.equal(a.body_kind, 'full');
  assert.equal(a.body, '첫 문단입니다 <b>굵게</b> <script>x()</script>.\n둘째 문단입니다. 이어지는 줄.');
  assert.deepEqual([a.title_ko, a.body_ko, a.translated_at, a.summary], [null, null, null, null]);
  assert.equal(a.url, 'https://news.example.org/a/1', 'the original address stays');
  const bd = w.db.app_news_article_bodies;
  assert.equal(bd.length, 1);
  assert.deepEqual({state: bd[0].state, reason: bd[0].reason, rule: bd[0].rule, images: bd[0].images}, {state: 'ok', reason: null, rule: 'manual@1', images: 0});
  // 태그는 해석하지 않고 글자 그대로 문단 블록에.
  assert.deepEqual(bd[0].blocks, [{t: 'p', text: '첫 문단입니다 <b>굵게</b> <script>x()</script>.'}, {t: 'p', text: '둘째 문단입니다. 이어지는 줄.'}]);
  assert.equal(bd[0].chars, [...'첫 문단입니다 <b>굵게</b> <script>x()</script>.둘째 문단입니다. 이어지는 줄.'].length);
  const o = w.db.app_news_items[0];
  assert.equal(o.title, '합성 파업 기사 제목'); assert.equal(o.state, 'ok'); assert.equal('author' in o, false, 'old table has no author column');
  assert.equal(w.db.app_feed_bodies[0]?.rule, 'manual@1');
  // 내 '자세히'만 지우고 다른 작업공간 것은 그대로.
  assert.deepEqual(w.db.app_news_now_details, [{workspace_id: OTHER, article_id: ART}]);
  assert.deepEqual(w.db.app_now_details.map(d => d.workspace_id), [OTHER]);
  assert.equal(w.calls.site, 0, 'no outside site is read'); assert.equal(w.calls.ai, 0);
  // 다른 작업공간 줄에는 쓰지 않는다.
  assert.ok(w.calls.writes.filter(x => x.p === 'app_news_items' || x.p.endsWith('details')).every(x => x.q.includes(`workspace_id=eq.${WS}`)), JSON.stringify(w.calls.writes.map(x => x.q)));
});

test('hand_fill: without body only the head changes; empty optional fields are saved empty; read body stays', async () => {
  const blocks = [{t: 'p', text: '읽어 온 본문.'}, {t: 'img', src: 'https://img.example.org/a.jpg', cap: null, alt: null}];
  const w = world({articles: [baseArt({title: '잘못 읽은 제목', publisher: '옛 매체', state: 'ok', body: '읽어 온 본문.', body_kind: 'full', title_ko: 'old', body_ko: '번역 본문', translated_at: '2026-11-18T22:40:00Z', summary: '요약'})],
    bodies: [{article_id: ART, blocks, state: 'ok', reason: null, rule: 'open@3', chars: 7, images: 1}]});
  const r = await out(await w.call({id: ART, title: '  바로잡은\t제목  ', publisher: '', author: null, published_at: null}));
  assert.equal(r.status, 200);
  const a = w.db.app_news_articles[0];
  assert.equal(a.title, '바로잡은 제목'); assert.equal(a.publisher, null); assert.equal(a.author, null); assert.equal(a.published_at, null);
  assert.equal(a.body, '읽어 온 본문.'); assert.equal(a.summary, '요약');
  assert.equal(a.title_ko, null, 'old title translation is cleared'); assert.equal(a.body_ko, '번역 본문'); assert.equal(a.translated_at, '2026-11-18T22:40:00Z');
  assert.deepEqual(w.db.app_news_article_bodies[0].blocks, blocks, 'body blocks (photos too) are kept');
});

test('hand_fill: large pasted bodies fit the block limit; paragraph splitting', async () => {
  const lines = Array.from({length: 900}, (_, i) => `줄 ${i + 1}`).join('\n');
  const w = world();
  assert.equal((await w.call({...FULL, body: lines})).status, 200);
  const bd = w.db.app_news_article_bodies[0];
  assert.ok(bd.blocks.length <= 400 && bd.blocks.length > 200, String(bd.blocks.length));
  assert.ok(bd.blocks[0].text.startsWith('줄 1 줄 2'));
  assert.equal(H.handParagraphs('a\r\n\r\nb\u0007c\n\n\n').join('|'), 'a|b c');
});

// S67-05 NEWS-직접넣기 사진: 본문 안 사진 주소 한 줄 → 그 자리에 사진 블록, 바로 다음 '사진:'·'ⓒ'·'▲' 줄은 설명. 주소는 모양만 검사(받으러 가지 않음).
test('hand_fill photos: a photo address line becomes an image block in place, with its caption line', async () => {
  const w = world();
  const body = '첫 문단.\n\nhttps://img.example.org/2026/11/a.jpg\n사진: 합성 현장 모습\n\n둘째 문단.\n\nhttps://cdn.example.org/view?id=7#사진\n\nⓒ 합성 매체\n\n셋째 문단.';
  assert.equal((await w.call({...FULL, body})).status, 200);
  const bd = w.db.app_news_article_bodies[0];
  assert.deepEqual(bd.blocks, [
    {t: 'p', text: '첫 문단.'},
    {t: 'img', src: 'https://img.example.org/2026/11/a.jpg', cap: '합성 현장 모습', alt: null},
    {t: 'p', text: '둘째 문단.'},
    {t: 'img', src: 'https://cdn.example.org/view?id=7', cap: 'ⓒ 합성 매체', alt: null},
    {t: 'p', text: '셋째 문단.'},
  ]);
  assert.equal(bd.images, 2);
  assert.equal(bd.chars, [...'첫 문단.둘째 문단.셋째 문단.'].length, 'photo addresses and captions are not body text');
  assert.equal(w.db.app_news_articles[0].body, '첫 문단.\n둘째 문단.\n셋째 문단.');
  assert.equal(w.db.app_feed_bodies.length, 0);
  assert.equal(w.calls.site, 0, 'the photo address is not fetched');
});

test('hand_fill photos: unsafe or non-photo addresses stay as text; caption only right after a photo', async () => {
  const bad = ['http://img.example.org/a.jpg', 'javascript:alert(1)//a.jpg', 'data:image/png;base64,AAAA', 'https://user:pw@img.example.org/a.jpg',
    'https://img.example.org:8443/a.jpg', 'https://img.example.org/page.html', 'https://img.example.org/a.jpg 설명', 'https://localhost/a.jpg',
    'https://img.example.org/' + 'a'.repeat(2001) + '.jpg'];
  for (const line of bad) {
    assert.equal(H.handPhotoSrc(line), null, line.slice(0, 60));
    assert.deepEqual(H.handBlocks(`앞.\n${line}\n사진: 설명`).map(b => b.t), ['p', 'p', 'p'], line.slice(0, 60));
  }
  assert.equal(H.handPhotoSrc('  https://img.example.org/a.PNG  '), 'https://img.example.org/a.PNG');
  assert.equal(H.handPhotoSrc('https://img.example.org/한글.webp'), 'https://img.example.org/%ED%95%9C%EA%B8%80.webp');
  // 사진 뒤가 아닌 설명 머리 줄은 글자 그대로.
  assert.deepEqual(H.handBlocks('▲ 사진 없이 쓴 줄\n본문'), [{t: 'p', text: '▲ 사진 없이 쓴 줄'}, {t: 'p', text: '본문'}]);
  // 사진 뒤 줄이 설명 머리말이 아니면 글자 문단.
  assert.deepEqual(H.handBlocks('https://img.example.org/a.gif\n그냥 문단'), [{t: 'img', src: 'https://img.example.org/a.gif', cap: null, alt: null}, {t: 'p', text: '그냥 문단'}]);
  // 설명은 300자까지.
  assert.equal(H.handBlocks(`https://img.example.org/a.gif\n사진: ${'가'.repeat(400)}\n본문`)[0].cap.length, 300);
});

// S68-44(사용자 11/23 "본문 글자 없이도 저장되게"): 본문 글자는 필수가 아니다 — 사진만, 비운 본문, 제목만 모두 저장된다. 손 본문은 다시 읽기가 덮지 않는다.
test('S68-44 hand_fill: photos only is saved as an image-only hand body; the article keeps no text', async () => {
  const w = world({olds: [{id: OLD, workspace_id: WS, lane: 'channel', url: 'https://news.example.org/a/1', url_key: 'news.example.org/a/1', title: null, state: 'failed', fetched_at: null}],
    bodies: [{article_id: ART, blocks: [], state: 'failed', reason: 'timeout', rule: 'open@3', chars: 0, images: 0}]});
  assert.deepEqual(await out(await w.call({...FULL, body: 'https://img.example.org/a.jpg\n사진: 설명'})), {status: 200, body: {ok: true, status: 'filled', id: ART}});
  const bd = w.db.app_news_article_bodies[0];
  assert.deepEqual({state: bd.state, reason: bd.reason, rule: bd.rule, chars: bd.chars, images: bd.images}, {state: 'image_only', reason: null, rule: 'manual@1', chars: 0, images: 1});
  assert.deepEqual(bd.blocks, [{t: 'img', src: 'https://img.example.org/a.jpg', cap: '설명', alt: null}]);
  const a = w.db.app_news_articles[0];
  assert.deepEqual([a.state, a.body, a.body_kind, a.summary, a.title], ['ok', null, null, null, '합성 파업 기사 제목']);
  assert.ok(a.manual_at);
  assert.equal(H.handOwned(a), true, 'photo-only hand body is the person\'s — reading does not overwrite it');
  assert.equal(w.db.app_feed_bodies[0]?.state, 'image_only');
  assert.equal(w.calls.site, 0); assert.equal(w.calls.ai, 0);
});

test('S68-44 hand_fill: an emptied body is saved as "no body" (no blocks); an empty title keeps the current title', async () => {
  const w = world({articles: [baseArt({title: '읽어 온 제목', state: 'ok', body: '읽어 온 본문.', body_kind: 'full', summary: '요약', body_ko: '번역', translated_at: '2026-11-18T22:40:00Z'})],
    bodies: [{article_id: ART, blocks: [{t: 'p', text: '읽어 온 본문.'}], state: 'ok', reason: null, rule: 'open@3', chars: 7, images: 0}]});
  assert.equal((await w.call({...FULL, title: '', body: '', url: 'https://news.example.org/a/1'})).status, 200);
  const a = w.db.app_news_articles[0];
  assert.deepEqual([a.title, a.state, a.body, a.body_kind, a.summary, a.body_ko, a.translated_at], ['읽어 온 제목', 'ok', null, null, null, null, null]);
  const bd = w.db.app_news_article_bodies[0];
  assert.deepEqual({state: bd.state, reason: bd.reason, rule: bd.rule, blocks: bd.blocks, chars: bd.chars, images: bd.images}, {state: 'failed', reason: 'no_body', rule: 'manual@1', blocks: [], chars: 0, images: 0});
  assert.equal(H.handOwned(a), true);
  assert.equal(H.needsRefill(bd, 'synthetic@1'), false, 'a hand body is not re-extracted');
});

test('S68-44 hand_fill: title only (no body sent) still saves; a failed article stays open to reading', async () => {
  const w = world();
  assert.equal((await w.call({id: ART, title: '제목만', publisher: null, author: null, published_at: null})).status, 200);
  const a = w.db.app_news_articles[0];
  assert.deepEqual([a.title, a.state, a.body], ['제목만', 'failed', null]);
  assert.equal(H.handOwned(a), false, 'title-only edit keeps the old rule: the original can still fill the body');
  assert.equal(w.db.app_news_article_bodies.length, 0);
  // 원문 주소만(제목·본문 비움)도 빈 기사가 아니다.
  const u = world();
  assert.equal((await u.call({id: ART, title: '', publisher: null, author: null, published_at: null, url: 'https://news.example.org/a/1'})).status, 200);
});

test('hand_fill photos: at most 20 photos per article', async () => {
  const many = n => Array.from({length: n}, (_, i) => `문단 ${i}\nhttps://img.example.org/${i}.jpg`).join('\n');
  const w = world();
  assert.deepEqual(await out(await w.call({...FULL, body: many(21)})), {status: 400, body: {ok: false, error: 'TOO_MANY_PHOTOS'}});
  assert.equal(w.calls.writes.length, 0);
  assert.equal((await w.call({...FULL, body: many(20)})).status, 200);
  assert.equal(w.db.app_news_article_bodies[0].images, 20);
  // 글자가 많아도 블록 상한 안(사진은 그대로 순서 유지).
  const big = Array.from({length: 900}, (_, i) => (i % 50 === 0 ? `https://img.example.org/b${i}.jpg` : `줄 ${i}`)).join('\n');
  const bl = H.handBlocks(big);
  assert.ok(bl.length <= 400, String(bl.length));
  assert.equal(bl.filter(b => b.t === 'img').length, 18);
  assert.equal(bl[0].t, 'img');
});

// S68-40: 본문 블록(글·사진)을 먼저 저장하고 그다음 공용 기사 줄. 블록 저장이 실패하면 기사 줄은 그대로(손 본문 표시 없이 503) —
// '기사 줄은 손 본문(full·manual)인데 블록은 옛것'이 되어 화면이 사진 없는 기사 줄 글자를 그리는 때를 만들지 않는다.
test('S68-40 hand_fill: body blocks are written before the article row; a failed block write leaves the article row untouched', async () => {
  const w = world();
  assert.equal((await w.call({...FULL, body: '첫 문단.\nhttps://photo.web2.invalid/fakeDriveFile0001.png'})).status, 200);
  const order = w.calls.writes.map(c => c.p).filter(p => p === 'app_news_article_bodies' || p === 'app_news_articles');
  assert.deepEqual(order.slice(0, 2), ['app_news_article_bodies', 'app_news_articles']);
  assert.deepEqual(w.db.app_news_article_bodies[0].blocks.map(b => b.t), ['p', 'img'], '사진 블록 저장');
  const f = world();
  const real = f.db.app_news_article_bodies;
  Object.defineProperty(f.db, 'app_news_article_bodies', {get: () => { throw new Error('synthetic body store down'); }, configurable: true});
  const r = await f.call(FULL);
  assert.notEqual(r.status, 200);
  assert.equal(f.calls.writes.filter(c => c.p === 'app_news_articles').length, 0, '기사 줄 고치기 없음');
  assert.equal(f.db.app_news_articles[0].manual_at, undefined);
  assert.equal(real.length, 0);
});
