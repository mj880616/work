// S53-20 MTG-비정기회의접기(시안 docs/design/mockups/meeting-name-irregular.html): 회의명 목록을 어떻게 보일지 정하는 한 곳(화면·네트워크 없음).
// 회의명 목록 원본은 내 회의 기록(app_meetings series_name, 없으면 title)이고, 여기서는 내 프로필 칸 app_profiles.meeting_name_sorts
// (migration 20261108090000) 값으로 '정기 / 비정기(상위 아래 접힘) / 목록에서 지움'을 나눈다. 값 모양은 DB 검사와 같다.
//   {parents?: [{id, name}], names?: {회의명 열쇠: 'etc' | 'del' | 상위 id}, orgs?: {회의명 열쇠: 조직 id}, presets?: [회의명], order?: [회의명 열쇠]} — 표시가 없는 회의명은 정기(지금처럼 목록에 보임).
// S56-1 MTG-회의명조직묶기(시안 docs/design/mockups/meeting-name-groups.html, migration 20261110090000): '상위'(parents)를 그대로 '조직'으로 쓴다.
//   비정기 회의의 조직 = names 값(상위 id, 'etc'는 기타). 정기·지운 회의의 조직 = orgs 값(없으면 기타). orgs는 새 칸이라 옛 값에는 없다.
//   정기 회의에 조직이 하나라도 붙어 있으면 목록을 조직 머리글로 묶고, 하나도 없으면(옛 값) 지금 모양 그대로 보인다.
// S57-14 MTG-회의명처음배치(시안 docs/design/mockups/meeting-name-groups-phone.html, migration 20261111030000): 값에 두 칸을 더한다.
//   presets = [회의명] — '미리 넣은 회의'(아직 보고가 없는 회의명, 50개까지). 목록에 정기 줄처럼 보이고 ⋯ [목록에서 빼기]로 뺀다. 조직은 orgs 값.
//   order = [회의명 열쇠] — 정기 회의 줄의 순서(300개까지). 조직 안에서 이 순서대로, 여기 없는 회의는 그 뒤에 최근 먼저(옛 값은 지금 모양 그대로).
//   조직에 넣거나(조직 바꾸기) 미리 넣으면 그 조직 맨 아래에 붙는다 — 넣은 순서가 곧 보이는 순서. 고치기는 줄 ⋯ [위로]·[아래로].
// 비정기·지움은 목록에서만 접히거나 빠진다. 지난 보고·검색·환류·연결은 그대로(회의 기록은 건드리지 않음).
// 읽기·쓰기는 meeting-name-sorts.js, 고르는 창은 meeting-name-panel.js.

export const ETC = 'etc', DEL = 'del', REGULAR = 'regular';
export const PARENT_MAX = 30, NAME_MAX = 300, ORG_MAX = 300, PARENT_NAME_MAX = 30, BYTES_MAX = 32768;
export const PRESET_MAX = 50, ORDER_MAX = 300, PRESET_NAME_MAX = 100;
export const PARENT_ID_RE = /^g[0-9a-z]{6,12}$/;
// 회의명 열쇠: 띄어쓰기 없이·소문자(app/team.js meetingNameKey·journal-meeting-kinds.js meetingKindKey와 같은 규칙).
export const nameKey = name => String(name ?? '').replace(/\s+/g, '').toLowerCase();
export const validNameKey = key => typeof key === 'string' && /^[^,\s\p{Cc}]+$/u.test(key) && [...key].length <= 100;
const parentNameOk = v => typeof v === 'string' && [...v].length >= 1 && [...v].length <= PARENT_NAME_MAX && !/\p{Cc}/u.test(v) && /\S/.test(v);
const sortValueOk = v => v === ETC || v === DEL || (typeof v === 'string' && PARENT_ID_RE.test(v));
const bytes = v => new TextEncoder().encode(JSON.stringify(v)).length;
// 미리 넣은 회의명: 1~100자 한 줄, 쉼표 없음(열쇠로 쓸 수 있어야 조직·순서를 붙일 수 있다), 공백만은 안 됨. DB 검사와 같다.
const presetNameOk = v => typeof v === 'string' && [...v].length <= PRESET_NAME_MAX && !/[\p{Cc},]/u.test(v) && validNameKey(nameKey(v));

export const emptySorts = () => ({parents: [], names: {}, orgs: {}, presets: [], order: []});

// 서버 값 → {parents, names}. 모양이 틀린 값은 null(그때 화면은 모든 회의명을 정기처럼 펼쳐 보인다 — 추측으로 숨기지 않음).
export function parseSorts(value) {
  if (value == null) return emptySorts();
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.keys(value).some(k => k !== 'parents' && k !== 'names' && k !== 'orgs' && k !== 'presets' && k !== 'order')) return null;
  const parents = value.parents ?? [], names = value.names ?? {}, orgs = value.orgs ?? {}, presets = value.presets ?? [], order = value.order ?? [];
  if (!Array.isArray(parents) || parents.length > PARENT_MAX) return null;
  if (!parents.every(p => p && typeof p === 'object' && !Array.isArray(p) && Object.keys(p).every(k => k === 'id' || k === 'name')
    && typeof p.id === 'string' && PARENT_ID_RE.test(p.id) && parentNameOk(p.name))) return null;
  if (!names || typeof names !== 'object' || Array.isArray(names) || Object.keys(names).length > NAME_MAX) return null;
  if (!Object.entries(names).every(([k, v]) => validNameKey(k) && sortValueOk(v))) return null;
  if (!orgs || typeof orgs !== 'object' || Array.isArray(orgs) || Object.keys(orgs).length > ORG_MAX) return null;
  if (!Object.entries(orgs).every(([k, v]) => validNameKey(k) && typeof v === 'string' && PARENT_ID_RE.test(v))) return null;
  if (!Array.isArray(presets) || presets.length > PRESET_MAX || !presets.every(presetNameOk)) return null;
  if (!Array.isArray(order) || order.length > ORDER_MAX || !order.every(validNameKey)) return null;
  // 같은 열쇠가 두 번 있으면 앞의 것만 쓴다(목록에 같은 회의가 두 줄로 보이지 않게).
  const once = (list, keyOf) => { const seen = new Set(); return list.filter(v => { const k = keyOf(v); if (seen.has(k)) return false; seen.add(k); return true; }); };
  return {parents: parents.map(p => ({id: p.id, name: p.name})), names: {...names}, orgs: {...orgs}, presets: once(presets, nameKey), order: once(order, k => k)};
}
// 저장할 값(빈 칸은 뺌). DB 검사를 넘지 못할 값이면 null.
export function toStored(sorts) {
  const out = {};
  if (sorts.parents.length) out.parents = sorts.parents.map(p => ({id: p.id, name: p.name}));
  if (Object.keys(sorts.names).length) out.names = {...sorts.names};
  if (Object.keys(sorts.orgs || {}).length) out.orgs = {...sorts.orgs};
  if ((sorts.presets || []).length) out.presets = [...sorts.presets];
  if ((sorts.order || []).length) out.order = [...sorts.order];
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
// 한 회의명의 조직 id(없으면 'etc' = 기타). 비정기는 names 값, 정기·지움은 orgs 값. 없는 조직 id는 기타.
export function orgOf(sorts, name) {
  const k = nameKey(name), v = sorts?.names?.[k], has = id => !!sorts?.parents?.some(p => p.id === id);
  if (v && v !== DEL) return has(v) ? v : ETC;
  const o = sorts?.orgs?.[k];
  return o && has(o) ? o : ETC;
}
// 조직으로 묶어 보일까: 정기 회의에 조직이 하나라도 붙어 있을 때(옛 값은 지금 모양 그대로).
export const grouped = sorts => !!sorts && Object.entries(sorts.orgs || {}).some(([k, v]) => !sorts.names[k] && sorts.parents.some(p => p.id === v));
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
// org: 그 자리를 정한 첫 이름(최근 먼저)의 조직.
function bundlePlace(sorts, b) {
  const places = b.names.map(n => ({...placeOf(sorts, n), org: orgOf(sorts, n)}));
  const reg = places.find(p => p.kind === REGULAR);
  if (reg) return {kind: REGULAR, org: reg.org};
  return places.find(p => p.kind === 'irregular') || {kind: DEL, org: places[0]?.org || ETC};
}

// S57-14 미리 넣은 회의: 보고가 없는 회의명도 목록 줄이 되게 entries 뒤에 붙인다(at 없음 = 최근 순서에서는 맨 뒤). 같은 열쇠의 보고가 있으면 붙이지 않는다.
// 돌려줌: {all: 붙인 entries, real: 보고가 있는 회의명 열쇠}. 묶음의 preset = 그 묶음 이름 어느 것에도 보고가 없음(미리 넣은 줄).
function withPresets(entries, sorts) {
  const real = new Set((entries || []).map(e => nameKey(e?.name)).filter(Boolean));
  const extra = (sorts?.presets || []).filter(n => !real.has(nameKey(n))).map(name => ({name, at: ''}));
  return {all: extra.length ? [...(entries || []), ...extra] : entries || [], real};
}
const bundles = (entries, sorts) => { const {all, real} = withPresets(entries, sorts); return bundle(all).map(b => b.names.some(n => real.has(nameKey(n))) ? b : {...b, preset: true}); };
// S57-14 정기 줄 순서: order에 있는 회의는 그 순서대로 앞에, 없는 회의는 받은 순서(최근 먼저) 그대로 뒤에. 묶음은 그 안 이름 가운데 가장 앞 순서.
const orderRank = sorts => { const at = new Map((sorts?.order || []).map((k, i) => [k, i])); return names => Math.min(...names.map(n => at.get(nameKey(n)) ?? Infinity)); };
function byOrder(list, sorts, namesOf = b => b.names) {
  if (!(sorts?.order || []).length) return list;
  const rank = orderRank(sorts);
  return list.map((item, i) => ({item, i, r: rank(namesOf(item))})).sort((a, b) => a.r - b.r || a.i - b.i).map(x => x.item);
}

// 평소 목록(②): [{type:'name', ...묶음}] 정기 + 상위 묶음 [{type:'group', id, label, items}]. 상위 이름으로 시작하는 정기 회의가 있으면 그 첫 줄 바로 아래,
// 없으면 상위 목록 순서대로 정기 줄 뒤에, '기타 비정기'는 맨 뒤. 비정기가 없는 상위는 줄이 없다. 지운 회의명은 없다.
// keep: 지금 고른 이름(그 이름은 비정기·지움이어도 정기 줄처럼 보인다 — 고친 기록의 이름이 사라져 보이지 않게).
export function listRows(entries, sorts, opts = {}) {
  return grouped(sorts) ? orgRows(entries, sorts, opts) : plainRows(entries, sorts, opts);
}
function plainRows(entries, sorts, {keep = ''} = {}) {
  const regular = [], groups = new Map(), keepKey = nameKey(keep);
  for (const b of bundles(entries, sorts)) {
    const place = sorts ? bundlePlace(sorts, b) : {kind: REGULAR};
    if (place.kind === REGULAR || (keepKey && b.names.some(n => nameKey(n) === keepKey))) regular.push({type: 'name', ...b});
    else if (place.kind === 'irregular') { const g = groups.get(place.parent) || groups.set(place.parent, []).get(place.parent); g.push(b); }
  }
  const group = id => ({type: 'group', id, label: `${parentLabel(sorts, id)} 비정기 회의`, items: groups.get(id)});
  const rows = [], placed = new Set();
  for (const r of byOrder(regular, sorts)) {
    rows.push(r);
    const p = sorts?.parents.find(x => !placed.has(x.id) && groups.has(x.id) && r.key.startsWith(nameKey(x.name)));
    if (p) { rows.push(group(p.id)); placed.add(p.id); }
  }
  for (const p of sorts?.parents || []) if (groups.has(p.id) && !placed.has(p.id)) rows.push(group(p.id));
  if (groups.has(ETC)) rows.push(group(ETC));
  return rows;
}

// S56-1 조직 묶음 목록: 조직 순서(조직 목록 순서, '기타'는 맨 아래)대로 [{type:'org', id, label}] 머리글(고를 수 없음) ·
// 그 조직의 정기 회의(최근 먼저) · 그 조직 비정기 묶음 [{type:'group', id, label:'비정기 회의', items}]. 회의가 하나도 없는 조직은 머리글도 없다.
// keep(지금 고른 이름)은 비정기·지움이어도 그 조직의 정기 줄처럼 보인다.
function orgRows(entries, sorts, {keep = ''} = {}) {
  const keepKey = nameKey(keep), regular = new Map(), irregular = new Map();
  const push = (map, id, b) => (map.get(id) || map.set(id, []).get(id)).push(b);
  for (const b of bundles(entries, sorts)) {
    const place = bundlePlace(sorts, b), org = place.kind === 'irregular' ? place.parent : place.org;
    if (place.kind === REGULAR || (keepKey && b.names.some(n => nameKey(n) === keepKey))) push(regular, org, b);
    else if (place.kind === 'irregular') push(irregular, org, b);
  }
  const rows = [];
  for (const id of orgOrder(sorts)) {
    if (!regular.has(id) && !irregular.has(id)) continue;
    rows.push({type: 'org', id, label: parentLabel(sorts, id)});
    for (const b of byOrder(regular.get(id) || [], sorts)) rows.push({type: 'name', ...b, org: id});
    if (irregular.has(id)) rows.push({type: 'group', id, label: '비정기 회의', items: irregular.get(id)});
  }
  return rows;
}

// 조직 순서: 조직 목록 순서, '기타'는 맨 아래(고르기 창·사업 보고 회의 목록·[회의 ▾] 상자가 모두 이 순서를 쓴다).
export const orgOrder = sorts => [...(sorts?.parents || []).map(p => p.id), ETC];
// S56-36 MTG-회의목록조직묶기: 회의명이 붙은 아무 줄(items)을 조직별로 나눈다 — 고르기 창 밖(사업 보고 회의 [목록] 왼쪽 칸, [회의 ▾] 상자의 회의명)도
// 같은 조직 목록·같은 orgOf로 묶이게. 조직으로 묶지 않는 값(grouped가 아님: 옛 값·정리 없음·읽기 전)이면 null(부른 곳은 지금처럼 묶음 없이 그린다).
// 돌려줌: [{id, label, items}] — orgOrder 순서, 줄이 없는 조직은 빠짐. 이름 없는 줄은 '기타'.
// S57-14: 조직 안 줄은 고르기 창과 같은 순서(order에 있는 회의 먼저 그 순서대로, 나머지는 받은 순서 그대로).
//   presetItem(회의명)을 주면 받은 줄에 없는 '미리 넣은 회의'도 그 조직 줄로 더한다(부른 곳의 줄 모양으로 만들어 돌려줌 — 고르기 창과 같은 이름이 보이게).
export function orgSections(items, sorts, nameOf = x => x?.name, {presetItem = null} = {}) {
  if (!grouped(sorts)) return null;
  const byOrg = new Map(), have = new Set(), nameIn = item => String(nameOf(item) ?? '').trim();
  const put = item => { const name = nameIn(item), id = name ? orgOf(sorts, name) : ETC; have.add(nameKey(name)); (byOrg.get(id) || byOrg.set(id, []).get(id)).push(item); };
  for (const item of items || []) put(item);
  if (presetItem) for (const name of sorts.presets || []) if (!have.has(nameKey(name)) && placeOf(sorts, name).kind === REGULAR) { const item = presetItem(name); if (item) put(item); }
  return orgOrder(sorts).filter(id => byOrg.has(id)).map(id => ({id, label: parentLabel(sorts, id), items: byOrder(byOrg.get(id), sorts, item => [nameIn(item)])}));
}

// ③ 찾기: 정기·비정기 모두(지운 회의명은 빼고), 띄어쓰기·대소문자 무시. 비정기는 tag '비정기 · 조직', 조직에 넣은 정기는 tag '조직'(S56-1 ⑤).
export function findRows(entries, sorts, query) {
  const q = nameKey(query);
  if (!q) return [];
  const out = [];
  for (const b of bundles(entries, sorts)) {
    if (!b.names.some(n => nameKey(n).includes(q))) continue;
    const place = sorts ? bundlePlace(sorts, b) : {kind: REGULAR};
    if (place.kind === DEL) continue;
    const org = place.kind === 'irregular' ? place.parent : place.org || ETC;
    out.push({type: 'name', ...b, org, tag: place.kind === 'irregular' ? `비정기 · ${parentLabel(sorts, org)}` : org !== ETC ? parentLabel(sorts, org) : ''});
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
const clone = s => ({parents: s.parents.map(p => ({...p})), names: {...s.names}, orgs: {...(s.orgs || {})}, presets: [...(s.presets || [])], order: [...(s.order || [])]});
const fits = s => Object.keys(s.names).length <= NAME_MAX && Object.keys(s.orgs).length <= ORG_MAX && s.presets.length <= PRESET_MAX && s.order.length <= ORDER_MAX;
// 순서 목록에서 빼고(drop) 맨 뒤에 붙이기(append). 300개를 넘으면 지금 조직·미리 넣기에 쓰이지 않는 옛 열쇠부터 버린다.
const dropOrder = (s, keys) => { const gone = new Set(keys); s.order = s.order.filter(k => !gone.has(k)); };
function appendOrder(s, keys) {
  dropOrder(s, keys); s.order.push(...keys);
  if (s.order.length > ORDER_MAX) { const used = new Set([...Object.keys(s.orgs), ...s.presets.map(nameKey), ...keys]); s.order = s.order.filter(k => used.has(k)); }
}
// 한 회의명(묶음이면 묶음 안 이름 모두)의 자리 바꾸기. place: 'regular' | 'del' | 'etc' | 상위 id.
// 조직은 그대로 따라간다: 비정기 → 정기면 그 조직을 orgs로 옮기고, 정기 → 비정기(상위 id·etc)면 orgs 표시를 지운다(조직은 names 값이 정함).
export function setPlace(sorts, names, place) {
  const next = clone(sorts), list = (Array.isArray(names) ? names : [names]).map(nameKey).filter(validNameKey);
  if (!list.length) return null;
  if (place !== REGULAR && !sortValueOk(place)) return null;
  if (PARENT_ID_RE.test(place) && !next.parents.some(p => p.id === place)) return null;
  for (const k of list) {
    const v = next.names[k], wasIrr = v && v !== DEL;
    if (place === REGULAR) { if (wasIrr && PARENT_ID_RE.test(v) && next.parents.some(p => p.id === v)) next.orgs[k] = v; delete next.names[k]; }
    else if (place === DEL) { if (wasIrr && PARENT_ID_RE.test(v) && next.parents.some(p => p.id === v)) next.orgs[k] = v; next.names[k] = DEL; }
    else { next.names[k] = place; delete next.orgs[k]; }
  }
  return fits(next) ? next : null;
}
// S56-1 ⋯ '비정기로 두기': 지금 조직 아래 비정기로(조직은 바뀌지 않음).
export function setIrregular(sorts, names) {
  const list = (Array.isArray(names) ? names : [names]).filter(n => validNameKey(nameKey(n)));
  if (!list.length) return null;
  let next = clone(sorts);
  for (const n of list) { next = setPlace(next, n, orgOf(next, n)); if (!next) return null; }
  return next;
}
// S56-1 ③ ⋯ '조직 바꾸기': org = 조직 id 또는 'etc'(기타). 정기·비정기·지움 자리는 그대로, 조직만 바꾼다.
export function setOrg(sorts, names, org) {
  const next = clone(sorts), list = (Array.isArray(names) ? names : [names]).map(nameKey).filter(validNameKey);
  if (!list.length || !(org === ETC || (PARENT_ID_RE.test(org) && next.parents.some(p => p.id === org)))) return null;
  const moved = [];
  for (const k of list) {
    const v = next.names[k];
    if (v && v !== DEL) { next.names[k] = org; delete next.orgs[k]; }
    else if (org === ETC) { delete next.orgs[k]; moved.push(k); }
    else { if (next.orgs[k] !== org) moved.push(k); next.orgs[k] = org; }
  }
  // S57-14: 다른 조직으로 옮긴 정기 회의는 그 조직 맨 아래에 붙는다(넣은 순서 = 보이는 순서). '기타'로 빼면 순서 표시를 지운다(최근 먼저로 돌아감).
  if (org === ETC) dropOrder(next, moved); else if (moved.length) appendOrder(next, moved);
  return fits(next) ? next : null;
}
// 회의명 이름 바꾸기 뒤: 옛 열쇠의 표시를 새 열쇠로 옮김(새 이름에 이미 표시가 있으면 그대로 둠).
export function moveName(sorts, from, to) {
  const a = nameKey(from), b = nameKey(to), next = clone(sorts);
  if (a === b) return next;
  for (const map of [next.names, next.orgs]) {
    if (!(a in map)) continue;
    if (!(b in map) && validNameKey(b)) map[b] = map[a];
    delete map[a];
  }
  // S57-14: 순서·미리 넣은 회의도 새 이름으로(새 이름이 이미 있으면 옛 것만 뺀다).
  const at = next.order.indexOf(a);
  if (at >= 0) { if (validNameKey(b) && !next.order.includes(b)) next.order[at] = b; else next.order.splice(at, 1); }
  const pi = next.presets.findIndex(n => nameKey(n) === a);
  if (pi >= 0) { if (presetNameOk(String(to).trim()) && !next.presets.some(n => nameKey(n) === b)) next.presets[pi] = String(to).trim(); else next.presets.splice(pi, 1); }
  return next;
}
// 이 회의명에 정리 표시가 하나라도 있나(이름을 바꿀 때 옮길 것이 있는지).
export const hasMark = (sorts, name) => { const k = nameKey(name); return !!sorts && (k in sorts.names || k in (sorts.orgs || {}) || (sorts.order || []).includes(k) || (sorts.presets || []).some(n => nameKey(n) === k)); };

// ---- S57-14 미리 넣은 회의 ----
export const isPreset = (sorts, name) => (sorts?.presets || []).some(n => nameKey(n) === nameKey(name));
// known: 이미 보고가 있는 회의명들(같은 이름을 또 넣지 않게).
export function presetNameProblem(name, sorts, known = []) {
  const v = String(name ?? '').trim(), k = nameKey(v);
  if (!v) return '회의명을 써 주세요.';
  if ([...v].length > PRESET_NAME_MAX) return `회의명은 ${PRESET_NAME_MAX}자까지예요.`;
  if (/\p{Cc}/u.test(v)) return '한 줄로 써 주세요.';
  if (v.includes(',')) return '쉼표(,)는 쓸 수 없어요.';
  if (!validNameKey(k)) return '회의명을 다시 써 주세요.';
  // 삭제(목록에서 지움)했던 회의명은 다시 넣을 수 있다(목록에 돌아옴).
  const has = isPreset(sorts, v) || known.some(n => nameKey(n) === k);
  if (has && sorts.names[k] !== DEL) return '이미 목록에 있는 회의예요.';
  if (!has && (sorts.presets || []).length >= PRESET_MAX) return `미리 넣는 회의는 ${PRESET_MAX}개까지예요.`;
  return '';
}
// 미리 넣기: 정기 줄로, org(조직 id 또는 'etc') 맨 아래에. 지웠던 이름이면 지움 표시를 푼다(보고가 있는 이름이면 미리 넣은 표시는 더하지 않는다).
export function addPreset(sorts, name, org = ETC, known = []) {
  const v = String(name ?? '').trim(), k = nameKey(v);
  if (presetNameProblem(v, sorts, known)) return null;
  if (!(org === ETC || (PARENT_ID_RE.test(org) && sorts.parents.some(p => p.id === org)))) return null;
  const next = clone(sorts);
  if (!isPreset(next, v) && !known.some(n => nameKey(n) === k)) next.presets.push(v);
  delete next.names[k];
  if (org === ETC) { delete next.orgs[k]; dropOrder(next, [k]); } else { next.orgs[k] = org; appendOrder(next, [k]); }
  return fits(next) ? next : null;
}
// 목록에서 빼기: 미리 넣은 표시와 그 회의명의 조직·순서 표시를 지운다(보고가 없는 이름이라 남길 것이 없다).
export function removePreset(sorts, name) {
  const k = nameKey(name);
  if (!isPreset(sorts, name)) return null;
  const next = clone(sorts);
  next.presets = next.presets.filter(n => nameKey(n) !== k); delete next.orgs[k]; delete next.names[k]; dropOrder(next, [k]);
  return next;
}
// ---- S57-14 줄 순서(⋯ [위로]·[아래로]) ----
// 지금 보이는 목록에서 그 회의가 든 정기 줄 묶음(같은 조직 머리글 아래, 조직으로 묶지 않으면 정기 줄 전부)과 그 안 자리. 없으면 null.
export function orderSpot(entries, sorts, name, opts = {}) {
  const k = nameKey(name), runs = [[]];
  for (const r of listRows(entries, sorts, opts)) { if (r.type === 'org') runs.push([]); else if (r.type === 'name') runs.at(-1).push(r); }
  for (const run of runs) { const index = run.findIndex(r => r.names.some(n => nameKey(n) === k)); if (index >= 0) return {index, count: run.length, keys: run.map(r => r.key)}; }
  return null;
}
// dir -1 = 위로, +1 = 아래로. 그 묶음의 지금 보이는 순서를 통째로 순서 목록에 적는다(순서 표시가 없던 회의도 지금 자리 그대로 굳는다).
export function stepOrder(entries, sorts, name, dir, opts = {}) {
  const spot = orderSpot(entries, sorts, name, opts), to = spot ? spot.index + dir : -1;
  if (!spot || to < 0 || to >= spot.count) return null;
  const keys = [...spot.keys]; [keys[spot.index], keys[to]] = [keys[to], keys[spot.index]];
  if (!keys.every(validNameKey)) return null;
  // 묶음(차수만 다른 이름들)은 가장 앞 순서를 쓰므로, 묶음 안 다른 이름의 옛 순서 표시는 지운다.
  const next = clone(sorts), run = listRows(entries, sorts, opts).filter(r => r.type === 'name' && spot.keys.includes(r.key));
  dropOrder(next, run.flatMap(r => r.names.map(nameKey)));
  appendOrder(next, keys);
  return fits(next) ? next : null;
}
export function parentNameProblem(name, sorts, exceptId = '') {
  const v = String(name ?? '').trim();
  if (!v) return '조직 이름을 써 주세요.';
  if ([...v].length > PARENT_NAME_MAX) return `조직 이름은 ${PARENT_NAME_MAX}자까지예요.`;
  if (/\p{Cc}/u.test(v)) return '한 줄로 써 주세요.';
  if (nameKey(v) === nameKey('기타')) return '‘기타’는 이미 있어요.';
  if (sorts.parents.some(p => p.id !== exceptId && nameKey(p.name) === nameKey(v))) return '같은 이름의 조직이 있어요.';
  if (!exceptId && sorts.parents.length >= PARENT_MAX) return `조직은 ${PARENT_MAX}개까지예요.`;
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
// ⑨ 조직(상위) 지우기: 그 아래 회의는 지우지 않고 '기타'로 옮긴다(비정기는 기타 비정기, 정기는 기타 정기).
export function removeParent(sorts, id) {
  if (!sorts.parents.some(p => p.id === id)) return null;
  const next = clone(sorts); next.parents = next.parents.filter(p => p.id !== id);
  for (const [k, v] of Object.entries(next.names)) if (v === id) next.names[k] = ETC;
  for (const [k, v] of Object.entries(next.orgs)) if (v === id) { delete next.orgs[k]; dropOrder(next, [k]); }
  return next;
}
export const parentCount = (sorts, id) => Object.values(sorts.names).filter(v => v === id).length;
// 조직에 넣은 회의 수(비정기 + 정기·지움). '기타'는 세지 않는다(넣지 않은 회의 전부라 수를 알 수 없음).
export const orgCount = (sorts, id) => parentCount(sorts, id) + Object.entries(sorts.orgs || {}).filter(([k, v]) => v === id && !(sorts.names[k] && sorts.names[k] !== DEL)).length;
