// WEEKLY-임시저장 (docs/design/weekly-draft-feedback.md 2절): 주간보고 한글 파일 상자에서 고치던 값(줄 글·일정 제목·이름·일시)을
// 그 주 요청 표 행(app_weekly_exec_requests, 주마다 1행)의 draft 칸에 서버 저장한다. 화면 없는 부분 — 칸 열쇠·고친 칸만 고르기·
// 다시 넣기·3자 비교·읽기·조건부 쓰기(같은 코드를 node 시험이 부른다).
// - 칸 열쇠는 줄 번호가 아니라 칸 이름: 요약은 '사업영역›세부 과제', 산하조직·투쟁 사업장은 조직 이름. 같은 이름이 두 번이면 n(몇 번째, 0부터).
// - 쓰기는 draft_saved_at 조건 PATCH(처음이면 is.null). 0행이면 그사이 다른 기기가 저장한 것 → {conflict, row}(다시 읽은 서버 판).
//   임시저장은 updated_at을 보내지 않는다(요청 표를 고치는 다른 기기가 헛충돌을 겪지 않게). 행이 없으면 items=[]로 만든다(409면 충돌로 봄).
// - 칸이 아직 없으면(표 404, 칸 400 42703/PGRST204) {missing:true} — 화면은 "임시저장은 준비 중" 한 줄로 지금처럼 동작한다.
// - 내용은 업무 글이다. 로그·오류 보고에 내용을 쓰지 않는다. 브라우저 저장소에 아무것도 두지 않는다.

const TABLE = '/rest/v1/app_weekly_exec_requests';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const encode = encodeURIComponent;
export const DRAFT_VERSION = 1;
export const DRAFT_MAX_BYTES = 204800; // 서버 CHECK와 같은 상한(글자로 200 KiB)
export const SECTIONS = Object.freeze(['summary', 'orgs', 'sites']);

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
export function makeDraft({base = null, me = '', meFrom = '', date = '', cells = new Map(), initial = new Map(), keep = [], titles = new Map(), drops = new Map(), confirmed = null} = {}) {
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
  if (confirmed) out.confirmed = confirmed;
  return out;
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
  if (raw.confirmed && typeof raw.confirmed === 'object') out.confirmed = {document_id:String(raw.confirmed.document_id ?? ''), at:String(raw.confirmed.at ?? '')};
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
  const confirmed = mine?.confirmed ?? theirs?.confirmed;
  if (confirmed) out.confirmed = confirmed;
  return {draft:out, conflicts};
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
