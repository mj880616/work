// 언론 기사 거르기·등급(S63-10 NEWS-언론거르기, 11/16 12:22 명진 결정):
//   "주식 연예 스포츠 날씨 제외 노동 우선 / 사회 그 다음 정치 경제는 관련도 높은 것 위주로".
// 규칙은 여기 한 곳뿐이다. 수집기(news-feed runMedia)가 피드 글마다 newsRank로 받을지·등급을 정하고, 화면은 서버가 준 등급만 따른다(화면에 규칙 복제 금지).
// AI는 쓰지 않는다(비용) — 섹션(피드 주소)·카테고리 칸·기사 주소·제목 글자만 본다. 시험: tests/news-rank.test.mjs(맞는 예·안 맞는 예 표).
//
// 등급: 1 노동 > 2 사회 > 3 정치·경제(노동·공공 관련만). null = 받지 않음.
//   ① 노동 전문지·해외 노동 매체(beat: "labor")는 지금처럼 전부 1(거르지 않음).
//   ② 종합지·방송사·통신사: 늘 빼는 것(부고·인사·운세·날씨 꼬리표, 연예·스포츠·증권·날씨 섹션 주소·카테고리) → null.
//      주식·코인 낱말이 제목에 있으면 노동 낱말이 함께 있을 때만 남긴다.
//   ③ 노동 낱말(LABOR_WORDS)이 제목·소개에 있으면 섹션과 상관없이 1.
//   ④ 사회 섹션 → 2.
//   ④' 사설·칼럼 섹션(opinion, S69 NEWS-사설칼럼) → 2(사회와 같음 — 신문의 논설은 섹션 거르기 없이 받는다).
//   ⑤ 정치·경제 섹션 → 공공 낱말(PUBLIC_WORDS)·내 키워드·확정한 관심 주제 가운데 하나라도 맞으면 3, 아니면 null.
// 분야(S71-70 NEWS-수집처더하기·분야, 사용자 결정 2026-11-26 "정치 경제 사회 노동" / "칼럼 사설"): 언론 글은 이 다섯 분야만 받는다(newsField).
//   분야 피드(sections)는 그 피드의 분야. 섞인 피드(전체 피드)는 분야 칸(category)·기사 주소로 알아보고, 다섯 분야 밖(국제·문화·생활·IT·과학 등)으로
//   보이면 받지 않는다. 알아볼 정보가 없으면 매체 기본(mixedAs, 없으면 사회). 노동 전문지와 노동 낱말 글은 '노동'.
//   분야 피드는 지금처럼 피드를 믿는다(등급·받기가 바뀌지 않게). 지금 피드 실측(article-extract-live-check 분야 진단)은 PR 본문 표.
// 주제 묶음(NEWS-수집처늘리기, 사용자 요청 2026-11-28 "바이브 코딩쪽 양질의 글 … 아스날 및 해외축구 전술 분석 및 리뷰"):
//   beat "tech"(AI 코딩)·"football"(축구 전술)은 그 주제만 쓰는 블로그·뉴스레터라 거르지 않고 받는다(위 늘 빼는 규칙의 '스포츠·축구·IT'는 종합지용).
//   등급은 3(노동·사회 글 뒤 — 하루 목록에서 언론 기사를 밀어내지 않게), 분야 칸은 비운다(다섯 분야 밖 — DB 검사 app_news_articles_news_field_check 그대로).
//   하루에 받는 수는 매체마다 카탈로그 daily로 막는다(news-feed runMedia — 양이 많은 피드가 하루 목록을 덮지 않게, 외국어 제목 번역도 그만큼만).
import type { NewsSource } from "./news-catalog.ts";

export type NewsSection = "society" | "politics" | "economy" | "mixed" | "opinion";
export type NewsField = "politics" | "economy" | "society" | "labor" | "opinion";
// 화면 글자(목록 줄 작은 글자·걸러 보기 이름). 서버가 정한 분야 키만 이 이름으로 바꾼다.
export const NEWS_FIELD_LABEL: Readonly<Record<NewsField, string>> = Object.freeze({ politics: "정치", economy: "경제", society: "사회", labor: "노동", opinion: "칼럼·사설" });
export const NEWS_FIELDS: readonly NewsField[] = Object.freeze(["politics", "economy", "society", "labor", "opinion"] as NewsField[]);
export type NewsRank = 1 | 2 | 3;
export const RANK_LABOR = 1, RANK_SOCIETY = 2, RANK_RELATED = 3;

// 노동 낱말: 글자 그대로 들어 있으면(대소문자 무시) 노동 기사로 본다.
export const LABOR_WORDS: readonly string[] = Object.freeze([
  "노동", "노조", "파업", "임금", "임단협", "단체교섭", "교섭", "고용", "해고", "비정규", "정규직", "최저임금", "산재", "산업재해", "중대재해",
  "원청", "하청", "노란봉투", "근로", "노사", "쟁의", "민주노총", "한국노총", "공무직", "특수고용", "플랫폼 종사자", "택배기사", "주52시간", "주 52시간",
  "구조조정", "정리해고", "희망퇴직", "직장 내 괴롭힘", "체불",
]);
// 공공 낱말: 정치·경제 기사는 이 낱말(또는 노동 낱말·내 키워드·관심 주제)이 있어야 받는다.
export const PUBLIC_WORDS: readonly string[] = Object.freeze([
  "공공기관", "공기업", "공공부문", "공공서비스", "공공요금", "민영화", "민자", "철도", "지하철", "코레일", "교통공사", "공공운수",
  "연금", "돌봄", "공무원", "교육공무직",
]);

// 늘 빼는 꼬리표: 제목 앞 [부고]·[인사]·[오늘의 운세]·[날씨]·[포토] 같은 것.
const DROP_TAG = /^\s*[\[【(〈<]\s*(부고|부음|인사|동정|운세|오늘의\s*운세|띠별\s*운세|날씨|오늘\s*날씨|내일\s*날씨|기상|증시|마감\s*시황|시황|특징주|코인|가상자산|연예|스포츠|화보|포토|TV|영상|부동산\s*시세)\s*[\]】)〉>]/i;
// 늘 빼는 제목 글자(꼬리표 없이도): 운세·부고·인사 발령 공지.
const DROP_TITLE = /(오늘의\s*운세|띠별\s*운세|별자리\s*운세|^\s*부고\b|^\s*부음\b|^\s*\S+\s*인사\s*$|인사\s*발령\s*명단|◇\s*승진|▲\s*전무|▲\s*상무)/;
// 주식·코인 낱말: 노동 낱말이 함께 없으면 뺀다.
const STOCK_TITLE = /(특징주|상한가|하한가|코스피|코스닥|나스닥|다우지수|증시|주가|목표주가|공모주|상장\s*첫날|시총|시가총액|비트코인|이더리움|리플|가상자산|가상화폐|코인|ETF|선물\s*옵션|환율\s*마감|장중|마감시황)/i;
// 늘 빼는 섹션: 기사 주소 경로·피드 카테고리 칸.
//   S71-70: 부고 경로는 뒤에 이름이 붙은 꼴(`/obituary-…`)도 뺀다(실측: 종합지 사회 피드에 부고 경로 글).
const DROP_PATH = /\/(stock|stocks|finance\/stock|market|markets|invest|coin|crypto|bitcoin|entertain|entertainment|enter|star|culture\/entertain|sports?|baseball|soccer|golf|weather|fortune|obituar(y|ies)[a-z_-]*|people\/(obituary|appointment)|photo|gallery)(\/|$|\?|\.)/i;
// 카테고리 칸은 낱말 단위로 본다('인사이트' 같은 글자가 '인사'로 걸리지 않게).
const DROP_CATEGORY_WORD = /^(증권|증시|주식|코인|가상자산|가상화폐|연예|엔터테인먼트|엔터|스포츠|야구|축구|골프|농구|배구|날씨|기상|운세|부고|부음|인사|포토|화보|게임|entertainment|sports?|stocks?|weather|obituar(y|ies)|photos?)(일반|종합|가요|방송|영화)?$/i;
export const dropCategory = (category: string) => category.split(/[,/>|·:\s]+/).some((w) => DROP_CATEGORY_WORD.test(w.trim()));
// 섹션 알아보기(섹션이 섞인 피드): 카테고리 칸·기사 주소.
const SOCIETY_HINT = /(사회|전국|지역|노동|사건|교육|환경|society|national|local)/i;
const POLITICS_HINT = /(정치|국회|북한|외교|politic)/i;
const ECONOMY_HINT = /(경제|산업|금융|부동산|기업|economy|industry|business)/i;
// S71-70 분야: 칼럼·사설 알아보기, 다섯 분야 밖 알아보기(섞인 피드에서만 — 이 낱말만 있고 위 분야 낱말이 없으면 받지 않음).
const OPINION_HINT = /(사설|칼럼|오피니언|논설|기고|opinion|column|editorial)/i;
//   로마자 낱말은 낱말 단위로만(다른 낱말 속 글자가 걸리지 않게).
const OFF_FIELD_HINT = /(국제|세계|해외|문화|생활|라이프|여행|건강|의학|과학|테크|자동차|게임|(^|[^a-z])(it|world|international|global|culture|living|life|lifestyle|travel|health|science|tech|tech_it|future|auto|cars?|games?)([^a-z]|$))/i;

export type RankInput = {
  source: Pick<NewsSource, "beat" | "sections" | "mixedAs" | "lists">;
  list: string; // 이 글이 나온 피드 주소(source.lists 가운데 하나)
  title: string;
  summary?: string | null;
  url: string;
  category?: string | null;
  words?: readonly string[]; // 내 키워드 + 확정한 관심 주제(뉴스를 쓰는 작업공간 합집합)
};

const has = (hay: string, words: readonly string[]) => {
  const h = hay.toLowerCase();
  return words.some((w) => { const k = w.trim().toLowerCase(); return !!k && h.includes(k); });
};
const pathOf = (url: string) => { try { return new URL(url).pathname; } catch { return ""; } };

// 피드 주소 → 섹션. 카탈로그 sections가 lists와 같은 차례로 적혀 있다. 없으면 섞인 피드.
export function listSection(source: Pick<NewsSource, "sections" | "lists">, list: string): NewsSection {
  const i = source.lists.indexOf(list);
  return (i >= 0 ? source.sections?.[i] : undefined) ?? "mixed";
}

// 섞인 피드 글의 섹션: 카테고리 칸 → 기사 주소 → 매체 기본값(mixedAs, 없으면 사회).
//   S71-70: 칼럼·사설이면 opinion, 다섯 분야 밖으로만 보이면 null(받지 않음). 주소는 첫 두 경로 조각만 본다(기사 번호·제목 조각이 낱말로 걸리지 않게).
function guessSection(category: string, path: string, fallback: Exclude<NewsSection, "mixed" | "opinion">): Exclude<NewsSection, "mixed"> | null {
  const head = path.split("/").filter(Boolean).slice(0, 2).map((x) => x.replace(/\.[a-z]+$/i, "")).join("/");
  for (const s of [category, head]) {
    if (!s) continue;
    if (OPINION_HINT.test(s)) return "opinion";
    if (SOCIETY_HINT.test(s)) return "society";
    if (POLITICS_HINT.test(s)) return "politics";
    if (ECONOMY_HINT.test(s)) return "economy";
    if (OFF_FIELD_HINT.test(s)) return null;
  }
  return fallback;
}

// 받을 글이면 { rank, field }, 받지 않으면 null. 거르기·등급·분야를 한 번에 정한다(같은 규칙 한 곳). field null = 분야 칸 비움(주제 묶음).
export function newsPick(input: RankInput): { rank: NewsRank; field: NewsField | null } | null {
  if (input.source.beat === "labor") return { rank: RANK_LABOR, field: "labor" };
  if (input.source.beat === "tech" || input.source.beat === "football") return { rank: RANK_RELATED, field: null };
  const title = String(input.title ?? "");
  const text = `${title}\n${input.summary ?? ""}`;
  const category = String(input.category ?? "");
  const path = pathOf(input.url);
  if (DROP_TAG.test(title) || DROP_TITLE.test(title) || DROP_PATH.test(path) || (category !== "" && dropCategory(category))) return null;
  const labor = has(text, LABOR_WORDS);
  if (STOCK_TITLE.test(title) && !labor) return null;
  const listed = listSection(input.source, input.list);
  const section = listed === "mixed" ? guessSection(category, path, input.source.mixedAs ?? "society") : listed;
  if (section === null) return null; // 섞인 피드에서 다섯 분야 밖(국제·문화·생활 등)
  // 칼럼·사설은 노동 낱말이 있어도 분야는 칼럼·사설(등급만 노동).
  if (labor) return { rank: RANK_LABOR, field: section === "opinion" ? "opinion" : "labor" };
  if (section === "society" || section === "opinion") return { rank: RANK_SOCIETY, field: section };
  return has(text, PUBLIC_WORDS) || has(text, input.words ?? []) ? { rank: RANK_RELATED, field: section } : null;
}
export function newsRank(input: RankInput): NewsRank | null {
  return newsPick(input)?.rank ?? null;
}
export function newsField(input: RankInput): NewsField | null {
  return newsPick(input)?.field ?? null;
}
