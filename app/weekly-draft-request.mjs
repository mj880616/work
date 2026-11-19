// WEEKLY-자동화 ③ (docs/design/weekly-automation.md 3.2절·7절 ③): 주간보고 AI 초안(ai-assist weekly_draft)에 보낼 재료를 칸에 짝짓고
// 몸통을 만드는 규칙. 지금까지 app/journal-hwpx.js 안(materialOf·aiRequest)에만 있던 것을 화면 없는 순수 함수로 옮겼다 —
// 금요일 자동 초안(서버)과 [주간 정리] 화면이 같은 규칙을 쓰게 하려고(같은 규칙 두 벌 금지, AGENTS.md §4). 동작은 옮기기 전과 같다.
// - 화면·네트워크·저장 없음. 칸 이름·제안 기록(picks)·보고일은 부르는 쪽이 넘긴다.
// - 업무 글이 지나가므로 로그·오류 보고에 글을 넣지 않는다.

import {sortPicks} from './weekly-picks.mjs';
import {materialLine} from './weekly-ai-material.mjs';
import {whereOf} from './weekly-feedback.mjs';
import {shortDay} from './task-due.mjs';

export const LEARN_BODY_BYTES = 90 * 1024; // 서버 상한(96KB, WEEKLY_LEARN_BODY_BYTES)보다 조금 작게
export const DRAFT_CELLS_MAX = 80;
export const CELL_LINES_MAX = 20;
export const CELL_MATERIAL_MAX = 20;
export const UNMATCHED_MAX = 40;
// WEEKLY-재료전체 ① (S67-07): 재료 하나 = 머리 줄(화면에 보이는 한 줄, HEAD_CHARS까지) + '본문:' 아래 기록 전체 글.
// 서버 WL_MATERIAL_CHARS(1500)·WL_MATERIAL_LINES(40)와 같게. 몸통이 넘치면 긴 본문부터(같으면 옛 기록부터) 반씩 줄이고,
// BODY_MIN 자 아래로 가면 본문을 빼고 머리 줄 끝에 '(본문 잘림)'. 그래도 넘치면 전처럼 재료 줄을 뒤에서부터 덜어 낸다.
export const HEAD_CHARS = 400;
export const MATERIAL_CHARS = 1500;
export const MATERIAL_LINES = 40;
export const BODY_MIN = 120;
export const CUT_MARK = '…(잘림)';
export const BODY_GONE = ' (본문 잘림)';
const BODY_LABEL = '본문:';

// 제안 한 줄의 글: '날짜 글'(앞 '- ' 뺌). 날짜가 없으면 글만.
export const dayText = x => `${x.day ? `${shortDay(x.day)} ` : ''}${String(x.text ?? '').replace(/^-\s*/, '')}`;
// 캘린더 추천은 [주간 정리] 4. 산하 조직 현황의 같은 추천과 열쇠가 같게(칸 = 조직 id, 글 = 추천 줄) — 어느 화면에서 빼도 둘 다 빠진다.
export const describeMaterial = (cell, key) => x => ({kind:x.orgRef ? 'calendar' : 'material', from:x.src ?? (x.summary ? 'ai' : 'record'), cell:x.orgRef ? `orgref:${x.orgId}` : cell,
  org:key.startsWith('orgs:') ? x.from ?? '' : '', text:dayText(x)});
export const describeRest = x => ({kind:'unmatched', from:x.src ?? 'record', cell:x.from ?? '', text:dayText(x)});
const withPickInfo = r => r.shown.map(x => ({...x.raw, pick:{kind:x.kind, from:x.from, cell:x.cell, org:x.org, text:x.text, key:x.key}}));

// 이번 주 기록 후보(draft.weekMaterial 결과 raw) → 칸마다 제안 목록. 뺀 제안·거절한 종류(opts: weekly-picks.mjs droppedOf·keptOf·learn)는
// 빠지고 gone 에 남는다. cellName(key): 'summary:3' 같은 자리 → 제안 기록 칸 이름(부르는 쪽 칸 목록으로 계산).
export function pickMaterial(raw, {cellName = key => key, opts = {}} = {}) {
  const gone = new Map();
  const run = (key, list, describe) => { const r = sortPicks(list ?? [], describe, opts); if (r.gone.length) gone.set(key, r.gone); return withPickInfo(r); };
  const byRow = new Map([...(raw?.byRow ?? [])].map(([i, list]) => [i, run(`summary:${i}`, list, describeMaterial(cellName(`summary:${i}`), `summary:${i}`))]));
  const byOrg = new Map([...(raw?.byOrg ?? [])].map(([i, list]) => [i, run(`orgs:${i}`, list, describeMaterial(cellName(`orgs:${i}`), `orgs:${i}`))]));
  const unmatched = run('unmatched', raw?.unmatched, describeRest), orgUnmatched = run('orgUnmatched', raw?.orgUnmatched, describeRest);
  return {byRow, byOrg, unmatched, orgUnmatched, gone};
}

// 보내는 한 줄: 제어 글자·꺾쇠를 빼고 공백을 하나로, max 자까지.
export const sendLine = (v, max) => [...String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2028\u2029\u2060-\u2069]+/g, ' ').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()].slice(0, max).join('');

// 본문(여러 줄): 줄마다 sendLine 과 같은 정리, 빈 줄 빼기, 전화·이메일은 '(연락처)'. max 자를 넘으면 자르고 CUT_MARK.
const PHONE = /(?:\+?82[-\s]?)?0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}/g, EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
export function sendBody(v, max, lines = MATERIAL_LINES - 2) {
  if (max <= 0) return '';
  const list = String(v ?? '').split(/\r?\n|\u2028|\u2029/).map(l => sendLine(l, MATERIAL_CHARS).replace(EMAIL, '(연락처)').replace(PHONE, '(연락처)')).filter(Boolean);
  const cutLines = list.length > lines, joined = list.slice(0, lines).join('\n'), all = [...joined];
  if (!cutLines && all.length <= max) return joined;
  const room = Math.max(0, max - [...CUT_MARK].length);
  return room ? all.slice(0, room).join('').trimEnd() + CUT_MARK : '';
}
// 재료 하나의 보낼 글: 머리 줄 + (본문이 있으면) '\n본문:\n' + 본문.
const materialText = e => e.body ? `${e.head}\n${BODY_LABEL}\n${e.body}` : e.head;
const entryOf = (head, x) => {
  const h = sendLine(head, HEAD_CHARS), body = h ? sendBody(x?.body, MATERIAL_CHARS - [...h].length - [...BODY_LABEL].length - 2) : '';
  return {head:h, body, day:String(x?.day ?? '')};
};
// 몸통이 넘칠 때 본문 줄이기: 가장 긴 본문(같으면 옛 날짜)을 반으로. BODY_MIN 아래면 빼고 머리 줄에 BODY_GONE.
function shrinkBodies(entries, fits) {
  while (!fits()) {
    let pick = null;
    for (const e of entries) if (e.body && (!pick || e.body.length > pick.body.length || (e.body.length === pick.body.length && e.day < pick.day))) pick = e;
    if (!pick) return;
    const half = Math.floor([...pick.body].length / 2);
    if (half < BODY_MIN) { pick.body = ''; pick.head = sendLine(pick.head + BODY_GONE, HEAD_CHARS + BODY_GONE.length); }
    else pick.body = sendBody(pick.body.endsWith(CUT_MARK) ? pick.body.slice(0, -CUT_MARK.length) : pick.body, half);
  }
}

// weekly_draft 몸통. 칸마다 바탕 줄(처음 바탕 initial — 고친 칸 글이 아님)과 그 칸 옆 이번 주 기록 줄을 보낸다.
//   cellAt: Map(칸 id → {section, index}), initial: Map(칸 id → 바탕 줄), material: pickMaterial 결과, report: 보고일(YYYY-MM-DD).
// 반환: {request, refs(Map 'c1' → 칸 id), cells(보낸 칸 수)}. 몸통이 크면 기록 줄을 뒤에서부터 덜어 낸다(칸 글은 그대로).
// WEEKLY-재료전체 ①: 재료 줄(x)에 body(기록 전체 글, journal-data.js fullText)가 있으면 '본문:' 아래 함께 보낸다(위 상한 안에서).
// 반환 cut = 줄인 본문 수(shrunk)·뺀 본문 수(dropped)·덜어 낸 재료 줄 수(lines) — 화면이 '일부 잘림'을 알릴 수 있게(숫자만).
export function draftRequest({start, mode, cellAt, initial, material, report, maxBytes = LEARN_BODY_BYTES}) {
  const m = material ?? {}, refs = new Map(), cells = [], cellEntries = [];
  for (const [id, at] of cellAt ?? []) {
    if (cells.length >= DRAFT_CELLS_MAX) break;
    const ref = `c${cells.length + 1}`; refs.set(ref, id);
    const list = at.section === 'summary' ? m.byRow?.get(at.index) : at.section === 'orgs' ? m.byOrg?.get(at.index) : [];
    const entries = (list ?? []).map(x => entryOf(materialLine(x, report, shortDay), x)).filter(e => e.head).slice(0, CELL_MATERIAL_MAX);
    cellEntries.push(entries);
    cells.push({ref, where:sendLine(whereOf(id), 120) || '칸', lines:(initial?.get(id) ?? []).map(l => sendLine(l, 300)).filter(Boolean).slice(0, CELL_LINES_MAX), material:[]});
  }
  const restEntries = [...(m.unmatched ?? []), ...(m.orgUnmatched ?? [])].map(x => entryOf(`${x.from ? `${x.from}: ` : ''}${materialLine(x, report, shortDay)}`, x)).filter(e => e.head).slice(0, UNMATCHED_MAX);
  const request = {kind:'weekly_draft', week_start:start, mode, cells, unmatched:[]};
  const fill = () => { cells.forEach((c, k) => { c.material = cellEntries[k].map(materialText); }); request.unmatched = restEntries.map(materialText); };
  const size = () => { fill(); return new TextEncoder().encode(JSON.stringify(request)).length; };
  const all = [...cellEntries.flat(), ...restEntries], had = all.filter(e => e.body).length, before = new Map(all.map(e => [e, e.body]));
  shrinkBodies(all, () => size() <= maxBytes);
  const cut = {shrunk:all.filter(e => e.body && e.body !== before.get(e)).length, dropped:had - all.filter(e => e.body).length, lines:0};
  fill();
  const fits = () => new TextEncoder().encode(JSON.stringify(request)).length <= maxBytes;
  while (!fits() && request.unmatched.length) { request.unmatched.pop(); cut.lines++; }
  for (let k = cells.length - 1; !fits() && k >= 0; k--) while (!fits() && cells[k].material.length) { cells[k].material.pop(); cut.lines++; }
  return {request, refs, cells:cells.length, cut};
}
