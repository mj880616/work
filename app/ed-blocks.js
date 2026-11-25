// NOTE-노션편집 ①(나) (명진 2026-11-24 21:41 "노션의 자유로운 편집", 11-25 03:19 "블록 끌어오기는 켜고 끌 수 있게 / 때로는 블로그 글
// 쓰기처럼"): the note editor's block parts, mounted by ed-editor.js (createDocEditor blocks·slash options). Nothing here saves.
//   - Block handle ⋮⋮ (only while 블록 편집 is on): beside the top-level block under the mouse (a phone: the block with the cursor).
//     Drag it to move the block (a phone: press and hold the handle, then drag); press it for the block menu (복제·지우기
//     and 바꾸기: 본문·제목 1~3·글머리·번호·할 일·인용·접기·코드). Off = no handle, no menu, no gutter: the text looks as before (블로그 글쓰기).
//     순서는 끌기 + 키보드 Alt+↑ / Alt+↓(글자 안 커서 또는 손잡이에 초점) — 메뉴에 순서 단추 없음(S70-04·S70-34, standard-interactions D6).
//   - '/' list (on or off, wherever the opener asks for slash): '/' typed on an empty line opens a small list (제목 1~3·글머리·번호·할 일 체크·
//     인용·구분선·표·사진·접기·코드); letters typed after it narrow the list; ↑ ↓ choose, Enter (or Tab) puts it in, Esc closes it.
//   - 접기 (toggle): Enter at the end of a folded ▸ line starts a new line after the fold (not a hidden one inside it).
// Every change is one ordinary editor step (↶ undoes it).
import {DEFAULT_BODY, CHECK_MARKER} from './ed-schema.mjs';
import {createEdgeScroll} from './drag-edge-scroll.js';

// [key, name shown, words that also find it]
export const SLASH_ITEMS = [
  ['h1', '제목 1', 'h1 heading 제목 큰제목'], ['h2', '제목 2', 'h2 heading 제목'], ['h3', '제목 3', 'h3 heading 제목 작은제목'],
  ['bullet', '글머리 목록', 'bullet list ul 목록 글머리'], ['ordered', '번호 목록', 'number ordered ol 번호'], ['check', '할 일 체크', 'todo check task 할일 체크'],
  ['quote', '인용', 'quote 인용'], ['rule', '구분선', 'hr rule divider line 구분선'], ['table', '표', 'table 표'],
  ['photo', '사진', 'image photo picture img 사진 그림'], ['toggle', '접기 블록', 'toggle fold details 접기 토글'], ['code', '코드', 'code pre 코드'],
];
// What a top-level text block can be turned into from its menu (the same names as the '/' list).
export const TURN_ITEMS = [['p', '본문'], ['h1', '제목 1'], ['h2', '제목 2'], ['h3', '제목 3'], ['bullet', '글머리 목록'], ['ordered', '번호 목록'],
  ['check', '할 일 체크'], ['quote', '인용'], ['toggle', '접기 블록'], ['code', '코드']];

// The '/' list narrowed by what was typed after '/': a name or one of its words that starts with it, then ones that contain it.
export function slashMatches(query, items = SLASH_ITEMS) {
  const q = String(query || '').replace(/\s+/g, '').toLowerCase();
  if (!q) return items.slice();
  const words = it => [it[1].replace(/\s+/g, ''), ...it[2].split(' ')].map(w => w.toLowerCase());
  const first = items.filter(it => words(it).some(w => w.startsWith(q)));
  const rest = items.filter(it => !first.includes(it) && words(it).some(w => w.includes(q)));
  return [...first, ...rest];
}
// Where a block moved from index `from` to the gap `to` (0..count) ends up, or -1 when it stays where it is.
export function movedIndex(from, to) {
  if (to === from || to === from + 1) return -1;
  return to > from ? to - 1 : to;
}

const make = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = text; return n; };
const GRIP_PATH = [[9, 6], [15, 6], [9, 12], [15, 12], [9, 18], [15, 18]];
export function gripIcon() {
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({viewBox: '0 0 24 24', width: '16', height: '16', 'aria-hidden': 'true', focusable: 'false'})) svg.setAttribute(k, v);
  for (const [cx, cy] of GRIP_PATH) { const c = document.createElementNS(ns, 'circle'); c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', '1.6'); c.setAttribute('fill', 'currentColor'); svg.append(c); }
  return svg;
}

// pm: the editor library; view, schema; root (.ed-editor), box (.ed-box); handles: initial 블록 편집 on/off; slash: '/' list on;
// insert: {block(node), table(), photo() | null} from the editor; changed(): a box opened or closed (the editor tells its opener).
// bar: the editor's button row box (.ed-bar) — the block menu and the '/' list sit in it as its other small boxes do (the same look, the same
// stacking above the bottom save row while open).
export function mountBlocks({pm, view, schema, root, box, bar = root, handles = false, slash = false, insert, changed = () => {}}) {
  const N = schema.nodes;
  let on = !!handles, gone = false;
  const para = content => N.paragraph.create({style: DEFAULT_BODY}, content || null);

  // ── top-level blocks ──
  const tops = () => {
    const out = [];
    view.state.doc.forEach((node, offset, index) => { const dom = view.nodeDOM(offset); if (dom && dom.nodeType === 1) out.push({node, pos: offset, index, dom}); });
    return out;
  };
  const topAtY = y => {
    const list = tops();
    for (const b of list) { const r = b.dom.getBoundingClientRect(); if (y >= r.top - 4 && y <= r.bottom + 4) return b; }
    return null;
  };
  const topOfSelection = () => {
    const $h = view.state.selection.$head;
    if ($h.depth < 1) return null;
    const index = $h.index(0), pos = $h.before(1);
    const dom = view.nodeDOM(pos);
    return dom && dom.nodeType === 1 ? {node: view.state.doc.child(index), pos, index, dom} : null;
  };

  // ── handle ──
  const grip = make('button', 'ed-grip');
  grip.type = 'button'; grip.setAttribute('aria-label', '블록 옮기기·메뉴'); grip.title = '끌어서 옮기기 · 눌러서 메뉴';
  grip.setAttribute('aria-haspopup', 'true'); grip.setAttribute('aria-expanded', 'false'); grip.hidden = true;
  grip.append(gripIcon());
  const line = make('div', 'ed-drop-line'); line.hidden = true; line.setAttribute('aria-hidden', 'true');
  box.append(grip, line);
  let shown = null; // the block the handle stands beside
  const place = b => {
    if (!on || !b) { grip.hidden = true; shown = null; return; }
    shown = b;
    const r = b.dom.getBoundingClientRect(), host = box.getBoundingClientRect();
    const lineH = parseFloat(getComputedStyle(b.dom).lineHeight) || 22;
    grip.hidden = false;
    grip.style.top = `${Math.round(r.top - host.top + Math.min(lineH, r.height) / 2 - 12)}px`;
    grip.style.left = `${Math.max(0, Math.round(r.left - host.left - 26))}px`;
    grip.dataset.edBlock = String(b.index);
  };
  // A finger (or pen) press: the handle follows the cursor's block (there is no hover). The last press decides, so a touch screen that
  // also reports hover (a laptop with touch, a phone browser that says "hover") still gets the handle where it tapped.
  let lastPress = '';
  box.addEventListener('pointerdown', e => { if (!grip.contains(e.target)) lastPress = e.pointerType || ''; }, true);
  const touchy = () => (lastPress ? lastPress !== 'mouse' : !!window.matchMedia?.('(hover: none)').matches);
  box.addEventListener('pointermove', e => {
    if (!on || dragging || e.pointerType !== 'mouse' || grip.contains(e.target) || menu.contains(e.target)) return;
    const b = topAtY(e.clientY);
    if (b) place(b);
  });

  // ── dragging ──
  let dragging = false;
  const gapAtY = y => {
    const list = tops();
    for (const b of list) { const r = b.dom.getBoundingClientRect(); if (y < r.top + r.height / 2) return {to: b.index, list}; }
    return {to: list.length, list};
  };
  const showLine = (to, list) => {
    const host = box.getBoundingClientRect();
    const ref = list[Math.min(to, list.length - 1)];
    if (!ref) { line.hidden = true; return; }
    const r = ref.dom.getBoundingClientRect(), y = to >= list.length ? r.bottom + 2 : r.top - 2;
    line.hidden = false;
    line.style.top = `${Math.round(y - host.top)}px`;
    line.style.left = `${Math.round(r.left - host.left)}px`;
    line.style.width = `${Math.round(view.dom.getBoundingClientRect().right - r.left - 12)}px`;
  };
  function moveBlock(from, to) {
    const doc = view.state.doc, at = movedIndex(from, to);
    if (at < 0 || from < 0 || from >= doc.childCount) return false;
    const node = doc.child(from);
    let start = 0; for (let i = 0; i < from; i++) start += doc.child(i).nodeSize;
    let target = 0; for (let i = 0; i < to; i++) target += doc.child(i).nodeSize;
    const tr = view.state.tr.delete(start, start + node.nodeSize);
    const insertAt = to > from ? target - node.nodeSize : target;
    tr.insert(insertAt, node);
    tr.setSelection(node.isTextblock || !node.isAtom ? pm.TextSelection.near(tr.doc.resolve(insertAt + 1)) : pm.NodeSelection.create(tr.doc, insertAt));
    view.dispatch(tr.scrollIntoView());
    return true;
  }
  grip.addEventListener('contextmenu', e => e.preventDefault());
  // 기본 동작 기준표 D1~D4(docs/design/standard-interactions.md): 끄는 동안 반투명 조각이 따라오고(D1), 놓을 자리에 줄(D2),
  // 화면 가장자리에서 저절로 굴리고(D3, 공용 drag-edge-scroll.js), Esc는 끌기 취소(D4: 제자리, 아무것도 바꾸지 않음).
  grip.addEventListener('pointerdown', e => {
    if (!on || !shown || e.button > 0) return;
    e.preventDefault();
    const from = shown.index, block = shown.dom, mouse = e.pointerType === 'mouse', startY = e.clientY, id = e.pointerId;
    let hold = null, armed = mouse, moved = false, ghost = null, lastX = e.clientX, lastY = e.clientY, cancelled = false;
    try { grip.setPointerCapture(id); } catch { /* 끌기 없이 누르기만 */ }
    const aim = () => { const {to, list} = gapAtY(lastY); line.dataset.edTo = String(to); showLine(to, list); };
    const edge = createEdgeScroll({onScroll: () => { if (dragging) aim(); }});
    const shift = startY - block.getBoundingClientRect().top;
    const follow = () => { if (ghost) { ghost.style.top = `${Math.round(lastY - shift)}px`; ghost.style.left = `${Math.round(block.getBoundingClientRect().left)}px`; } };
    const finish = () => {
      dragging = false; root.classList.remove('ed-dragging'); line.hidden = true; ghost?.remove(); ghost = null; edge.stop();
      document.removeEventListener('keydown', escKey, true);
    };
    const escKey = ev => { if (ev.key !== 'Escape' || !dragging) return; ev.preventDefault(); ev.stopPropagation(); cancelled = true; finish(); view.focus(); place(topOfSelection()); };
    const begin = () => {
      dragging = true; root.classList.add('ed-dragging'); closeMenu();
      ghost = make('div', 'ed-doc ed-drag-ghost'); ghost.setAttribute('aria-hidden', 'true');
      ghost.style.width = `${Math.round(block.getBoundingClientRect().width)}px`;
      ghost.append(block.cloneNode(true)); root.append(ghost); follow();
      document.addEventListener('keydown', escKey, true);
      try { navigator.vibrate?.(10); } catch {}
    };
    if (!mouse) hold = setTimeout(() => { armed = true; begin(); }, 350);
    const move = ev => {
      if (ev.pointerId !== id || cancelled) return;
      lastX = ev.clientX; lastY = ev.clientY;
      if (Math.abs(ev.clientY - startY) > 4) moved = true;
      if (!dragging && armed && mouse && moved) begin();
      if (!dragging) { if (!mouse && moved) { clearTimeout(hold); hold = null; } return; }
      ev.preventDefault();
      follow(); aim(); edge.update(lastX, lastY);
    };
    const end = ev => {
      if (ev.pointerId !== id) return;
      clearTimeout(hold);
      grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', end); grip.removeEventListener('pointercancel', end);
      try { grip.releasePointerCapture(id); } catch {}
      if (cancelled) return;
      if (dragging) {
        const to = +(line.dataset.edTo ?? -1);
        finish();
        if (ev.type === 'pointerup' && to >= 0) moveBlock(from, to);
        view.focus();
        place(topOfSelection());
      } else if (ev.type === 'pointerup' && !moved) openMenu(from);
    };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
  });
  grip.addEventListener('keydown', e => {
    if (!shown) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMenu(shown.index); }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); const i = shown.index; moveBlock(i, e.key === 'ArrowUp' ? i - 1 : i + 2); }
  });

  // ── block menu ──
  const menu = make('div', 'ed-menu ed-pop ed-block-menu'); menu.hidden = true; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', '블록 메뉴');
  bar.append(menu);
  let menuFor = -1;
  const item = (key, text) => { const b = make('button', '', text); b.type = 'button'; b.dataset.edBlockCmd = key; b.setAttribute('role', 'menuitem'); return b; };
  menu.append(item('copy', '복제'), item('del', '삭제'), make('span', 'ed-block-sep', '바꾸기'));
  for (const [key, text] of TURN_ITEMS) menu.append(item('turn:' + key, text));
  function openMenu(index) {
    const node = view.state.doc.maybeChild(index);
    if (!node) return;
    menuFor = index;
    const text = isTextual(node);
    for (const b of menu.querySelectorAll('[data-ed-block-cmd^="turn:"]')) b.disabled = !text || b.dataset.edBlockCmd === 'turn:' + kindOf(node);
    menu.hidden = false; grip.setAttribute('aria-expanded', 'true');
    menu.style.left = '0px'; menu.style.top = '0px'; menu.style.maxHeight = '';
    const g = grip.getBoundingClientRect(), m = menu.getBoundingClientRect(), vh = window.visualViewport?.height || innerHeight, vw = innerWidth;
    const bottomRoom = vw <= 760 ? 72 : 12, below = vh - bottomRoom - g.bottom - 4;
    const top = m.height <= below ? g.bottom + 4 : Math.max(8, g.top - 4 - Math.min(m.height, g.top - 12));
    menu.style.maxHeight = `${Math.max(120, m.height <= below ? below : g.top - 12)}px`;
    menu.style.left = `${Math.round(Math.max(8, Math.min(g.left, vw - 8 - m.width)))}px`; menu.style.top = `${Math.round(top)}px`;
    const drawn = menu.getBoundingClientRect();
    if (Math.abs(drawn.top - top) > 1) menu.style.top = `${Math.round(top - (drawn.top - top))}px`;
    menu.querySelector('button:not([disabled])')?.focus({preventScroll: true});
    changed();
  }
  function closeMenu(refocus = false) {
    if (menu.hidden) return false;
    menu.hidden = true; menuFor = -1; grip.setAttribute('aria-expanded', 'false');
    if (refocus) view.focus();
    changed();
    return true;
  }
  menu.addEventListener('mousedown', e => e.preventDefault());
  menu.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    const index = menuFor, cmd = b.dataset.edBlockCmd;
    closeMenu();
    blockCmd(index, cmd);
    view.focus();
    place(topOfSelection());
  });
  menu.addEventListener('keydown', e => {
    const list = [...menu.querySelectorAll('button:not([disabled])')], i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus(); }
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); }
  });
  const outside = e => { if (!menu.hidden && !menu.contains(e.target) && !grip.contains(e.target)) closeMenu(); if (!slashBox.hidden && !slashBox.contains(e.target)) closeSlash(true); };
  document.addEventListener('pointerdown', outside, true);

  // The letters of a block as lines (each a line's inline content), for turning it into another kind.
  const isTextual = node => {
    if (node.isTextblock) return true;
    let ok = true, any = false;
    node.descendants(n => { if (n.isTextblock) { any = true; return false; } if (n.isAtom || n.type.spec.tableRole) ok = false; return ok; });
    return ok && any;
  };
  const kindOf = node => {
    if (node.type === N.paragraph) return 'p';
    if (node.type === N.heading) return 'h' + node.attrs.level;
    if (node.type === N.bullet_list) return node.attrs.marker === CHECK_MARKER ? 'check' : 'bullet';
    if (node.type === N.ordered_list) return 'ordered';
    if (node.type === N.blockquote) return 'quote';
    if (node.type === N.toggle) return 'toggle';
    if (node.type === N.code_block) return 'code';
    return '';
  };
  const linesOf = node => {
    const out = [];
    const take = n => {
      if (n.type === N.code_block) for (const t of n.textContent.split('\n')) out.push(pm.Fragment.from(t ? schema.text(t) : null));
      else out.push(n.content);
    };
    if (node.isTextblock) take(node); else node.descendants(n => { if (n.isTextblock) { take(n); return false; } return true; });
    return out.length ? out : [pm.Fragment.empty];
  };
  function build(kind, lines) {
    const item = c => N.list_item.create(null, para(c));
    switch (kind) {
      case 'p': return lines.map(para);
      case 'h1': case 'h2': case 'h3': return lines.map(c => N.heading.create({level: +kind[1]}, c));
      case 'bullet': return [N.bullet_list.create(null, lines.map(item))];
      case 'check': return [N.bullet_list.create({marker: CHECK_MARKER}, lines.map(item))];
      case 'ordered': return [N.ordered_list.create(null, lines.map(item))];
      case 'quote': return [N.blockquote.create(null, lines.map(para))];
      case 'toggle': return [N.toggle.create(null, lines.map(para))];
      case 'code': { const text = lines.map(c => c.textBetween(0, c.size, '\n', '\n')).join('\n'); return [N.code_block.create(null, text ? schema.text(text) : null)]; }
      default: return null;
    }
  }
  function blockCmd(index, cmd) {
    const doc = view.state.doc, node = doc.maybeChild(index);
    if (!node) return;
    let pos = 0; for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
    const end = pos + node.nodeSize, tr = view.state.tr;
    if (cmd === 'copy') {
      tr.insert(end, node);
      tr.setSelection(node.isAtom ? pm.NodeSelection.create(tr.doc, end) : pm.TextSelection.near(tr.doc.resolve(end + 1)));
    } else if (cmd === 'del') {
      if (doc.childCount === 1) tr.replaceWith(pos, end, para()); else tr.delete(pos, end);
      tr.setSelection(pm.TextSelection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size)), -1));
    } else if (cmd.startsWith('turn:')) {
      if (!isTextual(node)) return;
      const made = build(cmd.slice(5), linesOf(node));
      if (!made) return;
      tr.replaceWith(pos, end, made);
      tr.setSelection(pm.TextSelection.near(tr.doc.resolve(pos + 1)));
    } else return;
    view.dispatch(tr.scrollIntoView());
  }

  // ── '/' list ──
  const slashBox = make('div', 'ed-menu ed-pop ed-slash'); slashBox.hidden = true; slashBox.setAttribute('role', 'listbox'); slashBox.setAttribute('aria-label', '넣을 블록');
  bar.append(slashBox);
  let slashAt = null, dismissed = null, active = 0, matches = [];
  const available = () => SLASH_ITEMS.filter(it => it[0] !== 'photo' || !!insert.photo);
  // The '/' word on an empty line: {from, to, query} when the cursor stands at the end of "/word" alone on a paragraph.
  const slashWord = st => {
    const sel = st.selection;
    if (!slash || !sel.empty) return null;
    const $f = sel.$from, p = $f.parent;
    if (p.type !== N.paragraph) return null;
    const text = p.textContent, m = /^\/((?:[^\s/][^/]{0,11})?)$/.exec(text);
    if (!m || $f.parentOffset !== text.length) return null;
    return {from: $f.start(), to: $f.end(), query: m[1]};
  };
  function paintSlash() {
    const at = slashWord(view.state);
    if (!at || (dismissed && dismissed.from === at.from && dismissed.query === at.query)) { closeSlash(false); return; }
    if (dismissed && dismissed.from !== at.from) dismissed = null;
    const list = slashMatches(at.query, available());
    if (!list.length) { closeSlash(false); return; }
    const sameList = matches.length === list.length && matches.every((it, i) => it === list[i]);
    matches = list; slashAt = at; if (!sameList) active = 0;
    slashBox.replaceChildren(...list.map((it, i) => {
      const b = make('button', i === active ? 'is-active' : '', it[1]);
      b.type = 'button'; b.dataset.edSlash = it[0]; b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(i === active));
      return b;
    }));
    const was = slashBox.hidden;
    slashBox.hidden = false;
    const c = view.coordsAtPos(at.to), vh = window.visualViewport?.height || innerHeight, vw = innerWidth;
    slashBox.style.left = '0px'; slashBox.style.top = '0px'; slashBox.style.maxHeight = '';
    const m = slashBox.getBoundingClientRect(), bottomRoom = vw <= 760 ? 72 : 12, below = vh - bottomRoom - c.bottom - 4;
    const top = m.height <= below || below >= c.top - 12 ? c.bottom + 4 : c.top - 4 - Math.min(m.height, c.top - 12);
    slashBox.style.maxHeight = `${Math.max(100, m.height <= below || below >= c.top - 12 ? below : c.top - 12)}px`;
    slashBox.style.left = `${Math.round(Math.max(8, Math.min(c.left, vw - 8 - m.width)))}px`; slashBox.style.top = `${Math.round(top)}px`;
    const drawn = slashBox.getBoundingClientRect();
    if (Math.abs(drawn.top - top) > 1) slashBox.style.top = `${Math.round(top - (drawn.top - top))}px`;
    if (Math.abs(drawn.left - parseFloat(slashBox.style.left)) > 1) slashBox.style.left = `${Math.round(parseFloat(slashBox.style.left) - (drawn.left - parseFloat(slashBox.style.left)))}px`;
    slashBox.querySelector('.is-active')?.scrollIntoView?.({block: 'nearest'});
    if (was) changed();
  }
  function closeSlash(remember) {
    if (remember && slashAt) dismissed = {from: slashAt.from, query: slashAt.query};
    if (slashBox.hidden) return false;
    slashBox.hidden = true; slashAt = null; matches = []; active = 0;
    changed();
    return true;
  }
  function chooseSlash(key) {
    const at = slashWord(view.state);
    closeSlash(false);
    if (!at) return;
    view.dispatch(view.state.tr.delete(at.from, at.to));
    const st = () => view.state, go = cmd => cmd(st(), view.dispatch, view);
    switch (key) {
      case 'h1': case 'h2': case 'h3': go(pm.setBlockType(N.heading, {level: +key[1]})); break;
      case 'bullet': go(pm.wrapInList(N.bullet_list)); break;
      case 'ordered': go(pm.wrapInList(N.ordered_list)); break;
      case 'check': go(pm.wrapInList(N.bullet_list, {marker: CHECK_MARKER})); break;
      case 'quote': go(pm.wrapIn(N.blockquote)); break;
      case 'code': go(pm.setBlockType(N.code_block)); break;
      case 'rule': insert.block(N.horizontal_rule.create()); break;
      case 'table': insert.table(); break;
      case 'photo': insert.photo?.(); break;
      case 'toggle': {
        const $f = st().selection.$from, start = $f.before(), end = $f.after();
        const tr = st().tr.replaceWith(start, end, N.toggle.create(null, para()));
        view.dispatch(tr.setSelection(pm.TextSelection.create(tr.doc, start + 2)).scrollIntoView());
        break;
      }
      default: break;
    }
    view.focus();
  }
  slashBox.addEventListener('mousedown', e => e.preventDefault());
  slashBox.addEventListener('click', e => { const b = e.target.closest('[data-ed-slash]'); if (b) chooseSlash(b.dataset.edSlash); });

  // Keys the editor hands here first (before its own keymap).
  function handleKey(v, e) {
    if (!slashBox.hidden && !v.composing) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { active = (active + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length; paintSlash(); return true; }
      if (e.key === 'Enter' || e.key === 'Tab') { const it = matches[active]; if (it) chooseSlash(it[0]); return true; }
      if (e.key === 'Escape') { closeSlash(true); return true; }
    }
    // D6: Alt+↑ / Alt+↓ = 커서가 있는 블록을 한 칸 위·아래로(블록 편집이 켜져 있을 때). 커서는 글자 안 같은 자리에 남는다.
    if (on && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !v.composing && slashBox.hidden) {
      const sel = v.state.selection, $h = sel.$head;
      if ($h.depth < 1 || !sel.empty) return true;
      const i = $h.index(0), off = $h.pos - $h.before(1), up = e.key === 'ArrowUp';
      if (!moveBlock(i, up ? i - 1 : i + 2)) return true;
      const at = up ? i - 1 : i + 1, doc = v.state.doc;
      let start = 0; for (let k = 0; k < at; k++) start += doc.child(k).nodeSize;
      const pos = Math.min(start + off, start + doc.child(at).nodeSize - 1);
      try { v.dispatch(v.state.tr.setSelection(pm.TextSelection.near(v.state.doc.resolve(pos))).scrollIntoView()); } catch { /* 블록 처음 자리 그대로 */ }
      return true;
    }
    // 접기: Enter at the end of a folded ▸ line goes on after the fold.
    if (e.key === 'Enter' && !e.shiftKey && !v.composing) {
      const sel = v.state.selection, $f = sel.$from;
      if (sel.empty && $f.depth >= 2 && $f.index($f.depth - 1) === 0) {
        const t = $f.node($f.depth - 1);
        if (t.type === N.toggle && !t.attrs.open && $f.parentOffset === $f.parent.content.size) {
          const after = $f.after($f.depth - 1), tr = v.state.tr.insert(after, para());
          v.dispatch(tr.setSelection(pm.TextSelection.create(tr.doc, after + 1)).scrollIntoView());
          return true;
        }
      }
    }
    return false;
  }

  // Called after every editor step.
  function update() {
    if (gone) return;
    paintSlash();
    if (!on || dragging) return;
    if (touchy() || !shown || !shown.dom.isConnected) place(topOfSelection());
    else if (shown) { const b = tops().find(x => x.index === shown.index); place(b || topOfSelection()); }
  }
  function setOn(next) {
    on = !!next;
    root.classList.toggle('ed-blocks-on', on);
    if (!on) { closeMenu(); grip.hidden = true; shown = null; line.hidden = true; } else place(topOfSelection());
  }
  setOn(on);
  const onScroll = () => { closeMenu(); if (on && shown?.dom?.isConnected) place(shown); if (!slashBox.hidden) paintSlash(); };
  window.addEventListener('scroll', onScroll, true);
  return {
    update, handleKey, setOn, isOn: () => on,
    isOpen: () => !menu.hidden || !slashBox.hidden,
    close: () => { const a = closeMenu(); const b = closeSlash(true); return a || b; },
    moveBlock, blockCmd,
    destroy() { gone = true; document.removeEventListener('pointerdown', outside, true); window.removeEventListener('scroll', onScroll, true); menu.remove(); slashBox.remove(); grip.remove(); line.remove(); },
  };
}
