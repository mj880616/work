// S69-06(사용자 11/24 06:40·07:38 "원문 제대로 못 불러오는 곳을 다 고쳐야 돼"): 실제 사이트 점검(article-extract-live-check)에서 찾은 원인마다,
// 그 사이트 쪽 구조를 본뜬 작은 가짜 HTML(글은 지어낸 문장, example 주소)로 고친 동작을 본다. 네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const NP = await import('../../supabase/functions/news-feed/page.ts');
const NH = await import('../../supabase/functions/news-feed/handler.ts');
const OH = await import('../../supabase/functions/outside-feed/handler.ts');
const PARSE = await import('../../supabase/functions/outside-feed/parse.ts');
const NC = await import('../../supabase/functions/_shared/news-catalog.ts');
const OC = await import('../../supabase/functions/_shared/outside-catalog.ts');
const NOW = Date.parse('2026-11-24T00:00:00Z');
const P = n => `지어낸 기사 ${n}번째 문단이다. 지어낸 도시의 노동자들이 지어낸 일자리 이야기를 길게 나눈다. `.repeat(2).trim();
const PS = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => `<p>${P(a + i)}</p>`).join('');
const news = key => NC.NEWS_CATALOG.find(s => s.key === key);
const outside = key => OC.OUTSIDE_CATALOG.find(s => s.key === key);
const readNews = (key, html) => NP.readArticlePage(html, NOW, NH.mediaRule(news(key), 'https://www.example.org/a/1'));
const item = { url: 'https://www.example.org/a/1', title: '지어낸 제목', kind: 'article', published_at: null, author: null, summary: null, content: null };
const readOutside = (key, html) => OH.postBody(outside(key), item, { ok: true, text: html, url: 'https://www.example.org/a/1' });

test('봇 확인 판정: Cloudflare가 보통 쪽에 넣는 측정 스크립트(challenge-platform/scripts/jsd)는 확인 쪽이 아니다 — 진짜 확인 쪽 표시는 그대로', () => {
  const beacon = `<html><body><article>${PS(1, 3)}</article><script>(function(){var a=document.createElement('script');a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';})();</script></body></html>`;
  assert.equal(PARSE.looksLikeBotCheck(beacon), false);
  for (const real of [
    '<html><head><title>Just a moment...</title></head><body></body></html>',
    '<html><body><script>window._cf_chl_opt={cType:"managed"};</script></body></html>',
    '<html><body><div id="cf-chl-widget"></div></body></html>',
    '<html><body><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></body></html>',
    '<html><body><script src="/aes.js"></script>slowAES</body></html>',
  ]) assert.equal(PARSE.looksLikeBotCheck(real), true, real.slice(0, 60));
});

test('노동자연대(ws): 측정 스크립트가 있는 글 쪽도 본문을 뽑고, 태그 본문보다 긴 공개 JSON-LD articleBody가 있으면 그것(공용 판정)', () => {
  const ld = { '@context': 'https://schema.org', '@type': 'NewsArticle', headline: '지어낸 제목', articleBody: [1, 2, 3, 4, 5, 6, 7, 8].map(P).join('\n') };
  const html = `<html lang="ko"><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body>
<main><article id="vue-article"><div class="js-content"><p>${P(1)}</p><p>${P(2)}</p></div></article></main>
<script>var s=document.createElement('script');s.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';</script></body></html>`;
  const ex = readOutside('ws', html);
  assert.equal(ex.state, 'ok');
  assert.equal(ex.scope, 'json_ld');
  assert.ok(ex.text.includes('8번째 문단'));
  assert.equal(ex.rule, 'ws@2');
  // 공개가 아니라고 밝힌 객체(isAccessibleForFree=false)는 읽지 않고 태그 본문 그대로.
  const paid = html.replace('"headline"', '"isAccessibleForFree":false,"headline"');
  const ex2 = readOutside('ws', paid);
  assert.notEqual(ex2.scope, 'json_ld');
  assert.ok(!ex2.text.includes('8번째 문단'));
});

// 엔디소프트 기사 쪽: 머리 칸이 짧은 <article>로 먼저 나오고 본문은 뒤 <article id="article-view-content-div">.
const ndsoft = () => `<html lang="ko"><head><meta property="og:title" content="지어낸 제목"><meta property="og:description" content="지어낸 소개 한 줄."></head><body>
<div id="user-wrap"><header><nav>지어낸 메뉴</nav></header>
<article class="grid header"><h3 class="heading">지어낸 제목</h3><ul class="infomation"><li>기자명 지어낸 기자</li><li>입력 2026.11.24 07:00</li><li>지어낸 머리 줄 하나가 길게 이어져 백 자를 넘긴다. 지어낸 머리 줄 하나가 길게 이어져 백 자를 넘긴다. 지어낸 머리 줄이다.</li></ul></article>
<div class="article-body"><article id="article-view-content-div" class="article-veiw-body view-page">${PS(1, 6)}</article></div>
<footer>지어낸 꼬리</footer></div></body></html>`;
for (const key of ['news-sisain', 'news-laborplus', 'news-redian']) {
  test(`${key}: 본문 칸 #article-view-content-div를 고정해 앞의 짧은 머리 <article>에서 멈추지 않고 전문`, () => {
    assert.match(String(news(key).bodyClass), /article-view-content-div/);
    const info = readNews(key, ndsoft());
    assert.equal(info.body_kind, 'full');
    assert.equal(info.blocks.scope, 'own');
    assert.ok(info.body.includes('6번째 문단') && info.body.includes('1번째 문단'));
    assert.ok(!info.body.includes('지어낸 머리 줄'));
  });
}

test('연합뉴스: 본문 칸 div.story-news(앞의 사진·머리 <article> 대신)', () => {
  const html = `<html lang="ko"><head><meta property="og:title" content="지어낸 제목"></head><body>
<article class="article-img"><figure><img src="https://img.example.org/p.jpg"><figcaption>지어낸 사진 설명 줄이 길게 이어져 백 자를 넘긴다. 지어낸 사진 설명 줄이 길게 이어져 백 자를 넘긴다. 지어낸 설명.</figcaption></figure></article>
<div class="story-news article">${PS(1, 5)}</div><div class="related">지어낸 관련 기사</div></body></html>`;
  const info = readNews('news-yna', html);
  assert.equal(info.body_kind, 'full'); assert.equal(info.blocks.scope, 'own');
  assert.ok(info.body.includes('5번째 문단')); assert.ok(!info.body.includes('관련 기사'));
});

test('서울경제: 본문 칸 #article-body(흔한 본문 칸 article-content의 머리·요약 줄에서 멈추지 않음)', () => {
  const html = `<html lang="ko"><head><meta property="og:title" content="지어낸 제목"></head><body><main class="view-page"><div class="article-content">
<div class="article-summary">지어낸 요약 줄이다.</div><div class="comment-cnt">댓글 0</div>
<div id="article-body" class="view">${PS(1, 5)}</div></div></main></body></html>`;
  const info = readNews('news-sedaily', html);
  assert.equal(info.body_kind, 'full');
  assert.ok(info.body.includes('1번째 문단') && info.body.includes('5번째 문단'));
});

test('Labor Notes(@2): 글 쪽 본문 칸 field-name-body — [원문 다시 가져오기]가 피드 본문만큼 길게', () => {
  const EN = n => `Invented paragraph number ${n} about invented workers organizing an invented union drive in an invented town. `.repeat(3).trim();
  const html = `<html lang="en"><body><div class="content"><div class="field field-name-field-teaser">An invented teaser line that is short.</div>
<div class="share">Share this</div>
<div class="field field-name-body field-type-text-with-summary"><div class="field-items"><div class="field-item even">${[1, 2, 3, 4, 5, 6].map(n => `<p>${EN(n)}</p>`).join('')}</div></div></div></div></body></html>`;
  const ex = readOutside('labornotes', html);
  assert.equal(ex.state, 'ok'); assert.equal(ex.scope, 'own'); assert.equal(ex.rule, 'labornotes@2');
  assert.ok(ex.text.includes('number 6'));
});

test('사회진보연대(@2): 글 본문 칸 #post-content-board — 문단이 <br>로만 나뉜 글도 끝까지', () => {
  const lines = [1, 2, 3, 4, 5, 6].map(P).join('<br><br>');
  const html = `<html lang="ko"><body><section id="leftcol"><div id="post-board" class="post"><div class="post-title">지어낸 제목</div>
<div class="post-info">2026-11-24</div><div id="post-content-board" class="post-content">${lines}</div><div class="post-list">목록</div></div></section></body></html>`;
  const ex = readOutside('pssp', html);
  assert.equal(ex.state, 'ok'); assert.equal(ex.scope, 'own'); assert.equal(ex.rule, 'pssp@2');
  assert.ok(ex.text.includes('6번째 문단'));
});

test('점검 장치: 비밀값·DB 없이 읽기만, 글 내용 대신 숫자·코드, 운영과 같은 추출 함수를 부른다', () => {
  const wf = readFileSync(new URL('../../.github/workflows/article-extract-live-check.yml', import.meta.url), 'utf8');
  assert.match(wf, /permissions:\s*\n\s*contents: read/);
  assert.ok(!/secrets\./.test(wf), '비밀값 없음');
  assert.match(wf, /pull_request:/); assert.match(wf, /workflow_dispatch:/);
  const sc = readFileSync(new URL('../../scripts/ops/article-extract-live-check.mjs', import.meta.url), 'utf8');
  assert.match(sc, /readArticlePage\(got\.text, nowMs, N\.mediaRule\(source, got\.url\)\)/);
  assert.match(sc, /O\.postBody\(source, pageIt, got\)/);
  assert.ok(!/SUPABASE_|service_role|Authorization|apikey/i.test(sc.replace(/^\s*\/\/.*$/gm, '')));
  assert.ok(!/\.text\.slice\(|ex\.text\b.*console|it\.title.*console/.test(sc), '글자·제목을 찍지 않음');
});

test('공용 본문 칸: 매체가 밝힌 itemprop="articleBody" 칸을 <article>·댓글 줄보다 먼저(매일경제·한국경제 모양), 그 칸이 비면 예전 차례', () => {
  const mk = `<html lang="ko"><head><meta property="og:title" content="지어낸 제목"><meta property="og:description" content="짧은 소개"></head><body>
<section class="viewpage"><div class="grid-3col"><div class="news_title">지어낸 제목</div><div class="cmt">댓글</div>
<div class="news_cnt_detail_wrap" itemprop="articleBody">${[1, 2, 3, 4, 5].map(P).join('<br><br>')}</div></div></section></body></html>`;
  for (const key of ['news-mk', 'news-hankyung']) {
    const info = readNews(key, mk);
    assert.equal(info.body_kind, 'full', key); assert.equal(info.blocks.scope, 'itemprop', key);
    assert.ok(info.body.includes('5번째 문단'));
  }
  const empty = `<html><body><div itemprop="articleBody"></div><article>${PS(1, 4)}</article></body></html>`;
  const info = readNews('news-mk', empty);
  assert.equal(info.body_kind, 'full'); assert.equal(info.blocks.scope, 'article');
});

test('사진 저작권 줄: 본문 칸 안 본문 앞의 짧은 ⓒ 줄·ⓒ로 시작하는 사진 캡션은 본문 끝이 아니다(시사IN 모양) — 본문 뒤 ⓒ 줄은 예전처럼 끝', () => {
  const html = `<html lang="ko"><head><meta property="og:title" content="지어낸 제목"></head><body><article id="article-view-content-div">
<figure><img src="https://img.example.org/p.jpg"><figcaption>ⓒ지어낸매체 지어낸 기자</figcaption></figure><p>ⓒ지어낸매체 지어낸 기자</p>
${PS(1, 4)}<p>ⓒ 지어낸매체 무단전재 및 재배포 금지</p><p>지어낸 꼬리 줄이 본문으로 들어오면 안 된다.</p></article></body></html>`;
  const info = readNews('news-sisain', html);
  assert.equal(info.body_kind, 'full');
  assert.ok(info.body.includes('4번째 문단'));
  assert.ok(!info.body.includes('꼬리 줄'));
  const img = info.blocks.blocks.find(b => b.t === 'img');
  assert.equal(img.cap, 'ⓒ지어낸매체 지어낸 기자');
});

test('Next.js 페이지 자료(RSC): 본문 칸이 "$번호" 참조면 그 글자 조각을 바이트 수대로 읽는다(JTBC 모양), 화면 스크립트 없이 전문', () => {
  const body = `<p>${P(1)}</p><p>${P(2)}</p><p>${P(3)}</p>`;
  const bytes = new TextEncoder().encode(body).length.toString(16);
  const push = s => `<script>self.__next_f.push([1,${JSON.stringify(s)}])</script>`;
  const html = `<html lang="ko"><head><meta property="og:title" content="지어낸 제목"><meta property="og:description" content="짧은 소개"></head><body><div id="app"></div>
<script>(self.__next_f=self.__next_f||[]).push([0])</script>${push(`1:["$","div",null,{}]\n2a:T${bytes},${body}`)}${push('5:{"article":{"articleTitle":"지어낸","articleContent":"$2a"},"related":[{"articleContent":"짧은 관련"}]}\n')}</body></html>`;
  const info = readNews('news-jtbc', html);
  assert.equal(info.body_kind, 'full'); assert.equal(info.blocks.scope, 'json_next');
  assert.ok(info.body.includes('3번째 문단')); assert.ok(!info.body.includes('짧은 관련'));
  assert.ok(!info.body.includes('<p>'));
});
