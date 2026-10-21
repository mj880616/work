// MD-편집기: 전체 화면 마크다운 편집기(바구니 메모 [크게 쓰기], 이후 일지·노트에서 재사용).
// UI-키보드하단바: 위에서부터 머리줄 한 줄 [× 닫기] [저장 아이콘] [업데이트 ▾|노트] [쓰기|미리보기] … [공유 = 내보내기] → 서식 도구줄 → 본문.
// BASKET-업데이트통합 PR 2: 저장은 어느 창이든 × 바로 옆 저장 아이콘 하나(UI-노트편집버튼 ②, PR 742)이고, 누르면 저장하고 닫는다.
// 폰에서는 그 아래 앱 공용 하단 탭이 보이고(자판이 열리면 accessibility-dialog.js의 공용 자판 상태가 탭을 숨김), 탭을 누르면
// 이 모듈이 편집기를 먼저 닫고 그 탭으로 보낸다. 새 글 창(draft)에 글이 있으면 먼저 "저장 안 하고 닫을까요?"를 묻는다.
// UI-쓰기창PC탭유지: 넓은 화면(761px~)에서는 앱 탭(1024px~ 왼쪽 세로 메뉴, 761~1023px 위쪽 한 줄 메뉴 = `#appView>.app-nav`)이
// 그대로 보이고, 편집기는 그 메뉴를 뺀 본문 자리에서만 연다(placeBesideNav가 메뉴 위치를 재서 --md-editor-left/top 두 값만 정함).
// 메뉴를 누르는 동작은 폰 하단 탭과 같은 한 가지 규칙(onTab)이고, Tab 키는 편집기 → 메뉴 → 편집기 순서로 돈다.
// 이 화면은 이 모듈 하나가 그린다. 여는 쪽은 글과 콜백만 넘기고, 저장은 여는 쪽의 기존 흐름이 맡는다(이 모듈은 저장하지 않는다).
// 도구 막대는 선택한 글을 감싸거나 줄 앞에 기호를 넣는 마크다운 편집이며, 바꾸기는 execCommand('insertText')로 해
// 브라우저 기본 되돌리기(Ctrl+Z·[되돌리기])에 그대로 남는다. 미리보기는 공용 markdown-view.js(정화·외부 요청 0)를 쓴다.
import './enter-save.js'; // UI-엔터저장: shared Enter-to-save rule for the data-enter-save roots below
import {renderMarkdownInto, preloadMarkdown} from './markdown-view.js';
import {applyAction, applyPlainAction, PLAIN_ACTIONS, MERMAID_TEMPLATES, CALLOUT_KINDS} from './md-editor-ops.mjs';
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
// NOTE-큰창저장유지: a window that stays open after saving (keepOpen) asks once before ✕ closes it with changes not saved.
const CLOSE_CHOICES = [['stay', '계속 쓰기'], ['close', '저장하지 않고 닫기']];
let closeSheet = null, markdownSheet = null;
function closeChoices() {
  closeSheet ||= createChoiceSheet({id:'mdCloseSheet', titleId:'mdCloseSheetTitle', historyKey:'kptuMdClose',
    canOpen:() => !!current, choices:async () => {},
    render:() => ({title:'저장하지 않고 닫을까요?', html:CLOSE_CHOICES.map(([value, label]) => `<button type="button" class="home-choice-row" data-sheet-value="${value}">${label}</button>`).join('')}),
    onSelect:(kind, value) => current?.closeChoice(value)});
  return closeSheet;
}
// NOTE-마크다운선택: with 마크다운 off, a button that needs markdown (제목·굵게·표 …) asks to turn it on first.
const MARKDOWN_CHOICES = [['on', '마크다운 켜고 적용'], ['off', '그대로 두기']];
function markdownChoices() {
  markdownSheet ||= createChoiceSheet({id:'mdMarkdownSheet', titleId:'mdMarkdownSheetTitle', historyKey:'kptuMdMarkdown',
    canOpen:() => !!current, choices:async () => {},
    render:() => ({title:'마크다운을 켤까요?', html:MARKDOWN_CHOICES.map(([value, label]) => `<button type="button" class="home-choice-row" data-sheet-value="${value}">${label}</button>`).join('')}),
    onSelect:(kind, value) => current?.markdownChoice(value)});
  return markdownSheet;
}
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
// Save icon (a floppy disk), also built with DOM calls.
function saveIconSvg() {
  const svg = document.createElementNS(SVG_NS, 'svg'), path = document.createElementNS(SVG_NS, 'path');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  path.setAttribute('d', 'M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 3v5h7V3M7 21v-7h10v7');
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
// save (optional): {run(text, kind), aria} adds the one save icon right beside [닫기] (UI-노트편집버튼 ②, BASKET-업데이트통합).
// run is the opener's own existing save and resolves {ok:true} (the editor then closes: 저장하고 닫기) or {ok:false, message}
// (the editor stays and shows the message). aria may be a function of the chosen kind.
// draft (optional): a window for a new text (menu [쓰기], 노트 [+]). Leaving it by a tab with text asks first; a window opened
// on an existing field (memo·note edit, the home input) hands its text back instead.
// kinds (optional): {label, value, options:[[value, label], …], text(value)?, menu?:{value, aria(), open(trigger)}} shows the
// [업데이트 ▾|노트] switch right of the save icon. The chosen value goes to save.run(text, kind). text(value) relabels an option
// (the chosen place's name); menu adds a ▾ right after that option that opens the opener's own choice sheet.
// placeholder (optional): (kind) => the text box placeholder.
// noteTitle (optional): {kind, label, placeholder} shows a one-line title box under the head while that kind is chosen; its
// value goes to save.run as the third argument ({title}).
// attach (optional, UI-크게첨부): {mount({picker, files, drop}), show?(kind)} adds a row under the text for choosing files. The
// opener mounts its own existing file part there (basket-upload.js mountBasketPicker) and keeps the files; this module only gives
// the places. show(kind) hides the row for a kind that takes no files. inTools(kind) (NOTE-파일붙이기): the [📎 첨부] button goes
// at the end of the format button row instead (the chosen files stay listed under the text). pending() (optional): the number of
// chosen files not saved yet; with keepOpen they count as a change (✕ asks once).
// markdown (optional, NOTE-마크다운선택): {value, show?(kind), onChange?(on)} adds a [☐ 마크다운] box at the start of the format row.
// Off: the text is shown and saved as written — one wide text box, no preview, and the format buttons that work with letters
// alone (• 목록·1. 번호·☐ 체크·구분선) put those letters in; the others ask to turn markdown on first. show(kind) hides the box for a
// kind that is always markdown (업데이트); hidden means on. The choice goes to save.run as the third argument ({markdown}).
// keepOpen (optional, NOTE-큰창저장유지): a successful save keeps the window and says 저장했어요; ✕ (or Escape) with changes not
// saved since then asks once. onClose then gets (text, {saved, markdown}): saved is true when nothing changed after the last save.
// Returns {close({silent}), paint(), kind}: silent closes without calling onClose; paint() redraws labels after the opener's
// state (the chosen place) changed.
export function openMarkdownEditor({text = '', title = '크게 쓰기', onInput = null, onClose = () => {}, save = null, draft = false, kinds = null, placeholder = null, noteTitle = null, attach = null, markdown = null, keepOpen = false} = {}) {
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
  const copy = button('', {mdExport: ''}, '내보내기'), done = button('', {close: ID}, draft ? '저장하지 않고 닫기' : '닫고 수정 칸으로 돌아가기');
  const cross = document.createElement('span'); cross.setAttribute('aria-hidden', 'true'); cross.textContent = '×';
  copy.append(shareIcon()); done.append(cross);
  copy.className = 'md-editor-icon'; done.className = 'md-editor-icon md-editor-close';
  copy.setAttribute('aria-haspopup', 'dialog'); copy.setAttribute('aria-expanded', 'false');
  let kind = kinds?.value ?? null;
  const saveAria = () => (typeof save?.aria === 'function' ? save.aria(kind) : save?.aria) || '저장';
  const saveButton = save ? button('', {mdSaveIcon: ''}, saveAria()) : null;
  // UI-엔터저장: the big editor keeps Enter as a new line; on PC Ctrl+Enter (Cmd+Enter) runs its existing save (enter-save.js).
  if (saveButton) { saveButton.className = 'md-editor-icon'; saveButton.append(saveIconSvg()); saveButton.dataset.enterSaveSubmit = 'nohint'; shell.dataset.enterSave = ''; }
  const kindGroup = kinds ? document.createElement('div') : null;
  const kindMenu = kinds?.menu ? button('▾', {mdKindMenu: kinds.menu.value}) : null;
  if (kindMenu) { kindMenu.setAttribute('aria-haspopup', 'dialog'); kindMenu.setAttribute('aria-expanded', 'false'); }
  if (kindGroup) {
    kindGroup.className = 'md-editor-kinds'; kindGroup.setAttribute('role', 'group'); kindGroup.setAttribute('aria-label', kinds.label || '종류');
    for (const [value, label] of kinds.options) {
      kindGroup.append(button(label, {mdKind: value}));
      if (kindMenu && value === kinds.menu.value) kindGroup.append(kindMenu);
    }
    shell.dataset.mdKinds = '';
  }
  function paint() {
    kindGroup?.querySelectorAll('[data-md-kind]').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.mdKind === kind));
      const label = kinds.text?.(b.dataset.mdKind) || kinds.options.find(([v]) => v === b.dataset.mdKind)[1];
      if (b.textContent !== label) b.textContent = label;
      b.title = label;
    });
    if (kindMenu) { kindMenu.setAttribute('aria-pressed', String(kind === kinds.menu.value)); kindMenu.setAttribute('aria-label', kinds.menu.aria?.() || '선택'); }
    if (saveButton) saveButton.setAttribute('aria-label', saveAria());
    const hint = placeholder?.(kind);
    if (hint != null) area.placeholder = hint;
    if (titleRow) titleRow.hidden = kind !== noteTitle.kind;
    if (attachRow) {
      const shown = attach.show ? !!attach.show(kind) : true, inTools = shown && !!attach.inTools?.(kind);
      if (inTools && pickerHost.parentNode !== tools) tools.append(pickerHost);
      else if (!inTools && pickerHost.parentNode !== attachRow) attachRow.prepend(pickerHost);
      attachRow.hidden = !shown; pickerHost.hidden = !shown; attachRow.toggleAttribute('data-md-attach-in-tools', inTools);
    }
    if (mdRow) { mdRow.hidden = !markdownShown(); paintPlain(); }
  }
  function setKind(next) { if (next !== kind) status.textContent = ''; kind = next; paint(); }
  const modes = document.createElement('div');
  modes.className = 'md-editor-modes'; modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', '보기');
  const writeTab = button('쓰기', {mdMode: 'write'}), previewTab = button('미리보기', {mdMode: 'preview'});
  modes.append(writeTab, previewTab);
  head.append(name, done, ...(saveButton ? [saveButton] : []), ...(kindGroup ? [kindGroup] : []), modes, copy);

  // The [마크다운] box (markdown option): a real checkbox, so keyboard and screen readers work as usual.
  const mdRow = markdown ? document.createElement('label') : null, mdBox = markdown ? document.createElement('input') : null;
  if (mdRow) {
    mdRow.className = 'md-editor-md';
    mdBox.type = 'checkbox'; mdBox.dataset.mdMarkdown = ''; mdBox.checked = !!markdown.value;
    const caption = document.createElement('span'); caption.textContent = '마크다운';
    mdRow.append(mdBox, caption);
  }
  const markdownShown = () => !!mdRow && (markdown.show ? !!markdown.show(kind) : true);
  const isPlain = () => markdownShown() && !mdBox.checked;
  const markdownValue = () => !mdRow ? null : markdownShown() ? mdBox.checked : true;
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
  // The note title box (write window [노트]): one line, under the head; empty means the first line of the text.
  const titleRow = noteTitle ? document.createElement('label') : null, titleBox = noteTitle ? document.createElement('input') : null;
  if (titleRow) {
    titleRow.className = 'md-editor-title';
    const caption = document.createElement('span'); caption.className = 'a11y-only'; caption.textContent = noteTitle.label || '제목';
    titleBox.type = 'text'; titleBox.autocomplete = 'off'; titleBox.dataset.mdTitle = ''; titleBox.placeholder = noteTitle.placeholder || '';
    titleBox.setAttribute('enterkeyhint', 'next');
    titleBox.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); area.focus(); } });
    titleRow.append(caption, titleBox);
  }
  const status = document.createElement('p');
  status.className = 'md-editor-status'; status.setAttribute('role', 'status');
  // The file row (attach): [📎 첨부] and the chosen files, right under the text.
  const attachRow = attach ? document.createElement('div') : null, pickerHost = attach ? document.createElement('div') : null;
  if (attachRow) {
    attachRow.className = 'md-editor-attach';
    const files = document.createElement('div');
    pickerHost.dataset.mdAttachPicker = ''; files.dataset.mdAttachFiles = '';
    attachRow.append(pickerHost, files);
  }
  const bar = document.createElement('div'), toolRow = document.createElement('div');
  // The format row sits right under the head ([마크다운] box first, then the buttons); a choice row (제목·강조 상자·도식) opens under it.
  toolRow.className = 'md-editor-toolrow'; toolRow.append(...(mdRow ? [mdRow] : []), tools);
  bar.className = 'md-editor-bar'; bar.append(toolRow, menu);
  shell.append(head, ...(titleRow ? [titleRow] : []), bar, panes, ...(attachRow ? [attachRow] : []), status);

  let mode = 'write', openMenu = null, timer = 0, closed = false, shown = null, saving = false, pendingAction = null, savedOnce = false;
  // What was last saved (keepOpen): the text, the title box and the markdown choice as they were.
  const snapshot = () => ({text: area.value, title: titleBox?.value ?? '', markdown: markdownValue()});
  let baseline = null;
  const changed = () => { const now = snapshot(); return now.text !== baseline.text || now.title !== baseline.title || now.markdown !== baseline.markdown || (attach?.pending?.() || 0) > 0; };
  const previewing = () => !isPlain() && (WIDE.matches || mode === 'preview');
  // Off: one wide text box (no preview, no [쓰기|미리보기]).
  function paintPlain() {
    const plain = isPlain();
    if (plain) shell.dataset.mdPlain = ''; else delete shell.dataset.mdPlain;
    area.setAttribute('aria-label', plain ? '본문' : '마크다운 원문');
    if (plain && mode === 'preview') setMode('write', {focus: false});
    if (!plain) paintPreview();
  }
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
    if (isPlain() && action !== 'undo' && action !== 'redo' && !PLAIN_ACTIONS.includes(action)) {
      if (openMenu) setMenu(null);
      pendingAction = [action, option];
      void markdownChoices().open('markdown', textReturn, tools.querySelector(`[data-md-action="${action}"]`));
      return;
    }
    if (MENUS[action]) { setMenu(action); return; }
    if (openMenu) setMenu(null);
    if (mode === 'preview' && !WIDE.matches) setMode('write', {focus: false});
    if (action === 'undo' || action === 'redo') { area.focus(); try { document.execCommand(action); } catch {} return; }
    const r = (isPlain() ? applyPlainAction : applyAction)(area.value, area.selectionStart, area.selectionEnd, action, option);
    replace(r.from, r.to, r.insert);
    area.setSelectionRange(r.selStart, r.selEnd);
  }
  // The sheet hands focus back to the text, so the selection and the phone keyboard stay.
  const textReturn = {setAttribute() {}, hidden: false, get isConnected() { return !closed; }, focus: () => area.focus({preventScroll: true})};
  function setMarkdown(on) {
    if (!mdBox || mdBox.checked === on) return;
    mdBox.checked = on; status.textContent = ''; paintPlain(); markdown.onChange?.(on);
  }
  function markdownChoice(value) {
    const next = pendingAction; pendingAction = null;
    if (closed || !next) return;
    if (value !== 'on') { area.focus({preventScroll: true}); return; }
    setMarkdown(true);
    // Let the sheet hand focus back first, then apply the button the person pressed.
    queueMicrotask(() => { if (!closed) run(...next); });
  }
  async function runSave() {
    if (!save || saving || closed) return;
    saving = true; saveButton.disabled = true; if (kindMenu) kindMenu.disabled = true; status.textContent = '저장 중…';
    let result;
    const sent = snapshot();
    try { result = await save.run(sent.text, kind, {title: sent.title, markdown: sent.markdown}); } catch (error) { result = {ok: false, message: error?.message}; }
    saving = false;
    if (closed) return;
    saveButton.disabled = false; if (kindMenu) kindMenu.disabled = false;
    // keepOpen: 저장만 하고 창은 그대로(닫기는 ✕로만). What was sent is now the saved state.
    if (result?.ok && keepOpen) { baseline = sent; savedOnce = true; status.textContent = result.message || '저장했어요'; }
    else if (result?.ok) close();
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
    else if (b.dataset.mdKind) { if (!saving) setKind(b.dataset.mdKind); }
    else if (b.dataset.mdKindMenu) { if (!saving) { setKind(b.dataset.mdKindMenu); kinds.menu.open(b); } }
    else if (b.hasAttribute('data-md-export')) void exportChoices().open('export', copy);
    else if (b.hasAttribute('data-md-save-icon')) void runSave();
    else if (b.dataset.close === ID) {
      // The app's shared [data-close] handler (team.js) would hide the window at once; this window decides (it may ask first).
      e.stopPropagation();
      requestClose({fromBack: shell.dataset.kptuHistoryClosing === 'pop'});
    }
  });
  mdBox?.addEventListener('change', () => { status.textContent = ''; paintPlain(); markdown.onChange?.(mdBox.checked); });
  area.addEventListener('input', () => { if (!saving) status.textContent = ''; onInput?.(area.value); schedule(); });
  titleBox?.addEventListener('input', () => { status.textContent = ''; });
  shell.addEventListener('keydown', e => {
    if (e.key === 'Escape' && openMenu) { e.preventDefault(); e.stopPropagation(); setMenu(null); return; }
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.target !== area) return;
    const key = e.key.toLowerCase();
    if (key === 'b' || key === 'i') { e.preventDefault(); run(key === 'b' ? 'bold' : 'italic'); }
  });
  // UI-키보드하단바: a bottom tab press closes the editor first and then goes on as that tab (the editor's own history
  // entry steps back before the tab moves, as the menu [쓰기] hands a saved note to the basket). A new-text window (draft)
  // with text asks first; an editor opened on an existing field hands its text back to the opener, whose own
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
    if (draft && tab.hasAttribute('data-menu-write')) { area.focus({preventScroll: true}); return; }
    if (draft && (area.value.trim() || titleBox?.value.trim())) { leavingTab = tab; void leaveChoices().open('leave', leaveReturn, tab); }
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

  // NOTE-큰창저장유지: ✕ and Escape ask once when the window keeps open after saving and has changes not saved since.
  // The back button (it arrives as a [닫기] click after the history step) closes as before and hands the text back.
  let asking = false;
  const closeReturn = {setAttribute() {}, hidden: false, get isConnected() { return !closed && !asking; }, focus: () => area.focus({preventScroll: true})};
  function requestClose({fromBack = false} = {}) {
    if (closed) return;
    if (!keepOpen || fromBack || saving || !changed()) { close(); return; }
    void closeChoices().open('close', closeReturn, done);
  }
  function closeChoice(value) {
    if (value !== 'close' || closed) return;
    asking = true;
    // The sheet's own history entry steps back first, then the editor's.
    void closeSheet.close().then(() => close());
  }
  // Closing by button or Escape gives the text back; the back button arrives as a [닫기] click.
  function close({silent = false} = {}) {
    if (closed) return;
    closed = true; clearTimeout(timer); WIDE.removeEventListener('change', onWide); window.removeEventListener('click', onTab, true);
    PHONE.removeEventListener('change', placeBesideNav); window.removeEventListener('resize', placeBesideNav); navSize?.disconnect();
    if (copy.getAttribute('aria-expanded') === 'true') exportSheet?.dismiss();
    if (leavingTab) { leavingTab = null; leaveSheet?.dismiss(); }
    if (pendingAction) { pendingAction = null; markdownSheet?.dismiss(); }
    if (!asking && closeSheet && current === handle) closeSheet.dismiss();
    const value = area.value, after = {saved: savedOnce && !changed(), markdown: markdownValue()};
    shell.classList.add('hidden'); shell.setAttribute('aria-hidden', 'true');
    window.KPTUA11y?.dialog.deactivate?.(shell, {restoreFocus: false});
    document.documentElement.classList.remove('md-editor-open');
    if (current === handle) current = null;
    // Let mobile-modal-history see the hidden state (and step back) before the node goes.
    queueMicrotask(() => shell.remove());
    if (!silent) onClose(value, after);
    else if (trigger?.isConnected) trigger.focus?.({preventScroll: true});
  }
  const handle = {close, exportAs, leaveChoice, closeChoice, markdownChoice, paint, get text() { return area.value; }, get kind() { return kind; }, get markdown() { return markdownValue(); }, get closed() { return closed; }};

  document.body.append(shell);
  if (attachRow) attach.mount({picker: pickerHost, files: attachRow.querySelector('[data-md-attach-files]'), drop: panes});
  document.documentElement.classList.add('md-editor-open');
  paint(); baseline = snapshot();
  onWide(); setMode('write', {focus: false});
  // companions: the wide menu is part of the Tab cycle (editor → menu → editor); on a phone there is none.
  window.KPTUA11y?.dialog.activate?.(shell, {trigger, initialFocus: area, onRequestClose: () => requestClose(),
    companions: () => PHONE.matches ? [] : document.querySelectorAll(`${NAV} :is(button, a[href]):not([disabled])`)});
  area.focus({preventScroll: true});
  area.setSelectionRange(area.value.length, area.value.length);
  area.scrollTop = area.scrollHeight;
  void preloadMarkdown();
  current = handle;
  return handle;
}
