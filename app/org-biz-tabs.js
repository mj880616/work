// NAV-조직사업합침(2026-11-28 사용자 결정): [조직·사업] 큰 탭 줄 [조직 관리][사업 관리][주간 보고]의 유일한 renderer.
// 뜻(탭 목록·보일 탭·밀기 판정)은 org-biz-tabs.mjs 한 곳. 이 모듈은 세 칸 맨 위 자리(index.html [data-orgbiz-tabs])에 같은 줄을 그리고
// 좌우 밀기를 붙이기만 한다. 탭 단추는 [일정] 칸 위 [달력|할 일|하루 기록]과 같은 공용 ⑤ 보기 바꾸기(.ds-seg)이고 data-view라서,
// 누르기·처음 받기 기다림·주소·뒤로가기는 라우터(app-router.js)와 loader-v2.js의 [data-view] 길 그대로다(뒤로가기 = 이전 탭).
// loader-v2.js가 첫 화면을 열기 전에 부르므로(고친 이름·기능 답을 받은 뒤) 탭 줄은 칸이 처음 보일 때 이미 최종 모양이다.
// [주간 보고]는 업무일지 칸(#homeView)의 주간 쪽이라 그 칸의 자리는 화면이 weekly일 때만 보인다(홈 [하루]에는 탭 줄이 없다).
import {word} from './brand/brand.mjs';
import {visibleTabs, stepTab, swipeStep} from './org-biz-tabs.mjs';

// 서버 기능 목록(app_my_features 답). loader-v2.js의 고친 이름 약속이 같이 준다(기다려도 이미 끝나 있음). 없으면 null = 빼지 않음.
const boot = globalThis.__KPTU_CUSTOM_WORDS__;
const got = boot && typeof boot.then === 'function' ? await boot.catch(() => null) : null;
const features = Array.isArray(got?.features) ? got.features : null;

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const tabLabel = tab => word(tab.text, 'tab');
/** 탭 줄 안쪽 단추들. current = 이 칸의 탭 id. */
export function tabsHtml(current, list = visibleTabs(features)) {
  return list.map(tab => `<button type="button" class="ds-seg-btn" data-view="${esc(tab.view)}" aria-pressed="${tab.id === current}">${esc(tabLabel(tab))}</button>`).join('');
}

const slots = () => [...document.querySelectorAll('#appView [data-orgbiz-tabs]')];
function paint() {
  for (const slot of slots()) {
    slot.classList.add('orgbiz-tabs', 'ds-seg');
    slot.setAttribute('role', 'group');
    slot.setAttribute('aria-label', '조직·사업');
    slot.innerHTML = tabsHtml(slot.dataset.orgbizTabs);
  }
}
// 업무일지 칸의 자리: [주간 보고]일 때만. 라우터가 칸을 보이기 바로 그때(같은 일 안) 맞춘다 — 늦게 생기거나 남지 않게.
function placeHome(view = window.KPTURouter?.current) {
  const slot = document.querySelector('#homeView [data-orgbiz-tabs]');
  if (slot) slot.hidden = view !== 'weekly';
}

// 좌우 밀기(결정 장부 P1 '한 화면 안의 보기 전환은 좌우로 밀어 옮긴다'): 칸 안 어디서든 옆으로 밀면 옆 탭. 세로 굴리기와 구분은 swipeStep.
// 줄 위에서 시작한 밀기는 줄 밀기가 먼저(row-swipe.js claimedSince, 손을 뗄 때 물음), 입력 칸·글 쓰는 칸·옆으로 굴러가는 표 안·창 안에서는 넘기지 않는다.
const SKIP = 'input,textarea,select,[contenteditable=""],[contenteditable="true"],.modal,[role="dialog"],[data-no-tab-swipe]';
function sideScrolls(el, stop) {
  for (let node = el; node && node !== stop; node = node.parentElement) {
    if (node.scrollWidth > node.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(node).overflowX)) return true;
  }
  return false;
}
function bindSwipe(panel, viewNow) {
  if (!panel || panel.dataset.orgbizSwipe) return;
  panel.dataset.orgbizSwipe = '1';
  let start = null;
  panel.addEventListener('touchstart', e => {
    start = null;
    if (e.touches.length !== 1 || !viewNow()) return;
    const target = e.target instanceof Element ? e.target : null;
    if (!target || target.closest(SKIP) || sideScrolls(target, panel)) return;
    start = {x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now()};
  }, {passive: true});
  panel.addEventListener('touchcancel', () => { start = null; }, {passive: true});
  panel.addEventListener('touchend', e => {
    const s = start; start = null;
    const view = viewNow();
    if (!s || !view || window.getSelection?.()?.toString()) return;
    const t = e.changedTouches[0], dir = swipeStep({x0: s.x, y0: s.y, x1: t.clientX, y1: t.clientY});
    const next = dir ? stepTab(view, dir, features) : null;
    if (!next) return;
    // 줄 밀기 부품은 그 화면이 이미 불러 두었다(없으면 줄 밀기도 없었다). 첫 화면 사슬을 늘리지 않게 여기서 부른다.
    void import('./row-swipe.js').then(({claimedSince}) => {
      if (claimedSince(s.t) || window.KPTURouter?.current !== view) return;
      const open = window.KPTUDeferredFeatures?.openView;
      if (open) void open(next); else window.KPTURouter?.go?.(next, {source: 'delegated'});
    }).catch(err => console.error('org-biz swipe', err));
  }, {passive: true});
}
const onView = names => () => { const v = window.KPTURouter?.current; return names.includes(v) ? v : null; };

paint();
placeHome();
bindSwipe(document.querySelector('#teamView'), onView(['team']));
bindSwipe(document.querySelector('#meetingsView'), onView(['meetings']));
bindSwipe(document.querySelector('#homeView'), onView(['weekly']));
window.addEventListener('kptu:view-changed', event => placeHome(event.detail?.view));
