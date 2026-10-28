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

// AI-사용량줄: 이번 달 AI 상한(추정 원). ai-assist(Web2 AI 전체)·collector-feed(텔레그램·통화 판정)의 MONTHLY_LIMIT_KRW와 같은 값이어야 한다(시험이 대조),
// 홈 'AI 사용량' 줄(drive-summary GET ?action=ai_usage)이 같은 값으로 막대·80% 경고를 그린다.
export const AI_MONTHLY_LIMIT_ASSIST_KRW = 15000;
export const AI_MONTHLY_LIMIT_FEED_KRW = 6000;

// AI-사용량줄: 회사 PC 전사·분석 스크립트(Gemini) 단가. 100만 토큰당 원(1달러 1,400원). 바뀌면 여기만 고친다.
// 2025년 Google 공식 가격표 기준(유료 등급, 20만 토큰 이하 요청). 음성 입력은 글 입력보다 비싸 따로 둔다.
// 모델 이름 앞부분으로 찾고(긴 것부터), 표에 없는 모델은 가장 비싼 줄(GEMINI_UNKNOWN_PRICE)로 세고 화면에 '단가 미확인'을 붙인다.
export type GeminiPrice = { prefix: string; input: number; audio: number; output: number };
const usd = (n: number) => Math.round(n * 1400 * 100) / 100;
export const GEMINI_PRICES: readonly GeminiPrice[] = Object.freeze([
  { prefix: "gemini-2.5-flash-lite", input: usd(0.10), audio: usd(0.30), output: usd(0.40) },
  { prefix: "gemini-2.5-flash", input: usd(0.30), audio: usd(1.00), output: usd(2.50) },
  { prefix: "gemini-2.5-pro", input: usd(1.25), audio: usd(1.25), output: usd(10.00) },
  { prefix: "gemini-2.0-flash-lite", input: usd(0.075), audio: usd(0.075), output: usd(0.30) },
  { prefix: "gemini-2.0-flash", input: usd(0.10), audio: usd(0.70), output: usd(0.40) },
].sort((a, b) => b.prefix.length - a.prefix.length));
export const GEMINI_UNKNOWN_PRICE: GeminiPrice = Object.freeze({ prefix: "", input: usd(2.00), audio: usd(2.00), output: usd(12.00) });
export function geminiPrice(model: string): GeminiPrice | null {
  const m = String(model || "").toLowerCase();
  return GEMINI_PRICES.find((p) => m.startsWith(p.prefix)) ?? null;
}
// 음성 토큰은 입력 토큰의 일부다(Gemini usageMetadata.promptTokensDetails의 AUDIO). 출력에는 생각 토큰을 더해 보낸다.
export function geminiKrw(model: string, input: number, audio: number, output: number): number {
  const p = geminiPrice(model) ?? GEMINI_UNKNOWN_PRICE;
  const i = Math.max(input, 0), a = Math.min(Math.max(audio, 0), i);
  return ((i - a) * p.input + a * p.audio + Math.max(output, 0) * p.output) / 1_000_000;
}

// Web2 AI 요약 말투의 유일한 출처(AI-말투통일, 명진 결정 2026-10-27): 요약·정리 문장의 끝맺음을 '~함.'·'~임.' 식으로 통일한다.
// - 요약을 만드는 서버 AI 지시문(텔레그램 소식·원장 자동 기록·원장 후보·원장 고치기·회의 정리)이 이 한 줄을 그대로 넣는다. 말투를 바꿀 때는 여기만 고친다.
// - 앞으로 새로 만드는 요약부터 적용한다. 이미 저장된 요약은 바꾸지 않는다.
// - 바깥에 내보내는 글(주간보고 한글·성명·보도자료)의 문체는 이 규칙이 아니다. 그 글의 재료를 만드는 지시문(연결 요약·조직 현황 요약·자료 한두 줄 요약·일정 제목)은 주간보고 문체를 따로 가지므로 넣지 않는다(docs/design/ai-tone.md).
// - 제목·이름·표 칸 값은 이 규칙 대상이 아니다. 지시문마다 요약 문장이 들어가는 칸에만 쓰게 한다.
export const AI_TONE_RULE = "말투: 요약·정리 문장은 '~함.'·'~임.'·'~됨.'·'~필요함.'처럼 짧은 명사형으로 맺는다. '~했다'·'~한다'·'~이다'·'~합니다'·'~입니다'·'~해요'로 끝내지 않는다. 예: '제작하기로 했다' → '제작하기로 함', '확인해야 한다' → '확인 필요함', '목표이다' → '목표임'. 제목·이름·날짜·정해진 값 칸에는 쓰지 않고, 글 속에서 따온 말은 원문 그대로 둔다.";

// Responses 요청 몸통에 생각 수준을 붙인다. 부르는 쪽이 이미 reasoning을 정했으면 그대로 둔다.
export function withReasoning<T extends Record<string, unknown>>(body: T): T & { reasoning: unknown } {
  return { ...body, reasoning: body.reasoning ?? { effort: AI_REASONING_EFFORT } };
}
