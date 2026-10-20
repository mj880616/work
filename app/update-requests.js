// JOURNAL-요청표시: an update (app_notes kind=basket) can be marked "임원 일정 배정 요청" and/or "논의 요청". The marks live in
// the row's existing metadata jsonb as metadata.requests, an array of keys in this fixed order (no new column, no database
// change). No mark = no key. Unknown keys are ignored when read. The marks are written only through the guarded metadata
// write in basket-data.js (read again, keep the other keys, apply only while the row is the version that was read), which the
// note pin·folder (metadata.pinned_at·folder) and the task record (metadata.tasks) also use or guard against.
export const UPDATE_REQUESTS = Object.freeze([
  Object.freeze({key:'exec_schedule', label:'임원 일정 배정 요청', short:'임원 요청'}),
  Object.freeze({key:'discussion', label:'논의 요청', short:'논의 요청'}),
]);
const KEYS = UPDATE_REQUESTS.map(request => request.key);
export const requestInfo = key => UPDATE_REQUESTS.find(request => request.key === key) || null;
// Known keys only, once each, in the fixed order.
export const normalizeRequests = list => Array.isArray(list) ? KEYS.filter(key => list.includes(key)) : [];
const plainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
export const noteRequests = note => plainObject(note?.metadata) ? normalizeRequests(note.metadata.requests) : [];
export const hasRequest = (note, key) => noteRequests(note).includes(key);
// The concurrency guard for metadata.requests as PostgREST sees it (metadata->>requests is the jsonb text, which writes an array
// of strings as ["a", "b"]). A value this screen never writes (not an array of strings) gets no guard of its own; the other
// guards of the same write still apply.
export function requestsGuard(metadata) {
  const value = plainObject(metadata) ? metadata.requests : undefined;
  if (value == null) return '&metadata->>requests=is.null';
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) return '';
  return `&metadata->>requests=eq.${encodeURIComponent(`[${value.map(item => JSON.stringify(item)).join(', ')}]`)}`;
}
// Small tags for a list row, a detail or a journal item. esc is the screen's own HTML escape.
export function requestTagsHtml(keys, esc) {
  const list = normalizeRequests(keys);
  return list.length ? `<span class="update-request-tags">${list.map(key => `<span class="update-request-tag" data-request-tag="${key}">${esc(requestInfo(key).short)}</span>`).join('')}</span>` : '';
}
// Plain-text prefix for copied text: "[임원 요청] [논의 요청] ".
export const requestPrefix = keys => normalizeRequests(keys).map(key => `[${requestInfo(key).short}] `).join('');
