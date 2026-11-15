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

// Web2 AI 요약 말투의 유일한 출처(AI-말투통일, 명진 결정 2026-10-27): 요약·정리 문장의 끝맺음을 '~함.'·'~임.' 식으로 통일한다.
// - 요약을 만드는 서버 AI 지시문(텔레그램 소식·원장 자동 기록·원장 후보·원장 고치기·회의 정리)이 이 한 줄을 그대로 넣는다. 말투를 바꿀 때는 여기만 고친다.
// - 앞으로 새로 만드는 요약부터 적용한다. 이미 저장된 요약은 바꾸지 않는다.
// - 바깥에 내보내는 글(주간보고 한글·성명·보도자료)의 문체는 이 규칙이 아니다. 그 글의 재료를 만드는 지시문(연결 요약·조직 현황 요약·자료 한두 줄 요약·일정 제목)은 주간보고 문체를 따로 가지므로 넣지 않는다(docs/design/ai-tone.md).
// - 제목·이름·표 칸 값은 이 규칙 대상이 아니다. 지시문마다 요약 문장이 들어가는 칸에만 쓰게 한다.
export const AI_TONE_RULE = "말투: 요약·정리 문장은 '~함.'·'~임.'·'~됨.'·'~필요함.'처럼 짧은 명사형으로 맺는다. '~했다'·'~한다'·'~이다'·'~합니다'·'~입니다'·'~해요'로 끝내지 않는다. 예: '제작하기로 했다' → '제작하기로 함', '확인해야 한다' → '확인 필요함', '목표이다' → '목표임'. 제목·이름·날짜·정해진 값 칸에는 쓰지 않고, 글 속에서 따온 말은 원문 그대로 둔다.";

// AI가 요약 대신 쓰는 '재료 없음' 안내 문장(말투 규칙 탓에 '…없음'·'…불가함'으로 맺힌다) 검사 목록(OUTSIDE-읽기고침·요약·순서, 11/01 요청).
// 요약 칸에 이런 문장이 오면 요약이 아니므로 비운다(제목만 보임). 실제 요약 속 '내용이 없어 비판함' 같은 말과 섞이지 않게
// '요약'·'본문/원문/기사/글'과 '없음·제공되지 않음·확인할 수 없음'이 함께 있는 짧은 안내 꼴만 잡는다. 새 꼴을 보면 여기에 더한다(시험: tests/ai-tone.test.mjs).
export const AI_NO_MATERIAL_PATTERNS: readonly RegExp[] = Object.freeze([
  /요약할\s*수\s*(가\s*)?없/,
  /요약(이|은)?\s*(불가|어려)/,
  /(본문|원문|기사\s*본문|글\s*본문|기사|글의?\s*내용|본문\s*내용)(이|은|을|가)?\s*(제공되지\s*않|없(어|음|으므로|는|습)|비어\s*있|확인(할|되)\s*수\s*없|확인되지\s*않|포함되(어\s*있)?지\s*않)/,
  /제목만(으로는|\s*있|\s*제공)/,
  /(요약할|정리할)\s*(내용|재료|정보)(이|가)?\s*(없|부족)/,
  /\b(cannot|can't|unable to)\s+(be\s+)?summari[sz]/i,
  /\bno\s+(article\s+)?(body|content|text)\s+(was\s+|is\s+)?(provided|available)/i,
]);
export function aiSaysNoMaterial(text: unknown): boolean {
  const s = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  if (!s) return false;
  return AI_NO_MATERIAL_PATTERNS.some((re) => re.test(s));
}

// Responses 요청 몸통에 생각 수준을 붙인다. 부르는 쪽이 이미 reasoning을 정했으면 그대로 둔다.
export function withReasoning<T extends Record<string, unknown>>(body: T): T & { reasoning: unknown } {
  return { ...body, reasoning: body.reasoning ?? { effort: AI_REASONING_EFFORT } };
}
