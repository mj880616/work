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
//   requestNote: '※ …',                          // 요청 표 아래 표시 줄(선택, 예: 직전 주 그대로라 이번 주 확인 필요)
//   details: [{heading: '(1) 회의 A', box: [{label: '제목', lines: ['회의 A']}, {label: '내용', lines: ['- 내용 A']}]}],
//   rallies: [{when: [], name: [], attend: []}],  // 3. 투쟁 사업 › 1) 집회·농성 등
//   sites: [{org: ['조직 A'], status: ['- 현황 A']}],  // 3. › 2) 투쟁 사업장 현황
//   orgs: [{org: ['조직 A'], status: ['- 소식 A']}],   // 4. 산하조직 현황 › 1) 요약
//   orgNotes: ['- 참고 A'],                      // 4. › 2) 참고자료 아래 바탕글 줄
//   calendar: [{day: '1.7.(수)', items: [{what: '10:00 / 일정 A / 장소 A', who: ['참석자 A']}]}],  // 5. 주요 일정(요청 표와 같은 모양)
//   calendarNotes: ['※ 1.8.(목) 담당 A 휴가'],
// }
// 줄은 글자 또는 {text, changed}. changed 줄은 양식 안의 "바뀐 글" 글자 모양(같은 크기·글꼴의 파란 글씨)으로 쓴다.
import {el, clone, kid, kids, walk, textOf} from './xml.mjs';
import {readXml, setXml, clonePkg} from './hwpx.mjs';
import {readPrototypes, renumber, isBoxTable, FORM_LABELS, BOX_LABELS, REQUEST_HEAD, SUMMARY_HEAD, RALLY_HEAD, SITE_HEAD, ORG_HEAD, SCHEDULE_HEAD} from './template.mjs';
import {headerMetrics, layoutTable} from './layout.mjs';

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
      else slot[i] = {lines: cellLines(tc), rs: a.rs, start: true, border: tc.attrs.borderFillIDRef};
    }
  }
  return {head: headCells.map(h => h.lines.join('').trim()), rows};
}

const TABLE_KEYS = Object.freeze({request: REQUEST_HEAD, summary: SUMMARY_HEAD, rally: RALLY_HEAD, site: SITE_HEAD, org: ORG_HEAD, schedule: SCHEDULE_HEAD});
export function findTables(pkg) {
  const sec = readXml(pkg, 'Contents/section0.xml');
  const found = {boxes: []};
  for (const p of kids(sec.root, 'hp:p')) {
    for (const n of walk(p)) {
      if (n.name !== 'hp:tbl') continue;
      if (isBoxTable(n)) { found.boxes.push({anchor: p, tbl: n}); continue; }
      const t = readTable(n);
      for (const [key, head] of Object.entries(TABLE_KEYS)) if (!found[key] && head.every((h, i) => t.head[i] === h) && t.head.length === head.length) found[key] = t;
    }
  }
  found.top = kids(sec.root, 'hp:p');
  return found;
}

// 2열 표(조직명 | 현황 등) → [{org, status, borders, src}]. borders = 칸마다 확정본의 테두리 번호(양식의 줄별 굵은 구분선·
// 바깥 테두리를 그대로 따르기 위해), src = 확정본 표에서 몇 번째 줄인지(머리 줄 뺌).
export function pairsFromTable(t) {
  return t.rows.map(([a, b], src) => ({org: trimLines(a?.lines ?? []), status: trimLines(b?.lines ?? []), borders: [a?.border ?? null, b?.border ?? null], src}))
    .filter(r => r.org.length || r.status.length);
}
export function ralliesFromTable(t) {
  return t.rows.map(([a, b, c]) => ({when: trimLines(a?.lines ?? []), name: trimLines(b?.lines ?? []), attend: trimLines(c?.lines ?? [])})).filter(r => r.when.length || r.name.length || r.attend.length);
}
// 회의 결과 상자 → {heading, box:[{label, lines}]}. 제목 줄은 상자가 든 문단의 글, 없으면 바로 앞 "(n)" 문단.
export function detailsFrom(found) {
  const own = p => kids(p, 'hp:run').flatMap(r => kids(r, 'hp:t')).map(t => textOf(el('x', {}, [t]))).join('').trim();
  return found.boxes.filter(b => !found.boxes.some(o => o !== b && [...walk(o.tbl)].includes(b.tbl))).map(({anchor, tbl}) => {
    let heading = own(anchor);
    if (!heading) {
      const i = found.top.indexOf(anchor);
      for (let j = i - 1; j >= 0 && j >= i - 2; j--) { const t = own(found.top[j]); if (/^\(\d+\)/.test(t)) { heading = t; break; } if (t) break; }
    }
    const box = kids(tbl, 'hp:tr').map(tr => { const [l, c] = kids(tr, 'hp:tc'); return {label: cellLines(l).join('').trim(), lines: trimLines(cellLines(c))}; });
    return {heading, box};
  });
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
  const found = findTables(pkg);
  if (!found.summary) throw new Error('요약 표(사업영역 | 세부 과제 | 진행 상황 및 이후 계획 | 담당 팀원)를 찾지 못함');
  const first = found.top.find(p => !kids(p, 'hp:run').some(r => r.children.some(c => c.name === 'hp:tbl')) && textOf(p).trim());
  return {
    title: first ? textOf(first).trim() : '',
    requests: found.request ? requestsFromTable(found.request) : [],
    summary: summaryFromTable(found.summary),
    details: detailsFrom(found),
    rallies: found.rally ? ralliesFromTable(found.rally) : [],
    sites: found.site ? pairsFromTable(found.site) : [],
    orgs: found.org ? pairsFromTable(found.org) : [],
    calendar: found.schedule ? requestsFromTable(found.schedule) : [],
  };
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

function cell(protoCell, row, col, rowSpan, lines, changedCharPr, border) {
  const tc = clone(protoCell);
  if (border) tc.attrs.borderFillIDRef = border;
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
  const trs = grid.map((row, r) => el('hp:tr', {}, row.map((c, col) => (c ? cell(cells[col], r + 1, col, c.rs, c.lines, changedCharPr, c.border) : null)).filter(Boolean)));
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
// 병합 없는 표: rows = [[줄 목록, …]]
export function plainGrid(rows, cols) {
  const out = rows.map(r => r.map(lines => ({lines, rs: 1})));
  return out.length ? out : [Array.from({length: cols}, () => ({lines: [], rs: 1}))];
}

// 산하조직·투쟁 사업장 표(2열): 줄마다 확정본의 테두리를 따른다(2단계 — 확정본은 조직 묶음 사이에 굵은 선, 같은 조직이
// 여러 줄이면 위 선 없음, 바깥 왼쪽·오른쪽은 굵은 선). 테두리 번호는 양식 머리(header.xml)에 있는 것만 쓰고 새로 만들지 않는다.
// 내 담당 조직만 남기면 위 줄이 빠진 줄이 생기는데(cutAbove), 그 줄의 위 선이 '없음'이면 위 선만 다른 양식 안의 테두리로 바꾼다
// (그런 테두리가 양식에 없으면 그대로 둠). 테두리 정보가 없는 줄(사람이 더한 줄 등)은 견본 줄 테두리를 쓴다.
export function borderTools(header) {
  const fills = new Map([...walk(header.root)].filter(n => n.name === 'hh:borderFill').map(b => [b.attrs.id, b]));
  const sig = (b, skip) => JSON.stringify([Object.entries(b.attrs).filter(([k]) => k !== 'id'), b.children.filter(c => c.name !== skip).map(c => toSig(c))]);
  const toSig = n => ('text' in n ? n.text : [n.name, Object.entries(n.attrs), n.children.map(toSig)]);
  const top = b => kid(b, 'hh:topBorder')?.attrs ?? {};
  return {
    known: id => !!id && fills.has(id),
    closeTop(id) {
      const b = fills.get(id);
      if (!b || top(b).type !== 'NONE') return id;
      const want = sig(b, 'hh:topBorder');
      const hits = [...fills.values()].filter(o => o !== b && top(o).type && top(o).type !== 'NONE' && sig(o, 'hh:topBorder') === want);
      const bottom = kid(b, 'hh:bottomBorder')?.attrs ?? {};
      return (hits.find(o => top(o).type === bottom.type && top(o).width === bottom.width) ?? hits[0])?.attrs.id ?? id;
    },
  };
}
export function pairGrid(list, tools) {
  const border = (row, i) => {
    const id = row.borders?.[i];
    if (!tools?.known(id)) return undefined;
    return row.cutAbove ? tools.closeTop(id) : id;
  };
  const out = list.map(row => [{lines: row.org, rs: 1, border: border(row, 0)}, {lines: row.status, rs: 1, border: border(row, 1)}]);
  return out.length ? out : [[{lines: [], rs: 1}, {lines: [], rs: 1}]];
}

// 회의 결과 상자: 견본(1줄 2칸)을 칸 이름 수만큼 늘린다.
function fillBox(anchor, box, changedCharPr) {
  const out = clone(anchor);
  const tbl = [...walk(out)].find(n => n.name === 'hp:tbl');
  const [proto] = kids(tbl, 'hp:tr');
  const [labelCell, bodyCell] = kids(proto, 'hp:tc');
  const rows = box.length ? box : [{label: '', lines: []}];
  const trs = rows.map((row, r) => el('hp:tr', {}, [cell(labelCell, r, 0, 1, row.label ? [row.label] : [], null), cell(bodyCell, r, 1, 1, row.lines, changedCharPr)]));
  tbl.children = tbl.children.filter(c => c.name !== 'hp:tr').concat(trs);
  tbl.attrs.rowCnt = String(trs.length);
  return out;
}

// 빈 서식 + 보고 자료 → .hwpx 묶음. 글자 모양·문단 모양·표 테두리는 빈 서식의 것만 쓴다(새로 만들지 않음).
// 차례·빈 줄은 상집보고 확정본과 사용자가 한글에서 고친 판(2026-10-21)을 따른다: 제목 다음 빈 줄 → 일시 → 빈 줄, 요청 표 다음 빈 줄.
// 칸 높이·표 크기는 글 양으로 다시 계산한다(layout.mjs).
export function buildReport(template, data, {sectionTitles = DEFAULT_SECTIONS} = {}) {
  const pkg = clonePkg(template);
  const {sec, protos} = readPrototypes(pkg);
  const header = readXml(pkg, 'Contents/header.xml');
  const cellCharPr = kids(tableProto(protos.summaryTable).cellPara, 'hp:run')[0]?.attrs.charPrIDRef;
  const changed = findChangedCharPr(header, cellCharPr);
  const borders = borderTools(header);
  const S = sectionTitles;
  const blank = () => paragraph(protos.body, '');
  const lines = (proto, list) => (list?.length ? list.map(line => paragraph(proto, line, changed)) : [blank()]);
  const details = (data.details ?? []).flatMap(d => [paragraph(protos.small, d.heading ?? ''), fillBox(protos.boxTable, d.box ?? [], changed), blank()]);
  const body = [
    titleParagraph(protos.title, data.title ?? ''),
    blank(),
    paragraph(protos.body, data.date ? `■ 일시 : ${data.date}` : ''),
    blank(),
    paragraph(protos.big, S.requests),
    paragraph(protos.small, S.requestTable),
    fillTable(protos.requestTable, requestGrid(data.requests ?? []), changed),
    ...(data.requestNote ? [paragraph(protos.note, {text: data.requestNote, changed: true}, changed)] : []),
    paragraph(protos.small, ''), // 사용자가 한글에서 더한 빈 줄(요청 표와 "2) 주요 일정" 사이, 작은 제목 문단)
    paragraph(protos.small, S.schedule),
    ...lines(protos.body, data.schedule),
    paragraph(protos.big, S.work),
    paragraph(protos.small, S.summaryTable),
    fillTable(protos.summaryTable, summaryGrid(data.summary ?? []), changed),
    blank(),
    paragraph(protos.small, S.details),
    blank(),
    ...details,
    paragraph(protos.big, S.struggle),
    paragraph(protos.mid, S.rallyTable),
    fillTable(protos.rallyTable, plainGrid((data.rallies ?? []).map(r => [r.when, r.name, r.attend]), 3), changed),
    blank(),
    paragraph(protos.mid, S.siteTable),
    fillTable(protos.siteTable, pairGrid(data.sites ?? [], borders), changed),
    blank(),
    paragraph(protos.big, S.orgs),
    paragraph(protos.mid, S.orgTable),
    fillTable(protos.orgTable, pairGrid(data.orgs ?? [], borders), changed),
    blank(),
    paragraph(protos.mid, S.orgNotes),
    ...lines(protos.body, data.orgNotes),
    paragraph(protos.big, S.calendar),
    fillTable(protos.scheduleTable, requestGrid(data.calendar ?? []), changed),
    // 확정본처럼 표 아래 빈 줄 하나 뒤에 "※ 휴가" 줄(WEEKLY-주요일정: 확정본·개인본 6주치 모두 표 → 빈 줄 → ※ 줄).
    ...((data.calendarNotes ?? []).length ? [blank(), ...data.calendarNotes.map(line => paragraph(protos.note, line, changed))] : []),
    blank(),
  ];
  sec.root.children = body;
  renumber(sec.root);
  const metrics = headerMetrics(header);
  for (const tbl of [...walk(sec.root)].filter(n => n.name === 'hp:tbl')) layoutTable(tbl, metrics);
  setXml(pkg, 'Contents/section0.xml', sec);
  return {pkg, changedCharPr: changed};
}

// 양식 번호·제목 글(상집보고 차례 — 기획 문서 1.2절. 3·4절의 "1)"은 '중간 제목', 1·2절은 '작은 제목').
export const DEFAULT_SECTIONS = Object.freeze({
  requests: '1. 요청사항', requestTable: '1) 집회/행사 참가 요청', schedule: '2) 주요 일정',
  work: '2. 기본․영역․의제 사업', summaryTable: '1) 요약', details: '2) 세부 내용',
  struggle: '3. 투쟁 사업', rallyTable: '1) 집회·농성 등', siteTable: '2) 투쟁 사업장 현황',
  orgs: '4. 산하조직 현황', orgTable: '1) 요약', orgNotes: '2) 참고자료',
  calendar: '5. 주요 일정',
});

// 보고 자료 안의 모든 글(검사용)
export function reportTexts(data) {
  const out = [data.title, data.date, data.requestNote, ...(data.schedule ?? []), ...(data.orgNotes ?? []), ...(data.calendarNotes ?? [])];
  for (const d of [...(data.requests ?? []), ...(data.calendar ?? [])]) { out.push(d.day); for (const i of d.items) out.push(i.what, ...i.who); }
  for (const a of data.summary ?? []) { out.push(...a.area); for (const r of a.rows) out.push(...(r.task ?? []), ...r.progress.map(lineText), ...(r.owner ?? [])); }
  for (const d of data.details ?? []) { out.push(d.heading); for (const b of d.box ?? []) out.push(b.label, ...b.lines.map(lineText)); }
  for (const r of data.rallies ?? []) out.push(...r.when, ...r.name, ...r.attend);
  for (const r of [...(data.sites ?? []), ...(data.orgs ?? [])]) out.push(...r.org, ...r.status.map(lineText));
  return out.filter(Boolean).map(lineText);
}

// 빈 서식 검사용 원본 글 조각: 문장 전체 + 한글 3글자 이상 낱말(양식 글자에 들어 있는 낱말은 뺌). 빈 서식에 하나라도 남으면 실패.
const LABEL_TEXT = [...FORM_LABELS, ...BOX_LABELS].join(' ');
export const reportWords = report => {
  const texts = reportTexts(report).filter(t => !BOX_LABELS.includes(t));
  const words = texts.flatMap(t => t.split(/[^가-힣A-Za-z0-9]+/)).filter(w => /[가-힣]/.test(w) && [...w].length >= 3 && !LABEL_TEXT.includes(w));
  return [...new Set([...texts, ...words])];
};
