// MTG-결과마크다운: the one reader of a stored record text (사업 보고 '회의 결과 원문'·특이사항) — the same markdown view as the
// basket update and notes (markdown-view.js: markdown-it + DOMPurify, md-body look), and a small [원문 보기] beside the heading
// that shows the stored letters exactly. The stored text is never changed here.
//  - A text with markdown marks (머리 ##, **굵게**, 표, AI가 붙인 \. 같은 군더더기 역슬래시 — note-preview.mjs markdownSource) is shown
//    formatted: headings, lists, tables; "2026\." reads "2026.". Until the view is ready (or if it cannot load) the letters stay.
//  - A text without marks is shown as written (line breaks, "1)" numbers and indents kept: EDIT-번호모양보존), with no toggle.
// paintRecordText(el, raw, {toggle, isCurrent}) — toggle: the button that switches 정리해서 보기 ⇄ 원문 보기 (hidden when not needed).
// Each paint starts formatted (the choice is not remembered, as in the basket).
import {markdownSource, writtenText} from './note-preview.mjs';

const RAW_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// The small icon button HTML for a heading row (aria-pressed: false = formatted, true = the stored letters).
export const rawToggleHtml = attr => `<button type="button" class="ghost record-raw-toggle" ${attr} aria-pressed="false" aria-label="원문 보기" title="원문 보기" hidden>${RAW_ICON}</button>`;

let view = null;
const loadView = () => (view ||= import('./markdown-view.js').catch(error => { view = null; throw error; }));
const states = new WeakMap();
const owners = new WeakMap(); // toggle → the element it switches

function paintToggle(toggle, state) {
  if (!toggle) return;
  toggle.hidden = !state.md;
  toggle.setAttribute('aria-pressed', String(state.raw));
  const label = state.raw ? '정리해서 보기' : '원문 보기';
  toggle.setAttribute('aria-label', label); toggle.title = label;
}

function draw(el, state) {
  const seq = ++state.seq, live = () => states.get(el) === state && state.seq === seq && (state.isCurrent?.() ?? true);
  el.classList.toggle('record-text-raw', state.raw);
  if (!state.md || state.raw) {
    // A markdown paint still in flight for this element sees the newer seq (live() false) and drops its result.
    el.classList.remove('md-body');
    el.textContent = state.raw ? state.text : writtenText(state.text);
    return;
  }
  el.classList.remove('md-body');
  el.textContent = writtenText(state.text);
  void loadView().then(v => { if (live()) return v.renderMarkdownInto(el, state.md, {isCurrent: live}); }).catch(() => {});
}

export function paintRecordText(el, raw, {toggle = null, isCurrent = null} = {}) {
  if (!el) return;
  const text = String(raw ?? ''), md = markdownSource(text);
  const state = {text, md, raw: false, seq: 0, isCurrent};
  states.set(el, state);
  draw(el, state);
  if (!toggle) return;
  const known = owners.has(toggle);
  owners.set(toggle, el);
  paintToggle(toggle, state);
  if (known) return;
  toggle.addEventListener('click', () => {
    const target = owners.get(toggle), now = target && states.get(target);
    if (!now || !now.md) return;
    now.raw = !now.raw;
    paintToggle(toggle, now);
    draw(target, now);
  });
}
