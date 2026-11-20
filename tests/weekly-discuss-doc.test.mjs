// S67-29 WEEKLY-논의요청한글: 상집 논의 요청 줄에 붙인 한글 문서가 주간보고 한글 파일 안 그 안건 아래에 그대로 들어가는지.
// 실제 문서는 쓰지 않는다: 합성 문서(tests/fixtures/discuss-doc.mjs) + 가짜 주간보고 빈 서식(scripts/weekly-hwpx/fixture.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {zlib, SAMPLE} from '../scripts/weekly-hwpx/cli.mjs';
import {openHwpx, packHwpx, validateHwpx, readXml} from '../app/weekly-hwpx/hwpx.mjs';
import {walk, kid, kids, textOf} from '../app/weekly-hwpx/xml.mjs';
import {extractBlankTemplate, buildReport, reportTexts} from './fixtures/weekly-engine.mjs';
import {makeFakeReport, DEMO_DATA} from '../scripts/weekly-hwpx/fixture.mjs';
import {previewDoc, embedDoc, docTexts, fitWidth, bodyWidthOf} from '../app/weekly-hwpx/embed.mjs';
import {makeDiscussDoc, DOC} from './fixtures/discuss-doc.mjs';
import {cleanDiscussRow, withDiscussRow, discussFileItems, attachedLine} from '../app/weekly-discuss.mjs';

const blank = () => extractBlankTemplate(makeFakeReport(openHwpx(new Uint8Array(readFileSync(SAMPLE)), zlib)));
const reopen = pkg => openHwpx(packHwpx(pkg, zlib), zlib);
const ROW = {id: 'd1', title: '가상 안건 갑', note: '가상 설명', file: {id: '0b6f8c2e-1111-4a2b-9c3d-123456789abc', name: '가상 논의.hwpx'}};

test('줄 모양: 붙인 문서 연결 {id, name}은 한글 파일 이름(.hwp·.hwpx)일 때만 남고, 빼면(null) 연결만 사라진다', () => {
  assert.deepEqual(cleanDiscussRow(ROW).file, ROW.file);
  assert.equal(cleanDiscussRow({...ROW, file: {id: ROW.file.id, name: '가상.pdf'}}).file, undefined);
  assert.equal(cleanDiscussRow({...ROW, file: {id: 'x/../y', name: '가상.hwp'}}).file, undefined);
  assert.equal(cleanDiscussRow({...ROW, file: {id: ROW.file.id, name: 'a/b.hwp'}}).file.name, 'a b.hwp');
  const rows = withDiscussRow([ROW], {id: 'd1', title: ROW.title, note: ROW.note, file: null});
  assert.equal(rows[0].file, undefined);
  assert.equal(rows[0].title, ROW.title);
});

test('미리 채우기: 제목 = 글이 있는 첫 문단, 설명 = 그다음 문단', () => {
  const doc = makeDiscussDoc();
  assert.deepEqual(previewDoc(doc), {title: DOC.title, note: DOC.note});
  assert.ok(docTexts(doc).includes(DOC.cells[0]));
  assert.equal(previewDoc(doc, {noteMax: 10}).note.length, 10);
});

test('한글 파일 줄: 붙인 문서가 있는 줄은 문서 자리, 열지 못한 문서는 "첨부 문서: 파일 이름"', () => {
  const pkg = makeDiscussDoc();
  const items = discussFileItems([ROW, {id: 'd2', title: '가상 안건 을'}], new Map([['d1', {pkg}]]));
  assert.equal(items[0], '- 가상 안건 갑 — 가상 설명');
  assert.equal(items[1].embed, pkg);
  assert.equal(items[2], '- 가상 안건 을');
  assert.deepEqual(discussFileItems([ROW], new Map([['d1', {failed: true}]])), ['- 가상 안건 갑 — 가상 설명', attachedLine('가상 논의.hwpx')]);
  assert.deepEqual(discussFileItems([ROW]), ['- 가상 안건 갑 — 가상 설명', attachedLine('가상 논의.hwpx')]);
});

test('합성 문서가 결과 .hwpx 안 상집 논의 요청 안건 아래에 들어가고, 글자·문단·표 모양이 남으며 규격 검사를 통과한다', () => {
  const doc = makeDiscussDoc();
  const data = {...DEMO_DATA, discuss: discussFileItems([ROW], new Map([['d1', {pkg: doc}]]))};
  const {pkg, embedded} = buildReport(blank(), data);
  assert.equal(embedded.count, 1);
  assert.deepEqual(embedded.lost, ['그림']);
  const bytes = packHwpx(pkg, zlib);
  assert.deepEqual(validateHwpx(bytes, zlib).errors, []);
  const out = openHwpx(bytes, zlib);
  const sec = readXml(out, 'Contents/section0.xml').root, head = readXml(out, 'Contents/header.xml').root;
  const top = kids(sec, 'hp:p').map(p => textOf(p));
  // 차례: 안건 줄 → 문서 제목 → 요지 → 표 → 번호 문단 (안건 줄 바로 뒤)
  const at = top.indexOf('- 가상 안건 갑 — 가상 설명');
  assert.ok(at > 0);
  assert.equal(top[at + 1], DOC.title);
  assert.equal(top[at + 2], DOC.note);
  assert.equal(top[at + 3], DOC.cells.join(''));
  assert.equal(top[at + 4], DOC.numbered);
  // 그림 개체·쪽 설정은 옮기지 않는다(본문 쪽 설정은 하나)
  assert.equal([...walk(sec)].filter(n => n.name === 'hp:pic').length, 0);
  assert.equal([...walk(sec)].filter(n => n.name === 'hp:secPr').length, 1);
  // 글자 모양: 제목 글의 글자 모양은 크기·색·굵게·가상 글꼴 그대로
  const titleP = kids(sec, 'hp:p')[at + 1];
  const charId = kids(titleP, 'hp:run')[0].attrs.charPrIDRef;
  const cp = [...walk(head)].find(n => n.name === 'hh:charPr' && n.attrs.id === charId);
  assert.equal(cp.attrs.height, DOC.height);
  assert.equal(cp.attrs.textColor, DOC.color);
  assert.ok(kid(cp, 'hh:bold'));
  const hangul = [...walk(head)].find(n => n.name === 'hh:fontface' && n.attrs.lang === 'HANGUL');
  assert.equal(kids(hangul, 'hh:font').find(f => f.attrs.id === kid(cp, 'hh:fontRef').attrs.hangul).attrs.face, DOC.font);
  // 문단 모양: 가운데 정렬·왼쪽 여백
  const pp = [...walk(head)].find(n => n.name === 'hh:paraPr' && n.attrs.id === titleP.attrs.paraPrIDRef);
  assert.equal([...walk(pp)].find(n => n.name === 'hh:align').attrs.horizontal, 'CENTER');
  assert.equal([...walk(pp)].find(n => n.name === 'hc:left').attrs.value, '2000');
  // 번호 문단은 번호(NUMBER)를 그대로, 번호 정의는 주간보고 머리에 있다
  const numP = kids(sec, 'hp:p')[at + 4];
  const heading = [...walk([...walk(head)].find(n => n.name === 'hh:paraPr' && n.attrs.id === numP.attrs.paraPrIDRef))].find(n => n.name === 'hh:heading');
  assert.equal(heading.attrs.type, 'NUMBER');
  assert.ok([...walk(head)].some(n => n.name === 'hh:numbering' && n.attrs.id === heading.attrs.idRef));
  // 표: 칸 색·테두리 그대로, 칸 글은 표내부 스타일로 바뀌지 않음, 칸 높이 그대로
  const tbl = [...walk(kids(sec, 'hp:p')[at + 3])].find(n => n.name === 'hp:tbl');
  const tc = [...walk(tbl)].find(n => n.name === 'hp:tc');
  const bf = [...walk(head)].find(n => n.name === 'hh:borderFill' && n.attrs.id === tc.attrs.borderFillIDRef);
  assert.equal([...walk(bf)].find(n => n.name === 'hc:winBrush').attrs.faceColor, DOC.fill);
  assert.equal([...walk(bf)].find(n => n.name === 'hh:leftBorder').attrs.width, '0.4 mm');
  assert.equal(kid(tc, 'hp:cellSz').attrs.height, '2000');
  assert.equal(kids(kid(tc, 'hp:subList'), 'hp:p')[0].attrs.styleIDRef, '0');
  // 다른 자리(요약 표 등)의 글은 그대로
  for (const t of reportTexts(DEMO_DATA)) assert.ok([...walk(sec)].some(n => n.name === 'hp:t' && textOf({children: [n]}).includes(t.slice(0, 6))), t);
});

test('같은 문서를 두 줄에 붙여도 모양은 한 번만 더하고(같은 모양 다시 씀), 붙인 문서가 없으면 머리는 그대로', () => {
  const doc = makeDiscussDoc();
  const two = buildReport(blank(), {...DEMO_DATA, discuss: [{embed: doc, name: 'a.hwpx'}, {embed: doc, name: 'a.hwpx'}]});
  const one = buildReport(blank(), {...DEMO_DATA, discuss: [{embed: doc, name: 'a.hwpx'}]});
  const count = pkg => [...walk(readXml(pkg, 'Contents/header.xml').root)].filter(n => n.name === 'hh:charPr').length;
  assert.equal(count(two.pkg), count(one.pkg));
  assert.deepEqual(validateHwpx(packHwpx(two.pkg, zlib), zlib).errors, []);
  const none = buildReport(blank(), {...DEMO_DATA, discuss: ['- 가상']});
  assert.equal(none.embedded.count, 0);
  const t = blank();
  assert.equal(new TextDecoder().decode(none.pkg.files.get('Contents/header.xml')), new TextDecoder().decode(t.files.get('Contents/header.xml')));
});

test('주간보고 쪽 글 폭보다 넓은 표는 열 너비를 같은 비율로 줄인다', () => {
  const doc = makeDiscussDoc({wide: true});
  const t = blank();
  const width = bodyWidthOf(readXml(t, 'Contents/section0.xml').root);
  assert.ok(width > 0 && width < 60000);
  const {pkg} = buildReport(t, {...DEMO_DATA, discuss: [{embed: doc, name: 'a.hwpx'}]});
  const sec = readXml(reopen(pkg), 'Contents/section0.xml').root;
  const tbl = [...walk(sec)].filter(n => n.name === 'hp:tbl').find(x => textOf(x).includes(DOC.cells[0]));
  assert.ok(Number(kid(tbl, 'hp:sz').attrs.width) <= width);
  assert.equal(fitWidth(tbl, width), false);
});

test('embedDoc 결과: 쪽 설정만 든 첫 문단·끝 빈 문단은 넣지 않는다', () => {
  const t = blank();
  const head = readXml(t, 'Contents/header.xml');
  const {nodes, lost, tables} = embedDoc(head, makeDiscussDoc());
  assert.equal(tables, 1);
  assert.deepEqual(lost, ['그림']);
  assert.equal(textOf(nodes[0]), DOC.title);
  assert.equal(nodes.length, 4); // 제목·요지·표·번호 문단(그림만 있던 문단·끝 빈 문단 빠짐)
  assert.equal(textOf(nodes.at(-1)), DOC.numbered);
});
