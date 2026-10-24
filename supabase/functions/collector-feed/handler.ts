// collector-feed: 명진 계정 Google 앱 스크립트("Web2 수집 보내기")가 보낸 통화 분석·텔레그램 묶음을 받아 Web2 표에 저장한다.
// (CALL-통화메뉴·TG-소식메뉴 2단계, docs/design/call-telegram-feed.md 2·3·4.2~4.5·5·6절, 12절 결정)
//
// 입구(verify_jwt=false, 함수 안에서 막음):
// - `x-collector-feed-secret` 헤더를 비밀값 COLLECTOR_FEED_SECRET과 SHA-256 고정 길이 비교(drive-summary heartbeat와 같은 방식).
//   비밀값이 없거나 32자보다 짧으면 모두 거절. 사용자 로그인(Authorization), 예약 비밀값, heartbeat 비밀값이 붙은 요청도 401.
// - 브라우저용 CORS 허용 헤더를 주지 않는다(부르는 쪽은 앱 스크립트뿐).
// 권한:
// - 업무공간은 서버가 `kptu-work`로 정한다. 요청 몸통은 정해진 칸만 받고 workspace·owner 같은 칸이 있으면 400.
// - DB는 service role로 쓰되 migration 20261024140000_call_tg_feed의 칸별 grant 안만 쓴다:
//   app_feed_items = 넣기(고정·지우기·확정 프로젝트 칸 없음) + 중복 확인 세 칸 읽기, app_feed_days = 읽기·넣기·숫자 칸 고치기.
//   소식 줄 고치기·지우기·원문 읽기는 하지 않는다. 담당조직·프로젝트 목록과 업무공간 id는 읽기만 한다(drive-summary와 같은 읽기).
// 동작:
// - POST ?action=call: 통화 분석 파일(이미 Gemini가 만든 것) 읽기만. AI 없음. 업무면 저장, 개인·애매·구분 없음은 개수만, 모양 다름은 판정 실패.
// - POST ?action=call_skip: 앱 스크립트가 개인 번호·연락처 목록으로 거른 수(개수만).
// - POST ?action=telegram: 방 하나·하루치 묶음마다 AI 한 번(공용 모듈 _shared/openai-responses.ts). 실패·형식 틀림이면 아무것도 저장하지 않음.
// - 하루 숫자는 app_feed_days에 더한다. 받은 요청 수(batch_count)·AI 사용량(ai_*)은 받은 날(한국 날짜) 줄, 나머지는 내용 날짜 줄.
// 응답·로그에는 개수와 단계 코드만 넣는다. 원문·요약·이름·오류 원문은 넣지 않는다.
import { readBoundedJson } from "../_shared/bounded-json.mjs";
import { aiConfigFrom, callOpenAi, estimateKrw, outputText, tokenCount } from "../_shared/openai-responses.ts";
import { organizationOptions, projectOptions } from "../ai-assist/library-fill.ts";
import { CALL_LIMITS, cleanLine, kstDay, type OrgRow, parseCall } from "./call-analysis.ts";
import {
  parseTelegram, rawLines, TELEGRAM_INSTRUCTIONS, TELEGRAM_SCHEMA, telegramMaterial, TG_LIMITS, type TgMessage,
} from "./telegram.ts";

export type Env = (name: string) => string | undefined;
export type Log = (code: string, detail?: Record<string, unknown>) => void;
export type CollectorFeedDeps = {
  env: Env;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: Log;
};

export const WORKSPACE_SLUG = "kptu-work";
export const SECRET_HEADER = "x-collector-feed-secret";
export const SECRET_NAME = "COLLECTOR_FEED_SECRET";
export const SECRET_MIN_CHARS = 32;
// 다른 입구의 비밀 헤더는 여기서 열쇠가 아니다(붙어 있으면 401).
const FOREIGN_SECRET_HEADERS = ["x-drive-summary-cron-secret", "x-collector-heartbeat-secret"];

// 크기 상한(설계 4.4절: 합계 200 KB). 몸통은 JSON 글자 이스케이프 여유를 둔다.
export const MAX_BODY_BYTES = 240 * 1024;
export const TRANSCRIPT_BYTES = 200 * 1024;
export const RAW_TEXT_BYTES = 204800;
// 하루 상한(설계 4.4절): 받은 날 기준 통화 50건, 텔레그램 묶음 80개. 넘으면 429.
export const DAILY_LIMITS = Object.freeze({ call: 50, telegram: 80 });
// 이 기능 한 달 AI 상한(Q7): 6,000원. ai-assist의 15,000원 상한과 따로 센다(app_feed_days.ai_*).
export const MONTHLY_LIMIT_KRW = 6000;
// 내용 날짜는 오늘(한국 날짜)부터 92일 전까지만 받는다(미래 날짜·오래된 날짜 거절).
export const MAX_PAST_DAYS = 92;

// AI 설정은 ai-assist와 같은 열쇠·모델·가격 기본값(설계 4.4절). 모델·가격은 _shared/ai-model.ts 한 곳.
export const OPENAI_URL = "https://api.openai.com/v1/responses";
export const KEY_NAME = "WEB2_OPENAI_API_KEY";
// 모델·가격 기본값은 _shared/ai-model.ts 한 곳(운영 값은 WEB2_AI_MODEL·WEB2_AI_PRICE_*로 바꿀 수 있음).
import { DEFAULT_AI_MODEL, DEFAULT_PRICE_IN_KRW_PER_MTOK, DEFAULT_PRICE_OUT_KRW_PER_MTOK } from "../_shared/ai-model.ts";
export { DEFAULT_PRICE_IN_KRW_PER_MTOK, DEFAULT_PRICE_OUT_KRW_PER_MTOK };
export const DEFAULT_MODEL = DEFAULT_AI_MODEL;
export const OPENAI_TIMEOUT_MS = 45000;
export const RETRY_DELAY_MS = 1000;
const OPENAI_RESPONSE_BYTES = 256 * 1024;
const DB_RESPONSE_BYTES = 1024 * 1024;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;
const ROOM_KEY = /^[A-Za-z0-9_.:-]{1,100}$/;
const MESSAGE_REF = /^[A-Za-z0-9_.:-]{1,40}$/;
const SENDER = /^[A-Z]{1,3}$/;
const DRIVE_URL = /^https:\/\/(drive|docs)\.google\.com\/[^\s\u0000-\u001f\u007f]*$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

class Fail extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });

// SHA-256으로 두 값을 같은 길이로 만든 뒤 끝까지 비교한다(일찍 멈추지 않음). drive-summary core.mjs secretMatches와 같다.
export async function secretMatches(given: string | null, expected: string | undefined) {
  if (!expected || expected.length < SECRET_MIN_CHARS || !given || given.length > 4096) return false;
  const digest = (value: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  const aa = new Uint8Array(a), bb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

const bytes = (s: string) => new TextEncoder().encode(s).length;
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const exactKeys = (o: Record<string, unknown>, required: string[], optional: string[] = []) => {
  const keys = Object.keys(o);
  return required.every((k) => keys.includes(k)) && keys.every((k) => required.includes(k) || optional.includes(k));
};
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
function validDay(value: unknown, today: string): value is string {
  if (typeof value !== "string" || !DAY.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value && value <= today && value >= addDays(today, -MAX_PAST_DAYS);
}
// 원문 사본 상한(204800 bytes) 안으로 자른다(글자 경계에서).
function capBytes(s: string, max: number) {
  if (bytes(s) <= max) return s;
  let out = "", used = 0;
  for (const ch of s) {
    const n = bytes(ch);
    if (used + n > max) break;
    out += ch;
    used += n;
  }
  return out;
}
async function sha256Hex(value: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- 몸통 검사 ------------------------------------------------------------------------------------------------------

type CallInput = { ref: string; analysis_md: string; transcript: string; drive_url: string | null };
export function parseCallBody(b: Record<string, unknown>): CallInput {
  if (!exactKeys(b, ["ref", "analysis_md", "transcript"], ["drive_url"])) throw new Fail(400, "INVALID_BODY");
  if (typeof b.ref !== "string" || !DRIVE_ID.test(b.ref)) throw new Fail(400, "INVALID_BODY");
  if (typeof b.analysis_md !== "string" || !b.analysis_md.trim() || bytes(b.analysis_md) > CALL_LIMITS.analysisBytes) throw new Fail(400, "INVALID_BODY");
  if (typeof b.transcript !== "string" || bytes(b.transcript) > TRANSCRIPT_BYTES) throw new Fail(400, "INVALID_BODY");
  if (bytes(b.analysis_md) + bytes(b.transcript) > CALL_LIMITS.totalBytes) throw new Fail(413, "BODY_TOO_LARGE");
  const url = b.drive_url ?? null;
  if (url !== null && (typeof url !== "string" || url.length > 500 || !DRIVE_URL.test(url))) throw new Fail(400, "INVALID_BODY");
  return { ref: b.ref, analysis_md: b.analysis_md, transcript: b.transcript, drive_url: url as string | null };
}

type SkipInput = { day: string; personal: number; short: number };
export function parseSkipBody(b: Record<string, unknown>, today: string): SkipInput {
  if (!exactKeys(b, ["day", "personal", "short"])) throw new Fail(400, "INVALID_BODY");
  if (!validDay(b.day, today) || !isInt(b.personal, 0, 500) || !isInt(b.short, 0, 500)) throw new Fail(400, "INVALID_BODY");
  return { day: b.day, personal: b.personal, short: b.short };
}

type TelegramInput = { day: string; room_key: string; room_label: string; total: number; part: number; attempt: number; messages: TgMessage[] };
export function parseTelegramBody(b: Record<string, unknown>, today: string): TelegramInput {
  if (!exactKeys(b, ["day", "room_key", "room_label", "total", "messages"], ["part", "attempt"])) throw new Fail(400, "INVALID_BODY");
  if (!validDay(b.day, today)) throw new Fail(400, "INVALID_BODY");
  if (typeof b.room_key !== "string" || !ROOM_KEY.test(b.room_key)) throw new Fail(400, "INVALID_BODY");
  const label = typeof b.room_label === "string" && !/[\u0000-\u001f\u007f]/.test(b.room_label) ? cleanLine(b.room_label, 100) : null;
  if (!label) throw new Fail(400, "INVALID_BODY");
  const part = b.part ?? 1, attempt = b.attempt ?? 1;
  if (!isInt(part, 1, 50) || !isInt(attempt, 1, 3)) throw new Fail(400, "INVALID_BODY");
  if (!Array.isArray(b.messages) || b.messages.length > TG_LIMITS.messages) throw new Fail(400, "INVALID_BODY");
  if (!isInt(b.total, b.messages.length, 5000)) throw new Fail(400, "INVALID_BODY");
  const seen = new Set<string>();
  const messages: TgMessage[] = [];
  for (const raw of b.messages as unknown[]) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Fail(400, "INVALID_BODY");
    const m = raw as Record<string, unknown>;
    if (!exactKeys(m, ["ref", "at", "sender", "text"], ["reply_to", "forwarded"])) throw new Fail(400, "INVALID_BODY");
    if (typeof m.ref !== "string" || !MESSAGE_REF.test(m.ref) || seen.has(m.ref)) throw new Fail(400, "INVALID_BODY");
    if (typeof m.sender !== "string" || !SENDER.test(m.sender)) throw new Fail(400, "INVALID_BODY");
    if (typeof m.text !== "string" || !m.text.trim() || [...m.text].length > TG_LIMITS.messageChars) throw new Fail(400, "INVALID_BODY");
    const at = typeof m.at === "string" && ISO.test(m.at) ? Date.parse(m.at) : NaN;
    if (!Number.isFinite(at) || kstDay(at) !== b.day) throw new Fail(400, "INVALID_BODY");
    const reply = m.reply_to ?? null;
    if (reply !== null && (typeof reply !== "string" || !MESSAGE_REF.test(reply))) throw new Fail(400, "INVALID_BODY");
    const fwd = m.forwarded ?? false;
    if (typeof fwd !== "boolean") throw new Fail(400, "INVALID_BODY");
    seen.add(m.ref);
    messages.push({ ref: m.ref, at, sender: m.sender, text: m.text.normalize("NFC"), reply_to: reply as string | null, forwarded: fwd });
  }
  messages.sort((x, y) => x.at - y.at || (x.ref < y.ref ? -1 : x.ref > y.ref ? 1 : 0));
  return { day: b.day, room_key: b.room_key, room_label: label, total: b.total, part, attempt, messages };
}

// ---- DB(service role, 칸별 grant 안) ---------------------------------------------------------------------------------

type Db = {
  get: (path: string) => Promise<Record<string, unknown>[]>;
  insert: (table: string, row: Record<string, unknown>) => Promise<"ok" | "conflict">;
  patch: (path: string, body: Record<string, unknown>) => Promise<number>;
};
function makeDb(sb: string, key: string, doFetch: typeof fetch): Db {
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  async function send(path: string, init: RequestInit) {
    let r: Response;
    try { r = await doFetch(`${sb}/rest/v1/${path}`, { ...init, signal: AbortSignal.timeout(20000) }); }
    catch { throw new Fail(503, "DB_UNAVAILABLE"); }
    return r;
  }
  return {
    async get(path) {
      const r = await send(path, { headers: { ...headers, Accept: "application/json" } });
      if (!r.ok) { try { await r.body?.cancel(); } catch { /* ignore */ } throw new Fail(503, "DB_READ_FAILED"); }
      let rows: unknown;
      try { rows = await readBoundedJson(r, { maxBytes: DB_RESPONSE_BYTES }); } catch { throw new Fail(503, "DB_READ_FAILED"); }
      if (!Array.isArray(rows)) throw new Fail(503, "DB_READ_FAILED");
      return rows as Record<string, unknown>[];
    },
    async insert(table, row) {
      const r = await send(table, {
        method: "POST", headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(row),
      });
      try { await r.body?.cancel(); } catch { /* ignore */ }
      if (r.status === 409) return "conflict";
      if (!r.ok) throw new Fail(503, "DB_WRITE_FAILED");
      return "ok";
    },
    async patch(path, body) {
      const r = await send(path, {
        method: "PATCH", headers: { ...headers, "Content-Type": "application/json", Accept: "application/json", Prefer: "return=representation" },
        body: JSON.stringify(body),
      });
      if (!r.ok) { try { await r.body?.cancel(); } catch { /* ignore */ } throw new Fail(503, "DB_WRITE_FAILED"); }
      let rows: unknown;
      try { rows = await readBoundedJson(r, { maxBytes: DB_RESPONSE_BYTES }); } catch { throw new Fail(503, "DB_WRITE_FAILED"); }
      return Array.isArray(rows) ? rows.length : 0;
    },
  };
}

const COUNTERS = ["total_count", "kept_count", "room_count", "personal_count", "unsure_count", "failed_count", "batch_count",
  "ai_requests", "ai_input_tokens", "ai_output_tokens"] as const;
type Counter = typeof COUNTERS[number];
type Delta = Partial<Record<Counter, number>>;
const DAY_SELECT = `workspace_id,day,source,${COUNTERS.join(",")}`;
const num = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0);

async function readDayRow(db: Db, ws: string, day: string, source: string) {
  const rows = await db.get(`app_feed_days?workspace_id=eq.${ws}&day=eq.${day}&source=eq.${source}&select=${DAY_SELECT}&limit=2`);
  if (rows.length > 1) throw new Fail(503, "DB_READ_FAILED");
  return rows[0] ?? null;
}
// 하루 숫자 더하기: 줄이 없으면 넣고(insert 칸 grant), 있으면 숫자 칸만 고친다(update 칸 grant). upsert는 키 칸까지 고치려 해서 쓰지 않는다.
async function addDay(db: Db, ws: string, day: string, source: string, delta: Delta, nowMs: number) {
  if (!Object.values(delta).some((v) => v)) return;
  for (let attempt = 0; attempt < 2; attempt++) {
    const row = await readDayRow(db, ws, day, source);
    const updated_at = new Date(nowMs).toISOString();
    if (!row) {
      const fresh: Record<string, unknown> = { workspace_id: ws, day, source, updated_at };
      for (const k of COUNTERS) fresh[k] = delta[k] ?? 0;
      if (await db.insert("app_feed_days", fresh) === "ok") return;
      continue; // 같은 순간 다른 요청이 줄을 만들었으면 다시 읽어 더한다.
    }
    const patch: Record<string, unknown> = { updated_at };
    for (const k of COUNTERS) if (delta[k]) patch[k] = num(row[k]) + delta[k]!;
    // 읽은 값 그대로일 때만 고친다(사이에 다른 요청이 더했으면 다시 읽음).
    const guard = COUNTERS.filter((k) => delta[k]).map((k) => `&${k}=eq.${num(row[k])}`).join("");
    if (await db.patch(`app_feed_days?workspace_id=eq.${ws}&day=eq.${day}&source=eq.${source}${guard}&select=day`, patch) === 1) return;
  }
  throw new Fail(503, "DB_WRITE_FAILED");
}

async function workspaceId(db: Db) {
  const rows = await db.get(`app_workspaces?slug=eq.${WORKSPACE_SLUG}&select=id&limit=2`);
  const id = rows.length === 1 && typeof rows[0].id === "string" ? rows[0].id.toLowerCase() : "";
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Fail(503, "WORKSPACE_UNAVAILABLE");
  return id;
}

async function readOrgs(db: Db, ws: string): Promise<OrgRow[]> {
  const rows = await db.get(`app_suborganizations?workspace_id=eq.${ws}&select=id,workspace_id,name,aliases,active&order=name.asc&limit=500`);
  return rows
    .filter((r) => typeof r.id === "string" && String(r.workspace_id).toLowerCase() === ws && typeof r.name === "string")
    .map((r) => ({
      id: String(r.id).toLowerCase(), name: String(r.name), active: r.active === false ? false : true,
      aliases: Array.isArray(r.aliases) ? r.aliases.filter((a): a is string => typeof a === "string").slice(0, 20) : [],
    }));
}

// 받은 날 기준 하루 상한. 넘지 않았으면 이번 요청을 먼저 센다.
async function claimBatch(db: Db, ws: string, today: string, source: "call" | "telegram", nowMs: number) {
  const row = await readDayRow(db, ws, today, source);
  if (num(row?.batch_count) >= DAILY_LIMITS[source]) throw new Fail(429, "DAILY_LIMIT");
  await addDay(db, ws, today, source, { batch_count: 1 }, nowMs);
}

// ---- 통화 ----------------------------------------------------------------------------------------------------------

async function runCall(db: Db, ws: string, input: CallInput, nowMs: number) {
  const today = kstDay(nowMs);
  await claimBatch(db, ws, today, "call", nowMs);
  const dup = await db.get(`app_feed_items?workspace_id=eq.${ws}&source=eq.call&source_ref=eq.${input.ref}&select=source_ref&limit=1`);
  if (dup.length) return { ok: true, kept: 0, personal: 0, unsure: 0, failed: 0, duplicate: true };
  const parsed = parseCall(input, await readOrgs(db, ws), nowMs);
  const inRange = !!parsed.day && parsed.day <= today && parsed.day >= addDays(today, -MAX_PAST_DAYS);
  const day = inRange ? parsed.day! : today;
  // 녹음 날짜가 받는 범위(오늘부터 92일 전까지) 밖이면 업무여도 저장하지 않고 판정 실패로 센다.
  if (parsed.kind === "business" && !inRange) {
    await addDay(db, ws, day, "call", { total_count: 1, failed_count: 1 }, nowMs);
    return { ok: true, kept: 0, personal: 0, unsure: 0, failed: 1, duplicate: false };
  }
  if (parsed.kind !== "business") {
    const delta: Delta = { total_count: 1 };
    if (parsed.kind === "personal") delta.personal_count = 1;
    else if (parsed.kind === "unsure") delta.unsure_count = 1;
    else delta.failed_count = 1;
    await addDay(db, ws, day, "call", delta, nowMs);
    return { ok: true, kept: 0, personal: delta.personal_count ?? 0, unsure: delta.unsure_count ?? 0, failed: delta.failed_count ?? 0, duplicate: false };
  }
  const result = await db.insert("app_feed_items", {
    workspace_id: ws, source: "call", day, occurred_at: parsed.occurred_at, title: parsed.title, points: parsed.points,
    counterpart: parsed.counterpart, speaker_split: parsed.speaker_split,
    raw_text: parsed.raw_text === null ? null : capBytes(parsed.raw_text, RAW_TEXT_BYTES),
    raw_count: 0, organization_id: parsed.organization_id, source_ref: input.ref, drive_url: input.drive_url,
    model: parsed.model, judged_at: parsed.judged_at,
  });
  if (result === "conflict") return { ok: true, kept: 0, personal: 0, unsure: 0, failed: 0, duplicate: true };
  await addDay(db, ws, day, "call", { total_count: 1, kept_count: 1 }, nowMs);
  return { ok: true, kept: 1, personal: 0, unsure: 0, failed: 0, duplicate: false };
}

async function runCallSkip(db: Db, ws: string, input: SkipInput, nowMs: number) {
  await claimBatch(db, ws, kstDay(nowMs), "call", nowMs);
  await addDay(db, ws, input.day, "call", {
    total_count: input.personal + input.short, personal_count: input.personal, unsure_count: input.short,
  }, nowMs);
  return { ok: true, kept: 0, personal: input.personal, unsure: input.short, failed: 0, duplicate: false };
}

// ---- 텔레그램 ------------------------------------------------------------------------------------------------------

type AiDeps = { doFetch: typeof fetch; sleep: (ms: number) => Promise<void>; log: Log; env: Env };

async function monthUsage(db: Db, ws: string, nowMs: number) {
  const today = kstDay(nowMs), monthStart = `${today.slice(0, 7)}-01`;
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const rows = await db.get(`app_feed_days?workspace_id=eq.${ws}&source=eq.telegram&day=gte.${monthStart}&day=lt.${next}&select=day,ai_input_tokens,ai_output_tokens&limit=62`);
  let input = 0, output = 0;
  for (const r of rows) { input += num(r.ai_input_tokens); output += num(r.ai_output_tokens); }
  return { input, output };
}

async function runTelegram(db: Db, ws: string, input: TelegramInput, nowMs: number, deps: AiDeps) {
  const today = kstDay(nowMs);
  const msgRefs = input.messages.map((m) => m.ref).sort().join(",");
  const batch = (await sha256Hex(`${input.room_key}|${input.day}|${msgRefs}`)).slice(0, 32);
  const prefix = `tg:${batch}:`;
  const counts = (kept: number, failed = 0) => ({
    // 한 방이 여러 묶음(part)으로 나뉘면 그 방의 하루 메시지 수(total)·방 수는 첫 묶음에서만 센다.
    total_count: input.part === 1 ? input.total : 0, kept_count: kept, room_count: input.part === 1 ? 1 : 0, failed_count: failed,
  });
  await claimBatch(db, ws, today, "telegram", nowMs);
  // 같은 묶음이 다시 오면 AI를 다시 부르지 않는다(저장 전에 먼저 확인).
  const dup = await db.get(`app_feed_items?workspace_id=eq.${ws}&source=eq.telegram&source_ref=like.${encodeURIComponent(prefix)}*&select=source_ref&limit=1`);
  if (dup.length) return { ok: true, kept: 0, personal: 0, unsure: 0, failed: 0, duplicate: true };
  // 글 있는 메시지가 없으면 AI에 보내지 않고 개수만 더한다(설계 3.2절).
  if (!input.messages.length) {
    await addDay(db, ws, input.day, "telegram", counts(0), nowMs);
    return { ok: true, kept: 0, personal: 0, unsure: 0, failed: 0, duplicate: false };
  }
  const config = aiConfigFrom(deps.env, { keyName: KEY_NAME, model: DEFAULT_MODEL, priceIn: DEFAULT_PRICE_IN_KRW_PER_MTOK, priceOut: DEFAULT_PRICE_OUT_KRW_PER_MTOK });
  if (!config) throw new Fail(503, "AI_NOT_CONFIGURED");
  const used = await monthUsage(db, ws, nowMs);
  if (estimateKrw(used.input, used.output, config.price) >= MONTHLY_LIMIT_KRW) throw new Fail(429, "AI_MONTHLY_LIMIT");

  const orgs = organizationOptions(await readOrgs(db, ws));
  const projects = projectOptions(await db.get(`app_spaces?workspace_id=eq.${ws}&select=id,name,parent_id,status,metadata&order=sort_order.asc,created_at.asc&limit=500`));
  const material = telegramMaterial(input.day, input.room_label, input.messages, orgs, projects);
  // 부르기 전에 횟수를 먼저 센다(ai-assist와 같음).
  await addDay(db, ws, today, "telegram", { ai_requests: 1 }, nowMs);
  const result = await callOpenAi({ doFetch: deps.doFetch, sleep: deps.sleep, log: deps.log }, config.key, {
    model: config.model,
    store: false,
    max_output_tokens: TG_LIMITS.maxOutputTokens,
    input: [
      { role: "developer", content: TELEGRAM_INSTRUCTIONS },
      { role: "user", content: material },
    ],
    text: { format: { type: "json_schema", name: "telegram_feed", strict: true, schema: TELEGRAM_SCHEMA } },
  }, { url: OPENAI_URL, timeoutMs: OPENAI_TIMEOUT_MS, retryDelayMs: RETRY_DELAY_MS, maxResponseBytes: OPENAI_RESPONSE_BYTES });
  const usage = result.ok ? result.usage : result.charged ? { input: [...material].length * 2, output: TG_LIMITS.maxOutputTokens } : { input: 0, output: 0 };
  if (usage.input || usage.output) {
    try { await addDay(db, ws, today, "telegram", { ai_input_tokens: tokenCount(usage.input), ai_output_tokens: tokenCount(usage.output) }, nowMs); }
    catch { deps.log("usage_record_failed"); }
  }
  const items = result.ok ? parseTelegram(outputText(result.raw), input.messages.length, orgs, projects) : null;
  if (!items) {
    // 실패하면 아무것도 저장하지 않는다(설계 3.2절). 앱 스크립트가 다시 보낸다. 3번째 실패면 판정 실패로 센다.
    const code = result.ok ? "AI_INVALID_RESPONSE" : result.code.toUpperCase();
    deps.log("telegram_ai_failed", { stage: code });
    if (input.attempt >= 3) await addDay(db, ws, input.day, "telegram", counts(0, 1), nowMs);
    throw new Fail(result.ok ? 502 : result.code === "ai_timeout" ? 504 : 503, code);
  }
  let kept = 0;
  const judged = new Date(nowMs).toISOString();
  for (const [n, item] of items.entries()) {
    const first = input.messages[item.refs[0]];
    const raw = capBytes(rawLines(input.messages, item.refs), RAW_TEXT_BYTES);
    const r = await db.insert("app_feed_items", {
      workspace_id: ws, source: "telegram", day: input.day, occurred_at: new Date(first.at).toISOString(),
      room_key: input.room_key, room_label: input.room_label, title: item.title, summary: item.summary, points: [],
      speaker_split: false, raw_text: raw || null, raw_count: item.refs.length,
      organization_id: item.organization_id, suggested_project_id: item.suggested_project_id,
      source_ref: `${prefix}${n + 1}`, drive_url: null, model: config.model, judged_at: judged,
    });
    if (r === "ok") kept++;
  }
  await addDay(db, ws, input.day, "telegram", counts(kept), nowMs);
  return { ok: true, kept, personal: 0, unsure: 0, failed: 0, duplicate: false };
}

// ---- 입구 ----------------------------------------------------------------------------------------------------------

export function createCollectorFeedHandler(deps: CollectorFeedDeps) {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log: Log = deps.log ?? ((code, detail) => console.error(JSON.stringify({ fn: "collector-feed", code, ...(detail ?? {}) })));
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204 });
    if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    try {
      // 열쇠 확인이 맨 앞이다. 비밀값이 없거나 틀리면 몸통도 읽지 않는다.
      if (req.headers.get("authorization") !== null || FOREIGN_SECRET_HEADERS.some((h) => req.headers.get(h) !== null)) throw new Fail(401, "UNAUTHORIZED");
      if (!await secretMatches(req.headers.get(SECRET_HEADER), deps.env(SECRET_NAME))) throw new Fail(401, "UNAUTHORIZED");
      const sb = deps.env("SUPABASE_URL") ?? "", key = deps.env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(sb) || !key) throw new Fail(500, "SERVER_CONFIG_MISSING");
      let action: string | null = null;
      try { action = new URL(req.url).searchParams.get("action"); } catch { /* ignore */ }
      if (action !== "call" && action !== "call_skip" && action !== "telegram") throw new Fail(400, "UNKNOWN_ACTION");
      const length = Number(req.headers.get("content-length") || 0);
      if (length > MAX_BODY_BYTES) throw new Fail(413, "BODY_TOO_LARGE");
      let body: unknown;
      try { body = await readBoundedJson(req, { maxBytes: MAX_BODY_BYTES }); } catch { throw new Fail(400, "INVALID_BODY"); }
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Fail(400, "INVALID_BODY");
      const b = body as Record<string, unknown>;
      const nowMs = now(), today = kstDay(nowMs);
      // 몸통을 먼저 다 검사한 뒤에 DB에 간다.
      const input = action === "call" ? parseCallBody(b) : action === "call_skip" ? parseSkipBody(b, today) : parseTelegramBody(b, today);
      const db = makeDb(sb, key, doFetch);
      const ws = await workspaceId(db);
      const out = action === "call" ? await runCall(db, ws, input as CallInput, nowMs)
        : action === "call_skip" ? await runCallSkip(db, ws, input as SkipInput, nowMs)
        : await runTelegram(db, ws, input as TelegramInput, nowMs, { doFetch, sleep, log, env: deps.env });
      return json(out);
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
