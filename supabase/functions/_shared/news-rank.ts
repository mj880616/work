// 언론 기사 거르기·등급(S63-10 NEWS-언론거르기, 11/16 12:22 사용자 결정):
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
import type { NewsSource } from "./news-catalog.ts";

export type NewsSection = "society" | "politics" | "economy" | "mixed" | "opinion";
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
const DROP_PATH = /\/(stock|stocks|finance\/stock|market|markets|invest|coin|crypto|bitcoin|entertain|entertainment|enter|star|culture\/entertain|sports?|baseball|soccer|golf|weather|fortune|obituar(y|ies)|people\/(obituary|appointment)|photo|gallery)(\/|$|\?|\.)/i;
// 카테고리 칸은 낱말 단위로 본다('인사이트' 같은 글자가 '인사'로 걸리지 않게).
const DROP_CATEGORY_WORD = /^(증권|증시|주식|코인|가상자산|가상화폐|연예|엔터테인먼트|엔터|스포츠|야구|축구|골프|농구|배구|날씨|기상|운세|부고|부음|인사|포토|화보|게임|entertainment|sports?|stocks?|weather|obituar(y|ies)|photos?)(일반|종합|가요|방송|영화)?$/i;
export const dropCategory = (category: string) => category.split(/[,/>|·:\s]+/).some((w) => DROP_CATEGORY_WORD.test(w.trim()));
// 섹션 알아보기(섹션이 섞인 피드): 카테고리 칸·기사 주소.
const SOCIETY_HINT = /(사회|전국|지역|노동|사건|교육|환경|society|national|local)/i;
const POLITICS_HINT = /(정치|국회|북한|외교|politic)/i;
const ECONOMY_HINT = /(경제|산업|금융|부동산|기업|economy|industry|business)/i;

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
function guessSection(category: string, path: string, fallback: Exclude<NewsSection, "mixed" | "opinion">): Exclude<NewsSection, "mixed" | "opinion"> {
  for (const s of [category, path]) {
    if (!s) continue;
    if (SOCIETY_HINT.test(s)) return "society";
    if (POLITICS_HINT.test(s)) return "politics";
    if (ECONOMY_HINT.test(s)) return "economy";
  }
  return fallback;
}

export function newsRank(input: RankInput): NewsRank | null {
  if (input.source.beat === "labor") return RANK_LABOR;
  const title = String(input.title ?? "");
  const text = `${title}\n${input.summary ?? ""}`;
  const category = String(input.category ?? "");
  const path = pathOf(input.url);
  if (DROP_TAG.test(title) || DROP_TITLE.test(title) || DROP_PATH.test(path) || (category !== "" && dropCategory(category))) return null;
  const labor = has(text, LABOR_WORDS);
  if (STOCK_TITLE.test(title) && !labor) return null;
  if (labor) return RANK_LABOR;
  let section = listSection(input.source, input.list);
  if (section === "mixed") section = guessSection(category, path, input.source.mixedAs ?? "society");
  if (section === "society" || section === "opinion") return RANK_SOCIETY;
  return has(text, PUBLIC_WORDS) || has(text, input.words ?? []) ? RANK_RELATED : null;
}
