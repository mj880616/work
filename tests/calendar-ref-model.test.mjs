// 원장 재료 C-4: 참고 일정 규칙(순수)·표 맞추기·서버 길(가짜 runtime)·주간 정리 분리. 가짜 이름·값만 쓴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChoice, serializeChoice, toggleColor, isSelected, cleanTitle, eventKey, judgeEvent, buildPick, planSync, daySummary, refLine, weeklyPart, syncSummary } from '../app/calendar-ref-model.mjs';
import { syncRefs, loadWeekRefs, setIncluded, clearRefs, saveChoice, readChoice } from '../app/calendar-ref-data.js';
import { weeklySummary, weeklyReportText } from '../app/journal-weekly.js';

const CAL = 'cal-a';
const choice = { calendar: CAL, colors: ['3'], mine: true };
const ev = (id, title, extra = {}) => ({ id, title, calendarId: CAL, start: '2026-10-21T14:00:00+09:00', end: '2026-10-21T15:00:00+09:00', allDay: false, colorId: null, mine: false, ...extra });
const orgs = [{ id: 'o1', name: '가 지부', aliases: [] }, { id: 'o2', name: '나 지부', aliases: [] }];

test('고르기 값: 모양이 틀린 칸은 버리고, 색은 5개까지, 비우면 빈 객체', () => {
  assert.deepEqual(parseChoice({ calendar: 'x', colors: ['3', 'a', '3', '11'], mine: true, extra: 1 }), { calendar: 'x', colors: ['3', '11'], mine: true });
  assert.deepEqual(parseChoice('x'), { calendar: '', colors: [], mine: false });
  assert.deepEqual(serializeChoice({ calendar: '', colors: ['1'], mine: true }), {});
  assert.deepEqual(serializeChoice(choice), { calendar: CAL, colors: ['3'], mine: true });
  assert.equal(toggleColor(['1', '2', '3', '4', '5'], '6'), null);
  assert.deepEqual(toggleColor(['1', '2'], '2'), ['1']);
});

test('어느 일정: 고른 캘린더의 고른 색 또는 내가 만든 일정(켠 경우), 취소·다른 캘린더 제외', () => {
  assert.equal(isSelected(ev('a', 'x', { colorId: '3' }), choice), true);
  assert.equal(isSelected(ev('a', 'x', { colorId: '4' }), choice), false);
  assert.equal(isSelected(ev('a', 'x', { mine: true }), choice), true);
  assert.equal(isSelected(ev('a', 'x', { mine: true }), { ...choice, mine: false }), false);
  assert.equal(isSelected(ev('a', 'x', { mine: true, calendarId: 'other' }), choice), false);
  assert.equal(isSelected(ev('a', 'x', { mine: true, status: 'cancelled' }), choice), false);
  // 옛 Edge: mine 칸 없음 → 색 규칙만 동작
  const old = ev('a', 'x', { colorId: '3' }); delete old.mine;
  assert.equal(isSelected(old, choice), true);
});

test('업무 여부: 조직 연결 > 조직 이름 > 업무 낱말 > 개인 > 애매, 개인은 저장 안 함', async () => {
  assert.deepEqual(judgeEvent(ev('a', '아무 제목', { organizationIds: ['o1'] }), { orgs }), { verdict: 'work', organizationId: 'o1' });
  assert.deepEqual(judgeEvent(ev('a', '아무 제목', { organizationIds: ['o1', 'o2'] }), { orgs }), { verdict: 'work', organizationId: null });
  assert.deepEqual(judgeEvent(ev('a', '가지부 간담회'), { orgs }), { verdict: 'work', organizationId: 'o1' });
  assert.equal(judgeEvent(ev('a', '가 지부 나 지부 합동'), { orgs }).organizationId, null);
  assert.equal(judgeEvent(ev('a', '다음 사업 점검'), { projectNames: ['다음 사업'] }).verdict, 'work');
  assert.equal(judgeEvent(ev('a', '임금 교섭'), {}).verdict, 'work');
  assert.equal(judgeEvent(ev('a', '병원 예약'), {}).verdict, 'personal');
  assert.equal(judgeEvent(ev('a', '회식'), {}).verdict, 'personal');
  assert.equal(judgeEvent(ev('a', '(제목 없음)'), {}).verdict, 'personal');
  assert.equal(judgeEvent(ev('a', '저녁 모임 자리'), {}).verdict, 'unsure');
  const pick = await buildPick(ev('a', '병원 예약'), choice, {});
  assert.equal(pick.row, null);
  const work = await buildPick(ev('b', '임금 교섭'), choice, {});
  assert.deepEqual([work.row.judged, work.row.included, work.row.decided_by, work.row.day, work.row.all_day], ['work', true, 'rule', '2026-10-21', false]);
  assert.match(work.row.event_key, /^[0-9a-f]{32}$/);
  assert.equal(work.row.start_at, '2026-10-21T05:00:00.000Z');
  const unsure = await buildPick(ev('c', '저녁 모임 자리'), choice, {});
  assert.equal(unsure.row.included, false);
  const allDay = await buildPick(ev('d', '임금 교섭', { allDay: true, start: '2026-10-22', end: '2026-10-23' }), choice, {});
  assert.deepEqual([allDay.row.day, allDay.row.start_at, allDay.row.all_day], ['2026-10-22', null, true]);
});

test('표 줄에는 캘린더·일정 ID 원문이 없고 제목은 80자·제어문자 없음', async () => {
  const pick = await buildPick(ev('SECRET-EVENT-ID', `교섭\n${'가'.repeat(100)}`), { ...choice, calendar: CAL }, {});
  const text = JSON.stringify(pick.row);
  assert.ok(!text.includes('SECRET-EVENT-ID') && !text.includes(CAL));
  assert.ok([...pick.row.title].length <= 80 && !/[\u0000-\u001f]/.test(pick.row.title));
  assert.equal(await eventKey('a', 'b'), await eventKey('a', 'b'));
  assert.notEqual(await eventKey('a', 'b'), await eventKey('a', 'c'));
  assert.equal(cleanTitle('  가   나\t'), '가 나');
});

const row = (over = {}) => ({ id: 'r1', event_key: 'k1', day: '2026-10-21', start_at: '2026-10-21T05:00:00.000Z', all_day: false, title: 'T', judged: 'work', included: true, decided_by: 'rule', organization_id: null, ...over });
const pickOf = (over = {}, verdict = 'work') => ({ key: 'k1', day: '2026-10-21', verdict, row: { event_key: 'k1', day: '2026-10-21', start_at: '2026-10-21T05:00:00Z', all_day: false, title: 'T', judged: verdict, included: verdict === 'work', decided_by: 'rule', organization_id: null, ...over } });
const range = { first: '2026-10-19', end: '2026-11-09' };

test('맞추기: 없으면 넣고, 같으면 건드리지 않고(updated_at 안 올림), 바뀌면 고친다', () => {
  assert.equal(planSync({ existing: [], picks: [pickOf()], range }).insert.length, 1);
  const none = planSync({ existing: [row()], picks: [pickOf()], range });
  assert.deepEqual([none.insert.length, none.update.length, none.remove.length], [0, 0, 0]);
  const changed = planSync({ existing: [row()], picks: [pickOf({ title: 'T2' })], range });
  assert.deepEqual(changed.update, [{ id: 'r1', patch: { title: 'T2' } }]);
});

test('명진이 바꾼 체크는 규칙이 덮지 않고, 규칙이 정한 줄은 규칙을 따른다', () => {
  const user = planSync({ existing: [row({ judged: 'unsure', included: true, decided_by: 'user' })], picks: [pickOf({}, 'unsure')], range });
  assert.equal(user.update.length, 0);
  const rule = planSync({ existing: [row({ judged: 'unsure', included: false })], picks: [pickOf({}, 'work')], range });
  assert.deepEqual(rule.update[0].patch, { judged: 'work', included: true });
  // 개인으로 바뀌면 규칙 줄은 지우고, 명진이 체크한 줄은 남긴다.
  assert.deepEqual(planSync({ existing: [row()], picks: [pickOf({}, 'personal')], range }).remove, ['r1']);
  assert.deepEqual(planSync({ existing: [row({ decided_by: 'user' })], picks: [pickOf({}, 'personal')], range }).remove, []);
});

test('지우기: 읽은 범위 안에서 사라진 줄만, prune=false면 지우지 않음', () => {
  const gone = row({ id: 'g', event_key: 'kg', day: '2026-10-25' }), outside = row({ id: 'o', event_key: 'ko', day: '2026-12-01' });
  assert.deepEqual(planSync({ existing: [gone, outside], picks: [], range }).remove, ['g']);
  assert.deepEqual(planSync({ existing: [gone], picks: [], range, prune: false }).remove, []);
});

test('화면 글: 하루 한 줄·체크된 것만 재료·종일은 제목만', () => {
  const rows = [row(), row({ id: 'r2', event_key: 'k2', judged: 'unsure', included: false, title: '저녁 모임' }), row({ id: 'r3', all_day: true, start_at: null, title: '종일 행사' })];
  assert.equal(daySummary(rows), '개인 공유 캘린더 3 · 확인 1');
  assert.equal(refLine(rows[0]), '14:00 T');
  assert.equal(refLine(rows[2]), '종일 행사');
  const part = weeklyPart(rows, ['2026-10-21']);
  assert.equal(part.all.length, 3);
  assert.deepEqual(part.items.map(i => i.text), ['종일 행사', '14:00 T']);
  assert.equal(syncSummary({ work: 2, unsure: 1, personal: 3 }), '참고 3개 · 확인 1 · 개인 3개 뺌');
});

// ---- 서버 길(가짜 runtime) ----
function fake({ events = [], table = [], profile = [{ ledger_calendar: choice }], eventsFail = false } = {}) {
  const calls = [];
  const rt = {
    context: { read: () => ({ user: { id: 'u1' }, workspace: { id: 'w1' } }) },
    async api(path, o = {}) {
      calls.push({ path, method: o.method || 'GET', body: o.body ?? null });
      if (path.startsWith('/functions/v1/google-calendar')) { if (eventsFail) throw new Error('x'); return { events }; }
      if (path.includes('/app_profiles?')) { if (o.method === 'PATCH') { profile[0].ledger_calendar = o.body.ledger_calendar; return null; } return profile; }
      if (path.includes('/app_suborganizations?')) return orgs.map(x => ({ ...x, active: true }));
      if (path.includes('/app_calendar_work_refs')) {
        const m = o.method || 'GET';
        if (m === 'POST') { for (const b of o.body) table.push({ id: 'n' + table.length, ...b }); return null; }
        if (m === 'PATCH') { const id = decodeURIComponent(path.match(/[?&]id=eq\.([^&]+)/)[1]); const r = table.find(x => x.id === id); Object.assign(r, o.body); return o.prefer ? [r] : null; }
        if (m === 'DELETE') { if (path.includes('id=in.')) { const ids = decodeURIComponent(path.match(/[?&]id=in\.\(([^)]*)\)/)[1]).split(','); table.splice(0, table.length, ...table.filter(x => !ids.includes(x.id))); } else table.length = 0; return null; }
        if (path.includes('event_key=in.')) return [];
        return table.filter(x => x.day >= path.match(/day=gte\.([^&]+)/)[1] && x.day < path.match(/day=lt\.([^&]+)/)[1]);
      }
      throw new Error('unhandled ' + path);
    },
  };
  return { rt, calls, table };
}

test('동기화: 고른 캘린더 일정만 읽어 업무·애매는 넣고 개인은 개수만, 옛 Edge가 다른 캘린더를 줘도 안전', async () => {
  const f = fake({ events: [ev('e1', '임금 교섭', { colorId: '3' }), ev('e2', '저녁 모임 자리', { mine: true }), ev('e3', '병원 예약', { mine: true }), ev('e4', '교섭', { calendarId: 'other', mine: true }), ev('e5', '교섭', { colorId: '9' })] });
  const result = await syncRefs(f.rt, choice, '2026-10-19', '2026-11-09');
  assert.equal(f.table.length, 2);
  assert.deepEqual(f.table.map(r => r.judged).sort(), ['unsure', 'work']);
  assert.equal(result.counts.personal, 1);
  assert.equal(result.fallback, true);
  const read = f.calls.find(c => c.path.startsWith('/functions/v1/google-calendar'));
  assert.ok(read.path.includes('onlyCalendarId=cal-a'));
  assert.ok(!JSON.stringify(f.calls.filter(c => c.method !== 'GET')).includes('e1'));
});

test('동기화: 옛 Edge(다른 캘린더 일정이 옴)에서는 지우지 않고, 제대로 읽으면 사라진 줄을 지운다', async () => {
  const gone = { id: 'g', event_key: 'a'.repeat(32), day: '2026-10-21', start_at: null, all_day: true, title: '지난 줄', judged: 'work', included: true, decided_by: 'rule', organization_id: null };
  const f1 = fake({ events: [ev('x', '아무', { calendarId: 'other' })], table: [{ ...gone }] });
  await syncRefs(f1.rt, choice, '2026-10-19', '2026-11-09');
  assert.equal(f1.table.length, 1);
  const f2 = fake({ events: [], table: [{ ...gone }] });
  await syncRefs(f2.rt, choice, '2026-10-19', '2026-11-09');
  assert.equal(f2.table.length, 0);
});

test('주 읽기: 고르지 않았으면 표를 읽지도 않고, 달력 읽기가 실패해도 저장된 줄은 보여 준다', async () => {
  const none = fake({ profile: [{ ledger_calendar: {} }] });
  assert.deepEqual(await loadWeekRefs(none.rt, '2026-10-19', '2026-10-26', '2026-11-09'), { configured: false, rows: [], personalByDay: {} });
  assert.equal(none.calls.length, 1);
  const saved = { id: 's', event_key: 'b'.repeat(32), day: '2026-10-21', start_at: null, all_day: true, title: '저장된 줄', judged: 'work', included: true, decided_by: 'rule', organization_id: null };
  const f = fake({ eventsFail: true, table: [saved] });
  const read = await loadWeekRefs(f.rt, '2026-10-19', '2026-10-26', '2026-11-09');
  assert.equal(read.syncFailed, true);
  assert.equal(read.rows.length, 1);
});

test('체크 저장은 명진이 정한 것(user)으로, 비우기는 작업공간 전체 삭제, 고르기 저장·읽기', async () => {
  const saved = { id: 's', event_key: 'b'.repeat(32), day: '2026-10-21', judged: 'unsure', included: false, decided_by: 'rule' };
  const f = fake({ table: [saved] });
  await setIncluded(f.rt, 's', true);
  assert.deepEqual([saved.included, saved.decided_by], [true, 'user']);
  await clearRefs(f.rt);
  assert.equal(f.table.length, 0);
  await saveChoice(f.rt, { calendar: '', colors: [], mine: false });
  assert.deepEqual((await readChoice(f.rt)).choice, parseChoice(null));
});

test('주간 정리: 참고 일정은 참고 묶음·복사에는 체크된 것만 들어가고 5. 주요 일정(calendar)에는 영향이 없다', () => {
  const rows = [row({ title: '체크된 일정' }), row({ id: 'r2', event_key: 'k2', judged: 'unsure', included: false, title: '꺼진 일정' })];
  const base = { start: '2026-10-19', lines: new Map(), materials: { catalog: { status: 'ok', items: [] }, upcoming: { status: 'ok', items: [] } } };
  const without = weeklySummary(base);
  const withRefs = weeklySummary({ ...base, materials: { ...base.materials, calendarRefs: { status: 'ok', items: { configured: true, rows } } } });
  assert.deepEqual(withRefs.calendar, without.calendar);
  const text = weeklyReportText(withRefs);
  assert.ok(text.includes('개인 공유 캘린더(참고)') && text.includes('14:00 체크된 일정') && !text.includes('꺼진 일정'));
  assert.ok(!text.split('5. 주요 일정')[1].split('참고')[0].includes('체크된 일정'));
  // 고르지 않았거나 읽는 중이면 복사 글이 이전과 같다.
  assert.equal(weeklyReportText(weeklySummary({ ...base, materials: { ...base.materials, calendarRefs: { status: 'ok', items: { configured: false, rows: [] } } } })), weeklyReportText(without));
  assert.equal(weeklyReportText(weeklySummary({ ...base, materials: { ...base.materials, calendarRefs: { status: 'loading' } } })), weeklyReportText(without));
});
