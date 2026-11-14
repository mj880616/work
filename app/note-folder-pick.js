// 노트를 넣을 폴더 고르기(노트 화면 밖에서 여는 곳: 상단 PC [새 노트]의 [폴더 ▾], 전체 검색 결과의 노트 [폴더로 옮기기 ›]).
// NOTE-탐색기 후속 ⑤(2026-10-28): 노트 화면과 같은 폴더 나무 고르기 창(library-move-picker.js, 줄은 library-move.mjs pickerRows — 찾기·100단 경로·
// [폴더 밖으로])을 쓴다. 폴더 목록은 노트 폴더 표(note-folders-data.js, 기존 owner-RLS 읽기 길), 노트에 쓰는 일은 basket-data.js setNoteFolderRef
// (폴더 id+이름, 노트 화면과 같은 서버 길) 하나다. 기기 저장은 쓰지 않는다(처음 고른 폴더는 서버 화면 설정 note_folder의 이름에서만 읽음).
import {createMovePicker} from './library-move-picker.js';
import {pickerRows} from './library-move.mjs';
import {viewPrefs} from './view-prefs.js';
import {readNoteFolders, createNoteFolder} from './note-folders-data.js';
import {folderSiblings, nextSortOrder, cleanFolderName} from './library-tree.js';
import {noteFolderErrorText} from './note-tree.mjs';
import {askText, notify} from './small-notice.js';
import {setNoteFolderRef} from './basket-data.js';
import {folderFromView, folderIdFromName, noteFolderPlace} from './note-folder-pick.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const wide = () => typeof matchMedia === 'function' && matchMedia('(min-width:761px)').matches;
let picker = null;
const sharedPicker = () => (picker ||= createMovePicker({esc}));

// 폴더 표를 한 번 읽는다. 표가 없거나 읽지 못하면 {ready:false, folders:[]} — 고르기 창은 [폴더 밖으로]만 보인다.
export async function loadNoteFolders(rt = window.KPTURuntime) {
  const result = await readNoteFolders(rt);
  return {ready: !!result.ready, folders: result.ready ? result.folders : []};
}

// S61-46 UI-새폴더넣기안됨: [+ 새 폴더 만들어 넣기] — 이름을 공용 작은 글 입력창으로 받아 맨 위에 노트 폴더 하나를 만든다
// (노트 화면 newFolder와 같은 서버 길 createNoteFolder, 기존 owner-RLS). 만든 폴더는 folders 배열 끝에 더한다. 취소·실패 = null(실패는 한 줄 알림).
export async function makeNoteFolder(folders, {rt = window.KPTURuntime, anchor = null} = {}) {
  const typed = await askText(anchor?.isConnected ? anchor : document.activeElement, {text: '새 폴더 이름 (40자까지)', ok: '만들기', max: 40});
  if (typed === null) return null;
  const name = cleanFolderName(typed);
  if (!name) { notify('폴더 이름은 1~40자로 써 주세요.', {error: true}); return null; }
  try {
    const row = await createNoteFolder({name, parent_id: null, sort_order: nextSortOrder(folderSiblings(folders, {free: true, parentId: null}))}, rt);
    folders.push(row);
    window.dispatchEvent(new CustomEvent('kptu:basket-notes-restored'));
    return row;
  } catch (error) { notify(noteFolderErrorText(error), {error: true}); return null; }
}

// 고르기 창 하나 열기(노트 화면 밖 공용). onPick(folder|null): null = 폴더 밖.
// newFolder:true면 [+ 새 폴더 만들어 넣기]로 새 폴더를 만들어 곧바로 onPick(새 폴더) — 없으면 그 단추를 그리지 않는다.
export function openNoteFolderPicker({anchor, folders, onPick, onClosed = null, newFolder = true, rt = window.KPTURuntime}) {
  sharedPicker().open({anchor, place: 'below', history: !wide(), canNew: !!newFolder, canOut: true,
    rows: q => pickerRows({folders, free: true, query: q}),
    onPick: id => onPick(folders.find(f => f.id === id) || null), onOut: () => onPick(null), onClosed,
    onNew: newFolder ? async () => { const made = await makeNoteFolder(folders, {rt, anchor}); if (made) await onPick(made); } : null});
}

// 노트들이 지금 든 폴더(되돌리기용): 기존 owner-RLS 읽기 길로 metadata만 읽어 폴더 표의 폴더(없으면 null = 폴더 밖)로 바꾼다.
async function noteFoldersNow(ids, folders, rt) {
  const ws = rt.context.read()?.workspace?.id;
  if (!ws || !ids.length) return new Map();
  const rows = await rt.api(`/rest/v1/app_notes?workspace_id=eq.${encodeURIComponent(ws)}&kind=eq.note&id=in.(${ids.map(encodeURIComponent).join(',')})&select=id,metadata`, {singleFlight: false});
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const meta = row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata : {};
    const id = typeof meta.folder_id === 'string' ? meta.folder_id : folderIdFromName(folders, meta.folder);
    out.set(row.id, folders.find(f => f.id === id) || null);
  }
  return out;
}
// 노트 여러 개를 한 폴더로(전체 검색 결과). 한 번에 하나씩 노트 화면과 같은 서버 길(setNoteFolderRef)로 쓴다.
// 반환 undo(): 옮긴 노트를 원래 폴더로(그 사이 다른 폴더로 옮겨진 노트는 건드리지 않음 — fromId 확인).
export async function moveNotesToFolder(ids, folder, {rt = window.KPTURuntime, folders = []} = {}) {
  let before = new Map();
  try { before = await noteFoldersNow(ids, folders, rt); } catch { before = new Map(); }
  const done = [], failed = [];
  for (const id of ids) {
    try { await setNoteFolderRef({id}, folder, rt); done.push(id); } catch { failed.push(id); }
  }
  const undo = async () => {
    let back = 0;
    for (const id of done) {
      if (!before.has(id)) continue;
      try { await setNoteFolderRef({id}, before.get(id), rt, {fromId: folder?.id || null}); back++; } catch { /* 그 사이 바뀐 노트는 그대로 둔다 */ }
    }
    return back > 0;
  };
  return {done, failed, place: noteFolderPlace(folders, folder?.id || null), undo: before.size ? undo : null};
}

// initial: 처음 고른 폴더 이름(서버 화면 설정에서 읽은 옛 이름, 없으면 null). 폴더 표를 읽은 뒤 같은 이름의 맨 위 폴더로 바꿔 둔다.
// title: 창 이름. onChange(): 고른 뒤 단추를 다시 그리라는 알림.
export function createNoteFolderPick({rt = window.KPTURuntime, initial = null, title = '노트를 넣을 폴더', onChange = null} = {}) {
  const owner = rt.session.read()?.user?.id;
  let folders = [], value = null, wantedName = initial || null, flight = null, closed = false, failed = false;
  const watchers = onChange ? [onChange] : [], tell = () => watchers.forEach(fn => fn());
  const alive = () => !closed && rt.session.read()?.user?.id === owner;
  const folderOf = id => folders.find(f => f.id === id) || null;
  function load() {
    flight ||= loadNoteFolders(rt).then(result => {
      folders = result.folders;
      if (wantedName && !value) { value = folderIdFromName(folders, wantedName); wantedName = null; if (value) tell(); }
      return folders;
    }).catch(() => { flight = null; return []; });
    return flight;
  }
  return {
    title,
    get: () => value,
    label: () => folderOf(value)?.name || '폴더 없음',
    load,
    watch: fn => { watchers.push(fn); },
    // note-window.js의 noteFolder 자리: 단추를 누르면 폴더 나무 고르기 창이 단추 아래(PC)나 아래 시트(폰)로 열린다.
    async open(trigger) {
      await load();
      if (!alive()) return;
      openNoteFolderPicker({anchor: trigger, folders, rt, onPick: folder => { value = folder?.id || null; tell(); }});
    },
    // 새 노트를 저장한 뒤 고른 폴더에 넣는다(폴더 밖이면 쓰지 않음). 반환: 넣은 폴더 이름 또는 null.
    async put(note) {
      const folder = folderOf(value);
      if (!folder) return null;
      try { await setNoteFolderRef({id: note.id}, folder, rt); } catch (error) { failed = true; throw error; }
      return folder.name;
    },
    close() { closed = true; if (picker?.isOpen) void picker.close(); },
    failed: () => failed,
  };
}
// 새 노트의 기본 폴더(이름): 노트 화면 옛 화면 설정(서버). 보지 않았거나 전체·'폴더 없음'이면 null = 폴더 밖.
export function lastViewedFolder() {
  return folderFromView(viewPrefs.get('note_folder'));
}
