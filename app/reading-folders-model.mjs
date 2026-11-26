// S70-83 READ-저장한글폴더(명진 2026-11-26 09:28 "저장한 글에도 폴더개념이 들어가야함"): 저장한 글 폴더의 순수 규칙 한 곳(화면·저장소·네트워크 없음, node --test).
// - 폴더는 한 단계(폴더 안 폴더 없음 — DB 20261126120000 app_reading_folders에 상위 칸 없음). 글은 folder_id 하나(비어 있으면 '폴더 없음').
// - 고른 곳(state 주인은 reading.js): ''(전체) · OUTSIDE('폴더 없음') · 폴더 id. 주소 자리 값(?folder=)도 같은 글자.
// - 이름 규칙은 DB 검사와 같다(1~40자, 앞뒤 공백·제어 문자 없음).
export const OUTSIDE = 'out';
export const OUTSIDE_NAME = '폴더 없음';
export const NAME_MAX = 40;
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
// 고른 곳에 드는 글인가.
export function inFolder(row, selected, folders = []) {
  if (!selected) return true;
  return folderOfRow(row, folders) === selected;
}

// 폴더 순서: sort_order, 같으면 만든 시각, 같으면 이름.
export function sortFolders(folders = []) {
  return [...folders].sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
    || String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
}
// 새 폴더 순서 값: 맨 뒤(가장 큰 값 + 1024).
export const nextSort = (folders = []) => folders.reduce((m, f) => Math.max(m, Number(f.sort_order) || 0), 0) + 1024;

// 나무 줄: 폴더들(순서대로) + 맨 아래 '폴더 없음'. 개수는 그 폴더에 든 글 수.
export function folderRows(folders = [], rows = []) {
  const count = new Map();
  for (const r of rows) { const k = folderOfRow(r, folders); count.set(k, (count.get(k) || 0) + 1); }
  return [...sortFolders(folders).map(f => ({key: f.id, name: f.name, count: count.get(f.id) || 0, folder: f})),
    {key: OUTSIDE, name: OUTSIDE_NAME, count: count.get(OUTSIDE) || 0, folder: null}];
}

// 이름 다듬기·검사. 틀리면 {ok:false, message}.
export function folderName(text) {
  const name = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return {ok: false, message: '폴더 이름을 적어 주세요'};
  if ([...name].length > NAME_MAX) return {ok: false, message: `폴더 이름은 ${NAME_MAX}자까지예요`};
  if (/[\u0000-\u001f\u007f]/.test(name)) return {ok: false, message: '폴더 이름에 쓸 수 없는 글자가 있어요'};
  return {ok: true, name};
}
// 같은 이름이 이미 있나(대소문자·앞뒤 공백 무시). exceptId: 이름을 바꾸는 그 폴더.
export const nameTaken = (folders = [], name = '', exceptId = '') => folders.some(f => f.id !== exceptId && String(f.name || '').trim().toLowerCase() === String(name).trim().toLowerCase());
