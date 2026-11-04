// UI-로딩자리전수(S49-15 A): 맨 위 막대에 시작을 알리는 곳(waitHtml·waitEl·showWait·waitInline·barHtml; UI-로딩맨위)과 빈 결과 글(emptyHtml·emptyEl·showEmpty)이 있는 자리를 파일별로 모은다.
// 빈 결과 글 앞 25줄 안에 로딩 확인(waitHtml·loading·loaded·settled·status·phase·ready·state 낱말)이 없으면 '확인 필요'로 올린다.
// 사용: node scripts/ops/loading-audit.mjs [--md]   (읽기 전용, 저장소 파일을 바꾸지 않음)
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
const APP = fileURLToPath(new URL('../../app/', import.meta.url));
const SKIP = ['hwp-lab/', 'editor-lib/', 'pdf-lib/', 'markdown-lib/', 'legacy/', 'release-notes/'];
const walk = dir => readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const WAIT = /\b(waitHtml|waitEl|showWait|waitInlineHtml|waitInlineEl|barHtml)\s*\(/;
const EMPTY = /\b(emptyHtml|emptyEl|showEmpty)\s*\(/;
const GUARD = /wait(Html|El|Inline)|showWait|barHtml|loading|loaded|settled|status|phase|ready|state|pending|busy|failed|fail/i;
export function audit() {
  const rows = [];
  for (const file of walk(APP)) {
    const rel = relative(APP, file).split('\\').join('/');
    if (!/\.m?js$/.test(rel) || SKIP.some(d => rel.startsWith(d)) || rel === 'wait-state.js') continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    let waits = 0, empties = 0; const suspects = [];
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\/\*|\*|import )/.test(line)) return;
      if (WAIT.test(line)) waits++;
      if (EMPTY.test(line)) {
        empties++;
        const before = lines.slice(Math.max(0, i - 25), i + 1).join('\n');
        if (!GUARD.test(before)) suspects.push(i + 1);
      }
    });
    if (waits || empties) rows.push({file: rel, waits, empties, suspects});
  }
  return rows;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rows = audit();
  if (process.argv.includes('--md')) {
    console.log('| 파일 | 로딩 표시 | 빈 결과 글 | 로딩 확인 없이 빈 결과 글(줄) |\n| --- | --- | --- | --- |');
    for (const r of rows) console.log(`| ${r.file} | ${r.waits} | ${r.empties} | ${r.suspects.join(', ') || '-'} |`);
  } else console.log(JSON.stringify(rows, null, 1));
}
