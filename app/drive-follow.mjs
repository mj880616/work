// S70-76 LIB-드라이브늘같게(명진 11/24·11/26 "자료실은 그냥 드라이브를 항상 반영하는걸로"): 앱에서 자료를 옮기거나 폴더를 만들거나
// 이름을 바꾸거나 옮기면, 그 자리에서 서버에 '드라이브도 같게'를 부탁한다. 부탁 길은 이것 하나다(서버 workspace-drive POST ?action=drive-mirror
// {mode:'auto'} — 옮기기 규칙은 서버 supabase/functions/_shared/library-mirror.mjs 한 곳, 새 경로 없음).
// 서버는 로그인한 본인 작업공간·본인 구글 연결로만 한다. 밀린 것은 서버 DB 기준으로 다음 부름에 서버가 다시 하므로 여기서는 기기에 적어 두지 않는다.
// 겹친 부탁은 하나로 묶는다(도는 중에 또 부탁하면 끝난 뒤 한 번 더). 서버가 시간 한도로 남겼으면(more) 이어서 부른다. DOM 없음.
export const FOLLOW_PATH = '/functions/v1/workspace-drive?action=drive-mirror';
export const FOLLOW_ROUNDS = 8;
export const FOLLOW_WAIT_MS = 30000;

const listeners = new Set();
let running = null, again = false, last = null;

/** 마지막 결과(숫자만)를 듣는다(자료실 위 한 줄이 '드라이브에 못 옮겼어요 [다시]'를 그릴 때). 반환: 듣기 끄기. */
export function onDriveFollow(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export const lastDriveFollow = () => last;

/** 서버 답 → 밀렸는가(다시 해야 하는가). 드라이브 연결 없음·자료실 폴더 없음은 밀린 것이 아니다(조용히). */
export function followFailed(r) {
  if (!r || typeof r !== 'object') return true;
  if (r.ok === false) return !['not_ready', 'drive_not_connected', 'settings_unavailable', 'library_missing'].includes(r.code);
  return Number(r.pending) > 0 || r.more === true;
}

/** 드라이브도 같게 부탁. api(path, {method, body, singleFlight, timeoutMs}) → 서버 답. 반환: 마지막 서버 답(실패해도 throw하지 않음). */
export function followDrive(api) {
  if (typeof api !== 'function') return Promise.resolve(null);
  if (running) { again = true; return running; }
  running = (async () => {
    let r = null;
    try {
      for (let i = 0; i < FOLLOW_ROUNDS; i++) {
        again = false;
        try { r = await api(FOLLOW_PATH, {method: 'POST', body: {mode: 'auto'}, singleFlight: false, timeoutMs: FOLLOW_WAIT_MS}); }
        catch { r = {ok: false, code: 'unreachable'}; }
        if (r?.ok === false) break;
        if (!(r?.more === true || again)) break;
      }
    } finally { running = null; }
    last = r;
    for (const fn of [...listeners]) { try { fn(r); } catch { /* 듣는 쪽 오류는 무시 */ } }
    if (again) { again = false; void followDrive(api); }
    return r;
  })();
  return running;
}

/** 쓰기 뒤에 부르는 짧은 꼴: 기다리지 않고 부탁만(실패해도 앱 쪽 옮기기는 그대로). */
export function askDriveFollow(api) { try { void followDrive(api); } catch { /* 다음 부름에 서버가 다시 */ } }

/** kptu:api-saved(성공한 저장의 경로·방법만, 내용 없음) → 자료실 폴더·자료 연결이 바뀌었는가. 모든 화면·모든 옮기기 길이 이 두 표를 쓴다. */
export function affectsLibrary(detail, baseUrl = '') {
  if (!detail || typeof detail.path !== 'string' || !['POST', 'PATCH', 'DELETE', 'PUT'].includes(String(detail.method || '').toUpperCase())) return false;
  let path = detail.path;
  if (baseUrl && path.startsWith(baseUrl)) path = path.slice(baseUrl.length);
  return /^\/rest\/v1\/app_library_folder(s|_items)(\?|$)/.test(path);
}

export const FOLLOW_RETRY_MS = 60000;
/**
 * 앱 어디서든(자료실·회의·담당조직·주간보고·브리핑·전체 검색·정돈 제안 승인 등) 자료실 표가 바뀌면 그 자리에서 드라이브도 같게.
 * 밀렸으면(followFailed) 이 탭에서 1분 뒤 한 번 더 부탁한다. 반환: 끄기.
 */
export function mountDriveFollow({win = globalThis.window, rt = () => globalThis.window?.KPTURuntime, retryMs = FOLLOW_RETRY_MS} = {}) {
  if (!win?.addEventListener) return () => {};
  let retry = null, retried = false;
  const api = (path, options) => rt()?.api(path, options);
  // 밀리면 1분 뒤 한 번만 더(계속 실패하면 멈추고, 다음 옮기기·자료실 열기·[다시]에서 서버가 다시 한다).
  const off = onDriveFollow(r => {
    clearTimeout(retry); retry = null;
    if (!followFailed(r)) { retried = false; return; }
    if (retried) return;
    retried = true;
    retry = setTimeout(() => { retry = null; void followDrive(api); }, retryMs);
  });
  const saved = event => { if (affectsLibrary(event?.detail, rt()?.config?.url || '')) { retried = false; void followDrive(api); } };
  const reset = () => { clearTimeout(retry); retry = null; retried = false; };
  win.addEventListener('kptu:api-saved', saved);
  win.addEventListener('kptu:session-changed', reset);
  return () => { off(); reset(); win.removeEventListener('kptu:api-saved', saved); win.removeEventListener('kptu:session-changed', reset); };
}
