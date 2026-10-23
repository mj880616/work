// SET-보기선택서버저장 (2026-10-23 사용자 원칙: 웹의 모든 저장은 서버 저장, 한 기기에만 남는 저장 금지).
// 화면 선택 — 테마·왼쪽 메뉴 접힘·달력 보기·홈 빠른 입력 모드·노트 폴더·화면 분할 비율·수집 알림 숨김 날짜 — 의
// 유일한 저장소다. 저장 위치는 내 프로필 행의 view_prefs 칸(app_profiles, migration 20261023180000)이고, 자료실 보기(library-view-pref.js)·
// 자주 가는 링크·분류 목록과 같은 방식으로 기존 owner RLS를 지나 내 행만 읽고 쓴다. 새 표·새 함수·권한 변경 없음.
//
// 흐름
// - 읽기: 업무공간 소유자 확인 직후 loader가 한 번 load()하고, 앱 화면 공개(kptu-shell-ready) 전에 기다려 테마를 적용한다
//   (app/ARCHITECTURE.md 시작 순서). 끝나면 kptu:view-prefs-ready 알림을 보내 먼저 불러온 셸(왼쪽 메뉴)이 한 번 맞춘다. 늦게 도착한 값으로 화면을 다시 덮지 않는다. 읽기가 실패·지연되면 이번 접속은 기본값이다.
// - 옮기기: 처음 읽을 때 이 기기에 옛 값이 있고 서버에 같은 칸이 없으면 그 값을 쓰고(화면은 사용자가 고른 대로) 서버에 한 번 올린 뒤
//   기기 값을 지운다. 서버에 이미 값이 있으면 서버가 이기고 기기 값은 지운다. 서버를 못 읽으면 기기 값은 그대로 두어 다음에 다시 옮긴다.
//   옛 키 읽기·지우기는 이 파일 LEGACY 목록에만 있다(옮기기가 끝나면 이 목록과 감사 허용 줄을 지운다).
// - 쓰기: 바꾼 칸만 0.4초 모아 한 번에 보낸다(빠르게 여러 번 바꿔도 요청 하나). 보내기 직전에 서버 값을 다시 읽어 다른 기기에서
//   바꾼 다른 칸을 덮지 않게 합친다. 실패해도 화면은 그대로이고 한 번 더 시도한 뒤 다음 변경 때 다시 시도한다.
// - 칸이 아직 없는 서버(적용 전)는 읽기·쓰기가 400이라 기본값으로 동작하고 기기 값은 건드리지 않는다.
export const THEMES = Object.freeze(['olive', 'navy', 'terracotta', 'sand']);
export const CALENDAR_VIEWS = Object.freeze(['list', 'week', 'month']);
export const QUICK_MODES = Object.freeze(['update', 'task']);
export const SPLIT_SCREENS = Object.freeze(['tasks', 'projects', 'team', 'reports']);
export const KEYS = Object.freeze(['theme', 'nav_collapsed', 'calendar_view', 'home_quick_mode', 'note_folder', 'split_ratio', 'collect_hidden_on']);
const FOLDER_RE = /^(all|none|f:[^\p{Cc}]{1,20})$/u;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ratioOk = v => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1;

// 칸 하나의 값이 맞는 모양인가(DB 검사와 같은 규칙).
export function validValue(key, value) {
  switch (key) {
    case 'theme': return THEMES.includes(value);
    case 'nav_collapsed': return typeof value === 'boolean';
    case 'calendar_view': return CALENDAR_VIEWS.includes(value);
    case 'home_quick_mode': return QUICK_MODES.includes(value);
    case 'note_folder': return typeof value === 'string' && FOLDER_RE.test(value);
    case 'collect_hidden_on': return typeof value === 'string' && DATE_RE.test(value);
    case 'split_ratio': return !!value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).every(name => SPLIT_SCREENS.includes(name) && ratioOk(value[name]));
    default: return false;
  }
}
// 서버에서 읽은 값 → 화면용 객체. 모양이 틀린 칸은 그 칸만 버린다(다른 칸은 그대로). 객체가 아니면 {}.
export function parsePrefs(value) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const key of KEYS) {
    if (!(key in value)) continue;
    if (key === 'split_ratio') {
      const src = value[key];
      if (!src || typeof src !== 'object' || Array.isArray(src)) continue;
      const kept = {};
      for (const name of SPLIT_SCREENS) if (ratioOk(src[name])) kept[name] = src[name];
      if (Object.keys(kept).length) out[key] = kept;
    } else if (validValue(key, value[key])) out[key] = value[key];
  }
  return out;
}
// 바뀐 칸({'theme': 'navy', 'split_ratio.tasks': 0.4, 'nav_collapsed': null(지우기)})을 base 위에 합친 새 객체.
export function applyChanges(base, changes) {
  const out = parsePrefs(base);
  for (const [path, value] of Object.entries(changes)) {
    if (path.startsWith('split_ratio.')) {
      const name = path.slice('split_ratio.'.length), next = { ...(out.split_ratio || {}) };
      if (value === null) delete next[name]; else next[name] = value;
      if (Object.keys(next).length) out.split_ratio = next; else delete out.split_ratio;
    } else if (value === null) delete out[path];
    else out[path] = value;
  }
  return out;
}
const changeOk = (path, value) => value === null
  ? KEYS.includes(path) && path !== 'split_ratio' || (path.startsWith('split_ratio.') && SPLIT_SCREENS.includes(path.slice(12)))
  : path.startsWith('split_ratio.') ? SPLIT_SCREENS.includes(path.slice(12)) && ratioOk(value) : KEYS.includes(path) && path !== 'split_ratio' && validValue(path, value);
// 저장할 값(비어 있으면 null = 기본값으로 돌아감).
export const serialize = prefs => Object.keys(prefs).length ? prefs : null;

// 옛 기기 저장 키 → 칸. read(storage, ctx)가 값을 돌려주면 옮길 후보, remove(storage, ctx)가 기기 값을 지운다.
// ctx = {owner, cachePrefix}. 키 이름과 모양은 옛 화면 코드 그대로다.
const LEGACY = [
  { path: 'theme', keys: () => ['kptu-theme'], parse: v => (THEMES.includes(v) ? v : undefined) },
  { path: 'nav_collapsed', keys: () => ['kptu-nav-collapsed'], parse: v => (v === '1' ? true : undefined) },
  { path: 'calendar_view', keys: () => ['kptu-calendar-view'], parse: v => (CALENDAR_VIEWS.includes(v) ? v : undefined) },
  { path: 'home_quick_mode', keys: () => ['kptu-home-quick-mode'], parse: v => (QUICK_MODES.includes(v) ? v : undefined) },
  { path: 'note_folder', keys: c => (c.owner ? ['kptu_owner_cache:note-folder-v1:' + c.owner] : []), parse: v => (validValue('note_folder', v) ? v : undefined) },
  { path: 'collect_hidden_on', keys: c => (c.owner ? [c.cachePrefix + 'collect-alert-hidden-v1:' + c.owner] : []), parse: v => (validValue('collect_hidden_on', v) ? v : undefined) },
  ...SPLIT_SCREENS.map(name => ({ path: 'split_ratio.' + name, keys: () => ['kptu-split-ratio:' + name], parse: v => { const n = Number(v); return v !== null && v !== '' && ratioOk(n) ? n : undefined; } }))
];

// 고른 적 없을 때 화면이 보여 주는 값: 이 값으로 "바꾸는" 호출은 저장할 것이 없다.
const DEFAULTS = { note_folder: 'all', home_quick_mode: 'update', nav_collapsed: false };
const defaultStorage = () => { try { return globalThis.localStorage || null; } catch { return null; } };
const getPath = (prefs, path) => path.startsWith('split_ratio.') ? prefs.split_ratio?.[path.slice(12)] : prefs[path];

export function createViewPrefs({ runtime = () => globalThis.window?.KPTURuntime, storage = defaultStorage, setTimer = setTimeout, clearTimer = clearTimeout, delay = 400, retryDelay = 5000, loadTimeout = 4000 } = {}) {
  let prefs = {};          // 화면이 쓰는 값(이번 접속). 서버 값 + 옮긴 기기 값 + 이번 접속에서 바꾼 값.
  let state = 'idle';      // idle | loading | ok | pending(칸이 아직 없음) | error
  let loading = null, owner = '';
  let changes = {}, timer = null, flushing = null, retried = false;
  let lastRead = {};       // 마지막으로 아는 서버 값(읽기·쓰기 성공 때 갱신). 화면을 떠날 때 보내는 값의 바탕.
  let written = new Map(); // 올라간 뒤 지울 기기 값: path -> 기기 키 목록

  const rt = () => runtime();
  const userId = () => { try { return rt()?.context?.read?.()?.user?.id || rt()?.session?.read?.()?.user?.id || ''; } catch { return ''; } };
  const url = id => `/rest/v1/app_profiles?user_id=eq.${encodeURIComponent(id)}`;
  // {status:'ok', prefs, raw} | {status:'pending'} | {status:'error'}
  async function fetchServer(id, timeoutMs) {
    try {
      const rows = await rt().api(`${url(id)}&select=view_prefs&limit=1`, { timeoutMs });
      if (!Array.isArray(rows) || rows.length !== 1) return { status: 'error' };
      return { status: 'ok', prefs: parsePrefs(rows[0]?.view_prefs) };
    } catch (error) { return { status: error?.status === 400 ? 'pending' : 'error' }; }
  }
  const removeKeys = keys => { const s = storage(); if (!s) return; for (const k of keys) { try { s.removeItem(k); } catch { /* 막힌 저장소는 그대로 둔다 */ } } };
  // 이 기기에 남은 옛 값을 읽어 서버 값과 맞춘다. 서버에 없는 칸만 올릴 후보로 돌려주고, 이미 서버에 있거나 쓸 수 없는 값은 바로 지운다.
  function legacyPlan(server) {
    const s = storage(); if (!s) return { move: {} };
    const ctx = { owner, cachePrefix: rt()?.ownerCache?.prefix || 'kptu_owner_cache:' };
    const move = {};
    for (const item of LEGACY) {
      for (const key of item.keys(ctx)) {
        let raw = null;
        try { raw = s.getItem(key); } catch { continue; }
        if (raw === null) continue;
        const value = item.parse(raw);
        if (value === undefined || getPath(server, item.path) !== undefined) { removeKeys([key]); continue; }
        move[item.path] = value;
        written.set(item.path, [...(written.get(item.path) || []), key]);
      }
    }
    return { move };
  }

  async function load() {
    if (loading) return loading;
    loading = (async () => {
      state = 'loading'; owner = userId();
      if (!owner || !rt()?.api) { state = 'error'; return state; }
      let timedOut = false, cancel = null;
      const guard = new Promise(resolve => { cancel = setTimer(() => { timedOut = true; resolve({ status: 'error' }); }, loadTimeout + 500); });
      const result = await Promise.race([fetchServer(owner, loadTimeout), guard]);
      clearTimer(cancel);
      if (timedOut || result.status !== 'ok') { state = result.status === 'pending' ? 'pending' : 'error'; return state; }
      prefs = { ...result.prefs }; lastRead = { ...result.prefs };
      const { move } = legacyPlan(result.prefs);
      state = 'ok';
      if (Object.keys(move).length) { prefs = applyChanges(prefs, move); queue(move); }
      return state;
    })().finally(() => { try { globalThis.window?.dispatchEvent?.(new CustomEvent('kptu:view-prefs-ready', { detail: { status: state } })); } catch { /* 알림만 */ } });
    return loading;
  }
  function queue(map) {
    Object.assign(changes, map);
    if (timer) clearTimer(timer);
    timer = setTimer(() => { timer = null; void flush(); }, delay);
  }
  async function flush() {
    if (timer) { clearTimer(timer); timer = null; }
    if (flushing) { await flushing; if (Object.keys(changes).length && !timer) return flush(); return; }
    if (!Object.keys(changes).length) return;
    flushing = (async () => {
      const batch = changes; changes = {};
      const id = userId();
      let outcome = 'error', server_ = null;
      try {
        if (!id || id !== owner || !rt()?.api) { outcome = 'drop'; }
        else {
          const server = server_ = await fetchServer(id, undefined);
          if (server.status === 'pending') outcome = 'pending';
          else if (server.status === 'ok') {
            const next = applyChanges(server.prefs, batch);
            const saved = await rt().api(url(id), { method: 'PATCH', prefer: 'return=representation', body: { view_prefs: serialize(next) } });
            outcome = Array.isArray(saved) && saved.length === 1 ? 'ok' : 'error';
          }
        }
      } catch (error) { outcome = error?.status === 400 ? 'pending' : 'error'; }
      if (outcome === 'ok') {
        retried = false; state = 'ok'; lastRead = applyChanges(server_.prefs, batch);
        for (const path of Object.keys(batch)) { const keys = written.get(path); if (keys) { removeKeys(keys); written.delete(path); } }
      } else if (outcome === 'pending') { state = 'pending'; }
      else if (outcome === 'error') {
        // 이번 변경을 잃지 않게 다시 넣되, 그 사이 더 새로 바뀐 칸이 있으면 새 값이 이긴다.
        changes = { ...batch, ...changes };
        if (!retried) { retried = true; timer = setTimer(() => { timer = null; void flush(); }, retryDelay); }
      }
    })();
    try { await flushing; } finally { flushing = null; }
    if (Object.keys(changes).length && !timer) return flush();
  }
  // 화면을 떠날 때(pagehide·탭 숨김) 모인 변경이 있으면 바로 보낸다. 다시 읽을 수 없으므로 마지막으로 아는 서버 값에 얹고,
  // 브라우저가 요청을 끝까지 보내도록 keepalive로 한다. 실패하면 변경을 되돌려 두어 다음 기회에 보낸다.
  async function flushHidden() {
    if (timer) { clearTimer(timer); timer = null; }
    if (flushing || !Object.keys(changes).length || state === 'pending' || !owner || userId() !== owner || !rt()?.api) return;
    const batch = changes; changes = {};
    try {
      await rt().api(url(owner), { method: 'PATCH', prefer: 'return=minimal', keepalive: true, refreshSession: false, body: { view_prefs: serialize(applyChanges(lastRead, batch)) } });
      lastRead = applyChanges(lastRead, batch);
      for (const path of Object.keys(batch)) { const keys = written.get(path); if (keys) { removeKeys(keys); written.delete(path); } }
    } catch { changes = { ...batch, ...changes }; }
  }
  function set(path, value) {
    if (!changeOk(path, value)) return false;
    // 이미 같은 값(또는 아직 고른 적 없는 칸에 기본값)이면 보내지 않는다 — 화면이 그릴 때마다 호출해도 요청이 늘지 않는다.
    const now = getPath(prefs, path);
    if (now === value || (now === undefined && (value === null || value === DEFAULTS[path]))) return true;
    prefs = applyChanges(prefs, { [path]: value });
    retried = false;
    // 서버를 읽지 못한 접속은 모르는 칸을 덮어쓸 수 있어 보내지 않는다(flush가 읽기부터 다시 한다).
    if (state === 'ok' || state === 'error' || state === 'idle') queue({ [path]: value });
    return true;
  }
  return {
    load,
    get: key => (KEYS.includes(key) && key !== 'split_ratio' ? prefs[key] : undefined),
    set: (key, value) => set(key, value),
    getSplit: name => prefs.split_ratio?.[name],
    setSplit: (name, ratio) => set('split_ratio.' + name, ratio),
    flush,
    flushHidden,
    status: () => state,
    snapshot: () => structuredClone(prefs)
  };
}
export const viewPrefs = createViewPrefs();
// 화면을 떠날 때 모인 변경을 바로 보낸다(0.4초 기다리다 새로고침·닫기로 잃지 않게).
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('pagehide', () => { void viewPrefs.flushHidden(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void viewPrefs.flushHidden(); });
}
