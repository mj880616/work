// S70-83 READ-저장한글폴더(사용자 결정 2026-11-26 — 저장한 글에 폴더): 저장한 글 폴더의 순수 규칙 한 곳(화면·저장소·네트워크 없음, node --test).
// - 폴더 안 폴더(2026-11-28 사용자 결정 "폴더 안에 폴더도 만들어"): parent_id(DB 20261126123000 app_reading_folders) — 비면 맨 위.
//   100단까지(FOLDER_DEPTH_LIMIT, 서버 트리거와 같은 숫자). 자기 자신·자기 아래로는 못 옮긴다(서버도 거절).
// - 글은 folder_id 하나(비어 있으면 '폴더 없음'). 폴더를 누르면 그 폴더에 바로 든 글만.
// - 고른 곳(state 주인은 reading.js): ''(전체 — 2026-11-28 사용자 결정 "전체 줄을 둬", 기본) · OUTSIDE('폴더 없음') · 폴더 id. 주소 자리 값(?folder=)도 같은 글자.
// - 이름 규칙은 DB 검사와 같다(1~40자, 앞뒤 공백·제어 문자 없음).
import {FOLDER_DEPTH_LIMIT} from './folder-limits.mjs';
import {folderFileText, folderFileLabel} from './folder-count.mjs';

export const OUTSIDE = 'out';
export const OUTSIDE_NAME = '폴더 없음';
export const ALL = 'all'; // 나무 맨 위 '전체' 줄의 화면 키(고른 곳 값은 '')
export const ALL_NAME = '전체';
export const NAME_MAX = 40;
export {FOLDER_DEPTH_LIMIT};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isFolderId = v => typeof v === 'string' && UUID.test(v);

// 고른 곳을 지금 폴더 목록에 맞춘다(없는 폴더 id·이상한 값은 전체).
export function keepFolder(value, folders = []) {
  if (value === OUTSIDE) return OUTSIDE;
  if (isFolderId(value) && folders.some(f => f.id === value)) return value;
  return '';
}

// 그 글의 폴더(없는 폴더를 가리키면 폴더 없음으로 본다 — 지워진 폴더는 서버가 칸을 비우지만, 다시 읽기 전 잠깐).
export function folderOfRow(row, folders = []) {
  const id = row?.folder_id;
  return isFolderId(id) && folders.some(f => f.id === id) ? id : OUTSIDE;
}
// 고른 곳에 드는 글인가(폴더는 그 폴더에 바로 든 글만).
export function inFolder(row, selected, folders = []) {
  if (!selected) return true;
  return folderOfRow(row, folders) === selected;
}

// 폴더 순서: sort_order, 같으면 만든 시각, 같으면 이름.
export function sortFolders(folders = []) {
  return [...folders].sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
    || String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
}
// 새 폴더 순서 값: 같은 자리(형제) 맨 뒤(가장 큰 값 + 1024).
export const nextSort = (folders = []) => folders.reduce((m, f) => Math.max(m, Number(f.sort_order) || 0), 0) + 1024;

// 상위 폴더(목록에 없는 상위를 가리키면 맨 위로 본다 — 다시 읽기 전 잠깐).
export function parentOf(folders = [], id) {
  const f = folders.find(x => x.id === id);
  const p = f?.parent_id || null;
  return p && folders.some(x => x.id === p) ? p : null;
}
// 그 자리(parentId, null = 맨 위)에 바로 든 폴더들(순서대로).
export const childrenOf = (folders = [], parentId = null) => sortFolders(folders.filter(f => parentOf(folders, f.id) === (parentId || null)));
// 맨 위부터 그 폴더까지(그 폴더 포함). 돌고 도는 자료(있을 수 없지만)에서도 멈춘다.
export function folderChain(folders = [], id) {
  const out = [], seen = new Set();
  for (let at = folders.find(f => f.id === id); at && !seen.has(at.id); at = folders.find(f => f.id === parentOf(folders, at.id))) { seen.add(at.id); out.unshift(at); }
  return out;
}
// 그 폴더와 그 아래 모든 폴더 id.
export function descendantIds(folders = [], id) {
  const out = new Set([id]);
  for (let grew = true; grew;) { grew = false; for (const f of folders) { const p = parentOf(folders, f.id); if (p && out.has(p) && !out.has(f.id)) { out.add(f.id); grew = true; } } }
  return out;
}
// 그 폴더의 아래 단 수(자기 포함, 하위가 없으면 1).
function heightOf(folders, id) {
  const kids = childrenOf(folders, id);
  return 1 + (kids.length ? Math.max(...kids.map(k => heightOf(folders, k.id))) : 0);
}
// 폴더(id)를 parentId 아래로 옮길 수 없으면 그 까닭(빈 글 = 옮길 수 있음). 서버 트리거와 같은 규칙.
export function moveBlocked(folders = [], id, parentId = null) {
  if (!parentId) return '';
  if (parentId === id) return '자기 자신 안으로는 옮길 수 없어요';
  if (descendantIds(folders, id).has(parentId)) return '자기 아래 폴더로는 옮길 수 없어요';
  if (folderChain(folders, parentId).length + heightOf(folders, id) > FOLDER_DEPTH_LIMIT) return `폴더는 ${FOLDER_DEPTH_LIMIT}단까지예요`;
  return '';
}
// 그 폴더 안에 새 폴더를 만들 수 있나(100단).
export const canMakeIn = (folders = [], parentId = null) => !parentId || folderChain(folders, parentId).length < FOLDER_DEPTH_LIMIT;

// 나무 줄: 맨 위 '전체'(글 모두) + 폴더 나무(펼친 폴더만 하위가 보임, 고른 폴더의 위 폴더들은 저절로 펼침) + 맨 아래 '폴더 없음'.
// 폴더 줄 개수: 하위 폴더가 있으면 '폴더 N · 글 M', 없으면 그 폴더에 바로 든 글 수(공용 folder-count.mjs).
export function folderTreeRows({folders = [], rows = [], open = new Set(), selected = ''} = {}) {
  const count = new Map();
  for (const r of rows) { const k = folderOfRow(r, folders); count.set(k, (count.get(k) || 0) + 1); }
  const shown = new Set(open);
  if (isFolderId(selected)) for (const f of folderChain(folders, selected).slice(0, -1)) shown.add(f.id);
  const out = [{key: ALL, name: ALL_NAME, depth: 0, count: String(rows.length), countLabel: `글 ${rows.length}개`, hasKids: false, open: false, folder: null}];
  const walk = (parentId, depth, seen) => {
    for (const f of childrenOf(folders, parentId)) {
      if (seen.has(f.id)) continue;
      const kids = childrenOf(folders, f.id).length, n = count.get(f.id) || 0, isOpen = kids > 0 && shown.has(f.id);
      out.push({key: f.id, name: f.name, depth, count: folderFileText(kids, n, {fileWord: '글'}), countLabel: folderFileLabel(kids, n, {fileWord: '글'}), hasKids: kids > 0, open: isOpen, folder: f});
      if (isOpen) walk(f.id, depth + 1, new Set([...seen, f.id]));
    }
  };
  walk(null, 0, new Set());
  const none = count.get(OUTSIDE) || 0;
  out.push({key: OUTSIDE, name: OUTSIDE_NAME, depth: 0, count: String(none), countLabel: `글 ${none}개`, hasKids: false, open: false, folder: null});
  return out;
}

// 이름 다듬기·검사. 틀리면 {ok:false, message}.
export function folderName(text) {
  const name = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return {ok: false, message: '폴더 이름을 적어 주세요'};
  if ([...name].length > NAME_MAX) return {ok: false, message: `폴더 이름은 ${NAME_MAX}자까지예요`};
  if (/[\u0000-\u001f\u007f]/.test(name)) return {ok: false, message: '폴더 이름에 쓸 수 없는 글자가 있어요'};
  return {ok: true, name};
}
// 같은 자리(형제)에 같은 이름이 이미 있나(대소문자·앞뒤 공백 무시). exceptId: 이름을 바꾸는 그 폴더.
export const nameTaken = (folders = [], name = '', exceptId = '', parentId = null) => childrenOf(folders, parentId).some(f => f.id !== exceptId && String(f.name || '').trim().toLowerCase() === String(name).trim().toLowerCase());
