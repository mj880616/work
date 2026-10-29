// 성명·보도자료 초안(kind=press_draft, FEAT-1029묶음 ④, docs/design/feature-bundle-1029.md 4절, 명진 결정 10/29 4-①~④).
// 순수 함수만 둔다(요청 검사, 재료 만들기, 지시문, 답 형식, 답 검사). 입출력(사업 보고 읽기·AI 부르기·기록)은 handler.ts.
// - 근거는 사업 보고·회의 기록(app_meetings)만(4-①). 화면은 고른 ID만 보내고, 서버가 호출한 사람의 로그인으로 다시 읽는다(owner RLS).
// - 종류는 성명·보도자료 둘(4-②). 문체는 press-style.ts의 고정 2편(4-③).
// - 근거 번호 검사는 공용 함수(evidence.ts, '물어보기'와 같은 꼬리표 s1…)를 쓴다. 근거 없는 문단·요구는 버린다.
// - 서버는 아무것도 저장하지 않는다. 화면이 미리보기를 보여 주고, 명진이 [노트로 저장]을 누를 때만 노트가 된다(AI 재료 제외, 4-④).
import { EVIDENCE_RULE, evidenceLines, maskEvidenceText, EMAIL, PHONE, type EvidenceLine } from "./evidence.ts";
import { looksSecret } from "./note-title.ts";
import { RELEASE_EXAMPLE, RELEASE_STYLE, STATEMENT_EXAMPLE, STATEMENT_STYLE } from "./press-style.ts";

export type PressType = "statement" | "release";
export const PRESS_TYPE_LABEL: Readonly<Record<PressType, string>> = Object.freeze({ statement: "성명", release: "보도자료" });
export const PRESS_LIMITS = Object.freeze({
  refs: 5, // 고르는 근거 최대 수(화면과 같음)
  meetingChars: 6000, // 회의마다 앞 6,000자
  totalChars: 20000, // 근거 합계 2만 자
  direction: 80, // 한 줄 방향(선택)
  title: 80,
  subtitle: 120,
  paragraphs: 12,
  paragraphChars: 700,
  body: 4000, // 본문(문단 합계) 4,000자
  demands: 6,
  demandChars: 160,
  checks: 10,
  checkChars: 120,
  maxOutputTokens: 3000,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2028\u2029\u2060-\u2069]/;
const chars = (s: string) => [...s].length;

export type PressInput = { kind: "press_draft"; type: PressType; meeting_ids: string[]; direction: string };
// 요청 몸통 검사: {kind, type, meeting_ids(1~5개, 겹침 없음), direction?}. 그 밖의 칸은 거절(근거 글을 화면이 보내지 못하게).
export function parsePressBody(b: Record<string, unknown>): PressInput | null {
  const keys = Object.keys(b);
  if (keys.some((k) => !["kind", "type", "meeting_ids", "direction"].includes(k))) return null;
  if (b.type !== "statement" && b.type !== "release") return null;
  if (!Array.isArray(b.meeting_ids) || b.meeting_ids.length < 1 || b.meeting_ids.length > PRESS_LIMITS.refs) return null;
  const ids: string[] = [];
  for (const v of b.meeting_ids) {
    if (typeof v !== "string" || !UUID.test(v)) return null;
    const id = v.toLowerCase();
    if (ids.includes(id)) return null;
    ids.push(id);
  }
  let direction = "";
  if (b.direction !== undefined && b.direction !== null) {
    if (typeof b.direction !== "string" || CONTROL.test(b.direction) || /[<>]/.test(b.direction)) return null;
    direction = b.direction.replace(/\s+/g, " ").trim();
    if (chars(direction) > PRESS_LIMITS.direction) return null;
  }
  return { kind: "press_draft", type: b.type, meeting_ids: ids, direction };
}

// 재료 한 건: 서버가 다시 읽은 사업 보고. ref는 s1… (화면·DB id는 AI에 가지 않는다).
export type PressSource = { ref: string; id: string; title: string; day: string; text: string };
const oneLine = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim();

// 회의 줄 → 근거 글. 고른 순서대로 s1, s2 …. 글 없는 회의는 근거에서 빠진다. 회의마다 6,000자, 합계 2만 자에서 자른다(연락처는 가림).
// text는 화면 사업 보고 본문과 같은 기준(결과 본문, 없으면 옛 결정 기록)으로 handler가 고른다.
export function pressSources(rows: { id: string; label: string; day: string; text: string }[]): { sources: PressSource[]; partial: boolean } {
  const out: PressSource[] = [];
  let left = PRESS_LIMITS.totalChars, partial = false;
  for (const r of rows) {
    if (!r.text.trim()) continue;
    if (left <= 0) { partial = true; continue; }
    const cap = Math.min(PRESS_LIMITS.meetingChars, left);
    if (chars(r.text) > cap) partial = true;
    const text = maskEvidenceText(r.text, cap);
    left -= chars(text);
    out.push({ ref: `s${out.length + 1}`, id: r.id, title: [...oneLine(r.label)].slice(0, 120).join("") || "사업 보고", day: r.day, text });
  }
  return { sources: out, partial };
}

export const PRESS_DRAFT_INSTRUCTIONS = [
  "너는 공공운수노조 공공기관사업팀 부팀장의 성명·보도자료 초안 도우미다. 초안은 명진이 사실을 확인하고 고친 뒤에만 바깥에 나간다.",
  "입력은 종류(성명 또는 보도자료), 한 줄 방향(없을 수 있음), 근거 목록(sources: s1, s2 …마다 날짜·제목·사업 보고 원문)이다.",
  EVIDENCE_RULE,
  "숫자·날짜·사람 이름·기관 이름·직함은 근거에 나온 그대로 쓴다. 예정이나 계획을 확정된 일로 바꾸지 않는다('하기로 함'을 '했다'로 쓰지 않는다).",
  "근거에 없어서 비워 둬야 하는 곳(발신 단체, 날짜, 인용할 말, 숫자 등)은 지어내지 말고 '[확인 필요: 무엇]'으로 남긴다.",
  "lines에는 본문 문단을 순서대로 쓴다(문단 하나는 한 덩어리 글, 12개 안쪽). 문단마다 근거 refs를 붙인다. 근거 없는 문단은 쓰지 않는다.",
  "demands에는 요구 문장을 쓴다(성명은 '~하라', 보도자료는 '~할 것을 촉구한다/요구합니다'). 요구도 근거 refs를 붙인다. 근거에 요구가 없으면 빈 목록으로 둔다.",
  "title은 제목 한 줄(40자 안쪽), subtitle은 부제 한 줄(60자 안쪽)이다. 둘 다 근거에 있는 사실로만 쓴다.",
  "checks에는 명진이 내보내기 전에 사실 확인할 곳을 짧게 적는다(숫자·날짜·이름·인용·'[확인 필요]'로 남긴 곳). 10개 안쪽.",
  "한 줄 방향은 글의 초점일 뿐이다. 방향에 맞는 근거가 없으면 방향을 따르려고 사실을 지어내지 않는다.",
  "아래 예시는 문체만 참고한다. 예시 속 사실·이름·숫자를 초안에 쓰지 않는다.",
].join("\n");

export function pressInstructions(type: PressType): string {
  return [
    PRESS_DRAFT_INSTRUCTIONS,
    type === "statement" ? STATEMENT_STYLE : RELEASE_STYLE,
    type === "statement" ? STATEMENT_EXAMPLE : RELEASE_EXAMPLE,
  ].join("\n");
}

export function pressMaterial(input: PressInput, sources: PressSource[], today: string): string {
  return [
    `종류: ${PRESS_TYPE_LABEL[input.type]}`,
    `오늘: ${today}`,
    `방향: ${input.direction || "(없음)"}`,
    "근거 목록(sources):",
    ...sources.map((s) => `${s.ref} | ${s.day} | ${s.title}\n${s.text}`),
  ].join("\n");
}

const LINE = { type: "object", additionalProperties: false, required: ["text", "refs"], properties: { text: { type: "string" }, refs: { type: "array", items: { type: "string" } } } } as const;
export const PRESS_DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "subtitle", "lines", "demands", "checks"],
  properties: {
    title: { type: "string" },
    subtitle: { type: "string" },
    lines: { type: "array", maxItems: PRESS_LIMITS.paragraphs, items: LINE },
    demands: { type: "array", maxItems: PRESS_LIMITS.demands, items: LINE },
    checks: { type: "array", maxItems: PRESS_LIMITS.checks, items: { type: "string" } },
  },
} as const;

// 한 줄 글(제목·부제·확인할 것) 검사: HTML·제어 문자·연락처·비밀값 모양이면 버림(빈 글).
function safeLine(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  if (CONTROL.test(v.replace(/[\t ]/g, " ")) || v.includes("<") || v.includes(">")) return "";
  const s = v.replace(/\s+/g, " ").trim();
  if (!s || PHONE.test(s) || EMAIL.test(s) || looksSecret(s)) return "";
  return chars(s) > max ? [...s].slice(0, max).join("") : s;
}

export type PressDraft = {
  title: string;
  subtitle: string;
  paragraphs: { text: string; refs: number[] }[];
  demands: { text: string; refs: number[] }[];
  checks: string[];
};
const toNumbers = (l: EvidenceLine) => ({ text: l.text, refs: l.refs.map((r) => Number(r.slice(1))) });

// 답 검사. 모양이 틀리거나 제목·근거 있는 문단이 하나도 없으면 null(쓸 수 없는 답). 문단 합계 4,000자를 넘는 뒤 문단은 버린다.
export function parsePressDraft(raw: string, allowed: ReadonlySet<string>): PressDraft | null {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.lines) || !Array.isArray(d.demands) || !Array.isArray(d.checks)) return null;
  const lines = evidenceLines(JSON.stringify({ lines: d.lines }), allowed, { maxLines: PRESS_LIMITS.paragraphs, maxChars: PRESS_LIMITS.paragraphChars });
  const demands = evidenceLines(JSON.stringify({ lines: d.demands }), allowed, { maxLines: PRESS_LIMITS.demands, maxChars: PRESS_LIMITS.demandChars });
  if (!lines || !demands) return null;
  const paragraphs: PressDraft["paragraphs"] = [];
  let total = 0;
  for (const l of lines) {
    if (total + chars(l.text) > PRESS_LIMITS.body) break;
    total += chars(l.text);
    paragraphs.push(toNumbers(l));
  }
  const title = safeLine(d.title, PRESS_LIMITS.title);
  if (!title || !paragraphs.length) return null;
  const checks = [...new Set((d.checks as unknown[]).map((c) => safeLine(c, PRESS_LIMITS.checkChars)).filter(Boolean))].slice(0, PRESS_LIMITS.checks);
  return { title, subtitle: safeLine(d.subtitle, PRESS_LIMITS.subtitle), paragraphs, demands: demands.map(toNumbers), checks };
}
