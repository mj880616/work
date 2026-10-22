// ED-통합편집기 ①a: the one rich-text editor part (블로그 글쓰기형, docs/design/unified-editor.md 2.3), built on the vendored
// ProseMirror bundle (app/editor-lib, loaded only when an editor opens). It edits one document in one box and saves nothing:
// the opener reads getValue() (the cleaned saved form {v:'ed1', doc}) and stores it its own way, as md-editor.js does.
// Button row (small 28px buttons, 44px press area, sideways scrolling on a phone, focus and the phone keyboard kept;
// SHARE-전체편집: wider than a phone, buttons that do not fit go under [⋯] at the row's end, so no sideways scroll bar):
//   [본문 2 ▾] 제목 1~3·본문 1~3 | 굵게 기울임 밑줄 취소선 | · ※ → ① | 인용 사진 표 목록 번호 구분선 | 왼쪽 가운데 | ↶ ↷
// Decisions (2026-10-22 사용자, 설계 0절): no format while typing (no input rules: "1. " "- " "# " stay letters); a paste of
// plain letters goes in as typed, one paragraph per line, and when it looks like markdown a small [서식으로 바꾸기] converts
// that pasted part once (undo puts the letters back); [①] puts the number after the nearest one (①→②→③); tables add and
// remove rows and columns and switch a head row, with no cell merging; a photo is a place only until ②.
// 한글 IME: nothing here changes the document while a composition is running. A button pressed during one lets the press blur
// the box first (that ends the composition), then runs and puts focus back.
import {TEXT_STYLES, DEFAULT_BODY, BODY_STYLES, cleanDoc, emptyDoc, safeHref, nextCircled} from './ed-schema.mjs';
import {looksLikeMarkdown} from './note-markdown.mjs';
import {markdownToDoc} from './ed-markdown.mjs';
import {toPlain} from './ed-text.mjs';

const LIB = './editor-lib/pm-ed1-1.0.0/prosemirror.min.mjs';
const MARKDOWN_IT = './markdown-lib/markdown-it-15.0.2/markdown-it.esm.min.mjs';
let pmPromise = null, mdPromise = null;
export const loadEditorLib = () => (pmPromise ||= import(LIB));
const loadMarkdownIt = () => (mdPromise ||= import(MARKDOWN_IT).then(({default: MarkdownIt}) => {
  const md = new MarkdownIt({html: false, linkify: true, breaks: true, typographer: false});
  md.linkify.set({fuzzyEmail: false});
  md.validateLink = url => !!safeHref(url);
  return md;
}));

const styleOf = el => (/\bed-(body[123])\b/.exec(el.className || '') || [])[1] || DEFAULT_BODY;
const alignOf = el => (el.style?.textAlign === 'center' || /\bed-center\b/.test(el.className || '')) ? 'center' : null;
const headingLevel = el => { const m = /\bed-h([123])\b/.exec(el.className || ''); return m ? +m[1] : Math.min(3, +el.tagName.slice(1)); };
const withCenter = (cls, align) => align === 'center' ? `${cls} ed-center` : cls;

function buildSchema(pm) {
  const tables = pm.tableNodes({tableGroup: 'block', cellContent: 'block+', cellAttributes: {}});
  return new pm.Schema({
    nodes: {
      doc: {content: 'block+'},
      paragraph: {group: 'block', content: 'inline*', attrs: {style: {default: DEFAULT_BODY}, align: {default: null}},
        parseDOM: [{tag: 'p', getAttrs: el => ({style: styleOf(el), align: alignOf(el)})}],
        toDOM: n => ['p', {class: withCenter(`ed-p ed-${n.attrs.style}`, n.attrs.align)}, 0]},
      heading: {group: 'block', content: 'inline*', defining: true, attrs: {level: {default: 2}, align: {default: null}},
        parseDOM: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map(tag => ({tag, getAttrs: el => ({level: headingLevel(el), align: alignOf(el)})})),
        toDOM: n => [`h${n.attrs.level + 1}`, {class: withCenter(`ed-h ed-h${n.attrs.level}`, n.attrs.align)}, 0]},
      blockquote: {group: 'block', content: 'block+', defining: true, parseDOM: [{tag: 'blockquote'}], toDOM: () => ['blockquote', {class: 'ed-quote'}, 0]},
      bullet_list: {group: 'block', content: 'list_item+', parseDOM: [{tag: 'ul'}], toDOM: () => ['ul', {class: 'ed-ul'}, 0]},
      ordered_list: {group: 'block', content: 'list_item+', attrs: {order: {default: 1}},
        parseDOM: [{tag: 'ol', getAttrs: el => ({order: el.hasAttribute('start') ? (+el.getAttribute('start') || 1) : 1})}],
        toDOM: n => ['ol', n.attrs.order === 1 ? {class: 'ed-ol'} : {class: 'ed-ol', start: n.attrs.order}, 0]},
      list_item: {content: 'paragraph block*', defining: true, parseDOM: [{tag: 'li'}], toDOM: () => ['li', 0]},
      horizontal_rule: {group: 'block', parseDOM: [{tag: 'hr'}], toDOM: () => ['hr', {class: 'ed-hr'}]},
      code_block: {group: 'block', content: 'text*', marks: '', code: true, defining: true,
        parseDOM: [{tag: 'pre', preserveWhitespace: 'full'}], toDOM: () => ['pre', {class: 'ed-code'}, ['code', 0]]},
      // Our own photo (place only until ②). Pasted <img> never becomes one: transformPastedHTML turns it into letters first.
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

const BUTTONS = [
  // [key, label, aria, group]
  ['style', '본문 2 ▾', '글 단계 고르기', 'style'],
  ['strong', '굵게', null, 'mark'], ['em', '기울임', null, 'mark'], ['underline', '밑줄', null, 'mark'], ['strike', '취소선', null, 'mark'],
  ['dot', '·', '가운뎃점 넣기', 'sym'], ['note', '※', '참고표 넣기', 'sym'], ['arrow', '→', '화살표 넣기', 'sym'], ['circled', '①', '다음 동그라미 번호 넣기', 'sym'],
  ['quote', '인용', null, 'block'], ['photo', '사진', '사진 자리 넣기', 'block'], ['table', '표', '표 넣기', 'block'],
  ['bullet', '목록', '글머리 목록', 'block'], ['ordered', '번호', '번호 목록', 'block'], ['rule', '구분선', null, 'block'],
  ['left', '왼쪽', '왼쪽 정렬', 'align'], ['center', '가운데', '가운데 정렬', 'align'],
  ['undo', '↶', '되돌리기', 'history'], ['redo', '↷', '다시하기', 'history'],
];
const SYMBOLS = {dot: '·', note: '※', arrow: '→'};
const TABLE_TOOLS = [['rowAfter', '줄 추가'], ['colAfter', '칸 추가'], ['rowDel', '줄 삭제'], ['colDel', '칸 삭제'], ['head', '머리줄'], ['tableDel', '표 지우기']];

function btn(label, data, aria) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = label;
  Object.assign(b.dataset, data);
  if (aria) b.setAttribute('aria-label', aria);
  return b;
}

// Mounts an editor into host. value: a saved form (or null for an empty one). onChange(value): after each change.
// label: the text box's accessible name. head: an optional node put between the button row and the text box (a title).
// Returns {getValue(), getText(), isEmpty(), focus(), destroy(), view, root}.
// getText() is the letters for raw_text (ed-text.mjs toPlain): the opener saves structure and letters together (설계 3.1).
export async function createDocEditor({host, value = null, onChange = null, label = '본문', placeholder = '', head = null} = {}) {
  const pm = await loadEditorLib();
  const schema = buildSchema(pm);
  const N = schema.nodes, M = schema.marks;
  const start = cleanDoc(value) || emptyDoc();
  let doc;
  try { doc = pm.Node.fromJSON(schema, start.doc); doc.check(); } catch { doc = pm.Node.fromJSON(schema, emptyDoc().doc); }

  const root = document.createElement('div');
  root.className = 'ed-editor';
  const bar = document.createElement('div'), tools = document.createElement('div');
  bar.className = 'ed-bar';
  tools.className = 'ed-tools'; tools.setAttribute('role', 'toolbar'); tools.setAttribute('aria-label', '서식');
  const buttons = {};
  let lastGroup = null;
  for (const [key, text, aria, group] of BUTTONS) {
    const b = btn(text, {edCmd: key, edGroup: group}, aria);
    if (lastGroup && group !== lastGroup) b.classList.add('ed-gap');
    lastGroup = group;
    if (group === 'style') { b.setAttribute('aria-haspopup', 'true'); b.setAttribute('aria-expanded', 'false'); b.classList.add('ed-style'); }
    if (group === 'mark' || group === 'align' || key === 'quote' || key === 'bullet' || key === 'ordered') b.setAttribute('aria-pressed', 'false');
    buttons[key] = b; tools.append(b);
  }
  const more = btn('⋯', {edMore: ''}, '서식 더보기');
  more.classList.add('ed-more'); more.hidden = true; more.setAttribute('aria-haspopup', 'true'); more.setAttribute('aria-expanded', 'false');
  tools.append(more);
  const moreMenu = document.createElement('div');
  moreMenu.className = 'ed-menu ed-more-menu'; moreMenu.hidden = true; moreMenu.setAttribute('role', 'group'); moreMenu.setAttribute('aria-label', '서식 더보기');
  const styleMenu = document.createElement('div');
  styleMenu.className = 'ed-menu'; styleMenu.hidden = true; styleMenu.setAttribute('role', 'group'); styleMenu.setAttribute('aria-label', '글 단계');
  for (const [v, text] of TEXT_STYLES) styleMenu.append(btn(text, {edStyle: v}));
  const tableRow = document.createElement('div');
  tableRow.className = 'ed-menu ed-table-tools'; tableRow.hidden = true; tableRow.setAttribute('role', 'group'); tableRow.setAttribute('aria-label', '표 고치기');
  for (const [key, text] of TABLE_TOOLS) tableRow.append(btn(text, {edTable: key}));
  const suggest = document.createElement('div');
  suggest.className = 'ed-suggest'; suggest.hidden = true; suggest.setAttribute('role', 'status');
  const suggestText = document.createElement('span'); suggestText.textContent = '마크다운 기호가 보여요.';
  const convert = btn('서식으로 바꾸기', {edConvert: ''}), dismiss = btn('×', {edDismiss: ''}, '그대로 두기');
  suggest.append(suggestText, convert, dismiss);
  const status = document.createElement('p');
  status.className = 'ed-status a11y-only'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  bar.append(tools, moreMenu, styleMenu, tableRow, suggest);
  const box = document.createElement('div');
  box.className = 'ed-box';
  root.append(bar, ...(head ? [head] : []), box, status);
  host.append(root);

  // The pasted part of a plain-letter paste, kept (mapped through later steps) until it is converted or dismissed.
  let pasted = null;
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
  const paragraphAttrs = node => node.type === N.paragraph ? {type: N.paragraph, attrs: {style: node.attrs.style, align: node.attrs.align}} : null;
  const enter = pm.chainCommands(pm.splitListItem(N.list_item), pm.newlineInCode, pm.createParagraphNear, pm.liftEmptyBlock,
    pm.splitBlockAs((node, atEnd) => (atEnd && node.type === N.heading) ? {type: N.paragraph, attrs: {style: DEFAULT_BODY}} : paragraphAttrs(node)));
  const hardBreak = pm.chainCommands(pm.exitCode, (state, dispatch) => { dispatch?.(state.tr.replaceSelectionWith(N.hard_break.create()).scrollIntoView()); return true; });
  const keys = {
    Enter: enter, 'Shift-Enter': hardBreak, 'Mod-Enter': () => false,
    'Mod-z': pm.undo, 'Mod-y': pm.redo, 'Shift-Mod-z': pm.redo,
    'Mod-b': pm.toggleMark(M.strong), 'Mod-i': pm.toggleMark(M.em), 'Mod-u': pm.toggleMark(M.underline),
    Tab: pm.chainCommands(pm.goToNextCell(1), pm.sinkListItem(N.list_item)),
    'Shift-Tab': pm.chainCommands(pm.goToNextCell(-1), pm.liftListItem(N.list_item)),
  };
  let state = pm.EditorState.create({doc, plugins: [pm.history(), pm.keymap(keys), pm.keymap(pm.baseKeymap), pm.tableEditing(), pastePlugin]});
  const fix = pm.fixTables(state);
  if (fix) state = state.apply(fix.setMeta('addToHistory', false));

  let pendingPaste = null;
  const view = new pm.EditorView(box, {
    state,
    attributes: {class: 'ed-doc ed-input', role: 'textbox', 'aria-multiline': 'true', 'aria-label': label, spellcheck: 'false',
      ...(placeholder ? {'data-placeholder': placeholder} : {})},
    transformPastedHTML: cleanPastedHtml,
    // Plain letters: one paragraph per line, blank lines kept, nothing read as format.
    clipboardTextParser(text, $context) {
      const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
      if ($context.parent.type.spec.code) return new pm.Slice(pm.Fragment.from(schema.text(text)), 0, 0);
      const style = $context.parent.type === N.paragraph ? $context.parent.attrs.style : DEFAULT_BODY;
      const nodes = lines.map(line => N.paragraph.create({style}, line ? schema.text(line) : null));
      return new pm.Slice(pm.Fragment.from(nodes), 1, 1);
    },
    handlePaste(v, event) {
      const text = event.clipboardData?.getData('text/plain') || '';
      const html = event.clipboardData?.getData('text/html') || '';
      // Decide after the paste lands: mark its range when the letters look like markdown and no formatted copy came with them.
      pendingPaste = !html && looksLikeMarkdown(text) ? {text, before: v.state.selection.from, size: v.state.doc.content.size} : null;
      return false;
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
  const textblocksInSelection = st => {
    const out = [];
    st.doc.nodesBetween(st.selection.from, st.selection.to, (node, pos, parent, index) => {
      if (node.isTextblock) { out.push({node, pos, parent, index}); return false; }
      return true;
    });
    if (!out.length) { const $f = st.selection.$from; if ($f.parent.isTextblock) out.push({node: $f.parent, pos: $f.before(), parent: $f.node($f.depth - 1), index: $f.index($f.depth - 1)}); }
    return out;
  };
  function setTextStyle(value) {
    const st = view.state, tr = st.tr;
    const heading = /^h[123]$/.test(value), type = heading ? N.heading : N.paragraph;
    for (const {node, pos, parent, index} of textblocksInSelection(st)) {
      if (node.type === N.code_block) continue;
      if (!parent.canReplaceWith(index, index + 1, type)) continue;
      const attrs = heading ? {level: +value[1], align: node.attrs.align ?? null} : {style: value, align: node.attrs.align ?? null};
      tr.setNodeMarkup(tr.mapping.map(pos), type, attrs);
    }
    if (tr.docChanged) view.dispatch(tr.scrollIntoView());
  }
  function setAlign(align) {
    const st = view.state, tr = st.tr;
    for (const {node, pos} of textblocksInSelection(st)) if (node.type === N.paragraph || node.type === N.heading) tr.setNodeAttribute(pos, 'align', align === 'center' ? 'center' : null);
    if (st.selection instanceof pm.NodeSelection && st.selection.node.type === N.image) tr.setNodeAttribute(st.selection.from, 'align', align === 'center' ? 'center' : null);
    if (tr.docChanged) view.dispatch(tr);
  }
  const inNode = (st, type) => { const $f = st.selection.$from; for (let d = $f.depth; d > 0; d--) if ($f.node(d).type === type) return d; return -1; };
  function toggleList(type) {
    const st = view.state, depth = inNode(st, N.list_item);
    if (depth > 0) {
      const list = st.selection.$from.node(depth - 1);
      if (list.type === type) return pm.liftListItem(N.list_item)(st, view.dispatch);
      // The other list kind: change the list in place.
      return view.dispatch(st.tr.setNodeMarkup(st.selection.$from.before(depth - 1), type));
    }
    return pm.wrapInList(type)(st, view.dispatch);
  }
  function toggleQuote() {
    const st = view.state;
    if (inNode(st, N.blockquote) > 0) return pm.lift(st, view.dispatch);
    return pm.wrapIn(N.blockquote)(st, view.dispatch);
  }
  // Puts a block at the cursor. A table gets the cursor in its first cell; after a rule or photo the cursor goes to the
  // paragraph that follows (one is added when none does), so typing goes on below it.
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
    const st = view.state, after = st.selection.$to.parent.textBetween(st.selection.$to.parentOffset, Math.min(st.selection.$to.parent.content.size, st.selection.$to.parentOffset + 1));
    view.dispatch(st.tr.insertText(after === ' ' ? text : text + ' ').scrollIntoView());
  }
  // The lines before the cursor for [①]: the current line's text, then earlier lines nearest first (null for a heading).
  function circledText() {
    const st = view.state, $f = st.selection.$from;
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
  function tableCmd(key) {
    const st = view.state;
    if (key === 'head') { toggleHeadRow(); return; }
    const cmds = {rowAfter: pm.addRowAfter, colAfter: pm.addColumnAfter, rowDel: pm.deleteRow, colDel: pm.deleteColumn, tableDel: pm.deleteTable};
    cmds[key]?.(st, view.dispatch);
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
  function newTable() {
    const cell = (type) => type.create(null, N.paragraph.create());
    const row = type => N.table_row.create(null, [cell(type), cell(type)]);
    return N.table.create(null, [row(N.table_header), row(N.table_cell)]);
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

  const RUN = {
    strong: () => pm.toggleMark(M.strong)(view.state, view.dispatch),
    em: () => pm.toggleMark(M.em)(view.state, view.dispatch),
    underline: () => pm.toggleMark(M.underline)(view.state, view.dispatch),
    strike: () => pm.toggleMark(M.strike)(view.state, view.dispatch),
    dot: () => insertText(SYMBOLS.dot), note: () => insertText(SYMBOLS.note), arrow: () => insertText(SYMBOLS.arrow),
    circled: () => insertText(circledText()),
    quote: toggleQuote,
    photo: () => { insertBlock(N.image.create({src: null, alt: ''})); say('사진 자리를 넣었어요. 사진은 다음 단계부터 넣을 수 있어요.'); },
    table: () => { if (!pm.isInTable(view.state)) insertBlock(newTable()); },
    bullet: () => toggleList(N.bullet_list), ordered: () => toggleList(N.ordered_list),
    rule: () => insertBlock(N.horizontal_rule.create()),
    left: () => setAlign('left'), center: () => setAlign('center'),
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
  // Pressing a button keeps the text box focused (the phone keyboard stays), except during a composition (see run).
  bar.addEventListener('pointerdown', e => { if (e.target.closest('button') && !view.composing && view.hasFocus()) e.preventDefault(); });
  bar.addEventListener('mousedown', e => { if (e.target.closest('button') && !view.composing && view.hasFocus()) e.preventDefault(); });
  bar.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !bar.contains(b)) return;
    const d = b.dataset;
    if ('edMore' in d) { openMoreMenu(moreMenu.hidden); return; }
    if (d.edCmd === 'style') { openMoreMenu(false); openStyleMenu(styleMenu.hidden); return; }
    if (d.edStyle) { run(() => setTextStyle(d.edStyle)); openStyleMenu(false); return; }
    if (d.edCmd && RUN[d.edCmd]) { openStyleMenu(false); openMoreMenu(false); run(RUN[d.edCmd]); return; }
    if (d.edTable) { run(() => tableCmd(d.edTable)); return; }
    if ('edConvert' in d) { void convertPasted(); return; }
    if ('edDismiss' in d) { view.dispatch(view.state.tr.setMeta(pasteKey, null).setMeta('addToHistory', false)); view.focus(); }
  });
  bar.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !styleMenu.hidden) { e.preventDefault(); openStyleMenu(false); buttons.style.focus(); }
    else if (e.key === 'Escape' && !moreMenu.hidden) { e.preventDefault(); openMoreMenu(false); more.focus(); }
  });
  function openMoreMenu(open) {
    moreMenu.hidden = !open || more.hidden;
    more.setAttribute('aria-expanded', String(!moreMenu.hidden));
  }
  // Wider than a phone the row never scrolls sideways: the buttons that do not fit move (the same nodes, so their state
  // and presses stay) into the [⋯] row below, from the end. On a phone the row scrolls sideways under the finger instead.
  const phone = window.matchMedia ? window.matchMedia('(max-width: 760px)') : null;
  function fitTools() {
    for (const b of [...moreMenu.children]) tools.insertBefore(b, more);
    more.hidden = true;
    if (phone?.matches || !tools.clientWidth || tools.scrollWidth <= tools.clientWidth) { openMoreMenu(false); return; }
    more.hidden = false;
    const list = [...tools.children].filter(b => b !== more && b !== buttons.style);
    while (tools.scrollWidth > tools.clientWidth && list.length) moreMenu.prepend(list.pop());
    openMoreMenu(!moreMenu.hidden);
  }
  let fitFrame = 0;
  const queueFit = () => { if (!fitFrame) fitFrame = requestAnimationFrame(() => { fitFrame = 0; fitTools(); }); };
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(queueFit) : null;
  resize?.observe(tools);
  phone?.addEventListener?.('change', queueFit);
  function openStyleMenu(open) {
    styleMenu.hidden = !open;
    buttons.style.setAttribute('aria-expanded', String(!!open));
    if (open) paint();
  }

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
  function paint() {
    const st = view.state, style = currentStyle(st);
    const label = (TEXT_STYLES.find(([v]) => v === style) || [null, st.selection.$from.parent.type === N.code_block ? '코드' : '단계'])[1];
    buttons.style.textContent = `${label} ▾`;
    for (const b of styleMenu.querySelectorAll('[data-ed-style]')) b.setAttribute('aria-pressed', String(b.dataset.edStyle === style));
    for (const key of ['strong', 'em', 'underline', 'strike']) buttons[key].setAttribute('aria-pressed', String(markActive(st, M[key])));
    const p = st.selection.$from.parent, centered = (p.attrs && p.attrs.align === 'center') || (st.selection instanceof pm.NodeSelection && st.selection.node.attrs.align === 'center');
    buttons.left.setAttribute('aria-pressed', String(!centered)); buttons.center.setAttribute('aria-pressed', String(!!centered));
    buttons.quote.setAttribute('aria-pressed', String(inNode(st, N.blockquote) > 0));
    const li = inNode(st, N.list_item), listType = li > 0 ? st.selection.$from.node(li - 1).type : null;
    buttons.bullet.setAttribute('aria-pressed', String(listType === N.bullet_list));
    buttons.ordered.setAttribute('aria-pressed', String(listType === N.ordered_list));
    buttons.undo.disabled = pm.undoDepth(st) === 0; buttons.redo.disabled = pm.redoDepth(st) === 0;
    const inTable = pm.isInTable(st);
    tableRow.hidden = !inTable; buttons.table.disabled = inTable;
    const offer = pasteKey.getState(st);
    suggest.hidden = !offer;
    root.toggleAttribute('data-ed-empty', isEmpty());
  }

  function getValue() { return cleanDoc({v: 'ed1', doc: view.state.doc.toJSON()}); }
  function isEmpty() {
    const d = view.state.doc;
    return d.childCount === 1 && d.firstChild.type === N.paragraph && d.firstChild.content.size === 0;
  }
  paint();
  fitTools();
  return {
    view, root, getValue, isEmpty,
    getText: () => toPlain(getValue()),
    focus: () => view.focus(),
    destroy() { resize?.disconnect(); phone?.removeEventListener?.('change', queueFit); cancelAnimationFrame(fitFrame); view.destroy(); root.remove(); },
  };
}
