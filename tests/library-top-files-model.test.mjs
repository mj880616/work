// S69-40: 맨 위 파일 정리 창 글 규칙.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scanLines, addTidy, tidyLine, sizeShort } from '../app/library-top-files-model.mjs';

test('요약 줄: 할 일 종류별 숫자, 폴더 밖 자료·맞추기 먼저 알림', () => {
  const s = scanLines({ total: 40, counts: { library: 5, library_top: 2, attach: 1, old: 3, temp: 4, junk: 1, dup: 2, none: 22 }, need_align: 1 });
  assert.equal(s.head, '드라이브 자료실 맨 위 파일 40개');
  assert.equal(s.todo, '제 폴더로 5 · 첨부 폴더로 1 · 휴지통 7(앱 임시 4·찌꺼기 1·중복 2) · 정리 대기 25(바꿔 끼운 옛 원본 3·앱 기록 없음 22)');
  assert.equal(s.note, '폴더 밖 자료 2개는 그 자리가 맞아 그대로 · 1개는 드라이브 폴더가 아직 없어 못 옮겼어요(잠시 뒤 다시)');
  assert.equal(scanLines({ total: 0, counts: {} }).todo, null);
});

test('결과 한 줄과 이어 하기 합계', () => {
  let s = addTidy({}, { moved: 2, trashed: 3, waiting: 10, left: 5 });
  s = addTidy(s, { moved: 1, attached: 1, waiting: 4, cant: 1, left: 0 });
  assert.equal(tidyLine(s), '옮김 3 · 첨부로 1 · 휴지통 3 · 정리 대기 14 · 권한이 없어 그대로 1');
  assert.match(tidyLine({ left: 2 }), /남음 2 — 다시 누르면 이어서 해요/);
  assert.equal(sizeShort(1536), '2KB'); assert.equal(sizeShort(0), '');
});
