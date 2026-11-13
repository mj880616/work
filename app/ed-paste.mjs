// NOTE-붙여넣기문단사라짐 (요청함 V28 11/13 10:40): a formatted copy (text/html) whose line breaks are letters, not tags.
// Chat screens (Claude, ChatGPT, a message box) show an answer or a message as one box with `white-space: pre-wrap`: the copy
// brings "첫 문단\n\n둘째 문단" in one <div>/<span>. The editor's reader (ProseMirror) sees the pre-wrap style but, with no
// line-break node named for it in our schema, turns each line break into a space: the whole copy became one paragraph.
// Here, before the reader: those line breaks become <br> (pre-styled boxes always; any box when the formatted copy shows
// fewer lines than its own plain letters, e.g. a copy without inline styles). After the reader: a paragraph's run of two or
// more <br> (a blank line) splits it in two, a single <br> stays a line break. Bold, links etc. are untouched.
// Pure helpers (no editor, no window): the editor (ed-editor.js) calls them on each paste from outside the editor.

const PRE_STYLE = /(^|;)\s*white-space(-collapse)?\s*:\s*(pre|pre-wrap|pre-line|break-spaces|preserve|preserve-breaks)\s*(;|$|!)/i;
const BLOCKS = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR', 'BLOCKQUOTE', 'SECTION', 'ARTICLE', 'UL', 'OL', 'TABLE', 'PRE', 'HR', 'DL', 'DT', 'DD', 'FIGURE', 'HEADER', 'FOOTER', 'MAIN', 'NAV', 'ASIDE', 'ADDRESS']);

// Lines with letters in them (blank lines and spaces do not count).
export function letterLines(text) {
  return String(text || '').split(/\r\n?|\n/).filter(line => /\S/.test(line)).length;
}

const preStyled = el => !!el && el.nodeType === 1 && PRE_STYLE.test(el.getAttribute('style') || '');
// Where the box's own letters keep their line breaks: inside <pre> (the reader keeps it as a code block) or a pre-styled box.
function keptBy(node) {
  for (let el = node.parentNode; el && el.nodeType === 1; el = el.parentNode) {
    if (el.tagName === 'PRE') return 'pre';
    if (preStyled(el)) return 'style';
  }
  return null;
}
const textNodes = root => {
  const out = [], walk = n => { for (const c of n.childNodes) { if (c.nodeType === 3) out.push(c); else if (c.nodeType === 1) walk(c); } };
  walk(root);
  return out;
};

// The lines the formatted copy shows (as a browser draws it): blocks and <br> end lines; a letter line break counts only
// inside <pre> or a pre-styled box.
export function shownLines(doc) {
  let out = '';
  const walk = n => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) out += keptBy(c) ? c.nodeValue : c.nodeValue.replace(/\s+/g, ' ');
      else if (c.nodeType === 1) {
        if (c.tagName === 'BR') { out += '\n'; continue; }
        if (/^(SCRIPT|STYLE|TEMPLATE)$/.test(c.tagName)) continue;
        const block = BLOCKS.has(c.tagName);
        if (block) out += '\n';
        walk(c);
        if (block) out += '\n';
      }
    }
  };
  walk(doc.body);
  return letterLines(out);
}

// Line breaks written as letters become <br> (mutates doc). plain: the copy's own letters (text/plain), to tell a copy
// that lost its lines without saying so (no inline style) from ordinary tidy HTML (whose line breaks are only layout).
export function keepLetterBreaks(doc, plain = '') {
  const fallback = letterLines(plain) > shownLines(doc);
  let changed = false;
  for (const t of textNodes(doc.body)) {
    const value = t.nodeValue;
    if (!/[\r\n]/.test(value)) continue;
    const kept = keptBy(t);
    if (kept === 'pre') continue;
    if (!kept && !(fallback && /\S/.test(value))) continue;
    // Not pre-styled: spaces around a line break were only layout. Edge breaks of a box (layout) are left as they were.
    let lead = '', body = value, tail = '';
    if (!kept) {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(value);
      [lead, body, tail] = [m[1], m[2], m[3]];
      if (!/[\r\n]/.test(body)) continue;
      body = body.replace(/[ \t]*(\r\n?|\n)[ \t]*/g, '\n');
    }
    const parts = body.split(/\r\n?|\n/);
    const frag = doc.createDocumentFragment();
    if (lead) frag.append(doc.createTextNode(lead));
    parts.forEach((part, i) => { if (i) frag.append(doc.createElement('br')); if (part) frag.append(doc.createTextNode(part)); });
    if (tail) frag.append(doc.createTextNode(tail));
    t.replaceWith(frag);
    changed = true;
  }
  return changed;
}

// A pasted paragraph (JSON) split at its blank lines: a run of two or more hard_break ends it and starts the next one with
// the same attrs; breaks at a paragraph's start or end go (layout). Other nodes are walked into (lists, quotes, table cells).
function splitParagraph(node) {
  const content = node.content || [];
  if (!content.some(c => c.type === 'hard_break')) return [node];
  const lines = [[]];
  let breaks = 0;
  for (const c of content) {
    if (c.type === 'hard_break') { breaks++; continue; }
    if (breaks >= 2 && lines[lines.length - 1].length) lines.push([]);
    else if (breaks === 1 && lines[lines.length - 1].length) lines[lines.length - 1].push({type: 'hard_break'});
    breaks = 0;
    lines[lines.length - 1].push(c);
  }
  const out = lines.filter(l => l.length).map(inline => ({...node, content: inline}));
  if (out.length) return out;
  const {content: _gone, ...empty} = node;
  return [empty];
}
function splitIn(nodes) {
  let changed = false;
  const out = [];
  for (const n of nodes || []) {
    if (n.type === 'paragraph') {
      const parts = splitParagraph(n);
      if (parts.length === 1 && (parts[0].content || []).length === (n.content || []).length) { out.push(n); continue; }
      changed = true;
      out.push(...parts);
    } else if (n.content && n.type !== 'code_block') {
      const inner = splitIn(n.content);
      if (inner.changed) { changed = true; out.push({...n, content: inner.nodes}); } else out.push(n);
    } else out.push(n);
  }
  return {nodes: out, changed};
}
const INLINE = new Set(['text', 'hard_break']);
// slice: a ProseMirror Slice as JSON ({content, openStart, openEnd}). Returns a new one, or the same one when nothing splits.
// A copy of one inline box (a <span>: Chrome's copy from inside one chat message) comes as inline content only; split, it becomes
// paragraphs with `attrs` (the paragraph pasted into), open at both ends so the first and last join the letters around them.
export function splitBlankLines(slice, attrs = {}) {
  if (!slice || !slice.content) return slice;
  if (slice.content.every(n => INLINE.has(n.type))) {
    const parts = splitParagraph({type: 'paragraph', attrs, content: slice.content});
    if (parts.length < 2) return slice;
    return {content: parts, openStart: (slice.openStart || 0) + 1, openEnd: (slice.openEnd || 0) + 1};
  }
  const {nodes, changed} = splitIn(slice.content);
  return changed ? {...slice, content: nodes} : slice;
}
