// Web2 서버 AI 공용 호출(OpenAI Responses). ai-assist와 collector-feed가 같은 길을 쓴다(새 AI 경로를 따로 만들지 않음).
// - 열쇠·모델·가격 설정 읽기(aiConfigFrom)와 호출 1번 + 잠깐 막힘 1번 재시도(callOpenAi)만 둔다.
// - 오류 원문·재료 글·AI 답은 로그에 넣지 않는다. 로그는 단계 코드와 HTTP 상태 숫자뿐이다.
// - 기본 모델·생각 수준·가격 기본값은 _shared/ai-model.ts 한 곳에서 정한다. 열쇠 이름·시간 한도는 부르는 쪽이 넘긴다.
import { readBoundedJson } from "./bounded-json.mjs";
import { withReasoning } from "./ai-model.ts";

export type Env = (name: string) => string | undefined;
export type Log = (code: string, detail?: Record<string, unknown>) => void;
export type Price = { input: number; output: number };
export type AiConfig = { key: string; model: string; price: Price };

const MODEL = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const PRICE = /^\d{1,6}(\.\d{1,4})?$/;

export const tokenCount = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0);

export function estimateKrw(inputTokens: number, outputTokens: number, price: Price) {
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

// 열쇠가 없거나 빈칸이 섞였거나, 모델·가격 값이 이상하면 null(AI를 부르지 않는다).
export function aiConfigFrom(
  env: Env,
  defaults: { keyName: string; model: string; priceIn: number; priceOut: number },
): AiConfig | null {
  const key = env(defaults.keyName) ?? "";
  const model = (env("WEB2_AI_MODEL") ?? "").trim() || defaults.model;
  const pin = (env("WEB2_AI_PRICE_IN_KRW_PER_MTOK") ?? "").trim();
  const pout = (env("WEB2_AI_PRICE_OUT_KRW_PER_MTOK") ?? "").trim();
  if (!key.trim() || /\s/.test(key) || !MODEL.test(model)) return null;
  if ((pin && !PRICE.test(pin)) || (pout && !PRICE.test(pout))) return null;
  const price = {
    input: pin ? Number(pin) : defaults.priceIn,
    output: pout ? Number(pout) : defaults.priceOut,
  };
  if (!(price.input > 0) || !(price.output > 0)) return null;
  return { key, model, price };
}

export type OpenAiResult =
  | { ok: true; raw: unknown; usage: { input: number; output: number } }
  | { ok: false; code: string; charged: boolean };

export type CallOptions = { url: string; timeoutMs: number; retryDelayMs: number; maxResponseBytes: number };

// charged: 실패했어도 OpenAI가 토큰을 썼을 수 있는 경우(시간 초과·답 읽기 실패). 사용량 추정에 쓴다.
export async function callOpenAi(
  deps: { doFetch: typeof fetch; sleep: (ms: number) => Promise<void>; log: Log },
  key: string,
  body: Record<string, unknown>,
  options: CallOptions,
): Promise<OpenAiResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let r: Response;
    try {
      r = await deps.doFetch(options.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(withReasoning(body)),
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === "TimeoutError" || name === "AbortError") return { ok: false, code: "ai_timeout", charged: true };
      deps.log("openai_network_error");
      if (attempt === 0) { await deps.sleep(options.retryDelayMs); continue; }
      return { ok: false, code: "ai_busy", charged: false };
    }
    if (r.status === 429 || r.status >= 500) {
      try { await r.body?.cancel(); } catch { /* ignore */ }
      deps.log("openai_retryable", { status: r.status });
      // 잠깐 막힘은 서버가 1번만 다시 시도한다.
      if (attempt === 0) { await deps.sleep(options.retryDelayMs); continue; }
      return { ok: false, code: "ai_busy", charged: false };
    }
    if (!r.ok) {
      try { await r.body?.cancel(); } catch { /* ignore */ }
      deps.log("openai_rejected", { status: r.status });
      return { ok: false, code: r.status === 401 || r.status === 403 ? "ai_not_configured" : "ai_invalid_response", charged: false };
    }
    let raw: unknown;
    try {
      raw = await readBoundedJson(r, { maxBytes: options.maxResponseBytes });
    } catch {
      return { ok: false, code: "ai_invalid_response", charged: true };
    }
    const u = (raw as { usage?: Record<string, unknown> })?.usage ?? {};
    return { ok: true, raw, usage: { input: tokenCount(u.input_tokens), output: tokenCount(u.output_tokens) } };
  }
  return { ok: false, code: "ai_busy", charged: false };
}

// Responses 답에서 output_text 하나를 꺼낸다. 거절(refusal)·여러 조각·모양 이상이면 null.
export function outputText(raw: unknown, maxChars = 64 * 1024): string | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.status !== "completed" || !Array.isArray(r.output)) return null;
  const texts: string[] = [];
  for (const item of r.output as unknown[]) {
    if (!item || typeof item !== "object") return null;
    const it = item as Record<string, unknown>;
    if (it.type !== "message") continue;
    if (!Array.isArray(it.content)) return null;
    for (const c of it.content as unknown[]) {
      if (!c || typeof c !== "object") return null;
      const cc = c as Record<string, unknown>;
      if (cc.type === "refusal") return null;
      if (cc.type === "output_text") {
        if (typeof cc.text !== "string") return null;
        texts.push(cc.text);
      }
    }
  }
  if (texts.length !== 1 || texts[0].length > maxChars) return null;
  return texts[0];
}
