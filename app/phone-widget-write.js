// WIDGET-여러개 ①: 폰 앱 홈 위젯 [업데이트]·[할 일]·[노트] 칸이 여는 쓰기 창.
// 폰 앱(KPTUAndroid)에서만 붙는다. 웹 브라우저에서는 아무것도 하지 않는다.
// 1) 앱이 웹2를 새로 열 때는 주소 ?write=<종류>로 온다. 읽은 뒤 주소에서 지운다(새로고침해도 다시 열리지 않게).
// 2) 웹2가 이미 떠 있으면 앱이 다리(KPTUAppShell, 허용 Origin의 최상위 화면에만 보임)로 'write:open:<종류>'를 보낸다
//    (화면을 다시 불러오지 않아 쓰던 글이 사라지지 않는다). 이 화면은 붙을 때 'write:hello'로 받을 준비를 알린다.
// 창은 상단 [+ 추가]와 같은 것(topbar-actions.js의 KPTUQuickWrite)이고 저장 길도 그대로다. 앱은 토큰·글을 보지 않는다.
// WIDGET-여러개 ②: 이번 주 위젯 줄은 달력의 그 날(?view=calendar&day=YYYY-MM-DD 또는 다리 'day:open:YYYY-MM-DD').
//   달력 화면의 기존 '그 날로 옮기기'(calendar-view.js showDay, 업무일지 [달력 ›]와 같은 길)를 쓴다.
// WIDGET-여러개 ③: 텔레그램 위젯 줄은 그 방·그 날(?view=telegram&tg_room=&tg_day= 또는 다리 'tg:open:YYYY-MM-DD:<방 번호>').
//   텔레그램 화면의 기존 열기(KPTUTelegramFeed.show, 사람·챙길 것 줄과 같은 길)를 쓴다. 운영자 아닌 화면은 서버가 내용을 주지 않는다.
const BRIDGE = 'KPTUAppShell';
const KINDS = ['update', 'task', 'note'];
const OPEN = /^write:open:([a-z]{1,16})$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_OPEN = /^day:open:(\d{4}-\d{2}-\d{2})$/;
const ROOM = /^[A-Za-z0-9_.:-]{1,100}$/;
const TG_OPEN = /^tg:open:(\d{4}-\d{2}-\d{2}):([A-Za-z0-9_.:-]{1,100})$/;

/** 허용된 종류만 돌려준다. */
export function writeKind(value) {
  return KINDS.includes(value) ? value : null;
}

/** 앱이 보낸 글에서 종류를 꺼낸다. 모양이 다르면 null. */
export function bridgeKind(data) {
  const m = OPEN.exec(typeof data === 'string' ? data : '');
  return m ? writeKind(m[1]) : null;
}

/** yyyy-mm-dd 모양의 실제 날짜만. */
export function dayValue(value) {
  if (typeof value !== 'string' || !DAY.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? value : null;
}

export function bridgeDay(data) {
  const m = DAY_OPEN.exec(typeof data === 'string' ? data : '');
  return m ? dayValue(m[1]) : null;
}

/** 텔레그램 방 번호(수집 서버와 같은 모양)만. */
export function roomValue(value) {
  return typeof value === 'string' && ROOM.test(value) ? value : null;
}

export function bridgeRoom(data) {
  const m = TG_OPEN.exec(typeof data === 'string' ? data : '');
  const day = m ? dayValue(m[1]) : null;
  return day ? {day, room:m[2]} : null;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function startWidgetWrite(win = window, {wait = sleep, tries = 100} = {}) {
  if (win.__KPTU_WIDGET_WRITE__) return false;
  if (!/KPTUAndroid/i.test(win.navigator?.userAgent || '')) return false;
  win.__KPTU_WIDGET_WRITE__ = true;
  let busy = false;
  // 첫 화면·로그인 확인이 끝나기 전에 오면(앱을 막 연 경우) 작업공간이 준비될 때까지 기다린다(최대 약 10초).
  async function open(kind) {
    if (busy) return;
    busy = true;
    try {
      for (let i = 0; i < tries && !(win.KPTUQuickWrite && win.__KPTU_TEAM_READY_STATE__ === 'workspace'); i++) await wait(100);
      if (win.KPTUQuickWrite && win.__KPTU_TEAM_READY_STATE__ === 'workspace') await win.KPTUQuickWrite.open(kind);
    } catch { /* 창을 열지 못하면 [+ 추가]의 안내 줄이 알린다. */ }
    finally { busy = false; }
  }
  async function openDay(day) {
    try {
      for (let i = 0; i < tries && win.__KPTU_TEAM_READY_STATE__ !== 'workspace'; i++) await wait(100);
      if (win.__KPTU_TEAM_READY_STATE__ !== 'workspace') return;
      await win.KPTUViewLoader?.load?.('calendar');
      if (win.KPTURouter?.current !== 'calendar') await win.KPTURouter?.go?.('calendar', {source: 'delegated'});
      for (let i = 0; i < tries && !win.KPTUCalendarView?.showDay; i++) await wait(100);
      win.KPTUCalendarView?.showDay?.(day);
    } catch { /* 달력은 열린 채로 둔다. */ }
  }
  async function openRoom({room, day}) {
    try {
      for (let i = 0; i < tries && win.__KPTU_TEAM_READY_STATE__ !== 'workspace'; i++) await wait(100);
      if (win.__KPTU_TEAM_READY_STATE__ !== 'workspace') return;
      await win.KPTUViewLoader?.load?.('telegram');
      if (win.KPTURouter?.current !== 'telegram') await win.KPTURouter?.go?.('telegram', {source: 'delegated'});
      for (let i = 0; i < tries && !win.KPTUTelegramFeed?.show; i++) await wait(100);
      await win.KPTUTelegramFeed?.show?.(room, day);
    } catch { /* 텔레그램 화면은 열린 채로 둔다. */ }
  }
  try {
    const url = new URL(win.location.href);
    if (url.searchParams.has('write')) {
      const kind = writeKind(url.searchParams.get('write'));
      url.searchParams.delete('write');
      win.history.replaceState(win.history.state, '', url);
      if (kind) void open(kind);
    }
    if (url.searchParams.has('day')) {
      const day = dayValue(url.searchParams.get('day'));
      url.searchParams.delete('day');
      win.history.replaceState(win.history.state, '', url);
      if (day) void openDay(day);
    }
    if (url.searchParams.has('tg_room') || url.searchParams.has('tg_day')) {
      const room = roomValue(url.searchParams.get('tg_room')), day = dayValue(url.searchParams.get('tg_day'));
      url.searchParams.delete('tg_room'); url.searchParams.delete('tg_day');
      win.history.replaceState(win.history.state, '', url);
      if (room && day) void openRoom({room, day});
    }
  } catch { /* 주소를 못 읽어도 다리 길은 그대로 쓴다. */ }
  const bridge = win[BRIDGE];
  if (bridge && typeof bridge.postMessage === 'function' && typeof bridge.addEventListener === 'function') {
    bridge.addEventListener('message', event => {
      const kind = bridgeKind(event?.data); if (kind) { void open(kind); return; }
      const day = bridgeDay(event?.data); if (day) { void openDay(day); return; }
      const room = bridgeRoom(event?.data); if (room) void openRoom(room);
    });
    try { bridge.postMessage('write:hello'); } catch { /* 다리가 사라진 화면 */ }
  }
  return true;
}

if (typeof window !== 'undefined' && window.document) startWidgetWrite();
