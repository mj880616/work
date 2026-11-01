// UI-앱안알림 4단계(docs/design/in-app-notices.md 4절 3, 7절 4): 맨 위 알림 줄의 '뒤에서 끝난 일' 손님(예: 다음 주 준비 한 장).
// 자리·높이는 notice-bar.js가 맡고, 이 파일은 이 줄들의 상태 주인이자 유일한 렌더러다.
// - 재료: 서버 phone-push `notices`(폰 알림과 같은 '보낼 일' 목록, supabase/functions/phone-push/done-items.ts). 무엇을 띄울지·열었는지는
//   서버 기록(app_push_log)이 정한다 — 폰·PC가 같다. 이 기기에는 아무것도 저장하지 않는다.
// - [열기]: 서버에 '열었음'(opened)을 남기고 그 자리로 화면 안 이동. ✕: '확인함'으로 같은 '열었음'(한 번 보면 끝, 다른 기기에서도 안 뜸).
// - 폰 알림이나 알림 줄 주소로 들어오면(주소의 notice=종류.열쇠) 열자마자 '열었음'을 남기고 그 표시만 주소에서 지운다.
// - 다시 묻기: 시작할 때 한 번, 화면이 다시 보일 때 10분에 한 번까지. 로그인한 사람이 바뀌면 멈춘다.
// phone-push를 부르는 곳은 phone-push-settings.js 하나라 그 callPush를 빌려 쓴다('Notification boundary check').
import {putNotice, removeNotice} from './notice-bar.js';
import {callPush} from './phone-push-settings.js';
import {NOTICE_TEXT, noticeItems, noticeParam} from './phone-push-model.mjs';
import {goPlace} from './notice-place.js';

const ICON = '<svg class="kptu-notice-line-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5 8 14.5 16 6"/></svg>';
const PRIORITY = 30; // 4절 표: 연결 끊김 10 · 수집 멈춤 20 · 뒤에서 끝난 일 30 · 업데이트 40
const AGAIN_MS = 10 * 60 * 1000;
const keyOf = item => `done:${item.kind}.${item.ref_key}`;

export function startDoneNotices({rt = window.KPTURuntime, win = window} = {}) {
  if (!rt?.api) return null;
  const lines = new Map(); // key → {item, el}
  let run = 0, lastAsk = 0, stopped = false;

  const opened = item => callPush(rt, 'opened', {kind:item.kind, ref_key:item.ref_key}).catch(() => null);
  function drop(key) { if (lines.has(key)) { lines.delete(key); removeNotice(key); } }
  function line(item) {
    const el = win.document.createElement('aside');
    el.className = 'kptu-notice-line'; el.dataset.notice = 'done'; el.dataset.noticeKind = item.kind; el.setAttribute('aria-label', '끝난 일 안내');
    el.innerHTML = `${ICON}<span role="status"></span><button type="button" class="kptu-notice-line-action" data-notice-act>열기</button><button type="button" class="kptu-notice-line-close" data-notice-close aria-label="닫기">✕</button>`;
    el.querySelector('[role="status"]').textContent = NOTICE_TEXT[item.kind];
    el.querySelector('[data-notice-act]').onclick = () => { drop(keyOf(item)); void opened(item); goPlace(item.open, win); };
    el.querySelector('[data-notice-close]').onclick = () => { drop(keyOf(item)); void opened(item); };
    return el;
  }
  function paint(items) {
    const keep = new Set(items.map(keyOf));
    for (const key of [...lines.keys()]) if (!keep.has(key)) drop(key);
    for (const item of items) {
      const key = keyOf(item);
      if (lines.has(key)) continue;
      const el = line(item);
      lines.set(key, {item, el});
      putNotice(key, {priority:PRIORITY, element:el});
    }
  }
  async function refresh() {
    if (stopped) return;
    const mine = ++run;
    lastAsk = Date.now();
    let out = null;
    try { out = await callPush(rt, 'notices'); } catch { return; } // 못 읽으면 줄을 바꾸지 않는다(아는 것만 보인다)
    if (mine !== run || stopped) return;
    paint(noticeItems(out));
  }

  // 폰 알림·알림 줄 주소로 들어온 경우: '열었음'을 먼저 남기고 표시만 주소에서 지운다(다른 주소 값·기록 상태는 그대로).
  const fromLink = noticeParam(win.location.search);
  const first = fromLink ? opened(fromLink) : Promise.resolve();
  if (fromLink) {
    try {
      const u = new URL(win.location.href); u.searchParams.delete('notice');
      win.history.replaceState(win.history.state, '', u.pathname + u.search + u.hash);
    } catch { /* 주소를 못 고쳐도 알림은 그대로 */ }
  }

  const onVisible = () => { if (win.document.visibilityState === 'visible' && Date.now() - lastAsk >= AGAIN_MS) void refresh(); };
  win.document.addEventListener('visibilitychange', onVisible);
  const owner = rt?.session?.read?.()?.user?.id;
  function sessionChanged(event) {
    if (owner && event.detail?.session?.user?.id === owner) return;
    stopped = true; run++;
    for (const key of [...lines.keys()]) drop(key);
    win.document.removeEventListener('visibilitychange', onVisible);
    win.removeEventListener('kptu:session-changed', sessionChanged);
  }
  win.addEventListener('kptu:session-changed', sessionChanged);
  void first.then(refresh);
  return {refresh};
}
