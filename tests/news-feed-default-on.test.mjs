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

// have: 이미 들어와 있는 기사 줄(겹침 거르기용 — {workspace_id, url_key?, title_key?}), unread: 블록 줄이 아직 없는 기사 줄(본문 표시용).
function world({sources, keywords, sites, have = [], unread = [], media = []}) {
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
      if (p === 'app_news_items' && method === 'GET') {
        const sel = q.get('select') ?? '';
        const inList = name => JSON.parse(`[${(q.get(name) ?? 'in.()').replace(/^in\.\(/, '').replace(/\)$/, '')}]`);
        const mine = r => `eq.${r.workspace_id}` === q.get('workspace_id');
        if (sel === 'url_key') return res(have.filter(r => mine(r) && r.url_key && inList('url_key').includes(r.url_key)).map(r => ({url_key: r.url_key})));
        if (sel === 'title_key') return res(have.filter(r => mine(r) && r.title_key && inList('title_key').includes(r.title_key)).map(r => ({title_key: r.title_key})));
        if (sel.includes('app_feed_bodies')) return res(unread.filter(r => q.get('lane') === `eq.${r.lane}` && q.get('source_key') === `eq.${r.source_key}`));
        // 키워드 단계(S59-1): 그 작업공간 매체 글, created_at 이후, 새 것부터, 쪽(limit·offset). keywords=neq.{}면 표시가 있는 줄만(id).
        if (q.get('lane') === 'eq.media' && q.get('created_at')?.startsWith('gte.')) {
          const since = q.get('created_at').slice(4);
          let rows = media.filter(r => mine(r) && r.lane === 'media' && r.created_at >= since).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
          if (q.get('keywords') === 'neq.{}') rows = rows.filter(r => r.keywords.length);
          const off = Number(q.get('offset') || 0), lim = Number(q.get('limit') || 1000);
          const cols = sel.split(',');
          return res(rows.slice(off, off + lim).map(r => Object.fromEntries(cols.map(k => [k, r[k]]))));
        }
        return res([]);
      }
      return res(null, method === 'POST' ? 201 : 204);
    }
    const site = sites[u.href];
    if (site === undefined) return new Response('', {status: 404});
    return new Response(site.body, {status: site.status ?? 200, headers: {'content-type': site.type ?? 'text/plain', ...(site.headers ?? {})}});
  };
  const h = H.createNewsFeedHandler({env: n => ({SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: SERVICE, NEWS_FEED_CRON_SECRET: SECRET})[n], fetch: doFetch, now: () => NOW, sleep: async () => {}, log: () => {}});
  const cron = async (body) => (await h(new Request(`${FN}?action=run`, {method: 'POST', headers: {[H.CRON_HEADER]: SECRET, 'content-type': 'application/json'}, body: JSON.stringify(body)}))).json();
  return {calls, cron, fetch: doFetch};
}

// 기본 켬 매체 전부(자기 RSS 16곳 + S59-1에 자기 RSS로 옮긴 6곳 — 구글 뉴스 매체 단위 줄은 없다).
const DEFAULT_ON = ['news-khan', 'news-ohmynews', 'news-hankyung', 'news-mk', 'news-sisain', 'news-newstapa',
  'news-hani', 'news-yna', 'news-donga', 'news-jtbc', 'news-sbs', 'news-nocut', 'news-chosun',
  'news-newsis', 'news-sedaily', 'news-imaeil',
  'news-worknworld', 'news-newsmin', 'news-redaily', 'news-laborplus', 'news-redian', 'news-mt'];

test('카탈로그: 종합지는 기본 켬·다 받기(NEWS-다받기 11/09)·수집 때 본문 안 읽음, 주소는 https, 화면 목록에 on이 실림', () => {
  // 기본 켬 매체는 이 목록과 정확히 같아야 한다(카탈로그에 줄을 더하면 여기도 고친다).
  assert.deepEqual(C.NEWS_CATALOG.filter(x => x.on === true).map(x => x.key).sort(), [...DEFAULT_ON].sort());
  for (const key of DEFAULT_ON) {
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
  assert.deepEqual(on.media.sort(), [...DEFAULT_ON].sort());
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

// ---- S59-1 NEWS-못넣은곳대안 뒤처리: 구글 뉴스 길을 버리고, 길이 있는 6곳은 자기 RSS 줄, 길이 없는 8곳은 매체 목록에서 뺀다 ----------
// 11/11 CC 크롬 확인(robots.txt `User-agent: *` 묶음 + 피드) 결과대로. 네트워크 없음 — 글·주소는 모두 지어낸 것.
const NEW_RSS = {
  'news-worknworld': ['https://worknworld.kctu.org/rss/allArticle.xml', ['worknworld.kctu.org']],
  'news-newsmin': ['https://www.newsmin.co.kr/news/feed/', ['www.newsmin.co.kr', 'newsmin.co.kr']],
  'news-redaily': ['https://www.redaily.co.kr/rss/allArticle.xml', ['www.redaily.co.kr', 'redaily.co.kr']],
  'news-laborplus': ['https://www.laborplus.co.kr/rss/allArticle.xml', ['www.laborplus.co.kr', 'laborplus.co.kr']],
  'news-redian': ['https://www.redian.org/rss/allArticle.xml', ['www.redian.org', 'redian.org']],
  'news-mt': ['https://rss.mt.co.kr/mt_news.xml', ['rss.mt.co.kr', 'www.mt.co.kr', 'mt.co.kr']],
};
const REMOVED = ['news-edaily', 'news-mediatoday', 'news-kyeonggi', 'news-kyeongin', 'news-newsone', 'news-busan', 'news-kookje', 'news-yeongnam'];
const outside = w => w.calls.filter(c => !c.url.startsWith(SB));
const posted = w => w.calls.filter(c => c.method === 'POST' && c.url.includes('/rest/v1/app_news_items')).flatMap(c => c.body);
const rssOf = items => `<rss><channel>${items.join('')}</channel></rss>`;
const rItem = (title, link, desc = '') => `<item><title>${title}</title><link>${link}</link>${desc ? `<description>${desc}</description>` : ''}<pubDate>Sun, 08 Nov 2026 01:00:00 GMT</pubDate></item>`;

test('카탈로그(S59-1): 길이 있는 6곳은 자기 RSS 줄(기본 켬·다 받기·본문 안 읽음), 길이 없는 8곳은 매체 목록에 없다, 구글 뉴스를 읽는 줄·부품이 없다', async () => {
  for (const [key, [list, hosts]] of Object.entries(NEW_RSS)) {
    const s = C.newsSourceByKey(key);
    assert.ok(s, key);
    assert.deepEqual([s.mode, s.lists, s.hosts], ['rss', [list], hosts], key);
    assert.deepEqual([s.on, s.take, s.extract, s.region, s.lang, s.group], [true, 'all', false, 'domestic', 'ko', 'movement'], `${key}: 다른 국내 매체와 같은 규칙`);
    assert.equal(s.google, undefined, key);
    assert.ok(O.allowedUrl(s, list), `${key}: 피드 주소가 주소 검사를 통과(https·허용 호스트)`);
  }
  // http 글 링크를 https로 받는 설정은 노동과세계 한 곳뿐(다른 매체는 https 글 링크만).
  assert.deepEqual(C.NEWS_CATALOG.filter(s => s.httpsLinks === true).map(s => s.key), ['news-worknworld']);
  // 뺀 8곳: 카탈로그·화면 목록·키 목록 어디에도 없다(수집기·매체 선택 창이 카탈로그만 본다). 이미 받은 글·켬 줄은 DB에 그대로 둔다(이 PR은 DB를 건드리지 않음).
  for (const key of REMOVED) {
    assert.equal(C.newsSourceByKey(key), null, key);
    assert.ok(!C.NEWS_SOURCE_KEYS.includes(key), key);
    assert.ok(!C.publicNewsCatalog().some(s => s.key === key), key);
  }
  // 구글 뉴스 검색 RSS는 robots 금지(S58-9) — 그 호스트를 읽는 카탈로그 줄도, 주소를 만드는 부품도 없다.
  for (const s of C.NEWS_CATALOG) {
    assert.ok(!s.hosts.includes('news.google.com'), s.key);
    for (const l of s.lists) assert.notEqual(new URL(l).hostname, 'news.google.com', s.key);
  }
  for (const name of ['GOOGLE_NEWS', 'GOOGLE_NEWS_HOST', 'googleNewsUrl', 'googleSiteUrl', 'isGoogleSite']) assert.equal(C[name], undefined, name);
  // 남은 6곳은 예전 자리 그대로(키 순서): 앞선 매체의 순서가 그대로다.
  assert.deepEqual([...C.NEWS_SOURCE_KEYS], ['news-labortoday', 'news-beminor', 'news-pressian', 'news-khan', 'news-ohmynews', 'news-hankyung', 'news-mk', 'news-sisain',
    'news-newstapa', 'news-hani', 'news-yna', 'news-donga', 'news-jtbc', 'news-sbs', 'news-nocut', 'news-chosun', 'news-newsis', 'news-sedaily', 'news-imaeil',
    'news-psi', 'news-itf', 'news-labourstart', 'news-worknworld', 'news-newsmin', 'news-redaily', 'news-laborplus', 'news-redian', 'news-mt']);
  // 키는 카탈로그 파일에 줄마다 글자 그대로(`{ key: "news-…"`) 적혀 있다 — 색 표 시험(tests/news-colors.test.mjs)이 파일을 글자로 읽어 키를 찾는다.
  const {readFileSync} = await import('node:fs');
  const written = [...readFileSync(new URL('../supabase/functions/_shared/news-catalog.ts', import.meta.url), 'utf8').matchAll(/^\s*\{?\s*key: "([a-z-]+)"/gm)].map(m => m[1]);
  assert.deepEqual(written, [...C.NEWS_SOURCE_KEYS], '카탈로그 키 전부가 파일에서 글자로 읽힌다(같은 순서)');
  assert.equal(new Set(C.NEWS_SOURCE_KEYS).size, C.NEWS_SOURCE_KEYS.length);
  assert.equal(new Set(C.NEWS_CATALOG.map(s => s.name)).size, C.NEWS_CATALOG.length);
});

test('새 RSS 줄(참여와혁신): 키워드 상관없이 전부 받고, 켠 키워드가 든 글은 넣을 때 그 작업공간 키워드를 keywords 칸에 적는다', async () => {
  const s = C.newsSourceByKey('news-laborplus');
  const feed = rssOf([rItem('합성 철도 파업 기사', 'https://www.laborplus.co.kr/news/articleView.html?idxno=1', '합성 소개'),
    rItem('합성 날씨 기사', 'https://www.laborplus.co.kr/news/articleView.html?idxno=2', '합성 버스 소개')]);
  const w = world({
    sources: [{workspace_id: WS1, source_key: 'news-laborplus', enabled: true}, {workspace_id: WS2, source_key: 'news-laborplus', enabled: true}],
    keywords: [{workspace_id: WS1, word: '철도'}, {workspace_id: WS1, word: '파업'}, {workspace_id: WS2, word: '버스'}],
    sites: {'https://www.laborplus.co.kr/robots.txt': {body: 'User-agent: *\nDisallow: /admin/\n'}, [s.lists[0]]: {body: feed, type: 'application/xml'}},
  });
  const out = await w.cron({step: 'media', source: 'news-laborplus'});
  assert.deepEqual([out.status, out.raw, out.listed, out.inserted], ['ok', 2, 2, 4]);
  assert.deepEqual(posted(w).map(r => [r.workspace_id, r.title, r.keywords, r.lane, r.source_key, r.publisher]).sort(), [
    [WS1, '합성 철도 파업 기사', ['철도', '파업'], 'media', 'news-laborplus', '참여와혁신'],
    [WS1, '합성 날씨 기사', [], 'media', 'news-laborplus', '참여와혁신'],
    [WS2, '합성 철도 파업 기사', [], 'media', 'news-laborplus', '참여와혁신'],
    [WS2, '합성 날씨 기사', ['버스'], 'media', 'news-laborplus', '참여와혁신'],
  ].sort(), '키워드 칸은 그 작업공간 키워드만(다른 작업공간 키워드가 섞이지 않음), 소개 글자도 본다');
  assert.deepEqual([...new Set(outside(w).map(c => c.url))].sort(), ['https://www.laborplus.co.kr/robots.txt', s.lists[0]].sort(), '읽은 주소는 그 매체 robots.txt와 피드뿐(글 쪽은 수집 때 안 읽음)');
});

test('노동과세계(httpsLinks): 피드는 https, 글 링크 http는 같은 호스트만 https로 받는다 — http 주소는 요청하지 않고, 다른 호스트·포트 붙은 http 링크는 빠진다', async () => {
  const s = C.newsSourceByKey('news-worknworld');
  const feed = rssOf([
    rItem('합성 노동 기사 하나', 'http://worknworld.kctu.org/news/articleView.html?idxno=1'),
    rItem('합성 노동 기사 둘', '<![CDATA[http://worknworld.kctu.org/news/articleView.html?idxno=2]]>'),
    rItem('합성 노동 기사 셋', 'https://worknworld.kctu.org/news/articleView.html?idxno=3'),
    rItem('합성 남의 기사', 'http://other.example.org/news/4'),
    rItem('합성 포트 기사', 'http://worknworld.kctu.org:8080/news/5'),
    `<item><title>합성 guid 기사</title><guid>http://WORKNWORLD.kctu.org/news/articleView.html?idxno=6</guid></item>`,
  ]);
  const w = world({
    sources: [{workspace_id: WS1, source_key: 'news-worknworld', enabled: true}], keywords: [],
    sites: {'https://worknworld.kctu.org/robots.txt': {body: 'User-agent: *\nDisallow: /admin/\n'}, [s.lists[0]]: {body: feed, type: 'application/xml'}},
  });
  const out = await w.cron({step: 'media', source: 'news-worknworld'});
  assert.deepEqual([out.status, out.raw, out.listed, out.inserted], ['ok', 6, 4, 4]);
  assert.deepEqual(posted(w).map(r => r.url), [1, 2, 3, 6].map(n => `https://worknworld.kctu.org/news/articleView.html?idxno=${n}`));
  assert.ok(outside(w).every(c => c.url.startsWith('https://worknworld.kctu.org/')), 'http 주소·남의 호스트는 요청하지 않음');
  // 바꾸기는 그 매체 hosts의 글 링크만: 설정이 없는 매체 글은 그대로, 다른 호스트는 그대로(그래서 http면 주소 검사에서 빠진다).
  const khan = C.newsSourceByKey('news-khan');
  const x = rssOf([rItem('a', 'http://www.khan.co.kr/a/1')]);
  assert.equal(H.httpsLinkXml(khan, x), x);
  assert.equal(H.httpsLinkXml(s, rssOf([rItem('a', 'http://evil.example/worknworld.kctu.org/1')])), rssOf([rItem('a', 'http://evil.example/worknworld.kctu.org/1')]));
  assert.equal(H.httpsLinkXml(s, rssOf([rItem('a', 'http://worknworld.kctu.org.evil.example/1')])), rssOf([rItem('a', 'http://worknworld.kctu.org.evil.example/1')]));
  assert.equal(H.httpsLinkXml(s, '<feed><link href="http://worknworld.kctu.org/a/1"/></feed>'), '<feed><link href="https://worknworld.kctu.org/a/1"/></feed>');
  // 카탈로그 줄의 http 허용(httpHosts)은 없다 — 수집기는 https만 읽는다.
  assert.equal(s.httpHosts, undefined);
  assert.equal(O.allowedUrl(s, 'http://worknworld.kctu.org/news/articleView.html?idxno=1'), null);
});

test('머니투데이: 피드 호스트 robots.txt가 허용 호스트(https)의 없는 쪽(404)으로 넘기면 robots.txt 없음(전부 허용)으로 보고 읽는다, http로 넘기면 따라가지 않는다', async () => {
  const s = C.newsSourceByKey('news-mt');
  const feed = rssOf([rItem('합성 경제 기사', 'https://www.mt.co.kr/economy/2026/11/08/2026110800001', '합성 소개')]);
  const run = async robots => {
    const w = world({sources: [{workspace_id: WS1, source_key: 'news-mt', enabled: true}], keywords: [],
      sites: {'https://rss.mt.co.kr/robots.txt': {status: 301, headers: {location: robots}, body: ''}, 'https://www.mt.co.kr/robots.txt': {status: 404, body: ''},
        [s.lists[0]]: {body: feed, type: 'application/xml'}}});
    return [await w.cron({step: 'media', source: 'news-mt'}), w];
  };
  const [ok, w1] = await run('https://www.mt.co.kr/robots.txt');
  assert.deepEqual([ok.status, ok.raw, ok.listed, ok.inserted], ['ok', 1, 1, 1]);
  assert.deepEqual(outside(w1).map(c => c.url), ['https://rss.mt.co.kr/robots.txt', 'https://www.mt.co.kr/robots.txt', s.lists[0]]);
  assert.equal(posted(w1)[0].url, 'https://www.mt.co.kr/economy/2026/11/08/2026110800001');
  // http로 넘기거나 허용 밖 호스트로 넘기면 robots.txt를 못 읽은 것 — 피드를 읽지 않는다(우회 없음).
  for (const bad of ['http://www.mt.co.kr/robots.txt', 'https://elsewhere.example.org/robots.txt']) {
    const [no, w2] = await run(bad);
    assert.deepEqual([no.status, no.inserted], ['robots_unreachable', 0], bad);
    assert.deepEqual(outside(w2).map(c => c.url), ['https://rss.mt.co.kr/robots.txt'], bad);
  }
});

// ---- robots 판정은 그대로(S58-9에서 고정한 모양) ------------------------------------------------------------------------
// 구글 뉴스 robots.txt 모양('전부 금지 + 짧은 허용 목록', /rss/ 허용 줄 없음 — 제3자 기록의 모양, docs/design/news-google-site-robots.md 2.3)에서
// 검색 RSS는 표준대로 '금지'다. 이 길을 버린 까닭이 해석 오류가 아니라 실제 금지임을 판정 함수로 남겨 둔다.
const GOOGLE_ROBOTS_SHAPE = 'User-agent: *\nDisallow: /\nAllow: /$\nAllow: /home\nAllow: /topics/\nAllow: /publications/\nAllow: /stories/\nAllow: /swg/\n';
test('robots 판정 그대로: 구글 뉴스 모양에서 검색 RSS는 금지, 허용 목록 경로만 열린다(가장 긴 규칙·$ 끝 표시)', async () => {
  const P = await import('../supabase/functions/outside-feed/parse.ts');
  const allows = path => P.robotsAllows(GOOGLE_ROBOTS_SHAPE, H.ROBOTS_AGENT, path);
  assert.deepEqual(['/', '/home', '/topics/x', '/stories/x?hl=ko'].map(allows), [true, true, true, true]);
  assert.deepEqual(['/rss/search', '/rss/search?q=site:example.org%20when:1d', '/rss/articles/SYN1?oc=5', '/rss'].map(allows), [false, false, false, false]);
  assert.equal(P.robotsAllows(GOOGLE_ROBOTS_SHAPE + 'Allow: /rss/\n', H.ROBOTS_AGENT, '/rss/search?q=x'), true, '막는 까닭은 /rss/ 허용 줄이 없어서다');
  assert.equal(H.ROBOTS_AGENT, 'Web2NewsFeed');
});

test('robots 판정 그대로: 매체 robots.txt가 피드 경로를 막으면(미디어오늘 모양 Disallow:/rss/) robots로 적고 피드를 요청하지 않는다', async () => {
  const s = C.newsSourceByKey('news-redian');
  const w = world({sources: [{workspace_id: WS1, source_key: 'news-redian', enabled: true}], keywords: [],
    sites: {'https://www.redian.org/robots.txt': {body: 'User-agent: *\nDisallow:/rss/\n'}, [s.lists[0]]: {body: rssOf([rItem('합성', 'https://www.redian.org/a/1')]), type: 'application/xml'}}});
  const out = await w.cron({step: 'media', source: 'news-redian'});
  assert.deepEqual([out.status, out.raw, out.inserted], ['robots', 0, 0]);
  assert.deepEqual(outside(w).map(c => new URL(c.url).pathname), ['/robots.txt']);
  assert.deepEqual(w.calls.filter(c => c.method === 'PATCH' && c.url.includes('/rest/v1/app_outside_sources')).map(c => c.body), [{last_error: 'robots'}]);
});

// ---- S59-1 NEWS-키워드살리기: 키워드 단계는 받은 매체 글에 키워드를 적는다(밖으로 요청 없음) ------------------------------
const M = (id, ws, title, keywords = [], more = {}) => ({id: `d0000000-0000-4000-8000-${String(id).padStart(12, '0')}`, workspace_id: ws, lane: 'media', title, title_ko: null, summary: null, keywords, created_at: '2026-11-07T00:00:00Z', ...more});
const kwPatches = w => w.calls.filter(c => c.method === 'PATCH' && c.url.includes('/rest/v1/app_news_items'));
const finalKeywords = w => {
  const out = {};
  for (const c of kwPatches(w)) {
    const u = new URL(c.url);
    for (const id of u.searchParams.get('id').replace(/^in\.\(|\)$/g, '').split(',')) out[id] = [u.searchParams.get('workspace_id'), u.searchParams.get('lane'), c.body.keywords];
  }
  return out;
};

test('키워드 단계: 밖으로 요청하지 않고, 최근 받은 매체 글에 켠 키워드를 적는다 — 새 키워드는 더하고 끈·지운 키워드는 빼며, 작업공간마다 자기 키워드만', async () => {
  const media = [
    M(1, WS1, '합성 철도 기사'), M(2, WS1, '합성 철도 파업 소식', ['철도']), M(3, WS1, '합성 날씨', ['옛말']), M(4, WS1, '합성 철도', ['철도']),
    M(5, WS1, 'Synthetic strike', [], {title_ko: '합성 파업 번역 제목'}), M(6, WS1, '합성 제목', [], {summary: '요약에 철도'}),
    M(7, WS2, '합성 버스 파업'), M(8, WS1, '합성 철도 옛 글', [], {created_at: '2026-10-20T00:00:00Z'}),
  ];
  const w = world({sources: [], keywords: [{workspace_id: WS1, word: '철도'}, {workspace_id: WS1, word: '파업'}, {workspace_id: WS2, word: '버스'}], sites: {}, media});
  const out = await w.cron({step: 'keywords'});
  assert.deepEqual(out, {ok: true, step: 'keywords', workspaces: 2, scanned: 7, done: 6, deferred: 0});
  assert.equal(outside(w).length, 0, '구글 뉴스든 어디든 밖으로 요청하지 않는다');
  const id = n => M(n).id;
  assert.deepEqual(finalKeywords(w), {
    [id(1)]: [`eq.${WS1}`, 'eq.media', ['철도']], [id(2)]: [`eq.${WS1}`, 'eq.media', ['철도', '파업']], [id(3)]: [`eq.${WS1}`, 'eq.media', []],
    [id(5)]: [`eq.${WS1}`, 'eq.media', ['파업']], [id(6)]: [`eq.${WS1}`, 'eq.media', ['철도']], [id(7)]: [`eq.${WS2}`, 'eq.media', ['버스']],
  }, '바뀌는 줄만(4는 그대로), 7일 넘은 글(8)은 보지 않음, 다른 작업공간 키워드(파업)는 WS2 글에 붙지 않음');
  // 같은 결과끼리 한 번에(철도: 1·6 한 요청), 고치는 칸은 keywords·updated_at뿐, 매체 글(lane=media)·그 작업공간만.
  assert.equal(kwPatches(w).length, 5);
  for (const c of kwPatches(w)) assert.deepEqual(Object.keys(c.body).sort(), ['keywords', 'updated_at']);
  const scans = w.calls.filter(c => c.method === 'GET' && c.url.includes('/rest/v1/app_news_items')).map(c => new URL(c.url).searchParams);
  for (const q of scans) {
    assert.equal(q.get('lane'), 'eq.media');
    assert.equal(q.get('created_at'), `gte.${new Date(NOW - H.KEYWORD_SCAN_DAYS * 86400000).toISOString()}`);
    assert.match(q.get('workspace_id'), /^eq\./);
  }
  assert.equal(H.KEYWORD_SCAN_DAYS, 7);
});

test('키워드 단계: 켠 키워드가 없는 작업공간(매체만 켬)은 표시가 남은 줄만 비운다(제목은 읽지 않음), 한 쪽이 꽉 차면 다음 쪽을 읽는다', async () => {
  const w = world({sources: [{workspace_id: WS3, source_key: 'news-khan', enabled: true}], keywords: [], sites: {}, media: [M(9, WS3, '합성 철도', ['옛말']), M(10, WS3, '합성 날씨')]});
  const out = await w.cron({step: 'keywords'});
  assert.deepEqual([out.workspaces, out.done], [1, 1]);
  const gets = w.calls.filter(c => c.method === 'GET' && c.url.includes('/rest/v1/app_news_items')).map(c => new URL(c.url).searchParams);
  assert.deepEqual(gets.map(q => [q.get('keywords'), q.get('select')]), [['neq.{}', 'id']]);
  assert.deepEqual(Object.values(finalKeywords(w)), [[`eq.${WS3}`, 'eq.media', []]]);
  // 쪽 나누기: KEYWORD_SCAN_PAGE줄이 꽉 차면 다음 쪽(offset)을 읽는다.
  const many = Array.from({length: H.KEYWORD_SCAN_PAGE + 3}, (_, i) => M(100 + i, WS1, `합성 ${i}`));
  const p = world({sources: [], keywords: [{workspace_id: WS1, word: '철도'}], sites: {}, media: many});
  const pout = await p.cron({step: 'keywords'});
  assert.equal(pout.scanned, H.KEYWORD_SCAN_PAGE + 3);
  assert.deepEqual(p.calls.filter(c => c.method === 'GET' && c.url.includes('/rest/v1/app_news_items')).map(c => new URL(c.url).searchParams.get('offset')), ['0', String(H.KEYWORD_SCAN_PAGE)]);
  assert.equal(pout.done, 0);
});

test('키워드 낱말 고르기: 작업공간마다 먼저 넣은 30개까지·같은 낱말 한 번, 글 한 건에는 10개까지(DB 검사)', () => {
  const rows = [...Array.from({length: 35}, (_, i) => ({workspace_id: WS1, word: `낱말${i}`})), {workspace_id: WS1, word: '낱말0'}, {workspace_id: 'bad', word: 'x'}, {workspace_id: WS2, word: 7}];
  const m = H.keywordsByWorkspace(rows);
  assert.equal(m.get(WS1).length, H.KEYWORDS_PER_WORKSPACE);
  assert.deepEqual(m.get(WS1).slice(0, 2), ['낱말0', '낱말1']);
  assert.deepEqual([...m.keys()], [WS1]);
  const words = Array.from({length: 12}, (_, i) => `w${i}`);
  assert.equal(H.keywordHits(words.join(' '), words).length, H.KEYWORDS_PER_ITEM);
  assert.equal(H.KEYWORDS_PER_ITEM, 10);
  assert.deepEqual(H.keywordHits('아무 글', []), []);
});


// ---- S57-13 덧붙임(11/11 '제목만이라도') 전수: 글 링크가 남의 매체로 가는 피드도 기사 줄은 남긴다 ---------------------
test('남의 매체 링크 피드(LabourStart): 기사 줄(제목·날짜·링크)은 남기고 글 쪽은 읽지 않는다 — https 공개 호스트 링크만', async () => {
  const s = C.newsSourceByKey('news-labourstart');
  assert.equal(s.linkOut, true);
  for (const x of C.NEWS_CATALOG) if (x.key !== 'news-labourstart') assert.equal(x.linkOut, undefined, `${x.key}: 다른 매체는 자기 호스트 글만`);
  const rss = `<rdf:RDF><channel></channel>
<item rdf:about="x"><title>Synthetic union news one</title><link>https://other.example.org/news/1?a=1&amp;b=2</link><description>Synthetic lead</description><dc:date>2026-11-08T01:00:00Z</dc:date></item>
<item><title>Synthetic union news two</title><link><![CDATA[https://second.example.net/story/2]]></link></item>
<item><title>Synthetic http item</title><link>http://plain.example.org/a</link></item>
<item><title>Synthetic inner item</title><link>https://db.internal/a</link></item>
<item><title>Synthetic number item</title><link>https://10.0.0.5/a</link></item>
</rdf:RDF>`;
  const OFF = 'b0000000-0000-4000-8000-000000000002';
  const w = world({
    sources: [{workspace_id: WS1, source_key: 'news-labourstart', enabled: true}], keywords: [],
    sites: {'https://www.labourstart.org/robots.txt': {body: ''}, [s.lists[0]]: {body: rss, type: 'application/rss+xml'}},
    unread: [{id: OFF, workspace_id: WS1, lane: 'media', source_key: 'news-labourstart', url: 'https://other.example.org/news/1?a=1&b=2', title: 'Synthetic union news one', app_feed_bodies: null}],
  });
  const out = await w.cron({step: 'media', source: 'news-labourstart'});
  assert.deepEqual([out.status, out.raw, out.listed, out.inserted, out.bodies], ['ok', 5, 2, 2, 0], 'http·내부 이름·숫자 주소 링크는 여전히 빠진다');
  const rows = w.calls.filter(c => c.method === 'POST' && c.url.includes('/rest/v1/app_news_items')).flatMap(c => c.body);
  assert.deepEqual(rows.map(r => [r.lane, r.source_key, r.publisher, r.title, r.url, r.lang]), [
    ['media', 'news-labourstart', 'LabourStart(아시아)', 'Synthetic union news one', 'https://other.example.org/news/1?a=1&b=2', 'en'],
    ['media', 'news-labourstart', 'LabourStart(아시아)', 'Synthetic union news two', 'https://second.example.net/story/2', 'en'],
  ]);
  assert.ok(rows[0].published_at);
  // 읽은 주소는 카탈로그 호스트뿐 — 남의 매체는 요청하지 않는다.
  assert.deepEqual([...new Set(outside(w).map(c => new URL(c.url).hostname))], ['www.labourstart.org']);
  // 본문 줄: '못 읽음(off_host)'(요청 없음). 기사 줄 상태는 그대로(제목·매체·날짜와 [원문]).
  const bodies = w.calls.filter(c => c.method === 'POST' && c.url.includes('/rest/v1/app_feed_bodies')).flatMap(c => c.body);
  assert.deepEqual([bodies].flat().map(b => [b.news_item_id, b.state, b.reason, b.rule]), [[OFF, 'failed', 'off_host', 'news-labourstart@1']]);
  assert.equal(w.calls.filter(c => c.method === 'PATCH' && c.url.includes('/rest/v1/app_news_items')).length, 0);
  // 해석할 때만 받아 준다: 카탈로그 줄 자체의 허용 호스트는 늘지 않는다(읽는 주소 규칙 그대로).
  assert.deepEqual(C.newsSourceByKey('news-labourstart').hosts, ['www.labourstart.org', 'labourstart.org']);
  assert.equal(O.allowedUrl(C.newsSourceByKey('news-labourstart'), 'https://other.example.org/news/1'), null);
  assert.equal(H.parseSource(C.newsSourceByKey('news-khan'), rss), C.newsSourceByKey('news-khan'), 'linkOut이 아닌 매체는 그대로');
});
