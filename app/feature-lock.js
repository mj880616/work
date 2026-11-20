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
const state = { settings: null, reading: null, failed: false, open: false, leftAt: null, pending: null, notes: null, held: null };
// 노트 폴더 잠금(S67-14, docs/design/feature-pin-lock.md 7절): 서버가 준 잠근 폴더·덮인 하위 폴더·덮인 맨 위 폴더 이름(메모리만).
const NO_NOTES = Object.freeze({ folders: [], covered: new Set(), topNames: new Set() });
const ids = v => Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
const cleanNotes = value => value && typeof value === 'object' && Array.isArray(value.folders)
  ? { folders: ids(value.folders), covered: new Set([...ids(value.covered), ...ids(value.folders)]), topNames: new Set(ids(value.top_names)) }
  : null;
const quiet = status => status >= 400 && status < 500 && status !== 401;
const changed = () => window.dispatchEvent(new CustomEvent('kptu:feature-lock-changed'));
const clean = value => value && typeof value === 'object' && typeof value.has_pin === 'boolean' && Array.isArray(value.features)
  ? { has_pin: value.has_pin, features: value.features.filter(f => LOCKABLE[f]), relock: RELOCK.some(([k]) => k === value.relock) ? value.relock : '5m',
      left: Number.isInteger(value.left) ? value.left : 5, blocked_until: typeof value.blocked_until === 'string' ? value.blocked_until : null }
  : null;

// 설정 읽기(서버). 연결 실패·서버 오류면 settings는 null로 남고 잠글 수 있는 화면은 닫힌 채(잠금 화면이 [다시]를 보인다).
export function refresh() {
  if (state.reading) return state.reading;
  // 읽기는 GET(stable 함수) — 쓰기 요청과 섞이지 않게(app_my_features와 같은 방식).
  // 노트 폴더 목록도 함께 읽는다(함수가 아직 없으면 404 → 잠근 폴더 없음). 연결 실패면 기능 설정과 같이 모른 채 둔다.
  const notes = window.KPTURuntime.api('/rest/v1/rpc/app_lock_note_folders', { singleFlight: false })
    .then(value => cleanNotes(value) || NO_NOTES)
    .catch(error => { const status = Number(error?.status) || 0; if (quiet(status)) return NO_NOTES; console.warn('note folder lock read', status || error?.code || 'error'); return null; });
  state.reading = Promise.all([window.KPTURuntime.api('/rest/v1/rpc/app_lock_read', { singleFlight: false }), notes]).then(([value, folders]) => {
    state.notes = folders; // null = 이번에 못 읽음(아래 notesHidden이 PIN이 있으면 가린다)
    // 답 모양이 다르면(서버 함수가 아직 없거나 바뀜) 잠금 없음으로 본다 — 잠금은 화면 가림이고 자료 경계는 서버가 지킨다.
    state.settings = clean(value) || NONE; state.failed = false;
    return state.settings;
  }).catch(error => {
    const status = Number(error?.status) || 0;
    // 함수가 없다(404)·요청 모양 거절(4xx, 로그인 만료 401 제외)이면 잠금 없음. 연결 실패·서버 오류는 모른 채 두어 잠근 화면을 닫아 둔다([다시]).
    if (quiet(status)) { state.settings = NONE; state.notes = NO_NOTES; state.failed = false; }
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
    // 알림은 다음 차례에(그리는 도중에 판정하다 잠기면 그 그리기가 끝난 뒤 다시 그리게).
    state.open = false; state.leftAt = null; queueMicrotask(changed);
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

// ── 노트 폴더 잠금 ─────────────────────────────────────────────────────────────────────────
// 잠근 폴더가 있고 지금 풀려 있지 않으면 그 폴더(하위 폴더 포함)의 노트를 가린다. 설정을 아직 모르면(읽는 중·실패) 잠근 폴더도 모르므로,
// 노트를 그리는 화면은 ready()를 기다린 뒤 그린다. PIN 하나라 기능 잠금과 함께 풀리고 같은 '다시 잠그기'로 함께 잠긴다.
export const noteFolderLocks = () => state.notes ? state.notes.folders : null;
export const hasNoteLocks = () => !!state.notes?.folders.length;
export function notesHidden() {
  if (!state.settings) return !state.reading && state.failed;
  // 잠근 폴더 목록을 못 읽었으면: PIN이 없으면 잠근 폴더도 있을 수 없고, PIN이 있으면 모르니 가린다.
  if (!state.notes) { if (!state.settings.has_pin) return false; expire(); return !state.open; }
  if (!state.notes.folders.length) return false;
  expire();
  return !state.open;
}
export const folderCovered = id => !!id && !!state.notes?.covered.has(id);
export const folderLocked = id => !!id && !!state.notes?.folders.includes(id);
// 노트 하나가 지금 가려져야 하나(노트 metadata.folder_id, 없으면 옛 이름 metadata.folder가 맨 위 잠근 폴더 이름과 같은지).
export function noteHidden(note) {
  if (!note || !notesHidden()) return false;
  if (!state.notes) return true;
  const meta = note.metadata && typeof note.metadata === 'object' ? note.metadata : {};
  if (meta.folder_id !== undefined && meta.folder_id !== null) return state.notes.covered.has(meta.folder_id);
  return typeof meta.folder === 'string' && state.notes.topNames.has(meta.folder.trim());
}
// 서버가 잠그기·풀기를 받은 뒤(app_lock_note_folder_set 결과): 목록을 바꾸고, 방금 PIN을 넣었으니 풀린 채.
export function applyNoteFolders(result) {
  const next = cleanNotes(result); if (next) state.notes = next;
  if (state.settings && !state.settings.has_pin) state.settings = { ...state.settings, has_pin: true };
  state.open = true; state.leftAt = Date.now();
  changed();
}
// 잠긴 노트·폴더를 열려 할 때: 잠금 화면 숫자 판으로 보내고, 맞으면 정리함(노트)으로 돌아온다.
// what: { notes: true } = 잠긴 노트 열기, { folder: {id, name, locked} } = 폴더 잠그기(locked true)·잠금 해제(false).
// hold: 열어 둔 노트를 고치던 중 잠겼다 — 쓰던 것은 버리지 않고 정리함 화면째 잠금 화면 뒤에 숨겨 둔다(풀면 그대로 돌아옴).
export function askNotes(what = { notes: true }, { hold = false } = {}) {
  state.pending = { view: 'basket', sub: 'note', ...what, ...(hold ? { hold: true } : {}) };
  if (hold) state.held = 'basket';
  window.KPTURouter?.go?.('lock', { source: 'api', ...(hold ? { hold: true } : {}) });
}
// 잠금 화면이 받은 일이 아직 PIN을 물어야 하나.
export function pendingNeedsPin() {
  const p = state.pending; if (!p) return false;
  if (p.folder) return true;
  if (p.notes) return notesHidden();
  return locked(p.view);
}

// 라우터 go()가 화면 프로그램을 받기 전에 부른다. 잠겼으면 잠금 화면으로 보내고 true(라우터는 그 이동을 멈춘다).
export function guard(view, { source = 'api', sub = null, hold = false } = {}) {
  // 잠금이 쓰던 것을 붙들고 있는 화면(held, 아래 relockCurrent)은 PIN을 풀기 전에는 다른 길(메뉴·뒤로가기)로도 다시 보이지 않게 한다.
  if (!locked(view) && !(state.held === view && heldHidden(view))) { if (state.held === view && !state.pending) state.held = null; return false; }
  hold ||= state.held === view;
  state.pending = { view, sub, ...(hold ? { hold: true } : {}) };
  if (hold) state.held = view;
  window.KPTURouter?.go?.('lock', { source: 'api', replaceUrl: source === 'popstate' || source === 'startup' || source === 'restore', ...(hold ? { hold: true } : {}) });
  return true;
}
export const pending = () => state.pending;
// 잠금 화면에서 [취소]로 그만두면 붙들어 둔 화면도 놓는다(그 화면은 잠긴 것을 다시 보이지 않게 스스로 닫는다).
export const clearPending = () => { state.pending = null; state.held = null; };

// 서버가 맞다고 한 뒤에만 부른다. 잠근 기능 모두 함께 풀린다(PIN 하나).
export function markOpen({ thenGo = true } = {}) {
  state.open = true; state.leftAt = null;
  const target = state.pending; state.pending = null; state.held = null;
  changed();
  if (thenGo && target) window.KPTURouter?.go?.(target.view, { source: 'api', replaceUrl: true, ...(target.sub ? { sub: target.sub } : {}), ...(target.hold ? { hold: true } : {}) });
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

// 지금 화면이 잠근 것을 보여 주는 화면인가(잠근 기능 화면, 또는 잠근 노트 폴더가 있을 때 정리함).
const onLockedView = view => !!state.settings && ((isLockable(view) && state.settings.features.includes(LOCKABLE[view])) || (view === 'basket' && hasNoteLocks()));
// 잠근 화면을 떠난 시각을 적고, '바로'면 곧바로 잠근다.
window.addEventListener('kptu:view-changed', event => {
  const view = event.detail?.view;
  if (!state.settings) return;
  // 돌아온 화면이 잠근 것을 보여 주는 화면이면, 떠나 있던 시간이 다 됐는지 먼저 본 뒤(다 됐으면 잠김) 아니면 시계를 멈춘다.
  if (onLockedView(view) && state.open) { expire(); if (state.open) state.leftAt = null; return; }
  if (view === 'lock') return;
  if (state.open && state.leftAt === null) { state.leftAt = Date.now(); expire(); }
});
// 다른 앱으로 가거나 앱을 닫으면(화면이 숨겨지면) '앱 닫을 때'는 바로 잠그고, 나머지는 그때부터 시간을 잰다.
// 잠근 화면을 보고 있었는데 잠기면, 그 화면에서 잠금 화면으로 바로 옮긴다(최근 앱 목록 미리보기에도 자료가 남지 않게).
// 이때 그 화면이 쓰던 것(고치던 하루 기록·고른 사진)은 버리지 않는다(hold) — 화면째 숨겨 두었다가 PIN을 풀면 그대로 돌아온다.
function relockCurrent() {
  const view = window.KPTURouter?.current;
  if (locked(view)) guard(view, { source: 'api', hold: true });
}
// 붙들어 둔 화면이 아직 가려져야 하나(정리함은 잠근 노트 폴더가 다시 잠겨 있는 동안).
const heldHidden = view => view === 'basket' ? notesHidden() : locked(view);
export const held = () => state.held;

// ── 고르기 창 동안은 '자리 비움'이 아니다(S67-23) ─────────────────────────────────────────────
// 앱 안에서 연 파일·사진 고르기 창(input type=file — 폰 앱은 그 누름을 받아 안드로이드 고르기 창을 띄운다), 카메라, 사진 편집기,
// 보내기 창은 이 화면을 잠깐 가린다(화면 숨김). 그것을 '다른 앱으로 감'으로 치면 '바로'·'앱 닫을 때'에서 곧바로 잠겨 쓰던 것이 사라졌다.
// 그래서 그 누름 바로 뒤(STEP_MS 안)에 화면이 숨겨지면 고르기 창으로 보고 잠그지 않는다. 고르기 창을 연 채 오래 떠나 있었으면
// (다시 잠그기 시간, '바로'·'앱 닫을 때'는 PICK_AWAY_MS) 돌아왔을 때 원래대로 잠근다. 고르기 창이 닫히면(화면이 다시 보이면) 곧바로 원래 규칙.
const STEP_MS = 3000;
export const PICK_AWAY_MS = 3 * 60 * 1000;
let steppedAt = 0, pickedAwayAt = null;
// 화면 안 단추가 고르기 창·편집기·보내기 창을 열기 직전에 부른다(파일 고르기 칸은 아래 누름 듣기가 알아서 부른다).
export function stepOut() { steppedAt = Date.now(); }
document.addEventListener('click', event => {
  const t = event.target;
  if (t instanceof HTMLInputElement && t.type === 'file' && !t.disabled) stepOut();
}, true);
const awayLimit = () => RELOCK_MS[state.settings?.relock] || PICK_AWAY_MS;
document.addEventListener('visibilitychange', () => {
  const hidden = document.visibilityState === 'hidden';
  if (hidden && state.settings && state.open && Date.now() - steppedAt < STEP_MS) { steppedAt = 0; pickedAwayAt = Date.now(); return; }
  steppedAt = 0;
  if (!hidden && pickedAwayAt !== null) {
    const away = Date.now() - pickedAwayAt; pickedAwayAt = null;
    if (state.settings && state.open && away >= awayLimit()) { state.open = false; state.leftAt = null; changed(); relockCurrent(); return; }
    expire(); if (!state.open) relockCurrent();
    return;
  }
  pickedAwayAt = null;
  if (!state.settings || !state.open) { if (hidden) relockCurrent(); return; }
  const view = window.KPTURouter?.current;
  const onLocked = onLockedView(view);
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
  Object.assign(state, { settings: null, failed: false, open: false, leftAt: null, pending: null, notes: null, held: null }); steppedAt = 0; pickedAwayAt = null;
  changed();
});

window.KPTUFeatureLock = { refresh, ready, settings, readFailed, featureOf, isLockable, hides, locked, anyHidden, guard, pending, clearPending,
  markOpen, applySaved, noteBlocked, FEATURE_NAMES, RELOCK,
  noteFolderLocks, hasNoteLocks, notesHidden, folderCovered, folderLocked, noteHidden, applyNoteFolders, askNotes, pendingNeedsPin, held, stepOut };
