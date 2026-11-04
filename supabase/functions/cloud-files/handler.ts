// S48-12b 파일 탐색기 ③ Edge(FILES-클라우드탐색기, 명진 결정 F1~F9 11/02). 설계: docs/design/files-explorer.md 3·4·5절, 7절 ③.
// 읽기: status(맞춘 상태) · sync(바뀐 것만 색인에 반영) · thumb(썸네일 중계) · media(원본 중계, Range) · preview(오피스·구글 문서 → PDF)
//   · open-url(클라우드 보기 주소).
// 쓰기(S48-45 ⑤·⑦, 모두 confirm:true + 색인 안 항목만): rename(이름) · mkdir(새 폴더) · move(같은 클라우드 안, 한 번에 200개까지)
//   · trash(그 클라우드 휴지통으로, F1: 원드라이브는 원드라이브 자체 휴지통) · across(원드라이브↔구글, F8: 한 번에 1개·200MB까지,
//   받는 대로 보내며 크기·해시를 맞춘 뒤에만 원본을 휴지통으로). 쓰기 결과는 같은 요청 안에서 색인에 반영하고 바뀐 줄을 돌려준다.
//   copy(FILES-통합 2-①: 1개씩, 같은 클라우드는 파일·폴더째, 클라우드 사이는 파일만 across와 같은 길, 원본은 그대로).
//   같은 이름은 덮어쓰지 않고 번호를 붙인다(H-3: copy·across는 늘, move는 numbered:true일 때). 자동·예약 쓰기는 없다(사람이 누른 요청만).
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
import { checkFileBase, numberedName } from "../_shared/file-rename-name.mjs";
import { Md5, Sha1 } from "./hash.ts";
import {
  ACTIVE as JOB_ACTIVE, BIG_BYTES, BIG_MAX_BYTES, JOB_ADD_MAX, JOB_COLUMNS, JOB_LIST_HOURS, JOB_LIST_MAX, JOB_STEP_MS, LEASE_MS, MAX_ATTEMPTS,
  TICK_HEADER, TICK_TTL_MS, gdOffset, jobCode, jobView, needsKick, nextRange, odOffset, parseAdd, parseIds, rangeOk, tickCheck, tickSign,
} from "./jobs.mjs";

type Env = (name: string) => string | undefined;
export type CloudFilesOptions = { fetch?: typeof fetch; env: Env; now?: () => number; background?: (p: Promise<unknown>) => void };
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
// 폴더 직접 읽기: 클라우드 쪽 상한(원드라이브 200개×쪽, 구글 1000개×쪽).
const FOLDER_MAX_PAGES = 10;
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
  // 폴더도 파일도 아닌 항목(개인 중요 보관소 vault·OneNote 묶음 등)은 색인에 넣지 않는다. 넣으면 종류 없는 0B 파일로 보인다(열어서 읽지도 않음).
  if (!folder && !file) return null;
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

// ---- 쓰기 규칙(S48-45) ----
// 같은 클라우드 안 옮기기·휴지통은 한 번에 200개까지(설계 3절). 클라우드 사이는 1개·200MB까지(F8).
export const WRITE_MAX = 200;
export const ACROSS_MAX_BYTES = 200 * 1024 * 1024;
// 이어 올리기 조각: 원드라이브는 320KiB, 구글은 256KiB의 배수여야 한다(10MiB = 둘 다의 배수).
export const UPLOAD_CHUNK = 10 * 1024 * 1024;
const OD_SIMPLE_MAX = 4 * 1024 * 1024;
const WRITE_CONCURRENCY = 4, WRITE_BUDGET_MS = 40000, ACROSS_MS = 300000;
// 복사(2-①): 원드라이브 뒤 진행 확인은 1초 간격 20번까지(늦으면 pending — 다음 맞추기가 들여온다), 구글 폴더째 복사는 안쪽 200개·120초까지.
export const COPY_TREE_MAX = 200;
const COPY_POLLS = 20, COPY_POLL_MS = 1000, COPY_TREE_MS = 120000;

// 새 이름 검사: 자료실 이름 고치기와 같은 규칙(_shared/file-rename-name.mjs — 빈 이름·/ \ : * ? " < > |·제어 글자·점으로 끝남·120자 넘음 거절).
export function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const r = checkFileBase(v);
  return r.ok ? r.base as string : null;
}
// 여러 개 고른 id: 1~200개, 모양이 맞고 겹치지 않을 때만.
export function idList(v: unknown, source: Source): string[] | null {
  if (!Array.isArray(v) || !v.length || v.length > WRITE_MAX) return null;
  const ok = v.every((id) => isItemId(id) && (source !== "gd" || isGdId(id)));
  return ok && new Set(v).size === v.length ? v as string[] : null;
}
// 같은 이름이 있으면 '이름 (2).확장자'처럼 비는 이름을 찾는다(대소문자 무시 — 원드라이브 규칙). 규칙은 화면과 같은 공용 함수 하나(H-3).
export function uniqueName(name: string, taken: Iterable<string>): string {
  return numberedName(name, taken);
}
// 이어 올리기 주소는 그 클라우드 올리기 주소일 때만 따라간다(토큰 없이 조각을 보내는 주소).
export function safeUploadUrl(dest: Source, v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
    const h = u.hostname.toLowerCase();
    const ok = dest === "gd"
      ? h === "www.googleapis.com" && u.pathname.startsWith("/upload/drive/v3/files")
      : h === "graph.microsoft.com" || h === "api.onedrive.com" || h.endsWith(".onedrive.com") || h.endsWith(".1drv.com") || h.endsWith(".sharepoint.com");
    return ok ? u.toString() : null;
  } catch {
    return null;
  }
}
// 원드라이브 복사 진행 확인 주소(토큰 없이 읽음)는 원드라이브 주소일 때만 따라간다.
export function safeMonitorUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
    const h = u.hostname.toLowerCase();
    const ok = h === "api.onedrive.com" || h.endsWith(".onedrive.com") || h.endsWith(".1drv.com") || h.endsWith(".sharepoint.com") ||
      h === "my.microsoftpersonalcontent.com" || h.endsWith(".microsoftpersonalcontent.com");
    return ok ? u.toString() : null;
  } catch {
    return null;
  }
}
// 화면에 돌려주는 색인 줄 모양(sync 응답과 같음).
const pickRow = (r: Record<string, unknown>) => ({
  source: r.source, item_id: r.item_id, parent_id: r.parent_id, name: r.name, is_folder: r.is_folder, mime: r.mime,
  size_bytes: r.size_bytes, modified_at: r.modified_at, hash: r.hash, trashed: r.trashed,
});

const inList = (ids: string[]) => `in.(${ids.map((id) => `"${id}"`).join(",")})`;

export function createCloudFilesHandler(options: CloudFilesOptions) {
  const request = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => Date.now());
  const SB = options.env("SUPABASE_URL") || "";
  const SERVICE = options.env("SUPABASE_SERVICE_ROLE_KEY") || "";
  const ANON = options.env("SUPABASE_ANON_KEY") || "";
  const log = (code: string) => console.error("cloud_files:" + code);
  const at = () => new Date(now()).toISOString();

  async function call(stage: string, url: string, init: RequestInit = {}, ms = 25000) {
    try {
      return await request(url, { redirect: "error", ...init, signal: AbortSignal.timeout(ms) });
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
    return { workspaceId: members[0].workspace_id as string, userId: user.id as string };
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
  async function cloud(stage: string, token: string, url: string, init: RequestInit = {}, ms = 25000) {
    const r = await call(stage, url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } }, ms);
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
  async function odRedirect(stage: string, token: string, url: string, headers: Record<string, string> = {}, ms = 25000) {
    const first = await cloud(stage, token, url, { redirect: "manual" });
    if (first.status !== 302 && first.status !== 301 && first.status !== 307) {
      log(stage + "_" + first.status);
      await drop(first);
      throw new Fail(first.status === 406 || first.status === 400 ? 415 : 502, first.status === 406 || first.status === 400 ? "preview_unsupported" : "cloud_unavailable");
    }
    const loc = safeDownloadUrl(first.headers.get("location"));
    await drop(first);
    if (!loc) throw new Fail(502, "cloud_unavailable");
    const r = await call(stage + "_get", loc.toString(), { headers }, ms);
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

  // ---- 쓰기 도움(S48-45) ----
  // 클라우드에 바꾸는 요청. 같은 이름(409·412)은 name_taken. 그 밖 실패는 코드로만(본문·이름은 로그에 남기지 않음).
  async function cloudWrite(stage: string, token: string, url: string, method: "POST" | "PATCH" | "DELETE", payload?: unknown) {
    const r = await cloud(stage, token, url, {
      method, ...(payload === undefined ? {} : { body: JSON.stringify(payload), headers: { "Content-Type": "application/json; charset=utf-8" } }),
    });
    if (r.status === 409 || r.status === 412) {
      await drop(r);
      throw new Fail(409, "name_taken");
    }
    if (!r.ok) {
      log(stage + "_" + r.status);
      await drop(r);
      throw new Fail(r.status === 400 ? 400 : 502, r.status === 400 ? "cloud_bad_request" : "cloud_unavailable");
    }
    if (r.status === 204) return {} as Record<string, unknown>;
    return ((await body(r)) || {}) as Record<string, unknown>;
  }
  const mustConfirm = (b: Record<string, unknown>) => {
    if (b.confirm !== true) throw new Fail(400, "confirm_required");
  };
  async function rootId(source: Source, token: string) {
    const d = source === "od" ? await cloudJson("od_root", token, `${GRAPH}/me/drive/root?$select=id`) : await cloudJson("gd_root", token, `${DRIVE}/files/root?fields=id`);
    if (source === "od" ? !validItemId(d.id) : !isGdId(d.id)) throw new Fail(502, "cloud_unavailable");
    return d.id as string;
  }
  const rowOf = (ws: string, source: Source, root: string, d: Record<string, unknown>) => {
    const row = source === "od" ? odRow(ws, root, d, at()) : gdRow(ws, root, d, at());
    if (!row) throw new Fail(502, "cloud_unavailable");
    return row as Record<string, unknown>;
  };
  async function manyIndexed(ws: string, source: Source, ids: string[]) {
    const found: Record<string, unknown>[] = [];
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      found.push(...await rows("items_pick", `app_cloud_items?workspace_id=eq.${ws}&source=eq.${source}&item_id=${inList(ids.slice(i, i + IN_CHUNK))}` +
        "&select=item_id,parent_id,name,is_folder,mime,size_bytes,hash,trashed&limit=200"));
    }
    const byId = new Map(found.map((r) => [String(r.item_id), r]));
    const list = ids.map((id) => byId.get(id));
    if (list.some((r) => !r || r.trashed === true)) throw new Fail(404, "not_in_index");
    return list as Record<string, unknown>[];
  }
  // 옮길 곳 폴더(null = 맨 위). 색인 안 폴더만.
  async function folderOrRoot(ws: string, source: Source, v: unknown) {
    if (v === null || v === undefined || v === "") return null;
    if (!isItemId(v) || (source === "gd" && !isGdId(v))) throw new Fail(400, "dest_invalid");
    const f = await indexed(ws, source, v, true);
    if (f.is_folder !== true) throw new Fail(400, "dest_invalid");
    return v;
  }
  async function siblingNames(ws: string, source: Source, parent: string | null) {
    const list = await rows("items_siblings", `app_cloud_items?workspace_id=eq.${ws}&source=eq.${source}` +
      `&parent_id=${parent ? "eq." + encodeURIComponent(parent) : "is.null"}&trashed=eq.false&select=item_id,name&limit=5000`);
    return list;
  }
  // 폴더 자기 자신이나 그 아래로 옮기지 않게: 옮길 곳에서 맨 위까지 올라가며 고른 것이 있는지 본다.
  async function ancestors(ws: string, source: Source, id: string | null) {
    const out: string[] = [];
    for (let cur = id, depth = 0; cur && depth <= MAX_DELETE_DEPTH; depth++) {
      out.push(cur);
      const r = (await rows("items_up", `app_cloud_items?workspace_id=eq.${ws}&source=eq.${source}&item_id=eq.${encodeURIComponent(cur)}&select=parent_id&limit=1`))[0];
      cur = typeof r?.parent_id === "string" ? r.parent_id : null;
    }
    return out;
  }
  // 그 클라우드 휴지통으로(F1). 원드라이브 DELETE /me/drive/items/{id}는 원드라이브 휴지통으로 간다(영구 삭제는 별도 동작이고 쓰지 않음).
  //   구글은 trashed:true로만(구글 DELETE는 영구 삭제라 쓰지 않음).
  async function toTrash(source: Source, token: string, id: string) {
    if (source === "od") await cloudWrite("od_trash", token, `${GRAPH}/me/drive/items/${encodeURIComponent(id)}`, "DELETE");
    else await cloudWrite("gd_trash", token, `${DRIVE}/files/${encodeURIComponent(id)}?fields=id,trashed`, "PATCH", { trashed: true });
  }
  // 여러 개를 4개씩 동시에, 40초 안에 시작한 것만. 못 한 것은 left로 돌려주고 화면이 이어서 부른다.
  async function eachLimited(ids: string[], work: (id: string) => Promise<void>) {
    const start = now(), failed: { id: string; error: string }[] = [], left: string[] = [];
    let next = 0;
    const lane = async () => {
      for (;;) {
        const i = next++;
        if (i >= ids.length) return;
        if (now() - start > WRITE_BUDGET_MS) {
          left.push(ids[i]);
          continue;
        }
        try {
          await work(ids[i]);
        } catch (e) {
          if (!(e instanceof Fail)) log("write_unexpected");
          failed.push({ id: ids[i], error: e instanceof Fail ? e.code : "cloud_unavailable" });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(WRITE_CONCURRENCY, ids.length) }, lane));
    return { failed, left };
  }

  // ---- 클라우드 사이 옮기기(⑦): 받는 대로 조각을 보낸다. 크기·해시를 센다. ----
  type Sent = { bytes: number; md5: string; sha1: string; result: Record<string, unknown> };
  async function* chunks(r: Response) {
    const reader = r.body?.getReader();
    if (!reader) return;
    let buf = new Uint8Array(UPLOAD_CHUNK), fill = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      let i = 0;
      while (i < value.length) {
        const n = Math.min(UPLOAD_CHUNK - fill, value.length - i);
        buf.set(value.subarray(i, i + n), fill);
        fill += n;
        i += n;
        if (fill === UPLOAD_CHUNK) {
          yield buf;
          buf = new Uint8Array(UPLOAD_CHUNK);
          fill = 0;
        }
      }
    }
    if (fill) yield buf.subarray(0, fill);
  }
  // 이어 올리기 자리를 연다(원드라이브 upload session·구글 resumable). 주소 자체가 쓰기 권한이라 응답·로그에 싣지 않는다.
  async function openUpload(dest: Source, token: string, parent: string | null, name: string, size: number, mime: string): Promise<string> {
    let upUrl: string | null;
    if (dest === "od") {
      const where = parent ? `items/${encodeURIComponent(parent)}` : "root";
      const d = await cloudWrite("od_session", token, `${GRAPH}/me/drive/${where}:/${encodeURIComponent(name)}:/createUploadSession`, "POST",
        { item: { "@microsoft.graph.conflictBehavior": "rename", name } });
      upUrl = safeUploadUrl("od", d.uploadUrl);
    } else {
      const r = await cloud("gd_session", token, `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=${GD_FIELDS}`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Length": String(size), "X-Upload-Content-Type": mime || "application/octet-stream" },
        body: JSON.stringify({ name, parents: [parent ?? "root"] }),
      });
      upUrl = r.ok ? safeUploadUrl("gd", r.headers.get("location")) : null;
      if (!r.ok) log("gd_session_" + r.status);
      await drop(r);
    }
    if (!upUrl) throw new Fail(502, "upload_failed");
    return upUrl;
  }
  async function sendAcross(dest: Source, token: string, parent: string | null, name: string, size: number, mime: string, src: Response): Promise<Sent> {
    const md5 = new Md5(), sha1 = new Sha1();
    let sent = 0, result: Record<string, unknown> | null = null;
    if (dest === "od" && size <= OD_SIMPLE_MAX) {
      // 작은 파일(0바이트 포함)은 한 번에(이어 올리기는 0바이트를 받지 않음).
      const parts: Uint8Array[] = [];
      for await (const c of chunks(src)) parts.push(c.slice());
      const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      parts.reduce((o, p) => (all.set(p, o), o + p.length), 0);
      if (all.length !== size) throw new Fail(502, "size_mismatch");
      md5.update(all); sha1.update(all); sent = all.length;
      const where = parent ? `items/${encodeURIComponent(parent)}` : "root";
      const r = await cloud("od_put", token, `${GRAPH}/me/drive/${where}:/${encodeURIComponent(name)}:/content?@microsoft.graph.conflictBehavior=rename`,
        { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: all });
      if (!r.ok) {
        log("od_put_" + r.status);
        await drop(r);
        throw new Fail(502, "upload_failed");
      }
      result = await body(r);
      return { bytes: sent, md5: md5.hex(), sha1: sha1.hex(), result: result || {} };
    }
    const upUrl = await openUpload(dest, token, parent, name, size, mime);
    const put = async (part: Uint8Array<ArrayBuffer> | null) => {
      const range = part ? `bytes ${sent}-${sent + part.length - 1}/${size}` : `bytes */${size}`;
      // 이어 올리기 주소는 그 자체가 권한이라 토큰을 붙이지 않는다.
      const r = await call(dest + "_chunk", upUrl as string, {
        method: "PUT", headers: { "Content-Range": range, "Content-Length": String(part ? part.length : 0) }, body: part ?? new Uint8Array(),
      }, 120000);
      if (r.status === 308 || r.status === 202) {
        await drop(r);
        return null;
      }
      if (!r.ok) {
        log(dest + "_chunk_" + r.status);
        await drop(r);
        throw new Fail(502, "upload_failed");
      }
      return (await body(r)) as Record<string, unknown> | null;
    };
    for await (const c of chunks(src)) {
      if (sent + c.length > size) throw new Fail(502, "size_mismatch");
      md5.update(c); sha1.update(c);
      result = await put(c);
      sent += c.length;
    }
    if (sent !== size) throw new Fail(502, "size_mismatch");
    if (!result && size === 0) result = await put(null);
    if (!result) throw new Fail(502, "upload_failed");
    return { bytes: sent, md5: md5.hex(), sha1: sha1.hex(), result };
  }

  // 클라우드 사이 보내기(across 옮기기·copy 복사 공용, ⑦·2-①): 파일 1개·200MB까지. 구글 문서류(받을 수 없는 것)·폴더는 안 됨.
  //   원본을 받는 대로 새 곳에 조각으로 보내고, 보낸 크기 = 원본 크기 = 새 파일 크기, 해시(원본 색인·새 파일이 주는 것)가 맞을 때만 새 줄을 색인에 넣는다.
  //   맞지 않으면 새로 만든 것을 그 클라우드 휴지통으로 보내고 verify_failed. 원본은 여기서 건드리지 않는다(옮기기면 부른 쪽이 휴지통으로).
  //   받을 곳에 같은 이름이 있으면 번호를 붙여 둘 다 둔다(H-3, 덮어쓰기 없음).
  async function sendBetween(ws: string, source: Source, id: string, dest: Source, toRaw: unknown) {
    const item = (await manyIndexed(ws, source, [id]))[0];
    if (item.is_folder === true) throw new Fail(400, "across_folder");
    const mime = String(item.mime || "");
    if (source === "gd" && mime.startsWith("application/vnd.google-apps.")) throw new Fail(415, "across_unsupported");
    const size = Number(item.size_bytes);
    if (item.size_bytes === null || !Number.isSafeInteger(size) || size < 0) throw new Fail(400, "size_unknown");
    if (size > ACROSS_MAX_BYTES) throw new Fail(413, "too_large");
    const to = await folderOrRoot(ws, dest, toRaw);
    const name = uniqueName(String(item.name), (await siblingNames(ws, dest, to)).map((r) => String(r.name)));
    const srcToken = await tokenFor(ws, source), dstToken = await tokenFor(ws, dest);
    const dstRoot = await rootId(dest, dstToken);
    const src = source === "od"
      ? await odRedirect("od_across_get", srcToken, `${GRAPH}/me/drive/items/${encodeURIComponent(id)}/content`, {}, ACROSS_MS)
      : await cloud("gd_across_get", srcToken, `${DRIVE}/files/${encodeURIComponent(id)}?alt=media`, {}, ACROSS_MS);
    if (!src.ok) {
      log("across_get_" + src.status);
      await drop(src);
      throw new Fail(502, "cloud_unavailable");
    }
    const len = src.headers.get("content-length");
    if (len !== null && Number(len) !== size) {
      await drop(src);
      throw new Fail(409, "changed_since_index");
    }
    const sent = await sendAcross(dest, dstToken, to, name, size, mime, src);
    const row = rowOf(ws, dest, dstRoot, sent.result);
    // 맞추기: 크기, 원본 색인 해시, 새 파일 해시(구글 md5 / 원드라이브 sha1, 있는 것만).
    const srcHash = String(item.hash || ""), dstHash = String(row.hash || "");
    const mine = (h: string) => h.startsWith("md5:") ? h === "md5:" + sent.md5 : h.startsWith("sha1:") ? h === "sha1:" + sent.sha1 : true;
    const good = sent.bytes === size && row.size_bytes === size && mine(srcHash) && mine(dstHash);
    if (!good) {
      log("across_verify_failed");
      await toTrash(dest, dstToken, String(row.item_id)).catch(() => log("across_cleanup_failed"));
      throw new Fail(502, "verify_failed");
    }
    await upsertRows("write_upsert", [row]);
    return { row, srcToken };
  }

  // ---- 같은 클라우드 안 복사(2-①) ----
  // 원드라이브 copy는 뒤에서 진행한다(202 + 진행 확인 주소). 진행 확인 주소는 토큰 없이 읽는 주소라 그 클라우드 주소일 때만 따라간다.
  async function odCopy(ws: string, token: string, root: string, id: string, to: string | null, name: string, folder: boolean) {
    const drive = await cloudJson("od_drive", token, `${GRAPH}/me/drive?$select=id`);
    if (typeof drive.id !== "string" || !/^[A-Za-z0-9!_.-]{1,200}$/.test(drive.id)) throw new Fail(502, "cloud_unavailable");
    const r = await cloud("od_copy", token, `${GRAPH}/me/drive/items/${encodeURIComponent(id)}/copy?@microsoft.graph.conflictBehavior=rename`, {
      method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ parentReference: { driveId: drive.id, id: to ?? root }, name }),
    });
    if (r.status === 409 || r.status === 412) {
      await drop(r);
      throw new Fail(409, "name_taken");
    }
    if (r.status !== 202) {
      log("od_copy_" + r.status);
      await drop(r);
      throw new Fail(r.status === 400 ? 400 : 502, r.status === 400 ? "cloud_bad_request" : "cloud_unavailable");
    }
    const monitor = safeMonitorUrl(r.headers.get("location"));
    await drop(r);
    if (!monitor) return { ok: true, changed: [], removed: [], pending: true };
    let newId: string | null = null;
    for (let i = 0; i < COPY_POLLS; i++) {
      if (i) await new Promise((ok) => setTimeout(ok, COPY_POLL_MS));
      const m = await call("od_copy_monitor", monitor, { redirect: "manual" }, 15000);
      const d = m.status === 200 || m.status === 202 ? await body(m) as Record<string, unknown> | null : (await drop(m), null);
      if (m.status >= 300 && m.status < 400) break; // 끝났고 새 항목으로 넘기는 경우: 다음 맞추기가 들여온다.
      const st = String(d?.status || "");
      if (st === "failed") throw new Fail(502, "copy_failed");
      if (st === "completed") {
        newId = validItemId(d?.resourceId) ? String(d?.resourceId) : null;
        break;
      }
    }
    if (!newId) return { ok: true, changed: [], removed: [], pending: true };
    const it = await cloudJson("od_copy_item", token, `${GRAPH}/me/drive/items/${encodeURIComponent(newId)}?$select=${OD_SELECT}`);
    const row = rowOf(ws, "od", root, it);
    await upsertRows("write_upsert", [row]);
    // 폴더째 복사면 안쪽 줄은 다음 맞추기(delta)가 들여온다.
    return { ok: true, changed: [pickRow(row)], removed: [], reload: folder };
  }
  // 구글 files.copy는 파일만 된다. 폴더는 같은 이름 폴더를 만들고 안을 차례로(폴더는 새로 만들고, 파일은 copy) — 먼저 읽기만으로 개수를 세어
  //   COPY_TREE_MAX를 넘거나 너무 깊으면 아무것도 쓰기 전에 folder_too_big. 다 만든 줄은 같은 요청 안에서 색인에 넣는다.
  async function gdChildren(token: string, pid: string) {
    const out: Record<string, unknown>[] = [];
    let pageToken = "";
    for (let page = 0; page < FOLDER_MAX_PAGES; page++) {
      const u = new URL(`${DRIVE}/files`);
      u.searchParams.set("q", `'${pid}' in parents and 'me' in owners and trashed=false`);
      u.searchParams.set("spaces", "drive");
      u.searchParams.set("pageSize", "1000");
      u.searchParams.set("fields", `nextPageToken,files(${GD_FIELDS})`);
      if (pageToken) u.searchParams.set("pageToken", pageToken);
      const d = await cloudJson("gd_children", token, u.toString());
      for (const f of Array.isArray(d.files) ? d.files as Record<string, unknown>[] : []) if (isGdId(f.id) && f.ownedByMe === true) out.push(f);
      pageToken = typeof d.nextPageToken === "string" && d.nextPageToken.length < 3990 ? d.nextPageToken : "";
      if (!pageToken) return out;
    }
    throw new Fail(413, "folder_too_big");
  }
  async function gdCopyFile(token: string, id: string, parent: string, name: string) {
    return await cloudWrite("gd_copy", token, `${DRIVE}/files/${encodeURIComponent(id)}/copy?fields=${GD_FIELDS}`, "POST", { name, parents: [parent] });
  }
  async function gdCopy(ws: string, token: string, root: string, item: Record<string, unknown>, to: string | null, name: string) {
    const id = String(item.item_id);
    if (item.is_folder !== true) {
      const row = rowOf(ws, "gd", root, await gdCopyFile(token, id, to ?? root, name));
      await upsertRows("write_upsert", [row]);
      return { ok: true, changed: [pickRow(row)], removed: [] };
    }
    // 1) 읽기만: 안을 모두 세어 본다.
    type Node = { id: string; name: string; folder: boolean; kids: Node[] };
    const top: Node = { id, name, folder: true, kids: [] };
    let count = 0;
    let level = [top];
    for (let depth = 0; level.length; depth++) {
      if (depth > MAX_DELETE_DEPTH) throw new Fail(413, "folder_too_big");
      const next: Node[] = [];
      for (const n of level) {
        for (const f of await gdChildren(token, n.id)) {
          if (++count > COPY_TREE_MAX) throw new Fail(413, "folder_too_big");
          const k: Node = { id: String(f.id), name: String(f.name || ""), folder: f.mimeType === FOLDER_MIME, kids: [] };
          n.kids.push(k);
          if (k.folder) next.push(k);
        }
      }
      level = next;
    }
    // 2) 쓰기: 폴더를 만들고 안을 채운다(파일은 4개씩 동시에).
    const made: Record<string, unknown>[] = [];
    const start = now();
    let partial = false;
    const mk = async (parent: string, nm: string) => {
      const d = await cloudWrite("gd_mkdir", token, `${DRIVE}/files?fields=${GD_FIELDS}`, "POST", { name: nm, mimeType: FOLDER_MIME, parents: [parent] });
      const row = rowOf(ws, "gd", root, d);
      made.push(row);
      return String(row.item_id);
    };
    const fill = async (n: Node, into: string): Promise<void> => {
      const files = n.kids.filter((k) => !k.folder);
      let i = 0;
      const lane = async () => {
        for (;;) {
          const k = files[i++];
          if (!k) return;
          if (now() - start > COPY_TREE_MS) { partial = true; return; }
          made.push(rowOf(ws, "gd", root, await gdCopyFile(token, k.id, into, k.name)));
        }
      };
      await Promise.all(Array.from({ length: Math.min(WRITE_CONCURRENCY, files.length) }, lane));
      for (const k of n.kids.filter((x) => x.folder)) {
        if (now() - start > COPY_TREE_MS) { partial = true; return; }
        await fill(k, await mk(into, k.name));
      }
    };
    try {
      await fill(top, await mk(to ?? root, name));
    } finally {
      await upsertRows("write_upsert", made);
    }
    const first = made[0];
    return { ok: true, changed: first ? [pickRow(first)] : [], removed: [], copied: made.length, partial };
  }

  // 같은 클라우드 안 복사 한 건(copy action과 작업표 공용). 받을 곳에 같은 이름이 있으면 번호를 붙인다(H-3).
  async function copySame(ws: string, source: Source, id: string, toRaw: unknown) {
    const item = (await manyIndexed(ws, source, [id]))[0];
    const to = await folderOrRoot(ws, source, toRaw);
    if (item.is_folder === true && to && (await ancestors(ws, source, to)).includes(id)) throw new Fail(400, "copy_into_self");
    const name = uniqueName(String(item.name), (await siblingNames(ws, source, to)).map((r) => String(r.name)));
    const token = await tokenFor(ws, source);
    const root = await rootId(source, token);
    return source === "od" ? await odCopy(ws, token, root, id, to, name, item.is_folder === true) : await gdCopy(ws, token, root, item, to, name);
  }

  // ---- 전송 작업표(FILES-통합 2-②, app_cloud_jobs) ----
  // 사람이 누른 job_add(confirm:true)·job_resume만 줄을 '기다림'으로 만든다. 서버 실행(runJobs)은 '기다림·보내는 중'인 줄만 이어 가고,
  //   '일시 정지'·'끝'·'실패'·'건너뜀'은 건드리지 않는다. 한 번 실행은 JOB_STEP_MS만 일하고, 남으면 같은 함수의 job_tick을 다시 부른다
  //   (서버 키 HMAC 열쇠 — 화면은 받지 않음, meeting-transcribe와 같은 방식). 화면이 열려 있으면 job_list가 멈춘 실행을 다시 깨운다.
  // 200MB 넘는 클라우드 사이 파일(big): 원본에서 10MB씩 Range로 받아 이어 올리기 자리에 붙이고, 조각마다 '보낸 바이트'와 해시 중간값을 적는다.
  //   다음 실행은 받을 클라우드에 '어디까지 받았나'를 물어 끊긴 조각부터 잇는다. 다 붙이면 크기·지문(해시)을 맞춘다(sendBetween과 같은 규칙).
  // 이어 올리기 자리 주소는 app_cloud_job_uploads(서버만 읽음)에만 두고 응답·로그에 싣지 않는다.
  const JOBS = "app_cloud_jobs", UPLOADS = "app_cloud_job_uploads";
  class Paused extends Error {}
  const background = options.background ?? ((p: Promise<unknown>) => {
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime as { waitUntil?: (p: Promise<unknown>) => void } | undefined;
    if (rt?.waitUntil) rt.waitUntil(p);
  });
  async function patchJob(stage: string, id: string, guard: string, patch: Record<string, unknown>) {
    const v = await db(stage, `${JOBS}?id=eq.${id}${guard}`, { method: "PATCH", body: JSON.stringify({ ...patch, updated_at: at() }) }, "return=representation");
    return Array.isArray(v) && v.length ? v[0] as Record<string, unknown> : null;
  }
  async function kickTick(ws: string) {
    if (!ANON) return;
    const exp = now() + TICK_TTL_MS;
    try {
      const sig = await tickSign(SERVICE, ws, exp);
      const r = await request(`${SB}/functions/v1/cloud-files`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${ANON}`, apikey: ANON, "Content-Type": "application/json", [TICK_HEADER]: sig },
        body: JSON.stringify({ workspace_id: ws, exp }),
      });
      if (!r.ok) log("job_tick_" + r.status);
      await drop(r);
    } catch {
      log("job_tick_unsent"); // 화면이 열려 있으면 job_list가 다시 깨운다
    }
  }
  // 이어 올리기 자리에 '어디까지 받았나'. gone = 자리가 없어짐(기한 지남) → 처음부터.
  async function remoteOffset(dest: Source, url: string, size: number): Promise<{ gone: boolean; offset: number; result: Record<string, unknown> | null }> {
    const r = dest === "od"
      ? await call("od_up_status", url, { method: "GET" }, 25000)
      : await call("gd_up_status", url, { method: "PUT", headers: { "Content-Range": `bytes */${size}`, "Content-Length": "0" }, body: new Uint8Array() }, 25000);
    if (r.status === 404 || r.status === 410) {
      await drop(r);
      return { gone: true, offset: 0, result: null };
    }
    if (dest === "gd" && r.status === 308) {
      const off = gdOffset(r.headers.get("range"));
      await drop(r);
      if (off === null) throw new Fail(502, "upload_failed");
      return { gone: false, offset: off, result: null };
    }
    if (dest === "gd" && (r.status === 200 || r.status === 201)) return { gone: false, offset: size, result: (await body(r)) as Record<string, unknown> | null };
    if (dest === "od" && r.status === 200) {
      const off = odOffset(await body(r));
      return off === null ? { gone: true, offset: 0, result: null } : { gone: false, offset: off, result: null };
    }
    log("up_status_" + r.status);
    await drop(r);
    throw new Fail(502, "cloud_unavailable");
  }
  // 원본에서 조각 하나(끝 포함). 원본 크기가 그사이 바뀌었으면 changed_since_index.
  async function readRange(src: Source, token: string, id: string, start: number, end: number, size: number) {
    const headers = { Range: `bytes=${start}-${end}` };
    const r = src === "od"
      ? await odRedirect("od_job_get", token, `${GRAPH}/me/drive/items/${encodeURIComponent(id)}/content`, headers, 120000)
      : await cloud("gd_job_get", token, `${DRIVE}/files/${encodeURIComponent(id)}?alt=media`, { headers }, 120000);
    const whole = r.status === 200 && start === 0 && end === size - 1 && Number(r.headers.get("content-length")) === size;
    if (!(r.status === 206 && rangeOk(r.headers.get("content-range"), start, end, size)) && !whole) {
      log("job_get_" + r.status);
      await drop(r);
      throw new Fail(409, "changed_since_index");
    }
    const part = new Uint8Array(await r.arrayBuffer());
    if (part.length !== end - start + 1) throw new Fail(409, "changed_since_index");
    return part;
  }
  // 조각 하나를 이어 올리기 자리에(토큰 없이). 끝 조각이면 새 파일 정보를 돌려준다.
  async function putPart(dest: Source, url: string, part: Uint8Array, start: number, size: number) {
    const r = await call(dest + "_job_chunk", url, {
      method: "PUT", headers: { "Content-Range": `bytes ${start}-${start + part.length - 1}/${size}`, "Content-Length": String(part.length) },
      body: part as Uint8Array<ArrayBuffer>,
    }, 120000);
    if (r.status === 308 || r.status === 202) {
      await drop(r);
      return null;
    }
    if (r.status === 200 || r.status === 201) return ((await body(r)) || null) as Record<string, unknown> | null;
    log(dest + "_job_chunk_" + r.status);
    await drop(r);
    if (r.status === 404 || r.status === 410) throw new Fail(410, "session_expired");
    if (r.status === 507) throw new Fail(507, "no_space");
    if (r.status === 429 || r.status === 503) throw new Fail(503, "cloud_throttled");
    throw new Fail(502, "upload_failed");
  }
  // 받은 파일 맞추기(sendBetween과 같은 규칙): 크기, 원본 해시, 새 파일 해시. 다르면 새로 만든 것을 휴지통으로.
  async function verifyNew(ws: string, dest: Source, dstToken: string, result: Record<string, unknown>, size: number, srcHash: string,
    sent: { bytes: number; md5: string; sha1: string }) {
    const row = rowOf(ws, dest, await rootId(dest, dstToken), result);
    const dstHash = String(row.hash || "");
    const mine = (h: string) => h.startsWith("md5:") ? h === "md5:" + sent.md5 : h.startsWith("sha1:") ? h === "sha1:" + sent.sha1 : true;
    if (!(sent.bytes === size && row.size_bytes === size && mine(srcHash) && mine(dstHash))) {
      log("job_verify_failed");
      await toTrash(dest, dstToken, String(row.item_id)).catch(() => log("job_cleanup_failed"));
      throw new Fail(502, "verify_failed");
    }
    await upsertRows("write_upsert", [row]);
    return row;
  }
  // 옮기기면 원본을 휴지통으로(맞춘 뒤에만). 못 보내면 원본을 남기고 kept_original.
  async function trashOriginal(ws: string, src: Source, token: string, id: string) {
    try {
      await toTrash(src, token, id);
    } catch {
      return true;
    }
    await deleteTree(ws, src, [id]);
    return false;
  }
  // 큰 파일 한 번 실행분. 'more'면 다음 실행이 잇는다.
  async function bigStep(ws: string, job: Record<string, unknown>, until: number): Promise<"more" | Record<string, unknown>> {
    const id = String(job.id), size = Number(job.size_bytes), src = job.src_source as Source, dest = job.dest_source as Source;
    const srcId = String(job.src_id);
    const srcToken = await tokenFor(ws, src), dstToken = await tokenFor(ws, dest);
    const saved = (await rows("job_upload", `${UPLOADS}?job_id=eq.${id}&select=upload_url,hash_state&limit=1`))[0];
    let url = saved ? safeUploadUrl(dest, saved.upload_url) : null;
    let md5 = new Md5(), sha1 = new Sha1(), hashed = 0, remote = 0;
    let result: Record<string, unknown> | null = null;
    if (url) {
      try {
        const st = saved.hash_state as { sent: number; md5: unknown; sha1: unknown };
        md5 = Md5.from(st.md5);
        sha1 = Sha1.from(st.sha1);
        hashed = st.sent;
        if (!Number.isSafeInteger(hashed) || hashed < 0 || hashed > size || hashed !== (st.md5 as { total: number }).total) throw new Error("state");
      } catch {
        url = null;
      }
    }
    if (url) {
      const q = await remoteOffset(dest, url, size);
      // 받을 쪽이 우리가 센 것보다 덜 받았거나, 조각 경계가 아니면 처음부터(이름이 같은 반쪽 파일은 생기지 않는다 — 자리는 끝나기 전엔 파일이 아님).
      if (q.gone || q.offset < hashed || q.offset > size || (q.offset !== size && q.offset % UPLOAD_CHUNK)) url = null;
      else {
        remote = q.offset;
        result = q.result;
      }
    }
    if (!url) {
      const item = (await manyIndexed(ws, src, [srcId]))[0];
      if (Number(item.size_bytes) !== size) throw new Fail(409, "changed_since_index");
      const to = await folderOrRoot(ws, dest, job.dest_parent);
      const name = uniqueName(String(job.name), (await siblingNames(ws, dest, to)).map((r) => String(r.name)));
      url = await openUpload(dest, dstToken, to, name, size, String(job.mime || ""));
      md5 = new Md5();
      sha1 = new Sha1();
      hashed = 0;
      remote = 0;
      result = null;
      await db("job_upload_open", `${UPLOADS}?on_conflict=job_id`, {
        method: "POST", body: JSON.stringify({ job_id: id, upload_url: url, hash_state: { sent: 0, md5: md5.state(), sha1: sha1.state() }, updated_at: at() }),
      }, "resolution=merge-duplicates,return=minimal");
      if (!(await patchJob("job_progress", id, "&status=eq.running", { sent_bytes: 0 }))) throw new Paused();
    }
    while (!result && hashed < size) {
      if (now() > until) {
        await patchJob("job_release", id, "&status=eq.running", { lease_until: null });
        return "more";
      }
      const rg = nextRange(hashed, size, UPLOAD_CHUNK) as { start: number; end: number };
      const part = await readRange(src, srcToken, srcId, rg.start, rg.end, size);
      md5.update(part);
      sha1.update(part);
      // 받을 쪽이 이미 받은 조각(앞 실행이 붙이고 적기 전에 끊긴 것)은 해시만 다시 센다.
      if (rg.start >= remote) result = await putPart(dest, url, part, rg.start, size);
      hashed = rg.end + 1;
      if (!result && hashed < size) {
        await db("job_upload_save", `${UPLOADS}?job_id=eq.${id}`, {
          method: "PATCH", body: JSON.stringify({ hash_state: { sent: hashed, md5: md5.state(), sha1: sha1.state() }, updated_at: at() }),
        }, "return=minimal");
        if (!(await patchJob("job_progress", id, "&status=eq.running", { sent_bytes: hashed }))) throw new Paused();
      }
    }
    if (!result && dest === "gd") result = (await remoteOffset(dest, url, size)).result;
    if (!result) throw new Fail(502, "upload_failed");
    const row = await verifyNew(ws, dest, dstToken, result, size, String(job.src_hash || ""), { bytes: hashed, md5: md5.hex(), sha1: sha1.hex() });
    const kept = job.kind === "move" ? await trashOriginal(ws, src, srcToken, srcId) : false;
    await db("job_upload_drop", `${UPLOADS}?job_id=eq.${id}`, { method: "DELETE" }, "return=minimal").catch(() => log("job_upload_drop_failed"));
    return { result_item_id: row.item_id, result_name: row.name, kept_original: kept, sent_bytes: size };
  }
  // 작은 것(200MB 이하·같은 클라우드)은 지금 길 그대로 한 번에.
  async function smallStep(ws: string, job: Record<string, unknown>) {
    const src = job.src_source as Source, dest = job.dest_source as Source, srcId = String(job.src_id);
    if (src !== dest) {
      const { row, srcToken } = await sendBetween(ws, src, srcId, dest, job.dest_parent);
      const kept = job.kind === "move" ? await trashOriginal(ws, src, srcToken, srcId) : false;
      return { result_item_id: row.item_id, result_name: row.name, kept_original: kept, sent_bytes: job.size_bytes ?? 0 };
    }
    const d = await copySame(ws, src, srcId, job.dest_parent) as { changed?: Record<string, unknown>[] };
    const first = d.changed?.[0];
    return { result_item_id: first?.item_id ?? null, result_name: first?.name ?? null, sent_bytes: job.size_bytes ?? 0 };
  }
  async function stepJob(ws: string, job: Record<string, unknown>, until: number) {
    const id = String(job.id);
    try {
      if (Number(job.attempts) > MAX_ATTEMPTS) throw new Fail(500, "too_many_steps");
      const out = job.big === true ? await bigStep(ws, job, until) : await smallStep(ws, job);
      if (out === "more") return "more";
      // 끝: 마지막 조각 뒤에 멈춤을 눌렀어도 파일은 이미 옮겨졌으므로 '끝'으로 적는다.
      await patchJob("job_done", id, "&status=in.(running,paused)", { ...out, status: "done", error_code: null, lease_until: null, finished_at: at() });
    } catch (e) {
      if (e instanceof Paused) return "stop";
      if (!(e instanceof Fail)) log("job_unexpected");
      await patchJob("job_failed", id, "&status=eq.running", {
        status: "failed", error_code: jobCode(e instanceof Fail ? e.code : ""), lease_until: null, finished_at: at(),
      }).catch(() => log("job_fail_save_failed"));
    }
    return "next";
  }
  // 한 번 실행: 그 작업공간의 가장 오래된 '기다림·보내는 중' 줄부터 차례로(한 번에 한 줄씩 — 조금씩 차례로).
  async function runJobs(ws: string) {
    const until = now() + JOB_STEP_MS;
    // 서버가 이어 가는 동안에도 기능(files)이 꺼졌거나 만든 사람이 주인이 아니게 됐으면 이어 가지 않는다(사람 없는 실행이라 매번 다시 본다).
    const allowed = await db("job_feature", "rpc/app_operator_feature_workspace", { method: "POST", body: JSON.stringify({ p_feature: FEATURE }) });
    if (allowed !== ws) {
      log("job_feature_off");
      return;
    }
    for (let n = 0; n <= JOB_ADD_MAX; n++) {
      const next = (await rows("job_next", `${JOBS}?workspace_id=eq.${ws}&origin=eq.cloud&status=in.(queued,running)&select=${JOB_COLUMNS}&order=created_at.asc&limit=1`))[0];
      if (!next) return;
      if (now() > until) break;
      const stamp = at();
      const job = await patchJob("job_lease", String(next.id), `&status=in.(queued,running)&or=(lease_until.is.null,lease_until.lt.${stamp})`, {
        status: "running", lease_until: new Date(now() + LEASE_MS).toISOString(), attempts: Number(next.attempts) + 1, started_at: next.started_at ?? stamp,
      });
      if (!job) return; // 다른 실행이 잡고 있다 — 그쪽이 이어 부른다.
      const owner = await rows("job_owner", `app_workspace_members?user_id=eq.${encodeURIComponent(String(job.created_by))}&workspace_id=eq.${ws}&role=eq.owner&select=workspace_id`);
      if (owner.length !== 1) {
        await patchJob("job_failed", String(job.id), "&status=eq.running", { status: "failed", error_code: "feature_required", lease_until: null, finished_at: at() });
        continue;
      }
      const r = await stepJob(ws, job, until);
      if (r === "more") break;
    }
    await kickTick(ws);
  }
  // 서버 안 입구(다음 실행): 사용자 로그인이 아니라 서버 키 HMAC으로만 받는다. 바로 202를 주고 뒤에서 돈다.
  async function jobTick(req: Request) {
    const raw = req.method === "POST" ? await req.text() : "";
    if (raw.length > 512) return json({ ok: false }, 401);
    let b: Record<string, unknown> | null = null;
    try {
      b = JSON.parse(raw);
    } catch {
      b = null;
    }
    if (!SERVICE || !b || !(await tickCheck(SERVICE, b, req.headers.get(TICK_HEADER), now()))) return json({ ok: false }, 401);
    background(runJobs(String(b.workspace_id)).catch(() => log("job_run_failed")));
    return json({ ok: true }, 202);
  }
  function jobsIn(ws: string, ids: { all: boolean; ids: string[] }) {
    return `${JOBS}?workspace_id=eq.${ws}` + (ids.all ? "" : `&id=${inList(ids.ids)}`);
  }

  type Ctx = { workspaceId: string; userId: string; body: Record<string, unknown>; req: Request };
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
      return json({ ok: true, ...out, reload, changed: reload ? [] : changed.map(pickRow), removed: reload ? [] : removed });
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
    // 폴더 하나를 클라우드에서 바로 읽어 색인에 합친다(S48-65). 색인이 덜 찼거나 놓친 파일이 있어도 폴더를 열면 빈 화면이 되지 않게.
    // 읽기만 한다(클라우드에 쓰지 않음). 지우지도 않는다(지워진 것은 따라가기·처음 훑기가 뺌). 폴더는 색인 안 폴더이거나 맨 위(id 없음)만.
    async folder({ workspaceId: ws, body: b }) {
      if (!isSource(b.source)) throw new Fail(400, "source_invalid");
      const source = b.source;
      const parent = b.id === undefined || b.id === null ? null : b.id;
      if (parent !== null && (!isItemId(parent) || (source === "gd" && !isGdId(parent)))) throw new Fail(400, "id_invalid");
      if (parent !== null) await indexed(ws, source, parent as string, true);
      const token = await tokenFor(ws, source);
      const stamp = at();
      const list: Record<string, unknown>[] = [];
      let truncated = false;
      if (source === "od") {
        const root = await cloudJson("od_root", token, `${GRAPH}/me/drive/root?$select=id`);
        if (!validItemId(root.id)) throw new Fail(502, "cloud_unavailable");
        let url: string | null = parent === null
          ? `${GRAPH}/me/drive/root/children?$select=${OD_SELECT}&$top=200`
          : `${GRAPH}/me/drive/items/${encodeURIComponent(parent as string)}/children?$select=${OD_SELECT}&$top=200`;
        for (let page = 0; url && page < FOLDER_MAX_PAGES; page++) {
          const safe = safeGraph(url);
          if (!safe) throw new Fail(502, "cloud_unavailable");
          const d = await cloudJson("od_children", token, safe);
          for (const it of Array.isArray(d.value) ? d.value as Record<string, unknown>[] : []) {
            const row = odRow(ws, root.id as string, it, stamp);
            if (row && (row.parent_id ?? null) === parent) list.push(row);
          }
          url = safeGraph(d["@odata.nextLink"]);
        }
        truncated = !!url;
      } else {
        const root = await cloudJson("gd_root", token, `${DRIVE}/files/root?fields=id`);
        if (!isGdId(root.id)) throw new Fail(502, "cloud_unavailable");
        const pid = parent === null ? (root.id as string) : (parent as string);
        let pageToken = "";
        for (let page = 0; page < FOLDER_MAX_PAGES; page++) {
          const u = new URL(`${DRIVE}/files`);
          u.searchParams.set("q", `'${pid}' in parents and 'me' in owners and trashed=false`);
          u.searchParams.set("spaces", "drive");
          u.searchParams.set("pageSize", "1000");
          u.searchParams.set("fields", `nextPageToken,files(${GD_FIELDS})`);
          if (pageToken) u.searchParams.set("pageToken", pageToken);
          const d = await cloudJson("gd_children", token, u.toString());
          for (const f of Array.isArray(d.files) ? d.files as Record<string, unknown>[] : []) {
            const row = gdRow(ws, root.id as string, f, stamp);
            if (row && (row.parent_id ?? null) === parent) list.push(row);
          }
          pageToken = typeof d.nextPageToken === "string" && d.nextPageToken.length < 3990 ? d.nextPageToken : "";
          if (!pageToken) break;
          if (page === FOLDER_MAX_PAGES - 1) truncated = true;
        }
      }
      // 이미 색인에 같은 값으로 있는 줄은 되돌려 주지 않는다(바뀐 것·새로 찾은 것만 → 화면이 빈틈을 알아챔).
      const same = (r: Record<string, unknown>) =>
        [r.name, r.parent_id ?? "", r.trashed, r.modified_at ? Date.parse(String(r.modified_at)) : "", r.mime ?? "", r.size_bytes ?? "", r.hash ?? ""].join("|");
      const have = new Map<string, string>();
      for (let i = 0; i < list.length; i += IN_CHUNK) {
        const ids = list.slice(i, i + IN_CHUNK).map((r) => String(r.item_id));
        for (const r of await rows("folder_have", `app_cloud_items?workspace_id=eq.${ws}&source=eq.${source}&item_id=${inList(ids)}&select=item_id,name,parent_id,trashed,modified_at,mime,size_bytes,hash`)) {
          have.set(String(r.item_id), same(r));
        }
      }
      const fresh = list.filter((r) => have.get(String(r.item_id)) !== same(r));
      await upsertRows("folder_upsert", list);
      return json({ ok: true, found: list.length, added: fresh.length, truncated, changed: fresh.slice(0, CHANGED_MAX).map(pickRow), reload: fresh.length > CHANGED_MAX });
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
    // ---- 쓰기(S48-45 ⑤·⑦). 모두 confirm:true, 대상은 그 작업공간 색인 안(휴지통 아님), 결과 줄을 색인에 바로 반영. ----
    // 이름 바꾸기. 같은 폴더에 같은 이름(대소문자 무시)이 있으면 name_taken.
    async rename({ workspaceId: ws, body: b }) {
      mustConfirm(b);
      const { source, id } = target(b);
      const name = cleanName(b.name);
      if (!name) throw new Fail(400, "name_invalid");
      const item = await indexed(ws, source, id, true);
      const sib = await rows("item_parent", `app_cloud_items?workspace_id=eq.${ws}&source=eq.${source}&item_id=eq.${encodeURIComponent(id)}&select=parent_id&limit=1`);
      const parent = typeof sib[0]?.parent_id === "string" ? sib[0].parent_id as string : null;
      if ((await siblingNames(ws, source, parent)).some((r) => r.item_id !== id && String(r.name).toLowerCase() === name.toLowerCase())) throw new Fail(409, "name_taken");
      if (name === item.name) return json({ ok: true, changed: [], removed: [] });
      const token = await tokenFor(ws, source);
      const root = await rootId(source, token);
      const d = source === "od"
        ? await cloudWrite("od_rename", token, `${GRAPH}/me/drive/items/${encodeURIComponent(id)}?@microsoft.graph.conflictBehavior=fail`, "PATCH", { name })
        : await cloudWrite("gd_rename", token, `${DRIVE}/files/${encodeURIComponent(id)}?fields=${GD_FIELDS}`, "PATCH", { name });
      const row = rowOf(ws, source, root, d);
      await upsertRows("write_upsert", [row]);
      return json({ ok: true, changed: [pickRow(row)], removed: [] });
    },
    // 새 폴더(parent null = 맨 위).
    async mkdir({ workspaceId: ws, body: b }) {
      mustConfirm(b);
      if (!isSource(b.source)) throw new Fail(400, "source_invalid");
      const source = b.source;
      const name = cleanName(b.name);
      if (!name) throw new Fail(400, "name_invalid");
      const parent = await folderOrRoot(ws, source, b.parent);
      if ((await siblingNames(ws, source, parent)).some((r) => String(r.name).toLowerCase() === name.toLowerCase())) throw new Fail(409, "name_taken");
      const token = await tokenFor(ws, source);
      const root = await rootId(source, token);
      const d = source === "od"
        ? await cloudWrite("od_mkdir", token, `${GRAPH}/me/drive/${parent ? `items/${encodeURIComponent(parent)}` : "root"}/children`, "POST",
          { name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" })
        : await cloudWrite("gd_mkdir", token, `${DRIVE}/files?fields=${GD_FIELDS}`, "POST", { name, mimeType: FOLDER_MIME, parents: [parent ?? root] });
      const row = rowOf(ws, source, root, d);
      await upsertRows("write_upsert", [row]);
      return json({ ok: true, changed: [pickRow(row)], removed: [] });
    },
    // 같은 클라우드 안 옮기기(부모 바꾸기). 1~200개. 폴더를 자기 아래로는 못 옮김. 같은 이름이 있으면 그것만 실패(name_taken).
    async move({ workspaceId: ws, body: b }) {
      mustConfirm(b);
      if (!isSource(b.source)) throw new Fail(400, "source_invalid");
      const source = b.source;
      const ids = idList(b.ids, source);
      if (!ids) throw new Fail(400, "ids_invalid");
      const items = await manyIndexed(ws, source, ids);
      const to = await folderOrRoot(ws, source, b.to);
      if (to && (await ancestors(ws, source, to)).some((a) => ids.includes(a))) throw new Fail(400, "move_into_self");
      const token = await tokenFor(ws, source);
      const root = await rootId(source, token);
      const byId = new Map(items.map((r) => [String(r.item_id), r]));
      // numbered:true(사람이 '같은 이름이 있어요 → 그래도 하기'를 고른 것): 받을 곳에 같은 이름이 있으면 번호를 붙여 옮긴다(H-3, 덮어쓰기 없음).
      //   없으면 지금처럼 같은 이름은 그 줄만 name_taken.
      const renameTo = new Map<string, string>();
      if (b.numbered === true) {
        const taken = (await siblingNames(ws, source, to)).filter((r) => !ids.includes(String(r.item_id))).map((r) => String(r.name));
        for (const id of ids) {
          const it = byId.get(id);
          if (!it || (it.parent_id ?? null) === to) continue;
          const nm = uniqueName(String(it.name), taken);
          taken.push(nm);
          if (nm !== it.name) renameTo.set(id, nm);
        }
      }
      const changed: Record<string, unknown>[] = [];
      const { failed, left } = await eachLimited(ids, async (id) => {
        if ((byId.get(id)?.parent_id ?? null) === to) return;
        const nm = renameTo.get(id);
        let d: Record<string, unknown>;
        if (source === "od") {
          d = await cloudWrite("od_move", token, `${GRAPH}/me/drive/items/${encodeURIComponent(id)}?@microsoft.graph.conflictBehavior=fail`, "PATCH",
            { parentReference: { id: to ?? root }, ...(nm ? { name: nm } : {}) });
        } else {
          const cur = await cloudJson("gd_parents", token, `${DRIVE}/files/${encodeURIComponent(id)}?fields=parents,ownedByMe`);
          if (cur.ownedByMe !== true) throw new Fail(403, "not_owner");
          const old = (Array.isArray(cur.parents) ? cur.parents : []).filter(isGdId) as string[];
          const u = new URL(`${DRIVE}/files/${encodeURIComponent(id)}`);
          u.searchParams.set("addParents", to ?? root);
          if (old.length) u.searchParams.set("removeParents", old.join(","));
          u.searchParams.set("fields", GD_FIELDS);
          d = await cloudWrite("gd_move", token, u.toString(), "PATCH", nm ? { name: nm } : {});
        }
        changed.push(rowOf(ws, source, root, d));
      });
      await upsertRows("write_upsert", changed);
      return json({ ok: true, changed: changed.map(pickRow), removed: [], failed, left });
    },
    // 휴지통으로(F1: 그 클라우드 휴지통, 되살리기는 그 클라우드 화면에서). 1~200개. 폴더면 색인에서 그 아래까지 뺀다.
    async trash({ workspaceId: ws, body: b }) {
      mustConfirm(b);
      if (!isSource(b.source)) throw new Fail(400, "source_invalid");
      const source = b.source;
      const ids = idList(b.ids, source);
      if (!ids) throw new Fail(400, "ids_invalid");
      await manyIndexed(ws, source, ids);
      const token = await tokenFor(ws, source);
      const done: string[] = [];
      const { failed, left } = await eachLimited(ids, async (id) => {
        await toTrash(source, token, id);
        done.push(id);
      });
      const removed = done.length ? await deleteTree(ws, source, done) : [];
      return json({ ok: true, changed: [], removed: removed.map((id) => ({ source, id })), failed, left });
    },
    // 클라우드 사이 옮기기(⑦, F8): 파일 1개, 200MB까지. 구글 문서류(받을 수 없는 것)·폴더는 안 됨.
    //   원본을 받는 대로 새 곳에 조각으로 보내고, 보낸 크기 = 원본 크기 = 새 파일 크기, 해시(원본 색인·새 파일이 주는 것)가 맞을 때만
    //   원본을 그 클라우드 휴지통으로 보낸다. 맞지 않으면 새로 만든 것을 휴지통으로 보내고 원본은 그대로 둔다.
    async across({ workspaceId: ws, body: b }) {
      mustConfirm(b);
      const { source, id } = target(b);
      if (!isSource(b.to_source) || b.to_source === source) throw new Fail(400, "dest_invalid");
      const { row, srcToken } = await sendBetween(ws, source, id, b.to_source, b.to);
      let keptOriginal = false;
      try {
        await toTrash(source, srcToken, id);
      } catch {
        keptOriginal = true;
      }
      const removed = keptOriginal ? [] : await deleteTree(ws, source, [id]);
      return json({ ok: true, changed: [pickRow(row)], removed: removed.map((x) => ({ source, id: x })), kept_original: keptOriginal });
    },
    // 복사(FILES-통합 2-①): 1개씩, 원본은 그대로. 받을 곳에 같은 이름이 있으면 번호를 붙여 둘 다 둔다(H-3, 덮어쓰기 없음).
    //   같은 클라우드: 파일·폴더(폴더째는 같은 클라우드 안에서만, H-5) — 원드라이브 copy·구글 files.copy(폴더는 안을 차례로).
    //   다른 클라우드: 파일만, across와 같은 받으며 보내기·크기·해시 확인(200MB까지, H-4 — 넘으면 too_large, 큰 파일 이어 보내기는 2-②).
    async copy({ workspaceId: ws, body: b }) {
      mustConfirm(b);
      const { source, id } = target(b);
      const dest = b.to_source === undefined ? source : b.to_source;
      if (!isSource(dest)) throw new Fail(400, "dest_invalid");
      if (dest !== source) {
        const { row } = await sendBetween(ws, source, id, dest, b.to);
        return json({ ok: true, changed: [pickRow(row)], removed: [] });
      }
      return json(await copySame(ws, source, id, b.to));
    },
    // ---- 전송 작업표(2-②) ----
    // 넣기: 사람이 고른 복사·옮기기(다른 저장소로 옮기기)를 한 건 = 한 줄로. 같은 저장소 안 옮기기는 move가 맡는다(작업표로 받지 않음).
    //   items[].skip = 같은 이름 [건너뛰기](줄은 '건너뜀'으로만), numbered = [그래도 하기](번호 붙임), big = 200MB 넘는 것 [그래도 보내기].
    //   못 보내는 것(다른 저장소로 폴더·구글 문서·크기 모름·2GB 넘음·200MB 넘는데 묻지 않음)은 '실패'와 까닭으로 남긴다.
    async job_add({ workspaceId: ws, userId, body: b }) {
      mustConfirm(b);
      const p = parseAdd(b);
      if (!p) throw new Fail(400, "jobs_invalid");
      const to = await folderOrRoot(ws, p.toSource, p.to);
      const found = new Map<string, Record<string, unknown>>();
      for (const source of ["od", "gd"] as Source[]) {
        const ids = p.items.filter((it) => it.source === source).map((it) => it.id);
        if (ids.length) for (const r of await manyIndexed(ws, source, ids)) found.set(source + ":" + r.item_id, r);
      }
      const up = to ? await ancestors(ws, p.toSource, to) : [];
      const stamp = at();
      const list = p.items.map((it) => {
        const r = found.get(it.source + ":" + it.id) as Record<string, unknown>;
        const across = it.source !== p.toSource, folder = r.is_folder === true, mime = typeof r.mime === "string" ? r.mime : null;
        const size = r.size_bytes === null || r.size_bytes === undefined ? null : Number(r.size_bytes);
        const hash = typeof r.hash === "string" && /^(md5|sha1|sha256|qx):[A-Za-z0-9+/=]{1,100}$/.test(r.hash) ? r.hash : null;
        let error: string | null = null;
        if (across && folder) error = "across_folder";
        else if (across && it.source === "gd" && String(mime || "").startsWith("application/vnd.google-apps.")) error = "across_unsupported";
        else if (across && (size === null || !Number.isSafeInteger(size) || size < 0)) error = "size_unknown";
        else if (across && (size as number) > BIG_MAX_BYTES) error = "too_large";
        else if (across && (size as number) > BIG_BYTES && !it.big) error = "big_not_confirmed";
        else if (!across && folder && up.includes(it.id)) error = "copy_into_self";
        const status = it.skip ? "skipped" : error ? "failed" : "queued";
        return {
          workspace_id: ws, created_by: userId, kind: p.kind, origin: "cloud", src_source: it.source, src_id: it.id, dest_source: p.toSource,
          dest_parent: to, name: String(r.name), result_name: null, same_name: it.skip ? "skipped" : it.numbered ? "numbered" : null,
          is_folder: folder, size_bytes: size !== null && Number.isSafeInteger(size) && size >= 0 ? size : null, mime, src_hash: hash,
          big: status === "queued" && across && (size as number) > BIG_BYTES, status, error_code: it.skip ? null : error,
          finished_at: status === "queued" ? null : stamp,
        };
      });
      const made = await db("job_add", `${JOBS}?select=${JOB_COLUMNS}`, { method: "POST", body: JSON.stringify(list) }, "return=representation");
      const jobs = Array.isArray(made) ? made as Record<string, unknown>[] : [];
      if (jobs.some((j) => j.status === "queued")) await kickTick(ws);
      return json({ ok: true, jobs: jobs.map(jobView) });
    },
    // 목록: 기다림·보내는 중·일시 정지 전부 + 하루 안에 끝난 것. 멈춘 실행이 있으면 다시 깨운다(화면이 열려 있는 동안).
    async job_list({ workspaceId: ws }) {
      const since = new Date(now() - JOB_LIST_HOURS * 3600 * 1000).toISOString();
      const list = await rows("job_list", `${JOBS}?workspace_id=eq.${ws}&or=(status.in.(queued,running,paused),created_at.gt.${since})` +
        `&select=${JOB_COLUMNS}&order=created_at.desc&limit=${JOB_LIST_MAX}`);
      if (needsKick(list, now())) await kickTick(ws);
      return json({ ok: true, jobs: list.map(jobView) });
    },
    // 멈춤: 기다림·보내는 중 → 일시 정지. 보내는 중인 큰 파일은 조각 하나를 마친 뒤 멈춘다(받은 조각은 자리에 남아 이어 하기에 씀).
    async job_pause({ workspaceId: ws, body: b }) {
      mustConfirm(b);
      const ids = parseIds(b);
      if (!ids) throw new Fail(400, "jobs_invalid");
      const v = await db("job_pause", `${jobsIn(ws, ids)}&status=in.(${JOB_ACTIVE.join(",")})&select=${JOB_COLUMNS}`,
        { method: "PATCH", body: JSON.stringify({ status: "paused", lease_until: null, updated_at: at() }) }, "return=representation");
      return json({ ok: true, jobs: (Array.isArray(v) ? v : []).map(jobView) });
    },
    // 이어 하기·다시: 일시 정지·실패 → 기다림(서버가 잇는 것만, origin cloud). 큰 파일은 끊긴 조각부터.
    async job_resume({ workspaceId: ws, body: b }) {
      mustConfirm(b);
      const ids = parseIds(b);
      if (!ids) throw new Fail(400, "jobs_invalid");
      const v = await db("job_resume", `${jobsIn(ws, ids)}&origin=eq.cloud&status=in.(paused,failed)&select=${JOB_COLUMNS}`,
        { method: "PATCH", body: JSON.stringify({ status: "queued", error_code: null, finished_at: null, lease_until: null, updated_at: at() }) },
        "return=representation");
      const jobs = Array.isArray(v) ? v as Record<string, unknown>[] : [];
      if (jobs.length) await kickTick(ws);
      return json({ ok: true, jobs: jobs.map(jobView) });
    },
  };

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    try {
      // 서버 안 입구(작업표 다음 실행)는 열쇠 머리가 있을 때만, 맨 앞에서 가른다(사용자 문을 거치지 않고 HMAC만 본다).
      if (req.headers.has(TICK_HEADER)) return await jobTick(req);
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
      return await actions[action]({ workspaceId: who.workspaceId, userId: who.userId, body: b, req });
    } catch (e) {
      if (e instanceof Fail) return json({ ok: false, error: e.code }, e.status);
      log("unexpected");
      return json({ ok: false, error: "cloud_unavailable" }, 500);
    }
  };
}
