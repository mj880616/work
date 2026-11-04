// MENU-HOME-편집: 줄 끌어 옮기기 공용 부품(메뉴 편집 창·홈 편집). 자료실 폴더 끌기(library-folders.js)와 같은 약속을 쓴다:
// 마우스는 ⠿ 손잡이를 잡고 끌고, 폰은 줄을 길게(LONG_MS) 눌러야 잡혀서 세로 스크롤과 헷갈리지 않는다. 잡기 전에 손가락이 SLOP 넘게 움직이면 그대로 스크롤이고,
// 잡은 뒤에는 스크롤을 막고 손가락을 따라 놓을 자리를 선으로 보인다. 키보드는 손잡이에서 위·아래 화살표(onStep).
// 칸(list)이 여럿이어도 된다(하단바 칸 ↔ [메뉴] 칸). 어디에 놓을지는 dropIndex(가운데 세로 위치 목록, y)로 정한다.
import {dropZone} from './folder-look-model.mjs';
export const LONG_MS = 450, SLOP = 8, MOVED = 12, EDGE = 56;
export function dropIndex(centers, y) {
  let at = 0;
  for (const center of centers) { if (y > center) at++; else break; }
  return at;
}

// root 안의 listSelector 칸들, 칸 안의 itemSelector 줄들. handleSelector는 줄 안 손잡이.
// onDrop({id, list, index}) : list = 칸의 data-reorder-list 값, index = 끌고 있는 줄을 뺀 그 칸 안 자리.
// onStep(id, dir) : 키보드. canDrag(id) : false면 잡히지 않는다(고정 줄).
// axis: 'y'(기본, 위아래 줄) 또는 'x'(가로 칩 줄 — 자료실 묶기 칩 순서). 'x'면 놓을 자리를 가로 가운데 위치로 정한다.
// FOLDER-순서·색 ②(S49-38) 확장 — 다른 사용처는 기본값 그대로(동작 변화 없음):
//  whole: true  → 마우스도 줄 어디를 잡아도 끌린다(손잡이 없이). 줄 안 입력칸·링크·onlyHandleExcept 선택자(기본 ⋯ 단추)는 제외.
//  zones: {resolve(dragId, overId, zone) -> {ok, canInside}} → 줄 위에서 위 25%·가운데 50%·아래 25%(dropZone)를 재서 onHover({id, over, zone})로 알리고,
//         onDrop({id, list, index, over, zone})에 넘긴다. 자리 표시는 화면(onHover)이 그린다. 줄 사이 = 순서, 가운데 = 넣기.
//  onHold(item): 폰에서 줄을 꾹 눌렀다 움직이지 않고 뗐을 때(끌기 아님) 알린다(우클릭과 같은 메뉴를 열 때).
export function mountReorder(root, {listSelector = '[data-reorder-list]', itemSelector = '[data-reorder-id]', handleSelector = '[data-reorder-handle]', onDrop, onStep = () => {}, canDrag = () => true, scroller = () => null, axis = 'y', whole = false, zones = null, onHover = null, onHold = null, wholeExcept = '.basket-row-more,.nx-more'} = {}) {
  let drag = null, touch = null, marker = null, scrollDir = 0, scrollTimer = 0;
  const idOf = el => el?.dataset?.reorderId || '';
  const lists = () => [...root.querySelectorAll(listSelector)];
  const clearMarks = () => {
    root.querySelectorAll('.re-drop-before,.re-drop-end,.re-dragging,.re-grabbed').forEach(el => el.classList.remove('re-drop-before', 're-drop-end', 're-dragging', 're-grabbed'));
    marker = null;
  };
  // zones 모드: 포인터 아래 줄과 그 줄 안 자리(위 25% 앞 / 가운데 50% 안 / 아래 25% 뒤).
  function zoneTarget(x, y) {
    const hit = document.elementFromPoint(x, y), over = hit?.closest?.(itemSelector);
    if (!over || !root.contains(over) || over === drag.el) return null;
    const overId = idOf(over), rule = zones.resolve(drag.id, overId) || {};
    if (rule.ok === false) return null;
    const r = over.getBoundingClientRect();
    return {list: over.closest(listSelector), listId: over.closest(listSelector)?.dataset?.reorderList || '', items: [], index: 0, over: overId, zone: dropZone({top: r.top, height: r.height}, y, {canInside: rule.canInside !== false})};
  }
  function target(x, y) {
    if (zones) return zoneTarget(x, y);
    const hit = document.elementFromPoint(x, y);
    let list = hit?.closest?.(listSelector);
    if (!list || !root.contains(list)) {
      // 칸 사이 틈: y가 가장 가까운 칸으로.
      let best = null, gap = Infinity;
      for (const candidate of lists()) {
        const r = candidate.getBoundingClientRect();
        const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
        if (d < gap) { gap = d; best = candidate; }
      }
      list = best;
    }
    if (!list) return null;
    const items = [...list.querySelectorAll(itemSelector)].filter(el => el !== drag.el);
    const index = axis === 'x'
      ? dropIndex(items.map(el => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; }), x)
      : dropIndex(items.map(el => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; }), y);
    return {list, listId: list.dataset.reorderList || '', items, index};
  }
  function showMark(t) {
    if (zones) return; // 자리 표시는 화면이 onHover로 그린다
    root.querySelectorAll('.re-drop-before,.re-drop-end').forEach(el => el.classList.remove('re-drop-before', 're-drop-end'));
    if (!t) return;
    const before = t.items[t.index];
    (before || t.list).classList.add(before ? 're-drop-before' : 're-drop-end');
  }
  function edgeScroll(y) {
    const box = scroller();
    if (!box) return;
    const r = box.getBoundingClientRect();
    scrollDir = y < r.top + EDGE ? -1 : y > r.bottom - EDGE ? 1 : 0;
    if (scrollDir && !scrollTimer) {
      const step = () => { if (!scrollDir || !drag) { scrollTimer = 0; return; } box.scrollBy(0, scrollDir * 12); scrollTimer = requestAnimationFrame(step); };
      scrollTimer = requestAnimationFrame(step);
    }
  }
  const stopScroll = () => { scrollDir = 0; if (scrollTimer) cancelAnimationFrame(scrollTimer); scrollTimer = 0; };
  function begin(el) { drag = {el, id: idOf(el), drop: null}; el.classList.add('re-dragging'); root.classList.add('re-active'); }
  function move(x, y) {
    if (!drag) return;
    drag.drop = target(x, y); showMark(drag.drop); edgeScroll(y);
    if (zones) onHover?.(drag.drop ? {id: drag.id, over: drag.drop.over, zone: drag.drop.zone} : null);
  }
  function finish(commit) {
    const d = drag;
    drag = null; stopScroll(); clearMarks(); root.classList.remove('re-active');
    if (zones) onHover?.(null);
    if (commit && d?.drop) onDrop?.({id: d.id, list: d.drop.listId, index: d.drop.index, ...(zones ? {over: d.drop.over, zone: d.drop.zone} : {})});
  }

  // 마우스·펜: ⠿ 손잡이를 눌러 4px 넘게 끌면 시작. 포인터를 잡아 두므로 칸 밖으로 나가도 이어진다.
  root.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch' || !event.isPrimary || event.button > 0) return;
    let handle = event.target.closest?.(handleSelector), item = handle?.closest(itemSelector);
    if (!item && whole) { item = event.target.closest?.(itemSelector); handle = item && !event.target.closest('input,textarea,select,a[href],' + wholeExcept) ? item : null; }
    if (!handle || !item || !canDrag(idOf(item))) return;
    const start = {x: event.clientX, y: event.clientY, pointer: event.pointerId};
    const onMove = e => {
      if (e.pointerId !== start.pointer) return;
      if (!drag) { if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4) return; begin(item); try { handle.setPointerCapture(start.pointer); } catch { /* 잡지 못해도 문서 이벤트로 이어진다 */ } }
      e.preventDefault(); move(e.clientX, e.clientY);
    };
    const onEnd = e => {
      if (e.pointerId !== start.pointer) return;
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onEnd); window.removeEventListener('pointercancel', onEnd);
      if (drag) { swallow = true; setTimeout(() => { swallow = false; }, 0); finish(e.type === 'pointerup'); }
    };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onEnd); window.addEventListener('pointercancel', onEnd);
  });
  let swallow = false;
  root.addEventListener('click', event => { if (swallow && (!whole || event.target.closest?.(itemSelector))) { event.preventDefault(); event.stopPropagation(); } }, true); // whole 모드: 줄이 아닌 곳(메뉴·창)의 누르기는 막지 않는다

  // 폰: 줄을 LONG_MS 눌러 두면 잡힌다.
  const cancelTouch = () => { if (touch?.timer) clearTimeout(touch.timer); touch = null; };
  root.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch' || !event.isPrimary) return;
    const item = event.target.closest?.(itemSelector);
    if (!item || !canDrag(idOf(item)) || event.target.closest(whole ? 'input,textarea,select,a[href],' + wholeExcept : 'input,textarea,select,a[href],button:not([data-reorder-handle])')) return;
    cancelTouch();
    touch = {el: item, x: event.clientX, y: event.clientY, grabbed: false, moved: false, timer: setTimeout(() => {
      if (!touch || touch.el !== item) return;
      touch.grabbed = true; begin(item); item.classList.add('re-grabbed'); try { navigator.vibrate?.(12); } catch { /* 진동 없는 기기 */ }
    }, LONG_MS)};
  });
  root.addEventListener('pointermove', event => {
    if (!touch || touch.grabbed || event.pointerType !== 'touch') return;
    if (Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > SLOP) cancelTouch();
  });
  root.addEventListener('pointercancel', event => { if (event.pointerType === 'touch' && touch && !touch.grabbed) cancelTouch(); });
  // 잡은 뒤의 움직임은 touch 이벤트로 받는다(passive:false라야 스크롤을 막을 수 있다).
  root.addEventListener('touchmove', event => {
    if (!touch?.grabbed) return;
    if (event.cancelable) event.preventDefault();
    const p = event.touches[0]; if (!p) return;
    if (Math.hypot(p.clientX - touch.x, p.clientY - touch.y) > MOVED) touch.moved = true;
    if (touch.moved) move(p.clientX, p.clientY);
  }, {passive: false});
  root.addEventListener('touchend', event => {
    if (!touch) return;
    if (!touch.grabbed) { cancelTouch(); return; }
    if (event.cancelable) event.preventDefault();
    const moved = touch.moved, held = touch.el; cancelTouch(); swallow = true; setTimeout(() => { swallow = false; }, 600);
    finish(moved);
    if (!moved) onHold?.(held);
  });
  root.addEventListener('touchcancel', () => { if (touch?.grabbed) { cancelTouch(); finish(false); } else cancelTouch(); });
  // 잡은 직후 따라오는 기본 길게누르기 메뉴는 막는다.
  root.addEventListener('contextmenu', event => { if (touch || drag || (!whole && event.target.closest?.(itemSelector))) event.preventDefault(); });

  root.addEventListener('keydown', event => {
    const handle = event.target.closest?.(handleSelector);
    if (!handle || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || event.altKey || event.ctrlKey || event.metaKey) return;
    const id = idOf(handle.closest(itemSelector));
    if (!id || !canDrag(id)) return;
    event.preventDefault(); onStep(id, event.key === 'ArrowUp' ? -1 : 1);
  });
  return {destroy() { cancelTouch(); finish(false); }};
}
