// MENU-HOME-편집: 홈 칸 목록의 유일한 정의(어떤 칸이 있고, 기본 순서가 무엇이고, 어느 칸에서 그리는지). DOM·네트워크 없음.
// 순서·빼기는 서버(view_prefs.home_cards = 보이는 칸 이름을 순서대로 담은 목록)에 둔다. 칸이 없으면 기본 순서 전부.
// 홈에서 뺀 칸은 화면에서만 빠지고 데이터·기능은 그대로다. 빠른 입력 칸과 한 줄 요약은 칸이 아니라 고정 자리다.
//
// 현재 홈 칸 표(기본 순서 = 폰 한 칸 홈의 위에서 아래; PC는 column 별로 나눠 같은 순서로 그린다)
//   id        이름               PC 칸   폰·중간 폭만   그리는 곳
//   calendar  오늘 일정           main                 home-read.js
//   tasks     오늘 할 일          main                 home-read.js
//   missed    놓친 약속           main    예            home-fill.js
//   inbox     정리 안 된 것       main    예            home-fill.js
//   tomorrow  내일               main    예            home-fill.js
//   dday      주요 일정           aside                home-read.js
//   radar     챙길 것             aside                todo-radar.js
//   meetings  사업 보고 후속      main                 home-read.js
//   collect   마지막 수집 시각    aside   (폰은 위·아래 한 줄)  collection-status.js
// 새로 더할 수 있는 칸(extra): links 자주 가는 링크 · notes 노트 최근 · docs 최근 자료  → home-extra.js
export const CARDS = Object.freeze([
  {id: 'calendar', title: '오늘 일정', column: 'main'},
  {id: 'tasks', title: '오늘 할 일', column: 'main'},
  {id: 'missed', title: '놓친 약속', column: 'main', phoneOnly: true},
  {id: 'inbox', title: '정리 안 된 것', column: 'main', phoneOnly: true},
  {id: 'tomorrow', title: '내일', column: 'main', phoneOnly: true},
  {id: 'dday', title: '주요 일정', column: 'aside'},
  {id: 'radar', title: '챙길 것', column: 'aside'},
  {id: 'meetings', title: '사업 보고 후속', column: 'main'},
  {id: 'collect', title: '마지막 수집 시각', column: 'aside'},
  {id: 'links', title: '자주 가는 링크', column: 'aside', extra: true},
  {id: 'notes', title: '노트 최근', column: 'aside', extra: true},
  {id: 'docs', title: '최근 자료', column: 'aside', extra: true}
]);
export const DEFAULT_ORDER = Object.freeze(CARDS.filter(card => !card.extra).map(card => card.id));
const BY_ID = new Map(CARDS.map(card => [card.id, card]));
export const cardOf = id => BY_ID.get(id) || null;
export const titleOf = id => BY_ID.get(id)?.title || '';

// 저장된 값(없음 = null/undefined)을 올바른 목록으로. 모르는 이름·겹친 이름은 버린다. 빈 목록은 "전부 뺐다"이다.
export function normalizeCards(raw) {
  if (raw === null || raw === undefined) return [...DEFAULT_ORDER];
  if (!Array.isArray(raw)) return [...DEFAULT_ORDER];
  return [...new Set(raw.filter(id => typeof id === 'string' && BY_ID.has(id)))];
}
export const sameCards = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);
export const isDefaultCards = list => sameCards(normalizeCards(list), DEFAULT_ORDER);
// 서버에 둘 값: 기본과 같으면 null(칸을 비운다 = 처음대로).
export const cardsToPrefs = list => { const next = normalizeCards(list); return sameCards(next, DEFAULT_ORDER) ? null : next; };

export const removeCard = (list, id) => normalizeCards(list).filter(x => x !== id);
// 빼 둔 칸을 맨 아래에 더한다(이미 있거나 모르는 이름이면 그대로).
export function addCard(list, id) {
  const base = normalizeCards(list);
  return BY_ID.has(id) && !base.includes(id) ? [...base, id] : base;
}
// 아직 홈에 없는 칸들(더하기 칩 목록). 이 기기에서 보이지 않는 칸(폰 전용을 PC에서)은 제외한다.
export const addable = (list, phone) => { const have = new Set(normalizeCards(list)); return CARDS.filter(card => !have.has(card.id) && (phone || !card.phoneOnly)); };
// 이 기기에서 실제로 그려지는 칸들(폰 전용 칸은 PC에서 빠진다).
export const visibleCards = (list, phone) => normalizeCards(list).filter(id => phone || !BY_ID.get(id).phoneOnly);

// id를 기기에서 보이는 칸들 기준 index 자리로 옮긴다(보이지 않는 칸은 제자리를 지킨다: 보이는 이웃 바로 앞/뒤에 끼운다).
export function moveCard(list, id, index, phone = true) {
  const base = normalizeCards(list);
  if (!base.includes(id)) return base;
  const rest = base.filter(x => x !== id), shown = rest.filter(x => phone || !BY_ID.get(x).phoneOnly);
  const at = Math.max(0, Math.min(Number.isFinite(index) ? Math.trunc(index) : shown.length, shown.length));
  if (at >= shown.length) return shown.length ? [...rest.slice(0, rest.indexOf(shown.at(-1)) + 1), id, ...rest.slice(rest.indexOf(shown.at(-1)) + 1)] : [...rest, id];
  const before = rest.indexOf(shown[at]);
  return [...rest.slice(0, before), id, ...rest.slice(before)];
}
export function stepCard(list, id, dir, phone = true) {
  const shown = visibleCards(list, phone), at = shown.indexOf(id), to = at + dir;
  if (at < 0 || to < 0 || to >= shown.length) return normalizeCards(list);
  return moveCard(list, id, to, phone);
}
// 칸 배치: 폰·중간 폭은 한 칸에 위에서 아래로, PC는 칸(main·aside)별로 같은 순서.
export function placement(list, phone) {
  const shown = visibleCards(list, phone);
  if (phone) return {main: shown, aside: []};
  return {main: shown.filter(id => BY_ID.get(id).column === 'main'), aside: shown.filter(id => BY_ID.get(id).column === 'aside')};
}
