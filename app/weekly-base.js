// WEEKLY-한흐름확정 ① 자료(docs/design/weekly-one-flow.md 2.1·6절): 주간보고 '바탕'(지난주 개인본, 없으면 팀 확정본) 읽기를 한 곳에 모은 공용 모듈.
// 한글 파일 상자(journal-hwpx.js)와 [주간 정리](② 화면 PR)가 같은 코드를 쓴다(같은 목적 코드 두 벌 금지).
//   findBase(rt, 보고일)          → 자료실에서 바탕 고르기(weekly-feedback.mjs pickBase): {doc, from:'personal'|'confirmed', team} | null
//   baseCells(draftMod, team, …)  → 바탕(팀 보고서 모양)에서 내 칸 글 Map(cellId → 줄). 칸 열쇠는 weekly-draft-store.js 와 같음
//   proposedOf({…})               → draft.proposed 모양(그 주 처음 연 바탕 칸 글)
//   openWeekBase({…})             → 바탕을 찾아 열어 칸 글까지(엔진 없이 .hwpx 만, HWP 5 면 {status:'needs_engine'})
//   ensureWeekProposed({…})       → 그 주 draft 에 proposed 가 없을 때만 한 번 바탕을 열어 저장. 있으면 서버 것을 그대로(어느 기기서든 draft 만 읽음)
// 무거운 모듈(weekly-hwpx/draft.mjs·hwp-drive.js)은 부르는 쪽이 lazy import 해서 mods 로 넘긴다. 글은 로그에 쓰지 않는다. 브라우저 저장소 없음.
import {pickBase, cellList, readProposed} from './weekly-feedback.mjs';
import {weeklyCategoryFilter} from './document-categories.js';
import {cellKeys, cellId, summaryKey, orgKey, readWeekDraft, writeWeekDraft, withProposed} from './weekly-draft-store.js';

const encode = encodeURIComponent;

// 바탕 고르기: 보고일 앞의 최신 개인본 → {doc, from:'personal', team(최신 팀 확정본 — '확정본에서 바뀜' 참고용)},
// 없으면 최신 팀 확정본 → {doc, from:'confirmed'}, 둘 다 없으면 null. 개인본을 읽지 못하면 확정본만 본다(확정본 읽기 실패는 던짐).
export async function findBase(rt, day) {
  const workspace = rt.context.read()?.workspace?.id;
  const q = (kind, limit) => `/rest/v1/app_documents?workspace_id=eq.${encode(workspace)}&category=${weeklyCategoryFilter(kind)}&select=id,title,file_name,document_date,created_at&order=created_at.desc,id.desc&limit=${limit}`;
  const [personal, confirmed] = await Promise.all([rt.api(q('personal', 5)).catch(() => []), rt.api(q('confirmed', 1))]);
  return pickBase({personal:Array.isArray(personal) ? personal : [], confirmed:Array.isArray(confirmed) ? confirmed : []}, day);
}

// 칸 목록(요약·산하조직·투쟁 사업장, 각 [{…, lines}]) → Map(cellId → 줄). linesOf(section, row) 로 줄을 바꿔 줄 수 있다(상자의 고친 칸).
export function listCells({summary = [], orgs = [], sites = []} = {}, linesOf = (_, row) => row.lines) {
  const out = new Map();
  for (const [section, list, keyOf] of [['summary', summary, summaryKey], ['orgs', orgs, orgKey], ['sites', sites, orgKey]]) {
    const keys = cellKeys(list, keyOf);
    list.forEach((row, i) => out.set(cellId(section, keys[i].key, keys[i].n), [...(linesOf(section, row) ?? [])]));
  }
  return out;
}
// 팀 보고서(team) → 내 바탕 칸 글. draftMod = weekly-hwpx/draft.mjs. opts = {me, myOrgs, orgList, date}.
export function baseCells(draftMod, team, {me = '', myOrgs = [], orgList = null, date = ''} = {}) {
  const base = draftMod.startDraft(team, {me, myOrgs, orgList, date});
  return listCells({summary:draftMod.editableRows(base, me), orgs:draftMod.editableOrgs(base, 'orgs'), sites:draftMod.editableOrgs(base, 'sites')});
}
// draft.proposed 모양. baseKind: 'personal'|'confirmed'|'file', baseInfo: {from, document_id?}. cells: Map 또는 칸 목록.
// 크기 상한(weekly-feedback.mjs EXTRA_MAX_BYTES)을 넘으면 모양 검사 전 값을 그대로 준다 — 서버에 실을 때(readExtras) 빠지고, 상자의 [확정] 비교에는 쓰인다(옛 동작과 같음).
export function proposedOf({at = new Date().toISOString(), baseKind = 'confirmed', baseInfo = null, cells, ai = false}) {
  const raw = {at, base:{from:baseKind === 'personal' ? 'personal' : baseInfo?.from === 'file' || baseKind === 'file' ? 'file' : 'confirmed', ...(baseInfo?.document_id ? {document_id:String(baseInfo.document_id)} : {})},
    cells:cellList(cells), ...(ai ? {ai:true} : {})};
  return readProposed(raw) ?? raw;
}

// 바탕 찾아 열기(자료실만). mods = {draft, drive}(lazy import 한 weekly-hwpx/draft.mjs·hwp-drive.js). opts 는 baseCells 와 같음.
// toHwpx(bytes, name): HWP 5 → .hwpx 바꾸개(상자의 숨은 엔진). 없으면 HWP 5 바탕은 {status:'needs_engine', doc}.
// cellsOf(team): 칸 글을 다르게 셀 때(상자의 쟁의 단계·현황 표 적용 등). 없으면 baseCells.
// 반환 {status:'ok', doc, from, team, cells, info:{from:'library', document_id, file_name, title}} | {status:'none'} | {status:'not_hwp'|'locked'|'needs_engine', doc}.
export async function openWeekBase({rt = window.KPTURuntime, day, mods, opts = {}, toHwpx = null, cellsOf = null}) {
  const found = await findBase(rt, day);
  if (!found?.doc) return {status:'none'};
  const doc = found.doc;
  if (!mods.drive.isHwpName(doc.file_name)) return {status:'not_hwp', doc};
  const {bytes} = await mods.drive.openHwpFromDrive({kind:'library', document:{id:doc.id}}, {rt});
  const kind = mods.draft.hwpKind(bytes);
  if (!kind) return {status:'not_hwp', doc};
  let hwpx = bytes;
  if (kind !== 'hwpx') {
    if (mods.draft.hwp5Header(bytes)?.password) return {status:'locked', doc};
    if (!toHwpx) return {status:'needs_engine', doc};
    hwpx = await toHwpx(bytes, doc.file_name);
  }
  const {team} = mods.draft.prepareConfirmed(await mods.draft.openConfirmed(hwpx));
  return {status:'ok', doc, from:found.from, teamDoc:found.team ?? null, team, cells:cellsOf ? cellsOf(team) : baseCells(mods.draft, team, opts),
    info:{from:'library', document_id:String(doc.id), file_name:String(doc.file_name || ''), title:String(doc.title || '')}};
}

// 그 주 처음 한 번만 바탕을 열어 proposed 를 저장한다(명진 결정 11/01: 한 벌 저장).
// open(): {status:'ok', cells, from, info} | 그 밖의 status(바탕 없음·열기 실패 → 저장 없이 그대로 돌려줌). 보통 () => openWeekBase({…}).
// known: 마지막으로 읽은 그 주 행({exists, draft, saved_at}) — 없으면 읽는다.
// 반환 {status:'ready', proposed, row, opened:false}(이미 있음 — 바탕을 열지 않음) | {status:'saved', proposed, row, opened:true}
//      | {status:'missing'}(임시저장 칸 준비 전) | {status:<open 의 status>, row, opened:true}(저장 안 함).
// 바탕을 여는 사이 다른 기기가 먼저 proposed 를 썼으면 그것을 쓴다(처음 것이 환류 비교 기준). 쓰기 충돌은 다시 읽고 세 번까지.
export async function ensureWeekProposed({start, known = null, open, now = () => new Date().toISOString()}, rt = window.KPTURuntime) {
  let row = known;
  if (!row) { const read = await readWeekDraft(start, rt); if (read.missing) return {status:'missing'}; row = read.row; }
  const have = readProposed(row.draft?.proposed);
  if (have) return {status:'ready', proposed:have, row, opened:false};
  const got = await open();
  if (got?.status !== 'ok') return {status:got?.status ?? 'none', row, opened:true};
  const proposed = readProposed(proposedOf({at:now(), baseKind:got.from, baseInfo:got.info, cells:got.cells}));
  if (!proposed) return {status:'too_big', row, opened:true};
  for (let attempt = 0; attempt < 3; attempt++) {
    const theirs = readProposed(row.draft?.proposed);
    if (theirs) return {status:'ready', proposed:theirs, row, opened:true};
    const r = await writeWeekDraft({start, known:row, draft:withProposed(row.draft, proposed)}, rt);
    if (r.missing) return {status:'missing'};
    if (r.ok) return {status:'saved', proposed, row:r.row, opened:true};
    row = r.row;
  }
  throw Object.assign(new Error('changed'), {code:'changed'});
}
