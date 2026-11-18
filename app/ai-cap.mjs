// AI-사람별한도(MULTI 단계 ③): 사람(작업공간)마다 한 달 AI 한도. 서버(_shared/ai-user-cap.mjs)가 넘으면 429 ai_monthly_cap으로 답한다.
// 화면은 그 기능 자리에 이 한 줄만 보인다(서버 글이 있으면 그 글 — 한도 금액이 작업공간마다 다를 수 있음). 운영자 화면은 이 코드를 받지 않는다.
export const AI_CAP_CODE = 'ai_monthly_cap';
export const AI_CAP_TEXT = '이번 달 AI 사용 한도(3,000원)를 다 썼어요. 다음 달 1일에 다시 쓸 수 있어요.';
// 서버 글이 같은 모양(이번 달 AI 사용 한도(…원)…)이면 그 글, 아니면 기본 글.
export function aiCapText(serverText = '') {
  const t = String(serverText || '');
  return /^이번 달 AI 사용 한도\([0-9,]+원\)를 다 썼어요\. 다음 달 1일에 다시 쓸 수 있어요\.$/.test(t) ? t : AI_CAP_TEXT;
}
// 서버 답·오류에서 한도 거절인지(code·error·서버 글 셋 중 하나). 공용 요청(runtime api)은 code를 'http_429'로 바꾸므로 글로도 본다.
export function isAiCap(x) {
  if (!x) return false;
  if (typeof x === 'string') return x === AI_CAP_CODE || x === AI_CAP_CODE.toUpperCase() || x.startsWith('이번 달 AI 사용 한도(');
  return [x.code, x.error, x.message].some(v => typeof v === 'string' && isAiCap(v));
}
// 내 프로필 한 줄(ai-assist kind=ai_month 답). 운영자(exempt)·한도 전·모양이 틀린 답은 null(줄을 그리지 않음 — 명진 화면은 그대로).
export function aiMonthLine(d) {
  if (!d || d.ok !== true || d.exempt !== false) return null;
  const used = Number(d.used_krw), cap = Number(d.cap_krw);
  if (!Number.isSafeInteger(used) || used < 0 || !Number.isSafeInteger(cap) || cap < 0) return null;
  const won = n => n.toLocaleString('ko-KR');
  // MULTI-다른담당자맞춤 ⑥(명진 11/13 15:30): 한도에 닿았을 때만 한 줄. 그 전에는 줄을 그리지 않는다(쓴 금액·한도 줄 없앰).
  if (d.capped) return {text: `이번 달 AI 사용 한도(${won(cap)}원)를 다 썼어요. 다음 달 1일에 다시 쓸 수 있어요.`, capped: true};
  return null;
}
