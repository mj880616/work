// BIZ-기간정하기·BIZ-주차고르기(S54-34, 2026-11-09 시안 docs/design/mockups/period-picker.html·week-number-picker.html 승인):
// 사업 보고 기간 고르기 상자 바로 아래 작은 창 두 가지의 글(HTML)만 만든다 — 상태·저장·이벤트는 team.js, 날짜 계산은 business-area-model.mjs(weekOf 하나).
// 같은 모양: 둥근 테두리 칸 하나(폰은 화면 폭), 맨 아래 오른쪽 작은 [닫기][적용] 나란히(적용만 주 동작).
// - 기간 정하기: ① 기간 칩 한 줄(이번 주·이번 달·지난 달·최근 3달·전체, 공용 ④ 칩 — 누르면 아래 날짜를 채움) ② [시작 날짜] ~ [끝 날짜] 반씩(공용 날짜 칸 date-field.js).
// - 주차 고르기: [2026년 ▾] [46주차 (11.09~11.15) · 이번 주 ▾] 두 드롭다운. 주 = 월~일, 번호 = 국제 표준 주차(ISO 8601).
// 화면 글자는 docs/design/ui-words.md 기준(선택·수정·삭제). 기기에 아무것도 저장하지 않는다.
import {isoWeekOf, isoWeeksIn, isoWeekLabel} from './business-area-model.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const foot = apply => `<div class="report-period-foot"><button type="button" class="mini secondary" data-report-week="cancel">닫기</button><button type="button" class="mini primary" data-report-week="${apply}">적용</button></div>`;

// draft = {from, to, key}: key는 마지막에 누른 칩(날짜를 직접 바꾸면 '').
export function rangePanelHtml(draft, chips) {
  const d = draft || {from: '', to: '', key: ''};
  const chipHtml = (chips || []).map(q => `<button type="button" class="ds-chip" data-report-quick="${esc(q.key)}" aria-pressed="${d.key === q.key}">${esc(q.label)}</button>`).join('');
  return `<div class="report-period-panel" data-report-period-panel="range" role="group" aria-label="기간 설정">`
    + `<div class="report-period-quick" role="group" aria-label="자주 쓰는 기간">${chipHtml}</div>`
    + `<div class="report-period-dates"><input type="date" data-report-from aria-label="시작 날짜" value="${esc(d.from)}"><span class="report-period-tilde" aria-hidden="true">~</span><input type="date" data-report-to aria-label="끝 날짜" value="${esc(d.to)}"></div>`
    + foot('apply') + `</div>`;
}

// 연도 줄: 보고가 있는 가장 이른 해(없으면 작년)부터 내년까지, 최근 해가 위.
export function isoYears(today, firstDay = '') {
  const now = isoWeekOf(today).year, first = firstDay ? Math.min(isoWeekOf(firstDay).year, now - 1) : now - 1;
  const out = [];
  for (let y = now + 1; y >= first; y--) out.push(y);
  return out;
}
// 주차 줄: 그 해 1주차~마지막 주차(52 또는 53), 최근 주가 위. 이번 주에는 '· 이번 주'.
export function isoWeekOptions(year, today) {
  const now = isoWeekOf(today), out = [];
  for (let w = isoWeeksIn(year); w >= 1; w--) out.push({week: w, label: `${isoWeekLabel(year, w)}${year === now.year && w === now.week ? ' · 이번 주' : ''}`});
  return out;
}
// 연도를 바꾸면: 이번 해면 이번 주, 아니면 같은 번호(그 해에 없으면 마지막 주차).
export function isoYearChanged(year, prevWeek, today) {
  const now = isoWeekOf(today);
  return year === now.year ? now.week : Math.min(Math.max(1, prevWeek || 1), isoWeeksIn(year));
}
// draft = {year, week}.
export function weekNumberPanelHtml(draft, today, firstDay = '') {
  const years = isoYears(today, firstDay);
  if (!years.includes(draft.year)) years.push(draft.year), years.sort((a, b) => b - a);
  const yearHtml = years.map(y => `<option value="${y}"${y === draft.year ? ' selected' : ''}>${y}년</option>`).join('');
  const weekHtml = isoWeekOptions(draft.year, today).map(o => `<option value="${o.week}"${o.week === draft.week ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
  return `<div class="report-period-panel" data-report-period-panel="isoweek" role="group" aria-label="주차 선택">`
    + `<div class="report-period-dates report-period-iso"><select data-report-iso-year aria-label="연도">${yearHtml}</select><select data-report-iso-week aria-label="주차">${weekHtml}</select></div>`
    + foot('iso-apply') + `</div>`;
}
// 주 줄·고르기 상자 글자: 'n주차'.
export const weekNumberName = from => `${isoWeekOf(from).week}주차`;
