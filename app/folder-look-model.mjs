// FOLDER-순서·색 ② (S49-38, 설계 docs/design/folder-color-order.md): 폴더를 보여 주는 모든 화면이 함께 쓰는 순수 부분(화면·저장소·네트워크 없음, node --test로 시험).
// 이번 단계는 노트 폴더·노트가 쓰고, 다음 단계에서 자료실·[파일]·사진이 같은 함수를 부른다(같은 목적의 계산을 따로 만들지 않는다).
//  - 색: 1~8 번호만 DB에 적는다(null = 안 고른 폴더 = 지금 모양 그대로). 이름·색 값은 화면 쪽 한 곳(theme-tokens.css의 --ds-folder-N-*)이 정한다.
//  - 끌기 자리: 줄 높이 4등분. 위 25% = 앞, 가운데 50% = 안으로 넣기, 아래 25% = 뒤. (넣을 수 없는 줄은 위·아래 반씩.)
//  - 순서 값: 형제 사이에 끼울 값(간격 1024, 벌어진 틈이 없으면 그 형제 전체를 다시 매김)과 한 칸 위·아래.
export const ORDER_GAP = 1024;
export const COLOR_COUNT = 8;
// 이름은 고르기 창 동그라미의 이름표(툴팁·aria-label). 번호가 DB에 적히는 값이다.
export const FOLDER_COLORS = Object.freeze([
  {n: 1, name: '벽돌'}, {n: 2, name: '황토'}, {n: 3, name: '올리브'}, {n: 4, name: '청록'},
  {n: 5, name: '강청'}, {n: 6, name: '남보라'}, {n: 7, name: '자주'}, {n: 8, name: '회색'}
]);
export const isFolderColor = value => Number.isInteger(value) && value >= 1 && value <= COLOR_COUNT;
// 폴더 행 → 색 번호(없거나 틀린 값이면 null = 기본).
export const colorOf = row => (isFolderColor(row?.color) ? row.color : null);
export const colorName = n => FOLDER_COLORS.find(c => c.n === n)?.name || '기본';

// 줄 안에서 마우스·손가락 높이 y의 자리. rect = {top, height}. canInside=false면 위·아래 반씩.
export function dropZone(rect, y, {canInside = true} = {}) {
  const height = Number(rect?.height) || 0;
  if (height <= 0) return 'after';
  const ratio = (y - rect.top) / height;
  if (!canInside) return ratio < 0.5 ? 'before' : 'after';
  return ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside';
}

const finite = v => typeof v === 'number' && Number.isFinite(v);
const orderValue = v => (finite(v) ? v : Number(v) || 0);
// 같은 부모 안 형제를 순서(sort_order) → 만든 날 → id 로 줄 세운다.
export function orderedSiblings(list) {
  return [...list].sort((a, b) => orderValue(a.sort_order) - orderValue(b.sort_order)
    || String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id)));
}

// 끌어 놓기 계획. siblings = 놓을 칸 안의 줄들(이미 보이는 순서대로, 끌고 있는 줄이 있으면 그것 포함),
// movedId = 옮기는 줄, index = 끌고 있는 줄을 뺀 목록에서 놓을 자리(0 = 맨 앞).
// getOrder(row) = 지금 순서 값(없으면 null/undefined). 돌려주는 값: [{id, order}] — 새 값을 써야 하는 줄들(옮기는 줄이 반드시 들어 있다).
// 옆 두 줄 사이에 정수 틈이 있으면 옮기는 줄 하나만, 틈이 없거나 순서 값이 없는 줄이 있으면 칸 전체를 1024 간격으로 다시 매긴다.
export function placeAt(siblings, movedId, index, getOrder = row => row.sort_order) {
  const others = siblings.filter(row => row.id !== movedId);
  const at = Math.max(0, Math.min(others.length, Math.floor(Number(index)) || 0));
  const all = [...others.slice(0, at), {id: movedId, __moved: true}, ...others.slice(at)];
  const renumber = () => all.map((row, i) => ({id: row.id, order: (i + 1) * ORDER_GAP}));
  if (others.some(row => !finite(getOrder(row)))) return renumber();
  const prev = others[at - 1], next = others[at];
  if (!prev && !next) return [{id: movedId, order: ORDER_GAP}];
  if (!prev) return [{id: movedId, order: getOrder(next) - ORDER_GAP}];
  if (!next) return [{id: movedId, order: getOrder(prev) + ORDER_GAP}];
  const a = getOrder(prev), b = getOrder(next);
  if (b - a >= 2) return [{id: movedId, order: Math.floor((a + b) / 2)}];
  return renumber();
}
// 한 칸 위(-1)·아래(+1): 보이는 순서(siblings)에서 옆 줄을 넘어가는 자리로 placeAt. 맨 끝이면 빈 배열.
export function stepPlan(siblings, id, dir, getOrder = row => row.sort_order) {
  const i = siblings.findIndex(row => row.id === id), j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= siblings.length) return [];
  return placeAt(siblings, id, j, getOrder);
}
// 놓은 줄이 이미 그 자리인가(제자리 놓기는 저장하지 않는다). index = placeAt과 같은 뜻.
export const isSamePlace = (siblings, movedId, index) => {
  const i = siblings.findIndex(row => row.id === movedId);
  return i >= 0 && i === Math.max(0, Math.min(siblings.length - 1, Math.floor(Number(index)) || 0));
};

// ---- 노트 순서 (설계 3-3): 노트 행의 metadata.order(정수) 하나. 값이 없는 노트는 고친 날 순으로 뒤에 붙는다. ----
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export const NOTE_ORDER_MAX = 1e12;
export function noteOrderOf(note) {
  const v = plain(note?.metadata) ? note.metadata.order : undefined;
  return finite(v) && Number.isInteger(v) && Math.abs(v) <= NOTE_ORDER_MAX ? v : null;
}
export const isNoteOrder = v => finite(v) && Number.isInteger(v) && Math.abs(v) <= NOTE_ORDER_MAX;
// 고정 노트가 맨 위(pinnedAt(note) 참)는 기존 규칙 그대로, 안 고정은 내가 정한 순서 → 값 없는 노트(고친 날 최근 먼저).
export function sortNotesManual(notes, pinnedAt = () => null) {
  const time = value => Date.parse(value) || 0;
  return notes.slice().sort((a, b) => {
    const pa = pinnedAt(a), pb = pinnedAt(b);
    if (!!pa !== !!pb) return pa ? -1 : 1;
    if (pa) return time(pb) - time(pa) || String(b.id).localeCompare(String(a.id));
    const oa = noteOrderOf(a), ob = noteOrderOf(b);
    if (oa !== null && ob !== null) return oa - ob || String(a.id).localeCompare(String(b.id));
    if (oa !== null) return -1;
    if (ob !== null) return 1;
    return time(b.updated_at) - time(a.updated_at) || String(b.id).localeCompare(String(a.id));
  });
}
export const NOTE_SORTS = Object.freeze(['changed', 'manual']);
export const NOTE_SORT_NAMES = Object.freeze({changed: '고친 날', manual: '내가 정한 순서'});
export const isNoteSort = v => NOTE_SORTS.includes(v);

// ---- 칠한 폴더 그림(FOLDER-순서·색 ③): 노트·자료실·[파일]·사진 줄이 같은 그림을 쓴다. 열린 폴더는 앞판이 비스듬히 열린 모양. 색은 부모의 data-fc(--fl-ico)가 입힌다. ----
const SHAPE = {
  closed: '<path d="M1.5 4.2c0-.7.6-1.2 1.2-1.2h3.1c.4 0 .7.2.9.4l.8.9h5.8c.7 0 1.2.5 1.2 1.2v6.3c0 .7-.5 1.2-1.2 1.2H2.7c-.7 0-1.2-.5-1.2-1.2z"/>',
  open: '<path d="M1.5 4.2c0-.7.6-1.2 1.2-1.2h3.1c.4 0 .7.2.9.4l.8.9h4.8c.7 0 1.2.5 1.2 1.2v.9H3.6c-.6 0-1.1.4-1.3 1l-.8 3.9z"/><path d="M3.6 7.6h11.3c.5 0 .8.5.7 1l-1.1 4.4c-.1.5-.6.9-1.2.9H2.7c-.7 0-1.1-.5-1-1.1l.8-4.3c.2-.5.7-.9 1.1-.9z"/>'
};
export const FOLDER_SHAPE = SHAPE;
export const folderShapeHtml = kind => `<svg viewBox="0 0 16 16" width="15" height="15" focusable="false" aria-hidden="true">${kind === 'open' ? SHAPE.open : SHAPE.closed}</svg>`;

// ---- 클라우드 폴더·앨범 색·순서(FOLDER-순서·색 ③-2, 표 app_folder_prefs·app_photo_tags 칸): [파일]·사진 폴더·앨범이 같은 계산을 쓴다. ----
// 폴더 하나의 열쇠 = 출처('od'|'gd'|'phone') + 그 출처의 폴더 id. 순서는 '같은 부모 안' 형제끼리만 뜻이 있다.
export const prefKey = (source, key) => `${source}:${key}`;
// 서버 줄들 → Map(prefKey → {color, sort_order}). 틀린 줄(출처·열쇠 없음)은 무시, 값은 검사해서만 담는다.
export function prefsMapFrom(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row.source !== 'string' || typeof row.folder_key !== 'string' || !row.folder_key) continue;
    map.set(prefKey(row.source, row.folder_key), {color: colorOf(row), sort_order: Number.isInteger(row.sort_order) ? row.sort_order : null});
  }
  return map;
}
// 정한 순서가 있는 폴더가 앞(순서값 순, 같으면 원래 순서), 없는 폴더는 원래 순서(이름순) 그대로 뒤에 붙는다(설계 2-2).
export function orderByPrefs(list, getOrder) {
  const keyed = list.map((row, i) => ({row, i, o: getOrder(row)}));
  const set = keyed.filter(x => Number.isInteger(x.o)).sort((a, b) => a.o - b.o || a.i - b.i);
  return [...set, ...keyed.filter(x => !Number.isInteger(x.o))].map(x => x.row);
}
// 한 칸 위(-1)·아래(+1): 보이는 순서의 열쇠들(keys)에서 key를 옆으로. 쓸 줄들 [{k, o}] (끝이면 빈 배열). 순서 값이 없는 형제가 있으면 형제 전체를 다시 매긴다.
export function prefStepPlan(keys, key, dir, getOrder) {
  return stepPlan(keys.map(id => ({id})), key, dir, row => getOrder(row.id)).map(p => ({k: p.id, o: p.order}));
}
// 앨범(이름순 목록 + 정한 순서): sort_order 0 = 아직 안 정함. 정한 앨범이 앞, 나머지는 이름순 그대로.
export const albumOrderOf = tag => (Number.isInteger(tag?.sort_order) && tag.sort_order !== 0 ? tag.sort_order : null);
export function albumStepPlan(ids, id, dir, getOrder) {
  return stepPlan(ids.map(x => ({id: x})), id, dir, row => getOrder(row.id)).map(p => ({id: p.id, o: p.order}));
}
