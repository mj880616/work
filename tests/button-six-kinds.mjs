// UI-버튼6가지(2026-11-06 명진 요청 23:23 '버튼 모양 크기 색깔 테두리 등 전수조사 통일감', 시안 docs/design/mockups/button-six-kinds.html 승인 'ㅇ').
// 사이트 버튼은 6가지(주 동작·작은 버튼·글자 버튼·칩·보기 바꾸기·아이콘)뿐이고 모양은 app/ui-standard.css 'UI-버튼6가지' 한 곳이 정한다.
// 이 검사기는 두 가지 빚을 센다. 기준표(tests/button-six-kinds-baseline.json)보다 늘면 시험이 실패하고, 줄면 기준표를 줄이라고 알린다.
//   css  화면 CSS(공용 세 파일 밖, ui-standard.css는 화면 id(#…)를 쓴 규칙만)에서 버튼을 잡는 규칙이 정한 높이·모서리·바탕·테두리 선언 수
//   html 화면 코드(app/*.js·*.mjs·*.html)의 <button> 중 6가지 클래스가 하나도 없는 것의 수
import {readFileSync, readdirSync} from 'node:fs';

export const KIND_CLASSES = ['primary', 'secondary', 'ghost', 'danger', 'row-act', 'ds-chip', 'ds-seg-btn', 'icon-btn'];
const KIND = new RegExp(`(^|[\\s"'\`])(${KIND_CLASSES.join('|')})(?=[\\s"'\`$]|$)`);
const COMMON = new Set(['theme-tokens.css', 'base-ui.css']);
const BTN = /(^|[\s>+~(,:])button\b|\[role="?button"?\]|\.(primary|secondary|ghost|danger|mini|icon-btn|row-act)\b/;
const PROP = /^(height|min-height|border-radius|background|background-color|border|border-color|border-width)$/;

const strip = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
// 가장 안쪽 '선택자 { 선언 }'만 꺼낸다(@media 안의 규칙 포함, @규칙 자체는 뺀다).
export function cssRules(css) {
  const out = [], stack = [];
  let buf = '';
  for (const ch of strip(css)) {
    if (ch === '{') { stack.push(buf.trim()); buf = ''; }
    else if (ch === '}') { const sel = stack.pop(); if (sel !== undefined && !sel.startsWith('@') && !/^(from|to|\d+%)/.test(sel)) out.push([sel, buf]); buf = ''; }
    else buf += ch;
  }
  return out;
}
export function cssDebt(file, css) {
  let n = 0;
  for (const [sel, body] of cssRules(css)) {
    if (!BTN.test(sel)) continue;
    if (file === 'ui-standard.css' && !sel.includes('#')) continue;
    for (const d of body.split(';')) { const m = d.match(/^\s*([a-z-]+)\s*:/); if (m && PROP.test(m[1])) n++; }
  }
  return n;
}
export function htmlDebt(src) {
  let n = 0;
  for (const m of src.matchAll(/<button\b([^>]*)>/g)) {
    const c = m[1].match(/class=(["'`])([\s\S]*?)\1/);
    if (!c || !KIND.test(c[2])) n++;
  }
  return n;
}
export function scan(dir = new URL('../app/', import.meta.url)) {
  const css = {}, html = {};
  for (const f of readdirSync(dir).sort()) {
    if (f.endsWith('.css') && !COMMON.has(f)) { const n = cssDebt(f, readFileSync(new URL(f, dir), 'utf8')); if (n) css[f] = n; }
    else if (/\.(js|mjs|html)$/.test(f)) { const n = htmlDebt(readFileSync(new URL(f, dir), 'utf8')); if (n) html[f] = n; }
  }
  return {css, html};
}
export function compare(actual, baseline) {
  const grown = [], reduced = [];
  for (const kind of ['css', 'html']) {
    const a = actual[kind] || {}, b = baseline[kind] || {};
    for (const [f, n] of Object.entries(a)) { const limit = b[f] ?? 0; if (n > limit) grown.push(`${kind} ${f}: ${limit} -> ${n}`); else if (n < limit) reduced.push(`${kind} ${f}: ${limit} -> ${n}`); }
    for (const [f, n] of Object.entries(b)) if (!(f in a) && n) reduced.push(`${kind} ${f}: ${n} -> 0`);
  }
  return {grown, reduced};
}
