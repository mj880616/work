// S70-17b NEWS-제목꼭얻기(명진 11/25 10:26 "원문 못읽어도 최소한 제목이라도 읽어야함. 제목 못읽는건 시급한 문제임. 못읽으면 차라리 목록에서 빠지는게 나음").
// 원문 쪽을 못 받아도(동아일보처럼 서버 접속이 늦거나 막힌 매체) 같은 기사의 매체 RSS 줄 제목을 쓴다 — 주소 모양이 달라도(공유·모바일·amp) 기사 번호로 맞춘다.
// 규칙은 매체 표(_shared/news-catalog.ts sameArticle) 한 곳, 읽는 곳은 우리 DB뿐(사이트를 더 부르지 않음). 기사·주소는 모두 지어낸 것. 네트워크 없음.
// 목록에서 빼는 규칙(제목이 끝내 없으면)은 tests/feed-shared-model.test.mjs, 화면은 tests/app-e2e/news-no-title-hidden.spec.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';

const SA = await import('../../supabase/functions/_shared/same-article.ts');
const NF = await import('../../supabase/functions/news-feed/handler.ts');
const {createCollectorFeedHandler, NEWS_ROOM_FN} = await import('../../supabase/functions/collector-feed/handler.ts');

const ID = '100000001';
const RSS_URL = `https://www.donga.com/news/Society/article/all/20261125/${ID}/1`; // 매체 RSS 줄 주소 꼴
const SHARE_URL = `https://www.donga.com/news/article/all/20261125/${ID}/1`; // 분류 없는 공유 주소
const MOBILE_URL = `https://m.donga.com/news/Society/article/all/20261125/${ID}/1`;
const AMP_URL = `https://www.donga.com/news/amp/all/20261125/${ID}/1`;
const RSS_ROW = {url: RSS_URL, title: '지어낸 동아 기사 제목', publisher: '동아일보'};
const NEAR_ROW = {url: `https://www.donga.com/news/Society/article/all/20261125/${ID}9/1`, title: '번호가 비슷한 다른 기사', publisher: '동아일보'};

test('같은 기사 규칙: 동아일보 공유·모바일·amp 주소는 RSS 줄과 같은 기사 번호, 다른 매체·기사 아닌 쪽은 null', () => {
  const want = {source: 'news-donga', ref: ID};
  for (const u of [RSS_URL, SHARE_URL, MOBILE_URL, AMP_URL, `${SHARE_URL}?utm_source=x`]) assert.deepEqual(SA.sameArticleRef(u), want, u);
  assert.equal(SA.sameArticleRef('https://www.donga.com/news/Society'), null, '기사 쪽이 아님');
  assert.equal(SA.sameArticleRef('https://notdonga.com/news/article/all/20261125/100000001/1'), null, '도메인 끝만 같은 다른 곳');
  assert.equal(SA.sameArticleRef('https://www.example.org/news/article/all/20261125/100000001/1'), null, '규칙 없는 매체');
  assert.equal(SA.sameArticleRef('not a url'), null);
});

test('RSS 줄 제목 찾기: 그 매체 줄 가운데 기사 번호가 정확히 같은 줄만(번호가 겹치는 다른 기사는 아님), 우리 DB만 읽음', async () => {
  const asked = [];
  const get = async p => { asked.push(decodeURIComponent(p)); return [NEAR_ROW, RSS_ROW]; };
  assert.deepEqual(await SA.sameArticleTitle(get, SHARE_URL), {title: '지어낸 동아 기사 제목', publisher: '동아일보'});
  assert.equal(asked.length, 1);
  assert.match(asked[0], /^app_news_articles\?source_key=eq\.news-donga&title=not\.is\.null&url=like\.\*100000001\*/);
  assert.equal(await SA.sameArticleTitle(async () => [NEAR_ROW], SHARE_URL), null, '번호가 비슷한 다른 기사 제목은 쓰지 않음');
  let called = 0;
  assert.equal(await SA.sameArticleTitle(async () => { called++; return [RSS_ROW]; }, 'https://www.example.org/a/1'), null);
  assert.equal(called, 0, '규칙 없는 주소는 DB도 묻지 않음');
});

// ---- 제목 다시 읽기(news-feed 예약 '대기 기사' 단계, 이미 들어온 '못 읽은 기사'도 같은 흐름) ----
function fakeDb({rss = [RSS_ROW], window = [], older = []} = {}) {
  const calls = {gets: [], patches: []};
  return {calls, db: {
    get: async p => {
      const d = decodeURIComponent(p); calls.gets.push(d);
      if (d.startsWith('app_news_articles?source_key=')) return rss;
      if (d.includes('state=eq.failed')) return window;
      if (d.includes('or=(url.like.')) return older;
      return [];
    },
    send: async (m, p, b) => { calls.patches.push({m, p: decodeURIComponent(p), b}); return []; },
  }};
}
const NOW = Date.parse('2026-11-25T03:00:00Z');
const A1 = 'a0000000-0000-4000-8000-0000000000a1', A2 = 'a0000000-0000-4000-8000-0000000000a2', A3 = 'a0000000-0000-4000-8000-0000000000a3';
const failing = (code = 'timeout') => { const r = {asked: [], get: async u => { r.asked.push(u); return {ok: false, code}; }}; return r; };

test('(나) 원문 쪽 받기 실패 + 같은 기사 RSS 줄(주소 모양 다름: 공유·모바일) → RSS 제목·매체 이름이 채워진다(사이트는 부르지 않음)', async () => {
  const {db, calls} = fakeDb({window: [{id: A1, url: SHARE_URL, url_key: 'k1'}], older: [{id: A2, url: MOBILE_URL, url_key: 'k2'}]});
  const reader = failing();
  const out = await NF.runTitleRetry(db, reader, NOW, NOW, () => NOW);
  assert.equal(out.read, 2); assert.equal(out.same, 2);
  assert.deepEqual(reader.asked, [], 'RSS 줄에서 얻었으면 사이트를 부르지 않는다');
  const arts = calls.patches.filter(x => x.p.startsWith('app_news_articles?'));
  assert.deepEqual(arts.map(x => x.p), [`app_news_articles?id=eq.${A1}&title=is.null`, `app_news_articles?id=eq.${A2}&title=is.null`], '제목이 빈 줄만 고친다');
  for (const x of arts) { assert.equal(x.b.title, '지어낸 동아 기사 제목'); assert.equal(x.b.publisher, '동아일보'); assert.ok(x.b.title_key); }
  assert.ok(!arts.some(x => 'state' in x.b || 'body' in x.b), '상태·본문은 그대로');
  assert.ok(calls.gets.some(g => /title=is\.null&lane=neq\.media&created_at=gt\..+&or=\(url\.like\.\*donga\.com\*\)/.test(g)), '지난 줄은 같은 기사 규칙이 있는 매체 주소만 고른다');
});

test('(다) 아무 데도 제목 없음 → 그대로 둔다(지우지 않음), 지난 줄은 사이트를 다시 부르지 않는다, 띠 안 줄만 한 장 읽기', async () => {
  const {db, calls} = fakeDb({rss: [], window: [{id: A1, url: SHARE_URL, url_key: 'k1'}], older: [{id: A3, url: AMP_URL, url_key: 'k3'}]});
  const reader = failing('http_403');
  const out = await NF.runTitleRetry(db, reader, NOW, NOW, () => NOW);
  assert.equal(out.read, 0); assert.equal(out.tried, 1);
  assert.deepEqual(reader.asked, [SHARE_URL], '띠 밖 지난 줄(amp)은 사이트를 부르지 않는다');
  assert.deepEqual(out.why, {http_403: 1});
  assert.deepEqual(calls.patches, [], '쓰기·지우기 없음');
});

// ---- 들어올 때 제목 읽기(collector-feed 뉴스방) ----
const SB = 'https://synthetic.supabase.test', WS = 'a0000000-0000-4000-8000-000000000001', SECRET = 'synthetic-collector-feed-secret-0123456789';
const CNOW = Date.parse('2026-10-24T03:00:00Z');
const MSG_TITLE = '지어낸 텔레그램 줄 제목 표식';
function roomHarness({rss}) {
  const calls = {site: [], patches: [], logs: []};
  const respond = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
  const doFetch = async (input, init = {}) => {
    const url = new URL(String(input)), method = init.method || 'GET';
    if (url.origin !== SB) { calls.site.push(url.href); return new Response('', {status: 403}); } // 사이트는 막힘(동아일보 꼴)
    const path = url.pathname.replace('/rest/v1/', ''), q = decodeURIComponent(url.search);
    if (path === 'rpc/app_operator_feature_workspace') return respond(JSON.stringify(WS));
    if (path === `rpc/${NEWS_ROOM_FN}`) return respond({ok: true, news: true, taken: 1, dup: 0, widened: 0, refused: 0});
    if (path.startsWith('rpc/')) return respond({ok: true});
    if (path === 'app_news_articles' && method === 'GET' && q.includes('source_key=eq.news-donga')) return respond(rss);
    if (path === 'app_news_articles' && method === 'GET' && q.includes('origin=eq.tg_room')) return respond([{id: A1, url: SHARE_URL, url_key: 'donga.com/news/article/all/20261125/100000001/1', scrapped_at: '2026-10-24T00:10:00Z', title: null}]);
    if (method === 'PATCH') { calls.patches.push({p: decodeURIComponent(url.pathname.replace('/rest/v1/', '') + url.search), b: JSON.parse(init.body)}); return respond([{}]); }
    if (method === 'GET') return respond([]);
    return respond('', 201);
  };
  const handler = createCollectorFeedHandler({env: n => ({SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role-key', COLLECTOR_FEED_SECRET: SECRET})[n],
    fetch: doFetch, now: () => CNOW, sleep: async () => {}, log: (code, d) => calls.logs.push({code, ...(d || {})})});
  const send = () => handler(new Request(`${SB}/functions/v1/collector-feed?action=telegram`, {method: 'POST', headers: {'Content-Type': 'application/json', 'x-collector-feed-secret': SECRET},
    body: JSON.stringify({day: '2026-10-24', room_key: '-100777', room_label: '가상 방', total: 1, chat_kind: 'channel', messages: [{ref: '1', at: '2026-10-24T00:10:00Z', sender: 'A', text: `${MSG_TITLE}\n${SHARE_URL}`}]})}));
  return {send, calls};
}

test('(가) 뉴스방으로 들어온 주소: 원문 쪽 받기 실패여도 같은 기사 RSS 줄이 있으면 그 제목이 바로 채워진다(사이트를 부르지 않음)', async () => {
  const h = roomHarness({rss: [RSS_ROW]});
  await h.send();
  const art = h.calls.patches.find(x => x.p.startsWith(`app_news_articles?id=eq.${A1}`));
  assert.ok(art, '공용 기사 줄 제목을 고침');
  assert.equal(art.b.title, '지어낸 동아 기사 제목'); assert.equal(art.b.publisher, '동아일보');
  assert.deepEqual(h.calls.site, [], 'RSS 줄에서 얻었으면 사이트를 부르지 않는다');
  const log = h.calls.logs.find(l => l.code === 'title_peek');
  assert.equal(log.read, 1); assert.equal(log.same, 1);
});

test('(가) 텔레그램 글 줄은 공용 기사 제목으로 쓰지 않는다 — 공용 표는 가입자 모두가 읽어 방 글이 새어 나간다(news-for-all 설계: 공용 표에는 주소만)', async () => {
  const h = roomHarness({rss: []});
  await h.send();
  assert.equal(h.calls.site.length, 1, 'RSS 줄이 없으면 그 주소 한 장만 읽어 본다');
  assert.ok(!JSON.stringify(h.calls.patches).includes(MSG_TITLE), '방 글 줄이 어디에도 써지지 않음');
  assert.ok(!h.calls.patches.some(x => x.p.startsWith('app_news_articles?')), '제목을 못 얻으면 그대로(목록에서는 빠진다)');
  const log = h.calls.logs.find(l => l.code === 'title_peek');
  assert.equal(log.missed, 1); assert.deepEqual(log.why, {http_403: 1});
});
