// S68-43(사용자 요청 11/23 '옛 보관 글 원문 다시 불러오기'): robots 때문에 원문이 빈 채 남은 지난 글 다시 읽기.
// - outside-feed 예약 수집 끝 retryRobotsBodies: robots 실패 글만, 한 번에 ROBOTS_RETRY_PER_RUN개, robots.txt 없이 글 쪽 한 번, 읽힌 본문은 덮지 않음, 글마다 1번.
// - outside-feed 화면 입구 reread: 로그인 + 'outside' 기능 키 작업공간 + 그 사람이 읽을 수 있는 공용 글 + 본문이 실패·없음일 때만, 하루 한도.
// - reader: skipRobots는 글 쪽 읽기에만(피드 읽기는 robots 그대로).
// - ai-assist now_detail 재료 규칙: 재료 없는 글은 요약하지 않음, 본문이 요약보다 새로우면 다시, 내부 낱말이 든 요약은 버림.
// 네트워크 없음. 사이트·Supabase는 지어낸 응답이다(합성 글·example 모양 주소).
import test from 'node:test';
import assert from 'node:assert/strict';

const OH = await import('../../supabase/functions/outside-feed/handler.ts');
const OC = await import('../../supabase/functions/_shared/outside-catalog.ts');
const B = await import('../../supabase/functions/_shared/now-detail-build.ts');

const NOW = Date.parse('2026-11-23T03:00:00Z');
const WS = 'a0000000-0000-4000-8000-000000000001', WS2 = 'a0000000-0000-4000-8000-000000000002';
const USER = 'b0000000-0000-4000-8000-000000000001', JWT = 'synthetic.user.jwt-owner-0001';
const SB = 'https://synthetic.supabase.test', ANON = 'synthetic-anon-key', SERVICE = 'synthetic-service-role-key';
const id = n => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const WSRC = OC.sourceByKey('ws'), KPTU = OC.sourceByKey('kptu');
const wsUrl = n => `https://ws.or.kr/article/${n}`;
const LONG = '노동자들은 오늘 합성 견본 글의 문단을 차례로 읽는다. 이 문단은 시험용으로 지어낸 글이다. '.repeat(6);
const PAGE = `<html><head><meta property="og:title" content="합성 글"></head><body><article><div class="${WSRC.bodyClass ?? 'article-body'}"><p>${LONG}</p></div></article></body></html>`;
const recent = new Date(NOW - 5 * 86400000).toISOString();

// 아주 작은 표 흉내(get: 줄 그대로, send: 기록만).
function fakeDb(rowsFor) {
  const sent = [];
  return {
    sent,
    get: async (path) => rowsFor(path) ?? [],
    send: async (method, path, body, prefer) => { sent.push({ method, path, body, prefer }); return []; },
  };
}
function fakeReader(result) {
  const asked = [];
  return { asked, get: async (source, url, wantFeed, opts) => { asked.push({ key: source.key, url, wantFeed, opts }); return typeof result === 'function' ? result(url) : result; } };
}
const post = (n, ws, body, extra = {}) => ({ id: id(n), workspace_id: ws, url: wsUrl(n), title: `합성 글 ${n}`, published_at: recent, app_feed_bodies: body, ...extra });
const robots = { state: 'failed', reason: 'robots', rule: 'ws@1' };

test('예약 robots 다시 읽기: robots 실패 글만, 상한 ROBOTS_RETRY_PER_RUN, robots.txt 없이(skipRobots) 한 번, 같은 주소 여러 작업공간 줄을 함께', async () => {
  const rows = [
    post(1, WS, robots), post(1, WS2, [robots]), // 같은 주소 두 작업공간(줄은 둘 다 고침, 읽기는 1번)
    post(2, WS, { state: 'failed', reason: 'timeout', rule: 'ws@1' }), // 다른 실패는 이 길이 아님
    post(3, WS, { state: 'ok', reason: null, rule: 'ws@1' }),
    post(4, WS, null),
    ...Array.from({ length: 8 }, (_, k) => post(10 + k, WS, robots)),
    post(99, WS, robots, { published_at: '2020-01-01T00:00:00Z' }), // 2년 지난 글은 빼기
  ];
  const db = fakeDb(p => p.startsWith('app_outside_posts?') ? rows : p.startsWith('app_outside_articles?') ? [{ id: id(501), url: wsUrl(1) }] : []);
  const reader = fakeReader({ ok: true, text: PAGE, url: wsUrl(1) });
  const out = await OH.retryRobotsBodies(db, reader, () => {}, WSRC, NOW, NOW, () => NOW, 100000);
  assert.equal(out.done, OH.ROBOTS_RETRY_PER_RUN);
  assert.equal(reader.asked.length, OH.ROBOTS_RETRY_PER_RUN);
  assert.ok(reader.asked.every(a => a.wantFeed === false && a.opts?.skipRobots === true), '글 쪽만, robots.txt 없이');
  const urls = reader.asked.map(a => a.url);
  assert.equal(new Set(urls).size, urls.length, '주소마다 1번');
  assert.ok(urls.includes(wsUrl(1)));
  for (const n of [2, 3, 4, 99]) assert.ok(!urls.includes(wsUrl(n)), `${n}: robots 실패가 아님·오래된 글은 읽지 않음`);
  // 같은 주소 두 작업공간 옛 줄 모두 새 결과(읽힘 → merge).
  const oldWrites = db.sent.filter(s => s.path.startsWith('app_feed_bodies'));
  assert.ok(oldWrites.some(s => s.body.outside_post_id === id(1) && s.body.workspace_id === WS && /merge-duplicates/.test(s.prefer)));
  assert.ok(oldWrites.some(s => s.body.outside_post_id === id(1) && s.body.workspace_id === WS2 && /merge-duplicates/.test(s.prefer)));
  assert.ok(oldWrites.every(s => s.body.state === 'ok'));
  // 공용 본문도 새 결과로(읽힘 → merge).
  const shared = db.sent.filter(s => s.path.startsWith('app_outside_article_bodies'));
  assert.ok(shared.some(s => s.method === 'POST' && s.body.article_id === id(501) && s.body.state === 'ok' && /merge-duplicates/.test(s.prefer)));
});

test('예약 robots 다시 읽기: 다시 못 읽으면 실패 줄만 새 까닭으로(읽힌 본문은 그대로) → 다음 실행에 다시 고르지 않음(글마다 1번)', async () => {
  const rows = [post(1, WS, robots)];
  const db = fakeDb(p => p.startsWith('app_outside_posts?') ? rows : p.startsWith('app_outside_articles?') ? [{ id: id(501), url: wsUrl(1) }] : []);
  const reader = fakeReader({ ok: false, code: 'http_404' });
  await OH.retryRobotsBodies(db, reader, () => {}, WSRC, NOW, NOW, () => NOW, 100000);
  const patches = db.sent.filter(s => s.method === 'PATCH');
  assert.ok(patches.length >= 2);
  assert.ok(patches.every(s => /state=eq\.failed/.test(s.path)), '읽힌 본문(ok·lead)은 PATCH 대상이 아님');
  assert.ok(patches.every(s => s.body.state === 'failed' && s.body.reason === 'http_4xx'));
  // 못 읽은 결과의 POST는 없을 때만 넣기(ignore).
  assert.ok(db.sent.filter(s => s.method === 'POST').every(s => /ignore-duplicates/.test(s.prefer)));
  // 새 까닭이 robots가 아니므로 다음에 다시 고르지 않는다.
  assert.equal(OH.isRobotsBody({ state: 'failed', reason: 'http_4xx' }), false);
  assert.equal(OH.isRobotsBody(robots), true);
});

test('예약 robots 다시 읽기: 시간 예산을 넘으면 미루고, 예외 단체·텔레그램·본문 끈 단체는 하지 않음', async () => {
  const rows = [post(1, WS, robots), post(2, WS, robots)];
  const db = fakeDb(p => p.startsWith('app_outside_posts?') ? rows : []);
  const reader = fakeReader({ ok: true, text: PAGE, url: wsUrl(1) });
  const late = await OH.retryRobotsBodies(db, reader, () => {}, WSRC, NOW, NOW, () => NOW + 200000, 100000);
  assert.deepEqual(late, { done: 0, deferred: 2 });
  assert.equal(reader.asked.length, 0);
  for (const s of [KPTU, OC.sourceByKey('justice'), { ...WSRC, extract: false }]) {
    const r = fakeReader({ ok: true, text: PAGE, url: wsUrl(1) });
    const d = fakeDb(() => rows);
    assert.deepEqual(await OH.retryRobotsBodies(d, r, () => {}, s, NOW, NOW, () => NOW, 100000), { done: 0, deferred: 0 });
    assert.equal(r.asked.length + d.sent.length, 0, s.key);
  }
});

test('reader: skipRobots는 글 쪽 읽기만 robots.txt를 건너뛴다(피드 읽기·기본값은 robots 확인 그대로)', async () => {
  const seen = [];
  const doFetch = async (url) => {
    seen.push(url);
    if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow: /\n', { status: 200 });
    return new Response(PAGE, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
  const mk = () => OH.makeReader(doFetch, async () => {}, () => {});
  assert.deepEqual(await mk().get(WSRC, wsUrl(1), false), { ok: false, code: 'robots' }, '기본값: robots.txt가 막으면 읽지 않음');
  seen.length = 0;
  assert.deepEqual(await mk().get(WSRC, WSRC.lists[0], true, { skipRobots: true }), { ok: false, code: 'robots' }, '피드는 skipRobots여도 robots 확인');
  seen.length = 0;
  const got = await mk().get(WSRC, wsUrl(1), false, { skipRobots: true });
  assert.equal(got.ok, true);
  assert.deepEqual(seen, [wsUrl(1)], 'robots.txt를 읽지 않고 글 한 번');
  // 허용 호스트 밖 주소는 skipRobots여도 묻지 않는다.
  seen.length = 0;
  assert.deepEqual(await mk().get(WSRC, 'https://evil.example/x', false, { skipRobots: true }), { ok: false, code: 'url_outside' });
  assert.deepEqual(seen, []);
});

// ---- 화면 입구 reread ----
function rereadWorld({ article = { id: id(501), url: wsUrl(1), source_key: 'ws', title: '합성 글', lang: 'ko' }, body = { state: 'failed', reason: 'robots' }, newsWs = WS, used = 0, site = PAGE, mapped = [] } = {}) {
  const calls = { site: [], service: [], user: [] };
  const res = (v, s = 200) => new Response(v === null ? null : JSON.stringify(v), { status: s, headers: { 'content-type': 'application/json' } });
  const doFetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method ?? 'GET', b = init.body ? JSON.parse(init.body) : undefined;
    if (u.origin !== SB) { calls.site.push(u.href); return u.pathname === '/robots.txt' ? new Response('User-agent: *\nDisallow: /\n', { status: 200 }) : new Response(site, { status: 200, headers: { 'content-type': 'text/html' } }); }
    if (u.pathname === '/auth/v1/user') return init.headers.Authorization === `Bearer ${JWT}` ? res({ id: USER }) : res({}, 401);
    const p = u.pathname.replace('/rest/v1/', '');
    if (init.headers?.apikey === ANON) {
      calls.user.push({ method, p, q: u.search });
      if (p === 'rpc/app_outside_article_of') return res(mapped);
      if (p === 'app_outside_articles') return res(article && `eq.${article.id}` === u.searchParams.get('id') ? [article] : []);
      throw new Error('user login used for ' + p);
    }
    calls.service.push({ method, p, q: decodeURIComponent(u.search), body: b, prefer: init.headers?.Prefer });
    if (p === 'rpc/app_operator_feature_workspace') return res(newsWs);
    if (p === 'app_workspace_members') return res([{ workspace_id: WS }]);
    if (p === 'app_outside_article_bodies' && method === 'GET') return res(body ? [body] : []);
    if (p === 'app_news_days' && method === 'GET') return res(used ? [{ fetch_n: used }] : []);
    if (p === 'app_outside_posts' && method === 'GET') return res([{ id: id(7) }]);
    return res(null, 201);
  };
  const handler = OH.createOutsideFeedHandler({ env: k => ({ SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON })[k], fetch: doFetch, now: () => NOW, sleep: async () => {}, log: () => {} });
  const call = (b, auth = `Bearer ${JWT}`) => handler(new Request(`${SB}/functions/v1/outside-feed?action=reread`, { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(b) }));
  return { calls, call };
}

test('reread: 막힌 글 하나를 robots.txt 없이 한 번 읽어 공용 본문·내 옛 줄을 고치고, 하루 한도를 센다', async () => {
  const w = rereadWorld();
  const r = await w.call({ id: id(501) });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, status: 'ok' });
  assert.deepEqual(w.calls.site, [wsUrl(1)], 'robots.txt 없이 글 쪽 한 번');
  assert.ok(w.calls.service.some(c => c.p === 'app_news_days' && (c.method === 'POST' || c.method === 'PATCH') && c.body.fetch_n === 1), 'fetch_n 하루 한도');
  assert.ok(w.calls.service.some(c => c.p === 'app_outside_article_bodies' && c.method === 'POST' && c.body.article_id === id(501) && c.body.state === 'ok' && /merge-duplicates/.test(c.prefer)));
  assert.ok(w.calls.service.some(c => c.p === 'app_outside_posts' && c.method === 'GET' && c.q.includes(`workspace_id=eq.${WS}`)), '옛 줄은 누른 사람 작업공간만');
  assert.ok(w.calls.service.some(c => c.p === 'app_feed_bodies' && c.body.outside_post_id === id(7) && c.body.workspace_id === WS));
  assert.ok(w.calls.user.some(c => c.p === 'app_outside_articles'), '공용 글은 사용자 로그인(RLS)으로 읽음');
});

test('reread: 이미 읽힌 본문·읽을 수 없는 글·기능 키 밖·한도 넘음·잘못된 몸통은 읽지 않는다', async () => {
  const stored = rereadWorld({ body: { state: 'ok' } });
  assert.deepEqual(await (await stored.call({ id: id(501) })).json(), { ok: true, status: 'stored' });
  assert.equal(stored.calls.site.length, 0);
  const none = rereadWorld({ article: null });
  assert.equal((await none.call({ id: id(501) })).status, 404);
  assert.equal(none.calls.site.length, 0);
  const off = rereadWorld({ newsWs: WS2 });
  assert.equal((await off.call({ id: id(501) })).status, 403);
  assert.equal(off.calls.site.length, 0);
  const limit = rereadWorld({ used: OH.REREAD_DAILY });
  assert.equal((await limit.call({ id: id(501) })).status, 429);
  assert.equal(limit.calls.site.length, 0);
  const exempt = rereadWorld({ article: { id: id(501), url: 'https://www.kptu.net/board/detail.aspx?mid=F686C1F3&idx=9001', source_key: 'kptu', title: '합성' } });
  assert.deepEqual(await (await exempt.call({ id: id(501) })).json(), { ok: true, status: 'scheduled_only' });
  const outside = rereadWorld({ article: { id: id(501), url: 'https://evil.example/x', source_key: 'ws', title: '합성' } });
  assert.deepEqual(await (await outside.call({ id: id(501) })).json(), { ok: true, status: 'original_only' });
  assert.equal(outside.calls.site.length, 0);
  for (const bad of [{}, { id: 'x' }, { id: id(501), url: wsUrl(1) }, { id: id(501), workspace_id: WS2 }]) {
    const w = rereadWorld();
    assert.equal((await w.call(bad)).status, 400, JSON.stringify(bad));
    assert.equal(w.calls.site.length, 0);
  }
  const anon = rereadWorld();
  assert.equal((await anon.call({ id: id(501) }, 'Bearer not-a-real-token-but-long-enough')).status, 401);
});

// ---- 상세 요약 재료 규칙 ----
const item = (extra = {}) => ({ type: 'outside', id: id(501), oldId: null, title: '합성 글', titleKo: '', lang: 'ko', source: '노동자연대', sourceKey: 'ws', kind: 'article', author: '', url: wsUrl(1), summary: '', keySentences: [], body: '', fromFeed: false, bodyAt: null, ...extra });

test('재료 없는 사회운동 글은 요약하지 않는다(제목만으로 요약 금지). 외국 글은 저장 요약·주요 문장이 재료', () => {
  assert.equal(B.itemHasMaterial(item()), false);
  assert.equal(B.itemHasMaterial(item({ body: '합성 성명 본문입니다. 노동자들이 오늘 광장에 모여 임금 인상을 요구했다.' })), true);
  // S69 READ-첨부본문: 글자(띄어쓰기·문장부호 빼고)가 MATERIAL_MIN_CHARS 미만인 본문(마침표 하나 등)은 재료가 아니다.
  assert.equal(B.itemHasMaterial(item({ body: '.' })), false);
  assert.equal(B.itemHasMaterial(item({ body: '[사진] .  ' })), false);
  assert.equal(B.itemHasMaterial(item({ type: 'news', body: '본문' })), false);
  assert.equal(B.itemHasMaterial(item({ lang: 'en', summary: '한국어 요약' })), true);
  assert.equal(B.itemHasMaterial(item({ lang: 'en', keySentences: [{ orig: 'A.', ko: '가.' }] })), true);
  assert.equal(B.itemHasMaterial(item({ type: 'news' })), false);
  assert.equal(B.itemHasMaterial(item({ type: 'news', summary: '요약' })), true);
});

test('본문이 저장 요약보다 새로우면 다시 만든다(본문 없이·옛 본문으로 만든 요약 교체). 시각을 모르면 그대로', () => {
  const made = { generated_at: '2026-11-20T00:00:00Z' };
  assert.equal(B.detailOlderThanBody(item({ fromFeed: true, body: '본문', bodyAt: '2026-11-23T00:00:00Z' }), made), true);
  assert.equal(B.detailOlderThanBody(item({ fromFeed: true, body: '본문', bodyAt: '2026-11-19T00:00:00Z' }), made), false);
  assert.equal(B.detailOlderThanBody(item({ fromFeed: true, body: '본문', bodyAt: null }), made), false);
  assert.equal(B.detailOlderThanBody(item({ fromFeed: false, bodyAt: '2026-11-23T00:00:00Z' }), made), false);
  assert.equal(B.detailOlderThanBody(item({ fromFeed: true, bodyAt: '2026-11-23T00:00:00Z' }), null), false);
});

test('내부 낱말(material 등)·제목만으로 만든 요약은 저장·표시하지 않는다. 지시문에 금지 문장', () => {
  for (const bad of ['제목상 이스라엘의 지상전 재개를 다룬다. 다만 material이 비어 있어 구체적인 사건 경과는 확인할 수 없음.', 'stored_summary가 없어 알 수 없다.', '재료가 비어 있어 요약할 수 없다.', '제목만으로 보면 휴전이 끝났다는 글이다.'])
    assert.equal(B.isNoContentSummary(bad), true, bad);
  for (const good of ['정부는 철도 분할을 멈춰야 한다고 주장한다.', '노동자들이 원자재(material) 값 인상에 항의했다'.replace('(material)', '')])
    assert.equal(B.isNoContentSummary(good), false, good);
  assert.equal(B.cleanCore({ summary: '다만 material이 비어 있어 확인할 수 없음.', key_sentences: [] }, '', false), null);
  assert.match(B.NOW_BASIC_INSTRUCTIONS, /자료 칸 이름.*쓰지 않는다.*summary는 빈 문자열/);
  assert.match(B.NOW_CONTEXT_INSTRUCTIONS, /자료 칸 이름.*쓰지 않는다/);
});
