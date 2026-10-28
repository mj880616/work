// PHOTO-사진메뉴 1차(docs/design/photo-menu.md): '사진' 메뉴의 순수 규칙. 화면·네트워크 없음(단위 시험 대상).
// 지금 서버(Edge onedrive-photos)는 달 단위 사진 목록(action 'photos')만 준다. 그래서 최신순 격자는 이번 달부터 한 달씩 거슬러 받아 잇는다.
// 사진이 없는 달이 EMPTY_STOP번 이어지면 끝으로 본다(일기 미리 받기의 PREFETCH.emptyStop과 같은 기준).

export const EMPTY_STOP = 24;
export const MAX_MONTHS = 240;
export const TABS = Object.freeze(['all', 'calendar']);
export const FILTERS = Object.freeze(['all', 'star']);
export const SELECT_MAX = 50;
const dayRe = /^\d{4}-\d{2}-\d{2}$/;
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

export const validTab = v => (TABS.includes(v) ? v : 'all');
export const monthKey = (year, month) => `${year}-${String(month + 1).padStart(2, '0')}`;
export function prevMonth({year, month}) { return month === 0 ? {year: year - 1, month: 11} : {year, month: month - 1}; }
export function nextMonth({year, month}) { return month === 11 ? {year: year + 1, month: 0} : {year, month: month + 1}; }
export function parseMonth(key) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(key || ''));
  return m ? {year: Number(m[1]), month: Number(m[2]) - 1} : null;
}

// 달 목록({days: {'2026-10-27': [{id,name,taken_at,approx}]}}) → 최신순 한 줄 목록(날 내림차순, 같은 날은 찍은 시각 내림차순).
export function monthItems(data) {
  const out = [];
  const days = data && typeof data.days === 'object' && data.days ? data.days : {};
  for (const day of Object.keys(days).filter(d => dayRe.test(d)).sort().reverse()) {
    const list = Array.isArray(days[day]) ? days[day].slice() : [];
    list.sort((a, b) => String(b.taken_at).localeCompare(String(a.taken_at)) || String(b.id).localeCompare(String(a.id)));
    for (const p of list) if (p && typeof p.id === 'string' && p.id) out.push({kind: 'od', source: 'onedrive', key: p.id, id: p.id, day, name: String(p.name || ''), taken_at: String(p.taken_at || ''), approx: p.approx === true});
  }
  return out;
}

// 날짜 머리줄로 묶기(순서 그대로).
export function groupByDay(items) {
  const out = [];
  for (const item of items) {
    const last = out.at(-1);
    if (last && last.day === item.day) last.items.push(item);
    else out.push({day: item.day, items: [item]});
  }
  return out;
}

// '10월 27일 (월)'
export function dayHead(day) {
  if (!dayRe.test(day || '')) return '';
  const [y, m, d] = day.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}월 ${d}일 (${WEEK[w]})`;
}

export const applyFilter = (items, filter, isStarred) => (filter === 'star' ? items.filter(isStarred) : items.slice());

// 달력 한 달: 앞 빈칸 수와 날마다 장수·대표 사진(별표 있는 첫 장, 없으면 첫 장 — 설계 1.3).
export function calendarMonth({year, month}, data, isStarred = () => false) {
  const lead = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const total = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const byDay = new Map(groupByDay(monthItems(data)).map(g => [g.day, g.items]));
  const cells = [];
  for (let n = 1; n <= total; n++) {
    const day = `${monthKey(year, month)}-${String(n).padStart(2, '0')}`;
    const list = (byDay.get(day) || []).slice().reverse(); // 찍은 차례(오래된 것 먼저)
    const rep = list.find(isStarred) || list[0] || null;
    cells.push({day, n, count: list.length, rep});
  }
  return {lead, cells};
}

// 여러 장 별표: 모두 별표면 모두 풀고, 아니면 아직 안 된 것만 별표(선택 모드 [☆ 별표]).
export function starPlan(items, isStarred) {
  const all = items.length > 0 && items.every(isStarred);
  return all ? {on: false, items: items.slice()} : {on: true, items: items.filter(i => !isStarred(i))};
}

// 한 사진을 달 목록에서 빼고(원래 자리 기억) 되돌린다. data는 그대로 고친다.
export function takePhoto(data, item) {
  const list = data?.days?.[item.day];
  if (!Array.isArray(list)) return null;
  const index = list.findIndex(p => p.id === item.id);
  if (index < 0) return null;
  const [photo] = list.splice(index, 1);
  if (!list.length) delete data.days[item.day];
  return {data, day: item.day, index, photo};
}
export function putPhoto(t) {
  if (!t) return;
  const list = t.data.days[t.day] || (t.data.days[t.day] = []);
  if (list.some(p => p.id === t.photo.id)) return;
  list.splice(Math.max(0, Math.min(list.length, t.index)), 0, t.photo);
}
