// S71-74 UI-덮어쓰기땜질없애기(사용자 11/26 "땜질식 덮어쓰기 안돼"): 땜질 모양 정적 검사.
// AGENTS.md 5절 '한 화면 영역은 상태 주인 하나·최종 그리는 곳 하나. 늦은 덮어쓰기·넓은 MutationObserver·display:none 땜질 금지'를
// 새로 더한 코드에서 막는다. 지금 있는 것은 파일별 개수 기준표(patch-patterns-baseline.json, 2026-11-26 전수 조사 표)로 시작하고,
// 고칠 때마다 개수가 줄면 기준표도 줄인다(늘면 실패). 세는 것 세 가지:
//  broadObserver  — document·document.body·documentElement를 subtree로 지켜보는 MutationObserver(다른 모듈이 그린 DOM을 고치는 넓은 감시)
//  importantHide  — display:none!important(다른 모듈 요소를 힘으로 가리는 숨김. 같은 모듈의 상태 숨김은 [hidden]·클래스로 한다)
//  hasHide        — :has(…)로 고른 요소를 display:none으로 가리는 CSS 규칙(다른 화면·셸 요소를 그 화면 CSS가 숨김).
//                   ':not(:has(…))'(안이 비었을 때 자기 자리를 접는 상태 규칙)은 세지 않는다.
// 범위: app/ 아래 .js·.mjs·.css. 외부 라이브러리 폴더(판 번호 폴더·vendor·*-lib)와 운영에서 불러오지 않는 app/legacy는 뺀다.
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../app/', import.meta.url));
const BASELINE = fileURLToPath(new URL('./patch-patterns-baseline.json', import.meta.url));
const SKIP_DIR = /^(vendor|legacy|node_modules|editor-lib|pdf-lib|markdown-lib)$|-\d+\.\d+(\.\d+)?$/;
export const KINDS = ['broadObserver', 'importantHide', 'hasHide'];

const stripComments = (text, css) => (css ? text.replace(/\/\*[\s\S]*?\*\//g, '') : text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1'));

export function countPatterns(name, text) {
  const css = name.endsWith('.css');
  const src = stripComments(String(text ?? ''), css);
  const out = {broadObserver: 0, importantHide: 0, hasHide: 0};
  if (!css) {
    // .observe(document | document.body | document.documentElement | body, {… subtree:true …})
    const re = /\.observe\(\s*(?:document(?:\.body|\.documentElement)?|body|root\s*=\s*document[\w.]*)\s*,\s*\{([^}]*)\}/g;
    for (const m of src.matchAll(re)) if (/subtree\s*:\s*(?:true|!0)/.test(m[1])) out.broadObserver++;
  }
  out.importantHide = (src.match(/display\s*:\s*none\s*!\s*important/g) || []).length;
  if (css || /display\s*:\s*none/.test(src)) {
    // 규칙 단위: 고르개{몸통}. 고르개에 :has( 가 있고 몸통에 display:none.
    for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (/(?<!:not\():has\(/.test(m[1]) && /display\s*:\s*none/.test(m[2])) out.hasHide++;
  }
  return out;
}

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name), st = statSync(p);
    if (st.isDirectory()) { if (!SKIP_DIR.test(name)) walk(p, files); continue; }
    if (/\.(m?js|css)$/.test(name) && !/\.min\./.test(name)) files.push(p);
  }
  return files;
}

export function scanApp(root = ROOT) {
  const counts = {};
  for (const file of walk(root)) {
    const c = countPatterns(file, readFileSync(file, 'utf8'));
    if (KINDS.some(k => c[k])) counts[relative(root, file).split('\\').join('/')] = c;
  }
  return counts;
}

// 기준표보다 늘면 오류, 줄면 '기준표 줄이기' 알림.
export function comparePatterns(counts, baseline) {
  const errors = [], reduced = [];
  for (const [file, c] of Object.entries(counts)) for (const k of KINDS) {
    const allowed = baseline[file]?.[k] || 0;
    if (c[k] > allowed) errors.push(`${file}: ${k} ${c[k]}개(허용 ${allowed}) — 늦은 덮어쓰기·넓은 감시·힘 숨김 대신 그리는 곳 하나에서 처음부터 최종 모양으로 그린다(AGENTS.md 5절)`);
  }
  for (const [file, b] of Object.entries(baseline)) for (const k of KINDS) {
    const now = counts[file]?.[k] || 0;
    if ((b[k] || 0) > now) reduced.push(`${file}: ${k} ${b[k]} → ${now}`);
  }
  return {errors, reduced};
}

export function checkBaseline() {
  return comparePatterns(scanApp(), JSON.parse(readFileSync(BASELINE, 'utf8')));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--print')) { console.log(JSON.stringify(scanApp(), null, 1)); process.exit(0); }
  const {errors, reduced} = checkBaseline();
  for (const r of reduced) console.log('기준표를 줄여 주세요: ' + r);
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('patch-patterns: 새 땜질 모양 없음');
}
