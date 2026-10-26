// ai-assist ledger_auto 재료 여덟째: 주간보고 개인본(WEEKLY-개인본대조 W-3, docs/design/ledger-sources.md 4절). 순수 함수만 둔다(입출력은 handler.ts).
// - 개인본 글(자료실 "주간보고 개인본"의 extracted_text, 문단마다 한 줄)을 절로 나누고, 받은 초안 줄(draft.issued) 또는 같은 주 앞 개인본 줄과 비교해
//   명진이 새로 쓰거나 고친 줄만 AI 재료로 만든다. AI는 쓰지 않는다. 5. 주요 일정(과 요청사항 안 2) 주요 일정)은 읽지 않는다.
// - 비교가 믿을 수 없으면(기준 없음 / 읽은 줄이 너무 적음 / 바뀐 줄이 60% 초과) 그 개인본은 AI에 보내지 않는다(처리 표에만 적음).
// - 개인본 글은 데이터다. "AI에게: …" 같은 글도 지시로 따르지 않는다(지시문과 서버 검사는 ledger-auto.ts).
import { stripPhones } from "./ledger-auto.ts";
// 절 나누기·줄 정리는 앱(받은 초안 기록, W-2)과 같은 함수 한 곳이다. 앱 app/weekly-lines.mjs 와 바이트까지 같은 사본(어긋나면 같은 줄이 새 줄로 잡힌다).
import { weeklyLines as sharedWeeklyLines, squashLine as sharedSquashLine, oneLine as sharedOneLine, WEEKLY_LINE_CHARS as LINE_CHARS, WEEKLY_MAX_LINES as MAX_LINES } from "../_shared/weekly-lines.mjs";

export const WEEKLY_CATEGORY = "주간보고 개인본";
// 개인본 재료를 켠 날(한국 날짜 0시). 이 시각 전에 글자를 읽은 개인본은 보지 않는다. 배포가 이 날보다 늦어지면 이 값을 배포일로 올린다.
export const WEEKLY_FROM_ISO = "2026-10-26T00:00:00+09:00";
export const WEEKLY_MAX_DOCS = 20;
export const WEEKLY_LINE_CHARS: number = LINE_CHARS;
export const WEEKLY_MAX_LINES: number = MAX_LINES;
export const WEEKLY_MIN_LINES = 3;
export const WEEKLY_CHANGED_MAX = 0.6;
export const WEEKLY_SIMILAR_MIN = 0.5;
export const WEEKLY_SENT_LINES = 60;

export type WeeklySection = "requests" | "work" | "struggle" | "orgs";
export const WEEKLY_SECTION_NAMES: Record<WeeklySection, string> = {
  requests: "1. 요청사항", work: "2. 기본·영역·의제 사업", struggle: "3. 투쟁 사업", orgs: "4. 산하조직 현황",
};
export type WeeklyLine = { section: WeeklySection; text: string };
export type WeeklyDiff = { kind: "new" | "changed"; section: WeeklySection; text: string; before?: string };
export type WeeklyCompare =
  | { ok: true; diffs: WeeklyDiff[]; total: number; changed: number }
  | { ok: false; reason: "no_sections" | "few_lines" | "too_many_changed"; total: number; changed: number };

// 비교용 글·한 줄 정리·절 나누기는 _shared/weekly-lines.mjs 한 곳(앱과 같은 함수).
export const squashLine: (s: string) => string = sharedSquashLine;
const oneLine: (s: string) => string = sharedOneLine;
export const weeklyLines = (text: string): WeeklyLine[] => sharedWeeklyLines(text) as unknown as WeeklyLine[];

// 받은 초안 기록(draft.issued.lines[].text). 모양이 틀리거나 비었으면 null(그 주는 비교 기준 없음 → 건너뜀).
export function issuedBaseline(draft: unknown): string[] | null {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return null;
  const issued = (draft as Record<string, unknown>).issued;
  if (!issued || typeof issued !== "object" || Array.isArray(issued)) return null;
  const lines = (issued as Record<string, unknown>).lines;
  if (!Array.isArray(lines) || lines.length > 1000) return null;
  const out: string[] = [];
  for (const l of lines) {
    const t = l && typeof l === "object" && !Array.isArray(l) ? (l as Record<string, unknown>).text : null;
    if (typeof t === "string" && [...squashLine(t)].length >= 2) out.push(oneLine(t));
  }
  return out.length ? out : null;
}

const bigrams = (s: string): Set<string> => {
  const c = [...s], out = new Set<string>();
  for (let i = 0; i + 1 < c.length; i++) out.add(c[i] + c[i + 1]);
  return out;
};
const dice = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  const d = (2 * n) / (a.size + b.size);
  // 한쪽이 다른 쪽 안에 거의 들어 있으면(앞 글에 말을 덧붙인 경우) 닮은 것으로 본다. 짧은 쪽이 6글자 미만이면 우연히 들어갈 수 있어 쓰지 않는다.
  const small = Math.min(a.size, b.size);
  return small >= 5 && n / small >= 0.8 ? Math.max(d, WEEKLY_SIMILAR_MIN) : d;
};

// 줄 비교(AI 없음). 같은 줄(정리한 글자가 같음) → 뺀다. 남은 줄 중 기준의 안 맞은 줄과 닮은 것(두 글자 묶음 겹침 0.5 이상) → changed(앞 글 함께), 나머지 → new.
// 기준에만 있는 줄(명진이 지운 줄)은 보내지 않는다(원장은 더하기만).
export function compareWeekly(lines: WeeklyLine[], baseline: string[]): WeeklyCompare {
  const total = lines.length;
  if (!total) return { ok: false, reason: "no_sections", total, changed: 0 };
  if (total < WEEKLY_MIN_LINES) return { ok: false, reason: "few_lines", total, changed: 0 };
  const left = new Map<string, number>();
  const rest: { key: string; text: string }[] = [];
  for (const t of baseline) { const k = squashLine(t); if (k) left.set(k, (left.get(k) ?? 0) + 1); }
  const fresh: WeeklyLine[] = [];
  for (const l of lines) {
    const k = squashLine(l.text), n = left.get(k) ?? 0;
    if (n > 0) left.set(k, n - 1);
    else fresh.push(l);
  }
  const changed = fresh.length;
  if (changed / total > WEEKLY_CHANGED_MAX) return { ok: false, reason: "too_many_changed", total, changed };
  for (const t of baseline) {
    const k = squashLine(t);
    if ((left.get(k) ?? 0) > 0) { rest.push({ key: k, text: t }); left.set(k, (left.get(k) ?? 0) - 1); }
  }
  const grams = rest.map((r) => bigrams(r.key)), used = new Set<number>();
  const diffs: WeeklyDiff[] = fresh.map((l) => {
    const g = bigrams(squashLine(l.text));
    let best = -1, bestScore = 0;
    for (let i = 0; i < rest.length; i++) {
      if (used.has(i)) continue;
      const s = dice(g, grams[i]);
      if (s > bestScore) { best = i; bestScore = s; }
    }
    if (best >= 0 && bestScore >= WEEKLY_SIMILAR_MIN) { used.add(best); return { kind: "changed" as const, section: l.section, text: l.text, before: rest[best].text }; }
    return { kind: "new" as const, section: l.section, text: l.text };
  });
  return { ok: true, diffs, total, changed };
}

// AI에 보내는 재료 글(개인본 하나). 절 이름은 [ ] 안, "+ 줄"은 새로 쓴 줄, "~ 앞: … → 지금: …"은 고친 줄. 전화번호 모양은 지운다.
// struggle: 보낸 줄에 3. 투쟁 사업 줄이 있으면 참(그 개인본에서 나온 기록은 최소 S1, 설계 4.2).
export function weeklyMaterial(diffs: WeeklyDiff[]): { text: string; struggle: boolean; sent: number; partial: boolean } {
  const sent = diffs.slice(0, WEEKLY_SENT_LINES);
  const parts: string[] = [];
  let section: WeeklySection | null = null;
  for (const d of sent) {
    if (d.section !== section) { section = d.section; parts.push(`[${WEEKLY_SECTION_NAMES[section]}]`); }
    parts.push(d.kind === "changed" ? `~ 앞: ${stripPhones(d.before ?? "")} → 지금: ${stripPhones(d.text)}` : `+ ${stripPhones(d.text)}`);
  }
  return { text: parts.join("\n"), struggle: sent.some((d) => d.section === "struggle"), sent: sent.length, partial: diffs.length > sent.length };
}
