// 바깥 사이트 읽기(GET만) — 뉴스 클리핑(news-feed)이 쓰는 공용 읽기. outside-feed의 읽기(makeReader)와 같은 규칙을
// '허용 주소 판정 함수'만 바꿔 끼울 수 있게 뺀 것이다(설계 docs/design/news-clipping.md 2.3).
// - 매 요청·매 리다이렉트 단계마다 allow()로 주소를 다시 검사한다(리다이렉트 MAX_REDIRECTS번까지).
// - robots.txt를 먼저 읽고(출처마다 한 번, 실행 하나 안에서만 기억) 막힌 경로는 읽지 않는다. 우회 없음.
//   예외 하나(S68-23, 사용자 결정 2026-11-22 "1. A"): 부르는 쪽이 skipRobots: true를 '명시'하면 robots.txt를 읽지 않는다.
//   사람이 직접 한 주소를 저장할 때(note-import)만 쓴다. 기본값은 robots 확인 — 수집(news-feed·now-detail-build 등)은 넘기지 않는다.
//   건너뛰어도 allow() 주소 재검사·리다이렉트 상한·크기·시간 상한·출처별 간격·쿠키 없음은 그대로다.
// - 응답 FETCH_MAX_BYTES·FETCH_TIMEOUT_MS 상한, 쿠키·인증 헤더 없음, 정직한 User-Agent.
//   머리글은 reader-headers.ts 한 곳(S68-49: 브라우저 호환 꼴 User-Agent + 일반 브라우저 Accept·Accept-Language, 위장·우회 없음).
// - 요청 사이 gapMs는 출처(사이트)마다 따로 지킨다(S54-16): 같은 사이트는 gapMs 간격 그대로, 다른 사이트끼리는 기다리지 않는다.
//   여러 요청이 동시에 와도 출처별 다음 차례 시각을 먼저 잡아 두므로 같은 사이트 간격은 줄지 않는다.
// outside-feed는 아직 자기 읽기를 쓴다(그 함수의 다른 PR과 겹치지 않게 이번에는 손대지 않음 — 옮기기는 후속).
import { decodeBody, robotsAllows } from "../outside-feed/parse.ts";
import { cleanArticleUrl, openArticleUrl, urlKey } from "./news-url.ts";
import { BROWSER_ACCEPT_FEED, BROWSER_ACCEPT_HTML, readerHeaders } from "./reader-headers.ts";
export { cleanArticleUrl, openArticleUrl, urlKey };

export const FETCH_MAX_BYTES = 2 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 10000;
// 사람이 누른 읽기(폰 공유 보관 save_url·[본문 열기] open)만 요청 하나 20초(S67-10 NEWS-네이버공유읽기). 수집(cron)은 FETCH_TIMEOUT_MS 그대로.
// 근거: 공유한 기사가 늦게 답하는 사이트(11/19 vop.co.kr 10초 초과)면 사람이 다시 눌러도 같은 10초에 걸린다. 한 번에 한 기사라 요청은 robots.txt + 글
// 두 번뿐이고(20초×2 + 간격 2초 — 화면 기다림 90초 안), 수집처럼 여러 기사를 잇달아 읽지 않으므로 시간 예산(RUN_BUDGET_MS)을 밀지 않는다.
export const PERSON_FETCH_TIMEOUT_MS = 20000;
export const MAX_REDIRECTS = 3;
// S69 READ-첨부본문: 첨부 파일 받기(getBytes)만의 크기 상한. 부르는 쪽이 더 작은 값을 줄 수 있고, 이보다 큰 값은 이 값으로 줄인다.
export const FILE_MAX_BYTES = 15 * 1024 * 1024;

export type FeedLog = (code: string, detail?: Record<string, unknown>) => void;
export type Got = { ok: true; text: string; url: string; contentType: string | null } | { ok: false; code: string };
export type GotBytes = { ok: true; bytes: Uint8Array; url: string; contentType: string | null } | { ok: false; code: string };
// getBytes(S69 READ-첨부본문): get과 같은 길(주소 검사·robots·리다이렉트·시간·간격)로 받되 글자로 풀지 않고 바이트 그대로(첨부 PDF·HWP용).
export type FeedReader = { get: (rawUrl: string, accept: string) => Promise<Got>; getBytes?: (rawUrl: string, accept: string, maxBytes?: number) => Promise<GotBytes> };
export type ReaderOptions = {
  doFetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  log: FeedLog;
  userAgent: string;
  robotsAgent: string;
  gapMs: number;
  allow: (raw: string) => URL | null;
  now?: () => number;
  timeoutMs?: number; // 요청 하나 상한(기본 FETCH_TIMEOUT_MS, 사람이 누른 읽기만 PERSON_FETCH_TIMEOUT_MS)
  skipRobots?: boolean; // true일 때만 robots.txt를 읽지 않는다(사람이 직접 한 쪽 저장 — note-import만). 다른 값·빠짐은 robots 확인.
};

export const ACCEPT_FEED = BROWSER_ACCEPT_FEED;
export const ACCEPT_HTML = BROWSER_ACCEPT_HTML;

export function makeFeedReader(o: ReaderOptions): FeedReader {
  const now = o.now ?? Date.now;
  const timeoutMs = o.timeoutMs === PERSON_FETCH_TIMEOUT_MS ? PERSON_FETCH_TIMEOUT_MS : FETCH_TIMEOUT_MS; // 두 값 밖은 받지 않음(상한을 넓히지 않게)
  const checkRobots = o.skipRobots !== true; // 정확히 true만 건너뜀(실수로 넘긴 다른 값은 확인 쪽으로)
  const robots = new Map<string, Promise<{ text: string | null; code: string }>>();
  // 출처별 다음 요청을 보내도 되는 시각. 기다리기 전에 자기 차례를 잡아 둔다(동시 요청이 같은 간격을 함께 쓰지 않게).
  const nextAt = new Map<string, number>();
  async function raw(url: URL, accept: string): Promise<{ res: Response | null; code?: string }> {
    const origin = url.origin, t = now();
    const slot = Math.max(t, nextAt.get(origin) ?? t);
    nextAt.set(origin, slot + o.gapMs);
    if (slot > t) await o.sleep(slot - t);
    try {
      const res = await o.doFetch(url.href, {
        method: "GET", redirect: "manual", credentials: "omit",
        headers: readerHeaders(o.userAgent, accept),
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { res };
    } catch (e) {
      const name = (e as { name?: string })?.name;
      return { res: null, code: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
    }
  }
  async function readCapped(res: Response, max = FETCH_MAX_BYTES): Promise<Uint8Array | null> {
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > max) { try { await res.body?.cancel(); } catch { /* ignore */ } return null; }
    if (!res.body) return new Uint8Array();
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let n = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        n += value.byteLength;
        if (n > max) { try { await reader.cancel(); } catch { /* ignore */ } return null; }
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
  // 출처마다 robots.txt는 한 번만 읽는다. 동시에 물어도 같은 읽기를 함께 기다린다.
  function robotsFor(u: URL): Promise<{ text: string | null; code: string }> {
    const origin = `${u.protocol}//${u.host}`;
    const known = robots.get(origin);
    if (known) return known;
    const p = readRobots(origin);
    robots.set(origin, p);
    return p;
  }
  async function readRobots(origin: string): Promise<{ text: string | null; code: string }> {
    let text: string | null = null, code = "robots_unreachable";
    const start = o.allow(new URL("/robots.txt", origin).href);
    const got = start ? await follow(start, "text/plain") : { ok: false as const, code: "url_outside" };
    // 못 읽은 까닭은 기록 코드(robots_unreachable)를 바꾸지 않고 로그에만 남긴다(코드만 — 주소 없음, NEWS-새매체글없음 노컷뉴스 확인용).
    if (!got.ok) { text = null; o.log("robots_unreachable", { why: got.code }); }
    else if (got.res.status === 404 || got.res.status === 410) { try { await got.res.body?.cancel(); } catch { /* ignore */ } text = ""; }
    else if (!got.res.ok) {
      try { await got.res.body?.cancel(); } catch { /* ignore */ }
      if (got.res.status === 401 || got.res.status === 403) code = "robots_denied";
      else o.log("robots_unreachable", { why: `http_${got.res.status}` });
    } else {
      const b = await readCapped(got.res);
      text = b ? new TextDecoder("utf-8").decode(b) : null;
    }
    return { text, code };
  }
  async function open(rawUrl: string, accept: string): Promise<{ ok: true; res: Response; url: URL } | { ok: false; code: string }> {
    const u = o.allow(rawUrl);
    if (!u) return { ok: false, code: "url_outside" };
    if (checkRobots) {
      const rb = await robotsFor(u);
      if (rb.text === null) return { ok: false, code: rb.code };
      if (!robotsAllows(rb.text, o.robotsAgent, u.pathname + u.search)) return { ok: false, code: "robots" };
    }
    const got = await follow(u, accept);
    if (!got.ok) return got;
    if (checkRobots && got.url.href !== u.href) {
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
    return got;
  }
  return {
    async get(rawUrl, accept) {
      const got = await open(rawUrl, accept);
      if (!got.ok) return got;
      const bytes = await readCapped(got.res);
      if (!bytes) return { ok: false, code: "too_large" };
      const ct = got.res.headers.get("content-type");
      return { ok: true, text: decodeBody(bytes, ct), url: got.url.href, contentType: ct };
    },
    async getBytes(rawUrl, accept, maxBytes = FILE_MAX_BYTES) {
      const got = await open(rawUrl, accept);
      if (!got.ok) return got;
      const max = Math.max(1, Math.min(Number.isFinite(maxBytes) ? maxBytes : FILE_MAX_BYTES, FILE_MAX_BYTES));
      const bytes = await readCapped(got.res, max);
      if (!bytes) return { ok: false, code: "too_large" };
      return { ok: true, bytes, url: got.url.href, contentType: got.res.headers.get("content-type") };
    },
  };
}
