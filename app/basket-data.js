// The shared runtime supplies JWTs; the existing owner RLS decides access.
// No note content or drafts are persisted in browser storage.
import { noteTasks } from './basket-note-tasks.js';
import { documentCategories, categoryOf } from './document-categories.js';
import { requestsGuard } from './update-requests.js';
import { noteJournalAt, journalGuard, othersGuard, MOVED_KEY } from './update-journal.js';
import { bodyWithoutTitleLine } from './note-markdown.mjs';
import { attachmentName } from './attachment-name.mjs';
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
// ED③ 업데이트: doc (optional) is the new editor's saved form, written with the letters in the same insert (설계 3.1·11.3).
export async function createNote({raw_text, ai_export_allowed, occurred_at, doc}, rt = window.KPTURuntime) {
  validateNoteText(raw_text);
  const workspace_id = rt.context.read()?.workspace?.id;
  workspace(rt);
  return savedRow(await rt.api('/rest/v1/app_notes', {method:'POST', prefer:'return=representation', body:{workspace_id, raw_text, ...(doc ? {doc} : {}), ...(ai_export_allowed === undefined ? {} : {ai_export_allowed}), ...(occurred_at === undefined ? {} : {occurred_at})}}));
}
// ED③ 업데이트: an update made with files is created by the basket-files upload (letters only); its saved form is put on afterwards.
// Only a basket row that has no saved form yet takes it (doc is null), so a form already there is never replaced. The letters are
// not touched. A refusal throws; the caller says the letters are saved and the formats are not.
export async function attachNoteDoc(id, doc, rt = window.KPTURuntime) {
  if (!doc || typeof doc !== 'object') return null;
  const saved = await rt.api(`/rest/v1/app_notes?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${workspace(rt)}&kind=eq.basket&doc=is.null&select=id,updated_at`, {method:'PATCH', prefer:'return=representation', body:{doc}});
  if (!Array.isArray(saved) || saved.length !== 1) throw new Error('서식을 저장하지 못했어요.');
  return saved[0];
}
// ED③ 업데이트: the update's big window (and its edit) saves the saved form with the letters in one PATCH that applies only while the
// row is still the version the editor opened (updated_at): an update changed in another tab or device is refused (code note_changed),
// nothing is overwritten. Same contract as saveNoteDoc for notes.
export async function saveUpdateDoc(id, {raw_text, doc, version}, rt = window.KPTURuntime) {
  validateNoteText(raw_text);
  if (!doc || typeof doc !== 'object') throw new Error('서식을 확인해 주세요.');
  if (typeof version !== 'string' || !Number.isFinite(Date.parse(version))) throw Object.assign(new Error('업데이트를 다시 불러온 뒤 저장해 주세요.'), {code:'note_changed'});
  const where = `/rest/v1/app_notes?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${workspace(rt)}&kind=eq.basket&updated_at=eq.${encodeURIComponent(version)}`;
  const saved = await rt.api(where, {method:'PATCH', prefer:'return=representation', body:{raw_text, doc, updated_at:new Date().toISOString()}});
  if (!Array.isArray(saved) || saved.length !== 1) throw Object.assign(new Error('업데이트가 그사이 바뀌었어요. 다시 불러온 뒤 저장해 주세요.'), {code:'note_changed'});
  return saved[0];
}
export async function updateNote(id, changes, rt = window.KPTURuntime) {
  const body = {updated_at:new Date().toISOString()};
  // ED③ 노트 (설계 3.1·11.3): this is a letters-only edit (the update screen's text box). A row that carries a saved form (doc, e.g. a note
  // moved back to the basket) would then keep a form that no longer matches its letters, so the form is dropped with the same write.
  if (Object.hasOwn(changes, 'raw_text')) { body.raw_text = validateNoteText(changes.raw_text); body.doc = null; }
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
    links.push(...await pages(`/rest/v1/app_record_links?${scope}&note_id=in.(${ids})&select=id,note_id,status,summary,project_id,organization_id,meeting_id,document_id,bundle_id,project:app_spaces(name),organization:app_suborganizations(name),meeting:app_meetings!app_record_links_meeting_id_fkey(title,series_name),document:app_documents(title,category),bundle:app_reference_bundles(name)&order=id.asc`, rt));
  }
  return {notes, links};
}
// doc: also read each update's saved form (the basket screen shows it; the journal and the hand-off read letters only).
export async function readBasket(rt = window.KPTURuntime, {doc = false} = {}) {
  const result = await readKind('basket', 'id,raw_text,' + (doc ? 'doc,' : '') + 'occurred_at,created_at,updated_at,archived_at,ai_export_allowed,attachments,metadata', 'occurred_at.desc,id.desc', rt);
  return {...result, docs: await readFiledDocs(result.notes, rt)};
}
// BUG-자료넣기미분류: [자료로 넣기] puts a memo's files into a project or an organization as library documents
// (app_documents.project_id / organization_id; UI-바구니첨부메모 PR 3) without a record link. Which project or
// organization holds each attachment is read from those documents (same Drive file id, first registered one,
// as basket-file-docs.js does); no new state is stored. A failed read only hides the
// "○○ · 자료" lines, it never blocks the basket.
const DRIVE_ID = /^[A-Za-z0-9_-]{1,255}$/;
async function readFiledDocs(notes, rt) {
  const ids = [...new Set(notes.flatMap(n => Array.isArray(n.attachments) ? n.attachments : []).map(f => String(f?.drive_file_id || '')).filter(id => DRIVE_ID.test(id)))];
  if (!ids.length) return [];
  try {
    const scope = `workspace_id=eq.${workspace(rt)}`, first = new Map();
    for (let start = 0; start < ids.length; start += PAGE_SIZE) {
      for (const row of await pages(`/rest/v1/app_documents?${scope}&file_id=in.(${ids.slice(start, start + PAGE_SIZE).join(',')})&select=id,file_id,project_id,organization_id,category&order=created_at.asc,id.asc`, rt))
        if (row?.file_id && !first.has(row.file_id)) first.set(row.file_id, row);
    }
    const docs = [...first.values()].filter(row => row.project_id || row.organization_id);
    const names = async (table, ids) => {
      const found = new Map(), unique = [...new Set(ids)];
      for (let start = 0; start < unique.length; start += PAGE_SIZE) {
        const list = unique.slice(start, start + PAGE_SIZE).map(encodeURIComponent).join(',');
        for (const row of await pages(`/rest/v1/${table}?${scope}&id=in.(${list})&select=id,name&order=id.asc`, rt)) found.set(row.id, row.name);
      }
      return found;
    };
    const projectNames = await names('app_spaces', docs.map(row => row.project_id).filter(Boolean));
    const organizationNames = await names('app_suborganizations', docs.map(row => row.organization_id).filter(Boolean));
    return docs.map(row => ({id: row.id, file_id: row.file_id, project_id: row.project_id || null, organization_id: row.organization_id || null, category: row.category ?? null, project: {name: projectNames.get(row.project_id) || ''}, organization: {name: organizationNames.get(row.organization_id) || ''}}));
  } catch { return []; }
}
// The organizations that hold this memo's attachments as documents, once each, in attachment order.
export function filedOrganizations(note, docs = []) {
  const byFile = new Map(docs.map(doc => [doc.file_id, doc])), seen = new Map();
  for (const file of Array.isArray(note?.attachments) ? note.attachments : []) {
    const doc = byFile.get(String(file?.drive_file_id || ''));
    if (doc?.organization_id && !seen.has(doc.organization_id)) seen.set(doc.organization_id, {organization_id: doc.organization_id, name: doc.organization?.name || '조직'});
  }
  return [...seen.values()];
}
// The projects that hold this memo's attachments as documents, once each, in attachment order.
export function filedProjects(note, docs = []) {
  const byFile = new Map(docs.map(doc => [doc.file_id, doc])), seen = new Map();
  for (const file of Array.isArray(note?.attachments) ? note.attachments : []) {
    const doc = byFile.get(String(file?.drive_file_id || ''));
    if (doc?.project_id && !seen.has(doc.project_id)) seen.set(doc.project_id, {project_id: doc.project_id, name: doc.project?.name || '프로젝트'});
  }
  return [...seen.values()];
}
// MEMO-노트: notes are listed by the day they were last changed.
// ED③ 노트: doc = the new editor's saved form ({v:'ed1', doc}; null = a note written before it, shown the old way).
const NOTE_FIELDS = 'id,title,raw_text,occurred_at,created_at,updated_at,archived_at,ai_export_allowed,attachments,metadata,doc';
export function readNoteDocs(rt = window.KPTURuntime) {
  return readKind('note', NOTE_FIELDS, 'updated_at.desc,id.desc', rt);
}
// One note again (after its files were saved): the same owner-RLS read as the list. null when it is gone.
export async function readNoteDoc(id, rt = window.KPTURuntime) {
  const rows = await rt.api(`/rest/v1/app_notes?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${workspace(rt)}&kind=eq.note&select=${NOTE_FIELDS}`, {singleFlight:false});
  if (!Array.isArray(rows)) throw new Error('노트를 확인하지 못했어요.');
  return rows.find(row => row?.id === id) || null;
}
// BUG-업데이트첨부연결: one basket update again (after its files went up, for its version and saved files). null when it is gone.
export async function readBasketNote(id, rt = window.KPTURuntime) {
  const rows = await rt.api(`/rest/v1/app_notes?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${workspace(rt)}&kind=eq.basket&select=id,raw_text,doc,occurred_at,created_at,updated_at,archived_at,ai_export_allowed,attachments,metadata`, {singleFlight:false});
  if (!Array.isArray(rows)) throw new Error('업데이트를 확인하지 못했어요.');
  return rows.find(row => row?.id === id) || null;
}
// NOTE-파일붙이기 [빼기]: the file leaves this note only; the Drive file is never touched (no delete, no trash, no move).
// The same owner-RLS PATCH as the other note writes: the row is read again and the PATCH only applies while it is still the
// version read (updated_at — every attachment writer, basket-files included, moves it), so a file added meanwhile is never
// dropped. Only attachments and updated_at are written; the other columns (metadata: pin, folder, …) are left as they are.
export async function detachNoteFile(id, fileId, rt = window.KPTURuntime, now = new Date()) {
  const base = `/rest/v1/app_notes?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${workspace(rt)}&kind=eq.note`;
  const rows = await rt.api(`${base}&select=id,updated_at,attachments`, {singleFlight:false});
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.updated_at) throw Object.assign(new Error('노트를 찾지 못했어요.'), {code:'note_missing'});
  const fresh = rows[0], files = Array.isArray(fresh.attachments) ? fresh.attachments : [];
  const kept = files.filter(file => file?.drive_file_id !== fileId);
  if (kept.length === files.length) return {row:await readNoteDoc(id, rt), already:true};
  const saved = await rt.api(`${base}&updated_at=eq.${encodeURIComponent(fresh.updated_at)}&select=${NOTE_FIELDS}`, {method:'PATCH', prefer:'return=representation', body:{attachments:kept, updated_at:now.toISOString()}});
  if (!Array.isArray(saved) || saved.length !== 1) throw Object.assign(new Error('노트가 그사이 바뀌었어요. 다시 불러온 뒤 빼 주세요.'), {code:'note_changed'});
  return {row:saved[0], already:false};
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
  const line = String(note?.raw_text || '').split(/\r?\n/).map(value => value.trim()).find(Boolean) || (note?.attachments?.[0] ? attachmentName(note.attachments[0], '') : '');
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
// NOTE-마크다운선택: markdown (true/false) is the window's [마크다운] box, kept in the row's existing metadata jsonb (metadata.markdown).
// ED③ 노트: doc (optional) is the new editor's saved form; raw_text is then the letters taken out of it (ed-text.mjs toPlain).
export async function createNoteDoc({title, raw_text, markdown, doc}, rt = window.KPTURuntime) {
  const body = {kind:'note', title:validateNoteTitle(title), raw_text:validateNoteBody(raw_text), ...(typeof markdown === 'boolean' ? {metadata:{markdown}} : {}), ...(doc ? {doc} : {})};
  const workspace_id = rt.context.read()?.workspace?.id;
  workspace(rt);
  return savedRow(await rt.api('/rest/v1/app_notes', {method:'POST', prefer:'return=representation', body:{workspace_id, ...body}}));
}
// markdown (optional, NOTE-마크다운선택): true/false to keep as metadata.markdown with the text. Without it the save is the same
// PATCH as before. With it the row is read again and the other metadata keys are kept: the PATCH only applies while the row is
// still the version read (updated_at and the keys the other metadata writers guard), as the pin and folder writes do.
// ED③ 노트: with doc (the new editor's saved form) and version (the updated_at of the version the editor opened), title, letters and doc are
// written together in one PATCH that applies only while the row is still that version (a note changed in another tab or device is
// refused, code note_changed, nothing overwritten). metadata is not written, so pin, folder and the other keys stay as they are
// (a pin or folder write does not move updated_at, so it never blocks this save either).
export async function saveNoteDoc(id, {title, raw_text, markdown, doc, version}, rt = window.KPTURuntime) {
  const body = {title:validateNoteTitle(title), raw_text:validateNoteBody(raw_text)};
  if (doc !== undefined) {
    if (!doc || typeof doc !== 'object') throw new Error('노트 서식을 확인해 주세요.');
    if (typeof version !== 'string' || !Number.isFinite(Date.parse(version))) throw Object.assign(new Error('노트를 다시 불러온 뒤 저장해 주세요.'), {code:'note_changed'});
    const where = `/rest/v1/app_notes?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${workspace(rt)}&kind=eq.note&updated_at=eq.${encodeURIComponent(version)}&select=${NOTE_FIELDS}`;
    const saved = await rt.api(where, {method:'PATCH', prefer:'return=representation', body:{...body, doc, updated_at:new Date().toISOString()}});
    if (!Array.isArray(saved) || saved.length !== 1) throw Object.assign(new Error('노트가 그사이 바뀌었어요. 다시 불러온 뒤 저장해 주세요.'), {code:'note_changed'});
    return saved[0];
  }
  if (typeof markdown !== 'boolean') return patchKind(id, 'note', body, rt);
  const base = `/rest/v1/app_notes?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${workspace(rt)}&kind=eq.note`;
  const rows = await rt.api(`${base}&select=id,updated_at,metadata`, {singleFlight:false});
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.updated_at) throw new Error('노트를 찾지 못했어요.');
  const fresh = rows[0], old = plainObject(fresh.metadata) ? fresh.metadata : {};
  const guard = `updated_at=eq.${encodeURIComponent(fresh.updated_at)}${metaGuardValue('pinned_at', old.pinned_at)}${metaGuardValue('folder', old.folder)}${requestsGuard(old)}${journalGuard(old)}${taskGuard(firstTaskId(old))}`;
  const saved = await rt.api(`${base}&${guard}`, {method:'PATCH', prefer:'return=representation', body:{...body, metadata:{...old, markdown}, updated_at:new Date().toISOString()}});
  if (!Array.isArray(saved) || saved.length !== 1) throw Object.assign(new Error('노트가 그사이 바뀌었어요. 다시 불러온 뒤 저장해 주세요.'), {code:'note_changed'});
  return saved[0];
}
// Links, attachments and tasks stay on the same row; its kind and title change and metadata.moved_from_update_at (the time it
// moved; the work journal's "노트: (title)" line reads it) is added. The other metadata keys are kept: the row is read again
// and the PATCH only applies while it is still the version read (updated_at, the mark itself and the keys the other
// metadata writers of an update guard), so a change made elsewhere is never overwritten.
export async function moveToNote(id, title, rt = window.KPTURuntime, now = new Date()) {
  const checked = validateNoteTitle(title);
  const base = `/rest/v1/app_notes?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${workspace(rt)}&kind=eq.basket`;
  const rows = await rt.api(`${base}&select=id,updated_at,metadata,raw_text`, {singleFlight:false});
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.updated_at) throw Object.assign(new Error('업데이트를 찾지 못했어요.'), {code:'note_missing'});
  const fresh = rows[0], old = plainObject(fresh.metadata) ? fresh.metadata : {};
  const guard = `updated_at=eq.${encodeURIComponent(fresh.updated_at)}${metaGuardValue(MOVED_KEY, old[MOVED_KEY])}${journalGuard(old)}${othersGuard(old)}`;
  // NOTE-마크다운선택 (날짜 두 번): a first line that starts with a date and became the title is not kept again in the body.
  // The guard above (updated_at) makes sure it is the text that was read. A moved update was written as plain text: markdown off
  // unless it already uses markdown marks (the same guess as an old note: metadata.markdown is left unset).
  const text = typeof fresh.raw_text === 'string' ? fresh.raw_text : null, body = text == null ? text : bodyWithoutTitleLine(text, checked);
  const saved = await rt.api(`${base}&${guard}&select=id,updated_at,metadata`, {method:'PATCH', prefer:'return=representation', body:{kind:'note', title:checked, ...(body != null && body !== text.replace(/\r\n?/g, '\n') ? {raw_text:body} : {}), metadata:{...old, [MOVED_KEY]:now.toISOString()}, updated_at:new Date().toISOString()}});
  if (!Array.isArray(saved) || saved.length !== 1) throw Object.assign(new Error('업데이트가 그사이 바뀌었어요. 다시 불러온 뒤 눌러 주세요.'), {code:'note_changed'});
  return saved[0];
}
// UI-노트고정: a pinned note keeps the time it was pinned in its existing metadata jsonb (metadata.pinned_at, an ISO time;
// no new column, no database change, like metadata.tasks and the diary's metadata.photo_comments). Other metadata keys are
// kept. Pinning is not an edit: updated_at (the note's "고친 날" and the list order) is not touched. The PATCH only applies
// while the row is the version that was read (updated_at and the pin value), so a change made elsewhere is never overwritten.
const plainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
export const notePinnedAt = note => { const value = plainObject(note?.metadata) ? note.metadata.pinned_at : null; return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null; };
// Pinned notes first (most recently pinned on top), then the rest by last change, as before.
export function sortNotes(notes) {
  const time = value => Date.parse(value) || 0;
  return notes.slice().sort((a, b) => {
    const pa = notePinnedAt(a), pb = notePinnedAt(b);
    if (!!pa !== !!pb) return pa ? -1 : 1;
    return (pa ? time(pb) - time(pa) : 0) || time(b.updated_at) - time(a.updated_at) || String(b.id).localeCompare(String(a.id));
  });
}
// Folder and pin share metadata: every metadata write here reads the row again, keeps the other keys, and only applies
// while updated_at, pinned_at and folder are still what it read (so a pin never drops a folder and a move never drops a pin).
// It also guards the request marks already saved on a row (metadata.requests, JOURNAL-요청표시; the screen no longer sets them,
// UI-요청버튼삭제), the work-journal memo mark (metadata.journal_at, update-journal.js) and the first recorded task
// (metadata.tasks, basket-note-tasks.js), so no writer drops another's key.
const metaGuardValue = (key, value) => typeof value === 'string' ? `&metadata->>${key}=eq.${encodeURIComponent(value)}` : value == null ? `&metadata->>${key}=is.null` : '';
// The same guard as noteTaskGuard (basket-note-tasks.js) for the first recorded task.
const taskGuard = id => `&metadata->tasks->0->>task_id=${id == null ? 'is.null' : 'eq.' + encodeURIComponent(typeof id === 'string' ? id : JSON.stringify(id))}`;
const firstTaskId = metadata => { const first = Array.isArray(metadata.tasks) ? metadata.tasks[0] : null; return plainObject(first) ? first.task_id : null; };
async function patchNoteMetadata(note, change, rt) {
  const base = `/rest/v1/app_notes?id=eq.${encodeURIComponent(note.id)}&workspace_id=eq.${workspace(rt)}&kind=eq.note`;
  const rows = await rt.api(`${base}&select=id,updated_at,metadata`, {singleFlight:false});
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('노트를 찾지 못했어요.');
  const fresh = rows[0], old = plainObject(fresh.metadata) ? fresh.metadata : {};
  const metadata = change({...old});
  if (metadata === null) return fresh;
  const guard = `updated_at=eq.${encodeURIComponent(fresh.updated_at)}${metaGuardValue('pinned_at', old.pinned_at)}${metaGuardValue('folder', old.folder)}${metaGuardValue('folder_id', old.folder_id)}${requestsGuard(old)}${journalGuard(old)}${taskGuard(firstTaskId(old))}`;
  const saved = await rt.api(`${base}&${guard}&select=id,updated_at,metadata`, {method:'PATCH', prefer:'return=representation', body:{metadata}});
  if (!Array.isArray(saved) || saved.length !== 1) throw Object.assign(new Error('노트가 그사이 바뀌었어요. 다시 불러온 뒤 눌러 주세요.'), {code:'note_changed'});
  return saved[0];
}
export function setNotePinned(note, pinned, rt = window.KPTURuntime, now = new Date()) {
  return patchNoteMetadata(note, metadata => {
    if (pinned) metadata.pinned_at = now.toISOString(); else delete metadata.pinned_at;
    return metadata;
  }, rt);
}
// UI-노트폴더 1단계 (docs/design/note-folders.md 결정 1·3): a note's folder is one name in its existing metadata jsonb
// (metadata.folder; no folder = "폴더 없음"). One level, 0 or 1 folder per note, names of 1~20 letters, at most 30 folders,
// notes only. The folder list is the names the notes hold (no stored list, so a folder with no note is not kept).
// A move is not an edit: updated_at is not touched.
export const NOTE_FOLDER_LIMITS = Object.freeze({name:20, count:30});
const RESERVED_FOLDER_NAMES = ['전체', '폴더 없음'];
export function validateFolderName(name) {
  const value = typeof name === 'string' ? name.trim() : '';
  if (!value) throw new Error('폴더 이름을 입력해 주세요.');
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error('폴더 이름은 한 줄로 써 주세요.');
  if ([...value].length > NOTE_FOLDER_LIMITS.name) throw new Error(`폴더 이름은 ${NOTE_FOLDER_LIMITS.name}자까지 쓸 수 있어요.`);
  if (RESERVED_FOLDER_NAMES.includes(value)) throw new Error(`'${value}'은 폴더 이름으로 쓸 수 없어요.`);
  return value;
}
const validFolder = value => { try { return typeof value === 'string' && validateFolderName(value) === value ? value : null; } catch { return null; } };
export const noteFolder = note => plainObject(note?.metadata) ? validFolder(note.metadata.folder) : null;
export function noteFolders(notes, extra = []) {
  return [...new Set([...notes.map(noteFolder), ...extra.map(validFolder)].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
}
// A new folder name for the list `existing`: an existing name is reused; a new one counts toward the 30-folder limit.
export function newFolderName(name, existing) {
  const value = validateFolderName(name);
  if (existing.includes(value)) return {name:value, isNew:false};
  if (existing.length >= NOTE_FOLDER_LIMITS.count) throw new Error(`폴더는 ${NOTE_FOLDER_LIMITS.count}개까지 만들 수 있어요.`);
  return {name:value, isNew:true};
}
// name null = "폴더 없음". from (optional): the folder the note must still be in (rename/delete of a folder note by note);
// a note already in the target is left as it is (no write), so [다시 시도] only finishes the rest.
export function setNoteFolder(note, name, rt = window.KPTURuntime, {from} = {}) {
  const target = name == null ? null : validateFolderName(name);
  return patchNoteMetadata(note, metadata => {
    const now = typeof metadata.folder === 'string' ? metadata.folder : null;
    if (now === target && (target !== null || !Object.hasOwn(metadata, 'folder')) && !Object.hasOwn(metadata, 'folder_id')) return null;
    if (from !== undefined && now !== from) throw Object.assign(new Error('노트가 그사이 다른 폴더로 옮겨졌어요.'), {code:'folder_moved'});
    if (target) metadata.folder = target; else delete metadata.folder;
    delete metadata.folder_id; // 이름으로 고른 폴더(맨 위 폴더): 폴더 표 id는 지운다(note-tree.mjs가 이름으로 찾음)
    return metadata;
  }, rt);
}
// NOTE-탐색기(migration 20261028170000): 폴더 표의 한 폴더({id, name}, null = 폴더 밖)로 옮긴다. id와 이름(옛 화면·되돌리기 대비)을 함께 적고,
// 다른 metadata 칸은 그대로, updated_at은 바꾸지 않는다. fromId(선택): 그 노트가 아직 그 폴더 id에 있을 때만(폴더 지우기 중 이어 하기).
export function setNoteFolderRef(note, folder, rt = window.KPTURuntime, {fromId} = {}) {
  const id = folder?.id || null, name = folder ? String(folder.name || '').trim() : null;
  return patchNoteMetadata(note, metadata => {
    const nowId = typeof metadata.folder_id === 'string' ? metadata.folder_id : null;
    if (fromId !== undefined && nowId !== fromId) throw Object.assign(new Error('노트가 그사이 다른 폴더로 옮겨졌어요.'), {code:'folder_moved'});
    if (nowId === id && (id ? metadata.folder === name : !Object.hasOwn(metadata, 'folder') && !Object.hasOwn(metadata, 'folder_id'))) return null;
    if (id) { metadata.folder_id = id; metadata.folder = name; } else { delete metadata.folder_id; delete metadata.folder; }
    return metadata;
  }, rt);
}
export function moveToBasket(note, rt = window.KPTURuntime) {
  const text = String(note?.raw_text || '');
  if (!text.trim() && !note?.attachments?.length) throw new Error('본문과 첨부가 없는 노트는 정리함으로 돌릴 수 없어요. 본문을 먼저 써 주세요.');
  if ([...text].length > 20000) throw new Error('정리함 업데이트는 20,000자까지라 이 노트는 돌릴 수 없어요. 본문을 줄여 주세요.');
  if (!plainObject(note?.metadata) || (!Object.hasOwn(note.metadata, 'folder') && !Object.hasOwn(note.metadata, 'folder_id'))) return patchKind(note.id, 'note', {kind:'basket', title:null}, rt);
  return moveFolderNoteToBasket(note, rt);
}
// UI-노트폴더: updates have no folders, so the folder goes with the same guarded write (other metadata keys stay).
async function moveFolderNoteToBasket(note, rt) {
  const base = `/rest/v1/app_notes?id=eq.${encodeURIComponent(note.id)}&workspace_id=eq.${workspace(rt)}&kind=eq.note`;
  const rows = await rt.api(`${base}&select=id,updated_at,metadata`, {singleFlight:false});
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('노트를 찾지 못했어요.');
  const fresh = rows[0], metadata = {...(plainObject(fresh.metadata) ? fresh.metadata : {})}, was = metadata.folder, wasId = metadata.folder_id;
  delete metadata.folder; delete metadata.folder_id;
  const saved = await rt.api(`${base}&updated_at=eq.${encodeURIComponent(fresh.updated_at)}${metaGuardValue('folder', was)}${metaGuardValue('folder_id', wasId)}`, {method:'PATCH', prefer:'return=representation', body:{kind:'basket', title:null, metadata, updated_at:new Date().toISOString()}});
  if (!Array.isArray(saved) || saved.length !== 1) throw Object.assign(new Error('노트가 그사이 바뀌었어요. 다시 불러온 뒤 눌러 주세요.'), {code:'note_changed'});
  return saved[0];
}
// A memo counts as classified when it has a confirmed link or its files are a project's documents ([자료로 넣기]).
// REF-참고묶음: a link to a reference bundle (bundle_id, app_reference_bundles) is a place too — "참고: 묶음 이름". It is never
// report material (journal-data.js basketPlaces keeps it apart), but the update has gone somewhere, so it is '확정'.
export const LINK_KINDS = Object.freeze([['project','프로젝트'], ['organization','담당조직'], ['meeting','사업 보고'], ['document','자료실'], ['bundle','참고']]);
export function noteState(note, links, docs = []) {
  const confirmed = links.filter(l => l.note_id === note.id && l.status === 'confirmed');
  const destinations = confirmed.map(link => {
    for (const [key, label] of LINK_KINDS) {
      if (!link[key + '_id']) continue;
      const name = link[key]?.name || link[key]?.title || link[key]?.series_name;
      return name ? `${label}: ${name}` : '연결 대상 없음';
    }
    return '연결 대상 없음';
  });
  const filed = filedProjects(note, docs), filedOrgs = filedOrganizations(note, docs);
  destinations.push(...filedOrgs.map(o => `담당조직 자료: ${o.name}`), ...filed.map(p => `프로젝트 자료: ${p.name}`));
  return {status:note.archived_at ? '보관' : confirmed.length || filed.length || filedOrgs.length ? '확정' : links.some(l => l.note_id === note.id && l.status === 'suggested') ? '분류 제안됨' : '미분류', destinations};
}
// UI-바구니거르기: where a classified memo went, from what is already read (no stored state):
// confirmed record links by target kind, [자료로 넣기] documents (a project's library documents, so both
// 'project' and 'library'), Google tasks made from it (metadata.tasks, basket-note-tasks.js) and the work-journal memo
// mark (metadata.journal_at, update-journal.js; place 'journal' = [업무일지]).
// REF-참고묶음: [참고] = a confirmed link to a reference bundle (read and shown only; attaching comes with the next screen PR).
export const BASKET_PLACES = Object.freeze([['all','전체'], ['organization','담당조직'], ['project','프로젝트'], ['reference','참고'], ['library','자료실'], ['task','할 일'], ['journal','업무일지']]);
export function notePlaces(note, links, docs = []) {
  const places = new Set();
  for (const link of links) {
    if (link.note_id !== note.id || link.status !== 'confirmed') continue;
    if (link.organization_id) places.add('organization');
    if (link.project_id) places.add('project');
    if (link.document_id) places.add('library');
    if (link.meeting_id) places.add('meeting');
    if (link.bundle_id) places.add('reference');
  }
  if (filedProjects(note, docs).length) { places.add('project'); places.add('library'); }
  if (filedOrganizations(note, docs).length) { places.add('organization'); places.add('library'); }
  if (noteTasks(note).length) places.add('task');
  if (noteJournalAt(note)) places.add('journal');
  return places;
}
// A memo has gone somewhere when it is confirmed (noteState), a Google task was made from it, or it was kept as a
// work-journal memo (metadata.journal_at, update-journal.js; BASKET-일지로남기기).
export function noteClassified(note, links, docs = []) {
  return !note.archived_at && (noteState(note, links, docs).status === '확정' || noteTasks(note).length > 0 || !!noteJournalAt(note));
}
// BASKET-일지로남기기: [업무일지에 남기기] is offered only for an update that went to no organization and no project (a confirmed
// organization/project link, or its files put in as their documents); the mark itself can always be removed.
export function noteHasOrgOrProject(note, links, docs = []) {
  return links.some(l => l.note_id === note.id && l.status === 'confirmed' && (l.organization_id || l.project_id))
    || filedProjects(note, docs).length > 0 || filedOrganizations(note, docs).length > 0;
}
export const canKeepInJournal = (note, links, docs = []) => !note.archived_at && !noteJournalAt(note) && !noteHasOrgOrProject(note, links, docs);
// [미분류]: not archived and gone nowhere yet (a stored suggestion still waits here, marked "정리 제안 있음").
// [분류]: gone somewhere, narrowed by place. [보류] (filter value 'archived'): archived. noteState is unchanged.
export function visibleNotes(notes, links, filter, docs = [], place = 'all', sub = 'all') {
  return notes.filter(n => {
    if (filter === 'archived') return !!n.archived_at;
    if (n.archived_at) return false;
    const classified = noteClassified(n, links, docs);
    if (filter !== 'classified') return !classified;
    if (!classified || (place !== 'all' && !notePlaces(n, links, docs).has(place))) return false;
    return sub === 'all' || !SUB_PLACES[place] || placeTargets(n, links, docs, place).has(sub);
  });
}
// UI-바구니거르기2: under [분류]·[담당조직]/[프로젝트]/[자료실], one more row narrows to one organization, one project
// or one of the 7 document categories (document-categories.js). Everything comes from what the basket already reads:
// confirmed links (their organization/project ids and names, a linked document's category) and [자료로 넣기]
// documents (their project and category). [전체]·[할 일] have no second row.
const SUB_PLACES = Object.freeze({organization:'모든 조직', project:'모든 프로젝트', reference:'모든 참고', library:'모든 자료'});
// The documents holding this memo's attachments ([자료로 넣기]), once each, in attachment order.
function filedDocs(note, docs) {
  const byFile = new Map(docs.map(doc => [doc.file_id, doc])), seen = new Map();
  for (const file of Array.isArray(note?.attachments) ? note.attachments : []) {
    const doc = byFile.get(String(file?.drive_file_id || ''));
    if ((doc?.project_id || doc?.organization_id) && !seen.has(doc.id ?? doc.file_id)) seen.set(doc.id ?? doc.file_id, doc);
  }
  return [...seen.values()];
}
// Map of target key → name for one place: organization/project ids, or category names for 자료실.
function placeTargetNames(note, links, docs, place) {
  const targets = new Map();
  for (const link of links) {
    if (link.note_id !== note.id || link.status !== 'confirmed') continue;
    if (place === 'organization' && link.organization_id) targets.set(link.organization_id, link.organization?.name || '');
    if (place === 'project' && link.project_id) targets.set(link.project_id, link.project?.name || '');
    if (place === 'library' && link.document_id) targets.set(categoryOf(link.document?.category), '');
    if (place === 'reference' && link.bundle_id) targets.set(link.bundle_id, link.bundle?.name || '');
  }
  for (const doc of filedDocs(note, docs)) {
    if (place === 'project' && doc.project_id && !targets.get(doc.project_id)) targets.set(doc.project_id, doc.project?.name || '');
    if (place === 'organization' && doc.organization_id && !targets.get(doc.organization_id)) targets.set(doc.organization_id, doc.organization?.name || '');
    if (place === 'library') targets.set(categoryOf(doc.category), '');
  }
  return targets;
}
function placeTargets(note, links, docs, place) { return new Set(placeTargetNames(note, links, docs, place).keys()); }
// The second row's chips for a place, or null for [전체]·[할 일]: [모든 ○○ N] first (N = memos under that place),
// then organizations/projects that hold a memo, most memos first (ties by name), or the 7 categories in their fixed order.
export function placeSubOptions(notes, links, docs, place) {
  const allLabel = SUB_PLACES[place];
  if (!allLabel) return null;
  const inPlace = visibleNotes(notes, links, 'classified', docs, place);
  const counts = new Map(), names = new Map();
  for (const note of inPlace) for (const [key, name] of placeTargetNames(note, links, docs, place)) {
    counts.set(key, (counts.get(key) || 0) + 1);
    if (name && !names.get(key)) names.set(key, name);
  }
  const head = {value:'all', label:`${allLabel} ${inPlace.length}`};
  if (place === 'library') return [head, ...documentCategories().map(name => ({value:name, label:name}))];
  const fallback = place === 'organization' ? '조직' : place === 'reference' ? '참고 묶음' : '프로젝트';
  const rows = [...counts].map(([value, count]) => ({value, label:names.get(value) || fallback, count}));
  rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ko'));
  return [head, ...rows.map(({value, label}) => ({value, label}))];
}
