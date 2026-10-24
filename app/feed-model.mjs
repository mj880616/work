// CALL-통화메뉴·TG-소식메뉴 4단계 (docs/design/call-telegram-feed.md 4.2·4.5·10절): the pure rules of the 통화 and 텔레그램 소식
// screens. No DOM, no network: reading the points' head marks, the transcript's speaker lines, the telegram raw copy's lines,
// day grouping, the head counts, the room's tone and initial. All text from these rows came from outside (Drive, the server AI),
// so the screens put it in as text only (escape) and never as HTML.

const KST = 'Asia/Seoul';
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

function kstParts(value) {
  const t = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(t)) return null;
  const p = new Intl.DateTimeFormat('en-US', {timeZone:KST, year:'numeric', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', hourCycle:'h23', weekday:'short'}).formatToParts(new Date(t));
  const get = k => p.find(x => x.type === k)?.value || '';
  return {year:Number(get('year')), month:Number(get('month')), day:Number(get('day')), hour:get('hour').padStart(2, '0'), minute:get('minute').padStart(2, '0')};
}
// Korea date key (YYYY-MM-DD) of a moment.
export function kstDay(value = Date.now()) {
  const p = kstParts(value);
  return p ? `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}` : '';
}
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
// "16:42" in Korea time.
export function hhmm(value) { const p = kstParts(value); return p ? `${p.hour}:${p.minute}` : ''; }
// "10. 23. (목)" for a day key (the row's day column is already the Korea date).
export function dayLabel(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!m) return '';
  const w = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return `${Number(m[2])}. ${Number(m[3])}. (${WEEK[w]})`;
}

// Newest first: by day, then the moment, then id (stable).
export function sortFeed(rows) {
  return [...(rows || [])].sort((a, b) => String(b.day || '').localeCompare(String(a.day || ''))
    || String(b.occurred_at || '').localeCompare(String(a.occurred_at || ''))
    || String(b.id || '').localeCompare(String(a.id || '')));
}
// [{day, label, items}] in the shown order; one group per day.
export function groupByDay(rows) {
  const out = [];
  for (const row of sortFeed(rows)) {
    const last = out.at(-1);
    if (last && last.day === row.day) last.items.push(row);
    else out.push({day:row.day, label:dayLabel(row.day), items:[row]});
  }
  return out;
}

// Points come from collector-feed (#1107 pointsOf): plain summary lines, and `[확정] …` (결정 후보), `[예정] …` (약속 후보),
// `[확인] …` (후속확인). The mark is shown as a small tag after the text; anything else stays as written.
export const POINT_TAGS = Object.freeze({'확정':'done', '예정':'plan', '확인':'check'});
export function readPoint(value) {
  const text = String(value ?? '').trim();
  const m = /^\[(확정|예정|확인)\]\s*(.*)$/s.exec(text);
  if (m && m[2].trim()) return {tag:m[1], kind:POINT_TAGS[m[1]], text:m[2].trim()};
  return {tag:'', kind:'', text};
}
export const readPoints = points => (Array.isArray(points) ? points : []).filter(p => typeof p === 'string' && p.trim()).map(readPoint);

// Transcript with speaker lines (speaker_split true, design 4.5절): every line is `머리: 글`; 나 is me, 화자1/화자2 or a
// counterpart label otherwise. A line that does not fit is kept as text under the previous speaker (no line is lost).
export function speakerLines(raw) {
  const out = [];
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const m = /^([^:：\s][^:：]{0,59}?)\s*[:：]\s+(.+)$/.exec(t);
    if (m) out.push({who:m[1].trim(), me:/^나$/.test(m[1].trim()), text:m[2].trim()});
    else if (out.length) out.at(-1).text += ' ' + t;
    else out.push({who:'', me:false, text:t});
  }
  return out;
}

// Telegram raw copy (collector-feed rawLines): `HH:MM A: 글` or `HH:MM A (전달): 글`, one message per line. A line that does not
// fit continues the previous message (a message's own line breaks).
export function telegramLines(raw) {
  const out = [];
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    const m = /^(\d{2}:\d{2}) ([A-Z]{1,3})( \(전달\))?: (.*)$/.exec(line);
    if (m) out.push({at:m[1], who:m[2], forwarded:!!m[3], text:m[4]});
    else if (out.length) out.at(-1).text += '\n' + line;
    else if (line.trim()) out.push({at:'', who:'', forwarded:false, text:line});
  }
  return out;
}

// app_feed_days rows → the head numbers. Calls: the filtered (personal + unsure) and failed counts of the last 7 days.
export function callFiltered(days, today = kstDay()) {
  const from = addDays(today, -6);
  let personal = 0, unsure = 0, failed = 0;
  for (const d of days || []) {
    if (d?.source !== 'call' || !(d.day >= from && d.day <= today)) continue;
    personal += Number(d.personal_count) || 0; unsure += Number(d.unsure_count) || 0; failed += Number(d.failed_count) || 0;
  }
  return {personal, unsure, failed, total:personal + unsure};
}
// Telegram: today's row only ("오늘 n개 중 중요한 m개 · 방 k곳"); null when today has no row yet.
export function telegramToday(days, today = kstDay()) {
  const d = (days || []).find(x => x?.source === 'telegram' && x.day === today);
  if (!d) return null;
  return {total:Number(d.total_count) || 0, kept:Number(d.kept_count) || 0, rooms:Number(d.room_count) || 0, failed:Number(d.failed_count) || 0};
}
export function telegramHeadText(today) {
  return today ? `오늘 ${today.total}개 중 중요한 ${today.kept}개 · 방 ${today.rooms}곳` : '오늘 받은 소식 없음';
}

// Rooms seen in the rows, newest first, one per room_key (for the room filter).
export function roomsOf(rows) {
  const seen = new Map();
  for (const r of sortFeed(rows)) if (r?.room_key && !seen.has(r.room_key)) seen.set(r.room_key, r.room_label || r.room_key);
  return [...seen].map(([key, label]) => ({key, label}));
}
// The same room always gets the same of the six toned colors (nothing is stored).
export function roomTone(key) {
  let h = 0;
  for (const c of String(key || '')) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return (h % 6) + 1;
}
// First letter or digit of the room name (symbols skipped), for the round mark.
export function roomInitial(label) {
  const m = /[\p{L}\p{N}]/u.exec(String(label || ''));
  return m ? m[0] : '·';
}
// Pinned first in the pin strip: newest pin first.
export const pinnedOf = rows => [...(rows || [])].filter(r => r?.pinned_at).sort((a, b) => String(b.pinned_at).localeCompare(String(a.pinned_at)));

// The 조직 연결 box's default summary (요약 부품 통일 ②, minimal): a call's core points as "- " lines (tags as words), or the
// telegram bubble's summary.
export function linkSummaryDefault(row) {
  if (!row) return '';
  if (row.source === 'telegram') return String(row.summary || '').trim();
  const pts = readPoints(row.points).map(p => `- ${p.text}${p.tag ? ` (${p.tag})` : ''}`);
  return (pts.length ? pts : [String(row.title || '').trim()].filter(Boolean)).join('\n');
}

// The table is not there yet (DB not applied) → "준비 중"; PostgREST answers 404 (PGRST205) or 42P01.
export function missingTable(error) {
  const s = Number(error?.status) || 0, text = String(error?.message || '') + ' ' + String(error?.code || '');
  return s === 404 || /PGRST205|42P01|does not exist|schema cache/i.test(text);
}
