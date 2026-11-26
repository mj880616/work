// S69-02(사용자 11/24 06:40·06:43): 조선일보처럼 본문이 페이지 안 구조화 자료(Arc)에만 있는 기사, 끝에 사이트 '더 보기' 링크 글자('전체 내용보기')가 붙은 기사.
// 읽을 거리(news-feed open)와 저장한 글(note-import — 주소로 저장한 글) 두 읽기 길이 같은 추출(news-feed/page.ts readArticlePage)을 쓰는지,
// 본문 전체(문단·소제목·사진)가 나오고 링크 글자가 본문 문단으로 들어가지 않는지 본다. 네트워크 없음 — 페이지·문장은 모두 지어냄(example 주소).
import test from 'node:test';
import assert from 'node:assert/strict';

const NP = await import('../../supabase/functions/news-feed/page.ts');
const NI = await import('../../supabase/functions/note-import/handler.ts');
const J = await import('../../supabase/functions/_shared/page-json-body.ts');
const T = await import('../../supabase/functions/_shared/outside-tidy.ts');
const E = await import('../../supabase/functions/_shared/feed-extract.ts');
const NOW = Date.parse('2026-11-24T00:00:00Z');
const P = n => `지어낸 기사 ${n}번째 문단이다. 지어낸 도시의 노동자들이 지어낸 일자리 이야기를 길게 나눈다. `.repeat(2).trim();

const arcPage = () => `<html lang="ko"><head><meta property="og:title" content="지어낸 Arc 기사"><meta property="og:site_name" content="지어낸일보">
<meta property="og:description" content="요약 같은 한 문단."></head><body><main><div class="article-body"></div></main>
<script id="fusion-metadata">window.Fusion=window.Fusion||{};Fusion.arcSite="x";Fusion.globalContent=${JSON.stringify({
  content_restrictions: {content_code: 'free'},
  content_elements: [
    {type: 'text', content: P(1)}, {type: 'header', content: '지어낸 소제목'},
    {type: 'image', url: 'https://img.example.org/a.jpg', caption: '<b>지어낸</b> 사진 설명', alt_text: '사진'},
    {type: 'image', url: 'http://img.example.org/http.jpg'}, {type: 'image', url: '/relative.jpg'},
    {type: 'text', content: P(2) + '<br>' + P(3)}, {type: 'list', items: [{type: 'text', content: '지어낸 목록 한 줄.'}]},
    {type: 'quote', content_elements: [{type: 'text', content: '지어낸 인용 한 줄.'}]},
    {type: 'text', content: '<a href="https://example.org/full">기사 더보기</a>'}]})};Fusion.globalContentConfig={"x":1};</script></body></html>`;

const morePage = () => `<html lang="ko"><head><meta property="og:title" content="지어낸 철도 기사"><meta property="og:description" content="지어낸 소개."></head>
<body><article><h1>지어낸 철도 기사</h1><p>${P(1)}</p><p>${P(2)}</p><p>${P(3)}</p><p><a href="https://example.org/view?id=1">전체 내용보기</a></p></article></body></html>`;

test('Arc 페이지: 본문 전체를 문단·소제목·사진·목록·인용 차례 그대로(https 사진만), 링크 글자 없이 — 리드(메타 설명)가 아니라 전문', () => {
  const info = NP.readArticlePage(arcPage(), NOW, {key: 'news-x', rule: {version: 1}, base: 'https://www.example.org/a/1/'});
  assert.equal(info.state, 'ok'); assert.equal(info.body_kind, 'full');
  assert.equal(info.blocks.state, 'ok'); assert.equal(info.blocks.scope, 'json_arc');
  const kinds = info.blocks.blocks.map(b => b.t);
  assert.deepEqual(kinds, ['p', 'h', 'img', 'p', 'p', 'p', 'quote']);
  const img = info.blocks.blocks[2];
  assert.equal(img.src, 'https://img.example.org/a.jpg'); assert.equal(img.cap, '지어낸 사진 설명');
  assert.ok(!JSON.stringify(info.blocks.blocks).includes('더보기'));
  assert.ok(!info.body.includes('요약 같은 한 문단'), '메타 설명이 아니라 본문');
  assert.ok(info.body.includes('3번째 문단'));
});

test('Arc 유료 표시(content_code premium 등)면 읽지 않는다(유료벽 넘지 않음)', () => {
  const paid = arcPage().replace('"content_code":"free"', '"content_code":"premium"');
  assert.equal(J.arcItems(paid), null);
  const info = NP.readArticlePage(paid, NOW, {key: 'news-x', rule: {version: 1}, base: 'https://www.example.org/a/1/'});
  assert.notEqual(info.body_kind, 'full');
});

test("본문 끝 '전체 내용보기' 링크 문단은 본문에서 빠진다(문단은 그대로 전부)", () => {
  const info = NP.readArticlePage(morePage(), NOW, {key: 'open', rule: {version: 1}, base: 'https://www.example.org/view?id=1'});
  assert.equal(info.state, 'ok'); assert.equal(info.body_kind, 'full');
  const texts = info.blocks.blocks.filter(b => b.t === 'p').map(b => b.text);
  assert.equal(texts.length, 3);
  assert.ok(!texts.some(t => /전체\s*내용보기/.test(t)));
});

test('저장한 글(note-import)도 같은 추출: Arc 전문·링크 글자 빠짐 — 두 읽기 길이 한 함수', () => {
  const a = NI.buildResult({text: arcPage(), url: 'https://www.example.org/a/1/', contentType: 'text/html; charset=utf-8'}, NOW);
  assert.equal(a.state, 'ok'); assert.equal(a.reason, null);
  assert.ok(a.blocks.some(b => b.t === 'h'));
  assert.ok(!JSON.stringify(a.blocks).includes('더보기'));
  const m = NI.buildResult({text: morePage(), url: 'https://www.example.org/view?id=1', contentType: 'text/html'}, NOW);
  assert.equal(m.state, 'ok');
  assert.ok(!JSON.stringify(m.blocks).includes('전체 내용보기'));
});

test("'더 보기' 링크 줄 판정·피드 글 끝 떼기: 홀로 선 링크 글자만, 문장 속 말은 그대로", () => {
  for (const s of ['전체 내용보기', '기사 더보기', '[전체기사 보기]', '▶ 기사 원문 보기', '더보기 >', 'Read more »', 'Continue reading…']) assert.equal(T.isMoreLink(s), true, s);
  for (const s of ['오늘 노동자들은 더 보기 힘든 상황이다', '전체 내용보기 전에 알아 둘 것은 이것이다', '']) assert.equal(T.isMoreLink(s), false, s);
  assert.deepEqual(T.dropMoreLinks('첫 문단\n둘째 문단\n전체 내용보기'), {text: '첫 문단\n둘째 문단', cut: true});
  assert.deepEqual(T.dropMoreLinks('첫 문단'), {text: '첫 문단', cut: false});
  const tb = E.textBlocks('첫 문단\n전체 내용보기', {key: 'k', rule: {version: 1}, minChars: 1, state: 'lead', reason: 'no_body'});
  assert.deepEqual(tb.blocks.map(b => b.text), ['첫 문단']);
});
