// S50-7 DESK-주간보고표모양: 조직 순서를 '주간보고(개인본) 순서'로 한 곳에서 읽는다.
// 개인본 순서는 따로 저장하지 않는다 — 그 주 임시저장 draft.proposed(처음 연 바탕 칸 글)의 '산하조직' 칸 열쇠가 바탕(지난 개인본) 순서 그대로다
// (weekly-base.js baseCells → weekly-draft-store.js orgKey). 담당조직 [전체 표]·홈 [주간 정리] 4. 조직보고가 같이 쓴다.
// 바탕이 없거나(처음 쓰는 주) 이름이 안 맞는 조직은 뒤에 앱 조직 순서(organization-order.js)로 둔다.
import {readProposed} from './weekly-feedback.mjs';
import {matchOrgs} from './org-name-match.mjs';

// draft → 바탕 순서의 조직 이름들. 임시저장이 없거나 proposed가 없으면 [].
export function reportOrgNames(draft) {
  const cells = readProposed(draft?.proposed)?.cells ?? [];
  return cells.filter(c => c.section === 'orgs').map(c => String(c.key ?? '').trim()).filter(Boolean);
}
// orgs = [{id, name, aliases?}], names = reportOrgNames 결과, fallback(list) = 나머지 조직 정렬(기본: 이름 가나다).
// 이름이 딱 한 조직에만 맞고 아직 놓이지 않았을 때만 그 자리에 둔다(같은 조직 줄이 여럿이면 둘째 줄은 건너뜀).
export function orderForReport(orgs, names, fallback = list => list) {
  const list = (orgs ?? []).filter(Boolean), placed = [], seen = new Set();
  for (const name of names ?? []) {
    const hits = matchOrgs(name, list);
    if (hits.length === 1 && !seen.has(hits[0])) { seen.add(hits[0]); placed.push(hits[0]); }
  }
  return [...placed, ...fallback(list.filter(o => !seen.has(o)))];
}
