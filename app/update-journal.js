// BASKET-일지로남기기: an update (app_notes kind=basket) that fits no organization or project can be kept as a work-journal
// memo. The mark is the time it was set, in the row's existing metadata jsonb as metadata.journal_at (an ISO time; no new
// column, no database change, like metadata.pinned_at and metadata.tasks). No mark = no key. The text is never copied: the
// journal shows the update itself, so an edit of the update shows there too.
// A marked update counts as classified in the basket (it leaves 미분류) and shows on the work journal's day card under
// "기타 메모" on its own day (occurred_at, Korea time — the same day rule as the journal's other update groups).
// Marking is not an edit: updated_at (the original's version) is not touched. The PATCH writes metadata only, keeps every
// other key, and only applies while the row is the version that was read (updated_at, the mark itself and the keys the other
// metadata writers guard), so no writer drops another's key. The other writers guard this key in turn (journalGuard).
import {requestsGuard} from './update-requests.js';

const plainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
export const noteJournalAt = note => {
  const value = plainObject(note?.metadata) ? note.metadata.journal_at : null;
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
};
// The concurrency guard for metadata.journal_at as PostgREST sees it. A value this screen never writes (not a string) gets
// no guard of its own; the other guards of the same write still apply.
export function journalGuard(metadata) {
  const value = plainObject(metadata) ? metadata.journal_at : undefined;
  if (value == null) return '&metadata->>journal_at=is.null';
  return typeof value === 'string' ? `&metadata->>journal_at=eq.${encodeURIComponent(value)}` : '';
}
// The mark [노트로 옮기기] leaves on the row (basket-data.js moveToNote): the time the update became a note, in metadata as
// metadata.moved_from_update_at (an ISO time; no new column, no database change). The work journal shows a note with this mark
// as one "노트: (title)" line on the update's own day (journal-data.js readMovedNotes); a note without it is not shown there.
export const MOVED_KEY = 'moved_from_update_at';
const textGuard = value => value == null ? 'is.null' : 'eq.' + encodeURIComponent(typeof value === 'string' ? value : JSON.stringify(value));
// The keys the other writers of an update's metadata guard (basket-note-tasks.js noteTaskGuard): the first recorded task,
// the write-request candidate's mark and the request marks.
export function othersGuard(metadata) {
  const meta = plainObject(metadata) ? metadata : {};
  const first = Array.isArray(meta.tasks) ? meta.tasks[0] : null;
  const request = plainObject(meta.write_request) ? meta.write_request.marked_at : null;
  return `&metadata->write_request->>marked_at=${textGuard(request)}${requestsGuard(meta)}&metadata->tasks->0->>task_id=${textGuard(plainObject(first) ? first.task_id : null)}`;
}
function workspaceId(rt) {
  const id = rt.context.read()?.workspace?.id;
  if (!id) throw new Error('업무 공간을 확인할 수 없어요.');
  return encodeURIComponent(id);
}
// on=true sets the mark (now), on=false removes it. A row already in the wanted state is left as it is (no write).
// Returns the row {id, updated_at, metadata} as saved (or as read when nothing had to change).
export async function setNoteJournal(noteId, on, rt = window.KPTURuntime, now = new Date()) {
  const base = `/rest/v1/app_notes?id=eq.${encodeURIComponent(noteId)}&workspace_id=eq.${workspaceId(rt)}&kind=eq.basket`;
  const rows = await rt.api(`${base}&select=id,updated_at,metadata`, {singleFlight:false});
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.updated_at) throw Object.assign(new Error('업데이트를 찾지 못했어요.'), {code:'note_missing'});
  const fresh = rows[0], old = plainObject(fresh.metadata) ? fresh.metadata : {};
  if (!!noteJournalAt(fresh) === !!on && (on || !Object.hasOwn(old, 'journal_at'))) return fresh;
  const metadata = {...old};
  if (on) metadata.journal_at = now.toISOString(); else delete metadata.journal_at;
  const guard = `updated_at=eq.${encodeURIComponent(fresh.updated_at)}${journalGuard(old)}${othersGuard(old)}`;
  const saved = await rt.api(`${base}&${guard}&select=id,updated_at,metadata`, {method:'PATCH', prefer:'return=representation', body:{metadata}});
  if (!Array.isArray(saved) || saved.length !== 1) throw Object.assign(new Error('업데이트가 그사이 바뀌었어요. 다시 불러온 뒤 눌러 주세요.'), {code:'note_changed'});
  return saved[0];
}
