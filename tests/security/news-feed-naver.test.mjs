// S67-10 NEWS-네이버공유읽기: 폰 공유로 넣은 네이버 기사(n.news.naver.com·m.entertain.naver.com)가 '제목 없음'으로 남던 일.
// 네트워크 없음: 사이트·Supabase는 모두 지어낸 응답이다. 기사 글은 네이버 뉴스·연예 화면 뼈대(본문 칸, <br>로 나눈 문단, 사진 설명·좋아요 줄·저작권 줄)를
// 흉내 낸 합성 글이고 실제 기사 원문이 아니다. 이 파일이 고정하는 것:
// 1) 네이버 화면 모양은 news-feed 공유 보관(save_url)이 지금 부품(page.ts readArticlePage → _shared/feed-extract.ts, note-import와 같은 부품)으로 읽는다
//    — 그러니 운영에서 제목이 비는 까닭은 화면 모양이 아니라 '읽기 자체가 못 된 것'(robots 막힘·늦은 답·4xx)이다.
// 2) 기사 한 쪽은 robots.txt를 읽지 않는다(S68-25, 사용자 결정 2026-11-22 — 사람이 공유로 넣은 한 쪽). 봇 확인·없는 글은 넘지 않고 까닭만 남긴다.
// 3) 공유 창이 넘긴 제목은 원문 제목을 못 얻었을 때만 기사 제목이 된다(원문 제목이 있으면 원문 제목). 글자로만, 주소·빈 글은 버림.
// 4) 사람이 누른 읽기(save_url·open)만 요청 하나 20초, 수집은 10초 그대로.
import test from 'node:test';
import assert from 'node:assert/strict';

const H = await import('../../supabase/functions/news-feed/handler.ts');
const F = await import('../../supabase/functions/_shared/feed-fetch.ts');
const NOW = Date.parse('2026-11-19T06:00:00Z');
const SB = 'https://synthetic.supabase.test';
const WS = 'a0000000-0000-4000-8000-000000000002', USER = 'b0000000-0000-4000-8000-000000000002', JWT = 'synthetic.user.jwt-owner-0002';
const FN = `${SB}/functions/v1/news-feed`;
const NEWS = 'https://n.news.naver.com/mnews/article/000/0000000001', ENT = 'https://m.entertain.naver.com/article/000/0000000002';
const s = '노동자들은 오늘 합성 기사 본문을 읽는다. 이 문장은 네이버 화면 뼈대를 흉내 낸 합성 문장이다. ';
const NEWS_HTML = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>합성 기사 제목 : 네이버 뉴스</title>
<meta property="og:title" content="합성 기사 제목"><meta property="og:type" content="article"><meta property="og:description" content="합성 요약 앞부분"></head>
<body><div id="ct" class="newsct"><div class="media_end_head go_trans"><h2 id="title_area" class="media_end_head_headline"><span>합성 기사 제목</span></h2>
<span class="media_end_head_info_datestamp_time _ARTICLE_DATE_TIME" data-date-time="2026-11-19 07:50:00">2026.11.19. 오전 7:50</span>
<a href="https://www.example.org/news/1" class="media_end_head_origin_link">기사원문</a></div>
<div id="contents" class="newsct_body"><div id="newsct_article" class="newsct_article _article_body"><article id="dic_area" class="go_trans _article_content">
<strong class="media_end_summary">합성 요약 한 줄</strong><span class="end_photo_org"><img src="https://imgnews.pstatic.net/image/000/0000000001_001.jpg" alt=""><em class="img_desc">합성 사진 설명</em></span><br><br>
첫째 ${s.repeat(3)}<br><br>둘째 ${s.repeat(4)}<br><br>셋째 ${s.repeat(2)}</article></div></div>
<div class="_reactionModule">좋아요 훈훈해요 슬퍼요 화나요 후속기사 원해요</div><div class="media_end_copyright">Copyright ⓒ 합성일보. All rights reserved. 무단 전재 및 재배포 금지.</div></div></body></html>`;
const ENT_HTML = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>합성 연예 제목</title>
<meta property="og:title" content="합성 연예 제목"><meta property="og:site_name" content="네이버 엔터"><meta property="og:description" content="합성 연예 요약"></head>
<body><div class="NewsEndMain_comp_article_head"><h2 class="NewsEndMain_article_title">합성 연예 제목</h2><em class="date">2026.11.19. 오전 9:16</em></div>
<article id="comp_news_article" class="NewsEndMain_comp_news_article"><div class="_article_content" id="articeBody">
첫째 ${s.repeat(3)}<br><br>둘째 ${s.repeat(4)}<br><br>셋째 ${s.repeat(2)}</div></article>
<div class="u_likeit">좋아요 0</div><div class="copyright">Copyright ⓒ 합성연예. All rights reserved. 무단 전재 및 재배포 금지.</div></body></html>`;

function world({robots = null, pages = {[NEWS]: NEWS_HTML, [ENT]: ENT_HTML}, slow = new Set()} = {}) {
  const db = {app_news_articles: [], app_news_marks: [], app_news_days: [], app_news_article_bodies: []};
  const calls = {site: [], timeouts: []};
  let n = 100;
  const res = (v, st = 200) => new Response(v === null ? null : JSON.stringify(v), {status: st, headers: {'content-type': 'application/json'}});
  const doFetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method ?? 'GET', body = init.body ? JSON.parse(init.body) : undefined;
    if (u.origin !== SB) {
      calls.site.push(u.href);
      if (u.pathname === '/robots.txt') return robots === null ? new Response('', {status: 404}) : new Response(robots, {status: 200, headers: {'content-type': 'text/plain'}});
      if (slow.has(u.href)) { const e = new Error('timed out'); e.name = 'TimeoutError'; throw e; }
      const page = pages[u.href];
      return page ? new Response(page, {status: 200, headers: {'content-type': 'text/html;charset=UTF-8'}}) : new Response('', {status: 404});
    }
    if (u.pathname === '/auth/v1/user') return init.headers.Authorization === `Bearer ${JWT}` ? res({id: USER}) : res({}, 401);
    const p = u.pathname.replace('/rest/v1/', '');
    if (p === 'app_workspace_members') return res([{workspace_id: WS}]);
    if (p === 'rpc/app_operator_feature_workspace') return res(body?.p_feature === 'outside' ? WS : null);
    if (p === 'rpc/app_news_user_save') {
      let art = db.app_news_articles.find(a => a.url_key === body.p_url_key), created = false;
      if (!art) {
        if (body.p_page === null) return res({ok: true, found: false});
        art = {id: `c0000000-0000-4000-8000-${String(n++).padStart(12, '0')}`, origin: 'user', lane: 'channel', url: body.p_url, url_key: body.p_url_key, ...body.p_page};
        db.app_news_articles.push(art); created = true;
      }
      return res({ok: true, found: true, created, article_id: art.id, state: art.state});
    }
    const t = db[p];
    if (!t) throw new Error('unexpected table ' + method + ' ' + p);
    const f = [...u.searchParams].filter(([k]) => !['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k));
    const pick = () => t.filter(r => f.every(([k, v]) => String(r[k] ?? '') === decodeURIComponent(v.slice(3))));
    if (method === 'GET') return res(pick().slice(0, Number(u.searchParams.get('limit') || 1000)));
    if (method === 'PATCH') { for (const r of pick()) Object.assign(r, body); return res(null, 204); }
    if (method === 'POST') { t.push(body); return res(null, 201); }
    return res(null, 204);
  };
  const handler = H.createNewsFeedHandler({env: k => ({SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key', SUPABASE_ANON_KEY: 'synthetic-anon', NEWS_FEED_CRON_SECRET: 'synthetic-news-feed-cron-secret-0123456789abc'})[k],
    fetch: doFetch, now: () => NOW, sleep: async () => {}, log: () => {}});
  const call = body => handler(new Request(`${FN}?action=save_url`, {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${JWT}`}, body: JSON.stringify(body)}));
  return {db, calls, call};
}
const out = async r => ({status: r.status, body: await r.json()});
const bodyOf = (w, art) => w.db.app_news_article_bodies.find(b => b.article_id === art.id);

test('네이버 뉴스·연예 모바일 기사: 공유 보관이 제목·본문을 읽는다(화면 모양이 원인이 아님)', async () => {
  const w = world();
  for (const [url, title] of [[NEWS, '합성 기사 제목'], [ENT, '합성 연예 제목']]) {
    const r = await out(await w.call({url}));
    assert.equal(r.status, 200); assert.equal(r.body.status, 'saved', url);
    const art = w.db.app_news_articles.find(a => a.url === url);
    assert.equal(art.state, 'ok'); assert.equal(art.title, title); assert.equal(art.body_kind, 'full');
    assert.match(art.body, /^첫째 /m); assert.match(art.body, /둘째 /); assert.match(art.body, /셋째 /);
    assert.doesNotMatch(art.body, /훈훈해요|무단 전재|pstatic/, '좋아요 줄·저작권 줄·사진 주소는 본문이 아니다');
    assert.equal(bodyOf(w, art).state, 'ok');
  }
  assert.deepEqual(w.calls.site, [NEWS, ENT], '읽은 곳은 그 기사뿐(robots.txt는 읽지 않음, S68-25)');
});

test('S68-25: robots.txt가 막아도 기사 한 쪽은 읽는다(robots.txt를 부르지 않음). 없는 글은 넘지 않고 공유 창 제목 + 까닭만', async () => {
  const w = world({robots: 'User-agent: *\nDisallow: /\n', pages: {[NEWS]: NEWS_HTML}});
  const a = await out(await w.call({url: NEWS, title: '공유한 합성 기사 제목 : 네이버 뉴스'}));
  assert.equal(a.body.status, 'saved');
  const art = w.db.app_news_articles.find(x => x.url === NEWS);
  assert.equal(art.state, 'ok'); assert.equal(art.title, '합성 기사 제목', '원문 제목이 있으면 원문 제목'); assert.equal(art.body_kind, 'full');
  assert.equal(bodyOf(w, art).state, 'ok');
  const b = await out(await w.call({url: ENT, title: '공유한 합성 연예 제목 : 네이버 뉴스'}));
  assert.equal(b.body.status, 'no_body');
  const ent = w.db.app_news_articles.find(x => x.url === ENT);
  assert.equal(ent.state, 'failed'); assert.equal(ent.title, '공유한 합성 연예 제목', '포털 꼬리는 뗀다');
  assert.deepEqual([bodyOf(w, ent).state, bodyOf(w, ent).reason], ['failed', 'http_4xx']);
  assert.deepEqual(w.calls.site, [NEWS, ENT], 'robots.txt는 부르지 않는다');
});

test('원문 제목이 있으면 공유 창 제목보다 원문 제목. 늦은 답(timeout)이면 공유 창 제목 + 까닭 timeout', async () => {
  const w = world({slow: new Set([ENT])});
  await w.call({url: NEWS, title: '사람이 넘긴 다른 제목'});
  assert.equal(w.db.app_news_articles.find(x => x.url === NEWS).title, '합성 기사 제목');
  await w.call({url: ENT, title: '[네이버 연예] 공유한 합성 연예 제목'});
  const ent = w.db.app_news_articles.find(x => x.url === ENT);
  assert.deepEqual([ent.state, ent.title], ['failed', '공유한 합성 연예 제목']);
  assert.equal(bodyOf(w, ent).reason, 'timeout');
});

test('공유 창 제목은 글자로만: 주소·빈 글·제어 문자는 버리거나 지우고, 모양이 틀린 값·너무 긴 값은 400', async () => {
  assert.equal(H.shareTitle('https://n.news.naver.com/mnews/article/000/1'), null);
  assert.equal(H.shareTitle('n.news.naver.com/mnews/article/000/1'), null);
  assert.equal(H.shareTitle('   '), null);
  assert.equal(H.shareTitle(12), null);
  assert.equal(H.shareTitle('합성\u0000 제목\n둘째 줄 - 다음뉴스'), '합성 제목 둘째 줄');
  assert.equal(H.shareTitle('<b>합성</b> 제목'), '<b>합성</b> 제목', 'HTML로 해석하지 않는다(화면이 글자로 그림)');
  assert.ok([...H.shareTitle('가'.repeat(900))].length <= H.SHARE_TITLE_MAX);
  const w = world({robots: 'User-agent: *\nDisallow: /\n'});
  for (const body of [{url: NEWS, title: 1}, {url: NEWS, title: {}}, {url: NEWS, title: 'x'.repeat(H.SHARE_TITLE_IN_MAX + 1)}, {url: NEWS, title: 'x', extra: 1}])
    assert.equal((await w.call(body)).status, 400, JSON.stringify(body).slice(0, 60));
  assert.equal(w.calls.site.length, 0, '거절은 원문을 읽지 않는다');
  assert.equal((await out(await w.call({url: NEWS, title: null}))).body.status, 'saved', 'title null은 받는다(robots는 보지 않음, S68-25)');
});

test('읽기 시간 한도: 사람이 누른 읽기만 20초, 그 밖의 값은 받지 않고 10초', async () => {
  assert.equal(F.FETCH_TIMEOUT_MS, 10000); assert.equal(F.PERSON_FETCH_TIMEOUT_MS, 20000);
  const seen = [];
  const orig = AbortSignal.timeout;
  AbortSignal.timeout = ms => { seen.push(ms); return orig.call(AbortSignal, ms); };
  try {
    const mk = timeoutMs => F.makeFeedReader({doFetch: async () => new Response('', {status: 404}), sleep: async () => {}, log: () => {}, userAgent: 'x', robotsAgent: 'x', gapMs: 0, allow: r => new URL(r), timeoutMs});
    for (const t of [undefined, 20000, 60000, 1]) { seen.length = 0; await mk(t).get('https://example.org/a', 'text/html'); assert.deepEqual([...new Set(seen)], [t === 20000 ? 20000 : 10000], String(t)); }
  } finally { AbortSignal.timeout = orig; }
});
