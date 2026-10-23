// ED-서식줄묶음 / MD-서식줄묶음: the toolbar popover rule that two editors share (the doc editor app/ed-editor.js and the markdown
// editor app/md-editor.js). A choice box opens right under the button that was pressed, over the text (the text does not move);
// it stays inside the visible screen (moved left at the right edge, above the button when there is no room below, its own list
// scrolls when neither fits; a phone's bottom bar is kept clear); it closes on a press outside or Esc; it follows its button
// when the page, the screen or the sideways button row moves. A button that sits inside a popover (a phone's grouped row:
// 글자 ▾ → 글자색 ▾) opens its own popover under itself while the popover that holds it stays open.
// The editor owns the panels (elements) and the buttons; this module only opens, closes and places them.
//   panels: {name: element}   order: every name, in the order they are shown/hidden   triggerOf(name): the button that opens it
//   bar: the element that holds the buttons and the popovers (a press inside it does not count as "outside")
//   root: the editor's own element (Esc from outside it still closes)   scrollers: elements whose sideways scroll moves the buttons
//   isPop(name): true for a floating box (default: every panel); in-flow rows are only shown and hidden
//   onOpen(name): called after the panels were shown/hidden and before they are placed (the editor fills a box, repaints state)
export function createToolbarPops({panels, order, triggerOf, bar, root = bar, scrollers = [], isPop = () => true, onOpen = () => {}}) {
  let openName = null;
  // The panel a panel's own button sits in (a group popover or the [⌄] row), or null when the button is on the row.
  const hostOf = name => {
    const parent = triggerOf(name)?.parentElement;
    return order.find(k => panels[k] === parent) || null;
  };
  function place(name) {
    const pop = panels[name], trigger = triggerOf(name);
    if (!pop || !isPop(name) || pop.hidden || !trigger) return;
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
  // The open popover and the ones that hold its button, outermost first (a popover is placed under a button that may sit in another).
  function placeOpen() {
    if (!openName) return;
    const chain = [openName];
    for (let h = hostOf(openName); h && !chain.includes(h); h = hostOf(h)) chain.unshift(h);
    for (const n of chain) place(n);
  }
  function open(name) {
    const was = openName;
    // The panels that hold the pressed panel's button stay open.
    const hosts = new Set();
    for (let h = name && hostOf(name); h && !hosts.has(h); h = hostOf(h)) hosts.add(h);
    for (const key of order) {
      const on = key === name || hosts.has(key);
      panels[key].hidden = !on;
      triggerOf(key)?.setAttribute('aria-expanded', String(on));
    }
    openName = name || null;
    onOpen(openName, was);
    if (name) placeOpen();
    return was;
  }
  const close = () => open(null);
  // A second press on the same button goes back to the panel that holds it (or closes).
  const toggle = name => open(openName === name ? hostOf(name) : name);
  // A press anywhere outside the button row and its popovers (the text included) closes the open one.
  const outside = e => { if (openName && !bar.contains(e.target)) close(); };
  // Esc closes it even when the focus is not in the text box or on a button.
  const escape = e => { if (e.key === 'Escape' && openName && !root.contains(e.target)) close(); };
  const follow = e => { if (openName && !(e && e.target && e.target.closest && e.target.closest('[data-tb-pop]'))) placeOpen(); };
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', escape);
  window.addEventListener('scroll', follow, true);
  window.addEventListener('resize', follow);
  window.visualViewport?.addEventListener('resize', follow);
  window.visualViewport?.addEventListener('scroll', follow);
  for (const el of scrollers) el.addEventListener('scroll', follow);
  return {
    open, close, toggle, hostOf, place: placeOpen,
    get name() { return openName; },
    destroy() {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
      window.visualViewport?.removeEventListener('resize', follow);
      window.visualViewport?.removeEventListener('scroll', follow);
      for (const el of scrollers) el.removeEventListener('scroll', follow);
    },
  };
}

// The phone's grouped row, shared by both editors. A group is [key, label, aria, itemKeys]; order lists the row's keys (a group's key
// stands for its button). Moving is done with the same nodes, so a button keeps its command, state and listeners wherever it is.
//   home: the row as it is wider than a phone (array of nodes)   buttons: {key: node}   panels: {groupKey: popover element}
// Returns {group(), ungroup()}; the caller adds what is its own (labels, the [⌄] button, repainting).
//   tail, home: an array, or a function returning one when it changes (a file button that comes and goes)
export function createGrouping({tools, tail = [], home, order, groups, buttons, panels, keepHome = () => {}}) {
  const list = v => (typeof v === 'function' ? v() : v);
  return {
    group() {
      tools.replaceChildren(...order.map(k => buttons[k]).filter(Boolean), ...list(tail));
      for (const [key, , , items] of groups) panels[key].replaceChildren(...items.map(k => buttons[k]).filter(Boolean));
    },
    ungroup() {
      tools.replaceChildren(...list(home), ...list(tail));
      for (const [key] of groups) panels[key].replaceChildren();
      keepHome();
    },
  };
}
