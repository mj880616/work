import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FIXED_OUTSIDE, FIXED_NEWS, FAMILIES, SHADES, colorVar, outsideColor, outsideBar, newsColor, newsBar, postTag, newsTag, tagLabel, tagStyle, shadeOf} from '../app/news-colors.mjs';
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

test('색 고르기: 표에 없는 키는 같은 묶음 안 순서로 돌아가며, 카탈로그에 없으면 이름으로 늘 같은 칸', () => {
  const cat = [{key: 'x-first', group: 'labor'}, {key: 'x-otherparty', group: 'party'}, {key: 'x-union', group: 'labor'}];
  assert.equal(outsideColor('x-first', cat), 'var(--ds-news-labor-1)');
  assert.equal(outsideColor('x-union', cat), 'var(--ds-news-labor-2)');
  assert.equal(outsideColor('x-otherparty', cat), 'var(--ds-news-party-1)');
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

// NEWS-정당색 → NEWS-고유색: 키별 고정 색 표(정당 4곳·금속노조·공공운수노조). 이름 글자·막대 토큰 두 개, 나머지 색은 그대로.
const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const darkPart = css.slice(css.indexOf('@media (prefers-color-scheme:dark)'));
const lightPart = css.slice(0, css.indexOf('@media (prefers-color-scheme:dark)'));
const tok = (part, name) => part.match(new RegExp(`--${name}:([^;]+);`))?.[1];

const catalogKeys = file => [...readFileSync(new URL(`../supabase/functions/_shared/${file}`, import.meta.url), 'utf8').matchAll(/^\s*\{?\s*key: "([a-z-]+)"/gm)].map(m => m[1]);

test('고정 색 표: 키마다 이름 글자·막대 토큰, 표에 없는 매체와 돌려쓰기 칸은 그대로', () => {
  assert.deepEqual([...FIXED_OUTSIDE].slice(0, 6), ['justice', 'kgreens', 'laborparty', 'jinboparty', 'kmwu', 'kptu']);
  assert.equal(new Set([...FIXED_OUTSIDE, ...FIXED_NEWS]).size, FIXED_OUTSIDE.length + FIXED_NEWS.length, '키가 겹치지 않음');
  const cat = [{key: 'x-union', group: 'labor'}, {key: 'kptu', group: 'labor'}, {key: 'kmwu', group: 'labor'}, {key: 'x-union2', group: 'labor'}, {key: 'x-party', group: 'party'}, {key: 'justice', group: 'party'}];
  for (const k of FIXED_OUTSIDE) {
    assert.equal(outsideColor(k, cat), `var(--ds-news-id-${k})`);
    assert.equal(outsideBar(k, cat), `var(--ds-news-id-${k}-bar)`);
  }
  for (const k of FIXED_NEWS) {
    assert.equal(newsColor({source_key: k}, []), `var(--ds-news-id-${k})`);
    assert.equal(newsBar({source_key: k}, []), `var(--ds-news-id-${k}-bar)`);
  }
  // 고정 키도 순서 셈에 남아 다른 매체 칸이 밀리지 않는다(x-union2는 노동 묶음 넷째 칸 그대로).
  assert.equal(outsideColor('x-union', cat), 'var(--ds-news-labor-1)');
  assert.equal(outsideColor('x-union2', cat), 'var(--ds-news-labor-4)');
  assert.equal(outsideBar('x-union2', cat), outsideColor('x-union2', cat));
  assert.equal(outsideColor('x-party', cat), 'var(--ds-news-party-1)');
  assert.equal(newsBar({source_key: 'news-b'}, [{key: 'news-a'}, {key: 'news-b'}]), 'var(--ds-news-press-2)');
  // 카탈로그에 없는 매체(키워드로 찾은 기사의 매체 이름, 구글 뉴스 길)는 지금 규칙 그대로: 매체 이름으로 칸 고르기.
  assert.equal(newsColor({source_key: 'news-google', publisher: '가상일보'}, []), newsColor({publisher: '가상일보'}));
  assert.match(newsColor({source_key: 'news-google', publisher: '가상일보'}, []), /^var\(--ds-news-press-[1-4]\)$/);
});

test('고정 색 표의 키는 모두 지금 카탈로그에 있다(이름이 바뀌거나 빠진 키가 표에 남지 않음)', () => {
  const outside = catalogKeys('outside-catalog.ts'), news = catalogKeys('news-catalog.ts');
  assert.ok(outside.length >= 19 && news.length >= 23, `카탈로그 키를 못 읽음 ${outside.length}·${news.length}`);
  for (const k of FIXED_OUTSIDE) assert.ok(outside.includes(k), `단체 카탈로그에 없음: ${k}`);
  for (const k of FIXED_NEWS) assert.ok(news.includes(k), `언론 카탈로그에 없음: ${k}`);
});

test('고정 색 토큰: 밝은·어두운 화면 모두 있고, 이름 글자는 바탕 대비 4.5:1 이상, 막대는 한 색 또는 여러 색 띠', () => {
  for (const k of [...FIXED_OUTSIDE, ...FIXED_NEWS]) {
    for (const [part, bg] of [[lightPart, '#ffffff'], [darkPart, '#1f1f1b']]) {
      const ink = tok(part, `ds-news-id-${k}`);
      const bar = tok(part, `ds-news-id-${k}-bar`);
      assert.match(ink || '', /^#[0-9a-f]{6}$/, `${k} 글자`);
      assert.ok(ratio(ink, bg) >= 4.5, `${k} 글자 대비 ${ratio(ink, bg)} (${bg})`);
      assert.match(bar || '', /^(#[0-9a-f]{6}|linear-gradient\((#[0-9a-f]{6} [0-9. %]+,?)+\))$/, `${k} 막대`);
    }
  }
  // 명진 지정: 정의당 막대 샛노랑, 공공운수노조 막대 네이비·회색·빨강 3색(이름 글자 네이비), 금속노조 네이비.
  assert.equal(tok(lightPart, 'ds-news-id-justice-bar'), '#ffcc00');
  assert.equal((tok(lightPart, 'ds-news-id-kptu-bar').match(/#[0-9a-f]{6}/g) || []).length, 3);
  assert.equal(tok(lightPart, 'ds-news-id-kptu'), tok(lightPart, 'ds-news-id-kmwu'));
  assert.doesNotMatch(css, /--ds-news-party-(justice|kgreens|laborparty|jinboparty):/);
});

// 서로 너무 비슷한 색 없음: 한 색 막대끼리 밝은 화면에서 CIE Lab 거리 12 이상(어두운 화면 6 이상). 여러 색 띠(공공운수노조·Red Pepper·Socialist Worker)는 띠 색 차례가 서로 달라야 하고,
// 붉은 계열이 겹치는 노동당·Red Pepper·Socialist Worker는 띠 둘째 색으로 가른다(표 docs/design/news-identity-colors.md '비슷한 색').
const labOf = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); const X = (0.4124 * c[0] + 0.3576 * c[1] + 0.1805 * c[2]) / 0.95047, Y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], Z = (0.0193 * c[0] + 0.1192 * c[1] + 0.9505 * c[2]) / 1.08883; const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116); return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))]; };
const dist = (a, b) => Math.hypot(...labOf(a).map((v, i) => v - labOf(b)[i]));
test('서로 구분: 한 색 막대끼리 너무 비슷하지 않고, 여러 색 띠는 서로 다르다', () => {
  for (const [part, min, label] of [[lightPart, 12, '밝은'], [darkPart, 6, '어두운']]) {
    const single = [...FIXED_OUTSIDE, ...FIXED_NEWS].map(k => [k, tok(part, `ds-news-id-${k}-bar`)]).filter(([, v]) => /^#[0-9a-f]{6}$/.test(v));
    assert.ok(single.length >= 30, `한 색 막대 ${single.length}개`);
    for (let i = 0; i < single.length; i++) for (let j = i + 1; j < single.length; j++) {
      const d = dist(single[i][1], single[j][1]);
      assert.ok(d >= min, `${label} 화면 ${single[i][0]} ↔ ${single[j][0]} 너무 비슷함(${d.toFixed(1)})`);
    }
  }
  const bands = [...FIXED_OUTSIDE, ...FIXED_NEWS].map(k => [k, tok(lightPart, `ds-news-id-${k}-bar`)]).filter(([, v]) => v.startsWith('linear-gradient'));
  assert.deepEqual(bands.map(([k]) => k).sort(), ['kptu', 'redpepper', 'socialistworker']);
  assert.equal(new Set(bands.map(([, v]) => (v.match(/#[0-9a-f]{6}/g) || []).join())).size, bands.length);
  for (const [, v] of bands) assert.ok((v.match(/#[0-9a-f]{6}/g) || []).length >= 2);
});

test('붉은 계열이 겹치는 노동당·Red Pepper·Socialist Worker·민주노총은 막대 모양(띠 둘째 색 또는 더 진한 빨강)이 서로 다르다', () => {
  const bar = k => tok(lightPart, `ds-news-id-${k}-bar`);
  const reds = ['laborparty', 'kctu', 'redpepper', 'socialistworker'];
  assert.equal(new Set(reds.map(bar)).size, reds.length);
  assert.ok(dist(bar('laborparty'), bar('kctu')) >= 20, '노동당 ↔ 민주노총 빨강');
});

test('줄: 막대 색이 글자 색과 다를 때만 --nw-bar를 따로 쓴다', () => {
  const base = {key: 'outside:1', openAttr: 'data-os-open', openId: '1', title: 't', src: '공공운수노조', time: '09:00'};
  assert.match(rowHtml({...base, color: 'var(--ds-news-id-kptu)', bar: 'var(--ds-news-id-kptu-bar)'}, esc), /style="--nw-c:var\(--ds-news-id-kptu\);--nw-bar:var\(--ds-news-id-kptu-bar\)"/);
  assert.match(rowHtml({...base, color: 'var(--ds-news-labor-1)', bar: 'var(--ds-news-labor-1)'}, esc), /style="--nw-c:var\(--ds-news-labor-1\)"/);
  assert.match(readFileSync(new URL('../app/now.css', import.meta.url), 'utf8'), /\.nw-bar\{[^}]*background:var\(--nw-bar,var\(--nw-c\)\)/);
});
