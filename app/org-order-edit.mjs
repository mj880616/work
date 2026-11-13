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
