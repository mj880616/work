// FOLDER-순서·색 ③-1 (S49-47): 자료실 폴더 표(app_library_folders) 읽기·색 쓰기. 자료실 화면·폴더 고르기 창이 같은 읽기를 쓴다(따로 만들지 않음).
// color(1~8 또는 null)는 migration 20261104213000 뒤에 생기는 칸이다. 적용 전 서버는 이 칸 읽기를 400(42703)으로 거절하므로 color 없이 다시 읽는다(화면은 모든 폴더를 안 고른 폴더로 보인다).
// 색은 표 권한을 넓히지 않고 서버 함수 app_library_folder_set_color(owner만)로만 쓴다. 기기 저장 없음.
const BASE = 'id,project_id,parent_id,name,sort_order,created_at';
const enc = encodeURIComponent;
const columnMissing = error => /(^|\D)400(\D|$)|42703|color/.test(`${error?.status || ''} ${error?.code || ''} ${error?.message || ''}`);
export async function readLibraryFolders(api, workspaceId) {
  const path = select => `/rest/v1/app_library_folders?workspace_id=eq.${enc(workspaceId)}&select=${select}&order=sort_order.asc,created_at.asc`;
  try { return await api(path(BASE + ',color')); }
  catch (error) { if (!columnMissing(error)) throw error; return api(path(BASE)); }
}
export async function setLibraryFolderColor(api, id, color) {
  if (color !== null && !(Number.isInteger(color) && color >= 1 && color <= 8)) throw new Error('폴더 색을 확인하지 못했어요.');
  const result = await api('/rest/v1/rpc/app_library_folder_set_color', {method: 'POST', body: {p_id: id, p_color: color}, singleFlight: false});
  if (!result || result.ok !== true) throw new Error('폴더 색을 저장하지 못했어요.');
  return color;
}
// S61-46: 자료실 폴더 하나 만들기(기존 소유자 RLS REST, 자료실 화면 [+ 새 폴더 만들어 넣기]와 전체 검색 고르기 창이 같은 쓰기). 반환: 만든 줄(id 포함) 또는 null.
export async function createLibraryFolder(api, {workspace, project_id = null, parent_id = null, name, sort_order}) {
  const rows = await api('/rest/v1/app_library_folders', {method: 'POST', prefer: 'return=representation', body: {workspace_id: workspace, project_id, parent_id, name, sort_order}});
  return Array.isArray(rows) ? rows[0] || null : null;
}
