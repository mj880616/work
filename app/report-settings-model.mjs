// MULTI-노조사용자 ②-3(D5, S50-13): 내 프로필 › 보고 설정 칸의 글 ↔ 화면 기억 값(view-prefs.js org_order·report_calendar).
// 담당조직 묶음은 한 줄에 묶음 하나 "묶음 이름: 조직, 조직, …"(쉼표 또는 · 로 나눔). 빈 줄은 건너뛴다.
// 고르기에서 뺄 조직은 쉼표로 나눈 한 줄. 모두 비우면 null(= 설정 지움 → 묶음 없이 가나다순, 빼는 조직 없음).
import {ORG_GROUPS_MAX, ORG_GROUP_ORGS_MAX, ORG_HIDDEN_MAX, orgNameOk, orgGroupNameOk, reportCalendarOk, validValue} from './view-prefs.js';

const splitNames = text => String(text ?? '').split(/[,，·]/).map(s => s.trim()).filter(Boolean);
const uniq = list => [...new Set(list)];

export function formatGroups(orgOrder) {
  return (orgOrder?.groups || []).map(g => `${g.name}: ${(g.orgs || []).join(', ')}`).join('\n');
}
export const formatHidden = orgOrder => (orgOrder?.hidden || []).join(', ');

// {ok:true, value: org_order 또는 null} | {ok:false, error: 일상어 한 줄}
export function parseOrgOrder(groupsText, hiddenText) {
  const groups = [], seen = new Set();
  const lines = String(groupsText ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (const [i, line] of lines.entries()) {
    const at = line.search(/[:：]/);
    if (at < 0) return {ok:false, error:`${i + 1}째 줄: '묶음 이름: 조직, 조직' 모양으로 써 주세요.`};
    const name = line.slice(0, at).trim(), orgs = uniq(splitNames(line.slice(at + 1))).filter(n => !seen.has(n));
    if (!orgGroupNameOk(name)) return {ok:false, error:`${i + 1}째 줄: 묶음 이름은 1~20자로 써 주세요.`};
    if (!orgs.length) return {ok:false, error:`${i + 1}째 줄: 조직을 하나 이상 써 주세요.`};
    if (orgs.length > ORG_GROUP_ORGS_MAX) return {ok:false, error:`${i + 1}째 줄: 한 묶음에 조직은 ${ORG_GROUP_ORGS_MAX}곳까지예요.`};
    if (!orgs.every(orgNameOk)) return {ok:false, error:`${i + 1}째 줄: 조직 이름은 1~60자로 써 주세요.`};
    orgs.forEach(n => seen.add(n));
    groups.push({name, orgs});
  }
  if (groups.length > ORG_GROUPS_MAX) return {ok:false, error:`묶음은 ${ORG_GROUPS_MAX}개까지예요.`};
  const hidden = uniq(splitNames(hiddenText));
  if (hidden.length > ORG_HIDDEN_MAX) return {ok:false, error:`선택에서 뺄 조직은 ${ORG_HIDDEN_MAX}곳까지예요.`};
  if (!hidden.every(orgNameOk)) return {ok:false, error:'선택에서 뺄 조직 이름은 1~60자로 써 주세요.'};
  if (!groups.length && !hidden.length) return {ok:true, value:null};
  const value = {groups, hidden};
  return validValue('org_order', value) ? {ok:true, value} : {ok:false, error:'담당조직 묶음을 다시 확인해 주세요.'};
}

export function parseCalendar(text) {
  const name = String(text ?? '').trim();
  if (!name) return {ok:true, value:null};
  return reportCalendarOk(name) ? {ok:true, value:name} : {ok:false, error:'보고 캘린더 이름은 1~60자로 써 주세요.'};
}

// 설정에 쓴 조직 이름 가운데 내 작업공간 조직 목록에 없는 이름(이름이 정확히 같아야 묶음에 들어간다).
export function unknownNames(orgOrder, organizations) {
  const known = new Set((organizations || []).map(o => String(o?.name ?? '')));
  return uniq([...(orgOrder?.groups || []).flatMap(g => g.orgs), ...(orgOrder?.hidden || [])]).filter(n => !known.has(n));
}
