// Web2 서버 AI 모델 설정의 유일한 출처(AI-모델6luna). 모델 이름·생각 수준·가격 기본값은 여기서만 정한다.
// - 운영에서 우선하는 값: ai-assist·collector-feed는 비밀값 WEB2_AI_MODEL, document-ai-index·library-files·
//   meeting-ai-ingest는 표 app_ai_workspace_settings.default_model. 둘 다 비어 있을 때만 아래 기본값을 쓴다.
// - 공식 문서(2026-10-24 확인): gpt-6-luna 입력 $0.10, 출력 $0.50 /100만 토큰, 생각 수준 기본값 medium,
//   max_output_tokens에는 생각 토큰이 포함된다(모자라면 status=incomplete로 답이 비어 올 수 있음).
//   Web2의 요약·분류·JSON 답에는 깊은 생각이 필요 없으므로 low로 명시한다.
export const DEFAULT_AI_MODEL = "gpt-6-luna";
export const AI_REASONING_EFFORT = "low";
// 생각 토큰이 max_output_tokens에 포함되므로, 표 설정 함수들은 원래 상한에 이만큼 더해 보낸다(답이 중간에 잘려 비는 것을 막음).
export const AI_REASONING_TOKEN_HEADROOM = 1500;
// 1달러 = 1,400원 가정. 입력 0.10달러 → 140원, 출력 0.50달러 → 700원(100만 토큰당).
export const DEFAULT_PRICE_IN_KRW_PER_MTOK = 140;
export const DEFAULT_PRICE_OUT_KRW_PER_MTOK = 700;

// Responses 요청 몸통에 생각 수준을 붙인다. 부르는 쪽이 이미 reasoning을 정했으면 그대로 둔다.
export function withReasoning<T extends Record<string, unknown>>(body: T): T & { reasoning: unknown } {
  return { ...body, reasoning: body.reasoning ?? { effort: AI_REASONING_EFFORT } };
}
