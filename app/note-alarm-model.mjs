// S69-97 노트 알림(NOTE-에버노트 ②, 설계 docs/design/note-evernote.md 3절): 화면 없는 계산(시각은 서울 기준).
// 저장 모양: 노트 metadata.alarm = {at: ISO UTC 'YYYY-MM-DDTHH:MM:00.000Z'} 하나(새 칸·DB 변경 없음). 서버(phone-push 15분 예약)가 그 시각이 지나면
// 폰으로 '노트 다시 보기'를 한 번 보낸다(supabase/functions/phone-push/note-alarm.ts). 끄면 칸을 지운다. 지난 알림은 화면에 '지난 알림'으로 보인다.
const KST = 9 * 3600000, DAY = 86400000;
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

const kstParts = ms => { const d = new Date(ms + KST); return {y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), dow: d.getUTCDay(), h: d.getUTCHours(), min: d.getUTCMinutes()}; };
const pad = n => String(n).padStart(2, '0');
// 서울 날짜·시각 → ISO(UTC).
export function kstIso(day, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day)) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time))) return null;
  const ms = Date.parse(`${day}T${time}:00.000Z`) - KST;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
export const kstDay = ms => { const p = kstParts(ms); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; };
export const kstTime = ms => { const p = kstParts(ms); return `${pad(p.h)}:${pad(p.min)}`; };
const dayAfter = (ms, n) => kstDay(ms + n * DAY);

export function noteAlarmAt(note) {
  const a = note?.metadata?.alarm;
  const at = a && typeof a === 'object' && !Array.isArray(a) ? a.at : null;
  return typeof at === 'string' && Number.isFinite(Date.parse(at)) ? new Date(Date.parse(at)).toISOString() : null;
}
// '11/27(금) 09:00' — 올해가 아니면 앞에 연도.
export function alarmLabel(iso, now = Date.now()) {
  const ms = Date.parse(iso); if (!Number.isFinite(ms)) return '';
  const p = kstParts(ms), y = kstParts(now).y;
  return `${p.y !== y ? p.y + '/' : ''}${p.m}/${p.d}(${DAYS[p.dow]}) ${pad(p.h)}:${pad(p.min)}`;
}
export const alarmPast = (iso, now = Date.now()) => Date.parse(iso) <= now;

// 빠른 고르기: 오늘 저녁 6시(아직 전이면) · 내일 아침 9시 · 금요일 9시(이번 주, 지났으면 다음 주) · 다음 주 월요일 9시. 겹치는 시각은 하나만.
export function quickAlarms(now = Date.now()) {
  const p = kstParts(now), out = [], seen = new Set();
  const add = (key, label, day, time) => { const at = kstIso(day, time); if (!at || Date.parse(at) <= now + 60000 || seen.has(at)) return; seen.add(at); out.push({key, label, at}); };
  add('tonight', '오늘 저녁 6시', kstDay(now), '18:00');
  add('tomorrow', '내일 아침 9시', dayAfter(now, 1), '09:00');
  const toFri = (5 - p.dow + 7) % 7;
  add('friday', '금요일 9시', dayAfter(now, toFri === 0 && p.h >= 9 ? 7 : toFri), '09:00');
  const toMon = ((1 - p.dow + 7) % 7) || 7;
  add('monday', '다음 주 월요일 9시', dayAfter(now, toMon), '09:00');
  return out;
}
// 고른 날짜·시각 검사: 지금보다 뒤, 1년 안.
export function checkAlarm(at, now = Date.now()) {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return '날짜와 시각을 확인해 주세요.';
  if (ms <= now + 60000) return '지금보다 뒤의 시각을 선택해 주세요.';
  if (ms > now + 366 * DAY) return '1년 안의 시각만 선택할 수 있어요.';
  return '';
}
