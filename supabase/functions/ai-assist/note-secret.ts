// NOTE-비밀메모 서버 쪽(2026-10-28 17:23 명진 결정): 비밀번호·토큰·키 모양 글이 든 노트는 자동으로 AI에 보내지 않는다.
// 서버의 판별은 이 파일 한 곳이다(note-title.ts 등은 여기서 가져다 쓴다). 화면 공용 모듈 app/note-secret.mjs와 같은 규칙이며,
// 배포 묶음 밖(app/)은 가져올 수 없어 두 벌을 둔다 — tests/note-secret.test.mjs가 두 파일의 규칙 줄·판별 함수를 글자 그대로 비교한다.
// 순수 함수만(입출력 없음). 걸린 노트의 제목·본문은 어디에도 남기지 않는다(기록은 개수만).
const plain = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

// ---- 화면 app/note-secret.mjs와 같은 규칙(이 블록은 글자 그대로 맞춘다) ----
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

export function looksSecret(text: string): boolean {
  const s = String(text ?? "");
  if (SECRET_WORD.test(s)) return true;
  if (SECRET_SHAPE.some((re) => re.test(s))) return true;
  for (const m of s.match(LONG_RANDOM) || []) {
    if (/^https?/i.test(m)) continue;
    const kinds = [/[a-z]/, /[A-Z]/, /\d/].filter((re) => re.test(m)).length;
    if (kinds >= 3) return true;
  }
  return false;
}

type NoteLike = { kind?: unknown; title?: unknown; raw_text?: unknown; metadata?: unknown } | null | undefined;
// 노트 글(제목 + 본문)이 비밀 모양인가.
export const noteLooksSecret = (note: NoteLike) => looksSecret(`${typeof note?.title === "string" ? note.title : ""}\n${typeof note?.raw_text === "string" ? note.raw_text : ""}`);
// 노트 메뉴의 표시(metadata.ai_off): true = [AI에 보내지 않기], false = [AI 제외 풀기]로 풂, 없음 = 정하지 않음.
export const noteAiOffMark = (note: NoteLike) => { const m = note?.metadata; const v = plain(m) ? m.ai_off : undefined; return v === true ? true : v === false ? false : null; };
// 이 노트를 AI에 보내지 않나: 직접 표시했거나, 비밀 모양 글이 들어 있고 [풀기]로 풀지 않았을 때.
export const noteAiOff = (note: NoteLike) => { const mark = noteAiOffMark(note); return mark === true || (mark !== false && noteLooksSecret(note)); };

// AI 재료로 읽은 노트 표 한 행을 건너뛰나. 노트(kind=note)만 본다 — [AI에 보내지 않기]/[풀기] 메뉴와 '비밀 메모' 가리기가
// 노트에만 있어서, 업데이트(basket)·업무일지 줄(work)은 풀 길이 없으므로 여기서 막지 않는다(기존 ai_export_allowed 조건은 그대로).
export const noteRowAiBlocked = (row: NoteLike) => row?.kind === "note" && noteAiOff(row);
// AI에 노트 행을 읽을 때 select에 꼭 넣는 칸(판별에 필요): kind·title·raw_text·metadata.
export const NOTE_GUARD_FIELDS = "kind,title,raw_text,metadata";
