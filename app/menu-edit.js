// MENU-HOME-편집 · MENU-세칸: 계정 메뉴 [메뉴 편집] 창. 화면 모양 그대로 세 칸: ① 폰 하단바(5칸까지) ② 위 메뉴(폰 [메뉴] 창 · PC 왼쪽 위)
// ③ 아래 붙는 메뉴(PC 왼쪽 맨 아래 · 폰 [메뉴] 창 맨 아래). ⠿을 잡고 끌어 세 칸 사이를 옮기고(폰은 길게 눌러 끌기, reorder-drag.js),
// 키보드 위·아래도 칸 사이를 넘는다. 홈은 맨 앞 고정. 오른쪽(폰은 아래)에 PC 왼쪽 메뉴 미리보기(pcSplit, 실제 왼쪽 메뉴와 같은 규칙).
// 바꾸면 그 자리에서 메뉴에 반영되고 서버에 저장된다(menu-layout.js). [처음대로]는 기본 순서로, [완료]는 창을 닫는다.
// S67-71(사용자 11/21 "메뉴 이름을 여기서 바꿀 수 있어야") · S67-77(사용자 11/21 "좀더 직관적으로" → A안): 이름 바꾸기 칸이 있는 메뉴(custom-words-model.mjs SLOTS의 menu)는
// 줄의 이름 자리가 처음부터 입력칸(값 = 지금 이름)이다. 칸 밖으로 나가기·Enter = 저장, Esc = 고치던 글자 되돌리기, 빈칸 = 기본 이름(흐린 글자로 보임).
// 끌기는 ⠿ 손잡이(폰은 입력칸 밖을 길게 누르기)에서만 시작한다. 저장은 내 프로필 '이름 바꾸기'와 같은 칸·같은 길(custom-words-store.js).
// 고친 이름은 시작할 때 한 번 읽어 모든 화면이 쓰는 구조(app/brand/custom-words.mjs)라, 이름을 바꾼 뒤 창을 닫으면 앱을 한 번 다시 열어 메뉴·하단바·왼쪽 메뉴가 새 이름으로 그려진다.
import {mountReorder} from './reorder-drag.js';
import {BAR_MAX, FIXED_ID, itemOf, normalizeLayout, pcSplit, hideItem, showItem} from './menu-model.mjs';
import {BASE_FACE as FACE} from './brand/brand.mjs';
import {NAME_MAX, defaultName, slotOfMenu} from './brand/custom-words-model.mjs';
import {readCustomWords, saveCustomWordSlot} from './custom-words-store.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const modal = () => document.getElementById('menuEditModal');
let drag = null, note = '';
// 이름 바꾸기 상태: words.state = off(읽기 전·못 씀) | ok. renamed = 이번에 이름을 바꿨나(닫을 때 다시 열기).
// saving = 저장 줄(한 번에 하나씩 차례로 — 칸 하나 저장은 서버 값을 다시 읽고 쓰므로 겹치면 안 된다), pendingSaves = 아직 끝나지 않은 저장 수.
let words = {state: 'off', saved: {}}, renamed = false, wordsLoad = 0, saving = Promise.resolve(), pendingSaves = 0;

const slotFor = id => (words.state === 'ok' ? slotOfMenu(id) : null);
/** 줄·미리보기에 보이는 이름: 이름 칸이 있으면 서버 값(없으면 기본 이름), 아니면 메뉴 글자. */
function nameOf(id) {
  const slot = slotFor(id);
  return slot ? (words.saved[slot.id] || defaultName(FACE, slot)) : itemOf(id)?.label;
}
function nameHtml(id) {
  const slot = slotFor(id), name = nameOf(id);
  if (!slot) return `<span class="me-name">${esc(name)}</span>`;
  const def = defaultName(FACE, slot);
  return `<input type="text" class="me-name me-name-in" data-menu-edit-name="${esc(id)}" value="${esc(name)}" placeholder="${esc(def)}" maxlength="${NAME_MAX}" autocomplete="off" enterkeyhint="done" aria-label="${esc(def)} 메뉴 이름 (빈칸은 기본 이름)">`;
}
const bodyEl = () => modal()?.querySelector('[data-menu-edit-body]');
const inputOf = id => bodyEl()?.querySelector(`[data-menu-edit-name="${CSS.escape(id)}"]`);
/** 아래 안내 한 줄만 바꾼다(창을 다시 그리지 않아 입력 중인 칸·포커스가 그대로). */
function setNote(text) {
  note = text;
  const el = bodyEl()?.querySelector('.me-note');
  if (el) el.textContent = note || DEFAULT_NOTE;
}
const DEFAULT_NOTE = '폰은 줄을 길게 눌러 끌어요. 키보드는 위·아래 화살표.';

// MENU-숨김: 숨긴 메뉴는 사용자가 고르는 개인 표시이고 기능을 숨기는 것이 아니다(docs/design-decisions.md). 줄마다 [숨기기]/[꺼내기] 작은 글자 버튼, 끌어서 숨김 칸에 놓아도 된다.
function rowHtml(id, list) {
  const item = itemOf(id), fixed = id === FIXED_ID;
  const handle = fixed ? '<span class="me-handle me-fixed" aria-hidden="true">⠿</span>'
    : `<button type="button" class="me-handle" data-reorder-handle aria-label="${esc(item.label)} 옮기기 (끌거나 위·아래 화살표)">⠿</button>`;
  return `<li class="me-row" data-reorder-id="${esc(id)}">${handle}${nameHtml(id)}${fixed ? '<small class="me-tag">고정</small>'
    : list === 'hidden' ? `<button type="button" class="row-act me-toggle" data-menu-edit-show="${esc(id)}" aria-label="${esc(item.label)} 다시 꺼내기">꺼내기</button>`
    : `<button type="button" class="row-act me-toggle" data-menu-edit-hide="${esc(id)}" aria-label="${esc(item.label)} 숨기기">숨기기</button>`}</li>`;
}
function paint(focusId = '') {
  const body = modal()?.querySelector('[data-menu-edit-body]');
  if (!body) return;
  // MULTI-처음쓰는사람 ④: 운영자 기능이 없어 메뉴에서 뺀 이름(off)은 편집 칸·미리보기에도 그리지 않는다(menu-layout.js current()).
  const view = window.KPTUMenuLayout?.current?.(), off = new Set(view?.off || []), shown = id => !off.has(id);
  const full = normalizeLayout(view), layout = {bar: full.bar.filter(shown), rest: full.rest.filter(shown), tail: full.tail.filter(shown), hidden: full.hidden.filter(shown)};
  const group = (list, label, head) => `<section class="me-group" aria-label="${esc(label)}"><h3>${head}</h3><ol class="me-list" data-reorder-list="${list}">${layout[list].map(id => rowHtml(id, list)).join('')}</ol></section>`;
  const split = pcSplit(full), main = split.main.filter(shown), tail = split.tail.filter(shown), {hidden} = layout;
  const pv = id => `<li data-pv-id="${esc(id)}">${esc(nameOf(id))}</li>`;
  body.innerHTML = `<div class="me-cols"><div class="me-lists">`
    + group('bar', '폰 하단바', `폰 하단바 <small>${layout.bar.length}/${BAR_MAX}칸</small>`)
    + group('rest', '위 메뉴', '위 메뉴 <small>폰 [메뉴] 창 · PC 왼쪽 위</small>')
    + group('tail', '아래 붙는 메뉴', '아래 붙는 메뉴 <small>PC 왼쪽 맨 아래 · 폰 [메뉴] 창 맨 아래</small>')
    + group('hidden', '숨긴 메뉴', `숨긴 메뉴 <small>${hidden.length}개 · 메뉴에서 빠져요. [꺼내기]로 되돌려요</small>`)
    + `</div><figure class="me-preview" aria-label="PC 왼쪽 메뉴 미리보기"><figcaption>PC 왼쪽 메뉴</figcaption><div class="me-pv-box" data-menu-edit-preview>`
    + `<ol class="me-pv-main">${main.map(pv).join('')}</ol><span class="me-pv-gap" aria-hidden="true"></span>`
    + (tail.length ? `<ol class="me-pv-tail">${tail.map(pv).join('')}</ol>` : '')
    + `</div></figure></div>`
    + `<p class="me-note" role="status" aria-live="polite">${esc(note || DEFAULT_NOTE)}</p>`;
  if (focusId) body.querySelector(`[data-reorder-id="${CSS.escape(focusId)}"] [data-reorder-handle]`)?.focus({preventScroll: true});
}
async function loadWords() {
  const ticket = ++wordsLoad;
  try {
    const {saved} = await readCustomWords();
    if (ticket !== wordsLoad) return;
    words = {state: 'ok', saved};
  } catch { if (ticket === wordsLoad) words = {state: 'off', saved: {}}; }
  if (ticket === wordsLoad && !modal()?.classList.contains('hidden')) paintNames();
}
// 서버 값이 늦게 오면 이름 칸이 있는 줄의 이름 자리와 미리보기 글자만 바꾼다(창 전체를 다시 그리지 않아 포커스·끌기·다른 줄은 그대로).
// 지금 글자를 고치고 있는 칸(포커스가 있는 칸)은 건드리지 않는다.
function paintNames() {
  const body = bodyEl();
  if (!body) return;
  for (const row of body.querySelectorAll('[data-reorder-id]')) {
    const id = row.dataset.reorderId;
    if (!slotOfMenu(id)) continue;
    const name = row.querySelector(':scope > .me-name');
    if (name && name !== document.activeElement) name.outerHTML = nameHtml(id);
  }
  paintPreviewNames();
}
function paintPreviewNames() {
  for (const li of bodyEl()?.querySelectorAll('[data-pv-id]') || []) if (slotOfMenu(li.dataset.pvId)) li.textContent = nameOf(li.dataset.pvId);
}
// 입력칸의 글자를 저장한다(차례 줄에 올림). 지금 이름과 같으면 저장하지 않는다. 틀린 글자면 칸에 글자를 그대로 두고 안내.
function commitName(id, value) {
  pendingSaves += 1;
  saving = saving.then(() => saveName(id, value)).catch(() => {}).finally(() => { pendingSaves -= 1; });
  return saving;
}
async function saveName(id, value) {
  const slot = slotFor(id);
  if (!slot) return;
  const text = String(value ?? '').trim(), def = defaultName(FACE, slot), input = () => inputOf(id);
  if ((text || def) === (words.saved[slot.id] || def)) {
    // 바뀐 것이 없으면 칸의 앞뒤 빈칸·빈칸만 정리한다(빈칸은 기본 이름으로 보이게). 고치는 중인 칸은 건드리지 않는다.
    const el = input();
    if (el && el !== document.activeElement && el.value !== nameOf(id)) el.value = nameOf(id);
    return;
  }
  setNote('저장하는 중이에요.');
  try {
    const r = await saveCustomWordSlot(undefined, FACE, slot.id, text);
    if (r.error) {
      setNote(r.error === 'size' ? '이름이 너무 길어요.' : `이름은 ${NAME_MAX}자까지, < > & " ' \` \\ 없이 써 주세요.`);
      input()?.setAttribute('aria-invalid', 'true');
      return;
    }
    words = {state: 'ok', saved: r.saved}; renamed = true;
    const el = input();
    if (el) { el.removeAttribute('aria-invalid'); if (el !== document.activeElement || el.value.trim() === text) el.value = nameOf(id); }
    paintPreviewNames();
    setNote(`${r.saved[slot.id] ? `‘${r.saved[slot.id]}’(으)로 바꿨어요` : `기본 이름 ‘${def}’(으)로 되돌렸어요`}. [완료]를 누르면 메뉴에 보여요.`);
  } catch { setNote('저장하지 못했어요. 잠시 뒤 다시 해 주세요.'); }
}
// 이름을 바꿨으면 창이 닫힌 뒤(폰 뒤로가기 기록 정리까지) 앱을 한 번 다시 연다 — 시작 때 읽는 구조라 모든 메뉴가 새 이름으로 한 번에 그려진다.
function reopenApp() {
  const go = () => location.reload();
  setTimeout(() => {
    if (history.state?.kptuOverlay !== 'menuEditModal') { go(); return; }
    let done = false;
    const once = () => { if (!done) { done = true; go(); } };
    window.addEventListener('popstate', once, {once: true});
    setTimeout(once, 600);
  }, 0);
}
function result(r, id) {
  note = r.ok ? '' : r.reason === 'full' ? `하단바는 홈을 포함해 ${BAR_MAX}칸까지예요. 먼저 한 칸을 위 메뉴로 옮겨 주세요.` : r.reason === 'fixed' ? '홈은 맨 앞에 고정이에요.' : '';
  paint(id);
}
function close() {
  const el = modal();
  if (!el || el.classList.contains('hidden')) return;
  drag?.destroy(); drag = null;
  el.classList.add('hidden'); el.setAttribute('aria-hidden', 'true');
  window.KPTUA11y?.dialog.deactivate(el);
  // 닫기 버튼을 누르며 칸 밖으로 나가 시작된 저장까지 끝난 뒤, 이름을 바꿨으면 앱을 다시 연다.
  const after = () => { if (renamed && el.classList.contains('hidden')) { renamed = false; reopenApp(); } };
  if (pendingSaves) saving.then(after); else after();
}
export function openMenuEdit({trigger} = {}) {
  const el = modal();
  if (!el || !window.KPTUMenuLayout) return;
  note = ''; renamed = false;
  if (!el.dataset.menuEditBound) {
    el.dataset.menuEditBound = '1';
    el.addEventListener('click', event => {
      if (event.target === el || event.target.closest('[data-close="menuEditModal"]')) { event.stopPropagation(); close(); return; }
      const hide = event.target.closest('[data-menu-edit-hide]'), show = event.target.closest('[data-menu-edit-show]');
      if (hide || show) {
        const id = (hide || show).dataset.menuEditHide || (hide || show).dataset.menuEditShow;
        const r = (hide ? hideItem : showItem)(window.KPTUMenuLayout.current(), id);
        if (r.ok && r.changed !== false) window.KPTUMenuLayout.setLayout(r.layout);
        note = hide ? `${itemOf(id)?.label}을(를) 숨겼어요. 메뉴 수정에서 다시 꺼낼 수 있어요.` : `${itemOf(id)?.label}을(를) 위 메뉴로 꺼냈어요.`;
        paint(id); return;
      }
      if (event.target.closest('[data-menu-edit-reset]')) { window.KPTUMenuLayout.resetLayout(); note = '처음 순서로 되돌렸어요.'; paint(); }
    });
    // 이름 입력칸: Enter = 저장, Esc = 고치던 글자를 지금 이름으로 되돌리기(고친 게 없으면 Esc는 창 닫기 그대로), 칸 밖으로 나가면 저장.
    el.addEventListener('keydown', event => {
      const input = event.target.closest?.('[data-menu-edit-name]');
      if (!input || event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter') { event.preventDefault(); commitName(input.dataset.menuEditName, input.value); }
      else if (event.key === 'Escape') {
        const now = nameOf(input.dataset.menuEditName);
        if (input.value === now) return;
        event.preventDefault(); event.stopPropagation(); input.value = now; input.removeAttribute('aria-invalid'); setNote('');
      }
    });
    el.addEventListener('focusin', event => {
      if (event.target.closest?.('[data-menu-edit-name]') && !note) setNote('빈칸으로 두면 기본 이름이에요. 칸 밖을 누르거나 Enter면 저장돼요.');
    });
    el.addEventListener('focusout', event => {
      const input = event.target.closest?.('[data-menu-edit-name]');
      if (input && input.isConnected) commitName(input.dataset.menuEditName, input.value);
    });
    // 서버가 순서를 받지 못해 되돌렸을 때 창 안도 같은 순서로 다시 그린다.
    window.addEventListener('kptu:menu-layout-rejected', () => { if (!el.classList.contains('hidden')) { note = '서버가 아직 이 순서를 받지 못해 원래 순서로 되돌렸어요.'; paint(); } });
  }
  paint();
  loadWords();
  el.classList.remove('hidden'); el.setAttribute('aria-hidden', 'false');
  drag = mountReorder(el.querySelector('[data-menu-edit-body]'), {
    canDrag: id => id !== FIXED_ID,
    scroller: () => el.querySelector('.menu-edit-card'),
    onDrop: ({id, list, index}) => result(window.KPTUMenuLayout.move(id, list, index), id),
    onStep: (id, dir) => result(window.KPTUMenuLayout.step(id, dir), id)
  });
  window.KPTUA11y?.dialog.activate(el, {trigger, initialFocus: '[data-reorder-handle]', onRequestClose: close});
}
