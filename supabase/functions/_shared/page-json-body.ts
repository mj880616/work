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
export type JsonBody = { text: string; via: "ld" | "arc" };

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
export function arcBody(html: string): string | null {
  if (typeof html !== "string" || !html.includes("globalContent")) return null;
  const raw = objectAfter(html, /Fusion\.globalContent\s*=\s*/);
  if (!raw) return null;
  let g: Record<string, unknown>;
  try { const v = JSON.parse(raw); if (!v || typeof v !== "object" || Array.isArray(v)) return null; g = v as Record<string, unknown>; } catch { return null; }
  const rest = g.content_restrictions as Record<string, unknown> | undefined;
  if (rest && typeof rest === "object" && typeof rest.content_code === "string" && PAID_CODE.test(rest.content_code)) return null;
  const els = Array.isArray(g.content_elements) ? g.content_elements.slice(0, JSON_BODY_LIMITS.elements) : [];
  const lines: string[] = [];
  for (const e of els) {
    if (!e || typeof e !== "object") continue;
    const el = e as Record<string, unknown>;
    if ((el.type === "text" || el.type === "header") && typeof el.content === "string") lines.push(...paraLines(el.content));
  }
  return lines.length ? lines.join("\n") : null;
}

// 둘 다 있으면 더 긴 쪽(어느 한쪽이 요약만 싣는 매체가 있다). 없으면 null.
export function jsonBody(html: string): JsonBody | null {
  const ld = ldArticleBody(html), arc = arcBody(html);
  if (ld && (!arc || ld.length >= arc.length)) return { text: ld, via: "ld" };
  if (arc) return { text: arc, via: "arc" };
  return null;
}
