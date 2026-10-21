import test from 'node:test';
import assert from 'node:assert/strict';
import { searchArgs, freshFilters, dateLabel, overdue, detailFields, sourceHref, linkLabel, validResult, MAX_LIMIT } from '../app/ledger-browse-model.mjs';

// AI-서버연동 S7-c: 원장 목록·검색의 순수 함수. 검색 RPC(app_ledger_search) 인자와 표시 규칙.
const ORG = '11111111-1111-4111-8111-111111111111';

test('기본 검색은 업무만, 모든 종류, 대체·폐기 빼기(L1)', () => {
  const { args } = searchArgs(freshFilters());
  assert.deepEqual(args, { p_query: '', p_kinds: null, p_organization_id: null, p_topic_id: null, p_date_from: null, p_date_to: null,
    p_scope: 'work', p_include_inactive: false, p_limit: 50 });
});

test('범위·종류·기간·조직을 RPC 인자로 바꾼다', () => {
  const { args } = searchArgs({ ...freshFilters(), q: '  가상 노선\t교섭 ', kinds: ['event', 'commitment', 'bogus'], from: '2026-09-01', to: '2026-10-01',
    organization: ORG, topic: 'not-a-uuid', scope: 'all', inactive: true }, 999);
  assert.equal(args.p_query, '가상 노선 교섭');
  assert.deepEqual(args.p_kinds, ['event', 'commitment']);
  assert.equal(args.p_scope, null);
  assert.equal(args.p_organization_id, ORG);
  assert.equal(args.p_topic_id, null);
  assert.equal(args.p_include_inactive, true);
  assert.equal(args.p_limit, MAX_LIMIT);
  assert.equal(searchArgs({ scope: 'interest' }).args.p_scope, 'interest');
  // 다섯 종류를 모두 고르면 거르지 않는 것과 같다.
  assert.equal(searchArgs({ kinds: ['event', 'change', 'decision', 'evidence', 'commitment'] }).args.p_kinds, null);
});

test('잘못된 조건은 RPC를 부르지 않는다', () => {
  assert.match(searchArgs({ q: 'ㄱ'.repeat(201) }).error, /200자/);
  assert.match(searchArgs({ from: '2026-02-30' }).error, /시작 날짜/);
  assert.match(searchArgs({ from: '2026-10-02', to: '2026-10-01' }).error, /앞입니다/);
});

test('기준일은 정밀도대로 보인다', () => {
  assert.equal(dateLabel({ date_precision: 'day', date_start: '2026-10-21' }), '2026-10-21');
  assert.equal(dateLabel({ date_precision: 'month', date_start: '2026-09-01', date_note: '2026-09' }), '2026-09');
  assert.equal(dateLabel({ date_precision: 'year', date_start: '2021-01-01' }), '2021');
  assert.equal(dateLabel({ date_precision: 'range', date_start: '2021-01-01', date_end: '2025-12-31', date_note: '2021~2025' }), '2021-01-01 ~ 2025-12-31 (2021~2025)');
  assert.equal(dateLabel({ date_precision: 'unknown', date_note: '○○ 이전' }), '○○ 이전');
  assert.equal(dateLabel({ date_precision: 'unknown' }), '날짜 모름');
});

test('기한 지난 약속은 볼 때 계산한다', () => {
  const now = new Date('2026-10-21T03:00:00Z');
  assert.equal(overdue({ kind: 'commitment', commitment_status: 'waiting', follow_up_on: '2026-10-20' }, now), true);
  assert.equal(overdue({ kind: 'commitment', commitment_status: 'waiting', follow_up_on: '2026-10-21' }, now), false);
  assert.equal(overdue({ kind: 'commitment', commitment_status: 'fulfilled', follow_up_on: '2026-10-01' }, now), false);
});

test('상세 칸은 종류별 칸만, 빈 칸은 뺀다', () => {
  const fields = detailFields({ kind: 'decision', ledger_id: 'DEC-0901', date_precision: 'unknown', scope: 'work', sensitivity: 'S1', importance: 'normal',
    validity: 'current', decision_type: 'adopted', decision_reason: '가상 이유', counterparty: null, note: '' }, { topicName: '가상 주제' });
  const map = Object.fromEntries(fields);
  assert.equal(map['결정유형'], '채택');
  assert.equal(map['업무주제'], '가상 주제');
  assert.equal(map['상대측'], undefined);
  assert.equal(map['비고'], undefined);
});

test('출처 주소는 https 또는 Drive 파일 ID만 연결로', () => {
  assert.equal(sourceHref({ location: 'https://example.org/a' }), 'https://example.org/a');
  assert.equal(sourceHref({ location: 'javascript:alert(1)' }), '');
  assert.equal(sourceHref({ location: 'http://example.org' }), '');
  assert.equal(sourceHref({ location: '공유폴더/가', drive_file_id: 'abcdefghijKLMN_-12' }), 'https://drive.google.com/file/d/abcdefghijKLMN_-12/view');
});

test('연결 표시와 결과 행 검사', () => {
  const names = { records: new Map([['r2', { ledger_id: 'EVT-0902', title: '가상 사건' }]]), organizations: new Map([['o1', { ledger_id: 'ORG-0901', name: '가 지부' }]]),
    projects: new Map(), meetings: new Map() };
  assert.deepEqual(linkLabel({ relation: 'belongs_to', target_record_id: 'r2' }, names, 'out'), { relation: '소속', kind: 'record', ledgerId: 'EVT-0902', title: '가상 사건', dir: 'out' });
  assert.equal(linkLabel({ relation: 'counterpart', target_organization_id: 'o1' }, names, 'out').title, '가 지부');
  assert.equal(linkLabel({ relation: 'related', record_id: 'r2' }, names, 'in').dir, 'in');
  assert.equal(validResult({ id: ORG, ledger_id: 'EVT-0901', kind: 'event', title: '가' }), true);
  assert.equal(validResult({ id: 'x', ledger_id: 'EVT-0901', kind: 'event', title: '가' }), false);
});
