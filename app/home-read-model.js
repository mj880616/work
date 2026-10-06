const DAY = 86400000,
  KST = 9 * 3600000;
export const dayKey = (now = Date.now()) =>
  new Date(now + KST).toISOString().slice(0, 10);
export function ranges(now = Date.now()) {
  const today = dayKey(now),
    start = Date.parse(today + "T00:00:00+09:00");
  const weekday = new Date(start + KST).getUTCDay(),
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
export function dueTasks(tasks, now = Date.now()) {
  const today = dayKey(now);
  return tasks
    .filter(
      (t) =>
        t.status !== "completed" &&
        t.due &&
        String(t.due).slice(0, 10) <= today,
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
export function weekUpdates(updates, orgs, assignees, now = Date.now()) {
  const assigned = new Set(assignees.map((a) => a.organization_id)),
    ids = new Set(
      orgs
        .filter((o) => o.active !== false && assigned.has(o.id))
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
    .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
    .slice(0, 5);
}
