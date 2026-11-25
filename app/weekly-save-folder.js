// S69-67 WEEKLY-저장폴더(명진 11/24 20:12 "주간보고에서 한글파일 만들기를 하든, 내가 수정해서 올리기를 하든 그 파일은 공공팀, 주간보고 폴더로"):
// [주간 보고]의 [확정](만든 한글 파일)과 ② [올리기](내가 수정한 최종본)가 자료실에 저장되면(hwp-drive.js saveWeeklyReport·replaceWeeklyReport, 기존 library-files)
// 그 자료를 사람마다 고른 '주간보고 저장 폴더'에 넣는다. 자료는 하나(복사 아님), 폴더 연결 표 한 줄(owner RLS, library-folder-data.js putDocumentInFolder).
// 규칙은 weekly-save-folder-model.mjs 한 곳. 저장 폴더 = 내 프로필 행 weekly_folder 칸(받는 폴더·모으는 폴더와 같은 내 행 PATCH, owner RLS). 기기 저장 없음.
// 처음 한 번: 칸이 비어 있으면 '주간보고 파일을 ‘○○’ 폴더에 모을까요? [예] [다른 폴더]'. 답하지 않으면 지금처럼(폴더 밖·받는 폴더) 두고 다음 저장 때 다시 묻는다.
// 서버 칸이 아직 없으면(적용 전, 400) 아무것도 하지 않는다(지금처럼).
// 드라이브: 새 옮기기 코드를 두지 않는다. 폴더 연결을 바꾼 뒤 자료실 = 드라이브 폴더 맞추기(workspace-drive drive-mirror 'auto', S69-20/40)를 한 번 부탁해
// 드라이브 파일도 그 폴더의 짝 드라이브 폴더로 옮겨지게 한다(같은 자료의 파일만 바꾼 [올리기]·다시 확정도 새 파일이 자료실 폴더에 놓이므로 같이 옮겨진다).
// S70-11 WEEKLY-저장폴더나누기: 종류별 두 칸 — 'personal'(내 주간 보고) = weekly_folder, 'confirmed'(팀 보고 취합) = weekly_team_folder(migration 20261125193000).
// 팀 칸이 아직 없는 서버(400)면 S69-67 그대로(개인 쪽만, 한 폴더). 규칙(종류별 고르기·하위 폴더가 생기면 한 번 다시 묻기·이름 권하기)은 모델 planWeeklySave 한 곳.
// 남의 기록 안 보기(AGENTS.md 3절): 내 로그인·내 작업공간만 읽고 쓴다.
import {readLibraryFolders, putDocumentInFolder} from './library-folder-data.js';
import {profileUrl} from './library-view-pref.js';
import {notify} from './small-notice.js';
import {weeklyCategoryFilter} from './document-categories.js';
import {isFolderId, isWeeklyKind, WEEKLY_FOLDER_COLUMNS as COL, planWeeklySave, folderPath, WEEKLY_FOLDER_TEXT as T} from './weekly-save-folder-model.mjs';

const enc = encodeURIComponent;
const ctxOf = rt => { const c = rt?.context?.read?.(); return {ws: c?.workspace?.id || '', user: c?.user?.id || ''}; };
const okId = v => v === null || isFolderId(v);

// 두 칸 읽기. {status:'ok', personal, team, legacy}(legacy = 팀 칸이 아직 없는 서버, team은 null) | {status:'pending'}(두 칸 다 없음) | {status:'error'}
// fallback=false(자료실 폴더 메뉴가 들어올 때 읽기): 400이면 개인 칸을 다시 읽지 않고 'pending'(메뉴 줄은 두 칸이 다 있을 때만 쓰므로).
export async function readWeeklyFolders(rt = window.KPTURuntime, {fallback = true} = {}) {
  const url = profileUrl(rt); if (!url) return {status: 'error'};
  const one = async cols => {
    const rows = await rt.api(`${url}&select=${cols}&limit=1`);
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]) return null;
    return rows[0];
  };
  try {
    const row = await one(`${COL.personal},${COL.confirmed}`);
    if (!row) return {status: 'error'};
    if (!(COL.personal in row)) return {status: 'pending'};
    const personal = row[COL.personal] ?? null, legacy = !(COL.confirmed in row), team = legacy ? null : row[COL.confirmed] ?? null;
    return okId(personal) && okId(team) ? {status: 'ok', personal, team, legacy} : {status: 'error'};
  } catch (error) {
    if (Number(error?.status) !== 400) return {status: 'error'};
    if (!fallback) return {status: 'pending'};
    // 팀 칸이 아직 없는 서버: 개인 칸만 다시 읽는다(S69-67 그대로).
    try {
      const row = await one(COL.personal);
      if (!row) return {status: 'error'};
      if (!(COL.personal in row)) return {status: 'pending'};
      const personal = row[COL.personal] ?? null;
      return okId(personal) ? {status: 'ok', personal, team: null, legacy: true} : {status: 'error'};
    } catch (e) { return {status: Number(e?.status) === 400 ? 'pending' : 'error'}; }
  }
}
// S69-67 모양 그대로(개인 칸 하나): {status:'ok', id|null} | {status:'pending'} | {status:'error'}
export async function readWeeklyFolder(rt = window.KPTURuntime) {
  const r = await readWeeklyFolders(rt);
  return r.status === 'ok' ? {status: 'ok', id: r.personal} : {status: r.status};
}
export async function saveWeeklyFolder(id, rt = window.KPTURuntime, kind = 'personal') {
  const url = profileUrl(rt), col = COL[kind]; if (!url || !col || (id !== null && !isFolderId(id))) return false;
  try {
    const saved = await rt.api(url, {method: 'PATCH', prefer: 'return=representation', body: {[col]: id}, singleFlight: false});
    return Array.isArray(saved) && saved.length === 1 && (saved[0]?.[col] ?? null) === id;
  } catch { return false; }
}

// 그 종류(legacy면 두 종류)의 내 지난 주간보고 자료(최근 40개씩, 새것부터)와 그 폴더 연결 줄.
async function pastOf(rt, ws, kinds) {
  try {
    const docs = await Promise.all(kinds.map(k => rt.api(`/rest/v1/app_documents?workspace_id=eq.${enc(ws)}&category=${weeklyCategoryFilter(k)}&select=id,created_at&order=created_at.desc,id.desc&limit=40`).catch(() => [])));
    const rows = docs.flat().filter(d => isFolderId(d?.id)).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || String(b.id).localeCompare(String(a.id)));
    const docIds = [...new Set(rows.map(d => d.id))];
    if (!docIds.length) return {docIds, items: []};
    const items = await rt.api(`/rest/v1/app_library_folder_items?workspace_id=eq.${enc(ws)}&document_id=in.(${docIds.map(enc).join(',')})&select=document_id,folder_id`);
    return {docIds, items: Array.isArray(items) ? items : []};
  } catch { return {docIds: [], items: []}; }
}
async function folderOf(rt, ws, docId) {
  try {
    const rows = await rt.api(`/rest/v1/app_library_folder_items?workspace_id=eq.${enc(ws)}&document_id=eq.${enc(docId)}&select=folder_id&limit=1`);
    return Array.isArray(rows) && rows[0]?.folder_id || null;
  } catch { return null; }
}
// 드라이브 파일도 그 폴더의 짝 드라이브 폴더로: 기존 '앞으로 같게'(drive-mirror auto) 한 번. 실패해도 자료실 화면에 들어올 때 다시 맞춘다.
function askMirror(rt) {
  try { void Promise.resolve(rt.api('/functions/v1/workspace-drive?action=drive-mirror', {method: 'POST', body: {mode: 'auto'}, singleFlight: false})).catch(() => {}); } catch { /* 다음 자료실 방문 때 */ }
}

// 같은 탭에서 두 저장이 겹쳐 두 번 묻지 않게 한 줄로 세운다.
let tail = Promise.resolve();
const queued = work => { const run = tail.then(work, work); tail = run.catch(() => {}); return run; };
let asking = false;

async function pickOther({box, close}, folders, onPick) {
  const {openLibraryFolderPicker} = await import('./library-folder-pick.js');
  openLibraryFolderPicker({anchor: box, folders, onPick: f => { close(); void onPick(f); }, onClosed: () => {}});
}
async function choose(folder, docId, rt, kind, legacy) {
  if (!folder?.id) return;
  if (!(await saveWeeklyFolder(folder.id, rt, kind))) { notify(T.saveFailed, {error: true}); return; }
  await fileWeeklyReport({docId, rt, kind, ask: false, quiet: true});
  const {ws} = ctxOf(rt), folders = await readLibraryFolders(rt.api.bind(rt), ws).catch(() => []);
  const path = folderPath(folder, folders) || folder.name || '';
  notify(legacy ? T.chosen(path) : T.chosenKind(kind, path));
}

// 막 저장한 주간보고 자료 하나(docId)를 그 종류(kind: 'personal' 내 주간 보고 | 'confirmed' 팀 보고 취합)의 저장 폴더에.
// 반환 {status:'filed'|'same'|'asked'|'off'|'error'}.
export function fileWeeklyReport({docId, rt = window.KPTURuntime, kind = 'personal', ask = true, quiet = false} = {}) {
  if (!isFolderId(docId) || !isWeeklyKind(kind)) return Promise.resolve({status: 'off'});
  const owner = ctxOf(rt).user;
  return queued(async () => {
    try {
      const {ws, user} = ctxOf(rt); if (!ws || user !== owner) return {status: 'off'};
      const pref = await readWeeklyFolders(rt);
      if (pref.status === 'pending') return {status: 'off'};
      if (pref.status !== 'ok') return {status: 'error'};
      if (pref.legacy && kind !== 'personal') return {status: 'off'};
      const api = rt.api.bind(rt), folders = await readLibraryFolders(api, ws), list = Array.isArray(folders) ? folders : [];
      const saved = kind === 'personal' ? pref.personal : pref.team;
      const past = await pastOf(rt, ws, pref.legacy ? ['personal', 'confirmed'] : [kind]);
      const plan = planWeeklySave({kind, saved, personal: pref.personal, legacy: pref.legacy, folders: list, items: past.items, docIds: past.docIds, skip: docId});
      if (plan.kind === 'off') return {status: 'off'};
      let asked = false;
      if (plan.kind === 'ask' && ask && !asking) {
        asked = true;
        asking = true; setTimeout(() => { asking = false; }, 21000);
        const done = () => { asking = false; };
        const other = a => void pickOther(a, list, f => { done(); return choose(f, docId, rt, kind, pref.legacy); });
        const path = plan.guess ? folderPath(plan.guess, list) : '';
        const text = pref.legacy ? (plan.guess ? T.ask(path) : T.askPick) : (plan.guess ? T.askKind(kind, path) : T.askPickKind(kind));
        notify(text, {record: false, ms: 20000, actions: plan.guess
          ? [{label: '예', run: ({close}) => { close(); done(); void choose(plan.guess, docId, rt, kind, pref.legacy); }}, {label: '다른 폴더', run: other}]
          : [{label: '폴더 선택', run: other}]});
        // 다시 묻는 동안에도 이번 자료는 정해 둔 폴더에 먼저 넣는다(답하지 않아도 지금처럼 그 폴더).
        if (!plan.again) return {status: 'asked'};
      } else if (plan.kind === 'ask' && !plan.again) return {status: 'off'};
      const folder = plan.kind === 'put' ? plan.folder : list.find(f => f.id === saved);
      if (!folder) return {status: 'off'};
      const path = folderPath(folder, list) || String(folder.name || '');
      if ((await folderOf(rt, ws, docId)) === folder.id) { askMirror(rt); return {status: asked ? 'asked' : 'same', folder}; }
      if (ctxOf(rt).user !== owner) return {status: 'off'};
      if (!(await putDocumentInFolder(api, {workspace: ws, documentId: docId, folderId: folder.id}))) { notify(T.putFailed, {error: true}); return {status: 'error'}; }
      try { window.dispatchEvent(new CustomEvent('kptu:library-folders-changed', {detail: {folder_id: folder.id}})); } catch { /* 목록 새로 고침 알림만 */ }
      askMirror(rt);
      if (asked) return {status: 'asked', folder};
      if (!quiet) notify(pref.legacy ? T.put(path) : T.putKind(kind, path), {actions: [{label: '다른 폴더', run: a => void pickOther(a, list, f => choose(f, docId, rt, kind, pref.legacy))}]});
      return {status: 'filed', folder};
    } catch (error) { console.warn('weekly save folder', error?.status || '', error?.message || ''); return {status: 'error'}; }
  });
}
