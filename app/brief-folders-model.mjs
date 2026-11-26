// S70-84 BRIEF-두칸폴더(명진 11/26 09:28 "브리핑 룸도 마찬가지 저렇게 미리보기 안보여줘도 되고 파일 이름 기준으로 하고 여기도 폴더 개념이 들어가야하고
// 폴드펼침과 pc에서는 왼쪽 목록 오른쪽 상세"): 브리핑 룸 목록 모델. DOM·네트워크 없음(node --test로 시험).
// - 폴더: 새 표 없이 자료실 폴더 표(app_library_folders)의 '브리핑 요청함' 폴더 아래 폴더를 그대로 쓴다(자료 하나 = 폴더 하나, app_library_folder_items).
//   '브리핑 요청함' 바로 안 자료와 다른 자료실 폴더에 든 채 브리핑을 받은 자료는 '폴더 없음'.
// - 줄: [파일] 목록 줄과 같은 칸(이름 · 넣은 날 · 크기 · 종류). 정렬도 [파일]의 sortRows 하나(폴더는 늘 위, 이름은 한국어·숫자 자연 정렬). 기본 = 이름 오름.
// - 펼침: 폴더 이름 누르기 = 그 자리 펼치기·접기(표준 T5). 펼친 상태는 화면 메모리(기기 저장 없음), '폴더 없음'은 처음부터 펼침.
import {sortRows, kindOf, kindLabel, sizeText, SORTS, SORT_NAME} from './files-model.mjs';
import {naturalCompare} from './head-sort.mjs';

export const NONE = 'none';               // '폴더 없음' 줄 열쇠(펼침 상태·놓을 곳)
export const NONE_LABEL = '폴더 없음';
export const BRIEF_SORT_KEYS = SORTS;      // name·modified·size·kind (DB brief_sort 검사와 같음)
export const BRIEF_SORT_NAME = Object.freeze({...SORT_NAME, modified: '넣은 날'});
export const DEFAULT_SORT = Object.freeze({key: 'name', dir: 'asc'});
export const cleanSort = v => (v && BRIEF_SORT_KEYS.includes(v.key) && (v.dir === 'asc' || v.dir === 'desc') ? {key: v.key, dir: v.dir} : {...DEFAULT_SORT});

/** 자료 → [파일] 줄 모양(files-model.mjs가 읽는 칸). */
export const fileLike = doc => ({
  name: String(doc?.title || doc?.file_name || '이름 없는 자료'), mime: String(doc?.mime_type || ''),
  size_bytes: Number.isFinite(Number(doc?.file_size)) && doc?.file_size !== null && doc?.file_size !== undefined ? Number(doc.file_size) : null,
  modified_at: doc?.created_at || '', item_id: String(doc?.id || ''), is_folder: false,
});
// 종류: [파일]과 같은 이름(PDF·한글·워드…). 파일 이름 확장자로 본다(제목에는 확장자가 없을 수 있다).
export const kindText = doc => kindLabel({name: String(doc?.file_name || doc?.title || ''), mime: String(doc?.mime_type || '')});
export const kindKey = doc => kindOf({name: String(doc?.file_name || doc?.title || ''), mime: String(doc?.mime_type || '')});
export const sizeOf = doc => sizeText(fileLike(doc).size_bytes);

/**
 * '브리핑 요청함'(rootId) 아래 폴더(지운 것 제외). 맨 위 단계는 parent_id = null로 바꿔 돌려준다(폴더 고르기 창·나무가 그대로 쓰게).
 * @param {{id:string,parent_id:string|null,name:string,sort_order?:number,deleted_at?:string|null}[]} folders 내 자료실 폴더 전부
 */
export function briefSubtree(folders, rootId) {
  if (!rootId) return [];
  const all = (Array.isArray(folders) ? folders : []).filter(f => f && typeof f.id === 'string' && !f.deleted_at);
  const kids = new Map();
  for (const f of all) { const p = f.parent_id || null; if (!kids.has(p)) kids.set(p, []); kids.get(p).push(f); }
  const out = [], seen = new Set([rootId]);
  const walk = parent => { for (const f of kids.get(parent) || []) { if (seen.has(f.id)) continue; seen.add(f.id); out.push({...f, parent_id: parent === rootId ? null : parent}); walk(f.id); } };
  walk(rootId);
  return out;
}
/** 자료가 든 브리핑 폴더 id(브리핑 요청함 바로 안·다른 자료실 폴더·폴더 없음이면 null). */
export const folderOfDoc = (docId, itemFolder, subIds) => { const f = itemFolder?.get?.(docId); return f && subIds.has(f) ? f : null; };
/** 폴더 id와 그 아래 폴더 id 전부. */
export function descendants(sub, id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) { grew = false; for (const f of sub) if (f.parent_id && out.has(f.parent_id) && !out.has(f.id)) { out.add(f.id); grew = true; } }
  return out;
}
/** 폴더 하나를 다른 곳(null = 맨 위)으로 옮길 수 있나. 자기 자신·자기 아래로는 못 옮긴다. */
export const canMoveFolder = (sub, id, to) => !!id && !(to && descendants(sub, id).has(to));

/** 목록 정렬: [파일] sortRows 그대로(자료 → 파일 줄 모양으로 바꿔 정렬하고 원래 줄로 돌려준다). */
export function sortBriefRows(rows, sort = DEFAULT_SORT) {
  const s = cleanSort(sort), byKey = new Map();
  const files = (rows || []).map(r => { const f = fileLike(r.doc); byKey.set(f.item_id, r); f.kindText = kindText(r.doc); return f; });
  // 종류 정렬은 파일 이름 확장자로 본다(제목에는 확장자가 없을 수 있어 [파일] sortRows의 종류 대신).
  const sorted = s.key === 'kind'
    ? [...files].sort((a, b) => (s.dir === 'desc' ? -1 : 1) * (naturalCompare(a.kindText, b.kindText) || naturalCompare(a.name, b.name)) || a.item_id.localeCompare(b.item_id))
    : sortRows(files, s.key, s.dir);
  return sorted.map(f => byKey.get(f.item_id));
}
const folderSort = (list, sort) => { const s = cleanSort(sort), sign = s.key === 'name' && s.dir === 'desc' ? -1 : 1; return [...list].sort((a, b) => sign * naturalCompare(a.name, b.name) || String(a.id).localeCompare(String(b.id))); };

/**
 * 그릴 줄 한 벌(그 자리 펼치는 나무). 폴더가 하나도 없으면 자료 줄만(지금까지와 같은 한 목록).
 * 폴더가 있으면: 맨 위 폴더들(펼친 폴더 아래 하위 폴더 → 자료, 빈 폴더는 '빈 폴더' 줄) → 맨 아래 '폴더 없음'(펼치면 그 자료).
 * @returns {{type:'folder'|'none'|'file'|'empty', depth:number, id?:string, folder?:object, row?:object, open?:boolean, count?:number, hasContent?:boolean}[]}
 */
export function treeRows({sub = [], rows = [], itemFolder = new Map(), open = new Set(), sort = DEFAULT_SORT} = {}) {
  const subIds = new Set(sub.map(f => f.id));
  const byFolder = new Map();
  for (const r of rows) { const k = folderOfDoc(r.doc.id, itemFolder, subIds) || NONE; if (!byFolder.has(k)) byFolder.set(k, []); byFolder.get(k).push(r); }
  if (!sub.length) return sortBriefRows(byFolder.get(NONE) || [], sort).map(row => ({type: 'file', depth: 0, row}));
  const kids = new Map();
  for (const f of sub) { const p = f.parent_id || null; if (!kids.has(p)) kids.set(p, []); kids.get(p).push(f); }
  const countOf = id => [...descendants(sub, id)].reduce((n, x) => n + (byFolder.get(x)?.length || 0), 0);
  const out = [];
  const walk = (parent, depth) => {
    for (const f of folderSort(kids.get(parent) || [], sort)) {
      const files = byFolder.get(f.id) || [], childFolders = kids.get(f.id) || [], isOpen = open.has(f.id);
      out.push({type: 'folder', depth, id: f.id, folder: f, open: isOpen, count: countOf(f.id), hasContent: !!(files.length || childFolders.length)});
      if (!isOpen) continue;
      walk(f.id, depth + 1);
      for (const row of sortBriefRows(files, sort)) out.push({type: 'file', depth: depth + 1, row});
      if (!files.length && !childFolders.length) out.push({type: 'empty', depth: depth + 1, id: f.id});
    }
  };
  walk(null, 0);
  const none = byFolder.get(NONE) || [], noneOpen = !open.has('!' + NONE);
  out.push({type: 'none', depth: 0, id: NONE, open: noneOpen, count: none.length, hasContent: none.length > 0});
  if (noneOpen) { for (const row of sortBriefRows(none, sort)) out.push({type: 'file', depth: 1, row}); if (!none.length) out.push({type: 'empty', depth: 1, id: NONE}); }
  return out;
}
/** 펼침 바꾸기('폴더 없음'은 처음부터 펼침이라 접힘을 '!none'으로 적는다). 새 Set을 돌려준다. */
export function toggleOpen(open, id) {
  const next = new Set(open);
  if (id === NONE) { if (next.has('!' + NONE)) next.delete('!' + NONE); else next.add('!' + NONE); return next; }
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}
/** 폴더 이름 정리(자료실 폴더와 같은 규칙: 앞뒤 빈칸·제어 문자 빼고 1~40자). 맞지 않으면 빈 글. */
export function cleanFolderName(v) {
  const s = String(v ?? '').replace(/[\p{Cc}]/gu, '').replace(/\s+/g, ' ').trim();
  return s.length >= 1 && s.length <= 40 ? s : '';
}
