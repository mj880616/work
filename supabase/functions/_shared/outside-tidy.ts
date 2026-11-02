// 바깥 글 정돈(OUTSIDE-노동묶음·정돈 1단계, 설계 docs/design/outside-statements.md 11절): 순수 함수, 네트워크·DB 없음.
// 단체마다 목록·글 쪽 모양이 달라도, 저장하기 전에 이 한 곳에서 같은 글 모양으로 맞춘다.
// - 제목: 한 줄. 단체명·'[성명]' 같은 종류 꼬리표·날짜 꼬리는 뗀다. 길면 '제목 - 부제'에서 부제를 따로 떼어 요약 재료로 돌린다.
// - 본문: 메뉴·공유 단추·첨부 안내·조회수 같은 짧은 덧줄은 뺀다(문장만).
// - 한 문장 요약: 한 줄, 같은 길이 상한.
// 쓰는 곳: outside-feed(사회운동 Now 수집)와 news-feed(뉴스 클리핑, 제목만). 종류(kind) 판정은 꼬리표를 떼기 전 제목으로 한다(카탈로그 kindOf).

export const TITLE_SOFT_MAX = 100;   // 이보다 긴 제목은 부제를 떼고, 그래도 길면 낱말 경계에서 자르고 '…'
export const SUBTITLE_MAX = 200;
export const SUMMARY_MAX = 200;
const SPLIT_FROM = 40;               // 이보다 긴 제목만 '제목 - 부제'로 나눈다(짧은 제목의 ' - '는 제목의 일부로 둔다)

const chars = (s: string) => [...s].length;
const one = (s: string) =>
  // deno-lint-ignore no-control-regex
  s.replace(/[\u0000-\u001f\u007f-\u009f​﻿]/g, " ").replace(/\s+/g, " ").trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// 단체 이름을 빈칸 차이 없이 찾는 정규식 조각('노동자연대' ↔ '노동자 연대').
const loose = (name: string) => [...name.replace(/\s+/g, "")].map(esc).join("\\s?");

// 종류 꼬리표 낱말(빈칸 무시). 이 말이 든 괄호 꼬리표만 뗀다([단독]·[주간홍보] 같은 다른 머리말은 그대로 둔다).
const KIND_WORD = /(성명|논평|보도자료|기자회견|입장|브리핑|발언|논설|칼럼|규탄|공동성명|결의문|호소문|선언)/;
const OPEN = "[\\[<(【〈「《（]";
const CLOSE = "[\\]>)】〉」》）]";
const LEAD_TAG = new RegExp(`^\\s*${OPEN}\\s*([^\\]>)】〉」》）]{1,30}?)\\s*${CLOSE}\\s*`);
const TAIL_TAG = new RegExp(`\\s*${OPEN}\\s*([^\\[<(【〈「《（]{1,30}?)\\s*${CLOSE}\\s*$`);
const DATE_IN = /^(20\d{2}\s*[.\-/년]\s*)?\d{1,2}\s*[.\-/월]\s*\d{1,2}\s*일?\s*\.?(\s*\([월화수목금토일]\))?$/;
const TAIL_DATE = /\s*[,·\-–—|]?\s*20\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}\s*일?\.?\s*$/;
const SEP = /\s+[-–—|]\s+|\s*[|｜]\s*/;

function isKindTag(inner: string, name: string): boolean {
  const flat = inner.replace(/\s+/g, "");
  if (KIND_WORD.test(flat)) return true;
  if (name && flat.includes(name.replace(/\s+/g, ""))) return true;
  return DATE_IN.test(inner.trim());
}

// 제목 한 줄 정돈. name: 단체 이름(카탈로그 name, 없으면 ""). split=false면 '제목 - 부제' 나누기를 하지 않는다(뉴스 기사 제목).
export function tidyTitle(raw: string, name = "", opts: { split?: boolean } = {}): { title: string; subtitle: string | null } {
  const lines = String(raw ?? "").split(/\r?\n/).map(one).filter(Boolean);
  let t = lines[0] ?? "";
  let subtitle: string | null = lines.length > 1 && chars(lines[1]) <= SUBTITLE_MAX ? lines[1] : null;
  const nameRe = name ? loose(name) : "";
  for (let i = 0; i < 4; i++) {
    const before = t;
    const lead = LEAD_TAG.exec(t);
    if (lead && isKindTag(lead[1], name) && chars(t) > chars(lead[0]) + 1) t = t.slice(lead[0].length);
    const tail = TAIL_TAG.exec(t);
    if (tail && isKindTag(tail[1], name) && tail.index > 1) t = t.slice(0, tail.index);
    // 맨 앞 '단체명 (학생그룹) 성명: …'·'성명 — …'(괄호 없는 머리말)
    if (nameRe) t = t.replace(new RegExp(`^\\s*${nameRe}(\\s?[가-힣]{1,6}그룹)?\\s?${KIND_WORD.source}?\\s*[:：\\-–—|]\\s*(?=\\S)`), "");
    t = t.replace(new RegExp(`^\\s*${KIND_WORD.source}\\s*[:：]\\s*(?=\\S)`), "");
    // 맨 뒤 ' - 단체명'·' | 단체명'(글 쪽 <title>·og:title 꼬리), 날짜 꼬리
    if (nameRe) t = t.replace(new RegExp(`\\s*[-–—|:｜]\\s*${nameRe}\\s*$`), "");
    t = t.replace(TAIL_DATE, "");
    t = t.trim();
    if (t === before) break;
  }
  if (!t) t = lines[0] ?? "";
  if (opts.split !== false && chars(t) > SPLIT_FROM) {
    const m = SEP.exec(t);
    if (m && m.index >= 4 && chars(t.slice(0, m.index)) >= 4) {
      const head = t.slice(0, m.index).trim(), rest = t.slice(m.index + m[0].length).trim();
      if (rest) { subtitle = subtitle ?? cutWord(rest, SUBTITLE_MAX); t = head; }
    }
  }
  return { title: cutWord(t, TITLE_SOFT_MAX), subtitle: subtitle ? cutWord(subtitle, SUBTITLE_MAX) : null };
}

// 긴 글자를 낱말 경계에서 자르고 '…'.
export function cutWord(s: string, max: number): string {
  const c = [...s];
  if (c.length <= max) return s;
  const head = c.slice(0, max - 1).join("");
  const sp = head.lastIndexOf(" ");
  return (sp > max * 0.6 ? head.slice(0, sp) : head).replace(/[\s,·\-–—|:]+$/, "") + "…";
}

// 글 쪽 제목(og:title·<title>)이 목록 제목보다 짧고 목록 제목 안에 들어 있으면 그것을 제목으로(목록 칸에 부제·본문 앞부분이 붙은 단체).
// 빈칸 차이는 무시한다. 들어 있지 않으면(다른 글·사이트 이름뿐) null.
export function pageTitleFrom(html: string): string | null {
  const og = /<meta\b[^>]*\bproperty\s*=\s*["']og:title["'][^>]*>/i.exec(html)?.[0];
  const v = og ? /\bcontent\s*=\s*(?:"([^"]{1,1000})"|'([^']{1,1000})')/i.exec(og) : null;
  const raw = v ? (v[1] ?? v[2]) : /<title\b[^>]*>([^<]{1,1000})<\/title\s*>/i.exec(html)?.[1];
  if (!raw) return null;
  const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", ndash: "–", mdash: "—", middot: "·", hellip: "…" };
  const t = one(raw.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, e: string) => {
    if (e[0] !== "#") return named[e.toLowerCase()] ?? m;
    const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) && n > 31 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : " ";
  }));
  return t || null;
}
export function betterTitle(listTitle: string, pageTitle: string | null, name = ""): string | null {
  if (!pageTitle) return null;
  const flat = (s: string) => s.replace(/\s+/g, "");
  const p = tidyTitle(pageTitle, name, { split: false }).title.replace(/…$/, "");
  const l = tidyTitle(listTitle, name, { split: false }).title;
  if (chars(flat(p)) < 4 || !flat(listTitle).includes(flat(p))) return null;
  return chars(p) < chars(l) || /…$/.test(l) ? p : null;
}

// 본문 덧줄: 짧은 줄(30자 안쪽)이 메뉴·공유·첨부·조회수 같은 말뿐이면 본문이 아니다. 긴 문장은 건드리지 않는다.
const NOISE_LINE = /^(첨부\s*파일|첨부|다운로드|파일\s*받기|조회\s*수?|조회|추천|좋아요|댓글\s*\d*|작성자|글쓴이|등록일|작성일|게시일|수정일|날짜|분류|카테고리|태그|공유|공유하기|인쇄|프린트|URL\s*복사|주소\s*복사|링크\s*복사|페이스북|트위터|카카오(톡|스토리)?|밴드|facebook|twitter|kakao|print|share|tags?|목차|맨\s*위로|top)(\s*[:：]?\s*[\w가-힣.,\-/ ]{0,20})?$/i;
// 글 머리 정보 줄('작성자 … 작성일 … 조회 …'): 머리 낱말이 둘 넘게 든 80자 안쪽 줄.
const META_WORD = /(작성자|글쓴이|작성일|등록일|게시일|수정일|조회(수)?|추천|좋아요|댓글|분류)\s*[:：]?/g;
export function isNoiseLine(line: string): boolean {
  const l = one(line);
  if (!l) return true;
  if (chars(l) <= 30 && NOISE_LINE.test(l)) return true;
  return chars(l) <= 80 && (l.match(META_WORD)?.length ?? 0) >= 2;
}

// 한 문장 요약 정돈: 한 줄, '요약:' 머리 떼기, SUMMARY_MAX자 상한(낱말 경계 + '…'). 비면 null.
export function tidySummary(raw: string | null | undefined): string | null {
  const s = one(String(raw ?? "")).replace(/^(한\s?문장\s?)?요약\s*[:：]\s*/, "");
  return s ? cutWord(s, SUMMARY_MAX) : null;
}
