// ORG-별칭(2026-10-23 사용자 요청 12:43 ③): 담당조직 이름 비교의 유일한 곳. 같은 조직이 '부산지하철노동조합'(Web2 기록)과 '부산지하철노조'
// (주간보고 확정본)처럼 다르게 적혀도 이어 주되, 애매하면(두 조직 이상 맞음) 잇지 않는다.
// 이름은 정식 이름(app_suborganizations.name) + 별칭(같은 행의 aliases 칸, 담당조직 상세 '다른 이름') + 아래 자동 규칙으로 비교한다.
// 자동 규칙(orgKeys): 띄어쓰기·가운뎃점·문장부호·대소문자 무시 / '노동조합' = '노조' / 끝의 '지부'·'지회'는 있어도 없어도 같음.
// 새 저장소를 만들지 않는다. 순수 함수만 둔다(화면·네트워크 없음).

const PUNCT = /[\s·‧․.,()[\]{}<>「」『』'"“”‘’\-–_/]/g;
const clean = s => String(s ?? '').normalize('NFC').toLowerCase().replace(PUNCT, '');

// 기본 키: 띄어쓰기·문장부호 뺀 뒤 '노동조합' → '노조'.
export const orgKey = s => clean(s).replace(/노동조합/g, '노조');
// 접미 없는 키: 끝의 지부·지회까지 뺀 것. 뺐더니 2자 이하가 되면 빼지 않는다('지부'만 남는 이름 방지).
export function orgKeys(s) {
  const key = orgKey(s);
  if (!key) return [];
  const base = key.replace(/(지부|지회)$/, '');
  return base !== key && [...base].length >= 3 ? [key, base] : [key];
}
// 두 이름이 자동 규칙으로 같은 조직 이름인가.
export const sameOrgName = (a, b) => { const x = orgKeys(a); return x.length > 0 && orgKeys(b).some(k => x.includes(k)); };

const namesOf = org => [org?.name, ...(Array.isArray(org?.aliases) ? org.aliases : [])].map(n => String(n ?? '').trim()).filter(Boolean);
// 정식 이름이 띄어쓰기·가운뎃점만 다르게 같은 경우(전부터의 비교와 같은 층).
const exactName = (text, org) => !!clean(text) && clean(text) === clean(org?.name);

// text(기록·확정본의 조직 이름)와 맞는 조직들. orgs = [{name, aliases}]. 정식 이름이 같은 조직이 있으면 그것만(별칭·자동 규칙 충돌보다 앞),
// 없으면 별칭·자동 규칙으로 맞는 조직 전부. 둘 이상이면 호출하는 쪽이 '애매함'으로 본다.
export function matchOrgs(text, orgs) {
  const list = (orgs ?? []).filter(Boolean);
  const exact = list.filter(o => exactName(text, o));
  if (exact.length) return exact;
  return list.filter(o => namesOf(o).some(n => sameOrgName(text, n)));
}
// 딱 하나 맞을 때만 그 조직, 아니면 null(없음·애매 모두).
export function matchOrg(text, orgs) {
  const hits = matchOrgs(text, orgs);
  return hits.length === 1 ? hits[0] : null;
}
// 조직 하나의 모든 이름(정식 + 별칭, 중복 없이) — 이름 목록이 필요한 곳용.
export const orgAllNames = org => [...new Set(namesOf(org))];

// S67-47 ORG-근거만: 글 안에 이름(정식 이름·별칭, 위 자동 규칙 키)이 실제로 적힌 조직들. 조직을 '근거가 있을 때만' 붙이는 곳의 공용 판단.
// 3자 이상 키는 글 안 어디든(띄어쓰기 무시), 2자 키(예: 약칭 두 글자)는 낱말 하나가 그 키와 같을 때만 본다(짧은 글자 오인 방지).
// 한 조직이 맞은 키가 모두 다른 맞은 조직의 더 긴 키 안에 들어 있으면(예: '철도노조' ⊂ '공항철도노조') 짧은 쪽은 뺀다.
export function mentionedOrgs(text, orgs) {
  const hay = orgKey(text);
  if (!hay) return [];
  const words = new Set(String(text ?? '').normalize('NFC').split(/[\s·‧․.,()[\]{}<>「」『』'"“”‘’\-–_/:：]+/).map(orgKey).filter(Boolean));
  const hits = [];
  for (const o of (orgs ?? []).filter(Boolean)) {
    const keys = [...new Set(namesOf(o).flatMap(orgKeys))].filter(k => ([...k].length >= 3 ? hay.includes(k) : [...k].length === 2 && words.has(k)));
    if (keys.length) hits.push({o, keys});
  }
  return hits.filter(h => !hits.some(g => g !== h && h.keys.every(k => g.keys.some(gk => gk.length > k.length && gk.includes(k))))).map(h => h.o);
}
