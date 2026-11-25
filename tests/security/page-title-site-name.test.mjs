// S70-44(READ-제목사이트이름, 명진 11/25 15:19 "제목을 전국철도노동조합으로 읽음 … 기사 제목을 읽어야함"):
// 게시판형 누리집(og:title·<title>이 사이트 이름뿐, 글 제목은 본문 머리 게시판 제목 칸·h1)을 본뜬 가짜 HTML로 제목 뽑기 한 곳(_shared/page-title.ts)을 본다.
// 글·이름은 모두 지어낸 것(실제 누리집 내용 아님). 네트워크 없음 — 단축 주소 따라가기는 가짜 응답으로 note-import 입구 그대로 본다.
import test from 'node:test';
import assert from 'node:assert/strict';

const PT = await import('../../supabase/functions/_shared/page-title.ts');
const NP = await import('../../supabase/functions/news-feed/page.ts');
const H = await import('../../supabase/functions/note-import/handler.ts');
const SI = await import('../../app/share-intake-model.mjs');
const RM = await import('../../app/reading-model.mjs');

const SITE = '지어낸공공노동조합';
const PAGE = 'https://union.example.org/bbs/board.php?bo_table=notice&wr_id=101';
const P = n => `지어낸 공지 ${n}번째 문단이다. 지어낸 사람들이 지어낸 회의에서 지어낸 안전 문제를 길게 이야기했다. `.repeat(3).trim();
// 게시판형 쪽: <title>·og:title·og:site_name 모두 사이트 이름, 머리 로고 h1(그림 alt = 사이트 이름), 메뉴 h2, 글 제목은 게시판 제목 칸.
const board = ({ titleTag = SITE, og = SITE, siteName = SITE, head = 'board', headTitle = '지어낸 선포대회 열려' } = {}) => `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8">
<title>${titleTag}</title>
${og ? `<meta property="og:title" content="${og}">` : ''}
${siteName ? `<meta property="og:site_name" content="${siteName}">` : ''}
</head><body>
<header><h1 class="logo"><a href="/"><img src="/img/logo.png" alt="${SITE}"></a></h1>
<nav><h2>주메뉴</h2><ul><li>공지사항</li><li>자료실</li></ul></nav></header>
<div id="bo_v">
${head === 'board' ? `<header><h2 id="bo_v_title"><span class="bo_v_tit">${headTitle}</span></h2></header>` : ''}
${head === 'h1' ? `<h1>${headTitle}</h1>` : ''}
<section id="bo_v_atc">${[1, 2, 3, 4].map(n => `<p>${P(n)}</p>`).join('')}</section></div>
<footer>${SITE} 지어낸 주소</footer></body></html>`;

test('게시판형 쪽: og:title·<title>이 사이트 이름뿐이면 게시판 제목 칸의 글 제목을 뽑는다', () => {
  assert.equal(PT.pageTitle(board()), '지어낸 선포대회 열려');
  const info = NP.readArticlePage(board(), Date.parse('2026-11-25T07:00:00Z'), { key: 'open', rule: { version: 1 }, base: PAGE });
  assert.equal(info.title, '지어낸 선포대회 열려');
  assert.equal(info.publisher, SITE);
});

test('사이트 이름 메타가 없어도 로고 글자(그림 alt)와 같은 <title>은 사이트 이름으로 보고 본문 h1로', () => {
  assert.equal(PT.pageTitle(board({ og: '', siteName: '', head: 'h1', headTitle: '지어낸 위원회 구성 촉구' })), '지어낸 위원회 구성 촉구');
});

test("'게시판 - 사이트' 꼴 <title>은 게시판 이름·사이트 조각을 떼고, 남는 게 없으면 본문 머리로", () => {
  assert.equal(PT.pageTitle(board({ og: '', titleTag: `공지사항 &gt; ${SITE}` })), '지어낸 선포대회 열려');
  assert.equal(PT.pageTitle(board({ og: '', titleTag: `지어낸 글 제목 | 공지사항 | ${SITE}`, head: 'none' })), '지어낸 글 제목');
});

test('제목 후보가 전부 사이트 이름이면 null(부르는 쪽이 붙여 넣은 글 첫 줄 → 목록에서 뺌 규칙으로)', () => {
  assert.equal(PT.pageTitle(board({ head: 'none' })), null);
  // 짧은 메뉴 이름(4자 미만)·사이트 이름뿐인 h1은 제목이 아니다.
  assert.equal(PT.pageTitle(`<html><head><title>${SITE}</title><meta name="application-name" content="${SITE}"></head><body><h1>${SITE}</h1><h2>메뉴</h2></body></html>`), null);
});

test('보통 기사 쪽은 그대로: og:title 먼저, 사이트 이름과 다른 제목은 손대지 않음', () => {
  const news = `<html><head><title>지어낸 기사 - 지어낸일보</title><meta property="og:title" content="지어낸 기사 제목"><meta property="og:site_name" content="지어낸일보"></head>
<body><h1 class="logo">지어낸일보</h1><h1>다른 머리</h1></body></html>`;
  assert.equal(PT.pageTitle(news), '지어낸 기사 제목');
  // 사이트 이름 조각이 없는 ' - ' 제목은 통째로.
  assert.equal(PT.pageTitle('<html><head><title>지어낸 사람 - 지어낸 이야기</title></head><body></body></html>'), '지어낸 사람 - 지어낸 이야기');
});

test('붙여 넣은 글(텔레그램 공지 꼴): 앞머리 없는 단축 주소를 주소로, 첫 줄을 제목으로(이모지·감싼 따옴표 정리)', () => {
  const text = '“지어낸 회의에 안전은 없다!” 지어낸 위원회 구성을 위한 지어낸 선포대회 열려\n지어낸 본문 한 줄\n👉자세히 보기 bit.ly/3AbCdEf\n✅지어낸 소통실';
  assert.equal(SI.shareArticleUrl({ text }), 'https://bit.ly/3AbCdEf');
  assert.equal(SI.shareArticleTitle({ text }), '“지어낸 회의에 안전은 없다!” 지어낸 위원회 구성을 위한 지어낸 선포대회 열려');
  assert.equal(SI.shareArticleTitle({ text: '📢 "지어낸 공지 제목"\nbit.ly/3AbCdEf' }), '지어낸 공지 제목');
  // 이름이 알려진 단축 주소만 — 아무 'a.b/c'나 주소로 보지 않는다.
  assert.equal(SI.shareArticleUrl({ text: '지어낸 글 example.org/a' }), '');
  assert.equal(RM.sharedReading({ text }).url, 'https://bit.ly/3AbCdEf');
});

test('이미 저장한 줄: 제목이 사이트 이름뿐이면 다시 읽을 때 새 글 제목으로 바꾸고(사람이 단 제목은 그대로), 열 때 한 번 저절로 다시 읽는다', () => {
  const ID = 'c0000000-0000-4000-8000-000000000001';
  const row = { id: ID, url: PAGE, title: SITE, site: SITE, body_state: 'ok', body_at: '2026-11-25T06:00:00Z' };
  assert.equal(RM.siteOnlyTitle(row), true);
  assert.equal(RM.keepOwn(row, { title: '지어낸 선포대회 열려', site: SITE }).title, '지어낸 선포대회 열려');
  assert.equal(RM.keepOwn({ ...row, title: '내가 단 제목' }, { title: '지어낸 선포대회 열려' }).title, undefined);
  // 주소의 사이트 조각과 같은 제목도 사이트 이름뿐으로 본다.
  assert.equal(RM.siteOnlyTitle({ ...row, title: 'union', site: 'union.example.org' }), true);
  assert.equal(RM.needsRefetch(row), true);
  assert.equal(RM.needsRefetch({ ...row, body_at: '2026-11-25T10:00:00Z' }), false); // 고친 서버로 한 번 읽은 뒤
  assert.equal(RM.needsRefetch({ ...row, title: '지어낸 선포대회 열려' }), false);
});

// ---- 단축 주소 → 실제 주소(note-import 입구 그대로, 가짜 응답) ----
const SB = 'https://synthetic.supabase.test', SERVICE = 'synthetic-service-role-key-000000';
const WS = 'a0000000-0000-4000-8000-000000000001', USER = 'b0000000-0000-4000-8000-000000000001';
const JWT = 'synthetic.user.jwt-owner-0001';
const SHORT = 'https://bit.ly/3AbCdEf';
function world(sites) {
  const calls = [];
  const fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    if (url === `${SB}/auth/v1/user`) return Response.json({ id: USER });
    if (url.startsWith(`${SB}/rest/v1/app_workspace_members`)) return Response.json([{ workspace_id: WS }]);
    if (url.startsWith(`${SB}/rest/v1/rpc/`)) return Response.json(true);
    if (url.startsWith(`${SB}/rest/v1/app_news_days`)) return init.method && init.method !== 'GET' ? new Response(null, { status: 201 }) : Response.json([]);
    if (url.startsWith(`${SB}/`)) return Response.json([]);
    const u = new URL(url);
    if (u.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /', { status: 200, headers: { 'content-type': 'text/plain' } });
    const s = sites[url];
    if (!s) return new Response('없음', { status: 404, headers: { 'content-type': 'text/plain' } });
    return new Response(s.body ?? null, { status: s.status ?? 200, headers: s.headers ?? { 'content-type': 'text/html; charset=utf-8' } });
  };
  const resolve = async () => ['93.184.216.34'];
  return { calls, fetch, resolve };
}

test('단축 주소를 따라 실제 글 주소까지 가서 그 쪽의 글 제목을 읽는다(주소 검사·리다이렉트 상한 그대로)', async () => {
  const w = world({ [SHORT]: { status: 301, headers: { location: PAGE } }, [PAGE]: { body: board() } });
  const handler = H.createNoteImportHandler({
    env: k => ({ SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: SERVICE })[k], fetch: w.fetch, resolve: w.resolve,
    now: () => Date.parse('2026-11-25T07:00:00Z'), sleep: async () => {}, log: () => {},
  });
  const res = await handler(new Request('https://synthetic.supabase.test/functions/v1/note-import', {
    method: 'POST', headers: { authorization: `Bearer ${JWT}`, 'content-type': 'application/json' }, body: JSON.stringify({ url: SHORT }),
  }));
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.url, PAGE);
  assert.equal(body.title, '지어낸 선포대회 열려');
  assert.equal(body.site, SITE);
  assert.ok(w.calls.includes(SHORT) && w.calls.includes(PAGE));
});
