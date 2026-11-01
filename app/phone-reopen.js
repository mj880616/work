// APP-다시열림(요청함 11/01 13:43): 폰 앱이 웹2 화면을 통째로 다시 여는(첫 화면 '업무 공간을 확인하고 있습니다.'가 다시 뜨는) 일을 줄인다.
// 폰 앱(KPTUAndroid)에서만 붙는다. 웹 브라우저에서는 아무것도 하지 않는다.
// 1) KPTUAppNav.open(질의): 폰 알림·웹2 링크로 들어올 때 앱(MainActivity.openInPlace)이 먼저 이것을 부른다. 화면이 준비돼 있고
//    알아듣는 주소(?view=…&pane=… 또는 빈 주소=홈)면 기존 화면 이동(KPTURouter.go)으로 자리만 옮기고 true. 아니면 false → 앱이 지금처럼 통째로 연다.
//    질의 글 모양은 앱(ShellRules.inPlaceQuery)과 여기에서 두 번 거른다. 로그인 확인·권한은 그대로다(이미 열린 같은 사람 화면 안에서만 옮긴다).
// 2) 다시 연 기록: 앱은 다시 연 까닭을 종류·시각만 앱 메모리에 남긴다(ReopenRules.kt). 프로필의 '다시 연 기록'이 'reopen:list'로 물어 보여 준다.
//    주소·내용·사람 정보는 없다. 기기에도 서버에도 저장하지 않는다(앱을 끄면 비고, 그 다음 첫 줄이 '앱 켬' 또는 '밖에서 꺼졌다 복원').
import {waitInlineHtml} from './wait-state.js';

const BRIDGE = 'KPTUAppShell';
const QUERY = /^(\?[A-Za-z0-9_=&%.-]{0,200})?$/;
const KEYS = new Set(['view', 'pane']);
const NAME = /^[a-z][a-z0-9-]{0,31}$/;

/** 질의 글 → {view, sub} 또는 null(이 길로 옮길 수 없음). 빈 질의는 홈. */
export function navTarget(query) {
  if (typeof query !== 'string' || !QUERY.test(query)) return null;
  let params;
  try { params = new URLSearchParams(query); } catch { return null; }
  for (const key of params.keys()) if (!KEYS.has(key)) return null;
  if (params.getAll('view').length > 1 || params.getAll('pane').length > 1) return null;
  const view = params.get('view') || 'home';
  const sub = params.get('pane');
  if (!NAME.test(view) || (sub !== null && !NAME.test(sub))) return null;
  if (sub !== null && !params.has('view')) return null;
  return {view, sub};
}

/** 앱이 다시 연 까닭(종류) → 화면에 보일 말. */
export const KIND_LABEL = {
  start: '앱 켬',
  restore: '밖에서 꺼졌다 복원',
  recreate: '화면만 다시 만듦',
  engine: '화면 엔진 다시 시작',
  push: '알림으로 열기',
  link: '링크로 열기',
  widget: '위젯으로 열기',
  share: '공유 받기',
  signin: '로그인·연결 복귀',
  login: '로그인 화면으로 감',
  pull: '당겨서 새로고침',
  version: '새 버전 새로고침',
  session: '로그인한 사람 바뀜',
  bfcache: '뒤로 돌아온 화면 확인',
  retry: '[다시 시도]',
  web: '화면이 스스로 다시 엶',
};

const ENTRY = /^([a-z]{1,16})@(\d{10,15})$/;

/** 'reopen:list:<종류>@<ms>,…' → [{kind, at}] (새것이 위). 모양이 다르면 null. */
export function parseReopenList(data) {
  if (typeof data !== 'string' || !data.startsWith('reopen:list:')) return null;
  const body = data.slice('reopen:list:'.length);
  if (!body) return [];
  const out = [];
  for (const part of body.split(',')) {
    const m = ENTRY.exec(part);
    if (!m || !(m[1] in KIND_LABEL)) continue;
    out.push({kind: m[1], at: Number(m[2])});
  }
  return out.reverse();
}

const pad = n => String(n).padStart(2, '0');
export function entryText({kind, at}) {
  const d = new Date(at);
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} · ${KIND_LABEL[kind] || kind}`;
}

export function startReopen(win = window) {
  if (win.__KPTU_PHONE_REOPEN__) return false;
  if (!/KPTUAndroid/i.test(win.navigator?.userAgent || '')) return false;
  win.__KPTU_PHONE_REOPEN__ = true;
  win.KPTUAppNav = {
    open(query) {
      const target = navTarget(query);
      if (!target) return false;
      if (win.__KPTU_TEAM_READY_STATE__ !== 'workspace') return false;
      const router = win.KPTURouter;
      if (typeof router?.go !== 'function') return false;
      // 열린 창·쓰던 글 확인은 화면 이동의 기존 길(kptu:before-view-change)이 맡는다. 거기서 멈추면 그 자리에 그대로 둔다(다시 열지 않음 = true).
      let held = false;
      const watch = event => { if (event.defaultPrevented) held = true; };
      win.addEventListener?.('kptu:before-view-change', watch);
      try {
        if (router.go(target.view, {source: 'delegated', sub: target.sub}) !== false || held) return true;
        // 아직 받지 않은 화면은 받은 뒤 옮긴다(go가 받기를 시작하고 false를 돌려줌).
        const lazy = win.KPTUViewLoader;
        return typeof lazy?.isLoaded === 'function' && !lazy.isLoaded(target.view);
      } catch {
        return false;
      } finally {
        win.removeEventListener?.('kptu:before-view-change', watch);
      }
    },
  };
  return true;
}

/** 프로필의 '다시 연 기록' 칸(폰 앱만). 접힌 채로 두고, 펼칠 때 앱에 묻는다. */
export function mountReopenLog(host, win = window) {
  const bridge = win[BRIDGE];
  if (!host || !/KPTUAndroid/i.test(win.navigator?.userAgent || '') || typeof bridge?.postMessage !== 'function' || typeof bridge?.addEventListener !== 'function') return null;
  host.innerHTML = `<details class="ps-reopen"><summary>다시 연 기록 <span class="ps-reopen-note">(앱이 화면을 처음부터 다시 연 때·까닭)</span></summary><ol class="ps-reopen-list" aria-live="polite"><li>${waitInlineHtml()}</li></ol></details>`;
  const list = host.querySelector('.ps-reopen-list');
  let timer = null;
  const paint = entries => {
    clearTimeout(timer);
    list.replaceChildren(...(entries.length ? entries : [null]).map(entry => {
      const li = win.document.createElement('li');
      li.textContent = entry ? entryText(entry) : '기록 없음';
      return li;
    }));
  };
  bridge.addEventListener('message', event => {
    const entries = parseReopenList(typeof event?.data === 'string' ? event.data : '');
    if (entries) paint(entries);
  });
  const ask = () => {
    clearTimeout(timer);
    try { bridge.postMessage('reopen:list'); } catch { /* 다리가 사라진 화면 */ }
    timer = setTimeout(() => { list.innerHTML = '<li>이 판의 앱은 기록을 주지 않아요(앱 새 판에서 보여요).</li>'; }, 3000);
  };
  host.querySelector('details').addEventListener('toggle', event => { if (event.target.open) ask(); });
  return {ask};
}

if (typeof window !== 'undefined' && window.document) startReopen();
