// 예약 열쇠 지문 확인(NEWS-전면개편 P1c, 설계 docs/design/news-overhaul.md 3.2절 '나'안 4번).
//
// DB 예약(pg_cron)은 금고 값을 요청 헤더에 넣어 보낸다. Edge는 그 값을 모르고, 지문(SHA-256 64자 16진)만
// service role로 `public.app_cron_keys`에서 읽어 헤더 값의 지문과 고정 길이로 비교한다(migration 20261106040000:
// RLS 켬·정책 없음·service_role select만).
// - 지문 행이 없거나, 표를 못 읽거나, 모양이 틀리면 false(이 길만 실패 — 부르는 쪽의 지금 비밀값 길은 따로 계속 된다).
// - 로그·응답에 헤더 값·지문을 남기지 않는다. 로그는 단계 코드만.
import { readBoundedJson } from "./bounded-json.mjs";

export const FEED_CRON_KEY_NAME = "web2_feed_cron";
export const CRON_KEY_MIN_CHARS = 32;
export const CRON_KEY_MAX_CHARS = 4096;
const KEY_NAME_RE = /^web2_[a-z0-9_]{1,40}$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const READ_TIMEOUT_MS = 5000;
const READ_MAX_BYTES = 4096;

export type CronKeyDeps = {
  sb: string;
  serviceKey: string;
  doFetch: typeof fetch;
  log?: (code: string, detail?: Record<string, unknown>) => void;
};

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

// 같은 길이(64자)끼리 끝까지 비교한다.
function sameHex(a: string, b: string) {
  if (a.length !== 64 || b.length !== 64) return false;
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readFingerprint(deps: CronKeyDeps, name: string): Promise<string | null> {
  const { sb, serviceKey, doFetch } = deps;
  const log = deps.log ?? (() => {});
  if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(sb) || !serviceKey) { log("cron_key_config_missing"); return null; }
  let r: Response;
  try {
    r = await doFetch(`${sb}/rest/v1/app_cron_keys?select=secret_sha256&name=eq.${encodeURIComponent(name)}&limit=1`, {
      method: "GET",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
  } catch {
    log("cron_key_read_failed");
    return null;
  }
  if (!r.ok) {
    try { await r.body?.cancel(); } catch { /* ignore */ }
    log("cron_key_read_failed", { status: r.status });
    return null;
  }
  let rows: unknown;
  try { rows = await readBoundedJson(r, { maxBytes: READ_MAX_BYTES }); } catch { log("cron_key_read_failed"); return null; }
  if (!Array.isArray(rows) || rows.length !== 1) { log("cron_key_missing"); return null; }
  const v = (rows[0] as Record<string, unknown> | null)?.secret_sha256;
  if (typeof v !== "string" || !SHA_RE.test(v)) { log("cron_key_invalid"); return null; }
  return v;
}

// 헤더 값의 SHA-256이 app_cron_keys(name)의 지문과 같은지. 맞으면 true, 그 밖(없음·못 읽음·틀림)은 모두 false.
export async function cronKeyMatches(given: string | null, deps: CronKeyDeps, name: string = FEED_CRON_KEY_NAME): Promise<boolean> {
  if (!KEY_NAME_RE.test(name)) return false;
  if (typeof given !== "string" || given.length < CRON_KEY_MIN_CHARS || given.length > CRON_KEY_MAX_CHARS) return false;
  const expected = await readFingerprint(deps, name);
  if (expected === null) return false;
  const actual = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(given)));
  return sameHex(actual, expected);
}
