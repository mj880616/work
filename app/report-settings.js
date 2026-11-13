// MULTI-노조사용자 ②-3(D5, S50-13) → MULTI-다른담당자맞춤 ②·③(명진 11/13 15:30): 내 프로필 '주간보고 일정 캘린더' 칸 하나.
// 담당조직 묶음·순서와 제외는 조직 보고 화면에서 바로 한다(묶음 끌기 org-groups-drag.js, 줄 ⋯ [담당 조직에서 제외]) — 여기 글자 칸은 없앴다.
// 값은 내 프로필 화면 기억(view-prefs.js report_calendar) 하나(새 표·새 저장소 없음, 기기 저장 없음). 칸은 접힌 한 줄로 시작하고 저장은 이 칸만 따로.
// 캘린더는 이름을 치지 않고 연결된 구글 캘린더 목록에서 선택한다(값은 그대로 캘린더 이름). 목록은 펼칠 때 한 번 읽고
// (google-calendar status, calendar-ref-data.js readCalendars), 연결 전이면 연결 안내만. 지금 값이 목록에 없으면 '(목록에 없음)'으로 남긴다.
// 서버 검사가 받지 않으면 값은 되돌아가고 한 줄로 알린다.
import {viewPrefs} from './view-prefs.js';
import {readCalendars} from './calendar-ref-data.js';
import {parseCalendar} from './report-settings-model.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export const summaryText = calendar => (calendar ? `'${calendar}'` : '미지정');

// 캘린더 선택 칸. cals: null(읽는 중) | {connected, calendars:[{id, summary}]} | {failed:true}
export function calendarFieldHtml(calendar, cals, busy = false) {
  const head = `<small>주간보고 '주요 일정'에 넣을 일정이 있는 구글 캘린더</small>`;
  if (cals && !cals.failed && !cals.connected) {
    return `<div class="ps-report-field" data-ps-report-cal="unconnected">${head}<p class="ps-report-note">구글 캘린더를 연결하면 여기서 선택할 수 있어요.${calendar ? ` 지금: '${esc(calendar)}'` : ''} <button type="button" class="secondary" data-ps-report-connect>구글 캘린더 연결</button></p></div>`;
  }
  const names = [...new Set((cals?.calendars || []).map(c => c.summary).filter(Boolean))];
  const options = [`<option value=""${calendar ? '' : ' selected'}>선택 안 함</option>`]
    .concat(calendar && !names.includes(calendar) ? [`<option value="${esc(calendar)}" selected>${esc(calendar)}${cals ? ' (목록에 없음)' : ''}</option>`] : [])
    .concat(names.map(n => `<option value="${esc(n)}"${n === calendar ? ' selected' : ''}>${esc(n)}</option>`));
  const wait = !cals;
  return `<label class="ps-report-field" data-ps-report-cal="${wait ? 'loading' : cals.failed ? 'failed' : 'list'}">${head}<select id="psReportCalendar"${busy || wait ? ' disabled' : ''}${wait ? ' aria-busy="true"' : ''}>${options.join('')}</select>${cals?.failed ? '<span class="ps-report-note">캘린더 목록을 읽지 못했어요. 다시 펼치면 다시 읽어요.</span>' : ''}</label>`;
}

// prefs: 앱에서는 window.KPTUViewPrefs와 viewPrefs가 같은 하나다(view-prefs.js). 묶음을 읽는 organization-order.js와 같은 문을 쓴다.
export function mountReportSettings(host, {prefs = globalThis.KPTUViewPrefs || viewPrefs, toast = () => {}} = {}) {
  let busy = false, note = '', cals = null, calsFlight = null, opened = false;
  // 펼칠 때 한 번 읽는다(실패하면 다음 펼침에 다시). 연결 전·실패여도 저장은 그대로 된다(지금 값 유지).
  function loadCalendars() {
    if (calsFlight || (cals && !cals.failed)) return;
    cals = null;
    const rt = globalThis.KPTURuntime;
    calsFlight = (rt?.api ? readCalendars(rt) : Promise.reject(new Error('no runtime')))
      .then(v => { cals = v; }, () => { cals = {failed: true}; })
      .finally(() => { calsFlight = null; paintCalendar(); });
  }
  // 목록이 오면 캘린더 칸만 바꿔 그린다(다른 칸에 쓰던 글은 그대로).
  function paintCalendar() {
    const field = host.querySelector('[data-ps-report-cal]');
    if (field) field.outerHTML = calendarFieldHtml(read().calendar, cals, busy);
  }
  const read = () => ({calendar: prefs.get('report_calendar') ?? ''});
  function render() {
    const {calendar} = read(), open = opened;
    host.innerHTML = `<details class="ps-report"${open ? ' open' : ''}><summary><h3>주간보고 일정 캘린더</h3><span class="ps-report-line" data-ps-report-summary>${esc(summaryText(calendar))}</span></summary>
${calendarFieldHtml(calendar, cals, busy)}
${note ? `<p class="ps-report-note" role="status">${esc(note)}</p>` : ''}
<div class="ps-report-actions"><button type="button" class="secondary ps-save" data-ps-report-save${busy ? ' disabled aria-busy="true"' : ''}>${busy ? '저장 중…' : '저장'}</button></div></details>`;
  }
  async function save() {
    if (busy) return;
    // 선택 칸이 없거나(연결 전) 아직 읽는 중이면 지금 값을 그대로 둔다.
    const select = host.querySelector('#psReportCalendar');
    const cal = select && !select.disabled ? parseCalendar(select.value) : {ok: true, value: read().calendar || null};
    if (!cal.ok) { note = cal.error; render(); return; }
    busy = true; note = ''; render();
    try {
      prefs.set('report_calendar', cal.value, {rejectable:true});
      await prefs.flush();
    } finally { busy = false; }
    const ok = same(read().calendar || null, cal.value) && prefs.status() === 'ok';
    note = ok ? '' : '저장하지 못했어요. 잠시 뒤 다시 저장해 주세요.';
    render();
    if (ok) { toast('주간보고 일정 캘린더를 저장했어요.'); globalThis.window?.dispatchEvent?.(new CustomEvent('kptu:report-settings-changed')); }
  }
  host.addEventListener('click', e => {
    if (e.target.closest?.('[data-ps-report-save]')) void save();
    // 연결은 일정 화면의 구글 캘린더 칸에서 한다(기존 연결 길 하나, 새 서버 길 없음).
    if (e.target.closest?.('[data-ps-report-connect]')) {
      globalThis.KPTURouter?.go?.('calendar', {source: 'delegated'});
      setTimeout(() => { const p = globalThis.document?.querySelector?.('#googleCalendarPanel'); if (p) p.open = true; }, 0);
    }
  });
  // 다시 그릴 때 열린 채 만들어진 details도 toggle을 내므로, 닫힘 → 열림으로 바뀔 때만 읽는다.
  host.addEventListener('toggle', e => {
    if (!e.target.matches?.('details.ps-report')) return;
    const now = e.target.open, was = opened;
    opened = now;
    if (now && !was) loadCalendars();
  }, true);
  render();
  return {refresh: () => { if (!busy) render(); }};
}
