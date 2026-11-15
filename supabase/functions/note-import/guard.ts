// note-import 주소 안전 규칙(설계 docs/design/note-import-by-url.md 3절).
// 사용자가 넣은 주소를 서버가 대신 열기 때문에(SSRF), 읽기 전에 두 가지를 모두 본다.
// 1) 주소 모양: 뉴스 채널 기사와 같은 열린 주소 규칙(_shared/news-url.ts openArticleUrl)을 그대로 쓴다 — 규칙을 두 벌 두지 않는다.
//    https만, 기본 포트만, 아이디·비밀번호 없음, 숫자 IP·IPv6·localhost·점 없는 이름·내부 이름·Supabase 호스트 거절, 2000자 안쪽.
// 2) 이름 풀이 뒤 주소: 이름을 풀어 나온 주소가 하나라도 공개 주소가 아니면 요청을 보내지 않는다(사설·루프백·링크로컬·메타데이터·예약 대역).
//    이 확인은 공용 읽기(_shared/feed-fetch.ts)의 doFetch를 감싸서 한다. 그래서 첫 주소·robots.txt·리다이렉트 단계마다 똑같이 걸린다.
//    응답에서는 '안쪽 주소로 풀림'과 '이름을 못 풂'을 가르지 않는다(둘 다 unreachable) — 서버에서 본 이름 풀이 결과를 밖에 알리지 않는다.
// 남는 위험(PR 본문 9항): 확인한 뒤 실제 연결 사이에 이름이 다른 주소로 바뀌는 경우(DNS 재바인딩)는 이 확인으로 못 막는다.
//    Edge 런타임의 fetch는 연결할 주소를 고정하는 방법이 없다. 사설망 차단은 런타임에도 기댄다(news-url.ts 머리 주석과 같음).
import { openArticleUrl } from "../_shared/news-url.ts";

export const RESOLVE_TIMEOUT_MS = 3000;
export const RESOLVE_MAX_ADDRESSES = 32;

// 노트용 주소 판정. 지금은 열린 주소 규칙과 같다(명진 결정 2026-11-11: http 막고 https만).
export function noteImportUrl(raw: string): URL | null {
  return openArticleUrl(raw);
}

// ---- IP 주소 판정(순수 함수) ----------------------------------------------------------------------------------------
// 표준 표기만 받는다. 모양이 다르면(앞자리 0, 구역 표시 % 등) 공개 주소가 아닌 것으로 본다(막는 쪽으로).
function parseV4(s: string): number[] | null {
  const m = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/.exec(s);
  if (!m) return null;
  const p = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  return p.every((n) => n <= 255) ? p : null;
}
function publicV4(p: number[]): boolean {
  const [a, b, c] = p;
  if (a === 0 || a === 10 || a === 127) return false;            // 이 네트워크 · 사설 · 루프백
  if (a === 100 && b >= 64 && b <= 127) return false;            // 통신사 공유 대역(100.64/10)
  if (a === 169 && b === 254) return false;                      // 링크로컬(클라우드 메타데이터 169.254.169.254 포함)
  if (a === 172 && b >= 16 && b <= 31) return false;             // 사설
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // 프로토콜 예약 · 문서용
  if (a === 192 && b === 88 && c === 99) return false;           // 6to4 중계(폐기)
  if (a === 192 && b === 168) return false;                      // 사설
  if (a === 198 && (b === 18 || b === 19)) return false;         // 성능 시험용
  if (a === 198 && b === 51 && c === 100) return false;          // 문서용
  if (a === 203 && b === 0 && c === 113) return false;           // 문서용
  if (a >= 224) return false;                                    // 멀티캐스트 · 예약 · 브로드캐스트
  return true;
}
function parseV6(raw: string): number[] | null {
  let s = raw.toLowerCase();
  if (!s.includes(":") || !/^[0-9a-f:.]+$/.test(s)) return null;
  // 끝이 IPv4 꼴(::ffff:1.2.3.4)이면 두 묶음으로 바꾼다.
  const last = s.slice(s.lastIndexOf(":") + 1);
  if (last.includes(".")) {
    const v4 = parseV4(last);
    if (!v4) return null;
    s = s.slice(0, s.lastIndexOf(":") + 1) + ((v4[0] << 8) | v4[1]).toString(16) + ":" + ((v4[2] << 8) | v4[3]).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  let groups = head;
  if (halves.length === 2) {
    const tail = halves[1] ? halves[1].split(":") : [];
    if (head.length + tail.length > 7) return null;
    groups = [...head, ...new Array<string>(8 - head.length - tail.length).fill("0"), ...tail];
  }
  if (groups.length !== 8) return null;
  const out = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : -1));
  return out.every((n) => n >= 0) ? out : null;
}
function publicV6(g: number[]): boolean {
  // 전역 주소(2000::/3)만 공개로 본다. 그 밖은 모두 막는다:
  // ::(미지정) · ::1(루프백) · ::ffff:0:0/96(IPv4 겹침) · 64:ff9b::/96(NAT64) · 100::/64 · fc00::/7(사설) · fe80::/10(링크로컬) · ff00::/8(멀티캐스트).
  if ((g[0] & 0xe000) !== 0x2000) return false;
  if (g[0] === 0x2001 && g[1] < 0x0200) return false;  // 2001::/23 프로토콜 예약(Teredo 등)
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // 문서용
  if (g[0] === 0x2002) return false;                    // 6to4(안에 IPv4가 들어 있음)
  if (g[0] === 0x3fff && g[1] < 0x1000) return false;   // 문서용(3fff::/20)
  return true;
}
// 공개 인터넷 주소인가. 모르는 모양은 false.
export function isPublicIp(ip: unknown): boolean {
  if (typeof ip !== "string" || ip.length > 45) return false;
  const v4 = parseV4(ip);
  if (v4) return publicV4(v4);
  const v6 = parseV6(ip);
  return v6 ? publicV6(v6) : false;
}

// ---- 읽기 전 확인(이름 풀이) -----------------------------------------------------------------------------------------
// resolve: 호스트 이름 → 그 이름의 주소 목록(A·AAAA). 못 풀면 던지거나 빈 목록. 운영에서는 index.ts가 런타임 DNS 조회로 만든다.
export type Resolve = (host: string) => Promise<string[]>;
// 한 요청 동안 '보내지 않은 까닭'. 하나라도 서면 그 가져오기는 글을 돌려주지 않는다.
export type GuardState = {
  shape: boolean;       // 주소 모양이 규칙 밖이다(리다이렉트가 가리킨 주소 포함)
  private: boolean;     // 이름이 공개 주소가 아닌 곳으로 풀렸다
  unresolved: boolean;  // 이름을 풀지 못했다
  unavailable: boolean; // 이름 풀이 기능이 없다(서버 쪽 문제 — 확인 없이 읽지 않는다)
};
export const newGuardState = (): GuardState => ({ shape: false, private: false, unresolved: false, unavailable: false });

class GuardStop extends Error {
  constructor() {
    super("note_import_guard");
    this.name = "NoteImportGuard";
  }
}
class ResolveUnavailable extends Error {
  constructor() {
    super("resolve_unavailable");
    this.name = "ResolveUnavailable";
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), ms); })]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// doFetch를 감싼다: 요청을 보내기 직전에 주소 모양을 다시 보고, 이름을 풀어 모든 주소가 공개 주소일 때만 보낸다.
// 같은 이름은 한 요청 안에서 한 번만 푼다. 막으면 던진다(공용 읽기는 'network'로 받지만, 까닭은 state에 남는다).
// stop: 가져오기 전체 시간 상한. 지나면 새 요청을 보내지 않고, 보내 둔 요청도 끊는다.
export type GuardOptions = { timeoutMs?: number; stop?: AbortSignal };
type Verdict = "public" | "private" | "unresolved" | "unavailable";
export function makeGuardedFetch(doFetch: typeof fetch, resolve: Resolve, state: GuardState, opts: GuardOptions = {}): typeof fetch {
  const timeoutMs = opts.timeoutMs ?? RESOLVE_TIMEOUT_MS, stop = opts.stop;
  const known = new Map<string, Promise<Verdict>>();
  async function look(host: string): Promise<Verdict> {
    let list: unknown;
    try { list = await withTimeout(resolve(host), timeoutMs); }
    catch (e) { return (e as { name?: unknown } | null)?.name === "ResolveUnavailable" ? "unavailable" : "unresolved"; }
    if (!Array.isArray(list) || list.length === 0) return "unresolved";
    if (list.length > RESOLVE_MAX_ADDRESSES) return "private";
    return list.every(isPublicIp) ? "public" : "private";
  }
  const guarded = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const u = noteImportUrl(raw);
    if (!u) { state.shape = true; throw new GuardStop(); }
    if (stop?.aborted) throw new GuardStop();
    const host = u.hostname.toLowerCase().replace(/\.$/, "");
    let verdict = known.get(host);
    if (!verdict) { verdict = look(host); known.set(host, verdict); }
    const v = await verdict;
    if (v !== "public") { state[v] = true; throw new GuardStop(); }
    if (stop?.aborted) throw new GuardStop();
    const signal = stop ? (init?.signal ? AbortSignal.any([init.signal, stop]) : stop) : init?.signal;
    return await doFetch(input, signal ? { ...init, signal } : init);
  };
  return guarded as typeof fetch;
}

// 운영용 이름 풀이: A·AAAA를 함께 묻고 나온 주소를 모두 돌려준다(하나라도 공개 주소가 아니면 위에서 막는다).
// 둘 다 못 풀면 던진다. 풀이 기능이 없는 런타임이면 ResolveUnavailable을 던진다 — 확인 없이 읽지 않는다(닫힌 쪽으로 실패).
export type DnsLookup = (host: string, type: "A" | "AAAA") => Promise<unknown>;
export function makeResolve(dns: DnsLookup | null | undefined): Resolve {
  return async (host: string): Promise<string[]> => {
    if (typeof dns !== "function") throw new ResolveUnavailable();
    const settled = await Promise.allSettled([dns(host, "A"), dns(host, "AAAA")]);
    const out: string[] = [];
    for (const r of settled) if (r.status === "fulfilled" && Array.isArray(r.value)) out.push(...(r.value as string[]));
    if (!out.length) throw new Error("resolve_failed");
    return out;
  };
}
