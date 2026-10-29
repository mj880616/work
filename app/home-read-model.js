import {seoulDateKey,seoulParts} from './meeting-time.js';
import {dueGroup} from './task-due.mjs';
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
const confirmed = (links) =>
  (links || []).filter((l) => l.status === "confirmed");
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
    .slice(0, 3)
    .map((m) => ({
      ...m,
      days: Math.round((Date.parse(m.date) - Date.parse(today)) / DAY),
    }));
}
// Home 오늘 일정 rows (display copy shape). Shared by the home card and the calendar, which refreshes the home copy when it
// reads today's events (CAL-저장본먼저), so both judge colors and today's events alike.
// 일정 한 건의 색: 그 일정 자신의 색 → 내가 정한 캘린더 색 → 캘린더 기본 색. 홈·달력·업무일지 [하루]가 같은 규칙을 쓴다(없으면 '').
export const eventColor = (e, status) => e?.color || status?.colors?.[e?.calendarId] || status?.calendars?.find((c) => c.id === e?.calendarId)?.backgroundColor || '';
export function homeEventRows(events, status = {}, now = Date.now()) {
  return todayEvents(events || [], now).map((e) => {
    const raw = eventColor(e, status);
    return { id: e.id || "", calendarId: e.calendarId || "", start: e.start, end: e.end, allDay: !!e.allDay, title: e.title, color: /^#[0-9a-f]{6}$/i.test(raw) ? raw : "var(--kptu-primary-ink)" };
  });
}
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
// 홈 [오늘 할 일]: 할 일 화면과 같은 기한 묶음(task-due.mjs dueGroup)의 '기한 지남'·'오늘'. 내일 것은 할 일 화면 '내일' 묶음에 있다.
export function dueTasks(tasks, now = Date.now()) {
  const today = dayKey(now);
  return tasks
    .filter(
      (t) =>
        t.status !== "completed" &&
        ["overdue", "today"].includes(dueGroup(t.due, today)),
    )
    .sort((a, b) =>
      String(a.due).slice(0, 10).localeCompare(String(b.due).slice(0, 10)),
    );
}
export function unlinkedTasks(tasks, links) {
  const ids = new Set(
    confirmed(links)
      .filter((l) => l.project_id || l.organization_id)
      .map((l) => l.google_task_id),
  );
  return tasks.filter((t) => t.status !== "completed" && !ids.has(t.id));
}
export function meetingTasks(tasks, links) {
  const ids = new Set(
    confirmed(links)
      .filter((l) => l.meeting_id)
      .map((l) => l.google_task_id),
  );
  return tasks.filter((t) => t.status !== "completed" && ids.has(t.id));
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
