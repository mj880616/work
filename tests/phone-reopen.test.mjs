// APP-다시열림: 폰 앱이 웹2 화면을 통째로 다시 열지 않고 자리만 옮기는 길(app/phone-reopen.js)과 '다시 연 기록'.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {navTarget, parseReopenList, entryText, startReopen, mountReopenLog, KIND_LABEL} from '../app/phone-reopen.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('알아듣는 주소만 화면 안 이동으로 받는다', () => {
  assert.deepEqual(navTarget(''), {view: 'home', sub: null});
  assert.deepEqual(navTarget('?view=calendar'), {view: 'calendar', sub: null});
  assert.deepEqual(navTarget('?view=basket&pane=note'), {view: 'basket', sub: 'note'});
  assert.equal(navTarget('?view=basket&share=abc'), null, '공유 받기 같은 다른 질의는 통째로 연다');
  assert.equal(navTarget('?write=task'), null);
  assert.equal(navTarget('?project=1'), null);
  assert.equal(navTarget('?pane=note'), null, '화면 없는 pane');
  assert.equal(navTarget('?view=a&view=b'), null);
  assert.equal(navTarget("?view=x');alert(1)//"), null);
  assert.equal(navTarget('?view=Calendar'), null);
  assert.equal(navTarget(null), null);
  assert.equal(navTarget('view=home'), null, '물음표 없이 오는 글');
});

function routerWin({ready = 'workspace', go} = {}) {
  const calls = [];
  const win = {
    navigator: {userAgent: 'Mozilla/5.0 KPTUAndroid/0.4.5'},
    __KPTU_TEAM_READY_STATE__: ready,
    KPTURouter: {go: go || ((view, opts) => { calls.push([view, opts]); return true; })},
  };
  return {win, calls};
}

test('앱에서만 붙고, 준비된 화면이면 기존 화면 이동으로 옮긴다', () => {
  assert.equal(startReopen({navigator: {userAgent: 'Chrome'}}), false);
  const {win, calls} = routerWin();
  assert.equal(startReopen(win), true);
  assert.equal(startReopen(win), false, '한 번만');
  assert.equal(win.KPTUAppNav.open(''), true);
  assert.equal(win.KPTUAppNav.open('?view=basket&pane=note'), true);
  assert.deepEqual(calls, [['home', {source: 'delegated', sub: null}], ['basket', {source: 'delegated', sub: 'note'}]]);
  assert.equal(win.KPTUAppNav.open('?view=basket&share=abc'), false, '모르는 질의는 앱이 통째로 연다');
  assert.equal(calls.length, 2);
});

test('화면이 아직 준비 전이거나 이동이 안 되면 false(앱이 통째로 연다)', () => {
  const pending = routerWin({ready: 'pending'});
  startReopen(pending.win);
  assert.equal(pending.win.KPTUAppNav.open(''), false);
  assert.equal(pending.calls.length, 0);
  const refused = routerWin({go: () => false});
  startReopen(refused.win);
  assert.equal(refused.win.KPTUAppNav.open('?view=calendar'), false);
  const thrown = routerWin({go: () => { throw new Error('x'); }});
  startReopen(thrown.win);
  assert.equal(thrown.win.KPTUAppNav.open('?view=calendar'), false);
  const loading = routerWin({go: () => false});
  loading.win.KPTUViewLoader = {isLoaded: () => false};
  startReopen(loading.win);
  assert.equal(loading.win.KPTUAppNav.open('?view=calendar'), true, '아직 받지 않은 화면은 받은 뒤 그 자리로 옮긴다');
  // 쓰던 글 확인에서 멈추면 그 자리에 그대로 둔다(통째로 다시 열지 않음).
  const listeners = {};
  const held = routerWin({go: () => { const e = {defaultPrevented: true}; listeners['kptu:before-view-change']?.(e); return false; }});
  Object.assign(held.win, {addEventListener: (t, fn) => { listeners[t] = fn; }, removeEventListener: t => { delete listeners[t]; }, KPTUViewLoader: {isLoaded: () => true}});
  startReopen(held.win);
  assert.equal(held.win.KPTUAppNav.open('?view=calendar'), true);
  assert.equal(listeners['kptu:before-view-change'], undefined, '지켜보기는 부름이 끝나면 뗀다');
  const lazy = routerWin({go: () => Promise.resolve(true)});
  startReopen(lazy.win);
  assert.equal(lazy.win.KPTUAppNav.open('?view=calendar'), true, '불러오는 중인 화면도 그 자리에서 연다');
});

test('다시 연 기록 글: 종류·시각만, 모르는 종류는 버리고 새것이 위', () => {
  assert.equal(parseReopenList('push:on:x'), null);
  assert.deepEqual(parseReopenList('reopen:list:'), []);
  const list = parseReopenList('reopen:list:start@1761955200000,bogus@1761955201000,web@1761955202000,pull@x');
  assert.deepEqual(list, [{kind: 'web', at: 1761955202000}, {kind: 'start', at: 1761955200000}]);
  assert.match(entryText(list[0]), /^\d{2}\/\d{2} \d{2}:\d{2}:\d{2} · 화면이 스스로 다시 엶$/);
  // 앱(ReopenRules.kt)이 쓰는 종류는 모두 화면 말이 있다.
  const kt = read('../android-app/app/src/main/java/kr/or/kptu/work/ReopenRules.kt');
  const kinds = [...kt.matchAll(/^\s+"([a-z]+)",\s+\/\//gm)].map(m => m[1]);
  assert.ok(kinds.length >= 10);
  for (const kind of [...kinds, 'web', 'login']) assert.ok(kind in KIND_LABEL, kind);
});

test('다시 연 기록 칸: 앱에서만, 펼칠 때 묻고 답을 그린다', () => {
  assert.equal(mountReopenLog({}, {navigator: {userAgent: 'Chrome'}}), null);
  const sent = [], listeners = [];
  const items = [];
  const list = {replaceChildren: (...xs) => { items.splice(0, items.length, ...xs.map(x => x.textContent)); }, set innerHTML(v) { items.splice(0, items.length, v); }};
  let toggle = null;
  const details = {addEventListener: (t, fn) => { toggle = fn; }};
  const host = {set innerHTML(v) { this.html = v; }, querySelector: sel => (sel === 'details' ? details : list)};
  const win = {
    navigator: {userAgent: 'KPTUAndroid/0.4.5'},
    document: {createElement: () => ({textContent: ''})},
    KPTUAppShell: {postMessage: m => sent.push(m), addEventListener: (t, fn) => listeners.push(fn)},
  };
  assert.ok(mountReopenLog(host, win));
  assert.match(host.html, /<details class="ps-reopen">/);
  assert.deepEqual(sent, [], '접힌 채로는 묻지 않는다');
  toggle({target: {open: true}});
  assert.deepEqual(sent, ['reopen:list']);
  listeners.forEach(fn => fn({data: 'reopen:list:restore@1761955200000'}));
  assert.equal(items.length, 1);
  assert.match(items[0], /밖에서 꺼졌다 복원$/);
});

test('웹이 스스로 다시 열 때는 까닭을 앱에 먼저 알린다(로그인 확인·잠금 순서는 그대로)', () => {
  const loader = read('../app/loader-v2.js');
  assert.match(loader, /if\(next&&nextOwner\)\{markReopen\('session'\);location\.reload\(\)\}/);
  assert.match(loader, /markReopen\('bfcache'\);\n\s+location\.reload\(\);/);
  // 같은 사람의 토큰 갱신은 다시 열지 않는다(기존 동작 유지).
  assert.match(loader, /if\(next&&nextOwner&&nextOwner===bootOwner\)return;\n\s+lockPrivateUi\(\);/);
  assert.match(loader, /if\(\/KPTUAndroid\/i\.test\(navigator\.userAgent\|\|''\)\)import\('\.\/phone-reopen\.js'\)/);
  // 조용한 시작 줄은 로그인 확인이 끝난 뒤, 같은 첫 화면 칸에만 붙는다.
  const shown = loader.indexOf("bootView.classList.add('boot-quiet')"), checked = loader.indexOf("startup?.mark('sessionCheckComplete'");
  assert.ok(checked > 0 && shown > checked);
  assert.match(read('../app/version-notice.js'), /if\(!allowReload\(\)\)return;try\{window\.KPTUAppShell\?\.postMessage\?\.\('reopen:mark:version'\)\}catch\{\}location\.reload\(\)/);
  const team = read('../app/team.js');
  assert.match(team, /view\.classList\.remove\('boot-quiet'\);/, '오류면 큰 카드로 되돌려 [다시 시도]·[로그아웃]을 보인다');
  assert.match(team, /reopen:mark:retry/);
});
