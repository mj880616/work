// CALL-통화메뉴·TG-소식메뉴 4단계: the 조직 연결 box shared by the 통화 and 텔레그램 소식 screens (each screen draws the box inside its own
// detail with linkBoxHtml and owns its state; this part only holds the organization picker and the save call).
// 요약 부품 통일 ② (minimal, until the shared summary part lands on main): the summary box starts with the core points
// (feed-model.mjs linkSummaryDefault); [저장] sets the row's organization and adds that summary to the organization's 기록.
import {openAreaOrgPicker, usedKeysNow, orderedOrgGroups} from './area-org-picker.js';
import {linkOrganization, createMyOrganization} from './feed-data.js';
import {similarOrgs} from './org-similar.mjs';
import {linkSummaryDefault} from './feed-model.mjs';

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
export const NONE = '__none__';

// A fresh box state for a row.
export const newLinkBox = row => ({rowId:row.id, orgId:row.organization_id || '', summary:linkSummaryDefault(row), busy:false, status:''});

export function orgName(orgs, id) { return (orgs || []).find(o => o.id === id)?.name || ''; }

export function linkBoxHtml(box, orgs, prefix) {
  if (!box) return '';
  const name = box.orgId ? orgName(orgs, box.orgId) || '선택한 조직' : '조직 선택';
  return `<div class="feed-link" data-${prefix}-link data-enter-save="[data-${prefix}-link-save]">
<div class="feed-link-row"><span class="feed-link-label">조직</span><button type="button" class="feed-small" data-${prefix}-link-pick aria-haspopup="dialog" aria-expanded="false"${box.busy ? ' disabled' : ''}>${esc(name)} ▾</button></div>
<label class="feed-link-label" for="${prefix}LinkSummary">조직 기록에 남길 요약 <span class="feed-faint">비우면 연결만</span></label>
<textarea id="${prefix}LinkSummary" class="feed-link-text" data-${prefix}-link-text rows="4" maxlength="2000"${box.busy ? ' disabled' : ''}>${esc(box.summary)}</textarea>
<div class="feed-link-actions"><span class="feed-status" role="status">${esc(box.status)}</span><button type="button" class="feed-small" data-${prefix}-link-cancel${box.busy ? ' disabled' : ''}>취소</button><button type="button" class="feed-small primary" data-${prefix}-link-save data-enter-save-submit${box.busy ? ' disabled' : ''}>저장</button></div>
</div>`;
}

// One organization picker for both screens (ORG-고르기통일): only my organizations (feed-data.js readOrganizations → mine,
// my-organizations.js) in the shared order (organization-order.js). The organization this row is already linked to stays
// shown even when it is not mine, so the current link can be seen and kept; nothing else outside mine is offered.
// S52-01 ③c UI-사업영역조직고르기창: the sheet is the shared picker (area-org-picker.js), one choice: '연결 안 함' first, the groups
// folded (a press opens one), search and the most used. onPick(id | '') as before.
let pick = null;
// top·title(FORGET-소식바로잡기, 잊지 말기 [조직]): 창 맨 위 한 번에 고르는 줄(예 '조직 › ○○에 넣기')과 창 이름. top이 있으면 '연결 안 함' 줄은 없다.
export async function openOrgPicker(trigger, {orgs, mine, selected, onPick, top = null, title = '연결할 조직'}) {
  pick = {orgs, mine, selected, onPick};
  const order = window.KPTUOrganizationOrder, sel = selected || '';
  const offered = (orgs || []).filter(o => (o.active !== false && mine?.has(o.id)) || o.id === sel);
  const list = order?.forPicker ? order.forPicker(offered, sel ? [sel] : []) : offered;
  const groups = order?.groups ? order.groups(list) : [list];
  const used = await usedKeysNow().catch(() => []);
  if (!trigger?.isConnected) return;
  const mineNow = pick;
  // CALL-상대표시정리 ④: 맨 아래 [직접 쓰기]. 비슷한 이름의 조직(활동 중인 내 작업공간 조직 전체)이 있으면 먼저 보이고, 새로 만들면 그 조직을
  // 이 화면의 조직 목록·내 담당에 더한 뒤 고른 것으로 한다(onPick). 만들기는 feed-data.js createMyOrganization(담당조직 추가와 같은 표) 한 곳.
  const create = {similar:name => similarOrgs(name, (orgs || []).filter(o => o.active !== false)).map(o => ({key:'o:' + o.id, name:o.name || '이름 없는 조직'})),
    make:async name => { const {org} = await createMyOrganization(name); if (Array.isArray(orgs) && !orgs.some(o => o.id === org.id)) orgs.push(org); mine?.add?.(org.id); return {key:'o:' + org.id, name:org.name}; }};
  return openAreaOrgPicker({kind:'org', trigger, used, multi:false, none:'연결 안 함', top, title, orgGroups:orderedOrgGroups(groups), selected:sel ? ['o:' + sel] : [], create,
    onCommit:keys => { if (pick !== mineNow) return; const k = [...keys][0] || ''; mineNow.onPick(k.startsWith('o:') ? k.slice(2) : ''); }});
}

export async function saveLinkBox(row, box, rt = window.KPTURuntime) {
  const result = await linkOrganization(row, box.orgId || null, box.orgId ? box.summary : '', rt);
  if (!result.saved) return {saved:null, text:'이 항목이 그사이 사라졌어요. 목록을 다시 불러왔어요.'};
  const name = orgName(pick?.orgs, box.orgId);
  if (!box.orgId) return {saved:result.saved, text:'조직 연결을 풀었어요.'};
  if (result.recordFailed) return {saved:result.saved, text:`${name || '조직'}에 연결했지만 기록을 남기지 못했어요. 조직 화면에서 직접 남겨 주세요.`};
  return {saved:result.saved, text:result.recorded ? `${name || '조직'}에 연결하고 기록을 남겼어요.` : `${name || '조직'}에 연결했어요.`};
}
