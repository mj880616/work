// MULTI-노조사용자 ②-2 (S49-53): 사람별(작업공간별) Google Drive 연결. 설계: docs/design/multi-user-audit.md 8절.
// Drive 갱신 열쇠(refresh token)는 작업공간마다 public.app_drive_connections 한 행에 있다(RLS 켬·정책 없음·API 권한 없음, service_role만).
// 앱 값(client id/secret)은 앱 하나에 하나라 그대로 public_policy_drive_config id=1에서 읽는다. id=1의 refresh token은 여기서 읽지 않는다.
// 작업공간 id는 늘 서버가 확인한 값(로그인 → 본인 owner 행, 또는 행의 작업공간 owner 확인)만 넘긴다. 화면이 보낸 값을 넘기지 않는다.
// 연결이 없으면 424 drive_not_connected(화면이 'Drive 연결' 안내). 다른 작업공간의 연결로 넘어가는 길(대체 연결)은 없다.
// 토큰·Google 응답 원문은 응답·로그에 싣지 않는다(오류 코드만).

// supabase-js 관리자 클라이언트(from) 또는 REST 읽기 함수(rest: 'table?query' → 행 배열) 둘 중 하나. 둘 다 service_role.
// deno-lint-ignore no-explicit-any
type Admin = { from: (table: string) => any } | { rest: (path: string) => Promise<unknown> };

// supabase-js 클라이언트에도 `rest` 속성(PostgrestClient 객체)이 있다. 그래서 `"rest" in admin`으로 고르면
// 관리자 클라이언트를 REST 읽기 함수로 잘못 보고 admin.rest(...)를 부르다 예외가 난다(11/05 drive_token_failed).
// REST 읽기 함수는 rest가 '함수'일 때만으로 가른다.
function isRestReader(admin: Admin): admin is { rest: (path: string) => Promise<unknown> } {
  return typeof (admin as { rest?: unknown }).rest === "function";
}

async function readOne(admin: Admin, table: string, select: string, column: string, value: string | number) {
  if (isRestReader(admin)) {
    const rows = await admin.rest(`${table}?${column}=eq.${encodeURIComponent(String(value))}&select=${select}&limit=1`);
    return { data: Array.isArray(rows) ? rows[0] ?? null : null, error: null };
  }
  return await admin.from(table).select(select).eq(column, value).maybeSingle();
}

export class WorkspaceDriveError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

// 운영 id는 uuid. 모양만 좁게 본다(빈 값·경로 글자 거절). 값이 '서버가 확인한 것'인지는 부르는 쪽 책임.
const ID = /^[A-Za-z0-9_-]{1,64}$/;
export const isWorkspaceId = (v: unknown): v is string => typeof v === "string" && ID.test(v);

// 그 작업공간의 Drive 연결이 있는지만(토큰 교환 없음). 화면 상태 표시용.
export async function workspaceDriveConnected(admin: Admin, workspaceId: unknown): Promise<boolean> {
  if (!isWorkspaceId(workspaceId)) return false;
  try {
    const { data, error } = await readOne(admin, "app_drive_connections", "workspace_id", "workspace_id", workspaceId);
    return !error && !!data?.workspace_id;
  } catch {
    return false;
  }
}

// 로그인한 사람의 owner 작업공간(정확히 1개). 사람마다 작업공간 1개 규칙(AGENTS.md 5절). 아니면 null.
export async function callerOwnerWorkspace(admin: Admin, userId: unknown): Promise<string | null> {
  if (!isWorkspaceId(userId)) return null;
  let rows: unknown;
  if (isRestReader(admin)) {
    rows = await admin.rest(`app_workspace_members?user_id=eq.${encodeURIComponent(userId)}&role=eq.owner&select=workspace_id,role&limit=2`);
  } else {
    const r = await admin.from("app_workspace_members").select("workspace_id,role").eq("user_id", userId).eq("role", "owner").limit(2);
    if (r.error) return null;
    rows = r.data;
  }
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const row = rows[0] as { workspace_id?: unknown; role?: unknown };
  return row?.role === "owner" && isWorkspaceId(row.workspace_id) ? row.workspace_id : null;
}

// 그 작업공간의 Drive 연결로 짧은 access token을 받는다.
export async function workspaceDriveToken(
  admin: Admin,
  workspaceId: unknown,
  options: { fetch?: typeof fetch; log?: (code: string) => void } = {},
): Promise<string> {
  const request = options.fetch ?? globalThis.fetch;
  const log = options.log ?? ((code: string) => console.error(code));
  if (!isWorkspaceId(workspaceId)) throw new WorkspaceDriveError(500, "drive_workspace_missing");
  let cfg, cfgError, conn, connError;
  try {
    // 두 읽기는 서로 상관없어 함께 보낸다(S54-16). 오류 판정 순서(설정 → 연결)는 아래에서 그대로. 토큰은 보관하지 않는다.
    const [c, w] = await Promise.all([
      readOne(admin, "public_policy_drive_config", "google_client_id,google_client_secret", "id", 1),
      readOne(admin, "app_drive_connections", "google_refresh_token", "workspace_id", workspaceId),
    ]);
    ({ data: cfg, error: cfgError } = c);
    ({ data: conn, error: connError } = w);
  } catch {
    throw new WorkspaceDriveError(503, "drive_token_failed");
  }
  if (cfgError || !cfg?.google_client_id || !cfg?.google_client_secret) {
    throw new WorkspaceDriveError(503, "drive_config_missing");
  }
  if (connError) throw new WorkspaceDriveError(503, "drive_token_failed");
  if (!conn?.google_refresh_token) throw new WorkspaceDriveError(424, "drive_not_connected");
  let r: Response;
  try {
    r = await request("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.google_client_id,
        client_secret: cfg.google_client_secret,
        refresh_token: conn.google_refresh_token,
        grant_type: "refresh_token",
      }),
      redirect: "error",
    });
  } catch {
    log("drive_token_failed");
    throw new WorkspaceDriveError(503, "drive_token_failed");
  }
  let d: { access_token?: unknown; error?: unknown } = {};
  try { d = await r.json(); } catch { d = {}; }
  if (!r.ok || typeof d.access_token !== "string" || !d.access_token) {
    log("drive_token_failed");
    if (d.error === "invalid_grant" || [400, 401].includes(r.status)) {
      throw new WorkspaceDriveError(424, "drive_auth_expired");
    }
    throw new WorkspaceDriveError(503, "drive_token_failed");
  }
  return d.access_token;
}
