// MTG-사업보고 4단계: '칸 고르기' 창 하나와 칸 바꾸기 저장 하나. [+](칩이 [전체]일 때)·PC 결과 ⋯ → [칸 바꾸기]·결과 창 [칸 바꾸기]가 함께 쓴다.
// 창은 공용 고르기 창(choice-sheet.js: 폰은 아래에서 올라오는 판, PC는 누른 버튼 아래 작은 목록, Esc·뒤로가기로 닫힘)을 그대로 쓴다.
// 저장은 회의 결과 창 수정과 같은 app_meetings REST PATCH(소유자 RLS, 같은 업무공간 조건)이고 activity_kind·updated_at만 보낸다.
// 허용값은 DB CHECK(20261022182319_bizreport_activity_kind)가 다시 막는다. 화면 고르기는 편의일 뿐이다.
import {createChoiceSheet} from './choice-sheet.js';
import {REPORT_KINDS,isReportKind} from './report-kinds.mjs';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let sheet=null,active=null;
function ensureSheet(){
  sheet||=createChoiceSheet({id:'reportKindSheet',titleId:'reportKindSheetTitle',historyKey:'kptuReportKind',
    canOpen:()=>!!active,choices:async()=>{},
    render:()=>({title:active?.title||'칸 고르기',html:REPORT_KINDS.map(k=>`<button type="button" class="home-choice-row home-choice-pick" style="--home-choice-depth:0" data-depth="0" data-sheet-value="${esc(k.value)}" aria-pressed="${k.value===active?.current}" title="${esc(k.label)}"><span class="home-choice-check" aria-hidden="true"></span><span class="home-choice-name">${esc(k.label)}</span></button>`).join('')}),
    // 고르면 창이 닫히는 중이다(choice-sheet가 onSelect 뒤 close). 닫기가 끝난 뒤(뒤로가기 기록 정리·초점 복귀) 다음 창을 연다.
    onSelect:(kind,value)=>{const pick=active?.onPick;if(isReportKind(value))queueMicrotask(()=>sheet.close().then(()=>pick?.(value)))}});
  return sheet;
}
// trigger: 누른 버튼(닫힌 뒤 초점이 돌아감). onPick(value)는 고른 뒤 창이 닫히고 불린다. 닫기·Esc·뒤로가기는 아무것도 하지 않는다.
export function pickReportKind(trigger,{title='칸 고르기',current='',onPick}={}){
  active={title,current,onPick};
  return ensureSheet().open('kind',trigger);
}

// 칸 바꾸기 저장. 돌아온 행이 같은 id·같은 업무공간·고른 칸인지 확인한다(회의 결과 창 수정 저장과 같은 확인).
export async function saveReportKind(id,kind){
  if(!isReportKind(kind))throw new Error('고를 수 없는 칸입니다.');
  const rt=window.KPTURuntime,workspace=rt?.context?.read?.()?.workspace?.id;
  if(!rt?.api||!workspace||!id)throw new Error('로그인 상태를 확인하지 못했습니다.');
  const rows=await rt.api(`/rest/v1/app_meetings?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(workspace)}&select=*`,{method:'PATCH',body:{activity_kind:kind,updated_at:new Date().toISOString()},prefer:'return=representation'});
  const row=Array.isArray(rows)&&rows.length===1?rows[0]:null;
  if(!row||String(row.id)!==String(id)||row.workspace_id!==workspace||row.activity_kind!==kind)throw new Error('칸을 바꾼 결과를 확인하지 못했습니다.');
  await window.__KPTU_RELOAD_MEETINGS__?.();
  window.dispatchEvent(new CustomEvent('kptu:meetings-changed',{detail:{meeting_id:id}}));
  // 바꾼 칸이 지금 칩에 안 보이면 그 칸 칩으로 옮겨 방금 고친 건이 목록에 남게 한다(PC는 그 건을 오른쪽에 보인다).
  window.KPTUMeetingColumns?.select?.({id:String(id)});
  return row;
}
