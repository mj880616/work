// ED③-창: the new write window (설계 docs/design/unified-editor.md 11.2). A whole-screen window around the new editor (ed-editor.js);
// the shell (head line, save icon, export sheet, phone bottom tabs, PC menu beside, back button, leave check) is the one md-editor.js has,
// with the letters box and the markdown buttons replaced by the editor. NOTHING opens it yet: the buttons still open the old window
// (md-editor.js) until each screen is moved over, one PR at a time (설계 11.4). Both windows can exist in the code; only one is open.
//
// openEdWindow({...}) → handle {ready, close({silent}), say(message), changed, closed, editor}. The window does not save by itself:
// it hands the opener's own save {value, text} (the saved form and the letters taken out of it) and the opener writes them.
//   title        — the window's name for screen readers (default 크게 쓰기)
//   doc          — the row's saved form {v:'ed1', doc} (null for a row written before this editor)
//   text         — the old letters, used when doc is null: converted with convert(text) → saved form (default plainToDocKeep: the letters
//                  and their line breaks come back unchanged when nothing is edited; 노트 passes its markdown conversion)
//   save         — {run({value, text, textOnly}) → Promise<{ok, message?}>, aria?}. ok closes the window (or says 저장했어요 with keepOpen).
//                  No save → no save icon (a read-only look is not the job of this window).
//   limit        — most letters of the taken-out text the opener's field holds (note 100000 · update 20000 · project record 500); 0 = none.
//                  Over it the window says so and does not call save. The saved form is also kept under 1 MiB (the database check).
//   textOnly     — the opener keeps letters only (연결 업데이트 요약): save gets value = null and the window says formats are not kept.
//   draft        — a new text: anything written counts as a change (an old row opened to edit counts only what the person changed).
//   keepOpen     — after a good save the window stays and says 저장했어요 (노트 큰 창).
//   placeholder, label — the editor's hint and accessible name.
//   onClose({saved, changed, value, text}) — when it closes (not when silent): saved = the last save is still the latest, changed = there
//                  are edits not saved, value/text = what was written, so the opener can keep an unsaved draft in this tab's memory.
// Opening and closing without a change never calls save (설계 결정 D). One check for "a big window is open": big-window-open.js.
import './enter-save.js';
import {createChoiceSheet} from './choice-sheet.js';
import {createDocEditor} from './ed-editor.js';
import {toTelegram, toHangul, toPlain} from './ed-text.mjs';
import {emptyDoc} from './ed-schema.mjs';
import {copyText} from './copy-text.js';
import {bigWindowOpen} from './big-window-open.js';
import {startDoc, isChanged, prepareSave} from './ed-window-model.mjs';

export {bigWindowOpen};
const ID = 'edWindow';
const WIDE = window.matchMedia('(min-width:1024px)');
const PHONE = window.matchMedia('(max-width:760px)');
// The app's tabs: the phone bottom tabs, and on wider screens the shell's own menu (side column or top row).
const NAV = '#appView>.app-nav';
const TABS = `.mobile-tabs button, ${NAV} :is(button, a[href])`;
const NAV_GAP = 12;
const STYLES = ['./choice-sheet.css', './ed-doc.css', './ed-window.css'];
const EXPORTS = [['telegram', '텔레그램용 복사'], ['hangul', '한글용 복사'], ['hwp', 'HWP 파일로 받기']];
const CLOSE_CHOICES = [['stay', '계속 쓰기'], ['close', '저장하지 않고 닫기']];
const SVG_NS = 'http://www.w3.org/2000/svg';

let current = null;
let exportSheet = null, closeSheet = null;

// The stylesheets are put in once (a screen's own list may have them already: matched by file name, not the full address).
function ensureStyles() {
  const have = new Set([...document.querySelectorAll('link[rel="stylesheet"]')].map(l => (l.getAttribute('href') || '').split('?')[0].split('/').at(-1)));
  const waits = [];
  for (const path of STYLES) {
    if (have.has(path.split('/').at(-1))) continue;
    waits.push(new Promise(resolve => {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = path; link.dataset.kptuViewStyle = '1';
      link.onload = () => resolve(true); link.onerror = () => resolve(false);
      document.head.append(link);
    }));
  }
  return Promise.all(waits);
}

function icon(d) {
  const svg = document.createElementNS(SVG_NS, 'svg'), path = document.createElementNS(SVG_NS, 'path');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  path.setAttribute('d', d); svg.append(path);
  return svg;
}
const shareIcon = () => icon('M12 3v12M7 8l5-5 5 5M5 13v7h14v-7');
const saveIconSvg = () => icon('M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 3v5h7V3M7 21v-7h10v7');

function button(label, data = {}, aria) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = label;
  for (const [k, v] of Object.entries(data)) if (v != null) b.dataset[k] = v;
  if (aria) b.setAttribute('aria-label', aria);
  return b;
}

function exportChoices() {
  exportSheet ||= createChoiceSheet({id: 'edwExportSheet', titleId: 'edwExportSheetTitle', historyKey: 'kptuEdwExport',
    canOpen: () => !!current, choices: async () => {},
    render: () => ({title: '내보내기', html: EXPORTS.map(([value, label]) => `<button type="button" class="home-choice-row" data-sheet-value="${value}">${label}</button>`).join('')}),
    onSelect: (kind, value) => current?.exportAs(value)});
  return exportSheet;
}
function closeChoices() {
  closeSheet ||= createChoiceSheet({id: 'edwCloseSheet', titleId: 'edwCloseSheetTitle', historyKey: 'kptuEdwClose',
    canOpen: () => !!current, choices: async () => {},
    render: () => ({title: '저장하지 않고 닫을까요?', html: CLOSE_CHOICES.map(([value, label]) => `<button type="button" class="home-choice-row" data-sheet-value="${value}">${label}</button>`).join('')}),
    onSelect: (kind, value) => current?.closeChoice(value)});
  return closeSheet;
}

export function openEdWindow({title = '크게 쓰기', doc = null, text = '', convert = null, save = null, limit = 0, textOnly = false, draft = false, keepOpen = false,
  placeholder = '', label = '본문', onClose = () => {}} = {}) {
  // One big window at a time: this one is replaced; the old window (md-editor.js) is never closed from here, the opener must not open both.
  current?.close({silent: true});
  if (bigWindowOpen()) return null;
  const trigger = document.activeElement;
  const start = startDoc({doc, text, convert});
  const shell = document.createElement('div');
  shell.className = 'modal ed-window'; shell.id = ID;
  shell.setAttribute('role', 'dialog'); shell.setAttribute('aria-modal', 'true'); shell.setAttribute('aria-labelledby', ID + 'Title');
  // Phone and desktop alike: the back button closes the window first (mobile-modal-history.js).
  shell.dataset.kptuHistoryAll = '1';

  const head = document.createElement('div'), name = document.createElement('h2');
  head.className = 'ed-window-head'; name.id = ID + 'Title'; name.textContent = title;
  const done = button('', {close: ID}, '닫기'), share = button('', {edwExport: ''}, '내보내기');
  const cross = document.createElement('span'); cross.setAttribute('aria-hidden', 'true'); cross.textContent = '×';
  done.append(cross); share.append(shareIcon());
  done.className = 'ed-window-icon ed-window-close'; share.className = 'ed-window-icon';
  share.setAttribute('aria-haspopup', 'dialog'); share.setAttribute('aria-expanded', 'false');
  const saveButton = save ? button('', {edwSave: ''}, save.aria || '저장') : null;
  // UI-엔터저장: Enter stays a new line; on PC Ctrl+Enter (Cmd+Enter) runs the save (enter-save.js).
  if (saveButton) { saveButton.className = 'ed-window-icon'; saveButton.append(saveIconSvg()); saveButton.dataset.enterSaveSubmit = 'nohint'; shell.dataset.enterSave = ''; }
  head.append(name, done, ...(saveButton ? [saveButton] : []), share);

  const body = document.createElement('div');
  body.className = 'ed-window-body';
  const note = document.createElement('p');
  note.className = 'ed-window-note'; note.textContent = '이 칸은 글자만 저장돼요. 굵게·색·표 같은 서식은 저장되지 않아요.'; note.hidden = !textOnly;
  const status = document.createElement('p');
  status.className = 'ed-window-status'; status.setAttribute('role', 'status');
  shell.append(head, body, note, status);

  let closed = false, saving = false, savedOnce = false, editor = null, baseline = JSON.stringify(start), asking = false, leavingTab = null, boxLayer = null;
  // A new text is compared with an empty page, an old row with what it was when it opened (the editor's own first value).
  const baseValue = () => draft ? emptyDoc() : baseline ? JSON.parse(baseline) : emptyDoc();
  const now = () => editor ? editor.getValue() : start;
  const changed = () => !!editor && isChanged(baseValue(), now());
  const say = message => { if (!closed) status.textContent = message || ''; };

  // 761px~: the app's own menu stays beside (side) or above (top) the window; the window takes only the rest.
  function placeBesideNav() {
    const nav = PHONE.matches ? null : document.querySelector(NAV);
    const box = nav?.getClientRects().length ? nav.getBoundingClientRect() : null;
    const side = box ? (WIDE.matches ? 'side' : 'top') : null;
    if (side) {
      shell.dataset.edNav = side;
      shell.style.setProperty('--ed-window-left', side === 'side' ? Math.ceil(box.right) + NAV_GAP + 'px' : '0px');
      shell.style.setProperty('--ed-window-top', side === 'top' ? Math.ceil(box.bottom) + 'px' : '0px');
    } else {
      delete shell.dataset.edNav;
      shell.style.removeProperty('--ed-window-left'); shell.style.removeProperty('--ed-window-top');
    }
    shell.setAttribute('aria-modal', String(!side));
  }
  const navSize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => placeBesideNav()) : null;
  const navEl = document.querySelector(NAV);
  if (navEl) navSize?.observe(navEl);

  // ── saving ──
  async function runSave() {
    if (!save || saving || closed || !editor) return;
    const value = editor.getValue();
    if (!isChanged(baseValue(), value)) {
      // Nothing was changed: nothing is written (설계 결정 D). A window that stays open says so; the others just close.
      if (keepOpen) say('바뀐 것이 없어요'); else close({saved: true});
      return;
    }
    const prep = prepareSave({value, limit, textOnly});
    if (!prep.ok) { say(prep.message); return; }
    saving = true; saveButton.disabled = true; say('저장 중…');
    let result;
    try { result = await save.run({value: prep.value, text: prep.text, textOnly}); } catch (error) { result = {ok: false, message: error?.message}; }
    saving = false;
    if (closed) return;
    saveButton.disabled = false;
    if (result?.ok && keepOpen) { baseline = JSON.stringify(value); savedOnce = true; say(result.message || '저장했어요'); if (draft) draft = false; }
    else if (result?.ok) { savedOnce = true; baseline = JSON.stringify(value); draft = false; close({saved: true}); }
    else say(result?.message || '저장하지 못했어요. 다시 눌러 주세요.');
  }

  // ── export ──
  async function exportAs(value) {
    if (closed || !editor) return;
    const doc1 = editor.getValue();
    if (value === 'telegram') {
      const ok = await copyText(toTelegram(doc1));
      say(ok ? '텔레그램용 글을 복사했어요. 텔레그램에 붙여 넣으세요.' : '복사하지 못했어요. 다시 눌러 주세요.');
    } else if (value === 'hangul') {
      const copy = toHangul(doc1);
      const ok = await copyText(copy.text, {html: copy.html});
      say(ok ? '한글용 글을 복사했어요. 한글에 붙여 넣으세요.' : '복사하지 못했어요. 다시 눌러 주세요.');
    } else {
      const found = EXPORTS.find(([v]) => v === value)?.[1];
      if (found) say(`${found}는 준비 중이에요.`);
    }
  }

  // ── leaving: the ✕ button, Escape, a bottom tab or the PC menu ──
  // UI-키보드하단바: a tab press closes the window first and then goes on as that tab (the window's own history entry steps back
  // before the tab moves). With changes not saved it asks first; the back button never asks (it hands the text to onClose).
  function leaveTo(tab) {
    if (closed) return;
    const waitBack = history.state?.kptuOverlay === ID;
    close();
    const go = () => { if (tab.isConnected) tab.click(); };
    if (waitBack) window.addEventListener('popstate', () => queueMicrotask(go), {once: true}); else go();
  }
  const askReturn = {setAttribute() {}, hidden: false, get isConnected() { return !closed && !asking; }, focus: () => editor?.focus()};
  function ask(tab = null) {
    leavingTab = tab;
    void closeChoices().open('close', askReturn, done);
  }
  function closeChoice(value) {
    const tab = leavingTab; leavingTab = null;
    if (value !== 'close' || closed) return;
    asking = true;
    // The sheet's own history entry steps back first, then the window's.
    void closeSheet.close().then(() => { if (tab) leaveTo(tab); else close(); });
  }
  function requestClose({fromBack = false} = {}) {
    if (closed) return;
    if (fromBack || saving || !changed()) { close(); return; }
    ask();
  }
  function onTab(e) {
    const tab = e.target.closest?.(TABS);
    if (!tab || closed) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (!saving && changed()) ask(tab); else leaveTo(tab);
  }
  // Capture on window runs before every document listener (the deferred-view loader stops a click for a view not loaded yet).
  window.addEventListener('click', onTab, true);

  shell.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !shell.contains(b)) return;
    if (b.hasAttribute('data-edw-export')) void exportChoices().open('export', share);
    else if (b.hasAttribute('data-edw-save')) void runSave();
    else if (b.dataset.close === ID) {
      // The app's shared [data-close] handler (team.js) would hide the window at once; this window decides (it may ask first).
      e.stopPropagation();
      requestClose({fromBack: shell.dataset.kptuHistoryClosing === 'pop'});
    }
  });
  // Escape with a small box open closes only the box (it must not reach the dialog's own Escape, which closes the window).
  shell.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !editor?.hasBox()) return;
    e.preventDefault(); e.stopPropagation();
    editor.closeBoxes(); editor.focus();
  }, true);
  const onWide = () => placeBesideNav();
  WIDE.addEventListener('change', onWide); PHONE.addEventListener('change', placeBesideNav); window.addEventListener('resize', placeBesideNav);

  // ── back button: the small boxes (글자색·표 크기·표 칸 메뉴 …) first, then the window ──
  // A box opened inside the editor takes one history entry (KPTURouter.layer, BUG-뒤로가기). Back closes only that box; the next Back
  // reaches the window's own entry. A box closed another way (a choice, a press outside) gives its entry back.
  function onBox(open) {
    if (closed) return;
    if (open) boxLayer ||= window.KPTURouter?.layer?.open('ed-window-box', {close: () => { boxLayer = null; editor?.closeBoxes(); return true; }}) || null;
    else if (boxLayer) { const layer = boxLayer; boxLayer = null; layer.close(); }
  }

  // ── close ──
  function close({silent = false, saved = false} = {}) {
    if (closed) return;
    closed = true;
    WIDE.removeEventListener('change', onWide); PHONE.removeEventListener('change', placeBesideNav); window.removeEventListener('resize', placeBesideNav);
    window.removeEventListener('click', onTab, true); navSize?.disconnect();
    if (share.getAttribute('aria-expanded') === 'true') exportSheet?.dismiss();
    if (leavingTab) { leavingTab = null; closeSheet?.dismiss(); }
    if (!asking && closeSheet && current === handle) closeSheet.dismiss();
    const value = now(), result = {saved: (saved || savedOnce) && !isChanged(baseValue(), value), changed: isChanged(baseValue(), value) && !!editor, value, text: toPlain(value)};
    if (boxLayer) { const layer = boxLayer; boxLayer = null; layer.close(); }
    shell.classList.add('hidden'); shell.setAttribute('aria-hidden', 'true');
    window.KPTUA11y?.dialog.deactivate?.(shell, {restoreFocus: false});
    document.documentElement.classList.remove('ed-window-open');
    if (current === handle) current = null;
    editor?.destroy(); editor = null;
    // Let mobile-modal-history see the hidden state (and step back) before the node goes.
    queueMicrotask(() => shell.remove());
    if (!silent) onClose(result);
    else if (trigger?.isConnected) trigger.focus?.({preventScroll: true});
  }

  const handle = {
    close, say, exportAs, closeChoice,
    get changed() { return changed(); }, get closed() { return closed; }, get editor() { return editor; }, get element() { return shell; },
    ready: null,
  };

  document.body.append(shell);
  document.documentElement.classList.add('ed-window-open');
  placeBesideNav();
  window.KPTUA11y?.dialog.activate?.(shell, {trigger, initialFocus: done, onRequestClose: () => { if (editor?.closeBoxes() || asking) return; requestClose(); },
    companions: () => PHONE.matches ? [] : document.querySelectorAll(`${NAV} :is(button, a[href]):not([disabled])`)});
  current = handle;
  handle.ready = (async () => {
    await ensureStyles();
    if (closed) return handle;
    const made = await createDocEditor({host: body, value: start, label, placeholder, onBox});
    if (closed) { made.destroy(); return handle; }
    editor = made;
    // The editor's own first value is the baseline (its cleaning may differ in small ways from the converted one), so opening alone is "not changed".
    baseline = JSON.stringify(editor.getValue());
    editor.focus();
    return handle;
  })();
  return handle;
}
