// ED-통합편집기 ①a: the one rich-text editor part (블로그 글쓰기형, docs/design/unified-editor.md 2.3), built on the vendored
// ProseMirror bundle (app/editor-lib, loaded only when an editor opens). It edits one document in one box and saves nothing:
// the opener reads getValue() (the cleaned saved form {v:'ed1', doc}) and stores it its own way, as md-editor.js does.
// Button row (small 28px buttons, 44px press area; a phone swipes the one row sideways with [⌄] kept at its right end;
// wider than a phone, buttons that do not fit move under [⌄], so no sideways scroll bar). ED-서식줄펼침 (2026-10-23 사용자
// 11:06~11:10): every button that opens choices carries a small ▾ and opens a small popover right under itself (overlaying the
// text, closed by a press outside or Esc, kept inside the screen); [⌄] ([⌃] while open) is the only button that opens a
// full-width row (the less used buttons). ED-기본기보강 (2026-10-22 사용자
// 19:24~19:33, 대조표 docs/design/unified-editor.md 9절): the often-used buttons stay on the row, the rest are under [⋯]:
//   [본문 2 ▾] | 굵게 기울임 밑줄 | 글자색 ▾ 형광펜 ▾ | 정렬 ▾ | 목록 ▾ 번호 ▾ | 표 ▾ 링크 | · ※ → ① (each ▾) | ↶ ↷ | ⌄
//   ⌄ = 취소선 인용 구분선 들여쓰기 내어쓰기 서식 지우기 서식 없이 붙여넣기 「」 (그리고 폭이 모자라 옮겨진 버튼)
// ED-서식줄묶음 (2026-10-23 사용자 13:16): on a phone (max-width 760px) the same buttons are grouped so the row fits on one line:
//   [본문 2 ▾] [굵게] [·] [▾] | [글자 ▾] [문단 ▾] [넣기 ▾] [기호 ▾] | [↶] [↷]   (no [⌄]; every button is still there, in a group popover)
//   글자 ▾ = 기울임 밑줄 취소선 글자색 형광펜 서식 지우기 / 문단 ▾ = 정렬 목록 번호 들여쓰기 내어쓰기 인용 구분선
//   넣기 ▾ = 표 사진 링크 서식 없이 붙여넣기 / 기호 ▾ = ※ → ① 「」 ([·] puts · in at once, the ▾ beside it picks a similar dot)
// The grouped buttons are the same nodes (moved, so their commands and state stay); a button that opens choices (글자색, 정렬, 목록…)
// opens its own popover under itself, over the group popover. Wider than a phone nothing changes.
// [표] opens a grid to pick rows × columns; a table cell's right-click (a phone's long press) menu adds and removes rows and
// columns, merges and splits cells; column edges drag (saved on the cells, read the same by every reader); a double click on
// an edge fits that column to its letters; Tab goes to the next cell (the last cell's Tab adds a row). A table, rule or photo
// is never a dead end: the text always ends with an empty line, and a gap cursor lets one type before or after any of them.
// Backspace on the line below a table first selects the table, a second press removes it (↶ brings it back).
// [사진] (ED-②) exists only where the opener passes `photos` (share pages: share-photos.js keeps each photo in a private bucket
// and gives a short address to show it). Without `photos` there is no button, and a dropped or pasted picture or file is not put
// in (a short note says so). A saved photo place (src null) still shows as a place.
// Decisions (2026-10-22 사용자, 설계 0절): no format while typing (no input rules: "1. " "- " "# " stay letters); a paste of
// plain letters goes in as typed, one paragraph per line, and when it looks like markdown a small [서식으로 바꾸기] converts
// that pasted part once (undo puts the letters back). [①] opens ①~⑩ (the next number after the nearest one is marked).
// 한글 IME: nothing here changes the document while a composition is running. A button pressed during one lets the press blur
// the box first (that ends the composition), then runs and puts focus back.
import {TEXT_STYLES, DEFAULT_BODY, BODY_STYLES, TEXT_COLORS, HIGHLIGHTS, LIMITS, cleanDoc, emptyDoc, safeHref, nextCircled,
  circled, widthsOfRow, tableLayout, scaleWidths, BULLET_MARKERS, ORDER_MARKERS, autoMarker, bulletGlyph, orderedLabel} from './ed-schema.mjs';
import {looksLikeMarkdown} from './note-markdown.mjs';
import {markdownToDoc} from './ed-markdown.mjs';
import {toPlain} from './ed-text.mjs';

const LIB = './editor-lib/pm-ed1-1.1.0/prosemirror.min.mjs';
const MARKDOWN_IT = './markdown-lib/markdown-it-15.0.2/markdown-it.esm.min.mjs';
let pmPromise = null, mdPromise = null;
export const loadEditorLib = () => (pmPromise ||= import(LIB));
const loadMarkdownIt = () => (mdPromise ||= import(MARKDOWN_IT).then(({default: MarkdownIt}) => {
  const md = new MarkdownIt({html: false, linkify: true, breaks: true, typographer: false});
  md.linkify.set({fuzzyEmail: false});
  md.validateLink = url => !!safeHref(url);
  return md;
}));

const ALIGN_NAMES = ['center', 'right', 'justify'];
const styleOf = el => (/\bed-(body[123])\b/.exec(el.className || '') || [])[1] || DEFAULT_BODY;
const alignOf = el => {
  const css = el.style?.textAlign;
  if (ALIGN_NAMES.includes(css)) return css;
  return ALIGN_NAMES.find(a => new RegExp(`\\bed-${a}\\b`).test(el.className || '')) || null;
};
const indentOf = el => { const m = /\bed-indent-([1-8])\b/.exec(el.className || ''); return m ? +m[1] : 0; };
const headingLevel = el => { const m = /\bed-h([123])\b/.exec(el.className || ''); return m ? +m[1] : Math.min(3, +el.tagName.slice(1)); };
const blockClass = (cls, attrs) => [cls, attrs.align ? `ed-${attrs.align}` : '', attrs.indent ? `ed-indent-${attrs.indent}` : ''].filter(Boolean).join(' ');
const COLOR_KEYS = TEXT_COLORS.map(([v]) => v), HIGHLIGHT_KEYS = HIGHLIGHTS.map(([v]) => v);
const nameFrom = (el, prefix, list) => { const m = new RegExp(`\\b${prefix}-([a-z]+)\\b`).exec(el.className || ''); return m && list.includes(m[1]) ? m[1] : null; };

function buildSchema(pm) {
  const tables = pm.tableNodes({tableGroup: 'block', cellContent: 'block+', cellAttributes: {}});
  return new pm.Schema({
    nodes: {
      doc: {content: 'block+'},
      paragraph: {group: 'block', content: 'inline*', attrs: {style: {default: DEFAULT_BODY}, align: {default: null}, indent: {default: 0}},
        parseDOM: [{tag: 'p', getAttrs: el => ({style: styleOf(el), align: alignOf(el), indent: indentOf(el)})}],
        toDOM: n => ['p', {class: blockClass(`ed-p ed-${n.attrs.style}`, n.attrs)}, 0]},
      heading: {group: 'block', content: 'inline*', defining: true, attrs: {level: {default: 2}, align: {default: null}, indent: {default: 0}},
        parseDOM: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map(tag => ({tag, getAttrs: el => ({level: headingLevel(el), align: alignOf(el), indent: indentOf(el)})})),
        toDOM: n => [`h${n.attrs.level + 1}`, {class: blockClass(`ed-h ed-h${n.attrs.level}`, n.attrs)}, 0]},
      blockquote: {group: 'block', content: 'block+', defining: true, parseDOM: [{tag: 'blockquote'}], toDOM: () => ['blockquote', {class: 'ed-quote'}, 0]},
      // ED-서식줄펼침: `marker` is a shape name (ed-schema.mjs BULLET_MARKERS·ORDER_MARKERS) or null = automatic by nesting depth.
      bullet_list: {group: 'block', content: 'list_item+', attrs: {marker: {default: null}},
        parseDOM: [{tag: 'ul', getAttrs: el => ({marker: nameFrom(el, 'ed-ul', BULLET_MARKERS)})}],
        toDOM: n => ['ul', {class: `ed-ul ed-ul-${n.attrs.marker || 'auto'}`}, 0]},
      ordered_list: {group: 'block', content: 'list_item+', attrs: {order: {default: 1}, marker: {default: null}},
        parseDOM: [{tag: 'ol', getAttrs: el => ({order: el.hasAttribute('start') ? (+el.getAttribute('start') || 1) : 1, marker: nameFrom(el, 'ed-ol', ORDER_MARKERS)})}],
        toDOM: n => ['ol', n.attrs.order === 1 ? {class: `ed-ol ed-ol-${n.attrs.marker || 'auto'}`} : {class: `ed-ol ed-ol-${n.attrs.marker || 'auto'}`, start: n.attrs.order}, 0]},
      list_item: {content: 'paragraph block*', defining: true, parseDOM: [{tag: 'li'}], toDOM: () => ['li', 0]},
      horizontal_rule: {group: 'block', parseDOM: [{tag: 'hr'}], toDOM: () => ['hr', {class: 'ed-hr'}]},
      code_block: {group: 'block', content: 'text*', marks: '', code: true, defining: true,
        parseDOM: [{tag: 'pre', preserveWhitespace: 'full'}], toDOM: () => ['pre', {class: 'ed-code'}, ['code', 0]]},
      // Our own photo (a place until ②). Pasted <img> never becomes one: transformPastedHTML turns it into letters first.
      image: {group: 'block', atom: true, selectable: true, draggable: false,
        attrs: {src: {default: null}, alt: {default: ''}, align: {default: null}},
        parseDOM: [{tag: 'figure.ed-photo', getAttrs: el => ({src: null, alt: el.getAttribute('data-alt') || ''})}],
        toDOM: n => ['figure', {class: 'ed-photo is-place ed-center', 'data-alt': n.attrs.alt, contenteditable: 'false'},
          ['span', {class: 'ed-photo-mark'}, '사진 자리'], ['figcaption', {class: 'ed-photo-cap'}, n.attrs.alt || '사진은 다음 단계부터 넣을 수 있어요']]},
      ...tables,
      text: {group: 'inline'},
      hard_break: {group: 'inline', inline: true, selectable: false, leafText: () => '\n', parseDOM: [{tag: 'br'}], toDOM: () => ['br']},
    },
    marks: {
      strong: {parseDOM: [{tag: 'strong'}, {tag: 'b', getAttrs: el => el.style.fontWeight !== 'normal' && null},
        {style: 'font-weight', getAttrs: v => /^(bold(er)?|[6-9]\d{2})$/.test(v) && null}], toDOM: () => ['strong', 0]},
      em: {parseDOM: [{tag: 'i'}, {tag: 'em'}, {style: 'font-style=italic'}], toDOM: () => ['em', 0]},
      underline: {parseDOM: [{tag: 'u'}, {style: 'text-decoration', getAttrs: v => /underline/.test(v) && null}], toDOM: () => ['u', 0]},
      strike: {parseDOM: [{tag: 's'}, {tag: 'del'}, {tag: 'strike'}, {style: 'text-decoration', getAttrs: v => /line-through/.test(v) && null}], toDOM: () => ['s', 0]},
      link: {attrs: {href: {}}, inclusive: false,
        parseDOM: [{tag: 'a[href]', getAttrs: el => { const href = safeHref(el.getAttribute('href')); return href ? {href} : false; }}],
        toDOM: m => ['a', {href: m.attrs.href, rel: 'noopener noreferrer', target: '_blank', class: 'ed-link'}, 0]},
      // 글자색·형광펜: names only (ed-schema.mjs TEXT_COLORS·HIGHLIGHTS), drawn by ed-doc.css from theme tokens. Pasted colors
      // from elsewhere are not kept (allowlist); a pasted <mark> becomes the yellow highlight.
      color: {attrs: {color: {}}, parseDOM: [{tag: 'span.ed-c', getAttrs: el => { const c = nameFrom(el, 'ed-c', COLOR_KEYS); return c ? {color: c} : false; }}],
        toDOM: m => ['span', {class: `ed-c ed-c-${m.attrs.color}`}, 0]},
      highlight: {attrs: {color: {}}, parseDOM: [{tag: 'mark', getAttrs: el => ({color: nameFrom(el, 'ed-hl', HIGHLIGHT_KEYS) || 'yellow'})}],
        toDOM: m => ['mark', {class: `ed-hl ed-hl-${m.attrs.color}`}, 0]},
    },
  });
}

// Pasted HTML: outside pictures become "이미지: 설명 (주소)" letters, scripts and styles go (parsed inert, nothing loads).
function cleanPastedHtml(html) {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const el of doc.querySelectorAll('script,style,template,iframe,object,embed,svg,math,link,meta')) el.remove();
    for (const img of doc.querySelectorAll('img')) {
      const src = img.getAttribute('src') || '';
      img.replaceWith(doc.createTextNode(`이미지: ${img.getAttribute('alt') || '설명 없음'}${/^https?:/i.test(src) ? ` (${src})` : ''}`));
    }
    return doc.body.innerHTML;
  } catch { return ''; }
}

// The row: [key, label, aria, group]. Under [⋯]: MORE.
const BUTTONS = [
  ['style', '본문 2 ▾', '글 단계 고르기', 'style'],
  ['strong', '굵게', null, 'mark'], ['em', '기울임', null, 'mark'], ['underline', '밑줄', null, 'mark'],
  ['color', '글자색 ▾', '글자색 고르기', 'paint'], ['highlight', '형광펜 ▾', '형광펜 고르기', 'paint'],
  ['align', '왼쪽 ▾', '정렬 고르기', 'align'],
  ['bullet', '목록 ▾', '글머리 목록 고르기', 'list'], ['ordered', '번호 ▾', '번호 목록 고르기', 'list'],
  ['table', '표 ▾', '표 넣기', 'insert'], ['photo', '사진', '사진 넣기', 'insert'], ['link', '링크', '링크 넣기', 'insert'],
  ['symDot', '· ▾', '점 기호 고르기', 'sym'], ['symNote', '※ ▾', '참고 기호 고르기', 'sym'], ['symArrow', '→ ▾', '화살표 고르기', 'sym'], ['symCircled', '① ▾', '동그라미 번호 고르기', 'sym'],
  ['undo', '↶', '되돌리기', 'history'], ['redo', '↷', '다시하기', 'history'],
];
const PLAIN_PASTE_HINT = '복사한 글의 색·크기·표는 빼고 글자만 붙여요 (Ctrl+Shift+V)';
const MORE = [
  ['strike', '취소선', null], ['quote', '인용', null], ['rule', '구분선', null],
  ['indent', '들여쓰기', null], ['outdent', '내어쓰기', null], ['clear', '서식 지우기', null],
  ['plainPaste', '서식 없이 붙여넣기', null], ['symBracket', '「」 ▾', '괄호·단위 기호 고르기'],
];
const ALIGNS = [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽'], ['justify', '양쪽']];
// Signs that open a row of similar signs (사용자 19:33: 비슷한 기호 펼치기). The first one is the button's own sign.
const SYMBOLS = {
  symDot: ['·', '•', '◦', '○', '●', '□', '■', '◇', '◆', '▶', '▷', '★', '☆'],
  symNote: ['※', '☞', '◎', '▣', '☐', '☑', '✓', '✗', '!', '?'],
  symArrow: ['→', '←', '↑', '↓', '↔', '⇒', '⇔', '↗', '↘', '➝'],
  symBracket: ['「」', '『』', '〈〉', '《》', '【】', '“”', '~', '℃', '㎡', '㎞', '%', '㈜', '☎'],
};
const CIRCLED_PICK = Array.from({length: 10}, (_, i) => circled(i + 1));
const TABLE_TOOLS = [
  ['rowBefore', '위에 줄', '위에 줄 넣기'], ['rowAfter', '아래에 줄', '아래에 줄 넣기'],
  ['colBefore', '왼쪽에 칸', '왼쪽에 칸 넣기'], ['colAfter', '오른쪽에 칸', '오른쪽에 칸 넣기'],
  ['rowDel', '줄 삭제', null], ['colDel', '칸 삭제', null], ['merge', '칸 합치기', null], ['split', '칸 나누기', null],
  ['head', '머리줄', null], ['fit', '글자에 맞추기', '표 폭을 글자에 맞추기'], ['select', '표 선택', '표 전체 선택'], ['tableDel', '표 지우기', null],
];
const GRID = {rows: 6, cols: 8};
// ED-서식줄묶음: [key, label, aria, items (button keys, in order)] — a phone's grouped row (see the top of this file).
const GROUPS = [
  ['gText', '글자 ▾', '글자 서식 고르기', ['em', 'underline', 'strike', 'color', 'highlight', 'clear']],
  ['gPara', '문단 ▾', '문단 서식 고르기', ['align', 'bullet', 'ordered', 'indent', 'outdent', 'quote', 'rule']],
  ['gInsert', '넣기 ▾', '넣을 것 고르기', ['table', 'photo', 'link', 'plainPaste']],
  ['gSym', '기호 ▾', '기호 고르기', ['symNote', 'symArrow', 'symCircled', 'symBracket']],
];
const GROUP_KEYS = GROUPS.map(g => g[0]);
const PHONE_ORDER = ['style', 'strong', 'dotNow', 'symDot', ...GROUP_KEYS, 'undo', 'redo'];

// A button's text. A label that ends in " ▾" gets a small caret of its own (hidden from screen readers).
function setLabel(b, text) {
  if (b.dataset.edLabel === text) return;
  b.dataset.edLabel = text;
  const m = /^(.*?) ?▾$/.exec(text);
  if (!m) { b.textContent = text; return; }
  const caret = document.createElement('span');
  caret.className = 'ed-caret'; caret.setAttribute('aria-hidden', 'true'); caret.textContent = m[1] ? ' ▾' : '▾';
  b.replaceChildren(m[1], caret);
}
function btn(label, data, aria) {
  const b = document.createElement('button');
  b.type = 'button'; setLabel(b, label);
  Object.assign(b.dataset, data);
  if (aria) b.setAttribute('aria-label', aria);
  return b;
}
// popover: a small box placed under its button (placePop), not a full-width row.
function panel(className, label, popover = false) {
  const p = document.createElement('div');
  p.className = `ed-menu ${popover ? 'ed-pop ' : ''}${className}`; p.hidden = true; p.setAttribute('role', 'group'); p.setAttribute('aria-label', label);
  return p;
}
const checkMark = () => { const c = document.createElement('span'); c.className = 'ed-check'; c.setAttribute('aria-hidden', 'true'); c.textContent = '✓'; return c; };
const svgEl = (tag, attrs) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
// [⌄] (rotated to [⌃] while open by the stylesheet): a small chevron, drawn so no font has to carry the sign.
const chevron = () => { const svg = svgEl('svg', {viewBox: '0 0 12 12', width: '12', height: '12', 'aria-hidden': 'true', focusable: 'false'}); svg.classList.add('ed-chevron'); svg.append(svgEl('path', {d: 'M2.5 4.5 6 8l3.5-3.5', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round'})); return svg; };
// ED-사진링크아이콘: [사진] [링크] are icons on the row and icon + letters inside the phone's [넣기 ▾] list (the stylesheet hides the letters
// on the row). Drawn in the site's own icon style (the 24-box stroke icons of the bottom menu: currentColor, round ends), shown at 16px.
const ICON_PATHS = {
  photo: [['path', {d: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5'}], ['circle', {cx: '9', cy: '9.5', r: '1.3'}]],
  link: [['path', {d: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'}]],
};
const toolIcon = key => {
  const svg = svgEl('svg', {viewBox: '0 0 24 24', width: '16', height: '16', 'aria-hidden': 'true', focusable: 'false', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round'});
  svg.classList.add('ed-tool-icon');
  for (const [tag, attrs] of ICON_PATHS[key]) svg.append(svgEl(tag, attrs));
  return svg;
};
// A 정렬 icon: four lines, each as long and as far over as the alignment puts it.
const ALIGN_LINES = {left: [[1, 13], [1, 9], [1, 13], [1, 7]], center: [[1, 13], [3, 11], [1, 13], [4, 10]], right: [[1, 13], [5, 13], [1, 13], [7, 13]], justify: [[1, 13], [1, 13], [1, 13], [1, 13]]};
const alignIcon = v => { const svg = svgEl('svg', {viewBox: '0 0 14 12', width: '14', height: '12', 'aria-hidden': 'true', focusable: 'false'}); ALIGN_LINES[v].forEach(([a, b], i) => svg.append(svgEl('path', {d: `M${a} ${1.5 + i * 3}H${b}`, stroke: 'currentColor', 'stroke-width': '1.3', 'stroke-linecap': 'round'}))); return svg; };

// Mounts an editor into host. value: a saved form (or null for an empty one). onChange(value): after each change.
// label: the text box's accessible name. head: an optional node put between the button row and the text box (a title).
// Returns {getValue(), getText(), isEmpty(), focus(), destroy(), view, root}.
// getText() is the letters for raw_text (ed-text.mjs toPlain): the opener saves structure and letters together (설계 3.1).
// photos: null, or {add(file) -> {src}, url(src) -> address|null, max} (share pages, ED-②).
export async function createDocEditor({host, value = null, onChange = null, label = '본문', placeholder = '', head = null, photos = null} = {}) {
  const pm = await loadEditorLib();
  const schema = buildSchema(pm);
  const N = schema.nodes, M = schema.marks;
  const start = cleanDoc(value) || emptyDoc();
  let doc;
  try { doc = pm.Node.fromJSON(schema, start.doc); doc.check(); } catch { doc = pm.Node.fromJSON(schema, emptyDoc().doc); }

  // ── button row and its panels ──
  const root = document.createElement('div');
  root.className = 'ed-editor';
  const bar = document.createElement('div'), tools = document.createElement('div');
  bar.className = 'ed-bar';
  tools.className = 'ed-tools'; tools.setAttribute('role', 'toolbar'); tools.setAttribute('aria-label', '서식');
  const buttons = {};
  const OPENS = {style: 'style', color: 'color', highlight: 'highlight', align: 'align', bullet: 'bullet', ordered: 'ordered', table: 'grid', link: 'link',
    symDot: 'symDot', symNote: 'symNote', symArrow: 'symArrow', symCircled: 'symCircled', symBracket: 'symBracket',
    gText: 'gText', gPara: 'gPara', gInsert: 'gInsert', gSym: 'gSym'};
  let lastGroup = null;
  for (const [key, text, aria, group] of BUTTONS) {
    if (key === 'photo' && !photos) continue;
    const b = btn(text, {edCmd: key, edGroup: group}, aria);
    if (lastGroup && group !== lastGroup) b.classList.add('ed-gap');
    lastGroup = group;
    if (OPENS[key]) { b.setAttribute('aria-haspopup', 'true'); b.setAttribute('aria-expanded', 'false'); }
    if (key === 'style') b.classList.add('ed-style');
    if (ICON_PATHS[key]) {
      const word = document.createElement('span'); word.className = 'ed-tool-word'; word.textContent = text;
      b.replaceChildren(toolIcon(key), word); b.classList.add('ed-icon-btn'); b.title = aria;
    }
    if (group === 'mark' || group === 'list') b.setAttribute('aria-pressed', 'false');
    buttons[key] = b; tools.append(b);
  }
  // [⌄] / [⌃]: no box, the same small size; a light highlight while open (stylesheet). The one button that opens a full row.
  const more = btn('', {edMore: ''}, '서식 더 보기');
  more.classList.add('ed-more'); more.title = '서식 더 보기'; more.setAttribute('aria-haspopup', 'true'); more.setAttribute('aria-expanded', 'false');
  more.append(chevron());
  tools.append(more);
  const homeTools = [...tools.children].filter(b => b !== more);
  // ED-서식줄묶음: the phone's group buttons and the [·] that puts a dot in at once. They sit outside the row until a phone needs them.
  for (const [key, text, aria] of GROUPS) {
    const b = btn(text, {edCmd: key, edGroup: 'phone'}, aria);
    b.setAttribute('aria-haspopup', 'true'); b.setAttribute('aria-expanded', 'false');
    buttons[key] = b;
  }
  buttons.dotNow = btn('·', {edSym: '·', edGroup: 'phone'}, '점 넣기');
  const panels = {};
  panels.more = panel('ed-more-menu', '서식 더 보기');
  const homeMore = [];
  for (const [key, text, aria] of MORE) {
    const b = btn(text, {edCmd: key, edFixed: ''}, aria);
    homeMore.push(b);
    if (OPENS[key]) { b.setAttribute('aria-haspopup', 'true'); b.setAttribute('aria-expanded', 'false'); }
    if (key === 'strike' || key === 'quote') b.setAttribute('aria-pressed', 'false');
    if (key === 'plainPaste') { b.title = PLAIN_PASTE_HINT; b.setAttribute('aria-description', PLAIN_PASTE_HINT); }
    buttons[key] = b; panels.more.append(b);
  }
  // Popovers (ed-pop): a vertical list with a ✓ on the current choice (글 단계·정렬·목록·번호), or a small block of swatches
  // and signs (글자색·형광펜·기호·표 격자). Each opens right under the button that was pressed.
  // The group popovers hold the grouped buttons as a vertical list (filled by setGrouped).
  for (const [key, , aria] of GROUPS) panels[key] = panel('ed-group-menu', aria.replace(/ 고르기$/, ''), true);
  panels.style = panel('ed-style-menu', '글 단계', true);
  for (const [v, text] of TEXT_STYLES) { const b = btn(text, {edStyle: v}); b.append(checkMark()); panels.style.append(b); }
  panels.color = panel('ed-color-menu', '글자색', true);
  { const b = btn('색 없음', {edColor: ''}); b.append(checkMark()); panels.color.append(b); }
  for (const [v, text] of TEXT_COLORS) { const b = btn('', {edColor: v}, `글자색 ${text}`); b.append(Object.assign(document.createElement('span'), {className: `ed-c ed-c-${v}`, textContent: '가'}), ` ${text}`, checkMark()); panels.color.append(b); }
  panels.highlight = panel('ed-highlight-menu', '형광펜', true);
  { const b = btn('형광펜 없음', {edHighlight: ''}); b.append(checkMark()); panels.highlight.append(b); }
  for (const [v, text] of HIGHLIGHTS) { const b = btn('', {edHighlight: v}, `형광펜 ${text}`); b.append(Object.assign(document.createElement('mark'), {className: `ed-hl ed-hl-${v}`, textContent: text}), checkMark()); panels.highlight.append(b); }
  panels.align = panel('ed-align-menu', '정렬', true);
  for (const [v, text] of ALIGNS) { const b = btn('', {edAlign: v}, `${text} 정렬`); b.append(alignIcon(v), Object.assign(document.createElement('span'), {className: 'ed-opt-text', textContent: text}), checkMark()); panels.align.append(b); }
  // 목록 ▾ / 번호 ▾: each choice shows two lines of what it will look like; [목록 풀기] takes the item out of the list.
  for (const kind of ['bullet', 'ordered']) {
    panels[kind] = panel(`ed-list-menu ed-${kind}-menu`, kind === 'bullet' ? '글머리 목록' : '번호 목록', true);
    for (const marker of kind === 'bullet' ? BULLET_MARKERS : ORDER_MARKERS) {
      const sign = n => kind === 'bullet' ? bulletGlyph(marker, 0) : orderedLabel(marker, 0, n);
      const b = btn('', {edListKind: kind, edListMarker: marker}, `${kind === 'bullet' ? '글머리' : '번호'} ${sign(1)}`);
      const prev = document.createElement('span'); prev.className = 'ed-list-prev';
      for (const n of [1, 2]) { const line = document.createElement('span'); line.textContent = `${sign(n)} 항목`; prev.append(line); }
      b.append(prev, checkMark());
      panels[kind].append(b);
    }
    const off = btn('목록 풀기', {edListOff: kind}); off.classList.add('ed-list-off');
    panels[kind].append(off);
  }
  for (const key of ['symDot', 'symNote', 'symArrow', 'symBracket']) {
    panels[key] = panel('ed-sym-menu', buttons[key].getAttribute('aria-label').replace(/ 고르기$/, ''), true);
    for (const sign of SYMBOLS[key]) panels[key].append(btn(sign, {edSym: sign}, `${sign} 넣기`));
  }
  panels.symCircled = panel('ed-sym-menu', '동그라미 번호', true);
  for (const sign of CIRCLED_PICK) panels.symCircled.append(btn(sign, {edSym: sign}, `${sign} 넣기`));
  // [표]: a grid of rows × columns; the picked size shows beside it.
  panels.grid = panel('ed-grid-menu', '표 크기 고르기', true);
  const grid = document.createElement('div'); grid.className = 'ed-grid';
  grid.style.setProperty('--ed-grid-cols', String(GRID.cols));
  for (let r = 1; r <= GRID.rows; r++) for (let c = 1; c <= GRID.cols; c++) grid.append(btn('', {edGridR: String(r), edGridC: String(c)}, `${r}줄 ${c}칸 표`));
  const gridSize = document.createElement('span'); gridSize.className = 'ed-grid-size'; gridSize.textContent = '2 × 2';
  panels.grid.append(grid, gridSize);
  // [링크]: one address box.
  // Its address box is put in only while the row is open (no hidden input sits in the page otherwise).
  panels.link = panel('ed-link-menu', '링크', true);
  const linkInput = Object.assign(document.createElement('input'), {type: 'url', className: 'ed-link-input', placeholder: 'https://…', autocomplete: 'off'});
  linkInput.setAttribute('aria-label', '링크 주소'); linkInput.spellcheck = false;
  const linkOk = btn('넣기', {edLinkOk: ''}, '링크 넣기 확인'), linkOff = btn('링크 빼기', {edLinkOff: ''});
  const tableRow = panel('ed-table-tools', '표 고치기');
  for (const [key, text, aria] of TABLE_TOOLS) tableRow.append(btn(text, {edTable: key}, aria));
  const suggest = document.createElement('div');
  suggest.className = 'ed-suggest'; suggest.hidden = true; suggest.setAttribute('role', 'status');
  const suggestText = document.createElement('span'); suggestText.textContent = '마크다운 기호가 보여요.';
  const convert = btn('서식으로 바꾸기', {edConvert: ''}), dismiss = btn('×', {edDismiss: ''}, '그대로 두기');
  suggest.append(suggestText, convert, dismiss);
  const note = document.createElement('div');
  note.className = 'ed-note'; note.hidden = true; note.setAttribute('role', 'status');
  const status = document.createElement('p');
  status.className = 'ed-status a11y-only'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const PANEL_ORDER = ['more', ...GROUP_KEYS, 'style', 'color', 'highlight', 'align', 'bullet', 'ordered', 'symDot', 'symNote', 'symArrow', 'symCircled', 'symBracket', 'grid', 'link'];
  // The full-width rows (the [⌄] row, table tools, offers, notes) sit in the flow; popovers are placed on the screen.
  bar.append(tools, panels.more, tableRow, suggest, note, ...PANEL_ORDER.filter(k => k !== 'more').map(k => panels[k]));
  const box = document.createElement('div');
  box.className = 'ed-box';
  // The table cell menu (right click, a phone's long press): a small floating list, closed by Esc or a press outside.
  const ctx = document.createElement('div');
  ctx.className = 'ed-ctx'; ctx.hidden = true; ctx.setAttribute('role', 'menu'); ctx.setAttribute('aria-label', '표 칸 메뉴');
  for (const [key, text, aria] of TABLE_TOOLS) { const b = btn(text, {edTable: key}, aria); b.setAttribute('role', 'menuitem'); ctx.append(b); }
  const measure = document.createElement('div');
  measure.className = 'ed-doc ed-measure'; measure.setAttribute('aria-hidden', 'true');
  root.append(bar, ...(head ? [head] : []), box, status, ctx, measure);
  host.append(root);

  // ── plugins ──
  // The pasted part of a plain-letter paste, kept (mapped through later steps) until it is converted or dismissed.
  const pasteKey = new pm.PluginKey('edPaste');
  const pastePlugin = new pm.Plugin({
    key: pasteKey,
    state: {
      init: () => null,
      apply(tr, prev) {
        const meta = tr.getMeta(pasteKey);
        if (meta !== undefined) return meta;
        if (!prev) return null;
        // Typing elsewhere keeps the offer; typing inside the pasted part ends it (it is no longer only the paste).
        const from = tr.mapping.map(prev.from, 1), to = tr.mapping.map(prev.to, -1);
        if (to <= from) return null;
        let touched = false;
        tr.mapping.maps.forEach(map => map.forEach((s, e) => { if (s < prev.to && e > prev.from) touched = true; }));
        return touched && !tr.getMeta('paste') ? null : {from, to, text: prev.text};
      },
    },
  });
  // The text always ends with a line one can type on (after a table, rule, photo, list or quote at the end).
  const endsOpen = d => { const last = d.lastChild; return !!last && (last.type === N.paragraph || last.type === N.heading); };
  const endLinePlugin = new pm.Plugin({
    appendTransaction(trs, old, st) {
      if (!trs.some(tr => tr.docChanged) || endsOpen(st.doc)) return null;
      return st.tr.insert(st.doc.content.size, N.paragraph.create({style: DEFAULT_BODY}));
    },
  });
  // Column widths: before a column edge drag starts, every column gets its shown width (so nothing jumps), and when it
  // ends, a table wider than the text is scaled down to fit (the saved widths are what every reader shows, as shares).
  const textWidth = () => {
    const cs = getComputedStyle(view.dom);
    return Math.max(120, view.dom.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
  };
  // The table around pos (or right after it) in a state or a document.
  const tableAt = (stOrDoc, pos) => {
    const d0 = stOrDoc.doc || stOrDoc, $p = d0.resolve(pos);
    for (let d = $p.depth; d > 0; d--) if ($p.node(d).type === N.table) return {node: $p.node(d), pos: $p.before(d), start: $p.start(d)};
    const after = d0.nodeAt(pos);
    return after && after.type === N.table ? {node: after, pos, start: pos + 1} : null;
  };
  function shownWidths(t) {
    const dom = view.nodeDOM(t.pos);
    const tableEl = dom && (dom.tagName === 'TABLE' ? dom : dom.querySelector?.('table'));
    const row = tableEl?.querySelector('tr');
    const out = [];
    if (!row) return out;
    for (const cell of row.children) { const span = +cell.getAttribute('colspan') || 1; for (let i = 0; i < span; i++) out.push(Math.round(cell.getBoundingClientRect().width / span)); }
    return out;
  }
  // Sets the columns' widths (px, one per column) on every cell of the table at t.
  function setWidths(tr, t, widths) {
    const map = pm.TableMap.get(t.node), seen = new Set();
    for (let i = 0; i < map.map.length; i++) {
      const pos = map.map[i];
      if (seen.has(pos)) continue;
      seen.add(pos);
      const cell = t.node.nodeAt(pos), rect = map.findCell(pos);
      const colwidth = [];
      for (let c = rect.left; c < rect.right; c++) colwidth.push(Math.max(0, Math.min(LIMITS.colWidth, Math.round(widths[c] || 0))));
      if (JSON.stringify(cell.attrs.colwidth) !== JSON.stringify(colwidth)) tr.setNodeMarkup(t.start + pos, null, {...cell.attrs, colwidth});
    }
    return tr;
  }
  const widthsOf = t => { const first = t.node.firstChild; const cells = []; first.forEach(c => cells.push(c.attrs)); return widthsOfRow(cells); };
  function freezeColumns(t) {
    const widths = widthsOf(t);
    if (widths.length && widths.every(w => w > 0)) return false;
    const shown = shownWidths(t);
    if (shown.length !== widths.length) return false;
    view.dispatch(setWidths(view.state.tr, t, widths.map((w, i) => w || shown[i])).setMeta('addToHistory', false));
    return true;
  }
  function fitToText(tr, t) {
    const widths = widthsOf(t), total = widths.reduce((a, b) => a + b, 0), room = textWidth();
    if (!total || total <= room) return tr;
    return setWidths(tr, t, widths.map(w => Math.max(24, Math.floor(w * room / total))));
  }
  // Double click on a column edge: that column as wide as its longest line (others keep their width).
  function fitColumn(handlePos) {
    const t = tableAt(view.state, handlePos);
    if (!t) return;
    freezeColumns(t);
    const tt = tableAt(view.state, handlePos), map = pm.TableMap.get(tt.node);
    const col = map.colCount(handlePos - tt.start) + tt.node.nodeAt(handlePos - tt.start).attrs.colspan - 1;
    let widest = 0;
    for (let r = 0; r < map.height; r++) {
      const pos = map.map[r * map.width + col], dom = view.nodeDOM(tt.start + pos);
      if (!dom) continue;
      measure.textContent = '';
      for (const child of dom.childNodes) measure.append(child.cloneNode(true));
      widest = Math.max(widest, measure.getBoundingClientRect().width);
    }
    measure.textContent = '';
    const widths = widthsOf(tt);
    widths[col] = Math.max(40, Math.ceil(widest) + 24);
    const tr = setWidths(view.state.tr, tt, widths);
    view.dispatch(fitToText(tr, tableAt(tr.doc, tt.pos + 1) || tt));
  }
  const resizePlugin = new pm.Plugin({
    props: {
      handleDOMEvents: {
        mousedown(v, event) {
          const rs = pm.columnResizingPluginKey.getState(v.state);
          if (!rs || rs.activeHandle < 0 || rs.dragging || event.button !== 0 || event.detail > 1) return false;
          const t = tableAt(v.state, rs.activeHandle);
          if (t) freezeColumns(t);
          return false;
        },
        dblclick(v, event) {
          const rs = pm.columnResizingPluginKey.getState(v.state);
          if (!rs || rs.activeHandle < 0) return false;
          event.preventDefault();
          fitColumn(rs.activeHandle);
          return true;
        },
      },
    },
    appendTransaction(trs, old, st) {
      const ended = trs.some(tr => { const m = tr.getMeta(pm.columnResizingPluginKey); return m && 'setDragging' in m && m.setDragging === null; });
      if (!ended) return null;
      const was = pm.columnResizingPluginKey.getState(old);
      const t = was && was.activeHandle > -1 ? tableAt(st, Math.min(was.activeHandle, st.doc.content.size)) : null;
      if (!t) return null;
      const tr = fitToText(st.tr, t);
      return tr.docChanged ? tr : null;
    },
  });
  // ED-표크기끌기: a small handle at the table's bottom right corner. Dragging it with the mouse scales every column by the
  // same factor (shares stay; the table is as wide as the columns' sum, never wider than the text, never under MIN_COL per
  // column), the border follows while dragging, and letting go saves the new colwidths (one undo step). The saved size is
  // the cells' colwidth, which every reader already draws, so nothing else changes. Fingers do not drag it (see the report).
  const MIN_COL = 32;
  function paintWidths(tv, widths) {
    const lay = tableLayout(widths);
    [...tv.colgroup.children].forEach((col, i) => { col.style.width = lay ? lay.cols[i] : ''; });
    tv.table.style.width = lay ? `${lay.width}px` : '';
  }
  function startTableResize(tv, event) {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    let t = tableAt(view.state, view.posAtDOM(tv.contentDOM, 0));
    if (!t) return;
    freezeColumns(t);
    t = tableAt(view.state, view.posAtDOM(tv.contentDOM, 0));
    const start = widthsOf(t), startTotal = start.reduce((a, b) => a + b, 0), startX = event.clientX;
    if (!start.length || !startTotal) return;
    const room = Math.max(textWidth(), startTotal);
    let latest = {widths: start, total: startTotal};
    tv.dom.classList.add('is-resizing');
    tv.resizer.setPointerCapture?.(event.pointerId);
    const move = e => {
      latest = scaleWidths(start, startTotal + (e.clientX - startX), {min: MIN_COL, max: room});
      paintWidths(tv, latest.widths);
    };
    const finish = save => {
      tv.resizer.removeEventListener('pointermove', move);
      tv.resizer.removeEventListener('pointerup', up);
      tv.resizer.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', esc, true);
      tv.dom.classList.remove('is-resizing');
      try { tv.resizer.releasePointerCapture?.(event.pointerId); } catch { /* already released */ }
      const now = tableAt(view.state, view.posAtDOM(tv.contentDOM, 0));
      if (save && now && latest.widths.join() !== start.join()) { view.dispatch(setWidths(view.state.tr, now, latest.widths)); say('표 크기를 바꿨어요.'); }
      else tv.layout();
    };
    const up = () => finish(true), cancel = () => finish(false);
    const esc = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } };
    tv.resizer.addEventListener('pointermove', move);
    tv.resizer.addEventListener('pointerup', up);
    tv.resizer.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', esc, true);
  }

  // The table as drawn in the editor: the same layout readers use (ed-render.mjs, ed-schema.mjs tableLayout), plus a small
  // grip at its top left corner that selects the whole table and a handle at its bottom right corner that resizes it.
  class TableView {
    constructor(node) {
      this.node = node;
      this.dom = document.createElement('div'); this.dom.className = 'tableWrapper ed-table-wrap';
      this.grip = document.createElement('span'); this.grip.className = 'ed-table-grip'; this.grip.contentEditable = 'false';
      this.grip.setAttribute('aria-hidden', 'true'); this.grip.title = '표 전체 선택';
      this.box = document.createElement('div'); this.box.className = 'ed-table-box';
      this.resizer = document.createElement('span'); this.resizer.className = 'ed-table-resize'; this.resizer.contentEditable = 'false';
      this.resizer.setAttribute('aria-hidden', 'true'); this.resizer.title = '끌어서 표 크기 바꾸기';
      this.resizer.addEventListener('pointerdown', e => startTableResize(this, e));
      this.table = document.createElement('table'); this.table.className = 'ed-table';
      this.colgroup = this.table.appendChild(document.createElement('colgroup'));
      this.contentDOM = this.table.appendChild(document.createElement('tbody'));
      this.box.append(this.table, this.resizer);
      this.dom.append(this.grip, this.box);
      this.layout();
    }
    layout() {
      const cells = []; this.node.firstChild?.forEach(c => cells.push(c.attrs));
      const widths = widthsOfRow(cells), lay = tableLayout(widths);
      while (this.colgroup.childElementCount > widths.length) this.colgroup.lastChild.remove();
      while (this.colgroup.childElementCount < widths.length) this.colgroup.append(document.createElement('col'));
      [...this.colgroup.children].forEach((col, i) => { col.style.width = lay ? lay.cols[i] : ''; });
      this.table.classList.toggle('ed-fixed', !!lay);
      this.table.style.minWidth = '';
      this.table.style.width = lay ? `${lay.width}px` : '';
    }
    update(node) { if (node.type !== this.node.type) return false; this.node = node; this.layout(); return true; }
    ignoreMutation(record) { return record.type === 'attributes' && (record.target === this.dom || record.target === this.box || record.target === this.table || this.colgroup.contains(record.target) || this.resizer.contains(record.target)) || this.grip.contains(record.target) || this.resizer.contains(record.target); }
    stopEvent(event) { return this.grip.contains(event.target) || this.resizer.contains(event.target); }
  }

  // ── keys ──
  const paragraphAttrs = node => node.type === N.paragraph ? {type: N.paragraph, attrs: {style: node.attrs.style, align: node.attrs.align, indent: node.attrs.indent}} : null;
  const enter = pm.chainCommands(pm.splitListItem(N.list_item), pm.newlineInCode, pm.createParagraphNear, pm.liftEmptyBlock,
    pm.splitBlockAs((node, atEnd) => (atEnd && node.type === N.heading) ? {type: N.paragraph, attrs: {style: DEFAULT_BODY, align: node.attrs.align, indent: node.attrs.indent}} : paragraphAttrs(node)));
  const hardBreak = pm.chainCommands(pm.exitCode, (state, dispatch) => { dispatch?.(state.tr.replaceSelectionWith(N.hard_break.create()).scrollIntoView()); return true; });
  // Tab in a table: the next cell; in the last cell a new row first.
  const nextCellOrRow = (state, dispatch) => {
    if (!pm.isInTable(state)) return false;
    if (pm.goToNextCell(1)(state, dispatch)) return true;
    if (!dispatch) return true;
    pm.addRowAfter(state, tr => {
      const next = state.apply(tr);
      const rect = pm.selectedRect(next), cellPos = rect.tableStart + rect.map.map[(rect.bottom) * rect.map.width];
      tr.setSelection(pm.TextSelection.near(tr.doc.resolve(cellPos + 1))).scrollIntoView();
      dispatch(tr);
    });
    return true;
  };
  const indentBy = step => (state, dispatch) => {
    const blocks = textblocksInSelection(state).filter(b => b.node.type === N.paragraph || b.node.type === N.heading);
    if (!blocks.length) return false;
    const tr = state.tr;
    for (const {node, pos} of blocks) tr.setNodeAttribute(pos, 'indent', Math.max(0, Math.min(LIMITS.indent, (node.attrs.indent || 0) + step)));
    if (dispatch && tr.docChanged) dispatch(tr);
    return true;
  };
  // A whole table chosen (all of its cells, or the table node): Backspace/Delete removes it.
  const wholeTable = st => {
    const sel = st.selection;
    if (sel instanceof pm.NodeSelection && sel.node.type === N.table) return true;
    return sel instanceof pm.CellSelection && sel.isRowSelection() && sel.isColSelection();
  };
  const removeWholeTable = (state, dispatch) => wholeTable(state) ? pm.deleteTable(state, dispatch) : false;
  // On the line just after (Backspace) or before (Delete) a table, rule or photo: choose that block first, so a press never
  // removes a table without showing it.
  const chooseNeighbour = dir => (state, dispatch) => {
    const sel = state.selection;
    if (!(sel instanceof pm.TextSelection) || !sel.empty) return false;
    const $c = sel.$cursor, parent = $c.parent;
    if (!parent.isTextblock || (dir < 0 ? $c.parentOffset !== 0 : $c.parentOffset !== parent.content.size)) return false;
    const $edge = state.doc.resolve(dir < 0 ? $c.before() : $c.after());
    const other = dir < 0 ? $edge.nodeBefore : $edge.nodeAfter;
    if (!other || !(other.type === N.table || other.type === N.image || other.type === N.horizontal_rule)) return false;
    if (!dispatch) return true;
    // An empty line between a block and the end goes first only when it is not the last line (the end line always stays).
    const at = dir < 0 ? $edge.pos - other.nodeSize : $edge.pos;
    if (other.type === N.table) {
      const map = pm.TableMap.get(other);
      dispatch(state.tr.setSelection(pm.CellSelection.create(state.doc, at + 1 + map.map[0], at + 1 + map.map[map.map.length - 1])).scrollIntoView());
    } else dispatch(state.tr.setSelection(pm.NodeSelection.create(state.doc, at)).scrollIntoView());
    say(other.type === N.table ? '표를 선택했어요. 한 번 더 누르면 지워요.' : '선택했어요. 한 번 더 누르면 지워요.');
    return true;
  };
  // ↑ in a table's first row / ↓ in its last row: out of the table. When no line is there (the table starts the text, or
  // sits next to another table, rule or photo) the cursor becomes a gap cursor there, and typing makes a line.
  const leaveTable = dir => (state, dispatch, v) => {
    const sel = state.selection;
    if (!(sel instanceof pm.TextSelection) || !sel.empty || !pm.isInTable(state)) return false;
    if (v && !v.endOfTextblock(dir < 0 ? 'up' : 'down')) return false;
    const $c = sel.$from;
    let depth = -1;
    for (let d = $c.depth; d > 0; d--) if ($c.node(d).type === N.table) { depth = d; break; }
    if (depth < 0) return false;
    const table = $c.node(depth), map = pm.TableMap.get(table), start = $c.start(depth);
    const cellPos = $c.before(depth + 2) - start, rect = map.findCell(cellPos);
    if (dir < 0 ? rect.top !== 0 : rect.bottom !== map.height) return false;
    const edge = dir < 0 ? $c.before(depth) : $c.after(depth), $edge = state.doc.resolve(edge);
    const other = dir < 0 ? $edge.nodeBefore : $edge.nodeAfter;
    if (other && other.isTextblock) {
      dispatch?.(state.tr.setSelection(pm.TextSelection.create(state.doc, dir < 0 ? edge - 1 : edge + 1)).scrollIntoView());
      return true;
    }
    if (!pm.GapCursor.valid($edge)) return false;
    dispatch?.(state.tr.setSelection(new pm.GapCursor($edge)).scrollIntoView());
    return true;
  };
  const keys = {
    ArrowUp: leaveTable(-1), ArrowDown: leaveTable(1),
    Enter: enter, 'Shift-Enter': hardBreak, 'Mod-Enter': () => false,
    'Mod-z': pm.undo, 'Mod-y': pm.redo, 'Shift-Mod-z': pm.redo,
    'Mod-b': pm.toggleMark(M.strong), 'Mod-i': pm.toggleMark(M.em), 'Mod-u': pm.toggleMark(M.underline),
    'Mod-k': () => { openPanel('link'); return true; },
    Escape: () => { if (!openName) return false; closePanels(); return true; },
    'Mod-\\': (st, d) => clearFormat(st, d),
    Tab: pm.chainCommands(nextCellOrRow, pm.sinkListItem(N.list_item), indentBy(1)),
    'Shift-Tab': pm.chainCommands(pm.goToNextCell(-1), pm.liftListItem(N.list_item), indentBy(-1)),
    Backspace: pm.chainCommands(removeWholeTable, chooseNeighbour(-1)),
    Delete: pm.chainCommands(removeWholeTable, chooseNeighbour(1)),
    'Mod-Backspace': removeWholeTable,
  };
  const plugins = [resizePlugin, pm.columnResizing({handleWidth: 6, cellMinWidth: 32, defaultCellMinWidth: 48, View: TableView}),
    pm.history(), pm.keymap(keys), pm.keymap(pm.baseKeymap), pm.gapCursor(), pm.tableEditing(), pastePlugin, endLinePlugin];
  let state = pm.EditorState.create({doc, plugins});
  const fix = pm.fixTables(state);
  if (fix) state = state.apply(fix.setMeta('addToHistory', false));
  if (!endsOpen(state.doc)) state = state.apply(state.tr.insert(state.doc.content.size, N.paragraph.create({style: DEFAULT_BODY})).setMeta('addToHistory', false));

  let pendingPaste = null, pointerHeld = false;
  const isFileTransfer = data => !!data && ([...(data.types || [])].includes('Files') || (data.files && data.files.length > 0));
  const view = new pm.EditorView(box, {
    state,
    nodeViews: {image: node => photoView(node)},
    attributes: {class: 'ed-doc ed-input', role: 'textbox', 'aria-multiline': 'true', 'aria-label': label, spellcheck: 'false',
      ...(placeholder ? {'data-placeholder': placeholder} : {})},
    transformPastedHTML: cleanPastedHtml,
    // A whole table copied from this editor (all cells chosen) comes as an open slice that only fits inside a table; outside
    // one it goes in as a table of its own.
    transformPasted(slice, v) {
      const only = slice.content.childCount === 1 && slice.content.firstChild;
      if (!only || only.type !== N.table || (slice.openStart === 0 && slice.openEnd === 0) || pm.isInTable(v.state)) return slice;
      return new pm.Slice(slice.content, 0, 0);
    },
    // Plain letters: one paragraph per line, blank lines kept, nothing read as format.
    clipboardTextParser(text, $context) {
      const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
      if ($context.parent.type.spec.code) return new pm.Slice(pm.Fragment.from(schema.text(text)), 0, 0);
      const style = $context.parent.type === N.paragraph ? $context.parent.attrs.style : DEFAULT_BODY;
      const nodes = lines.map(line => N.paragraph.create({style}, line ? schema.text(line) : null));
      return new pm.Slice(pm.Fragment.from(nodes), 1, 1);
    },
    handlePaste(v, event) {
      const data = event.clipboardData;
      const text = data?.getData('text/plain') || '';
      const html = data?.getData('text/html') || '';
      // A copied picture or file (no letters with it) is not put in until ② (공유 사진 보관).
      if (isFileTransfer(data) && !text && !html) { photosFrom(data.files); return true; }
      // Decide after the paste lands: mark its range when the letters look like markdown and no formatted copy came with them.
      pendingPaste = !html && looksLikeMarkdown(text) ? {text, before: v.state.selection.from, size: v.state.doc.content.size} : null;
      return false;
    },
    handleDrop(v, event, slice, moved) {
      if (moved || !isFileTransfer(event.dataTransfer)) return false;
      event.preventDefault();
      photosFrom(event.dataTransfer.files);
      return true;
    },
    handleDOMEvents: {
      // Letters typed at a gap cursor (before or after a table, rule or photo) start a new line there. The gapcursor plugin
      // covers a composition starting there; this covers plain text input (a pasted word, a keyboard without composition).
      beforeinput(v, event) {
        if (event.inputType !== 'insertText' || !event.data || !(v.state.selection instanceof pm.GapCursor)) return false;
        event.preventDefault();
        v.dispatch(v.state.tr.insertText(event.data).scrollIntoView());
        return true;
      },
      contextmenu(v, event) {
        const cell = event.target.closest?.('td,th');
        if (!cell || !v.dom.contains(cell)) return false;
        const pos = v.posAtDOM(cell, 0);
        // Right click inside a chosen group of cells keeps the group (to merge them); elsewhere the cursor goes there.
        const sel = v.state.selection;
        const inChosen = sel instanceof pm.CellSelection && pos >= sel.from && pos <= sel.to;
        if (!inChosen) v.dispatch(v.state.tr.setSelection(pm.TextSelection.near(v.state.doc.resolve(pos))));
        event.preventDefault();
        openCtx(event.clientX, event.clientY);
        return true;
      },
    },
    dispatchTransaction(tr) {
      const next = view.state.apply(tr);
      if (pendingPaste && tr.getMeta('paste') && tr.docChanged) {
        const to = tr.selection.to, from = tr.mapping.map(pendingPaste.before, -1);
        view.updateState(next);
        if (to > from) view.dispatch(view.state.tr.setMeta(pasteKey, {from, to, text: pendingPaste.text}).setMeta('addToHistory', false));
        pendingPaste = null;
      } else view.updateState(next);
      if (tr.docChanged) onChange?.(getValue());
      paint();
    },
  });

  // ── commands ──
  function textblocksInSelection(st) {
    const out = [], sel = st.selection;
    const take = (from, to) => st.doc.nodesBetween(from, to, (node, pos, parent, index) => {
      if (node.isTextblock) { out.push({node, pos, parent, index}); return false; }
      return true;
    });
    if (sel instanceof pm.CellSelection) sel.forEachCell((cell, pos) => take(pos + 1, pos + cell.nodeSize - 1));
    else take(sel.from, sel.to);
    if (!out.length) { const $f = sel.$from; if ($f.parent.isTextblock) out.push({node: $f.parent, pos: $f.before(), parent: $f.node($f.depth - 1), index: $f.index($f.depth - 1)}); }
    return out;
  }
  function setTextStyle(value) {
    const st = view.state, tr = st.tr;
    const heading = /^h[123]$/.test(value), type = heading ? N.heading : N.paragraph;
    for (const {node, pos, parent, index} of textblocksInSelection(st)) {
      if (node.type === N.code_block) continue;
      if (!parent.canReplaceWith(index, index + 1, type)) continue;
      const keep = {align: node.attrs.align ?? null, indent: node.attrs.indent || 0};
      tr.setNodeMarkup(tr.mapping.map(pos), type, heading ? {level: +value[1], ...keep} : {style: value, ...keep});
    }
    if (tr.docChanged) view.dispatch(tr.scrollIntoView());
  }
  function setAlign(align) {
    const st = view.state, tr = st.tr, v = ALIGN_NAMES.includes(align) ? align : null;
    for (const {node, pos} of textblocksInSelection(st)) if (node.type === N.paragraph || node.type === N.heading) tr.setNodeAttribute(pos, 'align', v);
    if (st.selection instanceof pm.NodeSelection && st.selection.node.type === N.image) tr.setNodeAttribute(st.selection.from, 'align', v === 'center' ? 'center' : null);
    if (tr.docChanged) view.dispatch(tr);
  }
  // A mark with a name (글자색·형광펜): replaces the same mark on the selection; '' removes it. With no selection the next
  // letters typed get it.
  function setNamedMark(type, name) {
    const st = view.state, {from, to, empty} = st.selection;
    if (empty) {
      const marks = type.removeFromSet(st.storedMarks || st.selection.$from.marks());
      view.dispatch(st.tr.setStoredMarks(name ? type.create({color: name}).addToSet(marks) : marks));
      return;
    }
    const tr = st.tr;
    const ranges = st.selection instanceof pm.CellSelection ? st.selection.ranges.map(r => [r.$from.pos, r.$to.pos]) : [[from, to]];
    for (const [a, b] of ranges) { tr.removeMark(a, b, type); if (name) tr.addMark(a, b, type.create({color: name})); }
    view.dispatch(tr);
  }
  // 서식 지우기: letters keep their words and links; bold·italic·underline·strike·color·highlight, alignment and indent go.
  function clearFormat(st, dispatch) {
    const tr = st.tr, sel = st.selection;
    const ranges = sel instanceof pm.CellSelection ? sel.ranges.map(r => [r.$from.pos, r.$to.pos]) : [[sel.from, sel.to]];
    for (const [a, b] of ranges) for (const type of [M.strong, M.em, M.underline, M.strike, M.color, M.highlight]) tr.removeMark(a, b, type);
    for (const {node, pos} of textblocksInSelection(st)) if (node.type === N.paragraph || node.type === N.heading) {
      if (node.attrs.align) tr.setNodeAttribute(pos, 'align', null);
      if (node.attrs.indent) tr.setNodeAttribute(pos, 'indent', 0);
    }
    if (sel.empty) tr.setStoredMarks([]);
    dispatch?.(tr);
    return true;
  }
  const inNode = (st, type) => { const $f = st.selection.$from; for (let d = $f.depth; d > 0; d--) if ($f.node(d).type === type) return d; return -1; };
  // 목록 ▾ / 번호 ▾: puts the cursor's lines into a list of this kind with this marker shape. In a list of the same kind only
  // the shape changes; in a list of the other kind the list changes in place (nesting stays). Items nested later (Tab) get no
  // saved shape, so they follow the automatic order by depth (1. → 1) → (1) → ①, • → ◦ → ▪).
  function setListStyle(kind, marker) {
    const st = view.state, type = kind === 'ordered' ? N.ordered_list : N.bullet_list, depth = inNode(st, N.list_item);
    if (depth > 0) {
      const $f = st.selection.$from, list = $f.node(depth - 1), at = $f.before(depth - 1);
      if (list.type === type) {
        if (list.attrs.marker !== marker) view.dispatch(st.tr.setNodeMarkup(at, null, {...list.attrs, marker}));
        return;
      }
      view.dispatch(st.tr.setNodeMarkup(at, type, {marker}));
      return;
    }
    pm.wrapInList(type, {marker})(st, view.dispatch);
  }
  const liftList = () => pm.liftListItem(N.list_item)(view.state, view.dispatch);
  // The list around the cursor: its kind, shape shown (saved, or automatic for its depth) and depth among lists of its kind.
  function listAround(st) {
    const li = inNode(st, N.list_item);
    if (li < 1) return null;
    const $f = st.selection.$from, list = $f.node(li - 1), kind = list.type === N.ordered_list ? 'ordered' : 'bullet';
    let depth = 0;
    for (let d = li - 2; d > 0; d--) if ($f.node(d).type === list.type) depth++;
    return {kind, depth, marker: list.attrs.marker || autoMarker(kind, depth)};
  }
  function toggleQuote() {
    const st = view.state;
    if (inNode(st, N.blockquote) > 0) return pm.lift(st, view.dispatch);
    return pm.wrapIn(N.blockquote)(st, view.dispatch);
  }
  // Puts a block at the cursor. A table gets the cursor in its first cell; after a rule the cursor goes to the paragraph
  // that follows (one is added when none does), so typing goes on below it.
  function insertBlock(node) {
    const st = view.state, $from = st.selection.$from;
    const emptyLine = $from.parent.type === N.paragraph && $from.parent.content.size === 0 && $from.depth > 0;
    const tr = st.tr;
    let at;
    if (emptyLine) { at = $from.before(); tr.replaceWith(at, $from.after(), node); }
    else {
      if ($from.parent.isTextblock && $from.parentOffset > 0 && $from.parentOffset < $from.parent.content.size) tr.split($from.pos);
      const $p = tr.doc.resolve(tr.mapping.map($from.pos));
      at = $p.parent.isTextblock && $p.depth > 0 ? ($p.parentOffset === 0 ? $p.before() : $p.after()) : $p.pos;
      tr.insert(at, node);
    }
    const end = at + node.nodeSize;
    if (node.type === N.table) tr.setSelection(pm.TextSelection.near(tr.doc.resolve(at + 1)));
    else {
      const after = tr.doc.resolve(end).nodeAfter;
      if (!after || !after.isTextblock) tr.insert(end, N.paragraph.create({style: DEFAULT_BODY}));
      tr.setSelection(pm.TextSelection.near(tr.doc.resolve(end + 1)));
    }
    view.dispatch(tr.scrollIntoView());
  }
  function insertText(text) {
    const st = view.state;
    // Paired brackets go in around the cursor (the cursor between them).
    if (text.length === 2 && /^[「『〈《【“]/.test(text)) {
      const tr = st.tr.insertText(text);
      tr.setSelection(pm.TextSelection.create(tr.doc, tr.selection.from - 1));
      view.dispatch(tr.scrollIntoView());
      return;
    }
    const after = st.selection.$to.parent.textBetween(st.selection.$to.parentOffset, Math.min(st.selection.$to.parent.content.size, st.selection.$to.parentOffset + 1));
    const spaced = /^[~%℃㎡㎞]$/.test(text) || after === ' ' ? text : text + ' ';
    view.dispatch(st.tr.insertText(spaced).scrollIntoView());
  }
  // The lines before the cursor for [①]: the current line's text, then earlier lines nearest first (null for a heading).
  function circledText() {
    const st = view.state, $f = st.selection.$from;
    if (!$f.parent.isTextblock) return circled(1);
    const here = $f.parent.textBetween(0, $f.parentOffset, '', '\n').split('\n');
    const earlier = here.slice(0, -1).reverse();
    const blocks = [];
    st.doc.nodesBetween(0, $f.before(), (node, pos) => { if (node.isTextblock && pos < $f.before()) { blocks.push(node); return false; } return true; });
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (blocks[i].type === N.heading) { earlier.push(null); break; }
      earlier.push(...blocks[i].textBetween(0, blocks[i].content.size, '', '\n').split('\n').reverse());
    }
    return nextCircled(here[here.length - 1], earlier);
  }
  function selectWholeTable() {
    const st = view.state, depth = inNode(st, N.table);
    if (depth < 0) return;
    const $f = st.selection.$from, table = $f.node(depth), start = $f.start(depth), map = pm.TableMap.get(table);
    view.dispatch(st.tr.setSelection(pm.CellSelection.create(st.doc, start + map.map[0], start + map.map[map.map.length - 1])));
    say('표를 선택했어요. Delete나 Backspace로 지워요.');
  }
  function tableCmd(key) {
    const st = view.state;
    if (key === 'head') { toggleHeadRow(); return; }
    if (key === 'select') { selectWholeTable(); return; }
    if (key === 'fit') {
      const depth = inNode(st, N.table);
      if (depth < 0) return;
      const t = {node: st.selection.$from.node(depth), pos: st.selection.$from.before(depth), start: st.selection.$from.start(depth)};
      view.dispatch(setWidths(st.tr, t, widthsOf(t).map(() => 0)));
      return;
    }
    const cmds = {rowBefore: pm.addRowBefore, rowAfter: pm.addRowAfter, colBefore: pm.addColumnBefore, colAfter: pm.addColumnAfter,
      rowDel: pm.deleteRow, colDel: pm.deleteColumn, merge: pm.mergeCells, split: pm.splitCell, tableDel: pm.deleteTable};
    if (cmds[key] && !cmds[key](st, view.dispatch) && (key === 'merge' || key === 'split'))
      say(key === 'merge' ? '합칠 칸을 끌어서 둘 이상 골라 주세요.' : '나눌 수 있는 합친 칸이 아니에요.');
  }
  // [머리줄]: the table's first row is the head row, or not (wherever the cursor is in the table).
  function toggleHeadRow() {
    const st = view.state, depth = inNode(st, N.table);
    if (depth < 0) return;
    const tablePos = st.selection.$from.before(depth), table = st.selection.$from.node(depth), first = table.firstChild;
    const on = !first || first.childCount === 0 || [...Array(first.childCount).keys()].some(i => first.child(i).type !== N.table_header);
    const tr = st.tr;
    let pos = tablePos + 2;
    first.forEach(cell => { tr.setNodeMarkup(pos, on ? N.table_header : N.table_cell, cell.attrs); pos += cell.nodeSize; });
    view.dispatch(tr);
  }
  function newTable(rows = 2, cols = 2) {
    const cell = type => type.create(null, N.paragraph.create());
    const row = type => N.table_row.create(null, Array.from({length: cols}, () => cell(type)));
    return N.table.create(null, Array.from({length: rows}, (_, i) => row(i === 0 ? N.table_header : N.table_cell)));
  }
  // [링크]: the selection becomes a link (the address is added as letters when nothing is selected). "example.org" gets
  // https:// in front; only http(s)·mailto are kept.
  function applyLink() {
    const raw = linkInput.value.trim();
    const href = safeHref(raw) || (/^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(raw) ? safeHref('https://' + raw) : null);
    if (!href) { say('링크 주소를 확인해 주세요(https://로 시작).'); linkInput.focus(); return false; }
    const st = view.state, {from, to, empty} = st.selection, mark = M.link.create({href});
    const tr = empty ? st.tr.insert(from, schema.text(raw, [mark])) : st.tr.removeMark(from, to, M.link).addMark(from, to, mark);
    view.dispatch(tr.scrollIntoView());
    return true;
  }
  // The link at the cursor (either side of it) or the first one in the selection.
  function linkAt(st) {
    const {from, to, empty, $from} = st.selection;
    if (empty) {
      for (const n of [$from.nodeAfter, $from.nodeBefore]) { const m = n && M.link.isInSet(n.marks); if (m) return m; }
      return null;
    }
    let found = null;
    st.doc.nodesBetween(from, to, n => { if (!found && n.isText) found = M.link.isInSet(n.marks) || null; });
    return found;
  }
  function removeLink() {
    const st = view.state;
    let {from, to} = st.selection;
    if (st.selection.empty) {
      const $p = st.selection.$from, idx = $p.index(), node = $p.parent.maybeChild(idx) || $p.parent.maybeChild(idx - 1);
      if (!node || !M.link.isInSet(node.marks)) return;
      // The whole linked run around the cursor.
      let start = $p.start(), s = null, e = null;
      $p.parent.forEach((child, offset) => { if (M.link.isInSet(child.marks) && start + offset <= $p.pos && start + offset + child.nodeSize >= $p.pos) { s = start + offset; e = s + child.nodeSize; } });
      if (s === null) return;
      from = s; to = e;
    }
    view.dispatch(st.tr.removeMark(from, to, M.link));
  }
  async function plainPaste() {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch { showNote('복사한 글을 읽지 못했어요. Ctrl+Shift+V(폰은 길게 눌러 "서식 없이 붙여넣기")로 넣어 주세요.'); return; }
    if (!text) return;
    view.focus();
    view.pasteText(text);
  }
  async function convertPasted() {
    const range = pasteKey.getState(view.state);
    if (!range) return;
    let md;
    try { md = await loadMarkdownIt(); } catch { say('서식으로 바꾸지 못했어요. 다시 눌러 주세요.'); return; }
    const now = pasteKey.getState(view.state);
    if (!now) return;
    const converted = markdownToDoc(md, view.state.doc.textBetween(now.from, now.to, '\n', '\n'));
    const nodes = pm.Node.fromJSON(schema, converted.doc).content;
    // Its own undo step: [↶] puts the pasted letters back (not the paste and the change together).
    const tr = pm.closeHistory(view.state.tr.replaceWith(now.from, now.to, nodes).setMeta(pasteKey, null));
    view.dispatch(tr.scrollIntoView());
    view.focus();
    say('서식으로 바꿨어요. 되돌리기(↶)로 글자로 돌아가요.');
  }
  const say = text => { status.textContent = text; };
  let noteTimer = 0;
  function showNote(text) {
    note.textContent = text; note.hidden = false;
    clearTimeout(noteTimer); noteTimer = setTimeout(() => { note.hidden = true; }, 5000);
  }
  const notePhotoLater = () => showNote(photos ? '사진 파일만 넣을 수 있어요.' : '이 글에는 사진·파일을 넣을 수 없어요. 공유 페이지 글쓰기에서 사진을 넣을 수 있어요.');
  // A photo in the text: our own id only. A saved place (no src) or a photo without an address shows as a place.
  function photoView(node) {
    const dom = document.createElement('figure');
    dom.contentEditable = 'false';
    const src = node.attrs.src;
    const place = text => {
      dom.className = 'ed-photo is-place ed-center'; dom.dataset.alt = node.attrs.alt;
      const mark = document.createElement('span'); mark.className = 'ed-photo-mark'; mark.textContent = text;
      dom.replaceChildren(mark);
      if (node.attrs.alt) { const cap = document.createElement('figcaption'); cap.className = 'ed-photo-cap'; cap.textContent = node.attrs.alt; dom.append(cap); }
    };
    if (!src || !photos) { place(src ? '사진' : '사진 자리'); return {dom}; }
    place('사진을 불러오는 중…');
    let gone = false;
    photos.url(src).then(address => {
      if (gone) return;
      if (!address) { place('사진을 불러오지 못했어요'); return; }
      const img = document.createElement('img');
      img.className = 'ed-photo-img'; img.alt = node.attrs.alt || ''; img.referrerPolicy = 'no-referrer'; img.decoding = 'async';
      img.addEventListener('error', () => { if (!gone) place('사진을 불러오지 못했어요'); });
      img.src = address;
      dom.className = 'ed-photo ed-center'; dom.replaceChildren(img);
    }).catch(() => { if (!gone) place('사진을 불러오지 못했어요'); });
    return {dom, destroy() { gone = true; }};
  }
  const photoCount = () => { let n = 0; view.state.doc.descendants(x => { if (x.type === N.image && x.attrs.src) n++; }); return n; };
  // Photos one at a time, each put in after the one before. A failure stops the rest and says why; the ones in stay.
  async function photosFrom(list) {
    const files = [...(list || [])];
    if (!photos) { notePhotoLater(); return; }
    const pictures = files.filter(f => /^image\//.test(f.type || ''));
    if (!pictures.length) { notePhotoLater(); return; }
    const room = (photos.max || 40) - photoCount();
    if (pictures.length > room) { showNote(`사진은 한 페이지에 ${photos.max || 40}장까지 넣을 수 있어요.`); if (room <= 0) return; pictures.length = room; }
    let done = 0;
    try {
      for (const file of pictures) {
        say(`사진 올리는 중… (${done + 1}/${pictures.length})`);
        const {src} = await photos.add(file);
        if (view.isDestroyed) return;
        insertBlock(N.image.create({src, alt: ''}));
        done++;
      }
      say(`사진 ${done}장을 넣었어요. 저장해야 받는 사람에게 보여요.`);
    } catch (e) {
      say(''); showNote((e && e.message) || '사진을 올리지 못했어요.');
    }
  }
  const pickPhotos = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.multiple = true; input.hidden = true;
    input.addEventListener('change', () => { const files = [...input.files]; input.remove(); void photosFrom(files); }, {once: true});
    input.addEventListener('cancel', () => input.remove(), {once: true});
    root.append(input); input.click();
  };

  const RUN = {
    strong: () => pm.toggleMark(M.strong)(view.state, view.dispatch),
    em: () => pm.toggleMark(M.em)(view.state, view.dispatch),
    underline: () => pm.toggleMark(M.underline)(view.state, view.dispatch),
    strike: () => pm.toggleMark(M.strike)(view.state, view.dispatch),
    quote: toggleQuote,
    rule: () => insertBlock(N.horizontal_rule.create()),
    photo: () => pickPhotos(),
    indent: () => pm.chainCommands(pm.sinkListItem(N.list_item), indentBy(1))(view.state, view.dispatch),
    outdent: () => pm.chainCommands(pm.liftListItem(N.list_item), indentBy(-1))(view.state, view.dispatch),
    clear: () => clearFormat(view.state, view.dispatch),
    undo: () => pm.undo(view.state, view.dispatch), redo: () => pm.redo(view.state, view.dispatch),
  };
  function run(fn) {
    // During a 한글 composition, wait for it to end (the press blurred the box) before changing the document.
    const go = () => { fn(); view.focus(); };
    if (!view.composing) { go(); return; }
    let tries = 0;
    const wait = () => (!view.composing || ++tries > 20) ? go() : setTimeout(wait, 25);
    setTimeout(wait, 0);
  }

  // ── panels ──
  let openName = null, grouped = false;
  const triggerOf = name => name === 'more' ? more : name === 'grid' ? buttons.table : buttons[name];
  // The panel a panel's own button sits in ([⌄] row or a group popover), or null when the button is on the row: that one stays
  // open under the panel opened from inside it, and a second press (or Esc) goes back to it.
  const hostOf = name => {
    const p = triggerOf(name)?.parentElement;
    return ['more', ...GROUP_KEYS].find(k => panels[k] === p) || null;
  };
  const placeOpen = () => {
    if (!openName) return;
    const chain = [openName];
    for (let h = hostOf(openName); h && !chain.includes(h); h = hostOf(h)) chain.unshift(h);
    for (const n of chain) placePop(n);
  };
  // A popover goes right under the button that opened it, over the text (the text does not move). It stays inside the visible
  // screen: moved left when it would pass the right edge, put above the button when there is no room below, and its own list
  // scrolls when neither fits. (A phone's bottom bar is kept clear, as the cell menu does.)
  function placePop(name) {
    const pop = panels[name], trigger = triggerOf(name);
    if (!pop || !pop.classList.contains('ed-pop') || pop.hidden || !trigger) return;
    const vv = window.visualViewport;
    const view0 = {l: vv ? vv.offsetLeft : 0, t: vv ? vv.offsetTop : 0, w: vv ? vv.width : innerWidth, h: vv ? vv.height : innerHeight};
    const gap = 4, side = 8, bottomRoom = view0.w <= 760 ? 72 : 12;
    pop.style.maxHeight = ''; pop.style.maxWidth = '';
    if (pop.getBoundingClientRect().width > view0.w - side * 2) pop.style.maxWidth = `${Math.max(120, view0.w - side * 2)}px`;
    pop.style.left = '0px'; pop.style.top = '0px';
    const t = trigger.getBoundingClientRect(), size = pop.getBoundingClientRect();
    const below = view0.t + view0.h - bottomRoom - t.bottom - gap, above = t.top - view0.t - side - gap;
    const underneath = size.height <= below || below >= above, room = Math.max(80, Math.floor(underneath ? below : above));
    // (A button inside a scrolled group popover can sit above the screen's top: the popover stays on the screen.)
    const top = Math.max(view0.t + side, underneath ? t.bottom + gap : t.top - gap - Math.min(size.height, room));
    pop.style.maxHeight = `${room}px`;
    // (The left floor is the screen's side margin, or the button's own left when the button sits closer to the edge, so a popover
    // under the first button of a tight phone row still starts on that button.)
    const left = Math.max(view0.l + Math.min(side, Math.max(0, t.left - view0.l)), Math.min(t.left, view0.l + view0.w - side - size.width));
    pop.style.left = `${Math.round(left)}px`; pop.style.top = `${Math.round(top)}px`;
    // An ancestor with a transform or filter would make "fixed" relative to it: correct by what was really drawn.
    const drawn = pop.getBoundingClientRect();
    if (Math.abs(drawn.left - left) > 1) pop.style.left = `${Math.round(left - (drawn.left - left))}px`;
    if (Math.abs(drawn.top - top) > 1) pop.style.top = `${Math.round(top - (drawn.top - top))}px`;
  }
  const followPop = e => { if (openName && !(e && e.target && e.target.closest && e.target.closest('.ed-pop'))) placeOpen(); };
  function openPanel(name) {
    const was = openName;
    // The panels that hold the pressed panel's button stay open ([⌄] row or a group popover).
    const hosts = new Set();
    for (let h = name && hostOf(name); h && !hosts.has(h); h = hostOf(h)) hosts.add(h);
    for (const key of PANEL_ORDER) {
      const on = key === name || hosts.has(key);
      panels[key].hidden = !on;
      triggerOf(key)?.setAttribute('aria-expanded', String(on));
    }
    openName = name || null;
    if (name !== 'link' && panels.link.firstChild) panels.link.replaceChildren();
    if (name === 'link') {
      if (!panels.link.firstChild) panels.link.append(linkInput, linkOk, linkOff);
      const mark = linkAt(view.state);
      linkInput.value = mark ? mark.attrs.href : '';
      linkOff.hidden = !mark;
      setTimeout(() => linkInput.focus(), 0);
    }
    if (name === 'grid') paintGrid(2, 2);
    if (name) { paint(); placeOpen(); }
    return was;
  }
  const closePanels = () => openPanel(null);
  function paintGrid(r, c) {
    for (const cell of grid.children) cell.classList.toggle('is-on', +cell.dataset.edGridR <= r && +cell.dataset.edGridC <= c);
    gridSize.textContent = `${r} × ${c}`;
  }
  grid.addEventListener('pointerover', e => { const b = e.target.closest('[data-ed-grid-r]'); if (b) paintGrid(+b.dataset.edGridR, +b.dataset.edGridC); });
  grid.addEventListener('focusin', e => { const b = e.target.closest('[data-ed-grid-r]'); if (b) paintGrid(+b.dataset.edGridR, +b.dataset.edGridC); });
  grid.addEventListener('keydown', e => {
    const b = e.target.closest('[data-ed-grid-r]');
    if (!b) return;
    const move = {ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0]}[e.key];
    if (!move) return;
    e.preventDefault();
    const r = Math.max(1, Math.min(GRID.rows, +b.dataset.edGridR + move[0])), c = Math.max(1, Math.min(GRID.cols, +b.dataset.edGridC + move[1]));
    grid.querySelector(`[data-ed-grid-r="${r}"][data-ed-grid-c="${c}"]`)?.focus();
  });
  linkInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); if (applyLink()) { closePanels(); view.focus(); } }
  });

  // ── table cell menu ──
  let ctxFrom = null;
  function openCtx(x, y) {
    ctxFrom = document.activeElement;
    closePanels();
    ctx.hidden = false;
    paint();
    const vv = window.visualViewport, vw = vv ? vv.width : innerWidth, vh = vv ? vv.height : innerHeight;
    // Kept clear of a phone's bottom bar (UI: 팝업이 하단바에 가리지 않게).
    const bottomRoom = vw <= 760 ? 72 : 12;
    const r = ctx.getBoundingClientRect();
    ctx.style.left = `${Math.max(8, Math.min(x, vw - r.width - 8))}px`;
    ctx.style.top = `${Math.max(8, Math.min(y, vh - r.height - bottomRoom))}px`;
    ctx.querySelector('button:not(:disabled)')?.focus({preventScroll: true});
  }
  function closeCtx(refocus = true) {
    if (ctx.hidden) return;
    ctx.hidden = true;
    if (refocus) view.focus();
    ctxFrom = null;
  }
  ctx.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    closeCtx(false);
    run(() => tableCmd(b.dataset.edTable));
  });
  ctx.addEventListener('keydown', e => {
    const items = [...ctx.querySelectorAll('button:not(:disabled)')], i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); closeCtx(); }
    else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
  });
  // A press anywhere outside the button row and its popovers (the text included) closes the open one.
  const outside = e => {
    if (!ctx.hidden && !ctx.contains(e.target)) closeCtx(false);
    if (openName && !bar.contains(e.target)) closePanels();
  };
  document.addEventListener('pointerdown', outside, true);
  // Esc closes it even when the focus is not in the text box or on a button.
  const escape = e => { if (e.key === 'Escape' && openName && !root.contains(e.target)) { closePanels(); } };
  document.addEventListener('keydown', escape);
  // A popover follows its button when the page, the screen or the sideways button row moves.
  window.addEventListener('scroll', followPop, true);
  window.addEventListener('resize', followPop);
  window.visualViewport?.addEventListener('resize', followPop);
  window.visualViewport?.addEventListener('scroll', followPop);
  tools.addEventListener('scroll', followPop);

  view.dom.addEventListener('mousedown', e => { if (e.button === 0) pointerHeld = true; });
  const release = () => { if (pointerHeld) { pointerHeld = false; paint(); } };
  window.addEventListener('mouseup', release, true);
  // A press on the table grip (its top left corner) chooses the whole table.
  view.dom.addEventListener('mousedown', e => {
    if (!e.target.closest?.('.ed-table-grip')) return;
    e.preventDefault();
    const wrap = e.target.closest('.ed-table-wrap'), pos = view.posAtDOM(wrap.querySelector('td,th'), 0);
    view.dispatch(view.state.tr.setSelection(pm.TextSelection.near(view.state.doc.resolve(pos))));
    selectWholeTable();
    view.focus();
  });

  // ED-서식줄펼침: pressing a table's outer border (top, left, bottom) chooses the whole table. The pointer shows a hand and the
  // table gets a faint outline while it is over the border. A finger gets a wider strip (a phone has [표 선택] too). The right
  // border is the last column's width handle, so a press there still drags the column.
  let pointerKind = 'mouse', edgeWrap = null;
  const edgeWidth = () => pointerKind === 'touch' || pointerKind === 'pen' ? 12 : 4;
  function tableEdgeAt(x, y, target) {
    if (target?.closest?.('.ed-table-resize')) return null;
    const wrap = target?.closest?.('.ed-table-wrap');
    const table = wrap && wrap.querySelector('table');
    if (!table || !view.dom.contains(wrap)) return null;
    const rs = pm.columnResizingPluginKey.getState(view.state);
    if (rs && rs.activeHandle >= 0) return null;
    const r = table.getBoundingClientRect(), w = edgeWidth();
    const insideX = x >= r.left - w && x <= r.right - w, insideY = y >= r.top - w && y <= r.bottom + w;
    if (!insideX || !insideY) return null;
    const onEdge = Math.abs(y - r.top) <= w || Math.abs(y - r.bottom) <= w || Math.abs(x - r.left) <= w;
    return onEdge ? wrap : null;
  }
  const setEdge = wrap => {
    if (wrap === edgeWrap) return;
    edgeWrap?.classList.remove('is-edge');
    edgeWrap = wrap; wrap?.classList.add('is-edge');
  };
  view.dom.addEventListener('pointerdown', e => { pointerKind = e.pointerType || 'mouse'; }, true);
  view.dom.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && !pointerHeld) setEdge(tableEdgeAt(e.clientX, e.clientY, e.target)); });
  view.dom.addEventListener('pointerleave', () => setEdge(null));
  view.dom.addEventListener('mousedown', e => {
    if (e.button !== 0 || e.target.closest?.('.ed-table-grip')) return;
    const wrap = tableEdgeAt(e.clientX, e.clientY, e.target);
    if (!wrap) return;
    e.preventDefault(); e.stopPropagation();
    const pos = view.posAtDOM(wrap.querySelector('td,th'), 0);
    view.dispatch(view.state.tr.setSelection(pm.TextSelection.near(view.state.doc.resolve(pos))));
    selectWholeTable();
    view.focus();
  }, true);

  // Pressing a button keeps the text box focused (the phone keyboard stays), except during a composition (see run) and
  // in the link box (it takes the focus to type).
  // ED-서식줄펼침: the editor learns of the browser's own selection change (Shift+Home, Shift+arrows, a drag) a moment after it
  // happens (selectionchange). A button pressed in that moment used to act on the old, empty selection (굵게 set as a typing
  // style instead of on the chosen letters). So a press first reads the browser's selection into the editor.
  const syncSelection = () => { if (view.isDestroyed || view.composing) return; try { view.domObserver.forceFlush(); view.domObserver.flush(); } catch { /* reads on the next selectionchange */ } };
  // The same read after a key is let go or a press ends, in case the browser's own selectionchange was missed or ignored
  // (the editor then kept the old cursor although letters were chosen on screen).
  view.dom.addEventListener('keyup', syncSelection);
  window.addEventListener('pointerup', syncSelection, true);
  const keepFocus = e => { const b = e.target.closest('button'); if (b && !view.composing && view.hasFocus()) { syncSelection(); e.preventDefault(); } };
  bar.addEventListener('pointerdown', keepFocus);
  bar.addEventListener('mousedown', keepFocus);
  ctx.addEventListener('mousedown', e => e.preventDefault());
  bar.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !bar.contains(b) || b.disabled) return;
    const d = b.dataset;
    if ('edMore' in d) { openPanel(openName === 'more' ? null : 'more'); return; }
    if (d.edCmd && OPENS[d.edCmd]) { const name = OPENS[d.edCmd]; openPanel(openName === name ? hostOf(name) : name); return; }
    if (d.edStyle) { run(() => setTextStyle(d.edStyle)); closePanels(); return; }
    if (d.edListMarker) { const kind = d.edListKind, marker = d.edListMarker; closePanels(); run(() => setListStyle(kind, marker)); return; }
    if (d.edListOff) { closePanels(); run(liftList); return; }
    if ('edColor' in d) { run(() => setNamedMark(M.color, d.edColor)); closePanels(); return; }
    if ('edHighlight' in d) { run(() => setNamedMark(M.highlight, d.edHighlight)); closePanels(); return; }
    if (d.edAlign) { run(() => setAlign(d.edAlign)); closePanels(); return; }
    if (d.edSym) { const sign = d.edSym; closePanels(); run(() => insertText(sign)); return; }
    if (d.edGridR) { const r = +d.edGridR, c = +d.edGridC; closePanels(); run(() => { if (!pm.isInTable(view.state)) insertBlock(newTable(r, c)); }); return; }
    if ('edLinkOk' in d) { if (applyLink()) { closePanels(); view.focus(); } return; }
    if ('edLinkOff' in d) { closePanels(); run(removeLink); return; }
    if (d.edCmd === 'plainPaste') { closePanels(); void plainPaste(); return; }
    if (d.edCmd && RUN[d.edCmd]) { if (!b.closest('.ed-tools') || openName !== 'more') closePanels(); run(RUN[d.edCmd]); return; }
    if (d.edTable) { run(() => tableCmd(d.edTable)); return; }
    if ('edConvert' in d) { void convertPasted(); return; }
    if ('edDismiss' in d) { view.dispatch(view.state.tr.setMeta(pasteKey, null).setMeta('addToHistory', false)); view.focus(); }
  });
  bar.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !openName) return;
    e.preventDefault();
    const name = openName, trigger = triggerOf(name);
    if (name === 'link') { closePanels(); view.focus(); return; }
    openPanel(hostOf(name));
    (trigger.offsetParent ? trigger : more).focus();
  });
  // Wider than a phone the row never scrolls sideways: the buttons that do not fit move (the same nodes, so their state
  // and presses stay) to the front of the [⋯] row, from the end. On a phone the row scrolls sideways under the finger.
  const phone = window.matchMedia ? window.matchMedia('(max-width: 760px)') : null;
  function fitTools() {
    for (const b of [...panels.more.querySelectorAll('[data-ed-moved]')]) { delete b.dataset.edMoved; tools.insertBefore(b, more); }
    if (grouped || phone?.matches || !tools.clientWidth || tools.scrollWidth <= tools.clientWidth) return;
    const list = [...tools.children].filter(b => b !== more && b !== buttons.style);
    const firstFixed = panels.more.querySelector('[data-ed-fixed]');
    let front = firstFixed;
    while (tools.scrollWidth > tools.clientWidth && list.length) {
      const b = list.pop();
      b.dataset.edMoved = '';
      panels.more.insertBefore(b, front);
      front = b;
    }
  }
  let fitFrame = 0;
  const queueFit = () => { if (!fitFrame) fitFrame = requestAnimationFrame(() => { fitFrame = 0; fitTools(); }); };
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(queueFit) : null;
  resize?.observe(tools);
  // ED-서식줄묶음: a phone gets the grouped row; wider screens get the full row back (the same button nodes move to and fro).
  const pair = document.createElement('span'); pair.className = 'ed-pair'; pair.setAttribute('role', 'group');
  function setGrouped(on) {
    if (on === grouped) return;
    closePanels();
    for (const b of [...panels.more.querySelectorAll('[data-ed-moved]')]) { delete b.dataset.edMoved; tools.insertBefore(b, more); }
    grouped = on;
    root.classList.toggle('ed-grouped', on);
    if (on) {
      // [·] and [▾] sit in one pair so the row's spacing treats them as a single block.
      pair.replaceChildren(buttons.dotNow, buttons.symDot);
      tools.replaceChildren(...PHONE_ORDER.map(k => k === 'dotNow' ? pair : k === 'symDot' ? null : buttons[k]).filter(Boolean), more);
      for (const [key, , , items] of GROUPS) panels[key].replaceChildren(...items.map(k => buttons[k]).filter(Boolean));
      panels.more.replaceChildren();
      setLabel(buttons.symDot, '▾'); buttons.symDot.setAttribute('aria-label', '점 기호 고르기');
    } else {
      tools.replaceChildren(...homeTools, more);
      panels.more.replaceChildren(...homeMore);
      for (const key of GROUP_KEYS) panels[key].replaceChildren();
      setLabel(buttons.symDot, '· ▾');
    }
    more.hidden = on;
    paint(); queueFit();
  }
  const syncLayout = () => setGrouped(!!phone?.matches);
  phone?.addEventListener?.('change', syncLayout);

  // ── state shown on the buttons ──
  function currentStyle(st) {
    const p = st.selection.$from.parent;
    if (p.type === N.heading) return `h${p.attrs.level}`;
    if (p.type === N.paragraph) return BODY_STYLES.includes(p.attrs.style) ? p.attrs.style : DEFAULT_BODY;
    return '';
  }
  function markActive(st, type) {
    const {from, to, empty, $from} = st.selection;
    if (empty) return !!type.isInSet(st.storedMarks || $from.marks());
    return st.doc.rangeHasMark(from, to, type);
  }
  const namedMark = (st, type) => {
    const {empty, $from, from, to} = st.selection;
    if (empty) return type.isInSet(st.storedMarks || $from.marks())?.attrs.color || '';
    let found = '';
    st.doc.nodesBetween(from, to, node => { const m = node.isText && type.isInSet(node.marks); if (m && !found) found = m.attrs.color; });
    return found;
  };
  function paint() {
    const st = view.state, style = currentStyle(st);
    const label = (TEXT_STYLES.find(([v]) => v === style) || [null, st.selection.$from.parent.type === N.code_block ? '코드' : '단계'])[1];
    setLabel(buttons.style, `${label} ▾`);
    for (const b of panels.style.querySelectorAll('[data-ed-style]')) b.setAttribute('aria-pressed', String(b.dataset.edStyle === style));
    for (const key of ['strong', 'em', 'underline', 'strike']) buttons[key].setAttribute('aria-pressed', String(markActive(st, M[key])));
    const color = namedMark(st, M.color), hl = namedMark(st, M.highlight);
    buttons.color.dataset.edNow = color; buttons.highlight.dataset.edNow = hl;
    for (const b of panels.color.querySelectorAll('[data-ed-color]')) b.setAttribute('aria-pressed', String(b.dataset.edColor === color));
    for (const b of panels.highlight.querySelectorAll('[data-ed-highlight]')) b.setAttribute('aria-pressed', String(b.dataset.edHighlight === hl));
    const p = st.selection.$from.parent;
    const align = (st.selection instanceof pm.NodeSelection ? st.selection.node.attrs.align : p.attrs && p.attrs.align) || 'left';
    setLabel(buttons.align, `${grouped ? '정렬 ' : ''}${(ALIGNS.find(([v]) => v === align) || ALIGNS[0])[1]} ▾`);
    for (const b of panels.align.querySelectorAll('[data-ed-align]')) b.setAttribute('aria-pressed', String(b.dataset.edAlign === align));
    buttons.quote.setAttribute('aria-pressed', String(inNode(st, N.blockquote) > 0));
    const li = inNode(st, N.list_item), around = listAround(st);
    buttons.bullet.setAttribute('aria-pressed', String(around?.kind === 'bullet'));
    buttons.ordered.setAttribute('aria-pressed', String(around?.kind === 'ordered'));
    for (const kind of ['bullet', 'ordered']) {
      for (const b of panels[kind].querySelectorAll('[data-ed-list-marker]')) b.setAttribute('aria-pressed', String(around?.kind === kind && around.marker === b.dataset.edListMarker));
      panels[kind].querySelector('[data-ed-list-off]').hidden = around?.kind !== kind;
    }
    buttons.outdent.disabled = !(li > 0 || (p.attrs && p.attrs.indent > 0));
    buttons.undo.disabled = pm.undoDepth(st) === 0; buttons.redo.disabled = pm.redoDepth(st) === 0;
    buttons.link.setAttribute('aria-pressed', String(!!linkAt(st)));
    const inTable = pm.isInTable(st);
    // The table tools row shows or hides only when no mouse button is held: appearing in the middle of a press would push
    // the text down under the pointer (a drag across cells would land on the wrong row).
    if (!pointerHeld) tableRow.hidden = !inTable;
    buttons.table.disabled = inTable;
    if (inTable) {
      const can = {merge: pm.mergeCells(st), split: pm.splitCell(st), rowDel: pm.deleteRow(st), colDel: pm.deleteColumn(st)};
      for (const list of [tableRow, ctx]) for (const b of list.querySelectorAll('[data-ed-table]')) if (b.dataset.edTable in can) b.disabled = !can[b.dataset.edTable];
    }
    if (openName === 'symCircled') {
      const next = circledText();
      for (const b of panels.symCircled.children) b.classList.toggle('is-next', b.dataset.edSym === next);
    }
    const offer = pasteKey.getState(st);
    suggest.hidden = !offer;
    root.toggleAttribute('data-ed-empty', isEmpty());
  }

  function getValue() { return cleanDoc({v: 'ed1', doc: view.state.doc.toJSON()}); }
  function isEmpty() {
    const d = view.state.doc;
    return d.childCount === 1 && d.firstChild.type === N.paragraph && d.firstChild.content.size === 0;
  }
  syncLayout();
  paint();
  fitTools();
  return {
    view, root, getValue, isEmpty,
    getText: () => toPlain(getValue()),
    focus: () => view.focus(),
    destroy() {
      resize?.disconnect(); phone?.removeEventListener?.('change', syncLayout); cancelAnimationFrame(fitFrame); clearTimeout(noteTimer);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('pointerup', syncSelection, true);
      window.removeEventListener('scroll', followPop, true);
      window.removeEventListener('resize', followPop);
      window.visualViewport?.removeEventListener('resize', followPop);
      window.visualViewport?.removeEventListener('scroll', followPop);
      window.removeEventListener('mouseup', release, true);
      view.destroy(); root.remove();
    },
  };
}
