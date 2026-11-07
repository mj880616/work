// S51-22 공용 줄 메뉴(요청함 11/06 19:51): 나무·목록 줄 오른쪽 ⋯를 누르면 화면은 그대로 두고 그 자리에서 작은 메뉴를 연다.
// S51-31 UI-⋯작은메뉴(요청함 11/06 23:28, 시안 docs/design/mockups/more-menu-and-fold-chevron.html ②): 폰·폴드·PC 모두 같은 작은 상자.
// 누른 ⋯ 바로 아래(모자라면 위), 그 줄은 가리지 않고 연보라(선택 색)로 표시, 아래 바 위. 폭 약 180px·줄 34px·작은 선 아이콘 + 글자 13px.
// 뒤로가기 한 번 = 닫힘, Esc, 바깥 누름(공용 anchored-menu). 항목 목록·순서는 부르는 화면이 정한다(그 화면의 기존 기능 그대로).
// 항목: sep:true = 그 위에 가는 선(묶음 나눔), last:true = 맨 아래 한 줄(휴지통·삭제 — 빨강, 묻기는 부르는 쪽). icon은 id로 고르고(ROW_MENU_ICON), 따로 주면 그것.
// S51-27 UI-PC우클릭(시안 docs/design/mockups/pc-rightclick-menu.html): PC 우클릭·Shift+F10·메뉴 키도 이 부품을 누른 자리에 연다(at).
import {createAnchoredMenu} from './anchored-menu.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
let ctx = null, menu = null, owner = null;
// 16px 선 아이콘(글자 색을 따름 — 휴지통은 빨강). 경로만 두고 그리는 곳은 rowMenuHtml 하나.
const PEN = 'M3 13l1-3 7-7 2 2-7 7z', BIN = 'M3 4h10M6 4V2.5h4V4M4.5 4l.7 9h5.6l.7-9', CAL = 'M3 4h10v9H3zM3 7h10M6 2.5v3M10 2.5v3';
const STAR = 'M8 2.5l1.7 3.5 3.8.5-2.8 2.6.7 3.8L8 11l-3.4 1.9.7-3.8L2.5 6.5l3.8-.5z';
const SHELF = 'M3 3h3v10H3zM7 3h3v10H7zM11 4.5l2-.5 1.5 8.5-2 .5z'; // 자료실(책꽂이)
export const ROW_MENU_ICON = Object.freeze({
  open: 'M6.5 3H3v10h10V9.5M9 3h4v4M13 3L7.5 8.5', only: 'M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3', mkdir: 'M8 3.5v9M3.5 8h9',
  upload: 'M8 11V3M5 6l3-3 3 3M3 13h10', copy: 'M5 5h8v8H5zM3 10V3h7', move: 'M2 8h10M9 5l3 3-3 3',
  tocloud: 'M4.5 12.5h7a2.5 2.5 0 0 0 .4-5A3.6 3.6 0 0 0 5 6.6a3 3 0 0 0-.5 5.9z', rename: PEN, edit: PEN,
  star: STAR, unstar: STAR, color: 'M8 3a5 5 0 1 0 0 10 5 5 0 1 0 0-10zM8 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3z',
  up: 'M8 13V3M4 7l4-4 4 4', down: 'M8 3v10M4 9l4 4 4-4', trash: BIN, delete: BIN,
  orgs: 'M7 9l2-2M5.5 7.5l-1.3 1.3a2 2 0 0 0 2.9 2.9l1.3-1.3M10.5 8.5l1.3-1.3a2 2 0 0 0-2.9-2.9L7.6 5.6', report: 'M4 2.5h8v11H4zM6 6h4M6 8.5h4M6 11h2',
  tolib: SHELF, libview: SHELF, event: CAL, day: CAL, task: 'M3 3h10v10H3zM5.5 8l2 2 3-4'
});
const icoHtml = d => `<svg class="row-menu-ico" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${d ? `<path d="${esc(d)}"/>` : ''}</svg>`;
// 어느 줄의 메뉴인지: 우클릭(at)은 누른 칸·줄 자체, ⋯는 그 ⋯가 든 줄(.ft-row 등, 화면이 data-row-menu-row로 정할 수도 있음).
const ROW = '[data-row-menu-row],.ft-row,[role="row"],tr';
const rowOf = trigger => trigger?.closest?.(ROW) || trigger || null;
function mark(el) {
  if (owner === el) return;
  owner?.classList.remove('row-menu-owner');
  owner = el || null;
  owner?.classList.add('row-menu-owner');
}

export function rowMenuHtml({title = '', items = [], note = ''} = {}) {
  const list = (items || []).filter(Boolean), icons = list.some(it => it.icon || ROW_MENU_ICON[it.id]);
  return (title ? `<p class="row-menu-title">${esc(title)}</p>` : '')
    + list.map((it, i) => {
      const cls = [it.last ? 'row-menu-last' : '', it.sep && i && !it.last ? 'row-menu-sep' : ''].filter(Boolean).join(' ');
      return `<button type="button" data-row-item="${esc(it.id)}"${cls ? ` class="${cls}"` : ''}${it.disabled ? ' disabled' : ''}${it.popup ? ' aria-haspopup="true"' : ''}>`
        + `${icons ? icoHtml(it.icon || ROW_MENU_ICON[it.id]) : ''}<span>${esc(it.label)}</span></button>`;
    }).join('')
    + (note ? `<p class="od-link-status">${esc(note)}</p>` : '');
}
function ensure() {
  menu ||= createAnchoredMenu({id: 'rowMenu', className: 'od-link-menu row-menu', label: '줄 메뉴', historyKey: 'kptuRowMenu',
    parent: trigger => trigger.closest('[role="dialog"]') || document.body,
    key: () => ctx?.key || 'row',
    row: trigger => ctx?.row || rowOf(trigger), boxWidth: 180, actDetached: true,
    render: () => rowMenuHtml(ctx || {}),
    onOpen: (trigger, panel) => {
      mark(ctx?.row || rowOf(trigger));
      const name = ctx?.label || ctx?.title;
      panel.setAttribute('aria-label', name ? `${name} 메뉴` : '줄 메뉴');
    },
    onClose: () => { if (!menu?.active) mark(null); },
    onAction: (button, previous) => { const c = ctx; if (c && button.dataset.rowItem) c.run(button.dataset.rowItem, previous?.trigger); }});
  return menu;
}
// trigger: 누른 ⋯(우클릭이면 그 줄·칸), key: 그 줄 이름(같은 ⋯를 다시 누르면 닫힘), items: [{id, label, icon?, sep?, last?, disabled?, popup?}], run(id, trigger),
// at: {x, y} = 누른 자리(appMenuPoint 결과). 없으면 ⋯ 바로 아래. row: 연보라로 표시할 줄(없으면 ⋯가 든 줄, 우클릭이면 누른 칸).
// title: 메뉴 머리 글자(달력 날짜 칸처럼 누른 자리만으로 무엇인지 모를 때만). 줄이 표시되면 이름을 되풀이하지 않는다. 읽기 프로그램용 이름은 늘 붙는다.
export function openRowMenu(trigger, {key = '', title = '', label = '', items = [], note = '', run, at = null, row = null} = {}) {
  const list = (items || []).filter(Boolean);
  if (!trigger || !list.length || typeof run !== 'function') return false;
  ctx = {key: key || 'row', title, label, items: list, note, run, row: row || (at ? trigger : null)};
  ensure().open(trigger, {at});
  return true;
}
export const rowMenuOpen = () => !!menu?.active;

// S51-27 PC 우클릭 공용 규칙: 앱 메뉴를 열 자리 {x, y}를 돌려주고, 브라우저 기본 메뉴를 그대로 둘 때는 null.
// 기본 메뉴 그대로: 폰 폭(761px 미만)·손가락 꾹 누르기, 글자 칸(입력·메모·본문) 안, 글을 골라 둔 때, 마우스 우클릭에 Shift·Ctrl·Alt·Meta.
// 키보드(Shift+F10·메뉴 키)는 마우스 단추가 아니므로(button≠2) 받아서, 포커스 받은 줄(el) 왼쪽 아래에 연다.
const EDITABLE = 'input,textarea,select,[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]';
export function appMenuPoint(e, el = e?.target) {
  if (!e || e.defaultPrevented || e.pointerType === 'touch') return null;
  if (!window.matchMedia('(min-width:761px)').matches) return null;
  const target = e.target instanceof Element ? e.target : null;
  if (!target || target.closest(EDITABLE)) return null;
  const keyboard = e.button !== 2;
  if (!keyboard && (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey)) return null;
  const selection = window.getSelection?.();
  if (selection && !selection.isCollapsed && selection.toString().trim() !== '') return null;
  if (keyboard || (!e.clientX && !e.clientY)) {
    const r = (el instanceof Element ? el : target).getBoundingClientRect();
    return {x: Math.round(r.left + Math.min(r.width / 2, 24)), y: Math.round(r.top + Math.min(r.height, 28))};
  }
  return {x: e.clientX, y: e.clientY};
}
