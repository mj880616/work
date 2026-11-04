// ai-assist 쓰임(kind=org_week_lines, WEEKLY-메뉴짝짓기 P2 — docs/design/weekly-menu-pairing.md 4절): 순수 함수만 둔다(입출력은 handler.ts).
// 담당조직 기록·조직에 이어진 업데이트·[현황 표] 줄이 저장되면 화면이 기록 번호만 보낸다. 서버가 내 로그인으로 그 기록을 다시 읽어
// 그 주(월~일) 그 조직의 주별 조직보고 표(app_weekly_org_lines)에 흐린 '제안' 줄(state=suggested)을 넣거나 고친다.
// - 짧은 글(한 줄, PLAIN_MAX자 이하)·현황 표 줄은 AI 없이 그대로. 긴 글만 AI 1번(기록 1번당 호출 1번 이하) — 한 줄로 줄이기와 같은 사건인 기존 줄 번호.
// - AI는 줄 정돈만 한다. 글에 없는 내용은 쓰지 않는다. 바깥 발송·공유와 이어지지 않는다(표에 뜨기만).
// - AI 답은 믿지 않는 입력: 모양·글자 수·번호 범위를 다시 검사하고, HTML·제어 문자·앞 기호·끝 마침표를 지운다. 연락처는 '(연락처)'로 바꾼다.
// - 사람이 고친 줄(edited)·뺀 줄(dropped)은 다시 쓰지 않는다. 원래 글이 같으면(source_hash) 아무것도 하지 않는다.
import { outputText } from "../_shared/openai-responses.ts";
import { cleanOrgText } from "./org-summary.ts";
import { similarBody } from "./org-status-rows.ts";

export const ORG_WEEK_PLAIN_MAX = 40; // 이 글자 수 이하 한 줄은 AI 없이 그대로
export const ORG_WEEK_LINE_MAX = 60; // AI가 줄인 줄·AI 없이 자른 줄의 글자 수
export const ORG_WEEK_BODY_MAX = 200; // DB 검사(현황 표 줄은 그대로 옮김)
export const ORG_WEEK_DAILY_AI = 40; // 하루 AI로 줄인 줄 수 상한(넘으면 AI 없이 앞 LINE_MAX자)
export const ORG_WEEK_EXISTING_MAX = 10; // AI에 같이 주는 그 조직·그 주 기존 줄 수
export const ORG_WEEK_RECORD_CHARS = 1500; // AI에 주는 기록 글 길이
export const ORG_WEEK_MAX_ORGS = 5; // 업데이트 하나가 이어진 조직 수(그 이상은 앞 5개)
export const ORG_WEEK_TABLE_MAX = 40; // DB 가드와 같은 (주 × 조직) 줄 수
export const ORG_WEEK_SOURCES_MAX = 10; // 줄 하나의 출처 번호 수(DB 검사)
export const ORG_WEEK_MAX_OUTPUT_TOKENS = 300;

export const SOURCE_KINDS = ["org_update", "note", "status_row"] as const;
export type SourceKind = typeof SOURCE_KINDS[number];
export const SOURCE_COLUMN: Record<SourceKind, "source_update_ids" | "source_note_ids" | "source_status_ids"> = {
  org_update: "source_update_ids", note: "source_note_ids", status_row: "source_status_ids",
};

export type WeekLine = {
  id: string; body: string; day: string | null; end_day: string | null; sort_order: number; state: string; edited: boolean;
  source_update_ids: string[]; source_note_ids: string[]; source_status_ids: string[]; source_hash: string | null; updated_at: string;
};

const chars = (s: string) => [...s].length;
const cut = (s: string, n: number) => [...s].slice(0, n).join("");
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const validDay = (d: unknown): d is string => typeof d === "string" && DAY.test(d) && !Number.isNaN(Date.parse(d + "T00:00:00Z")) && new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d;

// 그 날이 든 주의 월요일(월~일).
export function mondayOf(day: string): string {
  const t = Date.parse(day + "T00:00:00Z"), dow = new Date(t).getUTCDay(); // 0=일
  return new Date(t - ((dow + 6) % 7) * 86400000).toISOString().slice(0, 10);
}

const CTRL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩]/g;
const TAGS = /<[^>]*>/g;
const LEAD = /^(?:[-•·*>#]+|\d+[.)])\s*/;
const NOUN_END = /[.。]+\s*$/u;
const PHONE = /(?:\+?82[-\s]?)?0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// 한 줄로: 태그·제어 문자 지우고, 줄바꿈은 빈칸, 앞 기호·끝 마침표 지움, 연락처 가림, n자까지. DB 검사(앞뒤 빈칸·제어 문자 없음)에 맞는 글.
export function oneLine(text: string, n: number): string {
  const s = String(text ?? "").replace(TAGS, " ").replace(/\r?\n+/g, " ").replace(CTRL, " ").replace(/\s+/g, " ").trim()
    .replace(LEAD, "").trim().replace(PHONE, "(연락처)").replace(EMAIL, "(연락처)").replace(NOUN_END, "").trim();
  return cut(s, n).trim();
}

// 짧은 한 줄이면 AI 없이 그대로 쓸 글, 아니면 null.
export function plainLine(text: string): string | null {
  const raw = String(text ?? "").trim();
  if (!raw || /\r|\n/.test(raw)) return null;
  const line = oneLine(raw, ORG_WEEK_PLAIN_MAX + 1);
  return line && chars(line) <= ORG_WEEK_PLAIN_MAX ? line : null;
}

// 원래 글이 바뀌었는지 보는 지문(글 + 날짜). 글은 서버 밖으로 나가지 않는다.
export async function sourceHash(text: string, day: string | null, end: string | null): Promise<string> {
  const data = new TextEncoder().encode(`${String(text ?? "")}\u0001${day ?? ""}\u0001${end ?? ""}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...hash].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

// 그 기록에서 나온 줄(출처 번호에 그 기록이 있는 줄).
export const ownLine = (lines: WeekLine[], kind: SourceKind, id: string): WeekLine | null =>
  lines.find((l) => (l[SOURCE_COLUMN[kind]] ?? []).some((x) => String(x).toLowerCase() === id)) ?? null;
const sourceCount = (l: WeekLine) => (l.source_update_ids?.length ?? 0) + (l.source_note_ids?.length ?? 0) + (l.source_status_ids?.length ?? 0);

// 원래 기록이 저장(새로·고침)됐을 때 그 조직·그 주 표에 할 일.
//  keep: 사람이 고친 줄·뺀 줄·여러 기록을 묶은 줄은 그대로 / same: 원래 글이 같음 / full: 그 주 그 조직 줄이 40개
//  rewrite: 그 기록 하나에서 나온 줄 → 글을 다시 정돈해 고침 / new: 새 제안(같은 사건 줄이 있으면 거기에 번호만 더함)
export type Plan = { act: "keep" | "same" | "full" } | { act: "rewrite"; line: WeekLine } | { act: "new" };
export function planFor(lines: WeekLine[], kind: SourceKind, id: string, hash: string): Plan {
  const own = ownLine(lines, kind, id);
  if (own) {
    if (own.edited || own.state === "dropped" || sourceCount(own) > 1) return { act: "keep" };
    if (own.source_hash === hash) return { act: "same" };
    return { act: "rewrite", line: own };
  }
  if (lines.length >= ORG_WEEK_TABLE_MAX) return { act: "full" };
  return { act: "new" };
}

// AI 없이 같은 사건 찾기(짧은 글·현황 표 줄): 날짜가 같거나 한쪽이 없고, 글이 비슷한 넣은·제안 줄. 뺀 줄은 다시 쓰지 않는다.
export function sameEvent(lines: WeekLine[], body: string, day: string | null): WeekLine | null {
  return lines.find((l) => l.state !== "dropped" && (!l.day || !day || l.day === day) && similarBody(l.body, body)) ?? null;
}

// 새 줄 순서: 그 조직·그 주 가장 큰 값 다음(DB 검사 0..1000).
export const nextOrder = (lines: WeekLine[]) => Math.min(1000, lines.reduce((m, l) => Math.max(m, Number.isFinite(l.sort_order) ? l.sort_order : 0), -1) + 1);
// 출처 번호 더하기(10개까지, 이미 있으면 그대로). 더할 수 없으면 null.
export function withSource(list: string[], id: string): string[] | null {
  const have = (list ?? []).map((x) => String(x).toLowerCase());
  if (have.includes(id)) return have;
  return have.length >= ORG_WEEK_SOURCES_MAX ? null : [...have, id];
}

// AI 재료: 기록 글 하나 + 조직마다 그 주 기존 줄(글만, 번호 1부터). 기록 번호·조직 이름은 보내지 않는다.
export function orgWeekMaterial(text: string, groups: string[][]): string {
  return JSON.stringify({
    record: cleanOrgText(text, ORG_WEEK_RECORD_CHARS),
    groups: groups.map((lines, g) => ({ group: g + 1, lines: lines.slice(0, ORG_WEEK_EXISTING_MAX).map((t, i) => ({ n: i + 1, text: cut(t, ORG_WEEK_LINE_MAX) })) })),
  });
}

export const ORG_WEEK_INSTRUCTIONS = [
  "너는 노동조합 담당자의 주간보고 정리를 돕는다. 담당조직 기록 글 하나(record)와, 같은 주 그 조직 주간보고에 이미 있는 줄 묶음(groups)을 받는다.",
  `text: record를 주간보고 표기로 한 줄만 줄인다. 한국어 ${ORG_WEEK_LINE_MAX}자 이내, 날짜는 넣지 않는다. 글에 없는 내용은 쓰지 않는다. 추측·평가·감정 표현을 하지 않는다.`,
  "문장 끝맺음(보고서 명사형): 마침표 없이 명사로 맺는다. '~함'·'~임'·'~했다'·'~합니다'로 끝내지 않는다. 예: 임단협 상견례 / 중노위 조정 신청 / 출력결의대회 개최.",
  "전화번호·이메일 같은 개인 연락처와 개인 이름은 쓰지 않는다.",
  "same_as: groups 순서대로 묶음마다 하나씩 정수. record와 같은 사건인 줄이 그 묶음에 있으면 그 줄의 n, 없으면 0. 비슷한 낱말만 있고 다른 일이면 0.",
].join("\n");

export const ORG_WEEK_SCHEMA = {
  type: "object",
  properties: { text: { type: "string" }, same_as: { type: "array", items: { type: "integer" } } },
  required: ["text", "same_as"],
  additionalProperties: false,
};

// AI 답 검사. 모양이 틀리면 null. same_as는 묶음 수만큼(모자라면 0), 범위 밖 번호는 0.
export function parseOrgWeek(raw: unknown, groups: string[][]): { text: string; sameAs: number[] } | null {
  const text = typeof raw === "string" ? raw : outputText(raw);
  if (text === null) return null;
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.text !== "string" || !Array.isArray(o.same_as)) return null;
  const line = oneLine(o.text, ORG_WEEK_LINE_MAX);
  if (!line) return null;
  const same = o.same_as as unknown[];
  const sameAs = groups.map((lines, g) => {
    const n = same[g];
    const max = Math.min(lines.length, ORG_WEEK_EXISTING_MAX);
    return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= max ? (n as number) : 0;
  });
  return { text: line, sameAs };
}
