import {waitHtml, waitInlineHtml, emptyHtml} from './wait-state.js';
import {holdToast as kptuHoldToast} from './small-notice.js'; // UI-작은알림자리: #toast도 위쪽·2초·올려 두면 멈춤(시계 하나)
import './enter-save.js'; // UI-엔터저장: shared Enter-to-save rule for the data-enter-save roots below
import {fileAttrs,menuItemsHtml} from './file-actions.js';
import {syncMoreToggle,bindMoreToggle} from './text-clamp.js';
import {recordLines,markdownSource} from './note-preview.mjs';
import {formatSeoulTime,seoulParts} from './meeting-time.js';
import {readLinkRecords,readRecordPages,linkRecordHtml,mountLinkSummaryEditor} from './basket-link-records.js';
import {createAnchoredMenu} from './anchored-menu.js';
import {followPane} from './follow-pane.js';
let wdFollowed=null; // UI-칸안스크롤하나로: 상세 칸이 마지막으로 머리부터 보여 준 조직
import {recordSheetWanted,openRecordSheet} from './record-sheet.js';
import {requestBasketNote,requestBasketNoteFrom,requestNoteDocOpen,requestNoteDocFrom,takeBasketReturn} from './basket-note-tasks.js';
import {categoryTag,categoryOf,documentCategories,loadDocumentCategories} from './document-categories.js';
import {renderCategoryChips,toggleCategoryOff,detailDefaultOff} from './category-chips.js';
import {lastSeen} from './split-last.js';
import {bigWindowOpen} from './big-window-open.js';
import {hasDoc,sameRecord,recordPatch} from './record-doc.mjs';
import {fillDocViews} from './record-view.js';
import {mountSplitResize} from './split-resize.js';
import {bindDropTarget} from './meeting-compact.js';
import {readLinkedReports,readAllReports,readReportTargets,changeOneTarget,restoreTargets} from './report-links.js';
import {readReportPhotos,reportPhotosHtml,mountReportPhotos} from './report-photos.js';
import {reportTitle,reportKindTag,sameTarget} from './report-links-model.mjs';
import {offerUndoNotice} from './basket-record-delete.js';
import {paintStageLine} from './org-dispute-stage-ui.js';
import {pickFoldHtml,readPickState,bindPickFold} from './pick-fold.mjs'; // UI-고른것접기: 소속 고르기 = 고른 것 + 접힌 '그 외'(맨 위 찾기)
import {paintKeyPeople} from './org-key-people.js'; // ORG-주요인물: 맨 아래 작은 탭의 [주요 인물] 칸 renderer
const wdRt=window.KPTURuntime;
let wdEpoch=0,wdSessionEpoch=0,wdTargetId=null,wdLinks=[],wdLinkError=false,wdLinkEditor=null,wdLinkRun=0,wdLinkPending=false,wdDocs=[],wdDocsError=false,wdDocsRun=0,wdDocBusy=false,wdDocNote={text:'',error:false};
const wdCurrent=(id,epoch=wdEpoch)=>epoch===wdEpoch&&wdTargetId===id&&!document.querySelector('#wdModal')?.classList.contains('hidden');
const wdRecordCurrent=(id,epoch=wdEpoch)=>wdCurrent(id,epoch)&&wdOrg?.id===id&&document.querySelector('#wdModal')?.dataset.orgId===id;
// ORG-주요인물: 상세 맨 아래 작은 탭 [주요 인물][기본 정보][소속][이전 요약]. 고른 탭은 이번 화면 동안 유지(조직을 바꿔도).
let wdTabKey='people';
function wdTab(key,focus=false){const box=document.querySelector('#wdMore');if(!box)return;const tabs=[...box.querySelectorAll('[data-wd-tab]')];if(!tabs.some(t=>t.dataset.wdTab===key))key='people';wdTabKey=key;tabs.forEach(t=>{const on=t.dataset.wdTab===key;t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;if(on&&focus)t.focus({preventScroll:true})});box.querySelectorAll('[data-wd-panel]').forEach(p=>{p.hidden=p.dataset.wdPanel!==key})}
function wdTabKeys(e){const t=e.target.closest?.('[data-wd-tab]');if(!t)return;const tabs=[...t.parentElement.querySelectorAll('[data-wd-tab]')],i=tabs.indexOf(t);let n=-1;if(e.key==='ArrowRight')n=(i+1)%tabs.length;else if(e.key==='ArrowLeft')n=(i-1+tabs.length)%tabs.length;else if(e.key==='Home')n=0;else if(e.key==='End')n=tabs.length-1;if(n<0)return;e.preventDefault();wdTab(tabs[n].dataset.wdTab,true)}
function wdFlushLinks(){if(wdLinkPending&&wdRecordCurrent(wdTargetId))void wdRefreshLinks()}
function wdDisposeLinks(){wdLinkEditor?.dispose();wdLinkEditor=null;wdLinkRun++}
function wdConfirmDiscard(){if(wdLinkEditor?.hasDraft()&&!confirm('저장하지 않은 기록 요약이 있습니다. 이동하면서 버릴까요?'))return false;return !wdUpDirty()||confirm('저장하지 않은 기록 수정이 있습니다. 이동하면서 버릴까요?')}
// NAV-새로고침제자리: the organization open (?view=team&org=<id>) is written to the address (no history entry of its own; a phone window
// keeps its own entry), so a reload opens it again. The address is read once when this module loads and applied when the list is drawn.
let wdPlaced=(()=>{const q=new URLSearchParams(globalThis.location?.search||''),id=q.get('org')||'';return q.get('view')==='team'&&/^[A-Za-z0-9_.:-]{1,80}$/.test(id)?id:null})();
function wdClose(force=false){if(!force&&!wdConfirmDiscard())return false;wdEpoch++;wdUpEditClear();wdSaveRetire();wdTargetId=null;wdLinkPending=false;wdDocsRun++;wdDisposeLinks();wdModal('wdModal',false);wdPaintSelection();wdResetTasks();return true}
let wdUser=null,wdWorkspace=null,wdRole=null,wdOrg=null,wdItems=[],wdUpdates=[],wdTimeline=[],wdTags=[],wdAffiliations=[],wdTimeEdit=null;
const wdE=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const wdApi=(p,o={})=>wdRt.api(p,o);
let wdBasicSequence=0,wdAffSequence=0,wdBasicEditor=null,wdAffEditor=null,wdSaveObservedScope=null;const wdSaveAttempts=new Map();
const wdBasicInputs=['Name','Type','Aliases','Description','Rep','Contact','Members'];
function wdSaveScope(){const epoch=wdRt.session?.epoch?.(),ctx=wdRt.context?.read?.(),owner=wdRt.session?.read?.()?.user?.id;return Number.isInteger(epoch)&&epoch>=0&&owner===wdUser?.id&&ctx?.user?.id===owner&&ctx?.workspace?.id===wdWorkspace?{owner,workspace:wdWorkspace,epoch}:null}
function wdSaveSameScope(s){const now=wdSaveScope();return !!s&&!!now&&['owner','workspace','epoch'].every(k=>now[k]===s[k])}
function wdSaveKey(e){return [e.kind,e.scope.owner,e.scope.workspace,e.scope.epoch,e.id].join(':')}
function wdSaveDraft(kind){return kind==='basic'?JSON.stringify(wdBasicInputs.map(k=>document.querySelector('#wd'+k)?.value??'')):JSON.stringify([...new Set(wdAffSelectedFromDom())].sort())}
function wdSaveCurrent(e){return (e.kind==='basic'?wdBasicEditor===e&&e.sequence===wdBasicSequence:wdAffEditor===e&&e.sequence===wdAffSequence)&&e.view===wdEpoch&&wdRecordCurrent(e.id,e.view)&&wdSaveSameScope(e.scope)&&!document.querySelector(e.kind==='basic'?'#wdBasicForm':'#wdAffModal')?.classList.contains('hidden')}
function wdSaveNotice(e,text,check=false){if(!wdSaveCurrent(e))return;const st=document.querySelector(e.kind==='basic'?'#wdState':'#wdAffStatus');st.textContent=text;st.className='status';if(check){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent='저장 결과 확인';b.onclick=()=>e.kind==='basic'?wdCheckBasic(e):wdCheckAff(e);st.append(document.createTextNode(' '),b)}}
function wdSaveNewEditor(kind){const e={kind,id:wdOrg.id,scope:wdSaveScope(),view:wdEpoch,sequence:kind==='basic'?++wdBasicSequence:++wdAffSequence};if(e.scope)wdSaveObservedScope={...e.scope};if(kind==='basic')wdBasicEditor=e;else wdAffEditor=e;const b=document.querySelector(kind==='basic'?'#wdSave':'#wdAffSave'),a=e.scope&&wdSaveAttempts.get(wdSaveKey(e));b.disabled=!!a?.pending;if(a?.pending){a.done.then(()=>{if(wdSaveCurrent(e)){b.disabled=false;wdSaveNotice(e,'앞선 요청이 끝났습니다. 현재 입력은 유지했습니다.',Object.values(a.stages).includes('unknown'))}})}return e}
function wdSaveMatches(row,body){return Object.entries(body).every(([k,v])=>k==='updated_at'?Number.isFinite(Date.parse(row?.[k])):JSON.stringify(row?.[k])===JSON.stringify(v))}
function wdSaveOrgRow(e,rows,body){const r=Array.isArray(rows)&&rows.length===1&&rows[0];if(!r||r.id!==e.id||r.workspace_id!==e.scope.workspace||!wdSaveMatches(r,body))throw new Error('조직의 저장 결과를 확인하지 못했습니다.');return r}
function wdSavePath(e){return `/rest/v1/app_suborganizations?id=eq.${encodeURIComponent(e.id)}&workspace_id=eq.${encodeURIComponent(e.scope.workspace)}&select=*`}
async function wdSaveReadPages(path,e){const all=[],limit=200;for(let offset=0;;offset+=limit){const rows=await wdApi(path+`&limit=${limit}&offset=${offset}`,{expectedSessionEpoch:e.scope.epoch,singleFlight:false});if(!wdSaveCurrent(e))throw new Error('편집 대상이 바뀌었습니다.');if(!Array.isArray(rows))throw new Error('조회 결과를 확인하지 못했습니다.');all.push(...rows);if(rows.length<limit)return all}}
function wdSaveStart(e,a){a.pending=true;a.done=new Promise(resolve=>a.finish=resolve);e.request=a;wdSaveAttempts.set(wdSaveKey(e),a);document.querySelector(e.kind==='basic'?'#wdSave':'#wdAffSave').disabled=true;wdSaveNotice(e,'저장 중…')}
function wdSaveFinish(e,a){a.pending=false;a.finish();if(e.request===a&&wdSaveCurrent(e))document.querySelector(e.kind==='basic'?'#wdSave':'#wdAffSave').disabled=false}
function wdSaveRetire(){wdBasicSequence++;wdBasicEditor=null;wdAffSequence++;wdAffEditor=null;wdModal('wdAffModal',false)}

// Keep the existing session/auth fallback available when a shared boot context is not installed.
const wdRecordRt={api:wdApi,session:wdRt.session,config:wdRt.config,context:{read:()=>typeof wdRt.context?.read==='function'?(wdRt.context.read()||{}):{user:wdUser,workspace:{id:wdWorkspace}}}};
function wdModal(id,on=true){if(id==='wdAffModal'&&!on){wdAffSequence++;wdAffEditor=null}const el=document.querySelector('#'+id);if(!el)return;el.classList.toggle('hidden',!on);el.setAttribute('aria-hidden',on?'false':'true')}
function wdToast(s){const t=document.querySelector('#toast');if(!t)return;t.textContent=s;kptuHoldToast(t)}
async function wdCtx(){const epoch=wdSessionEpoch;if(!wdRt||!(await wdRt.session.ensure())||epoch!==wdSessionEpoch)return false;const shared=wdRt.context?.read?.()||window.__KPTU_BOOT_CONTEXT__;if(shared?.user?.id&&shared?.workspace?.id){wdUser=shared.user;wdWorkspace=shared.workspace.id;wdRole=shared.membership?.role||null;return true}const user=await wdApi('/auth/v1/user');if(epoch!==wdSessionEpoch)return false;const m=await wdApi(`/rest/v1/app_workspace_members?user_id=eq.${user.id}&select=workspace_id,role&limit=1`);if(epoch!==wdSessionEpoch||!m?.length)return false;wdUser=user;wdWorkspace=m[0].workspace_id;wdRole=m[0].role;return true}
// MTG-사업보고 6단계: 이 조직에 연결된 사업 보고(모든 종류) 묶음. 연결은 연결 표의 '출처 회의' 줄(report-links.js) 하나라, 사업 보고 쪽에서 연결해도
// 여기서 [연결]로 골라도 같은 줄이다. 줄은 [종류] 이름·차수·날짜, 누르면 사업 보고 결과 창이 겹쳐 열린다. ⋯ → [연결 해제](5초 되돌리기).
let wdReports=[],wdReportsFor='',wdReportRun=0,wdReportsFailed=false,wdReportPhotos=new Map(); // ACT-사진 5단계: 사업 보고 번호 → 그림 자료(줄 오른쪽 작은 그림 3장 + 외 n장)
function wdReportRow(m,can){const t=reportTitle(m),strip=reportPhotosHtml(m.id,wdReportPhotos);return `<div class="wd-doc-row" data-wd-report="${wdE(m.id)}"><button type="button" class="wd-doc-main wd-report-main${strip?' has-report-photos':''}" data-wd-report-open="${wdE(m.id)}"><b><span class="report-kind-tag" data-report-kind-tag>${wdE(reportKindTag(m))}</span>${wdE(t)}</b><small>${m.meeting_at?wdE(formatSeoulTime(m.meeting_at,{year:'numeric',month:'numeric',day:'numeric'})):''}</small>${m.linkSummary?`<small class="report-link-summary-line" data-report-link-summary>${wdE(m.linkSummary)}</small>`:''}${strip}</button>${can?`<details class="wd-doc-more"><summary class="icon-btn" aria-label="사업 보고 관리: ${wdE(t)}"><span class="more-dots" aria-hidden="true">⋯</span></summary><div class="wd-doc-panel" role="group" aria-label="사업 보고 관리"><button type="button" data-wd-report-unlink="${wdE(m.id)}">연결 해제</button></div></details>`:''}</div>`}
function wdPaintReports(){const box=document.querySelector('#wdReportBody'),n=document.querySelector('#wdReports [data-wd-report-count]');if(!box)return;const can=!!wdOrg?.canEdit;if(n){n.textContent=wdReports.length;n.hidden=!wdReports.length}
  box.innerHTML=wdReportsFailed?'<div class="status error" role="status">사업 보고를 불러오지 못했습니다. <button type="button" data-wd-report-retry>다시 불러오기</button></div>':wdReports.length?`<div class="wd-doc-lines">${wdReports.map(m=>wdReportRow(m,can)).join('')}</div>`:'';mountReportPhotos(box,{isCurrent:()=>wdReportsFor===wdOrg?.id})}
async function wdLoadReports(){const id=wdTargetId,run=++wdReportRun;try{const r=await readLinkedReports({kind:'organization',id});if(run!==wdReportRun||wdTargetId!==id)return;const photos=await readReportPhotos(r.rows).catch(e=>{console.warn('org report photos read failed',e);return new Map()});if(run!==wdReportRun||wdTargetId!==id)return;wdReports=r.rows;wdReportPhotos=photos;wdReportsFor=id;wdReportsFailed=false}catch(e){if(run!==wdReportRun||wdTargetId!==id)return;console.warn('org reports read failed',e);wdReports=[];wdReportPhotos=new Map();wdReportsFor=id;wdReportsFailed=true}wdPaintReports()}
async function wdReportLinkPick(trigger){
  const id=wdTargetId;if(!id||!wdOrg?.canEdit)return;
  try{const all=await readAllReports();const picker=await import('./report-places-sheet.js');
    await picker.pickReport(trigger,{reports:all,linkedIds:new Set(wdReports.map(m=>m.id)),title:'이 조직에 연결할 사업 보고',onPick:async mid=>{
      const r=await changeOneTarget(mid,{kind:'organization',id},'add');
      if(!r.ok){wdToast(r.message||'연결하지 못했습니다.');return}
      if(r.legacy){wdToast('담당조직 연결은 서버 준비가 끝난 뒤에 저장돼요.');return}
      wdToast('사업 보고를 연결했습니다.');window.dispatchEvent(new CustomEvent('kptu:meetings-changed',{detail:{meeting_id:mid}}))}})}
  catch(e){wdToast(e.message||'사업 보고 목록을 불러오지 못했습니다.')}
}
async function wdReportUnlink(mid){
  const id=wdTargetId;if(!id||!wdOrg?.canEdit)return;const target={kind:'organization',id};
  try{
    const now=await readReportTargets(mid),mine=now.find(t=>sameTarget(t,target));
    if(mine?.hasSummary&&!confirm('이 연결에 보낸 기록이 있어요. 연결을 해제하면 그 기록도 함께 지워져요. 해제할까요?'))return;
    const r=await changeOneTarget(mid,target,'remove');
    if(!r.ok){wdToast(r.message||'연결을 해제하지 못했습니다.');return}
    window.dispatchEvent(new CustomEvent('kptu:meetings-changed',{detail:{meeting_id:mid}}));
    if(mine?.hasSummary){wdToast('연결과 보낸 기록을 지웠습니다.');return}
    offerUndoNotice({text:'연결을 해제했어요. 사업 보고는 남아요.',onUndo:async()=>{const back=await restoreTargets(mid,r.previous);if(!back.ok)return {status:'failed',message:back.message||'되돌리지 못했어요.'};window.dispatchEvent(new CustomEvent('kptu:meetings-changed',{detail:{meeting_id:mid}}));return {status:'restored',message:'연결을 되돌렸어요.'}}});
  }catch(e){wdToast(e.message||'연결을 해제하지 못했습니다.')}
}
async function wdReportOpen(mid){try{const {openReport}=await import('./report-open.js');await openReport(mid)}catch(e){console.error('org report open',e);wdToast('사업 보고를 열지 못했습니다.')}}
async function wdReportAddNew(){const id=wdTargetId;if(!id||!wdOrg?.canEdit)return;try{const loader=window.KPTUViewLoader;if(!loader?.isLoaded?.('meetings'))await loader?.load?.('meetings');if(!window.KPTUReportEntry)throw new Error('x');await window.KPTUReportEntry.open({targets:[{kind:'organization',id}],trigger:document.activeElement})}catch{wdToast('기능을 불러오지 못했습니다.')}}
function wdReportClick(e){
  const b=e.target.closest?.('#wdReports button');if(!b)return;
  if(b.id==='wdReportLink'){void wdReportLinkPick(b);return}
  if(b.id==='wdReportAdd'){void wdReportAddNew();return}
  if(b.dataset.wdReportOpen){void wdReportOpen(b.dataset.wdReportOpen);return}
  if(b.dataset.wdReportUnlink){b.closest('details')?.removeAttribute('open');void wdReportUnlink(b.dataset.wdReportUnlink);return}
  if('wdReportRetry' in b.dataset)void wdLoadReports();
}
window.addEventListener('kptu:meetings-changed',()=>{if(wdTargetId&&wdOrg?.id===wdTargetId)void wdLoadReports()});
function wdInstall(){if(document.querySelector('#wdModal'))return;document.body.insertAdjacentHTML('beforeend',`<div id="wdModal" class="modal hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="wdTitle"><div class="modal-card medium-card wd-card"><div class="modal-head"><div><h2 id="wdTitle">조직 상세</h2></div><button class="icon-btn" data-wd-close="wdModal" type="button" aria-label="닫기">×</button></div><div id="wdStage" class="wd-stage"></div><div id="wdPreMeeting" class="pms-line-host" hidden></div><div id="wdInbox" class="wd-inbox" data-enter-save><textarea id="wdInboxText" rows="4" aria-label="기록 입력" placeholder="통화·회의·교섭 내용을 그냥 적으세요"></textarea><div class="wd-inbox-actions"><div id="wdInboxState" class="status" role="status"></div><button id="wdInboxBig" class="secondary wd-inbox-big" type="button" aria-haspopup="dialog" aria-label="크게" title="큰 창에서 쓰기"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="wd-inbox-big-label">크게</span></button><button id="wdInboxSave" data-enter-save-submit class="primary" type="button">저장</button></div></div><section class="wd-sec" id="wdTasks"><div class="wd-head"><div><h3>할 일 <span class="wd-count" data-wd-task-count hidden></span></h3></div><div class="wd-task-actions"><button id="wdTaskLink" class="wd-text-btn" type="button">기존 할 일 연결</button><button id="wdTaskAdd" class="wd-add-plus" type="button" aria-label="할 일 추가">+</button></div></div><div id="wdTaskBody" class="gt-linked gt-status"></div></section><section class="wd-sec" id="wdDocs"><div class="wd-head"><div><h3>자료 <span class="wd-count" data-wd-doc-count hidden></span></h3></div><div class="wd-task-actions"><button id="wdDocAdd" class="wd-add-plus" type="button" aria-label="자료 올리기" data-wd-doc-add hidden>+</button></div></div><div id="wdDocKinds" class="doc-kind-chips" hidden></div><div id="wdDocBody" class="wd-doc-body"></div></section><section class="wd-sec" id="wdReports"><div class="wd-head"><div><h3>사업 보고 <span class="wd-count" data-wd-report-count hidden></span></h3></div><div class="wd-task-actions"><button id="wdReportLink" class="wd-text-btn" type="button">연결</button><button id="wdReportAdd" class="wd-add-plus" type="button" aria-label="사업 보고 추가">+</button></div></div><div id="wdReportBody" class="wd-doc-body"></div></section><section class="wd-sec" id="wdLog"><div class="wd-head"><div><h3>기록</h3></div></div><div id="wdUpdates"></div></section><section class="wd-sec"><details id="wdTime"><summary><div><h3>연도별 타임라인</h3><small>중요 일정만 기록. 반복 교섭·회의는 횟수로 통합</small></div></summary><div class="wd-right"><button id="wdAddTime" class="secondary" type="button">+ 일정</button></div><div id="wdTimeline"></div></details></section><section class="wd-sec" id="wdMoreSec"><div id="wdMore" class="wd-tabs-box"><div class="wd-tabs" role="tablist" aria-label="조직 정보"><button type="button" role="tab" id="wdTab_people" class="wd-tab" data-wd-tab="people" aria-controls="wdPanel_people" aria-selected="true" tabindex="0">주요 인물<span class="wd-tab-n" data-wd-tab-count></span></button><button type="button" role="tab" id="wdTab_basic" class="wd-tab" data-wd-tab="basic" aria-controls="wdPanel_basic" aria-selected="false" tabindex="-1">기본 정보</button><button type="button" role="tab" id="wdTab_aff" class="wd-tab" data-wd-tab="aff" aria-controls="wdPanel_aff" aria-selected="false" tabindex="-1">소속</button><button type="button" role="tab" id="wdTab_recent" class="wd-tab" data-wd-tab="recent" aria-controls="wdPanel_recent" aria-selected="false" tabindex="-1">이전 요약</button></div><div role="tabpanel" id="wdPanel_people" class="wd-tabpanel" data-wd-panel="people" aria-labelledby="wdTab_people"><div id="wdPeople" class="okp"></div></div><div role="tabpanel" id="wdPanel_basic" class="wd-tabpanel" data-wd-panel="basic" aria-labelledby="wdTab_basic" hidden><div class="wd-sub" id="wdBasic"><div class="wd-head"><div><small>기본값은 읽기전용이며 필요할 때만 수정합니다.</small></div><button id="wdEditBasic" class="secondary" type="button">수정</button></div><div id="wdBasicView" class="wd-basic-view"></div><div id="wdBasicForm" class="hidden" data-enter-save><div class="two-col"><label>조직 명칭<input id="wdName"></label><label>조직 유형<input id="wdType"></label><label>다른 이름(보고서 표기 등)<input id="wdAliases" placeholder="쉼표로 구분"></label><label>대표자명<input id="wdRep"></label><label>대표자 연락처<input id="wdContact"></label><label>총조합원수<input id="wdMembers" type="number" min="0"></label></div><label>설명<textarea id="wdDescription" rows="3"></textarea></label><div class="wd-basic-actions"><button id="wdCancelBasic" class="ghost" type="button">취소</button><button id="wdSave" data-enter-save-submit class="primary" type="button">저장</button></div></div><div class="wd-updated">정보 최종 수정 <b id="wdUpdated">-</b></div></div></div><div role="tabpanel" id="wdPanel_aff" class="wd-tabpanel" data-wd-panel="aff" aria-labelledby="wdTab_aff" hidden><div class="wd-sub"><div class="wd-head"><div><h4>협의회·사업단</h4><small>여러 협의회와 사업단에 중복 소속 가능</small></div><button id="wdAffManage" class="secondary" type="button">소속 관리</button></div><div id="wdAffChips" class="wd-aff-chips"></div></div></div><div role="tabpanel" id="wdPanel_recent" class="wd-tabpanel" data-wd-panel="recent" aria-labelledby="wdTab_recent" hidden><div class="wd-sub" id="wdRecent"><div class="wd-head"><div><small>이전 요약·메모입니다. 읽기 전용이며 메모는 삭제만 할 수 있습니다.</small></div></div><div class="wd-summary-grid"><article class="wd-summary-card"><span>최근 1달</span><p id="wdMonthSummary"></p></article><article class="wd-summary-card"><span>올해 요약</span><p id="wdYearSummary"></p></article></div><div id="wdItems"></div></div><div class="wd-sub" id="wdReportSlot"></div></div></div></section><div id="wdState" class="status"></div></div></div><div id="wdAffModal" class="modal hidden"><div class="modal-card small-card"><div class="modal-head"><div><h2>협의회·사업단 소속</h2></div><button class="icon-btn" data-wd-close="wdAffModal">×</button></div><p class="muted">여러 협의회·사업단을 함께 고를 수 있습니다.</p><div id="wdAffChoices"></div><div class="wd-aff-create" data-enter-save><select id="wdAffNewKind"><option value="council">협의회</option><option value="taskforce">사업단</option></select><input id="wdAffNewName" type="text" maxlength="100" placeholder="새 협의회·사업단 이름"><button id="wdAffCreate" data-enter-save-submit class="secondary" type="button">추가</button></div><div class="modal-action-footer"><div id="wdAffStatus" class="status"></div><button id="wdAffSave" class="primary wide" type="button">소속 저장</button></div></div></div><div id="wdTimeModal" class="modal hidden" data-enter-save><div class="modal-card small-card"><div class="modal-head"><h2 id="wdTimeTitle">타임라인 추가</h2><button class="icon-btn" data-wd-close="wdTimeModal">×</button></div><div class="two-col"><label>연도<input id="wdTimeYear" type="number" min="2000" max="2100"></label><label>날짜<input id="wdTimeDate" type="date"></label></div><div class="two-col"><label>구분<select id="wdTimeCat"><option>협약체결</option><option>집회</option><option>교섭</option><option>회의</option><option>교육</option><option>파업</option><option>기타</option></select></label><label>반복 횟수<input id="wdTimeCount" type="number" min="1" value="1"></label></div><label>제목<input id="wdTimeName"></label><label>설명<textarea id="wdTimeBody" rows="4"></textarea></label><div class="modal-action-footer"><button id="wdTimeSave" data-enter-save-submit class="primary wide">저장</button></div></div></div>`)}
async function wdLoad(id,epoch=wdEpoch){const linkRun=wdLinkRun;const [o,i,t,a,tags,aff,up,links,docs]=await Promise.all([wdApi(`/rest/v1/app_suborganizations?id=eq.${id}&workspace_id=eq.${wdWorkspace}&select=id,name,aliases,description,organization_type,representative_name,contact,member_count,recent_month_summary,year_summary,created_by,updated_at&limit=1`),wdApi(`/rest/v1/app_suborganization_status_items?organization_id=eq.${id}&select=*&order=updated_at.desc,created_at.desc`),wdApi(`/rest/v1/app_suborganization_timeline?organization_id=eq.${id}&select=*&order=event_year.desc,event_date.desc.nullslast,sort_order.asc`),wdApi(`/rest/v1/app_suborganization_assignees?organization_id=eq.${id}&user_id=eq.${wdUser.id}&select=user_id&limit=1`),wdApi(`/rest/v1/app_org_affiliation_tags?workspace_id=eq.${wdWorkspace}&active=eq.true&select=id,name,kind,created_by&order=kind.asc,name.asc`),wdApi(`/rest/v1/app_suborganization_affiliations?organization_id=eq.${id}&select=tag_id,created_at`),readRecordPages(`/rest/v1/app_suborganization_updates?organization_id=eq.${id}&select=id,occurred_at,raw_text,detail_text,doc&order=occurred_at.desc,id.desc`,wdRecordRt),readLinkRecords({kind:'organization',targetIds:[id],noteKinds:['basket','note']},wdRecordRt).then(rows=>({rows}),()=>({error:true})),wdReadDocs(id).then(rows=>({rows}),()=>({error:true}))]);if(!wdCurrent(id,epoch))return false;const org=o?.[0];if(org?.id!==id)throw new Error('조직 정보를 찾지 못했습니다.');wdOrg=org;if(linkRun===wdLinkRun){wdLinks=links.rows||[];wdLinkError=!!links.error}wdDocsRun++;wdDocs=docs.rows||[];wdDocsError=!!docs.error;wdOrg.canEdit=['owner','admin'].includes(wdRole)||wdOrg.created_by===wdUser.id||!!a?.length;wdItems=i||[];wdTimeline=t||[];wdTags=tags||[];wdAffiliations=aff||[];wdUpdates=up||[];wdRender();wdFlushLinks();return true}
function wdRenderAff(){const box=document.querySelector('#wdAffChips');if(!box)return;const ids=new Set(wdAffiliations.map(x=>x.tag_id));const selected=wdTags.filter(x=>ids.has(x.id));box.innerHTML=selected.length?selected.map(x=>`<span class="wd-aff-chip ${x.kind==='taskforce'?'taskforce':''}">${wdE(x.name)}</span>`).join(''):'<span class="updated">소속 협의회·사업단 없음</span>'}
function wdRenderBasicView(){const box=document.querySelector('#wdBasicView');if(!box)return;const aliases=(wdOrg.aliases||[]).join(', ')||'없음';box.innerHTML=`<dl class="wd-basic-grid"><div><dt>조직 명칭</dt><dd>${wdE(wdOrg.name||'-')}</dd></div><div><dt>조직 유형</dt><dd>${wdE(wdOrg.organization_type||'미분류')}</dd></div><div><dt>대표자</dt><dd>${wdE(wdOrg.representative_name||'미입력')}</dd></div><div><dt>조합원수</dt><dd>${wdOrg.member_count==null?'미입력':Number(wdOrg.member_count).toLocaleString('ko-KR')+'명'}</dd></div><div><dt>대표자 연락처</dt><dd>${wdE(wdOrg.contact||'미입력')}</dd></div><div><dt>다른 이름(보고서 표기 등)</dt><dd>${wdE(aliases)}</dd></div><div class="wide"><dt>설명</dt><dd>${wdE(wdOrg.description||'미입력')}</dd></div></dl>`}
function wdSetBasicEditing(on){if(on&&wdOrg?.canEdit)wdSaveNewEditor('basic');else if(!on){wdBasicSequence++;wdBasicEditor=null}const form=document.querySelector('#wdBasicForm'),view=document.querySelector('#wdBasicView'),edit=document.querySelector('#wdEditBasic');form?.classList.toggle('hidden',!on);view?.classList.toggle('hidden',on);if(edit)edit.classList.toggle('hidden',on||!wdOrg?.canEdit);if(on)document.querySelector('#wdName')?.focus()}
// FEAT-1029묶음 ②: 제목 아래 '다가오는 교섭 … — 한 장 ›'·접힌 '지난 한 장 n ›'(그리기·열기는 pre-meeting-sheet.js 하나).
function wdPreMeetingLine(){const host=document.querySelector('#wdPreMeeting'),org=wdOrg;if(!host||!org)return;if(host.dataset.orgId!==org.id){host.hidden=true;host.replaceChildren();host.dataset.orgId=org.id}void import('./pre-meeting-sheet.js').then(m=>{if(wdOrg?.id===org.id)return m.paintOrgLine(host,{orgId:org.id,orgName:org.name})}).catch(()=>{})}
window.addEventListener('kptu:pre-meeting-sheets-changed',()=>{if(wdOrg&&!document.querySelector('#wdModal')?.classList.contains('hidden'))wdPreMeetingLine()});
function wdRender(){if(wdOrg?.id!==wdTargetId)return;if(wdReportsFor!==wdOrg.id)void wdLoadReports();else wdPaintReports();document.querySelector('#wdModal').dataset.orgId=wdOrg.id;const can=wdOrg.canEdit;document.querySelector('#wdTitle').textContent=wdOrg.name;document.querySelector('#wdName').value=wdOrg.name||'';document.querySelector('#wdType').value=wdOrg.organization_type||'';document.querySelector('#wdAliases').value=(wdOrg.aliases||[]).join(', ');document.querySelector('#wdDescription').value=wdOrg.description||'';document.querySelector('#wdRep').value=wdOrg.representative_name||'';document.querySelector('#wdContact').value=wdOrg.contact||'';document.querySelector('#wdMembers').value=wdOrg.member_count??'';document.querySelector('#wdMonthSummary').textContent=wdOrg.recent_month_summary||'없음';document.querySelector('#wdYearSummary').textContent=wdOrg.year_summary||'없음';document.querySelector('#wdUpdated').textContent=wdOrg.updated_at?formatSeoulTime(wdOrg.updated_at,{year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric'}):'-';['wdInbox','wdTaskAdd','wdTaskLink','wdReportLink','wdReportAdd','wdEditBasic','wdAffManage','wdAddTime'].forEach(x=>document.querySelector('#'+x)?.classList.toggle('hidden',!can));wdSetBasicEditing(false);wdRenderBasicView();wdRenderAff();wdRenderUpdates();wdRenderDocs();wdRenderItems();paintStageLine({host:document.querySelector('#wdStage'),orgId:wdOrg.id,orgName:wdOrg.name,workspaceId:wdWorkspace,canEdit:can,rt:wdRt});wdPreMeetingLine();paintKeyPeople({host:document.querySelector('#wdPeople'),orgId:wdOrg.id,orgName:wdOrg.name,workspaceId:wdWorkspace,canEdit:can,rt:wdRt});wdTab(wdTabKey);const by={};wdTimeline.forEach(x=>(by[x.event_year]??=[]).push(x));document.querySelector('#wdTimeline').innerHTML=wdTimeline.length?Object.keys(by).sort((a,b)=>b-a).map(y=>`<div class="wd-year">${y}년</div>${by[y].map(x=>`<div class="wd-time"><small>${wdE(x.event_date||x.event_year)}<br>${wdE(x.category)}</small><div><b>${wdE(x.title)}${x.occurrence_count>1?`<span class="wd-count">${x.occurrence_count}차례</span>`:''}</b>${x.summary?`<p>${wdE(x.summary)}</p>`:''}</div>${can?`<div class="wd-actions"><button data-wd-time-edit="${x.id}">수정</button><button class="wd-danger" data-wd-time-del="${x.id}">삭제</button></div>`:''}</div>`).join('')}`).join(''):emptyHtml();window.dispatchEvent(new CustomEvent('kptu:workplace-detail-rendered',{detail:{id:wdOrg.id,name:wdOrg.name}}));wdPaintWhere()}
function wdRenderUpdates(){if(!wdRecordCurrent(wdTargetId))return;const box=document.querySelector('#wdUpdates');if(!box)return;if(wdLinkEditor?.hasDraft()||wdUpEditing(box))return;const can=!!wdOrg?.canEdit,rows=[...wdUpdates,...wdLinks].sort((a,b)=>(Date.parse(b.occurred_at)||0)-(Date.parse(a.occurred_at)||0)||String(a.type||'').localeCompare(String(b.type||''))||String(a.id).localeCompare(String(b.id)));box.innerHTML=rows.length?rows.map(x=>x.type==='basket'?linkRecordHtml(x):`<div class="wd-row wd-log-row" data-wd-up="${wdE(x.id)}"><div class="wd-rowtop"><div class="wd-log-main"><small>${x.occurred_at?wdE(formatSeoulTime(x.occurred_at,{year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric'})):''}</small>${hasDoc(x)?`<div class="wd-doc" data-rec-doc="${wdE(x.id)}"></div>`:`<p class="kptu-clamp"${markdownSource(x.raw_text)?` data-md-raw="${wdE(markdownSource(x.raw_text))}"`:''}>${wdE(recordLines(x.raw_text))}</p>`}${x.detail_text?`<p class="kptu-clamp"><b>상세:</b> ${wdE(recordLines(x.detail_text))}</p>`:''}</div>${can?`<button type="button" class="wd-up-more" data-wd-up-menu="${wdE(x.id)}" aria-label="기록 메뉴" aria-haspopup="true" aria-expanded="false" aria-controls="wdUpMenu"><span class="more-dots" aria-hidden="true">⋯</span></button>`:''}</div></div>`).join(''):emptyHtml();if(wdLinkError)box.insertAdjacentHTML('beforeend','<div class="status error" role="status">정리함 연결 기록을 불러오지 못했습니다. <button type="button" data-wd-link-retry>다시 불러오기</button></div>');fillDocViews(box,wdUpdates);wdMountLinks();wdClampSync()}
const WD_CLAMP='.wd-log-main p,.wd-log-main .wd-doc,[data-link-summary-text]';
function wdClampSync(){const box=document.querySelector('#wdUpdates');if(!box)return;bindMoreToggle(box,WD_CLAMP);syncMoreToggle(box,WD_CLAMP)}
function wdMountLinks(){const host=document.querySelector('#wdUpdates'),id=wdTargetId,epoch=wdEpoch;if(!host||!id||wdLinkEditor||!wdRecordCurrent(id,epoch))return;wdLinkEditor=mountLinkSummaryEditor(host,{getRecord:id=>wdLinks.find(row=>row.id===id),getName:()=>wdOrg?.name||'',onBig:field=>void wdBigSummary(field),onOpenNote:(note,kind,info)=>{const full=()=>{const m=document.querySelector('#wdModal'),tracked=m?.dataset.kptuHistoryOpen==='1',from=wdOrg&&window.KPTURouter?.current==='team'?{view:'team',id:wdOrg.id,name:wdOrg.name,scroll:wdScroll()}:null;if(!wdClose())return;const back=tracked&&history.state?.kptuOverlay==='wdModal';const go=()=>{if(kind==='note'){if(from)requestNoteDocFrom(note,from,wdRecordRt);else requestNoteDocOpen(note,wdRecordRt)}else if(from)requestBasketNoteFrom(note,from,wdRecordRt);else requestBasketNote(note,wdRecordRt);window.KPTURouter?.go('basket',{source:'delegated'})};if(back)window.addEventListener('popstate',()=>queueMicrotask(go),{once:true});else go()};const sheetRow=info?.line&&recordSheetWanted()?wdLinks.find(r=>r.id===info.linkId):null;if(sheetRow){openRecordSheet({row:sheetRow,place:wdOrg?.name||'',trigger:info.trigger,onOpenFull:()=>{if(wdRecordCurrent(id,epoch))full()}});return}full()},isCurrent:()=>wdRecordCurrent(id,epoch),onUpdated:async row=>{if(!wdRecordCurrent(id,epoch))return;wdLinkRun++;wdLinks=wdLinks.map(old=>old.id===row.id?row:old);const el=[...host.querySelectorAll('[data-basket-link]')].find(el=>el.dataset.basketLink===row.id);if(el){el.outerHTML=linkRecordHtml(row);wdClampSync()}}},wdRecordRt)}
async function wdRefreshLinks(){const id=wdTargetId,epoch=wdEpoch;if(!id)return;if(!wdRecordCurrent(id,epoch)){wdLinkPending=true;return}const run=++wdLinkRun;wdLinkPending=false;try{const rows=await readLinkRecords({kind:'organization',targetIds:[id],noteKinds:['basket','note']},wdRecordRt);if(!wdRecordCurrent(id,epoch)||run!==wdLinkRun)return;wdLinks=rows;wdLinkError=false}catch{if(!wdRecordCurrent(id,epoch)||run!==wdLinkRun)return;wdLinkError=true}wdRenderUpdates()}

// UI-바구니첨부메모 PR 3 ⑨⑩: 이 조직에 붙은 자료(app_documents.organization_id). 프로젝트 상세의 [자료] 묶음과 같은 모양: 최근 5개 + "전체 N개 보기 ›".
// 파일은 자료실(Drive)에 하나뿐이고 여기는 붙어 있다는 표시만이다. 줄 ⋯ 의 [조직에서 빼기]는 붙임만 풀고 자료·파일은 그대로 둔다.
const WD_DOC_ROWS=5;
function wdReadDocs(id){return readRecordPages(`/rest/v1/app_documents?organization_id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(wdWorkspace)}&select=id,title,file_name,mime_type,file_id,category,document_date,drive_url,created_at&order=document_date.desc.nullslast,created_at.desc,id.asc`,wdRecordRt)}
function wdDocRow(x,can){const fa={name:x.file_name||x.title||'',mime:x.mime_type||'',documentId:x.file_id?x.id:'',driveId:x.file_id||'',driveUrl:x.drive_url||''},title=x.title||x.file_name||'파일',main=`<b>${wdE(title)}</b><small>${categoryTag(x.category)}${x.document_date?' '+wdE(x.document_date):''}</small>`;return `<div class="wd-doc-row" data-wd-doc="${wdE(x.id)}">${x.drive_url?`<a class="wd-doc-main" href="${wdE(x.drive_url)}" target="_blank" rel="noopener"${fileAttrs(fa,{press:true})}>${main}</a>`:`<div class="wd-doc-main">${main}</div>`}${can?`<details class="wd-doc-more"><summary class="icon-btn" aria-label="자료 관리: ${wdE(title)}"><span class="more-dots" aria-hidden="true">⋯</span></summary><div class="wd-doc-panel" role="group" aria-label="자료 관리">${menuItemsHtml(fa,{attrs:fileAttrs(fa),attr:'data-fa-menu'})}<button type="button" data-wd-doc-remove="${wdE(x.id)}">조직에서 빼기</button></div></details>`:''}</div>`}
// LIB-조직프로젝트자료종류: [자료] 위의 종류 칩은 자료실과 같은 칩 코드(category-chips.js)이고, 꺼 둔 종류는 이 조직을 열어 두는 동안만 기억한다(저장 안 함).
// 처음엔 모두 켜져 있어('회의' 포함, category-chips.js DETAIL_DEFAULT_OFF) 자료가 숨지 않는다. 거르는 건 줄 보이기뿐이라 위의 자료 수와 [전체 N개 보기]는 이 조직의 전체 자료 기준 그대로다.
let wdDocOff=detailDefaultOff(),wdDocOffFor='';
function wdToggleDocKind(value){wdDocOff=toggleCategoryOff(documentCategories(),wdDocOff,value);wdRenderDocs()}
function wdRenderDocs(){
  const box=document.querySelector('#wdDocBody');if(!box||wdOrg?.id!==wdTargetId)return;
  if(wdDocOffFor!==wdOrg.id){wdDocOffFor=wdOrg.id;wdDocOff=detailDefaultOff()}
  const can=!!wdOrg?.canEdit,shown=wdDocs.filter(x=>!wdDocOff.has(categoryOf(x.category))),rows=shown.slice(0,WD_DOC_ROWS),count=document.querySelector('#wdDocs [data-wd-doc-count]');
  if(count){count.textContent=wdDocsError?'':wdDocs.length;count.hidden=wdDocsError}
  const add=document.querySelector('#wdDocAdd');if(add)add.hidden=!can;
  const kinds=document.querySelector('#wdDocKinds');
  if(kinds){kinds.hidden=wdDocsError||!wdDocs.length;if(!kinds.hidden)renderCategoryChips(kinds,{names:documentCategories(),off:wdDocOff,label:'자료 종류 (여러 개 고르기)',controls:'wdDocBody',key:'docKind',onToggle:wdToggleDocKind})}
  if(wdDocsError){box.innerHTML='<div class="status error" role="status">자료를 불러오지 못했습니다. <button type="button" data-wd-doc-retry>다시 불러오기</button></div>';return}
  box.innerHTML=(wdDocs.length?(rows.length?`<div class="wd-doc-lines">${rows.map(x=>wdDocRow(x,can)).join('')}</div>`:emptyHtml('고른 종류 없음',{attrs:'data-wd-doc-nokind'}))+`<button type="button" class="wd-doc-all" data-wd-library>전체 ${wdDocs.length}개 보기 <span aria-hidden="true">›</span></button>`:'')+`<div class="status${wdDocNote.text?(wdDocNote.error?' error':' ok'):''}" data-wd-doc-state role="status">${wdE(wdDocNote.text)}</div>`;
}
async function wdRefreshDocs(){const id=wdTargetId,epoch=wdEpoch;if(!id||!wdRecordCurrent(id,epoch))return;const run=++wdDocsRun;try{const rows=await wdReadDocs(id);if(!wdRecordCurrent(id,epoch)||run!==wdDocsRun)return;wdDocs=rows;wdDocsError=false}catch{if(!wdRecordCurrent(id,epoch)||run!==wdDocsRun)return;wdDocsError=true}wdRenderDocs()}
async function wdRemoveDoc(docId,btn){
  const orgId=wdOrg?.id;if(!wdOrg?.canEdit||!docId||wdDocBusy||!orgId)return;
  if(!confirm('이 담당조직에서 자료를 뺄까요?\n자료와 파일은 자료실에 그대로 있고, 이 조직에 붙은 표시만 풀려요.'))return;
  const state=()=>document.querySelector('#wdDocBody [data-wd-doc-state]'),say=(text,error=false)=>{wdDocNote={text,error};const el=state();if(el){el.textContent=text;el.className='status'+(error?' error':' ok')}};
  wdDocBusy=true;if(btn)btn.disabled=true;
  try{
    const rows=await wdApi(`/rest/v1/app_documents?id=eq.${encodeURIComponent(docId)}&workspace_id=eq.${encodeURIComponent(wdWorkspace)}&organization_id=eq.${encodeURIComponent(orgId)}&select=id,organization_id`,{method:'PATCH',body:{organization_id:null,updated_at:new Date().toISOString()},prefer:'return=representation'});
    if(!Array.isArray(rows)||rows.length!==1||rows[0]?.id!==docId||rows[0]?.organization_id!==null)throw new Error('조직에서 뺀 결과를 확인하지 못했습니다. 자료실에서 확인해 주세요.');
    if(wdOrg?.id!==orgId)return;
    wdDocs=wdDocs.filter(x=>x.id!==docId);wdRenderDocs();say('조직에서 뺐어요. 자료는 자료실에 그대로 있어요.');
    window.dispatchEvent(new CustomEvent('kptu:documents-changed',{detail:{organization_id:orgId}}));
  }catch(e){if(wdOrg?.id===orgId){if(btn)btn.disabled=false;say(e.message||'자료를 빼지 못했습니다. 아무것도 바뀌지 않았을 수 있어요. 자료실에서 확인해 주세요.',true)}}
  finally{wdDocBusy=false}
}
// ORG-자료올리기: 자료 줄의 [+]·끌어다 놓기는 프로젝트 상세의 자료 [+]와 같은 자료실 올리기 창을 연다(library-upload.js).
// 파일 올리기·AI 분류는 그 창이 하고, 올라온 자료는 이 조직에 바로 붙는다. 창을 열기 전에 자료실 화면 부품을 불러온다.
async function wdAddDoc(files=[]){
  const org=wdOrg;if(!org?.canEdit||!wdRecordCurrent(org.id))return;
  const loader=window.KPTUViewLoader;
  try{if(!loader?.load)throw new Error('no loader');if(!loader.isLoaded?.('library'))await loader.load('library')}catch{wdToast('자료실을 불러오지 못했습니다.');return}
  if(!wdRecordCurrent(org.id)||wdOrg?.id!==org.id)return;
  if(!window.KPTULibrary?.startUploadForOrganization?.({id:org.id,name:org.name},files))wdToast('자료 올리기를 열지 못했습니다. 잠시 후 다시 눌러 주세요.')
}
function wdBindDocDrop(){const zone=document.querySelector('#wdDocs');if(zone)bindDropTarget(zone,files=>void wdAddDoc(files),()=>!!wdOrg?.canEdit&&wdRecordCurrent(wdTargetId))}
// 전체 보기: 새 화면 없이 자료실을 이 조직으로 걸러 연다(프로젝트 상세와 같은 방식).
async function wdOpenLibrary(){
  const org=wdOrg;if(!org||!wdClose())return;
  const loader=window.KPTUViewLoader;
  try{if(!loader?.load)throw new Error('no loader');if(!loader.isLoaded?.('library'))await loader.load('library')}catch{wdToast('자료실을 불러오지 못했습니다.');return}
  window.KPTULibrary?.showOrganization?.(org.id,org.name);window.KPTURouter?.go?.('library');
}
function wdRenderItems(){const box=document.querySelector('#wdItems');if(!box)return;const can=!!wdOrg?.canEdit;box.innerHTML=wdItems.length?wdItems.map(x=>`<div class="wd-row"><div class="wd-rowtop"><div><b>${wdE(x.title)}</b>${x.body?`<p>${wdE(x.body)}</p>`:''}<small>${x.updated_at?formatSeoulTime(x.updated_at,{year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric'}):''}</small></div>${can?`<div class="wd-actions"><button class="wd-danger" type="button" data-wd-memo-del="${wdE(x.id)}" aria-label="메모 삭제">삭제</button></div>`:''}</div></div>`).join(''):emptyHtml()}
async function wdDelRow(table,id,btn,label){const obj=label+(label==='메모'?'를':'을');if(!wdOrg?.canEdit||!id)return false;if(!confirm(`이 ${obj} 삭제할까요?`))return false;const orgId=wdOrg.id;if(btn)btn.disabled=true;try{const rows=await wdApi(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&organization_id=eq.${encodeURIComponent(orgId)}&select=id`,{method:'DELETE',prefer:'return=representation'});if(!Array.isArray(rows)||!rows.length)throw new Error('권한이 없거나 이미 없는 항목입니다.');if(wdOrg?.id!==orgId)return false;wdToast(`${obj} 삭제했습니다.`);return true}catch(e){if(btn)btn.disabled=false;wdToast(`${obj} 삭제하지 못했습니다. ${e.message||e}`);return false}}
async function wdDelUpdate(id,btn){if(await wdDelRow('app_suborganization_updates',id,btn,'기록')){wdUpdates=wdUpdates.filter(x=>x.id!==id);btn?.closest('.wd-log-row')?.remove();wdRenderUpdates()}else if(btn?.isConnected&&btn.dataset.wdUpMenu)btn.focus({preventScroll:true})}
async function wdDelMemo(id,btn){if(await wdDelRow('app_suborganization_status_items',id,btn,'메모')){wdItems=wdItems.filter(x=>x.id!==id);wdRenderItems()}}
// ORG-기록수정삭제: a record written here (app_suborganization_updates) has one ⋯ at its top right, like a basket-linked record
// (PR 773 anchored menu). [수정] edits the text in place in a multi-line box (Enter = new line, Ctrl/Cmd+Enter = save, [저장]·[취소]);
// [삭제] asks once more (wdDelRow). The edit saves raw_text with an owner-RLS PATCH on the same table and row the record input
// writes (quick-save.js saveOrganizationUpdate → POST), limited to this organization; the legacy detail_text stays as it is.
let wdUpMenu=null;
const wdUpRow=id=>[...document.querySelectorAll('#wdUpdates [data-wd-up]')].find(el=>el.dataset.wdUp===id);
const wdUpForms=()=>[...document.querySelectorAll('#wdUpdates [data-wd-up-edit]')];
function wdUpEditing(box){return [...box.querySelectorAll('[data-wd-up-edit]')].some(f=>f.dataset.orgId===wdOrg?.id)}
function wdUpDirty(){return wdUpForms().some(f=>f.dataset.orgId===wdOrg?.id&&f.querySelector('textarea')?.value!==f.dataset.original)}
function wdUpEditClear(){wdUpForms().forEach(f=>f.remove());if(wdUpMenu?.active)wdUpMenu.close(()=>{},false)}
// ORG-입력칸⤢통일: the record edit box and the 요약 edit box keep no height-drag handle (resize:none, workplace-detail.css); ⤢ opens
// ED③ 기록 (설계 11.4 순서 5): ⤢ opens the new big window (record-window.js) in place of the old full-screen editor.
//  - A record's edit box (wdBigRecord): the window is this record's own save — letters and saved form in one PATCH (wdSaveRecord), then the
//    edit box closes. Closing without saving hands the letters back to the box. A record that has a saved form is edited only in the window.
//  - A basket link's summary box (wdBigSummary): the summary keeps letters only (결정 E), so the window hands the letters back to the box
//    and the box's own [저장] stays the only save (2000 letters, as the summary RPC). A box that has gone is never written.
const WD_BIG_SVG='<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const WD_SUMMARY_MAX=2000,WD_RECORD_MAX=20000;
async function wdLoadRecordWindow(){try{const [m]=await Promise.all([import('./record-window.js'),window.KPTUViewLoader?.prepare?.('basket')]);return m}catch{wdToast('큰 창을 열지 못했어요. 다시 눌러 주세요.');return null}}
async function wdBigSummary(field){
  if(!field||!field.isConnected||field.disabled||!wdOrg?.canEdit||bigWindowOpen())return;
  const orgId=wdOrg.id,same=()=>field.isConnected&&wdRecordCurrent(orgId),m=await wdLoadRecordWindow();
  if(!m||!same()||bigWindowOpen())return;
  m.openRecordEditWindow({text:field.value,title:'큰 창에서 수정',aria:'요약 저장',textOnly:true,limit:WD_SUMMARY_MAX,
    save:({text})=>{if(!same())return {ok:false,message:'요약 칸이 바뀌어 저장하지 못했어요.'};field.value=text;wdToast('요약 칸에 넣었어요. 칸의 [저장]을 눌러 저장하세요.');return {ok:true}},
    onClose:()=>{if(same())field.focus({preventScroll:true})}})}
async function wdBigRecord(form){
  if(!form||!form.isConnected||!wdOrg?.canEdit||bigWindowOpen())return;
  const id=form.dataset.wdUpEdit,orgId=form.dataset.orgId,input=form.querySelector('textarea'),x=wdUpdates.find(u=>u.id===id);
  if(!x||!input||orgId!==wdOrg.id||form.dataset.busy==='1')return;
  await wdOpenRecordWindow(x,{text:input.value,form,fieldOnClose:letters=>{input.value=letters;input.focus({preventScroll:true})}})}
// Opens the record's big window. form (optional): the inline edit box the window was opened from (closed after a save).
async function wdOpenRecordWindow(x,{text=x.raw_text??'',form=null,fieldOnClose=null}={}){
  const orgId=wdOrg.id,id=x.id,m=await wdLoadRecordWindow();
  if(!m||!wdRecordCurrent(orgId)||bigWindowOpen())return;
  const same=()=>wdRecordCurrent(orgId)&&(!form||form.isConnected);
  m.openRecordEditWindow({doc:hasDoc(x)?x.doc:null,text,title:'큰 창에서 수정',aria:'기록 저장',limit:WD_RECORD_MAX,
    save:async({value,text:letters})=>{
      if(!same())return {ok:false,message:'기록 화면이 바뀌어 저장하지 못했어요.'};
      if(!letters.trim())return {ok:false,message:'내용을 입력해 주세요.'};
      try{await wdSaveRecord(x,{text:letters,value});if(!same())return {ok:true};if(form?.isConnected)wdUpEditEnd(form,false);wdRenderUpdates();wdToast('기록을 고쳤습니다.');return {ok:true}}
      catch(e){return {ok:false,message:e?.message||'기록을 고치지 못했어요. 다시 눌러 주세요.'}}},
    onClose:({saved,text:letters})=>{if(!same())return;if(!saved&&fieldOnClose)fieldOnClose(letters)}})}
// One record's letters and saved form in one PATCH (ED③ 기록). The row is read again first: a record changed on another device since this
// screen read it is refused, nothing is overwritten. A row that had no saved form is also guarded by doc=is.null in the same write.
async function wdSaveRecord(x,{text,value}){
  const orgId=wdOrg.id,id=x.id,base=`/rest/v1/app_suborganization_updates?id=eq.${encodeURIComponent(id)}&organization_id=eq.${encodeURIComponent(orgId)}`;
  const fresh=await wdApi(`${base}&select=id,raw_text,doc`);
  if(!Array.isArray(fresh)||fresh.length!==1)throw new Error('권한이 없거나 이미 없는 기록입니다.');
  if(!sameRecord(fresh[0],x,'raw_text'))throw new Error('다른 곳에서 바뀐 기록이에요. 목록을 다시 불러온 뒤 고쳐 주세요.');
  const rows=await wdApi(`${base}${hasDoc(x)?'':'&doc=is.null'}&select=id,occurred_at,raw_text,detail_text,doc`,{method:'PATCH',body:recordPatch('raw_text',{text,value}),prefer:'return=representation'});
  if(!Array.isArray(rows)||rows.length!==1)throw new Error('기록이 그사이 바뀌었어요. 목록을 다시 불러온 뒤 고쳐 주세요.');
  if(wdOrg?.id===orgId)wdUpdates=wdUpdates.map(u=>u.id===id?{...u,...rows[0]}:u);
  return rows[0]}
function wdUpMenuInstall(){if(wdUpMenu)return wdUpMenu;wdUpMenu=createAnchoredMenu({id:'wdUpMenu',className:'basket-link-menu wd-up-menu',label:'기록 관리',historyKey:'kptuWdUpMenu',parent:document.querySelector('#wdModal')||document.body,
  key:t=>t.dataset.wdUpMenu,canOpen:t=>!!wdOrg?.canEdit&&!t.disabled&&!t.closest('[data-wd-up]')?.querySelector('[data-wd-up-edit]'),
  render:()=>'<button type="button" data-wd-up-action="edit">수정</button><button type="button" class="basket-link-danger" data-wd-up-action="delete">삭제</button>',
  onAction:(button,active)=>{const id=active.id;if(button.dataset.wdUpAction==='edit')wdUpEdit(id);else if(button.dataset.wdUpAction==='delete')void wdDelUpdate(id,active.trigger)}});return wdUpMenu}
function wdUpEdit(id){
  if(!wdOrg?.canEdit)return;const row=wdUpRow(id),x=wdUpdates.find(u=>u.id===id);if(!row||!x)return;
  if(hasDoc(x)){void wdOpenRecordWindow(x);return}
  const old=row.querySelector('[data-wd-up-edit]');if(old){old.querySelector('textarea')?.focus();return}
  const main=row.querySelector('.wd-log-main'),more=row.querySelector('[data-wd-up-menu]');if(main)main.hidden=true;if(more)more.hidden=true;
  row.insertAdjacentHTML('beforeend',`<form class="wd-up-editor" data-enter-save data-wd-up-edit="${wdE(id)}" data-org-id="${wdE(wdOrg.id)}"><textarea data-wd-up-input rows="4" aria-label="기록 내용 수정" aria-keyshortcuts="Control+Enter" title="Enter는 줄바꿈, Ctrl+Enter로 저장"></textarea><p class="status" data-wd-up-state role="status" aria-live="polite"></p><div class="wd-up-edit-actions"><button type="button" class="secondary wd-field-big" data-wd-field-big aria-haspopup="dialog" aria-label="크게" title="큰 창에서 수정">${WD_BIG_SVG}</button><button type="button" class="ghost" data-wd-up-cancel>취소</button><button type="submit" class="primary" data-wd-up-save>저장</button></div></form>`);
  const form=row.querySelector('[data-wd-up-edit]'),input=form.querySelector('textarea');form.dataset.original=x.raw_text??'';input.value=x.raw_text??'';input.focus();input.setSelectionRange(input.value.length,input.value.length)}
function wdUpEditEnd(form,focus=true){const row=form.closest('[data-wd-up]');form.remove();if(!row)return;const main=row.querySelector('.wd-log-main'),more=row.querySelector('[data-wd-up-menu]');if(main)main.hidden=false;if(more)more.hidden=false;if(!wdUpEditing(document.querySelector('#wdUpdates')||document)){const id=row.dataset.wdUp;wdRenderUpdates();if(focus)wdUpRow(id)?.querySelector('[data-wd-up-menu]')?.focus({preventScroll:true})}else if(focus)more?.focus({preventScroll:true})}
async function wdUpSave(form){
  if(!wdOrg?.canEdit||form.dataset.busy==='1')return;const id=form.dataset.wdUpEdit,orgId=form.dataset.orgId,input=form.querySelector('textarea'),st=form.querySelector('[data-wd-up-state]'),text=input.value.trim();
  if(orgId!==wdOrg.id)return;if(!text){st.textContent='내용을 입력해 주세요.';st.className='status error';input.focus();return}
  if(text===String(form.dataset.original).trim()){wdUpEditEnd(form);return}
  form.dataset.busy='1';form.querySelectorAll('button,textarea').forEach(el=>el.disabled=true);st.textContent='저장 중…';st.className='status';
  try{const rows=await wdApi(`/rest/v1/app_suborganization_updates?id=eq.${encodeURIComponent(id)}&organization_id=eq.${encodeURIComponent(orgId)}&doc=is.null&select=id,occurred_at,raw_text,detail_text,doc`,{method:'PATCH',body:{raw_text:text},prefer:'return=representation'});
    if(!Array.isArray(rows)||!rows.length)throw new Error('권한이 없거나 이미 없는 기록입니다.');if(wdOrg?.id!==orgId||!form.isConnected)return;
    wdUpdates=wdUpdates.map(u=>u.id===id?{...u,...rows[0]}:u);wdUpEditEnd(form);wdToast('기록을 고쳤습니다.')}
  catch(e){if(!form.isConnected)return;form.dataset.busy='0';form.querySelectorAll('button,textarea').forEach(el=>el.disabled=false);st.textContent=`기록을 고치지 못했습니다. ${e.message||e}`;st.className='status error';input.focus()}}
function wdUpBind(){const host=document.querySelector('#wdUpdates');if(!host||host.dataset.wdUpBound)return;host.dataset.wdUpBound='1';
  host.addEventListener('click',e=>{const big=e.target.closest?.('[data-wd-up-edit] [data-wd-field-big]');if(big){void wdBigRecord(big.closest('form'));return}const more=e.target.closest?.('[data-wd-up-menu]');if(more){e.preventDefault();wdUpMenuInstall().open(more);return}const cancel=e.target.closest?.('[data-wd-up-cancel]');if(cancel){const form=cancel.closest('[data-wd-up-edit]');if(form&&form.dataset.busy!=='1')wdUpEditEnd(form)}});
  host.addEventListener('submit',e=>{const form=e.target.closest?.('[data-wd-up-edit]');if(!form)return;e.preventDefault();void wdUpSave(form)});
  host.addEventListener('keydown',e=>{const input=e.target.closest?.('[data-wd-up-input]');if(!input)return;const form=input.closest('[data-wd-up-edit]');if(e.key==='Escape'&&form.dataset.busy!=='1'){e.preventDefault();e.stopPropagation();if(input.value===form.dataset.original||confirm('고친 내용을 버릴까요?'))wdUpEditEnd(form)}})}
// UI-크게첨부 → ED③ 기록: [크게] opens the update's new big window (update-window.js) on this input's text with this organization chosen.
// Saving there uses the window's existing saves (this organization → saveOrganizationUpdate with the letters and the saved form, as
// [저장] does for letters; another place, the basket as chosen) and closes; the record list then reloads. Closing without saving hands
// the letters back here, and the saved form is kept in this tab's memory for the next [크게] (never in browser storage).
function wdReloadUpdates(orgId){return readRecordPages(`/rest/v1/app_suborganization_updates?organization_id=eq.${orgId}&select=id,occurred_at,raw_text,detail_text,doc&order=occurred_at.desc,id.desc`,wdRecordRt).then(rows=>{if(wdOrg?.id!==orgId)return;wdUpdates=rows;wdRenderUpdates()})}
let wdBigDraft=null;
async function wdOpenBig(){if(!wdOrg?.canEdit||bigWindowOpen())return;const box=document.querySelector('#wdInboxText'),st=document.querySelector('#wdInboxState'),orgId=wdOrg.id,name=wdOrg.name,owner=wdUser?.id;let uw;try{[uw]=await Promise.all([import('./update-window.js'),window.KPTUViewLoader?.prepare?.('basket')])}catch{st.textContent='큰 창을 열지 못했어요. 다시 눌러 주세요.';st.className='status error';return}if(!wdRecordCurrent(orgId)||wdRt.session.read()?.user?.id!==owner)return;const place={kind:'organization',id:orgId},here=()=>wdRecordCurrent(orgId)&&box.isConnected;st.textContent='';st.className='status';
 const kept=wdBigDraft&&wdBigDraft.orgId===orgId&&wdBigDraft.text===box.value?wdBigDraft.doc:null;wdBigDraft=null;
 uw.openUpdateWindow({text:box.value,doc:kept,place,own:{place,name},draft:false,title:'크게 쓰기',
  onSaved:saved=>{if(!here())return;box.value='';wdBigDraft=null;if(saved.kind==='update'&&saved.place?.kind==='organization'&&saved.place.id===orgId)void wdReloadUpdates(orgId).catch(()=>{st.textContent='기록은 저장했습니다. 목록을 다시 불러오지 못했습니다.';st.className='status error'})},
  onClose:(letters,{saved,value})=>{if(!here())return;if(!saved){box.value=letters;wdBigDraft=letters.trim()&&value?{orgId,text:letters,doc:value}:null}box.focus({preventScroll:true})}})}
async function wdSaveInbox(){if(!wdOrg?.canEdit)return;const box=document.querySelector('#wdInboxText'),st=document.querySelector('#wdInboxState'),btn=document.querySelector('#wdInboxSave'),text=box.value.trim(),orgId=wdOrg.id;if(!text){st.textContent='내용을 입력해 주세요.';st.className='status error';box.focus();return}if(btn.disabled)return;btn.disabled=true;st.textContent='저장 중…';st.className='status';try{const {saveOrganizationUpdate}=await import('./quick-save.js');await saveOrganizationUpdate({organization_id:orgId,raw_text:text,created_by:wdUser.id});if(wdOrg?.id!==orgId)return;box.value='';await wdReloadUpdates(orgId);st.textContent='저장했습니다.';st.className='status ok'}catch(e){st.textContent=e.message||String(e);st.className='status error'}finally{btn.disabled=false}}
// TASK-조직상세: Google tasks linked to this organization, drawn by google-tasks.js like the project detail (all pending and
// those completed in the last 3 days). A fresh box per opening, and an emptied one on close, so a closed detail is not refreshed.
function wdResetTasks(text=''){const old=document.querySelector('#wdTaskBody');if(!old)return null;const box=old.cloneNode(false);box.className='gt-linked gt-status';if(text===true)box.innerHTML=waitHtml({rows:3});else box.textContent=text;old.replaceWith(box);const count=document.querySelector('#wdTasks [data-wd-task-count]');if(count){count.textContent='';count.hidden=true}return box}
function wdMountTasks(){const orgId=wdOrg?.id,box=wdResetTasks(true),g=window.KPTUGoogleTasks;if(!box||!orgId)return;if(!g){box.textContent='Google 할 일 기능을 불러오지 못했습니다.';return}g.mountLinked(box,{organization_id:orgId},{onCount:n=>{const count=document.querySelector('#wdTasks [data-wd-task-count]');if(count&&wdOrg?.id===orgId){count.textContent=n;count.hidden=false}}})}
function wdTaskAction(kind){const g=window.KPTUGoogleTasks;if(!wdOrg?.canEdit)return;if(!g)return wdToast('할 일 기능을 불러오지 못했습니다.');const target={organization_id:wdOrg.id};if(kind==='add')g.openEditor(null,{links:[target]});else g.openLinkPicker(target)}
async function wdOpen(id){wdInstall();if(wdTargetId===id&&wdLinkEditor?.hasDraft()){wdPlace();wdModal('wdModal');wdPaintSelection();return}if(!wdConfirmDiscard())return;const epoch=++wdEpoch,previousId=wdOrg?.id;wdSaveRetire();wdDisposeLinks();wdTargetId=id;if(!wdUser&&!(await wdCtx()))return;if(epoch!==wdEpoch)return;wdOrg=null;wdLinks=[];wdUpdates=[];wdLinkError=false;wdDocs=[];wdDocsError=false;wdDocNote={text:'',error:false};wdDocsRun++;document.querySelector('#wdDocBody')?.replaceChildren();void loadDocumentCategories();document.querySelector('#wdUpdates').replaceChildren();if(previousId!==id)document.querySelector('#wdInboxText').value='';document.querySelector('#wdInboxState').textContent='';wdResetTasks();const pane=wdPlace(),switched=previousId!==id;wdModal('wdModal');wdPaintSelection();if(pane&&switched)document.querySelector('#wdDetailPane').scrollTop=0;const st=document.querySelector('#wdState');st.innerHTML=waitInlineHtml();st.className='status';try{if(!await wdLoad(id,epoch))return;st.textContent='';wdLastOrg.write(wdUser?.id,id);wdMountTasks()}catch(e){if(!wdCurrent(id,epoch))return;st.textContent=e.message||String(e);st.className='status error'}}
function wdBasicBody(){const name=document.querySelector('#wdName').value.trim(),mc=document.querySelector('#wdMembers').value.trim();return {name,aliases:document.querySelector('#wdAliases').value.split(',').map(x=>x.trim()).filter(Boolean),organization_type:document.querySelector('#wdType').value.trim()||'미분류',description:document.querySelector('#wdDescription').value.trim()||null,representative_name:document.querySelector('#wdRep').value.trim()||null,contact:document.querySelector('#wdContact').value.trim()||null,member_count:mc===''?null:Number(mc),updated_at:new Date().toISOString()}}
function wdProfilePath(e,ids=null){return `/rest/v1/app_profile_workplaces?organization_id=eq.${encodeURIComponent(e.id)}&user_id=eq.${encodeURIComponent(e.scope.owner)}${ids?'&id=in.('+ids.map(encodeURIComponent).join(',')+')':''}&select=id,organization_id,user_id,full_name,updated_at`}
function wdProfileRows(e,rows,body,ids=null){if(!Array.isArray(rows)||rows.some(r=>!r.id||r.organization_id!==e.id||r.user_id!==e.scope.owner)||(ids&&(rows.length!==ids.length||new Set(rows.map(r=>r.id)).size!==ids.length||!rows.every(r=>ids.includes(r.id)&&wdSaveMatches(r,body)))))throw new Error('이름 연결의 저장 결과를 확인하지 못했습니다.');return rows}
function wdBasicPartial(a){return a.stages.org==='confirmed'?'조직 정보는 저장했고 이름 연결은 아직 확인하지 못했습니다. 입력을 유지했습니다.':'조직 정보의 저장 결과를 확인하지 못했습니다. 입력을 유지했습니다.'}
async function wdCheckBasic(e){const a=wdSaveAttempts.get(wdSaveKey(e));if(!a||a.pending||a.reading||!wdSaveCurrent(e))return;a.reading=true;const current=()=>wdSaveCurrent(e)&&wdSaveAttempts.get(wdSaveKey(e))===a;try{if(a.stages.org==='unknown'){const rows=await wdApi(wdSavePath(e),{expectedSessionEpoch:e.scope.epoch,singleFlight:false});if(!current())return;a.org=wdSaveOrgRow(e,rows,a.body);a.stages.org='confirmed'}if(a.stages.profile==='unknown'){const rows=await wdSaveReadPages(wdProfilePath(e,a.profileIds),e);if(a.profileIds)wdProfileRows(e,rows,a.profileBody,a.profileIds);else{wdProfileRows(e,rows);a.profileIds=rows.map(r=>r.id);a.stages.profile=rows.length?'neverSent':'notRequired'}if(a.stages.profile==='unknown')a.stages.profile='confirmed'}if(!current())return;if(['confirmed','notRequired'].includes(a.stages.profile)&&a.stages.org==='confirmed'){wdSaveAttempts.delete(wdSaveKey(e));wdSaveNotice(e,'제출한 정보는 확인했습니다. 현재 입력은 남겨두었습니다.')}else wdSaveNotice(e,'확인된 단계는 다시 보내지 않습니다. 같은 입력으로 저장하면 남은 이름 연결만 진행합니다.')}catch{if(current())wdSaveNotice(e,wdBasicPartial(a)+' 다시 저장하지 않았습니다.',true)}finally{a.reading=false}}
async function wdSave(){
  const e=wdBasicEditor;if(!wdOrg?.canEdit||!e)return;
  if(!e.scope||!wdSaveSameScope(e.scope)){wdToast('로그인 상태를 확인하지 못했습니다. 입력은 남겨두었습니다.');return}if(!wdSaveCurrent(e))return;
  const key=wdSaveKey(e),body=wdBasicBody();if(!body.name)return wdToast('조직 명칭을 입력해 주세요.');let a=wdSaveAttempts.get(key);
  if(a?.pending||a?.reading)return;if(a&&Object.values(a.stages).includes('unknown')){wdSaveNotice(e,wdBasicPartial(a),true);return}
  if(a&&a.draft!==wdSaveDraft('basic')){wdSaveNotice(e,'앞선 일부 저장을 같은 입력으로 확인한 뒤 새 입력을 저장해 주세요. 현재 입력은 유지했습니다.',true);return}
  if(!a)a={body,draft:wdSaveDraft('basic'),profileBody:{full_name:body.name,updated_at:body.updated_at},stages:{org:'neverSent',profile:'neverSent'}};
  wdSaveStart(e,a);let stage='org';
  try{
    if(a.stages.org!=='confirmed'){a.stages.org='sent';const rows=await wdApi(wdSavePath(e),{method:'PATCH',body:a.body,prefer:'return=representation',expectedSessionEpoch:e.scope.epoch});a.org=wdSaveOrgRow(e,rows,a.body);a.stages.org='confirmed'}
    if(!wdSaveCurrent(e))return;stage='profile';
    if(!['confirmed','notRequired'].includes(a.stages.profile)){
      if(!a.profileIds){a.stages.profile='reading';const rows=wdProfileRows(e,await wdSaveReadPages(wdProfilePath(e),e));a.profileIds=rows.map(r=>r.id);a.stages.profile=rows.length?'neverSent':'notRequired'}
      if(!wdSaveCurrent(e))return;
      if(a.stages.profile!=='notRequired'){a.stages.profile='sent';const rows=await wdApi(wdProfilePath(e,a.profileIds),{method:'PATCH',body:a.profileBody,prefer:'return=representation',expectedSessionEpoch:e.scope.epoch});wdProfileRows(e,rows,a.profileBody,a.profileIds);a.stages.profile='confirmed'}
    }
    if(!wdSaveSameScope(e.scope))return;wdSaveAttempts.delete(key);if(!wdSaveCurrent(e))return;
    Object.assign(wdOrg,a.org);wdRenderBasicView();document.querySelector('#wdTitle').textContent=wdOrg.name;wdPaintWhere();document.querySelector('#wdUpdated').textContent=formatSeoulTime(wdOrg.updated_at,{year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric'});
    if(wdSaveDraft('basic')===a.draft){document.querySelector('#wdSave').disabled=false;wdSetBasicEditing(false);wdToast('담당조직 정보를 저장했습니다.')}else wdSaveNotice(e,'제출한 정보는 저장했습니다. 추가 입력은 남겨두었습니다.');
    if(wdSaveSameScope(e.scope)&&e.view===wdEpoch)window.dispatchEvent(new Event('kptu:suborganization-updated'));
  }catch(err){if(!['confirmed','notRequired'].includes(a.stages[stage]))a.stages[stage]=[401,403].includes(err?.status)?'rejected':'unknown';if(stage==='org'&&a.stages.org==='rejected'&&wdSaveSameScope(e.scope))wdSaveAttempts.delete(key);wdSaveNotice(e,a.stages[stage]==='rejected'?wdBasicPartial(a)+' 수정 권한을 확인해 주세요.':wdBasicPartial(a),a.stages[stage]==='unknown')}
  finally{wdSaveFinish(e,a)}
}
function wdAffSelectedFromDom(){return [...document.querySelectorAll('[data-wd-aff]:checked')].map(x=>x.value)}
// UI-고른것접기(PROFILE-담당사업장접기 전수): 협의회·사업단마다 고른 것은 늘 보이고(체크를 풀면 저장 전까지 흐리게), 나머지는 접힌 '그 외 n'(맨 위 찾기).
function wdAffRow(x,set,saved){const on=set.has(x.id),off=!on&&saved.has(x.id);return `<label class="wd-aff-check${off?' pick-off':''}"><input data-wd-aff type="checkbox" value="${wdE(x.id)}" ${on?'checked':''}><span>${wdE(x.name)}</span></label>`}
function wdRenderAffChoices(selected=wdAffiliations.map(x=>x.tag_id),{fresh=false}={}){const set=new Set(selected),saved=new Set(wdAffiliations.map(x=>x.tag_id)),box=document.querySelector('#wdAffChoices');if(!box)return;const states=fresh?{}:readPickState(box),groups=[['council','협의회'],['taskforce','사업단']];box.innerHTML=groups.map(([kind,label])=>{const list=wdTags.filter(x=>x.kind===kind),picked=list.filter(x=>set.has(x.id)||saved.has(x.id)),rest=list.filter(x=>!set.has(x.id)&&!saved.has(x.id));return `<div class="wd-aff-group"><b>${label}</b><div class="wd-aff-checks">${list.length?pickFoldHtml({key:kind,picked:picked.map(x=>wdAffRow(x,set,saved)).join(''),others:[{label:'',items:rest.map(x=>({name:x.name||'',html:wdAffRow(x,set,saved)}))}],state:states[kind]||null,noneText:'고른 것 없음'}):emptyHtml()}</div></div>`}).join('');bindPickFold(box)}
function wdOpenAff(){if(!wdOrg?.canEdit)return;document.querySelector('#wdAffStatus').textContent='';document.querySelector('#wdAffNewName').value='';wdRenderAffChoices(undefined,{fresh:true});wdModal('wdAffModal');const e=wdSaveNewEditor('aff'),a=e.scope&&wdSaveAttempts.get(wdSaveKey(e));if(a)wdSaveNotice(e,'앞선 소속 저장 결과를 먼저 확인해 주세요.',Object.values(a.stages).includes('unknown'))}
async function wdCreateAffTag(){const btn=document.querySelector('#wdAffCreate');if(btn.dataset.saving==='1')return;const name=document.querySelector('#wdAffNewName').value.trim(),kind=document.querySelector('#wdAffNewKind').value,st=document.querySelector('#wdAffStatus');if(!name){st.textContent='이름을 입력해 주세요.';st.className='status error';return}const selected=wdAffSelectedFromDom();btn.dataset.saving='1';btn.disabled=true;try{const row=await wdApi('/rest/v1/app_org_affiliation_tags',{method:'POST',body:{workspace_id:wdWorkspace,name,kind,created_by:wdUser.id,active:true},prefer:'return=representation'});wdTags=await wdApi(`/rest/v1/app_org_affiliation_tags?workspace_id=eq.${wdWorkspace}&active=eq.true&select=id,name,kind,created_by&order=kind.asc,name.asc`);const id=row?.[0]?.id;if(id)selected.push(id);wdRenderAffChoices(selected);document.querySelector('#wdAffNewName').value='';st.textContent='추가했습니다. 소속 저장을 눌러 적용하세요.';st.className='status ok'}catch(e){st.textContent=e.message||String(e);st.className='status error'}finally{btn.dataset.saving='0';btn.disabled=false}}
function wdAffPath(e){return `/rest/v1/app_suborganization_affiliations?organization_id=eq.${encodeURIComponent(e.id)}&select=organization_id,tag_id,created_at`}
function wdAffSet(rows,e,wanted=null){if(!Array.isArray(rows)||rows.some(r=>r.organization_id!==e.id||typeof r.tag_id!=='string'||!r.tag_id)||new Set(rows.map(r=>r.tag_id)).size!==rows.length)throw new Error('소속 목록을 확인하지 못했습니다.');const ids=rows.map(r=>r.tag_id).sort();if(wanted&&JSON.stringify(ids)!==JSON.stringify([...wanted].sort()))throw new Error('제출한 소속과 확인된 목록이 다릅니다.');return ids}
async function wdAffRead(e){const org=await wdApi(wdSavePath(e),{expectedSessionEpoch:e.scope.epoch,singleFlight:false});if(!wdSaveCurrent(e))throw new Error('편집 대상이 바뀌었습니다.');wdSaveOrgRow(e,org,{});return wdSaveReadPages(wdAffPath(e),e)}
function wdAffPartial(a){if(a.stages.delete==='confirmed'&&(a.stages.post==='confirmed'||a.stages.post==='notRequired'))return '소속은 확인했고 수정일은 아직 확인하지 못했습니다. 선택을 유지했습니다.';if(a.stages.delete==='confirmed')return '기존 소속을 비웠고 새 선택은 아직 확인하지 못했습니다. 선택을 유지했습니다.';return '소속 저장 결과를 확인하지 못했습니다. 선택을 유지했습니다.'}
function wdAffTimestamp(e,rows,body){const row=wdSaveOrgRow(e,rows,body);if(Date.parse(row.updated_at)!==Date.parse(body.updated_at))throw new Error('수정일의 저장 결과를 확인하지 못했습니다.');return row}
// Saved affiliations belong to the current organization, independent of its editor.
function wdAffAdopt(e,a){
  if(!wdSaveSameScope(e.scope)||!wdRecordCurrent(e.id))return;
  wdAffiliations=a.ids.map(tag_id=>({organization_id:e.id,tag_id}));
  Object.assign(wdOrg,{updated_at:a.org.updated_at});
}
async function wdCheckAff(e){
  const a=wdSaveAttempts.get(wdSaveKey(e));if(!a||a.pending||a.reading||!wdSaveCurrent(e))return;a.reading=true;const current=()=>wdSaveCurrent(e)&&wdSaveAttempts.get(wdSaveKey(e))===a;
  try{
    const rows=await wdAffRead(e);if(!wdSaveCurrent(e))return;
    if(a.stages.delete==='unknown'){wdAffSet(rows,e,[]);a.stages.delete='confirmed'}
    if(a.stages.post==='unknown'){wdAffSet(rows,e,a.ids);a.stages.post='confirmed'}
    if(a.stages.timestamp==='unknown'){const org=await wdApi(wdSavePath(e),{expectedSessionEpoch:e.scope.epoch,singleFlight:false});if(!wdSaveCurrent(e))return;a.org=wdAffTimestamp(e,org,a.timestampBody);a.stages.timestamp='confirmed'}
    if(!current())return;if(a.stages.timestamp==='confirmed'){wdAffSet(rows,e,a.ids);wdAffAdopt(e,a);wdSaveAttempts.delete(wdSaveKey(e));wdSaveNotice(e,'제출한 소속을 확인했습니다. 현재 선택은 남겨두었습니다.')}else wdSaveNotice(e,'확인된 단계는 다시 보내지 않습니다. 같은 선택으로 저장하면 남은 단계만 진행합니다.');
  }catch{if(current())wdSaveNotice(e,wdAffPartial(a)+' 다시 전송하지 않았습니다.',true)}finally{a.reading=false}
}
async function wdSaveAff(){
  const e=wdAffEditor;if(!wdOrg?.canEdit||!e)return;
  if(!e.scope||!wdSaveSameScope(e.scope)){document.querySelector('#wdAffStatus').textContent='로그인 상태를 확인하지 못했습니다. 선택은 남겨두었습니다.';return}if(!wdSaveCurrent(e))return;
  const key=wdSaveKey(e),ids=[...new Set(wdAffSelectedFromDom())].sort();
  if(ids.some(id=>!wdTags.some(t=>t.id===id&&(!t.workspace_id||t.workspace_id===e.scope.workspace)))){wdSaveNotice(e,'선택한 소속을 현재 업무 공간에서 확인해 주세요.');return}
  let a=wdSaveAttempts.get(key);if(a?.pending||a?.reading)return;
  if(a&&Object.values(a.stages).includes('unknown')){wdSaveNotice(e,wdAffPartial(a),true);return}
  if(a&&a.draft!==wdSaveDraft('aff')){wdSaveNotice(e,'앞선 일부 저장을 같은 선택으로 확인한 뒤 새 선택을 저장해 주세요.',true);return}
  if(!a)a={ids,draft:wdSaveDraft('aff'),stages:{delete:'neverSent',post:ids.length?'neverSent':'notRequired',timestamp:'neverSent'},timestampBody:{updated_at:new Date().toISOString()}};
  wdSaveStart(e,a);let stage='delete';
  try{
    if(a.stages.delete!=='confirmed'){
      a.stages.delete='reading';const before=await wdAffRead(e);a.originalIds=wdAffSet(before,e);if(!wdSaveCurrent(e))return;
      a.stages.delete='sent';const deleted=await wdApi(wdAffPath(e),{method:'DELETE',prefer:'return=representation',expectedSessionEpoch:e.scope.epoch});if(Array.isArray(deleted)){const removed=wdAffSet(deleted,e);if(removed.some(id=>!a.originalIds.includes(id)))throw new Error('삭제된 소속을 확인하지 못했습니다.')}else throw new Error('소속을 비운 결과를 확인하지 못했습니다.');
      if(!wdSaveCurrent(e)){a.stages.delete='unknown';return}wdAffSet(await wdAffRead(e),e,[]);a.stages.delete='confirmed';
    }
    if(!wdSaveCurrent(e))return;stage='post';
    if(a.stages.post!=='confirmed'&&a.stages.post!=='notRequired'){
      a.stages.post='sent';const rows=await wdApi('/rest/v1/app_suborganization_affiliations?select=organization_id,tag_id,created_at',{method:'POST',body:a.ids.map(tag_id=>({organization_id:e.id,tag_id,created_by:e.scope.owner})),prefer:'return=representation',expectedSessionEpoch:e.scope.epoch});wdAffSet(rows,e,a.ids);
      if(!wdSaveCurrent(e)){a.stages.post='unknown';return}wdAffSet(await wdAffRead(e),e,a.ids);a.stages.post='confirmed';
    }
    if(!wdSaveCurrent(e))return;stage='timestamp';
    if(a.stages.timestamp!=='confirmed'){a.stages.timestamp='sent';const rows=await wdApi(wdSavePath(e),{method:'PATCH',body:a.timestampBody,prefer:'return=representation',expectedSessionEpoch:e.scope.epoch});a.org=wdAffTimestamp(e,rows,a.timestampBody);a.stages.timestamp='confirmed'}
    if(!wdSaveSameScope(e.scope))return;wdAffAdopt(e,a);wdSaveAttempts.delete(key);if(!wdSaveCurrent(e))return;
    wdRenderAff();document.querySelector('#wdUpdated').textContent=formatSeoulTime(wdOrg.updated_at,{year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric'});
    if(wdSaveDraft('aff')===a.draft){document.querySelector('#wdAffSave').disabled=false;wdModal('wdAffModal',false);wdToast('협의회·사업단 소속을 저장했습니다.')}else wdSaveNotice(e,'제출한 소속은 저장했습니다. 추가 선택은 남겨두었습니다.');
    if(wdSaveSameScope(e.scope)&&e.view===wdEpoch)window.dispatchEvent(new Event('kptu:suborganization-updated'));
  }catch(err){if(a.stages[stage]==='reading'){a.stages[stage]='neverSent';wdSaveNotice(e,'소속 목록을 확인하지 못해 저장 요청을 보내지 않았습니다. 선택은 유지했습니다.');return}if(!['confirmed','notRequired'].includes(a.stages[stage]))a.stages[stage]=[401,403].includes(err?.status)?'rejected':'unknown';wdSaveNotice(e,wdAffPartial(a)+(a.stages[stage]==='rejected'?' 수정 권한을 확인해 주세요.':''),a.stages[stage]==='unknown')}
  finally{wdSaveFinish(e,a)}
}
function wdOpenTime(id){wdTimeEdit=id?wdTimeline.find(x=>x.id===id):null;document.querySelector('#wdTimeTitle').textContent=wdTimeEdit?'타임라인 수정':'타임라인 추가';document.querySelector('#wdTimeYear').value=wdTimeEdit?.event_year||seoulParts().year;document.querySelector('#wdTimeDate').value=wdTimeEdit?.event_date||'';document.querySelector('#wdTimeCat').value=wdTimeEdit?.category||'회의';document.querySelector('#wdTimeCount').value=wdTimeEdit?.occurrence_count||1;document.querySelector('#wdTimeName').value=wdTimeEdit?.title||'';document.querySelector('#wdTimeBody').value=wdTimeEdit?.summary||'';wdModal('wdTimeModal')}
async function wdSaveTime(){const btn=document.querySelector('#wdTimeSave'),creating=!wdTimeEdit;if(creating&&btn.dataset.saving==='1')return;const year=Number(document.querySelector('#wdTimeYear').value),title=document.querySelector('#wdTimeName').value.trim();if(!year||!title)return wdToast('연도와 제목을 입력해 주세요.');const body={event_year:year,event_date:document.querySelector('#wdTimeDate').value||null,category:document.querySelector('#wdTimeCat').value,title,summary:document.querySelector('#wdTimeBody').value.trim()||null,occurrence_count:Math.max(1,Number(document.querySelector('#wdTimeCount').value)||1),updated_at:new Date().toISOString()};if(creating){btn.dataset.saving='1';btn.disabled=true}try{if(wdTimeEdit)await wdApi(`/rest/v1/app_suborganization_timeline?id=eq.${wdTimeEdit.id}`,{method:'PATCH',body});else await wdApi('/rest/v1/app_suborganization_timeline',{method:'POST',body:{organization_id:wdOrg.id,...body,sort_order:wdTimeline.length*10,created_by:wdUser.id}});wdModal('wdTimeModal',false);await wdLoad(wdOrg.id);document.querySelector('#wdTime').open=true}catch(e){if(creating)wdToast(e.message||String(e));else throw e}finally{if(creating){btn.dataset.saving='0';btn.disabled=false}}}
async function wdDelTime(id){if(!confirm('이 타임라인 항목을 삭제할까요?'))return;await wdApi(`/rest/v1/app_suborganization_timeline?id=eq.${id}`,{method:'DELETE'});await wdLoad(wdOrg.id);document.querySelector('#wdTime').open=true}
function wdBind(){document.addEventListener('change',e=>{const box=e.target.closest?.('#wdAffChoices [data-wd-aff]');if(!box)return;const id=box.value;wdRenderAffChoices(wdAffSelectedFromDom());document.querySelector(`#wdAffChoices [data-wd-aff][value="${CSS.escape(id)}"]`)?.focus()});document.addEventListener('keydown',e=>{if(e.target.closest?.('#wdMore [role="tablist"]'))wdTabKeys(e)});document.addEventListener('click',e=>{const b=e.target.closest?.('button,[data-ps-workplace-org]');if(!b)return;if(b.dataset.wdTab&&b.closest('#wdMore')){wdTab(b.dataset.wdTab);return}if(b.dataset.psWorkplaceOrg){if(!(wdDocked()&&wdTargetId===b.dataset.psWorkplaceOrg&&b.closest('#soOrganizationList')))wdOpen(b.dataset.psWorkplaceOrg);return}if(b.hasAttribute('data-wd-link-retry')){void wdRefreshLinks();return}if(b.hasAttribute('data-wd-doc-retry')){void wdRefreshDocs();return}if(b.hasAttribute('data-wd-library')){void wdOpenLibrary();return}if(b.hasAttribute('data-wd-doc-add')){void wdAddDoc();return}if(b.dataset.wdDocRemove){void wdRemoveDoc(b.dataset.wdDocRemove,b);return}if(b.dataset.wdClose){if(b.dataset.wdClose==='wdModal')wdClose();else wdModal(b.dataset.wdClose,false);return}if(b.dataset.wdTimeEdit){wdOpenTime(b.dataset.wdTimeEdit);return}if(b.dataset.wdTimeDel){wdDelTime(b.dataset.wdTimeDel);return}if(b.dataset.wdUpDel){wdDelUpdate(b.dataset.wdUpDel,b);return}if(b.dataset.wdMemoDel){wdDelMemo(b.dataset.wdMemoDel,b)}});document.querySelector('#wdInboxSave')?.addEventListener('click',wdSaveInbox);document.querySelector('#wdInboxBig')?.addEventListener('click',()=>void wdOpenBig());document.querySelector('#wdTaskAdd')?.addEventListener('click',()=>wdTaskAction('add'));document.querySelector('#wdTaskLink')?.addEventListener('click',()=>wdTaskAction('link'));document.querySelector('#wdEditBasic')?.addEventListener('click',()=>wdSetBasicEditing(true));document.querySelector('#wdCancelBasic')?.addEventListener('click',()=>wdSetBasicEditing(false));document.querySelector('#wdSave')?.addEventListener('click',wdSave);document.querySelector('#wdAffManage')?.addEventListener('click',wdOpenAff);document.querySelector('#wdAffCreate')?.addEventListener('click',wdCreateAffTag);document.querySelector('#wdAffSave')?.addEventListener('click',wdSaveAff);document.querySelector('#wdAddTime')?.addEventListener('click',()=>wdOpenTime());document.querySelector('#wdTimeSave')?.addEventListener('click',wdSaveTime)}
// The shared mobile history fallback hides unknown dialogs directly. Own this
// dialog's back traversal so pending loads and in-memory summaries retire together.
window.addEventListener('popstate',event=>{
 const modal=document.querySelector('#wdModal');
 if(!wdTargetId||modal?.classList.contains('hidden')||modal?.dataset.kptuHistoryOpen!=='1'||event.state?.kptuOverlay===modal.id||document.querySelector('.modal:not(.hidden):not(#wdModal)'))return;
 event.stopImmediatePropagation();
 if(!wdConfirmDiscard()){history.pushState({...event.state,kptuOverlay:modal.id},'',location.href);return}
 modal.dataset.kptuHistoryClosing='pop';wdClose(true);
},true);
wdInstall();document.addEventListener('click',wdReportClick);wdBind();wdBindDocDrop();wdUpBind();wdCtx();window.addEventListener('kptu:basket-links-changed',()=>{void wdRefreshLinks()});window.addEventListener('kptu:documents-changed',()=>{void wdRefreshDocs()});window.addEventListener('kptu:document-categories-changed',()=>{wdRenderDocs()});window.addEventListener('kptu:before-reload',event=>{if(!wdConfirmDiscard())event.preventDefault()});window.addEventListener('kptu:view-changed',()=>{if(wdTargetId)wdClose();wdPlace()});window.addEventListener('kptu:session-changed',()=>{if(wdSaveSameScope(wdSaveObservedScope))return;wdSaveObservedScope=null;wdSessionEpoch++;wdSaveAttempts.clear();wdClose(true);wdBasicInputs.forEach(k=>{const input=document.querySelector('#wd'+k);if(input)input.value=''}) ;wdUser=null;wdWorkspace=null;wdRole=null;wdOrg=null;wdLinks=[];wdUpdates=[];wdDocs=[];wdDocsError=false;document.querySelector('#wdUpdates')?.replaceChildren();const inbox=document.querySelector('#wdInboxText');if(inbox)inbox.value='';queueMicrotask(()=>wdCtx().catch(()=>{}))});

// ORG-PC좌우(2026-10-21): on a PC (761px~) the 담당조직 screen is the list on the left (suborganizations.js) and the chosen
// organization's detail on the right, the way the projects screen does it (UI-PC프로젝트좌우, project-system-v3.js placeDetail):
// the same detail element (#wdModal, drawn only by wdRender) moves into #wdDetailPane as a region instead of a dialog.
// Phones and a detail opened over another screen (basket, profile) keep the dialog.
// wdPlace() is the only place that moves it. The pane is laid out only by the PC rule of suborganizations.css.
const WD_PC=window.matchMedia?.('(min-width:761px)');
const wdLastOrg=lastSeen('organization');
let wdResuming=false;
const wdListIds=()=>[...document.querySelectorAll('#soOrganizationList [data-so-org]')].map(row=>row.dataset.soOrg);
const wdSplitWanted=()=>{const pane=document.querySelector('#wdDetailPane');return !!WD_PC?.matches&&window.KPTURouter?.current==='team'&&!!pane&&getComputedStyle(pane).display!=='none'};
const wdDocked=()=>document.querySelector('#wdModal')?.dataset.wdDocked==='1';
// UI-칸폭조절: the list | detail boundary can be dragged (split-resize.js, remembered per screen).
function wdSplit(){const sec=document.querySelector('#soTeamSection');if(sec)mountSplitResize({container:sec,name:'team',label:'담당조직 목록과 상세 칸 폭 조절',list:()=>document.querySelector('#soOrganizationList'),pane:()=>document.querySelector('#wdDetailPane'),active:wdSplitWanted})}
function wdPlace(){
  const m=document.querySelector('#wdModal'),pane=document.querySelector('#wdDetailPane');if(!m)return false;wdSplit();
  // UI-칸안스크롤하나로: PC는 화면 스크롤 하나. 상세 칸은 화면에 붙어 따라오고, 다른 조직을 열면 머리부터 보인다.
  if(pane&&wdSplitWanted()){followPane(pane,{reset:wdFollowed!==wdTargetId});wdFollowed=wdTargetId}
  const dock=wdSplitWanted(),open=!m.classList.contains('hidden');
  if(dock&&wdDocked()&&m.parentElement===pane){pane.classList.toggle('has-org',open);return true}
  if(!dock&&!wdDocked())return false;
  if(dock){pane.append(m);m.classList.add('wd-docked');m.setAttribute('role','region');m.removeAttribute('aria-modal');m.dataset.wdDocked='1';pane.classList.toggle('has-org',open)}
  else{document.body.append(m);m.classList.remove('wd-docked');m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');delete m.dataset.wdDocked;pane?.classList.remove('has-org')}
  wdOrder(dock);wdRenderDocs();wdPaintSelection();return dock
}
// ORG-PC상세정리 ⑥: on the PC pane the records come right under the input (input → 기록 → 할 일 → 자료); the dialog keeps
// input → 할 일 → 자료 → 기록. A real move (not CSS order) so the Tab order follows what is seen.
function wdOrder(dock){const log=document.querySelector('#wdLog'),inbox=document.querySelector('#wdInbox'),docs=document.querySelector('#wdDocs');if(!log||!inbox||!docs)return;if(dock)inbox.after(log);else docs.after(log)}
// The list row of the organization shown on the right carries the selection (PC only); the list module paints it.
// ORG-PC상세정리 ①: the pane has no title of its own; the top line's place shows "담당조직 › 조직명" (topbar-actions.js).
function wdPaintSelection(){const m=document.querySelector('#wdModal'),open=!!m&&!m.classList.contains('hidden'),shown=wdDocked()&&open;if(!wdPlaced)window.KPTURouter?.setPlace?.('team',{org:open?wdTargetId:null});document.querySelector('#wdDetailPane')?.classList.toggle('has-org',shown);window.dispatchEvent(new CustomEvent('kptu:workplace-selection',{detail:{id:shown?wdTargetId:null}}));wdPaintWhere()}
function wdPaintWhere(){const m=document.querySelector('#wdModal'),shown=wdDocked()&&!!m&&!m.classList.contains('hidden')&&wdOrg?.id===wdTargetId;window.dispatchEvent(new CustomEvent('kptu:where-item',{detail:{view:'team',name:shown?wdOrg.name:null}}))}
// On a PC with nothing chosen: the last organization seen on this device, else the first one in the list.
function wdOpenFirst(){if(wdPlaced){const id=wdPlaced,ids=wdListIds();if(!ids.length||window.KPTURouter?.current!=='team')return;wdPlaced=null;if(ids.includes(id)&&!wdTargetId){void wdOpen(id);return}}if(wdResuming||!wdSplitWanted()||wdTargetId)return;const ids=wdListIds(),last=wdLastOrg.read(wdUser?.id||wdRt.session?.read?.()?.user?.id),id=ids.includes(last)?last:ids[0];if(id)void wdOpen(id)}
window.addEventListener('kptu:suborganizations-rendered',()=>{wdPlace();wdPaintSelection();wdOpenFirst()});
WD_PC?.addEventListener?.('change',()=>{wdPlace();wdOpenFirst()});

// UI-PC프로젝트좌우: a 🧺 record opened from the 담당조직 screen comes back to this organization at the same scroll
// (the note's "← (조직)으로 돌아가기", browser or phone back, or the 담당조직 tab).
function wdScroll(){const m=document.querySelector('#wdModal');return {pane:document.querySelector('#wdDetailPane')?.scrollTop||0,list:document.querySelector('#soOrganizationList')?.scrollTop||0,card:m?.querySelector('.modal-card')?.scrollTop||0,modal:m?.scrollTop||0,page:window.scrollY||0}}
// A back arrives as popstate: open after its listeners, or the shared phone history (mobile-modal-history.js) takes the
// just-opened dialog for one that back should close.
async function wdResume(){const o=takeBasketReturn('team',wdRecordRt);if(!o){wdPlace();return void wdOpenFirst()}wdResuming=true;try{await new Promise(resolve=>setTimeout(resolve));if(window.KPTURouter?.current!=='team')return;await wdOpen(o.id)}finally{wdResuming=false}if(wdOrg?.id!==o.id||window.KPTURouter?.current!=='team')return;const set=()=>{const m=document.querySelector('#wdModal'),card=m?.querySelector('.modal-card'),pane=document.querySelector('#wdDetailPane'),list=document.querySelector('#soOrganizationList');if(pane)pane.scrollTop=o.scroll?.pane||0;if(list)list.scrollTop=o.scroll?.list||0;if(card)card.scrollTop=o.scroll?.card||0;if(m)m.scrollTop=o.scroll?.modal||0;window.scrollTo({top:o.scroll?.page||0,behavior:'instant'})};set();requestAnimationFrame(set)}
window.KPTURouter?.on?.('team',()=>{void wdResume()});
window.KPTUWorkplace={open:wdOpen};
// NAV-새로고침제자리: on a reload of 담당조직 the screen is shown before this module loads, so its view hook does not run and the list may
// already be drawn: the organization written in the address is opened here. A list drawn later opens it through kptu:suborganizations-rendered.
if(wdPlaced&&window.KPTURouter?.current==='team'){wdPlace();wdOpenFirst()}
