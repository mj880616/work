import {test} from 'node:test';
import assert from 'node:assert/strict';
// APP-낭비줄이기 ①: 사업 보고·자료실 목록은 본문 열(회의록 전문·결정·특이사항·자료 글자)을 받지 않는다.
import {readMeetings, readDocuments, readMeetingBody, MEETING_LIST_FIELDS, DOCUMENT_LIST_FIELDS} from '../app/report-list-read.js';

const HEAVY = ['transcript_text', 'decisions', 'notes', 'extracted_text', 'extraction_error'];
const cols = list => list.split(',');

test('목록 열에는 본문 열이 없다', () => {
  for (const key of HEAVY) {
    assert.ok(!cols(MEETING_LIST_FIELDS).includes(key), key);
    assert.ok(!cols(DOCUMENT_LIST_FIELDS).includes(key), key);
  }
  for (const key of ['id', 'series_name', 'meeting_at', 'activity_kind', 'project_id', 'next_plan', 'business_area_id']) assert.ok(cols(MEETING_LIST_FIELDS).includes(key), key);
  for (const key of ['id', 'title', 'file_name', 'meeting_id', 'document_date', 'mime_type', 'file_id', 'category', 'tags']) assert.ok(cols(DOCUMENT_LIST_FIELDS).includes(key), key);
});

test('자료 목록은 열 목록으로 한 번 읽는다', async () => {
  const calls = [];
  const rows = await readDocuments(async path => { calls.push(path); return [{id: 'd'}]; }, 'w1');
  assert.deepEqual(rows, [{id: 'd'}]);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /app_documents\?workspace_id=eq\.w1&select=id,/);
  assert.doesNotMatch(calls[0], /select=\*/);
});

test('열이 서버에 없어 거절되면 select=*로 한 번 더 읽는다', async () => {
  const calls = [];
  const api = async path => { calls.push(path); if (!path.includes('select=*')) throw Object.assign(new Error('column app_meetings.next_plan does not exist'), {status: 400}); return [{id: 'm', meeting_at: '2026-10-01T14:30:00+09:00'}]; };
  const rows = await readMeetings(api, 'w1');
  assert.equal(rows.length, 1);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /select=\*/);
});

test('다른 오류는 다시 읽지 않고 그대로 던진다', async () => {
  let n = 0;
  await assert.rejects(readDocuments(async () => { n++; throw new Error('요청 시간이 초과되었습니다.'); }, 'w1'), /초과/);
  assert.equal(n, 1);
});

test('직접 고른 시각이 없는 줄만 전문을 더 받는다', async () => {
  const calls = [];
  const api = async path => {
    calls.push(path);
    if (path.includes('select=id,transcript_text')) return [{id: 'm0', transcript_text: '일시: 2026. 10. 1. 15:00'}];
    return [
      {id: 'm0', meeting_at: '2026-10-01T00:00:00+09:00'},
      {id: 'm1', meeting_at: '2026-10-02T14:30:00+09:00'},
      {id: 'm2', meeting_at: null},
    ];
  };
  const rows = await readMeetings(api, 'w1');
  assert.equal(calls.length, 2);
  assert.match(calls[1], /id=in\.\(m0\)/);
  assert.equal(rows[0].transcript_text, '일시: 2026. 10. 1. 15:00');
  assert.equal(rows[1].transcript_text, undefined);
  assert.equal(rows[2].transcript_text, undefined);
});

test('모두 시각이 있으면 전문 요청은 없다', async () => {
  const calls = [];
  await readMeetings(async path => { calls.push(path); return [{id: 'a', meeting_at: '2026-10-02T14:30:00+09:00'}]; }, 'w1');
  assert.equal(calls.length, 1);
});

test('추천용 본문은 한 줄만 읽고 못 읽으면 빈 글', async () => {
  const calls = [];
  const body = await readMeetingBody(async path => { calls.push(path); return [{transcript_text: 't', decisions: 'd', notes: 'n'}]; }, 'w1', 'm 1');
  assert.deepEqual(body, {transcript_text: 't', decisions: 'd', notes: 'n'});
  assert.match(calls[0], /id=eq\.m%201&workspace_id=eq\.w1&select=transcript_text,decisions,notes&limit=1/);
  assert.deepEqual(await readMeetingBody(async () => { throw new Error('x'); }, 'w1', 'm'), {});
});
