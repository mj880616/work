// ORG-기록하나로 O-4: 조직보고 창 순수 규칙(app/record-window-model.mjs, 설계 docs/design/record-one.md 2-5~2-9). 이름은 모두 가짜.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../app/record-window-model.mjs';
import {eventOrg} from '../app/pre-meeting-sheet-model.mjs';

const W = '2026-11-16'; // 보고하는 주(월)
const A = 'aaaaaaaa-0000-4000-8000-000000000001', B = 'bbbbbbbb-0000-4000-8000-000000000002';
const orgs = [{id: A, name: 'A 지부', aliases: ['에이']}, {id: B, name: 'B 지회', aliases: []}];
let seq = 0;
const R = (day, text, x = {}) => m.recordItem({id: `r${++seq}`, organization_id: A, raw_text: text, occurred_at: `${day}T12:00:00+09:00`, created_at: '2026-11-01T00:00:00Z', ...x});
const E = (id, start, title, x = {}) => ({id, title, start, end: null, allDay: /^\d{4}-\d{2}-\d{2}$/.test(start), calendarId: 'primary', organizationIds: [], ...x});

test('주 경계와 창: 지난 3주 ~ 앞 2주, 전환 주 앞은 옛 주', () => {
  assert.deepEqual(m.orgWindow(W), {from: '2026-10-26', to: '2026-12-07'});
  assert.equal(m.orgWindow('nope'), null);
  assert.deepEqual(m.eventRanges(W), [{from: '2026-10-26', to: W}, {from: W, to: '2026-12-07'}]);
  const r = m.readRange(W);
  assert.equal(r.to, '2026-12-07');
  assert.ok(r.from < '2026-10-19');
  assert.equal(m.isOldWeek('2026-11-02'), true);
  assert.equal(m.isOldWeek(m.RECORD_ONE_FROM), false);
  // 서울 날짜: 밤 11시 30분(서울)은 그날.
  assert.equal(m.recordItem({id: 'x', organization_id: A, raw_text: '가', occurred_at: '2026-11-15T14:30:00Z'}).day, '2026-11-15');
  // 창 끝 날(제외)·시작 날(포함)
  assert.equal(m.overlaps({day: '2026-12-07'}, m.orgWindow(W)), false);
  assert.equal(m.overlaps({day: '2026-10-26'}, m.orgWindow(W)), true);
  assert.equal(m.overlaps({day: '2026-10-25'}, m.orgWindow(W)), false);
});

test('기간 기록은 걸친 주마다 나온다', () => {
  const span = R('2026-11-02', '찬반투표', {end_day: '2026-12-05'});
  for (const week of ['2026-11-02', '2026-11-09', '2026-11-16', '2026-12-14', '2026-12-21']) {
    assert.equal(m.orgCell({org: A, week, records: [span]}).shown.length, 1, week);
  }
  // 12.5 + 21일 뒤 주(12.28)에는 창 밖
  assert.equal(m.orgCell({org: A, week: '2026-12-28', records: [span]}).shown.length, 0);
  assert.equal(m.lineText(m.orgCell({org: A, week: W, records: [span]}).shown[0]), '- 11.2.~12.5. 찬반투표');
  // 이번 주에 걸친 기간 기록은 늘 보임(지난 줄이 많아도 접히지 않음)
  const many = Array.from({length: 9}, (_, i) => R(`2026-11-1${i % 6}`, `지난 줄 ${i}`, {occurred_at: `2026-11-${String(10 + (i % 5)).padStart(2, '0')}T12:00:00+09:00`}));
  const cell = m.orgCell({org: A, week: W, records: [...many, span]});
  assert.ok(cell.shown.some(l => l.text === '찬반투표'));
});

test('7줄 상한: 늘 보임 먼저, 지난 줄은 최근 것부터, 넘친 것은 접기(일정 줄 포함)', () => {
  const recs = [R('2026-11-16', '이번 주 1'), R('2026-11-25', '앞 주 1'), R('2026-12-03', '앞 주 2'),
    R('2026-11-13', '지난 1'), R('2026-11-10', '지난 2'), R('2026-11-04', '지난 3'), R('2026-10-30', '지난 4'), R('2026-10-27', '지난 5')];
  const evs = m.eventItems([E('ev1', '2026-11-27', 'A 지부 대의원대회')], orgs);
  const cell = m.orgCell({org: A, week: W, records: recs, events: evs});
  assert.equal(cell.shown.length, 7);
  assert.deepEqual(cell.shown.map(l => l.text), ['지난 3', '지난 2', '지난 1', '이번 주 1', '앞 주 1', 'A 지부 대의원대회', '앞 주 2']);
  assert.deepEqual(cell.folded.map(l => l.text), ['지난 4', '지난 5']);
  // 늘 보임만으로 7을 넘으면 다 보인다
  const ahead = Array.from({length: 9}, (_, i) => R(`2026-11-${17 + i}`, `앞 ${i}`));
  assert.equal(m.orgCell({org: A, week: W, records: ahead}).shown.length, 9);
  // 접힌 줄 [넣기](in)는 상한과 상관없이 보인다
  const folded = cell.folded[0];
  const marks = [{week_start: W, section: 'org', ref_kind: 'org_update', ref_key: folded.key, choice: 'in'}];
  const c2 = m.orgCell({org: A, week: W, records: recs, events: evs, marks});
  assert.ok(c2.shown.some(l => l.key === folded.key));
  assert.ok(c2.shown.length >= 7);
});

test('표시 이어짐: 뺀 줄은 다음 주에도 빠지고, 다음 주에 되돌리면 이번 주는 그대로', () => {
  const r = R('2026-11-17', '사소한 줄');
  let marks = [];
  const apply = (week, change) => {
    const p = m.nextMark(marks, {section: 'org', kind: r.kind, key: r.key, week}, change);
    if (p.op === 'insert') marks = [...marks, {id: `m${marks.length}`, ...p.row}];
    if (p.op === 'update') marks = marks.map(x => (x.id === p.id ? {...x, ...p.row} : x));
    if (p.op === 'delete') marks = marks.filter(x => x.id !== p.id);
    return p;
  };
  assert.equal(apply(W, {choice: 'out'}).op, 'insert');
  const next = m.shiftWeek(W, 1);
  assert.equal(m.orgCell({org: A, week: W, records: [r], marks}).out.length, 1);
  assert.equal(m.orgCell({org: A, week: next, records: [r], marks}).out.length, 1);
  assert.equal(apply(next, {choice: null}).op, 'insert');
  assert.equal(m.orgCell({org: A, week: next, records: [r], marks}).shown.length, 1);
  assert.equal(m.orgCell({org: A, week: W, records: [r], marks}).out.length, 1);
  // 다음 주에 다시 빼면 그 주 행이 앞 행과 같아져 지운다
  assert.equal(apply(next, {choice: 'out'}).op, 'delete');
  assert.equal(marks.length, 1);
  // 같은 값은 아무것도 안 함, 보고용 글은 행에 함께 복사
  assert.equal(apply(next, {choice: 'out'}).op, 'none');
  const p = m.nextMark(marks, {section: 'org', kind: r.kind, key: r.key, week: next}, {report_body: '보고용 글'});
  assert.deepEqual(p.row, {week_start: next, section: 'org', ref_kind: 'org_update', ref_key: r.key, report_body: '보고용 글', choice: 'out', detail: null});
  // 처음 행을 원래대로 되돌리면 지운다
  assert.equal(apply(W, {choice: null}).op, 'delete');
  assert.equal(marks.length, 0);
});

test('보고용 글: 그 주부터 보이고 ✓ 표시, 원래 글은 그대로', () => {
  const r = R('2026-11-17', '원래 글');
  const marks = [{week_start: W, section: 'org', ref_kind: 'org_update', ref_key: r.key, report_body: '보고 글'}];
  const l = m.orgCell({org: A, week: W, records: [r], marks}).shown[0];
  assert.equal(l.text, '보고 글'); assert.equal(l.orig, '원래 글'); assert.equal(l.edited, true);
  assert.equal(m.orgCell({org: A, week: m.shiftWeek(W, -1), records: [r], marks}).shown[0].text, '원래 글');
  assert.equal(m.checkReportBody('  ').ok, false);
  assert.equal(m.checkReportBody('가'.repeat(1001)).ok, false);
  assert.deepEqual(m.checkReportBody(' 보고 '), {ok: true, value: '보고'});
});

test('뺀 줄 n은 그 주 창 안의 것만 센다(하루 기록 6주 뒤, 기간 기록 끝날 + 21일 뒤 빠짐)', () => {
  const one = R('2026-11-17', '하루 기록'), span = R('2026-11-02', '기간 기록', {end_day: '2026-12-05'});
  const marks = [one, span].map(x => ({week_start: W, section: 'org', ref_kind: 'org_update', ref_key: x.key, choice: 'out'}));
  const count = week => m.orgCell({org: A, week, records: [one, span], marks}).out.length;
  assert.equal(count(W), 2);
  assert.equal(count('2026-12-07'), 2); // 11.17은 12.7 주 창(11.16~)에 아직 있음
  assert.equal(count('2026-12-14'), 1); // 11.17 < 11.23 → 하루 기록 빠짐
  assert.equal(count('2026-12-21'), 1); // 12.5 >= 11.30 → 기간 기록 아직
  assert.equal(count('2026-12-28'), 0); // 12.5 < 12.7 → 빠짐
});

test('3. 2) 투쟁 사업장: 3~7줄, 모자라면 창 이전 기록으로 채우고 건너뛴 뺀 줄만 센다, 일정 줄 없음', () => {
  const old = [R('2026-10-01', '옛 1'), R('2026-09-20', '옛 2'), R('2026-09-10', '옛 3'), R('2026-09-01', '옛 4')];
  const now = [R('2026-11-17', '이번 주')];
  const marks = [{week_start: W, section: 'site', ref_kind: 'org_update', ref_key: old[0].key, choice: 'out'}];
  const evs = m.eventItems([E('ev9', '2026-11-18', 'A 지부 집회')], orgs);
  const cell = m.siteCell({org: A, week: W, records: [...old, ...now], events: evs, marks});
  assert.deepEqual(cell.shown.map(l => l.text), ['옛 3', '옛 2', '이번 주']);
  assert.equal(cell.out.length, 1);
  assert.ok(!cell.shown.some(l => l.kind === 'event'));
  // 4. 1) 표시와 따로(org에서 뺀 줄은 site에서는 그대로)
  const orgMarks = [{week_start: W, section: 'org', ref_kind: 'org_update', ref_key: now[0].key, choice: 'out'}];
  assert.equal(m.siteCell({org: A, week: W, records: now, marks: orgMarks}).shown.length, 1);
  // 7줄 상한
  const lots = Array.from({length: 10}, (_, i) => R(`2026-11-${String(17 + i).padStart(2, '0')}`, `줄 ${i}`));
  assert.ok(m.siteCell({org: A, week: W, records: lots}).shown.length >= 7);
  assert.equal(m.siteCell({org: A, week: W, records: lots.slice(0, 2).map(x => ({...x, day: '2026-11-10'}))}).shown.length, 2);
});

test('일정 연결 ①②③: 연결 있으면 제목 판정 안 함, 두 조직 맞는 제목은 어디에도 안 넣음, 참고 캘린더는 주요 낱말만', () => {
  const linked = m.eventItems([E('e1', '2026-11-18', 'B 지회 간담회', {organizationIds: [A.toUpperCase(), 'cccccccc-0000-4000-8000-000000000003']})], orgs);
  assert.deepEqual(linked.map(x => x.org), [A]);
  const both = m.eventItems([E('e2', '2026-11-18', 'A 지부·B 지회 공동 회의')], orgs);
  assert.equal(both.length, 0);
  const multi = m.eventItems([E('e3', '2026-11-18', '공동 일정', {organizationIds: [A, B]})], orgs);
  assert.deepEqual(multi.map(x => x.org).sort(), [A, B].sort());
  const alias = m.eventItems([E('e4', '2026-11-18', '에이 교섭')], orgs);
  assert.deepEqual(alias.map(x => x.org), [A]);
  const ref = {calendar: 'ref@cal', org: B};
  const refs = m.eventItems([E('e5', '2026-11-19', '총력 결의대회', {calendarId: 'ref@cal'}), E('e6', '2026-11-19', '사무실 청소', {calendarId: 'ref@cal'}), E('e7', '2026-11-19', '중집 회의 집회 논의', {calendarId: 'ref@cal'})], orgs, ref);
  assert.deepEqual(refs.map(x => x.key), ['e5']);
  assert.equal(refs[0].org, B);
  // 회의 전 한 장 판정은 그대로(첫 연결, 연결 있으면 제목 보지 않음)
  assert.equal(eventOrg(E('e8', '2026-11-18', 'B 지회', {organizationIds: [A]}), orgs)?.id, A);
  assert.equal(eventOrg(E('e9', '2026-11-18', 'A 지부', {organizationIds: ['cccccccc-0000-4000-8000-000000000003']}), orgs), null);
});

test('일정 줄: 취소 뺌, 같은 id 두 캘린더 한 줄, 여러 날 종일 걸침, 기록과 같은 일은 감춤', () => {
  const evs = m.eventItems([
    E('x1', '2026-11-18', 'A 지부 대의원대회'), E('x1', '2026-11-18', 'A 지부 대의원대회', {calendarId: 'other'}),
    E('x2', '2026-11-19', 'A 지부 농성', {status: 'cancelled'}),
    E('x3', '2026-11-30', 'A 지부 파업', {end: '2026-12-04'}),
    E('x4', '2026-11-20T10:00:00+09:00', 'A 지부 교섭', {allDay: false}),
  ], orgs);
  assert.deepEqual(evs.map(x => x.key), ['x1', 'x3', 'x4']);
  assert.deepEqual([evs[1].day, evs[1].end_day], ['2026-11-30', '2026-12-03']);
  assert.equal(evs[2].day, '2026-11-20');
  const rec = R('2026-11-18', '합성 A 지부 대의원대회 개최');
  const cell = m.orgCell({org: A, week: W, records: [rec], events: evs});
  assert.deepEqual(cell.shown.map(l => l.kind + ':' + l.key), [`org_update:${rec.key}`, 'event:x4', 'event:x3']);
  // 여러 날 종일 일정은 걸친 주마다
  assert.equal(m.orgCell({org: A, week: '2026-11-30', events: evs}).shown.some(l => l.key === 'x3'), true);
  // event 표시 이어짐: 뺀 일정은 다음 주에도 빠짐
  const marks = [{week_start: W, section: 'org', ref_kind: 'event', ref_key: 'x4', choice: 'out'}];
  assert.equal(m.orgCell({org: A, week: m.shiftWeek(W, 1), events: evs, marks}).out.map(l => l.key).join(), 'x4');
});

test('지난주 표시: 앞 주 표에 보인 줄', () => {
  const recs = [R('2026-11-12', '지난 주 줄'), R('2026-12-01', '앞 줄')];
  const prev = m.shownIds({org: A, week: m.shiftWeek(W, -1), records: recs});
  const cell = m.orgCell({org: A, week: W, records: recs, prevIds: prev});
  assert.deepEqual(cell.shown.map(l => [l.text, l.last]), [['지난 주 줄', true], ['앞 줄', false]]);
});

test('확정 사진: 사진 줄 그대로 + 확정 뒤 추가(기록 created_at, 일정 seen_events)', () => {
  const before = R('2026-11-17', '확정 전 줄', {created_at: '2026-11-20T01:00:00Z'});
  const later = R('2026-11-18', '확정 뒤 줄', {created_at: '2026-11-21T09:00:00Z'});
  const changedDay = R('2026-11-19', '날짜만 바꾼 옛 줄', {created_at: '2026-11-02T00:00:00Z'});
  const evs = m.eventItems([E('s1', '2026-11-20', 'A 지부 집회'), E('s2', '2026-11-21', 'A 지부 선전전')], orgs);
  const snapshot = {confirmed_at: '2026-11-21T00:00:00Z', rows: [{section: 'org', ref_kind: 'org', ref_key: A, lines: [{ref_kind: 'org_update', ref_key: before.key, day: before.day, text: '보고한 글'}], seen_events: ['s1']}]};
  const v = m.snapshotView({org: A, week: W, snapshot, records: [before, later, changedDay], events: evs});
  assert.deepEqual(v.lines.map(l => l.text), ['보고한 글']);
  assert.deepEqual(v.after.map(l => l.text), ['확정 뒤 줄', 'A 지부 선전전']);
  // 다른 조직 칸이 없으면 줄 없음
  assert.equal(m.snapshotView({org: B, week: W, snapshot, records: []}).lines.length, 0);
  // 앞 주 사진이 있으면 '지난주'는 사진 줄 기준
  assert.deepEqual([...m.shownIds({org: A, week: W, snapshot, records: [later]})], [`org_update:${before.key}`]);
});

test('새 기록 검사·저장 시각', () => {
  assert.equal(m.checkRecord({day: '', body: '가'}).field, 'day');
  assert.equal(m.checkRecord({day: '2026-11-17', end_day: '2026-11-16', body: '가'}).field, 'end_day');
  assert.equal(m.checkRecord({day: '2026-11-17', body: ' '}).field, 'body');
  assert.deepEqual(m.checkRecord({day: '2026-11-17', end_day: '2026-11-17', body: ' 가 '}).value, {day: '2026-11-17', end_day: null, body: '가'});
  assert.equal(m.occurredAt('2026-11-17'), '2026-11-17T12:00:00+09:00');
});
