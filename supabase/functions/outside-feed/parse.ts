// outside-feed 읽기 도구(순수 함수, 네트워크 없음): RSS·목록 HTML 해석, 글 본문 글자 뽑기, 문장 나누기, robots.txt 판정.
// 받은 HTML은 글자만 뽑는다(태그·스크립트는 버림). 화면도 글자로만 그린다(설계 6절).
import { allowedUrl, type Kind, type OutsideSource } from "../_shared/outside-catalog.ts";

export const BODY_MAX_CHARS = 60000;      // 글 한 건 본문 상한(설계 3.1)
export const SENTENCE_MAX_CHARS = 500;    // DB 검사와 같음
export const SENTENCE_MAX_COUNT = 3001;   // idx 0~3000
export const TITLE_MAX_CHARS = 500;
export const AUTHOR_MAX_CHARS = 200;
export const URL_MAX_CHARS = 2000;

export type ListItem = { url: string; title: string; kind: Kind; published_at: string | null; author: string | null; summary: string | null; content: string | null };

// ---- 글자 다듬기 ----------------------------------------------------------------------------------------------------

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", hellip: "…", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", copy: "©" };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : " ";
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}
// 제어 문자를 빈칸으로, 빈칸 여러 개를 하나로.
export function oneLine(s: string): string {
  // deno-lint-ignore no-control-regex
  return s.replace(/[\u0000-\u001f\u007f-\u009f​﻿]/g, " ").replace(/\s+/g, " ").trim();
}
export function cut(s: string, max: number): string {
  const chars = [...s];
  return chars.length <= max ? s : chars.slice(0, max).join("");
}
const len = (s: string) => [...s].length;

// 태그를 걷고 글자만. 문단·줄바꿈 태그는 줄바꿈으로 남긴다.
export function htmlToText(html: string): string {
  const t = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|iframe|object|select|textarea)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|li|ul|ol|h[1-6]|tr|table|section|article|blockquote|header|footer|nav|aside|dd|dt|figure|figcaption|pre|hr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  return decodeEntities(t)
    .split("\n")
    // deno-lint-ignore no-control-regex
    .map((l) => l.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f​﻿]/g, " ").replace(/[ \t\r\f\v ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

// ---- 날짜 ----------------------------------------------------------------------------------------------------------

// RSS 날짜(RFC 822·ISO). 미래(하루 넘게)·너무 옛날(1990 전)이면 null.
export function feedDate(raw: string | null, nowMs: number): string | null {
  if (!raw) return null;
  const t = Date.parse(raw.trim());
  if (!Number.isFinite(t) || t > nowMs + 86400000 || t < Date.UTC(1990, 0, 1)) return null;
  return new Date(t).toISOString();
}
// 글 페이지 글자에서 처음 나오는 날짜(2026-10-31·2026.10.31·2026/10/31·2026년 10월 31일)를 서울 자정으로.
export function textDate(text: string, nowMs: number): string | null {
  const m = /(20\d{2})\s*(?:[-./]|년)\s*(\d{1,2})\s*(?:[-./]|월)\s*(\d{1,2})(?!\d)/.exec(text);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d) - 9 * 3600000;
  const back = new Date(t + 9 * 3600000);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  if (t > nowMs + 86400000 || t < nowMs - 20 * 365 * 86400000) return null;
  return new Date(t).toISOString();
}

// ---- 글 주소·제목 확인 -----------------------------------------------------------------------------------------

// 글 주소를 카탈로그 규칙으로 하나로 맞춘다. 허용 호스트·scheme 밖이거나 DB 검사(http(s), 2000자, 빈칸 없음)에 안 맞으면 null.
export function canonicalUrl(source: OutsideSource, raw: string, base?: string): string | null {
  let abs: string;
  try { abs = new URL(decodeEntities(raw.trim()), base).href; } catch { return null; }
  const u = allowedUrl(source, abs);
  if (!u) return null;
  u.hash = "";
  const out = source.canon ? source.canon(u) : u.href;
  if (!/^https?:\/\/\S+$/.test(out) || out.length > URL_MAX_CHARS || !allowedUrl(source, out)) return null;
  return out;
}
export function cleanTitle(raw: string): string | null {
  const t = cut(oneLine(decodeEntities(raw.replace(/<[^>]*>/g, " "))), TITLE_MAX_CHARS);
  return t ? t : null;
}

// ---- RSS·Atom ------------------------------------------------------------------------------------------------------

function cdata(s: string) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}
function tag(block: string, names: string[]): string | null {
  for (const n of names) {
    const re = new RegExp(`<${n.replace(":", "\\:")}(?:\\s[^>]*)?>([\\s\\S]*?)</${n.replace(":", "\\:")}\\s*>`, "i");
    const m = re.exec(block);
    if (m) return cdata(m[1]).trim();
  }
  return null;
}
function atomLink(block: string): string | null {
  const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1]);
  for (const a of links) {
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(a)?.[1];
    const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(a)?.[1] ?? "alternate";
    if (href && rel === "alternate") return href;
  }
  return null;
}

// 피드 글 목록(최대 limit). 카탈로그 밖 주소·종류 없음(null)·제목 없음은 뺀다.
export function parseFeed(source: OutsideSource, xml: string, nowMs: number, limit = 30): ListItem[] {
  const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)].map((m) => m[2]);
  const out: ListItem[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    if (out.length >= limit) break;
    const title = cleanTitle(tag(b, ["title"]) ?? "");
    const rawLink = tag(b, ["link"]) || atomLink(b) || tag(b, ["guid"]) || "";
    const url = canonicalUrl(source, rawLink);
    if (!title || !url || seen.has(url)) continue;
    const kind = source.kindOf(title, url);
    if (!kind) continue;
    seen.add(url);
    const authorRaw = tag(b, ["dc:creator", "author"]);
    const author = authorRaw ? cut(oneLine(htmlToText(tag(authorRaw, ["name"]) ?? authorRaw)), AUTHOR_MAX_CHARS) || null : null;
    const summaryRaw = tag(b, ["description", "summary"]);
    const contentRaw = tag(b, ["content:encoded", "content"]);
    out.push({
      url, title, kind, author,
      published_at: feedDate(tag(b, ["pubDate", "dc:date", "published", "updated"]), nowMs),
      summary: summaryRaw ? cut(htmlToText(summaryRaw), 4000) || null : null,
      content: contentRaw ? cut(htmlToText(contentRaw), BODY_MAX_CHARS) || null : null,
    });
  }
  return out;
}

// ---- 목록 HTML -----------------------------------------------------------------------------------------------------

// 목록 페이지의 <a href> 가운데 카탈로그 글 주소 규칙(item)에 맞는 것만. 같은 글에 링크가 여럿이면 가장 긴 글자를 제목으로.
export function parseListHtml(source: OutsideSource, html: string, base: string, limit = 30): ListItem[] {
  if (!source.item) return [];
  const best = new Map<string, string>();
  const order: string[] = [];
  const body = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, " ");
  for (const m of body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[1]);
    const raw = href?.[1] ?? href?.[2] ?? href?.[3];
    if (!raw) continue;
    let abs: string;
    try { abs = new URL(decodeEntities(raw), base).href; } catch { continue; }
    if (!source.item.test(abs)) continue;
    const url = canonicalUrl(source, abs);
    const title = cleanTitle(m[2]) ?? cleanTitle(/\btitle\s*=\s*"([^"]*)"/i.exec(m[1])?.[1] ?? "");
    if (!url || !title) continue;
    if (!best.has(url)) order.push(url);
    if (len(title) > len(best.get(url) ?? "")) best.set(url, title);
  }
  const out: ListItem[] = [];
  for (const url of order) {
    if (out.length >= limit) break;
    const title = best.get(url)!;
    const kind = source.kindOf(title, url);
    if (!kind) continue;
    out.push({ url, title, kind, published_at: null, author: null, summary: null, content: null });
  }
  return out;
}

// ---- 글 본문 ------------------------------------------------------------------------------------------------------

const END_MARK = /^(목록|목록으로|이전글|다음글|윗글|아랫글|이전 글|다음 글|댓글|덧글|관련\s?글|공유하기|SNS 공유|Share this|Related|Comments?|Leave a (reply|comment)|Copyright|ⓒ|©)/i;
// 글 페이지에서 본문 글자만: <article>(또는 본문 칸)이 있으면 그 안, 없으면 페이지 전체. 제목 줄 뒤부터 '목록·이전글·댓글·저작권' 줄 앞까지.
export function extractBody(html: string, title: string): string {
  const scoped = /<article\b[^>]*>([\s\S]*?)<\/article\s*>/i.exec(html)?.[1]
    ?? /<(?:div|section)\b[^>]*\b(?:class|id)\s*=\s*["'][^"']*\b(?:entry-content|post-content|article-body|article_body|view_content|view-content|board_view|bbs_view|xe_content|rd_body|content_view|viewContent|bo_v_con)\b[^"']*["'][^>]*>([\s\S]*)/i.exec(html)?.[1]
    ?? (/<body\b[^>]*>([\s\S]*)<\/body\s*>/i.exec(html)?.[1] ?? html);
  const cleaned = scoped.replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1\s*>/gi, " ");
  const lines = htmlToText(cleaned).split("\n");
  const key = oneLine(title).replace(/^\s*[\[<(【〈「][^\]>)】〉」]{1,20}[\]>)】〉」]\s*/, "").slice(0, 20);
  let start = key ? lines.findIndex((l) => l.includes(key)) : -1;
  start = start < 0 ? 0 : start + 1;
  const body: string[] = [];
  for (const l of lines.slice(start)) {
    if (END_MARK.test(l)) break;
    body.push(l);
  }
  return cut(body.join("\n").trim(), BODY_MAX_CHARS);
}

// 문장 나누기: 문단(줄) → 문장 끝(. ! ? … 。 다음 빈칸)으로. 500자 넘는 문장은 잘라 여러 줄로. 3001개까지.
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n+/)) {
    const p = oneLine(para);
    if (!p) continue;
    for (const s of p.split(/(?<=[.!?…。])\s+(?=\S)/)) {
      let rest = s.trim();
      while (rest) {
        const chars = [...rest];
        if (chars.length <= SENTENCE_MAX_CHARS) { out.push(rest); break; }
        out.push(chars.slice(0, SENTENCE_MAX_CHARS).join(""));
        rest = chars.slice(SENTENCE_MAX_CHARS).join("").trim();
      }
      if (out.length >= SENTENCE_MAX_COUNT) return out.slice(0, SENTENCE_MAX_COUNT);
    }
  }
  return out;
}

// ---- robots.txt ---------------------------------------------------------------------------------------------------

type Rule = { allow: boolean; path: string };
// 우리 이름(agent)에 맞는 묶음이 있으면 그것, 없으면 '*' 묶음. 가장 긴 규칙이 이긴다(같으면 Allow).
export function robotsAllows(robots: string, agent: string, path: string): boolean {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let cur: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase(), value = m[2].trim();
    if (field === "user-agent") {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === "allow" || field === "disallow") && cur) {
      lastWasAgent = false;
      if (value) cur.rules.push({ allow: field === "allow", path: value });
    } else {
      lastWasAgent = false;
    }
  }
  const me = agent.toLowerCase();
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && me.includes(a)));
  const rules = (mine.length ? mine : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules);
  let best: Rule | null = null;
  for (const r of rules) {
    if (!pathMatches(r.path, path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}
function pathMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp("^" + body.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""));
  let decoded = path;
  try { decoded = decodeURIComponent(path); } catch { /* 그대로 */ }
  return re.test(path) || re.test(decoded);
}

// 응답 글자 해석(charset: 헤더 → <meta> → utf-8). 한국 게시판의 euc-kr도 읽는다.
export function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  const pick = (s: string | null | undefined) => {
    const c = s?.trim().toLowerCase().replace(/^["']|["']$/g, "");
    if (!c) return null;
    if (/^(utf-?8)$/.test(c)) return "utf-8";
    if (/^(euc-?kr|ks_c_5601-1987|cp949|x-windows-949|windows-949)$/.test(c)) return "euc-kr";
    if (/^(iso-8859-1|latin1|windows-1252|us-ascii)$/.test(c)) return "windows-1252";
    return null;
  };
  let enc = pick(/charset\s*=\s*([^;]+)/i.exec(contentType ?? "")?.[1]);
  if (!enc) {
    const head = new TextDecoder("windows-1252").decode(bytes.subarray(0, 4096));
    enc = pick(/<meta[^>]+charset\s*=\s*["']?([A-Za-z0-9_-]+)/i.exec(head)?.[1]) ?? pick(/<\?xml[^>]+encoding\s*=\s*["']([A-Za-z0-9_-]+)/i.exec(head)?.[1]);
  }
  try { return new TextDecoder(enc ?? "utf-8").decode(bytes); } catch { return new TextDecoder("utf-8").decode(bytes); }
}
