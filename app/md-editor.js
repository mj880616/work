// MD-편집기: 전체 화면 마크다운 편집기(바구니 메모 [크게 쓰기], 이후 일지·노트에서 재사용).
// UI-키보드하단바: 위에서부터 머리줄 한 줄 [× 닫기] [메모|노트] [쓰기|미리보기] … [공유 = 내보내기] [저장] → 서식 도구줄 → 본문.
// 폰에서는 그 아래 앱 공용 하단 탭이 보이고(자판이 열리면 accessibility-dialog.js의 공용 자판 상태가 탭을 숨김), 탭을 누르면
// 이 모듈이 편집기를 먼저 닫고 그 탭으로 보낸다. [저장]이 있는 쓰기 창에 글이 있으면 먼저 "저장 안 하고 닫을까요?"를 묻는다.
// UI-쓰기창PC탭유지: 넓은 화면(761px~)에서는 앱 탭(1024px~ 왼쪽 세로 메뉴, 761~1023px 위쪽 한 줄 메뉴 = `#appView>.app-nav`)이
// 그대로 보이고, 편집기는 그 메뉴를 뺀 본문 자리에서만 연다(placeBesideNav가 메뉴 위치를 재서 --md-editor-left/top 두 값만 정함).
// 메뉴를 누르는 동작은 폰 하단 탭과 같은 한 가지 규칙(onTab)이고, Tab 키는 편집기 → 메뉴 → 편집기 순서로 돈다.
// 이 화면은 이 모듈 하나가 그린다. 여는 쪽은 글과 콜백만 넘기고, 저장은 여는 쪽의 기존 흐름이 맡는다(이 모듈은 저장하지 않는다).
// 도구 막대는 선택한 글을 감싸거나 줄 앞에 기호를 넣는 마크다운 편집이며, 바꾸기는 execCommand('insertText')로 해
// 브라우저 기본 되돌리기(Ctrl+Z·[되돌리기])에 그대로 남는다. 미리보기는 공용 markdown-view.js(정화·외부 요청 0)를 쓴다.
import {renderMarkdownInto, preloadMarkdown} from './markdown-view.js';
import {applyAction, MERMAID_TEMPLATES, CALLOUT_KINDS} from './md-editor-ops.mjs';
import {toTelegram} from './md-telegram.mjs';
import {toHangul} from './md-hangul.mjs';
import {createChoiceSheet} from './choice-sheet.js';

const ID = 'mdEditor';
const WIDE = window.matchMedia('(min-width:1024px)');
const PHONE = window.matchMedia('(max-width:760px)');
// The app's tabs: the phone bottom tabs, and on wider screens the shell's own menu (side column or top row).
const NAV = '#appView>.app-nav';
const TABS = `.mobile-tabs button, ${NAV} :is(button, a[href])`;
const NAV_GAP = 12;
// [label, action, option, aria] — option groups open a second row of choices.
const TOOLS = [
  ['제목', 'heading-menu', null, '제목 단계 고르기'],
  ['굵게', 'bold'], ['기울임', 'italic'],
  ['• 목록', 'bullet', null, '글머리 목록'], ['1. 번호', 'number', null, '번호 목록'], ['☐ 체크', 'task', null, '체크 목록'],
  ['표', 'table', null, '표 틀 넣기'], ['인용', 'quote'], ['코드', 'code'],
  ['강조 상자', 'callout-menu', null, '강조 상자 종류 고르기'], ['구분선', 'rule'],
  ['도식', 'mermaid-menu', null, 'Mermaid 도식 틀 고르기'],
  ['↶ 되돌리기', 'undo', null, '되돌리기'], ['↷ 다시하기', 'redo', null, '다시하기'],
];
const MENUS = {
  'heading-menu': [['제목 1', 'heading', '1'], ['제목 2', 'heading', '2'], ['제목 3', 'heading', '3']],
  'callout-menu': CALLOUT_KINDS.map(([kind, label]) => [label, 'callout', kind]),
  'mermaid-menu': Object.entries(MERMAID_TEMPLATES).map(([kind, t]) => [t.label, 'mermaid', kind]),
};

let current = null;

// MD-내보내기: [내보내기] opens the app's shared bottom choice sheet. ① 텔레그램 and ② 한글(8-11a) copy; the HWP row is
// listed now and says it is not ready yet when pressed (8-11b connects it); it is not disabled so the press can explain itself.
const EXPORTS = [['telegram', '텔레그램용 복사'], ['hangul', '한글용 복사'], ['hwp', 'HWP 파일로 받기']];
let exportSheet = null, leaveSheet = null;
// UI-키보드하단바: the same shared sheet asks before a bottom tab leaves a write window that has text.
const LEAVE_CHOICES = [['stay', '계속 쓰기'], ['leave', '저장 안 하고 이동']];
function leaveChoices() {
  leaveSheet ||= createChoiceSheet({id:'mdLeaveSheet', titleId:'mdLeaveSheetTitle', historyKey:'kptuMdLeave',
    canOpen:() => !!current, choices:async () => {},
    render:() => ({title:'저장 안 하고 닫을까요?', html:LEAVE_CHOICES.map(([value, label]) => `<button type="button" class="home-choice-row" data-sheet-value="${value}">${label}</button>`).join('')}),
    onSelect:(kind, value) => current?.leaveChoice(value)});
  return leaveSheet;
}
// Share icon (an arrow out of a tray), built with DOM calls: the module never writes HTML. The namespace is a name, not a request.
const SVG_NS = 'http://www.w3.org/2000/svg';
function shareIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg'), path = document.createElementNS(SVG_NS, 'path');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  path.setAttribute('d', 'M12 3v12M7 8l5-5 5 5M5 13v7h14v-7');
  svg.append(path);
  return svg;
}
function exportChoices() {
  exportSheet ||= createChoiceSheet({id:'mdExportSheet', titleId:'mdExportSheetTitle', historyKey:'kptuMdExport',
    canOpen:() => !!current, choices:async () => {},
    render:() => ({title:'내보내기', html:EXPORTS.map(([value, label]) => `<button type="button" class="home-choice-row" data-sheet-value="${value}">${label}</button>`).join('')}),
    onSelect:(kind, value) => current?.exportAs(value)});
  return exportSheet;
}

function button(label, data = {}, aria) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = label;
  for (const [k, v] of Object.entries(data)) if (v != null) b.dataset[k] = v;
  if (aria) b.setAttribute('aria-label', aria);
  return b;
}

// Also used by the note read view's [텔레그램용 복사]. With html (8-11a [한글용 복사]) the clipboard gets both kinds:
// text/html for programs that read formatting (한글 keeps bold and makes a real table) and text/plain for the rest.
export async function copyText(text, {html = null} = {}) {
  try {
    if (html == null) await navigator.clipboard.writeText(text);
    else await navigator.clipboard.write([new ClipboardItem({'text/html': new Blob([html], {type: 'text/html'}), 'text/plain': new Blob([text], {type: 'text/plain'})})]);
    return true;
  } catch {}
  // Older WebViews: a hidden read-only text field and the copy command; with html the copy event carries both kinds.
  const area = document.createElement('textarea');
  area.value = text; area.setAttribute('readonly', ''); area.className = 'a11y-only';
  const both = e => {
    if (!e.clipboardData) return;
    e.clipboardData.setData('text/plain', text); e.clipboardData.setData('text/html', html); e.preventDefault();
  };
  if (html != null) document.addEventListener('copy', both, true);
  document.body.append(area); area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  document.removeEventListener('copy', both, true);
  area.remove();
  return ok;
}

// Opens the editor over the whole screen. text: the starting text. onInput(text): every change (optional).
// onClose(text): when it closes, with the final text; the opener puts it back into its own field.
// save (optional, UI-디자인손질 8 메뉴 [쓰기]): {label, aria, run(text)} adds a filled [저장]; run is the opener's own
// existing save and resolves {ok:true} (the editor then closes) or {ok:false, message}. [닫기] stays the plain close.
// kinds (optional, MD-내보내기 메뉴 [쓰기]): {label, value, options:[[value, label], …]} shows a small switch at the left of
// the head; the chosen value is passed to save.run(text, kind), and save.aria may be a function of it.
// Returns {close({silent})}: silent closes without calling onClose (e.g. the opener's screen went away).
export function openMarkdownEditor({text = '', title = '크게 쓰기', onInput = null, onClose = () => {}, save = null, kinds = null} = {}) {
  current?.close({silent: true});
  const trigger = document.activeElement;
  const shell = document.createElement('div');
  shell.className = 'modal md-editor'; shell.id = ID;
  shell.setAttribute('role', 'dialog'); shell.setAttribute('aria-modal', 'true'); shell.setAttribute('aria-labelledby', ID + 'Title');
  // Phone and desktop alike: the back button closes the editor first (mobile-modal-history.js).
  shell.dataset.kptuHistoryAll = '1';

  const head = document.createElement('div'), name = document.createElement('h2');
  head.className = 'md-editor-head'; name.id = ID + 'Title'; name.textContent = title;
  // Icon buttons keep their names for screen readers (닫기·내보내기); the glyphs are hidden from them.
  const copy = button('', {mdExport: ''}, '내보내기'), done = button('', {close: ID}, save ? '저장하지 않고 닫기' : '닫고 수정 칸으로 돌아가기');
  const cross = document.createElement('span'); cross.setAttribute('aria-hidden', 'true'); cross.textContent = '×';
  copy.append(shareIcon()); done.append(cross);
  copy.className = 'md-editor-icon'; done.className = 'md-editor-icon md-editor-close';
  copy.setAttribute('aria-haspopup', 'dialog'); copy.setAttribute('aria-expanded', 'false');
  let kind = kinds?.value ?? null;
  const saveAria = () => typeof save?.aria === 'function' ? save.aria(kind) : save?.aria;
  const saveButton = save ? button(save.label || '저장', {mdSave: ''}, saveAria()) : null;
  if (saveButton) { saveButton.className = 'primary'; shell.dataset.mdSave = ''; }
  const kindGroup = kinds ? document.createElement('div') : null;
  if (kindGroup) {
    kindGroup.className = 'md-editor-kinds'; kindGroup.setAttribute('role', 'group'); kindGroup.setAttribute('aria-label', kinds.label || '종류');
    kindGroup.append(...kinds.options.map(([value, label]) => button(label, {mdKind: value})));
    shell.dataset.mdKinds = '';
  }
  function setKind(next) {
    kind = next;
    kindGroup?.querySelectorAll('[data-md-kind]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mdKind === kind)));
    if (saveButton && saveAria()) saveButton.setAttribute('aria-label', saveAria());
  }
  setKind(kind);
  const modes = document.createElement('div');
  modes.className = 'md-editor-modes'; modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', '보기');
  const writeTab = button('쓰기', {mdMode: 'write'}), previewTab = button('미리보기', {mdMode: 'preview'});
  modes.append(writeTab, previewTab);
  head.append(name, done, ...(kindGroup ? [kindGroup] : []), modes, copy, ...(saveButton ? [saveButton] : []));

  const tools = document.createElement('div'), menu = document.createElement('div');
  tools.className = 'md-editor-tools'; tools.setAttribute('role', 'toolbar'); tools.setAttribute('aria-label', '서식');
  menu.className = 'md-editor-menu'; menu.hidden = true; menu.setAttribute('role', 'group');
  for (const [label, action, option, aria] of TOOLS) {
    const b = button(label, {mdAction: action, mdOption: option}, aria);
    if (MENUS[action]) b.setAttribute('aria-expanded', 'false');
    tools.append(b);
  }

  const panes = document.createElement('div'), area = document.createElement('textarea'), preview = document.createElement('div');
  panes.className = 'md-editor-panes';
  area.className = 'md-editor-text'; area.value = text; area.spellcheck = false;
  area.setAttribute('aria-label', '마크다운 원문');
  preview.className = 'md-editor-preview'; preview.setAttribute('role', 'region'); preview.setAttribute('aria-label', '미리보기'); preview.tabIndex = 0;
  panes.append(area, preview);
  const status = document.createElement('p');
  status.className = 'md-editor-status'; status.setAttribute('role', 'status');
  const bar = document.createElement('div');
  // The format row sits right under the head; a choice row (제목·강조 상자·도식) opens under it.
  bar.className = 'md-editor-bar'; bar.append(tools, menu);
  shell.append(head, bar, panes, status);

  let mode = 'write', openMenu = null, timer = 0, closed = false, shown = null, saving = false;
  const previewing = () => WIDE.matches || mode === 'preview';
  // 761px~: the app's own menu stays beside (side) or above (top) the editor; the editor takes only the rest. One
  // function measures it for open, resize, and the menu's own size changes. With the menu in use the dialog is not modal.
  function placeBesideNav() {
    const nav = PHONE.matches ? null : document.querySelector(NAV);
    const box = nav?.getClientRects().length ? nav.getBoundingClientRect() : null;
    const side = box ? (WIDE.matches ? 'side' : 'top') : null;
    if (side) {
      shell.dataset.mdNav = side;
      shell.style.setProperty('--md-editor-left', side === 'side' ? Math.ceil(box.right) + NAV_GAP + 'px' : '0px');
      shell.style.setProperty('--md-editor-top', side === 'top' ? Math.ceil(box.bottom) + 'px' : '0px');
    } else {
      delete shell.dataset.mdNav;
      shell.style.removeProperty('--md-editor-left'); shell.style.removeProperty('--md-editor-top');
    }
    shell.setAttribute('aria-modal', String(!side));
  }
  const navSize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => placeBesideNav()) : null;
  const navEl = document.querySelector(NAV);
  if (navEl) navSize?.observe(navEl);
  function paintPreview() {
    clearTimeout(timer); timer = 0;
    if (!previewing() || shown === area.value) return;
    shown = area.value;
    if (!area.value.trim()) { preview.classList.remove('md-body'); preview.textContent = '미리 볼 글이 없어요.'; return; }
    void renderMarkdownInto(preview, area.value, {isCurrent: () => !closed}).then(r => { if (!r.ok && !closed && !r.stale) { shown = null; preview.textContent = area.value; } });
  }
  function schedule() { if (previewing()) { clearTimeout(timer); timer = setTimeout(paintPreview, 300); } }
  function setMode(next, {focus = true} = {}) {
    mode = next;
    shell.dataset.mdMode = next;
    writeTab.setAttribute('aria-pressed', String(next === 'write'));
    previewTab.setAttribute('aria-pressed', String(next === 'preview'));
    if (next === 'preview' || WIDE.matches) paintPreview();
    if (focus && !WIDE.matches) (next === 'write' ? area : previewTab).focus();
  }
  function setMenu(action) {
    openMenu = openMenu === action ? null : action;
    tools.querySelectorAll('[aria-expanded]').forEach(b => b.setAttribute('aria-expanded', String(b.dataset.mdAction === openMenu)));
    menu.replaceChildren(...(openMenu ? MENUS[openMenu].map(([label, a, o]) => button(label, {mdAction: a, mdOption: o})) : []));
    menu.hidden = !openMenu;
    if (openMenu) menu.setAttribute('aria-label', tools.querySelector(`[data-md-action="${openMenu}"]`).getAttribute('aria-label'));
  }
  function replace(from, to, insert) {
    area.focus();
    area.setSelectionRange(from, to);
    // insertText keeps the change in the browser's own undo history; setRangeText is only a fallback.
    let ok = false;
    try { ok = insert ? document.execCommand('insertText', false, insert) : (from === to || document.execCommand('delete')); } catch {}
    if (!ok || area.value.slice(from, from + insert.length) !== insert) {
      area.setRangeText(insert, from, to, 'end');
      area.dispatchEvent(new Event('input', {bubbles: true}));
    }
  }
  function run(action, option) {
    if (MENUS[action]) { setMenu(action); return; }
    if (openMenu) setMenu(null);
    if (mode === 'preview' && !WIDE.matches) setMode('write', {focus: false});
    if (action === 'undo' || action === 'redo') { area.focus(); try { document.execCommand(action); } catch {} return; }
    const r = applyAction(area.value, area.selectionStart, area.selectionEnd, action, option);
    replace(r.from, r.to, r.insert);
    area.setSelectionRange(r.selStart, r.selEnd);
  }
  async function runSave() {
    if (!save || saving || closed) return;
    saving = true; saveButton.disabled = true; status.textContent = '저장 중…';
    let result;
    try { result = await save.run(area.value, kind); } catch (error) { result = {ok: false, message: error?.message}; }
    saving = false;
    if (closed) return;
    saveButton.disabled = false;
    if (result?.ok) close();
    else status.textContent = result?.message || '저장하지 못했어요. 다시 눌러 주세요.';
  }
  async function telegram() {
    const ok = await copyText(toTelegram(area.value));
    if (closed) return;
    status.textContent = ok ? '텔레그램용 글을 복사했어요. 텔레그램에 붙여 넣으세요.' : '복사하지 못했어요. 다시 눌러 주세요.';
  }
  // 8-11a: the 노조 문서 numbering (docs/hwp-style-map.md) with bold and tables; the text itself is not reworded.
  async function hangul() {
    const copy = toHangul(area.value);
    const ok = await copyText(copy.text, {html: copy.html});
    if (closed) return;
    status.textContent = ok ? '한글용 글을 복사했어요. 한글에 붙여 넣으세요.' : '복사하지 못했어요. 다시 눌러 주세요.';
  }
  function exportAs(value) {
    if (closed) return;
    if (value === 'telegram') { void telegram(); return; }
    if (value === 'hangul') { void hangul(); return; }
    const label = EXPORTS.find(([v]) => v === value)?.[1];
    if (label) status.textContent = `${label}는 준비 중이에요.`;
  }

  // Toolbar presses must not take focus from the text: the selection stays and the phone keyboard stays open.
  bar.addEventListener('pointerdown', e => { if (e.target.closest('button') && document.activeElement === area) e.preventDefault(); });
  shell.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !shell.contains(b)) return;
    if (b.dataset.mdAction) run(b.dataset.mdAction, b.dataset.mdOption);
    else if (b.dataset.mdMode) setMode(b.dataset.mdMode);
    else if (b.dataset.mdKind) setKind(b.dataset.mdKind);
    else if (b.hasAttribute('data-md-export')) void exportChoices().open('export', copy);
    else if (b.hasAttribute('data-md-save')) void runSave();
    else if (b.dataset.close === ID) close();
  });
  area.addEventListener('input', () => { status.textContent = ''; onInput?.(area.value); schedule(); });
  shell.addEventListener('keydown', e => {
    if (e.key === 'Escape' && openMenu) { e.preventDefault(); e.stopPropagation(); setMenu(null); return; }
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.target !== area) return;
    const key = e.key.toLowerCase();
    if (key === 'b' || key === 'i') { e.preventDefault(); run(key === 'b' ? 'bold' : 'italic'); }
  });
  // UI-키보드하단바: a bottom tab press closes the editor first and then goes on as that tab (the editor's own history
  // entry steps back before the tab moves, as the menu [쓰기] hands a saved note to the basket). A write window
  // with text asks first; an editor opened to change a memo or note hands its text back to the opener, whose own
  // leave check (unsaved edit) then runs as before.
  function leaveTo(tab) {
    if (closed) return;
    const waitBack = history.state?.kptuOverlay === ID;
    close();
    const go = () => { if (tab.isConnected) tab.click(); };
    if (waitBack) window.addEventListener('popstate', () => queueMicrotask(go), {once: true}); else go();
  }
  let leavingTab = null, leaving = false;
  // The sheet hands focus back to its trigger; here that is the text, so [계속 쓰기] goes straight back to writing.
  const leaveReturn = {setAttribute() {}, hidden: false, get isConnected() { return !closed && !leaving; }, focus: () => area.focus({preventScroll: true})};
  function onTab(e) {
    const tab = e.target.closest?.(TABS);
    if (!tab || closed) return;
    e.preventDefault(); e.stopImmediatePropagation();
    // [쓰기] in the wide menu while the write window is already open: just go on writing.
    if (save && tab.hasAttribute('data-menu-write')) { area.focus({preventScroll: true}); return; }
    if (save && area.value.trim()) { leavingTab = tab; void leaveChoices().open('leave', leaveReturn); }
    else leaveTo(tab);
  }
  function leaveChoice(value) {
    const tab = leavingTab; leavingTab = null;
    if (value !== 'leave' || !tab || closed) return;
    leaving = true;
    // Let the sheet's own history entry step back first, then the editor's.
    void leaveSheet.close().then(() => leaveTo(tab));
  }
  // window capture runs before every document listener (the deferred-view loader stops a click for a view not loaded yet).
  window.addEventListener('click', onTab, true);
  const onWide = () => { shell.dataset.mdWide = String(WIDE.matches); placeBesideNav(); if (WIDE.matches) paintPreview(); };
  WIDE.addEventListener('change', onWide);
  PHONE.addEventListener('change', placeBesideNav);
  window.addEventListener('resize', placeBesideNav);

  // Closing by button or Escape gives the text back; the back button arrives as a [닫기] click.
  function close({silent = false} = {}) {
    if (closed) return;
    closed = true; clearTimeout(timer); WIDE.removeEventListener('change', onWide); window.removeEventListener('click', onTab, true);
    PHONE.removeEventListener('change', placeBesideNav); window.removeEventListener('resize', placeBesideNav); navSize?.disconnect();
    if (copy.getAttribute('aria-expanded') === 'true') exportSheet?.dismiss();
    if (leavingTab) { leavingTab = null; leaveSheet?.dismiss(); }
    const value = area.value;
    shell.classList.add('hidden'); shell.setAttribute('aria-hidden', 'true');
    window.KPTUA11y?.dialog.deactivate?.(shell, {restoreFocus: false});
    document.documentElement.classList.remove('md-editor-open');
    if (current === handle) current = null;
    // Let mobile-modal-history see the hidden state (and step back) before the node goes.
    queueMicrotask(() => shell.remove());
    if (!silent) onClose(value);
    else if (trigger?.isConnected) trigger.focus?.({preventScroll: true});
  }
  const handle = {close, exportAs, leaveChoice, get text() { return area.value; }};

  document.body.append(shell);
  document.documentElement.classList.add('md-editor-open');
  onWide(); setMode('write', {focus: false});
  // companions: the wide menu is part of the Tab cycle (editor → menu → editor); on a phone there is none.
  window.KPTUA11y?.dialog.activate?.(shell, {trigger, initialFocus: area, onRequestClose: () => close(),
    companions: () => PHONE.matches ? [] : document.querySelectorAll(`${NAV} :is(button, a[href]):not([disabled])`)});
  area.focus({preventScroll: true});
  area.setSelectionRange(area.value.length, area.value.length);
  area.scrollTop = area.scrollHeight;
  void preloadMarkdown();
  current = handle;
  return handle;
}
