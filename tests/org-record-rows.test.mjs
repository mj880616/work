// ORG-기록하나로 O-5: 조직 상세 '날짜 | 기록' 한 표의 순수 규칙(app/org-record-rows.mjs)과 옛 [현황 표] 소탭이 지워졌는지.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {seoulDay, dayCell, splitRecent, hasSource, sourceLabel, RECENT} from '../app/org-record-rows.mjs';
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('서울 날짜: 밤 11시(UTC 15시 이후)는 다음 날', () => {
  assert.equal(seoulDay('2026-11-01T15:30:00Z'), '2026-11-02');
  assert.equal(seoulDay('2026-11-01T14:59:00Z'), '2026-11-01');
  assert.equal(seoulDay(null), '');
  assert.equal(seoulDay('x'), '');
});

test('날짜 칸: 올해는 M.D., 다른 해는 YY.M.D., 기간 기록은 시작~끝', () => {
  const today = '2026-11-09';
  assert.equal(dayCell({occurred_at: '2026-10-05T03:00:00Z'}, today), '10.5.');
  assert.equal(dayCell({occurred_at: '2025-12-31T03:00:00Z'}, today), '25.12.31.');
  assert.equal(dayCell({occurred_at: '2026-11-02T03:00:00Z', end_day: '2026-12-05'}, today), '11.2.~12.5.');
  assert.equal(dayCell({occurred_at: '2026-11-02T03:00:00Z', end_day: '2026-11-02'}, today), '11.2.', '끝 날이 같으면 하루');
  assert.equal(dayCell({occurred_at: '2026-11-02T03:00:00Z', end_day: '2026-11-01'}, today), '11.2.', '끝 날이 앞이면 무시');
  assert.equal(dayCell({occurred_at: '2026-12-30T03:00:00Z', end_day: '2027-01-03'}, today), '12.30.~27.1.3.');
  assert.equal(dayCell({}, today), '');
});

test('최근 10줄 + 그 앞은 접음, 순서 그대로', () => {
  assert.equal(RECENT, 10);
  const rows = Array.from({length: 13}, (_, i) => ({id: 'r' + i}));
  const {shown, older} = splitRecent(rows);
  assert.deepEqual(shown.map(r => r.id), rows.slice(0, 10).map(r => r.id));
  assert.deepEqual(older.map(r => r.id), ['r10', 'r11', 'r12']);
  assert.deepEqual(splitRecent(rows.slice(0, 3)).older, []);
  assert.deepEqual(splitRecent(null), {shown: [], older: []});
});

test('원래 글 보기: 통화·텔레그램·소식·업데이트에서 온 기록만(옮긴 옛 줄·직접 쓴 줄은 없음)', () => {
  assert.equal(sourceLabel({source_kind: 'feed', source_id: 'a'}), '원래 통화·글 보기');
  assert.equal(sourceLabel({source_kind: 'memorable', source_id: 'a'}), '원래 소식 보기');
  assert.equal(sourceLabel({source_kind: 'update', source_id: 'a'}), '원래 업데이트 보기');
  for (const r of [{source_kind: 'user'}, {source_kind: 'status_row', source_id: 'a'}, {source_kind: 'weekly_line', source_id: 'a'}, {source_kind: 'feed', source_id: null}, {}, null, {source_kind: 'toString', source_id: 'a'}])
    assert.equal(hasSource(r), false, JSON.stringify(r));
});

test('옛 [현황 표] 소탭·표 쓰기 길이 남아 있지 않다(삭제한 화면 경로 참조 0)', () => {
  const wd = read('app/workplace-detail.js');
  assert.doesNotMatch(wd, /wdSubTabs|wdStatusTable|data-wd-sub|paintStatusTable|org_tab|현황 표/);
  const st = read('app/org-status-table.js');
  assert.doesNotMatch(st, /export (async )?function (paintStatusTable|clearStatusTable|editFormHtml|patchStatusRow|deleteStatusRow|createStatusRow)/);
  assert.doesNotMatch(st, /method: '(POST|PATCH|DELETE)'|suggestOrgWeek/);
  assert.match(st, /export async function readStatusRows/);
  for (const f of ['app/workplace-detail.css', 'app/ui-standard.css']) assert.doesNotMatch(read(f), /\.wd-subtabs|\.wd-st-(table|day|form|older|ev|tag|bar|edit|actions)\b/, f);
  assert.equal(existsSync(new URL('../tests/app-e2e/org-status-table.spec.mjs', import.meta.url)), false);
  // 기록 읽기에 날짜 칸·원래 줄 열이 들어 있다.
  assert.equal(wd.match(/select=id,occurred_at,end_day,raw_text,detail_text,doc,source_kind,source_id&order=occurred_at\.desc,id\.desc/g)?.length, 2);
});
