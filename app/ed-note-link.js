// S69-98 NOTE-에버노트 ⑧ 노트 연결 [[ ]]: 노트 편집기에서 '[[' 를 치면 그 자리 아래에 노트 고르기 목록이 뜬다('[[' 뒤 글자로 제목을 거름).
// ↑↓로 고르고 Enter·Tab(또는 누르기) = '[[찾는말'이 그 노트 제목 링크로 바뀐다(주소는 note-link-model.mjs noteLinkHref — 보통 링크 하나, 새 칸 없음).
// Esc = 목록만 닫고 친 글자는 그대로. 여는 곳이 noteLinks를 줄 때만(노트) 붙는다. 목록 모양은 '/' 목록(ed-blocks.js)과 같은 .ed-menu.ed-pop.ed-slash.
import {linkTyping, pickNotes, noteLinkHref} from './note-link-model.mjs';

const make = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = text; return n; };

/** noteLinks: {notes() → 노트 목록, self() → 지금 노트 id, hidden(note), titleOf(note), base() → 앱 주소} */
export function mountNoteLink({pm, view, schema, bar, noteLinks, changed = () => {}}) {
  const N = schema.nodes, M = schema.marks;
  const box = make('div', 'ed-menu ed-pop ed-slash ed-notelink'); box.hidden = true; box.setAttribute('role', 'listbox'); box.setAttribute('aria-label', '연결할 노트');
  bar.append(box);
  let at = null, items = [], active = 0, dismissed = null, gone = false;
  // 커서 앞 '[[찾는말' → {from, to, query} (코드 블록·고른 범위에서는 없음).
  const typing = st => {
    const sel = st.selection;
    if (!sel.empty) return null;
    const $f = sel.$from, p = $f.parent;
    if (!p.isTextblock || p.type === N.code_block) return null;
    const before = p.textBetween(0, $f.parentOffset, null, '￼');
    const hit = linkTyping(before);
    return hit ? {from: $f.pos - hit.length, to: $f.pos, query: hit.query} : null;
  };
  function paint() {
    if (gone) return;
    const now = typing(view.state);
    if (!now || (dismissed && dismissed.from === now.from)) { if (!now) dismissed = null; close(false); return; }
    const list = pickNotes(noteLinks.notes(), now.query, {self: noteLinks.self(), hidden: noteLinks.hidden, titleOf: noteLinks.titleOf});
    const same = items.length === list.length && items.every((it, i) => it.id === list[i].id);
    items = list; at = now; if (!same) active = 0;
    box.replaceChildren(...(list.length ? list.map((it, i) => {
      const b = make('button', i === active ? 'is-active' : '', it.title);
      b.type = 'button'; b.dataset.edNoteLink = it.id; b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(i === active));
      return b;
    }) : [make('p', 'ed-notelink-none', '맞는 노트가 없어요')]));
    const was = box.hidden; box.hidden = false;
    const c = view.coordsAtPos(now.to), vh = window.visualViewport?.height || innerHeight, vw = innerWidth;
    box.style.left = '0px'; box.style.top = '0px'; box.style.maxHeight = '';
    const m = box.getBoundingClientRect(), bottomRoom = vw <= 760 ? 72 : 12, below = vh - bottomRoom - c.bottom - 4, under = m.height <= below || below >= c.top - 12;
    box.style.maxHeight = `${Math.max(100, under ? below : c.top - 12)}px`;
    const top = under ? c.bottom + 4 : c.top - 4 - Math.min(m.height, c.top - 12);
    box.style.left = `${Math.round(Math.max(8, Math.min(c.left, vw - 8 - m.width)))}px`; box.style.top = `${Math.round(top)}px`;
    const drawn = box.getBoundingClientRect();
    if (Math.abs(drawn.top - top) > 1) box.style.top = `${Math.round(top - (drawn.top - top))}px`;
    const left = parseFloat(box.style.left);
    if (Math.abs(drawn.left - left) > 1) box.style.left = `${Math.round(left - (drawn.left - left))}px`;
    box.querySelector('.is-active')?.scrollIntoView?.({block: 'nearest'});
    if (was) changed();
  }
  function close(remember) {
    if (remember && at) dismissed = {from: at.from};
    if (box.hidden) return false;
    box.hidden = true; at = null; items = []; active = 0;
    changed();
    return true;
  }
  function choose(id) {
    const now = typing(view.state), it = items.find(x => x.id === id);
    close(false);
    if (!now || !it) return;
    const href = noteLinkHref(it.id, noteLinks.base());
    if (!href) return;
    const st = view.state, tr = st.tr.replaceWith(now.from, now.to, [schema.text(it.title, [M.link.create({href})]), schema.text(' ')]);
    tr.removeStoredMark(M.link);
    view.dispatch(tr.scrollIntoView());
    view.focus();
  }
  box.addEventListener('mousedown', e => e.preventDefault());
  box.addEventListener('click', e => { const b = e.target.closest('[data-ed-note-link]'); if (b) choose(b.dataset.edNoteLink); });
  function handleKey(v, e) {
    if (box.hidden || v.composing) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (items.length) { active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; paint(); } return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { const it = items[active]; if (it) { choose(it.id); return true; } close(true); return false; }
    if (e.key === 'Escape') { close(true); return true; }
    return false;
  }
  return {update: paint, handleKey, close: () => close(true), isOpen: () => !box.hidden, destroy() { gone = true; box.remove(); }};
}
