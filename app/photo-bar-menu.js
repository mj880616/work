// PHOTO-아래줄정돈(S49-34): 사진 아래 줄의 [편집 ▾]·[더보기] 칸이 여는 작은 글자 메뉴 하나(공용 anchored-menu). 아이콘 없이 글자만.
// 항목 목록·글자는 photo-menu-items.mjs(PHOTO_BAR_MENUS·barItemText), 보일지·눌릴지는 부르는 화면이 정해 rows로 준다. 크게 보기(dialog) 안에서 열면 그 안에 둔다.
import {createAnchoredMenu} from './anchored-menu.js';
import {barItemText} from './photo-menu-items.mjs';

let ctx = null, menu = null;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function ensure() {
  menu ||= createAnchoredMenu({id:'photoBarMenu', className:'od-link-menu photo-bar-menu', label:'사진 더보기', historyKey:'kptuPhotoBarMenu',
    parent:trigger => trigger.closest('[role="dialog"]') || document.body,
    key:() => 'photo-bar',
    render:() => (ctx?.rows || []).map(r => `<button type="button" data-bar-item="${esc(r.id)}"${r.disabled ? ' disabled' : ''}>${esc(barItemText(r.id))}</button>`).join(''),
    onAction:(button, previous) => { ctx?.run(button.dataset.barItem); previous?.trigger?.focus?.({preventScroll:true}); }}); // 닫힌 뒤 눌렀던 칸으로 포커스(S 키 별표·키보드 이어서 쓰기)
  return menu;
}
// rows = [{id, disabled?}] (이미 걸러진 것), run(id)가 항목을 처리. 보일 항목이 없으면 열지 않고 false.
export function openBarMenu(trigger, rows, run) {
  const list = (rows || []).filter(Boolean);
  if (!trigger || !list.length) return false;
  ctx = {rows:list, run};
  ensure().open(trigger);
  return true;
}
