// S51-22 공용 줄 메뉴(요청함 11/06 19:51): 나무·목록 줄 오른쪽 ⋯를 누르면 화면은 그대로 두고 그 자리에서 작은 메뉴를 연다.
// 폰은 하단바 위에서 올라오는 판, PC·폴드는 줄 옆(공용 anchored-menu — 뒤로가기 한 번 = 닫힘, Esc, 바깥 누름).
// 항목 목록은 부르는 화면이 정한다(그 화면의 기존 기능 그대로). 휴지통 같은 지우기 항목은 last:true로 맨 아래 한 줄(빨강 없음, 묻기는 부르는 쪽).
// S51-27 UI-PC우클릭(시안 docs/design/mockups/pc-rightclick-menu.html): PC 우클릭·Shift+F10·메뉴 키도 이 부품을 누른 자리에 연다(at).
import {createAnchoredMenu} from './anchored-menu.js';
import {NARROW_QUERY} from './screen-width.mjs';

// 폰 한 칸(600px 미만, 공용 판정 screen-width.mjs)만 아래 판. 펼친 폴드·PC는 줄 옆.
let phoneQuery = null;
const phone = () => (phoneQuery ||= window.matchMedia(NARROW_QUERY)).matches;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
let ctx = null, menu = null;

export function rowMenuHtml({title = '', items = [], note = ''} = {}) {
  const list = (items || []).filter(Boolean);
  return (title ? `<p class="row-menu-title">${esc(title)}</p>` : '')
    + list.map(it => `<button type="button" data-row-item="${esc(it.id)}"${it.last ? ' class="row-menu-last"' : ''}${it.disabled ? ' disabled' : ''}${it.popup ? ' aria-haspopup="true"' : ''}>${esc(it.label)}</button>`).join('')
    + (note ? `<p class="od-link-status">${esc(note)}</p>` : '');
}
function ensure() {
  menu ||= createAnchoredMenu({id: 'rowMenu', className: 'od-link-menu row-menu', label: '줄 메뉴', historyKey: 'kptuRowMenu',
    parent: trigger => trigger.closest('[role="dialog"]') || document.body,
    key: () => ctx?.key || 'row',
    sheet: phone, actDetached: true,
    render: () => rowMenuHtml(ctx || {}),
    onAction: (button, previous) => { const c = ctx; if (c && button.dataset.rowItem) c.run(button.dataset.rowItem, previous?.trigger); }});
  return menu;
}
// trigger: 누른 ⋯(우클릭이면 그 줄·칸), key: 그 줄 이름(같은 ⋯를 다시 누르면 닫힘), items: [{id, label, last?, disabled?, popup?}], run(id, trigger),
// at: {x, y} = 누른 자리(appMenuPoint 결과). 없으면 ⋯ 옆.
export function openRowMenu(trigger, {key = '', title = '', items = [], note = '', run, at = null} = {}) {
  const list = (items || []).filter(Boolean);
  if (!trigger || !list.length || typeof run !== 'function') return false;
  ctx = {key: key || 'row', title, items: list, note, run};
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
