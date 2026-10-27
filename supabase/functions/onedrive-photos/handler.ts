import {
  AUTO_SYNC_BUDGET_MS, AUTO_SYNC_MAX_PAGES, DELTA_SELECT, folderPathOf, GRAPH, GRAPH_BATCH_PHOTOS, graphNextLink, IMAGE_MIME, insideFolder,
  MAX_FOLDER_DEPTH, MAX_IMAGE_BYTES, MAX_ITEMS, PHOTO_URLS_MAX, normalizeScopes, retryAfterSeconds, safeDownloadUrl, SCOPE, scopeAllowed,
  seoulDay, SIZES, SYNC_BUDGET_MS, SYNC_LOCK_MS, SYNC_MAX_PAGES, SYNC_STALE_MS, takenOf, validItemId,
} from "./graph.ts";
import type { OneDriveItem } from "./graph.ts";

// 일기 2차(JOURNAL-일기원드라이브): 원드라이브 연결·폴더 지정·사진 읽기·사진 지우기(휴지통 이동). 권한 Files.ReadWrite(고른 폴더 안 사진만 다룸).
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
type FolderRow = { item_id: string; parent_id: string | null; name: string; enabled: boolean };
type PhotoRow = { item_id: string; parent_id: string; name: string; taken_at: string; approx: boolean; taken_day: string };

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
    admin.from(FOLDERS).select("item_id,parent_id,name,enabled").eq("workspace_id", workspaceId).order("item_id"));

  // 맨 위 폴더에서 부모 id로 이어지는 폴더만 트리에 든다(이어지지 않는 폴더 = 지워졌거나 밖으로 옮겨짐 → 보이지 않음).
  // 사진이 보이려면 맨 위 폴더 아래로 거치는 모든 폴더가 켜져 있어야 한다(맨 위 폴더 자체는 늘 켜짐).
  function folderTree(rows: FolderRow[], topId: string) {
    const byId = new Map(rows.map((r) => [r.item_id, r]));
    const kids = new Map<string, FolderRow[]>();
    for (const r of rows) {
      if (r.item_id === topId || !r.parent_id) continue;
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

  // delta 한 쪽을 표에 반영한다. 지워진 항목·사진 아님·찍은 시각 없음은 색인에서 뺀다. 같은 쪽 안 중복 id는 마지막 것만.
  async function applyDelta(workspaceId: string, topId: string, items: OneDriveItem[], stamp: string) {
    const folders = new Map<string, Record<string, unknown>>(), photos = new Map<string, Record<string, unknown>>(), gone = new Set<string>();
    for (const it of items) {
      if (!it || !validItemId(it.id)) continue;
      const parent = it.parentReference?.id;
      if (it.deleted) {
        gone.add(it.id);
        continue;
      }
      if (it.folder) {
        if (typeof it.name !== "string" || !it.name || it.name.length > 400) continue;
        folders.set(it.id, {
          workspace_id: workspaceId, item_id: it.id, parent_id: it.id === topId ? null : (validItemId(parent) ? parent : null),
          name: it.name, updated_at: stamp,
        });
        continue;
      }
      const taken = it.file?.mimeType && IMAGE_MIME.test(it.file.mimeType) ? takenOf(it) : null;
      const day = taken && seoulDay(taken.at);
      if (!taken || !day || !validItemId(parent)) {
        gone.add(it.id);
        continue;
      }
      const name = typeof it.name === "string" && it.name ? it.name.slice(0, 400) : it.id;
      photos.set(it.id, {
        workspace_id: workspaceId, item_id: it.id, parent_id: parent, name, taken_at: taken.at, approx: taken.approx, taken_day: day, updated_at: stamp,
      });
    }
    for (const id of gone) {
      folders.delete(id);
      photos.delete(id);
    }
    await upsertRows("onedrive_index_save_failed:folders", FOLDERS, [...folders.values()]);
    await upsertRows("onedrive_index_save_failed:photos", PHOTOS, [...photos.values()]);
    if (gone.size) {
      const ids = [...gone];
      await deleteIn("onedrive_index_delete_failed:photos", PHOTOS, workspaceId, "item_id", ids);
      await deleteIn("onedrive_index_delete_failed:in_folder", PHOTOS, workspaceId, "parent_id", ids);
      await deleteIn("onedrive_index_delete_failed:folders", FOLDERS, workspaceId, "item_id", ids);
    }
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
          url = first;
          continue;
        }
        graphCheck("onedrive_delta", r, "onedrive_folder_missing");
        const d = await bodyJson(r);
        await applyDelta(workspaceId, folder.id, Array.isArray(d.value) ? d.value as OneDriveItem[] : [], stamp);
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
    async photos({ workspaceId, body }) {
      const conn = await readConnection(workspaceId);
      const folder = folderOf(conn);
      const month = body.month;
      if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Fail(400, "onedrive_request_invalid");
      let indexing = !conn!.index_done_at;
      const synced = conn!.synced_at ? Date.parse(conn!.synced_at) : NaN;
      if (indexing || !Number.isFinite(synced) || now() - synced > SYNC_STALE_MS) {
        try {
          indexing = (await syncStep(workspaceId, conn!, folder, AUTO_SYNC_BUDGET_MS, AUTO_SYNC_MAX_PAGES)).indexing;
        } catch (e) {
          if (!(e instanceof Fail) || !["onedrive_index_busy", "onedrive_throttled", "onedrive_unavailable"].includes(e.code)) throw e;
          log("onedrive_auto_sync_skipped:" + e.code);
        }
      }
      const [y, m] = month.split("-").map(Number);
      const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
      const { reach } = folderTree(await readFolders(workspaceId), folder.id);
      const rows = await readAll<PhotoRow>("onedrive_index_read_failed:photos", () =>
        admin.from(PHOTOS).select("item_id,parent_id,name,taken_at,approx,taken_day").eq("workspace_id", workspaceId)
          .gte("taken_day", `${month}-01`).lt("taken_day", end).order("item_id"));
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

    // 하위 폴더 켜기·끄기. 맨 위 폴더는 끌 수 없다(끄려면 다른 맨 위 폴더를 고른다).
    async "folder-toggle"({ workspaceId, body }) {
      const conn = await readConnection(workspaceId);
      const folder = folderOf(conn);
      if (!validItemId(body.folder_id) || typeof body.enabled !== "boolean" || body.folder_id === folder.id) {
        throw new Fail(400, "onedrive_request_invalid");
      }
      const { data, error } = await admin.from(FOLDERS).update({ enabled: body.enabled, updated_at: new Date(now()).toISOString() })
        .eq("workspace_id", workspaceId).eq("item_id", body.folder_id).select("item_id");
      if (error) dbFail("onedrive_folder_toggle_failed", error);
      if (!Array.isArray(data) || data.length !== 1) throw new Fail(404, "onedrive_folder_missing");
      return json({ folder: { id: body.folder_id, enabled: body.enabled } });
    },

    async disconnect({ workspaceId }) {
      cached.delete(workspaceId);
      await clearIndexRows(workspaceId);
      const { error } = await admin.from(CONN).delete().eq("workspace_id", workspaceId);
      if (error) dbFail("onedrive_disconnect_failed", error);
      return json({ connected: false });
    },
  };

  // 사진이 맞고 고른 폴더 안에 있는지 확인한다(읽기·지우기가 함께 쓴다). 아니면 404(사진 아님·없음) 또는 403(폴더 밖).
  async function photoInFolder(token: string, id: string, folder: { path: string }) {
    const item = await getItem(token, id, "id,file,folder,parentReference");
    if (item.id !== id || item.folder || !item.file?.mimeType || !IMAGE_MIME.test(item.file.mimeType)) throw new Fail(404, "onedrive_item_missing");
    if (!insideFolder(item.parentReference?.path, folder.path)) throw new Fail(403, "onedrive_outside_folder");
  }

  // 사진 한 장 지우기 = 원드라이브 휴지통으로 보내기(Graph DELETE는 영구 삭제가 아니다). 고른 폴더 안의 사진만, confirm:true가 있을 때만.
  async function photoDelete(workspaceId: string, body: Record<string, unknown>): Promise<Response> {
    const conn = await readConnection(workspaceId);
    const folder = folderOf(conn);
    if (!validItemId(body.id) || body.confirm !== true) throw new Fail(400, "onedrive_request_invalid");
    if (!scopeAllowed(normalizeScopes(conn!.scope))) throw new Fail(424, "onedrive_reconnect_needed");
    const token = await accessToken(workspaceId, conn!);
    await photoInFolder(token, body.id, folder);
    const r = await call("onedrive_delete", `${GRAPH}/me/drive/items/${encodeURIComponent(body.id)}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    });
    if (r.status === 404) throw new Fail(404, "onedrive_item_missing");
    if (r.status === 401) throw new Fail(424, "onedrive_auth_expired");
    if (r.status === 403) throw new Fail(424, "onedrive_reconnect_needed");
    if (r.status !== 204 && !r.ok) throw new Fail(502, "onedrive_delete_failed");
    // 색인 행도 지운다. 실패해도 사진은 이미 휴지통이고 다음 변경 받기(delta)가 다시 지우므로 기록만 한다.
    const { error } = await admin.from(PHOTOS).delete().eq("workspace_id", workspaceId).in("item_id", [body.id]);
    if (error) log("onedrive_index_delete_failed:photo" + (/^[0-9A-Z]{5}$/.test(String(error.code)) ? ":" + error.code : ""));
    return json({ deleted: true });
  }

  // 사진이면서 고른 폴더 안인지(photoInFolder와 같은 판단, Graph 응답 본문만 보고). 맞으면 null, 아니면 실패 이름.
  const photoCheck = (id: string, item: OneDriveItem, folder: { path: string }): string | null => {
    if (!item || item.id !== id || item.folder || !item.file?.mimeType || !IMAGE_MIME.test(item.file.mimeType)) return "missing";
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
      if (typeof action !== "string" || !Object.hasOwn(actions, action)) throw new Fail(400, "action_invalid");
      return await actions[action]({ userId: data.user.id, workspaceId: member.workspace_id, body });
    } catch (e) {
      if (e instanceof Fail) return json({ ...(e.extra || {}), error: e.code }, e.status);
      log("onedrive_unexpected");
      return json({ error: "onedrive_unavailable" }, 500);
    }
  };
}
