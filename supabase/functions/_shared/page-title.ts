// 기사 쪽 제목 읽기 한 곳(S69 NEWS-제목늘읽기, 사용자 11/24 "제목은 읽어놔야 누르든 말든하지").
// - pageTitle(html, base?): og:title → twitter:title → <title> → 게시판 제목 칸 → 본문 h1·h2 순서로 한 줄 제목(사이트 이름뿐·게시판 이름뿐인 후보는 건너뜀, S70-44). 글자 풀기·500자 자르기. 없으면 null.
//   news-feed 원문 읽기(page.ts readArticlePage)와 아래 peekTitle이 같은 규칙을 쓴다.
// - titleKey(title): 같은 제목 알아보기 열쇠(예전 page.ts에서 옮김 — page.ts는 다시 내보낸다).
// - peekTitle(reader, url): 메신저 링크 미리보기처럼 받은 그 주소 한 장만 읽어 제목·매체 이름을 돌려준다.
//   읽는 규칙(열린 주소 검사·리다이렉트·크기·시간 상한·쿠키 없음)은 부르는 쪽이 넘긴 reader(_shared/feed-fetch.ts)가 정한다.
//   본문은 보지도 저장하지도 않는다. 봇 확인 쪽이면 제목 없음(null)으로 본다.
import { cut, looksLikeBotCheck, oneLine, stripTags } from "../outside-feed/parse.ts";
import { decodeEntitiesDeep, decodeText } from "./html-entities.ts";
import { ACCEPT_HTML, type FeedReader } from "./feed-fetch.ts";

export function metaContent(html: string, keys: string[]): string | null {
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

// 주소·도메인뿐인 제목은 제목이 아니다(화면이 '못 읽은 기사'로 보이고 다시 읽기 대상으로 남게).
const URLISH = /^(https?:\/\/\S+|(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?)$/i;

// S70-44(READ-제목사이트이름, 사용자 11/25 15:19 "제목을 전국철도노동조합으로 읽음 … 기사 제목을 읽어야함"):
// 게시판형 누리집(노조·단체 홈페이지 등)은 og:title·<title>이 사이트 이름뿐이고 글 제목은 본문 머리(게시판 제목 칸·h1·h2)에 있다.
// 그래서 후보를 차례로 보되, 사이트 이름뿐인 후보(og:site_name·앱 이름·로고 글자·주소의 사이트 조각과 같은 것)와
// 게시판 이름뿐인 후보('공지사항' 등)는 버리고 다음 후보로 간다. '글 제목 | 사이트' 꼴은 사이트 쪽을 떼고 글 제목만.
// 후보 순서: og:title → twitter:title → <title> → 게시판 제목 칸(class·id에 제목 이름표) → 본문 h1 → 본문 h2. 다 아니면 null
// (부르는 쪽이 공유 글 첫 줄·같은 기사 RSS 제목을 보고, 그래도 없으면 목록에서 뺀다 — 기존 규칙).
// base: 그 쪽 주소(있으면 주소의 사이트 조각도 사이트 이름으로 본다).
const SEP = /\s+[|\-–—:·•»>｜]\s+|\s*[|｜»]\s*/;
const GENERIC = new Set(["공지사항", "공지", "게시판", "자유게시판", "알림", "알림마당", "소식", "새소식", "뉴스", "보도자료", "성명", "성명서", "성명보도", "자료실",
  "홈", "메인", "home", "main", "index", "news", "notice", "board", "게시글", "글보기", "본문", "읽기", "view", "untitled", "제목없음"]);
const norm = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
const textOf = (raw: string) => cut(oneLine(decodeText(stripTags(decodeEntitiesDeep(raw)))), 500);

// 그 쪽이 스스로 밝힌 사이트 이름들(정규화한 열쇠). 본문은 저장하지 않고 이름표·로고 글자만 본다.
export function siteNames(html: string, base?: string): Set<string> {
  const out = new Set<string>();
  const add = (v: string | null | undefined) => { const k = v ? norm(textOf(v)) : ""; if (k.length >= 2) out.add(k); };
  for (const k of ["og:site_name", "application-name", "apple-mobile-web-app-title", "twitter:site", "author"]) add(metaContent(html, [k])?.replace(/^@/, ""));
  // 로고: class·id에 logo가 든 태그 안 글자·그림 alt, 첫 h1 안 그림 alt.
  for (const m of html.matchAll(/<(a|div|h1|span|p|strong)\b[^>]*(?:class|id)\s*=\s*["'][^"']*logo[^"']*["'][^>]*>([\s\S]{0,1500}?)<\/\1\s*>/gi)) {
    add(m[2]);
    for (const a of m[2].matchAll(/<img\b[^>]*\balt\s*=\s*["']([^"']{2,120})["']/gi)) add(a[1]);
  }
  for (const a of html.matchAll(/<img\b[^>]*(?:class|id|src)\s*=\s*["'][^"']*logo[^"']*["'][^>]*>/gi)) add(/\balt\s*=\s*["']([^"']{2,120})["']/i.exec(a[0])?.[1]);
  if (base) {
    try { for (const part of new URL(base).hostname.toLowerCase().replace(/^www\./, "").split(".")) if (part.length >= 3) out.add(part); } catch { /* 주소 아님 */ }
  }
  return out;
}

// 후보 하나 → 글 제목 또는 null(사이트 이름뿐·게시판 이름뿐·주소뿐).
function articlePart(t: string, sites: Set<string>): string | null {
  if (!t || URLISH.test(t)) return null;
  const k = norm(t);
  if (!k || sites.has(k) || GENERIC.has(k)) return null;
  // '글 제목 | 사이트' · '사이트 - 게시판 - 글 제목': 사이트 이름·게시판 이름 조각을 떼고 남은 조각들.
  const parts = t.split(SEP).map((x) => x.trim()).filter(Boolean);
  if (parts.length > 1) {
    const rest = parts.filter((x) => { const pk = norm(x); return pk && !sites.has(pk) && !GENERIC.has(pk); });
    if (!rest.length) return null;
    if (rest.length < parts.length) return rest.join(" - ");
  }
  return t;
}

const BOARD_TITLE = /(?:class|id)\s*=\s*["'][^"']*\b(bo_v_tit|bo_v_title|view_?tit\w*|view_?subject|tit_?view|board_?tit\w*|board_?view_?tit\w*|read_?tit\w*|read_header|rd_hd|np_18px|subject|article_?tit\w*|post_?tit\w*|post-title|entry-title|headline|title_?area|v_title|bbs_?tit\w*)\b[^"']*["']/i;
function headings(html: string): string[] {
  const at = html.search(/<body\b/i);
  const body = (at >= 0 ? html.slice(at) : html).replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, " ").slice(0, 400000);
  const out: string[] = [];
  // 게시판 제목 칸: 이름표가 붙은 태그(안쪽 글자만 — 같은 이름 태그가 안에 겹치면 가장 짧게 닫히는 곳까지).
  for (const m of body.matchAll(/<(h[1-4]|div|span|p|td|th|strong|dt|li|header)\b([^>]*)>([\s\S]{0,3000}?)<\/\1\s*>/gi)) {
    if (BOARD_TITLE.test(m[2])) out.push(m[3]);
    if (out.length >= 8) break;
  }
  for (const tag of ["h1", "h2"]) {
    let n = 0;
    for (const m of body.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]{0,3000}?)<\\/${tag}\\s*>`, "gi"))) { out.push(m[1]); if (++n >= 6) break; }
  }
  return out;
}

export function pageTitle(html: string, base?: string): string | null {
  const sites = siteNames(html, base);
  const metas = [metaContent(html, ["og:title"]), metaContent(html, ["twitter:title"]), /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1] ?? null];
  for (const raw of metas) {
    const t = raw ? articlePart(textOf(raw), sites) : null;
    if (t) return t;
  }
  for (const raw of headings(html)) {
    const t = textOf(raw);
    // 머리 글자는 짧은 조각(메뉴 이름 등)·아주 긴 덩어리(본문)를 제목으로 보지 않는다.
    const n = [...t].length;
    if (n < 4 || n > 200) continue;
    const a = articlePart(t, sites);
    if (a) return a;
  }
  return null;
}

export function titleKey(title: string): string | null {
  const t = title.replace(/\s+[-–—|]\s+[^-–—|]{1,40}$/, "").replace(/^\s*[\[(【<〈][^\])】>〉]{1,12}[\])】>〉]\s*/, "")
    .toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
  return t ? t.slice(0, 500) : null;
}

export type Peek = { title: string; publisher: string | null };
// 그 주소 한 장만 읽어 제목을 얻는다. 못 읽으면(막힘·늦음·제목 없음·봇 확인) null — 부르는 쪽은 그 줄을 그대로 두어 다음 수집이 다시 읽게 한다.
export async function peekTitle(reader: FeedReader, url: string): Promise<Peek | null> {
  return (await peekTitleWhy(reader, url)).peek;
}

// S70-17(NEWS-동아못읽음): 못 읽은 까닭 코드도 함께(로그 숫자용 — 주소·제목은 담지 않는다).
// why: 'ok' · 읽기 코드(timeout·network·http_403·redirect_loop·redirect_outside·too_large·url_outside 등, feed-fetch.ts) · 'bot_check' · 'no_title'.
// 동아일보 공유 기사가 '못 읽은 기사'로 남았을 때 화면·저장소만으로는 까닭(사이트 응답 쪽인지 제목 뽑기 쪽인지)을 가를 수 없어서 더했다.
export type PeekWhy = { peek: Peek | null; why: string };
export async function peekTitleWhy(reader: FeedReader, url: string): Promise<PeekWhy> {
  const got = await reader.get(url, ACCEPT_HTML);
  if (!got.ok) return { peek: null, why: whyCode(got.code) };
  const head = got.text.slice(0, 400000);
  if (looksLikeBotCheck(head)) return { peek: null, why: "bot_check" };
  const title = pageTitle(head, url);
  if (!title) return { peek: null, why: "no_title" };
  const publisher = cut(metaContent(head, ["og:site_name", "application-name"]) ?? "", 120) || null;
  return { peek: { title, publisher }, why: "ok" };
}
// 코드 모양만 통과(로그에 글자가 새지 않게). 모르는 모양은 'other'.
const whyCode = (code: string) => /^(http_\d{3}|[a-z_]{2,24})$/.test(code) ? code : "other";
// 까닭 코드별 건수 더하기(로그용).
export function countWhy(counts: Record<string, number>, why: string): Record<string, number> {
  counts[why] = (counts[why] ?? 0) + 1;
  return counts;
}
