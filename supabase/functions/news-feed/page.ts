// 기사 쪽 HTML → 제목·매체·게시 시각·언어·본문(공개 범위만). 저장 경계(PR #1697 본문, 설계 5절 정정):
// - 공개로 읽히는 기사: 본문 전체(body_kind='full').
// - 유료·로그인 기사(유료벽 표시가 보이면): 본문을 읽지 않고 공개 리드·메타 설명만(body_kind='lead', state='paywall'). 유료벽을 넘지 않는다.
// - 봇 확인 쪽: 아무것도 저장하지 않음(state='bot_check').
// NEWS-전면개편 P2b: 본문은 공용 추출기(_shared/feed-extract.ts) 한 번으로 뽑아 블록(화면 '원문 전체' 저장용)과 body 글자(AI·번역 재료)에 함께 쓴다.
import { cut, decodeEntities, htmlToText, looksLikeBotCheck, oneLine } from "../outside-feed/parse.ts";
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
};
// 본문 규칙: 매체 카탈로그 extract·bodyClass 또는 채널 기사의 열린 주소 규칙(open@판).
export type PageRule = { key: string; rule: ExtractRule; body?: RegExp; base: string };

function meta(html: string, keys: string[]): string | null {
  for (const k of keys) {
    const re = new RegExp(`<meta\\b[^>]*(?:property|name|itemprop)\\s*=\\s*["']${k.replace(/[.:]/g, "\\$&")}["'][^>]*>`, "i");
    const tag = re.exec(html)?.[0];
    if (!tag) continue;
    const v = /\bcontent\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? /\bcontent\s*=\s*'([^']*)'/i.exec(tag)?.[1];
    const t = v ? oneLine(decodeEntities(v)) : "";
    if (t) return t;
  }
  return null;
}

// 유료벽 표시(본문을 읽지 않는 신호). 구조화 데이터의 isAccessibleForFree=false가 가장 확실하고, 문구는 흔한 것만.
const PAYWALL = [
  /"isAccessibleForFree"\s*:\s*"?false"?/i,
  /유료\s*(회원|구독자?)\s*(전용|만)/, /구독자\s*전용/, /로그인\s*(후|하시면)\s*(전문|기사|본문|이용|열람)/, /(전문|기사)\s*보기는\s*(유료|구독)/,
  /subscribe\s+(now\s+)?to\s+(continue|read)/i, /subscribers?[- ]only/i, /this\s+(article|story)\s+is\s+for\s+subscribers/i,
  /class\s*=\s*["'][^"']*\bpaywall\b/i,
];
export function looksPaywalled(html: string): boolean {
  return PAYWALL.some((re) => re.test(html));
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
  const title = cut(oneLine(decodeEntities(titleRaw.replace(/<[^>]*>/g, " "))), 500) || null;
  const publisher = cut(meta(html, ["og:site_name", "application-name"]) ?? "", 120) || null;
  // 날짜: 메타 → 구조화 데이터(JSON-LD "datePublished") → 첫 <time datetime>. 못 읽으면 null('날짜 모름' 묶음, 화면에서 맨 아래).
  const published_at = isoDate(meta(html, ["article:published_time", "og:article:published_time", "datePublished", "pubdate", "date"]), nowMs)
    ?? isoDate(/"datePublished"\s*:\s*"([^"]{4,64})"/.exec(html)?.[1] ?? null, nowMs)
    ?? isoDate(/<time\b[^>]*\bdatetime\s*=\s*["']([^"']{4,64})["']/i.exec(html)?.[1] ?? null, nowMs);
  const description = meta(html, ["og:description", "description", "twitter:description"]);
  const plain = htmlToText(html);
  const lang = pageLang(html, `${title ?? ""}\n${plain}`);
  const r: PageRule = rule ?? { key: "open", rule: { version: 1 }, base: "https://invalid.example/" };
  if (looksLikeBotCheck(plain)) return { state: "bot_check", title: null, publisher, published_at: null, lang, body: null, body_kind: null, blocks: failedBody("bot_check", null) };
  const lead = description ? cut(description, LEAD_MAX) || null : null;
  const leadBlocks = (reason: "paywall" | "no_body") => lead ? textBlocks(lead, { key: r.key, rule: r.rule, minChars: 1, state: "lead", reason }) : failedBody(reason, null);
  if (looksPaywalled(html) || (r.rule.lead && r.rule.lead.test(html))) {
    return { state: "paywall", title, publisher, published_at, lang, body: lead, body_kind: lead ? "lead" : null, blocks: leadBlocks("paywall") };
  }
  const ex = extractBlocks({ html, base: r.base, title: title ?? "", key: r.key, rule: r.rule, body: r.body, minChars: FULL_MIN_CHARS });
  const body = cut(ex.text, BODY_MAX);
  if (ex.state === "ok") return { state: "ok", title, publisher, published_at, lang, body, body_kind: "full", blocks: ex };
  // 본문이 짧으면 메타 설명(리드)만 body로. 블록은 그림뿐인 글이면 그 사진들, 아니면 리드.
  return { state: "ok", title, publisher, published_at, lang, body: lead, body_kind: lead ? "lead" : null, blocks: ex.state === "image_only" ? ex : leadBlocks("no_body") };
}

// 겹침 판정용 제목: 구글 뉴스 꼬리 ' - 매체', 머리말([단독] 등), 공백·문장부호 떼기.
export function titleKey(title: string): string | null {
  const t = title.replace(/\s+[-–—|]\s+[^-–—|]{1,40}$/, "").replace(/^\s*[\[(【<〈][^\])】>〉]{1,12}[\])】>〉]\s*/, "")
    .toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
  return t ? t.slice(0, 500) : null;
}
// 구글 뉴스 제목 끝 ' - 매체'를 매체 이름으로 떼어 낸다.
export function splitGoogleTitle(title: string): { title: string; publisher: string | null } {
  const m = /^(.*\S)\s+-\s+([^-]{1,60})$/.exec(title);
  return m ? { title: m[1], publisher: m[2].trim() } : { title, publisher: null };
}
