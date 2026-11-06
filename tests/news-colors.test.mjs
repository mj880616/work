import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FAMILIES, SHADES, colorVar, outsideColor, newsColor, postTag, newsTag, tagLabel, tagStyle, shadeOf} from '../app/news-colors.mjs';
import {rowHtml, dayHtml} from '../app/news-row.mjs';
// S51-8 NEWS-전면개편 P4b: News 목록 색·꼬리표는 news-colors.mjs 하나, 값은 theme-tokens.css 토큰(밝은·어두운 화면 둘 다).
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const css = readFileSync(new URL('../app/theme-tokens.css', import.meta.url), 'utf8');

test('매체 색 토큰은 묶음 다섯 × 넷, 꼬리표 넷 × (바탕·글자)가 밝은·어두운 화면에 모두 있다', () => {
  const dark = css.slice(css.indexOf('@media (prefers-color-scheme:dark)'));
  const light = css.slice(0, css.indexOf('@media (prefers-color-scheme:dark)'));
  for (const f of FAMILIES) for (let i = 1; i <= SHADES; i++) for (const part of [light, dark]) assert.match(part, new RegExp(`--ds-news-${f}-${i}:#[0-9a-f]{6};`), `${f}-${i}`);
  for (const t of ['labor', 'politics', 'intl', 'statement']) for (const k of ['soft', 'ink']) for (const part of [light, dark]) assert.match(part, new RegExp(`--ds-news-tag-${t}-${k}:#[0-9a-f]{6};`));
});

test('색 고르기: 같은 묶음 안 순서로 돌아가며, 카탈로그에 없으면 이름으로 늘 같은 칸', () => {
  const cat = [{key: 'kctu', group: 'labor'}, {key: 'laborparty', group: 'party'}, {key: 'kptu', group: 'labor'}];
  assert.equal(outsideColor('kctu', cat), 'var(--ds-news-labor-1)');
  assert.equal(outsideColor('kptu', cat), 'var(--ds-news-labor-2)');
  assert.equal(outsideColor('laborparty', cat), 'var(--ds-news-party-1)');
  assert.match(outsideColor('unknown', cat), /^var\(--ds-news-movement-[1-4]\)$/);
  assert.equal(newsColor({source_key: 'news-b'}, [{key: 'news-a'}, {key: 'news-b'}]), 'var(--ds-news-press-2)');
  assert.equal(newsColor({publisher: '가상일보'}), newsColor({publisher: '가상일보'}));
  assert.equal(colorVar('nope', 5), 'var(--ds-news-press-2)');
  assert.ok(shadeOf('x') >= 0 && shadeOf('x') < SHADES);
});

test('분류 꼬리표: 성명(성명·논평·보도자료) > 국제(외국 글) > topic 노동·정치, 나머지는 없음', () => {
  for (const kind of ['statement', 'comment', 'press']) assert.equal(postTag({kind, lang: 'ko'}), 'statement');
  assert.equal(postTag({kind: 'article', lang: 'en'}), 'intl');
  assert.equal(postTag({kind: 'article', lang: 'ko'}), '');
  assert.equal(postTag({kind: 'article', lang: 'ko', topic: '노동'}), 'labor');
  assert.equal(newsTag({lang: 'en'}), 'intl');
  assert.equal(newsTag({lang: 'ko'}), '');
  assert.equal(newsTag({lang: 'ko', topic: '정치'}), 'politics');
  assert.equal(newsTag({lang: 'ko', topic: '경제'}), '');
  assert.equal(tagLabel('statement'), '성명');
  assert.equal(tagStyle('intl'), '--nw-tag-bg:var(--ds-news-tag-intl-soft);--nw-tag-ink:var(--ds-news-tag-intl-ink)');
  assert.equal(tagStyle('bogus'), '');
});

test('줄 글자: 바깥 글자는 esc, 읽음·안 읽음·모름, 별표, 색 띠', () => {
  const base = {key: 'news:1', openAttr: 'data-nc-open', openId: '1', title: '<b>제목</b>', src: '가상일보', color: 'var(--ds-news-press-1)', tag: 'intl', time: '09:12', star: true};
  const unread = rowHtml({...base, read: false}, esc);
  assert.match(unread, /class="nw-row now-row is-new"/);
  assert.match(unread, /&lt;b&gt;제목&lt;\/b&gt;/);
  assert.doesNotMatch(unread, /<b>제목/);
  assert.match(unread, /style="--nw-c:var\(--ds-news-press-1\)"/);
  assert.match(unread, /nw-star/);
  assert.match(unread, />국제</);
  assert.match(rowHtml({...base, read: true}, esc), /is-read/);
  assert.doesNotMatch(rowHtml({...base, read: null, star: false, tag: ''}, esc), /is-read|is-new|nw-star|nw-tag/);
  assert.match(rowHtml({...base, badge: '공대위'}, esc), /nw-src">가상일보<\/span><span class="nw-badge">공대위<\/span>/);
  assert.match(rowHtml({...base, hit: '<철도>'}, esc), /<span class="now-hit">&lt;철도&gt;<\/span>/);
  assert.match(dayHtml('오늘', '', 6, esc), /오늘 · 새 글 6/);
  assert.doesNotMatch(dayHtml('어제', '', 0, esc), /새 글/);
});
