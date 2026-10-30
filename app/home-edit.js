import {emptyHtml} from './wait-state.js';
// MENU-HOME-편집: 홈 편집(홈 ⋯ → [홈 편집]). 칸마다 점선 테두리 + ⠿(옮기기) + ✕(빼기), 아래 [+ 칸 더하기]에서 고르고, 오른쪽 위 [처음대로][완료].
// 순서·빼기는 서버(view_prefs.home_cards)에만 둔다. 뺀 칸은 화면에서만 빠지고 데이터·기능은 그대로다.
// 편집 중에는 진짜 칸 대신 칸 이름 줄(작고 낮은)을 보여 주므로, 비어서 안 보이는 칸도 여기서 고를 수 있다.
// 칸이 놓이는 자리는 home-read.js(placeCards)가 정한다: 여기서 바꾸면 kptu:home-cards-changed를 알린다.
import {viewPrefs} from './view-prefs.js';
import {mountReorder} from './reorder-drag.js';
import {WEEK_CHOICES, weeksOf} from './org-quiet-model.mjs';
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
    tools.classList.toggle('home-tools-open', editing);
    tools.innerHTML = editing
      ? '<span class="home-tools-title">홈 편집</span><button type="button" class="home-tools-btn" data-he-reset>처음대로</button><button type="button" class="home-tools-btn" data-he-done>완료</button>'
      : '<button type="button" class="home-tools-more" data-he-more data-ctx="off" aria-haspopup="true" aria-expanded="false" aria-label="홈 메뉴"><span class="more-dots" aria-hidden="true">⋯</span></button>';
  }
  function paintPage(focusId = '') {
    if (!editing) return;
    const now = list(), shown = visibleCards(now, phone()), more = addable(now, phone());
    const rows = shown.map(id => `<li class="he-row" data-reorder-id="${esc(id)}"><button type="button" class="he-handle" data-reorder-handle aria-label="${esc(titleOf(id))} 옮기기 (끌거나 위·아래 화살표)">⠿</button><span class="he-name">${esc(titleOf(id))}</span>${id === 'quiet' ? weeksSeg() : ''}<button type="button" class="he-x" data-he-remove="${esc(id)}" aria-label="${esc(titleOf(id))} 홈에서 빼기">✕</button></li>`).join('');
    page.innerHTML = `<ol class="he-list" data-reorder-list="cards">${rows}</ol>${shown.length ? '' : emptyHtml('칸 없음')}`
      + `<div class="he-add"><span class="he-add-title">+ 칸 더하기</span>${more.length ? more.map(card => `<button type="button" class="he-chip" data-he-add="${esc(card.id)}">${esc(card.title)}</button>`).join('') : emptyHtml('더할 칸 없음')}</div>`
      + `<p class="he-note" role="status" aria-live="polite">${esc(note)}</p>`;
    if (focusId) page.querySelector(`[data-reorder-id="${CSS.escape(focusId)}"] [data-reorder-handle]`)?.focus({preventScroll: true});
  }
  // FEAT-1029묶음 ③: '연락 없는 조직' 기준 [2주|3주|4주|6주|끄기]. 바꾸면 바로 서버 저장(view_prefs.quiet_weeks).
  function weeksSeg() {
    const now = weeksOf(viewPrefs.get('quiet_weeks'));
    return `<span class="he-seg" role="group" aria-label="연락 없음 기준">${WEEK_CHOICES.map(w => `<button type="button" data-he-weeks="${w}" aria-pressed="${now === w}">${w ? `${w}주` : '끄기'}</button>`).join('')}</span>`;
  }
  // UI-점검1030손질 C6(UI-더보기제목줄): 폰·중간 폭(1023px 이하)에서 홈 ⋯는 홈 끝에 혼자 한 줄로 뜨지 않고, 홈 맨 끝 줄인
  // 'AI 사용량' 줄의 제목 줄 오른쪽 끝([data-aiu-top], ai-usage-line.js가 그 자리만 둔다)에 든다. 그 줄이 없으면(수집 칸을 뺐거나 소유자 아님)
  // 예전처럼 칸 묶음 바로 뒤. PC(1024px~)는 지금 자리 그대로. 편집 중에는 [처음대로][완료] 줄이라 칸 묶음 바로 뒤로 돌아온다.
  let alive = true;
  function dock() {
    if (!alive) return;
    const slot = !editing && phone() ? host.querySelector('[data-home-ai-usage]:not([hidden]) [data-aiu-top]') : null;
    const had = tools.contains(document.activeElement) ? document.activeElement : null;
    if (slot) { if (tools.parentElement !== slot) slot.append(tools); }
    else if (tools.previousElementSibling !== host || tools.nextElementSibling !== page) { host.after(tools); tools.after(page); }
    tools.classList.toggle('home-tools-docked', !!slot);
    if (had && !tools.contains(document.activeElement)) had.focus({preventScroll: true});
  }
  function enter() {
    if (editing) return;
    editing = true; note = ''; dock();
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
    paintTools(); dock();
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
    const weeks = event.target.closest('[data-he-weeks]');
    if (weeks) {
      const w = Number(weeks.dataset.heWeeks);
      viewPrefs.set('quiet_weeks', w, {rejectable: true});
      void viewPrefs.flush();
      window.dispatchEvent(new CustomEvent('kptu:quiet-weeks-changed'));
      note = w ? `연락 없음 기준을 ${w}주로 바꿨어요.` : '연락 없는 조직 줄을 껐어요.';
      paintPage();
      page.querySelector(`[data-he-weeks="${w}"]`)?.focus({preventScroll: true});
      return;
    }
    const remove = event.target.closest('[data-he-remove]'), add = event.target.closest('[data-he-add]');
    if (remove) { const id = remove.dataset.heRemove; note = `${titleOf(id)} 칸을 홈에서 뺐어요. 자료는 그대로예요.`; commit(removeCard(list(), id)); page.querySelector('[data-he-add="' + CSS.escape(id) + '"]')?.focus({preventScroll: true}); }
    else if (add) { const id = add.dataset.heAdd; note = ''; commit(addCard(list(), id)); page.querySelector('[data-reorder-id="' + CSS.escape(id) + '"] [data-reorder-handle]')?.focus({preventScroll: true}); }
  });
  const onView = () => { if (editing) leave(false); };
  window.addEventListener('kptu:view-changed', onView);
  desktop.addEventListener?.('change', dock);
  paintTools(); dock();
  return {
    dock,
    rejected() { note = '서버가 아직 이 칸 설정을 받지 못해 원래대로 되돌렸어요.'; paintPage(); },
    weeksRejected() { note = '서버가 아직 이 기준을 받지 못해 원래대로 되돌렸어요.'; paintPage(); window.dispatchEvent(new CustomEvent('kptu:quiet-weeks-changed')); },
    destroy() { alive = false; desktop.removeEventListener?.('change', dock); window.removeEventListener('kptu:view-changed', onView); drag?.destroy(); tools.remove(); page.remove(); host.hidden = false; }
  };
}
