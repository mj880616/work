// PHOTO-사진메뉴 1차(docs/design/photo-menu.md): '사진' 메뉴의 순수 규칙. 화면·네트워크 없음(단위 시험 대상).
// 지금 서버(Edge onedrive-photos)는 달 단위 사진 목록(action 'photos')만 준다. 그래서 최신순 격자는 이번 달부터 한 달씩 거슬러 받아 잇는다.
// 사진이 없는 달이 EMPTY_STOP번 이어지면 끝으로 본다(일기 미리 받기의 PREFETCH.emptyStop과 같은 기준).

import {folderIndent} from './folder-limits.mjs';
export const EMPTY_STOP = 24;
export const MAX_MONTHS = 240;
// 사진 메뉴 ②(2026-10-29): [폴더]·[앨범] 칩을 [달력] 뒤에 더한다(지도는 ③단계에서).
export const TABS = Object.freeze(['all', 'calendar', 'folders', 'albums', 'trash']);
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
// PHOTO-정렬(요청함 10/30): 사진·폴더·앨범 격자의 정렬 기준. view_prefs.photo_view.sort 하나(폰·PC 같음, DB 검사 20261030150000과 같은 값). 기본은 찍은 날 최근 먼저.
export const SORTS = Object.freeze(['taken_desc', 'taken_asc', 'uploaded_desc', 'name_asc', 'size_desc', 'duration_desc']);
export const DEFAULT_SORT = 'taken_desc';
export const SORT_TEXT = Object.freeze({taken_desc: '찍은 날 최근 먼저', taken_asc: '찍은 날 오래된 먼저', uploaded_desc: '올린 날 최근 먼저',
  name_asc: '파일 이름 가나다', size_desc: '크기 큰 것 먼저', duration_desc: '동영상 길이 긴 것 먼저'});
// 버튼 글자(짧게): '찍은 날 ↓'
export const SORT_SHORT = Object.freeze({taken_desc: '찍은 날 ↓', taken_asc: '찍은 날 ↑', uploaded_desc: '올린 날 ↓', name_asc: '이름 가나다', size_desc: '크기 ↓', duration_desc: '길이 ↓'});
export const validSort = v => (SORTS.includes(v) ? v : DEFAULT_SORT);
// 날짜 머리줄로 묶는 기준(찍은 날 기준일 때만).
export const sortByDay = sort => sort === 'taken_desc' || sort === 'taken_asc';
// 메뉴에 보일 기준: 동영상 길이는 동영상이 있을 때만(지금 그 기준이면 늘 보임).
export const sortChoices = (hasVideo, sort = DEFAULT_SORT) => SORTS.filter(s => s !== 'duration_desc' || hasVideo || sort === s);
// 여러 묶음(★·앨범 500개씩)을 그 기준 하나로 합치는 비교. 서버 onedrive-photos sortCmp와 같은 규칙(값 없는 크기·길이는 맨 뒤, 올린 시각이 없으면 찍은 시각).
const nameOrder = typeof Intl === 'object' ? new Intl.Collator('ko', {numeric: true}) : null;
const idAsc = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const num = v => (Number.isFinite(v) ? v : -1);
export function sortCompare(sort) {
  switch (validSort(sort)) {
    case 'taken_asc': return (a, b) => String(a.taken_at).localeCompare(String(b.taken_at)) || idAsc(a.id, b.id);
    case 'uploaded_desc': return (a, b) => String(b.uploaded_at || b.taken_at).localeCompare(String(a.uploaded_at || a.taken_at)) || idAsc(b.id, a.id);
    case 'name_asc': return (a, b) => (nameOrder ? nameOrder.compare(String(a.name), String(b.name)) : String(a.name).localeCompare(String(b.name), 'ko')) || idAsc(a.id, b.id);
    case 'size_desc': return (a, b) => num(b.size_bytes) - num(a.size_bytes) || idAsc(b.id, a.id);
    case 'duration_desc': return (a, b) => num(b.duration_ms) - num(a.duration_ms) || idAsc(b.id, a.id);
    default: return newestFirst;
  }
}
// 서버 값 photo_view({filter, cols, sort}) 읽기. 모양이 틀리면 그 칸만 버린다.
export function parsePhotoView(v) {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  return {filter: validFilter(o.filter), cols: Number.isInteger(o.cols) && o.cols >= 3 && o.cols <= 12 ? o.cols : null, sort: validSort(o.sort)};
}
// 저장할 photo_view(기본 정렬은 적지 않는다: DB 적용 전에도 다른 칸 저장이 거절되지 않게).
export const photoViewValue = ({filter = 'all', cols = null, sort = DEFAULT_SORT} = {}) =>
  ({filter: validFilter(filter), ...(Number.isInteger(cols) ? {cols} : {}), ...(validSort(sort) !== DEFAULT_SORT ? {sort: validSort(sort)} : {})});

// 서버 한 쪽(odLibrary items) → 화면 칸. 같은 id가 다시 오면 빼고 잇는다.
export const toItem = p => ({kind: 'od', source: 'onedrive', key: p.id, id: p.id, day: p.day, name: p.name || '', taken_at: p.taken_at || '', approx: p.approx === true,
  video: p.kind === 'video', duration_ms: p.duration_ms ?? null, width: p.width ?? null, height: p.height ?? null, screenshot: p.screenshot === true,
  size_bytes: p.size_bytes ?? null, uploaded_at: p.uploaded_at || ''});
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
    // PHOTO-출처 ①: 폰 사진만 있는 날은 d.rep(폰 사진 칸)을 그대로 쓴다(photo-sources-model.mjs mergeDays).
    cells.push({day, n, count: d?.count || 0, rep: d?.rep || (d?.cover ? {kind: 'od', source: 'onedrive', id: d.cover.id, key: d.cover.id, day, video: d.cover.kind === 'video', name: '', taken_at: ''} : null)});
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

// ---- 사진 메뉴 ②: 폴더 보기(원드라이브 폴더 그대로, 서버 folders-tree) ----
// tree = {top:{id,name,count,total}, folders:[{id,name,parent_id,enabled,count,total}]}. 폴더 순서는 이름(가나다), 같으면 id.
const byName = (a, b) => a.name.localeCompare(b.name, 'ko') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export function photoSubfolders(tree, id) {
  return (tree?.folders || []).filter(f => f.parent_id === id).sort(byName);
}
export function photoFolderById(tree, id) {
  if (!tree) return null;
  if (tree.top?.id === id) return {...tree.top, parent_id: null, enabled: tree.top.enabled !== false};
  return tree.folders.find(f => f.id === id) || null;
}
// PC 왼쪽 나무 줄: 맨 위 폴더(늘 열림) → 열린 폴더 안 폴더 들여쓰기(4단까지 밀고 그 아래는 그대로, folder-limits.mjs). 닫힌 폴더 안은 만들지 않는다.
export function photoFolderRows(tree, isOpen = () => false) {
  if (!tree?.top) return [];
  const rows = [], seen = new Set();
  const walk = (id, depth) => {
    for (const f of photoSubfolders(tree, id)) {
      if (seen.has(f.id) || depth > 200) continue;
      seen.add(f.id);
      const kids = photoSubfolders(tree, f.id).length > 0, open = kids && isOpen(f.id);
      rows.push({id: f.id, name: f.name, depth, indent: folderIndent(depth), count: f.count, total: f.total, enabled: f.enabled !== false, kids, open, top: false});
      if (open) walk(f.id, depth + 1);
    }
  };
  rows.push({id: tree.top.id, name: tree.top.name, depth: 0, indent: 0, count: tree.top.count, total: tree.top.total, enabled: tree.top.enabled !== false, kids: photoSubfolders(tree, tree.top.id).length > 0, open: true, top: true});
  walk(tree.top.id, 1);
  return rows;
}
// 위치 줄: 맨 위 폴더부터 그 폴더까지(고리·끊긴 부모는 거기서 멈춤).
export function photoFolderTrail(tree, id) {
  const out = [], seen = new Set();
  for (let f = photoFolderById(tree, id); f && !seen.has(f.id) && out.length < 200; f = f.parent_id ? photoFolderById(tree, f.parent_id) : null) { seen.add(f.id); out.unshift(f); }
  return out;
}
// 그 폴더와 그 아래 모든 폴더 id.
export function photoFolderSubtree(tree, id) {
  const out = new Set([id]), stack = [id];
  while (stack.length) for (const k of photoSubfolders(tree, stack.pop())) if (!out.has(k.id)) { out.add(k.id); stack.push(k.id); }
  return out;
}
// 옮길 곳 목록(나무 순서, 모두 펼침). moving = 옮기는 폴더 id(자기·자기 아래는 빠짐), 사진이면 null. here = 지금 폴더(고를 수 없게 표시).
export function photoMoveTargets(tree, {moving = null, here = null} = {}) {
  const skip = moving ? photoFolderSubtree(tree, moving) : new Set();
  const parentOfMoving = moving ? photoFolderById(tree, moving)?.parent_id : null;
  return photoFolderRows(tree, () => true).filter(r => !skip.has(r.id)).map(r => ({...r, current: moving ? r.id === parentOfMoving : r.id === here}));
}
// 폴더 이름 규칙(서버 cleanFolderName과 같음): 원드라이브 금지 글자·제어 글자·끝 점·1~200자·Web2 휴지통 이름 거절. 맞으면 다듬은 이름, 아니면 null.
export const TRASH_FOLDER_NAME = '.Web2 휴지통';
export function cleanPhotoFolderName(v) {
  if (typeof v !== 'string') return null;
  const name = v.normalize('NFC').trim();
  if (!name || [...name].length > 200 || /["*:<>?/\\|\u0000-\u001f\u007f]/.test(name) || name.endsWith('.')) return null;
  if (name === TRASH_FOLDER_NAME || name === '.' || name === '..') return null;
  return name;
}
// 옮긴 결과(서버 photos-move의 moved[{id, from}])를 되돌리기 묶음으로: 원래 폴더 id → 사진 id들(원래 폴더를 모르면 뺀다).
export function moveUndoGroups(moved, target) {
  const out = new Map();
  for (const m of moved || []) {
    if (!m || typeof m.id !== 'string' || typeof m.from !== 'string' || !m.from || m.from === target) continue;
    (out.get(m.from) || out.set(m.from, []).get(m.from)).push(m.id);
  }
  return out;
}
// 서버 거절을 일상어로(폴더 동작).
export function folderErrorText(code) {
  return ({onedrive_name_taken: '같은 이름의 폴더가 이미 있어요.', onedrive_folder_not_empty: '폴더가 비어 있을 때만 지울 수 있어요. 사진·파일을 먼저 옮겨 주세요.', onedrive_folder_has_trash: '이 폴더 안에 사진 휴지통이 있어 지울 수 없어요.',
    onedrive_outside_folder: '고른 원드라이브 폴더 밖이라 할 수 없어요.', onedrive_folder_missing: '폴더를 찾지 못했어요. 새로 고친 뒤 다시 해 주세요.',
    onedrive_reconnect_needed: '원드라이브를 다시 연결해 주세요.', onedrive_request_invalid: '이름이나 옮길 곳을 확인해 주세요.'})[code] || '';
}

// ---- 사진 메뉴 ②: 앨범(#태그, app_photo_tags·app_photo_tag_items) ----
// 이름 규칙(DB 검사와 같음): 앞의 '#'은 떼고, 1~40자, '#'·공백 없음. 맞으면 이름, 아니면 null.
export function cleanTagName(v) {
  if (typeof v !== 'string') return null;
  const name = v.normalize('NFC').trim().replace(/^#+/, '');
  if (!name || [...name].length > 40 || /[#\s]/.test(name)) return null;
  return name;
}
export const sameTag = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
// 앨범 카드: 이름순, 장수 = 그 앨범의 원드라이브 사진 수, 대표 = 정한 대표(그 앨범에 있을 때) → 없으면 가장 최근 찍은 날의 사진.
// PHOTO-출처모든칩: 앨범 카드를 지금 읽는 출처(use = {onedrive, phone})로 줄인다. 장수·대표 사진·안의 격자가 켜진 출처 것만.
export function albumForSources(card, use = {}) {
  const keys = use.onedrive ? card.keys : [], phoneKeys = use.phone ? card.phoneKeys : [];
  const cover = use.onedrive ? card.cover : null;
  // PHOTO-위쪽두줄앨범보기: 기간 = 켜진 출처 사진의 찍은 날 가장 이른 날~늦은 날(모르면 빈칸).
  const days = [...(use.onedrive ? card.odDays || [] : []), ...(use.phone ? card.phoneDays || [] : [])].filter(Boolean).sort();
  return {...card, keys, phoneKeys, cover, phoneCover: cover ? null : phoneKeys[0] || null, count: keys.length + phoneKeys.length, from: days[0] || '', to: days.at(-1) || ''};
}
// PHOTO-위쪽두줄앨범보기(요청함 10/31 16:18): 앨범 탭 보기 크기 세 단계. 큰 것부터 — 'card'(큰 칸 두 칸씩)·'thumb'(작은 그림 + 이름·장수·기간)·'line'(글자만 한 줄).
// 고른 단계는 서버 view_prefs.album_view(view-prefs.js ALBUM_VIEWS와 같은 값). [＋](dir=+1)는 크게, [－](dir=-1)는 작게, 끝에서는 그대로.
export const ALBUM_VIEWS = Object.freeze(['card', 'thumb', 'line']);
export const DEFAULT_ALBUM_VIEW = 'card';
export const validAlbumView = v => (ALBUM_VIEWS.includes(v) ? v : DEFAULT_ALBUM_VIEW);
export function stepAlbumView(view, dir) {
  const at = ALBUM_VIEWS.indexOf(validAlbumView(view));
  return ALBUM_VIEWS[Math.max(0, Math.min(ALBUM_VIEWS.length - 1, at - Math.sign(Number(dir) || 0)))];
}
export const ALBUM_VIEW_TEXT = Object.freeze({card: '큰 칸', thumb: '작은 그림 목록', line: '한 줄 목록'});
// 앨범 기간 글자: 'YYYY-MM-DD' 둘 → '2026.10.1' 하루, '2026.10.1–10.31' 같은 해, '2025.12.30–2026.1.2' 다른 해. 모르면 ''.
export function albumPeriod(from, to) {
  const parse = d => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? String(d).split('-').map(Number) : null);
  const a = parse(from), b = parse(to) || a;
  if (!a) return '';
  const full = x => `${x[0]}.${x[1]}.${x[2]}`;
  if (a.join() === b.join()) return full(a);
  return `${full(a)}–${a[0] === b[0] ? `${b[1]}.${b[2]}` : full(b)}`;
}
export function albumCards(tags, links) {
  const byTag = new Map();
  for (const l of links || []) if (l && typeof l.tag_id === 'string' && typeof l.item_key === 'string') (byTag.get(l.tag_id) || byTag.set(l.tag_id, []).get(l.tag_id)).push(l);
  return (tags || []).filter(t => t && typeof t.id === 'string' && typeof t.name === 'string').map(t => {
    const list = (byTag.get(t.id) || []).slice().sort((a, b) => String(b.taken_day || '').localeCompare(String(a.taken_day || '')) || (a.item_key < b.item_key ? -1 : 1));
    // PHOTO-출처 ①: keys = 원드라이브 사진 열쇠(서버 library로 읽음), phoneKeys = 폰 사진 열쇠('ms:<번호>', 앱에서 읽음). 장수는 둘을 더한다.
    const od = list.filter(l => (l.source || 'onedrive') === 'onedrive'), phone = list.filter(l => l.source === 'phone');
    const cover = t.cover_key && od.some(l => l.item_key === t.cover_key) ? t.cover_key : od[0]?.item_key || null;
    return {id: t.id, name: t.name, count: list.length, cover, phoneCover: cover ? null : phone[0]?.item_key || null, keys: od.map(l => l.item_key), phoneKeys: phone.map(l => l.item_key),
      odDays: od.map(l => l.taken_day).filter(Boolean), phoneDays: phone.map(l => l.taken_day).filter(Boolean)};
  }).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

// ---- PHOTO-폴더스위치(요청함 10/31 11:04): 같은 이름 폴더 구분 · 위치 이름 ----
// 폰 폴더 위치(relative_path의 위 칸) 이름: 첫 칸은 일상어로(Pictures→사진 등), 나머지는 그대로 '/'로 잇는다. 'DCIM/Camera/' → '카메라'.
const PHONE_PLACE = Object.freeze({Pictures:'사진', DCIM:'카메라', Download:'다운로드', Movies:'동영상', Documents:'문서', Android:'앱'});
export function phoneFolderPlace(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  if (parts.length < 2) return '';
  const up = parts.slice(0, -1);
  return [PHONE_PLACE[up[0]] || up[0], ...up.slice(1)].join('/');
}
// 목록 안에서 이름이 같은 폴더(대소문자 무시)만 위치 이름을 단다. list = [{id, name}], placeOf(f) = 위치 이름. 답 = Map(id → 위치 이름).
// 위치 이름까지 같으면 위치 이름 대신 순번을 붙인다('KakaoTalk · 사진 2').
export function folderPlaceLabels(list, placeOf) {
  const byName = new Map();
  for (const f of list || []) { const k = String(f?.name || '').normalize('NFC').toLowerCase(); (byName.get(k) || byName.set(k, []).get(k)).push(f); }
  const out = new Map();
  for (const same of byName.values()) {
    if (same.length < 2) continue;
    const seen = new Map();
    for (const f of same) {
      const place = String(placeOf(f) || '').trim() || '맨 위';
      const n = (seen.get(place) || 0) + 1; seen.set(place, n);
      out.set(f.id, n > 1 ? `${place} ${n}` : place);
    }
  }
  return out;
}
// 원드라이브 폴더 위치 이름 = 부모 폴더 이름(맨 위 폴더 바로 안이면 맨 위 이름).
export const odFolderPlace = (tree, f) => (f?.parent_id ? photoFolderById(tree, f.parent_id)?.name || '' : '');
