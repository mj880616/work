// WEEKLY-한글초안 시제품: 표 칸 높이·표 크기 계산.
//
// 1단계 시연본을 한글에서 열고 사용자가 고친 판(2026-10-21)과 비교해 보니, 칸 높이를 견본 칸에서 그대로 베껴 와서
// 사업영역(세로 병합) 칸이 아주 길게 늘어났다. 한글은 칸 높이를 "최소 높이"로 받아 글이 넘치면 늘리지만 줄이지는 않는다.
// 그래서 칸 높이는 글 양으로 다시 계산하고, 조금 모자라게 잡는다(모자라면 한글이 늘림, 넘치면 빈칸이 남음).
//
// 계산 규칙(사용자가 고친 판의 줄 배치 정보 linesegarray에서 확인):
//   칸 높이 = 위·아래 안쪽 여백 + Σ(줄 높이) + (줄 수 − 1) × 줄 사이 간격 + Σ(문단 위·아래 간격)
//   줄 높이 = 글자 크기, 줄 사이 간격 = 글자 크기 × (줄간격% − 100)/100. 예: 표내부 10pt 150%, 여백 285+285 → 1줄 1570, 2줄 3070.
//   줄 수 = ⌈글 폭 ÷ (칸 너비 − 좌우 안쪽 여백 − 문단 좌우 여백)⌉. 글 폭은 글자 종류별 폭(글자 크기 1에 대한 비율)의 합.
//   세로로 합친 칸 = 걸친 줄 높이의 합. 줄 높이 = 그 줄의 합치지 않은 칸 중 가장 큰 값. 합친 칸 글이 더 길면 마지막 줄을 늘림.
//   표 크기(hp:sz) = 열 너비 합 × 줄 높이 합.
import {kid, kids, walk, textOf} from './xml.mjs';

// 글자 종류별 폭(글자 크기 대비). 사용자가 고친 판 2개 + 팀 확정본의 표 칸 1,418문단 줄 수에 맞춘 값(맞음 98.6%, 많게 셈 0.4%).
export const GLYPH_WIDTH = Object.freeze({hangul: 0.9, digit: 0.43, latin: 0.5, space: 0.45, wide: 0.6, other: 0.3});
const glyphClass = c => (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(c) ? 'hangul' : /[0-9]/.test(c) ? 'digit' : /[A-Za-z]/.test(c) ? 'latin' : c === ' ' ? 'space'
  : /[‐-㏿＀-￯]/.test(c) ? 'wide' : 'other');
export const textWidth = (text, charHeight) => [...String(text)].reduce((sum, c) => sum + GLYPH_WIDTH[glyphClass(c)] * charHeight, 0);
export const estimateLines = (text, charHeight, avail) => Math.max(1, Math.ceil(textWidth(text, charHeight) / Math.max(1, avail)));

// 머리(header.xml)에서 글자 크기·문단 간격 찾기
export function headerMetrics(header) {
  const chars = new Map([...walk(header.root)].filter(n => n.name === 'hh:charPr').map(c => [c.attrs.id, Number(c.attrs.height) || 1000]));
  const paras = new Map([...walk(header.root)].filter(n => n.name === 'hh:paraPr').map(p => {
    const first = name => [...walk(p)].find(n => n.name === name);
    const val = name => Number(first(name)?.attrs.value ?? 0);
    const ls = first('hh:lineSpacing');
    return [p.attrs.id, {lineType: ls?.attrs.type ?? 'PERCENT', line: Number(ls?.attrs.value ?? 160), left: val('hc:left'), right: val('hc:right'), prev: val('hc:prev'), next: val('hc:next')}];
  }));
  return {charHeight: id => chars.get(id) ?? 1000, para: id => paras.get(id) ?? {lineType: 'PERCENT', line: 160, left: 0, right: 0, prev: 0, next: 0}};
}

function paragraphHeight(p, width, metrics) {
  const run = kids(p, 'hp:run')[0];
  const ch = metrics.charHeight(run?.attrs.charPrIDRef);
  const pp = metrics.para(p.attrs.paraPrIDRef);
  const gap = pp.lineType === 'PERCENT' ? Math.round(ch * (pp.line - 100) / 100) : pp.line;
  const lines = estimateLines(textOf(p), ch, width - pp.left - pp.right);
  return {lines, height: lines * ch + lines * gap + pp.prev + pp.next, gap};
}

// 칸 하나의 글에 필요한 높이
export function cellContentHeight(tc, tbl, metrics) {
  const width = Number(kid(tc, 'hp:cellSz').attrs.width);
  const margin = tc.attrs.hasMargin === '1' ? kid(tc, 'hp:cellMargin').attrs : (kid(tbl, 'hp:inMargin')?.attrs ?? {});
  const [l, r, t, b] = ['left', 'right', 'top', 'bottom'].map(k => Number(margin[k] ?? 0));
  let height = 0;
  let lastGap = 0;
  for (const p of kids(kid(tc, 'hp:subList'), 'hp:p')) { const h = paragraphHeight(p, width - l - r, metrics); height += h.height; lastGap = h.gap; }
  return t + b + height - lastGap; // 마지막 줄 아래 간격은 넣지 않는다
}

// 표 하나의 칸 높이·표 크기를 다시 계산(제자리에서 고침)
export function layoutTable(tbl, metrics) {
  const cells = kids(tbl, 'hp:tr').flatMap(tr => kids(tr, 'hp:tc')).map(tc => {
    const a = kid(tc, 'hp:cellAddr').attrs, s = kid(tc, 'hp:cellSpan').attrs;
    return {tc, row: Number(a.rowAddr), col: Number(a.colAddr), rs: Number(s.rowSpan), cs: Number(s.colSpan), need: cellContentHeight(tc, tbl, metrics)};
  });
  const rowCnt = Number(tbl.attrs.rowCnt), colCnt = Number(tbl.attrs.colCnt);
  const rowH = new Array(rowCnt).fill(0);
  for (const c of cells) if (c.rs === 1) rowH[c.row] = Math.max(rowH[c.row], c.need);
  for (const c of cells.filter(x => x.rs > 1).sort((x, y) => x.rs - y.rs)) {
    const sum = rowH.slice(c.row, c.row + c.rs).reduce((a, b) => a + b, 0);
    if (c.need > sum) rowH[c.row + c.rs - 1] += c.need - sum;
  }
  for (const c of cells) kid(c.tc, 'hp:cellSz').attrs.height = String(rowH.slice(c.row, c.row + c.rs).reduce((a, b) => a + b, 0));
  const colW = new Array(colCnt).fill(null);
  for (const c of cells) if (c.cs === 1 && colW[c.col] === null) colW[c.col] = Number(kid(c.tc, 'hp:cellSz').attrs.width);
  const firstRowWidth = cells.filter(c => c.row === 0).reduce((a, c) => a + Number(kid(c.tc, 'hp:cellSz').attrs.width), 0);
  const width = colW.every(w => w !== null) ? colW.reduce((a, b) => a + b, 0) : firstRowWidth;
  Object.assign(kid(tbl, 'hp:sz').attrs, {width: String(width), height: String(rowH.reduce((a, b) => a + b, 0))});
  return {rowHeights: rowH, width};
}
