// AI-사람별한도: ai-assist 시험의 가짜 fetch 앞에 '이번 달 AI 합계' DB 함수(app_my_ai_month) 답을 붙인다.
// 기본 답은 한도 아래(사용 0, 한도 3,000원, 운영자 아님). 한도·운영자 제외 시험은 ai-user-cap.test.mjs가 따로 본다.
export const AI_MONTH_UNDER = Object.freeze({month: '2026-11', exempt: false, cap_krw: 3000, openai_input_tokens: 0, openai_output_tokens: 0, gemini: []});
export function withAiMonth(deps, month = AI_MONTH_UNDER) {
  const inner = deps.fetch ?? globalThis.fetch;
  const fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname === '/rest/v1/rpc/app_my_ai_month') {
      const body = typeof month === 'function' ? month(JSON.parse(init?.body || '{}'), init) : month;
      if (body instanceof Response) return body;
      return new Response(JSON.stringify(body), {status: 200, headers: {'Content-Type': 'application/json'}});
    }
    return inner(input, init);
  };
  return {...deps, fetch};
}
