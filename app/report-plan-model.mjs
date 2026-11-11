// S57-20 BIZ-보고할일정 PR A(설계 docs/design/biz-report-plan-link.md 4절): '보고할 일정' 규칙 한 곳 — DOM·네트워크 없음.
// 일정 달력·사업 보고 달력·홈이 같이 쓴다. 저장은 report-plan-data.js(서버 표 app_calendar_report_plans, 사업 보고 표의 일정 id 칸).
//   4-1 일정 하나의 표시: 이어진 보고 있음 = 보고 씀(done) → 결정 줄 on = 보고할 일정(todo) · off·skip = 표시 없음 → 줄이 없으면 같은 이름 기억
//       → 기억도 없고 담당조직이 연결된 일정 = 보고할까요?(ask) → 그 밖에는 그냥 일정('').
//   4-2 같은 이름 기억: 사람이 정한 on·skip 줄 가운데 가장 나중 값. off는 그 일정 하나만 끈다(기억에 들지 않음).
//       그 이름으로 일정에 이어 쓴 보고가 있으면 on(더 나중에 정한 skip이 있으면 skip).
//   4-3 누를 때 저장: 줄이 있으면 고치기(PATCH), 없으면 넣기(POST). 저절로 켜진 줄(rule)은 on만 되므로 끌 때 decided_by=user를 같이 보낸다.
//   4-5 사본 맞추기: 줄의 제목·날짜·시각·캘린더 id가 일정과 다르면 그 칸만 고친다(decided_at은 그대로).
export const PLAN_ON = 'on', PLAN_OFF = 'off', PLAN_SKIP = 'skip';
export const BY_USER = 'user', BY_RULE = 'rule';
export const STATUS_DONE = 'done', STATUS_TODO = 'todo', STATUS_ASK = 'ask';
export const TITLE_MAX = 300; // DB 검사 app_calendar_report_plans_title_check 와 같은 한도
export const NO_TITLE = '(제목 없음)';

// 같은 이름 열쇠: 공백을 모두 빼고 소문자(team.js meetingNameKey 와 같은 규칙 — tests/report-plan-model.test.mjs 가 같은지 본다).
export const nameKey = name => String(name ?? '').replace(/\s+/g, '').toLowerCase();

// 제목 사본: 제어 글자(줄바꿈·탭)는 빈칸으로, 300자(글자 수)에서 자르고, 비면 '(제목 없음)'.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
export function planTitle(title) {
  const clean = String(title ?? '').replace(CONTROL, ' ').trim();
  if (!clean) return NO_TITLE;
  return Array.from(clean).slice(0, TITLE_MAX).join('').trim();
}
// 일정의 이름 열쇠. 제목이 빈 일정은 이름이 없으므로 같은 이름 기억에 들지 않는다('').
export function eventNameKey(event) {
  const raw = String(event?.title ?? '').replace(CONTROL, ' ').trim();
  return raw ? nameKey(planTitle(raw)) : '';
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const seoulDay = value => { const t = Date.parse(value); return Number.isFinite(t) ? new Date(t + 9 * 3600e3).toISOString().slice(0, 10) : ''; };
const isoOrNull = value => { const t = Date.parse(value); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
// DB 검사와 같은 모양: 일정 id = 빈칸·제어 글자 없는 ASCII 1~1024자, 캘린더 id = 빈칸 없는 1~255자.
export const validEventId = id => typeof id === 'string' && /^[!-~]{1,1024}$/.test(id);
export const validCalendarId = id => typeof id === 'string' && id.length >= 1 && Array.from(id).length <= 255 && !/[\s\u0000-\u001f\u007f-\u009f]/.test(id);
const validDay = day => DAY.test(day) && day >= '2000-01-01' && day <= '2100-12-31';

// Google 일정(Edge google-calendar normEvent 모양: id·calendarId·title·start·allDay) → 표에 넣을 사본. 넣을 수 없는 모양이면 null.
export function eventCopy(event) {
  const id = String(event?.id ?? ''), calendar = String(event?.calendarId || 'primary'), start = String(event?.start ?? '');
  const allDay = !!event?.allDay || DAY.test(start);
  const day = allDay ? start.slice(0, 10) : seoulDay(start);
  if (!validEventId(id) || !validCalendarId(calendar) || !validDay(day)) return null;
  return {google_event_id: id, google_calendar_id: calendar, title: planTitle(event?.title), event_day: day, starts_at: allDay ? null : isoOrNull(start)};
}

const stamp = value => { const t = Date.parse(value); return Number.isFinite(t) ? t : 0; };
const reportName = report => String(report?.series_name ?? '').trim() || String(report?.title ?? '').trim();
const reportStamp = report => stamp(report?.created_at) || stamp(report?.meeting_at);
// 일정에 이어진 보고(휴지통 것은 서버가 가려 목록에 없다). 가장 나중에 쓴 것이 앞.
export function reportsOfEvent(eventId, reports) {
  const id = String(eventId ?? '');
  if (!id) return [];
  return (reports || []).filter(r => r && String(r.google_event_id ?? '') === id).sort((a, b) => reportStamp(b) - reportStamp(a));
}
export const planRowOf = (eventId, plans) => (plans || []).find(p => p && String(p.google_event_id ?? '') === String(eventId ?? '')) || null;

// 4-2 같은 이름 기억: 'on' | 'skip' | ''.
export function rememberedState(key, {plans = [], reports = []} = {}) {
  if (!key) return '';
  let best = null;
  const take = (state, at) => { if (!best || at > best.at || (at === best.at && state === PLAN_SKIP)) best = {state, at}; };
  for (const p of plans || []) {
    if (!p || p.decided_by !== BY_USER || (p.state !== PLAN_ON && p.state !== PLAN_SKIP)) continue;
    if (nameKey(p.title) === key) take(p.state, stamp(p.decided_at));
  }
  for (const r of reports || []) {
    if (!r || !r.google_event_id) continue;
    if (nameKey(reportName(r)) === key) take(PLAN_ON, reportStamp(r));
  }
  return best ? best.state : '';
}

// 이 일정에 지금 통하는 결정: 줄이 있으면 그 값, 없으면 같은 이름 기억. {state:'on'|'off'|'skip'|'', row, from:'row'|'memory'|''}
export function planDecision(event, {plans = [], reports = []} = {}) {
  const row = planRowOf(event?.id, plans);
  if (row) return {state: [PLAN_ON, PLAN_OFF, PLAN_SKIP].includes(row.state) ? row.state : '', row, from: 'row'};
  const state = rememberedState(eventNameKey(event), {plans, reports});
  return {state, row: null, from: state ? 'memory' : ''};
}
// 메뉴·일정 창 [보고할 일정]이 켜져 보이는가.
export const planIsOn = (event, data) => planDecision(event, data).state === PLAN_ON;

// 4-1 일정 하나의 표시: 'done' 보고 씀 · 'todo' 보고할 일정 · 'ask' 보고할까요? · '' 그냥 일정.
export function eventStatus(event, {plans = [], reports = []} = {}) {
  if (reportsOfEvent(event?.id, reports).length) return STATUS_DONE;
  const decision = planDecision(event, {plans, reports});
  if (decision.state === PLAN_ON) return STATUS_TODO;
  if (decision.row || decision.state === PLAN_SKIP) return '';
  return Array.isArray(event?.organizationIds) && event.organizationIds.length ? STATUS_ASK : '';
}

const sameInstant = (a, b) => (a == null || a === '') ? (b == null || b === '') : (b != null && b !== '' && stamp(a) === stamp(b) && stamp(a) !== 0);
// 4-5 사본 맞추기: 줄과 일정이 다른 칸만. 같으면 {}. 실제 캘린더 주소를 'primary'로 되돌리지는 않는다(같은 캘린더를 두 이름으로 부를 수 있다).
export function copyPatch(row, event) {
  const copy = eventCopy(event);
  if (!row || !copy || String(row.google_event_id ?? '') !== copy.google_event_id) return {};
  const patch = {};
  if (row.title !== copy.title) patch.title = copy.title;
  if (String(row.event_day ?? '') !== copy.event_day) patch.event_day = copy.event_day;
  if (!sameInstant(row.starts_at, copy.starts_at)) patch.starts_at = copy.starts_at;
  if (row.google_calendar_id !== copy.google_calendar_id && copy.google_calendar_id !== 'primary') patch.google_calendar_id = copy.google_calendar_id;
  return patch;
}

// 4-3 누를 때 저장. state = on(켬·[보고할까요?]) | off(끔) | skip(빼기). 줄이 있으면 {method:'PATCH', id, body}, 없으면 {method:'POST', body}.
// 넣을 수 없는 일정(id·날짜 모양이 다름)이면 null.
export function decisionWrite(row, state, event, now = new Date()) {
  if (![PLAN_ON, PLAN_OFF, PLAN_SKIP].includes(state)) return null;
  const decided = {state, decided_by: BY_USER, decided_at: new Date(now).toISOString()};
  if (row?.id) return {method: 'PATCH', id: String(row.id), body: {...copyPatch(row, event), ...decided}};
  const copy = eventCopy(event);
  return copy ? {method: 'POST', body: {...copy, ...decided}} : null;
}
// 같은 이름 기억으로 저절로 켜진 일정을 화면이 처음 볼 때 넣는 줄(이미 줄이 있으면 넣지 않는다 → null).
export function ruleWrite(event, {plans = [], reports = []} = {}, now = new Date()) {
  const decision = planDecision(event, {plans, reports});
  if (decision.row || decision.state !== PLAN_ON) return null;
  const copy = eventCopy(event);
  return copy ? {method: 'POST', body: {...copy, state: PLAN_ON, decided_by: BY_RULE, decided_at: new Date(now).toISOString()}} : null;
}

// 보고 저장 때 보고 줄에 넣을 일정 연결(둘 다 채우거나 둘 다 비움 — DB 짝 검사). 모양이 다르면 {} (연결 없이 저장).
export function reportLink(event) {
  const id = String(event?.id ?? event?.eventId ?? ''), calendar = String(event?.calendarId || 'primary');
  return validEventId(id) && validCalendarId(calendar) ? {google_calendar_id: calendar, google_event_id: id} : {};
}

// 서버가 아직 새 표·새 칸을 모를 때(적용 전·되돌린 뒤)의 응답: 화면은 표시 없이 지금 그대로 동작한다.
export function isMissingStore(error) {
  const status = Number(error?.status), text = `${error?.code ?? ''} ${error?.message ?? ''}`;
  if (status === 404) return true;
  return /PGRST20[0245]|42P01|42703|schema cache|does not exist|Could not find/i.test(text);
}
