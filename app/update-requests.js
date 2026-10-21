// JOURNAL-요청표시: an update (app_notes kind=basket) can carry the marks "임원 일정 배정 요청" and/or "논의 요청" in the row's
// existing metadata jsonb as metadata.requests, an array of keys in this fixed order (no new column, no database change). No
// mark = no key. Unknown keys are ignored when read.
// UI-요청버튼삭제: the screen no longer sets or clears the marks (the toggles under the input and in an open update are gone; the
// owner writes the word in the update's text instead). Marks already saved are still read here (list tags, journal tags, the
// weekly report draft), and every metadata writer (note pin·folder in basket-data.js, the task record in basket-note-tasks.js)
// keeps them and guards them with requestsGuard, so no write drops them.
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
