// OPS-가입자현황(S62-29)·S68-58(사용자 11/23 15:53): 운영자 '가입자 현황' — 숫자 한 줄(전체·이번 주 새로·최근 7일 쓴 사람)과 칸 셋.
// 원칙: 내가 기록한 내용은 운영자가 볼 수 없다 — 운영자에게는 이메일·가입일·마지막 사용 시각만. 화면이 그리는 칸은 이 셋뿐, 서버 함수 하나만 읽는다. 모두 가상 자료.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {COLUMNS, weekStart, summarize, summaryText, cells, dayText, timeText} from '../app/signups-model.mjs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('칸: 이메일·가입일·마지막 사용 셋뿐 — 조직·부서·이름·직책·기록 내용은 서버가 보내도 그리지 않음', () => {
  assert.deepEqual(COLUMNS.map(c => c[1]), ['이메일', '가입일', '마지막 사용']);
  assert.deepEqual(COLUMNS.map(c => c[0]), ['email', 'signed_up_at', 'last_seen_at']);
  const c = cells({union_name: ' 가상 노조 ', department_name: '가상 부서', name: '가상 이름', job_title: '가상\n직책', email: ' a@example.test ',
    signed_up_at: '2026-11-15T11:20:00Z', last_seen_at: null, note: '가상 기록 내용', workspace_id: 'x'});
  assert.deepEqual(c, {email: 'a@example.test', signed_up_at: '26.11.15', last_seen_at: ''});
  assert.doesNotMatch(read('app/signups-model.mjs').replace(/^\/\/.*$/gm, ''), /union_name|department_name|job_title|'name'/);
});

test('이번 주 = 한국 시각 월요일 0시부터(일요일 밤·월요일 새벽 경계)', () => {
  // 2026-11-15(일) 23:00 KST → 그 주 월요일 11/9 0시 KST = 11/8 15:00Z
  assert.equal(new Date(weekStart(Date.parse('2026-11-15T14:00:00Z'))).toISOString(), '2026-11-08T15:00:00.000Z');
  // 2026-11-16(월) 00:30 KST → 11/16 0시 KST = 11/15 15:00Z
  assert.equal(new Date(weekStart(Date.parse('2026-11-15T15:30:00Z'))).toISOString(), '2026-11-15T15:00:00.000Z');
});

test('숫자 한 줄: 전체 · 이번 주 새로 · 최근 7일 쓴 사람(마지막 사용 없음·날짜 깨짐은 안 셈)', () => {
  const now = Date.parse('2026-11-15T14:00:00Z');
  const items = [
    {signed_up_at: '2026-11-15T11:20:00Z', last_seen_at: '2026-11-15T11:21:00Z'},
    {signed_up_at: '2026-11-08T15:00:00Z', last_seen_at: '2026-11-08T13:59:59Z'},
    {signed_up_at: '2026-10-01T00:00:00Z', last_seen_at: '2026-11-08T14:00:00Z'},
    {signed_up_at: '2026-11-08T14:59:59Z', last_seen_at: null},
    {signed_up_at: 'x', last_seen_at: 'y'}
  ];
  const s = summarize(items, now);
  assert.deepEqual(s, {total: 5, newThisWeek: 2, active7d: 2});
  assert.equal(summaryText(s), '전체 5명 · 이번 주 새로 2명 · 최근 7일 쓴 사람 2명');
  assert.deepEqual(summarize(null, now), {total: 0, newThisWeek: 0, active7d: 0});
});

test('날짜 글자: 한국 시각, 가입일은 날짜만, 마지막 사용은 시각까지', () => {
  assert.equal(dayText('2026-10-31T16:00:00Z'), '26.11.1');
  assert.equal(timeText('2026-11-15T11:20:00Z'), '26.11.15 20:20');
  assert.equal(timeText(null), '');
});

test('화면: 서버 함수 하나만 읽고, 막기 버튼 없음, 칸은 COLUMNS로만 그림, 메뉴·제목은 가입자 현황', () => {
  const view = read('app/signups-view.js'), code = view.replace(/^\/\/.*$/gm, '');
  assert.deepEqual([...view.matchAll(/\/rest\/v1\/[^'"`]+/g)].map(m => m[0]), ['/rest/v1/rpc/app_signup_list']);
  assert.doesNotMatch(code, /app_workspace_signup_allow|blocked|가입 막기/); // 기기 저장 금지는 CI audit가 본다
  assert.match(view, /for\(const \[key,label\] of COLUMNS\)/);
  assert.match(view, /aria-label="가입자 현황"/);
  const top = read('app/topbar-actions.js');
  assert.match(top, /signups:'가입자 현황'/);
  assert.doesNotMatch(top, /signups:'가입자'/);
});
