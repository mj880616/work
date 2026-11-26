// S68-52 READ-조선일보원문: 글 쪽 HTML 본문 태그에서 본문을 못 뽑을 때, 같은 페이지 안에 **공개로 실려 있는** 구조화 본문 글자를 읽는다(순수 함수, 네트워크 없음).
// 왜: 조선일보(www.chosun.com)는 Arc XP(Fusion) 플랫폼 페이지라 기사 문단이 HTML <p>가 아니라 페이지 안 스크립트 데이터
//   `Fusion.globalContent = {...}`의 content_elements에 실리고 화면 그리기는 브라우저 스크립트가 한다 [추정: 피드가 arc outboundfeeds(11/08 CC 크롬 확인 [사실])라
//   Arc 페이지이고, Arc 페이지의 일반 구조가 그렇다. 이 세션은 chosun.com에 접속할 수 없어 실물 HTML은 못 봤다]. 우리 추출기는 <script>를 먼저 지우므로
//   본문 칸이 비어 리드(메타 설명)만 남거나 '원문 없음'으로 끝났다.
// 읽는 것(일반 규칙 두 가지, 매체 이름 분기 없음):
//   1) JSON-LD(schema.org) 기사 객체의 articleBody — 매체가 검색엔진용으로 공개한 본문 글자.
//   2) Arc XP Fusion의 globalContent.content_elements 중 text·header 칸 — 같은 플랫폼을 쓰는 매체 공통.
// 지키는 것: 유료벽을 넘지 않는다. isAccessibleForFree=false인 객체, Arc content_restrictions가 유료·구독 표시인 글은 읽지 않는다.
//   (readArticlePage는 그보다 먼저 페이지 전체의 isAccessibleForFree=false·paywall 칸을 보고 유료벽이면 여기까지 오지 않는다.) 로그인·쿠키·다른 요청 없음.
// 상한: 스크립트 수·스크립트 크기·파싱 길이를 묶는다(큰 페이지에서 시간·메모리 폭주 방지).
import { decodeText } from "./html-entities.ts";

export const JSON_BODY_LIMITS = Object.freeze({ ldScripts: 12, ldChars: 1_000_000, arcChars: 3_000_000, elements: 2000, depth: 6 });
// items: 종류가 붙은 차례(문단·소제목·사진) — Arc처럼 페이지 데이터가 종류를 줄 때만(S69-02). JSON-LD는 글자뿐이라 없음.
export type JsonItem = { t: "p" | "h" | "quote"; text: string } | { t: "img"; src: string; cap?: string | null; alt?: string | null };
export type JsonBody = { text: string; via: "ld" | "arc" | "next"; items?: JsonItem[] };

const ARTICLE_TYPE = /^(?:Article|NewsArticle|ReportageNewsArticle|AnalysisNewsArticle|OpinionNewsArticle|BackgroundNewsArticle|ReviewNewsArticle|BlogPosting|Report|TechArticle|ScholarlyArticle|SocialMediaPosting|LiveBlogPosting)$/;
const PAID_CODE = /premium|subscri|paid|member|metered|locked|plus/i;

// 문단 글자 하나 다듬기: 안쪽 태그(<b>·<a>·<br>) → 글자, 문자 참조 풀기, 공백 한 칸.
function paraLines(raw: string): string[] {
  const t = decodeText(String(raw).replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6])>/gi, "\n").replace(/<[^>]*>/g, " "));
  return t.split(/\n+/).map((l) => l.replace(/[\s ]+/g, " ").trim()).filter(Boolean);
}

function isArticle(o: Record<string, unknown>): boolean {
  const t = o["@type"];
  const types = Array.isArray(t) ? t : [t];
  return types.some((x) => typeof x === "string" && ARTICLE_TYPE.test(x));
}
const notFree = (o: Record<string, unknown>) => o.isAccessibleForFree === false || String(o.isAccessibleForFree ?? "").toLowerCase() === "false";

function ldFind(v: unknown, depth: number): string | null {
  if (!v || typeof v !== "object" || depth > JSON_BODY_LIMITS.depth) return null;
  if (Array.isArray(v)) {
    for (const one of v.slice(0, 50)) { const b = ldFind(one, depth + 1); if (b) return b; }
    return null;
  }
  const o = v as Record<string, unknown>;
  if (isArticle(o) && !notFree(o) && typeof o.articleBody === "string" && o.articleBody.trim()) return o.articleBody;
  for (const k of ["@graph", "mainEntity", "mainEntityOfPage", "hasPart"]) {
    if (k in o) { const b = ldFind(o[k], depth + 1); if (b) return b; }
  }
  return null;
}

// 1) JSON-LD articleBody.
export function ldArticleBody(html: string): string | null {
  if (typeof html !== "string") return null;
  let seen = 0;
  for (const m of html.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    if (++seen > JSON_BODY_LIMITS.ldScripts) break;
    if (m[1].length > JSON_BODY_LIMITS.ldChars) continue;
    let v: unknown;
    try { v = JSON.parse(m[1].trim().replace(/^<!--|-->$/g, "")); } catch { continue; }
    const body = ldFind(v, 0);
    if (body) { const lines = paraLines(body); if (lines.length) return lines.join("\n"); }
  }
  return null;
}

// `이름 = {` 뒤의 JSON 객체 글자를 괄호 짝으로 잘라 낸다(문자열 안 괄호·이스케이프는 건너뜀). 상한을 넘거나 짝이 안 맞으면 null.
export function objectAfter(html: string, marker: RegExp, max = JSON_BODY_LIMITS.arcChars): string | null {
  const m = marker.exec(html);
  if (!m) return null;
  const start = html.indexOf("{", m.index + m[0].length - 1);
  if (start < 0 || start - (m.index + m[0].length) > 2) return null;
  let depth = 0, inStr = false, esc = false;
  const end = Math.min(html.length, start + max);
  for (let i = start; i < end; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === "\"") inStr = false;
      continue;
    }
    if (c === "\"") inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  return null;
}

// 2) Arc XP Fusion globalContent의 공개 본문 칸.
// S69-02(사용자 11/24 06:40 조선일보 '원문 다시 불러오기를 눌러도'): 문단(text)만이 아니라 소제목(header)·사진(image, https 주소·캡션)·목록(list)·인용(quote)도
//   차례 그대로 읽는다(화면 '원문 전체'가 사진·소제목까지 보이게). 글자는 예전과 같이 text·header·list·quote 글자를 줄로 이은 것.
const textOf = (v: unknown) => (typeof v === "string" ? paraLines(v) : []);
function arcItemsOf(els: unknown[], out: JsonItem[], depth = 0) {
  for (const e of els.slice(0, JSON_BODY_LIMITS.elements)) {
    if (out.length >= JSON_BODY_LIMITS.elements || !e || typeof e !== "object") continue;
    const el = e as Record<string, unknown>;
    if (el.type === "text" || el.type === "paragraph") for (const l of textOf(el.content)) out.push({ t: "p", text: l });
    else if (el.type === "header") for (const l of textOf(el.content)) out.push({ t: "h", text: l });
    else if (el.type === "list" && Array.isArray(el.items)) { if (depth < 3) arcItemsOf(el.items as unknown[], out, depth + 1); }
    else if ((el.type === "quote" || el.type === "blockquote") && depth < 3) {
      const inner: JsonItem[] = [];
      if (Array.isArray(el.content_elements)) arcItemsOf(el.content_elements as unknown[], inner, depth + 1);
      for (const l of textOf(el.content)) inner.push({ t: "p", text: l });
      for (const it of inner) out.push(it.t === "img" ? it : { t: "quote", text: it.text });
    } else if (el.type === "image") {
      const src = typeof el.url === "string" ? el.url : "";
      if (/^https:\/\//i.test(src)) {
        const cap = textOf(el.caption).join(" ") || null, alt = typeof el.alt_text === "string" ? el.alt_text : null;
        out.push({ t: "img", src, cap, alt });
      }
    }
  }
}
export function arcItems(html: string): JsonItem[] | null {
  if (typeof html !== "string" || !html.includes("globalContent")) return null;
  const raw = objectAfter(html, /Fusion\.globalContent\s*=\s*/);
  if (!raw) return null;
  let g: Record<string, unknown>;
  try { const v = JSON.parse(raw); if (!v || typeof v !== "object" || Array.isArray(v)) return null; g = v as Record<string, unknown>; } catch { return null; }
  const rest = g.content_restrictions as Record<string, unknown> | undefined;
  if (rest && typeof rest === "object" && typeof rest.content_code === "string" && PAID_CODE.test(rest.content_code)) return null;
  const out: JsonItem[] = [];
  if (Array.isArray(g.content_elements)) arcItemsOf(g.content_elements, out);
  return out.some((i) => i.t !== "img") ? out : null;
}
export function arcBody(html: string): string | null {
  const items = arcItems(html);
  const lines = (items ?? []).flatMap((i) => (i.t === "img" ? [] : [i.text]));
  return lines.length ? lines.join("\n") : null;
}

// 3) S69-06(JTBC 실측): Next.js(App Router) 페이지는 기사 자료를 `self.__next_f.push([1,"…"])` 조각(RSC 자료)으로 싣고 화면은 스크립트가 그린다.
//   본문 칸(articleContent·articleBody·newsContent) 값이 글자이거나, '$<번호>' 참조면 같은 자료 안 `<번호>:T<바이트 수 16진>,` 뒤 글자 조각이다.
//   같은 열쇠가 여러 번(관련 기사 등) 나오면 가장 긴 것. 조각 수·길이 상한이 있다. 다른 요청 없음.
const NEXT_KEY = /"(?:articleContent|articleBody|newsContent)"\s*:\s*"((?:[^"\\]|\\.){1,2000000}?)"/g;
export function nextFlightBody(html: string): string | null {
  if (typeof html !== "string" || !html.includes("__next_f")) return null;
  let flight = "", n = 0;
  for (const m of html.matchAll(/self\.__next_f\.push\(\[\s*1\s*,\s*("(?:[^"\\]|\\.)*")\s*\]\)/g)) {
    if (++n > 600 || flight.length > JSON_BODY_LIMITS.arcChars) break;
    try { flight += JSON.parse(m[1]); } catch { /* 모양이 다른 조각은 건너뜀 */ }
  }
  if (!flight) return null;
  let best: string[] = [];
  let seen = 0;
  for (const k of flight.matchAll(NEXT_KEY)) {
    if (++seen > 20) break;
    let v: string;
    try { v = JSON.parse(`"${k[1]}"`); } catch { continue; }
    const ref = /^\$([0-9a-f]{1,8})$/i.exec(v)?.[1];
    if (ref) v = nextChunk(flight, ref) ?? "";
    const lines = paraLines(v);
    if (lines.join("").length > best.join("").length) best = lines;
  }
  return best.length ? best.join("\n") : null;
}
function nextChunk(flight: string, id: string): string | null {
  const m = new RegExp(`(?:^|\\n)${id}:T([0-9a-f]{1,8}),`, "i").exec(flight);
  if (!m) return null;
  const bytes = parseInt(m[1], 16);
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes > JSON_BODY_LIMITS.arcChars) return null;
  const start = m.index + m[0].length;
  const raw = new TextEncoder().encode(flight.slice(start, start + bytes));
  return new TextDecoder().decode(raw.slice(0, bytes));
}

// 셋 가운데 가장 긴 쪽(어느 한쪽이 요약만 싣는 매체가 있다). 없으면 null.
export function jsonBody(html: string): JsonBody | null {
  const ld = ldArticleBody(html), arc = arcBody(html), next = nextFlightBody(html);
  const len = (t: string | null) => (t ? t.length : 0);
  if (ld && len(ld) >= len(arc) && len(ld) >= len(next)) return { text: ld, via: "ld" };
  if (arc && len(arc) >= len(next)) return { text: arc, via: "arc", items: arcItems(html) ?? undefined };
  if (next) return { text: next, via: "next" };
  return null;
}
