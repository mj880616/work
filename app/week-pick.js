// WEEKLY-메뉴짝짓기 P3(설계 6.1): 주 고르기 공용 부품 `[‹ 11.2~11.8 ›]` — 담당조직 '이번 주 조직보고'·사업 보고 '이번 주 주간보고'가 같은 모양·같은 주 기준(월~일)을 쓴다.
// 그리기만 하고 상태는 부르는 화면이 가진다. 누르면 onChange(새 주 월요일). 지금 주가 아니면 [이번 주] 하나가 더 붙는다.
import {weekLabel, shiftWeek, mondayOf} from './weekly-org-lines-model.mjs';
import {seoulDateKey} from './meeting-time.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const currentWeek = () => mondayOf(seoulDateKey(Date.now()));

export function weekPickHtml(week, {disabled = false} = {}) {
  const dis = disabled ? ' disabled' : '', now = currentWeek();
  return `<span class="week-pick" role="group" aria-label="주 고르기" data-week-pick="${esc(week)}">`
    + `<button type="button" class="week-pick-step" data-week-step="-1" aria-label="지난 주"${dis}>‹</button>`
    + `<span class="week-pick-label" aria-live="polite">${esc(weekLabel(week))}</span>`
    + `<button type="button" class="week-pick-step" data-week-step="1" aria-label="다음 주"${dis}>›</button>`
    + (week !== now ? `<button type="button" class="week-pick-now" data-week-step="0"${dis}>이번 주</button>` : '')
    + '</span>';
}
// 상자 안 주 고르기 버튼을 누르면 새 주를 알려 준다. 한 상자에 한 번만 붙는다.
export function bindWeekPick(host, getWeek, onChange) {
  if (!host || host.dataset.weekPickBound) return;
  host.dataset.weekPickBound = '1';
  host.addEventListener('click', e => {
    const b = e.target.closest?.('[data-week-step]'); if (!b || b.disabled || !host.contains(b)) return;
    const step = Number(b.dataset.weekStep);
    onChange(step === 0 ? currentWeek() : shiftWeek(getWeek(), step));
  });
}
