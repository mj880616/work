// CAL-일정첨부 요청 6번(S59-23): 부른 사람(로그인) 자기 Google 캘린더 연결의 짧은 접근 토큰.
// - 연결은 사람마다 public.app_google_calendar_connections 한 행(user_id). 서버가 확인한 로그인 id 행만 읽는다(화면이 보낸 값 없음).
// - 앱 값(client id/secret)은 앱 하나에 하나라 public_policy_drive_config id=1에서 읽는다(google-calendar·google-tasks ensureAccess와 같은 값).
// - 읽기 전용: 남은 접근 토큰이 1분 넘게 살아 있으면 그것을, 아니면 갱신 열쇠로 새로 받아 이 요청에서만 쓴다(행에 다시 쓰지 않음).
// - 토큰·Google 응답 원문은 응답·로그에 싣지 않는다(오류 코드만).
// deno-lint-ignore no-explicit-any
type Reader = { rest: (path: string) => Promise<any> };

export class CalendarTokenError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

const USER = /^[A-Za-z0-9_-]{1,64}$/;

async function one(reader: Reader, path: string) {
  let rows: unknown;
  try {
    rows = await reader.rest(path);
  } catch {
    throw new CalendarTokenError("calendar_token_failed");
  }
  if (!Array.isArray(rows)) throw new CalendarTokenError("calendar_token_failed");
  return rows[0] ?? null;
}

export async function calendarAccessToken(
  reader: Reader,
  userId: unknown,
  options: { fetch?: typeof fetch; now?: () => number; log?: (code: string) => void } = {},
): Promise<string> {
  const request = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const log = options.log ?? ((code: string) => console.error(code));
  if (typeof userId !== "string" || !USER.test(userId)) throw new CalendarTokenError("calendar_not_connected");
  const conn = await one(reader, `app_google_calendar_connections?user_id=eq.${encodeURIComponent(userId)}&select=user_id,access_token,refresh_token,token_expires_at&limit=1`);
  if (!conn || conn.user_id !== userId) throw new CalendarTokenError("calendar_not_connected");
  const exp = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (typeof conn.access_token === "string" && conn.access_token && Number.isFinite(exp) && exp > now() + 60000) return conn.access_token;
  if (typeof conn.refresh_token !== "string" || !conn.refresh_token) throw new CalendarTokenError("calendar_auth");
  const cfg = await one(reader, "public_policy_drive_config?id=eq.1&select=google_client_id,google_client_secret&limit=1");
  if (!cfg?.google_client_id || !cfg?.google_client_secret) throw new CalendarTokenError("calendar_token_failed");
  let r: Response;
  try {
    r = await request("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: cfg.google_client_id, client_secret: cfg.google_client_secret, refresh_token: conn.refresh_token, grant_type: "refresh_token" }),
      redirect: "error",
    });
  } catch {
    log("calendar_token_failed");
    throw new CalendarTokenError("calendar_token_failed");
  }
  let d: { access_token?: unknown; error?: unknown } = {};
  try { d = await r.json(); } catch { d = {}; }
  if (!r.ok || typeof d.access_token !== "string" || !d.access_token) {
    log("calendar_token_failed");
    throw new CalendarTokenError(d.error === "invalid_grant" || [400, 401].includes(r.status) ? "calendar_auth" : "calendar_token_failed");
  }
  return d.access_token;
}
