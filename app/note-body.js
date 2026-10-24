// ED③ 노트 화면 (설계 docs/design/unified-editor.md 11.4 순서 2): the note's body in the new editor. basket-notes.js keeps the list, menus,
// links and saves; this file is the part that knows the editor: the read view (ed-render), the edit field (ed-editor), the big window
// (ed-window), the photos in the text and the copies. Nothing here saves by itself.
//   - A note with doc reads and edits its saved form. A note without doc (written before) reads the old way (markdown-view or as written)
//     until it is edited; the edit field opens it converted in memory (note-doc.mjs noteStartDoc), and saving writes doc + the letters.
//   - Photos (사진·링크 넣기, the same [사진] as share pages): a photo is a file of this note's attachments, put in the text as drive:<file id>.
//     It goes up through the note's own basket-files upload (Drive "노트 첨부", owner only) and is shown through the owner-only photo view
//     (basket-files?action=photo) like the attachment cards. A photo of another note, or one taken off the attachments, shows as a place.
//   - Copies: a note with doc copies ed-text (toTelegram·toHangul); without, the old md-* conversions (note-preview.mjs).
import {renderDoc} from './ed-render.mjs';
import {toTelegram as docTelegram, toHangul} from './ed-text.mjs';
import {hasDoc, needsMarkdown, noteStartDoc} from './note-doc.mjs';
import {diaryPhotoUrl} from './diary-data.js';
import {attachmentName} from './attachment-name.mjs';

const STYLES = ['./ed-doc.css'];
function ensureStyles() {
  const have = new Set([...document.querySelectorAll('link[rel="stylesheet"]')].map(l => (l.getAttribute('href') || '').split('?')[0].split('/').at(-1)));
  for (const path of STYLES) {
    if (have.has(path.split('/').at(-1))) continue;
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = path; link.dataset.kptuViewStyle = '1'; document.head.append(link);
  }
}
let mdFlight = null;
const editorModule = () => import('./ed-editor.js');
async function markdownFor(note) {
  if (!needsMarkdown(note)) return null;
  mdFlight ||= editorModule().then(m => m.loadMarkdownIt()).catch(error => { mdFlight = null; throw error; });
  try { return await mdFlight; } catch { return null; }
}
// The saved form the editor starts from (own doc, or the old letters converted in memory).
export async function startValue(note) { return noteStartDoc(note, await markdownFor(note)); }

// The note's photos: drive:<id> of a file in this note's attachments, shown through the owner-only photo view.
const fileOf = (note, id) => (note?.attachments || []).find(f => f?.drive_file_id === id) || null;
export function fillPhotos(box, note, {rt = window.KPTURuntime} = {}) {
  for (const place of box.querySelectorAll('[data-ed-drive]')) {
    const file = fileOf(note, place.dataset.edDrive);
    if (!file || !/^image\//.test(file.mime_type || '')) continue;
    diaryPhotoUrl(note.id, file.drive_file_id, 'large', {rt}).then(url => {
      if (!place.isConnected) return;
      const img = document.createElement('img');
      img.className = 'ed-photo-img'; img.alt = place.dataset.alt || attachmentName(file, '사진'); img.decoding = 'async'; img.loading = 'lazy';
      img.src = url;
      place.classList.remove('is-place'); place.removeAttribute('role'); place.removeAttribute('aria-label');
      place.replaceChildren(img);
    }, () => {});
  }
}
// The read view of a note with doc. Returns true when it drew (false: the caller keeps the old view).
export function paintDoc(box, note, {rt} = {}) {
  if (!hasDoc(note)) return false;
  ensureStyles();
  const doc = renderDoc(note.doc);
  box.replaceChildren(doc);
  box.dataset.noteView = 'doc';
  fillPhotos(box, note, {rt});
  return true;
}

// What [복사] puts on the clipboard for a note with doc (title first), or null to use the old one.
export function docCopy(note) {
  if (!hasDoc(note)) return null;
  const title = String(note?.title || '').trim(), body = docTelegram(note.doc).trim();
  if (!body && !title) return null;
  return {text: title && body ? `${title}\n\n${body}` : body || title, done: '복사했습니다'};
}
export function docHangul(note) { return hasDoc(note) ? toHangul(note.doc) : null; }

// photos option for the editor (ed-editor.js createDocEditor): the note's own attachments.
// getNote() — the note as it is now; upload(files) → Promise<attachments after> through the note's basket-files path.
export function notePhotos({getNote, upload, rt = window.KPTURuntime}) {
  return {
    max: 20,
    async add(file) {
      const note = getNote();
      if (!note?.id) throw new Error('사진은 노트를 한 번 저장한 뒤 넣을 수 있어요.');
      const before = new Set((note.attachments || []).map(f => f.drive_file_id));
      const after = await upload([file]);
      const made = (after || []).find(f => f?.drive_file_id && !before.has(f.drive_file_id));
      if (!made) throw new Error('사진을 올리지 못했어요. 잠시 뒤 다시 눌러 주세요.');
      return {src: 'drive:' + made.drive_file_id};
    },
    async url(src) {
      const id = String(src || '').startsWith('drive:') ? src.slice(6) : '';
      const note = getNote(), file = fileOf(note, id);
      if (!file) return null;
      try { return await diaryPhotoUrl(note.id, id, 'large', {rt}); } catch { return null; }
    },
  };
}

// The edit field: the new editor in the note's detail, on the note's text. Returns {getValue, isChanged, setValue, focus, destroy}.
export async function mountEditField(host, note, {photos = null, label = '본문'} = {}) {
  const [{createDocEditor}, start] = await Promise.all([editorModule(), startValue(note)]);
  const editor = await createDocEditor({host, value: start, label, placeholder: '노트 본문을 쓰세요', photos, shortcuts: true});
  let base = JSON.stringify(editor.getValue());
  return {
    editor,
    getValue: () => editor.getValue(),
    isChanged: () => JSON.stringify(editor.getValue()) !== base,
    setValue(value) { editor.setValue(value); },
    markSaved() { base = JSON.stringify(editor.getValue()); },
    focus: () => editor.focus(),
    destroy: () => editor.destroy(),
  };
}
