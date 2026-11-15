// 번역 엔진(S52-12 NEWS-원문먼저번역 ②, S52-36부터 news-feed·outside-feed 공용 — 흐름은 feed-translate.ts): Google Cloud Translation v2 REST(서버에서만 부름).
// - 열쇠는 Edge 비밀값 GOOGLE_TRANSLATE_API_KEY에서만 읽는다(값은 코드·로그·응답 어디에도 쓰지 않음, 주소가 아닌 x-goog-api-key 헤더로 보냄).
//   비밀값이 없거나 Google이 실패하면 null을 돌려주고, 부르는 쪽(feed-translate.ts translateText)이 기존 AI 번역으로 돌아간다.
// - 기사 body(글자 블록 p·h·quote를 한 줄씩 이은 것)를 줄 단위로 보내고 같은 순서로 받아, 줄 수를 그대로 맞춘 body_ko를 만든다.
//   화면(app/now-model.mjs translatedBlocks)은 이 줄을 같은 순서의 글자 블록에 하나씩 넣어 문단·사진 자리를 그대로 둔다.
// - 글자 수 상한(maxChars)을 넘는 뒷부분은 보내지 않고 표시 줄(TRANSLATE_REST_MARK)을 붙인다. 로그에는 단계 코드·HTTP 상태만.
import { readBoundedJson } from "./bounded-json.mjs";

export const GOOGLE_KEY_NAME = "GOOGLE_TRANSLATE_API_KEY";
export const GOOGLE_TRANSLATE_URL = "https://translation.googleapis.com/language/translate/v2";
export const GOOGLE_BATCH_SEGMENTS = 100; // 한 요청 줄 수(v2 한도 128 안쪽)
export const GOOGLE_BATCH_CHARS = 10000;  // 한 요청 글자 수(권장 크기 안쪽, 넘는 한 줄은 그 줄만 따로)
export const GOOGLE_TIMEOUT_MS = 30000;
export const TRANSLATE_REST_MARK = "(이후 부분은 원문만 있음)";
const SEGMENT_MAX = 20000;

type Log = (code: string, detail?: Record<string, unknown>) => void;
type EnvFn = (name: string) => string | undefined;

// 열쇠: 공백 없는 20~200자만(잘못 붙여 넣은 값은 없는 것으로 → AI 번역).
export function googleKeyFrom(env: EnvFn): string | null {
  const v = env(GOOGLE_KEY_NAME);
  return typeof v === "string" && /^[A-Za-z0-9_-]{20,200}$/.test(v) ? v : null;
}
// 화면과 같은 줄 나누기: 줄바꿈으로 나누고 앞뒤 공백을 떼고 빈 줄은 버린다.
export const bodyLines = (text: string): string[] => String(text ?? "").split(/\n+/).map((t) => t.trim()).filter(Boolean);
// 앞에서부터 글자 수 상한까지 통째 줄만. 첫 줄이 상한보다 길면 그 줄을 상한에서 자른다.
export function pickLines(lines: string[], maxChars: number): { take: string[]; rest: boolean } {
  const take: string[] = [];
  let n = 0;
  for (const line of lines) {
    const len = [...line].length;
    if (n + len > maxChars) {
      if (!take.length) take.push([...line].slice(0, maxChars).join(""));
      return { take, rest: true };
    }
    take.push(line); n += len;
  }
  return { take, rest: false };
}
// 요청 묶음: 줄 수·글자 수 상한 안에서 차례대로.
export function batches(segments: string[], maxSeg = GOOGLE_BATCH_SEGMENTS, maxChars = GOOGLE_BATCH_CHARS): string[][] {
  const out: string[][] = [];
  let cur: string[] = [], n = 0;
  for (const s of segments) {
    const len = [...s].length;
    if (cur.length && (cur.length >= maxSeg || n + len > maxChars)) { out.push(cur); cur = []; n = 0; }
    cur.push(s); n += len;
  }
  if (cur.length) out.push(cur);
  return out;
}
const cleanOut = (v: unknown): string => typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/\s*[\r\n]+\s*/g, " ").trim().slice(0, SEGMENT_MAX) : "";
const sourceLang = (lang: unknown): string | null => typeof lang === "string" && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(lang) && lang !== "ko" ? lang : null;

// 줄 목록 → 같은 수의 한국어 줄. 하나라도 실패하면 null(부분 저장 없음).
export async function googleTranslateLines(doFetch: typeof fetch, key: string, segments: string[], lang: unknown, log: Log): Promise<string[] | null> {
  const out: string[] = [];
  const source = sourceLang(lang);
  for (const q of batches(segments)) {
    let r: Response;
    try {
      r = await doFetch(GOOGLE_TRANSLATE_URL, {
        method: "POST", signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
        headers: { "content-type": "application/json; charset=utf-8", "x-goog-api-key": key },
        body: JSON.stringify({ q, target: "ko", format: "text", ...(source ? { source } : {}) }),
      });
    } catch { log("google_translate_failed", { stage: "network" }); return null; }
    if (!r.ok) { try { await r.body?.cancel(); } catch { /* ignore */ } log("google_translate_failed", { stage: "http", status: r.status }); return null; }
    let v: unknown;
    try { v = await readBoundedJson(r, { maxBytes: 4 * 1024 * 1024 }); } catch { log("google_translate_failed", { stage: "read" }); return null; }
    const list = (v as { data?: { translations?: unknown } } | null)?.data?.translations;
    if (!Array.isArray(list) || list.length !== q.length) { log("google_translate_failed", { stage: "shape" }); return null; }
    // 빈 번역 줄은 원문 줄을 둔다(줄 수·자리를 지키려고).
    list.forEach((t, i) => out.push(cleanOut((t as { translatedText?: unknown } | null)?.translatedText) || q[i]));
  }
  return out;
}

// 기사 하나: 제목(없을 때만)·본문 줄 → {title_ko, body_ko}. 못 하면 null.
export async function googleTranslateItem(
  doFetch: typeof fetch, key: string, item: { title: string; text: string; lang: unknown; needTitle: boolean }, maxChars: number, log: Log,
): Promise<{ title_ko: string | null; body_ko: string | null } | null> {
  const pick = pickLines(bodyLines(item.text), maxChars);
  const head = item.needTitle && item.title ? [item.title] : [];
  const segs = [...head, ...pick.take];
  if (!segs.length) return null;
  const got = await googleTranslateLines(doFetch, key, segs, item.lang, log);
  if (!got) return null;
  const title_ko = head.length ? got[0].slice(0, 500) || null : null;
  const lines = got.slice(head.length);
  const body_ko = lines.length ? (lines.join("\n") + (pick.rest ? `\n\n${TRANSLATE_REST_MARK}` : "")).slice(0, 100000) : null;
  if (!title_ko && !body_ko) return null;
  return { title_ko, body_ko };
}
