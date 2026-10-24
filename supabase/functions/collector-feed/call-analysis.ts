// collector-feed 통화: 기존 통화 분석 파일(검토__…md, Gemini가 이미 만든 것)을 읽기만 한다. AI를 부르지 않는다.
// (docs/design/call-telegram-feed.md 1.3·3.2·3.4·4.2·4.5절, Q10~Q13)
// - 앞머리(frontmatter): analysis_version(3.x만), work_class(업무/개인/애매), call_title, recording_datetime, source_txt_id,
//   source_txt_name, analysis_model, analysis_at.
// - 가져오는 절: 상대 이름·직책, 핵심요약, 약속 후보, 결정 후보, 후속확인 필요사항. 판단 메모·중요 원문·애매 표현·AI 메모는 읽지 않는다.
// - 업무만 저장 재료를 만든다. 개인·애매·구분 없음은 개수만(결과 kind만 돌려준다). 모양이 다르면 failed.
// 순수 함수만 둔다(네트워크·로그 없음). 바깥에서 온 글이므로 제어 문자를 지우고 길이를 자른다.
import { matchOrg } from "../_shared/org-name-match.mjs";

export const CALL_LIMITS = Object.freeze({
  analysisBytes: 64 * 1024,
  // 분석 파일 + 전사 txt 합계(설계 4.4절 200 KB). raw_text 상한(204800 bytes)과 같다.
  totalBytes: 204800,
  title: 80,
  point: 300,
  points: 8,
  counterpart: 100,
  model: 100,
});

export type OrgRow = { id: string; name: string; aliases?: string[] | null; active?: boolean | null };
export type CallParsed =
  | { kind: "personal" | "unsure" | "failed"; day: string | null }
  | {
    kind: "business";
    day: string;
    occurred_at: string;
    title: string;
    points: string[];
    counterpart: string | null;
    organization_id: string | null;
    speaker_split: boolean;
    raw_text: string | null;
    model: string | null;
    judged_at: string | null;
  };

const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;
const ANY_CONTROL = /[\u0000-\u001f\u007f]/g;
const chars = (s: string) => [...s];
const cut = (s: string, n: number) => chars(s).slice(0, n).join("");
// 한 줄 글: 제어 문자·줄바꿈을 빈칸으로, 마크다운 굵게 표시를 지운다.
export function cleanLine(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const s = value.normalize("NFC").replace(ANY_CONTROL, " ").replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim();
  return s ? cut(s, max).trim() || null : null;
}

// 한국 시각(+09:00) 날짜·시각 계산.
const KST_MS = 9 * 3600 * 1000;
export const kstDay = (ms: number) => new Date(ms + KST_MS).toISOString().slice(0, 10);

// "2026-10-24 14:30:00", "2026-10-24T14:30:00+09:00", "2026.10.24 14:30" 등. 시간대가 없으면 한국 시각으로 본다.
export function parseKstDateTime(value: unknown): number | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const m = /^\s*(\d{4})[-./](\d{1,2})[-./](\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?\s*(Z|[+-]\d{2}:?\d{2})?\s*$/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  let offsetMin = 9 * 60;
  if (m[7] === "Z") offsetMin = 0;
  else if (m[7]) {
    const sign = m[7][0] === "-" ? -1 : 1, digits = m[7].slice(1).replace(":", "");
    offsetMin = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2)));
  }
  const ms = Date.UTC(y, mo - 1, d, h, mi, s) - offsetMin * 60000;
  const back = new Date(ms + offsetMin * 60000);
  if (back.getUTCDate() !== d || back.getUTCMonth() !== mo - 1) return null;
  return Number.isFinite(ms) ? ms : null;
}

// 전사 파일 이름 `통화 <번호 또는 연락처 이름>_<YYMMDD>_<HHMMSS>.txt`에서 연락처와 시각.
export function transcriptName(value: unknown): { contact: string | null; at: number | null } {
  if (typeof value !== "string" || value.length > 300) return { contact: null, at: null };
  const m = /^통화\s+(.+?)_(\d{2})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(?:\.txt)?$/.exec(value.normalize("NFC").trim());
  if (!m) return { contact: null, at: null };
  const at = parseKstDateTime(`20${m[2]}-${m[3]}-${m[4]} ${m[5]}:${m[6]}:${m[7]}`);
  const raw = cleanLine(m[1], CALL_LIMITS.counterpart);
  // 번호(숫자·하이픈·+·빈칸만)는 상대 표기로 쓰지 않는다.
  const contact = raw && !/^[\d\s+()-]+$/.test(raw) && !hasPhone(raw) ? raw : null;
  return { contact, at };
}
const hasPhone = (s: string) => /\d{2,4}[\s-]?\d{3,4}[\s-]?\d{4}/.test(s) || /\d{7,}/.test(s);

// 앞머리: 맨 앞 `---` 줄 사이의 `key: value`. 따옴표 한 겹은 벗긴다.
export function frontmatter(md: string): { meta: Record<string, string>; body: string } | null {
  const lines = md.replace(/^﻿/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return null;
  const meta: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]{0,40})\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (v.length >= 2 && ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'"))) v = v.slice(1, -1);
    if (!(m[1] in meta)) meta[m[1]] = v;
  }
  return { meta, body: lines.slice(end + 1).join("\n") };
}

// 절 이름(띄어쓰기·가운뎃점·번호를 뺀 것) → 이 함수가 쓰는 이름. 나머지 절은 읽지 않는다.
const SECTION_KEYS: ReadonlyArray<[string, string]> = [
  ["상대이름직책", "counterpart"], ["상대", "counterpart"], ["핵심요약", "summary"], ["약속후보", "promises"],
  ["결정후보", "decisions"], ["후속확인", "followups"],
];
const normHeading = (s: string) => s.normalize("NFC").replace(/\*\*|__/g, "").replace(/^\s*\d+\s*[.)]\s*/, "")
  .replace(/[\s·‧・/:：()（）[\]]/g, "");
export function sections(body: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let current: string | null = null;
  for (const line of body.split(/\r?\n/)) {
    const h = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line) ?? /^\s*\*\*([^*]{1,40})\*\*\s*:?\s*$/.exec(line);
    if (h) {
      const name = normHeading(h[1]);
      const hit = SECTION_KEYS.find(([k]) => name === k || (k !== "상대" && name.startsWith(k)));
      current = hit ? hit[1] : null;
      if (current && !out[current]) out[current] = [];
      continue;
    }
    if (current) out[current].push(line);
  }
  return out;
}

const EMPTY_ITEM = /^(없음|해당\s*없음|특이\s*사항\s*없음|n\/?a|-|—|확인\s*불가|미상|불명)\.?$/i;
// 절 안의 점 목록. `- `, `* `, `• `, `1. ` 머리를 떼고, "없음"류는 뺀다.
export function bullets(lines: string[] | undefined, max: number = CALL_LIMITS.point): string[] {
  const out: string[] = [];
  for (const line of lines ?? []) {
    const stripped = line.replace(/^\s*(?:[-*•·]|\d{1,2}[.)])\s+/, "").replace(/^\s*>\s?/, "");
    const v = cleanLine(stripped, max);
    if (!v || EMPTY_ITEM.test(v)) continue;
    out.push(v);
  }
  return out;
}

// 제목이 없을 때: 핵심요약 첫 점의 첫 문장(80자까지).
export function firstSentence(text: string): string | null {
  const m = /^(.+?(?:[.!?。](?=\s|$)|다\.|요\.))/.exec(text);
  return cleanLine(m ? m[1] : text, CALL_LIMITS.title);
}

// 점 목록: 핵심요약 앞 3개 → 결정 후보([확정]) → 약속 후보([예정]) → 후속확인([확인]) → 핵심요약 나머지. 8개까지.
// 날짜·숫자는 분석 글 그대로 둔다. 머리표는 화면이 "확정/예정" 표시로 바꾼다.
export function pointsOf(s: Record<string, string[]>): string[] {
  const tag = (t: string, list: string[]) => list.map((p) => cut(`[${t}] ${p}`, CALL_LIMITS.point));
  const summary = bullets(s.summary);
  const ordered = [
    ...summary.slice(0, 3), ...tag("확정", bullets(s.decisions)), ...tag("예정", bullets(s.promises)),
    ...tag("확인", bullets(s.followups)), ...summary.slice(3),
  ];
  return [...new Set(ordered)].slice(0, CALL_LIMITS.points);
}

// 상대 표기(Q11): 재료는 분석의 '상대 이름·직책' 절과 전사 파일 이름의 연락처 이름.
// 소속은 Web2 담당조직 이름(별칭·자동 규칙 포함)과 딱 하나 맞을 때만 붙인다. 모양: `소속조직 이름 직책`. 모르면 null.
export function counterpartOf(lines: string[] | undefined, contact: string | null, orgs: OrgRow[]) {
  const active = orgs.filter((o) => o && o.active !== false && typeof o.name === "string");
  const fields: Record<string, string> = {};
  const free: string[] = [];
  for (const b of bullets(lines, 200)) {
    const kv = /^(이름|성명|직책|직위|소속|조직|소속\s*조직)\s*[:：]\s*(.+)$/.exec(b);
    if (kv) {
      const key = /^(이름|성명)$/.test(kv[1]) ? "name" : /^(직책|직위)$/.test(kv[1]) ? "role" : "org";
      if (!fields[key]) fields[key] = kv[2].trim();
    } else free.push(b);
  }
  let name = fields.name ?? "", role = fields.role ?? "", orgText = fields.org ?? "";
  if (!name && free[0] && !EMPTY_ITEM.test(free[0])) {
    // `홍길동 위원장 (가상노조)` / `가상노조 홍길동 위원장`
    let line = free[0];
    const paren = /[(（]([^)）]{1,60})[)）]/.exec(line);
    if (paren) { if (!orgText) orgText = paren[1].trim(); line = line.replace(paren[0], " "); }
    name = line.replace(/\s+/g, " ").trim();
  }
  if (!name && contact) name = contact;
  let org: OrgRow | null = orgText ? matchOrg(orgText, active) : null;
  if (!org && name) {
    // 이름 줄 안의 한 낱말이 담당조직 하나와 맞으면 소속으로 본다(두 낱말 이상 맞으면 애매해서 붙이지 않는다).
    const words = name.split(" ");
    const hits = words.map((w, i) => ({ i, o: w.length >= 2 ? matchOrg(w, active) : null })).filter((x) => x.o);
    if (hits.length === 1) { org = hits[0].o; name = words.filter((_, i) => i !== hits[0].i).join(" "); }
  } else if (org && name) {
    name = name.split(" ").filter((w) => matchOrg(w, [org!]) === null).join(" ");
  }
  const person = [name, role].map((v) => cleanLine(v, 60) ?? "").filter(Boolean).join(" ");
  if (!person || hasPhone(person) || EMPTY_ITEM.test(person)) return { counterpart: null, organization_id: org ? org.id : null };
  return { counterpart: cleanLine([org?.name ?? "", person].filter(Boolean).join(" "), CALL_LIMITS.counterpart), organization_id: org ? org.id : null };
}

// 전문이 화자별 줄인가(4.5절): 줄이 둘 이상이고 모든 줄이 `머리: ` 모양이며 `나:` 또는 `화자1:` 줄이 있다.
export function speakerSplit(transcript: string): boolean {
  const lines = transcript.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return false;
  const head = /^([^:：\s][^:：]{0,59})\s*[:：]\s+\S/;
  if (!lines.every((l) => head.test(l))) return false;
  return lines.some((l) => /^(나|화자\s?1)\s*[:：]/.test(l));
}

export const KNOWN_VERSION = /^3\.\d{1,3}$/;

export function parseCall(input: { ref: string; analysis_md: string; transcript: string }, orgs: OrgRow[], nowMs: number): CallParsed {
  const fm = frontmatter(input.analysis_md);
  if (!fm) return { kind: "failed", day: null };
  const meta = fm.meta;
  const named = transcriptName(meta.source_txt_name);
  const at = parseKstDateTime(meta.recording_datetime) ?? named.at;
  const day = at === null ? null : kstDay(at);
  if (!KNOWN_VERSION.test(meta.analysis_version ?? "")) return { kind: "failed", day };
  if (meta.source_txt_id && meta.source_txt_id !== input.ref) return { kind: "failed", day };
  const work = (meta.work_class ?? "").replace(/\s/g, "");
  if (work === "개인") return { kind: "personal", day };
  if (work !== "업무") return { kind: "unsure", day };
  if (at === null || at > nowMs + 86400000) return { kind: "failed", day: null };
  const s = sections(fm.body);
  const points = pointsOf(s);
  const summary = bullets(s.summary);
  const title = cleanLine(meta.call_title, CALL_LIMITS.title) ?? (summary[0] ? firstSentence(summary[0]) : null);
  if (!s.summary || !title) return { kind: "failed", day: day! };
  const { counterpart, organization_id } = counterpartOf(s.counterpart, named.contact, orgs);
  const transcript = input.transcript.normalize("NFC").replace(CONTROL, "").trim();
  const judged = parseKstDateTime(meta.analysis_at);
  return {
    kind: "business",
    day: day!,
    occurred_at: new Date(at).toISOString(),
    title,
    points,
    counterpart,
    organization_id,
    speaker_split: transcript ? speakerSplit(transcript) : false,
    raw_text: transcript || null,
    model: cleanLine(meta.analysis_model, CALL_LIMITS.model),
    judged_at: judged === null ? null : new Date(judged).toISOString(),
  };
}
