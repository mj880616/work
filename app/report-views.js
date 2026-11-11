import {emptyHtml} from './wait-state.js';
// ACT-사진 6단계: 사업 보고 화면의 [달력]·[사진] 보기 그리기. 그리는 주인은 team.js renderMeetings 하나이고, 이 파일은 글(HTML)을 만들고
// 사진 칸을 채우기만 한다(상태·저장 없음). 사업 보고 열기는 목록 줄과 같은 길(data-mrd-meeting, meeting-round-detail.js)이다.
// 사진 격자·크게 보기는 사업 보고 상세 창과 같은 report-photo-row.js mountPhotoGrid(→ file-actions viewDocumentPhotos, photo-view.js nav) 하나를 쓴다.
import {mountPhotoGrid} from './report-photo-row.js';
import {reportPhotosHtml, mountReportPhotos} from './report-photos.js';
import {WEEKDAYS, monthWeeks, monthTitle, monthKeyOf, reportsByDay, cellPlan, pickDay, photoGroups, dayHeading} from './report-views-model.mjs';
import {seoulClock} from './meeting-time.js';
// S58-10 BIZ-보고할일정 PR C: 달력에 '보고할 일정'(□)·'보고할까요?'(점선 □)을 같이 놓는다. 규칙은 report-calendar-plan.mjs, 읽기·저장은 report-calendar-plans.js(부르는 쪽이 ctx.plan으로 넘김).
import {dayEntries, cellDots, entryMark, itemTime, itemMeta, overdueSummary, shortDay, ENTRY_PLAN} from './report-calendar-plan.mjs';
import {chevHtml} from './fold-chevron.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const dot = color => `<span class="rv-dot" aria-hidden="true"${color ? ` style="--meeting-color:${esc(color)}"` : ''}></span>`;
const openAttrs = id => `role="button" tabindex="0" data-mrd-meeting="${esc(id)}"`;

// 표시 세 가지(시안 ③): ● 쓴 보고(색 점 그대로) · □ 보고할 일정(이름 색 빈 네모) · 점선 □ 보고할까요?(회색 점선 네모).
const markHtml = (mark, color) => (mark === 'todo' || mark === 'ask'
  ? `<span class="rv-dot rv-dot-${mark}" aria-hidden="true"${mark === 'todo' && color ? ` style="--meeting-color:${esc(color)}"` : ''}></span>` : dot(color));
const MARK_WORD = {todo: '보고할 일정', ask: '보고할까요?'};
const MORE_DOTS = '<span class="more-dots" aria-hidden="true">⋯</span>';
// 줄 안 단추(공용 글자 버튼 row-act·아이콘 버튼 icon-btn만 쓴다). 누름은 team.js reportViewClick 한 곳이 받는다.
const writeBtn = item => `<button type="button" class="row-act rv-plan-write" data-rv-plan-write="${esc(item.eventId)}" aria-label="${esc(`보고 쓰기: ${item.title}`)}">보고 쓰기</button>`;
const askBtn = item => `<button type="button" class="row-act rv-plan-ask" data-rv-plan-ask="${esc(item.eventId)}" aria-label="${esc(`보고할까요?: ${item.title}`)}">보고할까요?</button>`;
const moreBtn = item => `<button type="button" class="icon-btn rv-plan-more" data-rv-plan-more="${esc(item.eventId)}" aria-label="${esc(`${item.title} 메뉴`)}" aria-haspopup="true">${MORE_DOTS}</button>`;
const planActs = item => `<span class="rv-plan-acts">${item.status === 'todo' ? writeBtn(item) : askBtn(item)}${moreBtn(item)}</span>`;
// '안 쓴 보고 n' 한 줄(설계 4-4). 누르면 그 목록이 그 자리에서 펼쳐진다(접는 줄은 사이트 공용 <details> + 공용 꺾쇠). 없으면 빈 글.
function overdueHtml(list, colorOf, open) {
  const sum = overdueSummary(list);
  if (!sum) return '';
  const rows = list.map(item => `<li class="rv-due-row" data-rv-plan="${esc(item.eventId)}">${markHtml('todo', colorOf(item))}<span class="rv-due-day">${esc(shortDay(item.day))}</span><span class="rv-due-name" title="${esc(item.title)}">${esc(item.title)}</span>${planActs(item)}</li>`).join('');
  return `<details class="rv-due" data-rv-due${open ? ' open' : ''}><summary><span class="rv-due-text"><b>${esc(sum.lead)}</b>${sum.detail ? ` · ${esc(sum.detail)}` : ''}</span>${chevHtml()}</summary><ul class="rv-due-list">${rows}</ul></details>`;
}
const LEGEND = `<p class="rv-legend" aria-hidden="true"><span>${markHtml('done', '')}쓴 보고</span><span>${markHtml('todo', '')}보고할 일정</span><span>${markHtml('ask', '')}보고할까요?</span></p>`;

// 사진 줄 하나: 작은 그림 3장 + '외 n장'(명진 결정). 사진이 없으면 빈 글.
const stripHtml = (m, photos) => (photos?.get?.(m.id)?.length ? reportPhotosHtml(m.id, photos) : '');

// 달력. ctx = {rows, month, selectedDay, todayKey, photos(Map), colorOf(m), nameOf(m), metaOf(m), plan, planColorOf(item), dueOpen}
// plan = {byDay: Map(날짜 → 보고할 일정 항목), overdue: 안 쓴 보고 항목} | null(표 없는 서버·아직 못 읽음 → 표시 없이 지금 그대로).
export function calendarHtml(ctx) {
  const {rows, month, todayKey, photos, colorOf, nameOf, metaOf} = ctx;
  const plan = ctx.plan || null, planByDay = plan?.byDay || new Map(), planColorOf = ctx.planColorOf || (() => '');
  const byDay = reportsByDay(rows), prefix = monthKeyOf(month) + '-';
  // 고를 날: 보고가 없어도 보고할 일정이 있는 날은 '있는 날'로 친다(이 달에 그런 날뿐이면 그날이 목록에 보이게).
  const dayKeys = new Map(byDay); for (const key of planByDay.keys()) if (!dayKeys.has(key)) dayKeys.set(key, []);
  const selected = pickDay(dayKeys, month, ctx.selectedDay, todayKey);
  const head = `<div class="rv-cal-head"><button type="button" class="rv-nav" data-rv-nav="prev" aria-label="이전 달">‹</button><strong class="rv-cal-title" aria-live="polite">${esc(monthTitle(month))}</strong><button type="button" class="rv-nav" data-rv-nav="next" aria-label="다음 달">›</button><button type="button" class="rv-nav rv-today" data-rv-nav="today">오늘</button></div>`;
  const weekdays = `<thead><tr>${WEEKDAYS.map((w, i) => `<th scope="col"${i === 0 ? ' class="rv-sun"' : i === 6 ? ' class="rv-sat"' : ''}>${w}</th>`).join('')}</tr></thead>`;
  const colorOfEntry = e => (e.type === ENTRY_PLAN ? planColorOf(e.item) : colorOf(e.report));
  const body = monthWeeks(month).map(week => `<tr>${week.map(c => {
    const list = c.inMonth ? byDay.get(c.key) || [] : [], items = c.inMonth ? planByDay.get(c.key) || [] : [];
    const entries = dayEntries(list, items), cell = cellPlan(entries);
    const todo = items.filter(i => i.status === 'todo').length, ask = items.length - todo;
    const counts = [list.length ? `사업 보고 ${list.length}건` : '', todo ? `보고할 일정 ${todo}건` : '', ask ? `보고할까요? ${ask}건` : ''].filter(Boolean).join(' · ');
    const cls = ['rv-cell', c.inMonth ? '' : 'rv-out', c.key === todayKey ? (c.inMonth ? 'rv-now ds-today' : 'rv-now') : '', c.key === selected ? 'rv-sel ds-day-sel' : ''].filter(Boolean).join(' ');
    const label = `${dayHeading(c.key)}${counts ? ` ${counts}` : ''}`;
    const num = c.inMonth ? `<button type="button" class="rv-num${c.key === todayKey ? ' ds-today-num' : ''}" data-rv-day="${c.key}" aria-pressed="${c.key === selected}" aria-label="${esc(label)}">${c.day}</button>` : `<span class="rv-num rv-num-out" aria-hidden="true">${c.day}</span>`;
    // 점(폰): 3개까지. 넘치면 종류마다 하나씩은 보이게 고른다(cellDots) — 점만 보고도 쓸 보고가 있는 날을 안다.
    const dots = cell.total ? `<span class="rv-dots" aria-hidden="true">${cellDots(entries).map(e => markHtml(entryMark(e), colorOfEntry(e))).join('')}</span>` : '';
    // BIZ-달력그날창: 칸에 4줄까지(cellPlan). 넘는 날만 마지막 줄 자리에 '+n' 단추 — 누르면 그날 창(team.js reportViewClick → calendar-day-overflow.js).
    // 보고할 일정(□) 줄은 누르면 보고 쓰기 창, 보고할까요?(점선 □) 줄은 단추가 아니다(칸을 누르면 그날 목록에 [보고할까요?]가 나온다).
    const line = e => {
      if (e.type !== ENTRY_PLAN) return `<li><span class="rv-title" ${openAttrs(e.report.id)} title="${esc(nameOf(e.report))}">${dot(colorOf(e.report))}<span>${esc(nameOf(e.report))}</span></span></li>`;
      const item = e.item, mark = markHtml(item.status, planColorOf(item)), tip = esc(`${item.title} · ${MARK_WORD[item.status]}`);
      return item.status === 'todo'
        ? `<li><span class="rv-title rv-plan" role="button" tabindex="0" data-rv-plan="${esc(item.eventId)}" data-rv-plan-write="${esc(item.eventId)}" title="${tip}" aria-label="${esc(`보고 쓰기: ${item.title}`)}">${mark}<span>${esc(item.title)}</span></span></li>`
        : `<li><span class="rv-title rv-plan rv-plan-wait" data-rv-plan="${esc(item.eventId)}" title="${tip}">${mark}<span>${esc(item.title)}</span></span></li>`;
    };
    const titles = cell.shown.length ? `<ul class="rv-titles">${cell.shown.map(line).join('')}${cell.more ? `<li><button type="button" class="row-act rv-more" data-rv-more="${c.key}" aria-haspopup="dialog" aria-label="${esc(`${dayHeading(c.key)} ${counts} 모두 보기`)}">+${cell.more}</button></li>` : ''}</ul>` : '';
    // S57-8 BIZ-달력우클릭끌기 ④: 이번 달 칸은 칸 전체가 '그날 고르기'(숫자·점·빈 곳·+n 어디든). 숫자 단추는 키보드·화면 읽기용으로 그대로 둔다.
    return `<td class="${cls}"${c.inMonth ? ` data-rv-cell="${c.key}"` : ''}>${num}${dots}${titles}</td>`;
  }).join('')}</tr>`).join('');
  // 그날 목록: 보고(누르면 열림)와 보고할 일정(오른쪽 [보고 쓰기]·[보고할까요?] + ⋯)을 시각 순으로 한 목록에.
  const dayRows = dayEntries(byDay.get(selected) || [], planByDay.get(selected) || []).map(e => {
    if (e.type !== ENTRY_PLAN) { const m = e.report; return `<article class="rv-row" ${openAttrs(m.id)}>${dot(colorOf(m))}<div class="rv-row-main"><h3>${esc(nameOf(m))}</h3><p>${esc(metaOf(m))}</p></div>${stripHtml(m, photos)}</article>`; }
    const item = e.item;
    return `<article class="rv-row rv-plan-row" data-rv-plan="${esc(item.eventId)}" data-rv-plan-status="${item.status}">${markHtml(item.status, planColorOf(item))}<div class="rv-row-main"><h3>${esc(item.title)}</h3><p>${esc(itemMeta(item))}</p></div>${planActs(item)}</article>`;
  }).join('');
  const list = selected ? `<section class="rv-day-list" aria-label="${esc(dayHeading(selected))}"><h3 class="rv-day-title">${esc(dayHeading(selected))}</h3>${dayRows || emptyHtml()}</section>` : '';
  const monthHasPlan = [...planByDay.keys()].some(key => key.startsWith(prefix));
  const none = !rows.length && !monthHasPlan ? emptyHtml('맞는 사업 보고 없음') : '';
  const due = plan ? overdueHtml(plan.overdue || [], planColorOf, !!ctx.dueOpen) : '';
  return `<div class="rv-cal" data-rv-month="${monthKeyOf(month)}">${due}${head}${monthHasPlan ? LEGEND : ''}<table class="rv-table">${weekdays}<tbody>${body}</tbody></table>${list}${none}</div>`;
}

// BIZ-달력그날창: '+n' 그날 창에 넣을 줄(창 자체는 일정 달력과 같은 calendar-day-overflow.js, 여닫기는 report-calendar-actions.js showReportDayWindow).
// 줄마다 색 점·이름·시각, 맨 아래 [+ 이날 사업 보고 추가](글자 버튼 row-act — 칸의 '+n'도 같은 글자 버튼). 줄은 칸 안 제목과 같은 data-mrd-meeting이라 우클릭 메뉴·끌어 옮기기가 같은 길이고,
// data-rv-from은 끌어 옮길 때의 '원래 날'이다. ctx = {day, list(그날 보고, 이른 순), colorOf(m), nameOf(m)}
export function dayWindowHtml({day, list, colorOf, nameOf, plans = [], planColorOf = () => ''}) {
  // S58-10: 그날의 보고할 일정도 같은 표시(□·점선 □)로 같은 창에 나온다. 그 줄은 보고가 아니라 끌어 옮기지 않고(data-mrd-meeting 없음), 오른쪽 글자 단추로 [보고 쓰기]·[보고할까요?].
  const rows = dayEntries(Array.isArray(list) ? list : [], plans).map(e => {
    if (e.type === ENTRY_PLAN) {
      const item = e.item, time = itemTime(item);
      return `<li><div class="rv-pop-row rv-pop-plan" data-rv-plan="${esc(item.eventId)}" title="${esc(item.title)}">${markHtml(item.status, planColorOf(item))}<span class="rv-pop-name">${esc(item.title)}</span><span class="rv-pop-time">${esc(time)}</span>${item.status === 'todo' ? writeBtn(item) : askBtn(item)}</div></li>`;
    }
    const m = e.report, name = nameOf(m), time = m?.meeting_at ? seoulClock(m.meeting_at) : '';
    return `<li><div class="rv-pop-row" ${openAttrs(m.id)} data-rv-from="${esc(day)}" title="${esc(name)}" aria-label="${esc([time, name].filter(Boolean).join(' '))}">${dot(colorOf(m))}<span class="rv-pop-name">${esc(name)}</span>${time ? `<time class="rv-pop-time">${esc(time)}</time>` : ''}</div></li>`;
  }).join('');
  return `<div class="rv-pop" data-rv-pop="${esc(day)}"><ul class="rv-pop-list">${rows}</ul><div class="rv-pop-foot"><button type="button" class="row-act rv-pop-add" data-rv-pop-add="${esc(day)}">+ 이날 사업 보고 추가</button></div></div>`;
}

// 사진. ctx = {rows, photos(Map), colorOf, nameOf, kindOf(m)}
export function photoViewHtml(ctx) {
  const {rows, photos, colorOf, nameOf, kindOf} = ctx;
  const groups = photoGroups(rows, photos);
  if (!groups.length) return `<div class="rv-photos">${emptyHtml()}</div>`;
  return `<div class="rv-photos">${groups.map(g => `<section class="rv-photo-day" data-rv-photo-day="${esc(g.day)}"><h3 class="rv-day-title">${esc(g.day ? dayHeading(g.day) : '날짜 없음')}</h3>${g.items.map(({meeting: m, photos: list}) => `<div class="rv-set" data-rv-set="${esc(m.id)}"><div class="rv-set-head" ${openAttrs(m.id)} aria-label="사업 보고 열기: ${esc(nameOf(m))}">${dot(colorOf(m))}<span class="rv-set-title">${esc(nameOf(m))}</span><span class="rv-set-meta">${esc([kindOf(m), `사진 ${list.length}`].filter(Boolean).join(' · '))}</span></div><div class="act-photo-grid rv-grid" data-rv-grid="${esc(m.id)}"></div></div>`).join('')}</section>`).join('')}</div>`;
}

// 사진 칸 채우기. 보이는 칸만 받는다(report-photos.js IntersectionObserver). 크게 보기 ⋯에 [사업 보고 열기].
export function mountPhotoView(box, {rows, photos, api, onError = () => {}, openReport}) {
  const byId = new Map(rows.map(m => [m.id, m]));
  box.querySelectorAll('[data-rv-grid]').forEach(grid => {
    const id = grid.dataset.rvGrid;
    mountPhotoGrid(grid, photos.get(id) || [], {api, onError, extraActions: () => (byId.has(id) ? [{label: '사업 보고 열기', run: () => { void openReport(id); return true; }}] : [])});
  });
}
export const mountStrips = (box, isCurrent) => mountReportPhotos(box, {isCurrent});
