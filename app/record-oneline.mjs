// RECORD-한줄 ①(설계 docs/design/record-one.md, 시안 docs/design/mockups/org-record-oneline.html): 기록 '한 줄' 공용 규칙 한 곳 — 화면·네트워크 없음.
// 기록(조직 기록·사업 기록) = 원문 + 한 줄. 원문(raw_text·body)은 하나도 바꾸지 않고, 보고 표·목록처럼 한 줄로 보이는 곳은 이 함수 하나로 한 줄을 만든다.
// - 표시 기호 걷어내기는 미리 보기 공용 규칙(note-preview.mjs plainLines: 머리 #·목록·인용·굵게·링크·표 칸 | → ' · '·표 구분 줄·가로줄·
//   코드 울타리·HTML 태그·엔티티 &#x20;·AI가 붙인 역슬래시)을 그대로 쓰고, 남은 제어문자·보이지 않는 방향 글자는 띄어쓰기로.
// - 원문이 짧으면(걷어낸 뒤 ONE_LINE_MAX자 안, 줄이 여러 개면 띄어쓰기로 이어서) 그대로.
// - 길면 첫 줄의 첫 문장(숫자 뒤 마침표 '11.5.'는 문장 끝으로 보지 않음, 너무 짧은 문장은 줄로)을 ONE_LINE_MAX자 안에서 자르고 '…'.
// 저장된 한 줄(RECORD-한줄 ②·③에서 생길 one_line 칸: AI가 만든 한 줄 또는 명진이 고친 한 줄)이 있으면 그 값이 먼저다(recordOneLine).
import {plainLines as markLines} from './note-preview.mjs';

export const ONE_LINE_MAX = 60;
const SENTENCE_MIN = 20;

const chars = s => [...String(s ?? '')].length;
const cut = (s, n) => [...String(s ?? '')].slice(0, n).join('');
const tidy = s => String(s ?? '').replace(/[\p{Cc}\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/gu, ' ').replace(/\s+/g, ' ').trim();
// 원문 → 표시 기호를 걷어낸 줄들(빈 줄 뺌).
export const plainLines = text => markLines(String(text ?? '').replace(/[\u2028\u2029]/g, '\n')).map(tidy).filter(Boolean);
// 첫 문장: 글자(숫자 말고) 뒤의 . ! ? 。 다음에 띄어쓰기나 끝. SENTENCE_MIN자보다 짧으면 문장으로 보지 않고 줄을 자른다.
function firstSentence(line) {
  const m = /^(.+?[^\d\s][.!?。])(?=\s|$)/u.exec(line);
  return m && chars(m[1]) >= SENTENCE_MIN ? m[1] : line;
}
// 원문 → 한 줄(빈 글이면 '').
export function oneLine(text, max = ONE_LINE_MAX) {
  const lines = plainLines(text);
  if (!lines.length) return '';
  const flat = lines.join(' ');
  if (chars(flat) <= max) return flat;
  const s = firstSentence(lines[0]);
  return chars(s) > max ? `${cut(s, max).trimEnd()}…` : `${s}…`;
}
// 기록 행의 한 줄: 저장된 한 줄(one_line)이 있으면 그 값, 없으면 원문(field 칸)에서 임시 한 줄.
export function recordOneLine(row, field = 'raw_text') {
  const saved = plainLines(row?.one_line).join(' ');
  return saved || oneLine(row?.[field]);
}
