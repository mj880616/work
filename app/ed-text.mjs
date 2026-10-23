// ED-통합편집기 ①a: the saved form (ed1) as text, with no DOM (Node tests run it as is). Design 3.4.
//   toPlain(doc)    — raw_text for search·AI·journal: one line per paragraph/heading, blank line between blocks, lists "- "
//                     and "1. " (real numbers), quotes without marks, rule "────", table rows "칸 | 칸", photo "[사진: 설명]".
//   toTelegram(doc) — the same, lists "• ", a blank line after a heading (md-telegram.mjs look).
//   toHangul(doc)   — {text, html} for 한글: text/plain (tables tab-separated) + text/html (heading·bold·underline·table·center).
// Typed marks such as "1." or "-" are never read as format: they are letters in a paragraph.
import {cleanDoc, bulletGlyph, orderedLabel} from './ed-schema.mjs';

export const RULE_TEXT = '────';
export const TELEGRAM_RULE = '──────────';

const textOf = node => {
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hard_break') return '\n';
  return (node.content || []).map(textOf).join('');
};
const photoText = node => `[사진${node.attrs?.alt ? ': ' + node.attrs.alt : ''}]`;

// The text before one list item (ED-서식줄펼침). 'plain' (raw_text for search and AI) keeps the old "- " and "1. " unless the
// list has a marker saved on it; 'telegram' and 'hangul' always show the shape the editor shows (• ◦ ▪ / 1. 1) (1) ① 가.),
// automatic by how deep the list is nested.
const markFor = (node, style, depth, n) => {
  const saved = node.attrs?.marker;
  const shape = style !== 'plain' || !!saved;
  if (node.type === 'ordered_list') return shape ? `${orderedLabel(saved, depth.ordered, n)} ` : `${n}. `;
  return shape ? `${bulletGlyph(saved, depth.bullet)} ` : '- ';
};
const deeper = (depth, node) => node.type === 'ordered_list' ? {...depth, ordered: depth.ordered + 1} : {...depth, bullet: depth.bullet + 1};

// Lines of one block list. style: 'plain' | 'telegram' | 'hangul'. indent: list nesting prefix. depth: lists around this one.
function linesOf(blocks, style, indent = '', depth = {bullet: 0, ordered: 0}) {
  const out = [];
  const push = (lines, gapAfter = true) => { out.push({lines, gapAfter}); };
  for (const node of blocks || []) {
    switch (node.type) {
      case 'paragraph': push(textOf(node).split('\n').map(l => indent + l)); break;
      case 'heading': push(textOf(node).split('\n').map(l => indent + l)); break;
      case 'code_block': push(textOf(node).split('\n').map(l => indent + l)); break;
      case 'horizontal_rule': push([indent + (style === 'telegram' ? TELEGRAM_RULE : RULE_TEXT)]); break;
      case 'image': push([indent + photoText(node)]); break;
      case 'blockquote': push(flat(linesOf(node.content, style, indent, depth))); break;
      case 'bullet_list': case 'ordered_list': {
        const start = node.type === 'ordered_list' ? (node.attrs?.order ?? 1) : 0;
        const lines = [];
        (node.content || []).forEach((item, i) => {
          const mark = markFor(node, style, depth, start + i);
          const inner = flat(linesOf(item.content, style, '', deeper(depth, node)), false);
          inner.forEach((line, j) => lines.push(indent + (j === 0 ? mark : ' '.repeat(mark.length)) + line));
        });
        push(lines);
        break;
      }
      case 'table': {
        const rows = (node.content || []).map(row => (row.content || []).map(cell => flat(linesOf(cell.content, style, '', depth), false).join(' ').trim()).join(' | '));
        push(rows.map(r => indent + r));
        break;
      }
      default: break;
    }
  }
  return out;
}
// Joins blocks: a blank line between blocks (gap = false inside list items and table cells).
function flat(blocks, gap = true) {
  const lines = [];
  blocks.forEach((b, i) => { if (i && gap) lines.push(''); lines.push(...b.lines); });
  return lines;
}
const tidy = lines => lines.join('\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');

export function toPlain(value) {
  const clean = cleanDoc(value);
  return clean ? tidy(flat(linesOf(clean.doc.content, 'plain'))) : '';
}
export function toTelegram(value) {
  const clean = cleanDoc(value);
  return clean ? tidy(flat(linesOf(clean.doc.content, 'telegram'))) : '';
}

// ── 한글 ──
const ESC = {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'};
const esc = text => String(text).replace(/[&<>"']/g, c => ESC[c]);
const P = 'margin:0';
const CELL = 'border:1px solid #000;padding:2pt 4pt';
const HEAD_SIZE = {1:'16pt', 2:'14pt', 3:'12pt'};
function inlineHtml(node) {
  return (node.content || []).map(n => {
    if (n.type === 'hard_break') return '<br>';
    let html = esc(n.text || '');
    for (const m of n.marks || []) {
      if (m.type === 'strong') html = `<b>${html}</b>`;
      else if (m.type === 'em') html = `<i>${html}</i>`;
      else if (m.type === 'underline') html = `<u>${html}</u>`;
      else if (m.type === 'strike') html = `<s>${html}</s>`;
      else if (m.type === 'link') html = `${html} (${esc(m.attrs.href)})`;
    }
    return html;
  }).join('');
}
const alignCss = node => node.attrs?.align === 'center' ? ';text-align:center' : '';
function blocksHtml(blocks, pad = '', depth = {bullet: 0, ordered: 0}) {
  return (blocks || []).map(node => {
    switch (node.type) {
      case 'paragraph': return `<p style="${P}${alignCss(node)}">${pad}${inlineHtml(node) || '<br>'}</p>`;
      case 'heading': return `<p style="${P};font-size:${HEAD_SIZE[node.attrs.level]}${alignCss(node)}"><b>${pad}${inlineHtml(node)}</b></p>`;
      case 'code_block': return textOf(node).split('\n').map(l => `<p style="${P}">${pad}${esc(l) || '<br>'}</p>`).join('');
      case 'horizontal_rule': return `<p style="${P}">${pad}${RULE_TEXT}</p>`;
      case 'image': return `<p style="${P};text-align:center">${esc(photoText(node))}</p>`;
      case 'blockquote': return blocksHtml(node.content, pad + '&nbsp;&nbsp;', depth);
      case 'bullet_list': case 'ordered_list': {
        const start = node.type === 'ordered_list' ? (node.attrs?.order ?? 1) : 0;
        return (node.content || []).map((item, i) => {
          const mark = markFor(node, 'hangul', depth, start + i);
          const [first, ...rest] = item.content || [];
          const head = first && first.type === 'paragraph' ? `<p style="${P}">${pad}${esc(mark)}${inlineHtml(first)}</p>` : '';
          return head + blocksHtml(first && first.type === 'paragraph' ? rest : item.content, pad + '&nbsp;&nbsp;&nbsp;&nbsp;', deeper(depth, node));
        }).join('');
      }
      case 'table': return `<table style="border-collapse:collapse">${(node.content || []).map(row => `<tr>${(row.content || []).map(cell => {
        const tag = cell.type === 'table_header' ? 'th' : 'td';
        const inner = (cell.content || []).map(c => c.type === 'paragraph' || c.type === 'heading' ? inlineHtml(c) : esc(textOf(c))).join('<br>');
        return `<${tag} style="${CELL}">${inner || '<br>'}</${tag}>`;
      }).join('')}</tr>`).join('')}</table>`;
      default: return '';
    }
  }).join('');
}
export function toHangul(value) {
  const clean = cleanDoc(value);
  if (!clean) return {text:'', html:''};
  // Plain text for 한글: table cells tab-separated so [표 만들기] makes a table again.
  const plain = flat(linesOf(clean.doc.content, 'hangul').map(b => b)).join('\n');
  const tabbed = clean.doc.content.some(n => n.type === 'table')
    ? tidy(flat(clean.doc.content.map(n => n.type === 'table'
      ? {lines:(n.content || []).map(row => (row.content || []).map(c => textOf({content:c.content}).replace(/\n/g, ' ')).join('\t'))}
      : linesOf([n], 'hangul')[0]).filter(Boolean)))
    : tidy(plain.split('\n'));
  return {text:tabbed, html:blocksHtml(clean.doc.content)};
}
