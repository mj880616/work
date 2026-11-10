// BIZ-기록하나로 B-4 ②(설계 docs/design/record-one.md 2-5·2-6·2-7 '2. 2) 주요 사업·회의결과'·4절): 2. 2) 주요 사업 '창' 순수 규칙 한 곳 — 화면·네트워크 없음.
// - 줄 = 그 주(월~일)에 걸친 사업 기록(app_business_records, 기간 기록 포함) + 그 주 사업 보고(app_meetings, 복사하지 않고 읽을 때 섞음).
// - 사업별로 묶는다(사업 나무 줄 = 사업영역 또는 세부 과제, 3단 사안은 그 세부 과제 줄로 — business-now-model.mjs rowSpaceMap). 활동 없는 사업은 빠진다.
// - 내부 정례·'늘 빼기' 종류와 한 줄 업데이트는 화면이 넘기기 전에 거른다(journal-meeting-kinds.js reportsMeeting, 한 줄 업데이트는 2. 1) 칸에만).
// - 보고용 표시(app_report_line_marks, section 'biz_detail')는 조직보고 창과 같은 이어짐 규칙(record-window-model.mjs markOf·nextMark)을 그대로 쓴다.
//   report_body = 보고에만 쓰는 글, choice 'out' = 이번 보고에서 빼기(다음 주에도 빠짐), detail 'oneline'|'full' = 사업 보고의 한 줄만 ↔ 상세 포함.
// - 상세 포함 기본값: 사업 보고에 결과 본문(전사 글, 없으면 예전 회의결과)이 있으면 'full', 없으면 한 줄. 사업 기록은 늘 한 줄.
import {markOf, nextMark, checkReportBody, cleanBody, dayText, lineId, overlaps} from './record-window-model.mjs';
import {oneLine} from './record-oneline.mjs';
import {rowSpaceMap, weekRange} from './business-now-model.mjs';
import {areaIdOf, isOneline, nextPlanLines} from './business-area-model.mjs';

export const SECTION = 'biz_detail';
export const BODY_LINES_MAX = 60; // 화면에 펼치는 결과 본문 줄 수 상한(한글 파일은 상한 없음)
export {nextMark, checkReportBody, dayText};

const seoulDay = value => { const t = Date.parse(String(value ?? '')); return Number.isFinite(t) ? new Date(t + 9 * 3600000).toISOString().slice(0, 10) : ''; };
// 결과 본문 = 전사 글, 없으면 예전 회의결과 기록(회의 화면과 같은 차례 — meeting-columns.js resultText).
export const resultText = m => (String(m?.transcript_text ?? '').trim() ? String(m.transcript_text) : String(m?.decisions ?? '').trim() ? String(m.decisions) : '');
// 본문 줄: 줄바꿈으로 나누고 줄마다 제어문자·겹친 띄어쓰기를 정리, 빈 줄은 뺀다(앞 들여쓰기 깊이는 번호 모양이 대신 말한다).
export const bodyLines = text => String(text ?? '').replace(/\r\n?/g, '\n').split('\n').map(cleanBody).filter(Boolean);

// 사업 나무 줄 이름: Map(표 줄 공간 id → {area, task, label, rank}). label = '사업영역 › 세부 과제'(사업영역 바로 아래면 사업영역만).
export function treeRows(tree) {
  const out = new Map();
  let area = null, rank = 0;
  const nameOf = p => String(p?.name || '').trim() || '이름 없는 사업영역';
  for (const n of Array.isArray(tree) ? tree : []) {
    const id = n?.project?.id;
    if (id == null) continue;
    if (n.depth === 0) { area = nameOf(n.project); out.set(String(id), {area, task: '', label: area, rank: rank++}); }
    else if (area != null && n.depth === 1) { const task = nameOf(n.project); out.set(String(id), {area, task, label: `${area} › ${task}`, rank: rank++}); }
  }
  return out;
}

// 사업 보고 → 줄 {kind:'meeting', key, space(사업 id, 없으면 ''), day, end_day:null, text(한 줄), body:[결과 본문 줄], plan:[다음 할 일]}.
// lineOf(meeting) = 보고 한 줄(주간보고 meetingLine 규칙). 날짜·글이 없거나 한 줄 업데이트면 null.
export function meetingItem(m, lineOf = x => String(x?.series_name || x?.title || '')) {
  const day = seoulDay(m?.meeting_at), text = cleanBody(lineOf(m));
  if (!m?.id || !day || !text || isOneline(m)) return null;
  return {kind: 'meeting', key: String(m.id), space: areaIdOf(m), day, end_day: null, at: String(m.meeting_at ?? ''), text, body: bodyLines(resultText(m)), plan: nextPlanLines(m.next_plan)};
}

const byDay = (a, b) => a.day.localeCompare(b.day) || (a.kind === b.kind ? 0 : a.kind === 'biz_record' ? -1 : 1) || String(a.at ?? '').localeCompare(String(b.at ?? '')) || a.text.localeCompare(b.text, 'ko') || a.key.localeCompare(b.key);
// 줄 하나에 그 주 표시를 입힌다. detail = 사업 보고이고 본문이 있을 때만 'full'이 될 수 있다(표시 없으면 'full' 기본).
export function lineOf(item, mark) {
  const canFull = item.kind === 'meeting' && Array.isArray(item.body) && item.body.length > 0;
  const base = canFull ? 'full' : 'oneline';
  const detail = canFull ? (mark?.detail === 'oneline' ? 'oneline' : mark?.detail === 'full' ? 'full' : base) : 'oneline';
  return {...item, id: lineId(item.kind, item.key), orig: item.text, text: mark?.report_body != null ? (oneLine(mark.report_body) || item.text) : item.text,
    edited: mark?.report_body != null, choice: mark?.choice ?? null, canFull, detail, base};
}
// [한 줄만 ↔ 상세 포함]이 바꿀 detail 값(기본값과 같아지면 null = 표시 지움).
export function toggledDetail(line) {
  if (!line?.canFull) return null;
  const next = line.detail === 'full' ? 'oneline' : 'full';
  return next === line.base ? null : next;
}

// 그 주 2. 2) 묶음. records = 사업 기록 줄(business-now-model.mjs bizRecordItem), meetings = 거른 사업 보고 행, tree = 활성 사업 나무, marks = section 'biz_detail' 표시 행.
// 돌려주는 값: [{space, label, known(나무에 있는 사업인가 — [+ 쓰기] 가능), shown:[줄], out:[줄]}] — 나무 차례, 나무에 없는 사업은 뒤('보관된 사업영역'),
// 사업영역을 달지 않은 보고는 맨 뒤('사업영역 없음'). 줄은 날짜 오름차순(같은 날이면 사업 기록 먼저).
export function detailGroups({week, records = [], meetings = [], tree = null, marks = [], lineOfMeeting} = {}) {
  const range = weekRange(week);
  if (!range) return [];
  const map = rowSpaceMap(tree), rows = treeRows(tree), groups = new Map();
  const recs = (Array.isArray(records) ? records : []).filter(r => r && r.kind === 'biz_record' && overlaps(r, range));
  const meets = (Array.isArray(meetings) ? meetings : []).map(m => meetingItem(m, lineOfMeeting)).filter(it => it && it.day >= range.from && it.day < range.to);
  for (const it of [...recs, ...meets]) {
    const space = it.space ? (map.get(String(it.space)) ?? String(it.space)) : '';
    if (!groups.has(space)) {
      const row = rows.get(space);
      groups.set(space, {space, label: row ? row.label : space ? '보관된 사업영역' : '사업영역 없음', known: !!row, rank: row ? row.rank : space ? 1e6 : 2e6, shown: [], out: []});
    }
    const line = lineOf(it, markOf(marks, SECTION, it.kind, it.key, week));
    groups.get(space)[line.choice === 'out' ? 'out' : 'shown'].push(line);
  }
  return [...groups.values()].sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, 'ko'))
    .map(({rank, ...g}) => ({...g, shown: g.shown.sort(byDay), out: g.out.sort(byDay)}));
}
// 보이는 줄 수(묶음 전체).
export const shownCount = groups => (Array.isArray(groups) ? groups : []).reduce((n, g) => n + g.shown.length, 0);
// 줄 글 '- 11.10. 글'(기간이면 '- 11.2.~12.5. 글').
export const lineText = l => `- ${[dayText(l.day, l.end_day), cleanBody(l.text)].filter(Boolean).join(' ')}`;

// ---- 한글 파일 2. 2)·[확정] 사진(B-4 ③·④) ----
// 본문 안 번호를 한 단계씩 내린다(docs/hwp-style-map.md 3절 차례: 1. → 1) → (1) → ①, 가. → 가) → (가)). 더 내릴 곳이 없으면 그대로.
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
export function demote(line) {
  const s = String(line ?? '');
  let m;
  if ((m = s.match(/^(\d{1,3})\.(\s+)(.*)$/))) return `${m[1]})${m[2]}${m[3]}`;
  if ((m = s.match(/^(\d{1,3})\)(\s+)(.*)$/))) return `(${m[1]})${m[2]}${m[3]}`;
  if ((m = s.match(/^\((\d{1,2})\)(\s+)(.*)$/)) && Number(m[1]) >= 1 && Number(m[1]) <= 20) return `${CIRCLED[Number(m[1]) - 1]}${m[2]}${m[3]}`;
  if ((m = s.match(/^([가-힣])\.(\s+)(.*)$/))) return `${m[1]})${m[2]}${m[3]}`;
  if ((m = s.match(/^([가-힣])\)(\s+)(.*)$/))) return `(${m[1]})${m[2]}${m[3]}`;
  return s;
}
// 줄 하나가 파일에 들어가는 글: '- 11.10. 글' + 상세 포함이면 그 아래 본문(번호 한 단계 내림).
export const fileLinesOf = l => [lineText(l), ...(l.detail === 'full' ? l.body.map(demote) : [])];
// 한글 파일 2. 2) 세부 내용: 사업 묶음마다 '(1) 사업 이름' 소제목 + 회의 결과 상자(서식 상자 칸 이름 그대로 — 다시 읽을 때 상자로 알아보려면 세 줄 이상, template.mjs isBoxTable):
// 제목 = 사업 이름, 내용 = 보이는 줄(날짜 오름차순, 상세 포함은 본문), 차기일정 = 사업 보고 '다음 할 일'(겹침 없이). 뺀 줄은 넣지 않는다. 줄 수 상한 없음.
export function fileDetails(groups) {
  return (Array.isArray(groups) ? groups : []).filter(g => g.shown.length)
    .map((g, i) => ({heading: `(${i + 1}) ${cleanBody(g.label)}`, box: [{label: '제목', lines: [cleanBody(g.label)]}, {label: '내용', lines: g.shown.flatMap(fileLinesOf)},
      {label: '차기일정', lines: [...new Set(g.shown.flatMap(l => (l.kind === 'meeting' ? l.plan || [] : [])).map(cleanBody).filter(Boolean))].map(t => `- ${t}`)}]}));
}
// [확정] 사진 한 칸(section 'biz_detail', 조직 사진 snapshotRow 모양): 보이는 줄(보고용 글 반영, 뺀 줄 제외)과 상세 포함 본문.
export function detailSnapshotRow(g) {
  if (!g || !g.shown?.length) return null;
  return {section: SECTION, ref_kind: 'space', ref_key: String(g.space || ''), label: cleanBody(g.label),
    lines: g.shown.map(l => ({ref_kind: l.kind, ref_key: String(l.key), day: l.day || null, end_day: l.end_day || null, text: cleanBody(l.text), ...(l.detail === 'full' ? {detail: 'full', body: l.body.map(demote)} : {})}))};
}
