// NEWS-수집처늘리기(사용자 2026-11-28): 주제 묶음 'AI 코딩'(tech)·'축구'(football)과 사회·정치 양질 블로그.
// 카탈로그 모양(허용 호스트·https·키 앞머리·묶음), 거르기 규칙(주제 묶음은 거르지 않고 등급 3·분야 비움), 하루 상한(daily), 화면 묶음 줄.
// 네트워크 없음. 사이트·Supabase는 지어낸 응답이다(가짜 글).
import test from 'node:test';
import assert from 'node:assert/strict';

const C = await import('../supabase/functions/_shared/news-catalog.ts');
const R = await import('../supabase/functions/_shared/news-rank.ts');
const H = await import('../supabase/functions/news-feed/handler.ts');
const {mediaRows, newsKeysOf, mediaName} = await import('../app/now-model.mjs');

const TOPIC = C.NEWS_CATALOG.filter(s => s.region === 'tech' || s.region === 'football');
const ADDED = ['news-simonwillison', 'news-lucumr', 'news-mitchellh', 'news-addyosmani', 'news-harperreed', 'news-martinfowler', 'news-latentspace', 'news-steipete', 'news-geeknews',
  'news-arseblog', 'news-arseblognews', 'news-spielverlagerung', 'news-mastermind', 'news-analyticsfc',
  'news-slownews', 'news-guardian-opinion', 'news-noahpinion', 'news-lpeproject', 'news-opendemocracy', 'news-phenomenalworld', 'news-nlr-sidecar'];

test('카탈로그: 새 매체는 키 앞머리 news-·https 피드·피드 호스트가 허용 호스트 안·기본 켬·본문 안 읽음·하루 상한', () => {
  for (const key of ADDED) {
    const s = C.newsSourceByKey(key);
    assert.ok(s, key);
    assert.match(s.key, /^news-[a-z0-9-]{1,34}$/);
    assert.ok(C.NEWS_REGIONS.includes(s.region), `${key}: 묶음`);
    assert.deepEqual([s.on, s.take, s.extract, s.mode], [true, 'all', false, 'rss'], key);
    assert.ok(Number.isInteger(s.daily) && s.daily >= 1 && s.daily <= 10, `${key}: 하루 상한 1~10`);
    assert.equal(s.paid, undefined, `${key}: 유료 매체 아님`);
    for (const l of s.lists) {
      const u = new URL(l);
      assert.equal(u.protocol, 'https:', l);
      assert.ok(s.hosts.includes(u.host), `${key}: 피드 호스트가 hosts 안`);
      assert.equal(u.port, ''); assert.equal(u.username, '');
    }
    for (const h of s.hosts) assert.match(h, /^[a-z0-9.-]+\.[a-z]{2,}$/, `${key}: 호스트 모양`);
  }
  // 주제 묶음은 묶음 이름과 같은 beat(거르기 규칙), 국내·외국어 함께.
  assert.ok(TOPIC.length >= 8);
  for (const s of TOPIC) assert.equal(s.beat, s.region, s.key);
  // 키는 겹치지 않는다(바깥 성명 카탈로그 키는 news- 앞머리가 없음).
  assert.equal(new Set(C.NEWS_SOURCE_KEYS).size, C.NEWS_SOURCE_KEYS.length);
  // 화면 목록(catalog 응답)에 묶음이 실린다.
  const pub = C.publicNewsCatalog();
  assert.equal(pub.find(s => s.key === 'news-simonwillison').region, 'tech');
  assert.equal(pub.find(s => s.key === 'news-arseblog').region, 'football');
});

test('거르기: 주제 묶음은 종합지의 스포츠·IT 빼기를 받지 않고 등급 3·분야 비움, 사회·정치 블로그는 칼럼·사설 등급 2', () => {
  const ball = C.newsSourceByKey('news-arseblog'), tech = C.newsSourceByKey('news-simonwillison');
  const pick = (source, title, more = {}) => R.newsPick({source, list: source.lists[0], title, url: more.url || 'https://x.test/2026/11/fake-post/', category: more.category});
  assert.deepEqual(pick(ball, 'Fake tactics review: pressing shape', {category: 'Football', url: 'https://arseblog.com/2026/11/soccer/fake/'}), {rank: 3, field: null});
  assert.deepEqual(pick(tech, 'A fake note on coding agents', {category: 'tech'}), {rank: 3, field: null});
  // 같은 글을 종합지(섞인 피드)가 냈다면 뺀다 — 규칙은 매체 묶음으로만 갈린다.
  assert.equal(pick({lists: ['https://y.test/rss'], mixedAs: 'society'}, 'Fake tactics review', {category: '축구'}), null);
  const opn = C.newsSourceByKey('news-guardian-opinion');
  assert.deepEqual(pick(opn, 'A fake column on public services'), {rank: 2, field: 'opinion'});
  assert.equal(pick(opn, 'A fake match column', {url: 'https://www.theguardian.com/sport/2026/nov/27/fake'}), null, '의견 섹션의 스포츠 경로는 그대로 뺀다');
});

test('하루 상한 자리: 최근 받은 주소는 다시 세지 않고, 오늘 받은 수만큼 칸이 준다. 읽기 실패면 이번 실행 daily건까지', async () => {
  const NOW = Date.parse('2026-11-28T03:00:00Z'); // 서울 11/28 12:00
  const src = C.newsSourceByKey('news-arseblognews');
  const seen = [];
  const db = {get: async (path) => { seen.push(path); return [{url_key: 'a/1', kst_day: '2026-11-28'}, {url_key: 'a/2', kst_day: '2026-11-28'}, {url_key: 'a/3', kst_day: '2026-11-27'}]; }};
  const room = await H.dailyRoom(db, src, 5, NOW, () => {});
  assert.equal(room.left, 3);
  assert.deepEqual([...room.known].sort(), ['a/1', 'a/2', 'a/3']);
  assert.match(seen[0], /^app_news_articles\?source_key=eq\.news-arseblognews&created_at=gte\./);
  const full = await H.dailyRoom({get: async () => Array.from({length: 7}, (_, i) => ({url_key: `b/${i}`, kst_day: '2026-11-28'}))}, src, 5, NOW, () => {});
  assert.equal(full.left, 0);
  const logs = [];
  const failed = await H.dailyRoom({get: async () => { throw new Error('x'); }}, src, 5, NOW, (e) => logs.push(e));
  assert.deepEqual([failed.left, failed.known.size, logs], [5, 0, ['daily_room_failed']]);
});

test('수집: 하루 상한 매체는 피드 글이 많아도 오늘 남은 칸만큼만 새로 넣는다', async () => {
  const NOW = Date.parse('2026-11-28T03:00:00Z');
  const SB = 'https://synthetic.supabase.test', SECRET = 'synthetic-news-feed-cron-secret-0123456789abc';
  const WS = 'a0000000-0000-4000-8000-000000000001';
  const src = C.newsSourceByKey('news-arseblognews');
  const items = Array.from({length: 9}, (_, i) => `<item><title>Fake match review ${i}</title><link>https://arseblog.news/2026/11/fake-review-${i}/</link><description>Fake summary ${i}</description><pubDate>Fri, 28 Nov 2026 0${i}:00:00 +0000</pubDate></item>`).join('');
  const sites = {'https://arseblog.news/robots.txt': 'User-agent: *\nAllow: /', [src.lists[0]]: `<rss><channel>${items}</channel></rss>`};
  const posted = [];
  const res = (v, s = 200) => new Response(v === null ? null : JSON.stringify(v), {status: s, headers: {'content-type': 'application/json'}});
  const doFetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method ?? 'GET';
    if (u.origin === SB) {
      const p = u.pathname.replace('/rest/v1/', ''), q = u.searchParams;
      if (p === 'rpc/app_operator_feature_workspace') return res(WS);
      if (p === 'app_outside_sources' && method === 'GET') return res([{workspace_id: WS, source_key: src.key, enabled: true}]);
      // 오늘 이미 받은 2건(하루 상한 5 → 남은 칸 3).
      if (p === 'app_news_articles' && method === 'GET' && q.get('source_key') === `eq.${src.key}`) return res([{url_key: 'arseblog.news/old-1', kst_day: '2026-11-28'}, {url_key: 'arseblog.news/old-2', kst_day: '2026-11-28'}]);
      if (p === 'app_news_articles' && method === 'POST') { const body = JSON.parse(init.body); posted.push(...body); return res(body.map(r => ({id: r.id, url_key: r.url_key})), 201); }
      if (method === 'GET') return res([]);
      return res(null, method === 'POST' ? 201 : 204);
    }
    const body = sites[u.href];
    return body === undefined ? new Response('', {status: 404}) : new Response(body, {status: 200, headers: {'content-type': u.pathname.endsWith('.txt') ? 'text/plain' : 'application/rss+xml'}});
  };
  const h = H.createNewsFeedHandler({env: n => ({SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role-key', NEWS_FEED_CRON_SECRET: SECRET})[n], fetch: doFetch, now: () => NOW, sleep: async () => {}, log: () => {}});
  const out = await (await h(new Request(`${SB}/functions/v1/news-feed?action=run`, {method: 'POST', headers: {[H.CRON_HEADER]: SECRET, 'content-type': 'application/json'}, body: JSON.stringify({step: 'media', source: src.key})}))).json();
  assert.equal(out.listed, 9);
  assert.equal(out.dropped, 6);
  assert.equal(posted.length, 3);
  assert.ok(posted.every(r => r.news_rank === 3 && r.source_key === src.key));
});

test('화면 묶음: [매체 ▾]에 AI 코딩·축구 묶음, 고르면 그 묶음 매체만', () => {
  const nc = [{key: 'news-a', name: '가상일보', region: 'domestic'}, {key: 'news-t', name: 'Fake Coding Blog', region: 'tech'},
    {key: 'news-f', name: 'Fake Tactics', region: 'football'}, {key: 'news-e', name: 'Fake Wire', region: 'foreign'}];
  const rows = mediaRows({tab: 'media', nc, non: nc.map(s => s.key)}).all;
  assert.deepEqual(rows.map(r => r.id), ['all', 'r:domestic', 'n:news-a', 'r:tech', 'n:news-t', 'r:football', 'n:news-f', 'r:foreign', 'n:news-e']);
  assert.deepEqual(rows.filter(r => r.depth === 0).map(r => r.name), ['전체', '언론 국내', 'AI 코딩', '축구', '언론 국제']);
  assert.deepEqual(newsKeysOf('r:tech', nc), ['news-t']);
  assert.deepEqual(newsKeysOf('r:football', nc), ['news-f']);
  assert.equal(mediaName('r:football', {nc}), '축구');
});
