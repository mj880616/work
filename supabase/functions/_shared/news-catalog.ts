// 뉴스 클리핑 카탈로그(NEWS-클리핑 B, 설계 docs/design/news-clipping.md 3절 + S47-44 결정).
// 서버(news-feed)가 '자동'으로 읽는 주소는 이 목록뿐이다. 화면·요청 몸통은 주소를 보낼 수 없고 매체 키만 고른다(SSRF 차단).
// 모양은 바깥 성명 카탈로그(OutsideSource)와 같아서 RSS 해석·주소 검사(parseFeed·allowedUrl)를 그대로 함께 쓴다.
// 키는 app_outside_sources에 'news-' 앞머리로 들어간다(사회운동 Now 단체 키와 섞이지 않음).
// 넣은 것: 설계 3절에서 RSS 주소가 [사실]로 확인된 곳만. 나머지([추정]·RSS 없음)는 넣지 않고 키워드(구글 뉴스 RSS)로만 잡는다(N8).
//   robots.txt는 수집기가 실행 때마다 직접 읽고 막혀 있으면 건너뛴다(우회 없음).
// 뺀 것(결정): 네이버 검색 API(약관상 AI 요약·자동 수집 금지 — 쓰지 않음), Equal Times(발행 중단), AP·Reuters·NHK·共同通信(노동 분야 공개 피드 확인 못 함 → 키워드로만, N10),
//   정책브리핑(RSS 중단 — 공식 API 서비스 키가 생기면 별도 PR, N9).
// 새 매체는 여기 한 줄 더하는 작은 PR로만 넣는다(Edge 재배포 정지 지점).
import type { OutsideSource } from "./outside-catalog.ts";

export type NewsSource = OutsideSource & { region: "domestic" | "foreign"; paid?: boolean };

const article = () => "article" as const;

export const NEWS_CATALOG: readonly NewsSource[] = Object.freeze([
  { key: "news-labortoday", name: "매일노동뉴스", group: "movement", region: "domestic", lang: "ko", mode: "rss",
    lists: ["https://www.labortoday.co.kr/rss/allArticle.xml"], hosts: ["www.labortoday.co.kr", "labortoday.co.kr"], kindOf: article },
  { key: "news-beminor", name: "비마이너", group: "movement", region: "domestic", lang: "ko", mode: "rss",
    lists: ["https://www.beminor.com/rss/allArticle.xml"], hosts: ["www.beminor.com", "beminor.com"], kindOf: article },
  { key: "news-pressian", name: "프레시안", group: "movement", region: "domestic", lang: "ko", mode: "rss",
    lists: ["https://www.pressian.com/rss"], hosts: ["www.pressian.com", "pressian.com"], kindOf: article },
  { key: "news-psi", name: "PSI", group: "foreign", region: "foreign", lang: "en", mode: "rss",
    lists: ["https://publicservices.international/feed.xml"], hosts: ["publicservices.international"], kindOf: article },
  { key: "news-itf", name: "ITF", group: "foreign", region: "foreign", lang: "en", mode: "rss",
    lists: ["https://www.itfglobal.org/en/rss/feed"], hosts: ["www.itfglobal.org", "itfglobal.org"], kindOf: article },
  { key: "news-labourstart", name: "LabourStart(아시아)", group: "foreign", region: "foreign", lang: "en", mode: "rss",
    lists: ["https://www.labourstart.org/rdf/labourstart.asia.rss"], hosts: ["www.labourstart.org", "labourstart.org"], kindOf: article },
] as NewsSource[]);

export const NEWS_SOURCE_KEYS: readonly string[] = Object.freeze(NEWS_CATALOG.map((s) => s.key));
export function newsSourceByKey(key: unknown): NewsSource | null {
  return typeof key === "string" ? NEWS_CATALOG.find((s) => s.key === key) ?? null : null;
}
export function publicNewsCatalog() {
  return NEWS_CATALOG.map((s) => ({ key: s.key, name: s.name, region: s.region, lang: s.lang }));
}

// 키워드 찾기: 구글 뉴스 검색 RSS 한 호스트·한 경로만. 검색어는 서버가 키워드로 만든다(화면은 주소를 보내지 않음).
// 링크는 구글 중계 주소 그대로 둔다(풀지 않음, N3). 누르면 브라우저가 원문으로 넘어간다.
export const GOOGLE_NEWS: OutsideSource = Object.freeze({
  key: "news-google", name: "구글 뉴스", group: "foreign", lang: "ko", mode: "rss",
  lists: [], hosts: ["news.google.com"], kindOf: article,
}) as OutsideSource;
export function googleNewsUrl(word: string): string {
  const q = `"${word.replace(/"/g, " ").trim()}" when:1d`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`;
}
