// NOTE-탐색기: 노트 폴더 표(app_note_folders, migration 20261028170000) 읽기·쓰기. 기존 owner-RLS REST 길(rt.api)만 쓴다.
// 표가 아직 없으면(DB 적용 전, PostgREST 404/PGRST205) readNoteFolders가 {ready:false}를 돌려주고 화면은 노트에 적힌 이름 폴더를 읽기 전용으로 보인다.
// 기기 저장 없음. 노트가 어느 폴더에 있는지는 basket-data.js setNoteFolderRef(노트 metadata)가 적는다.
const ws = rt => { const id = rt.context.read()?.workspace?.id; if (!id) throw new Error('작업공간을 확인하지 못했어요.'); return encodeURIComponent(id); };
const FIELDS = 'id,parent_id,name,sort_order,created_at';
export async function readNoteFolders(rt = window.KPTURuntime) {
  try {
    const rows = await rt.api(`/rest/v1/app_note_folders?workspace_id=eq.${ws(rt)}&select=${FIELDS}&order=sort_order.asc,created_at.asc&limit=2000`);
    return {ready: true, folders: Array.isArray(rows) ? rows : []};
  } catch (error) {
    // 표가 없거나(적용 전) 읽기가 실패해도 노트 목록은 그대로 보인다: 이름 폴더 읽기 전용(missing: 표 없음, 아니면 일시 실패).
    const text = `${error?.status || ''} ${error?.code || ''} ${error?.message || ''}`;
    return {ready: false, folders: [], missing: /404|PGRST205|42P01|app_note_folders/.test(text)};
  }
}
const one = rows => { if (!Array.isArray(rows) || rows.length !== 1) throw new Error('폴더를 저장하지 못했어요.'); return rows[0]; };
// id(선택): 지운 폴더 되돌리기에서 같은 id로 다시 만든다(노트의 metadata.folder_id가 그대로 이어짐).
export async function createNoteFolder({id, name, parent_id = null, sort_order = 0}, rt = window.KPTURuntime) {
  const body = {workspace_id: rt.context.read()?.workspace?.id, parent_id, name, sort_order, ...(id ? {id} : {})};
  return one(await rt.api('/rest/v1/app_note_folders?select=' + FIELDS, {method: 'POST', prefer: 'return=representation', body}));
}
export async function updateNoteFolder(id, changes, rt = window.KPTURuntime) {
  const body = {};
  for (const key of ['name', 'parent_id', 'sort_order']) if (Object.hasOwn(changes, key)) body[key] = changes[key];
  return one(await rt.api(`/rest/v1/app_note_folders?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${ws(rt)}&select=${FIELDS}`, {method: 'PATCH', prefer: 'return=representation', body}));
}
// 지우면 DB 트리거가 아래 폴더를 한 단 위로 올린다. 노트는 부르는 쪽이 먼저 한 단 위로 옮긴다.
export async function deleteNoteFolder(id, rt = window.KPTURuntime) {
  const rows = await rt.api(`/rest/v1/app_note_folders?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${ws(rt)}&select=id`, {method: 'DELETE', prefer: 'return=representation'});
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('폴더를 지우지 못했어요.');
}
