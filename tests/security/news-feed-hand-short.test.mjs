// S69 READ-첨부본문(사용자 11/24): 손으로 넣은 기사 본문이 '[사진 1] .'처럼 짧으면, 사람이 글 보기 [원문 다시 가져오기](open again)를 누를 때만
// 원래 주소를 다시 읽어(쪽 본문이 짧으면 첨부 PDF·HWP까지) 전문이면 본문을 바꾼다. 손 제목·매체는 그대로, 손으로 넣은 사진은 앞에 남는다.
// 긴 손 본문·again 없는 열기는 지금처럼 덮지 않는다(S68-40·S68-44). 네트워크 없음(합성 글·example 주소).
import test from 'node:test';
import assert from 'node:assert/strict';
import {fakePdf} from '../helpers/fake-pdf.mjs';

const H = await import('../../supabase/functions/news-feed/handler.ts');
const NOW = Date.parse('2026-11-24T03:00:00Z');
const SB = 'https://synthetic.supabase.test';
const WS = 'a0000000-0000-4000-8000-000000000001', USER = 'b0000000-0000-4000-8000-000000000001', JWT = 'synthetic.user.jwt-owner-0001';
const ART = 'c0000000-0000-4000-8000-000000000020';
const URL1 = 'https://www.example.org/portal/bbs/view.do?nttId=1';
const PHOTO = 'https://img.example.org/graph.png';
const LINES = ['청년고용 부진 및 정책 과제', '최근 청년층 고용률이 하락하고 있으며 중소기업 입사 뒤 대기업으로 옮기는 길이 좁아지고 있다.'];
const PAGE = `<html lang="ko"><head><meta property="og:title" content="[제2026-27호] 원래 쪽 제목"></head><body><div class="view"><p><img src="https://www.example.org/img/g.png"></p><p>.</p>
<a href="/portal/cmmn/file/fileDown.do?atchFileId=F1&amp;fileSn=1">합성보고서.pdf</a></div></body></html>`;
const handArt = extra => ({id: ART, origin: 'manual', lane: 'channel', url: URL1, url_key: 'www.example.org/portal/bbs/view.do?nttId=1', title: '점점 힘들어지는 중소 입사 -> 대기업 이직 테크', title_key: 'x',
  lang: 'ko', publisher: '한국은행', published_at: '2026-11-23T00:21:00Z', state: 'ok', fetched_at: '2026-11-24T02:59:00Z', summary: null, body: '.', body_kind: 'full', title_ko: null, body_ko: null,
  translated_at: null, source_key: null, manual_at: '2026-11-23T00:21:00Z', ...extra});
const handBody = {article_id: ART, blocks: [{t: 'img', src: PHOTO, cap: null, alt: null}, {t: 'p', text: '.'}], state: 'ok', reason: null, rule: 'manual@1', chars: 1, images: 1, captions: 0};

function world({art = handArt(), body = handBody, sites = {}} = {}) {
  const db = {app_news_articles: [structuredClone(art)], app_news_article_bodies: [structuredClone(body)], app_news_items: [], app_feed_bodies: [], app_news_days: [], app_news_id_map: [], app_news_now_details: [], app_now_details: []};
  const calls = {sites: [], ai: 0};
  const res = (v, s = 200) => new Response(v === null ? null : JSON.stringify(v), {status: s, headers: {'content-type': 'application/json'}});
  const doFetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method ?? 'GET', body = init.body ? JSON.parse(init.body) : undefined;
    if (u.origin !== SB) {
      if (/openai/.test(u.host)) { calls.ai++; return new Response('', {status: 500}); }
      calls.sites.push(u.href);
      const s = sites[u.href];
      if (!s) return new Response('', {status: 404});
      return new Response(s.body, {status: 200, headers: s.headers});
    }
    if (u.pathname === '/auth/v1/user') return init.headers.Authorization === `Bearer ${JWT}` ? res({id: USER}) : res({}, 401);
    const p = u.pathname.replace('/rest/v1/', '');
    if (init.headers?.apikey === 'synthetic-anon') {
      if (p === 'rpc/app_news_article_of') return res([]);
      if (p === 'app_news_articles') { const id = u.searchParams.get('id')?.slice(3); return res(db.app_news_articles.filter(a => a.id === id)); }
      throw new Error('unexpected user read ' + p);
    }
    if (p === 'app_workspace_members') return res([{workspace_id: WS}]);
    if (p === 'rpc/app_operator_feature_workspace') return res(body?.p_feature === 'outside' ? WS : null);
    if (p.startsWith('rpc/')) return res(null);
    const t = db[p];
    if (!t) throw new Error('unexpected table ' + method + ' ' + p);
    const f = [...u.searchParams].filter(([k]) => !['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k));
    const pick = () => t.filter(r => f.every(([k, v]) => { const val = decodeURIComponent(v); return val.startsWith('in.(') ? val.slice(4, -1).split(',').includes(String(r[k] ?? '')) : String(r[k] ?? '') === val.slice(3); }));
    if (method === 'GET') return res(pick());
    if (method === 'PATCH') { for (const r of pick()) Object.assign(r, body); return res(null, 204); }
    if (method === 'POST') {
      const key = u.searchParams.get('on_conflict'), rows = Array.isArray(body) ? body : [body];
      for (const b of rows) { const hit = key ? t.find(r => key.split(',').every(k => r[k] === b[k])) : null; if (hit) { if (!(init.headers?.Prefer || '').includes('ignore-duplicates')) Object.assign(hit, b); } else t.push(b); }
      return res(null, 201);
    }
    return res(null, 204);
  };
  const handler = H.createNewsFeedHandler({env: k => ({SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key', SUPABASE_ANON_KEY: 'synthetic-anon', NEWS_FEED_CRON_SECRET: 'x'.repeat(40)})[k],
    fetch: doFetch, now: () => NOW, sleep: async () => {}, log: () => {}, resolve: async () => ['93.184.216.34']});
  const open = async b => { const r = await handler(new Request(`${SB}/functions/v1/news-feed?action=open`, {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${JWT}`}, body: JSON.stringify(b)})); return {status: r.status, body: await r.json()}; };
  return {db, calls, open};
}
const PDF_URL = 'https://www.example.org/portal/cmmn/file/fileDown.do?atchFileId=F1&fileSn=1';
const SITES = {[URL1]: {body: PAGE, headers: {'content-type': 'text/html; charset=utf-8'}}, [PDF_URL]: {body: fakePdf(LINES), headers: {'content-type': 'application/pdf'}}};

test('짧은 손 본문 판정: 글자(띄어쓰기·문장부호 빼고) 20자 미만인 손 기사만', () => {
  assert.equal(H.handShort(handArt()), true);
  assert.equal(H.handShort(handArt({body: null, body_kind: null})), true, '사진만 손 본문');
  assert.equal(H.handShort(handArt({body: '사람이 넣은 긴 본문입니다. 노동자들이 오늘 광장에 모여 요구안을 밝혔다.'})), false);
  assert.equal(H.handShort(handArt({manual_at: null})), false, '손 기사가 아니면 아님');
  assert.equal(H.meaningfulChars(' . , [사진] '), 2);
});

test('again: 짧은 손 본문 → 원래 주소 + 첨부 PDF로 전문, 손 제목·매체 그대로, 손 사진은 앞에', async () => {
  const w = world({sites: SITES});
  const out = await w.open({id: ART, again: true});
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const a = w.db.app_news_articles[0], bd = w.db.app_news_article_bodies[0];
  assert.equal(bd.state, 'ok');
  assert.notEqual(bd.rule, 'manual@1');
  assert.match(bd.blocks.filter(b => b.t === 'p').map(b => b.text).join('\n'), /청년층 고용률이 하락하고/);
  assert.equal(bd.blocks[0].src, PHOTO, '손으로 넣은 사진이 맨 앞');
  assert.equal(a.title, '점점 힘들어지는 중소 입사 -> 대기업 이직 테크', '사람이 고친 제목 그대로');
  assert.equal(a.publisher, '한국은행');
  assert.equal(a.body_kind, 'full');
  assert.match(a.body, /청년층/);
  assert.ok(a.manual_at, '손 기사 표시는 그대로 — 이제 긴 본문이라 다시 보호된다');
  assert.equal(H.handShort(a), false);
  assert.ok(w.calls.sites.includes(PDF_URL));
});

test('again 없이 열기·긴 손 본문은 덮지 않는다(사이트도 읽지 않음)', async () => {
  let w = world({sites: SITES});
  assert.deepEqual((await w.open({id: ART})).body, {ok: true, status: 'stored'});
  assert.equal(w.calls.sites.length, 0);
  assert.equal(w.db.app_news_article_bodies[0].rule, 'manual@1');
  w = world({sites: SITES, art: handArt({body: '사람이 넣은 긴 본문입니다. 노동자들이 오늘 광장에 모여 요구안을 밝혔다.'})});
  assert.deepEqual((await w.open({id: ART, again: true})).body, {ok: true, status: 'stored'});
  assert.equal(w.calls.sites.length, 0);
});

test('again: 다시 읽어도 전문이 없으면(첨부 없음·실패) 손 본문 그대로', async () => {
  const w = world({sites: {[URL1]: {body: '<html><body><p>.</p></body></html>', headers: {'content-type': 'text/html'}}}});
  const out = await w.open({id: ART, again: true});
  assert.equal(out.body.status, 'same');
  assert.deepEqual(w.db.app_news_article_bodies[0].blocks, handBody.blocks);
  assert.equal(w.db.app_news_articles[0].body, '.');
});
