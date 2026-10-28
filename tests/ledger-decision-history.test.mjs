// FEAT-1029묶음 ⑥ 결정 변경 이력: '대체됨' 사슬 정리(순수)와 화면 규칙(정적). 가짜 내용만.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {historyLines, historyLabel, historyDay, historyPath, topicDecisionArgs, HISTORY_STEPS, HISTORY_MAX} from '../app/ledger-browse-model.mjs';

const now = new Date('2026-10-29T03:00:00Z');
const cur = {id:'c', ledger_id:'D-3', kind:'decision', title:'회의비 기준 1인 1만 5천 원', date_start:'2026-10-12', created_at:'2026-10-12T01:00:00Z', validity:'current'};
const b = {id:'b', ledger_id:'D-2', kind:'decision', title:'회의비 기준 1인 1만 원', date_start:'2026-09-03', created_at:'2026-09-03T01:00:00Z', validity:'superseded', superseded_by:'c', supersede_reason:'물가 반영'};
const a = {id:'a', ledger_id:'D-1', kind:'decision', title:'회의비 기준 1인 8천 원', date_start:null, created_at:'2026-07-14T16:30:00Z', validity:'superseded', superseded_by:'b', supersede_reason:'간담회 늘어 기준 다시 정함'};

test('사슬: 오래된 것 → 지금, 사유는 그 줄이 앞 기록을 대체한 까닭, 날짜 없으면 만든 날(서울)', () => {
  const lines = historyLines(cur, [b, a], now);
  assert.deepEqual(lines.map(l => [l.day, l.title, l.reason, l.now]), [
    ['7.15', '회의비 기준 1인 8천 원', '', false],
    ['9.03', '회의비 기준 1인 1만 원', '간담회 늘어 기준 다시 정함', false],
    ['10.12', '회의비 기준 1인 1만 5천 원', '물가 반영', true],
  ]);
  assert.deepEqual(historyLines(cur, [], now), [], '이전 기록이 없으면 줄 없음');
  assert.deepEqual(historyLines(cur, [cur, b, b], now).map(l => l.id), ['b', 'c'], '겹친 행·자기 자신은 한 번');
});
test('갈래: 한 기록을 대체한 옛 기록이 둘이면 날짜순 한 줄로 펴고 사유를 합친다', () => {
  const x = {...b, id:'x', title:'다른 갈래', date_start:'2026-08-01', supersede_reason:'합쳐서 다시 정함'};
  const lines = historyLines(cur, [b, x], now);
  assert.deepEqual(lines.map(l => l.id), ['x', 'b', 'c']);
  assert.equal(lines.at(-1).reason, '물가 반영 · 합쳐서 다시 정함');
});
test('이름: 결정은 이전 결정, 약속·일어난 일 등은 이전 기록(6-①)', () => {
  assert.equal(historyLabel('decision', 2), '이전 결정 2');
  assert.equal(historyLabel('commitment', 1), '이전 기록 1');
  assert.equal(historyLabel('event', 3), '이전 기록 3');
  assert.equal(historyDay('2025-09-03', now), '25.9.03');
});
test('읽기 경로: 대체됨만 거꾸로, 한 번에 30건, 최대 10단계 / 같은 주제 수는 이야기 화면과 같은 조건의 결정만', () => {
  const path = historyPath('w-1', ['c', 'd']);
  assert.match(path, /^\/rest\/v1\/app_ledger_records\?workspace_id=eq\.w-1&validity=eq\.superseded&superseded_by=in\.\(c,d\)&select=/);
  assert.match(path, /limit=30$/);
  assert.equal(HISTORY_STEPS, 10); assert.equal(HISTORY_MAX, 30);
  assert.deepEqual(topicDecisionArgs('t1'), {p_query:'', p_kinds:['decision'], p_organization_id:null, p_topic_id:'t1', p_date_from:null, p_date_to:null, p_scope:null, p_include_inactive:false, p_limit:200});
});
test('화면: 상세 맨 아래 접힌 <details>, 같은 주제는 섞지 않고 따로 한 줄(6-②), 쓰기·기기 저장 없음', () => {
  const src = readFileSync(new URL('../app/ledger-browse.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('function historyHtml('), src.indexOf('// 상세 ⋯ 메뉴'));
  assert.match(fn, /<details class="lb-history" data-lb-history/);
  assert.match(fn, /data-lb-action="story" data-lb-type="topic"/);
  assert.match(fn, /같은 주제 결정 \$\{d\.topicCount\}건 ›/);
  assert.match(src, /\$\{links\}\$\{historyHtml\(d\)\}`;/, '상세 맨 아래');
  const hist = src.slice(src.indexOf('async function readHistory('), src.indexOf('// 근거가 Web2 기록이면'));
  assert.doesNotMatch(hist, /method: 'PATCH'|method: 'DELETE'|app_apply_ledger_fix/);
  assert.doesNotMatch(src, /localStorage|sessionStorage/);
});
