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
//   report_view(사업 보고 보기)는 DB 검사가 새로 허용하는 칸이라 그 적용 전에는 쓰기가 400(검사 위반)이고 같은 방식으로 기억만 건너뛴다.
// - 거절 알림(UI-화면색10): set(..., {rejectable:true})로 바꾼 칸을 서버 검사가 거절하면(읽기는 되는데 쓰기만 400 — 새 색 6가지를 DB가 아직 모를 때)
//   그 칸만 따로 다시 보내 다른 칸이 같이 거절되지 않게 하고, 서버 값으로 되돌린 뒤 kptu:view-prefs-rejected 알림({paths})을 보낸다. 화면은 원래 값으로 돌아가고 안내한다.
// 화면 색 허용 목록은 여기 한 곳이다(UI-화면색10, 2026-10-27 재정리로 열 가지: 수수한 다섯 → 산뜻한 다섯 차례). 고르는 창·저장 확인·시험이 이 목록을 읽는다. DB 검사(app_profiles_view_prefs_check)와 같은 값이어야 한다.
// 빠진 색(terracotta·sand·mugwort·rose·mustard) 이름이 서버에 남아 있으면 parsePrefs가 그 칸만 버려 기본(olive)으로 보이고, 다른 칸을 저장할 때 다시 쓰지 않는다.
export const THEMES = Object.freeze(['olive', 'navy', 'ink', 'lavender', 'teal', 'sky', 'mint', 'coral', 'lemon', 'red']);
export const DEFAULT_THEME = 'olive';
export const CALENDAR_VIEWS = Object.freeze(['list', 'week', 'month']);
export const QUICK_MODES = Object.freeze(['update', 'task']);
// UI-작은결정묶음 ④(명진 10/27): 칸 폭은 화면마다 따로 — 텔레그램·통화·참고 묶음·사업 보고 3단이 다른 화면 값을 같이 쓰지 않는다
// (migration 20261029010000_profile_view_prefs_split_screens. 적용 전에는 새 이름 쓰기가 400이라 이 화면은 그 DB 적용 뒤 merge).
export const SPLIT_SCREENS = Object.freeze(['tasks', 'projects', 'team', 'reports', 'telegram', 'calls', 'refs', 'reports3']);
const LEGACY_SPLIT_SCREENS = ['tasks', 'projects', 'team', 'reports']; // 옛 기기 저장 키가 있던 화면(새 이름은 기기에 쓴 적 없음)
export const REPORT_VIEWS = Object.freeze(['list', 'calendar', 'photo']); // 사업 보고 [목록|달력|사진] (ACT-사진 6단계). 일정 탭 calendar_view와 다른 칸
// MENU-HOME-편집: menu_layout = {bar, rest} (하단바 칸·그 밖 메뉴의 순서, 항목 이름 목록), home_cards = 홈에 보이는 칸의 이름 순서. 항목 이름의 뜻(어느 메뉴·어느 칸인지)은
// menu-model.mjs·home-cards-model.mjs가 맡고, 여기서는 DB 검사(app_profiles_view_prefs_check)와 같은 모양만 본다.
// OD-사진크기: photo_cols(폰 사진 격자 한 줄 칸 수 2·3·4·6)·photo_cols_wide(넓은 화면 6·8·10). 단계의 뜻은 photo-grid-size.js, 모양은 DB 검사(migration 20261028090000)와 같다.
export const PHOTO_COLS = Object.freeze([2, 3, 4, 6]), PHOTO_COLS_WIDE = Object.freeze([6, 8, 10]);
export const DIARY_VIEWS = Object.freeze(['calendar', 'list']); // 일기 [달력|목록] (JOURNAL-일기목록, migration 20261028100000). 적용 전에는 쓰기가 400이라 달력 그대로
// PHOTO-사진메뉴 2차: photo_view = 사진 메뉴 거르기·칸 수 {filter: all|star|video|shot, cols: 3~12}(둘 다 선택, 명진 결정 6 — 일기 photo_cols와 따로). migration 20261028220000
export const PHOTO_VIEW_FILTERS = Object.freeze(['all', 'star', 'video', 'shot']);
// OD-연결아이콘: diary_onedrive = 일기에서 원드라이브 사진 보이기(참·거짓, 기본 참). migration 20261028150000. 적용 전에는 쓰기가 400이라 이번 접속만 기억
// FEAT-1029묶음 ③: quiet_weeks = 홈 '연락 없는 조직' 기준 주 수(정수 0=끔, 1~12주, 없으면 3주). 뜻은 org-quiet-model.mjs, 모양은 DB 검사(migration 20261029103000)와 같다.
// 적용 전에는 쓰기가 400이라 rejectable로 보내 이 칸만 되돌리고 알린다(기본 3주 그대로).
// NOTE-보기3가지: note_view = 노트 화면 [폴더|목록|포스트잇] 중 마지막에 고른 보기(없으면 폴더). migration 20261029183000. 적용 전에는 쓰기가 400이라 rejectable로 보내 이번 접속만 기억
export const NOTE_VIEWS = Object.freeze(['folder', 'list', 'board']);
// NOTE-보드여러개: note_boards = 포스트잇 보드 목록 [{id, name}](12개까지, id 'b'+소문자 영문·숫자 6~12자, 이름 1~20자), note_board = 마지막에 연 보드('all' 또는 보드 id).
// migration 20261030091000. 뜻(만들기·이름·순서)은 note-boards-model.mjs, 모양은 DB 검사와 같다. 적용 전에는 쓰기가 400이라 rejectable로 보내 되돌리고 알린다.
export const NOTE_BOARDS_MAX = 12;
const NOTE_BOARD_ID_RE = /^b[0-9a-z]{6,12}$/;
const noteBoardName = v => typeof v === 'string' && v.length > 0 && [...v].length <= 20 && !/[\p{Cc}]/u.test(v);
export const KEYS = Object.freeze(['theme', 'nav_collapsed', 'calendar_view', 'home_quick_mode', 'note_folder', 'split_ratio', 'collect_hidden_on', 'report_view', 'menu_layout', 'home_cards', 'photo_cols', 'photo_cols_wide', 'diary_view', 'diary_onedrive', 'photo_view', 'quiet_weeks', 'note_view', 'note_boards', 'note_board']);
export const ID_RE = /^[a-z][a-z0-9_-]{0,29}$/;
export const MENU_BAR_MAX = 6, MENU_REST_MAX = 24, HOME_CARDS_MAX = 24;
const idList = (value, max) => Array.isArray(value) && value.length <= max && value.every(id => typeof id === 'string' && ID_RE.test(id));
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
    case 'report_view': return REPORT_VIEWS.includes(value);
    case 'note_folder': return typeof value === 'string' && FOLDER_RE.test(value);
    case 'collect_hidden_on': return typeof value === 'string' && DATE_RE.test(value);
    case 'menu_layout': return !!value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).every(name => name === 'bar' || name === 'rest') && idList(value.bar, MENU_BAR_MAX) && idList(value.rest, MENU_REST_MAX);
    case 'home_cards': return idList(value, HOME_CARDS_MAX);
    case 'photo_cols': return PHOTO_COLS.includes(value);
    case 'photo_cols_wide': return PHOTO_COLS_WIDE.includes(value);
    case 'diary_view': return DIARY_VIEWS.includes(value);
    case 'note_view': return NOTE_VIEWS.includes(value);
    case 'note_boards': return Array.isArray(value) && value.length <= NOTE_BOARDS_MAX && value.every(b => !!b && typeof b === 'object' && !Array.isArray(b)
      && Object.keys(b).every(name => name === 'id' || name === 'name') && typeof b.id === 'string' && NOTE_BOARD_ID_RE.test(b.id) && noteBoardName(b.name));
    case 'note_board': return typeof value === 'string' && (value === 'all' || NOTE_BOARD_ID_RE.test(value));
    case 'diary_onedrive': return typeof value === 'boolean';
    case 'quiet_weeks': return Number.isInteger(value) && value >= 0 && value <= 12;
    case 'photo_view': return !!value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).every(name => name === 'filter' || name === 'cols')
      && (!('filter' in value) || PHOTO_VIEW_FILTERS.includes(value.filter))
      && (!('cols' in value) || (Number.isInteger(value.cols) && value.cols >= 3 && value.cols <= 12));
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
  ...LEGACY_SPLIT_SCREENS.map(name => ({ path: 'split_ratio.' + name, keys: () => ['kptu-split-ratio:' + name], parse: v => { const n = Number(v); return v !== null && v !== '' && ratioOk(n) ? n : undefined; } }))
];

// 고른 적 없을 때 화면이 보여 주는 값: 이 값으로 "바꾸는" 호출은 저장할 것이 없다.
const DEFAULTS = { note_folder: 'all', home_quick_mode: 'update', nav_collapsed: false, report_view: 'list', photo_cols: 4, photo_cols_wide: 6, diary_view: 'calendar', diary_onedrive: true, quiet_weeks: 3, note_view: 'folder' };
const defaultStorage = () => { try { return globalThis.localStorage || null; } catch { return null; } };
const getPath = (prefs, path) => path.startsWith('split_ratio.') ? prefs.split_ratio?.[path.slice(12)] : prefs[path];

export function createViewPrefs({ runtime = () => globalThis.window?.KPTURuntime, storage = defaultStorage, setTimer = setTimeout, clearTimer = clearTimeout, delay = 400, retryDelay = 5000, loadTimeout = 4000 } = {}) {
  let prefs = {};          // 화면이 쓰는 값(이번 접속). 서버 값 + 옮긴 기기 값 + 이번 접속에서 바꾼 값.
  let state = 'idle';      // idle | loading | ok | pending(칸이 아직 없음) | error
  let loading = null, owner = '';
  let changes = {}, timer = null, flushing = null, retried = false;
  let lastRead = {};       // 마지막으로 아는 서버 값(읽기·쓰기 성공 때 갱신). 화면을 떠날 때 보내는 값의 바탕.
  let written = new Map(); // 올라간 뒤 지울 기기 값: path -> 기기 키 목록
  const rejectable = new Set(); // 서버가 거절하면 화면을 되돌리고 알릴 칸(set의 rejectable 옵션)

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
      let outcome = 'error', merged = null;
      const rejected = [];
      const send = async (base, part) => {
        const saved = await rt().api(url(id), { method: 'PATCH', prefer: 'return=representation', body: { view_prefs: serialize(applyChanges(base, part)) } });
        return Array.isArray(saved) && saved.length === 1;
      };
      try {
        if (!id || id !== owner || !rt()?.api) { outcome = 'drop'; }
        else {
          const server = await fetchServer(id, undefined);
          if (server.status === 'pending') outcome = 'pending';
          else if (server.status === 'ok') {
            try {
              if (await send(server.prefs, batch)) { outcome = 'ok'; merged = applyChanges(server.prefs, batch); }
            } catch (error) {
              if (error?.status !== 400) throw error;
              // 읽기는 됐는데 쓰기가 400 = 검사가 값을 거절. 거절 알림 칸은 하나씩 따로 보내 어느 값이 거절됐는지 가리고, 나머지는 묶어 다시 보낸다.
              const alone = Object.keys(batch).filter(path => rejectable.has(path));
              if (!alone.length) throw error;
              let base = server.prefs;
              for (const path of alone) {
                try { if (await send(base, { [path]: batch[path] })) base = applyChanges(base, { [path]: batch[path] }); else throw Object.assign(new Error('x'), { status: 500 }); }
                catch (inner) { if (inner?.status !== 400) throw inner; rejected.push(path); }
              }
              const rest = Object.fromEntries(Object.entries(batch).filter(([path]) => !rejectable.has(path)));
              if (Object.keys(rest).length) { if (await send(base, rest)) base = applyChanges(base, rest); else throw Object.assign(new Error('x'), { status: 500 }); }
              outcome = 'ok'; merged = base;
            }
          }
        }
      } catch (error) { outcome = error?.status === 400 ? 'pending' : 'error'; }
      if (outcome === 'ok') {
        retried = false; state = 'ok'; lastRead = merged;
        for (const path of Object.keys(batch)) { const keys = written.get(path); if (keys && !rejected.includes(path)) { removeKeys(keys); written.delete(path); } }
        // 서버가 거절한 칸은 서버가 아는 값으로 되돌리고(기기 옛 값은 그대로 둔다) 화면에 알린다. 그 사이 사용자가 또 바꿨으면(이미 다른 값) 건드리지 않는다.
        const reverted = rejected.filter(path => getPath(prefs, path) === batch[path]);
        if (reverted.length) {
          prefs = applyChanges(prefs, Object.fromEntries(reverted.map(path => [path, getPath(merged, path) ?? null])));
          try { globalThis.window?.dispatchEvent?.(new CustomEvent('kptu:view-prefs-rejected', { detail: { paths: reverted } })); } catch { /* 알림만 */ }
        }
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
  function set(path, value, options = {}) {
    if (!changeOk(path, value)) return false;
    if (options.rejectable) rejectable.add(path);
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
    set: (key, value, options) => set(key, value, options),
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
