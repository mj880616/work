// 기사 쪽 제목 읽기 한 곳(S69 NEWS-제목늘읽기, 명진 11/24 "제목은 읽어놔야 누르든 말든하지").
// - pageTitle(html): og:title → twitter:title → <title> 순서로 한 줄 제목. 글자 풀기·꼬리표 없애기·500자 자르기. 없으면 null.
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

export function pageTitle(html: string): string | null {
  const raw = metaContent(html, ["og:title", "twitter:title"]) ?? /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1] ?? "";
  const t = cut(oneLine(decodeText(stripTags(decodeEntitiesDeep(raw)))), 500);
  return t && !URLISH.test(t) ? t : null;
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
  const title = pageTitle(head);
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
