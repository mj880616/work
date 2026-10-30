// WEEKLY-임시저장 (docs/design/weekly-draft-feedback.md 2절): 주간보고 한글 파일 상자에서 고치던 값(줄 글·일정 제목·이름·일시)을
// 그 주 요청 표 행(app_weekly_exec_requests, 주마다 1행)의 draft 칸에 서버 저장한다. 화면 없는 부분 — 칸 열쇠·고친 칸만 고르기·
// 다시 넣기·3자 비교·읽기·조건부 쓰기(같은 코드를 node 시험이 부른다).
// - 칸 열쇠는 줄 번호가 아니라 칸 이름: 요약은 '사업영역›세부 과제', 산하조직·투쟁 사업장은 조직 이름. 같은 이름이 두 번이면 n(몇 번째, 0부터).
// - 쓰기는 draft_saved_at 조건 PATCH(처음이면 is.null). 0행이면 그사이 다른 기기가 저장한 것 → {conflict, row}(다시 읽은 서버 판).
//   임시저장은 updated_at을 보내지 않는다(요청 표를 고치는 다른 기기가 헛충돌을 겪지 않게). 행이 없으면 items=[]로 만든다(409면 충돌로 봄).
// - 칸이 아직 없으면(표 404, 칸 400 42703/PGRST204) {missing:true} — 화면은 "임시저장은 준비 중" 한 줄로 지금처럼 동작한다.
// - 내용은 업무 글이다. 로그·오류 보고에 내용을 쓰지 않는다. 브라우저 저장소에 아무것도 두지 않는다.

import {readIssued, newerIssued} from './weekly-lines.mjs';
import {readExtras, mergeExtras, EXTRA_KEYS} from './weekly-feedback.mjs';

const TABLE = '/rest/v1/app_weekly_exec_requests';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const encode = encodeURIComponent;
export const DRAFT_VERSION = 1;
export const DRAFT_MAX_BYTES = 204800; // 서버 CHECK와 같은 상한(글자로 200 KiB)
export const SECTIONS = Object.freeze(['summary', 'orgs', 'sites']);
// WEEKLY-자료요약 화면 ②(docs/design/weekly-file-summary.md 6절): [주간 정리] 자료 줄 [빼기]·[고치기]·[넣기]는 같은 draft의 docs 칸.
//   docs: [{id, drop?:true, text?:'고친 줄'(한 줄·200자), keep?:true(기록과 같아 접힌 자료를 넣음)}]. 쓰는 곳은 [주간 정리](changeWeekDocs)뿐이고,
//   한글 파일 상자는 읽은 docs를 그대로 다시 실어 보낸다(3자 비교 칸 열쇠 doc:<자료 id>).
export const DOC_TEXT_MAX = 200;
// WEEKLY-개인본대조 W-2(docs/design/ledger-sources.md 4.1): 한글 파일 상자가 파일을 내줄 때(받기·확정) 그 초안의 1~4절 글 줄을 draft.issued 에 적는다
//   issued: {at, from:'generated', lines:[{section, text}]} (weekly-lines.mjs). 원장 자동 기록(ai-assist, W-3)이 자료실 개인본을 이 줄과 견줘 바뀐 줄만 읽는다.
//   임시저장은 draft 를 통째로 쓰므로 makeDraft·readDraft·merge3·keepDocsOnly 가 issued 를 다시 실어 보낸다(안 그러면 다음 저장에 지워진다).
//   '고친 칸'이 아니라 사본 기록이라 hasContent·3자 비교 칸에는 넣지 않고(이어 쓰기·충돌 질문 없음), 합칠 때는 더 나중에 낸 것을 쓴다.
// MTG-프로젝트합치기 사업영역 AI(docs/design/project-into-report.md 12.2·13절, 명진 결정 ⑤): 사업요약표 '진행' 한 줄 요약은 같은 draft의 area_summaries 칸.
//   area_summaries: {"<사업영역 id>": {text, hash, edited, at}}. AI 줄(edited:false)은 서버 ai-assist가 쓰고, 사람이 고친 줄(edited:true)은
//   [사업요약표 미리보기]의 [고치기]가 changeWeekAreaSummary로 쓴다. 한글 파일 상자·[주간 정리]는 읽은 그대로 다시 실어 보낸다.
//   3자 비교 칸은 고친 줄만(area:<id>). AI 줄은 합칠 때 더 나중에 쓴 것(at)을 둔다. hasContent에는 넣지 않는다(상자에서 고친 것이 아님).

// WEEKLY-환류학습(docs/design/weekly-draft-feedback.md 9절): 같은 draft의 proposed(그 주 처음 만든 초안 칸 글)·feedback(확정 때 초안 ↔ 최종 줄 비교와
//   환류 보고)·rules(주간보고 규칙 목록) 칸. issued 와 같은 '사본 기록'이라 hasContent·3자 비교 칸에는 넣지 않고, 합칠 때는 칸마다 더 나중(at)의 것을 쓴다.
//   모양 검사는 weekly-feedback.mjs readExtras(모르는 것·틀린 것은 버림). 읽은 그대로 다시 실어 보낸다(안 그러면 다음 임시저장에 지워진다).

// ---- 칸 열쇠 ----
const oneLine = s => String(s ?? '').replace(/\s+/g, ' ').trim();
export const summaryKey = row => `${oneLine(row.area)}›${oneLine(row.task)}`;
export const orgKey = row => oneLine(row.org);
// rows → 같은 순서의 [{key, n}] (같은 이름이 앞에 몇 번 나왔는지가 n).
export function cellKeys(rows, keyOf) {
  const seen = new Map();
  return rows.map(row => { const key = keyOf(row), n = seen.get(key) ?? 0; seen.set(key, n + 1); return {key, n}; });
}
export const cellId = (section, key, n) => `${section}\u0000${key}\u0000${n}`;
export const parseCellId = id => { const [section, key, n] = String(id).split('\u0000'); return {section, key, n:Number(n)}; };

const cleanLines = lines => (Array.isArray(lines) ? lines.map(s => String(s ?? '')) : []);
const sameLines = (a, b) => JSON.stringify(cleanLines(a)) === JSON.stringify(cleanLines(b));

// ---- 고친 값 → draft ----
// cells: Map cellId → 지금 줄 글, initial: Map cellId → 바탕(처음) 줄 글. 바탕과 같은 칸은 저장하지 않는다.
// me는 고친 이름일 때만(meFrom='typed'), date는 바탕(보고일)과 다를 때만 넘긴다(아니면 '').
// keep: 이번 바탕에 넣지 못한 저장 칸(버리지 않고 다시 저장). titles: Map event → {title, place}.
// drops(WEEKLY-환류, 설계 3.4): Map event → 'drop'(이번 주에 뺀 일정) | 'keep'(기억으로 빠지는 일정을 이번 주만 넣음) → dropped·kept.
export function makeDraft({base = null, me = '', meFrom = '', date = '', cells = new Map(), initial = new Map(), keep = [], titles = new Map(), drops = new Map(), docs = [], areas = null, confirmed = null, issued = null, extras = null} = {}) {
  const rows = [];
  for (const [id, lines] of cells) {
    if (initial.has(id) && sameLines(lines, initial.get(id))) continue;
    const {section, key, n} = parseCellId(id);
    rows.push({section, key, n, lines:cleanLines(lines)});
  }
  const placed = new Set(rows.map(r => cellId(r.section, r.key, r.n)));
  for (const r of keep) if (!placed.has(cellId(r.section, r.key, r.n)) && !cells.has(cellId(r.section, r.key, r.n))) rows.push({section:r.section, key:r.key, n:r.n, lines:cleanLines(r.lines)});
  const out = {v:DRAFT_VERSION, base, me:String(me ?? ''), me_from:String(meFrom ?? ''), date:String(date ?? ''), rows,
    titles:[...titles].map(([event, t]) => ({event:String(event), title:String(t?.title ?? ''), place:String(t?.place ?? '')}))};
  putDrops(out, drops);
  putDocs(out, docs);
  putAreas(out, areas);
  putExtras(out, extras);
  if (confirmed) out.confirmed = confirmed;
  return putIssued(out, issued);
}
// proposed·feedback·rules 칸을 모양대로 붙인다(없으면 칸을 두지 않음).
export function putExtras(out, extras) {
  for (const key of EXTRA_KEYS) delete out[key];
  Object.assign(out, readExtras(extras));
  return out;
}
export const draftExtras = draft => readExtras(draft);
// issued 를 덧붙인 draft(원본은 건드리지 않음). 없으면 칸을 두지 않는다. 크기 상한(DRAFT_MAX_BYTES)을 넘기면 issued 를 뺀다 — 기록 때문에 고친 칸 저장이 막히면 안 된다.
export function putIssued(draft, issued) {
  const { issued: _old, ...rest } = draft ?? {v:DRAFT_VERSION, base:null, me:'', me_from:'', date:'', rows:[], titles:[]};
  const clean = readIssued(issued);
  if (!clean) return rest;
  const withIt = {...rest, issued:clean};
  // jsonb 글자 모양(DB CHECK 가 재는 값)은 쉼표·쌍점 뒤 공백 때문에 JSON.stringify 보다 조금 길다 → 8 KB 여유를 둔다.
  return draftBytes(withIt) > DRAFT_MAX_BYTES - 8192 ? rest : withIt;
}
// ---- 자료 줄 고침(docs) ----
const oneDocLine = s => String(s ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
// 항목 하나를 모양대로(모르는 칸·틀린 값은 버림). 빈 항목이면 null.
export function cleanDocEdit(e) {
  if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !e.id || e.id.length > 100) return null;
  const out = {id:e.id};
  if (e.drop === true) out.drop = true;
  const text = oneDocLine(e.text);
  if (text && [...text].length <= DOC_TEXT_MAX) out.text = text;
  if (e.keep === true) out.keep = true;
  return Object.keys(out).length > 1 ? out : null;
}
export const draftDocs = draft => { const seen = new Set(), out = []; for (const e of Array.isArray(draft?.docs) ? draft.docs : []) { const c = cleanDocEdit(e); if (c && !seen.has(c.id)) { seen.add(c.id); out.push(c); } } return out; };
function putDocs(out, docs) { const list = draftDocs({docs}); if (list.length) out.docs = list; }
// draft → Map(자료 id → {drop?, text?, keep?}).
export const docEdits = draft => new Map(draftDocs(draft).map(({id, ...rest}) => [id, rest]));
// 자료 하나의 고침을 바꾼 draft(draft가 없으면 빈 임시저장으로 시작). patch = {drop?, text?, keep?}의 새 값(null·false = 그 칸 지움).
export function withDocEdit(draft, id, patch) {
  const base = draft ? {...draft} : {v:DRAFT_VERSION, base:null, me:'', me_from:'', date:'', rows:[], titles:[]};
  const list = draftDocs(base), at = list.findIndex(e => e.id === id), cur = at >= 0 ? list[at] : {id};
  const next = {...cur};
  for (const [k, v] of Object.entries(patch ?? {})) { if (v === null || v === false || v === '' || v === undefined) delete next[k]; else next[k] = v; }
  const clean = cleanDocEdit(next);
  if (at >= 0) list.splice(at, 1);
  if (clean) list.push(clean);
  delete base.docs;
  putDocs(base, list);
  return base;
}
// [처음부터]: 상자에서 고친 것은 비우되 [주간 정리]의 자료 줄 고침은 남긴다(없으면 null = 임시저장 비움).
// 받은 초안 기록(issued)·사업영역 한 줄 요약(area_summaries)도 남긴다 — 상자에서 고친 것이 아니다.
export const keepDocsOnly = draft => {
  const docs = draftDocs(draft), issued = readIssued(draft?.issued), areas = draftAreaSummaries(draft), extras = readExtras(draft);
  if (!docs.length && !issued && !Object.keys(areas).length && !Object.keys(extras).length) return null;
  const out = {v:DRAFT_VERSION, base:null, me:'', me_from:'', date:'', rows:[], titles:[], ...(docs.length ? {docs} : {})};
  putAreas(out, areas);
  putExtras(out, extras);
  return putIssued(out, issued);
};
// ---- 사업영역 한 줄 요약(area_summaries) ----
export const AREA_TEXT_MAX = 200; // 서버 readAreaSummaries 가 고친 줄을 자르는 길이와 같다
const AREA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AREA_HASH = /^a1:[0-9a-f]{32}$/;
// 한 항목을 모양대로(틀리면 null). 고친 줄은 hash 없음.
export function cleanAreaSummary(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  const text = oneDocLine(e.text);
  if (!text || [...text].length > AREA_TEXT_MAX) return null;
  const edited = e.edited === true;
  return {text, hash:!edited && typeof e.hash === 'string' && AREA_HASH.test(e.hash) ? e.hash : '', edited, at:typeof e.at === 'string' ? e.at.slice(0, 40) : ''};
}
// draft → {id: 항목}(모르는·틀린 것은 버림, 200개까지).
export function draftAreaSummaries(draft) {
  const raw = draft?.area_summaries, out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, e] of Object.entries(raw)) {
    if (!AREA_ID.test(id) || Object.keys(out).length >= 200) continue;
    const c = cleanAreaSummary(e);
    if (c) out[id.toLowerCase()] = c;
  }
  return out;
}
function putAreas(out, areas) { const clean = draftAreaSummaries({area_summaries:areas}); if (Object.keys(clean).length) out.area_summaries = clean; else delete out.area_summaries; }
// 사업영역 하나의 고친 줄을 바꾼 draft(draft가 없으면 빈 임시저장으로 시작). text가 비면(null·'') 그 사업영역 줄을 지운다 — 다음 요청 때 AI 줄이 다시 만들어진다.
export function withAreaEdit(draft, areaId, text, at = new Date().toISOString()) {
  const id = String(areaId || '').toLowerCase();
  if (!AREA_ID.test(id)) throw new Error('area');
  const base = draft ? {...draft} : {v:DRAFT_VERSION, base:null, me:'', me_from:'', date:'', rows:[], titles:[]};
  const areas = draftAreaSummaries(base), line = oneDocLine(text);
  if ([...line].length > AREA_TEXT_MAX) throw Object.assign(new Error(`한 줄은 ${AREA_TEXT_MAX}자까지예요.`), {code:'too_long'});
  if (line) areas[id] = {text:line, hash:'', edited:true, at}; else delete areas[id];
  putAreas(base, areas);
  return base;
}
// 뺀 일정·이번 주만 넣은 일정(있을 때만 칸을 둔다 — 없으면 옛 모양 그대로).
function putDrops(out, drops) {
  const dropped = [], kept = [];
  for (const [event, how] of drops ?? []) (how === 'drop' ? dropped : how === 'keep' ? kept : []).push(String(event));
  if (dropped.length) out.dropped = dropped;
  if (kept.length) out.kept = kept;
}
const eventList = list => (Array.isArray(list) ? [...new Set(list.filter(e => typeof e === 'string' && e))] : []);
// 저장할 만한 내용: 고친 칸·일정, 고친 이름·일시, [확정] 표시.
export const hasContent = d => !!d && !!(d.rows?.length || d.titles?.length || d.dropped?.length || d.kept?.length || (d.me_from === 'typed' && d.me) || d.date || d.confirmed);

// 서버에서 읽은 draft를 모양대로만 받아들인다(모르는 것·틀린 것은 버림 — 서버는 형태·크기만 본다).
export function readDraft(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== DRAFT_VERSION) return null;
  const rows = (Array.isArray(raw.rows) ? raw.rows : []).filter(r => r && SECTIONS.includes(r.section) && typeof r.key === 'string' && Number.isInteger(r.n) && r.n >= 0 && Array.isArray(r.lines))
    .map(r => ({section:r.section, key:r.key, n:r.n, lines:cleanLines(r.lines)}));
  const titles = (Array.isArray(raw.titles) ? raw.titles : []).filter(t => t && typeof t.event === 'string' && t.event)
    .map(t => ({event:t.event, title:String(t.title ?? ''), place:String(t.place ?? '')}));
  const base = raw.base && typeof raw.base === 'object' ? {from:raw.base.from === 'file' ? 'file' : 'library', ...(typeof raw.base.document_id === 'string' ? {document_id:raw.base.document_id} : {}),
    file_name:String(raw.base.file_name ?? ''), title:String(raw.base.title ?? ''), digest:String(raw.base.digest ?? '')} : null;
  const out = {v:DRAFT_VERSION, base, me:String(raw.me ?? ''), me_from:String(raw.me_from ?? ''), date:String(raw.date ?? ''), rows, titles};
  const dropped = eventList(raw.dropped), kept = eventList(raw.kept).filter(e => !dropped.includes(e));
  if (dropped.length) out.dropped = dropped;
  if (kept.length) out.kept = kept;
  putDocs(out, raw.docs);
  if (raw.confirmed && typeof raw.confirmed === 'object') out.confirmed = {document_id:String(raw.confirmed.document_id ?? ''), at:String(raw.confirmed.at ?? '')};
  putAreas(out, raw.area_summaries);
  putExtras(out, raw);
  const issued = readIssued(raw.issued);
  if (issued) out.issued = issued;
  return out;
}

// ---- draft → 지금 바탕 칸 ----
// ids: 지금 바탕에 있는 cellId 집합. 이름이 맞는 칸만 넣고, 못 넣은 칸은 unplaced(접어서 보여 주고 다시 저장할 때 그대로 둠).
export function placeDraft(draft, ids) {
  const cells = new Map(), unplaced = [];
  for (const r of draft?.rows ?? []) {
    const id = cellId(r.section, r.key, r.n);
    if (ids.has(id)) cells.set(id, cleanLines(r.lines)); else unplaced.push(r);
  }
  return {cells, unplaced, titles:new Map((draft?.titles ?? []).map(t => [t.event, {title:t.title, place:t.place}])), drops:draftDrops(draft)};
}

// draft → Map(event → 'drop' | 'keep').
export const draftDrops = draft => new Map([...(draft?.kept ?? []).map(e => [e, 'keep']), ...(draft?.dropped ?? []).map(e => [e, 'drop'])]);

// ---- 3자 비교 (마지막으로 같았던 판 · 이 기기 · 서버) ----
// 칸 단위 값: 고친 이름(me, me_from='typed'일 때만), 고친 일시(date, 비어 있지 않을 때만), 줄 칸(row:…), 일정(title:…).
// 없는 칸 = 바탕 그대로(null). 일시는 바탕(보고일)과 같으면 화면이 ''로 넘긴다.
export function draftCells(draft) {
  const out = new Map();
  if (!draft) return out;
  if (draft.me_from === 'typed' && draft.me) out.set('me', draft.me);
  if (draft.date) out.set('date', draft.date);
  for (const r of draft.rows ?? []) out.set(`row:${cellId(r.section, r.key, r.n)}`, cleanLines(r.lines));
  for (const t of draft.titles ?? []) out.set(`title:${t.event}`, {title:t.title, place:t.place});
  for (const [event, how] of draftDrops(draft)) out.set(`drop:${event}`, how);
  for (const {id, ...rest} of draftDocs(draft)) out.set(`doc:${id}`, rest);
  for (const [id, e] of Object.entries(draftAreaSummaries(draft))) if (e.edited) out.set(`area:${id}`, e.text);
  return out;
}
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export const sameDraft = (a, b) => { const x = draftCells(a), y = draftCells(b); return x.size === y.size && [...x].every(([k, v]) => same(v, y.get(k))); };
// mine·theirs·base: draft(또는 null). 한쪽만 고친 칸은 합치고, 양쪽이 다르게 고친 칸은 conflicts(합친 판에는 서버 값을 둔다 —
// 사람이 고를 때까지). 반환 {draft(합친 판), conflicts:[{cell, mine, theirs}]} (값 null = 바탕 그대로).
export function merge3(base, mine, theirs) {
  const b = draftCells(base), m = draftCells(mine), t = draftCells(theirs);
  const keys = [...new Set([...b.keys(), ...m.keys(), ...t.keys()])].sort();
  const merged = new Map(), conflicts = [];
  for (const k of keys) {
    const bv = b.get(k) ?? null, mv = m.get(k) ?? null, tv = t.get(k) ?? null;
    let v;
    if (same(mv, tv) || same(tv, bv)) v = mv;
    else if (same(mv, bv)) v = tv;
    else { conflicts.push({cell:k, mine:mv, theirs:tv}); v = tv; }
    if (v != null) merged.set(k, v);
  }
  const out = {v:DRAFT_VERSION, base:mine?.base ?? theirs?.base ?? base?.base ?? null,
    me:merged.get('me') ?? '', me_from:merged.has('me') ? 'typed' : '', date:merged.get('date') ?? '', rows:[], titles:[]};
  for (const [k, v] of merged) {
    if (k.startsWith('row:')) { const {section, key, n} = parseCellId(k.slice(4)); out.rows.push({section, key, n, lines:v}); }
    else if (k.startsWith('title:')) out.titles.push({event:k.slice(6), title:v.title, place:v.place});
  }
  putDrops(out, new Map([...merged].filter(([k]) => k.startsWith('drop:')).map(([k, v]) => [k.slice(5), v])));
  putDocs(out, [...merged].filter(([k]) => k.startsWith('doc:')).map(([k, v]) => ({id:k.slice(4), ...v})));
  putAreas(out, mergeAreas(base, mine, theirs, merged));
  putExtras(out, mergeExtras(mergeExtras(readExtras(base), readExtras(mine)), readExtras(theirs)));
  const confirmed = mine?.confirmed ?? theirs?.confirmed;
  if (confirmed) out.confirmed = confirmed;
  return {draft:putIssued(out, newerIssued(newerIssued(base?.issued ?? null, mine?.issued ?? null), theirs?.issued ?? null)), conflicts};
}

// 사업영역 줄 합치기: 고친 줄은 3자 비교 결과(merged의 area:<id>), AI 줄은 세 판 중 더 나중에 쓴 것(고친 줄이 남은 사업영역은 그대로).
function mergeAreas(base, mine, theirs, merged) {
  const out = {}, sides = [base, mine, theirs].map(draftAreaSummaries);
  for (const side of sides) for (const [id, e] of Object.entries(side)) if (!e.edited && !(out[id] && out[id].at >= e.at)) out[id] = e;
  for (const id of Object.keys(out)) {
    // 한쪽에서 고친 줄을 지웠으면(되돌리기) 옛 AI 줄도 두지 않는다 — 다음 요청 때 새로 만든다.
    if (sides.some(side => side[id]?.edited) && !merged.has(`area:${id}`)) delete out[id];
  }
  for (const [k, text] of merged) if (k.startsWith('area:')) { const id = k.slice(5), at = sides.map(side => side[id]).filter(e => e?.edited && e.text === text).map(e => e.at).sort().at(-1) ?? ''; out[id] = {text, hash:'', edited:true, at}; }
  return out;
}

// ---- 바탕 지문 ----
// 바탕 내 줄 글의 SHA-256 앞 16자(같은 바탕인지 알아보는 데만 씀).
export async function baseDigest(initial) {
  const text = JSON.stringify([...initial].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const bytes = new TextEncoder().encode(text);
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return [...hash].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
export const draftBytes = draft => new TextEncoder().encode(JSON.stringify(draft)).length;

// ---- 서버 ----
const workspaceOf = rt => {
  const id = rt.context.read()?.workspace?.id;
  if (!id) throw new Error('업무 공간을 확인할 수 없습니다.');
  return id;
};
const SELECT = 'select=id,draft,draft_saved_at';
// 표가 없거나(404) 칸이 없을 때(400: 42703 없는 칸 / PGRST204 schema cache).
export const missingDraft = e => e?.status === 404 || (e?.status === 400 && /draft|42703|PGRST204|schema cache|does not exist/i.test(String(e?.message)));
const rowOf = row => (row && typeof row === 'object' ? {exists:true, draft:readDraft(row.draft), saved_at:row.draft_saved_at ?? null} : {exists:false, draft:null, saved_at:null});

// 그 주 행의 임시저장: {missing:false, row:{exists, draft, saved_at}}, 칸 준비 전이면 {missing:true}.
export async function readWeekDraft(start, rt = window.KPTURuntime) {
  if (!DAY.test(String(start))) throw new Error('week');
  let rows;
  try { rows = await rt.api(`${TABLE}?workspace_id=eq.${encode(workspaceOf(rt))}&week_start=eq.${start}&${SELECT}&limit=1`, {singleFlight:false}); }
  catch (error) { if (missingDraft(error)) return {missing:true, row:null}; throw error; }
  if (!Array.isArray(rows)) throw new Error('read');
  return {missing:false, row:rowOf(rows[0])};
}

// 조건부 쓰기. known: 마지막으로 읽은/쓴 서버 판 {exists, saved_at}. draft가 null이면 임시저장을 비운다.
// 반환: {ok:true, row} | {conflict:true, row(다시 읽은 서버 판)} | {missing:true}. 크기 초과는 {code:'too_big'} 오류.
export async function writeWeekDraft({start, known, draft, now = () => new Date().toISOString()}, rt = window.KPTURuntime) {
  if (!DAY.test(String(start))) throw new Error('week');
  if (draft && draftBytes(draft) > DRAFT_MAX_BYTES) throw Object.assign(new Error('임시저장이 너무 커요(200KB까지).'), {code:'too_big'});
  // 판 번호는 늘 앞 판보다 뒤(기기 시계가 같거나 늦어도 같은 값이 두 번 나오지 않게).
  const workspace = workspaceOf(rt), at = now(), prev = Date.parse(known?.saved_at ?? '');
  const saved_at = Number.isFinite(prev) && !(Date.parse(at) > prev) ? new Date(prev + 1).toISOString() : at;
  const body = {draft:draft ?? null, draft_saved_at:saved_at};
  try {
    if (!known?.exists) {
      const rows = await rt.api(`${TABLE}?${SELECT}`, {method:'POST', prefer:'return=representation', body:{workspace_id:workspace, week_start:start, items:[], ...body}});
      if (Array.isArray(rows) && rows.length === 1) return {ok:true, row:rowOf(rows[0])};
    } else {
      const guard = known.saved_at ? `draft_saved_at=eq.${encode(known.saved_at)}` : 'draft_saved_at=is.null';
      const rows = await rt.api(`${TABLE}?workspace_id=eq.${encode(workspace)}&week_start=eq.${start}&${guard}&${SELECT}`, {method:'PATCH', prefer:'return=representation', body});
      if (Array.isArray(rows) && rows.length === 1) return {ok:true, row:rowOf(rows[0])};
    }
  } catch (error) {
    if (missingDraft(error)) return {missing:true};
    if (known?.exists || error?.status !== 409) throw error;
  }
  const again = await readWeekDraft(start, rt);
  if (again.missing) return {missing:true};
  return {conflict:true, row:again.row};
}

// [주간 정리] 자료 줄 고침 쓰기: 그 주 행을 다시 읽고 docs만 바꿔 draft_saved_at 조건으로 쓴다(다른 칸은 서버 것 그대로).
// 그사이 다른 기기·한글 파일 상자가 저장했으면 다시 읽어 같은 바꿈을 한 번 더(세 번까지). known: 마지막으로 읽은 그 주 행({exists, draft, saved_at}).
// 반환 {ok:true, row} | {missing:true}. 끝내 못 쓰면 오류.
export async function changeWeekDocs({start, known = null, change}, rt = window.KPTURuntime) {
  let row = known;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!row) { const read = await readWeekDraft(start, rt); if (read.missing) return {missing:true}; row = read.row; }
    const draft = change(row.draft);
    const r = await writeWeekDraft({start, known:row, draft}, rt);
    if (r.missing) return {missing:true};
    if (r.ok) return {ok:true, row:{...r.row, draft:r.row.draft ?? readDraft(draft)}};
    row = r.row;
  }
  throw Object.assign(new Error('changed'), {code:'changed'});
}

// [사업요약표 미리보기] 사업영역 한 줄 [고치기]: 그 주 행을 다시 읽고 area_summaries의 그 사업영역만 바꿔 쓴다(changeWeekDocs와 같은 다시 읽고 쓰기).
// text 가 비면 고친 줄을 지운다(다음 요청 때 AI 줄). 반환 {ok:true, row} | {missing:true}.
export const changeWeekAreaSummary = ({start, areaId, text, known = null, now = () => new Date().toISOString()}, rt = window.KPTURuntime) =>
  changeWeekDocs({start, known, change:draft => withAreaEdit(draft, areaId, text, now())}, rt);
