// ED③ 노트: how a note opens in the new editor (no DOM; Node tests run it). Design docs/design/unified-editor.md 4.1·11.3.
//   noteStartDoc(note, md) — the note's own saved form (doc), else its old letters converted once in memory (nothing is written by
//     opening): a note read as markdown now (noteMarkdown: the stored [마크다운] value, else the marks guess) goes through the same
//     date-line guard as the old read view and the editor's markdown conversion; any other note keeps its letters and line breaks
//     (plainToDocKeep: "1." "-" and dates stay letters). md is a markdown-it instance, needed only for a markdown note without doc.
//   needsMarkdown(note) — whether opening this note needs md.
//   noteDrivePhotos(doc) — the drive:<id> photos in a saved form (the note screen fills them from the note's attachments).
import {noteMarkdown} from './note-markdown.mjs';
import {markdownToDoc, plainToDocKeep} from './ed-markdown.mjs';
import {guardDateLines} from './markdown-render.mjs';
import {cleanDoc} from './ed-schema.mjs';

// A note's letters limit (the db check on app_notes.raw_text for kind=note).
export const NOTE_TEXT_MAX = 100000;

export const hasDoc = note => !!cleanDoc(note?.doc);
export const needsMarkdown = note => !hasDoc(note) && noteMarkdown(note);
export function noteStartDoc(note, md = null) {
  const own = cleanDoc(note?.doc);
  if (own) return own;
  const raw = String(note?.raw_text ?? '');
  if (md && noteMarkdown(note)) { try { const made = cleanDoc(markdownToDoc(md, guardDateLines(raw))); if (made) return made; } catch { /* letters below */ } }
  return plainToDocKeep(raw);
}
export function noteDrivePhotos(value) {
  const out = [], clean = cleanDoc(value);
  const walk = list => { for (const n of list || []) { if (n.type === 'image' && typeof n.attrs?.src === 'string' && n.attrs.src.startsWith('drive:')) out.push(n.attrs.src.slice(6)); walk(n.content); } };
  if (clean) walk(clean.doc.content);
  return out;
}
