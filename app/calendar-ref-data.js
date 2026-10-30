// CAL-조직참고캘린더: 조직 참고 캘린더의 서버 읽기·쓰기. 규칙은 calendar-ref-model.mjs.
// 저장은 기존 서버 길뿐이다: 고르기 = app_profiles.ledger_calendar(내 행, owner RLS PATCH). 캘린더 일정은 저장하지 않고 그때그때 읽는다
// (Edge google-calendar events, onlyCalendarId). 새 표·새 함수·권한 변경 없음, 브라우저 저장소 없음.
// 예전 참고 일정 표(app_calendar_work_refs)는 더 읽거나 쓰지 않는다(쌓인 행은 그대로 보존).
import {parseChoice, serializeChoice, choiceReady, pickOrgRefs, orgRefRange} from './calendar-ref-model.mjs';

const encode = encodeURIComponent;
const dayStartIso = day => new Date(`${day}T00:00:00+09:00`).toISOString();
const userOf = rt => {
  const id = rt.context?.read?.()?.user?.id;
  if (!id) throw new Error('사용자를 확인할 수 없습니다.');
  return id;
};

// ---- 고르기 ----
// 읽을 수 없으면(칸 없음·권한) 예외 대신 {unavailable:true}.
export async function readChoice(rt, userId = userOf(rt)) {
  try {
    const rows = await rt.api(`/rest/v1/app_profiles?user_id=eq.${encode(userId)}&select=ledger_calendar&limit=1`);
    return {choice: parseChoice(Array.isArray(rows) ? rows[0]?.ledger_calendar : null)};
  } catch { return {unavailable: true, choice: parseChoice(null)}; }
}
export async function saveChoice(rt, choice, userId = userOf(rt)) {
  await rt.api(`/rest/v1/app_profiles?user_id=eq.${encode(userId)}`, {method: 'PATCH', body: {ledger_calendar: serializeChoice(choice)}});
}
// 고를 수 있는 캘린더 목록(Edge status). {connected, calendars:[{id, summary}]}
export async function readCalendars(rt) {
  const data = await rt.api('/functions/v1/google-calendar?action=status');
  if (data?.connected === false || data?.needs_reconnect || !Array.isArray(data?.calendars)) return {connected: false, calendars: []};
  return {connected: true, calendars: data.calendars.filter(c => c?.id).map(c => ({id: String(c.id), summary: String(c.summary || '')}))};
}

// ---- 추천 읽기 ----
// 그 주(월요일)와 앞으로 2주의 주요 일정. 고르지 않았으면 {configured:false}(달력을 읽지 않음).
// 돌려주는 값: {configured, org, items:[{key, day, time, title, label}]}. 달력을 못 읽으면 예외(화면은 추천 줄만 안 보인다).
export async function readOrgRefs(rt, weekStart) {
  const {choice, unavailable} = await readChoice(rt);
  if (unavailable || !choiceReady(choice)) return {configured: false, org: '', items: []};
  const range = orgRefRange(weekStart);
  const data = await rt.api(`/functions/v1/google-calendar?action=events&onlyCalendarId=${encode(choice.calendar)}&timeMin=${encode(dayStartIso(range.first))}&timeMax=${encode(dayStartIso(range.end))}`);
  if (!Array.isArray(data?.events) || data?.connected === false || data?.needs_reconnect || data?.authorized === false) throw new Error('calendar');
  return {configured: true, org: choice.org, items: pickOrgRefs(data.events, choice, range)};
}
