import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPicked, groupByPath, batches, sizeText, addTotals, resultLine, headLine, skippedLine } from '../app/library-drive-import-model.mjs';

// S69-25 LIB-드라이브에서가져오기: 화면 규칙(묶기·기본 체크·나눠 보내기·결과 줄).
test('기본 체크: 개인 서류·사진은 빼고 나머지는 모두', () => {
  assert.equal(defaultPicked({ personal: false, media: false }), true);
  assert.equal(defaultPicked({ personal: true, media: false }), false);
  assert.equal(defaultPicked({ personal: false, media: true }), false);
});
test('경로별 묶음은 받은 순서 그대로', () => {
  const g = groupByPath([{ id: 1, path: '내 드라이브' }, { id: 2, path: '내 드라이브 › 가' }, { id: 3, path: '내 드라이브' }]);
  assert.deepEqual(g.map(x => [x.path, x.items.map(i => i.id)]), [['내 드라이브', [1, 3]], ['내 드라이브 › 가', [2]]]);
});
test('50개씩 나눠 보냄', () => {
  const b = batches(Array.from({ length: 120 }, (_, i) => i));
  assert.deepEqual(b.map(x => x.length), [50, 50, 20]);
});
test('결과 줄', () => {
  const t = addTotals(addTotals({}, { added: 3, exists: 1 }), { added: 2, unreadable: 1, failed: 1 });
  assert.equal(resultLine(t), '5개 가져옴 · 3개 건너뜀(이미 있음 1 · 못 읽음 2)');
  assert.equal(resultLine({ added: 4 }), '4개 가져옴');
  assert.equal(headLine({ total: 10, shown: 10, picked: 8 }), '자료실에 없는 파일 10개 · 선택 8개');
  assert.match(headLine({ total: 6000, shown: 5000, picked: 1, more: true }), /앞 5000개만/);
  assert.equal(skippedLine({ registered: 3, app: 2, not_file: 0, empty: 1 }), '목록에서 뺀 것: 이미 자료실에 있음 3 · 앱이 쓰는 폴더 2 · 빈 파일 1');
  assert.equal(sizeText(2048), '2KB');
  assert.equal(sizeText(null), '');
});
