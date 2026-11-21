import {seoulDateKey,seoulParts} from './meeting-time.js';
import {toneColor} from './event-color.mjs';
const DAY = 86400000;
export const dayKey = (now = Date.now()) => seoulDateKey(now);
export function ranges(now = Date.now()) {
  const today = dayKey(now),
    start = Date.parse(today + "T00:00:00+09:00");
  const weekday = seoulParts(start).weekday,
    monday = start - ((weekday + 6) % 7) * DAY;
  return {
    today,
    start,
    end: start + DAY,
    weekStart: new Date(monday).toISOString(),
    weekEnd: new Date(monday + 7 * DAY).toISOString(),
  };
}
const dated = (v) =>
  /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""))
    ? Date.parse(v + "T00:00:00+09:00")
    : Date.parse(v);
// S67-46: 같은 일정이 두 번 오면(같은 구글 일정이 두 사업영역에 이어짐, 또는 두 달력에서 온 같은 제목·같은 날) 앞의 것 하나만.
// 제목 비교는 meeting-join-model.mjs titleKey와 같은 모양(대소문자·띄어쓰기·문장부호 무시).
const sameTitleKey = (v) => String(v ?? "").toLowerCase().normalize("NFKC").replace(/[\s\p{P}\p{S}]+/gu, "").slice(0, 80);
function firstOfSame() {
  const seen = new Set();
  return (m) => {
    const title = sameTitleKey(m.title);
    const keys = [m.google_event_id ? `e:${m.google_calendar_id || ""}:${m.google_event_id}` : "", title ? `t:${m.date}:${title}` : ""].filter(Boolean);
    if (keys.some((k) => seen.has(k))) return false;
    keys.forEach((k) => seen.add(k));
    return true;
  };
}
export function milestoneChips(projects, milestones, now = Date.now()) {
  const ids = new Set(
      projects.filter((p) => p.status === "active").map((p) => p.id),
    ),
    { today } = ranges(now);
  return milestones
    .filter(
      (m) =>
        ids.has(m.project_id) &&
        m.start_at &&
        Number.isFinite(dated(m.start_at)) &&
        !["done", "completed", "cancelled", "canceled"].includes(m.status),
    )
    .map((m) => ({ ...m, date: dayKey(dated(m.start_at)) }))
    .filter((m) => m.date >= today)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || dated(a.start_at) - dated(b.start_at),
    )
    .filter(firstOfSame())
    .slice(0, 3)
    .map((m) => ({
      ...m,
      days: Math.round((Date.parse(m.date) - Date.parse(today)) / DAY),
    }));
}
// 일정 한 건의 원래 구글 색: 그 일정 자신의 색 → 내가 정한 캘린더 색 → 캘린더 기본 색(없으면 '').
export const eventSourceColor = (e, status) => e?.color || status?.colors?.[e?.calendarId] || status?.calendars?.find((c) => c.id === e?.calendarId)?.backgroundColor || '';
// 화면에 칠하는 일정 색(S67-65 E1): 원래 구글 색을 톤 낮춘 값(event-color.mjs 표). 달력·홈(업무일지) [하루]가 같은 함수를 쓴다(없으면 '').
export const eventColor = (e, status) => { const raw = eventSourceColor(e, status); return raw ? toneColor(raw) : ''; };
export function todayEvents(events, now = Date.now()) {
  const { start, end } = ranges(now);
  return events
    .filter(
      (e) =>
        e.status !== "cancelled" &&
        dated(e.start) < end &&
        dated(e.end) > start,
    )
    .sort(
      (a, b) =>
        Number(!!b.allDay) - Number(!!a.allDay) ||
        dated(a.start) - dated(b.start),
    );
}
// Date.parse keeps milliseconds; preserve PostgreSQL's additional microseconds for top-five ordering.
const recordTime = value => {
  const fraction = String(value || '').match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/)?.[1] || '';
  return Date.parse(value) * 1000 + Number(fraction.padEnd(6, '0').slice(3, 6));
};
export function weekUpdates(updates, orgs, assignees, now = Date.now()) {
  const assigned = new Set(assignees.map((a) => a.organization_id)),
    ids = new Set(
      orgs
        .filter((o) => o.active === true && assigned.has(o.id))
        .map((o) => o.id),
    ),
    r = ranges(now);
  return updates
    .filter(
      (u) =>
        ids.has(u.organization_id) &&
        Date.parse(u.occurred_at) >= Date.parse(r.weekStart) &&
        Date.parse(u.occurred_at) < Date.parse(r.weekEnd),
    )
    .sort((a, b) => recordTime(b.occurred_at) - recordTime(a.occurred_at) ||
      String(a.id).localeCompare(String(b.id)) ||
      String(a.type || 'update').localeCompare(String(b.type || 'update')))
    .slice(0, 5);
}
