// S53-20 MTG-비정기회의접기(시안 docs/design/mockups/meeting-name-irregular.html): 회의명 목록을 어떻게 보일지 정하는 한 곳(화면·네트워크 없음).
// 회의명 목록 원본은 내 회의 기록(app_meetings series_name, 없으면 title)이고, 여기서는 내 프로필 칸 app_profiles.meeting_name_sorts
// (migration 20261108090000) 값으로 '정기 / 비정기(상위 아래 접힘) / 목록에서 지움'을 나눈다. 값 모양은 DB 검사와 같다.
//   {parents?: [{id, name}], names?: {회의명 열쇠: 'etc' | 'del' | 상위 id}} — 표시가 없는 회의명은 정기(지금처럼 목록에 보임).
// 비정기·지움은 목록에서만 접히거나 빠진다. 지난 보고·검색·환류·연결은 그대로(회의 기록은 건드리지 않음).
// 읽기·쓰기는 meeting-name-sorts.js, 고르는 창은 meeting-name-panel.js.

export const ETC = 'etc', DEL = 'del', REGULAR = 'regular';
export const PARENT_MAX = 30, NAME_MAX = 300, PARENT_NAME_MAX = 30, BYTES_MAX = 32768;
export const PARENT_ID_RE = /^g[0-9a-z]{6,12}$/;
// 회의명 열쇠: 띄어쓰기 없이·소문자(app/team.js meetingNameKey·journal-meeting-kinds.js meetingKindKey와 같은 규칙).
export const nameKey = name => String(name ?? '').replace(/\s+/g, '').toLowerCase();
export const validNameKey = key => typeof key === 'string' && /^[^,\s\p{Cc}]+$/u.test(key) && [...key].length <= 100;
const parentNameOk = v => typeof v === 'string' && [...v].length >= 1 && [...v].length <= PARENT_NAME_MAX && !/\p{Cc}/u.test(v) && /\S/.test(v);
const sortValueOk = v => v === ETC || v === DEL || (typeof v === 'string' && PARENT_ID_RE.test(v));
const bytes = v => new TextEncoder().encode(JSON.stringify(v)).length;

export const emptySorts = () => ({parents: [], names: {}});

// 서버 값 → {parents, names}. 모양이 틀린 값은 null(그때 화면은 모든 회의명을 정기처럼 펼쳐 보인다 — 추측으로 숨기지 않음).
export function parseSorts(value) {
  if (value == null) return emptySorts();
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.keys(value).some(k => k !== 'parents' && k !== 'names')) return null;
  const parents = value.parents ?? [], names = value.names ?? {};
  if (!Array.isArray(parents) || parents.length > PARENT_MAX) return null;
  if (!parents.every(p => p && typeof p === 'object' && !Array.isArray(p) && Object.keys(p).every(k => k === 'id' || k === 'name')
    && typeof p.id === 'string' && PARENT_ID_RE.test(p.id) && parentNameOk(p.name))) return null;
  if (!names || typeof names !== 'object' || Array.isArray(names) || Object.keys(names).length > NAME_MAX) return null;
  if (!Object.entries(names).every(([k, v]) => validNameKey(k) && sortValueOk(v))) return null;
  return {parents: parents.map(p => ({id: p.id, name: p.name})), names: {...names}};
}
// 저장할 값(빈 칸은 뺌). DB 검사를 넘지 못할 값이면 null.
export function toStored(sorts) {
  const out = {};
  if (sorts.parents.length) out.parents = sorts.parents.map(p => ({id: p.id, name: p.name}));
  if (Object.keys(sorts.names).length) out.names = {...sorts.names};
  return parseSorts(out) && bytes(out) <= BYTES_MAX ? out : null;
}

// 한 회의명의 자리: {kind:'regular'} | {kind:'del'} | {kind:'irregular', parent: 상위 id 또는 'etc'}. 없는 상위 id는 '기타 비정기'.
export function placeOf(sorts, name) {
  const v = sorts?.names?.[nameKey(name)];
  if (!v) return {kind: REGULAR};
  if (v === DEL) return {kind: DEL};
  if (v === ETC || !sorts.parents.some(p => p.id === v)) return {kind: 'irregular', parent: ETC};
  return {kind: 'irregular', parent: v};
}
export const parentLabel = (sorts, id) => id === ETC ? '기타' : (sorts?.parents?.find(p => p.id === id)?.name || '기타');

// ⑤ 차수만 다른 같은 회의(1차·2차, 제3차 …)는 한 줄: 앞 '제n차'·뒤 '(n차)'·'n차'를 뗀 이름이 같으면 한 묶음.
export function roundBase(name) {
  return nameKey(String(name ?? '')
    .replace(/^\s*제?\s*\d+\s*차\s*/, '')
    .replace(/\s*[(（[]\s*제?\s*\d+\s*차\s*[)）\]]\s*$/, '')
    .replace(/\s*제?\s*\d+\s*차\s*$/, '')) || nameKey(name);
}

// entries: [{name, at}] — 이름마다 가장 최근 회의 시각(최근 먼저 정렬되어 있지 않아도 됨). 같은 열쇠는 하나로.
// 묶음 하나 = {name: 가장 최근 이름(고르면 이 이름), key, at, names: [최근 먼저 이름들]}.
export function bundle(entries) {
  const byKey = new Map();
  for (const e of entries) {
    const name = String(e?.name ?? '').trim(), key = nameKey(name);
    if (!key) continue;
    const at = e.at ? String(e.at) : '';
    const old = byKey.get(key);
    if (!old || at > old.at) byKey.set(key, {name, at});
  }
  const groups = new Map();
  for (const [key, e] of byKey) {
    const base = roundBase(e.name), g = groups.get(base) || groups.set(base, []).get(base);
    g.push({...e, key});
  }
  return [...groups.values()].map(list => {
    list.sort((a, b) => (b.at > a.at ? 1 : b.at < a.at ? -1 : 0));
    return {name: list[0].name, key: list[0].key, at: list[0].at, names: list.map(x => x.name)};
  }).sort((a, b) => (b.at > a.at ? 1 : b.at < a.at ? -1 : 0));
}

// 묶음의 자리는 가장 최근 이름의 자리. 묶음 안 이름 하나라도 정기면 정기로 본다(정기 회의가 접히지 않게).
function bundlePlace(sorts, b) {
  const places = b.names.map(n => placeOf(sorts, n));
  if (places.some(p => p.kind === REGULAR)) return {kind: REGULAR};
  return places.find(p => p.kind === 'irregular') || {kind: DEL};
}

// 평소 목록(②): [{type:'name', ...묶음}] 정기 + 상위 묶음 [{type:'group', id, label, items}]. 상위 이름으로 시작하는 정기 회의가 있으면 그 첫 줄 바로 아래,
// 없으면 상위 목록 순서대로 정기 줄 뒤에, '기타 비정기'는 맨 뒤. 비정기가 없는 상위는 줄이 없다. 지운 회의명은 없다.
// keep: 지금 고른 이름(그 이름은 비정기·지움이어도 정기 줄처럼 보인다 — 고친 기록의 이름이 사라져 보이지 않게).
export function listRows(entries, sorts, {keep = ''} = {}) {
  const regular = [], groups = new Map(), keepKey = nameKey(keep);
  for (const b of bundle(entries)) {
    const place = sorts ? bundlePlace(sorts, b) : {kind: REGULAR};
    if (place.kind === REGULAR || (keepKey && b.names.some(n => nameKey(n) === keepKey))) regular.push({type: 'name', ...b});
    else if (place.kind === 'irregular') { const g = groups.get(place.parent) || groups.set(place.parent, []).get(place.parent); g.push(b); }
  }
  const group = id => ({type: 'group', id, label: `${parentLabel(sorts, id)} 비정기 회의`, items: groups.get(id)});
  const rows = [], placed = new Set();
  for (const r of regular) {
    rows.push(r);
    const p = sorts?.parents.find(x => !placed.has(x.id) && groups.has(x.id) && r.key.startsWith(nameKey(x.name)));
    if (p) { rows.push(group(p.id)); placed.add(p.id); }
  }
  for (const p of sorts?.parents || []) if (groups.has(p.id) && !placed.has(p.id)) rows.push(group(p.id));
  if (groups.has(ETC)) rows.push(group(ETC));
  return rows;
}

// ③ 찾기: 정기·비정기 모두(지운 회의명은 빼고), 띄어쓰기·대소문자 무시. 비정기는 tag '비정기 · 상위'.
export function findRows(entries, sorts, query) {
  const q = nameKey(query);
  if (!q) return [];
  const out = [];
  for (const b of bundle(entries)) {
    if (!b.names.some(n => nameKey(n).includes(q))) continue;
    const place = sorts ? bundlePlace(sorts, b) : {kind: REGULAR};
    if (place.kind === DEL) continue;
    out.push({type: 'name', ...b, tag: place.kind === 'irregular' ? `비정기 · ${parentLabel(sorts, place.parent)}` : ''});
  }
  return out;
}
// 고르기 상자(<select>)에 보일 이름인가(정기 줄에 있는 이름). 숨은 이름도 option으로는 남겨 값으로 고를 수 있다.
export function shownNames(entries, sorts, opts) {
  const shown = new Set();
  for (const r of listRows(entries, sorts, opts)) if (r.type === 'name') for (const n of r.names) shown.add(nameKey(n));
  return shown;
}

// ---- 바꾸기(새 값을 돌려줌, 바꿀 수 없으면 null) ----
const clone = s => ({parents: s.parents.map(p => ({...p})), names: {...s.names}});
// 한 회의명(묶음이면 묶음 안 이름 모두)의 자리 바꾸기. place: 'regular' | 'del' | 'etc' | 상위 id.
export function setPlace(sorts, names, place) {
  const next = clone(sorts), list = (Array.isArray(names) ? names : [names]).map(nameKey).filter(validNameKey);
  if (!list.length) return null;
  if (place !== REGULAR && !sortValueOk(place)) return null;
  if (PARENT_ID_RE.test(place) && !next.parents.some(p => p.id === place)) return null;
  for (const k of list) { if (place === REGULAR) delete next.names[k]; else next.names[k] = place; }
  return Object.keys(next.names).length <= NAME_MAX ? next : null;
}
// 회의명 이름 바꾸기 뒤: 옛 열쇠의 표시를 새 열쇠로 옮김(새 이름에 이미 표시가 있으면 그대로 둠).
export function moveName(sorts, from, to) {
  const a = nameKey(from), b = nameKey(to), next = clone(sorts);
  if (!(a in next.names) || a === b) return next;
  if (!(b in next.names) && validNameKey(b)) next.names[b] = next.names[a];
  delete next.names[a];
  return next;
}
export function parentNameProblem(name, sorts, exceptId = '') {
  const v = String(name ?? '').trim();
  if (!v) return '상위 이름을 써 주세요.';
  if ([...v].length > PARENT_NAME_MAX) return `상위 이름은 ${PARENT_NAME_MAX}자까지예요.`;
  if (/\p{Cc}/u.test(v)) return '한 줄로 써 주세요.';
  if (nameKey(v) === nameKey('기타')) return '‘기타’는 이미 있어요.';
  if (sorts.parents.some(p => p.id !== exceptId && nameKey(p.name) === nameKey(v))) return '같은 이름의 상위가 있어요.';
  if (!exceptId && sorts.parents.length >= PARENT_MAX) return `상위는 ${PARENT_MAX}개까지예요.`;
  return '';
}
export const newParentId = (rand = Math.random) => 'g' + Array.from({length: 8}, () => '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(rand() * 36)]).join('');
export function addParent(sorts, name, id = newParentId()) {
  if (parentNameProblem(name, sorts) || !PARENT_ID_RE.test(id) || sorts.parents.some(p => p.id === id)) return null;
  const next = clone(sorts); next.parents.push({id, name: String(name).trim()}); return next;
}
export function renameParent(sorts, id, name) {
  if (!sorts.parents.some(p => p.id === id) || parentNameProblem(name, sorts, id)) return null;
  const next = clone(sorts); next.parents.find(p => p.id === id).name = String(name).trim(); return next;
}
export function orderParents(sorts, ids) {
  const byId = new Map(sorts.parents.map(p => [p.id, p]));
  if (ids.length !== byId.size || !ids.every(id => byId.has(id))) return null;
  const next = clone(sorts); next.parents = ids.map(id => ({...byId.get(id)})); return next;
}
// ⑨ 상위 지우기: 그 아래 비정기 회의는 지우지 않고 '기타 비정기'로 옮긴다.
export function removeParent(sorts, id) {
  if (!sorts.parents.some(p => p.id === id)) return null;
  const next = clone(sorts); next.parents = next.parents.filter(p => p.id !== id);
  for (const [k, v] of Object.entries(next.names)) if (v === id) next.names[k] = ETC;
  return next;
}
export const parentCount = (sorts, id) => Object.values(sorts.names).filter(v => v === id).length;
