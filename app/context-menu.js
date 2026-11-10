// UI-우클릭메뉴 / UI-우클릭전수: on a PC (761px~) a right-click on a card, record or detail opens that screen's own ⋯ menu at the
// pointer. One central handler for every screen: it finds the ⋯ trigger (a button or <summary> that shows only "⋯"), presses it
// with its own handlers (so the items, order, focus and close behavior are exactly the ⋯ menu's), and keeps the menu where
// the pointer was instead of under the ⋯ (the trigger reports a pointer-sized box while its menu is open; the menu code
// already keeps its panel inside the window; a panel that a stylesheet pins under the ⋯ is moved to the pointer here).
// One optional mark on a ⋯ trigger, data-ctx: "area" = this ⋯ is the menu of the whole detail / column around it (a right-click
// anywhere in that area that is not inside a card with its own ⋯ opens it, even when the area also holds cards with their own ⋯);
// "off" = a toolbar / toggle ⋯ that is not a card menu (right-click never presses it); "screen" = the screen's own head-line ⋯
// (UI-우클릭빈곳전수: its new / view items) — never a card's menu, but a right-click on a blank spot of that screen (inside its
// .view-panel, not inside a dialog, where no card or area ⋯ answers) opens it. The browser's own menu stays when the target is inside an input / textarea /
// select / contenteditable, on a link (<a href>), when text is selected, with Shift held, when the card has no visible ⋯, on a phone-width window,
// and for a touch long-press (no long-press menu this time).
(() => {
'use strict';
if (window.__KPTU_CONTEXT_MENU__) return;
window.__KPTU_CONTEXT_MENU__ = true;

const WIDE = window.matchMedia('(min-width:761px)');
const EDITABLE = 'input,textarea,select,[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]';
// A card is the smallest block around the pressed spot that holds exactly one ⋯; the climb never passes a screen, a dialog or
// the page, and gives up once the block holds more than one ⋯ (a list of cards, not a card) unless one of them is area-marked.
const STOP = '.view-panel,.modal,[role="dialog"],main,body,html';
const AREA = '[data-ctx="area"]';
const MAX_DEPTH = 10;
// Page-level ⋯ buttons that belong to a toolbar, not to a card.
const NOT_CARD = '[data-basket-more],[data-ctx="off"],[data-ctx="screen"]';
const SCREEN = '[data-ctx="screen"]';
const EDGE = 8;

const isMore = el => { const t = el.textContent.trim(); return t === '⋯' || t === '⋮'; };
const visible = el => !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !el.closest('[hidden],[inert]') && el.getClientRects().length > 0;
// UI-PC손맛묶음 ①: a ⋯ inside a dialog / modal (a PC docked pane included — the 사업 보고 result pane is the report dialog seated in
// the screen) belongs to that dialog only: a press outside it (the week line's [‹][›], the weekly table) never opens its menu.
const DIALOG = '.modal,[role="dialog"]';
const inSameDialog = (el, root) => { const box = el.parentElement?.closest(DIALOG); return !box || box.contains(root); };
const moreTriggers = root => [...root.querySelectorAll('button,summary')].filter(el => isMore(el) && !el.matches(NOT_CARD) && visible(el) && inSameDialog(el, root));

// Among several ⋯ in one block, only a single area-marked one is the block's own menu.
const pickAmong = list => {
  if (list.length === 1) return list[0];
  const area = list.filter(el => el.matches(AREA));
  return area.length === 1 ? area[0] : null;
};
// MTG-우클릭안됨(11/09): inside an area (the block around the press that holds an area-marked ⋯ — a detail or a dialog, a PC
// docked pane included) a list row's ⋯ answers only for a press inside that row, and a block that holds several row ⋯ is a
// list, not a card, so the climb goes on to the area ⋯ instead of giving up (a press on a long result body above a list of
// follow-up tasks or files opened the browser menu, or with one row the row's menu). A row is the ⋯'s nearest line-like
// ancestor inside that area; a ⋯ with no such row keeps the old rule. Screens without an area ⋯ keep the old rule as is.
const ROW = 'li,tr,[role="listitem"],[role="row"],article,.gt-row,.file-line,[data-ctx-row]';
function areaHostOf(node) {
  for (let n = node; n; n = n.parentElement) {
    if (moreTriggers(n).some(el => el.matches(AREA))) return n;
    if (n.matches(STOP)) return null;
  }
  return null;
}
const rowHolds = (el, target, host) => {
  const row = el.parentElement?.closest(ROW);
  return !row || row === host || !host.contains(row) || row.contains(target);
};
function findTrigger(target) {
  let node = target instanceof Element ? target : target?.parentElement;
  if (!node || node.closest('[role="menu"],[popover]:popover-open')) return null;
  // The ⋯ itself (or something inside it) is its own card.
  const own = node.closest('button,summary');
  if (own && isMore(own) && !own.matches(NOT_CARD) && visible(own)) return own;
  const host = areaHostOf(node);
  let listOnly = false;
  for (let depth = 0; node; depth++, node = node.parentElement) {
    // A screen / dialog / the page is never itself a card: only an area-marked ⋯ (a detail or dialog menu) may answer here.
    if (node.matches(STOP)) return pickAmong(moreTriggers(node).filter(el => el.matches(AREA)));
    // Close to the pressed spot any ⋯ can be the card's; farther up (past a card's usual depth) only an area-marked one.
    let found = moreTriggers(node).filter(el => el.matches(AREA) || (!listOnly && depth < MAX_DEPTH));
    if (host) found = found.filter(el => el.matches(AREA) || rowHolds(el, target, host));
    if (!found.length) continue;
    const pick = pickAmong(found);
    if (pick || !host) return pick;
    listOnly = true; // several row ⋯ around the press inside an area: a list, keep climbing to the area ⋯
  }
  return null;
}
// UI-우클릭빈곳전수: no card / area ⋯ answered — a blank spot of a screen opens that screen's own head-line ⋯ (one per screen).
function screenTrigger(target) {
  const node = target instanceof Element ? target : target?.parentElement;
  if (!node || node.closest('.modal,[role="dialog"],[role="menu"],[popover]')) return null;
  const panel = node.closest('.view-panel');
  if (!panel) return null;
  const list = [...panel.querySelectorAll(SCREEN)].filter(el => isMore(el) && visible(el));
  return list.length === 1 ? list[0] : null;
}

let pinned = null; // { trigger, x, y, observer, timer, panel, panelObserver }
function unpin() {
  if (!pinned) return;
  const { trigger, observer, timer, panel, panelObserver } = pinned;
  pinned = null;
  clearTimeout(timer);
  observer.disconnect();
  panelObserver?.disconnect();
  if (panel) resetPanel(panel);
  delete trigger.getBoundingClientRect;
}
// While pinned, the trigger measures as a box at the pointer: left edge at x, as wide as its menu, no height.
function pin(trigger, x, y) {
  if (pinned?.trigger === trigger) { pinned.x = x; pinned.y = y; return; }
  unpin();
  const state = { trigger, x, y, observer: null, timer: 0 };
  const menuWidth = () => {
    const panel = document.getElementById(trigger.getAttribute('aria-controls') || '');
    return parseFloat(panel?.style.width) || panel?.getBoundingClientRect().width || 200;
  };
  trigger.getBoundingClientRect = () => {
    const w = menuWidth(), left = state.x, top = state.y;
    return { x: left, y: top, left, top, right: left + w, bottom: top, width: w, height: 0, toJSON() { return this; } };
  };
  // Once the menu has opened and then closes, the trigger goes back to its real box.
  let opened = false;
  state.observer = new MutationObserver(() => {
    const open = trigger.getAttribute('aria-expanded') === 'true';
    if (open) opened = true; else if (opened) unpin();
  });
  state.observer.observe(trigger, { attributes: true, attributeFilter: ['aria-expanded'] });
  // A menu that never opened (nothing to show, or a menu that does not report aria-expanded) must not keep the pinned box.
  state.timer = setTimeout(() => { if (pinned === state && trigger.getAttribute('aria-expanded') !== 'true') unpin(); }, 600);
  pinned = state;
}

// <details><summary>⋯</summary><panel>…</panel></details> menus are placed by CSS under the ⋯; opened from a right-click the
// panel is placed at the pointer (inside the window) and closes on Esc or an outside press, like the button menus.
let openDetails = null; // { details, summary, panel, off }
function resetPanel(panel) {
  for (const key of ['position', 'left', 'top', 'right', 'bottom', 'maxHeight', 'overflowY']) panel.style.removeProperty(key.replace(/[A-Z]/g, m => '-' + m.toLowerCase()));
  delete panel.dataset.scrollBelow;
}
function closeDetails(focusBack) {
  if (!openDetails) return;
  const { details, summary, panel, off } = openDetails;
  openDetails = null;
  off();
  if (panel) resetPanel(panel);
  if (details.open) details.open = false;
  if (focusBack && summary.isConnected) summary.focus({ preventScroll: true });
}
function placeDetails(panel, x, y) {
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  Object.assign(panel.style, { position: 'fixed', right: 'auto', bottom: 'auto', left: x + 'px', top: y + 'px', maxHeight: Math.max(0, vh - EDGE * 2) + 'px', overflowY: 'auto' });
  const r = panel.getBoundingClientRect();
  const left = Math.max(EDGE, Math.min(x, vw - r.width - EDGE));
  const top = Math.max(EDGE, y + r.height > vh - EDGE ? Math.min(y - r.height, vh - r.height - EDGE) : y);
  // Measure again so a transformed ancestor (which would make "fixed" relative to itself) cannot shift the panel.
  panel.style.left = left + 'px'; panel.style.top = top + 'px';
  const at = panel.getBoundingClientRect();
  if (Math.abs(at.left - left) > 0.5) panel.style.left = left + (left - at.left) + 'px';
  if (Math.abs(at.top - top) > 0.5) panel.style.top = top + (top - at.top) + 'px';
  // UI-메뉴잘림: 창보다 길 때만 아래 흐림으로 '더 있음'(anchored-popup.js markScrollMore와 같은 표시, data-scroll-below → base-ui.css).
  const more = () => { if (panel.scrollHeight - panel.clientHeight > 1 && panel.scrollTop + panel.clientHeight < panel.scrollHeight - 1) panel.dataset.scrollBelow = '1'; else delete panel.dataset.scrollBelow; };
  if (!panel.dataset.scrollBelowBound) { panel.dataset.scrollBelowBound = '1'; panel.addEventListener('scroll', more, { passive: true }); }
  more();
}
// A button menu whose panel a stylesheet pins under the ⋯ (position absolute, no left / top set by the menu's own code) is moved to
// the pointer the same way. A panel the menu code places itself (fixed, or with an inline left / top) already follows the pinned box.
const panelOf = trigger => {
  const byId = document.getElementById(trigger.getAttribute('aria-controls') || '');
  if (byId) return byId;
  const next = trigger.nextElementSibling;
  return next?.matches('[role="menu"],[role="group"]') ? next : null;
};
function placeStylePanel(trigger, x, y) {
  if (pinned?.trigger !== trigger) return;
  const panel = panelOf(trigger);
  if (!panel || panel.getClientRects().length === 0 || panel.style.left || panel.style.top || getComputedStyle(panel).position === 'fixed') return;
  placeDetails(panel, x, y);
  clearTimeout(pinned.timer);
  pinned.panel = panel;
  // The panel closes by its own code (hidden / class); then it goes back to its stylesheet place.
  pinned.panelObserver = new MutationObserver(() => { if (panel.getClientRects().length === 0) unpin(); });
  pinned.panelObserver.observe(panel, { attributes: true, attributeFilter: ['hidden', 'class'] });
}
function openSummary(summary, x, y) {
  const details = summary.parentElement;
  if (!(details instanceof HTMLDetailsElement)) return false;
  const panel = [...details.children].find(el => el !== summary);
  if (!panel) return false;
  closeDetails(false);
  details.open = true;
  placeDetails(panel, x, y);
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeDetails(true); } };
  const onDown = e => { if (!details.contains(e.target)) closeDetails(false); };
  const onToggle = () => { if (!details.open) closeDetails(false); };
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onDown, true);
  details.addEventListener('toggle', onToggle);
  const off = () => {
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onDown, true);
    details.removeEventListener('toggle', onToggle);
  };
  openDetails = { details, summary, panel, off };
  panel.querySelector('button:not([disabled])')?.focus({ preventScroll: true });
  return true;
}

document.addEventListener('contextmenu', e => {
  if (e.defaultPrevented || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
  if (!WIDE.matches || e.pointerType === 'touch') return;
  const target = e.target instanceof Element ? e.target : null;
  if (!target || target.closest(EDITABLE)) return;
  const selection = window.getSelection?.();
  if (selection && !selection.isCollapsed && selection.toString().trim() !== '') return;
  const trigger = findTrigger(target) || screenTrigger(target);
  if (!trigger) return;
  // A link (<a href>) inside the card keeps the browser's own menu (open in a new tab, copy link address). A card's own
  // "open" line (a link that sits next to its ⋯ in the same row, e.g. a project record line) is the card itself, not a link
  // in its text, so it still opens the ⋯ menu.
  const link = target.closest('a[href]');
  if (link && !link.parentElement?.contains(trigger)) return;
  // A right-click inside the already open context details menu keeps the browser's own menu.
  if (openDetails?.details.contains(target)) return;
  e.preventDefault();
  const rect = trigger.getBoundingClientRect();
  const x = e.clientX || rect.left, y = e.clientY || rect.bottom;
  if (trigger.tagName === 'SUMMARY') { openSummary(trigger, x, y); return; }
  closeDetails(false);
  if (pinned?.trigger === trigger && (trigger.getAttribute('aria-expanded') === 'true' || pinned.panel)) {
    // Already open from a right-click: move it to the new pointer spot (the menu code re-places itself on resize).
    pinned.x = x; pinned.y = y;
    if (pinned.panel) placeDetails(pinned.panel, x, y); else window.dispatchEvent(new Event('resize'));
    return;
  }
  openAt(trigger, x, y);
});
// Presses a ⋯ trigger with its own handlers and keeps its menu at (x, y) — the right-click path above, and other screens whose
// spot has no ⋯ of its own but means one (UI-PC손맛묶음 S56-52: a diary calendar day opens that day's detail ⋯).
function openAt(trigger, x, y) {
  if (trigger.tagName === 'SUMMARY') return openSummary(trigger, x, y);
  closeDetails(false);
  pin(trigger, x, y);
  trigger.click();
  placeStylePanel(trigger, x, y);
  return true;
}
// UI-PC손맛묶음 ③ (PC widths only): a mouse drag that selects text (to copy a line of 잊지 말기 / 할 일 / 조직 보고 and the like) ends in a click on
// the line it started on; that click must not open the line. One rule for every screen: a click that ends a mouse drag of 5px or
// more while text is selected does nothing (the selection stays for copying). A plain click, a touch tap, a keyboard press, a press
// inside an input / editable text or on a link keeps its own behavior.
let dragFrom = null;
window.addEventListener('pointerdown', e => { dragFrom = e.pointerType === 'mouse' && e.button === 0 ? { x: e.clientX, y: e.clientY } : null; }, true);
window.addEventListener('click', e => {
  const from = dragFrom; dragFrom = null;
  if (!from || !WIDE.matches || e.detail === 0 || Math.hypot(e.clientX - from.x, e.clientY - from.y) < 5) return;
  const target = e.target instanceof Element ? e.target : null;
  if (!target || target.closest(EDITABLE + ',a[href],label')) return;
  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed || selection.toString().trim() === '') return;
  // Only the line whose own text is selected (a pull / swipe that happens to select text elsewhere keeps its click).
  if (!selection.containsNode(target, true) && !target.contains(selection.anchorNode)) return;
  e.preventDefault(); e.stopImmediatePropagation();
}, true);
// UI-PC손맛묶음 ④: a button that shows only a picture or a sign (⋯ × ‹ › + an icon) gets its name (aria-label) as the mouse hover
// tip on a PC, so every such button in every screen says what it does. Set once, on the first hover, only where the button has no
// tip of its own; buttons with words, touch and phone widths are left as they are.
const tipSeen = new WeakSet();
const ICON_ONLY = el => !/[\p{L}\p{N}]/u.test(el.textContent || '');
window.addEventListener('pointerover', e => {
  if (e.pointerType !== 'mouse' || !WIDE.matches) return;
  const el = e.target instanceof Element ? e.target.closest('button,summary,[role="button"]') : null;
  if (!el || tipSeen.has(el) || el.hasAttribute('title')) return;
  tipSeen.add(el);
  const name = (el.getAttribute('aria-label') || '').trim();
  if (name && ICON_ONLY(el)) el.title = name;
}, true);
// Other screens' own right-click menus (the calendar's event menu) pin their trigger at the pointer with the same box.
window.KPTUContextMenu = { pinAt: pin, unpin, openAt };
})();
