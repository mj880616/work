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
// LIB-연결줄다읽기(사용자 11/24 16:09·16:32 '폴더로 안 옮겨짐'): 자료 ↔ 폴더 연결 줄 전부. 서버는 한 번에 1000줄까지만 돌려주므로
// (Supabase max rows) 1000줄씩 이어 읽는다. 1000줄에서 잘리면 나머지 자료가 '폴더 밖'으로 보이고, 옮기기가 이미 있는 줄과 겹쳐(409) 전부 실패했다.
export const LIB_ITEM_PAGE = 1000;
export async function readLibraryFolderItems(api, workspaceId, {page = LIB_ITEM_PAGE, max = 200000} = {}) {
  const out = [];
  for (let from = 0; from < max; from += page) {
    const rows = await api(`/rest/v1/app_library_folder_items?workspace_id=eq.${enc(workspaceId)}&select=document_id,folder_id&order=document_id.asc&limit=${page}&offset=${from}`);
    const list = Array.isArray(rows) ? rows : [];
    out.push(...list);
    if (list.length < page) break;
  }
  return out;
}
// ORG-기록자료폴더: 막 올린(또는 모으는) 자료 하나를 폴더 하나에 넣는다(자료 연결 표 한 줄, 소유자 RLS). 자료실 화면 putUploaded와 조직 기록 자료 폴더가 같은 쓰기.
// 받는 폴더 트리거가 이미 연결 줄을 넣었으면(겹침 409) 그 줄을 이 폴더로 고친다. 반환: true(넣음) | false.
export async function putDocumentInFolder(api, {workspace, documentId, folderId}) {
  if (!workspace || !documentId || !folderId) return false;
  const T = '/rest/v1/app_library_folder_items';
  try { await api(T, {method: 'POST', prefer: 'return=minimal', body: {document_id: documentId, folder_id: folderId, workspace_id: workspace}}); return true; }
  catch (e) { if (!(Number(e?.status) === 409 || /23505|duplicate/i.test(`${e?.code || ''} ${e?.message || ''}`))) return false; }
  try { await api(T + `?document_id=eq.${enc(documentId)}&workspace_id=eq.${enc(workspace)}`, {method: 'PATCH', prefer: 'return=minimal', body: {folder_id: folderId}}); return true; }
  catch { return false; }
}
// ORG-기록자료폴더: 담당조직과 짝지은 폴더들(organization_id 칸, migration 20261124160000). 칸이 아직 없는 서버는 400 → null(기능 꺼짐, 지금처럼).
export async function readFolderOrgLinks(api, workspaceId) {
  try {
    const rows = await api(`/rest/v1/app_library_folders?workspace_id=eq.${enc(workspaceId)}&organization_id=not.is.null&select=id,organization_id`);
    if (!Array.isArray(rows)) return [];
    if (rows.some(r => !r || !('organization_id' in r))) return null; // 칸을 모르는 서버(돌려준 줄에 칸이 없음)
    return rows.filter(r => r.organization_id);
  } catch (error) { if (Number(error?.status) === 400) return null; throw error; }
}
// 폴더 하나를 담당조직 하나와 짝짓는다(서버 함수 app_library_folder_set_org — 내 작업공간 폴더·조직만, 같은 조직의 다른 폴더 짝은 서버가 푼다). null = 짝 풀기.
export async function setFolderOrganization(api, id, organizationId) {
  const result = await api('/rest/v1/rpc/app_library_folder_set_org', {method: 'POST', body: {p_id: id, p_org: organizationId || null}, singleFlight: false});
  return !!result && result.ok === true;
}
// MTG-정기회의자료폴더: 정기 회의명과 짝지은 폴더들(meeting_key 칸, migration 20261124213000). 칸이 아직 없는 서버는 400 → null(짝 없이, 이름이 같은 폴더만).
export async function readFolderMeetingLinks(api, workspaceId) {
  try {
    const rows = await api(`/rest/v1/app_library_folders?workspace_id=eq.${enc(workspaceId)}&meeting_key=not.is.null&select=id,meeting_key`);
    if (!Array.isArray(rows)) return [];
    if (rows.some(r => !r || !('meeting_key' in r))) return null; // 칸을 모르는 서버(돌려준 줄에 칸이 없음)
    return rows.filter(r => r.meeting_key);
  } catch (error) { if (Number(error?.status) === 400) return null; throw error; }
}
// 폴더 하나를 회의명 열쇠 하나와 짝짓는다(서버 함수 app_library_folder_set_meeting — 내 작업공간 폴더만, 같은 열쇠의 다른 폴더 짝은 서버가 푼다). null = 짝 풀기.
export async function setFolderMeeting(api, id, meetingKey) {
  const result = await api('/rest/v1/rpc/app_library_folder_set_meeting', {method: 'POST', body: {p_id: id, p_key: meetingKey || null}, singleFlight: false});
  return !!result && result.ok === true;
}
