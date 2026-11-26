// S71-68 READ-본문뽑기(사용자 결정 2026-11-26): 원문 가져오기가 그 기사 본문만 담는지.
// - 사례 1(예시 매체 1 모양): 제목 뒤 메뉴·구독·후원·읽기 설정(글꼴·글자 크기·줄간격) 줄이 본문 앞에 줄줄이 → 본문 문단부터만.
// - 사례 2(예시 매체 2 모양): 첫 <article>이 '많이 본 기사' 제목 링크 목록 → 그 목록이 아니라 기사 문단.
// - 끝내 본문을 못 찾으면 엉뚱한 글 대신 본문 없음(no_body).
// - 다른 모양(첫 문단이 짧은 글·□ 안내 줄·영어 기사·단체 본문 칸·구조화 본문)은 그대로.
// 네트워크 없음. 견본 HTML은 모두 지어낸 글·example 주소다(실제 매체 이름·기사 없음).
import test from 'node:test';
import assert from 'node:assert/strict';

const E = await import('../../supabase/functions/_shared/feed-extract.ts');
const NP = await import('../../supabase/functions/news-feed/page.ts');
const NH = await import('../../supabase/functions/news-feed/handler.ts');
const OH = await import('../../supabase/functions/outside-feed/handler.ts');
const NI = await import('../../supabase/functions/note-import/handler.ts');
const OC = await import('../../supabase/functions/_shared/outside-catalog.ts');
const NC = await import('../../supabase/functions/_shared/news-catalog.ts');

const NOW = Date.parse('2026-11-26T13:00:00Z');
const URL1 = 'https://www.example.org/news/1';
const P = n => `가상 도시의 부동산 세금 이야기 ${n}번째 문단이다. 가상 정부가 내년부터 보유세 기준을 바꾸면서 집주인과 세입자가 받는 영향을 길게 따져 본다.`;
const PS = (a, b) => Array.from({length: b - a + 1}, (_, i) => `<p>${P(a + i)}</p>`).join('\n');
const JUNK = ['아침에 읽는 가상 신문', '구독', '정기구독', '후원', '스마트폰 앱', '종이 신문 구입처', '999호', '입력 2026.11.26 09:00', '가상기자', '읽기 설정', '×', '글꼴', '돋움체', '바탕체', '글자 크기', '기본값으로', '10px', '19px', '30px', '줄간격'];
const JUNK_RE = /아침에 읽는|정기구독|후원|스마트폰 앱|종이 신문 구입처|999호|읽기 설정|돋움체|바탕체|글자 크기|기본값으로|19px|줄간격/;
const TITLE1 = '가상 정부, 부동산 보유세 기준 바꾼다';

// 사례 1 모양: 머리(메뉴는 nav가 아닌 div) + <article> 안 제목 → 덧줄 20줄 → 본문.
const case1 = `<!doctype html><html lang="ko"><head><title>${TITLE1}</title><meta property="og:title" content="${TITLE1}"></head><body>
<div class="topbar"><a href="/">처음</a></div>
<article class="post">
<h1 class="entry-title">${TITLE1}</h1>
${JUNK.map(j => `<div class="tool">${j}</div>`).join('\n')}
<div class="text">${PS(1, 5)}</div>
</article></body></html>`;

// 사례 2 모양: 옆 칸 '많이 본 기사'(<article> 안 짧은 제목 링크 12개)가 본문 칸보다 앞, 본문 칸 이름은 흔한 이름이 아님.
const TITLE2 = '가상 집값 오르자 부동산 세금 부담 커져';
const popular = Array.from({length: 12}, (_, i) => `<li><a href="/news/${100 + i}">가상 다른 기사 제목 ${i + 1}번 줄</a></li>`).join('');
const case2 = `<!doctype html><html lang="ko"><head><title>${TITLE2}</title></head><body>
<div class="wrap"><article class="ranking"><h3>많이 본 기사</h3><ul>${popular}</ul></article>
<div class="news-headline"><h1>${TITLE2}</h1><span>입력 2026.11.26</span></div>
<div class="news-txt">${PS(1, 6)}</div>
</div></body></html>`;

const openRule = NI.pageRule(URL1);
const ext = (html, title, extra = {}) => E.extractBlocks({html, base: URL1, title, key: 'open', rule: {version: 1}, minChars: 200, ...extra});
const textOf = e => e.blocks.filter(b => b.t !== 'img').map(b => b.text);

test('사례 1: 본문 앞 메뉴·구독·후원·읽기 설정 줄은 빼고 본문 첫 문단부터(읽을 거리 가져오기 · 뉴스 열린 주소 규칙)', () => {
  const page = NP.readArticlePage(case1, NOW, openRule);
  assert.equal(page.blocks.state, 'ok');
  const lines = textOf(page.blocks);
  assert.match(lines[0], /1번째 문단/, '첫 줄이 본문 첫 문단');
  assert.ok(lines.at(-1).includes('5번째 문단'));
  assert.doesNotMatch(page.blocks.text, JUNK_RE);
  assert.doesNotMatch(page.body, JUNK_RE);
  assert.ok(page.blocks.trimmed >= 10);
});

test('사례 1: 사회운동 글 길(출처 규칙)도 같은 공용 추출기 — 덧줄 없이 본문만', () => {
  const src = OC.OUTSIDE_CATALOG.find(s => s.key === 'ws');
  const ex = OH.postBody(src, {url: URL1, title: TITLE1, kind: 'article', published_at: null, author: null, summary: null, content: null}, {ok: true, text: case1, url: URL1});
  assert.equal(ex.state, 'ok');
  assert.match(textOf(ex)[0], /1번째 문단/);
  assert.doesNotMatch(ex.text, JUNK_RE);
});

test('사례 2: 앞의 많이 본 기사 링크 목록이 아니라 그 기사 본문(긴 문단 칸)', () => {
  const page = NP.readArticlePage(case2, NOW, openRule);
  assert.equal(page.blocks.state, 'ok');
  assert.equal(page.body_kind, 'full');
  assert.doesNotMatch(page.blocks.text, /다른 기사 제목|많이 본 기사/);
  assert.ok(page.blocks.text.includes('1번째 문단') && page.blocks.text.includes('6번째 문단'));
  // 공용 추출기 숫자: 첫 칸은 링크 목록으로 판정, 고른 칸은 긴 문단 칸.
  const picked = ext(case2, TITLE2);
  assert.equal(picked.scope, 'dense');
  assert.equal(picked.issue, null);
});

test('본문을 끝내 못 찾으면(링크 목록뿐) 엉뚱한 글 대신 본문 없음 — 리드는 메타 설명만', () => {
  const only = `<html><head><title>${TITLE2}</title><meta name="description" content="가상 기사 소개 한 줄이다."></head><body><article class="ranking"><h3>많이 본 기사</h3><ul>${popular}</ul></article></body></html>`;
  const e = ext(only, TITLE2);
  assert.equal(e.state, 'failed');
  assert.equal(e.reason, 'no_body');
  assert.equal(e.issue, 'link_list');
  const page = NP.readArticlePage(only, NOW, openRule);
  assert.notEqual(page.blocks.state, 'ok');
  assert.doesNotMatch(JSON.stringify(page.blocks.blocks), /다른 기사 제목/);
  assert.doesNotMatch(page.body ?? '', /다른 기사 제목/);
});

test('본문 판정 함수: 링크 목록 · 제목과 다른 짧은 줄 · 제목 낱말', () => {
  const mk = lines => ({state: 'ok', reason: null, rule: null, blocks: lines.map(text => ({t: 'p', text})), chars: 0, images: 0, captions: 0, text: lines.join('\n')});
  const list = Array.from({length: 8}, (_, i) => `가상 다른 기사 ${i}`);
  assert.equal(E.bodyIssue(mk(list), '', {anchors: 8, ratio: 0.9}), 'link_list');
  assert.equal(E.bodyIssue(mk(list), '', {anchors: 0, ratio: 0}), null, '링크가 아니면(짧은 시·목록 글) 링크 목록이 아님');
  assert.equal(E.bodyIssue(mk([P(1), P(2)]), TITLE1), null);
  assert.equal(E.bodyIssue(mk(['완전히 다른 내용의 긴 글이 여기에 이어지고 문장이 길게 끝난다. 그리고 또 이어진다.']), '가상 정부 보유세 바꾼다'), 'off_title');
  assert.deepEqual(E.titleHit('가상 집값 오르자 부동산 세금 - 예시 매체', '부동산 세금이 오른다'), {words: 5, hits: 2});
});

test('회귀: 짧은 첫 문단 한 줄·□ 안내 줄·영어 기사·단체 본문 칸은 그대로', () => {
  // 짧은 첫 줄 하나는 둔다(덧줄 2줄 이상일 때만 뺌).
  const shortFirst = `<html><body><article><h1>${TITLE1}</h1><p>가상 보유세 이야기.</p>${PS(1, 3)}</article></body></html>`;
  assert.equal(textOf(ext(shortFirst, TITLE1))[0], '가상 보유세 이야기.');
  // □ 일시·장소 같은 안내 줄은 본문.
  const info = `<html><body><article><h1>${TITLE1}</h1><p>□ 일시: 2026년 11월 26일</p><p>□ 장소: 가상 광장</p><p>■ 가상 부동산 기자회견</p>${PS(1, 3)}</article></body></html>`;
  assert.deepEqual(textOf(ext(info, TITLE1)).slice(0, 3), ['□ 일시: 2026년 11월 26일', '□ 장소: 가상 광장', '■ 가상 부동산 기자회견']);
  // 영어 기사.
  const EN = n => `Invented paragraph ${n} about invented housing taxes rising in an invented city, with landlords and tenants arguing at length.`;
  const en = `<html lang="en"><body><article><h1>Invented housing taxes rise</h1>${[1, 2, 3, 4].map(n => `<p>${EN(n)}</p>`).join('')}</article></body></html>`;
  const ee = ext(en, 'Invented housing taxes rise');
  assert.equal(ee.state, 'ok'); assert.match(textOf(ee)[0], /paragraph 1/); assert.equal(ee.issue, null);
  // 단체 본문 칸(own)은 제목이 달라도(목록 제목) 그대로 두고 덧줄 빼기도 하지 않는다.
  const own = `<html><body><div id="bo_v_con"><p>가상 안내</p><p>가상 둘째 줄</p>${PS(1, 3)}</div></body></html>`;
  const eo = ext(own, '전혀 다른 목록 제목 낱말들', {body: /^bo_v_con$/});
  assert.equal(eo.state, 'ok'); assert.equal(eo.scope, 'own'); assert.equal(textOf(eo)[0], '가상 안내');
  // 매체 규칙 본문 칸(뉴스 카탈로그 첫 매체) — 그대로 own.
  const lt = NC.NEWS_CATALOG[0];
  const ndHtml = `<html><body><article id="article-view-content-div" itemprop="articleBody">${PS(1, 4)}</article></body></html>`;
  const lp = NP.readArticlePage(ndHtml, NOW, NH.mediaRule(lt, URL1));
  assert.equal(lp.blocks.state, 'ok'); assert.match(textOf(lp.blocks)[0], /1번째 문단/);
});
