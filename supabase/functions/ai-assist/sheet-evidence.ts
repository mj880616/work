// ai-assist 공용: '한 장'·답 줄의 근거 검사(같은 부품 한 벌). 순수 함수만 둔다.
// 쓰는 곳: next-week-sheet.ts(다음 주 준비 한 장), pre-meeting-sheet.ts(교섭·회의 전 한 장).
// 물어보기(ask_web2, FEAT-1029묶음 ①) Edge 단계도 답 줄 근거 검사를 여기 groundedLines로 맞춘다(같은 부품 두 벌 금지).
// - 재료 줄은 [번호]를 달아 AI에 보내고, AI 답 줄은 refs(번호 배열)를 함께 돌려받는다.
// - 답 줄은 믿지 않는 입력: 글자 수·HTML·제어 문자·연락처·비밀 모양을 검사하고, 근거 번호가 보낸 줄(sent)에 하나도 없는 줄은 버린다.
import { looksSecret } from "./note-title.ts";

export const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2028\u2029\u2060-\u2069]/;
export const PHONE = /(?:\+?82[-\s]?)?0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}/;
export const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
export const chars = (s: string) => [...s].length;
// AI에 보내기 전 연락처를 지운다.
export const scrub = (s: string) => s.replace(new RegExp(EMAIL.source, "g"), "[이메일]").replace(new RegExp(PHONE.source, "g"), "[전화]");

export type GroundedLine = { text: string; refs: number[] };
// AI 답 배열(list)에서 근거 있는 줄만 max줄까지 고른다. 배열이 아니면 null(형식 틀림). 줄마다 refs는 sent 안의 번호만, 중복 없이 5개까지.
export function groundedLines(list: unknown, sent: ReadonlySet<number>, opts: { max: number; maxChars: number }): GroundedLine[] | null {
  if (!Array.isArray(list)) return null;
  const out: GroundedLine[] = [];
  for (const v of list) {
    if (out.length >= opts.max) break;
    if (!v || typeof v !== "object") continue;
    const t = (v as Record<string, unknown>).text, refs = (v as Record<string, unknown>).refs;
    if (typeof t !== "string" || CONTROL.test(t) || t.includes("<") || t.includes(">")) continue;
    const s = t.replace(/\s+/g, " ").replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, "").trim();
    if (!s || chars(s) > opts.maxChars || PHONE.test(s) || EMAIL.test(s) || looksSecret(s)) continue;
    if (!Array.isArray(refs)) continue;
    const ok = [...new Set(refs.filter((n): n is number => Number.isInteger(n) && sent.has(n as number)))].slice(0, 5);
    if (!ok.length) continue;
    out.push({ text: s, refs: ok });
  }
  return out;
}
