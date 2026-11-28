// UI-반복단추줄이기(2026-11-28 14:05 사용자 결정, docs/design-decisions.md UI-버튼기준 '반복 줄 단추'): 줄·카드마다 되풀이되는 동작에
// 테두리(채움) 단추(② secondary·ghost·danger, ① primary, 옛 .mini)를 붙이지 않는다 — 글자 단추(③ row-act) 또는 ⋮ 메뉴.
// 이 검사기는 화면 코드(app/ 아래 *.js·*.mjs, 하위 폴더 포함·외부 라이브러리 제외)에서 '되풀이해 그리는 줄' 안에서 만드는 테두리 단추를 센다.
//   되풀이해 그리는 줄 = 같은 줄에 .map( · .forEach( · for( 가 있는 줄(목록을 줄마다 그리는 자리).
//   테두리 단추 = 그 줄의 <button … class="…"> 또는 el('button','…')·createElement('button') 뒤 className에 테두리 종류 클래스가 있는 것.
// 줄 하나만 보는 어림 검사라 놓치는 곳이 있다. 기준표(tests/repeat-row-buttons-baseline.json)보다 늘면 실패하고, 줄면 기준표를 줄이라고 알린다.
// 같은 줄에 'repeat-row-ok'를 적으면 뺀다(한 화면에 한 번만 그리는 단추가 우연히 반복 줄에 걸린 경우만).
import {readFileSync, readdirSync, statSync} from 'node:fs';

export const BORDERED = ['secondary', 'ghost', 'danger', 'primary', 'mini'];
const BORDER_CLASS = new RegExp(`(^|\\s)(${BORDERED.join('|')})(?=\\s|$)`);
const LOOP = /\.map\(|\.forEach\(|\bfor\s*\(/;
const SKIP = /(^|\/)(vendor|rhwp-[\d.]+|node_modules|release-notes)(\/|$)|\.min\.js$/;

// 한 줄에서 테두리 단추를 만드는 곳의 클래스 글자들.
export function borderedOnLine(line) {
  const out = [];
  for (const m of line.matchAll(/<button\b[^>]*?class=(["'])([^"']*)\1/g)) if (BORDER_CLASS.test(m[2].replace(/\$\{[^}]*\}/g, ' '))) out.push(m[2]);
  for (const m of line.matchAll(/\bel\(\s*['"]button['"]\s*,\s*['"]([^'"]*)['"]/g)) if (BORDER_CLASS.test(m[1])) out.push(m[1]);
  for (const m of line.matchAll(/createElement\(\s*['"]button['"]\s*\)[^;]*?className\s*=\s*['"]([^'"]*)['"]/g)) if (BORDER_CLASS.test(m[1])) out.push(m[1]);
  return out;
}
export function countFile(src) {
  const hits = [];
  src.split('\n').forEach((line, i) => {
    if (!LOOP.test(line) || /repeat-row-ok/.test(line)) return;
    for (const cls of borderedOnLine(line)) hits.push({line: i + 1, cls});
  });
  return hits;
}
function walk(dir, base, files) {
  for (const f of readdirSync(dir).sort()) {
    const p = `${dir}/${f}`, rel = `${base}/${f}`;
    if (SKIP.test(rel)) continue;
    if (statSync(p).isDirectory()) walk(p, rel, files);
    else if (/\.m?js$/.test(f)) files.push(rel);
  }
  return files;
}
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
export function scan(root = ROOT) {
  const out = {};
  for (const f of walk(`${root}/app`, 'app', [])) { const n = countFile(readFileSync(`${root}/${f}`, 'utf8')).length; if (n) out[f] = n; }
  return out;
}
export function compare(actual, baseline) {
  const grown = [], reduced = [];
  for (const [f, n] of Object.entries(actual)) { const lim = baseline[f] ?? 0; if (n > lim) grown.push(`${f}: ${lim} -> ${n}`); else if (n < lim) reduced.push(`${f}: ${lim} -> ${n}`); }
  for (const [f, n] of Object.entries(baseline)) if (!(f in actual) && n) reduced.push(`${f}: ${n} -> 0`);
  return {grown, reduced};
}
