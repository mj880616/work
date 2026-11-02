// UI-당연한안내삭제(요청함 11/01 00:31, S48-38): 화면만 봐도 아는 안내 줄·자동 처리 설명 줄은 지웠다(명진 원칙: 중복 제목·안내문 넣지 않음).
// 오류·권한 없음·지우기 경고·되돌릴 수 없는 동작 확인 문구는 남긴다. 지운 문구가 다시 생기지 않게 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = file => readFileSync(new URL('../app/' + file, import.meta.url), 'utf8');

const removed = [
  ['photos.js', '스위치 켜짐 = 사진에 보임'],
  ['google-tasks.js', '목록에 저장됩니다'],
  ['google-tasks.js', '고르지 않아도 됩니다'],
  ['google-tasks.js', '연결하지 않은 미완료 할 일입니다'],
  ['task-files.js', 'Google Tasks 앱에서는 메모에 링크'],
  ['task-files.js', '저장하면 Drive'],
  ['basket-manual-link.js', '만든 할 일은 이 업데이트의'],
  ['library-upload.js', '여러 파일은 각각 별도 자료로'],
  ['meeting-from-files.js', '자료실에도 자동 등록'],
  ['index.html', '자료실에도 자동 등록'],
  ['org-status-table.js', '그대로 들어감'],
  ['now-interests.js', 'AI가 별표·보관·메모'],
  ['press-draft.js', '누르면 여기에 미리보기가 나와요'],
  ['share-ai-draft.js', '누르면 여기에 칸별 미리보기가 나와요'],
  ['share-ai-draft.js', '근거 번호와 확인할 것은 본문에 들어가지 않아요'],
  ['suborganizations.js', '담당자를 지정합니다'],
  ['suborganizations.js', '내 담당조직만 표시됩니다'],
  ['workplace-detail.js', '함께 고를 수 있습니다'],
  ['workplace-detail.js', '중복 소속 가능'],
  ['telegram-feed.js', '방 단위로 보관해요'],
  ['news-clipping.js', '매체 새 글은 제목만 받습니다'],
  ['report-link-summaries.js', '비우면 사업 보고 본문이 보여요'],
  ['project-system-v3.js', '현재 상태를 빠르게 파악합니다'],
  ['project-system-v3.js', '회의 결과와 중요한 결정사항을 함께 봅니다'],
  ['project-system-v3.js', '하위페이지에서 관리합니다'],
  ['project-system-v3.js', '사업영역 관련 의견과 검토 메모입니다'],
  ['project-system-v3.js', '사업영역의 비공개 원본 내용입니다'],
];

test('UI-당연한안내삭제: 지운 안내 줄이 다시 생기지 않는다', () => {
  for (const [file, text] of removed) assert.ok(!read(file).includes(text), `${file}에 '${text}' 안내가 다시 생김`);
});

test('UI-당연한안내삭제: 지운 안내의 빈 클래스 규칙도 남기지 않는다', () => {
  assert.doesNotMatch(read('google-tasks.css'), /\.gt-links-hint\{/);
  assert.doesNotMatch(read('workplace-detail.css'), /\.wd-st-hint\{/);
  assert.doesNotMatch(read('library-upload.css'), /^\.library-multi-note\{/m);
  assert.doesNotMatch(read('now.css'), /\.ni-help/);
});

test('UI-당연한안내삭제: 지우기·데이터 경고와 오류 문구는 남긴다', () => {
  assert.match(read('telegram-feed.js'), /폴더만 지워져요\. 안에 있던 방과 소식은 그대로 전체에 남아요\./);
  assert.match(read('telegram-feed.js'), /원문은 Drive에 그대로 있어요/);
  assert.match(read('ed-window.js'), /굵게·색·표 같은 서식은 저장되지 않아요/);
  assert.match(read('photos.js'), /폴더를 읽지 못했어요/);
});
