// S67-36(요청함 11/20 20:17 '투쟁사업장 보고랑 조직보고 둘다 날짜 내용 이런 형식인데 내용에 날짜가 중복 표기되는 경우 잦음'):
// '날짜 + 내용' 줄의 내용 맨 앞에 그 줄 날짜와 같은 날짜가 또 적혀 있으면(사람이 기록 첫머리에 날짜를 적어 둔 경우 등) 그 앞 날짜만 떼고 보인다.
// 화면·복사·한글 파일·확정 사진이 모두 이 함수 하나를 쓴다(저장된 원문·보고용 글은 바꾸지 않는다 — 보일 때만 뗀다). 화면·네트워크 없음.
// - 떼는 것: 내용 맨 앞의 날짜 한 덩어리(앞뒤 괄호·대괄호, 요일 '(화)'·'화요일', 뒤따르는 띄어쓰기·하이픈·쌍점·쉼표·가운뎃점·빗금).
//   표기: 11/18 · 11.18 · 11.18. · 11. 18. · 11월 18일 · 2026-11-18 · 2026.11.18. · 2026/11/18 · 2026년 11월 18일.
// - 같은 날일 때만: 하루 줄이면 그 날, 기간 줄이면 내용 앞도 같은 기간('11.18~11.20')일 때만. 연도가 적혀 있으면 연도도 같아야 한다.
// - 그대로 두는 것: 다른 날, 내용 중간의 날짜, 떼고 나면 남는 글이 없는 줄, 날짜 없는 줄(날짜 '없음' 기록 포함).
// - 같은 날짜가 두 번 이어 적힌 경우('11/18 11.18 …')도 모두 뗀다(두 번 불러도 결과가 같다).
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAY = /^\s*(?:[(（]\s*[월화수목금토일](?:요일)?\s*[)）]|[월화수목금토일]요일)/u;
const OPEN = /^[[(（【〈<]/u;
const CLOSE = /^\s*[\])）】〉>]/u;
const AFTER = /^[\s\-–—:：,，·ㆍ|/]+/u;
const RANGE = /^\s*[~∼〜～]\s*/u;
const LIST = /^[-•·*]\s+/u;

const partsOf = day => (typeof day === 'string' && DAY.test(day) ? {y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)), d: Number(day.slice(8, 10))} : null);
const okMD = (m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31;

// 글 맨 앞의 날짜 하나 → {y|null, m, d, len} 또는 null. month=false면 '20'처럼 날만(기간 끝 '11.18~20').
function leadDate(s, {month = null} = {}) {
  let x;
  if ((x = /^(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/u.exec(s))) return pick(+x[1], +x[2], +x[3], x[0].length);
  if ((x = /^(\d{1,2})\s*월\s*(\d{1,2})\s*일/u.exec(s))) return pick(null, +x[1], +x[2], x[0].length);
  if ((x = /^(\d{4})\s*([-./])\s*(\d{1,2})\s*\2\s*(\d{1,2})(?![\d%])(\s*\.)?/u.exec(s))) return pick(+x[1], +x[3], +x[4], x[0].length);
  if ((x = /^(\d{1,2})\s*[./]\s*(\d{1,2})(?![\d%])(\s*\.(?!\d))?/u.exec(s))) return pick(null, +x[1], +x[2], x[0].length, !x[3]);
  if (month != null && (x = /^(\d{1,2})\s*일?(?![\d%.])/u.exec(s))) return pick(null, month, +x[1], x[0].length);
  return null;
}
const pick = (y, m, d, len, loose = false) => (okMD(m, d) ? {y, m, d, len, loose} : null);
const same = (a, b) => !!a && !!b && a.m === b.m && a.d === b.d && (a.y == null || a.y === b.y);

// 한 번 떼기. 떼지 못하면 null.
function dropOnce(text, start, end) {
  let s = text, open = false;
  const list = LIST.exec(s);
  if (list) s = s.slice(list[0].length);
  if (OPEN.test(s)) { open = true; s = s.slice(1).trimStart(); }
  const first = leadDate(s);
  if (!first) return null;
  s = s.slice(first.len);
  if (/^\.?\d/u.test(s)) return null; // '11.18.5'·'11.185' 같은 숫자는 날짜가 아니다
  const wd = WEEKDAY.exec(s);
  if (wd) s = s.slice(wd[0].length);
  let last = null;
  const range = RANGE.exec(s);
  if (range) {
    const t = s.slice(range[0].length);
    last = leadDate(t) || leadDate(t, {month: first.m});
    if (!last) return null; // '11.18 ~' 뒤에 날짜가 없으면 손대지 않는다
    if (last.y == null && first.y != null) last = {...last, y: first.y};
    s = t.slice(last.len);
    const wd2 = WEEKDAY.exec(s);
    if (wd2) s = s.slice(wd2[0].length);
  }
  if (!same(first, start)) return null;
  if (end ? !same(last, end) : last) return null; // 하루 줄은 하루 날짜만, 기간 줄은 같은 기간만
  if (open) { const c = CLOSE.exec(s); if (!c) return null; s = s.slice(c[0].length); }
  const after = AFTER.exec(s);
  // 마침표 없는 '1.5'·'3/4' 꼴은 바로 글자가 붙으면(예: '1.5배') 숫자일 수 있어 떼지 않는다(띄어쓰기·괄호·요일·기간이 따를 때만).
  if (!after && s && first.loose && !wd && !range && !open) return null;
  if (after) s = s.slice(after[0].length);
  return s.trim();
}

// 줄 글에서 내용 맨 앞의 같은 날짜를 뗀다. day = 'YYYY-MM-DD'(줄 날짜), endDay = 기간 끝 날(없으면 하루 줄).
export function dropSameDay(text, day, endDay = null) {
  const raw = String(text ?? '');
  const start = partsOf(day);
  if (!start) return raw;
  const end = typeof endDay === 'string' && DAY.test(endDay) && endDay > day ? partsOf(endDay) : null;
  let out = raw.trim();
  for (let i = 0; i < 3; i++) {
    const next = dropOnce(out, start, end);
    if (next == null || !next) break;
    out = next;
  }
  return out === raw.trim() ? raw : out;
}
// 줄 하나(l.day·l.end_day·l.none)에 맞춰 뗀다. 날짜 '없음' 기록은 줄에 날짜가 보이지 않으므로 그대로.
export const dropLineDay = (text, l) => (l?.none ? String(text ?? '') : dropSameDay(text, l?.day, l?.end_day));
