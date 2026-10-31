// outside-feed: 바깥 성명 수집기(OUTSIDE-바깥성명 ③, 설계 docs/design/outside-statements.md 3.2~3.4·6절, DB migration 20261031230000).
//
// 입구 두 개(verify_jwt=false, 함수 코드가 막음 — collector-feed·drive-summary 예약과 같은 방식):
// - 예약 입구(`run_plan`·`run`): `x-outside-feed-cron-secret` 헤더를 비밀값 OUTSIDE_FEED_CRON_SECRET(32자 이상)과 SHA-256 고정 길이 비교.
//   비밀값이 없거나 짧거나 틀리면 401. 어느 작업공간에 넣을지는 서버가 app_outside_sources.enabled로 정한다(요청 값 안 받음).
// - 화면 입구(`catalog`·`expand`): 사용자 로그인(Authorization)을 Auth 서버로 확인 + 그 사람이 작업공간 owner인지 서버에서 확인.
//   두 입구의 열쇠가 함께 오거나, 다른 기능의 비밀 헤더가 붙으면 401. 열쇠가 하나도 없으면 401.
// 읽는 주소: _shared/outside-catalog.ts 고정 목록의 허용 호스트만(요청 몸통·화면은 단체 키만 보냄 — SSRF 차단).
//   리다이렉트도 같은 단체 허용 호스트만, 응답 2MB·10초 상한, GET만. robots.txt를 먼저 읽고 막힌 경로는 건너뛴다(last_error='robots').
// 저장(2절 경계): 국내 글 = 제목·종류·시각·원문 주소·AI 한 문장 요약·본문 문장(2년 지난 글은 문장 없이). 외국 글 = 제목·한국어 제목·
//   한국어 요약·핵심 문장 3개까지(원문+번역). 외국 글 본문·전문 번역은 저장하지 않는다(AI 재료로 한 번 쓰고 버림).
// DB는 service role로 migration 20261031230000의 grant(네 표 select·insert·update·delete) 안에서만 쓴다. 다른 표는 owner 확인용
//   app_workspace_members 읽기뿐이다. 로그·응답에는 단계 코드·건수·단체 키만(제목·본문·주소 없음).
import { allowedUrl, OUTSIDE_CATALOG, publicCatalog, sourceByKey, type OutsideSource } from "../_shared/outside-catalog.ts";
import { aiConfigFrom, callOpenAi, outputText, type Env, type Log } from "../_shared/openai-responses.ts";
import { AI_REASONING_TOKEN_HEADROOM, AI_TONE_RULE, DEFAULT_AI_MODEL, DEFAULT_PRICE_IN_KRW_PER_MTOK, DEFAULT_PRICE_OUT_KRW_PER_MTOK } from "../_shared/ai-model.ts";
import { readBoundedJson } from "../_shared/bounded-json.mjs";
import { cut, decodeBody, extractBody, oneLine, parseFeed, parseListHtml, robotsAllows, splitSentences, textDate, type ListItem } from "./parse.ts";

export type OutsideFeedDeps = { env: Env; fetch?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void>; log?: Log };

export const CRON_HEADER = "x-outside-feed-cron-secret";
export const SECRET_NAME = "OUTSIDE_FEED_CRON_SECRET";
export const SECRET_MIN_CHARS = 32;
const FOREIGN_SECRET_HEADERS = ["x-drive-summary-cron-secret", "x-collector-feed-secret", "x-collector-heartbeat-secret"];
export const USER_AGENT = "Web2OutsideFeed/1.0 (+https://github.com/mj880616/work/blob/main/docs/design/outside-statements.md)";
export const ROBOTS_AGENT = "Web2OutsideFeed";
export const FETCH_MAX_BYTES = 2 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 10000;
export const MAX_REDIRECTS = 3;
export const LIST_LIMIT = 20;          // 목록에서 보는 글 수(첫 쪽)
export const MAX_NEW_PER_RUN = 8;      // 한 번 실행에 단체마다 새로 읽는 글 수(나머지는 다음 실행)
export const GAP_MS = 2000;            // 같은 사이트 요청 사이
export const RUN_BUDGET_MS = 100000;   // 한 번 실행 시간 예산(Edge 제한 안쪽)
export const OLD_DAYS = 730;           // 2년 지난 글은 문장 없이(Q7)
export const PRUNE_BATCH = 200;
export const EXPAND_DAILY_PER_USER = 100;
export const MAX_BODY_BYTES = 4096;
const OPENAI_URL = "https://api.openai.com/v1/responses";
const KEY_NAME = "WEB2_OPENAI_API_KEY";
const AI_TIMEOUT_MS = 45000;
const AI_RESPONSE_BYTES = 256 * 1024;
const AI_MATERIAL_CHARS = 12000;
const KEY_SENTENCE_MAX = 300;

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

// SHA-256으로 같은 길이로 만든 뒤 끝까지 비교(collector-feed secretMatches와 같음).
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const quoteIn = (values: string[]) => `(${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")})`;
const chars = (s: string) => [...s].length;

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
      r = await doFetch(`${sb}/rest/v1/${path}`, { method, headers: headers(prefer), body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    } catch {
      throw new Fail(503, "STORE_UNAVAILABLE");
    }
    if (!r.ok) {
      try { await r.body?.cancel(); } catch { /* ignore */ }
      throw new Fail(503, "STORE_UNAVAILABLE");
    }
    if (r.status === 204) return [];
    let v: unknown;
    try { v = await readBoundedJson(r, { maxBytes: 4 * 1024 * 1024 }); } catch { throw new Fail(503, "STORE_UNAVAILABLE"); }
    return Array.isArray(v) ? v as Record<string, unknown>[] : [];
  }
  return { get: (p) => call("GET", p), send: (m, p, b, pr) => call(m, p, b, pr) };
}

// ---- 바깥 사이트 읽기(GET만, 카탈로그 호스트만) ------------------------------------------------------------------

type Got = { ok: true; text: string; url: string } | { ok: false; code: string };
type Reader = { get: (source: OutsideSource, url: string, wantFeed: boolean) => Promise<Got> };

function makeReader(doFetch: typeof fetch, sleep: (ms: number) => Promise<void>, log: Log): Reader {
  const robots = new Map<string, string | null>(); // origin → robots 글자(없으면 빈 글자), 못 읽으면 null
  let lastAt = 0;
  async function raw(url: URL, accept: string): Promise<{ res: Response | null; code?: string }> {
    // 같은 사이트 요청 사이 간격(GAP_MS). 한 실행은 단체 하나만 읽으므로 전체 간격으로 충분하다.
    const wait = lastAt + GAP_MS - Date.now();
    if (lastAt && wait > 0) await sleep(wait);
    lastAt = Date.now();
    try {
      const res = await doFetch(url.href, {
        method: "GET", redirect: "manual",
        headers: { "User-Agent": USER_AGENT, Accept: accept, "Accept-Language": "ko,en;q=0.8" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      return { res };
    } catch (e) {
      const name = (e as { name?: string })?.name;
      return { res: null, code: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
    }
  }
  async function readCapped(res: Response): Promise<Uint8Array | null> {
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > FETCH_MAX_BYTES) { try { await res.body?.cancel(); } catch { /* ignore */ } return null; }
    if (!res.body) return new Uint8Array();
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let n = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        n += value.byteLength;
        if (n > FETCH_MAX_BYTES) { try { await reader.cancel(); } catch { /* ignore */ } return null; }
        parts.push(value);
      }
    } catch {
      return null;
    }
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.byteLength; }
    return out;
  }
  // 리다이렉트를 직접 따라가며 단계마다 허용 호스트를 다시 확인한다.
  async function follow(source: OutsideSource, start: URL, accept: string): Promise<{ ok: true; res: Response; url: URL } | { ok: false; code: string }> {
    let url = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const { res, code } = await raw(url, accept);
      if (!res) return { ok: false, code: code ?? "network" };
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        try { await res.body?.cancel(); } catch { /* ignore */ }
        let next: URL | null = null;
        try { next = loc ? allowedUrl(source, new URL(loc, url).href) : null; } catch { next = null; }
        if (!next) return { ok: false, code: "redirect_outside" };
        url = next;
        continue;
      }
      return { ok: true, res, url };
    }
    return { ok: false, code: "redirect_loop" };
  }
  async function robotsFor(source: OutsideSource, u: URL): Promise<string | null> {
    const origin = `${u.protocol}//${u.host}`;
    if (robots.has(origin)) return robots.get(origin)!;
    let text: string | null;
    const got = await follow(source, new URL("/robots.txt", origin), "text/plain");
    if (!got.ok) text = null;
    else if (got.res.status === 404 || got.res.status === 410) { try { await got.res.body?.cancel(); } catch { /* ignore */ } text = ""; }
    else if (!got.res.ok) { try { await got.res.body?.cancel(); } catch { /* ignore */ } text = null; }
    else {
      const b = await readCapped(got.res);
      text = b ? new TextDecoder("utf-8").decode(b) : null;
    }
    robots.set(origin, text);
    return text;
  }
  return {
    async get(source, rawUrl, wantFeed) {
      const u = allowedUrl(source, rawUrl);
      if (!u) return { ok: false, code: "url_outside" };
      const rb = await robotsFor(source, u);
      if (rb === null) return { ok: false, code: "robots_unreachable" };
      if (!robotsAllows(rb, ROBOTS_AGENT, u.pathname + u.search)) return { ok: false, code: "robots" };
      const got = await follow(source, u, wantFeed ? "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9" : "text/html, application/xhtml+xml;q=0.9");
      if (!got.ok) return got;
      if (got.url.href !== u.href && !robotsAllows((await robotsFor(source, got.url)) ?? "User-agent: *\nDisallow: /", ROBOTS_AGENT, got.url.pathname + got.url.search)) {
        try { await got.res.body?.cancel(); } catch { /* ignore */ }
        return { ok: false, code: "robots" };
      }
      if (!got.res.ok) {
        try { await got.res.body?.cancel(); } catch { /* ignore */ }
        log("site_http", { source: source.key, status: got.res.status });
        return { ok: false, code: `http_${got.res.status}` };
      }
      const bytes = await readCapped(got.res);
      if (!bytes) return { ok: false, code: "too_large" };
      return { ok: true, text: decodeBody(bytes, got.res.headers.get("content-type")), url: got.url.href };
    },
  };
}

// ---- AI ------------------------------------------------------------------------------------------------------------

const KO_SUMMARY_INSTRUCTIONS = [
  "노동·진보 단체가 낸 성명·논평·보도자료 한 건을 받는다. 무엇에 대해 어떤 입장·요구인지 한국어 한 문장(120자 안쪽)으로 요약한다.",
  "본문에 없는 내용을 지어내지 않는다. 단체 이름·날짜는 본문에 있는 그대로 쓴다.",
  AI_TONE_RULE,
].join("\n");
const KO_SUMMARY_SCHEMA = { type: "object", additionalProperties: false, required: ["summary"], properties: { summary: { type: "string" } } };
const EN_INSTRUCTIONS = [
  "영어권 노동·진보 매체 글 한 건을 받는다. 한국 노동조합 활동가가 읽을 소개를 만든다.",
  "title_ko: 제목의 한국어 번역(100자 안쪽). summary_ko: 글의 주장·근거를 한국어 3~5문장(600자 안쪽)으로 요약.",
  "key_sentences: 글에서 가장 중요한 문장 3개까지. orig는 본문에서 글자 그대로 따온 영어 문장(300자 안쪽, 고치거나 줄이지 않음), ko는 그 문장의 한국어 번역(300자 안쪽).",
  "글 전체를 번역하지 않는다. 본문에 없는 내용을 지어내지 않는다.",
  AI_TONE_RULE,
].join("\n");
const EN_SCHEMA = {
  type: "object", additionalProperties: false, required: ["title_ko", "summary_ko", "key_sentences"],
  properties: {
    title_ko: { type: "string" }, summary_ko: { type: "string" },
    key_sentences: { type: "array", items: { type: "object", additionalProperties: false, required: ["orig", "ko"], properties: { orig: { type: "string" }, ko: { type: "string" } } } },
  },
};
const EXPAND_INSTRUCTIONS = [
  "노동조합 성명을 찾는 사람이 찾는 말 하나를 보낸다. 같은 뜻이거나 성명에서 같은 일을 가리킬 때 흔히 쓰는 한국어 표현 3~6개를 돌려준다.",
  "예: '구조조정' → '인력 감축', '정원 축소', '감원'. 원래 말은 넣지 않는다. 표현마다 1~30자, 설명·따옴표 없이 낱말만.",
].join("\n");
const EXPAND_SCHEMA = { type: "object", additionalProperties: false, required: ["terms"], properties: { terms: { type: "array", items: { type: "string" } } } };

type AiDeps = { doFetch: typeof fetch; sleep: (ms: number) => Promise<void>; log: Log; env: Env };
async function askAi(deps: AiDeps, name: string, instructions: string, material: string, schema: unknown, maxOut: number): Promise<unknown | null> {
  const config = aiConfigFrom(deps.env, { keyName: KEY_NAME, model: DEFAULT_AI_MODEL, priceIn: DEFAULT_PRICE_IN_KRW_PER_MTOK, priceOut: DEFAULT_PRICE_OUT_KRW_PER_MTOK });
  if (!config) { deps.log("ai_not_configured"); return null; }
  const result = await callOpenAi({ doFetch: deps.doFetch, sleep: deps.sleep, log: deps.log }, config.key, {
    model: config.model, store: false, max_output_tokens: maxOut + AI_REASONING_TOKEN_HEADROOM,
    input: [{ role: "developer", content: instructions }, { role: "user", content: material }],
    text: { format: { type: "json_schema", name, strict: true, schema } },
  }, { url: OPENAI_URL, timeoutMs: AI_TIMEOUT_MS, retryDelayMs: 1000, maxResponseBytes: AI_RESPONSE_BYTES });
  if (!result.ok) { deps.log("ai_failed", { stage: result.code }); return null; }
  const text = outputText(result.raw);
  if (!text) { deps.log("ai_failed", { stage: "ai_invalid_response" }); return null; }
  try { return JSON.parse(text); } catch { deps.log("ai_failed", { stage: "ai_invalid_json" }); return null; }
}

const okText = (v: unknown, max: number) => typeof v === "string" && oneLine(v) !== "" && chars(oneLine(v)) <= max ? oneLine(v) : null;
export function readKoSummary(v: unknown): string | null {
  return v && typeof v === "object" ? okText((v as Record<string, unknown>).summary, 2000) : null;
}
// 외국 글 AI 답 확인: 핵심 문장 orig는 재료에 글자 그대로 있어야 한다(빈칸 차이만 허용). 300자 넘거나 없는 문장은 버린다.
export function readEnIntro(v: unknown, material: string): { title_ko: string | null; summary_ko: string; key_sentences: { orig: string; ko: string }[] } | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const summary = okText(o.summary_ko, 2000);
  if (!summary) return null;
  const flat = oneLine(material);
  const keys: { orig: string; ko: string }[] = [];
  for (const k of Array.isArray(o.key_sentences) ? o.key_sentences : []) {
    if (keys.length >= 3 || !k || typeof k !== "object") continue;
    const orig = okText((k as Record<string, unknown>).orig, KEY_SENTENCE_MAX), ko = okText((k as Record<string, unknown>).ko, KEY_SENTENCE_MAX);
    if (orig && ko && flat.includes(orig)) keys.push({ orig, ko });
  }
  return { title_ko: okText(o.title_ko, 500), summary_ko: summary, key_sentences: keys };
}
export function readTerms(v: unknown, query: string): string[] | null {
  if (!v || typeof v !== "object" || !Array.isArray((v as Record<string, unknown>).terms)) return null;
  const seen = new Set([query.toLowerCase()]);
  const out: string[] = [];
  for (const t of (v as { terms: unknown[] }).terms) {
    const s = okText(t, 30);
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
    if (out.length >= 6) break;
  }
  return out;
}

// ---- 예약 실행 ------------------------------------------------------------------------------------------------------

const kstDay = (ms: number) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);

// 2년 지난 국내 글의 문장 행을 지우고 has_body=false(제목·요약은 남김, Q7). 한 번에 PRUNE_BATCH건.
async function pruneOld(db: Db, nowMs: number): Promise<number> {
  const cutoff = new Date(nowMs - OLD_DAYS * 86400000).toISOString();
  const old = await db.get(`app_outside_posts?has_body=is.true&lang=eq.ko&or=(published_at.lt.${encodeURIComponent(cutoff)},and(published_at.is.null,fetched_at.lt.${encodeURIComponent(cutoff)}))&select=id&limit=${PRUNE_BATCH}`);
  const ids = old.map((r) => r.id).filter((id): id is string => typeof id === "string" && UUID.test(id));
  if (!ids.length) return 0;
  await db.send("DELETE", `app_outside_sentences?post_id=in.(${ids.join(",")})`);
  await db.send("PATCH", `app_outside_posts?id=in.(${ids.join(",")})`, { has_body: false });
  return ids.length;
}

async function runPlan(db: Db, nowMs: number, log: Log) {
  let pruned = 0;
  try { pruned = await pruneOld(db, nowMs); } catch { log("prune_failed"); }
  const rows = await db.get("app_outside_sources?enabled=is.true&select=source_key");
  const on = new Set(rows.map((r) => r.source_key));
  return { ok: true, sources: OUTSIDE_CATALOG.filter((s) => on.has(s.key)).map((s) => s.key), pruned };
}

type RunOut = { ok: true; source: string; status: string; workspaces: number; listed: number; fresh: number; inserted: number; skipped: number; deferred: number };

async function markSources(db: Db, key: string, workspaces: string[], error: string | null, nowIso: string) {
  const body = error ? { last_error: error, updated_at: nowIso } : { last_ok_at: nowIso, last_error: null, updated_at: nowIso };
  await db.send("PATCH", `app_outside_sources?source_key=eq.${key}&workspace_id=in.(${workspaces.join(",")})`, body);
}

async function runSource(db: Db, reader: Reader, ai: AiDeps, source: OutsideSource, nowMs: number, startMs: number, clock: () => number): Promise<RunOut> {
  const out: RunOut = { ok: true, source: source.key, status: "ok", workspaces: 0, listed: 0, fresh: 0, inserted: 0, skipped: 0, deferred: 0 };
  const wsRows = await db.get(`app_outside_sources?source_key=eq.${source.key}&enabled=is.true&select=workspace_id`);
  const workspaces = [...new Set(wsRows.map((r) => r.workspace_id).filter((w): w is string => typeof w === "string" && UUID.test(w)))];
  out.workspaces = workspaces.length;
  if (!workspaces.length) return { ...out, status: "no_workspace" };
  const nowIso = new Date(nowMs).toISOString();

  // 1) 목록(단체마다 목록 주소 1~2개를 한 번씩).
  const items: ListItem[] = [];
  const seen = new Set<string>();
  let listError: string | null = null;
  for (const list of source.lists) {
    const got = await reader.get(source, list, source.mode === "rss");
    if (!got.ok) { listError = got.code; continue; }
    const found = source.mode === "rss" ? parseFeed(source, got.text, nowMs, LIST_LIMIT) : parseListHtml(source, got.text, got.url, LIST_LIMIT);
    for (const it of found) if (!seen.has(it.url)) { seen.add(it.url); items.push(it); }
  }
  out.listed = items.length;
  if (!items.length) {
    const code = (listError ?? "parse_empty").slice(0, 40);
    ai.log("source_failed", { source: source.key, stage: code });
    await markSources(db, source.key, workspaces, code, nowIso);
    return { ...out, status: code };
  }

  // 2) 작업공간마다 이미 있는 글 빼기.
  const have = await db.get(`app_outside_posts?workspace_id=in.(${workspaces.join(",")})&url=in.${encodeURIComponent(quoteIn(items.map((i) => i.url)))}&select=workspace_id,url`);
  const has = new Set(have.map((r) => `${r.workspace_id} ${r.url}`));
  const todo = items.map((it) => ({ it, ws: workspaces.filter((w) => !has.has(`${w} ${it.url}`)) })).filter((x) => x.ws.length);
  out.fresh = todo.length;

  // 3) 새 글마다 글 페이지 1번 + AI 1번 → 필요한 작업공간마다 넣기.
  const cutoff = nowMs - OLD_DAYS * 86400000;
  for (const [n, { it, ws }] of todo.entries()) {
    if (n >= MAX_NEW_PER_RUN || clock() - startMs > RUN_BUDGET_MS) { out.deferred = todo.length - n; break; }
    let body = it.content && chars(it.content) >= 200 ? it.content : "";
    let pageText = "";
    if (!body || source.lang === "en") {
      const page = await reader.get(source, it.url, false);
      if (page.ok) {
        pageText = page.text;
        body = extractBody(page.text, it.title) || body;
      } else if (!body && !it.summary) { out.skipped++; continue; }
    }
    const published = it.published_at ?? (pageText ? textDate(extractBody(pageText, it.title) || "", nowMs) : null);
    const rows: Record<string, unknown>[] = [];
    if (source.lang === "ko") {
      if (!body) { out.skipped++; continue; }
      const old = published !== null && Date.parse(published) < cutoff;
      const sentences = old ? [] : splitSentences(body);
      const summary = readKoSummary(await askAi(ai, "outside_ko_summary", KO_SUMMARY_INSTRUCTIONS,
        `단체: ${source.name}\n제목: ${it.title}\n\n본문:\n${cut(body, AI_MATERIAL_CHARS)}`, KO_SUMMARY_SCHEMA, 300));
      for (const w of ws) rows.push({ workspace_id: w, source_key: source.key, kind: it.kind, lang: "ko", title: it.title, author: it.author, url: it.url, published_at: published, summary_ko: summary, has_body: sentences.length > 0, _sentences: sentences });
    } else {
      const material = cut(body || it.content || it.summary || "", AI_MATERIAL_CHARS);
      if (!material) { out.skipped++; continue; }
      const intro = readEnIntro(await askAi(ai, "outside_en_intro", EN_INSTRUCTIONS, `Title: ${it.title}\n\n${material}`, EN_SCHEMA, 1200), material);
      if (!intro) { out.skipped++; continue; } // 요약이 없으면 넣지 않고 다음 실행에 다시 본다.
      for (const w of ws) rows.push({ workspace_id: w, source_key: source.key, kind: "article", lang: "en", title: it.title, title_ko: intro.title_ko, author: it.author, url: it.url, published_at: published, summary_ko: intro.summary_ko, key_sentences: intro.key_sentences, has_body: false, _sentences: [] });
    }
    for (const row of rows) {
      const { _sentences, ...post } = row as Record<string, unknown> & { _sentences: string[] };
      const made = await db.send("POST", "app_outside_posts?on_conflict=workspace_id,url&select=id,workspace_id", post, "return=representation,resolution=ignore-duplicates");
      const id = made[0]?.id;
      if (typeof id !== "string") continue; // 그 사이 다른 실행이 넣음
      out.inserted++;
      if (_sentences.length) {
        try {
          await db.send("POST", "app_outside_sentences", _sentences.map((text, idx) => ({ post_id: id, workspace_id: post.workspace_id, lang: "ko", idx, text })), "return=minimal");
        } catch {
          ai.log("sentences_failed", { source: source.key });
          await db.send("PATCH", `app_outside_posts?id=eq.${id}`, { has_body: false });
        }
      }
    }
  }
  await markSources(db, source.key, workspaces, null, nowIso);
  ai.log("source_done", { source: source.key, listed: out.listed, fresh: out.fresh, inserted: out.inserted, skipped: out.skipped, deferred: out.deferred });
  return out;
}

// ---- 화면 입구(로그인 + owner) --------------------------------------------------------------------------------------

async function authorizeUser(sb: string, key: string, jwt: string, doFetch: typeof fetch, db: Db): Promise<{ userId: string; workspaceId: string }> {
  let r: Response;
  try { r = await doFetch(`${sb}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${jwt}` }, signal: AbortSignal.timeout(10000) }); }
  catch { throw new Fail(503, "AUTH_UNAVAILABLE"); }
  if (r.status >= 500) { try { await r.body?.cancel(); } catch { /* ignore */ } throw new Fail(503, "AUTH_UNAVAILABLE"); }
  let user: Record<string, unknown> | null = null;
  try { user = await readBoundedJson(r, { maxBytes: 256 * 1024 }) as Record<string, unknown>; } catch { user = null; }
  if (!r.ok || typeof user?.id !== "string" || !UUID.test(user.id)) throw new Fail(401, "UNAUTHORIZED");
  // private.app_is_workspace_owner와 같은 기준: 본인 app_workspace_members 행이 owner인 작업공간 하나(화면이 보낸 값은 받지 않음).
  const members = await db.get(`app_workspace_members?user_id=eq.${user.id}&role=eq.owner&select=workspace_id`);
  if (members.length !== 1 || typeof members[0].workspace_id !== "string") throw new Fail(403, "FORBIDDEN");
  return { userId: user.id, workspaceId: members[0].workspace_id };
}

// ---- 입구 ----------------------------------------------------------------------------------------------------------

export function createOutsideFeedHandler(deps: OutsideFeedDeps) {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log: Log = deps.log ?? ((code, detail) => console.error(JSON.stringify({ fn: "outside-feed", code, ...(detail ?? {}) })));
  const expandUse = new Map<string, number>(); // `${day} ${user}` → 횟수(인스턴스 메모리)
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      // 열쇠 확인이 맨 앞이다(몸통·action보다 먼저). 열쇠가 없거나 섞이면 401.
      const cronGiven = req.headers.get(CRON_HEADER);
      const auth = req.headers.get("authorization");
      if (FOREIGN_SECRET_HEADERS.some((h) => req.headers.get(h) !== null)) throw new Fail(401, "UNAUTHORIZED");
      if ((cronGiven === null) === (auth === null)) throw new Fail(401, "UNAUTHORIZED");
      if (req.method !== "POST") throw new Fail(405, "METHOD_NOT_ALLOWED");
      const sb = deps.env("SUPABASE_URL") ?? "", key = deps.env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      let action: string | null = null;
      try { action = new URL(req.url).searchParams.get("action"); } catch { /* ignore */ }
      const cron = cronGiven !== null;
      if (cron) {
        if (!await secretMatches(cronGiven, deps.env(SECRET_NAME))) throw new Fail(401, "UNAUTHORIZED");
      } else {
        const m = /^Bearer ([A-Za-z0-9._-]{20,4096})$/.exec(auth ?? "");
        if (!m) throw new Fail(401, "UNAUTHORIZED");
      }
      if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(sb) || !key) throw new Fail(500, "SERVER_CONFIG_MISSING");
      if (cron ? action !== "run_plan" && action !== "run" : action !== "catalog" && action !== "expand") throw new Fail(400, "UNKNOWN_ACTION");
      if (Number(req.headers.get("content-length") || 0) > MAX_BODY_BYTES) throw new Fail(413, "BODY_TOO_LARGE");
      let body: unknown = {};
      try { body = await readBoundedJson(req, { maxBytes: MAX_BODY_BYTES }); } catch { throw new Fail(400, "INVALID_BODY"); }
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Fail(400, "INVALID_BODY");
      const b = body as Record<string, unknown>;
      const db = makeDb(sb, key, doFetch);
      const nowMs = now();

      if (action === "run_plan") {
        if (!exactKeys(b, [])) throw new Fail(400, "INVALID_BODY");
        return json(await runPlan(db, nowMs, log));
      }
      if (action === "run") {
        // 몸통은 단체 키 하나뿐(주소를 받지 않음). 카탈로그 밖 키는 400.
        if (!exactKeys(b, ["source"])) throw new Fail(400, "INVALID_BODY");
        const source = sourceByKey(b.source);
        if (!source) throw new Fail(400, "UNKNOWN_SOURCE");
        const reader = makeReader(doFetch, sleep, log);
        return json(await runSource(db, reader, { doFetch, sleep, log, env: deps.env }, source, nowMs, now(), now));
      }

      const jwt = auth!.slice("Bearer ".length);
      const who = await authorizeUser(sb, key, jwt, doFetch, db);
      if (action === "catalog") {
        if (!exactKeys(b, [])) throw new Fail(400, "INVALID_BODY");
        return json({ ok: true, sources: publicCatalog() });
      }
      // expand: 찾는 말 하나 → 비슷한 말 3~6개(설계 3.3). 1~100자, 사람마다 하루 EXPAND_DAILY_PER_USER번.
      if (!exactKeys(b, ["query"]) || typeof b.query !== "string") throw new Fail(400, "INVALID_BODY");
      const query = oneLine(b.query);
      if (chars(query) < 1 || chars(query) > 100) throw new Fail(400, "INVALID_BODY");
      const use = `${kstDay(nowMs)} ${who.userId}`;
      for (const k of expandUse.keys()) if (!k.startsWith(kstDay(nowMs))) expandUse.delete(k);
      const n = expandUse.get(use) ?? 0;
      if (n >= EXPAND_DAILY_PER_USER) throw new Fail(429, "DAILY_LIMIT");
      expandUse.set(use, n + 1);
      const terms = readTerms(await askAi({ doFetch, sleep, log, env: deps.env }, "outside_expand", EXPAND_INSTRUCTIONS, query, EXPAND_SCHEMA, 200), query);
      if (!terms) throw new Fail(503, "AI_UNAVAILABLE");
      return json({ ok: true, terms });
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
