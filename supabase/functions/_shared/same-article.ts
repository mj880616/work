// S70-17b NEWS-제목꼭얻기(명진 11/25 10:26 "원문 못읽어도 최소한 제목이라도 읽어야함"): 원문 쪽을 못 받아도 같은 기사의 RSS 줄 제목을 쓴다.
// - 같은 기사 규칙은 매체 표(news-catalog.ts의 sameArticle) 한 곳. 주소 모양이 달라도(공유·모바일·amp) 기사 번호가 같으면 같은 기사다.
// - 읽는 곳은 우리 DB의 공용 기사 표(매체 RSS가 이미 넣은 줄)뿐이다 — 바깥 사이트를 더 부르지 않는다(외부 호출 주소 범위·User-Agent·인증 그대로).
// - 돌려주는 것은 그 RSS 줄의 제목·매체 이름뿐(이미 모든 가입자가 보는 공용 줄의 칸). 로그에는 건수만 남긴다(부르는 쪽).
import { NEWS_CATALOG } from "./news-catalog.ts";

const REF = /^[0-9A-Za-z_-]{3,40}$/;
const ruled = NEWS_CATALOG.filter((s) => s.sameArticle);

// 주소 → {매체 키, 기사 번호}. 규칙이 있는 매체 주소가 아니면 null.
export function sameArticleRef(url: string): { source: string; ref: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase();
  for (const s of ruled) {
    const rule = s.sameArticle!;
    if (host !== rule.site && !host.endsWith(`.${rule.site}`)) continue;
    const ref = rule.ref(u);
    return ref && REF.test(ref) ? { source: s.key, ref } : null;
  }
  return null;
}

// 규칙이 있는 매체 도메인들(오래된 제목 없는 줄을 고를 때 주소 조건으로 쓴다 — PostgREST or 조각).
export const SAME_ARTICLE_SITES: readonly string[] = Object.freeze(ruled.map((s) => s.sameArticle!.site));
export const sameArticleUrlFilter = () => `or=(${SAME_ARTICLE_SITES.map((d) => `url.like.*${encodeURIComponent(d)}*`).join(",")})`;

export type SameTitle = { title: string; publisher: string | null };
type Get = (path: string) => Promise<Record<string, unknown>[]>;
// 같은 기사의 RSS 줄 제목. 그 매체 줄(source_key) 가운데 주소에 기사 번호가 든 줄을 몇 개 읽어 규칙으로 다시 맞춰 본다. 없으면 null.
export async function sameArticleTitle(get: Get, url: string): Promise<SameTitle | null> {
  const want = sameArticleRef(url);
  if (!want) return null;
  const rows = await get(`app_news_articles?source_key=eq.${encodeURIComponent(want.source)}&title=not.is.null&url=like.${encodeURIComponent(`*${want.ref}*`)}` +
    `&select=url,title,publisher&order=created_at.desc&limit=5`);
  for (const a of rows) {
    if (typeof a.url !== "string" || typeof a.title !== "string" || !a.title.trim()) continue;
    const got = sameArticleRef(a.url);
    if (!got || got.source !== want.source || got.ref !== want.ref) continue;
    return { title: a.title.trim().slice(0, 500), publisher: typeof a.publisher === "string" && a.publisher.trim() ? a.publisher.trim().slice(0, 120) : null };
  }
  return null;
}
