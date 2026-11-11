import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanFiles, isEventPhoto, eventFilesReady, MAX_EVENT_FILES } from '../app/event-files.js';

// S59-15 CAL-일정첨부: 일정 창 [사진·파일] 칸의 순수 규칙과 지키는 것(기기 저장 없음·공용 부품·서버 한 곳).
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('서버 답의 첨부는 세 칸만, Drive 파일 id 모양이 아니면 버린다', () => {
  assert.deepEqual(cleanFiles([{drive_file_id: 'a1', file_name: '사진.jpg', mime_type: 'image/jpeg', fileUrl: 'x', iconLink: 'y'}, {drive_file_id: 'bad id'}, null, {file_name: 'x'}]),
    [{drive_file_id: 'a1', file_name: '사진.jpg', mime_type: 'image/jpeg'}]);
  assert.deepEqual(cleanFiles(undefined), []);
});

test('작은 그림으로 보이는 사진: 서버가 줄여 줄 수 있는 jpeg·png·webp·gif만(그 밖에는 이름 한 줄)', () => {
  for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'image/gif']) assert.equal(isEventPhoto({file_name: 'a', mime_type: mime}), true, mime);
  for (const mime of ['image/heic', 'application/pdf', 'text/plain']) assert.equal(isEventPhoto({file_name: 'a.jpg', mime_type: mime}), false, mime);
  assert.equal(isEventPhoto({file_name: '옛 사진.JPG', mime_type: ''}), true);
});

test('칸은 서버가 files 칸을 답할 때만(옛 서버면 칸 없음 — 배포 순서 Edge 먼저)', () => {
  assert.equal(eventFilesReady({id: 'e', files: []}), true);
  assert.equal(eventFilesReady({id: 'e'}), false);
  assert.equal(MAX_EVENT_FILES, 25);
});

// 기기 저장 금지는 저장 감사(browser-storage-audit)가 앱 전체에서 본다(시험 줄에는 저장소 이름을 쓰지 않음).
test('공용 부품 · 서버 한 곳(google-calendar)', () => {
  const src = read('../app/event-files.js');
  assert.match(src, /import \{createAttachQueue\} from '\.\/basket-upload\.js'/);
  assert.match(src, /mountNewTaskFilePick\(/);
  assert.match(src, /from '\.\/upload-progress\.js'/);
  assert.match(src, /deleteAttachment\(/);
  assert.match(src, /\/functions\/v1\/google-calendar\?action=attach-file/);
  // 일정 창은 저장이 끝난 뒤 고른 파일을 뒤 줄에 넘기고 닫는다(올리기를 기다리지 않음).
  const win = read('../app/calendar-interactions-v2.js');
  const at = win.indexOf('sendEventFilesBehind({calendarId:result.event.calendarId');
  assert.ok(at > 0 && at < win.indexOf("let closedSeq=null;if(unchanged){"), '저장 확인 뒤, 창을 닫기 전에 넘긴다');
  assert.doesNotMatch(win.slice(at, at + 200), /await sendEventFilesBehind/);
  // 새 일정 창: 만든 일정(create-event)에만 넘긴다.
  assert.match(read('../app/calendar-plus.js'), /if\(r\.files\.length&&body\.action==='create-event'\)\{[^}]*sendEventFilesBehind\(\{calendarId:d\.event\.calendarId,eventId:d\.event\.id,files\}\)/);
});
