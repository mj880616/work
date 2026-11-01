// 바깥 사이트 읽기(GET만) — 뉴스 클리핑(news-feed)이 쓰는 공용 읽기. outside-feed의 읽기(makeReader)와 같은 규칙을
// '허용 주소 판정 함수'만 바꿔 끼울 수 있게 뺀 것이다(설계 docs/design/news-clipping.md 2.3).
// - 매 요청·매 리다이렉트 단계마다 allow()로 주소를 다시 검사한다(리다이렉트 MAX_REDIRECTS번까지).
// - robots.txt를 먼저 읽고(출처마다 한 번, 실행 하나 안에서만 기억) 막힌 경로는 읽지 않는다. 우회 없음.
// - 응답 FETCH_MAX_BYTES·FETCH_TIMEOUT_MS 상한, 쿠키·인증 헤더 없음, 정직한 User-Agent, 요청 사이 gapMs.
// outside-feed는 아직 자기 읽기를 쓴다(그 함수의 다른 PR과 겹치지 않게 이번에는 손대지 않음 — 옮기기는 후속).
import { decodeBody, robotsAllows } from "../outside-feed/parse.ts";

export const FETCH_MAX_BYTES = 2 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 10000;
export const MAX_REDIRECTS = 3;

export type FeedLog = (code: string, detail?: Record<string, unknown>) => void;
export type Got = { ok: true; text: string; url: string; contentType: string | null } | { ok: false; code: string };
export type FeedReader = { get: (rawUrl: string, accept: string) => Promise<Got> };
export type ReaderOptions = {
  doFetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  log: FeedLog;
  userAgent: string;
  robotsAgent: string;
  gapMs: number;
  allow: (raw: string) => URL | null;
  now?: () => number;
};

export const ACCEPT_FEED = "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9";
export const ACCEPT_HTML = "text/html, application/xhtml+xml;q=0.9";

export function makeFeedReader(o: ReaderOptions): FeedReader {
  const now = o.now ?? Date.now;
  const robots = new Map<string, { text: string | null; code: string }>();
  let lastAt = 0;
  async function raw(url: URL, accept: string): Promise<{ res: Response | null; code?: string }> {
    const wait = lastAt + o.gapMs - now();
    if (lastAt && wait > 0) await o.sleep(wait);
    lastAt = now();
    try {
      const res = await o.doFetch(url.href, {
        method: "GET", redirect: "manual", credentials: "omit",
        headers: { "User-Agent": o.userAgent, Accept: accept, "Accept-Language": "ko,en;q=0.8" },
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
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.byteLength; }
    return out;
  }
  async function follow(start: URL, accept: string): Promise<{ ok: true; res: Response; url: URL } | { ok: false; code: string }> {
    let url = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const { res, code } = await raw(url, accept);
      if (!res) return { ok: false, code: code ?? "network" };
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        try { await res.body?.cancel(); } catch { /* ignore */ }
        let next: URL | null = null;
        try { next = loc ? o.allow(new URL(loc, url).href) : null; } catch { next = null; }
        if (!next) return { ok: false, code: "redirect_outside" };
        url = next;
        continue;
      }
      return { ok: true, res, url };
    }
    return { ok: false, code: "redirect_loop" };
  }
  async function robotsFor(u: URL): Promise<{ text: string | null; code: string }> {
    const origin = `${u.protocol}//${u.host}`;
    if (robots.has(origin)) return robots.get(origin)!;
    let text: string | null = null, code = "robots_unreachable";
    const start = o.allow(new URL("/robots.txt", origin).href);
    const got = start ? await follow(start, "text/plain") : { ok: false as const, code: "url_outside" };
    if (!got.ok) text = null;
    else if (got.res.status === 404 || got.res.status === 410) { try { await got.res.body?.cancel(); } catch { /* ignore */ } text = ""; }
    else if (!got.res.ok) {
      try { await got.res.body?.cancel(); } catch { /* ignore */ }
      if (got.res.status === 401 || got.res.status === 403) code = "robots_denied";
    } else {
      const b = await readCapped(got.res);
      text = b ? new TextDecoder("utf-8").decode(b) : null;
    }
    const out = { text, code };
    robots.set(origin, out);
    return out;
  }
  return {
    async get(rawUrl, accept) {
      const u = o.allow(rawUrl);
      if (!u) return { ok: false, code: "url_outside" };
      const rb = await robotsFor(u);
      if (rb.text === null) return { ok: false, code: rb.code };
      if (!robotsAllows(rb.text, o.robotsAgent, u.pathname + u.search)) return { ok: false, code: "robots" };
      const got = await follow(u, accept);
      if (!got.ok) return got;
      if (got.url.href !== u.href) {
        const rb2 = await robotsFor(got.url);
        if (!robotsAllows(rb2.text ?? "User-agent: *\nDisallow: /", o.robotsAgent, got.url.pathname + got.url.search)) {
          try { await got.res.body?.cancel(); } catch { /* ignore */ }
          return { ok: false, code: "robots" };
        }
      }
      if (!got.res.ok) {
        try { await got.res.body?.cancel(); } catch { /* ignore */ }
        return { ok: false, code: `http_${got.res.status}` };
      }
      const bytes = await readCapped(got.res);
      if (!bytes) return { ok: false, code: "too_large" };
      const ct = got.res.headers.get("content-type");
      return { ok: true, text: decodeBody(bytes, ct), url: got.url.href, contentType: ct };
    },
  };
}

// 채널 기사 원문 주소 규칙(열린 주소 — 매체가 정해져 있지 않으므로 허용 호스트 대신 막는 규칙).
// https만, 기본 포트만, 사용자 정보 없음, 호스트가 IP 숫자·localhost·단일 이름·내부 이름·Supabase가 아님, 2000자 안쪽.
// DNS가 내부 주소로 풀리는 경우는 코드로 막지 못한다(Edge 런타임의 사설망 차단에 기댐 — PR 남은 위험에 적음).
const BLOCKED_SUFFIX = [".local", ".localhost", ".internal", ".intranet", ".lan", ".home", ".corp", ".arpa",
  ".supabase.co", ".supabase.in", ".supabase.net", ".supabase.com"];
export function openArticleUrl(raw: string): URL | null {
  if (typeof raw !== "string" || raw.length > 2000) return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || host === "localhost") return null;
  if (/^[\d.]+$/.test(host) || host.startsWith("[") || host.includes(":")) return null; // IPv4 숫자·IPv6
  if (/^0x|^\d+$/.test(host.split(".")[0]) && /^[\dx.a-f]+$/i.test(host)) return null;  // 16진·정수 IP 꼴
  if (BLOCKED_SUFFIX.some((s) => host === s.slice(1) || host.endsWith(s))) return null;
  if (!/^[a-z0-9.-]+$/.test(host)) return null; // 국제 도메인은 URL이 punycode로 바꿔 둠
  return u;
}

// 겹침 판정용 주소: 스킴·www 떼기, 추적 값(utm_*·fbclid·gclid 등) 떼기, 조각(#) 떼기, 끝 '/' 떼기.
const TRACKING = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|igshid|mc_cid|mc_eid|ref|ref_src|cmpid|from)$/i;
export function cleanArticleUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  const out = u.href;
  return /^https?:\/\/\S+$/.test(out) && out.length <= 2000 ? out : null;
}
export function urlKey(cleaned: string): string {
  const u = new URL(cleaned);
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const path = u.pathname.replace(/\/+$/, "");
  return `${host}${path}${u.search}`.slice(0, 2000) || host;
}
