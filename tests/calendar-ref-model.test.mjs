// CAL-조직참고캘린더: 조직 참고 캘린더 규칙(순수)·서버 읽기(가짜 runtime)·주간 정리 모델. 가짜 캘린더·조직·일정만 쓴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChoice, serializeChoice, choiceReady, isOrgRefTitle, pickOrgRefs, orgRefRange, slashDay, reportLine, alreadyIn, materialLine, ORG_REF_WORDS, ORG_REF_SKIP } from '../app/calendar-ref-model.mjs';
import { readOrgRefs, saveChoice, readChoice } from '../app/calendar-ref-data.js';
import { weeklySummary, weeklyReportText } from '../app/journal-weekly.js';

const CAL = 'cal-fake';
const ORG = '30000000-0000-4000-8000-0000000000aa';
const choice = { calendar: CAL, org: ORG };
const ev = (id, title, day, extra = {}) => ({ id, title, calendarId: CAL, start: `${day}T14:00:00+09:00`, end: `${day}T15:00:00+09:00`, allDay: false, ...extra });
const WEEK = '2026-11-02'; // 월요일

test('고르기 값: 캘린더와 조직(소문자 uuid)만, 예전 색·내 일정 칸은 읽지 않고 저장하지 않는다', () => {
  assert.deepEqual(parseChoice({ calendar: CAL, colors: ['3'], mine: true, org: ORG, extra: 1 }), { calendar: CAL, org: ORG });
  assert.deepEqual(parseChoice({ calendar: CAL, org: 'not-uuid' }), { calendar: CAL, org: '' });
  assert.deepEqual(parseChoice('x'), { calendar: '', org: '' });
  assert.deepEqual(serializeChoice({ calendar: CAL, org: ORG.toUpperCase(), colors: ['1'] }), { calendar: CAL, org: ORG });
  assert.deepEqual(serializeChoice({ calendar: '', org: '' }), {});
  assert.deepEqual(serializeChoice({ calendar: CAL, org: '' }), { calendar: CAL });
  assert.equal(choiceReady(choice), true);
  assert.equal(choiceReady({ calendar: CAL, org: '' }), false);
});

test('낱말 고르기: 집회·농성(농성장 설치)·선전전·조정 신청·본조 사업·대의원회·결의대회·조합원 총회·투쟁, 띄어 써도 맞음', () => {
  for (const t of ['가상 집회', '농성장 설치', '출근 선전전', '노동위 조정 신청', '본조 사업 설명', '대의원회', '임시 대의원대회', '간부결의대회', '총력결의대회', '조합원 총회', '총력 투쟁 선포',
    '조정신청 접수', '조합원총회'])
    assert.equal(isOrgRefTitle(t), true, t);
  for (const t of ['상집 회의', '상집회의', '중집회의 준비', '교섭 준비', '간담회', '', '병원']) assert.equal(isOrgRefTitle(t), false, t);
  assert.ok(ORG_REF_WORDS.includes('투쟁'));
});

test("'중집'은 고르는 낱말이 같이 있어도 뺀다", () => {
  assert.ok(ORG_REF_SKIP.includes('중집'));
  for (const t of ['중집', '중집 회의', '투쟁 관련 중집', '중앙집행위원회(집회 논의)', '중앙 집행 위원회 투쟁 논의']) assert.equal(isOrgRefTitle(t), false, t);
});

test('2주 범위: 그 주 월요일부터 3주(그 주 + 앞으로 2주), 범위 밖·취소·다른 캘린더는 빠지고 같은 날 같은 제목은 한 줄', () => {
  const range = orgRefRange(WEEK);
  assert.deepEqual(range, { first: '2026-11-02', end: '2026-11-23' });
  const events = [
    ev('a', '총력결의대회', '2026-11-04'),
    ev('a2', '총력 결의대회', '2026-11-04', { start: '2026-11-04T18:00:00+09:00' }),
    ev('b', '지난주 집회', '2026-11-01'),
    ev('c', '셋째 주 선전전', '2026-11-22', { allDay: true, start: '2026-11-22' }),
    ev('d', '넷째 주 농성', '2026-11-23'),
    ev('e', '취소된 집회', '2026-11-05', { status: 'cancelled' }),
    ev('f', '남의 캘린더 집회', '2026-11-05', { calendarId: 'other' }),
    ev('g', '중집', '2026-11-05'),
    ev('h', '조합원 총회', '2026-11-03', { start: '2026-11-03T09:30:00+09:00' }),
  ];
  const got = pickOrgRefs(events, choice, range);
  assert.deepEqual(got.map(i => i.label), ['11/3(화) 조합원 총회', '11/4(수) 총력결의대회', '11/22(일) 셋째 주 선전전']);
  assert.equal(got[0].time, '09:30'); assert.equal(got[2].time, '');
  assert.equal(slashDay('2026-11-04'), '11/4(수)');
  assert.equal(reportLine(got[1]), '- 11/4(수) 총력결의대회');
  assert.equal(materialLine(got[1]), '(조직 캘린더 일정) 11/4(수) 총력결의대회');
  assert.equal(alreadyIn(['- 11/4(수) 총력 결의대회 참가'], got[1]), true);
  assert.equal(alreadyIn('- 다른 줄', got[1]), false);
  assert.deepEqual(pickOrgRefs(events, { calendar: '', org: ORG }, range), []);
});

function fake({ ledger = {}, events = [], fail = false } = {}) {
  const calls = [];
  const rt = {
    context: { read: () => ({ user: { id: 'u1' }, workspace: { id: 'w1' } }) },
    async api(path, opts = {}) {
      calls.push({ path, method: opts.method || 'GET', body: opts.body });
      if (path.startsWith('/rest/v1/app_profiles?') && (opts.method || 'GET') === 'GET') return [{ ledger_calendar: ledger }];
      if (path.startsWith('/rest/v1/app_profiles?') && opts.method === 'PATCH') { ledger = opts.body.ledger_calendar; return null; }
      if (path.startsWith('/functions/v1/google-calendar?action=events')) { if (fail) throw new Error('x'); return { events }; }
      throw new Error('unexpected ' + path);
    },
  };
  return { rt, calls, get ledger() { return ledger; } };
}

test('서버 읽기: 둘 다 골라야 달력을 읽고(그 캘린더만, 3주 범위), 저장은 프로필 칸 하나뿐이며 참고 일정 표는 건드리지 않는다', async () => {
  const none = fake({ ledger: { calendar: CAL } });
  assert.deepEqual(await readOrgRefs(none.rt, WEEK), { configured: false, org: '', items: [] });
  assert.ok(!none.calls.some(c => c.path.includes('google-calendar')));
  const f = fake({ ledger: choice, events: [ev('a', '총력결의대회', '2026-11-04'), ev('b', '상집 회의', '2026-11-04')] });
  const read = await readOrgRefs(f.rt, WEEK);
  assert.equal(read.configured, true); assert.equal(read.org, ORG);
  assert.deepEqual(read.items.map(i => i.title), ['총력결의대회']);
  const q = new URL('https://x' + f.calls.find(c => c.path.includes('google-calendar')).path).searchParams;
  assert.equal(q.get('onlyCalendarId'), CAL);
  assert.equal(q.get('timeMin'), new Date('2026-11-02T00:00:00+09:00').toISOString());
  assert.equal(q.get('timeMax'), new Date('2026-11-23T00:00:00+09:00').toISOString());
  await assert.rejects(readOrgRefs(fake({ ledger: choice, fail: true }).rt, WEEK));
  await saveChoice(f.rt, { calendar: CAL, org: ORG });
  assert.deepEqual(f.ledger, { calendar: CAL, org: ORG });
  assert.deepEqual((await readChoice(f.rt)).choice, choice);
  assert.ok(!f.calls.some(c => c.path.includes('app_calendar_work_refs')));
});

test('주간 정리 모델: 추천은 orgRefs로만 오고 5. 주요 일정·참고·복사 글에는 들어가지 않는다', () => {
  const base = { start: '2026-10-19', lines: new Map(), materials: { catalog: { status: 'ok', items: [] }, upcoming: { status: 'ok', items: [] } } };
  const without = weeklySummary(base);
  assert.deepEqual(without.orgRefs, { org: '', items: [] });
  const items = pickOrgRefs([ev('a', '가상 총력결의대회', '2026-10-21')], choice, orgRefRange('2026-10-19'));
  const withRefs = weeklySummary({ ...base, materials: { ...base.materials, orgRefs: { status: 'ok', items: { configured: true, org: ORG, items } } } });
  assert.deepEqual(withRefs.orgRefs, { org: ORG, items });
  assert.deepEqual(withRefs.calendar, without.calendar);
  assert.equal(weeklyReportText(withRefs), weeklyReportText(without));
  assert.ok(!('calRefs' in withRefs.notes));
  assert.deepEqual(weeklySummary({ ...base, materials: { ...base.materials, orgRefs: { status: 'failed' } } }).orgRefs, { org: '', items: [] });
});
