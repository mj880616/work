// note-import: 노트 '주소로 가져오기' 서버 입구(설계 docs/design/note-import-by-url.md, 1단계 — 글자만).
//
// 하는 일은 하나다: 로그인한 사람이 준 주소 하나를 읽어 제목·사이트·저자·날짜·본문(글자 블록)을 돌려준다.
// 읽기 전용이다 — 노트는 화면이 기존 저장 길로 만든다. 이 함수는 노트 표·다른 표에 쓰지 않는다(하루 횟수 한 칸만 더한다).
//
// 누가(verify_jwt=true + 함수 코드에서 다시 확인, news-feed 화면 입구와 같은 방식):
// - Authorization: Bearer <사용자 로그인>을 Auth 서버(/auth/v1/user)로 확인한다.
// - 그 사람이 owner인 작업공간 행이 정확히 하나일 때만 받는다. 작업공간은 서버가 정한다.
//   몸통은 {url} 하나뿐이고, 화면이 보낸 작업공간·사용자 값은 받지 않는다(다른 키가 있으면 400).
// 무엇을 읽나(안전 범위, guard.ts):
// - https만. 숫자 IP·localhost·내부 이름·Supabase 호스트·포트·아이디/비밀번호가 든 주소는 읽지 않는다(_shared/news-url.ts 열린 주소 규칙 그대로).
// - 요청을 보내기 직전마다 이름을 풀어, 풀린 주소가 하나라도 사설·루프백·링크로컬·메타데이터·예약 대역이면 보내지 않는다.
//   robots.txt·리다이렉트 단계도 같은 확인을 지난다(공용 읽기 _shared/feed-fetch.ts의 doFetch를 감쌈).
//   이름 풀이 기능이 없는 런타임이면 읽지 않고 503 LOOKUP_UNAVAILABLE(닫힌 쪽으로 실패).
// - 리다이렉트 3번·응답 2MB·요청 10초(공용 읽기 상한) + 가져오기 전체 TOTAL_TIMEOUT_MS. 쿠키·인증 헤더 없음, 정직한 User-Agent.
// - robots.txt가 막으면 읽지 않는다. 봇 확인 쪽·유료벽은 넘지 않는다(유료 기사는 공개 리드만).
// - 글자 판(html·xhtml·text)만 받는다. HTML은 돌려주지 않고 글자 블록만 돌려준다. 본문은 노트 글자 상한 안으로 자른다.
// 하루 횟수: 작업공간 하루 사용량 표 app_news_days의 fetch_n 칸을 뉴스 기사 열기와 함께 쓴다(NOTE_IMPORT_DAILY, DB 변경 없음).
// 가져온 글은 돌려주기만 한다. AI에 넘기거나 발송·공유로 잇지 않는다.
// 서비스 역할로 닿는 곳: app_workspace_members(owner 확인 읽기) · app_news_days(읽기·넣기·고치기) 둘뿐(makeDb가 다른 표를 거절).
// 로그·응답: 코드와 숫자만. 주소·제목·본문·풀린 IP·오류 원문을 싣지 않는다.
import { ACCEPT_HTML, makeFeedReader, type FeedLog } from "../_shared/feed-fetch.ts";
import { OPEN_ARTICLE_KEY, OPEN_ARTICLE_RULE } from "../_shared/news-catalog.ts";
import { textBlocks } from "../_shared/feed-extract.ts";
import { readBoundedJson } from "../_shared/bounded-json.mjs";
import { takeDaily, type DayDb } from "../_shared/news-days.ts";
import { guessLang, readArticlePage } from "../news-feed/page.ts";
import { makeGuardedFetch, newGuardState, noteImportUrl, type GuardState, type Resolve } from "./guard.ts";
import { noteBody, readAuthor, textKind, type NoteBlock } from "./article.ts";

export type Env = (name: string) => string | undefined;
export type NoteImportDeps = {
  env: Env;
  resolve: Resolve;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: FeedLog;
  totalTimeoutMs?: number;
};

export const USER_AGENT = "Web2NoteImport/1.0 (+https://github.com/mj880616/work/blob/main/docs/design/note-import-by-url.md)";
export const ROBOTS_AGENT = "Web2NoteImport";
export const GAP_MS = 1000;            // 같은 사이트에 잇달아 보내는 요청 사이(robots.txt → 글)
export const NOTE_IMPORT_DAILY = 60;   // 작업공간 하루 횟수(fetch_n 칸 — 뉴스 기사 열기와 함께 센다)
export const TOTAL_TIMEOUT_MS = 25000; // 가져오기 한 번 전체 시간
export const MAX_BODY_BYTES = 4096;

export type FailReason =
  | "blocked" | "robots" | "too_big" | "timeout" | "not_found" | "http_error" | "redirect" | "unreachable"
  | "not_text" | "bot_check" | "paywall" | "no_body";
export type ImportResult = {
  ok: true;
  state: "ok" | "lead" | "failed";
  reason: FailReason | "lead_only" | null;
  url: string | null;          // 실제로 읽은 주소(리다이렉트 뒤). 읽지 못했으면 null
  title: string | null;
  site: string | null;
  author: string | null;
  published_at: string | null;
  lang: string | null;
  blocks: NoteBlock[];
  chars: number;
  truncated: boolean;
};

const cors = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
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
type Row = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- DB(service role, PostgREST) — 이 함수가 닿는 표 둘만 ------------------------------------------------------------
const TABLES = /^(?:app_workspace_members|app_news_days)(?:\?|$)/;
function makeDb(sb: string, key: string, doFetch: typeof fetch): DayDb {
  async function call(method: string, path: string, body?: unknown, prefer?: string): Promise<Row[]> {
    if (!TABLES.test(path)) throw new Fail(500, "INTERNAL_ERROR");
    let r: Response;
    try {
      r = await doFetch(`${sb}/rest/v1/${path}`, {
        method, signal: AbortSignal.timeout(20000), body: body === undefined ? undefined : JSON.stringify(body),
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
      });
    } catch { throw new Fail(503, "STORE_UNAVAILABLE"); }
    if (!r.ok) { try { await r.body?.cancel(); } catch { /* ignore */ } throw new Fail(503, "STORE_UNAVAILABLE"); }
    if (r.status === 204 || (prefer ?? "").includes("return=minimal")) { try { await r.body?.cancel(); } catch { /* ignore */ } return []; }
    let v: unknown;
    try { v = await readBoundedJson(r, { maxBytes: 256 * 1024 }); } catch { throw new Fail(503, "STORE_UNAVAILABLE"); }
    return Array.isArray(v) ? v as Row[] : (v && typeof v === "object" ? [v as Row] : []);
  }
  return { get: (p) => call("GET", p), send: (m, p, b, pr) => call(m, p, b, pr) };
}

// ---- 로그인 + owner(작업공간은 서버가 정한다) --------------------------------------------------------------------------
async function authorizeUser(sb: string, key: string, jwt: string, doFetch: typeof fetch, db: DayDb): Promise<{ userId: string; workspaceId: string }> {
  let r: Response;
  try { r = await doFetch(`${sb}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${jwt}` }, signal: AbortSignal.timeout(10000) }); }
  catch { throw new Fail(503, "AUTH_UNAVAILABLE"); }
  if (r.status >= 500) { try { await r.body?.cancel(); } catch { /* ignore */ } throw new Fail(503, "AUTH_UNAVAILABLE"); }
  let user: Row | null = null;
  try { user = await readBoundedJson(r, { maxBytes: 256 * 1024 }) as Row; } catch { user = null; }
  if (!r.ok || typeof user?.id !== "string" || !UUID.test(user.id)) throw new Fail(401, "UNAUTHORIZED");
  const members = await db.get(`app_workspace_members?user_id=eq.${user.id}&role=eq.owner&select=workspace_id`);
  const ws = members.length === 1 ? members[0].workspace_id : null;
  if (typeof ws !== "string" || !UUID.test(ws)) throw new Fail(403, "FORBIDDEN");
  return { userId: user.id, workspaceId: ws };
}

// ---- 결과 ----------------------------------------------------------------------------------------------------------
type Meta = Pick<ImportResult, "url" | "title" | "site" | "author" | "published_at" | "lang">;
const NO_META: Meta = { url: null, title: null, site: null, author: null, published_at: null, lang: null };
const failed = (reason: FailReason, meta: Meta = NO_META): ImportResult =>
  ({ ok: true, state: "failed", reason, ...meta, blocks: [], chars: 0, truncated: false });

// 읽기 실패 코드(공용 읽기) → 화면에 줄 까닭.
// - 주소 모양 때문에 막은 것이 하나라도 있으면(리다이렉트가 가리킨 곳 포함) 늘 blocked.
// - 이름 풀이에서 멈춘 것(안쪽 주소로 풀림·못 풂)은 둘 다 unreachable로만 알린다(서버에서 본 풀이 결과를 가르지 않음).
export function failReason(code: string, guard: GuardState, expired: boolean): FailReason {
  if (guard.shape) return "blocked";
  if (guard.private || guard.unresolved || guard.unavailable) return "unreachable";
  if (expired) return "timeout";
  if (code === "url_outside" || code === "redirect_outside") return "blocked";
  if (code === "robots" || code === "robots_denied") return "robots";
  if (code === "too_large") return "too_big";
  if (code === "timeout") return "timeout";
  if (code === "redirect_loop") return "redirect";
  const http = /^http_(\d{3})$/.exec(code)?.[1];
  if (http) return http === "404" || http === "410" ? "not_found" : "http_error";
  return "unreachable"; // 연결 실패 · robots.txt를 못 읽음
}
const lookupCode = (g: GuardState) => g.unavailable ? "unavailable" : g.private ? "private" : g.unresolved ? "unresolved" : "ok";

// 읽어 온 글 → 결과. 순수 함수(시험용으로 내보냄).
export function buildResult(got: { text: string; url: string; contentType: string | null }, nowMs: number): ImportResult {
  const kind = textKind(got.contentType);
  if (!kind) return failed("not_text");
  if (kind === "plain") {
    const body = noteBody(textBlocks(got.text, { key: "note-text", rule: { version: 1 }, minChars: 1 }).blocks);
    if (!body.blocks.length) return failed("no_body");
    return { ok: true, state: "ok", reason: null, ...NO_META, url: got.url, lang: guessLang(got.text), ...body };
  }
  const page = readArticlePage(got.text, nowMs, { key: OPEN_ARTICLE_KEY, rule: OPEN_ARTICLE_RULE, base: got.url });
  if (page.state === "bot_check") return failed("bot_check");
  const author = readAuthor(got.text);
  const meta: Meta = {
    url: got.url, title: page.title, site: page.publisher,
    author: author && author !== page.publisher ? author : null,
    published_at: page.published_at, lang: page.lang,
  };
  const body = noteBody(page.blocks.blocks);
  if (!body.blocks.length) return failed(page.state === "paywall" ? "paywall" : "no_body", meta);
  if (page.state === "paywall") return { ok: true, state: "lead", reason: "paywall", ...meta, ...body };
  if (page.blocks.state !== "ok") return { ok: true, state: "lead", reason: "lead_only", ...meta, ...body };
  return { ok: true, state: "ok", reason: null, ...meta, ...body };
}

export function createNoteImportHandler(deps: NoteImportDeps) {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log: FeedLog = deps.log ?? ((code, detail) => console.error(JSON.stringify({ fn: "note-import", code, ...(detail ?? {}) })));
  const totalMs = deps.totalTimeoutMs ?? TOTAL_TIMEOUT_MS;
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      const auth = req.headers.get("authorization") ?? "";
      const bearer = /^Bearer ([A-Za-z0-9._-]{20,4096})$/.exec(auth);
      if (!bearer) throw new Fail(401, "UNAUTHORIZED");
      if (req.method !== "POST") throw new Fail(405, "METHOD_NOT_ALLOWED");
      const sb = deps.env("SUPABASE_URL") ?? "", key = deps.env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(sb) || !key) throw new Fail(500, "SERVER_CONFIG_MISSING");
      const db = makeDb(sb, key, doFetch);
      // 로그인·owner 확인이 먼저다. 그 전에는 몸통을 읽지 않는다.
      const who = await authorizeUser(sb, key, bearer[1], doFetch, db);

      if (Number(req.headers.get("content-length") || 0) > MAX_BODY_BYTES) throw new Fail(413, "BODY_TOO_LARGE");
      let body: unknown;
      try { body = await readBoundedJson(req, { maxBytes: MAX_BODY_BYTES }); } catch { throw new Fail(400, "INVALID_BODY"); }
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Fail(400, "INVALID_BODY");
      const keys = Object.keys(body as Row);
      const raw = (body as Row).url;
      if (keys.length !== 1 || keys[0] !== "url" || typeof raw !== "string" || !raw.trim()) throw new Fail(400, "INVALID_BODY");

      // 주소 모양이 규칙 밖이면 아무 데도 묻지 않고 끝낸다(이름 풀이·요청·횟수 없음).
      const start = noteImportUrl(raw);
      if (!start) { log("import", { state: "failed", reason: "blocked" }); return json(failed("blocked")); }

      const nowMs = now();
      if (!await takeDaily(db, who.workspaceId, "fetch_n", NOTE_IMPORT_DAILY, nowMs)) throw new Fail(429, "DAILY_LIMIT");

      const guard = newGuardState();
      const stop = new AbortController();
      const timer = setTimeout(() => stop.abort(), totalMs);
      let out: ImportResult;
      try {
        // 리다이렉트가 규칙 밖 주소를 가리키면(공용 읽기가 allow로 거름) 그것도 '막음'으로 남긴다 — robots.txt 단계 포함.
        const allow = (next: string) => { const u = noteImportUrl(next); if (!u) guard.shape = true; return u; };
        const reader = makeFeedReader({
          doFetch: makeGuardedFetch(doFetch, deps.resolve, guard, { stop: stop.signal }),
          sleep, log, now, userAgent: USER_AGENT, robotsAgent: ROBOTS_AGENT, gapMs: GAP_MS, allow,
        });
        const got = await reader.get(start.href, ACCEPT_HTML);
        const stopped = guard.shape || guard.private || guard.unresolved || guard.unavailable;
        // 가는 길에 하나라도 막았으면 읽은 글이 있어도 돌려주지 않는다.
        if (!got.ok || stopped) out = failed(failReason(got.ok ? "" : got.code, guard, stop.signal.aborted));
        else out = buildResult(got, nowMs);
      } finally {
        clearTimeout(timer);
      }
      log("import", { state: out.state, reason: out.reason, lookup: lookupCode(guard), blocks: out.blocks.length, chars: out.chars, truncated: out.truncated });
      // 이름 풀이 기능이 없으면 주소 탓이 아니라 서버 탓이다 — 코드로 알린다(확인 없이 읽지는 않았다).
      if (guard.unavailable) throw new Fail(503, "LOOKUP_UNAVAILABLE");
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
