import {
  folderPathOf, GRAPH, graphNextLink, IMAGE_MIME, insideFolder, MAX_FOLDER_DEPTH, MAX_IMAGE_BYTES, MAX_ITEMS,
  MAX_REQUESTS, normalizeScopes, safeDownloadUrl, SCOPE, scopeAllowed, seoulDay, SIZES, takenOf, validItemId,
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
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

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
      log("onedrive_token_rejected");
      if (d.error === "invalid_grant" || r.status === 400 || r.status === 401) throw new Fail(424, "onedrive_auth_expired");
      throw new Fail(503, "onedrive_unavailable");
    }
    return d as { access_token: string; refresh_token?: string; scope?: string; expires_in?: number };
  }

  async function readConnection(workspaceId: string) {
    const { data, error } = await admin.from("app_onedrive_connections")
      .select("refresh_token,scope,folder_id,folder_name,folder_path,connected_at").eq("workspace_id", workspaceId).maybeSingle();
    if (error) throw new Fail(503, "onedrive_unavailable");
    return data as null | { refresh_token: string; scope?: string | null; folder_id: string | null; folder_name: string | null; folder_path: string | null; connected_at: string };
  }

  // 갱신 토큰으로 접근 토큰을 받는다. 새 갱신 토큰이 오면 바로 바꿔 저장한다(Microsoft는 갱신 때마다 새 토큰을 줄 수 있다).
  // 접근 토큰은 만료 1분 전까지 이 함수 안에서만 기억한다(사진 여러 장을 연달아 받을 때 갱신 요청을 줄임).
  const cached = new Map<string, { token: string; refresh: string; until: number }>();
  async function accessToken(workspaceId: string, conn: { refresh_token: string }) {
    const c = needConfig();
    const hit = cached.get(workspaceId);
    if (hit && hit.refresh === conn.refresh_token && hit.until > now()) return hit.token;
    cached.delete(workspaceId);
    const d = await tokenRequest(c, { grant_type: "refresh_token", refresh_token: conn.refresh_token });
    if (typeof d.refresh_token === "string" && d.refresh_token && d.refresh_token !== conn.refresh_token) {
      const { error } = await admin.from("app_onedrive_connections")
        .update({ refresh_token: d.refresh_token, updated_at: new Date(now()).toISOString() }).eq("workspace_id", workspaceId);
      if (error) {
        log("onedrive_token_save_failed");
        throw new Fail(503, "onedrive_unavailable");
      }
    }
    const expires = Number(d.expires_in);
    if (Number.isFinite(expires) && expires > 120) {
      cached.set(workspaceId, { token: d.access_token, refresh: (typeof d.refresh_token === "string" && d.refresh_token) || conn.refresh_token, until: now() + (expires - 60) * 1000 });
    }
    return d.access_token;
  }

  const graph = (stage: string, token: string, path: string) =>
    call(stage, path.startsWith("https://") ? path : GRAPH + path, { headers: { Authorization: `Bearer ${token}` } });

  async function listChildren(token: string, parentId: string | null, select: string, budget: { left: number }) {
    const out: OneDriveItem[] = [];
    let url: string | null = (parentId ? `/me/drive/items/${encodeURIComponent(parentId)}/children` : "/me/drive/root/children") +
      `?$select=${select}&$top=200`;
    while (url) {
      if (budget.left-- <= 0) throw new Fail(413, "onedrive_too_many_requests");
      const r = await graph("onedrive_list", token, url);
      if (r.status === 404) throw new Fail(404, "onedrive_folder_missing");
      if (r.status === 401 || r.status === 403) throw new Fail(424, "onedrive_auth_expired");
      if (!r.ok) throw new Fail(502, "onedrive_unavailable");
      const d = await bodyJson(r);
      if (Array.isArray(d.value)) out.push(...(d.value as OneDriveItem[]));
      url = graphNextLink(d["@odata.nextLink"]);
      if (out.length > MAX_ITEMS) throw new Fail(413, "onedrive_too_many_items");
    }
    return out;
  }

  async function getItem(token: string, id: string, select: string) {
    const r = await graph("onedrive_item", token, `/me/drive/items/${encodeURIComponent(id)}?$select=${select}`);
    if (r.status === 404) throw new Fail(404, "onedrive_item_missing");
    if (r.status === 401 || r.status === 403) throw new Fail(424, "onedrive_auth_expired");
    if (!r.ok) throw new Fail(502, "onedrive_unavailable");
    return (await bodyJson(r)) as OneDriveItem;
  }

  const folderOf = (conn: Awaited<ReturnType<typeof readConnection>>) => {
    if (!conn) throw new Fail(424, "onedrive_not_connected");
    if (!conn.folder_id || !conn.folder_path) throw new Fail(424, "onedrive_folder_not_set");
    return { id: conn.folder_id, path: conn.folder_path };
  };

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
      if (!scopeAllowed(granted)) throw new Fail(400, "onedrive_scope_invalid");
      if (typeof d.refresh_token !== "string" || !d.refresh_token || d.refresh_token.length > 4096) throw new Fail(502, "onedrive_unavailable");
      cached.delete(workspaceId);
      const stamp = new Date(now()).toISOString();
      // 다시 연결하면 다른 계정일 수 있으므로 폴더 지정은 비운다.
      const { error } = await admin.from("app_onedrive_connections").upsert({
        workspace_id: workspaceId, refresh_token: d.refresh_token, folder_id: null, folder_name: null, folder_path: null,
        scope: granted.join(" "), connected_at: stamp, updated_at: stamp,
      }, { onConflict: "workspace_id" });
      if (error) {
        log("onedrive_connection_save_failed");
        throw new Fail(503, "onedrive_unavailable");
      }
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
      const { error } = await admin.from("app_onedrive_connections")
        .update({ folder_id: item.id, folder_name: item.name, folder_path: path, updated_at: new Date(now()).toISOString() })
        .eq("workspace_id", workspaceId);
      if (error) throw new Fail(503, "onedrive_unavailable");
      return json({ folder: { name: item.name } });
    },

    async photos({ workspaceId, body }) {
      const conn = await readConnection(workspaceId);
      const folder = folderOf(conn);
      const month = body.month;
      if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Fail(400, "onedrive_request_invalid");
      const token = await accessToken(workspaceId, conn!);
      const budget = { left: MAX_REQUESTS };
      const days: Record<string, { id: string; name: string; taken_at: string; approx: boolean }[]> = {};
      let truncated = false, seen = 0;
      const queue: { id: string; depth: number }[] = [{ id: folder.id, depth: 0 }];
      while (queue.length) {
        const cur = queue.shift()!;
        let items: OneDriveItem[];
        try {
          items = await listChildren(token, cur.id, "id,name,file,folder,photo,fileSystemInfo", budget);
        } catch (e) {
          if (e instanceof Fail && e.status === 413) {
            truncated = true;
            break;
          }
          throw e;
        }
        for (const item of items) {
          if (!validItemId(item.id)) continue;
          if (item.folder) {
            if (cur.depth + 1 <= MAX_FOLDER_DEPTH) queue.push({ id: item.id, depth: cur.depth + 1 });
            else truncated = true;
            continue;
          }
          if (++seen > MAX_ITEMS) {
            truncated = true;
            break;
          }
          if (!item.file?.mimeType || !IMAGE_MIME.test(item.file.mimeType)) continue;
          const taken = takenOf(item);
          const day = taken && seoulDay(taken.at);
          if (!taken || !day || !day.startsWith(month + "-")) continue;
          (days[day] ||= []).push({ id: item.id, name: String(item.name || ""), taken_at: taken.at, approx: taken.approx });
        }
      }
      for (const list of Object.values(days)) list.sort((a, b) => a.taken_at.localeCompare(b.taken_at) || a.id.localeCompare(b.id));
      return json({ month, days, truncated });
    },

    async disconnect({ workspaceId }) {
      cached.delete(workspaceId);
      const { error } = await admin.from("app_onedrive_connections").delete().eq("workspace_id", workspaceId);
      if (error) throw new Fail(503, "onedrive_unavailable");
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
    return json({ deleted: true });
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
      if (memberError) throw new Fail(503, "authorize_unavailable");
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
      if (action === "photo-delete") return await photoDelete(member.workspace_id, body);
      if (typeof action !== "string" || !Object.hasOwn(actions, action)) throw new Fail(400, "action_invalid");
      return await actions[action]({ userId: data.user.id, workspaceId: member.workspace_id, body });
    } catch (e) {
      if (e instanceof Fail) return json({ error: e.code }, e.status);
      log("onedrive_unexpected");
      return json({ error: "onedrive_unavailable" }, 500);
    }
  };
}
