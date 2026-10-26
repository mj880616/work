// 원장 재료 C-4: 개인 공유 캘린더 참고 일정의 서버 읽기·쓰기 (docs/design/ledger-sources.md 5절).
// 저장은 기존 서버 길(owner RLS REST)뿐이다: 고르기 = app_profiles.ledger_calendar, 참고 일정 = app_calendar_work_refs.
// 새 표·새 함수·권한 변경 없음. 판단 규칙은 calendar-ref-model.mjs. 브라우저 저장소는 쓰지 않는다.
// 서버 Edge google-calendar가 아직 옛 판(C-2 배포 전)이어도 깨지지 않는다: onlyCalendarId를 모르면 저장된 캘린더 목록의 일정이 오므로
// 고른 캘린더 일정만 걸러 쓰고(calendarId 비교), mine 칸이 없으면 '내가 만든 일정' 규칙만 건너뛴다(색 규칙은 그대로 동작).
import {weekStart, shiftWeek, todayKey} from './journal-data.js';
import {parseChoice, serializeChoice, isSelected, buildPick, planSync, syncSummary, SYNC_EVENT_CAP} from './calendar-ref-model.mjs';

const encode = encodeURIComponent;
const REF_FIELDS = 'id,event_key,day,start_at,all_day,title,judged,included,decided_by,organization_id';
const dayStartIso = day => new Date(`${day}T00:00:00+09:00`).toISOString();
const ctx = rt => {
  const c = rt.context?.read?.();
  if (!c?.user?.id || !c?.workspace?.id) throw new Error('업무 공간을 확인할 수 없습니다.');
  return {userId: c.user.id, workspaceId: c.workspace.id};
};

// ---- 고르기 ----
// 읽을 수 없으면(칸 없음·권한) null이 아니라 예외 대신 {unavailable:true}.
export async function readChoice(rt, userId = ctx(rt).userId) {
  try {
    const rows = await rt.api(`/rest/v1/app_profiles?user_id=eq.${encode(userId)}&select=ledger_calendar&limit=1`);
    return {choice: parseChoice(Array.isArray(rows) ? rows[0]?.ledger_calendar : null)};
  } catch { return {unavailable: true, choice: parseChoice(null)}; }
}
export async function saveChoice(rt, choice, userId = ctx(rt).userId) {
  await rt.api(`/rest/v1/app_profiles?user_id=eq.${encode(userId)}`, {method: 'PATCH', body: {ledger_calendar: serializeChoice(choice)}});
}
// 고를 수 있는 캘린더 목록과 이벤트 색(Edge status). {connected, calendars:[{id, summary}], eventColors}
export async function readCalendars(rt) {
  const data = await rt.api('/functions/v1/google-calendar?action=status');
  if (data?.connected === false || data?.needs_reconnect || !Array.isArray(data?.calendars)) return {connected: false, calendars: [], eventColors: {}};
  return {
    connected: true,
    calendars: data.calendars.filter(c => c?.id).map(c => ({id: String(c.id), summary: String(c.summary || '')})),
    eventColors: data.eventColors && typeof data.eventColors === 'object' ? data.eventColors : {},
  };
}

// ---- 참고 일정 표 ----
export async function readRefs(rt, first, end) {
  const {workspaceId} = ctx(rt);
  const rows = await rt.api(`/rest/v1/app_calendar_work_refs?workspace_id=eq.${encode(workspaceId)}&day=gte.${first}&day=lt.${end}&select=${REF_FIELDS}&order=day.asc&limit=500`);
  return Array.isArray(rows) ? rows : [];
}
export async function setIncluded(rt, id, included) {
  const {workspaceId} = ctx(rt);
  const rows = await rt.api(`/rest/v1/app_calendar_work_refs?workspace_id=eq.${encode(workspaceId)}&id=eq.${encode(id)}`, {method: 'PATCH', prefer: 'return=representation', body: {included: !!included, decided_by: 'user'}});
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('저장 결과를 확인할 수 없습니다.');
  return rows[0];
}
// 캘린더 고르기를 비우거나 바꿀 때: 저장된 참고 일정을 모두 지운다(원장 근거는 '원문이 지워졌어요'로 남는다).
export async function clearRefs(rt) {
  const {workspaceId} = ctx(rt);
  await rt.api(`/rest/v1/app_calendar_work_refs?workspace_id=eq.${encode(workspaceId)}`, {method: 'DELETE'});
}

// ---- 읽어서 판단해 표에 맞추기 ----
async function readOrgs(rt) {
  const {workspaceId} = ctx(rt);
  try {
    const rows = await rt.api(`/rest/v1/app_suborganizations?workspace_id=eq.${encode(workspaceId)}&select=id,name,aliases,active&order=id.asc&limit=1000`);
    return (Array.isArray(rows) ? rows : []).filter(o => o?.id && o.active !== false);
  } catch { return []; }
}
async function readProjectNames() {
  try {
    const c = window.KPTUProjectCatalog, ids = window.KPTURuntime?.context?.read?.();
    if (!c?.load || !ids?.workspace?.id || !ids?.user?.id) return [];
    const snap = await c.load({workspaceId: ids.workspace.id, userId: ids.user.id});
    return (snap?.loaded && Array.isArray(snap.tree) ? snap.tree : []).map(e => e?.project).filter(p => p?.name && !['done', 'completed'].includes(p.status)).map(p => String(p.name));
  } catch { return []; }
}
// 고른 캘린더 하나의 일정(Edge 판에 상관없이 그 캘린더 것만). fallback = 옛 Edge가 저장된 목록의 일정을 준 증거.
async function readEvents(rt, calendar, first, end) {
  const data = await rt.api(`/functions/v1/google-calendar?action=events&onlyCalendarId=${encode(calendar)}&timeMin=${encode(dayStartIso(first))}&timeMax=${encode(dayStartIso(end))}`);
  const events = Array.isArray(data?.events) ? data.events : null;
  if (!events || data?.connected === false || data?.needs_reconnect || data?.authorized === false) throw new Error('calendar');
  const partial = !!(data?.warning || (Array.isArray(data?.failedCalendars) && data.failedCalendars.length));
  if (partial && !events.length) throw new Error('calendar');
  return {events, partial, fallback: events.some(e => e?.calendarId !== calendar), legacy: events.length > 0 && !events.some(e => e && 'mine' in e)};
}
const range = (first, end) => ({first, end});

// first부터 end 전날까지 한 번 맞춘다. 돌려주는 값: {summary, counts, legacy, fallback}
export async function syncRefs(rt, choice, first, end) {
  const {workspaceId} = ctx(rt);
  if (!choice?.calendar) return null;
  const read = await readEvents(rt, choice.calendar, first, end);
  const [orgs, projectNames] = await Promise.all([readOrgs(rt), readProjectNames()]);
  const picked = read.events.filter(e => isSelected(e, choice)).slice(0, SYNC_EVENT_CAP);
  const context = {orgs, projectNames};
  const picks = [];
  for (const event of picked) picks.push(await buildPick(event, choice, context));
  const inRange = picks.filter(p => p.day >= first && p.day < end);
  const existing = await readRefs(rt, first, end);
  // 읽은 범위 밖으로 옮겨진 일정의 줄도 이어 쓰도록 키로 한 번 더 찾는다.
  const known = new Set(existing.map(r => r.event_key)), missing = inRange.map(p => p.key).filter(k => !known.has(k));
  if (missing.length) {
    const more = await rt.api(`/rest/v1/app_calendar_work_refs?workspace_id=eq.${encode(workspaceId)}&event_key=in.(${missing.join(',')})&select=${REF_FIELDS}&limit=500`);
    if (Array.isArray(more)) existing.push(...more);
  }
  // 지우기는 고른 캘린더만 제대로 읽었을 때만(옛 Edge가 다른 캘린더 일정을 줬거나 일부만 읽혔으면 지우지 않는다).
  const plan = planSync({existing, picks: inRange, range: range(first, end), prune: !read.fallback && !read.partial});
  if (plan.insert.length) await rt.api('/rest/v1/app_calendar_work_refs', {method: 'POST', prefer: 'return=minimal', body: plan.insert.map(r => ({workspace_id: workspaceId, ...r}))});
  for (const {id, patch} of plan.update) await rt.api(`/rest/v1/app_calendar_work_refs?workspace_id=eq.${encode(workspaceId)}&id=eq.${encode(id)}`, {method: 'PATCH', body: patch});
  if (plan.remove.length) await rt.api(`/rest/v1/app_calendar_work_refs?workspace_id=eq.${encode(workspaceId)}&id=in.(${plan.remove.map(encode).join(',')})`, {method: 'DELETE'});
  return {summary: syncSummary(plan.counts), counts: plan.counts, legacy: read.legacy, fallback: read.fallback, partial: read.partial};
}

// 업무일지 한 주: 고르기를 읽고(없으면 아무 일 없음) 그 주와 다음 2주를 맞춘 뒤 그 주의 줄을 돌려준다.
// 달력 읽기가 실패해도 표에 있던 줄은 보여 준다(syncFailed).
export async function loadWeekRefs(rt, weekFirst, weekEnd, syncEnd) {
  const {choice, unavailable} = await readChoice(rt);
  if (unavailable || !choice.calendar) return {configured: false, rows: [], personalByDay: {}};
  let syncFailed = false, personalByDay = {}, note = '';
  try {
    const result = await syncRefs(rt, choice, weekFirst, syncEnd);
    personalByDay = result?.counts?.personalByDay || {};
    if (result?.fallback) note = 'fallback'; else if (result?.legacy && choice.mine) note = 'legacy';
  } catch { syncFailed = true; }
  return {configured: true, rows: await readRefs(rt, weekFirst, weekEnd), syncFailed, personalByDay, note};
}
export const defaultSyncRange = (today = todayKey()) => {
  const monday = weekStart(today);
  return {first: shiftWeek(monday, -1), end: shiftWeek(monday, 3)};
};
