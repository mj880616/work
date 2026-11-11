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

// ---- PR-C 화면 연결: 서버(ai-assist home_day_picks)에 보낼 것·받은 것 ----
// ③ 일기를 쓴 제안(서버 표 suggests_done)은 그리지 않는다.
export function openSuggests(list, done) {
  const used = new Set(Array.isArray(done) ? done.map(String) : []);
  return cleanSuggests(list).filter(item => !used.has(item.id));
}
// 서버는 제어 문자·글자 방향 문자가 든 제목을 받지 않는다(요청 전체 400) — 보내기 전에 빈칸으로 바꾸고 120자로 자른다.
const BAD_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2028\u2029\u2060-\u2069]/g;
export const sendTitle = v => [...String(v ?? '').replace(BAD_CHARS, ' ').replace(/\s+/g, ' ').trim()].slice(0, 120).join('');
export const SEND_EVENTS_MAX = 40;
export const SEND_DONE_MAX = 30;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const shift = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
// 그 날이 든 주(월요일 시작).
export const weekStartOf = day => shift(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
const seoulIso = ms => new Date(ms + 9 * 3600 * 1000).toISOString();
// 구글 캘린더 일정(이 화면이 이미 읽은 그 주 일정) → 서버 모양 {day, start, end, title}(한국 시각, 종일은 start·end 빈 값).
// 그 날이 든 주 밖은 뺀다(서버가 요청 전체를 거절하지 않게). 여러 날 종일 일정은 이 주에 걸친 첫날로. 끝이 다음 날이면 23:59.
export function sendEvents(events, day) {
  if (!DAY_RE.test(day || '')) return [];
  const from = weekStartOf(day), to = shift(from, 6), out = [];
  for (const e of Array.isArray(events) ? events : []) {
    const title = sendTitle(e?.title);
    if (!title || e?.status === 'cancelled') continue;
    const start = String(e?.start || ''), end = String(e?.end || '');
    let item = null;
    if (e?.allDay || DAY_RE.test(start)) {
      const first = start.slice(0, 10), last = DAY_RE.test(end.slice(0, 10)) ? shift(end.slice(0, 10), -1) : first;
      if (!DAY_RE.test(first) || last < from || first > to) continue;
      item = {day:first < from ? from : first, start:'', end:'', title};
    } else {
      const s = Date.parse(start);
      if (!Number.isFinite(s)) continue;
      const si = seoulIso(s), d = si.slice(0, 10), ems = Date.parse(end);
      if (d < from || d > to) continue;
      const ei = Number.isFinite(ems) && ems > s ? seoulIso(ems) : '';
      item = {day:d, start:si.slice(11, 16), end:ei ? (ei.slice(0, 10) === d ? ei.slice(11, 16) : '23:59') : '', title};
    }
    out.push(item);
    if (out.length >= SEND_EVENTS_MAX) break;
  }
  return out;
}
// 그 날(한국 날짜) 끝낸 할 일 제목.
export function sendDone(tasks, day) {
  const out = [];
  for (const t of Array.isArray(tasks) ? tasks : []) {
    const ms = Date.parse(t?.completed || '');
    if (t?.status !== 'completed' || !Number.isFinite(ms) || seoulIso(ms).slice(0, 10) !== day) continue;
    const title = sendTitle(t?.title);
    if (title) out.push(title);
    if (out.length >= SEND_DONE_MAX) break;
  }
  return out;
}
// AI 한도에 닿았을 때 칸 위 한 줄(기존 한도 알림 문구와 같음). 그 밖의 실패는 조용히(고른 것이 있으면 그대로 보임).
export const LIMIT_NOTE = Object.freeze({monthly_limit:'이번 달 AI 한도에 닿았어요.', daily_limit:'오늘 AI 횟수를 다 썼어요.'});
export const limitNote = code => LIMIT_NOTE[code] || '';
// ---- HOME-읽을글밀기(2026-11-11 명진 요청): 숨기거나 보관한 글은 홈 '읽을 만한 글'에서 뺀다 ----
// 읽을 글의 id는 뉴스 기사(app_news_items) id다. 처리 표시는 홈에 따로 두지 않고 News와 같은 뉴스 줄의 표시를 그대로 본다:
// 숨김 = hidden_at, 보관 = starred_at(뉴스에서 보관은 별표). 그래서 News에서 숨기거나 보관해도 홈에서 빠지고, 다른 기기에서도 같다.
export const READS_DONE_NOTE = '다 읽었어요';
const NEWS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// 뉴스 기사 id 모양(UUID)이면 소문자로, 아니면 ''. 이 값만 서버에 묻고·누르면 처리한다.
export const newsIdOf = v => { const id = String(v ?? '').trim().toLowerCase(); return NEWS_ID.test(id) ? id : ''; };
// 뉴스 표 줄들 → 처리한(숨김 또는 보관) 글 id 모음. 표에 줄이 없는 글은 처리한 글이 아니다(그대로 보인다).
export function handledNewsIds(rows) {
  const out = new Set();
  for (const r of Array.isArray(rows) ? rows : []) {
    const id = newsIdOf(r?.id);
    if (id && (r?.hidden_at || r?.starred_at)) out.add(id);
  }
  return out;
}
export const visibleReads = (list, handled) => (Array.isArray(list) ? list : []).filter(item => !handled?.has?.(newsIdOf(item?.id)));

// 서버 표 한 줄 → 칸 상태({reads:{items, picked_at}, suggests:{items, done}}). 모양이 틀린 칸은 빈 값.
export function picksState(row) {
  const r = row && typeof row === 'object' ? row : {};
  const at = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null;
  return {reads:{items:Array.isArray(r.reads) ? r.reads : [], picked_at:at(r.reads_at)},
    suggests:{items:Array.isArray(r.suggests) ? r.suggests : [], done:Array.isArray(r.suggests_done) ? r.suggests_done : []}};
}
