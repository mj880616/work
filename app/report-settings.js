// MULTI-노조사용자 ②-3(D5, S50-13): 내 프로필 › 보고 설정 — 담당조직 묶음·순서, 고르기에서 뺄 조직, 보고 캘린더 이름.
// 값은 내 프로필 화면 기억(view-prefs.js org_order·report_calendar) 하나에만 있다(새 표·새 저장소 없음, 기기 저장 없음).
// 칸은 접힌 한 줄 요약으로 시작하고, 펼치면 글 칸 셋과 [저장]. 저장은 이 칸만 따로 바로 한다(위 [저장]과 따로, 폰 알림 칸과 같은 방식).
// 서버 검사가 아직 이 칸을 모르면(DB 적용 전) 값은 되돌아가고 한 줄로 알린다.
import {viewPrefs} from './view-prefs.js';
import {formatGroups, formatHidden, parseOrgOrder, parseCalendar, unknownNames} from './report-settings-model.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function summaryText(orgOrder, calendar) {
  const n = orgOrder?.groups?.length || 0;
  return `담당조직 ${n ? `묶음 ${n}개` : '묶음 없음(가나다순)'} · 보고 캘린더 ${calendar ? `'${calendar}'` : '미지정'}`;
}

// prefs: 앱에서는 window.KPTUViewPrefs와 viewPrefs가 같은 하나다(view-prefs.js). 묶음을 읽는 organization-order.js와 같은 문을 쓴다.
export function mountReportSettings(host, {prefs = globalThis.KPTUViewPrefs || viewPrefs, organizations = () => [], toast = () => {}} = {}) {
  let busy = false, note = '';
  const read = () => ({orgOrder: prefs.get('org_order') ?? null, calendar: prefs.get('report_calendar') ?? ''});
  function render() {
    const {orgOrder, calendar} = read(), open = host.querySelector('details')?.open || false;
    const missing = unknownNames(orgOrder, organizations());
    host.innerHTML = `<details class="ps-report"${open ? ' open' : ''}><summary><h3>보고 설정</h3><span class="ps-report-line" data-ps-report-summary>${esc(summaryText(orgOrder, calendar))}</span></summary>
<label class="ps-report-field">보고 캘린더 <small>주간 정리 '주요 일정'을 가져올 Google 캘린더 이름</small><input id="psReportCalendar" type="text" maxlength="60" autocomplete="off" value="${esc(calendar)}"${busy ? ' disabled' : ''}></label>
<label class="ps-report-field">담당조직 묶음 <small>한 줄에 묶음 하나 · 묶음 이름: 조직, 조직 (적은 순서대로 보임, 나머지는 '그 외' 가나다순)</small><textarea id="psReportGroups" rows="5"${busy ? ' disabled' : ''}>${esc(formatGroups(orgOrder))}</textarea></label>
<label class="ps-report-field">고르기에서 뺄 조직 <small>쉼표로 나눔 · 목록에는 남고 고르기 칸에만 안 보임</small><input id="psReportHidden" type="text" autocomplete="off" value="${esc(formatHidden(orgOrder))}"${busy ? ' disabled' : ''}></label>
${missing.length ? `<p class="ps-report-note" data-ps-report-missing>내 담당조직 목록에 없는 이름 ${missing.length}개: ${esc(missing.join(', '))}</p>` : ''}${note ? `<p class="ps-report-note" role="status">${esc(note)}</p>` : ''}
<div class="ps-report-actions"><button type="button" class="secondary ps-save" data-ps-report-save${busy ? ' disabled aria-busy="true"' : ''}>${busy ? '저장 중…' : '보고 설정 저장'}</button></div></details>`;
  }
  async function save() {
    if (busy) return;
    const order = parseOrgOrder(host.querySelector('#psReportGroups')?.value, host.querySelector('#psReportHidden')?.value);
    const cal = parseCalendar(host.querySelector('#psReportCalendar')?.value);
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
  host.addEventListener('click', e => { if (e.target.closest?.('[data-ps-report-save]')) void save(); });
  render();
  return {refresh: () => { if (!busy) render(); }};
}
