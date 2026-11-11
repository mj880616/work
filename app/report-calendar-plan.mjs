// S58-10 BIZ-보고할일정 PR C(설계 docs/design/biz-report-plan-link.md 4절, 시안 docs/design/mockups/biz-report-plan-link.html ③):
// 사업 보고 달력에 '보고할 일정'을 놓는 순수 규칙(DOM·네트워크 없음, 단위 시험 대상).
// 일정 하나의 표시 판정(보고 씀·보고할 일정·보고할까요?)은 report-plan-model.mjs 한 곳이 하고, 여기는 그 결과를 달력 칸·그날 목록·'안 쓴 보고' 줄 모양으로 놓기만 한다.
//   ● 쓴 보고         = 사업 보고 줄 그대로(이 화면이 이미 그리는 색 점).
//   □ 보고할 일정      = 켜 둔 줄(state=on)인데 이어진 보고가 아직 없음. 줄의 제목·날짜 사본으로 그리므로 Google을 부르지 않아도 보인다(지난달도).
//                        같은 이름 기억으로 저절로 켜진 일정(줄이 아직 없음)도 □이고, 화면이 처음 볼 때 줄을 넣는다(auto).
//   점선 □ 보고할까요? = 줄도 기억도 없고 담당조직이 연결된 일정. 이 달의 Google 일정을 읽었을 때만 나온다.
// 칸 칩·사업영역 칩은 보고에만 걸린다(일정은 아직 칸·사업영역이 없다). 회의명 거르기만 같은 이름 열쇠로 건다(matchesName).
import {seoulClock} from './meeting-time.js';
import {PLAN_ICON} from './calendar-row-menu.mjs'; // S59-20: 일정 메뉴와 같은 깃발 아이콘 하나(예전에는 네모 선이 두 곳에 따로 있었다)
import {eventStatus, planDecision, reportsOfEvent, eventCopy, nameKey, PLAN_ON, STATUS_TODO, STATUS_ASK} from './report-plan-model.mjs';

export const ENTRY_REPORT = 'report', ENTRY_PLAN = 'plan';
// 달력 칸의 점 수(폰 칸 — 지금 화면과 같은 3개).
export const CELL_DOTS = 3;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const pad = n => String(n).padStart(2, '0');
const stampOf = value => { const t = Date.parse(value ?? ''); return Number.isFinite(t) ? t : 0; };
const isoOf = value => { const t = Date.parse(value ?? ''); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

// 줄 → 항목. 날짜를 읽을 수 없는 줄은 달력에 놓지 않는다(null).
function itemOfRow(row) {
  const day = String(row?.event_day ?? '').slice(0, 10), eventId = String(row?.google_event_id ?? '');
  if (!eventId || !DAY.test(day)) return null;
  return {eventId, calendarId: String(row.google_calendar_id || 'primary'), status: STATUS_TODO, day, title: String(row.title ?? ''), startsAt: isoOf(row.starts_at), rowId: String(row.id ?? ''), auto: false};
}
// Google 일정 → 항목. 표에 넣을 수 없는 모양(id·날짜)이면 null — 그런 일정은 표시하지 않는다(일정 달력과 같은 규칙).
function itemOfEvent(event, status, rowId = '', auto = false) {
  const copy = eventCopy(event);
  return copy ? {eventId: copy.google_event_id, calendarId: copy.google_calendar_id, status, day: copy.event_day, title: copy.title, startsAt: copy.starts_at, rowId, auto} : null;
}

// 달력에 놓을 '보고할 일정' 항목. data = {plans, reports(일정에 이어진 보고)}, events = 읽어 둔 Google 일정(없으면 줄만으로 그린다).
// 항목 = {eventId, calendarId, status:'todo'|'ask', day, title, startsAt(ISO|null=종일), rowId(줄이 있으면), auto(저절로 켜짐 — 줄을 아직 안 넣음)}
// 같은 일정은 한 번만 나온다. 읽어 둔 일정이 있으면 제목·날짜는 일정 쪽이 먼저다(줄 사본은 뒤에서 맞춘다 — 설계 4-5).
export function planItems(data, events = []) {
  const plans = Array.isArray(data?.plans) ? data.plans : [], reports = Array.isArray(data?.reports) ? data.reports : [];
  const byId = new Map();
  for (const e of Array.isArray(events) ? events : []) { const id = String(e?.id ?? ''); if (id && !byId.has(id)) byId.set(id, e); }
  const items = new Map();
  for (const row of plans) {
    const id = String(row?.google_event_id ?? '');
    if (!id || items.has(id) || row.state !== PLAN_ON || reportsOfEvent(id, reports).length) continue;
    const item = (byId.has(id) && itemOfEvent(byId.get(id), STATUS_TODO, String(row.id ?? ''))) || itemOfRow(row);
    if (item) items.set(id, item);
  }
  for (const [id, event] of byId) {
    if (items.has(id)) continue;
    const status = eventStatus(event, {plans, reports});
    if (status !== STATUS_TODO && status !== STATUS_ASK) continue;
    // 여기까지 온 todo는 줄이 없는 일정이다(줄이 on이면 위에서 놓였다) — 같은 이름 기억으로 저절로 켜진 것.
    const item = itemOfEvent(event, status, '', status === STATUS_TODO && !planDecision(event, {plans, reports}).row);
    if (item) items.set(id, item);
  }
  return sortItems([...items.values()]);
}
// 하루 안의 순서: 종일(시각 없음) 먼저 → 시각 이른 순 → 보고할 일정이 보고할까요?보다 먼저 → 제목.
const minuteOf = at => { if (!at) return -1; const t = stampOf(at); return t ? Math.floor(((t + 9 * 3600e3) % 86400e3) / 60000) : -1; };
function sortItems(items) {
  return items.sort((a, b) => a.day.localeCompare(b.day) || minuteOf(a.startsAt) - minuteOf(b.startsAt) || (a.status === b.status ? 0 : a.status === STATUS_TODO ? -1 : 1) || a.title.localeCompare(b.title, 'ko') || a.eventId.localeCompare(b.eventId));
}
// 회의명 거르기(사업 보고 화면의 이름 고르기): 'all'·빈 값이면 전부, 이름이면 같은 이름 열쇠만, '이름 없음' 거르기면 일정은 나오지 않는다(일정에는 제목이 있다).
export function matchesName(item, filter, {noneValue = '__none__'} = {}) {
  if (!filter || filter === 'all') return true;
  if (filter === noneValue) return false;
  return nameKey(item?.title) === nameKey(filter);
}
export function itemsByDay(items) {
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) { const list = map.get(item.day) || []; list.push(item); map.set(item.day, list); }
  return map;
}

// 그날 한 줄 목록: 사업 보고와 보고할 일정을 시각 순으로 섞는다(같은 시각이면 보고 먼저, 종일 일정은 맨 위).
// 줄 = {type:'report', report} | {type:'plan', item}. 보고 순서는 받은 그대로(reportsByDay가 이른 순으로 준다)이고 일정을 그 사이에 끼운다.
export function dayEntries(reports, items) {
  const out = (Array.isArray(reports) ? reports : []).map((report, i) => ({type: ENTRY_REPORT, report, min: minuteOf(report?.meeting_at), order: i}));
  (Array.isArray(items) ? items : []).forEach((item, i) => out.push({type: ENTRY_PLAN, item, min: minuteOf(item.startsAt), order: i}));
  out.sort((a, b) => a.min - b.min || (a.type === b.type ? a.order - b.order : a.type === ENTRY_REPORT ? -1 : 1));
  return out.map(({type, report, item}) => (type === ENTRY_REPORT ? {type, report} : {type, item}));
}
export const entryMark = entry => (entry?.type === ENTRY_PLAN ? entry.item.status : 'done');

// 칸의 점(폰): max개까지. 넘치면 종류마다(쓴 보고·보고할 일정·보고할까요?) 하나씩은 꼭 보이게 고른 뒤 남는 자리를 앞에서부터 채우고, 순서는 그날 목록 순서 그대로.
// 점만 보고도 '쓸 보고가 있는 날'을 놓치지 않게 하려는 규칙이다.
export function cellDots(entries, max = CELL_DOTS) {
  const all = Array.isArray(entries) ? entries : [], n = Math.max(1, Math.floor(Number(max)) || 1);
  if (all.length <= n) return all.slice();
  const picked = new Set();
  for (const mark of ['done', STATUS_TODO, STATUS_ASK]) { if (picked.size >= n) break; const i = all.findIndex(e => entryMark(e) === mark); if (i >= 0) picked.add(i); }
  for (let i = 0; i < all.length && picked.size < n; i++) picked.add(i);
  return [...picked].sort((a, b) => a - b).map(i => all[i]);
}

// '10:00' 같은 시각 글자(24시간, 서울). 종일이면 '종일'.
export const itemTime = item => (item?.startsAt ? seoulClock(item.startsAt) : '종일');
// 그날 목록 둘째 줄(시안): '일정 · 10:00' / '일정 · 10:00 · 담당조직 연결됨'
export const itemMeta = item => ['일정', itemTime(item), item?.status === STATUS_ASK ? '담당조직 연결됨' : ''].filter(Boolean).join(' · ');
// 항목 → 일정 모양(Edge google-calendar normEvent와 같은 칸). 저장(report-plan-data.js)과 보고 쓰기 창에 넘긴다.
export const itemEvent = item => ({id: item.eventId, calendarId: item.calendarId, title: item.title, start: item.startsAt || item.day, allDay: !item.startsAt});
// 보고 쓰기 창에 채울 날짜·시각: 시각 있는 일정은 {at:'YYYY-MM-DDTHH:MM'}(서울), 종일은 {date}. (일정 창 [결과 남기기]와 같은 모양)
export function itemWhen(item) {
  if (!item?.startsAt) return {date: item?.day || ''};
  const d = new Date(stampOf(item.startsAt) + 9 * 3600e3);
  return {at: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`};
}

// 설계 4-4 안 쓴 보고: 켜 둔 줄(state=on) 가운데 일정 날짜가 어제보다 앞이고(지나고 하루가 지남) 이어진 보고가 없는 것. 최근 것이 위.
// Google을 부르지 않는다 — 줄의 날짜·제목 사본과 읽어 둔 보고만 쓴다. todayKey = 오늘(서울) 'YYYY-MM-DD'.
export function overdueItems(data, todayKey) {
  if (!DAY.test(String(todayKey || ''))) return [];
  const y = new Date(Date.UTC(+todayKey.slice(0, 4), +todayKey.slice(5, 7) - 1, +todayKey.slice(8, 10) - 1));
  const yesterday = `${y.getUTCFullYear()}-${pad(y.getUTCMonth() + 1)}-${pad(y.getUTCDate())}`;
  const plans = Array.isArray(data?.plans) ? data.plans : [], reports = Array.isArray(data?.reports) ? data.reports : [], seen = new Set(), out = [];
  for (const row of plans) {
    const id = String(row?.google_event_id ?? '');
    if (!id || seen.has(id) || row.state !== PLAN_ON) continue;
    seen.add(id);
    const item = itemOfRow(row);
    if (item && item.day < yesterday && !reportsOfEvent(id, reports).length) out.push(item);
  }
  return out.sort((a, b) => b.day.localeCompare(a.day) || minuteOf(a.startsAt) - minuteOf(b.startsAt) || a.title.localeCompare(b.title, 'ko') || a.eventId.localeCompare(b.eventId));
}
// '11. 9.'
export const shortDay = key => (DAY.test(String(key || '')) ? `${+key.slice(5, 7)}. ${+key.slice(8, 10)}.` : '');
// '안 쓴 보고' 줄 글자(시안): 굵은 '안 쓴 보고 2' + ' · 11. 9. 시험 회의 외 1'. 없으면 null(줄을 그리지 않는다).
export function overdueSummary(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return null;
  const first = list[0], rest = list.length - 1;
  return {count: list.length, lead: `안 쓴 보고 ${list.length}`, detail: `${shortDay(first.day)} ${first.title}${rest ? ` 외 ${rest}` : ''}`.trim()};
}

// 이 달 Google 일정을 읽을 범위(서울 달 첫날 0시 ~ 다음 달 첫날 0시). month = {year, month(0부터)}.
export function monthRange({year, month}) {
  const start = Date.UTC(year, month, 1) - 9 * 3600e3, end = Date.UTC(year, month + 1, 1) - 9 * 3600e3;
  return {timeMin: new Date(start).toISOString(), timeMax: new Date(end).toISOString()};
}

// 그날 목록 줄 ⋯ 메뉴. 보고할 일정(□): [보고할 일정 ✓](누르면 이 일정만 끔 — 일정 메뉴와 같은 글자) · [빼기](같은 이름은 다시 묻지 않음).
// 보고할까요?(점선 □): [빼기]. 아이콘은 일정 메뉴와 같은 깃발(PLAN_ICON, S59-20 — 네모 선만 있어 빈 자리처럼 보이던 것을 그림으로).
const SKIP_ICON = 'M4 8h8';
export const planRowMenuItems = item => (item?.status === STATUS_TODO
  ? [{id: 'off', label: '보고할 일정 ✓', icon: PLAN_ICON}, {id: 'skip', label: '빼기', icon: SKIP_ICON}]
  : [{id: 'skip', label: '빼기', icon: SKIP_ICON}]);
