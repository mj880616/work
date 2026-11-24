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
  const got = await reader.get(url, ACCEPT_HTML);
  if (!got.ok) return null;
  const head = got.text.slice(0, 400000);
  if (looksLikeBotCheck(head)) return null;
  const title = pageTitle(head);
  if (!title) return null;
  const publisher = cut(metaContent(head, ["og:site_name", "application-name"]) ?? "", 120) || null;
  return { title, publisher };
}
