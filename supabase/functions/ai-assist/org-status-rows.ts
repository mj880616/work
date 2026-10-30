// ai-assist 쓰임(kind=org_status_rows, DESK-현황표): 순수 함수만 둔다(입출력은 handler.ts).
// 담당조직 상세 [현황 표]에서 처음 열 때(표가 비었을 때) 또는 [기록에서 다시 채우기 (AI)]를 눌렀을 때만 부른다.
// - 화면은 조직 ID만 보낸다. 재료는 서버가 내 로그인으로 읽는다(최근 STATUS_ROWS_DAYS일의 그 조직 기록, 그 조직에 연결한 업데이트와 연결 기록 요약,
//   그 조직 자료 요약). 일기·보관·AI 내보내기 비허용 업데이트는 읽지 않는다(조직 요약 org_summary와 같은 재료 읽기).
// - 재료마다 이번 실행에서만 쓰는 짧은 참조(r1, r2 …)를 붙인다. AI 답의 근거 참조가 목록에 없으면 버리고, 근거가 하나도 없는 줄은 버린다.
// - AI 답은 믿지 않는 입력: 키·개수·글자 수·날짜를 다시 검사하고, HTML·제어 문자·앞 기호를 지우고 같은 줄은 한 번만 남긴다.
//   전화번호·이메일 같은 개인 연락처가 든 줄은 버린다.
// - 서버는 아무것도 저장하지 않는다. 화면이 [현황 표]에 넣으며, 사람이 넣거나 고친 줄(source=user)은 덮어쓰지 않는다.
import { outputText } from "../_shared/openai-responses.ts";
import { AI_TONE_RULE } from "../_shared/ai-model.ts";
import { cleanOrgText, type OrgRecord } from "./org-summary.ts";

export const STATUS_ROWS_DAYS = 60;
export const STATUS_ROWS_MAX = 4;
export const STATUS_ROWS_TEXT_CHARS = 80;
export const STATUS_ROWS_MAX_RECORDS = 80;
export const STATUS_ROWS_RECORD_CHARS = 600;
export const STATUS_ROWS_INPUT_CHARS = 24000;
export const STATUS_ROWS_MAX_OUTPUT_TOKENS = 1200;
export const STATUS_ROWS_MAX_EVIDENCE = 10;

export type StatusRecord = OrgRecord & { ref?: string };
export type PackedStatusRecord = { key: string; ref: string | null; day: string; type: OrgRecord["type"]; text: string };
export type StatusRow = { day: string; text: string; evidence: string[] };

const chars = (s: string) => [...s].length;
const cut = (s: string, n: number) => [...s].slice(0, n).join("");
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TYPE_NAMES: Record<OrgRecord["type"], string> = { org_update: "조직 기록", update: "업데이트", link_summary: "연결 기록 요약", file_summary: "자료 요약" };

// 최근 것부터 넣는다. 너무 길면 뒤(오래된 것)를 버리고 partial.
export function packStatusRecords(records: StatusRecord[]): { packed: PackedStatusRecord[]; partial: boolean } {
  const sorted = [...records].filter((r) => DAY.test(r.day)).sort((a, b) => b.at - a.at);
  const packed: PackedStatusRecord[] = [];
  let used = 0, partial = false;
  for (const r of sorted) {
    const text = cleanOrgText(r.text, STATUS_ROWS_RECORD_CHARS).replace(/\n+/g, " ").trim();
    if (!text) continue;
    if (packed.length >= STATUS_ROWS_MAX_RECORDS || used + chars(text) > STATUS_ROWS_INPUT_CHARS) { partial = true; break; }
    const ref = typeof r.ref === "string" && UUID.test(r.ref.toLowerCase()) ? r.ref.toLowerCase() : null;
    packed.push({ key: `r${packed.length + 1}`, ref, day: r.day, type: r.type, text });
    used += chars(text) + 40;
  }
  return { packed, partial };
}

export function statusRowsMaterial(orgName: string, packed: PackedStatusRecord[], today: string): string {
  return JSON.stringify({
    today,
    organization: cut(orgName, 80),
    records: packed.map((r) => ({ ref: r.key, day: r.day, kind: TYPE_NAMES[r.type], text: r.text })),
  });
}

export const STATUS_ROWS_INSTRUCTIONS = [
  "너는 노동조합 담당자의 업무 비서다. 한 담당조직의 최근 기록(조직 기록·업데이트·연결 기록 요약·자료 요약)을 받는다.",
  `rows: 그 조직의 최근 주요 일정·현황을 최신 순으로 ${STATUS_ROWS_MAX}줄 이하로 뽑는다. 교섭·조정·쟁의·집회·결의대회·투표·협약처럼 상황이 바뀐 일을 먼저 고르고, 일상 연락·인사는 고르지 않는다.`,
  `줄마다 day(그 일이 있었던 날, YYYY-MM-DD, 기록의 날짜나 기록에 적힌 날짜), text(한국어 한 줄 ${STATUS_ROWS_TEXT_CHARS}자 이내, 날짜는 넣지 않음. 예: 지노위 2차 조정회의 — 조정 종료(쟁의권 확보)), refs(근거가 된 기록의 ref 목록)를 쓴다.`,
  "기록에 없는 일은 쓰지 않는다. 같은 일을 두 줄로 쓰지 않는다. 기록이 거의 없으면 rows는 빈 목록.",
  "전화번호·이메일·주민번호 같은 개인 연락처·식별 정보와 개인 이름은 쓰지 않는다. 추측·평가·감정 표현을 하지 않는다.",
  AI_TONE_RULE,
].join("\n");

export const STATUS_ROWS_SCHEMA = {
  type: "object",
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: { day: { type: "string" }, text: { type: "string" }, refs: { type: "array", items: { type: "string" } } },
        required: ["day", "text", "refs"],
        additionalProperties: false,
      },
    },
  },
  required: ["rows"],
  additionalProperties: false,
};

const PHONE = /(?:\+?82[-\s]?)?0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const CTRL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩]/g;
const TAGS = /<[^>]*>/g;
const LEAD = /^(?:[-•·*>#]+|\d+[.)])\s*/;

const validDay = (d: string) => DAY.test(d) && !Number.isNaN(Date.parse(d + "T00:00:00Z")) && new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d;

// AI 답 검사. day는 실제 날짜이고 재료에서 가장 이른 날 - 30일 ~ 오늘 + 60일 안(지난 일정·다가오는 일정 모두 허용, 엉뚱한 해는 버림).
// 근거는 목록에 있는 ref만, 실제 기록 번호로 바꾼다(번호가 없는 재료는 근거로 남지 않지만 줄은 살린다 — 근거 참조가 하나는 맞아야 함).
// 맞지 않으면 null(답 모양이 틀림). 줄이 하나도 안 남으면 빈 목록.
export function parseStatusRows(raw: unknown, packed: PackedStatusRecord[], today: string): StatusRow[] | null {
  const text = typeof raw === "string" ? raw : outputText(raw);
  if (text === null) return null;
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  if (!v || typeof v !== "object" || Array.isArray(v) || !Array.isArray((v as Record<string, unknown>).rows)) return null;
  const byKey = new Map(packed.map((r) => [r.key, r]));
  const earliest = packed.reduce((m, r) => (r.day < m ? r.day : m), today);
  const shift = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
  const lo = shift(earliest, -30), hi = shift(today, 60);
  const out: StatusRow[] = [], seen = new Set<string>();
  for (const item of (v as { rows: unknown[] }).rows.slice(0, STATUS_ROWS_MAX * 3)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.day !== "string" || typeof o.text !== "string" || !Array.isArray(o.refs)) continue;
    const day = o.day.trim();
    if (!validDay(day) || day < lo || day > hi) continue;
    const body = cut(o.text.replace(TAGS, "").replace(CTRL, " ").replace(/\s+/g, " ").trim().replace(LEAD, "").trim(), STATUS_ROWS_TEXT_CHARS).trim();
    if (!body || PHONE.test(body) || EMAIL.test(body)) continue;
    const refs = o.refs.filter((k): k is string => typeof k === "string").map((k) => byKey.get(k.trim())).filter((r): r is PackedStatusRecord => !!r);
    if (!refs.length) continue;
    const key = day + "|" + body;
    if (seen.has(key)) continue;
    seen.add(key);
    const evidence = [...new Set(refs.map((r) => r.ref).filter((r): r is string => !!r))].slice(0, STATUS_ROWS_MAX_EVIDENCE);
    out.push({ day, text: body, evidence });
    if (out.length >= STATUS_ROWS_MAX) break;
  }
  return out.sort((a, b) => b.day.localeCompare(a.day));
}
