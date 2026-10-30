// CAL-조직참고캘린더(요청함 10/30 16:03, 명진 결정 "별도 범용 기능 없이 그 캘린더 하나만, 그 조직 주간보고 때 참고해서 제안"): 순수 규칙.
// 내 프로필의 '조직 참고 캘린더'는 구독한 캘린더 하나 + 그 캘린더가 어느 담당조직 것인지(조직 id)만 고른다(app_profiles.ledger_calendar).
// 그 캘린더 일정은 저장하지 않는다. 업무일지 [주간 정리]에서 그 조직 칸을 쓸 때만, 그 주와 앞으로 2주 일정 가운데 주요 일정(아래 낱말)을
// '캘린더 추천' 줄로 보여 주고, 사람이 [+]를 눌러야 보고에 들어간다. 명진 일정·일정 화면·업무일지 하루 카드·원장·5. 주요 일정에는 넣지 않는다.
// (예전 원장 재료 C-4 '개인 공유 캘린더 참고 일정'의 색·내가 만든 일정 고르기, 업무 판단, 참고 일정 표 맞추기는 화면·경로를 걷어 냈다.
//  쌓인 app_calendar_work_refs 행은 지우지 않고 그대로 둔다.)
// 화면·네트워크 없음. 서버 읽기·쓰기는 calendar-ref-data.js.
import {seoulDateKey, seoulClock} from './meeting-time.js';

export const CALENDAR_ID_MAX = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const ORG_REF_WEEKS = 3;     // 그 주 + 앞으로 2주
export const ORG_REF_MAX = 30;      // 추천 줄 상한(한 번에 보이는 수)
export const TITLE_MAX = 80;

// 고르는 낱말. 띄어 쓴 꼴('조정 신청'·'본조 사업'·'조합원 총회')도 맞는다. 제목 전체의 띄어쓰기를 지우지는 않는다
// ('상집 회의'가 '집회'로 잡히지 않게). '상집회의'·'중집회의'처럼 붙여 쓴 회의도 '집회'로 보지 않는다.
// '결의대회'는 '간부결의대회'·'총력결의대회'를 함께 덮는다(요청 예시 '총력결의대회'가 추천되어야 해서 더 넓게 잡음).
export const ORG_REF_WORDS = Object.freeze(['집회', '농성', '선전전', '조정 신청', '본조 사업', '대의원회', '대의원대회', '결의대회', '조합원 총회', '투쟁']);
const WORD_RULES = Object.freeze([/(?<![상중])집회/, /농성/, /선전전/, /조정\s*신청/, /본조\s*사업/, /대의원\s*대?회/, /결의\s*대회/, /조합원\s*총회/, /투쟁/]);
// 빼는 낱말: 중집(중앙집행위원회)은 위 낱말이 같이 있어도 추천하지 않는다.
export const ORG_REF_SKIP = Object.freeze(['중집', '중앙집행위원회']);
const SKIP_RULES = Object.freeze([/중집/, /중앙\s*집행\s*위원회/]);

const compact = text => String(text ?? '').normalize('NFC').replace(/[\s·‧․.,()[\]{}<>「」『』'"“”‘’\-–_/]/g, '').toLowerCase();

// ---- 프로필 고르기 값 (app_profiles.ledger_calendar) ----
// 읽은 값 → 화면용 {calendar, org}. 모양이 틀린 칸은 버린다. 예전에 저장한 색·내가 만든 일정(colors·mine)은 읽지 않는다.
export function parseChoice(raw) {
  const out = {calendar: '', org: ''};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  if (typeof raw.calendar === 'string' && raw.calendar.length >= 1 && raw.calendar.length <= CALENDAR_ID_MAX && !/[\u0000-\u001f\u007f]/.test(raw.calendar)) out.calendar = raw.calendar;
  if (typeof raw.org === 'string' && UUID.test(raw.org)) out.org = raw.org;
  return out;
}
// 화면 값 → 저장할 값(DB CHECK 20261030210000: calendar 1~200자, org 소문자 uuid). 비운 칸은 키를 빼고, 둘 다 비면 빈 객체.
export function serializeChoice(choice) {
  const c = parseChoice({calendar: choice?.calendar, org: String(choice?.org ?? '').toLowerCase()});
  return {...(c.calendar ? {calendar: c.calendar} : {}), ...(c.org ? {org: c.org} : {})};
}
// 추천을 보일 수 있는가: 캘린더와 조직을 둘 다 골랐을 때만.
export const choiceReady = choice => !!(choice?.calendar && choice?.org);

// ---- 날짜 ----
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const WEEKDAY = '일월화수목금토';
// '11/4(수)'
export function slashDay(day) {
  const d = new Date(`${day}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAY[d.getUTCDay()]})`;
}
// 그 주(월요일)부터 3주: {first, end}(end 제외).
export const orgRefRange = weekStart => ({first: weekStart, end: addDays(weekStart, ORG_REF_WEEKS * 7)});
const eventDay = event => event.allDay ? String(event.start).slice(0, 10) : seoulDateKey(event.start);

// ---- 고르기 ----
export function cleanTitle(value) {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return [...text].slice(0, TITLE_MAX).join('').trim();
}
// 제목이 주요 일정인가: 빼는 낱말이 없고 고르는 낱말이 하나라도 있으면.
export function isOrgRefTitle(title) {
  const text = cleanTitle(String(title ?? '').normalize('NFC'));
  if (!text || SKIP_RULES.some(rule => rule.test(text))) return false;
  return WORD_RULES.some(rule => rule.test(text));
}
// 캘린더 일정 → 추천 줄 [{key, day, time, title, label}]. 고른 캘린더 것만(옛 Edge가 다른 캘린더 일정을 줘도 거름), 취소 빼고,
// 범위 안, 주요 일정만. 같은 날 같은 제목은 한 줄. 날짜·시각 순, ORG_REF_MAX개까지.
export function pickOrgRefs(events, choice, range) {
  const out = [], seen = new Set();
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || !choice?.calendar || (event.calendarId != null && event.calendarId !== choice.calendar)) continue;
    if (event.status === 'cancelled' || !event.start) continue;
    const title = cleanTitle(event.title);
    if (!isOrgRefTitle(title)) continue;
    const day = eventDay(event);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < range.first || day >= range.end) continue;
    const key = `${day}|${compact(title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const time = event.allDay ? '' : seoulClock(event.start);
    out.push({key, day, time, title, label: `${slashDay(day)} ${title}`});
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || (a.time || '').localeCompare(b.time || '') || a.title.localeCompare(b.title, 'ko')).slice(0, ORG_REF_MAX);
}
// 보고에 넣는 줄(조직 칸 줄 모양 '- …').
export const reportLine = item => `- ${item.label}`;
// 칸에 이미 같은 일정이 들어 있는가(띄어쓰기·문장부호 무시, 날짜 글과 제목이 함께 있으면 들어간 것으로 본다).
export function alreadyIn(lines, item) {
  const title = compact(item.title), day = compact(slashDay(item.day));
  return (Array.isArray(lines) ? lines : String(lines ?? '').split('\n')).some(line => { const k = compact(line); return k.includes(title) && k.includes(day); });
}
// AI 재료 한 줄(주간보고 초안·줄 제안의 그 칸 옆 기록): 캘린더 일정이라는 것을 글에 적는다.
export const materialLine = item => `(조직 캘린더 일정) ${item.label}`;
