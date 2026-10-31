// S46-24 사진 출처 구글 드라이브(명진 G1 2026-10-31: 드라이브 읽기·쓰기). 설계: docs/design/photo-gdrive-permission.md 0·6절.
// 문(네 겹, 모두 서버에서): ① 로그인(Auth) ② 그 사람이 작업공간 owner ③ 로그인 토큰으로 부른 app_my_features()에 gdrive_photos
//   ④ 그 작업공간 = gdrive_photos가 허용된 단 하나의 작업공간 = Drive 연결 작업공간(slug kptu-work, 토큰 public_policy_drive_config id=1의 주인).
//   화면이 보낸 작업공간·사용자 값은 쓰지 않는다. 다른 작업공간은 403.
// 쓰기(이름 바꾸기·옮기기·휴지통으로·폴더 만들기·이름·휴지통으로)는 화면이 confirm:true를 보낼 때만(사용자가 누르고 확인 한 번). 자동·일괄 정리 없음.
// 지우기는 Drive 휴지통으로 옮기기(files.update trashed=true)만 쓴다. 영구 삭제(files.delete)·휴지통 비우기는 이 함수에 없다.
// 토큰은 service role로만 읽고 응답·로그에 싣지 않는다. 기존 Drive 함수들이 부르는 API는 바꾸지 않는다(쓰기는 이 함수에만).
// 원본·썸네일은 저장하지 않는다. DB에는 켠 폴더와 그 폴더 사진 목록 사본만 둔다(migration 20261031120000).

type Env = (name: string) => string | undefined;
export type GdriveOptions = { fetch?: typeof fetch; env: Env; now?: () => number };

export const DRIVE_FULL_SCOPE = "https://www.googleapis.com/auth/drive";
export const FEATURE = "gdrive_photos";
export const DRIVE_WORKSPACE_SLUG = "kptu-work";
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const MAX_BODY = 16 * 1024;
const MAX_IDS = 50;
const MAX_FOLDERS_ON = 50;
const MAX_PAGES = 10;
const MAX_IMAGE = 8 * 1024 * 1024;
const LOCK_MS = 2 * 60 * 1000;
const THUMB = { small: 480, large: 1600 } as const;
export const TRASH_NOTE = "드라이브 휴지통에서 30일 안에 되살릴 수 있어요";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, range",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "content-length, content-range, content-type",
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

export const isDriveId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(v);
// 이름: 1~200자, 제어문자 없음, 앞뒤 공백 없음, '.'·'..'만은 안 됨.
export function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.normalize("NFC");
  if (!s || s.length > 200 || s !== s.trim() || /[\u0000-\u001f\u007f]/.test(s) || s === "." || s === "..") return null;
  return s;
}
// 서울 날짜(YYYY-MM-DD).
export function seoulDay(ms: number) {
  return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
// EXIF 찍은 시각("2026:10:01 12:34:56", 시간대 없음)은 서울 시각으로 읽는다. 없거나 이상하면 만든 시각(추정).
export function takenOf(file: Record<string, unknown>): { taken_at: string; approx: boolean } | null {
  const exif = (file.imageMediaMetadata as Record<string, unknown> | undefined)?.time;
  const m = typeof exif === "string" ? /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(exif) : null;
  if (m) {
    const ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00`);
    if (Number.isFinite(ms) && Number(m[1]) >= 1990) return { taken_at: new Date(ms).toISOString(), approx: false };
  }
  const created = Date.parse(String(file.createdTime || ""));
  return Number.isFinite(created) ? { taken_at: new Date(created).toISOString(), approx: true } : null;
}
export function photoRow(workspaceId: string, parentId: string, file: Record<string, unknown>, stamp: string) {
  const mime = String(file.mimeType || "");
  if (!isDriveId(file.id) || !/^(image|video)\//.test(mime) || file.trashed === true) return null;
  const name = typeof file.name === "string" && file.name.length >= 1 && file.name.length <= 400 ? file.name : null;
  const t = takenOf(file);
  if (!name || !t) return null;
  const size = Number(file.size);
  return {
    workspace_id: workspaceId, item_id: file.id, parent_id: parentId, name, video: mime.startsWith("video/"),
    size_bytes: Number.isFinite(size) && size >= 0 ? Math.floor(size) : null,
    taken_at: t.taken_at, approx: t.approx, taken_day: seoulDay(Date.parse(t.taken_at)), updated_at: stamp,
  };
}
export function scopeHas(scope: unknown) {
  return typeof scope === "string" && scope.split(/\s+/).includes(DRIVE_FULL_SCOPE);
}
const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const inList = (ids: string[]) => `in.(${ids.map((id) => `"${id}"`).join(",")})`;

export function createGdriveHandler(options: GdriveOptions) {
  const request = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => Date.now());
  const SB = options.env("SUPABASE_URL") || "";
  const SERVICE = options.env("SUPABASE_SERVICE_ROLE_KEY") || "";
  const ANON = options.env("SUPABASE_ANON_KEY") || "";
  const log = (code: string) => console.error("gdrive_photos:" + code);

  async function call(stage: string, url: string, init: RequestInit = {}) {
    try {
      return await request(url, { ...init, redirect: "error", signal: AbortSignal.timeout(30000) });
    } catch {
      log(stage + "_unreachable");
      throw new Fail(503, "gdrive_unavailable");
    }
  }
  async function body(r: Response) {
    try {
      return await r.json();
    } catch {
      return null;
    }
  }
  // ---- Supabase(service role, PostgREST) ----
  const svcHeaders = (extra: Record<string, string> = {}) => ({
    apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, Accept: "application/json", "Content-Type": "application/json", ...extra,
  });
  async function db(stage: string, path: string, init: RequestInit = {}, prefer = "") {
    const r = await call("db_" + stage, `${SB}/rest/v1/${path}`, {
      ...init, headers: svcHeaders(prefer ? { Prefer: prefer } : {}),
    });
    if (!r.ok) {
      log("db_" + stage + "_" + r.status);
      try { await r.body?.cancel(); } catch { /* ignore */ }
      throw new Fail(503, "gdrive_store_unavailable");
    }
    if (r.status === 204) return null;
    return await body(r);
  }
  const rows = async (stage: string, path: string) => {
    const v = await db(stage, path);
    return Array.isArray(v) ? v as Record<string, unknown>[] : [];
  };

  // ---- 문: 로그인 → owner → 운영자 기능 → Drive 연결 주인 ----
  async function authorize(jwt: string) {
    const ur = await call("auth", `${SB}/auth/v1/user`, { headers: { apikey: SERVICE, Authorization: `Bearer ${jwt}` } });
    const user = await body(ur);
    if (ur.status >= 500) throw new Fail(503, "auth_unavailable");
    if (!ur.ok || typeof user?.id !== "string") throw new Fail(401, "session_required");
    const members = await rows("member", `app_workspace_members?user_id=eq.${encodeURIComponent(user.id)}&role=eq.owner&select=workspace_id`);
    if (members.length !== 1 || typeof members[0].workspace_id !== "string") throw new Fail(403, "forbidden");
    const workspaceId = members[0].workspace_id as string;
    const fr = await call("features", `${SB}/rest/v1/rpc/app_my_features`, {
      method: "POST",
      headers: { apikey: ANON || SERVICE, Authorization: `Bearer ${jwt}`, Accept: "application/json", "Content-Type": "application/json" },
      body: "{}",
    });
    const features = fr.ok ? await body(fr) : null;
    if (!Array.isArray(features) || !features.includes(FEATURE)) throw new Fail(403, "feature_required");
    const allowed = await db("feature_ws", "rpc/app_operator_feature_workspace", { method: "POST", body: JSON.stringify({ p_feature: FEATURE }) });
    const driveWs = await rows("drive_ws", `app_workspaces?slug=eq.${DRIVE_WORKSPACE_SLUG}&select=id&limit=2`);
    if (allowed !== workspaceId || driveWs.length !== 1 || driveWs[0].id !== workspaceId) throw new Fail(403, "drive_owner_mismatch");
    return { userId: user.id as string, workspaceId };
  }

  // ---- Drive 토큰(한 번 요청에 한 번만 새로 받음). 권한(scope)도 함께 확인 ----
  async function driveToken(): Promise<{ token: string; full: boolean }> {
    const cfg = await rows("drive_cfg", "public_policy_drive_config?id=eq.1&select=google_client_id,google_client_secret,google_refresh_token");
    const c = cfg[0];
    if (!c?.google_refresh_token) throw new Fail(424, "drive_not_connected");
    const r = await call("drive_token", "https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: String(c.google_client_id || ""), client_secret: String(c.google_client_secret || ""),
        refresh_token: String(c.google_refresh_token), grant_type: "refresh_token",
      }),
    });
    const d = await body(r);
    if (!r.ok || typeof d?.access_token !== "string" || !d.access_token) {
      log("drive_token_" + r.status);
      if (d?.error === "invalid_grant" || [400, 401].includes(r.status)) throw new Fail(424, "drive_auth_expired");
      throw new Fail(503, "gdrive_unavailable");
    }
    let full = scopeHas(d.scope);
    if (typeof d.scope !== "string") {
      const ti = await call("tokeninfo", "https://oauth2.googleapis.com/tokeninfo", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ access_token: d.access_token }),
      });
      full = ti.ok && scopeHas((await body(ti))?.scope);
    }
    return { token: d.access_token, full };
  }
  async function fullToken() {
    const t = await driveToken();
    if (!t.full) throw new Fail(403, "scope_missing");
    return t.token;
  }
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  async function drive(stage: string, token: string, url: string, init: RequestInit = {}) {
    const r = await call("drive_" + stage, url, { ...init, headers: { ...auth(token), ...(init.headers || {}) } });
    if (r.status === 404) throw new Fail(404, "not_found");
    if (r.status === 403 && stage !== "media") throw new Fail(403, "drive_denied");
    if (!r.ok) {
      log("drive_" + stage + "_" + r.status);
      throw new Fail(502, "gdrive_unavailable");
    }
    return r;
  }
  async function getFile(token: string, id: string, fields = "id,name,mimeType,parents,trashed") {
    const r = await drive("get", token, `${DRIVE}/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}`);
    const f = await body(r);
    if (!f || f.id !== id) throw new Fail(404, "not_found");
    return f as Record<string, unknown>;
  }
  async function liveFolder(token: string, id: string) {
    if (id === "root") return { id: "root", name: "", parents: [] as string[] };
    const f = await getFile(token, id);
    if (f.mimeType !== FOLDER_MIME || f.trashed === true) throw new Fail(404, "folder_not_found");
    return f;
  }
  async function listAll(token: string, query: string, fields: string, pages = MAX_PAGES) {
    const out: Record<string, unknown>[] = [];
    let pageToken = "";
    for (let i = 0; i < pages; i++) {
      const u = new URL(DRIVE);
      u.searchParams.set("q", query);
      u.searchParams.set("fields", `nextPageToken,files(${fields})`);
      u.searchParams.set("pageSize", "1000");
      u.searchParams.set("spaces", "drive");
      if (pageToken) u.searchParams.set("pageToken", pageToken);
      const d = await body(await drive("list", token, u.toString()));
      for (const f of Array.isArray(d?.files) ? d.files : []) out.push(f);
      pageToken = typeof d?.nextPageToken === "string" ? d.nextPageToken : "";
      if (!pageToken) return { files: out, complete: true };
    }
    return { files: out, complete: false };
  }
  const PHOTO_FIELDS = "id,name,mimeType,size,createdTime,trashed,imageMediaMetadata(time),videoMediaMetadata(durationMillis)";

  // ---- 색인 ----
  async function folderRows(workspaceId: string) {
    return await rows("folders", `app_gdrive_folders?workspace_id=eq.${workspaceId}&select=item_id,parent_id,name,enabled&order=name.asc&limit=1000`);
  }
  async function enabledIds(workspaceId: string) {
    return (await folderRows(workspaceId)).filter((f) => f.enabled === true).map((f) => f.item_id as string);
  }
  async function indexFolder(workspaceId: string, token: string, folderId: string) {
    const stamp = new Date(now()).toISOString();
    const { files, complete } = await listAll(token,
      `'${q(folderId)}' in parents and trashed=false and (mimeType contains 'image/' or mimeType contains 'video/')`, PHOTO_FIELDS);
    const list = files.map((f) => photoRow(workspaceId, folderId, f, stamp)).filter(Boolean);
    for (let i = 0; i < list.length; i += 500) {
      await db("photos_upsert", "app_gdrive_photos?on_conflict=workspace_id,item_id",
        { method: "POST", body: JSON.stringify(list.slice(i, i + 500)) }, "resolution=merge-duplicates,return=minimal");
    }
    // 다 받았을 때만 이번에 안 보인 사진(지워짐·옮겨짐)을 목록에서 뺀다.
    if (complete) {
      await db("photos_sweep", `app_gdrive_photos?workspace_id=eq.${workspaceId}&parent_id=eq.${encodeURIComponent(folderId)}&updated_at=lt.${encodeURIComponent(stamp)}`,
        { method: "DELETE" }, "return=minimal");
    }
    return { count: list.length, complete };
  }
  async function lock(workspaceId: string) {
    await db("sync_row", "app_gdrive_sync?on_conflict=workspace_id", { method: "POST", body: JSON.stringify({ workspace_id: workspaceId }) },
      "resolution=ignore-duplicates,return=minimal");
    const at = new Date(now()).toISOString(), until = new Date(now() + LOCK_MS).toISOString();
    const got = await db("sync_lock",
      `app_gdrive_sync?workspace_id=eq.${workspaceId}&or=(index_lock_until.is.null,index_lock_until.lt.${encodeURIComponent(at)})`,
      { method: "PATCH", body: JSON.stringify({ index_lock_until: until, updated_at: at }) }, "return=representation");
    return Array.isArray(got) && got.length === 1;
  }
  async function unlock(workspaceId: string, synced: boolean) {
    const at = new Date(now()).toISOString();
    await db("sync_unlock", `app_gdrive_sync?workspace_id=eq.${workspaceId}`,
      { method: "PATCH", body: JSON.stringify(synced ? { index_lock_until: null, synced_at: at, updated_at: at } : { index_lock_until: null, updated_at: at }) },
      "return=minimal");
  }

  // ---- 확인 한 번 + 대상이 목록 안에 있는지 ----
  function needConfirm(b: Record<string, unknown>) {
    if (b.confirm !== true) throw new Fail(400, "confirm_required");
  }
  function idList(v: unknown) {
    if (!Array.isArray(v) || !v.length || v.length > MAX_IDS || !v.every(isDriveId) || new Set(v).size !== v.length) throw new Fail(400, "ids_invalid");
    return v as string[];
  }
  async function indexedPhotos(workspaceId: string, ids: string[]) {
    const on = new Set(await enabledIds(workspaceId));
    const got = await rows("photos_pick", `app_gdrive_photos?workspace_id=eq.${workspaceId}&item_id=${inList(ids)}&select=item_id,parent_id,name,video`);
    const ok = got.filter((r) => on.has(r.parent_id as string));
    if (ok.length !== ids.length) throw new Fail(404, "photo_not_in_index");
    return new Map(ok.map((r) => [r.item_id as string, r]));
  }
  const patchFile = async (stage: string, token: string, id: string, query: string, patch: Record<string, unknown>) => {
    const r = await drive(stage, token, `${DRIVE}/${encodeURIComponent(id)}?fields=id,name,parents,trashed${query}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    });
    return await body(r);
  };

  type Ctx = { workspaceId: string; body: Record<string, unknown>; req: Request };
  const actions: Record<string, (c: Ctx) => Promise<Response>> = {
    // 상태: 권한이 없으면 오류 대신 scope:false로 답한다(화면이 [Drive 다시 연결] 안내).
    async status({ workspaceId }) {
      const t = await driveToken();
      const sync = await rows("sync_read", `app_gdrive_sync?workspace_id=eq.${workspaceId}&select=synced_at`);
      return json({ ok: true, scope: t.full, folders_on: t.full ? (await enabledIds(workspaceId)).length : 0, synced_at: sync[0]?.synced_at ?? null });
    },
    // 폴더 목록(맨 위 'root'부터 한 층씩). 켬 여부는 DB에서.
    async folders({ workspaceId, body: b }) {
      const parent = b.parent === undefined ? "root" : b.parent;
      if (parent !== "root" && !isDriveId(parent)) throw new Fail(400, "parent_invalid");
      const token = await fullToken();
      const here = await liveFolder(token, parent as string);
      const { files, complete } = await listAll(token, `'${q(parent as string)}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`,
        "id,name", 3);
      const on = new Map((await folderRows(workspaceId)).map((f) => [f.item_id as string, f.enabled === true]));
      const folders = files.filter((f) => isDriveId(f.id) && typeof f.name === "string")
        .map((f) => ({ id: f.id as string, name: f.name as string, enabled: on.get(f.id as string) === true }))
        .sort((a, b2) => a.name.localeCompare(b2.name, "ko"));
      return json({ ok: true, parent, name: here.name || "", up: Array.isArray(here.parents) && isDriveId(here.parents[0]) ? here.parents[0] : null, folders, complete });
    },
    // 폴더 켜기·끄기. 켜면 그 폴더 바로 안 사진·동영상만 목록에 넣고, 끄면 그 폴더 사진을 목록에서 뺀다(Drive 파일은 그대로).
    async "folder-toggle"({ workspaceId, body: b }) {
      if (!isDriveId(b.id) || b.id === "root" || typeof b.enabled !== "boolean") throw new Fail(400, "folder_invalid");
      const token = await fullToken();
      const f = await liveFolder(token, b.id);
      const at = new Date(now()).toISOString();
      if (b.enabled) {
        if ((await enabledIds(workspaceId)).filter((id) => id !== b.id).length >= MAX_FOLDERS_ON) throw new Fail(409, "too_many_folders");
        const parent = Array.isArray(f.parents) && isDriveId(f.parents[0]) ? f.parents[0] : null;
        await db("folder_upsert", "app_gdrive_folders?on_conflict=workspace_id,item_id", {
          method: "POST", body: JSON.stringify({ workspace_id: workspaceId, item_id: b.id, parent_id: parent, name: cleanName(f.name) || "(이름 없음)", enabled: true, updated_at: at }),
        }, "resolution=merge-duplicates,return=minimal");
        const r = await indexFolder(workspaceId, token, b.id);
        return json({ ok: true, id: b.id, enabled: true, indexed: r.count, complete: r.complete });
      }
      await db("folder_off", `app_gdrive_folders?workspace_id=eq.${workspaceId}&item_id=eq.${b.id}`,
        { method: "PATCH", body: JSON.stringify({ enabled: false, updated_at: at }) }, "return=minimal");
      await db("photos_off", `app_gdrive_photos?workspace_id=eq.${workspaceId}&parent_id=eq.${b.id}`, { method: "DELETE" }, "return=minimal");
      return json({ ok: true, id: b.id, enabled: false });
    },
    // 켠 폴더들을 Drive에서 다시 받는다(동시에 두 번 받지 않게 잠금). 사라진 폴더는 끈다.
    async sync({ workspaceId }) {
      const token = await fullToken();
      if (!(await lock(workspaceId))) return json({ ok: true, busy: true });
      let done = false;
      try {
        let photos = 0, partial = 0;
        for (const id of await enabledIds(workspaceId)) {
          try {
            await liveFolder(token, id);
          } catch (e) {
            if (e instanceof Fail && e.status === 404) {
              await db("folder_gone", `app_gdrive_folders?workspace_id=eq.${workspaceId}&item_id=eq.${id}`,
                { method: "PATCH", body: JSON.stringify({ enabled: false, updated_at: new Date(now()).toISOString() }) }, "return=minimal");
              await db("photos_gone", `app_gdrive_photos?workspace_id=eq.${workspaceId}&parent_id=eq.${id}`, { method: "DELETE" }, "return=minimal");
              continue;
            }
            throw e;
          }
          const r = await indexFolder(workspaceId, token, id);
          photos += r.count;
          if (!r.complete) partial++;
        }
        done = true;
        return json({ ok: true, photos, partial });
      } finally {
        await unlock(workspaceId, done).catch(() => log("sync_unlock_failed"));
      }
    },
    // 사진 목록: 켠 폴더 사진만, 찍은 시각 새것부터. before = {t, id}(앞 쪽 마지막 사진).
    async list({ workspaceId, body: b }) {
      const limit = Number.isInteger(b.limit) && (b.limit as number) >= 1 && (b.limit as number) <= 300 ? b.limit as number : 120;
      const on = await enabledIds(workspaceId);
      if (!on.length) return json({ ok: true, items: [], more: false });
      let filter = "";
      const before = b.before as Record<string, unknown> | undefined;
      if (before !== undefined) {
        const t = typeof before?.t === "string" && Number.isFinite(Date.parse(before.t)) ? new Date(Date.parse(before.t)).toISOString() : null;
        if (!t || !isDriveId(before.id)) throw new Fail(400, "before_invalid");
        filter = `&or=(taken_at.lt.${encodeURIComponent(t)},and(taken_at.eq.${encodeURIComponent(t)},item_id.lt.${before.id}))`;
      }
      const got = await rows("list", `app_gdrive_photos?workspace_id=eq.${workspaceId}&parent_id=${inList(on)}${filter}` +
        `&select=item_id,parent_id,name,video,size_bytes,taken_at,approx,taken_day&order=taken_at.desc,item_id.desc&limit=${limit + 1}`);
      const items = got.slice(0, limit).map((r) => ({
        id: r.item_id, folder: r.parent_id, name: r.name, video: r.video === true, size_bytes: r.size_bytes ?? null,
        taken_at: r.taken_at, approx: r.approx === true, day: r.taken_day,
      }));
      return json({ ok: true, items, more: got.length > limit });
    },
    // 썸네일(서버 중계). 켠 폴더 목록 안 사진만.
    async thumb({ workspaceId, body: b }) {
      if (!isDriveId(b.id)) throw new Fail(400, "id_invalid");
      const size = b.size === "large" ? "large" : "small";
      await indexedPhotos(workspaceId, [b.id]);
      const token = await fullToken();
      const f = await getFile(token, b.id, "id,mimeType,trashed,thumbnailLink");
      if (f.trashed === true) throw new Fail(404, "not_found");
      const link = typeof f.thumbnailLink === "string" ? new URL(f.thumbnailLink) : null;
      if (!link || link.protocol !== "https:" || !link.hostname.endsWith(".googleusercontent.com")) throw new Fail(404, "thumb_unavailable");
      const r = await call("thumb", link.href.replace(/=s\d+$/, "") + `=s${THUMB[size]}`, { headers: auth(token) });
      const type = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      const bytes = r.ok ? new Uint8Array(await r.arrayBuffer()) : new Uint8Array();
      if (!/^image\/(jpeg|png|webp|gif)$/.test(type) || !bytes.length || bytes.length > MAX_IMAGE) throw new Fail(502, "thumb_unavailable");
      return new Response(bytes, { headers: { ...cors, "Content-Type": type, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
    },
    // 원본 사진·동영상(서버 중계, Range 그대로 전달). 켠 폴더 목록 안 사진만.
    async media({ workspaceId, body: b, req }) {
      if (!isDriveId(b.id)) throw new Fail(400, "id_invalid");
      await indexedPhotos(workspaceId, [b.id]);
      const token = await fullToken();
      const range = req.headers.get("range");
      const headers: Record<string, string> = range && /^bytes=\d*-\d*$/.test(range) ? { Range: range } : {};
      const r = await drive("media", token, `${DRIVE}/${encodeURIComponent(b.id)}?alt=media`, { headers });
      const type = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!/^(image|video)\/[a-z0-9.+-]+$/.test(type)) {
        try { await r.body?.cancel(); } catch { /* ignore */ }
        throw new Fail(415, "media_unsupported");
      }
      const out: Record<string, string> = { ...cors, "Content-Type": type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
      for (const h of ["content-length", "content-range", "accept-ranges"]) {
        const v = r.headers.get(h);
        if (v) out[h] = v;
      }
      return new Response(r.body, { status: r.status === 206 ? 206 : 200, headers: out });
    },
    // 사진 이름 바꾸기(누를 때만, 확인 한 번).
    async rename({ workspaceId, body: b }) {
      needConfirm(b);
      if (!isDriveId(b.id)) throw new Fail(400, "id_invalid");
      const name = cleanName(b.name);
      if (!name) throw new Fail(400, "name_invalid");
      await indexedPhotos(workspaceId, [b.id]);
      const token = await fullToken();
      await patchFile("rename", token, b.id, "", { name });
      await db("photo_rename", `app_gdrive_photos?workspace_id=eq.${workspaceId}&item_id=eq.${b.id}`,
        { method: "PATCH", body: JSON.stringify({ name, updated_at: new Date(now()).toISOString() }) }, "return=minimal");
      return json({ ok: true, id: b.id, name });
    },
    // 다른 폴더로 옮기기. 받는 폴더는 Drive에서 실제 폴더인지 확인한다. 한 장씩 결과를 돌려준다.
    async move({ workspaceId, body: b }) {
      needConfirm(b);
      const ids = idList(b.ids);
      if (b.to !== "root" && !isDriveId(b.to)) throw new Fail(400, "target_invalid");
      await indexedPhotos(workspaceId, ids);
      const token = await fullToken();
      const target = b.to as string;
      await liveFolder(token, target);
      const targetOn = (await enabledIds(workspaceId)).includes(target);
      const moved: string[] = [], failed: string[] = [];
      for (const id of ids) {
        try {
          const f = await getFile(token, id, "id,parents,trashed");
          const from = (Array.isArray(f.parents) ? f.parents : []).filter(isDriveId).join(",");
          await patchFile("move", token, id, `&addParents=${encodeURIComponent(target)}${from ? `&removeParents=${encodeURIComponent(from)}` : ""}`, {});
          moved.push(id);
        } catch (e) {
          if (!(e instanceof Fail) || e.status >= 500) log("move_failed");
          failed.push(id);
        }
      }
      if (moved.length) {
        const where = `app_gdrive_photos?workspace_id=eq.${workspaceId}&item_id=${inList(moved)}`;
        if (targetOn) await db("photos_moved", where, { method: "PATCH", body: JSON.stringify({ parent_id: target, updated_at: new Date(now()).toISOString() }) }, "return=minimal");
        else await db("photos_moved_out", where, { method: "DELETE" }, "return=minimal");
      }
      return json({ ok: failed.length === 0, moved, failed });
    },
    // 지우기 = Drive 휴지통으로 옮기기만(30일 안에 되살릴 수 있음). 영구 삭제 없음.
    async trash({ workspaceId, body: b }) {
      needConfirm(b);
      const ids = idList(b.ids);
      await indexedPhotos(workspaceId, ids);
      const token = await fullToken();
      const trashed: string[] = [], failed: string[] = [];
      for (const id of ids) {
        try {
          const r = await patchFile("trash", token, id, "", { trashed: true });
          if (r?.trashed !== true) throw new Fail(502, "trash_unconfirmed");
          trashed.push(id);
        } catch (e) {
          if (!(e instanceof Fail) || e.status >= 500) log("trash_failed");
          failed.push(id);
        }
      }
      if (trashed.length) await db("photos_trashed", `app_gdrive_photos?workspace_id=eq.${workspaceId}&item_id=${inList(trashed)}`, { method: "DELETE" }, "return=minimal");
      return json({ ok: failed.length === 0, trashed, failed, note: TRASH_NOTE });
    },
    // 폴더 만들기(맨 위 또는 실제 폴더 안). 새 폴더는 꺼진 채.
    async "folder-create"({ body: b }) {
      needConfirm(b);
      const parent = b.parent === undefined ? "root" : b.parent;
      if (parent !== "root" && !isDriveId(parent)) throw new Fail(400, "parent_invalid");
      const name = cleanName(b.name);
      if (!name) throw new Fail(400, "name_invalid");
      const token = await fullToken();
      await liveFolder(token, parent as string);
      const r = await drive("folder_create", token, `${DRIVE}?fields=id,name`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] }),
      });
      const f = await body(r);
      if (!isDriveId(f?.id)) throw new Fail(502, "gdrive_unavailable");
      return json({ ok: true, id: f.id, name, enabled: false });
    },
    async "folder-rename"({ workspaceId, body: b }) {
      needConfirm(b);
      if (!isDriveId(b.id) || b.id === "root") throw new Fail(400, "folder_invalid");
      const name = cleanName(b.name);
      if (!name) throw new Fail(400, "name_invalid");
      const token = await fullToken();
      await liveFolder(token, b.id);
      await patchFile("folder_rename", token, b.id, "", { name });
      await db("folder_renamed", `app_gdrive_folders?workspace_id=eq.${workspaceId}&item_id=eq.${b.id}`,
        { method: "PATCH", body: JSON.stringify({ name, updated_at: new Date(now()).toISOString() }) }, "return=minimal");
      return json({ ok: true, id: b.id, name });
    },
    // 폴더 지우기 = 휴지통으로(안의 파일도 함께 휴지통, 30일 안에 되살릴 수 있음). 맨 위(root)는 안 됨.
    async "folder-trash"({ workspaceId, body: b }) {
      needConfirm(b);
      if (!isDriveId(b.id) || b.id === "root") throw new Fail(400, "folder_invalid");
      const token = await fullToken();
      await liveFolder(token, b.id);
      const r = await patchFile("folder_trash", token, b.id, "", { trashed: true });
      if (r?.trashed !== true) throw new Fail(502, "trash_unconfirmed");
      await db("folder_trashed_photos", `app_gdrive_photos?workspace_id=eq.${workspaceId}&parent_id=eq.${b.id}`, { method: "DELETE" }, "return=minimal");
      await db("folder_trashed", `app_gdrive_folders?workspace_id=eq.${workspaceId}&item_id=eq.${b.id}`, { method: "DELETE" }, "return=minimal");
      return json({ ok: true, id: b.id, note: TRASH_NOTE });
    },
  };

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    try {
      if (!SB || !SERVICE) throw new Fail(503, "not_ready");
      const m = (req.headers.get("Authorization") || "").match(/^Bearer\s+(\S+)$/i);
      if (!m) throw new Fail(401, "session_required");
      if (req.method !== "POST") return json({ error: "POST only" }, 405);
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
      return json({ ok: false, error: "gdrive_unavailable" }, 500);
    }
  };
}
