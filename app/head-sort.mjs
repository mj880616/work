// UI-머리눌러정렬(사용자 11/24 15:47 "이름, 바뀐날, 크기 종류 이런거 있으면 저걸 눌렀을 때 오름차순 내림차순 정렬 가능하게"):
// 머리 줄이 있는 목록의 공용 부품 하나 — 정렬 규칙(누르면 그 칸, 다시 누르면 반대) + 머리 칸 그리기 + 정렬 고르기(select) 값.
// 상태 주인은 화면의 정렬 값 하나({key, dir})다. 머리 칸과 정렬 고르기는 둘 다 그 값을 그리기만 하고, 바꿀 때는 nextSort·parseSortValue로 같은 값을 만든다.
// 기억은 화면이 서버 보기 설정(view_prefs)에 둔다(기기 저장 없음). 이 파일은 DOM 전역을 건드리지 않는다(bindHeadSort만 받은 요소에 듣기를 단다).
// 모양: 버튼은 6가지 중 '줄 안 동작'(row-act, app/ui-standard.css) — 화면 CSS는 배치(.hs-btn)만.
// 키보드: 머리 칸은 진짜 버튼 요소라 Enter·Space가 그대로 누르기다. 칸 너비 손잡이(col-resize.js gripHtml)는 버튼 밖 형제라 끌어도 정렬되지 않는다.
export const ASC = 'asc', DESC = 'desc';
export const DIRS = Object.freeze([ASC, DESC]);
export const validDir = v => v === DESC ? DESC : ASC;
// 처음 누를 때 방향: 날짜·크기는 큰 것(최근) 먼저가 자연스럽다(탐색기와 같음). 나머지는 가나다·작은 것 먼저.
export const firstDir = (key, descFirst = []) => descFirst.includes(key) ? DESC : ASC;
// 머리 칸을 눌렀을 때 다음 정렬: 같은 칸이면 방향만 뒤집고, 다른 칸이면 그 칸의 처음 방향.
export function nextSort(cur, key, {descFirst = []} = {}) {
  if (cur && cur.key === key) return {key, dir: cur.dir === DESC ? ASC : DESC};
  return {key, dir: firstDir(key, descFirst)};
}
export const ariaSort = (cur, key) => !cur || cur.key !== key ? 'none' : cur.dir === DESC ? 'descending' : 'ascending';
export const arrowOf = dir => dir === DESC ? '▼' : '▲';
// 한국어·숫자 자연 정렬(가짜 2 < 가짜 10). 이름 비교는 모두 이것 하나를 쓴다.
const COLLATOR = new Intl.Collator('ko', {numeric: true, sensitivity: 'base'});
export const naturalCompare = (a, b) => COLLATOR.compare(String(a ?? ''), String(b ?? ''));
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
/**
 * 머리 칸 하나. role=columnheader + aria-sort, 안에 누르는 버튼(글자 + 지금 기준이면 ▲/▼). extra = 버튼 밖에 붙일 것(칸 너비 손잡이).
 * @param {{key:string,label:string,cur?:{key:string,dir:string}|null,extra?:string,sortable?:boolean}} o
 */
export function headCellHtml({key, label, cur = null, extra = '', sortable = true}) {
  if (!sortable) return `<span role="columnheader">${esc(label)}${extra}</span>`;
  const on = !!cur && cur.key === key, arrow = on ? arrowOf(cur.dir) : '';
  const how = on ? (cur.dir === DESC ? '내림차순' : '오름차순') : '';
  return `<span role="columnheader" aria-sort="${ariaSort(cur, key)}" class="hs-cell${on ? ' hs-on' : ''}">`
    + `<button type="button" class="row-act hs-btn" data-head-sort="${esc(key)}" title="${esc(label)} 기준 정렬${how ? ` (지금 ${how})` : ''}">${esc(label)}<i class="hs-arrow" aria-hidden="true">${arrow}</i></button>${extra}</span>`;
}
// 정렬 고르기(select) 값: 'name:asc'처럼 칸과 방향을 함께 담아 머리 칸과 같은 값을 가진다.
export const sortValue = s => `${s.key}:${validDir(s.dir)}`;
export function parseSortValue(v, keys) {
  const [key, dir] = String(v || '').split(':');
  return keys.includes(key) && DIRS.includes(dir) ? {key, dir} : null;
}
// 정렬 고르기 보기 목록: 칸마다 ▲·▼ 두 줄(처음 방향을 먼저).
export function sortOptions(keys, names, {descFirst = []} = {}) {
  return keys.flatMap(key => {
    const first = firstDir(key, descFirst), dirs = first === DESC ? [DESC, ASC] : [ASC, DESC];
    return dirs.map(dir => ({value: sortValue({key, dir}), label: `${names[key] || key} ${arrowOf(dir)}`}));
  });
}
export function sortSelectHtml({keys, names, cur, label = '정렬', attrs = '', className = '', descFirst = []}) {
  const now = cur ? sortValue(cur) : '';
  return `<select class="${esc(className)}" ${attrs} aria-label="${esc(label)}">${sortOptions(keys, names, {descFirst}).map(o => `<option value="${esc(o.value)}"${o.value === now ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
}
// 서버에 기억한 정렬 값 → {key, dir} 또는 null(모양이 틀리면 믿지 않음).
export function cleanSort(v, keys) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  if (Object.keys(v).some(k => k !== 'key' && k !== 'dir')) return null;
  return keys.includes(v.key) && DIRS.includes(v.dir) ? {key: v.key, dir: v.dir} : null;
}
// 머리 칸 누르기 듣기(한 요소에 한 번만). onSort(key, button). 칸 너비 손잡이 누르기는 col-resize.js가 먼저 막는다.
export function bindHeadSort(host, onSort) {
  if (!host || host.dataset.headSortBound) return;
  host.dataset.headSortBound = '1';
  host.addEventListener('click', e => {
    const b = e.target.closest?.('[data-head-sort]');
    if (!b || !host.contains(b) || e.target.closest?.('[data-col-grip]')) return;
    e.preventDefault();
    onSort(b.dataset.headSort, b);
  });
}
