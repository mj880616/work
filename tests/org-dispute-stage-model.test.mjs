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
