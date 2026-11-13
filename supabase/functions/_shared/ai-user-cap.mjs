// AI-사람별한도(MULTI-노조사용자 단계 ③ 'AI 상한', 명진 11/13 14:43 "가"): 사람(작업공간)마다 한 달 AI 한도. 판정은 이 파일 한 곳.
// - 숫자는 DB 함수(20261113160000_ai_user_cap)가 준다: 이번 달(서울 날짜) 그 작업공간의 OpenAI 토큰 합계(app_ai_daily_usage + app_news_days)·
//   Gemini 모델별 합계(app_ai_external_usage)·한도(app_workspace_ai_caps, 없으면 3,000원)·운영자 제외(ai_no_cap).
//   기존 사용 기록 표만 읽는다(새 저장소 없음). 원 셈은 단가표 _shared/ai-prices.mjs 한 곳(홈·프로필 'AI 사용량' 줄과 같은 단가).
// - 한도 이상이면 AI를 부르지 않고 429 ai_monthly_cap으로 답한다. 운영자 작업공간은 서버 허용 표(ai_no_cap)로 빠진다(화면 숨김 아님).
// - 숫자를 읽지 못하면 '확인 못함'(usage_unavailable)으로 멈춘다(닫힌 쪽 — 비용을 내는 쪽 보호). 작업공간은 서버가 확인한 값만 넘긴다.
// - Node 시험·Deno 배포 양쪽에서 읽으므로 .mjs로 둔다(ai-prices.mjs·ai-daily-usage.mjs와 같은 방식).
import { OPENAI_DEFAULT_IN_KRW, OPENAI_DEFAULT_OUT_KRW, geminiKrw } from './ai-prices.mjs';

export const AI_USER_CAP_DEFAULT_KRW = 3000;
export const AI_CAP_CODE = 'ai_monthly_cap';
export const AI_CAP_STATUS = 429;
export const DEFAULT_OPENAI_PRICE = Object.freeze({ input: OPENAI_DEFAULT_IN_KRW, output: OPENAI_DEFAULT_OUT_KRW });

const won = n => Math.round(n).toLocaleString('ko-KR');
/** 화면 한 줄(고정 문구, 금액만 그 작업공간 한도). */
export function aiCapMessage(capKrw = AI_USER_CAP_DEFAULT_KRW) {
  const cap = Number.isSafeInteger(capKrw) && capKrw >= 0 ? capKrw : AI_USER_CAP_DEFAULT_KRW;
  return `이번 달 AI 사용 한도(${won(cap)}원)를 다 썼어요. 다음 달 1일에 다시 쓸 수 있어요.`;
}

const tok = v => { const n = Number(v); return Number.isSafeInteger(n) && n >= 0 ? n : 0; };
const okPrice = p => p && Number.isFinite(p.input) && p.input > 0 && Number.isFinite(p.output) && p.output > 0;

/**
 * DB 함수 답(jsonb)을 판정으로 바꾼다. 모양이 틀리면 null.
 * @param {unknown} raw
 * @param {{input:number, output:number}} [price] OpenAI 100만 토큰당 원(운영 비밀값 WEB2_AI_PRICE_*가 있으면 그 값)
 * @returns {null | { month: string, exempt: boolean, cap_krw: number, used_krw: number, capped: boolean }}
 */
export function judgeAiMonth(raw, price = DEFAULT_OPENAI_PRICE) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  if (typeof r.month !== 'string' || !/^\d{4}-\d{2}$/.test(r.month) || typeof r.exempt !== 'boolean') return null;
  const cap = Number(r.cap_krw);
  if (!Number.isSafeInteger(cap) || cap < 0) return null;
  if (!Array.isArray(r.gemini)) return null;
  const p = okPrice(price) ? price : DEFAULT_OPENAI_PRICE;
  let krw = (tok(r.openai_input_tokens) * p.input + tok(r.openai_output_tokens) * p.output) / 1_000_000;
  for (const g of r.gemini) {
    if (!g || typeof g !== 'object' || typeof g.model !== 'string') return null;
    krw += geminiKrw(g.model, tok(g.input_tokens), tok(g.audio_tokens), tok(g.output_tokens));
  }
  const used = Math.round(krw);
  return { month: r.month, exempt: r.exempt, cap_krw: cap, used_krw: used, capped: !r.exempt && krw >= cap };
}

/**
 * AI를 부르기 전에 한 번. read: DB 함수를 불러 jsonb를 돌려주는 함수(서버 키면 app_workspace_ai_month, 로그인 토큰이면 app_my_ai_month).
 * @param {() => Promise<unknown>} read
 * @param {{ price?: {input:number, output:number} }} [opts]
 * @returns {Promise<{ ok: true, month: ReturnType<typeof judgeAiMonth> } | { ok: false, status: number, code: string, message: string }>}
 */
export async function checkAiUserCap(read, { price } = {}) {
  let month = null;
  try { month = judgeAiMonth(await read(), price); } catch { month = null; }
  if (!month) return { ok: false, status: 503, code: 'usage_unavailable', message: 'AI 사용 기록을 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.' };
  if (month.capped) return { ok: false, status: AI_CAP_STATUS, code: AI_CAP_CODE, message: aiCapMessage(month.cap_krw) };
  return { ok: true, month };
}

/** supabase-js 서버 클라이언트(service role)로 읽기. workspaceId는 서버가 DB·로그인에서 확인한 값만. */
export function serverMonthReader(admin, workspaceId) {
  return async () => {
    const { data, error } = await admin.rpc('app_workspace_ai_month', { p_workspace: workspaceId });
    if (error) throw error;
    return data;
  };
}

/** 한도에 걸렸을 때 던지는 오류(각 함수의 기존 오류 응답 길로 status·code·message가 나간다). */
export class AiCapError extends Error {
  /** @param {{status:number, code:string, message:string}} r */
  constructor(r) { super(r.message); this.name = 'AiCapError'; this.status = r.status; this.code = r.code; }
}

/** 서버 클라이언트로 판정하고 막히면 AiCapError를 던진다. */
export async function assertAiUserCap(admin, workspaceId, opts) {
  const r = await checkAiUserCap(serverMonthReader(admin, workspaceId), opts);
  if (!r.ok) throw new AiCapError(r);
  return r.month;
}
