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
  if (row?.done_only) return {title: '', line: doneLine(row.done_lines)};
  const all = lines(row?.raw_text);
  if (all.length >= 2) return {title: all[0], line: all[1]};
  if (all.length === 1) return {title: '', line: all[0]};
  return {title: '', line: photoCount ? `사진 ${photoCount}장` : ''};
}
// JOURNAL-오늘한일달력 (S50-29): 일기를 안 쓴 날도 그날 '오늘 한 일'이 있으면 목록에 나온다(홈에서 넣은 줄을 읽기만, 두 벌 저장 없음).
// 그런 날은 일기 행이 아닌 '한 일만 있는 날' 줄(done_only)이다: 📌·★ 없음(일기 한 편 단위 표시라서), 누르면 그날 창(일기 없음 + 그날 한 일).
export const doneLine = lines => { const all = Array.isArray(lines) ? lines.filter(Boolean) : []; return all.length ? `한 일 · ${all[0]}${all.length > 1 ? ` 외 ${all.length - 1}` : ''}` : ''; };
export function withDoneDays(rows, done) {
  const list = Array.isArray(rows) ? rows : [];
  if (!(done instanceof Map) || !done.size) return list;
  const have = new Set(list.map(row => row?.journal_day));
  const extra = [...done].filter(([day, lines]) => dayRe.test(String(day)) && !have.has(day) && Array.isArray(lines) && lines.length)
    .map(([day, lines]) => ({journal_day: day, raw_text: '', done_only: true, done_lines: [...lines]}));
  return extra.length ? [...list, ...extra] : list;
}
// 찾기: 공백으로 나눈 낱말이 모두 글(또는 날짜 표시)에 들어 있으면 맞다. 대소문자 구분 없음.
export const queryWords = query => String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
export function matches(row, words) {
  if (!words.length) return true;
  const hay = `${String(row?.raw_text ?? '')}\n${row?.done_only ? (row.done_lines || []).join('\n') + '\n' : ''}${dayLabel(row?.journal_day)}\n${row?.journal_day || ''}`.toLowerCase();
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

// DIARY-넣은사진표시·DIARY-넣은사진원본: 그날 사진 모음(diary.js dayItems)의 한 칸이 '그날 일기에 들어간 사진'인가. 판정은 이 함수 하나다.
// 일기에 들어간 사진 = 일기 행(app_notes attachments)에 든 이미지 첨부(drive_file_id). 직접 올린 칸(source 'upload', key = drive_file_id)은 그 첨부와 바로 맞춘다.
// 사진 화면 [일기에 넣기]로 들어온 원드라이브·폰 사진은 줄인 사본이 올라가므로, 넣을 때 원본 식별값을 행의 metadata.photo_origins
// ({<drive_file_id>: 'onedrive:<항목 id>' | 'phone:ms:<번호>'}, 기존 metadata 칸 — DB 변경 없음)에 함께 적어 두고, 원본 칸은 그것으로 맞춘다.
// 원본 식별값이 없는 옛 일기의 원드라이브·폰 칸은 표시하지 않는다(크기·이름 추측 없음). 사본 첨부가 일기에서 빠졌으면 같이 사라진다.
export const ORIGIN_SOURCES = Object.freeze(['onedrive', 'phone']);
export const originKey = (source, key) => (ORIGIN_SOURCES.includes(source) && typeof key === 'string' && key && key.length <= 300 ? `${source}:${key}` : '');
const images = row => (Array.isArray(row?.attachments) ? row.attachments : []).filter(file => file?.drive_file_id && /^image\//.test(file?.mime_type || ''));
// 일기 행에 남은 사진(이미지 첨부)의 원본 식별값만, {drive_file_id: 식별값}으로.
export function photoOrigins(row) {
  const raw = row?.metadata?.photo_origins;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const file of images(row)) {
    const value = raw[file.drive_file_id];
    if (typeof value === 'string' && ORIGIN_SOURCES.some(source => value.startsWith(`${source}:`) && value.length > source.length + 1)) out[file.drive_file_id] = value;
  }
  return out;
}
// 원본 식별값 묶음에 새로 더한 것({drive_file_id: 식별값})을 합친다(다른 사진 것은 그대로, 모양이 틀린 값은 버림).
export function withOrigins(metadata, added) {
  const next = {...(metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {})};
  const have = next.photo_origins && typeof next.photo_origins === 'object' && !Array.isArray(next.photo_origins) ? {...next.photo_origins} : {};
  for (const [id, value] of Object.entries(added || {})) if (id && typeof value === 'string' && originKey(value.split(':', 1)[0], value.slice(value.indexOf(':') + 1))) have[id] = value;
  if (Object.keys(have).length) next.photo_origins = have; else delete next.photo_origins;
  return next;
}
export function inDiaryPhoto(item, row) {
  if (!item || typeof item.key !== 'string' || !item.key) return false;
  if (item.source === 'upload') return images(row).some(file => file.drive_file_id === item.key);
  const want = originKey(item.source, item.key);
  return !!want && Object.values(photoOrigins(row)).includes(want);
}
