// MENU-HOME-편집 · MENU-세칸: 계정 메뉴 [메뉴 편집] 창. 화면 모양 그대로 세 칸: ① 폰 하단바(5칸까지) ② 위 메뉴(폰 [메뉴] 창 · PC 왼쪽 위)
// ③ 아래 붙는 메뉴(PC 왼쪽 맨 아래 · 폰 [메뉴] 창 맨 아래). ⠿을 잡고 끌어 세 칸 사이를 옮기고(폰은 길게 눌러 끌기, reorder-drag.js),
// 키보드 위·아래도 칸 사이를 넘는다. 홈은 맨 앞 고정. 오른쪽(폰은 아래)에 PC 왼쪽 메뉴 미리보기(pcSplit, 실제 왼쪽 메뉴와 같은 규칙).
// 바꾸면 그 자리에서 메뉴에 반영되고 서버에 저장된다(menu-layout.js). [처음대로]는 기본 순서로, [완료]는 창을 닫는다.
import {mountReorder} from './reorder-drag.js';
import {BAR_MAX, FIXED_ID, itemOf, normalizeLayout, pcSplit, hideItem, showItem} from './menu-model.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const modal = () => document.getElementById('menuEditModal');
let drag = null, note = '';

// MENU-숨김: 숨긴 메뉴는 명진이 고르는 개인 표시이고 기능을 숨기는 것이 아니다(docs/design-decisions.md). 줄마다 [숨기기]/[꺼내기] 작은 글자 버튼, 끌어서 숨김 칸에 놓아도 된다.
function rowHtml(id, list) {
  const item = itemOf(id), fixed = id === FIXED_ID;
  const handle = fixed ? '<span class="me-handle me-fixed" aria-hidden="true">⠿</span>'
    : `<button type="button" class="me-handle" data-reorder-handle aria-label="${esc(item.label)} 옮기기 (끌거나 위·아래 화살표)">⠿</button>`;
  return `<li class="me-row" data-reorder-id="${esc(id)}">${handle}<span class="me-name">${esc(item.label)}</span>${fixed ? '<small class="me-tag">고정</small>'
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
  const pv = id => `<li>${esc(itemOf(id)?.label)}</li>`;
  body.innerHTML = `<div class="me-cols"><div class="me-lists">`
    + group('bar', '폰 하단바', `폰 하단바 <small>${layout.bar.length}/${BAR_MAX}칸</small>`)
    + group('rest', '위 메뉴', '위 메뉴 <small>폰 [메뉴] 창 · PC 왼쪽 위</small>')
    + group('tail', '아래 붙는 메뉴', '아래 붙는 메뉴 <small>PC 왼쪽 맨 아래 · 폰 [메뉴] 창 맨 아래</small>')
    + group('hidden', '숨긴 메뉴', `숨긴 메뉴 <small>${hidden.length}개 · 메뉴에서 빠져요. [꺼내기]로 되돌려요</small>`)
    + `</div><figure class="me-preview" aria-label="PC 왼쪽 메뉴 미리보기"><figcaption>PC 왼쪽 메뉴</figcaption><div class="me-pv-box" data-menu-edit-preview>`
    + `<ol class="me-pv-main">${main.map(pv).join('')}</ol><span class="me-pv-gap" aria-hidden="true"></span>`
    + (tail.length ? `<ol class="me-pv-tail">${tail.map(pv).join('')}</ol>` : '')
    + `</div></figure></div>`
    + `<p class="me-note" role="status" aria-live="polite">${esc(note || '폰은 줄을 길게 눌러 끌어요. 키보드는 위·아래 화살표.')}</p>`;
  if (focusId) body.querySelector(`[data-reorder-id="${CSS.escape(focusId)}"] [data-reorder-handle]`)?.focus({preventScroll: true});
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
}
export function openMenuEdit({trigger} = {}) {
  const el = modal();
  if (!el || !window.KPTUMenuLayout) return;
  note = '';
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
    // 서버가 순서를 받지 못해 되돌렸을 때 창 안도 같은 순서로 다시 그린다.
    window.addEventListener('kptu:menu-layout-rejected', () => { if (!el.classList.contains('hidden')) { note = '서버가 아직 이 순서를 받지 못해 원래 순서로 되돌렸어요.'; paint(); } });
  }
  paint();
  el.classList.remove('hidden'); el.setAttribute('aria-hidden', 'false');
  drag = mountReorder(el.querySelector('[data-menu-edit-body]'), {
    canDrag: id => id !== FIXED_ID,
    scroller: () => el.querySelector('.menu-edit-card'),
    onDrop: ({id, list, index}) => result(window.KPTUMenuLayout.move(id, list, index), id),
    onStep: (id, dir) => result(window.KPTUMenuLayout.step(id, dir), id)
  });
  window.KPTUA11y?.dialog.activate(el, {trigger, initialFocus: '[data-reorder-handle]', onRequestClose: close});
}
