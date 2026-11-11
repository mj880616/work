// UI-폴더누르기한규칙(S57-5): ftPressToggle — 폴더 이름 누르기 = 아이콘 단추 누르기(펼치기·접기), 들어가지 않음. 화면 없이 가짜 요소로 시험.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ftPressToggle, FOLDER_ENTER_LABEL} from '../app/folder-tree-press.mjs';

const fakeRow = ({hasTog = true, tog = true, expanded = 'false'} = {}) => {
  const log = [];
  const togEl = tog ? {click: () => log.push('tog'), getAttribute: () => expanded} : null;
  const row = {matches: sel => sel === '.ft-has-tog' && hasTog, querySelector: () => togEl};
  const main = {classList: {contains: c => c === 'ft-main'}, closest: sel => (sel === '.ft-row' ? row : null), attributes: []};
  return {main, log};
};

test('ftPressToggle: 아이콘 단추가 있는 폴더 줄 이름 누르기 = 아이콘 단추를 눌러 처리했다고 알린다', () => {
  const {main, log} = fakeRow();
  assert.equal(ftPressToggle(main), true);
  assert.deepEqual(log, ['tog']);
});

test('ftPressToggle: 펼칠 것이 없는 폴더(아이콘 단추 없음)는 처리했지만 아무 일도 하지 않는다(들어가지 않음)', () => {
  const {main, log} = fakeRow({tog: false});
  assert.equal(ftPressToggle(main), true);
  assert.deepEqual(log, []);
});

test('ftPressToggle: toggle 줄이 아니면(자료실 전체·폴더 밖 등) 처리하지 않는다', () => {
  const {main, log} = fakeRow({hasTog: false});
  assert.equal(ftPressToggle(main), false);
  assert.deepEqual(log, []);
  assert.equal(ftPressToggle(null), false);
  assert.equal(ftPressToggle({classList: {contains: () => false}, closest: () => null}), false);
});

test('그 폴더만 보기 메뉴 글자는 화면마다 같다', () => {
  assert.equal(FOLDER_ENTER_LABEL, '이 폴더로 들어가기');
});
