// STD C10 표 칸 메뉴(WEEKLY-화면정돈 ②, 2026-11-28 사용자 "수정 창은 표의 경우 각각 셀 마다 수정 가능하게" / "우클릭 후 수정 방식으로 pc에선"):
// 표 칸(셀) 하나하나를 따로 고치는 공용 부품. PC 마우스 우클릭·Shift+F10·메뉴 키 = 그 칸 메뉴를 누른 자리에, 폰·손가락 꾹 누르기(0.5초, 움직이지 않고)
// = 같은 메뉴를 손을 뗄 때 누른 자리 아래에(진동 한 번, 뗄 때 따라오는 누름은 삼킴). 메뉴 모양·닫기는 공용 줄 메뉴(row-menu.js → anchored-menu.js, C8).
// - 항목·하는 일은 부르는 화면이 정한다(items(cell) → [{id, label, last?, off?}], run(id, cell)). 항목이 없으면 브라우저 메뉴 그대로.
// - 칸 안 입력·글상자(고치는 중)·글을 골라 둔 때·Shift/Ctrl/Alt/Meta 우클릭은 브라우저 메뉴 그대로. 칸 안 단추·링크는 skip 으로 뺄 수 있다.
// - 표 칸은 줄 고르기(P4)가 없는 곳이라 꾹 누르기 = 칸 메뉴다(P4·C6의 '꾹 누르기 = 고르기'는 고르기가 있는 목록 줄).
// - 이 부품은 아무것도 저장하지 않는다(기기 저장 없음).
import {openRowMenu} from './row-menu.js';

const HOLD_MS = 500, MOVE_PX = 10;
const EDITABLE = 'input,textarea,select,[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]';

export function bindCellMenu(root, {cell, items, run, skip = ''}) {
  if (!root || root.dataset.cellMenu === '1') return;
  root.dataset.cellMenu = '1';
  const cellOf = target => { const el = target instanceof Element ? target.closest(cell) : null; return el && root.contains(el) ? el : null; };
  const blocked = target => !!target.closest(EDITABLE) || (!!skip && !!target.closest(skip));
  const open = (el, at) => {
    const list = (items(el) || []).filter(Boolean);
    if (!list.length) return false;
    return openRowMenu(el, {key: `cell:${el.dataset.cellKey || ''}`, label: el.dataset.cellLabel || el.getAttribute('aria-label') || '', items: list, at, row: el, run: id => run(id, el)});
  };
  let hold = null, swallow = false;
  root.addEventListener('contextmenu', e => {
    const el = cellOf(e.target);
    if (!el || blocked(e.target)) return;
    // 손가락 꾹 누르기가 부르는 contextmenu(안드로이드)는 브라우저 메뉴만 막고, 메뉴는 손을 뗄 때 연다.
    if (hold || e.pointerType === 'touch') { e.preventDefault(); return; }
    if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    const sel = window.getSelection?.();
    if (sel && !sel.isCollapsed && sel.toString().trim() !== '') return;
    let at;
    if (e.button !== 2 || (!e.clientX && !e.clientY)) { const r = el.getBoundingClientRect(); at = {x: Math.round(r.left + Math.min(r.width / 2, 24)), y: Math.round(r.top + Math.min(r.height, 28))}; }
    else at = {x: e.clientX, y: e.clientY};
    if (open(el, at)) e.preventDefault();
  });
  root.addEventListener('pointerdown', e => {
    swallow = false;
    if (e.pointerType !== 'touch') return;
    const el = cellOf(e.target);
    if (!el || blocked(e.target)) return;
    clearTimeout(hold?.timer);
    const h = {el, x: e.clientX, y: e.clientY, held: false};
    h.timer = setTimeout(() => { if (hold !== h) return; h.held = true; try { navigator.vibrate?.(10); } catch { /* 진동 없음 */ } }, HOLD_MS);
    hold = h;
  });
  const end = e => {
    const h = hold; if (!h) return;
    if (e.type === 'pointermove' && Math.hypot(e.clientX - h.x, e.clientY - h.y) < MOVE_PX) return;
    clearTimeout(h.timer); hold = null;
    if (e.type !== 'pointerup' || !h.held || !h.el.isConnected) return;
    swallow = true;
    open(h.el, {x: h.x, y: h.y + 4});
  };
  for (const type of ['pointermove', 'pointerup', 'pointercancel']) root.addEventListener(type, end);
  root.addEventListener('click', e => { if (swallow) { swallow = false; e.preventDefault(); e.stopPropagation(); } }, true);
}
