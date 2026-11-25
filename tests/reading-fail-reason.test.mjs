// S70-40a READ-실패까닭(docs/design/reading-screens.md 2절 A5·A6, 6절 ②): 원문을 못 가져온 까닭을 서버(note-import)가 바르게 가르고,
// 화면 모델(reading-model.mjs)이 그 까닭대로 저장 상태·한 줄을 고르는지 고정한다.
// - 로그인 화면 → login(그 화면의 제목·리드를 글 제목·본문으로 쓰지 않음)
// - 유료벽 → paywall, 메타 설명만(본문 못 찾음) → lead, 401·403 → bot_check, 시간 초과 → timeout
// 네트워크 없음. 쪽 HTML은 모두 지어낸 것이다(실제 사이트·기사 아님).
import test from 'node:test';
import assert from 'node:assert/strict';

const H = await import('../supabase/functions/note-import/handler.ts');
const G = await import('../supabase/functions/note-import/guard.ts');
const {bodyPatch, stateLine} = await import('../app/reading-model.mjs');

const NOW = Date.parse('2026-11-25T00:00:00Z');
const html = (url, text) => ({text, url, contentType: 'text/html; charset=utf-8'});
const LONG = '합성 문장으로 만든 본문입니다. 이 글은 시험용으로 지어낸 글이고 실제 기사가 아닙니다. '.repeat(12);

// 로그인 화면(리다이렉트 뒤 최종 주소가 /login): og 제목·설명이 있지만 글이 아니다.
const LOGIN_TITLE = '가짜 서비스에서 만든 작품을 둘러보세요';
const LOGIN_HTML = `<!doctype html><html lang="en"><head><title>${LOGIN_TITLE}</title>
<meta property="og:title" content="${LOGIN_TITLE}"><meta property="og:description" content="가짜 서비스 소개 한 줄"><meta property="og:site_name" content="가짜 서비스"></head>
<body><main><h1>Log in</h1><form><input type="email" name="email"><input type="password" name="pw"><button>Continue</button></form></main></body></html>`;
// 같은 로그인 화면이 원래 주소 그대로 200으로 올 때(경로로는 모름): 비밀번호 칸 + 로그인 문구 + 본문 없음.
const LOGIN_SAME_URL = `<!doctype html><html lang="ko"><head><title>가짜 게시판</title><meta property="og:title" content="가짜 게시판 글"><meta property="og:description" content="가짜 게시판 소개"></head>
<body><div class="box"><p>로그인이 필요합니다.</p><form><input name="id"><input type="password" name="pw"><button>로그인</button></form></div></body></html>`;
// 유료벽 표시(isAccessibleForFree=false)가 있는 기사: 공개 리드만.
const PAYWALL_HTML = `<!doctype html><html lang="ko"><head><title>가짜 유료 기사</title><meta property="og:title" content="가짜 유료 기사"><meta property="og:description" content="가짜 유료 기사 공개 리드">
<script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false}</script></head><body><article><p>짧은 공개 앞부분.</p></article></body></html>`;
// 본문을 못 찾고 메타 설명만 있는 쪽(유료벽 아님).
const LEAD_HTML = `<!doctype html><html lang="ko"><head><title>가짜 짧은 쪽</title><meta property="og:title" content="가짜 짧은 쪽"><meta property="og:description" content="가짜 메타 설명 한 줄"></head>
<body><div id="app"></div></body></html>`;
// 숨은 로그인 창(비밀번호 칸)이 든 보통 기사: 본문이 뽑히면 로그인 화면이 아니다.
const ARTICLE_WITH_LOGIN_BOX = `<!doctype html><html lang="ko"><head><title>가짜 보통 기사</title><meta property="og:title" content="가짜 보통 기사"></head>
<body><div class="layer" hidden><p>로그인이 필요합니다</p><input type="password"></div><article><p>${LONG}</p><p>${LONG}</p></article><div class="cmt">댓글은 로그인 후 이용</div></body></html>`;

test('실패 까닭 판정', () => {
  // 로그인 화면 → login. 제목·사이트·본문을 돌려주지 않고, 화면도 로그인 화면 제목을 글 제목으로 쓰지 않는다.
  for (const got of [html('https://app.example.org/login?next=%2Fa%2F1', LOGIN_HTML), html('https://board.example.org/post/7', LOGIN_SAME_URL)]) {
    const r = H.buildResult(got, NOW);
    assert.equal(r.state, 'failed');
    assert.equal(r.reason, 'login');
    assert.equal(r.title, null);
    assert.equal(r.site, null);
    assert.deepEqual(r.blocks, []);
    const patch = bodyPatch(r, 'T');
    assert.deepEqual(patch, {body: null, body_state: 'login', body_at: 'T'});
    assert.equal(stateLine(patch), '가져오지 못했어요. 로그인이 필요한 페이지예요.');
  }
  assert.equal(H.buildResult(html('https://app.example.org/auth/login', LOGIN_HTML), NOW).reason, 'login');

  // 유료벽 → paywall(공개 리드만, '유료 기사라 앞부분만').
  const pay = H.buildResult(html('https://news.example.org/a/1', PAYWALL_HTML), NOW);
  assert.equal(pay.state, 'lead');
  assert.equal(pay.reason, 'paywall');
  const payPatch = bodyPatch(pay, 'T');
  assert.equal(payPatch.body_state, 'paywall');
  assert.equal(stateLine(payPatch), '유료 기사라 앞부분만 있어요.');

  // 메타 설명만 → lead(유료라고 부르지 않음).
  const lead = H.buildResult(html('https://news.example.org/a/2', LEAD_HTML), NOW);
  assert.equal(lead.state, 'lead');
  assert.equal(lead.reason, 'lead_only');
  const leadPatch = bodyPatch(lead, 'T');
  assert.equal(leadPatch.body_state, 'lead');
  assert.equal(leadPatch.title, '가짜 짧은 쪽');
  assert.doesNotMatch(stateLine(leadPatch), /유료/);
  assert.equal(stateLine(leadPatch), '본문을 찾지 못해 소개 글만 있어요.');

  // 숨은 로그인 창이 든 보통 기사는 그대로 ok.
  const art = H.buildResult(html('https://news.example.org/a/3', ARTICLE_WITH_LOGIN_BOX), NOW);
  assert.equal(art.state, 'ok');
  assert.equal(bodyPatch(art, 'T').body_state, 'ok');

  // 401·403 → bot_check, 시간 초과 → timeout(공용 읽기 실패 코드 → 까닭).
  const guard = G.newGuardState();
  assert.equal(H.failReason('http_401', guard, false), 'bot_check');
  assert.equal(H.failReason('http_403', guard, false), 'bot_check');
  assert.equal(H.failReason('timeout', guard, false), 'timeout');
  assert.equal(H.failReason('', guard, true), 'timeout');
  assert.match(stateLine(bodyPatch({ok: true, state: 'failed', reason: 'bot_check'}, 'T')), /읽기를 막아/);
});
