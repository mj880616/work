import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ranges,
  dayKey,
  milestoneChips,
  todayEvents,
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

test("mixed organization records take newest five together, preserving microseconds and stable id/type ties", () => {
  const orgs = [{id:'o',active:true},{id:'inactive',active:false},{id:'unassigned',active:true}];
  const row = (id,type,occurred_at,organization_id='o') => ({id,type,occurred_at,organization_id});
  const rows = [
    row('same','update','2026-10-06T01:00:00.000001Z'),
    row('same','basket','2026-10-06T01:00:00.000001Z'),
    row('z','basket','2026-10-06T01:00:00.000002Z'),
    row('a','update','2026-10-06T01:00:00.000001Z'),
    row('fifth','basket','2026-10-05T17:00:00Z'),
    row('old','update','2026-10-05T16:00:00Z'),
    row('end','basket','2026-10-11T15:00:00Z'),
    row('inactive','basket','2026-10-07T01:00:00Z','inactive'),
    row('unassigned','basket','2026-10-07T01:00:00Z','unassigned'),
  ];
  const selected = weekUpdates(rows,orgs,[{organization_id:'o'},{organization_id:'inactive'}],Date.parse('2026-10-06T01:00:00Z'));
  assert.deepEqual(selected.map(r=>[r.id,r.type]),[['z','basket'],['a','update'],['same','basket'],['same','update'],['fifth','basket']]);
  assert.deepEqual(weekUpdates(rows,orgs,[],Date.parse('2026-10-06T01:00:00Z')),[]);
});
test("mixed records use the note date at the KST Monday boundary, never link timestamps", () => {
  const rows = [
    {id:'start',type:'basket',organization_id:'o',occurred_at:'2026-10-04T15:00:00Z',confirmed_at:'2026-10-03T00:00:00Z'},
    {id:'before',type:'basket',organization_id:'o',occurred_at:'2026-10-04T14:59:59.999999Z',confirmed_at:'2026-10-06T00:00:00Z'},
    {id:'end',type:'basket',organization_id:'o',occurred_at:'2026-10-11T15:00:00Z'},
  ];
  assert.deepEqual(weekUpdates(rows,[{id:'o',active:true}],[{organization_id:'o'}],Date.parse('2026-10-06T00:00:00Z')).map(r=>r.id),['start']);
});

test('unknown active state is excluded even when an organization is assigned',()=>{
 const rows=[{id:'unknown',organization_id:'unknown',occurred_at:'2026-10-06T01:00:00Z'},{id:'null',organization_id:'null',occurred_at:'2026-10-06T01:00:00Z'}];
 assert.deepEqual(weekUpdates(rows,[{id:'unknown'},{id:'null',active:null}],[{organization_id:'unknown'},{organization_id:'null'}],Date.parse('2026-10-06T01:00:00Z')),[]);
});
