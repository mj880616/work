// CALL-상대표시정리 ④ [직접 쓰기]: 새 담당조직을 만들기 전에 보여 줄 '비슷한 이름' 조직들(중복 방지). 화면 전용이다.
// 이름 비교 규칙은 org-name-match.mjs 한 곳(서버 사본 supabase/functions/_shared/org-name-match.mjs와 같은 파일이라 여기에 따로 둔다).
// 자동 규칙으로 같은 이름이거나, 노조·노동조합·지부·지회 같은 끝말을 뗀 핵심(2자 이상)이 서로 들어 있으면 비슷하다고 본다.
// 정식 이름·별칭 모두 본다. 많아야 max개. 순수 함수만 둔다(화면·네트워크 없음).
import {orgKey, sameOrgName, orgAllNames} from './org-name-match.mjs';

const coreOf = s => orgKey(s).replace(/(노조|지부|지회|분회|본부|연맹|협의회)+$/, '');
export function similarOrgs(text, orgs, max = 5) {
  const core = coreOf(text);
  if (!orgKey(text)) return [];
  const hit = name => sameOrgName(text, name) || ([...core].length >= 2 && (() => { const c = coreOf(name); return [...c].length >= 2 && (c.includes(core) || core.includes(c)); })());
  return (orgs ?? []).filter(o => o && orgAllNames(o).some(hit)).slice(0, max);
}
