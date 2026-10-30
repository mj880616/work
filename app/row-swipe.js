// UI-목록밀기(2026-10-30 명진 요청): 폰(≤760px) 목록 줄을 손가락으로 밀어 처리하는 공용 부품. 텔레그램 소식 줄 밀기와 같은 모양·같은 손동작
// (셈은 row-swipe-model.mjs, 텔레그램도 같은 기준을 쓴다). 왼쪽으로 밀면 오른쪽 끝에 [삭제], 오른쪽으로 밀면 왼쪽 끝에 그 목록의 대표 처리 하나.
// 조금 밀면 버튼만 보이고 멈춘다(누르면 실행), 끝까지 쭉 밀면 손을 떼는 순간 바로 실행한다.
// - 손가락(터치)만, 폰 폭만. PC·중간 폭은 지금처럼 ⋯·우클릭 메뉴다. 세로 스크롤과 헷갈리지 않게 가로로 충분히 민 뒤에만 시작한다.
// - 목록 줄 위에서는 줄 밀기가 먼저다: 다른 좌우 밀기(노트 보기 전환 등)는 claimedSince()로 이 손동작을 건너뛴다.
// - 데이터는 이 부품이 지우지 않는다. run(key, row)은 그 목록의 기존 길(휴지통 삭제 + 위쪽 '지웠어요 [되돌리기]', 보류, 무시 …)을 부른다.
// - 상태는 화면 메모리에만(열린 줄 하나). 기기에 저장하지 않는다.
// 쓰는 법: bindRowSwipe(목록을 담은 고정 칸, {row:'줄 선택자', enabled:()=>bool, actions:row=>({start:{key,label,tone}|null, end:{…}|null}), run:(key,row)=>void})
import {swipeIntent, swipeEdge, rowOffset, rowSettle, openOffset, SWIPE_BTN} from './row-swipe-model.mjs';

const PHONE = '(max-width:760px)';
const SKIP = 'input,textarea,select,[contenteditable],[data-row-swipe-act]';
let claimed = 0;
// 마지막 줄 밀기가 시작된 때(ms). 다른 좌우 밀기는 자기 손동작 시작 뒤에 줄 밀기가 있었으면 아무것도 하지 않는다.
export const claimedSince = t => claimed >= (Number(t) || 0);

export function bindRowSwipe(root, {row, enabled = () => true, actions, run}) {
  if (!root || root.dataset.rowSwipe) return {close() {}};
  root.dataset.rowSwipe = '1';
  let drag = null, open = null, swallow = false;
  const phone = () => window.matchMedia(PHONE).matches;
  const sideHas = acts => ({start:!!acts?.start, end:!!acts?.end});

  function layerFor(el, acts) {
    const host = el.parentElement; host.classList.add('row-swipe-host');
    const layer = document.createElement(host.tagName === 'UL' || host.tagName === 'OL' ? 'li' : 'div');
    layer.className = 'row-swipe-acts'; layer.setAttribute('role', 'presentation');
    const btn = (side, a) => a ? `<button type="button" class="row-swipe-act row-swipe-${side} row-swipe-tone-${a.tone || (side === 'end' ? 'danger' : 'info')}" data-row-swipe-act="${side}">${String(a.label).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]))}</button>` : '';
    layer.innerHTML = btn('start', acts.start) + btn('end', acts.end);
    Object.assign(layer.style, {top:el.offsetTop + 'px', height:el.offsetHeight + 'px'});
    el.before(layer); el.classList.add('row-swipe-row');
    return layer;
  }
  function paint(state, x) {
    state.x = x; state.el.style.transform = x ? `translateX(${x}px)` : '';
    for (const b of state.layer.querySelectorAll('[data-row-swipe-act]')) b.style.width = Math.max(SWIPE_BTN, Math.abs(x)) + 'px';
    state.layer.dataset.side = x > 0 ? 'start' : x < 0 ? 'end' : '';
  }
  function drop(state) {
    if (!state) return;
    state.el.classList.remove('row-swipe-row', 'is-drag'); state.el.style.transform = ''; state.layer.remove();
  }
  function close() { const was = open; open = null; drop(was); }
  function fire(state, side) {
    const acts = state.acts, key = acts?.[side]?.key, el = state.el;
    if (open === state) open = null; drop(state);
    if (key && el.isConnected) run(key, el);
  }

  root.addEventListener('pointerdown', e => {
    swallow = false;
    if (open && (!open.el.isConnected || !open.layer.contains(e.target))) { if (!open.el.contains(e.target)) close(); }
    if (e.pointerType !== 'touch' || !phone() || !enabled()) return;
    const el = e.target.closest?.(row); if (!el || !root.contains(el) || e.target.closest(SKIP)) return;
    if (swipeEdge(e.clientX, innerWidth)) return;
    const acts = actions(el); if (!acts?.start && !acts?.end) return;
    const reuse = open?.el === el ? open : null;
    drag = {id:e.pointerId, x:e.clientX, y:e.clientY, el, acts, has:sideHas(acts), from:reuse ? reuse.x : 0, state:reuse, on:false, t:Date.now()};
  });
  root.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.on) {
      const intent = swipeIntent(dx, dy); if (intent === 'wait') return;
      if (intent === 'scroll') { drag = null; return; }
      drag.on = true; claimed = Date.now();
      if (open && open !== drag.state) close();
      drag.state = drag.state || {el:drag.el, acts:drag.acts, layer:layerFor(drag.el, drag.acts), x:0};
      drag.el.classList.add('is-drag'); try { drag.el.setPointerCapture(e.pointerId); } catch { /* 합성 손가락 등: 잡지 못해도 같다. */ }
    }
    e.preventDefault();
    paint(drag.state, rowOffset(dx, drag.from, drag.has, drag.el.offsetWidth));
  });
  const end = e => {
    if (!drag || e.pointerId !== drag.id) return; const d = drag; drag = null;
    if (!d.on) return;
    swallow = true; d.el.classList.remove('is-drag');
    if (e.type === 'pointercancel') { if (open === d.state) paint(d.state, openOffset(open.side)); else drop(d.state); return; }
    const {side, run:now} = rowSettle(d.state.x, d.has, d.el.offsetWidth);
    if (now) { fire(d.state, side); return; }
    if (!side) { if (open === d.state) open = null; drop(d.state); return; }
    d.state.side = side; open = d.state; paint(d.state, openOffset(side));
  };
  root.addEventListener('pointerup', end); root.addEventListener('pointercancel', end);
  root.addEventListener('click', e => {
    const b = e.target.closest?.('[data-row-swipe-act]');
    if (b && open && open.layer.contains(b)) { e.preventDefault(); e.stopImmediatePropagation(); fire(open, b.dataset.rowSwipeAct); }
  }, true);
  // 밀고 손을 뗄 때 따라오는 click은 삼킨다(줄이 열리지 않게). 열린 줄을 다시 누르면 닫기만 한다.
  window.addEventListener('click', e => {
    if (!root.contains(e.target)) return;
    if (swallow) { swallow = false; e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (open && open.el.contains(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); close(); }
  }, true);
  document.addEventListener('pointerdown', e => { if (open && !root.contains(e.target)) close(); }, true);
  window.addEventListener('scroll', e => { if (open && !drag && e.target instanceof Node && e.target.contains?.(open.el)) close(); }, {capture:true, passive:true});
  return {close};
}
