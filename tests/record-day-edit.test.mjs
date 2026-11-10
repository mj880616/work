// ORG-기록날짜고치기(요청함 11/10, 시안 docs/design/mockups/org-record-day-edit.html): 조직 기록 날짜 수정 규칙 — [하루|기간|없음].
// 이름·글은 모두 가짜.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as M from '../app/record-window-model.mjs';
import {dayCell} from '../app/org-record-rows.mjs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ORG = 'aaaaaaaa-0000-4000-8000-000000000001';
const row = (x = {}) => ({id: 'u1', organization_id: ORG, raw_text: '합성 3차 간담회', occurred_at: '2026-11-10T15:30:00+09:00', created_at: '2026-11-10T06:31:00Z', ...x});

test('날짜 칸 처음 값: 하루·기간·없음', () => {
  assert.deepEqual(M.dayDraft(M.recordItem(row())), {mode: 'day', day: '2026-11-10', end_day: ''});
  assert.deepEqual(M.dayDraft(M.recordItem(row({end_day: '2026-11-12'}))), {mode: 'range', day: '2026-11-10', end_day: '2026-11-12'});
  assert.equal(M.dayDraft(M.recordItem(row({day_none: true}))).mode, 'none');
});

test('하루로 바꾸면 서울 시각은 그대로 날짜만(11.10 → 11.11), 끝나는 날 없음', () => {
  const it = M.recordItem(row());
  const v = M.checkDayEdit(it, {mode: 'day', day: '2026-11-11'});
  assert.deepEqual(v, {ok: true, value: {occurred_at: '2026-11-11T15:30:00+09:00', end_day: null, day_none: false}});
  // 같은 날 그대로면 바꿀 것 없음
  assert.deepEqual(M.checkDayEdit(it, {mode: 'day', day: '2026-11-10'}), {ok: true, value: null});
  assert.deepEqual(M.checkDayEdit(it, {mode: 'day', day: ''}), {ok: false, field: 'day'});
});

test('기간: 시작일 ~ 끝나는 날(같은 날이면 하루), 끝이 앞서면 거절', () => {
  const it = M.recordItem(row());
  assert.deepEqual(M.checkDayEdit(it, {mode: 'range', day: '2026-11-01', end_day: '2026-11-03'}).value, {occurred_at: '2026-11-01T15:30:00+09:00', end_day: '2026-11-03', day_none: false});
  assert.equal(M.checkDayEdit(it, {mode: 'range', day: '2026-11-03', end_day: '2026-11-03'}).value.end_day, null);
  assert.deepEqual(M.checkDayEdit(it, {mode: 'range', day: '2026-11-03', end_day: '2026-11-01'}), {ok: false, field: 'end_day'});
  assert.deepEqual(M.checkDayEdit(it, {mode: 'range', day: '2026-11-03', end_day: ''}), {ok: false, field: 'end_day'});
});

test('없음: 쓴 날(created_at 서울 날짜)에 두고 day_none, 줄에는 "-"만', () => {
  const it = M.recordItem(row({occurred_at: '2026-11-20T12:00:00+09:00'}));
  const v = M.checkDayEdit(it, {mode: 'none'});
  assert.deepEqual(v.value, {occurred_at: '2026-11-10T12:00:00+09:00', end_day: null, day_none: true});
  const none = M.recordItem(row({day_none: true, end_day: null}));
  assert.equal(none.none, true);
  assert.equal(M.lineDay(none), '');
  assert.equal(M.lineText(none), '- 합성 3차 간담회');
  assert.equal(dayCell({...row(), day_none: true}), '-');
  // 이미 없음이면 바꿀 것 없음
  assert.deepEqual(M.checkDayEdit(none, {mode: 'none'}), {ok: true, value: null});
  // 없음 → 하루로 되돌리기
  assert.equal(M.checkDayEdit(none, {mode: 'day', day: '2026-11-10'}).value.day_none, false);
  // 확정 사진에는 날짜 없이
  assert.equal(M.snapshotRow({org: ORG, lines: [none]}).lines[0].day, null);
});

test('서버에 day_none 칸이 아직 없으면(DB 적용 전) 없음은 거절, day_none은 보내지 않음', () => {
  const it = M.recordItem(row());
  assert.deepEqual(M.checkDayEdit(it, {mode: 'none'}, {noneOn: false}), {ok: false, field: 'mode'});
  assert.deepEqual(M.checkDayEdit(it, {mode: 'day', day: '2026-11-11'}, {noneOn: false}).value, {occurred_at: '2026-11-11T15:30:00+09:00', end_day: null});
});

test('날짜를 바꿔도 보고용 표시는 줄 열쇠(기록 id)에 붙어 그대로, 창 밖으로 가면 그 주에서 빠짐', () => {
  const W = '2026-11-09';
  const marks = [{id: 'm', week_start: W, section: 'org', ref_kind: 'org_update', ref_key: 'u1', report_body: '합성 보고용 글', choice: null, detail: null}];
  const moved = M.recordItem(row({occurred_at: '2026-11-11T15:30:00+09:00'}));
  const line = M.orgCell({org: ORG, week: W, records: [moved], marks}).shown[0];
  assert.equal(line.day, '2026-11-11');
  assert.equal(line.text, '합성 보고용 글');
  const far = M.recordItem(row({occurred_at: '2026-12-20T15:30:00+09:00'}));
  assert.equal(M.orgCell({org: ORG, week: W, records: [far], marks}).shown.length, 0);
});

test('화면 연결: 표 줄 ⋯·날짜 누름, 조직 상세 ⋯ [날짜 수정], 같은 칸 모양 하나', () => {
  const view = read('app/record-window-view.js'), wd = read('app/workplace-detail.js'), de = read('app/record-day-edit.js');
  assert.match(view, /text: '날짜 수정', data: \{rwDay: l\.id\}/);
  assert.match(view, /data-rw-day="/);
  assert.match(view, /DE\.dayFormHtml\(/);
  assert.match(wd, /\['day','날짜 수정'\]/);
  assert.match(wd, /openDayEditor\(/);
  assert.match(de, /export function dayFormHtml/);
  // 쓰기는 그 조직의 그 기록 한 행(owner RLS 길)만, 글(raw_text)은 보내지 않는다
  assert.match(de, /app_suborganization_updates\?id=eq\.\$\{enc\(id\)\}&organization_id=eq\.\$\{enc\(org\)\}/);
  assert.doesNotMatch(read('app/record-window-model.mjs').match(/export function checkDayEdit[\s\S]*?\n}\n/)[0], /raw_text/);
});
