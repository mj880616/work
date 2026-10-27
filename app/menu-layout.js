// MENU-HOME-편집: 사용자가 정한 메뉴 순서(view_prefs.menu_layout)를 화면에 입히는 유일한 곳.
// 목록의 뜻은 menu-model.mjs 한 곳이고, 여기서는 폰 하단바 칸과 폰 [메뉴] 창 안 목록을 그 순서대로 다시 만든다.
// PC 왼쪽 메뉴·761~1023px 한 줄 메뉴의 자리 바꾸기는 그 버튼들의 주인인 topbar-actions.js가 kptu:menu-layout-applied를 받아 한다.
// 기본 구성이고 한 번도 바꾼 적이 없으면 index.html의 처음 모양을 그대로 둔다(다시 그리지 않음).
// 저장은 view-prefs.js(서버)뿐이다. 서버가 새 칸을 아직 모르면(DB 적용 전) 거절 알림으로 원래 순서로 돌아가고 안내한다.
import {viewPrefs} from './view-prefs.js';
import {ITEMS, MENU_ICON, itemOf, normalizeLayout, layoutToPrefs, isDefaultLayout, defaultLayout, moveItem, stepItem, sameLayout} from './menu-model.mjs';

let layout = defaultLayout(), rendered = false;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;

// 폰 하단바 칸 / [메뉴] 창 안 한 줄. 같은 모양(그림 + 이름)이고 어느 쪽이든 같은 data 표시로 라우터·선택 표시가 읽는다.
export function itemButtonHtml(item, where) {
  const attrs = [];
  if (item.kind === 'note') attrs.push('data-basket-kind-nav="note"');
  else attrs.push(`data-view="${esc(item.view)}"`);
  if (where === 'bar' && item.id === 'calendar') attrs.push('data-mobile-schedule-tab');
  if (where === 'bar' && item.id === 'basket') attrs.push('class="mobile-tab-basket"');
  if (where === 'sheet') attrs.push('data-sheet-item');
  return `<button type="button" ${attrs.join(' ')}>${svg(item.icon)}<span>${esc(item.label)}</span></button>`;
}
const toNodes = html => { const tpl = document.createElement('template'); tpl.innerHTML = html; return [...tpl.content.children]; };

function paintPhone() {
  const tabs = document.querySelector('#appView .mobile-tabs'), menuTab = document.getElementById('mobileMenuTab');
  if (tabs && menuTab) {
    [...tabs.children].filter(el => el !== menuTab).forEach(el => el.remove());
    for (const node of toNodes(layout.bar.map(id => itemButtonHtml(itemOf(id), 'bar')).join(''))) tabs.insertBefore(node, menuTab);
    tabs.style.setProperty('--kptu-tab-count', String(layout.bar.length + 1));
  }
  const nav = document.querySelector('#mobileMenu .mobile-menu-panel nav[aria-label="더 보기"]');
  if (nav) {
    // 761~1023px 한 줄 메뉴는 PC 왼쪽 메뉴 버튼을 이 목록에 옮겨 담는다(.nav-btn·.nav-sub-btn). 그것들은 그대로 두고 폰용 줄만 다시 만든다.
    [...nav.children].filter(el => !el.matches('.nav-btn,.nav-sub-btn')).forEach(el => el.remove());
    const nodes = toNodes(layout.rest.map(id => itemButtonHtml(itemOf(id), 'sheet')).join(''));
    nav.prepend(...nodes);
  }
}

export function apply(next, {announce = true} = {}) {
  layout = normalizeLayout(next);
  if (rendered || !isDefaultLayout(layout)) { paintPhone(); rendered = true; }
  window.KPTURouter?.syncNavigation?.();
  if (announce) window.dispatchEvent(new CustomEvent('kptu:menu-layout-applied', {detail: {layout: structuredClone(layout)}}));
}
export const current = () => structuredClone(layout);
const fromPrefs = () => normalizeLayout(viewPrefs.get('menu_layout'));

// 바꾸기: 화면에 바로 입히고 서버에 보낸다(0.4초 모아서 한 번). 기본과 같아지면 칸을 비운다(처음대로).
export function setLayout(next) {
  const value = normalizeLayout(next);
  apply(value);
  viewPrefs.set('menu_layout', layoutToPrefs(value), {rejectable: true});
  void viewPrefs.flush();
  return value;
}
export const resetLayout = () => setLayout(defaultLayout());
export function move(id, to, index) {
  const result = moveItem(layout, id, to, index);
  if (result.ok && result.changed) setLayout(result.layout);
  return result;
}
export function step(id, dir) {
  const result = stepItem(layout, id, dir);
  if (result.ok && result.changed !== false) setLayout(result.layout);
  return result;
}

window.KPTUMenuLayout = {current, apply, setLayout, resetLayout, move, step, items: ITEMS, menuIcon: MENU_ICON, sameLayout};

const first = () => { const saved = fromPrefs(); if (!sameLayout(saved, layout) || !isDefaultLayout(saved)) apply(saved); };
window.addEventListener('kptu:view-prefs-ready', first, {once: true});
if (viewPrefs.status() === 'ok') first();
// 서버가 menu_layout을 거절하면(DB가 아직 모를 때) 서버가 아는 순서로 돌아가고 알린다.
window.addEventListener('kptu:view-prefs-rejected', event => {
  if (!event.detail?.paths?.includes('menu_layout')) return;
  apply(fromPrefs());
  window.dispatchEvent(new CustomEvent('kptu:menu-layout-rejected'));
  const toast = document.querySelector('#toast');
  if (toast) { toast.textContent = '서버가 아직 이 순서를 받지 못해 원래 순서로 되돌렸어요.'; toast.classList.remove('hidden'); clearTimeout(toast._menuTimer); toast._menuTimer = setTimeout(() => toast.classList.add('hidden'), 4200); }
});
