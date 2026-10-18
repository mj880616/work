// The shared runtime supplies JWTs; the existing owner RLS decides access.
// No note content or drafts are persisted in browser storage.
import { noteTasks } from './basket-note-tasks.js';
import { DOCUMENT_CATEGORIES, categoryOf } from './document-categories.js';
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
export async function createNote({raw_text, ai_export_allowed, occurred_at}, rt = window.KPTURuntime) {
  validateNoteText(raw_text);
  const workspace_id = rt.context.read()?.workspace?.id;
  workspace(rt);
  return savedRow(await rt.api('/rest/v1/app_notes', {method:'POST', prefer:'return=representation', body:{workspace_id, raw_text, ...(ai_export_allowed === undefined ? {} : {ai_export_allowed}), ...(occurred_at === undefined ? {} : {occurred_at})}}));
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
    links.push(...await pages(`/rest/v1/app_record_links?${scope}&note_id=in.(${ids})&select=id,note_id,status,summary,project_id,organization_id,meeting_id,document_id,project:app_spaces(name),organization:app_suborganizations(name),meeting:app_meetings(title,series_name),document:app_documents(title,category)&order=id.asc`, rt));
  }
  return {notes, links};
}
export async function readBasket(rt = window.KPTURuntime) {
  const result = await readKind('basket', 'id,raw_text,occurred_at,created_at,updated_at,archived_at,ai_export_allowed,attachments,metadata', 'occurred_at.desc,id.desc', rt);
  return {...result, docs: await readFiledDocs(result.notes, rt)};
}
// BUG-자료넣기미분류: [자료로 넣기] puts a memo's files into a project as library documents (app_documents.project_id)
// without a record link. Which project holds each attachment is read from those documents (same Drive file id,
// first registered one, as basket-file-docs.js does); no new state is stored. A failed read only hides the
// "○○ · 자료" lines, it never blocks the basket.
const DRIVE_ID = /^[A-Za-z0-9_-]{1,255}$/;
async function readFiledDocs(notes, rt) {
  const ids = [...new Set(notes.flatMap(n => Array.isArray(n.attachments) ? n.attachments : []).map(f => String(f?.drive_file_id || '')).filter(id => DRIVE_ID.test(id)))];
  if (!ids.length) return [];
  try {
    const scope = `workspace_id=eq.${workspace(rt)}`, first = new Map();
    for (let start = 0; start < ids.length; start += PAGE_SIZE) {
      for (const row of await pages(`/rest/v1/app_documents?${scope}&file_id=in.(${ids.slice(start, start + PAGE_SIZE).join(',')})&select=id,file_id,project_id,category&order=created_at.asc,id.asc`, rt))
        if (row?.file_id && !first.has(row.file_id)) first.set(row.file_id, row);
    }
    const docs = [...first.values()].filter(row => row.project_id);
    const projects = [...new Set(docs.map(row => row.project_id))], names = new Map();
    for (let start = 0; start < projects.length; start += PAGE_SIZE) {
      const list = projects.slice(start, start + PAGE_SIZE).map(encodeURIComponent).join(',');
      for (const row of await pages(`/rest/v1/app_spaces?${scope}&id=in.(${list})&select=id,name&order=id.asc`, rt)) names.set(row.id, row.name);
    }
    return docs.map(row => ({id: row.id, file_id: row.file_id, project_id: row.project_id, category: row.category ?? null, project: {name: names.get(row.project_id) || ''}}));
  } catch { return []; }
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
// A memo counts as classified when it has a confirmed link or its files are a project's documents ([자료로 넣기]).
export function noteState(note, links, docs = []) {
  const confirmed = links.filter(l => l.note_id === note.id && l.status === 'confirmed');
  const destinations = confirmed.map(link => {
    for (const [key, label] of [['project','프로젝트'], ['organization','담당조직'], ['meeting','회의'], ['document','자료실']]) {
      if (!link[key + '_id']) continue;
      const name = link[key]?.name || link[key]?.title || link[key]?.series_name;
      return name ? `${label}: ${name}` : '연결 대상 없음';
    }
    return '연결 대상 없음';
  });
  const filed = filedProjects(note, docs);
  destinations.push(...filed.map(p => `프로젝트 자료: ${p.name}`));
  return {status:note.archived_at ? '보관' : confirmed.length || filed.length ? '확정' : links.some(l => l.note_id === note.id && l.status === 'suggested') ? '분류 제안됨' : '미분류', destinations};
}
// UI-바구니거르기: where a classified memo went, from what is already read (no stored state):
// confirmed record links by target kind, [자료로 넣기] documents (a project's library documents, so both
// 'project' and 'library'), and Google tasks made from it (metadata.tasks, basket-note-tasks.js).
export const BASKET_PLACES = Object.freeze([['all','전체'], ['organization','담당조직'], ['project','프로젝트'], ['library','자료실'], ['task','할 일']]);
export function notePlaces(note, links, docs = []) {
  const places = new Set();
  for (const link of links) {
    if (link.note_id !== note.id || link.status !== 'confirmed') continue;
    if (link.organization_id) places.add('organization');
    if (link.project_id) places.add('project');
    if (link.document_id) places.add('library');
    if (link.meeting_id) places.add('meeting');
  }
  if (filedProjects(note, docs).length) { places.add('project'); places.add('library'); }
  if (noteTasks(note).length) places.add('task');
  return places;
}
// A memo has gone somewhere when it is confirmed (noteState) or a Google task was made from it.
export function noteClassified(note, links, docs = []) {
  return !note.archived_at && (noteState(note, links, docs).status === '확정' || noteTasks(note).length > 0);
}
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
const SUB_PLACES = Object.freeze({organization:'모든 조직', project:'모든 프로젝트', library:'모든 자료'});
// The documents holding this memo's attachments ([자료로 넣기]), once each, in attachment order.
function filedDocs(note, docs) {
  const byFile = new Map(docs.map(doc => [doc.file_id, doc])), seen = new Map();
  for (const file of Array.isArray(note?.attachments) ? note.attachments : []) {
    const doc = byFile.get(String(file?.drive_file_id || ''));
    if (doc?.project_id && !seen.has(doc.id ?? doc.file_id)) seen.set(doc.id ?? doc.file_id, doc);
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
  }
  for (const doc of filedDocs(note, docs)) {
    if (place === 'project' && !targets.get(doc.project_id)) targets.set(doc.project_id, doc.project?.name || '');
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
  if (place === 'library') return [head, ...DOCUMENT_CATEGORIES.map(name => ({value:name, label:name}))];
  const fallback = place === 'organization' ? '조직' : '프로젝트';
  const rows = [...counts].map(([value, count]) => ({value, label:names.get(value) || fallback, count}));
  rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ko'));
  return [head, ...rows.map(({value, label}) => ({value, label}))];
}
