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

// take: 'all'(그 매체 글을 키워드 상관없이 전부 받음 — 운동·노동 매체) / 'keywords'(키워드 목록에 글자가 맞는 글만 — 종합지·방송사, NEWS-매체늘리기).
// 없으면 'all'. 지금 카탈로그는 모두 'all'.
export type NewsSource = OutsideSource & { region: "domestic" | "foreign"; paid?: boolean; take?: "all" | "keywords" };

const article = () => "article" as const;

export const NEWS_CATALOG: readonly NewsSource[] = Object.freeze([
  { key: "news-labortoday", name: "매일노동뉴스", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all",
    lists: ["https://www.labortoday.co.kr/rss/allArticle.xml"], hosts: ["www.labortoday.co.kr", "labortoday.co.kr"], kindOf: article },
  { key: "news-beminor", name: "비마이너", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all",
    lists: ["https://www.beminor.com/rss/allArticle.xml"], hosts: ["www.beminor.com", "beminor.com"], kindOf: article },
  { key: "news-pressian", name: "프레시안", group: "movement", region: "domestic", lang: "ko", mode: "rss", take: "all",
    // https://www.pressian.com/rss 는 RSS 안내 HTML 쪽이라 0건이었다(11/04). 실제 피드는 /api/v3/site/rss/news(요청함은 http로 확인).
    // 카탈로그는 https만 허용(tests/security/news-feed.test.mjs)이라 https로 둔다 — 배포 전 CC가 이 주소가 열리는지 확인하고, 안 열리면 배포하지 말고 명진에게 보고(http 허용은 보안 시험을 바꾸는 결정).
    lists: ["https://www.pressian.com/api/v3/site/rss/news"], hosts: ["www.pressian.com", "pressian.com"], kindOf: article },
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

// take=keywords 매체(종합지·방송사)의 글 거르기: 제목+소개에 키워드 낱말이 글자 그대로 들어 있으면 통과(AI 없이 글자 일치, 대소문자·앞뒤 공백 무시).
export function matchedKeywords(text: string, words: readonly string[]): string[] {
  const hay = text.toLowerCase();
  const out: string[] = [];
  for (const w of words) {
    const k = w.trim().toLowerCase();
    if (k && hay.includes(k) && !out.includes(w)) out.push(w);
  }
  return out;
}
