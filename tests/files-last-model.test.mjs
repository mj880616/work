// S52-44 ② FILES-관리자마무리: 칸마다 마지막 폴더 계산(모양·바꾸기·첫 자리). 화면·네트워크 없음. 폴더 id는 가짜.
import test from 'node:test';
import assert from 'node:assert/strict';
import {LAST_PANES, lastClean, lastOf, lastPut, lastStart} from '../app/files-last-model.mjs';
import {FILES_LAST_PANES, validValue} from '../app/view-prefs.js';

test('서버 값은 쓸 수 있는 모양만(칸 2개, od·gd 글자 id), 화면 허용 검사와 같은 모양', () => {
  assert.equal(LAST_PANES, FILES_LAST_PANES);
  assert.deepEqual(lastClean(null), []);
  assert.deepEqual(lastClean([{od: 'F1', pc: 'C:\\a', ph: 'DCIM'}, {gd: ''}, {od: 'x'}]), [{od: 'F1'}, {}]);
  assert.deepEqual(lastClean([null, {gd: 'a\nb', od: 'A'.repeat(201)}]), [{}, {}]);
  for (const v of [[{od: 'F1'}], [{}, {gd: 'G1'}]]) assert.equal(validValue('files_last', v), true);
});

test('칸마다·저장소마다 따로 기억, 맨 위면 지우고 끝의 빈 칸은 뗀다', () => {
  let v = lastPut([], 0, {source: 'od', parent: 'F1'});
  assert.deepEqual(v, [{od: 'F1'}]);
  v = lastPut(v, 1, {source: 'gd', parent: 'G1'});
  assert.deepEqual(v, [{od: 'F1'}, {gd: 'G1'}]);
  v = lastPut(v, 0, {source: 'gd', parent: 'G2'});
  assert.deepEqual(v, [{od: 'F1', gd: 'G2'}, {gd: 'G1'}]);
  assert.equal(lastOf(v, 0, 'gd'), 'G2');
  assert.equal(lastOf(v, 1, 'od'), null);
  assert.equal(lastPut(v, 0, {source: 'od', parent: 'F1'}), null, '같으면 저장하지 않음');
  v = lastPut(v, 1, {source: 'gd', parent: null});
  assert.deepEqual(v, [{od: 'F1', gd: 'G2'}], '둘째 칸 맨 위 → 빈 칸은 뗌');
  assert.equal(validValue('files_last', v), true);
});

test('묶음·이 폰·내 PC·찾기 자리는 기억하지 않는다(경로를 서버에 두지 않음)', () => {
  for (const w of [{shelf: 'starred'}, {source: 'ph', parent: 'DCIM'}, {source: 'pc', parent: 'C:\\문서'}, null, {source: 'od', parent: 'a\nb'}])
    assert.equal(lastPut([], 0, w), null, JSON.stringify(w));
  assert.equal(lastPut([], 2, {source: 'od', parent: 'F1'}), null);
});

test('첫 자리: 맨 위로 열 저장소에 기억이 있으면 그 폴더, 아니면 그대로', () => {
  const v = [{od: 'F1'}, {gd: 'G1'}];
  assert.deepEqual(lastStart({source: 'od', parent: null}, v, 0), {source: 'od', parent: 'F1'});
  assert.deepEqual(lastStart({source: 'gd', parent: null}, v, 0), {source: 'gd', parent: null});
  assert.deepEqual(lastStart({source: 'gd', parent: null}, v, 1), {source: 'gd', parent: 'G1'});
  assert.deepEqual(lastStart({source: 'pc', parent: null}, v, 0), {source: 'pc', parent: null});
  assert.equal(lastStart(null, v, 0), null);
  assert.deepEqual(lastStart({source: 'od', parent: 'X'}, v, 0), {source: 'od', parent: 'X'});
});
