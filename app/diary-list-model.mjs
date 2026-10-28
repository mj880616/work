// JOURNAL-일기목록 (명진 요청 2026-10-28 08:04, 시안 '일기 목록' 07:52): 일기 [목록] 보기의 순수 규칙. 화면은 diary-list.js, 저장은 diary-data.js.
// - 📌 고정·★ 별표는 일기 행(app_notes kind=diary)의 기존 metadata jsonb에 시각으로 둔다(pinned_at·starred_at, 노트 고정 metadata.pinned_at과 같은 방식).
//   사진 별표(app_diary_stars)와는 따로, 일기 한 편 단위다. DB 변경 없음.
// - 목록: 최신순. 고정한 일기는 맨 위 '📌 고정' 칸에 따로(목록 달 묶음에는 다시 넣지 않는다). 달마다 머리줄 '2026년 10월 · 9'.
//   이번 달(목록에서 가장 최근 달)만 펼치고 지난달은 접어 둔다(누르면 펼침). 찾기·★ 보기 중에는 맞는 줄만 보여야 하므로 모두 펼친다.
// - 줄: 날짜·요일·제목 + 본문 첫 줄. 일기에는 제목 칸이 없어서 글이 두 줄 이상이면 첫 줄을 제목, 그다음 줄을 본문 첫 줄로 쓴다.
//   한 줄뿐이면 제목 없이(날짜만) 그 줄을 본문 첫 줄로. 글이 없으면 '사진 N장'.
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const markAt = (row, key) => { const v = plain(row?.metadata) ? row.metadata[key] : null; return typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null; };
export const diaryPinnedAt = row => markAt(row, 'pinned_at');
export const diaryStarredAt = row => markAt(row, 'starred_at');
export const MARK_KEYS = Object.freeze({pin: 'pinned_at', star: 'starred_at'});

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const dayRe = /^(\d{4})-(\d{2})-(\d{2})$/;
// 'YYYY-MM-DD' → {y, m(1~12), d, w(0=일)}. 날짜만의 계산이라 시간대와 무관하다.
export function dayParts(day) {
  const m = dayRe.exec(String(day || ''));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  return {y, m: mo, d, w: new Date(Date.UTC(y, mo - 1, d)).getUTCDay()};
}
export const dayLabel = day => { const p = dayParts(day); return p ? `${p.m}월 ${p.d}일 (${WEEK[p.w]})` : String(day || ''); };
export const monthKeyOf = day => String(day || '').slice(0, 7);
export const monthLabel = key => { const [y, m] = String(key).split('-').map(Number); return `${y}년 ${m}월`; };

const lines = text => String(text ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
// {title, line}: 제목(없으면 '')과 본문 첫 줄(없으면 '').
export function rowText(row, photoCount = 0) {
  const all = lines(row?.raw_text);
  if (all.length >= 2) return {title: all[0], line: all[1]};
  if (all.length === 1) return {title: '', line: all[0]};
  return {title: '', line: photoCount ? `사진 ${photoCount}장` : ''};
}
// 찾기: 공백으로 나눈 낱말이 모두 글(또는 날짜 표시)에 들어 있으면 맞다. 대소문자 구분 없음.
export const queryWords = query => String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
export function matches(row, words) {
  if (!words.length) return true;
  const hay = `${String(row?.raw_text ?? '')}\n${dayLabel(row?.journal_day)}\n${row?.journal_day || ''}`.toLowerCase();
  return words.every(word => hay.includes(word));
}
const byDayDesc = (a, b) => String(b.journal_day).localeCompare(String(a.journal_day));
// rows → {pinned:[행], months:[{key, label, count, rows, open}], total}. filter: 'all' | 'star'. opened: 사용자가 펼친(또는 접은) 달 {key: bool}.
export function buildDiaryList(rows, {filter = 'all', query = '', opened = {}} = {}) {
  const words = queryWords(query);
  const kept = (Array.isArray(rows) ? rows : []).filter(row => row && dayRe.test(String(row.journal_day)))
    .filter(row => filter !== 'star' || diaryStarredAt(row)).filter(row => matches(row, words)).sort(byDayDesc);
  const pinned = kept.filter(diaryPinnedAt).sort((a, b) => Date.parse(diaryPinnedAt(b)) - Date.parse(diaryPinnedAt(a)) || byDayDesc(a, b));
  const rest = kept.filter(row => !diaryPinnedAt(row));
  const groups = new Map();
  for (const row of rest) { const key = monthKeyOf(row.journal_day); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); }
  const narrowed = filter === 'star' || words.length > 0;
  const months = [...groups.entries()].map(([key, list], i) => ({
    key, label: monthLabel(key), count: list.length, rows: list,
    open: typeof opened[key] === 'boolean' ? opened[key] : narrowed || i === 0,
  }));
  return {pinned, months, total: kept.length};
}
// 고정·별표를 바꾼 metadata(다른 칸은 그대로). on이면 지금 시각, 아니면 칸을 뺀다.
export function withMark(metadata, key, on, now = new Date()) {
  if (!Object.values(MARK_KEYS).includes(key)) throw new Error('알 수 없는 표시');
  const next = {...(plain(metadata) ? metadata : {})};
  if (on) next[key] = now.toISOString(); else delete next[key];
  return next;
}
