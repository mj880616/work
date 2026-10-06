import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ranges,
  dayKey,
  milestoneChips,
  todayEvents,
  dueTasks,
  unlinkedTasks,
  meetingTasks,
  weekUpdates,
} from "../app/home-read-model.js";
const now = Date.parse("2026-10-04T14:59:00Z");
test("KST midnight and Monday boundaries are independent of device timezone", () => {
  assert.equal(dayKey(now), "2026-10-04");
  assert.equal(dayKey(now + 60000), "2026-10-05");
  assert.equal(ranges(now).weekStart, "2026-09-27T15:00:00.000Z");
  assert.equal(ranges(now + 60000).weekStart, "2026-10-04T15:00:00.000Z");
  assert.equal(ranges(now + 60000).weekEnd, "2026-10-11T15:00:00.000Z");
});
test("active child milestones exclude completed, cancelled, undated and past", () => {
  const ps = [
    { id: "p", status: "active" },
    { id: "child", parent_id: "p", status: "active" },
    { id: "done", status: "done" },
  ];
  const ms = [
    ["today", "p", "planned", "2026-10-04"],
    ["child", "child", "confirmed", "2026-10-05"],
    ["completed", "p", "completed", "2026-10-04"],
    ["cancelled", "p", "cancelled", "2026-10-04"],
    ["old", "p", "planned", "2026-10-03"],
    ["done", "done", "planned", "2026-10-04"],
    ["no-date", "p", "planned", null],
    ["far", "p", "planned", "2026-10-10"],
  ].map(([id, project_id, status, start_at]) => ({
    id,
    project_id,
    status,
    start_at,
  }));
  const chips = milestoneChips(ps, ms, now);
  assert.deepEqual(
    chips.map((m) => m.id),
    ["today", "child", "far"],
  );
  assert.deepEqual(
    chips.map((m) => m.days),
    [0, 1, 6],
  );
});
test("all-day multi-day events overlap with exclusive end; timed events sorted", () => {
  const es = [
    {
      id: "late",
      start: "2026-10-04T13:00:00+09:00",
      end: "2026-10-04T14:00:00+09:00",
    },
    { id: "ended", allDay: true, start: "2026-10-01", end: "2026-10-04" },
    { id: "span", allDay: true, start: "2026-10-03", end: "2026-10-06" },
    {
      id: "early",
      start: "2026-10-04T10:00:00+09:00",
      end: "2026-10-04T11:00:00+09:00",
    },
  ];
  assert.deepEqual(
    todayEvents(es, now).map((e) => e.id),
    ["span", "early", "late"],
  );
});
test("overdue oldest first; unlinked includes future, undated and meeting-only; Google status wins", () => {
  const ts = [
    { id: "today", due: "2026-10-04T00:00:00Z" },
    { id: "past", due: "2026-10-02T00:00:00Z" },
    { id: "meeting" },
    { id: "future", due: "2026-10-12" },
    { id: "done", status: "completed" },
    { id: "pending" },
  ];
  const links = [
    { google_task_id: "past", project_id: "p", status: "confirmed" },
    {
      google_task_id: "meeting",
      meeting_id: "m",
      status: "confirmed",
      task_completed: true,
    },
    {
      google_task_id: "done",
      meeting_id: "m",
      status: "confirmed",
      task_completed: false,
    },
    { google_task_id: "pending", project_id: "p", status: "pending" },
  ];
  assert.deepEqual(
    dueTasks(ts, now).map((t) => t.id),
    ["past", "today"],
  );
  assert.deepEqual(
    unlinkedTasks(ts, links).map((t) => t.id),
    ["today", "meeting", "future", "pending"],
  );
  assert.deepEqual(
    meetingTasks(ts, links).map((t) => t.id),
    ["meeting"],
  );
});
test("weekly updates only assigned active orgs, end exclusive, newest five", () => {
  const orgs = [
    { id: "o", active: true },
    { id: "inactive", active: false },
  ];
  const ups = Array.from({ length: 7 }, (_, i) => ({
    id: i,
    organization_id: "o",
    occurred_at: `2026-09-30T0${i}:00:00Z`,
  })).concat([
    { id: "end", organization_id: "o", occurred_at: "2026-10-04T15:00:00Z" },
    {
      id: "inactive",
      organization_id: "inactive",
      occurred_at: "2026-09-30T12:00:00Z",
    },
  ]);
  assert.deepEqual(
    weekUpdates(
      ups,
      orgs,
      [{ organization_id: "o" }, { organization_id: "inactive" }],
      now,
    ).map((u) => u.id),
    [6, 5, 4, 3, 2],
  );
});
