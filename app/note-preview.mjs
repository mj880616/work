// UI-노트메뉴정리: what a note row shows. The list preview is plain letters only (no #, *, -, ``` marks), and the body's first
// line is left out of the preview when it is the same as the title. Pure functions; the stored text is never changed.

import { toTelegram } from './md-telegram.mjs';
import { noteMarkdown } from './note-markdown.mjs';
import { readableFileName } from './attachment-name.mjs';

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const RULE = /^\s{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const ESCAPABLE = /\\([\\`*_{}[\]()#+\-.!|>~<])/g;

// One line of inline marks → letters. Links and images keep their words, code keeps its text, emphasis marks go.
export function plainInline(text) {
  const held = [];
  let out = String(text ?? '').replace(ESCAPABLE, (_, ch) => `${held.push(ch) - 1}`);
  out = out
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, '$1')
    .replace(/<\/?[A-Za-z][^>\n]*>/g, '')
    .replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, '$2')
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '$1')
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1$2')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
    .replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])?\*(?![\w*])/g, (m, lead, body) => (body === undefined ? m : lead + body))
    .replace(/(^|[^\w*])\*([^\s*])\*(?![\w*])/g, '$1$2')
    .replace(/(^|[^\w])_(?=[^\s_])([^_\n]*?[^\s_])?_(?!\w)/g, (m, lead, body) => (body === undefined ? m : lead + body));
  return out.replace(/(\d+)/g, (_, i) => held[+i]).replace(/\s+/g, ' ').trim();
}

// A block line (heading, quote, list, table row) → its letters.
export function plainBlock(line) {
  let t = String(line ?? '');
  t = t.replace(/^\s{0,3}#{1,6}[ \t]+/, '').replace(/[ \t]+#+[ \t]*$/, '');
  t = t.replace(/^\s*(?:>[ \t]?)+/, '');
  t = t.replace(/^\s*[-*+][ \t]+\[[ xX]\][ \t]+/, '').replace(/^\s*[-*+][ \t]+/, '');
  if ((t.match(/\|/g) || []).length >= 2 || /^\s*\|/.test(t)) t = t.split('|').map(cell => cell.trim()).filter(Boolean).join(' ');
  return plainInline(t);
}

// Raw text → non-empty plain lines. Fenced code keeps its lines (without the ``` marks); rules and table dividers go.
export function plainLines(raw) {
  const out = [];
  let fenced = false;
  for (const line of String(raw ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (FENCE.test(line)) { fenced = !fenced; continue; }
    if (!fenced && (RULE.test(line) || TABLE_SEP.test(line))) continue;
    const text = fenced ? line.replace(/\s+/g, ' ').trim() : plainBlock(line);
    if (text && !/^[\\`*_~#>|-]+$/.test(text)) out.push(text);
  }
  return out;
}

const same = (a, b) => String(a).replace(/\s+/g, ' ').trim().toLowerCase() === String(b).replace(/\s+/g, ' ').trim().toLowerCase();

// {shown, preview}: shown is the title (or, with no title, the body's first line); preview is the rest as one line of letters.
export function notePreview(note) {
  const lines = plainLines(note?.raw_text);
  const title = plainLines(note?.title).join(' ');
  const shown = title || lines[0] || '노트';
  let rest = title ? lines : lines.slice(1);
  if (title && rest.length && same(rest[0], title)) rest = rest.slice(1);
  return {shown, preview: rest.join(' ')};
}

// What [복사] puts on the clipboard. A note with text copies as before (텔레그램용 conversion, title as the first line); a note with
// only attachments copies their file names (one per line); a note with only a title copies the title; nothing to copy → null
// (the copy icon is hidden).
const attachmentNames = note => (Array.isArray(note?.attachments) ? note.attachments : []).map(file => readableFileName(file?.file_name)).filter(Boolean);
export function noteCopyPayload(note) {
  const title = String(note?.title || '').trim(), body = String(note?.raw_text || '');
  // NOTE-마크다운선택: a note with 마크다운 off copies as written (its '- '·'1. ' lines are not converted), title first.
  if (body.trim() && !noteMarkdown(note)) return {text: title ? `${title}\n\n${body}` : body, done: '복사했습니다'};
  if (body.trim()) return {text: toTelegram(title ? `# ${title}\n\n${body}` : body), done: '복사했습니다'};
  const names = attachmentNames(note);
  if (names.length) return {text: names.join('\n'), done: '첨부 이름을 복사했습니다'};
  if (title) return {text: toTelegram(`# ${title}\n\n`), done: '복사했습니다'};
  return null;
}
