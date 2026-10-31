// WEEKLY-주요일정칸 (요청함 10/30 13:17·13:38, 명진 결정 "ㅇㅋ"·"모두반영"): 주간보고 일정 줄을 칸별로 다루는 화면 없는 부분.
// 두 곳 — [주간 정리] '1. 2) 주요 일정' 수기 표와 한글 파일 상자 '5. 주요 일정' — 이 같은 자료를 보게 한 곳(그 주 행 draft)에서 읽고 쓴다.
//   - 달력 일정 하나의 칸별 고침: draft.titles 항목 {event, title, place, day?, time?, who?} (일정 키 열쇠 — 상자 5번과 [주간 정리] 2)이 같은 항목).
//     title·place는 늘 있고(옛 모양 그대로), day·time·who는 고쳤을 때만. 날짜·시간·참석은 그 회차 값이라 '기억'에는 가지 않는다(제목·장소만, 기존 규칙).
//   - 2) 주요 일정 줄: draft.hq [{id, event?, day, time, title, place}] (순서 = 화면 순서). event가 있는 줄은 [달력에서 골라 넣기]로 넣은 줄 —
//     보이는 값은 그 일정의 칸별 고침(titles) > 기억 > 달력이고, 그 줄을 고치면 titles를 고친다(상자 5번에도 같은 값). 일정이 달력에서 없어지면
//     줄에 남은 값(넣을 때 적어 둔 값)을 쓴다. 수기 줄은 줄 값 그대로.
//   - 3. 2) 투쟁 사업장 현황 구성: draft.site_layout {order:[이름], hidden:[이름], at} — 넣은 사업장 순서와 이번 주 보고에서 뺀 사업장.
//     그 주에 구성이 없으면 가장 가까운 지난주 구성을 이어 쓴다(다음 주에도 이어짐). 뺀 사업장의 적은 글은 지우지 않는다(칸은 그대로, 보이지만 않음).
// 한글 파일 모양은 그대로다: 일정 칸 글은 '10:30 / 제목 / 장소' 한 줄(schedule.mjs formWhat), 2) 주요 일정은 '- 11.6.(금) 13:00 / 내용 / 장소' 줄.
// 브라우저 저장소에 아무것도 두지 않는다. 내용은 업무 글이라 로그에 쓰지 않는다.
import {formDay, realDay, newId} from './weekly-exec-requests.js';
import {splitScheduleFields} from './schedule-line-split.mjs';

export const HQ_MAX = 40;
export const TITLE_MAX = 200;
export const PLACE_MAX = 100;
export const WHO_MAX = 200;
export const ALL_DAY = '종일';
export const SITE_MAX = 60;
const NAME_MAX = 120;
const one = s => String(s ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
const cut = (s, n) => [...one(s)].slice(0, n).join('');
const ID = /^[A-Za-z0-9_-]{1,40}$/;

// ---- 시간 ----
// '' | 'HH:MM' | '종일'. 0930·9:30·930 도 받는다. 읽을 수 없으면 null.
export function cleanTime(raw) {
  const s = one(raw);
  if (!s) return '';
  if (s === ALL_DAY) return ALL_DAY;
  let h, m, x;
  if ((x = /^(\d{1,2})[:.](\d{2})$/.exec(s))) { h = +x[1]; m = +x[2]; }
  else if (/^\d{1,4}$/.test(s)) { if (s.length <= 2) { h = +s; m = 0; } else { h = +s.slice(0, -2); m = +s.slice(-2); } }
  else return null;
  return h > 23 || m > 59 ? null : `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ---- 달력 일정의 칸별 고침(draft.titles) ----
// 항목 하나를 모양대로(틀린 칸은 버림). 일정 키 없으면 null.
export function cleanTitleEdit(t) {
  if (!t || typeof t !== 'object' || typeof t.event !== 'string' || !t.event || t.event.length > 300) return null;
  const out = {event:t.event, title:cut(t.title, TITLE_MAX), place:cut(t.place, PLACE_MAX)};
  if (typeof t.day === 'string' && realDay(t.day)) out.day = t.day;
  const time = typeof t.time === 'string' ? cleanTime(t.time) : null;
  if (time) out.time = time;
  if (typeof t.who === 'string') out.who = cut(t.who, WHO_MAX);
  return out;
}
// 칸 값만(일정 키 뺀 것) — Map 값·3자 비교 칸 값.
export const titleFields = t => { const {event, ...rest} = cleanTitleEdit({event:'x', ...t}) ?? {}; return rest; };
// 달력 일정 하나(scheduleItems 줄: {key, day, time, title, place, memo?})의 바탕 값 = 기억(제목·장소) 아니면 달력. who 바탕 = 내 이름.
export function baseFields(item, me = '') {
  const memo = item?.memo?.title ? {title:item.memo.title, place:item.memo.place ?? item.place} : null;
  // WEEKLY-장소칸: 예전 한 줄 모양('10:30 / 제목 / 장소')의 달력 제목·기억은 칸별로 나눠 읽는다(schedule-line-split.mjs).
  return splitScheduleFields({day:String(item?.day ?? ''), time:String(item?.time ?? ''), title:one(memo?.title ?? item?.title), place:one(memo?.place ?? item?.place ?? ''), who:one(me)});
}
// 보이는 값 = 칸별 고침 > 바탕. edit = {title, place, day?, time?, who?} | undefined.
export function eventFields(item, edit, me = '') {
  const b = baseFields(item, me);
  if (!edit) return b;
  // 임시저장(draft.titles)에 한 줄 모양으로 남은 제목도 나눠 읽는다. 시간은 고친 시간 > 제목 앞 시각 > 바탕.
  const own = splitScheduleFields({time:edit.time || '', title:one(edit.title), place:edit.place !== undefined ? one(edit.place) : ''});
  const place = edit.place !== undefined || own.place ? own.place : b.place;
  return {day:edit.day || b.day, time:own.time || b.time, title:own.title || b.title, place, who:edit.who !== undefined ? one(edit.who) : b.who};
}
// 화면 칸 값(next) → 저장할 고침(바탕과 같으면 null = 고침 없음). title·place는 늘 넣고, day·time·who는 바탕과 다를 때만.
export function editFrom(item, next, me = '') {
  const b = baseFields(item, me);
  // 칸에 한 줄 모양('10:30 / 제목 / 장소')을 붙여 넣어도 나뉜 모양으로 저장한다.
  const n = splitScheduleFields({...b, ...Object.fromEntries(Object.entries(next ?? {}).map(([k, v]) => [k, one(v)]))});
  if (!n.title) n.title = b.title || one(item?.title);
  const time = cleanTime(n.time);
  n.time = time === null || !time ? b.time : time;
  if (!realDay(n.day)) n.day = b.day;
  const same = ['day', 'time', 'title', 'place', 'who'].every(k => n[k] === b[k]);
  if (same) return null;
  const out = {title:n.title, place:n.place};
  if (n.day !== b.day) out.day = n.day;
  if (n.time !== b.time) out.time = n.time;
  if (n.who !== b.who) out.who = n.who;
  return out;
}
// 참석 칸 글 → 한글 파일 참석자 칸 줄(쉼표로 여럿).
export const whoList = who => String(who ?? '').split(/\s*[,，]\s*/).map(one).filter(Boolean);

// ---- 2) 주요 일정 줄(draft.hq) ----
export function cleanHqRow(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const id = typeof r.id === 'string' && ID.test(r.id) ? r.id : null;
  if (!id) return null;
  const out = {id, day:typeof r.day === 'string' && realDay(r.day) ? r.day : '', time:(typeof r.time === 'string' && cleanTime(r.time)) || '', title:cut(r.title, TITLE_MAX), place:cut(r.place, PLACE_MAX)};
  if (typeof r.event === 'string' && r.event && r.event.length <= 300) out.event = r.event;
  if (!out.title && !out.event) return null;
  return out;
}
export function readHq(list) {
  const seen = new Set(), out = [];
  for (const r of Array.isArray(list) ? list : []) { const c = cleanHqRow(r); if (c && !seen.has(c.id) && out.length < HQ_MAX) { seen.add(c.id); out.push(c); } }
  return out;
}
// 줄 하나의 보이는 값. events: Map(일정 키 → scheduleItems 줄), titles: Map(일정 키 → 고침).
export function hqFields(row, {events = new Map(), titles = new Map()} = {}) {
  const item = row.event ? events.get(row.event) : null;
  if (!item) return {...splitScheduleFields({day:row.day, time:row.time, title:row.title, place:row.place}), linked:false};
  const f = eventFields(item, titles.get(row.event));
  return {day:f.day, time:f.time, title:f.title, place:f.place, linked:true};
}
// 한글 파일·복사 줄: '- 11.6.(금) 13:00 / 내용 / 장소' (시간·장소가 없으면 그 부분 없이).
export function hqLine(f) {
  const what = [f.time, f.title, f.place].map(one).filter(Boolean).join(' / ');
  return `- ${f.day ? `${formDay(f.day)} ` : ''}${what}`.trimEnd();
}
export const hqLines = (rows, ctx) => rows.map(r => hqLine(hqFields(r, ctx))).filter(line => line.length > 2);
// 줄 더하기·바꾸기·빼기·옮기기(순수). 넘치면 null.
export function withHqRow(list, row) {
  const rows = readHq(list), c = cleanHqRow({id:row?.id || newId().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40), ...row});
  if (!c) return null;
  const at = rows.findIndex(r => r.id === c.id);
  if (at >= 0) { rows[at] = c; return rows; }
  if (rows.length >= HQ_MAX) return null;
  return [...rows, c];
}
export const withoutHqRow = (list, id) => readHq(list).filter(r => r.id !== id);
export function movedHqRow(list, id, index) {
  const rows = readHq(list), from = rows.findIndex(r => r.id === id);
  if (from < 0) return rows;
  const [row] = rows.splice(from, 1);
  rows.splice(Math.max(0, Math.min(index, rows.length)), 0, row);
  return rows;
}
// [달력에서 골라 넣기]: 고른 일정 줄(보이는 값을 줄에 적어 둔다 — 일정이 달력에서 없어져도 남게). 이미 넣은 일정은 다시 넣지 않는다.
export function withPicked(list, picked, ctx = {}) {
  let rows = readHq(list);
  const have = new Set(rows.map(r => r.event).filter(Boolean));
  for (const item of picked ?? []) {
    if (!item?.key || have.has(item.key)) continue;
    const f = eventFields(item, ctx.titles?.get?.(item.key));
    const next = withHqRow(rows, {event:item.key, day:f.day, time:f.time, title:f.title, place:f.place});
    if (!next) break;
    rows = next; have.add(item.key);
  }
  return rows;
}

// ---- 3. 2) 투쟁 사업장 현황 구성(draft.site_layout) ----
export const siteKey = name => one(name).replace(/\s+/g, '').toLowerCase();
export function readSiteLayout(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const list = v => { const seen = new Set(), out = []; for (const s of Array.isArray(v) ? v : []) { const n = cut(s, NAME_MAX), k = siteKey(n); if (n && !seen.has(k) && out.length < SITE_MAX) { seen.add(k); out.push(n); } } return out; };
  const order = list(raw.order), hiddenKeys = new Set(order.map(siteKey));
  const hidden = list(raw.hidden).filter(n => !hiddenKeys.has(siteKey(n)));
  return {order, hidden, at:typeof raw.at === 'string' ? raw.at.slice(0, 40) : ''};
}
// rows: 바탕 사업장 줄 [{index, org}] (순서 = 바탕 순서). 반환 {shown:[줄], hidden:[줄]} — shown은 구성 순서(order에 든 것 먼저, 나머지는 바탕 순서).
export function arrangeSites(rows, layout) {
  const l = readSiteLayout(layout) ?? {order:[], hidden:[]};
  const off = new Set(l.hidden.map(siteKey)), rank = new Map(l.order.map((n, i) => [siteKey(n), i]));
  const shown = [], hidden = [];
  for (const row of rows) (off.has(siteKey(row.org)) ? hidden : shown).push(row);
  const pos = r => (rank.has(siteKey(r.org)) ? rank.get(siteKey(r.org)) : Infinity);
  shown.sort((a, b) => pos(a) - pos(b) || a.index - b.index);
  return {shown, hidden};
}
// 바탕에 없지만 구성(order)에 든 사업장 이름 — 이번 주 바탕에 빈 칸으로 더한다(내 담당 조직 목록에 있는 이름만).
export function missingSites(rows, layout, mine) {
  const l = readSiteLayout(layout);
  if (!l) return [];
  const have = new Set(rows.map(r => siteKey(r.org))), allowed = new Map((mine ?? []).map(n => [siteKey(n), n]));
  return l.order.filter(n => !have.has(siteKey(n)) && allowed.has(siteKey(n))).map(n => allowed.get(siteKey(n)));
}
const layoutOf = (shownNames, hiddenNames, at) => ({order:shownNames, hidden:hiddenNames, at});
// 빼기: 보이는 순서를 그대로 적고 그 이름을 hidden에.
export function siteHidden(rows, layout, name, at = '') {
  const {shown, hidden} = arrangeSites(rows, layout), k = siteKey(name);
  return layoutOf(shown.filter(r => siteKey(r.org) !== k).map(r => r.org), [...hidden.map(r => r.org), ...shown.filter(r => siteKey(r.org) === k).map(r => r.org)], at);
}
// 넣기(되돌리기·[+ 사업장 추가]): 맨 아래에(되돌리기는 index로 원래 자리에).
export function siteShown(rows, layout, name, at = '', index = Infinity) {
  const {shown, hidden} = arrangeSites(rows, layout), k = siteKey(name);
  const names = shown.map(r => r.org).filter(n => siteKey(n) !== k);
  names.splice(Math.max(0, Math.min(index, names.length)), 0, one(name));
  return layoutOf(names, hidden.map(r => r.org).filter(n => siteKey(n) !== k), at);
}
export function siteMoved(rows, layout, name, index, at = '') {
  const {shown, hidden} = arrangeSites(rows, layout), k = siteKey(name);
  const names = shown.map(r => r.org), from = names.findIndex(n => siteKey(n) === k);
  if (from < 0) return readSiteLayout(layout);
  const [n] = names.splice(from, 1);
  names.splice(Math.max(0, Math.min(index, names.length)), 0, n);
  return layoutOf(names, hidden.map(r => r.org), at);
}
// 한글 파일 표: 바탕 sites(assembleDraft 뒤)에서 들어간 사업장만, 구성 순서로. sites[i]는 rows[i]와 같은 자리.
export function layoutSiteData(sites, rows, layout) {
  const {shown} = arrangeSites(rows, layout);
  return shown.map(r => sites[r.index]).filter(Boolean);
}
