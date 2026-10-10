// The shared runtime supplies JWTs; the existing owner RLS decides access.
// No note content or drafts are persisted in browser storage.
const PAGE_SIZE = 100;
export function validateNoteText(raw_text) {
  if (typeof raw_text !== 'string' || !raw_text.trim()) throw new Error('글을 입력해 주세요.');
  // PostgreSQL length(text) counts Unicode characters, not UTF-16 code units.
  if ([...raw_text].length > 20000) throw new Error('글은 20,000자까지 저장할 수 있습니다.');
  return raw_text;
}
function workspace(rt) {
  const id = rt.context.read()?.workspace?.id;
  if (!id) throw new Error('업무 공간을 확인할 수 없습니다.');
  return encodeURIComponent(id);
}
function savedRow(rows) {
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('저장 결과를 확인할 수 없습니다. 접근 권한을 확인해 주세요.');
  return rows[0];
}
export async function createNote({raw_text, ai_export_allowed = true}, rt = window.KPTURuntime) {
  validateNoteText(raw_text);
  const workspace_id = rt.context.read()?.workspace?.id;
  workspace(rt);
  return savedRow(await rt.api('/rest/v1/app_notes', {method:'POST', prefer:'return=representation', body:{workspace_id, raw_text, ai_export_allowed}}));
}
export async function updateNote(id, changes, rt = window.KPTURuntime) {
  const body = {updated_at:new Date().toISOString()};
  if (Object.hasOwn(changes, 'raw_text')) body.raw_text = validateNoteText(changes.raw_text);
  if (Object.hasOwn(changes, 'ai_export_allowed')) body.ai_export_allowed = changes.ai_export_allowed;
  if (Object.hasOwn(changes, 'archived_at')) body.archived_at = changes.archived_at;
  return savedRow(await rt.api(`/rest/v1/app_notes?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${workspace(rt)}`, {method:'PATCH', prefer:'return=representation', body}));
}
async function pages(path, rt) {
  const result = [];
  for (let offset = 0;; offset += PAGE_SIZE) {
    const rows = await rt.api(`${path}&limit=${PAGE_SIZE}&offset=${offset}`);
    result.push(...rows);
    if (rows.length < PAGE_SIZE) return result;
  }
}
export async function readBasket(rt = window.KPTURuntime) {
  const scope = `workspace_id=eq.${workspace(rt)}`;
  const notes = await pages(`/rest/v1/app_notes?${scope}&select=id,raw_text,occurred_at,created_at,updated_at,archived_at,ai_export_allowed&order=occurred_at.desc,id.desc`, rt);
  const links = [];
  // Read only links whose source is one of these notes, never task links.
  for (let start = 0; start < notes.length; start += PAGE_SIZE) {
    const ids = notes.slice(start, start + PAGE_SIZE).map(n => encodeURIComponent(n.id)).join(',');
    links.push(...await pages(`/rest/v1/app_record_links?${scope}&note_id=in.(${ids})&select=note_id,status,project_id,organization_id,meeting_id,document_id,project:app_spaces(name),organization:app_suborganizations(name),meeting:app_meetings(title,series_name),document:app_documents(title)&order=id.asc`, rt));
  }
  return {notes, links};
}
export function noteState(note, links) {
  const confirmed = links.filter(l => l.note_id === note.id && l.status === 'confirmed');
  const destinations = confirmed.map(link => {
    for (const [key, label] of [['project','프로젝트'], ['organization','담당조직'], ['meeting','회의'], ['document','자료실']]) {
      if (!link[key + '_id']) continue;
      const name = link[key]?.name || link[key]?.title || link[key]?.series_name;
      return name ? `${label}: ${name}` : '연결 대상 없음';
    }
    return '연결 대상 없음';
  });
  return {status:note.archived_at ? '보관' : confirmed.length ? '확정' : '미분류', destinations};
}
export function visibleNotes(notes, links, filter) {
  return notes.filter(n => filter === 'archived' ? !!n.archived_at : !n.archived_at && (filter === 'all' || noteState(n, links).status === '미분류'));
}
