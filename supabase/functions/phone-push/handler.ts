// phone-push: 폰 알림 서버 함수(APP-폰알림 N3, 설계 docs/design/phone-notifications.md 4.2절, DB migration 20261101010000_phone_push).
//
// 입구 두 개(verify_jwt=false, 함수 코드가 막음 — outside-feed·collector-feed와 같은 방식):
// - 사용자 입구(`register`·`unregister`·`devices`·`test`): Authorization 사용자 로그인을 Auth 서버로 확인하고,
//   본인 app_workspace_members 행이 owner인 작업공간 하나만 쓴다(private.app_is_workspace_owner와 같은 기준). 화면이 보낸
//   사용자·작업공간 id는 받지 않는다.
// - 예약 입구(`run`, ?slot=quarter|morning|evening): `x-phone-push-cron-secret` 헤더를 비밀값 PHONE_PUSH_CRON_SECRET(32자 이상)과
//   SHA-256 고정 길이 비교. 누구에게 보낼지는 서버가 정한다(요청 몸통은 빈 {}만). 종류 판단(할 일 기한·묶음·수집 멈춤)은 N5에서
//   더한다. 지금(N3)은 30일 지난 기록 정리와 받을 작업공간 수 세기만 한다.
// - 두 입구의 열쇠가 함께 오거나, 다른 기능의 비밀 헤더가 붙거나, 열쇠가 하나도 없으면 401.
// DB는 service role로 migration 20261101010000의 grant(app_push_devices·app_push_log select·insert·update·delete) 안에서만 쓰고,
//   그 밖에는 owner 확인용 app_workspace_members 읽기뿐이다. 기기 토큰은 응답·로그에 싣지 않는다(화면에는 끝 6자리만).
// 보내기는 _shared/fcm-send.ts(FCM HTTP v1, 비밀값 FCM_SERVICE_ACCOUNT_JSON). 비밀값이 없으면 시험 알림은 424로 멈춘다.
// UI-앱안알림 4·5단계(S47-40, migration 20261101210000_push_log_notices): 사용자 입구에 셋을 더한다.
// - `notices`: 뒤에서 끝난 일(done-items.ts 공용 목록) 중 아직 열지 않은 것 → 맨 위 알림 줄. 처음 뜬 것은 app_push_log에 shown_at을 남긴다.
// - `opened` {kind, ref_key}: 폰 알림·알림 줄을 눌러 연 것 → 같은 종류·열쇠 기록에 opened_at(한 번 열면 끝).
// - `recent`: 최근 알림 7일(폰으로 보낸 것·알림 줄에 뜬 것) — 내 프로필 '폰 알림' 아래 목록. 종류·열쇠·시각·여는 주소만.
// 저녁 'Now' 한 줄(now-line.ts, OUTSIDE-글상세·관심환류): 사회운동 글·뉴스 기사·본 시각 표를 service_role select로 건수만 센다.
// 재료 표 중 service_role 권한이 없는 것(회의 녹음 전사 작업)은 그 사용자 로그인 그대로(owner RLS) 읽는다(SUPABASE_ANON_KEY).
// S62-27(JOURNAL-다음주준비삭제·PUSH-원장약속알림빼기): 다음 주 준비(next_week)·원장 약속(commitment) 종류와 금요일 예약(slot=friday)을 지웠다.
// FAMILY-잊지말기 4단계(설계 docs/design/tg-personal.md 5.2절, migration 20261105120000_family_push_kind): 15분 예약(quarter)마다
//   잊지 말기 새 제안(app_family_notes status 'new', service_role 칸 읽기 id·workspace_id·status·created_at만)이 새로 생긴 작업공간에 한 번,
//   제목 "잊지 말기 n건"만 보낸다(본문·내용 없음 — 잠금 화면에 대화 내용이 뜨지 않게). 줄은 운영자 기능 family 작업공간에만 있다(DB 트리거).
//   종류별 끄기(notify_prefs.kinds.family=false → skipped_off)·조용한 시간(기본 22:00~07:00 → held_quiet, 끝난 뒤 첫 실행에서 보냄)을 지킨다.
//   기록 열쇠는 가장 새 제안의 시각(fam:<초>) — 새 제안이 생길 때마다 한 번. 기록에는 종류·열쇠·상태만(제목·본문 없음).
// FAMILY-기억알림 ②(family-remind.ts): 같은 15분 예약이 서울 월요일 08시 이후 그날 첫 실행에서 '가족 · 이번 주 기억할 것 n'을 주 1회
//   (열쇠 rem:<월요일>, 같은 끄기·조용한 시간). 이 알림만 본문(줄 앞부분)을 싣는다(명진 결정 11/12 "보이기"). 노트 읽기·쓰기는 family-remind.ts의 경로(가족 노트 하나)만 쓴다.
// OPS-새가입알림 ②(S62-25, migration 20261115234500_signup_notify): 새로 가입(작업공간 생성)하면 운영자에게만 알린다.
//   - 받는 사람: 운영자 기능 dev_inbox 작업공간 하나(rpc app_operator_feature_workspace, service_role — 서버 허용 표). 화면 값은 받지 않는다.
//   - 15분 예약(quarter): 지난 알림 열쇠(su:<가장 새 가입 초>, 보냄·실패·끔·연 것) 뒤 새 가입을 rpc app_signup_since(service_role 전용 —
//     수·가장 새 가입 초만)로 세어 "새 가입 n명" 한 번. 여럿이면 한 번에 묶는다. 같은 열쇠는 다시 보내지 않는다.
//     S68-58(명진 11/23 15:53, migration 20261123170000_operator_info_three): 운영자에게 가는 정보는 이메일·가입일·마지막 사용 시각뿐 —
//     알림 글에 이름·조직을 싣지 않는다(서버도 이름을 돌려주지 않음). 누가인지는 눌러서 '가입자 현황'(이메일)으로 본다.
//     끄기(kinds.signup=false → skipped_off)·조용한 시간(기본 22~07시 → 기록 없이 넘겼다가 끝난 뒤 첫 실행에서 그동안 가입을 묶어 보냄).
//     기록에는 종류·열쇠·상태만(이름 없음). 메일·작업공간 id·기록 내용은 읽지 않는다.
//   - 알림 줄(notices): 운영자에게만, 아직 열지 않은 새 가입(마지막으로 연 열쇠 뒤, 최근 7일)을 사용자 로그인으로 rpc app_signup_list
//     (운영자만 — 서버가 다시 확인)에서 가입 시각만 읽어 '새 가입 n명' 한 줄. 이 종류만 보일 말(text)을 함께 준다.
// S69-97 노트 알림 ②(note-alarm.ts, migration 20261125130000_note_alarm_push_kind): 같은 15분 예약이 노트에 건 알림 시각(metadata.alarm.at)이
//   지난 36시간 안에 지난 노트마다 '노트 다시 보기' 하나(본문 없음, 누르면 그 노트). service_role 읽기는 id·workspace_id·alarm 칸만(제목·글 없음).
//   열쇠 note:<노트 id>:<시각>으로 한 번만. 끄기(kinds.note=false → skipped_off)만 보고 조용한 시간은 보지 않는다(사람이 고른 시각). 노트에는 쓰지 않는다.
// OUTSIDE-바깥성명 ⑥(S70-55 I-11, 명진 결정 11/25 "저녁 알림만"): 저녁 예약(slot=evening, 18:22 서울)에서 Now 한 줄('새 성명 n · 새 기사 n',
//   now-line.ts)을 폰 알림 하나로 보낸다(종류 evening — DB 검사·설정 키·폰 앱 종류 목록에 이미 있음, 새 종류·새 저장소 없음).
//   - 받는 곳: 운영자 기능 'outside' 작업공간 하나(rpc app_operator_feature_workspace, _shared/news-access.ts와 같은 판정). 화면 값은 받지 않는다.
//   - 하루 한 번: 기록 열쇠 now:<서울 날짜>. 그날 같은 열쇠 기록이 있으면(보냄·실패·끔·조용한 시간) 다시 보내지 않는다.
//   - 끈 사람(kinds.evening=false) → skipped_off. 조용한 시간에 걸리면 held_quiet로 적고 그날은 보내지 않는다(저녁 예약은 하루 한 번이고,
//     다음 날 줄이 마지막으로 본 시각부터 다시 세므로 빠지는 수가 없다).
//   - 줄이 없으면(둘 다 0) 보내지도 적지도 않는다. 알림 글은 개수만 — 기사 제목·내용은 읽지도 싣지도 않는다(now-line.ts는 id만 읽음).
import { isDelegatedToken } from "../_shared/delegated-token-guard.mjs";
import { readBoundedJson } from "../_shared/bounded-json.mjs";
import { FCM_SECRET_NAME, makeFcmSender, readFcmConfig, type FcmSender } from "../_shared/fcm-send.ts";
import { nowEveningCounts, nowEveningLine } from "./now-line.ts";
import { NEWS_FEATURE, newsWorkspaceOf } from "../_shared/news-access.ts";
import { remindNotePath, remindPatchPath, REMIND_OPEN, remindRef, remindWeek, weekPicks, withRemind } from "./family-remind.ts";
import { dueByWorkspace, NOTE_KIND, NOTE_PER_WORKSPACE, NOTE_TITLE, noteAlarmPath, noteDecision, noteOpen } from "./note-alarm.ts";
import { doneItems, NOTICE_LOG_KINDS, openPath, RECENT_DAYS, RECENT_LIMIT, recentRows, recentSince, REF_KEY, type DoneItem } from "./done-items.ts";

type Env = (name: string) => string | undefined;
type Log = (code: string, detail?: Record<string, unknown>) => void;
export type PhonePushDeps = { env: Env; fetch?: typeof fetch; now?: () => number; log?: Log };

export const CRON_HEADER = "x-phone-push-cron-secret";
export const SECRET_NAME = "PHONE_PUSH_CRON_SECRET";
export const SECRET_MIN_CHARS = 32;
const FOREIGN_SECRET_HEADERS = ["x-drive-summary-cron-secret", "x-collector-feed-secret", "x-collector-heartbeat-secret", "x-outside-feed-cron-secret"];
export const SLOTS = ["quarter", "morning", "evening"] as const;
export const USER_ACTIONS = ["register", "unregister", "devices", "test", "notices", "opened", "recent"] as const;
export const MAX_DEVICES = 10;          // 작업공간마다 살아 있는 기기 수 상한
export const TEST_DAILY_PER_USER = 20;  // 시험 알림 하루 상한(인스턴스 메모리)
export const LOG_KEEP_DAYS = 30;
export const MAX_BODY_BYTES = 8192;
export const TOKEN = /^[A-Za-z0-9_:-]{20,4096}$/;
const VERSION = /^[0-9A-Za-z.+-]{1,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86400000;

const cors = {
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
  rpc: (fn: string, body: unknown) => Promise<unknown>;
};
function makeDb(sb: string, key: string, doFetch: typeof fetch): Db {
  const headers = (prefer?: string) => ({
    apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}),
  });
  async function call(method: string, path: string, body?: unknown, prefer?: string, raw = false) {
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
    if (raw) return v as unknown as Record<string, unknown>[];
    return Array.isArray(v) ? v as Record<string, unknown>[] : [];
  }
  return {
    get: (p) => call("GET", p), send: (m, p, b, pr) => call(m, p, b, pr),
    rpc: (fn, b) => call("POST", `rpc/${fn}`, b, undefined, true) as Promise<unknown>,
  };
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
  if (isDelegatedToken(jwt)) throw new Fail(401, "UNAUTHORIZED");
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

// ---- 알림 줄·최근 알림(UI-앱안알림 4·5) ---------------------------------------------------------------------------

// 사용자 로그인 그대로 읽기(owner RLS). anon 열쇠가 없으면 읽지 않는다(그 재료만 건너뜀).
function makeUserRead(sb: string, anonKey: string | undefined, jwt: string, doFetch: typeof fetch) {
  return async (path: string) => {
    if (!anonKey) throw new Fail(503, "STORE_UNAVAILABLE");
    let r: Response;
    try {
      r = await doFetch(`${sb}/rest/v1/${path}`, { headers: { apikey: anonKey, Authorization: `Bearer ${jwt}`, Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    } catch { throw new Fail(503, "STORE_UNAVAILABLE"); }
    if (!r.ok) { try { await r.body?.cancel(); } catch { /* ignore */ } throw new Fail(503, "STORE_UNAVAILABLE"); }
    let v: unknown;
    try { v = await readBoundedJson(r, { maxBytes: 256 * 1024 }); } catch { throw new Fail(503, "STORE_UNAVAILABLE"); }
    if (!Array.isArray(v)) throw new Fail(503, "STORE_UNAVAILABLE");
    return v as Record<string, unknown>[];
  };
}
const inList = (values: string[]) => `in.(${values.map((v) => `"${v}"`).join(",")})`;

async function notices(db: Db, items: DoneItem[], workspaceId: string, nowIso: string) {
  if (!items.length) return { ok: true, items: [] };
  const kinds = [...new Set(items.map((i) => i.kind))], refs = [...new Set(items.map((i) => i.ref_key))];
  const rows = await db.get(`app_push_log?workspace_id=eq.${workspaceId}&kind=${inList(kinds)}&ref_key=${inList(refs)}&select=kind,ref_key,day,shown_at,opened_at&limit=200`);
  const same = (r: Record<string, unknown>, i: DoneItem) => r.kind === i.kind && r.ref_key === i.ref_key;
  const open = items.filter((i) => !rows.some((r) => same(r, i) && r.opened_at));
  for (const i of open) {
    const row = rows.find((r) => same(r, i) && r.day === i.day);
    if (!row) {
      // 폰 알림이 아직 없으면 '알림 줄에만 뜸' 한 줄. 같은 때 다른 기기가 넣었으면 그대로 둔다.
      await db.send("POST", "app_push_log?on_conflict=workspace_id,kind,ref_key,day",
        { workspace_id: workspaceId, kind: i.kind, ref_key: i.ref_key, day: i.day, status: "shown", shown_at: nowIso }, "resolution=ignore-duplicates,return=minimal");
    } else if (!row.shown_at) {
      // 폰으로 이미 보낸 같은 기록이면 그 줄에 '알림 줄에도 뜸'만 더한다.
      await db.send("PATCH", `app_push_log?workspace_id=eq.${workspaceId}&kind=eq.${i.kind}&ref_key=eq.${encodeURIComponent(i.ref_key)}&day=eq.${i.day}&shown_at=is.null`,
        { shown_at: nowIso }, "return=minimal");
    }
  }
  return { ok: true, items: open.map((i) => ({ kind: i.kind, ref_key: i.ref_key, open: i.open, ...(i.text ? { text: i.text } : {}) })) };
}

async function opened(db: Db, workspaceId: string, b: Record<string, unknown>, nowIso: string) {
  if (!exactKeys(b, ["kind", "ref_key"]) || typeof b.kind !== "string" || !(NOTICE_LOG_KINDS as readonly string[]).includes(b.kind)
      || typeof b.ref_key !== "string" || !REF_KEY.test(b.ref_key)) throw new Fail(400, "INVALID_BODY");
  const rows = await db.send("PATCH",
    `app_push_log?workspace_id=eq.${workspaceId}&kind=eq.${b.kind}&ref_key=eq.${encodeURIComponent(b.ref_key)}&opened_at=is.null&select=day`,
    { opened_at: nowIso }, "return=representation");
  return { ok: true, opened: rows.length };
}

async function recent(db: Db, workspaceId: string, nowMs: number) {
  const rows = await db.get(`app_push_log?workspace_id=eq.${workspaceId}&sent_at=gte.${encodeURIComponent(recentSince(nowMs))}`
    + `&select=kind,ref_key,sent_at,status,shown_at,opened_at&order=sent_at.desc&limit=${RECENT_LIMIT}`);
  return { ok: true, items: recentRows(rows) };
}

// ---- 예약 입구 ------------------------------------------------------------------------------------------------------

// ---- 잊지 말기 알림(FAMILY-잊지말기 4단계) ---------------------------------------------------------------------------

export const FAMILY_TABLE = "app_family_notes";
export const FAMILY_OPEN = "/work/app/?view=home&family=1";
const HM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
// 보낼지: 끈 사람 = skipped_off, 조용한 시간(기본 22:00~07:00 서울) = held_quiet, 그 밖 = send(meeting-transcribe pushDecision과 같은 규칙, 종류만 다름).
export function kindDecision(kind: "family" | "signup" | "evening", prefs: unknown, nowMs: number): "send" | "held_quiet" | "skipped_off" {
  const p = prefs && typeof prefs === "object" && !Array.isArray(prefs) ? prefs as Record<string, unknown> : {};
  const kinds = p.kinds && typeof p.kinds === "object" ? p.kinds as Record<string, unknown> : {};
  if (kinds[kind] === false) return "skipped_off";
  const q0 = p.quiet && typeof p.quiet === "object" ? p.quiet as Record<string, unknown> : {};
  const q = typeof q0.from === "string" && typeof q0.to === "string" && HM.test(q0.from) && HM.test(q0.to) ? { from: q0.from, to: q0.to } : { from: "22:00", to: "07:00" };
  const kst = new Date(nowMs + 9 * 3600000), m = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const from = toMin(q.from), to = toMin(q.to);
  const quiet = from === to ? false : from < to ? m >= from && m < to : m >= from || m < to;
  return quiet ? "held_quiet" : "send";
}
export const familyDecision = (prefs: unknown, nowMs: number) => kindDecision("family", prefs, nowMs);
export const familyTitle = (n: number) => `잊지 말기 ${n > 99 ? "99+" : n}건`;

// 작업공간마다: 새 제안 수·가장 새 제안 시각 → 이미 같은 열쇠로 보냈거나(sent·failed·skipped_off) 보류 중이면서 아직 조용한 시간이면 넘김.
// 실패해도 다른 작업공간·다른 일은 계속한다(로그에는 단계 코드만).
async function familyPush(db: Db, ids: string[], nowMs: number, sender: FcmSender | null, log: Log) {
  let sent = 0, held = 0, off = 0;
  if (!sender) return { sent, held, off };
  const since = new Date(nowMs - LOG_KEEP_DAYS * DAY_MS).toISOString(), nowIso = new Date(nowMs).toISOString(), day = kstDay(nowMs);
  for (const ws of ids.slice(0, 50)) {
    try {
      const notes = await db.get(`${FAMILY_TABLE}?workspace_id=eq.${ws}&status=eq.new&created_at=gte.${encodeURIComponent(since)}&select=id,created_at&order=created_at.desc&limit=100`);
      if (!notes.length) continue;
      const newest = Date.parse(String(notes[0].created_at ?? ""));
      if (!Number.isFinite(newest)) continue;
      const ref = `fam:${Math.floor(newest / 1000)}`;
      const logged = await db.get(`app_push_log?workspace_id=eq.${ws}&kind=eq.family&ref_key=eq.${encodeURIComponent(ref)}&select=status,day&limit=5`);
      if (logged.some((r) => r.status !== "held_quiet")) continue;
      const devices = (await activeDevices(db, ws)).slice(0, MAX_DEVICES);
      if (!devices.length) continue;
      // 설정은 그 작업공간 owner 한 사람의 것(한 작업공간 = 주인 한 사람).
      const owners = (await db.get(`app_workspace_members?workspace_id=eq.${ws}&role=eq.owner&select=user_id&limit=2`)).map((r) => r.user_id).filter((v): v is string => typeof v === "string" && UUID.test(v));
      if (owners.length !== 1) continue;
      const prefs = (await db.get(`app_profiles?user_id=eq.${owners[0]}&select=notify_prefs&limit=1`))[0]?.notify_prefs ?? null;
      const decision = familyDecision(prefs, nowMs);
      const logDay = typeof logged[0]?.day === "string" ? logged[0].day as string : day;
      if (decision === "held_quiet") { if (!logged.length) await logPush(db, ws, "family", ref, day, "held_quiet"); held++; continue; }
      if (decision === "skipped_off") { await logPush(db, ws, "family", ref, logDay, "skipped_off"); off++; continue; }
      const out = await sendToDevices(db, sender, devices, { kind: "family", title: familyTitle(notes.length), open: FAMILY_OPEN, urgent: false }, nowIso);
      await logPush(db, ws, "family", ref, logDay, out.sent ? "sent" : "failed");
      if (out.sent) sent++;
    } catch (e) {
      log("family_push_failed", { stage: e instanceof Fail ? e.code : "INTERNAL" });
    }
  }
  return { sent, held, off };
}

// 월요일 아침 '가족 · 이번 주 기억할 것'(FAMILY-기억알림 ②). 월요일 08시 전·다른 요일이면 아무것도 읽지 않는다.
async function remindPush(db: Db, ids: string[], nowMs: number, sender: FcmSender | null, log: Log) {
  let sent = 0, held = 0, off = 0;
  const week = remindWeek(nowMs);
  if (!sender || !week.due) return { sent, held, off };
  const ref = remindRef(week.monday), nowIso = new Date(nowMs).toISOString(), day = kstDay(nowMs);
  for (const ws of ids.slice(0, 50)) {
    try {
      const logged = await db.get(`app_push_log?workspace_id=eq.${ws}&kind=eq.family&ref_key=eq.${encodeURIComponent(ref)}&select=status,day&limit=5`);
      if (logged.some((r) => r.status !== "held_quiet")) continue;
      const devices = (await activeDevices(db, ws)).slice(0, MAX_DEVICES);
      if (!devices.length) continue;
      const note = (await db.get(remindNotePath(ws)))[0];
      const week3 = weekPicks(note, day);
      if (!week3) continue;
      const owners = (await db.get(`app_workspace_members?workspace_id=eq.${ws}&role=eq.owner&select=user_id&limit=2`)).map((r) => r.user_id).filter((v): v is string => typeof v === "string" && UUID.test(v));
      if (owners.length !== 1) continue;
      const prefs = (await db.get(`app_profiles?user_id=eq.${owners[0]}&select=notify_prefs&limit=1`))[0]?.notify_prefs ?? null;
      const decision = familyDecision(prefs, nowMs);
      if (decision === "held_quiet") { if (!logged.length) await logPush(db, ws, "family", ref, day, "held_quiet"); held++; continue; }
      if (decision === "skipped_off") { await logPush(db, ws, "family", ref, day, "skipped_off"); off++; continue; }
      const out = await sendToDevices(db, sender, devices, { kind: "family", title: week3.text.title, body: week3.text.body, open: REMIND_OPEN, urgent: false }, nowIso);
      await logPush(db, ws, "family", ref, day, out.sent ? "sent" : "failed");
      if (!out.sent) continue;
      sent++;
      // 보인 줄을 노트 본 기록(metadata.remind)에 남긴다. 읽은 판 그대로일 때만 — 그사이 바뀌었으면 넘긴다(알림은 이미 갔고, 홈 칸이 다시 고른다).
      const metadata = week3.next && note ? withRemind(note.metadata, week3.next) : null;
      if (metadata) {
        try { await db.send("PATCH", remindPatchPath(note!, ws), { metadata }, "return=minimal"); }
        catch (e) { log("family_remind_mark_failed", { stage: e instanceof Fail ? e.code : "INTERNAL" }); }
      }
    } catch (e) {
      log("family_remind_failed", { stage: e instanceof Fail ? e.code : "INTERNAL" });
    }
  }
  return { sent, held, off };
}

// ---- 노트 알림(S69-97 ②, note-alarm.ts) ----------------------------------------------------------------------------

const NOTE_CHUNK = 50; // 한 번 읽기에 넣는 작업공간 수(주소 길이)
async function notePush(db: Db, ids: string[], nowMs: number, sender: FcmSender | null, log: Log) {
  const out = { sent: 0, off: 0, failed: 0 };
  if (!sender) return out;
  const nowIso = new Date(nowMs).toISOString(), day = kstDay(nowMs);
  const valid = ids.filter((v) => UUID.test(v));
  for (let i = 0; i < valid.length; i += NOTE_CHUNK) {
    const chunk = valid.slice(i, i + NOTE_CHUNK);
    let due: Map<string, { id: string; ref: string }[]>;
    try {
      due = dueByWorkspace(await db.get(noteAlarmPath(chunk, nowMs)), chunk, nowMs);
    } catch (e) {
      log("note_push_failed", { stage: e instanceof Fail ? e.code : "INTERNAL" });
      continue;
    }
    for (const [ws, notes] of due) {
      try {
        const logged = await db.get(`app_push_log?workspace_id=eq.${ws}&kind=eq.${NOTE_KIND}&ref_key=${inList(notes.map((n) => n.ref))}&select=ref_key,status&limit=${notes.length * 5 + 5}`);
        const done = new Set(logged.filter((r) => ["sent", "failed", "skipped_off"].includes(String(r.status))).map((r) => r.ref_key));
        const todo = notes.filter((n) => !done.has(n.ref)).slice(0, NOTE_PER_WORKSPACE); // 넘치면 다음 실행
        if (!todo.length) continue;
        const owners = (await db.get(`app_workspace_members?workspace_id=eq.${ws}&role=eq.owner&select=user_id&limit=2`)).map((r) => r.user_id).filter((v): v is string => typeof v === "string" && UUID.test(v));
        if (owners.length !== 1) continue;
        const prefs = (await db.get(`app_profiles?user_id=eq.${owners[0]}&select=notify_prefs&limit=1`))[0]?.notify_prefs ?? null;
        if (noteDecision(prefs) === "skipped_off") {
          for (const n of todo) await logPush(db, ws, NOTE_KIND, n.ref, day, "skipped_off");
          out.off += todo.length;
          continue;
        }
        const devices = (await activeDevices(db, ws)).slice(0, MAX_DEVICES);
        if (!devices.length) continue;
        for (const n of todo) {
          const sent = await sendToDevices(db, sender, devices, { kind: NOTE_KIND, title: NOTE_TITLE, open: noteOpen(n.id), urgent: false }, nowIso);
          await logPush(db, ws, NOTE_KIND, n.ref, day, sent.sent ? "sent" : "failed");
          if (sent.sent) out.sent++; else out.failed++;
        }
      } catch (e) {
        log("note_push_failed", { stage: e instanceof Fail ? e.code : "INTERNAL" });
      }
    }
  }
  return out;
}

// ---- 새 가입 알림(OPS-새가입알림 ②) ---------------------------------------------------------------------------------

export const SIGNUP_FEATURE = "dev_inbox";
export const SIGNUP_OPEN_VIEW = "signups";
export const SIGNUP_FIRST_LOOKBACK_MS = DAY_MS; // 기록이 하나도 없을 때(처음·30일 정리 뒤) 되돌아볼 길이
const SIGNUP_REF = /^su:([0-9]{9,11})$/;
export const signupRef = (sec: number) => `su:${sec}`;
const refSec = (ref: unknown) => { const m = typeof ref === "string" ? SIGNUP_REF.exec(ref) : null; return m ? Number(m[1]) : null; };
// "새 가입 2명" — 수만(이름·조직 없음, S68-58).
export function signupTitle(count: number) {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return `새 가입 ${n}명`;
}

// 운영자 작업공간(서버 허용 표 dev_inbox가 정확히 한 작업공간일 때만). 아니면 null(아무에게도 보내지 않음).
async function signupWorkspace(db: Db) {
  const v = await db.rpc("app_operator_feature_workspace", { p_feature: SIGNUP_FEATURE });
  return typeof v === "string" && UUID.test(v) ? v : null;
}

// 지금까지 알린 자리(초): 보냄·실패·끔·연 것 중 가장 새 열쇠. 없으면 하루 전.
export function signupSince(rows: Record<string, unknown>[], nowMs: number) {
  let w: number | null = null;
  for (const r of rows) {
    const sec = refSec(r.ref_key);
    if (sec === null || !(["sent", "failed", "skipped_off"].includes(String(r.status)) || r.opened_at)) continue;
    if (w === null || sec > w) w = sec;
  }
  return w ?? Math.floor((nowMs - SIGNUP_FIRST_LOOKBACK_MS) / 1000);
}

async function signupPush(db: Db, nowMs: number, sender: FcmSender | null, log: Log) {
  const out = { sent: 0, held: 0, off: 0, found: 0 };
  if (!sender) return out;
  try {
    const ws = await signupWorkspace(db);
    if (!ws) return out;
    const logged = await db.get(`app_push_log?workspace_id=eq.${ws}&kind=eq.signup&select=ref_key,status,day,opened_at&limit=500`);
    const since = signupSince(logged, nowMs);
    const r = await db.rpc("app_signup_since", { p_since: new Date(since * 1000).toISOString() }) as Record<string, unknown> | null;
    const count = Number(r?.count ?? 0), newest = Number(r?.newest ?? NaN);
    if (!(count > 0) || !Number.isInteger(newest) || newest <= since) return out;
    out.found = count;
    const ref = signupRef(newest), day = kstDay(newest * 1000);
    if (logged.some((x) => x.ref_key === ref && (x.status !== "held_quiet" && x.status !== "shown" || x.opened_at))) return out;
    const owners = (await db.get(`app_workspace_members?workspace_id=eq.${ws}&role=eq.owner&select=user_id&limit=2`)).map((x) => x.user_id).filter((v): v is string => typeof v === "string" && UUID.test(v));
    if (owners.length !== 1) return out;
    const prefs = (await db.get(`app_profiles?user_id=eq.${owners[0]}&select=notify_prefs&limit=1`))[0]?.notify_prefs ?? null;
    const decision = kindDecision("signup", prefs, nowMs);
    // 조용한 시간: 기록하지 않고 넘긴다 — 끝난 뒤 첫 실행이 같은 자리(since)부터 그동안 가입을 묶어 한 번 보낸다.
    if (decision === "held_quiet") { out.held++; return out; }
    if (decision === "skipped_off") { await logPush(db, ws, "signup", ref, day, "skipped_off"); out.off++; return out; }
    const devices = (await activeDevices(db, ws)).slice(0, MAX_DEVICES);
    if (!devices.length) { await logPush(db, ws, "signup", ref, day, "failed"); return out; } // 폰이 없으면 알림 줄만(늘 뜸)
    const sent = await sendToDevices(db, sender, devices,
      { kind: "signup", title: signupTitle(count), open: openPath("signup", ref), urgent: false }, new Date(nowMs).toISOString());
    await logPush(db, ws, "signup", ref, day, sent.sent ? "sent" : "failed");
    if (sent.sent) out.sent++;
  } catch (e) {
    log("signup_push_failed", { stage: e instanceof Fail ? e.code : "INTERNAL" });
  }
  return out;
}

// 알림 줄: 운영자 작업공간이면 아직 열지 않은 새 가입 한 줄. 운영자 확인은 서버 허용 표(service_role rpc) + 목록 함수 자신(사용자 로그인).
async function signupNotice(db: Db, asUserRpc: (fn: string) => Promise<Record<string, unknown>[]>, workspaceId: string, nowMs: number): Promise<DoneItem | null> {
  try {
    if (await signupWorkspace(db) !== workspaceId) return null;
    const opened = await db.get(`app_push_log?workspace_id=eq.${workspaceId}&kind=eq.signup&opened_at=not.is.null&select=ref_key&limit=500`);
    let floor = Math.floor((nowMs - RECENT_DAYS * DAY_MS) / 1000);
    for (const o of opened) { const sec = refSec(o.ref_key); if (sec !== null && sec > floor) floor = sec; }
    const people = (await asUserRpc("app_signup_list"))
      .map((p) => ({ sec: Math.floor(Date.parse(String(p.signed_up_at ?? "")) / 1000) }))
      .filter((p) => Number.isFinite(p.sec) && p.sec > floor && p.sec <= Math.floor(nowMs / 1000) + 300)
      .sort((a, b) => b.sec - a.sec);
    if (!people.length) return null;
    const ref = signupRef(people[0].sec);
    return { kind: "signup", ref_key: ref, day: kstDay(people[0].sec * 1000), open: openPath("signup", ref), text: signupTitle(people.length) };
  } catch {
    return null; // 못 읽으면 줄이 없을 뿐
  }
}

// ---- 저녁 Now 한 줄 알림(OUTSIDE-바깥성명 ⑥) -------------------------------------------------------------------------

export const eveningRef = (day: string) => `now:${day}`;

async function eveningPush(db: Db, ids: string[], nowMs: number, sender: FcmSender | null, log: Log) {
  const out = { lines: 0, sent: 0, held: 0, off: 0 };
  try {
    const ws = newsWorkspaceOf(await db.rpc("app_operator_feature_workspace", { p_feature: NEWS_FEATURE }));
    if (!ws || !ids.some((id) => id.toLowerCase() === ws)) return out; // 기능이 없거나 살아 있는 기기가 없으면 아무것도 읽지 않는다
    const day = kstDay(nowMs), ref = eveningRef(day);
    const logged = await db.get(`app_push_log?workspace_id=eq.${ws}&kind=eq.evening&ref_key=eq.${encodeURIComponent(ref)}&select=status&limit=1`);
    if (logged.length) return out; // 하루 한 번
    const line = nowEveningLine(await nowEveningCounts(db.get, ws, nowMs));
    if (!line) return out; // 개수 0이면 안 보냄(기록도 안 남김)
    out.lines = 1;
    if (!sender) return out;
    const owners = (await db.get(`app_workspace_members?workspace_id=eq.${ws}&role=eq.owner&select=user_id&limit=2`)).map((r) => r.user_id).filter((v): v is string => typeof v === "string" && UUID.test(v));
    if (owners.length !== 1) return out;
    const prefs = (await db.get(`app_profiles?user_id=eq.${owners[0]}&select=notify_prefs&limit=1`))[0]?.notify_prefs ?? null;
    const decision = kindDecision("evening", prefs, nowMs);
    if (decision === "held_quiet") { await logPush(db, ws, "evening", ref, day, "held_quiet"); out.held++; return out; }
    if (decision === "skipped_off") { await logPush(db, ws, "evening", ref, day, "skipped_off"); out.off++; return out; }
    const devices = (await activeDevices(db, ws)).slice(0, MAX_DEVICES);
    if (!devices.length) return out;
    const sent = await sendToDevices(db, sender, devices, { kind: "evening", title: line, open: openPath("evening", ref), urgent: false }, new Date(nowMs).toISOString());
    await logPush(db, ws, "evening", ref, day, sent.sent ? "sent" : "failed");
    if (sent.sent) out.sent++;
  } catch (e) {
    log("evening_push_failed", { stage: e instanceof Fail ? e.code : "INTERNAL" });
  }
  return out;
}

async function runSlot(db: Db, slot: string, nowMs: number, sender: FcmSender | null = null, log: Log = () => {}) {
  // 30일 지난 기록 정리(설계 4.1). 기록에는 종류·열쇠·날짜·상태만 있다.
  const cutoff = new Date(nowMs - LOG_KEEP_DAYS * DAY_MS).toISOString();
  const pruned = await db.send("DELETE", `app_push_log?sent_at=lt.${encodeURIComponent(cutoff)}&select=day`, undefined, "return=representation");
  // 받을 작업공간: 살아 있는 기기가 있는 곳. 기기 주인이 지금도 그 작업공간 owner인지는 보낼 때(N5) 다시 본다.
  const rows = await db.get("app_push_devices?revoked_at=is.null&select=workspace_id&limit=1000");
  const ids = [...new Set(rows.map((r) => r.workspace_id).filter((v): v is string => typeof v === "string"))];
  // 종류 판단·보내기는 N5(설계 6절)에서 더한다. 지금은 잊지 말기(15분 예약)만 보낸다.
  if (slot === "quarter") {
    const fam = await familyPush(db, ids, nowMs, sender, log);
    const remind = await remindPush(db, ids, nowMs, sender, log);
    const signup = await signupPush(db, nowMs, sender, log);
    const note = await notePush(db, ids, nowMs, sender, log);
    return { ok: true, slot, workspaces: ids.length, sent: fam.sent + remind.sent + signup.sent + note.sent, pruned: pruned.length, family: fam, remind, signup, note };
  }
  if (slot !== "evening") return { ok: true, slot, workspaces: ids.length, sent: 0, pruned: pruned.length };
  // 저녁: Now 한 줄('새 성명 n · 새 기사 n', now-line.ts)을 'outside' 작업공간에 폰 알림 하나로(줄 글은 응답·로그에 싣지 않음).
  const evening = await eveningPush(db, ids, nowMs, sender, log);
  return { ok: true, slot, workspaces: ids.length, sent: evening.sent, pruned: pruned.length, now_lines: evening.lines, evening: { sent: evening.sent, held: evening.held, off: evening.off } };
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
        const fcm = slot === "quarter" || slot === "evening" ? readFcmConfig(deps.env(FCM_SECRET_NAME)) : null;
        return json(await runSlot(db, slot!, nowMs, fcm ? makeFcmSender(fcm, doFetch, now) : null, log));
      }

      const who = await authorizeUser(sb, key, auth!.slice("Bearer ".length), doFetch, db);
      if (action === "register") return json(await register(db, who, b, nowIso));
      if (action === "unregister") return json(await unregister(db, who, b));
      if (action === "opened") return json(await opened(db, who.workspaceId, b, nowIso));
      if (!exactKeys(b, [])) throw new Fail(400, "INVALID_BODY");
      if (action === "devices") return json(await listDevices(db, who));
      if (action === "recent") return json(await recent(db, who.workspaceId, nowMs));
      if (action === "notices") {
        const asUser = makeUserRead(sb, deps.env("SUPABASE_ANON_KEY"), auth!.slice("Bearer ".length), doFetch);
        const items = await doneItems(asUser, who.workspaceId, nowMs);
        const signup = await signupNotice(db, (fn) => asUser(`rpc/${fn}`), who.workspaceId, nowMs);
        return json(await notices(db, signup ? [...items, signup] : items, who.workspaceId, nowIso));
      }

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
        { kind: "test", title: "WORK ON+ · 시험 알림", open: "/work/app/", urgent: true }, nowIso);
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
