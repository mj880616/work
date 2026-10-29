// NOTE-비밀메모(2026-10-28 17:23 명진 결정): 비밀번호·토큰·키 모양 글이 든 노트는 목록·검색 제목을 '비밀 메모'로 가리고, 자동으로 AI에 보내지 않는다.
// 판별 규칙은 서버 supabase/functions/ai-assist/note-secret.ts와 같은 규칙이다(서버가 AI에 보내기 전에 한 번 더 본다).
// 두 곳이 어긋나지 않게 tests/note-secret.test.mjs가 서버 파일의 규칙 줄과 이 파일의 규칙 줄을 글자 그대로 비교한다.
// 화면 공용 순수 모듈(화면·저장소·네트워크 없음). 값은 어디에도 남기지 않는다(기기 저장 없음).
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---- 서버 note-title.ts와 같은 규칙(이 블록은 글자 그대로 맞춘다) ----
const SECRET_WORD = /(비밀\s*번호|비번|패스워드|password|passwd|pwd|api[\s_-]?key|secret|token|토큰|인증\s*키|액세스\s*키|access[\s_-]?key|private[\s_-]?key|otp|pin\s*번호|계좌\s*비번)\s*[:=：]?/i;
const SECRET_SHAPE = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:sk|pk|rk)[-_](?:live|test|proj)?[-_]?[A-Za-z0-9]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/,
];
// 숫자·대소문자·기호가 섞인 24자 이상 덩어리(키 모양).
const LONG_RANDOM = /[A-Za-z0-9+\/_=-]{24,}/g;
// ---- 여기까지 ----

export function looksSecret(text) {
  const s = String(text ?? '');
  if (SECRET_WORD.test(s)) return true;
  if (SECRET_SHAPE.some(re => re.test(s))) return true;
  for (const m of s.match(LONG_RANDOM) || []) {
    if (/^https?/i.test(m)) continue;
    const kinds = [/[a-z]/, /[A-Z]/, /\d/].filter(re => re.test(m)).length;
    if (kinds >= 3) return true;
  }
  return false;
}

export const SECRET_TITLE = '비밀 메모';
// 노트 글(제목 + 본문)이 비밀 모양인가.
export const noteLooksSecret = note => looksSecret(`${typeof note?.title === 'string' ? note.title : ''}\n${typeof note?.raw_text === 'string' ? note.raw_text : ''}`);
// 노트 메뉴의 표시(metadata.ai_off): true = [AI에 보내지 않기]를 누름, false = 잘못 걸린 노트를 [풀기]로 풂, 없음 = 정하지 않음.
export const noteAiOffMark = note => { const v = plain(note?.metadata) ? note.metadata.ai_off : undefined; return v === true ? true : v === false ? false : null; };
// 이 노트를 AI에 보내지 않나: 직접 표시했거나, 비밀 모양 글이 들어 있고 [풀기]로 풀지 않았을 때.
export const noteAiOff = note => { const mark = noteAiOffMark(note); return mark === true || (mark !== false && noteLooksSecret(note)); };
// 목록·검색 제목을 가리나: 비밀 모양 글이 들어 있고 [풀기]로 풀지 않았을 때.
export const noteMasked = note => noteAiOffMark(note) !== false && noteLooksSecret(note);
