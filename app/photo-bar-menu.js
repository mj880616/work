// PHOTO-아래줄정돈(S49-34): 사진 아래 줄의 [편집 ▾]·[더보기] 칸이 여는 작은 글자 메뉴 하나(공용 anchored-menu). 아이콘 없이 글자만.
// 항목 목록·글자는 photo-menu-items.mjs(PHOTO_BAR_MENUS·barItemText), 보일지·눌릴지는 부르는 화면이 정해 rows로 준다. 크게 보기(dialog) 안에서 열면 그 안에 둔다.
import {createAnchoredMenu} from './anchored-menu.js';
import {barItemText} from './photo-menu-items.mjs';

let ctx = null, menu = null;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function ensure() {
  menu ||= createAnchoredMenu({id:'photoBarMenu', className:'od-link-menu photo-bar-menu', label:'사진 메뉴', historyKey:'kptuPhotoBarMenu',
    parent:trigger => trigger.closest('[role="dialog"]') || document.body,
    key:() => 'photo-bar',
    // S53-12: why가 있는 항목 = 지금은 못 함(권한·판) — 숨기지도 무반응으로 두지도 않고 흐리게(aria-disabled), 누르면 off(why)로 이유 한 줄.
    render:() => (ctx?.rows || []).map(r => `<button type="button" data-bar-item="${esc(r.id)}"${r.disabled ? ' disabled' : ''}${r.why ? ' aria-disabled="true"' : ''}>${esc(barItemText(r.id))}</button>`).join(''),
    onAction:(button, previous) => {
      const id = button.dataset.barItem, row = (ctx?.rows || []).find(r => r.id === id);
      if (row?.why) ctx?.off?.(row.why); else ctx?.run(id);
      previous?.trigger?.focus?.({preventScroll:true}); // 닫힌 뒤 눌렀던 칸으로 포커스(S 키 별표·키보드 이어서 쓰기)
    }});
  return menu;
}
// rows = [{id, disabled?, why?}] (이미 걸러진 것), run(id)가 항목을 처리, off(why)가 흐린 항목(why)의 이유 한 줄을 보인다. 보일 항목이 없으면 열지 않고 false.
export function openBarMenu(trigger, rows, run, off = null) {
  const list = (rows || []).filter(Boolean);
  if (!trigger || !list.length) return false;
  ctx = {rows:list, run, off};
  ensure().open(trigger);
  return true;
}
