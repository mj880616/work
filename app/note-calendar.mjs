// NOTE-달력보기(S67-42, 요청함 11/20 "노트도 달력보기 추가"): 노트 화면 [달력] 보기의 달력 글(HTML)과 순수 규칙(DOM·네트워크 없음).
// 새 달력을 만들지 않고 사업 관리 [달력] 보기(report-views.js calendarHtml)와 같은 부품을 쓴다: 달 계산·고를 날·날짜 머리는
// report-views-model.mjs 그대로, 칸 모양은 같은 rv-* 칸(month-cal.css 한 곳). 기준 날짜는 노트를 만든 날(created_at, 서울 날짜).
// 단추는 공용 6가지(UI-버튼6가지): ‹ ›·날짜 숫자 = icon-btn, [오늘] = secondary(홈 날짜 줄 ‹ › [이번 주]와 같음).
// 칸에는 그날 노트 수(작은 숫자), 오늘 네모·고른 날 동그라미는 앱 공용 표시(.ds-today·.ds-day-sel). 날짜를 누르면 아래에 그날 노트 줄 —
// 줄은 부르는 쪽(basket-notes.js rowHtml, 잠긴 폴더 노트는 '잠김')이 그린다. 상태·저장 없음(고른 달·날은 화면 메모리).
import {WEEKDAYS, monthWeeks, monthTitle, monthKeyOf, pickDay, dayHeading, shiftMonth} from './report-views-model.mjs';
import {seoulDateKey, seoulParts} from './meeting-time.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

// 노트 → 만든 날 'YYYY-MM-DD'(서울). 읽을 수 없으면 ''(달력에 놓지 않음).
export function noteDayKey(note) {
  const t = new Date(note?.created_at || '').getTime();
  return Number.isNaN(t) ? '' : seoulDateKey(new Date(t));
}
// 노트들 → Map(날짜 → 그날 노트, 만든 시각 늦은 순).
export function notesByDay(notes) {
  const map = new Map();
  for (const n of Array.isArray(notes) ? notes : []) {
    const key = noteDayKey(n); if (!key) continue;
    const list = map.get(key) || []; list.push(n); map.set(key, list);
  }
  const at = n => new Date(n?.created_at || '').getTime() || 0;
  for (const list of map.values()) list.sort((a, b) => at(b) - at(a));
  return map;
}
export const monthNow = (now = new Date()) => { const p = seoulParts(now); return {year: p.year, month: p.month}; };
export {shiftMonth};
// 달 넘기기: 'prev' | 'next' | 'today' → {month, day}. 오늘은 그 달·그날을 고르고, 앞뒤는 날 고르기를 비운다(pickDay가 다시 고름).
export function navMonth(month, to, now = new Date()) {
  if (to === 'today') return {month: monthNow(now), day: seoulDateKey(now)};
  return {month: shiftMonth(month, to === 'next' ? 1 : -1), day: ''};
}

// 달력. byDay = notesByDay(보일 노트), rowsHtml(list) = 그날 노트 줄 글(부르는 쪽 부품), noneHtml = 그날 노트가 없을 때 글(공용 빈 줄).
export function noteCalendarHtml({month, selectedDay, todayKey, byDay, rowsHtml, noneHtml = ''}) {
  const selected = pickDay(byDay, month, selectedDay, todayKey);
  const head = `<div class="rv-cal-head"><button type="button" class="icon-btn" data-nt-cal-nav="prev" aria-label="이전 달">‹</button><strong class="rv-cal-title" aria-live="polite">${esc(monthTitle(month))}</strong><button type="button" class="icon-btn" data-nt-cal-nav="next" aria-label="다음 달">›</button><button type="button" class="secondary" data-nt-cal-nav="today">오늘</button></div>`;
  const weekdays = `<thead><tr>${WEEKDAYS.map((w, i) => `<th scope="col"${i === 0 ? ' class="rv-sun"' : i === 6 ? ' class="rv-sat"' : ''}>${w}</th>`).join('')}</tr></thead>`;
  const body = monthWeeks(month).map(week => `<tr>${week.map(c => {
    const count = c.inMonth ? (byDay.get(c.key) || []).length : 0;
    const cls = ['rv-cell', c.inMonth ? '' : 'rv-out', c.key === todayKey ? (c.inMonth ? 'rv-now ds-today' : 'rv-now') : '', c.inMonth && c.key === selected ? 'rv-sel ds-day-sel' : ''].filter(Boolean).join(' ');
    const label = `${dayHeading(c.key)}${count ? ` 노트 ${count}개` : ''}`;
    const num = c.inMonth ? `<button type="button" class="rv-num icon-btn ds-day-num${c.key === todayKey ? ' ds-today-num' : ''}" data-nt-cal-day="${c.key}" aria-pressed="${c.key === selected}" aria-label="${esc(label)}">${c.day}</button>` : `<span class="rv-num rv-num-out" aria-hidden="true">${c.day}</span>`;
    const mark = count ? `<span class="nt-cal-count" aria-hidden="true">${count}</span>` : '';
    return `<td class="${cls}"${c.inMonth ? ` data-nt-cal-cell="${c.key}"` : ''}>${num}${mark}</td>`;
  }).join('')}</tr>`).join('');
  const list = selected ? byDay.get(selected) || [] : [];
  const day = selected ? `<section class="rv-day-list nt-cal-day" data-nt-cal-list="${selected}" aria-label="${esc(dayHeading(selected))}"><h3 class="rv-day-title">${esc(dayHeading(selected))}${list.length ? ` <span class="nt-cal-num">${list.length}</span>` : ''}</h3>${list.length ? rowsHtml(list) : noneHtml}</section>` : '';
  return `<div class="rv-cal nt-cal" data-nt-cal="${monthKeyOf(month)}">${head}<table class="rv-table">${weekdays}<tbody>${body}</tbody></table>${day}</div>`;
}
