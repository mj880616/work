import test from 'node:test';
import assert from 'node:assert/strict';
import {unionBounds, rasterScale, exportFileName, pdfFromJpeg, pdfPageCount, RASTER_MAX} from '../app/note-board-export-model.mjs';

// S70-32 ③ 보드 내보내기: 범위·배율·파일 이름·PDF 한 쪽(그림). 값은 지어낸 것.
test('범위 = 모든 칸을 감싸는 사각형 + 여백, 칸이 없으면 null', () => {
  assert.deepEqual(unionBounds([{x:100, y:50, w:40, h:20}, {x:10, y:200, w:30, h:30}], 10), {x:0, y:40, w:150, h:200});
  assert.equal(unionBounds([]), null);
  assert.equal(unionBounds([{x:NaN, y:0, w:1, h:1}]), null);
});
test('그림 배율: 2배, 긴 변이 크면 줄임', () => {
  assert.equal(rasterScale(800, 600), 2);
  assert.equal(rasterScale(RASTER_MAX, 100), 1);
  assert.ok(rasterScale(60000, 10) >= 0.1);
});
test('파일 이름', () => {
  assert.equal(exportFileName('회의/정리:1', 'pdf', new Date(2026, 10, 25)), '회의 정리 1 2026-11-25.pdf');
  assert.equal(exportFileName('', 'html', new Date(2026, 0, 2)), '보드 2026-01-02.html');
});
test('PDF: JPEG 한 장 → 쪽 1, 목차(xref) 자리가 맞다', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 3, 1, 0xff, 0xd9]);
  const pdf = pdfFromJpeg(jpeg, 200, 100, 100, 50);
  const text = Buffer.from(pdf).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4\n'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.equal(pdfPageCount(pdf), 1);
  assert.match(text, /\/MediaBox \[0 0 75 37.5\]/);
  assert.match(text, /\/Width 200 \/Height 100/);
  // xref의 각 자리 = 'n 0 obj'가 시작하는 바이트.
  const xref = Number(/startxref\n(\d+)/.exec(text)[1]);
  assert.ok(text.slice(xref).startsWith('xref'));
  const rows = text.slice(xref).split('\n').slice(3, 8).map(r => Number(r.slice(0, 10)));
  rows.forEach((off, i) => assert.ok(text.slice(off).startsWith(`${i + 1} 0 obj`), `obj ${i + 1}`));
  // 그림 바이트가 그대로 들어 있다.
  assert.ok(Buffer.from(pdf).includes(Buffer.from(jpeg)));
  assert.throws(() => pdfFromJpeg(new Uint8Array([1, 2, 3]), 1, 1));
});
