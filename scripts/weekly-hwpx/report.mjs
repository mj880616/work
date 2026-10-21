// WEEKLY-한글초안 시제품: 주간보고 .hwpx ↔ 보고 자료(JSON) 변환.
//
// 보고 자료 모양(공개 저장소라 예시는 자리표시만):
// {
//   title: '○○팀 주간보고', date: '2026년 1월 5일(월)',
//   requests: [{day: '1.7.(수)', items: [{what: '10:00 / 행사 A / 장소 A', who: ['참석자 A']}]}],
//   schedule: ['- 일정 A'],                       // 1. 요청사항 › 2) 주요 일정 아래 바탕글 줄
//   summary: [{area: ['사업영역 A'], rows: [      // 2. 기본·영역·의제 사업 › 1) 요약 표
//     {task: ['세부 과제 A-1'], progress: ['- 진행 A', {text: '- 바뀐 줄', changed: true}], owner: ['담당 A']},
//     {task: null, progress: [...], owner: null}, // null = 위 칸과 합친 칸(세로 병합)
//   ]}],
// }
// 줄은 글자 또는 {text, changed}. changed 줄은 양식 안의 "바뀐 글" 글자 모양(같은 크기·글꼴의 파란 글씨)으로 쓴다.
import {el, clone, kid, kids, walk, textOf} from './xml.mjs';
import {readXml, setXml, clonePkg} from './hwpx.mjs';
import {readPrototypes, renumber, REQUEST_HEAD, SUMMARY_HEAD} from './template.mjs';

export const CHANGED_COLOR = '#0000FF';
export const lineText = line => (typeof line === 'string' ? line : line.text);
export const isChanged = line => typeof line === 'object' && line !== null && !!line.changed;

// ── 읽기 ─────────────────────────────────────────────────────────────
const cellLines = tc => kids(kid(tc, 'hp:subList'), 'hp:p').map(p => textOf(p).replace(/\s+$/, ''));
const trimLines = lines => { const out = [...lines]; while (out.length && !out[out.length - 1].trim()) out.pop(); while (out.length && !out[0].trim()) out.shift(); return out; };
const addr = tc => ({row: Number(kid(tc, 'hp:cellAddr').attrs.rowAddr), col: Number(kid(tc, 'hp:cellAddr').attrs.colAddr), rs: Number(kid(tc, 'hp:cellSpan').attrs.rowSpan), cs: Number(kid(tc, 'hp:cellSpan').attrs.colSpan)});

// 표를 논리 열(머리 칸 = 열)로 읽는다. → {head:[글], rows:[[{lines, start, rs}|null]]} (null = 위 칸에 합쳐진 자리)
export function readTable(tbl) {
  const trs = kids(tbl, 'hp:tr');
  const headCells = kids(trs[0], 'hp:tc').map(tc => ({...addr(tc), lines: cellLines(tc)}));
  const logical = col => headCells.findIndex(h => col >= h.col && col < h.col + h.cs);
  const rows = trs.slice(1).map(() => Array(headCells.length).fill(null));
  for (const tr of trs.slice(1)) {
    for (const tc of kids(tr, 'hp:tc')) {
      const a = addr(tc);
      const i = logical(a.col);
      if (i < 0 || a.row < 1) continue;
      const slot = rows[a.row - 1];
      if (slot[i]) slot[i].lines.push(...cellLines(tc)); // 숨은 좁은 열 등으로 한 논리 열에 칸이 둘이면 이어 붙인다
      else slot[i] = {lines: cellLines(tc), rs: a.rs, start: true};
    }
  }
  return {head: headCells.map(h => h.lines.join('').trim()), rows};
}

export function findTables(pkg) {
  const sec = readXml(pkg, 'Contents/section0.xml');
  const found = {};
  for (const n of walk(sec.root)) {
    if (n.name !== 'hp:tbl') continue;
    const t = readTable(n);
    if (!found.request && REQUEST_HEAD.every((h, i) => t.head[i] === h)) found.request = t;
    if (!found.summary && SUMMARY_HEAD.every((h, i) => t.head[i] === h)) found.summary = t;
  }
  return found;
}

export function summaryFromTable(t) {
  const areas = [];
  let area = null;
  for (const row of t.rows) {
    const [a, task, progress, owner] = row;
    if (a || !area) { area = {area: trimLines(a?.lines ?? ['']), rows: []}; areas.push(area); }
    area.rows.push({task: task ? trimLines(task.lines) : null, progress: progress ? trimLines(progress.lines) : [], owner: owner ? trimLines(owner.lines) : null});
  }
  return areas;
}

export function requestsFromTable(t) {
  const days = [];
  for (const [day, what, who] of t.rows) {
    if (day || !days.length) days.push({day: trimLines(day?.lines ?? ['']).join(' '), items: []});
    const item = {what: trimLines(what?.lines ?? []).join(' '), who: trimLines(who?.lines ?? [])};
    if (item.what || item.who.length) days[days.length - 1].items.push(item);
  }
  return days.filter(d => d.day || d.items.length);
}

export function readReport(pkg) {
  const {request, summary} = findTables(pkg);
  if (!summary) throw new Error('요약 표(사업영역 | 세부 과제 | 진행 상황 및 이후 계획 | 담당 팀원)를 찾지 못함');
  return {requests: request ? requestsFromTable(request) : [], summary: summaryFromTable(summary)};
}

// ── 쓰기 ─────────────────────────────────────────────────────────────
// "바뀐 글" 글자 모양: 표 칸 글자 모양과 높이·글꼴이 같고 색만 파란 것(양식에 이미 있는 것만 쓴다. 없으면 표시 없이 씀).
export function findChangedCharPr(header, baseId) {
  const chars = [...walk(header.root)].filter(n => n.name === 'hh:charPr');
  const base = chars.find(c => c.attrs.id === baseId);
  if (!base) return null;
  const font = c => JSON.stringify(kid(c, 'hh:fontRef')?.attrs ?? {});
  const hit = chars.find(c => c !== base && c.attrs.textColor?.toUpperCase() === CHANGED_COLOR && c.attrs.height === base.attrs.height && font(c) === font(base));
  return hit?.attrs.id ?? null;
}

function paragraph(proto, line, changedCharPr) {
  const p = el('hp:p', {...proto.attrs});
  const baseRun = kids(proto, 'hp:run').find(r => !r.children.some(c => c.name === 'hp:secPr')) ?? kids(proto, 'hp:run')[0];
  const text = line == null ? '' : lineText(line);
  const charPr = isChanged(line) && changedCharPr ? changedCharPr : baseRun.attrs.charPrIDRef;
  p.children.push(el('hp:run', {charPrIDRef: charPr}, text ? [el('hp:t', {}, [{text}])] : []));
  return p;
}
function titleParagraph(proto, text) {
  const p = clone(proto);
  const runs = kids(p, 'hp:run');
  const last = runs[runs.length - 1];
  if (text) last.children.push(el('hp:t', {}, [{text}]));
  return p;
}

function tableProto(anchor) {
  const tbl = [...walk(anchor)].find(n => n.name === 'hp:tbl');
  const [, body] = kids(tbl, 'hp:tr');
  return {tbl, cells: kids(body, 'hp:tc'), cellPara: kids(kid(kids(body, 'hp:tc')[0], 'hp:subList'), 'hp:p')[0]};
}

function cell(protoCell, row, col, rowSpan, lines, changedCharPr) {
  const tc = clone(protoCell);
  const sub = kid(tc, 'hp:subList');
  const pProto = kids(sub, 'hp:p')[0];
  const list = lines && lines.length ? lines : [''];
  sub.children = list.map(line => paragraph(pProto, line, changedCharPr));
  kid(tc, 'hp:cellAddr').attrs = {colAddr: String(col), rowAddr: String(row)};
  kid(tc, 'hp:cellSpan').attrs = {colSpan: '1', rowSpan: String(rowSpan)};
  return tc;
}

// grid: [[{lines, rs}|null]] (null = 위 칸에 합쳐짐) → 견본 표 복제본
function fillTable(anchor, grid, changedCharPr) {
  const out = clone(anchor);
  const {tbl, cells} = tableProto(out);
  const [head] = kids(tbl, 'hp:tr');
  const trs = grid.map((row, r) => el('hp:tr', {}, row.map((c, col) => (c ? cell(cells[col], r + 1, col, c.rs, c.lines, changedCharPr) : null)).filter(Boolean)));
  tbl.children = tbl.children.filter(c => c.name !== 'hp:tr').concat([head, ...trs]);
  tbl.attrs.rowCnt = String(grid.length + 1);
  return out;
}

// 합친 칸(null) 줄 수 세기: 위에서 시작한 칸의 rs = 1 + 아래 null 수
function spans(column) {
  const out = column.map(c => (c ? {...c, rs: 1} : null));
  let open = -1;
  out.forEach((c, i) => { if (c) open = i; else if (open >= 0) out[open].rs++; else out[i] = {lines: [], rs: 1}; });
  return out;
}

export function summaryGrid(summary) {
  const cols = [[], [], [], []];
  for (const area of summary) {
    area.rows.forEach((row, i) => {
      cols[0].push(i === 0 ? {lines: area.area} : null);
      cols[1].push(row.task === null ? null : {lines: row.task});
      cols[2].push({lines: row.progress});
      cols[3].push(row.owner === null ? null : {lines: row.owner});
    });
  }
  if (!cols[0].length) return [[{lines: [], rs: 1}, {lines: [], rs: 1}, {lines: [], rs: 1}, {lines: [], rs: 1}]];
  const fixed = cols.map(spans);
  return fixed[0].map((_, r) => fixed.map(c => c[r]));
}

export function requestGrid(requests) {
  const rows = [];
  for (const day of requests) {
    const items = day.items.length ? day.items : [{what: '', who: []}];
    items.forEach((item, i) => rows.push([i === 0 ? {lines: [day.day]} : null, {lines: [item.what]}, {lines: item.who}]));
  }
  if (!rows.length) rows.push([{lines: []}, {lines: []}, {lines: []}]);
  const cols = [0, 1, 2].map(c => spans(rows.map(r => r[c])));
  return rows.map((_, r) => cols.map(c => c[r]));
}

// 빈 서식 + 보고 자료 → .hwpx 묶음. 글자 모양·문단 모양·표 테두리는 빈 서식의 것만 쓴다(새로 만들지 않음).
export function buildReport(template, data, {sectionTitles = DEFAULT_SECTIONS} = {}) {
  const pkg = clonePkg(template);
  const {sec, protos} = readPrototypes(pkg);
  const header = readXml(pkg, 'Contents/header.xml');
  const cellCharPr = kids(tableProto(protos.summaryTable).cellPara, 'hp:run')[0]?.attrs.charPrIDRef;
  const changed = findChangedCharPr(header, cellCharPr);
  const S = sectionTitles;
  const body = [
    titleParagraph(protos.title, data.title ?? ''),
    paragraph(protos.body, data.date ? `■ 일시 : ${data.date}` : ''),
    paragraph(protos.body, ''),
    paragraph(protos.big, S.requests),
    paragraph(protos.small, S.requestTable),
    fillTable(protos.requestTable, requestGrid(data.requests ?? []), changed),
    paragraph(protos.small, S.schedule),
    ...(data.schedule?.length ? data.schedule.map(line => paragraph(protos.body, line, null)) : [paragraph(protos.body, '')]),
    paragraph(protos.big, S.work),
    paragraph(protos.small, S.summaryTable),
    fillTable(protos.summaryTable, summaryGrid(data.summary ?? []), changed),
    paragraph(protos.body, ''),
  ];
  sec.root.children = body;
  renumber(sec.root);
  setXml(pkg, 'Contents/section0.xml', sec);
  return {pkg, changedCharPr: changed};
}

// 양식 번호·제목 글(공개 문서 hwp-style-map.md의 번호 체계를 따른 양식 글자).
export const DEFAULT_SECTIONS = Object.freeze({
  requests: '1. 요청사항', requestTable: '1) 집회/행사 참가 요청', schedule: '2) 주요 일정',
  work: '2. 기본․영역․의제 사업', summaryTable: '1) 요약',
});

// 보고 자료 안의 모든 글(검사용)
export function reportTexts(data) {
  const out = [data.title, data.date, ...(data.schedule ?? [])];
  for (const d of data.requests ?? []) { out.push(d.day); for (const i of d.items) out.push(i.what, ...i.who); }
  for (const a of data.summary ?? []) { out.push(...a.area); for (const r of a.rows) out.push(...(r.task ?? []), ...r.progress.map(lineText), ...(r.owner ?? [])); }
  return out.filter(Boolean);
}
