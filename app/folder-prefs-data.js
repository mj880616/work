// FOLDER-순서·색 ③-2 (S49-50): [파일]·사진 폴더(원드라이브·구글 드라이브)의 색·순서를 서버 표 app_folder_prefs에서 읽고 쓴다(앨범은 app_photo_tags 칸).
// 읽기: owner 정책 표를 그대로 읽는다. 표가 아직 없는(DB 적용 전) 서버는 빈 값으로 본다(모든 폴더 = 안 고른 폴더·이름순). 기기 저장 없음.
// 쓰기: 표 쓰기 권한 없이 서버 함수(owner만)로만 한다. 한 번에 200줄까지라 더 많으면 나눠 보낸다.
// 클라우드의 실제 폴더 이름·순서는 건드리지 않는다(Web2 안에서만 보이는 꾸미기).
import {isFolderColor} from './folder-look-model.mjs';
const enc = encodeURIComponent;
const CHUNK = 200;
const missingTable = error => /404|PGRST205|42P01|app_folder_prefs/.test(`${error?.status || ''} ${error?.code || ''} ${error?.message || ''}`);
export async function readFolderPrefs(api, workspaceId) {
  try {
    const rows = await api(`/rest/v1/app_folder_prefs?workspace_id=eq.${enc(workspaceId)}&select=source,folder_key,color,sort_order&limit=5000`);
    return Array.isArray(rows) ? rows : [];
  } catch (error) { if (missingTable(error)) return []; throw error; }
}
const checkItem = item => {
  if (!item || typeof item.k !== 'string' || !item.k) return false;
  if ('c' in item && item.c !== null && !isFolderColor(item.c)) return false;
  if ('o' in item && item.o !== null && !Number.isInteger(item.o)) return false;
  return true;
};
export async function applyFolderPrefs(api, workspaceId, source, items) {
  if (!items.length || !items.every(checkItem)) throw new Error('폴더 색·순서를 확인하지 못했어요.');
  for (let i = 0; i < items.length; i += CHUNK) {
    const result = await api('/rest/v1/rpc/app_folder_prefs_apply', {method: 'POST', body: {p_workspace_id: workspaceId, p_source: source, p_items: items.slice(i, i + CHUNK)}, singleFlight: false});
    if (!result || result.ok !== true) throw new Error('폴더 색·순서를 저장하지 못했어요.');
  }
  return true;
}
// 앨범(app_photo_tags 칸 color·sort_order). items = [{id, c?, o?}].
export async function applyAlbumLook(api, workspaceId, items) {
  if (!items.length || !items.every(item => item && typeof item.id === 'string' && (!('c' in item) || item.c === null || isFolderColor(item.c)) && (!('o' in item) || Number.isInteger(item.o)))) throw new Error('앨범 색·순서를 확인하지 못했어요.');
  for (let i = 0; i < items.length; i += CHUNK) {
    const result = await api('/rest/v1/rpc/app_photo_tag_look_apply', {method: 'POST', body: {p_workspace_id: workspaceId, p_items: items.slice(i, i + CHUNK)}, singleFlight: false});
    if (!result || result.ok !== true) throw new Error('앨범 색·순서를 저장하지 못했어요.');
  }
  return true;
}
