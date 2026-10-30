import {waitHtml, waitInlineHtml, emptyHtml} from './wait-state.js';
import {swatchHtml} from './color-swatch.mjs'; // UI-색고르기통일: 프로젝트 색 칸도 공용 부품
import {holdToast as kptuHoldToast} from './small-notice.js'; // UI-작은알림자리: #toast도 위쪽·2초·올려 두면 멈춤(시계 하나)
import './enter-save.js'; // UI-엔터저장: shared Enter-to-save rule for the data-enter-save roots below
import {fileAttrs,menuItemsHtml,httpUrl} from './file-actions.js';
import {formatMeetingTime,formatSeoulTime,seoulInputValue,toSeoulISO,seoulParts,seoulDateKey} from './meeting-time.js';
import {bindDateTimeFields} from './time-input.js';
import { dayKey, ranges } from './home-read-model.js';
import {lastSeen} from './split-last.js';
import {mountSplitResize} from './split-resize.js';
import {recordSheetWanted,openRecordSheet} from './record-sheet.js';
import { createAnchoredMenu } from './anchored-menu.js';
import {tapExpand} from './text-clamp.js';
import {foldedSet,isFoldedOwn,partitionTree,blocks,foldedMetadata,foldSummary} from './project-fold.mjs';
import {recordLines} from './note-preview.mjs';
import {readRecordPages,readLinkRecords,recordMark,recordText,isNoteRecord,mountLinkSummaryEditor} from './basket-link-records.js';
import {categoryTag,categoryOf,documentCategories,loadDocumentCategories} from './document-categories.js';
import {renderCategoryChips,toggleCategoryOff,detailDefaultOff} from './category-chips.js';
import {disconnectWithUndo,offerUndoNotice} from './basket-record-delete.js';
import {readLinkedReports,readAllReports,readReportTargets,changeOneTarget,restoreTargets} from './report-links.js';
import {readReportPhotos,reportPhotosHtml,mountReportPhotos} from './report-photos.js';
import {openReport} from './report-open.js';
import {reportTitle,reportKindTag,sameTarget} from './report-links-model.mjs';
import {TRASH_KIND,TRASH_KINDS,TRASH_KIND_LABEL,TRASH_STATE,TRASH_TEXT,classifyTrashError,classifyTrashList,normalizeTrashRows,mergeTrashStates,restoredText,parentFirstText,deleteDialogText,trashErrorText,purgeConfirmText,archiveButtonLabel,firstArchiveTab,noteKindWord,sharePrevWord} from './project-trash-model.mjs';
import {purgePage as purgeSharePage} from './share-pages-archive.mjs';
import {bigWindowOpen} from './big-window-open.js';
import {hasDoc,sameRecord,recordPatch} from './record-doc.mjs';
import {requestBasketNote,requestBasketNoteFrom,requestNoteDocOpen,requestNoteDocFrom,takeBasketReturn,basketNoteHref} from './basket-note-tasks.js';
(()=>{
'use strict';
const rt=window.KPTURuntime,catalog=window.KPTUProjectCatalog;if(!rt||!catalog)return;
const api=(p,o={})=>rt.api(p,o),$=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=formatMeetingTime;
const date=v=>v?formatSeoulTime(v,{year:'numeric',month:'numeric',day:'numeric'}):'미정';
const localInput=seoulInputValue;
const PHASE={preparation:'준비',in_progress:'진행',consultation:'협의',execution:'실행',follow_up:'후속조치',done:'종료'};
const MODULES=[['progress','진행상황'],['milestones','주요 일정'],['tasks','할 일'],['documents','자료']];
const MSTATUS={planned:'예정',scheduled:'예정',confirmed:'확정',in_progress:'진행',done:'완료',completed:'완료',postponed:'연기',cancelled:'취소',canceled:'취소'};
const mstatus=v=>MSTATUS[v||'planned']||v;
const day=v=>{const [y,m,d]=String(v||'').slice(0,10).split('-');if(!d)return'';return (Number(y)===seoulParts().year?'':y+'.')+Number(m)+'.'+Number(d)};
const CONTENT_TYPES={text:'글',status:'현황',metrics:'지표',table:'표',timeline:'흐름·경과',links:'링크'};
let user=null,membership=null,wid=null,members=[],profiles=[],spaces=[],projects=[],current=null,detail=null,editingProject=null,editingMilestone=null,editingWs=null,lastSpacesKey='',detailEpoch=0,projectEpoch=0,googleCalendarState=null;
// TRASH-삭제휴지통 2단계: 휴지통 상태의 유일한 주인. 서버(app_trash_list)에서만 채우고 브라우저에는 저장하지 않는다.
// state는 이 한 곳에서만 정한다(ready=목록 받음, missing=함수 없음, failed=그 밖 실패).
// TRASH-화면2: trash.state는 프로젝트 종류의 상태(프로젝트 [삭제] 판정용, 예전 그대로), trash.merged는 세 종류를 합친 상태(보관 창 탭·단추용), trash.kinds는 종류별 상태.
let trash={state:TRASH_STATE.UNKNOWN,merged:TRASH_STATE.UNKNOWN,kinds:{},rows:[],tab:'archive',busy:false},trashFlight=null;
// Save attempts outlive a closed/replaced editor, but never the authenticated tab.
// An unknown create cannot become a fresh create by changing its title or DOM.
const saveEditors=new Map(),saveAttempts=new Map();let saveSequence=0,projectRuntimeEpoch=rt.session.epoch();
const SAVE_TABLE={project:'app_spaces',workstream:'app_project_workstreams',progress:'app_project_progress_updates',record:'app_project_progress_updates',milestone:'app_project_milestones'};
const saveScope=e=>e.kind==='project'?{workspace_id:e.workspace,owner_id:e.owner}:e.kind==='milestone'&&!e.targetId?{project_id:e.projectId,created_by:e.owner}:e.kind==='progress'?{project_id:e.projectId,workstream_id:e.workstreamId,author_id:e.owner}:e.kind==='record'?{project_id:e.projectId,workstream_id:e.workstreamId}:{project_id:e.projectId};
const attemptKey=e=>JSON.stringify([e.epoch,e.owner,e.workspace,e.kind,e.projectId??'',e.targetId??'new']);
function freezeSave(value){if(value&&typeof value==='object'){Object.values(value).forEach(freezeSave);Object.freeze(value)}return value}
function sameSaveSession(e){const c=rt.context.read();return e.epoch===rt.session.epoch()&&e.projectEpoch===projectEpoch&&e.owner===user?.id&&e.workspace===wid&&c?.user?.id===e.owner&&c?.workspace?.id===e.workspace}
function saveEditorCurrent(e){return sameSaveSession(e)&&saveEditors.get(e.key)===e&&!e.closed&&e.form.isConnected&&(!e.modal||!$('#'+e.modal).classList.contains('hidden'))&&(!e.projectId||current?.id===e.projectId&&$('#ps3Body')?.dataset.project===e.projectId)}
function projectSaveCurrent(r){return saveEditorCurrent(r.editor)&&r.editor.request===r&&r.seq===r.editor.seq}
function readSaveDraft(e){return e.fields.map(field=>field.value)}
function saveAttemptComplete(a){return a.bodyState==='confirmed'&&(!a.modulesNeeded||a.modulesState==='confirmed')&&(!a.phaseWanted||a.phaseState==='confirmed'&&a.phaseConfirmed===a.phaseWanted)&&(!a.googleNeeded||a.googleState==='confirmed')}
function saveBusy(e,value){if(e.button?.isConnected){e.button.disabled=value;e.button.toggleAttribute('aria-busy',value)}if(e.kind==='record')e.form.closest('[data-ps3-record]').dataset.saving=value?'1':'0'}
function saveWait(e){if(!saveEditorCurrent(e))return;e.status.innerHTML=waitInlineHtml();e.status.className='status'} // UI-기다림표시통일 2차: 누른 뒤 기다리는 동안 상태 줄은 글자 없는 회색 칸(wait-state.js)
function saveNotice(e,text,{confirm=false}={}){if(!saveEditorCurrent(e))return;e.status.textContent=text;e.status.className='status';if(confirm){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent='저장 결과 확인';b.onclick=()=>e.kind==='milestone'?recoverMilestone(e):recoverSave(e);e.status.append(document.createTextNode(' '),b)}}
function saveStatus(form,selector){let s=selector?$(selector):form.querySelector('[data-ps3-save-state]');if(!s){s=document.createElement('div');s.dataset.ps3SaveState='';s.className='status';s.setAttribute('role','status');form.append(s)}return s}
function configureSaveEditor({key,kind,form,modal=null,targetId=null,projectId=null,workstreamId=null,button,status,fields,source=null}){
  const old=saveEditors.get(key);if(old){old.closed=true;old.seq=++saveSequence}
  const e={key,kind,form,modal,targetId,projectId,workstreamId,button,status,fields,source:source?structuredClone(source):null,owner:user?.id,workspace:wid,epoch:rt.session.epoch(),projectEpoch,seq:++saveSequence,closed:false,request:null,reading:false,readRun:0};
  e.attempt=saveAttempts.get(attemptKey(e))||null;saveEditors.set(key,e);
  if(e.attempt?.liveDraft&&(!workstreamId||workstreamId===e.attempt.workstreamId))e.fields.forEach((field,i)=>{field.value=e.attempt.liveDraft[i]??field.value});
  e.baseline=JSON.stringify(readSaveDraft(e));saveBusy(e,!!e.attempt?.pending);
  if(e.attempt){const a=e.attempt;if(a.pending)saveWait(e);else saveNotice(e,'앞선 저장 결과를 확인해 주세요.',{confirm:true});if(a.pending)a.done.then(()=>{if(saveEditorCurrent(e)&&e.attempt===a){e.kind==='milestone'?milestoneReadyButton(e):saveBusy(e,false);saveNotice(e,'앞선 저장 처리가 끝났습니다. 저장 결과를 확인해 주세요.',{confirm:true})}})}
  return e;
}
function closeSaveEditor(modal){for(const e of saveEditors.values())if(e.modal===modal&&!e.closed){if(e.attempt){e.attempt.liveDraft=readSaveDraft(e);if(!e.attempt.pending&&saveAttemptComplete(e.attempt)&&!e.attempt.needsReview)saveAttempts.delete(attemptKey(e))}e.closed=true;e.seq=++saveSequence}}
function beginProjectSave(e,body){
  if(!saveEditorCurrent(e)||e.request||e.reading)return null;
  const a=e.attempt||saveAttempts.get(attemptKey(e));
  if(a?.pending){saveNotice(e,'앞선 저장 결과를 기다려 주세요. 새로 저장하지 않았습니다.');return null}
  if(a?.needsReview||a?.bodyState==='unknown'||a?.modulesState==='unknown'||a?.phaseState==='unknown'||a?.googleState==='unknown'||a?.googleState==='compensated'){e.attempt=a;saveNotice(e,'앞선 저장 결과를 먼저 확인해 주세요. 새로 저장하지 않았습니다.',{confirm:true});return null}
  if(a&&e.kind==='progress'&&a.workstreamId!==e.workstreamId){saveNotice(e,'앞선 기록의 진행 항목에서 저장 결과를 확인해 주세요.',{confirm:true});return null}
  const attempt=a||{kind:e.kind,owner:e.owner,workspace:e.workspace,projectId:e.projectId,workstreamId:e.workstreamId,epoch:e.epoch,knownId:e.targetId,row:e.source,bodyState:'idle',modulesNeeded:e.kind==='project'&&!e.targetId,modulesState:'idle',moduleKeys:new Set(),phaseState:'idle',needsReview:false};
  const r={editor:e,attempt,seq:e.seq,owner:e.owner,workspace:e.workspace,epoch:e.epoch,projectEpoch:e.projectEpoch,body:freezeSave(structuredClone(body)),draft:JSON.stringify(readSaveDraft(e)),token:++saveSequence};
  attempt.liveDraft=readSaveDraft(e);attempt.pending=true;attempt.done=new Promise(resolve=>r.finish=resolve);attempt.request=r;e.attempt=attempt;e.request=r;saveAttempts.set(attemptKey(e),attempt);saveBusy(e,true);saveNotice(e,'저장 중…');return r;
}
function finishProjectSave(r){const e=r.editor,a=r.attempt;if(a.request===r){a.pending=false;a.request=null;r.finish()}if(e.request===r){e.request=null;if(saveEditorCurrent(e)&&e.seq===r.seq)saveBusy(e,false)}}
const saveCall=(r,path,options={})=>{if(!projectSaveCurrent(r))throw new Error('편집창이 바뀌었습니다.');return api(path,{...options,expectedSessionEpoch:r.epoch})};
const savedId=id=>typeof id==='string'&&!!id||typeof id==='number'&&Number.isFinite(id);
function validSaveRow(e,row,id=null){return !!row&&savedId(row.id)&&(id==null||row.id===id)&&Object.entries(saveScope(e)).every(([key,value])=>row[key]===value)}
function sameSavedValue(a,b){if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&sameSavedValue(a[key],b[key]))}
function sameSavedField(key,a,b){return ['start_at','end_at'].includes(key)&&typeof a==='string'&&typeof b==='string'&&Number.isFinite(Date.parse(a))&&Number.isFinite(Date.parse(b))?Date.parse(a)===Date.parse(b):sameSavedValue(a,b)}
function savedRow(r,rows,body=r.body){const a=r.attempt;if(!Array.isArray(rows)||rows.length!==1||!validSaveRow(r.editor,rows[0],a.knownId)||Object.entries(body).some(([key,value])=>key!=='updated_at'&&!sameSavedField(key,rows[0][key],value)))throw new Error('저장된 항목을 확인하지 못했습니다.');a.knownId=rows[0].id;a.row=structuredClone(rows[0]);a.savedBody=body;a.bodyState='confirmed';return rows[0]}
function savedBodySame(a,body){return a.bodyState==='confirmed'&&Object.keys(body).filter(k=>k!=='updated_at').every(k=>sameSavedField(k,a.savedBody?.[k],body[k]))}
// PRJ-3단 DB 안전망(20261021053502_prj_depth_guard): the database refuses a fourth level or a move under itself with these fixed
// codes. The screen checks first, so this shows only when the list was stale (e.g. changed on another device); nothing was saved.
const PRJ_GUARD_TEXT={DEPTH_LIMIT:'사업영역은 3단까지만 둘 수 있어요. 저장하지 않았습니다. 목록을 다시 불러와 확인해 주세요.',PARENT_CYCLE:'자기 자신이나 그 아래 사업영역 밑으로는 옮길 수 없어요. 저장하지 않았습니다. 목록을 다시 불러와 확인해 주세요.'};
function failedSave(r,error,stage='body'){const a=r.attempt,e=r.editor;if(!sameSaveSession(e))return;if(r.confirmed){if(saveEditors.get(e.key)===e)toast('저장은 완료했습니다. 화면을 다시 불러오지 못했습니다.');return;}const guard=error?.status===400&&/^PRJ_(DEPTH_LIMIT|PARENT_CYCLE):/.exec(String(error?.message||'')),rejected=[401,403].includes(error?.status)||!!guard;if(stage==='body')a.bodyState=rejected?'idle':'unknown';else if(stage==='modules')a.modulesState=rejected?'idle':'unknown';else a.phaseState=rejected?'idle':'unknown';a.needsReview=!rejected;if(!projectSaveCurrent(r))a.needsReview=true;saveNotice(e,guard?PRJ_GUARD_TEXT[guard[1]]:(rejected?'저장할 권한을 확인해 주세요. ':'저장 결과를 확인하지 못했습니다. ')+(error.message||String(error)),{confirm:!rejected});if(rejected&&a.knownId==null&&!a.address){saveAttempts.delete(attemptKey(e));e.attempt=null}}
function saveReadPath(e,a,id=null){const scope=saveScope({...e,projectId:a.projectId,workstreamId:a.workstreamId}),q=new URLSearchParams({select:'*',...Object.fromEntries(Object.entries(scope).map(([k,v])=>[k,v===null?'is.null':'eq.'+v]))});if(id!=null)q.set('id','eq.'+id);return '/rest/v1/'+SAVE_TABLE[e.kind]+'?'+q}
async function recoverSave(e){
  const a=e.attempt||saveAttempts.get(attemptKey(e));if(!a||a.pending||e.reading||e.request||!saveEditorCurrent(e))return;
  const run=++e.readRun,active=()=>saveEditorCurrent(e)&&run===e.readRun,read=async path=>{if(!active())throw new Error('편집창이 바뀌었습니다.');const d=await api(path,{singleFlight:false,expectedSessionEpoch:e.epoch});if(!active())throw new Error('편집창이 바뀌었습니다.');return d};
  const accept=async row=>{
    const scopeEditor={...e,projectId:a.projectId,workstreamId:a.workstreamId};
    const exact=await read(saveReadPath(e,a,row.id));if(!Array.isArray(exact)||exact.length!==1||!validSaveRow(scopeEditor,exact[0],row.id))throw new Error('선택한 항목의 저장 결과를 확인하지 못했습니다.');
    const fresh=exact[0];if(a.knownId==null&&e.kind==='project')a.modulesNeeded=false;a.knownId=fresh.id;a.row=structuredClone(fresh);a.bodyState='confirmed';a.savedBody=structuredClone(fresh);
    if(a.modulesNeeded){const modules=await read('/rest/v1/app_project_modules?'+new URLSearchParams({project_id:'eq.'+fresh.id,select:'*'}));if(!Array.isArray(modules))throw new Error('사업영역 설정을 확인하지 못했습니다.');for(const row of modules)if(row.project_id===fresh.id&&savedId(row.id)&&MODULES.some(([key])=>key===row.module_key))a.moduleKeys.add(row.module_key);if(MODULES.every(([key])=>a.moduleKeys.has(key)))a.modulesState='confirmed';if(a.modulesState==='unknown'){saveNotice(e,'사업영역은 확인했습니다. 설정은 일부만 확인됐습니다. 다시 확인해 주세요.',{confirm:true});return}}
    if(a.phaseState==='unknown'){const rows=await read('/rest/v1/app_project_workstreams?'+new URLSearchParams({id:'eq.'+a.workstreamId,project_id:'eq.'+a.projectId,select:'*'}));if(!Array.isArray(rows)||rows.length!==1||rows[0].id!==a.workstreamId||rows[0].project_id!==a.projectId)throw new Error('진행 단계를 확인하지 못했습니다.');a.phaseConfirmed=rows[0].phase;a.phaseState=a.phaseConfirmed===a.phaseWanted?'confirmed':'idle'}
    a.needsReview=false;e.attempt=a;saveNotice(e,'선택한 기존 항목을 사용합니다. 입력을 확인한 뒤 저장해 주세요.');
  };
  e.reading=true;saveBusy(e,true);saveWait(e);
  try{
    if(a.knownId!=null)await accept({id:a.knownId});
    else{
      const scopeEditor={...e,projectId:a.projectId,workstreamId:a.workstreamId};const rows=await readRecordPages(saveReadPath(e,a),{...rt,api:read});if(!active())return;
      const candidates=rows.filter(row=>validSaveRow(scopeEditor,row));saveNotice(e,candidates.length?'저장된 항목을 직접 골라 주세요. 제목만으로 저장을 판단하지 않습니다.':'목록에서 결과를 찾지 못했습니다. 입력은 유지했습니다.',{confirm:!candidates.length});
      for(const row of candidates){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=String(row.name||row.title||row.summary||row.body||'제목 없음')+' · 이 항목 사용';b.onclick=async()=>{if(!active()||e.reading)return;e.reading=true;saveBusy(e,true);b.disabled=true;try{await accept(row)}catch(error){if(active())saveNotice(e,error.message||String(error),{confirm:true})}finally{if(active()){e.reading=false;saveBusy(e,false)}}};e.status.append(document.createTextNode(' '),b);const hint=document.createElement('small');hint.textContent=row.effective_on||row.created_at||'';e.status.append(hint)}
    }
  }catch(error){if(active())saveNotice(e,error.message||String(error),{confirm:true})}
  finally{if(active()){e.reading=false;saveBusy(e,false)}}
}
function rememberSaveDraft(target){for(const e of saveEditors.values())if(saveEditorCurrent(e)&&e.form.contains(target)&&e.attempt)e.attempt.liveDraft=readSaveDraft(e)}
// UI-연결요약수정: the shared link summary editor (basket-link-records.js) is mounted on #ps3Body for one project view at a time.
let basketRun=0,basketTargetId=null,basketPending=false,basketEditor=null,basketEditorKey='';
function disposeBasketEditor(){basketRun++;basketEditor?.dispose();basketEditor=null;basketEditorKey=''}
const basketCurrent=(id,epoch)=>basketTargetId===id&&current?.id===id&&detail?.p.id===id&&$('#ps3Body')?.dataset.project===id&&epoch===detailEpoch&&!$('#ps3DetailModal')?.classList.contains('hidden');
function flushBasketLinks(){if(basketPending&&basketCurrent(basketTargetId,detailEpoch))void refreshBasketLinks()}
function restoreBasketTarget(){basketTargetId=current?.id||null;flushBasketLinks()}
const archived=()=>catalog.archived(projects);
const tops=()=>catalog.tops(projects);
const kids=p=>catalog.kids(projects,p);
const parent=p=>p?.parent_id?projects.find(x=>x.id===p.parent_id):null;
// PRJ-3단 (docs/design/project-3-levels.md): projects go at most three levels deep (상위 → 하위 → 그 아래). The limit is a screen
// rule (the database stores only parent_id); the screen offers no deeper parent, never offers the project itself or one under it,
// and saveProject checks the same rule again before writing. depth is 0 for a top project, 1 for its child, 2 for a grandchild.
const MAX_DEPTH=2;
const ancestors=p=>{const out=[],seen=new Set([p?.id]);let x=p;while(x?.parent_id){const up=projects.find(y=>y.id===x.parent_id);if(!up||seen.has(up.id))break;seen.add(up.id);out.unshift(up);x=up}return out};
const depthOf=p=>ancestors(p).length;
// Every project under p (any status), in tree order, with its depth below p (children 1, grandchildren 2).
function descendants(p,{activeOnly=false}={}){const out=[],seen=new Set([p?.id]);const walk=(x,d)=>{for(const c of (activeOnly?kids(x):projects.filter(y=>y.parent_id===x.id)))if(!seen.has(c.id)){seen.add(c.id);out.push({project:c,depth:d});walk(c,d+1)}};if(p)walk(p,1);return out}
const heightOf=p=>Math.max(0,...descendants(p).map(x=>x.depth));
// Why p cannot become the parent of self (null for a new project), or '' when it can.
function parentProblem(p,self){if(!p||p.status==='archived')return '상위 사업영역을 다시 골라 주세요.';if(self&&(p.id===self.id||descendants(self).some(x=>x.project.id===p.id)))return '자기 자신이나 그 아래 사업영역 밑으로는 옮길 수 없어요.';if(depthOf(p)+1+(self?heightOf(self):0)>MAX_DEPTH)return '사업영역은 3단까지만 둘 수 있어요.';return ''}
// The projects of the list in tree order (what the list shows and reads summaries for).
const listedProjects=()=>catalog.tree(projects).map(x=>x.project);
// PRJ-색: a main project stores one of these keys in metadata.color (the database accepts only these keys); theme-tokens.css maps
// each key to light/dark values. A child shows its parent's color in the soft tone. Missing or unknown color is gray.
const PROJECT_COLORS=[['green','초록'],['blue','파랑'],['orange','주황'],['purple','보라'],['pink','분홍'],['yellow','노랑'],['red','빨강'],['gray','회색']];
const colorKey=v=>PROJECT_COLORS.some(([k])=>k===v)?v:'';
// PRJ-3단: every level under a main project shows the main project's color in the soft tone.
function colorDot(p){const top=ancestors(p)[0]||(p?.parent_id?spaces.find(x=>x.id===p.parent_id):null);return `<span class="ps3-color-dot" data-color="${colorKey((top||p)?.metadata?.color)||'gray'}"${top?' data-tone="soft"':''} aria-hidden="true"></span>`}
function paintColorPicker(){const field=$('#ps3CreateColorField');if(!field)return;const value=colorKey($('#ps3CreateColor').value);field.hidden=!!$('#ps3CreateParent').value;field.querySelectorAll('[data-ps3-color]').forEach((b,i)=>{const on=b.dataset.ps3Color===value;b.setAttribute('aria-checked',String(on));b.tabIndex=on||!value&&i===0?0:-1})}
function pickColor(key,focus=false){const input=$('#ps3CreateColor');if(!input||!colorKey(key))return;if(input.value!==key){input.value=key;input.dispatchEvent(new Event('input',{bubbles:true}))}paintColorPicker();if(focus)$(`#ps3CreateColorField [data-ps3-color="${key}"]`)?.focus()}
const nameOf=id=>profiles.find(x=>x.user_id===id)?.display_name||id?.slice(0,8)||'팀원';
const canManage=p=>p?.owner_id===user?.id;
const canEdit=p=>canManage(p);
const MODAL_FOCUS={ps3DetailModal:'[data-ps3-close="ps3DetailModal"]',ps3CreateModal:'#ps3CreateName',ps3WorkstreamModal:'#ps3WsTitle',ps3MilestoneModal:'#ps3MilestoneTitle'};
// UI-PC프로젝트좌우: on a PC (1024px~) the projects screen is the list on the left and the chosen project's detail on the right.
// The right pane shows the same detail element (#ps3DetailModal, drawn only by renderDetail) moved into #ps3DetailPane as a
// region instead of a dialog, the way google-tasks.js docks its editor in #gtDetailPane. Phones, middle widths (761~1023px)
// and a detail opened over another screen (home, basket) keep the dialog. placeDetail() is the only place that moves it.
const PC=window.matchMedia?.('(min-width:1024px)');
// The pane is laid out only by the PC rule of project-system-v3.css; where that rule does not show it, the dialog stays.
// MTG-프로젝트합치기 ①: 사업영역 목록·상세는 사업 보고 위의 창(#areaWindow, area-window.js가 여닫음) 안에 있다. 창이 떠 있을 때만 '이 화면'이다.
const areaOpen=()=>{const w=$('#areaWindow');return !!w&&!w.classList.contains('hidden')};
const splitWanted=()=>{const pane=$('#ps3DetailPane');return !!PC?.matches&&areaOpen()&&!!pane&&getComputedStyle(pane).display!=='none'};
const docked=()=>$('#ps3DetailModal')?.dataset.ps3Docked==='1';
const detailTrigger=()=>$('#ps3DetailModal [data-ps3-close="ps3DetailModal"]');
function placeDetail(){
  const m=$('#ps3DetailModal'),pane=$('#ps3DetailPane');if(!m)return false;
  const dock=splitWanted(),open=!m.classList.contains('hidden');
  if(dock&&docked()&&m.parentElement===pane){pane.classList.toggle('has-project',open);return true}
  if(!dock&&!docked())return false;
  if(dock){
    if(open)window.KPTUA11y?.dialog.deactivate(m,{restoreFocus:false});
    pane.append(m);m.classList.add('ps3-docked');m.setAttribute('role','region');m.removeAttribute('aria-modal');m.dataset.ps3Docked='1';pane.classList.toggle('has-project',open);
  }else{
    document.body.append(m);m.classList.remove('ps3-docked');m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');delete m.dataset.ps3Docked;pane?.classList.remove('has-project');
    if(open)window.KPTUA11y?.dialog.activate(m,{trigger:null,initialFocus:MODAL_FOCUS.ps3DetailModal,onRequestClose:()=>detailTrigger()?.click()});
  }
  paintSelection();repaintHead();return dock
}
// UI-중복제목삭제: docked on the PC right pane the top line already names the project ("프로젝트 › 이름"), so the head has no title line of its
// own there (the h2 is not made; the pane is named by aria-label) and the project's colour dot moves to the head's summary line. As a dialog
// (phone, 761~1023px, or opened over another screen) the h2 with the dot and name stays, as before.
function paintHead(p){
  const m=$('#ps3DetailModal'),summary=$('#ps3Summary');if(!m||!summary)return;
  let h=$('#ps3Title');summary.querySelector(':scope>.ps3-color-dot')?.remove();
  if(docked()){h?.remove();m.removeAttribute('aria-labelledby');m.setAttribute('aria-label',p.name||'이름 없음');summary.insertAdjacentHTML('afterbegin',colorDot(p));return}
  if(!h){h=document.createElement('h2');h.id='ps3Title';summary.before(h)}
  m.removeAttribute('aria-label');m.setAttribute('aria-labelledby','ps3Title');
  h.innerHTML=colorDot(p)+`<span class="ps3-title-text">${esc(p.name)}</span>`;
}
function repaintHead(){const d=detail;if(d&&current&&d.p.id===current.id&&!$('#ps3DetailModal')?.classList.contains('hidden'))paintHead(d.p)}
// The list row of the project shown on the right carries the selection (PC only); choosing it again, or while it is
// still opening, leaves the pane as it is (bind).
function paintSelection(){const id=docked()&&!$('#ps3DetailModal').classList.contains('hidden')?current?.id:null;
// UI-상단줄제목: the same project's name goes to the top line's place (kptu:where-item); null when nothing is open on the right.
window.dispatchEvent(new CustomEvent('kptu:where-item',{detail:{view:'projects',name:id?(current?.name||'이름 없음'):null}}));document.querySelectorAll('#projectGrid .ps3-plist [data-ps3-project]').forEach(b=>{const on=!!id&&b.dataset.ps3Project===id;b.classList.toggle('is-selected',on);if(on)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current')})}
// The last project seen on this device opens first next time (PC): split-last.js, shared with the 담당조직 screen
// (ORG-PC좌우). Owner-scoped (kptu_owner_cache: is cleared on sign-out); a blocked storage only means the first project opens.
const lastProject=lastSeen('project');
function rememberLast(id){lastProject.write(user?.id,id)}
function readLast(){return lastProject.read(user?.id)}
// Scroll of the detail and the list, kept when a 🧺 record opens its note and restored on return.
function detailScroll(){const m=$('#ps3DetailModal');return {pane:$('#ps3DetailPane')?.scrollTop||0,card:m?.querySelector('.modal-card')?.scrollTop||0,modal:m?.scrollTop||0,list:$('#projectGrid .ps3-plist')?.scrollTop||0,page:window.scrollY||0}}
function restoreScroll(s){if(!s)return;const set=()=>{const m=$('#ps3DetailModal'),pane=$('#ps3DetailPane'),list=$('#projectGrid .ps3-plist'),card=m?.querySelector('.modal-card');if(pane)pane.scrollTop=s.pane||0;if(list)list.scrollTop=s.list||0;if(card)card.scrollTop=s.card||0;if(m)m.scrollTop=s.modal||0;window.scrollTo({top:s.page||0,behavior:'instant'})};set();requestAnimationFrame(set)}
function toast(msg){const t=$('#toast');if(!t)return;t.textContent=msg;kptuHoldToast(t)}
async function googleCalendarCall(action,{method='GET',body=null,params=null,expectedSessionEpoch=null}={}){if(!(await rt.session.ensure()))throw new Error('로그인이 필요합니다.');const u=new URL(rt.config.url+'/functions/v1/google-calendar');if(action)u.searchParams.set('action',action);if(params)Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,String(v)));const d=await api(u.toString(),{method,body,...(expectedSessionEpoch==null?{}:{expectedSessionEpoch})});if(d?.error&&!d?.partial_failure)throw new Error(d.error||'Google Calendar 요청 실패');return d}
async function googleCalendarStatus(){const cached=window.__KPTU_GOOGLE_STATE__;if(cached&&typeof cached.connected==='boolean'&&Array.isArray(cached.calendars)){googleCalendarState=cached;return cached}try{googleCalendarState=await googleCalendarCall('status');window.__KPTU_GOOGLE_STATE__={...(window.__KPTU_GOOGLE_STATE__||{}),...(googleCalendarState||{})};return googleCalendarState}catch(e){googleCalendarState={connected:false,calendars:[],warning:e?.message||String(e)};return googleCalendarState}}
const writableGoogleCalendars=s=>(s?.calendars||[]).filter(x=>['owner','writer'].includes(x.accessRole||''));
const milestoneGoogleLinked=m=>!!(m?.google_calendar_id&&m?.google_event_id);
function milestoneVisibleBody(){
  const value=$('#ps3MilestoneAt').value;
  return {title:$('#ps3MilestoneTitle').value.trim(),start_at:value?toSeoulISO(value):null,end_at:null,notes:$('#ps3MilestoneNotes').value.trim()||null}
}
function milestoneFullBody(visible,source=null){return{workstream_id:source?.workstream_id||null,title:visible.title,milestone_type:source?.milestone_type||'action',status:source?.status||'planned',start_at:visible.start_at,end_at:visible.end_at||null,notes:visible.notes||null}}
function milestoneRestorePayload(row,googleEventId=row?.google_event_id){
  const out={};
  for(const key of ['id','project_id','workstream_id','title','milestone_type','status','start_at','end_at','notes','event_id','child_project_id','sort_order','created_by','google_calendar_id'])if(row?.[key]!==undefined)out[key]=row[key];
  out.google_event_id=googleEventId||null;
  return out
}
function milestoneReadyButton(e){if(saveEditorCurrent(e))saveBusy(e,!!e.preparing||!!e.request||!!e.attempt?.pending||!e.googleReady)}
function milestoneOriginalNotice(e,message){if(!saveEditorCurrent(e))return;saveNotice(e,message);const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent='일정 원본 확인';b.onclick=()=>prepareMilestoneGoogle(e);e.status.append(document.createTextNode(' '),b)}
function validGoogleAddress(event,address){return !!event&&savedId(event.id)&&event.id===address.eventId&&event.calendarId===address.calendarId}
async function prepareMilestoneGoogle(e){
  if(!saveEditorCurrent(e)||e.request||e.preparing)return;
  const sel=$('#ps3MilestoneGoogle'),hint=$('#ps3MilestoneGoogleHint'),source=e.source,linked=milestoneGoogleLinked(source);e.googleReady=false;e.preparing=true;sel.disabled=true;milestoneReadyButton(e);
  try{
    if(source&&!linked){sel.innerHTML='<option value="">Google 연결 없음</option>';hint.textContent='기존 미연동 일정입니다. 수정해도 Google 일정을 새로 만들지 않습니다.';e.googleReady=true;return}
    const address=linked?{calendarId:source.google_calendar_id,eventId:source.google_event_id}:null;
    sel.innerHTML='<option value=""></option>';sel.setAttribute('aria-busy','true');hint.innerHTML=waitInlineHtml();
    const status=await googleCalendarCall('status',{expectedSessionEpoch:e.epoch});sel.removeAttribute('aria-busy');if(!saveEditorCurrent(e))return;
    const writable=writableGoogleCalendars(status);e.calendars=writable;
    if(!status?.connected||!writable.length)throw new Error(status?.warning?'Google Calendar 재연결이 필요합니다: '+status.warning:status?.connected?'쓰기 가능한 캘린더가 없습니다.':'Google Calendar 연결이 필요합니다.');
    if(linked){
      if(!writable.some(c=>c.id===address.calendarId))throw new Error('이 일정의 캘린더를 수정할 권한을 확인해 주세요.');
      sel.innerHTML='<option value="'+esc(address.calendarId)+'">'+esc(writable.find(c=>c.id===address.calendarId).summary||address.calendarId)+'</option>';sel.value=address.calendarId;
      const result=await googleCalendarCall('event',{params:{calendarId:address.calendarId,eventId:address.eventId},expectedSessionEpoch:e.epoch});if(!saveEditorCurrent(e))return;
      if(!validGoogleAddress(result?.event,address)||!result.event.start||!result.event.end)throw new Error('Google 일정의 원본과 정확한 주소를 확인하지 못했습니다.');
      e.googleBefore=freezeSave(structuredClone(result.event));hint.textContent=result.event.allDay?'종일 일정입니다. 제목과 메모를 수정할 수 있습니다.':result.event.recurring?'반복 일정입니다. 날짜 변경은 일정 화면에서 확인해 주세요.':'Google Calendar의 같은 일정으로 수정됩니다.';
    }else{
      sel.innerHTML=writable.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.summary||c.id)+'</option>').join('');const selected=new Set(status.selected||[]),named=writable.filter(c=>c.summary==='공공운수노조'),preferred=(named.length===1?named[0]:null)||writable.find(c=>selected.has(c.id)||(c.primary&&selected.has('primary')))||writable.find(c=>c.primary)||writable[0];const remembered=e.attempt?.liveDraft?.[3];if(remembered&&!writable.some(c=>c.id===remembered))sel.insertAdjacentHTML('beforeend','<option value="'+esc(remembered)+'" disabled>이전 선택 · 권한 확인 필요</option>');sel.value=remembered||e.attempt?.calendarId||preferred.id;sel.disabled=false;hint.textContent='선택한 Google Calendar에 일정이 저장됩니다.';
    }
    e.googleReady=true;
  }catch(error){if(saveEditorCurrent(e)){hint.textContent=error.message||String(error);if(!source)sel.innerHTML='<option value="">'+esc(hint.textContent.includes('재연결')?'Google Calendar 재연결 필요':hint.textContent)+'</option>';milestoneOriginalNotice(e,hint.textContent)}}
  finally{if(saveEditorCurrent(e)){e.preparing=false;milestoneReadyButton(e)}}
}
function googleMilestonePayload(action,calendarId,eventId,body){
  if(!body.start_at)throw new Error('Google Calendar에 저장하려면 일시를 입력해 주세요.');
  const start=new Date(body.start_at),end=new Date(start.getTime()+60*60*1000);
  return {action,calendar_id:calendarId,...(eventId?{event_id:eventId}:{}),title:body.title,memo:body.notes||'',...(action==='create-event'?{location:''}:{}),all_day:false,start_iso:start.toISOString(),end_iso:end.toISOString()}
}
async function createGoogleMilestone(calendarId,body){
  const result=await googleCalendarCall('',{method:'POST',body:googleMilestonePayload('create-event',calendarId,null,body)});
  if(!result?.event?.id)throw new Error('Google Calendar가 생성한 일정 ID를 확인하지 못했습니다.');
  return result.event
}
async function updateGoogleMilestone(calendarId,eventId,body){
  if(!calendarId||!eventId)throw new Error('Google Calendar 연결 식별자가 없습니다.');
  const result=await googleCalendarCall('',{method:'POST',body:googleMilestonePayload('update-event',calendarId,eventId,body)});
  if(!result?.event?.id)throw new Error('Google Calendar 수정 결과를 확인하지 못했습니다.');
  return result.event
}
async function deleteGoogleMilestone(calendarId,eventId){
  if(!calendarId||!eventId)throw new Error('Google Calendar 연결 식별자가 없습니다.');
  return googleCalendarCall('',{method:'POST',body:{action:'delete-event',calendar_id:calendarId,event_id:eventId}})
}
async function reloadMilestoneCalendars(isCurrent=()=>true){
  if(!isCurrent())return;
  if(window.__KPTU_RELOAD_GOOGLE_EVENTS__)await window.__KPTU_RELOAD_GOOGLE_EVENTS__();
  if(!isCurrent())return;window.dispatchEvent(new CustomEvent('kptu:calendar-changed',{detail:{source:'project-milestone'}}))
}
function rollbackMessage(stage,error,link={}){
  console.error('project milestone rollback failed',{stage,calendarId:link.calendarId||null,eventId:link.eventId||null,error});
  return stage+' 되돌리기에도 실패해 Google Calendar와 Web2가 불일치할 수 있습니다. 일정을 직접 확인해 주세요.'
}
function openModal(id,{trigger=document.activeElement,initialFocus=null}={}){const m=$('#'+id);if(!m)return;const wasHidden=m.classList.contains('hidden');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');if(wasHidden)window.KPTUA11y?.dialog.activate(m,{trigger,initialFocus:initialFocus||MODAL_FOCUS[id]||null,onRequestClose:()=>m.querySelector(`[data-ps3-close="${id}"]`)?.click()})}
function closeModal(id){const m=$('#'+id);if(!m)return;closeSaveEditor(id);m.classList.add('hidden');m.setAttribute('aria-hidden','true');if(id==='ps3DetailModal'&&docked()){$('#ps3DetailPane')?.classList.remove('has-project');paintSelection();return}window.KPTUA11y?.dialog.deactivate(m,{restoreFocus:true,fallbackFocus:id==='ps3DetailModal'?'#newProjectBtn':null})}
function urlFor(id){const u=new URL(location.href);u.searchParams.set('project',id);return u.pathname+u.search+u.hash}
// MTG-프로젝트합치기 ①: 사업영역 관리 창의 뒤로가기 기록(kptuOverlay:'areaWindow', mobile-modal-history.js)은 남긴다 — 지우면 다음 뒤로가기가 창을 닫지 못한다.
const windowEntry=()=>history.state?.kptuOverlay==='areaWindow'?{kptuOverlay:'areaWindow'}:{};
// 창은 둔 채 그 위의 상세만 ✕로 닫을 때(지금 기록이 상세의 것)는 그 칸을 창의 기록으로 남긴다 — 빈 기록으로 바꾸면, 다음에 다른 창
// (+ 사업영역 등)을 닫으며 그 칸으로 돌아올 때 공용 폰 기록이 '창을 떠난 기록'으로 보고 사업영역 창까지 닫는다(project-system-v3.spec:235).
// 창과 함께 닫을 때(hideProjects)는 그대로(창 닫기가 제 기록을 처리한다).
let closingWindow=false;
const closedEntry=()=>!closingWindow&&history.state?.kptuOverlay==='ps3DetailModal'&&areaOpen()&&$('#areaWindow')?.dataset.kptuHistoryOpen==='1'?{kptuOverlay:'areaWindow'}:windowEntry();
function clearUrl(){const u=new URL(location.href);u.searchParams.delete('project');history.replaceState(closedEntry(),'',u.pathname+u.search+u.hash)}
async function context(epoch=projectEpoch){
  if(!(await rt.session.ensure()))return false;
  const candidate=rt.context?.read?.()||window.__KPTU_BOOT_CONTEXT__,shared=candidate?.user?.id===rt.session.read()?.user?.id?candidate:null;
  let nextUser=shared?.user||null,nextMembership=shared?.membership||null,nextWid=shared?.workspace?.id||nextMembership?.workspace_id||null;
  if(!nextUser?.id||!nextWid){
    nextUser=await api('/auth/v1/user');
    if(epoch!==projectEpoch||!nextUser?.id)return false;
    const ms=await api(`/rest/v1/app_workspace_members?user_id=eq.${nextUser.id}&select=workspace_id,role&limit=1`);
    if(epoch!==projectEpoch)return false;
    nextMembership=ms?.[0]||null;nextWid=nextMembership?.workspace_id||null;
  }
  if(!nextWid)return false;
  const nextProfiles=await api('/rest/v1/app_profiles?select=user_id,display_name');
  if(epoch!==projectEpoch)return false;
  user=nextUser;membership=nextMembership;wid=nextWid;members=[];profiles=nextProfiles||[];
  return true
}
async function loadProjects(epoch=projectEpoch){
  if(!wid||!user?.id)return projects;
  const rows=await catalog.fetchSpaces(wid,user.id);
  if(epoch!==projectEpoch)return projects;
  spaces=rows||[];
  projects=catalog.publish({workspaceId:wid,userId:user.id,spaces}).projects;
  return projects
}
function enabled(d,key){return !d.modules.length||d.modules.some(m=>m.module_key===key)}
function moduleTitle(d,key,fallback){return d.modules.find(m=>m.module_key===key)?.title||fallback}
function empty(t){return emptyHtml(t)}
function ensureUi(){if($('#ps3DetailModal'))return;document.body.insertAdjacentHTML('beforeend',`
<div id="ps3DetailModal" class="modal hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="ps3Title"><div class="modal-card ps3-detail-card"><div class="modal-head ps3-modal-head"><div class="ps3-title-wrap"><div id="ps3Hierarchy" class="ps3-hierarchy"></div><h2 id="ps3Title"></h2><p id="ps3Summary" class="muted ps3-head-summary"></p></div><div class="ps3-head-actions"><div id="ps3Menu"></div><button class="icon-btn" data-ps3-close="ps3DetailModal" type="button" aria-label="닫기">×</button></div></div><div id="ps3Body"></div></div></div>
<div id="ps3CreateModal" class="modal hidden" data-enter-save role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="ps3CreateHeading"><div class="modal-card small-card"><div class="modal-head"><div><h2 id="ps3CreateHeading">사업영역 만들기</h2></div><button class="icon-btn" data-ps3-close="ps3CreateModal" type="button" aria-label="닫기">×</button></div><label>사업영역 이름<input id="ps3CreateName"></label><label>목표·설명<textarea id="ps3CreateObjective" rows="4"></textarea></label><label>상위 사업영역<select id="ps3CreateParent"></select></label><div id="ps3CreateColorField" class="ps3-color-field"><span id="ps3CreateColorLabel" class="ps3-color-label">색</span><input id="ps3CreateColor" type="hidden" value=""><div class="ps3-color-options ui-swatches" role="radiogroup" aria-labelledby="ps3CreateColorLabel">${PROJECT_COLORS.map(([k,l])=>swatchHtml({color:`var(--ds-project-${k})`,label:l,role:'radio',attrs:{'data-ps3-color':k,tabindex:'-1'}})).join('')}</div></div><div class="two-col"><label>시작일<input id="ps3CreateStart" type="date"></label><label>종료일<input id="ps3CreateEnd" type="date"></label></div><div class="modal-action-footer"><div id="ps3CreateStatus" class="status" role="status"></div><button id="ps3CreateSave" data-enter-save-submit class="primary wide">저장</button></div></div></div>
<div id="ps3WorkstreamModal" class="modal hidden" data-enter-save role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="ps3WorkstreamHeading"><div class="modal-card small-card"><div class="modal-head"><div><div class="eyebrow">진행상황</div><h2 id="ps3WorkstreamHeading">진행상황 수정</h2></div><button class="icon-btn" data-ps3-close="ps3WorkstreamModal" aria-label="닫기">×</button></div><label>제목<input id="ps3WsTitle" maxlength="160"></label><label class="hidden">단계<select id="ps3WsPhase">${Object.entries(PHASE).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><div class="modal-action-footer"><div id="ps3WsState" class="status" role="status"></div><div class="ps3-modal-actions save-row"><button id="ps3WsDelete" class="ghost ps3-danger save-row-start hidden">삭제</button><button id="ps3WsSave" data-enter-save-submit class="primary">저장</button></div></div></div></div>

<div id="ps3MilestoneModal" class="modal hidden" data-enter-save role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="ps3MilestoneHeading"><div class="modal-card small-card"><div class="modal-head"><div><div class="eyebrow">주요 일정</div><h2 id="ps3MilestoneHeading">주요 일정 추가</h2></div><button class="icon-btn" data-ps3-close="ps3MilestoneModal" aria-label="닫기">×</button></div><label>제목<input id="ps3MilestoneTitle"></label><label>일시<input id="ps3MilestoneAt" type="hidden" data-datetime-input="일시"></label><label>Google 세부캘린더<select id="ps3MilestoneGoogle"></select><small id="ps3MilestoneGoogleHint" class="muted"></small></label><label>메모<textarea id="ps3MilestoneNotes" rows="3"></textarea></label><div class="modal-action-footer"><div id="ps3MilestoneState" class="status" role="status"></div><div class="ps3-modal-actions save-row"><button id="ps3MilestoneDelete" class="ghost ps3-danger save-row-start hidden">삭제</button><button id="ps3MilestoneSave" data-enter-save-submit class="primary">저장</button></div></div></div></div>
<div id="ps3DeleteModal" class="modal hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="ps3DeleteHeading"><div class="modal-card small-card"><div class="modal-head"><div><h2 id="ps3DeleteHeading">사업영역 삭제</h2></div><button class="icon-btn" data-ps3-close="ps3DeleteModal" aria-label="닫기">×</button></div><div id="ps3DeleteMessage" class="muted"></div><p data-ps3-delete-note class="muted"></p><button id="ps3DeleteConfirm" class="primary wide ps3-danger-btn">삭제</button><div id="ps3DeleteState" class="status"></div></div></div>
<div id="ps3ArchiveModal" class="modal hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="ps3ArchiveHeading"><div class="modal-card small-card"><div class="modal-head"><div><h2 id="ps3ArchiveHeading">보관한 사업영역</h2></div><button class="icon-btn" data-ps3-close="ps3ArchiveModal" aria-label="닫기">×</button></div><div id="ps3ArchiveTabs" class="ps3-archive-tabs" role="group" aria-label="보관과 휴지통" hidden><button type="button" class="mini" data-ps3-archive-tab="archive">보관</button><button type="button" class="mini" data-ps3-archive-tab="trash">휴지통</button></div><p data-ps3-archive-hint class="muted">삭제하지 않고 목록에서만 숨긴 사업영역입니다.</p><div id="ps3ArchiveList" class="ps3-archive-list"></div></div></div>`);bindDateTimeFields($('#ps3MilestoneModal'))}
// D-project-list: names first; optional metadata has one run owner, shared with archive rows.
let listCounts={},summaryRun=0;
const milestoneDays=id=>{const c=listCounts[id]||{};return c.milestone?Math.round((Date.parse(dayKey(Date.parse(c.milestone)))-Date.parse(dayKey()))/86400000):null};
function summaryHtml(id){const c=listCounts[id]||{},days=milestoneDays(id);
 // UI-디자인기준-2: the right pill is the D-day of the project's next milestone (same read and rule as the home D-day chips: nearest
 // unfinished milestone from today, "D-day" today, red within 3 days). "일정 없음" only after the read answered; nothing while loading.
 // UI-디자인기준-3: the list shows only this pill. Open-task counts and the last record date stay in the project detail.
 // PRJ-화면다듬기: with no upcoming milestone the pill is the project's latest progress/update record date ("최근 기록 10.21", the
 // same date format as the detail's record list); no record at all shows nothing (the old "일정 없음" text is gone).
 return days!==null&&days>=0?`<span class="ps3-dday${days<=3?' ps3-dday-soon':''}" aria-label="다음 주요 일정 ${days===0?'오늘':days+'일 후'}">${days===0?'D-day':'D-'+days}</span>`:c.last?`<span class="ps3-dday ps3-dday-none ps3-dday-last">최근 기록 ${esc(day(c.last))}</span>`:''
}
// below: the rows under p in tree order ({project,depth}, depth 1 = child, 2 = grandchild), indented by depth (PRJ-3단).
function listRowHtml(p,below,{open=true,trail='',order=false}={}){
 const row=(x,child=false,tail='',depth=0)=>{const main=`<span class="kptu-list-row-main">${colorDot(x)}<span class="ps3-prow-name kptu-list-name">${esc(x.name)}</span><span class="ps3-prow-meta kptu-list-summary" data-ps3-summary="${esc(x.id)}">${summaryHtml(x.id)}</span><span class="kptu-list-chevron" aria-hidden="true">›</span></span>`;
 const level=child?` data-ps3-depth="${depth}"`:'';
 const drag=open&&dragReady(x)?' draggable="true"':'';
 // PRJ-순서바꾸기(폰): in 순서 바꾸기 mode the row is not a button (a tap must not open the detail) and carries ↑ ↓ at its right.
 if(order)return `<div class="ps3-restore-line ps3-order-line" data-ps3-order-row="${esc(x.id)}"><div class="${child?'ps3-kid-row':'ps3-prow-main'} kptu-list-row"${level}>${main}</div>${orderButtons(x)}</div>`;
 return open?`<button type="button" class="${child?'ps3-kid-row':'ps3-prow-main'} kptu-list-row"${level}${drag} data-ps3-project="${esc(x.id)}">${main}</button>`:`<div class="ps3-restore-line"><div class="${child?'ps3-kid-row':'ps3-prow-main'} kptu-list-row"${level}>${main}</div>${tail}</div>`};
 return `<div class="ps3-prow" data-ps3-row="${esc(p.id)}">${row(p,false,trail)}${below.length?`<div class="ps3-prow-kids">${below.map(x=>row(x.project,true,'',x.depth)).join('')}</div>`:''}</div>`
}
function paintSummaries(){document.querySelectorAll('[data-ps3-summary]').forEach(el=>{el.innerHTML=summaryHtml(el.dataset.ps3Summary)})}
async function loadListSummaries(listed){
 const run=++summaryRun,epoch=projectEpoch,owner=user?.id,workspace=wid;
 if(!listed.length)return;
 const current=()=>run===summaryRun&&epoch===projectEpoch&&user?.id===owner&&wid===workspace;
 // PostgREST per-parent embedded limit: nearest nonterminal milestone, one HTTP read. The column hint distinguishes
 // milestone.project_id from milestone.child_project_id. No inner join: empty projects remain.
 const q=new URLSearchParams({workspace_id:'eq.'+workspace,owner_id:'eq.'+owner,id:'in.('+listed.map(p=>p.id).join(',')+')',select:'id,milestones:app_project_milestones!project_id(start_at),progress:app_project_progress_updates!project_id(effective_on)',
  'milestones.order':'start_at.asc','milestones.limit':'1','progress.order':'effective_on.desc,created_at.desc','progress.limit':'1',
  'milestones.start_at':'gte.'+new Date(ranges().start).toISOString(),'milestones.or':'(status.is.null,status.not.in.(done,completed,cancelled,canceled))'});
 try{
  // One read for any number of projects: the latest progress record comes with the milestone in the same request (basket links are not read here).
  const rows=await api('/rest/v1/app_spaces?'+q);if(!current())return;
  for(const p of listed){const row=(rows||[]).find(x=>x.id===p.id),milestone=row?.milestones?.[0]?.start_at,
   last=[row?.progress?.[0]?.effective_on].filter(v=>/^\d{4}-\d{2}-\d{2}/.test(v||'')).map(v=>v.slice(0,10)).sort().pop()||null;
   listCounts[p.id]={...listCounts[p.id],milestone:Number.isFinite(Date.parse(milestone))?milestone:null,last}}paintSummaries();
 }catch{}
}
// PRJ-목록접어두기: 펼쳐 둔 프로젝트가 위, 접은 프로젝트(스스로 접었거나 상위가 접힘)는 맨 아래 '▸ 접어 둔 것 n · 이름…' 한 줄 안에 흐리게.
// 접은 것의 자리·순서만 바뀐다: 목록에서 빠지지 않고, 눌러 들어갈 수 있고, 데이터는 그대로다. 펼침 여부는 이 화면 안의 상태일 뿐이다.
let foldOpen=false,foldBusy=false;
function foldedListHtml(){
 const folded=foldedSet(projects),parts=partitionTree(catalog.tree(projects),folded),open=blocks(parts.open),shut=blocks(parts.folded);
 const one=b=>listRowHtml(b.head,b.below,{order:orderMode});
 const fs=foldSummary(shut.map(b=>b.head.name));
 return open.map(one).join('')+(shut.length?`<details class="ps3-fold" data-ps3-fold${foldOpen?' open':''}><summary class="ps3-fold-summary"><span class="ps3-fold-label">접어 둔 것 ${fs.count}</span><span class="ps3-fold-names">· ${esc(fs.names)}</span></summary><div class="ps3-fold-body">${shut.map(one).join('')}</div></details>`:'')
}
async function renderGrid({isCurrent=()=>true}={}){
 const grid=$('#projectGrid');if(!grid)return;
 const epoch=projectEpoch;await loadProjects(epoch);if(epoch!==projectEpoch||!isCurrent())return;
 const rows=tops(),listed=listedProjects();grid.dataset.ps3Ready='1';
 const add=$('#newProjectBtn'),archiveBtn=$('#ps3ArchiveBtn');
 // UI-PC프로젝트좌우: the list is replaced in place (keeping its own scroll); the detail pane beside it stays.
 const old=grid.querySelector(':scope>.ps3-plist'),list=document.createElement('div');list.className='ps3-plist';
 list.innerHTML=`<div class="add-list-head"><span class="muted" data-ps3-total>사업영역 ${rows.length}개</span><div class="ps3-project-toolbar"></div></div>${rows.length?foldedListHtml():emptyHtml()}`;
 if(old){const top=old.scrollTop;old.replaceWith(list);list.scrollTop=top}else grid.prepend(list);
 if(!$('#ps3DetailPane'))grid.insertAdjacentHTML('beforeend','<aside id="ps3DetailPane" class="ps3-pane" aria-label="사업영역 상세"><p class="ps3-pane-empty">왼쪽에서 사업영역을 고르면 여기에 보입니다.</p></aside>');
 const actions=list.querySelector('.add-list-head .ps3-project-toolbar');
 if(archiveBtn){paintArchiveBtn(archiveBtn);actions.append(archiveBtn);if(trash.merged!==TRASH_STATE.MISSING)void syncTrash()}if(add&&!add.closest('#areaWindow .area-window-head'))actions.append(add);
 if(orderAvailable())actions.prepend(orderToggle());
 const key=JSON.stringify(spaces.map(p=>[p.id,p.name,p.parent_id,p.status,p.sort_order,p.updated_at]));
 if(key!==lastSpacesKey){lastSpacesKey=key;window.dispatchEvent(new CustomEvent('kptu:project-spaces-updated',{detail:{workspaceId:wid,userId:user.id,spaces}}))}
 paintSelection();
 // UI-칸폭조절: the list | detail boundary can be dragged (split-resize.js, remembered per screen).
 mountSplitResize({container:grid,name:'projects',label:'사업영역 목록과 상세 칸 폭 조절',list:()=>grid.querySelector(':scope>.ps3-plist'),pane:()=>$('#ps3DetailPane'),active:splitWanted});
 if(areaOpen())void loadListSummaries(listed);
}
// Task counts are linked pending Google tasks, counted from the completion copy in app_record_links without asking Google (TASK-구현 PR 4, plan 4.3).
async function childCounts(ch){if(!ch.length)return null;const ids=`in.(${ch.map(c=>encodeURIComponent(c.id)).join(',')})`;try{const [tasks,docs]=await Promise.all([api(`/rest/v1/app_record_links?project_id=${ids}&google_task_id=not.is.null&task_completed=eq.false&status=eq.confirmed&select=project_id,google_task_id`),api(`/rest/v1/app_documents?project_id=${ids}&select=project_id`)]);const tally=(rows,keep=()=>true)=>(rows||[]).reduce((m,x)=>{if(keep(x))m[x.project_id]=(m[x.project_id]||0)+1;return m},{});return{tasks:tally(tasks),docs:tally(docs)}}catch(e){console.warn('child project counts',e);return null}}
async function fetchDetail(id){const p=projects.find(x=>x.id===id);if(!p)return null;void loadDocumentCategories();const enc=encodeURIComponent(id),basketVersion=basketRun;const [modules,workstreams,progress,milestones,tasks,docs,counts,basket,meetings]=await Promise.all([api(`/rest/v1/app_project_modules?project_id=eq.${enc}&select=*&order=sort_order.asc`),api(`/rest/v1/app_project_workstreams?project_id=eq.${enc}&select=*&order=sort_order.asc`),api(`/rest/v1/app_project_progress_updates?project_id=eq.${enc}&select=*&order=effective_on.desc,created_at.desc`),api(`/rest/v1/app_project_milestones?project_id=eq.${enc}&select=*&order=start_at.asc.nullslast,sort_order.asc`),api(`/rest/v1/app_record_links?project_id=eq.${enc}&google_task_id=not.is.null&task_completed=eq.false&status=eq.confirmed&select=google_task_id`),api(`/rest/v1/app_documents?project_id=eq.${enc}&select=*&order=document_date.desc.nullslast,created_at.desc`),childCounts(kids(p)),readLinkRecords({kind:'project',targetIds:[id],noteKinds:LINK_NOTE_KINDS},rt).then(rows=>({rows}),()=>({error:true})),readLinkedReports({kind:'project',id},rt).then(async r=>({rows:r.rows,photos:await readReportPhotos(r.rows,rt).catch(e=>{console.warn('project report photos read failed',e);return new Map()})}),e=>{console.warn('project reports read failed',e);return{rows:[],photos:new Map()}})]);return{p,basketVersion,meetings:meetings?.rows||[],reportPhotos:meetings?.photos||new Map(),basketLinks:basket.rows||[],basketError:!!basket.error,childCounts:counts,modules:(modules||[]).filter(x=>x.enabled),workstreams:workstreams||[],progress:progress||[],milestones:milestones||[],openTasks:(tasks||[]).length,docs:docs||[]}}
function acceptDetail(result){if(result&&detail?.p.id===result.p.id&&result.basketVersion!==basketRun){result.basketLinks=detail.basketLinks;result.basketError=detail.basketError}return result}

function overview(d){const open=d.openTasks,up=d.milestones.filter(x=>!x.start_at||new Date(x.start_at)>=new Date()).sort((a,b)=>new Date(a.start_at||'2999')-new Date(b.start_at||'2999'))[0],last=d.progress[0],m=d.p.metadata||{};return `<section class="ps3-section" id="ps3-overview"><div class="ps3-section-head"><div><h3>${esc(moduleTitle(d,'overview','개요'))}</h3><p>현재 상태를 빠르게 파악합니다.</p></div></div><div class="ps3-stat-grid"><div><b>${d.workstreams.length}</b><span>진행 영역</span></div><div><b>${open}</b><span>미완료 할 일</span></div><div><b>${d.docs.length}</b><span>관련 자료</span></div><div><b>${d.milestones.length}</b><span>주요 일정</span></div></div><div class="ps3-summary"><b>목표</b><p>${esc(m.objective||d.p.description||'목표 미입력')}</p><b>최근 변화</b><p>${esc(last?.summary||'아직 진행 기록이 없습니다.')}</p><b>다음 주요 일정</b><p>${up?`${esc(up.title)}${up.start_at?' · '+date(up.start_at):''}`:'등록된 주요 일정이 없습니다.'}</p></div></section>`}
const count=n=>`<span class="ps3-count">${n}</span>`;
// PRJ-기록입력: additions sit as a small + beside the group title.
const addPlus=(label,attrs)=>`<button type="button" class="ps3-add-plus" aria-label="${label}" ${attrs}>+</button>`;
// PRJ-3단: main and second-level projects have the child list (and its +); the third level has none.
function childrenHtml(d,ch,manageable){if(depthOf(d.p)>=MAX_DEPTH||(!ch.length&&!manageable))return'';const c=d.childCounts;return `<section class="ps3-section" id="ps3-children"><div class="ps3-section-head"><h3>하위 사업영역 ${count(ch.length)}</h3>${manageable?addPlus('하위 사업영역 추가','data-ps3-child'):''}</div>${ch.length?`<div class="ps3-child-rows">${ch.map(x=>`<button type="button" class="ps3-child-link" data-ps3-project="${x.id}"><strong>${esc(x.name)}</strong>${c?`<small>할 일 ${c.tasks[x.id]||0} · 자료 ${c.docs[x.id]||0}</small>`:''}<span aria-hidden="true">›</span></button>`).join('')}</div>`:''}</section>`}
// PRJ-기록입력: the summary line under the title — children (main projects only) · open tasks · D-n of the next milestone (list pill rule).
function headSummary(d,ch){const days=milestoneDays(d.p.id);return [!d.p.parent_id||ch.length?`하위 ${ch.length}`:'',`할 일 <span data-ps3-head-tasks>${d.openTasks}</span>`,days!==null&&days>=0?(days===0?'D-day':'D-'+days):''].filter(Boolean).join(' · ')}
// PRJ-기록입력: progress is one record list, newest first. New records come from the top input and belong to no progress item
// (workstream_id null). Older item records stay (item title in front), items without records stay as a line, and confirmed basket
// links join by date with 🧺. Stored phases/status labels are kept but not shown.
const keyOf=v=>Number.isFinite(Date.parse(v))?seoulDateKey(new Date(v)):'';
const recordFrom=u=>u.workstream_id?detail?.workstreams.find(w=>w.id===u.workstream_id)?.title||'':'';
const recordButton=(id,date,text)=>`<button type="button" class="ps3-rec-line" data-ps3-record-menu="${esc(id)}" aria-haspopup="true" aria-expanded="false" aria-controls="ps3RecordMenu"><time>${esc(day(date))}</time><span class="ps3-rec-text kptu-clamp">${text}</span></button>`;
function progressRecord(u){const from=recordFrom(u);return recordButton(u.id,u.effective_on,`${from?`<span class="ps3-rec-from">${esc(from)}</span> `:''}<span class="ps3-rec-summary">${esc(recordLines(u.summary||''))}</span>${u.next_step?` <span class="ps3-rec-next">다음: ${esc(u.next_step)}</span>`:''}`)}
function itemRecord(w){return recordButton(w.id,keyOf(w.created_at),esc(w.title||''))}
// BUG-바구니연결해제: tapping a linked line opens the original update; its ⋯ holds [업데이트 열기]·[연결 해제]·[요약 수정] (no note
// delete here; UI-연결요약수정 added [요약 수정] with the organization detail's editor and save path). UI-기록아이콘: notes linked to this project join the list too (same confirmed links, kind=note); the mark in
// front is the update or note icon (basket-link-records.js), and a note line opens the note's read view ([노트 열기]·[연결 해제]).
const LINK_NOTE_KINDS=['basket','note'];
function basketRecord(b){const text=recordText(b),note=isNoteRecord(b);return `<div class="ps3-rec ps3-rec-basket${note?' ps3-rec-note':''}" data-basket-link="${esc(b.id)}"><a class="ps3-rec-line" href="${esc(note?'./?view=basket':basketNoteHref(b.note_id))}" data-ps3-basket-note="${esc(b.note_id)}" data-ps3-note-kind="${note?'note':'basket'}"><time>${esc(day(keyOf(b.occurred_at)))}</time><span class="ps3-rec-text kptu-clamp">${recordMark(b,'ps3-rec-mark')} ${esc(text||'요약 없음')}</span></a><button type="button" class="ps3-rec-more" data-ps3-record-menu="basket:${esc(b.id)}" aria-label="정리함 기록 메뉴" aria-haspopup="true" aria-expanded="false" aria-controls="ps3RecordMenu"><span class="more-dots" aria-hidden="true">⋯</span></button></div>`}
// MTG-프로젝트합치기 결정 ⑥(10/28 19:38 '지난 진행 기록 화면 없음'): 옛 진행 기록(app_project_progress_updates)·기록 없는 진행 항목
// 줄은 이 목록에 그리지 않는다(기록은 사업 보고 한 곳, 표·데이터는 보존). 정리함 업데이트·노트 연결 줄(결정 ⑦)만 날짜순으로 남는다.
function recordItems(d){return (d.basketLinks||[]).map(b=>({key:keyOf(b.occurred_at),at:Date.parse(b.occurred_at)||0,html:basketRecord(b)})).sort((a,b)=>b.key.localeCompare(a.key)||b.at-a.at)}
function recordRows(d){const rows=recordItems(d);return `${rows.length?rows.map(x=>x.html).join(''):(!d.basketError?emptyHtml('없음',{attrs:'data-ps3-rec-empty'}):'')}${d.basketError?'<div class="status error" role="status">정리함 연결 기록을 불러오지 못했습니다. <button type="button" data-ps3-basket-retry>다시 불러오기</button></div>':''}`}
function recordCount(d){return d.basketLinks?.length||0}
// MTG-프로젝트합치기 3단계: 진행 기록 입력칸은 없다(기록은 사업 보고 한 곳). 목록에는 정리함 연결 줄만 보인다(표·데이터 보존).
function progress(d){return `<section class="ps3-section ps3-records" id="ps3-progress"><div class="ps3-section-head"><h3>${esc(moduleTitle(d,'progress','진행상황'))} <span class="ps3-count" data-ps3-record-count>${recordCount(d)}</span></h3></div><div class="ps3-rec-list" data-ps3-records>${recordRows(d)}</div></section>`}
// Library/account pattern, kept local to avoid changing other screens.
let recordMenu=null;
function closeRecordMenu(then,fromBack=false){return recordMenu?.close(then,fromBack)}
function openRecordMenu(trigger){recordMenu?.open(trigger)}
function bindRecordMenu(){
  recordMenu=createAnchoredMenu({id:'ps3RecordMenu',className:'ps3-record-menu',label:'진행 기록 관리',historyKey:'kptuProgressMenu',parent:$('#ps3DetailModal'),key:trigger=>trigger.dataset.ps3RecordMenu,canOpen:trigger=>trigger.closest('[data-ps3-record]')?.dataset.saving!=='1',
    render:id=>String(id).startsWith('basket:')?(isNoteRecord(detail?.basketLinks?.find(x=>'basket:'+x.id===id))?'<button type="button" data-ps3-record-action="open-note">노트 열기</button>':'<button type="button" data-ps3-record-action="open-note">업데이트 열기</button>')+'<button type="button" class="ps3-record-danger" data-ps3-record-action="disconnect">연결 해제</button><button type="button" data-ps3-record-action="summary">요약 수정</button>':'<button type="button" data-ps3-record-action="edit">수정</button><button type="button" class="ps3-record-danger" data-ps3-record-action="delete">삭제</button>',
    onAction:(button,active)=>{const basket=active.trigger.closest('[data-basket-link]');if(basket){const b=detail?.basketLinks?.find(x=>x.id===basket.dataset.basketLink);if(!b)return;if(button.dataset.ps3RecordAction==='open-note')openBasketNote(b.note_id,isNoteRecord(b)?'note':'basket');else if(button.dataset.ps3RecordAction==='disconnect')void disconnectBasket(b);else if(button.dataset.ps3RecordAction==='summary')editBasketSummary(b);return}const row=active.trigger.closest('[data-ps3-record]');if(!row?.isConnected)return;if(button.dataset.ps3RecordAction==='edit'){if(row.dataset.ps3RecordKind==='item')openWs(active.id);else{active.trigger.dataset.ps3EditRecord=active.id;editProgressRecord(active.trigger)}}else mutateProgressRecord(row,'DELETE')}
  });
}
async function refreshBasketLinks(){const id=basketTargetId,epoch=detailEpoch;if(!id)return;if(!basketCurrent(id,epoch)){basketPending=true;return}const run=++basketRun;basketPending=false;let rows,error=false;try{rows=await readLinkRecords({kind:'project',targetIds:[id],noteKinds:LINK_NOTE_KINDS},rt)}catch{error=true}if(!basketCurrent(id,epoch)||run!==basketRun)return;detail.basketLinks=rows||detail.basketLinks;detail.basketError=error;paintRecords()}
// Repaints the record list in place unless a record is being edited or saved; the next detail render shows the rest.
function paintRecords(){const host=$('#ps3Body [data-ps3-records]');if(!host||!detail||recordMenu?.active||basketEditor?.hasDraft()||host.querySelector('[data-ps3-edit-record],[data-ps3-record][data-saving="1"]'))return;host.innerHTML=recordRows(detail);const badge=$('#ps3Body [data-ps3-record-count]');if(badge)badge.textContent=recordCount(detail)}
// On a phone the dialog's history entry is popped after it closes; navigate once that pop is done, or it would undo the move.
// UI-PC프로젝트좌우: from the projects screen the note remembers this project and its scroll (basket-note-tasks.js), so the
// note offers "← (project)으로 돌아가기" and back, the button or the 프로젝트 tab reopen it where it was (resumeProjects).
function openBasketNote(id,kind='basket'){const m=$('#ps3DetailModal'),tracked=m?.dataset.kptuHistoryOpen==='1',p=current,from=p&&areaOpen()?{view:'projects',id:p.id,name:p.name,scroll:detailScroll()}:null;if(!closeDetail())return;const back=tracked&&history.state?.kptuOverlay==='ps3DetailModal';const go=()=>{if(kind==='note'){if(from)requestNoteDocFrom(id,from,rt);else requestNoteDocOpen(id,rt)}else if(from)requestBasketNoteFrom(id,from,rt);else requestBasketNote(id,rt);window.KPTURouter?.go('basket',{source:'delegated'})};if(back)window.addEventListener('popstate',()=>queueMicrotask(go),{once:true});else go()}
// UI-모바일업데이트겹쳐보기: on a phone the tapped line comes up as a card over this detail (record-sheet.js) and the detail stays
// where it was; the card's [바구니에서 열기]/[노트 열기] and the PC (wide screen) keep the full open above (UI-PC프로젝트좌우).
function openBasketLine(link){const id=link.dataset.ps3BasketNote,kind=link.dataset.ps3NoteKind,b=detail?.basketLinks?.find(x=>x.id===link.closest('[data-basket-link]')?.dataset.basketLink),pid=current?.id,epoch=detailEpoch;
 if(b&&recordSheetWanted()){openRecordSheet({row:b,place:current?.name||'',trigger:link,onOpenFull:()=>{if(current?.id===pid&&detailEpoch===epoch)openBasketNote(id,kind)}});return}
 openBasketNote(id,kind)}
// One confirmation, one owner-RLS row delete, then 5 seconds to undo (basket-record-delete.js). The list is re-read by the shared event.
const basketActing=new Set();
// UI-연결요약수정: [요약 수정] opens the same editor as organization detail under the line. It saves through the same compare-and-set
// RPC (app_basket_update_link_summary), so only this link's summary changes and the note itself is never written.
function editBasketSummary(b){const id=current?.id,epoch=detailEpoch,body=$('#ps3Body');if(!id||!body||!basketCurrent(id,epoch)||basketActing.has(b.id))return;const key=id+':'+epoch;if(basketEditor&&basketEditorKey!==key){basketEditor.dispose();basketEditor=null}
 if(!basketEditor){basketEditorKey=key;basketEditor=mountLinkSummaryEditor(body,{getRecord:x=>detail?.basketLinks?.find(r=>r.id===x),getName:()=>current?.name||'',isCurrent:()=>basketCurrent(id,epoch),onUpdated:async row=>{if(!basketCurrent(id,epoch))return;basketRun++;detail.basketLinks=(detail.basketLinks||[]).map(old=>old.id===row.id?row:old);const el=$(`#ps3Body [data-basket-link="${CSS.escape(row.id)}"]`);if(el)el.outerHTML=basketRecord(row)}},rt)}
 basketEditor.edit(b.id)}
async function disconnectBasket(b){const id=current?.id,epoch=detailEpoch;if(!id||basketActing.has(b.id))return;if($(`#ps3Body [data-basket-link="${CSS.escape(b.id)}"] [data-link-summary-form]`)){toast('요약 수정을 먼저 저장하거나 취소해 주세요.');return}const button=()=>$(`#ps3Body [data-basket-link="${CSS.escape(b.id)}"] .ps3-rec-more`);basketActing.add(b.id);if(button())button().disabled=true;let result;try{result=await disconnectWithUndo(b,{name:current.name,rt,isCurrent:()=>basketCurrent(id,epoch)})}catch{result={status:'unknown',message:'결과를 확인하지 못했어요. 목록을 다시 불러와 실제 상태를 확인해 주세요.'}}finally{basketActing.delete(b.id)}if(!basketCurrent(id,epoch)||result.status==='stale')return;const row=$(`#ps3Body [data-basket-link="${CSS.escape(b.id)}"]`);if(['deleted','missing'].includes(result.status)){const at=row?[...row.parentElement.children].indexOf(row):0;detail.basketLinks=(detail.basketLinks||[]).filter(x=>x.id!==b.id);paintRecords();const rows=[...($('#ps3Body [data-ps3-records]')?.children||[])];rows[Math.min(at,rows.length-1)]?.querySelector?.('a,button')?.focus();return}if(button()){button().disabled=false;button().focus()}if(result.status!=='cancelled'&&result.message)toast(result.message)}

function editProgressRecord(button){
  if(!canEdit(current))return;
  const u=detail?.progress.find(x=>x.id===button.dataset.ps3EditRecord),row=button.closest('[data-ps3-record]');
  if(!u||!row||row.dataset.saving==='1')return;
  if(hasDoc(u)){void openProgressWindow(u);return}
  row.innerHTML=`<form class="ps3-pg-editor" data-enter-save data-ps3-edit-record="${esc(u.id)}" data-dirty="false"><input type="text" maxlength="500" aria-label="기록 요약" value="${esc(u.summary||'')}"><div class="ps3-pg-actions"><button type="button" class="ps3-text-btn" data-ps3-cancel-record>취소</button><button type="submit" class="ps3-text-btn">저장</button></div></form>`;
  const form=row.querySelector('form');configureSaveEditor({key:'record:'+u.id,kind:'record',form,targetId:u.id,projectId:current.id,workstreamId:u.workstream_id,source:u,button:form.querySelector('[type=submit]'),status:saveStatus(form),fields:[form.querySelector('input')]});row.querySelector('input').focus()
}
// ED③ 기록 (설계 11.4 순서 5): a project record that has a saved form is edited in the new big window (record-window.js): letters (summary,
// at most 500) and saved form in one PATCH. The row is read again first and a record changed on another device is refused; a row that had
// no saved form is also guarded by doc=is.null in the same write. A record without one keeps its one-line box above.
async function openProgressWindow(u){
  const p=current,epoch=projectEpoch;if(!p||!canEdit(p)||bigWindowOpen())return;
  let m;try{[m]=await Promise.all([import('./record-window.js'),window.KPTUViewLoader?.prepare?.('basket')])}catch{toast('큰 창을 열지 못했어요. 다시 눌러 주세요.');return}
  const same=()=>current?.id===p.id&&projectEpoch===epoch;if(!same()||bigWindowOpen())return;
  m.openRecordEditWindow({doc:hasDoc(u)?u.doc:null,text:u.summary||'',title:'큰 창에서 수정',aria:'기록 저장',limit:500,
    save:async({value,text})=>{
      if(!same())return {ok:false,message:'사업영역 화면이 바뀌어 저장하지 못했어요.'};
      if(!text.trim())return {ok:false,message:'내용을 입력해 주세요.'};
      try{
        const base=`/rest/v1/app_project_progress_updates?id=eq.${encodeURIComponent(u.id)}&project_id=eq.${encodeURIComponent(p.id)}`;
        const fresh=await api(`${base}&select=id,summary,doc`);
        if(!Array.isArray(fresh)||fresh.length!==1)throw new Error('권한이 없거나 이미 없는 기록입니다.');
        if(!sameRecord(fresh[0],u,'summary'))throw new Error('다른 곳에서 바뀐 기록이에요. 화면을 다시 불러온 뒤 고쳐 주세요.');
        const rows=await api(`${base}${hasDoc(u)?'':'&doc=is.null'}&select=*`,{method:'PATCH',body:recordPatch('summary',{text:text.trim(),value}),prefer:'return=representation'});
        if(!Array.isArray(rows)||rows.length!==1)throw new Error('기록이 그사이 바뀌었어요. 화면을 다시 불러온 뒤 고쳐 주세요.');
        if(same()){Object.assign(u,rows[0]);toast('기록을 고쳤습니다.');await refreshDetail().catch(()=>{})}
        return {ok:true}}
      catch(e){return {ok:false,message:e?.message||'기록을 고치지 못했어요. 다시 눌러 주세요.'}}}})}
function resetProgressRecord(row){if(!row?.isConnected)return;const id=row.dataset.ps3Record,item=row.dataset.ps3RecordKind==='item',source=item?detail?.workstreams.find(x=>x.id===id):detail?.progress.find(x=>x.id===id);if(source){row.dataset.saving='0';row.innerHTML=item?itemRecord(source):progressRecord(source)}}
async function mutateProgressRecord(row,method,summary){
  if(!canEdit(current)||!row||row.dataset.saving==='1')return;
  const id=row.dataset.ps3Record,item=row.dataset.ps3RecordKind==='item',u=item?detail?.workstreams.find(x=>x.id===id):detail?.progress.find(x=>x.id===id);if(!u)return;
  if(method==='DELETE'&&!confirm('이 기록을 삭제할까요?'))return;
  const projectId=current.id,epoch=projectEpoch;
  const active=()=>current?.id===projectId&&projectEpoch===epoch&&row.isConnected;
  row.dataset.saving='1';row.querySelectorAll('button,input').forEach(x=>x.disabled=true);
  try{
    const path=item?`/rest/v1/app_project_workstreams?id=eq.${encodeURIComponent(id)}&project_id=eq.${encodeURIComponent(projectId)}`:`/rest/v1/app_project_progress_updates?id=eq.${encodeURIComponent(id)}`;
    const result=await api(path,{method,prefer:'return=representation',...(method==='PATCH'?{body:{summary}}:{})});
    if(!Array.isArray(result)||result.length!==1||result[0]?.id!==id)throw new Error('no changed row');
    if(!active())return;
    if(method==='PATCH'){u.summary=summary;resetProgressRecord(row)}else{if(item)detail.workstreams=detail.workstreams.filter(x=>x.id!==id);else detail.progress=detail.progress.filter(x=>x.id!==id);row.remove()}
    await refreshDetail()
  }catch(e){if(active()){resetProgressRecord(row);toast(method==='PATCH'?'수정 실패':'삭제 실패')}}
}
async function saveProgressRecord(form){
  const e=saveEditors.get('record:'+form.dataset.ps3EditRecord);if(!e||e.form!==form||!saveEditorCurrent(e))return;const input=e.fields[0],summary=input.value.trim();if(!summary){input.focus();return}const r=beginProjectSave(e,{summary});if(!r)return;
  try{const result=await writeSaveBody(r);if(!result||!projectSaveCurrent(r)){if(sameSaveSession(e))r.attempt.needsReview=true;return}const u=detail.progress.find(x=>x.id===e.targetId),row=form.closest('[data-ps3-record]');if(u)u.summary=summary;forgetSave(r);if(JSON.stringify(readSaveDraft(e))===r.draft){form.dataset.dirty='false';resetProgressRecord(row)}else saveNotice(e,'제출한 기록은 저장했습니다. 추가 입력은 남겨 두었습니다.');await refreshDetail()}catch(error){failedSave(r,error);if(projectSaveCurrent(r))toast('수정 실패')}finally{finishProjectSave(r)}
}
function fold(id,title,n,body){return `<details class="ps3-section ps3-fold" id="${id}" data-ps3-panel="${id}"><summary><h3>${esc(title)} ${count(n)}</h3></summary><div class="ps3-fold-body">${body}</div></details>`}
function milestones(d){return fold('ps3-milestones',moduleTitle(d,'milestones','주요 일정'),d.milestones.length,`<div class="ps3-fold-actions"><button type="button" class="ps3-text-btn" data-ps3-add-milestone>+ 추가</button></div>${d.milestones.length?`<div class="ps3-list">${d.milestones.map(x=>`<div class="ps3-row"><div class="ps3-row-main"><div class="ps3-row-title"><b>${esc(x.title)}</b></div>${x.notes?`<p>${esc(x.notes)}</p>`:''}<small>${x.start_at?fmt(x.start_at):'일정 미정'} · ${esc(mstatus(x.status))}</small></div><button type="button" class="mini" data-ps3-edit-milestone="${x.id}">수정</button></div>`).join('')}</div>`:''}`)}
// Linked Google tasks (TASK-구현 PR 4). The count starts from the completion copy and google-tasks.js replaces it with Google's answer.
function tasksHtml(d){return `<section class="ps3-section" id="ps3-tasks"><div class="ps3-section-head"><h3>${esc(moduleTitle(d,'tasks','할 일'))} <span class="ps3-count" data-ps3-task-count>${d.openTasks}</span></h3><div class="ps3-section-actions"><button type="button" class="ps3-text-btn" data-ps3-gtask-link>기존 할 일 연결</button>${addPlus('할 일 추가','data-ps3-global="task"')}</div></div><div data-ps3-gtasks class="gt-linked gt-status">${waitHtml({rows:3})}</div></section>`}
function mountGoogleTasks(id){const box=$('#ps3Body [data-ps3-gtasks]'),g=window.KPTUGoogleTasks;if(!box)return;if(!g){box.textContent='Google 할 일 기능을 불러오지 못했습니다.';return}g.mountLinked(box,{project_id:id},{onCount:n=>{const c=$('#ps3-tasks [data-ps3-task-count]'),h=$('#ps3Summary [data-ps3-head-tasks]');if(c)c.textContent=n;if(h)h.textContent=n}})}
function docRow(x){const fa={name:x.file_name||x.title||'',mime:x.mime_type||'',documentId:x.file_id?x.id:'',driveId:x.file_id||'',driveUrl:x.drive_url||''},href=httpUrl(x.drive_url),main=`<b>${esc(x.title)}</b><small>${categoryTag(x.category)}${x.document_date?' '+esc(x.document_date):''}</small>`;return `<div class="ps3-line ps3-doc-row">${href?`<a class="ps3-line-main" href="${esc(href)}" target="_blank" rel="noopener noreferrer"${fileAttrs(fa,{press:true})}>${main}</a>`:`<div class="ps3-line-main">${main}</div>`}<details class="ps3-more ps3-line-more"><summary class="icon-btn" aria-label="자료 관리: ${esc(x.title)}"><span class="more-dots" aria-hidden="true">⋯</span></summary><div class="ps3-more-panel" role="group" aria-label="자료 관리">${menuItemsHtml(fa,{attrs:fileAttrs(fa),attr:'data-fa-menu'})}<button type="button" data-ps3-edit-doc="${esc(x.id)}">수정</button></div></details></div>`}
// UI-바구니첨부메모 ⑨⑩: 최근 5개 + "전체 N개 보기 ›"(자료실을 이 프로젝트로 걸러 연다).
// LIB-조직프로젝트자료종류: [자료] 위의 종류 칩은 자료실과 같은 칩 코드(category-chips.js). 꺼 둔 종류는 이 프로젝트를 열어 두는 동안만 기억하고(저장 안 함),
// 처음엔 모두 켜져 있어('회의' 포함, category-chips.js DETAIL_DEFAULT_OFF) 자료가 숨지 않는다. 거르는 건 줄 보이기뿐이라 위의 자료 수와 [전체 N개 보기]는 프로젝트 전체 자료 기준 그대로다.
let docOff=detailDefaultOff(),docOffFor='';
function docOffSet(d){if(docOffFor!==d.p.id){docOffFor=d.p.id;docOff=detailDefaultOff()}return docOff}
function docListHtml(d){const off=docOffSet(d),rows=d.docs.filter(x=>!off.has(categoryOf(x.category))).slice(0,5);return d.docs.length?(rows.length?`<div class="ps3-lines">${rows.map(docRow).join('')}</div>`:emptyHtml('고른 종류 없음',{attrs:'data-ps3-doc-nokind'})):''}
function docsHtml(d){return `<section class="ps3-section" id="ps3-documents"><div class="ps3-section-head"><h3>${esc(moduleTitle(d,'documents','자료'))} ${count(d.docs.length)}</h3><div class="ps3-section-actions">${addPlus('자료 올리기','data-ps3-global="document"')}</div></div><div id="ps3DocKinds" class="doc-kind-chips"${d.docs.length?'':' hidden'}></div><div data-ps3-doc-list>${docListHtml(d)}</div>${d.docs.length?`<button type="button" class="ps3-text-btn ps3-docs-all" data-ps3-library>전체 ${d.docs.length}개 보기 <span aria-hidden="true">›</span></button>`:''}</section>`}
// 종류 칩을 그리고 누르면 줄 목록만 다시 그린다(칩 단추는 그대로라 초점·터치가 유지됨).
function mountDocKinds(d){
  const host=$('#ps3-documents #ps3DocKinds');if(!host||d!==detail||!d.docs.length)return;
  renderCategoryChips(host,{names:documentCategories(),off:docOffSet(d),label:'자료 종류 (여러 개 고르기)',controls:'ps3-documents',key:'docKind',onToggle:value=>{
    if(d!==detail)return;docOff=toggleCategoryOff(documentCategories(),docOffSet(d),value);
    const list=$('#ps3-documents [data-ps3-doc-list]');if(list)list.innerHTML=docListHtml(d);mountDocKinds(d)}});
}
// PRJ-회의표시 → MTG-사업보고 6단계: 이 프로젝트에 연결된 사업 보고(회의·정책·교섭 …, 모든 종류)를 최근 순으로. 연결은 연결 표의 '출처 회의' 줄(report-links.js)이라
// 사업 보고 쪽에서 연결해도, 여기서 [연결]로 골라도 같은 줄이다. 이미 연결돼 있던 회의는 그대로 '회의' 종류로 나온다. 하위 프로젝트 것은 넣지 않는다.
// 줄은 [종류] 이름·차수·날짜, 누르면 사업 보고 결과 창이 이 화면 위에 열린다. 최근 5개 + 나머지는 접어 둔다. ⋯ → [연결 해제](5초 안에 되돌리기).
function meetingRow(m,photos){const strip=reportPhotosHtml(m.id,photos);return `<div class="ps3-line ps3-meeting-row"><button type="button" class="ps3-line-main${strip?' has-report-photos':''}" data-ps3-meeting="${esc(m.id)}"><b><span class="report-kind-tag" data-report-kind-tag>${esc(reportKindTag(m))}</span>${esc(reportTitle(m))}</b><small>${m.meeting_at?esc(date(m.meeting_at)):''}</small>${m.linkSummary?`<small class="report-link-summary-line" data-report-link-summary>${esc(m.linkSummary)}</small>`:''}${strip}</button><details class="ps3-more ps3-line-more"><summary class="icon-btn" aria-label="사업 보고 관리: ${esc(reportTitle(m))}"><span class="more-dots" aria-hidden="true">⋯</span></summary><div class="ps3-more-panel" role="group" aria-label="사업 보고 관리"><button type="button" data-ps3-report-unlink="${esc(m.id)}">연결 해제</button></div></details></div>`}
function meetingsHtml(d){const rows=d.meetings||[],first=rows.slice(0,5),rest=rows.slice(5);return `<section class="ps3-section" id="ps3-meetings"><div class="ps3-section-head"><h3>사업 보고 ${count(rows.length)}</h3><div class="ps3-section-actions"><button type="button" class="ps3-text-btn" data-ps3-report-link>연결</button>${addPlus('사업 보고 추가','data-ps3-global="meeting"')}</div></div>${first.length?`<div class="ps3-lines">${first.map(m=>meetingRow(m,d.reportPhotos)).join('')}</div>`:''}${rest.length?`<details class="ps3-meetings-more"><summary class="ps3-text-btn">나머지 ${rest.length}개 보기</summary><div class="ps3-lines">${rest.map(m=>meetingRow(m,d.reportPhotos)).join('')}</div></details>`:''}</section>`}
async function openMeetingRound(id){
  try{await window.KPTUViewLoader?.prepare?.('meetings');await import('./meeting-round-detail.js');if(!(await window.__KPTU_MEETING_ROUND_DETAIL_READY__))throw new Error('meeting detail unavailable');await window.KPTUMeetingRoundDetail.open(id)}
  catch(e){console.error('project meeting open',e);toast('사업 보고를 열지 못했습니다.')}
}
// 분류 목록이 바뀌면(내 목록을 읽어 옴·이름 바꾸기·삭제) 열려 있는 [자료] 묶음의 분류 꼬리표만 다시 그린다.
window.addEventListener('kptu:document-categories-changed',()=>{const box=$('#ps3-documents');if(box&&detail?.docs){box.outerHTML=docsHtml(detail);mountDocKinds(detail)}});
function decisions(d){const all=[...d.decisions.map(x=>({kind:'결정',title:x.title,body:x.body,at:x.decided_at})),...d.meetings.map(x=>({kind:'회의',title:x.title,body:x.decisions||x.notes||'',at:x.meeting_at}))].sort((a,b)=>new Date(b.at)-new Date(a.at));return `<section class="ps3-section" id="ps3-decisions"><div class="ps3-section-head"><div><h3>${esc(moduleTitle(d,'decisions','회의·결정'))}</h3><p>회의 결과와 중요한 결정사항을 함께 봅니다.</p></div><button class="mini" data-ps3-global="meeting">+ 회의</button></div><div class="ps3-list">${all.length?all.map(x=>`<div class="ps3-row"><div class="ps3-row-main"><b><span class="ps3-phase">${x.kind}</span> ${esc(x.title)}</b><p>${esc(x.body||'')}</p><small>${x.kind==='회의'?formatMeetingTime(x.at):fmt(x.at)}</small></div></div>`).join(''):empty()}</div></section>`}
// UI-프로젝트화면정리: the folded '메모' box is gone (notes live in the basket's [노트]); the stored project comments
// (app_project_comments) are kept as they are and only no longer shown here.
function pagesHtml(d){
  const activePages=d.pages.filter(x=>!x.metadata?.web1_trial_import);
  const bySource=new Map(activePages.filter(x=>x.metadata?.web1_source_id).map(x=>[x.metadata.web1_source_id,x]));
  const children=new Map();
  const roots=[];
  for(const page of activePages){
    const parent=bySource.get(page.metadata?.web1_parent_source_id);
    if(parent&&parent.id!==page.id){
      if(!children.has(parent.id))children.set(parent.id,[]);
      children.get(parent.id).push(page);
    }else roots.push(page);
  }
  const shown=new Set();
  const row=(page,depth=0)=>{
    if(shown.has(page.id))return '';
    shown.add(page.id);
    const child=depth>0;
    return `<div class="ps3-row ps3-page-row${child?' ps3-page-child':''}"><div class="ps3-row-main"><b>${child?'↳ ':''}${esc(page.title)}</b><p>${esc(page.summary||'')}</p><small>${esc(page.status||'')} · ${fmt(page.updated_at)}</small></div><div class="ps3-page-actions"><a class="mini" data-ps3-page-view href="./?view=pages&amp;page=${encodeURIComponent(page.id)}">내부 보기</a></div></div>${(children.get(page.id)||[]).map(x=>row(x,depth+1)).join('')}`;
  };
  const content=roots.map(x=>row(x)).join('')+activePages.filter(x=>!shown.has(x.id)).map(x=>row(x)).join('');
  return `<section class="ps3-section" id="ps3-pages"><div class="ps3-section-head"><div><h3>기존 연결 게시글</h3><p>사업 내용은 사업영역의 콘텐츠와 하위페이지에서 관리합니다.</p></div></div><div class="ps3-list">${content||empty()}</div></section>`;
}
function collab(d){return `<section class="ps3-section" id="ps3-collaboration"><div class="ps3-section-head"><div><h3>${esc(moduleTitle(d,'collaboration','협업'))}</h3><p>사업영역 관련 의견과 검토 메모입니다.</p></div></div><div class="ps3-list">${d.comments.length?d.comments.map(x=>`<div class="ps3-row"><div class="ps3-row-main"><b>${esc(nameOf(x.author_id))}</b><p>${esc(x.body)}</p><small>${fmt(x.created_at)}</small></div></div>`).join(''):empty()}</div><div class="ps3-comment-form" data-enter-save><input id="ps3CommentBody" placeholder="의견·검토 메모"><button class="secondary" data-ps3-comment data-enter-save-submit>등록</button></div></section>`}
const ordered=rows=>[...rows].sort((a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0)||String(a.created_at||a.id).localeCompare(String(b.created_at||b.id)));
function blockBody(b){const c=b.content||{};if(b.block_type==='text')return `<p>${esc(c.text||'')}</p>`;
  if(b.block_type==='table')return `<div class="ps3-content-table-wrap"><table><thead><tr>${(c.columns||[]).map(x=>`<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${(c.rows||[]).map(row=>`<tr>${row.map(x=>`<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  if(b.block_type==='timeline')return `<ul>${(c.items||[]).map(x=>`<li><b>${esc(x.date)}</b> ${esc(x.title)}${x.body?`<span> · ${esc(x.body)}</span>`:''}</li>`).join('')}</ul>`;
  if(b.block_type==='links')return `<ul>${(c.items||[]).map(x=>{let url='';try{const u=new URL(x.url);if(['https:','http:'].includes(u.protocol))url=u.href}catch{}return `<li>${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(x.label||url)}</a>`:esc(x.label||'링크')}${x.note?` · ${esc(x.note)}`:''}</li>`}).join('')}</ul>`;
  return `<dl>${(c.items||[]).map(x=>`<div><dt>${esc(x.label)}</dt><dd>${esc(x.value)}${x.note?` <small>${esc(x.note)}</small>`:''}</dd></div>`).join('')}</dl>`}
function contentHtml(d){const edit=canEdit(d.p),sections=ordered(d.sections);return `<section class="ps3-section ps3-content" id="ps3-content"><div class="ps3-section-head"><div><h3>사업 콘텐츠·현황</h3><p>사업영역의 비공개 원본 내용입니다.</p></div>${edit?'<button class="mini" data-ps3-add-section>+ 섹션</button>':''}</div>${sections.map((s,si)=>{const blocks=ordered(d.blocks.filter(x=>x.section_id===s.id));return `<div class="ps3-content-section" data-ps3-section="${esc(s.id)}"><div class="ps3-content-heading"><h4>${esc(s.title)}</h4>${edit?`<div class="ps3-content-actions"><button class="mini" data-ps3-edit-section="${esc(s.id)}">이름 수정</button><button class="mini" data-ps3-section-up="${esc(s.id)}" ${si?'':'disabled'} aria-label="${esc(s.title)} 섹션 위로">↑</button><button class="mini" data-ps3-section-down="${esc(s.id)}" ${si<sections.length-1?'':'disabled'} aria-label="${esc(s.title)} 섹션 아래로">↓</button><button class="mini" data-ps3-add-block="${esc(s.id)}">+ 내용</button></div>`:''}</div>${blocks.map((b,bi)=>`<article class="ps3-content-block" data-ps3-block="${esc(b.id)}"><div class="ps3-content-heading"><div><small>${esc(CONTENT_TYPES[b.block_type]||'내용')} · 비공개</small><h5>${esc(b.title||'제목 없음')}</h5></div>${edit?`<div class="ps3-content-actions"><button class="mini" data-ps3-edit-block="${esc(b.id)}">수정</button><button class="mini" data-ps3-block-up="${esc(b.id)}" ${bi?'':'disabled'} aria-label="${esc(b.title)} 위로">↑</button><button class="mini" data-ps3-block-down="${esc(b.id)}" ${bi<blocks.length-1?'':'disabled'} aria-label="${esc(b.title)} 아래로">↓</button></div>`:''}</div><div class="ps3-content-body">${blockBody(b)}</div></article>`).join('')||empty()}</div>`}).join('')||empty()}</section>`}
function blockFields(b){const c=b.content||{};if(b.block_type==='text')return `<label>내용<textarea data-ps3-block-text rows="7">${esc(c.text||'')}</textarea></label>`;
  if(b.block_type==='table')return `<div class="ps3-content-fields"><b>열 이름</b>${(c.columns||[]).map((v,j)=>`<label>열 ${j+1}<input data-ps3-cell="column" data-index="${j}" value="${esc(v)}"></label>`).join('')}<b>행</b>${(c.rows||[]).map((r,i)=>`<div class="ps3-content-field-row">${r.map((v,j)=>`<label>${esc(c.columns?.[j]||`열 ${j+1}`)}<input data-ps3-cell="row" data-index="${i}" data-column="${j}" value="${esc(v)}"></label>`).join('')}</div>`).join('')}<button type="button" class="mini" data-ps3-add-item>+ 행</button></div>`;
  const fields=b.block_type==='timeline'?['date','title','body']:b.block_type==='links'?['label','url','note']:['label','value','note'];return `<div class="ps3-content-fields">${(c.items||[]).map((item,i)=>`<div class="ps3-content-field-row">${fields.map(key=>`<label>${esc({date:'날짜',title:'제목',body:'설명',label:'항목',url:'URL',value:'내용',note:'비고'}[key])}<input data-ps3-item="${key}" data-index="${i}" value="${esc(item[key]||'')}"></label>`).join('')}</div>`).join('')}<button type="button" class="mini" data-ps3-add-item>+ 항목</button></div>`}
function editBlock(id){if(!canEdit(current))return;const b=detail.blocks.find(x=>x.id===id),node=$(`[data-ps3-block="${id}"]`);if(!b||!node)return;node.querySelector('.ps3-content-body').innerHTML=`<form class="ps3-content-editor" data-enter-save data-ps3-editing="${esc(id)}"><label>제목<input data-ps3-block-title value="${esc(b.title||'')}"></label>${blockFields(b)}<div class="ps3-content-actions"><span class="ps3-save-state" data-ps3-block-state role="status"></span><button type="button" class="mini" data-ps3-cancel-block>취소</button><button type="submit" class="primary mini" data-ps3-save-block>저장</button></div></form>`;node.querySelector('[data-ps3-block-title]')?.focus()}
function readBlockContent(b,form){const content=structuredClone(form._draftContent||b.content||{});if(b.block_type==='text'){content.text=form.querySelector('[data-ps3-block-text]').value;return content}if(b.block_type==='table'){content.columns=[...(content.columns||[])];content.rows=(content.rows||[]).map(row=>[...row]);form.querySelectorAll('[data-ps3-cell]').forEach(input=>{if(input.dataset.ps3Cell==='column')content.columns[Number(input.dataset.index)]=input.value;else content.rows[Number(input.dataset.index)][Number(input.dataset.column)]=input.value});return content}content.items=(content.items||[]).map(x=>({...x}));form.querySelectorAll('[data-ps3-item]').forEach(input=>{content.items[Number(input.dataset.index)][input.dataset.ps3Item]=input.value});return content}
async function saveBlock(form){
  if(!canEdit(current))return;
  const id=form.dataset.ps3Editing,b=detail.blocks.find(x=>x.id===id),state=form.querySelector('[data-ps3-block-state]'),button=form.querySelector('[data-ps3-save-block]');
  if(!b)return;
  state.textContent='저장 중…';button.disabled=true;
  try{
    const body={title:form.querySelector('[data-ps3-block-title]').value.trim()||null,content:readBlockContent(b,form),updated_at:new Date().toISOString()};
    await api(`/rest/v1/app_project_blocks?id=eq.${encodeURIComponent(id)}&project_id=eq.${encodeURIComponent(current.id)}`,{method:'PATCH',body});
    state.textContent='저장 완료';form.dataset.dirty='false';
    Object.assign(b,body);
    const node=form.closest('[data-ps3-block]');
    if(node){node.querySelector('h5').textContent=b.title||'제목 없음';node.querySelector('.ps3-content-body').innerHTML=blockBody(b)}
    await refreshDetail({preserveOpenEditors:true});
  }catch(e){if(form.isConnected){state.textContent=`저장 실패: ${e.message||e}`;button.disabled=false}else toast('저장 후 화면 갱신에 실패했습니다.')}
}
async function moveContent(kind,id,direction){if(!canEdit(current))return;const projectId=current.id,section=kind==='section',rows=ordered(section?detail.sections:detail.blocks.filter(x=>x.section_id===detail.blocks.find(y=>y.id===id)?.section_id)),index=rows.findIndex(x=>x.id===id),other=rows[index+direction];if(index<0||!other)return;const path=section?'app_project_sections':'app_project_blocks',a=rows[index];try{await api(`/rest/v1/${path}?id=eq.${encodeURIComponent(a.id)}&project_id=eq.${encodeURIComponent(projectId)}`,{method:'PATCH',body:{sort_order:other.sort_order}});await api(`/rest/v1/${path}?id=eq.${encodeURIComponent(other.id)}&project_id=eq.${encodeURIComponent(projectId)}`,{method:'PATCH',body:{sort_order:a.sort_order}});if(current?.id===projectId)await refreshDetail()}catch(e){toast('순서 저장 실패: 다시 확인해 주세요.');if(current?.id===projectId)await refreshDetail()}}
function addSection(){if(!canEdit(current))return;const head=$('#ps3-content .ps3-section-head');if(!head)return;head.insertAdjacentHTML('afterend','<form class="ps3-content-editor ps3-new-form" data-ps3-new-section><label>섹션 이름<input required maxlength="160"></label><div class="ps3-content-actions"><span data-ps3-form-state role="status"></span><button class="mini" type="button" data-ps3-cancel-new>취소</button><button class="primary mini" type="submit">섹션 저장</button></div></form>');head.nextElementSibling.querySelector('input')?.focus()}
async function saveNewSection(form){if(form.dataset.saving==='1'||!canEdit(current))return;const title=form.querySelector('input').value.trim(),state=form.querySelector('[data-ps3-form-state]');if(!title){state.textContent='이름을 입력해 주세요.';return}const button=form.querySelector('[type="submit"]');form.dataset.saving='1';button.disabled=true;state.textContent='저장 중…';try{await api('/rest/v1/app_project_sections',{method:'POST',body:{project_id:current.id,title,sort_order:Math.max(0,...detail.sections.map(x=>Number(x.sort_order)||0))+10,created_by:user.id,collapsed_default:false}});form.dataset.dirty='false';await refreshDetail()}catch(e){state.textContent=`저장 실패: ${e.message||e}`}finally{form.dataset.saving='0';button.disabled=false}}
async function renameSection(id){if(!canEdit(current))return;const s=detail.sections.find(x=>x.id===id);if(!s)return;const title=prompt('섹션 이름',s.title);if(!title?.trim()||title.trim()===s.title)return;try{await api(`/rest/v1/app_project_sections?id=eq.${encodeURIComponent(id)}&project_id=eq.${encodeURIComponent(current.id)}`,{method:'PATCH',body:{title:title.trim()}});await refreshDetail()}catch(e){toast('섹션 이름을 저장하지 못했습니다.')}}
const newBlockContent=type=>type==='text'?{text:''}:type==='table'?{columns:['항목','내용'],rows:[['','']]}:{items:[type==='timeline'?{date:'',title:'',body:''}:type==='links'?{label:'',url:'',note:''}:{label:'',value:'',note:''}]};
function addBlock(sectionId){if(!canEdit(current)||!detail.sections.some(x=>x.id===sectionId))return;const section=$(`[data-ps3-section="${sectionId}"]`),form=document.createElement('form');form.className='ps3-content-editor ps3-new-form';form.dataset.enterSave='';form.dataset.ps3NewBlock=sectionId;form._newBlock={block_type:'text',content:newBlockContent('text')};form.innerHTML=newBlockForm(form._newBlock);section.querySelector('.ps3-content-heading').insertAdjacentElement('afterend',form);form.querySelector('[data-ps3-block-title]')?.focus()}
function newBlockForm(b,title=''){return `<label>내용 종류<select data-ps3-new-type>${Object.entries(CONTENT_TYPES).map(([key,label])=>`<option value="${key}" ${b.block_type===key?'selected':''}>${label}</option>`).join('')}</select></label><label>제목<input data-ps3-block-title required maxlength="160" value="${esc(title)}"></label>${blockFields(b)}<div class="ps3-content-actions"><span data-ps3-form-state role="status"></span><button type="button" class="mini" data-ps3-cancel-new>취소</button><button type="submit" class="primary mini">내용 저장</button></div>`}
async function saveNewBlock(form){if(form.dataset.saving==='1'||!canEdit(current))return;const b=form._newBlock,title=form.querySelector('[data-ps3-block-title]').value.trim(),state=form.querySelector('[data-ps3-form-state]');if(!title){state.textContent='제목을 입력해 주세요.';return}const content=readBlockContent(b,form);if(b.block_type==='text'&&!content.text.trim()){state.textContent='내용을 입력해 주세요.';return}const button=form.querySelector('[type="submit"]');form.dataset.saving='1';button.disabled=true;state.textContent='저장 중…';try{await api('/rest/v1/app_project_blocks',{method:'POST',body:{project_id:current.id,section_id:form.dataset.ps3NewBlock,block_type:b.block_type,title,content,sort_order:Math.max(0,...detail.blocks.filter(x=>x.section_id===form.dataset.ps3NewBlock).map(x=>Number(x.sort_order)||0))+10,created_by:user.id}});form.dataset.dirty='false';await refreshDetail()}catch(e){state.textContent=`저장 실패: ${e.message||e}`}finally{form.dataset.saving='0';button.disabled=false}}
function addBlockItem(form){const id=form.dataset.ps3Editing,b=form._newBlock||detail.blocks.find(x=>x.id===id);if(!b)return;const content=readBlockContent(b,form);if(b.block_type==='table')content.rows.push(content.columns.map(() => ''));else content.items.push(b.block_type==='timeline'?{date:'',title:'',body:''}:b.block_type==='links'?{label:'',url:'',note:''}:{label:'',value:'',note:''});const draft={...b,content},title=form.querySelector('[data-ps3-block-title]').value;form._draftContent=content;form.dataset.dirty='true';if(form._newBlock){form._newBlock=draft;form.innerHTML=newBlockForm(draft,title)}else form.innerHTML=`<label>제목<input data-ps3-block-title value="${esc(title)}"></label>${blockFields(draft)}<div class="ps3-content-actions"><span class="ps3-save-state" data-ps3-block-state role="status"></span><button type="button" class="mini" data-ps3-cancel-block>취소</button><button type="submit" class="primary mini" data-ps3-save-block>저장</button></div>`;form.querySelector('[data-ps3-add-item]')?.scrollIntoView({block:'nearest'})}
// PRJ-순서바꾸기: the owner reorders projects among their siblings (same parent; the parent changes only in 수정). PC: drag a row of
// the list onto another row of the same level (before or after it). Phone: the list's [순서 바꾸기] mode (↑ ↓ on each row; the detail ⋯ menu has no move buttons). Both save
// app_spaces.sort_order through the owner's PATCH path (siblings renumbered 10, 20, …; project-order.mjs). parent_id is never
// written, so the 3단 trigger is not involved. The catalog then shows the new order everywhere (project-catalog.js).
let reordering=false,dragId=null,orderMode=false;
// 순서 바꾸기는 같은 칸(접힌 쪽끼리 / 펼친 쪽끼리) 형제끼리만 한다.
const groupSiblings=p=>{const f=foldedSet(projects);return catalog.siblings(projects,p).filter(x=>f.has(x.id)===f.has(p.id))};
const dragReady=p=>!!PC?.matches&&canManage(p)&&groupSiblings(p).length>1;
// 폰 순서 바꾸기: the list head's small button turns the list into 순서 바꾸는 중 (↑ ↓ on each row, the row itself does not open the
// detail); the same button reads 완료 and returns the list. The phone only: the PC list orders by drag.
const orderAvailable=()=>!PC?.matches&&listedProjects().some(p=>canManage(p)&&groupSiblings(p).length>1);
function orderToggle(){const b=document.createElement('button');b.type='button';b.id='ps3OrderBtn';b.className='ps3-order-toggle';b.setAttribute('aria-pressed',String(orderMode));b.textContent=orderMode?'완료':'순서 바꾸기';return b}
function orderButtons(p){const row=groupSiblings(p),i=row.findIndex(x=>x.id===p.id);if(!canManage(p)||row.length<2||i<0)return '';const b=(step,ch,word,off)=>`<button type="button" class="ps3-order-move" data-ps3-order-move="${step}" data-ps3-order-id="${esc(p.id)}" aria-label="${esc(p.name)} ${word}"${off?' disabled':''}>${ch}</button>`;return b(-1,'↑','위로',i===0)+b(1,'↓','아래로',i===row.length-1)}
function setOrderMode(on){on=!!on&&!PC?.matches;if(orderMode===on)return;orderMode=on;if($('#projectGrid'))void renderGrid()}
async function moveProject(id,step){const p=projects.find(x=>x.id===id),group=p?groupSiblings(p):[],i=group.findIndex(x=>x.id===id),next=group[i+step];if(i<0||!step||!next)return;await reorderProject(id,catalog.siblings(projects,p).findIndex(x=>x.id===next.id),{step})}
async function reorderProject(id,to,{step=0}={}){
 const p=projects.find(x=>x.id===id);if(reordering||!p||!canManage(p))return;
 const plan=catalog.reorderPlan(projects,id,to);if(!plan.length)return;
 reordering=true;const epoch=projectEpoch,owner=user.id;let saved=false;
 try{for(const w of plan)await api(`/rest/v1/app_spaces?id=eq.${encodeURIComponent(w.id)}&owner_id=eq.${encodeURIComponent(owner)}`,{method:'PATCH',body:{sort_order:w.sort_order}});saved=true}
 catch(e){console.error('project reorder failed',e);if(epoch===projectEpoch)toast('순서를 저장하지 못했어요. 다시 해 주세요.')}
 finally{reordering=false}
 if(epoch!==projectEpoch)return;
 await renderGrid();if(epoch!==projectEpoch)return;
 // The open detail's 하위 프로젝트 list follows the new order too (as after 완료).
 if(current)await refreshDetail();if(epoch!==projectEpoch)return;
 // 순서 바꾸기: the moved row keeps the focus on the same arrow (the other one when it just switched off) for the next step.
 if(step&&orderMode){const line=document.querySelector(`#projectGrid [data-ps3-order-row="${CSS.escape(id)}"]`);(line?.querySelector(`[data-ps3-order-move="${step}"]:not([disabled])`)||line?.querySelector('[data-ps3-order-move]:not([disabled])'))?.focus()}
 if(saved)toast('순서를 바꿨어요.')
}
function clearDropMarks(){document.querySelectorAll('#projectGrid .ps3-plist .ps3-drop-before,#projectGrid .ps3-plist .ps3-drop-after,#projectGrid .ps3-plist .ps3-dragging').forEach(x=>x.classList.remove('ps3-drop-before','ps3-drop-after','ps3-dragging'))}
// The row under the pointer when it is a sibling of the dragged project, and whether the drop goes after it.
function dropTarget(e){const el=e.target.closest?.('#projectGrid .ps3-plist [data-ps3-project]');if(!el||!dragId||el.dataset.ps3Project===dragId)return null;const p=projects.find(x=>x.id===dragId);if(!groupSiblings(p).some(x=>x.id===el.dataset.ps3Project))return null;const r=el.getBoundingClientRect();return {el,id:el.dataset.ps3Project,after:e.clientY>r.top+r.height/2}}
function bindReorderDrag(){
 document.addEventListener('click',e=>{const t=e.target.closest?.('#ps3OrderBtn');if(t){e.preventDefault();setOrderMode(!orderMode);return}const m=e.target.closest?.('#projectGrid [data-ps3-order-move]');if(m){e.preventDefault();void moveProject(m.dataset.ps3OrderId,Number(m.dataset.ps3OrderMove))}});
 document.addEventListener('dragstart',e=>{const el=e.target.closest?.('#projectGrid .ps3-plist [data-ps3-project][draggable="true"]');if(!el)return;dragId=el.dataset.ps3Project;el.classList.add('ps3-dragging');try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',dragId)}catch{}});
 document.addEventListener('dragover',e=>{if(!dragId)return;const t=dropTarget(e);document.querySelectorAll('#projectGrid .ps3-plist .ps3-drop-before,#projectGrid .ps3-plist .ps3-drop-after').forEach(x=>{if(x!==t?.el)x.classList.remove('ps3-drop-before','ps3-drop-after')});if(!t)return;e.preventDefault();try{e.dataTransfer.dropEffect='move'}catch{}t.el.classList.toggle('ps3-drop-after',t.after);t.el.classList.toggle('ps3-drop-before',!t.after)});
 document.addEventListener('drop',e=>{if(!dragId)return;const t=dropTarget(e),id=dragId;dragId=null;clearDropMarks();if(!t)return;e.preventDefault();const p=projects.find(x=>x.id===id),rest=catalog.siblings(projects,p).filter(x=>x.id!==id),at=rest.findIndex(x=>x.id===t.id);if(at<0)return;void reorderProject(id,at+(t.after?1:0))});
 document.addEventListener('dragend',()=>{dragId=null;clearDropMarks()});
}
// PRJ-목록접어두기: 접기·다시 위로. 상위가 접혀 함께 접힌 하위는 스스로 접은 것이 아니므로 상위에서 다시 올린다.
const foldMenuItem=p=>isFoldedOwn(p)?'<button type="button" data-ps3-fold-project="unfold">다시 위로</button>':foldedSet(projects).has(p.id)?'':'<button type="button" data-ps3-fold-project="fold">아래로 접기</button>';
async function setFold(id,on){
 const p=projects.find(x=>x.id===id);if(!p||!canManage(p)||foldBusy||isFoldedOwn(p)===on)return;
 foldBusy=true;const epoch=projectEpoch,owner=user.id;let saved=false;
 try{await api(`/rest/v1/app_spaces?id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(owner)}`,{method:'PATCH',body:{metadata:foldedMetadata(p.metadata,on)}});saved=true}
 catch(e){console.error('project fold failed',e);if(epoch===projectEpoch)toast('저장하지 못했어요. 다시 해 주세요.')}
 finally{foldBusy=false}
 if(!saved||epoch!==projectEpoch)return;
 await loadProjects(epoch);if(epoch!==projectEpoch)return;
 await renderGrid();if(epoch!==projectEpoch)return;
 if(current)await refreshDetail();
 toast(on?'아래로 접었어요.':'다시 위로 올렸어요.')
}
// 목록 줄 메뉴: 폰은 길게 누르기, PC는 우클릭. 길게 누르는 동안 12px 넘게 움직이면(좌우 스와이프 탭 이동) 취소한다.
let foldMenu=null,pressTimer=0,pressStart=null,menuAt=0;
function foldMenuTrigger(e){return e.target.closest?.('#projectGrid .ps3-plist [data-ps3-project]')}
function foldMenuHtml(id){
 const p=projects.find(x=>x.id===id);if(!p||!canManage(p))return '';
 const item=isFoldedOwn(p)?'<button type="button" data-ps3-fold-action="unfold">다시 위로</button>':foldedSet(projects).has(id)?'':'<button type="button" data-ps3-fold-action="fold">아래로 접기</button>';
 return item+(orderAvailable()?'<button type="button" data-ps3-fold-action="order">순서 바꾸기</button>':'')
}
function bindFoldMenu(){
 foldMenu=createAnchoredMenu({id:'ps3FoldMenu',className:'ps3-record-menu ps3-fold-menu',label:'사업영역 줄 메뉴',historyKey:'kptuFoldMenu',key:t=>t.dataset.ps3Project,canOpen:t=>!!foldMenuHtml(t.dataset.ps3Project),
  render:foldMenuHtml,
  onAction:(button,active)=>{const a=button.dataset.ps3FoldAction;if(a==='order')setOrderMode(true);else void setFold(active.id,a==='fold')}});
 const cancel=()=>{clearTimeout(pressTimer);pressTimer=0;pressStart=null};
 const open=(t,touch=false)=>{if(touch)menuAt=Date.now();foldMenu.open(t)};
 document.addEventListener('contextmenu',e=>{const t=foldMenuTrigger(e);if(!t)return;e.preventDefault();cancel();if(!foldMenu.active&&Date.now()-menuAt>600)open(t)});
 document.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'||e.button>0)return;const t=foldMenuTrigger(e);if(!t)return;cancel();pressStart={x:e.clientX,y:e.clientY};pressTimer=setTimeout(()=>{pressTimer=0;pressStart=null;open(t,true)},500)},true);
 document.addEventListener('pointermove',e=>{if(!pressStart)return;const slop=12;if(Math.abs(e.clientX-pressStart.x)>slop||Math.abs(e.clientY-pressStart.y)>slop)cancel()},true);
 for(const type of ['pointerup','pointercancel','scroll'])document.addEventListener(type,cancel,true);
 // 길게 눌러 메뉴가 열린 직후 손을 뗄 때의 눌림은 프로젝트를 여는 누름이 아니다.
 document.addEventListener('click',e=>{if(Date.now()-menuAt<700&&foldMenuTrigger(e)){e.preventDefault();e.stopImmediatePropagation()}},true);
 document.addEventListener('toggle',e=>{if(e.target?.matches?.('details[data-ps3-fold]'))foldOpen=e.target.open},true);
 document.addEventListener('click',e=>{const b=e.target.closest?.('[data-ps3-fold-project]');if(!b||!current)return;e.preventDefault();b.closest('details')?.removeAttribute('open');void setFold(current.id,b.dataset.ps3FoldProject==='fold')})
}
function moreMenu(p){return `<details class="ps3-more"><summary class="icon-btn" data-ctx="area" aria-label="사업영역 관리 메뉴"><span class="more-dots" aria-hidden="true">⋯</span></summary><div class="ps3-more-panel" role="group" aria-label="사업영역 관리"><button type="button" data-ps3-toggle-done>${p.status==='done'?'완료 취소':'완료'}</button><button type="button" data-ps3-edit-project>수정</button>${foldMenuItem(p)}<button type="button" data-ps3-archive-project>보관</button><button type="button" class="ps3-danger" data-ps3-delete-project>삭제</button></div></details>`}
function renderDetail(d){if(!d||d!==detail||d.p.id!==current?.id||d.p.id!==basketTargetId)return;if(recordMenu?.active){const epoch=detailEpoch;closeRecordMenu(()=>{if(epoch===detailEpoch)renderDetail(d)});return}listCounts[d.p.id]={...listCounts[d.p.id],progress:d.progress[0]?.effective_on||null,last:[d.progress[0]?.effective_on,...(d.basketLinks||[]).map(b=>keyOf(b.occurred_at))].filter(v=>/^\d{4}-\d{2}-\d{2}/.test(v||'')).map(v=>v.slice(0,10)).sort().pop()||null,milestone:d.milestones.find(m=>m.start_at>=new Date(ranges().start).toISOString()&&!['done','completed','cancelled','canceled'].includes(m.status))?.start_at||null};paintSummaries();const p=d.p,up=ancestors(p),ch=up.length<MAX_DEPTH?kids(p):[],manageable=canManage(p),body=$('#ps3Body');const keep=body.dataset.project===p.id?[...body.querySelectorAll('details[data-ps3-panel][open]')].map(x=>x.dataset.ps3Panel):[];$('#ps3Hierarchy').innerHTML=up.map((x,i)=>`${i?'<span class="ps3-hier-sep" aria-hidden="true">›</span>':''}<button class="ps3-parent-link" data-ps3-project="${esc(x.id)}">${i?'':'← '}${esc(x.name)}</button>`).join('');paintSelection();$('#ps3Summary').innerHTML=headSummary(d,ch);paintHead(p);$('#ps3Menu').innerHTML=manageable?moreMenu(p):'';disposeBasketEditor();const parts=[progress(d),childrenHtml(d,ch,manageable)];if(enabled(d,'tasks'))parts.push(tasksHtml(d));if(enabled(d,'documents'))parts.push(docsHtml(d));parts.push(meetingsHtml(d));if(enabled(d,'milestones'))parts.push(milestones(d));body.innerHTML=parts.join('');body.dataset.project=p.id;if(enabled(d,'documents'))mountDocKinds(d);mountReportPhotos(body,{rt,isCurrent:()=>d===detail});keep.forEach(k=>body.querySelector(`details[data-ps3-panel="${CSS.escape(k)}"]`)?.setAttribute('open',''));if(enabled(d,'tasks'))mountGoogleTasks(p.id);flushBasketLinks()}
const unsavedContent=()=>!!current&&$('#ps3Body')?.dataset.project===current.id&&(!!basketEditor?.hasDraft()||!!$('#ps3Body [data-dirty="true"]:is([data-ps3-editing],[data-ps3-new-section],[data-ps3-new-block],[data-ps3-edit-record])'));
const confirmDiscard=(extraDirty=false)=>!(unsavedContent()||extraDirty)||confirm('저장하지 않은 사업영역 내용이 있습니다. 이동하면서 버릴까요?');
window.addEventListener('kptu:before-reload',event=>{if(!confirmDiscard(event.detail?.projectDraft===true))event.preventDefault()});
// PC projects screen: show in the right pane (a selection, no history entry of its own); elsewhere: the dialog as before.
function showDetail(){if(placeDetail()){const m=$('#ps3DetailModal');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');$('#ps3DetailPane').classList.add('has-project');paintSelection();repaintHead();return true}openModal('ps3DetailModal');repaintHead();return false}
async function openProject(id,push=true,discardConfirmed=false,isCurrent=()=>true){if(!isCurrent())return;if(!discardConfirmed&&current?.id!==id&&!confirmDiscard())return;disposeBasketEditor();basketTargetId=id;const epoch=++detailEpoch;try{await loadProjects();if(epoch!==detailEpoch||!isCurrent())return;const p=projects.find(x=>x.id===id&&x.status!=='archived');if(!p){restoreBasketTarget();return}const result=await fetchDetail(id);if(epoch!==detailEpoch||!isCurrent())return;if(result?.p.id!==id){restoreBasketTarget();return}const switched=current?.id!==id;current=p;detail=acceptDetail(result);renderDetail(detail);const pane=showDetail();if(pane&&switched)$('#ps3DetailPane').scrollTop=0;rememberLast(id);flushBasketLinks();if(push&&!pane&&$('#areaWindow')?.dataset.kptuHistoryOpen!=='1')history.pushState({project:id},'',urlFor(id));else history.replaceState({...(pane?history.state:windowEntry()),project:id},'',urlFor(id))}catch(error){if(epoch!==detailEpoch||!isCurrent())return;restoreBasketTarget();throw error}}
async function refreshDetail({preserveOpenEditors=false}={}){const recordSaving=()=>!!$('#ps3Body [data-ps3-record][data-saving="1"]'),editorOpen=()=>preserveOpenEditors&&!!$('#ps3Body [data-ps3-editing]');
  // (MTG-프로젝트합치기 3단계: 늘 보이던 빠른 기록 칸은 없어졌다. 열린 편집기·저장 중인 기록이 있으면 뒤에서 다시 그리지 않는다.)
  if(!current||basketTargetId!==current.id||unsavedContent()||recordSaving()||editorOpen())return;const epoch=++detailEpoch,id=current.id;await loadProjects();if(epoch!==detailEpoch||unsavedContent()||recordSaving()||editorOpen())return;current=projects.find(x=>x.id===id)||current;const result=await fetchDetail(id);if(epoch!==detailEpoch||unsavedContent()||recordSaving()||editorOpen())return;detail=acceptDetail(result);renderDetail(detail)}
function closeDetail(discardConfirmed=false){if(!discardConfirmed&&!confirmDiscard())return false;detailEpoch++;basketTargetId=null;basketPending=false;disposeBasketEditor();closeModal('ps3DetailModal');delete $('#ps3Body').dataset.project;current=null;detail=null;clearUrl();return true}
// PRJ-3단: first and second levels, indented; never the project itself, one under it, or one that would make a fourth level.
// The current parent stays listed even if it no longer fits (a save that keeps it does not move the project).
function projectParentOptions(selected='',exclude=''){const self=exclude?projects.find(x=>x.id===exclude):null,rows=catalog.tree(projects).filter(x=>x.project.id===selected||!parentProblem(x.project,self));return '<option value="">상위 사업영역 없음</option>'+rows.map(({project:p,depth})=>`<option value="${esc(p.id)}" data-depth="${depth}" ${p.id===selected?'selected':''}>${esc(catalog.label(p.name||'이름 없는 사업영역',depth))}</option>`).join('')}
function openCreate(parentId=''){editingProject=null;$('#ps3CreateHeading').textContent=parentId?'하위 사업영역 만들기':'사업영역 만들기';$('#ps3CreateSave').textContent='저장';$('#ps3CreateName').value='';$('#ps3CreateObjective').value='';$('#ps3CreateParent').innerHTML=projectParentOptions(parentId);$('#ps3CreateParent').value=parentId||'';$('#ps3CreateStart').value=seoulDateKey();$('#ps3CreateEnd').value='';$('#ps3CreateColor').value='';$('#ps3CreateStatus').textContent='';openModal('ps3CreateModal',{initialFocus:'#ps3CreateName'});prepareProjectEditor();paintColorPicker()}
function openEdit(){if(!current)return;editingProject=current;const m=current.metadata||{};$('#ps3CreateHeading').textContent='사업영역 수정';$('#ps3CreateSave').textContent='변경사항 저장';$('#ps3CreateName').value=current.name||'';$('#ps3CreateObjective').value=m.objective||current.description||'';$('#ps3CreateParent').innerHTML=projectParentOptions(current.parent_id||'',current.id);$('#ps3CreateParent').value=current.parent_id||'';$('#ps3CreateStart').value=m.start_on||'';$('#ps3CreateEnd').value=m.end_on||'';$('#ps3CreateColor').value=colorKey(m.color);$('#ps3CreateStatus').textContent='';openModal('ps3CreateModal',{initialFocus:'#ps3CreateName'});prepareProjectEditor();paintColorPicker()}
function prepareProjectEditor(){return configureSaveEditor({key:'project',kind:'project',form:$('#ps3CreateModal .modal-card'),modal:'ps3CreateModal',targetId:editingProject?.id,source:editingProject,button:$('#ps3CreateSave'),status:$('#ps3CreateStatus'),fields:['Name','Objective','Parent','Start','End','Color'].map(x=>$('#ps3Create'+x))})}
function forgetSave(r){saveAttempts.delete(attemptKey(r.editor));r.editor.attempt=null;r.confirmed=true}
async function closeSavedEditor(r){const e=r.editor;closeSaveEditor(e.modal);const seq=e.seq,active=()=>sameSaveSession(e)&&saveEditors.get(e.key)===e&&e.closed&&e.seq===seq;return new Promise(resolve=>{const after=()=>resolve(active()?active:null);if(window.KPTUMobileModalHistory)window.KPTUMobileModalHistory.closeThen($('#'+e.modal),after);else{closeModal(e.modal);after()}})}
async function writeSaveBody(r,body=r.body){
  const a=r.attempt;if(savedBodySame(a,body))return a.row;
  const path=a.knownId!=null?saveReadPath(r.editor,a,a.knownId):'/rest/v1/'+SAVE_TABLE[r.editor.kind];
  const rows=await saveCall(r,path,{method:a.knownId!=null?'PATCH':'POST',body,prefer:'return=representation'});
  if(!sameSaveSession(r.editor))return null;
  return savedRow(r,rows,body);
}
async function saveProject(){
  const e=saveEditors.get('project');if(!e||!saveEditorCurrent(e))return;
  const [rawName,rawObjective,rawParent,start,end,rawColor]=readSaveDraft(e),name=rawName.trim(),color=colorKey(rawColor);if(!name){saveNotice(e,'사업영역 이름을 입력해 주세요.');return}
  const a=e.attempt,source=a?.row||e.source,objective=rawObjective.trim()||null,metadata={...(source?.metadata||{}),project_system:'v2',management_version:2,objective,start_on:start||null,end_on:end||null};
  // PRJ-3단: a new parent must keep the tree at three levels and must not be the project itself or one under it.
  if(rawParent&&rawParent!==(source?.parent_id||'')){const why=parentProblem(projects.find(x=>x.id===rawParent),e.targetId?projects.find(x=>x.id===e.targetId)||source:null);if(why){saveNotice(e,why);return}}
  // A child keeps any stored color untouched; it is shown in its parent's soft tone.
  if(!rawParent){if(color)metadata.color=color;else delete metadata.color}
  let body={parent_id:rawParent||null,name,description:objective,metadata,updated_at:new Date().toISOString()};
  if(!e.targetId&&!a?.knownId){metadata.created_from='project_system_v3';body={workspace_id:e.workspace,parent_id:rawParent||null,slug:'project-'+Date.now().toString(36),name,description:objective,sort_order:Math.max(0,...spaces.map(x=>Number(x.sort_order)||0))+10,created_by:e.owner,owner_id:e.owner,status:'active',visibility:'private',metadata}}
  const r=beginProjectSave(e,body);if(!r)return;let stage='body';
  try{
    const p=await writeSaveBody(r);if(!p||!projectSaveCurrent(r)){if(sameSaveSession(e))r.attempt.needsReview=true;return}
    const attempt=r.attempt;
    if(attempt.modulesNeeded&&attempt.modulesState!=='confirmed'){
      stage='modules';attempt.modulesState='pending';
      const modules=MODULES.filter(([key])=>!attempt.moduleKeys.has(key)).map(([module_key,title])=>({project_id:p.id,module_key,title,enabled:true,sort_order:(MODULES.findIndex(([key])=>key===module_key)+1)*10,config:{},created_by:r.owner}));
      const rows=await saveCall(r,'/rest/v1/app_project_modules',{method:'POST',body:freezeSave(modules),prefer:'return=representation'});
      if(!sameSaveSession(e))return;
      if(Array.isArray(rows))for(const row of rows)if(row?.project_id===p.id&&savedId(row.id)&&modules.some(x=>x.module_key===row.module_key&&Object.entries(x).every(([key,value])=>sameSavedField(key,row[key],value))))attempt.moduleKeys.add(row.module_key);
      if(!MODULES.every(([key])=>attempt.moduleKeys.has(key)))throw new Error('사업영역 설정의 저장 결과를 확인하지 못했습니다.');attempt.modulesState='confirmed';
      if(!projectSaveCurrent(r)){attempt.needsReview=true;return}
    }
    if(JSON.stringify(readSaveDraft(e))!==r.draft){attempt.needsReview=false;saveNotice(e,'제출한 사업영역은 저장했습니다. 추가로 입력한 내용은 남겨 두었습니다.');return}
    forgetSave(r);const active=await closeSavedEditor(r);if(!active)return;const epoch=detailEpoch;
    if(editingProject?.id===e.targetId)editingProject=null;
    await renderGrid({isCurrent:()=>active()&&epoch===detailEpoch});if(!active()||epoch!==detailEpoch)return;
    await openProject(p.id,!e.targetId,true,active);if(active())toast(e.targetId?'사업영역 정보를 수정했습니다.':'사업영역을 만들었습니다.');
  }catch(error){failedSave(r,error,stage)}finally{finishProjectSave(r)}
}
function openWs(id=''){editingWs=id?detail.workstreams.find(x=>x.id===id):null;$('#ps3WsTitle').value=editingWs?.title||'';$('#ps3WsPhase').value=editingWs?.phase||'in_progress';$('#ps3WsDelete').classList.toggle('hidden',!editingWs);$('#ps3WsState').textContent='';openModal('ps3WorkstreamModal');configureSaveEditor({key:'workstream',kind:'workstream',form:$('#ps3WorkstreamModal .modal-card'),modal:'ps3WorkstreamModal',targetId:editingWs?.id,projectId:current.id,source:editingWs,button:$('#ps3WsSave'),status:$('#ps3WsState'),fields:[$('#ps3WsTitle'),$('#ps3WsPhase')]})}
async function saveWs(){
  const e=saveEditors.get('workstream');if(!e||!saveEditorCurrent(e))return;const [rawTitle,phase]=readSaveDraft(e),title=rawTitle.trim();if(!title){saveNotice(e,'진행상황 제목을 입력해 주세요.');return}
  const body=e.targetId||e.attempt?.knownId?{title,phase}:{project_id:e.projectId,title,description:null,phase,sort_order:(detail.workstreams.length+1)*10,created_by:e.owner},r=beginProjectSave(e,body);if(!r)return;
  try{await writeSaveBody(r);if(!projectSaveCurrent(r)){if(sameSaveSession(e))r.attempt.needsReview=true;return}if(JSON.stringify(readSaveDraft(e))!==r.draft){saveNotice(e,'제출한 항목은 저장했습니다. 추가 입력은 남겨 두었습니다.');return}forgetSave(r);const active=await closeSavedEditor(r);if(active&&active()&&current?.id===e.projectId)await refreshDetail()}catch(error){failedSave(r,error)}finally{finishProjectSave(r)}
}
async function delWs(){if(!editingWs||!confirm(`“${editingWs.title}” 진행상황을 삭제할까요?`))return;await api(`/rest/v1/app_project_workstreams?id=eq.${editingWs.id}`,{method:'DELETE'});closeModal('ps3WorkstreamModal');await refreshDetail()}
function openMilestone(id=''){
  editingMilestone=id?detail.milestones.find(x=>x.id===id):null;
  $('#ps3MilestoneHeading').textContent=editingMilestone?'주요 일정 수정':'주요 일정 추가';$('#ps3MilestoneTitle').value=editingMilestone?.title||'';$('#ps3MilestoneAt').value=localInput(editingMilestone?.start_at);$('#ps3MilestoneNotes').value=editingMilestone?.notes||'';$('#ps3MilestoneDelete').classList.toggle('hidden',!editingMilestone);$('#ps3MilestoneState').textContent='';openModal('ps3MilestoneModal');
  const e=configureSaveEditor({key:'milestone',kind:'milestone',form:$('#ps3MilestoneModal .modal-card'),modal:'ps3MilestoneModal',targetId:editingMilestone?.id,source:editingMilestone,projectId:current.id,button:$('#ps3MilestoneSave'),status:$('#ps3MilestoneState'),fields:[$('#ps3MilestoneTitle'),$('#ps3MilestoneAt'),$('#ps3MilestoneNotes'),$('#ps3MilestoneGoogle')]});e.initialDate=localInput(e.source?.start_at);void prepareMilestoneGoogle(e);
}
async function restoreMilestoneSnapshot(snapshot,googleEventId=snapshot?.google_event_id){
  const payload=milestoneRestorePayload(snapshot,googleEventId);
  return api('/rest/v1/app_project_milestones?on_conflict=id',{method:'POST',body:payload,prefer:'resolution=merge-duplicates,return=representation'})
}
function googleOriginalPayload(address,event){
  const payload={action:'update-event',calendar_id:address.calendarId,event_id:address.eventId,title:event.title,memo:event.description||'',all_day:!!event.allDay};
  if(event.allDay){payload.start_date=event.start;payload.end_date=new Date(Date.parse(event.end)-86400000).toISOString().slice(0,10)}else{payload.start_iso=event.start;payload.end_iso=event.end}return payload;
}
function milestoneGooglePayload(e,visible,source,before,address){
  if(!address)return googleMilestonePayload('create-event',$('#ps3MilestoneGoogle').value,null,milestoneFullBody(visible));
  const payload=googleOriginalPayload(address,before),changedDate=e.fields[1].value!==localInput(source?.start_at);
  if(changedDate&&(before.allDay||before.recurring))throw new Error('종일·반복 일정의 날짜 변경은 일정 화면에서 확인해 주세요. 입력은 유지했습니다.');
  if(!source||visible.title!==source.title)payload.title=visible.title;if(!source||(visible.notes||'')!==(source.notes||''))payload.memo=visible.notes||'';
  if(changedDate){const duration=Date.parse(before.end)-Date.parse(before.start);if(!Number.isFinite(duration)||duration<=0)throw new Error('일정의 원래 기간을 확인해 주세요.');payload.start_iso=visible.start_at;payload.end_iso=new Date(Date.parse(visible.start_at)+duration).toISOString()}
  return payload;
}
function googlePayloadSame(a,payload){return a.googleState==='confirmed'&&['title','memo','all_day','start_iso','end_iso','start_date','end_date'].every(k=>sameSavedValue(a.googleWanted?.[k],payload[k]))}
function googleMatchesPayload(event,payload){return event.title===payload.title&&(event.description||'')===(payload.memo||'')&&!!event.allDay===!!payload.all_day&&(payload.all_day?event.start===payload.start_date&&event.end===new Date(Date.parse(payload.end_date)+86400000).toISOString().slice(0,10):Date.parse(event.start)===Date.parse(payload.start_iso)&&Date.parse(event.end)===Date.parse(payload.end_iso))}
async function milestoneGoogleCall(r,body){if(!projectSaveCurrent(r))throw new Error('편집창이 바뀌었습니다.');return googleCalendarCall('',{method:'POST',body:freezeSave(structuredClone(body)),expectedSessionEpoch:r.epoch})}
async function compensateMilestone(r,error){
  const a=r.attempt;if(!projectSaveCurrent(r)||!r.didGoogleWrite||![401,403].includes(error?.status))return false;
  a.bodyState='idle';a.compensation='pending';
  try{
    const body=r.createdGoogle?{action:'delete-event',calendar_id:a.address.calendarId,event_id:a.address.eventId}:googleOriginalPayload(a.address,r.googleBefore),result=await milestoneGoogleCall(r,body);
    if(!sameSaveSession(r.editor))return true;
    if(result?.ok!==true||(!r.createdGoogle&&(!validGoogleAddress(result.event,a.address)||!googleMatchesPayload(result.event,body))))throw new Error('되돌린 결과를 확인하지 못했습니다.');
    a.compensation='confirmed';a.googleState=r.createdGoogle?'compensated':'idle';a.googleCurrent=r.createdGoogle?null:r.googleBefore;a.needsReview=r.createdGoogle;
    saveNotice(r.editor,'Web2 저장이 거절되어 '+(r.createdGoogle?'생성한 Google 일정을':'Google Calendar 변경을')+' 되돌렸습니다. 입력은 유지했습니다.',{confirm:r.createdGoogle});
  }catch(rollbackError){if(sameSaveSession(r.editor)){a.compensation='unknown';a.googleState='unknown';a.needsReview=true;saveNotice(r.editor,'되돌린 결과를 확인하지 못했습니다. Google 일정과 사업영역 기록을 확인해 주세요. '+rollbackMessage('Google Calendar',rollbackError,{calendarId:a.address.calendarId,eventId:a.address.eventId}),{confirm:true})}}
  return true;
}
async function saveMilestone(){
  const e=saveEditors.get('milestone');if(!e||!saveEditorCurrent(e))return;if(e.attempt&&(e.attempt.needsReview||['unknown','compensated'].includes(e.attempt.googleState)||e.attempt.bodyState==='unknown')){saveNotice(e,'앞선 저장 결과를 먼저 확인해 주세요. 새로 저장하지 않았습니다.',{confirm:true});return}const [rawTitle,rawDate,rawNotes]=readSaveDraft(e);let startAt=null;try{startAt=rawDate?toSeoulISO(rawDate):null}catch(err){saveNotice(e,err.message);return}const visible={title:rawTitle.trim(),start_at:startAt,notes:rawNotes.trim()||null};if(!visible.title){saveNotice(e,'제목을 입력해 주세요.');return}if(!e.googleReady){milestoneOriginalNotice(e,'일정 원본과 캘린더 권한을 먼저 확인해 주세요.');return}
  const previous=e.attempt,source=previous?.row||e.source,address=previous?.address||(milestoneGoogleLinked(source)?{calendarId:source.google_calendar_id,eventId:source.google_event_id}:null),before=previous?.googleCurrent||e.googleBefore;
  if(address&&e.fields[3].value!==address.calendarId){saveNotice(e,'저장된 일정은 '+(e.calendars?.find(c=>c.id===address.calendarId)?.summary||'앞서 선택한 캘린더')+'에 있습니다. 현재 선택을 확인해 주세요. 캘린더 변경은 일정 화면에서 할 수 있습니다. 입력은 유지했습니다.',{confirm:true});return}
  if((address||!source)&&!visible.start_at){saveNotice(e,'일시를 입력해 주세요.');return}
  if(!address&&!source&&!e.calendars?.some(c=>c.id===$('#ps3MilestoneGoogle').value)){saveNotice(e,'쓰기 가능한 Google Calendar를 선택해 주세요.');return}
  let googleBody=null;try{if(address||!source)googleBody=milestoneGooglePayload(e,visible,source,before,address)}catch(error){saveNotice(e,error.message||String(error));return}
  const localId=previous?.localId||e.targetId||crypto.randomUUID(),body=source||previous?.knownId?visible:{...(previous?.localBase||{id:localId,project_id:e.projectId,...milestoneFullBody({...visible,end_at:null}),event_id:null,child_project_id:null,sort_order:(detail.milestones.length+1)*10,created_by:e.owner}),...visible};
  const r=beginProjectSave(e,body);if(!r)return;const a=r.attempt;a.localId=localId;a.localBase=a.localBase||r.body;a.googleNeeded=!!googleBody;a.address=address?freezeSave(structuredClone(address)):null;a.calendarId=a.calendarId||googleBody?.calendar_id;r.googleBefore=before?freezeSave(structuredClone(before)):null;r.failureStage='google';
  try{
    if(googleBody&&!googlePayloadSame(a,googleBody)){
      a.googleWanted=freezeSave(structuredClone(googleBody));a.googleState='pending';const result=await milestoneGoogleCall(r,googleBody);if(!sameSaveSession(e))return;
      if(result?.partial_failure&&result?.event?.id&&result.event.calendarId)a.observedAddress=freezeSave({calendarId:result.event.calendarId,eventId:result.event.id});
      const expected=address||{calendarId:a.calendarId,eventId:result?.event?.id};
      if(result?.ok!==true||!validGoogleAddress(result.event,expected)||!googleMatchesPayload(result.event,googleBody))throw new Error(result?.error||'Google 일정의 저장 결과를 확인하지 못했습니다.');
      a.address=freezeSave({...expected});a.googleCurrent=freezeSave(structuredClone(result.event));a.googleState='confirmed';r.didGoogleWrite=true;r.createdGoogle=googleBody.action==='create-event';
      if(!projectSaveCurrent(r)){a.needsReview=true;return}
    }
    r.failureStage='body';const localBody=a.address&&(!source||source.google_calendar_id!==a.address.calendarId||source.google_event_id!==a.address.eventId)?freezeSave({...r.body,google_calendar_id:a.address.calendarId,google_event_id:a.address.eventId}):r.body;
    if(!savedBodySame(a,localBody))a.localDispatched=true;
    await writeSaveBody(r,localBody);if(!projectSaveCurrent(r)){if(sameSaveSession(e))a.needsReview=true;return}
    if(JSON.stringify(readSaveDraft(e))!==r.draft){saveNotice(e,'제출한 일정은 저장했습니다. 추가로 입력한 내용은 남겨 두었습니다.');return}
    forgetSave(r);const active=await closeSavedEditor(r);if(!active)return;
    try{if(current?.id===e.projectId)await refreshDetail();if(active()&&a.address)await reloadMilestoneCalendars(active);if(active())toast(e.targetId?'주요 일정을 수정했습니다.':'주요 일정을 추가했습니다.')}catch(error){if(active())toast('일정은 저장했습니다. 목록을 다시 불러오지 못했습니다.')}
  }catch(error){
    if(!sameSaveSession(e))return;
    if(r.failureStage==='body'){if(!await compensateMilestone(r,error))failedSave(r,error)}else{a.googleState='unknown';a.needsReview=true;saveNotice(e,'Google 일정의 저장 결과를 확인하지 못했습니다. '+(error.message||error),{confirm:true})}
  }finally{finishProjectSave(r)}
}
async function recoverMilestone(e){
  const a=e.attempt;if(!a||a.pending||e.request||e.reading||!saveEditorCurrent(e))return;const run=++e.readRun,active=()=>saveEditorCurrent(e)&&run===e.readRun;
  const read=async(path,google=false)=>{if(!active())throw new Error('편집창이 바뀌었습니다.');const result=google?await googleCalendarCall(path.action,{params:path.params,expectedSessionEpoch:e.epoch}):await api(path,{singleFlight:false,expectedSessionEpoch:e.epoch});if(!active())throw new Error('편집창이 바뀌었습니다.');return result};
  const localPath=id=>saveReadPath(e,a,id),localRows=async id=>{const rows=await read(localPath(id));if(!Array.isArray(rows))throw new Error('사업영역 기록을 확인하지 못했습니다.');return rows.filter(row=>validSaveRow(e,row,id))};
  const getGoogle=async address=>{const status=await read({action:'status'},true);if(!writableGoogleCalendars(status).some(c=>c.id===address.calendarId))throw new Error('선택한 캘린더의 수정 권한을 확인해 주세요.');const d=await read({action:'event',params:{calendarId:address.calendarId,eventId:address.eventId}},true);if(!validGoogleAddress(d?.event,address)||!d.event.start||!d.event.end)throw new Error('정확한 Google 일정을 확인하지 못했습니다.');return d.event};
  const acceptGoogle=event=>{a.address=freezeSave({calendarId:event.calendarId,eventId:event.id});a.observedAddress=null;a.googleCurrent=freezeSave(structuredClone(event));e.googleBefore=a.googleCurrent;e.googleReady=true;a.googleState=googleMatchesPayload(event,a.googleWanted||{})?'confirmed':'idle'};
  const acceptLocal=async row=>{const rows=await localRows(row.id);if(rows.length!==1)throw new Error('선택한 사업영역 기록을 확인하지 못했습니다.');const fresh=rows[0];if(fresh.google_calendar_id&&fresh.google_event_id)acceptGoogle(await getGoogle(a.observedAddress||{calendarId:fresh.google_calendar_id,eventId:fresh.google_event_id}));else if(a.googleNeeded)throw new Error('선택한 기록의 Google 연결을 확인하지 못했습니다.');a.knownId=fresh.id;a.row=structuredClone(fresh);a.savedBody=structuredClone(fresh);a.bodyState='confirmed';a.needsReview=false;saveNotice(e,'선택한 기존 일정을 사용합니다. 입력을 확인한 뒤 저장해 주세요.')};
  const pick=async(label,load,accept)=>{const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=label;b.onclick=async()=>{if(!active()||e.reading)return;e.reading=true;saveBusy(e,true);try{const rows=await load();saveNotice(e,rows.length?'확인할 기존 항목을 직접 골라 주세요.':'목록에서 찾지 못했습니다. 입력을 유지하며 새로 만들지 않습니다.',{confirm:!rows.length});for(const row of rows){const c=document.createElement('button');c.type='button';c.className='secondary';c.textContent=String(row.title||'제목 없음')+' · 이 항목 사용';c.onclick=async()=>{if(!active()||e.reading)return;e.reading=true;saveBusy(e,true);try{await accept(row)}catch(error){if(active())saveNotice(e,error.message||String(error),{confirm:true})}finally{if(active()){e.reading=false;saveBusy(e,false)}}};e.status.append(document.createTextNode(' '),c);const hint=document.createElement('small');hint.textContent=String(row.start||row.start_at||'')+' · '+String(row.calendarId||row.id);e.status.append(hint)}}catch(error){if(active())saveNotice(e,error.message||String(error),{confirm:true})}finally{if(active()){e.reading=false;saveBusy(e,false)}}};e.status.append(document.createTextNode(' '),b)};
  e.reading=true;saveBusy(e,true);saveWait(e);
  try{
    const rows=await localRows(a.knownId||a.localId);if(rows.length===1){await acceptLocal(rows[0]);return}
    if(a.address){try{acceptGoogle(await getGoogle(a.observedAddress||a.address))}catch(error){if(a.googleState!=='compensated'){a.googleState='unknown';a.needsReview=true}}}
    a.needsReview=a.bodyState==='unknown'||a.googleState==='unknown'||a.googleState==='compensated';saveNotice(e,a.googleState==='compensated'?'Google 일정의 삭제 보상 응답은 확인했습니다. 현재 일정 조회와 사업영역 기록의 저장은 확인되지 않았습니다. 새로 만들지 않습니다.':!a.address?'Google 생성 결과를 확인하지 못했습니다. 기존 일정을 직접 확인해 주세요.':a.bodyState==='unknown'?'Google 일정은 조회했습니다. 사업영역 기록의 저장은 아직 확인하지 못했습니다. 새로 저장하지 않았습니다.':'Google 일정은 확인했습니다. 입력을 확인한 뒤 저장해 주세요.',{confirm:a.needsReview});
    if(a.bodyState==='unknown')await pick('사업영역 기록에서 확인',async()=>{const rows=await readRecordPages(localPath(null),{...rt,api:path=>read(path)});return rows.filter(row=>validSaveRow(e,row))},acceptLocal);
    if(!a.address||a.googleState==='compensated'||a.googleState==='unknown')await pick('Google 일정에서 확인',async()=>{const start=Date.parse(a.googleWanted?.start_iso||a.googleWanted?.start_date||a.localBase?.start_at),d=await read({action:'events',params:{timeMin:new Date(start-7*86400000).toISOString(),timeMax:new Date(start+7*86400000).toISOString()}},true);if(!Array.isArray(d?.events))throw new Error('Google 일정 목록을 확인하지 못했습니다.');return d.events.filter(row=>row.calendarId===a.calendarId&&savedId(row.id))},async row=>{const event=await getGoogle({calendarId:row.calendarId,eventId:row.id});acceptGoogle(event);a.needsReview=a.bodyState==='unknown';saveNotice(e,'선택한 기존 Google 일정을 사용합니다. '+(a.needsReview?'사업영역 기록은 더 확인해 주세요.':'입력을 확인한 뒤 저장해 주세요.'),{confirm:a.needsReview})});
  }catch(error){if(active())saveNotice(e,'저장 결과를 확인하지 못했습니다. '+(error.message||error),{confirm:true})}
  finally{if(active()){e.reading=false;saveBusy(e,false)}}
}
async function delMilestone(){
  if(!editingMilestone||!confirm('“'+editingMilestone.title+'” 주요 일정을 삭제할까요?'))return;
  const snapshot={...editingMilestone},linked=milestoneGoogleLinked(snapshot),calendarId=snapshot.google_calendar_id,googleEventId=snapshot.google_event_id;
  const st=$('#ps3MilestoneState'),button=$('#ps3MilestoneDelete');button.disabled=true;st.textContent='삭제 중…';
  if(linked){
    const body=milestoneFullBody({title:snapshot.title,start_at:snapshot.start_at||null,end_at:snapshot.end_at||null,notes:snapshot.notes||null},snapshot);
    try{
      await deleteGoogleMilestone(calendarId,googleEventId);
      try{
        await api('/rest/v1/app_project_milestones?id=eq.'+encodeURIComponent(snapshot.id),{method:'DELETE'});
      }catch(localError){
        let restored=null;
        try{restored=await createGoogleMilestone(calendarId,body)}catch(e){throw new Error((localError.message||localError)+' '+rollbackMessage('Google Calendar',e,{calendarId,eventId:googleEventId}))}
        try{await restoreMilestoneSnapshot(snapshot,restored.id)}catch(e){throw new Error((localError.message||localError)+' '+rollbackMessage('Web2 주요 일정',e,{calendarId,eventId:restored.id}))}
        throw new Error('Web2 삭제에 실패해 Google Calendar 일정을 복원했습니다: '+(localError.message||localError))
      }
    }catch(e){st.textContent=e.message||String(e);button.disabled=false;return}
  }else{
    try{await api('/rest/v1/app_project_milestones?id=eq.'+encodeURIComponent(snapshot.id),{method:'DELETE'})}
    catch(e){st.textContent=e.message||String(e);button.disabled=false;return}
  }
  closeModal('ps3MilestoneModal');await refreshDetail();if(linked)await reloadMilestoneCalendars();toast('주요 일정을 삭제했습니다.')
}
async function ensureFeature(view){const loader=window.KPTUViewLoader;if(loader?.isLoaded?.(view))return true;if(loader?.load){try{await loader.load(view);return true}catch(e){console.error('project feature load failed',view,e);return false}}return false}
async function openGlobal(kind){if(!current)return;if(kind==='task'){const g=window.KPTUGoogleTasks;if(!g)return toast('할 일 기능을 불러오지 못했습니다.');g.openEditor(null,{links:[{project_id:current.id}]});return}if(kind==='meeting'){if(!(await ensureFeature('meetings'))||!window.KPTUReportEntry)return toast('기능을 불러오지 못했습니다.');await window.KPTUReportEntry.open({targets:[{kind:'project',id:current.id}],trigger:document.activeElement});return}const target={document:['library','newDocumentBtn','docProject']}[kind];if(!target)return;const [view,buttonId,selectId]=target;if(!(await ensureFeature(view)))return toast('기능을 불러오지 못했습니다.');const project={id:current.id,name:current.name};$('#'+buttonId)?.click();queueMicrotask(()=>{const s=$('#'+selectId);if(!s)return;if(![...s.options].some(o=>o.value===project.id))s.add(new Option(project.name,project.id));s.value=project.id;if(kind==='document')s.dispatchEvent(new Event('change',{bubbles:true}))})}
async function goLibrary(){const project=current;if(!project||!closeDetail())return;if(!(await ensureFeature('library')))return toast('자료실을 불러오지 못했습니다.');const filter=$('#documentProject');if(filter){filter.value=project.id;window.KPTULibrary?.render?.()}window.KPTURouter?.go?.('library')}

// TRASH-삭제휴지통 2단계: 휴지통을 쓸 수 있는지는 refreshTrash 결과(trash.state) 한 곳에서만 정한다.
// 쓸 수 있을 때만 삭제 창·알림이 휴지통 문구를 쓰고, 아니면 바로 지우는 지금 문구를 쓴다.
async function openDelete(){
 const target=current;if(!target)return;
 if(trash.state!==TRASH_STATE.READY)await refreshTrash();
 if(current!==target)return;
 const t=deleteDialogText({trash:trash.state,name:target.name,isChild:!!target.parent_id,childCount:descendants(target).length});
 $('#ps3DeleteMessage').innerHTML=`<b>${esc(t.title)}</b><br>${esc(t.message)}`;
 const note=$('[data-ps3-delete-note]');note.textContent=t.note;note.hidden=!t.note;
 $('#ps3DeleteConfirm').textContent=t.button;$('#ps3DeleteState').textContent='';openModal('ps3DeleteModal')
}
async function deleteProject(){
 const st=$('#ps3DeleteState'),target=current,toTrash=trash.state===TRASH_STATE.READY;
 st.textContent=deleteDialogText({trash:trash.state,name:'',isChild:false,childCount:0}).busy;
 try{
  await api(`/rest/v1/app_spaces?id=eq.${target.id}`,{method:'DELETE'});
  closeModal('ps3DeleteModal');closeDetail(true);
  // 서버가 정말 휴지통으로 옮겼는지 목록으로 확인한 뒤에만 "휴지통으로 옮겼습니다"라고 말한다.
  let moved=false;if(toTrash){await refreshTrash();moved=trash.state===TRASH_STATE.READY&&trash.rows.some(r=>r.id===target.id)}
  await renderGrid();if(splitWanted())void resumeProjects();
  if(moved)offerUndoNotice({text:TRASH_TEXT.MOVED,onUndo:async()=>{const r=await trashRestore(target.id);if(!r.ok)return{status:'failed',message:r.message};await reloadAfterTrash();return{status:'restored',message:TRASH_TEXT.UNDO_DONE}}});
  else toast(TRASH_TEXT.DELETED)
 }catch(e){st.textContent=e.message||String(e);st.className='status error'}
}
async function archiveProject(){if(!current)return;const ch=descendants(current,{activeOnly:true});const note=ch.length?`\n하위 사업영역 ${ch.length}개는 함께 숨겨지고 상위 사업영역을 복구하면 다시 표시됩니다.`:'';if(!confirm(`“${current.name}” 사업영역을 보관할까요?${note}`))return;await api(`/rest/v1/app_spaces?id=eq.${current.id}`,{method:'PATCH',body:{status:'archived',updated_at:new Date().toISOString()}});closeDetail(true);await renderGrid();if(splitWanted())void resumeProjects();toast('사업영역을 보관했습니다.')}
async function toggleProjectDone(){if(!current||!canManage(current))return;const next=current.status==='done'?'active':'done';try{await api(`/rest/v1/app_spaces?id=eq.${encodeURIComponent(current.id)}`,{method:'PATCH',body:{status:next,updated_at:new Date().toISOString()}});await renderGrid();await refreshDetail();toast(next==='done'?'사업영역을 완료했습니다.':'사업영역을 다시 진행합니다.')}catch(e){console.error('project status update failed',e);toast('사업영역 상태를 변경하지 못했습니다.')}}
async function renderArchiveList(){const box=$('#ps3ArchiveList'),rows=archived();if(!box)return;if(!rows.length){box.innerHTML=empty();return}const under=p=>descendants(p);box.innerHTML=`<div class="ps3-plist">${rows.map(p=>listRowHtml(p,under(p),{open:false,trail:`<button type="button" class="mini ps3-prow-restore" data-ps3-restore="${p.id}">복구</button>`})).join('')}</div>`;void loadListSummaries([...listedProjects(),...rows.flatMap(p=>[p,...under(p).map(x=>x.project)])])}
// 보관 모달 하나가 보관 탭과 휴지통 탭을 가진다. 그리기는 paintArchive 하나가 맡는다.
function trashSig(){return trash.merged+'|'+TRASH_KINDS.map(k=>trash.kinds[k]||'').join(',')+'|'+trash.rows.map(r=>`${r.kind}:${r.id}:${r.child_count}:${r.file_count}:${r.parent_in_trash}`).join(',')}
function paintArchiveBtn(el){const b=el||$('#ps3ArchiveBtn');if(!b)return;const label=archiveButtonLabel({archived:archived().length,trashCount:trash.rows.length,trash:trash.merged});b.textContent=label||'보관 0';b.hidden=!label}
function trashRowHtml(r){
 const folder=r.kind==='library_folder',note=r.kind==='note',share=r.kind==='share_page',meta=[r.kind===TRASH_KIND?'':note?noteKindWord(r.note_kind):TRASH_KIND_LABEL[r.kind],share?sharePrevWord(r.prev_status):'',folder?(r.project_name||'사업영역 없음'):'',date(r.deleted_at)+' 넣음',r.child_count?`하위 ${r.child_count}개`:'',folder&&r.file_count?`자료 ${r.file_count}개`:'',note&&r.file_count?`첨부 ${r.file_count}개`:'',note&&r.link_count?`연결 ${r.link_count}곳`:share&&r.link_count?`링크 ${r.link_count}개`:'',share&&r.file_count?`사진 ${r.file_count}장`:''].filter(Boolean).map(esc).join(' · ');
 const hint=r.parent_in_trash?` · <span class="ps3-trash-hint">${esc(parentFirstText(r.kind))}</span>`:'';
 return `<div class="ps3-restore-line ps3-trash-line" data-ps3-trash-row="${esc(r.id)}"><div class="ps3-prow-main kptu-list-row"><span class="kptu-list-row-main"><span class="ps3-prow-name kptu-list-name">${esc(r.name)}</span><span class="ps3-prow-meta kptu-list-summary">${meta}${hint}</span></span></div><button type="button" class="mini ps3-prow-restore" data-ps3-trash-restore="${esc(r.id)}"${r.parent_in_trash?' disabled':''}>되돌리기</button><details class="ps3-more ps3-line-more"><summary class="icon-btn" aria-label="휴지통 관리: ${esc(r.name)}"><span class="more-dots" aria-hidden="true">⋯</span></summary><div class="ps3-more-panel" role="group" aria-label="휴지통 관리"><button type="button" class="ps3-danger" data-ps3-trash-purge="${esc(r.id)}">영구 삭제</button></div></details></div>`
}
function paintTrashList(box){
 if(trash.merged===TRASH_STATE.MISSING){box.innerHTML=empty(TRASH_TEXT.PREPARING);return}
 if(trash.merged===TRASH_STATE.FAILED){box.innerHTML=`${empty(TRASH_TEXT.LOAD_FAILED)}<button type="button" class="mini" data-ps3-trash-retry>다시 시도</button>`;return}
 // 일부 종류만 아직 준비 전(DB 적용 전)이면 그 종류만 '준비 중'이라고 한 줄 알린다.
 const pending=TRASH_KINDS.filter(k=>trash.kinds[k]===TRASH_STATE.MISSING).map(k=>TRASH_KIND_LABEL[k]);
 const note=pending.length?`<p class="muted" data-ps3-trash-pending>${esc(pending.join('·'))} 휴지통은 준비 중입니다.</p>`:'';
 box.innerHTML=(trash.rows.length?`<div class="ps3-plist">${trash.rows.map(trashRowHtml).join('')}</div>`:empty())+note
}
function paintArchive(){
 const box=$('#ps3ArchiveList'),tabs=$('#ps3ArchiveTabs'),hint=$('[data-ps3-archive-hint]'),head=$('#ps3ArchiveHeading');if(!box||!tabs)return;
 const known=trash.merged!==TRASH_STATE.UNKNOWN,tab=known?trash.tab:'archive';
 tabs.hidden=!known;
 tabs.querySelectorAll('[data-ps3-archive-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.ps3ArchiveTab===tab)));
 head.textContent=tab==='trash'?'휴지통':'보관한 사업영역';
 hint.hidden=tab==='trash'&&trash.merged!==TRASH_STATE.READY;
 hint.textContent=tab==='trash'?'삭제한 사업영역·담당조직·사업 보고·자료실 폴더·노트·업데이트·공유 페이지입니다. 자동으로 비우지 않으며, 영구 삭제는 직접 누를 때만 됩니다.':'삭제하지 않고 목록에서만 숨긴 사업영역입니다.';
 if(tab==='trash')paintTrashList(box);else void renderArchiveList()
}
async function refreshTrash(){
 if(trashFlight)return trashFlight;
 const epoch=projectEpoch,run=(async()=>{
  // 종류마다 따로 읽는다. 한 종류가 아직 없어도(DB 적용 전) 다른 종류는 그대로 보인다.
  const got=await Promise.all(TRASH_KINDS.map(async kind=>{
   try{const data=await api('/rest/v1/rpc/app_trash_list',{method:'POST',body:{p_kind:kind},singleFlight:false});return{kind,state:classifyTrashList(data),rows:normalizeTrashRows(data,kind)}}
   catch(e){return{kind,state:classifyTrashError(e,kind),rows:[]}}
  }));
  if(epoch===projectEpoch){
   trash.kinds=Object.fromEntries(got.map(g=>[g.kind,g.state]));trash.state=trash.kinds[TRASH_KIND];trash.merged=mergeTrashStates(trash.kinds);
   trash.rows=got.flatMap(g=>g.rows).sort((x,y)=>String(y.deleted_at||'').localeCompare(String(x.deleted_at||''))||x.id.localeCompare(y.id))
  }
  return trash.state
 })();
 trashFlight=run;try{return await run}finally{if(trashFlight===run)trashFlight=null}
}
async function syncTrash(){
 const epoch=projectEpoch,before=trashSig();await refreshTrash();if(epoch!==projectEpoch)return;
 paintArchiveBtn();
 if(trashSig()!==before&&!$('#ps3ArchiveModal')?.classList.contains('hidden'))paintArchive()
}
async function reloadAfterTrash(){const epoch=projectEpoch;await syncTrash();if(epoch!==projectEpoch)return;await renderGrid();if(epoch===projectEpoch&&splitWanted())void resumeProjects()}
async function trashRestore(id,kind=TRASH_KIND){
 try{await api('/rest/v1/rpc/app_trash_restore',{method:'POST',body:{p_kind:kind,p_id:id},singleFlight:false});return{ok:true}}
 catch(e){return{ok:false,message:trashErrorText(e,TRASH_TEXT.UNDO_FAILED)}}
}
// 담당조직·사업 보고를 되돌리거나 영구 삭제하면 그 화면도 다시 읽게 알린다(프로젝트는 reloadAfterTrash가 그린다).
function tellOtherViews(kind){if(kind==='organization')window.dispatchEvent(new Event('kptu:suborganization-updated'));else if(kind==='report')window.dispatchEvent(new CustomEvent('kptu:meetings-changed'));else if(kind==='library_folder')window.dispatchEvent(new Event('kptu:library-folders-changed'));else if(kind==='note')window.dispatchEvent(new Event('kptu:basket-notes-restored'));else if(kind==='share_page')window.dispatchEvent(new Event('kptu:share-pages-changed'))}
async function restoreFromTrash(id){
 const row=trash.rows.find(x=>x.id===id);if(!row||trash.busy)return;trash.busy=true;
 try{const r=await trashRestore(id,row.kind);toast(r.ok?restoredText(row.kind):r.message)}finally{trash.busy=false}
 tellOtherViews(row.kind);await reloadAfterTrash();paintArchive()
}
async function purgeFromTrash(id){
 const row=trash.rows.find(x=>x.id===id);if(!row||trash.busy)return;
 if(!confirm(purgeConfirmText(row)))return;
 trash.busy=true;
 try{
  // 공유 페이지: 사진 파일(비공개 버킷)을 서버 함수가 먼저 지우고 페이지를 영구 삭제한다. 나머지 종류는 DB 함수 하나.
  if(row.kind==='share_page'){const r=await purgeSharePage(id,{rt});if(!r.ok)toast(r.message);else toast(TRASH_TEXT.PURGED)}
  else{await api('/rest/v1/rpc/app_trash_purge',{method:'POST',body:{p_kind:row.kind,p_id:id},singleFlight:false});toast(TRASH_TEXT.PURGED)}}
 catch(e){toast(trashErrorText(e,'영구 삭제하지 못했습니다. 다시 시도해 주세요.'))}
 finally{trash.busy=false}
 tellOtherViews(row.kind);await reloadAfterTrash();paintArchive()
}
function openArchive(){trash.tab=firstArchiveTab({archived:archived().length});paintArchive();openModal('ps3ArchiveModal');void syncTrash()}
async function restoreArchive(id){await api(`/rest/v1/app_spaces?id=eq.${id}`,{method:'PATCH',body:{status:'active',updated_at:new Date().toISOString()}});await loadProjects();paintArchive();await renderGrid();toast('사업영역을 복구했습니다.')}
// 사업 보고 [연결](모든 종류에서 고름)·⋯ [연결 해제](5초 되돌리기). 저장은 report-links.js 한 곳.
async function repaintReports(){if(!current)return;const id=current.id;try{const r=await readLinkedReports({kind:'project',id},rt);if(!current||current.id!==id||!detail)return;const photos=await readReportPhotos(r.rows,rt).catch(e=>{console.warn('project report photos repaint failed',e);return new Map()});if(!current||current.id!==id||!detail)return;detail.meetings=r.rows;detail.reportPhotos=photos;const box=$('#ps3-meetings');if(box){box.outerHTML=meetingsHtml(detail);mountReportPhotos($('#ps3-meetings'),{rt,isCurrent:()=>current?.id===id})}}catch(e){console.warn('project reports repaint failed',e)}}
async function reportLink(trigger){
  if(!current)return;const target={kind:'project',id:current.id};
  try{const all=await readAllReports(rt);const linked=new Set((detail?.meetings||[]).map(m=>m.id));
    const picker=await import('./report-places-sheet.js');
    await picker.pickReport(trigger,{reports:all,linkedIds:linked,title:'이 사업영역에 연결할 사업 보고',onPick:async id=>{
      const r=await changeOneTarget(id,target,'add');
      if(!r.ok){toast(r.message||'연결하지 못했습니다.');return}
      toast('사업 보고를 연결했습니다.');window.dispatchEvent(new CustomEvent('kptu:meetings-changed',{detail:{meeting_id:id}}));await repaintReports()}})}
  catch(e){toast(e.message||'사업 보고 목록을 불러오지 못했습니다.')}
}
async function reportUnlink(id){
  if(!current)return;const target={kind:'project',id:current.id};
  try{
    const now=await readReportTargets(id);const mine=now.find(t=>sameTarget(t,target));
    if(mine?.hasSummary&&!confirm('이 연결에 보낸 기록이 있어요. 연결을 해제하면 그 기록도 함께 지워져요. 해제할까요?'))return;
    const r=await changeOneTarget(id,target,'remove');
    if(!r.ok){toast(r.message||'연결을 해제하지 못했습니다.');return}
    window.dispatchEvent(new CustomEvent('kptu:meetings-changed',{detail:{meeting_id:id}}));await repaintReports();
    if(mine?.hasSummary){toast('연결과 보낸 기록을 지웠습니다.');return}
    offerUndoNotice({text:'연결을 해제했어요. 사업 보고는 남아요.',onUndo:async()=>{const back=await restoreTargets(id,r.previous);if(!back.ok)return {status:'failed',message:back.message||'되돌리지 못했어요.'};await repaintReports();window.dispatchEvent(new CustomEvent('kptu:meetings-changed',{detail:{meeting_id:id}}));return {status:'restored',message:'연결을 되돌렸어요.'}}});
  }catch(e){toast(e.message||'연결을 해제하지 못했습니다.')}
}
function reportClick(e){
  const link=e.target.closest?.('#ps3Body [data-ps3-report-link]');if(link){e.preventDefault();void reportLink(link);return}
  const un=e.target.closest?.('#ps3Body [data-ps3-report-unlink]');if(un){e.preventDefault();un.closest('details')?.removeAttribute('open');void reportUnlink(un.dataset.ps3ReportUnlink)}
}
window.addEventListener('kptu:meetings-changed',()=>{void repaintReports()});
function bind(){document.addEventListener('click',reportClick);bindRecordMenu();bindFoldMenu();bindReorderDrag();document.addEventListener('change',e=>{if(e.target?.id==='ps3CreateParent')paintColorPicker()});document.addEventListener('click',e=>{const b=e.target.closest?.('#ps3CreateColorField [data-ps3-color]');if(b)pickColor(b.dataset.ps3Color)});document.addEventListener('keydown',e=>{const b=e.target.closest?.('#ps3CreateColorField [data-ps3-color]');const step={ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1}[e.key];if(!b||!step)return;e.preventDefault();const keys=PROJECT_COLORS.map(([k])=>k);pickColor(keys[(keys.indexOf(b.dataset.ps3Color)+step+keys.length)%keys.length],true)});document.addEventListener('input',event=>rememberSaveDraft(event.target),true);window.addEventListener('kptu:dialog-closed',event=>{if(event.detail?.modal?.id)closeSaveEditor(event.detail.modal.id)});window.addEventListener('kptu:basket-links-changed',()=>{void refreshBasketLinks()});window.addEventListener('kptu:meetings-changed',()=>{void refreshDetail({preserveOpenEditors:true})});PC?.addEventListener?.('change',()=>{orderMode=false;placeDetail();void resumeProjects()});const refreshList=()=>{if(areaOpen()||!$('#ps3DetailModal')?.classList.contains('hidden'))void loadListSummaries(listedProjects())};window.addEventListener('kptu:google-tasks-changed',refreshList);window.addEventListener('kptu:api-saved',e=>{const path=e.detail?.path||'';if(path.includes('/app_project_progress_updates')||path.includes('/app_project_milestones')||(path.includes('/functions/v1/google-tasks')&&['link','unlink'].includes(e.detail?.action)))refreshList()});document.addEventListener('input',e=>{const form=e.target.closest?.('[data-ps3-edit-record]');if(form){const u=detail?.progress.find(x=>x.id===form.dataset.ps3EditRecord);form.dataset.dirty=String(e.target.value!==(u?.summary||''))}},true);document.addEventListener('submit',e=>{const record=e.target.closest?.('[data-ps3-edit-record]');if(record){e.preventDefault();saveProgressRecord(record);return}const form=e.target.closest?.('[data-ps3-editing]');if(form){e.preventDefault();saveBlock(form)}},true);document.addEventListener('click',e=>{if(e.target.closest?.('[data-ps3-basket-retry]')){void refreshBasketLinks();return}if(tapExpand(e,'#ps3Body .ps3-rec-text'))return;const note=e.target.closest?.('#ps3Body [data-ps3-basket-note]');if(note){if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();return openBasketLine(note)}const recordTrigger=e.target.closest?.('[data-ps3-record-menu]');if(recordTrigger){e.preventDefault();return openRecordMenu(recordTrigger)}const edit=e.target.closest?.('button[data-ps3-edit-record]');if(edit)return editProgressRecord(edit);const cancel=e.target.closest?.('[data-ps3-cancel-record]');if(cancel)return resetProgressRecord(cancel.closest('[data-ps3-record]'));const remove=e.target.closest?.('[data-ps3-delete-record]');if(remove)return mutateProgressRecord(remove.closest('[data-ps3-record]'),'DELETE');document.querySelectorAll('.ps3-more[open]').forEach(menu=>{if(!menu.contains(e.target)||e.target.closest('.ps3-more-panel button'))menu.open=false});const p=e.target.closest?.('[data-ps3-project]');if(p){e.preventDefault();e.stopPropagation();if(!(docked()&&basketTargetId===p.dataset.ps3Project))openProject(p.dataset.ps3Project);return}const mt=e.target.closest?.('#ps3Body [data-ps3-meeting]');if(mt){e.preventDefault();void openMeetingRound(mt.dataset.ps3Meeting);return}const c=e.target.closest?.('[data-ps3-close]');if(c){c.dataset.ps3Close==='ps3DetailModal'?closeDetail():closeModal(c.dataset.ps3Close);return}if(e.target.closest('[data-ps3-child]'))return openCreate(current.id);if(e.target.closest('[data-ps3-edit-project]'))return openEdit();if(e.target.closest('[data-ps3-archive-project]'))return archiveProject();if(e.target.closest('[data-ps3-toggle-done]'))return toggleProjectDone();const gl=e.target.closest?.('[data-ps3-gtask-link]');if(gl){if(current)window.KPTUGoogleTasks?.openLinkPicker({project_id:current.id});return}const rr=e.target.closest?.('[data-ps3-restore]');if(rr)return restoreArchive(rr.dataset.ps3Restore);const at=e.target.closest?.('[data-ps3-archive-tab]');if(at){trash.tab=at.dataset.ps3ArchiveTab;return paintArchive()}const tr=e.target.closest?.('[data-ps3-trash-restore]');if(tr)return restoreFromTrash(tr.dataset.ps3TrashRestore);const tp=e.target.closest?.('[data-ps3-trash-purge]');if(tp)return purgeFromTrash(tp.dataset.ps3TrashPurge);if(e.target.closest('[data-ps3-trash-retry]'))return void syncTrash().then(paintArchive);if(e.target.closest('[data-ps3-add-milestone]'))return openMilestone();const em=e.target.closest?.('[data-ps3-edit-milestone]');if(em)return openMilestone(em.dataset.ps3EditMilestone);const ed=e.target.closest?.('[data-ps3-edit-doc]');if(ed){window.dispatchEvent(new CustomEvent('kptu:edit-document',{detail:{id:ed.dataset.ps3EditDoc}}));return}if(e.target.closest('[data-ps3-library]'))return goLibrary();if(e.target.closest('[data-ps3-delete-project]'))return openDelete();const g=e.target.closest?.('[data-ps3-global]');if(g)return openGlobal(g.dataset.ps3Global)},true);$('#ps3CreateSave').onclick=saveProject;$('#ps3WsSave').onclick=saveWs;$('#ps3WsDelete').onclick=delWs;$('#ps3MilestoneSave').onclick=saveMilestone;$('#ps3MilestoneDelete').onclick=delMilestone;$('#ps3DeleteConfirm').onclick=deleteProject;document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;const menu=$('.ps3-more[open]');if(!menu)return;e.preventDefault();e.stopImmediatePropagation();menu.open=false;menu.querySelector('summary')?.focus()},true);window.addEventListener('kptu:tasks-changed',()=>{if(current)refreshDetail().catch(console.error)})}
// 뒤로가기: 저장 안 한 글이 있으면 묻고(그대로 두면 기록을 되돌려 놓음), 상세 기록을 떠났으면 상세를 닫는다.
// 공용 폰 기록(mobile-modal-history.js)은 이 상세를 직접 숨기므로 이 처리가 그보다 먼저 돌아야 한다(같은 popstate는 붙인 순서로 돈다).
// 앱에서는 이 묶음이 늦게 받아져 그 뒤에 붙으므로, 시작할 때 붙는 창 그릇(area-window.js)의 popstate가 맨 먼저 부른다(KPTUProjects.back).
// 아래 직접 붙인 것은 창 그릇이 없을 때(이 묶음만 쓰는 시험 화면) 쓰이고, 이미 처리한 같은 뒤로가기는 다시 처리하지 않는다.
const backHandled=new WeakSet();
window.addEventListener('popstate',onBack,true);
function onBack(event){
  if(backHandled.has(event))return;backHandled.add(event);
  const id=new URLSearchParams(location.search).get('project'),modal=$('#ps3DetailModal');
  const overlayBack=current&&modal.dataset.kptuHistoryOpen==='1'&&event.state?.kptuOverlay!==modal.id&&!document.querySelector('.modal:not(.hidden):not(#ps3DetailModal):not(#areaWindow)');
  if(current&&(id!==current.id||overlayBack)&&!confirmDiscard()){
    event.stopImmediatePropagation();history.pushState({project:current.id,...(modal.dataset.kptuHistoryOpen==='1'?{kptuOverlay:modal.id}:{})},'',urlFor(current.id));return
  }
  if(!id||overlayBack){if(current||basketTargetId)closeDetail(true)}else if(id!==current?.id)openProject(id,false,true)
}
function bindContentCompose(){document.addEventListener('submit',e=>{const form=e.target.closest?.('[data-ps3-new-section],[data-ps3-new-block]');if(!form)return;e.preventDefault();e.stopImmediatePropagation();if(form.dataset.ps3NewSection!==undefined)saveNewSection(form);else saveNewBlock(form)},true);document.addEventListener('change',e=>{const form=e.target.closest?.('[data-ps3-new-block]');if(!form||!e.target.matches('[data-ps3-new-type]'))return;const title=form.querySelector('[data-ps3-block-title]').value,type=e.target.value;form._newBlock={block_type:type,content:newBlockContent(type)};form._draftContent=null;form.innerHTML=newBlockForm(form._newBlock,title);form.dataset.dirty='true'},true);document.addEventListener('click',e=>{const cancel=e.target.closest?.('[data-ps3-cancel-new]');if(cancel){e.stopImmediatePropagation();cancel.closest('form')?.remove();return}const add=e.target.closest?.('[data-ps3-new-block] [data-ps3-add-item]');if(add){e.stopImmediatePropagation();addBlockItem(add.closest('form'))}},true);document.addEventListener('input',e=>{const form=e.target.closest?.('[data-ps3-new-section],[data-ps3-new-block]');if(form)form.dataset.dirty='true'},true)}
function installProjectToolbar(){const head=$('#areaWindow .section-head');if(!head)return;let actions=head.querySelector('.ps3-project-toolbar');if(!actions){actions=document.createElement('div');actions.className='ps3-project-toolbar';const existing=$('#newProjectBtn');if(existing){existing.insertAdjacentElement('beforebegin',actions);actions.appendChild(existing)}else head.appendChild(actions)}let archiveBtn=$('#ps3ArchiveBtn');if(!archiveBtn){archiveBtn=document.createElement('button');archiveBtn.id='ps3ArchiveBtn';archiveBtn.type='button';archiveBtn.className='ps3-archive-link';archiveBtn.textContent='보관 0';actions.prepend(archiveBtn)}archiveBtn.onclick=openArchive}
function resetProjectSession(){orderMode=false;closeRecordMenu();disposeBasketEditor();
  projectEpoch+=1;detailEpoch+=1;saveEditors.clear();saveAttempts.clear();projectRuntimeEpoch=rt.session.epoch();
  user=null;membership=null;wid=null;members=[];profiles=[];spaces=[];projects=[];
  current=null;detail=null;basketTargetId=null;basketPending=false;editingProject=null;editingMilestone=null;editingWs=null;googleCalendarState=null;
  lastSpacesKey='';summaryRun++;listCounts={};trash={state:TRASH_STATE.UNKNOWN,merged:TRASH_STATE.UNKNOWN,kinds:{},rows:[],tab:'archive',busy:false};trashFlight=null;
  document.querySelectorAll('#ps3DetailModal,#ps3CreateModal,#ps3WorkstreamModal,#ps3MilestoneModal,#ps3DeleteModal,#ps3ArchiveModal').forEach(m=>{m.classList.add('hidden');m.setAttribute('aria-hidden','true')});
  const detailEl=$('#ps3DetailModal');if(detailEl&&docked()){document.body.append(detailEl);detailEl.classList.remove('ps3-docked');detailEl.setAttribute('role','dialog');detailEl.setAttribute('aria-modal','true');delete detailEl.dataset.ps3Docked}
  const grid=$('#projectGrid');if(grid){const toolbar=$('#areaWindow .section-head .ps3-project-toolbar');for(const button of [$('#ps3ArchiveBtn'),$('#newProjectBtn')])if(button&&grid.contains(button))toolbar?.append(button);grid.dataset.ps3Ready='0';grid.innerHTML=''}
  clearUrl()
}
async function handleProjectSessionChange(event){
  if(event?.detail?.session&&projectRuntimeEpoch===rt.session.epoch())return;
  resetProjectSession();
  const epoch=projectEpoch;
  if(await context(epoch)&&epoch===projectEpoch)await renderGrid()
}
// UI-PC프로젝트좌우: each time the projects screen shows: the list, then (1) the project a 🧺 note was opened from, at the
// same scroll, or (2) on a PC with nothing chosen, the last project seen on this device, else the first one.
async function onProjectsView(){await renderGrid({isCurrent:areaOpen});if(areaOpen())await resumeProjects()}
// 창을 닫을 때(area-window.js close): 열린 상세를 닫고(저장 안 한 글이 있으면 묻고, 그대로 두면 false) 칸 상태를 처음으로.
function hideProjects(){orderMode=false;if(current){closingWindow=true;try{if(!closeDetail())return false}finally{closingWindow=false}}else{detailEpoch++;basketTargetId=null;disposeBasketEditor()}placeDetail();return true}
async function resumeProjects(){
  const o=takeBasketReturn('projects',rt);
  // A back arrives as popstate: open after its listeners (mobile-modal-history.js would close a dialog opened during them).
  if(o)await new Promise(resolve=>setTimeout(resolve));
  if(o&&areaOpen()&&projects.some(x=>x.id===o.id&&x.status!=='archived')){
    if(current?.id!==o.id)await openProject(o.id,false,false,areaOpen);
    if(current?.id===o.id){restoreScroll(o.scroll);return}
  }
  placeDetail();
  if(!splitWanted()||current||basketTargetId)return;
  const listed=listedProjects(),last=readLast(),id=listed.some(p=>p.id===last)?last:listed[0]?.id;
  if(id)await openProject(id,false,false,()=>splitWanted())
}
async function boot(){ensureUi();bind();window.addEventListener('kptu:session-changed',handleProjectSessionChange);if(!(await context(projectEpoch)))return false;await loadProjects();installProjectToolbar();const b=$('#newProjectBtn');if(b){b.classList.add('ps3-toolbar-btn');b.onclick=e=>{e.preventDefault();e.stopImmediatePropagation();openCreate()}}await renderGrid();document.documentElement.classList.add('kptu-project-v3-ready');return true}
window.__KPTU_PROJECT_V3_READY__=boot().catch(err=>{console.error(err);return false});
// 창 밖 화면 이동: 창 없이 다른 화면 위에 연 상세 창(옛 길)은 화면을 옮기면 닫는다(창이 떠 있으면 area-window.js가 창과 함께 닫음).
window.addEventListener('kptu:view-changed',e=>{if(e.detail?.areas||areaOpen())return;orderMode=false;if(current)closeDetail();else{detailEpoch++;basketTargetId=null;disposeBasketEditor()}placeDetail()});
window.KPTUProjects={open:openProject,shown:onProjectsView,hide:hideProjects,place:placeDetail,back:onBack};
})();
