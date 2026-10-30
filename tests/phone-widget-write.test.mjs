// WIDGET-여러개 ①: 폰 앱 홈 위젯 쓰기 칸이 여는 창(app/phone-widget-write.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {writeKind, bridgeKind, startWidgetWrite} from '../app/phone-widget-write.js';

function setup({ua = 'Mozilla/5.0 KPTUAndroid/0.3.4', href = 'https://bokdoong.com/work/app/', ready = 'workspace', bridge = true} = {}) {
  const sent = [], opened = [], replaced = [];
  let onMessage = null;
  const win = {
    navigator: {userAgent: ua},
    location: {href},
    history: {state: {a: 1}, replaceState: (state, title, url) => replaced.push(String(url))},
    __KPTU_TEAM_READY_STATE__: ready,
    KPTUQuickWrite: {open: kind => { opened.push(kind); return Promise.resolve(); }},
  };
  if (bridge) win.KPTUAppShell = {postMessage: m => sent.push(m), addEventListener: (t, fn) => { if (t === 'message') onMessage = fn; }};
  return {win, sent, opened, replaced, message: data => onMessage?.({data})};
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('종류는 업데이트·할 일·노트 셋만', () => {
  assert.equal(writeKind('update'), 'update');
  assert.equal(writeKind('task'), 'task');
  assert.equal(writeKind('note'), 'note');
  assert.equal(writeKind('photo'), null);
  assert.equal(writeKind(''), null);
  assert.equal(bridgeKind('write:open:note'), 'note');
  assert.equal(bridgeKind('write:open:delete'), null);
  assert.equal(bridgeKind('write:open:note '), null);
  assert.equal(bridgeKind({}), null);
});

test('웹 브라우저에서는 아무것도 하지 않는다', () => {
  const s = setup({ua: 'Mozilla/5.0 Chrome', href: 'https://bokdoong.com/work/app/?write=task'});
  assert.equal(startWidgetWrite(s.win), false);
  assert.deepEqual(s.sent, []);
  assert.deepEqual(s.replaced, []);
});

test('주소 ?write=는 한 번 읽고 지운 뒤 같은 창을 연다', async () => {
  const s = setup({href: 'https://bokdoong.com/work/app/?view=home&write=task'});
  assert.equal(startWidgetWrite(s.win, {wait: tick}), true);
  await tick(); await tick();
  assert.deepEqual(s.opened, ['task']);
  assert.deepEqual(s.replaced, ['https://bokdoong.com/work/app/?view=home']);
  assert.deepEqual(s.sent, ['write:hello']);
  assert.equal(startWidgetWrite(s.win), false, '두 번 붙지 않는다');
});

test('모르는 종류는 주소만 지우고 열지 않는다', async () => {
  const s = setup({href: 'https://bokdoong.com/work/app/?write=evil'});
  startWidgetWrite(s.win, {wait: tick});
  await tick();
  assert.deepEqual(s.opened, []);
  assert.deepEqual(s.replaced, ['https://bokdoong.com/work/app/']);
});

test('떠 있는 화면은 다리 write:open으로 연다(다시 불러오지 않음)', async () => {
  const s = setup();
  startWidgetWrite(s.win, {wait: tick});
  s.message('write:open:note');
  await tick();
  s.message('share:list:{}');
  s.message('write:open:photo');
  await tick();
  assert.deepEqual(s.opened, ['note']);
});

test('작업공간이 준비될 때까지 기다렸다 연다', async () => {
  const s = setup({href: 'https://bokdoong.com/work/app/?write=update', ready: 'loading'});
  startWidgetWrite(s.win, {wait: async () => { s.win.__KPTU_TEAM_READY_STATE__ = 'workspace'; }});
  await tick(); await tick();
  assert.deepEqual(s.opened, ['update']);
});

test('준비되지 않으면(로그인 안 됨) 열지 않는다', async () => {
  const s = setup({href: 'https://bokdoong.com/work/app/?write=update', ready: 'auth'});
  startWidgetWrite(s.win, {wait: tick, tries: 3});
  for (let i = 0; i < 6; i++) await tick();
  assert.deepEqual(s.opened, []);
});

test('창은 상단 [+ 추가]의 열기 길을 쓰고 로더는 앱에서만 붙인다', () => {
  const topbar = readFileSync(new URL('../app/topbar-actions.js', import.meta.url), 'utf8');
  assert.match(topbar, /window\.KPTUQuickWrite=\{open\(kind\)\{\n  if\(kind==='update'\|\|kind==='note'\)return openWriter\(kind\);\n  if\(kind==='task'\)return openEventWindow\(true\);/);
  const loader = readFileSync(new URL('../app/loader-v2.js', import.meta.url), 'utf8');
  assert.match(loader, /if\(\/KPTUAndroid\/i\.test\(navigator\.userAgent\|\|''\)\)import\('\.\/phone-widget-write\.js'\)/);
});

// WIDGET-여러개 ②: 이번 주 위젯 줄 → 달력의 그 날.
import {dayValue, bridgeDay} from '../app/phone-widget-write.js';

function calendarSetup(href) {
  const s = setup({href});
  const calls = [];
  s.win.KPTUViewLoader = {load: async view => { calls.push('load:' + view); }};
  s.win.KPTURouter = {current: 'home', go: async view => { calls.push('go:' + view); s.win.KPTURouter.current = view; }};
  s.win.KPTUCalendarView = {showDay: day => calls.push('day:' + day)};
  return {...s, calls};
}

test('날짜는 yyyy-mm-dd 실제 날짜만', () => {
  assert.equal(dayValue('2026-10-30'), '2026-10-30');
  assert.equal(dayValue('2026-02-30'), null);
  assert.equal(dayValue('2026-1-3'), null);
  assert.equal(dayValue('x'), null);
  assert.equal(bridgeDay('day:open:2026-11-01'), '2026-11-01');
  assert.equal(bridgeDay('day:open:2026-13-01'), null);
  assert.equal(bridgeDay('day:open:2026-11-01&x'), null);
});

test('주소 ?day=는 지우고 달력의 그 날로 옮긴다', async () => {
  const s = calendarSetup('https://bokdoong.com/work/app/?view=calendar&day=2026-10-31');
  startWidgetWrite(s.win, {wait: tick});
  for (let i = 0; i < 6; i++) await tick();
  assert.deepEqual(s.replaced, ['https://bokdoong.com/work/app/?view=calendar']);
  assert.deepEqual(s.calls, ['load:calendar', 'go:calendar', 'day:2026-10-31']);
  assert.deepEqual(s.opened, []);
});

test('떠 있는 화면은 다리 day:open으로 옮긴다', async () => {
  const s = calendarSetup('https://bokdoong.com/work/app/');
  startWidgetWrite(s.win, {wait: tick});
  s.message('day:open:2026-11-02');
  for (let i = 0; i < 6; i++) await tick();
  s.message('day:open:2026-11-31');
  for (let i = 0; i < 6; i++) await tick();
  assert.deepEqual(s.calls, ['load:calendar', 'go:calendar', 'day:2026-11-02']);
});

// WIDGET-여러개 ③: 텔레그램 위젯 줄 → 그 방·그 날.
import {roomValue, bridgeRoom} from '../app/phone-widget-write.js';

function telegramSetup(href) {
  const s = setup({href});
  const calls = [];
  s.win.KPTUViewLoader = {load: async view => { calls.push('load:' + view); }};
  s.win.KPTURouter = {current: 'home', go: async view => { calls.push('go:' + view); s.win.KPTURouter.current = view; }};
  s.win.KPTUTelegramFeed = {show: async (room, day) => { calls.push('show:' + room + '@' + day); return true; }};
  return {...s, calls};
}

test('방 번호·다리 글은 정해진 모양만', () => {
  assert.equal(roomValue('-1001234:abc_1.x'), '-1001234:abc_1.x');
  assert.equal(roomValue('a b'), null);
  assert.equal(roomValue(''), null);
  assert.deepEqual(bridgeRoom('tg:open:2026-10-30:-100123'), {day: '2026-10-30', room: '-100123'});
  assert.equal(bridgeRoom('tg:open:2026-10-32:-100123'), null);
  assert.equal(bridgeRoom('tg:open:2026-10-30:<x>'), null);
});

test('주소 tg_room·tg_day는 지우고 텔레그램 그 방을 연다', async () => {
  const s = telegramSetup('https://bokdoong.com/work/app/?view=telegram&tg_room=-100123&tg_day=2026-10-30');
  startWidgetWrite(s.win, {wait: tick});
  for (let i = 0; i < 8; i++) await tick();
  assert.deepEqual(s.replaced, ['https://bokdoong.com/work/app/?view=telegram']);
  assert.deepEqual(s.calls, ['load:telegram', 'go:telegram', 'show:-100123@2026-10-30']);
});

test('떠 있는 화면은 다리 tg:open으로 연다', async () => {
  const s = telegramSetup('https://bokdoong.com/work/app/');
  startWidgetWrite(s.win, {wait: tick});
  s.message('tg:open:2026-10-29:room.1');
  for (let i = 0; i < 8; i++) await tick();
  assert.deepEqual(s.calls, ['load:telegram', 'go:telegram', 'show:room.1@2026-10-29']);
});
