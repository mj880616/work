// ED③ 기록 (설계 docs/design/unified-editor.md 11.4 순서 5): the small pure parts the organization record and project record screens share
// when they keep a record's saved form (doc) next to its letters. No DOM; Node tests run it.
//   hasDoc(row)                 — the row carries the new editor's saved form.
//   sameRecord(fresh, held, key) — the row read just now is still what the screen opened (letters with line ends normalised, and the saved
//                                 form), so a record changed on another device is not overwritten. key = the letters column
//                                 (raw_text for an organization record, summary for a project record).
//   recordPatch(key, {text, value}) — the PATCH body of an edit saved from the window: letters and saved form together.
//   lettersPatch(key, text)     — the PATCH body of a letters-only edit: the saved form is dropped with it, so form and letters never differ.
import {cleanDoc} from './ed-schema.mjs';

export const hasDoc = row => !!cleanDoc(row?.doc);
const letters = value => String(value ?? '').replace(/\r\n?/g, '\n');
const docKey = value => { const clean = cleanDoc(value); return clean ? JSON.stringify(clean) : ''; };
export function sameRecord(fresh, held, key) {
  if (!fresh || !held) return false;
  return letters(fresh[key]) === letters(held[key]) && docKey(fresh.doc) === docKey(held.doc);
}
export const recordPatch = (key, {text, value}) => ({[key]: text, doc: value});
export const lettersPatch = (key, text) => ({[key]: text, doc: null});
