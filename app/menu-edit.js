// MENU-HOME-편집 · MENU-세칸: 계정 메뉴 [메뉴 수정] 창. S71-32 NAV-메뉴수정하나로(사용자 11/26 "하나로 통일 못하나" → "ㄱ"):
// 폰 하단바와 위 메뉴는 목록 하나로 잇고, 하단바 마지막 줄 아래에 가는 줄 하나 + 작은 회색 글 '여기까지 폰 하단바'.
// 줄을 그 줄 위로 끌어 올리면 하단바에 들고, 아래로 내리면 빠진다(칸 수 5칸·홈 맨 앞 고정 그대로, menu-model.mjs).
// 아래 붙는 메뉴·숨긴 메뉴도 같은 목록 모양으로 이어 보이고 머리 글자만 작다. PC 왼쪽 메뉴 미리보기 상자는 없다(같은 순서라 겹쳤다).
// 저장 모양은 그대로: 칸 이름 bar·rest·tail·hidden(서버 view_prefs.menu_layout, menu-layout.js). ⠿을 잡고 끌고(폰은 길게 눌러 끌기, reorder-drag.js),
// 키보드는 손잡이에서 위·아래 화살표. 순서는 바꾸면 그 자리에서 메뉴에 반영되고 서버에 저장된다. [처음대로]는 기본 순서로.
//
// 이름 바꾸기(S71-32 ②, 사용자 "이름 바꾸기도 없애고 차라리 메뉴 수정 여기에 기능을 넣든지"): 내 프로필 '이름 바꾸기' 상자를 없애고 여기로 옮겼다.
// - 이름 칸이 있는 메뉴(custom-words-model.mjs SLOTS의 menu)는 줄의 이름 자리가 그대로 입력칸이다(누르면 그 자리에서 고친다). 빈칸 = 기본 이름(흐린 글자).
// - 메뉴가 아닌 이름(기록 한 건·큰 묶음·대상 한 곳·대상 기록·중요 대상)과 활동 분류 8개는 맨 아래 접힌 '다른 이름' 묶음 안에 같은 줄 모양으로.
// - 고친 이름은 창 안에서만 들고 있다가 [완료](창 닫기) 한 번에 함께 저장한다(따로 [저장] 없음). 저장 길·값 모양은 그대로(custom-words-store.js, 서버 custom_words).
// - 고친 이름은 시작할 때 한 번 읽어 모든 화면이 쓰는 구조(app/brand/custom-words.mjs)라, 저장했으면 창이 닫힌 뒤 앱을 한 번 다시 열어 새 이름으로 그린다.
import {mountReorder} from './reorder-drag.js';
import {BAR_MAX, FIXED_ID, itemOf, normalizeLayout, hideItem, showItem} from './menu-model.mjs';
import {BASE_FACE as FACE} from './brand/brand.mjs';
import {SLOTS, NAME_MAX, cleanName, defaultName, slotOfMenu} from './brand/custom-words-model.mjs';
import {readCustomWords, saveCustomWords} from './custom-words-store.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const modal = () => document.getElementById('menuEditModal');
const bodyEl = () => modal()?.querySelector('[data-menu-edit-body]');
const OTHER_SLOTS = SLOTS.filter(slot => !slot.menu);
let drag = null, note = '';
// 이름 상태: words.state = off(읽기 전·못 씀) | ok. draft = 이 창에서 고친 글자(칸 id → 입력 그대로). moreOpen = '다른 이름' 펼침.
let words = {state: 'off', saved: {}}, draft = {}, moreOpen = false, wordsLoad = 0, finishing = false;

const slotFor = id => (words.state === 'ok' ? slotOfMenu(id) : null);
const savedName = slot => words.saved[slot.id] || defaultName(FACE, slot);
/** 칸에 보이는 글자: 이 창에서 고친 글자, 없으면 지금 이름(서버 값 또는 기본 이름). */
const valueOf = slot => (Object.hasOwn(draft, slot.id) ? draft[slot.id] : savedName(slot));
const DEFAULT_NOTE = '폰은 줄을 길게 눌러 끌어요. 키보드는 위·아래 화살표. 이름은 눌러서 바로 수정해요.';
function setNote(text) {
  note = text;
  const el = bodyEl()?.querySelector('.me-note');
  if (el) el.textContent = note || DEFAULT_NOTE;
}

function inputHtml(slot, menuId = '') {
  const def = defaultName(FACE, slot);
  return `<input type="text" class="me-name me-name-in" data-menu-edit-word="${esc(slot.id)}"${menuId ? ` data-menu-edit-name="${esc(menuId)}"` : ''} value="${esc(valueOf(slot))}" placeholder="${esc(def)}" maxlength="${NAME_MAX}" autocomplete="off" enterkeyhint="done" aria-label="${esc(def)} ${menuId ? '메뉴 ' : ''}이름 (빈칸은 기본 이름)">`;
}
function nameHtml(id) {
  const slot = slotFor(id);
  return slot ? inputHtml(slot, id) : `<span class="me-name">${esc(itemOf(id)?.label)}</span>`;
}
// MENU-숨김: 숨긴 메뉴는 사용자이 고르는 개인 표시이고 기능을 숨기는 것이 아니다(docs/design-decisions.md). 줄마다 [숨기기]/[꺼내기] 작은 글자 버튼, 끌어서 숨긴 메뉴 칸에 놓아도 된다.
function rowHtml(id, list) {
  const item = itemOf(id), fixed = id === FIXED_ID;
  const handle = fixed ? '<span class="me-handle me-fixed" aria-hidden="true">⠿</span>'
    : `<button type="button" class="me-handle" data-reorder-handle aria-label="${esc(item.label)} 옮기기 (끌거나 위·아래 화살표)">⠿</button>`;
  return `<li class="me-row" data-reorder-id="${esc(id)}">${handle}${nameHtml(id)}${fixed ? '<small class="me-tag">고정</small>'
    : list === 'hidden' ? `<button type="button" class="row-act me-toggle" data-menu-edit-show="${esc(id)}" aria-label="${esc(item.label)} 다시 꺼내기">꺼내기</button>`
    : `<button type="button" class="row-act me-toggle" data-menu-edit-hide="${esc(id)}" aria-label="${esc(item.label)} 숨기기">숨기기</button>`}</li>`;
}
// '다른 이름' 묶음: 메뉴가 아닌 이름 칸. 줄 모양은 메뉴 줄과 같고(손잡이 자리에 작은 이름표), 끌지 않는다(data-reorder-id 없음).
function changedCount() {
  return OTHER_SLOTS.filter(slot => {
    const v = String(valueOf(slot)).trim();
    return v && v !== defaultName(FACE, slot);
  }).length;
}
function moreHtml() {
  if (words.state !== 'ok') return '';
  const row = slot => `<li class="me-row me-word-row"><span class="me-hint">${esc(slot.kind ? defaultName(FACE, slot) : slot.hint)}</span>${inputHtml(slot)}</li>`;
  const n = changedCount();
  return `<details class="me-more"${moreOpen ? ' open' : ''}><summary>다른 이름 <small class="me-more-count">${n ? `${n}개 바꿈` : ''}</small></summary>`
    + `<ol class="me-list me-words" aria-label="다른 이름">${OTHER_SLOTS.filter(s => !s.kind).map(row).join('')}`
    + `<li class="me-sub" aria-hidden="true">활동 분류</li>${OTHER_SLOTS.filter(s => s.kind).map(row).join('')}</ol></details>`;
}
function paint(focusId = '') {
  const body = bodyEl();
  if (!body) return;
  // MULTI-처음쓰는사람 ④: 운영자 기능이 없어 메뉴에서 뺀 이름(off)은 수정 창에도 그리지 않는다(menu-layout.js current()).
  const view = window.KPTUMenuLayout?.current?.(), off = new Set(view?.off || []), shown = id => !off.has(id);
  const full = normalizeLayout(view), layout = {bar: full.bar.filter(shown), rest: full.rest.filter(shown), tail: full.tail.filter(shown), hidden: full.hidden.filter(shown)};
  const list = (name, label) => `<ol class="me-list" data-reorder-list="${name}" aria-label="${esc(label)}">${layout[name].map(id => rowHtml(id, name)).join('')}</ol>`;
  body.innerHTML = `<div class="me-one">`
    + list('bar', '폰 하단바')
    + `<div class="me-bar-line" role="separator" aria-label="여기까지 폰 하단바"><span>여기까지 폰 하단바</span><small>${layout.bar.length}/${BAR_MAX}칸</small></div>`
    + list('rest', '위 메뉴')
    + `<p class="me-sub" aria-hidden="true">아래 붙는 메뉴</p>` + list('tail', '아래 붙는 메뉴')
    + `<p class="me-sub" aria-hidden="true">숨긴 메뉴 ${layout.hidden.length ? `${layout.hidden.length}개` : ''}</p>` + list('hidden', '숨긴 메뉴')
    + `</div><div data-menu-edit-more>${moreHtml()}</div>`
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
// 서버 값이 늦게 오면 이름 칸이 있는 메뉴 줄의 이름 자리와 '다른 이름' 묶음만 그린다(창 전체를 다시 그리지 않아 포커스·끌기·다른 줄은 그대로).
function paintNames() {
  const body = bodyEl();
  if (!body) return;
  for (const row of body.querySelectorAll('[data-reorder-id]')) {
    const id = row.dataset.reorderId;
    if (!slotOfMenu(id)) continue;
    const name = row.querySelector(':scope > .me-name');
    if (name && name !== document.activeElement) name.outerHTML = nameHtml(id);
  }
  const more = body.querySelector('[data-menu-edit-more]');
  if (more && !more.contains(document.activeElement)) more.innerHTML = moreHtml();
}
const inputOf = slotId => bodyEl()?.querySelector(`[data-menu-edit-word="${CSS.escape(slotId)}"]`);
/** 이 창에서 바꾼 칸만 → {칸 id: 새 글자('' = 기본 이름)}. 지금 이름과 같으면 담지 않는다. */
function changes() {
  const out = {};
  if (words.state !== 'ok') return out;
  for (const slot of SLOTS) {
    if (!Object.hasOwn(draft, slot.id)) continue;
    const text = String(draft[slot.id]).trim(), def = defaultName(FACE, slot);
    if ((text || def) !== savedName(slot)) out[slot.id] = text === def ? '' : text;
  }
  return out;
}
const badText = () => `이름은 ${NAME_MAX}자까지, < > & " ' \` \\ 없이 써 주세요.`;
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
  note = r.ok ? '' : r.reason === 'full' ? `하단바는 홈을 포함해 ${BAR_MAX}칸까지예요. 먼저 한 칸을 '여기까지 폰 하단바' 줄 아래로 내려 주세요.` : r.reason === 'fixed' ? '홈은 맨 앞에 고정이에요.' : '';
  paint(id);
}
function hide() {
  const el = modal();
  if (!el || el.classList.contains('hidden')) return;
  drag?.destroy(); drag = null;
  el.classList.add('hidden'); el.setAttribute('aria-hidden', 'true');
  window.KPTUA11y?.dialog.deactivate(el);
}
// [완료]·창 밖 누르기·Esc·뒤로가기 모두 같은 길: 고친 이름이 있으면 한 번에 저장하고 닫은 뒤 앱을 다시 연다. 틀린 글자면 창을 닫지 않고 그 칸을 보인다.
async function finish() {
  const el = modal();
  if (!el || el.classList.contains('hidden') || finishing) return;
  const next = changes();
  if (!Object.keys(next).length) { hide(); return; }
  const bad = Object.keys(next).find(id => next[id] && !cleanName(next[id]));
  if (bad) {
    // 틀린 칸이 접힌 '다른 이름' 안이면 펼쳐서 보인다.
    if (!moreOpen && OTHER_SLOTS.some(s => s.id === bad)) { moreOpen = true; const more = bodyEl()?.querySelector('.me-more'); if (more) more.open = true; }
    const input = inputOf(bad);
    input?.setAttribute('aria-invalid', 'true');
    input?.focus({preventScroll: false});
    setNote(badText());
    return;
  }
  finishing = true;
  const done = el.querySelector('[data-close="menuEditModal"]');
  if (done) done.disabled = true;
  setNote('저장하는 중이에요.');
  try {
    const r = await saveCustomWords(undefined, FACE, next);
    if (r.error) { setNote(r.error === 'size' ? '이름이 너무 길어요.' : badText()); inputOf(r.error)?.setAttribute('aria-invalid', 'true'); return; }
    words = {state: 'ok', saved: r.saved}; draft = {};
    hide();
    reopenApp();
  } catch { setNote('저장하지 못했어요. 잠시 뒤 다시 해 주세요.'); }
  finally { finishing = false; if (done) done.disabled = false; }
}
export function openMenuEdit({trigger} = {}) {
  const el = modal();
  if (!el || !window.KPTUMenuLayout) return;
  note = ''; draft = {}; moreOpen = false; finishing = false;
  if (!el.dataset.menuEditBound) {
    el.dataset.menuEditBound = '1';
    // 창 밖(어두운 바탕) 누르기는 누르기 시작도 바탕에서 했을 때만 닫는다 — 줄을 끌다 놓으면 브라우저가 따라오는 클릭을 바탕에 보낼 수 있다.
    let downOnBackdrop = false;
    el.addEventListener('pointerdown', event => { downOnBackdrop = event.target === el; });
    el.addEventListener('click', event => {
      const backdrop = event.target === el && downOnBackdrop;
      downOnBackdrop = false;
      if (event.target === el && !backdrop) return;
      if (backdrop || event.target.closest('[data-close="menuEditModal"]')) { event.stopPropagation(); void finish(); return; }
      const hideBtn = event.target.closest('[data-menu-edit-hide]'), show = event.target.closest('[data-menu-edit-show]');
      if (hideBtn || show) {
        const id = (hideBtn || show).dataset.menuEditHide || (hideBtn || show).dataset.menuEditShow;
        const r = (hideBtn ? hideItem : showItem)(window.KPTUMenuLayout.current(), id);
        if (r.ok && r.changed !== false) window.KPTUMenuLayout.setLayout(r.layout);
        note = hideBtn ? `${itemOf(id)?.label}을(를) 숨겼어요. 메뉴 수정에서 다시 꺼낼 수 있어요.` : `${itemOf(id)?.label}을(를) 위 메뉴로 꺼냈어요.`;
        paint(id); return;
      }
      if (event.target.closest('[data-menu-edit-reset]')) { window.KPTUMenuLayout.resetLayout(); note = '처음 순서로 되돌렸어요.'; paint(); }
    });
    el.addEventListener('toggle', event => { if (event.target.matches?.('.me-more')) moreOpen = event.target.open; }, true);
    el.addEventListener('input', event => {
      const input = event.target.closest?.('[data-menu-edit-word]');
      if (!input) return;
      draft[input.dataset.menuEditWord] = input.value;
      input.removeAttribute('aria-invalid');
      const count = bodyEl()?.querySelector('.me-more-count'), n = changedCount();
      if (count) count.textContent = n ? `${n}개 바꿈` : '';
      if (note !== '[완료]를 누르면 저장돼요.') setNote('[완료]를 누르면 저장돼요.');
    });
    // 이름 칸: Enter = 칸에서 나가기(저장은 [완료]), Esc = 고치던 글자를 지금 이름으로 되돌리기(고친 게 없으면 Esc는 창 닫기 그대로).
    el.addEventListener('keydown', event => {
      const input = event.target.closest?.('[data-menu-edit-word]');
      if (!input || event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
      else if (event.key === 'Escape') {
        const slot = SLOTS.find(s => s.id === input.dataset.menuEditWord), now = slot ? savedName(slot) : input.value;
        if (input.value === now) return;
        event.preventDefault(); event.stopPropagation();
        input.value = now; delete draft[slot.id]; input.removeAttribute('aria-invalid'); setNote('');
      }
    });
    el.addEventListener('focusin', event => {
      if (event.target.closest?.('[data-menu-edit-word]') && !note) setNote('빈칸으로 두면 기본 이름이에요. [완료]를 누르면 저장돼요.');
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
  window.KPTUA11y?.dialog.activate(el, {trigger, initialFocus: '[data-reorder-handle]', onRequestClose: () => void finish()});
}
