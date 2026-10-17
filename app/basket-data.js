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
export async function createNote({raw_text, ai_export_allowed}, rt = window.KPTURuntime) {
  validateNoteText(raw_text);
  const workspace_id = rt.context.read()?.workspace?.id;
  workspace(rt);
  return savedRow(await rt.api('/rest/v1/app_notes', {method:'POST', prefer:'return=representation', body:{workspace_id, raw_text, ...(ai_export_allowed === undefined ? {} : {ai_export_allowed})}}));
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
// app_notes also holds notes, work lines and diary rows (MEMO-노트·JOURNAL-일지); each list reads one kind only.
async function readKind(kind, fields, order, rt) {
  const scope = `workspace_id=eq.${workspace(rt)}`;
  const notes = await pages(`/rest/v1/app_notes?${scope}&kind=eq.${kind}&select=${fields}&order=${order}`, rt);
  const links = [];
  // Read only links whose source is one of these notes, never task links.
  for (let start = 0; start < notes.length; start += PAGE_SIZE) {
    const ids = notes.slice(start, start + PAGE_SIZE).map(n => encodeURIComponent(n.id)).join(',');
    links.push(...await pages(`/rest/v1/app_record_links?${scope}&note_id=in.(${ids})&select=id,note_id,status,summary,project_id,organization_id,meeting_id,document_id,project:app_spaces(name),organization:app_suborganizations(name),meeting:app_meetings(title,series_name),document:app_documents(title)&order=id.asc`, rt));
  }
  return {notes, links};
}
export function readBasket(rt = window.KPTURuntime) {
  return readKind('basket', 'id,raw_text,occurred_at,created_at,updated_at,archived_at,ai_export_allowed,attachments,metadata', 'occurred_at.desc,id.desc', rt);
}
// MEMO-노트: notes are listed by the day they were last changed.
export function readNoteDocs(rt = window.KPTURuntime) {
  return readKind('note', 'id,title,raw_text,occurred_at,created_at,updated_at,archived_at,ai_export_allowed,attachments,metadata', 'updated_at.desc,id.desc', rt);
}
// The database checks the same limits (app_notes_title_check, app_notes_raw_text_check); these give plain messages first.
export const NOTE_LIMITS = Object.freeze({title:200, text:100000});
export function validateNoteTitle(title) {
  if (typeof title !== 'string' || !title.trim()) throw new Error('노트 제목을 입력해 주세요.');
  if (/[\r\n]/.test(title)) throw new Error('노트 제목은 한 줄로 써 주세요.');
  if ([...title].length > NOTE_LIMITS.title) throw new Error('노트 제목은 200자까지 쓸 수 있어요.');
  return title;
}
export function validateNoteBody(text) {
  if (typeof text !== 'string') throw new Error('노트 본문을 확인해 주세요.');
  if ([...text].length > NOTE_LIMITS.text) throw new Error('노트 본문은 100,000자까지 저장할 수 있어요.');
  return text;
}
// [노트로 옮기기] suggests the memo's first line (or its first file) as the title.
export function suggestNoteTitle(note) {
  const line = String(note?.raw_text || '').split(/\r?\n/).map(value => value.trim()).find(Boolean) || note?.attachments?.[0]?.file_name || '';
  return [...line].slice(0, NOTE_LIMITS.title).join('');
}
// Same owner-RLS PATCH as updateNote. The kind filter keeps each write on the row kind the screen showed.
async function patchKind(id, kind, body, rt) {
  return savedRow(await rt.api(`/rest/v1/app_notes?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${workspace(rt)}&kind=eq.${kind}`, {method:'PATCH', prefer:'return=representation', body:{...body, updated_at:new Date().toISOString()}}));
}
// A note written without a title (the [+] draft's empty title, menu [쓰기]) takes its first line, minus a heading mark.
export function noteTitleFromText(text) {
  const line = String(text ?? '').split(/\r?\n/).map(value => value.trim()).find(Boolean) || '';
  return [...line.replace(/^#{1,6}\s+/, '')].slice(0, NOTE_LIMITS.title).join('').trim();
}
// [노트] [+] and menu [쓰기]: a new kind=note row through the same owner-RLS insert as createNote.
export async function createNoteDoc({title, raw_text}, rt = window.KPTURuntime) {
  const body = {kind:'note', title:validateNoteTitle(title), raw_text:validateNoteBody(raw_text)};
  const workspace_id = rt.context.read()?.workspace?.id;
  workspace(rt);
  return savedRow(await rt.api('/rest/v1/app_notes', {method:'POST', prefer:'return=representation', body:{workspace_id, ...body}}));
}
export function saveNoteDoc(id, {title, raw_text}, rt = window.KPTURuntime) {
  return patchKind(id, 'note', {title:validateNoteTitle(title), raw_text:validateNoteBody(raw_text)}, rt);
}
// Links, attachments and tasks stay on the same row; only its kind and title change.
export function moveToNote(id, title, rt = window.KPTURuntime) {
  return patchKind(id, 'basket', {kind:'note', title:validateNoteTitle(title)}, rt);
}
export function moveToBasket(note, rt = window.KPTURuntime) {
  const text = String(note?.raw_text || '');
  if (!text.trim() && !note?.attachments?.length) throw new Error('본문과 첨부가 없는 노트는 바구니로 돌릴 수 없어요. 본문을 먼저 써 주세요.');
  if ([...text].length > 20000) throw new Error('바구니 메모는 20,000자까지라 이 노트는 돌릴 수 없어요. 본문을 줄여 주세요.');
  return patchKind(note.id, 'note', {kind:'basket', title:null}, rt);
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
  return {status:note.archived_at ? '보관' : confirmed.length ? '확정' : links.some(l => l.note_id === note.id && l.status === 'suggested') ? '분류 제안됨' : '미분류', destinations};
}
export function visibleNotes(notes, links, filter) {
  return notes.filter(n => filter === 'archived' ? !!n.archived_at : !n.archived_at && (filter === 'all' || noteState(n, links).status === '미분류'));
}
