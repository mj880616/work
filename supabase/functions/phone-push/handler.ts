// phone-push: 폰 알림 서버 함수(APP-폰알림 N3, 설계 docs/design/phone-notifications.md 4.2절, DB migration 20261101010000_phone_push).
//
// 입구 두 개(verify_jwt=false, 함수 코드가 막음 — outside-feed·collector-feed와 같은 방식):
// - 사용자 입구(`register`·`unregister`·`devices`·`test`): Authorization 사용자 로그인을 Auth 서버로 확인하고,
//   본인 app_workspace_members 행이 owner인 작업공간 하나만 쓴다(private.app_is_workspace_owner와 같은 기준). 화면이 보낸
//   사용자·작업공간 id는 받지 않는다.
// - 예약 입구(`run`, ?slot=quarter|morning|evening|friday): `x-phone-push-cron-secret` 헤더를 비밀값 PHONE_PUSH_CRON_SECRET(32자 이상)과
//   SHA-256 고정 길이 비교. 누구에게 보낼지는 서버가 정한다(요청 몸통은 빈 {}만). 종류 판단(할 일 기한·원장 약속·묶음·수집 멈춤)은 N5에서
//   더한다. 지금(N3)은 30일 지난 기록 정리와 받을 작업공간 수 세기만 한다.
// - 두 입구의 열쇠가 함께 오거나, 다른 기능의 비밀 헤더가 붙거나, 열쇠가 하나도 없으면 401.
// DB는 service role로 migration 20261101010000의 grant(app_push_devices·app_push_log select·insert·update·delete) 안에서만 쓰고,
//   그 밖에는 owner 확인용 app_workspace_members 읽기뿐이다. 기기 토큰은 응답·로그에 싣지 않는다(화면에는 끝 6자리만).
// 보내기는 _shared/fcm-send.ts(FCM HTTP v1, 비밀값 FCM_SERVICE_ACCOUNT_JSON). 비밀값이 없으면 시험 알림은 424로 멈춘다.
import { readBoundedJson } from "../_shared/bounded-json.mjs";
import { FCM_SECRET_NAME, makeFcmSender, readFcmConfig, type FcmSender } from "../_shared/fcm-send.ts";

type Env = (name: string) => string | undefined;
type Log = (code: string, detail?: Record<string, unknown>) => void;
export type PhonePushDeps = { env: Env; fetch?: typeof fetch; now?: () => number; log?: Log };

export const CRON_HEADER = "x-phone-push-cron-secret";
export const SECRET_NAME = "PHONE_PUSH_CRON_SECRET";
export const SECRET_MIN_CHARS = 32;
const FOREIGN_SECRET_HEADERS = ["x-drive-summary-cron-secret", "x-collector-feed-secret", "x-collector-heartbeat-secret", "x-outside-feed-cron-secret"];
export const SLOTS = ["quarter", "morning", "evening", "friday"] as const;
export const USER_ACTIONS = ["register", "unregister", "devices", "test"] as const;
export const MAX_DEVICES = 10;          // 작업공간마다 살아 있는 기기 수 상한
export const TEST_DAILY_PER_USER = 20;  // 시험 알림 하루 상한(인스턴스 메모리)
export const LOG_KEEP_DAYS = 30;
export const MAX_BODY_BYTES = 8192;
export const TOKEN = /^[A-Za-z0-9_:-]{20,4096}$/;
const VERSION = /^[0-9A-Za-z.+-]{1,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86400000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
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

// SHA-256으로 같은 길이로 만든 뒤 끝까지 비교(collector-feed·outside-feed secretMatches와 같음).
export async function secretMatches(given: string | null, expected: string | undefined) {
  if (!expected || expected.length < SECRET_MIN_CHARS || !given || given.length > 4096) return false;
  const digest = (v: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  const aa = new Uint8Array(a), bb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

const exactKeys = (o: Record<string, unknown>, required: string[], optional: string[] = []) => {
  const keys = Object.keys(o);
  return required.every((k) => keys.includes(k)) && keys.every((k) => required.includes(k) || optional.includes(k));
};
// 서울 날짜(YYYY-MM-DD).
export const kstDay = (ms: number) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);

// ---- DB(service role, PostgREST) ------------------------------------------------------------------------------------

type Db = {
  get: (path: string) => Promise<Record<string, unknown>[]>;
  send: (method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown, prefer?: string) => Promise<Record<string, unknown>[]>;
};
function makeDb(sb: string, key: string, doFetch: typeof fetch): Db {
  const headers = (prefer?: string) => ({
    apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}),
  });
  async function call(method: string, path: string, body?: unknown, prefer?: string) {
    let r: Response;
    try {
      r = await doFetch(`${sb}/rest/v1/${path}`, { method, headers: headers(prefer), body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    } catch {
      throw new Fail(503, "STORE_UNAVAILABLE");
    }
    if (!r.ok) {
      try { await r.body?.cancel(); } catch { /* ignore */ }
      throw new Fail(503, "STORE_UNAVAILABLE");
    }
    if (r.status === 204 || (prefer ?? "").includes("return=minimal") || r.headers.get("content-length") === "0") {
      try { await r.body?.cancel(); } catch { /* ignore */ }
      return [];
    }
    let v: unknown;
    try { v = await readBoundedJson(r, { maxBytes: 1024 * 1024 }); } catch { throw new Fail(503, "STORE_UNAVAILABLE"); }
    return Array.isArray(v) ? v as Record<string, unknown>[] : [];
  }
  return { get: (p) => call("GET", p), send: (m, p, b, pr) => call(m, p, b, pr) };
}

// ---- 사용자 입구(로그인 + owner) ------------------------------------------------------------------------------------

async function authorizeUser(sb: string, key: string, jwt: string, doFetch: typeof fetch, db: Db): Promise<{ userId: string; workspaceId: string }> {
  let r: Response;
  try { r = await doFetch(`${sb}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${jwt}` }, signal: AbortSignal.timeout(10000) }); }
  catch { throw new Fail(503, "AUTH_UNAVAILABLE"); }
  if (r.status >= 500) { try { await r.body?.cancel(); } catch { /* ignore */ } throw new Fail(503, "AUTH_UNAVAILABLE"); }
  let user: Record<string, unknown> | null = null;
  try { user = await readBoundedJson(r, { maxBytes: 256 * 1024 }) as Record<string, unknown>; } catch { user = null; }
  if (!r.ok || typeof user?.id !== "string" || !UUID.test(user.id)) throw new Fail(401, "UNAUTHORIZED");
  const members = await db.get(`app_workspace_members?user_id=eq.${user.id}&role=eq.owner&select=workspace_id`);
  if (members.length !== 1 || typeof members[0].workspace_id !== "string" || !UUID.test(members[0].workspace_id)) throw new Fail(403, "FORBIDDEN");
  return { userId: user.id, workspaceId: members[0].workspace_id };
}

const tail6 = (token: unknown) => typeof token === "string" ? token.slice(-6) : "";

async function activeDevices(db: Db, workspaceId: string) {
  return await db.get(`app_push_devices?workspace_id=eq.${workspaceId}&revoked_at=is.null&select=id,fcm_token,app_version,created_at,last_seen_at&order=last_seen_at.desc&limit=${MAX_DEVICES + 1}`);
}

async function register(db: Db, who: { userId: string; workspaceId: string }, b: Record<string, unknown>, nowIso: string) {
  if (!exactKeys(b, ["token"], ["app_version"]) || typeof b.token !== "string" || !TOKEN.test(b.token)) throw new Fail(400, "INVALID_BODY");
  if (b.app_version !== undefined && (typeof b.app_version !== "string" || !VERSION.test(b.app_version))) throw new Fail(400, "INVALID_BODY");
  const devices = await activeDevices(db, who.workspaceId);
  if (!devices.some((d) => d.fcm_token === b.token) && devices.length >= MAX_DEVICES) throw new Fail(409, "TOO_MANY_DEVICES");
  // 같은 폰 주소는 표에 한 줄(fcm_token 유일). 다른 계정에서 쓰던 폰이면 이 작업공간으로 옮긴다(그 폰에 지금 로그인한 사람의 것).
  const rows = await db.send("POST", "app_push_devices?on_conflict=fcm_token&select=id,last_seen_at", {
    workspace_id: who.workspaceId, user_id: who.userId, fcm_token: b.token, app_version: b.app_version ?? null, last_seen_at: nowIso, revoked_at: null,
  }, "resolution=merge-duplicates,return=representation");
  const id = rows[0]?.id;
  if (typeof id !== "string") throw new Fail(503, "STORE_UNAVAILABLE");
  return { ok: true, device: { id, tail: tail6(b.token) } };
}

async function unregister(db: Db, who: { workspaceId: string }, b: Record<string, unknown>) {
  let filter: string;
  if (exactKeys(b, ["device_id"]) && typeof b.device_id === "string" && UUID.test(b.device_id)) filter = `id=eq.${b.device_id}`;
  else if (exactKeys(b, ["token"]) && typeof b.token === "string" && TOKEN.test(b.token)) filter = `fcm_token=eq.${encodeURIComponent(b.token)}`;
  else throw new Fail(400, "INVALID_BODY");
  const rows = await db.send("DELETE", `app_push_devices?workspace_id=eq.${who.workspaceId}&${filter}&select=id`, undefined, "return=representation");
  return { ok: true, removed: rows.length };
}

async function listDevices(db: Db, who: { workspaceId: string }) {
  const devices = await activeDevices(db, who.workspaceId);
  return {
    ok: true,
    devices: devices.slice(0, MAX_DEVICES).map((d) => ({ id: d.id, tail: tail6(d.fcm_token), app_version: d.app_version ?? null, created_at: d.created_at, last_seen_at: d.last_seen_at })),
  };
}

async function logPush(db: Db, workspaceId: string, kind: string, refKey: string, day: string, status: string) {
  await db.send("POST", "app_push_log?on_conflict=workspace_id,kind,ref_key,day", { workspace_id: workspaceId, kind, ref_key: refKey, day, status },
    "resolution=merge-duplicates,return=minimal");
}

// 보내기 결과를 기기마다 반영: 등록 풀림은 revoked_at, 보냄은 last_seen_at 그대로(앱이 다시 등록할 때 갱신).
async function sendToDevices(db: Db, sender: FcmSender, devices: Record<string, unknown>[], msg: Parameters<FcmSender["send"]>[1], nowIso: string) {
  let sent = 0, failed = 0, revoked = 0;
  for (const d of devices) {
    if (typeof d.fcm_token !== "string" || typeof d.id !== "string") continue;
    const r = await sender.send(d.fcm_token, msg);
    if (r === "sent") sent++;
    else if (r === "unregistered") {
      revoked++;
      await db.send("PATCH", `app_push_devices?id=eq.${d.id}`, { revoked_at: nowIso }, "return=minimal");
    } else failed++;
  }
  return { sent, failed, revoked };
}

// ---- 예약 입구 ------------------------------------------------------------------------------------------------------

async function runSlot(db: Db, slot: string, nowMs: number) {
  // 30일 지난 기록 정리(설계 4.1). 기록에는 종류·열쇠·날짜·상태만 있다.
  const cutoff = new Date(nowMs - LOG_KEEP_DAYS * DAY_MS).toISOString();
  const pruned = await db.send("DELETE", `app_push_log?sent_at=lt.${encodeURIComponent(cutoff)}&select=day`, undefined, "return=representation");
  // 받을 작업공간: 살아 있는 기기가 있는 곳. 기기 주인이 지금도 그 작업공간 owner인지는 보낼 때(N5) 다시 본다.
  const rows = await db.get("app_push_devices?revoked_at=is.null&select=workspace_id&limit=1000");
  const workspaces = new Set(rows.map((r) => r.workspace_id).filter((v) => typeof v === "string")).size;
  // 종류 판단·보내기는 N5(설계 6절)에서 더한다. 지금은 보내지 않는다.
  return { ok: true, slot, workspaces, sent: 0, pruned: pruned.length };
}

// ---- 입구 ----------------------------------------------------------------------------------------------------------

export function createPhonePushHandler(deps: PhonePushDeps) {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const log: Log = deps.log ?? ((code, detail) => console.error(JSON.stringify({ fn: "phone-push", code, ...(detail ?? {}) })));
  const testUse = new Map<string, number>(); // `${day} ${user}` → 횟수
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      // 열쇠 확인이 맨 앞이다(몸통·action보다 먼저). 열쇠가 없거나 섞이면 401.
      const cronGiven = req.headers.get(CRON_HEADER);
      const auth = req.headers.get("authorization");
      if (FOREIGN_SECRET_HEADERS.some((h) => req.headers.get(h) !== null)) throw new Fail(401, "UNAUTHORIZED");
      if ((cronGiven === null) === (auth === null)) throw new Fail(401, "UNAUTHORIZED");
      if (req.method !== "POST") throw new Fail(405, "METHOD_NOT_ALLOWED");
      const cron = cronGiven !== null;
      if (cron) {
        if (!await secretMatches(cronGiven, deps.env(SECRET_NAME))) throw new Fail(401, "UNAUTHORIZED");
      } else if (!/^Bearer [A-Za-z0-9._-]{20,4096}$/.test(auth ?? "")) {
        throw new Fail(401, "UNAUTHORIZED");
      }
      const sb = deps.env("SUPABASE_URL") ?? "", key = deps.env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(sb) || !key) throw new Fail(500, "SERVER_CONFIG_MISSING");
      let action: string | null = null, slot: string | null = null;
      try { const u = new URL(req.url); action = u.searchParams.get("action"); slot = u.searchParams.get("slot"); } catch { /* ignore */ }
      if (cron ? action !== "run" : !(USER_ACTIONS as readonly string[]).includes(action ?? "")) throw new Fail(400, "UNKNOWN_ACTION");
      if (Number(req.headers.get("content-length") || 0) > MAX_BODY_BYTES) throw new Fail(413, "BODY_TOO_LARGE");
      let body: unknown = {};
      try { body = await readBoundedJson(req, { maxBytes: MAX_BODY_BYTES }); } catch { throw new Fail(400, "INVALID_BODY"); }
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Fail(400, "INVALID_BODY");
      const b = body as Record<string, unknown>;
      const db = makeDb(sb, key, doFetch);
      const nowMs = now(), nowIso = new Date(nowMs).toISOString();

      if (cron) {
        // 몸통은 빈 {}만. 받을 사람·작업공간은 서버가 정한다(요청 값 안 받음).
        if (!exactKeys(b, []) || !(SLOTS as readonly string[]).includes(slot ?? "")) throw new Fail(400, "INVALID_BODY");
        return json(await runSlot(db, slot!, nowMs));
      }

      const who = await authorizeUser(sb, key, auth!.slice("Bearer ".length), doFetch, db);
      if (action === "register") return json(await register(db, who, b, nowIso));
      if (action === "unregister") return json(await unregister(db, who, b));
      if (!exactKeys(b, [])) throw new Fail(400, "INVALID_BODY");
      if (action === "devices") return json(await listDevices(db, who));

      // test: 내 살아 있는 기기에 시험 알림 1개씩.
      const cfg = readFcmConfig(deps.env(FCM_SECRET_NAME));
      if (!cfg) throw new Fail(424, "PUSH_NOT_CONFIGURED");
      const day = kstDay(nowMs), use = `${day} ${who.userId}`;
      for (const k of testUse.keys()) if (!k.startsWith(day)) testUse.delete(k);
      const n = testUse.get(use) ?? 0;
      if (n >= TEST_DAILY_PER_USER) throw new Fail(429, "DAILY_LIMIT");
      testUse.set(use, n + 1);
      const devices = (await activeDevices(db, who.workspaceId)).slice(0, MAX_DEVICES);
      if (!devices.length) throw new Fail(409, "NO_DEVICE");
      const out = await sendToDevices(db, makeFcmSender(cfg, doFetch, now), devices,
        { kind: "test", title: "웹2 · 시험 알림", open: "/work/app/", urgent: true }, nowIso);
      await logPush(db, who.workspaceId, "test", `t${nowMs}`, day, out.sent ? "sent" : "failed");
      return json({ ok: true, ...out });
    } catch (e) {
      if (e instanceof Fail) {
        if (e.status >= 500) log("failed", { stage: e.code, status: e.status });
        return json({ ok: false, error: e.code }, e.status);
      }
      log("internal_error");
      return json({ ok: false, error: "INTERNAL_ERROR" }, 500);
    }
  };
}
