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

// ORG-뺀줄지난줄메뉴(요청함 11/10 23:51): 뺀 줄·지난 기록 줄은 큰 단추 대신 줄 ⋯, 모든 조직 기록 줄 ⋯에 [기록 삭제] — 조직 창과 같은 서버 길 하나.
test('조직 한 줄 삭제 서버 길 하나: 조직 창 wdDelRow와 조직보고 창 [기록 삭제]가 org-row-delete.js를 같이 쓴다', async () => {
  const {orgRowDeletePath, deleteOrgRow, deleteOrgUpdate} = await import('../app/org-row-delete.js');
  assert.equal(orgRowDeletePath('app_suborganization_updates', 'u 1', ORG), `/rest/v1/app_suborganization_updates?id=eq.u%201&organization_id=eq.${ORG}&select=id`);
  const calls = [];
  const ok = async (p, o) => { calls.push([p, o]); return [{id: 'u1'}]; };
  await deleteOrgUpdate(ok, 'u1', ORG);
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /app_suborganization_updates\?id=eq\.u1&organization_id=eq\./);
  assert.deepEqual(calls[0][1], {method: 'DELETE', prefer: 'return=representation'});
  for (const empty of [[], null, undefined, {}]) await assert.rejects(() => deleteOrgRow(async () => empty, 'app_suborganization_status_items', 'm1', ORG), /권한이 없거나 이미 없는 항목입니다/);
  const wd = read('app/workplace-detail.js'), view = read('app/record-window-view.js');
  assert.match(wd, /import \{deleteOrgRow\} from '\.\/org-row-delete\.js'/);
  assert.match(wd, /await deleteOrgRow\(wdApi,table,id,orgId\)/);
  assert.doesNotMatch(wd, /method:'DELETE',prefer:'return=representation'\}\);if\(!Array\.isArray\(rows\)/, '조직 창이 따로 DELETE 길을 갖지 않음');
  assert.match(view, /import \{deleteOrgUpdate\} from '\.\/org-row-delete\.js'/);
  assert.match(view, /deleteOrgUpdate\(\(path, opts\) => ctl\.rt\.api\(path, opts\), l\.key, org\)/);
  assert.doesNotMatch(view, /\$\{UPD\}\?id=eq/, '조직보고 창이 조직 기록 삭제 주소를 따로 만들지 않음');
});
test('뺀 줄·지난 기록 줄 = 줄 ⋯ 맨 위 [되돌리기]/[넣기](큰 단추 없음), 모든 조직 기록 줄 ⋯ 맨 아래 [기록 삭제], 일정 줄은 삭제 없이 [일정 열기]', () => {
  const view = read('app/record-window-view.js'), biz = read('app/biz-detail-window.js');
  assert.doesNotMatch(view, /<button[^>]*data-rw-(in|back)=/, '조직보고 창에 큰 [넣기]·[되돌리기] 단추가 없음');
  assert.doesNotMatch(biz, /<button[^>]*data-bd-back=/, '사업 보고 상세 창에 큰 [되돌리기] 단추가 없음');
  assert.match(view, /where === 'folded'\) items\.push\(\{text: '넣기', data: \{rwIn: l\.id\}/);
  assert.match(view, /where === 'out'\) items\.push\(\{text: '되돌리기', data: \{rwBack: l\.id\}/);
  assert.match(biz, /where === 'out'\) items\.push\(\{text: '되돌리기', data: \{bdBack: l\.id\}/);
  assert.match(view, /if \(l\.kind === 'org_update'\) items\.push\(\{text: '기록 삭제', data: \{rwDel: l\.id\}, danger: true/);
  // [기록 삭제]는 일정 줄 가지(else 앞)에 없고, 일정 줄 가지에는 [일정 열기]가 있다
  const ev = view.match(/if \(l\.kind === 'event'\) \{[^\n]*\}/)[0];
  assert.match(ev, /일정 열기/);
  assert.doesNotMatch(ev, /기록 삭제/);
  // 한 번 묻고(askConfirm) 나서만 지운다
  assert.match(view, /const yes = await askConfirm\(anchor, \{text: TEXT\.delAsk, ok: '삭제', danger: true\}\);/);
  assert.match(view, /if \(!yes \|\| week !== ctl\.week/);
});

// ORG-빠진일2차 3번(S59-3, 명진 결정 11/11 '가'): 사업 보고 상세 창 줄 ⋯ — 사업 기록 줄만 [삭제], 사업 보고 줄은 [보고 열기]만.
test('사업 보고 상세 창: 사업 기록 줄 ⋯ 맨 아래에만 [삭제](한 번 묻기), 사업 보고 줄은 [보고 열기]·삭제 없음, 서버 길은 기존 owner RLS DELETE 한 곳', () => {
  const biz = read('app/biz-detail-window.js'), data = read('app/business-now-data.js');
  // 메뉴: 사업 보고 줄은 [보고 열기], 사업 기록 줄은 [기록 열기] + [삭제]. [삭제]는 사업 기록 가지에만 있다.
  assert.match(biz, /const openText = l\.kind === 'meeting' \? '보고 열기' : '기록 열기';/);
  assert.match(biz, /if \(l\.kind === 'biz_record'\) items\.push\(\{text: '삭제', data: \{bdDel: l\.id\}, danger: true/);
  assert.equal((biz.match(/text: '삭제'/g) || []).length, 1, '[삭제] 항목은 한 군데');
  // 삭제 길: 한 번 묻고(askConfirm) 나서만, 사업 기록 줄만, business-now-data.js 한 곳(화면이 따로 DELETE 주소를 만들지 않음).
  assert.match(biz, /import \{askConfirm\} from '\.\/small-notice\.js'/);
  assert.match(biz, /const yes = await askConfirm\(anchor, \{text: TEXT\.delAsk, ok: '삭제', danger: true\}\);/);
  assert.match(biz, /if \(l\.kind !== 'biz_record'\) return;/);
  assert.match(biz, /await ND\.deleteBusinessRecord\(l\.key, rt, wsOf\(\)\);/);
  assert.doesNotMatch(biz, /method: 'DELETE'[^\n]*app_business_records|app_business_records[^\n]*method: 'DELETE'/, '화면이 사업 기록 DELETE 주소를 따로 만들지 않음');
  assert.match(data, /export async function deleteBusinessRecord\(id, rt = window\.KPTURuntime, workspaceId = wsOf\(rt\)\)/);
  assert.match(data, /\$\{RECS\}\?id=eq\.\$\{enc\(id\)\}&workspace_id=eq\.\$\{enc\(workspaceId\)\}&select=id`, \{method: 'DELETE', prefer: 'return=representation'/);
  assert.match(data, /if \(!Array\.isArray\(rows\) \|\| !rows\.length\) throw new Error\(/, '돌려받은 줄이 있어야 성공');
  // DB는 그대로: 소유자 DELETE 권한·정책이 이미 있다(새 migration 없음).
  const sql = read('supabase/migrations/20261109110000_record_one_biz.sql');
  assert.match(sql, /grant select, delete on table public\.app_business_records to authenticated;/);
  assert.match(sql, /create policy business_records_owner_all on public\.app_business_records for all to authenticated\s+using \(private\.app_is_workspace_owner\(workspace_id\)\)/);
});
