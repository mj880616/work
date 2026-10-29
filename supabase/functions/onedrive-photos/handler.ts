import {
  AUTO_SYNC_BUDGET_MS, AUTO_SYNC_MAX_PAGES, cleanFolderName, DELTA_SELECT, folderPathOf, GRAPH, GRAPH_BATCH_MAX, GRAPH_BATCH_PHOTOS, graphNextLink, insideFolder,
  isMediaMime, LIBRARY_DEFAULT, LIBRARY_MAX, LIBRARY_SCAN_PAGES, MAX_FOLDER_DEPTH, MAX_IMAGE_BYTES, MAX_ITEMS, MEDIA_URL_TTL_S, mediaFields,
  MOVE_MAX, PHOTO_URLS_MAX, normalizeScopes, retryAfterSeconds, safeDownloadUrl, SCOPE, scopeAllowed, seoulDay, SIZES, STAR_IDS_MAX,
  SYNC_BUDGET_MS, SYNC_LOCK_MS, SYNC_MAX_PAGES, SYNC_STALE_MS, takenOf, TRASH_DAYS, TRASH_LIST_MAX, TRASH_NAME, TRASH_PURGE_STEP, validItemId,
  VIDEO_MIME,
} from "./graph.ts";
import type { OneDriveItem } from "./graph.ts";

// 일기 2차(JOURNAL-일기원드라이브): 원드라이브 연결·폴더 지정·사진 읽기·사진 지우기(휴지통 이동). 권한 Files.ReadWrite(고른 폴더 안 사진만 다룸).
// 사진 메뉴 ①(PHOTO-사진메뉴): 최신순 쪽 읽기(library)·달별(months)·날별(days) 장수, 재생·받기 주소(media-url), 여러 장 지우기,
//   지운 사진은 고른 폴더 안 'Web2 휴지통' 폴더로 옮기고(되살리기 trash-restore, 30일 뒤 원드라이브 휴지통), 동영상·크기·위치·sha1 색인.
//   권한 범위·소유자 확인·폴더 밖 거절은 그대로다(DB 20261028220000 적용 뒤 배포).
// 사진 메뉴 ②(폴더 보기): 새 폴더(folder-create)·이름 바꾸기(folder-rename)·폴더 옮기기(folder-move)·빈 폴더 지우기(folder-delete)·
//   여러 장 폴더로 옮기기(photos-move). 모두 고른 맨 위 폴더 안에서만(색인 폴더 나무 + Graph 경로 이중 확인), 권한 범위는 그대로(Files.ReadWrite).
// 로그인한 작업공간 소유자만 쓴다. 갱신 토큰은 service role로만 읽고 쓰며 응답·로그에 싣지 않는다.
// 비밀값이 없으면 status가 configured:false로 답하고 나머지 동작은 424 onedrive_not_configured 로 멈춘다.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

class Fail extends Error {
  status: number;
  code: string;
  extra?: Record<string, unknown>;
  constructor(status: number, code: string, extra?: Record<string, unknown>) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const CONN = "app_onedrive_connections", FOLDERS = "app_onedrive_folders", PHOTOS = "app_onedrive_photos";
const DB_PAGE = 1000, UPSERT_CHUNK = 500, IN_CHUNK = 100;
type FolderRow = { item_id: string; parent_id: string | null; name: string; enabled: boolean; role?: string | null };
type PhotoRow = { item_id: string; parent_id: string; name: string; taken_at: string; approx: boolean; taken_day: string };
type MediaRow = PhotoRow & {
  kind: string; mime: string | null; width: number | null; height: number | null; duration_ms: number | null; screenshot: boolean;
  trashed_at?: string | null; orig_parent_id?: string | null;
};
const MEDIA_COLS = "item_id,parent_id,name,taken_at,approx,taken_day,kind,mime,width,height,duration_ms,screenshot";
const FILTERS = ["all", "star", "video", "shot"] as const;
type Filter = typeof FILTERS[number];
const iso = (v: unknown) => new Date(String(v)).toISOString();

// 이 함수가 쓰는 Supabase 부분만 적는다(시험에서 지어낸 것으로 바꿀 수 있게).
// deno-lint-ignore no-explicit-any
type Query = any;
export type OneDriveAdmin = {
  // deno-lint-ignore no-explicit-any
  auth: { getUser(token: string): Promise<any> };
  from(table: string): Query;
};
export type OneDriveOptions = {
  env?: (name: string) => string | undefined;
  fetch?: typeof fetch;
  now?: () => number;
  log?: (code: string) => void;
};

const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_BODY = 16 * 1024;
const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const enc = new TextEncoder();

async function stateKey(secret: string) {
  // 앱 비밀값에서 상태 서명 전용 열쇠를 따로 만든다(비밀값 원문을 서명에 그대로 쓰지 않음).
  const raw = await crypto.subtle.digest("SHA-256", enc.encode("onedrive-state-v1:" + secret));
  return await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export function createOneDriveHandler(admin: OneDriveAdmin, options: OneDriveOptions = {}) {
  const env = options.env ?? (() => undefined);
  const request = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const log = options.log ?? ((code: string) => console.error(code));

  function config() {
    const clientId = env("ONEDRIVE_CLIENT_ID") || "", secret = env("ONEDRIVE_CLIENT_SECRET") || "",
      redirect = env("ONEDRIVE_REDIRECT_URI") || "", tenant = env("ONEDRIVE_TENANT") || "common";
    if (!clientId || secret.length < 16 || !/^https:\/\/[^\s]+$/.test(redirect) || !/^[A-Za-z0-9.-]{1,80}$/.test(tenant)) return null;
    return { clientId, secret, redirect, tenant };
  }
  const needConfig = () => {
    const c = config();
    if (!c) throw new Fail(424, "onedrive_not_configured");
    return c;
  };

  async function call(stage: string, url: string, init: RequestInit = {}) {
    try {
      return await request(url, { redirect: "error", ...init, signal: AbortSignal.timeout(20000) });
    } catch {
      log(stage + "_failed");
      throw new Fail(503, "onedrive_unavailable");
    }
  }
  async function bodyJson(r: Response) {
    try {
      return await r.json();
    } catch {
      return {};
    }
  }

  async function tokenRequest(c: NonNullable<ReturnType<typeof config>>, params: Record<string, string>) {
    const r = await call("onedrive_token", `https://login.microsoftonline.com/${c.tenant}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: c.clientId, client_secret: c.secret, scope: SCOPE, ...params }),
    });
    const d = await bodyJson(r);
    if (!r.ok || typeof d.access_token !== "string" || !d.access_token) {
      // HTTP 상태와 Microsoft 오류 이름(예 invalid_client)만 남긴다. 오류 설명문은 남기지 않는다.
      log("onedrive_token_rejected:" + r.status + (typeof d.error === "string" && /^[a-z_]{1,40}$/.test(d.error) ? ":" + d.error : ""));
      if (d.error === "invalid_grant" || r.status === 400 || r.status === 401) throw new Fail(424, "onedrive_auth_expired");
      throw new Fail(503, "onedrive_unavailable");
    }
    return d as { access_token: string; refresh_token?: string; scope?: string; expires_in?: number };
  }

  // 실패 단계 로그: 단계 이름 + DB 오류 번호(SQLSTATE 5글자, 예 42501)만 남긴다. 오류 문장·토큰·코드·비밀값은 남기지 않는다.
  const dbFail = (stage: string, error: unknown): never => {
    const code = (error as { code?: unknown } | null)?.code;
    log(stage + (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? ":" + code : ""));
    throw new Fail(503, "onedrive_unavailable");
  };

  async function readConnection(workspaceId: string) {
    const { data, error } = await admin.from(CONN)
      .select("refresh_token,scope,folder_id,folder_name,folder_path,connected_at,delta_link,next_link,index_done_at,synced_at")
      .eq("workspace_id", workspaceId).maybeSingle();
    if (error) dbFail("onedrive_read_failed", error);
    return data as null | {
      refresh_token: string; scope?: string | null; folder_id: string | null; folder_name: string | null; folder_path: string | null; connected_at: string;
      delta_link?: string | null; next_link?: string | null; index_done_at?: string | null; synced_at?: string | null;
    };
  }

  // 연결 1행 저장. upsert(INSERT … ON CONFLICT DO UPDATE)는 쓰지 않는다: PostgREST가 SET 절에 보낸 모든 칸(workspace_id 포함)을 넣는데,
  // service_role에는 workspace_id 고치기 권한이 없어서(20261026140000 migration, 칸 단위 권한) 행이 없어도 42501로 거절된다.
  // 대신 넣기를 먼저 하고, 이미 있으면(23505) 허용된 칸만 고친다. 두 동작 모두 기존 권한 안이다.
  type ConnectionFields = {
    refresh_token: string; scope: string; folder_id: null; folder_name: null; folder_path: null; connected_at: string; updated_at: string;
  };
  async function saveConnection(workspaceId: string, fields: ConnectionFields) {
    const inserted = await admin.from("app_onedrive_connections").insert({ workspace_id: workspaceId, ...fields });
    if (!inserted.error) return;
    if (inserted.error.code !== "23505") dbFail("onedrive_save_failed:insert", inserted.error);
    const { data, error } = await admin.from("app_onedrive_connections").update(fields).eq("workspace_id", workspaceId).select("workspace_id");
    if (error) dbFail("onedrive_save_failed:update", error);
    if (!Array.isArray(data) || data.length !== 1) {
      log("onedrive_save_failed:update_missing");
      throw new Fail(503, "onedrive_unavailable");
    }
  }

  // 갱신 토큰으로 접근 토큰을 받는다. 새 갱신 토큰이 오면 바로 바꿔 저장한다(Microsoft는 갱신 때마다 새 토큰을 줄 수 있다).
  // 접근 토큰은 만료 1분 전까지 이 함수 안에서만 기억한다(사진 여러 장을 연달아 받을 때 갱신 요청을 줄임).
  const cached = new Map<string, { token: string; refresh: string; until: number }>();
  // 같은 순간에 여러 요청이 오면(사진 묶음 여러 개) 갱신 요청은 하나만 보내고 함께 기다린다(OD-속도).
  const tokenFlights = new Map<string, { refresh: string; flight: Promise<string> }>();
  function accessToken(workspaceId: string, conn: { refresh_token: string }): Promise<string> {
    const hit = cached.get(workspaceId);
    if (hit && hit.refresh === conn.refresh_token && hit.until > now()) return Promise.resolve(hit.token);
    const going = tokenFlights.get(workspaceId);
    if (going && going.refresh === conn.refresh_token) return going.flight;
    const flight = freshToken(workspaceId, conn).finally(() => { if (tokenFlights.get(workspaceId)?.flight === flight) tokenFlights.delete(workspaceId); });
    tokenFlights.set(workspaceId, { refresh: conn.refresh_token, flight });
    return flight;
  }
  async function freshToken(workspaceId: string, conn: { refresh_token: string }) {
    const c = needConfig();
    cached.delete(workspaceId);
    const d = await tokenRequest(c, { grant_type: "refresh_token", refresh_token: conn.refresh_token });
    if (typeof d.refresh_token === "string" && d.refresh_token && d.refresh_token !== conn.refresh_token) {
      const { error } = await admin.from("app_onedrive_connections")
        .update({ refresh_token: d.refresh_token, updated_at: new Date(now()).toISOString() }).eq("workspace_id", workspaceId);
      if (error) dbFail("onedrive_token_save_failed", error);
    }
    const expires = Number(d.expires_in);
    if (Number.isFinite(expires) && expires > 120) {
      cached.set(workspaceId, { token: d.access_token, refresh: (typeof d.refresh_token === "string" && d.refresh_token) || conn.refresh_token, until: now() + (expires - 60) * 1000 });
    }
    return d.access_token;
  }

  const graph = (stage: string, token: string, path: string) =>
    call(stage, path.startsWith("https://") ? path : GRAPH + path, { headers: { Authorization: `Bearer ${token}` } });

  // Graph 응답 상태를 화면이 구분할 수 있는 코드로 바꾼다. 429·503(요청이 많음)은 Retry-After를 존중해 onedrive_throttled + retry_after(초).
  function graphCheck(stage: string, r: Response, missing: string) {
    if (r.status === 429 || r.status === 503) {
      log(stage + "_throttled:" + r.status);
      throw new Fail(429, "onedrive_throttled", { retry_after: retryAfterSeconds(r.headers.get("retry-after"), now()) });
    }
    if (r.status === 404) throw new Fail(404, missing);
    if (r.status === 401 || r.status === 403) throw new Fail(424, "onedrive_auth_expired");
    if (!r.ok) {
      log(stage + "_rejected:" + r.status);
      throw new Fail(502, "onedrive_unavailable");
    }
  }

  async function listChildren(token: string, parentId: string | null, select: string, budget: { left: number }) {
    const out: OneDriveItem[] = [];
    let url: string | null = (parentId ? `/me/drive/items/${encodeURIComponent(parentId)}/children` : "/me/drive/root/children") +
      `?$select=${select}&$top=200`;
    while (url) {
      if (budget.left-- <= 0) throw new Fail(413, "onedrive_too_many_requests");
      const r = await graph("onedrive_list", token, url);
      graphCheck("onedrive_list", r, "onedrive_folder_missing");
      const d = await bodyJson(r);
      if (Array.isArray(d.value)) out.push(...(d.value as OneDriveItem[]));
      url = graphNextLink(d["@odata.nextLink"]);
      if (out.length > MAX_ITEMS) throw new Fail(413, "onedrive_too_many_items");
    }
    return out;
  }

  async function getItem(token: string, id: string, select: string) {
    const r = await graph("onedrive_item", token, `/me/drive/items/${encodeURIComponent(id)}?$select=${select}`);
    graphCheck("onedrive_item", r, "onedrive_item_missing");
    return (await bodyJson(r)) as OneDriveItem;
  }

  const folderOf = (conn: Awaited<ReturnType<typeof readConnection>>) => {
    if (!conn) throw new Fail(424, "onedrive_not_connected");
    if (!conn.folder_id || !conn.folder_path) throw new Fail(424, "onedrive_folder_not_set");
    return { id: conn.folder_id, path: conn.folder_path };
  };

  // ── 사진 색인(서버 표) ──────────────────────────────────────────────────────────────
  // 모든 읽기·쓰기는 이 작업공간(workspace_id) 행만 다룬다. 사진 이름 등 목록 내용은 로그에 남기지 않는다.
  async function readAll<T>(stage: string, build: () => Query): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0;; from += DB_PAGE) {
      const { data, error } = await build().range(from, from + DB_PAGE - 1);
      if (error) dbFail(stage, error);
      const rows = Array.isArray(data) ? data as T[] : [];
      out.push(...rows);
      if (rows.length < DB_PAGE) return out;
    }
  }
  const readFolders = (workspaceId: string) => readAll<FolderRow>("onedrive_index_read_failed:folders", () =>
    admin.from(FOLDERS).select("item_id,parent_id,name,enabled,role").eq("workspace_id", workspaceId).order("item_id"));

  // 맨 위 폴더에서 부모 id로 이어지는 폴더만 트리에 든다(이어지지 않는 폴더 = 지워졌거나 밖으로 옮겨짐 → 보이지 않음).
  // 사진이 보이려면 맨 위 폴더 아래로 거치는 모든 폴더가 켜져 있어야 한다(맨 위 폴더 자체는 늘 켜짐).
  // 'Web2 휴지통' 폴더(role='trash')와 그 아래는 트리에 넣지 않는다(일기·사진·폴더 보기 어디에도 보이지 않음).
  function folderTree(rows: FolderRow[], topId: string) {
    const byId = new Map(rows.map((r) => [r.item_id, r]));
    const kids = new Map<string, FolderRow[]>();
    for (const r of rows) {
      if (r.item_id === topId || !r.parent_id || r.role === "trash") continue;
      (kids.get(r.parent_id) || kids.set(r.parent_id, []).get(r.parent_id)!).push(r);
    }
    const reach = new Map<string, { visible: boolean; depth: number }>([[topId, { visible: true, depth: 0 }]]);
    const stack = [topId];
    while (stack.length) {
      const id = stack.pop()!, cur = reach.get(id)!;
      if (cur.depth >= MAX_FOLDER_DEPTH) continue;
      for (const k of kids.get(id) || []) {
        if (reach.has(k.item_id)) continue;
        reach.set(k.item_id, { visible: cur.visible && k.enabled !== false, depth: cur.depth + 1 });
        stack.push(k.item_id);
      }
    }
    return { byId, kids, reach };
  }

  async function deleteIn(stage: string, table: string, workspaceId: string, column: string, ids: string[]) {
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const { error } = await admin.from(table).delete().eq("workspace_id", workspaceId).in(column, ids.slice(i, i + IN_CHUNK));
      if (error) dbFail(stage, error);
    }
  }
  async function upsertRows(stage: string, table: string, rows: Record<string, unknown>[]) {
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      const { error } = await admin.from(table).upsert(rows.slice(i, i + UPSERT_CHUNK), { onConflict: "workspace_id,item_id" });
      if (error) dbFail(stage, error);
    }
  }

  // 색인 비우기: 맨 위 폴더를 바꾸거나 다시 연결하거나 Graph가 처음부터 다시 받으라고(410) 할 때.
  const INDEX_RESET = { delta_link: null, next_link: null, index_done_at: null, synced_at: null, index_lock_until: null };
  async function clearIndexRows(workspaceId: string) {
    for (const table of [PHOTOS, FOLDERS]) {
      const { error } = await admin.from(table).delete().eq("workspace_id", workspaceId);
      if (error) dbFail("onedrive_index_clear_failed", error);
    }
  }

  // delta 한 쪽을 표에 반영한다. 지워진 항목·사진/동영상 아님·찍은 시각 없음은 색인에서 뺀다. 같은 쪽 안 중복 id는 마지막 것만.
  // 여러 행 upsert는 보낸 칸만 고치되 한 묶음 안에서 빠진 칸은 null이 되므로, 칸 모양이 다른 행은 묶음을 나눈다:
  //  ① 맨 위 폴더 바로 아래 'Web2 휴지통' 폴더 = 꺼짐·role trash로 ② 그 밖 폴더 = 켜짐·role 칸은 건드리지 않음
  //  ③ 휴지통 안 사진 = 휴지통 칸(trashed_at·orig_parent_id)을 건드리지 않음 ④ 그 밖 사진 = 휴지통 칸을 비움(원드라이브에서 꺼냈으면 휴지통에서 빠짐).
  // 반환: 이 쪽에서 찾은 휴지통 폴더 id(없으면 받은 값 그대로).
  async function applyDelta(workspaceId: string, topId: string, items: OneDriveItem[], stamp: string, trashId: string | null = null) {
    const folders = new Map<string, Record<string, unknown>>(), photos = new Map<string, Record<string, unknown>>(), gone = new Set<string>();
    const trashFolders = new Map<string, Record<string, unknown>>(), trashed = new Map<string, Record<string, unknown>>();
    for (const it of items) {
      if (!it || !validItemId(it.id)) continue;
      const parent = it.parentReference?.id;
      if (it.deleted) {
        gone.add(it.id);
        continue;
      }
      if (it.folder) {
        if (typeof it.name !== "string" || !it.name || it.name.length > 400) continue;
        const row = {
          workspace_id: workspaceId, item_id: it.id, parent_id: it.id === topId ? null : (validItemId(parent) ? parent : null),
          name: it.name, updated_at: stamp,
        };
        const isTrash = it.id !== topId && (trashId ? trashId === it.id : parent === topId && it.name.normalize("NFC") === TRASH_NAME);
        if (isTrash) {
          trashId = it.id;
          trashFolders.set(it.id, { ...row, enabled: false, role: "trash" });
        } else folders.set(it.id, row);
        continue;
      }
      const taken = isMediaMime(it.file?.mimeType) ? takenOf(it) : null;
      const day = taken && seoulDay(taken.at);
      if (!taken || !day || !validItemId(parent)) {
        gone.add(it.id);
        continue;
      }
      const name = typeof it.name === "string" && it.name ? it.name.slice(0, 400) : it.id;
      const row = {
        workspace_id: workspaceId, item_id: it.id, parent_id: parent, name, taken_at: taken.at, approx: taken.approx, taken_day: day, updated_at: stamp,
        ...mediaFields(it),
      };
      photos.set(it.id, row);
    }
    for (const id of gone) {
      folders.delete(id);
      trashFolders.delete(id);
      photos.delete(id);
    }
    // 휴지통 폴더가 이 쪽에서 정해졌으면 사진을 그 기준으로 나눈다(쪽 안 순서와 상관없이).
    for (const [id, row] of photos) {
      if (trashId && row.parent_id === trashId) {
        photos.delete(id);
        trashed.set(id, row);
      } else Object.assign(row, { trashed_at: null, orig_parent_id: null });
    }
    await upsertRows("onedrive_index_save_failed:folders", FOLDERS, [...folders.values()]);
    await upsertRows("onedrive_index_save_failed:trash_folder", FOLDERS, [...trashFolders.values()]);
    await upsertRows("onedrive_index_save_failed:photos", PHOTOS, [...photos.values()]);
    await upsertRows("onedrive_index_save_failed:trashed", PHOTOS, [...trashed.values()]);
    if (gone.size) {
      const ids = [...gone];
      await deleteIn("onedrive_index_delete_failed:photos", PHOTOS, workspaceId, "item_id", ids);
      await deleteIn("onedrive_index_delete_failed:in_folder", PHOTOS, workspaceId, "parent_id", ids);
      await deleteIn("onedrive_index_delete_failed:folders", FOLDERS, workspaceId, "item_id", ids);
    }
    return trashId;
  }

  // 이 작업공간의 'Web2 휴지통' 폴더 id(색인에 있으면). 없으면 null.
  async function readTrashId(workspaceId: string): Promise<string | null> {
    const { data, error } = await admin.from(FOLDERS).select("item_id").eq("workspace_id", workspaceId).eq("role", "trash").maybeSingle();
    if (error) dbFail("onedrive_index_read_failed:trash", error);
    return data && validItemId(data.item_id) ? data.item_id : null;
  }

  // 색인 한 걸음: 잠금 → (처음이면 다음 쪽 주소, 끝났으면 변경 주소)부터 시간·쪽 상한까지 받기 → 진행 저장·잠금 풀기.
  // 이미 다른 요청이 받는 중이면 409 onedrive_index_busy. 쪽마다 바로 표에 반영하므로 중간에 멈춰도 다음 요청이 이어 간다.
  type Conn = NonNullable<Awaited<ReturnType<typeof readConnection>>>;
  async function syncStep(workspaceId: string, conn: Conn, folder: { id: string }, budgetMs: number, maxPages: number) {
    const startAt = now(), stamp = new Date(startAt).toISOString();
    const { data: locked, error } = await admin.from(CONN)
      .update({ index_lock_until: new Date(startAt + SYNC_LOCK_MS).toISOString() })
      .eq("workspace_id", workspaceId)
      .or(`index_lock_until.is.null,index_lock_until.lt.${stamp}`)
      .select("workspace_id");
    if (error) dbFail("onedrive_index_lock_failed", error);
    if (!Array.isArray(locked) || locked.length !== 1) throw new Fail(409, "onedrive_index_busy");
    const first = `${GRAPH}/me/drive/items/${encodeURIComponent(folder.id)}/delta?$select=${DELTA_SELECT}`;
    let next = graphNextLink(conn.next_link), delta = graphNextLink(conn.delta_link), done = conn.index_done_at || null;
    let synced = conn.synced_at || null, url = next || delta || first, more = true, pages = 0;
    try {
      let trashId = await readTrashId(workspaceId);
      const token = await accessToken(workspaceId, conn);
      while (pages < maxPages && now() - startAt < budgetMs) {
        pages++;
        const r = await graph("onedrive_delta", token, url);
        if (r.status === 410) {
          // Graph가 이어 받기 주소를 버렸다: 색인을 비우고 처음부터 다시 받는다.
          log("onedrive_delta_resync");
          await clearIndexRows(workspaceId);
          next = null;
          delta = null;
          done = null;
          trashId = null;
          url = first;
          continue;
        }
        graphCheck("onedrive_delta", r, "onedrive_folder_missing");
        const d = await bodyJson(r);
        trashId = await applyDelta(workspaceId, folder.id, Array.isArray(d.value) ? d.value as OneDriveItem[] : [], stamp, trashId);
        const nl = graphNextLink(d["@odata.nextLink"]), dl = graphNextLink(d["@odata.deltaLink"]);
        if (nl) {
          next = nl;
          url = nl;
          continue;
        }
        if (!dl) {
          log("onedrive_delta_link_missing");
          throw new Fail(502, "onedrive_unavailable");
        }
        delta = dl;
        next = null;
        done = done || stamp;
        synced = stamp;
        more = false;
        break;
      }
    } finally {
      const { error: saveError } = await admin.from(CONN)
        .update({ next_link: next, delta_link: delta, index_done_at: done, synced_at: synced, index_lock_until: null })
        .eq("workspace_id", workspaceId);
      // 진행 저장이 실패해도 이미 반영한 쪽은 다음에 다시 받아도 같은 결과다(잠금은 1분 뒤 풀림). 원래 오류를 덮지 않게 기록만 한다.
      if (saveError) log("onedrive_index_progress_failed" + (/^[0-9A-Z]{5}$/.test(String(saveError.code)) ? ":" + saveError.code : ""));
    }
    return { more, indexing: !done };
  }

  async function sign(payload: Record<string, unknown>, secret: string) {
    const body = b64u(enc.encode(JSON.stringify(payload)));
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await stateKey(secret), enc.encode(body)));
    return body + "." + b64u(mac);
  }
  async function verifyState(state: unknown, secret: string): Promise<Record<string, unknown> | null> {
    if (typeof state !== "string" || state.length > 2000) return null;
    const [body, mac, extra] = state.split(".");
    if (!body || !mac || extra !== undefined) return null;
    try {
      const ok = await crypto.subtle.verify("HMAC", await stateKey(secret), unb64u(mac), enc.encode(body));
      if (!ok) return null;
      const p = JSON.parse(new TextDecoder().decode(unb64u(body)));
      return p && typeof p === "object" ? p : null;
    } catch {
      return null;
    }
  }

  const validMonth = (v: unknown): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
  const monthEnd = (month: string) => {
    const [y, m] = month.split("-").map(Number);
    return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  };

  // 색인이 덜 됐거나 10분 넘게 안 받았으면 짧게 한 걸음 받는다. 바쁨·요청 많음·일시 장애면 기록만 하고 지금까지의 색인으로 답한다.
  async function autoSync(workspaceId: string, conn: Conn, folder: { id: string }) {
    let indexing = !conn.index_done_at;
    const synced = conn.synced_at ? Date.parse(conn.synced_at) : NaN;
    if (indexing || !Number.isFinite(synced) || now() - synced > SYNC_STALE_MS) {
      try {
        indexing = (await syncStep(workspaceId, conn, folder, AUTO_SYNC_BUDGET_MS, AUTO_SYNC_MAX_PAGES)).indexing;
      } catch (e) {
        if (!(e instanceof Fail) || !["onedrive_index_busy", "onedrive_throttled", "onedrive_unavailable"].includes(e.code)) throw e;
        log("onedrive_auto_sync_skipped:" + e.code);
      }
    }
    return indexing;
  }

  // 거르기(all·star·video·shot). 별표는 화면이 자기 별표(app_diary_stars, owner RLS)에서 고른 사진 id를 star_ids로 보낸다:
  // 이 함수(service_role)에는 별표 표 권한이 없고 더하지 않는다. star_ids는 내 색인 안에서 고르는 데만 쓴다(권한 판단에 쓰지 않음).
  function readFilter(body: Record<string, unknown>) {
    const filter = body.filter === undefined ? "all" : body.filter;
    if (typeof filter !== "string" || !(FILTERS as readonly string[]).includes(filter)) throw new Fail(400, "onedrive_request_invalid");
    let stars: Set<string> | null = null;
    if (body.star_ids !== undefined) {
      const ids = body.star_ids;
      if (!Array.isArray(ids) || ids.length > STAR_IDS_MAX || !ids.every(validItemId)) throw new Fail(400, "onedrive_request_invalid");
      stars = new Set(ids as string[]);
    }
    if (filter === "star" && !stars) throw new Fail(400, "onedrive_request_invalid");
    return { filter: filter as Filter, stars };
  }
  const passes = (r: MediaRow, filter: Filter, stars: Set<string> | null) =>
    filter === "video" ? r.kind === "video" : filter === "shot" ? r.screenshot === true : filter === "star" ? !!stars?.has(r.item_id) : true;
  const itemOut = (r: MediaRow) => ({
    id: r.item_id, name: r.name, taken_at: iso(r.taken_at), approx: r.approx === true, day: String(r.taken_day).slice(0, 10), kind: r.kind === "video" ? "video" : "photo",
    mime: r.mime ?? null, width: r.width ?? null, height: r.height ?? null, duration_ms: r.duration_ms ?? null, screenshot: r.screenshot === true,
  });
  // 보이는(켠 폴더, 휴지통 아님) 색인 행을 거르기에 맞춰 읽는다. 별표는 고른 id만 묶음으로 읽는다.
  async function readVisible(workspaceId: string, cols: string, filter: Filter, stars: Set<string> | null, more?: (q: Query) => Query) {
    const base = () => {
      let q = admin.from(PHOTOS).select(cols).eq("workspace_id", workspaceId).is("trashed_at", null);
      if (filter === "video") q = q.eq("kind", "video");
      if (filter === "shot") q = q.eq("screenshot", true);
      return more ? more(q) : q;
    };
    if (filter !== "star") return await readAll<MediaRow>("onedrive_index_read_failed:media", () => base().order("item_id"));
    const out: MediaRow[] = [], ids = [...stars!];
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const { data, error } = await base().in("item_id", ids.slice(i, i + IN_CHUNK));
      if (error) dbFail("onedrive_index_read_failed:stars", error);
      if (Array.isArray(data)) out.push(...data as MediaRow[]);
    }
    return out;
  }

  const actions: Record<string, (ctx: { userId: string; workspaceId: string; body: Record<string, unknown> }) => Promise<Response>> = {
    async status({ workspaceId }) {
      const configured = config() !== null;
      if (!configured) return json({ configured: false, connected: false, folder: null });
      const conn = await readConnection(workspaceId);
      return json({
        configured: true,
        connected: !!conn,
        folder: conn?.folder_id ? { name: conn.folder_name } : null,
        connected_at: conn?.connected_at ?? null,
        can_delete: !!conn && scopeAllowed(normalizeScopes(conn.scope)),
      });
    },

    async "auth-start"({ userId, workspaceId }) {
      const c = needConfig();
      const state = await sign({ u: userId, w: workspaceId, e: now() + STATE_TTL_MS, n: crypto.randomUUID() }, c.secret);
      const q = new URLSearchParams({
        client_id: c.clientId, response_type: "code", redirect_uri: c.redirect, response_mode: "query",
        scope: SCOPE, state, prompt: "select_account",
      });
      return json({ url: `https://login.microsoftonline.com/${c.tenant}/oauth2/v2.0/authorize?${q}` });
    },

    async "auth-finish"({ userId, workspaceId, body }) {
      const c = needConfig();
      const st = await verifyState(body.state, c.secret);
      if (!st || st.u !== userId || st.w !== workspaceId || typeof st.e !== "number" || st.e < now()) {
        throw new Fail(400, "onedrive_state_invalid");
      }
      if (typeof body.code !== "string" || body.code.length < 8 || body.code.length > 4096) throw new Fail(400, "onedrive_code_invalid");
      const d = await tokenRequest(c, { grant_type: "authorization_code", code: body.code, redirect_uri: c.redirect });
      // 받은 허용 범위가 맞는지 확인한다: Files.ReadWrite가 있어야 하고, 전체 범위(.All)·앱 폴더·선택 범위가 섞이면 저장하지 않고 거절한다.
      const granted = normalizeScopes(d.scope);
      if (!scopeAllowed(granted)) {
        log("onedrive_scope_rejected");
        throw new Fail(400, "onedrive_scope_invalid");
      }
      if (typeof d.refresh_token !== "string" || !d.refresh_token || d.refresh_token.length > 4096) {
        log("onedrive_refresh_token_missing");
        throw new Fail(502, "onedrive_unavailable");
      }
      cached.delete(workspaceId);
      const stamp = new Date(now()).toISOString();
      // 다시 연결하면 다른 계정일 수 있으므로 폴더 지정은 비운다.
      await saveConnection(workspaceId, {
        refresh_token: d.refresh_token, folder_id: null, folder_name: null, folder_path: null,
        scope: granted.join(" "), connected_at: stamp, updated_at: stamp,
      });
      // 다른 계정일 수 있으므로 이전 색인도 비운다.
      await clearIndexRows(workspaceId);
      const { error } = await admin.from(CONN).update(INDEX_RESET).eq("workspace_id", workspaceId);
      if (error) dbFail("onedrive_index_clear_failed:progress", error);
      return json({ connected: true });
    },

    async folders({ workspaceId, body }) {
      const conn = await readConnection(workspaceId);
      if (!conn) throw new Fail(424, "onedrive_not_connected");
      let parent: string | null = null;
      if (body.parent_id !== undefined && body.parent_id !== null) {
        if (!validItemId(body.parent_id)) throw new Fail(400, "onedrive_request_invalid");
        parent = body.parent_id;
      }
      const token = await accessToken(workspaceId, conn);
      const items = await listChildren(token, parent, "id,name,folder", { left: 5 });
      const folders = items.filter((i) => i.folder && validItemId(i.id) && typeof i.name === "string")
        .map((i) => ({ id: i.id, name: i.name as string }))
        .sort((a, b) => a.name.localeCompare(b.name, "ko"));
      return json({ folders });
    },

    async "folder-set"({ workspaceId, body }) {
      const conn = await readConnection(workspaceId);
      if (!conn) throw new Fail(424, "onedrive_not_connected");
      if (!validItemId(body.folder_id)) throw new Fail(400, "onedrive_request_invalid");
      const token = await accessToken(workspaceId, conn);
      const item = await getItem(token, body.folder_id, "id,name,folder,parentReference");
      const path = folderPathOf(item);
      // 폴더가 아니거나, 원드라이브 맨 위(루트) 자체면 거절한다. 사진을 읽을 범위는 사용자가 고른 폴더 하나로 좁힌다.
      if (!item.folder || !path || item.id !== body.folder_id) throw new Fail(400, "onedrive_folder_invalid");
      // 맨 위 폴더가 바뀌면 색인을 비우고 처음부터 다시 받는다(같은 폴더를 다시 고르면 켜고 끈 설정을 그대로 둔다).
      const changed = conn.folder_id !== item.id;
      if (changed) await clearIndexRows(workspaceId);
      const { error } = await admin.from(CONN)
        .update({ folder_id: item.id, folder_name: item.name, folder_path: path, updated_at: new Date(now()).toISOString(), ...(changed ? INDEX_RESET : {}) })
        .eq("workspace_id", workspaceId);
      if (error) dbFail("onedrive_folder_save_failed", error);
      return json({ folder: { name: item.name } });
    },

    // 달 사진: 서버 색인에서 읽는다(켠 폴더와 그 아래만, 서울 날짜 기준). 색인이 덜 됐거나 10분 넘게 안 받았으면 짧게 한 걸음 받는다.
    // 그 한 걸음이 바쁨·요청 많음·일시 장애로 못 가면 기록만 하고 지금까지의 색인으로 답한다(연결 풀림은 그대로 알린다).
    // 일기 날짜 화면은 사진(kind='photo')만 보인다(동영상은 사진 메뉴에서만). Web2 휴지통 안 사진은 빠진다(폴더 트리 밖).
    async photos({ workspaceId, body }) {
      const conn = await readConnection(workspaceId);
      const folder = folderOf(conn);
      const month = body.month;
      if (!validMonth(month)) throw new Fail(400, "onedrive_request_invalid");
      const indexing = await autoSync(workspaceId, conn!, folder);
      const end = monthEnd(month);
      const { reach } = folderTree(await readFolders(workspaceId), folder.id);
      const rows = await readAll<PhotoRow>("onedrive_index_read_failed:photos", () =>
        admin.from(PHOTOS).select("item_id,parent_id,name,taken_at,approx,taken_day").eq("workspace_id", workspaceId).eq("kind", "photo")
          .is("trashed_at", null).gte("taken_day", `${month}-01`).lt("taken_day", end).order("item_id"));
      const days: Record<string, { id: string; name: string; taken_at: string; approx: boolean }[]> = {};
      for (const r of rows) {
        if (!reach.get(r.parent_id)?.visible) continue;
        const day = String(r.taken_day).slice(0, 10);
        if (!day.startsWith(month + "-")) continue;
        (days[day] ||= []).push({ id: r.item_id, name: r.name, taken_at: new Date(r.taken_at).toISOString(), approx: r.approx === true });
      }
      for (const list of Object.values(days)) list.sort((a, b) => a.taken_at.localeCompare(b.taken_at) || a.id.localeCompare(b.id));
      return json({ month, days, truncated: false, indexing });
    },

    // 색인 이어 받기(화면이 more:false가 될 때까지 부른다). 한 요청은 20초·30쪽까지만.
    async sync({ workspaceId }) {
      const conn = await readConnection(workspaceId);
      const folder = folderOf(conn);
      const r = await syncStep(workspaceId, conn!, folder, SYNC_BUDGET_MS, SYNC_MAX_PAGES);
      return json(r);
    },

    // 맨 위 폴더 아래 하위 폴더 트리: 폴더마다 켜짐·바로 안 사진 장수(count)·아래 전체 장수(total, 꺼진 폴더도 셈).
    async "folders-tree"({ workspaceId }) {
      const conn = await readConnection(workspaceId);
      const folder = folderOf(conn);
      const { byId, kids, reach } = folderTree(await readFolders(workspaceId), folder.id);
      const parents = await readAll<{ parent_id: string }>("onedrive_index_read_failed:counts", () =>
        admin.from(PHOTOS).select("parent_id").eq("workspace_id", workspaceId).order("item_id"));
      const count = new Map<string, number>();
      for (const p of parents) count.set(p.parent_id, (count.get(p.parent_id) || 0) + 1);
      const total = new Map<string, number>();
      // 깊은 폴더부터 더한다(재귀 없이).
      const order = [...reach.entries()].sort((a, b) => b[1].depth - a[1].depth).map(([id]) => id);
      for (const id of order) {
        let t = count.get(id) || 0;
        for (const k of kids.get(id) || []) t += total.get(k.item_id) || 0;
        total.set(id, t);
      }
      const folders = [...reach.keys()].filter((id) => id !== folder.id).map((id) => {
        const r = byId.get(id)!;
        return { id, name: r.name, parent_id: r.parent_id, enabled: r.enabled !== false, count: count.get(id) || 0, total: total.get(id) || 0 };
      }).sort((a, b) => a.name.localeCompare(b.name, "ko") || a.id.localeCompare(b.id));
      return json({
        top: { id: folder.id, name: conn!.folder_name, count: count.get(folder.id) || 0, total: total.get(folder.id) || 0 },
        folders, indexing: !conn!.index_done_at,
      });
    },

    // 하위 폴더 켜기·끄기. 맨 위 폴더는 끌 수 없다(끄려면 다른 맨 위 폴더를 고른다). 'Web2 휴지통' 폴더는 켤 수 없다(없는 폴더로 답함).
    async "folder-toggle"({ workspaceId, body }) {
      const conn = await readConnection(workspaceId);
      const folder = folderOf(conn);
      if (!validItemId(body.folder_id) || typeof body.enabled !== "boolean" || body.folder_id === folder.id) {
        throw new Fail(400, "onedrive_request_invalid");
      }
      const { data, error } = await admin.from(FOLDERS).update({ enabled: body.enabled, updated_at: new Date(now()).toISOString() })
        .eq("workspace_id", workspaceId).eq("item_id", body.folder_id).is("role", null).select("item_id");
      if (error) dbFail("onedrive_folder_toggle_failed", error);
      if (!Array.isArray(data) || data.length !== 1) throw new Fail(404, "onedrive_folder_missing");
      return json({ folder: { id: body.folder_id, enabled: body.enabled } });
    },

    // 최신순 쪽 읽기(사진 메뉴 '사진' 보기). 켠 폴더(휴지통 제외)의 사진·동영상을 찍은 시각 내림차순으로 limit장씩.
    // cursor = 앞 쪽 마지막 {t: 찍은 시각, id}. 같은 시각 묶음은 이 함수가 통째로 읽어 id 순서로 자르므로 빠지거나 겹치지 않는다.
    // folder_id를 주면 그 폴더 바로 안만(꺼진 폴더도 열어 볼 수 있음). 한 요청은 색인 20쪽(2만 행)까지만 훑고, 못 채우면 그 자리 cursor를 준다.
    async library({ workspaceId, body }) {
      const conn = await readConnection(workspaceId);
      const folder = folderOf(conn);
      const { filter, stars } = readFilter(body);
      const limit = body.limit === undefined ? LIBRARY_DEFAULT : body.limit;
      if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > LIBRARY_MAX) throw new Fail(400, "onedrive_request_invalid");
      let cursor: { t: string; id: string } | null = null;
      if (body.cursor !== undefined && body.cursor !== null) {
        const c = body.cursor as Record<string, unknown>;
        if (!c || typeof c !== "object" || Array.isArray(c) || typeof c.t !== "string" || c.t.length > 40 || !Number.isFinite(Date.parse(c.t)) ||
          !validItemId(c.id)) throw new Fail(400, "onedrive_request_invalid");
        cursor = { t: iso(c.t), id: c.id };
      }
      let folderId: string | null = null;
      if (body.folder_id !== undefined && body.folder_id !== null) {
        if (!validItemId(body.folder_id)) throw new Fail(400, "onedrive_request_invalid");
        folderId = body.folder_id;
      }
      const indexing = await autoSync(workspaceId, conn!, folder);
      const { reach } = folderTree(await readFolders(workspaceId), folder.id);
      if (folderId && !reach.has(folderId)) throw new Fail(404, "onedrive_folder_missing");
      const shows = (r: MediaRow) => folderId ? r.parent_id === folderId : !!reach.get(r.parent_id)?.visible;
      const after = (r: MediaRow) => {
        if (!cursor) return true;
        const t = iso(r.taken_at);
        return t < cursor.t || (t === cursor.t && r.item_id < cursor.id);
      };
      const order = (a: MediaRow, b: MediaRow) => iso(b.taken_at).localeCompare(iso(a.taken_at)) || (a.item_id < b.item_id ? 1 : a.item_id > b.item_id ? -1 : 0);
      const inFolder = (q: Query) => folderId ? q.eq("parent_id", folderId) : q;
      const seen = new Map<string, MediaRow>();
      const add = (rows: MediaRow[]) => { for (const r of rows) if (after(r)) seen.set(r.item_id, r); };
      let exhausted = true;
      if (filter === "star") add(await readVisible(workspaceId, MEDIA_COLS, filter, stars, inFolder));
      else {
        const sameTime = (t: string) => readVisible(workspaceId, MEDIA_COLS, filter, stars, (q) => inFolder(q).eq("taken_at", t));
        if (cursor) add(await sameTime(cursor.t));
        let found = 0, lastT: string | null = null;
        exhausted = false;
        for (let page = 0;; page++) {
          if (page >= LIBRARY_SCAN_PAGES) break;
          let q = admin.from(PHOTOS).select(MEDIA_COLS).eq("workspace_id", workspaceId).is("trashed_at", null);
          if (filter === "video") q = q.eq("kind", "video");
          if (filter === "shot") q = q.eq("screenshot", true);
          q = inFolder(q);
          if (cursor) q = q.lt("taken_at", cursor.t);
          // item_id 2차 정렬은 쪽 나누기를 결정적으로 만들 뿐이다(DB 정렬 규칙과 이 함수의 id 순서가 달라도, 같은 시각 묶음은 아래에서 통째로 다시 읽어 맞춘다).
          const { data, error } = await q.order("taken_at", { ascending: false }).order("item_id", { ascending: false })
            .range(page * DB_PAGE, page * DB_PAGE + DB_PAGE - 1);
          if (error) dbFail("onedrive_index_read_failed:library", error);
          const rows = Array.isArray(data) ? data as MediaRow[] : [];
          add(rows);
          for (const r of rows) if (shows(r)) found++;
          if (rows.length) lastT = iso(rows[rows.length - 1].taken_at);
          if (rows.length < DB_PAGE) {
            exhausted = true;
            break;
          }
          if (found > limit) break;
        }
        // 마지막으로 읽은 시각의 묶음을 통째로 채운다(쪽 경계에서 잘린 같은 시각 사진).
        if (!exhausted && lastT) add(await sameTime(lastT));
      }
      const rows = [...seen.values()].sort(order);
      const items: MediaRow[] = [];
      let next: { t: string; id: string } | null = null;
      for (const r of rows) {
        if (!shows(r)) continue;
        if (items.length === limit) {
          next = { t: iso(items[items.length - 1].taken_at), id: items[items.length - 1].item_id };
          break;
        }
        items.push(r);
      }
      if (!next && !exhausted && rows.length) {
        const last = rows[rows.length - 1];
        next = { t: iso(last.taken_at), id: last.item_id };
      }
      return json({ items: items.map(itemOut), next_cursor: next, indexing });
    },

    // 달별 장수(빠른 이동 막대·달 눈금): {"2026-10": 14, …}. 거르기는 library와 같다.
    async months({ workspaceId, body }) {
      const conn = await readConnection(workspaceId);
      const folder = folderOf(conn);
      const { filter, stars } = readFilter(body);
      const indexing = await autoSync(workspaceId, conn!, folder);
      const { reach } = folderTree(await readFolders(workspaceId), folder.id);
      const rows = await readVisible(workspaceId, "item_id,parent_id,taken_day,kind,screenshot", filter, stars);
      const months: Record<string, number> = {};
      let total = 0;
      for (const r of rows) {
        if (!reach.get(r.parent_id)?.visible || !passes(r, filter, stars)) continue;
        const m = String(r.taken_day).slice(0, 7);
        months[m] = (months[m] || 0) + 1;
        total++;
      }
      return json({ months, total, indexing });
    },

    // 한 달의 날별 장수와 대표 1장(달력 보기). 대표 = 그날 별표한 첫 장(star_ids), 없으면 첫 장(찍은 시각 오름차순).
    async days({ workspaceId, body }) {
      const conn = await readConnection(workspaceId);
      const folder = folderOf(conn);
      const month = body.month;
      if (!validMonth(month)) throw new Fail(400, "onedrive_request_invalid");
      const { filter, stars } = readFilter(body);
      const { reach } = folderTree(await readFolders(workspaceId), folder.id);
      const rows = (await readVisible(workspaceId, MEDIA_COLS, filter, stars, (q) => q.gte("taken_day", `${month}-01`).lt("taken_day", monthEnd(month))))
        .filter((r) => reach.get(r.parent_id)?.visible && passes(r, filter, stars) && String(r.taken_day).startsWith(month + "-"))
        .sort((a, b) => iso(a.taken_at).localeCompare(iso(b.taken_at)) || (a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0));
      const days: Record<string, { count: number; cover: { id: string; kind: string } }> = {};
      for (const r of rows) {
        const day = String(r.taken_day).slice(0, 10);
        const cur = days[day];
        const cover = { id: r.item_id, kind: r.kind === "video" ? "video" : "photo" };
        if (!cur) days[day] = { count: 1, cover };
        else {
          cur.count++;
          if (stars?.has(r.item_id) && !stars.has(cur.cover.id)) cur.cover = cover;
        }
      }
      return json({ month, days });
    },

    // Web2 휴지통 목록. 원드라이브 앱에서 넣은 것처럼 옮긴 시각이 없는 사진은 지금을 옮긴 시각으로 적는다.
    // 열 때마다 30일 지난 것을 오래된 순으로 20장까지 원드라이브 휴지통으로 보낸다(권한이 맞을 때만, 새 예약 작업 없음).
    async "trash-list"({ workspaceId }) {
      const conn = await readConnection(workspaceId);
      const folder = folderOf(conn);
      const trashId = await readTrashId(workspaceId);
      if (!trashId) return json({ items: [], purged: 0, truncated: false });
      const stamp = new Date(now()).toISOString();
      const { error } = await admin.from(PHOTOS).update({ trashed_at: stamp }).eq("workspace_id", workspaceId).eq("parent_id", trashId).is("trashed_at", null);
      if (error) dbFail("onedrive_trash_stamp_failed", error);
      let rows = await readAll<MediaRow>("onedrive_index_read_failed:trash", () =>
        admin.from(PHOTOS).select(MEDIA_COLS + ",trashed_at,orig_parent_id").eq("workspace_id", workspaceId).eq("parent_id", trashId).order("item_id"));
      let purged = 0;
      const limitAt = new Date(now() - TRASH_DAYS * 86400000).toISOString();
      const old = rows.filter((r) => r.trashed_at && iso(r.trashed_at || stamp) < limitAt)
        .sort((a, b) => iso(a.trashed_at || stamp).localeCompare(iso(b.trashed_at || stamp))).slice(0, TRASH_PURGE_STEP);
      if (old.length && scopeAllowed(normalizeScopes(conn!.scope))) {
        try {
          const token = await accessToken(workspaceId, conn!);
          const done = await purge(token, workspaceId, old.map((r) => r.item_id), trashId, folder, new Map());
          purged = done.length;
          const gone = new Set(done);
          rows = rows.filter((r) => !gone.has(r.item_id));
        } catch (e) {
          // 비우기는 다음에 다시 한다. 목록은 그대로 보여 준다(연결 풀림은 그대로 알린다).
          if (!(e instanceof Fail) || e.code === "onedrive_auth_expired") throw e;
          log("onedrive_trash_purge_skipped:" + e.code);
        }
      }
      const { byId } = folderTree(await readFolders(workspaceId), folder.id);
      rows.sort((a, b) => iso(b.trashed_at || stamp).localeCompare(iso(a.trashed_at || stamp)) || (a.item_id < b.item_id ? 1 : -1));
      const truncated = rows.length > TRASH_LIST_MAX;
      const items = rows.slice(0, TRASH_LIST_MAX).map((r) => ({
        ...itemOut(r), trashed_at: iso(r.trashed_at || stamp),
        purge_at: new Date(Date.parse(iso(r.trashed_at || stamp)) + TRASH_DAYS * 86400000).toISOString(),
        from: r.orig_parent_id ? { id: r.orig_parent_id, name: byId.get(r.orig_parent_id)?.name ?? null } : null,
      }));
      return json({ items, purged, truncated });
    },

    // 되살리기: Web2 휴지통 안 사진을 원래 폴더로(원래 폴더가 없어졌거나 휴지통이면 맨 위 폴더로) 옮긴다. 같은 이름이 있으면 원드라이브가 이름을 바꿔 넣는다(덮어쓰지 않음).
    async "trash-restore"({ workspaceId, body }) {
      const { conn, folder, ids } = await writeRequest(workspaceId, body, false);
      const trashId = await readTrashId(workspaceId);
      if (!trashId) throw new Fail(404, "onedrive_trash_missing");
      const token = await accessToken(workspaceId, conn);
      const { ok, failed, retryAfter } = await checkMedia(token, ids, folder, (it) => it.parentReference?.id === trashId ? null : "not_in_trash");
      const { reach } = folderTree(await readFolders(workspaceId), folder.id);
      const origin = new Map<string, string>();
      for (let i = 0; i < ids.length; i += IN_CHUNK) {
        const { data, error } = await admin.from(PHOTOS).select("item_id,orig_parent_id").eq("workspace_id", workspaceId).in("item_id", ids.slice(i, i + IN_CHUNK));
        if (error) dbFail("onedrive_index_read_failed:restore", error);
        for (const r of (Array.isArray(data) ? data : []) as { item_id: string; orig_parent_id: string | null }[]) {
          if (r.orig_parent_id && reach.has(r.orig_parent_id)) origin.set(r.item_id, r.orig_parent_id);
        }
      }
      const groups = new Map<string, OneDriveItem[]>();
      for (const it of ok.values()) {
        const target = origin.get(it.id) || folder.id;
        (groups.get(target) || groups.set(target, []).get(target)!).push(it);
      }
      const restored: string[] = [];
      let wait = retryAfter;
      for (const [target, items] of groups) {
        const moved = await moveItems(token, items, target, failed);
        wait = Math.max(wait, moved.retryAfter);
        await indexMoved(workspaceId, moved.done, { parent_id: target, trashed_at: null, orig_parent_id: null });
        restored.push(...moved.done.keys());
      }
      return json({ restored, failed: Object.fromEntries(failed), ...(wait ? { retry_after: wait } : {}) });
    },

    // 바로 지우기·모두 비우기: Web2 휴지통 안 사진만 원드라이브 휴지통으로 보낸다(Graph DELETE, 원드라이브에서 30일 더 보관). confirm:true 필수.
    async "trash-purge"({ workspaceId, body }) {
      const { conn, folder, ids } = await writeRequest(workspaceId, body, true);
      const trashId = await readTrashId(workspaceId);
      if (!trashId) throw new Fail(404, "onedrive_trash_missing");
      const token = await accessToken(workspaceId, conn);
      const failed = new Map<string, string>();
      const purged = await purge(token, workspaceId, ids, trashId, folder, failed);
      return json({ purged, failed: Object.fromEntries(failed) });
    },

    // ── 사진 메뉴 ②: 폴더 보기 ─────────────────────────────────────────────────────────────
    // 새 폴더: 맨 위 폴더 또는 그 아래 폴더(휴지통 제외) 안에. 같은 이름이 있으면 409 onedrive_name_taken(덮어쓰지 않음).
    async "folder-create"({ workspaceId, body }) {
      const w = await folderWrite(workspaceId);
      const name = cleanFolderName(body.name);
      if (!validItemId(body.parent_id) || !name) throw new Fail(400, "onedrive_request_invalid");
      const parent = body.parent_id;
      inTree(w, parent);
      await folderInTop(w.token, parent, w.folder);
      const r = await call("onedrive_folder_create", `${GRAPH}/me/drive/items/${encodeURIComponent(parent)}/children`, {
        method: "POST",
        headers: { Authorization: `Bearer ${w.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
      });
      if (r.status === 409) throw new Fail(409, "onedrive_name_taken");
      graphCheck("onedrive_folder_create", r, "onedrive_folder_missing");
      const item = (await bodyJson(r)) as OneDriveItem;
      if (!item.folder || !validItemId(item.id) || item.parentReference?.id !== parent) {
        log("onedrive_folder_create_invalid");
        throw new Fail(502, "onedrive_unavailable");
      }
      const made = typeof item.name === "string" && item.name ? item.name.slice(0, 400) : name;
      await upsertRows("onedrive_folder_save_failed:create", FOLDERS, [{
        workspace_id: workspaceId, item_id: item.id, parent_id: parent, name: made, enabled: true, updated_at: new Date(now()).toISOString(),
      }]);
      return json({ folder: { id: item.id, name: made, parent_id: parent } });
    },

    // 폴더 이름 바꾸기. 맨 위 폴더 자체는 거절(연결 기준이 바뀜). 같은 이름이 있으면 409.
    async "folder-rename"({ workspaceId, body }) {
      const w = await folderWrite(workspaceId);
      const name = cleanFolderName(body.name);
      if (!validItemId(body.folder_id) || !name || body.folder_id === w.folder.id) throw new Fail(400, "onedrive_request_invalid");
      const id = body.folder_id;
      inTree(w, id);
      await folderInTop(w.token, id, w.folder);
      const r = await patchItem("onedrive_folder_rename", w.token, id, { name });
      const made = typeof r.name === "string" && r.name ? r.name.slice(0, 400) : name;
      const { error } = await admin.from(FOLDERS).update({ name: made, updated_at: new Date(now()).toISOString() }).eq("workspace_id", workspaceId).eq("item_id", id);
      if (error) dbFail("onedrive_folder_save_failed:rename", error);
      return json({ folder: { id, name: made } });
    },

    // 폴더를 다른 폴더 아래로. 맨 위 폴더·자기 자신·자기 아래로는 거절. 같은 이름이 옮길 곳에 있으면 409.
    async "folder-move"({ workspaceId, body }) {
      const w = await folderWrite(workspaceId);
      if (!validItemId(body.folder_id) || !validItemId(body.parent_id) || body.folder_id === w.folder.id || body.folder_id === body.parent_id) {
        throw new Fail(400, "onedrive_request_invalid");
      }
      const id = body.folder_id, parent = body.parent_id;
      inTree(w, id);
      inTree(w, parent);
      if (below(w, id).has(parent)) throw new Fail(400, "onedrive_request_invalid");
      if (w.tree.byId.get(id)?.parent_id === parent) return json({ folder: { id, parent_id: parent }, moved: false });
      await folderInTop(w.token, id, w.folder);
      await folderInTop(w.token, parent, w.folder);
      await patchItem("onedrive_folder_move", w.token, id, { parentReference: { id: parent } });
      const { error } = await admin.from(FOLDERS).update({ parent_id: parent, updated_at: new Date(now()).toISOString() }).eq("workspace_id", workspaceId).eq("item_id", id);
      if (error) dbFail("onedrive_folder_save_failed:move", error);
      return json({ folder: { id, parent_id: parent }, moved: true });
    },

    // 빈 폴더 지우기(원드라이브 휴지통으로, 원드라이브에서 30일 보관). 색인에 하위 폴더·사진이 있거나 원드라이브에 다른 파일이라도 있으면
    // 409 onedrive_folder_not_empty(사진이 아닌 파일이 함께 지워지지 않게). 사진 든 폴더째 휴지통은 ③단계. confirm:true 필수.
    async "folder-delete"({ workspaceId, body }) {
      const w = await folderWrite(workspaceId);
      if (!validItemId(body.folder_id) || body.confirm !== true || body.folder_id === w.folder.id) throw new Fail(400, "onedrive_request_invalid");
      const id = body.folder_id;
      inTree(w, id);
      if ((w.tree.kids.get(id) || []).length) throw new Fail(409, "onedrive_folder_not_empty");
      const { data, error } = await admin.from(PHOTOS).select("item_id").eq("workspace_id", workspaceId).eq("parent_id", id).range(0, 0);
      if (error) dbFail("onedrive_index_read_failed:folder_delete", error);
      if (Array.isArray(data) && data.length) throw new Fail(409, "onedrive_folder_not_empty");
      await folderInTop(w.token, id, w.folder);
      const kids = await graph("onedrive_folder_children", w.token, `/me/drive/items/${encodeURIComponent(id)}/children?$select=id&$top=1`);
      graphCheck("onedrive_folder_children", kids, "onedrive_folder_missing");
      const d = await bodyJson(kids);
      if (!Array.isArray(d.value) || d.value.length) throw new Fail(409, "onedrive_folder_not_empty");
      const r = await call("onedrive_folder_delete", `${GRAPH}/me/drive/items/${encodeURIComponent(id)}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${w.token}` },
      });
      if (r.status !== 404) graphCheck("onedrive_folder_delete", r, "onedrive_folder_missing");
      await deleteIn("onedrive_index_delete_failed:folder", FOLDERS, workspaceId, "item_id", [id]);
      return json({ deleted: true });
    },

    // 여러 장(ids ≤ 50)을 한 폴더로 옮기기(원드라이브에서도 실제 이동, 같은 이름이면 원드라이브가 이름을 바꿔 넣음 = 덮어쓰지 않음).
    // 옮길 곳은 맨 위 폴더 또는 그 아래 폴더(휴지통 제외). 하나라도 고른 폴더 밖이면 하나도 옮기지 않는다(403). 휴지통 안 사진은 trash-restore로.
    // 답의 moved[].from(원래 폴더 id)으로 화면이 되돌리기(같은 동작으로 원래 폴더에)를 한다.
    async "photos-move"({ workspaceId, body }) {
      const { conn, folder, ids } = await writeRequest(workspaceId, body, false);
      if (!validItemId(body.parent_id)) throw new Fail(400, "onedrive_request_invalid");
      const target = body.parent_id;
      const tree = folderTree(await readFolders(workspaceId), folder.id);
      if (!tree.reach.has(target)) throw new Fail(404, "onedrive_folder_missing");
      const token = await accessToken(workspaceId, conn);
      await folderInTop(token, target, folder);
      const trashId = await readTrashId(workspaceId);
      const { ok, failed, retryAfter } = await checkMedia(token, ids, folder, (it) => trashId && it.parentReference?.id === trashId ? "in_trash" : null);
      if ([...failed.values()].includes("outside")) throw new Fail(403, "onedrive_outside_folder");
      const here = [...ok.values()].filter((it) => it.parentReference?.id === target);
      const moved = await moveItems(token, [...ok.values()].filter((it) => it.parentReference?.id !== target), target, failed);
      await indexMoved(workspaceId, moved.done, { parent_id: target });
      const wait = Math.max(retryAfter, moved.retryAfter);
      const out = [...[...moved.done].map(([id, m]) => ({ id, from: m.from, name: m.name })), ...here.map((it) => ({ id: it.id, from: target, name: null }))];
      return json({ moved: out, failed: Object.fromEntries(failed), ...(wait ? { retry_after: wait } : {}) });
    },

    async disconnect({ workspaceId }) {
      cached.delete(workspaceId);
      await clearIndexRows(workspaceId);
      const { error } = await admin.from(CONN).delete().eq("workspace_id", workspaceId);
      if (error) dbFail("onedrive_disconnect_failed", error);
      return json({ connected: false });
    },
  };

  // 폴더 쓰기 공통(사진 메뉴 ②): 연결·맨 위 폴더·쓰기 권한 범위·접근 토큰·색인 폴더 나무.
  async function folderWrite(workspaceId: string) {
    const conn = await readConnection(workspaceId);
    const folder = folderOf(conn);
    if (!scopeAllowed(normalizeScopes(conn!.scope))) throw new Fail(424, "onedrive_reconnect_needed");
    const tree = folderTree(await readFolders(workspaceId), folder.id);
    const token = await accessToken(workspaceId, conn!);
    return { conn: conn!, folder, tree, token };
  }
  // 색인 폴더 나무(맨 위 폴더에서 이어지는 폴더, 휴지통과 그 아래 제외)에 있어야 한다. 없으면 404.
  const inTree = (w: { tree: ReturnType<typeof folderTree> }, id: string) => {
    if (!w.tree.reach.has(id)) throw new Fail(404, "onedrive_folder_missing");
  };
  // 그 폴더 아래 모든 폴더 id(자기 포함).
  function below(w: { tree: ReturnType<typeof folderTree> }, id: string) {
    const out = new Set<string>([id]), stack = [id];
    while (stack.length) for (const k of w.tree.kids.get(stack.pop()!) || []) if (!out.has(k.item_id)) { out.add(k.item_id); stack.push(k.item_id); }
    return out;
  }
  // 원드라이브에서도 맨 위 폴더(자기) 또는 그 아래 폴더인지(경로) 확인한다. 아니면 403(폴더 밖)·404(폴더 아님·없음).
  async function folderInTop(token: string, id: string, folder: { id: string; path: string }) {
    const item = await getItem(token, id, "id,name,folder,parentReference");
    if (item.id !== id || !item.folder) throw new Fail(404, "onedrive_folder_missing");
    if (id !== folder.id && !insideFolder(item.parentReference?.path, folder.path)) throw new Fail(403, "onedrive_outside_folder");
    return item;
  }
  // 항목 하나 고치기(이름·부모). 같은 이름이 있으면 덮어쓰지 않고 409 onedrive_name_taken.
  async function patchItem(stage: string, token: string, id: string, patch: Record<string, unknown>) {
    const r = await call(stage, `${GRAPH}/me/drive/items/${encodeURIComponent(id)}?@microsoft.graph.conflictBehavior=fail`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (r.status === 409) throw new Fail(409, "onedrive_name_taken");
    graphCheck(stage, r, "onedrive_folder_missing");
    return (await bodyJson(r)) as OneDriveItem;
  }

  // 사진·동영상이 맞고 고른 폴더 안에 있는지 확인한다(읽기·지우기가 함께 쓴다). 아니면 404(사진·동영상 아님·없음) 또는 403(폴더 밖).
  async function photoInFolder(token: string, id: string, folder: { path: string }) {
    const item = await getItem(token, id, "id,file,folder,parentReference");
    if (item.id !== id || item.folder || !isMediaMime(item.file?.mimeType)) throw new Fail(404, "onedrive_item_missing");
    if (!insideFolder(item.parentReference?.path, folder.path)) throw new Fail(403, "onedrive_outside_folder");
  }

  // 쓰기 요청 공통: 연결·맨 위 폴더·ids(1~50, 같은 id는 하나로)·(지우기류는 confirm:true)·쓰기 권한 범위.
  async function writeRequest(workspaceId: string, body: Record<string, unknown>, needConfirm: boolean) {
    const conn = await readConnection(workspaceId);
    const folder = folderOf(conn);
    const ids = body.ids;
    if ((needConfirm && body.confirm !== true) || !Array.isArray(ids) || !ids.length || ids.length > MOVE_MAX || !ids.every(validItemId)) {
      throw new Fail(400, "onedrive_request_invalid");
    }
    if (!scopeAllowed(normalizeScopes(conn!.scope))) throw new Fail(424, "onedrive_reconnect_needed");
    return { conn: conn!, folder, ids: [...new Set(ids as string[])] };
  }

  type Part = { status?: number; headers?: Record<string, string>; body?: Record<string, unknown> };
  // Graph $batch 한 번(하위 요청 20개까지). 묶음 전체가 429·503이면 throttled(초)로, 그 밖의 실패는 빈 답으로 돌려준다(각 항목이 unavailable).
  async function graphBatch(stage: string, token: string, requests: Record<string, unknown>[]) {
    const r = await call(stage, `${GRAPH}/$batch`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    });
    const parts = new Map<string, Part>();
    if (r.status === 429 || r.status === 503) {
      log(stage + "_throttled:" + r.status);
      return { parts, throttled: retryAfterSeconds(r.headers.get("retry-after"), now()) };
    }
    if (r.status === 401 || r.status === 403) throw new Fail(424, "onedrive_auth_expired");
    if (!r.ok) {
      log(stage + "_rejected:" + r.status);
      return { parts, throttled: 0 };
    }
    const d = await bodyJson(r);
    for (const x of Array.isArray(d.responses) ? d.responses : []) if (x && typeof x.id === "string") parts.set(x.id, x);
    return { parts, throttled: 0 };
  }
  const partWait = (p: Part | undefined) => {
    if (!p || (p.status !== 429 && p.status !== 503)) return 0;
    const h: Record<string, string> = p.headers || {};
    return retryAfterSeconds(String(h["Retry-After"] ?? h["retry-after"] ?? "") || null, now());
  };

  // 여러 장이 사진·동영상이고 고른 폴더 안인지 Graph에 묻는다(+ 추가 조건 extra). 통과한 항목과 실패 이름(missing·outside·throttled·unavailable·…)을 돌려준다.
  async function checkMedia(token: string, ids: string[], folder: { path: string }, extra: (it: OneDriveItem) => string | null) {
    const ok = new Map<string, OneDriveItem>(), failed = new Map<string, string>();
    let retryAfter = 0;
    for (let i = 0; i < ids.length; i += GRAPH_BATCH_MAX) {
      const chunk = ids.slice(i, i + GRAPH_BATCH_MAX);
      const { parts, throttled } = await graphBatch("onedrive_check", token, chunk.map((id, k) => ({
        id: `m${k}`, method: "GET", url: `/me/drive/items/${encodeURIComponent(id)}?$select=id,name,file,folder,parentReference`,
      })));
      retryAfter = Math.max(retryAfter, throttled);
      chunk.forEach((id, k) => {
        const p = parts.get(`m${k}`), wait = partWait(p);
        if (throttled || wait) {
          retryAfter = Math.max(retryAfter, wait);
          return void failed.set(id, "throttled");
        }
        if (!p || p.status === 404) return void failed.set(id, p ? "missing" : "unavailable");
        if (p.status !== 200) return void failed.set(id, "unavailable");
        const item = (p.body || {}) as OneDriveItem;
        const bad = photoCheck(id, item, folder) || extra(item);
        if (bad) return void failed.set(id, bad);
        ok.set(id, item);
      });
    }
    return { ok, failed, retryAfter };
  }

  // 여러 장을 한 폴더로 옮긴다(Graph PATCH parentReference, 같은 이름이면 원드라이브가 이름을 바꿔 넣음 = 덮어쓰지 않음).
  // 성공은 done(id → 새 이름·원래 부모 id), 실패는 failed에 적는다.
  async function moveItems(token: string, items: OneDriveItem[], targetId: string, failed: Map<string, string>) {
    const done = new Map<string, { name: string | null; from: string | null }>();
    let retryAfter = 0;
    for (let i = 0; i < items.length; i += GRAPH_BATCH_MAX) {
      const chunk = items.slice(i, i + GRAPH_BATCH_MAX);
      const { parts, throttled } = await graphBatch("onedrive_move", token, chunk.map((it, k) => ({
        id: `v${k}`, method: "PATCH", url: `/me/drive/items/${encodeURIComponent(it.id)}?@microsoft.graph.conflictBehavior=rename`,
        headers: { "Content-Type": "application/json" }, body: { parentReference: { id: targetId } },
      })));
      retryAfter = Math.max(retryAfter, throttled);
      chunk.forEach((it, k) => {
        const p = parts.get(`v${k}`), wait = partWait(p);
        if (throttled || wait) {
          retryAfter = Math.max(retryAfter, wait);
          return void failed.set(it.id, "throttled");
        }
        if (!p) return void failed.set(it.id, "unavailable");
        if (p.status === 404) return void failed.set(it.id, "missing");
        if (p.status === 401 || p.status === 403) return void failed.set(it.id, "forbidden");
        if (p.status !== 200 && p.status !== 201) return void failed.set(it.id, "move_failed");
        const name = typeof p.body?.name === "string" && p.body.name ? (p.body.name as string).slice(0, 400) : null;
        done.set(it.id, { name, from: validItemId(it.parentReference?.id) ? it.parentReference!.id! : null });
      });
    }
    return { done, retryAfter };
  }

  // 옮긴 사진의 색인 행을 바로 고친다(부모·휴지통 칸, 이름이 바뀌었으면 이름). 실패해도 다음 변경 받기(delta)가 맞추므로 기록만 한다.
  async function indexMoved(workspaceId: string, done: Map<string, { name: string | null; from: string | null }>, fields: Record<string, unknown>, keepFrom = false) {
    if (keepFrom) {
      // Graph 답에 원래 부모 id가 없으면 색인의 지금 부모로 채운다(되살리기 자리).
      const missing = [...done].filter(([, m]) => !m.from).map(([id]) => id);
      for (let i = 0; i < missing.length; i += IN_CHUNK) {
        const { data } = await admin.from(PHOTOS).select("item_id,parent_id").eq("workspace_id", workspaceId).in("item_id", missing.slice(i, i + IN_CHUNK));
        for (const r of (Array.isArray(data) ? data : []) as { item_id: string; parent_id: string }[]) {
          const m = done.get(r.item_id);
          if (m && validItemId(r.parent_id)) m.from = r.parent_id;
        }
      }
    }
    const groups = new Map<string, string[]>();
    for (const [id, m] of done) {
      const key = keepFrom ? (m.from ?? "") : "";
      (groups.get(key) || groups.set(key, []).get(key)!).push(id);
    }
    for (const [from, ids] of groups) {
      for (let i = 0; i < ids.length; i += IN_CHUNK) {
        const { error } = await admin.from(PHOTOS).update({ ...fields, ...(keepFrom ? { orig_parent_id: from || null } : {}) })
          .eq("workspace_id", workspaceId).in("item_id", ids.slice(i, i + IN_CHUNK));
        if (error) log("onedrive_index_move_failed" + (/^[0-9A-Z]{5}$/.test(String(error.code)) ? ":" + error.code : ""));
      }
    }
    for (const [id, m] of done) {
      if (!m.name) continue;
      const { error } = await admin.from(PHOTOS).update({ name: m.name }).eq("workspace_id", workspaceId).eq("item_id", id).neq("name", m.name);
      if (error) log("onedrive_index_move_failed:name" + (/^[0-9A-Z]{5}$/.test(String(error.code)) ? ":" + error.code : ""));
    }
  }

  // Web2 휴지통 안 사진을 원드라이브 휴지통으로 보낸다(Graph DELETE는 영구 삭제가 아니다). 휴지통 밖 사진은 거절(not_in_trash).
  async function purge(token: string, workspaceId: string, ids: string[], trashId: string, folder: { path: string }, failed: Map<string, string>) {
    const { ok, failed: bad } = await checkMedia(token, ids, folder, (it) => it.parentReference?.id === trashId ? null : "not_in_trash");
    for (const [id, why] of bad) {
      // 원드라이브에서 이미 사라졌으면 색인만 지운다.
      if (why === "missing") ok.set(id, { id });
      else failed.set(id, why);
    }
    const done: string[] = [], list = [...ok.keys()];
    for (let i = 0; i < list.length; i += GRAPH_BATCH_MAX) {
      const chunk = list.slice(i, i + GRAPH_BATCH_MAX);
      const real = chunk.filter((id) => bad.get(id) !== "missing");
      const { parts, throttled } = real.length
        ? await graphBatch("onedrive_purge", token, real.map((id, k) => ({ id: `d${k}`, method: "DELETE", url: `/me/drive/items/${encodeURIComponent(id)}` })))
        : { parts: new Map<string, Part>(), throttled: 0 };
      chunk.forEach((id) => {
        const k = real.indexOf(id);
        if (k < 0) return void done.push(id);
        const p = parts.get(`d${k}`);
        if (throttled || partWait(p)) return void failed.set(id, "throttled");
        if (p && (p.status === 204 || p.status === 200 || p.status === 404)) return void done.push(id);
        failed.set(id, p && (p.status === 401 || p.status === 403) ? "forbidden" : "delete_failed");
      });
    }
    if (done.length) await deleteIn("onedrive_index_delete_failed:purge", PHOTOS, workspaceId, "item_id", done);
    return done;
  }

  // 'Web2 휴지통' 폴더(맨 위 폴더 바로 아래 .Web2 휴지통)를 찾거나 만든다. 색인에 있으면 원드라이브에 아직 있는지 확인하고,
  // 없으면(지워짐·밖으로 옮겨짐) 표시를 떼고 새로 만든다. 같은 이름이 이미 있으면(다른 기기에서 먼저 만듦) 그 폴더를 쓴다. 폴더는 꺼짐(일기·사진에 안 보임).
  async function ensureTrash(token: string, workspaceId: string, folder: { id: string }) {
    const known = await readTrashId(workspaceId);
    if (known) {
      try {
        const it = await getItem(token, known, "id,name,folder,parentReference");
        if (it.folder && it.id === known && it.parentReference?.id === folder.id) return known;
      } catch (e) {
        if (!(e instanceof Fail) || e.code !== "onedrive_item_missing") throw e;
      }
      const { error } = await admin.from(FOLDERS).update({ role: null }).eq("workspace_id", workspaceId).eq("item_id", known);
      if (error) dbFail("onedrive_trash_save_failed:reset", error);
    }
    const r = await call("onedrive_trash_create", `${GRAPH}/me/drive/items/${encodeURIComponent(folder.id)}/children`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: TRASH_NAME, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
    });
    let item: OneDriveItem;
    if (r.status === 409) {
      const found = await graph("onedrive_trash_find", token,
        `/me/drive/items/${encodeURIComponent(folder.id)}:/${encodeURIComponent(TRASH_NAME)}:?$select=id,name,folder,parentReference`);
      graphCheck("onedrive_trash_find", found, "onedrive_trash_missing");
      item = (await bodyJson(found)) as OneDriveItem;
    } else {
      graphCheck("onedrive_trash_create", r, "onedrive_folder_missing");
      item = (await bodyJson(r)) as OneDriveItem;
    }
    if (!item.folder || !validItemId(item.id) || item.parentReference?.id !== folder.id) {
      log("onedrive_trash_invalid");
      throw new Fail(502, "onedrive_unavailable");
    }
    const { error } = await admin.from(FOLDERS).upsert([{
      workspace_id: workspaceId, item_id: item.id, parent_id: folder.id, name: TRASH_NAME, enabled: false, role: "trash", updated_at: new Date(now()).toISOString(),
    }], { onConflict: "workspace_id,item_id" });
    if (error) dbFail("onedrive_trash_save_failed", error);
    return item.id;
  }

  // 지우기(명진 결정 1) = 고른 폴더 안 'Web2 휴지통' 폴더로 옮기기(되살리기는 trash-restore, 30일 뒤 원드라이브 휴지통).
  // 한 장(id, 예전 화면과 같은 답) 또는 여러 장(ids ≤ 50). 고른 폴더 안 사진·동영상만, confirm:true가 있을 때만. 이미 휴지통 안이면 옮긴 것으로 친다.
  async function photoDelete(workspaceId: string, body: Record<string, unknown>): Promise<Response> {
    const single = body.ids === undefined;
    if (single && !validItemId(body.id)) throw new Fail(400, "onedrive_request_invalid");
    const { conn, folder, ids } = await writeRequest(workspaceId, single ? { ...body, ids: [body.id] } : body, true);
    const token = await accessToken(workspaceId, conn);
    const trashId = await ensureTrash(token, workspaceId, folder);
    const { ok, failed, retryAfter } = await checkMedia(token, ids, folder, () => null);
    const already = [...ok.values()].filter((it) => it.parentReference?.id === trashId);
    const moved = await moveItems(token, [...ok.values()].filter((it) => it.parentReference?.id !== trashId), trashId, failed);
    const stamp = new Date(now()).toISOString();
    await indexMoved(workspaceId, moved.done, { parent_id: trashId, trashed_at: stamp }, true);
    const wait = Math.max(retryAfter, moved.retryAfter);
    const done = [...moved.done.keys(), ...already.map((it) => it.id)];
    if (single) {
      const why = failed.get(ids[0]);
      if (why === "missing" || why === "not_in_trash") throw new Fail(404, "onedrive_item_missing");
      if (why === "outside") throw new Fail(403, "onedrive_outside_folder");
      if (why === "throttled") throw new Fail(429, "onedrive_throttled", { retry_after: wait || 30 });
      if (why === "forbidden") throw new Fail(424, "onedrive_reconnect_needed");
      if (why) throw new Fail(502, "onedrive_delete_failed");
      return json({ deleted: true, trashed: true });
    }
    return json({ deleted: failed.size === 0, moved: done, failed: Object.fromEntries(failed), ...(wait ? { retry_after: wait } : {}) });
  }

  // 동영상 재생·원본 받기 주소(media-url): 고른 폴더 안 사진·동영상 한 장의 짧게 사는(약 1시간) 사전 인증 주소만 돌려준다.
  // 주소에는 접근 토큰·갱신 토큰이 들어가지 않는다. 화면은 메모리에만 두고 expires_in초 뒤 다시 받는다(저장하지 않음). 재생(play)은 동영상만.
  async function mediaUrl(workspaceId: string, body: Record<string, unknown>): Promise<Response> {
    const conn = await readConnection(workspaceId);
    const folder = folderOf(conn);
    const purpose = body.purpose === undefined ? "download" : body.purpose;
    if (!validItemId(body.id) || (purpose !== "play" && purpose !== "download")) throw new Fail(400, "onedrive_request_invalid");
    const token = await accessToken(workspaceId, conn!);
    const item = await getItem(token, body.id, "id,name,size,file,folder,parentReference,@microsoft.graph.downloadUrl");
    const bad = photoCheck(body.id, item, folder);
    if (bad === "outside") throw new Fail(403, "onedrive_outside_folder");
    if (bad) throw new Fail(404, "onedrive_item_missing");
    const mime = String(item.file?.mimeType || "").toLowerCase();
    if (purpose === "play" && !VIDEO_MIME.test(mime)) throw new Fail(400, "onedrive_request_invalid");
    const url = safeDownloadUrl(typeof item["@microsoft.graph.downloadUrl"] === "string" ? item["@microsoft.graph.downloadUrl"] : null);
    if (!url) throw new Fail(502, "onedrive_media_unavailable");
    return json({
      url: url.toString(), expires_in: MEDIA_URL_TTL_S, kind: VIDEO_MIME.test(mime) ? "video" : "photo", mime,
      size: typeof item.size === "number" ? item.size : null, name: typeof item.name === "string" ? item.name : null,
    });
  }

  // 사진·동영상이면서 고른 폴더 안인지(photoInFolder와 같은 판단, Graph 응답 본문만 보고). 맞으면 null, 아니면 실패 이름.
  const photoCheck = (id: string, item: OneDriveItem, folder: { path: string }): string | null => {
    if (!item || item.id !== id || item.folder || !isMediaMime(item.file?.mimeType)) return "missing";
    if (!insideFolder(item.parentReference?.path, folder.path)) return "outside";
    return null;
  };

  // 여러 장의 썸네일 주소(photo-urls). 사진마다 ① 사진 정보(폴더 안인지 확인) ② 썸네일 목록을 Graph $batch 한 번에 묻는다.
  // 돌려주는 주소는 Microsoft가 그 썸네일 하나에만 준 짧게 사는 사전 인증 주소다(기존 photo의 302 위치와 같은 종류). 접근 토큰·갱신 토큰은 주소에 들어가지 않고 응답에도 싣지 않는다.
  // 폴더 밖·사진 아님·없음·요청 많음은 사진별 failed로 알려 준다(주소를 주지 않음). 요청 많음이면 retry_after(초)를 함께 준다.
  async function photoUrls(workspaceId: string, body: Record<string, unknown>): Promise<Response> {
    const conn = await readConnection(workspaceId);
    const folder = folderOf(conn);
    const size = body.size === undefined ? "small" : body.size;
    const ids = body.ids;
    if (typeof size !== "string" || !Object.hasOwn(SIZES, size)) throw new Fail(400, "onedrive_request_invalid");
    if (!Array.isArray(ids) || !ids.length || ids.length > PHOTO_URLS_MAX || !ids.every(validItemId)) throw new Fail(400, "onedrive_request_invalid");
    const unique = [...new Set(ids as string[])];
    const sizeKey = SIZES[size as keyof typeof SIZES];
    const token = await accessToken(workspaceId, conn!);
    const urls = new Map<string, string>(), failed = new Map<string, string>();
    let retryAfter = 0;
    const throttled = (id: string, header: string | null) => {
      failed.set(id, "throttled");
      retryAfter = Math.max(retryAfter, retryAfterSeconds(header, now()));
    };
    const chunks: string[][] = [];
    for (let i = 0; i < unique.length; i += GRAPH_BATCH_PHOTOS) chunks.push(unique.slice(i, i + GRAPH_BATCH_PHOTOS));
    await Promise.all(chunks.map(async (chunk) => {
      const requests = chunk.flatMap((id, k) => [
        { id: `m${k}`, method: "GET", url: `/me/drive/items/${encodeURIComponent(id)}?$select=id,file,folder,parentReference` },
        { id: `t${k}`, method: "GET", url: `/me/drive/items/${encodeURIComponent(id)}/thumbnails?select=${sizeKey}` },
      ]);
      const r = await call("onedrive_batch", `${GRAPH}/$batch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ requests }),
      });
      if (r.status === 429 || r.status === 503) {
        log("onedrive_batch_throttled:" + r.status);
        for (const id of chunk) throttled(id, r.headers.get("retry-after"));
        return;
      }
      if (r.status === 401 || r.status === 403) throw new Fail(424, "onedrive_auth_expired");
      if (!r.ok) {
        log("onedrive_batch_rejected:" + r.status);
        for (const id of chunk) failed.set(id, "unavailable");
        return;
      }
      const d = await bodyJson(r);
      const byId = new Map<string, { status?: number; headers?: Record<string, string>; body?: Record<string, unknown> }>();
      for (const x of Array.isArray(d.responses) ? d.responses : []) if (x && typeof x.id === "string") byId.set(x.id, x);
      chunk.forEach((id, k) => {
        const meta = byId.get(`m${k}`), thumbs = byId.get(`t${k}`);
        for (const part of [meta, thumbs]) {
          if (part && (part.status === 429 || part.status === 503)) {
            const h: Record<string, string> = part.headers || {};
            return throttled(id, String(h["Retry-After"] ?? h["retry-after"] ?? "") || null);
          }
        }
        if (!meta || meta.status === 404) return void failed.set(id, "missing");
        if (meta.status !== 200) return void failed.set(id, "unavailable");
        const bad = photoCheck(id, (meta.body || {}) as OneDriveItem, folder);
        if (bad) return void failed.set(id, bad);
        const set = thumbs?.status === 200 && Array.isArray(thumbs.body?.value) ? (thumbs.body!.value as Record<string, unknown>[])[0] : null;
        const raw = (set?.[sizeKey] as { url?: unknown } | undefined)?.url;
        const safe = typeof raw === "string" ? safeDownloadUrl(raw) : null;
        if (!safe) return void failed.set(id, "unavailable");
        urls.set(id, safe.toString());
      });
    }));
    return json({ urls: Object.fromEntries(urls), failed: Object.fromEntries(failed), ...(retryAfter ? { retry_after: retryAfter } : {}) });
  }

  // 사진 한 장(작게/크게). 지정 폴더 안의 사진만 돌려주고, 바이트는 서버가 받아 그대로 전달한다(원드라이브 주소·토큰은 화면에 가지 않음).
  async function photo(workspaceId: string, body: Record<string, unknown>): Promise<Response> {
    const conn = await readConnection(workspaceId);
    const folder = folderOf(conn);
    const size = body.size === undefined ? "small" : body.size;
    if (!validItemId(body.id) || typeof size !== "string" || !Object.hasOwn(SIZES, size)) throw new Fail(400, "onedrive_request_invalid");
    const token = await accessToken(workspaceId, conn!);
    await photoInFolder(token, body.id, folder);
    // 썸네일 내용 주소는 임시 주소로 넘어간다(302). 따라가지 않고 주소만 읽은 뒤, 토큰 없이 한 번만 받는다.
    const first = await call("onedrive_thumb", `${GRAPH}/me/drive/items/${encodeURIComponent(body.id)}/thumbnails/0/${SIZES[size as keyof typeof SIZES]}/content`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "manual",
    });
    if (first.status >= 300 && first.status < 400) {
      const target = safeDownloadUrl(first.headers.get("location"));
      if (!target) throw new Fail(502, "onedrive_photo_unavailable");
      return await thumbnail(await call("onedrive_thumb_file", target.toString()));
    }
    return await thumbnail(first);
  }

  async function thumbnail(first: Response): Promise<Response> {
    if (!first.ok) throw new Fail(502, "onedrive_photo_unavailable");
    const type = (first.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const bytes = new Uint8Array(await first.arrayBuffer());
    if (!/^image\/(jpeg|png|webp|gif)$/.test(type) || !bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Fail(502, "onedrive_photo_unavailable");
    return new Response(bytes, { headers: { ...cors, "Content-Type": type, "Cache-Control": "private, max-age=3600" } });
  }

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    try {
      const m = (req.headers.get("Authorization") || "").match(/^Bearer\s+(\S+)$/i);
      if (!m) throw new Fail(401, "session_required");
      const { data, error } = await admin.auth.getUser(m[1]);
      if (error && ![400, 401, 403, 404].includes(Number(error.status))) throw new Fail(503, "auth_unavailable");
      if (error || !data.user) throw new Fail(401, "session_required");
      if (req.method !== "POST") return json({ error: "POST only" }, 405);
      const { data: member, error: memberError } = await admin.from("app_workspace_members")
        .select("workspace_id,role").eq("user_id", data.user.id).maybeSingle();
      if (memberError) {
        log("onedrive_member_read_failed");
        throw new Fail(503, "authorize_unavailable");
      }
      if (member?.role !== "owner") throw new Fail(403, "forbidden");
      if ((req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() !== "application/json") throw new Fail(415, "json_required");
      const text = await req.text();
      if (text.length > MAX_BODY) throw new Fail(413, "body_too_large");
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(text);
      } catch {
        throw new Fail(400, "json_invalid");
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Fail(400, "json_invalid");
      const action = body.action;
      if (action === "photo") return await photo(member.workspace_id, body);
      if (action === "photo-urls") return await photoUrls(member.workspace_id, body);
      if (action === "photo-delete") return await photoDelete(member.workspace_id, body);
      if (action === "media-url") return await mediaUrl(member.workspace_id, body);
      if (typeof action !== "string" || !Object.hasOwn(actions, action)) throw new Fail(400, "action_invalid");
      return await actions[action]({ userId: data.user.id, workspaceId: member.workspace_id, body });
    } catch (e) {
      if (e instanceof Fail) return json({ ...(e.extra || {}), error: e.code }, e.status);
      log("onedrive_unexpected");
      return json({ error: "onedrive_unavailable" }, 500);
    }
  };
}
