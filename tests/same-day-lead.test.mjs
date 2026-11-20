// S67-36: '날짜 + 내용' 줄의 내용 맨 앞 같은 날짜 떼기(app/same-day-lead.mjs)와 그 함수를 쓰는 화면·한글 파일 줄. 자료는 모두 합성.
import test from 'node:test';
import assert from 'node:assert/strict';
import {dropSameDay, dropLineDay} from '../app/same-day-lead.mjs';
import * as RW from '../app/record-window-model.mjs';
import * as BD from '../app/biz-detail-model.mjs';
import * as NM from '../app/business-now-model.mjs';
import {lineText as oldLineText} from '../app/weekly-org-lines-model.mjs';
import {hqLine, hqFields} from '../app/weekly-schedule-rows.mjs';
import {splitScheduleFields} from '../app/schedule-line-split.mjs';
import {materialLine} from '../app/weekly-ai-material.mjs';
import {ownDraft} from '../app/weekly-own-draft-model.mjs';

const D = '2026-11-18';

test('표기별로 같은 날이면 내용 맨 앞 날짜만 뗀다', () => {
  for (const t of ['11/18 현장 집회', '11.18 현장 집회', '11.18. 현장 집회', '11. 18. 현장 집회', '11월 18일 현장 집회', '2026-11-18 현장 집회',
    '2026.11.18. 현장 집회', '2026/11/18 현장 집회', '2026년 11월 18일 현장 집회', '11.18(화) 현장 집회', '11.18.(화) 현장 집회', '11/18 (화) 현장 집회',
    '11.18 화요일 현장 집회', '[11/18] 현장 집회', '(11.18) 현장 집회', '[11.18(화)] 현장 집회', '11/18 - 현장 집회', '11/18 – 현장 집회', '11/18: 현장 집회',
    '11/18, 현장 집회', '11.18.현장 집회', '11/18 11.18 현장 집회', '- 11/18 현장 집회']) {
    assert.equal(dropSameDay(t, D), '현장 집회', t);
  }
  assert.equal(dropSameDay('11/18 14:00 현장 집회', D), '14:00 현장 집회');
});

test('다른 날·중간 날짜·다른 해·숫자·빈 글은 그대로', () => {
  for (const t of ['11/17 현장 집회', '11.19. 현장 집회', '현장 집회 11/18', '현장 집회(11.18) 뒤 교섭', '2025-11-18 현장 집회', '2025년 11월 18일 현장 집회',
    '11.185 현장', '11.18.5 현장', '11/18', '[11/18]', '11.18~11.20 파업', '11/18집회']) {
    assert.equal(dropSameDay(t, D), t, t);
  }
  assert.equal(dropSameDay('1.5배 인상 요구', '2026-01-05'), '1.5배 인상 요구');
  assert.equal(dropSameDay('11.1 대회', '2026-11-01'), '대회');
  assert.equal(dropSameDay('11.1 대회', D), '11.1 대회');
  assert.equal(dropSameDay('11/18 집회', ''), '11/18 집회');
  assert.equal(dropSameDay('11/18 집회', null), '11/18 집회');
  assert.equal(dropSameDay(null, D), '');
});

test('기간 줄은 같은 기간일 때만 뗀다', () => {
  const E = '2026-11-20';
  assert.equal(dropSameDay('11.18~11.20 파업', D, E), '파업');
  assert.equal(dropSameDay('11.18.~11.20. 파업', D, E), '파업');
  assert.equal(dropSameDay('11/18~20 파업', D, E), '파업');
  assert.equal(dropSameDay('11.18(수)~11.20(금) 파업', D, E), '파업');
  assert.equal(dropSameDay('11.18 파업 시작', D, E), '11.18 파업 시작');
  assert.equal(dropSameDay('11.18~11.21 파업', D, E), '11.18~11.21 파업');
});

test('두 번 떼어도 같고, 날짜 없음 기록은 그대로', () => {
  const once = dropSameDay('11/18 11.18. 집회', D);
  assert.equal(once, '집회');
  assert.equal(dropSameDay(once, D), once);
  assert.equal(dropLineDay('11/18 집회', {day: D, none: true}), '11/18 집회');
  assert.equal(dropLineDay('11/18 집회', {day: D}), '집회');
});

// 조직 기록 행(합성). occurred_at 서울 정오.
const rec = (id, text, day = D, extra = {}) => RW.recordItem({id, organization_id: 'o1', occurred_at: `${day}T12:00:00+09:00`, raw_text: text, created_at: `${day}T12:00:00+09:00`, ...extra});

test('조직보고·투쟁 사업장 칸: 화면 줄 글과 한글 파일 줄이 같은 날짜를 한 번만 보인다', () => {
  const week = '2026-11-16';
  const records = [rec('a', '11/18 사측 교섭 결렬'), rec('b', '11.17. 선전전 진행'), rec('c', '현장 순회(11.18) 뒤 정리')];
  for (const cell of [RW.orgCell({org: 'o1', week, records}), RW.siteCell({org: 'o1', week, records})]) {
    const a = cell.shown.find(l => l.key === 'a'), b = cell.shown.find(l => l.key === 'b'), c = cell.shown.find(l => l.key === 'c');
    assert.equal(a.text, '사측 교섭 결렬'); // 화면
    assert.equal(RW.lineText(a), '- 11.18. 사측 교섭 결렬'); // 복사·한글 파일
    assert.equal(b.text, '11.17. 선전전 진행'); // 다른 날(11/18 줄의 글이 아님 — 그 줄 날짜는 11.18.)
    assert.equal(RW.lineText(b), '- 11.18. 11.17. 선전전 진행');
    assert.equal(RW.lineText(c), '- 11.18. 현장 순회(11.18) 뒤 정리');
    assert.equal(a.full, '11/18 사측 교섭 결렬'); // 원문은 그대로
  }
  // 보고용 글에 사람이 날짜를 적어도 같은 규칙
  const marks = [{week_start: week, section: 'org', ref_kind: 'org_update', ref_key: 'a', report_body: '11.18.(수) 교섭 결렬, 다음 교섭 미정', choice: null}];
  const l = RW.orgCell({org: 'o1', week, records, marks}).shown.find(x => x.key === 'a');
  assert.equal(l.text, '교섭 결렬, 다음 교섭 미정');
  assert.equal(l.report, '11.18.(수) 교섭 결렬, 다음 교섭 미정');
  assert.equal(RW.lineText(l), '- 11.18. 교섭 결렬, 다음 교섭 미정');
  // 날짜 '없음' 기록은 줄에 날짜가 없으므로 글 그대로
  const none = rec('n', '11/18 메모', D, {day_none: true});
  assert.equal(RW.lineText(RW.lineOf(none, null)), '- 11/18 메모');
});

test('확정 사진 줄도 같은 규칙(사진 원본 글은 그대로)', () => {
  const snapshot = {confirmed_at: '2026-11-19T00:00:00Z', rows: [RW.snapshotRow({section: 'site', org: 'o1', label: '가', lines: [{kind: 'org_update', key: 'a', day: D, text: '11/18 사측 교섭 결렬'}]})]};
  assert.equal(snapshot.rows[0].lines[0].text, '11/18 사측 교섭 결렬');
  const cell = RW.snapshotCell(snapshot, 'o1', 'site');
  assert.equal(cell.lines[0].text, '사측 교섭 결렬');
  assert.equal(cell.lines[0].report, null);
  assert.equal(RW.lineText(cell.lines[0]), '- 11.18. 사측 교섭 결렬');
});

test('사업 기록·사업 보고·옛 주별 조직보고 줄', () => {
  const it = NM.bizRecordItem({id: 'r1', space_id: 's1', day: D, body: '11/18 공청회 개최'});
  assert.equal(it.text, '공청회 개최');
  assert.equal(it.full, '11/18 공청회 개최');
  assert.equal(NM.recordLine(it), '- 11.18. 공청회 개최');
  const line = BD.lineOf({kind: 'biz_record', key: 'r1', day: D, end_day: null, text: '11월 18일 공청회 개최'}, null);
  assert.equal(line.text, '공청회 개최');
  assert.equal(BD.lineText(line), '- 11.18. 공청회 개최');
  assert.equal(oldLineText({day: D, end_day: null, body: '[11.18] 집회 참석'}), '- 11.18. 집회 참석');
  assert.equal(oldLineText({day: D, end_day: null, body: '11.17 집회 참석'}), '- 11.18. 11.17 집회 참석');
});

test('주요 일정 줄·내 양식 초안·AI 재료', () => {
  assert.equal(splitScheduleFields({day: D, time: '', title: '11/18 총력 결의대회', place: ''}).title, '총력 결의대회');
  assert.deepEqual(splitScheduleFields({day: D, time: '', title: '11/18 10:30 / 결의대회 / 광장', place: ''}), {day: D, time: '10:30', title: '결의대회', place: '광장'});
  assert.equal(splitScheduleFields({time: '', title: '11/18 결의대회', place: ''}).title, '11/18 결의대회'); // 날짜 칸이 없으면 그대로
  const f = hqFields({id: 'h1', day: D, time: '13:00', title: '11.18.(수) 파업 집회', place: '본사 앞'});
  assert.equal(hqLine(f).replace(/\(.\)/, '(_)'), '- 11.18.(_) 13:00 / 파업 집회 / 본사 앞');
  const draft = ownDraft({sections: [{id: 'x', title: '조직', level: 1, columns: [], fill: 'org'}]}, {orgs: {sections: [{name: '가', items: [{day: D, text: '11/18 교섭 결렬'}]}]}});
  assert.equal(draft.sections[0].lines[0].text, '- 11/18 교섭 결렬'); // 날짜는 한 번만
  assert.equal(materialLine({day: D, text: '11.18. 교섭 결렬'}, '2026-11-20', d => `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}.`), '11.18. [끝남] 교섭 결렬');
});

test('1. 1) 요청사항 줄(일 칸 + 내용 칸)', async () => {
  const {whatCell, requestLine} = await import('../app/weekly-exec-requests.js');
  assert.equal(whatCell({day: D, time: '14:00', what: '11/18 대표자 면담', place: '본부'}), '14:00 / 대표자 면담 / 본부');
  assert.equal(whatCell({day: D, what: '11/19 대표자 면담'}), '11/19 대표자 면담');
  assert.match(requestLine({day: D, what: '11.18.(수) 대표자 면담'}), /^- 11\.18\.\(.\) 대표자 면담$/);
});
