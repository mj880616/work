// PRODUCT-판매준비범용화한글양식 작업 1(S62-10): 실제 한글 파일 왕복을 로컬에서만 돌리는 도구.
// 사용법: python3 tests/app-e2e/helpers/static-server.py 8123 &
//         node scripts/hwp-roundtrip/run.mjs <원본.hwp> <결과 폴더(저장소 밖)> [표번호,행,열]
// 결과 폴더에 왕복 결과 .hwp, 쪽 그림 비교 사진(compare-N.png), 바뀐 것 목록(changes.json: 개수·종류·위치만)을 쓴다.
// 실제 파일과 결과물은 공개 저장소에 넣지 않는다 — 결과 폴더가 저장소 안이면 멈춘다.
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {resolve, relative, isAbsolute, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {zlib} from '../weekly-hwpx/cli.mjs';
import {openEngine, roundTrip, pageSvgs, svgText} from '../../tests/app-e2e/helpers/hwp-roundtrip.mjs';
import {shapeCounts} from './compare.mjs';

const [src, outDir, cellArg] = process.argv.slice(2);
if (!src || !outDir) throw new Error('usage: run.mjs <source.hwp> <out dir> [table,row,col]');
const repo = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const rel = relative(repo, resolve(outDir));
if (!rel.startsWith('..') && !isAbsolute(rel)) throw new Error('결과 폴더는 저장소 밖이어야 합니다(공개 저장소).');
mkdirSync(outDir, {recursive: true});
const origin = process.env.WEB2_TEST_ORIGIN || 'http://127.0.0.1:8123';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({viewport: {width: 1000, height: 800}});
  await openEngine(page, origin);
  const source = new Uint8Array(readFileSync(src));
  // 고칠 칸: 지정이 없으면 첫 표의 둘째 행에서 글이 있는 첫 칸.
  const probe = await roundTrip(page, source, zlib);
  let edit;
  if (cellArg) { const [table, row, col] = cellArg.split(',').map(Number); edit = {table, row, col}; }
  else {
    const t = probe.before.tables.findIndex(x => x.texts.some(c => c.row >= 1 && c.text.trim()));
    if (t < 0) throw new Error('글이 든 표 칸을 찾지 못함');
    const c = probe.before.tables[t].texts.find(x => x.row >= 1 && x.text.trim());
    edit = {table: t, row: c.row, col: c.col};
  }
  edit.text = '왕복 시험으로 고친 칸';
  const result = await roundTrip(page, source, zlib, {edit});
  const stem = basename(src).replace(/\.hwp$/i, '');
  writeFileSync(resolve(outDir, `${stem}_왕복결과.hwp`), result.hwp);
  const report = {
    edit: {table: edit.table + 1, row: edit.row + 1, col: edit.col + 1},
    before: shapeCounts(result.before), after: shapeCounts(result.after),
    changes: result.changes, pureRoundTripChanges: probe.changes,
  };
  writeFileSync(resolve(outDir, 'changes.json'), JSON.stringify(report, null, 2));
  // 비교 사진: 왼쪽 원본, 오른쪽 왕복 결과. 1쪽, 고친 칸이 있는 쪽, 쪽 글이 처음 어긋나는 쪽과 그다음 쪽.
  const a = await pageSvgs(page, source, 'source.hwp');
  const b = await pageSvgs(page, result.hwp, 'result.hwp');
  const ta = a.svgs.map(svgText), tb = b.svgs.map(svgText);
  const editPage = tb.findIndex(t => t.includes(svgText(edit.text)));
  const firstDiff = ta.findIndex((t, i) => t !== tb[i] && i !== editPage);
  const shown = [...new Set([0, editPage, firstDiff, firstDiff + 1].filter(i => i >= 0 && i < Math.max(a.pages, b.pages)))].sort((x, y) => x - y);
  report.pagesCompared = {source: a.pages, result: b.pages, editPage: editPage + 1, firstDifferentPage: firstDiff + 1, shown: shown.map(i => i + 1)};
  writeFileSync(resolve(outDir, 'changes.json'), JSON.stringify(report, null, 2));
  const view = await browser.newPage({viewport: {width: 1700, height: 1200}, deviceScaleFactor: 1});
  for (const i of shown) {
    const box = svg => `<div style="flex:1;border:1px solid #999;background:#fff">${svg ?? '(쪽 없음)'}</div>`;
    await view.setContent(`<body style="margin:0;font:14px sans-serif;background:#eee"><div style="display:flex;gap:8px;padding:8px"><b style="flex:1">원본 ${i + 1}쪽</b><b style="flex:1">왕복 결과 ${i + 1}쪽</b></div><div style="display:flex;gap:8px;padding:0 8px 8px">${box(a.svgs[i])}${box(b.svgs[i])}</div><style>svg{width:100%;height:auto;display:block}</style></body>`);
    await view.screenshot({path: resolve(outDir, `compare-${i + 1}.png`), fullPage: true});
  }
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
