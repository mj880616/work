// RECORD-한줄AI요약(11/09 명진 A안): 화면 쪽 — 긴 조직 기록만 서버 AI 한 줄을 부탁하고, 저장된 one_line이 표·조직 상세의 한 줄이 된다.
// 보고용 글(report_body)은 AI 한 줄보다 먼저다(AI가 덮지 않음). 이름·글은 모두 가짜.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {needsOneLine, oneLine, recordOneLine} from '../app/record-oneline.mjs';
import {requestRecordOneLine} from '../app/record-one-line-ai.js';
import * as M from '../app/record-window-model.mjs';
import {readOptional, colsOf} from '../app/record-day-edit.js';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ID = 'c0000000-0000-4000-8000-000000000001', ORG = 'aaaaaaaa-0000-4000-8000-000000000001';
const LONG = '[합성 공영화 투쟁 경과 공유 및 감사 인사]\n\n합성시는 공영화 연구용역을 직접 추진하기로 했습니다.\n연대해 주신 동지들께 감사드립니다.';

test('짧은 글은 부탁하지 않고, 긴 글·여러 줄만 부탁한다', async () => {
  assert.equal(needsOneLine('합성 3차 간담회'), false);
  assert.equal(needsOneLine(LONG), true);
  assert.equal(needsOneLine('가'.repeat(61)), true);
  const calls = [];
  const call = async body => { calls.push(body); return {ok: true, data: {line: '합성시 공영화 연구용역 직접 추진, 연대 감사'}}; };
  let told = 0;
  assert.equal(await requestRecordOneLine(ID, '합성 3차 간담회', {call, notify: () => told++}), null);
  assert.equal(calls.length, 0);
  assert.equal(await requestRecordOneLine(ID, LONG, {call, notify: () => told++}), '합성시 공영화 연구용역 직접 추진, 연대 감사');
  assert.deepEqual(calls, [{kind: 'record_one_line', id: ID}]); // 기록 ID만 보낸다(글은 서버가 읽음)
  assert.equal(told, 1);
  // 실패·건너뜀은 조용히(알림 없음)
  assert.equal(await requestRecordOneLine(ID, LONG, {call: async () => { throw new Error('x'); }, notify: () => told++}), null);
  assert.equal(await requestRecordOneLine(ID, LONG, {call: async () => ({ok: true, data: {skipped: 'short'}}), notify: () => told++}), null);
  assert.equal(told, 1);
});

test('표 한 줄: 보고용 글 > AI 한 줄(one_line) > 임시 한 줄', () => {
  const row = {id: 'u1', organization_id: ORG, raw_text: LONG, occurred_at: '2026-11-10T12:00:00+09:00', created_at: '2026-11-10T00:00:00Z'};
  assert.equal(M.recordItem(row).text, oneLine(LONG));
  const ai = M.recordItem({...row, one_line: '합성시 공영화 연구용역 직접 추진, 연대 감사'});
  assert.equal(ai.text, '합성시 공영화 연구용역 직접 추진, 연대 감사');
  assert.equal(ai.full, LONG); // 원문은 그대로
  const marks = [{id: 'm', week_start: '2026-11-09', section: 'org', ref_kind: 'org_update', ref_key: 'u1', report_body: '합성 보고용 글', choice: null, detail: null}];
  assert.equal(M.orgCell({org: ORG, week: '2026-11-09', records: [ai], marks}).shown[0].text, '합성 보고용 글');
  assert.equal(recordOneLine({raw_text: LONG, one_line: '  '}), oneLine(LONG));
});

test('나중에 생기는 칸(day_none·one_line): DB 적용 전이면 그 칸만 빼고 다시 읽는다', async () => {
  const seen = [], state = {};
  const load = async cols => { seen.push(cols); if (cols.includes('one_line')) throw Object.assign(new Error('column app_suborganization_updates.one_line does not exist'), {status: 400, code: '42703'}); return [{id: 1}]; };
  assert.deepEqual(await readOptional(load, 'id', state), [{id: 1}]);
  assert.deepEqual(seen, ['id,day_none,one_line', 'id,day_none']);
  assert.deepEqual(state, {day_none: true, one_line: false});
  assert.equal(colsOf('id', state), 'id,day_none');
  // 다음 읽기는 바로 아는 칸만
  seen.length = 0; await readOptional(load, 'id', state); assert.deepEqual(seen, ['id,day_none']);
  // 칸 이름이 없는 400이면 둘 다 뺌, 다른 오류는 그대로 던짐
  const s2 = {}, seen2 = [];
  await readOptional(async c => { seen2.push(c); if (c !== 'id') throw Object.assign(new Error('bad'), {status: 400}); return []; }, 'id', s2);
  assert.deepEqual(seen2, ['id,day_none,one_line', 'id']);
  await assert.rejects(readOptional(async () => { throw Object.assign(new Error('down'), {status: 503}); }, 'id', {}), /down/);
});

test('연결: 새 조직 기록 저장·원문 수정 뒤 부탁, 조직 상세 목록도 one_line, 원장 자동 기록 알림(kptu:api-saved)은 쓰지 않음', () => {
  const qs = read('app/quick-save.js'), wd = read('app/workplace-detail.js'), ai = read('app/record-one-line-ai.js');
  assert.match(qs, /requestRecordOneLine\(String\(savedId\),raw_text,\{rt\}\)/);
  assert.equal(wd.match(/requestRecordOneLine\(/g)?.length, 2);
  assert.match(wd, /wdRecordText\(x\.raw_text,x\.one_line\)/);
  assert.match(wd, /one_line:null\}/);
  assert.doesNotMatch(ai, /CustomEvent\('kptu:api-saved'|RECORD_ONE_LINE_EVENT = 'kptu:api-saved'/);
});
