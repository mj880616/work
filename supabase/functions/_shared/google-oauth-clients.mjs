// S71-01 AUTH-구글권한나누기(명진 2026-11-26 10:02 'ㄱ'): 구글 로그인 창구를 둘로 나눈다. 설계: docs/design/google-brand-verification.md "창구 둘".
//
// 1) 심사용 창구('review', 지금 OAuth 클라이언트 — 앱 값은 public_policy_drive_config id=1, 모든 사람):
//    요청 권한은 REVIEW_SCOPES 안에서만(openid·email·calendar.events·calendar.calendarlist.readonly·tasks·drive.file).
//    구글 콘솔 '데이터 액세스'에 등록한 목록과 글자까지 같아야 한다. include_granted_scopes는 쓰지 않는다(옛 허락이 합쳐지지 않게).
// 2) 명진 전용 창구('full', 새 구글 클라우드 프로젝트의 OAuth 클라이언트, 심사 안 받음):
//    드라이브 전체(drive) 권한은 이 창구로만 요청한다. 운영자 작업공간(서버 허용 표 'calls')에서만, 그리고 Edge 비밀값 두 개가 있을 때만.
//    비밀값이 없으면 운영자도 심사용 창구·drive.file 그대로(깨지지 않음).
// 3) 갱신 열쇠(refresh token)는 그것을 내준 창구의 client id/secret으로만 새 토큰을 받는다. 작업공간 Drive 연결이 어느 창구인지는
//    public.app_drive_connection_clients 행(없으면 'review')에 적고, Drive 토큰을 새로 받는 곳은 모두 driveRefreshCredentials()로 그 창구를 고른다.
// 토큰·비밀값·구글 응답 원문은 응답·로그에 싣지 않는다(오류 코드만). 화면이 보낸 값으로 창구·권한을 고르지 않는다.

const G = 'https://www.googleapis.com/auth/';
export const SCOPE = Object.freeze({
  openid: 'openid',
  email: 'email',
  calendarEvents: G + 'calendar.events',
  calendarList: G + 'calendar.calendarlist.readonly',
  tasks: G + 'tasks',
  driveFile: G + 'drive.file',
});
// 심사용 창구가 요청할 수 있는 전부(콘솔 '데이터 액세스'와 같은 목록).
export const REVIEW_SCOPES = Object.freeze([SCOPE.openid, SCOPE.email, SCOPE.calendarEvents, SCOPE.calendarList, SCOPE.tasks, SCOPE.driveFile]);
// 드라이브 전체 권한. 요청은 명진 전용 창구(fullDriveAuthUrl)에서만. 다른 곳은 받은 토큰에 이 권한이 있는지 '확인'만 한다.
export const DRIVE_FULL_SCOPE = G + 'drive';
export const FULL_CLIENT_ENV = Object.freeze({ id: 'GOOGLE_DRIVE_FULL_CLIENT_ID', secret: 'GOOGLE_DRIVE_FULL_CLIENT_SECRET' });
export const CLIENT_KINDS = Object.freeze(['review', 'full']);
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';

// 비밀값을 못 읽는 곳(권한 제한)에서는 없는 것으로 본다(→ 심사용 창구).
const defaultEnv = name => { try { return globalThis.Deno?.env?.get?.(name); } catch { return undefined; } };
const CLIENT_ID = /^[A-Za-z0-9._-]{8,200}$/;

// 받은 scope 글자(공백으로 나눈 목록)에 드라이브 전체 권한이 정확히 있는지. drive.file·drive.readonly는 아니다.
export const grantsFullDrive = scope => typeof scope === 'string' && scope.split(/\s+/).includes(DRIVE_FULL_SCOPE);

// 명진 전용 창구의 앱 값(Edge 비밀값). 없거나 모양이 이상하면 null(→ 심사용 창구 그대로).
export function fullDriveClient(env = defaultEnv) {
  const id = String(env(FULL_CLIENT_ENV.id) || '').trim(), secret = String(env(FULL_CLIENT_ENV.secret) || '').trim();
  if (!CLIENT_ID.test(id) || secret.length < 8 || secret.length > 400) return null;
  return { client_id: id, client_secret: secret };
}

// 심사용 창구 앱 값(public_policy_drive_config id=1 행). 없으면 null.
export function reviewClient(cfg) {
  if (!cfg || typeof cfg.google_client_id !== 'string' || !cfg.google_client_id || typeof cfg.google_client_secret !== 'string' || !cfg.google_client_secret) return null;
  return { client_id: cfg.google_client_id, client_secret: cfg.google_client_secret };
}

export const clientKindOf = row => row?.oauth_client === 'full' ? 'full' : 'review';

// 창구 종류 → 앱 값. 'full'인데 비밀값이 없으면 null(부르는 쪽이 설정 없음으로 처리). 다른 창구로 넘어가지 않는다.
export function clientFor(kind, cfg, env = defaultEnv) {
  return kind === 'full' ? fullDriveClient(env) : reviewClient(cfg);
}

// 구글 동의 화면 주소. 심사용 창구는 REVIEW_SCOPES 밖 권한이 하나라도 섞이면 만들지 않는다(예외).
// include_granted_scopes는 넣지 않는다. 늘 access_type=offline·prompt=consent(갱신 열쇠를 받기 위해).
function authUrl({ clientId, redirectUri, scopes, state, allowed }) {
  const list = [...new Set(scopes)];
  if (!list.length || list.some(s => !allowed.includes(s))) throw new Error('google_scope_not_allowed');
  if (typeof clientId !== 'string' || !clientId || typeof redirectUri !== 'string' || !redirectUri || typeof state !== 'string' || !state) throw new Error('google_auth_input');
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: list.join(' '), access_type: 'offline', prompt: 'consent', state });
  return AUTH + '?' + params.toString();
}
export function reviewAuthUrl({ cfg, redirectUri, scopes, state }) {
  const c = reviewClient(cfg);
  if (!c) throw new Error('Google OAuth 설정이 없습니다.');
  return authUrl({ clientId: c.client_id, redirectUri, scopes, state, allowed: REVIEW_SCOPES });
}
// 명진 전용 창구: 드라이브 전체 하나만. 부르는 쪽이 운영자 작업공간인지 서버에서 먼저 확인한다.
export function fullDriveAuthUrl({ client, redirectUri, state }) {
  if (!client?.client_id) throw new Error('google_full_client_missing');
  return authUrl({ clientId: client.client_id, redirectUri, scopes: [DRIVE_FULL_SCOPE], state, allowed: [DRIVE_FULL_SCOPE] });
}

// Drive 연결 시작 계획. isOperator는 서버가 허용 표로 확인한 값만(화면 값 없음).
// 운영자 + 명진 전용 창구 비밀값 있음 → full(drive). 그 밖(운영자 아님, 또는 비밀값 없음) → review(drive.file).
export function driveStartPlan({ isOperator, env = defaultEnv }) {
  const full = isOperator === true ? fullDriveClient(env) : null;
  return full ? { kind: 'full', client: full, scopes: [DRIVE_FULL_SCOPE] } : { kind: 'review', client: null, scopes: [SCOPE.driveFile] };
}

// state 글자에 창구 표시('full.')가 있는지. state는 서버가 만든 무작위 글자이고 해시로 저장돼, 바뀌면 콜백이 거절한다.
export const stateClientKind = state => (typeof state === 'string' && state.split('.').includes('full')) ? 'full' : 'review';

export class DriveCredentialError extends Error {
  constructor(code) { super(code); this.code = code; }
}

// 작업공간 Drive 연결의 갱신 열쇠 + 그 연결을 내준 창구의 앱 값. rest(path) → 행 배열(service_role 읽기).
// cfgRow: 부르는 쪽이 이미 읽기 시작한 id=1 앱 값 행(값 또는 promise, 없으면 null). 안 주면 rest로 읽는다.
// code: 'read_failed'(읽기 실패) | 'config_missing'(창구 앱 값 없음) | 'not_connected'(연결 없음). 판정 순서는 설정 → 연결(옛 도우미와 같음).
// 명진 전용 창구 비밀값이 없으면 창구 기록을 읽지 않고 심사용 창구로 본다: full 연결은 그 비밀값이 있을 때만 생기고,
// 비밀값을 지운 뒤 남은 full 연결은 심사용 창구로 갱신이 실패해 '[Drive 다시 연결]'(drive_auth_expired)로 이어진다(다시 연결하면 심사용 창구로 저장).
export async function driveRefreshCredentials(rest, workspaceId, { env = defaultEnv, cfgRow } = {}) {
  const ws = encodeURIComponent(String(workspaceId));
  const full = fullDriveClient(env);
  let cfgRows, connRows, kindRows;
  try {
    [cfgRows, connRows, kindRows] = await Promise.all([
      cfgRow !== undefined ? Promise.resolve(cfgRow).then(r => [r]) : rest('public_policy_drive_config?id=eq.1&select=google_client_id,google_client_secret&limit=1'),
      rest(`app_drive_connections?workspace_id=eq.${ws}&select=google_refresh_token&limit=1`),
      full ? rest(`app_drive_connection_clients?workspace_id=eq.${ws}&select=oauth_client&limit=1`) : [],
    ]);
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e && !(e instanceof DriveCredentialError)) throw e; // 부르는 쪽 오류(예: Fail)는 그대로
    throw new DriveCredentialError('read_failed');
  }
  if (!Array.isArray(connRows) || !Array.isArray(kindRows) || !Array.isArray(cfgRows)) throw new DriveCredentialError('read_failed');
  const kind = full ? clientKindOf(kindRows[0]) : 'review';
  const client = kind === 'full' ? full : reviewClient(cfgRows[0]);
  if (!client) throw new DriveCredentialError('config_missing');
  const refreshToken = connRows[0]?.google_refresh_token;
  if (typeof refreshToken !== 'string' || !refreshToken) throw new DriveCredentialError('not_connected');
  return { kind, client, refreshToken };
}

// 갱신 열쇠로 새 접근 토큰. 네트워크 실패는 예외 그대로(부르는 쪽이 코드로 바꿈). 결과 {ok, status, data}.
export async function refreshAccessToken(request, { client, refreshToken }) {
  const r = await request('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client.client_id, client_secret: client.client_secret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    redirect: 'error',
  });
  let data = {};
  try { data = await r.json(); } catch { data = {}; }
  return { ok: r.ok, status: r.status, data: data && typeof data === 'object' ? data : {} };
}
