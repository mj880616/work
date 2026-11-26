// S68-49(사용자 11/23 12:43 "업데이트 됐는데도 여전히 못 읽음" — 사회운동 글 원문 '사이트가 자동 읽기를 막아 둠', 단추 없음, 요약 HTTP 422).
// - 바깥 사이트 읽기 머리글: 브라우저 호환 꼴 User-Agent(위장 없음 — 브라우저 제품 이름 없음) + 일반 브라우저 Accept·Accept-Language, 쿠키·인증 없음.
// - outside-feed reread: 봇 확인(bot_check) 실패도 한 번 다시 읽는다. 같은 글을 REREAD_COOLDOWN_MS 안에 다시 누르면 사이트를 읽지 않음(recent, 한도도 안 씀).
// - outside-feed hand_body: 끝내 못 읽는 글에 사람이 본문을 붙여 넣는다(글 id·본문만, 기능 키 작업공간, 읽힌 본문은 덮지 않음).
// - 손 본문(manual@1)은 예약 다시 읽기·reread가 덮지 않는다.
// 네트워크 없음. 사이트·Supabase는 지어낸 응답이다(합성 글·example 모양 주소).
import test from 'node:test';
import assert from 'node:assert/strict';

const OH = await import('../../supabase/functions/outside-feed/handler.ts');
const NH = await import('../../supabase/functions/news-feed/handler.ts');
const F = await import('../../supabase/functions/_shared/feed-fetch.ts');
const RH = await import('../../supabase/functions/_shared/reader-headers.ts');
const B = await import('../../supabase/functions/_shared/now-detail-build.ts');
const OC = await import('../../supabase/functions/_shared/outside-catalog.ts');

const NOW = Date.parse('2026-11-23T04:00:00Z');
const WS = 'a0000000-0000-4000-8000-000000000001', WS2 = 'a0000000-0000-4000-8000-000000000002';
const USER = 'b0000000-0000-4000-8000-000000000001', JWT = 'synthetic.user.jwt-owner-0001';
const SB = 'https://synthetic.supabase.test', ANON = 'synthetic-anon-key', SERVICE = 'synthetic-service-role-key';
const id = n => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const WSRC = OC.sourceByKey('ws');
const wsUrl = n => `https://ws.or.kr/article/${n}`;
const LONG = '노동자들은 오늘 합성 견본 글의 문단을 차례로 읽는다. 이 문단은 시험용으로 지어낸 글이다. '.repeat(6);
const PAGE = `<html><head><meta property="og:title" content="합성 글"></head><body><article><div class="${WSRC.bodyClass ?? 'article-body'}"><p>${LONG}</p></div></article></body></html>`;
const BOT = '<html><head><title>Just a moment...</title></head><body>Checking your browser before accessing. Enable JavaScript and cookies to continue. cf-challenge</body></html>';
const BROWSER_NAMES = /Chrome|Safari|Firefox|Edg\/|Gecko|AppleWebKit|Windows NT|Android|iPhone/;

test('머리글: 세 수집 함수 User-Agent는 브라우저 호환 꼴(Mozilla/5.0 (compatible; 이름/판; +주소)) — 브라우저 제품 이름으로 위장하지 않음', () => {
  for (const ua of [OH.USER_AGENT, NH.USER_AGENT, B.NOW_OUTSIDE_UA]) {
    assert.match(ua, /^Mozilla\/5\.0 \(compatible; Web2(Outside|News)Feed\/1\.0; \+https:\/\/github\.com\/mj880616\/work\/blob\/main\/docs\/design\/[a-z-]+\.md\)$/);
    assert.doesNotMatch(ua, BROWSER_NAMES);
  }
  assert.equal(OH.USER_AGENT, B.NOW_OUTSIDE_UA, '사회운동 글은 어느 함수가 읽어도 같은 이름');
  assert.throws(() => RH.readerUserAgent('Chrome 120', '1.0', 'https://github.com/mj880616/work/x'));
  assert.throws(() => RH.readerUserAgent('Web2X', '1.0', 'https://evil.example/x'));
  const h = RH.readerHeaders(OH.USER_AGENT, RH.BROWSER_ACCEPT_HTML);
  assert.deepEqual(Object.keys(h).sort(), ['Accept', 'Accept-Language', 'User-Agent'], '쿠키·인증·압축 머리글은 넣지 않음(압축은 실행 환경이 알림)');
  assert.match(h.Accept, /^text\/html,application\/xhtml\+xml/);
  assert.match(h['Accept-Language'], /^ko-KR,ko;q=0\.9/);
  assert.equal(F.ACCEPT_HTML, RH.BROWSER_ACCEPT_HTML);
  assert.equal(F.ACCEPT_FEED, RH.BROWSER_ACCEPT_FEED);
});

test('머리글: 공용 읽기(makeFeedReader — 뉴스·상세·주소 저장)는 같은 머리글로 GET, 간격·쿠키 없음 그대로', async () => {
  const seen = [];
  const r = F.makeFeedReader({
    doFetch: async (url, init) => { seen.push({ url, init }); return new URL(url).pathname === '/robots.txt' ? new Response('', { status: 404 }) : new Response('<html><body>합성</body></html>', { status: 200, headers: { 'content-type': 'text/html' } }); },
    sleep: async () => {}, log: () => {}, userAgent: NH.USER_AGENT, robotsAgent: 'Web2NewsFeed', gapMs: 2000, allow: raw => { try { const u = new URL(raw); return u.hostname === 'news.example.org' ? u : null; } catch { return null; } },
  });
  const got = await r.get('https://news.example.org/a/1', F.ACCEPT_HTML);
  assert.equal(got.ok, true);
  for (const s of seen) {
    assert.equal(s.init.method, 'GET'); assert.equal(s.init.credentials, 'omit'); assert.equal(s.init.redirect, 'manual');
    assert.equal(s.init.headers['User-Agent'], NH.USER_AGENT);
    assert.match(s.init.headers['Accept-Language'], /^ko-KR/);
    assert.equal(s.init.headers.Cookie, undefined); assert.equal(s.init.headers.Authorization, undefined); assert.equal(s.init.headers['Accept-Encoding'], undefined);
  }
  assert.equal(seen.find(s => s.url.endsWith('/a/1')).init.headers.Accept, RH.BROWSER_ACCEPT_HTML);
});

// ---- 화면 입구(reread·hand_body) ----
function world({ article = { id: id(501), url: wsUrl(1), source_key: 'ws', title: '합성 글', lang: 'ko' }, body = { state: 'failed', reason: 'bot_check', rule: null, updated_at: '2026-11-19T10:00:00Z' }, newsWs = WS, used = 0, site = PAGE } = {}) {
  const calls = { site: [], headers: [], service: [], user: [] };
  const res = (v, s = 200) => new Response(v === null ? null : JSON.stringify(v), { status: s, headers: { 'content-type': 'application/json' } });
  const doFetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method ?? 'GET', b = init.body ? JSON.parse(init.body) : undefined;
    if (u.origin !== SB) { calls.site.push(u.href); calls.headers.push(init.headers); return new Response(site, { status: 200, headers: { 'content-type': 'text/html' } }); }
    if (u.pathname === '/auth/v1/user') return init.headers.Authorization === `Bearer ${JWT}` ? res({ id: USER }) : res({}, 401);
    const p = u.pathname.replace('/rest/v1/', '');
    if (init.headers?.apikey === ANON) {
      calls.user.push({ method, p, q: u.search });
      if (p === 'rpc/app_outside_article_of') return res([]);
      if (p === 'app_outside_articles') return res(article && `eq.${article.id}` === u.searchParams.get('id') ? [article] : []);
      throw new Error('user login used for ' + p);
    }
    calls.service.push({ method, p, q: decodeURIComponent(u.search), body: b, prefer: init.headers?.Prefer });
    if (p === 'rpc/app_operator_feature_workspace') return res(newsWs);
    if (p === 'app_workspace_members') return res([{ workspace_id: WS }]);
    if (p === 'app_outside_article_bodies' && method === 'GET') return res(body ? [body] : []);
    if (p === 'app_news_days' && method === 'GET') return res(used ? [{ fetch_n: used }] : []);
    if (p === 'app_outside_posts' && method === 'GET') return res([]);
    return res(null, 201);
  };
  const handler = OH.createOutsideFeedHandler({ env: k => ({ SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON })[k], fetch: doFetch, now: () => NOW, sleep: async () => {}, log: () => {} });
  const call = (action, b, auth = `Bearer ${JWT}`) => handler(new Request(`${SB}/functions/v1/outside-feed?action=${action}`, { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(b) }));
  return { calls, call };
}
const bodyWrites = w => w.calls.service.filter(c => c.p === 'app_outside_article_bodies' && c.method !== 'GET');

test('reread: 봇 확인(bot_check)으로 막힌 글도 한 번 다시 읽는다(정직한 머리글) → 읽히면 본문 저장', async () => {
  const w = world();
  assert.deepEqual(await (await w.call('reread', { id: id(501) })).json(), { ok: true, status: 'ok' });
  assert.deepEqual(w.calls.site, [wsUrl(1)], '글 쪽 한 번(robots.txt 없이)');
  assert.equal(w.calls.headers[0]['User-Agent'], OH.USER_AGENT);
  assert.equal(w.calls.headers[0].Accept, RH.BROWSER_ACCEPT_HTML);
  assert.ok(bodyWrites(w).some(c => c.method === 'POST' && c.body.state === 'ok' && /merge-duplicates/.test(c.prefer)));
});

test('reread: 다시 읽어도 봇 확인 화면이면 풀지 않고 실패 그대로(bot_check)', async () => {
  const w = world({ site: BOT });
  assert.deepEqual(await (await w.call('reread', { id: id(501) })).json(), { ok: true, status: 'bot_check' });
  assert.equal(w.calls.site.length, 1, '한 번만 — 되풀이·우회 없음');
  assert.ok(bodyWrites(w).every(c => c.method !== 'POST' || /ignore-duplicates/.test(c.prefer)), '실패 결과는 읽힌 본문을 덮지 않음');
});

test('reread: 같은 글을 REREAD_COOLDOWN_MS 안에 다시 누르면 사이트를 읽지 않고 recent(하루 한도도 안 씀). 손 본문은 다시 읽지 않음', async () => {
  const soon = world({ body: { state: 'failed', reason: 'bot_check', rule: null, updated_at: new Date(NOW - 60000).toISOString() } });
  assert.deepEqual(await (await soon.call('reread', { id: id(501) })).json(), { ok: true, status: 'recent', reason: 'bot_check' });
  assert.equal(soon.calls.site.length, 0);
  assert.ok(!soon.calls.service.some(c => c.p === 'app_news_days' && c.method !== 'GET'), '한도를 쓰지 않음');
  const later = world({ body: { state: 'failed', reason: 'bot_check', rule: null, updated_at: new Date(NOW - OH.REREAD_COOLDOWN_MS - 1000).toISOString() } });
  assert.equal((await (await later.call('reread', { id: id(501) })).json()).status, 'ok');
  assert.equal(later.calls.site.length, 1);
  const hand = world({ body: { state: 'failed', reason: 'no_body', rule: OH.HAND_RULE, updated_at: '2026-11-01T00:00:00Z' } });
  assert.deepEqual(await (await hand.call('reread', { id: id(501) })).json(), { ok: true, status: 'stored' });
  assert.equal(hand.calls.site.length, 0);
  assert.equal(OH.REREAD_COOLDOWN_MS, 10 * 60 * 1000);
});

test('hand_body: 못 읽은 글에 붙여 넣은 본문을 문단 블록(manual@1)으로 공용 본문에 저장, 바깥 사이트·AI 없음', async () => {
  const w = world();
  const r = await w.call('hand_body', { id: id(501), body: '첫 문단 <b>그대로 글자</b>\r\n\r\n둘째 문단\u0007 끝' });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, status: 'filled' });
  assert.equal(w.calls.site.length, 0);
  const put = bodyWrites(w).find(c => c.method === 'POST');
  assert.equal(put.body.article_id, id(501));
  assert.equal(put.body.state, 'ok'); assert.equal(put.body.rule, 'manual@1'); assert.equal(put.body.reason, null);
  assert.deepEqual(put.body.blocks, [{ t: 'p', text: '첫 문단 <b>그대로 글자</b>' }, { t: 'p', text: '둘째 문단 끝' }], 'HTML 해석 없이 글자, 제어 글자 빼기');
  assert.match(put.prefer, /merge-duplicates/);
  assert.ok(w.calls.user.some(c => c.p === 'app_outside_articles'), '공용 글은 사용자 로그인(RLS)으로 읽음');
});

test('hand_body: 읽힌 본문은 409, 손 본문은 고침, 기능 키 밖 403·못 읽는 글 404·빈/너무 긴 본문·다른 칸 400·로그인 없음 401', async () => {
  const read = world({ body: { state: 'ok', reason: null, rule: 'ws@1' } });
  assert.equal((await read.call('hand_body', { id: id(501), body: '본문' })).status, 409);
  assert.equal(bodyWrites(read).length, 0);
  const again = world({ body: { state: 'ok', reason: null, rule: 'manual@1' } });
  assert.equal((await again.call('hand_body', { id: id(501), body: '고친 본문' })).status, 200);
  assert.equal((await world({ newsWs: WS2 }).call('hand_body', { id: id(501), body: '본문' })).status, 403);
  assert.equal((await world({ article: null }).call('hand_body', { id: id(501), body: '본문' })).status, 404);
  for (const bad of [{ id: id(501) }, { id: id(501), body: '  \n ' }, { id: id(501), body: 'ㄱ'.repeat(OH.HAND_BODY_MAX + 1) }, { id: id(501), body: 7 },
    { id: 'x', body: '본문' }, { id: id(501), body: '본문', workspace_id: WS2 }, { id: id(501), body: '본문', url: wsUrl(2) }]) {
    const w = world();
    assert.equal((await w.call('hand_body', bad)).status, 400, JSON.stringify(bad).slice(0, 80));
    assert.equal(bodyWrites(w).length, 0);
  }
  // 몸통 크기 상한(hand_body만 HAND_MAX_BYTES, 다른 입구는 예전 상한 그대로) — 넘으면 저장 없이 거절(읽기 상한 400 또는 머리 길이 413).
  for (const [action, b] of [['hand_body', { id: id(501), body: 'ㄱ'.repeat(90000) }], ['reread', { id: id(501), body: 'ㄱ'.repeat(2000) }]]) {
    const w = world();
    assert.ok([400, 413].includes((await w.call(action, b)).status), action);
    assert.equal(bodyWrites(w).length, 0); assert.equal(w.calls.site.length, 0);
  }
  assert.equal((await world().call('hand_body', { id: id(501), body: '본문' }, 'Bearer not-a-real-token-but-long-enough')).status, 401);
});

test('handBodyOf: 빈 줄로 문단(없으면 줄마다), 블록 400개까지 이어 붙임', () => {
  assert.deepEqual(OH.handBodyOf('가\n나\n다').blocks.map(b => b.text), ['가', '나', '다']);
  assert.deepEqual(OH.handBodyOf('가\n나\n\n다').blocks.map(b => b.text), ['가 나', '다']);
  const many = OH.handBodyOf(Array.from({ length: 1000 }, (_, i) => `문단${i}`).join('\n'));
  assert.ok(many.blocks.length <= 400);
  assert.equal(OH.handBodyOf(''), null);
  assert.equal(OH.handBodyOf(null), null);
});

// ---- 손 본문은 다시 읽기가 덮지 않는다 ----
test('예약 robots 다시 읽기: 공용 본문이 손 본문(manual@1)이면 읽힌 결과로도 덮지 않고, 실패 PATCH도 손 본문은 대상 밖', async () => {
  const sent = [];
  const rows = [{ id: id(1), workspace_id: WS, url: wsUrl(1), title: '합성 글', published_at: new Date(NOW - 86400000).toISOString(), app_feed_bodies: { state: 'failed', reason: 'robots', rule: 'ws@1' } }];
  const db = {
    get: async p => p.startsWith('app_outside_posts?') ? rows : p.startsWith('app_outside_articles?') ? [{ id: id(501), url: wsUrl(1) }]
      : p.startsWith('app_outside_article_bodies?') ? [{ rule: 'manual@1' }] : [],
    send: async (method, path, body, prefer) => { sent.push({ method, path, body, prefer }); return []; },
  };
  const reader = { get: async () => ({ ok: true, text: PAGE, url: wsUrl(1) }) };
  await OH.retryRobotsBodies(db, reader, () => {}, WSRC, NOW, NOW, () => NOW, 100000);
  assert.ok(!sent.some(s => s.path.startsWith('app_outside_article_bodies') && /merge-duplicates/.test(s.prefer || '')), '손 본문을 읽힌 결과로 덮지 않음');
  const failRun = [];
  const db2 = { ...db, send: async (method, path, body, prefer) => { failRun.push({ method, path, body, prefer }); return []; } };
  await OH.retryRobotsBodies(db2, { get: async () => ({ ok: false, code: 'http_404' }) }, () => {}, WSRC, NOW, NOW, () => NOW, 100000);
  const patch = failRun.find(s => s.method === 'PATCH' && s.path.startsWith('app_outside_article_bodies'));
  assert.match(patch.path, /state=eq\.failed&or=\(rule\.is\.null,rule\.neq\.manual@1\)/);
});

// S69-02(사용자 11/24 "글 안에서도 원문 다시 불러오기 버튼"): 다 읽은 글도 ⋯ [원문 다시 가져오기](again:true) — 새 결과가 전문이고 더 길 때만 바꾼다.
test('reread again: 읽힌 본문도 again이면 한 번 읽어 더 긴 전문이면 바꾸고, 같거나 짧으면 same(쓰기 0). again 없이는 예전처럼 stored. 간격·손 본문 그대로', async () => {
  const old = '2026-11-01T00:00:00Z';
  const plain = world({ body: { state: 'ok', reason: null, rule: 'ws@1', chars: 10, updated_at: old } });
  assert.deepEqual(await (await plain.call('reread', { id: id(501) })).json(), { ok: true, status: 'stored' });
  assert.equal(plain.calls.site.length, 0);
  const longer = world({ body: { state: 'ok', reason: null, rule: 'ws@1', chars: 10, updated_at: old } });
  assert.deepEqual(await (await longer.call('reread', { id: id(501), again: true })).json(), { ok: true, status: 'ok' });
  assert.equal(longer.calls.site.length, 1);
  assert.ok(bodyWrites(longer).some(c => c.method === 'POST' && c.body.state === 'ok' && /merge-duplicates/.test(c.prefer)));
  const same = world({ body: { state: 'ok', reason: null, rule: 'ws@1', chars: 100000, updated_at: old } });
  assert.deepEqual(await (await same.call('reread', { id: id(501), again: true })).json(), { ok: true, status: 'same' });
  assert.equal(bodyWrites(same).length, 0, '같거나 짧으면 고치지 않음');
  const soon = world({ body: { state: 'ok', reason: null, rule: 'ws@1', chars: 10, updated_at: new Date(NOW - 60000).toISOString() } });
  assert.equal((await (await soon.call('reread', { id: id(501), again: true })).json()).status, 'recent');
  assert.equal(soon.calls.site.length, 0);
  const hand = world({ body: { state: 'ok', reason: null, rule: OH.HAND_RULE, chars: 10, updated_at: old } });
  assert.equal((await (await hand.call('reread', { id: id(501), again: true })).json()).status, 'stored');
  assert.equal(hand.calls.site.length, 0);
  for (const bad of [{ id: id(501), again: false }, { id: id(501), again: 1 }]) assert.equal((await plain.call('reread', bad)).status, 400);
});
