// UI-떠있는저장: the one floating [저장] for long write panels on the page (일기 쓰기, 노트 고치기, 업데이트 고치기).
// Owner: this module draws exactly one button (#floatSave) and nothing else draws a floating save. A panel only says which
// button is its own [저장] (watchFloatSave(() => button)); the floating button calls that button's click(), so the panel's
// own save function runs (never a second copy of it) and a disabled/busy original stays disabled here too.
// Shown only when (a) the original [저장] is not fully on screen above the bottom tabs / [달력|할 일|업무일지|일기] line, and
// (b) the phone keyboard is closed. The keyboard judgement is the app's one detector (accessibility-dialog.js →
// body.kptu-mobile-keyboard and the kptu:keyboard-change event); there is no second detector here.
// The bottom edge sits above the tabs and the switch line by the same CSS variables the toast uses (ui-standard.css),
// so what "hidden under the bars" means is measured from this button's own spot, not from copied numbers.
const GAP = 8;
const getters = new Set();
let node = null, current = null, frame = 0, wired = false;

function ensure() {
  if (node?.isConnected) return node;
  node = document.createElement('button');
  node.type = 'button'; node.id = 'floatSave'; node.className = 'float-save'; node.textContent = '저장';
  node.dataset.on = 'false'; node.setAttribute('inert', '');
  node.addEventListener('click', () => {
    const original = current;
    if (original?.isConnected && !original.disabled) original.click();
  });
  document.body.append(node);
  return node;
}

function original() {
  for (const get of getters) {
    let button = null;
    try { button = get(); } catch { button = null; }
    if (button?.isConnected && button.getClientRects().length) return button;
  }
  return null;
}

function update() {
  frame = 0;
  const target = original();
  if (!target) { if (node) show(false); return; }
  const float = ensure();
  current = target;
  float.disabled = !!target.disabled || target.getAttribute('aria-busy') === 'true';
  const keyboard = document.body.classList.contains('kptu-mobile-keyboard');
  // The floating button is always laid out (only visibility changes), so its own bottom edge tells where the bars end.
  const limit = float.getBoundingClientRect().bottom + GAP;
  const box = target.getBoundingClientRect();
  const seen = box.top >= 0 && box.bottom <= limit;
  show(!keyboard && !seen);
}

function show(on) {
  if (!node) return;
  node.dataset.on = on ? 'true' : 'false';
  node.toggleAttribute('inert', !on);
}

export function refreshFloatSave() {
  if (!frame) frame = requestAnimationFrame(update);
}

function wire() {
  if (wired) return; wired = true;
  window.addEventListener('scroll', refreshFloatSave, {capture: true, passive: true});
  window.addEventListener('resize', refreshFloatSave);
  window.addEventListener('kptu:keyboard-change', refreshFloatSave);
  window.addEventListener('kptu:dialog-opened', refreshFloatSave);
  window.addEventListener('kptu:dialog-closed', refreshFloatSave);
  document.addEventListener('input', refreshFloatSave, true);
  window.visualViewport?.addEventListener('resize', refreshFloatSave);
  window.visualViewport?.addEventListener('scroll', refreshFloatSave);
  // The page grows or shrinks when the panel opens, text is added or photos come in.
  if (typeof ResizeObserver === 'function') new ResizeObserver(refreshFloatSave).observe(document.documentElement);
}

// getButton returns the panel's own [저장] (or null while it is not drawn). Returns a function that stops watching.
export function watchFloatSave(getButton) {
  getters.add(getButton); wire(); refreshFloatSave();
  return () => { getters.delete(getButton); refreshFloatSave(); };
}
