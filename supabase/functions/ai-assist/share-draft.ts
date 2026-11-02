// 공유 페이지 AI 초안(kind=share_draft, 원장 빠짐32 · 요청 10/20 01:43 '현장 공유 페이지' ②: "AI는 자료를 받아 블록에 초안만 채움").
// 순수 함수만 둔다(요청 검사, 재료 만들기, 지시문, 답 형식, 답 검사). 입출력(기록 다시 읽기·AI 부르기·사용량)은 handler.ts runShareDraft.
// - 재료는 명진이 고른 Web2 기록만: 사업 보고(app_meetings)와 노트·업데이트(app_notes kind note|basket). 화면은 종류와 ID만 보내고,
//   서버가 호출한 사람의 로그인으로 다시 읽는다(owner RLS + 작업공간 확인). 일기·업무일지 줄·보관한 노트·AI 내보내기 끈 노트·비밀 모양 노트는 쓰지 않는다.
// - 답은 공유 페이지 칸(한 줄 현황 · 진행 단계 · 일정 · 쟁점·요구 · 업데이트 기록) 후보와 '확인할 것'. 줄마다 근거(s1…)가 있어야 남는다(evidence.ts 공용 검사).
// - 서버는 사용량 숫자 말고 아무것도 저장하지 않는다. 화면이 미리보기를 보여 주고, 명진이 [넣기]를 누를 때만 편집 중인 본문 끝에 들어간다
//   (그 뒤에도 [저장]을 눌러야 페이지가 바뀐다). 공유 페이지는 링크를 받은 바깥 사람이 읽으므로 내부 메모·연락처·평가는 빼라고 지시한다.
import { EVIDENCE_RULE, evidenceLines, maskEvidenceText, EMAIL, PHONE, CONTROL, chars, type EvidenceLine } from "./evidence.ts";
import { looksSecret } from "./note-title.ts";

export type ShareSourceType = "meeting" | "note";
export const SHARE_SOURCE_TYPES: readonly ShareSourceType[] = Object.freeze(["meeting", "note"]);
export const SHARE_SECTIONS = Object.freeze([
  { key: "summary", label: "한 줄 현황", max: 2, chars: 160 },
  { key: "steps", label: "진행 단계", max: 8, chars: 240 },
  { key: "schedule", label: "일정", max: 8, chars: 160 },
  { key: "issues", label: "쟁점·요구", max: 8, chars: 300 },
  { key: "updates", label: "업데이트 기록", max: 8, chars: 300 },
] as const);
export type ShareSectionKey = typeof SHARE_SECTIONS[number]["key"];
export const SHARE_LIMITS = Object.freeze({
  refs: 6, // 고르는 기록 최대 수(화면과 같음)
  sourceChars: 5000, // 기록마다 앞 5,000자
  totalChars: 20000, // 재료 합계 2만 자
  focus: 80, // 한 줄 초점(선택)
  checks: 8,
  checkChars: 120,
  maxOutputTokens: 2500,
  daily: 10,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SharePick = { type: ShareSourceType; id: string };
export type ShareInput = { kind: "share_draft"; sources: SharePick[]; focus: string };
// 요청 몸통 검사: {kind, sources:[{type, id}](1~6개, 겹침 없음), focus?}. 그 밖의 칸은 거절(기록 글을 화면이 보내지 못하게).
export function parseShareBody(b: Record<string, unknown>): ShareInput | null {
  if (Object.keys(b).some((k) => !["kind", "sources", "focus"].includes(k))) return null;
  if (!Array.isArray(b.sources) || b.sources.length < 1 || b.sources.length > SHARE_LIMITS.refs) return null;
  const out: SharePick[] = [], seen = new Set<string>();
  for (const v of b.sources) {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    if (Object.keys(o).sort().join(",") !== "id,type") return null;
    if (o.type !== "meeting" && o.type !== "note") return null;
    if (typeof o.id !== "string" || !UUID.test(o.id)) return null;
    const id = o.id.toLowerCase(), key = `${o.type}:${id}`;
    if (seen.has(key)) return null;
    seen.add(key);
    out.push({ type: o.type, id });
  }
  let focus = "";
  if (b.focus !== undefined && b.focus !== null) {
    if (typeof b.focus !== "string" || CONTROL.test(b.focus) || /[<>]/.test(b.focus)) return null;
    focus = b.focus.replace(/\s+/g, " ").trim();
    if (chars(focus) > SHARE_LIMITS.focus) return null;
  }
  return { kind: "share_draft", sources: out, focus };
}

// 재료 한 건: 서버가 다시 읽은 기록. ref는 s1… (화면·DB id는 AI에 가지 않는다).
export type ShareSource = { ref: string; type: ShareSourceType; id: string; label: string; title: string; day: string; text: string };
export type ShareRow = { type: ShareSourceType; id: string; label: string; title: string; day: string; text: string };
const oneLine = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim();

// 기록 줄 → 근거 글. 고른 순서대로 s1, s2 …. 글 없는 기록은 빠진다. 기록마다 5,000자, 합계 2만 자에서 자른다(연락처는 가림).
export function shareSources(rows: ShareRow[]): { sources: ShareSource[]; partial: boolean } {
  const out: ShareSource[] = [];
  let left = SHARE_LIMITS.totalChars, partial = false;
  for (const r of rows) {
    if (!r.text.trim()) continue;
    if (left <= 0) { partial = true; continue; }
    const cap = Math.min(SHARE_LIMITS.sourceChars, left);
    if (chars(r.text) > cap) partial = true;
    const text = maskEvidenceText(r.text, cap);
    left -= chars(text);
    const title = [...oneLine(r.title)].slice(0, 120).join("") || r.label;
    out.push({ ref: `s${out.length + 1}`, type: r.type, id: r.id, label: r.label, title, day: r.day, text });
  }
  return { sources: out, partial };
}

export const SHARE_DRAFT_INSTRUCTIONS = [
  "너는 공공운수노조 공공기관사업팀 부팀장의 '공유 페이지' 초안 도우미다. 공유 페이지는 링크를 받은 현장 조합원·간부가 로그인 없이 읽는 읽기 전용 페이지다.",
  "초안은 명진이 칸마다 확인하고 고친 뒤에만 페이지에 들어간다. 너는 칸 후보 글만 만든다.",
  "입력은 한 줄 초점(없을 수 있음)과 근거 목록(sources: s1, s2 …마다 종류·날짜·제목·원문)이다.",
  EVIDENCE_RULE,
  "칸은 다섯 가지다. summary(한 줄 현황: 지금 상황을 한두 문장), steps(진행 단계: 지나온 일과 다음 단계, 시간 순), schedule(일정: '10월 30일(목) 14시 기자회견'처럼 날짜가 앞에 오는 한 줄씩),",
  "issues(쟁점·요구: 다투는 점과 요구 사항), updates(업데이트 기록: '10.22 대책회의에서 기자회견 결정'처럼 날짜 + 한 일). 근거에 없는 칸은 빈 목록으로 둔다.",
  "줄마다 근거 refs를 붙인다. 근거 없는 줄은 쓰지 않는다. 숫자·날짜·사람 이름·기관 이름은 근거에 나온 그대로 쓰고, 예정을 확정된 일로 바꾸지 않는다.",
  "바깥 사람이 읽는 페이지다. 개인 연락처, 내부 평가·전략·협상 카드, 사람에 대한 험담이나 사생활, 내부 회의의 발언자 이름은 쓰지 않는다. 판단이 어려우면 쓰지 말고 checks에 적는다.",
  "말투는 짧고 쉬운 평서문('~함', '~예정' 같은 메모체 대신 '~했다', '~할 예정이다'). 꾸밈말·구호·이모지는 쓰지 않는다.",
  "checks에는 명진이 넣기 전에 확인할 곳을 짧게 적는다(숫자·날짜·이름, 바깥에 내보내도 되는지 애매한 내용). 8개 안쪽.",
  "한 줄 초점은 글의 초점일 뿐이다. 초점에 맞는 근거가 없으면 초점을 따르려고 사실을 지어내지 않는다.",
].join("\n");

const TYPE_LABEL: Readonly<Record<ShareSourceType, string>> = Object.freeze({ meeting: "사업 보고", note: "노트" });
export function shareMaterial(input: ShareInput, sources: ShareSource[], today: string): string {
  return [
    `오늘: ${today}`,
    `초점: ${input.focus || "(없음)"}`,
    "근거 목록(sources):",
    ...sources.map((s) => `${s.ref} | ${s.label || TYPE_LABEL[s.type]} | ${s.day} | ${s.title}\n${s.text}`),
  ].join("\n");
}

const LINE = { type: "object", additionalProperties: false, required: ["text", "refs"], properties: { text: { type: "string" }, refs: { type: "array", items: { type: "string" } } } } as const;
export const SHARE_DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...SHARE_SECTIONS.map((s) => s.key), "checks"],
  properties: {
    ...Object.fromEntries(SHARE_SECTIONS.map((s) => [s.key, { type: "array", maxItems: s.max, items: LINE }])),
    checks: { type: "array", maxItems: SHARE_LIMITS.checks, items: { type: "string" } },
  },
} as const;

// 한 줄 글(확인할 것) 검사: HTML·제어 문자·연락처·비밀값 모양이면 버림(빈 글).
function safeLine(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  if (CONTROL.test(v.replace(/[\t ]/g, " ")) || v.includes("<") || v.includes(">")) return "";
  const s = v.replace(/\s+/g, " ").trim();
  if (!s || PHONE.test(s) || EMAIL.test(s) || looksSecret(s)) return "";
  return chars(s) > max ? [...s].slice(0, max).join("") : s;
}

export type ShareLine = { text: string; refs: number[] };
export type ShareDraft = { sections: Record<ShareSectionKey, ShareLine[]>; checks: string[] };
const toNumbers = (l: EvidenceLine): ShareLine => ({ text: l.text, refs: l.refs.map((r) => Number(r.slice(1))) });

// 답 검사. 모양이 틀리면 null, 근거 있는 줄이 하나도 없어도 null(쓸 수 없는 답).
export function parseShareDraft(raw: string, allowed: ReadonlySet<string>): ShareDraft | null {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.checks)) return null;
  const sections = {} as Record<ShareSectionKey, ShareLine[]>;
  let total = 0;
  for (const s of SHARE_SECTIONS) {
    const list = d[s.key];
    if (!Array.isArray(list)) return null;
    const lines = evidenceLines(JSON.stringify({ lines: list }), allowed, { maxLines: s.max, maxChars: s.chars });
    if (!lines) return null;
    sections[s.key] = lines.map(toNumbers); // HTML·제어 문자·연락처·비밀값 모양·근거 없는 줄은 evidenceLines가 버린다
    total += sections[s.key].length;
  }
  if (!total) return null;
  const checks = [...new Set((d.checks as unknown[]).map((c) => safeLine(c, SHARE_LIMITS.checkChars)).filter(Boolean))].slice(0, SHARE_LIMITS.checks);
  return { sections, checks };
}
