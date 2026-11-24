// SEARCH-선택옮기기 남은 일(빠짐11, 요청 2026-10-28 10:44 ①): 전체 검색 결과 안에서 자료실 자료를 바로 골라 자료실 폴더로 옮긴다.
// 자료실 화면으로 넘어가지 않는다. 고르기 창은 [파일] '옮길 곳' 창과 같은 부품(S69-62 folder-dest-sheet.js — 폴더 나무 누르면 펼침·선택,
// [새 폴더], [여기에 옮기기], 맨 위 줄 '자료실' = 폴더 밖), 쓰는 서버 길은 자료실 폴더와 같은 소유자 표 하나(app_library_folder_items, 소유자 RLS — library-folders.js moveDocs와 같은 쓰기).
// 폴더 묶기와 같이 프로젝트 틀을 보지 않는다(LIB-폴더탐색기, DB 20261026170000_library_folders_free). 기기 저장 없음.
import {openFolderSheet, folderSheetOpen, folderSheetContains} from './folder-dest-sheet.js';
import {sheetTitle} from './folder-dest-sheet.mjs';
import {readLibraryFolders, createLibraryFolder} from './library-folder-data.js';
import {folderSiblings, nextSortOrder, cleanFolderName, folderErrorText} from './library-tree.js';

const T_ITEMS = '/rest/v1/app_library_folder_items';
const enc = encodeURIComponent;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function libraryFolderPlace(folders, id) {
  const f = id && Array.isArray(folders) ? folders.find(x => x.id === id) : null;
  return f ? `${f.name} 폴더` : '폴더 밖';
}

// 폴더 표와 고른 자료의 지금 폴더를 읽는다(자료실 화면과 같은 읽기). 못 읽으면 {ready:false}.
export async function loadLibraryFolders(ids, rt = window.KPTURuntime) {
  const ws = rt?.context?.read?.()?.workspace?.id;
  if (!ws || typeof rt?.api !== 'function') return {ready: false, folders: [], itemFolder: new Map()};
  const good = (ids || []).filter(id => UUID.test(id || ''));
  try {
    const [folders, items] = await Promise.all([
      readLibraryFolders(rt.api.bind(rt), ws),
      good.length ? rt.api(`${T_ITEMS}?workspace_id=eq.${enc(ws)}&document_id=in.(${good.map(enc).join(',')})&select=document_id,folder_id`) : Promise.resolve([]),
    ]);
    const list = Array.isArray(folders) ? folders : [];
    const itemFolder = new Map((Array.isArray(items) ? items : []).filter(x => x?.document_id && x.folder_id).map(x => [x.document_id, x.folder_id]));
    return {ready: true, folders: list, itemFolder, workspace: ws};
  } catch { return {ready: false, folders: [], itemFolder: new Map()}; }
}

// S69-62: 고르기 창 [새 폴더] — 고른 폴더 안(맨 위 줄이면 폴더 밖)에 자료실 폴더 하나를 만든다(자료실 화면 폴더 묶기와 같은 쓰기 createLibraryFolder).
// 이름은 창이 묻고 여기로 넘긴다. 만든 폴더는 loaded.folders 끝에 더한다. 잘못된 이름·실패는 Error(창이 한 줄 알림).
export async function makeLibraryFolderIn(loaded, parentId, typed, {rt = window.KPTURuntime} = {}) {
  if (!loaded?.workspace || typeof rt?.api !== 'function') throw new Error('자료실 폴더를 읽지 못했어요.');
  const name = cleanFolderName(typed);
  if (!name) throw new Error('폴더 이름은 1~40자로 써 주세요.');
  try {
    const row = await createLibraryFolder(rt.api.bind(rt), {workspace: loaded.workspace, parent_id: parentId || null, name, sort_order: nextSortOrder(folderSiblings(loaded.folders, {free: true, parentId: parentId || null}))});
    if (!row?.id) throw new Error('폴더를 만들지 못했어요.');
    loaded.folders.push(row);
    window.dispatchEvent(new CustomEvent('kptu:library-folders-changed', {detail: {folder_id: row.id}}));
    return row;
  } catch (error) { throw new Error(folderErrorText(error)); }
}

// 고르기 창 하나 열기(S69-62: [파일] '옮길 곳' 창과 같은 창). onPick(folder|null): null = 폴더 밖(맨 위 줄 '자료실').
// loaded(loadLibraryFolders 결과)가 있으면 [새 폴더](고른 폴더 안에 만들고 그 폴더를 고름). docs가 모두 한 폴더에 있으면 그 줄에 '지금 여기'.
// choose:true(모으는 폴더 고르기 같은 '정하기')면 맨 위 줄은 고를 수 없고 단추 글이 goLabel이다.
export function openLibraryFolderPicker({anchor, folders, itemFolder = new Map(), docs = [], onPick, loaded = null, onClosed = null, title = '', goLabel = '', choose = false, recent = [], start}) {
  const places = new Set(docs.map(id => itemFolder.get(id) || null));
  const current = docs.length && places.size === 1 ? [...places][0] : undefined;
  return openFolderSheet({anchor, title: title || sheetTitle(docs.length || 0, '옮길 곳'), rootName: '자료실', folders, recent, current,
    start: start !== undefined && folders.some(f => f.id === start) ? start : current, allowRoot: !choose, rootReason: '폴더를 하나 선택해 주세요',
    goLabel: goLabel || (choose ? '이 폴더로 정하기' : '여기에 옮기기'),
    mkdir: loaded?.workspace ? (parent, name) => makeLibraryFolderIn(loaded, parent, name) : null,
    onGo: id => onPick(id ? folders.find(f => f.id === id) || null : null), onClosed});
}
export const libraryPickerOpen = () => folderSheetOpen();
export const libraryPickerContains = node => folderSheetContains(node);

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
