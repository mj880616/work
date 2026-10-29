import test from 'node:test';
import assert from 'node:assert/strict';

// HOME-모바일홈채우기: 요약 숫자, 할 일 2건 + n건 더, 놓친 약속 고르기. Synthetic data only.
const m = await import('../app/home-fill-model.mjs');
const browse = await import('../app/ledger-browse-model.mjs');
const NOW = new Date('2026-10-25T03:00:00Z'); // 서울 2026-10-25 12:00
const row = (n, over = {}) => ({id: `r${n}`, ledger_id: `L-${String(n).padStart(3, '0')}`, kind: 'commitment', title: `약속 ${n}`, commitment_status: 'waiting', validity: 'current', follow_up_on: '2026-10-20', counterparty: '사측', ...over});

test('summary: 일정 · 할 일 · 새 소식, unknown values are left out', () => {
  assert.equal(m.summaryText({events: 3, tasks: 4, news: 12}), '일정 3 · 할 일 4 · 새 소식 12');
  assert.equal(m.summaryText({events: 0, tasks: 0, news: 0}), '일정 0 · 할 일 0 · 새 소식 0');
  assert.equal(m.summaryText({events: 3, tasks: 4, news: null}), '일정 3 · 할 일 4');
  assert.equal(m.summaryText({events: null, tasks: 4, news: 2}), '할 일 4 · 새 소식 2');
  // TG-요청강조: 나한테 온 요청은 1건 이상일 때만 붙는다.
  assert.equal(m.summaryText({events: 3, tasks: 4, news: 12, asks: 2}), '일정 3 · 할 일 4 · 새 소식 12 · 나한테 온 요청 2');
  assert.equal(m.summaryText({events: 3, tasks: 4, news: 12, asks: 0}), '일정 3 · 할 일 4 · 새 소식 12');
  assert.equal(m.summaryText({events: 3, tasks: 4, news: 12, asks: null}), '일정 3 · 할 일 4 · 새 소식 12');
  assert.equal(m.summaryText({}), '');
  assert.equal(m.summaryText(), '');
});

test('tasks: two shown, the rest become "+ n건 더"', () => {
  assert.deepEqual(m.limitRows([1, 2, 3, 4]), {shown: [1, 2], more: 2});
  assert.deepEqual(m.limitRows([1, 2]), {shown: [1, 2], more: 0});
  assert.deepEqual(m.limitRows([1]), {shown: [1], more: 0});
  assert.deepEqual(m.limitRows([]), {shown: [], more: 0});
  assert.deepEqual(m.limitRows(null), {shown: [], more: 0});
});

test('missed promises: same rule as the ledger screen (overdue), oldest first, at most 3', () => {
  const rows = [
    row(1, {follow_up_on: '2026-10-24'}), row(2, {follow_up_on: '2026-10-10'}), row(3, {follow_up_on: '2026-10-25'}), // today is not yet 지남
    row(4, {commitment_status: 'fulfilled'}), row(5, {kind: 'event'}), row(6, {follow_up_on: null}),
    row(7, {follow_up_on: '2026-10-20'}), row(8, {follow_up_on: '2026-10-15'})
  ];
  const picked = m.pickMissed(rows, NOW);
  assert.deepEqual(picked.map(r => r.id), ['r2', 'r8', 'r7']);
  assert.ok(picked.every(r => browse.overdue(r, NOW)), 'every picked row passes the ledger overdue() judgement');
  assert.deepEqual(m.pickMissed(rows, NOW, 5).map(r => r.id), ['r2', 'r8', 'r7', 'r1']);
  assert.deepEqual(m.pickMissed([], NOW), []);
  assert.deepEqual(m.pickMissed(undefined, NOW), []);
});

test('missed promise tag: n일째 (days past the check date)', () => {
  assert.equal(m.missedTag(row(1, {follow_up_on: '2026-10-24'}), NOW), '1일째');
  assert.equal(m.missedTag(row(1, {follow_up_on: '2026-10-10'}), NOW), '15일째');
  assert.equal(m.missedTag(row(1, {follow_up_on: '2026-10-25'}), NOW), '오늘');
});

test('missed promises read path is the ledger screen path', () => {
  const path = browse.overdueRecordsPath('w-1', '2026-10-25');
  assert.match(path, /kind=eq\.commitment&commitment_status=eq\.waiting&validity=in\.\(current,needs_check\)&follow_up_on=lt\.2026-10-25/);
  assert.match(path, /workspace_id=eq\.w-1/);
});

test('tomorrow line: first event, count of the rest, null when empty', () => {
  const at = v => v.slice(11, 16);
  assert.equal(m.tomorrowLine([], at), null);
  assert.equal(m.tomorrowLine(undefined, at), null);
  assert.deepEqual(m.tomorrowLine([{start: '2026-10-26T09:30:00+09:00', title: '주간 회의'}, {start: 'x', title: 'b'}, {start: 'y', title: 'c'}], at), {time: '09:30', title: '주간 회의', more: 2});
  assert.deepEqual(m.tomorrowLine([{allDay: true, start: '2026-10-26', title: '출장'}], at), {time: '종일', title: '출장', more: 0});
});
