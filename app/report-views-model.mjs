// ACT-사진 6단계: 사업 보고 화면의 [목록 | 달력 | 사진] 보기의 순수 규칙(DOM·네트워크 없음, 단위 시험 대상).
// 사업 보고(app_meetings)와 그 첨부 사진(app_documents.meeting_id, 원본은 Drive 한 곳)을 읽기만 한다. 달력은 사업 보고 화면 안에서만 쓰고
// 일정 탭 달력과 섞지 않는다(명진 결정). 고른 보기는 서버(view-prefs.js의 report_view 칸)에 기억한다 — 일정 탭의 calendar_view와는 뜻이 달라 다른 칸이다.
import {seoulDateKey} from './meeting-time.js';
import {isLibraryPhoto} from './library-photo.js';

// 값은 view-prefs.js REPORT_VIEWS(= DB 검사 app_profiles_view_prefs_check의 report_view)와 같다. 시험이 둘이 같은지 본다.
export const REPORT_VIEW_OPTIONS = Object.freeze([
  {value: 'list', label: '목록'},
  {value: 'calendar', label: '달력'},
  {value: 'photo', label: '사진'}
].map(Object.freeze));
export const DEFAULT_REPORT_VIEW = 'list';
export const isReportView = value => REPORT_VIEW_OPTIONS.some(o => o.value === value);
export const reportViewOf = value => (isReportView(value) ? value : DEFAULT_REPORT_VIEW);

const pad = n => String(n).padStart(2, '0');
export const WEEKDAYS = Object.freeze(['일', '월', '화', '수', '목', '금', '토']);

// 달력 칸 하나에 보일 제목 수. 나머지는 '+n'. (폰은 제목 대신 점으로 보이고 고른 날의 목록이 아래에 나온다.)
export const CELL_TITLES = 2;
// 사진 줄 하나에 보일 작은 그림 수(명진 결정: 3장 + '외 n장').
export const PHOTO_STRIP = 3;

// 일시(meeting_at) → 서울 날짜 키 'YYYY-MM-DD'. 읽을 수 없으면 빈 글.
export function dayKeyOf(meeting) {
  const at = meeting?.meeting_at;
  if (!at) return '';
  const time = new Date(at).getTime();
  return Number.isNaN(time) ? '' : seoulDateKey(new Date(time));
}
const timeOf = meeting => { const t = new Date(meeting?.meeting_at || '').getTime(); return Number.isNaN(t) ? 0 : t; };

// 달: {year, month(0부터)}. 앞뒤로 옮기기(넘치면 해를 넘김).
export function shiftMonth({year, month}, delta) {
  const d = new Date(Date.UTC(year, month + delta, 1));
  return {year: d.getUTCFullYear(), month: d.getUTCMonth()};
}
export const monthKeyOf = ({year, month}) => `${year}-${pad(month + 1)}`;
export const monthOfDay = key => (/^\d{4}-\d{2}-\d{2}$/.test(String(key || '')) ? {year: +key.slice(0, 4), month: +key.slice(5, 7) - 1} : null);
export const monthTitle = ({year, month}) => `${year}년 ${month + 1}월`;

// 일요일부터 시작하는 주 목록(일정 탭 달력과 같은 순서). 칸마다 {key, day, inMonth}.
export function monthWeeks({year, month}) {
  const lead = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const total = Math.ceil((lead + days) / 7) * 7, weeks = [];
  for (let i = 0; i < total; i += 7) {
    weeks.push(Array.from({length: 7}, (_, j) => {
      const d = new Date(Date.UTC(year, month, 1 - lead + i + j));
      return {key: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, day: d.getUTCDate(), inMonth: d.getUTCMonth() === month};
    }));
  }
  return weeks;
}

// 사업 보고들 → Map(날짜 키 → 그날의 사업 보고, 일시 이른 순). 일시를 읽을 수 없는 건은 달력에 놓지 않는다.
export function reportsByDay(rows) {
  const map = new Map();
  for (const m of Array.isArray(rows) ? rows : []) {
    const key = dayKeyOf(m);
    if (!key) continue;
    const list = map.get(key) || [];
    list.push(m);
    map.set(key, list);
  }
  for (const list of map.values()) list.sort((a, b) => timeOf(a) - timeOf(b));
  return map;
}
// 달력 칸에 보일 것: 앞 CELL_TITLES개 + 나머지 수.
export function cellPlan(list, limit = CELL_TITLES) {
  const all = Array.isArray(list) ? list : [];
  return {shown: all.slice(0, limit), more: Math.max(0, all.length - limit), total: all.length};
}
// 달력 아래에 목록으로 보일 날: 고른 날이 이 달이면 그날, 아니면 오늘(이 달이면), 아니면 이 달에서 사업 보고가 있는 가장 늦은 날. 없으면 ''.
export function pickDay(byDay, month, selected, todayKey) {
  const prefix = monthKeyOf(month) + '-';
  if (selected && selected.startsWith(prefix)) return selected;
  if (todayKey && todayKey.startsWith(prefix)) return todayKey;
  const days = [...byDay.keys()].filter(k => k.startsWith(prefix)).sort();
  return days.at(-1) || '';
}

// 사업 보고 번호 → 그림 자료 목록(올린 순서). 그림 판단은 자료실과 같은 isLibraryPhoto 하나다.
export function photosByMeeting(docs) {
  const map = new Map();
  (Array.isArray(docs) ? docs : []).map((d, i) => ({d, i})).filter(({d}) => d?.meeting_id && isLibraryPhoto(d))
    .sort((a, b) => String(a.d.created_at || '').localeCompare(String(b.d.created_at || '')) || a.i - b.i)
    .forEach(({d}) => { const list = map.get(d.meeting_id) || []; list.push(d); map.set(d.meeting_id, list); });
  return map;
}
// [사진] 보기: 날짜 묶음(최근 위) → 그날의 사진 있는 사업 보고(일시 늦은 순). 사진 없는 사업 보고는 나오지 않는다. 일시를 읽을 수 없는 건은 맨 아래 묶음('').
export function photoGroups(rows, photos) {
  const items = (Array.isArray(rows) ? rows : []).map(meeting => ({meeting, photos: photos?.get?.(meeting.id) || [], day: dayKeyOf(meeting)})).filter(x => x.photos.length);
  items.sort((a, b) => timeOf(b.meeting) - timeOf(a.meeting));
  const groups = [];
  for (const item of items) {
    let group = groups.find(g => g.day === item.day);
    if (!group) { group = {day: item.day, items: []}; groups.push(group); }
    group.items.push(item);
  }
  groups.sort((a, b) => (a.day === '' ? 1 : b.day === '' ? -1 : b.day.localeCompare(a.day)));
  return groups;
}

// '10월 24일 (금)'
export function dayHeading(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key || ''))) return '날짜 없음';
  const weekday = new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10))).getUTCDay();
  return `${+key.slice(5, 7)}월 ${+key.slice(8, 10)}일 (${WEEKDAYS[weekday]})`;
}
