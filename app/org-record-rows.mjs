// ORG-기록하나로 O-5(설계 docs/design/record-one.md 4절 '조직 상세'): 조직 상세 '날짜 | 기록' 한 표의 순수 규칙.
// - 날짜 칸: 기록 날짜(occurred_at의 서울 날짜) 'M.D.', 기간 기록(end_day)은 'M.D.~M.D.', 올해가 아니면 'YY.M.D.'.
// - 최근 RECENT 줄만 펼치고 그 앞(더 오래된) 줄은 '지난 기록 n'으로 접는다(줄은 날짜 내림차순 그대로).
// - 원래 줄 보기: 통화·텔레그램(feed)·소식(memorable)·업데이트(update)에서 온 기록만 ⋯ [원래 글 보기]가 있다(옮긴 옛 줄·직접 쓴 줄은 없음).
// 화면 그리기·서버 읽기는 workplace-detail.js·org-record-source.js. 브라우저 저장소를 쓰지 않는다.
export const RECENT = 10;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KST = 9 * 3600 * 1000;

// 서울 날짜 'YYYY-MM-DD'. 날짜를 읽지 못하면 ''.
export function seoulDay(ts) {
  const t = Date.parse(ts ?? '');
  return Number.isFinite(t) ? new Date(t + KST).toISOString().slice(0, 10) : '';
}

function md(day, thisYear) {
  if (!DAY.test(day)) return '';
  const [y, m, d] = day.split('-').map(Number);
  return `${y === thisYear ? '' : String(y).slice(2) + '.'}${m}.${d}.`;
}

// 날짜 칸 글. today = 오늘 서울 날짜(올해 판정용).
// ORG-기록날짜고치기: 날짜 '없음' 기록(day_none)은 '-'만.
export function dayCell(row, today = seoulDay(new Date().toISOString())) {
  if (row?.day_none === true) return '-';
  const start = seoulDay(row?.occurred_at), year = Number(String(today).slice(0, 4));
  const first = md(start, year);
  if (!first) return '';
  const end = DAY.test(String(row?.end_day ?? '')) && row.end_day > start ? md(row.end_day, year) : '';
  return end ? `${first}~${end}` : first;
}

// 최근 n줄과 접을 줄. rows는 이미 날짜 내림차순.
export function splitRecent(rows, n = RECENT) {
  const list = Array.isArray(rows) ? rows : [];
  return {shown: list.slice(0, n), older: list.slice(n)};
}

export const SOURCE_KINDS = Object.freeze({feed: '원래 통화·글 보기', memorable: '원래 소식 보기', update: '원래 업데이트 보기'});
export const hasSource = row => Object.hasOwn(SOURCE_KINDS, row?.source_kind ?? '') && typeof row?.source_id === 'string' && !!row.source_id;
export const sourceLabel = row => hasSource(row) ? SOURCE_KINDS[row.source_kind] : '';
