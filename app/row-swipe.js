// UI-목록밀기(2026-10-30 명진 요청): 폰(≤760px) 목록 줄을 손가락으로 밀어 처리하는 공용 부품. 텔레그램 소식 줄 밀기와 같은 손동작
// (셈은 row-swipe-model.mjs, 텔레그램도 같은 기준을 쓴다).
// UI-줄밀기 Raindrop식(S68-26, 명진 11/22 21:31): 왼쪽으로 밀면 오른쪽 끝에 단추 여러 칸(최대 3, 왼쪽부터 덜 위험한 것 → 맨 오른쪽 삭제),
// 오른쪽으로 밀면 그 줄이 골라진 채로 '여러 개 고르기'(S70-64 W3, 칸을 열어 두지 않음 — 아래 '여러 개 고르기' 설명 — 막대 [전체 선택][삭제], ✕·개수 글자 없음, S70-64b).
// 왼쪽으로 밀면 칸만 보이고 멈춘다. 끝까지 밀어도 바로 실행하지 않는다 — 일은 펼쳐진 칸을 누를 때만(S70-60 UI-스와이프메뉴만, 명진 11/26).
// - 손가락(터치)만, 폰 폭만. PC·중간 폭은 지금처럼 ⋯·우클릭·마우스 올림 단추다. 세로 스크롤과 헷갈리지 않게 가로로 충분히 민 뒤에만 시작한다.
// - 목록 줄 위에서는 줄 밀기가 먼저다: 다른 좌우 밀기(탭 넘김·노트 보기 전환 등)는 claimedSince()로 이 손동작을 건너뛴다.
// - 데이터는 이 부품이 지우지 않는다. run(key, row)·select.run(key, ids)은 그 목록의 기존 길(휴지통 삭제 + '지웠어요 [되돌리기]', 보류, 무시 …)을 부른다.
// - 상태는 화면 메모리에만(열린 줄 하나, 고른 줄 묶음). 기기에 저장하지 않는다.
// 쓰는 법: bindRowSwipe(목록을 담은 고정 칸, {row:'줄 선택자', enabled:()=>bool,
//   actions:row=>({start:PICK|{key,label,tone,icon}|null, end:[{key,label,tone,icon}, …]|{…}|null}), run:(key,row)=>void,
//   select:{attr:'줄 id 속성', acts:()=>[{key,label,danger}], run:(key,ids)=>Promise, open?:row=>void(그 목록에 이미 있는 고르기를 여는 길)}})
import {swipeIntent, swipeEdge, rowOffset, rowSettle, openOffset, cellWidth, endCells, sides, pickedLabel, SWIPE_BTN} from './row-swipe-model.mjs';
import {partStyles} from './part-styles.js';
import {iconSvg} from './tree-icons.js';
import {createSelectMode} from './select-mode.js';
import {sbActHtml, sbAllHtml} from './select-bar-model.mjs';
import {fitSelectBar} from './select-bar.js';
// S67-41: 이 부품의 모양 파일(part-styles.js 표)을 부품이 열리기 전에 붙인다 — 화면 모양 목록에 없어도 꾸밈 없이 그려지지 않게.
await partStyles('row-swipe');

const PHONE = '(max-width:760px)';
const SKIP = 'input,textarea,select,[contenteditable],[data-row-swipe-act]';
// 오른쪽 밀기 한 칸: 여러 개 고르기(노랑 톤, 체크 칸 그림). 화면 글자는 용어 기준표(docs/design/ui-words.md: 고르기 → 선택)를 따른다.
export const PICK = Object.freeze({key:'select', label:'선택', tone:'pick', icon:'pick'});
// 이름이 같은 일은 같은 그림(그 목록이 icon을 주지 않았을 때).
const ICON = {select:'pick', delete:'trash', move:'move', share:'share', hide:'hide', save:'archive', release:'undo', unstar:'undo', toggle:'done', done:'done',
  hold:'archive', unhold:'undo', pin:'pin', dismiss:'hide'};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
let claimed = 0, roots = 0;
// 마지막 줄 밀기가 시작된 때(ms). 다른 좌우 밀기는 자기 손동작 시작 뒤에 줄 밀기가 있었으면 아무것도 하지 않는다.
export const claimedSince = t => claimed >= (Number(t) || 0);

export function bindRowSwipe(root, {row, enabled = () => true, actions, run, select = null}) {
  const none = {close() {}, picking:() => false, stopPicking() {}};
  if (!root || root.dataset.rowSwipe) return none;
  const rootId = String(++roots);
  root.dataset.rowSwipe = rootId;
  let drag = null, open = null, swallow = false;
  const phone = () => window.matchMedia(PHONE).matches;
  const pick = select && !select.open ? createSelectMode({layer:'row-swipe-pick', onBack:() => paintPick()}) : null;
  const picking = () => !!pick?.active;
  // S70-64: 오른쪽 밀기에는 고르기 말고 다른 동작을 두지 않는다 — 고르기가 있는 목록은 start = [선택], 없는 목록은 오른쪽 밀기 없음.
  const actsOf = el => { const a = actions(el); return a ? {...a, start:select && a.start ? PICK : null} : a; };

  function layerFor(el, acts) {
    const host = el.parentElement; host.classList.add('row-swipe-host');
    const layer = document.createElement(host.tagName === 'UL' || host.tagName === 'OL' ? 'li' : 'div');
    layer.className = 'row-swipe-acts'; layer.setAttribute('role', 'presentation');
    const btn = (side, a) => `<button type="button" class="row-swipe-act row-swipe-${side} row-swipe-tone-${esc(a.tone || (side === 'end' ? 'danger' : 'info'))}" data-row-swipe-act="${side}" data-row-swipe-key="${esc(a.key)}" aria-label="${esc(a.label)}"><span class="row-swipe-ic" aria-hidden="true">${iconSvg(a.icon || ICON[a.key] || '', {size:18})}</span><span class="row-swipe-tx">${esc(a.label)}</span></button>`;
    const ends = endCells(acts.end);
    layer.innerHTML = (acts.start ? btn('start', acts.start) : '') + (ends.length ? `<span class="row-swipe-ends">${ends.map(a => btn('end', a)).join('')}</span>` : '');
    Object.assign(layer.style, {top:el.offsetTop + 'px', height:el.offsetHeight + 'px'});
    el.before(layer); el.classList.add('row-swipe-row');
    return layer;
  }
  function paint(state, x) {
    state.x = x; state.el.style.transform = x ? `translateX(${x}px)` : '';
    for (const b of state.layer.querySelectorAll('[data-row-swipe-act="start"]')) b.style.width = Math.max(SWIPE_BTN, x) + 'px';
    for (const b of state.layer.querySelectorAll('[data-row-swipe-act="end"]')) b.style.width = cellWidth(Math.min(0, x), state.has.end) + 'px';
    state.layer.dataset.side = x > 0 ? 'start' : x < 0 ? 'end' : '';
  }
  function drop(state) {
    if (!state) return;
    state.el.classList.remove('row-swipe-row', 'is-drag'); state.el.style.transform = ''; state.layer.remove();
  }
  function close() { const was = open; open = null; drop(was); }
  // 펼쳐진 칸 하나를 눌렀을 때만 부른다(밀기만으로는 부르지 않음).
  function fire(state, key) {
    const el = state.el;
    if (open === state) open = null; drop(state);
    if (!key || !el.isConnected) return;
    if (key === PICK.key && select) { startPick(el); return; }
    run(key, el);
  }

  // ---- 여러 개 고르기(오른쪽 밀기) ----
  // UI-오른쪽밀기고르기(S70-64, 2026-11-26 07:44 명진 "오른쪽으로 밀면 선택이 되는데 이거는 복수선택 용이야 / 선택시 전체선택이랑 삭제 칸이 나와
  //   복수 또는 일괄 삭제 / 전테선택은 누르면 체크표시되고 다시 누르면 전체 선택 해제 / 다 이런식으로 왼쪽에서 오른쪽으로 스와이프 하는 건"):
  // - 줄을 오른쪽으로 반 칸 넘게 밀고 떼면 칸을 열어 두지 않고 그 줄이 골라진 채 고르기 상태가 된다. 고르기 중 줄 누르기 = 고름/풀림.
  // - 위 고르기 막대(공용 .kptu-selbar 모양): [전체 선택](켜면 네모 안 체크 + 화면 목록 전체, 다시 누르면 모두 풀림) · [삭제](맨 끝, 그 목록의
  //   일괄 지우기 — 되돌리기가 있으면 바로, 없으면 확인 한 번은 그 목록 길이 정한다). 읽을 거리만 [저장]이 하나 더(S70-64b).
  //   지우기 길이 없는 목록은 [삭제] 자리에 그 목록의 일괄 동작 하나(무시·보고할 일정·되돌리기)가 온다.
  // - 고른 것이 0개가 되거나 Esc(PC)·뒤로가기(폰, 화면을 떠나지 않음)면 고르기가 끝난다. [✕]·'n개 선택됨' 글자는 없다(S70-64b).
  // 그 목록에 이미 고르기 장치가 있으면(select.open) 그것을 연다. 없으면 이 부품의 공용 고르기: 위쪽 고르기 막대 + 고른 줄 표시.
  // 고른 줄 표시는 줄 id 속성을 가리키는 모양 한 벌(<style>)로 그린다 — 목록이 줄을 다시 그려도 그대로 보이고, 목록 그리기에 끼어들지 않는다.
  let bar = null, look = null, running = false;
  const idOf = el => el?.getAttribute?.(select.attr) || '';
  const shownIds = () => [...root.querySelectorAll(row)].map(idOf).filter(Boolean);
  function startPick(el) {
    if (select.open) { select.open(el); return; }
    pick.start([idOf(el)].filter(Boolean)); paintPick();
  }
  function stopPicking() { if (pick?.stop()) paintPick(); }
  function ensureBar() {
    if (bar?.isConnected) return bar;
    bar ||= document.createElement('div');
    bar.className = 'row-swipe-pickbar kptu-selbar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', select.label || '선택한 줄');
    bar.addEventListener('click', onBar);
    root.before(bar);
    return bar;
  }
  function paintPick() {
    const on = picking();
    if (on) root.dataset.rowPicking = ''; else delete root.dataset.rowPicking;
    look ||= document.createElement('style');
    if (!look.isConnected) document.head.append(look);
    const sel = on ? [...pick.items].map(id => `[data-row-swipe="${rootId}"] [${select.attr}="${CSS.escape(id)}"]`).join(',') : '';
    look.textContent = sel ? `${sel}{background:var(--kptu-warning-soft);box-shadow:inset 3px 0 0 var(--kptu-warning)}` : '';
    if (!on) { if (bar) bar.hidden = true; return; }
    const b = ensureBar(); b.hidden = false;
    const acts = (select.acts?.() || []).filter(a => a && a.key);
    const shown = shownIds(), all = shown.length > 0 && shown.every(id => pick.has(id)), off = !pick.size || running;
    // 지우는 칸(danger)은 맨 끝. 그림: 이름이 같은 일은 같은 그림(줄 밀기 칸과 같은 표).
    const ordered = [...acts.filter(a => !a.danger), ...acts.filter(a => a.danger)];
    const act = a => sbActHtml({attrs:`data-row-pick-act="${esc(a.key)}"${off ? ' disabled' : ''}`, icon:a.danger ? 'trash' : '', label:a.label, danger:!!a.danger, rank:a.danger ? 0 : 10});
    // S70-64b(명진 11/26 07:46 "그만은 필요없어 폰 뒤로가기 버튼 누르면 되고 Pc는 esc가 그거야"): 막대에는 [✕]·'n개 선택됨' 글자를 두지 않는다.
    //   끝내기는 뒤로가기·Esc·[전체 선택] 다시 누르기·마지막 줄 풀기. 고른 개수는 화면 읽기 프로그램에만 알린다(kptu-sb-sr, 눈에는 안 보임).
    b.innerHTML = `<span class="kptu-sb-count kptu-sb-sr row-swipe-pick-count" role="status" aria-live="polite">${esc(pickedLabel(pick.size))}</span>`
      + `<span class="kptu-sb-acts row-swipe-pick-acts">${sbAllHtml({attrs:'data-row-pick-all', on:all, disabled:running || !shown.length})}${ordered.map(act).join('')}</span>`;
    fitSelectBar(b);
  }
  async function onBar(e) {
    const b = e.target.closest?.('button'); if (!b || !picking()) return;
    // [전체 선택]: 화면 목록이 모두 골라져 있으면 모두 풀고(0개 → 고르기 끝), 아니면 모두 고른다.
    if (b.hasAttribute('data-row-pick-all')) { pick.toggle(shownIds(), {anchor:false}); if (!pick.size) stopPicking(); else paintPick(); return; }
    const key = b.dataset.rowPickAct; if (!key || running) return;
    const shown = new Set(shownIds()), ids = [...pick.items].filter(id => shown.has(id));
    if (!ids.length) return;
    running = true; paintPick();
    try { await select.run(key, ids); } finally { running = false; stopPicking(); }
  }
  // S70-64b: Esc = 고르기만 끝. 먼저 받아(capture) 그 키를 여기서 멈춘다 — 목록이 창 안에 있어도(보고 상세 '잊지 말기 후보' 등) 창은 닫히지 않는다.
  if (pick) document.addEventListener('keydown', e => { if (e.key === 'Escape' && picking() && root.isConnected) { e.preventDefault(); e.stopImmediatePropagation(); stopPicking(); } }, true);

  // S68-50(명진 11/23 12:46 "좌우 스와이프 제대로 작동 안함 점검"):
  // - 칸이 열린 채 다른 곳(다른 줄·⋯ 등 목록 안)을 누르면 닫기만 한다 — 그 누름으로 다른 줄이 열리거나 단추가 눌리지 않게(iOS 메일과 같음).
  // - 열린 칸 위에서 시작한 좌우 밀기도 그 줄을 민다(오른쪽으로 밀면 닫힘). 민 뒤 따라오는 click은 삼키므로 칸 단추는 직접 누를 때만 실행된다.
  root.addEventListener('pointerdown', e => {
    // S70-64: 두 번째 손가락이 닿으면(두 손가락 벌리기·오므리기 — 줄 크기 T9) 줄 밀기가 아니다. 밀던 것은 그대로 되돌리고 아무 일도 하지 않는다
    // (오른쪽 밀기가 바로 고르기라, 벌리는 손가락 하나가 오른쪽으로 움직여도 고르기가 켜지지 않게).
    if (drag && e.pointerId !== drag.id) {
      const d = drag; drag = null;
      if (d.on) { d.el.classList.remove('is-drag'); if (open === d.state) paint(d.state, openOffset(open.side, d.has.end)); else drop(d.state); swallow = true; }
      return;
    }
    swallow = false;
    const onCell = !!open && open.el.isConnected && open.layer.contains(e.target);
    if (open && !onCell && !open.el.contains(e.target)) { const shown = open.el.isConnected; close(); swallow = shown; }
    if (e.pointerType !== 'touch' || !phone() || picking() || !enabled()) return;
    const el = onCell ? open.el : e.target.closest?.(row); if (!el || !root.contains(el) || (!onCell && e.target.closest(SKIP))) return;
    if (swipeEdge(e.clientX, innerWidth)) return;
    const acts = actsOf(el), has = sides(acts); if (!has.start && !has.end) return;
    const reuse = open?.el === el ? open : null;
    drag = {id:e.pointerId, x:e.clientX, y:e.clientY, el, acts, has, from:reuse ? reuse.x : 0, state:reuse, on:false, t:Date.now()};
  });
  root.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.on) {
      const intent = swipeIntent(dx, dy); if (intent === 'wait') return;
      if (intent === 'scroll') { drag = null; return; }
      drag.on = true; claimed = Date.now();
      if (open && open !== drag.state) close();
      drag.state = drag.state || {el:drag.el, acts:drag.acts, has:drag.has, layer:layerFor(drag.el, drag.acts), x:0};
      drag.el.classList.add('is-drag'); try { drag.el.setPointerCapture(e.pointerId); } catch { /* 합성 손가락 등: 잡지 못해도 같다. */ }
    }
    e.preventDefault();
    paint(drag.state, rowOffset(dx, drag.from, drag.has, drag.el.offsetWidth));
  });
  const end = e => {
    if (!drag || e.pointerId !== drag.id) return; const d = drag; drag = null;
    if (!d.on) return;
    swallow = true; d.el.classList.remove('is-drag');
    if (e.type === 'pointercancel') { if (open === d.state) paint(d.state, openOffset(open.side, d.has.end)); else drop(d.state); return; }
    const {side, pick:picked} = rowSettle(d.state.x, d.has, d.el.offsetWidth, d.from);
    if (picked) { if (open === d.state) open = null; drop(d.state); if (select && d.el.isConnected) startPick(d.el); return; }
    if (!side) { if (open === d.state) open = null; drop(d.state); return; }
    d.state.side = side; open = d.state; paint(d.state, openOffset(side, d.has.end));
  };
  root.addEventListener('pointerup', end); root.addEventListener('pointercancel', end);
  // S68-50: 줄을 미는 동안의 터치 움직임은 브라우저 몫이 아니다(pointermove의 preventDefault는 터치 스크롤 손동작을 막지 못한다).
  // 막지 않으면 브라우저가 가로 휙 밀기를 '튕기기'로 보고, 바로 다음 누름(열린 칸 [읽음]·닫기 누름)을 튕기기 멈춤으로 삼켜 click이 오지 않았다.
  root.addEventListener('touchmove', e => { if (drag?.on && e.cancelable) e.preventDefault(); }, {passive:false});
  root.addEventListener('click', e => {
    const b = e.target.closest?.('[data-row-swipe-act]');
    if (b && open && open.layer.contains(b)) { e.preventDefault(); e.stopImmediatePropagation(); fire(open, b.dataset.rowSwipeKey); }
  }, true);
  // 밀고 손을 뗄 때 따라오는 click은 삼킨다(줄이 열리지 않게). 열린 줄을 다시 누르면 닫기만 한다.
  // 여러 개 고르기 중에는 줄을 누르면 열지 않고 고르기·풀기만 한다(줄 밖 머리줄·[전체 보기] 같은 단추는 그대로).
  window.addEventListener('click', e => {
    if (!root.contains(e.target)) return;
    if (swallow) { swallow = false; e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (open && open.el.contains(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    if (picking()) {
      const el = e.target.closest?.(row), id = idOf(el); if (!el || !root.contains(el) || !id) return;
      e.preventDefault(); e.stopImmediatePropagation(); pick.toggle([id]);
      if (!pick.size) stopPicking(); else paintPick();
    }
  }, true);
  document.addEventListener('pointerdown', e => { if (open && !root.contains(e.target)) close(); }, true);
  window.addEventListener('scroll', e => { if (open && !drag && e.target instanceof Node && e.target.contains?.(open.el)) close(); }, {capture:true, passive:true});
  return {close, picking, stopPicking};
}
