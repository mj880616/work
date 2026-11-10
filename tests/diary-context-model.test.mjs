// JOURNAL-일기원드라이브 10.6 '그날 맥락' (2026-11-10 명진 결정): 접힌 한 줄·목록 글자·크게 보기 캡션 시각 맞춤 규칙, 그리고 화면이
// 새 저장 없이 업무일지의 읽기 함수를 그대로 쓰는지(소스 검사). 지어낸 값만 쓴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MEETING_SPAN_MS, contextSummary, entryText, takenMs, photoContextLine} from '../app/diary-context-model.mjs';

const at = iso => Date.parse(iso);
const ev = (title, s, e, extra = {}) => ({kind:'event', id:title, title, time:'', allDay:false, startMs:at(s), endMs:at(e), ...extra});
const mt = (title, s) => ({kind:'meeting', id:title, title, time:'', allDay:false, startMs:at(s), endMs:at(s) + MEETING_SPAN_MS});

test('접힌 한 줄: 일정·회의 수만, 없으면 빈 글자(그리지 않음)', () => {
  assert.equal(contextSummary([]), '');
  assert.equal(contextSummary(null), '');
  assert.equal(contextSummary([ev('가', '2026-10-12T01:00:00Z', '2026-10-12T02:00:00Z'), ev('나', '2026-10-12T03:00:00Z', '2026-10-12T04:00:00Z'), mt('다', '2026-10-12T05:00:00Z')]), '그날 맥락 · 일정 2 · 회의 1');
  assert.equal(contextSummary([mt('다', '2026-10-12T05:00:00Z')]), '그날 맥락 · 회의 1');
  assert.equal(contextSummary([ev('가', '2026-10-12T01:00:00Z', '2026-10-12T02:00:00Z')]), '그날 맥락 · 일정 1');
  // 할 일·메모 같은 다른 종류는 세지 않는다(명진 결정 ①).
  assert.equal(contextSummary([{kind:'task', title:'x'}, {kind:'memo', title:'y'}]), '');
});

test('목록 줄 글자: 시각 + 제목, 제목 없으면 (제목 없음)', () => {
  assert.equal(entryText({time:'14:00', title:'시험 회의'}), '14:00 시험 회의');
  assert.equal(entryText({time:'종일', title:'워크숍'}), '종일 워크숍');
  assert.equal(entryText({time:'', title:'  '}), '(제목 없음)');
});

test('찍은 시각: 없거나 대략(approx)이면 null', () => {
  assert.equal(takenMs({taken_at:'2026-10-12T05:20:00Z', approx:false}), at('2026-10-12T05:20:00Z'));
  assert.equal(takenMs({taken_at:'2026-10-12T05:20:00Z', approx:true}), null);
  assert.equal(takenMs({taken_at:''}), null);
  assert.equal(takenMs({kind:'upload'}), null);
  assert.equal(takenMs(null), null);
});

test('캡션 시각 맞춤: 찍은 시각(서울)이 시간 안에 든 일정·회의 한 줄, 아니면 생략', () => {
  const entries = [ev('긴 일정', '2026-10-12T00:00:00Z', '2026-10-12T09:00:00Z'), mt('시험 회의', '2026-10-12T05:00:00Z'), ev('종일 행사', '2026-10-12T00:00:00Z', '2026-10-13T00:00:00Z', {allDay:true})];
  // 05:20Z = 서울 14:20. 둘을 품지만 가장 늦게 시작한 회의 하나.
  assert.equal(photoContextLine({taken_at:'2026-10-12T05:20:00Z'}, entries), '14:20 시험 회의 중');
  // 회의 시각 + 2시간이 지나면 회의는 끝, 긴 일정만.
  assert.equal(photoContextLine({taken_at:'2026-10-12T07:30:00Z'}, entries), '16:30 긴 일정 중');
  // 끝 시각은 들지 않는다. 종일 일정은 맞추지 않는다.
  assert.equal(photoContextLine({taken_at:'2026-10-12T09:00:00Z'}, entries), '');
  // 시각 없는 사진·대략 시각 사진은 생략(명진 결정 ②).
  assert.equal(photoContextLine({taken_at:'2026-10-12T05:20:00Z', approx:true}, entries), '');
  assert.equal(photoContextLine({kind:'upload'}, entries), '');
  assert.equal(photoContextLine({taken_at:'2026-10-12T05:20:00Z'}, []), '');
  // 같은 시각에 시작하면 회의를 먼저.
  assert.equal(photoContextLine({taken_at:'2026-10-12T05:10:00Z'}, [ev('같은 일정', '2026-10-12T05:00:00Z', '2026-10-12T06:00:00Z'), mt('같은 회의', '2026-10-12T05:00:00Z')]), '14:10 같은 회의 중');
});

test('화면 부품: 업무일지 읽기 재사용, 새 저장·브라우저 저장·새 Edge 없음, <details> 접힘, 사진 없는 날은 자리 없음', () => {
  const src = readFileSync(new URL('../app/diary-context.js', import.meta.url), 'utf8');
  assert.match(src, /from '\.\/journal-data\.js'/);
  assert.match(src, /readWeekEvents/);
  assert.match(src, /readWeekMeetings/);
  assert.match(src, /createElement\('details'\)/);
  assert.match(src, /className = 'row-act diary-ctx-line'/);
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(src, /rt\.api\(|method:\s*'(POST|PATCH|DELETE)'/);
  assert.doesNotMatch(src, /functions\/v1\//);
  const diary = readFileSync(new URL('../app/diary.js', import.meta.url), 'utf8');
  assert.match(diary, /hasPhotos \? '<div class="diary-ctx-slot" data-diary-context-slot><\/div>' : ''/);
  assert.match(diary, /if \(hasPhotos\) paintContext\(/);
});
