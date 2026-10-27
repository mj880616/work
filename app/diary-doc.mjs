// ED③ 일기 (설계 docs/design/unified-editor.md 11.4 순서 4): how a diary's text opens in the new editor (no DOM; Node tests run it).
//   diaryHasDoc(row)        — the row carries the new editor's saved form (doc).
//   diaryStartDoc(row)      — its own doc, else its old letters converted once in memory (plainToDocKeep: nothing is read as format, line
//                             breaks stay; "1." "-" and dates stay letters). Opening writes nothing.
//   joinDiaryDocs(a, b)     — b (a text typed before the day turned out to have a diary) put below a.
//   diaryDocToStore(v, t)   — the form to write with the letters t: null when there are no letters (a photo-only day keeps letters only).
//   diaryDocError(doc)      — a message when the form is too big for the database check (1 MiB as jsonb text; here a safer 900,000 bytes).
// The letters (raw_text) stay the copy every reader of the diary uses (calendar day preview, month list, search); only the diary screen reads doc.
import {cleanDoc} from './ed-schema.mjs';
import {plainToDocKeep} from './ed-markdown.mjs';
import {toPlain} from './ed-text.mjs';

export const DIARY_DOC_BYTES_MAX = 900000;
// A photo-only day is held with one space (diary-data.js HOLD_TEXT): it reads as no text.
const lettersOf = row => String(row?.raw_text ?? '').trim() ? String(row.raw_text) : '';
export const diaryHasDoc = row => !!cleanDoc(row?.doc);
export function diaryStartDoc(row) {
  return cleanDoc(row?.doc) || plainToDocKeep(lettersOf(row));
}
export function joinDiaryDocs(saved, typed) {
  const a = cleanDoc(saved), b = cleanDoc(typed);
  if (!b || !toPlain(b).trim()) return a || plainToDocKeep('');
  if (!a || !toPlain(a).trim()) return b;
  return cleanDoc({type: 'doc', content: [...a.doc.content, ...b.doc.content]}) || b;
}
export const diaryDocToStore = (value, letters) => (String(letters ?? '').trim() ? cleanDoc(value) : null);
export function diaryDocError(doc) {
  if (!doc) return '';
  let size = 0;
  try { size = new TextEncoder().encode(JSON.stringify(doc)).length; } catch { return '서식을 확인해 주세요.'; }
  return size > DIARY_DOC_BYTES_MAX ? '서식이 너무 커서 저장할 수 없어요. 표나 서식을 줄여 주세요.' : '';
}
