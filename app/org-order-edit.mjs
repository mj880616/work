// MULTI-다른담당자맞춤 ①: 조직 보고 화면에서 담당조직 이름을 바꾸거나 [담당 조직에서 제외]/[담당 조직으로 추가]를 누를 때
// 내 프로필 화면 기억 org_order({groups:[{name, orgs:[조직 이름…]}…], hidden:[조직 이름…]}, view-prefs.js)를 어떻게 고치는지 한 곳.
// 값은 같은 org_order 하나에만 있고(새 저장소 없음), 조직은 이름으로 맞춘다(organization-order.js와 같음).
// 함수는 모두 새 값을 돌려주고 받은 값을 고치지 않는다. 값이 없던 사람(null)은 묶음 없는 빈 값에서 시작한다.
export const ORG_HIDDEN_MAX = 40;
const clean = order => ({
  groups: Array.isArray(order?.groups) ? order.groups.map(g => ({name: String(g?.name ?? ''), orgs: [...(g?.orgs || [])].map(String)})) : [],
  hidden: Array.isArray(order?.hidden) ? order.hidden.map(String) : [],
});

// 제외(고르기 창에서 빠짐)했는가.
export const isExcluded = (order, name) => clean(order).hidden.includes(String(name ?? ''));

// 이름을 바꾸면 묶음 안 자리·제외 표시도 새 이름으로 옮긴다(같은 이름이 이미 있으면 겹치지 않게 하나만 남김).
export function renameInOrder(order, from, to) {
  const before = String(from ?? ''), after = String(to ?? '').trim();
  const out = clean(order);
  if (!before || !after || before === after) return {changed: false, value: out};
  let changed = false;
  const swap = list => {
    const next = [];
    for (const name of list) {
      const v = name === before ? (changed = true, after) : name;
      if (!next.includes(v)) next.push(v);
    }
    return next;
  };
  out.groups = out.groups.map(g => ({name: g.name, orgs: swap(g.orgs)}));
  out.hidden = swap(out.hidden);
  return {changed, value: out};
}

// [담당 조직에서 제외](exclude=true)·[담당 조직으로 추가](exclude=false). 제외는 40개까지(서버 검사와 같음).
export function setExcluded(order, name, exclude) {
  const key = String(name ?? '').trim(), out = clean(order);
  if (!key) return {changed: false, value: out};
  const has = out.hidden.includes(key);
  if (exclude && has || !exclude && !has) return {changed: false, value: out};
  if (exclude && out.hidden.length >= ORG_HIDDEN_MAX) return {changed: false, value: out, error: `제외한 조직은 ${ORG_HIDDEN_MAX}곳까지예요.`};
  out.hidden = exclude ? [...out.hidden, key] : out.hidden.filter(v => v !== key);
  return {changed: true, value: out};
}

// 조직 보고 목록: 제외한 조직은 원래 묶음에서 빼서 맨 아래 '제외한 조직' 묶음으로(흐리게). 나머지는 그대로.
export const EXCLUDED_GROUP = '제외한 조직';
export function splitExcluded(list, order) {
  const hidden = new Set(clean(order).hidden), shown = [], excluded = [];
  for (const o of list || []) (hidden.has(String(o?.name ?? '')) ? excluded : shown).push(o);
  excluded.sort((a, b) => String(a?.name ?? '').localeCompare(String(b?.name ?? ''), 'ko'));
  return {shown, excluded};
}

// ---- MULTI-다른담당자맞춤 ②: 조직 보고 화면에서 묶음 만들기·이름 바꾸기·묶음 풀기·끌어 옮기기(시안 #2522) ----
// 값은 같은 org_order 하나(새 저장소 없음). 서버 검사(view-prefs.js·DB)와 같은 한도: 묶음 12개, 묶음마다 조직 1~40곳, 묶음 이름 1~20자.
// 조직이 하나도 없는 묶음은 값에 둘 수 없어서, 화면은 그런 묶음을 '빈 묶음'(이 탭 메모리)으로만 그리고 조직을 끌어 넣는 순간 값에 넣는다.
export const ORG_GROUPS_MAX = 12, ORG_GROUP_ORGS_MAX = 40, GROUP_NAME_MAX = 20;
export const TAIL_GROUP = '그 외';

// 묶음 이름 검사. names: 이미 있는 묶음 이름(값 + 빈 묶음). except: 이름을 바꾸는 그 묶음의 지금 이름.
export function groupNameProblem(name, names = [], except = null) {
  const v = String(name ?? '').trim();
  if (!v) return '묶음 이름을 입력해 주세요.';
  if ([...v].length > GROUP_NAME_MAX) return `묶음 이름은 ${GROUP_NAME_MAX}자까지예요.`;
  if (v === TAIL_GROUP || v === EXCLUDED_GROUP) return `'${v}'는 묶음 이름으로 쓸 수 없어요.`;
  if (names.some(n => n === v && n !== except)) return '같은 이름의 묶음이 이미 있어요.';
  return null;
}

// 화면 칸 나누기. list = 화면에 보일 조직(제외한 조직 뺀 것), pending = 빈 묶음 이름들(값에 없는 것만 씀).
// 돌려주는 칸: {kind:'group', index(값 안 자리), name, orgs} … {kind:'pending', name, orgs:[]} … {kind:'tail', name:'그 외', orgs}(비면 없음)
// 값에 있는 묶음 가운데 이 사람 목록에 그 이름의 조직이 하나도 없는 묶음은 지금처럼 그리지 않는다(명진 화면 그대로).
export function sectionsOf(list, order, pending = []) {
  const out = clean(order), byName = new Map((list || []).map(o => [String(o?.name ?? ''), o])), placed = new Set();
  const sections = out.groups.map((g, index) => {
    const orgs = [];
    for (const n of g.orgs) if (byName.has(n) && !placed.has(n)) { orgs.push(byName.get(n)); placed.add(n); }
    return {kind: 'group', index, name: g.name, orgs};
  });
  const shown = sections.filter(x => x.orgs.length), names = new Set(out.groups.map(g => g.name));
  sections.length = 0; sections.push(...shown);
  for (const p of pending || []) if (!names.has(p)) { sections.push({kind: 'pending', name: p, orgs: []}); names.add(p); }
  const tail = (list || []).filter(o => !placed.has(String(o?.name ?? ''))).sort((a, b) => String(a?.name ?? '').localeCompare(String(b?.name ?? ''), 'ko'));
  if (tail.length) sections.push({kind: 'tail', name: TAIL_GROUP, orgs: tail}); // 빈 '그 외'는 그리지 않는다(끄는 동안만 화면이 잠깐 붙임)
  return sections;
}

// 조직 하나를 옮긴다. to = {group: 묶음 이름 | null(그 외), before: 그 앞에 넣을 조직 이름 | null(맨 끝)}.
// 빈 묶음(값에 없는 이름)으로 옮기면 그 묶음을 groupAt 자리(없으면 맨 끝)에 새로 만든다. 옮긴 뒤 비는 묶음은 값에서 빠진다(emptied로 알림).
export function moveOrg(order, name, to = {}, groupAt = null) {
  const key = String(name ?? ''), out = clean(order);
  if (!key) return {changed: false, value: out};
  const target = to.group == null ? null : String(to.group);
  const from = out.groups.findIndex(g => g.orgs.includes(key)), fromName = from < 0 ? null : out.groups[from].name;
  if (target === null && from < 0) return {changed: false, value: out};
  let emptied = null;
  out.groups = out.groups.map(g => ({name: g.name, orgs: g.orgs.filter(n => n !== key)}));
  if (target !== null) {
    let gi = out.groups.findIndex(g => g.name === target);
    if (gi < 0) {
      if (out.groups.filter(g => g.orgs.length).length >= ORG_GROUPS_MAX) return {changed: false, value: clean(order), error: `묶음은 ${ORG_GROUPS_MAX}개까지예요.`};
      const at = Number.isInteger(groupAt) ? Math.max(0, Math.min(groupAt, out.groups.length)) : out.groups.length;
      out.groups.splice(at, 0, {name: target, orgs: []});
      gi = at;
    }
    const g = out.groups[gi];
    if (g.orgs.length >= ORG_GROUP_ORGS_MAX) return {changed: false, value: clean(order), error: `한 묶음에 조직은 ${ORG_GROUP_ORGS_MAX}곳까지예요.`};
    const at = to.before == null ? -1 : g.orgs.indexOf(String(to.before));
    if (at < 0) g.orgs.push(key); else g.orgs.splice(at, 0, key);
  }
  const kept = [];
  out.groups.forEach(g => { if (g.orgs.length) kept.push(g); else if (g.name === fromName) emptied = g.name; });
  out.groups = kept;
  const changed = JSON.stringify(out) !== JSON.stringify(clean(order));
  return {changed, value: out, emptied};
}

// 묶음 순서: from 자리 묶음을 to 자리로(값 안 자리, 0부터).
export function moveGroup(order, from, to) {
  const out = clean(order);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= out.groups.length) return {changed: false, value: out};
  const dest = Math.max(0, Math.min(to, out.groups.length - 1));
  if (dest === from) return {changed: false, value: out};
  const [g] = out.groups.splice(from, 1);
  out.groups.splice(dest, 0, g);
  return {changed: true, value: out};
}

export function renameGroup(order, index, name) {
  const out = clean(order), v = String(name ?? '').trim();
  if (!out.groups[index]) return {changed: false, value: out};
  const problem = groupNameProblem(v, out.groups.map(g => g.name), out.groups[index].name);
  if (problem) return {changed: false, value: out, error: problem};
  if (out.groups[index].name === v) return {changed: false, value: out};
  out.groups[index] = {name: v, orgs: out.groups[index].orgs};
  return {changed: true, value: out};
}

// 묶음 풀기: 묶음만 지우고 조직은 '그 외'로(조직·기록은 그대로).
export function ungroup(order, index) {
  const out = clean(order);
  if (!out.groups[index]) return {changed: false, value: out};
  out.groups.splice(index, 1);
  return {changed: true, value: out};
}

// 값이 비면(묶음도 제외도 없음) null로 저장한다(설정 지움 = 처음 상태).
export const orderValue = out => (out.groups.length || out.hidden.length ? out : null);
