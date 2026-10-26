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
//   app_call_personal(migration 20261025200000_call_personal_box) = 칸별 넣기 + 중복 확인 두 칸(workspace_id, source_ref) 읽기만. 전문 읽기·고치기·지우기 없음.
//   소식 줄 고치기·지우기·원문 읽기는 하지 않는다. 담당조직·프로젝트 목록과 업무공간 id는 읽기만 한다(drive-summary와 같은 읽기).
// 동작:
// - POST ?action=call: 통화 분석 파일(이미 Gemini가 만든 것) 읽기만. AI 없음. 업무면 업무 통화함(app_feed_items)에 저장.
//   개인·애매(CALL-개인통화함 2단계)는 요약·전문까지 개인 통화함(app_call_personal, 소유자만 읽는 별도 표)에 저장한다. 업무 표에는 넣지 않는다.
//   요약이 없는 옛 개인 기록·구분 없음은 개수만, 모양 다름은 판정 실패. 중복 확인은 두 표를 모두 본다(DB 트리거도 막는다).
// - POST ?action=call_skip: 옛 보내기 스크립트가 개인 번호·연락처 목록으로 거른 수(개수만). 새 스크립트는 목록 통화도 ?action=call로 보낸다. 옛 스크립트 호환용으로 남긴다.
// - POST ?action=telegram: 방 하나·하루치 묶음마다 AI 한 번(공용 모듈 _shared/openai-responses.ts). 실패·형식 틀림이면 아무것도 저장하지 않음.
//   선택 칸 `senders`(TG-발언자이름 2단계): 라벨별 [{label, key?, name?, self?}] 40명 이하. 형식 검사 뒤 DB 함수 app_tg_senders_upsert(service_role 전용)에 넘겨
//   이름표·방/날짜 연결을 남긴다. key는 앱 스크립트가 HMAC으로 바꾼 값(번호 원문은 오지 않음). 이름·키·self는 AI 재료·raw_text·응답·로그에 넣지 않는다.
//   칸이 없으면 지금과 똑같이 동작한다. 칸이 틀렸거나 DB 함수가 실패해도 소식 저장은 계속하고 로그에 단계 코드만 남긴다.
//   선택 칸 `chat_kind`(user|group|channel)·`chat_username`(@ 없는 아이디)·`open_ref`(그날 첫 메시지 열기 값)(TG-방날짜묶기 2단계, 설계 6·3절):
//   형식이 틀리면 그 칸만 null로 버린다(요청은 막지 않음). AI 답의 `day`(headline + lines 3~4줄)는 같은 AI 호출에서 함께 받는다(호출 수 그대로).
//   소식 저장 뒤 DB 함수 app_feed_room_touch → app_feed_room_day_add(service_role 전용)를 차례로 부른다. 소식이 한 줄도 저장되지 않았거나 day가 틀리면 부르지 않고,
//   실패해도 소식 저장은 이미 끝났으므로 계속한다. 로그에는 단계 코드(TGDG_*)만 남기고 방 이름·아이디·요약은 남기지 않는다.
// - 하루 숫자는 app_feed_days에 더한다. 받은 요청 수(batch_count)·AI 사용량(ai_*)은 받은 날(한국 날짜) 줄, 나머지는 내용 날짜 줄.
//   통화 숫자의 뜻(2단계 정리): total_count = 받은 전사 수(업무·개인함 저장·개수만 모두), kept_count = 업무 통화함에 저장한 줄,
//   personal_count·unsure_count = 줄 없이 **개수만** 센 통화(요약 없는 옛 개인 기록 등. 개인 통화함에 저장한 통화는 세지 않는다: 그 수는 개인 표의 실제 줄 수),
//   failed_count = 판정 실패.
// - POST ?action=context(CALL-맥락문서·CALL-맥락사람): 읽기 전용. 몸통은 `{}`만. 담당조직(쓰지 않음 제외)·진행 중 프로젝트의 **이름 문자열**과
//   "조직 — 이름 직함" 목록을 돌려준다(context.ts). 사람 목록은 읽기 전용 DB 함수 app_call_context_people(service_role 실행)만 부르고(표는 직접 읽지 않음),
//   함수가 없으면(404) 지금처럼 이름만 돌려준다. DB에 쓰지 않는다. 하루 20회 상한은 인스턴스 메모리로만 센다. 번호·메모·통화 내용·ID는 응답에 없다.
// 응답·로그에는 개수와 단계 코드만 넣는다. 원문·요약·이름·오류 원문은 넣지 않는다.
import { readBoundedJson } from "../_shared/bounded-json.mjs";
import { aiConfigFrom, callOpenAi, estimateKrw, isIncomplete, outputText, tokenCount } from "../_shared/openai-responses.ts";
import { organizationOptions, projectOptions } from "../ai-assist/library-fill.ts";
import { CALL_LIMITS, cleanLine, kstDay, type OrgRow, parseCall } from "./call-analysis.ts";
import { buildContext, CONTEXT_LIMITS, CONTEXT_PEOPLE_FN, CONTEXT_PEOPLE_ROWS } from "./context.ts";
import {
  parseTelegram, rawLines, TELEGRAM_INSTRUCTIONS, TELEGRAM_SCHEMA, telegramMaterial, TG_LIMITS, type TgDay, type TgMessage,
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
// 하루 상한(설계 4.4절): 받은 날 기준 통화 요청 200건, 텔레그램 묶음 150개(TG-방날짜묶기 결정 2: 80에서 올림, 밀린 방×날을 약 1주에 풀기 위함. 한 달 AI 상한 6,000원은 그대로). 넘으면 429.
// 통화는 업무·개인이 한 줄(app_feed_days 'call')에 합산된다. 개인 통화 내용까지 보내게 되어 50에서 올렸다
// (줄은 source 'call'·'telegram'만 허용하므로 업무·개인을 따로 세려면 DB 변경이 필요해 이번 단계에서는 올리기로 한다. 비밀값 인증 뒤의 남용 방지선이다).
export const DAILY_LIMITS = Object.freeze({ call: 200, telegram: 150 });
// 이 기능 한 달 AI 상한(Q7): 6,000원. ai-assist의 15,000원 상한과 따로 센다(app_feed_days.ai_*).
export const MONTHLY_LIMIT_KRW = 6000;
// 내용 날짜는 오늘(한국 날짜)부터 92일 전까지만 받는다(미래 날짜·오래된 날짜 거절).
export const MAX_PAST_DAYS = 92;

// AI 설정은 ai-assist와 같은 열쇠·모델·가격 기본값(설계 4.4절). 모델·가격은 _shared/ai-model.ts 한 곳.
export const OPENAI_URL = "https://api.openai.com/v1/responses";
export const KEY_NAME = "WEB2_OPENAI_API_KEY";
// 모델·가격 기본값은 _shared/ai-model.ts 한 곳(운영 값은 WEB2_AI_MODEL·WEB2_AI_PRICE_*로 바꿀 수 있음).
import { AI_REASONING_TOKEN_HEADROOM, DEFAULT_AI_MODEL, DEFAULT_PRICE_IN_KRW_PER_MTOK, DEFAULT_PRICE_OUT_KRW_PER_MTOK } from "../_shared/ai-model.ts";
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
const SENDER_KEY = /^[0-9a-f]{16,32}$/;
const SENDER_NAME_CHARS = 40;
const SENDERS_MAX = 40;
// 이름 칸에 전화번호·@아이디가 들어오면 이름만 버린다(수집기 계약상 오면 안 되는 값, 설계 4절).
const SENDER_NAME_REJECT = /^@|^\+?[\d\s().-]{7,}$/;
export const SENDERS_FN = "app_tg_senders_upsert";
export const NAMES_FN = "app_tg_sender_names_for_day";
// TG-방날짜묶기: 방 정보·하루 요약 DB 함수(migration 20261027010000, service_role 전용).
export const ROOM_TOUCH_FN = "app_feed_room_touch";
export const ROOM_DAY_ADD_FN = "app_feed_room_day_add";
const CHAT_KINDS = ["user", "group", "channel"];
const CHAT_USERNAME = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
const OPEN_REF = /^[A-Za-z0-9_.:@/-]{1,100}$/;
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

export type TgSender = { label: string; key?: string; name?: string; self?: boolean };
type TelegramInput = {
  day: string; room_key: string; room_label: string; total: number; part: number; attempt: number; messages: TgMessage[];
  senders: TgSender[]; sendersInvalid: boolean; sendersSkipped: number; oddDropped: number;
  chat_kind: string | null; chat_username: string | null; open_ref: string | null; roomInfoDropped: number;
};
// 선택 칸 chat_kind·chat_username·open_ref 검사. 틀린 칸은 null로 버리고 버린 칸 수만 센다(소식 저장 우선). 값은 어디에도 남기지 않는다.
function parseRoomInfo(b: Record<string, unknown>) {
  let dropped = 0;
  const pick = (name: string, ok: (v: string) => boolean, norm: (v: string) => string = (v) => v) => {
    const v = b[name];
    if (v === undefined || v === null) return null;
    const n = typeof v === "string" ? norm(v) : "";
    if (!n || !ok(n)) { dropped++; return null; }
    return n;
  };
  const chat_kind = pick("chat_kind", (v) => CHAT_KINDS.includes(v));
  const chat_username = pick("chat_username", (v) => CHAT_USERNAME.test(v), (v) => v.replace(/^@/, ""));
  const open_ref = pick("open_ref", (v) => OPEN_REF.test(v));
  return { chat_kind, chat_username, open_ref, dropped };
}
// 선택 칸 senders 검사. 어디가 틀렸든 요청 전체를 막지 않고 senders만 버린다(소식 저장 우선). 이름·키 값은 어디에도 남기지 않는다.
function parseSenders(raw: unknown, labelsInMessages: Set<string>) {
  const empty = { senders: [] as TgSender[], invalid: false, skipped: 0, oddDropped: 0 };
  if (raw === undefined) return empty;
  const bad = { ...empty, invalid: true };
  if (!Array.isArray(raw) || raw.length > SENDERS_MAX) return bad;
  const seen = new Set<string>();
  const out: TgSender[] = [];
  let skipped = 0, oddDropped = 0;
  for (const item of raw as unknown[]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return bad;
    const e = item as Record<string, unknown>;
    if (!exactKeys(e, ["label"], ["key", "name", "self"])) return bad;
    if (typeof e.label !== "string" || !SENDER.test(e.label) || seen.has(e.label)) return bad;
    seen.add(e.label);
    const entry: TgSender = { label: e.label };
    if (e.key !== undefined && e.key !== null) {
      if (typeof e.key !== "string" || !SENDER_KEY.test(e.key)) return bad;
      entry.key = e.key;
    }
    if (e.name !== undefined && e.name !== null) {
      if (typeof e.name !== "string" || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(e.name)) return bad;
      const name = e.name.normalize("NFC").trim();
      if (!name || [...name].length > SENDER_NAME_CHARS) return bad;
      if (SENDER_NAME_REJECT.test(name)) oddDropped++;
      else entry.name = name;
    }
    if (e.self !== undefined && e.self !== null) {
      if (typeof e.self !== "boolean") return bad;
      entry.self = e.self;
    }
    // 이 묶음의 메시지에 없는 라벨은 건너뛴다(묶음이 나뉘면 같은 목록이 모든 묶음에 오므로 오류가 아니다).
    if (!labelsInMessages.has(entry.label)) { skipped++; continue; }
    out.push(entry);
  }
  return { senders: out, invalid: false, skipped, oddDropped };
}
export function parseTelegramBody(b: Record<string, unknown>, today: string): TelegramInput {
  if (!exactKeys(b, ["day", "room_key", "room_label", "total", "messages"], ["part", "attempt", "senders", "chat_kind", "chat_username", "open_ref"])) throw new Fail(400, "INVALID_BODY");
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
  const sp = parseSenders(b.senders, new Set(messages.map((m) => m.sender)));
  const room = parseRoomInfo(b);
  return {
    day: b.day, room_key: b.room_key, room_label: label, total: b.total, part, attempt, messages,
    senders: sp.senders, sendersInvalid: sp.invalid, sendersSkipped: sp.skipped, oddDropped: sp.oddDropped,
    chat_kind: room.chat_kind, chat_username: room.chat_username, open_ref: room.open_ref, roomInfoDropped: room.dropped,
  };
}

// ---- DB(service role, 칸별 grant 안) ---------------------------------------------------------------------------------

type Db = {
  get: (path: string) => Promise<Record<string, unknown>[]>;
  insert: (table: string, row: Record<string, unknown>) => Promise<"ok" | "conflict">;
  patch: (path: string, body: Record<string, unknown>) => Promise<number>;
  // 읽기 전용 DB 함수 호출. 함수가 없으면(404) "missing", 그 밖의 실패는 503.
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ rows: Record<string, unknown>[] } | "missing">;
  // 쓰기 DB 함수 호출(결과가 jsonb 한 개). 던지지 않고 단계 코드만 돌려준다: 이름·키가 든 오류 본문은 코드 글자(TG_SENDER_*·TGDG_*)만 뽑고 버린다.
  rpcObject: (fn: string, args: Record<string, unknown>) => Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; code: string }>;
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
    async rpc(fn, args) {
      const r = await send(`rpc/${fn}`, { method: "POST", headers: { ...headers, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(args) });
      if (r.status === 404) { try { await r.body?.cancel(); } catch { /* ignore */ } return "missing"; }
      if (!r.ok) { try { await r.body?.cancel(); } catch { /* ignore */ } throw new Fail(503, "DB_READ_FAILED"); }
      let rows: unknown;
      try { rows = await readBoundedJson(r, { maxBytes: DB_RESPONSE_BYTES }); } catch { throw new Fail(503, "DB_READ_FAILED"); }
      if (!Array.isArray(rows)) throw new Fail(503, "DB_READ_FAILED");
      return { rows: rows as Record<string, unknown>[] };
    },
    async rpcObject(fn, args) {
      let r: Response;
      try { r = await send(`rpc/${fn}`, { method: "POST", headers: { ...headers, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(args) }); }
      catch { return { ok: false, code: "DB_UNAVAILABLE" }; }
      let value: unknown;
      try { value = await readBoundedJson(r, { maxBytes: DB_RESPONSE_BYTES }); } catch { value = null; }
      if (!r.ok) {
        if (r.status === 404) return { ok: false, code: "FN_MISSING" };
        const code = /TG_SENDER_[A-Z_]+|TGDG_[A-Z_]+/.exec(JSON.stringify(value ?? ""))?.[0];
        return { ok: false, code: code ?? `DB_STATUS_${r.status}` };
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, code: "DB_BAD_RESPONSE" };
      return { ok: true, value: value as Record<string, unknown> };
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
  const rows = await db.get(`app_suborganizations?workspace_id=eq.${ws}&deleted_at=is.null&select=id,workspace_id,name,aliases,active&order=name.asc&limit=500`); // TRASH-Edge거르기2: 휴지통 조직에는 소식을 붙이지 않는다
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

const callResult = (o: Partial<{ kept: number; personal: number; unsure: number; failed: number; duplicate: boolean; boxed: number }> = {}) =>
  ({ ok: true, kept: 0, personal: 0, unsure: 0, failed: 0, duplicate: false, boxed: 0, ...o });

async function runCall(db: Db, ws: string, input: CallInput, nowMs: number) {
  const today = kstDay(nowMs);
  await claimBatch(db, ws, today, "call", nowMs);
  // 같은 원본은 업무·개인 두 통화함을 통틀어 한 번만(DB 트리거도 막는다).
  const dup = await db.get(`app_feed_items?workspace_id=eq.${ws}&source=eq.call&source_ref=eq.${input.ref}&select=source_ref&limit=1`);
  if (dup.length) return callResult({ duplicate: true });
  const dupBox = await db.get(`app_call_personal?workspace_id=eq.${ws}&source_ref=eq.${input.ref}&select=source_ref&limit=1`);
  if (dupBox.length) return callResult({ duplicate: true });
  const parsed = parseCall(input, await readOrgs(db, ws), nowMs);
  const inRange = !!parsed.day && parsed.day <= today && parsed.day >= addDays(today, -MAX_PAST_DAYS);
  const day = inRange ? parsed.day! : today;
  // 녹음 날짜가 받는 범위(오늘부터 92일 전까지) 밖이면 업무여도 저장하지 않고 판정 실패로 센다.
  if (parsed.kind === "business" && !inRange) {
    await addDay(db, ws, day, "call", { total_count: 1, failed_count: 1 }, nowMs);
    return callResult({ failed: 1 });
  }
  if (parsed.kind === "personal" || parsed.kind === "unsure") {
    const flag = { personal: parsed.kind === "personal" ? 1 : 0, unsure: parsed.kind === "unsure" ? 1 : 0 };
    const box = parsed.box;
    if (box && inRange) {
      const result = await db.insert("app_call_personal", {
        workspace_id: ws, kind: parsed.kind, day: box.day, occurred_at: box.occurred_at, title: box.title, points: box.points,
        counterpart: box.counterpart, speaker_split: box.speaker_split,
        raw_text: box.raw_text === null ? null : capBytes(box.raw_text, RAW_TEXT_BYTES),
        source_ref: input.ref, drive_url: input.drive_url, model: box.model, judged_at: box.judged_at,
      });
      if (result === "conflict") return callResult({ duplicate: true });
      await addDay(db, ws, box.day, "call", { total_count: 1 }, nowMs);
      return callResult({ ...flag, boxed: 1 });
    }
    // 줄을 만들 재료가 없는 통화(요약 없는 옛 개인 기록 등)는 개수만 센다.
    await addDay(db, ws, day, "call", { total_count: 1, personal_count: flag.personal, unsure_count: flag.unsure }, nowMs);
    return callResult(flag);
  }
  if (parsed.kind === "failed") {
    await addDay(db, ws, day, "call", { total_count: 1, failed_count: 1 }, nowMs);
    return callResult({ failed: 1 });
  }
  const result = await db.insert("app_feed_items", {
    workspace_id: ws, source: "call", day, occurred_at: parsed.occurred_at, title: parsed.title, points: parsed.points,
    counterpart: parsed.counterpart, speaker_split: parsed.speaker_split,
    raw_text: parsed.raw_text === null ? null : capBytes(parsed.raw_text, RAW_TEXT_BYTES),
    raw_count: 0, organization_id: parsed.organization_id, source_ref: input.ref, drive_url: input.drive_url,
    model: parsed.model, judged_at: parsed.judged_at,
  });
  if (result === "conflict") return callResult({ duplicate: true });
  await addDay(db, ws, day, "call", { total_count: 1, kept_count: 1 }, nowMs);
  return callResult({ kept: 1 });
}

async function runCallSkip(db: Db, ws: string, input: SkipInput, nowMs: number) {
  await claimBatch(db, ws, kstDay(nowMs), "call", nowMs);
  await addDay(db, ws, input.day, "call", {
    total_count: input.personal + input.short, personal_count: input.personal, unsure_count: input.short,
  }, nowMs);
  return callResult({ personal: input.personal, unsure: input.short });
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

// 생각 토큰이 max_output_tokens에 포함되므로 답 몫(TG_LIMITS.maxOutputTokens)에 생각 여유를 더해 보낸다(다른 Edge 함수와 같음).
const TG_MAX_OUTPUT_TOKENS = TG_LIMITS.maxOutputTokens + AI_REASONING_TOKEN_HEADROOM;

// 이름표 저장(TG-발언자이름 2단계). 실패해도 던지지 않는다: 소식 저장이 우선이고, 로그에는 개수와 단계 코드만 남긴다.
async function saveSenders(db: Db, ws: string, input: TelegramInput, log: Log) {
  if (input.sendersInvalid) { log("telegram_senders_dropped", { stage: "INVALID" }); return; }
  if (input.oddDropped) log("telegram_senders_name_dropped", { count: input.oddDropped });
  if (!input.senders.length) return;
  try {
    const r = await db.rpcObject(SENDERS_FN, { p_workspace: ws, p_room_key: input.room_key, p_day: input.day, p_senders: input.senders });
    if (!r.ok) { log("telegram_senders_failed", { stage: r.code }); return; }
    log("telegram_senders_saved", { people: num(r.value.people), linked: num(r.value.linked), conflicts: num(r.value.conflicts), skipped: input.sendersSkipped });
  } catch { log("telegram_senders_failed", { stage: "INTERNAL" }); }
}

// 방 정보·하루 요약 저장(TG-방날짜묶기 2단계). 소식 저장 뒤에 부른다. 실패해도 던지지 않는다: 소식은 이미 저장됐고, 로그에는 단계 코드만 남긴다.
// touch가 실패해도 day_add는 따로 시도한다(서로 다른 표). 방 이름·아이디·요약·열기 값은 로그에 넣지 않는다.
async function saveRoomDay(db: Db, ws: string, input: TelegramInput, batch: string, day: TgDay | null, log: Log) {
  if (input.roomInfoDropped) log("telegram_room_info_dropped", { count: input.roomInfoDropped });
  try {
    const r = await db.rpcObject(ROOM_TOUCH_FN, {
      p_workspace: ws, p_room_key: input.room_key, p_room_label: input.room_label, p_chat_kind: input.chat_kind, p_chat_username: input.chat_username,
    });
    if (!r.ok) log("telegram_room_touch_failed", { stage: r.code });
  } catch { log("telegram_room_touch_failed", { stage: "INTERNAL" }); }
  if (!day) return;
  try {
    const part: Record<string, unknown> = { batch, first_at: new Date(input.messages[0].at).toISOString(), lines: day.lines };
    if (day.headline) part.headline = day.headline;
    if (input.open_ref) part.open_ref = input.open_ref;
    const r = await db.rpcObject(ROOM_DAY_ADD_FN, { p_workspace: ws, p_room_key: input.room_key, p_day: input.day, p_part: part });
    if (!r.ok) log("telegram_room_day_failed", { stage: r.code });
  } catch { log("telegram_room_day_failed", { stage: "INTERNAL" }); }
}

// AI 재료용 표시 이름(읽기 전용 DB 함수 app_tg_sender_names_for_day로 조회): 손 이름(name) → "나"(is_self) → 이번 요청 senders의 name → 라벨 그대로(TG-발언자이름 결정 3, 10/27 변경).
// 이름표 조회(그 방·그날 라벨만)가 실패하면 요청의 name으로 물러나고 소식 저장은 계속한다. 이름은 로그에 남기지 않는다(AI 입력에만).
const cleanName = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").trim().normalize("NFC") : "");
async function senderNames(db: Db, ws: string, input: TelegramInput, log: Log) {
  const out = new Map<string, string>();
  const labels = new Set(input.messages.map((m) => m.sender));
  const stored = new Map<string, { name: string; self: boolean }>();
  try {
    // 읽기 전용 DB 함수(service_role 전용). 표는 직접 읽지 않는다. 함수가 아직 없으면(404) 요청 이름·라벨로 물러난다.
    const res = await db.rpc(NAMES_FN, { p_workspace: ws, p_room_key: input.room_key, p_day: input.day });
    if (res === "missing") log("telegram_sender_names_failed", { stage: "FN_MISSING" });
    else for (const r of res.rows) {
      const label = typeof r.label === "string" ? r.label : "";
      if (!labels.has(label)) continue;
      stored.set(label, { name: cleanName(r.name), self: r.is_self === true });
    }
  } catch { log("telegram_sender_names_failed", { stage: "READ" }); }
  const fromRequest = new Map(input.senders.map((s) => [s.label, s]));
  for (const label of labels) {
    const st = stored.get(label), rq = fromRequest.get(label);
    const name = (st?.name ? [...st.name].slice(0, 40).join("") : "") || (st?.self || rq?.self ? "나" : "") || rq?.name || "";
    if (name) out.set(label, name);
  }
  return out;
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
  // 이름표는 소식 저장·AI와 별개로 먼저 시도한다(다시 온 묶음·글 없는 묶음에서도 같은 값이라 다시 해도 안전).
  await saveSenders(db, ws, input, deps.log);
  // 같은 묶음이 다시 오면 AI를 다시 부르지 않는다(저장 전에 먼저 확인).
  const dup = await db.get(`app_feed_items?workspace_id=eq.${ws}&source=eq.telegram&source_ref=like.${encodeURIComponent(prefix)}*&select=source_ref&limit=1`);
  if (dup.length) return callResult({ duplicate: true });
  // 글 있는 메시지가 없으면 AI에 보내지 않고 개수만 더한다(설계 3.2절).
  if (!input.messages.length) {
    await addDay(db, ws, input.day, "telegram", counts(0), nowMs);
    return callResult();
  }
  const config = aiConfigFrom(deps.env, { keyName: KEY_NAME, model: DEFAULT_MODEL, priceIn: DEFAULT_PRICE_IN_KRW_PER_MTOK, priceOut: DEFAULT_PRICE_OUT_KRW_PER_MTOK });
  if (!config) throw new Fail(503, "AI_NOT_CONFIGURED");
  const used = await monthUsage(db, ws, nowMs);
  if (estimateKrw(used.input, used.output, config.price) >= MONTHLY_LIMIT_KRW) throw new Fail(429, "AI_MONTHLY_LIMIT");

  const orgs = organizationOptions(await readOrgs(db, ws));
  const projects = projectOptions(await db.get(`app_spaces?workspace_id=eq.${ws}&deleted_at=is.null&select=id,name,parent_id,status,metadata&order=sort_order.asc,created_at.asc&limit=500`));
  // 한 방·하루가 여러 묶음이면(둘째 묶음부터, 또는 보낸 메시지가 하루 전체보다 적을 때) 요약을 그 묶음 몫으로 쓰게 한다(설계 3.2절).
  const names = await senderNames(db, ws, input, deps.log);
  const material = telegramMaterial(input.day, input.room_label, input.messages, orgs, projects, input.part > 1 || input.total > input.messages.length, names);
  // 부르기 전에 횟수를 먼저 센다(ai-assist와 같음).
  await addDay(db, ws, today, "telegram", { ai_requests: 1 }, nowMs);
  const result = await callOpenAi({ doFetch: deps.doFetch, sleep: deps.sleep, log: deps.log }, config.key, {
    model: config.model,
    store: false,
    max_output_tokens: TG_MAX_OUTPUT_TOKENS,
    input: [
      { role: "developer", content: TELEGRAM_INSTRUCTIONS },
      { role: "user", content: material },
    ],
    text: { format: { type: "json_schema", name: "telegram_feed", strict: true, schema: TELEGRAM_SCHEMA } },
  }, { url: OPENAI_URL, timeoutMs: OPENAI_TIMEOUT_MS, retryDelayMs: RETRY_DELAY_MS, maxResponseBytes: OPENAI_RESPONSE_BYTES });
  const usage = result.ok ? result.usage : result.charged ? { input: [...material].length * 2, output: TG_MAX_OUTPUT_TOKENS } : { input: 0, output: 0 };
  if (usage.input || usage.output) {
    try { await addDay(db, ws, today, "telegram", { ai_input_tokens: tokenCount(usage.input), ai_output_tokens: tokenCount(usage.output) }, nowMs); }
    catch { deps.log("usage_record_failed"); }
  }
  const text = result.ok ? outputText(result.raw) : null;
  const parsedAi = result.ok ? parseTelegram(text, input.messages.length, orgs, projects) : null;
  if (!parsedAi) {
    // 실패하면 아무것도 저장하지 않는다(설계 3.2절). 앱 스크립트가 다시 보낸다. 3번째 실패면 판정 실패로 센다.
    const code = result.ok ? "AI_INVALID_RESPONSE" : result.code.toUpperCase();
    // 로그에는 단계 코드만 남긴다. 생각 토큰 소진(incomplete)이면 따로 알아볼 수 있게 한다.
    const stage = result.ok && isIncomplete(result.raw) ? "AI_INCOMPLETE" : code;
    deps.log("telegram_ai_failed", { stage });
    if (input.attempt >= 3) await addDay(db, ws, input.day, "telegram", counts(0, 1), nowMs);
    throw new Fail(result.ok ? 502 : result.code === "ai_timeout" ? 504 : 503, code);
  }
  const items = parsedAi.items;
  if (parsedAi.dropped || parsedAi.unlinked) deps.log("telegram_items_adjusted", { dropped: parsedAi.dropped, unlinked: parsedAi.unlinked });
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
  // 소식이 실제로 저장된 방·날만 방 정보와 요약을 남긴다(DB 함수도 소식이 있어야 받는다).
  if (kept > 0) await saveRoomDay(db, ws, input, batch, parsedAi.day, deps.log);
  return callResult({ kept });
}

// ---- 입구 ----------------------------------------------------------------------------------------------------------

export function createCollectorFeedHandler(deps: CollectorFeedDeps) {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log: Log = deps.log ?? ((code, detail) => console.error(JSON.stringify({ fn: "collector-feed", code, ...(detail ?? {}) })));
  const contextUse = { day: "", n: 0 };
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
      if (action !== "call" && action !== "call_skip" && action !== "telegram" && action !== "context") throw new Fail(400, "UNKNOWN_ACTION");
      const length = Number(req.headers.get("content-length") || 0);
      if (length > MAX_BODY_BYTES) throw new Fail(413, "BODY_TOO_LARGE");
      let body: unknown;
      try { body = await readBoundedJson(req, { maxBytes: MAX_BODY_BYTES }); } catch { throw new Fail(400, "INVALID_BODY"); }
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Fail(400, "INVALID_BODY");
      const b = body as Record<string, unknown>;
      const nowMs = now(), today = kstDay(nowMs);
      if (action === "context") {
        if (!exactKeys(b, [])) throw new Fail(400, "INVALID_BODY");
        if (contextUse.day !== today) { contextUse.day = today; contextUse.n = 0; }
        if (contextUse.n >= CONTEXT_LIMITS.dailyCalls) throw new Fail(429, "DAILY_LIMIT");
        contextUse.n++;
        const cdb = makeDb(sb, key, doFetch);
        const cws = await workspaceId(cdb);
        const orgs = await readOrgs(cdb, cws);
        const spaces = await cdb.get(`app_spaces?workspace_id=eq.${cws}&deleted_at=is.null&select=id,name,parent_id,status,metadata&order=sort_order.asc,created_at.asc&limit=500`);
        // CALL-맥락사람: 사람 목록은 읽기 전용 DB 함수에서만 받는다. 함수가 아직 없으면(DB 적용 전) 이름만 돌려준다.
        const found = await cdb.rpc(CONTEXT_PEOPLE_FN, { p_workspace: cws, p_limit: CONTEXT_PEOPLE_ROWS });
        const ctx = buildContext(orgs, spaces, found === "missing" ? [] : found.rows);
        log("context_served", { organizations: ctx.organizations.length, projects: ctx.projects.length, people: ctx.people.length, people_fn: found === "missing" ? "missing" : "ok" });
        return json({ ok: true, ...ctx });
      }
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
