// SEC-기능PIN잠금 ②: 기능별 PIN 잠금의 문지기(화면 그리기 없음). 설계 docs/design/feature-pin-lock.md.
// 잠금은 화면 가림(편의 장치)이다 — 자료 접근 권한은 서버 owner 경계 그대로. PIN 대조·횟수는 서버(app_lock_*)만 한다.
// 이 모듈은 '지금 이 화면을 열어도 되나'만 답한다. 라우터 go()와 화면 불러오기(view-loader load)가 화면 프로그램을 받기 전에 묻고,
// 잠겼으면 잠금 화면(?view=lock, lock-ui.js가 유일한 renderer)으로 보낸다 — 잠긴 화면의 자료는 불러오지도 그리지도 않는다.
// 풀림 상태·설정은 이 탭 메모리에만 둔다(새로고침·앱 다시 열기 = 다시 잠김). 브라우저 저장소에 PIN·풀림 상태를 두지 않는다.
const LOCKABLE = { diary: 'diary', photos: 'photos', calls: 'calls', telegram: 'telegram' };
export const FEATURE_NAMES = { diary: '하루 기록', photos: '사진', calls: '통화', telegram: '텔레그램 소식' };
export const RELOCK = [['now', '바로'], ['5m', '5분'], ['30m', '30분'], ['close', '앱 닫을 때']];
const RELOCK_MS = { '5m': 5 * 60 * 1000, '30m': 30 * 60 * 1000 };

const NONE = Object.freeze({ has_pin: false, features: [], relock: '5m', left: 5, blocked_until: null });
const state = { settings: null, reading: null, failed: false, open: false, leftAt: null, pending: null };
const changed = () => window.dispatchEvent(new CustomEvent('kptu:feature-lock-changed'));
const clean = value => value && typeof value === 'object' && typeof value.has_pin === 'boolean' && Array.isArray(value.features)
  ? { has_pin: value.has_pin, features: value.features.filter(f => LOCKABLE[f]), relock: RELOCK.some(([k]) => k === value.relock) ? value.relock : '5m',
      left: Number.isInteger(value.left) ? value.left : 5, blocked_until: typeof value.blocked_until === 'string' ? value.blocked_until : null }
  : null;

// 설정 읽기(서버). 연결 실패·서버 오류면 settings는 null로 남고 잠글 수 있는 화면은 닫힌 채(잠금 화면이 [다시]를 보인다).
export function refresh() {
  if (state.reading) return state.reading;
  // 읽기는 GET(stable 함수) — 쓰기 요청과 섞이지 않게(app_my_features와 같은 방식).
  state.reading = window.KPTURuntime.api('/rest/v1/rpc/app_lock_read', { singleFlight: false }).then(value => {
    // 답 모양이 다르면(서버 함수가 아직 없거나 바뀜) 잠금 없음으로 본다 — 잠금은 화면 가림이고 자료 경계는 서버가 지킨다.
    state.settings = clean(value) || NONE; state.failed = false;
    return state.settings;
  }).catch(error => {
    const status = Number(error?.status) || 0;
    // 함수가 없다(404)·요청 모양 거절(4xx, 로그인 만료 401 제외)이면 잠금 없음. 연결 실패·서버 오류는 모른 채 두어 잠근 화면을 닫아 둔다([다시]).
    if (status >= 400 && status < 500 && status !== 401) { state.settings = NONE; state.failed = false; }
    else state.failed = true;
    console.warn('feature lock read', status || error?.code || 'error');
    return state.settings;
  })
    .finally(() => { state.reading = null; changed(); });
  return state.reading;
}
export const ready = () => state.settings ? Promise.resolve(state.settings) : refresh();
export const settings = () => state.settings;
export const readFailed = () => state.failed && !state.settings;
export const featureOf = view => LOCKABLE[view] || null;
export const isLockable = view => !!LOCKABLE[view];

function expire() {
  if (!state.open || !state.settings) return;
  const { relock } = state.settings;
  if (state.leftAt === null) return;
  if (relock === 'now' || (RELOCK_MS[relock] && Date.now() - state.leftAt >= RELOCK_MS[relock])) {
    state.open = false; state.leftAt = null; changed();
  }
}
// 이 기능이 지금 가려져야 하나. 설정을 아직 모르면(읽는 중·실패) 가린다.
export function hides(feature) {
  if (!feature) return false;
  if (!state.settings) return true;
  if (!state.settings.features.includes(feature)) return false;
  expire();
  return !state.open;
}
export const locked = view => isLockable(view) && hides(LOCKABLE[view]);
// 잠금이 켜진 기능만(설정을 아직 모르면 null) — 다른 화면 미리보기가 '잠김' 한 줄을 쓸지 정할 때.
export const anyHidden = (...features) => features.some(f => hides(f));

// 라우터 go()가 화면 프로그램을 받기 전에 부른다. 잠겼으면 잠금 화면으로 보내고 true(라우터는 그 이동을 멈춘다).
export function guard(view, { source = 'api', sub = null } = {}) {
  if (!locked(view)) return false;
  state.pending = { view, sub };
  window.KPTURouter?.go?.('lock', { source: 'api', replaceUrl: source === 'popstate' || source === 'startup' || source === 'restore' });
  return true;
}
export const pending = () => state.pending;
export const clearPending = () => { state.pending = null; };

// 서버가 맞다고 한 뒤에만 부른다. 잠근 기능 모두 함께 풀린다(PIN 하나).
export function markOpen({ thenGo = true } = {}) {
  state.open = true; state.leftAt = null;
  const target = state.pending; state.pending = null;
  changed();
  if (thenGo && target) window.KPTURouter?.go?.(target.view, { source: 'api', replaceUrl: true, ...(target.sub ? { sub: target.sub } : {}) });
}
// 잠금 설정 화면에서 PIN을 확인하고 바꾼 뒤: 서버가 돌려준 설정으로 바꾸고, 방금 PIN을 넣었으니 풀린 채(그 화면을 떠난 때부터 다시 잠그기 시간).
export function applySaved(next) {
  if (next && Array.isArray(next.features)) {
    state.settings = { ...(state.settings || { has_pin: true, left: 5, blocked_until: null }), has_pin: true,
      features: next.features.filter(f => LOCKABLE[f]), relock: next.relock || state.settings?.relock || '5m', left: 5, blocked_until: null };
  }
  state.open = true; state.leftAt = Date.now();
  changed();
}
export function noteBlocked(result) {
  if (!state.settings || !result) return;
  state.settings = { ...state.settings, left: Number.isInteger(result.left) ? result.left : state.settings.left,
    blocked_until: typeof result.blocked_until === 'string' ? result.blocked_until : null };
}

// 잠근 화면을 떠난 시각을 적고, '바로'면 곧바로 잠근다.
window.addEventListener('kptu:view-changed', event => {
  const view = event.detail?.view;
  if (!state.settings) return;
  if (isLockable(view) && state.settings.features.includes(LOCKABLE[view]) && state.open) { state.leftAt = null; return; }
  if (view === 'lock') return;
  if (state.open && state.leftAt === null) { state.leftAt = Date.now(); expire(); }
});
// 다른 앱으로 가거나 앱을 닫으면(화면이 숨겨지면) '앱 닫을 때'는 바로 잠그고, 나머지는 그때부터 시간을 잰다.
// 잠근 화면을 보고 있었는데 잠기면, 그 화면에서 잠금 화면으로 바로 옮긴다(최근 앱 목록 미리보기에도 자료가 남지 않게).
function relockCurrent() {
  const view = window.KPTURouter?.current;
  if (locked(view)) guard(view, { source: 'api' });
}
document.addEventListener('visibilitychange', () => {
  if (!state.settings || !state.open) { if (document.visibilityState === 'hidden') relockCurrent(); return; }
  const view = window.KPTURouter?.current;
  const onLocked = isLockable(view) && state.settings.features.includes(LOCKABLE[view]);
  if (document.visibilityState === 'hidden') {
    if (state.settings.relock === 'close' || state.settings.relock === 'now') { state.open = false; state.leftAt = null; changed(); }
    else if (onLocked) state.leftAt = Date.now();
    relockCurrent();
  } else {
    expire();
    if (onLocked && !state.open) relockCurrent();
    else if (onLocked) state.leftAt = null;
  }
});
// 'kptu:session-changed'는 같은 사람의 로그인 이어 가기(토큰 새로 받기)에도 온다. 로그인한 사람이 바뀌거나 나갔을 때만 모두 지우고 잠근다.
const ownerNow = () => window.KPTURuntime?.session?.read?.()?.user?.id || '';
let owner = ownerNow();
window.addEventListener('kptu:session-changed', () => {
  const next = ownerNow();
  if (next && next === owner) return;
  owner = next;
  Object.assign(state, { settings: null, failed: false, open: false, leftAt: null, pending: null });
  changed();
});

window.KPTUFeatureLock = { refresh, ready, settings, readFailed, featureOf, isLockable, hides, locked, anyHidden, guard, pending, clearPending,
  markOpen, applySaved, noteBlocked, FEATURE_NAMES, RELOCK };
