// S69-67 WEEKLY-저장폴더(명진 11/24 20:12 "주간보고에서 한글파일 만들기를 하든, 내가 수정해서 올리기를 하든 그 파일은 공공팀, 주간보고 폴더로"):
// [주간 보고]의 [확정](만든 한글 파일)과 ② [올리기](내가 수정한 최종본)가 자료실에 저장되면(hwp-drive.js saveWeeklyReport·replaceWeeklyReport, 기존 library-files)
// 그 자료를 사람마다 고른 '주간보고 저장 폴더'에 넣는다. 자료는 하나(복사 아님), 폴더 연결 표 한 줄(owner RLS, library-folder-data.js putDocumentInFolder).
// 규칙은 weekly-save-folder-model.mjs 한 곳. 저장 폴더 = 내 프로필 행 weekly_folder 칸(받는 폴더·모으는 폴더와 같은 내 행 PATCH, owner RLS). 기기 저장 없음.
// 처음 한 번: 칸이 비어 있으면 '주간보고 파일을 ‘○○’ 폴더에 모을까요? [예] [다른 폴더]'. 답하지 않으면 지금처럼(폴더 밖·받는 폴더) 두고 다음 저장 때 다시 묻는다.
// 서버 칸이 아직 없으면(적용 전, 400) 아무것도 하지 않는다(지금처럼).
// 드라이브: 새 옮기기 코드를 두지 않는다. 폴더 연결을 바꾼 뒤 자료실 = 드라이브 폴더 맞추기(workspace-drive drive-mirror 'auto', S69-20/40)를 한 번 부탁해
// 드라이브 파일도 그 폴더의 짝 드라이브 폴더로 옮겨지게 한다(같은 자료의 파일만 바꾼 [올리기]·다시 확정도 새 파일이 자료실 폴더에 놓이므로 같이 옮겨진다).
// 남의 기록 안 보기(AGENTS.md 3절): 내 로그인·내 작업공간만 읽고 쓴다.
import {readLibraryFolders, putDocumentInFolder} from './library-folder-data.js';
import {profileUrl} from './library-view-pref.js';
import {notify} from './small-notice.js';
import {weeklyCategoryFilter} from './document-categories.js';
import {isFolderId, liveWeeklyFolder, planWeeklyFolder, guessWeeklyFolder, folderPath, WEEKLY_FOLDER_TEXT as T} from './weekly-save-folder-model.mjs';

const enc = encodeURIComponent;
const ctxOf = rt => { const c = rt?.context?.read?.(); return {ws: c?.workspace?.id || '', user: c?.user?.id || ''}; };

// {status:'ok', id|null} | {status:'pending'}(칸이 아직 없는 서버) | {status:'error'}
export async function readWeeklyFolder(rt = window.KPTURuntime) {
  const url = profileUrl(rt); if (!url) return {status: 'error'};
  try {
    const rows = await rt.api(`${url}&select=weekly_folder&limit=1`);
    if (!Array.isArray(rows) || rows.length !== 1) return {status: 'error'};
    if (!rows[0] || !('weekly_folder' in rows[0])) return {status: 'pending'};
    const v = rows[0].weekly_folder ?? null;
    return v === null || isFolderId(v) ? {status: 'ok', id: v} : {status: 'error'};
  } catch (error) { return {status: Number(error?.status) === 400 ? 'pending' : 'error'}; }
}
export async function saveWeeklyFolder(id, rt = window.KPTURuntime) {
  const url = profileUrl(rt); if (!url || (id !== null && !isFolderId(id))) return false;
  try {
    const saved = await rt.api(url, {method: 'PATCH', prefer: 'return=representation', body: {weekly_folder: id}, singleFlight: false});
    return Array.isArray(saved) && saved.length === 1 && (saved[0]?.weekly_folder ?? null) === id;
  } catch { return false; }
}

// 권할 폴더: 내 지난 주간보고 자료(개인·팀 확정본 분류, 최근 40개)가 가장 많이 든 폴더.
async function guessFrom(rt, ws, folders, skip) {
  try {
    const docs = await Promise.all(['personal', 'confirmed'].map(kind => rt.api(`/rest/v1/app_documents?workspace_id=eq.${enc(ws)}&category=${weeklyCategoryFilter(kind)}&select=id&order=created_at.desc,id.desc&limit=40`).catch(() => [])));
    const ids = [...new Set(docs.flat().map(d => d?.id).filter(id => isFolderId(id) && id !== skip))];
    if (!ids.length) return null;
    const items = await rt.api(`/rest/v1/app_library_folder_items?workspace_id=eq.${enc(ws)}&document_id=in.(${ids.map(enc).join(',')})&select=document_id,folder_id`);
    return guessWeeklyFolder({folders, items: Array.isArray(items) ? items : [], docIds: ids, skip});
  } catch { return null; }
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
async function choose(folder, docId, rt) {
  if (!folder?.id) return;
  if (!(await saveWeeklyFolder(folder.id, rt))) { notify(T.saveFailed, {error: true}); return; }
  await fileWeeklyReport({docId, rt, ask: false, quiet: true});
  const {ws} = ctxOf(rt), folders = await readLibraryFolders(rt.api.bind(rt), ws).catch(() => []);
  notify(T.chosen(folderPath(folder, folders) || folder.name || ''));
}

// 막 저장한 주간보고 자료 하나(docId)를 저장 폴더에. 반환 {status:'filed'|'same'|'asked'|'off'|'error'}.
export function fileWeeklyReport({docId, rt = window.KPTURuntime, ask = true, quiet = false} = {}) {
  if (!isFolderId(docId)) return Promise.resolve({status: 'off'});
  const owner = ctxOf(rt).user;
  return queued(async () => {
    try {
      const {ws, user} = ctxOf(rt); if (!ws || user !== owner) return {status: 'off'};
      const pref = await readWeeklyFolder(rt);
      if (pref.status === 'pending') return {status: 'off'};
      if (pref.status !== 'ok') return {status: 'error'};
      const api = rt.api.bind(rt), folders = await readLibraryFolders(api, ws), list = Array.isArray(folders) ? folders : [];
      const guess = liveWeeklyFolder(pref.id, list) ? null : await guessFrom(rt, ws, list, docId);
      const plan = planWeeklyFolder({saved: pref.id, folders: list, guess});
      if (plan.kind === 'off') return {status: 'off'};
      if (plan.kind === 'ask') {
        if (!ask || asking) return {status: 'off'};
        asking = true; setTimeout(() => { asking = false; }, 21000);
        const done = () => { asking = false; };
        const other = a => void pickOther(a, list, f => { done(); return choose(f, docId, rt); });
        notify(plan.guess ? T.ask(folderPath(plan.guess, list)) : T.askPick, {record: false, ms: 20000, actions: plan.guess
          ? [{label: '예', run: ({close}) => { close(); done(); void choose(plan.guess, docId, rt); }}, {label: '다른 폴더', run: other}]
          : [{label: '폴더 선택', run: other}]});
        return {status: 'asked'};
      }
      const folder = plan.folder, path = folderPath(folder, list) || String(folder.name || '');
      if ((await folderOf(rt, ws, docId)) === folder.id) { askMirror(rt); return {status: 'same', folder}; }
      if (ctxOf(rt).user !== owner) return {status: 'off'};
      if (!(await putDocumentInFolder(api, {workspace: ws, documentId: docId, folderId: folder.id}))) { notify(T.putFailed, {error: true}); return {status: 'error'}; }
      try { window.dispatchEvent(new CustomEvent('kptu:library-folders-changed', {detail: {folder_id: folder.id}})); } catch { /* 목록 새로 고침 알림만 */ }
      askMirror(rt);
      if (!quiet) notify(T.put(path), {actions: [{label: '다른 폴더', run: a => void pickOther(a, list, f => choose(f, docId, rt))}]});
      return {status: 'filed', folder};
    } catch (error) { console.warn('weekly save folder', error?.status || '', error?.message || ''); return {status: 'error'}; }
  });
}
