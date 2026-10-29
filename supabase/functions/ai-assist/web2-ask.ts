// ai-assist 쓰임 ask_web2(FEAT-1029묶음 ① Web2에 물어보기, docs/design/ask-web2.md 2절, 명진 결정 10/29 07:27 '모두 추천대로').
// 순수 함수만 둔다(입출력은 handler.ts).
// - 화면은 질문 한 줄만 보낸다. 서버가 낱말을 뽑아(AI 안 씀) 기존 DB 검색 함수 두 개(app_search_records·app_ledger_search)를
//   명진 로그인 토큰으로 부르고(owner RLS 그대로), 찾은 근거 줄만 AI에 한 번 보낸다.
// - 찾기는 검색 함수로만 한다: 업무 통화·텔레그램 소식은 검색 함수의 call·telegram 종류(요약·핵심 줄)로 들어온다.
//   개인 통화함·개인 텔레그램·일기는 검색 함수가 읽지 않는다(DB 시험 고정). 통화 원문은 보내지 않는다.
// - 명진 결정 변경(10/29 07:29~07:30): 찾은 텔레그램 소식은 원문(raw_text, 업무 텔레그램 줄만)과 보낸 사람 표시 이름까지 AI 재료로 보낸다.
//   handler가 찾은 소식 id만 로그인 토큰으로 다시 읽고(owner RLS), 이름은 이름 표를 collector-feed와 같은 순서로 붙인다(tg-raw.ts). 길이 상한을 둔다.
// - 원장 교섭·전략(S2)도 AI 재료로 보내 답 문장에 쓴다(결정 3 변경). 근거 목록의 '교섭·전략' 꼬리표는 그대로. AI 제외 노트(ai_export_allowed=false)는 보내지 않는다.
// - AI 답은 공용 근거 검사(evidence.ts)를 거친다: 이번에 보낸 근거에 없는 ref·근거 없는 줄은 버린다.
import { AI_TONE_RULE } from "../_shared/ai-model.ts";
import { orgAllNames, orgKey, orgKeys } from "../_shared/org-name-match.mjs";
import { EVIDENCE_RULE, evidenceLines, evidenceSchema, maskEvidenceText, type EvidenceLine } from "./evidence.ts";
import { looksSecret } from "./note-title.ts";

export const ASK_DAILY_LIMIT = 30;
export const ASK_QUESTION_MIN = 4;
export const ASK_QUESTION_MAX = 200;
export const ASK_MAX_WORDS = 6;
export const ASK_PER_KIND = 5;
export const ASK_RETRY_MAX = 4;
export const ASK_RETRY_BELOW = 10;
export const ASK_LEDGER_LIMIT = 10;
export const ASK_MAX_SOURCES = 30;
export const ASK_SNIPPET_CHARS = 160;
export const ASK_TITLE_CHARS = 80;
export const ASK_MAX_LINES = 6;
export const ASK_LINE_CHARS = 120;
export const ASK_KEEP_DAYS = 30;
export const ASK_MAX_OUTPUT_TOKENS = 900;
// 전체 검색 화면의 기본 8종류 + 물어보기 재료 2종류(DB 1단계). DB 적용 전이면 handler가 기본 8종류로 다시 부른다.
export const ASK_BASE_KINDS = Object.freeze(["update", "note", "work", "document", "meeting", "project", "organization", "milestone"]);
export const ASK_SEARCH_KINDS = Object.freeze([...ASK_BASE_KINDS, "call", "telegram"]);

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2028\u2029\u2060-\u2069]/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const chars = (s: string) => [...s].length;

// 요청: {kind, question}만. 질문은 한 줄 4~200자(앞뒤 공백 없음, 제어 문자 없음). 맞지 않으면 null(400).
export function parseAskRequest(b: Record<string, unknown>): { question: string } | null {
  if (Object.keys(b).sort().join(",") !== "kind,question") return null;
  const q = b.question;
  if (typeof q !== "string" || q !== q.trim() || CONTROL.test(q)) return null;
  const n = chars(q);
  if (n < ASK_QUESTION_MIN || n > ASK_QUESTION_MAX) return null;
  return { question: q };
}
export const askLooksSecret = (q: string) => looksSecret(q);

// 낱말 뽑기(AI 안 씀). 물음 말·뒤 조사를 떼고 2글자 이상만, 최대 6개. 검색이 글자 포함(ILIKE)이라 덜 떼도 더 떼도 안전한 쪽이다.
const STOP = new Set(["뭐", "뭐야", "뭐였지", "뭐지", "뭐였더라", "무엇", "언제", "왜", "어떻게", "누가", "누구", "얼마", "얼마나", "어디", "어디서", "어느",
  "지난번", "지난", "최근", "요즘", "그때", "관련", "관련된", "내용", "알려줘", "알려", "정리", "정리해줘", "있었나", "있었지", "했나", "했지", "였지", "인가",
  "있나", "무슨", "어떤", "그", "이", "저", "좀", "다시", "혹시", "우리", "내가", "나", "제일", "가장"]);
const ENDINGS = /(였더라|었더라|했더라|였는지|었는지|했는지|였지|었지|했지|됐지|했나|됐나|였나|었나|인가|일까|인지|나요|까요|했어|였어|됐어|는지|은지|이야|야)$/;
const PARTICLES = /(에서는|에서|에게|한테|으로|까지|부터|이랑|이나|은|는|을|를|이|가|의|에|도|와|과|로|랑|만)$/;
export function askWords(question: string): string[] {
  const out: string[] = [];
  for (const raw of question.normalize("NFC").split(/[\s?!.,·…~"'“”‘’()[\]{}<>]+/)) {
    let w = raw.trim();
    if (!w || STOP.has(w)) continue;
    for (const re of [ENDINGS, PARTICLES]) {
      const cut = w.replace(re, "");
      if (cut !== w && chars(cut) >= 2) w = cut;
    }
    if (STOP.has(w) || chars(w) < 2 || chars(w) > 100) continue;
    if (!out.some((x) => x.toLowerCase() === w.toLowerCase())) out.push(w);
    if (out.length >= ASK_MAX_WORDS) break;
  }
  return out;
}

// 질문에 담당조직 이름·별칭이 들어 있으면 그 조직 하나(둘 이상이면 애매 → 없음). 비교 규칙은 공용 org-name-match(띄어쓰기·'노조' 등 무시).
export function askOrg(question: string, orgs: { id: string; name: string; aliases?: string[] }[]): string | null {
  const q = orgKey(question);
  const hits = orgs.filter((o) => UUID.test(o.id) && orgAllNames(o).some((n) => orgKeys(n).some((k) => [...k].length >= 2 && q.includes(k))));
  return hits.length === 1 ? hits[0].id.toLowerCase() : null;
}

export type AskHit = {
  kind: string; source: string; id: string; date: string | null; day: string | null; title: string; snippet: string;
  org_id: string | null; project_id: string | null; room: string | null; sent: boolean; tag: string | null;
  // 텔레그램 원문(보낸 사람 이름 붙임, AI 재료에만). 저장·응답에는 넣지 않는다.
  raw?: string;
};
export type AskSource = AskHit & { ref: string };

const isoDay = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const cleanTitle = (v: unknown) => maskEvidenceText(v, ASK_TITLE_CHARS) || "(제목 없음)";

// 검색 함수 결과(groups)를 근거 후보로. 모르는 종류·모양은 버린다. 일기는 검색 함수가 원래 주지 않지만 한 번 더 막는다.
export function hitsFromSearch(result: unknown): AskHit[] {
  const groups = (result as { groups?: unknown })?.groups;
  if (!Array.isArray(groups)) return [];
  const out: AskHit[] = [];
  for (const g of groups) {
    const items = (g as { items?: unknown })?.items;
    if (!Array.isArray(items)) continue;
    for (const it of items as Record<string, unknown>[]) {
      const kind = String(it?.kind ?? ""), id = String(it?.id ?? "");
      if (!(ASK_SEARCH_KINDS as readonly string[]).includes(kind) || !UUID.test(id) || kind === "diary") continue;
      const text = kind === "call" || kind === "telegram" ? (it.summary ?? it.snippet) : it.snippet;
      out.push({
        kind, source: String(it.source ?? kind), id: id.toLowerCase(),
        date: isoDay(it.day) ?? isoDay(it.occurred_at), day: isoDay(it.day),
        title: cleanTitle(it.title), snippet: maskEvidenceText(text, ASK_SNIPPET_CHARS),
        org_id: typeof it.organization_id === "string" && UUID.test(it.organization_id) ? it.organization_id.toLowerCase() : null,
        project_id: typeof it.project_id === "string" && UUID.test(it.project_id) ? it.project_id.toLowerCase() : null,
        room: kind === "telegram" && typeof it.room_key === "string" && /^[A-Za-z0-9_.:-]{1,100}$/.test(it.room_key) ? it.room_key : null,
        sent: true, tag: null,
      });
    }
  }
  return out;
}

// 원장 검색 결과. 교섭·전략(S2)도 요약까지 AI에 보낸다(결정 3 변경). S0~S2 밖 등급은 버린다. 대체·폐기는 검색 함수가 이미 뺀다(p_include_inactive=false).
export function hitsFromLedger(rows: unknown): AskHit[] {
  if (!Array.isArray(rows)) return [];
  const out: AskHit[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    const id = String(r?.id ?? "");
    if (!UUID.test(id) || typeof r.title !== "string") continue;
    if (r.validity === "superseded" || r.validity === "retired") continue;
    if (r.sensitivity !== "S0" && r.sensitivity !== "S1" && r.sensitivity !== "S2") continue;
    const s2 = r.sensitivity === "S2";
    out.push({
      kind: "ledger", source: "ledger", id: id.toLowerCase(), date: isoDay(r.date_start), day: null,
      title: cleanTitle(r.title), snippet: maskEvidenceText(r.summary, ASK_SNIPPET_CHARS),
      org_id: null, project_id: null, room: null, sent: true, tag: s2 ? "교섭·전략" : null,
    });
  }
  return out;
}

// 고르기: 겹친 낱말 수 → 질문 조직 연결 → 최근 순. 같은 기록은 한 번만. ref는 s1부터.
export function rankHits(hits: AskHit[], words: string[], orgId: string | null, max = ASK_MAX_SOURCES): AskSource[] {
  const seen = new Set<string>(), uniq: AskHit[] = [];
  for (const h of hits) {
    const key = h.kind + ":" + h.id;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(h);
  }
  const lower = words.map((w) => w.toLowerCase());
  const score = (h: AskHit) => lower.filter((w) => (h.title + " " + h.snippet).toLowerCase().includes(w)).length;
  return uniq
    .map((h, i) => ({ h, i, s: score(h), o: orgId && h.org_id === orgId ? 1 : 0 }))
    .sort((a, b) => b.s - a.s || b.o - a.o || String(b.h.date ?? "").localeCompare(String(a.h.date ?? "")) || a.i - b.i)
    .slice(0, max)
    .map((x, n) => ({ ...x.h, ref: `s${n + 1}` }));
}

const KIND_LABEL: Readonly<Record<string, string>> = Object.freeze({
  update: "업데이트", note: "노트", work: "업무일지", document: "자료", meeting: "회의", project: "프로젝트", organization: "조직 기록",
  milestone: "주요 일정", call: "업무 통화", telegram: "텔레그램 소식", ledger: "원장",
});
export const askKindLabel = (k: string) => KIND_LABEL[k] ?? k;

// AI에 보내는 재료: 질문 + 보낼 수 있는 근거 줄(ref·종류·날짜·제목·앞뒤 한 줄, 텔레그램은 원문 raw)만. id·조직 id·AI 제외 노트는 보내지 않는다.
export function askMaterial(question: string, sources: AskSource[]): string {
  return JSON.stringify({
    question: maskEvidenceText(question, ASK_QUESTION_MAX),
    sources: sources.filter((s) => s.sent).map((s) => ({
      ref: s.ref, kind: s.tag ? `${askKindLabel(s.kind)}(${s.tag})` : askKindLabel(s.kind), date: s.date, title: s.title, text: s.snippet,
      ...(s.kind === "telegram" && s.raw ? { raw: s.raw } : {}),
    })),
  });
}

export const ASK_INSTRUCTIONS = [
  "너는 노동조합 상근자 개인 업무 시스템(Web2)의 '물어보기' 도우미다. 사용자의 질문에 근거 목록으로만 답한다.",
  "사용자 메시지는 JSON 하나다: question(질문)과 sources(찾은 기록 줄 목록, 각 ref·kind·date·title·text, 텔레그램 소식은 원문 줄 raw가 붙을 수 있음).",
  "raw는 '시각 보낸 사람: 말' 줄을 ' / '로 이은 텔레그램 원문 일부다. 누가 무슨 말을 했는지 답에 쓸 수 있다.",
  EVIDENCE_RULE,
  `답은 ${ASK_MAX_LINES}줄 이하, 한 줄 ${ASK_LINE_CHARS}자 이하. 질문에 바로 답하는 줄부터 쓴다. 날짜는 근거의 date를 그대로 쓴다.`,
  "근거로 답할 수 없으면 lines를 빈 배열로 둔다. 추측하지 않는다.",
  AI_TONE_RULE,
  "답은 정해진 JSON 형식 {\"lines\":[{\"text\":문자열,\"refs\":[문자열]}]} 하나뿐이다.",
].join("\n");
export const ASK_SCHEMA = evidenceSchema(ASK_MAX_LINES);

export function parseAskAnswer(raw: string, sources: AskSource[]): EvidenceLine[] | null {
  const allowed = new Set(sources.filter((s) => s.sent).map((s) => s.ref));
  return evidenceLines(raw, allowed, { maxLines: ASK_MAX_LINES, maxChars: ASK_LINE_CHARS });
}

// 저장용 근거(앞뒤 한 줄 없음 — 원본이 바뀌면 원본을 보도록). 프로젝트·조직 id는 화면이 그 기록을 여는 데만 쓴다(AI에는 안 보냄).
// 텔레그램 원문(raw)은 AI 재료에만 쓰고 저장·응답에 넣지 않는다.
export const storedSources = (sources: AskSource[]) =>
  sources.map((s) => ({ ref: s.ref, kind: s.kind, source: s.source, id: s.id, date: s.date, day: s.day, room: s.room, project_id: s.project_id, organization_id: s.org_id, title: s.title, sent: s.sent, tag: s.tag }));
