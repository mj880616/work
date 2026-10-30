import {waitInlineHtml, failHtml} from './wait-state.js';
// CAL-조직참고캘린더: 내 프로필의 '조직 참고 캘린더' 한 줄(profile-settings.js가 #psCalRefPanel 자리를 만들고 이 모듈이 그 안을 그린다).
// [조직 고르기 ▾] 참고 캘린더 [캘린더 고르기 ▾] — 담당조직 하나(내 담당조직 규칙, my-organizations.js)와 구독한 캘린더 하나만.
// 바꾸면 바로 서버(app_profiles.ledger_calendar)에 저장한다(프로필 [저장]과 따로, 고르기 값 둘이라 저장 안 된 변경이 생기지 않음).
// 일정은 여기서 읽지도 저장하지도 않는다. 추천은 업무일지 [주간 정리]에서 그 조직 칸을 쓸 때만 보인다(calendar-ref-model.mjs).
import {readChoice, saveChoice, readCalendars} from './calendar-ref-data.js';
import {pickMyOrganizations} from './my-organizations.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const encode = encodeURIComponent;

async function readMyOrgs(rt, userId) {
  const workspaceId = rt.context?.read?.()?.workspace?.id;
  if (!workspaceId || !userId) return [];
  const [orgs, assignees] = await Promise.all([
    rt.api(`/rest/v1/app_suborganizations?workspace_id=eq.${encode(workspaceId)}&select=id,name,active&order=name.asc&limit=1000`),
    rt.api(`/rest/v1/app_suborganization_assignees?user_id=eq.${encode(userId)}&select=organization_id`).catch(() => []),
  ]);
  const mine = pickMyOrganizations(Array.isArray(orgs) ? orgs : [], Array.isArray(assignees) ? assignees : []);
  const order = window.KPTUOrganizationOrder;
  return (order?.sort ? order.sort(mine) : mine).map(o => ({id: String(o.id), name: String(o.name || '')}));
}

export function mountCalendarRefSettings(host, {rt, userId}) {
  let state = {phase: 'loading', choice: {calendar: '', org: ''}, calendars: [], orgs: [], busy: false, note: ''};
  let run = 0;

  function options(list, value, none, missing) {
    const known = list.some(x => x.id === value);
    return [`<option value="">${none}</option>`,
      ...(value && !known ? [`<option value="${esc(value)}" selected>${missing}</option>`] : []),
      ...list.map(x => `<option value="${esc(x.id)}"${x.id === value ? ' selected' : ''}>${esc(x.label)}</option>`)].join('');
  }
  function render() {
    if (!host.isConnected) return;
    const {phase, choice, calendars, orgs, busy, note} = state;
    const head = `<div class="ps-panel-head"><h3>조직 참고 캘린더</h3><span class="ps-state" data-ps-calref-state role="status" aria-live="polite">${esc(note)}</span></div>`;
    if (phase !== 'ready') {
      const line = phase === 'loading' ? waitInlineHtml() : phase === 'disconnected' ? '<span class="ps-calref-line">Google 캘린더를 연결하면 고를 수 있어요.</span>' : failHtml();
      host.innerHTML = `${head}<div class="ps-calref">${line}</div>`;
      return;
    }
    const off = busy ? ' disabled' : '';
    const org = options(orgs.map(o => ({id: o.id, label: o.name || '이름 없는 조직'})), choice.org, '조직 고르기', '고른 조직(담당 아님)');
    const cal = options(calendars.map(c => ({id: c.id, label: c.summary || '이름 없는 캘린더'})), choice.calendar, '캘린더 고르기', '고른 캘린더(목록에 없음)');
    host.innerHTML = `${head}<div class="ps-calref"><div class="ps-calref-row">`
      + `<select class="ps-calref-select ps-calref-org" data-ps-calref-org aria-label="참고 캘린더의 담당조직"${off}>${org}</select>`
      + `<span class="ps-calref-label">참고 캘린더</span>`
      + `<select class="ps-calref-select" data-ps-calref-calendar aria-label="조직 참고 캘린더"${off}>${cal}</select></div></div>`;
  }
  const say = note => { state = {...state, note}; const el = host.querySelector('[data-ps-calref-state]'); if (el) el.textContent = note; };

  async function load() {
    const mine = ++run;
    state = {...state, phase: 'loading', note: ''};
    render();
    try {
      const [{choice, unavailable}, cal, orgs] = await Promise.all([readChoice(rt, userId()), readCalendars(rt).catch(() => null), readMyOrgs(rt, userId()).catch(() => [])]);
      if (mine !== run) return;
      if (unavailable) state = {...state, phase: 'failed'};
      else if (!cal) state = {...state, phase: choice.calendar ? 'ready' : 'failed', choice, calendars: [], orgs};
      else if (!cal.connected && !choice.calendar) state = {...state, phase: 'disconnected', choice};
      else state = {...state, phase: 'ready', choice, calendars: cal.calendars, orgs};
    } catch { if (mine !== run) return; state = {...state, phase: 'failed'}; }
    render();
  }

  async function apply(next) {
    if (state.busy) return;
    state = {...state, busy: true}; render(); say('저장 중…');
    try {
      await saveChoice(rt, next, userId());
      state = {...state, choice: next, busy: false}; render();
      say(next.calendar && next.org ? '저장했어요 · 주간 정리에서 그 조직 칸에 추천이 보여요' : next.calendar || next.org ? '저장했어요 · 조직과 캘린더를 둘 다 고르면 추천이 보여요' : '비웠어요');
    } catch { state = {...state, busy: false}; render(); say('저장하지 못했어요. 다시 골라 주세요.'); }
  }

  host.addEventListener('change', event => {
    const cal = event.target.closest?.('[data-ps-calref-calendar]');
    if (cal) { apply({...state.choice, calendar: cal.value}); return; }
    const org = event.target.closest?.('[data-ps-calref-org]');
    if (org) apply({...state.choice, org: org.value});
  });
  return {load};
}
