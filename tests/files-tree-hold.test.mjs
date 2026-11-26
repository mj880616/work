import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rowKey, folderKey} from '../app/files-model.mjs';

// S69-75 LONGPRESS-폰나무(2026-11-24 21:15 사용자 "파일 목록에 보이는 파일 폴더 꾹 눌러도 선택 안되는데?"):
// [파일] 폰 나무(저장소 상자·'최근' 상자)의 폴더 줄·파일 줄도 꾹 누르기 = 선택 모드 + 그 줄, 메뉴는 ⋯로만.
const files = readFileSync(new URL('../app/files.js', import.meta.url), 'utf8');

test('나무 폴더 줄 열쇠(folderKey)와 고를 때 쓰는 줄 열쇠(rowKey)가 같은 모양이다', () => {
  for (const [source, id] of [['od', 'OD!1'], ['gd', 'gdFolder1'], ['ph', 'DCIM/Camera'], ['pc', 'C:\\가상']]) {
    assert.equal(folderKey(source, id), rowKey({source, item_id: id}));
  }
});

test('폰 나무 폴더·파일 줄을 고르기 열쇠로 읽고, 줄 정보가 없는 줄(저장소 맨 위)은 고르지 않는다', () => {
  const body = files.slice(files.indexOf('const treePickKey'), files.indexOf('const treePickKey') + 500);
  assert.match(body, /\[data-fx-tog\]/);
  assert.match(body, /\[data-fx-tfile\]/);
  assert.match(body, /state\.treeRows\.has\(key\)/);
  // S69-84: 폰 나무뿐 아니라 폴드·PC 한 칸 왼쪽 나무(폴더 줄 이름 단추 data-fx-go)도 같다. 두 칸의 ▾ 나무(열 폴더 고르기 창)는 뺀다.
  assert.match(body, /if \(two\(\)\) return ''/, '두 칸이 아닐 때(한 칸 나무)');
  assert.match(body, /\.ft-row\[data-fx-fold\] > \.ft-main\[data-fx-go\]/, '폴드·PC 왼쪽 나무 폴더 줄');
  assert.match(body, /\[data-fx-ptree\]/, '두 칸 ▾ 나무는 빼냄');
  assert.doesNotMatch(body, /treePane\(\)|PHONE\.matches|matchMedia/, '폭(기기 종류)으로 가르지 않는다');
});

test('꾹 누르기: 손가락은 고르기(holdPickRow), 마우스 우클릭만 ⋯ 메뉴 · 끌기 부품도 나무 줄을 집는다', () => {
  const ctx = files.slice(files.indexOf("root?.addEventListener('contextmenu'"), files.indexOf('function listMenu('));
  assert.match(ctx, /treePickKey\(event\.target\)/);
  assert.match(ctx, /event\.pointerType === 'touch'\) \{ event\.preventDefault\(\); holdPickRow\(tkey\)/);
  assert.match(ctx, /if \(!treePane\(\)\) return;/, '폴드·PC 나무의 마우스 우클릭은 공용 우클릭 그대로');
  assert.doesNotMatch(ctx, /recentFile/, "'최근' 상자 줄도 손가락 꾹 누르기는 메뉴가 아니라 고르기");
  const drag = files.slice(files.indexOf('const touchDrag = bindTouchDrag('), files.indexOf('const touchDrag = bindTouchDrag(') + 1200);
  assert.match(drag, /treePickKey\(target\)/);
  assert.match(drag, /hold: item => holdPickRow\(item\.key\)/);
});

test('선택 모드에서 나무 줄 누르기 = 더하기/빼기, 고른 것은 목록과 같은 막대(rowByKey가 나무 줄도 찾음)', () => {
  assert.match(files, /\(b\.matches\('\[data-fx-tog\],\[data-fx-tfile\]'\) \|\| \(b\.matches\('\.ft-main\[data-fx-go\]'\) && event\.pointerType !== 'mouse'\)\) && state\.panes\[0\]\.picked\.size && treePickKey\(b\)\) \{ togglePick\(/,
    '폴드·PC 나무 이름 누르기는 손가락일 때만 더하기/빼기(마우스는 들어가기 그대로)');
  assert.match(files, /!two\(\) \? state\.treeRows\.get\(key\)/);
  assert.match(files, /function paintTreePicks\(/);
});
