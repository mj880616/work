// MD-편집기: 전체 화면 마크다운 편집기(바구니 메모 [크게 쓰기], 이후 일지·노트에서 재사용).
// 이 화면은 이 모듈 하나가 그린다. 여는 쪽은 글과 콜백만 넘기고, 저장은 여는 쪽의 기존 흐름이 맡는다(이 모듈은 저장하지 않는다).
// 도구 막대는 선택한 글을 감싸거나 줄 앞에 기호를 넣는 마크다운 편집이며, 바꾸기는 execCommand('insertText')로 해
// 브라우저 기본 되돌리기(Ctrl+Z·[되돌리기])에 그대로 남는다. 미리보기는 공용 markdown-view.js(정화·외부 요청 0)를 쓴다.
import {renderMarkdownInto, preloadMarkdown} from './markdown-view.js';
import {applyAction, MERMAID_TEMPLATES, CALLOUT_KINDS} from './md-editor-ops.mjs';
import {toTelegram} from './md-telegram.mjs';

const ID = 'mdEditor';
const WIDE = window.matchMedia('(min-width:1024px)');
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

function button(label, data = {}, aria) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = label;
  for (const [k, v] of Object.entries(data)) if (v != null) b.dataset[k] = v;
  if (aria) b.setAttribute('aria-label', aria);
  return b;
}

// Also used by the note read view's [텔레그램용 복사].
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  // Older WebViews: a hidden read-only text field and the copy command.
  const area = document.createElement('textarea');
  area.value = text; area.setAttribute('readonly', ''); area.className = 'a11y-only';
  document.body.append(area); area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  area.remove();
  return ok;
}

// Opens the editor over the whole screen. text: the starting text. onInput(text): every change (optional).
// onClose(text): when it closes, with the final text; the opener puts it back into its own field.
// save (optional, UI-디자인손질 8 메뉴 [쓰기]): {label, aria, run(text)} adds a filled [저장]; run is the opener's own
// existing save and resolves {ok:true} (the editor then closes) or {ok:false, message}. [닫기] stays the plain close.
// Returns {close({silent})}: silent closes without calling onClose (e.g. the opener's screen went away).
export function openMarkdownEditor({text = '', title = '크게 쓰기', onInput = null, onClose = () => {}, save = null} = {}) {
  current?.close({silent: true});
  const trigger = document.activeElement;
  const shell = document.createElement('div');
  shell.className = 'modal md-editor'; shell.id = ID;
  shell.setAttribute('role', 'dialog'); shell.setAttribute('aria-modal', 'true'); shell.setAttribute('aria-labelledby', ID + 'Title');
  // Phone and desktop alike: the back button closes the editor first (mobile-modal-history.js).
  shell.dataset.kptuHistoryAll = '1';

  const head = document.createElement('div'), name = document.createElement('h2');
  head.className = 'md-editor-head'; name.id = ID + 'Title'; name.textContent = title;
  const copy = button('텔레그램용 복사', {mdTelegram: ''}), done = button('닫기', {close: ID}, save ? '저장하지 않고 닫기' : '닫고 수정 칸으로 돌아가기');
  copy.className = 'secondary'; done.className = save ? 'secondary' : 'primary';
  const saveButton = save ? button(save.label || '저장', {mdSave: ''}, save.aria) : null;
  if (saveButton) { saveButton.className = 'primary'; shell.dataset.mdSave = ''; }
  const modes = document.createElement('div');
  modes.className = 'md-editor-modes'; modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', '보기');
  const writeTab = button('쓰기', {mdMode: 'write'}), previewTab = button('미리보기', {mdMode: 'preview'});
  modes.append(writeTab, previewTab);
  head.append(name, modes, copy, done, ...(saveButton ? [saveButton] : []));

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
  bar.className = 'md-editor-bar'; bar.append(menu, tools);
  shell.append(head, panes, status, bar);

  let mode = 'write', openMenu = null, timer = 0, closed = false, shown = null, saving = false;
  const previewing = () => WIDE.matches || mode === 'preview';
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
    try { result = await save.run(area.value); } catch (error) { result = {ok: false, message: error?.message}; }
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

  // Toolbar presses must not take focus from the text: the selection stays and the phone keyboard stays open.
  bar.addEventListener('pointerdown', e => { if (e.target.closest('button') && document.activeElement === area) e.preventDefault(); });
  shell.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !shell.contains(b)) return;
    if (b.dataset.mdAction) run(b.dataset.mdAction, b.dataset.mdOption);
    else if (b.dataset.mdMode) setMode(b.dataset.mdMode);
    else if (b.hasAttribute('data-md-telegram')) void telegram();
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
  const onWide = () => { shell.dataset.mdWide = String(WIDE.matches); if (WIDE.matches) paintPreview(); };
  WIDE.addEventListener('change', onWide);

  // Closing by button or Escape gives the text back; the back button arrives as a [닫기] click.
  function close({silent = false} = {}) {
    if (closed) return;
    closed = true; clearTimeout(timer); WIDE.removeEventListener('change', onWide);
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
  const handle = {close, get text() { return area.value; }};

  document.body.append(shell);
  document.documentElement.classList.add('md-editor-open');
  onWide(); setMode('write', {focus: false});
  window.KPTUA11y?.dialog.activate?.(shell, {trigger, initialFocus: area, onRequestClose: () => close()});
  area.focus({preventScroll: true});
  area.setSelectionRange(area.value.length, area.value.length);
  area.scrollTop = area.scrollHeight;
  void preloadMarkdown();
  current = handle;
  return handle;
}
