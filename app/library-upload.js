import './enter-save.js'; // UI-엔터저장: shared Enter-to-save rule for the data-enter-save roots below
import {renderFilterChips} from './filter-chips.js';
import {readView,saveView,allState,afterAllTap} from './library-view-pref.js';
import {GROUP_BY,GROUP_LABELS,buildTree,treeHtml,keys as luTreeKeys,matchedKeys,pathTo} from './library-tree.js';
import {mountLibraryFolders} from './library-folders.js';
import {takeLibraryDocumentRequest} from './basket-library-send.js';
import {isHwpName,requestHwpEdit} from './hwp-drive.js';
import {takeLibraryUploadRequest} from './library-upload-request.js';
import {normalizeUploadMeeting,uploadMeetingLabel} from './library-upload-meeting.mjs';
import {normalizeUploadOrganization,uploadOrganizationLabel,linkUploadedDocument} from './library-upload-organization.js';
import {fileLine,bindDropTarget} from './meeting-compact.js';
import {documentCategories,categoryOf,categoryOptions,categoryTag,loadDocumentCategories} from './document-categories.js';
import {mountCategoryEditor} from './document-category-editor.js';
import {startAutoTextRead} from './document-text-read.js';
import {fillLibraryDocument,keptFields,originAfterEdit,autoTidyLibrary} from './library-ai-fill.js';
const LU_SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const LU_KEY='sb_publishable_X-0lXJztIQUriUidBZ1PLQ_QemTRSpA';
const LU_SESSION='kptu_collab_session_v1';
let luSession=null,luUser=null,luWorkspace=null,luRole=null,luDocuments=[],luUploadEntries=[],luCategoryOff=new Set(),luOrganization=null,luCategoryEditor=null,luEditOriginal=null,luEditBaseline=null;
let luEditSequence=0,luEditView=0,luEditor=null,luEditObservedScope=null;const luEditAttempts=new Map();
// These tokens own only the lifetime of in-flight UI work, not deletion authority.
const luDeleteTokens=new Set();
window.addEventListener('kptu:before-reload',event=>{if(luUploadEntries.length&&!document.querySelector('#documentModal')?.classList.contains('hidden'))event.detail.otherDraft=true});
function luRead(){if(window.KPTURuntime?.session)return window.KPTURuntime.session.read();try{return JSON.parse(localStorage.getItem(LU_SESSION)||'null')}catch{return null}}
async function luEnsure(){if(window.KPTURuntime?.session){const ok=await window.KPTURuntime.session.ensure();luSession=window.KPTURuntime.session.read();return ok}luSession=luRead();if(!luSession)return false;if((luSession.expires_at||0)<Math.floor(Date.now()/1000)+60&&luSession.refresh_token){const r=await fetch(LU_SB+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:LU_KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:luSession.refresh_token})});if(!r.ok)return false;const d=await r.json();d.expires_at=d.expires_at||Math.floor(Date.now()/1000)+(d.expires_in||3600);luSession=d;localStorage.setItem(LU_SESSION,JSON.stringify(d))}return true}
async function luApi(path,{method='GET',body=null,prefer='',expectedSessionEpoch=null,singleFlight=true,refreshSession=true}={}){if(window.KPTURuntime?.api)return window.KPTURuntime.api(path,{method,body,prefer,expectedSessionEpoch,singleFlight,refreshSession});if(!(await luEnsure()))throw new Error('로그인이 필요합니다.');const form=body instanceof FormData,h={apikey:LU_KEY,Authorization:'Bearer '+luSession.access_token};if(!form)h['Content-Type']='application/json';if(prefer)h.Prefer=prefer;const r=await fetch(LU_SB+path,{method,headers:h,body:body===null?null:(form?body:JSON.stringify(body)),cache:'no-store'});const t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(d?.message||d?.error_description||d?.hint||('요청 실패 '+r.status));return d}
function luEsc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function luSize(n){n=Number(n)||0;if(!n)return'';if(n<1024)return n+'B';if(n<1048576)return(n/1024).toFixed(1)+'KB';return(n/1048576).toFixed(1)+'MB'}
function luCatalog(){const s=window.KPTUProjectCatalog?.snapshot?.();return s?.loaded&&s.workspaceId===luWorkspace&&s.userId===luUser?.id?s:null}
async function luLoadProjects(force=false){const c=window.KPTUProjectCatalog;if(!c||!luWorkspace||!luUser?.id)return null;try{return await c.load({workspaceId:luWorkspace,userId:luUser.id,force})}catch(e){console.error('library project catalog load failed',e);return null}}
function luProjectRows(){const c=window.KPTUProjectCatalog;return (luCatalog()?.tree||[]).map(({project,depth})=>({value:project.id,label:c.label(project.name||'이름 없는 프로젝트',depth),depth}))}
// PRJ-3단 (명진 결정 2, 추천안): a project chosen in the filter shows its own documents and those of every project under it
// (a 1st level → its 2nd and 3rd levels; a 2nd level → its 3rd level). A stale id (not in the tree) matches itself only.
function luProjectScope(pid){if(!pid||pid==='all')return null;const rows=luProjectRows(),i=rows.findIndex(r=>r.value===pid),out=new Set([pid]);if(i>=0)for(let j=i+1;j<rows.length&&rows[j].depth>rows[i].depth;j++)out.add(rows[j].value);return out}
function luIsSelectableProject(id){return !id||luProjectRows().some(r=>r.value===id)}
function luProjectName(id){if(!id)return'';if(!luCatalog())return'프로젝트 연결';const d=window.KPTUProjectCatalog.describe(id);if(d.kind==='active')return d.name||'이름 없는 프로젝트';if(d.kind==='archived')return '[보관됨] '+(d.name||'이름 없는 프로젝트');if(d.kind==='legacy')return '[이전 공간] '+(d.name||'이름 없음');return '[확인할 수 없는 프로젝트]'}
function luOption(value,label,selected,attrs=''){return `<option value="${luEsc(value)}"${value===selected?' selected':''}${attrs}>${luEsc(label)}</option>`}
function luIsDriveAuthError(e){return e?.status===424||/token has been expired or revoked|invalid_grant|Google Drive 토큰 갱신/i.test(String(e?.message||''))}
async function luReconnectDrive(scope){const isCurrent=scope?.isCurrent||(()=>true);if(!isCurrent())return false;if(!['owner','admin'].includes(luRole)){alert('Google Drive 연결이 만료됐습니다. 워크스페이스 관리자에게 Drive 재연결을 요청해 주세요.');return false}try{const d=await luApi('/functions/v1/public-policy-drive',{method:'POST',body:{action:'drive-start'},...(scope?{expectedSessionEpoch:scope.expectedSessionEpoch}:{})});if(!isCurrent())return false;const url=d?.url||d?.auth_url;if(!url)throw new Error('Google Drive 연결 주소를 받지 못했습니다.');location.href=url;return true}catch(e){if(isCurrent())alert(e.message||String(e));return false}}
async function luMaybeReconnectDrive(e,scope){const isCurrent=scope?.isCurrent||(()=>true);if(!isCurrent()||!luIsDriveAuthError(e))return false;if(!['owner','admin'].includes(luRole))return false;const next=scope?'재연결 후 자료 목록과 원본 상태를 먼저 확인해 주세요.':'재연결 후 같은 작업을 다시 실행하면 됩니다.';if(!confirm('Google Drive 연결이 만료됐습니다. 지금 관리자 계정을 다시 연결할까요?\n'+next)||!isCurrent())return false;return await luReconnectDrive(scope)}
function luHandleDriveReturn(){const u=new URL(location.href),result=u.searchParams.get('drive');if(!result)return;if(result==='connected')setTimeout(()=>alert('Google Drive 재연결이 완료됐습니다. 업로드 또는 삭제를 다시 실행해 주세요.'),0);else setTimeout(()=>alert('Google Drive 재연결을 완료하지 못했습니다. 다시 시도해 주세요.'),0);u.searchParams.delete('drive');u.searchParams.delete('reason');history.replaceState({},'',u.pathname+(u.searchParams.toString()?'?'+u.searchParams.toString():'')+u.hash)}

async function luContext(){if(!(await luEnsure()))return false;const shared=window.KPTURuntime?.context?.read?.()||window.__KPTU_BOOT_CONTEXT__;if(shared?.user?.id&&shared?.workspace?.id){luUser=shared.user;luWorkspace=shared.workspace.id;luRole=shared.membership?.role||null}else{luUser=await luApi('/auth/v1/user');if(!luUser?.id)return false;const ms=await luApi('/rest/v1/app_workspace_members?user_id=eq.'+luUser.id+'&select=workspace_id,role&limit=1');if(!ms?.length)return false;luWorkspace=ms[0].workspace_id;luRole=ms[0].role||null}await luLoadProjects();return true}
function luProjectOptions(selected='',{keepStale=false}={}){const rows=luProjectRows(),stale=keepStale&&selected&&!rows.some(r=>r.value===selected);return luOption('','프로젝트 없음',selected)+(stale?luOption(selected,luProjectName(selected),selected,' data-lu-stale-project="1"'):'')+rows.map(r=>luOption(r.value,r.label,selected,` data-depth="${r.depth}"`)).join('')}
function luRenderUploadProject(selected){const s=document.querySelector('#docProject');if(!s)return;const current=selected??s.value??'';s.innerHTML=luProjectOptions(current);s.value=luIsSelectableProject(current)?current:''}
// LIB-토글트리: 프로젝트 칩 줄([프로젝트]·[세부])은 트리가 대신한다. #documentProject는 다른 화면(프로젝트 상세의 자료 "전체 보기")이
// 프로젝트 하나로 걸러 열 때만 보이는 한 줄 [전체 | 그 프로젝트]이다(담당조직 거르기와 같은 모양). 값(host.value)은 그대로 프로젝트 id다.
function luRenderProjectFilter(){
  const host=document.querySelector('#documentProject');if(!host)return;
  if(!host._luChips){const s=document.createElement('span');s.className='lu-filter-label';s.setAttribute('aria-hidden','true');s.textContent='프로젝트';host._luChips=document.createElement('div');host.replaceChildren(s,host._luChips)}
  const pid=host.value&&host.value!=='all'?host.value:'';
  if(!pid){host.value='all';host.hidden=true;return}
  host.hidden=false;
  const d=window.KPTUProjectCatalog?.describe?.(pid),parent=d?.kind==='active'&&d.project?.parent_id?window.KPTUProjectCatalog.describe(d.project.parent_id):null;
  const name=d?.kind==='active'?(parent?.name?parent.name+' › ':'')+(d.name||'이름 없는 프로젝트'):luProjectName(pid);
  renderFilterChips(host._luChips,{label:'프로젝트 필터',controls:'documentList',small:true,value:pid,options:[{value:'all',label:'전체'},{value:pid,label:name}],onChange:value=>{host.value=value;luRenderLibrary()}});
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
// 걸러 보는 중인지 가를 때 비교하는 '들어올 때의 칩 상태'(고른 칩이 이것과 다르면 맞는 자료가 든 토글을 펼친다).
let luBaselineOff=new Set(LU_DEFAULT_OFF);
function luResetCategories(){luCategoryOff=luEnterAllOn?new Set():luDefaultOff();luBaselineOff=luDefaultOff();luEnterAllOn=false}
luResetCategories();
// 분류 칩 기본 상태는 다른 화면에서 자료실로 들어올 때만 되돌린다. 로그인 정보 갱신 등으로 자료실을 그대로 다시 그릴 때는 고른 칩을 지킨다.
let luEntering=false;
const luCategoryShown=name=>!luCategoryOff.has(name);
// LIB-거르기전체(2026-10-23 사용자 확정 11:46): [전체]는 맨 앞 칩. 모두 켜졌으면 누르면 모두 끄고, 일부만 켜졌거나 모두 꺼졌으면 누르면 모두 켠다.
// 일부만 켜진 상태는 칩이 반쯤 찬 모양(aria-pressed="mixed"). 모두 끄면 목록 자리에 '고른 종류 없음' 한 줄.
function luToggleCategory(value){const names=documentCategories();luUserChangedView('categories');if(value==='all')luCategoryOff=afterAllTap(names,luCategoryOff);else if(luCategoryOff.has(value))luCategoryOff.delete(value);else luCategoryOff.add(value);luRenderLibrary()}
// 사용자가 묶기·종류 칩을 고르면 0.4초 뒤 서버에 기억한다(바꾼 칸만 새로 쓰고 나머지는 기억해 둔 값 그대로). 못 쓰면(칸이 아직 없음 등) 화면은 그대로 동작한다.
function luUserChangedView(field){luViewHold=true;luViewPending.add(field);clearTimeout(luViewTimer);luViewTimer=setTimeout(luFlushView,400)}
function luFlushView(){
  clearTimeout(luViewTimer);luViewTimer=0;
  if(!luViewPending.size||!luViewOwner)return;
  const fields=new Set(luViewPending);luViewPending.clear();
  const next={};
  const group=fields.has('groupBy')?luGroupBy:luRemembered?.groupBy;if(group!==undefined)next.groupBy=group;
  const off=fields.has('categories')?documentCategories().filter(n=>luCategoryOff.has(n)):luRemembered?.categoriesOff;if(off!==undefined)next.categoriesOff=off;
  luRemembered=next;
  luViewChain=luViewChain.then(()=>saveView(next)).then(r=>{if(r.status==='error')console.warn('library view not saved')},()=>{});
}
// 자료실에 들어올 때(그리고 처음 열 때) 서버의 기억을 다시 읽어, 그 사이 다른 기기에서 바꾼 것을 맞춘다. 읽는 동안 사용자가 이미 골랐으면 그대로 둔다.
async function luRefreshView(){
  const owner=luUser?.id;if(!owner)return;
  if(luViewOwner&&luViewOwner!==owner)luRemembered=null;
  luViewOwner=owner;
  // 아직 보내지 못한 고른 값이 있으면 먼저 보내고 끝나길 기다린 뒤 읽는다(방금 고른 값을 옛 서버 값으로 덮지 않게).
  luFlushView();await luViewChain;
  const result=await readView();
  if(result.status!=='ok'||luUser?.id!==owner||luViewHold||luViewPending.size)return;
  luRemembered=result.view;luBaselineOff=luDefaultOff();
  let changed=false;
  const group=result.view.groupBy||'project';
  if(group!==luGroupBy){luGroupBy=group;luOpened.clear();luFilterOpen.clear();luShowAll.clear();if(group==='organization')luLoadOrganizations();changed=true}
  if(!luOrganization){const next=luDefaultOff(),same=next.size===luCategoryOff.size&&[...next].every(n=>luCategoryOff.has(n));if(!same){luCategoryOff=next;changed=true}}
  if(changed)luRenderLibrary();
}
function luRenderCategoryFilter(){
  const host=document.querySelector('#libraryCategoryFilter');if(!host)return;
  const names=documentCategories(),state=allState(names,luCategoryOff);
  host.classList.add('filter-chips','quick-mode-group','filter-chips-small');host.setAttribute('role','group');host.setAttribute('aria-label','자료 분류 (여러 개 고르기)');host.setAttribute('aria-controls','documentList');
  const signature=JSON.stringify(names);
  if(host._luSignature!==signature){
    const focused=host.contains(document.activeElement)?document.activeElement?.dataset.luCategory:null;
    host.replaceChildren(...['all',...names].map(value=>{const b=document.createElement('button');b.type='button';b.className='quick-pill-button';b.dataset.luCategory=value;b.textContent=value==='all'?'전체':value;return b}));
    host._luSignature=signature;
    if(focused)[...host.children].find(b=>b.dataset.luCategory===focused)?.focus({preventScroll:true});
  }
  for(const b of host.children)b.setAttribute('aria-pressed',b.dataset.luCategory==='all'?(state==='all'?'true':state==='none'?'false':'mixed'):String(luCategoryShown(b.dataset.luCategory)));
  if(!host._luBound){host._luBound=true;host.addEventListener('click',e=>{const b=e.target.closest('[data-lu-category]');if(b?.parentElement===host)luToggleCategory(b.dataset.luCategory)})}
}
// UI-바구니첨부메모 PR 3 ⑩: 담당조직 상세의 "전체 N개 보기"로 열면 자료실을 그 조직으로 거른다(새 화면 없음). [전체]를 누르면 거르기를 푼다.
function luRenderOrganizationFilter(){
  const host=document.querySelector('#libraryOrganizationFilter');if(!host)return;
  host.hidden=!luOrganization;if(!luOrganization)return;
  renderFilterChips(host,{label:'담당조직 필터',controls:'documentList',small:true,value:luOrganization.id,options:[{value:'all',label:'전체'},{value:luOrganization.id,label:luOrganization.name||'담당조직'}],onChange:value=>{if(value==='all')luOrganization=null;luRenderLibrary()}});
}
// 다른 화면에서 자료실을 한 조직으로 걸러 연다. 검색·프로젝트·분류 거르기는 비우고 보여 준다.
function luShowOrganization(id,name){
  luOrganization=typeof id==='string'&&id?{id,name:String(name||'')}:null;luCategoryOff=new Set();luViewHold=true;luEnterAllOn=window.KPTURouter?.current!=='library';
  const search=document.querySelector('#documentSearch'),project=document.querySelector('#documentProject');if(search)search.value='';if(project)project.value='all';
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
function luRenderEditProject(){const s=document.querySelector('#libraryEditProject'),m=document.querySelector('#libraryEditModal');if(!s||!m||m.classList.contains('hidden'))return;s.innerHTML=luProjectOptions(s.value||'',{keepStale:true})}
function luOnProjectsChanged(){luRenderUploadProject();luRenderEditProject();luRenderLibrary()}
// UI-회의결과창정리: 고른 파일은 한 줄씩(종류·이름·크기·상태·×).
function luRenderSelectedFiles(){const box=document.querySelector('#librarySelectedFiles');if(!box)return;if(!luUploadEntries.length){box.innerHTML='';return}box.innerHTML=luUploadEntries.map((entry,index)=>{const file=entry.file,state=entry.kind||'pending',label=entry.label||'선택됨';return fileLine({name:file?.name||'파일',meta:luSize(file?.size||0),state,label,attrs:` data-lu-upload-file="${index}"`,stateAttr:'data-lu-upload-state',end:state==='success'?'':`<button class="icon-btn file-line-x" type="button" data-lu-remove-file="${index}" aria-label="${luEsc(file?.name||'파일')} 선택 취소"${luUploading?' disabled':''}>×</button>`})}).join('')+(luUploadEntries.length>1?'<div class="library-multi-note">여러 파일은 각각 별도 자료로 등록되며 자료명은 파일별로 자동 정리됩니다.</div>':'')}
// ORG-자료올리기: 담당조직 상세의 자료 [+]가 같은 올리기 창을 열 때만 값이 있다(창을 새로 열면 지워진다). 올라온 자료는 그 조직에 바로 붙는다.
let luUploadOrg=null;
function luRenderUploadOrg(){const picker=document.querySelector('#documentModal .library-file-block');if(!picker)return;let p=picker.querySelector('#libraryUploadOrg');if(!luUploadOrg){p?.remove();return}if(!p){p=document.createElement('p');p.id='libraryUploadOrg';p.className='status ok';picker.querySelector('#librarySelectedFiles')?.insertAdjacentElement('beforebegin',p)}p.textContent=uploadOrganizationLabel(luUploadOrg)}
function luSetUploadOrg(org){luUploadOrg=normalizeUploadOrganization(org);luRenderUploadOrg()}
// MEET-파일AI분류: 사업 보고 상세의 자료 [+]·끌어다 놓기도 같은 올리기 창을 연다. 올라온 자료는 library-files의 meeting_id 칸으로 그 사업 보고에 바로 붙는다
// (기존 서버 기능, 서버 변경 없음). 창을 새로 열면 지워진다. 분류·제목·날짜는 AI 자동 채우기(luAiFill)가 프로젝트·담당조직 올리기와 똑같이 채운다.
let luUploadMeeting=null;
function luRenderUploadMeeting(){const picker=document.querySelector('#documentModal .library-file-block');if(!picker)return;let p=picker.querySelector('#libraryUploadMeeting');if(!luUploadMeeting){p?.remove();return}if(!p){p=document.createElement('p');p.id='libraryUploadMeeting';p.className='status ok';picker.querySelector('#librarySelectedFiles')?.insertAdjacentElement('beforebegin',p)}p.textContent=uploadMeetingLabel(luUploadMeeting)}
function luSetUploadMeeting(meeting){luUploadMeeting=normalizeUploadMeeting(meeting);luRenderUploadMeeting()}
function luStartUploadForMeeting(meeting,files=[]){const button=document.querySelector('#newDocumentBtn');if(!normalizeUploadMeeting(meeting)||!button||luUploading)return false;button.click();luSetUploadMeeting(meeting);const list=Array.from(files||[]);if(list.length)luSetSelectedFiles(list);return true}
// 창 없이 올리기(새 사업 보고를 저장한 뒤 고른 파일): 같은 library-files 요청 + 같은 AI 채우기. 실패하면 던진다(호출한 쪽이 개수를 센다).
async function luUploadFileForMeeting(meeting,file){const target=normalizeUploadMeeting(meeting);if(!target)throw new Error('사업 보고를 확인하지 못했습니다.');const fd=new FormData();try{fd.append('file',await window.KPTURuntime.copyUploadFile(file));fd.append('meeting_id',target.id);if(target.projectId)fd.append('project_id',target.projectId);const d=await luUploadRequest(fd,file);if(d?.error||!d?.document)throw new Error(d?.error||'자료 업로드 응답을 확인하지 못했습니다.');luAiFill(d.document.id,fd);return d.document}finally{fd.delete('file')}}
// 담당조직 상세의 자료 [+]·끌어다 놓기: 프로젝트 상세의 [+]처럼 이 올리기 창을 열고, 올라온 자료를 그 조직에 붙인다. 파일이 있으면 미리 골라 둔다.
function luStartUploadForOrganization(org,files=[]){const button=document.querySelector('#newDocumentBtn');if(!normalizeUploadOrganization(org)||!button||luUploading)return false;button.click();luSetUploadOrg(org);const list=Array.from(files||[]);if(list.length)luSetSelectedFiles(list);return true}
function luSetSelectedFiles(files){if(luUploading)return;luUploadEntries=Array.from(files||[]).map(file=>({file,kind:'pending',label:'선택됨'}));const input=document.querySelector('#libraryFileInput');if(input)input.value='';luRenderSelectedFiles()}
function luSetFileStatus(entry,kind,label){entry.kind=kind;entry.label=label;luRenderSelectedFiles()}
function luResetUploadSelection({clearStatus=true}={}){luUploadEntries=[];const input=document.querySelector('#libraryFileInput');if(input)input.value='';luRenderSelectedFiles();if(clearStatus)luSetStatus(document.querySelector('#documentStatus'),'')}
function luEnhanceUpload(){const modal=document.querySelector('#documentModal .modal-card');const title=document.querySelector('#docTitle');if(!modal||!title||document.querySelector('#libraryFileInput'))return;const picker=document.createElement('div');picker.className='library-file-block';picker.innerHTML='<input id="libraryFileInput" class="library-file-input" type="file" multiple><div class="library-pick-line"><label id="libraryDropzone" class="library-pick-button" for="libraryFileInput" tabindex="0" role="button" aria-label="자료 파일 고르기(여러 개 가능)"><span aria-hidden="true">📎</span> 파일 고르기</label><span class="library-picker-hint">여러 개 · 파일당 100MB<span class="library-drop-hint"> · 끌어다 놓기</span></span></div><div id="librarySelectedFiles" class="library-selected-files" aria-live="polite"></div><p>자료명을 비워두면 파일명의 날짜·버전 표시를 정리해 제목을 만듭니다. 여러 파일은 각각 정리합니다.</p>';title.closest('label')?.insertAdjacentElement('beforebegin',picker);const lab=title.closest('label');if(lab&&lab.firstChild?.nodeType===3)lab.firstChild.nodeValue='자료명 (선택)';const input=picker.querySelector('#libraryFileInput'),zone=picker.querySelector('#libraryDropzone');zone.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input.click()}});
  // PC: 창 전체가 끌어다 놓는 자리(놓을 때만 테두리).
  bindDropTarget(modal,luSetSelectedFiles,()=>!luUploading);input.addEventListener('change',()=>luSetSelectedFiles(input.files));picker.querySelector('#librarySelectedFiles').addEventListener('click',e=>{const b=e.target.closest('[data-lu-remove-file]');if(!b||luUploading)return;const index=Number(b.dataset.luRemoveFile);if(luUploadEntries[index]?.kind==='success')return;luUploadEntries.splice(index,1);input.value='';luRenderSelectedFiles();const next=picker.querySelectorAll('[data-lu-remove-file]');(next[Math.min(index,next.length-1)]||zone).focus()});luRenderSelectedFiles()}
function luSetStatus(st,msg,error=false){if(!st)return;st.textContent=msg||'';st.className='status'+(error?' error':msg?' ok':'');if(error){st.setAttribute('role','alert');st.removeAttribute('aria-live')}else{st.setAttribute('role','status');st.setAttribute('aria-live','polite')}}
function luSetBusy(btn,value){if(!btn)return;btn.disabled=!!value;if(value)btn.setAttribute('aria-busy','true');else btn.removeAttribute('aria-busy')}
// 업로드 전용 timeout: 서버 처리(Drive 중계·제목 추출 20초 제한·DB 기록) 여유 90초 + 느린 업링크(약 2Mbps) 기준 MB당 4초, 최대 10분.
// 100MB 파일은 약 8분 10초. 공용 runtime의 15초 기본값은 다른 API에 그대로 둔다.
const LU_MAX_FILE_BYTES=100*1024*1024;
function luUploadTimeoutMs(file){return Math.min(600000,90000+Math.ceil((Number(file?.size)||0)/1048576)*4000)}
async function luUploadRequest(fd,file){
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
    // A/B: use the meeting upload's native fetch options. A deadline reports an
    // unknown outcome without adding an AbortSignal or retrying the upload.
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(error('요청 시간이 초과되었습니다. 다시 시도해 주세요.',{code:'timeout',retryable:true})),luUploadTimeoutMs(file))});
    try{
      const response=await Promise.race([fetch(url,{method:'POST',headers,body:fd}),deadline]);
      window.__KPTU_STARTUP__?.request?.(url,performance.now()-started,response.status);
      return response;
    }catch(cause){
      window.__KPTU_STARTUP__?.request?.(url,performance.now()-started,0);
      if(cause?.code==='timeout')throw cause;
      if(cause?.name==='AbortError')throw error('요청 시간이 초과되었습니다. 다시 시도해 주세요.',{code:'timeout',retryable:true,cause});
      throw error('네트워크 연결을 확인한 뒤 다시 시도해 주세요.',{code:'network_error',retryable:true,cause});
    }finally{clearTimeout(timer)}
  }
  let response=await request();
  // Keep the existing authenticated 401 recovery; network/timeout failures are
  // never retried. Session refresh remains owned by the shared runtime.
  if(response.status===401){
    if(!(await runtime?.session?.refresh?.()))throw sessionRequired();
    response=await request();
    if(response.status===401){runtime.session.write(null);throw sessionRequired()}
  }
  const text=await response.text();
  let data;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!response.ok)throw error(data?.message||data?.error_description||data?.hint||data?.error||('요청 실패 '+response.status),{status:response.status,code:'http_'+response.status,retryable:[408,425,429].includes(response.status)||response.status>=500});
  // Match runtime save metadata and its stale-account guard; never publish
  // file contents, titles, or response data in the shared notification.
  if(requestEpoch===(runtime?.session?.epoch?.()??0)&&data?.ok!==false&&!data?.error){
    try{window.dispatchEvent(new CustomEvent('kptu:api-saved',{detail:{path,method:'POST',fields:[],action:'',projectLinked:!!(fd.get('project_id')||data?.document?.project_id),epoch:requestEpoch}}))}catch{}
  }
  return data;
}
const LU_UPLOAD_FAILURES={
  unknown_timeout:{kind:'unknown',label:'결과 확인 필요',stop:true,message:'업로드 시간이 오래 걸려 결과를 확인하지 못했습니다. 자료실 목록에서 등록 여부를 확인한 뒤 다시 시도해 주세요.'},
  unknown_network:{kind:'unknown',label:'결과 확인 필요',stop:true,message:'네트워크 연결이 끊겨 업로드 결과를 확인하지 못했습니다. 네트워크 연결을 확인하고 자료실 목록에서 등록 여부를 확인한 뒤 다시 시도해 주세요.'},
  session:{kind:'error',label:'실패 · 다시 시도',stop:true,message:'로그인 세션이 만료됐습니다. 다시 로그인한 뒤 업로드해 주세요.'},
  session_refresh:{kind:'error',label:'실패 · 다시 시도',stop:true,message:'로그인 세션을 갱신하지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.'},
  drive_auth:{kind:'error',label:'실패 · 다시 시도',stop:true,message:'Google Drive 연결이 만료됐습니다. 다시 연결한 뒤 시도해 주세요.'},
  too_large:{kind:'error',label:'100MB 초과',retry:false,message:'현재 자료실은 파일당 100MB까지 지원합니다.'},
  file_read:{kind:'error',label:'파일을 읽지 못했습니다. 파일을 다시 선택해 주세요.',retry:false,message:'파일을 읽지 못했습니다. 파일을 다시 선택해 주세요.'},
  empty:{kind:'error',label:'빈 파일',retry:false,message:'빈 파일은 업로드할 수 없습니다.'},
  project:{kind:'error',label:'실패 · 다시 시도',stop:true,message:'선택한 프로젝트를 더 이상 사용할 수 없습니다. 프로젝트를 다시 선택해 주세요.'},
  forbidden:{kind:'error',label:'실패 · 다시 시도',stop:true,message:'자료를 업로드할 권한이 없습니다.'},
  invalid:{kind:'error',label:'실패 · 다시 시도',message:'파일을 업로드하지 못했습니다. 파일과 입력값을 확인한 뒤 다시 시도해 주세요.'},
  server:{kind:'error',label:'실패 · 다시 시도',message:'파일을 업로드하지 못했습니다. 잠시 후 다시 시도해 주세요.'}
};
// timeout·네트워크 단절·gateway 중단(502/504/546)은 서버가 이미 저장했을 수 있으므로 실패가 아니라 결과 불명으로 둔다.
function luUploadFailure(e,{project=false}={}){const status=Number(e?.status)||0,code=e?.code||'';let type='server';if(code==='file_read_failed')type='file_read';else if(code==='timeout')type='unknown_timeout';else if(code==='network_error')type='unknown_network';else if(code==='session_required'||status===401)type='session';else if(code==='session_refresh_failed')type='session_refresh';else if(luIsDriveAuthError(e))type='drive_auth';else if(status===413)type='too_large';else if([502,504,546].includes(status))type='unknown_timeout';else if(project&&(status===404||status===409))type='project';else if(status===403)type='forbidden';else if(status>=400&&status<500)type='invalid';return {type,retry:true,...LU_UPLOAD_FAILURES[type]}}
function luPreflightFailure(file){if(!(Number(file?.size)>0))return {type:'empty',retry:true,...LU_UPLOAD_FAILURES.empty};if(file.size>LU_MAX_FILE_BYTES)return {type:'too_large',retry:true,...LU_UPLOAD_FAILURES.too_large};return null}
const LU_FAILURE_PRIORITY=['drive_auth','session','session_refresh','project','forbidden','unknown_timeout','unknown_network'];
let luUploading=false;
// LIB-AI자동분류: 등록된 자료의 빈 칸을 버튼 없이 AI가 채운다(기다리지 않음, 화면에 AI 표시 없음). 실패해도 등록 결과는 그대로다.
// 올리기 창에서 사용자가 직접 넣은 칸(keep)은 AI가 쓰지 않는다. 채워지면 kptu:documents-changed로 목록을 새로 읽는다.
function luAiFill(id,fd){const keep=keptFields({title:fd.get('title'),document_date:fd.get('document_date'),source:fd.get('source'),category:fd.get('category')});void fillLibraryDocument(id,{keep}).catch(()=>{})}
async function luUploadOrOriginal(original){if(luUploading)return;const projectId=document.querySelector('#docProject')?.value||'';if(!luIsSelectableProject(projectId)){luSetStatus(document.querySelector('#documentStatus'),'선택한 프로젝트를 더 이상 사용할 수 없습니다. 프로젝트를 다시 선택해 주세요.',true);luRenderUploadProject('');return}if(!luUploadEntries.length)return original?.();const st=document.querySelector('#documentStatus'),btn=document.querySelector('#saveDocumentBtn');const unresolved=luUploadEntries.filter(entry=>entry.kind==='unknown');let includeUnknown=false;if(unresolved.length)includeUnknown=confirm(`업로드 결과를 확인하지 못한 파일 ${unresolved.length}개가 있습니다.\n이미 자료실에 등록됐다면 다시 업로드할 때 같은 자료가 중복 등록됩니다.\n자료실 목록에 없는 것을 확인했다면 [확인]을 눌러 다시 업로드하세요.`);const pending=luUploadEntries.filter(entry=>entry.kind!=='success'&&entry.retry!==false&&(entry.kind!=='unknown'||includeUnknown));if(!pending.length){if(unresolved.length)luSetStatus(st,'결과를 확인하지 못한 파일은 다시 업로드하지 않았습니다. 자료실 목록에서 등록 여부를 확인한 뒤 다시 저장해 주세요.',true);else if(luUploadEntries.some(entry=>entry.kind!=='success'))luSetStatus(st,'다시 업로드할 수 있는 파일이 없습니다. 파일을 다시 선택해 주세요.',true);return}luUploading=true;luSetBusy(document.querySelector('#newDocumentBtn'),true);document.querySelector('#libraryFileInput').disabled=true;luRenderSelectedFiles();luSetBusy(btn,true);let succeeded=0,linkFailed=0,lastProjectId=null;const failures=[];try{for(let index=0;index<pending.length;index++){const entry=pending[index],file=entry.file;const preflight=luPreflightFailure(file);if(preflight){entry.retry=false;entry.failure=preflight;failures.push(preflight);luSetFileStatus(entry,preflight.kind,preflight.label);continue}luSetFileStatus(entry,'uploading','업로드 중');luSetStatus(st,`${index+1}/${pending.length} · ${file.name} 업로드 중…`);let fd=null;try{fd=new FormData();fd.append('file',await window.KPTURuntime.copyUploadFile(file));const fields={title:'#docTitle',category:'#docCategory',source:'#docSource',document_date:'#docDate',tags:'#docTags',project_id:'#docProject',description:'#docDescription'};for(const[k,sel]of Object.entries(fields)){if(k==='title'&&luUploadEntries.length>1)continue;const el=document.querySelector(sel),raw=el?.value??'',v=typeof raw==='string'?raw.trim():raw;if(v)fd.append(k,v)}if(luUploadMeeting){fd.append('meeting_id',luUploadMeeting.id);if(!fd.get('project_id')&&luUploadMeeting.projectId)fd.append('project_id',luUploadMeeting.projectId)}const d=await luUploadRequest(fd,file);if(d?.error||!d?.document)throw new Error(d?.error||'자료 업로드 응답을 확인하지 못했습니다.');succeeded++;if(luUploadOrg&&!(await linkUploadedDocument(window.KPTURuntime,{documentId:d.document.id,workspaceId:luWorkspace,organizationId:luUploadOrg.id})))linkFailed++;luAiFill(d.document.id,fd);lastProjectId=d.document.project_id||lastProjectId;entry.failure=null;luSetFileStatus(entry,'success','완료')}catch(e){const failure=luUploadFailure(e,{project:!!projectId});console.warn('library upload failed',{type:failure.type,status:e?.status||0,code:e?.code||'',message:e?.message||String(e)});failures.push(failure);entry.retry=failure.retry;entry.failure=failure;luSetFileStatus(entry,failure.kind,failure.label);if(failure.stop){for(const rest of pending.slice(index+1))luSetFileStatus(rest,'pending','대기 · 업로드 전');if(failure.type==='project'){await luLoadProjects(true);luRenderUploadProject()}if(failure.type==='drive_auth')await luMaybeReconnectDrive(e);break}}finally{fd?.delete('file');fd=null}}const unknown=failures.some(f=>f.kind==='unknown');if(succeeded||unknown){try{await luLoadDocuments();luRenderLibrary()}catch(e){console.error('library list refresh after upload failed',e)}}if(succeeded)window.dispatchEvent(new CustomEvent('kptu:documents-changed',{detail:{project_id:lastProjectId,...(luUploadOrg?{organization_id:luUploadOrg.id}:{}),...(luUploadMeeting?{meeting_id:luUploadMeeting.id}:{})}}));const remaining=luUploadEntries.filter(entry=>entry.kind!=='success');if(remaining.length){const main=remaining.map(entry=>entry.failure).filter(Boolean).sort((a,b)=>{const pa=LU_FAILURE_PRIORITY.indexOf(a.type),pb=LU_FAILURE_PRIORITY.indexOf(b.type);return (pa<0?99:pa)-(pb<0?99:pb)})[0];const done=luUploadEntries.length-remaining.length,prefix=luUploadEntries.length>1?`${done}개 완료 · ${remaining.length}개 미완료. `:'',retryable=remaining.some(entry=>entry.retry!==false&&entry.kind!=='unknown'),hint=luUploadEntries.length>1&&retryable&&main?.kind!=='unknown'?' 다시 저장하면 완료되지 않은 파일만 업로드합니다.':'';luSetStatus(st,prefix+(main?.message||LU_UPLOAD_FAILURES.server.message)+hint,true);return}if(linkFailed)alert(`자료 ${linkFailed}개는 자료실에 올라갔지만 담당조직에 붙이지 못했습니다.\n자료실에서 해당 자료의 [정보 수정]으로 담당조직을 골라 주세요.`);luSetStatus(st,luUploadEntries.length===1?'등록 완료':`${luUploadEntries.length}개 파일 등록 완료`);luResetUploadSelection({clearStatus:false});luSetUploadOrg(null);luSetUploadMeeting(null);document.querySelector('#documentModal')?.classList.add('hidden')}finally{luUploading=false;luSetBusy(document.querySelector('#newDocumentBtn'),false);document.querySelector('#libraryFileInput').disabled=false;luRenderSelectedFiles();luSetBusy(btn,false)}}
function luEnsureManageUi(){if(document.querySelector('#libraryManageModal'))return;document.body.insertAdjacentHTML('beforeend',`<div id="libraryManageModal" class="modal hidden" aria-hidden="true"><div class="modal-card medium-card"><div class="modal-head"><div><h2>자료 분류 수정</h2><p class="muted">자료 정보를 직접 수정합니다.</p></div><button id="libraryManageClose" class="icon-btn" type="button">×</button></div><div id="libraryCategoryEditor" class="library-category-editor"></div><h3 class="library-manage-title">자료별 분류</h3><div id="libraryManageList" class="library-manage-list"></div></div></div><div id="libraryEditModal" class="modal hidden" data-enter-save aria-hidden="true"><div class="modal-card small-card"><div class="modal-head"><div><h2>자료 정보 수정</h2></div><button id="libraryEditClose" class="icon-btn" type="button">×</button></div><input id="libraryEditId" type="hidden"><label>자료명<input id="libraryEditTitle" type="text"></label><div class="library-edit-grid"><label>분류<select id="libraryEditCategory">${categoryOptions('')}</select></label><label>프로젝트<select id="libraryEditProject"></select></label><label>사업 보고<select id="libraryEditMeeting"></select></label><label>출처<input id="libraryEditSource" type="text"></label><label>문서 날짜<input id="libraryEditDate" type="date"></label></div><label>태그<input id="libraryEditTags" type="text" placeholder="쉼표로 구분"></label><label>설명<textarea id="libraryEditDescription" rows="4"></textarea></label><div class="modal-action-footer"><div id="libraryEditStatus" class="status"></div><button id="libraryEditSave" data-enter-save-submit class="primary wide" type="button">수정 저장</button></div></div></div>`);document.querySelector('#libraryManageClose').onclick=()=>luClose('libraryManageModal');document.querySelector('#libraryEditClose').onclick=()=>luClose('libraryEditModal');document.querySelector('#libraryEditSave').onclick=luSaveEdit}
function luOpen(id){const m=document.querySelector('#'+id);m?.classList.remove('hidden');m?.setAttribute('aria-hidden','false');if(m)window.dispatchEvent(new CustomEvent('kptu:dialog-opened',{detail:{modal:m}}))}
function luClose(id){if(id==='libraryEditModal'){luEditSequence++;luEditor=null}const m=document.querySelector('#'+id);m?.classList.add('hidden');m?.setAttribute('aria-hidden','true');if(m)window.dispatchEvent(new CustomEvent('kptu:dialog-closed',{detail:{modal:m}}))}
async function luLoadDocuments(){if(!luWorkspace)return;luDocuments=await luApi('/rest/v1/app_documents?workspace_id=eq.'+luWorkspace+'&select=*&order=document_date.desc.nullslast,created_at.desc')}
// UI-디자인기준 3/3: the kind comes from the file extension; a name without a known extension uses the type Drive reported (mime_type).
const LU_KIND_MIME=[[/^application\/pdf$/,'PDF'],[/hwp|hancom|haansoft/,'HWP'],[/spreadsheet|ms-excel/,'XLS'],[/wordprocessing|msword|google-apps\.document/,'DOC'],[/presentation|powerpoint/,'PPT']];
function luFileKind(name,mime){const ext=String(name||'').includes('.')?String(name).split('.').pop().toUpperCase():'';const byExt=({HWP:'HWP',HWPX:'HWP',PDF:'PDF',XLS:'XLS',XLSX:'XLS',DOC:'DOC',DOCX:'DOC',PPT:'PPT',PPTX:'PPT'})[ext];if(byExt)return byExt;const type=String(mime||'').toLowerCase();return LU_KIND_MIME.find(([re])=>re.test(type))?.[1]||'파일'}
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
function luRowHtml(d){const raw=luEsc(d.title||d.file_name||'파일'),view=luPhone()?luDisplayName(d):{name:d.title||d.file_name||'파일',date:luDisplayName(d).date},date=luEsc(view.date),upload=view.date?'':luEsc(luUploadDate(d));return `<article class="lu-row" role="button" tabindex="0" data-lu-document="${luEsc(d.id)}">${(k=>`<span class="lu-file-kind" data-lu-kind="${k==='파일'?'other':k.toLowerCase()}">${k}</span>`)(luFileKind(d.file_name,d.mime_type))}<span class="lu-row-tag">${categoryTag(d.category)}</span><h3 class="lu-row-title">${luEsc(view.name)}</h3>${date?`<span class="lu-row-date">${date}</span>`:upload?`<span class="lu-row-date lu-row-date-upload">${upload}<small> 올림</small></span>`:''}<button class="icon-btn lu-expand" type="button" hidden aria-expanded="false" aria-label="전체 이름 보기" data-lu-expand="${luEsc(d.id)}"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button class="icon-btn lu-more-trigger" type="button" aria-label="자료 관리: ${raw}" aria-expanded="false" aria-controls="luMorePanel" data-lu-menu="${luEsc(d.id)}">⋯</button></article>`}
// UI-PC자료실 C: 검색어가 있을 때 꺼 둔 분류에 걸린 자료 수를 목록 아래에 작게 알리고, [켜기]로 그 분류만 켠다.
function luOffHint(hidden){if(!hidden.length)return '';const names=[...new Set(hidden.map(d=>categoryOf(d.category)))];return `<p class="lu-off-hint" role="status">${luEsc(names.join('·'))} 분류 ${hidden.length}건은 꺼져 있어요 <button type="button" class="lu-off-show" data-lu-show-off="${luEsc(JSON.stringify(names))}">켜기</button></p>`}
// LIB-토글트리 ②(docs/design/library-tree.md 5절): 목록은 토글 안 토글. 상태 주인은 이 모듈, 그리기는 luRenderLibrary 하나.
// 펼침: 거르지 않을 때는 사용자가 연 토글(luOpen), 거를 때(검색·담당조직·프로젝트·기본과 다른 종류 칩)는 맞는 자료가 든 토글을 펼치고
// 그 동안 사용자가 여닫은 것은 따로(luFilterOpen) 기억한다. 거르기를 풀면 직전 펼침으로 돌아간다. 자료실에 들어올 때는 맨 위 단만(결정 D13).
let luGroupBy='project',luFolders_=[],luFolderItems=[],luOrganizations=null,luOrganizationsLoading=null,luLastTree=[],luFilterSignature='';
const luOpened=new Set(),luFilterOpen=new Map(),luShowAll=new Set();
function luResetTree(){luOpened.clear();luFilterOpen.clear();luShowAll.clear();luFilterSignature=''}
// 폴더 표(app_library_folders·_items, 소유자 RLS)는 읽기만 한다. 표가 없거나 읽기에 실패하면 폴더 없이 그대로 그린다.
async function luLoadFolders(){if(!luWorkspace)return;const w=encodeURIComponent(luWorkspace);try{const [folders,items]=await Promise.all([luApi('/rest/v1/app_library_folders?workspace_id=eq.'+w+'&select=id,project_id,parent_id,name,sort_order,created_at&order=sort_order.asc,created_at.asc'),luApi('/rest/v1/app_library_folder_items?workspace_id=eq.'+w+'&select=document_id,folder_id')]);luFolders_=Array.isArray(folders)?folders:[];luFolderItems=Array.isArray(items)?items:[];luFoldersReady=true}catch{luFolders_=[];luFolderItems=[];luFoldersReady=false}}
async function luLoadAll(){await Promise.all([luLoadDocuments(),luLoadFolders()])}
// 담당조직 묶기를 처음 고를 때 한 번 읽는다(조직 순서는 organization-order.js). 실패하면 조직 이름 없이 묶는다.
function luLoadOrganizations(){if(luOrganizations||luOrganizationsLoading||!luWorkspace)return luOrganizationsLoading;luOrganizationsLoading=Promise.all([luApi('/rest/v1/app_suborganizations?workspace_id=eq.'+encodeURIComponent(luWorkspace)+'&select=id,name,active&order=id.asc'),import('./organization-order.js')]).then(([rows])=>{luOrganizations=window.KPTUOrganizationOrder?.sort?.(rows||[])||rows||[]}).catch(()=>{luOrganizations=[]}).finally(()=>{luOrganizationsLoading=null;luRenderLibrary()});return luOrganizationsLoading}
const LU_PROJECT_COLORS=['green','blue','orange','purple','pink','yellow','red','gray'];
function luProjectColor(project){const rows=luCatalog()?.projects||[];let top=project,guard=0;while(top?.parent_id&&guard++<5){const up=rows.find(p=>p.id===top.parent_id);if(!up)break;top=up}const key=LU_PROJECT_COLORS.includes(top?.metadata?.color)?top.metadata.color:'gray';return {color:key,tone:top!==project?'soft':''}}
const luKindKey=k=>k==='파일'?'other':k.toLowerCase();
function luRenderGroupBy(){
  const host=document.querySelector('#libraryGroupBy');if(!host)return;
  renderFilterChips(host,{label:'묶기',controls:'documentList',small:true,value:luGroupBy,options:GROUP_BY.map(value=>({value,label:GROUP_LABELS[value]})),onChange:value=>{if(value===luGroupBy)return;luGroupBy=value;luUserChangedView('groupBy');luOpened.clear();luFilterOpen.clear();luShowAll.clear();if(value==='organization')luLoadOrganizations();luRenderLibrary()}});
}
function luFiltering(q,pid){const names=documentCategories(),off=names.filter(n=>luCategoryOff.has(n)),base=names.filter(n=>luBaselineOff.has(n)),categories=off.length>0&&!(off.length===base.length&&off.every(n=>base.includes(n)));return !!(q||luOrganization||(pid&&pid!=='all')||categories)}
function luIsOpen(key,filtering,matched){return filtering?(luFilterOpen.has(key)?luFilterOpen.get(key):matched.has(key)):luOpened.has(key)}
function luRenderExpandAll(filtering,matched){const b=document.querySelector('#libraryExpandAll');if(!b)return;const all=luTreeKeys(luLastTree),open=all.length>0&&all.every(k=>luIsOpen(k,filtering,matched));b.textContent=open?'모두 접기':'모두 펴기';b.dataset.luExpand=open?'close':'open';b.disabled=!all.length}
function luExpandAll(){const all=luTreeKeys(luLastTree),open=document.querySelector('#libraryExpandAll')?.dataset.luExpand!=='close';if(luFilterSignature&&luFilterSignature!=='-')for(const k of all)luFilterOpen.set(k,open);else{luOpened.clear();if(open)all.forEach(k=>luOpened.add(k))}luRenderLibrary()}
function luRenderLibrary(){const box=document.querySelector('#documentList');if(!box)return;luCloseMenu();luRenderGroupBy();luRenderProjectFilter();luRenderOrganizationFilter();luRenderCategoryFilter();const q=(document.querySelector('#documentSearch')?.value||'').trim().toLowerCase(),pid=document.querySelector('#documentProject')?.value||'all',scope=luProjectScope(pid);const found=luDocuments.filter(d=>(!scope||scope.has(d.project_id))&&(!luOrganization||d.organization_id===luOrganization.id)&&(!q||[d.title,d.file_name,d.source,d.category,categoryOf(d.category),(d.tags||[]).join(' ')].join(' ').toLowerCase().includes(q)));const matches=found.filter(d=>luCategoryShown(categoryOf(d.category)));// UI-바구니거르기: the [일반 자료|회의자료만] row is gone; meeting documents show with the rest; the [회의] chip turns them on/off (UI-PC자료실 C: off by default).
const filtering=luFiltering(q,pid),signature=filtering?JSON.stringify([q,[...luCategoryOff].sort(),luOrganization?.id||'',pid,luGroupBy]):'-';if(signature!==luFilterSignature){luFilterOpen.clear();luFilterSignature=signature}
if(luGroupBy==='organization'&&!luOrganizations)luLoadOrganizations();
const tree=buildTree({groupBy:luGroupBy,docs:matches,filtering,tree:luCatalog()?.tree||[],folders:luFolders_,items:luFolderItems,organizations:luOrganizations||[],categories:documentCategories(),categoryOf,projectName:luProjectName,colorOf:luProjectColor,kindOf:d=>luFileKind(d.file_name,d.mime_type),sortKey:luSortKey,monthLabel:luMonthLabel});
luLastTree=tree;const matched=filtering?matchedKeys(tree):new Set();
const html=matches.length||tree.some(n=>n.children.length)?treeHtml(tree,{isOpen:k=>luIsOpen(k,filtering,matched),showAll:k=>luShowAll.has(k),fileHtml:luDragRowHtml,esc:luEsc,kindKey:luKindKey,menu:luNodeMenuLabel,canDrag:n=>luCanDrag()&&n.kind==='folder'}):'';
box.innerHTML=(html||`<div class="empty">${documentCategories().every(n=>luCategoryOff.has(n))?'고른 종류 없음':'자료가 없습니다.'}</div>`)+(q?luOffHint(found.filter(d=>!luCategoryShown(categoryOf(d.category)))):'');luRenderExpandAll(filtering,matched);luMarkLongNames(box)}
// 사용자가 토글을 여닫으면 그 상태만 기억한다(다시 그려도 유지). 그리기 중 생기는 toggle 이벤트도 같은 값이라 무해하다.
function luOnToggle(e){const d=e.target;if(!(d instanceof HTMLDetailsElement)||!d.dataset.luNode)return;const key=d.dataset.luNode;if(luFilterSignature!=='-')luFilterOpen.set(key,d.open);else if(d.open)luOpened.add(key);else luOpened.delete(key);const all=luTreeKeys(luLastTree),b=document.querySelector('#libraryExpandAll');if(b&&all.length){const open=[...document.querySelectorAll('#documentList details[data-lu-node]')].every(x=>x.open);b.textContent=open?'모두 접기':'모두 펴기';b.dataset.luExpand=open?'close':'open'}}
// LIB-토글트리 ③: 폴더 편집은 프로젝트 묶기에서만, 폴더 표를 읽었을 때만(표가 없으면 편집 없음). 활성 프로젝트(1~3단 모두)·'프로젝트 없음'·폴더 머리에 ⋯.
// 보관·옛 공간·확인 불가 연결 토글에는 두지 않는다(그 프로젝트는 프로젝트 화면에서 정리). 프로젝트 자체의 추가·이름·순서는 자료실에서 못 바꾼다(요구 ②).
let luFoldersReady=false,luFolderUi=null;
function luNodeMenuLabel(n){if(luGroupBy!=='project'||!luFoldersReady)return null;if(n.kind==='folder')return '폴더 관리: '+n.label;if(n.kind==='group'&&!n.stale&&(n.projectId===null||luCatalog()?.tree?.some(x=>x.project.id===n.projectId)))return '폴더 만들기: '+n.label;return null}
// ④ PC 끌어 놓기: 마우스가 있는 넓은 화면(761px 이상)·프로젝트 묶기·폴더 표를 읽었을 때만. 폰·터치는 ⋯ 메뉴로 같은 일을 한다.
const LU_FINE=typeof matchMedia==='function'?matchMedia('(hover:hover) and (pointer:fine) and (min-width:761px)'):null;
const luCanDrag=()=>!!LU_FINE?.matches&&luGroupBy==='project'&&luFoldersReady;
// 파일 줄은 그 프로젝트 틀에 폴더가 있을 때만 끌 수 있다(놓을 곳이 없으면 끌지 않음). 줄 HTML은 luRowHtml 그대로에 draggable만 붙인다.
function luDragRowHtml(d){const html=luRowHtml(d);if(!luCanDrag()||!luFolders_.some(f=>(f.project_id||null)===(d.project_id||null)))return html;return html.replace('<article class="lu-row"','<article class="lu-row" draggable="true"')}
function luFolderStatus(text,error=false){const el=document.querySelector('#libraryFolderStatusLine');if(!el)return;el.textContent=text||'';el.hidden=!text;el.classList.toggle('error',!!error)}
function luFolders(){if(!luFolderUi)luFolderUi=mountLibraryFolders({api:luApi,esc:luEsc,state:()=>({workspace:luWorkspace,folders:luFolders_,items:luFolderItems,docs:luDocuments,projectName:luProjectName}),reload:async()=>{await luLoadFolders();luRenderLibrary()},status:luFolderStatus,reveal:luRevealKeys});return luFolderUi}
// 토글 몇 개를 위 단부터 연다(폴더를 만들거나 옮긴 뒤 그 자리가 보이게). 프로젝트 토글의 위 단(1·2단)도 함께.
function luRevealKeys(keys){const all=new Set(luTreeKeys(luLastTree)),out=[];for(const k of keys){const path=k.startsWith('p:')&&k!=='p:none'?luProjectPath(k.slice(2)):[k];for(const x of path)if(all.has(x))out.push(x)}for(const k of out){if(luFilterSignature!=='-')luFilterOpen.set(k,true);else luOpened.add(k)}luRenderLibrary()}
function luProjectPath(id){const rows=luCatalog()?.projects||[],out=[];let p=rows.find(x=>x.id===id),guard=0;while(p&&guard++<5){out.unshift('p:'+p.id);p=p.parent_id?rows.find(x=>x.id===p.parent_id):null}return out.length?out:['p:'+id]}
// 토글 머리를 누르면(마우스·터치·키보드 Enter/Space 모두 click) 바뀔 상태를 바로 적는다. toggle 이벤트는 늦게 와서, 그 사이 다시 그리면 잃을 수 있다.
function luOnHeadClick(e){const head=e.target.closest('summary.lu-node-head');if(!head||e.defaultPrevented||e.target.closest('button'))return;const d=head.parentElement;if(!(d instanceof HTMLDetailsElement)||!d.dataset.luNode)return;const key=d.dataset.luNode,next=!d.open;if(luFilterSignature!=='-')luFilterOpen.set(key,next);else if(next)luOpened.add(key);else luOpened.delete(key)}
// 한 자료가 든 토글을 위 단까지 펼치고 그 토글의 자료를 모두 보인다(다른 화면에서 그 자료로 올 때).
function luRevealInTree(id){const path=pathTo(luLastTree,id);if(!path.length)return;for(const k of path){if(luFilterSignature!=='-')luFilterOpen.set(k,true);else luOpened.add(k)}luShowAll.add(path.at(-1));luRenderLibrary()}
// Account-menu pattern: consume the menu history entry before opening a successor.
let luActiveMenu=null,luMenuPanel=null,luMenuPopover=false,luMenuClosing=null;
function luCloseMenu(then,fromBack=false){
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
  const hwp=luDocuments.find(x=>x.id===id);
  luMenuPanel.innerHTML=`${hwp?.file_id&&isHwpName(hwp.file_name)?`<button type="button" data-lu-hwp-edit="${luEsc(id)}">편집</button>`:''}<button type="button" data-lu-download="${luEsc(id)}">다운로드</button><button type="button" data-lu-edit="${luEsc(id)}">정보 수정</button>${luGroupBy==='project'&&luFoldersReady&&hwp?luFolders().fileMenuHtml(hwp):''}<button type="button" class="lu-menu-danger" data-lu-delete="${luEsc(id)}">삭제</button>`;
  luMenuPanel.hidden=false;if(luMenuPopover){try{luMenuPanel.showPopover()}catch{luMenuPopover=false;luMenuPanel.removeAttribute('popover')}}
  luPositionMenu();trigger.setAttribute('aria-expanded','true');history.pushState({...history.state,kptuLibraryMenu:id},'',location.href);luMenuPanel.querySelector('button')?.focus({preventScroll:true});
}
function luBindMenu(){
  luMenuPanel=document.createElement('div');luMenuPanel.id='luMorePanel';luMenuPanel.className='lu-more-panel';luMenuPanel.hidden=true;luMenuPanel.setAttribute('role','group');luMenuPanel.setAttribute('aria-label','자료 관리');
  luMenuPopover=typeof luMenuPanel.showPopover==='function'&&typeof luMenuPanel.hidePopover==='function'&&'popover' in luMenuPanel;if(luMenuPopover)luMenuPanel.setAttribute('popover','manual');document.body.append(luMenuPanel);
  luMenuPanel.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;luCloseMenu(()=>{if(b.dataset.luHwpEdit)luHwpEdit(b.dataset.luHwpEdit);else if(b.dataset.luDownload)luDownload(b.dataset.luDownload);else if(b.dataset.luEdit)luOpenEditById(b.dataset.luEdit);else if(b.dataset.luDelete)luDeleteDocument(b.dataset.luDelete);else if(b.dataset.luFileFolder||b.dataset.luFileOut)luFolders().fileAction(b)})});
  document.addEventListener('click',e=>{if((!luActiveMenu&&!luMenuClosing)||luMenuPanel.contains(e.target)||luActiveMenu?.trigger.contains(e.target))return;const target=e.target,forward=new MouseEvent('click',e);e.preventDefault();e.stopImmediatePropagation();luCloseMenu(()=>{if(target.isConnected)target.dispatchEvent(forward)})},true);
  document.addEventListener('keydown',e=>{if(luActiveMenu&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();luCloseMenu()}},true);
  window.addEventListener('popstate',e=>{if(luActiveMenu&&e.state?.kptuLibraryMenu!==luActiveMenu.id)luCloseMenu(null,true)});
  window.addEventListener('resize',luPositionMenu);window.addEventListener('scroll',luPositionMenu,true);
  new ResizeObserver(luPositionMenu).observe(luMenuPanel);
}

async function luOpenDocument(id){const d=luDocuments.find(x=>x.id===id)||await luFetchOne(id);if(d?.drive_url){try{const url=new URL(d.drive_url);if(['https:','http:'].includes(url.protocol)){location.href=url.href;return}}catch{}console.error('invalid document URL',{documentId:id});alert('자료 링크가 올바르지 않습니다.');return}if(d?.file_id){await luDownload(id);return}alert('열 수 있는 파일 링크가 없습니다.')}
// HWP-편집기 2단계: HWP·HWPX 자료를 편집기 화면(hwp-lab.js)으로 넘긴다. 열기·저장은 그 화면이 한다.
function luHwpEdit(id){const d=luDocuments.find(x=>x.id===id);if(!d)return;if(!requestHwpEdit({kind:'library',document:{id:d.id,title:d.title,file_name:d.file_name,category:d.category,source:d.source,document_date:d.document_date,project_id:d.project_id,meeting_id:d.meeting_id,tags:d.tags}})){alert('로그인 정보를 확인하지 못했습니다. 다시 시도해 주세요.');return}window.KPTURouter.go('hwp-lab',{source:'delegated'})}
async function luDownload(id){try{const d=await luApi('/functions/v1/workspace-drive?action=download-token',{method:'POST',body:{document_id:id}});if(!d?.url)throw new Error('다운로드 주소를 받지 못했습니다.');location.href=d.url}catch(e){alert(e.message||String(e))}}
async function luFetchOne(id){const rows=await luApi('/rest/v1/app_documents?id=eq.'+encodeURIComponent(id)+'&select=*&limit=1');return rows?.[0]||null}
async function luOpenEditById(id){
  const sequence=++luEditSequence,view=luEditView,scope=luEditScope();
  let d=luDocuments.find(x=>x.id===id);
  if(!d){const rows=await luApi('/rest/v1/app_documents?id=eq.'+encodeURIComponent(id)+'&workspace_id=eq.'+encodeURIComponent(luWorkspace)+'&select=*&limit=1',{expectedSessionEpoch:scope?.epoch??null,singleFlight:false});d=rows?.[0]}
  if(sequence!==luEditSequence||view!==luEditView||(scope&&!luEditSameScope(scope))||d?.id!==id||d.workspace_id!==luWorkspace)return;
  await luEdit(d);
}
function luEditFields(){return {title:document.querySelector('#libraryEditTitle').value.trim(),category:document.querySelector('#libraryEditCategory').value.trim()||'기타',project_id:document.querySelector('#libraryEditProject').value||null,meeting_id:document.querySelector('#libraryEditMeeting').value||null,source:document.querySelector('#libraryEditSource').value.trim()||null,document_date:document.querySelector('#libraryEditDate').value||null,tags:document.querySelector('#libraryEditTags').value.split(',').map(x=>x.trim()).filter(Boolean),description:document.querySelector('#libraryEditDescription').value.trim()||null}}
const luEditSelectors=['Title','Category','Project','Meeting','Source','Date','Tags','Description'];
function luEditDraft(){return luEditSelectors.map(key=>document.querySelector('#libraryEdit'+key)?.value??'')}
function luEditScope(){const rt=window.KPTURuntime;if(typeof rt?.session?.epoch!=='function')return null;const epoch=rt.session.epoch(),context=rt.context?.read?.(),owner=rt.session.read()?.user?.id;if(!Number.isInteger(epoch)||epoch<0||!owner||owner!==luUser?.id||context?.user?.id!==owner||context?.workspace?.id!==luWorkspace)return null;return {owner,workspace:luWorkspace,epoch}}
function luEditSameScope(scope){const now=luEditScope();return !!scope&&!!now&&['owner','workspace','epoch'].every(key=>scope[key]===now[key])}
function luEditCurrent(editor){return luEditor===editor&&editor.sequence===luEditSequence&&editor.view===luEditView&&luEditSameScope(editor.scope)&&!document.querySelector('#libraryEditModal')?.classList.contains('hidden')&&document.querySelector('#libraryEditId')?.value===editor.id}
function luEditKey(editor){return [editor.scope.owner,editor.scope.workspace,editor.scope.epoch,editor.id].join(':')}
function luEditMatches(row,body){return Object.entries(body).every(([key,value])=>key==='updated_at'||value===undefined||JSON.stringify(row?.[key])===JSON.stringify(value))}
function luEditRow(editor,rows,body){if(!Array.isArray(rows)||rows.length!==1||rows[0]?.id!==editor.id||rows[0]?.workspace_id!==editor.scope.workspace||!luEditMatches(rows[0],body))throw new Error('자료의 저장 결과를 확인하지 못했습니다.');return rows[0]}
function luEditNotice(editor,text,check=false){if(!luEditCurrent(editor))return;const status=document.querySelector('#libraryEditStatus');status.textContent=text;status.className='status';if(check){const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='저장 결과 확인';button.onclick=()=>luCheckEdit(editor);status.append(document.createTextNode(' '),button)}}
async function luCheckEdit(editor){
  const key=luEditKey(editor),attempt=luEditAttempts.get(key);if(!attempt||attempt.pending||attempt.reading||!luEditCurrent(editor))return;
  attempt.reading=true;const current=()=>luEditCurrent(editor)&&luEditAttempts.get(key)===attempt;
  try{const rows=await luApi(`/rest/v1/app_documents?id=eq.${encodeURIComponent(editor.id)}&workspace_id=eq.${encodeURIComponent(editor.scope.workspace)}&select=*`,{expectedSessionEpoch:editor.scope.epoch,singleFlight:false});if(!current())return;const row=luEditRow(editor,rows,attempt.body);editor.original=structuredClone(row);editor.baseline=structuredClone(attempt.values);luDocuments=luDocuments.map(old=>old.id===row.id?structuredClone(row):old);luEditAttempts.delete(key);luEditNotice(editor,'제출한 자료 정보는 확인했습니다. 현재 입력은 남겨두었습니다.')}catch{if(current())luEditNotice(editor,'저장 결과를 아직 확인하지 못했습니다. 입력을 유지했으며 다시 저장하지 않았습니다.',true)}finally{attempt.reading=false}
}
async function luEdit(d){const editor={id:d.id,original:structuredClone(d),scope:luEditScope(),sequence:++luEditSequence,view:luEditView};luEditor=editor;if(editor.scope)luEditObservedScope={...editor.scope};try{await window.__KPTU_START_TEAM_VIEW__?.('meetings');if(luEditor!==editor||editor.sequence!==luEditSequence||editor.view!==luEditView||(editor.scope&&!luEditSameScope(editor.scope)))return;const meetings=[...(window.KPTUTeamData?.meetings?.()||[])].sort((a,b)=>new Date(b.meeting_at)-new Date(a.meeting_at));if(d.meeting_id&&!meetings.some(m=>m.id===d.meeting_id))throw new Error('연결된 사업 보고를 확인하지 못했습니다. 사업 보고 목록을 다시 연 뒤 수정해 주세요.');document.querySelector('#libraryEditMeeting').innerHTML=luOption('','연결 안 함',d.meeting_id||'')+meetings.map(m=>luOption(m.id,window.KPTUMeetingNames.label(m),d.meeting_id||'')).join('');document.querySelector('#libraryEditId').value=d.id;document.querySelector('#libraryEditTitle').value=d.title||'';document.querySelector('#libraryEditCategory').innerHTML=categoryOptions(d.category);document.querySelector('#libraryEditProject').innerHTML=luProjectOptions(d.project_id||'',{keepStale:true});document.querySelector('#libraryEditSource').value=d.source||'';document.querySelector('#libraryEditDate').value=d.document_date||'';document.querySelector('#libraryEditTags').value=(d.tags||[]).join(', ');document.querySelector('#libraryEditDescription').value=d.description||'';document.querySelector('#libraryEditStatus').textContent='';luEditOriginal={...d};luEditBaseline=luEditFields();editor.baseline??=structuredClone(luEditBaseline);luOpen('libraryEditModal');const button=document.querySelector('#libraryEditSave'),attempt=editor.scope&&luEditAttempts.get(luEditKey(editor));button.disabled=!!attempt?.pending;if(attempt?.pending){luEditNotice(editor,'앞선 저장 결과를 기다리는 중입니다.');attempt.done.then(()=>{if(luEditCurrent(editor)){button.disabled=false;luEditNotice(editor,'앞선 요청이 끝났습니다. 현재 입력은 유지했습니다.',attempt.state==='unknown')}})}else if(attempt)luEditNotice(editor,'앞선 저장 결과를 먼저 확인해 주세요.',true)}catch(e){if(luEditor===editor)alert(e.message||'사업 보고 목록을 불러오지 못했습니다. 다시 시도해 주세요.')}}
async function luSaveEdit(){
  const editor=luEditor,st=document.querySelector('#libraryEditStatus');
  if(!editor||editor.sequence!==luEditSequence)return;
  if(!editor.scope||!luEditSameScope(editor.scope)){st.textContent='로그인 상태를 확인하지 못했습니다. 입력은 남겨두었습니다. 화면을 다시 연 뒤 확인해 주세요.';st.className='status error';return}
  if(!luEditCurrent(editor))return;
  const key=luEditKey(editor),previous=luEditAttempts.get(key);
  if(previous?.pending||previous?.state==='unknown'){luEditNotice(editor,'앞선 저장 결과를 먼저 확인해 주세요.',!previous.pending);return}
  const values=luEditFields(),changed=Object.keys(values).filter(key=>JSON.stringify(values[key])!==JSON.stringify(editor.baseline[key]));
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
    if(JSON.stringify(luEditDraft())===request.draft){st.textContent='수정했습니다.';st.className='status ok';luClose('libraryEditModal')}else luEditNotice(editor,'제출한 정보는 저장했습니다. 추가 입력은 남겨두었습니다.');
    if(luEditSameScope(editor.scope)&&editor.view===luEditView)window.dispatchEvent(new CustomEvent('kptu:documents-changed'));
  }catch(error){request.state=[401,403].includes(error?.status)?'rejected':'unknown';if(luEditSameScope(editor.scope)&&request.state==='rejected'&&luEditAttempts.get(key)===request)luEditAttempts.delete(key);luEditNotice(editor,request.state==='rejected'?'자료를 수정할 권한을 확인해 주세요. 입력은 유지했습니다.':'저장 결과를 확인하지 못했습니다. 입력을 유지했습니다.',request.state==='unknown')}
  finally{request.pending=false;request.finish();if(editor.request===request&&luEditCurrent(editor))button.disabled=false}
}
window.addEventListener('kptu:view-changed',()=>{luEditView++;if(luEditor)luClose('libraryEditModal')});
window.addEventListener('kptu:dialog-closed',event=>{if(event.detail?.modal?.id==='libraryEditModal'&&luEditor){luEditSequence++;luEditor=null}});
window.addEventListener('kptu:session-changed',()=>{if(luEditSameScope(luEditObservedScope))return;luEditObservedScope=null;luEditAttempts.clear();luEditSequence++;luEditor=null;luEditOriginal=null;luEditBaseline=null;luClose('libraryEditModal');luEditSelectors.forEach(key=>{const input=document.querySelector('#libraryEdit'+key);if(input)input.value=''})});
function luDeleteScope(){const rt=window.KPTURuntime;if(typeof rt?.api!=='function'||typeof rt.session?.read!=='function'||typeof rt.context?.read!=='function')return null;const scope=luEditScope(),session=rt.session.read();return scope&&typeof scope.owner==='string'&&scope.owner.trim()&&typeof scope.workspace==='string'&&scope.workspace.trim()&&typeof session?.access_token==='string'&&session.access_token.trim()?scope:null}
function luDeleteCurrent(token){const scope=luDeleteScope();if(!luDeleteTokens.has(token)||!scope||!['owner','workspace','epoch'].every(key=>scope[key]===token.scope[key])||window.KPTURouter?.current!=='library'){luDeleteTokens.delete(token);return false}return true}
window.addEventListener('kptu:session-changed',event=>{for(const token of luDeleteTokens){const detail=event.detail,session=detail?.session;if(!luDeleteCurrent(token)||(detail&&Object.prototype.hasOwnProperty.call(detail,'session')&&(!session?.access_token?.trim?.()||session.user?.id!==token.scope.owner))||(detail&&Object.prototype.hasOwnProperty.call(detail,'epoch')&&detail.epoch!==token.scope.epoch))luDeleteTokens.delete(token)}});
window.addEventListener('kptu:view-changed',event=>{for(const token of luDeleteTokens)if(event.detail?.view!=='library'||event.detail?.source!=='session'||!luDeleteCurrent(token))luDeleteTokens.delete(token)});
async function luDeleteDocument(id){
  const scope=luDeleteScope();
  if(typeof id!=='string'||!id.trim())return;
  if(!scope){alert('로그인 세션을 확인하지 못했습니다. 다시 로그인한 뒤 자료 목록과 원본 상태를 먼저 확인해 주세요.');return}
  const token=Object.freeze({id,scope:Object.freeze(scope)});luDeleteTokens.add(token);
  const isCurrent=()=>luDeleteCurrent(token);
  try{
    if(!isCurrent())return;
    let d=luDocuments.find(x=>x.id===token.id);
    if(!d){const rows=await luApi('/rest/v1/app_documents?id=eq.'+encodeURIComponent(token.id)+'&workspace_id=eq.'+encodeURIComponent(scope.workspace)+'&select=*&limit=1',{expectedSessionEpoch:scope.epoch,singleFlight:false});if(!isCurrent())return;d=rows?.[0]}
    if(!isCurrent()||d?.id!==token.id||d.workspace_id!==scope.workspace)return;
    const registration=Object.freeze({...d});
    let helper;try{helper=await import('./document-delete.js')}catch{if(isCurrent())alert('자료를 삭제하지 못했습니다. 관리자에게 오류 확인을 요청해 주세요.');return}
    if(!isCurrent())return;
    if(await helper.deleteDocument(registration,{api:luApi,maybeReconnect:luMaybeReconnectDrive,expectedSessionEpoch:scope.epoch,isCurrent})&&isCurrent()){luDocuments=luDocuments.filter(x=>x.id!==token.id);luRenderLibrary()}
  }catch{if(isCurrent())alert('자료를 삭제하지 못했습니다. 관리자에게 오류 확인을 요청해 주세요.')}
  finally{luDeleteTokens.delete(token)}
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
function luRenderManageList(){const box=document.querySelector('#libraryManageList');if(!box)return;box.innerHTML=luDocuments.length?luDocuments.map(d=>`<div class="library-manage-row"><div><b>${luEsc(d.file_name||d.title)}</b><small>${luEsc(categoryOf(d.category))}${d.project_id?' · 프로젝트 연결':''}</small></div><button class="mini" type="button" data-library-edit="${d.id}">정보 수정</button></div>`).join(''):'<div class="empty">자료가 없습니다.</div>';box.querySelectorAll('[data-library-edit]').forEach(b=>b.onclick=()=>luOpenEditById(b.dataset.libraryEdit))}
async function luManage(){luEnsureManageUi();const box=document.querySelector('#libraryManageList');box.innerHTML='<div class="empty compact">불러오는 중…</div>';luOpen('libraryManageModal');if(!luCategoryEditor)luCategoryEditor=mountCategoryEditor(document.querySelector('#libraryCategoryEditor'),{documents:()=>luDocuments,refresh:async()=>{await luLoadDocuments();return luDocuments},onChanged:()=>{luRenderManageList();luRenderLibrary()}});void luCategoryEditor.open();try{await luLoadDocuments();luRenderManageList()}catch(e){box.innerHTML='<div class="empty">'+luEsc(e.message)+'</div>'}}
// A basket attachment's [자료실에서 보기] (BASKET-4b-1): once the list has loaded,
// show that document's row. Filters are cleared only when they hide it.
// HWP-편집기 메뉴 입구: [자료실에 올리기]로 넘어온 파일을 기존 [+ 자료 등록] 창에 채워 연다. 프로젝트·분류와 [등록]은 사용자가 한다.
function luOpenRequestedUpload(){if(window.KPTURouter?.current!=='library'||luUploading)return;const file=takeLibraryUploadRequest();const button=document.querySelector('#newDocumentBtn');if(!file||!button)return;button.click();luSetSelectedFiles([file]);luSetStatus(document.querySelector('#documentStatus'),'HWP 편집에서 고친 파일을 넣었어요. 프로젝트·분류를 고른 뒤 [등록]을 누르세요.')}
function luRevealRequested(){const id=takeLibraryDocumentRequest();if(!id||window.KPTURouter?.current!=='library')return;const doc=luDocuments.find(d=>d.id===id);if(!doc)return;const find=()=>document.querySelector(`#documentList [data-lu-document="${CSS.escape(id)}"]`);let row=find();if(!row){const search=document.querySelector('#documentSearch'),project=document.querySelector('#documentProject');if(search)search.value='';if(project)project.value='all';luCategoryOff=new Set();luViewHold=true;luOrganization=null;luRenderLibrary();row=find()}if(!row||!row.checkVisibility?.()){luRevealInTree(id);row=find()}if(row){row.scrollIntoView({block:'center'});row.focus({preventScroll:true})}}
// UI-PC자료실 B안: 이름이 잘린 줄에만 ⋯ 왼쪽 작은 펼치기 버튼. 누르면 그 줄만 전체 이름을 펼치고(다시 누르면 접기), 자료는 열지 않는다.
// 잘림 여부는 그린 뒤와 목록 폭이 바뀔 때 다시 잰다. 펼친 줄의 버튼은 접을 수 있게 남긴다.
const luTruncated=el=>!!el&&(el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1);
function luMarkLongNames(box){const phone=luPhone();box?.querySelectorAll('.lu-row').forEach(row=>{const button=row.querySelector('[data-lu-expand]');if(phone)row.classList.remove('lu-expanded');if(button){button.hidden=phone||!row.classList.contains('lu-expanded')&&!luTruncated(row.querySelector('.lu-row-title'));if(button.hidden)button.setAttribute('aria-expanded','false')}})}
function luToggleName(button){const row=button.closest('.lu-row'),open=!row.classList.contains('lu-expanded');row.classList.toggle('lu-expanded',open);button.setAttribute('aria-expanded',String(open));button.setAttribute('aria-label',open?'이름 접기':'전체 이름 보기');if(!open)luMarkLongNames(row.parentElement)}
function luBindList(){const list=document.querySelector('#documentList');if(!list||list.dataset.luBound)return;list.dataset.luBound='1';luBindMenu();list.addEventListener('toggle',luOnToggle,true);list.addEventListener('click',luOnHeadClick);luFolders().bindDrag(list);LU_FINE?.addEventListener?.('change',luRenderLibrary);list.addEventListener('click',e=>{const b=e.target.closest('[data-lu-node-menu]');if(!b)return;e.preventDefault();e.stopPropagation();luCloseMenu(()=>luFolders().open(b))});list.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches?.('[data-lu-node-menu]')){e.preventDefault();e.stopPropagation();luCloseMenu(()=>luFolders().open(e.target))}},true);list.addEventListener('click',e=>{const more=e.target.closest('[data-lu-more]');if(!more)return;e.stopPropagation();const key=more.dataset.luMore;luShowAll.add(key);luRenderLibrary();const node=[...list.querySelectorAll('[data-lu-node]')].find(n=>n.dataset.luNode===key);const rows=node?.querySelectorAll(':scope > .lu-node-body > .lu-row');rows?.[Math.min(rows.length-1,20)]?.focus({preventScroll:true})});document.querySelector('#libraryExpandAll')?.addEventListener('click',luExpandAll);list.addEventListener('click',e=>{const show=e.target.closest('[data-lu-show-off]');if(!show)return;let names=[];try{names=JSON.parse(show.dataset.luShowOff)}catch{}names.forEach(n=>luCategoryOff.delete(n));luRenderLibrary()});if(typeof ResizeObserver==='function')new ResizeObserver(()=>luMarkLongNames(list)).observe(list);LU_PHONE?.addEventListener?.('change',luRenderLibrary);list.addEventListener('click',async e=>{const expand=e.target.closest('[data-lu-expand]');if(expand){e.stopPropagation();luToggleName(expand);return}const menu=e.target.closest('[data-lu-menu]');if(menu){e.stopPropagation();luOpenMenu(menu);return}const card=e.target.closest('[data-lu-document]');if(card)await luOpenDocument(card.dataset.luDocument)});list.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches?.('[data-lu-document]')){e.preventDefault();luOpenDocument(e.target.dataset.luDocument)}})}
async function luInit(){if(!(await luContext()))return;luHandleDriveReturn();luEnhanceUpload();luEnsureManageUi();luBindList();luViewOwner=luUser?.id||'';await Promise.all([luLoadAll(),loadDocumentCategories(),luRefreshView()]);luRenderUploadCategory();luRenderLibrary();window.KPTULibrary={render:luRenderLibrary,showOrganization:luShowOrganization,startUploadForOrganization:luStartUploadForOrganization,startUploadForMeeting:luStartUploadForMeeting,uploadFileForMeeting:luUploadFileForMeeting};const save=document.querySelector('#saveDocumentBtn');if(save){const original=save.onclick;save.onclick=()=>luUploadOrOriginal(original)}const newDocument=document.querySelector('#newDocumentBtn');if(newDocument)newDocument.addEventListener('click',()=>{luResetUploadSelection();luRenderUploadProject('');luSetUploadOrg(null);luSetUploadMeeting(null)},true);luRenderUploadProject('');const manage=document.querySelector('#manageLibraryBtn');if(manage)manage.onclick=luManage;const search=document.querySelector('#documentSearch');if(search)search.oninput=luRenderLibrary;window.addEventListener('kptu:before-view-change',e=>{if(e.detail?.view==='library')luEntering=window.KPTURouter?.current!=='library'});window.KPTURouter?.on('library',()=>{luOpenRequestedUpload();if(luEntering){luViewHold=false;luResetCategories();luResetTree()}luEntering=false;luRenderLibrary();void luRefreshView();void loadDocumentCategories();luLoadAll().then(()=>{luRenderLibrary();luRevealRequested();luStartAutoTidy();luStartTextRead()}).catch(err=>console.error('library entry refresh failed',err))});window.addEventListener('kptu:edit-document',e=>{const id=e.detail?.id;if(id)luOpenEditById(id)});window.addEventListener('kptu:documents-changed',async()=>{await luLoadAll();luRenderLibrary()});window.addEventListener('kptu:project-catalog-updated',luOnProjectsChanged);window.addEventListener('kptu:document-categories-changed',luOnCategoriesChanged);window.addEventListener('kptu:view-changed',event=>{if(event.detail?.view!=='library'){luFlushView();if(luOrganization){luOrganization=null;luRenderLibrary()}}});document.addEventListener('visibilitychange',()=>{if(document.hidden)luFlushView()});luStartAutoTidy();luStartTextRead()}
window.__KPTU_LIBRARY_UPLOAD_READY__=Promise.resolve().then(luInit).then(()=>true).catch(err=>{console.error('library upload init',err);return false});
