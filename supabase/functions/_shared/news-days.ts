// 작업공간 하루 사용량 표 app_news_days(migration 20261101233000) 읽기·더하기 — news-feed·outside-feed 공용(S52-36).
// 서버(service role)만 쓴다. 화면은 읽기만(RLS owner 정책). 이 파일은 줄 수·토큰 수만 다루고 기사 내용은 보지 않는다.
// outside-feed는 [번역] 횟수(translate_n)와 번역용 AI 토큰만 여기에 더한다 — 뉴스 [번역]과 같은 하루·월 한도를 함께 쓴다.
import { estimateKrw } from "./openai-responses.ts";
import { DEFAULT_PRICE_IN_KRW_PER_MTOK, DEFAULT_PRICE_OUT_KRW_PER_MTOK } from "./ai-model.ts";
// AI-사람별한도: 뉴스·사회운동 AI도 작업공간 이번 달 사람별 한도(기본 3,000원, 운영자 제외) 안에서만 부른다. 판정은 공용 함수 한 곳.
import { checkAiUserCap } from "./ai-user-cap.mjs";

type Row = Record<string, unknown>;
export type DayDb = {
  get: (path: string) => Promise<Row[]>;
  send: (method: "POST" | "PATCH", path: string, body: unknown, prefer?: string) => Promise<unknown>;
};
export type DayField = "ai_requests" | "ai_input_tokens" | "ai_output_tokens" | "translate_n" | "fill_n" | "fetch_n";

// AI 월 한도(원). 뉴스 요약·제목·[번역] AI와 사회운동 [번역] AI가 함께 쓴다. 2000 → 5000(명진 결정 2026-11-10).
export const MONTHLY_LIMIT_KRW = 5000;

export const kstDay = (ms: number) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

export async function dayRow(db: DayDb, ws: string, day: string): Promise<Row | null> {
  return (await db.get(`app_news_days?workspace_id=eq.${ws}&day=eq.${day}&select=*&limit=1`))[0] ?? null;
}
export async function addDay(db: DayDb, ws: string, day: string, add: Partial<Record<DayField, number>>, nowMs: number) {
  const cur = await dayRow(db, ws, day);
  const next: Row = { updated_at: new Date(nowMs).toISOString() };
  for (const [k, v] of Object.entries(add)) next[k] = num(cur?.[k]) + Math.max(0, Math.floor(v ?? 0));
  if (cur) await db.send("PATCH", `app_news_days?workspace_id=eq.${ws}&day=eq.${day}`, next, "return=minimal");
  else await db.send("POST", "app_news_days", { workspace_id: ws, day, ...next }, "return=minimal");
}
export async function monthKrw(db: DayDb, ws: string, nowMs: number): Promise<number> {
  const day = kstDay(nowMs), start = `${day.slice(0, 7)}-01`;
  const rows = await db.get(`app_news_days?workspace_id=eq.${ws}&day=gte.${start}&select=ai_input_tokens,ai_output_tokens&limit=40`);
  let i = 0, o = 0;
  for (const r of rows) { i += num(r.ai_input_tokens); o += num(r.ai_output_tokens); }
  return estimateKrw(i, o, { input: DEFAULT_PRICE_IN_KRW_PER_MTOK, output: DEFAULT_PRICE_OUT_KRW_PER_MTOK });
}
// AI를 부르기 전 멈춤 판정: 뉴스 월 상한(MONTHLY_LIMIT) 먼저, 그다음 사람별 한도(AI_MONTHLY_CAP). 둘 다 아니면 null.
// 사람별 한도 숫자는 서버 함수 app_workspace_ai_month(service role, GET — 읽기 전용 함수)로 읽는다. 읽지 못하면 닫힌 쪽(USAGE_UNAVAILABLE).
export async function aiMonthStop(db: DayDb, ws: string, nowMs: number): Promise<null | "MONTHLY_LIMIT" | "AI_MONTHLY_CAP" | "USAGE_UNAVAILABLE"> {
  if (await monthKrw(db, ws, nowMs) >= MONTHLY_LIMIT_KRW) return "MONTHLY_LIMIT";
  const cap = await checkAiUserCap(async () => (await db.get(`rpc/app_workspace_ai_month?p_workspace=${encodeURIComponent(ws)}`))[0]);
  return cap.ok ? null : cap.code === "ai_monthly_cap" ? "AI_MONTHLY_CAP" : "USAGE_UNAVAILABLE";
}
// 하루 횟수 하나 쓰기: 이미 상한이면 false(아무것도 더하지 않음), 아니면 1 더하고 true.
export async function takeDaily(db: DayDb, ws: string, field: DayField, limit: number, nowMs: number): Promise<boolean> {
  const cur = await dayRow(db, ws, kstDay(nowMs));
  if (num(cur?.[field]) >= limit) return false;
  await addDay(db, ws, kstDay(nowMs), { [field]: 1 }, nowMs);
  return true;
}
