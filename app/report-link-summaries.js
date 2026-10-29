// UPD-요약부품통일 ①: 사업 보고 → 프로젝트·담당조직 연결의 '곳마다 요약 칸'. 요약 칸 옆 작은 [AI 요약]은 바구니·노트 연결과
// 같은 부품(basket-ai-summary.js)·같은 서버 쓰임(ai-assist link_summary, 재료 = 이 사업 보고 본문)을 쓴다.
// 칸이 비면 [AI 요약]이 바로 채우고, 글이 있으면 제안 + [이걸로 바꾸기]. 저장은 [수정 저장](app_meeting_set_links, 곳마다 summary).
// 칸을 비워 두면 지금처럼 사업 보고 본문이 보인다(새 곳은 요약 없음, 이미 저장된 요약은 그대로 — DB 규칙).
// 이 모듈은 칸의 상태만 갖고(곳 → 글·AI 상태), 그리기는 수정 창의 한 상자(#mrdEditSummaries) 하나에만 한다.
import {aiSummaryMarkup,appliedText,newAiState,placeAiSummary,requestLinkSummary} from './basket-ai-summary.js';
import {targetKey,targetList,SUMMARY_LIMIT} from './report-links-model.mjs';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KIND_NAME={project:'사업영역',organization:'담당조직'};

// host: 그릴 상자. nameOf(target): 곳 이름. meetingId(): 지금 고치는 사업 보고 id. rt: 로그인 실행기.
export function createReportSummaries({host,nameOf,meetingId,rt}){
  let targets=[],saved=new Map(),text=new Map(),ai=new Map(),run=0;
  const stateOf=key=>ai.get(key)||ai.set(key,newAiState()).get(key);
  function paint(focus=''){
    if(!host)return;
    host.hidden=!targets.length;
    host.innerHTML=targets.map(t=>{const key=targetKey(t);return `<div class="report-link-summary" data-report-summary="${esc(key)}"><label class="basket-text-label">${esc(KIND_NAME[t.kind]+' · '+(nameOf(t)||''))} 요약 <span class="optional">선택 · 비우면 사업 보고 본문이 보여요</span><textarea data-report-summary-input="${esc(key)}" rows="2" maxlength="${SUMMARY_LIMIT}" spellcheck="false" placeholder="일시·장소·누가·숫자를 빠짐없이">${esc(text.get(key)??'')}</textarea></label>${aiSummaryMarkup(stateOf(key),key,'data-report',esc,{cls:'mini secondary'})}</div>`}).join('');
    if(focus)host.querySelector(focus)?.focus();
  }
  async function runAi(key){
    const t=targets.find(x=>targetKey(x)===key),state=stateOf(key),id=meetingId();
    if(!t||state.busy||!id)return;
    const mine=++run,seq=++state.run;
    Object.assign(state,{busy:true,status:'',retry:false,proposal:''});paint();
    const result=await requestLinkSummary({meetingId:id,targetKind:t.kind,targetId:t.id},{rt});
    // 다른 사업 보고로 바뀌었거나 그 곳을 뺐으면 버린다.
    if(meetingId()!==id||state.run!==seq||!targets.some(x=>targetKey(x)===key)){if(mine===run)paint();return}
    state.busy=false;
    if(!result.ok){state.status=result.message;state.retry=result.retry;paint(`[data-report-ai-run="${CSS.escape(key)}"]`);return}
    const placed=placeAiSummary(text.get(key)??'',result.summary,'수정 저장');
    if(placed.fill!==null)text.set(key,placed.fill);
    state.proposal=placed.proposal;state.status=placed.status;
    paint(placed.fill!==null?`[data-report-summary-input="${CSS.escape(key)}"]`:`[data-report-ai-apply="${CSS.escape(key)}"]`);
  }
  function apply(key,use){
    const state=stateOf(key);if(!state.proposal)return;
    if(use){text.set(key,state.proposal);state.status=appliedText('수정 저장')}else state.status='';
    state.proposal='';paint(use?`[data-report-summary-input="${CSS.escape(key)}"]`:`[data-report-ai-run="${CSS.escape(key)}"]`);
  }
  host?.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b||b.disabled)return;
    if(b.dataset.reportAiRun)void runAi(b.dataset.reportAiRun);
    else if(b.dataset.reportAiApply)apply(b.dataset.reportAiApply,true);
    else if(b.dataset.reportAiDismiss)apply(b.dataset.reportAiDismiss,false);
  });
  host?.addEventListener('input',event=>{const key=event.target.dataset?.reportSummaryInput;if(key!==undefined)text.set(key,event.target.value)});
  return {
    // 수정 창을 열 때: 지금 연결된 곳과 저장된 요약(readReportTargets 결과의 summary). 칸은 저장된 요약으로 시작한다.
    start(list){targets=targetList(list);saved=new Map(list.filter(t=>t.summary).map(t=>[targetKey(t),t.summary]));text=new Map(saved);ai=new Map();run++;paint()},
    // [연결할 곳]에서 곳이 바뀌었을 때: 남은 곳의 글은 그대로, 새 곳은 빈 칸.
    setTargets(list){targets=targetList(list);paint()},
    // 저장된 요약이 바뀌었을 때(늦게 읽힌 연결): 사용자가 아직 고치지 않은 칸만 채운다.
    loadSaved(list){for(const t of list||[]){const key=targetKey(t);if(t.summary&&!text.get(key))text.set(key,t.summary);if(t.summary)saved.set(key,t.summary)}paint()},
    summaries:()=>new Map([...text].filter(([key])=>targets.some(t=>targetKey(t)===key))),
    saved:()=>saved,
    draft:()=>JSON.stringify([...text].sort()),
    afterSave(){saved=new Map([...text].filter(([,v])=>String(v).trim()))},
    clear(){targets=[];saved=new Map();text=new Map();ai=new Map();run++;if(host){host.innerHTML='';host.hidden=true}},
  };
}
