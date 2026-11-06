// 공용 본문 추출기(NEWS-전면개편 P2b, 설계 docs/design/news-overhaul.md 4.2·4.3절). 순수 함수 — 네트워크·DB 없음.
// 글 쪽 HTML(또는 피드 본문 칸 HTML·텔레그램 글자) → 차례대로 블록 {t:'p'|'h'|'quote', text} · {t:'img', src, cap, alt}.
// - HTML은 저장하지 않는다. 글자와 https 사진 주소·캡션만 뽑는다(화면도 글자·주소로만 그림).
// - 본문 칸 고르기·제목 줄 찾기·끝 표시('목록·이전글·댓글…')·덧줄 거르기는 지금 extractBody(outside-feed/parse.ts)와 같은 함수를 쓴다.
//   그래서 블록 글자를 줄로 이으면 extractBody와 같은 본문이 된다(캡션은 사진 블록으로 가서 글자에서 빠짐). 이 글자를 문장 표·뉴스 body·AI 재료로 함께 쓴다(한 번 뽑아 세 곳).
// - 모양 상한은 DB 검사(app_feed_bodies, migration 20261106050000)와 같다: 블록 400개·글자 10만 자·사진 20개·주소 2000자·캡션 300자·제어 문자 없음.
// - 사진 주소는 저장만 한다. 서버가 받으러 가지 않는다(화면이 https로만, 리퍼러 없이 띄움 — 4.5절).
import { bodyRange, bodyScopeHtml, cut, decodeEntities, htmlToText, isBodyNoise, isFileLine, oneLine } from "../outside-feed/parse.ts";

// 출처마다 카탈로그 `extract` 칸. 본문 칸은 지금 카탈로그 `bodyClass`를 그대로 쓴다(ai-assist가 같은 칸을 읽음 — 두 벌 금지).
export type ExtractRule = {
  version: number;     // 규칙 판(규칙을 고치면 올린다 — rule 칸 `키@판`으로 다시 뽑을 글을 고름)
  drop?: RegExp;       // 빼는 칸(class 이름 또는 id): 공유·관련 기사·광고·기자 소개
  caption?: RegExp;    // 캡션 칸(class 이름). figcaption은 늘 캡션
  skipImage?: RegExp;  // 빼는 사진 주소(경로) — 기본 규칙(아이콘·로고·1px 등)에 더함
  lead?: RegExp;       // 유료벽 표시(맞으면 앞부분만, state='lead'·reason='paywall')
};
export type Block = { t: "p" | "h" | "quote"; text: string } | { t: "img"; src: string; cap?: string | null; alt?: string | null };
export type BodyState = "ok" | "lead" | "image_only" | "failed";
export type BodyReason = "robots" | "bot_check" | "paywall" | "too_big" | "timeout" | "http_4xx" | "http_5xx" | "no_body" | "off_host" | "relay";
export type Extracted = {
  state: BodyState; reason: BodyReason | null; rule: string | null;
  blocks: Block[]; chars: number; images: number; captions: number;
  text: string; // 글자 블록(p·h·quote)을 줄로 이은 것 — 문장 표·뉴스 body·AI 재료
};

export const BODY_LIMITS = Object.freeze({ blocks: 400, chars: 100000, images: 20, src: 2000, cap: 300, textJson: 110000 });
export const LEAD_MAX_CHARS = 1200;
const RULE_NAME = /^[a-z0-9][a-z0-9_-]{1,39}@[0-9]{1,4}$/;
export function ruleId(key: string, rule: ExtractRule | null | undefined): string | null {
  if (!rule) return null;
  const id = `${key}@${rule.version}`;
  return RULE_NAME.test(id) ? id : null;
}

// 읽기 실패 코드(_shared/feed-fetch.ts·outside-feed 읽기) → 저장 까닭 코드(DB 검사 목록 안).
// 일시 오류(연결 실패·robots를 못 읽음)는 timeout으로 둔다 — 다시 뽑기(P2c)가 까닭 코드로 고른다.
export function readFailReason(code: string): BodyReason {
  if (code === "robots" || code === "robots_denied") return "robots";
  if (code === "bot_check") return "bot_check";
  if (code === "too_large") return "too_big";
  if (code === "url_outside" || code === "redirect_outside") return "off_host";
  const http = /^http_(\d{3})$/.exec(code)?.[1];
  if (http) return Number(http) >= 500 ? "http_5xx" : "http_4xx";
  if (code === "redirect_loop") return "http_4xx";
  return "timeout"; // timeout·network·robots_unreachable·그 밖
}

export function failedBody(reason: BodyReason, rule: string | null = null): Extracted {
  return { state: "failed", reason, rule, blocks: [], chars: 0, images: 0, captions: 0, text: "" };
}

// ---- 글자 다듬기(DB 검사: 제어 문자 없음, 빈 글자 없음) ------------------------------------------------------------
const MARK_IMG = "\ue000", MARK_H = "\ue001", MARK_Q = "\ue002", MARK_C = "\ue003";
const MARKS = /\ue000\d*\ue000|[\ue000-\ue003]/g;
// deno-lint-ignore no-control-regex
const CTRL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b\ufeff]/g;
// deno-lint-ignore no-control-regex
const HAS_CTRL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
function clean(s: string): string {
  return oneLine(s.replace(MARKS, " ").replace(CTRL, " "));
}
const len = (s: string) => [...s].length;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---- 칸 찾기(class 이름 또는 id가 맞는 요소의 [시작, 끝)) ---------------------------------------------------------
function elementRanges(html: string, re: RegExp): [number, number][] {
  const out: [number, number][] = [];
  const open = /<([a-z][a-z0-9]{0,9})\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = open.exec(html))) {
    const attrs = m[2];
    const cls = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    const id = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    const names = [...(cls?.[1] ?? cls?.[2] ?? "").split(/\s+/), id?.[1] ?? id?.[2] ?? ""].filter(Boolean);
    if (!names.some((n) => re.test(n))) continue;
    const tag = m[1].toLowerCase();
    const start = m.index;
    if (m[0].endsWith("/>") || /^(img|br|hr|input|meta|link|source)$/.test(tag)) { out.push([start, m.index + m[0].length]); continue; }
    const step = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
    step.lastIndex = m.index + m[0].length;
    let depth = 1, end = -1, t: RegExpExecArray | null;
    while ((t = step.exec(html))) {
      if (t[1]) { if (--depth === 0) { end = t.index + t[0].length; break; } }
      else if (!t[0].endsWith("/>")) depth++;
    }
    if (end < 0) end = html.length;
    out.push([start, end]);
    open.lastIndex = end;
    if (out.length >= 200) break;
  }
  return out;
}
function replaceRanges(html: string, ranges: [number, number][], by: (inner: string) => string): string {
  let out = "", at = 0;
  for (const [s, e] of ranges) { out += html.slice(at, s) + by(html.slice(s, e)); at = e; }
  return out + html.slice(at);
}
const innerOf = (el: string) => el.replace(/^<[^>]*>/, "").replace(/<\/[a-z0-9]+\s*>$/i, "");

// ---- 사진 --------------------------------------------------------------------------------------------------------
// 아이콘·로고·버튼·빈 그림·공유 단추·배너 같은 꾸밈 그림은 본문 사진이 아니다(주소 경로로 판정).
const SKIP_IMAGE = /(^|[/_.-])(logo|icon|icons|ico|favicon|btn|button|blank|spacer|pixel|1x1|clear|sns|share|kakao|facebook|twitter|naver|band|bullet|arrow|banner|emoticon|emoji|loading|spinner|avatar|profile|badge)([/_.-]|\d|$)/i;
function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
  const v = m ? m[1] ?? m[2] ?? m[3] ?? "" : null;
  return v === null ? null : decodeEntities(v).trim();
}
export function imageSrc(tag: string, base: string, skip?: RegExp): string | null {
  const w = Number(attr(tag, "width") ?? NaN), h = Number(attr(tag, "height") ?? NaN);
  if ((Number.isFinite(w) && w <= 2) || (Number.isFinite(h) && h <= 2)) return null;
  for (const name of ["data-src", "data-original", "data-lazy-src", "data-url", "src"]) {
    const raw = attr(tag, name);
    if (!raw || /^data:/i.test(raw)) continue;
    let u: URL;
    try { u = new URL(raw, base); } catch { continue; }
    if (u.protocol !== "https:" || u.username || u.password) return null;
    u.hash = "";
    const href = u.href;
    if (href.length > BODY_LIMITS.src || /[\s"<>]/.test(href) || HAS_CTRL.test(href)) return null;
    if (SKIP_IMAGE.test(u.pathname) || (skip && skip.test(u.pathname))) return null;
    return href;
  }
  return null;
}

// ---- 블록 만들기(상한·모양을 DB 검사에 맞춤) -------------------------------------------------------------------------
class Builder {
  blocks: Block[] = [];
  chars = 0;
  images = 0;
  captions = 0;
  jsonLen = 2;
  private seen = new Set<string>();
  full() { return this.blocks.length >= BODY_LIMITS.blocks; }
  text(t: "p" | "h" | "quote", raw: string) {
    if (this.full()) return;
    let text = clean(raw);
    const room = BODY_LIMITS.chars - this.chars;
    if (!text || room <= 0) return;
    if (len(text) > room) text = cut(text, room).trim();
    // 블록 글자 JSON 배열 길이(따옴표·구분·이스케이프 포함) 상한 — DB text_total_check.
    const add = len(JSON.stringify(text)) + 2;
    if (this.jsonLen + add > BODY_LIMITS.textJson || !text) return;
    this.jsonLen += add;
    this.chars += len(text);
    this.blocks.push({ t, text });
  }
  img(src: string, alt: string | null) {
    if (this.full() || this.images >= BODY_LIMITS.images || this.seen.has(src)) return;
    this.seen.add(src);
    this.images++;
    const a = alt ? cut(clean(alt), BODY_LIMITS.cap) : "";
    this.blocks.push({ t: "img", src, cap: null, alt: a || null });
  }
  caption(raw: string) {
    const last = this.blocks[this.blocks.length - 1];
    if (!last || last.t !== "img" || last.cap) return; // 사진 바로 뒤가 아닌 캡션(사진을 뺀 자리 등)은 버린다
    const c = cut(clean(raw), BODY_LIMITS.cap);
    if (!c) return;
    last.cap = c;
    this.captions++;
  }
  textOnly(): string {
    return this.blocks.flatMap((b) => (b.t === "img" ? [] : [b.text])).join("\n");
  }
}

function finish(b: Builder, rule: string | null, minChars: number, files: string[]): Extracted {
  const text = b.textOnly();
  if (len(text) >= minChars && b.chars > 0) return { state: "ok", reason: null, rule, blocks: b.blocks, chars: b.chars, images: b.images, captions: b.captions, text };
  if (b.images > 0) {
    // 그림·첨부뿐인 글(공공운수노조 다수): 사진 블록 + 첨부 이름 줄. 짧은 글자는 그대로 둔다.
    for (const f of files) b.text("p", f);
    return { state: "image_only", reason: null, rule, blocks: b.blocks, chars: b.chars, images: b.images, captions: b.captions, text: b.textOnly() };
  }
  return failedBody("no_body", rule);
}

export type ExtractInput = {
  html: string;
  base: string;          // 글 주소(사진 상대 주소 풀기)
  title: string;         // 제목 줄 찾기(본문 칸 규칙이 없을 때)
  key: string;           // 출처 키(규칙 이름)
  rule: ExtractRule;
  body?: RegExp;         // 본문 칸(카탈로그 bodyClass)
  minChars: number;      // 이보다 짧은 글자는 본문이 없는 것
  fragment?: boolean;    // 피드 본문 칸처럼 이미 본문만 있는 HTML(제목 찾기·본문 칸 고르기 없음)
};

// 글 쪽 HTML(또는 피드 본문 칸 HTML) → 블록.
export function extractBlocks(input: ExtractInput): Extracted {
  const rule = ruleId(input.key, input.rule);
  let raw = input.html;
  if (input.fragment && !/<[a-z]/i.test(raw) && /&lt;[a-z]/i.test(raw)) raw = decodeEntities(raw); // 한 번 더 이스케이프된 피드 본문
  const scope = input.fragment
    ? { html: raw.replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1\s*>/gi, " "), own: true }
    : bodyScopeHtml(raw, input.body);
  let html = scope.html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|template|svg|iframe|object|select|textarea)\b[\s\S]*?<\/\1\s*>/gi, " ");
  if (input.rule.drop) html = replaceRanges(html, elementRanges(html, input.rule.drop), () => " ");
  if (input.rule.caption) html = replaceRanges(html, elementRanges(html, input.rule.caption), (el) => `<figcaption>${innerOf(el)}</figcaption>`);
  // 캡션·제목·인용은 한 줄 표시 글자로 바꿔 둔다(htmlToText가 줄을 나눈 뒤 줄 머리로 종류를 안다).
  html = html.replace(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption\s*>/gi, (_m, inner: string) => `<p>${MARK_C}${esc(clean(htmlToText(inner)))}</p>`);
  html = html.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_m, _n, inner: string) => {
    const imgs = (inner.match(/<img\b[^>]*>/gi) ?? []).join("");
    return `${imgs}<p>${MARK_H}${esc(clean(htmlToText(inner)))}</p>`;
  });
  html = html.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote\s*>/gi, (_m, inner: string) =>
    htmlToText(inner).split("\n").map((l) => `<p>${MARK_Q}${esc(l)}</p>`).join(""));
  const pics: { src: string; alt: string | null }[] = [];
  html = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = imageSrc(tag, input.base, input.rule.skipImage);
    if (!src) return " ";
    pics.push({ src, alt: attr(tag, "alt") || attr(tag, "title") });
    return `<p>${MARK_IMG}${pics.length - 1}${MARK_IMG}</p>`;
  });
  const key = (l: string) => clean(l);
  const lines = bodyRange(htmlToText(html).split("\n"), input.title, scope.own, key);
  const b = new Builder();
  const files: string[] = [];
  for (const line of lines) {
    const img = /^\ue000(\d+)\ue000$/.exec(line.trim());
    if (img) { const p = pics[Number(img[1])]; if (p) b.img(p.src, p.alt); continue; }
    const kind = line.trimStart()[0];
    const text = key(line);
    if (!text) continue;
    if (kind === MARK_C) { b.caption(text); continue; }
    if (isBodyNoise(text)) { if (isFileLine(text) && files.length < 20) files.push(text); continue; }
    b.text(kind === MARK_H ? "h" : kind === MARK_Q ? "quote" : "p", text);
  }
  const out = finish(b, rule, input.minChars, files);
  if (input.rule.lead && out.state !== "failed" && input.rule.lead.test(raw)) return leadOf(out);
  return out;
}

// 유료벽: 앞부분(LEAD_MAX_CHARS자 안의 글자 블록과 그 사이 사진)만 남긴다.
function leadOf(full: Extracted): Extracted {
  const b = new Builder();
  for (const blk of full.blocks) {
    if (blk.t === "img") { b.img(blk.src, blk.alt ?? null); if (blk.cap) b.caption(blk.cap); continue; }
    if (b.chars >= LEAD_MAX_CHARS) break;
    b.text(blk.t, cut(blk.text, LEAD_MAX_CHARS - b.chars));
  }
  if (!b.chars) return failedBody("paywall", full.rule);
  return { state: "lead", reason: "paywall", rule: full.rule, blocks: b.blocks, chars: b.chars, images: b.images, captions: b.captions, text: b.textOnly() };
}

// 글자만 있는 본문(피드 본문 글자·텔레그램 글·메타 설명) → 문단 블록(+ 사진 주소).
export function textBlocks(text: string, opts: { key: string; rule: ExtractRule | null; minChars: number; photos?: string[]; state?: "lead"; reason?: BodyReason | null }): Extracted {
  const rule = ruleId(opts.key, opts.rule);
  const b = new Builder();
  for (const l of text.split(/\n+/)) b.text("p", l);
  for (const p of opts.photos ?? []) {
    let u: URL;
    try { u = new URL(p); } catch { continue; }
    if (u.protocol === "https:" && u.href.length <= BODY_LIMITS.src && !/[\s"<>]/.test(u.href)) b.img(u.href, null);
  }
  if (opts.state === "lead") {
    if (!b.chars) return failedBody(opts.reason ?? "no_body", rule);
    return { state: "lead", reason: opts.reason ?? null, rule, blocks: b.blocks, chars: b.chars, images: b.images, captions: 0, text: b.textOnly() };
  }
  return finish(b, rule, opts.minChars, []);
}

// probe·로그용 숫자(글자·주소 없음).
export function bodyNumbers(e: Extracted) {
  return { state: e.state, reason: e.reason, rule: e.rule, blocks: e.blocks.length, chars: e.chars, images: e.images, captions: e.captions,
    headings: e.blocks.filter((b) => b.t === "h").length, quotes: e.blocks.filter((b) => b.t === "quote").length };
}

// app_feed_bodies 한 줄(서비스 역할로 넣기). 글 id는 둘 중 하나만.
export function bodyRow(e: Extracted, ids: { workspace_id: string; outside_post_id?: string; news_item_id?: string }, nowIso: string) {
  return {
    workspace_id: ids.workspace_id,
    outside_post_id: ids.outside_post_id ?? null,
    news_item_id: ids.news_item_id ?? null,
    blocks: e.blocks, state: e.state, reason: e.reason, rule: e.rule, chars: e.chars, images: e.images, extracted_at: nowIso,
  };
}
