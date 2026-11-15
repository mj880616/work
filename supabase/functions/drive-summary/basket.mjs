// My organizations (ORG-담당13기준; browser source app/my-organizations.js): active + actual owner assignment,
// matching home weekUpdates. Used by the basket list and the organization copy.
// Keep browser/Edge deployment-local copies identical; regression tests compare them.
export function selectBasketOrganizations(organizations, assignees) {
  const active = organizations.filter(row => row.active !== false);
  const assigned = new Set(assignees.map(row => row.organization_id));
  const mine = active.filter(row => assigned.has(row.id));
  return { organizations: mine.length ? mine : active, fallback: mine.length === 0 };
}
// BASKET-일지로남기기: an update kept as a work-journal memo ([업무일지에 남기기]) is not 미분류. The mark is
// metadata.journal_at, read as the row's journal_at (basket-read.mjs). Same rule as the browser's noteJournalAt
// (app/update-journal.js): only a string that parses as a time counts; regression tests compare both.
export const noteJournalAt = note => {
  const value = note?.journal_at;
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
};
// DRIVE-바구니원문제외: the Drive copy carries only a count line for the basket. No memo body, memo ID, attachment,
// OCR text or classification instructions leave Web2 (classification now happens inside Web2).
export const BASKET_LIMITS = Object.freeze({ documentBytes: 1024 * 1024 });
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const p = value => `<p>${escape(value)}</p>`;

// Persisted suggested links have no original-version column yet. Treat every
// stored suggested link as valid conservatively, just like basket-data noteState.
// BASKET-4 owns version validation/invalidation and processing-result writers.
export function basketState(note, links) {
  if (note.archived_at) return '보관';
  const related = links.filter(link => link.note_id === note.id);
  if (related.some(link => link.status === 'confirmed')) return '확정';
  return related.some(link => link.status === 'suggested') ? '분류 제안됨' : '미분류';
}
export function prepareBasket(notes, links, now, window) {
  const linked = new Set(links.filter(link => ['confirmed', 'suggested'].includes(link.status)).map(link => link.note_id));
  const recent = notes.filter(note => !note.archived_at && note.ai_export_allowed === true && !linked.has(note.id) && !noteJournalAt(note)
    && Date.parse(note.occurred_at) >= Date.parse(window.start) && Date.parse(note.occurred_at) <= now.getTime());
  return { recent, count: recent.length, section: `<h2>바구니</h2>\n${p(`바구니 미분류 메모 ${recent.length}건 (내용은 Web2 바구니에서 확인)`)}` };
}
