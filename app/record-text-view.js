// MTG-결과마크다운: the one reader of a stored record text (사업 보고 '회의 결과'·'내용'·특이사항) — the same markdown view as the
// basket update and notes (markdown-view.js: markdown-it + DOMPurify, md-body look). The stored text is never changed here.
//  - A text with markdown marks (머리 ##, **굵게**, 표, AI가 붙인 \. 같은 군더더기 역슬래시 — note-preview.mjs markdownSource) is shown
//    formatted: headings, lists, tables; "2026\." reads "2026.". Until the view is ready (or if it cannot load) the letters stay.
//  - A text without marks is shown as written (line breaks, "1)" numbers and indents kept: EDIT-번호모양보존).
// S62-02 MTG-원문칸넘침(11/15 명진): the [원문]/[서식] button beside the heading is gone (사업 보고 상세 only used it). Addresses
// (http·https only, record-links.mjs) open in a new window (the app hands them to the outside browser); a line that is only an
// address is a small bookmark row (domain + address). Nothing is fetched from the address. Long words wrap inside the box (CSS).
// paintRecordText(el, raw, {isCurrent}).
import {markdownSource, writtenText} from './note-preview.mjs';
import {recordLinkParts, bookmarkLine, linkHost} from './record-links.mjs';

let view = null;
const loadView = () => (view ||= import('./markdown-view.js').catch(error => { view = null; throw error; }));
const states = new WeakMap();

function outLink(url, className) {
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.className = className;
  return a;
}
function bookmark(url) {
  const a = outLink(url, 'record-bookmark'), host = document.createElement('b'), where = document.createElement('small');
  host.className = 'record-bookmark-host'; host.textContent = linkHost(url);
  where.className = 'record-bookmark-url'; where.textContent = url;
  a.title = url; a.append(host, where);
  return a;
}
// The text as written, with addresses as links: line breaks stay as text ('\n' under pre-wrap); a bookmark row is a block, so
// the line break next to it is not added (it would show as an empty line).
function writtenNodes(text) {
  const nodes = [];
  let prevBlock = false;
  text.split('\n').forEach((line, i) => {
    const only = bookmarkLine(line);
    if (i > 0 && !only && !prevBlock) nodes.push(document.createTextNode('\n'));
    if (only) { nodes.push(bookmark(only)); prevBlock = true; return; }
    prevBlock = false;
    for (const part of recordLinkParts(line)) {
      if (part.url) { const a = outLink(part.url, 'record-link'); a.textContent = part.url; nodes.push(a); }
      else nodes.push(document.createTextNode(part.text));
    }
  });
  return nodes;
}
// In the formatted view markdown-it already makes links (new window, markdown-view.js). A paragraph that is only one address
// becomes the same bookmark row.
function bookmarkParagraphs(el) {
  for (const p of el.querySelectorAll('p')) {
    const a = p.firstElementChild;
    if (p.childNodes.length !== 1 || !a || a.tagName !== 'A') continue;
    const url = a.getAttribute('href') || '';
    if (a.textContent.trim() !== url || bookmarkLine(url) !== url) continue;
    p.replaceWith(bookmark(url));
  }
}

function draw(el, state) {
  const seq = ++state.seq, live = () => states.get(el) === state && state.seq === seq && (state.isCurrent?.() ?? true);
  el.classList.remove('md-body');
  el.replaceChildren(...writtenNodes(writtenText(state.text)));
  if (!state.md) return;
  // A markdown paint still in flight for this element sees the newer seq (live() false) and drops its result.
  void loadView().then(v => { if (live()) return v.renderMarkdownInto(el, state.md, {isCurrent: live}); })
    .then(r => { if (r?.ok && live()) bookmarkParagraphs(el); }).catch(() => {});
}

export function paintRecordText(el, raw, {isCurrent = null} = {}) {
  if (!el) return;
  const text = String(raw ?? ''), md = markdownSource(text);
  const state = {text, md, seq: 0, isCurrent};
  states.set(el, state);
  draw(el, state);
}
