import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_STAGES, seedRows, stageOfOrg, reportKind, listTag, weekOf, monthDay, stageLabel, reorderChanges, stageNameProblem, orgsAtStageText, historyLines} from '../app/org-dispute-stage-model.mjs';

// ORG-쟁의단계: 단계 판정·꼬리표·순서 바꾸기. 조직·단계는 모두 가짜 값.
const stages = seedRows('w').map((row, i) => ({id: 's' + (i + 1), ...row, created_at: '2026-10-01T00:00:00Z'}));
const id = name => stages.find(s => s.name === name).id;
const row = (n, org, name, date, at = '2026-10-20T00:00:00Z') => ({id: 'h' + n, organization_id: org, stage_id: name ? id(name) : null, stage_name: name ?? '지워진 단계', stage_date: date, created_at: at});

test('기본 단계 11개: 순서·표시', () => {
  assert.deepEqual(DEFAULT_STAGES.map(s => s.name), ['교섭 시작 전', '교섭 중', '쟁의발생 결의', '조정 신청', '조정 종료', '파업 찬반투표', '쟁의중', '잠정합의', '임단협 찬반투표', '협약체결', '종료']);
  assert.equal(seedRows('w')[0].is_default, true);
  assert.equal(seedRows('w').filter(s => s.is_default).length, 1);
  assert.deepEqual(DEFAULT_STAGES.filter(s => s.is_struggle).map(s => s.name), ['쟁의발생 결의', '조정 신청', '조정 종료', '파업 찬반투표', '쟁의중', '잠정합의', '임단협 찬반투표']);
  assert.deepEqual(DEFAULT_STAGES.filter(s => s.is_ending).map(s => s.name), ['협약체결', '종료']);
  assert.ok(DEFAULT_STAGES.every(s => !(s.is_struggle && s.is_ending)));
});

test('현재 단계: 이력 없음은 기본 단계, 가장 나중 줄이 현재', () => {
  const none = stageOfOrg('a', new Map(), stages);
  assert.equal(none.name, '교섭 시작 전'); assert.equal(none.kind, 'quiet'); assert.equal(none.date, '');
  const h = new Map([['a', [row(1, 'a', '교섭 중', '2026-09-01'), row(2, 'a', '쟁의발생 결의', '2026-10-20'), row(3, 'a', '조정 신청', '2026-10-20', '2026-10-21T00:00:00Z')]]]);
  const cur = stageOfOrg('a', h, stages);
  assert.equal(cur.name, '조정 신청'); assert.equal(cur.kind, 'struggle');
});

test('종류: 투쟁 중·끝남·그 밖, 지워진 단계(id 빔)는 그 밖', () => {
  const kind = (name, date = '2026-10-20') => stageOfOrg('a', new Map([['a', [row(1, 'a', name, date)]]]), stages).kind;
  assert.equal(kind('교섭 중'), 'quiet'); assert.equal(kind('임단협 찬반투표'), 'struggle'); assert.equal(kind('협약체결'), 'ended'); assert.equal(kind(null), 'quiet');
  assert.equal(stageOfOrg('a', new Map([['a', [row(1, 'a', null, '2026-10-20')]]]), stages).name, '지워진 단계');
});

test('이름을 바꿔도 현재 단계는 새 이름, 이력 글자는 그때 이름', () => {
  const renamed = stages.map(s => s.id === id('쟁의중') ? {...s, name: '파업 중'} : s);
  const h = new Map([['a', [row(1, 'a', '쟁의중', '2026-10-20')]]]);
  assert.equal(stageOfOrg('a', h, renamed).name, '파업 중');
  assert.equal(historyLines(h.get('a'))[0].name, '쟁의중');
});

test('주(월~일)와 표에 나갈지: 투쟁 중은 매주, 끝남은 끝난 주만', () => {
  assert.deepEqual(weekOf('2026-10-24'), {start: '2026-10-19', end: '2026-10-25'});
  assert.deepEqual(weekOf('2026-10-25'), {start: '2026-10-19', end: '2026-10-25'});
  assert.deepEqual(weekOf('2026-10-26'), {start: '2026-10-26', end: '2026-11-01'});
  const cur = (name, date) => stageOfOrg('a', new Map([['a', [row(1, 'a', name, date)]]]), stages);
  const week = weekOf('2026-10-24');
  assert.equal(reportKind(cur('쟁의중', '2026-08-01'), week), 'struggle');
  assert.equal(reportKind(cur('협약체결', '2026-10-24'), week), 'ended');
  assert.equal(reportKind(cur('협약체결', '2026-10-24'), weekOf('2026-10-31')), '');
  assert.equal(reportKind(cur('종료', '2026-10-18'), week), '');
  assert.equal(reportKind(cur('교섭 중', '2026-10-22'), week), '');
  assert.equal(reportKind(stageOfOrg('a', new Map(), stages), week), '');
});

test('목록 꼬리표는 투쟁 중과 이번 주 끝남만', () => {
  const cur = (name, date) => stageOfOrg('a', new Map([['a', [row(1, 'a', name, date)]]]), stages);
  assert.deepEqual(listTag(cur('쟁의발생 결의', '2026-10-20'), '2026-10-24'), {kind: 'struggle', text: '쟁의발생 결의'});
  assert.deepEqual(listTag(cur('협약체결', '2026-10-23'), '2026-10-24'), {kind: 'ended', text: '협약체결'});
  assert.equal(listTag(cur('협약체결', '2026-10-10'), '2026-10-24'), null);
  assert.equal(listTag(cur('교섭 중', '2026-10-10'), '2026-10-24'), null);
});

test('날짜 글자', () => {
  assert.equal(monthDay('2026-10-04'), '10.4'); assert.equal(monthDay('2026-01-20'), '1.20'); assert.equal(monthDay(''), '');
  assert.equal(stageLabel({name: '쟁의발생 결의', date: '2026-10-20'}), '쟁의발생 결의(10.20)');
});

test('순서 바꾸기는 바뀐 줄만', () => {
  assert.deepEqual(reorderChanges(stages, 's2', 0).map(c => c.id), ['s2', 's1']);
  assert.deepEqual(reorderChanges(stages, 's3', 2), []);
  assert.equal(reorderChanges(stages, 'nope', 1).length, 0);
  assert.deepEqual(reorderChanges(stages, 's11', 10), []);
});

test('이름 검사·지우기 알림 글', () => {
  assert.match(stageNameProblem('', stages), /적어/);
  assert.match(stageNameProblem('가'.repeat(21), stages), /20자/);
  assert.match(stageNameProblem('교섭 중', stages), /이미/);
  assert.equal(stageNameProblem('교섭 중', stages, 's2'), '');
  assert.equal(stageNameProblem('새 단계', stages), '');
  assert.equal(orgsAtStageText(['가지부', '나지부', '다지부']), '가지부 외 2곳이 이 단계예요.');
  assert.equal(orgsAtStageText([]), '');
});

// ORG-쟁의단계 다듬기(2026-10-24 11:05): 단계 기간(끝 날짜). 판정은 모델 한 곳.
import {periodProblem, periodInWeek, periodText, endOf, isStageLine, sitePlan} from '../app/org-dispute-stage-model.mjs';
const prow = (n, org, name, date, end, at = '2026-10-20T00:00:00Z') => ({...row(n, org, name, date, at), end_date: end ?? null});

test('기간: 끝 날짜는 선택, 끝 ≥ 시작, 표기 11.3 ~ 11.5', () => {
  assert.equal(periodProblem('2026-11-03', ''), '');
  assert.equal(periodProblem('2026-11-03', '2026-11-03'), '');
  assert.equal(periodProblem('2026-11-03', '2026-11-05'), '');
  assert.match(periodProblem('2026-11-03', '2026-11-02'), /같거나 뒤/);
  assert.match(periodProblem('2026-11-03', '2026-13-40'), /확인/);
  assert.equal(periodText('2026-11-03', '2026-11-05'), '11.3~11.5');
  assert.equal(periodText('2026-11-03', '2026-11-05', ' ~ '), '11.3 ~ 11.5');
  assert.equal(periodText('2026-11-03', ''), '11.3');
  assert.equal(periodText('2026-11-03', '2026-11-03'), '11.3');
  assert.equal(endOf({stage_date: '2026-11-03', end_date: null}), '2026-11-03');
  assert.equal(endOf({stage_date: '2026-11-03', end_date: '2026-11-05'}), '2026-11-05');
  const h = new Map([['a', [prow(1, 'a', '파업 찬반투표', '2026-11-03', '2026-11-05')]]]);
  assert.deepEqual(historyLines(h.get('a')).map(l => [l.date, l.name, l.start, l.end]), [['11.3 ~ 11.5', '파업 찬반투표', '2026-11-03', '2026-11-05']]);
  const cur = stageOfOrg('a', h, stages);
  assert.equal(cur.end, '2026-11-05');
  assert.equal(stageLabel(cur), '파업 찬반투표(11.3~11.5)');
});

test('기간이 그 주에 걸쳐 있으면 진행 중(주 경계 포함)', () => {
  const week = weekOf('2026-11-04'); // 11.2~11.8
  assert.equal(periodInWeek('2026-11-03', '2026-11-05', week), true);
  assert.equal(periodInWeek('2026-10-30', '2026-11-02', week), true);  // 앞 주에서 시작해 월요일에 끝
  assert.equal(periodInWeek('2026-11-08', '2026-11-12', week), true);  // 일요일에 시작
  assert.equal(periodInWeek('2026-10-26', '2026-11-20', week), true);  // 주를 통째로 덮음
  assert.equal(periodInWeek('2026-10-26', '2026-11-01', week), false); // 앞 주에 끝남
  assert.equal(periodInWeek('2026-11-09', '2026-11-10', week), false);
  assert.equal(periodInWeek('2026-11-04', '', week), true);            // 끝 날짜 없음 = 하루
  assert.equal(periodInWeek('2026-11-01', '', week), false);
});

test('끝남 단계는 기간이 걸친 주마다 표에 나오고, 투쟁 중은 매주(기간과 무관)', () => {
  const cur = (name, date, end) => stageOfOrg('a', new Map([['a', [prow(1, 'a', name, date, end)]]]), stages);
  // 협약체결 10.30~11.3: 10.26 주와 11.2 주 둘 다, 11.9 주는 빠짐
  assert.equal(reportKind(cur('협약체결', '2026-10-30', '2026-11-03'), weekOf('2026-10-26')), 'ended');
  assert.equal(reportKind(cur('협약체결', '2026-10-30', '2026-11-03'), weekOf('2026-11-02')), 'ended');
  assert.equal(reportKind(cur('협약체결', '2026-10-30', '2026-11-03'), weekOf('2026-11-09')), '');
  // 끝 날짜 없음: 기존처럼 끝난 주 한 번
  assert.equal(reportKind(cur('협약체결', '2026-10-30', null), weekOf('2026-11-02')), '');
  assert.equal(reportKind(cur('파업 찬반투표', '2026-08-01', '2026-08-03'), weekOf('2026-11-02')), 'struggle');
  // 목록 꼬리표도 같은 판정
  assert.deepEqual(listTag(cur('협약체결', '2026-10-30', '2026-11-03'), '2026-11-02'), {kind: 'ended', text: '협약체결'});
});

test('주간보고 줄: 기간이면 - 파업 찬반투표(11.3~11.5), 앱이 채운 옛 기간 줄도 단계 줄로 알아봄', () => {
  const orgs = [{id: 'a', name: '합성 가 지부'}];
  const plan = sitePlan(orgs, new Map([['a', [prow(1, 'a', '파업 찬반투표', '2026-11-03', '2026-11-05')]]]), stages, weekOf('2026-11-04'));
  assert.deepEqual(plan.map(p => [p.kind, p.line]), [['struggle', '- 파업 찬반투표(11.3~11.5)']]);
  assert.equal(isStageLine('- 파업 찬반투표(11.3~11.5)', stages), true);
  assert.equal(isStageLine('- 파업 찬반투표(11.3 ~ 11.5)', stages), true);
  assert.equal(isStageLine('- 쟁의발생 결의(10.20)', stages), true);
  assert.equal(isStageLine('- 조정회의(11.3~11.5)', stages), false);
});

test('이력 고치기·지우기 뒤 현재 단계는 남은 이력의 최신 줄(다 지우면 기본 단계)', () => {
  const rows = [prow(1, 'a', '교섭 중', '2026-10-01', null, '2026-10-01T00:00:00Z'), prow(2, 'a', '쟁의중', '2026-10-20', null, '2026-10-20T00:00:00Z')];
  assert.equal(stageOfOrg('a', new Map([['a', rows]]), stages).name, '쟁의중');
  // 고치기: 쟁의중 줄 날짜를 앞으로 옮기면 교섭 중이 현재
  const edited = [rows[0], {...rows[1], stage_date: '2026-09-20'}];
  assert.equal(stageOfOrg('a', new Map([['a', edited]]), stages).name, '교섭 중');
  // 지우기
  assert.equal(stageOfOrg('a', new Map([['a', [rows[0]]]]), stages).name, '교섭 중');
  const none = stageOfOrg('a', new Map([['a', []]]), stages);
  assert.equal(none.name, '교섭 시작 전'); assert.equal(none.kind, 'quiet');
});
