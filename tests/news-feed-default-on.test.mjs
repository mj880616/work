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
function world({sources, keywords, sites, have = [], unread = []}) {
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
        return res([]);
      }
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

// 기본 켬 매체 전부(자기 RSS 17곳 → 미디어오늘이 구글 뉴스 매체 단위로 옮겨 16곳 + 구글 뉴스 매체 단위 줄, S57-13).
const DEFAULT_ON = ['news-khan', 'news-ohmynews', 'news-hankyung', 'news-mk', 'news-sisain', 'news-newstapa',
  'news-hani', 'news-yna', 'news-donga', 'news-jtbc', 'news-sbs', 'news-nocut', 'news-chosun',
  'news-newsis', 'news-sedaily', 'news-imaeil',
  'news-mediatoday', 'news-worknworld', 'news-newsmin', 'news-redaily', 'news-busan',
  'news-laborplus', 'news-redian', 'news-newsone', 'news-edaily', 'news-mt', 'news-kookje', 'news-kyeonggi', 'news-kyeongin', 'news-yeongnam'];

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

// ---- S57-13 NEWS-못넣은곳대안: 구글 뉴스 매체 단위(site:도메인) 줄 --------------------------------------------------
// 자기 RSS로 못 넣는 매체를 구글 뉴스 검색 RSS로 매체 단위로 받는다. 네트워크 없음 — 글·주소는 모두 지어낸 것.
const U = await import('../supabase/functions/_shared/news-url.ts');
const PG = await import('../supabase/functions/news-feed/page.ts');
const GOOGLE_SITES = {
  'news-mediatoday': 'mediatoday.co.kr', 'news-worknworld': 'worknworld.kctu.org', 'news-newsmin': 'newsmin.co.kr', 'news-redaily': 'redaily.co.kr',
  'news-busan': 'busan.com', 'news-laborplus': 'laborplus.co.kr', 'news-redian': 'redian.org', 'news-newsone': 'news1.kr', 'news-edaily': 'edaily.co.kr',
  'news-mt': 'mt.co.kr', 'news-kookje': 'kookje.co.kr', 'news-kyeonggi': 'kyeonggi.com', 'news-kyeongin': 'kyeongin.com', 'news-yeongnam': 'yeongnam.com',
};
const gItem = (n, title, tail = ' - 미디어오늘') => `<item><title>${title}${tail}</title><link>https://news.google.com/rss/articles/SYN${n}?oc=5</link>` +
  `<pubDate>Sun, 08 Nov 2026 01:0${n}:00 GMT</pubDate><description>&lt;a href="https://news.google.com/rss/articles/SYN${n}?oc=5"&gt;${title}&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;미디어오늘&lt;/font&gt;</description>` +
  `<source url="https://www.mediatoday.co.kr">미디어오늘</source></item>`;
const gSites = (s, items) => ({'https://news.google.com/robots.txt': {body: 'User-agent: *\nAllow: /rss/\n'}, [s.lists[0]]: {body: `<rss><channel>${items.join('')}</channel></rss>`, type: 'application/xml'}});
const outside = w => w.calls.filter(c => !c.url.startsWith(SB));

test('카탈로그: 구글 뉴스 매체 단위 줄은 검색 RSS 한 경로에 site:도메인만, 기본 켬·다 받기·본문 안 읽음, 자기 사이트 주소는 없음', async () => {
  assert.deepEqual(C.NEWS_CATALOG.filter(s => C.isGoogleSite(s)).map(s => s.key).sort(), Object.keys(GOOGLE_SITES).sort(), '매체 단위 줄은 이 목록과 정확히 같다');
  for (const [key, domain] of Object.entries(GOOGLE_SITES)) {
    const s = C.newsSourceByKey(key);
    assert.equal(s.google, domain, key);
    assert.deepEqual(s.hosts, ['news.google.com'], `${key}: 읽는 호스트는 구글 뉴스뿐(매체 사이트는 읽지 않음)`);
    assert.equal(s.lists.length, 1, key);
    const u = new URL(s.lists[0]);
    assert.deepEqual([u.protocol, u.hostname, u.pathname], ['https:', 'news.google.com', '/rss/search'], key);
    assert.equal(u.searchParams.get('q'), `site:${domain} when:1d`, `${key}: 키워드 없이 매체 단위`);
    assert.deepEqual([u.searchParams.get('hl'), u.searchParams.get('gl'), u.searchParams.get('ceid')], ['ko', 'KR', 'KR:ko']);
    assert.deepEqual([s.on, s.take, s.extract, s.region, s.lang], [true, 'all', false, 'domestic', 'ko'], `${key}: 다른 국내 매체와 같은 규칙`);
  }
  // 구글 뉴스 호스트를 읽는 카탈로그 줄은 모두 매체 단위 줄이다(다른 길로 구글 주소를 읽는 줄이 없다).
  for (const s of C.NEWS_CATALOG) assert.equal(s.hosts.includes('news.google.com'), C.isGoogleSite(s), s.key);
  // 미디어오늘: robots.txt가 막아 자기 RSS 줄을 뺐다 — 카탈로그 어디에도 그 사이트 주소가 없다.
  assert.ok(!JSON.stringify(C.NEWS_CATALOG.map(s => [s.lists, s.hosts])).includes('mediatoday.co.kr/'));
  assert.ok(!C.newsSourceByKey('news-mediatoday').hosts.some(h => h.includes('mediatoday')));
  // 새 줄은 카탈로그 맨 끝에 더했다: 앞선 매체의 순서가 그대로다(목록 색 칸이 카탈로그 순서로 정해지므로 앞선 매체의 색이 바뀌지 않는다). 미디어오늘은 제자리.
  assert.deepEqual(C.NEWS_SOURCE_KEYS.slice(0, 23), ['news-labortoday', 'news-beminor', 'news-pressian', 'news-khan', 'news-ohmynews', 'news-hankyung', 'news-mk', 'news-sisain',
    'news-newstapa', 'news-hani', 'news-yna', 'news-donga', 'news-jtbc', 'news-sbs', 'news-nocut', 'news-chosun', 'news-mediatoday', 'news-newsis', 'news-sedaily', 'news-imaeil',
    'news-psi', 'news-itf', 'news-labourstart']);
  assert.deepEqual(C.NEWS_SOURCE_KEYS.slice(23).sort(), Object.keys(GOOGLE_SITES).filter(k => k !== 'news-mediatoday').sort());
  // 키는 카탈로그 파일에 줄마다 글자 그대로(`{ key: "news-…"`, 영문 소문자·줄표만) 적혀 있다 — 색 표 시험(tests/news-colors.test.mjs)이 파일을 글자로 읽어 키를 찾는다.
  // (#2365에서 키를 함수 인자로 넘겼더니 그 시험이 미디어오늘 키를 못 찾아 main이 깨졌다 → 같은 정규식으로 전부 찾히는지 여기서 고정.)
  const {readFileSync} = await import('node:fs');
  const written = [...readFileSync(new URL('../supabase/functions/_shared/news-catalog.ts', import.meta.url), 'utf8').matchAll(/^\s*\{?\s*key: "([a-z-]+)"/gm)].map(m => m[1]);
  assert.deepEqual(written.filter(k => k !== 'news-google'), [...C.NEWS_SOURCE_KEYS], '카탈로그 키 전부가 파일에서 글자로 읽힌다(같은 순서)');
  // 키·이름은 겹치지 않는다(목록의 매체 이름·도배막기 묶음·색이 키와 이름으로 정해진다).
  assert.equal(new Set(C.NEWS_SOURCE_KEYS).size, C.NEWS_SOURCE_KEYS.length);
  assert.equal(new Set(C.NEWS_CATALOG.map(s => s.name)).size, C.NEWS_CATALOG.length);
  // 도메인 글자만 받는다(검색어에 다른 연산자·주소를 끼워 넣을 수 없음).
  for (const bad of ['', 'localhost', 'evil.example/path', 'a b.example', 'https://x.example', 'x.example OR y', 'X.Example', 'x.example"']) assert.throws(() => C.googleSiteUrl(bad), bad);
  assert.equal(C.isGoogleSite(C.newsSourceByKey('news-khan')), false);
  assert.equal(C.isGoogleSite(C.GOOGLE_NEWS), false, '키워드 찾기는 매체 줄이 아니다');
});

test('구글 뉴스 매체 단위: 키워드가 없어도 그 매체 글 전부 — 제목 끝 매체 꼬리 떼고 매체 이름은 카탈로그, 본문은 안 읽고 relay 줄만', async () => {
  const s = C.newsSourceByKey('news-mediatoday');
  const BODYLESS = 'b0000000-0000-4000-8000-000000000001';
  const w = world({
    sources: [{workspace_id: WS1, source_key: 'news-beminor', enabled: true}], // 뉴스 씀 → 기본 켬. 키워드는 하나도 없다.
    keywords: [], sites: gSites(s, [gItem(1, '합성 방송 기사'), gItem(2, '합성 신문 - 부제 기사')]),
    unread: [{id: BODYLESS, workspace_id: WS1, lane: 'media', source_key: 'news-mediatoday', app_feed_bodies: null}],
  });
  const out = await w.cron({step: 'media', source: 'news-mediatoday'});
  assert.deepEqual([out.ok, out.status, out.raw, out.listed, out.inserted, out.bodies, out.relay], [true, 'ok', 2, 2, 2, 0, 1]);
  const rows = w.calls.filter(c => c.method === 'POST' && c.url.includes('/rest/v1/app_news_items')).flatMap(c => c.body);
  assert.deepEqual(rows.map(r => [r.workspace_id, r.lane, r.source_key, r.publisher, r.title, r.url]), [
    [WS1, 'media', 'news-mediatoday', '미디어오늘', '합성 방송 기사', 'https://news.google.com/rss/articles/SYN1?oc=5'],
    [WS1, 'media', 'news-mediatoday', '미디어오늘', '합성 신문 - 부제 기사', 'https://news.google.com/rss/articles/SYN2?oc=5'],
  ], '매체 이름은 카탈로그 이름(RSS 매체와 같은 길), 링크는 구글 중계 주소 그대로');
  for (const r of rows) {
    assert.deepEqual([r.summary, r.body, r.body_kind, r.keywords, r.state, r.lang], [null, null, null, [], 'ok', 'ko'], '제목·매체·날짜·링크만(구글 소개 칸은 싣지 않음)');
    assert.ok(r.published_at, '날짜는 남는다');
  }
  // 읽은 주소: 구글 뉴스 robots.txt와 검색 RSS뿐. 중계 주소(글 쪽)·매체 사이트는 요청하지 않는다.
  assert.deepEqual([...new Set(outside(w).map(c => new URL(c.url).origin + new URL(c.url).pathname))].sort(), ['https://news.google.com/robots.txt', 'https://news.google.com/rss/search']);
  // 본문 줄: '못 읽음(relay)' 한 줄(요청 없음) — 화면은 제목·매체·날짜와 [원문]만 보인다.
  const bodies = w.calls.filter(c => c.method === 'POST' && c.url.includes('/rest/v1/app_feed_bodies')).flatMap(c => c.body);
  assert.deepEqual(bodies.map(b => [b.news_item_id, b.workspace_id, b.state, b.reason]), [[BODYLESS, WS1, 'failed', 'relay']]);
  assert.equal(w.calls.filter(c => c.method === 'PATCH' && c.url.includes('/rest/v1/app_news_items')).length, 0, '기사 줄 상태는 건드리지 않음');
});

test('구글 뉴스 매체 단위: robots.txt가 막으면 읽지 않는다(우회 없음)', async () => {
  const s = C.newsSourceByKey('news-newsmin');
  const sites = gSites(s, [gItem(1, '합성 기사', ' - 뉴스민')]);
  sites['https://news.google.com/robots.txt'] = {body: 'User-agent: *\nDisallow: /\n'};
  const w = world({sources: [{workspace_id: WS1, source_key: 'news-newsmin', enabled: true}], keywords: [], sites});
  const out = await w.cron({step: 'media', source: 'news-newsmin'});
  assert.deepEqual([out.status, out.raw, out.inserted], ['robots', 0, 0]);
  assert.deepEqual(outside(w).map(c => new URL(c.url).pathname), ['/robots.txt']);
});

test('겹침: 같은 글이 키워드 찾기(같은 중계 주소)나 RSS(같은 제목)로 이미 들어와 있으면 다시 넣지 않는다', async () => {
  const s = C.newsSourceByKey('news-mediatoday');
  const link1 = 'https://news.google.com/rss/articles/SYN1?oc=5';
  // 주소 열쇠는 키워드 찾기와 같은 계산(urlKey) — 같은 중계 주소면 같은 열쇠. 제목 열쇠는 끝 ' - 매체'를 떼므로 RSS 제목과 구글 제목이 같은 열쇠가 된다.
  assert.equal(PG.titleKey('합성 둘째 기사 - 미디어오늘'), PG.titleKey('합성 둘째 기사'));
  const w = world({
    sources: [{workspace_id: WS1, source_key: 'news-mediatoday', enabled: true}, {workspace_id: WS2, source_key: 'news-mediatoday', enabled: true}], keywords: [],
    sites: gSites(s, [gItem(1, '합성 첫째 기사'), gItem(2, '합성 둘째 기사'), gItem(3, '합성 셋째 기사'), gItem(3, '합성 셋째 기사')]),
    have: [{workspace_id: WS1, url_key: U.urlKey(link1)}, {workspace_id: WS1, title_key: PG.titleKey('합성 둘째 기사')}], // WS1에는 첫째(키워드로)·둘째(RSS로)가 이미 있다
  });
  const out = await w.cron({step: 'media', source: 'news-mediatoday'});
  const rows = w.calls.filter(c => c.method === 'POST' && c.url.includes('/rest/v1/app_news_items')).flatMap(c => c.body);
  assert.deepEqual(rows.map(r => [r.workspace_id, r.title]).sort(), [[WS1, '합성 셋째 기사'], [WS2, '합성 둘째 기사'], [WS2, '합성 셋째 기사'], [WS2, '합성 첫째 기사']].sort(),
    'WS1은 새 글 하나만, 겹침이 없는 WS2는 셋 모두(피드 안 같은 글 두 번은 한 번)');
  assert.equal(out.inserted, 4);
  assert.equal(rows.find(r => r.workspace_id === WS2 && r.title === '합성 첫째 기사').url_key, U.urlKey(link1));
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
