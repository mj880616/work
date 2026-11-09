// RECORD-한줄 ①: 기록 '한 줄' 공용 규칙(app/record-oneline.mjs)과 보고 창·사업 기록 줄이 그것을 쓰는지.
import test from 'node:test';
import assert from 'node:assert/strict';
import {oneLine, recordOneLine, plainLines, ONE_LINE_MAX} from '../app/record-oneline.mjs';
import {recordItem, orgCell, sameThing, snapshotCell, lineText} from '../app/record-window-model.mjs';
import {bizRecordItem, recordLine} from '../app/business-now-model.mjs';

const MEETING = '## 쟁의대책회의 결과 요약 (10.21)\n\n### 1. 핵심 회의 결과\n- 11월 11일 1일 경고파업 추진 방향으로 의견을 모음&#x20;\n\n| 구분 | 내용 |\n|---|---|\n| 교섭 | 근속승진 |\n';
const chars = s => [...s].length;

test('짧은 기록은 그대로(날짜 같은 숫자 마침표 유지)', () => {
  assert.equal(oneLine('11.3. 사측 근속승진안 제시로 간사협의, 보도자료 11.5.로 순연'), '11.3. 사측 근속승진안 제시로 간사협의, 보도자료 11.5.로 순연');
  assert.equal(oneLine('준법투쟁\n출근 선전전'), '준법투쟁 출근 선전전');
  assert.equal(oneLine(''), '');
  assert.equal(oneLine(null), '');
});

test('마크다운·표 기호·HTML 엔티티·역슬래시·제어문자는 한 줄에 없다', () => {
  for (const t of [MEETING, '**굵게** 2026\\. 10월 [링크](https://example.com)', '| a | b |\n|---|---|', 'a\u0007b&nbsp;c', '<b>굵게</b> 글']) {
    const line = oneLine(t);
    assert.ok(line, t);
    assert.doesNotMatch(line, /[#|*`\\]|&#?\w+;|[\u0000-\u001f]|<\/?b>/, line);
  }
  assert.equal(oneLine('**굵게** 2026\\. 10월 [링크](https://example.com)'), '굵게 2026. 10월 링크');
  assert.equal(oneLine('| a | b |\n|---|---|'), 'a · b');
});

test('긴 기록은 첫 줄의 첫 문장, 60자 안 + …', () => {
  assert.equal(oneLine(MEETING), '쟁의대책회의 결과 요약 (10.21)…');
  const long = '준법투쟁·출퇴근 선전전을 이어가며 사측 부당노동행위 고발 보도자료를 냈다. 다음 주에는 집회 준비와 언론 대응을 계속하고 조합원 교육도 함께 진행하기로 했다.';
  assert.equal(oneLine(long), '준법투쟁·출퇴근 선전전을 이어가며 사측 부당노동행위 고발 보도자료를 냈다.…');
  const one = '가'.repeat(200);
  assert.equal(oneLine(one), `${'가'.repeat(ONE_LINE_MAX)}…`);
  for (const t of [MEETING, long, one]) assert.ok(chars(oneLine(t)) <= ONE_LINE_MAX + 1);
});

test('저장된 한 줄(one_line)이 있으면 그 값이 먼저', () => {
  assert.equal(recordOneLine({raw_text: MEETING, one_line: '쟁의대책회의 — 11.11. 경고파업 추진'}), '쟁의대책회의 — 11.11. 경고파업 추진');
  assert.equal(recordOneLine({raw_text: MEETING}), oneLine(MEETING));
  assert.equal(recordOneLine({body: '사업 기록'}, 'body'), '사업 기록');
  assert.deepEqual(plainLines('# 제목\n\n본문'), ['제목', '본문']);
});

test('조직보고 창 줄은 한 줄, 원문은 full에 그대로(바꾸지 않음)', () => {
  const row = {id: 'u1', organization_id: 'o1', raw_text: MEETING, occurred_at: '2026-11-10T12:00:00+09:00', created_at: '2026-11-10T03:00:00Z'};
  const item = recordItem(row);
  assert.equal(item.text, oneLine(MEETING));
  assert.equal(item.full, MEETING);
  const cell = orgCell({org: 'o1', week: '2026-11-09', records: [item]});
  assert.equal(cell.shown[0].text, oneLine(MEETING));
  assert.equal(cell.shown[0].full, MEETING);
  assert.equal(lineText(cell.shown[0]), `- 11.10. ${oneLine(MEETING)}`);
  // 같은 일 찾기는 원문으로(일정 제목이 원문 뒤쪽에 있어도)
  assert.ok(sameThing({org: 'o1', day: '2026-11-10', text: '근속승진'}, item));
  // 예전에 원문 전체로 저장된 보고용 글도 표에는 한 줄
  const marks = [{id: 'm1', week_start: '2026-11-09', section: 'org', ref_kind: 'org_update', ref_key: 'u1', report_body: MEETING, choice: null, detail: null}];
  const edited = orgCell({org: 'o1', week: '2026-11-09', records: [item], marks}).shown[0];
  assert.equal(edited.text, oneLine(MEETING));
  assert.equal(edited.edited, true);
});

test('확정 사진 줄도 표에는 한 줄', () => {
  const cell = snapshotCell({rows: [{section: 'org', ref_key: 'o1', lines: [{ref_kind: 'org_update', ref_key: 'u1', day: '2026-11-10', text: MEETING}]}]}, 'o1');
  assert.equal(cell.lines[0].text, oneLine(MEETING));
  assert.equal(cell.lines[0].full, MEETING);
});

test('사업 기록 줄도 한 줄, 원문은 full', () => {
  const body = `${'가'.repeat(120)}`;
  const it = bizRecordItem({id: 'b1', space_id: 's1', day: '2026-11-10', body});
  assert.equal(it.text, oneLine(body));
  assert.equal(it.full, body);
  assert.equal(recordLine(it), `- 11.10. ${oneLine(body)}`);
});
