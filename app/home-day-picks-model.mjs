// HOME-하루채우기 ②·③(2026-11-09 명진 시안 ④ 승인): '읽을 만한 글'·'이런 기록은 어때요?' 칸이 받는 모양과 거르기.
// 고르기·한 줄 쓰기는 서버(ai-assist, 사용자 로그인)가 하고 결과도 서버에 둔다. 이 파일은 받은 값을 화면에 그려도 되는 모양으로만 거른다.
//   읽을 글:  {id, title, what, why, source, at, url}  최대 READS_MAX개, 처음 READS_OPEN개만 펼침
//   기록 제안: {id, text, basis}                      최대 SUGGEST_MAX개, 오후 SUGGEST_FROM_HOUR시부터 오늘만
export const READS_MAX = 3;
export const READS_OPEN = 2;
export const SUGGEST_MAX = 2;
export const SUGGEST_FROM_HOUR = 18;
const TEXT_MAX = 200;

const line = v => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX);
// 원문 주소는 https만(javascript: 등은 버린다).
export function safeUrl(v) {
  try { const u = new URL(String(v || '')); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; }
}

export function cleanReads(list) {
  const out = [], seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const item = {id:line(raw?.id), title:line(raw?.title), what:line(raw?.what), why:line(raw?.why), source:line(raw?.source), at:String(raw?.at || ''), url:safeUrl(raw?.url)};
    if (!item.id || !item.title || !item.what || !item.why || seen.has(item.id)) continue;
    seen.add(item.id); out.push(item);
    if (out.length >= READS_MAX) break;
  }
  return out;
}

export function cleanSuggests(list) {
  const out = [], seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const item = {id:line(raw?.id), text:line(raw?.text), basis:line(raw?.basis)};
    if (!item.id || !item.text || seen.has(item.id)) continue;
    seen.add(item.id); out.push(item);
    if (out.length >= SUGGEST_MAX) break;
  }
  return out;
}

// 기록 제안은 오늘·오후 6시 뒤에만 보인다.
export const suggestTime = ({day, today, hour}) => day === today && Number(hour) >= SUGGEST_FROM_HOUR;

// 글 시각: 오늘이면 '08:10', 어제면 '어제', 그 앞이면 '11.7'. 못 읽으면 ''.
export function readAtLabel(at, today) {
  const ms = Date.parse(at || '');
  if (!Number.isFinite(ms) || !/^\d{4}-\d{2}-\d{2}$/.test(today || '')) return '';
  const seoul = new Date(ms + 9 * 3600 * 1000).toISOString(), day = seoul.slice(0, 10);
  if (day === today) return seoul.slice(11, 16);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  if (day === yesterday) return '어제';
  return `${Number(day.slice(5, 7))}.${Number(day.slice(8, 10))}`;
}

// 머리 줄 '오늘 아침 선택'·'오늘 저녁 선택'(ui-words.md: 고르기 → 선택)(고른 때가 오늘일 때만, 오후 2시 앞이면 아침).
export function pickedNote(pickedAt, today) {
  const label = readAtLabel(pickedAt, today);
  return /^\d{2}:\d{2}$/.test(label) ? `오늘 ${Number(label.slice(0, 2)) < 14 ? '아침' : '저녁'} 선택` : '';
}
