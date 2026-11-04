#!/usr/bin/env node
// UI-버튼간격 전수 수집(S49-40): app/*.js 템플릿에서 '</button>' 바로 뒤에 다른 버튼이 붙어 있는(사이 공백·간격 0) 줄을 표로 낸다.
// 같은 줄에 .btn-row(공용 버튼 줄, 간격 --ds-button-gap)가 있으면 '맞음', 없으면 '확인 필요'. 사람 눈으로 줄 앞뒤 부모를 보고 정한다.
// 실행: node scripts/ui/button-gap-scan.mjs   (읽기만 한다. 파일을 고치지 않는다)
import {readdirSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const dir = fileURLToPath(new URL('../../app/', import.meta.url));
const rows = [];
for (const name of readdirSync(dir).filter(n => n.endsWith('.js')).sort()) {
  readFileSync(join(dir, name), 'utf8').split('\n').forEach((line, i) => {
    if (!/<\/button>\s*<button/.test(line)) return;
    rows.push({file: `app/${name}`, line: i + 1, ok: /btn-row/.test(line), hint: (line.match(/class="([^"]*)"/) || [, ''])[1].slice(0, 40)});
  });
}
console.log('| 파일 | 줄 | 같은 줄 btn-row | 첫 클래스 |\n| --- | --- | --- | --- |');
for (const r of rows) console.log(`| ${r.file} | ${r.line} | ${r.ok ? '맞음' : '확인 필요'} | ${r.hint} |`);
console.log(`\n합계 ${rows.length}줄, 확인 필요 ${rows.filter(r => !r.ok).length}줄`);
