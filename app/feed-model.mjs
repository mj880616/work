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
  const text = plainSpeakerMention(String(value ?? '')).trim();
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

// ---------- CALL-개인통화함 3단계 (docs/design/call-personal.md): 업무 통화함 · 개인 통화함 두 개의 함
// The personal table holds two kinds: 'personal' (개인 통화함 list) and 'unsure' (맨 위 "확인할 통화"). Nothing else decides the box.
export function splitPersonal(rows) {
  const personal = [], unsure = [];
  for (const r of rows || []) { if (r?.kind === 'unsure') unsure.push(r); else if (r?.kind === 'personal') personal.push(r); }
  return {personal, unsure};
}
// ---------- CALL-목록상세정리: 통화 한 줄·상세의 "내용(주제)"과 "상대 표" 규칙 (이 두 함수가 유일한 규칙 자리)
// 저장된 칸 구조를 그대로 쓴다: 제목(call_title = '조직 · 사람 직함 · 주제'), 상대(counterpart = '조직 이름 직함'), 연결 조직(organization_id).
// 화면은 제목에서 상대·조직을 떼고 주제만 보이고, 상대·조직은 오른쪽 작은 표 한 곳에만 한 번 보인다.
export const OWN_ORG = '공공운수노조';
const ORG_WORD = /(노동조합|노조|지부|지회|분회|본부|연맹|협의회|공사|공단)$/;
const squash = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const wordsOf = v => squash(v).split(' ').filter(w => [...w].length >= 2);
function commonPrefix(a, b) { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; }
// 조직 약칭: 다른 이름(aliases) 중 가장 짧은 것, 없거나 본 이름보다 길면 본 이름.
export function orgShort(org) {
  const name = squash(org?.name);
  const alias = (Array.isArray(org?.aliases) ? org.aliases : []).map(squash).filter(a => [...a].length >= 2).sort((a, b) => a.length - b.length)[0];
  return alias && alias.length < name.length ? alias : name;
}
// 오른쪽 상대 표: {org, person, text}. 공공운수노조(우리 쪽)는 조직 없이 이름·직함만, 조직을 모르면 이름만.
// 상대 글이 '연결 조직 이름 + 사람'이거나 첫 낱말이 조직 꼴(…노조·…지부·…공사 등)이면 그 앞부분이 조직이다. 개인 통화는 조직이 없다(organization 비움, orgText 불가).
export function callWho({organization = null, counterpart = '', personal = false, own = OWN_ORG} = {}) {
  const cp = squash(counterpart), full = squash(organization?.name);
  let person = cp, orgText = personal ? '' : full, cpOrg = '';
  if (!personal && cp) {
    if (full && cp.startsWith(full) && (cp.length === full.length || cp[full.length] === ' ')) { person = squash(cp.slice(full.length)); cpOrg = full; }
    else {
      const w = cp.split(' ');
      if (w.length >= 2 && ORG_WORD.test(w[0])) { person = squash(w.slice(1).join(' ')); cpOrg = w[0]; orgText = orgText || w[0]; }
    }
  }
  // 상대 글 앞의 조직(cpOrg)이 있으면 그것이 상대의 조직이다. 연결 조직과 같은 곳이면 연결 조직의 약칭을, 다른 곳이면 상대 글의 조직을 그대로 쓴다.
  const who = cpOrg || orgText, ownSide = !!own && !!who && who.startsWith(own);
  const related = !!organization && !!cpOrg && (cpOrg === full || commonPrefix(cpOrg, full) >= 4);
  const org = personal || ownSide ? '' : cpOrg ? (related ? orgShort(organization) : cpOrg) : (organization ? orgShort(organization) : '');
  return {org, person, text:[org, person].filter(Boolean).join(' · ')};
}
// 제목에서 주제만: '조직 · 사람 직함 · 주제'(조각 셋 이상)는 앞 둘을 떼고, '○○ · 주제'(둘)는 앞 조각이 그 줄의 조직·상대와 같은 말일 때만 뗀다.
// 그 밖(조각 하나, 앞 조각이 상대와 무관, 주제가 빔)은 제목 그대로. 화면에서 글자를 깎지 않고 이 규칙으로만 가른다.
export function callTopic(title, {organization = null, counterpart = ''} = {}) {
  const t = squash(title);
  const parts = t.split(/\s+·\s+/).map(p => p.trim()).filter(Boolean);
  if (parts.length >= 3) return parts.slice(2).join(' · ') || t;
  if (parts.length === 2) {
    const known = [...wordsOf(organization?.name), ...(organization?.aliases || []).flatMap(wordsOf), ...wordsOf(counterpart)];
    const same = wordsOf(parts[0]).some(w => known.some(k => k.includes(w) || w.includes(k) || commonPrefix(k, w) >= 4));
    return same ? parts[1] : t;
  }
  return t;
}
// 요약 글 안의 '상대방(화자0)'처럼 이름표 없이 남은 화자 번호 꼬리표는 번호를 떼고 '상대방'만 보인다(이름표가 있는 새 통화는 서버가 저장 전에 이름으로 바꾼다).
export const plainSpeakerMention = text => String(text ?? '').replace(/(상대방?)\s*[(（]\s*화자\s?\d{1,2}\s*[)）]/g, '$1');

// One line inside the 개인 통화함: calls counted before the list existed have only a number (app_feed_days), no row. '' when none.
export function legacyFilteredNote(days, today = kstDay()) {
  const f = callFiltered(days, today);
  if (!f.total && !f.failed) return '';
  const parts = [];
  if (f.total) parts.push(`목록 도입 전 걸러진 ${f.total}건은 개수만 있어요. 원본은 Drive 통화 녹음·전사 폴더에 있어요.`);
  if (f.failed) parts.push(`판정 실패 ${f.failed}건`);
  return parts.join(' ');
}
// 업무→개인으로 옮기기 전 확인 문구. ledger: true (원장에 이미 쓰임) / false / null (확인 못 함). linked: 고정·조직 연결이 있음.
// '' when nothing needs saying (the move goes ahead without asking).
export function moveToPersonalWarning({ledger = false, linked = false} = {}) {
  const parts = [];
  if (ledger === true) parts.push('이 통화는 이미 원장에 기록된 내용이 있어요. 개인으로 옮겨도 원장 기록은 지워지지 않아요. 필요하면 원장 수정 요청에서 따로 고치세요.');
  else if (ledger === null) parts.push('원장에 이미 기록됐는지 확인하지 못했어요. 기록됐다면 개인으로 옮겨도 원장 기록은 지워지지 않아요.');
  if (linked) parts.push('고정과 조직 연결은 개인 통화함에 없어서 사라지고, 이미 조직 기록에 더한 요약은 남아요.');
  return parts.join(' ');
}
export const MOVE_ERRORS = Object.freeze({
  GONE:'이 통화가 그사이 사라졌어요. 목록을 다시 불러왔어요.',
  DUPLICATE:'같은 통화가 반대 통화함에 이미 있어요. 목록을 다시 불러왔어요.',
  UNAVAILABLE:'옮기기 기능이 아직 준비되지 않았어요. 아무것도 바뀌지 않았어요.',
  REFUSED:'옮기지 못했어요. 아무것도 바뀌지 않았어요.',
  UNKNOWN:'옮겼는지 확인하지 못했어요. 목록을 다시 불러왔어요.',
});
export const moveErrorText = code => MOVE_ERRORS[code] || MOVE_ERRORS.REFUSED;
// CALL-개인통화함 4단계: 업무로 옮긴 직후 AI가 제목·조직·상대·직함을 다시 채운다(docs/design/call-personal.md 7절). 못 채워도 옛 값이 그대로 남는다.
export const REFILL_PENDING = '업무 통화로 옮겼어요. 제목·조직·상대를 채우는 중이에요.';
export const REFILL_DONE = '업무 통화로 옮겼어요. 제목·조직·상대를 채웠어요. 내용을 확인해 주세요.';
export const REFILL_SKIPPED = '업무 통화로 옮겼어요. 채울 글이 없어 옛 값 그대로예요.';
const REFILL_FAILED = Object.freeze({
  daily_limit:'업무 통화로 옮겼어요. 오늘 AI 횟수를 다 써서 제목·조직·상대는 옛 값 그대로예요.',
  monthly_limit:'업무 통화로 옮겼어요. 이번 달 AI 한도에 닿아 제목·조직·상대는 옛 값 그대로예요.',
});
export const refillFailedText = code => REFILL_FAILED[code] || '업무 통화로 옮겼어요. 제목·조직·상대를 채우지 못해 옛 값 그대로예요.';
// 옮긴 뒤 한 줄. from: 'work' | 'personal' | 'unsure'.
export function moveDoneText(from, to) {
  if (to === 'personal') return from === 'unsure' ? '개인 통화로 정했어요.' : '개인 통화함으로 옮겼어요.';
  return from === 'unsure' ? '업무 통화로 정했어요.' : '업무 통화로 옮겼어요.';
}
