// NOTE-AI제외정리(2026-11-10 17:41 명진 결정 A, 10/28 NOTE-비밀메모를 바꿈): 노트를 통째로 AI에서 빼지 않는다.
// 비밀번호·토큰·키 모양 부분만 서버가 AI로 보내기 직전에 '[가림]'으로 바꾸고 나머지는 다 보낸다(화면 표시 없음, 저장값은 그대로).
// 서버의 판별·가림은 이 파일 한 곳이다(note-title.ts 등은 여기서 가져다 쓴다). 노트 → AI 길 전수는 docs/design/note-ai-mask.md.
// 옛 노트 메뉴 표시 metadata.ai_off는 지우지 않고 읽지도 않는다(데이터 보존).
// 순수 함수만(입출력 없음). 가린 글자는 어디에도 남기지 않는다(기록은 개수만).
const plain = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

// ---- 판별 규칙(10/28 NOTE-비밀메모에서 정한 그대로) ----
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

// 숫자·대소문자가 섞인 키 모양 덩어리인가(주소는 뺌). looksSecret과 maskSecret이 같은 판단을 쓴다.
const randomChunk = (m: string) => !/^https?/i.test(m) && [/[a-z]/, /[A-Z]/, /\d/].filter((re) => re.test(m)).length >= 3;

export function looksSecret(text: string): boolean {
  const s = String(text ?? "");
  if (SECRET_WORD.test(s)) return true;
  if (SECRET_SHAPE.some((re) => re.test(s))) return true;
  return (s.match(LONG_RANDOM) || []).some(randomChunk);
}

// AI로 보내는 글에서 비밀 모양 부분만 가린다. 결과는 looksSecret이 false다(남으면 그 줄, 그래도 남으면 글 전체를 가림).
// ① 개인 키 묶음(BEGIN~END) ② 알려진 키 모양 ③ 키 모양 덩어리 ④ '비밀번호·토큰' 같은 말이 나온 줄은 그 말부터 줄 끝까지.
export const SECRET_MASK = "[가림]";
const PEM_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g;
const globalOf = (re: RegExp) => new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
export function maskSecret(text: unknown): string {
  const s = typeof text === "string" ? text : "";
  if (!s || !looksSecret(s)) return s;
  let t = s.replace(PEM_BLOCK, SECRET_MASK);
  for (const re of SECRET_SHAPE) t = t.replace(globalOf(re), SECRET_MASK);
  t = t.replace(LONG_RANDOM, (m) => randomChunk(m) ? SECRET_MASK : m);
  t = t.split("\n").map((line) => {
    const at = line.search(SECRET_WORD);
    const cut = at >= 0 ? line.slice(0, at) + SECRET_MASK : line;
    return looksSecret(cut) ? SECRET_MASK : cut;
  }).join("\n");
  return looksSecret(t) ? SECRET_MASK : t;
}

// AI 재료로 읽은 노트 표 한 행 → 제목·본문·AI 제목만 가린 복사본(다른 칸은 그대로, 원래 행은 고치지 않음).
// 노트·업데이트·업무일지 줄(kind 상관없이) 모두 같은 길로 지난다. 저장하는 길에는 쓰지 않는다(읽은 값 그대로 쓴다).
export function aiNoteRow<T extends Record<string, unknown>>(row: T): T {
  if (!plain(row)) return row;
  const out: Record<string, unknown> = { ...row };
  if (typeof row.title === "string") out.title = maskSecret(row.title);
  if (typeof row.raw_text === "string") out.raw_text = maskSecret(row.raw_text);
  if (plain(row.metadata) && typeof row.metadata.ai_title === "string") out.metadata = { ...row.metadata, ai_title: maskSecret(row.metadata.ai_title) };
  return out as T;
}
