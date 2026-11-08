// S52-41 ④ FILES-폴더고정: 고정한 폴더 계산(키 모양·더하기·빼기·순서·줄 모양). 화면·네트워크 없음. 폴더 id는 가짜.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PINS_MAX, pinParse, pinKey, pinsClean, pinHas, pinAdd, pinRemove, pinMove, pinStep, pinView} from '../app/files-pins-model.mjs';
import {FILES_PIN_RE, FILES_PINS_MAX, validValue} from '../app/view-prefs.js';
import {treeMenuItems} from '../app/files-tree-menu.mjs';

test('키: 원드라이브·구글 드라이브 폴더만(내 PC·이 폰 경로는 서버 키가 아님), 첫 ":"만 가른다', () => {
  assert.deepEqual(pinParse('od:F1'), {source: 'od', id: 'F1'});
  assert.deepEqual(pinParse('gd:a:b'), {source: 'gd', id: 'a:b'});
  for (const bad of ['pc:C:\\a', 'ph:x', 'od:', 'od', '', null, 'od:a\nb', 'od:' + 'x'.repeat(201)]) assert.equal(pinParse(bad), null, String(bad));
  assert.equal(pinKey('od', 'F1'), 'od:F1');
  assert.equal(pinKey('pc', 'C:\\a'), '');
  assert.equal(PINS_MAX, FILES_PINS_MAX);
  // 화면 허용 검사(view-prefs)와 같은 모양.
  for (const k of ['od:F1', 'gd:a:b', 'od:' + 'x'.repeat(200)]) assert.ok(FILES_PIN_RE.test(k) && pinParse(k), k);
});

test('더하기·빼기·12개 상한·겹침 없음, 서버 값은 쓸 수 있는 것만', () => {
  let list = [];
  for (let i = 0; i < PINS_MAX; i++) { const out = pinAdd(list, 'od:F' + i); assert.equal(out.ok, true); list = out.list; }
  const full = pinAdd(list, 'gd:x');
  assert.equal(full.ok, false); assert.match(full.why, /12개까지/);
  assert.deepEqual(pinAdd(list, 'od:F0').list, list);
  assert.equal(pinHas(list, 'od:F3'), true);
  assert.deepEqual(pinRemove(['od:a', 'gd:b'], 'od:a'), ['gd:b']);
  assert.deepEqual(pinsClean(['od:a', 'od:a', 'pc:C:\\x', 5, 'gd:b']), ['od:a', 'gd:b']);
  assert.equal(validValue('files_pins', list), true);
});

test('순서: 끌어 놓기 자리·키보드 ↑↓', () => {
  assert.deepEqual(pinMove(['a', 'b', 'c'], 'c', 0), ['c', 'a', 'b']);
  assert.deepEqual(pinMove(['a', 'b', 'c'], 'a', 9), ['b', 'c', 'a']);
  assert.deepEqual(pinMove(['a', 'b'], 'z', 0), ['a', 'b']);
  assert.deepEqual(pinStep(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c']);
  assert.deepEqual(pinStep(['a', 'b', 'c'], 'c', 1), ['a', 'b', 'c']);
});

test('줄 모양: 이름(모르면 폴더·내 PC는 끝 이름), 출처가 꺼졌거나 끊기면 흐리게 연결 안 됨', () => {
  assert.deepEqual(pinView({source: 'od', id: 'F1', name: '가짜 문서함', on: ['od']}), {source: 'od', id: 'F1', name: '가짜 문서함', live: true, tag: ''});
  assert.equal(pinView({source: 'gd', id: 'x', on: ['od']}).tag, '연결 안 됨');
  assert.equal(pinView({source: 'gd', id: 'x', on: ['gd']}).name, '폴더');
  assert.equal(pinView({source: 'pc', id: 'C:\\문서\\가짜', on: ['pc']}).name, '가짜');
});

test('⋯ 메뉴: 고정할 수 있는 폴더만 [위에 고정]·[고정 풀기](둘째 묶음 맨 앞), 파일·고정 못 하는 곳은 없음', () => {
  const ids = (row, opt) => treeMenuItems(row, opt).map(x => x.id);
  assert.ok(ids({source: 'od', is_folder: true}, {pinned: false}).includes('pin'));
  assert.ok(ids({source: 'od', is_folder: true}, {pinned: true}).includes('unpin'));
  assert.ok(!ids({source: 'od', is_folder: true}).includes('pin'));
  assert.ok(!ids({source: 'od'}, {pinned: false}).includes('pin'));
  const items = treeMenuItems({source: 'od', is_folder: true}, {pinned: false});
  assert.equal(items.find(x => x.id === 'pin').sep, true);
  assert.deepEqual(ids({source: 'pc', is_folder: true}, {pinned: false}), ['only', 'pin', 'trash']); // S53-10: 휴지통은 늘 맨 아래(여기선 흐리게)
});

test('내 PC 고정 경로는 서버·브라우저 저장소로 가지 않는다(코드로 확인)', () => {
  const files = readFileSync(new URL('../app/files.js', import.meta.url), 'utf8');
  const body = files.slice(files.indexOf('async function setPcPins'), files.indexOf('async function loadPcPins'));
  assert.match(body, /pc\.setPins\(/);
  assert.doesNotMatch(body, /viewPrefs|Storage|rpc\(/);
  assert.doesNotMatch(readFileSync(new URL('../app/files-pins-model.mjs', import.meta.url), 'utf8'), /Storage|indexed[D]B|cache[s]\./);
});
