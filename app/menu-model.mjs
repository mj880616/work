// MENU-HOME-편집: 메뉴 목록의 유일한 정의. PC 왼쪽 메뉴·폰 하단바·폰 [메뉴] 창이 모두 여기서 읽는다.
// DOM·네트워크 없음. 화면 쪽(menu-layout.js)은 이 모듈이 돌려주는 순서대로 그리기만 한다.
//
// 규칙(명진 요청 2026-10-27 15:35)
// - 하단바는 [메뉴] 칸을 빼고 5칸까지이고 맨 앞 [홈]은 고정이다(옮기거나 뺄 수 없다).
// - 하단바 칸에 없는 메뉴는 폰 [메뉴] 창 안에 있고, PC 왼쪽 메뉴는 하단바 칸 메뉴가 위, 나머지가 그 아래 같은 순서다.
// - 순서는 서버(view_prefs.menu_layout = {bar, rest})에 둔다(아래 칸은 rest 안 'bottom' 표시 뒤, MENU-세칸). 모르는 항목 이름은 버리고, 빠진 항목은 기본 자리에 다시 붙여
//   나중에 메뉴가 늘어도 저장된 순서가 깨지지 않는다.

// view: 라우터 화면 이름(없으면 note처럼 정리함 노트 쪽). group: 이 메뉴가 대표하는 화면들(일정 = 달력·할 일·일기).
// HOME-업무일지홈: [홈]은 업무일지 화면이다(라우터 이름 home, 옛 이름 journal은 라우터 별칭). 그래서 [일정] 묶음에 업무일지가 없다.
// icon: 24칸 선 그림 한 줄(폰 하단바·[메뉴] 창이 같이 쓴다). pc: PC 왼쪽 메뉴에서 이 항목 밑에 같이 따라오는 작은 메뉴 이름.
export const ITEMS = Object.freeze([
  {id: 'home', label: '홈', view: 'home', icon: 'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9'},
  {id: 'basket', label: '정리함', view: 'basket', icon: 'M3 10h18l-2 10H5zM8 10l3-6m5 6-3-6M9 14v3m6-3v3'},
  {id: 'calendar', label: '일정', view: 'calendar', group: ['calendar', 'tasks', 'diary'], icon: 'M5 5h14v16H5zM8 3v4m8-4v4M5 10h14', pc: ['tasks', 'diary']},
  {id: 'note', label: '노트', kind: 'note', icon: 'M4 20l1-4L16 5l3 3L8 19zM14 7l3 3'},
  // MTG-프로젝트합치기 3단계: [프로젝트] 메뉴는 없다. 사업영역 관리 화면(라우터 이름 projects)은 사업 보고 ⋯ 안에서 열고, 하단바·왼쪽 메뉴에서는 사업 보고 칸이 그 화면을 맡는다.
  {id: 'meetings', label: '사업 보고', view: 'meetings', group: ['meetings', 'projects'], icon: 'M4 5h16v11H9l-5 4z'},
  {id: 'library', label: '자료실', view: 'library', icon: 'M4 4h16v5H4zM5 9v11h14V9M10 13h4'},
  {id: 'pages', label: '공유 페이지', view: 'pages', icon: 'M4 4h16v16H4zM4 10h16M10 10v10'},
  {id: 'team', label: '담당조직', view: 'team', icon: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 9v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 4v2'},
  {id: 'hwp', label: 'HWP 편집', view: 'hwp', icon: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7'},
  {id: 'ledger', label: '원장', view: 'ledger', icon: 'M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2zM9 8h6M9 12h6M9 16h4'},
  {id: 'photos', label: '사진', view: 'photos', icon: 'M3 6h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 9.5h.01'},
  // OUTSIDE-바깥성명 ④: [바깥 성명]은 처음 자리가 위 메뉴 끝(사진 다음, 설계 docs/design/outside-statements.md 4절).
  {id: 'outside', label: '바깥 성명', view: 'outside', icon: 'M4 5h11v14H4zM15 8h5v9a2 2 0 0 1-2 2h-3M7 9h5M7 12h5M7 15h3'},
  {id: 'calls', label: '통화', view: 'calls', feed: true, icon: 'M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 6a2 2 0 0 1 2-2z'},
  {id: 'telegram', label: '텔레그램 소식', view: 'telegram', feed: true, icon: 'M21 4 3 11l6 2 2 6 3-4 5 4z'},
  // 주소 개편 ② E1: [아스날]은 처음 자리가 [메뉴] 창 맨 아래(PC 사이드바도 맨 아래 묶음 끝, feed와 같은 자리). 메뉴 편집으로 옮길 수 있다.
  {id: 'arsenal', label: '아스날', view: 'arsenal', feed: true, icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7l3.5 2.5-1.3 4h-4.4l-1.3-4zM12 3v4m3.5 2.5 4.6-1.5m-5.9 5.5 2.8 3.8m-7.2-3.8L7 17.3m1.5-7.8L3.9 8'}
]);
export const MENU_ICON = 'M4 6h16M4 12h16M4 18h16';
export const FIXED_ID = 'home';
// 하단바 칸 수(홈 포함, [메뉴] 칸 제외). DB 검사는 여유를 두고 6개까지 받는다(view-prefs.js MENU_BAR_MAX).
export const BAR_MAX = 5;
// MENU-세칸(명진 요청 2026-10-30 10:19): 메뉴는 세 칸이다. bar = 폰 하단바, rest = 위 메뉴(폰 [메뉴] 창 · PC 왼쪽 위),
// tail = 아래 붙는 메뉴(PC 왼쪽 맨 아래 · 폰 [메뉴] 창 맨 아래 선 아래). 어느 메뉴든 세 칸 사이를 옮길 수 있다.
export const DEFAULT_BAR = Object.freeze(['home', 'basket', 'calendar', 'meetings', 'team']);
export const DEFAULT_REST = Object.freeze(['note', 'library', 'hwp', 'pages', 'ledger', 'photos', 'outside']);
export const DEFAULT_TAIL = Object.freeze(['calls', 'telegram', 'arsenal']);
// 서버 저장 모양은 그대로 {bar, rest}(DB 검사가 다른 칸 이름을 받지 않는다). 아래 칸은 rest 안 이 표시 뒤에 이어 담는다:
// rest = [...위 메뉴, 'bottom', ...아래 칸]. 이 표시가 없는 옛 저장값은 rest 끝에 이어진 통화·텔레그램·아스날(feed)을 아래 칸으로 읽어
// 지금까지 보이던 모양 그대로 옮겨 담는다. 'bottom'은 메뉴 항목 이름이 아니라서 옛 화면은 그냥 버리고 읽는다.
export const TAIL_MARK = 'bottom';
const KNOWN = new Map(ITEMS.map(item => [item.id, item]));
export const itemOf = id => KNOWN.get(id) || null;
export const labelOf = id => KNOWN.get(id)?.label || '';
export const defaultLayout = () => ({bar: [...DEFAULT_BAR], rest: [...DEFAULT_REST], tail: [...DEFAULT_TAIL]});

const known = list => Array.isArray(list) ? list.filter(id => typeof id === 'string' && KNOWN.has(id)) : [];
const unique = list => [...new Set(list)];

// 저장된 값(또는 아무 값) → 언제나 올바른 {bar, rest, tail}. 홈은 맨 앞 고정, 하단바는 BAR_MAX칸까지(넘친 칸은 위 메뉴 맨 앞으로),
// 모르는 이름·겹친 이름은 버리고 빠진 항목은 기본 자리의 칸(위 메뉴 또는 아래 칸) 끝에 붙인다.
export function normalizeLayout(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultLayout();
  let rawRest = Array.isArray(raw.rest) ? raw.rest : [], rawTail = Array.isArray(raw.tail) ? raw.tail : null;
  const mark = rawRest.indexOf(TAIL_MARK);
  if (!rawTail && mark >= 0) { rawTail = rawRest.slice(mark + 1); rawRest = rawRest.slice(0, mark); }
  if (!known(raw.bar).length && !known(rawRest).length && !known(rawTail).length) return defaultLayout();
  let bar = unique(known(raw.bar)).filter(id => id !== FIXED_ID);
  const inBar = new Set(bar);
  const rest = unique(known(rawRest)).filter(id => id !== FIXED_ID && !inBar.has(id));
  const room = BAR_MAX - 1;
  const spill = bar.slice(room);
  bar = bar.slice(0, room);
  if (!rawTail) {
    // 옛 저장값({bar, rest}만): 지금까지처럼 빠진 항목을 rest 끝에 붙이고, 끝에 이어진 feed 메뉴를 아래 칸으로 읽는다.
    // 그때 없던 항목은 기본 자리 칸으로: 아래 칸 기본(feed) 메뉴는 끝에 이어진 feed 묶음 뒤, 나머지(예: 바깥 성명)는 그 앞 위 메뉴 끝.
    const have = new Set([FIXED_ID, ...bar, ...spill, ...rest]);
    const listed = [...spill, ...rest], missing = ITEMS.map(item => item.id).filter(id => !have.has(id));
    let end = listed.length;
    while (end > 0 && KNOWN.get(listed[end - 1])?.feed) end--;
    return {bar: [FIXED_ID, ...bar], rest: [...listed.slice(0, end), ...missing.filter(id => !DEFAULT_TAIL.includes(id))], tail: [...listed.slice(end), ...missing.filter(id => DEFAULT_TAIL.includes(id))]};
  }
  const inRest = new Set(rest);
  const tail = unique(known(rawTail)).filter(id => id !== FIXED_ID && !inBar.has(id) && !inRest.has(id));
  const have = new Set([FIXED_ID, ...bar, ...spill, ...rest, ...tail]);
  const missing = ITEMS.map(item => item.id).filter(id => !have.has(id));
  // 빠진 항목은 기본에서 하단바 칸이던 것도 위 메뉴에 둔다: 사용자가 고른 하단바를 새 항목이 밀어내지 않게.
  return {bar: [FIXED_ID, ...bar], rest: [...spill, ...rest, ...missing.filter(id => !DEFAULT_TAIL.includes(id))], tail: [...tail, ...missing.filter(id => DEFAULT_TAIL.includes(id))]};
}
const sameList = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);
export const sameLayout = (a, b) => sameList(a.bar, b.bar) && sameList(a.rest, b.rest) && sameList(a.tail || [], b.tail || []);
export const isDefaultLayout = layout => sameLayout(normalizeLayout(layout), defaultLayout());
// 서버에 둘 값: 기본과 같으면 null(칸을 비운다 = 처음대로), 아니면 {bar, rest: [...위 메뉴, 'bottom', ...아래 칸]}.
// 아래 칸이 비어도 표시는 남겨 '아래 칸 없음'을 그대로 저장한다.
export const layoutToPrefs = layout => {
  const next = normalizeLayout(layout);
  return sameLayout(next, defaultLayout()) ? null : {bar: [...next.bar], rest: [...next.rest, TAIL_MARK, ...next.tail]};
};

export const LISTS = Object.freeze(['bar', 'rest', 'tail']);
// id를 to('bar'|'rest'|'tail')의 index 자리로 옮긴다. 홈은 옮길 수 없고, 하단바가 가득 차면 거절한다(reason 'full').
// index는 그 칸 안에서의 자리(옮기는 항목을 뺀 목록 기준). 하단바의 0번은 홈 자리라 1 아래로는 못 들어간다.
export function moveItem(layout, id, to, index) {
  const base = normalizeLayout(layout);
  if (!KNOWN.has(id) || !LISTS.includes(to)) return {ok: false, reason: 'unknown', layout: base};
  if (id === FIXED_ID) return {ok: false, reason: 'fixed', layout: base};
  const next = {bar: base.bar.filter(x => x !== id), rest: base.rest.filter(x => x !== id), tail: base.tail.filter(x => x !== id)};
  const target = next[to];
  if (to === 'bar' && target.length >= BAR_MAX) return {ok: false, reason: 'full', layout: base};
  const floor = to === 'bar' ? 1 : 0;
  const at = Math.max(floor, Math.min(Number.isFinite(index) ? Math.trunc(index) : target.length, target.length));
  target.splice(at, 0, id);
  return {ok: true, reason: '', layout: next, changed: !sameLayout(next, base)};
}
// 키보드: 위(-1)·아래(+1) 한 칸. 칸 끝에서는 다음 칸 맨 위(아래로) 또는 앞 칸 맨 아래(위로)로 넘어간다: 하단바 ↔ 위 메뉴 ↔ 아래 칸.
export function stepItem(layout, id, dir) {
  const base = normalizeLayout(layout);
  if (id === FIXED_ID || !KNOWN.has(id) || (dir !== -1 && dir !== 1)) return {ok: false, reason: id === FIXED_ID ? 'fixed' : 'unknown', layout: base};
  const li = LISTS.findIndex(name => base[name].includes(id));
  if (li < 0) return {ok: false, reason: 'unknown', layout: base};
  const name = LISTS[li], list = base[name], at = list.indexOf(id), floor = name === 'bar' ? 1 : 0;
  if (dir === -1) {
    if (at > floor) return moveItem(base, id, name, at - 1);
    return li > 0 ? moveItem(base, id, LISTS[li - 1], base[LISTS[li - 1]].length) : {ok: false, reason: 'edge', layout: base};
  }
  if (at < list.length - 1) return moveItem(base, id, name, at + 1);
  return li < LISTS.length - 1 ? moveItem(base, id, LISTS[li + 1], 0) : {ok: false, reason: 'edge', layout: base};
}

// PC 왼쪽 메뉴 순서: 하단바 칸 메뉴가 위, 그 아래 위 메뉴, 맨 아래 묶음은 아래 칸.
// 한 번도 바꾸지 않았으면(기본) 지금까지의 PC 순서(ITEMS 순서)를 그대로 둔다. 바꾼 뒤부터 하단바 칸이 위로 올라온다.
export const pcOrder = layout => { const next = normalizeLayout(layout); return sameLayout(next, defaultLayout()) ? ITEMS.map(item => item.id) : [...next.bar, ...next.rest, ...next.tail]; };
// PC 왼쪽 메뉴의 위 줄(main)과 빈 공간 아래 맨 아래 묶음(tail). 맨 아래 묶음은 저장된 아래 칸 그대로이고, 비면 묶음도 없다.
export function pcSplit(layout) {
  const next = normalizeLayout(layout), tail = [...next.tail];
  const main = sameLayout(next, defaultLayout()) ? ITEMS.map(item => item.id).filter(id => !tail.includes(id)) : [...next.bar, ...next.rest];
  return {main, tail};
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
