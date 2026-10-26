// ACT-사진 6단계: 사업 보고 화면의 [달력]·[사진] 보기 그리기. 그리는 주인은 team.js renderMeetings 하나이고, 이 파일은 글(HTML)을 만들고
// 사진 칸을 채우기만 한다(상태·저장 없음). 사업 보고 열기는 목록 줄과 같은 길(data-mrd-meeting, meeting-round-detail.js)이다.
// 사진 격자·크게 보기는 사업 보고 상세 창과 같은 report-photo-row.js mountPhotoGrid(→ file-actions viewDocumentPhotos, photo-view.js nav) 하나를 쓴다.
import {mountPhotoGrid} from './report-photo-row.js';
import {reportPhotosHtml, mountReportPhotos} from './report-photos.js';
import {WEEKDAYS, monthWeeks, monthTitle, monthKeyOf, reportsByDay, cellPlan, pickDay, photoGroups, dayHeading} from './report-views-model.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const dot = color => `<span class="rv-dot" aria-hidden="true"${color ? ` style="--meeting-color:${esc(color)}"` : ''}></span>`;
const openAttrs = id => `role="button" tabindex="0" data-mrd-meeting="${esc(id)}"`;

// 사진 줄 하나: 작은 그림 3장 + '외 n장'(명진 결정). 사진이 없으면 빈 글.
const stripHtml = (m, photos) => (photos?.get?.(m.id)?.length ? reportPhotosHtml(m.id, photos) : '');

// 달력. ctx = {rows, month, selectedDay, todayKey, photos(Map), colorOf(m), nameOf(m), metaOf(m)}
export function calendarHtml(ctx) {
  const {rows, month, todayKey, photos, colorOf, nameOf, metaOf} = ctx;
  const byDay = reportsByDay(rows), selected = pickDay(byDay, month, ctx.selectedDay, todayKey);
  const head = `<div class="rv-cal-head"><button type="button" class="rv-nav" data-rv-nav="prev" aria-label="이전 달">‹</button><strong class="rv-cal-title" aria-live="polite">${esc(monthTitle(month))}</strong><button type="button" class="rv-nav" data-rv-nav="next" aria-label="다음 달">›</button><button type="button" class="rv-nav rv-today" data-rv-nav="today">오늘</button></div>`;
  const weekdays = `<thead><tr>${WEEKDAYS.map((w, i) => `<th scope="col"${i === 0 ? ' class="rv-sun"' : i === 6 ? ' class="rv-sat"' : ''}>${w}</th>`).join('')}</tr></thead>`;
  const body = monthWeeks(month).map(week => `<tr>${week.map(c => {
    const list = c.inMonth ? byDay.get(c.key) || [] : [], plan = cellPlan(list);
    const cls = ['rv-cell', c.inMonth ? '' : 'rv-out', c.key === todayKey ? 'rv-now' : '', c.key === selected ? 'rv-sel' : ''].filter(Boolean).join(' ');
    const label = `${dayHeading(c.key)}${list.length ? ` 사업 보고 ${list.length}건` : ''}`;
    const num = c.inMonth ? `<button type="button" class="rv-num" data-rv-day="${c.key}" aria-pressed="${c.key === selected}" aria-label="${esc(label)}">${c.day}</button>` : `<span class="rv-num rv-num-out" aria-hidden="true">${c.day}</span>`;
    const dots = plan.total ? `<span class="rv-dots" aria-hidden="true">${list.slice(0, 3).map(m => dot(colorOf(m))).join('')}</span>` : '';
    const titles = plan.shown.length ? `<ul class="rv-titles">${plan.shown.map(m => `<li><span class="rv-title" ${openAttrs(m.id)} title="${esc(nameOf(m))}">${dot(colorOf(m))}<span>${esc(nameOf(m))}</span></span></li>`).join('')}${plan.more ? `<li class="rv-more">+${plan.more}</li>` : ''}</ul>` : '';
    return `<td class="${cls}">${num}${dots}${titles}</td>`;
  }).join('')}</tr>`).join('');
  const dayRows = (byDay.get(selected) || []).map(m => `<article class="rv-row" ${openAttrs(m.id)}>${dot(colorOf(m))}<div class="rv-row-main"><h3>${esc(nameOf(m))}</h3><p>${esc(metaOf(m))}</p></div>${stripHtml(m, photos)}</article>`).join('');
  const list = selected ? `<section class="rv-day-list" aria-label="${esc(dayHeading(selected))}"><h3 class="rv-day-title">${esc(dayHeading(selected))}</h3>${dayRows || '<p class="rv-empty">이 날 사업 보고가 없습니다.</p>'}</section>` : '';
  const none = !rows.length ? '<p class="rv-empty">조건에 맞는 사업 보고가 없습니다.</p>' : '';
  return `<div class="rv-cal" data-rv-month="${monthKeyOf(month)}">${head}<table class="rv-table">${weekdays}<tbody>${body}</tbody></table>${list}${none}</div>`;
}

// 사진. ctx = {rows, photos(Map), colorOf, nameOf, kindOf(m)}
export function photoViewHtml(ctx) {
  const {rows, photos, colorOf, nameOf, kindOf} = ctx;
  const groups = photoGroups(rows, photos);
  if (!groups.length) return '<div class="rv-photos"><p class="rv-empty">사진이 있는 사업 보고가 없습니다.</p></div>';
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
