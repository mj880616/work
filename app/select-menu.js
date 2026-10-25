// UI-모바일고르기칸: one app list for every drop-down <select> on the site. The phone's own picker (a big yellow box in the middle
// of the screen, big radio rows, dimmed page) never opens: a press on a closed select opens a small list right under it, as wide
// as the select, body-size text, tight rows, the chosen row bold with a check, no dimming, a press outside closes it.
// The <select> stays in the page as the single place the value lives: the list only sets its value and fires input + change, so
// forms and the screens' own change handlers keep working untouched, and selects drawn later (innerHTML repaints) need nothing:
// one delegated listener on the document covers them all. Opt out with data-native-select (none today). Date inputs are not
// selects and keep their calendar. The list sits above the bottom tab bar (and the switch bar over it), opens upward when there
// is no room below, scrolls inside itself when long, and Back closes it (one history entry, like the other anchored menus).
import {followAnchor} from './anchored-popup.js';

const KEY = 'kptuSelectMenu';

// ---- pure rules (unit-tested without a browser) ----

// The rows of a select in order: {type:'option', index, value, label, selected, disabled} and {type:'group', label}.
// A hidden option or group is not listed.
export function selectItems(select) {
  const out = [], current = select.selectedIndex;
  const push = (o, groupDisabled) => {
    if (o.hidden) return;
    out.push({type: 'option', index: o.index, value: o.value, label: String(o.label || o.textContent || '').trim() || '—', selected: o.index === current, disabled: !!(o.disabled || groupDisabled)});
  };
  for (const child of select.children) {
    if (child.tagName === 'OPTGROUP') {
      if (child.hidden) continue;
      out.push({type: 'group', label: String(child.label || '').trim()});
      for (const o of child.children) if (o.tagName === 'OPTION') push(o, child.disabled);
    } else if (child.tagName === 'OPTION') push(child, false);
  }
  return out;
}

const pickable = item => item?.type === 'option' && !item.disabled;

// Position in items of the row the list opens on: the chosen row when it can be chosen, else the first row that can; -1 if none.
export function startPosition(items) {
  const chosen = items.findIndex(x => pickable(x) && x.selected);
  return chosen >= 0 ? chosen : items.findIndex(pickable);
}

// Moves from a position to the next row that can be chosen in a direction (+1 / -1); stays when there is none (no wrap, like the
// native list). from -1 + 1 gives the first row.
export function stepPosition(items, from, dir) {
  for (let i = from + dir; i >= 0 && i < items.length; i += dir) if (pickable(items[i])) return i;
  return from;
}

export function edgePosition(items, dir) {
  return dir > 0 ? stepPosition(items, -1, 1) : stepPosition(items, items.length, -1);
}

// Type-ahead: the next row (after from, wrapping) whose label starts with the typed text. One repeated letter walks the rows
// that start with it; a longer text keeps the row it is on when that one still matches.
export function matchPosition(items, text, from) {
  const q = String(text || '').toLowerCase();
  if (!q) return -1;
  const same = q.length > 1 && [...q].every(c => c === q[0]), key = same ? q[0] : q;
  const startsAt = (same || q.length === 1) ? from + 1 : Math.max(from, 0);
  for (let n = 0; n < items.length; n++) {
    const i = (startsAt + n) % items.length;
    if (pickable(items[i]) && items[i].label.toLowerCase().startsWith(key)) return i;
  }
  return -1;
}

// Where the list goes. anchor: the select's box; view: the visible window {left, top, width, bottom}; inset: height at the bottom
// the list must not cover (tab bar, switch bar, safe area); contentH: the list's own full height. Same width as the select (never
// narrower than minWidth, never wider than the window), directly below it; above it when below has no room for the whole list
// and above has more; the height is capped at what the chosen side has (the list scrolls inside).
export function placeMenu({anchor, view, inset = 0, contentH, gap = 2, edge = 8, minWidth = 96, maxHeight = 320}) {
  const width = Math.max(0, Math.min(Math.max(anchor.width, minWidth), view.width - edge * 2));
  const left = Math.max(view.left + edge, Math.min(anchor.left, view.left + view.width - width - edge));
  const topLimit = view.top + edge, bottomLimit = view.bottom - inset - edge;
  const below = bottomLimit - anchor.bottom - gap, above = anchor.top - gap - topLimit;
  const side = below >= contentH || below >= above ? 'below' : 'above';
  const height = Math.max(0, Math.min(contentH, maxHeight, side === 'below' ? below : above));
  const top = side === 'below' ? anchor.bottom + gap : anchor.top - gap - height;
  return {side, left, top, width, height};
}

export function eligible(select) {
  return !!select && select.tagName === 'SELECT' && !select.multiple && !(select.size > 1) && !select.disabled && !select.hasAttribute('data-native-select');
}

// ---- the list ----

if (typeof document !== 'undefined' && !window.__KPTU_SELECT_MENU__) {
  window.__KPTU_SELECT_MENU__ = true;
  let active = null, closing = null, seq = 0, ahead = '', aheadTimer = 0;
  const panel = document.createElement('div');
  panel.className = 'kptu-select-menu'; panel.id = 'kptuSelectMenu'; panel.hidden = true; panel.tabIndex = -1; panel.setAttribute('role', 'listbox');
  let popover = typeof panel.showPopover === 'function' && typeof panel.hidePopover === 'function' && 'popover' in panel;
  if (popover) panel.setAttribute('popover', 'manual');
  // Probe: its height is the bottom space the list must stay above (CSS: tab bar + switch bar + safe area).
  const probe = document.createElement('div');
  probe.className = 'kptu-select-inset'; probe.setAttribute('aria-hidden', 'true');
  const mount = () => { document.body.append(panel, probe); };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount, {once: true});

  const nameOf = select => select.getAttribute('aria-label') || select.labels?.[0]?.textContent?.trim() || select.title || '';
  const optionEl = position => panel.querySelector(`[data-pos="${position}"]`);

  function place() {
    if (!active) return;
    const vv = window.visualViewport;
    const view = {left: vv?.offsetLeft || 0, top: vv?.offsetTop || 0, width: vv?.width || document.documentElement.clientWidth, bottom: Math.min(window.innerHeight, (vv?.offsetTop || 0) + (vv?.height || window.innerHeight))};
    const inset = probe.getBoundingClientRect().height || 0;
    panel.style.maxHeight = 'none'; panel.style.height = 'auto';
    const contentH = panel.scrollHeight + (panel.offsetHeight - panel.clientHeight);
    const r = active.select.getBoundingClientRect();
    const p = placeMenu({anchor: {left: r.left, top: r.top, bottom: r.bottom, width: r.width}, view, inset, contentH});
    Object.assign(panel.style, {left: p.left + 'px', top: p.top + 'px', width: p.width + 'px', height: p.height + 'px', maxHeight: p.height + 'px'});
    panel.dataset.side = p.side;
  }

  function mark(position, {scroll = true} = {}) {
    if (!active) return;
    panel.querySelector('.is-active')?.classList.remove('is-active');
    active.pos = position;
    const el = position >= 0 ? optionEl(position) : null;
    if (!el) { panel.removeAttribute('aria-activedescendant'); return; }
    el.classList.add('is-active'); panel.setAttribute('aria-activedescendant', el.id);
    if (scroll) el.scrollIntoView({block: 'nearest'});
  }

  function open(select) {
    if (!eligible(select) || !select.isConnected) return;
    if (closing) { closing.then(() => { if (select.isConnected) open(select); }); return; }
    if (active) { const same = active.select === select; close(same ? null : () => open(select)); return; }
    const items = selectItems(select);
    if (!items.some(pickable)) return;
    const id = ++seq, host = select.closest('dialog[open]') || document.body;
    if (panel.parentElement !== host) host.append(panel);
    panel.replaceChildren(...items.map((x, pos) => {
      const el = document.createElement('div');
      if (x.type === 'group') { el.className = 'kptu-select-group'; el.setAttribute('role', 'presentation'); el.textContent = x.label; return el; }
      el.className = 'kptu-select-opt'; el.id = `kptuSelectOpt${id}-${pos}`; el.dataset.pos = pos; el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', String(x.selected)); if (x.disabled) el.setAttribute('aria-disabled', 'true');
      el.textContent = x.label; el.title = x.label;
      return el;
    }));
    const label = nameOf(select);
    if (label) panel.setAttribute('aria-label', label); else panel.removeAttribute('aria-label');
    active = {select, id, items, pos: -1, stop: null};
    panel.hidden = false;
    if (popover) { try { panel.showPopover(); } catch { popover = false; panel.removeAttribute('popover'); } }
    select.setAttribute('aria-haspopup', 'listbox'); select.setAttribute('aria-expanded', 'true');
    place();
    mark(startPosition(items));
    active.stop = followAnchor(panel, select, {place, lost: () => close()});
    history.pushState({...history.state, [KEY]: id}, '', location.href);
    panel.focus({preventScroll: true});
  }

  function close(then, fromBack = false) {
    const cur = active;
    if (!cur) { if (then) { if (closing) closing.then(then); else then(); } return closing || Promise.resolve(); }
    active = null; cur.stop?.();
    if (popover) { try { panel.hidePopover(); } catch { /* already hidden */ } }
    panel.hidden = true; ahead = '';
    cur.select.setAttribute('aria-expanded', 'false');
    let release; const pending = new Promise(r => { release = r; }); closing = pending;
    const finish = () => queueMicrotask(() => {
      if (closing === pending) closing = null;
      release();
      if (then) then(); else if (cur.select.isConnected) cur.select.focus({preventScroll: true});
    });
    if (!fromBack && history.state?.[KEY] === cur.id) { window.addEventListener('popstate', finish, {once: true}); history.back(); } else finish();
    return pending;
  }

  function choose(position) {
    const cur = active, item = cur?.items[position];
    if (!pickable(item)) return;
    const select = cur.select, changed = select.selectedIndex !== item.index;
    close(() => {
      if (!select.isConnected) return;
      if (changed) {
        select.selectedIndex = item.index;
        select.dispatchEvent(new Event('input', {bubbles: true}));
        select.dispatchEvent(new Event('change', {bubbles: true}));
      }
      select.focus({preventScroll: true});
    });
  }

  // A press on a closed select: the phone's picker must not open (mousedown is where it starts, on a phone too).
  document.addEventListener('mousedown', e => {
    const select = e.target instanceof Element ? e.target.closest('select') : null;
    if (e.button !== 0 || !eligible(select)) return;
    e.preventDefault();
    if (document.activeElement !== select) select.focus({preventScroll: true});
  }, true);
  document.addEventListener('click', e => {
    const target = e.target instanceof Element ? e.target : null, select = target?.closest('select');
    if (active && !panel.contains(target) && !(select && select === active.select)) {
      // A press outside only closes the list; the press itself is then replayed on what was under it (a second select opens at once).
      const forward = new MouseEvent('click', e);
      e.preventDefault(); e.stopImmediatePropagation();
      close(() => { if (target?.isConnected) target.dispatchEvent(forward); });
      return;
    }
    if (!eligible(select)) return;
    e.preventDefault();
    open(select);
  }, true);

  panel.addEventListener('click', e => {
    const el = e.target instanceof Element ? e.target.closest('.kptu-select-opt') : null;
    if (el) choose(Number(el.dataset.pos));
  });
  panel.addEventListener('mousemove', e => {
    const el = e.target instanceof Element ? e.target.closest('.kptu-select-opt') : null;
    if (el && active && Number(el.dataset.pos) !== active.pos) mark(Number(el.dataset.pos), {scroll: false});
  });
  // Keep focus (and a phone's keyboard) off the rows: a press on the list never moves focus away from it.
  panel.addEventListener('mousedown', e => e.preventDefault());

  document.addEventListener('keydown', e => {
    if (!active) {
      const select = e.target instanceof Element ? e.target.closest('select') : null;
      if (!eligible(select) || e.isComposing) return;
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'F4' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp'))) { e.preventDefault(); e.stopImmediatePropagation(); open(select); }
      return;
    }
    const {items} = active, stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    switch (e.key) {
      case 'Escape': stop(); close(); return;
      case 'Tab': stop(); close(); return;
      case 'ArrowDown': stop(); mark(stepPosition(items, active.pos, 1)); return;
      case 'ArrowUp': stop(); mark(stepPosition(items, active.pos, -1)); return;
      case 'Home': stop(); mark(edgePosition(items, 1)); return;
      case 'End': stop(); mark(edgePosition(items, -1)); return;
      case 'PageDown': case 'PageUp': {
        stop();
        const dir = e.key === 'PageDown' ? 1 : -1, rows = Math.max(1, Math.floor(panel.clientHeight / (optionEl(Math.max(active.pos, 0))?.offsetHeight || 32)) - 1);
        let p = active.pos; for (let n = 0; n < rows; n++) p = stepPosition(items, p, dir);
        mark(p); return;
      }
      case 'Enter': case ' ': stop(); choose(active.pos); return;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          stop(); clearTimeout(aheadTimer); ahead += e.key; aheadTimer = setTimeout(() => { ahead = ''; }, 700);
          const hit = matchPosition(items, ahead, active.pos);
          if (hit >= 0) mark(hit);
        }
    }
  }, true);

  // Back closes the list (its history entry is gone); any other history move while it is open does too.
  window.addEventListener('popstate', e => { if (active && e.state?.[KEY] !== active.id) close(null, true); }, true);
  // A repaint that removes or disables the select under an open list closes it.
  new MutationObserver(() => { if (active && (!active.select.isConnected || active.select.disabled)) close(); }).observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ['disabled']});
  window.KPTUSelectMenu = {open, close, get active() { return active; }};
}
