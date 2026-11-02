// SEARCH-선택옮기기 남은 일(빠짐11, 요청 2026-10-28 10:44 ①): 전체 검색 결과 안에서 자료실 자료를 바로 골라 자료실 폴더로 옮긴다.
// 자료실 화면으로 넘어가지 않는다. 고르기 창은 자료실·노트와 같은 부품(library-move-picker.js, 줄은 library-move.mjs pickerRows — 찾기·100단 경로·
// [폴더 밖으로]), 쓰는 서버 길은 자료실 폴더와 같은 소유자 표 하나(app_library_folder_items, 소유자 RLS — library-folders.js moveDocs와 같은 쓰기).
// 폴더 묶기와 같이 프로젝트 틀을 보지 않는다(LIB-폴더탐색기, DB 20261026170000_library_folders_free). 기기 저장 없음.
import {createMovePicker} from './library-move-picker.js';
import {pickerRows} from './library-move.mjs';

const T_FOLDERS = '/rest/v1/app_library_folders', T_ITEMS = '/rest/v1/app_library_folder_items';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const enc = encodeURIComponent;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const wide = () => typeof matchMedia === 'function' && matchMedia('(min-width:761px)').matches;
let picker = null;
const sharedPicker = () => (picker ||= createMovePicker({esc}));

export function libraryFolderPlace(folders, id) {
  const f = id && Array.isArray(folders) ? folders.find(x => x.id === id) : null;
  return f ? `\u{1F4C1} ${f.name}` : '폴더 밖';
}

// 폴더 표와 고른 자료의 지금 폴더를 읽는다(자료실 화면과 같은 읽기). 못 읽으면 {ready:false}.
export async function loadLibraryFolders(ids, rt = window.KPTURuntime) {
  const ws = rt?.context?.read?.()?.workspace?.id;
  if (!ws || typeof rt?.api !== 'function') return {ready: false, folders: [], itemFolder: new Map()};
  const good = (ids || []).filter(id => UUID.test(id || ''));
  try {
    const [folders, items] = await Promise.all([
      rt.api(`${T_FOLDERS}?workspace_id=eq.${enc(ws)}&select=id,project_id,parent_id,name,sort_order,created_at&order=sort_order.asc,created_at.asc`),
      good.length ? rt.api(`${T_ITEMS}?workspace_id=eq.${enc(ws)}&document_id=in.(${good.map(enc).join(',')})&select=document_id,folder_id`) : Promise.resolve([]),
    ]);
    const list = Array.isArray(folders) ? folders : [];
    const itemFolder = new Map((Array.isArray(items) ? items : []).filter(x => x?.document_id && x.folder_id).map(x => [x.document_id, x.folder_id]));
    return {ready: true, folders: list, itemFolder, workspace: ws};
  } catch { return {ready: false, folders: [], itemFolder: new Map()}; }
}

// 고르기 창 하나 열기. onPick(folder|null): null = 폴더 밖.
export function openLibraryFolderPicker({anchor, folders, itemFolder = new Map(), docs = [], onPick, onClosed = null}) {
  const docsOk = docs.map(id => ({id, project_id: null}));
  sharedPicker().open({anchor, place: 'below', history: !wide(), canNew: false, canOut: docs.some(id => itemFolder.has(id)),
    rows: q => pickerRows({folders, docs: docsOk, itemFolder, free: true, query: q}),
    onPick: id => onPick(folders.find(f => f.id === id) || null), onOut: () => onPick(null), onClosed});
}
export const libraryPickerOpen = () => !!picker?.isOpen;
export const libraryPickerContains = node => !!picker?.contains?.(node);

// 자료 여러 개를 한 폴더로(하나씩, 자료실과 같은 쓰기). 반환 {done, failed, place, undo}. undo(): 옮긴 자료를 원래 자리로.
export async function moveLibraryDocsToFolder(ids, folder, {rt = window.KPTURuntime, loaded}) {
  const ws = loaded?.workspace, api = rt?.api, folderId = folder?.id || null;
  const where = id => `?document_id=eq.${enc(id)}&workspace_id=eq.${enc(ws)}`;
  const put = async (id, had, to) => {
    if (to === null) { if (had) await api(T_ITEMS + where(id), {method: 'DELETE', prefer: 'return=minimal'}); }
    else if (had) await api(T_ITEMS + where(id), {method: 'PATCH', prefer: 'return=minimal', body: {folder_id: to}});
    else await api(T_ITEMS, {method: 'POST', prefer: 'return=minimal', body: {document_id: id, folder_id: to, workspace_id: ws}});
  };
  const prev = (ids || []).filter(id => UUID.test(id || '')).map(id => ({id, from: loaded.itemFolder.get(id) || null})).filter(p => p.from !== folderId);
  const done = [], failed = [];
  if (!ws || typeof api !== 'function') return {done, failed: prev.map(p => p.id), place: libraryFolderPlace(loaded?.folders, folderId), undo: null};
  for (const p of prev) {
    try { await put(p.id, !!p.from, folderId); done.push(p.id); } catch { failed.push(p.id); }
  }
  const undo = async () => {
    let back = 0;
    for (const id of done) {
      const p = prev.find(x => x.id === id);
      try { await put(id, folderId !== null, p.from); back++; } catch { /* 그 사이 바뀐 자료는 그대로 둔다 */ }
    }
    return back > 0;
  };
  return {done, failed, place: libraryFolderPlace(loaded.folders, folderId), undo: done.length ? undo : null};
}
