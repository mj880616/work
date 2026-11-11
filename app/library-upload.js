import {readDocuments} from './report-list-read.js'; // APP-낭비줄이기 ①: 자료 목록은 쓰는 열만(글자 본문 열 제외)
import './enter-save.js'; // UI-엔터저장: shared Enter-to-save rule for the data-enter-save roots below
import {renderFilterChips} from './filter-chips.js';
import {uploadTimeoutMs} from './upload-budget.mjs';
import {floatingWindowOpen} from './open-window.mjs'; // ★LIB-바깥파일놓기안됨: 칸에 붙인 창(사업 보고 결과 등)은 열린 창으로 치지 않는다
import {sendUpload} from './upload-send.mjs';
import {trackUpload,setUploadRetry,mountUploadRows,paintUploadLine,watchUploads} from './upload-progress.js';
import {readView,saveView,orderedGroups} from './library-view-pref.js';
import {recentFolded,toggleRecentFolded} from './recent-fold.js';
import {ftCaretHtml} from './folder-tree-ui.mjs';
import {walkTo,walkUp,walkUpLabel} from './folder-walk.mjs';
import {bindEdgeBack} from './edge-back-swipe.js';
import {MORE_LABEL,chevHtml} from './fold-chevron.mjs';
import {RECENT_UPLOAD_LIMIT,RECENT_UPLOAD_MORE,recentUploads,isNewUpload,uploadTimeLabel,rememberFolder,cleanRecentFolders} from './library-move.mjs';
import {hiddenCategories,activeSubcategory,chipOrder,categoryCounts} from './category-chips.js';
import {createChoiceSheet} from './choice-sheet.js';
// S52-01 ③c UI-사업영역조직고르기창: 자료 올리기·정보 수정의 사업영역, 여러 개 바꾸기의 사업영역·담당조직은 모든 화면과 같은 고르기 창.
import {openAreaOrgPicker,usedKeysNow,catalogAreas,orderedOrgGroups,areaTree,areaChipText} from './area-org-picker.js';
import {pickedFrom,offFrom,togglePick,isPicked,pickLabel,pickCount} from './library-category-pick.mjs';
import {nodeDocumentIds,toggleAll,allSelected,someSelected,pruneSelected,deleteSequentially} from './library-select.js';
import {isLibraryPhoto,hydrateLibraryThumbs} from './library-photo.js';
import {foldPhotoSets,isPhotoSet,photoMeetingChunks} from './library-photoset.mjs';
import {twinPlan,withTwins,pickCountText} from './library-twins.mjs';
import {reportPhotosHtml,mountReportPhotos} from './report-photos.js';
import {OUTSIDE_KEY as OUT_KEY,GROUP_BY,GROUP_LABELS,fileKindOf,buildTree,treeHtml,folderSuggestions,keys as luTreeKeys,walk as luTreeWalk,matchedKeys,pathTo,documentsInTrashedFolders} from './library-tree.js';
import {mountLibraryFolders} from './library-folders.js';
import {readLibraryFolders} from './library-folder-data.js';
import {createSelectMode} from './select-mode.js';
import {announceUploaded} from './upload-done.js';
import {folderTrail,folderPathHtml} from './folder-path.mjs';
import {bindFolderPinch} from './folder-pinch.js';
import {fillGestureArea,settleGestureAreas} from './gesture-fill.js';
import {SPLIT_QUERY,NARROW_QUERY} from './screen-width.mjs';
import {viewPrefs} from './view-prefs.js';
import {createLibraryTwo} from './library-two-pane.js';
import {iconHtml,treeIconHtml} from './tree-icons.js';
import {ftPressToggle,ftBindTreeArrows} from './folder-tree-press.mjs'; // UI-폴더누르기한규칙: 폴더 누르기 = 그 자리 펼치기·접기(들어가지 않음), ←/→
import {ftFolderRowHtml} from './folder-tree-ui.mjs'; // FOLDER-나무새기준 ④: 두 손가락 벌리기 = 그 폴더만(노트·파일·사진과 같은 부품)
import {createBulkEditor,BULK_FIELDS,bulkChoices,commonValue,bulkResultText,rangeIds} from './library-bulk.js';
import {createAnchoredMenu} from './anchored-menu.js';
import {notify,NOTICE_UNDO_MS,askConfirm} from './small-notice.js';
// UI-알림창정리(자료실): 파일 열기·내려받기·Drive 열기 실패는 브라우저 기본 알림창 대신 위쪽 작은 알림(오류 5초).
const luErrorNotice=message=>notify(message,{error:true});
import {takeLibraryDocumentRequest,takeLibrarySelectionRequest} from './basket-library-send.js';
import {isHwpName,requestHwpEdit} from './hwp-drive.js';
import {pressFile,downloadFile,openInDrive,canOpenInDrive,fileAttrs,driveOpenUrl} from './file-actions.js';
import {takeLibraryUploadRequest} from './library-upload-request.js';
import {normalizeUploadMeeting,uploadMeetingLabel} from './library-upload-meeting.mjs';
import {isPhotoFile,photoUploadFields} from './activity-photo-model.mjs';
import {normalizeUploadOrganization,uploadOrganizationLabel,linkUploadedDocument} from './library-upload-organization.js';
import {pickMyOrganizations} from './my-organizations.js';
import {fileLine,bindDropTarget} from './meeting-compact.js';
import {visibleEntries,entryState,deleteLabel,isKept} from './library-prev-model.mjs';
import {documentCategories,topDocumentCategories,orderedDocumentCategories,categoryOf,topCategoryOf,categoryLabel,categoryOptions,categoryTag,loadDocumentCategories,subcategoriesOf,categoryParent,categoryLeaf} from './document-categories.js';
import {renameBody,undoSnapshot,undoBody,rowMatches,fileNameShown} from './library-rename.js';
import {markRenameHost,openRenameEditor} from './file-rename.js';
import {mountCategoryEditor} from './document-category-editor.js';
import {startAutoTextRead} from './document-text-read.js';
import {fillLibraryDocument,keptFields,originAfterEdit,autoTidyLibrary,reclassifyLibraryDocument} from './library-ai-fill.js';
import {openLibraryHtmlView} from './library-html-view.js';
import {bindLibraryDrop,groupDropTarget,placeDropTarget,runDropUpload,progressText as luDropProgressText,resultText as luDropResultText,DROP_HINT,DROP_RESULT_CLEAR_MS} from './library-drop.js';
const LU_SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const LU_KEY='sb_publishable_X-0lXJztIQUriUidBZ1PLQ_QemTRSpA';
let luSession=null,luUser=null,luWorkspace=null,luRole=null,luDocuments=[],luUploadEntries=[],luCategoryOff=new Set(),luCategorySub='',luOrganization=null,luCategoryEditor=null,luEditOriginal=null,luEditBaseline=null;
let luEditSequence=0,luEditView=0,luEditor=null,luEditObservedScope=null;const luEditAttempts=new Map();
// These tokens own only the lifetime of in-flight UI work, not deletion authority.
window.addEventListener('kptu:before-reload',event=>{if(luUploadEntries.length&&!document.querySelector('#documentModal')?.classList.contains('hidden'))event.detail.otherDraft=true});
// 로그인 세션은 runtime-client.js(KPTURuntime.session) 한 곳에서 읽고 갱신한다.
function luRead(){return window.KPTURuntime?.session?.read?.()||null}
async function luEnsure(){if(window.KPTURuntime?.session){const ok=await window.KPTURuntime.session.ensure();luSession=window.KPTURuntime.session.read();return ok}luSession=luRead();return !!luSession}
async function luApi(path,{method='GET',body=null,prefer='',expectedSessionEpoch=null,singleFlight=true,refreshSession=true}={}){if(window.KPTURuntime?.api)return window.KPTURuntime.api(path,{method,body,prefer,expectedSessionEpoch,singleFlight,refreshSession});if(!(await luEnsure()))throw new Error('로그인이 필요합니다.');const form=body instanceof FormData,h={apikey:LU_KEY,Authorization:'Bearer '+luSession.access_token};if(!form)h['Content-Type']='application/json';if(prefer)h.Prefer=prefer;const r=await fetch(LU_SB+path,{method,headers:h,body:body===null?null:(form?body:JSON.stringify(body)),cache:'no-store'});const t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(d?.message||d?.error_description||d?.hint||('요청 실패 '+r.status));return d}
function luEsc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function luSize(n){n=Number(n)||0;if(!n)return'';if(n<1024)return n+'B';if(n<1048576)return(n/1024).toFixed(1)+'KB';return(n/1048576).toFixed(1)+'MB'}
function luCatalog(){const s=window.KPTUProjectCatalog?.snapshot?.();return s?.loaded&&s.workspaceId===luWorkspace&&s.userId===luUser?.id?s:null}
async function luLoadProjects(force=false){const c=window.KPTUProjectCatalog;if(!c||!luWorkspace||!luUser?.id)return null;try{return await c.load({workspaceId:luWorkspace,userId:luUser.id,force})}catch(e){console.error('library project catalog load failed',e);return null}}
function luProjectRows(){const c=window.KPTUProjectCatalog;return (luCatalog()?.tree||[]).map(({project,depth})=>({value:project.id,label:c.label(project.name||'이름 없는 사업영역',depth),depth}))}
// PRJ-3단 (명진 결정 2, 추천안): a project chosen in the filter shows its own documents and those of every project under it
// (a 1st level → its 2nd and 3rd levels; a 2nd level → its 3rd level). A stale id (not in the tree) matches itself only.
function luProjectScope(pid){if(!pid||pid==='all')return null;const rows=luProjectRows(),i=rows.findIndex(r=>r.value===pid),out=new Set([pid]);if(i>=0)for(let j=i+1;j<rows.length&&rows[j].depth>rows[i].depth;j++)out.add(rows[j].value);return out}
function luIsSelectableProject(id){return !id||luProjectRows().some(r=>r.value===id)}
function luProjectName(id){if(!id)return'';if(!luCatalog())return'사업영역 연결';const d=window.KPTUProjectCatalog.describe(id);if(d.kind==='active')return d.name||'이름 없는 사업영역';if(d.kind==='archived')return '[보관됨] '+(d.name||'이름 없는 사업영역');if(d.kind==='legacy')return '[이전 공간] '+(d.name||'이름 없음');return '[확인할 수 없는 사업영역]'}
function luOption(value,label,selected,attrs=''){return `<option value="${luEsc(value)}"${value===selected?' selected':''}${attrs}>${luEsc(label)}</option>`}
function luIsDriveAuthError(e){return e?.status===424||/token has been expired or revoked|invalid_grant|Google Drive 토큰 갱신/i.test(String(e?.message||''))}
async function luReconnectDrive(scope){const isCurrent=scope?.isCurrent||(()=>true);if(!isCurrent())return false;if(!['owner','admin'].includes(luRole)){notify('Google Drive 연결이 만료됐어요. 관리자에게 Drive 재연결을 요청해 주세요.',{error:true});return false}try{const d=await luApi('/functions/v1/public-policy-drive',{method:'POST',body:{action:'drive-start'},...(scope?{expectedSessionEpoch:scope.expectedSessionEpoch}:{})});if(!isCurrent())return false;const url=d?.url||d?.auth_url;if(!url)throw new Error('Google Drive 연결 주소를 받지 못했어요.');location.href=url;return true}catch(e){if(isCurrent())notify(e.message||String(e),{error:true});return false}}
async function luMaybeReconnectDrive(e,scope){const isCurrent=scope?.isCurrent||(()=>true);if(!isCurrent()||!luIsDriveAuthError(e))return false;if(!['owner','admin'].includes(luRole))return false;const next=scope?'재연결 후 자료 목록과 원본 상태를 먼저 확인해 주세요.':'재연결 후 같은 작업을 다시 실행하면 됩니다.';if(!(await askConfirm(document.activeElement,{text:'Google Drive 연결이 만료됐습니다. 지금 관리자 계정을 다시 연결할까요?',note:next,ok:'다시 연결'}))||!isCurrent())return false;return await luReconnectDrive(scope)}
function luHandleDriveReturn(){const u=new URL(location.href),result=u.searchParams.get('drive');if(!result)return;const photos=u.searchParams.get('photos');if(result==='connected'&&photos==='scope_missing')setTimeout(()=>notify('Google Drive를 다시 연결했어요. 사진 권한 칸이 빠져 사진 메뉴 구글 드라이브만 권한 없음이에요(다시 연결 때 모두 체크).',{error:true}),0);else if(result==='connected')setTimeout(()=>notify('Google Drive를 다시 연결했어요. 올리기·삭제를 다시 해 주세요.'),0);else setTimeout(()=>notify('Google Drive를 다시 연결하지 못했어요. 다시 시도해 주세요.',{error:true}),0);u.searchParams.delete('drive');u.searchParams.delete('reason');u.searchParams.delete('photos');history.replaceState({},'',u.pathname+(u.searchParams.toString()?'?'+u.searchParams.toString():'')+u.hash)}

async function luContext(){if(!(await luEnsure()))return false;const shared=window.KPTURuntime?.context?.read?.()||window.__KPTU_BOOT_CONTEXT__;if(shared?.user?.id&&shared?.workspace?.id){luUser=shared.user;luWorkspace=shared.workspace.id;luRole=shared.membership?.role||null}else{luUser=await luApi('/auth/v1/user');if(!luUser?.id)return false;const ms=await luApi('/rest/v1/app_workspace_members?user_id=eq.'+luUser.id+'&select=workspace_id,role&limit=1');if(!ms?.length)return false;luWorkspace=ms[0].workspace_id;luRole=ms[0].role||null}await luLoadProjects();return true}
function luProjectOptions(selected='',{keepStale=false}={}){const rows=luProjectRows(),stale=keepStale&&selected&&!rows.some(r=>r.value===selected);return luOption('','사업영역 없음',selected)+(stale?luOption(selected,luProjectName(selected),selected,' data-lu-stale-project="1"'):'')+rows.map(r=>luOption(r.value,r.label,selected,` data-depth="${r.depth}"`)).join('')}
function luRenderUploadProject(selected){const s=document.querySelector('#docProject');if(!s)return;const current=selected??s.value??'';s.innerHTML=luProjectOptions(current);s.value=luIsSelectableProject(current)?current:'';luAreaButton(s)}
// S52-01 ③c: 사업영역 칸(#docProject·#libraryEditProject)은 값을 가진 <select>가 그대로 주인이고(다른 화면이 option을 넣고 change를 보냄),
// 화면에는 그 옆의 칸 모양 단추 하나만 보인다. 단추를 누르면 공용 고르기 창(하나만, 맨 위 '사업영역 없음')이 뜨고, 고르면 <select> 값을 바꾸고
// change를 보낸다. 단추 글자는 고른 사업영역('상위 › 하위') 또는 '사업영역 없음'. 값을 바꾸는 곳은 모두 luAreaButton/luPaintAreaButton을 부른다.
const luAreaPath=id=>{const rows=luCatalog()?.tree||[];return id&&rows.length?areaChipText(areaTree(catalogAreas(rows)),'p:'+id):''};
function luPaintAreaButton(select){const b=select?._luAreaBtn;if(!b)return;const v=select.value||'',name=v?(luAreaPath(v)||select.selectedOptions?.[0]?.textContent||luProjectName(v)):'사업영역 없음';b.textContent=name;b.title=v?name:'';b.classList.toggle('is-empty',!v);b.setAttribute('aria-label','사업영역: '+name);b.disabled=!!select.disabled}
function luAreaButton(select){
  if(!select)return;
  if(!select._luAreaBtn){const b=document.createElement('button');b.type='button';b.className='secondary field-btn lu-area-pick';b.setAttribute('aria-haspopup','dialog');b.setAttribute('aria-expanded','false');select.hidden=true;select.after(b);select._luAreaBtn=b;
    select.addEventListener('change',()=>luPaintAreaButton(select));b.addEventListener('click',()=>void luOpenAreaPick(select,b))}
  luPaintAreaButton(select);
}
async function luOpenAreaPick(select,button){
  if(button.disabled)return;
  if(!luCatalog())await luLoadProjects();
  const rows=luCatalog()?.tree||[],used=await usedKeysNow().catch(()=>[]);
  if(!button.isConnected||!select.isConnected)return;
  const v=select.value||'';
  await openAreaOrgPicker({kind:'area',trigger:button,areas:catalogAreas(rows),selected:v?['p:'+v]:[],used,multi:false,none:true,
    onCommit:keys=>{if(!select.isConnected)return;const k=[...keys][0]||'',id=k.startsWith('p:')?k.slice(2):'';if(id&&![...select.options].some(o=>o.value===id))select.add(new Option(luProjectName(id),id));select.value=id;select.dispatchEvent(new Event('change',{bubbles:true}))}});
}
// LIB-토글트리: 프로젝트 칩 줄([프로젝트]·[세부])은 트리가 대신한다. #documentProject는 다른 화면(프로젝트 상세의 자료 "전체 보기")이
// 프로젝트 하나로 걸러 열 때만 보이는 한 줄 [전체 | 그 프로젝트]이다(담당조직 거르기와 같은 모양). 값(host.value)은 그대로 프로젝트 id다.
function luRenderProjectFilter(){
  const host=document.querySelector('#documentProject');if(!host)return;
  if(!host._luChips){const s=document.createElement('span');s.className='lu-filter-label';s.setAttribute('aria-hidden','true');s.textContent='사업영역';host._luChips=document.createElement('div');host.replaceChildren(s,host._luChips)}
  const pid=host.value&&host.value!=='all'?host.value:'';
  if(!pid){host.value='all';host.hidden=true;return}
  host.hidden=false;
  const d=window.KPTUProjectCatalog?.describe?.(pid),parent=d?.kind==='active'&&d.project?.parent_id?window.KPTUProjectCatalog.describe(d.project.parent_id):null;
  const name=d?.kind==='active'?(parent?.name?parent.name+' › ':'')+(d.name||'이름 없는 사업영역'):luProjectName(pid);
  renderFilterChips(host._luChips,{label:'사업영역 필터',controls:'documentList',small:true,value:pid,options:[{value:'all',label:'전체'},{value:pid,label:name}],onChange:value=>{host.value=value;luRenderLibrary()}});
  host.value=pid;
}
// UI-바구니첨부메모 ⑪: 거르는 칩은 분류 7개(저장 값은 그대로, 화면에서 7개로 대응).
// UI-PC자료실 C: 자료 분류 칩은 여러 개를 함께 켜고 끈다(aria-pressed). 자료실에 들어올 때마다 기본 상태 = [회의]만 꺼짐.
// [전체]는 모두 켜졌을 때 눌림으로 보이고, 누르면 모두 켬 ↔ 기본 상태. 꺼 둔 분류는 이름으로 기억해 새로 만든 분류는 켜진 채로 보인다.
const LU_DEFAULT_OFF=Object.freeze(['회의']);
// 다른 화면이 담당조직으로 걸러 자료실을 열 때는 모든 분류를 켠 채 들어온다(들어올 때의 기본 상태 대신).
let luEnterAllOn=false;
// LIB-보기기억(2026-10-23 사용자 요청 11:47): 들어올 때의 기본 상태 = 서버에 기억해 둔 종류 칩(없으면 [회의]만 꺼짐). 묶기도 같다.
// luRemembered = 마지막으로 읽거나 저장한 {groupBy?, categoriesOff?}. luViewHold = 이번 방문에서 사용자가 고르거나 다른 화면이 정해 준 뒤라 서버 값으로 덮지 않는다.
let luRemembered=null,luViewHold=false,luViewOwner='',luViewTimer=0,luViewChain=Promise.resolve();const luViewPending=new Set();
const luDefaultOff=()=>new Set(luRemembered?.categoriesOff??LU_DEFAULT_OFF);
// LIB-폴더로옮기기: '최근 넣은 폴더'(맨 앞이 가장 최근, 최대 5). 서버(app_profiles.library_view.recent_folders)에 기억하고, 서버가 아직 그 칸을 받지 못하면(DB 적용 전) 이번 방문 동안만 화면에 둔다.
let luRecentFolders=[],luRecentRejected=false;
// LIB-폴더보기 칩 순서(08:25 ②, 11:53 결정 ①): 묶기 칩 순서. 처음은 [폴더] 맨 앞. 꾹 눌러(PC는 끌어) 옮기면 서버(library_view.group_order)에 기억하고,
// 서버가 아직 그 칸을 받지 못하면(DB 적용 전) 이번 방문 동안만 화면에 둔다. null = 고른 적 없음(기본 순서).
let luGroupOrder=null,luOrderRejected=false;
let luFindOpen=false;// LIB-위쪽한줄 가안: 폰 찾기 칸을 ⌕로 연 상태(메모리만)
function luPushRecentFolder(id){luRecentFolders=rememberFolder(luRecentFolders,id);luViewPending.add('recent');clearTimeout(luViewTimer);luViewTimer=setTimeout(luFlushView,400)}
// 걸러 보는 중인지 가를 때 비교하는 '들어올 때의 칩 상태'(고른 칩이 이것과 다르면 맞는 자료가 든 토글을 펼친다).
let luBaselineOff=new Set(LU_DEFAULT_OFF);
function luResetCategories(){luCategorySub='';luCategoryOff=luEnterAllOn?new Set():luDefaultOff();luBaselineOff=luDefaultOff();luEnterAllOn=false}
luResetCategories();
// 분류 칩 기본 상태는 다른 화면에서 자료실로 들어올 때만 되돌린다. 로그인 정보 갱신 등으로 자료실을 그대로 다시 그릴 때는 고른 칩을 지킨다.
let luEntering=false;
// LIB-소분류: 칩 줄은 큰 분류만이고, 큰 분류 하나만 켜면 그 아래 소분류 줄(category-chips.js). 고른 소분류(luCategorySub)는 자료실을 보는 동안만 기억한다
// (서버에 기억하는 건 큰 분류 칩 상태뿐). 자료는 '숨길 분류 모음'(전체 이름)으로 거른다.
const luHiddenCategories=()=>hiddenCategories(topDocumentCategories(),luCategoryOff,luCategorySub);
const luCategoryShown=(name,hidden=luHiddenCategories())=>!hidden.has(name);
// LIB-거르기전체(2026-10-23 사용자 확정 11:46): [전체]는 맨 앞 칩. 모두 켜졌으면 누르면 모두 끄고, 일부만 켜졌거나 모두 꺼졌으면 누르면 모두 켠다.
// 일부만 켜진 상태는 칩이 반쯤 찬 모양(aria-pressed="mixed"). 모두 끄면 목록 자리에 '고른 분류 없음' 한 줄.
// 사용자가 묶기·종류 칩을 고르면 0.4초 뒤 서버에 기억한다(바꾼 칸만 새로 쓰고 나머지는 기억해 둔 값 그대로). 못 쓰면(칸이 아직 없음 등) 화면은 그대로 동작한다.
function luUserChangedView(field){luViewHold=true;luViewPending.add(field);clearTimeout(luViewTimer);luViewTimer=setTimeout(luFlushView,400)}
function luFlushView(){
  clearTimeout(luViewTimer);luViewTimer=0;
  if(!luViewPending.size||!luViewOwner)return;
  const fields=new Set(luViewPending);luViewPending.clear();
  const next={};
  // LIB-폴더묶기기억(2026-10-26 사용자 결정 '기억'): 폴더 묶기도 다른 묶기와 똑같이 서버에 저장한다.
  const previous=luRemembered;
  const group=fields.has('groupBy')?luGroupBy:luRemembered?.groupBy;if(group!==undefined)next.groupBy=group;
  const off=fields.has('categories')?topDocumentCategories().filter(n=>luCategoryOff.has(n)):luRemembered?.categoriesOff;if(off!==undefined)next.categoriesOff=off;
  if(!luRecentRejected&&(luRecentFolders.length||luRemembered?.recentFolders!==undefined))next.recentFolders=[...luRecentFolders];
  if(!luOrderRejected&&luGroupOrder)next.groupOrder=[...luGroupOrder];
  luRemembered=next;
  luViewChain=luViewChain.then(async()=>{
    let sent=next,result=await saveView(sent);
    // DB 검사가 아직 recent_folders를 받지 않는 서버(적용 전)면 400이다. 그 칸만 빼고 다시 보내 묶기·종류 칩 기억은 지키고, 최근 폴더는 이번 방문 동안만 화면에 둔다.
    // group_order도 같다(20261028140000 적용 전): 그 칸만 빼고 다시 보내고 칩 순서는 이번 방문 동안만.
    if(result.status==='pending'&&sent.groupOrder!==undefined){luOrderRejected=true;sent={...sent};delete sent.groupOrder;luRemembered=sent;result=await saveView(sent)}
    if(result.status==='pending'&&sent.recentFolders!==undefined){luRecentRejected=true;sent={...sent};delete sent.recentFolders;luRemembered=sent;result=await saveView(sent)}
    // DB 검사가 아직 '폴더'를 받지 않는 서버(적용 전)면 400이다. 폴더만 빼고(앞서 기억한 묶기 그대로) 다시 보내 종류 칩 기억은 지키고, 폴더는 이번 방문 동안만 유지한다(luSessionFolder).
    if(result.status==='pending'&&sent.groupBy==='folder'){
      const fallback={...sent};if(previous?.groupBy!==undefined)fallback.groupBy=previous.groupBy;else delete fallback.groupBy;
      luRemembered=fallback;result=await saveView(fallback);
    }
    if(result.status==='error')console.warn('library view not saved');
  }).catch(()=>{});
}
// 자료실에 들어올 때(그리고 처음 열 때) 서버의 기억을 다시 읽어, 그 사이 다른 기기에서 바꾼 것을 맞춘다. 읽는 동안 사용자가 이미 골랐으면 그대로 둔다.
// 서버에 기억된 묶기가 폴더인가. 폴더 표를 읽기 전에 기억이 먼저 도착해도 읽은 뒤 맞춘다(luApplyRememberedFolder).
let luWantFolder=false;
function luApplyRememberedFolder(){
  if(!luWantFolder||!luFoldersReady||luViewHold||luGroupBy==='folder')return;
  luGroupBy='folder';luSessionFolder=true;luOpened.clear();luFilterOpen.clear();luShowAll.clear();
}
async function luRefreshView(){
  const owner=luUser?.id;if(!owner)return;
  if(luViewOwner&&luViewOwner!==owner){luRemembered=null;luRecentFolders=[];luRecentRejected=false;luGroupOrder=null;luOrderRejected=false}
  luViewOwner=owner;
  // 아직 보내지 못한 고른 값이 있으면 먼저 보내고 끝나길 기다린 뒤 읽는다(방금 고른 값을 옛 서버 값으로 덮지 않게).
  luFlushView();await luViewChain;
  const result=await readView();
  if(result.status!=='ok'||luUser?.id!==owner||luViewHold||luViewPending.size)return;
  luRemembered=result.view;luBaselineOff=luDefaultOff();
  if(result.view.recentFolders!==undefined)luRecentFolders=cleanRecentFolders(result.view.recentFolders);
  let changed=false;
  if(result.view.groupOrder!==undefined&&!luViewPending.has('groupOrder')){const next=orderedGroups(result.view.groupOrder);if(JSON.stringify(next)!==JSON.stringify(orderedGroups(luGroupOrder))){luGroupOrder=next;changed=true}}
  luWantFolder=result.view.groupBy==='folder';
  // 폴더 표가 아직 없거나 못 읽었으면 폴더 묶기는 열 수 없어 프로젝트로 연다.
  const group=luFoldersReady&&(luSessionFolder||luWantFolder)?'folder':(luWantFolder?'project':(result.view.groupBy||'project'));
  if(group!==luGroupBy){luGroupBy=group;luOpened.clear();luFilterOpen.clear();luShowAll.clear();if(group==='organization')luLoadOrganizations();changed=true}
  if(!luOrganization){const next=luDefaultOff(),same=next.size===luCategoryOff.size&&[...next].every(n=>luCategoryOff.has(n));if(!same){luCategoryOff=next;changed=true}}
  if(changed)luRenderLibrary();
}
// LIB-위쪽한줄(11/09 명진 B·가안): 자료실 분류는 폰·폴드·PC 모두 위 줄 [분류: … ▾] 하나다(칩 줄·줄 끝 '✎ 분류 수정'은 없앴다).
// 단추 글자는 지금 상태(luCategoryOff·luCategorySub)에서 만들고, 분류마다 자료 수(LIB-맨위다듬기 S53-18: 찾기·사업영역·담당조직으로 거른 자료 중
// 그 큰 분류(소분류 포함)의 수, 분류로 거르기 전 숫자라 꺼 둔 분류도 켜면 몇 개가 보일지 안다. 0도 보인다)는 [분류 ▾] 창 줄 끝에 작게 보인다.
let luCatCounts=null;
function luRenderCategoryFilter(counts=null){
  luCatCounts=counts;
  const pick=document.querySelector('#libraryCategoryPick');
  if(pick){const names=topDocumentCategories(),sub=activeSubcategory(names,luCategoryOff,luCategorySub);const text=pickLabel(names,luCategoryOff,sub?categoryLabel(sub):'');if(pick.dataset.label!==text){pick.dataset.label=text;pick.innerHTML=`<span class="lu-cat-pick-text">${luEsc(text)}</span>`;}}
}
// [분류 ▾] 고르기 창: 공용 고르기 창(choice-sheet.js — 폰은 아래에서 올라오는 판, 폴드 펼침·PC 폭은 단추 아래 작은 창) 하나.
// 줄을 누르면 창 안에서만 바뀌고 [적용]을 눌러야 자료실에 걸린다(기억은 지금처럼 서버 library_view.categories_off). [✎ 분류 수정]은 분류 수정 창.
let luCatSheet=null,luCatPending=null;
function luCategorySheet(){
  if(luCatSheet)return luCatSheet;
  const parentOf=name=>categoryParent(name);
  luCatSheet=createChoiceSheet({id:'libraryCategorySheet',titleId:'libraryCategorySheetTitle',historyKey:'kptuLibraryCategory',
    canOpen:()=>window.KPTURouter?.current==='library',choices:async()=>{},
    render:()=>{
      const count=value=>{const n=value==='all'?(luCatCounts?[...luCatCounts.values()].reduce((x,y)=>x+y,0):null):luCatCounts?.get(value);return n==null?'':`<span class="lu-cat-sheet-count" data-lu-cat-count>${n}</span>`};
      const row=(value,label,depth=0)=>`<button type="button" class="home-choice-row home-choice-pick" style="--home-choice-depth:${depth}" data-depth="${depth}" data-sheet-value="${luEsc(value)}" aria-pressed="false"><span class="home-choice-check" aria-hidden="true"></span><span class="home-choice-name">${luEsc(label)}</span>${depth?'':count(value)}</button>`;
      const rows=[row('all','전체'),...chipOrder(topDocumentCategories()).flatMap(name=>[row(name,name),...subcategoriesOf(name).map(s=>row('sub:'+s,categoryLeaf(s),1))])];
      return {title:'분류 선택',html:`<div class="lu-cat-sheet-tools"><button type="button" class="lu-cat-sheet-clear" data-lu-cat-clear>모두 풀기</button></div><div class="lu-cat-sheet-list">${rows.join('')}</div>`};
    },
    onSelect:(_kind,value)=>{if(luCatPending)luCatPending=togglePick(luCatPending,value,parentOf)},
    multi:()=>luCatPending&&{pressed:value=>isPicked(luCatPending,value),label:pickCount(luCatPending)},
    onCommit:()=>{
      if(!luCatPending)return;const names=topDocumentCategories(),next=offFrom(names,luCatPending.picked),sub=luCatPending.sub||'';
      luCatPending=null;luUserChangedView('categories');luCategoryOff=next;luCategorySub=sub;luRenderLibrary();
    }});
  const el=document.getElementById('libraryCategorySheet');el.classList.add('lu-cat-sheet');
  const save=el.querySelector('[data-sheet-save]');if(save)save.textContent='적용';
  const foot=el.querySelector('[data-sheet-foot]');
  if(foot&&!foot.querySelector('[data-lu-cat-edit]'))foot.insertAdjacentHTML('afterbegin','<button type="button" class="secondary lu-cat-sheet-edit" data-lu-cat-edit aria-label="분류 수정"><span aria-hidden="true">✎ </span>분류 수정</button>');
  el.addEventListener('click',e=>{
    if(e.target.closest('[data-lu-cat-clear]')){if(luCatPending){luCatPending={picked:[],sub:''};luCatSheet.sync()}return}
    if(e.target.closest('[data-lu-cat-edit]')){luCatPending=null;void luCatSheet.close().then(()=>luManage())}
  });
  return luCatSheet;
}
function luOpenCategorySheet(trigger){
  const names=topDocumentCategories(),sub=activeSubcategory(names,luCategoryOff,luCategorySub);
  luCatPending={picked:sub?[categoryParent(sub)]:pickedFrom(names,luCategoryOff),sub};
  void luCategorySheet().open('category',trigger);
}
// UI-바구니첨부메모 PR 3 ⑩: 담당조직 상세의 "전체 N개 보기"로 열면 자료실을 그 조직으로 거른다(새 화면 없음). [전체]를 누르면 거르기를 푼다.
function luRenderOrganizationFilter(){
  const host=document.querySelector('#libraryOrganizationFilter');if(!host)return;
  host.hidden=!luOrganization;if(!luOrganization)return;
  renderFilterChips(host,{label:'담당조직 필터',controls:'documentList',small:true,value:luOrganization.id,options:[{value:'all',label:'전체'},{value:luOrganization.id,label:luOrganization.name||'담당조직'}],onChange:value=>{if(value==='all')luOrganization=null;luRenderLibrary()}});
}
// 다른 화면에서 자료실을 한 조직으로 걸러 연다. 검색·프로젝트·분류 거르기는 비우고 보여 준다.
function luShowOrganization(id,name){
  luOrganization=typeof id==='string'&&id?{id,name:String(name||'')}:null;luCategoryOff=new Set();luCategorySub='';luViewHold=true;luEnterAllOn=window.KPTURouter?.current!=='library';
  const search=document.querySelector('#documentSearch'),project=document.querySelector('#documentProject');if(search)search.value='';luFindOpen=false;if(project)project.value='all';
  luRenderLibrary();
}
// PRESS-자료실편입: 옛 성명·보도자료 주소(?view=media)로 들어오면 종류 하나만 켠 모아보기로 연다(라우터가 건넨 요청을 한 번만 받는다). 검색·프로젝트·담당조직 거르기는 비운다.
function luApplyEntry(){
  const entry=window.KPTURouter?.takeEntry?.('library');if(!entry?.category)return;
  luOrganization=null;luCategorySub='';luCategoryOff=new Set(topDocumentCategories().filter(name=>name!==topCategoryOf(entry.category)));luViewHold=true;
  const search=document.querySelector('#documentSearch'),project=document.querySelector('#documentProject');if(search)search.value='';luFindOpen=false;if(project)project.value='all';
  luRenderLibrary();
}
// 분류 목록이 바뀌면(추가·이름 바꾸기·삭제, 다른 화면에서 읽어 옴): 등록·수정 창의 고르기 목록을 새로 그린다. 꺼 둔 분류는 이름으로 기억하므로 따로 맞추지 않는다.
function luRenderUploadCategory(){const s=document.querySelector('#docCategory');if(!s)return;const keep=s.value;s.innerHTML=categoryOptions('',{empty:'자동 분류'});s.value=documentCategories().includes(keep)?keep:'';}
function luOnCategoriesChanged(){
  luRenderUploadCategory();
  const edit=document.querySelector('#libraryEditCategory'),modal=document.querySelector('#libraryEditModal');
  if(edit&&modal&&!modal.classList.contains('hidden')){const keep=edit.value;edit.innerHTML=categoryOptions(keep);}
  else if(edit)edit.innerHTML=categoryOptions('');
  luRenderLibrary();
}
function luRenderEditProject(){const s=document.querySelector('#libraryEditProject'),m=document.querySelector('#libraryEditModal');if(!s||!m||m.classList.contains('hidden'))return;s.innerHTML=luProjectOptions(s.value||'',{keepStale:true});luAreaButton(s)}
function luOnProjectsChanged(){luRenderUploadProject();luRenderEditProject();luRenderLibrary()}
// UI-회의결과창정리: 고른 파일은 한 줄씩(종류·이름·크기·상태·×).
function luRenderSelectedFiles(){const box=document.querySelector('#librarySelectedFiles');if(!box)return;if(!luUploadEntries.length){box.innerHTML='';return}box.innerHTML=luUploadEntries.map((entry,index)=>{const file=entry.file,state=entry.kind||'pending',label=entry.label||'선택됨';return fileLine({name:file?.name||'파일',meta:luSize(file?.size||0),state,label,attrs:` data-lu-upload-file="${index}"`,stateAttr:'data-lu-upload-state',end:state==='success'?'':`<button class="icon-btn file-line-x" type="button" data-lu-remove-file="${index}" aria-label="${luEsc(file?.name||'파일')} 선택 취소"${luUploading?' disabled':''}>×</button>`})}).join('');luPaintUploadLines()}
// ORG-자료올리기: 담당조직 상세의 자료 [+]가 같은 올리기 창을 열 때만 값이 있다(창을 새로 열면 지워진다). 올라온 자료는 그 조직에 바로 붙는다.
let luUploadOrg=null;
function luRenderUploadOrg(){const picker=document.querySelector('#documentModal .library-file-block');if(!picker)return;let p=picker.querySelector('#libraryUploadOrg');if(!luUploadOrg){p?.remove();return}if(!p){p=document.createElement('p');p.id='libraryUploadOrg';p.className='status ok';picker.querySelector('#librarySelectedFiles')?.insertAdjacentElement('beforebegin',p)}p.textContent=uploadOrganizationLabel(luUploadOrg)}
function luSetUploadOrg(org){luUploadOrg=normalizeUploadOrganization(org);luRenderUploadOrg()}
// MEET-파일AI분류: 사업 보고 상세의 자료 [+]·끌어다 놓기도 같은 올리기 창을 연다. 올라온 자료는 library-files의 meeting_id 칸으로 그 사업 보고에 바로 붙는다
// (기존 서버 기능, 서버 변경 없음). 창을 새로 열면 지워진다. 분류·제목·날짜는 AI 자동 채우기(luAiFill)가 프로젝트·담당조직 올리기와 똑같이 채운다.
// ORG-자료더하기먹통: 자료 등록 창을 여는 한 길. 다른 화면 버튼(#newDocumentBtn)을 .click()으로 대신 누르지 않고, 그 버튼이 쓰는 같은 열기 함수(team.js)를 직접 부른다.
// 창을 새로 열 때 지우는 값(고른 파일·사업영역·담당조직·사업 보고)은 버튼을 눌렀을 때와 똑같이 지운다. 창이 열렸으면 true.
function luOpenUploadWindow(){const open=window.KPTUDocumentModal?.open;if(typeof open!=='function')return false;luResetUploadSelection();luRenderUploadProject('');luSetUploadOrg(null);luSetUploadMeeting(null);luSetUploadFolder(null);open();return true}
let luUploadMeeting=null;
function luRenderUploadMeeting(){const picker=document.querySelector('#documentModal .library-file-block');if(!picker)return;let p=picker.querySelector('#libraryUploadMeeting');if(!luUploadMeeting){p?.remove();return}if(!p){p=document.createElement('p');p.id='libraryUploadMeeting';p.className='status ok';picker.querySelector('#librarySelectedFiles')?.insertAdjacentElement('beforebegin',p)}p.textContent=uploadMeetingLabel(luUploadMeeting)}
function luSetUploadMeeting(meeting){luUploadMeeting=normalizeUploadMeeting(meeting);luRenderUploadMeeting()}
// S55-15 LIB-두칸보기 남은 것(11/09 결정 '빈 자리 우클릭 [새 폴더][자료 등록]은 그 칸의 지금 폴더'): 빈 자리 우클릭·맨 위 [＋]로 연 [자료 등록] 창은
// 연 자리의 폴더(두 칸이면 그 칸의 지금 폴더, 한 칸이면 들어가 있는 폴더)로 넣는다. 폴더 모델은 자료실 폴더 표 하나(luFolders_ · 폴더 부품 putUploaded —
// 끌어다 놓아 올리기와 같은 소유자 쓰기). 새 상태 저장소 없음: 담당조직·사업 보고처럼 이 창이 열려 있는 동안만 값이 있고, 창을 새로 열면 지워진다.
let luUploadFolder=null;
function luRenderUploadFolder(){const picker=document.querySelector('#documentModal .library-file-block');if(!picker)return;let p=picker.querySelector('#libraryUploadFolder');if(!luUploadFolder){p?.remove();return}if(!p){p=document.createElement('p');p.id='libraryUploadFolder';p.className='status ok';picker.querySelector('#librarySelectedFiles')?.insertAdjacentElement('beforebegin',p)}p.textContent=`‘${luUploadFolder.name}’ 폴더에 넣어요`}
function luSetUploadFolder(id){const f=id?luFolders_.find(x=>x.id===id):null;luUploadFolder=f?{id:f.id,name:String(f.name||'폴더')}:null;luRenderUploadFolder()}
// 지금 연 자리의 폴더(폴더 보기가 아니거나 폴더 밖·자료실 전체면 null). el이 두 칸 중 한 칸 안이면 그 칸, 아니면 지금 칸.
function luOpenedFolder(el=null){if(luGroupBy!=='folder'||!luFoldersReady)return null;return (luTwoActive()?luTwo.folderAt(el):luInFolder)||null}
function luStartUploadForMeeting(meeting,files=[]){if(!normalizeUploadMeeting(meeting)||luUploading||!luOpenUploadWindow())return false;luSetUploadMeeting(meeting);const list=Array.from(files||[]);if(list.length)luSetSelectedFiles(list);return true}
// 창 없이 올리기(새 사업 보고를 저장한 뒤 고른 파일, 사업 보고 사진 줄): 같은 library-files 요청 + 같은 AI 채우기. 실패하면 던진다(호출한 쪽이 개수를 센다).
// ACT-사진 3단계: 사진은 AI에 보내지 않는다. 제목(파일 이름)·종류(사업 보고 칸을 따라감)·날짜(사업 보고 날짜)를 요청에 실어 AI 채우기를 건너뛴다. 서버(library-files)는 이미 이 값을 받는다.
async function luUploadFileForMeeting(meeting,file){const target=normalizeUploadMeeting(meeting);if(!target)throw new Error('사업 보고를 확인하지 못했어요.');const fd=new FormData();try{fd.append('file',await window.KPTURuntime.copyUploadFile(file));fd.append('meeting_id',target.id);if(target.projectId)fd.append('project_id',target.projectId);const photo=isPhotoFile(file);if(photo)for(const [key,value] of Object.entries(photoUploadFields(file,target,documentCategories())))fd.append(key,value);const d=await luUploadRequest(fd,file);if(d?.error||!d?.document)throw new Error(d?.error||'자료 업로드 응답을 확인하지 못했어요.');if(!photo)luAiFill(d.document.id,fd,file.name);return d.document}finally{fd.delete('file')}}
// 담당조직 상세의 자료 [+]·끌어다 놓기: 프로젝트 상세의 [+]처럼 이 올리기 창을 열고, 올라온 자료를 그 조직에 붙인다. 파일이 있으면 미리 골라 둔다.
function luStartUploadForOrganization(org,files=[]){if(!normalizeUploadOrganization(org)||luUploading||!luOpenUploadWindow())return false;luSetUploadOrg(org);const list=Array.from(files||[]);if(list.length)luSetSelectedFiles(list);return true}
// 프로젝트 상세의 자료 [+]: 같은 올리기 창을 열고 그 사업영역을 미리 고른다.
function luStartUploadForProject(project){const id=project?.id;if(!id||luUploading||!luOpenUploadWindow())return false;const s=document.querySelector('#docProject');if(!s)return true;if(![...s.options].some(o=>o.value===id))s.add(new Option(project.name||'',id));s.value=id;s.dispatchEvent(new Event('change',{bubbles:true}));return true}
// ---- FILES-자료실로보내기(S52-26, 시안 docs/design/mockups/files-to-library.html, 명진 11/07 11:41 '(가) 연결만') ----
// [파일]의 파일을 이 자료 등록 창(같은 칸·같은 [등록])으로 받는다. 원드라이브·이 폰 파일은 [파일]이 바이트를 받아 File로 넘기고(자료실 Drive
// 폴더에 사본 — 보통 올리기와 같은 길·같은 막대·%), 구글 드라이브 파일은 {link:{source:'gd',id}}로 넘겨 사본 없이 연결만 한다
// (document-actions register-drive-file: 서버가 그 사람 작업공간 [파일] 색인·Drive 원본을 확인하고 같은 원본을 가리키는 자료 행 하나).
// 연결한 뒤 창에 쓴 칸(제목·분류·사업영역·출처·날짜·태그·설명)은 자기 로그인(owner RLS)으로 그 자료에 적고, 빈 칸은 AI가 채운다(luAiFill).
// 같은 파일 두 번: 구글은 같은 원본 자료(서버도 exists), 사본은 이름·크기가 같은 자료가 있으면 넣지 않고 '이미 자료실에 있어요'.
const LU_LINK_LABEL='연결만(사본 없음)';
const LU_LINK_FIELDS={title:'#docTitle',category:'#docCategory',source:'#docSource',document_date:'#docDate',tags:'#docTags',project_id:'#docProject',description:'#docDescription'};
async function luLinkDriveEntry(entry,{many=false}={}){
  luSetFileStatus(entry,'uploading','연결하는 중');
  let data;
  try{data=await luApi('/functions/v1/document-actions',{method:'POST',body:{action:'register-drive-file',drive_file_id:entry.link.id},singleFlight:false,refreshSession:false})}
  catch(e){
    const status=Number(e?.status)||0;
    if(status===401||e?.code==='session_required')return {ok:false,failure:{type:'session',retry:true,...LU_UPLOAD_FAILURES.session}};
    // 400: 서버가 아무것도 쓰기 전에 거절(문구는 서버의 짧은 한국어). 그 밖(503·끊김): 연결됐을 수 있어 다시 보내지 않는다.
    if(status===400)return {ok:false,failure:{type:'invalid',kind:'error',label:'실패',retry:false,message:/[가-힣]/.test(e?.message||'')?e.message:LU_UPLOAD_FAILURES.invalid.message}};
    return {ok:false,failure:{type:'unknown_network',retry:true,...LU_UPLOAD_FAILURES.unknown_network,message:'자료실에 연결했는지 확인하지 못했어요. 다시 보내지 말고 자료실 목록에서 먼저 확인해 주세요.'}};
  }
  const id=typeof data?.document?.id==='string'?data.document.id:'';
  if(data?.ok!==true||!id||!['created','exists'].includes(data.result))return {ok:false,failure:{type:'unknown_network',retry:true,...LU_UPLOAD_FAILURES.unknown_network,message:'자료실에 연결했는지 확인하지 못했어요. 자료실 목록에서 먼저 확인해 주세요.'}};
  if(data.result==='exists'){entry.failure=null;luSetFileStatus(entry,'success','이미 자료실에 있어요');return {ok:true,created:false,id}}
  // 창에 쓴 칸만 그 자료에 적는다(올리기의 FormData 칸과 같은 이름·같은 규칙: 여러 개면 제목은 비움).
  const fd=new FormData(),body={};
  for(const [k,sel] of Object.entries(LU_LINK_FIELDS)){if(k==='title'&&many)continue;const raw=document.querySelector(sel)?.value??'',v=typeof raw==='string'?raw.trim():raw;if(!v)continue;fd.append(k,v);body[k]=k==='tags'?v.split(',').map(x=>x.trim()).filter(Boolean):v}
  if(luUploadMeeting){body.meeting_id=luUploadMeeting.id;if(!body.project_id&&luUploadMeeting.projectId)body.project_id=luUploadMeeting.projectId}
  let projectId=body.project_id||null,noted=true;
  if(Object.keys(body).length){
    try{const rows=await luApi(`/rest/v1/app_documents?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(luWorkspace)}&select=id,project_id`,{method:'PATCH',body:{...body,updated_at:new Date().toISOString()},prefer:'return=representation',singleFlight:false});noted=Array.isArray(rows)&&rows.length===1&&rows[0]?.id===id}
    catch{noted=false}
  }
  const file=entry.file;luAiFill(id,fd,file.name);
  entry.failure=null;luSetFileStatus(entry,'success',noted?'연결함':'연결함 · 칸은 [정보 수정]에서');
  return {ok:true,created:true,id,projectId};
}
// 다른 화면([파일])이 고른 파일들로 자료 등록 창을 연다. 이미 자료실에 있는 것은 넣지 않고 돌려준다(부른 곳이 '이미 자료실에 있어요 · 보기').
// 돌려줌 {opened, already:[{name,id}]}. 창이 이미 올리는 중이면 열지 않는다.
function luStartUploadFromFiles(items=[]){
  const list=Array.from(items||[]).filter(Boolean),already=[],take=[];
  for(const item of list){
    const hit=item.link?luDocuments.find(d=>d.file_id===item.link.id):luDocuments.find(d=>d.file_name===item.name&&Number(d.file_size)===Number(item.size));
    if(hit)already.push({name:String(item.name||''),id:hit.id});else take.push(item);
  }
  if(!take.length||luUploading||!luOpenUploadWindow())return {opened:false,already};
  luSetSelectedFiles(take);
  luSetStatus(document.querySelector('#documentStatus'),take.some(x=>x.link)?'[파일]에서 넣었어요. 구글 드라이브 파일은 사본 없이 연결만 해요.':'[파일]에서 넣었어요.');
  return {opened:true,already};
}
// UI-올리기진행표시 ②: 고른 파일 줄은 그대로 두고, 올리는 동안 그 줄 안에 공용 막대 + % + ✕(paintUploadLine). 위 합계 줄·'느려요'는 공용 올리는 줄(compact).
function luPaintUploadLines(){const box=document.querySelector('#librarySelectedFiles');if(!box||typeof box.querySelectorAll!=='function')return;box.querySelectorAll('[data-lu-upload-file]').forEach(row=>{const entry=luUploadEntries[Number(row.dataset.luUploadFile)];paintUploadLine(row,entry?.kind==='uploading'?entry.file:null)})}
function luMountUploadProgress(picker){const host=picker.querySelector('[data-lu-upload-progress]');if(!host||host.dataset.mounted)return;host.dataset.mounted='1';mountUploadRows(host,{compact:true,failed:false,has:job=>luUploadEntries.some(entry=>entry.file===job.file)});watchUploads(()=>{if(host.isConnected)luPaintUploadLines()})}
function luSetSelectedFiles(files){if(luUploading)return;luUploadEntries=Array.from(files||[]).map(file=>file?.link?{file:{name:String(file.name||'파일'),size:Number(file.size)||0,type:String(file.type||'')},link:file.link,kind:'pending',label:LU_LINK_LABEL}:{file,kind:'pending',label:'선택됨'});const input=document.querySelector('#libraryFileInput');if(input)input.value='';luRenderSelectedFiles()}
// LIB-화면끌어놓기 (2026-10-26): 자료실을 연 PC 화면 어디에 놓아도 [+ 자료 등록]을 아무것도 지정하지 않고 누른 것과 같게 바로 올린다
// (library-files 같은 요청, 제목은 파일 이름, 분류는 AI 자동 정리 luAiFill). 등록 창·수정 창이 열려 있으면 그 창의 놓기 칸이 먼저라서 여기서는 받지 않는다. 모바일은 그대로.
// S53-19: 받는 폭은 칸 나누기 공용 판정(600px~, screen-width.mjs)과 같게. 옛 '760px 이하 = 폰'은 펼친 폴드(약 673~707px)의 두 칸 보기에서 놓기를 꺼 두었다.
let luDropRun=null,luDropClearTimer=0;
const LU_NARROW=typeof matchMedia==='function'?matchMedia(NARROW_QUERY):null;
const luDropActive=()=>window.KPTURouter?.current==='library'&&!LU_NARROW?.matches&&!floatingWindowOpen(document)&&(!luUploading||!!luDropRun);
function luDropStatus(text,{error=false,busy=false}={}){const st=document.querySelector('#libraryDropStatus');if(!st)return;clearTimeout(luDropClearTimer);st.textContent=text||'';st.hidden=!text;st.classList.toggle('error',!!error);st.setAttribute('aria-busy',busy?'true':'false');st.setAttribute('role',error?'alert':'status');if(text&&!error&&!busy)luDropClearTimer=setTimeout(()=>luDropStatus(''),DROP_RESULT_CLEAR_MS)}
// S46-25: value({field,value})가 있으면 그 값을 달아 올린다. 사업영역·분류는 [+ 자료 등록]과 같은 요청 칸(project_id·category, 서버가 사업영역 권한을 다시 봄),
// 담당조직은 담당조직 상세 [+]와 같은 연결(linkUploadedDocument, DB가 같은 작업공간 조직만 받음). AI 채우기는 그 뒤에 시작해 사람이 놓은 값을 덮지 않는다
// (분류는 keep, 사업영역·담당조직은 이미 차 있어 AI가 비어 있는 연결만 채우는 규칙에 걸리지 않음). 결과 {doc,linked}.
async function luUploadDropped(file,value=null){let fd=null;try{fd=new FormData();fd.append('file',await window.KPTURuntime.copyUploadFile(file));if(value&&value.field!=='organization_id')fd.append(value.field,value.value);const d=await luUploadRequest(fd,file);if(d?.error||!d?.document)throw new Error(d?.error||'자료 업로드 응답을 확인하지 못했어요.');let linked=true;if(value?.field==='organization_id')linked=await linkUploadedDocument(window.KPTURuntime,{documentId:d.document.id,workspaceId:luWorkspace,organizationId:value.value});luAiFill(d.document.id,fd,file.name);return {doc:d.document,linked}}finally{fd?.delete('file');fd=null}}
// S46-25: 묶음 머리 값 확인. 사업영역은 고를 수 있는 사업영역(보관·옛 공간·확인 불가 제외), 담당조직은 읽어 온 내 작업공간 조직, 분류는 내 분류 목록에 있는 이름만.
function luDropValue(raw){
  if(luGroupBy==='project')return raw&&luCatalog()&&luIsSelectableProject(raw)?{name:luProjectName(raw)}:null;
  if(luGroupBy==='organization'){const o=(luOrganizations||[]).find(x=>x.id===raw);return o?{name:String(o.name||'이름 없는 조직')}:null}
  if(luGroupBy==='category')return documentCategories().includes(raw)?{name:categoryLabel(raw)}:null;
  return null;
}
// S53-19 LIB-화면끌어놓기 이어서: 폴더 묶기면 ① 왼쪽 나무 줄·위치 줄 → ② 오른쪽 목록의 폴더 줄 → ③ 들어간 폴더 안 빈 곳(그 폴더) → 그 밖은 폴더 밖(placeDropTarget).
// 폴더 상태는 한 곳(luFolders_ — 폴더 부품 state().folders와 같은 배열)만 본다. 만들기·이름 바꾸기·옮기기 뒤 reload가 이 배열을 바꾸고 나무·목록을 다시 그린다.
function luDropFolderOf(id){const f=luFolders_.find(x=>x.id===id);return f?{id:f.id,name:String(f.name||'폴더')}:null}
function luDropTarget(e){
  if(luGroupBy!=='folder')return groupDropTarget(e,luGroupBy,{resolve:luDropValue});
  if(!luFoldersReady)return null;
  // LIB-두칸보기: 두 칸이면 놓은 칸의 폴더 줄(그 폴더) 또는 그 칸의 지금 폴더(맨 위면 폴더 밖)로.
  if(luTwoActive()){
    const at=e?.target,nav=at?.closest?.('#documentList [data-lu-pane-i] [data-lu-nav]');
    if(nav){const f=luDropFolderOf(nav.dataset.luNav);return f?{ok:true,kind:'into',target:f.id,name:f.name,place:nav.closest('.ft-row')||nav}:{ok:false,place:nav}}
    const pane=at?.closest?.('#documentList [data-lu-pane-i]');
    if(pane){const f=luDropFolderOf(pane.dataset.luPaneFolder||'');return f?{ok:true,kind:'into',target:f.id,name:f.name,place:pane}:{out:true,place:pane}}
  }
  const el=e?.target,opt={inFolder:luInFolder,folderOf:luDropFolderOf};
  const step=placeDropTarget(el,{...opt,step:true});if(step)return step;
  const row=luFolders().fileTarget(e);if(row)return row;
  const here=placeDropTarget(el,{...opt,step:false});if(!here)return null;
  // 들어간 폴더 머리 줄(오른쪽 목록 맨 위)에 옮기기와 같은 놓을 곳 표시.
  const head=[...document.querySelectorAll('#documentList details.lu-node')].find(n=>n.dataset.luNode==='f:'+here.target)?.querySelector(':scope > summary.lu-node-head');
  return head?{...here,head}:here;
}
// 나무 줄·위치 칸 표시(오른쪽 목록 줄 표시는 폴더 부품 markFile). 한 번에 한 줄.
let luDropPlaceEl=null;
function luMarkDrop(t){
  const el=t?.ok===false?null:t?.place||null;if(el!==luDropPlaceEl){luDropPlaceEl?.classList.remove('lu-drop-place');luDropPlaceEl=el;el?.classList.add('lu-drop-place')}
  if(t?.head)luFolders().markFile(t);else if(luFolderUi)luFolderUi.markFile(null);
}
// LIB-폴더로올리기 (2026-10-30): 폴더 묶기에서 폴더 줄에 놓았으면(target) 올린 자료마다 그 폴더에 넣는다(옮기기와 같은 자료 연결 표, 폴더 부품 putUploaded).
// 다른 곳에 놓은 파일은 지금처럼 폴더 밖. 올리기 중 또 놓으면 그 파일은 놓은 곳(폴더 또는 밖) 그대로 줄 뒤에 이어 올린다.
// S46-25: 사업영역·담당조직·분류 묶음 머리에 놓았으면(target.field) 그 값을 달아 올린다('공공기관사업본부로 2개 올렸어요').
async function luDropFiles(files,target=null){
  const folder=target?.target?{id:target.target,name:target.name||'폴더'}:null;
  const value=!folder&&target?.field?{field:target.field,value:target.value,name:target.name||'',key:target.key}:null;
  const entries=Array.from(files||[]).map(file=>({file,folder,value}));for(const x of entries)luDropSending.add(x.file);
  // 이미 올리는 중이면 새로 놓은 파일은 그 줄 뒤에 이어 올린다(순서대로, 동시에 보내지 않음).
  if(luDropRun){luDropRun.queue.push(...entries);return}
  const run=luDropRun={queue:[...entries]};// 줄은 복사본(올리며 비우므로, 결과 문구는 처음 놓은 entries로 본다)
  const btn=document.querySelector('#newDocumentBtn');luUploading=true;luSetBusy(btn,true);
  const total={done:0,failed:[],rest:0,unfiled:0,unlinked:0},okDocs=[];let stopped=null;const places=new Set(),filed=new Set(),valued=new Set();
  try{
    while(run.queue.length){
      const batch=run.queue.splice(0,run.queue.length),where=new Map(batch.map(x=>[x.file,x]));
      for(const x of batch)places.add(x.folder?'f:'+x.folder.id:x.value?'v:'+x.value.key:'');
      const upload=async file=>{const x=where.get(file),f=x?.folder,v=x?.value;const {doc,linked}=await luUploadDropped(file,v);if(v){if(linked)valued.add(v.key);else total.unlinked++}if(f){if(await luFolders().putUploaded(doc?.id,f.id))filed.add(f.id);else total.unfiled++}if(doc)okDocs.push({id:doc.id,name:file.name});return doc};
      const r=await runDropUpload(batch.map(x=>x.file),{upload,preflight:luPreflightFailure,classify:e=>{const f=luUploadFailure(e);return {message:f.message,kind:f.kind,stop:!!f.stop}},onProgress:p=>luDropStatus(luDropProgressText(p),{busy:true})});
      total.done+=r.done;total.failed.push(...r.failed);total.rest+=r.rest;
      if(r.stopped){stopped=r.stopped;break}
    }
    if(filed.size){try{await luLoadFolders()}catch(e){console.error('library folders refresh after drop upload failed',e)}if(filed.size===1)luFolders().revealFolder([...filed][0])}
    if(total.done||total.failed.some(f=>f.kind==='unknown')){try{await luLoadDocuments();luRenderLibrary()}catch(e){console.error('library list refresh after drop upload failed',e)}}
    if(valued.size===1)luRevealKeys([...valued]);
    if(total.done)window.dispatchEvent(new CustomEvent('kptu:documents-changed',{detail:{project_id:null}}));
    // 한 폴더에만 놓았으면 결과 문구에 그 폴더 이름('주간보고에 2개 올렸어요').
    const one=places.size===1&&!places.has(''),only=one&&folder?folder.name:'',onlyValue=one&&value?value.name:'';
    luDropStatus(luDropResultText({...total,folder:only,value:onlyValue}),{error:!!(total.failed.length||total.rest||total.unfiled||total.unlinked)});
    // LIB-업로드완료알림: 다른 화면에 가 있어도 끝나면 공용 작은 알림 한 줄. 실패한 파일은 [다시]로 같은 곳에 다시 올린다.
    const badNames=new Set(total.failed.map(f=>f.name)),badFiles=entries.filter(x=>badNames.has(x.file?.name)).map(x=>x.file);
    announceUploaded({done:total.done,names:okDocs.map(d=>d.name),failed:total.failed.length+total.rest,where:only||onlyValue,openId:okDocs.length===1?okDocs[0].id:'',retry:badFiles.length?()=>luDropFiles(badFiles,target):null});
    if(stopped&&luIsDriveAuthError(stopped.error))await luMaybeReconnectDrive(stopped.error);
  }catch(e){console.error('library drop upload failed',e);luDropStatus('올리지 못했어요. 잠시 후 다시 놓아 주세요.',{error:true})}
  finally{luDropRun=null;luDropSending.clear();luUploading=false;luSetBusy(btn,false)}
}
function luEnhanceDrop(){
  const list=document.querySelector('#documentList'),view=document.querySelector('#libraryView');if(!list||!view||document.querySelector('#libraryDropOverlay'))return;
  const st=document.createElement('p');st.id='libraryDropStatus';st.className='lu-drop-status';st.hidden=true;st.setAttribute('role','status');st.setAttribute('aria-live','polite');list.before(st);const up=document.createElement('div');up.hidden=true;st.after(up);mountUploadRows(up,{has:job=>luDropSending.has(job.file)});
  const overlay=document.createElement('div');overlay.id='libraryDropOverlay';overlay.className='lu-drop-overlay';overlay.hidden=true;overlay.setAttribute('aria-hidden','true');overlay.innerHTML='<span class="lu-drop-hint"></span>';overlay.firstChild.textContent=DROP_HINT;document.body.append(overlay);
  // 왼쪽 메뉴를 뺀 화면 전체(자료실 칸의 가로 범위, 세로는 창 전체).
  const place=()=>{const r=view.getBoundingClientRect();overlay.style.left=Math.max(0,Math.round(r.left))+'px';overlay.style.right=Math.max(0,Math.round(window.innerWidth-r.right))+'px'};
  bindLibraryDrop({overlay,active:luDropActive,onFiles:luDropFiles,place,pick:luDropTarget,mark:luMarkDrop});
}
function luSetFileStatus(entry,kind,label){entry.kind=kind;entry.label=label;luRenderSelectedFiles()}
function luResetUploadSelection({clearStatus=true}={}){luUploadEntries=[];const input=document.querySelector('#libraryFileInput');if(input)input.value='';luRenderSelectedFiles();if(clearStatus)luSetStatus(document.querySelector('#documentStatus'),'')}
function luEnhanceUpload(){const modal=document.querySelector('#documentModal .modal-card');const title=document.querySelector('#docTitle');if(!modal||!title||document.querySelector('#libraryFileInput'))return;const picker=document.createElement('div');picker.className='library-file-block';picker.innerHTML='<input id="libraryFileInput" class="library-file-input" type="file" multiple><div class="library-pick-line"><label id="libraryDropzone" class="library-pick-button" for="libraryFileInput" tabindex="0" role="button" aria-label="자료 파일 선택(여러 개 가능)">'+iconHtml('clip')+' 파일 선택</label><span class="library-picker-hint">여러 개 · 파일당 100MB<span class="library-drop-hint"> · 끌어다 놓기</span></span></div><div data-lu-upload-progress hidden></div><div id="librarySelectedFiles" class="library-selected-files" aria-live="polite"></div>';title.closest('label')?.insertAdjacentElement('beforebegin',picker);const lab=title.closest('label');if(lab&&lab.firstChild?.nodeType===3)lab.firstChild.nodeValue='자료명 (선택)';/* UI-전수디자인점검 F20: 위 두 줄 설명 대신 칸 안 글자 */title.placeholder='비우면 파일명으로';const input=picker.querySelector('#libraryFileInput'),zone=picker.querySelector('#libraryDropzone');zone.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input.click()}});
  // PC: 창 전체가 끌어다 놓는 자리(놓을 때만 테두리).
  bindDropTarget(modal,luSetSelectedFiles,()=>!luUploading);input.addEventListener('change',()=>luSetSelectedFiles(input.files));picker.querySelector('#librarySelectedFiles').addEventListener('click',e=>{const b=e.target.closest('[data-lu-remove-file]');if(!b||luUploading)return;const index=Number(b.dataset.luRemoveFile);if(luUploadEntries[index]?.kind==='success')return;luUploadEntries.splice(index,1);input.value='';luRenderSelectedFiles();const next=picker.querySelectorAll('[data-lu-remove-file]');(next[Math.min(index,next.length-1)]||zone).focus()});luMountUploadProgress(picker);luRenderSelectedFiles()}
function luSetStatus(st,msg,error=false){if(!st)return;st.textContent=msg||'';st.className='status'+(error?' error':msg?' ok':'');if(error){st.setAttribute('role','alert');st.removeAttribute('aria-live')}else{st.setAttribute('role','status');st.setAttribute('aria-live','polite')}}
function luSetBusy(btn,value){if(!btn)return;btn.disabled=!!value;if(value)btn.setAttribute('aria-busy','true');else btn.removeAttribute('aria-busy')}
// 업로드 전용 timeout: 공용 올리기 한도(upload-budget.mjs, 파일 크기 기준). 공용 runtime의 15초 기본값은 다른 API에 그대로 둔다.
const LU_MAX_FILE_BYTES=100*1024*1024;
function luUploadTimeoutMs(file){return uploadTimeoutMs(file?.size)}
// UI-올리기진행표시 ②: 보내기는 공용 길(upload-send.mjs, XMLHttpRequest가 실제로 보낸 양)이고 올리는 중 표시는 공용 부품(upload-progress.js)이다.
// job: 부른 곳이 미리 만든 표시(없으면 여기서 만든다). ✕(취소)는 다 보내기 전만 — 서버는 다 받지 못한 요청을 저장하지 않는다(code upload_cancelled).
// 다 보낸 뒤 끊김·시간 초과는 지금처럼 결과 불명(timeout·network_error): 자료가 이미 생겼을 수 있어 같은 파일을 저절로 다시 보내지 않는다.
async function luUploadRequest(fd,file,{job=null}={}){
  const runtime=window.KPTURuntime,path='/functions/v1/library-files';
  const error=(message,options)=>runtime?.RuntimeError?new runtime.RuntimeError(message,options):Object.assign(new Error(message),{status:0,retryable:false,...options});
  const sessionRequired=()=>error('로그인이 필요합니다.',{status:401,code:'session_required'});
  if(!(await luEnsure()))throw sessionRequired();
  const requestEpoch=runtime?.session?.epoch?.()??0,url=(runtime?.config?.url||LU_SB)+path;
  async function request(){
    const session=luRead();
    if(!session?.access_token)throw sessionRequired();
    const headers={apikey:runtime?.config?.key||LU_KEY,Authorization:'Bearer '+session.access_token};
    const started=performance.now();
    let timer;
    // The upload deadline (upload-budget.mjs) reports an unknown outcome without
    // aborting or retrying the upload, as before; only ✕ stops it, and only before everything is sent.
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(error('요청 시간이 초과되었습니다. 다시 시도해 주세요.',{code:'timeout',retryable:true})),luUploadTimeoutMs(file))});
    try{
      const response=await Promise.race([sendUpload(url,{headers,body:fd,size:file?.size||0,timeoutMs:0,signal:shown.signal,onProgress:shown.progress}),deadline]);
      window.__KPTU_STARTUP__?.request?.(url,performance.now()-started,response.status);
      return response;
    }catch(cause){
      window.__KPTU_STARTUP__?.request?.(url,performance.now()-started,0);
      if(cause?.code==='timeout')throw cause;
      if(cause?.code==='upload_cancelled')throw error('올리기를 취소했어요.',{code:'upload_cancelled',retryable:true,cause});
      if(cause?.via==='timeout')throw error('요청 시간이 초과되었습니다. 다시 시도해 주세요.',{code:'timeout',retryable:true,cause});
      throw error('네트워크 연결을 확인한 뒤 다시 시도해 주세요.',{code:'network_error',retryable:true,cause});
    }finally{clearTimeout(timer)}
  }
  const shown=job||trackUpload({file,name:file?.name,size:file?.size});
  try{
  let response=await request();
  // Keep the existing authenticated 401 recovery; network/timeout failures are
  // never retried. Session refresh remains owned by the shared runtime.
  if(response.status===401){
    if(!(await runtime?.session?.refresh?.()))throw sessionRequired();
    response=await request();
    if(response.status===401){runtime.session.write(null);throw sessionRequired()}
  }
  const text=response.text;
  let data;try{data=text?JSON.parse(text):null}catch{data=text}
  // LIB-자료등록실패: 서버가 실어 보낸 멈춘 단계(stage, 우리 글자 코드만)를 오류에 남겨 화면 문구에 짧게 붙인다(원인을 운영 로그 없이도 가르기). 원문 오류는 싣지 않는다.
  if(!response.ok)throw Object.assign(error(data?.message||data?.error_description||data?.hint||data?.error||('요청 실패 '+response.status),{status:response.status,code:'http_'+response.status,retryable:[408,425,429].includes(response.status)||response.status>=500}),luServerStage(data));
  // Match runtime save metadata and its stale-account guard; never publish
  // file contents, titles, or response data in the shared notification.
  if(requestEpoch===(runtime?.session?.epoch?.()??0)&&data?.ok!==false&&!data?.error){
    try{window.dispatchEvent(new CustomEvent('kptu:api-saved',{detail:{path,method:'POST',fields:[],action:'',projectLinked:!!(fd.get('project_id')||data?.document?.project_id),epoch:requestEpoch}}))}catch{}
  }
  shown.done();
  return data;
  }catch(e){
    if(e?.code!=='upload_cancelled')shown.fail(luUploadFailure(e).message);
    throw e;
  }
}
const LU_UPLOAD_FAILURES={
  unknown_timeout:{kind:'unknown',label:'결과 확인 필요',stop:true,message:'업로드 시간이 오래 걸려 결과를 확인하지 못했어요. 자료실 목록에서 등록 여부를 확인한 뒤 다시 시도해 주세요.'},
  unknown_network:{kind:'unknown',label:'결과 확인 필요',stop:true,message:'네트워크 연결이 끊겨 업로드 결과를 확인하지 못했어요. 네트워크 연결을 확인하고 자료실 목록에서 등록 여부를 확인한 뒤 다시 시도해 주세요.'},
  session:{kind:'error',label:'실패 · 다시 시도',stop:true,message:'로그인 세션이 만료됐습니다. 다시 로그인한 뒤 업로드해 주세요.'},
  session_refresh:{kind:'error',label:'실패 · 다시 시도',stop:true,message:'로그인 세션을 갱신하지 못했어요. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.'},
  drive_auth:{kind:'error',label:'실패 · 다시 시도',stop:true,message:'Google Drive 연결이 만료됐습니다. 다시 연결한 뒤 시도해 주세요.'},
  too_large:{kind:'error',label:'100MB 초과',retry:false,message:'현재 자료실은 파일당 100MB까지 지원합니다.'},
  file_read:{kind:'error',label:'파일을 읽지 못했어요. 파일을 다시 선택해 주세요.',retry:false,message:'파일을 읽지 못했어요. 파일을 다시 선택해 주세요.'},
  empty:{kind:'error',label:'빈 파일',retry:false,message:'빈 파일은 업로드할 수 없어요.'},
  project:{kind:'error',label:'실패 · 다시 시도',stop:true,message:'선택한 사업영역을 더 이상 사용할 수 없어요. 사업영역을 다시 선택해 주세요.'},
  forbidden:{kind:'error',label:'실패 · 다시 시도',stop:true,message:'자료를 업로드할 권한이 없어요.'},
  invalid:{kind:'error',label:'실패 · 다시 시도',message:'파일을 업로드하지 못했어요. 파일과 입력값을 확인한 뒤 다시 시도해 주세요.'},
  server:{kind:'error',label:'실패 · 다시 시도',message:'파일을 업로드하지 못했어요. 잠시 후 다시 시도해 주세요.'},
  cancelled:{kind:'pending',label:'취소함',message:'올리기를 취소했어요.'}
};
// LIB-자료등록실패: library-files 실패 응답의 stage(서버 고정 글자)만 받아 사람이 읽는 짧은 이름으로 바꾼다. 모르는 값은 버린다.
const LU_STAGE_LABELS={auth:'로그인 확인',authorize:'권한 확인',project:'사업영역 확인',validate:'파일 확인',request:'요청 읽기',drive_token:'Drive 연결 확인',drive_folder:'Drive 폴더',drive_upload_init:'Drive 저장 시작',drive_upload:'Drive 저장',db_insert:'자료 기록',db_update:'자료 기록',unknown:'서버'};
function luServerStage(data){const stage=typeof data?.stage==='string'&&Object.hasOwn(LU_STAGE_LABELS,data.stage)?data.stage:'';const serverCode=typeof data?.code==='string'&&/^[a-z_]{1,40}$/.test(data.code)?data.code:'';return {...(stage?{stage}:{}),...(serverCode?{serverCode}:{})}}
const luStageNote=e=>{const label=Object.hasOwn(LU_STAGE_LABELS,e?.stage||'')?LU_STAGE_LABELS[e.stage]:'';return label?` (멈춘 곳: ${label})`:''};
// timeout·네트워크 단절·gateway 중단(502/504/546)은 서버가 이미 저장했을 수 있으므로 실패가 아니라 결과 불명으로 둔다.
function luUploadFailure(e,{project=false}={}){const status=Number(e?.status)||0,code=e?.code||'';let type='server';if(code==='upload_cancelled')type='cancelled';else if(code==='file_read_failed')type='file_read';else if(code==='timeout')type='unknown_timeout';else if(code==='network_error')type='unknown_network';else if(code==='session_required'||status===401)type='session';else if(code==='session_refresh_failed')type='session_refresh';else if(luIsDriveAuthError(e))type='drive_auth';else if(status===413)type='too_large';else if([502,504,546].includes(status))type='unknown_timeout';else if(project&&(status===404||status===409))type='project';else if(status===403)type='forbidden';else if(status>=400&&status<500)type='invalid';const base=LU_UPLOAD_FAILURES[type];return {type,retry:true,...base,...(type==='server'&&luStageNote(e)?{message:base.message.replace(/\. 잠시 후/,luStageNote(e)+'. 잠시 후')}:{})}}
function luPreflightFailure(file){if(!(Number(file?.size)>0))return {type:'empty',retry:true,...LU_UPLOAD_FAILURES.empty};if(file.size>LU_MAX_FILE_BYTES)return {type:'too_large',retry:true,...LU_UPLOAD_FAILURES.too_large};return null}
const LU_FAILURE_PRIORITY=['drive_auth','session','session_refresh','project','forbidden','unknown_timeout','unknown_network'];
// 끌어 놓아 올리는 파일(올리는 중 표시가 자료실 위 놓기 줄 아래에 그 파일들만 그린다). 한 번의 놓기 흐름이 끝나면 비운다.
const luDropSending=new Set();
let luUploading=false;
// LIB-AI자동분류: 등록된 자료의 빈 칸을 버튼 없이 AI가 채운다(기다리지 않음, 화면에 AI 표시 없음). 실패해도 등록 결과는 그대로다.
// 올리기 창에서 사용자가 직접 넣은 칸(keep)은 AI가 쓰지 않는다. 채워지면 kptu:documents-changed로 목록을 새로 읽는다.
// LIB-파일이름그대로: 올린 파일 이름도 넘긴다(뜻 있는 이름이면 제목, 이름에 날짜가 있으면 자료 날짜를 AI가 바꾸지 않음 — library-file-name.mjs 한 곳).
function luAiFill(id,fd,fileName){const keep=keptFields({title:fd.get('title'),document_date:fd.get('document_date'),source:fd.get('source'),category:fd.get('category')});void fillLibraryDocument(id,{keep,fileName:String(fileName||'')}).catch(()=>{})}
async function luUploadOrOriginal(original){if(luUploading)return;const projectId=document.querySelector('#docProject')?.value||'';if(!luIsSelectableProject(projectId)){luSetStatus(document.querySelector('#documentStatus'),'선택한 사업영역을 더 이상 사용할 수 없어요. 사업영역을 다시 선택해 주세요.',true);luRenderUploadProject('');return}if(!luUploadEntries.length)return original?.();const st=document.querySelector('#documentStatus'),btn=document.querySelector('#saveDocumentBtn');const unresolved=luUploadEntries.filter(entry=>entry.kind==='unknown');let includeUnknown=false;if(unresolved.length){includeUnknown=await askConfirm(btn,{text:`업로드 결과를 확인하지 못한 파일 ${unresolved.length}개가 있습니다.`,note:'이미 자료실에 등록됐다면 다시 업로드할 때 같은 자료가 중복 등록됩니다. 자료실 목록에 없는 것을 확인했다면 [다시 올리기]를 눌러 다시 업로드하세요.',ok:'다시 올리기'});if(luUploading||document.querySelector('#documentModal')?.classList.contains('hidden'))return}const pending=luUploadEntries.filter(entry=>entry.kind!=='success'&&entry.retry!==false&&(entry.kind!=='unknown'||includeUnknown));if(!pending.length){if(unresolved.length)luSetStatus(st,'결과를 확인하지 못한 파일은 다시 업로드하지 않았어요. 자료실 목록에서 등록 여부를 확인한 뒤 다시 저장해 주세요.',true);else if(luUploadEntries.some(entry=>entry.kind!=='success'))luSetStatus(st,'다시 업로드할 수 있는 파일이 없어요. 파일을 다시 선택해 주세요.',true);return}luUploading=true;luSetBusy(document.querySelector('#newDocumentBtn'),true);document.querySelector('#libraryFileInput').disabled=true;luRenderSelectedFiles();luSetBusy(btn,true);let succeeded=0,linkFailed=0,lastProjectId=null,unfiled=0,filedId='';const failures=[],okDocIds=[],intoFolder=luUploadFolder;const putFolder=async id=>{if(!intoFolder)return;if(await luFolders().putUploaded(id,intoFolder.id))filedId=intoFolder.id;else unfiled++};try{for(let index=0;index<pending.length;index++){const entry=pending[index],file=entry.file;if(entry.link){const linked=await luLinkDriveEntry(entry,{many:luUploadEntries.length>1});if(linked.ok){if(linked.created){succeeded++;okDocIds.push(linked.id);await putFolder(linked.id);if(luUploadOrg&&!(await linkUploadedDocument(window.KPTURuntime,{documentId:linked.id,workspaceId:luWorkspace,organizationId:luUploadOrg.id})))linkFailed++;lastProjectId=linked.projectId||lastProjectId}}else{failures.push(linked.failure);entry.retry=linked.failure.retry;entry.failure=linked.failure;luSetFileStatus(entry,linked.failure.kind,linked.failure.label);if(linked.failure.stop){for(const rest of pending.slice(index+1))luSetFileStatus(rest,'pending','대기 · 업로드 전');break}}continue}const preflight=luPreflightFailure(file);if(preflight){entry.retry=false;entry.failure=preflight;failures.push(preflight);luSetFileStatus(entry,preflight.kind,preflight.label);continue}luSetFileStatus(entry,'uploading','업로드 중');luSetStatus(st,`${index+1}/${pending.length} · ${file.name} 업로드 중…`);let fd=null;try{fd=new FormData();fd.append('file',await window.KPTURuntime.copyUploadFile(file));const fields={title:'#docTitle',category:'#docCategory',source:'#docSource',document_date:'#docDate',tags:'#docTags',project_id:'#docProject',description:'#docDescription'};for(const[k,sel]of Object.entries(fields)){if(k==='title'&&luUploadEntries.length>1)continue;const el=document.querySelector(sel),raw=el?.value??'',v=typeof raw==='string'?raw.trim():raw;if(v)fd.append(k,v)}if(luUploadMeeting){fd.append('meeting_id',luUploadMeeting.id);if(!fd.get('project_id')&&luUploadMeeting.projectId)fd.append('project_id',luUploadMeeting.projectId)}const d=await luUploadRequest(fd,file);if(d?.error||!d?.document)throw new Error(d?.error||'자료 업로드 응답을 확인하지 못했어요.');succeeded++;okDocIds.push(d.document.id);await putFolder(d.document.id);if(luUploadOrg&&!(await linkUploadedDocument(window.KPTURuntime,{documentId:d.document.id,workspaceId:luWorkspace,organizationId:luUploadOrg.id})))linkFailed++;luAiFill(d.document.id,fd,file.name);lastProjectId=d.document.project_id||lastProjectId;entry.failure=null;luSetFileStatus(entry,'success','완료')}catch(e){if(e?.code==='upload_cancelled'){entry.failure=null;luSetFileStatus(entry,'pending','취소함 · 다시 저장하면 올림');continue}const failure=luUploadFailure(e,{project:!!projectId});console.warn('library upload failed',{type:failure.type,status:e?.status||0,code:e?.code||'',serverCode:e?.serverCode||'',stage:e?.stage||'',message:e?.message||String(e)});failures.push(failure);entry.retry=failure.retry;entry.failure=failure;luSetFileStatus(entry,failure.kind,failure.label);if(failure.stop){for(const rest of pending.slice(index+1))luSetFileStatus(rest,'pending','대기 · 업로드 전');if(failure.type==='project'){await luLoadProjects(true);luRenderUploadProject()}if(failure.type==='drive_auth')await luMaybeReconnectDrive(e);break}}finally{fd?.delete('file');fd=null}}const unknown=failures.some(f=>f.kind==='unknown');if(filedId){try{await luLoadFolders()}catch(e){console.error('library folders refresh after upload failed',e)}}if(succeeded||unknown){try{await luLoadDocuments();luRenderLibrary()}catch(e){console.error('library list refresh after upload failed',e)}if(filedId)luFolders().revealFolder(filedId)}if(succeeded)window.dispatchEvent(new CustomEvent('kptu:documents-changed',{detail:{project_id:lastProjectId,...(luUploadOrg?{organization_id:luUploadOrg.id}:{}),...(luUploadMeeting?{meeting_id:luUploadMeeting.id}:{})}}));const remaining=luUploadEntries.filter(entry=>entry.kind!=='success');if(remaining.length){const main=remaining.map(entry=>entry.failure).filter(Boolean).sort((a,b)=>{const pa=LU_FAILURE_PRIORITY.indexOf(a.type),pb=LU_FAILURE_PRIORITY.indexOf(b.type);return (pa<0?99:pa)-(pb<0?99:pb)})[0];const done=luUploadEntries.length-remaining.length,prefix=luUploadEntries.length>1?`${done}개 완료 · ${remaining.length}개 미완료. `:'',retryable=remaining.some(entry=>entry.retry!==false&&entry.kind!=='unknown'),hint=luUploadEntries.length>1&&retryable&&main?.kind!=='unknown'?' 다시 저장하면 완료되지 않은 파일만 업로드합니다.':'';luSetStatus(st,prefix+(main?.message||(remaining.every(entry=>!entry.failure)?LU_UPLOAD_FAILURES.cancelled.message:LU_UPLOAD_FAILURES.server.message))+hint,true);return}if(unfiled)notify(`자료 ${unfiled}개는 올라갔지만 ‘${intoFolder.name}’ 폴더에 넣지 못해 폴더 밖에 있어요. 그 자료를 폴더로 옮겨 주세요.`,{error:true});if(linkFailed)notify(`자료 ${linkFailed}개는 올라갔지만 담당조직에 붙이지 못했어요. 그 자료의 [정보 수정]에서 담당조직을 선택해 주세요.`,{error:true});{const okEntries=luUploadEntries.filter(e=>e.kind==='success');announceUploaded({done:okEntries.length,names:okEntries.map(e=>e.file?.name),openId:okDocIds.length===1?okDocIds[0]:''})}luSetStatus(st,luUploadEntries.length===1?'등록 완료':`${luUploadEntries.length}개 파일 등록 완료`);luResetUploadSelection({clearStatus:false});luSetUploadOrg(null);luSetUploadMeeting(null);luSetUploadFolder(null);document.querySelector('#documentModal')?.classList.add('hidden')}finally{luUploading=false;luSetBusy(document.querySelector('#newDocumentBtn'),false);document.querySelector('#libraryFileInput').disabled=false;luRenderSelectedFiles();luSetBusy(btn,false)}}
function luEnsureManageUi(){if(document.querySelector('#libraryManageModal'))return;document.body.insertAdjacentHTML('beforeend',`<div id="libraryManageModal" class="modal le-modal hidden" aria-hidden="true"><div class="modal-card medium-card"><div class="modal-head"><div><h2>분류 수정<span class="le-count" data-le-count></span></h2></div><button id="libraryManageClose" class="icon-btn" type="button">×</button></div><div id="libraryCategoryEditor" class="library-category-editor"></div></div></div><div id="libraryEditModal" class="modal hidden" data-enter-save aria-hidden="true"><div class="modal-card small-card"><div class="modal-head"><div><h2>자료 수정</h2></div><button id="libraryEditClose" class="icon-btn" type="button">×</button></div><input id="libraryEditId" type="hidden"><div id="libraryEditFile" class="library-edit-file" hidden><div id="libraryEditFileLine" aria-live="polite"></div><details id="libraryEditPrev" class="library-edit-prev" hidden><summary>이전 파일${chevHtml(false)}</summary><div id="libraryEditPrevList"></div></details><input id="libraryEditReplaceInput" class="library-file-input" type="file" tabindex="-1" aria-label="교체할 파일"></div><label>자료명<input id="libraryEditTitle" type="text"></label><div class="library-edit-grid"><label>분류<select id="libraryEditCategory">${categoryOptions('')}</select></label><label>사업영역<select id="libraryEditProject"></select></label><label>사업 보고<select id="libraryEditMeeting"></select></label><label>출처<input id="libraryEditSource" type="text"></label><label>문서 날짜<input id="libraryEditDate" type="date"></label></div><label>태그<input id="libraryEditTags" type="text" placeholder="쉼표로 구분"></label><label>설명<textarea id="libraryEditDescription" rows="4"></textarea></label><div class="modal-action-footer"><div id="libraryEditStatus" class="status"></div><button id="libraryEditSave" data-enter-save-submit class="primary wide" type="button">수정 저장</button></div></div></div>`);document.querySelector('#libraryManageClose').onclick=()=>luClose('libraryManageModal');document.querySelector('#libraryEditClose').onclick=()=>luClose('libraryEditModal');document.querySelector('#libraryEditSave').onclick=luSaveEdit;luBindReplaceFile()}
// UI-Esc로창닫기: 분류 수정·파일 고치기 창도 공용 창 규칙(accessibility-dialog.js)으로 연다 — Esc = 그 창의 ✕.
// activate·deactivate가 kptu:dialog-opened·closed 알림도 보낸다(전에 여기서 직접 보내던 것과 같은 알림).
const LU_CLOSE={libraryManageModal:'#libraryManageClose',libraryEditModal:'#libraryEditClose'};
function luOpen(id){const m=document.querySelector('#'+id);if(!m)return;const was=m.classList.contains('hidden');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');if(!was)return;const a11y=window.KPTUA11y?.dialog;if(a11y?.activate)a11y.activate(m,{trigger:document.activeElement,initialFocus:m.querySelector(LU_CLOSE[id]),onRequestClose:()=>m.querySelector(LU_CLOSE[id])?.click()});else window.dispatchEvent(new CustomEvent('kptu:dialog-opened',{detail:{modal:m}}))}
function luClose(id){if(id==='libraryEditModal'){luEditSequence++;luEditor=null}const m=document.querySelector('#'+id);if(!m)return;m.classList.add('hidden');m.setAttribute('aria-hidden','true');const a11y=window.KPTUA11y?.dialog;if(a11y?.deactivate)a11y.deactivate(m);else window.dispatchEvent(new CustomEvent('kptu:dialog-closed',{detail:{modal:m}}))}
async function luLoadDocuments(){if(!luWorkspace)return;luDocuments=await readDocuments(luApi,luWorkspace);if(luGone.size&&Array.isArray(luDocuments))luDocuments=luDocuments.filter(d=>!luGone.has(d.id));await luLoadPhotoMeetings()}
// ACT-사진 4단계: 사업 보고에 붙은 사진을 사업 보고마다 한 줄로 묶으려면 그 사업 보고의 제목·일시·칸이 필요하다. 사업 보고 표는 읽기만 한다(소유자 RLS, 휴지통 사업 보고는 서버가 숨김).
// 번호 → 사업 보고 행. 물어봤는데 안 돌아온 번호(휴지통)는 null 로 둔다. 읽지 못하면 null: 묶지 않고 사진을 한 장 한 줄로 그대로 보인다.
let luPhotoMeetings=null;
async function luLoadPhotoMeetings(){
  const chunks=photoMeetingChunks(luDocuments);
  if(!chunks.length){luPhotoMeetings=new Map();return}
  try{
    const pages=await Promise.all(chunks.map(ids=>luApi('/rest/v1/app_meetings?workspace_id=eq.'+encodeURIComponent(luWorkspace)+'&id=in.('+ids.map(encodeURIComponent).join(',')+')&select=id,title,series_name,round_no,meeting_at,activity_kind')));
    const found=new Map(pages.flat().map(m=>[m.id,m]));
    luPhotoMeetings=new Map(chunks.flat().map(id=>[id,found.get(id)||null]));
  }catch(e){luPhotoMeetings=null;console.warn('library photo meetings read failed',e?.message||e)}
}
const luListDocs=()=>foldPhotoSets(luDocuments,luPhotoMeetings);
// LIB-정리보충 ②: 사진 묶음 줄(사업 보고 하나)의 실제 사진 자료 행들. 묶음은 계산된 줄이라 옮길 때는 이 행들을 한 번에 옮긴다(사업 보고 연결은 그대로).
function luPhotoSetMembers(meetingId){const set=luListDocs().find(d=>isPhotoSet(d)&&d.meeting_id===meetingId);if(!set)return [];const ids=new Set((set.photos||[]).map(p=>p.id));return luDocuments.filter(d=>ids.has(d.id))}
// 묶음 줄: 사업 보고 하나 = 한 줄. 누르면 그 사업 보고(사진 보기는 사업 보고 화면 쪽 단계에서 이어 붙는다). 사진은 자료실에서 고르거나 옮기거나 지울 수 없다(사업 보고에서 다룸).
function luPhotoSetRowHtml(d){
  const label=luEsc(d.title),date=luDisplayName(d).date,mid=luEsc(d.meeting_id);
  return `<article class="lu-row lu-row-set" role="button" tabindex="0" data-lu-photoset="${mid}" aria-label="사진 보기: ${label}"><span class="lu-file-kind" data-lu-kind="img">그림</span><span class="lu-row-tag">${categoryTag(d.category)}</span><h3 class="lu-row-title">${label}</h3>${reportPhotosHtml(d.meeting_id,new Map([[d.meeting_id,d.photos]]),{more:false})}${date?`<span class="lu-row-date">${luEsc(date)}</span>`:''}${luPhotoSetMenu()?`<button class="icon-btn lu-more-trigger" type="button" aria-label="사진 묶음 관리: ${label}" aria-expanded="false" aria-controls="luMorePanel" data-lu-menu="photoset:${mid}"><span class="more-dots" aria-hidden="true">⋯</span></button>`:''}</article>`;
}
// LIB-정리보충: 사진 묶음 줄 ⋯(우클릭·폰 꾹 눌렀다 떼기)는 폴더 보기에서만 [폴더로 옮기기 ›] 하나(묶음 안 사진 모두 함께, 끌어 놓기와 같은 길).
const luPhotoSetMenu=()=>luGroupBy==='folder'&&luFoldersReady;
const luPhotoSetKey=id=>typeof id==='string'&&id.startsWith('photoset:')?id.slice(9):null;
// ACT-사진 6단계: 사진 묶음 줄을 누르면 사업 보고 화면의 [사진] 보기로 바로 가서 그 사업 보고 묶음 자리에 선다(도착점은 이 함수 하나).
// 사업 보고 화면을 불러오지 못하면 예전처럼 그 사업 보고 결과 창을 연다.
async function luOpenPhotoSet(meetingId){try{await window.KPTUViewLoader?.load?.('meetings');const cols=window.KPTUMeetingColumns;if(cols?.showPhotos&&window.KPTURouter?.go?.('meetings',{source:'delegated'})){cols.showPhotos(meetingId);return}const {openReport}=await import('./report-open.js');await openReport(meetingId)}catch(e){console.error('library photo set open',e);notify('사업 보고를 열지 못했어요.',{error:true})}}
// UI-디자인기준 3/3: the kind comes from the file extension; a name without a known extension uses the type Drive reported (mime_type).
const luFileKind=fileKindOf;
// UI-PC자료실: 줄 오른쪽의 짧은 날짜(월.일). 분류 꼬리표는 자료명 왼쪽으로 옮겼다.
// 자료 날짜가 없는 자료는 올린 날(created_at, 사용자 시간대)을 흐리게 "10.21 올림"으로 보인다.
function luUploadDate(d){const t=new Date(d.created_at||'');if(Number.isNaN(t.getTime()))return '';return String(t.getMonth()+1).padStart(2,'0')+'.'+String(t.getDate()).padStart(2,'0')}
function luRowDate(d){const date=/^\d{4}-(\d{2})-(\d{2})/.exec(d.document_date||'');return date?date[1]+'.'+date[2]:''}
// UI-바구니첨부메모 ⑩: 최신 위, 달별 묶음. 문서 날짜가 없으면 등록한 날로 본다.
const luSortKey=d=>String(d.document_date||d.created_at||'').slice(0,10);
function luMonthLabel(key){const m=/^(\d{4})-(\d{2})/.exec(key);return m?`${m[1]}년 ${Number(m[2])}월`:'날짜 없음'}
// UI-PC자료실: PC(761px 이상)는 파일 종류 → 분류 꼬리표 → 자료명 한 줄(…) → 날짜 → [펼치기] → ⋯. 줄을 누르면 지금처럼 연다.
// 폰(760px 이하, M2)은 같은 줄을 두 단으로: 다듬은 이름(2줄까지)·오른쪽 날짜 / 아래 작은 줄에 종류·분류. 펼치기는 쓰지 않는다.
const LU_PHONE=typeof matchMedia==='function'?matchMedia('(max-width:760px)'):null;
const luPhone=()=>!!LU_PHONE?.matches;
const LU_EXT=/\.(hwpx?|pdf|xlsx?|xlsm|docx?|pptx?|zip|txt|csv|jpe?g|png)$/i;
// 폰 이름 다듬기(보이는 것만, 저장 이름과 검색 대상은 그대로): 앞의 날짜(YYMMDD·YYYYMMDD + 구분자)는 떼어 오른쪽 날짜로,
// 밑줄은 띄어쓰기로, 끝의 확장자는 뺀다. 날짜 앞머리가 없으면 이름은 밑줄·확장자만 다듬는다. 자료 날짜가 있으면 그 날짜를 보인다.
// 날짜 우선순위(폰·PC 같음): 자료 날짜 → 이름 앞 날짜(luDisplayName().date) → 올린 날 + 올림. PC는 이름은 그대로 두고 날짜만 이 규칙을 쓴다.
function luDisplayName(d){const raw=String(d.title||d.file_name||'파일');let name=raw.replace(LU_EXT,''),date='';const m=/^(?:20)?(\d{2})(\d{2})(\d{2})[_\-\s.]+(.+)$/.exec(name);if(m&&+m[2]>=1&&+m[2]<=12&&+m[3]>=1&&+m[3]<=31){date=m[2]+'.'+m[3];name=m[4]}name=name.replace(/_+/g,' ').replace(/\s+/g,' ').trim();return {name:name||raw,date:luRowDate(d)||date}}
// LIB-종류표잘림: '종류'로 묶은 토글 안에서는 묶음 제목과 같은 분류 표를 줄마다 또 보이지 않는다(데이터는 그대로).
function luAddSuggest(html,d,node){const s=luSuggestHtml(d,node);return s?html.replace('<button class="icon-btn lu-more-trigger"',s+'<button class="icon-btn lu-more-trigger"'):html}
function luRowHtml(d,node){if(isPhotoSet(d))return luPhotoSetRowHtml(d);const sameTag=luGroupBy==='category'&&node?.category!==undefined&&node.category===categoryOf(d.category),raw=luEsc(d.title||d.file_name||'파일'),view=luPhone()?luDisplayName(d):{name:d.title||d.file_name||'파일',date:luDisplayName(d).date},date=luEsc(view.date),upload=view.date?'':luEsc(luUploadDate(d));return `<article class="lu-row${luPick.items?' lu-row-picking':''}${isLibraryPhoto(d)?' lu-row-photo':''}" role="button" tabindex="0"${luPick.items?' data-press="off"':''} data-lu-document="${luEsc(d.id)}"${sameTag?' data-lu-notag':''}${isNewUpload(d)?' data-lu-new':''}>${luPick.items?`<input type="checkbox" class="lu-pick" data-lu-pick="${luEsc(d.id)}" aria-label="선택: ${raw}"${luPick.items.has(d.id)?' checked':''}>`:''}${(k=>`<span class="lu-file-kind" data-lu-kind="${luKindKey(k)}">${k}</span>`)(luFileKind(d.file_name,d.mime_type))}${isLibraryPhoto(d)?`<span class="lu-thumb" data-lu-thumb="${luEsc(d.id)}" aria-hidden="true"></span>`:''}${sameTag?'':`<span class="lu-row-tag">${categoryTag(d.category)}</span>`}<h3 class="lu-row-title">${luEsc(view.name)}</h3>${date?`<span class="lu-row-date">${date}</span>`:upload?`<span class="lu-row-date lu-row-date-upload">${upload}<small> 올림</small></span>`:''}<button class="icon-btn lu-expand" type="button" hidden aria-expanded="false" aria-label="전체 이름 보기" data-lu-expand="${luEsc(d.id)}"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button class="icon-btn lu-more-trigger" type="button" aria-label="자료 관리: ${raw}" aria-expanded="false" aria-controls="luMorePanel" data-lu-menu="${luEsc(d.id)}"><span class="more-dots" aria-hidden="true">⋯</span></button></article>`}
// UI-PC자료실 C: 검색어가 있을 때 꺼 둔 분류에 걸린 자료 수를 목록 아래에 작게 알리고, [켜기]로 그 분류만 켠다.
function luOffHint(hidden){if(!hidden.length)return '';const names=[...new Set(hidden.map(d=>topCategoryOf(d.category)))];return `<p class="lu-off-hint" role="status">${luEsc(names.join('·'))} 분류 ${hidden.length}건은 꺼져 있어요 <button type="button" class="lu-off-show" data-lu-show-off="${luEsc(JSON.stringify(names))}">켜기</button></p>`}
// LIB-토글트리 ②(docs/design/library-tree.md 5절): 목록은 토글 안 토글. 상태 주인은 이 모듈, 그리기는 luRenderLibrary 하나.
// 펼침: 거르지 않을 때는 사용자가 연 토글(luOpen), 거를 때(검색·담당조직·프로젝트·기본과 다른 종류 칩)는 맞는 자료가 든 토글을 펼치고
// 그 동안 사용자가 여닫은 것은 따로(luFilterOpen) 기억한다. 거르기를 풀면 직전 펼침으로 돌아간다. 자료실에 들어올 때는 맨 위 단만(결정 D13).
let luGroupBy='project',luSessionFolder=false,luFolders_=[],luFolderItems=[],luOrganizations=null,luMyOrganizations=[],luOrganizationsLoading=null,luLastTree=[],luFilterSignature='';
const luOpened=new Set(),luFilterOpen=new Map(),luShowAll=new Set();
function luResetTree(){luOpened.clear();luFilterOpen.clear();luShowAll.clear();luFilterSignature=''}
// 폴더 표(app_library_folders·_items, 소유자 RLS)는 읽기만 한다. 표가 없거나 읽기에 실패하면 폴더 없이 그대로 그린다.
async function luLoadFolders(){if(!luWorkspace)return;const w=encodeURIComponent(luWorkspace);try{const [folders,items]=await Promise.all([readLibraryFolders(luApi,luWorkspace),luApi('/rest/v1/app_library_folder_items?workspace_id=eq.'+w+'&select=document_id,folder_id')]);luFolders_=Array.isArray(folders)?folders:[];luFolderItems=Array.isArray(items)?items:[];luFoldersReady=true}catch{luFolders_=[];luFolderItems=[];luFoldersReady=false}}
async function luLoadAll(){await Promise.all([luLoadDocuments(),luLoadFolders()])}
// TRASH-다른삭제 3단계: 보관 창 휴지통에서 폴더를 되돌리거나 영구 삭제하면 이미 열려 있는 자료실도 폴더 표를 다시 읽는다(안 열렸으면 처음 열 때 읽는다).
window.addEventListener('kptu:library-folders-changed',()=>{if(!luWorkspace)return;void luLoadFolders().then(()=>luRenderLibrary()).catch(()=>{})});
// 담당조직 묶기·일괄 바꾸기를 처음 고를 때 한 번 읽는다(조직 순서는 organization-order.js). 실패하면 조직 이름 없이 묶는다.
// 묶기(이미 붙은 자료 보여 주기)는 모든 조직 이름을 쓰고, 일괄 바꾸기(고르기 칸)는 내 담당조직만 쓴다(my-organizations.js, ORG-고르기통일).
function luLoadOrganizations(){if(luOrganizations||luOrganizationsLoading||!luWorkspace)return luOrganizationsLoading;const user=luUser?.id||'';luOrganizationsLoading=Promise.all([luApi('/rest/v1/app_suborganizations?workspace_id=eq.'+encodeURIComponent(luWorkspace)+'&select=id,name,active&order=id.asc'),user?luApi('/rest/v1/app_suborganization_assignees?user_id=eq.'+encodeURIComponent(user)+'&select=organization_id').catch(()=>[]):[],import('./organization-order.js')]).then(([rows,assignees])=>{const sort=list=>window.KPTUOrganizationOrder?.sort?.(list)||list;luOrganizations=sort(rows||[]);luMyOrganizations=sort(pickMyOrganizations(rows||[],Array.isArray(assignees)?assignees:[]))}).catch(()=>{luOrganizations=[];luMyOrganizations=[]}).finally(()=>{luOrganizationsLoading=null;luRenderLibrary()});return luOrganizationsLoading}
// 일괄 바꾸기의 담당조직 칸: 내 담당조직만. 고른 자료가 모두 이미 붙어 있는 조직(지금 값)이 담당 밖이면 그 한 곳만 함께 보여 지금 값을 알 수 있게 한다.
function luBulkOrganizations(cur){const order=window.KPTUOrganizationOrder,mine=luMyOrganizations||[];const now=cur&&!mine.some(o=>o.id===cur)?(luOrganizations||[]).find(o=>o.id===cur):null;const list=now?(order?.sort?order.sort([...mine,now]):[...mine,now]):mine;return order?.forPicker?order.forPicker(list,cur?[cur]:[]):list}
const luKindKey=k=>k==='파일'?'other':k==='그림'?'img':k==='웹'?'web':k.toLowerCase();
// LIB-위쪽한줄(11/09 명진 B·가안): 묶기(폴더·사업영역·담당조직·분류·월별)는 폰·폴드·PC 모두 위 줄 고르기 상자 [폴더 ▾] 하나다(아래 알약·칩 줄은 없앴다).
// 보이는 순서는 서버에 기억한 묶기 순서(library_view.group_order) 그대로이고, 폴더 표를 못 읽으면 [폴더]는 없다. 고른 값 기억은 지금처럼 groupBy.
function luGroupOptions(){return orderedGroups(luGroupOrder).filter(value=>value!=='folder'||luFoldersReady)}
function luRenderGroupBy(){
  const host=document.querySelector('#libraryGroupBy');if(!host)return;
  const options=luGroupOptions(),sig=options.join(',');
  if(host.dataset.luOptions!==sig){host.dataset.luOptions=sig;host.innerHTML=options.map(value=>`<option value="${value}">${luEsc(GROUP_LABELS[value])}</option>`).join('')}
  if(host.value!==luGroupBy)host.value=luGroupBy;
  if(!host.dataset.luBound){host.dataset.luBound='1';host.addEventListener('change',()=>luChooseGroup(host.value))}
}
function luChooseGroup(value){if(value===luGroupBy||!luGroupOptions().includes(value))return;luGroupBy=value;luInFolder=null;luOutOnly=false;luSessionFolder=value==='folder';luUserChangedView('groupBy');luOpened.clear();luFilterOpen.clear();luShowAll.clear();if(value==='organization')luLoadOrganizations();luRenderLibrary()}
function luFiltering(q,pid){const names=topDocumentCategories(),off=names.filter(n=>luCategoryOff.has(n)),base=names.filter(n=>luBaselineOff.has(n)),categories=off.length>0&&!(off.length===base.length&&off.every(n=>base.includes(n)));return !!(q||luOrganization||(pid&&pid!=='all')||categories||activeSubcategory(names,luCategoryOff,luCategorySub))}
function luIsOpen(key,filtering,matched){return filtering?(luFilterOpen.has(key)?luFilterOpen.get(key):matched.has(key)):luOpened.has(key)}
// LIB-맨위메뉴하나(빠짐9, 요청 10/28 08:25 ①): [모두 펴기·접기]는 자료실 칸 맨 위 ⋯ 메뉴 한 줄. 지금 상태(토글 수·모두 열림)는 메모리에만 둔다.
let luExpandNow={count:0,open:false};
function luRenderExpandAll(filtering,matched){const all=luTreeKeys(luLastTree);luExpandNow={count:all.length,open:all.length>0&&all.every(k=>luIsOpen(k,filtering,matched))}}
function luExpandAll(){const all=luTreeKeys(luLastTree),open=!luExpandNow.open;if(luFilterSignature&&luFilterSignature!=='-')for(const k of all)luFilterOpen.set(k,open);else{luOpened.clear();if(open)all.forEach(k=>luOpened.add(k))}luRenderLibrary()}
// LIB-폴더100단 ②(2026-10-28 10:34): 깊은 폴더는 '들어가기'로 그 폴더만 본다(탐색기 방식, PC·폰 같게). 상태 주인은 luInFolder(폴더 id, 화면 메모리만).
// 들어가면 목록은 그 폴더 하나(열린 채, 들여쓰기는 그 폴더 기준 0단부터)이고, 목록 위 위치 줄 '자료실 › 조직 › 민자도시철도'의 칸을 누르면 그 단계로 간다.
// 폴더 묶기에서만 쓰고, 묶기를 바꾸거나 폴더가 사라지면(지움·휴지통) 저절로 '자료실'로 돌아온다. 검색·분류 칩 거르기는 들어간 폴더 안에서 그대로 걸린다.
let luInFolder=null;
// FILES-폰폴더위로 ⑤: 폰 '그 폴더만'에서 하위 폴더로 한 단계씩 내려온 길(folder-walk.mjs, 파일·노트·사진과 같은 규칙). 화면 메모리만.
let luWalk=[];
// S55-08 LIB-나무폴더밖: 왼쪽 나무 '폴더 밖' 줄을 누르면 오른쪽은 폴더 밖 자료만(luOutOnly, 화면 메모리만). 폴더로 들어가거나 '자료실 전체'를 누르면 풀린다.
// 뒤로가기는 폴더로 들어갈 때와 같은 라우터 한 겹(library-out)으로 한 단계 위(자료실 전체).
let luOutOnly=false,luOutLayer=null;
const luRebase=(n,base)=>({...n,depth:n.depth-base,children:n.children.map(c=>luRebase(c,base))});
// NAV-새로고침제자리: the folder entered is written to the address (?view=library&folder=<id>, no history entry of its own), so a reload
// enters it again. The address is read when the screen loads (luTakePlace) and applied when the list is drawn after the folders are read.
// A folder can only be entered in 폴더 묶기, so the address also says the 묶기: once the folders are read, a folder written in the address
// opens 폴더 묶기 for this visit (like luSessionFolder; nothing new is saved) unless the person already chose another 묶기 on this visit.
// The server's remembered 묶기 may not be saved yet when the page is reloaded right after choosing 폴더, so it is not waited for.
let luPlaceFolder=null;
function luApplyPlaceFolder(){
  if(!luPlaceFolder||!luFoldersReady)return;
  const id=luPlaceFolder;luPlaceFolder=null;
  if(!luFolders_.some(f=>f.id===id)||(luGroupBy!=='folder'&&luViewPending.has('groupBy')))return;
  if(luGroupBy!=='folder'){luGroupBy='folder';luSessionFolder=true;luOpened.clear();luFilterOpen.clear();luShowAll.clear()}
  luInFolder=id;luOpened.add('f:'+id);
}
function luTakePlace(){const q=new URLSearchParams(globalThis.location?.search||''),id=q.get('folder')||'';luPlaceFolder=q.get('view')==='library'&&/^[A-Za-z0-9_.:-]{1,80}$/.test(id)?id:null}
function luFolderScope(tree){
  if(luInFolder&&(luGroupBy!=='folder'||!luFolders_.some(f=>f.id===luInFolder)))luInFolder=null;
  // 폴더 밖 겹을 먼저 맞춘 뒤(닫힐 것은 닫고) 폴더 겹을 맞춘다 — 두 겹이 동시에 열려 있지 않게.
  const outNode=luOutOnly&&!luInFolder&&luGroupBy==='folder'?tree.find(n=>n.key===OUT_KEY):null;
  if(!outNode)luOutOnly=false;
  luSyncOutLayer();
  luSyncFolderLayer();
  if(!luPlaceFolder)window.KPTURouter?.setPlace?.('library',{folder:luInFolder});
  if(outNode)return [outNode];
  if(!luInFolder)return tree;
  let found=null;luTreeWalk(tree,n=>{if(!found&&n.key==='f:'+luInFolder)found=n});
  return found?[luRebase(found,found.depth)]:[];
}
// LIB-폴더100단(10:34): 들어간 폴더는 라우터 한 겹(BUG-뒤로가기 공용 규칙 KPTURouter.layer). 폰 뒤로가기(갤럭시 뒤로)·브라우저 뒤로 = 한 단계 위.
// 뒤로로 겹이 닫히면 위 폴더로 올라가고, 위 폴더가 남아 있으면 그 폴더의 겹을 새로 연다(라우터가 닫힌 겹을 정리한 뒤, 같은 주소 기록 1개).
// 맨 위(자료실)에 닿으면 겹 없음. 위치 줄·묶기 바꾸기로 '자료실'에 돌아오면 겹을 스스로 닫는다. 선택 모드·메뉴 겹이 위에 있으면 그것부터 닫힌다.
// 다른 화면으로 가면 라우터가 겹을 잊는다(luBindList).
let luFolderLayer=null,luFolderStepping=false;
function luSyncFolderLayer(){
  if(luFolderStepping)return;
  // NAV-PC앞뒤통일: › (or the browser's forward) over the folder's entry enters the same folder again (reopen).
  const reopenId=luInFolder;
  if(luInFolder&&!luFolderLayer&&window.KPTURouter?.current==='library')luFolderLayer=window.KPTURouter?.layer?.open('library-folder',{reopen:()=>luEnterFolder(reopenId),close:()=>{
    // FILES-폰폴더위로 ⑤: '그 폴더만'에서 한 단계씩 내려왔으면 [‹]와 같이 한 단계 위(돌아올 나무 자리는 그대로).
    // FOLDER-나무새기준 ④: 들어온 폴더(두 손가락)에서는 뒤로 키 한 번에 펼친 자리 그대로 나무로.
    const step=LU_PHONE?.matches?walkUp(luWalk):{to:null,walk:[]};
    const back=step.to?null:luTreeBack;if(!step.to)luTreeBack=null;
    const up=step.to||(back?null:luFolders_.find(f=>f.id===luInFolder)?.parent_id||null);luWalk=step.walk;
    if(back)queueMicrotask(()=>luRestoreTree(back));
    luInFolder=up&&luFolders_.some(f=>f.id===up)?up:null;luFolderLayer=null;
    if(luInFolder)luOpened.add('f:'+luInFolder);
    luFolderStepping=true;try{luRenderLibrary()}finally{luFolderStepping=false}
    if(luInFolder)queueMicrotask(luSyncFolderLayer);
    return true;
  }})||null;
  else if(!luInFolder&&luFolderLayer){const l=luFolderLayer;luFolderLayer=null;l.close()}
}
// FOLDER-나무새기준 ④(S51-12): 폴더 묶기에서 펼친 폴더 위 두 손가락 벌리기 = 그 폴더만(들어가기와 같은 화면, [‹] 위치 줄),
// 오므리기·[‹]·뒤로 키 = 펼친 자리·화면 위치 그대로 나무로. 돌아올 자리는 화면 메모리만(luTreeBack).
let luTreeBack=null,luPinchNav=false; // luPinchNav: 이번 두 손가락이 왼쪽 나무 줄 위에서 시작했나(UI-폴더누르기한규칙)
function luFocusFolder(id){if(luGroupBy!=='folder'||luInFolder||!id||!luFolders_.some(f=>f.id===id))return;luTreeBack={y:window.scrollY,id};luOpened.add('f:'+id);luEnterFolder(id)}
function luRestoreTree(back){if(!back)return;settleGestureAreas();window.scrollTo({top:back.y,behavior:'instant'});const head=[...document.querySelectorAll('#documentList summary.lu-node-head')].find(h=>h.parentElement?.dataset.luNode==='f:'+back.id);head?.focus?.({preventScroll:true})}
// FILES-폰폴더위로 ①④⑤: [‹]·화면 왼쪽 끝 밀기(뒤로 키도 같은 규칙) = 내려온 길이면 한 단계 위, 들어온 폴더면 나무로. 오므리기·'자료실'은 늘 나무(luLeaveFocus).
function luFocusUp(){if(!luInFolder)return;const step=LU_PHONE?.matches?walkUp(luWalk).to:null;if(step){luEnterFolder(step);return}luLeaveFocus()}
function luLeaveFocus(){if(!luInFolder)return;const back=luTreeBack;luTreeBack=null;luEnterFolder(null);luRestoreTree(back)}
document.addEventListener('click',e=>{const b=e.target.closest?.('#libraryPath [data-lu-path-back]');if(!b)return;e.preventDefault();luFocusUp()});
function luRenderPath(box){
  let nav=document.querySelector('#libraryPath');
  if(luTwoActive()){nav?.remove();return} // LIB-두칸보기: 두 칸은 칸마다 위치 줄
  if(!luInFolder){nav?.remove();return}
  // NOTE-탐색기 후속 ⑧: 위치 줄은 노트와 같은 공용 부품(folder-path.mjs, 모양 base-ui.css .fp-path).
  if(!nav){nav=document.createElement('nav');nav.id='libraryPath';nav.setAttribute('aria-label','지금 위치');box.before(nav)}
  // S51-24 FOLDER-그폴더만같은모양: 폰 '그 폴더만'은 나무와 같은 상자 — 위치 줄을 목록 상자 맨 위 작은 회색 줄(공용 .ft-focus-anc)로,
  // 바로 아래 그 폴더 줄(열린 폴더 그림 + 굵은 이름 + 개수)이 상자 머리. 맨 앞 '자료실'은 [‹]처럼 펼친 자리 그대로 나무로. 넓은 화면은 지금 위치 줄 그대로.
  const phone=!!LU_PHONE?.matches,trail=folderTrail(luFolders_,luInFolder);
  nav.className=phone?'ft-focus-anc lu-focus-anc':'fp-path';
  nav.innerHTML=phone?`<button type="button" class="ft-btn ft-focus-back" data-lu-path-back aria-label="${walkUpLabel(luWalk)}" title="${walkUpLabel(luWalk)}">‹</button>`+[{id:'',name:'자료실'},...trail.slice(0,-1)].map(f=>`<button type="button" class="ft-btn ft-focus-step" data-lu-path="${luEsc(f.id)}">${luEsc(f.name)}</button><span class="ft-focus-sep" aria-hidden="true">›</span>`).join('')
    :'<button type="button" class="ft-btn ft-focus-back" data-lu-path-back aria-label="폴더 나무로">‹</button>'+folderPathHtml({rootLabel:'자료실',trail:folderTrail(luFolders_,luInFolder),attr:'data-lu-path',esc:luEsc});
  nav.hidden=false;
}
// FILES-폴드나무목록 ⑦(S51-20 ④, 시안 docs/design/mockups/files-fold-tree-list.html '같은 종류'): 펼친 폴드·PC(600px~, 공용 판정 screen-width.mjs)에서
// 폴더 묶기면 왼쪽 폴더 나무 | 오른쪽 목록. 나무 줄을 누르면 그 폴더로 들어간다(상태 주인은 그대로 luInFolder — 위치 줄·뒤로가기·주소 같은 길).
// 나무는 같은 묶기 계산(buildTree) 결과의 폴더만 그린다(거르기·순서·색 같음). 펼침: 들어간 폴더까지의 길 + 들어간 폴더 + 사람이 펼친 폴더(화면 메모리만).
// 줄 모양은 공용 폴더 줄(folder-tree-ui.mjs). 폰(600px 미만)은 지금처럼 목록 안 토글 나무 하나.
const LU_SPLIT=typeof matchMedia==='function'?matchMedia(SPLIT_QUERY):null;
// LIB-두칸보기(S55-11, 시안 library-two-pane.html): [▥ 두 칸] 켬(서버 view_prefs.library_two, 없으면 켬)이고 PC·펼친 폴드(600px~)·폴더 묶기면
// 왼쪽 나무 대신 두 칸(양쪽 다 폴더 줄 + 자료 줄, 칸마다 위치·정렬). 폰·다른 묶기는 지금 한 칸 목록. 두 칸 부품은 library-two-pane.js(틀은 [파일]과 같은 two-pane.js).
let luTwo=null,luPinchEl=null; // luPinchEl: 두 손가락 가운데 요소(두 칸에서 어느 칸 손짓인지)
const luTwoActive=()=>!!luTwo&&!!LU_SPLIT?.matches&&luGroupBy==='folder'&&luFoldersReady&&viewPrefs.getLibraryTwo?.()!==false;
function luMakeTwo(){
  if(luTwo||!document.querySelector('#libraryListCard'))return;
  luTwo=createLibraryTwo({on:luTwoActive,ready:()=>luFoldersReady,folders:()=>luFolders_,rightFolder:()=>luInFolder,enterRight:id=>luEnterFolder(id),render:()=>luRenderLibrary(),
    rowHtml:(d,node)=>luDragRowHtml(d,node),toggle:luTwoToggle,canDrag:()=>luCanDrag(),ui:()=>luFolders(),picked:()=>luPick.items?[...luPick.items].filter(id=>luDocuments.some(d=>d.id===id)):[],
    busy:()=>luSelBusy||!!luFolderUi?.busy,say:text=>notify(text,{record:false}),esc:luEsc});
  luTwo.bind();
}
// 위쪽 줄 [▥ 두 칸] 켬/끔: 두 칸을 쓸 수 있는 폭·묶기에서만 단추가 있다(없는 곳에서는 지운다 — 숨김 아님).
function luRenderTwoToggle(){
  const host=document.querySelector('#libraryView .lu-head-actions');if(!host)return;
  let b=host.querySelector('#libraryTwoBtn');
  if(!(LU_SPLIT?.matches&&luGroupBy==='folder'&&luFoldersReady)){b?.remove();return}
  if(!b){host.insertAdjacentHTML('afterbegin','<button id="libraryTwoBtn" class="secondary lu-two-toggle" type="button" aria-pressed="false" aria-controls="documentList">▥ 두 칸</button>');b=host.querySelector('#libraryTwoBtn');
    b.addEventListener('click',()=>{const on=viewPrefs.getLibraryTwo?.()!==false;viewPrefs.setLibraryTwo?.(!on);luRenderLibrary();document.querySelector('#libraryTwoBtn')?.focus({preventScroll:true})})}
  b.setAttribute('aria-pressed',String(viewPrefs.getLibraryTwo?.()!==false));
}
const luNavOpen=new Set(),luNavShut=new Set(); // S51-25: 아이콘으로 접은 폴더(들어간 폴더의 길이어도 접힌 채)
function luNavPath(){const out=new Set();let f=luFolders_.find(x=>x.id===luInFolder),n=0;while(f&&n<120){out.add(f.id);f=f.parent_id?luFolders_.find(x=>x.id===f.parent_id):null;n++}return out}
function luRenderFolderNav(tree){
  const card=document.querySelector('#libraryListCard');if(!card)return;
  const on=!!LU_SPLIT?.matches&&luGroupBy==='folder'&&luFoldersReady&&!luTwoActive(); // LIB-두칸보기: 두 칸이면 왼쪽 나무 자리에 왼쪽 칸
  let nav=card.querySelector(':scope > #libraryFolderNav');
  if(!on){if(nav)nav.remove();delete card.dataset.luSplit;return}
  if(!nav){nav=document.createElement('nav');nav.id='libraryFolderNav';nav.className='lu-fnav';nav.setAttribute('aria-label','자료실 폴더');card.prepend(nav)}
  card.dataset.luSplit='1';
  const path=luNavPath(),rows=[];
  const walk=(list,depth)=>{for(const n of list||[]){if(n.kind!=='folder')continue;const kids=(n.children||[]).filter(c=>c.kind==='folder'),open=kids.length>0&&!luNavShut.has(n.id)&&(path.has(n.id)||luNavOpen.has(n.id));
    rows.push(ftFolderRowHtml({name:n.label,count:n.count,countLabel:`${n.count}건`,depth,open,hasContent:kids.length>0,color:n.fc,current:n.id===luInFolder,tree:true,mainAttrs:luCanDrag()?{'data-lu-nav':n.id,draggable:'true'}:{'data-lu-nav':n.id},toggle:{attrs:{'data-lu-nav-tog':n.id},label:`${n.label} ${open?'접기':'펼치기'}`}}));
    if(open)walk(kids,depth+1)}};
  walk(tree,0);
  const all=!luInFolder&&!luOutOnly;
  const top=`<div class="ft-row ft-folder ft-top lu-fnav-root${all?' ft-current':''}" role="treeitem"><button type="button" class="ft-btn ft-main" data-lu-nav=""${all?' aria-current="true"':''}><span class="ft-name">자료실 전체</span></button></div>`;
  // S55-08 LIB-나무폴더밖: '자료실 전체' 바로 아래(폴더들 위) '폴더 밖 n' — 오른쪽 목록의 '폴더 밖' 묶음과 같은 그림·같은 개수·같은 규칙(비면 줄 없음, LIB-정리보충).
  const outNode=(tree||[]).find(n=>n.key===OUT_KEY);
  const out=outNode?ftFolderRowHtml({name:outNode.label,count:outNode.count,countLabel:`${outNode.count}건`,depth:0,hasContent:false,current:luOutOnly,tree:true,className:'lu-fnav-out',icon:treeIconHtml('outside',{className:'ft-ico'}),mainAttrs:{'data-lu-nav':OUT_KEY}}):'';
  nav.innerHTML=`<div class="lu-fnav-in" role="tree" aria-label="자료실 폴더 나무">${top}${out}${rows.join('')}</div>`;
}
// S51-25 FOLDER-PC나무 → UI-폴더누르기한규칙(S57-5): 줄(이름·아이콘) 누르기 = 오른쪽은 그대로 두고 그 자리에서 펼치기·접기만(세모 없음). 들어가기 = 우클릭 [이 폴더로 들어가기]·두 손가락 벌리기.
document.addEventListener('click',e=>{
  const t=e.target.closest?.('#libraryFolderNav [data-lu-nav-tog]');
  if(t){e.preventDefault();const id=t.dataset.luNavTog;if(t.getAttribute('aria-expanded')==='true'){luNavShut.add(id);luNavOpen.delete(id)}else{luNavShut.delete(id);luNavOpen.add(id)}luRenderLibrary();document.querySelector(`#libraryFolderNav [data-lu-nav-tog="${CSS.escape(id)}"]`)?.focus({preventScroll:true});return}
  const b=e.target.closest?.('#libraryFolderNav [data-lu-nav]');if(!b)return;
  e.preventDefault();if(ftPressToggle(b))return; // UI-폴더누르기한규칙: 폴더 줄 이름 누르기 = 아이콘 누르기와 같은 펼치기·접기(오른쪽·위치 줄 그대로). 들어가기는 우클릭 [이 폴더로 들어가기]·두 손가락
const id=b.dataset.luNav||null; // 폴더가 아닌 줄('자료실 전체'·'폴더 밖')만 여기까지 온다
  if(id===OUT_KEY){luTreeBack=null;luShowOut();document.querySelector(`#libraryFolderNav [data-lu-nav="${OUT_KEY}"]`)?.focus({preventScroll:true});return}
  luTreeBack=null;luEnterFolder(id);
  document.querySelector(`#libraryFolderNav [data-lu-nav="${CSS.escape(id||'')}"]`)?.focus({preventScroll:true});
});
ftBindTreeArrows();
LU_SPLIT?.addEventListener?.('change',()=>{if(document.querySelector('#libraryListCard'))luRenderLibrary()});
function luShowOut(){if(luGroupBy!=='folder')return;luInFolder=null;luOutOnly=true;luRenderLibrary();document.querySelector('#documentList')?.scrollIntoView?.({block:'nearest'})}
function luSyncOutLayer(){
  if(luOutOnly&&!luOutLayer&&window.KPTURouter?.current==='library')luOutLayer=window.KPTURouter?.layer?.open('library-out',{reopen:()=>luShowOut(),close:()=>{luOutLayer=null;if(!luOutOnly)return true;luOutOnly=false;luRenderLibrary();return true}})||null;
  else if(!luOutOnly&&luOutLayer){const l=luOutLayer;luOutLayer=null;l.close()}
}
function luEnterFolder(id){
  if(luGroupBy!=='folder'||(id&&!luFolders_.some(f=>f.id===id)))return;
  // FILES-폰폴더위로 ⑤: 지금 폴더의 하위 폴더로 들어가면 한 단계 내려옴(길에 더함), 위 단계면 길을 거기까지.
  luWalk=walkTo(luWalk,id||'',{down:!!luInFolder&&!!id&&luFolders_.find(f=>f.id===id)?.parent_id===luInFolder});
  luOutOnly=false;luInFolder=id||null;if(luInFolder)luOpened.add('f:'+luInFolder);luRenderLibrary();
  const list=document.querySelector('#documentList');list?.scrollIntoView?.({block:'nearest'});
  const head=luInFolder?[...document.querySelectorAll('#documentList summary.lu-node-head')].find(h=>h.parentElement?.dataset.luNode==='f:'+luInFolder):null;
  (head||document.querySelector('#libraryPath [data-lu-path]'))?.focus?.({preventScroll:true});
}
document.addEventListener('click',e=>{const b=e.target.closest?.('#libraryPath [data-lu-path]');if(!b)return;e.preventDefault();if(!b.dataset.luPath&&luTreeBack)luLeaveFocus();else luEnterFolder(b.dataset.luPath||null)});
// 폴더 줄을 두 번 누르면(PC 더블클릭, 폰 두 번 탭) 그 폴더로 들어간다. 첫 번째 누름의 펼치기·접기는 그대로 일어나고, 들어간 폴더는 열린 채로 보인다.
document.addEventListener('dblclick',e=>{
  const head=e.target.closest?.('#documentList summary.lu-node-head');if(!head||luGroupBy!=='folder'||e.target.closest('input,button,a'))return;
  const key=head.parentElement?.dataset.luNode||'';if(!key.startsWith('f:')||key==='f:'+luInFolder)return;
  e.preventDefault();window.getSelection?.()?.removeAllRanges?.();luEnterFolder(key.slice(2));
});
function luRenderLibrary(){const box=document.querySelector('#documentList');if(!box)return;luRenderTwoToggle();const focusId=box.contains(document.activeElement)&&document.activeElement.matches('[data-lu-document]')?document.activeElement.dataset.luDocument:'';luApplyPlaceFolder();luCloseMenu();luRenderGroupBy();luSyncFind();luRenderProjectFilter();luRenderOrganizationFilter();const q=(document.querySelector('#documentSearch')?.value||'').trim().toLowerCase(),pid=document.querySelector('#documentProject')?.value||'all',scope=luProjectScope(pid);const inTrash=documentsInTrashedFolders(luFolders_,luFolderItems,luFoldersReady);const found=luListDocs().filter(d=>!inTrash.has(d.id)&&(!scope||scope.has(d.project_id))&&(!luOrganization||d.organization_id===luOrganization.id)&&(!q||[d.title,d.file_name,d.source,d.category,categoryOf(d.category),(d.tags||[]).join(' ')].join(' ').toLowerCase().includes(q)));luRenderCategoryFilter(categoryCounts(topDocumentCategories(),found));const hiddenNow=luHiddenCategories(),matches=found.filter(d=>luCategoryShown(categoryOf(d.category),hiddenNow));// UI-바구니거르기: the [일반 자료|회의자료만] row is gone; meeting documents show with the rest; the [회의] chip turns them on/off (UI-PC자료실 C: off by default).
luSyncSearchPickAll(q,matches);
const filtering=luFiltering(q,pid),signature=filtering?JSON.stringify([q,[...luCategoryOff].sort(),luCategorySub,luOrganization?.id||'',pid,luGroupBy]):'-';if(signature!==luFilterSignature){luFilterOpen.clear();luFilterSignature=signature}
if(luGroupBy==='organization'&&!luOrganizations)luLoadOrganizations();
const tree=buildTree({groupBy:luGroupBy,docs:matches,filtering,tree:luCatalog()?.tree||[],folders:luFolders_,items:luFolderItems,organizations:luOrganizations||[],categories:orderedDocumentCategories(),categoryOf,categoryLabel,projectName:luProjectName,sortKey:luSortKey,monthLabel:luMonthLabel});
if(luTwoActive())luOutOnly=false;const shown=luFolderScope(tree),inKey=luInFolder?'f:'+luInFolder:luOutOnly?OUT_KEY:'';
luLastTree=shown;const matched=filtering?matchedKeys(luTwoActive()?tree:shown):new Set();luTwins=twinPlan(luTwoActive()?luTwo.shownNodes(tree,luTwoOpen=k=>luIsOpen(k,filtering,matched)):shown);
// LIB-정리보충 ③: 폴더 묶기의 '폴더 밖' 자료마다 작게 '📁 ○○?' 추천(AI 없음, 고르는 중에는 숨김). 누르면 그 폴더로 옮기고 '옮겼어요 · 되돌리기'.
luSuggest=luGroupBy==='folder'&&!luPick.items?folderSuggestions(tree.find(n=>n.key==='x:out')?.files||[],{docs:luDocuments,items:luFolderItems,folders:luFolders_,categoryOf}):new Map();
const html=luTwoActive()?luTwo.html(tree):((inKey?shown.length>0:(matches.length||tree.some(n=>n.children.length)||(luGroupBy==='folder'&&!filtering)))?treeHtml(shown,{isOpen:k=>k===inKey||luIsOpen(k,filtering,matched),showAll:k=>luShowAll.has(k),fileHtml:luDragRowHtml,esc:luEsc,menu:luNodeMenuLabel,canDrag:n=>luCanDrag()&&n.kind==='folder',pick:luNodePick,emoji:luGroupBy==='folder'}):'');
luRenderPath(box);luRenderFolderNav(tree);box.innerHTML=(html||(globalThis.KPTUWait?.emptyHtml?.(!inKey&&topDocumentCategories().every(n=>luCategoryOff.has(n))?'선택한 분류 없음':'없음')||''))+(q?luOffHint(found.filter(d=>!luCategoryShown(categoryOf(d.category),hiddenNow))):'');// 다시 그려도 초점이 있던 자료 줄에 초점을 돌려준다(다른 화면이 짚어 연 줄이 늦게 끝난 읽기의 다시 그리기로 초점을 잃지 않게).
if(focusId)box.querySelector(`[data-lu-document="${CSS.escape(focusId)}"]`)?.focus({preventScroll:true});luRenderExpandAll(filtering,matched);luMarkLongNames(box);if(luTwoActive())luTwo.after(SPLIT_QUERY);hydrateLibraryThumbs(box);mountReportPhotos(box,{isCurrent:()=>box.isConnected});luRenderRecent(matches);luAfterRender()}
// LIB-최근올린파일 (2026-10-27 17:01 요청): 묶기 칩 바로 아래 작은 칸. 서버에 있는 올린 시각(created_at) 기준 최근 5개(더보기 15개)를 줄마다
// 종류·제목·들어간 묶음·올린 시각으로 보이고, 줄을 누르면 아래 목록에서 그 파일이 든 묶음을 펴고 그 줄로 가서 잠깐 강조한다.
// 지금 목록에 보이는 자료(검색·종류 칩·담당조직·프로젝트 거르기 적용)만 대상이라 눌렀을 때 줄이 반드시 있다. 펼침 상태는 화면 메모리만(저장 안 함).
let luRecentMore=false,luFlashTimer=0;
function luRenderRecent(rows){
  const box=document.querySelector('#libraryRecent');if(!box)return;
  const all=recentUploads((rows||[]).filter(d=>!isPhotoSet(d)),{limit:RECENT_UPLOAD_MORE});
  if(!all.length){box.hidden=true;box.innerHTML='';return}
  const shown=luRecentMore?all:all.slice(0,RECENT_UPLOAD_LIMIT),now=Date.now(),more=all.length>RECENT_UPLOAD_LIMIT;
  const where=d=>{const key=pathTo(luLastTree,d.id).at(-1);return key?luTreeNode(key)?.label||'':''};
  box.hidden=false;
  // S51-22: 머리 줄을 누르면 접기(서버 view_prefs.recent_folded — recent-fold.js). 접으면 머리 줄 한 줄만.
  // S51-33 UI-접기꺾쇠: 꺾쇠는 이름 바로 옆(공용 꺾쇠), '더보기 ›'는 오른쪽 글자 단추.
  const shut=recentFolded('library');
  const head=`<div class="lu-recent-head"><button type="button" class="lu-recent-title lu-recent-fold" id="libraryRecentTitle" data-lu-recent-fold aria-expanded="${!shut}" aria-controls="libraryRecentList">최근 올린 파일${ftCaretHtml(!shut)}</button>${more&&!shut?`<button type="button" class="lu-more-files lu-recent-more" data-lu-recent-more aria-expanded="${luRecentMore}" aria-controls="libraryRecentList">${luRecentMore?'접기':MORE_LABEL}</button>`:''}</div>`;
  if(shut){box.innerHTML=head+'<ul class="lu-recent-list" id="libraryRecentList" hidden></ul>';return}
  box.innerHTML=`${head}<ul class="lu-recent-list" id="libraryRecentList" aria-labelledby="libraryRecentTitle">${shown.map(d=>{
    const name=luPhone()?luDisplayName(d).name:(d.title||d.file_name||'파일'),kind=luFileKind(d.file_name,d.mime_type);
    return `<li><div class="lu-recent-row" role="button" tabindex="0" data-lu-recent="${luEsc(d.id)}"><span class="lu-file-kind" data-lu-kind="${luKindKey(kind)}">${kind}</span><span class="lu-recent-name">${luEsc(name)}</span><span class="lu-recent-where">${luEsc(where(d))}</span><span class="lu-recent-time">${luEsc(uploadTimeLabel(d,now))}</span></div></li>`}).join('')}</ul>`;
}
// 최근 칸의 줄: 그 파일이 든 묶음을 위 단까지 펴고 그 줄로 가서 잠깐 강조한다(눈에 띄는 움직임은 prefers-reduced-motion이면 색만 잠깐).
function luGoToRecent(id){
  luRevealInTree(id);
  const row=[...document.querySelectorAll('#documentList [data-lu-document]')].find(x=>x.dataset.luDocument===id);if(!row)return;
  row.scrollIntoView({block:'center'});row.focus({preventScroll:true});
  document.querySelectorAll('#documentList .lu-flash').forEach(x=>x.classList.remove('lu-flash'));void row.offsetWidth;row.classList.add('lu-flash');
  clearTimeout(luFlashTimer);luFlashTimer=setTimeout(()=>row.classList.remove('lu-flash'),1900);
}
function luBindRecent(){
  const box=document.querySelector('#libraryRecent');if(!box||box.dataset.luBound)return;box.dataset.luBound='1';
  // LIB-후속1 ②: 최근 올린 파일 줄도 우클릭(폰은 꾹 누르기 = 브라우저 contextmenu)하면 자료 줄과 같은 메뉴를 누른 자리에 연다.
  box.addEventListener('contextmenu',e=>{
    const row=e.target.closest?.('[data-lu-recent]');if(!row||e.shiftKey)return;
    e.preventDefault();e.stopPropagation();
    // 메뉴는 그 줄을 누른 자리(⋯ 대신 줄 자체)에 붙인다. 줄 표시(data-lu-menu)는 이 메뉴를 여는 동안만 단다(목록 다시 그리면 사라짐).
    row.dataset.luMenu=row.dataset.luRecent;row.setAttribute('aria-controls','luMorePanel');
    window.KPTUContextMenu?.pinAt?.(row,e.clientX,e.clientY);luOpenMenu(row);
  });
  box.addEventListener('click',e=>{
    if(e.target.closest('[data-lu-recent-fold]')){toggleRecentFolded('library');luRenderLibrary();document.querySelector('#libraryRecent [data-lu-recent-fold]')?.focus({preventScroll:true});return}
    if(e.target.closest('[data-lu-recent-more]')){luRecentMore=!luRecentMore;luRenderLibrary();document.querySelector('#libraryRecent [data-lu-recent-more]')?.focus({preventScroll:true});return}
    const row=e.target.closest('[data-lu-recent]');if(row)luGoToRecent(row.dataset.luRecent);
  });
  box.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches?.('[data-lu-recent]')){e.preventDefault();luGoToRecent(e.target.dataset.luRecent)}});
}
// LIB-폴더로옮기기: 자료 ⋯·우클릭 메뉴의 [폴더로 옮기기 ›]. 선택 모드에서 이 줄이 고른 자료 가운데 하나면 고른 자료 모두, 아니면 이 줄만 옮긴다.
function luMoveDocs(id){const set=luPhotoSetKey(id);if(set!==null)return luPhotoSetMembers(set);const d=luDocuments.find(x=>x.id===id);if(!d)return [];return luPick.items&&luPick.items.size>1&&luPick.items.has(id)?luSelectedDocs():(luTwinDocs(id)||[d])}
function luToggleMove(button,forceOpen=false){
  const ui=luFolders(),same=ui.moveOpen&&button.getAttribute('aria-expanded')==='true';
  if(ui.moveOpen){void ui.closeMove();button.setAttribute('aria-expanded','false');if(same&&!forceOpen)return}
  const opened=ui.openMove(luMoveDocs(button.dataset.luMoveOpen),button,{place:'side',closeOuter:()=>new Promise(resolve=>luCloseMenu(resolve)),trigger:luActiveMenu?.trigger||button,all:luPhotoSetKey(button.dataset.luMoveOpen)!==null,onClosed:()=>button.setAttribute('aria-expanded','false')});
  if(opened)button.setAttribute('aria-expanded','true');
}
// 사용자가 토글을 여닫으면 그 상태만 기억한다(다시 그려도 유지). 그리기 중 생기는 toggle 이벤트도 같은 값이라 무해하다.
function luOnToggle(e){const d=e.target;if(!(d instanceof HTMLDetailsElement)||!d.dataset.luNode)return;const key=d.dataset.luNode;if(luFilterSignature!=='-')luFilterOpen.set(key,d.open);else if(d.open)luOpened.add(key);else luOpened.delete(key);const all=luTreeKeys(luLastTree);if(all.length)luExpandNow={count:all.length,open:[...document.querySelectorAll('#documentList details[data-lu-node]')].every(x=>x.open)}}
// LIB-토글트리 ③: 폴더 편집은 프로젝트 묶기에서만, 폴더 표를 읽었을 때만(표가 없으면 편집 없음). 활성 프로젝트(1~3단 모두)·'프로젝트 없음'·폴더 머리에 ⋯.
// 보관·옛 공간·확인 불가 연결 토글에는 두지 않는다(그 프로젝트는 프로젝트 화면에서 정리). 프로젝트 자체의 추가·이름·순서는 자료실에서 못 바꾼다(요구 ②).
let luFoldersReady=false,luFolderUi=null;
function luNodeMenuLabel(n){if((luGroupBy!=='project'&&luGroupBy!=='folder')||!luFoldersReady)return null;if(n.kind==='folder')return '폴더 관리: '+n.label;if(luGroupBy==='folder')return n.key==='x:out'?'폴더 만들기: 폴더 밖':null;if(n.kind==='group'&&!n.stale&&(n.projectId===null||luCatalog()?.tree?.some(x=>x.project.id===n.projectId)))return '폴더 만들기: '+n.label;return null}
// ④ PC 끌어 놓기: 마우스가 있는 넓은 화면(761px 이상)·폴더 표를 읽었을 때만. 폰·터치는 ⋯ 메뉴로 같은 일을 한다.
const LU_FINE=typeof matchMedia==='function'?matchMedia('(hover:hover) and (pointer:fine) and (min-width:761px)'):null;
const luFolderViews=()=>(luGroupBy==='project'||luGroupBy==='folder')&&luFoldersReady;
// LIB-폴더로옮기기 ③: 끌기는 어느 묶기에서나(종류·담당조직·월별은 왼쪽에 뜨는 놓을 곳 목록으로). 폰 길게 누르기는 폴더 토글이 보이는 묶기에서만(luFolderViews).
const luCanDrag=()=>!!LU_FINE?.matches&&luFoldersReady;
// 파일 줄은 그 프로젝트 틀에 폴더가 있을 때만 끌 수 있다(놓을 곳이 없으면 끌지 않음). 줄 HTML은 luRowHtml 그대로에 draggable만 붙인다.
let luSuggest=new Map();
// LIB-정리보충 ③: '🗂 폴더 밖' ⋯(꾹 누르기·우클릭) [전체 고르기] → 선택 모드로 그 안의 자료 모두 골라짐(접힌 것 포함). 몇 개 풀고 한꺼번에 [폴더로 옮기기].
// 반환: 고를 자료 수(0이면 메뉴에 항목을 내지 않음). go=true면 실제로 고른다.
function luSelectNode(key,go=false){const ids=nodeDocumentIds(luTreeNode(key));if(!go||!ids.length||luSelBusy)return ids.length;luPick.stop();luPick.start(ids);luRenderLibrary();return ids.length}
function luSuggestHtml(d,node){const fid=node?.key==='x:out'?luSuggest.get(d.id):null,f=fid&&luFolders_.find(x=>x.id===fid);if(!f)return '';return `<button type="button" class="lu-suggest" data-lu-suggest="${luEsc(d.id)}" data-lu-suggest-folder="${luEsc(f.id)}" aria-label="${luEsc(f.name)} 폴더로 옮기기">${iconHtml('folder')} ${luEsc(f.name)}?</button>`}
document.addEventListener('click',e=>{const b=e.target.closest?.('#documentList [data-lu-suggest]');if(!b)return;e.preventDefault();e.stopPropagation();void luFolders().moveDocsTo([b.dataset.luSuggest],b.dataset.luSuggestFolder)},true);
// 빠짐10(LIB-정리보충 ⑤): 같은 글의 원본 두 개(웹 + PDF/HWP)는 한 줄(대표 = 웹이 아닌 원본)로 묶고 줄 오른쪽 작은 [원본 n]으로 펼친다.
// 화면에서만 묶는다(자료 행은 그대로). 상태 주인: luTwins(이번 그리기의 묶음 계획)·luTwinOpen(펼친 대표 id, 화면 메모리만).
let luTwins=new Map();const luTwinOpen=new Set();
const luTwinFolded=id=>{const t=luTwins.get(id);return !!t&&!luTwinOpen.has(t.primary)};
const luTwinIds=ids=>withTwins(ids,luTwins,id=>luTwinOpen.has(id));
function luTwinDocs(id){const t=luTwins.get(id);if(!t||!t.isPrimary||luTwinOpen.has(t.primary))return null;return t.members.map(m=>luDocuments.find(x=>x.id===m)).filter(Boolean)}
function luDragRowHtml(d,node){const t=luTwins.get(d.id);if(t&&!t.isPrimary&&!luTwinOpen.has(t.primary))return '';let html=luDragRowHtml0(d,node);if(!t)return html;
  if(!t.isPrimary)return html.replace(/^<article (draggable="true" )?class="lu-row/,(m,drag)=>`<article ${drag||''}class="lu-row lu-row-twin`);
  const open=luTwinOpen.has(d.id),n=t.members.length;
  return html.replace('<button class="icon-btn lu-expand"',`<button type="button" class="lu-twin-btn" data-lu-twin="${luEsc(d.id)}" aria-expanded="${open}" aria-label="같은 글 원본 ${n}개 ${open?'접기':'펼치기'}">원본 ${n}</button><button class="icon-btn lu-expand"`);
}
function luDragRowHtml0(d,node){const html=luAddSuggest(luRowHtml(d,node),d,node);if((isPhotoSet(d)&&luGroupBy!=='folder')||!luCanDrag()||!(luGroupBy==='folder'||luGroupBy==='category'||luFolders_.some(f=>(f.project_id||null)===(d.project_id||null))))return html;return html.replace('<article class="lu-row','<article draggable="true" class="lu-row')}
// LIB-줄안이름바꾸기: 줄 우클릭·⋯ 메뉴의 [이름 바꾸기] 또는 줄을 고른 채 F2 → 창 없이 그 줄 제목이 입력칸이 된다(글자 전체 선택).
// Enter·바깥 누르기=저장, Esc=취소. 저장하면 줄 위 한 줄에 '이름을 바꿨어요 · 되돌리기'. 바꾸는 것은 Web2 제목뿐(Drive 원본 파일 이름 그대로).
// 저장은 [수정] 창과 같은 서버 길(app_documents PATCH)이고 제목 칸을 사용자 값('user')으로 남긴다(library-rename.js). 브라우저 저장소는 쓰지 않는다.
let luRename=null,luRenameBusy=false,luRenameNoticeToken=0,luKeepFocus=null;
function luBindRename(list){list.addEventListener('keydown',e=>{if(e.key!=='F2'||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey)return;const t=e.target;if(!(t instanceof Element)||t.closest('input,textarea,select,[contenteditable]'))return;const row=t.closest('[data-lu-document]');if(!row)return;e.preventDefault();luStartRename(row.dataset.luDocument)})}
function luRenameNotice(text,{error=false,undo=null}={}){
  const token=++luRenameNoticeToken;luFolderStatus(text,error);
  const el=document.querySelector('#libraryFolderStatusLine');if(!el||!text)return;
  if(undo){const b=document.createElement('button');b.type='button';b.className='lu-undo';b.textContent='되돌리기';b.addEventListener('click',()=>{if(token===luRenameNoticeToken)void undo()},{once:true});el.append(' ',b)}
  if(!error)setTimeout(()=>{if(token===luRenameNoticeToken)luFolderStatus('')},10000);
}
function luStartRename(id){
  if(luPick.items||luRenameBusy)return;
  if(luRename){if(luRename.id===id){luRename.input.focus();return}luRename.finish(true)}
  const d=luDocuments.find(x=>x.id===id),row=[...document.querySelectorAll('#documentList [data-lu-document]')].find(x=>x.dataset.luDocument===id),title=row?.querySelector('.lu-row-title');
  if(!d||!title)return;
  // 빠짐12: 보이는 이름이 파일 이름이면 첨부 공용 부품(Drive 원본 이름도 같이·[AI 이름]). 저장되면 kptu:documents-changed로 목록을 다시 읽는다.
  if(fileNameShown(d)){row.removeAttribute('draggable');markRenameHost(title,{target:'document',id:d.id,driveId:d.file_id,name:d.file_name});openRenameEditor(title);for(const k of ['frHost','frTarget','frId','frDrive','frName'])delete title.dataset[k];return}
  const before=d.title||d.file_name||'',input=document.createElement('input'),wasDraggable=row.getAttribute('draggable');
  input.type='text';input.className='lu-rename-input';input.value=before;input.setAttribute('aria-label','자료 이름');input.autocomplete='off';
  let done=false;
  const state={id,input,finish(save,refocus=false){
    if(done)return;done=true;if(luRename===state)luRename=null;
    const value=input.value.trim();
    if(input.isConnected)input.replaceWith(title);if(wasDraggable!==null&&row.isConnected)row.setAttribute('draggable',wasDraggable);
    if(refocus&&row.isConnected)row.focus({preventScroll:true});
    if(save&&value&&value!==before)void luRenameSave(d,value,refocus);
  }};
  // 줄을 누르면 자료가 열리므로 입력칸 안의 누르기·키는 줄까지 올라가지 않게 한다.
  for(const type of ['click','dblclick','pointerdown','mousedown'])input.addEventListener(type,e=>e.stopPropagation());
  input.addEventListener('keydown',e=>{
    e.stopPropagation();
    if(e.isComposing||e.keyCode===229)return;
    if(e.key==='Enter'){e.preventDefault();state.finish(true,true)}
    else if(e.key==='Escape'){e.preventDefault();state.finish(false,true)}
  });
  input.addEventListener('blur',()=>state.finish(input.isConnected));
  row.removeAttribute('draggable');title.replaceWith(input);luRename=state;
  input.focus({preventScroll:true});input.select();
}
async function luRenameSave(d,value,refocus=false){
  const scope=luEditScope();
  if(!scope){luRenameNotice('로그인 상태를 확인하지 못해 이름을 바꾸지 않았어요.',{error:true});return}
  luRenameBusy=true;
  const snapshot=undoSnapshot(d),body=renameBody(d,value);
  try{
    const row=await luRenamePatch(d.id,scope,body);
    if(refocus)luKeepFocus={id:d.id,until:Date.now()+3000};
    luDocuments=luDocuments.map(x=>x.id===row.id?structuredClone(row):x);luRenderLibrary();
    luRenameNotice('이름을 바꿨어요 ·',{undo:()=>luRenameUndo(d.id,value,snapshot)});
    window.dispatchEvent(new CustomEvent('kptu:documents-changed'));
  }catch(error){
    const rejected=[401,403].includes(error?.status);
    luRenameNotice(rejected?'자료를 수정할 권한을 확인해 주세요. 이름을 바꾸지 않았어요.':'저장 결과를 확인하지 못했어요. 목록을 다시 불러옵니다.',{error:true});
    if(!rejected)window.dispatchEvent(new CustomEvent('kptu:documents-changed'));
  }finally{luRenameBusy=false}
}
async function luRenamePatch(id,scope,body){
  const rows=await luApi(`/rest/v1/app_documents?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(scope.workspace)}&select=*`,{method:'PATCH',body,prefer:'return=representation',expectedSessionEpoch:scope.epoch});
  if(!Array.isArray(rows)||rows.length!==1||rows[0]?.id!==id||rows[0]?.workspace_id!==scope.workspace||!rowMatches(rows[0],body))throw new Error('자료의 저장 결과를 확인하지 못했어요.');
  return rows[0];
}
// 되돌리기: 그 사이 같은 자료가 다른 값으로 바뀌었으면 덮어쓰지 않는다.
async function luRenameUndo(id,renamed,snapshot){
  const scope=luEditScope(),current=luDocuments.find(x=>x.id===id);
  if(!scope||!current){luRenameNotice('되돌리지 못했어요.',{error:true});return}
  if((current.title||'')!==renamed){luRenameNotice('그 사이 이름이 또 바뀌어 되돌리지 않았어요.');return}
  luRenameBusy=true;
  try{
    const row=await luRenamePatch(id,scope,undoBody(snapshot));
    luDocuments=luDocuments.map(x=>x.id===row.id?structuredClone(row):x);luRenderLibrary();
    luRenameNotice('이름을 되돌렸어요.');
    window.dispatchEvent(new CustomEvent('kptu:documents-changed'));
  }catch{luRenameNotice('되돌리기 결과를 확인하지 못했어요. 목록을 다시 불러옵니다.',{error:true});window.dispatchEvent(new CustomEvent('kptu:documents-changed'))}
  finally{luRenameBusy=false}
}
function luFolderStatus(text,error=false){const el=document.querySelector('#libraryFolderStatusLine');if(!el)return;el.textContent=text||'';el.hidden=!text;el.classList.toggle('error',!!error)}
function luFolders(){if(!luFolderUi)luFolderUi=mountLibraryFolders({selectNode:luSelectNode,enter:(id,trigger)=>luTwoActive()?luTwo.enter(id,trigger):luEnterFolder(id),photoSetDocs:luPhotoSetMembers,twinDocs:luTwinDocs,api:luApi,esc:luEsc,state:()=>({workspace:luWorkspace,folders:luFolders_,items:luFolderItems,docs:luDocuments,projectName:luProjectName,free:luGroupBy==='folder',inFolder:!!luInFolder,treeView:luGroupBy==='project'||luGroupBy==='folder',isOpen:luNodeOpen}),reload:async()=>{await luLoadFolders();luRenderLibrary()},status:luFolderStatus,notify:luRenameNotice,reveal:luRevealKeys,toggleNode:luToggleNode,selected:()=>luPick.items?[...luPick.items]:[],touchOk:()=>luFolderViews()||(luGroupBy==='category'&&luFoldersReady),onMoveProgress:({index,total})=>{const c=document.querySelector('#librarySelectCount');if(c&&luPick.items&&total>1)c.textContent=`옮기는 중 ${index}/${total}`},categoryOf:name=>categoryOf(name),changeCategory:(docs,name)=>{const ids=docs.map(d=>d.id);if(!ids.length)return;const many=!!luPick.items&&ids.every(id=>luPick.items.has(id));return luBulkApply('category',name,many?null:ids)},onMoved:({done,failed})=>{const fromSel=!!luPick.items&&[...done,...failed].some(id=>luPick.items.has(id));luAfterBulk([...done,...failed],failed,fromSel)},recent:{get:()=>luRecentFolders,push:luPushRecentFolder}});return luFolderUi}
// 토글 하나를 접거나 편다(폴더 ⋯ 메뉴의 [접기·펼치기]). 상태는 머리를 눌렀을 때와 같은 곳(luOpened·luFilterOpen)에 적는다.
const luNodeEl=key=>[...document.querySelectorAll('#documentList details[data-lu-node]')].find(x=>x.dataset.luNode===key);
// LIB-두칸폴더펼치기(S56-40): 두 칸은 details가 없고 칸 안 나무 줄이다 — 펼침은 같은 곳(luOpened·luFilterOpen)에 적고 다시 그린다.
let luTwoOpen=()=>false;
function luTwoToggle(key,next){if(luFilterSignature!=='-')luFilterOpen.set(key,next);else if(next)luOpened.add(key);else luOpened.delete(key);luRenderLibrary()}
const luNodeOpen=key=>luTwoActive()?!!luTwoOpen(key):!!luNodeEl(key)?.open;
function luToggleNode(key){if(luTwoActive()){luTwoToggle(key,!luTwoOpen(key));return}const d=luNodeEl(key);if(!d)return;const next=!d.open;if(luFilterSignature!=='-')luFilterOpen.set(key,next);else if(next)luOpened.add(key);else luOpened.delete(key);d.open=next}
// 토글 몇 개를 위 단부터 연다(폴더를 만들거나 옮긴 뒤 그 자리가 보이게). 프로젝트 토글의 위 단(1·2단)도 함께.
function luRevealKeys(keys){const all=new Set(luTreeKeys(luLastTree)),out=[];for(const k of keys){const path=k.startsWith('p:')&&k!=='p:none'?luProjectPath(k.slice(2)):[k];for(const x of path)if(all.has(x))out.push(x)}for(const k of out){if(luFilterSignature!=='-')luFilterOpen.set(k,true);else luOpened.add(k)}luRenderLibrary()}
function luProjectPath(id){const rows=luCatalog()?.projects||[],out=[];let p=rows.find(x=>x.id===id),guard=0;while(p&&guard++<5){out.unshift('p:'+p.id);p=p.parent_id?rows.find(x=>x.id===p.parent_id):null}return out.length?out:['p:'+id]}
// 토글 머리를 누르면(마우스·터치·키보드 Enter/Space 모두 click) 바뀔 상태를 바로 적는다. toggle 이벤트는 늦게 와서, 그 사이 다시 그리면 잃을 수 있다.
function luOnHeadClick(e){const head=e.target.closest('summary.lu-node-head');if(!head||e.defaultPrevented||e.target.closest('button,input'))return;const d=head.parentElement;if(!(d instanceof HTMLDetailsElement)||!d.dataset.luNode)return;const key=d.dataset.luNode,next=!d.open;if(luFilterSignature!=='-')luFilterOpen.set(key,next);else if(next)luOpened.add(key);else luOpened.delete(key);
  // SEARCH-선택옮기기 ⑦: '공공팀 › 회의 › 집행위'로 줄여 보이던 외줄 폴더를 펼치면 이어진 폴더도 함께 펼친다(각 폴더의 toggle을 luOnToggle이 그대로 기록).
  if(next)for(const k of String(d.dataset.luChain||'').split(' ').filter(Boolean)){const x=luNodeEl(k);if(x&&!x.open)x.open=true}}
// 한 자료가 든 토글을 위 단까지 펼치고 그 토글의 자료를 모두 보인다(다른 화면에서 그 자료로 올 때).
function luRevealInTree(id){if(luInFolder&&!luVisibleIds().includes(id)){luInFolder=null;luRenderLibrary()}const path=pathTo(luLastTree,id);if(!path.length)return;for(const k of path){if(luFilterSignature!=='-')luFilterOpen.set(k,true);else luOpened.add(k)}luShowAll.add(path.at(-1));luRenderLibrary()}
// Account-menu pattern: consume the menu history entry before opening a successor.
let luActiveMenu=null,luMenuPanel=null,luMenuPopover=false,luMenuClosing=null;
function luCloseMenu(then,fromBack=false){
  luFolderUi?.closeMove();
  const active=luActiveMenu;if(!active){if(then){if(luMenuClosing)luMenuClosing.then(then);else then()}return}
  luActiveMenu=null;if(luMenuPopover)luMenuPanel.hidePopover();luMenuPanel.hidden=true;active.trigger.setAttribute('aria-expanded','false');
  let release;const pending=new Promise(resolve=>{release=resolve});luMenuClosing=pending;
  const finish=()=>queueMicrotask(()=>{if(luMenuClosing===pending)luMenuClosing=null;release();if(then)then();else if(active.trigger.isConnected)active.trigger.focus({preventScroll:true})});
  if(!fromBack&&history.state?.kptuLibraryMenu===active.id){window.addEventListener('popstate',finish,{once:true});history.back()}else finish();
}
function luPositionMenu(){
  if(!luActiveMenu)return;
  const panel=luMenuPanel,rect=luActiveMenu.trigger.getBoundingClientRect(),margin=12,gap=8,width=Math.min(200,innerWidth-margin*2);
  panel.style.width=width+'px';panel.style.left=Math.max(margin,Math.min(rect.right-width,innerWidth-width-margin))+'px';
  const below=innerHeight-rect.bottom-gap-margin,above=rect.top-gap-margin,down=below>=Math.min(panel.scrollHeight,180)||below>=above;
  panel.style.maxHeight=Math.max(0,down?below:above)+'px';
  const height=panel.getBoundingClientRect().height;
  panel.style.top=Math.max(margin,Math.min(down?rect.bottom+gap:rect.top-gap-height,innerHeight-height-margin))+'px';
}
function luOpenMenu(trigger){
  if(luMenuClosing){luMenuClosing.then(()=>{if(trigger.isConnected)luOpenMenu(trigger)});return}
  if(luActiveMenu){luCloseMenu(luActiveMenu.trigger===trigger?null:()=>luOpenMenu(trigger));return}
  const id=trigger.dataset.luMenu;luActiveMenu={trigger,id};
  const set=luPhotoSetKey(id);
  if(set!==null){const docs=luPhotoSetMembers(set);luMenuPanel.innerHTML=luFoldersReady&&docs.length?luFolders().moveMenuHtml({id},1):'<button type="button" disabled>옮길 사진이 없어요</button>';luShowMenu(trigger,id);return}
  const hwp=luDocuments.find(x=>x.id===id);
  // LIB-후속1 ②: 선택 모드에서 연 메뉴는 고른 것 모두에 대한 메뉴(누른 줄이 아직 안 골라졌으면 더한다).
  if(luPick.items&&!luSelBusy&&hwp&&!luPick.items.has(id)){luPick.items=new Set([...luPick.items,id]);luSyncPicks()}
  if(luPick.items&&luPick.items.size&&hwp){luMenuPanel.innerHTML=luManyMenuHtml(hwp);luShowMenu(trigger,id);return}
  luMenuPanel.innerHTML=`${hwp?`<button type="button" data-lu-pick-start="${luEsc(id)}">선택</button>`:''}<button type="button" data-lu-rename="${luEsc(id)}" aria-keyshortcuts="F2">이름 바꾸기<span class="lu-menu-key" aria-hidden="true">F2</span></button>${luFoldersReady&&hwp?luFolders().moveMenuHtml(hwp,1):''}${hwp?`<button type="button" data-lu-cat-open="${luEsc(id)}" aria-haspopup="true">분류 바꾸기<span class="lu-menu-key" aria-hidden="true">›</span></button>`:''}${hwp?.file_id&&isHwpName(hwp.file_name)?`<button type="button" data-lu-hwp-edit="${luEsc(id)}">수정</button>`:''}${hwp&&canOpenInDrive(luFileOf(hwp))?`<button type="button" data-lu-drive-open="${luEsc(id)}">Drive에서 열기</button>`:''}<button type="button" data-lu-download="${luEsc(id)}">내려받기</button><button type="button" data-lu-edit="${luEsc(id)}">정보 수정…</button><hr class="lu-menu-sep" role="separator"><button type="button" class="lu-menu-danger" data-lu-delete="${luEsc(id)}">삭제</button>`;
  luShowMenu(trigger,id);
}
function luShowMenu(trigger,id){
  luMenuPanel.hidden=false;if(luMenuPopover){try{luMenuPanel.showPopover()}catch{luMenuPopover=false;luMenuPanel.removeAttribute('popover')}}
  luPositionMenu();trigger.setAttribute('aria-expanded','true');history.pushState({...history.state,kptuLibraryMenu:id},'',location.href);luMenuPanel.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
}
// 선택 모드 메뉴: 'n개 골랐음' 한 줄 + 고른 것 모두에 [폴더로 옮기기 ›][분류 바꾸기 ›][선택 풀기] + [n개 삭제]. 항목 이름·차례는 한 자료 메뉴와 같은 부품.
function luManyMenuHtml(doc){
  const n=luPick.items.size,id=luEsc(doc.id);
  return `<p class="lu-menu-head">${n}개 선택됨</p>${luFoldersReady?luFolders().moveMenuHtml(doc,n):''}<button type="button" data-lu-cat-open="${id}" aria-haspopup="true">분류 바꾸기<span class="lu-menu-key" aria-hidden="true">›</span></button><button type="button" data-lu-pick-stop="1">선택 풀기<span class="lu-menu-key" aria-hidden="true">Esc</span></button><hr class="lu-menu-sep" role="separator"><button type="button" class="lu-menu-danger" data-lu-delete-many="1">${n}개 삭제</button>`;
}
function luBindMenu(){
  luMenuPanel=document.createElement('div');luMenuPanel.id='luMorePanel';luMenuPanel.className='lu-more-panel';luMenuPanel.hidden=true;luMenuPanel.setAttribute('role','group');luMenuPanel.setAttribute('aria-label','자료 관리');
  luMenuPopover=typeof luMenuPanel.showPopover==='function'&&typeof luMenuPanel.hidePopover==='function'&&'popover' in luMenuPanel;if(luMenuPopover)luMenuPanel.setAttribute('popover','manual');document.body.append(luMenuPanel);
  luMenuPanel.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.luMoveOpen){e.stopPropagation();luToggleMove(b);return}const anchor=luActiveMenu?.trigger;luCloseMenu(()=>{if(b.dataset.luPickStart)luSelStartWith(b.dataset.luPickStart);else if(b.dataset.luPickStop)luSelStop();else if(b.dataset.luDeleteMany)void luSelDelete();else if(b.dataset.luCatOpen)luOpenCategoryFor(b.dataset.luCatOpen,anchor);else if(b.dataset.luRename)luStartRename(b.dataset.luRename);else if(b.dataset.luHwpEdit)luHwpEdit(b.dataset.luHwpEdit);else if(b.dataset.luDriveOpen)luDriveOpen(b.dataset.luDriveOpen);else if(b.dataset.luDownload)luDownload(b.dataset.luDownload);else if(b.dataset.luEdit)luOpenEditById(b.dataset.luEdit);else if(b.dataset.luDelete)luDeleteDocument(b.dataset.luDelete)})});
  luMenuPanel.addEventListener('keydown',e=>{if(e.key==='ArrowRight'&&e.target.matches?.('[data-lu-move-open]')){e.preventDefault();luToggleMove(e.target,true)}});
  document.addEventListener('click',e=>{if((!luActiveMenu&&!luMenuClosing)||luMenuPanel.contains(e.target)||luActiveMenu?.trigger.contains(e.target)||luFolderUi?.moveContains(e.target))return;const target=e.target,forward=new MouseEvent('click',e);e.preventDefault();e.stopImmediatePropagation();luCloseMenu(()=>{if(target.isConnected)target.dispatchEvent(forward)})},true);
  // 폴더 목록(자료 ⋯의 [폴더로 옮기기 ›])에서 Esc는 목록만 닫고 메뉴로 돌아간다(library-move-picker.js). 한 번 더 누르면 메뉴가 닫힌다.
  document.addEventListener('keydown',e=>{if(luActiveMenu&&e.key==='Escape'&&!luFolderUi?.moveContains(e.target)){e.preventDefault();e.stopImmediatePropagation();luCloseMenu()}},true);
  window.addEventListener('popstate',e=>{if(luActiveMenu&&e.state?.kptuLibraryMenu!==luActiveMenu.id)luCloseMenu(null,true)});
  window.addEventListener('resize',luPositionMenu);window.addEventListener('scroll',luPositionMenu,true);
  new ResizeObserver(luPositionMenu).observe(luMenuPanel);
}

// FILE-누르면동작: 자료실 줄을 누르면 종류별 동작(file-actions.js). 자료 한 건을 공용 파일 모양으로 바꾼다.
function luFileOf(d){return {name:d.file_name||d.title||'',mime:d.mime_type||'',documentId:d.file_id?d.id:'',driveId:d.file_id||'',driveUrl:d.drive_url||'',size:d.file_size||0}}
async function luOpenDocument(id){const d=luDocuments.find(x=>x.id===id)||await luFetchOne(id);if(!d){notify('열 수 있는 파일 링크가 없어요.',{error:true});return}await pressFile(luFileOf(d),{api:luApi,onError:luErrorNotice,viewHtml:file=>void openLibraryHtmlView(file,{title:d.title||d.file_name||''})})}
// HWP-편집기 2단계: HWP·HWPX 자료를 편집기 화면(hwp-lab.js)으로 넘긴다. 열기·저장은 그 화면이 한다.
// LIB-편집열기느림(S55-15): 자료실에 HWP·HWPX 자료가 있으면 한가할 때 HWP 편집기 부품을 미리 받는다(hwp-warm.js, 이 창에서 한 번).
// 실측(tests/app-e2e/hwp-editor-warm.spec.mjs): 첫 [HWP 편집]의 편집기 준비가 폰 1MB/s 약 13.5초 → 0.6초. 데이터 절약·휴대폰 데이터면 하지 않는다.
function luWarmHwp(){if(!luDocuments.some(d=>isHwpName(d.file_name||d.title||'')))return;import('./hwp-warm.js').then(m=>m.warmHwpEditorWhenIdle()).catch(err=>console.warn('hwp warm',err?.name||'Error'))}
function luHwpEdit(id){const d=luDocuments.find(x=>x.id===id);if(!d)return;if(!requestHwpEdit({kind:'library',document:{id:d.id,title:d.title,file_name:d.file_name,category:d.category,source:d.source,document_date:d.document_date,project_id:d.project_id,meeting_id:d.meeting_id,tags:d.tags}})){notify('로그인 정보를 확인하지 못했어요. 다시 시도해 주세요.',{error:true});return}window.KPTURouter.go('hwp-lab',{source:'delegated'})}
async function luDownload(id){const d=luDocuments.find(x=>x.id===id)||await luFetchOne(id);if(!d)return;await downloadFile(luFileOf(d),{api:luApi,onError:luErrorNotice})}
function luDriveOpen(id){const d=luDocuments.find(x=>x.id===id);if(d)openInDrive(luFileOf(d),{onError:luErrorNotice})}
async function luFetchOne(id){const rows=await luApi('/rest/v1/app_documents?id=eq.'+encodeURIComponent(id)+'&select=*&limit=1');return rows?.[0]||null}
async function luOpenEditById(id){
  const sequence=++luEditSequence,view=luEditView,scope=luEditScope();
  let d=luDocuments.find(x=>x.id===id);
  if(!d){const rows=await luApi('/rest/v1/app_documents?id=eq.'+encodeURIComponent(id)+'&workspace_id=eq.'+encodeURIComponent(luWorkspace)+'&select=*&limit=1',{expectedSessionEpoch:scope?.epoch??null,singleFlight:false});d=rows?.[0]}
  if(sequence!==luEditSequence||view!==luEditView||(scope&&!luEditSameScope(scope))||d?.id!==id||d.workspace_id!==luWorkspace)return;
  await luEdit(d);
}
// LIB-수정파일교체 (docs/design/library-replace-file.md): [수정] 창에서 파일 자체를 바꾼다. 같은 자료 한 줄의 파일만 새 파일로 바뀌고(제목·날짜·종류·프로젝트·담당조직 연결 그대로),
// 옛 파일은 Drive에 남아 [이전 파일 ▾]로 본다. 고른 파일은 [수정 저장]을 누를 때 서버(library-files replace_document_id)로 올라간다. DB 칸(previous_files)이 없는 행이면 이 줄을 숨긴다.
// 저장 순서: 파일 교체 → (고친 칸이 있으면) 정보 저장 → 뒤에서 AI가 빈 칸만 한 번 다시 채움(손으로 고친 칸은 그대로). 브라우저 저장소는 쓰지 않는다.
function luReplaceReady(d){return !!d&&Object.hasOwn(d,'previous_files')}
function luReplaceDate(v){const t=Date.parse(v||'');return Number.isFinite(t)?new Date(t+9*3600000).toISOString().slice(0,10):''}
function luRenderEditFile(){
  const box=document.querySelector('#libraryEditFile');if(!box)return;
  const editor=luEditor,d=editor?.original;
  if(!editor||!luReplaceReady(d)){box.hidden=true;return}
  box.hidden=false;
  const staged=editor.replaceFile,busy=!!editor.replacing,name=d.file_name||d.title||'파일';
  box.querySelector('#libraryEditFileLine').innerHTML=staged
    ?fileLine({name:staged.name,meta:luSize(staged.size),label:'교체 예정',end:`<button class="icon-btn file-line-x" type="button" data-lu-replace-clear aria-label="파일 교체 취소"${busy?' disabled':''}>×</button>`})+`<p class="library-edit-file-note">지금 파일(${luEsc(name)})은 삭제하지 않고 이전 파일에 남깁니다.</p>`
    :fileLine({name,meta:luSize(d.file_size),end:`<button class="library-pick-button" type="button" data-lu-replace-pick${busy?' disabled':''}>파일 교체</button>`});
  // LIB-이전파일정리: 정리된(Drive 휴지통으로 간) 항목은 목록에서 뺀다. 줄 끝: 'N일 뒤 삭제' + 작은 [계속 보관], 보관한 줄은 '보관' + [해제].
  const now=Date.now(),prev=visibleEntries(d.previous_files).slice().reverse(),det=box.querySelector('#libraryEditPrev'),busyKeep=!!editor.keeping;
  det.hidden=!prev.length;
  box.querySelector('#libraryEditPrevList').innerHTML=prev.map(f=>{const file={name:f.file_name||'이전 파일',mime:f.mime_type||'',driveId:f.file_id||'',driveUrl:f.drive_url||''},href=driveOpenUrl({driveUrl:file.driveUrl,driveId:file.driveId}),day=luReplaceDate(f.replaced_at),kept=isKept(f),label=deleteLabel(f,now),canKeep=entryState(f,now).state!=='unknown'||kept;
    return `<div class="library-edit-prev-row"><a class="library-edit-prev-file" ${href?`href="${luEsc(href)}" `:''}target="_blank" rel="noopener noreferrer"${fileAttrs(file,{press:true})}>${luEsc(file.name)}</a><small>${[luSize(f.file_size),day?day+' 교체':''].filter(Boolean).join(' · ')}</small>${canKeep?`<span class="library-edit-prev-end">${label?`<small class="library-edit-prev-del${kept?' kept':''}">${luEsc(label)}</small>`:''}<button class="library-edit-prev-keep" type="button" data-lu-prev-keep="${luEsc(f.file_id)}" data-keep="${kept?'0':'1'}"${busyKeep?' disabled':''}>${kept?'해제':'계속 보관'}</button></span>`:''}</div>`}).join('');
}
// [계속 보관]/[해제]: 서버(library-files previous-keep)에 저장한다. 브라우저 저장소는 쓰지 않는다. 응답의 목록으로 그 줄만 바꾼다.
async function luPrevKeep(editor,fileId,keep){
  if(!editor||editor.keeping||editor.replacing)return;
  const st=document.querySelector('#libraryEditStatus'),say=(message,error)=>{if(luEditCurrent(editor))luSetStatus(st,message,error)};
  editor.keeping=true;luRenderEditFile();
  try{
    const data=await luApi('/functions/v1/library-files',{method:'POST',body:{action:'previous-keep',document_id:editor.id,file_id:fileId,keep},expectedSessionEpoch:editor.scope.epoch,singleFlight:false,refreshSession:false});
    if(data?.ok!==true||!Array.isArray(data.previous_files))throw new Error('keep not confirmed');
    luDocuments=luDocuments.map(old=>old.id===editor.id?{...old,previous_files:structuredClone(data.previous_files)}:old);
    editor.original={...editor.original,previous_files:structuredClone(data.previous_files)};
    if(luEditor===editor)luEditOriginal={...luEditOriginal,previous_files:structuredClone(data.previous_files)};
    say('',false);
  }catch(e){
    say(/[가-힣]/.test(e?.message||'')&&[404,409,503].includes(e?.status)?e.message:'보관 표시를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.',true);
  }finally{editor.keeping=false;if(luEditCurrent(editor))luRenderEditFile()}
}
function luStageReplace(files){
  const editor=luEditor;if(!editor||!luReplaceReady(editor.original)||editor.replacing)return;
  const list=Array.from(files||[]),file=list[0],st=document.querySelector('#libraryEditStatus'),input=document.querySelector('#libraryEditReplaceInput');
  if(input)input.value='';
  if(!file)return;
  const bad=luPreflightFailure(file);
  if(bad){luSetStatus(st,bad.message,true);return}
  editor.replaceFile=file;
  luSetStatus(st,list.length>1?'파일은 하나만 바꿀 수 있어 첫 번째 파일을 선택했습니다.':'');
  luRenderEditFile();
}
function luBindReplaceFile(){
  const box=document.querySelector('#libraryEditFile'),input=document.querySelector('#libraryEditReplaceInput'),card=document.querySelector('#libraryEditModal .modal-card');
  if(!box||!input||!card)return;
  box.addEventListener('click',e=>{const keepButton=e.target.closest('[data-lu-prev-keep]');if(keepButton){void luPrevKeep(luEditor,keepButton.dataset.luPrevKeep,keepButton.dataset.keep==='1');return}if(e.target.closest('[data-lu-replace-pick]'))input.click();else if(e.target.closest('[data-lu-replace-clear]')&&luEditor&&!luEditor.replacing){luEditor.replaceFile=null;luRenderEditFile()}});
  input.addEventListener('change',()=>luStageReplace(input.files));
  bindDropTarget(card,luStageReplace,()=>!!luEditor&&luReplaceReady(luEditor.original)&&!luEditor.replacing&&!document.querySelector('#libraryEditModal').classList.contains('hidden'));
}
// 결과: 새 자료 줄(row) 또는 null(실패, 안내를 이미 띄움). 시간 초과·끊김은 서버가 이미 바꿨을 수 있어 고른 파일을 비우고 확인을 부탁한다(다시 보내지 않음).
async function luReplaceStaged(editor,st){
  const file=editor.replaceFile,say=(message,error)=>{if(luEditCurrent(editor))luSetStatus(st,message,error)};
  const pre=luPreflightFailure(file);if(pre){say(pre.message,true);return null}
  const fd=new FormData();fd.append('file',file);fd.append('replace_document_id',editor.id);
  editor.replacing=true;luRenderEditFile();say('파일을 바꾸는 중…',false);
  try{
    const data=await luUploadRequest(fd,file),row=data?.document;
    if(data?.ok!==true||row?.id!==editor.id||row.workspace_id!==editor.scope.workspace)throw Object.assign(new Error('replace not confirmed'),{code:'timeout'});
    luDocuments=luDocuments.map(old=>old.id===row.id?structuredClone(row):old);
    editor.original=structuredClone(row);editor.replaceFile=null;
    if(luEditor===editor)luEditOriginal={...row};
    if(editor.view===luEditView)luRenderLibrary();
    return row;
  }catch(e){
    const f=luUploadFailure(e),msg=/[가-힣]/.test(e?.message||'')&&[404,409,503].includes(e?.status)?e.message:f.message;
    if(f.kind==='unknown'){editor.replaceFile=null;say(msg.replace('업로드','파일 교체'),true)}else say(msg,true);
    return null;
  }finally{editor.replacing=false;if(luEditCurrent(editor))luRenderEditFile()}
}
function luReclassify(id){void reclassifyLibraryDocument(id).catch(()=>{})}
function luEditFields(){return {title:document.querySelector('#libraryEditTitle').value.trim(),category:document.querySelector('#libraryEditCategory').value.trim()||'기타',project_id:document.querySelector('#libraryEditProject').value||null,meeting_id:document.querySelector('#libraryEditMeeting').value||null,source:document.querySelector('#libraryEditSource').value.trim()||null,document_date:document.querySelector('#libraryEditDate').value||null,tags:document.querySelector('#libraryEditTags').value.split(',').map(x=>x.trim()).filter(Boolean),description:document.querySelector('#libraryEditDescription').value.trim()||null}}
const luEditSelectors=['Title','Category','Project','Meeting','Source','Date','Tags','Description'];
function luEditDraft(){return luEditSelectors.map(key=>document.querySelector('#libraryEdit'+key)?.value??'')}
function luEditScope(){const rt=window.KPTURuntime;if(typeof rt?.session?.epoch!=='function')return null;const epoch=rt.session.epoch(),context=rt.context?.read?.(),owner=rt.session.read()?.user?.id;if(!Number.isInteger(epoch)||epoch<0||!owner||owner!==luUser?.id||context?.user?.id!==owner||context?.workspace?.id!==luWorkspace)return null;return {owner,workspace:luWorkspace,epoch}}
function luEditSameScope(scope){const now=luEditScope();return !!scope&&!!now&&['owner','workspace','epoch'].every(key=>scope[key]===now[key])}
function luEditCurrent(editor){return luEditor===editor&&editor.sequence===luEditSequence&&editor.view===luEditView&&luEditSameScope(editor.scope)&&!document.querySelector('#libraryEditModal')?.classList.contains('hidden')&&document.querySelector('#libraryEditId')?.value===editor.id}
function luEditKey(editor){return [editor.scope.owner,editor.scope.workspace,editor.scope.epoch,editor.id].join(':')}
function luEditMatches(row,body){return Object.entries(body).every(([key,value])=>key==='updated_at'||value===undefined||JSON.stringify(row?.[key])===JSON.stringify(value))}
function luEditRow(editor,rows,body){if(!Array.isArray(rows)||rows.length!==1||rows[0]?.id!==editor.id||rows[0]?.workspace_id!==editor.scope.workspace||!luEditMatches(rows[0],body))throw new Error('자료의 저장 결과를 확인하지 못했어요.');return rows[0]}
function luEditNotice(editor,text,check=false){if(!luEditCurrent(editor))return;const status=document.querySelector('#libraryEditStatus');status.textContent=text;status.className='status';if(check){const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='저장 결과 확인';button.onclick=()=>luCheckEdit(editor);status.append(document.createTextNode(' '),button)}}
async function luCheckEdit(editor){
  const key=luEditKey(editor),attempt=luEditAttempts.get(key);if(!attempt||attempt.pending||attempt.reading||!luEditCurrent(editor))return;
  attempt.reading=true;const current=()=>luEditCurrent(editor)&&luEditAttempts.get(key)===attempt;
  try{const rows=await luApi(`/rest/v1/app_documents?id=eq.${encodeURIComponent(editor.id)}&workspace_id=eq.${encodeURIComponent(editor.scope.workspace)}&select=*`,{expectedSessionEpoch:editor.scope.epoch,singleFlight:false});if(!current())return;const row=luEditRow(editor,rows,attempt.body);editor.original=structuredClone(row);editor.baseline=structuredClone(attempt.values);luDocuments=luDocuments.map(old=>old.id===row.id?structuredClone(row):old);luEditAttempts.delete(key);luEditNotice(editor,'제출한 자료 정보는 확인했습니다. 현재 입력은 남겨두었습니다.')}catch{if(current())luEditNotice(editor,'저장 결과를 아직 확인하지 못했어요. 입력을 유지했으며 다시 저장하지 않았어요.',true)}finally{attempt.reading=false}
}
async function luEdit(d){const editor={id:d.id,original:structuredClone(d),scope:luEditScope(),sequence:++luEditSequence,view:luEditView};luEditor=editor;if(editor.scope)luEditObservedScope={...editor.scope};try{await window.__KPTU_START_TEAM_VIEW__?.('meetings');if(luEditor!==editor||editor.sequence!==luEditSequence||editor.view!==luEditView||(editor.scope&&!luEditSameScope(editor.scope)))return;const meetings=[...(window.KPTUTeamData?.meetings?.()||[])].sort((a,b)=>new Date(b.meeting_at)-new Date(a.meeting_at));if(d.meeting_id&&!meetings.some(m=>m.id===d.meeting_id))throw new Error('연결된 사업 보고를 확인하지 못했어요. 사업 보고 목록을 다시 연 뒤 수정해 주세요.');document.querySelector('#libraryEditMeeting').innerHTML=luOption('','연결 안 함',d.meeting_id||'')+meetings.map(m=>luOption(m.id,window.KPTUMeetingNames.label(m),d.meeting_id||'')).join('');document.querySelector('#libraryEditId').value=d.id;document.querySelector('#libraryEditTitle').value=d.title||'';document.querySelector('#libraryEditCategory').innerHTML=categoryOptions(d.category);document.querySelector('#libraryEditProject').innerHTML=luProjectOptions(d.project_id||'',{keepStale:true});luAreaButton(document.querySelector('#libraryEditProject'));document.querySelector('#libraryEditSource').value=d.source||'';document.querySelector('#libraryEditDate').value=d.document_date||'';document.querySelector('#libraryEditTags').value=(d.tags||[]).join(', ');document.querySelector('#libraryEditDescription').value=d.description||'';document.querySelector('#libraryEditStatus').textContent='';luEditOriginal={...d};luEditBaseline=luEditFields();editor.baseline??=structuredClone(luEditBaseline);editor.replaceFile=null;editor.replacing=false;luRenderEditFile();luOpen('libraryEditModal');const button=document.querySelector('#libraryEditSave'),attempt=editor.scope&&luEditAttempts.get(luEditKey(editor));button.disabled=!!attempt?.pending;if(attempt?.pending){if(luEditCurrent(editor))document.querySelector('#libraryEditStatus').innerHTML=globalThis.KPTUWait?.waitInlineHtml?.()||'';attempt.done.then(()=>{if(luEditCurrent(editor)){button.disabled=false;luEditNotice(editor,'앞선 요청이 끝났습니다. 현재 입력은 유지했습니다.',attempt.state==='unknown')}})}else if(attempt)luEditNotice(editor,'앞선 저장 결과를 먼저 확인해 주세요.',true)}catch(e){if(luEditor===editor)notify(e.message||'사업 보고 목록을 불러오지 못했어요. 다시 시도해 주세요.',{error:true})}}
async function luSaveEdit(){
  const editor=luEditor,st=document.querySelector('#libraryEditStatus');
  if(!editor||editor.sequence!==luEditSequence)return;
  if(!editor.scope||!luEditSameScope(editor.scope)){st.textContent='로그인 상태를 확인하지 못했어요. 입력은 남겨두었습니다. 화면을 다시 연 뒤 확인해 주세요.';st.className='status error';return}
  if(!luEditCurrent(editor))return;
  const key=luEditKey(editor),previous=luEditAttempts.get(key);
  if(previous?.pending||previous?.state==='unknown'){luEditNotice(editor,'앞선 저장 결과를 먼저 확인해 주세요.',!previous.pending);return}
  const values=luEditFields(),changed=Object.keys(values).filter(key=>JSON.stringify(values[key])!==JSON.stringify(editor.baseline[key]));
  let replaced=false;
  if(editor.replaceFile){
    const saveButton=document.querySelector('#libraryEditSave');saveButton.disabled=true;
    const row=await luReplaceStaged(editor,st);
    if(!luEditCurrent(editor))return;
    saveButton.disabled=false;
    if(!row)return;
    replaced=true;
    if(!changed.length){luSetStatus(st,'파일을 바꿨습니다.',false);luClose('libraryEditModal');if(luEditSameScope(editor.scope)&&editor.view===luEditView)window.dispatchEvent(new CustomEvent('kptu:documents-changed'));luReclassify(editor.id);return}
  }
  const body={meeting_id:values.meeting_id,updated_at:new Date().toISOString()};
  if(changed.some(key=>key!=='meeting_id')){for(const [key,value]of Object.entries(values))if(key!=='meeting_id')body[key]=changed.includes(key)?value:editor.original[key];body.auto_classified=false;body.classification_note='사용자 수정';const origin=originAfterEdit(editor.original,changed);if(origin)body.field_origin=origin}
  const request={body:JSON.parse(JSON.stringify(body)),values:Object.freeze({...values,tags:Object.freeze([...values.tags])}),draft:JSON.stringify(luEditDraft()),pending:true,state:'pending'};
  request.done=new Promise(resolve=>request.finish=resolve);editor.request=request;luEditAttempts.set(key,request);
  const button=document.querySelector('#libraryEditSave');button.disabled=true;
  st.textContent='저장 중…';st.className='status';
  try{
    const rows=await luApi(`/rest/v1/app_documents?id=eq.${encodeURIComponent(editor.id)}&workspace_id=eq.${encodeURIComponent(editor.scope.workspace)}&select=*`,{method:'PATCH',body:request.body,prefer:'return=representation',expectedSessionEpoch:editor.scope.epoch});
    const row=luEditRow(editor,rows,request.body);request.state='confirmed';
    if(!luEditSameScope(editor.scope))return;
    if(luEditAttempts.get(key)===request)luEditAttempts.delete(key);
    // Confirmed metadata belongs to the target; only this editor may render or close.
    luDocuments=luDocuments.map(old=>old.id===row.id?structuredClone(row):old);
    const current=luEditor;
    if(current?.scope&&luEditKey(current)===key){current.original=structuredClone(row);current.baseline=structuredClone(request.values)}
    if(!luEditCurrent(editor))return;
    luRenderLibrary();
    if(replaced)luReclassify(editor.id);
    if(JSON.stringify(luEditDraft())===request.draft){st.textContent='수정했습니다.';st.className='status ok';luClose('libraryEditModal')}else luEditNotice(editor,'제출한 정보는 저장했습니다. 추가 입력은 남겨두었습니다.');
    if(luEditSameScope(editor.scope)&&editor.view===luEditView)window.dispatchEvent(new CustomEvent('kptu:documents-changed'));
  }catch(error){request.state=[401,403].includes(error?.status)?'rejected':'unknown';if(luEditSameScope(editor.scope)&&request.state==='rejected'&&luEditAttempts.get(key)===request)luEditAttempts.delete(key);luEditNotice(editor,request.state==='rejected'?'자료를 수정할 권한을 확인해 주세요. 입력은 유지했습니다.':'저장 결과를 확인하지 못했어요. 입력을 유지했어요.',request.state==='unknown')}
  finally{request.pending=false;request.finish();if(editor.request===request&&luEditCurrent(editor))button.disabled=false}
}
window.addEventListener('kptu:view-changed',()=>{luEditView++;if(luEditor)luClose('libraryEditModal')});
window.addEventListener('kptu:dialog-closed',event=>{if(event.detail?.modal?.id==='libraryEditModal'&&luEditor){luEditSequence++;luEditor=null}});
window.addEventListener('kptu:session-changed',()=>{if(luEditSameScope(luEditObservedScope))return;luEditObservedScope=null;luEditAttempts.clear();luEditSequence++;luEditor=null;luEditOriginal=null;luEditBaseline=null;luClose('libraryEditModal');luEditSelectors.forEach(key=>{const input=document.querySelector('#libraryEdit'+key);if(input)input.value=''})});
function luDeleteScope(){const rt=window.KPTURuntime;if(typeof rt?.api!=='function'||typeof rt.session?.read!=='function'||typeof rt.context?.read!=='function')return null;const scope=luEditScope(),session=rt.session.read();return scope&&typeof scope.owner==='string'&&scope.owner.trim()&&typeof scope.workspace==='string'&&scope.workspace.trim()&&typeof session?.access_token==='string'&&session.access_token.trim()?scope:null}
// LIB-바로지우기 (2026-10-28 명진 요청 08:28 ①, 11:53 결정 ②): 지우기를 누르면 확인 없이 그 줄을 목록에서 바로 빼고 위쪽 작은 알림 '지웠어요 · 되돌리기'(6초).
// 서버·Drive 처리(document-actions delete, 하나씩 삭제와 같은 길)는 6초가 지난 뒤 뒤에서 보낸다. [되돌리기]·Ctrl+Z는 아무 요청도 보내지 않고 줄을 되살린다.
// 서버에 휴지통 되살리기 길이 없어서 되돌리기는 '보내기 전 기다림'으로 만든다(보낸 뒤에는 '이미 지웠어요'로 답함 — 명진 결정: 서버 되살리기는 이번에 만들지 않음).
// - 로그인·업무공간이 바뀌면(epoch·owner·workspace, 또는 바뀐 로그인 알림을 받음) 보내지 않고 취소한다. 보낸 뒤의 결과도 그 로그인에서만 화면에 반영한다.
// - 자료실을 떠나거나 창이 숨겨지면 기다리지 않고 바로 보낸다(사용자가 이미 지우기로 한 것). 결과 알림은 작은 알림으로, Drive 다시 연결은 자료실에 있을 때만 묻는다.
// - 실패하면 그 줄을 목록에 되살리고 작은 알림. 기다리는 동안 목록을 다시 읽어도 지울 줄(luGone)은 보이지 않고, 같은 자료를 두 번 보내지 않는다(luGone + document-delete.js 잠금).
const LU_DELETE_WAIT_MS=6000;
const luGone=new Set(),luSentBatches=new Set();let luGoneBatches=[],luDeleteRouteSeq=0;
function luRestoreRows(rows){const have=new Set(luDocuments.map(d=>d.id));const back=rows.filter(d=>!have.has(d.id));if(back.length){luDocuments=[...luDocuments,...back].sort((a,b)=>String(b.document_date||'').localeCompare(String(a.document_date||''))||String(b.created_at||'').localeCompare(String(a.created_at||'')));}luRenderLibrary()}
function luBatchCurrent(batch){return !batch.revoked&&luSameScope(batch.scope)}
function luQueueDelete(ids){
  const scope=luDeleteScope();
  if(!scope){notify('로그인 세션을 확인하지 못했어요. 다시 로그인한 뒤 자료 목록을 먼저 확인해 주세요.',{error:true});return false}
  // 화면이 들고 있는 자료(같은 업무공간)만 지운다. 붙잡을 때의 사본을 고정해 뒤에 목록 값이 바뀌어도 보낼 ID는 그대로.
  const rows=ids.map(id=>luDocuments.find(d=>d.id===id)).filter(d=>d&&!luGone.has(d.id)&&!isPhotoSet(d)&&d.workspace_id===scope.workspace).map(d=>Object.freeze({...d}));
  if(!rows.length)return false;
  const batch={rows,scope:Object.freeze({...scope}),timer:0,sent:false,revoked:false};
  for(const d of rows)luGone.add(d.id);
  luDocuments=luDocuments.filter(d=>!luGone.has(d.id));
  if(luPick.items){for(const d of rows)luPick.items.delete(d.id);if(!luPick.items.size)luPick.items=null}
  luRenderLibrary();luGoneBatches.push(batch);
  const undo=()=>{
    if(batch.sent)return {status:'failed',message:'이미 삭제해서 되돌릴 수 없어요.'};
    clearTimeout(batch.timer);batch.sent=true;batch.revoked=true;luGoneBatches=luGoneBatches.filter(b=>b!==batch);for(const d of rows)luGone.delete(d.id);
    if(!luSameScope(batch.scope))return {status:'stale'};
    luRestoreRows(rows);return true;
  };
  notify(rows.length>1?`${rows.length}개를 삭제했어요`:'삭제했어요',{undo,label:rows.length>1?`삭제 ${rows.length}개`:'삭제',ms:LU_DELETE_WAIT_MS});
  batch.timer=setTimeout(()=>void luSendDelete(batch),LU_DELETE_WAIT_MS);
  return true;
}
function luSameScope(a){const b=luDeleteScope();return !!b&&['owner','workspace','epoch'].every(k=>a[k]===b[k])}
async function luSendDelete(batch){
  if(batch.sent)return;batch.sent=true;clearTimeout(batch.timer);luGoneBatches=luGoneBatches.filter(b=>b!==batch);
  const {rows,scope}=batch,isCurrent=()=>luBatchCurrent(batch);
  const release=list=>{for(const d of list)luGone.delete(d.id)};
  luSentBatches.add(batch);
  try{
    if(!isCurrent()){release(rows);return}
    let helper;try{helper=await import('./document-delete.js')}catch{release(rows);if(isCurrent()){luRestoreRows(rows);notify('자료를 삭제하지 못했어요. 다시 시도해 주세요.',{error:true})}return}
    let stopped=null;
    const result=await deleteSequentially(rows.map(d=>d.id),async id=>{
      const d=rows.find(x=>x.id===id),bulk={};
      const ok=await helper.deleteDocument(d,{api:luApi,maybeReconnect:luMaybeReconnectDrive,expectedSessionEpoch:scope.epoch,isCurrent,bulk});
      if(bulk.stop)stopped=bulk.error||null;
      return {ok:!!ok,stop:!!bulk.stop};
    },{isCurrent});
    const done=new Set(result.done),bad=rows.filter(d=>!done.has(d.id));
    release(rows);
    if(!isCurrent())return;// 보낸 뒤 로그인이 바뀌었으면 결과를 화면에 반영하지 않는다(다음 목록 읽기가 서버 상태를 보여 줌).
    if(bad.length){luRestoreRows(bad);notify(bad.length===rows.length?(rows.length>1?`${bad.length}개를 삭제하지 못해 목록에 되살렸어요.`:'삭제하지 못해 목록에 되살렸어요.'):`${done.size}개를 삭제했고 ${bad.length}개는 삭제하지 못해 되살렸어요.`,{error:true,note:'로그인·Google Drive 연결을 확인한 뒤 다시 삭제해 주세요.'})}
    if(done.size)window.dispatchEvent(new CustomEvent('kptu:documents-changed',{detail:{project_id:null,meeting_id:null}}));
    // Drive 연결이 만료돼 멈췄으면, 자료실에 있을 때만 다시 연결을 묻는다(보낼 때 잡은 로그인 번호로).
    // 묻는 동안·연결 주소를 받는 동안 다른 화면을 다녀오면(로그인 갱신으로 같은 화면을 다시 그린 것은 빼고) 이동하지 않는다.
    const routeSeq=luDeleteRouteSeq,here=()=>isCurrent()&&window.KPTURouter?.current==='library'&&routeSeq===luDeleteRouteSeq;
    if(stopped&&luIsDriveAuthError(stopped)&&here())await luMaybeReconnectDrive(stopped,{isCurrent:here,expectedSessionEpoch:scope.epoch});
  }finally{luSentBatches.delete(batch)}
}
function luFlushDeletes(){for(const b of [...luGoneBatches])void luSendDelete(b)}
window.addEventListener('kptu:view-changed',e=>{if(!(e.detail?.view==='library'&&e.detail?.source==='session'))luDeleteRouteSeq++;if(e.detail?.view!=='library')luFlushDeletes()});
document.addEventListener('visibilitychange',()=>{if(document.hidden)luFlushDeletes()});
// 바뀐 로그인 알림을 받으면(다른 사람·로그아웃·빈 토큰·다른 번호) 기다리는 것은 취소, 보내는 중인 것은 결과를 화면에 반영하지 않는다.
// 알림 뒤 원래 로그인으로 돌아와도 취소는 그대로(되살아나 몰래 보내지 않음). 같은 사람의 토큰 갱신은 그대로 둔다.
window.addEventListener('kptu:session-changed',event=>{
  const detail=event.detail,session=detail?.session;
  for(const b of [...luGoneBatches,...luSentBatches]){
    const changed=!luSameScope(b.scope)||(detail&&Object.prototype.hasOwnProperty.call(detail,'session')&&(!session?.access_token?.trim?.()||session.user?.id!==b.scope.owner))||(detail&&Object.prototype.hasOwnProperty.call(detail,'epoch')&&detail.epoch!==b.scope.epoch);
    if(!changed)continue;
    b.revoked=true;
    if(!b.sent){clearTimeout(b.timer);b.sent=true;luGoneBatches=luGoneBatches.filter(x=>x!==b);for(const d of b.rows)luGone.delete(d.id);if(luSameScope(b.scope))luRestoreRows(b.rows)}
  }
});
function luDeleteDocument(id){if(typeof id!=='string'||!id.trim())return;luQueueDelete([id])}
// LIB-여러개삭제: [선택] → 자료 줄 왼쪽 네모 칸 → 위쪽 줄 '[전체] n개 골랐음 [삭제] [취소]'. 상태 주인은 luPick.items(null이면 선택 모드 아님, 화면 기억만).
// 지우기는 하나씩 삭제와 같은 document-delete.js·서버 경로를 한 번에 하나씩 차례로 부른다. 되돌리기는 없고, 지우기 전 확인은 한 번.
// NOTE-탐색기 후속 ⑦: 선택 상태 코드는 노트와 같은 공용 부품(select-mode.js). luPick.items(null = 선택 모드 아님)·luPick.anchor(Shift 시작 줄).
// 폰 뒤로가기(갤럭시 뒤로) = 선택 풀기(노트와 같은 규칙, 요청 2026-10-28). 옮기거나 지우는 중에는 풀지 않고 그대로 둔다.
const luPick=createSelectMode({layer:'library-select',onBack:()=>luRenderLibrary(),canLeave:()=>!luSelBusy});let luSelBusy=false;
const luTreeNode=key=>{let found=null;const walk=list=>{for(const n of list||[]){if(found)return;if(n.key===key){found=n;return}walk(n.children)}};walk(luLastTree);return found};
const luVisibleIds=()=>[...new Set((luLastTree||[]).flatMap(nodeDocumentIds))];
function luNodePick(n){if(!luPick.items)return '';const ids=nodeDocumentIds(n);if(!ids.length)return '';return `<input type="checkbox" class="lu-pick lu-pick-node" data-lu-pick-node="${luEsc(n.key)}" aria-label="${luEsc(n.label)} 안 자료 모두 선택"${allSelected(luPick.items,ids)?' checked':''}>`}
function luAfterRender(){
  // LIB-줄안이름바꾸기: 키보드로 이름을 바꾼 직후 3초 안에 목록이 다시 그려져 초점이 사라지면 같은 줄에 초점을 돌려준다(F2를 계속 쓸 수 있게).
  if(luKeepFocus){const a=document.activeElement;if(Date.now()>luKeepFocus.until||(a&&a!==document.body&&!(a.dataset?.luDocument===luKeepFocus.id)))luKeepFocus=null;else [...document.querySelectorAll('#documentList [data-lu-document]')].find(x=>x.dataset.luDocument===luKeepFocus.id)?.focus({preventScroll:true})}
  luPick.prune(luVisibleIds());
  luSyncPicks();
}
function luSyncPicks(){
  const bar=document.querySelector('#librarySelectBar'),on=!!luPick.items;
  if(bar)bar.hidden=!on;
  // LIB-선택모드(08:29~08:30 ②): 들어갈 때 줄들이 한 번 아주 짧게(0.2초) 살짝 흔들리고 멈춤(계속 흔들지 않음, 움직임 줄이기면 없음),
  // 위 줄은 강조색 띠, 목록 칸 테두리는 연한 강조색(CSS .lu-selecting). 나올 때는 조용히 원래대로.
  const card=document.querySelector('#libraryListCard');
  if(card){const was=card.classList.contains('lu-selecting');card.classList.toggle('lu-selecting',on);
    if(on&&!was){card.classList.remove('lu-sel-enter');void card.offsetWidth;card.classList.add('lu-sel-enter')}else if(!on)card.classList.remove('lu-sel-enter')}
  const barEl=document.querySelector('#librarySelectBar');
  if(!on){barEl?.querySelector('.filter-chips')?.remove();return}
  // 전체 칩은 거르기 칩과 같은 공용 모양(.filter-chips)이라 선택 모드일 때만 그린다.
  if(barEl&&!barEl.querySelector('#librarySelectAll')){barEl.insertAdjacentHTML('afterbegin','<div class="filter-chips filter-chips-small quick-mode-group" role="group" aria-label="전체 선택"><button id="librarySelectAll" class="quick-pill-button" type="button" role="checkbox" aria-checked="false" aria-controls="documentList">전체</button></div>')}
  const ids=luVisibleIds(),list=document.querySelector('#documentList');
  for(const c of list?.querySelectorAll('[data-lu-pick]')||[]){const ids=luTwinIds([c.dataset.luPick]);c.checked=ids.every(x=>luPick.items.has(x));c.indeterminate=ids.length>1&&!c.checked&&ids.some(x=>luPick.items.has(x))}
  for(const c of list?.querySelectorAll('[data-lu-pick-node]')||[]){const nodeIds=nodeDocumentIds(luTreeNode(c.dataset.luPickNode));c.checked=allSelected(luPick.items,nodeIds);c.indeterminate=someSelected(luPick.items,nodeIds)}
  const all=document.querySelector('#librarySelectAll'),count=document.querySelector('#librarySelectCount'),del=document.querySelector('#librarySelectDelete'),cancel=document.querySelector('#librarySelectCancel');
  if(all){all.setAttribute('aria-checked',String(allSelected(luPick.items,ids)));all.disabled=luSelBusy||!ids.length}
  // 빠짐10: 고른 것 중 지금 줄로 보이지 않는 것(접힌 토글·'n건 더'·접힌 같은 글)이 있으면 '— 접힌 n개 포함'.
  if(count&&!luSelBusy){const seen=new Set([...(list?.querySelectorAll('[data-lu-document]')||[])].filter(x=>x.checkVisibility?.()!==false).map(x=>x.dataset.luDocument));let hidden=0;for(const id of luPick.items)if(!seen.has(id))hidden++;count.textContent=pickCountText(luPick.items.size,hidden)}
  if(del)del.disabled=luSelBusy||!luPick.items.size;
  for(const b of barEl.querySelectorAll('[data-lu-bulk],#librarySelectFolder'))b.disabled=luSelBusy||!luPick.items.size;
  const fb=barEl.querySelector('#librarySelectFolder');if(fb)fb.hidden=!luFoldersReady;
  if(cancel)cancel.disabled=luSelBusy;
}
// SEARCH-선택옮기기 ⑤(10/28 10:44): 자료실 검색칸에 글자가 있고 걸러진 자료가 있으면 검색칸 오른쪽에 작은 [결과 n개 모두 고르기].
// 폴더·묶음과 상관없이 걸러진 자료 전부를 선택 모드로 고른다(접힌 폴더 안 것 포함). 그 뒤 옮기기·분류 바꾸기·지우기는 같은 선택 모드가 맡는다.
let luSearchPickIds=[];
function luSyncSearchPickAll(q,matches){
  const row=document.querySelector('.lu-search-row'),input=document.querySelector('#documentSearch');if(!row||!input)return;
  let button=row.querySelector('#luSearchPickAll');
  luSearchPickIds=q?matches.filter(d=>!d.photoset&&!isPhotoSet(d)).map(d=>d.id):[];
  if(!luSearchPickIds.length){button?.remove();return}
  if(!button){
    button=document.createElement('button');button.type='button';button.id='luSearchPickAll';button.className='secondary lu-search-pick-all';
    button.addEventListener('click',()=>{if(luSelBusy||!luSearchPickIds.length)return;luPick.stop();luPick.start([...luSearchPickIds]);luRenderLibrary()});
    input.after(button);
  }
  button.textContent=`결과 ${luSearchPickIds.length}개 모두 선택`;
}
function luSelStart(){if(luPick.active)return;luPick.start();luRenderLibrary()}
// LIB-맨위메뉴하나(빠짐9): 자료실 칸 맨 위 오른쪽 ⋯ 하나에 [새 폴더](폴더 묶기일 때)·[여러 개 고르기]·[모두 펴기·접기]를 모은다.
// 따로 떠 있던 '선택' 글자와 '모두 펴기' 글자는 이 메뉴로 합쳤다. 폴더마다 이름 바꾸기·지우기는 지금처럼 그 폴더 줄 우클릭·꾹 누르기.
let luTopMenu=null;
// 자료실 작은 메뉴(맨 위 ⋯·빈 자리 우클릭)의 글자 줄 하나 — 모양은 공용 메뉴 부품(anchored-menu.js)이 정한다.
function luMenuRow(attrs,label){return `<button type="button" ${attrs}>${label}</button>`}
function luTopMenuHtml(){
  const folder=luFoldersReady&&luGroupBy==='folder';
  return (folder?luMenuRow('data-lu-top="folder"',luInFolder?'이 폴더 안에 새 폴더':'새 폴더'):'')
    +(luPick.active?luMenuRow('data-lu-top="select-stop"','선택 끝내기'):luMenuRow('data-lu-top="select"','여러 개 선택'))
    +luMenuRow(`data-lu-top="expand"${luExpandNow.count?'':' disabled'}`,luExpandNow.open?'모두 접기':'모두 펴기');
}
function luTopMenuOpen(trigger){
  luTopMenu||=createAnchoredMenu({id:'luTopMenu',className:'lu-folder-menu lu-top-menu',label:'자료실 메뉴',historyKey:'kptuLibraryTopMenu',key:()=>'top',render:luTopMenuHtml,
    onAction:(b,active)=>{const act=b.dataset.luTop;if(act==='select')luSelStart();else if(act==='select-stop')luSelStop();else if(act==='expand')luExpandAll();else if(act==='folder')luFolders().createIn(luInFolder||null,active.trigger)}});
  luTopMenu.open(trigger);
}
// S55-08 LIB-우클릭메뉴 (2026-11-09 명진 결정): PC(761px~) 폴더 보기에서 빈 자리(왼쪽 나무 빈 곳·'자료실 전체'·'폴더 밖' 줄, 오른쪽 목록의 어느 폴더도 아닌 바탕,
// 목록 상자 빈 곳)를 우클릭하면 누른 자리에 작은 메뉴 [새 폴더][자료 등록]. 새 폴더는 지금 들어가 있는 폴더 안(자료실 전체·폴더 밖이면 맨 위) — 맨 위 ⋯ [새 폴더]와 같은 창(createIn).
// 왼쪽 나무 폴더 줄 우클릭은 그 폴더의 ⋯ 메뉴(오른쪽 폴더 줄과 같은 메뉴·같은 실행). 자료 줄·폴더 줄·글자 칸·링크·글 고른 상태·Shift는 지금처럼(공용 우클릭·브라우저 메뉴). 폰은 그대로.
let luAreaMenu=null;
let luAreaFolder=null;
function luAreaMenuOpen(owner,x,y,folder=luInFolder){luAreaFolder=folder||null;
  luAreaMenu||=createAnchoredMenu({id:'luAreaMenu',className:'lu-folder-menu lu-area-menu',label:'자료실 빈 자리 메뉴',historyKey:'kptuLibraryAreaMenu',key:()=>'area',
    render:()=>luMenuRow('data-lu-area="folder"','새 폴더')+luMenuRow('data-lu-area="add"','자료 등록'),
    onClose:()=>document.querySelectorAll('#libraryListCard[aria-expanded],#libraryFolderNav[aria-expanded],#documentList[aria-expanded]').forEach(el=>el.removeAttribute('aria-expanded')),
    onAction:(b,active)=>{if(b.dataset.luArea==='folder')luFolders().createIn(luAreaFolder,active.trigger);else if(luOpenUploadWindow())luSetUploadFolder(luAreaFolder);else notify('자료 올리기를 열지 못했어요.',{error:true})}});
  luCloseMenu(()=>luAreaMenu.open(owner,{at:{x,y}}));
}
const LU_CTX_SKIP='input,textarea,select,[contenteditable],a[href],.lu-row,summary,.lu-node,#librarySelectBar,#libraryFolderStatusLine,#libraryPath';
function luOnCardContext(e){
  if(e.defaultPrevented||e.shiftKey||e.ctrlKey||e.altKey||e.metaKey||e.pointerType==='touch'||!LU_SPLIT?.matches||!LU_FINE?.matches)return;
  if(luGroupBy!=='folder'||!luFoldersReady)return;
  const t=e.target;if(!(t instanceof Element))return;
  const sel=window.getSelection?.();if(sel&&!sel.isCollapsed&&sel.toString().trim())return;
  const navRow=t.closest('#libraryFolderNav .ft-row, #documentList [data-lu-pane-i] .ft-row'),navBtn=navRow?.querySelector('[data-lu-nav]');
  const id=navBtn?.dataset.luNav||'';
  if(navBtn&&id&&id!==OUT_KEY){if(!luFolders_.some(f=>f.id===id))return;e.preventDefault();luCloseMenu(()=>luFolders().openAt(navBtn,e.clientX,e.clientY));return}
  if(!navRow&&(t.closest(LU_CTX_SKIP)||t.closest('button')))return;
  e.preventDefault();
  // LIB-두칸보기: 두 칸이면 [새 폴더]는 누른 칸의 지금 폴더 안.
  luAreaMenuOpen(t.closest('[data-lu-pane-i]')||t.closest('#libraryFolderNav')||t.closest('#documentList')||t.closest('#libraryListCard'),e.clientX,e.clientY,luTwoActive()?luTwo.folderAt(t):luInFolder);
}
function luSelStop(){if(!luPick.active||luSelBusy)return;luPick.stop();luRenderLibrary()}
// 메뉴 맨 위 [선택]: 선택 모드를 켜고 그 자료를 고른 채로(최근 올린 파일 칸에서 눌러도 아래 목록과 한 선택 모드).
function luSelStartWith(id){if(luSelBusy||!luDocuments.some(d=>d.id===id))return;luPick.start([id],id);luRenderLibrary()}
// Esc = 선택 모드 풀기(열린 메뉴·창이 Esc를 먼저 가져가면 그쪽이 닫힌다).
function luOnSelEscape(e){
  if(e.key!=='Escape'||e.defaultPrevented||!luPick.items||luSelBusy||window.KPTURouter?.current!=='library')return;
  if(luActiveMenu||luFolderUi?.moveOpen||luBulkUi?.active||[...document.querySelectorAll('.modal,[role="dialog"]')].some(el=>!el.classList.contains('hidden')&&el.checkVisibility?.()))return;
  if(e.target?.closest?.('input:not([type=checkbox]),textarea,select,[contenteditable]'))return;
  e.preventDefault();luSelStop();
}
function luPickToggle(ids){luPick.toggle(luTwinIds(ids),{anchor:false});luSyncPicks()}
// PC: Ctrl/Cmd+클릭 = 그 줄만 더하고 빼기(선택 모드가 아니면 켜면서), Shift+클릭 = 마지막으로 고른 줄부터 이 줄까지 보이는 줄을 모두 더하기.
function luPickAt(e,id){
  if(e.shiftKey&&luPick.anchor!=null){
    const order=[...document.querySelectorAll('#documentList [data-lu-document]')].filter(x=>x.checkVisibility?.()!==false).map(x=>x.dataset.luDocument);
    luPick.range(order,id);const extra=luTwinIds(order).filter(x=>!order.includes(x)&&!luPick.items.has(x)&&luPick.items.has(luTwins.get(x)?.primary));if(extra.length)luPick.toggle(extra,{anchor:false});luSyncPicks();return;
  }
  const ids=luTwinIds([id]);if(ids.length>1){luPick.toggle(ids,{anchor:false});luPick.anchor=id}else luPick.toggle([id]);luSyncPicks();
}
// 목록 안 클릭·키보드: 선택 모드에서는 줄을 눌러도 자료를 열지 않고 고르기만 한다(캡처 단계에서 먼저 처리).
function luOnPickClick(e){
  if(e.target.closest?.('[data-lu-twin]'))return; // 빠짐10: [원본 n]은 펼치기만(고르기·열기 없음)
  if(!luPick.items){
    if(!(e.ctrlKey||e.metaKey||e.shiftKey)||!LU_FINE?.matches)return;
    const row=e.target.closest?.('[data-lu-document]');if(!row||e.target.closest('button,input,a,[contenteditable]'))return;
    e.stopPropagation();e.preventDefault();luSelStart();luPickAt(e,row.dataset.luDocument);return;
  }
  const t=e.target;
  const node=t.closest?.('[data-lu-pick-node]');
  if(node){e.stopPropagation();if(!luSelBusy)luPickToggle(nodeDocumentIds(luTreeNode(node.dataset.luPickNode)));else luSyncPicks();return}
  const pick=t.closest?.('[data-lu-pick]');
  if(pick){e.stopPropagation();if(!luSelBusy)luPickAt(e,pick.dataset.luPick);else luSyncPicks();return}
  const row=t.closest?.('[data-lu-document]');
  if(row&&!t.closest('[data-lu-menu]')){e.stopPropagation();e.preventDefault();if(!luSelBusy)luPickAt(e,row.dataset.luDocument)}
}
function luOnPickKey(e){if(!luPick.items||(e.key!=='Enter'&&e.key!==' ')||!e.target.matches?.('[data-lu-document]'))return;e.stopPropagation();e.preventDefault();if(!luSelBusy)luPickToggle([e.target.dataset.luDocument])}
// LIB-폴더탐색기 ③: 일괄 수정. [프로젝트|담당조직|종류 바꾸기]는 작은 목록을 열고, 고르면 고른 자료 모두에 같은 서버 길(자료 정보 수정과 같은 PATCH)로 차례로 적용한다.
// 바꾼 칸은 칸별 기록 'user'로 남아 AI 자동 정리가 되돌리지 않고, 끝나면 '… 바꿨어요 · 되돌리기'(그 사이 또 바뀐 자료는 건드리지 않음).
let luBulkEd=null,luBulkUi=null;
let luBulkTarget=null;
const luSelectedDocs=()=>luPick.items?[...luPick.items].map(id=>luDocuments.find(d=>d.id===id)).filter(Boolean):[];
const luBulkDocs=()=>luBulkTarget?luBulkTarget.map(id=>luDocuments.find(d=>d.id===id)).filter(Boolean):luSelectedDocs();
// 자료 메뉴의 [분류 바꾸기 ›]: 메뉴를 열었던 자리(⋯·우클릭·꾹 누른 줄)에 분류 목록을 연다. 선택 모드면 고른 것 모두.
function luOpenCategoryFor(id,anchor){
  if(luSelBusy||!luDocuments.some(d=>d.id===id))return;
  luBulkTarget=luPick.items&&luPick.items.has(id)?null:[id];
  const at=anchor?.isConnected?anchor:[...document.querySelectorAll('#documentList [data-lu-menu]')].find(x=>x.dataset.luMenu===id);
  if(!at){luBulkTarget=null;return}
  luBulkMenu().open(at);
}
function luBulk(){
  if(!luBulkEd)luBulkEd=createBulkEditor({api:luApi,scope:luDeleteScope,docs:()=>luDocuments,replaceRow:row=>{luDocuments=luDocuments.map(old=>old.id===row.id?structuredClone(row):old)},isCurrent:()=>window.KPTURouter?.current==='library',onProgress:({index,total})=>{const c=document.querySelector('#librarySelectCount');if(c)c.textContent=`바꾸는 중 ${index}/${total}`}});
  return luBulkEd;
}
function luBulkMenu(){
  if(luBulkUi)return luBulkUi;
  luBulkUi=createAnchoredMenu({id:'luBulkMenu',className:'lu-folder-menu lu-bulk-menu',label:'선택한 자료 일괄 바꾸기',historyKey:'kptuLibraryBulkMenu',key:t=>t.dataset.luBulk||'category',onClose:()=>{luBulkTarget=null},
    render:kind=>{
      const cur=commonValue(luBulkDocs(),kind);
      return bulkChoices(kind,{projects:luProjectRows(),organizations:kind==='organization'?luBulkOrganizations(cur):[],categories:orderedDocumentCategories()}).map(c=>`<button type="button" data-lu-bulk-value="${luEsc(c.value)}"${cur!==undefined&&(cur??'')===c.value?' aria-current="true"':''}${c.depth?` style="--lu-depth:${Number(c.depth)||0}"`:''}>${luEsc(c.label)}${cur!==undefined&&(cur??'')===c.value?'<span class="lu-menu-key" aria-hidden="true">✓</span>':''}</button>`).join('')||'<button type="button" disabled>선택할 수 있는 값이 없어요</button>';
    },
    onAction:(button,active)=>{if(button.disabled)return;const ids=luBulkTarget;void luBulkApply(active.id,button.dataset.luBulkValue??'',ids)}});
  return luBulkUi;
}
async function luOpenBulkMenu(button){
  if(button.dataset.luBulk==='organization'&&!luOrganizations){await luLoadOrganizations();if(!luPick.items)return}
  // S52-01 ③c: 사업영역·담당조직은 공용 고르기 창(하나만, 맨 위 '사업영역 없음'·'담당조직 없음'). 고른 자료가 모두 같은 값이면 그 줄이 눌린 채.
  // 고르면 지금과 같은 일괄 바꾸기(luBulkApply). 분류는 그대로 작은 메뉴.
  const kind=button.dataset.luBulk;
  if(kind==='project'||kind==='organization'){
    const cur=commonValue(luBulkDocs(),kind),used=await usedKeysNow().catch(()=>[]),prefix=kind==='project'?'p:':'o:';
    if(!luPick.items||!button.isConnected)return;
    const groups=kind==='organization'?orderedOrgGroups(window.KPTUOrganizationOrder?.groups?window.KPTUOrganizationOrder.groups(luBulkOrganizations(cur)):[luBulkOrganizations(cur)]):[];
    await openAreaOrgPicker({kind:kind==='project'?'area':'org',trigger:button,used,multi:false,none:BULK_FIELDS[kind].none,title:BULK_FIELDS[kind].label+' 바꾸기',
      areas:kind==='project'?catalogAreas(luCatalog()?.tree||[]):[],orgGroups:groups,selected:cur?[prefix+cur]:[],
      onCommit:keys=>{const k=[...keys][0]||'';if(!luPick.items)return;void luBulkApply(kind,k.startsWith(prefix)?k.slice(2):'')}});
    return;
  }
  luBulkMenu().open(button);
}
async function luBulkApply(kind,value,only=null){
  const pool=only||(luPick.items?[...luPick.items]:[]);
  if(luSelBusy||!pool.length||!BULK_FIELDS[kind])return;
  if(kind==='project'&&!luIsSelectableProject(value)){luFolderStatus('선택한 사업영역을 더 이상 사용할 수 없어요. 목록을 다시 열어 주세요.',true);return}
  if(!luDeleteScope()){luFolderStatus('로그인 세션을 확인하지 못했어요. 다시 로그인한 뒤 시도해 주세요.',true);return}
  const ids=pool.filter(id=>luDocuments.some(d=>d.id===id)),label=BULK_FIELDS[kind].label;
  if(!ids.length)return;
  luSelBusy=true;luSyncPicks();
  let r=null;
  try{r=await luBulk().apply(ids,kind,value)}catch{r=null}finally{luSelBusy=false}
  if(window.KPTURouter?.current!=='library')return;
  if(!r||r.error){luSyncPicks();luFolderStatus('바꾸지 못했어요. 로그인 상태를 확인한 뒤 다시 시도해 주세요.',true);return}
  luAfterBulk(ids,[...r.failed,...r.skipped],!only);
  if(r.changed)window.dispatchEvent(new CustomEvent('kptu:documents-changed'));
  const bad=r.failed.length+r.skipped.length;
  luRenameNotice(bulkResultText({label,changed:r.changed,same:r.same,failed:r.failed.length,skipped:r.skipped.length}),{error:bad>0,undo:r.changed?async()=>{
    const u=await luBulk().undo(r.before,kind,value);
    if(window.KPTURouter?.current!=='library')return;
    luRenderLibrary();window.dispatchEvent(new CustomEvent('kptu:documents-changed'));
    luFolderStatus(u?.error?'되돌리지 못했어요.':u.kept?`${u.back}개를 되돌렸고 ${u.kept}개는 그 사이 바뀌어 그대로 뒀어요.`:`${u.back}개를 되돌렸어요.`,!!u?.error);
  }:null});
}
// LIB-후속1 ③: 일괄 작업(옮기기·분류 바꾸기)이 끝나면 선택 모드는 저절로 풀고, 실패한 것만 고른 채로 남긴다. 바뀐 줄은 잠깐 강조색으로 반짝.
function luAfterBulk(ids,failed,fromSelection=true){
  const bad=new Set((failed||[]).map(x=>typeof x==='string'?x:x?.id).filter(Boolean));
  if(fromSelection&&luPick.items){luPick.items=bad.size?new Set([...bad]):null}
  luRenderLibrary();
  const ok=new Set(ids.filter(id=>!bad.has(id)));if(!ok.size)return;
  for(const row of document.querySelectorAll('#documentList .lu-row[data-lu-document]'))if(ok.has(row.dataset.luDocument)){row.classList.remove('lu-flash');void row.offsetWidth;row.classList.add('lu-flash')}
}
function luSelAll(){if(!luPick.items||luSelBusy)return;luPickToggle(luVisibleIds())}
function luSelDelete(){
  if(!luPick.items||luSelBusy||!luPick.items.size)return;
  const shown=luVisibleIds(),ids=[...luPick.items].filter(id=>luDocuments.some(d=>d.id===id)).sort((a,b)=>shown.indexOf(a)-shown.indexOf(b));// 화면에 보이는 차례로
  if(ids.length)luQueueDelete(ids);
}
function luBindSelect(){
  const list=document.querySelector('#documentList');
  if(!list||list.dataset.luSelBound)return;list.dataset.luSelBound='1';
  list.addEventListener('click',luOnPickClick,true);list.addEventListener('keydown',luOnPickKey,true);
  document.querySelector('#libraryTopMenuBtn')?.addEventListener('click',e=>luTopMenuOpen(e.currentTarget));
  document.querySelector('#librarySelectBar')?.addEventListener('click',e=>{if(e.target.closest('#librarySelectAll'))luSelAll()});
  document.querySelector('#librarySelectDelete')?.addEventListener('click',luSelDelete);
  document.querySelector('#librarySelectBar')?.addEventListener('click',e=>{
    const bulk=e.target.closest('[data-lu-bulk]');
    if(bulk){if(luPick.items&&!luSelBusy&&luPick.items.size)void luOpenBulkMenu(bulk);return}
    const folder=e.target.closest('#librarySelectFolder');
    if(folder&&luPick.items&&!luSelBusy&&luPick.items.size){const ui=luFolders();if(ui.moveOpen)void ui.closeMove();else ui.openMove(luSelectedDocs(),folder,{place:'below',history:true})}
  });
  list.addEventListener('mousedown',e=>{if(e.shiftKey&&LU_FINE?.matches&&e.target.closest?.('[data-lu-document]'))e.preventDefault()});
  document.querySelector('#librarySelectCancel')?.addEventListener('click',luSelStop);
  document.addEventListener('keydown',luOnSelEscape);
  // Shift+클릭으로 여러 줄을 고를 때 화면 글자가 파랗게 칠해지지 않게(선택 모드 중 목록 칸 전체).
  document.querySelector('#libraryListCard')?.addEventListener('mousedown',e=>{if(e.shiftKey&&luPick.items&&LU_FINE?.matches&&!e.target.closest?.('input:not([type=checkbox]),textarea,[contenteditable]'))e.preventDefault()});
  window.addEventListener('kptu:view-changed',event=>{if(luPick?.items&&!luSelBusy&&event.detail?.view!=='library'){luPick.items=null;luSyncPicks()}});
  window.addEventListener('kptu:session-changed',()=>{if(luPick?.items&&!luSelBusy){luPick.items=null;luSyncPicks()}});
}
// LIB-자동정리: 자료실을 열 때(목록을 읽은 뒤) 정리 안 된 기존 자료를 조용히 소량씩 서버에 채우기 요청한다. 버튼·표시·안내문 없음.
// 목록 열기는 이것을 기다리지 않는다. 한 번에 하나만 돌고, 로그인·업무공간이 바뀌거나 자료실을 떠나면 다음 요청을 보내지 않는다.
// 한도·준비 안 됨으로 멈추면 이 로그인 동안(화면 메모리만) 다시 부르지 않는다. 새로 고치거나 다시 로그인하면 서버가 다시 판단한다.
const LU_TIDY_HALT=new Set(['daily_limit','monthly_limit','library_not_ready','not_ready','unsupported_kind','invalid_request','ai_not_configured','forbidden','session_required']);
let luTidyRun=null,luTidyHalted='';
function luTidyScope(){const rt=window.KPTURuntime;const epoch=rt?.session?.epoch?.();return Number.isInteger(epoch)&&luWorkspace&&luUser?.id?{epoch,workspace:luWorkspace,user:luUser.id}:null}
function luStartAutoTidy(){
  if(luTidyRun)return;
  const scope=luTidyScope();if(!scope)return;
  const key=[scope.epoch,scope.workspace,scope.user].join(':');if(luTidyHalted===key)return;
  const rt=window.KPTURuntime;
  const isCurrent=()=>{const now=luTidyScope();return !!now&&now.epoch===scope.epoch&&now.workspace===scope.workspace&&now.user===scope.user&&window.KPTURouter?.current==='library'};
  if(!isCurrent())return;
  const onChanged=()=>{luLoadDocuments().then(()=>{if(isCurrent())luRenderLibrary()}).catch(()=>{})};
  luTidyRun=autoTidyLibrary(luDocuments,{rt,workspace:scope.workspace,categories:documentCategories(),isCurrent,onChanged}).then(r=>{if(LU_TIDY_HALT.has(r?.stop))luTidyHalted=key}).catch(()=>{}).finally(()=>{luTidyRun=null});
}
// SEARCH-전체검색 ② 기존 자료 글자 채우기: 같은 자리에서, 한 번에 소수만 뒤에서 읽는다(document-text-read.js). 버튼·표시 없음.
function luStartTextRead(){
  if(luTidyRun){luTidyRun.then(luStartTextRead);return}// 정리 요청이 끝난 뒤 시작(같은 자료를 동시에 읽지 않게)
  const scope=luTidyScope();if(!scope)return;
  const isCurrent=()=>{const now=luTidyScope();return !!now&&now.epoch===scope.epoch&&now.workspace===scope.workspace&&now.user===scope.user&&window.KPTURouter?.current==='library'};
  startAutoTextRead({rt:window.KPTURuntime,scopeKey:[scope.epoch,scope.workspace,scope.user].join(':'),isCurrent});
}
function luManage(options){const addSubTo=typeof options?.addSubTo==='string'?options.addSubTo:'';luEnsureManageUi();luOpen('libraryManageModal');if(!luCategoryEditor)luCategoryEditor=mountCategoryEditor(document.querySelector('#libraryCategoryEditor'),{onCount:n=>{const c=document.querySelector('#libraryManageModal [data-le-count]');if(c)c.textContent=Number.isInteger(n)?`${n}개`:''},documents:()=>luDocuments,refresh:async()=>{await luLoadDocuments();return luDocuments},onChanged:()=>{luRenderLibrary()}});void luCategoryEditor.open({addSubTo})}
// A basket attachment's [자료실에서 보기] (BASKET-4b-1): once the list has loaded,
// show that document's row. Filters are cleared only when they hide it.
// HWP-편집기 메뉴 입구: [자료실에 올리기]로 넘어온 파일을 기존 [+ 자료 등록] 창에 채워 연다. 프로젝트·분류와 [등록]은 사용자가 한다.
function luOpenRequestedUpload(){if(window.KPTURouter?.current!=='library'||luUploading)return;const file=takeLibraryUploadRequest();if(!file)return;if(!luOpenUploadWindow()){luSetStatus(document.querySelector('#documentStatus'),'자료 등록 창을 열지 못했어요. 잠시 후 다시 시도해 주세요.',true);return}luSetSelectedFiles([file]);luSetStatus(document.querySelector('#documentStatus'),'HWP 편집에서 수정한 파일을 넣었어요. 사업영역·분류를 선택한 뒤 [등록]을 누르세요.')}
// SEARCH-선택옮기기(1차): 전체 검색에서 넘겨받은 자료들을 고른 채로 선택 모드를 켠다. 가리는 거르기(검색·프로젝트·분류 칩·담당조직)는 풀고, 첫 자료로 간다.
function luSelectRequested(){
  const ids=takeLibrarySelectionRequest();if(!ids||window.KPTURouter?.current!=='library'||luSelBusy)return false;
  const have=ids.filter(id=>luDocuments.some(d=>d.id===id));if(!have.length)return false;
  const search=document.querySelector('#documentSearch'),project=document.querySelector('#documentProject');if(search)search.value='';luFindOpen=false;if(project)project.value='all';
  luCategoryOff=new Set();luCategorySub='';luViewHold=true;luOrganization=null;luPick.stop();luPick.start(have,have[0]);luRenderLibrary();
  for(const id of have)luRevealInTree(id);
  const row=document.querySelector(`#documentList [data-lu-document="${CSS.escape(have[0])}"]`);if(row){row.scrollIntoView({block:'center'});row.focus({preventScroll:true})}
  const miss=ids.length-have.length;if(miss)luFolderStatus(`${miss}개는 자료실 목록에 없어 선택하지 못했어요.`,true);
  return true;
}
function luRevealRequested(){if(luSelectRequested())return;const id=takeLibraryDocumentRequest();if(!id||window.KPTURouter?.current!=='library')return;const doc=luDocuments.find(d=>d.id===id);if(!doc)return;const find=()=>document.querySelector(`#documentList [data-lu-document="${CSS.escape(id)}"]`);let row=find();if(!row){const search=document.querySelector('#documentSearch'),project=document.querySelector('#documentProject');if(search)search.value='';luFindOpen=false;if(project)project.value='all';luCategoryOff=new Set();luViewHold=true;luOrganization=null;luRenderLibrary();row=find()}if(!row||!row.checkVisibility?.()){luRevealInTree(id);row=find()}if(row){row.scrollIntoView({block:'center'});row.focus({preventScroll:true})}}
// UI-PC자료실 B안: 이름이 잘린 줄에만 ⋯ 왼쪽 작은 펼치기 버튼. 누르면 그 줄만 전체 이름을 펼치고(다시 누르면 접기), 자료는 열지 않는다.
// 잘림 여부는 그린 뒤와 목록 폭이 바뀔 때 다시 잰다. 펼친 줄의 버튼은 접을 수 있게 남긴다.
const luTruncated=el=>!!el&&(el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1);
function luMarkLongNames(box){const phone=luPhone();box?.querySelectorAll('.lu-row').forEach(row=>{const button=row.querySelector('[data-lu-expand]');if(phone)row.classList.remove('lu-expanded');if(button){button.hidden=phone||!row.classList.contains('lu-expanded')&&!luTruncated(row.querySelector('.lu-row-title'));if(button.hidden)button.setAttribute('aria-expanded','false')}})}
function luToggleName(button){const row=button.closest('.lu-row'),open=!row.classList.contains('lu-expanded');row.classList.toggle('lu-expanded',open);button.setAttribute('aria-expanded',String(open));button.setAttribute('aria-label',open?'이름 접기':'전체 이름 보기');if(!open)luMarkLongNames(row.parentElement)}
function luBindList(){luBindRecent();const list=document.querySelector('#documentList');if(!list||list.dataset.luBound)return;list.dataset.luBound='1';luMakeTwo();window.addEventListener('kptu:view-changed',e=>{if(e.detail?.view!=='library'){luFolderLayer=null;luOutLayer=null}});document.querySelector('#libraryListCard')?.addEventListener('animationend',e=>{if(e.animationName==='lu-sel-nudge')e.currentTarget.classList.remove('lu-sel-enter')});luBindSelect();luBindMenu();luBindRename(list);luFolders().bindKeys(list);document.querySelector('#libraryListCard')?.addEventListener('contextmenu',luOnCardContext);list.addEventListener('toggle',luOnToggle,true);/* S51-24 UI-빈칸손짓: 손짓 칸 = 자료실 화면 전체(테두리 있는 목록 상자는 늘이지 않고 그 바깥 빈 곳까지, 아래 바 바로 위까지) */const luGestureArea=list.closest('.view-panel')||list;fillGestureArea(luGestureArea);bindFolderPinch(luGestureArea,{enabled:()=>luGroupBy==='folder'&&!luPick.items,folderAt:el=>{luPinchNav=false;if(!luTwoActive()){const nv=el.closest('#libraryFolderNav .ft-row')?.querySelector('[data-lu-nav]'),nid=nv?.dataset.luNav||'';if(nid&&nid!==OUT_KEY){luPinchNav=true;return nid}}if(luTwoActive()){const n=el.closest('[data-lu-pane-i] [data-lu-nav]')||el.closest('[data-lu-pane-i] .ft-row')?.querySelector('[data-lu-nav]'),sub=el.closest('[data-lu-pane-sub]'),id=n?.dataset.luNav||sub?.dataset.luPaneSub||'';luPinchEl=el;return id&&id!==OUT_KEY?id:null}let d=el.closest('details.lu-node');while(d&&!String(d.dataset.luNode||'').startsWith('f:'))d=d.parentElement?.closest('details.lu-node');return d?d.dataset.luNode.slice(2):null},onOut:id=>luPinchNav?luEnterFolder(id):luTwoActive()?luTwo.enter(id,luPinchEl):luFocusFolder(id),onIn:()=>luTwoActive()?luTwo.up(luPinchEl):luLeaveFocus()});/* FILES-폰폴더위로 ④⑤: 폰 '그 폴더만'에서 화면 왼쪽 끝에서 오른쪽으로 밀기 = [‹]와 같은 곳 */bindEdgeBack(luGestureArea,{enabled:()=>!!LU_PHONE?.matches&&!!luInFolder&&!luTwoActive()&&!luPick.items,onBack:()=>luFocusUp()});list.addEventListener('click',luOnHeadClick);luFolders().bindDrag(list);LU_FINE?.addEventListener?.('change',luRenderLibrary);list.addEventListener('click',e=>{const b=e.target.closest('[data-lu-node-menu]');if(!b)return;e.preventDefault();e.stopPropagation();luCloseMenu(()=>luFolders().open(b))});list.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches?.('[data-lu-node-menu]')){e.preventDefault();e.stopPropagation();luCloseMenu(()=>luFolders().open(e.target))}},true);list.addEventListener('click',e=>{const more=e.target.closest('[data-lu-more]');if(!more)return;e.stopPropagation();const key=more.dataset.luMore;luShowAll.add(key);luRenderLibrary();const node=[...list.querySelectorAll('[data-lu-node]')].find(n=>n.dataset.luNode===key);const rows=node?.querySelectorAll(':scope > .lu-node-body > .lu-row');rows?.[Math.min(rows.length-1,20)]?.focus({preventScroll:true})});list.addEventListener('click',e=>{const show=e.target.closest('[data-lu-show-off]');if(!show)return;let names=[];try{names=JSON.parse(show.dataset.luShowOff)}catch{}names.forEach(n=>luCategoryOff.delete(n));luCategorySub='';luRenderLibrary()});if(typeof ResizeObserver==='function')new ResizeObserver(()=>luMarkLongNames(list)).observe(list);LU_PHONE?.addEventListener?.('change',luRenderLibrary);list.addEventListener('click',e=>{const tw=e.target.closest('[data-lu-twin]');if(!tw)return;e.stopPropagation();e.preventDefault();const id=tw.dataset.luTwin;if(luTwinOpen.has(id))luTwinOpen.delete(id);else luTwinOpen.add(id);luRenderLibrary();list.querySelector(`[data-lu-twin="${CSS.escape(id)}"]`)?.focus({preventScroll:true})},true);list.addEventListener('click',async e=>{const expand=e.target.closest('[data-lu-expand]');if(expand){e.stopPropagation();luToggleName(expand);return}const menu=e.target.closest('[data-lu-menu]');if(menu){e.stopPropagation();luOpenMenu(menu);return}const set=e.target.closest('[data-lu-photoset]');if(set){if(!luPick.items)await luOpenPhotoSet(set.dataset.luPhotoset);return}const card=e.target.closest('[data-lu-document]');if(card)await luOpenDocument(card.dataset.luDocument)});list.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches?.('[data-lu-photoset]')){e.preventDefault();if(!luPick.items)void luOpenPhotoSet(e.target.dataset.luPhotoset);return}if((e.key==='Enter'||e.key===' ')&&e.target.matches?.('[data-lu-document]')){e.preventDefault();luOpenDocument(e.target.dataset.luDocument)}})}
// LIB-위쪽한줄 가안(폰 ~760px): 첫 줄은 제목 '자료실' + ⌕·+·⋯ 작은 아이콘. ⌕를 누르면 첫 줄이 찾기 칸 + ✕로 바뀌고, 쓰는 글자는 지금처럼 목록을 거른다.
// ✕는 찾는 글자를 비우고 닫는다(보이지 않는 거르기가 남지 않게). 글자가 들어 있으면(다른 화면이 채운 경우 포함) 찾기 칸은 열린 채다. PC 폭은 찾기 칸이 늘 보인다(CSS).
function luSyncFind(){const row=document.querySelector('.lu-search-row'),input=document.querySelector('#documentSearch');if(!row||!input)return;const open=luFindOpen||!!input.value;row.toggleAttribute('data-lu-find',open);document.querySelector('#librarySearchOpen')?.setAttribute('aria-expanded',String(open))}
function luBindFind(){
  const open=document.querySelector('#librarySearchOpen'),close=document.querySelector('#librarySearchClose'),input=document.querySelector('#documentSearch');if(!open||!close||!input||open.dataset.luBound)return;open.dataset.luBound='1';
  open.addEventListener('click',()=>{luFindOpen=true;luSyncFind();input.focus()});
  close.addEventListener('click',()=>{luFindOpen=false;const had=!!input.value;input.value='';luSyncFind();if(had)luRenderLibrary();open.focus()});
  input.addEventListener('keydown',e=>{if(e.key==='Escape'&&luFindOpen&&!input.value){e.preventDefault();close.click()}});
}
async function luInit(){if(!(await luContext()))return;luTakePlace();luHandleDriveReturn();luEnhanceUpload();luEnhanceDrop();luEnsureManageUi();luBindList();luViewOwner=luUser?.id||'';await Promise.all([luLoadAll(),loadDocumentCategories(),luRefreshView()]);luApplyRememberedFolder();luRenderUploadCategory();luRenderLibrary();window.KPTULibrary={render:luRenderLibrary,reveal:luGoToRecent,showOrganization:luShowOrganization,startUploadForOrganization:luStartUploadForOrganization,startUploadForProject:luStartUploadForProject,startUploadForMeeting:luStartUploadForMeeting,uploadFileForMeeting:luUploadFileForMeeting,startUploadFromFiles:luStartUploadFromFiles};const save=document.querySelector('#saveDocumentBtn');if(save){const original=save.onclick;save.onclick=()=>luUploadOrOriginal(original)}const newDocument=document.querySelector('#newDocumentBtn');if(newDocument)newDocument.addEventListener('click',()=>{luResetUploadSelection();luRenderUploadProject('');luSetUploadOrg(null);luSetUploadMeeting(null);luSetUploadFolder(window.KPTURouter?.current==='library'?luOpenedFolder():null)},true);luRenderUploadProject('');const catPick=document.querySelector('#libraryCategoryPick');if(catPick)catPick.onclick=e=>luOpenCategorySheet(e.currentTarget);const search=document.querySelector('#documentSearch');if(search)search.oninput=()=>{luSyncFind();luRenderLibrary()};luBindFind();window.addEventListener('kptu:before-view-change',e=>{if(e.detail?.view==='library')luEntering=window.KPTURouter?.current!=='library'});window.KPTURouter?.on('library',()=>{luOpenRequestedUpload();if(luEntering){luViewHold=false;luFindOpen=false;luResetCategories();luResetTree()}luEntering=false;luApplyEntry();luRenderLibrary();void luRefreshView();void loadDocumentCategories();luLoadAll().then(()=>{luRenderLibrary();luRevealRequested();luStartAutoTidy();luStartTextRead();luWarmHwp()}).catch(err=>console.error('library entry refresh failed',err))});window.addEventListener('kptu:edit-document',e=>{const id=e.detail?.id;if(id)luOpenEditById(id)});window.addEventListener('kptu:documents-changed',async()=>{await luLoadAll();luRenderLibrary()});window.addEventListener('kptu:project-catalog-updated',luOnProjectsChanged);window.addEventListener('kptu:document-categories-changed',luOnCategoriesChanged);window.addEventListener('kptu:view-changed',event=>{if(event.detail?.view!=='library'){luFlushView();if(luOrganization){luOrganization=null;luRenderLibrary()}}});document.addEventListener('visibilitychange',()=>{if(document.hidden)luFlushView()});if(window.KPTURouter?.current==='library')luApplyEntry();luStartAutoTidy();luStartTextRead();luWarmHwp()}
window.__KPTU_LIBRARY_UPLOAD_READY__=Promise.resolve().then(luInit).then(()=>true).catch(err=>{console.error('library upload init',err);return false});
