// 기사 쪽 HTML → 제목·매체·게시 시각·언어·본문(공개 범위만). 저장 경계(PR #1697 본문, 설계 5절 정정):
// - 공개로 읽히는 기사: 본문 전체(body_kind='full').
// - 유료·로그인 기사(유료벽 표시가 보이면): 본문을 읽지 않고 공개 리드·메타 설명만(body_kind='lead', state='paywall'). 유료벽을 넘지 않는다.
// - 봇 확인 쪽: 아무것도 저장하지 않음(state='bot_check').
// NEWS-전면개편 P2b: 본문은 공용 추출기(_shared/feed-extract.ts) 한 번으로 뽑아 블록(화면 '원문 전체' 저장용)과 body 글자(AI·번역 재료)에 함께 쓴다.
import { bodyScopeHtml, cut, htmlToText, looksLikeBotCheck, oneLine, stripTags } from "../outside-feed/parse.ts";
import { decodeEntitiesDeep, decodeText } from "../_shared/html-entities.ts";
import { extractBlocks, failedBody, textBlocks, type Extracted, type ExtractRule } from "../_shared/feed-extract.ts";

export const BODY_MAX = 100000;      // DB 검사와 같음
export const FULL_MIN_CHARS = 200;   // 이보다 짧으면 본문을 못 뽑은 것으로 보고 메타 설명(리드)만
export const LEAD_MAX = 1200;

export type PageInfo = {
  state: "ok" | "paywall" | "bot_check";
  title: string | null;
  publisher: string | null;
  published_at: string | null;
  lang: string;
  body: string | null;
  body_kind: "full" | "lead" | null;
  blocks: Extracted; // app_feed_bodies에 넣을 블록(같은 추출 결과)
  paywall: string | null; // 맞은 유료벽 표시 이름(probe용 코드, 저장 안 함)
};
// 본문 규칙: 매체 카탈로그 extract·bodyClass 또는 채널 기사의 열린 주소 규칙(open@판).
export type PageRule = { key: string; rule: ExtractRule; body?: RegExp; base: string };

function meta(html: string, keys: string[]): string | null {
  for (const k of keys) {
    const re = new RegExp(`<meta\\b[^>]*(?:property|name|itemprop)\\s*=\\s*["']${k.replace(/[.:]/g, "\\$&")}["'][^>]*>`, "i");
    const tag = re.exec(html)?.[0];
    if (!tag) continue;
    const v = /\bcontent\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? /\bcontent\s*=\s*'([^']*)'/i.exec(tag)?.[1];
    const t = v ? oneLine(decodeText(v)) : "";
    if (t) return t;
  }
  return null;
}

// 유료벽 표시(본문을 읽지 않는 신호). S51-9(11/06 probe 오탐 — 비마이너·프레시안이 유료벽 없이 lead/paywall)로 좁혔다:
// - 페이지 전체에서 보는 것: 구조화 데이터의 isAccessibleForFree=false(매체가 스스로 밝힌 표시), class 이름이 정확히 `paywall`인 칸.
//   (예전에는 `paywall-…`·`…-paywall`처럼 이름 일부만 맞아도 걸렸다 — 숨은 틀·광고 칸 이름.)
// - 본문 칸 안에서만 보는 것: 문구(유료 회원 전용·구독자 전용·로그인 후 전문/기사/본문 열람 등). 댓글 칸·로그인 창·메뉴의 '로그인 후 이용' 같은 문구는 보지 않는다('이용'은 뺐다).
// 매체 규칙 extract.free(유료벽 없음 확인)면 검사하지 않는다. 매체 규칙 extract.lead는 따로(그 매체의 실제 표시).
const PAYWALL_PAGE: [string, RegExp][] = [
  ["ld_not_free", /"isAccessibleForFree"\s*:\s*"?false"?/i],
  ["class", /\bclass\s*=\s*["'](?:[^"']*\s)?paywall(?:\s[^"']*)?["']/i],
];
const PAYWALL_BODY: [string, RegExp][] = [
  ["phrase_ko", /유료\s*(회원|구독자?)\s*(전용|만)|구독자\s*전용|로그인\s*(후|하시면)\s*(전문|기사|본문|열람)|(전문|기사)\s*보기는\s*(유료|구독)/],
  ["phrase_en", /subscribe\s+(now\s+)?to\s+(continue|read)|subscribers?[- ]only|this\s+(article|story)\s+is\s+for\s+subscribers/i],
];
// 맞은 표시의 이름(probe 숫자·코드용) 또는 null. bodyHtml: 본문 칸 HTML(없으면 문구 검사 없음).
export function paywallMark(html: string, bodyHtml?: string | null): string | null {
  for (const [name, re] of PAYWALL_PAGE) if (re.test(html)) return name;
  if (bodyHtml) { const t = htmlToText(bodyHtml); for (const [name, re] of PAYWALL_BODY) if (re.test(t)) return name; }
  return null;
}
export function looksPaywalled(html: string, bodyHtml?: string | null): boolean {
  return paywallMark(html, bodyHtml) !== null;
}

// 언어: <html lang> → og:locale → 글자 비율(한글·가나·라틴).
export function pageLang(html: string, text: string): string {
  const attr = /<html\b[^>]*\blang\s*=\s*["']?([a-zA-Z]{2,3})/i.exec(html)?.[1] ?? meta(html, ["og:locale"])?.slice(0, 2);
  if (attr && /^[a-z]{2,3}$/i.test(attr)) return attr.toLowerCase();
  return guessLang(text);
}
export function guessLang(text: string): string {
  const s = text.slice(0, 4000);
  const ko = (s.match(/[\uac00-\ud7a3]/g) ?? []).length, ja = (s.match(/[\u3040-\u30ff]/g) ?? []).length;
  const zh = (s.match(/[\u4e00-\u9fff]/g) ?? []).length, la = (s.match(/[A-Za-z]/g) ?? []).length;
  if (ko >= Math.max(ja, la / 4, 1)) return "ko";
  if (ja > 0 && ja * 3 >= zh) return "ja";
  if (zh > la / 2 && zh > 0) return "zh";
  return la > 0 ? "en" : "ko";
}

function isoDate(raw: string | null, nowMs: number): string | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  if (!Number.isFinite(t) || t > nowMs + 86400000 || t < Date.parse("2000-01-01T00:00:00Z")) return null;
  return new Date(t).toISOString();
}

export function readArticlePage(html: string, nowMs: number, rule?: PageRule): PageInfo {
  const titleRaw = meta(html, ["og:title", "twitter:title"]) ?? /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1] ?? "";
  const title = cut(oneLine(decodeText(stripTags(decodeEntitiesDeep(titleRaw)))), 500) || null;
  const publisher = cut(meta(html, ["og:site_name", "application-name"]) ?? "", 120) || null;
  // 날짜: 메타 → 구조화 데이터(JSON-LD "datePublished") → 첫 <time datetime>. 못 읽으면 null('날짜 모름' 묶음, 화면에서 맨 아래).
  const published_at = isoDate(meta(html, ["article:published_time", "og:article:published_time", "datePublished", "pubdate", "date"]), nowMs)
    ?? isoDate(/"datePublished"\s*:\s*"([^"]{4,64})"/.exec(html)?.[1] ?? null, nowMs)
    ?? isoDate(/<time\b[^>]*\bdatetime\s*=\s*["']([^"']{4,64})["']/i.exec(html)?.[1] ?? null, nowMs);
  const description = meta(html, ["og:description", "description", "twitter:description"]);
  const plain = htmlToText(html);
  const lang = pageLang(html, `${title ?? ""}\n${plain}`);
  const r: PageRule = rule ?? { key: "open", rule: { version: 1 }, base: "https://invalid.example/" };
  if (looksLikeBotCheck(plain)) return { state: "bot_check", title: null, publisher, published_at: null, lang, body: null, body_kind: null, blocks: failedBody("bot_check", null), paywall: null };
  const lead = description ? cut(description, LEAD_MAX) || null : null;
  const leadBlocks = (reason: "paywall" | "no_body") => lead ? textBlocks(lead, { key: r.key, rule: r.rule, minChars: 1, state: "lead", reason }) : failedBody(reason, null);
  const mark = r.rule.lead && r.rule.lead.test(html) ? "rule" : r.rule.free ? null : paywallMark(html, bodyScopeHtml(html, r.body).html);
  if (mark) {
    return { state: "paywall", title, publisher, published_at, lang, body: lead, body_kind: lead ? "lead" : null, blocks: leadBlocks("paywall"), paywall: mark };
  }
  const ex = extractBlocks({ html, base: r.base, title: title ?? "", key: r.key, rule: r.rule, body: r.body, minChars: FULL_MIN_CHARS });
  const body = cut(ex.text, BODY_MAX);
  if (ex.state === "ok") return { state: "ok", title, publisher, published_at, lang, body, body_kind: "full", blocks: ex, paywall: null };
  // 본문이 짧으면 메타 설명(리드)만 body로. 블록은 그림뿐인 글이면 그 사진들, 아니면 리드(probe용 scope·cut 코드는 본문 칸에서 고른 것 — S51-15).
  return { state: "ok", title, publisher, published_at, lang, body: lead, body_kind: lead ? "lead" : null, blocks: ex.state === "image_only" ? ex : { ...leadBlocks("no_body"), scope: ex.scope ?? null, cut: ex.cut ?? null }, paywall: null };
}

// 겹침 판정용 제목: 끝 꼬리 ' - 매체'(옛 키워드 기사·채널 기사 제목), 머리말([단독] 등), 공백·문장부호 떼기.
export function titleKey(title: string): string | null {
  const t = title.replace(/\s+[-–—|]\s+[^-–—|]{1,40}$/, "").replace(/^\s*[\[(【<〈][^\])】>〉]{1,12}[\])】>〉]\s*/, "")
    .toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
  return t ? t.slice(0, 500) : null;
}
