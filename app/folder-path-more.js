// S69-19(사용자 11/24 '자료실 폴더 안에서 목록으로 돌아가기 쉽게'): 위치 줄 가운데 '…'(folder-path.mjs moreStepHtml)를 누르면
// 가려진 단계 이름의 작은 목록(공용 anchored-menu 상자). 고르면 그 위치 줄 안에 숨겨 둔 같은 단계 단추(data-fp-hidden)를 대신 눌러
// 화면마다 이미 있는 처리(자료실 data-lu-path·두 칸 data-lu-pane-go·노트 data-nx-at·사진 data-photos-*-at)를 그대로 탄다.
// 화면 하나에 상자 하나, 처음 누를 때 만든다. 기기 저장 없음.
import {createAnchoredMenu} from './anchored-menu.js';

let menu = null;
const navOf = el => el?.closest?.('nav, .lu-pane-path, .ft-focus-anc, .fp-path') || el?.parentElement || null;
const hiddenOf = trigger => [...(navOf(trigger)?.querySelectorAll('[data-fp-hidden]') || [])];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

function ensure() {
  menu ||= createAnchoredMenu({id: 'fpMoreMenu', className: 'fp-more-menu', label: '가려진 위치', historyKey: 'kptuFolderPathMore',
    key: () => 'more', boxWidth: 220, // render는 open 안에서 active(누른 '…')를 정한 뒤 불린다.
    render: () => hiddenOf(menu?.active?.trigger)
      .map((b, k) => `<button type="button" class="row-act" data-fp-pick="${k}">${esc(b.textContent)}</button>`).join(''),
    onAction: (button, previous) => {
      const k = Number(button.dataset.fpPick);
      hiddenOf(previous.trigger)[k]?.click();
    }});
  return menu;
}
if (typeof document !== 'undefined') document.addEventListener('click', e => {
  const b = e.target.closest?.('[data-fp-more]');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  ensure().open(b);
});
