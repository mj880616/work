// CALL-통화메뉴·TG-소식메뉴 4단계: the 조직 연결 box shared by the 통화 and 텔레그램 소식 screens (each screen draws the box inside its own
// detail with linkBoxHtml and owns its state; this part only holds the organization picker and the save call).
// 요약 부품 통일 ② (minimal, until the shared summary part lands on main): the summary box starts with the core points
// (feed-model.mjs linkSummaryDefault); [저장] sets the row's organization and adds that summary to the organization's 기록.
import {createChoiceSheet, orgRow, orgGroupRows} from './choice-sheet.js';
import {linkOrganization} from './feed-data.js';
import {linkSummaryDefault} from './feed-model.mjs';

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
export const NONE = '__none__';

// A fresh box state for a row.
export const newLinkBox = row => ({rowId:row.id, orgId:row.organization_id || '', summary:linkSummaryDefault(row), busy:false, status:''});

export function orgName(orgs, id) { return (orgs || []).find(o => o.id === id)?.name || ''; }

export function linkBoxHtml(box, orgs, prefix) {
  if (!box) return '';
  const name = box.orgId ? orgName(orgs, box.orgId) || '고른 조직' : '조직 고르기';
  return `<div class="feed-link" data-${prefix}-link data-enter-save="[data-${prefix}-link-save]">
<div class="feed-link-row"><span class="feed-link-label">조직</span><button type="button" class="feed-small" data-${prefix}-link-pick aria-haspopup="dialog" aria-expanded="false"${box.busy ? ' disabled' : ''}>${esc(name)} ▾</button></div>
<label class="feed-link-label" for="${prefix}LinkSummary">조직 기록에 남길 요약 <span class="feed-faint">비우면 연결만</span></label>
<textarea id="${prefix}LinkSummary" class="feed-link-text" data-${prefix}-link-text rows="4" maxlength="2000"${box.busy ? ' disabled' : ''}>${esc(box.summary)}</textarea>
<div class="feed-link-actions"><span class="feed-status" role="status">${esc(box.status)}</span><button type="button" class="feed-small" data-${prefix}-link-cancel${box.busy ? ' disabled' : ''}>취소</button><button type="button" class="feed-small primary" data-${prefix}-link-save data-enter-save-submit${box.busy ? ' disabled' : ''}>저장</button></div>
</div>`;
}

// One organization picker for both screens: my organizations first in the shared order (organization-order.js), the rest after.
let sheet = null, pick = null;
export function openOrgPicker(trigger, {orgs, mine, selected, onPick}) {
  pick = {orgs, mine, selected, onPick};
  sheet ||= createChoiceSheet({
    id:'feedOrgSheet', titleId:'feedOrgSheetTitle', historyKey:'kptuFeedOrgSheet',
    canOpen:() => !!pick, choices:async () => true,
    render:() => {
      const order = window.KPTUOrganizationOrder, {orgs: all, mine: my, selected: sel} = pick;
      const active = (all || []).filter(o => o.active !== false || o.id === sel);
      const list = order?.forPicker ? order.forPicker(active, sel ? [sel] : []) : active;
      const mineList = list.filter(o => my?.has(o.id)), rest = list.filter(o => !my?.has(o.id));
      const groups = order?.groups ? order.groups(mineList.length ? mineList : list) : [mineList.length ? mineList : list];
      const row = o => orgRow(o, o.id === sel, esc);
      const others = mineList.length && rest.length ? `<p class="home-choice-group-name">그 외</p><div class="home-choice-org-items">${(order?.sort ? order.sort(rest) : rest).map(row).join('')}</div>` : '';
      const none = `<button type="button" class="home-choice-row home-choice-pick" data-sheet-value="${NONE}" aria-pressed="${!sel}"><span class="home-choice-check" aria-hidden="true"></span><span class="home-choice-name">연결 안 함</span></button>`;
      return {title:'연결할 조직', search:'조직 이름 찾기', html:none + orgGroupRows(groups, row) + others};
    },
    onSelect:(_kind, value) => { const p = pick; if (p) p.onPick(value === NONE ? '' : value); },
  });
  return sheet.open('org', trigger);
}

export async function saveLinkBox(row, box, rt = window.KPTURuntime) {
  const result = await linkOrganization(row, box.orgId || null, box.orgId ? box.summary : '', rt);
  if (!result.saved) return {saved:null, text:'이 항목이 그사이 사라졌어요. 목록을 다시 불러왔어요.'};
  const name = orgName(pick?.orgs, box.orgId);
  if (!box.orgId) return {saved:result.saved, text:'조직 연결을 풀었어요.'};
  if (result.recordFailed) return {saved:result.saved, text:`${name || '조직'}에 연결했지만 기록을 남기지 못했어요. 조직 화면에서 직접 남겨 주세요.`};
  return {saved:result.saved, text:result.recorded ? `${name || '조직'}에 연결하고 기록을 남겼어요.` : `${name || '조직'}에 연결했어요.`};
}
