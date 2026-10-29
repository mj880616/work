// SEC-요약비밀가리기: AI가 쓴 요약 글(저장하는 칸)에서 비밀처럼 생긴 값을 [비밀]로 가린다. 원문(raw_text)에는 쓰지 않는다.
// 서버 공용 순수 함수(입출력 없음). collector-feed(텔레그램 요약·통화 요약 줄)·ai-assist(원장·챙길 것·한 장 정리 등)·meeting-ai-draft가 같이 쓴다.
// 규칙은 보수적으로 둔다: 날짜·시각·전화번호·금액·호수 같은 보통 글은 건드리지 않는다(tests/security/summary-secret-redact.test.mjs).
// ① 비밀 낱말(비밀번호·비번·현관·도어락·출입 번호·인증번호·OTP·PIN·계좌·API 키 등) 바로 뒤(짧은 이음말만 사이에 둠)의
//    4자 이상 값 중 숫자나 기호가 든 것 → 낱말은 남기고 값만 [비밀].
// ② 키·토큰 모양(개인키 머리, sk-…, ghp_…, AKIA…, JWT, xox…-, 대소문자·숫자가 섞인 24자 이상 덩어리) → [비밀].
// ③ 주민등록번호 모양(######-#######), 카드번호 모양(####-####-####-####) → [비밀].
// 웹 주소(http…) 안쪽은 ②의 긴 덩어리 검사를 하지 않는다(주소가 깨지지 않게).

export const SECRET_MARK = '[비밀]';

// AI 지시문에 넣는 한 줄(요약을 쓰는 지시문에 그대로 넣는다).
export const AI_SECRET_RULE = "비밀 값: 비밀번호·현관·도어락·출입 번호·인증번호·OTP·계좌번호·주민등록번호·토큰·키 같은 값은 요약·정리 글에 옮겨 적지 않고 [비밀]로 쓴다(예: '현관 비밀번호 [비밀]').";

const WORD = String.raw`(?:비밀\s*번호|비번|패스\s*워드|암호|공동\s*현관(?:\s*(?:문|번호|비번|비밀\s*번호))?|현관(?:\s*(?:문|번호|비번|비밀\s*번호))?|도어\s*락(?:\s*(?:번호|비번))?|출입\s*(?:문\s*)?(?:번호|비번|코드)|인증\s*(?:번호|코드|키)|확인\s*코드|OTP|PIN(?:\s*번호)?|핀\s*번호|계좌\s*(?:번호|비번|비밀\s*번호)?|password|passwd|pwd|pw|passcode|api[\s_-]?key|access[\s_-]?key|액세스\s*키|접속\s*키)`;
// 낱말과 값 사이에 올 수 있는 짧은 이음말(공백·:·=·은/는/이/가·화살표). 다른 낱말이 끼면 걸지 않는다.
const JOIN = String.raw`(?:\s*(?:[:：=]|->|→)?\s*(?:은|는|이|가|도)?\s*(?:[:：=]|->|→)?\s*['"‘’“”]?)`;
const VALUE = String.raw`[0-9A-Za-z#*!@$%^&_+=.~\-]{4,}`;
const NEAR = new RegExp(`(?<![A-Za-z])(${WORD})(?![A-Za-z])(${JOIN})(${VALUE})`, 'gi');

const DATE_LIKE = /^(?:\d{4}[-./]\d{1,2}(?:[-./]\d{1,2})?|\d{1,2}[-./]\d{1,2}(?:[-./]\d{2,4})?)\.?$/;
const TIME_LIKE = /^\d{1,2}:\d{2}(?::\d{2})?$/;
// 뒤에 단위가 붙은 숫자(1030호·10시·2층·5000원 등)는 값이 아니다.
const UNIT_AFTER = /^[호층동시분초일월년원명개번차회주건쪽장권]/;

// 값으로 볼 만한가: 숫자나 기호가 들어 있고, 날짜·시각 모양이 아니다. 글자만 있는 낱말(예: reset)은 값으로 보지 않는다.
function valueLike(v) {
  if (!/[0-9#*!@$%^&_+=~]/.test(v)) return false;
  if (DATE_LIKE.test(v) || TIME_LIKE.test(v)) return false;
  return true;
}

const SHAPES = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(?:sk|pk|rk)[-_](?:live|test|proj)?[-_]?[A-Za-z0-9]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/g,
  /(?<!\d)\d{6}-[1-8]\d{6}(?!\d)/g,
  /(?<!\d)\d{4}-\d{4}-\d{4}-\d{4}(?!\d)/g,
];
const LONG_RANDOM = /[A-Za-z0-9+/_=-]{24,}/g;
const URL_PART = /(https?:\/\/[^\s<>"')\]]+)/i;

function redactPlain(s) {
  let out = s;
  for (const re of SHAPES) out = out.replace(re, SECRET_MARK);
  out = out.replace(LONG_RANDOM, (m) => ([/[a-z]/, /[A-Z]/, /\d/].filter((re) => re.test(m)).length >= 3 ? SECRET_MARK : m));
  out = out.replace(NEAR, (whole, word, join, value, offset, str) => {
    const after = str.slice(offset + whole.length);
    if (!valueLike(value) || UNIT_AFTER.test(after)) return whole;
    return `${word}${join}${SECRET_MARK}`;
  });
  return out;
}

// 글 하나를 가린다. 글이 아니면 그대로 돌려준다(null·숫자 등). 가린 뒤 글자 수는 늘지 않는다([비밀]은 4자, 값은 4자 이상).
/** @template T @param {T} text @returns {T} */
export function redactSecrets(text) {
  if (typeof text !== 'string' || !text) return text;
  return text.split(URL_PART).map((part, i) => (i % 2 === 1 ? part : redactPlain(part))).join('');
}

// 글 목록(줄들)을 가린다. 목록이 아니면 그대로.
/** @template T @param {T} list @returns {T} */
export function redactSecretLines(list) {
  return Array.isArray(list) ? list.map((v) => redactSecrets(v)) : list;
}
