// MENU-HOME-편집: 홈 편집(홈 ⋯ → [홈 편집]). 칸마다 점선 테두리 + ⠿(옮기기) + ✕(빼기), 아래 [+ 칸 더하기]에서 고르고, 오른쪽 위 [처음대로][완료].
// 순서·빼기는 서버(view_prefs.home_cards)에만 둔다. 뺀 칸은 화면에서만 빠지고 데이터·기능은 그대로다.
// 편집 중에는 진짜 칸 대신 칸 이름 줄(작고 낮은)을 보여 주므로, 비어서 안 보이는 칸도 여기서 고를 수 있다.
// 칸이 놓이는 자리는 home-read.js(placeCards)가 정한다: 여기서 바꾸면 kptu:home-cards-changed를 알린다.
import {viewPrefs} from './view-prefs.js';
import {mountReorder} from './reorder-drag.js';
import {normalizeCards, cardsToPrefs, removeCard, addCard, moveCard, stepCard, visibleCards, addable, titleOf, DEFAULT_ORDER} from './home-cards-model.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const desktop = window.matchMedia('(min-width:1024px)');
const phone = () => !desktop.matches;

export function mountHomeEdit({root}) {
  const host = root.querySelector('[data-home-cards]');
  if (!host) return null;
  root.querySelectorAll('[data-home-tools],[data-home-edit]').forEach(el => el.remove());
  const tools = document.createElement('div');
  tools.className = 'home-tools'; tools.dataset.homeTools = '';
  const page = document.createElement('section');
  page.className = 'home-edit'; page.dataset.homeEdit = ''; page.hidden = true; page.setAttribute('aria-label', '홈 편집');
  host.after(tools); tools.after(page);

  let editing = false, layer = null, drag = null, note = '', menu = null;
  const list = () => normalizeCards(viewPrefs.get('home_cards'));
  const commit = next => {
    viewPrefs.set('home_cards', cardsToPrefs(next), {rejectable: true});
    void viewPrefs.flush();
    window.dispatchEvent(new CustomEvent('kptu:home-cards-changed'));
    paintPage();
  };
  function paintTools() {
    tools.innerHTML = editing
      ? '<span class="home-tools-title">홈 편집</span><button type="button" class="home-tools-btn" data-he-reset>처음대로</button><button type="button" class="home-tools-btn" data-he-done>완료</button>'
      : '<button type="button" class="home-tools-more" data-he-more data-ctx="off" aria-haspopup="true" aria-expanded="false" aria-label="홈 메뉴">⋯</button>';
  }
  function paintPage(focusId = '') {
    if (!editing) return;
    const now = list(), shown = visibleCards(now, phone()), more = addable(now, phone());
    const rows = shown.map(id => `<li class="he-row" data-reorder-id="${esc(id)}"><button type="button" class="he-handle" data-reorder-handle aria-label="${esc(titleOf(id))} 옮기기 (끌거나 위·아래 화살표)">⠿</button><span class="he-name">${esc(titleOf(id))}</span><button type="button" class="he-x" data-he-remove="${esc(id)}" aria-label="${esc(titleOf(id))} 홈에서 빼기">✕</button></li>`).join('');
    page.innerHTML = `<ol class="he-list" data-reorder-list="cards">${rows}</ol>${shown.length ? '' : '<p class="he-note">홈에 칸이 없어요. 아래에서 더해 보세요.</p>'}`
      + `<div class="he-add"><span class="he-add-title">+ 칸 더하기</span>${more.length ? more.map(card => `<button type="button" class="he-chip" data-he-add="${esc(card.id)}">${esc(card.title)}</button>`).join('') : '<span class="he-note">더할 칸이 없어요.</span>'}</div>`
      + `<p class="he-note" role="status" aria-live="polite">${esc(note)}</p>`;
    if (focusId) page.querySelector(`[data-reorder-id="${CSS.escape(focusId)}"] [data-reorder-handle]`)?.focus({preventScroll: true});
  }
  function enter() {
    if (editing) return;
    editing = true; note = '';
    host.hidden = true; page.hidden = false;
    drag = mountReorder(page, {
      onDrop: ({id, index}) => commit(moveCard(list(), id, index, phone())),
      onStep: (id, dir) => { commit(stepCard(list(), id, dir, phone())); paintPage(id); }
    });
    layer = window.KPTURouter?.layer?.open('homeEdit', {close: () => { leave(false); return true; }}) || null;
    paintTools(); paintPage();
    page.querySelector('[data-reorder-handle]')?.focus({preventScroll: true});
  }
  function leave(viaButton) {
    if (!editing) return;
    editing = false;
    drag?.destroy(); drag = null;
    host.hidden = false; page.hidden = true; page.innerHTML = '';
    const open = layer; layer = null;
    paintTools();
    window.dispatchEvent(new CustomEvent('kptu:home-cards-changed'));
    if (viaButton) open?.close();
    tools.querySelector('[data-he-more]')?.focus({preventScroll: true});
  }
  tools.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.matches('[data-he-done]')) return leave(true);
    if (button.matches('[data-he-reset]')) { note = '처음 칸으로 되돌렸어요.'; return commit([...DEFAULT_ORDER]); }
    if (button.matches('[data-he-more]')) {
      if (!menu) {
        const {createAnchoredMenu} = await import('./anchored-menu.js');
        menu = createAnchoredMenu({id: 'homeMoreMenu', className: 'topline-add-menu', label: '홈', historyKey: 'kptuHomeMore', key: () => 'home',
          render: () => '<button type="button" data-he-start>홈 편집</button>',
          onAction: () => enter()});
      }
      menu.open(button);
    }
  });
  page.addEventListener('click', event => {
    const remove = event.target.closest('[data-he-remove]'), add = event.target.closest('[data-he-add]');
    if (remove) { const id = remove.dataset.heRemove; note = `${titleOf(id)} 칸을 홈에서 뺐어요. 자료는 그대로예요.`; commit(removeCard(list(), id)); page.querySelector('[data-he-add="' + CSS.escape(id) + '"]')?.focus({preventScroll: true}); }
    else if (add) { const id = add.dataset.heAdd; note = ''; commit(addCard(list(), id)); page.querySelector('[data-reorder-id="' + CSS.escape(id) + '"] [data-reorder-handle]')?.focus({preventScroll: true}); }
  });
  const onView = () => { if (editing) leave(false); };
  window.addEventListener('kptu:view-changed', onView);
  paintTools();
  return {
    rejected() { note = '서버가 아직 이 칸 설정을 받지 못해 원래대로 되돌렸어요.'; paintPage(); },
    destroy() { window.removeEventListener('kptu:view-changed', onView); drag?.destroy(); tools.remove(); page.remove(); host.hidden = false; }
  };
}
