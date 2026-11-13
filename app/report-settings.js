// MULTI-노조사용자 ②-3(D5, S50-13): 내 프로필 › 보고 설정 — 담당조직 묶음·순서, 고르기에서 뺄 조직, 보고 캘린더 이름.
// 값은 내 프로필 화면 기억(view-prefs.js org_order·report_calendar) 하나에만 있다(새 표·새 저장소 없음, 기기 저장 없음).
// 칸은 접힌 한 줄 요약으로 시작하고, 펼치면 글 칸 셋과 [저장]. 저장은 이 칸만 따로 바로 한다(위 [저장]과 따로, 폰 알림 칸과 같은 방식).
// 서버 검사가 아직 이 칸을 모르면(DB 적용 전) 값은 되돌아가고 한 줄로 알린다.
// MULTI-다른담당자맞춤 ③: '주간보고 일정 캘린더'는 이름을 치지 않고 연결된 구글 캘린더 목록에서 선택한다(값은 그대로 캘린더 이름,
// report_calendar). 목록은 펼칠 때 한 번 읽고(google-calendar status, calendar-ref-data.js readCalendars), 연결 전이면 연결 안내만.
// 지금 값이 목록에 없으면 '(목록에 없음)'으로 남겨 저장해도 바뀌지 않게 한다.
import {viewPrefs} from './view-prefs.js';
import {readCalendars} from './calendar-ref-data.js';
import {formatGroups, formatHidden, parseOrgOrder, parseCalendar, unknownNames} from './report-settings-model.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function summaryText(orgOrder, calendar) {
  const n = orgOrder?.groups?.length || 0;
  return `담당조직 ${n ? `묶음 ${n}개` : '묶음 없음(가나다순)'} · 주간보고 일정 캘린더 ${calendar ? `'${calendar}'` : '미지정'}`;
}

// 캘린더 선택 칸. cals: null(읽는 중) | {connected, calendars:[{id, summary}]} | {failed:true}
export function calendarFieldHtml(calendar, cals, busy = false) {
  const head = `<span class="ps-report-label">주간보고 일정 캘린더</span> <small>주간보고 '주요 일정'에 넣을 일정이 있는 구글 캘린더</small>`;
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
export function mountReportSettings(host, {prefs = globalThis.KPTUViewPrefs || viewPrefs, organizations = () => [], toast = () => {}} = {}) {
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
  const read = () => ({orgOrder: prefs.get('org_order') ?? null, calendar: prefs.get('report_calendar') ?? ''});
  function render() {
    const {orgOrder, calendar} = read(), open = opened;
    const missing = unknownNames(orgOrder, organizations());
    host.innerHTML = `<details class="ps-report"${open ? ' open' : ''}><summary><h3>보고 설정</h3><span class="ps-report-line" data-ps-report-summary>${esc(summaryText(orgOrder, calendar))}</span></summary>
${calendarFieldHtml(calendar, cals, busy)}
<label class="ps-report-field">담당조직 묶음 <small>한 줄에 묶음 하나 · 묶음 이름: 조직, 조직 (적은 순서대로 보임, 나머지는 '그 외' 가나다순)</small><textarea id="psReportGroups" rows="5"${busy ? ' disabled' : ''}>${esc(formatGroups(orgOrder))}</textarea></label>
<label class="ps-report-field">선택에서 뺄 조직 <small>쉼표로 나눔 · 목록에는 남고 선택 칸에만 안 보임</small><input id="psReportHidden" type="text" autocomplete="off" value="${esc(formatHidden(orgOrder))}"${busy ? ' disabled' : ''}></label>
${missing.length ? `<p class="ps-report-note" data-ps-report-missing>내 담당조직 목록에 없는 이름 ${missing.length}개: ${esc(missing.join(', '))}</p>` : ''}${note ? `<p class="ps-report-note" role="status">${esc(note)}</p>` : ''}
<div class="ps-report-actions"><button type="button" class="secondary ps-save" data-ps-report-save${busy ? ' disabled aria-busy="true"' : ''}>${busy ? '저장 중…' : '보고 설정 저장'}</button></div></details>`;
  }
  async function save() {
    if (busy) return;
    const order = parseOrgOrder(host.querySelector('#psReportGroups')?.value, host.querySelector('#psReportHidden')?.value);
    // 선택 칸이 없거나(연결 전) 아직 읽는 중이면 지금 값을 그대로 둔다.
    const select = host.querySelector('#psReportCalendar');
    const cal = select && !select.disabled ? parseCalendar(select.value) : {ok: true, value: read().calendar || null};
    if (!order.ok || !cal.ok) { note = order.error || cal.error; render(); return; }
    busy = true; note = ''; render();
    try {
      prefs.set('org_order', order.value, {rejectable:true});
      prefs.set('report_calendar', cal.value, {rejectable:true});
      await prefs.flush();
    } finally { busy = false; }
    const now = read(), ok = same(now.orgOrder, order.value) && same(now.calendar || null, cal.value) && prefs.status() === 'ok';
    note = ok ? '' : '보고 설정을 저장하지 못했어요. 잠시 뒤 다시 저장해 주세요.';
    render();
    if (ok) { toast('보고 설정을 저장했어요.'); globalThis.window?.dispatchEvent?.(new CustomEvent('kptu:report-settings-changed')); globalThis.window?.__KPTU_RELOAD_SUBORGANIZATIONS__?.(); }
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
