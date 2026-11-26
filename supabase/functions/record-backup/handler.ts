// record-backup: '내 기록 백업' 서버 입구(PRIVACY-백업안내, 시안 #2677 사용자 확정 11/15·11/16).
//
// 하는 일: 로그인한 사람의 기록을 그 사람 구글 드라이브 '노조+ 백업/날짜'(새 사용자는 'WORK ON+ 백업/날짜', S68-02) 폴더에 종류별 읽기용 문서 1개 + 표마다 csv 1개로 저장한다.
// 노조+ 서버에는 사본을 두지 않는다(만든 파일은 응답·로그·DB 어디에도 싣지 않음). 운영자는 기록 내용을 보지 않는다(AGENTS.md 3절).
//
// 누가(verify_jwt=true + 함수 코드에서 다시 확인, note-import와 같은 방식):
// - Authorization: Bearer <사용자 로그인>을 Auth 서버(/auth/v1/user)로 확인한다.
// - 그 사람이 owner인 작업공간이 정확히 하나일 때만 받는다(_shared/workspace-drive-token.ts callerOwnerWorkspace). 작업공간은 서버가 정한다.
// - 드라이브는 그 작업공간의 연결만 쓴다(workspaceDriveToken). 다른 작업공간 연결·id=1 열쇠는 읽지 않는다.
// 무엇을 읽나: 기록 표는 사용자 토큰 + anon 키로만 읽는다(기존 owner RLS 그대로, 서비스 역할로 기록을 읽지 않음). 표·조건은 model.mjs 목록뿐.
// 입구: GET  ?action=status → {connected, last_at, last_count, kinds:[{key,label,note,count}]} (개수만)
//       POST ?action=run   몸통 {kinds:[...]} → {date, count, folder_url, root_url, root_name}(status에는 folder_name: 맨 위 폴더 실제 이름)
// 같은 날 다시 하면 그날 폴더를 휴지통으로 보내고 새로 만든다. 최근 4주(날짜 폴더 4개)만 남기고 오래된 폴더는 드라이브 휴지통으로(영구 삭제 안 함).
// 로그·응답: 코드와 숫자만. 기록 내용·제목·파일 ID를 로그에 싣지 않는다.
import { isDelegatedToken } from "../_shared/delegated-token-guard.mjs";
import { FOLDER_NAMES, appNameFor, folderNameFor, keepOldFromMyFeatures } from "../_shared/brand-folders.mjs";
// S69-22: 백업 맨 위 폴더는 내 드라이브 맨 위 또는 맨 위 앱 폴더 바로 아래 어디에 있어도 같은 폴더(표식 kptu_backup=root).
import { createParentFor, isDriveId, renameIfOld, topParentsClause } from "../_shared/app-folders.mjs";
import { CATEGORIES, DOC_BYTES, KEEP_WEEKS, ROWS_PER_TABLE, cleanRow, foldersToTrash, kstDate, parseKinds, readableHtml, tableQuery, toCsv } from "./model.mjs";

export type Env = (name: string) => string | undefined;
export type BackupDeps = {
  env: Env;
  ownerWorkspace: (userId: string) => Promise<string | null>;
  driveToken: (workspaceId: string) => Promise<string>; // 연결 없음: Error code 'drive_not_connected' / 만료 'drive_auth_expired'
  // S69-22: 맨 위 앱 폴더 id(app_drive_settings.root_folder_id, 서버 키). 없거나 못 읽으면 null(→ 내 드라이브 맨 위만).
  appRootId?: (workspaceId: string) => Promise<string | null>;
  fetch?: typeof fetch;
  now?: () => number;
  log?: (code: string) => void;
};
type Row = Record<string, unknown>;
type Table = { name: string; label: string; by: string; alias?: string; parent?: string; fk?: string };
type Category = { key: string; label: string; note?: string; tables: Table[] };

const DRIVE = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const DOC_MIME = "application/vnd.google-apps.document";
const PAGE = 500;
const cors = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});
export class Fail extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export function createRecordBackupHandler(deps: BackupDeps) {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? ((code: string) => console.error(JSON.stringify({ fn: "record-backup", code })));
  const SB = deps.env("SUPABASE_URL") || "", ANON = deps.env("SUPABASE_ANON_KEY") || "";

  async function call(url: string, init: RequestInit, code: string, timeout = 30000): Promise<Response> {
    try { return await doFetch(url, { ...init, signal: AbortSignal.timeout(timeout) }); }
    catch { throw new Fail(502, code); }
  }
  async function okJson(res: Response, code: string): Promise<any> {
    if (!res.ok) throw new Fail(res.status === 401 || res.status === 403 ? 403 : 502, code);
    try { return await res.json(); } catch { throw new Fail(502, code); }
  }

  // ---- 누가 -------------------------------------------------------------------------------------------------
  async function who(req: Request): Promise<{ userId: string; workspaceId: string; auth: string }> {
    const auth = req.headers.get("Authorization") || "";
    if (!/^Bearer\s+\S+$/i.test(auth)) throw new Fail(401, "UNAUTHORIZED");
    if (!SB || !ANON) throw new Fail(500, "SERVER_CONFIG_MISSING");
    const res = await call(`${SB}/auth/v1/user`, { headers: { apikey: ANON, Authorization: auth } }, "AUTH_UNAVAILABLE");
    if (res.status >= 500) throw new Fail(502, "AUTH_UNAVAILABLE");
    if (!res.ok) throw new Fail(401, "UNAUTHORIZED");
    const user = await res.json().catch(() => null);
    const userId = typeof user?.id === "string" && UUID.test(user.id) ? user.id : null;
    if (!userId) throw new Fail(401, "UNAUTHORIZED");
    // MCP-Claude읽기 M-2: Auth가 받은 같은 열쇠가 OAuth 위임 열쇠(client_id)면 거절한다.
    if (isDelegatedToken(auth)) throw new Fail(401, "UNAUTHORIZED");
    const workspaceId = await deps.ownerWorkspace(userId).catch(() => null);
    if (!workspaceId || !UUID.test(workspaceId)) throw new Fail(403, "FORBIDDEN");
    return { userId, workspaceId, auth };
  }

  // ---- 기록 읽기(사용자 토큰, owner RLS) --------------------------------------------------------------------------
  const userHeaders = (auth: string, extra: Record<string, string> = {}) => ({ apikey: ANON, Authorization: auth, Accept: "application/json", ...extra });
  async function readTable(table: Table, who_: { userId: string; workspaceId: string; auth: string }): Promise<Row[] | null> {
    const rows: Row[] = [];
    for (let offset = 0; offset <= ROWS_PER_TABLE; offset += PAGE) {
      const res = await call(`${SB}/rest/v1/${tableQuery(table, who_, { limit: PAGE, offset })}`, { headers: userHeaders(who_.auth) }, "RECORD_READ_FAILED");
      if (res.status === 404) return null; // 아직 없는 표(적용 전 단계)는 건너뜀
      const page = await okJson(res, "RECORD_READ_FAILED");
      if (!Array.isArray(page)) throw new Fail(502, "RECORD_READ_FAILED");
      rows.push(...page.map((r: Row) => cleanRow(table, r) as Row));
      if (rows.length > ROWS_PER_TABLE) break;
      if (page.length < PAGE) return rows;
    }
    throw new Fail(413, "RECORD_READ_LIMIT"); // 잘린 백업은 만들지 않는다
  }
  async function countTable(table: Table, who_: { userId: string; workspaceId: string; auth: string }): Promise<number> {
    const res = await call(`${SB}/rest/v1/${tableQuery(table, who_, { limit: 1, count: true })}`, { method: "HEAD", headers: userHeaders(who_.auth, { Prefer: "count=exact" }) }, "RECORD_COUNT_FAILED");
    if (res.status === 404) return 0;
    if (!res.ok && res.status !== 206) throw new Fail(502, "RECORD_COUNT_FAILED");
    const total = Number((res.headers.get("Content-Range") || "").split("/")[1]);
    return Number.isFinite(total) && total >= 0 ? total : 0;
  }

  // ---- 드라이브(그 작업공간 연결) ------------------------------------------------------------------------------
  async function token(workspaceId: string): Promise<string | null> {
    try { return await deps.driveToken(workspaceId); }
    catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === "drive_not_connected") return null;
      if (code === "drive_auth_expired") throw new Fail(409, "DRIVE_AUTH_EXPIRED");
      throw new Fail(502, "DRIVE_TOKEN_FAILED");
    }
  }
  const auth = (t: string, extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${t}`, ...extra });
  async function list(t: string, query: string): Promise<Row[]> {
    const files: Row[] = []; let pageToken = "";
    do {
      const p = new URLSearchParams({ q: query, spaces: "drive", pageSize: "100", fields: "files(id,name,parents,appProperties),nextPageToken,incompleteSearch" });
      if (pageToken) p.set("pageToken", pageToken);
      const data = await okJson(await call(`${DRIVE}?${p}`, { headers: auth(t) }, "DRIVE_LIST_FAILED"), "DRIVE_LIST_FAILED");
      if (data.incompleteSearch || !Array.isArray(data.files)) throw new Fail(502, "DRIVE_LIST_FAILED");
      files.push(...data.files); pageToken = data.nextPageToken || "";
    } while (pageToken);
    return files;
  }
  const mine = (kind: string, parent: string) =>
    `trashed = false and 'me' in owners and mimeType = '${FOLDER_MIME}' and appProperties has { key='kptu_backup' and value='${kind}' } and '${q(parent)}' in parents`;
  const mineAtTop = (appRoot: string | null) =>
    `trashed = false and 'me' in owners and mimeType = '${FOLDER_MIME}' and appProperties has { key='kptu_backup' and value='root' } and ${topParentsClause(appRoot)}`;
  async function appRootOf(workspaceId: string): Promise<string | null> {
    if (!deps.appRootId) return null;
    try { const id = await deps.appRootId(workspaceId); return isDriveId(id) ? id : null; } catch { return null; }
  }
  // S68-02: 맨 위 폴더는 이름이 아니라 표식(kptu_backup=root)으로 찾으므로 이미 있는 폴더('노조+ 백업' 등)는 이름 그대로 계속 쓴다.
  // 없을 때만 만든다: 운영자 기능 nojo_words(사용자 화면, 로그인 토큰으로 부른 app_my_features 답)·확인 실패는 '노조+ 백업', 그 밖은 'WORK ON+ 백업'.
  // S68-21: 같은 답으로 새로 만드는 읽기용 문서 첫 줄의 앱 이름도 정한다(run에서 한 번 확인).
  async function keepOldNames(auth: string): Promise<boolean | null> {
    try {
      const res = await call(`${SB}/rest/v1/rpc/app_my_features`, { method: "POST", headers: userHeaders(auth, { "Content-Type": "application/json" }), body: "{}" }, "FEATURE_READ_FAILED");
      if (!res.ok) return null;
      return keepOldFromMyFeatures(await res.json().catch(() => null));
    } catch { return null; }
  }
  async function rootFolder(t: string, workspaceId: string, create: boolean, keepOld: boolean | null = null): Promise<Row | null> {
    const appRoot = await appRootOf(workspaceId);
    const found = await list(t, mineAtTop(appRoot));
    if (found.length > 1) throw new Fail(409, "DRIVE_DUPLICATE_FOLDERS");
    if (found[0] || !create) return found[0] || null;
    return await makeFolder(t, folderNameFor("record_backup", keepOld), createParentFor(appRoot), { kptu_backup: "root" });
  }
  async function makeFolder(t: string, name: string, parent: string, props: Record<string, string>): Promise<Row> {
    const body = JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent], appProperties: props });
    const f = await okJson(await call(`${DRIVE}?fields=id,name,appProperties`, { method: "POST", headers: auth(t, { "Content-Type": "application/json" }), body }, "DRIVE_FOLDER_CREATE_FAILED"), "DRIVE_FOLDER_CREATE_FAILED");
    if (!f?.id) throw new Fail(502, "DRIVE_FOLDER_CREATE_FAILED");
    return f;
  }
  async function trash(t: string, id: string): Promise<boolean> {
    const res = await call(`${DRIVE}/${encodeURIComponent(id)}?fields=id`, { method: "PATCH", headers: auth(t, { "Content-Type": "application/json" }), body: JSON.stringify({ trashed: true }) }, "DRIVE_TRASH_FAILED").catch(() => null);
    return !!res?.ok;
  }
  // 모두에게·도메인 공유가 걸린 폴더에는 쓰지 않는다(drive-summary assertPrivate와 같은 규칙).
  async function assertPrivate(t: string, id: string) {
    let pageToken = "";
    do {
      const p = new URLSearchParams({ fields: "permissions(type),nextPageToken", pageSize: "100" });
      if (pageToken) p.set("pageToken", pageToken);
      const data = await okJson(await call(`${DRIVE}/${encodeURIComponent(id)}/permissions?${p}`, { headers: auth(t) }, "DRIVE_PERMISSION_CHECK_FAILED"), "DRIVE_PERMISSION_CHECK_FAILED");
      if (!Array.isArray(data.permissions)) throw new Fail(502, "DRIVE_PERMISSION_CHECK_FAILED");
      if (data.permissions.some((x: Row) => x.type === "anyone" || x.type === "domain")) throw new Fail(409, "DRIVE_PUBLIC_SHARING_FOUND");
      pageToken = data.nextPageToken || "";
    } while (pageToken);
  }
  async function upload(t: string, parent: string, name: string, mime: string, contentType: string, text: string) {
    const boundary = `backup_${crypto.randomUUID()}`;
    const meta = { name, mimeType: mime, parents: [parent], appProperties: { kptu_backup: "file" } };
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${contentType}; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--\r\n`;
    const f = await okJson(await call(`${UPLOAD}?uploadType=multipart&fields=id`, { method: "POST", headers: auth(t, { "Content-Type": `multipart/related; boundary=${boundary}` }), body }, "DRIVE_UPLOAD_FAILED", 60000), "DRIVE_UPLOAD_FAILED");
    if (!f?.id) throw new Fail(502, "DRIVE_UPLOAD_FAILED");
  }
  async function setStatus(t: string, id: string, props: Record<string, string>) {
    await okJson(await call(`${DRIVE}/${encodeURIComponent(id)}?fields=id`, { method: "PATCH", headers: auth(t, { "Content-Type": "application/json" }), body: JSON.stringify({ appProperties: props }) }, "DRIVE_STATUS_WRITE_FAILED"), "DRIVE_STATUS_WRITE_FAILED");
  }
  const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`;

  // ---- 입구 ------------------------------------------------------------------------------------------------
  async function status(req: Request) {
    const w = await who(req);
    const t = await token(w.workspaceId);
    const kinds = [];
    for (const c of CATEGORIES as Category[]) {
      let count = 0;
      for (const table of c.tables) count += await countTable(table, w);
      kinds.push({ key: c.key, label: c.label, note: c.note || null, count });
    }
    let last_at = null, last_count = null, folder_url = null, folder_name = null;
    if (t) {
      const root = await rootFolder(t, w.workspaceId, false);
      const props = (root?.appProperties || {}) as Record<string, string>;
      if (root) folder_url = folderUrl(String(root.id));
      if (root && typeof root.name === "string") folder_name = root.name;
      if (typeof props.kptu_backup_last_at === "string" && !Number.isNaN(Date.parse(props.kptu_backup_last_at))) last_at = props.kptu_backup_last_at;
      if (/^\d{1,9}$/.test(props.kptu_backup_last_count || "")) last_count = Number(props.kptu_backup_last_count);
    }
    return json({ ok: true, connected: !!t, last_at, last_count, folder_url, folder_name, keep_weeks: KEEP_WEEKS, kinds });
  }

  async function run(req: Request) {
    const w = await who(req);
    const raw = await req.text().catch(() => "");
    if (raw.length > 2000) throw new Fail(413, "BODY_TOO_LARGE");
    let body: unknown = null;
    try { body = JSON.parse(raw || "null"); } catch { body = null; }
    const kinds = parseKinds(body);
    if (!kinds) throw new Fail(400, "BAD_KINDS");
    const t = await token(w.workspaceId);
    if (!t) throw new Fail(409, "DRIVE_NOT_CONNECTED");
    // 먼저 전부 읽는다: 읽기가 실패하면 드라이브에 반쪽 백업을 만들지 않는다.
    const picked = (CATEGORIES as Category[]).filter(c => kinds.includes(c.key));
    const read: { category: Category; tables: { table: Table; rows: Row[] }[] }[] = [];
    let count = 0;
    for (const category of picked) {
      const tables = [];
      for (const table of category.tables) {
        const rows = await readTable(table, w);
        if (rows === null) continue;
        tables.push({ table, rows }); count += rows.length;
      }
      read.push({ category, tables });
    }
    const at = now(), date = kstDate(at);
    // S68-21: 이번 실행에서 한 번만 확인한다 — 새로 만드는 맨 위 폴더 이름과 새로 만드는 읽기용 문서 첫 줄의 앱 이름이 같은 답을 쓴다.
    const keepOld = await keepOldNames(w.auth), appName = appNameFor(keepOld);
    const root = await rootFolder(t, w.workspaceId, true, keepOld) as Row;
    await assertPrivate(t, String(root.id));
    // S69-42: 맨 위 백업 폴더가 옛 이름('노조+ 백업')이면 쓸 때 새 이름으로(같은 자리에 새 이름 폴더가 있으면 그대로). 이름만 — id·안 파일은 그대로, 실패해도 백업은 한다.
    const renamed = await renameIfOld({
      drive: (url: string, init: RequestInit = {}) => doFetch(url, { ...init, headers: auth(t, (init.headers || {}) as Record<string, string>), signal: AbortSignal.timeout(15000) }),
      kind: "record_backup", file: { id: String(root.id), name: root.name, parents: root.parents },
    });
    if (renamed === "renamed") root.name = FOLDER_NAMES.record_backup.now;
    for (const old of await list(t, mine("day", String(root.id)))) {
      if ((old.appProperties as Record<string, string>)?.kptu_backup_date === date) await trash(t, String(old.id));
    }
    const day = await makeFolder(t, date, String(root.id), { kptu_backup: "day", kptu_backup_date: date });
    let docSkipped = 0;
    for (const { category, tables } of read) {
      for (const { table, rows } of tables) await upload(t, String(day.id), `${category.label} - ${table.label}.csv`, "text/csv", "text/csv", toCsv(rows));
      const doc = readableHtml(category, tables, date, appName);
      if (new TextEncoder().encode(doc).length > DOC_BYTES) { docSkipped++; continue; }
      await upload(t, String(day.id), `${category.label} (읽기용)`, DOC_MIME, "text/html", doc);
    }
    let trimFailed = 0;
    for (const old of foldersToTrash(await list(t, mine("day", String(root.id))))) if (!await trash(t, String(old.id))) trimFailed++;
    await setStatus(t, String(root.id), { kptu_backup_last_at: new Date(at).toISOString(), kptu_backup_last_count: String(count) });
    return json({ ok: true, date, count, folder_url: folderUrl(String(day.id)), root_url: folderUrl(String(root.id)), root_name: typeof root.name === "string" ? root.name : null, doc_skipped: docSkipped, trim_failed: trimFailed });
  }

  return async function handle(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    const action = new URL(req.url).searchParams.get("action") || "";
    try {
      // 상태는 읽기만(GET), 백업은 POST. 다른 짝은 405.
      if (action === "status") { if (req.method !== "GET") throw new Fail(405, "METHOD_NOT_ALLOWED"); return await status(req); }
      if (action === "run") { if (req.method !== "POST") throw new Fail(405, "METHOD_NOT_ALLOWED"); return await run(req); }
      throw new Fail(400, "UNKNOWN_ACTION");
    } catch (e) {
      const f = e instanceof Fail ? e : new Fail(500, "INTERNAL_ERROR");
      log(f.code);
      return json({ ok: false, error: f.code }, f.status);
    }
  };
}
