// S53-6 NEWS-매체늘리기: 기본 켬 매체(on: true). 줄이 없는 '뉴스를 쓰는 작업공간'은 켬으로 보고, 끈 줄은 그대로 꺼진다.
// 네트워크 없음. 사이트·Supabase는 지어낸 응답이다(합성 글).
import test from 'node:test';
import assert from 'node:assert/strict';

const H = await import('../supabase/functions/news-feed/handler.ts');
const C = await import('../supabase/functions/_shared/news-catalog.ts');
const O = await import('../supabase/functions/_shared/outside-catalog.ts');
const NOW = Date.parse('2026-11-08T03:00:00Z');
const SB = 'https://synthetic.supabase.test', SERVICE = 'synthetic-service-role-key', SECRET = 'synthetic-news-feed-cron-secret-0123456789abc';
const WS1 = 'a0000000-0000-4000-8000-000000000001', WS2 = 'a0000000-0000-4000-8000-000000000002', WS3 = 'a0000000-0000-4000-8000-000000000003', WS4 = 'a0000000-0000-4000-8000-000000000004';
const FN = `${SB}/functions/v1/news-feed`;

function world({sources, keywords, sites}) {
  const calls = [];
  const res = (v, s = 200) => new Response(v === null ? null : JSON.stringify(v), {status: s, headers: {'content-type': 'application/json'}});
  const doFetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method ?? 'GET', body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({url: u.href, method, body, prefer: init.headers?.Prefer});
    if (u.origin === SB) {
      const p = u.pathname.replace('/rest/v1/', ''), q = u.searchParams;
      if (p === 'app_outside_sources' && method === 'GET') {
        let rows = sources;
        if (q.get('enabled') === 'is.true') rows = rows.filter(r => r.enabled === true);
        return res(rows.map(r => ({workspace_id: r.workspace_id, source_key: r.source_key, ...(q.get('select').includes('enabled') ? {enabled: r.enabled} : {})})));
      }
      if (p === 'app_news_keywords' && method === 'GET') {
        const only = q.get('workspace_id')?.match(/^in\.\((.*)\)$/)?.[1]?.split(',');
        return res(keywords.filter(k => !only || only.includes(k.workspace_id)));
      }
      if (p === 'app_news_items' && method === 'GET') return res([]);
      return res(null, method === 'POST' ? 201 : 204);
    }
    const site = sites[u.href];
    if (site === undefined) return new Response('', {status: 404});
    return new Response(site.body, {status: 200, headers: {'content-type': site.type ?? 'text/plain'}});
  };
  const h = H.createNewsFeedHandler({env: n => ({SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: SERVICE, NEWS_FEED_CRON_SECRET: SECRET})[n], fetch: doFetch, now: () => NOW, sleep: async () => {}, log: () => {}});
  const cron = async (body) => (await h(new Request(`${FN}?action=run`, {method: 'POST', headers: {[H.CRON_HEADER]: SECRET, 'content-type': 'application/json'}, body: JSON.stringify(body)}))).json();
  return {calls, cron, fetch: doFetch};
}

test('카탈로그: 종합지는 기본 켬·다 받기(NEWS-다받기 11/09)·수집 때 본문 안 읽음, 주소는 https, 화면 목록에 on이 실림', () => {
  for (const key of ['news-khan', 'news-ohmynews', 'news-hankyung', 'news-mk', 'news-sisain', 'news-newstapa',
    'news-hani', 'news-yna', 'news-donga', 'news-jtbc', 'news-sbs', 'news-nocut', 'news-chosun',
    'news-mediatoday', 'news-newsis', 'news-sedaily', 'news-imaeil']) {
    const s = C.newsSourceByKey(key);
    assert.ok(s, key);
    assert.equal(s.on, true); assert.equal(s.take, 'all'); assert.equal(s.extract, false); assert.equal(s.region, 'domestic');
    for (const l of s.lists) { const u = new URL(l); assert.equal(u.protocol, 'https:'); assert.ok(s.hosts.includes(u.hostname), l); assert.ok(O.allowedUrl(s, l), `주소 검사 통과(쿼리 포함): ${l}`); }
  }
  // 앞서 있던 매체는 기본 켬이 아니다(사용자가 켠 것만 — 지금 동작 유지).
  for (const key of ['news-labortoday', 'news-beminor', 'news-pressian', 'news-psi', 'news-itf', 'news-labourstart']) assert.equal(C.newsSourceByKey(key).on, undefined, key);
  const pub = C.publicNewsCatalog();
  assert.equal(pub.find(s => s.key === 'news-khan').on, true);
  assert.equal(pub.find(s => s.key === 'news-beminor').on, false);
  for (const s of pub) assert.deepEqual(Object.keys(s).sort(), ['key', 'lang', 'name', 'on', 'region'], '주소·규칙은 화면에 싣지 않음');
});

test('기본 켬: 줄 없는 뉴스 작업공간만 켬 줄을 만들고 읽는다, 끈 줄·뉴스 안 쓰는 곳은 건드리지 않음, 키워드 상관없이 다 받음', async () => {
  const s = C.newsSourceByKey('news-khan');
  const rss = `<rss><channel>
<item><title>합성 철도 파업 기사</title><link>https://www.khan.co.kr/article/202611080001</link><description>합성 소개</description><dc:date>2026-11-08T09:00:00+09:00</dc:date></item>
<item><title>합성 날씨 기사</title><link>https://www.khan.co.kr/article/202611080002</link><description>합성 소개</description></item>
</channel></rss>`;
  const sites = {'https://www.khan.co.kr/robots.txt': {body: 'User-agent: *\nAllow: /\n'}};
  for (const l of s.lists) sites[l] = {body: rss, type: 'application/rss+xml'};
  const w = world({
    sources: [
      {workspace_id: WS1, source_key: 'news-beminor', enabled: true}, // 뉴스 씀, khan 줄 없음 → 기본 켬
      {workspace_id: WS2, source_key: 'news-khan', enabled: false}, // 끔 → 그대로 꺼짐
    ],
    keywords: [{workspace_id: WS1, word: '철도'}, {workspace_id: WS2, word: '철도'}, {workspace_id: WS3, word: '버스'}], // WS3: 키워드만 있음 → 기본 켬, 맞는 글 없음. WS4: 뉴스 안 씀
    sites,
  });
  const out = await w.cron({step: 'media', source: 'news-khan'});
  assert.equal(out.ok, true); assert.equal(out.status, 'ok');
  const made = w.calls.filter(c => c.method === 'POST' && c.url.includes('/rest/v1/app_outside_sources'));
  assert.equal(made.length, 1);
  assert.match(made[0].prefer, /ignore-duplicates/, '사용자가 그사이 끈 줄을 덮지 않음');
  assert.deepEqual(made[0].body.map(r => [r.workspace_id, r.source_key, r.enabled]).sort(), [[WS1, 'news-khan', true], [WS3, 'news-khan', true]]);
  assert.ok(!JSON.stringify(made[0].body).includes(WS4) && !JSON.stringify(made[0].body).includes(WS2));
  const items = w.calls.filter(c => c.method === 'POST' && c.url.includes('/rest/v1/app_news_items')).flatMap(c => c.body);
  // 섹션 피드 셋이 같은 글을 실어도 DB의 (workspace_id, url_key) 겹침 막기로 한 줄만 남는다(이 가짜 DB는 겹침 검사를 하지 않음).
  const got = [...new Set(items.map(i => [i.workspace_id, i.source_key, i.lane, i.url].join('|')))].sort();
  const want = [WS1, WS3].flatMap(w => ['202611080001', '202611080002'].map(n => [w, 'news-khan', 'media', `https://www.khan.co.kr/article/${n}`].join('|'))).sort();
  assert.deepEqual(got, want, '켠 작업공간(WS1·WS3)에 키워드와 상관없이 두 글 모두(날씨 글 포함), 끈 WS2·뉴스 안 쓰는 WS4는 없음');
  assert.equal(out.raw, 6, '섹션 피드 셋 × 글 칸 둘'); assert.equal(out.listed, 6);
  const status = w.calls.find(c => c.method === 'PATCH' && c.url.includes('/rest/v1/app_outside_sources'));
  assert.ok(status.url.includes(WS1) && status.url.includes(WS3) && !status.url.includes(WS2));
  assert.equal(w.calls.filter(c => c.url.startsWith('https://www.khan.co.kr/article/')).length, 0, '수집 때 글 쪽은 읽지 않음(extract:false)');
});

test('기본 켬이 아닌 매체는 지금처럼 켠 줄만 읽고 줄을 만들지 않음', async () => {
  const w = world({sources: [{workspace_id: WS1, source_key: 'news-khan', enabled: true}], keywords: [{workspace_id: WS3, word: '철도'}], sites: {}});
  const out = await w.cron({step: 'media', source: 'news-beminor'});
  assert.equal(out.status, 'no_workspace');
  assert.equal(w.calls.filter(c => c.method === 'POST').length, 0);
});

test('run_plan: 기본 켬 매체는 뉴스 쓰는 작업공간이 있을 때만 계획에 들어감', async () => {
  const plan = async (sources, keywords) => {
    const w = world({sources, keywords, sites: {}});
    const h = H.createNewsFeedHandler({env: n => ({SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: SERVICE, NEWS_FEED_CRON_SECRET: SECRET})[n], fetch: (u, i) => w.fetch(u, i), now: () => NOW, sleep: async () => {}, log: () => {}});
    return (await h(new Request(`${FN}?action=run_plan`, {method: 'POST', headers: {[H.CRON_HEADER]: SECRET, 'content-type': 'application/json'}, body: '{}'}))).json();
  };
  const on = await plan([], [{workspace_id: WS1, word: '철도'}]);
  assert.deepEqual(on.media.sort(), ['news-chosun', 'news-donga', 'news-hani', 'news-hankyung', 'news-imaeil', 'news-jtbc', 'news-khan', 'news-mediatoday', 'news-mk', 'news-newsis', 'news-newstapa', 'news-nocut', 'news-ohmynews', 'news-sbs', 'news-sedaily', 'news-sisain', 'news-yna']);
  const off = await plan([], []);
  assert.deepEqual(off.media, [], '뉴스를 안 쓰는 작업공간뿐이면 읽지 않음');
});

// NEWS-다받기(11/09): 피드 하나를 통째로(MEDIA_LIST_LIMIT) 받는다 — 30건에서 끊지 않음.
test('다 받기: 섹션 피드 하나에 글 120건이면 120건 모두 넣는다(키워드 없어도)', async () => {
  const s = C.newsSourceByKey('news-yna');
  const items = Array.from({length: 120}, (_, i) => `<item><title>합성 기사 ${i}</title><link>https://www.yna.co.kr/view/SYN${String(i).padStart(4, '0')}</link><description>합성 소개</description></item>`).join('');
  const sites = {'https://www.yna.co.kr/robots.txt': {body: 'User-agent: *\nAllow: /\n'}};
  s.lists.forEach((l, k) => { sites[l] = {body: k === 0 ? `<rss><channel>${items}</channel></rss>` : '<rss><channel></channel></rss>'}; });
  const w = world({sources: [{workspace_id: WS1, source_key: 'news-yna', enabled: true}], keywords: [], sites});
  const out = await w.cron({step: 'media', source: 'news-yna'});
  assert.equal(out.status, 'ok'); assert.equal(out.raw, 120); assert.equal(out.listed, 120);
  assert.ok(H.MEDIA_LIST_LIMIT >= 120, '가장 큰 피드(연합 섹션 120)보다 커야 함');
  const posted = w.calls.filter(c => c.method === 'POST' && c.url.includes('/rest/v1/app_news_items')).flatMap(c => c.body);
  assert.equal(new Set(posted.map(r => r.url)).size, 120);
});

// NEWS-새매체글없음: 피드는 읽혔는데(성공) 글 링크가 허용 호스트·https 밖이면 글이 0건 — raw·listed 숫자로 구분된다.
test('진단 숫자: 링크가 http이거나 다른 호스트면 raw는 세고 listed는 0(성공으로 적히지만 글 0건)', async () => {
  const s = C.newsSourceByKey('news-ohmynews');
  const rss = `<rss><channel>
<item><title>합성 기사 http</title><link>http://www.ohmynews.com/NWS_Web/View/at_pg.aspx?CNTN_CD=A0000000001</link></item>
<item><title>합성 기사 남의 호스트</title><link>https://other.example.org/a/1</link></item>
</channel></rss>`;
  const sites = {'https://rss.ohmynews.com/robots.txt': {body: ''}};
  for (const l of s.lists) sites[l] = {body: rss};
  const w = world({sources: [{workspace_id: WS1, source_key: 'news-ohmynews', enabled: true}], keywords: [], sites});
  const out = await w.cron({step: 'media', source: 'news-ohmynews'});
  assert.equal(out.status, 'ok'); assert.equal(out.raw, 6); assert.equal(out.listed, 0); assert.equal(out.inserted, 0);
});

test('화면 catalog: 이번 달 AI 한도 닿음은 예/아니오만(ai.month_capped), 금액은 싣지 않음', async () => {
  const M = await import('../app/news-clipping-model.mjs');
  assert.equal(M.aiCapped({ai: {month_capped: true}}), true);
  assert.equal(M.aiCapped({ai: {month_capped: 'yes'}}), false);
  assert.equal(M.aiCapped({}), false);
  assert.match(M.AI_CAP_NOTE, /AI 한도/);
});
