import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {eventMenuItems, DAY_MENU_ITEMS, dayMenuTitle} from '../app/calendar-row-menu.mjs';

// S51-27 UI-PC우클릭: 달력 우클릭 메뉴 항목(지금 있는 기능만)과 공용 줄 메뉴 하나만 쓰는지.
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('일정 메뉴: 수정 창과 같은 동작만, 삭제는 맨 아래 한 줄(빨강 없음)', () => {
  const items = eventMenuItems(true);
  assert.deepEqual(items.map(x => x.id), ['edit', 'orgs', 'report', 'delete']);
  assert.deepEqual(items.map(x => x.label), ['수정', '담당조직 연결', '결과 남기기', '삭제']);
  assert.equal(items.at(-1).last, true);
  assert.ok(items.every(x => !('danger' in x)));
  assert.deepEqual(eventMenuItems(false), [{id: 'edit', label: '열기'}]);
});

test('날짜 칸 메뉴와 머리 글', () => {
  assert.deepEqual(DAY_MENU_ITEMS.map(x => x.label), ['이날 일정 등록', '이날 할 일', '이날 하루 보기']);
  assert.equal(dayMenuTitle('2026-11-10'), '11월 10일 (화)');
  assert.equal(dayMenuTitle('2026-02-30'), '');
  assert.equal(dayMenuTitle('x'), '');
});

test('달력 우클릭은 공용 줄 메뉴(row-menu.js) 하나를 쓰고 따로 메뉴를 만들지 않는다', () => {
  const src = read('app/calendar-context-menu.js');
  assert.match(src, /from '\.\/row-menu\.js'/);
  assert.doesNotMatch(src, /createAnchoredMenu/);
  assert.doesNotMatch(src, /pinAt/);
  assert.match(read('app/row-menu.js'), /export function appMenuPoint/);
  assert.match(read('app/anchored-menu.js'), /function open\(trigger,\{at=null\}=\{\}\)/);
});
