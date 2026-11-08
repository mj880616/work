// UI-용어통일(2026-11-08 명진 결정 '수정 삭제로 맞추자', 기준표 docs/design/ui-words.md).
// 화면 글자(코드 안 따옴표·템플릿 글자, HTML 글자, 폰 앱 strings.xml·Kotlin 글자)에서 기준표가 바꾸기로 한 말을 센다.
// 주석·코드 이름은 세지 않는다. 사람이 쓴 글을 알아보는 패턴처럼 화면 글자가 아닌 줄은 같은 줄에 'ui-words-ok'를 적어 뺀다.
// 기준표(tests/ui-words-baseline.json)보다 늘면 시험이 실패하고, 줄면 기준표를 줄이라고 알린다. 화면 묶음 PR마다 줄여 마지막에 0.
import {readFileSync, readdirSync, statSync} from 'node:fs';

// [찾는 말, 기준 말] — 예외(이름 바꾸기·HWP 편집·빼기·완료·새 폴더·되살리기·방금 맞춤·접기/펼치기·보관/숨기기)는 처음부터 패턴에 넣지 않는다.
const H = '(?<![가-힣])'; // '보고를'·'광고를'처럼 다른 낱말 속은 빼려고 낱말 머리에서만 찾는다
const NEXT = '[면고는려세지게며니던]';
export const RULES = [
  [new RegExp(`${H}(?:고치기|고쳐|고칠|고침|고친|고쳤|고치(?=${NEXT}))`, 'g'), '수정'],
  [/(?<!HWP\s?)편집/g, '수정'],
  [new RegExp(`${H}(?:지우기|지워|지울|지웠|지운|지우(?=${NEXT}))`, 'g'), '삭제'],
  [new RegExp(`${H}(?:버리기|버려|버릴|버렸|버린|버리(?=${NEXT}))`, 'g'), '삭제(창이면 취소)'],
  [/원래대로/g, '되돌리기'],
  [/다시\s?불러오기|다시\s?찾기|새로고침/g, '최신화·다시'],
  [/더보기/g, '⋯'],
  [new RegExp(`${H}(?:고르기|골라(?=[\\s요주서야']|$)|고른|고를|골랐|고르(?=[면고는려세지며니던])|고름(?![가-힣]))`, 'g'), '선택'], // 고르게(고르게 맞춤)는 뺀다
];

export const NOTES_FROM = '20261108-1530-~'; // 이 이름보다 뒤에 오는 기록만 검사
const SKIP_FILE = /(^|\/)(vendor|rhwp-[\d.]+|node_modules|release-notes|arsenal\/matches\.js)(\/|$)|\.min\.js$/;

// JS·Kotlin 소스에서 문자열·템플릿 글자만 꺼낸다(주석·식별자·정규식 리터럴 제외). 줄 번호를 함께 준다.
export function jsStrings(src) {
  const out = []; let i = 0, line = 1, prev = '';
  const stack = []; // 템플릿 안 ${ } 깊이
  const push = (text, ln, start, end) => { if (/[가-힣]/.test(text)) out.push({text, line: ln, start, end}); };
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; line += (src.slice(i, end).match(/\n/g) || []).length; i = end; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1, buf = ''; const ln = line;
      while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') { buf += src[j + 1] || ''; j += 2; } else buf += src[j++]; }
      push(buf, ln, i + 1, j); i = j + 1; prev = 'x'; continue;
    }
    if (c === '`' || (c === '}' && stack.length && stack[stack.length - 1] === 0)) {
      if (c === '}') stack.pop();
      let j = i + 1, buf = ''; const ln = line;
      while (j < n) {
        if (src[j] === '\\') { buf += src[j + 1] || ''; j += 2; continue; }
        if (src[j] === '`') { j++; break; }
        if (src[j] === '$' && src[j + 1] === '{') { j += 2; stack.push(0); break; }
        if (src[j] === '\n') line++;
        buf += src[j++];
      }
      push(buf, ln, i + 1, src[j - 1] === '{' ? j - 2 : src[j - 1] === '`' ? j - 1 : j); i = j; prev = src[j - 1] === '{' ? '{' : 'x'; continue;
    }
    if (c === '{' && stack.length) stack[stack.length - 1]++;
    if (c === '}' && stack.length) stack[stack.length - 1]--;
    if (c === '/' && /[(,=:[!&|?{};+\-*%<>~^]|^$|return$/.test(prev)) { // 정규식 리터럴 건너뛰기
      let j = i + 1, cls = false;
      while (j < n && src[j] !== '\n') { if (src[j] === '\\') { j += 2; continue; } if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break; j++; }
      i = j + 1; prev = 'x'; continue;
    }
    if (!/\s/.test(c)) prev = /[A-Za-z0-9_$)\]]/.test(c) ? (/[a-z]/.test(c) && src.slice(Math.max(0, i - 5), i + 1) === 'return' ? 'return' : 'x') : c;
    i++;
  }
  return out;
}
export function htmlStrings(src) {
  const out = []; const lines = src.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, '')).split('\n');
  lines.forEach((t, k) => { if (/[가-힣]/.test(t)) out.push({text: t, line: k + 1}); });
  return out;
}
export function countFile(name, src) {
  const lines = src.split('\n');
  const parts = /\.(html|xml)$/.test(name) ? htmlStrings(src) : jsStrings(src);
  const hits = [];
  for (const {text, line} of parts) {
    if (/ui-words-ok/.test(lines[line - 1] || '')) continue;
    for (const [re, to] of RULES) for (const m of text.matchAll(re)) hits.push({line, word: m[0], to});
  }
  return hits;
}
function walk(dir, base, files) {
  for (const f of readdirSync(dir).sort()) {
    const p = `${dir}/${f}`, rel = base ? `${base}/${f}` : f;
    if (SKIP_FILE.test(rel)) continue;
    if (statSync(p).isDirectory()) walk(p, rel, files);
    else files.push(rel);
  }
  return files;
}
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
export function targets(root = ROOT) {
  const app = walk(`${root}/app`, 'app', []).filter(f => /\.(js|mjs|html)$/.test(f));
  // 업데이트 기록(공개 배포물)은 기준표를 정한 뒤 새로 쓰는 것부터(옛 기록은 그대로).
  const notes = readdirSync(`${root}/app/release-notes`).filter(f => f.endsWith('.json') && f > NOTES_FROM).sort().map(f => `app/release-notes/${f}`);
  const phone = walk(`${root}/android-app/app/src/main`, 'android-app/app/src/main', []).filter(f => /\.kt$|values\/strings\.xml$/.test(f));
  return [...app, ...phone, ...notes];
}
export function scan(root = ROOT) {
  const out = {};
  for (const f of targets(root)) { const n = countFile(f, readFileSync(`${root}/${f}`, 'utf8')).length; if (n) out[f] = n; }
  return out;
}
export function compare(actual, baseline) {
  const grown = [], reduced = [];
  for (const [f, n] of Object.entries(actual)) { const lim = baseline[f] ?? 0; if (n > lim) grown.push(`${f}: ${lim} -> ${n}`); else if (n < lim) reduced.push(`${f}: ${lim} -> ${n}`); }
  for (const [f, n] of Object.entries(baseline)) if (!(f in actual) && n) reduced.push(`${f}: ${n} -> 0`);
  return {grown, reduced};
}
