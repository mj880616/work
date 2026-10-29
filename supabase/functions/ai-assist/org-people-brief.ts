// ai-assist 쓰임(kind=org_people_brief, ORG-주요인물): 순수 함수만 둔다(입출력은 handler.ts).
// 담당조직 상세 [주요 인물] 탭의 '요즘' 한 문장(조직 단위, 사람 이름 괄호). 화면은 조직 ID만 보내고 하루 한 번만 부탁한다
// (오늘 것이 있고 주요 인물이 그대로면 서버도 AI를 부르지 않고 저장된 문장을 돌려준다).
// - 재료는 서버가 내 로그인으로 읽는다: 최근 30일 업무 통화(상대·제목·요약), 열린 챙길 것, 기다리는 약속.
//   지정한 사람(찾을 이름)에 걸린 것만 보낸다. 텔레그램은 보내지 않는다(ai-assist의 통화 표 읽기는 source=call만 —
//   call-personal-box 시험 규칙, 텔레그램 보낸 사람 이름은 AI에 보내지 않는다는 TG-발언자이름 원칙).
//   개인 통화함은 화면에는 모으지만(결정) AI 재료로는 보내지 않는다(개인 통화 원문 보호).
// - 원문(raw_text)은 보내지 않는다. 요약 글만, 전화번호·이메일은 가린다(org-summary.ts cleanOrgText).
// - AI 답은 믿지 않는 입력: 글자 수·줄바꿈·제어 문자·연락처를 다시 검사한다.

import { cleanOrgText } from "./org-summary.ts";
import { outputText } from "../_shared/openai-responses.ts";
import { AI_TONE_RULE } from "../_shared/ai-model.ts";
// SEC-요약비밀가리기: 저장하는 AI 글에서 비밀 모양 값(비밀번호·현관·인증번호·토큰 등)을 [비밀]로 가린다(_shared/secret-redact.mjs).
import { AI_SECRET_RULE, redactSecrets } from "../_shared/secret-redact.mjs";

export const PEOPLE_BRIEF_DAYS = 30;
export const PEOPLE_BRIEF_MAX_PEOPLE = 40;
export const PEOPLE_BRIEF_MAX_ITEMS = 60;
export const PEOPLE_BRIEF_ITEM_CHARS = 300;
export const PEOPLE_BRIEF_INPUT_CHARS = 20000;
// DB 검사(app_org_key_people_briefs): brief 1~300자·제어문자 없음, detail 1~2000자.
export const PEOPLE_BRIEF_CHARS = 150;
export const PEOPLE_BRIEF_DETAIL_CHARS = 600;
export const PEOPLE_BRIEF_MAX_OUTPUT_TOKENS = 1000;
export const PEOPLE_BRIEF_READ_LIMIT = 300;

export type BriefPerson = { id: string; name: string; needles: string[] };
export type BriefItem = { day: string; type: "call" | "todo" | "promise"; who: string[]; text: string };

const chars = (s: string) => [...s].length;
const cut = (s: string, n: number) => [...s].slice(0, n).join("");
// 화면(org-key-people-model.mjs normName)과 같은 비교 규칙: 호환 문자 정리, 공백·가운뎃점 제거, 영문 소문자.
export const normName = (value: unknown) => String(value ?? "").normalize("NFKC").replace(/[\s·ㆍ.]+/gu, "").toLowerCase();

export function briefPeople(rows: Record<string, unknown>[]): BriefPerson[] {
  const out: BriefPerson[] = [];
  for (const r of rows) {
    if (typeof r.id !== "string" || typeof r.name !== "string" || !r.name.trim()) continue;
    const needles = new Set<string>();
    for (const v of [r.name, ...(Array.isArray(r.match_names) ? r.match_names : [])]) { const k = normName(v); if (chars(k) >= 2) needles.add(k); }
    out.push({ id: r.id.toLowerCase(), name: cut(r.name.trim(), 40), needles: [...needles] });
    if (out.length >= PEOPLE_BRIEF_MAX_PEOPLE) break;
  }
  return out;
}
// 글들 중 하나라도 그 사람의 찾을 이름을 품으면 그 사람 이름(지정 순서).
export function whoIn(texts: unknown[], people: BriefPerson[]): string[] {
  const hay = texts.map(normName).filter(Boolean);
  if (!hay.length) return [];
  return people.filter((p) => p.needles.some((n) => hay.some((h) => h.includes(n)))).map((p) => p.name);
}

// 재료 묶기: 최신순, 개수·총량 한도. 넘치면 partial.
export function packBriefItems(items: BriefItem[]) {
  const sorted = [...items].sort((a, b) => b.day.localeCompare(a.day));
  const packed: BriefItem[] = [];
  let used = 0, partial = false;
  for (const it of sorted) {
    const text = cleanOrgText(it.text, PEOPLE_BRIEF_ITEM_CHARS).replace(/\n+/g, " ");
    if (!text) continue;
    if (packed.length >= PEOPLE_BRIEF_MAX_ITEMS || used + chars(text) > PEOPLE_BRIEF_INPUT_CHARS) { partial = true; break; }
    packed.push({ ...it, text });
    used += chars(text) + 40;
  }
  return { packed, partial };
}

export function peopleBriefMaterial(orgName: string, people: BriefPerson[], items: BriefItem[], today: string): string {
  return JSON.stringify({
    today,
    organization: cut(orgName, 80),
    people: people.map((p) => p.name),
    records: items.map((i) => ({ day: i.day, type: i.type, who: i.who, text: i.text })),
  });
}

export const PEOPLE_BRIEF_INSTRUCTIONS = [
  "너는 노동조합 담당자의 업무 비서다. 한 담당조직의 주요 인물들에 관한 최근 기록(통화·챙길 것·약속)을 받는다.",
  "brief: 그 조직의 '요즘'을 한국어 한 문장(150자 이내, 줄바꿈 없음)으로 쓴다. 사람이 관련되면 문장 안에 사람 이름을 괄호로 붙인다. 예: 임금교섭 3차 일정 조율 중, 찬반투표 준비함(김OO).",
  "detail: 사람별 최근 흐름을 '- 이름: 내용' 줄로 3~6줄(600자 이내). 기록에 없는 일은 쓰지 않는다. 기록이 거의 없으면 detail은 빈 글자.",
  "전화번호·이메일·주민번호 같은 개인 연락처·식별 정보는 쓰지 않는다. 추측·평가·감정 표현을 하지 않는다. 날짜는 '10.24' 꼴.",
  AI_TONE_RULE,
  AI_SECRET_RULE,
].join("\n");

export const PEOPLE_BRIEF_SCHEMA = {
  type: "object",
  properties: { brief: { type: "string" }, detail: { type: "string" } },
  required: ["brief", "detail"],
  additionalProperties: false,
};

const PHONE = /(?:\+?82[-\s]?)?0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const CTRL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩]/g;
const TAGS = /<[^>]*>/g;

// AI 답 검사: brief는 한 줄 1~150자, detail은 600자까지(줄마다 연락처가 든 줄은 버림). 맞지 않으면 null.
// raw는 Responses 답 전체(handler) 또는 output_text 글자(시험).
export function parsePeopleBrief(raw: unknown): { brief: string; detail: string | null } | null {
  const text = typeof raw === "string" ? raw : outputText(raw);
  if (text === null) return null;
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.brief !== "string" || typeof o.detail !== "string") return null;
  const brief = redactSecrets(o.brief.replace(TAGS, "").replace(CTRL, "").replace(/\s+/g, " ").trim());
  if (!brief || PHONE.test(brief) || EMAIL.test(brief)) return null;
  const lines = o.detail.replace(TAGS, "").replace(/\r\n?/g, "\n").replace(CTRL, "").split("\n")
    .map((l) => redactSecrets(l.replace(/[ \t]+/g, " ").trim())).filter((l) => l && !PHONE.test(l) && !EMAIL.test(l)).slice(0, 8);
  const detail = cut(lines.join("\n"), PEOPLE_BRIEF_DETAIL_CHARS).trim();
  return { brief: cut(brief, PEOPLE_BRIEF_CHARS), detail: detail || null };
}
