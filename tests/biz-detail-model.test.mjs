// BIZ-기록하나로 B-4 ②(설계 docs/design/record-one.md 2-5·2-7 '2. 2) 주요 사업·회의결과'): 주요 사업 창 순수 규칙 — 사업별 묶음·표시 이어짐·상세 포함 기본값·화면 연결.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as D from '../app/biz-detail-model.mjs';
import {bizRecordItem} from '../app/business-now-model.mjs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const A = 'aaaaaaaa-0000-4000-8000-000000000001', T = 'aaaaaaaa-0000-4000-8000-000000000002', SUB = 'aaaaaaaa-0000-4000-8000-000000000003', B = 'aaaaaaaa-0000-4000-8000-000000000004';
const tree = [{project: {id: A, name: '조직 확대'}, depth: 0}, {project: {id: T, name: '신규 가입'}, depth: 1}, {project: {id: SUB, name: '사안'}, depth: 2}, {project: {id: B, name: '교육'}, depth: 0}];
const week = '2026-11-09';
const rec = (id, space, day, body, end_day = null) => bizRecordItem({id, space_id: space, day, end_day, body, source_kind: 'user'});
const meet = (id, area, at, extra = {}) => ({id, title: `회의${id}`, series_name: `회의${id}`, meeting_at: at, business_area_id: area, activity_kind: 'meeting', ...extra});
const lineOfMeeting = m => m.series_name;
const mark = (id, w, kind, key, v = {}) => ({id, week_start: w, section: 'biz_detail', ref_kind: kind, ref_key: key, report_body: null, choice: null, detail: null, ...v});

test('사업별 묶음: 나무 차례, 3단 사안은 세부 과제 줄로, 활동 없는 사업은 빠지고 그 주 밖·한 줄 업데이트는 뺀다', () => {
  const records = [rec('r1', SUB, '2026-11-10', '사안 기록'), rec('r2', A, '2026-11-02', '지난주 기록'), rec('r3', A, '2026-11-01', '긴 기간', '2026-11-12')];
  const meetings = [meet('m1', T, '2026-11-11T01:00:00Z'), meet('m2', B, '2026-11-17T01:00:00Z'), meet('m3', T, '2026-11-12T01:00:00Z', {activity_kind: 'oneline'}), meet('m4', '', '2026-11-13T01:00:00Z')];
  const g = D.detailGroups({week, records, meetings, tree, lineOfMeeting});
  assert.deepEqual(g.map(x => x.label), ['조직 확대', '조직 확대 › 신규 가입', '사업영역 없음']);
  assert.deepEqual(g[0].shown.map(l => l.id), ['biz_record:r3']); // 지난주 하루 기록은 빠지고, 이번 주에 걸친 기간 기록만
  assert.deepEqual(g[1].shown.map(l => l.id), ['biz_record:r1', 'meeting:m1']); // 날짜 오름차순
  assert.equal(g[1].known, true);
  assert.equal(g[2].known, false); // 사업영역 없는 보고는 [+ 쓰기] 없음
  assert.equal(D.shownCount(g), 4);
});

test('상세 포함 기본값: 결과 본문 있는 사업 보고 = full, 표시 detail로 한 줄만, 사업 기록은 늘 한 줄', () => {
  const meetings = [meet('m1', T, '2026-11-11T01:00:00Z', {transcript_text: '1. 첫째\n\n2. 둘째'}), meet('m2', T, '2026-11-11T02:00:00Z', {decisions: '옛 결과'}), meet('m3', T, '2026-11-11T03:00:00Z')];
  let g = D.detailGroups({week, meetings, tree, lineOfMeeting});
  const by = id => g.flatMap(x => x.shown).find(l => l.id === id);
  assert.equal(by('meeting:m1').detail, 'full');
  assert.deepEqual(by('meeting:m1').body, ['1. 첫째', '2. 둘째']);
  assert.equal(by('meeting:m2').detail, 'full');
  assert.equal(by('meeting:m3').detail, 'oneline');
  assert.equal(by('meeting:m3').canFull, false);
  // 한 줄만으로 바꾸면 그 주부터(다음 주 창에서도 이어짐 — 사업 창은 그 주만이라 같은 사업 보고는 그 주에만 나옴).
  assert.equal(D.toggledDetail(by('meeting:m1')), 'oneline');
  g = D.detailGroups({week, meetings, tree, lineOfMeeting, marks: [mark('k1', week, 'meeting', 'm1', {detail: 'oneline'})]});
  assert.equal(by('meeting:m1').detail, 'oneline');
  assert.equal(D.toggledDetail(by('meeting:m1')), null); // 기본값(full)으로 돌아가면 표시 지움
  const r = D.lineOf(rec('r1', T, '2026-11-10', '기록'), mark('k2', week, 'biz_record', 'r1', {detail: 'full'}));
  assert.equal(r.detail, 'oneline');
});

test('표시 이어짐: 뺀 줄은 뺀 줄로, 보고용 글은 한 줄로, 다음 주에 되돌리면 그 주부터', () => {
  const records = [rec('r1', T, '2026-11-10', '원래 글', '2026-11-20')];
  const marks = [mark('k1', week, 'biz_record', 'r1', {report_body: '보고용 글'}), mark('k2', '2026-11-16', 'biz_record', 'r1', {report_body: '보고용 글', choice: 'out'})];
  const g1 = D.detailGroups({week, records, tree, marks});
  assert.equal(g1[0].shown[0].text, '보고용 글');
  assert.equal(g1[0].shown[0].edited, true);
  const g2 = D.detailGroups({week: '2026-11-16', records, tree, marks});
  assert.equal(g2[0].shown.length, 0);
  assert.equal(g2[0].out.length, 1); // 활동은 있으니 묶음은 남고 '뺀 줄 1'
  // 되돌리기 = 그 주 행 지움(앞 행과 같아짐).
  assert.deepEqual(D.nextMark(marks, {section: 'biz_detail', kind: 'biz_record', key: 'r1', week: '2026-11-16'}, {choice: null}), {op: 'delete', id: 'k2'});
  assert.equal(D.lineText(g1[0].shown[0]), '- 11.10.~11.20. 보고용 글');
});

test('화면 연결: 홈 2. 2)와 사업 보고 2)가 같은 부품, 옛 주는 옛 길, 표시는 section biz_detail', () => {
  const win = read('app/biz-detail-window.js'), journal = read('app/journal.js'), table = read('app/weekly-summary-table.js');
  assert.match(win, /section=eq\.\$\{D\.SECTION\}/);
  assert.match(win, /saveBusinessRecord\(\{space_id: space, day, body, source_kind: 'user'\}/);
  assert.doesNotMatch(win, /localStorage|sessionStorage/);
  assert.match(journal, /if \(isRecordWeek\(start\)\) paintBizDetail\(host\);\n\s+else W\.paintDetailLines/);
  assert.match(journal, /createBizDetailBox\(\{rt, kinds:true\}\)/);
  assert.match(table, /createBizDetailBox\(\)/);
  assert.match(table, /<h3>2\) 주요 사업·회의결과<\/h3><div data-bp-detail><\/div>/);
  assert.equal(D.SECTION, 'biz_detail');
});
