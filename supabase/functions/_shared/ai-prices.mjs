// AI-사용량줄: 홈 'AI 사용량' 줄이 금액을 셈하는 단가·상한. drive-summary(.mjs, Node 시험·Deno 배포 양쪽)가 읽으므로 .mjs로 둔다.
// - Gemini(회사 PC 전사·분석 스크립트) 모델별 단가의 유일한 출처. 바뀌면 여기만 고친다.
// - OpenAI 기본 단가·이번 달 상한은 _shared/ai-model.ts(DEFAULT_PRICE_*)·ai-assist·collector-feed(MONTHLY_LIMIT_KRW)가 원래 출처이고,
//   여기 값이 그것과 같은지 tests/security/drive-summary-ai-usage.test.mjs가 대조한다(다르면 CI 실패).
// 100만 토큰당 원, 1달러 = 1,400원.
const usd = n => Math.round(n * 1400 * 100) / 100;
export const OPENAI_DEFAULT_IN_KRW = 140;
export const OPENAI_DEFAULT_OUT_KRW = 700;
export const AI_MONTHLY_LIMIT_ASSIST_KRW = 15000; // ai-assist: Web2 AI 기능 전체
export const AI_MONTHLY_LIMIT_FEED_KRW = 6000;    // collector-feed: 텔레그램·통화 판정
// 2025년 Google 공식 가격표 기준(유료 등급, 20만 토큰 이하 요청). 음성 입력은 글 입력보다 비싸 따로 둔다.
// 모델 이름 앞부분으로 찾고(긴 것부터), 표에 없는 모델은 가장 비싼 줄(GEMINI_UNKNOWN_PRICE)로 세고 화면에 '단가 미확인'을 붙인다.
export const GEMINI_PRICES = Object.freeze([
  { prefix: 'gemini-2.5-flash-lite', input: usd(0.10), audio: usd(0.30), output: usd(0.40) },
  { prefix: 'gemini-2.5-flash', input: usd(0.30), audio: usd(1.00), output: usd(2.50) },
  { prefix: 'gemini-2.5-pro', input: usd(1.25), audio: usd(1.25), output: usd(10.00) },
  { prefix: 'gemini-2.0-flash-lite', input: usd(0.075), audio: usd(0.075), output: usd(0.30) },
  { prefix: 'gemini-2.0-flash', input: usd(0.10), audio: usd(0.70), output: usd(0.40) },
].sort((a, b) => b.prefix.length - a.prefix.length));
export const GEMINI_UNKNOWN_PRICE = Object.freeze({ prefix: '', input: usd(2.00), audio: usd(2.00), output: usd(12.00) });
export function geminiPrice(model) {
  const m = String(model || '').toLowerCase();
  return GEMINI_PRICES.find(p => m.startsWith(p.prefix)) ?? null;
}
// 음성 토큰은 입력 토큰의 일부다(Gemini usageMetadata.promptTokensDetails의 AUDIO). 출력에는 생각 토큰을 더해 보낸다.
export function geminiKrw(model, input, audio, output) {
  const p = geminiPrice(model) ?? GEMINI_UNKNOWN_PRICE;
  const i = Math.max(input, 0), a = Math.min(Math.max(audio, 0), i);
  return ((i - a) * p.input + a * p.audio + Math.max(output, 0) * p.output) / 1_000_000;
}
