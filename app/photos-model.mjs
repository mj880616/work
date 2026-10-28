// PHOTO-사진메뉴 1차(docs/design/photo-menu.md): '사진' 메뉴의 순수 규칙. 화면·네트워크 없음(단위 시험 대상).
// 지금 서버(Edge onedrive-photos)는 달 단위 사진 목록(action 'photos')만 준다. 그래서 최신순 격자는 이번 달부터 한 달씩 거슬러 받아 잇는다.
// 사진이 없는 달이 EMPTY_STOP번 이어지면 끝으로 본다(일기 미리 받기의 PREFETCH.emptyStop과 같은 기준).

export const EMPTY_STOP = 24;
export const MAX_MONTHS = 240;
export const TABS = Object.freeze(['all', 'calendar', 'trash']);
export const FILTERS = Object.freeze(['all', 'star', 'video', 'shot']);
export const FILTER_TEXT = Object.freeze({all: '전체', star: '★', video: '동영상', shot: '스크린샷'});
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

// ---- PHOTO-사진메뉴 2차: 서버 library·months·days(Edge, PR 1410)를 쓰는 규칙 ----
export const PAGE_SIZE = 120;
export const STAR_CHUNK = 500;
export const validFilter = v => (FILTERS.includes(v) ? v : 'all');

// 칸 수(설계: 폰 3~6·PC 5~12, 명진 결정 6: view_prefs.photo_view.cols 하나로 일기와 따로). 저장 값은 하나라 화면 폭마다 범위 안으로 맞춰 쓴다.
export const COLS_RANGE = Object.freeze({narrow: Object.freeze([3, 6]), wide: Object.freeze([5, 12])});
export const COLS_DEFAULT = Object.freeze({narrow: 4, wide: 8});
const range = wide => COLS_RANGE[wide ? 'wide' : 'narrow'];
export function colsFor(wide, saved) {
  const [lo, hi] = range(wide);
  return Number.isInteger(saved) ? Math.max(lo, Math.min(hi, saved)) : COLS_DEFAULT[wide ? 'wide' : 'narrow'];
}
// 한 단계: dir=+1 그림 크게(칸 줄임), -1 작게(칸 늘림). 끝이면 그대로.
export function stepPhotoCols(wide, cols, dir) {
  const [lo, hi] = range(wide);
  return Math.max(lo, Math.min(hi, colsFor(wide, cols) - Math.sign(dir)));
}
// 서버 값 photo_view({filter, cols}) 읽기. 모양이 틀리면 그 칸만 버린다.
export function parsePhotoView(v) {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  return {filter: validFilter(o.filter), cols: Number.isInteger(o.cols) && o.cols >= 3 && o.cols <= 12 ? o.cols : null};
}

// 서버 한 쪽(odLibrary items) → 화면 칸. 같은 id가 다시 오면 빼고 잇는다.
export const toItem = p => ({kind: 'od', source: 'onedrive', key: p.id, id: p.id, day: p.day, name: p.name || '', taken_at: p.taken_at || '', approx: p.approx === true,
  video: p.kind === 'video', duration_ms: p.duration_ms ?? null, width: p.width ?? null, height: p.height ?? null, screenshot: p.screenshot === true});
export function appendItems(list, page) {
  const seen = new Set(list.map(x => x.id));
  const out = list.slice();
  for (const p of page) if (p && !seen.has(p.id)) { seen.add(p.id); out.push(p); }
  return out;
}
// 여러 묶음(★ 500개씩 나눠 받은 것)을 최신순 하나로.
export const newestFirst = (a, b) => String(b.taken_at).localeCompare(String(a.taken_at)) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

// 동영상 길이 '0:42' · '1:02:03'.
export function durationLabel(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const t = Math.round(ms / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

// 빠른 이동 막대: 달별 장수 → 최신 달부터 [{key, n, label:'2026.09', from, to}] (from·to = 막대 위에서의 비율 0~1, 장수만큼 길이).
export function monthBar(months) {
  const keys = Object.keys(months || {}).filter(k => parseMonth(k) && months[k] > 0).sort().reverse();
  const total = keys.reduce((n, k) => n + months[k], 0);
  let at = 0;
  return keys.map(key => {
    const from = total ? at / total : 0;
    at += months[key];
    return {key, n: months[key], label: key.replace('-', '.'), from, to: total ? at / total : 0};
  });
}
// 막대 위 비율(0~1) → 그 자리 달.
export function monthAt(bar, ratio) {
  if (!bar.length) return null;
  const r = Math.max(0, Math.min(1, ratio));
  return bar.find(m => r < m.to) || bar.at(-1);
}
// 그 달 끝(다음 달 1일 0시, 서울)에서 시작하는 cursor. id '!'은 어떤 원드라이브 id보다 앞이라 그 시각 사진은 넘긴다(다음 달 것).
export function monthCursor(key) {
  const ym = parseMonth(key); if (!ym) return null;
  const n = nextMonth(ym);
  return {t: new Date(Date.UTC(n.year, n.month, 1) - 9 * 3600 * 1000).toISOString(), id: '!'};
}

// 달력 한 달(서버 days): 앞 빈칸 수와 날마다 장수·대표 1장.
export function calendarFromDays({year, month}, days = {}) {
  const lead = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const total = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = [];
  for (let n = 1; n <= total; n++) {
    const day = `${monthKey(year, month)}-${String(n).padStart(2, '0')}`;
    const d = days[day];
    cells.push({day, n, count: d?.count || 0, rep: d ? {kind: 'od', source: 'onedrive', id: d.cover.id, key: d.cover.id, day, video: d.cover.kind === 'video', name: '', taken_at: ''} : null});
  }
  return {lead, cells};
}
// 묶음 나누기(여러 장 지우기·되살리기 50장, ★ 500개).
export function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
// 끌어 고르기: 처음 누른 칸(a)부터 지금 칸(b)까지 화면 순서 범위.
export function dragRange(order, a, b) {
  const i = order.indexOf(a), j = order.indexOf(b);
  if (i < 0 || j < 0) return [];
  return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}
// 여러 장 받기는 한 번에 20장까지(설계 2.5).
export const DOWNLOAD_MAX = 20;
export const SHARE_MAX = 20;
// 그날 끝(다음 날 0시, 서울)에서 시작하는 cursor — [달력]에서 고른 날을 목록 맨 위에 둔다.
export function dayCursor(day) {
  if (!dayRe.test(day || '')) return null;
  const [y, m, d] = day.split('-').map(Number);
  return {t: new Date(Date.UTC(y, m - 1, d + 1) - 9 * 3600 * 1000).toISOString(), id: '!'};
}
// 목록에서 여러 장 빼기(원래 자리 기억)·되돌리기. 순서는 그대로.
export function takeItems(list, ids) {
  const want = new Set(ids), taken = [], rest = [];
  list.forEach((item, index) => { if (want.has(item.id)) taken.push({item, index}); else rest.push(item); });
  return {rest, taken};
}
export function putItems(list, taken) {
  const out = list.slice(), have = new Set(out.map(x => x.id));
  for (const t of taken.slice().sort((a, b) => a.index - b.index)) if (!have.has(t.item.id)) { out.splice(Math.min(out.length, t.index), 0, t.item); have.add(t.item.id); }
  return out;
}
