// PRODUCT-판매준비범용화한글양식 작업 1(S62-10): 왕복 시험용 합성 한글 파일(.hwpx). 실명·업무 내용 없이 자리표시 글만.
// 바탕은 WEEKLY 가짜 보고서(scripts/weekly-hwpx/fixture.mjs: 여러 스타일·글자 크기·굵게, 행·열 합친 칸이 든 표 여럿)이고,
// 여기에 ① 머리말·꼬리말 ② 여러 쪽에 걸치는 긴 표(행 합친 칸 포함) ③ 한 문단 안에 글자 모양이 섞인 줄을 더한다.
// 브라우저 시험이 이 .hwpx를 엔진으로 .hwp로 저장해 '원본 HWP'로 쓴다(tests/app-e2e/hwp-roundtrip.spec.mjs).
import {readFileSync} from 'node:fs';
import {el, kid, kids, walk, clone} from '../../app/weekly-hwpx/xml.mjs';
import {openHwpx, packHwpx, readXml, setXml} from '../../app/weekly-hwpx/hwpx.mjs';
import {makeFakeReport} from '../weekly-hwpx/fixture.mjs';
import {zlib, SAMPLE} from '../weekly-hwpx/cli.mjs';

export const LONG_ROWS = 60;
// 고칠 칸(왕복 중 '칸 하나 고치기'): 긴 표의 둘째 행 셋째 열.
export const EDIT_TARGET = Object.freeze({row: 1, col: 2, text: '왕복 시험으로 고친 칸'});

const SUB = (width, height) => ({id: '', textDirection: 'HORIZONTAL', lineWrap: 'BREAK', vertAlign: 'TOP', linkListIDRef: '0', linkListNextIDRef: '0', textWidth: String(width), textHeight: String(height), hasTextRef: '0', hasNumRef: '0'});
const P = (style, runs) => el('hp:p', {id: '0', paraPrIDRef: style, styleIDRef: style, pageBreak: '0', columnBreak: '0', merged: '0'}, runs);
const R = (charPr, text) => el('hp:run', {charPrIDRef: String(charPr)}, text ? [el('hp:t', {}, [{text}])] : []);

export function makeRoundtripPackage() {
  const pkg = makeFakeReport(openHwpx(new Uint8Array(readFileSync(SAMPLE)), zlib));
  const sec = readXml(pkg, 'Contents/section0.xml');
  const paras = kids(sec.root, 'hp:p');
  // ① 머리말·꼬리말: 첫 문단(구역 정의가 든 문단)의 첫 run에 조판 부호로 단다.
  const firstRun = kids(paras[0], 'hp:run')[0];
  firstRun.children.push(
    el('hp:ctrl', {}, [el('hp:header', {id: '1', applyPageType: 'BOTH'}, [el('hp:subList', SUB(42520, 4252), [P('0', [R(10, '시험 머리말 — 합성 문서')])])])]),
    el('hp:ctrl', {}, [el('hp:footer', {id: '2', applyPageType: 'BOTH'}, [el('hp:subList', SUB(42520, 4252), [P('0', [R(11, '시험 꼬리말')])])])]),
  );
  // 가짜 보고서의 표 하나를 본으로 긴 표를 만든다(칸 모양·테두리 번호를 그대로 쓰려고).
  const proto = [...walk(sec.root)].find(n => n.name === 'hp:tbl');
  const protoCell = [...walk(proto)].find(n => n.name === 'hp:tc');
  const cell = (row, col, rowSpan, width, text) => {
    const c = clone(protoCell);
    c.attrs.header = row === 0 ? '1' : '0';
    kid(c, 'hp:cellAddr').attrs = {colAddr: String(col), rowAddr: String(row)};
    kid(c, 'hp:cellSpan').attrs = {colSpan: '1', rowSpan: String(rowSpan)};
    kid(c, 'hp:cellSz').attrs.width = String(width);
    const sub = kid(c, 'hp:subList');
    const p = clone(kids(sub, 'hp:p')[0]);
    const run = kids(p, 'hp:run')[0];
    run.children = [el('hp:t', {}, [{text}])];
    p.children = [run];
    sub.children = [p];
    return c;
  };
  const W = [6000, 6000, 26000, 9900];
  const rows = [['구분', '번호', '내용', '비고'].map((t, i) => cell(0, i, 1, W[i], t))];
  for (let r = 1; r <= LONG_ROWS; r++) {
    const row = [];
    if ((r - 1) % 5 === 0) row.push(cell(r, 0, Math.min(5, LONG_ROWS - r + 1), W[0], `묶음 ${Math.ceil(r / 5)}`));
    row.push(cell(r, 1, 1, W[1], String(r)), cell(r, 2, 1, W[2], `시험 줄 ${r}: 여러 쪽에 걸치는 표의 칸`), cell(r, 3, 1, W[3], r % 2 ? '가' : '나'));
    rows.push(row);
  }
  const long = clone(proto);
  long.attrs.rowCnt = String(rows.length);
  long.attrs.colCnt = '4';
  long.attrs.id = '9001';
  kid(long, 'hp:sz').attrs.width = String(W.reduce((a, b) => a + b, 0));
  kid(long, 'hp:sz').attrs.height = String(1570 * rows.length);
  long.children = [...long.children.filter(c => c.name !== 'hp:tr'), ...rows.map(cs => el('hp:tr', {}, cs))];
  const holder = P('4', [R(4, '')]);
  kids(holder, 'hp:run')[0].children = [long];
  // ③ 한 문단 안에 글자 모양 섞기(바탕글·굵은 작은 제목 크기·파란 글씨).
  const mixed = P('0', [R(0, '보통 글, '), R(4, '굵은 글, '), R(13, '파란 글씨'), R(0, '로 끝나는 문단.')]);
  // 긴 표를 맨 앞(제목·일시 뒤)에 둬서 '칸 하나 고치기' 대상이 첫 표가 되게 한다.
  sec.root.children.splice(3, 0, P('4', [R(4, '0) 합성 시험 표')]), holder, mixed);
  setXml(pkg, 'Contents/section0.xml', sec);
  return pkg;
}

export const makeRoundtripHwpx = () => packHwpx(makeRoundtripPackage(), zlib);
export {zlib};
