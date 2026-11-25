// MTG-결과마크다운: the editor's saved form (ed1) → markdown letters, for a field that keeps letters only and is read as markdown
// (사업 보고 '회의 결과 원문'·특이사항: app_meetings has no saved-form column). No DOM, no library (Node tests run it as is).
//   docToMarkdown(value) — headings "#", **굵게** *기울임* ~~취소선~~ [글](주소), lists "- " / "1. " (a "1)" list keeps ")"),
//                          quotes "> ", rule "---", code ``` ```, tables "| 칸 | 칸 |" (first row is the head row), photo "[사진: 설명]".
//                          Underline, colour, highlight, alignment and indent have no markdown: their letters stay, the look goes.
//   A text that is only plain paragraphs (nothing formatted) comes back as toPlain gives it: the letters exactly as typed, no
//   backslashes (an old text opened with plainToDocKeep and saved unchanged in letters stays the same letters).
// The reader is markdown-render.mjs (markdown-it, breaks on): a line break inside a paragraph is a plain "\n".
// ED-빈줄읽기: empty paragraphs (blank lines typed in the editor) are kept, so the field reads with as many blank lines as the
// editor showed. Plain letters (read as written, white-space pre-wrap): one more "\n" per empty paragraph between two paragraphs.
// Markdown (markdown-it folds blank lines into one): a paragraph of "&nbsp;" per empty paragraph, a paragraph one line high, which
// is plain markdown. Empty paragraphs at the start or end are dropped. lettersToDoc(text, markdownIt) opens the letters again with
// those empty paragraphs (record-text-write.js), so opening and saving unchanged gives the same letters.
import {cleanDoc} from './ed-schema.mjs';
import {guardDateLines} from './markdown-render.mjs';
import {markdownToDoc, plainToDocKeep} from './ed-markdown.mjs';

const plainParagraph = node => node?.type === 'paragraph' && !node.attrs?.align && !node.attrs?.indent &&
  (node.content || []).every(n => n.type === 'hard_break' || (n.type === 'text' && !(n.marks && n.marks.length)));

// Letters that markdown would read as a mark inside a line.
const escapeInline = text => String(text || '').replace(/([\\`*_[\]<])/g, '\\$1').replace(/~~/g, '\\~\\~');
// A line start that markdown would read as a heading, list, quote or rule. Date lines ("2026. 10. 19.") are left: the reader guards them.
function escapeLineStart(line) {
  if (/^\s*#{1,6}(\s|$)/.test(line)) return line.replace('#', '\\#');
  if (/^\s*[-+*](\s|$)/.test(line)) return line.replace(/[-+*]/, m => '\\' + m);
  if (/^\s*>/.test(line)) return line.replace('>', '\\>');
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return line.replace(/[-*_]/, m => '\\' + m);
  const num = /^(\s*\d{1,9})([.)])(\s|$)/.exec(line);
  if (num && guardDateLines(line) === line) return num[1] + '\\' + num[2] + line.slice(num[0].length - num[3].length);
  return line;
}

const WRAP = {strong: '**', em: '*', strike: '~~'};
// One run of inline nodes → letters with marks. Marks open and close around each text node (simple and always valid).
function inline(nodes, {cell = false} = {}) {
  let out = '';
  for (const n of nodes || []) {
    if (n.type === 'hard_break') { out += cell ? ' ' : '\n'; continue; }
    if (n.type !== 'text' || !n.text) continue;
    let text = escapeInline(n.text);
    if (cell) text = text.replace(/\|/g, '\\|');
    const marks = n.marks || [];
    // Markdown emphasis cannot start or end on a space: the spaces stay outside the marks.
    const lead = /^\s*/.exec(text)[0], tail = /\s*$/.exec(text.slice(lead.length))[0];
    let core = text.slice(lead.length, text.length - tail.length);
    if (core) {
      for (const type of ['strike', 'em', 'strong']) if (marks.some(m => m.type === type)) core = WRAP[type] + core + WRAP[type];
      const link = marks.find(m => m.type === 'link' && m.attrs?.href);
      if (link) core = `[${core}](${String(link.attrs.href).replace(/[()\s]/g, c => encodeURIComponent(c))})`;
    }
    out += lead + core + tail;
  }
  return out;
}
const paragraphLines = node => inline(node.content).split('\n').map(escapeLineStart);

const BLANK = '&nbsp;';
// Blocks → array of block texts (each block is an array of lines); joined with a blank line between.
// top: the document's own blocks, where an empty paragraph is kept as a BLANK paragraph.
function blocks(list, depth = 0, top = false) {
  const out = [];
  for (const node of list || []) {
    switch (node.type) {
      case 'paragraph': { const lines = paragraphLines(node); if (lines.join('').trim()) out.push(lines); else if (top) out.push([BLANK]); break; }
      case 'heading': {
        const level = Math.min(3, Math.max(1, Number(node.attrs?.level) || 2)), text = inline(node.content).replace(/\n/g, ' ').trim();
        if (text) out.push(['#'.repeat(level) + ' ' + text]);
        break;
      }
      case 'blockquote': {
        const inner = join(blocks(node.content, depth));
        if (inner.trim()) out.push(inner.split('\n').map(line => line ? '> ' + line : '>'));
        break;
      }
      case 'bullet_list': case 'ordered_list': {
        const ordered = node.type === 'ordered_list', start = Number(node.attrs?.order) || 1, close = node.attrs?.marker === 'paren' ? ')' : '.';
        const lines = [];
        (node.content || []).forEach((item, i) => {
          const mark = ordered ? `${start + i}${close} ` : node.attrs?.marker === 'check' ? (item.attrs?.checked ? '- [x] ' : '- [ ] ') : '- ', pad = ' '.repeat(mark.length);
          const inner = join(blocks(item.content, depth + 1), false).split('\n');
          inner.forEach((line, j) => lines.push(j === 0 ? mark + line : line ? pad + line : ''));
        });
        if (lines.length) out.push(lines);
        break;
      }
      // NOTE-노션편집 ①(나) 접기: markdown has no fold — the ▸ line and what is under it, as plain blocks.
      case 'toggle': out.push(...blocks(node.content, depth, top)); break;
      case 'horizontal_rule': out.push(['---']); break;
      case 'code_block': {
        const text = (node.content || []).map(n => n.text || '').join('');
        const fence = /```/.test(text) ? '~~~' : '```';
        out.push([fence, ...text.split('\n'), fence]);
        break;
      }
      case 'image': out.push([escapeLineStart(escapeInline(`[사진${node.attrs?.alt ? ': ' + node.attrs.alt : ''}]`))]); break;
      case 'photo_row': out.push((node.content || []).map(p => escapeLineStart(escapeInline(`[사진${p.attrs?.alt ? ': ' + p.attrs.alt : ''}]`)))); break;
      case 'file': out.push([escapeLineStart(escapeInline(`[파일: ${node.attrs?.name || '이름 없음'}]`))]); break;
      case 'table': {
        const rows = (node.content || []).map(row => (row.content || []).map(cell => (cell.content || []).map(p => inline(p.content, {cell: true})).join(' ').trim()));
        if (!rows.length) break;
        const width = Math.max(...rows.map(r => r.length), 1);
        const line = cells => '| ' + Array.from({length: width}, (_, i) => cells[i] || ' ').join(' | ') + ' |';
        out.push([line(rows[0]), '| ' + Array.from({length: width}, () => '---').join(' | ') + ' |', ...rows.slice(1).map(line)]);
        break;
      }
      default: break;
    }
  }
  return out;
}
const join = (list, gap = true) => list.map(lines => lines.join('\n')).join(gap ? '\n\n' : '\n');
const tidy = text => text.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');

const isBlank = lines => lines.length === 1 && lines[0] === BLANK;
// Plain paragraphs → the letters as typed: a blank line between two paragraphs, one more per empty paragraph between them.
const lineText = node => (node.content || []).map(n => (n.type === 'hard_break' ? '\n' : n.text || '')).join('');
function plainLetters(content) {
  let out = '', gap = 0;
  for (const node of content) {
    const text = lineText(node).replace(/[ \t]+$/gm, '');
    if (!text.trim()) { gap++; continue; }
    if (out) out += '\n'.repeat(2 + gap);
    out += text;
    gap = 0;
  }
  return out.replace(/^\n+|\n+$/g, '');
}

export function docToMarkdown(value) {
  const clean = cleanDoc(value);
  if (!clean) return '';
  const content = clean.doc.content || [];
  if (content.every(plainParagraph)) return plainLetters(content);
  const list = blocks(content, 0, true);
  while (list.length && isBlank(list[0])) list.shift();
  while (list.length && isBlank(list[list.length - 1])) list.pop();
  return tidy(join(list));
}

// The field's letters → the editor's saved form, with the empty paragraphs docToMarkdown wrote (above). markdownIt: the loaded
// library when the letters carry markdown marks, else null (the letters open exactly as written).
export function lettersToDoc(text, markdownIt = null) {
  if (!markdownIt) return plainToDocKeep(text, {blankLines: true});
  const clean = markdownToDoc(markdownIt, guardDateLines(text));
  for (const node of clean?.doc?.content || []) {
    const only = node.type === 'paragraph' && node.content?.length === 1 ? node.content[0] : null;
    if (only && only.type === 'text' && !only.marks?.length && /^\u00a0+$/.test(only.text)) delete node.content;
  }
  return cleanDoc(clean);
}
