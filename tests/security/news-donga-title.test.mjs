// S70-17(NEWS-동아못읽음, 명진 11/25 10:15 "원인 찾고 해결"): 읽을 거리 맨 위 동아일보 기사가 '못 읽은 기사 · donga.com'.
// 동아일보 기사 쪽 구조를 본뜬 작은 가짜 HTML(글은 지어낸 문장, 실제 기사 복사 아님)로
//   ① 제목·매체·기사 시각 뽑기(page.ts readArticlePage · _shared/page-title.ts peekTitle)가 이 구조를 읽는지,
//   ② 못 읽었을 때 까닭 코드(늦은 답·막힘·리다이렉트 고리·봇 확인·제목 없음)가 로그 숫자로 남는지 본다. 네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';

const NP = await import('../../supabase/functions/news-feed/page.ts');
const PT = await import('../../supabase/functions/_shared/page-title.ts');
const FF = await import('../../supabase/functions/_shared/feed-fetch.ts');
const NOW = Date.parse('2026-11-25T02:00:00Z');
const URL0 = 'https://www.donga.com/news/Society/article/all/20261125/100000001/1';

// 동아일보 기사 쪽 머리 모양(메타 이름·순서만 본뜸): utf-8, <title> 끝 '｜동아일보', og:title·og:site_name, article:published_time(+09:00),
// 머리에 큰 스크립트, 본문 칸 section.news_view. 글은 모두 지어낸 것.
const P = n => `지어낸 기사 ${n}번째 문단이다. 지어낸 도시의 지어낸 사람들이 지어낸 일을 길게 이야기한다. `.repeat(2).trim();
const donga = ({ og = true, quote = '"' } = {}) => `<!DOCTYPE html>
<html lang="ko"><head>
<meta charset="utf-8">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>지어낸 제목 “따옴표”｜동아일보</title>
<script>window.dataLayer=window.dataLayer||[];${'var x=1;'.repeat(2000)}</script>
<meta name="description" content="지어낸 소개 한 줄.">
${og ? `<meta property=${quote}og:title${quote} content=${quote}지어낸 제목 “따옴표”${quote} />` : ''}
<meta property=${quote}og:type${quote} content=${quote}article${quote} />
<meta property=${quote}og:url${quote} content=${quote}${URL0}${quote} />
<meta property=${quote}og:site_name${quote} content=${quote}동아일보${quote} />
<meta property=${quote}article:published_time${quote} content=${quote}2026-11-25T10:13:00+09:00${quote} />
</head><body>
<header><nav>지어낸 메뉴</nav></header>
<main><section class="news_view">${[1, 2, 3, 4].map(n => `${P(n)}<br><br>`).join('')}</section></main>
<footer>지어낸 꼬리</footer></body></html>`;

test('동아일보 기사 쪽 구조: 제목·매체·기사 시각을 뽑는다(큰따옴표·작은따옴표 메타 모두)', () => {
  for (const quote of ['"', "'"]) {
    const info = NP.readArticlePage(donga({ quote }), NOW);
    assert.equal(info.state, 'ok');
    assert.equal(info.title, '지어낸 제목 “따옴표”');
    assert.equal(info.publisher, '동아일보');
    assert.equal(info.published_at, '2026-11-25T01:13:00.000Z');
  }
  // og:title이 없어도 <title>로(꼬리 '｜동아일보'는 화면 제목 다듬기가 따로 본다).
  assert.match(NP.readArticlePage(donga({ og: false }), NOW).title, /^지어낸 제목/);
});

const fakeReader = (got) => ({ get: async () => got });

test('가볍게 제목만 읽기(peekTitle): 동아일보 구조에서 제목·매체 이름', async () => {
  const peek = await PT.peekTitle(fakeReader({ ok: true, text: donga(), url: URL0, contentType: 'text/html; charset=UTF-8' }), URL0);
  assert.deepEqual(peek, { title: '지어낸 제목 “따옴표”', publisher: '동아일보' });
});

test('못 읽은 까닭 코드(peekTitleWhy): 읽기 실패 코드·봇 확인·제목 없음을 가르고, 코드 모양이 아니면 other', async () => {
  const why = async (got) => (await PT.peekTitleWhy(fakeReader(got), URL0)).why;
  assert.equal(await why({ ok: true, text: donga(), url: URL0, contentType: null }), 'ok');
  for (const code of ['timeout', 'network', 'http_403', 'redirect_loop', 'redirect_outside', 'too_large']) assert.equal(await why({ ok: false, code }), code);
  assert.equal(await why({ ok: false, code: 'https://www.donga.com/x' }), 'other');
  assert.equal(await why({ ok: true, text: '<html><head><title>Just a moment...</title></head></html>', url: URL0, contentType: null }), 'bot_check');
  assert.equal(await why({ ok: true, text: '<html><head></head><body>글</body></html>', url: URL0, contentType: null }), 'no_title');
  const counts = {};
  PT.countWhy(counts, 'timeout'); PT.countWhy(counts, 'timeout'); PT.countWhy(counts, 'http_403');
  assert.deepEqual(counts, { timeout: 2, http_403: 1 });
});

test('공용 읽기: 쿠키 없이 같은 주소로 되돌리는 리다이렉트는 redirect_loop(우회하지 않음)로 끝나고 까닭 코드로 남는다', async () => {
  let calls = 0;
  const doFetch = async () => { calls++; return new Response(null, { status: 302, headers: { location: URL0, 'set-cookie': 'k=v' } }); };
  const reader = FF.makeFeedReader({ doFetch, sleep: async () => {}, log: () => {}, userAgent: 'T', robotsAgent: 'T', gapMs: 0, allow: FF.openArticleUrl, skipRobots: true });
  const r = await PT.peekTitleWhy(reader, URL0);
  assert.equal(r.peek, null);
  assert.equal(r.why, 'redirect_loop');
  assert.equal(calls, FF.MAX_REDIRECTS + 1);
});
