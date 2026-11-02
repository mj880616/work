// NOTE-읽생기아이디어 ① 댓글 표(app_note_comments, migration 20261102203000) 읽기·쓰기. 기존 owner-RLS REST 길(rt.api)만 쓴다. 기기 저장 없음.
// 표가 아직 없으면(DB 적용 전, PostgREST 404/PGRST205) readNoteComments가 {ready:false, missing:true}를 돌려주고 화면은 댓글 칸만 '준비 중'으로 보인다.
const ws = rt => { const id = rt.context.read()?.workspace?.id; if (!id) throw new Error('작업공간을 확인하지 못했어요.'); return id; };
const FIELDS = 'id,note_id,kind,quote,body,created_at';
export async function readNoteComments(rt = window.KPTURuntime) {
  try {
    const rows = await rt.api(`/rest/v1/app_note_comments?workspace_id=eq.${encodeURIComponent(ws(rt))}&select=${FIELDS}&order=created_at.desc,id.desc&limit=5000`);
    return {ready: true, comments: Array.isArray(rows) ? rows : []};
  } catch (error) {
    const text = `${error?.status || ''} ${error?.code || ''} ${error?.message || ''}`;
    return {ready: false, comments: [], missing: /404|PGRST205|42P01|app_note_comments/.test(text)};
  }
}
export async function addNoteComment({note_id, kind, quote, body}, rt = window.KPTURuntime) {
  const rows = await rt.api(`/rest/v1/app_note_comments?select=${FIELDS}`, {method: 'POST', prefer: 'return=representation', body: {workspace_id: ws(rt), note_id, kind, quote, body}});
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('댓글을 저장하지 못했어요.');
  return rows[0];
}
export async function deleteNoteComment(id, rt = window.KPTURuntime) {
  const rows = await rt.api(`/rest/v1/app_note_comments?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(ws(rt))}&select=id`, {method: 'DELETE', prefer: 'return=representation'});
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('댓글을 지우지 못했어요.');
}
