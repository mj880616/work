// NOTE-파일그림넣기: a new note's [넣기] → [사진]·[파일] before the note exists (note-window.js openNoteWindow).
// A new note has no id yet, so nothing can go up while it is written. The picture or file waits in this window's memory and is put in
// the text under a waiting id (drive:wait_<n>, the same form as a saved id so the editor's clean-up keeps it). When the note is saved,
// each waiting file goes up as one of the note's own attachments (basket-files, Drive "노트 첨부") and its waiting id is swapped for the
// real one; one that did not go up leaves the text. A note closed without saving sends nothing anywhere.
// Pure helpers only (no browser): the window keeps the files.
import {cleanDoc} from './ed-schema.mjs';

export const WAIT_PREFIX = 'drive:wait_';
export const isWaiting = src => typeof src === 'string' && src.startsWith(WAIT_PREFIX) && /^drive:wait_[A-Za-z0-9_-]{1,80}$/.test(src);

// The waiting ids in the text, in order, each once.
export function waitingSrcs(value) {
  const out = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    const src = node.attrs?.src;
    if ((node.type === 'image' || node.type === 'file') && isWaiting(src) && !out.includes(src)) out.push(src);
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(value?.doc);
  return out;
}

// The text with each waiting id swapped: swap[src] = the real 'drive:<id>' (kept), anything else (null, missing) = the photo or file
// card leaves the text. A photo row left with one photo becomes that photo, an empty one goes (cleanDoc). Never returns a waiting id.
export function swapWaiting(value, swap = {}) {
  const ok = src => typeof swap[src] === 'string' && /^drive:[A-Za-z0-9_-]{1,200}$/.test(swap[src]) && !isWaiting(swap[src]);
  const walk = node => {
    if (!node || typeof node !== 'object') return node;
    if ((node.type === 'image' || node.type === 'file') && isWaiting(node.attrs?.src)) {
      return ok(node.attrs.src) ? {...node, attrs: {...node.attrs, src: swap[node.attrs.src]}} : null;
    }
    if (!Array.isArray(node.content)) return node;
    const content = node.content.map(walk).filter(Boolean);
    if (node.type === 'photo_row' && !content.length) return null;
    return {...node, content};
  };
  const doc = walk(value?.doc);
  return cleanDoc({v: value?.v || 'ed1', doc: doc && Array.isArray(doc.content) && doc.content.length ? doc : {type: 'doc', content: [{type: 'paragraph'}]}});
}
