// MENU-HOME-편집: 사용자가 정한 메뉴 순서(view_prefs.menu_layout)를 화면에 입히는 유일한 곳.
// 목록의 뜻은 menu-model.mjs 한 곳이고, 여기서는 폰 하단바 칸과 폰 [메뉴] 창 안 목록(위 메뉴 · 선 · 아래 붙는 메뉴)을 그 순서대로 다시 만든다.
// PC 왼쪽 메뉴(761px~)의 자리 바꾸기는 그 버튼들의 주인인 topbar-actions.js가 kptu:menu-layout-applied를 받아 한다.
// 기본 구성이고 한 번도 바꾼 적이 없으면 index.html의 처음 모양을 그대로 둔다(다시 그리지 않음).
// 저장은 view-prefs.js(서버)뿐이다. 서버가 새 칸을 아직 모르면(DB 적용 전) 거절 알림으로 원래 순서로 돌아가고 안내한다.
import {holdToast as kptuHoldToast} from './small-notice.js'; // UI-작은알림자리: #toast도 위쪽·2초·올려 두면 멈춤(시계 하나)
import {viewPrefs} from './view-prefs.js';
import {ITEMS, MENU_ICON, itemOf, normalizeLayout, layoutToPrefs, isDefaultLayout, defaultLayout, moveItem, stepItem, sameLayout, withFeatures} from './menu-model.mjs';
import {myFeaturesOrNull} from './my-features.js';

// base = 저장되는 전체 순서, layout = 화면에 그리는 순서(운영자 기능이 없는 메뉴를 뺀 것, off = 뺀 이름). MULTI-처음쓰는사람 ④.
// features는 서버 app_my_features 답(null = 아직 모름 → 빼지 않음). 옮기기·숨기기는 base에 하고 저장한 뒤 다시 뺀다.
let base = defaultLayout(), features = null, layout = withFeatures(base, features), rendered = false;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;

// 폰 하단바 칸 / [메뉴] 창 안 한 줄. 같은 모양(그림 + 이름)이고 어느 쪽이든 같은 data 표시로 라우터·선택 표시가 읽는다.
export function itemButtonHtml(item, where) {
  const attrs = [];
  if (item.kind === 'note') attrs.push('data-basket-kind-nav="note"');
  else attrs.push(`data-view="${esc(item.view)}"`);
  if (where === 'bar' && item.id === 'calendar') attrs.push('data-mobile-schedule-tab');
  if (where === 'bar' && item.id === 'basket') attrs.push('class="mobile-tab-basket"');
  if (where === 'sheet') attrs.push('data-sheet-item', `data-reorder-id="${esc(item.id)}"`); // MENU-왼쪽메뉴바로끌기: [메뉴] 창 줄 끌기(topbar-actions.js)가 읽는 이름
  return `<button type="button" ${attrs.join(' ')}>${svg(item.icon)}<span>${esc(item.label)}</span></button>`;
}
// MENU-숨김: 숨긴 메뉴는 [메뉴] 창에 그리지 않는다(접힌 줄도 없음, 2026-11-04 명진). 메뉴 편집의 '숨긴 메뉴' 칸에서만 꺼낸다.
export const SHEET_TAIL_LINE = '<span class="mobile-menu-tail-line" role="separator" data-menu-tail-line></span>';
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
    [...nav.children].forEach(el => el.remove());
    // MENU-세칸: 아래 붙는 메뉴(tail)는 [메뉴] 창 맨 아래, 선 하나 아래에(PC 왼쪽 맨 아래 묶음과 같은 규칙). 비면 선도 없다.
    const html = layout.rest.map(id => itemButtonHtml(itemOf(id), 'sheet')).join('')
      + (layout.tail.length ? SHEET_TAIL_LINE + layout.tail.map(id => itemButtonHtml(itemOf(id), 'sheet')).join('') : '');
    nav.prepend(...toNodes(html));
  }
}

export function apply(next, {announce = true} = {}) {
  base = normalizeLayout(next);
  layout = withFeatures(base, features);
  if (rendered || !isDefaultLayout(base) || layout.off.length) { paintPhone(); rendered = true; }
  window.KPTURouter?.syncNavigation?.();
  if (announce) window.dispatchEvent(new CustomEvent('kptu:menu-layout-applied', {detail: {layout: structuredClone(layout)}}));
}
export const current = () => structuredClone(layout);
// 운영자 기능 답을 받으면 한 번 다시 그린다(로그인·작업공간이 바뀌면 다시 묻는다). 못 읽으면 아무것도 빼지 않는다(지금 메뉴 그대로).
async function loadFeatures() {
  const rt = window.KPTURuntime;
  if (!rt?.api || !rt?.context?.read?.()?.workspace?.id) return;
  const got = await myFeaturesOrNull(rt);
  if (!got) return;
  if (features && got.length === features.length && got.every((f, i) => f === features[i])) return;
  features = [...got].sort();
  // 뺄 메뉴가 그대로면(운영자 계정은 언제나 빈 목록) 다시 그리지 않는다 — 운영자 화면은 한 번도 다시 그려지지 않는다.
  const next = withFeatures(base, features);
  if (next.off.join() === layout.off.join()) { layout = next; return; }
  apply(base);
}
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
// 옮기기는 저장되는 전체 순서(base)에 한다. index는 화면 칸(뺀 메뉴 없음)에서 옮기는 메뉴를 뺀 자리라, 그 자리에 보이던 메뉴 바로 앞으로 맞춘다.
const baseIndex = (id, to, index) => {
  const view = (layout[to] || []).filter(x => x !== id), full = (base[to] || []).filter(x => x !== id);
  if (!Number.isFinite(index) || index >= view.length) return full.length;
  return Math.max(0, full.indexOf(view[Math.max(0, Math.trunc(index))]));
};
export function move(id, to, index) {
  const result = moveItem(base, id, to, baseIndex(id, to, index));
  if (result.ok && result.changed) setLayout(result.layout);
  return result;
}
export function step(id, dir) {
  const result = stepItem(base, id, dir);
  if (result.ok && result.changed !== false) setLayout(result.layout);
  return result;
}

window.KPTUMenuLayout = {current, apply, setLayout, resetLayout, move, step, items: ITEMS, menuIcon: MENU_ICON, sameLayout};

const first = () => { const saved = fromPrefs(); if (!sameLayout(saved, base) || !isDefaultLayout(saved)) apply(saved); void loadFeatures(); };
window.addEventListener('kptu:session-changed', () => { features = null; void Promise.resolve().then(loadFeatures); });
window.addEventListener('kptu:view-prefs-ready', first, {once: true});
if (viewPrefs.status() === 'ok') first();
// 서버가 menu_layout을 거절하면(DB가 아직 모를 때) 서버가 아는 순서로 돌아가고 알린다.
window.addEventListener('kptu:view-prefs-rejected', event => {
  if (!event.detail?.paths?.includes('menu_layout')) return;
  apply(fromPrefs());
  window.dispatchEvent(new CustomEvent('kptu:menu-layout-rejected'));
  const toast = document.querySelector('#toast');
  if (toast) { toast.textContent = '서버가 아직 이 순서를 받지 못해 원래 순서로 되돌렸어요.'; kptuHoldToast(toast); }
});
