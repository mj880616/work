import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {KEYS, validValue, parsePrefs, applyChanges, createViewPrefs} from '../app/view-prefs.js';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
// MENU-HOME-편집: 메뉴 순서(menu_layout)·홈 칸(home_cards)을 서버 칸으로 두는 규칙. 화면 쪽 모양 검사는 DB 검사와 같아야 한다.
test('허용 칸 열 개가 DB 검사(마지막 migration)와 같다', () => {
  const sql = read('supabase/migrations/20261028020000_profile_view_prefs_menu_home.sql');
  const listed = [...sql.match(/strict \$\.keyvalue\(\) \? \(!\(([^)]*)\)\)/)[1].matchAll(/@\.key == "([a-z_]+)"/g)].map(m => m[1]);
  assert.deepEqual([...KEYS].sort(), listed.sort());
  assert.equal(KEYS.length, 10);
});
test('menu_layout·home_cards 모양 검사', () => {
  const ok = {bar: ['home', 'basket'], rest: ['note']};
  assert.ok(validValue('menu_layout', ok)); assert.ok(validValue('home_cards', ['calendar', 'a_b-1'])); assert.ok(validValue('home_cards', []));
  for (const bad of [null, [], 'x', {}, {bar: ['home']}, {bar: ['home'], rest: [], extra: []}, {bar: [1], rest: []}, {bar: ['Home'], rest: []}, {bar: Array(7).fill('a'), rest: []}, {bar: [], rest: Array(25).fill('a')}]) assert.equal(validValue('menu_layout', bad), false, JSON.stringify(bad));
  for (const bad of [null, {}, 'x', [1], ['A'], ['a b'], Array(25).fill('a'), ['a'.repeat(31)]]) assert.equal(validValue('home_cards', bad), false, JSON.stringify(bad));
  assert.deepEqual(parsePrefs({menu_layout: ok, home_cards: ['x'], theme: 'navy'}), {menu_layout: ok, home_cards: ['x'], theme: 'navy'});
  assert.deepEqual(parsePrefs({menu_layout: {bar: 1, rest: []}, home_cards: 3}), {}, '틀린 칸만 버린다');
  assert.deepEqual(applyChanges({theme: 'navy'}, {menu_layout: ok}), {theme: 'navy', menu_layout: ok});
  assert.deepEqual(applyChanges({menu_layout: ok, theme: 'navy'}, {menu_layout: null}), {theme: 'navy'}, '비우기 = 처음대로');
});
test('바꾼 순서는 서버로 한 번에 보내고, 서버가 거절하면 알림과 함께 서버 값으로 돌아온다', async () => {
  const calls = [];
  let reject = false, stored = null;
  const rt = {context: {read: () => ({user: {id: 'u1'}})}, api: async (path, options = {}) => {
    calls.push([options.method || 'GET', path]);
    if (options.method === 'PATCH') { if (reject) throw Object.assign(new Error('check'), {status: 400}); stored = options.body.view_prefs; return [{}]; }
    return [{view_prefs: stored}];
  }};
  const heard = [];
  globalThis.window = {dispatchEvent: e => { heard.push(e.type + ':' + JSON.stringify(e.detail || {})); return true; }};
  globalThis.CustomEvent = class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } };
  const prefs = createViewPrefs({runtime: () => rt, storage: () => null, setTimer: fn => { fn.t = true; return fn; }, clearTimer: () => {}});
  await prefs.load();
  const layout = {bar: ['home', 'team'], rest: ['basket']};
  assert.equal(prefs.set('menu_layout', layout, {rejectable: true}), true);
  assert.equal(prefs.get('menu_layout'), layout);
  await prefs.flush();
  assert.deepEqual(stored, {menu_layout: layout});
  reject = true;
  prefs.set('home_cards', ['tasks'], {rejectable: true});
  await prefs.flush();
  assert.equal(prefs.get('home_cards'), undefined, '거절된 칸은 서버가 아는 값으로');
  assert.ok(heard.some(h => h.startsWith('kptu:view-prefs-rejected') && h.includes('home_cards')));
  assert.deepEqual(prefs.get('menu_layout'), layout, '다른 칸은 그대로');
  assert.equal(prefs.set('menu_layout', {bar: 'x', rest: []}), false, '틀린 모양은 보내지 않는다');
  delete globalThis.window; delete globalThis.CustomEvent;
});
test('새 코드는 서버 저장만 쓴다(이 기기에만 남는 저장 없음)', () => {
  const banned = new RegExp(['local' + 'Storage', 'session' + 'Storage', 'indexed' + 'DB', 'document\\.' + 'cookie'].join('|'));
  for (const file of ['menu-model.mjs', 'menu-layout.js', 'menu-edit.js', 'reorder-drag.js', 'home-cards-model.mjs', 'home-edit.js', 'home-extra.js']) assert.doesNotMatch(read('app/' + file), banned, file);
});
test('메뉴 목록은 한 곳(menu-model.mjs)에서 정의하고 폰 하단바·[메뉴] 창·PC 왼쪽 메뉴가 읽는다', () => {
  assert.match(read('app/menu-layout.js'), /from '\.\/menu-model\.mjs'/);
  assert.match(read('app/topbar-actions.js'), /from '\.\/menu-model\.mjs'/);
  assert.match(read('app/mobile-tab-selection.mjs'), /from '\.\/menu-model\.mjs'/);
  assert.match(read('app/menu-edit.js'), /from '\.\/menu-model\.mjs'/);
  assert.match(read('app/index.html'), /id="menuEditModal"/);
});
