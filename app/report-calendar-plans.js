// S58-10 BIZ-보고할일정 PR C(설계 docs/design/biz-report-plan-link.md 4절): 사업 보고 달력이 '보고할 일정'을 읽고 저장하는 길.
// - 규칙은 report-calendar-plan.mjs(달력에 놓기)·report-plan-model.mjs(일정 하나의 표시), 줄 저장은 report-plan-data.js 한 곳(서버 표 app_calendar_report_plans).
// - 여기는 ① 이 달의 Google 일정을 읽어 두고(점선 □ '보고할까요?'와 저절로 골라 주기에 쓴다) ② 그 뒤 '저절로 켜진 줄 넣기·사본 맞추기'를 한 번 돌리고
//   ③ 단추가 누른 결정을 저장 길에 넘긴다. 그리기는 하지 않는다 — 그리는 주인은 team.js renderMeetings 하나이고, 바뀌면 onChange로 다시 그리게만 한다.
// - 권한은 DB(소유자 RLS)와 Edge(google-calendar: 로그인한 사람의 캘린더만)가 정한다. 화면은 값을 고르지 않는다.
// - 기기에 저장하지 않는다. 읽은 일정은 이 창이 떠 있는 동안만 메모리에 두고(달마다 EVENTS_TTL), 로그인·계정이 바뀌거나 일정이 바뀌면 비운다.
// - 서버에 새 표가 없거나(적용 전·되돌린 뒤) 아직 못 읽었으면 planView가 null → 달력은 표시 없이 지금 그대로다.
// - S67-16(사용자 11/20 "넓혀"): 점선 □ '보고할까요?' 판정(report-plan-model.mjs askReason)에 쓸 힌트 두 가지도 여기서 읽는다 —
//   내 담당조직 목록(이름·다른 이름, 로그인마다 한 번)과 이 달 사업영역 주요 일정 행의 일정 id(달마다, 일정과 같이). 못 읽으면 그 힌트만 빠진다.
// - 사라진 일정의 줄을 저절로 지우지 않는다: 이 읽기는 캘린더마다 250건까지이고 고른 캘린더만 읽어, '안 보임'이 '삭제됨'이라는 보장이 없다(PR 본문 '범위 밖').
import {loadReportPlans, reportPlanData, setEventPlanState, addRulePlans, syncEventCopies, linkReportToEvent, REPORT_PLANS_CHANGED} from './report-plan-data.js';
import {planItems, itemsByDay, overdueItems, matchesName, monthRange, itemEvent, itemWhen, planRowMenuItems} from './report-calendar-plan.mjs';
import {reportsOfEvent, coverCandidates} from './report-plan-model.mjs';
import {openRowMenu} from './row-menu.js';
import {pickMyOrganizations} from './my-organizations.js';

const EVENTS_TTL = 5 * 60 * 1000;
const rtOf = () => window.KPTURuntime;
const sessionKey = rt => { const c = rt?.context?.read?.() || window.__KPTU_BOOT_CONTEXT__ || null, ws = String(c?.workspace?.id || c?.workspaceId || ''), user = String(c?.user?.id || ''); return ws && user ? `${rt?.session?.epoch?.() ?? ''}|${user}|${ws}` : ''; };
const monthId = m => `${m.year}-${String(m.month + 1).padStart(2, '0')}`;
const enc = encodeURIComponent;
const HINT_LIMIT = 1000;

// months: 달 → {key(로그인), at(읽은 때), events(목록 | null = 읽지 못함·연결 안 됨), areaIds(Set | null), flight}
const months = new Map();
// 이번 창에서 방금 보고를 쓴 일정 → 쓴 때. '일정에 이어진 보고' 목록을 다시 읽어 그 보고가 보일 때까지(길어야 WRITTEN_HOLD) 그 일정의 □를 감춘다 —
// 새 보고의 ●와 옛 □가 같이 보이는 순간을 없앤다. 연결이 저장되지 않았으면 시간이 지나 □가 다시 보인다(사실 그대로).
const WRITTEN_HOLD = 15000;
const written = new Map();
let plansAsked = '', tidied = new WeakSet(), tidying = false, tidyNext = null;

async function readMonth(rt, month) {
  const {timeMin, timeMax} = monthRange(month);
  try {
    const data = await rt.api(`/functions/v1/google-calendar?action=events&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`);
    const events = Array.isArray(data?.events) ? data.events : null;
    // 연결이 없거나 다시 이어야 하면 '읽지 못함'. 일부 캘린더만 실패했으면 읽힌 것만 쓴다(여기서는 지우는 일이 없어 모자라도 안전하다).
    if (!events || data?.connected === false || data?.needs_reconnect || data?.authorized === false || (data?.warning && !events.length)) return null;
    return events;
  } catch { return null; }
}
// 담당조직(쉬는 조직 제외). 어느 작업공간 것을 읽을지는 DB(소유자 RLS — 내 작업공간 하나)가 정한다(이 파일은 작업공간 값을 다루지 않는다).
// 실패하면 null — 제목 판정만 빠진다.
// 내 담당조직 = 공용 규칙(my-organizations.js — 내 프로필 › 담당 사업장 행 × 쓰는 조직, 담당을 안 정했으면 쓰는 조직 전부).
async function readOrgs(rt) {
  const c = rt?.context?.read?.() || window.__KPTU_BOOT_CONTEXT__ || null, user = String(c?.user?.id || '');
  try {
    const [rows, assignees] = await Promise.all([
      rt.api(`/rest/v1/app_suborganizations?active=eq.true&select=id,name,aliases,active&order=id.asc&limit=${HINT_LIMIT}`),
      user ? rt.api(`/rest/v1/app_suborganization_assignees?user_id=eq.${enc(user)}&select=organization_id&order=organization_id.asc&limit=${HINT_LIMIT}`).catch(() => []) : Promise.resolve([])
    ]);
    return Array.isArray(rows) ? pickMyOrganizations(rows, Array.isArray(assignees) ? assignees : []) : null;
  } catch { return null; }
}
// 이 달(서울)에 시작하는 사업영역 주요 일정 행의 Google 일정 id. 실패하면 null — 사업영역 판정만 빠진다.
async function readAreaIds(rt, month) {
  const {timeMin, timeMax} = monthRange(month);
  try {
    const rows = await rt.api(`/rest/v1/app_project_milestones?google_event_id=not.is.null&start_at=gte.${enc(timeMin)}&start_at=lt.${enc(timeMax)}&select=google_event_id&limit=${HINT_LIMIT}`);
    return Array.isArray(rows) ? new Set(rows.map(r => String(r?.google_event_id ?? '')).filter(Boolean)) : null;
  } catch { return null; }
}
// 로그인마다 한 번 읽고 EVENTS_TTL 동안 그대로 쓴다(조직 화면에서 이름을 고치면 다음 읽기부터). 읽지 못했으면 앞서 읽은 것을 둔다.
let orgHint = {key: '', list: null, at: 0, flight: null};
function wantOrgs(rt, key, onChange) {
  if (orgHint.key === key && (orgHint.flight || Date.now() - orgHint.at < EVENTS_TTL)) return;
  const job = {key, list: orgHint.key === key ? orgHint.list : null, at: Date.now(), flight: null};
  job.flight = readOrgs(rt).then(list => {
    if (orgHint !== job) return;
    job.flight = null; job.at = Date.now();
    if (!list) return;
    const before = JSON.stringify(job.list); job.list = list;
    if (before === JSON.stringify(list)) return;
    if (sessionKey(rt) === key) onChange?.();
  });
  orgHint = job;
}
const fresh = (entry, key) => !!entry && entry.key === key && (entry.flight || Date.now() - entry.at < EVENTS_TTL);
const eventsOf = (month, rt = rtOf()) => { const e = months.get(monthId(month)); return e && e.key === sessionKey(rt) && Array.isArray(e.events) ? e.events : null; };
const areaIdsOf = (month, rt = rtOf()) => { const e = months.get(monthId(month)); return e && e.key === sessionKey(rt) ? e.areaIds || null : null; };
const orgsOf = (rt = rtOf()) => (orgHint.key === sessionKey(rt) ? orgHint.list : null);

// 달력을 그릴 때마다 부른다. 아직 안 읽은 것(줄·이 달 일정)만 읽기 시작하고, 읽기가 끝나 그림이 달라질 수 있으면 onChange()를 부른다.
// 이미 읽어 둔 것은 다시 읽지 않으므로 onChange → 다시 그리기 → wantPlans가 맴돌지 않는다.
export function wantPlans(month, onChange, rt = rtOf()) {
  const key = sessionKey(rt);
  if (!key || !rt?.api) return;
  if (plansAsked !== key) {
    plansAsked = key;
    // 다 읽으면 report-plan-data.js가 REPORT_PLANS_CHANGED를 알린다(아래 듣기 → 부르는 쪽이 다시 그림). 실패하면 다음에 그릴 때 다시 읽는다.
    void loadReportPlans({}, rt).catch(() => { if (plansAsked === key) plansAsked = ''; });
  }
  // 줄을 읽을 수 있는 서버일 때만 Google 일정을 읽는다(표가 없으면 그릴 표시가 없다). 줄 읽기가 끝나면 알림 → 다시 그리기 → 여기로 다시 온다.
  if (!reportPlanData(rt)) return;
  wantOrgs(rt, key, onChange);
  const id = monthId(month), entry = months.get(id);
  if (!fresh(entry, key)) {
    const same = entry?.key === key;
    const next = {key, at: Date.now(), events: same ? entry.events : null, areaIds: same ? entry.areaIds : null, flight: null};
    next.flight = Promise.all([readMonth(rt, month), readAreaIds(rt, month)]).then(([events, areaIds]) => {
      if (months.get(id) !== next) return;
      next.flight = null; next.at = Date.now();
      // 다시 읽기에 실패했으면 앞서 읽은 것을 그대로 둔다(표시가 깜박이며 사라지지 않게).
      if (events) next.events = events;
      if (areaIds) next.areaIds = areaIds;
      if (sessionKey(rt) === key) { void tidy(month, rt); onChange?.(); }
    });
    months.set(id, next);
  } else if (!entry.flight) void tidy(month, rt);
}

// 줄과 이 달 일정을 둘 다 읽은 뒤 한 번: 같은 이름 기억으로 저절로 켜진 일정의 줄을 넣고(4-3), 제목·날짜가 바뀐 줄의 사본을 맞춘다(4-5).
// 같은 읽기 결과(일정 목록)에는 한 번만 돈다. 저장이 끝나면 report-plan-data.js가 알리고 화면이 다시 그린다. 도는 중에 다른 달이 오면 끝난 뒤 이어서 한다.
async function tidy(month, rt = rtOf()) {
  const events = eventsOf(month, rt);
  if (!events || tidied.has(events) || !reportPlanData(rt)) return;
  if (tidying) { tidyNext = month; return; }
  tidying = true;
  try {
    tidied.add(events);
    await addRulePlans(events, rt);
    await syncEventCopies(events, rt);
  } catch { tidied.delete(events); /* 다음에 그릴 때 다시 */ }
  finally {
    tidying = false;
    const next = tidyNext; tidyNext = null;
    if (next) void tidy(next, rt);
  }
}

// 달력이 그릴 것. null = 표시하지 않음(표 없는 서버·아직 못 읽음). nameFilter = 사업 보고 화면의 회의명 거르기 값('all'·이름·'__none__').
// {byDay: Map(날짜 → 항목), overdue: 안 쓴 보고 항목(최근 위 — 알림이라 회의명 거르기는 걸지 않는다)}
// reports = 부르는 쪽(team.js)이 읽어 둔 사업 보고 목록 전체(S67-40 — 따로 쓴 보고가 덮는 일정은 묻지 않는다). 없으면 일정 id 연결만 본다.
export function planView({month, todayKey, nameFilter = 'all', reports = null}, rt = rtOf()) {
  const base = reportPlanData(rt);
  if (!base) return null;
  const data = Array.isArray(reports) ? {...base, allReports: reports} : base;
  lastAll = data.allReports || null;
  const now = Date.now();
  for (const [id, at] of written) if (now - at > WRITTEN_HOLD || reportsOfEvent(id, data.reports).length) written.delete(id);
  const items = planItems({...data, orgs: orgsOf(rt), areaEventIds: areaIdsOf(month, rt)}, eventsOf(month, rt) || []).filter(item => !written.has(item.eventId) && matchesName(item, nameFilter));
  return {byDay: itemsByDay(items), overdue: overdueItems(data, todayKey).filter(item => !written.has(item.eventId))};
}
let lastAll = null;
// [보고 쓰기]가 여는 쓰기 창에 채울 것(일정 창 [결과 남기기]와 같은 모양 — team.js KPTUReportEntry.open). 장소는 읽어 둔 일정에 있을 때만.
export function writeOptions(item, month, rt = rtOf()) {
  const event = (eventsOf(month, rt) || []).find(e => String(e?.id ?? '') === item?.eventId) || null;
  return {name: item.title, ...itemWhen(item), location: String(event?.location || ''), dedupe: true, event: {id: item.eventId, calendarId: item.calendarId}};
}
// 결정 저장: state = 'on'([보고할까요?]) | 'off'(⋯ [보고할 일정 ✓] — 이 일정만 끔) | 'skip'(⋯ [빼기]).
export const decidePlan = (item, state, rt = rtOf()) => setEventPlanState(itemEvent(item), state, rt);
export const DECIDED_TEXT = Object.freeze({on: '보고할 일정으로 표시했어요.', off: '보고할 일정 표시를 껐어요.', skip: '뺐어요. 같은 이름 일정은 다시 묻지 않아요.'});
// 줄 ⋯ 메뉴(공용 줄 메뉴 부품). at = PC 우클릭 자리(appMenuPoint), 없으면 ⋯ 바로 아래. run(state) = 'off' | 'skip'.
// S67-40: 같은 날 따로 쓴 보고가 있으면 [이미 보고함: 보고 제목](LINK_MAX개까지, 비슷한 것 먼저). 누르면 run('link:보고 id') → linkPlan.
const LINK_MAX = 3, LINK_ICON = 'M3 8.5l3 3 7-7';
const cut = text => { const a = Array.from(String(text ?? '').trim()); return a.length > 22 ? a.slice(0, 21).join('') + '…' : a.join(''); };
export function linkCandidates(item, rt = rtOf()) {
  const data = reportPlanData(rt);
  if (!data || !lastAll) return [];
  return coverCandidates(itemEvent(item), {reports: data.reports, allReports: lastAll}).slice(0, LINK_MAX).map(c => c.report);
}
export const openPlanMenu = (trigger, item, at, run) => openRowMenu(trigger, {key: 'rvplan:' + item.eventId, label: item.title, at, run,
  items: [...linkCandidates(item).map(r => ({id: 'link:' + r.id, label: `이미 보고함: ${cut(String(r.series_name || '').trim() || r.title)}`, icon: LINK_ICON})), ...planRowMenuItems(item)]});
export const linkPlan = (item, reportId, rt = rtOf()) => linkReportToEvent(reportId, itemEvent(item), rt);
export const LINKED_TEXT = '이 일정은 보고한 것으로 이었어요.';
// [보고 쓰기]로 연 창이 저장됐을 때 부른다.
export function noteWritten(eventId) { if (eventId) written.set(String(eventId), Date.now()); }

// 줄·보고 연결이 바뀌면 부르는 쪽이 다시 그린다. 한 번만 건다(부르는 쪽이 여러 번 불러도 마지막 것 하나).
let listener = null;
export function onPlansChanged(fn) {
  listener = fn;
  if (window.__KPTU_REPORT_CALENDAR_PLANS__) return;
  window.__KPTU_REPORT_CALENDAR_PLANS__ = true;
  // 줄이 바뀌면 같은 이름 기억도 바뀔 수 있다([보고할까요?]를 누르면 같은 이름의 다른 일정이 저절로 켜진다) → 다음에 그릴 때 정리를 한 번 더 돈다.
  // 정리가 넣은 줄이 없으면 알림도 없으므로 맴돌지 않는다.
  window.addEventListener(REPORT_PLANS_CHANGED, () => { tidied = new WeakSet(); listener?.(); });
  window.addEventListener('kptu:session-changed', () => { months.clear(); written.clear(); plansAsked = ''; orgHint = {key: '', list: null, at: 0, flight: null}; });
  // 일정 화면에서 일정이 바뀌면 읽어 둔 달을 '오래됨'으로 둔다(다음에 그릴 때 다시 읽고, 그동안은 앞서 읽은 것으로 그린다).
  window.addEventListener('kptu:calendar-changed', () => { for (const entry of months.values()) entry.at = 0; });
}
