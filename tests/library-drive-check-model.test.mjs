// S69-52 ① [드라이브와 맞는지 보기] 화면 글 규칙(app/library-drive-check-model.mjs). 값은 모두 지어낸 것.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DRIVE_CHECK_LABEL, KIND_ORDER, KIND_TITLE, addFix, failText, fixLine, headLine, lineView, noteLine, undoLine } from '../app/library-drive-check-model.mjs';

test('메뉴 이름·종류 다섯(네 가지 + 자리)', () => {
  assert.equal(DRIVE_CHECK_LABEL, '드라이브와 맞는지 보기');
  assert.deepEqual(KIND_ORDER.map(k => KIND_TITLE[k]), ['드라이브에 없는 자료실 폴더', '자료실에 없는 드라이브 폴더', '다른 폴더에 있는 파일', '이름 다른 폴더', '자리 다른 폴더']);
});

test('위 한 줄·아래 안내(연결된 원본은 옮기지 않음)', () => {
  assert.equal(headLine({ ok: true, total: 3 }), '어긋난 곳 3개');
  assert.equal(headLine({ ok: true, total: 0 }), '드라이브와 같아요');
  assert.equal(noteLine({ linked: 2, outside: 1, waiting: 4 }), '연결된 원본 2개는 드라이브 원래 자리에 그대로 둬요 · 자료실 밖에 있는 다른 기능 파일 1개도 그대로 둬요 · 폴더를 먼저 맞추면 자료 4개를 더 살펴요');
  assert.equal(noteLine({}), '');
});

test('줄 모양: 이름·자리는 두 방향, 바뀐 쪽을 먼저(진하게)', () => {
  const name = lineView('name', { app_name: '가', drive_name: '나', suggest: 'drive', can_app: true });
  assert.deepEqual(name.acts.map(a => a.to), ['app', 'drive']);
  assert.equal(name.prefer, 'drive');
  assert.equal(name.sub, '자료실에서 바꿨어요');
  assert.equal(lineView('name', { app_name: '가', drive_name: '나'.repeat(50), suggest: null, can_app: false }).acts.length, 1, '40자 넘는 드라이브 이름은 자료실로 못 가져옴');
  const place = lineView('place', { path: ['가'], outside: true, can_app: false, suggest: null });
  assert.deepEqual(place.acts.map(a => a.label), ['자료실 자리로']);
  assert.equal(place.sub, '드라이브에서 자료실 밖으로 옮겨졌어요');
  const extra = lineView('extra', { path: ['가'], in_trash: true, can_app: true, parent_ready: true });
  assert.equal(extra.note, '자료실 휴지통에 있는 폴더의 짝이에요');
  assert.equal(lineView('file', { title: '자료', from: ['A'], to: [] }).sub, '드라이브 자료실 › A → 자료실');
});

test('결과 한 줄', () => {
  const s = addFix(addFix({}, { done: 2, reasons: { parent_first: 1 }, left: 3 }), { done: 1, cant: 1, reasons: { parent_first: 1, gone: 2 }, left: 0 });
  assert.equal(fixLine(s), '맞춤 3 · 권한이 없어 그대로 1 · 위 폴더부터 맞춰야 해요 2');
  assert.equal(fixLine({ done: 1, left: 4 }), '맞춤 1 · 남음 4 — 다시 누르면 이어서 해요');
  assert.equal(undoLine(5, false), '되돌렸어요 · 5곳');
  assert.equal(failText('drive_not_connected'), 'Google Drive 연결을 확인해 주세요.');
});
