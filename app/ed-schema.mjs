// ED-통합편집기 ①a: the one description of the editor's saved form "ed1" (docs/design/unified-editor.md 3.1·3.2), with no
// editor library in it. The editor (ed-editor.js) builds its ProseMirror schema from these names, and the readers
// (ed-render.mjs: Web2 and the Web1 share page) and the text exports (ed-text.mjs) read the same names.
// Saved form: {v:'ed1', doc:{type:'doc', content:[…]}}. Format is structure, never markdown marks: a typed "1." stays text.
// ED-기본기보강 added only optional attributes and marks (align right·justify, indent, table width, cell colwidth, color,
// highlight), so every document saved before still reads the same and stays 'ed1'; an older reader drops what it does not know.
// cleanDoc is an allowlist: unknown nodes, marks and attributes are dropped, text is kept, links keep only http(s)·mailto.
// The Web1 reader imports this file (through ed-render.mjs), so it keeps to syntax older Samsung Internet parses:
// no ?. ?? replaceChildren structuredClone .at( (BUG-공유페이지삼성).

export const DOC_VERSION = 'ed1';
// Paragraph styles shown in the [본문 2 ▾] menu, in menu order: [value, label]. Headings are their own node (level 1–3).
export const TEXT_STYLES = [['h1', '제목 1'], ['h2', '제목 2'], ['h3', '제목 3'], ['body1', '본문 1'], ['body2', '본문 2'], ['body3', '본문 3']];
export const BODY_STYLES = ['body1', 'body2', 'body3'];
export const DEFAULT_BODY = 'body2';
// ED-기본기보강: right and justify join left and center (left is saved as no align). indent: 들여쓰기 steps 1–8 (0 = none).
export const ALIGNS = ['left', 'center', 'right', 'justify'];
export const MARKS = ['strong', 'em', 'underline', 'strike', 'link', 'color', 'highlight'];
// 글자색·형광펜: a short fixed list of names (never a raw color), drawn by ed-doc.css from theme tokens so dark mode and the
// Web1 reader follow the theme. [value, label].
export const TEXT_COLORS = [['red', '빨강'], ['orange', '주황'], ['green', '초록'], ['blue', '파랑'], ['purple', '보라'], ['gray', '회색']];
export const HIGHLIGHTS = [['yellow', '노랑'], ['green', '연두'], ['blue', '하늘'], ['pink', '분홍'], ['orange', '살구']];
const COLOR_NAMES = {red:1, orange:1, green:1, blue:1, purple:1, gray:1};
const HIGHLIGHT_NAMES = {yellow:1, green:1, blue:1, pink:1, orange:1};
// Block nodes and what they hold. Inline: text, hard_break.
export const BLOCK_NODES = ['paragraph', 'heading', 'blockquote', 'bullet_list', 'ordered_list', 'list_item', 'horizontal_rule',
  'code_block', 'image', 'table', 'table_row', 'table_cell', 'table_header'];
// Photo src is our own id, never an address: drive:<Drive file id> (notes·diary·updates, ③) or share:<photo id> (share pages, ②).
// Until ② a photo is a place only (src null) with its description.
export const PHOTO_SRC = /^(drive|share):[A-Za-z0-9_-]{1,200}$/;
// colWidth: one table column's width in px (column dragging); tableWidth: the table's width as % of the text width.
export const LIMITS = {depth:24, nodes:20000, text:200000, alt:200, href:2000, tableCols:20, indent:8, colWidth:2000, tableWidth:100};

const LINK_PROTOCOLS = {'http:':1, 'https:':1, 'mailto:':1};
export function safeHref(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > LIMITS.href) return null;
  var url;
  try { url = new URL(value.trim()); } catch (e) { return null; }
  if (!LINK_PROTOCOLS[url.protocol]) return null;
  if (url.protocol !== 'mailto:' && !url.hostname) return null;
  return url.href;
}

const isObject = function (v) { return !!v && typeof v === 'object' && !Array.isArray(v); };
// Control characters other than tab are removed from text (line breaks are hard_break nodes, not characters).
const cleanString = function (v) { return typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '') : ''; };
const intIn = function (v, lo, hi, fallback) { return typeof v === 'number' && v % 1 === 0 && v >= lo && v <= hi ? v : fallback; };
const alignOf = function (v) { return v === 'center' || v === 'right' || v === 'justify' ? v : null; };

function cleanMarks(marks) {
  var out = [], seen = {};
  if (!Array.isArray(marks)) return out;
  for (var i = 0; i < marks.length; i++) {
    var m = marks[i];
    if (!isObject(m) || MARKS.indexOf(m.type) < 0 || seen[m.type]) continue;
    if (m.type === 'link') {
      var href = safeHref(m.attrs && m.attrs.href);
      if (!href) continue;
      out.push({type:'link', attrs:{href:href}});
    } else if (m.type === 'color' || m.type === 'highlight') {
      var name = m.attrs && m.attrs.color;
      if (typeof name !== 'string' || !(m.type === 'color' ? COLOR_NAMES : HIGHLIGHT_NAMES).hasOwnProperty(name)) continue;
      out.push({type:m.type, attrs:{color:name}});
    } else out.push({type:m.type});
    seen[m.type] = 1;
  }
  return out;
}

// What each block may hold, after cleaning. 'inline' = text and hard_break.
const HOLDS = {
  doc:'block', blockquote:'block', list_item:'block', table_cell:'block', table_header:'block',
  paragraph:'inline', heading:'inline', code_block:'text',
  bullet_list:'list_item', ordered_list:'list_item', table:'table_row', table_row:'cell',
  horizontal_rule:'none', image:'none',
};
const TOP_BLOCKS = {paragraph:1, heading:1, blockquote:1, bullet_list:1, ordered_list:1, horizontal_rule:1, code_block:1, image:1, table:1};

function attrsOf(type, a) {
  a = isObject(a) ? a : {};
  if (type === 'paragraph') {
    var out = {style:BODY_STYLES.indexOf(a.style) >= 0 ? a.style : DEFAULT_BODY};
    var al = alignOf(a.align); if (al) out.align = al;
    var pi = intIn(a.indent, 0, LIMITS.indent, 0); if (pi) out.indent = pi;
    return out;
  }
  if (type === 'heading') {
    var h = {level:intIn(a.level, 1, 3, 2)};
    var ha = alignOf(a.align); if (ha) h.align = ha;
    var hi = intIn(a.indent, 0, LIMITS.indent, 0); if (hi) h.indent = hi;
    return h;
  }
  if (type === 'table') {
    var tw = intIn(a.width, 5, LIMITS.tableWidth, 0);
    return tw ? {width:tw} : null;
  }
  if (type === 'ordered_list') return {order:intIn(a.order, 0, 99999, 1)};
  if (type === 'image') {
    var img = {src:typeof a.src === 'string' && PHOTO_SRC.test(a.src) ? a.src : null, alt:cleanString(a.alt).slice(0, LIMITS.alt)};
    var ia = alignOf(a.align); if (ia) img.align = ia;
    return img;
  }
  if (type === 'table_cell' || type === 'table_header') {
    var cell = {colspan:intIn(a.colspan, 1, LIMITS.tableCols, 1), rowspan:intIn(a.rowspan, 1, 500, 1)};
    var cw = colWidthOf(a.colwidth, cell.colspan); if (cw) cell.colwidth = cw;
    return cell;
  }
  return null;
}

// A cell's column widths (px, one per spanned column; 0 = not set), or null when none is set or the shape is wrong.
function colWidthOf(list, colspan) {
  if (!Array.isArray(list) || list.length !== colspan) return null;
  var out = [], any = false;
  for (var i = 0; i < list.length; i++) {
    var w = intIn(list[i], 0, LIMITS.colWidth, -1);
    if (w < 0) return null;
    if (w) any = true;
    out.push(w);
  }
  return any ? out : null;
}

// Cleans one saved document. Returns {v:'ed1', doc} (always at least one empty paragraph), or null when value is not a
// document at all. Keeps every letter it can: an unknown block's text survives as paragraphs.
export function cleanDoc(value) {
  var root = isObject(value) && value.v === DOC_VERSION ? value.doc : (isObject(value) && value.type === 'doc' ? value : null);
  if (!isObject(root) || root.type !== 'doc') return null;
  var budget = {nodes:0, text:0};
  var content = cleanChildren('doc', root.content, 1, budget);
  if (!content.length) content = [emptyParagraph()];
  return {v:DOC_VERSION, doc:{type:'doc', content:content}};
}
export function emptyParagraph() { return {type:'paragraph', attrs:{style:DEFAULT_BODY}}; }
export function emptyDoc() { return {v:DOC_VERSION, doc:{type:'doc', content:[emptyParagraph()]}}; }

function textOfAny(node, depth) {
  if (!isObject(node) || depth > LIMITS.depth) return '';
  if (node.type === 'text') return cleanString(node.text);
  if (!Array.isArray(node.content)) return '';
  var parts = [];
  for (var i = 0; i < node.content.length; i++) parts.push(textOfAny(node.content[i], depth + 1));
  return parts.join('');
}

function cleanInline(list, budget, allowMarks) {
  var out = [];
  if (!Array.isArray(list)) return out;
  for (var i = 0; i < list.length; i++) {
    var n = list[i];
    if (!isObject(n) || budget.nodes >= LIMITS.nodes) continue;
    if (n.type === 'hard_break') { budget.nodes++; out.push({type:'hard_break'}); continue; }
    var text = n.type === 'text' ? cleanString(n.text) : textOfAny(n, 0);
    if (!text || budget.text + text.length > LIMITS.text) continue;
    budget.nodes++; budget.text += text.length;
    var node = {type:'text', text:text};
    var marks = allowMarks && n.type === 'text' ? cleanMarks(n.marks) : [];
    if (marks.length) node.marks = marks;
    out.push(node);
  }
  return out;
}

function cleanChildren(parentType, list, depth, budget) {
  var holds = HOLDS[parentType], out = [];
  if (!Array.isArray(list) || depth > LIMITS.depth) return out;
  for (var i = 0; i < list.length; i++) {
    if (budget.nodes >= LIMITS.nodes) break;
    var n = list[i];
    if (!isObject(n)) continue;
    if (holds === 'block') {
      if (TOP_BLOCKS[n.type]) { var b = cleanNode(n, depth, budget); if (b) out.push(b); }
      else {
        // An unknown block keeps its letters as a paragraph.
        var t = textOfAny(n, depth);
        if (t) out.push({type:'paragraph', attrs:{style:DEFAULT_BODY}, content:cleanInline([{type:'text', text:t}], budget, false)});
      }
    } else if (holds === 'list_item' && n.type === 'list_item') { var li = cleanNode(n, depth, budget); if (li) out.push(li); }
    else if (holds === 'table_row' && n.type === 'table_row') { var tr = cleanNode(n, depth, budget); if (tr) out.push(tr); }
    else if (holds === 'cell' && (n.type === 'table_cell' || n.type === 'table_header')) { var td = cleanNode(n, depth, budget); if (td) out.push(td); }
  }
  return out;
}

function cleanNode(n, depth, budget) {
  var type = n.type, holds = HOLDS[type];
  budget.nodes++;
  var node = {type:type}, attrs = attrsOf(type, n.attrs);
  if (attrs) node.attrs = attrs;
  if (holds === 'none') return node;
  var content;
  if (holds === 'inline') content = cleanInline(n.content, budget, true);
  else if (holds === 'text') content = cleanInline(n.content, budget, false).filter(function (c) { return c.type === 'text'; });
  else content = cleanChildren(type, n.content, depth + 1, budget);
  // Containers that must hold something get an empty paragraph (list item, quote, cell) or are dropped (list, table, row).
  if (!content.length) {
    if (type === 'list_item' || type === 'blockquote' || type === 'table_cell' || type === 'table_header') content = [emptyParagraph()];
    else if (type === 'bullet_list' || type === 'ordered_list' || type === 'table' || type === 'table_row') return null;
  }
  if (type === 'list_item' && content[0].type !== 'paragraph') content.unshift(emptyParagraph());
  if (content.length) node.content = content;
  return node;
}

// Size of the saved form as JSON text (bytes), for the opener's own limits.
export function docBytes(value) {
  try { return new TextEncoder().encode(JSON.stringify(value)).length; } catch (e) { return Infinity; }
}
// True when the document has no letters, photos, rules or tables.
export function isEmptyDoc(value) {
  var clean = cleanDoc(value);
  if (!clean) return true;
  var c = clean.doc.content;
  return c.length === 1 && c[0].type === 'paragraph' && !c[0].content;
}

// ①: next circled number for the [①] button. Circled numbers ①–⑳, ㉑–㉟, ㊱–㊿.
export function circled(n) {
  if (n < 1 || n > 50) return null;
  if (n <= 20) return String.fromCharCode(0x2460 + n - 1);
  if (n <= 35) return String.fromCharCode(0x3251 + n - 21);
  return String.fromCharCode(0x32B1 + n - 36);
}
export function circledValue(ch) {
  var c = typeof ch === 'string' && ch.length ? ch.charCodeAt(0) : 0;
  if (c >= 0x2460 && c <= 0x2473) return c - 0x2460 + 1;
  if (c >= 0x3251 && c <= 0x325F) return c - 0x3251 + 21;
  if (c >= 0x32B1 && c <= 0x32BF) return c - 0x32B1 + 36;
  return 0;
}
const CIRCLED = /[①-⑳㉑-㉟㊱-㊿]/g;
// lines: the text of the current line before the cursor, then the earlier lines nearest first ('' for an empty line,
// null for a heading). The number after the last circled number on the current line; else after the circled number that
// starts the nearest earlier line, looking back past ordinary lines but not past an empty line or a heading; else ①.
// After ㊿ it starts again at ①.
export function nextCircled(current, earlier) {
  var here = String(current || '').match(CIRCLED);
  if (here) return circled(circledValue(here[here.length - 1]) + 1) || circled(1);
  var list = earlier || [];
  for (var i = 0; i < list.length; i++) {
    var line = list[i];
    if (line === null || !String(line).trim()) break;
    var lead = /^\s*([①-⑳㉑-㉟㊱-㊿])/.exec(line);
    if (lead) return circled(circledValue(lead[1]) + 1) || circled(1);
  }
  return circled(1);
}
