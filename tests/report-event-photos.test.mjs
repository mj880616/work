import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { eventPhotoHead, eventPhotoNote, linkBody, linkOutcome, linkFailNotice } from '../app/report-event-photos-model.mjs';

// S59-23 CAL-일정첨부 요청 6번 '사업 보고로 넘기기'(시안 docs/design/mockups/event-attach.html ③, 설계 docs/design/event-attach.md 5절):
// 사업 보고 쓰기 창 '일정에 붙인 사진' 줄의 순수 규칙과 지키는 것(처음엔 안 고름·기기 저장 없음·서버 한 곳·올리기 없음).
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('줄 머리: 시안 ③ 그대로 \'일정에 붙인 사진 n · 넣으려면 누르기\', 고르면 \'n장 넣음\'', () => {
  assert.equal(eventPhotoHead(2), '일정에 붙인 사진 2');
  assert.equal(eventPhotoNote(0), '넣으려면 누르기');
  assert.equal(eventPhotoNote(1), '1장 넣음');
  assert.equal(eventPhotoHead(undefined), '일정에 붙인 사진 0');
});

test('서버 요청: 사업 보고·일정·파일 id와 종류·날짜만(작업공간·이름·형식은 보내지 않음 — 서버가 다시 읽어 정함)', () => {
  const pick = {drive_file_id: 'ph_1', file_name: '예시 현장.jpg', mime_type: 'image/jpeg', calendarId: 'qa-cal', eventId: 'ev-1'};
  const body = linkBody(pick, {id: 'm-1', kind: 'meeting', day: '2026-11-12'}, ['회의', '기타']);
  assert.deepEqual(body, {action: 'link-event-photo', meeting_id: 'm-1', calendar_id: 'qa-cal', event_id: 'ev-1', drive_file_id: 'ph_1', category: '회의', document_date: '2026-11-12'});
  // 사진 올리기와 같은 종류 규칙: 내 종류 목록에 없으면 '기타', 날짜가 없으면 칸을 보내지 않는다.
  assert.deepEqual(linkBody({...pick, calendarId: undefined}, {id: 'm-1', kind: 'struggle'}, ['회의', '기타']),
    {action: 'link-event-photo', meeting_id: 'm-1', calendar_id: 'primary', event_id: 'ev-1', drive_file_id: 'ph_1', category: '기타'});
  for (const key of ['workspace_id', 'file_name', 'mime_type', 'title', 'project_id']) assert.equal(key in body, false, key);
});

test('결과: 503은 넣었는지 모름(다시 보내지 않음), 그 밖의 거절은 못 넣음([다시 넣기]), 한국어가 아닌 서버 글은 정해 둔 글로', () => {
  assert.equal(linkOutcome(null), 'linked');
  assert.equal(linkOutcome({status: 503}), 'unknown');
  assert.equal(linkOutcome({status: 400}), 'failed');
  assert.equal(linkFailNotice(0, 0), null);
  assert.deepEqual(linkFailNotice(1, 0, 'Web2 일정 창에서 붙인 사진만 사업 보고로 넣을 수 있습니다.'),
    {text: '일정 사진 1장 못 넣었어요', note: 'Web2 일정 창에서 붙인 사진만 사업 보고로 넣을 수 있습니다.', retry: true});
  assert.deepEqual(linkFailNotice(2, 0, 'Unknown action'), {text: '일정 사진 2장 못 넣었어요', note: '잠시 뒤 다시 넣어 주세요.', retry: true});
  const unknown = linkFailNotice(1, 1, '');
  assert.equal(unknown.text, '일정 사진 2장 못 넣었어요');
  assert.equal(unknown.retry, false);
  assert.match(unknown.note, /사업 보고를 열어 확인/);
});

test('지키는 것: 처음엔 안 고른 상태·작은 그림은 일정 창과 같은 서버 그림·넣기는 서버 한 곳(올리기 없음)', () => {
  const src = read('../app/report-event-photos.js');
  // 기기 저장 금지는 저장 감사(browser-storage-audit)가 앱 전체에서 본다(시험 줄에는 저장소 이름을 쓰지 않음).
  assert.match(src, /picked = new Set\(\)/); // 창을 열 때마다 비운 채로 시작
  assert.equal(src.match(/picked\.add\(/g)?.length, 1); // 고르기는 누를 때 한 곳뿐(미리 고르지 않는다)
  assert.match(src, /eventPhotoUrl\(ev\.calendarId, ev\.id, f\.drive_file_id, 'small'/);
  assert.match(src, /\/functions\/v1\/document-actions/);
  assert.doesNotMatch(src, /library-files|attach-file|FormData/); // 다시 올리지 않는다
  assert.match(src, /filter\(isEventPhoto\)/); // 사진만
});

test('쓰기 창: 사진 칸 아래 자리, 일정에서 연 창만, 저장하면 창이 닫힌 뒤 고른 사진만 보낸다', () => {
  const html = read('../app/index.html');
  assert.match(html, /<div id="meetingSelectedPhotos"[^>]*><\/div><div id="meetingEventPhotos" hidden><\/div><\/section>/);
  const team = read('../app/team.js');
  assert.match(team, /resetMeetingTimePhotos\(\);resetMeetingEventPhotos\(\);openModal\('meetingModal'/);
  assert.match(team, /eventPicks=meetingEventPhotos\?\.chosen\?\.\(\)\|\|\[\]/);
  // 창을 먼저 닫고(closeModal) 그 뒤에 보낸다 — 성공 길·연결 실패 길 둘 다.
  const sends = [...team.matchAll(/closeModal\('meetingModal'\);showSaved\([^)]*\);if\(files\.length\|\|timePicks\.length\)void sendReportFiles\([^;]*;sendEventPhotos\(/g)];
  assert.equal(sends.length, 2);
  // 지우기 안내: 일정 첨부 원본은 Drive에 둔다(서버 reason event_attachment).
  assert.match(read('../app/document-delete.js'), /data\.reason==='event_attachment'\)return '자료 등록을 삭제했습니다\. 일정에 붙인 원본 파일은 Drive에 그대로 두었습니다\.'/);
});
