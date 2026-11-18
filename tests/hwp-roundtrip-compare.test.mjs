import test from 'node:test';
import assert from 'node:assert/strict';
import {makeRoundtripHwpx, makeRoundtripPackage, EDIT_TARGET, LONG_ROWS, zlib} from '../scripts/hwp-roundtrip/fixture.mjs';
import {shapeOf, shapeCounts, diffShapes, editCell} from '../scripts/hwp-roundtrip/compare.mjs';
import {validateHwpx, packHwpx, readXml, setXml} from '../app/weekly-hwpx/hwpx.mjs';
import {walk, kid} from '../app/weekly-hwpx/xml.mjs';
// PRODUCT-판매준비범용화한글양식 작업 1(S62-10): 왕복 비교 스크립트(바뀐 것 목록)와 합성 시험 파일. 브라우저 엔진 왕복은
// tests/app-e2e/hwp-roundtrip.spec.mjs가 본다.

test('합성 파일: 규격 검사를 통과하고 합친 칸·여러 쪽 표·머리말·꼬리말·글자 모양이 섞여 있다', () => {
  const bytes = makeRoundtripHwpx();
  assert.deepEqual(validateHwpx(bytes, zlib).errors, []);
  const c = shapeCounts(shapeOf(bytes, zlib));
  assert.equal(c.headers, 1);
  assert.equal(c.footers, 1);
  assert.ok(c.merged >= LONG_ROWS / 5, `합친 칸 ${c.merged}`);
  assert.ok(c.charLooks > 3, `글자 모양 ${c.charLooks}`);
  assert.ok(shapeOf(bytes, zlib).tables[0].rows === LONG_ROWS + 1);
});

test('합성 파일에 실명·업무 글이 없다(자리표시 글만)', () => {
  const s = shapeOf(makeRoundtripHwpx(), zlib);
  const all = [...s.paragraphs.map(p => p.text)].join('\n');
  assert.doesNotMatch(all, /@|https?:|\d{2,3}-\d{3,4}-\d{4}/);
});

test('칸 하나 고치기: 그 칸과 그 문단만 바뀐 것으로 나온다', () => {
  const bytes = makeRoundtripHwpx();
  const before = shapeOf(bytes, zlib);
  const after = shapeOf(editCell(bytes, zlib, {table: 0, ...EDIT_TARGET}), zlib);
  assert.deepEqual(diffShapes(before, after), [
    {kind: '문단 글', detail: '1개 문단의 글이 다름'},
    {kind: '칸 글', detail: `표 1 ${EDIT_TARGET.row + 1}행 ${EDIT_TARGET.col + 1}열`},
  ]);
  assert.throws(() => editCell(bytes, zlib, {table: 0, row: 999, col: 0, text: 'x'}), /칸을 찾지 못함/);
});

test('바뀐 것 목록: 합친 칸·글자 모양·쪽 수·머리말이 달라지면 종류별로 잡고, 글 내용은 넣지 않는다', () => {
  const base = shapeOf(makeRoundtripHwpx(), zlib, {pages: 4});
  const pkg = makeRoundtripPackage();
  const sec = readXml(pkg, 'Contents/section0.xml');
  const merged = [...walk(sec.root)].find(n => n.name === 'hp:cellSpan' && n.attrs.rowSpan !== '1');
  merged.attrs.rowSpan = '1';
  const run = [...walk(sec.root)].filter(n => n.name === 'hp:run' && n.attrs.charPrIDRef === '13')[0];
  run.attrs.charPrIDRef = '0';
  const header = [...walk(sec.root)].find(n => n.name === 'hp:ctrl' && kid(n, 'hp:header'));
  header.children = [];
  setXml(pkg, 'Contents/section0.xml', sec);
  const changed = shapeOf(packHwpx(pkg, zlib), zlib, {pages: 5});
  const kinds = diffShapes(base, changed).map(d => d.kind);
  for (const k of ['쪽 수', '머리말 수', '합친 칸', '글자 모양']) assert.ok(kinds.includes(k), `${k} 빠짐: ${kinds}`);
  const text = JSON.stringify(diffShapes(base, changed));
  assert.doesNotMatch(text, /시험 줄|파란 글씨|머리말 —/);
});
