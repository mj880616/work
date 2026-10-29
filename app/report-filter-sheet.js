// UI-전수디자인점검 F01(10/29): 사업 보고 [거르기 ▾] 창. 사업영역·회의명 두 묶음을 공용 고르기 창(choice-sheet.js) 하나에 보인다.
// 폰은 아래에서 올라오는 판, PC(761px~)는 버튼 바로 아래 작은 목록(공용 규칙). 하나를 누르면 그 값으로 거르고 닫힌다.
// 무엇을 보일지(sections)와 고른 뒤 할 일(onPick)은 team.js가 정한다. 이 파일은 상태를 갖지 않고 기기에 아무것도 저장하지 않는다.
import {createChoiceSheet} from './choice-sheet.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
let sheet = null, current = null;

function rowHtml(key, o, selected) {
  const dot = o.color ? `<span class="filter-chip-dot" style="background-color:${esc(o.color)}" aria-hidden="true"></span>` : '';
  return `<button type="button" class="home-choice-row home-choice-pick" style="--home-choice-depth:0" data-depth="0" data-sheet-value="${esc(key + ':' + o.value)}" aria-pressed="${o.value === selected}" title="${esc(o.label)}"><span class="home-choice-check" aria-hidden="true"></span>${dot}<span class="home-choice-name">${esc(o.label)}</span></button>`;
}
export function reportFilterHtml(sections) {
  return (sections || []).map(s => `<div class="home-choice-org-group" data-sheet-section data-report-filter="${esc(s.key)}"><p class="home-choice-group-name">${esc(s.title)}</p><div class="home-choice-org-items">${s.options.map(o => rowHtml(s.key, o, s.value)).join('')}</div></div>`).join('');
}
export function splitValue(value) {
  const at = String(value).indexOf(':');
  return at < 0 ? null : {key:value.slice(0, at), value:value.slice(at + 1)};
}

export function openReportFilter(trigger, {sections, onPick}) {
  current = {trigger, sections, onPick};
  sheet ||= createChoiceSheet({
    id:'reportFilterSheet', titleId:'reportFilterSheetTitle', historyKey:'kptuReportFilter',
    canOpen:() => !!current && current.trigger.isConnected && !current.trigger.hidden,
    choices:async () => true,
    render:() => ({title:'거르기', html:reportFilterHtml(current?.sections() || [])}),
    onSelect:(_kind, value) => { const pick = splitValue(value); if (pick && current) current.onPick(pick.key, pick.value); },
  });
  return sheet.open('report-filter', trigger);
}
