// Edge 응답·로그에 DB·외부 API·런타임 오류 원문을 싣지 않기 위한 공통 도구(EDGE-서버함수정리).
// 화면에 보내도 되는 것: 코드가 직접 쓴 짧은 한국어 문구, 오류 코드(대문자·밑줄 또는 소문자_밑줄).
// 그 밖(영어 문장, 중괄호·꺾쇠가 든 글, 200자 넘는 글)은 기본 문구로 바꾼다.

export const SAFE_ERROR_FALLBACK = "요청을 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";

const ERROR_CODE = /^(?:[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*|[a-z][a-z0-9]*(?:_[a-z0-9]+)+)$/;
const HANGUL = /[가-힣]/;
const LATIN_SENTENCE = /[A-Za-z]+[\s,.:;'"()-]+[A-Za-z]+[\s,.:;'"()-]+[A-Za-z]+/;
const MARKUP = /[{}<>\\]/;
const LOG_CODE = /^[A-Za-z0-9_.-]{1,40}$/;

function rawMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return "";
}

// 화면에 돌려줄 문구. 원문이 섞였을 수 있으면 fallback.
export function safeErrorMessage(error: unknown, fallback = SAFE_ERROR_FALLBACK): string {
  const message = rawMessage(error).trim();
  if (!message) return fallback;
  if (message.length <= 64 && ERROR_CODE.test(message)) return message;
  if (message.length <= 200 && HANGUL.test(message) && !LATIN_SENTENCE.test(message) && !MARKUP.test(message)) {
    return message;
  }
  return fallback;
}

// 로그에 남길 값: 오류 종류·코드·상태 숫자만. 메시지·세부·힌트·응답 본문은 남기지 않는다.
export function safeErrorLog(error: unknown): { name?: string; code?: string; status?: number } {
  const out: { name?: string; code?: string; status?: number } = {};
  if (!error || typeof error !== "object") return out;
  const e = error as { name?: unknown; code?: unknown; status?: unknown };
  if (typeof e.name === "string" && LOG_CODE.test(e.name)) out.name = e.name;
  if (typeof e.code === "string" && LOG_CODE.test(e.code)) out.code = e.code;
  if (typeof e.status === "number" && Number.isInteger(e.status)) out.status = e.status;
  return out;
}
