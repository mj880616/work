// account-delete: 내 프로필 [계정 삭제]의 서버 입구(S69 STORE-계정삭제, 구글 플레이 '앱 안 계정 삭제').
//
// 누가(verify_jwt=true + 함수 코드에서 다시 확인):
// - Authorization: Bearer <사용자 로그인>을 Auth 서버(/auth/v1/user)로 확인한다. 바깥 앱 위임 열쇠(client_id)는 401.
// - 무엇을 지울지는 DB 함수가 정한다: 사용자 토큰으로 public.app_account_delete_check()·app_account_delete('삭제')만 부른다
//   (auth.uid()의 owner 작업공간 하나, 화면이 보낸 id는 받지도 넘기지도 않음 — 몸통에서 읽는 칸은 action·confirm뿐).
// 입구: POST {action:'check'}              → {ok:true} 또는 {ok:false, code}(거절 이유 이름)
//       POST {action:'delete', confirm:'삭제'} → DB가 지운 뒤 돌려준 사진 파일 경로만 서버 키로 버킷에서 지우고,
//                                             그 사람의 모든 로그인(폰 앱 포함)을 끊는다 → {ok:true, files_left}
// 서버 키(SUPABASE_SERVICE_ROLE_KEY)는 버킷 파일 지우기에만 쓴다. 경로는 버킷·모양(작업공간 페이지·일정 id 폴더 아래 jpg)을 다시 확인한다.
// 로그·응답: 코드와 숫자만(경로·기록 내용·메일 없음).
import { isDelegatedToken } from "../_shared/delegated-token-guard.mjs";

export type Env = (name: string) => string | undefined;
export type DeleteDeps = { env: Env; fetch?: typeof fetch; log?: (code: string) => void };

const cors = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// 버킷마다 받는 경로 모양(DB가 만드는 모양 그대로). 그 밖의 버킷·모양은 지우지 않는다.
export const FILE_SHAPES: Record<string, RegExp> = {
  "share-page-media": new RegExp(`^${UUID}/${UUID}\\.jpg$`, "i"),
  "team-event-media": new RegExp(`^${UUID}/[0-9a-z-]{1,80}\\.jpg$`, "i"),
};
export const REFUSALS = new Set(["ACCOUNT_DELEGATED_REFUSED", "ACCOUNT_WORKSPACE_REQUIRED", "ACCOUNT_WORKSPACE_SHARED", "ACCOUNT_OPERATOR_KEEP", "ACCOUNT_GROUP_ADMIN_MOVE"]);
export const CONFIRM_WORD = "삭제";
const CHUNK = 100;
const MAX_FILES = 20000;

class Fail extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}

/** DB가 돌려준 파일 목록에서 받는 모양만 버킷별로 모은다(중복 제거). */
export function filesByBucket(files: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!Array.isArray(files)) return out;
  for (const f of files.slice(0, MAX_FILES)) {
    const b = typeof f?.b === "string" ? f.b : "", p = typeof f?.p === "string" ? f.p : "";
    const shape = FILE_SHAPES[b];
    if (!shape || !shape.test(p)) continue;
    const list = out.get(b) ?? [];
    if (!list.includes(p)) list.push(p);
    out.set(b, list);
  }
  return out;
}

export function createAccountDeleteHandler(deps: DeleteDeps) {
  const doFetch = deps.fetch ?? fetch;
  const log = deps.log ?? ((code: string) => console.error(JSON.stringify({ fn: "account-delete", code })));
  const SB = deps.env("SUPABASE_URL") || "", ANON = deps.env("SUPABASE_ANON_KEY") || "", SERVICE = deps.env("SUPABASE_SERVICE_ROLE_KEY") || "";

  async function call(url: string, init: RequestInit, code: string, timeout = 30000): Promise<Response> {
    try { return await doFetch(url, { ...init, signal: AbortSignal.timeout(timeout) }); }
    catch { throw new Fail(502, code); }
  }

  async function who(req: Request): Promise<string> {
    const auth = req.headers.get("Authorization") || "";
    if (!/^Bearer\s+\S+$/i.test(auth)) throw new Fail(401, "UNAUTHORIZED");
    if (!SB || !ANON) throw new Fail(500, "SERVER_CONFIG_MISSING");
    const res = await call(`${SB}/auth/v1/user`, { headers: { apikey: ANON, Authorization: auth } }, "AUTH_UNAVAILABLE");
    if (res.status >= 500) throw new Fail(502, "AUTH_UNAVAILABLE");
    if (!res.ok) throw new Fail(401, "UNAUTHORIZED");
    const user = await res.json().catch(() => null);
    if (typeof user?.id !== "string" || !new RegExp(`^${UUID}$`, "i").test(user.id)) throw new Fail(401, "UNAUTHORIZED");
    // MCP-Claude읽기 M-2: Auth가 받은 같은 열쇠가 OAuth 위임 열쇠(client_id)면 거절한다(DB도 한 번 더 거절).
    if (isDelegatedToken(auth)) throw new Fail(401, "UNAUTHORIZED");
    return auth;
  }

  // 사용자 토큰으로 DB 함수 하나를 부른다. 거절 이유 이름은 그대로, 나머지 오류는 한 이름으로.
  async function rpc(auth: string, fn: string, body: unknown): Promise<any> {
    const res = await call(`${SB}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: ANON, Authorization: auth, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    }, "DB_UNAVAILABLE", 60000);
    const data = await res.json().catch(() => null);
    if (res.ok) return data;
    const message = typeof data?.message === "string" ? data.message : "";
    if (REFUSALS.has(message)) throw new Fail(409, message);
    if (message === "ACCOUNT_CONFIRM_MISMATCH") throw new Fail(400, message);
    if (res.status === 404) throw new Fail(503, "NOT_READY");
    if (res.status === 401 || res.status === 403) throw new Fail(401, "UNAUTHORIZED");
    throw new Fail(502, "DB_FAILED");
  }

  async function removeFiles(files: unknown): Promise<number> {
    let left = 0;
    for (const [bucket, paths] of filesByBucket(files)) {
      for (let i = 0; i < paths.length; i += CHUNK) {
        const part = paths.slice(i, i + CHUNK);
        if (!SERVICE) { left += part.length; continue; }
        try {
          const res = await call(`${SB}/storage/v1/object/${bucket}`, {
            method: "DELETE",
            headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
            body: JSON.stringify({ prefixes: part }),
          }, "STORAGE_UNAVAILABLE");
          if (!res.ok) left += part.length;
        } catch { left += part.length; }
      }
    }
    if (left) log("files_left");
    return left;
  }

  return async function handle(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    try {
      const auth = await who(req);
      let body: any = null;
      try { body = await req.json(); } catch { body = null; }
      const action = typeof body?.action === "string" ? body.action : "";
      if (action === "check") {
        const r = await rpc(auth, "app_account_delete_check", {});
        if (r?.ok === true) return json({ ok: true });
        return json({ ok: false, code: REFUSALS.has(r?.code) ? r.code : "ACCOUNT_DELETE_UNAVAILABLE" });
      }
      if (action !== "delete") throw new Fail(400, "BAD_REQUEST");
      if (body?.confirm !== CONFIRM_WORD) throw new Fail(400, "ACCOUNT_CONFIRM_MISMATCH");
      const r = await rpc(auth, "app_account_delete", { p_confirm: CONFIRM_WORD });
      if (r?.ok !== true) throw new Fail(502, "DB_FAILED");
      const filesLeft = await removeFiles(r.files);
      // 이 사람의 모든 로그인(다른 기기·폰 앱 포함)을 끊는다. 실패해도 지우기는 이미 끝났으므로 결과는 그대로 돌려준다.
      try {
        const out = await call(`${SB}/auth/v1/logout?scope=global`, { method: "POST", headers: { apikey: ANON, Authorization: auth } }, "LOGOUT_UNAVAILABLE");
        if (!out.ok && out.status !== 401 && out.status !== 403) log("logout_failed");
      } catch { log("logout_failed"); }
      log("deleted");
      return json({ ok: true, files_left: filesLeft });
    } catch (e) {
      const f = e instanceof Fail ? e : new Fail(500, "FAILED");
      if (f.status >= 500) log(f.code);
      return json({ ok: false, code: f.code, error: f.code }, f.status); // error 칸: 화면 공용 런타임이 이름으로 판단(serverCode)
    }
  };
}
