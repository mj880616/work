import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectedMobileTab, mobileTabKey, paintMobileTabs, MENU_SHEET_VIEWS} from '../app/mobile-tab-selection.mjs';

// UI-모바일메뉴순서: 폰 하단바에서 진하게 켜지는 칸은 언제나 하나. 결정 규칙을 한 곳에서 시험한다.
const SCREENS = ['home', 'basket', 'calendar', 'tasks', 'diary', 'projects', 'team', 'meetings', 'library', 'hwp', 'pages', 'ledger', 'calls', 'telegram', 'search', 'settings', null];

test('메뉴 창이 열려 있으면 어느 화면에서든 [메뉴]만', () => {
  for (const view of SCREENS) for (const noteMode of [false, true]) assert.equal(selectedMobileTab({view, noteMode, menuOpen: true}), 'menu', `${view}/${noteMode}`);
});

test('메뉴 창이 닫혀 있으면 지금 화면의 칸 하나', () => {
  const expected = {home: 'home', basket: 'basket', calendar: 'schedule', tasks: 'schedule', diary: 'schedule', meetings: 'meetings', projects: 'meetings', team: 'team'};
  // MTG-프로젝트합치기 3단계: 하단바 4번째 칸은 [사업 보고]이고, 사업영역 관리(라우터 이름 projects)에서도 그 칸이 켜진다.
  for (const [view, tab] of Object.entries(expected)) assert.equal(selectedMobileTab({view}), tab, view);
  for (const view of MENU_SHEET_VIEWS) assert.equal(selectedMobileTab({view}), 'menu', view);
  assert.equal(selectedMobileTab({view: 'basket', noteMode: true}), 'menu', '노트는 하단바에 칸이 없다');
  for (const view of ['search', 'settings', null]) assert.equal(selectedMobileTab({view}), null, String(view));
});

function button(attrs = {}) {
  const set = new Set(), a = {...attrs.attrs};
  return {id: attrs.id || '', dataset: attrs.dataset || {}, classList: {toggle: (c, on) => on ? set.add(c) : set.delete(c)}, setAttribute: (k, v) => { a[k] = v; }, removeAttribute: k => { delete a[k]; }, a, set};
}
const tabs = () => [button({dataset: {view: 'home'}}), button({dataset: {view: 'basket'}}), button({dataset: {view: 'calendar', mobileScheduleTab: ''}}), button({dataset: {view: 'meetings'}}), button({dataset: {view: 'team'}}), button({id: 'mobileMenuTab'})];
const root = list => ({querySelectorAll: () => list});
const current = list => list.filter(b => b.a['aria-current'] === 'page').map(mobileTabKey);

test('하단바를 그릴 때 aria-current는 항상 한 칸이고 기기에 남지 않는다', () => {
  const list = tabs(), r = root(list);
  for (const view of SCREENS) {
    for (const open of [false, true]) {
      globalThis.window = {KPTUMobileMenu: {isOpen: () => open}};
      paintMobileTabs(r, {view, noteMode: false});
      const marked = current(list);
      assert.ok(marked.length <= 1, `${view}/${open}: ${marked}`);
      if (open) assert.deepEqual(marked, ['menu']);
      assert.equal(list.filter(b => b.set.has('active')).length, marked.length);
    }
  }
  delete globalThis.window;
});

test('일정 칸은 달력·할 일·일기 어디서든(HOME-업무일지홈: 업무일지는 홈) 그 칸으로 읽힌다', () => {
  globalThis.window = {KPTUMobileMenu: {isOpen: () => false}};
  const list = tabs();
  for (const view of ['calendar', 'tasks', 'diary']) { list[2].dataset.view = view; paintMobileTabs(root(list), {view}); assert.deepEqual(current(list), ['schedule']); }
  delete globalThis.window;
});
