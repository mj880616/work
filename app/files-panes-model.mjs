// FILES-통합 2-③ 두 칸(S49-30, 설계 docs/design/files-unified-plan.md D-3·D-4·J절 H-2, 시안 files-unified-mockup.html ⑥⑧): 화면 없이 시험하는 계산.
// - 두 칸 켬은 서버 view_prefs.files_two에 기기 종류별로 둔다(files_sources와 같은 모양: {app?: {...}, phone?: {...}, pc?: {...}}, migration 20261104190000).
//   기기 칸 안은 화면 폭 종류마다 참·거짓: fold = 폴드 펼침(600~1199, 공용 판정 screen-width.mjs), wide = PC(1200~). 칸이 없으면 기본값 — 한 칸(왼쪽 나무 + 오른쪽 목록). S50-33(명진 결정, 시안 승인): 폴드 펼침도 PC처럼 한 칸이 기본(H-2의 '폴드 기본 두 칸'을 바꿈). [두 칸 보기]로 켠 값은 그대로 기억.
// - 폰(600px 미만)은 기본 한 칸, [두 칸 보기]로 켜면 위·아래 두 칸(S51-20 ②).
export const FILES_TWO_KEY = 'files_two';
// S51-20 ②(시안 files-phone-grid-two-drag.html ②): 폰(600px 미만)도 [두 칸 보기] — 위·아래 두 칸. 켬은 narrow 칸(migration 20261106200000, 기본 한 칸).
export const FILES_TWO_LAYOUTS = Object.freeze(['fold', 'wide', 'narrow']);
export const FILES_TWO_DEFAULT = Object.freeze({fold: false, wide: false, narrow: false});
// 폭 종류. wide = 1200 이상인가, narrow = 폰 한 칸 폭(600px 미만)인가.
export const twoLayout = (wide, narrow = false) => (wide ? 'wide' : narrow ? 'narrow' : 'fold');
// 서버 값(이 기기 칸) → 이 폭에서 두 칸인가. 모양이 틀리면 기본값.
export function twoOn(devValue, layout) {
  if (!FILES_TWO_LAYOUTS.includes(layout)) return false;
  const v = devValue && typeof devValue === 'object' && !Array.isArray(devValue) ? devValue[layout] : undefined;
  return typeof v === 'boolean' ? v : FILES_TWO_DEFAULT[layout];
}
// 이 폭의 켬을 바꾼 이 기기 칸 값(다른 폭 칸은 아는 것만 그대로 둔다).
export function twoValue(devValue, layout, on) {
  const out = {};
  for (const k of FILES_TWO_LAYOUTS) if (devValue && typeof devValue[k] === 'boolean') out[k] = devValue[k];
  if (FILES_TWO_LAYOUTS.includes(layout)) out[layout] = !!on;
  return out;
}
export const PANE_SIDE = Object.freeze(['왼쪽', '오른쪽']);
export const PANE_SIDE_VERT = Object.freeze(['위', '아래']);
// 칸 이름. vert = 폰 위·아래 두 칸.
export const paneSide = (i, vert = false) => (vert ? PANE_SIDE_VERT : PANE_SIDE)[i === 1 ? 1 : 0];
// 고르기 막대 동작 이름: 받을 곳 = 반대 칸. 왼쪽 칸에서 고르면 '→ 오른쪽에 복사', 오른쪽 칸이면 '← 왼쪽에 복사'. 폰 위·아래면 '↓ 아래에 복사' · '↑ 위에 복사'.
export function sendLabel(i, mode, vert = false) {
  const arrow = vert ? (i === 1 ? '↑' : '↓') : i === 1 ? '←' : '→';
  return mode === 'move' ? `${arrow} 옮기기` : `${arrow} ${paneSide(i === 1 ? 0 : 1, vert)}에 복사`;
}
// 반대 칸이 받을 수 있는 곳(폴더를 연 칸, 찾는 중·묶음 아님). 없으면 null.
export function paneDest(pane) {
  const w = pane?.where;
  return w?.source && !pane.query ? {source: w.source, parent: w.parent ?? null} : null;
}
// 두 칸을 처음 켤 때 오른쪽 칸의 첫 위치: 왼쪽과 다른 켜진 저장소의 맨 위(없으면 같은 저장소 맨 위).
export function otherStart(leftWhere, on) {
  const list = Array.isArray(on) ? on : [];
  if (!list.length) return null;
  const src = leftWhere?.source || '';
  return {source: list.find(s => s !== src) || list[0], parent: null};
}
// 끌어 놓기 받을 곳 묻기 글자(시안 ⑥ drop-hint).
export const DROP_ASK_TEXT = '여기에 놓으면';

// S52-07 FILES-칸출처고르기(명진 결정 11/07: 칸 머리 '원드라이브 ▾' 이름 → 목록, 고른 출처는 서버에 기억; 시안 morning-1107/4-files-pane-source.html 1-A).
// - 서버 view_prefs.files_panes = {app?|phone?|pc?: [첫 칸(왼쪽·위) 출처, 둘째 칸(오른쪽·아래) 출처]}(migration 20261107110000). 폴더 위치는 넣지 않는다(고르면 그 출처 맨 위).
// - 적용 전에는 서버가 거절(400)해 값이 되돌아간다 — 칸은 그 자리에서만 바뀐다(기기 저장 없음).
export const FILES_PANES_KEY = 'files_panes';
export const PANE_SOURCES = Object.freeze(['od', 'gd', 'ph', 'pc']);
const PANE_NAME = Object.freeze({od: '원드라이브', gd: '구글 드라이브', ph: '이 폰', pc: '내 PC'});
// 서버 값(이 기기 칸) → [첫 칸, 둘째 칸] 또는 null(모양이 틀리면 없는 것으로).
export function panesSaved(devValue) {
  return Array.isArray(devValue) && devValue.length === 2 && devValue.every(s => PANE_SOURCES.includes(s)) ? [devValue[0], devValue[1]] : null;
}
// 칸 i에서 src를 고른 뒤 이 기기 칸에 쓸 값. 반대 칸은 지금 보이는 출처(other) → 저장값 → src 차례로.
export function panesValue(devValue, i, src, other = '') {
  if (!PANE_SOURCES.includes(src)) return null;
  const saved = panesSaved(devValue), j = i === 1 ? 0 : 1;
  const out = [];
  out[i === 1 ? 1 : 0] = src;
  out[j] = PANE_SOURCES.includes(other) ? other : saved ? saved[j] : src;
  return out;
}
// 칸 i의 첫 위치. 고른 출처가 기억돼 있고 지금 켜져 있으면 그 맨 위. 아니면 지금 규칙: 칸 0 = 켜진 첫 출처, 칸 1 = 왼쪽과 다른 켜진 출처(otherStart).
export function paneStart(i, devValue, on, leftWhere = null) {
  const list = Array.isArray(on) ? on : [];
  if (!list.length) return null;
  const saved = panesSaved(devValue)?.[i === 1 ? 1 : 0];
  if (saved && list.includes(saved)) return {source: saved, parent: null};
  return i === 1 ? otherStart(leftWhere, list) : {source: list[0], parent: null};
}
// 칸 머리 목록 네 줄. 쓸 수 없는 출처는 흐리게 + 이유 한 줄(이 기기에서 못 씀 · 연결 안 됨 · 위 줄에서 끔).
// on = 지금 켜진 출처(files.js onSources), linked = 연결된 클라우드, phone = {usable, all}, pc = {usable, ok}, off = 위 줄에서 끈 출처.
export function paneChoices({cur = '', on = [], linked = [], phone = {}, pc = {}, off = []} = {}) {
  return PANE_SOURCES.map(src => {
    let why = '';
    if (src === 'ph') why = !phone.usable ? '폰 앱에서만' : !phone.all ? '파일 접근 허락 필요' : '';
    else if (src === 'pc') why = !pc.usable ? 'PC 브라우저에서만' : !pc.ok ? 'PC 앱이 켜졌을 때만' : '';
    else why = !linked.includes(src) ? '연결 안 됨' : '';
    if (!why && (off.includes(src) || !on.includes(src))) why = '위 줄에서 끔';
    return {src, name: PANE_NAME[src], cur: src === cur, usable: !why, why};
  });
}
// 칸 머리 단추 글자: 그 칸의 출처 이름(묶음·찾기·빈 칸이면 '출처').
export const paneSourceLabel = where => PANE_NAME[where?.source] || '출처';
