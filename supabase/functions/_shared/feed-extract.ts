// 공용 본문 추출기(NEWS-전면개편 P2b, 설계 docs/design/news-overhaul.md 4.2·4.3절). 순수 함수 — 네트워크·DB 없음.
// 글 쪽 HTML(또는 피드 본문 칸 HTML·텔레그램 글자) → 차례대로 블록 {t:'p'|'h'|'quote', text} · {t:'img', src, cap, alt}.
// - HTML은 저장하지 않는다. 글자와 https 사진 주소·캡션만 뽑는다(화면도 글자·주소로만 그림).
// - 본문 칸 고르기·제목 줄 찾기·끝 표시('목록·이전글·댓글…')·덧줄 거르기는 지금 extractBody(outside-feed/parse.ts)와 같은 함수를 쓴다.
//   그래서 블록 글자를 줄로 이으면 extractBody와 같은 본문이 된다(캡션은 사진 블록으로 가서 글자에서 빠짐). 이 글자를 문장 표·뉴스 body·AI 재료로 함께 쓴다(한 번 뽑아 세 곳).
// - 모양 상한은 DB 검사(app_feed_bodies, migration 20261106050000)와 같다: 블록 400개·글자 10만 자·사진 20개·주소 2000자·캡션 300자·제어 문자 없음.
// - 사진 주소는 저장만 한다. 서버가 받으러 가지 않는다(화면이 https로만, 리퍼러 없이 띄움 — 4.5절).
import { bodyRange, bodyScopeCandidates, bodyScopeHtml, cut, decodeEntities, htmlToText, isBodyNoise, isFileLine, oneLine } from "../outside-feed/parse.ts";
import { decodeText } from "./html-entities.ts";
import { isMoreLink } from "./outside-tidy.ts";
import { jsonBody } from "./page-json-body.ts";

// 출처마다 카탈로그 `extract` 칸(모양은 outside-catalog.ts의 ExtractRule). 본문 칸은 지금 카탈로그 `bodyClass`를 그대로 쓴다(ai-assist가 같은 칸을 읽음 — 두 벌 금지).
import type { ExtractRule } from "./outside-catalog.ts";
export type { ExtractRule };
export type Block = { t: "p" | "h" | "quote"; text: string } | { t: "img"; src: string; cap?: string | null; alt?: string | null };
export type BodyState = "ok" | "lead" | "image_only" | "failed";
export type BodyReason = "robots" | "bot_check" | "paywall" | "too_big" | "timeout" | "http_4xx" | "http_5xx" | "no_body" | "off_host" | "relay";
export type Extracted = {
  state: BodyState; reason: BodyReason | null; rule: string | null;
  blocks: Block[]; chars: number; images: number; captions: number;
  text: string; // 글자 블록(p·h·quote)을 줄로 이은 것 — 문장 표·뉴스 body·AI 재료
  scope?: string | null; // 본문 칸을 어디서 골랐나(probe 숫자·코드용, 저장 안 함): own·article·common·body·*_form·fragment·text·page_rule(S51-15 다시 뽑음)·json_ld·json_arc(S68-52 페이지 안 구조화 본문)
  cut?: string | null;   // 본문이 어디서 끝났나(probe 코드용, 저장 안 함): list·prev_next·comment·related·share·copyright·edit·rule, 끝 표시 없으면 null
  issue?: BodyIssue;     // S71-68: 뽑은 글이 본문이 아닌 까닭(probe 코드용, 저장 안 함) — link_list·off_title, 본문이면 null
  trimmed?: number;      // S71-68: 본문 앞에서 뺀 짧은 덧줄 수(probe 숫자용, 저장 안 함)
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
    // 닫는 태그를 못 찾으면(짝이 안 맞는 HTML) 여는 꼬리표만 뺀다(S51-15 — 예전: 문서 끝까지 지워 뒤 본문이 모두 사라졌다).
    if (end < 0) { out.push([start, m.index + m[0].length]); continue; }
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
// 사진 대체 글은 글자 칸: 속성값 한 번 풀기 뒤 남은 두 번 감싼·'&' 빠진 표기까지(S52-38, 공용 html-entities.ts).
const altText = (v: string | null) => v === null ? null : decodeText(v).trim();
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

// 첨부 이름 뒤 크기 꼬리(' (214.5 KB)').
const FILE_SIZE_TAIL = /\s*\(\s*[\d.,]+\s*[KMG]?B\s*\)\s*$/i;
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
// S71-68 READ-본문뽑기(사용자 결정 2026-11-26 "기사 본문 위 텍스트는 다 불필요" · "기사 제목과 내용 다름"):
// - 고른 본문 칸에서 뽑은 글이 본문이 아니면(bodyIssue — 짧은 링크 줄 목록 · 제목 낱말이 거의 없는 글) 다음 본문 칸 후보(parse.ts bodyScopeCandidates —
//   매체가 밝힌 본문 칸·<article>들·흔한 본문 칸·페이지 전체·긴 문단만 모은 칸)를 차례로 본다. 끝내 본문을 못 찾으면 엉뚱한 글 대신 failed·no_body
//   (화면은 '본문 칸을 찾지 못함' 한 줄 + 원래 사이트 — 부르는 쪽 page.ts는 메타 설명 리드, withPageJson은 페이지 안 구조화 본문을 먼저 본다).
// - 본문 앞 짧은 덧줄(메뉴·구독·후원·읽기 설정·호수·입력 날짜·기자 이름 같은 줄)은 첫 본문 문단 앞에서 뺀다(trimLead).
export function extractBlocks(input: ExtractInput): Extracted {
  let raw = input.html;
  if (input.fragment && !/<[a-z]/i.test(raw) && /&lt;[a-z]/i.test(raw)) raw = decodeEntities(raw); // 한 번 더 이스케이프된 피드 본문
  const scope = input.fragment
    ? { html: raw.replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1\s*>/gi, " "), own: true, via: "fragment" }
    : bodyScopeHtml(raw, input.body);
  let first = extractScope(input, raw, scope);
  // 고른 본문 칸(단체 본문 칸·<article>·흔한 본문 칸)에서 본문을 못 뽑았고 규칙에 시작 줄(start)이 있으면: 페이지 전체(메뉴·꼬리·옆 칸·폼만 뺌 — 기사 머리 <header>는 둠)에서 시작 줄 뒤부터 한 번 더.
  // 시작 줄을 못 찾으면 첫 결과 그대로(페이지 전체의 메뉴 글자를 본문으로 넣지 않게).
  if (first.state === "failed" && first.reason === "no_body" && !input.fragment && input.rule.start) {
    const whole = /<body\b[^>]*>([\s\S]*)<\/body\s*>/i.exec(raw)?.[1] ?? raw;
    const again = extractScope(input, raw, { html: whole.replace(/<(nav|footer|aside|form)\b[\s\S]*?<\/\1\s*>/gi, " "), own: false, via: "page_rule" }, true);
    if (again.state !== "failed") first = again;
  }
  if (input.fragment || !first.issue) return first;
  // 다음 후보: 첫 칸을 통째로 품은 더 넓은 칸(페이지 전체 등)은 제목 줄·메뉴까지 들어 있어 건너뛴다(링크 목록 칸을 품은 페이지 전체는 긴 문단만 모은 칸이 맡는다).
  for (const alt of bodyScopeCandidates(raw, input.body)) {
    if (alt.html === scope.html || (alt.via !== "dense" && alt.html.includes(scope.html))) continue;
    const e = extractScope(input, raw, alt);
    if (e.state === "ok" && !e.issue) return e;
  }
  // 끝내 못 찾음: 링크 목록이면(또는 제목과 다르고 짧은 줄뿐이면) 엉뚱한 글 대신 본문 없음. 제목 낱말만 적은 본문 글(문단이 많음)은 그대로 둔다
  // (목록 제목·번역 제목처럼 제목이 본문과 달리 적히는 글 — 본문을 버리지 않게).
  if (first.issue === "link_list" || mostlyShort(first)) return { ...failedBody("no_body", ruleId(input.key, input.rule)), scope: first.scope ?? null, cut: first.cut ?? null, issue: first.issue };
  return first;
}
const mostlyShort = (e: Extracted) => { const t = e.blocks.filter((b) => b.t !== "img"); return t.length > 0 && t.filter((b) => !isProse(b)).length / t.length > 0.5; };

// ---- 본문인지 보기(S71-68) ----------------------------------------------------------------------------------------------
export type BodyIssue = "link_list" | "off_title" | null;
// 문장으로 끝나는 줄(마침표·물음표·느낌표·말줄임, 뒤 따옴표·괄호 허용).
const SENTENCE_END = /[.!?。…][\s"'”’)\]」』]*$/;
export const PROSE_MIN_CHARS = 40;
const isProse = (b: Block) => b.t !== "img" && (len(b.text) >= PROSE_MIN_CHARS || (len(b.text) >= 15 && SENTENCE_END.test(b.text)));
// 본문 앞 짧은 덧줄 빼기: 첫 본문 문단(isProse) 앞의 짧은 글자 줄이 2줄 이상이면 모두 뺀다(사진·20자 넘는 소제목·인용은 둔다).
// 한 줄뿐이면 그대로(짧은 첫 문단일 수 있다). 본문 문단이 하나도 없으면(시·목록 글) 그대로.
// 글머리표(□·■·○·▲·※ 등)나 '이름: 값' 꼴 줄은 본문 안내 줄(일시·장소 등)이라 둔다. 매체가 밝힌 본문 칸·단체 본문 칸(own)은 부르는 쪽이 빼기를 하지 않는다.
const INFO_LINE = /^\s*([□■○●◎◆◇▲△▶►▷•※*\-–—]|\d+[.)]\s|[^\s:：]{1,12}\s*[:：]\s*\S)/;
export function trimLead(blocks: Block[]): { blocks: Block[]; dropped: number } {
  const at = blocks.findIndex(isProse);
  if (at <= 0) return { blocks, dropped: 0 };
  const keep = (b: Block) => b.t === "img" || ((b.t === "h" || b.t === "quote") && len(b.text) >= 20) || INFO_LINE.test(b.text);
  const drop = blocks.slice(0, at).filter((b) => !keep(b)).length;
  if (drop < 2) return { blocks, dropped: 0 };
  return { blocks: [...blocks.slice(0, at).filter(keep), ...blocks.slice(at)], dropped: drop };
}
// 제목 낱말(2자 넘는 낱말 — 한글은 앞 두 글자, 로마자는 4자 넘는 낱말의 앞 다섯 글자)이 본문 글자에 몇이나 나오나. 낱말이 없으면 null.
const TITLE_SKIP = /^(단독|속보|종합|사설|칼럼|기고|인터뷰|포토|영상|성명|논평|보도자료|기자|뉴스|신문|the|and|for|with|from|that|this)$/i;
export function titleHit(title: string, text: string): { words: number; hits: number } | null {
  const t = oneLine(title).replace(/\s+[-|ㅣ·:]\s+[^-|ㅣ·:]{1,30}$/, ""); // 끝 ' - 매체' 꼬리
  const stems = new Set<string>();
  for (const w of t.split(/[^\p{L}\p{N}]+/u)) {
    if (!w || TITLE_SKIP.test(w)) continue;
    if (/^[\uac00-\ud7a3]/.test(w)) { if (len(w) >= 2) stems.add([...w].slice(0, 2).join("")); }
    else if (/^\p{L}/u.test(w) && w.length >= 4) stems.add(w.slice(0, 5).toLowerCase());
  }
  if (!stems.size) return null;
  const hay = text.toLowerCase();
  let hits = 0;
  for (const s of stems) if (hay.includes(s)) hits++;
  return { words: stems.size, hits };
}
// 뽑은 글이 본문이 아닌 까닭. stats: 본문 칸 HTML의 링크 숫자(없으면 블록 모양만 본다).
// - link_list: 글자 줄 5줄 이상이고 60% 넘게 짧은 줄(문장이 아닌 40자 안쪽)이며, 칸 글자의 절반 넘게가 링크 글자(또는 링크 정보 없이 80% 넘게 짧은 줄·문장 글자 300자 안쪽).
// - off_title: 제목 낱말이 2개 이상인데 본문에 하나도 없거나, 4개 이상인데 다섯에 하나도 안 나옴.
export function bodyIssue(e: Extracted, title: string, stats?: { anchors: number; ratio: number } | null): BodyIssue {
  if (e.state !== "ok" && e.state !== "lead") return null;
  const texts = e.blocks.filter((b): b is Extract<Block, { text: string }> => b.t !== "img");
  const short = texts.filter((b) => !isProse(b)).length;
  if (texts.length >= 5 && short / texts.length > 0.6) {
    const proseChars = texts.filter(isProse).reduce((n, b) => n + len(b.text), 0);
    if (stats ? stats.anchors >= 5 && stats.ratio > 0.5 : short / texts.length > 0.8 && proseChars < 300) return "link_list";
  }
  const hit = title ? titleHit(title, e.text) : null;
  if (hit && ((hit.words >= 2 && hit.hits === 0) || (hit.words >= 4 && hit.hits / hit.words < 0.2))) return "off_title";
  return null;
}
// 본문 칸 HTML의 링크 숫자: 링크 수와 링크 글자 / 전체 글자(빈칸 빼고).
function linkStats(html: string): { anchors: number; ratio: number } {
  const plain = (h: string) => [...h.replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, "x").replace(/\s+/g, "")].length;
  const all = plain(html);
  let anchors = 0, inA = 0;
  for (const m of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a\s*>/gi)) { anchors++; inA += plain(m[1]); }
  return { anchors, ratio: all ? inA / all : 0 };
}
// 블록 다시 쌓기(뺀 뒤 숫자·글자를 맞춘다).
function replay(blocks: Block[]): Builder {
  const b = new Builder();
  for (const x of blocks) {
    if (x.t === "img") { b.img(x.src, x.alt ?? null); if (x.cap) b.caption(x.cap); }
    else b.text(x.t, x.text);
  }
  return b;
}

function extractScope(input: ExtractInput, raw: string, scope: { html: string; own: boolean; via: string }, needStart = false): Extracted {
  const rule = ruleId(input.key, input.rule);
  let html = scope.html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|template|svg|iframe|object|select|textarea)\b[\s\S]*?<\/\1\s*>/gi, " ");
  if (input.rule.drop) html = replaceRanges(html, elementRanges(html, input.rule.drop), () => " ");
  const stats = input.fragment ? null : linkStats(html);
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
    pics.push({ src, alt: altText(attr(tag, "alt")) || altText(attr(tag, "title")) });
    return `<p>${MARK_IMG}${pics.length - 1}${MARK_IMG}</p>`;
  });
  const key = (l: string) => clean(l);
  // S69-06: 사진 캡션 줄(…ⓒ매체)은 본문 끝 표시('ⓒ·Copyright')로 보지 않는다 — 판정 글자를 비워 둔다(캡션은 아래에서 사진 블록으로 감).
  const rangeKey = (l: string) => (l.trimStart()[0] === MARK_C ? "" : clean(l));
  const info: { start?: string | null; end?: string | null } = {};
  const lines = bodyRange(htmlToText(html).split("\n"), input.title, scope.own, rangeKey, { start: input.rule.start, end: input.rule.end, info });
  if (needStart && info.start !== "rule") return { ...failedBody("no_body", rule), scope: scope.via, cut: info.end ?? null };
  const b = new Builder();
  const files: string[] = [];
  for (const line of lines) {
    const img = /^\ue000(\d+)\ue000$/.exec(line.trim());
    if (img) { const p = pics[Number(img[1])]; if (p) b.img(p.src, p.alt); continue; }
    const kind = line.trimStart()[0];
    const text = key(line);
    if (!text) continue;
    if (kind === MARK_C) { b.caption(text); continue; }
    // 규칙의 덧줄(S62-42, extract.skip): 그 사이트 첨부 칸 글자('첨부파일(1)'·'….hwp (214.5 KB)' 등). 파일 이름 줄이면 크기 꼬리를 떼고 첨부 이름으로 남긴다.
    if (input.rule.skip && input.rule.skip.test(text)) { const f = text.replace(FILE_SIZE_TAIL, ""); if (isFileLine(f) && files.length < 20) files.push(f); continue; }
    if (isBodyNoise(text)) { if (isFileLine(text) && files.length < 20) files.push(text); continue; }
    b.text(kind === MARK_H ? "h" : kind === MARK_Q ? "quote" : "p", text);
  }
  // S71-68: 본문 앞 짧은 덧줄(메뉴·읽기 설정·호수·날짜·기자 줄)은 뺀다(피드 본문 칸은 본문만이라 그대로).
  const lead = input.fragment || scope.own ? { blocks: b.blocks, dropped: 0 } : trimLead(b.blocks);
  const built = lead.dropped ? replay(lead.blocks) : b;
  const out = finish(built, rule, input.minChars, files);
  // 매체·단체가 밝힌 본문 칸(own)은 제목 낱말로 의심하지 않는다(링크 목록만 본다).
  const issue = input.fragment ? null : bodyIssue(out, scope.own ? "" : input.title, stats);
  const more = { scope: scope.via, cut: info.end ?? null, issue, trimmed: lead.dropped };
  if (input.rule.lead && out.state !== "failed" && input.rule.lead.test(raw)) return { ...leadOf(out), ...more };
  return { ...out, ...more };
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
  // S69-02: 사이트 '더 보기' 링크 글자 줄('전체 내용보기' 등)은 본문 문단이 아니다.
  for (const l of text.split(/\n+/)) if (!isMoreLink(l)) b.text("p", l);
  for (const p of opts.photos ?? []) {
    let u: URL;
    try { u = new URL(p); } catch { continue; }
    if (u.protocol === "https:" && u.href.length <= BODY_LIMITS.src && !/[\s"<>]/.test(u.href)) b.img(u.href, null);
  }
  if (opts.state === "lead") {
    if (!b.chars) return failedBody(opts.reason ?? "no_body", rule);
    return { state: "lead", reason: opts.reason ?? null, rule, blocks: b.blocks, chars: b.chars, images: b.images, captions: 0, text: b.textOnly(), scope: "text" };
  }
  return { ...finish(b, rule, opts.minChars, []), scope: "text" };
}

// S69-02: 페이지 안 구조화 본문(Arc content_elements 등)처럼 종류가 붙은 차례 목록 → 블록(문단·소제목·사진·캡션 그대로).
// 사진은 https 주소만(imageSrc와 같은 규칙: 아이디·비밀번호 없음, 길이·모양 상한, 꾸밈 그림 빼기). '더 보기' 링크 줄은 뺀다.
export type TypedItem = { t: "p" | "h" | "quote"; text: string } | { t: "img"; src: string; cap?: string | null; alt?: string | null };
export function typedBlocks(items: TypedItem[], opts: { key: string; rule: ExtractRule | null; minChars: number }): Extracted {
  const rule = ruleId(opts.key, opts.rule);
  const b = new Builder();
  for (const it of items) {
    if (it.t === "img") {
      if (typeof it.src !== "string" || !/^https:\/\//i.test(it.src)) continue; // 상대 주소·http는 받지 않는다
      const src = imageSrc(`<img src="${String(it.src).replace(/"/g, "&quot;")}">`, "https://invalid.example/");
      if (!src) continue;
      b.img(src, it.alt ? String(it.alt) : null);
      if (it.cap) b.caption(String(it.cap));
      continue;
    }
    if (!isMoreLink(it.text)) b.text(it.t, it.text);
  }
  return { ...finish(b, rule, opts.minChars, []), scope: "text" };
}

// S68-52·S69-06: 페이지 안 공개 구조화 본문(JSON-LD articleBody · Arc globalContent)으로 바꿀지(뉴스·사회운동·저장한 글 공용 — 한 곳).
// 본문 태그에서 못 뽑았거나 뽑은 글자가 구조화 본문보다 JSON_BODY_RATIO배 넘게 짧으면 구조화 본문. 태그 본문이 충분하면 그대로(사진 유지).
// 유료벽은 부르는 쪽이 먼저 거른다(page.ts). 구조화 본문도 isAccessibleForFree=false·Arc 유료 표시면 읽지 않는다(page-json-body.ts).
export const JSON_BODY_RATIO = 1.5;
export function withPageJson(tagEx: Extracted, html: string, opts: { key: string; rule: ExtractRule | null; minChars: number }): Extracted {
  const jb = jsonBody(html);
  if (!jb) return tagEx;
  // 종류가 붙은 차례(Arc — 문단·소제목·사진)가 있으면 그대로 블록으로, 없으면(JSON-LD) 글자 문단만.
  const js = jb.items?.length ? typedBlocks(jb.items, opts) : textBlocks(jb.text, opts);
  if (js.state !== "ok") return tagEx;
  if (tagEx.state === "ok" && js.chars < tagEx.chars * JSON_BODY_RATIO) return tagEx;
  return { ...js, scope: `json_${jb.via}`, cut: null };
}

// probe·로그용 숫자(글자·주소 없음).
export function bodyNumbers(e: Extracted) {
  return { state: e.state, reason: e.reason, rule: e.rule, blocks: e.blocks.length, chars: e.chars, images: e.images, captions: e.captions,
    headings: e.blocks.filter((b) => b.t === "h").length, quotes: e.blocks.filter((b) => b.t === "quote").length, scope: e.scope ?? null, cut: e.cut ?? null,
    issue: e.issue ?? null, trimmed: e.trimmed ?? 0 };
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
