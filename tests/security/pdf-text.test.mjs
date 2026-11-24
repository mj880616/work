// S69 READ-첨부본문: 자체 PDF 글자 읽기(_shared/pdf-text.mjs). 가짜 PDF만(네트워크 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import {pdfText, parseCmap} from '../../supabase/functions/_shared/pdf-text.mjs';
import {fakePdf} from '../helpers/fake-pdf.mjs';

const LINES = ['청년고용 부진 및 정책 과제', '최근 청년층 고용률이 하락하고 있다.'];

test('Type0 글꼴 + ToUnicode 표의 한글을 줄마다 읽는다(압축 내용)', async () => {
  const text = await pdfText(fakePdf(LINES));
  // TJ 안 큰 간격(-400)은 띄어쓰기 하나(이미 띄어 있으면 그대로), 세로 이동(Td)은 새 줄.
  assert.deepEqual(text.split('\n'), ['청년고 용 부진 및 정책 과제', '최근 청년층 고용률이 하락하고 있다.']);
});

test('객체 스트림(ObjStm) 안 페이지·글꼴도 읽는다', async () => {
  const text = await pdfText(fakePdf(LINES, {objStm: true}));
  assert.match(text, /정책 과제/);
  assert.match(text, /하락하고 있다/);
});

test('단순 글꼴(표 없음)은 Latin-1로', async () => {
  assert.equal(await pdfText(fakePdf(['Youth employment report'], {plain: true})), 'Youth employment report');
});

test('암호 걸린 PDF·PDF가 아닌 바이트·깨진 파일은 빈 글자(던지지 않음)', async () => {
  assert.equal(await pdfText(fakePdf(LINES, {encrypt: true})), '');
  assert.equal(await pdfText(new TextEncoder().encode('<html>not pdf</html>')), '');
  const broken = fakePdf(LINES).slice(0, 200);
  assert.equal(typeof await pdfText(broken), 'string');
});

test('글자 상한', async () => {
  const text = await pdfText(fakePdf(LINES), {maxChars: 5});
  assert.ok([...text].length <= 5);
});

test('ToUnicode bfrange(배열·연속)도 읽는다', () => {
  const {map, width} = parseCmap('1 begincodespacerange <0000> <FFFF> endcodespacerange 2 beginbfrange <0010> <0012> <AC00> <0020> <0021> [<B098> <B2E4>] endbfrange');
  assert.equal(width, 2);
  assert.equal(map.get(0x10), '가'); assert.equal(map.get(0x12), '갂');
  assert.equal(map.get(0x20), '나'); assert.equal(map.get(0x21), '다');
});
