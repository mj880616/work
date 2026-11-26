// S71-49 NOTE-보드붙여넣기: 붙여넣은 글자 다듬기와 붙일 자리(app/note-board-paste-model.mjs). 글은 지어낸 것.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pastedText, pastePlace, nextPastePlace, PASTE_STEP } from '../app/note-board-paste-model.mjs';
import { TEXT_MAX } from '../app/note-board-links-model.mjs';

test('글자: 줄바꿈은 그대로(CRLF → LF), 탭은 빈칸, 제어 문자는 빼고 앞뒤 빈 줄은 지운다', () => {
  assert.deepEqual(pastedText('\r\n  첫 줄\r\n둘째\t줄\u0007  \n\n'), { body: '첫 줄\n둘째 줄', cut: false });
  assert.deepEqual(pastedText('가\n\n나'), { body: '가\n\n나', cut: false });
  assert.equal(pastedText(''), null);
  assert.equal(pastedText(' \n\t\n'), null);
  assert.equal(pastedText(null), null);
});

test('글자: 칸 한도(TEXT_MAX자)를 넘으면 앞부분만, cut 표시(글자 단위 — 한글·그림 문자도 한 자)', () => {
  const long = pastedText('가'.repeat(TEXT_MAX + 50));
  assert.equal([...long.body].length, TEXT_MAX); assert.equal(long.cut, true);
  const emoji = pastedText('😀'.repeat(TEXT_MAX + 1));
  assert.equal([...emoji.body].length, TEXT_MAX); assert.equal(emoji.cut, true);
  assert.equal(pastedText('가'.repeat(TEXT_MAX)).cut, false);
});

test('붙일 자리: 누른 자리가 보이는 판 안이면 그 자리, 밖이거나 없으면 null(→ 판 가운데)', () => {
  const area = { x: 100, y: 50, w: 800, h: 600 };
  assert.deepEqual(pastePlace({ x: 300, y: 200 }, area), { x: 300, y: 200 });
  assert.equal(pastePlace({ x: 50, y: 200 }, area), null);
  assert.equal(pastePlace({ x: 300, y: 700 }, area), null);
  assert.equal(pastePlace(null, area), null);
  assert.equal(pastePlace({ x: NaN, y: 1 }, area), null);
  assert.deepEqual(nextPastePlace({ x: 10, y: 20 }), { x: 10 + PASTE_STEP, y: 20 + PASTE_STEP });
});
