// UI-우클릭메뉴: on a PC (761px~) a right-click on a card or record opens that card's own ⋯ menu at the pointer. One central
// handler for every screen: it finds the card's ⋯ trigger (a button or <summary> that shows only "⋯"), presses it with the
// card's own handlers (so the items, order, focus and close behavior are exactly the ⋯ menu's), and keeps the menu where
// the pointer was instead of under the ⋯ (the trigger reports a pointer-sized box while its menu is open; the menu code
// already keeps its panel inside the window). The browser's own menu stays when the target is inside an input / textarea /
// select / contenteditable, on a link (<a href>), when text is selected, with Shift held, when the card has no visible ⋯, on a phone-width window,
// and for a touch long-press (no long-press menu this time).
(() => {
'use strict';
if (window.__KPTU_CONTEXT_MENU__) return;
window.__KPTU_CONTEXT_MENU__ = true;

const WIDE = window.matchMedia('(min-width:761px)');
const EDITABLE = 'input,textarea,select,[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]';
// A card is the smallest block around the pressed spot that holds exactly one ⋯; the climb never passes a screen, a dialog or
// the page, and gives up once the block holds more than one ⋯ (a list of cards, not a card).
const STOP = '.view-panel,.modal,[role="dialog"],main,body,html';
const MAX_DEPTH = 10;
// Page-level ⋯ buttons that belong to a toolbar, not to a card.
const NOT_CARD = '[data-basket-more]';
const EDGE = 8;

const isMore = el => el.textContent.trim() === '⋯';
const visible = el => !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !el.closest('[hidden],[inert]') && el.getClientRects().length > 0;
const moreTriggers = root => [...root.querySelectorAll('button,summary')].filter(el => isMore(el) && !el.matches(NOT_CARD) && visible(el));

function findTrigger(target) {
  let node = target instanceof Element ? target : target?.parentElement;
  if (!node || node.closest('[role="menu"],[popover]:popover-open')) return null;
  // The ⋯ itself (or something inside it) is its own card.
  const own = node.closest('button,summary');
  if (own && isMore(own) && !own.matches(NOT_CARD) && visible(own)) return own;
  for (let depth = 0; node && depth < MAX_DEPTH; depth++, node = node.parentElement) {
    if (node.matches(STOP)) return null;
    const found = moreTriggers(node);
    if (found.length > 1) return null;
    if (found.length === 1) return found[0];
  }
  return null;
}

let pinned = null; // { trigger, x, y, observer, timer }
function unpin() {
  if (!pinned) return;
  const { trigger, observer, timer } = pinned;
  pinned = null;
  clearTimeout(timer);
  observer.disconnect();
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
function closeDetails(focusBack) {
  if (!openDetails) return;
  const { details, summary, panel, off } = openDetails;
  openDetails = null;
  off();
  for (const key of ['position', 'left', 'top', 'right', 'bottom', 'maxHeight', 'overflowY']) panel?.style.removeProperty(key.replace(/[A-Z]/g, m => '-' + m.toLowerCase()));
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
  // A link (<a href>) keeps the browser's own menu (open in a new tab, copy link address).
  if (target.closest('a[href]')) return;
  const selection = window.getSelection?.();
  if (selection && !selection.isCollapsed && selection.toString().trim() !== '') return;
  const trigger = findTrigger(target);
  if (!trigger) return;
  // A right-click inside the already open context details menu keeps the browser's own menu.
  if (openDetails?.details.contains(target)) return;
  e.preventDefault();
  const rect = trigger.getBoundingClientRect();
  const x = e.clientX || rect.left, y = e.clientY || rect.bottom;
  if (trigger.tagName === 'SUMMARY') { openSummary(trigger, x, y); return; }
  closeDetails(false);
  if (trigger.getAttribute('aria-expanded') === 'true' && pinned?.trigger === trigger) {
    // Already open from a right-click: move it to the new pointer spot (the menu code re-places itself on resize).
    pinned.x = x; pinned.y = y; window.dispatchEvent(new Event('resize'));
    return;
  }
  pin(trigger, x, y);
  trigger.click();
});
})();
