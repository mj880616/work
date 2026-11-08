// BIZ-기록하나로 B-3(설계 docs/design/record-one.md 2-4·2-7·3-1): 사업요약 창 순수 규칙 — 이어 쓰기·처음 채우기·이번 주 기록 n·저장 길.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as M from '../app/business-now-model.mjs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const S1 = 'aaaaaaaa-0000-4000-8000-000000000001', S2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const row = (id, space, week, body, owner = '') => ({id, space_id: space, week_start: week, body, owner_text: owner});

test('이어 쓰기: 지난주 글이 이번 주에 보이고, 이번 주에 고치면 이번 주 행만 생긴다(지난주 행은 그대로)', () => {
  const rows = [row('r1', S1, '2026-11-09', '지난주 상황', '가 담당')];
  // 지난주 글이 이번 주·다음 주에도 이어 보인다.
  assert.deepEqual(M.nowView(rows, S1, '2026-11-16'), {body: '지난주 상황', owner: '가 담당', from: '2026-11-09', carried: true});
  assert.deepEqual(M.nowView(rows, S1, '2026-11-09'), {body: '지난주 상황', owner: '가 담당', from: '2026-11-09', carried: false});
  // 그 앞 주에는 없다.
  assert.equal(M.nowView(rows, S1, '2026-11-02').body, '');
  assert.equal(M.nowView(rows, S2, '2026-11-16').body, '');
  // 이번 주에 고치면 이번 주 새 행(담당은 앞 행에서 복사 — 행은 통째로 이김).
  const p = M.nextNow(rows, {spaceId: S1, week: '2026-11-16'}, {body: '이번 주 상황'});
  assert.deepEqual(p, {op: 'insert', row: {space_id: S1, week_start: '2026-11-16', body: '이번 주 상황', owner_text: '가 담당'}});
  const after = [...rows, {id: 'r2', ...p.row}];
  assert.equal(M.nowView(after, S1, '2026-11-09').body, '지난주 상황'); // 지난주 표는 그때 글 그대로
  assert.equal(M.nowView(after, S1, '2026-11-16').body, '이번 주 상황');
  assert.equal(M.nowView(after, S1, '2026-11-23').body, '이번 주 상황'); // 다음 주로 이어짐
  // 같은 주를 다시 고치면 그 행만 고친다(바뀐 칸만).
  assert.deepEqual(M.nextNow(after, {spaceId: S1, week: '2026-11-16'}, {owner_text: '나 담당'}), {op: 'update', id: 'r2', row: {owner_text: '나 담당'}});
  // 같은 값이면 아무것도 안 한다.
  assert.deepEqual(M.nextNow(after, {spaceId: S1, week: '2026-11-16'}, {body: '이번 주 상황'}), {op: 'none'});
  // 행이 없던 사업은 새 행(빈 지금 상황).
  assert.deepEqual(M.nextNow(rows, {spaceId: S2, week: '2026-11-16'}, {owner_text: '다'}), {op: 'insert', row: {space_id: S2, week_start: '2026-11-16', body: '', owner_text: '다'}});
  // 행이 그 주보다 나중 주에만 있으면 그 주에는 보이지 않는다.
  assert.equal(M.nowView([row('r9', S1, '2026-11-30', '먼 뒤')], S1, '2026-11-16').body, '');
});

test('글 검사: 지금 상황 1000자·줄바꿈 허용·제어문자 정리, 담당 한 줄 100자', () => {
  assert.deepEqual(M.checkNowBody('  첫 줄 \r\n\t둘째\u0007 줄\n\n'), {ok: true, value: '첫 줄\n둘째 줄'});
  assert.deepEqual(M.checkNowBody(''), {ok: true, value: ''}); // 빈 칸 = '—'
  assert.equal(M.checkNowBody('가'.repeat(1000)).ok, true);
  assert.deepEqual(M.checkNowBody('가'.repeat(1001)), {ok: false, field: 'body', max: 1000});
  assert.deepEqual(M.checkOwner(' 가\n나 '), {ok: true, value: '가 나'});
  assert.equal(M.checkOwner('가'.repeat(101)).ok, false);
});

test('처음 한 번 채우기: 지금 상황 행이 하나도 없는 사업만, 전환 주 행으로(사람이 쓴 사업은 건너뜀)', () => {
  const spaces = [{id: S1, area: '가 사업', task: '하나'}, {id: S2, area: '가 사업', task: '둘'}, {id: S2, area: '가 사업', task: '둘'}];
  const rows = [row('r1', S1, '2026-11-23', '명진이 쓴 글')]; // 다른 주라도 행이 있으면 사람이 쓴 것
  const cells = {'하나': {lines: ['- 덮으면 안 됨'], owner: 'x'}, '둘': {lines: ['- 지난주 첫 줄', '', '- 둘째 줄'], owner: ' 다 담당 '}};
  const list = M.fillRows({spaces, rows, cellOf: s => cells[s.task]});
  assert.deepEqual(list, [{space_id: S2, week_start: M.RECORD_ONE_FROM, body: '- 지난주 첫 줄\n- 둘째 줄', owner_text: '다 담당'}]);
  // 둘 다 없으면 '—'(빈 글) 행.
  assert.deepEqual(M.fillRows({spaces: [spaces[1]], rows: [], cellOf: () => null}), [{space_id: S2, week_start: M.RECORD_ONE_FROM, body: '', owner_text: ''}]);
  // 1000자를 넘으면 줄 단위로 자른다(첫 줄이 넘치면 그 줄만 자름).
  assert.equal(M.bodyFromLines(['가'.repeat(600), '나'.repeat(600)]), '가'.repeat(600));
  assert.equal([...M.bodyFromLines(['가'.repeat(1200)])].length, 1000);
  assert.equal(M.RECORD_ONE_FROM, '2026-11-09'); // 조직보고 창과 같은 전환 주
});

test('이번 주 기록 n: 그 주(월~일)에 걸친 사업 기록만, 3단 사안은 그 세부 과제 줄로', () => {
  const tree = [{project: {id: 'A'}, depth: 0}, {project: {id: 'T1'}, depth: 1}, {project: {id: 'I1'}, depth: 2}, {project: {id: 'T2'}, depth: 1}, {project: {id: 'B'}, depth: 0}];
  const map = M.rowSpaceMap(tree);
  assert.equal(map.get('I1'), 'T1');
  assert.equal(map.get('A'), 'A');
  const rec = (id, space, day, body, end = null) => M.bizRecordItem({id, space_id: space, day, end_day: end, body, source_kind: 'user'});
  const items = [rec('1', 'T1', '2026-11-16', '월요일 일'), rec('2', 'I1', '2026-11-22', '일요일 사안 일'), rec('3', 'T1', '2026-11-15', '지난주 일'),
    rec('4', 'T2', '2026-11-02', '긴 기간', '2026-11-18'), rec('5', 'T2', '2026-11-23', '다음 주 일'), rec('6', 'B', '2026-11-20', '  ')];
  assert.equal(items[5], null); // 빈 글은 버림
  const got = M.weekRecords(items.filter(Boolean), '2026-11-16', map);
  assert.deepEqual(got.get('T1').map(x => x.key), ['1', '2']);
  assert.deepEqual(got.get('T2').map(x => x.key), ['4']); // 그 주에 걸친 기간 기록
  assert.equal(M.recordLine(got.get('T2')[0]), '- 11.2.~11.18. 긴 기간');
  assert.deepEqual(M.recordReadRange('2026-11-16'), {from: '2026-08-18', to: '2026-11-22'});
});

test('사업 기록 한 줄 글: 한 줄로, 300자 넘으면 줄임(DB 검사와 같은 길이)', () => {
  assert.equal(M.recordBody(' 가\n나\t다 '), '가 나 다');
  const long = M.recordBody('가'.repeat(400));
  assert.equal([...long].length, 300);
  assert.ok(long.endsWith('…'));
  assert.equal(M.recordDay('2026-11-16'), '2026-11-16');
  assert.equal(M.recordDay('11/16'), null);
});

test('구조: 사업요약 칸은 지금 상황 표·사업 기록 표만 쓰고, 업데이트·소식 [사업]은 사업 기록으로, 기기 저장 없음', () => {
  const data = read('app/business-now-data.js'), table = read('app/weekly-summary-table.js'), upd = read('app/update-places.js'), forget = read('app/forget-list.js');
  for (const f of [data, table, read('app/business-now-model.mjs')]) for (const word of ['local', 'session'].map(k => k + 'Storage').concat(['indexed' + 'DB'])) assert.ok(!f.includes(word), word);
  // 쓰는 칸은 표가 허락한 것만(넣기 workspace_id·space_id·week_start·body·owner_text / 고치기 body·owner_text).
  assert.match(data, /const NOW = '\/rest\/v1\/app_business_now';/);
  assert.match(data, /body: \{workspace_id: workspaceId, \.\.\.p\.row\}/);
  assert.match(data, /resolution=ignore-duplicates/); // 처음 채우기는 먼저 들어간 행을 덮지 않음
  assert.doesNotMatch(data, /'progress'/); // 옮긴 줄(progress)은 SQL만
  // 전환 주 앞 주는 옛 임시저장 읽기만, 전환 주부터 지금 상황.
  assert.match(table, /const fresh=isWeek\(from,to\)&&!kit\.NM\.isOldWeek\(from\);/);
  assert.match(table, /if\(state\.now\)return saveNowEdit\(ed,field,ref\);/);
  // 업데이트 [사업]: 확정 연결이 된 뒤 같은 저장에서 사업 기록 한 줄(source_kind update, 원래 메모 id).
  assert.match(upd, /if \(!linkError\) await addBusinessRecord\(note, list, text, rt\);/);
  assert.match(upd, /source_kind:'update', source_id:note\.id/);
  // 소식 [사업]: 사업 기록 한 줄(source_kind memorable).
  assert.match(forget, /saveBusinessRecord\(\{space_id: project\.id/);
  // 주 경계·전환 주는 조직보고 창 규칙 하나(새로 계산하지 않음).
  assert.match(read('app/business-now-model.mjs'), /from '\.\/record-window-model\.mjs'/);
});
