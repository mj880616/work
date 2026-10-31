// S46-30(2026-10-31 명진 결정): 할 일 기한 [다음주]의 작은 목록 하나. 누른 버튼 바로 아래(아래가 모자라면 위)에 다음 주 월~일
// 일곱 날('월 11.2' … '일 11.8', 토·일은 옅은 색)을 보이고, 하나를 누르면 onPick(day)만 부른다(저장은 부른 화면이 한다).
// 목록 밖 누르기·Esc·뒤로가기는 목록만 닫는다(저장 없음). 위치·뒤로가기·초점·화면 끝 맞춤은 공용 anchored-menu.js가 맡는다.
// 쓰는 곳: 할 일 수정 창 빠른 기한 줄(google-tasks.js), ⋯ [기한 바꾸기] 날짜 칸(task-inline.js), 홈·정리함 빠른 쓰기 할 일 줄.
import {createAnchoredMenu} from './anchored-menu.js';
import {nextWeekDays} from './task-due.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const dialogOf = el => el?.closest?.('.modal[aria-modal="true"]:not(.hidden)') || document.body;
let menu = null, pick = null;
export function openWeekPick(anchor, {onPick, selected = ''} = {}) {
  if (!anchor?.isConnected) return;
  pick = typeof onPick === 'function' ? onPick : null;
  menu ||= createAnchoredMenu({id:'taskWeekPick', className:'task-inline-menu task-week-menu', label:'다음 주 날짜 고르기', historyKey:'kptuTaskWeekPick',
    parent:dialogOf, key:() => 'week',
    render:() => nextWeekDays().map(d => `<button type="button" data-week-day="${esc(d.day)}"${d.weekend ? ' class="task-week-end"' : ''}${d.day === selected ? ' aria-current="date"' : ''}>${esc(d.label)}</button>`).join(''),
    onAction:button => { const day = button.dataset.weekDay, then = pick; if (day && then) then(day); }});
  anchor.setAttribute('aria-haspopup', 'true'); anchor.setAttribute('aria-controls', 'taskWeekPick');
  menu.open(anchor);
}
export const closeWeekPick = () => menu?.close();
export const weekPickOpen = () => !!menu?.active;
window.addEventListener('kptu:session-changed', () => { if (menu?.active) menu.close(); });
