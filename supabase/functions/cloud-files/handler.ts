// S48-12b 파일 탐색기 ③ Edge(FILES-클라우드탐색기, 명진 결정 F1~F9 11/02). 설계: docs/design/files-explorer.md 3·4·5절, 7절 ③.
// 읽기만 한다: status(맞춘 상태) · sync(바뀐 것만 색인에 반영) · thumb(썸네일 중계) · media(원본 중계, Range) · preview(오피스·구글 문서 → PDF)
//   · open-url(클라우드 보기 주소). 이름·옮기기·휴지통·올리기 같은 쓰기는 ⑤~⑦에서 따로 더한다(이 파일에 없음).
// 문(모두 서버에서, 매 요청): ① 로그인(Auth) ② 그 사람이 작업공간 owner(owner 행 정확히 1개) ③ 로그인 토큰으로 부른 app_my_features()에 files
//   ④ (구글) files가 허용된 단 하나의 작업공간 = Drive 연결 작업공간(slug kptu-work, 토큰 public_policy_drive_config id=1의 주인)
//   ⑤ (원드라이브) 그 작업공간의 app_onedrive_connections 행. 화면이 보낸 작업공간·사용자 값은 쓰지 않는다.
// 새 OAuth 범위 없음: 원드라이브는 이미 받은 Files.ReadWrite(onedrive-photos/graph.ts SCOPE, .All 섞이면 거절), 구글은 이미 받은 drive.
//   넓히는 것은 범위가 아니라 이 함수 코드의 경계(드라이브 전체 목록)이고, 그래서 기능 키 files로 운영자 작업공간에만 연다.
// 1단계는 내 드라이브만(F6): 구글은 ownedByMe 파일만, 공유 드라이브·'공유 문서함'은 넣지 않는다. 원드라이브는 /me/drive만.
// 함수에 없는 것(시험이 문자열로 막음): 영구 삭제, 휴지통 비우기, 공유 링크·권한 만들기, 소유자 바꾸기.
// 토큰·임시 받기 주소는 service role로만 읽고 응답·로그에 싣지 않는다. 파일 본문은 저장하지 않는다(중계만).
import { GRAPH, normalizeScopes, safeDownloadUrl, SCOPE as OD_SCOPE, scopeAllowed, validItemId } from "../onedrive-photos/graph.ts";
import { DRIVE_WORKSPACE_SLUG, scopeHas } from "../gdrive-photos/handler.ts";

type Env = (name: string) => string | undefined;
export type CloudFilesOptions = { fetch?: typeof fetch; env: Env; now?: () => number };
export type Source = "od" | "gd";

export const FEATURE = "files";
const DRIVE = "https://www.googleapis.com/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const MAX_BODY = 16 * 1024;
const MAX_IMAGE = 8 * 1024 * 1024;
const LOCK_MS = 60 * 1000;
// F2: 화면은 열 때와 2분마다 sync를 부른다. 마지막으로 맞춘 지 2분이 안 됐으면 클라우드를 부르지 않는다(force여도 30초).
export const FRESH_MS = 2 * 60 * 1000;
export const FORCE_MIN_MS = 30 * 1000;
// 한 번 부를 때 새 쪽은 8초까지만 시작하고 15쪽까지만(사진 색인과 같은 틀). 남으면 next_page에 이어 받기.
export const SYNC_BUDGET_MS = 8000;
export const SYNC_MAX_PAGES = 15;
// 응답에 싣는 바뀐 줄 상한. 넘으면 reload:true(화면이 지금 폴더를 다시 읽음).
export const CHANGED_MAX = 1000;
const UPSERT_CHUNK = 500, IN_CHUNK = 100, MAX_DELETE_DEPTH = 40;
const OD_SELECT = "id,name,size,file,folder,root,deleted,parentReference,lastModifiedDateTime,createdDateTime";
const GD_FIELDS = "id,name,mimeType,parents,size,modifiedTime,createdTime,md5Checksum,trashed,ownedByMe";
const THUMB = { od: { small: "c480x480", large: "c1600x1600" }, gd: { small: 480, large: 1600 } } as const;
// F4 미리보기: 원드라이브는 이 확장자만 PDF로 바꿔 준다(Graph driveitem-get-content-format, 2026-11-02 문서 확인).
export const OD_PDF_EXT = /\.(docx?|dotx?|dotm|pptx?|ppsx?|xlsx?|xlsm|odt|odp|ods|rtf)$/i;
// 구글 문서류(문서·시트·슬라이드·그림)는 files.export로 PDF(내보내기 상한 10MB, 구글 문서). 올린 오피스 파일은 [열기]만(설계 Q4).
export const GD_EXPORT_MIME = /^application\/vnd\.google-apps\.(document|spreadsheet|presentation|drawing)$/;
const PREVIEW_MAX = 20 * 1024 * 1024;

const cors = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, range",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "content-length, content-range, content-type, content-disposition",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

class Fail extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export const isSource = (v: unknown): v is Source => v === "od" || v === "gd";
// 두 클라우드 id를 함께 받는 모양(DB 검사와 같음). 구글 id는 이 안의 부분집합이다.
export const isItemId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9!_.-]{1,200}$/.test(v);
const isGdId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const isoOrNull = (v: unknown) => {
  if (typeof v !== "string" || v.length > 40) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};
const sizeOrNull = (v: unknown) => {
  const n = typeof v === "string" && /^\d{1,16}$/.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
};
const nameOrNull = (v: unknown) => (typeof v === "string" && v.length >= 1 && v.length <= 400 ? v : null);
const mimeOrNull = (v: unknown) => (typeof v === "string" && v.length >= 1 && v.length <= 200 ? v : null);

// 원드라이브 항목 → 색인 줄. 뿌리 폴더 자체는 넣지 않고, 뿌리에 바로 든 것은 parent_id null. 이상하면 null(넣지 않음).
export function odRow(ws: string, rootId: string, it: Record<string, unknown>, stamp: string) {
  if (!validItemId(it.id) || it.root || it.deleted || it.id === rootId) return null;
  const name = nameOrNull(it.name);
  const parent = (it.parentReference as Record<string, unknown> | undefined)?.id;
  if (!name || !validItemId(parent)) return null;
  const file = it.file as Record<string, unknown> | undefined;
  const hashes = (file?.hashes ?? {}) as Record<string, unknown>;
  const sha1 = typeof hashes.sha1Hash === "string" ? hashes.sha1Hash.toLowerCase() : "";
  const qx = typeof hashes.quickXorHash === "string" ? hashes.quickXorHash : "";
  const hash = /^[0-9a-f]{40}$/.test(sha1) ? "sha1:" + sha1 : /^[A-Za-z0-9+/=]{1,100}$/.test(qx) ? "qx:" + qx : null;
  const folder = !!it.folder && !file;
  return {
    workspace_id: ws, source: "od", item_id: it.id, parent_id: parent === rootId ? null : parent, name, is_folder: folder,
    mime: folder ? null : mimeOrNull(file?.mimeType), size_bytes: folder ? null : sizeOrNull(it.size),
    modified_at: isoOrNull(it.lastModifiedDateTime), created_at: isoOrNull(it.createdDateTime), hash, trashed: false,
    seen_at: stamp, updated_at: stamp,
  };
}

// 구글 파일 → 색인 줄. 내 파일(ownedByMe)만(F6). 뿌리에 바로 든 것·부모 없는 것은 parent_id null.
export function gdRow(ws: string, rootId: string, f: Record<string, unknown>, stamp: string) {
  if (!isGdId(f.id) || f.ownedByMe !== true || f.id === rootId) return null;
  const name = nameOrNull(f.name);
  if (!name) return null;
  const parents = Array.isArray(f.parents) ? f.parents.filter(isGdId) : [];
  const parent = parents[0] && parents[0] !== rootId ? parents[0] : null;
  const folder = f.mimeType === FOLDER_MIME;
  const md5 = typeof f.md5Checksum === "string" ? f.md5Checksum.toLowerCase() : "";
  return {
    workspace_id: ws, source: "gd", item_id: f.id, parent_id: parent, name, is_folder: folder,
    mime: mimeOrNull(f.mimeType), size_bytes: folder ? null : sizeOrNull(f.size),
    modified_at: isoOrNull(f.modifiedTime), created_at: isoOrNull(f.createdTime), hash: /^[0-9a-f]{32}$/.test(md5) ? "md5:" + md5 : null,
    trashed: f.trashed === true, seen_at: stamp, updated_at: stamp,
  };
}

// 열기 주소는 그 클라우드 보기 화면일 때만 돌려준다.
export function safeOpenUrl(source: Source, v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
    const h = u.hostname.toLowerCase();
    const ok = source === "gd"
      ? h === "docs.google.com" || h === "drive.google.com"
      : h === "onedrive.live.com" || h === "1drv.ms" || h.endsWith(".sharepoint.com");
    return ok ? u.toString() : null;
  } catch {
    return null;
  }
}

// 중계로 내보내는 종류. 그림·동영상·소리·PDF·글(plain)만 그 종류로, 나머지는 받기(attachment)로만 — 함수 주소에서 HTML·스크립트가 열리지 않게.
export function servedType(raw: string | null): { type: string; inline: boolean } {
  const t = (raw || "").split(";")[0].trim().toLowerCase();
  if (/^(image\/(jpeg|png|webp|gif|heic|heif|bmp)|video\/[a-z0-9.+-]{1,40}|audio\/[a-z0-9.+-]{1,40}|application\/pdf|text\/plain)$/.test(t)) {
    return { type: t, inline: true };
  }
  return { type: "application/octet-stream", inline: false };
}

const inList = (ids: string[]) => `in.(${ids.map((id) => `"${id}"`).join(",")})`;

export function createCloudFilesHandler(options: CloudFilesOptions) {
  const request = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => Date.now());
  const SB = options.env("SUPABASE_URL") || "";
  const SERVICE = options.env("SUPABASE_SERVICE_ROLE_KEY") || "";
  const ANON = options.env("SUPABASE_ANON_KEY") || "";
  const log = (code: string) => console.error("cloud_files:" + code);
  const at = () => new Date(now()).toISOString();

  async function call(stage: string, url: string, init: RequestInit = {}) {
    try {
      return await request(url, { redirect: "error", ...init, signal: AbortSignal.timeout(25000) });
    } catch {
      log(stage + "_unreachable");
      throw new Fail(503, "cloud_unavailable");
    }
  }
  async function body(r: Response) {
    try {
      return await r.json();
    } catch {
      return null;
    }
  }
  const drop = async (r: Response) => {
    try { await r.body?.cancel(); } catch { /* ignore */ }
  };

  // ---- Supabase(service role, PostgREST) ----
  async function db(stage: string, path: string, init: RequestInit = {}, prefer = "") {
    const r = await call("db_" + stage, `${SB}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, Accept: "application/json", "Content-Type": "application/json",
        ...(prefer ? { Prefer: prefer } : {}),
      },
    });
    if (!r.ok) {
      log("db_" + stage + "_" + r.status);
      await drop(r);
      throw new Fail(503, "store_unavailable");
    }
    if (r.status === 204) return null;
    return await body(r);
  }
  const rows = async (stage: string, path: string) => {
    const v = await db(stage, path);
    return Array.isArray(v) ? v as Record<string, unknown>[] : [];
  };

  // ---- 문: 로그인 → owner → files 기능(사용자 토큰) ----
  async function authorize(jwt: string) {
    const ur = await call("auth", `${SB}/auth/v1/user`, { headers: { apikey: ANON || SERVICE, Authorization: `Bearer ${jwt}` } });
    const user = await body(ur);
    if (ur.status >= 500) throw new Fail(503, "auth_unavailable");
    if (!ur.ok || typeof user?.id !== "string") throw new Fail(401, "session_required");
    const members = await rows("member", `app_workspace_members?user_id=eq.${encodeURIComponent(user.id)}&role=eq.owner&select=workspace_id`);
    if (members.length !== 1 || typeof members[0].workspace_id !== "string") throw new Fail(403, "forbidden");
    const fr = await call("features", `${SB}/rest/v1/rpc/app_my_features`, {
      method: "POST",
      headers: { apikey: ANON || SERVICE, Authorization: `Bearer ${jwt}`, Accept: "application/json", "Content-Type": "application/json" },
      body: "{}",
    });
    const features = fr.ok ? await body(fr) : null;
    if (!Array.isArray(features) || !features.includes(FEATURE)) throw new Fail(403, "feature_required");
    return { workspaceId: members[0].workspace_id as string };
  }
  // 구글: 그 작업공간이 files 허용 단 하나 + Drive 연결 작업공간일 때만(토큰이 프로젝트 전체 1개라서).
  async function gdOwner(workspaceId: string) {
    const allowed = await db("feature_ws", "rpc/app_operator_feature_workspace", { method: "POST", body: JSON.stringify({ p_feature: FEATURE }) });
    const driveWs = await rows("drive_ws", `app_workspaces?slug=eq.${DRIVE_WORKSPACE_SLUG}&select=id&limit=2`);
    if (allowed !== workspaceId || driveWs.length !== 1 || driveWs[0].id !== workspaceId) throw new Fail(403, "drive_owner_mismatch");
  }

  // ---- 구글 토큰(요청마다 새로, drive 범위 확인) ----
  async function gdToken(workspaceId: string): Promise<string> {
    await gdOwner(workspaceId);
    const c = (await rows("drive_cfg", "public_policy_drive_config?id=eq.1&select=google_client_id,google_client_secret,google_refresh_token"))[0];
    if (!c?.google_refresh_token) throw new Fail(424, "gd_not_connected");
    const r = await call("gd_token", "https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: String(c.google_client_id || ""), client_secret: String(c.google_client_secret || ""),
        refresh_token: String(c.google_refresh_token), grant_type: "refresh_token",
      }),
    });
    const d = await body(r);
    if (!r.ok || typeof d?.access_token !== "string" || !d.access_token) {
      log("gd_token_" + r.status);
      if (d?.error === "invalid_grant" || [400, 401].includes(r.status)) throw new Fail(424, "gd_auth_expired");
      throw new Fail(503, "cloud_unavailable");
    }
    let full = scopeHas(d.scope);
    if (typeof d.scope !== "string") {
      const ti = await call("gd_tokeninfo", "https://oauth2.googleapis.com/tokeninfo", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ access_token: d.access_token }),
      });
      full = ti.ok && scopeHas((await body(ti))?.scope);
    }
    if (!full) throw new Fail(424, "gd_scope_missing");
    return d.access_token;
  }

  // ---- 원드라이브 토큰(연결 행의 갱신 토큰, 범위 Files.ReadWrite 확인. 새 갱신 토큰이 오면 바꿔 저장) ----
  function odConfig() {
    const clientId = options.env("ONEDRIVE_CLIENT_ID") || "", secret = options.env("ONEDRIVE_CLIENT_SECRET") || "",
      tenant = options.env("ONEDRIVE_TENANT") || "common";
    if (!clientId || secret.length < 16 || !/^[A-Za-z0-9.-]{1,80}$/.test(tenant)) throw new Fail(424, "od_not_configured");
    return { clientId, secret, tenant };
  }
  async function odConnection(workspaceId: string) {
    const c = (await rows("od_conn", `app_onedrive_connections?workspace_id=eq.${workspaceId}&select=refresh_token,scope`))[0];
    if (!c || typeof c.refresh_token !== "string" || !c.refresh_token) throw new Fail(424, "od_not_connected");
    if (!scopeAllowed(normalizeScopes(c.scope))) throw new Fail(424, "od_reconnect_needed");
    return c as { refresh_token: string; scope: string };
  }
  async function odToken(workspaceId: string): Promise<string> {
    const conn = await odConnection(workspaceId);
    const c = odConfig();
    const r = await call("od_token", `https://login.microsoftonline.com/${c.tenant}/oauth2/v2.0/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: c.clientId, client_secret: c.secret, scope: OD_SCOPE, grant_type: "refresh_token", refresh_token: conn.refresh_token }),
    });
    const d = await body(r);
    if (!r.ok || typeof d?.access_token !== "string" || !d.access_token) {
      log("od_token_" + r.status);
      if (d?.error === "invalid_grant" || [400, 401].includes(r.status)) throw new Fail(424, "od_auth_expired");
      throw new Fail(503, "cloud_unavailable");
    }
    if (typeof d.refresh_token === "string" && d.refresh_token && d.refresh_token !== conn.refresh_token && d.refresh_token.length <= 4096) {
      await db("od_token_save", `app_onedrive_connections?workspace_id=eq.${workspaceId}`,
        { method: "PATCH", body: JSON.stringify({ refresh_token: d.refresh_token, updated_at: at() }) }, "return=minimal");
    }
    return d.access_token;
  }

  // ---- 클라우드 호출(상태 → 코드) ----
  async function cloud(stage: string, token: string, url: string, init: RequestInit = {}) {
    const r = await call(stage, url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
    if (r.status === 404) {
      await drop(r);
      throw new Fail(404, "not_found");
    }
    if (r.status === 429 || r.status === 503) {
      await drop(r);
      throw new Fail(503, "cloud_throttled");
    }
    if (r.status === 401 || r.status === 403) {
      await drop(r);
      log(stage + "_" + r.status);
      throw new Fail(424, "cloud_denied");
    }
    return r;
  }
  async function cloudJson(stage: string, token: string, url: string) {
    const r = await cloud(stage, token, url);
    if (!r.ok) {
      log(stage + "_" + r.status);
      await drop(r);
      if (r.status === 410) throw new Fail(410, "cursor_expired");
      if (r.status === 400) throw new Fail(400, "cloud_bad_request");
      throw new Fail(502, "cloud_unavailable");
    }
    const d = await body(r);
    if (!d || typeof d !== "object") throw new Fail(502, "cloud_unavailable");
    return d as Record<string, unknown>;
  }
  // 원드라이브가 302로 주는 임시 받기 주소(사전 인증, 토큰 없이)를 안전할 때만 따라간다.
  async function odRedirect(stage: string, token: string, url: string, headers: Record<string, string> = {}) {
    const first = await cloud(stage, token, url, { redirect: "manual" });
    if (first.status !== 302 && first.status !== 301 && first.status !== 307) {
      log(stage + "_" + first.status);
      await drop(first);
      throw new Fail(first.status === 406 || first.status === 400 ? 415 : 502, first.status === 406 || first.status === 400 ? "preview_unsupported" : "cloud_unavailable");
    }
    const loc = safeDownloadUrl(first.headers.get("location"));
    await drop(first);
    if (!loc) throw new Fail(502, "cloud_unavailable");
    const r = await call(stage + "_get", loc.toString(), { headers });
    if (!r.ok) {
      log(stage + "_get_" + r.status);
      await drop(r);
      throw new Fail(502, "cloud_unavailable");
    }
    return r;
  }

  // ---- 색인 ----
  async function upsertRows(stage: string, list: Record<string, unknown>[]) {
    for (let i = 0; i < list.length; i += UPSERT_CHUNK) {
      await db(stage, "app_cloud_items?on_conflict=workspace_id,source,item_id",
        { method: "POST", body: JSON.stringify(list.slice(i, i + UPSERT_CHUNK)) }, "resolution=merge-duplicates,return=minimal");
    }
  }
  // 지운 항목과 그 아래(폴더였다면)를 함께 뺀다. 폴더 아래는 40단계까지 따라간다.
  async function deleteTree(ws: string, source: Source, ids: string[]) {
    let level = [...new Set(ids)];
    const removed: string[] = [];
    for (let depth = 0; level.length && depth < MAX_DELETE_DEPTH; depth++) {
      const next: string[] = [];
      for (let i = 0; i < level.length; i += IN_CHUNK) {
        const part = level.slice(i, i + IN_CHUNK);
        const gone = await db("items_delete", `app_cloud_items?workspace_id=eq.${ws}&source=eq.${source}&item_id=${inList(part)}&select=item_id`,
          { method: "DELETE" }, "return=representation");
        for (const g of Array.isArray(gone) ? gone : []) removed.push(String(g.item_id));
        const kids = await rows("items_children", `app_cloud_items?workspace_id=eq.${ws}&source=eq.${source}&parent_id=${inList(part)}&select=item_id&limit=5000`);
        for (const k of kids) next.push(String(k.item_id));
      }
      level = [...new Set(next)];
    }
    if (removed.length) {
      for (let i = 0; i < removed.length; i += IN_CHUNK) {
        await db("stars_delete", `app_cloud_stars?workspace_id=eq.${ws}&source=eq.${source}&item_id=${inList(removed.slice(i, i + IN_CHUNK))}`,
          { method: "DELETE" }, "return=minimal");
      }
    }
    return removed;
  }
  async function syncRow(ws: string, source: Source) {
    await db("sync_row", "app_cloud_sync?on_conflict=workspace_id,source", { method: "POST", body: JSON.stringify({ workspace_id: ws, source }) },
      "resolution=ignore-duplicates,return=minimal");
    return (await rows("sync_read", `app_cloud_sync?workspace_id=eq.${ws}&source=eq.${source}` +
      "&select=source,cursor,next_page,scan_started_at,index_done_at,synced_at,lock_until,last_error"))[0];
  }
  async function lock(ws: string, source: Source) {
    const t = at(), until = new Date(now() + LOCK_MS).toISOString();
    const got = await db("sync_lock", `app_cloud_sync?workspace_id=eq.${ws}&source=eq.${source}&or=(lock_until.is.null,lock_until.lt.${encodeURIComponent(t)})`,
      { method: "PATCH", body: JSON.stringify({ lock_until: until, updated_at: t }) }, "return=representation");
    return Array.isArray(got) && got.length === 1;
  }
  async function save(ws: string, source: Source, patch: Record<string, unknown>) {
    await db("sync_save", `app_cloud_sync?workspace_id=eq.${ws}&source=eq.${source}`,
      { method: "PATCH", body: JSON.stringify({ ...patch, updated_at: at() }) }, "return=minimal");
  }
  // 처음 훑기가 끝나면 이번 훑기에서 안 보인 옛 줄(지워졌거나 내 것이 아니게 된 것)을 뺀다.
  async function sweep(ws: string, source: Source, since: string) {
    const gone = await db("items_sweep", `app_cloud_items?workspace_id=eq.${ws}&source=eq.${source}&seen_at=lt.${encodeURIComponent(since)}&select=item_id`,
      { method: "DELETE" }, "return=representation");
    const ids = (Array.isArray(gone) ? gone : []).map((g) => String(g.item_id));
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      await db("stars_sweep", `app_cloud_stars?workspace_id=eq.${ws}&source=eq.${source}&item_id=${inList(ids.slice(i, i + IN_CHUNK))}`,
        { method: "DELETE" }, "return=minimal");
    }
    return ids;
  }

  type Step = { changed: Record<string, unknown>[]; removed: string[]; more: boolean; done: boolean };

  // 원드라이브: /me/drive/root/delta 하나로 처음 훑기와 따라가기를 함께 한다(쪽 주소 next_page, 끝 주소 cursor).
  async function odStep(ws: string, s: Record<string, unknown>, token: string, step: Step) {
    const root = await cloudJson("od_root", token, `${GRAPH}/me/drive/root?$select=id`);
    if (!validItemId(root.id)) throw new Fail(502, "cloud_unavailable");
    const start = now();
    let url = (s.next_page as string) || (s.cursor as string) || `${GRAPH}/me/drive/root/delta?$select=${OD_SELECT}`;
    let scanFrom = s.scan_started_at as string | null;
    if (!s.cursor && !s.next_page) {
      scanFrom = at();
      await save(ws, "od", { scan_started_at: scanFrom, index_done_at: null });
    }
    for (let page = 0; page < SYNC_MAX_PAGES && now() - start < SYNC_BUDGET_MS; page++) {
      const safe = safeGraph(url);
      if (!safe) throw new Fail(502, "cloud_unavailable");
      let d: Record<string, unknown>;
      try {
        d = await cloudJson("od_delta", token, safe);
      } catch (e) {
        // 410(resyncRequired): 커서가 만료됐다. 그 출처만 처음부터 다시 훑는다(기존 색인은 남겨 둠, 끝나면 옛 줄만 뺌).
        if (e instanceof Fail && e.status === 410) {
          scanFrom = at();
          await save(ws, "od", { cursor: null, next_page: null, scan_started_at: scanFrom, index_done_at: null });
          url = `${GRAPH}/me/drive/root/delta?$select=${OD_SELECT}`;
          continue;
        }
        throw e;
      }
      const stamp = at();
      const items = Array.isArray(d.value) ? d.value as Record<string, unknown>[] : [];
      const list = items.map((it) => odRow(ws, root.id as string, it, stamp)).filter(Boolean) as Record<string, unknown>[];
      await upsertRows("od_upsert", list);
      step.changed.push(...list);
      const gone = items.filter((it) => it.deleted && validItemId(it.id)).map((it) => it.id as string);
      if (gone.length) step.removed.push(...await deleteTree(ws, "od", gone));
      const next = safeGraph(d["@odata.nextLink"]), delta = safeGraph(d["@odata.deltaLink"]);
      if (next) {
        url = next;
        await save(ws, "od", { next_page: next });
        continue;
      }
      if (!delta) throw new Fail(502, "cloud_unavailable");
      const patch: Record<string, unknown> = { cursor: delta, next_page: null, synced_at: at(), last_error: null };
      if (scanFrom) {
        step.removed.push(...await sweep(ws, "od", scanFrom));
        Object.assign(patch, { scan_started_at: null, index_done_at: at() });
      }
      await save(ws, "od", patch);
      step.done = true;
      return;
    }
    step.more = true;
  }
  const safeGraph = (v: unknown) => {
    if (typeof v !== "string") return null;
    try {
      const u = new URL(v);
      return u.protocol === "https:" && u.hostname === "graph.microsoft.com" && !u.username && !u.password && !u.port ? u.toString() : null;
    } catch {
      return null;
    }
  };

  // 구글: 처음 훑기는 changes 시작 토큰을 먼저 받아 cursor에 두고 files.list로 끝까지(next_page = "list:" + 쪽 토큰).
  //   끝나면 그 시작 토큰으로 changes.list를 따라간다(토큰은 만료되지 않음, Drive v3 changes.list 문서 2026-11-02 확인).
  async function gdStep(ws: string, s: Record<string, unknown>, token: string, step: Step) {
    const root = await cloudJson("gd_root", token, `${DRIVE}/files/root?fields=id`);
    if (!isGdId(root.id)) throw new Fail(502, "cloud_unavailable");
    const start = now();
    let cursor = s.cursor as string | null, nextPage = s.next_page as string | null, scanFrom = s.scan_started_at as string | null;
    if (!cursor || (!nextPage && !s.index_done_at)) {
      const t = await cloudJson("gd_start", token, `${DRIVE}/changes/startPageToken`);
      if (typeof t.startPageToken !== "string" || t.startPageToken.length > 4000) throw new Fail(502, "cloud_unavailable");
      cursor = t.startPageToken;
      nextPage = "list:";
      scanFrom = at();
      await save(ws, "gd", { cursor, next_page: nextPage, scan_started_at: scanFrom, index_done_at: null });
    }
    for (let page = 0; page < SYNC_MAX_PAGES && now() - start < SYNC_BUDGET_MS; page++) {
      const stamp = at();
      if (nextPage && nextPage.startsWith("list:")) {
        const u = new URL(`${DRIVE}/files`);
        u.searchParams.set("q", "'me' in owners and trashed=false");
        u.searchParams.set("spaces", "drive");
        u.searchParams.set("pageSize", "1000");
        u.searchParams.set("fields", `nextPageToken,files(${GD_FIELDS})`);
        if (nextPage.length > 5) u.searchParams.set("pageToken", nextPage.slice(5));
        const d = await cloudJson("gd_list", token, u.toString());
        const list = (Array.isArray(d.files) ? d.files as Record<string, unknown>[] : [])
          .map((f) => gdRow(ws, root.id as string, f, stamp)).filter(Boolean) as Record<string, unknown>[];
        await upsertRows("gd_upsert", list);
        step.changed.push(...list);
        if (typeof d.nextPageToken === "string" && d.nextPageToken && d.nextPageToken.length < 3990) {
          nextPage = "list:" + d.nextPageToken;
          await save(ws, "gd", { next_page: nextPage });
          continue;
        }
        if (scanFrom) step.removed.push(...await sweep(ws, "gd", scanFrom));
        nextPage = null;
        await save(ws, "gd", { next_page: null, scan_started_at: null, index_done_at: at() });
        continue;
      }
      const u = new URL(`${DRIVE}/changes`);
      u.searchParams.set("pageToken", cursor as string);
      u.searchParams.set("spaces", "drive");
      u.searchParams.set("restrictToMyDrive", "true");
      u.searchParams.set("includeRemoved", "true");
      u.searchParams.set("pageSize", "1000");
      u.searchParams.set("fields", `nextPageToken,newStartPageToken,changes(fileId,removed,file(${GD_FIELDS}))`);
      let d: Record<string, unknown>;
      try {
        d = await cloudJson("gd_changes", token, u.toString());
      } catch (e) {
        // 토큰이 받아들여지지 않으면(구글 400·410) 그 출처만 처음부터 다시 훑는다(일시 오류 5xx는 그대로 실패로 두고 다음에 다시).
        if (e instanceof Fail && (e.status === 410 || e.status === 400)) {
          await save(ws, "gd", { cursor: null, next_page: null, index_done_at: null, last_error: "GD_CURSOR_RESET" });
          step.more = true;
          return;
        }
        throw e;
      }
      const changes = Array.isArray(d.changes) ? d.changes as Record<string, unknown>[] : [];
      const up: Record<string, unknown>[] = [], gone: string[] = [];
      for (const c of changes) {
        const row = c.removed === true || !c.file ? null : gdRow(ws, root.id as string, c.file as Record<string, unknown>, stamp);
        if (row) up.push(row);
        else if (isGdId(c.fileId)) gone.push(c.fileId as string);
      }
      await upsertRows("gd_upsert", up);
      step.changed.push(...up);
      if (gone.length) step.removed.push(...await deleteTree(ws, "gd", gone));
      const next = typeof d.nextPageToken === "string" ? d.nextPageToken : null;
      const fresh = typeof d.newStartPageToken === "string" ? d.newStartPageToken : null;
      if (next && next.length <= 4000) {
        cursor = next;
        await save(ws, "gd", { cursor });
        continue;
      }
      if (!fresh || fresh.length > 4000) throw new Fail(502, "cloud_unavailable");
      await save(ws, "gd", { cursor: fresh, synced_at: at(), last_error: null });
      step.done = true;
      return;
    }
    step.more = true;
  }

  // ---- 대상 확인: 색인 안(그 작업공간·출처)에 있고 휴지통이 아닌 파일만 ----
  async function indexed(ws: string, source: Source, id: string, folderOk = false) {
    const r = (await rows("item_pick", `app_cloud_items?workspace_id=eq.${ws}&source=eq.${source}&item_id=eq.${encodeURIComponent(id)}` +
      "&select=item_id,name,is_folder,mime,trashed&limit=1"))[0];
    if (!r || r.trashed === true || (!folderOk && r.is_folder === true)) throw new Fail(404, "not_in_index");
    return r;
  }
  function target(b: Record<string, unknown>) {
    if (!isSource(b.source)) throw new Fail(400, "source_invalid");
    if (!isItemId(b.id) || (b.source === "gd" && !isGdId(b.id))) throw new Fail(400, "id_invalid");
    return { source: b.source, id: b.id };
  }
  const tokenFor = (ws: string, source: Source) => (source === "od" ? odToken(ws) : gdToken(ws));
  function stream(r: Response, extra: Record<string, string> = {}, name?: string) {
    const t = servedType(r.headers.get("content-type"));
    const out: Record<string, string> = {
      ...cors, "Content-Type": t.type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox", ...extra,
    };
    if (!t.inline) out["Content-Disposition"] = "attachment" + (name ? `; filename*=UTF-8''${encodeURIComponent(name)}` : "");
    for (const h of ["content-length", "content-range", "accept-ranges"]) {
      const v = r.headers.get(h);
      if (v) out[h] = v;
    }
    return new Response(r.body, { status: r.status === 206 ? 206 : 200, headers: out });
  }

  type Ctx = { workspaceId: string; body: Record<string, unknown>; req: Request };
  const actions: Record<string, (c: Ctx) => Promise<Response>> = {
    // 맞춘 상태(두 출처). 클라우드를 부르지 않는다(연결 여부는 저장된 값만).
    async status({ workspaceId }) {
      const sync = await rows("sync_all", `app_cloud_sync?workspace_id=eq.${workspaceId}&select=source,next_page,index_done_at,synced_at,last_error`);
      const od = (await rows("od_conn", `app_onedrive_connections?workspace_id=eq.${workspaceId}&select=scope`))[0];
      let gd = false;
      try {
        await gdOwner(workspaceId);
        gd = !!(await rows("drive_cfg", "public_policy_drive_config?id=eq.1&select=google_refresh_token"))[0]?.google_refresh_token;
      } catch (e) {
        if (!(e instanceof Fail) || e.status !== 403) throw e;
      }
      const one = (source: Source, connected: boolean) => {
        const s = sync.find((x) => x.source === source);
        return {
          connected, scanning: !!s && (!s.index_done_at || !!s.next_page), index_done_at: s?.index_done_at ?? null,
          synced_at: s?.synced_at ?? null, error: s?.last_error ?? null,
        };
      };
      return json({ ok: true, od: one("od", !!od && scopeAllowed(normalizeScopes(od.scope))), gd: one("gd", gd) });
    },
    // 바뀐 것만 색인에 반영하고 바뀐 줄을 돌려준다. 2분 안에 맞췄으면 클라우드를 부르지 않는다(F2). 동시에 두 번 돌지 않게 잠금.
    async sync({ workspaceId, body: b }) {
      const want: Source[] = b.source === undefined ? ["od", "gd"] : isSource(b.source) ? [b.source] : [];
      if (!want.length) throw new Fail(400, "source_invalid");
      const force = b.force === true;
      const out: Record<string, unknown> = {};
      const changed: Record<string, unknown>[] = [], removed: { source: Source; id: string }[] = [];
      for (const source of want) {
        let s: Record<string, unknown>, token: string;
        try {
          s = await syncRow(workspaceId, source);
          const age = s?.synced_at ? now() - Date.parse(String(s.synced_at)) : Infinity;
          const settled = !!s?.index_done_at && !s?.next_page;
          if (settled && (age < (force ? FORCE_MIN_MS : FRESH_MS))) {
            out[source] = { fresh: true };
            continue;
          }
          token = await tokenFor(workspaceId, source);
          if (!(await lock(workspaceId, source))) {
            out[source] = { busy: true };
            continue;
          }
        } catch (e) {
          if (e instanceof Fail && e.status === 424) {
            out[source] = { error: e.code };
            continue;
          }
          throw e;
        }
        const step: Step = { changed: [], removed: [], more: false, done: false };
        try {
          if (source === "od") await odStep(workspaceId, s, token, step);
          else await gdStep(workspaceId, s, token, step);
        } catch (e) {
          const code = e instanceof Fail ? e.code.toUpperCase() : "UNEXPECTED";
          await save(workspaceId, source, { last_error: (source.toUpperCase() + "_" + code).slice(0, 80) }).catch(() => log("sync_error_save_failed"));
          if (!(e instanceof Fail)) log("sync_unexpected");
          out[source] = { error: e instanceof Fail ? e.code : "cloud_unavailable" };
        } finally {
          await save(workspaceId, source, { lock_until: null }).catch(() => log("sync_unlock_failed"));
        }
        changed.push(...step.changed);
        removed.push(...step.removed.map((id) => ({ source, id })));
        out[source] = { ...(out[source] as object || {}), more: step.more, done: step.done };
      }
      const reload = changed.length + removed.length > CHANGED_MAX;
      const pick = (r: Record<string, unknown>) => ({
        source: r.source, item_id: r.item_id, parent_id: r.parent_id, name: r.name, is_folder: r.is_folder, mime: r.mime,
        size_bytes: r.size_bytes, modified_at: r.modified_at, hash: r.hash, trashed: r.trashed,
      });
      return json({ ok: true, ...out, reload, changed: reload ? [] : changed.map(pick), removed: reload ? [] : removed });
    },
    // 썸네일(서버 중계). 색인 안 파일만. 그림만 돌려준다.
    async thumb({ workspaceId, body: b }) {
      const { source, id } = target(b);
      const size = b.size === "large" ? "large" : "small";
      await indexed(workspaceId, source, id);
      const token = await tokenFor(workspaceId, source);
      let r: Response;
      if (source === "od") {
        r = await odRedirect("od_thumb", token, `${GRAPH}/me/drive/items/${encodeURIComponent(id)}/thumbnails/0/${THUMB.od[size]}/content`);
      } else {
        const f = await cloudJson("gd_thumb_meta", token, `${DRIVE}/files/${encodeURIComponent(id)}?fields=id,trashed,thumbnailLink`);
        const link = typeof f.thumbnailLink === "string" ? new URL(f.thumbnailLink) : null;
        if (f.trashed === true || !link || link.protocol !== "https:" || !link.hostname.endsWith(".googleusercontent.com")) throw new Fail(404, "thumb_unavailable");
        r = await call("gd_thumb", link.href.replace(/=s\d+$/, "") + `=s${THUMB.gd[size]}`, { headers: { Authorization: `Bearer ${token}` } });
      }
      const type = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      const bytes = r.ok ? new Uint8Array(await r.arrayBuffer()) : new Uint8Array();
      if (!/^image\/(jpeg|png|webp|gif)$/.test(type) || !bytes.length || bytes.length > MAX_IMAGE) throw new Fail(502, "thumb_unavailable");
      return new Response(bytes, { headers: { ...cors, "Content-Type": type, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
    },
    // 원본(서버 중계, Range 그대로). 색인 안 파일만. 그림·동영상·소리·PDF·글만 그 종류로, 나머지는 받기로.
    async media({ workspaceId, body: b, req }) {
      const { source, id } = target(b);
      const item = await indexed(workspaceId, source, id);
      if (source === "gd" && typeof item.mime === "string" && item.mime.startsWith("application/vnd.google-apps.")) throw new Fail(415, "media_unsupported");
      const token = await tokenFor(workspaceId, source);
      const range = req.headers.get("range");
      const headers: Record<string, string> = range && /^bytes=\d{0,15}-\d{0,15}$/.test(range) ? { Range: range } : {};
      const r = source === "od"
        ? await odRedirect("od_media", token, `${GRAPH}/me/drive/items/${encodeURIComponent(id)}/content`, headers)
        : await cloud("gd_media", token, `${DRIVE}/files/${encodeURIComponent(id)}?alt=media`, { headers });
      if (!r.ok) {
        log("media_" + r.status);
        await drop(r);
        throw new Fail(502, "cloud_unavailable");
      }
      return stream(r, {}, String(item.name || ""));
    },
    // 미리보기 PDF(F4): 원드라이브 오피스는 Graph format=pdf, 구글 문서류는 export pdf. 올린 오피스(구글)·그 밖은 415(화면은 [열기]).
    async preview({ workspaceId, body: b }) {
      const { source, id } = target(b);
      const item = await indexed(workspaceId, source, id);
      const name = String(item.name || ""), mime = String(item.mime || "");
      const token = await tokenFor(workspaceId, source);
      let r: Response;
      if (source === "od") {
        if (!OD_PDF_EXT.test(name)) throw new Fail(415, "preview_unsupported");
        r = await odRedirect("od_pdf", token, `${GRAPH}/me/drive/items/${encodeURIComponent(id)}/content?format=pdf`);
      } else {
        if (!GD_EXPORT_MIME.test(mime)) throw new Fail(415, "preview_unsupported");
        r = await cloud("gd_pdf", token, `${DRIVE}/files/${encodeURIComponent(id)}/export?mimeType=application%2Fpdf`);
        if (!r.ok) {
          log("gd_pdf_" + r.status);
          await drop(r);
          throw new Fail(r.status === 403 || r.status === 400 ? 415 : 502, r.status === 403 || r.status === 400 ? "preview_unsupported" : "cloud_unavailable");
        }
      }
      const len = Number(r.headers.get("content-length"));
      if (Number.isFinite(len) && len > PREVIEW_MAX) {
        await drop(r);
        throw new Fail(413, "preview_too_large");
      }
      const type = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (type !== "application/pdf" && type !== "application/octet-stream") {
        await drop(r);
        throw new Fail(502, "preview_unavailable");
      }
      return new Response(r.body, {
        headers: {
          ...cors, "Content-Type": "application/pdf", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox", ...(Number.isFinite(len) && len > 0 ? { "content-length": String(len) } : {}),
        },
      });
    },
    // 클라우드 보기 주소(새 창으로 엶). 그때 받아 돌려주고 저장하지 않는다. 폴더도 된다.
    async "open-url"({ workspaceId, body: b }) {
      const { source, id } = target(b);
      await indexed(workspaceId, source, id, true);
      const token = await tokenFor(workspaceId, source);
      const d = source === "od"
        ? await cloudJson("od_open", token, `${GRAPH}/me/drive/items/${encodeURIComponent(id)}?$select=id,webUrl`)
        : await cloudJson("gd_open", token, `${DRIVE}/files/${encodeURIComponent(id)}?fields=id,webViewLink`);
      const url = safeOpenUrl(source, source === "od" ? d.webUrl : d.webViewLink);
      if (!url) throw new Fail(502, "open_unavailable");
      return json({ ok: true, url });
    },
  };

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    try {
      if (!SB || !SERVICE) throw new Fail(503, "not_ready");
      const m = (req.headers.get("Authorization") || "").match(/^Bearer\s+(\S+)$/i);
      if (!m) throw new Fail(401, "session_required");
      if (req.method !== "POST") return json({ ok: false, error: "post_only" }, 405);
      const who = await authorize(m[1]);
      if ((req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() !== "application/json") throw new Fail(415, "json_required");
      const text = await req.text();
      if (text.length > MAX_BODY) throw new Fail(413, "body_too_large");
      let b: Record<string, unknown>;
      try {
        b = JSON.parse(text);
      } catch {
        throw new Fail(400, "json_invalid");
      }
      if (!b || typeof b !== "object" || Array.isArray(b)) throw new Fail(400, "json_invalid");
      const action = b.action;
      if (typeof action !== "string" || !Object.hasOwn(actions, action)) throw new Fail(400, "action_invalid");
      return await actions[action]({ workspaceId: who.workspaceId, body: b, req });
    } catch (e) {
      if (e instanceof Fail) return json({ ok: false, error: e.code }, e.status);
      log("unexpected");
      return json({ ok: false, error: "cloud_unavailable" }, 500);
    }
  };
}
