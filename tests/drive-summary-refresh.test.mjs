import { test } from 'node:test';
import assert from 'node:assert/strict';
import { affectsSummary, createRefresher, SUMMARY_FIELDS, WAIT_MS, MAX_WAIT_MS } from '../app/drive-summary.js';

const BASE = 'https://example.supabase.co';

function clock() {
  let t = 0, seq = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimer: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimer: id => { timers.delete(id); },
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]); t = next[1].at; next[1].fn();
        await new Promise(r => setImmediate(r));
      }
      t = end;
      await new Promise(r => setImmediate(r));
    },
    pending: () => timers.size,
  };
}

function harness({ owner = true, call } = {}) {
  const c = clock(), calls = [];
  const state = { owner };
  const r = createRefresher({
    isOwner: () => state.owner,
    call: call || (async opts => { calls.push(opts); }),
    now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer,
  });
  return { r, c, calls, state };
}

test('waits are 3 minutes after the last save, at most 10 minutes from the first', () => {
  assert.equal(WAIT_MS, 180000);
  assert.equal(MAX_WAIT_MS, 600000);
});

test('one save makes exactly one call after three minutes', async () => {
  const { r, c, calls } = harness();
  r.saved();
  await c.advance(WAIT_MS - 1); assert.equal(calls.length, 0);
  await c.advance(1); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { leaving: false });
  await c.advance(MAX_WAIT_MS * 2); assert.equal(calls.length, 1);
});

test('a burst of saves within the wait is batched into one call', async () => {
  const { r, c, calls } = harness();
  for (let i = 0; i < 5; i++) { r.saved(); await c.advance(60000); }
  assert.equal(calls.length, 0);
  await c.advance(WAIT_MS); assert.equal(calls.length, 1);
});

test('continuous saving still calls once the ten-minute ceiling is reached', async () => {
  const { r, c, calls } = harness();
  r.saved();
  for (let i = 0; i < 9; i++) { await c.advance(60000); r.saved(); }
  assert.equal(calls.length, 0);
  await c.advance(60000); assert.equal(calls.length, 1, 'fires at 10 minutes from the first save');
});

test('saves during a running call queue exactly one follow-up batch', async () => {
  let release;
  const calls = [];
  const { r, c } = harness({ call: async () => { calls.push(1); await new Promise(res => { release = res; }); } });
  r.saved(); await c.advance(WAIT_MS); assert.equal(calls.length, 1);
  r.saved(); r.saved(); await c.advance(WAIT_MS * 3); assert.equal(calls.length, 1, 'no overlap');
  release(); await c.advance(0);
  await c.advance(WAIT_MS); assert.equal(calls.length, 2);
  release(); await c.advance(MAX_WAIT_MS); assert.equal(calls.length, 2);
});

test('a failed call is swallowed and does not retry by itself', async () => {
  let n = 0;
  const { r, c } = harness({ call: async () => { n++; throw new Error('HTTP 502'); } });
  r.saved(); await c.advance(WAIT_MS); assert.equal(n, 1);
  await c.advance(MAX_WAIT_MS); assert.equal(n, 1);
  r.saved(); await c.advance(WAIT_MS); assert.equal(n, 2, 'the next save tries again');
});

test('non-owner saves never schedule a call', async () => {
  const { r, c, calls } = harness({ owner: false });
  r.saved(); await c.advance(MAX_WAIT_MS); assert.equal(calls.length, 0); assert.equal(c.pending(), 0);
});

test('logout before the timer fires drops the pending call', async () => {
  const { r, c, calls, state } = harness();
  r.saved(); state.owner = false; r.reset();
  await c.advance(MAX_WAIT_MS); assert.equal(calls.length, 0);
});

test('flush sends a pending batch immediately as a leaving call, and only once', async () => {
  const { r, c, calls } = harness();
  r.flush(); await c.advance(0); assert.equal(calls.length, 0, 'nothing pending, nothing sent');
  r.saved(); await c.advance(1000);
  r.flush(); r.flush(); await c.advance(0);
  assert.deepEqual(calls, [{ leaving: true }]);
  await c.advance(MAX_WAIT_MS); assert.equal(calls.length, 1);
});

const included = [
  ['app_suborganization_updates', 'POST', []], ['app_suborganization_updates', 'DELETE', []],
  ['app_suborganizations', 'PATCH', ['recent_month_summary']], ['app_suborganizations', 'PATCH', ['active']],
  ['app_spaces', 'PATCH', ['status']], ['app_project_progress_updates', 'PATCH', ['summary']],
  ['app_project_milestones', 'PATCH', ['start_at']], ['app_meetings', 'PATCH', ['round_no']],
  ['app_documents', 'PATCH', ['project_id']], ['app_notes', 'PATCH', ['raw_text']], ['app_notes', 'PATCH', ['kind']],
  ['app_suborganization_assignees', 'POST', []],
];
for (const [table, method, fields] of included) {
  test(`${table} ${method} ${fields.join(',')} changes the copy`, () => {
    assert.equal(affectsSummary({ path: `/rest/v1/${table}?id=eq.1`, method, fields }, BASE), true);
  });
}
const excluded = [
  ['app_project_comments', 'PATCH', ['body']], ['app_suborganizations', 'PATCH', ['year_summary']],
  ['app_meetings', 'PATCH', ['transcript_text', 'notes']], ['app_profiles', 'PATCH', ['display_name']],
  ['app_documents', 'PATCH', ['meeting_id', 'updated_at']], ['app_spaces', 'PATCH', ['color']],
];
for (const [table, method, fields] of excluded) {
  test(`${table} ${method} ${fields.join(',')} does not change the copy`, () => {
    assert.equal(affectsSummary({ path: `/rest/v1/${table}`, method, fields }, BASE), false);
  });
}

test('project-linked creations, task actions, uploads and basket confirmations', () => {
  const s = (path, extra = {}) => affectsSummary({ path, method: 'POST', fields: [], ...extra }, BASE);
  assert.equal(s('/rest/v1/app_documents', { projectLinked: true }), true);
  assert.equal(s('/rest/v1/app_documents', { projectLinked: false }), false);
  assert.equal(s('/rest/v1/app_record_links', { projectLinked: false }), false);
  for (const [action, linked, expected] of [['create', true, true], ['create', false, false], ['link', true, true], ['unlink', false, false], ['toggle', false, true], ['update', false, true], ['delete', false, true], ['tasks', false, false]]) {
    assert.equal(s('/functions/v1/google-tasks?action=' + action, { projectLinked: linked }), expected, action);
    assert.equal(s('/functions/v1/google-tasks', { action, projectLinked: linked }), expected, action);
  }
  assert.equal(s('/functions/v1/library-files', { projectLinked: true }), true);
  assert.equal(s('/functions/v1/library-files', { projectLinked: false }), false);
  assert.equal(s('/functions/v1/meeting-files', { projectLinked: true }), true);
  assert.equal(s('/functions/v1/basket-files'), true);
  assert.equal(s('/rest/v1/rpc/app_basket_confirm_links'), true);
  assert.equal(s('/rest/v1/rpc/other_rpc'), false);
  assert.equal(s('/functions/v1/drive-summary'), false, 'its own call never schedules another');
});

test('other origins and malformed details are ignored', () => {
  assert.equal(affectsSummary({ path: 'https://other.example/rest/v1/app_notes', method: 'POST', fields: [] }, BASE), false);
  assert.equal(affectsSummary(null, BASE), false);
  assert.equal(affectsSummary({ method: 'POST' }, BASE), false);
  assert.equal(affectsSummary({ path: '/rest/v1/__proto__', method: 'POST', fields: [] }, BASE), false);
});

test('copy field list covers what drive-summary selects', () => {
  for (const table of ['app_suborganizations', 'app_suborganization_updates', 'app_spaces', 'app_project_workstreams', 'app_project_progress_updates', 'app_project_milestones', 'app_meetings', 'app_record_links', 'app_documents', 'app_notes']) {
    assert.ok(Array.isArray(SUMMARY_FIELDS[table]) && SUMMARY_FIELDS[table].length, table);
  }
});
