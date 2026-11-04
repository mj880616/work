import test from 'node:test';
import assert from 'node:assert/strict';
import {FILES_TWO_KEY, twoLayout, twoOn, twoValue, paneSide, sendLabel, paneDest, otherStart, FILES_TWO_DEFAULT} from '../app/files-panes-model.mjs';
import {validValue, parsePrefs, applyChanges, createViewPrefs} from '../app/view-prefs.js';
// S49-30 FILES-통합 2-③ 두 칸(명진 결정 H-2): 켬 계산·막대 글자·받을 곳(반대 칸), 서버 칸 files_two 모양.
test('기본: 폴드 펼침은 두 칸, PC는 한 칸 · 서버 값이 있으면 그 값', () => {
  assert.equal(FILES_TWO_KEY, 'files_two');
  assert.deepEqual({...FILES_TWO_DEFAULT}, {fold: true, wide: false});
  assert.equal(twoLayout(false), 'fold'); assert.equal(twoLayout(true), 'wide');
  assert.equal(twoOn(undefined, 'fold'), true); assert.equal(twoOn(undefined, 'wide'), false);
  assert.equal(twoOn({fold: false}, 'fold'), false); assert.equal(twoOn({wide: true}, 'wide'), true);
  assert.equal(twoOn({fold: 'yes'}, 'fold'), true, '모양이 틀리면 기본');
  assert.equal(twoOn([], 'wide'), false); assert.equal(twoOn({wide: true}, 'phone'), false);
});
test('켬 바꾸기는 이 폭 칸만 바꾸고 다른 폭 칸은 아는 값만 남긴다', () => {
  assert.deepEqual(twoValue(undefined, 'wide', true), {wide: true});
  assert.deepEqual(twoValue({fold: false}, 'wide', true), {fold: false, wide: true});
  assert.deepEqual(twoValue({fold: 'x', wide: true}, 'fold', false), {fold: false, wide: true});
});
test('막대 글자: 왼쪽 칸은 → 오른쪽에, 오른쪽 칸은 ← 왼쪽에', () => {
  assert.equal(paneSide(0), '왼쪽'); assert.equal(paneSide(1), '오른쪽');
  assert.equal(sendLabel(0, 'copy'), '→ 오른쪽에 복사'); assert.equal(sendLabel(0, 'move'), '→ 옮기기');
  assert.equal(sendLabel(1, 'copy'), '← 왼쪽에 복사'); assert.equal(sendLabel(1, 'move'), '← 옮기기');
});
test('받을 곳 = 폴더를 연 칸만(찾는 중·묶음·빈 칸은 없음) · 오른쪽 칸 첫 위치는 다른 저장소 맨 위', () => {
  assert.deepEqual(paneDest({where: {source: 'od', parent: 'OD!1'}, query: ''}), {source: 'od', parent: 'OD!1'});
  assert.deepEqual(paneDest({where: {source: 'gd'}, query: ''}), {source: 'gd', parent: null});
  assert.equal(paneDest({where: {source: 'od', parent: null}, query: '찾기'}), null);
  assert.equal(paneDest({where: {shelf: 'recent'}, query: ''}), null);
  assert.equal(paneDest({where: null}), null);
  assert.deepEqual(otherStart({source: 'od', parent: 'x'}, ['od', 'gd']), {source: 'gd', parent: null});
  assert.deepEqual(otherStart({shelf: 'recent'}, ['od', 'gd']), {source: 'od', parent: null});
  assert.deepEqual(otherStart({source: 'od'}, ['od']), {source: 'od', parent: null});
  assert.equal(otherStart(null, []), null);
});
test('view_prefs files_two: 기기 칸 app·phone·pc, 안은 fold·wide 참·거짓만(DB 검사와 같은 모양) · 한 칸씩 쓰기', () => {
  for (const v of [{}, {pc: {}}, {pc: {fold: false}}, {app: {fold: true, wide: false}, phone: {wide: true}, pc: {wide: true}}]) assert.equal(validValue('files_two', v), true, JSON.stringify(v));
  for (const v of [null, [], 'pc', {tablet: {fold: true}}, {pc: true}, {pc: {fold: 1}}, {pc: {phone: true}}, {pc: {fold: true, x: false}}]) assert.equal(validValue('files_two', v), false, JSON.stringify(v));
  assert.deepEqual(parsePrefs({files_two: {pc: {wide: true}, app: {bad: 1}}}), {files_two: {pc: {wide: true}}});
  assert.deepEqual(applyChanges({files_two: {app: {fold: false}}, files_sources: {pc: {od: true}}}, {'files_two.pc': {wide: true}}),
    {files_two: {app: {fold: false}, pc: {wide: true}}, files_sources: {pc: {od: true}}});
  assert.deepEqual(applyChanges({files_two: {pc: {wide: true}}}, {'files_two.pc': null}), {});
  const prefs = createViewPrefs({runtime: () => null, storage: () => null});
  assert.equal(prefs.getFilesTwo('pc'), undefined);
  assert.equal(prefs.get('files_two'), undefined, '기기 칸 객체는 get으로 통째로 읽지 않는다');
});
