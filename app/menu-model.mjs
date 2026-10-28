// MENU-HOME-편집: 메뉴 목록의 유일한 정의. PC 왼쪽 메뉴·폰 하단바·폰 [메뉴] 창이 모두 여기서 읽는다.
// DOM·네트워크 없음. 화면 쪽(menu-layout.js)은 이 모듈이 돌려주는 순서대로 그리기만 한다.
//
// 규칙(명진 요청 2026-10-27 15:35)
// - 하단바는 [메뉴] 칸을 빼고 5칸까지이고 맨 앞 [홈]은 고정이다(옮기거나 뺄 수 없다).
// - 하단바 칸에 없는 메뉴는 폰 [메뉴] 창 안에 있고, PC 왼쪽 메뉴는 하단바 칸 메뉴가 위, 나머지가 그 아래 같은 순서다.
// - 순서는 서버(view_prefs.menu_layout = {bar, rest})에 둔다. 모르는 항목 이름은 버리고, 빠진 항목은 기본 자리에 다시 붙여
//   나중에 메뉴가 늘어도 저장된 순서가 깨지지 않는다.

// view: 라우터 화면 이름(없으면 note처럼 정리함 노트 쪽). group: 이 메뉴가 대표하는 화면들(일정 = 달력·할 일·업무일지·일기).
// icon: 24칸 선 그림 한 줄(폰 하단바·[메뉴] 창이 같이 쓴다). pc: PC 왼쪽 메뉴에서 이 항목 밑에 같이 따라오는 작은 메뉴 이름.
export const ITEMS = Object.freeze([
  {id: 'home', label: '홈', view: 'home', icon: 'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9'},
  {id: 'basket', label: '정리함', view: 'basket', icon: 'M3 10h18l-2 10H5zM8 10l3-6m5 6-3-6M9 14v3m6-3v3', pc: ['pane:update', 'pane:todo']},
  {id: 'calendar', label: '일정', view: 'calendar', group: ['calendar', 'tasks', 'journal', 'diary'], icon: 'M5 5h14v16H5zM8 3v4m8-4v4M5 10h14', pc: ['tasks', 'journal', 'diary']},
  {id: 'note', label: '노트', kind: 'note', icon: 'M4 20l1-4L16 5l3 3L8 19zM14 7l3 3'},
  {id: 'projects', label: '프로젝트', view: 'projects', icon: 'M3 7h7l2 2h9v12H3zM3 7V4h7l2 3'},
  {id: 'meetings', label: '사업 보고', view: 'meetings', icon: 'M4 5h16v11H9l-5 4z'},
  {id: 'library', label: '자료실', view: 'library', icon: 'M4 4h16v5H4zM5 9v11h14V9M10 13h4'},
  {id: 'pages', label: '공유 페이지', view: 'pages', icon: 'M4 4h16v16H4zM4 10h16M10 10v10'},
  {id: 'team', label: '담당조직', view: 'team', icon: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 9v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 4v2'},
  {id: 'hwp', label: 'HWP 편집', view: 'hwp', icon: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7'},
  {id: 'ledger', label: '원장', view: 'ledger', icon: 'M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2zM9 8h6M9 12h6M9 16h4'},
  {id: 'photos', label: '사진', view: 'photos', icon: 'M3 6h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 9.5h.01'},
  {id: 'calls', label: '통화', view: 'calls', feed: true, icon: 'M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 6a2 2 0 0 1 2-2z'},
  {id: 'telegram', label: '텔레그램 소식', view: 'telegram', feed: true, icon: 'M21 4 3 11l6 2 2 6 3-4 5 4z'},
  // 주소 개편 ② E1: [아스날]은 처음 자리가 [메뉴] 창 맨 아래(PC 사이드바도 맨 아래 묶음 끝, feed와 같은 자리). 메뉴 편집으로 옮길 수 있다.
  {id: 'arsenal', label: '아스날', view: 'arsenal', feed: true, icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7l3.5 2.5-1.3 4h-4.4l-1.3-4zM12 3v4m3.5 2.5 4.6-1.5m-5.9 5.5 2.8 3.8m-7.2-3.8L7 17.3m1.5-7.8L3.9 8'}
]);
export const MENU_ICON = 'M4 6h16M4 12h16M4 18h16';
export const FIXED_ID = 'home';
// 하단바 칸 수(홈 포함, [메뉴] 칸 제외). DB 검사는 여유를 두고 6개까지 받는다(view-prefs.js MENU_BAR_MAX).
export const BAR_MAX = 5;
export const DEFAULT_BAR = Object.freeze(['home', 'basket', 'calendar', 'projects', 'team']);
export const DEFAULT_REST = Object.freeze(['note', 'meetings', 'library', 'hwp', 'pages', 'ledger', 'photos', 'calls', 'telegram', 'arsenal']);
const KNOWN = new Map(ITEMS.map(item => [item.id, item]));
export const itemOf = id => KNOWN.get(id) || null;
export const labelOf = id => KNOWN.get(id)?.label || '';
export const defaultLayout = () => ({bar: [...DEFAULT_BAR], rest: [...DEFAULT_REST]});

const known = list => Array.isArray(list) ? list.filter(id => typeof id === 'string' && KNOWN.has(id)) : [];
const unique = list => [...new Set(list)];

// 저장된 값(또는 아무 값) → 언제나 올바른 {bar, rest}. 홈은 맨 앞 고정, 하단바는 BAR_MAX칸까지(넘친 칸은 [메뉴] 쪽 맨 앞으로),
// 모르는 이름·겹친 이름은 버리고 빠진 항목은 기본 순서대로 [메뉴] 쪽 끝에 붙인다.
export function normalizeLayout(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultLayout();
  if (!known(raw.bar).length && !known(raw.rest).length) return defaultLayout();
  let bar = unique(known(raw.bar)).filter(id => id !== FIXED_ID);
  const inBar = new Set(bar);
  const rest = unique(known(raw.rest)).filter(id => id !== FIXED_ID && !inBar.has(id));
  const room = BAR_MAX - 1;
  const spill = bar.slice(room);
  bar = bar.slice(0, room);
  const have = new Set([FIXED_ID, ...bar, ...spill, ...rest]);
  const missing = ITEMS.map(item => item.id).filter(id => !have.has(id));
  // 빠진 항목은 기본에서 하단바 칸이던 것도 [메뉴] 쪽에 둔다: 사용자가 고른 하단바를 새 항목이 밀어내지 않게.
  return {bar: [FIXED_ID, ...bar], rest: [...spill, ...rest, ...missing]};
}
export const sameLayout = (a, b) => a.bar.length === b.bar.length && a.rest.length === b.rest.length
  && a.bar.every((id, i) => id === b.bar[i]) && a.rest.every((id, i) => id === b.rest[i]);
export const isDefaultLayout = layout => sameLayout(normalizeLayout(layout), defaultLayout());
// 서버에 둘 값: 기본과 같으면 null(칸을 비운다 = 처음대로), 아니면 {bar, rest}.
export const layoutToPrefs = layout => {
  const next = normalizeLayout(layout);
  return sameLayout(next, defaultLayout()) ? null : {bar: [...next.bar], rest: [...next.rest]};
};

// id를 to('bar'|'rest')의 index 자리로 옮긴다. 홈은 옮길 수 없고, 하단바가 가득 차면 거절한다(reason 'full').
// index는 그 칸 안에서의 자리(옮기는 항목을 뺀 목록 기준). 하단바의 0번은 홈 자리라 1 아래로는 못 들어간다.
export function moveItem(layout, id, to, index) {
  const base = normalizeLayout(layout);
  if (!KNOWN.has(id) || (to !== 'bar' && to !== 'rest')) return {ok: false, reason: 'unknown', layout: base};
  if (id === FIXED_ID) return {ok: false, reason: 'fixed', layout: base};
  const bar = base.bar.filter(x => x !== id), rest = base.rest.filter(x => x !== id);
  const target = to === 'bar' ? bar : rest;
  if (to === 'bar' && bar.length >= BAR_MAX) return {ok: false, reason: 'full', layout: base};
  const floor = to === 'bar' ? 1 : 0;
  const at = Math.max(floor, Math.min(Number.isFinite(index) ? Math.trunc(index) : target.length, target.length));
  target.splice(at, 0, id);
  const next = {bar, rest};
  return {ok: true, reason: '', layout: next, changed: !sameLayout(next, base)};
}
// 키보드: 위(-1)·아래(+1) 한 칸. 하단바 맨 아래에서 아래로 가면 [메뉴] 쪽 맨 위, [메뉴] 쪽 맨 위에서 위로 가면 하단바 맨 아래.
export function stepItem(layout, id, dir) {
  const base = normalizeLayout(layout);
  if (id === FIXED_ID || !KNOWN.has(id) || (dir !== -1 && dir !== 1)) return {ok: false, reason: id === FIXED_ID ? 'fixed' : 'unknown', layout: base};
  const inBar = base.bar.indexOf(id);
  if (inBar > 0) {
    if (dir === -1) return inBar > 1 ? moveItem(base, id, 'bar', inBar - 1) : {ok: false, reason: 'edge', layout: base};
    return inBar < base.bar.length - 1 ? moveItem(base, id, 'bar', inBar + 1) : moveItem(base, id, 'rest', 0);
  }
  const at = base.rest.indexOf(id);
  if (at < 0) return {ok: false, reason: 'unknown', layout: base};
  if (dir === 1) return at < base.rest.length - 1 ? moveItem(base, id, 'rest', at + 1) : {ok: false, reason: 'edge', layout: base};
  return at > 0 ? moveItem(base, id, 'rest', at - 1) : moveItem(base, id, 'bar', base.bar.length);
}

// PC 왼쪽 메뉴 순서: 하단바 칸 메뉴가 위, 나머지가 그 아래 같은 순서.
// 한 번도 바꾸지 않았으면(기본) 지금까지의 PC 순서(ITEMS 순서)를 그대로 둔다. 바꾼 뒤부터 하단바 칸이 위로 올라온다.
export const pcOrder = layout => { const next = normalizeLayout(layout); return sameLayout(next, defaultLayout()) ? ITEMS.map(item => item.id) : [...next.bar, ...next.rest]; };
// PC 왼쪽 메뉴에서 맨 끝 아래쪽 칸(통화·텔레그램)은 끝에 이어진 만큼만 아래에 붙는다. 그 위로 옮긴 것은 보통 줄이 된다.
export function pcSplit(layout) {
  const order = pcOrder(layout);
  let end = order.length;
  while (end > 0 && KNOWN.get(order[end - 1])?.feed) end--;
  return {main: order.slice(0, end), tail: order.slice(end)};
}
// 761~1023px 한 줄 메뉴가 쓰는 키 순서(정리함 아래 [업데이트]·[챙길 것], 일정 아래 [할 일]·[업무일지]·[일기]가 따라온다).
export function midKeys(layout) {
  return pcOrder(layout).flatMap(id => { const item = KNOWN.get(id); return [id, ...(item?.pc || [])]; });
}
// 폰 하단바에서 이 화면이 어느 칸의 것인가. 칸 이름은 항목 id. 하단바에 없는 화면은 null([메뉴] 칸이 지금 화면).
export function barItemForView(layout, view, noteMode = false) {
  const bar = normalizeLayout(layout).bar;
  if (noteMode) return bar.includes('note') ? 'note' : null;
  for (const id of bar) {
    const item = KNOWN.get(id);
    if (id === 'note') continue;
    if (item.view === view || item.group?.includes(view)) return id;
  }
  return null;
}
// 하단바에 칸이 없어 [메뉴] 칸이 지금 화면이 되는 화면 이름들.
export function menuSheetViews(layout) {
  const bar = new Set(normalizeLayout(layout).bar);
  return ITEMS.filter(item => !bar.has(item.id) && item.view).flatMap(item => item.group || [item.view]);
}
