import {basketOcrFor} from './basket-ocr-runtime.js?v=1';
import {effectiveOcrText} from './basket-ocr-text.mjs?v=1';
import { mountQuick } from './home-quick.js?v=12';
import { mountHandoff, selectHandoffNotes } from './basket-ai-handoff.js?v=12';
import { mountClassification } from './basket-classification-ui.js?v=11';
import { readBasket, updateNote, noteState, visibleNotes } from './basket-data.js?v=3';

import { createUploadBatch, uploadBatch, mountBasketPicker, driveFileUrl, fileSize } from './basket-upload.js?v=4';

const root = document.querySelector('#basketView'), rt = window.KPTURuntime;
let notes = [], links = [], filter = 'unclassified', selected = null, busy = false, epoch = 0;
const scope = () => { const c = rt.context.read(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
let upload = createUploadBatch(), pickerFiles = null, handoffBusy = false;
let quick=null;
let currentScope = scope(), retainedForTraversal = false;
const initialUrl = new URL(location.href);
let requestedNote = initialUrl.searchParams.get('view') === 'basket' ? initialUrl.searchParams.get('note') : null;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time = note => { const d = new Date(note.occurred_at); return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'}).format(d); };
root.innerHTML = `<div class="basket-head"><h2>바구니</h2><div class="basket-toolbar"><div class="basket-actions basket-compact-actions"><button type="button" class="quick-pill-button" data-handoff-copy>AI에게 맡기기</button><button type="button" class="quick-pill-button" data-classification-open>AI 정리 결과 넣기</button></div></div></div><p data-basket-handoff-scope></p><div data-handoff-host></div><div data-basket-list><div class="home-quick-placeholder" aria-hidden="true"></div><div class="basket-filters quick-mode-group" role="group" aria-label="바구니 보기"><button type="button" class="quick-pill-button" data-basket-filter="unclassified">미분류</button><button type="button" class="quick-pill-button" data-basket-filter="all">전체</button><button type="button" class="quick-pill-button" data-basket-filter="archived">보관</button></div><p data-basket-list-status role="status"></p><button type="button" data-basket-retry hidden>다시 시도</button><div data-basket-rows></div></div><div data-basket-detail hidden></div><div data-classification-host></div>`;
// Keep the basket heading available to assistive navigation; the shell owns
// the visible mobile title at the same 760px breakpoint as the shared header.
const basketTitle=root.querySelector('.basket-head > h2'),mobileTitle=window.matchMedia('(max-width:760px)');
const syncTitle=()=>basketTitle.classList.toggle('a11y-only',mobileTitle.matches);
mobileTitle.addEventListener('change',syncTitle);syncTitle();
const list = root.querySelector('[data-basket-list]'), detail = root.querySelector('[data-basket-detail]'), listStatus = root.querySelector('[data-basket-list-status]');
const ocrViews=new Map();
let ocrFlight=null,ocrViewScope=null,ocrGeneration=0;
const captureOcrScope=()=>({scope:scope(),owner:rt.context.read()?.user?.id,sessionEpoch:rt.session.epoch()});
const currentOcrScope=value=>{const session=rt.session.read();return !!value&&value.scope===scope()&&value.sessionEpoch===rt.session.epoch()&&session?.user?.id===value.owner&&!!session?.access_token;};
const ocrKey=fileId=>`${selected?.id}:${fileId}`;
function guardOcrPrivacy(){
  if(!ocrViewScope||currentOcrScope(ocrViewScope))return true;
  detail.querySelectorAll('[data-basket-ocr]').forEach(node=>node.replaceChildren());ocrViews.clear();
  if(ocrFlight){ocrFlight=null;busy=false;}
  return false;
}
// This facade reads presentation only; native operations bind their own token.
const ocr=basketOcrFor({rt,isCurrent:()=>window.KPTURouter.current==='basket'&&(!ocrViewScope||currentOcrScope(ocrViewScope))});
const recognition={unread:'읽기 전',reading:'읽는 중',done:'읽기 완료',empty:'글자 없음',failed:'읽기 실패'};
const cleanupLabel={none:'',create_pending:'임시 문서 생성 확인 중',create_unknown:'임시 문서 생성 결과 불명',created:'임시 문서 정리 필요',delete_pending:'임시 문서 정리 중',deleted:'임시 문서 정리 완료',delete_failed:'임시 문서 정리 실패'};
function ocrNotice(value,action=value.action){
  if(value.result_unknown)return '글자 읽기 결과를 확인하지 못했습니다. 상태를 확인해 주세요. 다시 읽지는 않습니다.';
  if(value.code==='OCR_SOURCE_CHANGED')return '원본 사진이 변경되어 이 결과를 반영할 수 없습니다.';
  if(value.code==='NOTE_CHANGED')return '메모가 변경되었습니다. 저장된 메모를 확인해 주세요.';
  if(value.code==='OCR_ATTEMPT_UNRESOLVED')return '현재 시도의 상태를 먼저 확인해 주세요.';
  if(action==='cleanup'&&value.ok)return '임시 문서를 정리했습니다. 사진 속 글자 상태는 그대로 유지됩니다.';
  if(value.ocr_saved||value.ok&&['done','empty'].includes(value.recognitionState||value.attachment?.ocr?.state))return (value.cleanup_state||value.attachment?.ocr?.cleanup_state)==='delete_failed'?'글자는 저장했습니다. 임시 문서 정리는 다시 확인해 주세요.':'사진 속 글자를 확인했습니다.';
  if(value.ok)return '현재 시도의 상태를 확인했습니다.';
  return '글자를 읽지 못했습니다. 저장된 사진은 그대로 유지됩니다.';
}
function ocrMarkup(file){
  if(!String(file.mime_type||'').startsWith('image/')&&!Object.hasOwn(file,'ocr'))return '';
  let text;try{text=effectiveOcrText(file);}catch{return '<div data-basket-ocr>사진 속 글자 상태를 확인할 수 없습니다.</div>';}
  const saved=file.ocr,outcome=ocr.outcome?.(selected.id,file.drive_file_id)||(ocrViews.get(ocrKey(file.drive_file_id))?.outcome?.result_unknown?null:ocrViews.get(ocrKey(file.drive_file_id))?.outcome);
  return `<div data-basket-ocr="${esc(file.drive_file_id)}"><details><summary>사진 속 글자</summary><p>${esc(recognition[saved?.state||'unread'])}</p>${text?`<div class="basket-ocr-text">${esc(text)}</div>`:''}${cleanupLabel[saved?.cleanup_state]?`<p class="basket-ocr-cleanup">${esc(cleanupLabel[saved.cleanup_state])}</p>`:''}<p data-basket-ocr-notice role="status">${esc(outcome?ocrNotice(outcome):'')}</p><div class="basket-actions"><button type="button" data-basket-ocr-read="${esc(file.drive_file_id)}" disabled>글자 읽기</button><button type="button" data-basket-ocr-status="${esc(file.drive_file_id)}" disabled>상태 확인</button>${saved?.attempt_id?`<button type="button" data-basket-ocr-reconcile="${esc(file.drive_file_id)}" disabled>읽은 글 반영</button><button type="button" data-basket-ocr-cleanup="${esc(file.drive_file_id)}" disabled>임시 문서 정리</button>`:''}</div>${!['image/jpeg','image/png'].includes(file.mime_type)?'<p>이 파일 형식은 글자 읽기를 지원하지 않습니다.</p>':!ocr.enabled?'<p>새 글자 읽기는 아직 사용할 수 없습니다.</p>':''}</details></div>`;
}
function paintOcrControls(){
  if(!selected||!guardOcrPrivacy())return;
  const state=ocr.state;
  for(const file of selected.attachments||[]){
    const node=detail.querySelector(`[data-basket-ocr="${CSS.escape(file.drive_file_id)}"]`);if(!node?.querySelector('[data-basket-ocr-read]'))continue;
    const view=ocrViews.get(ocrKey(file.drive_file_id)),saved=file.ocr;
    const enabled=state.enabled&&!busy&&!state.busy&&['image/jpeg','image/png'].includes(file.mime_type);
    const outcome=ocr.outcome?.(selected.id,file.drive_file_id);
    const unresolved=outcome?.result_unknown||['reading'].includes(saved?.state)||!['none','deleted'].includes(saved?.cleanup_state||'none');
    node.querySelector('[data-basket-ocr-read]').disabled=!enabled||!!unresolved;
    node.querySelector('[data-basket-ocr-status]').disabled=!enabled;
    for(const action of ['reconcile','cleanup']){const button=node.querySelector(`[data-basket-ocr-${action}]`);if(button)button.disabled=!enabled||view?.checkedAttempt!==saved?.attempt_id||(action==='reconcile'&&view?.sourceChanged);}
  }
}
function applyOcrSnapshot(value){
  if(value?.note_id!==selected?.id||!Array.isArray(value.attachments))return;
  for(const old of selected.attachments||[]){
    const fresh=value.attachments.find(file=>file.drive_file_id===old.drive_file_id),view=ocrViews.get(ocrKey(old.drive_file_id));
    if(!view)continue;
    if(view.checkedAttempt!==fresh?.ocr?.attempt_id||view.stamp!==value.updated_at||!fresh||['file_name','mime_type','size_bytes'].some(key=>old[key]!==fresh[key])){delete view.checkedAttempt;delete view.stamp;}
    if(view.conflictAttempt!==fresh?.ocr?.attempt_id)view.sourceChanged=false;
  }
  selected.attachments=value.attachments;upload.attachments=value.attachments;
  if(value.updated_at!==selected.updated_at)detail.querySelector('[data-basket-reload]').hidden=false;
  renderList();paintAttachments();
}
function applyOcrOutcome(value,action='read'){
  if(value?.note_id!==selected?.id||!value.drive_file_id)return;
  const key=ocrKey(value.drive_file_id),view=ocrViews.get(key)||{};
  // A refusal cannot erase an earlier owned lost-write outcome.
  if(!view.outcome?.result_unknown||value.result_unknown||value.ok)view.outcome={ok:value.ok,code:value.code,result_unknown:value.result_unknown,ocr_saved:value.ocr_saved,cleanup_state:value.cleanup_state,recognitionState:value.attachment?.ocr?.state,action};
  if(value.code==='OCR_SOURCE_CHANGED'){view.sourceChanged=true;view.conflictAttempt=selected.attachments.find(file=>file.drive_file_id===value.drive_file_id)?.ocr?.attempt_id;}
  ocrViews.set(key,view);
  if(value.attachment){selected.attachments=(selected.attachments||[]).map(file=>file.drive_file_id===value.drive_file_id?value.attachment:file);upload.attachments=selected.attachments;}
  if(value.ok&&value.updated_at&&selected.updated_at===value.requestStartUpdatedAt)selected.updated_at=value.updated_at;
  else if(value.updated_at&&value.updated_at!==selected.updated_at)detail.querySelector('[data-basket-reload]').hidden=false;
  renderList();paintAttachments();
}
async function runOcr(action,fileId){
  if(busy||!selected||!guardOcrPrivacy()||!ocr.enabled)return;
  const id=selected.id,view=ocrViews.get(ocrKey(fileId));
  const recovery=['reconcile','cleanup'].includes(action);
  const consent={attempt:selected.attachments.find(file=>file.drive_file_id===fileId)?.ocr?.attempt_id,checked:view?.checkedAttempt,stamp:view?.stamp};
  if(recovery&&(!consent.attempt||consent.checked!==consent.attempt||!consent.stamp))return;
  const run=++epoch,captured=captureOcrScope(),generation=ocrGeneration;
  const token={current:()=>ocrFlight===token&&generation===ocrGeneration&&run===epoch&&selected?.id===id&&currentOcrScope(captured)&&window.KPTURouter.current==='basket'};
  ocrFlight=token;
  const operation=basketOcrFor({rt,isCurrent:token.current,onChange:()=>{if(token.current()&&guardOcrPrivacy())paintOcrControls();}});
  busy=true;detail.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=true);
  const status=detail.querySelector('[data-basket-status]');status.textContent='사진 속 글자 확인 중…';
  try{
    const capability=await operation.capabilities();if(!token.current())return;
    if(!capability.ok){status.textContent='지금은 사진 속 글자 읽기를 사용할 수 없습니다.';return;}
    {
      const snapshot=await operation.status(id);if(!token.current())return;
      if(!snapshot.ok){status.textContent=ocrNotice(snapshot);return;}
      applyOcrSnapshot(snapshot);
      if(action==='status'){
        const file=snapshot.attachments.find(source=>source.drive_file_id===fileId);
        const view=ocrViews.get(ocrKey(fileId))||{};view.checkedAttempt=file?.ocr?.attempt_id;view.stamp=snapshot.updated_at;if(view.conflictAttempt!==view.checkedAttempt)view.sourceChanged=false;ocrViews.set(ocrKey(fileId),view);
        status.textContent='저장된 시도를 확인했습니다. 반영 또는 정리를 직접 선택해 주세요.';return;
      }
      if(recovery&&(snapshot.attachments.find(file=>file.drive_file_id===fileId)?.ocr?.attempt_id!==consent.attempt||snapshot.updated_at!==consent.stamp)){status.textContent='현재 시도가 변경되었습니다. 상태를 다시 확인한 후 선택해 주세요.';return;}
      if(action==='read'&&snapshot.updated_at!==selected.updated_at){status.textContent='메모가 변경되었습니다. 메모를 다시 불러온 후 읽어 주세요.';return;}
    }
    let options;
    if(action==='reconcile'){
      const view=ocrViews.get(ocrKey(fileId));
      if(!view?.checkedAttempt)return;
      if(view.stamp!==selected.updated_at||view.outcome?.code==='NOTE_CHANGED'){
        if(!window.confirm('저장된 메모가 변경되었습니다. 수정 중인 글은 유지하고 현재 저장된 메모에 이 시도의 글자를 반영할까요?'))return;
        options={confirmCurrentNoteVersion:view.stamp};
      }
    }
    const result=action==='read'?await operation.read(id,fileId):action==='reconcile'?await operation.reconcile(id,fileId,options):await operation.cleanup(id,fileId);
    if(!token.current())return;
    applyOcrSnapshot(operation.state.snapshot);
    applyOcrOutcome(result,action);status.textContent=ocrNotice(result,action);
  }catch{if(token.current())status.textContent='글자 읽기 결과를 확인하지 못했습니다. 상태를 확인해 주세요.';}
  finally{if(ocrFlight===token){ocrFlight=null;busy=false;if(currentOcrScope(captured)&&selected?.id===id){detail.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=false);pickerFiles?.render();paintOcrControls();}else guardOcrPrivacy();}}
}
quick=mountQuick({root,esc,basketOnly:true,view:'basket',idPrefix:'basket',onSaved:()=>void refresh()});
const handoff = mountHandoff(root.querySelector('[data-handoff-host]'),{getRequest:()=>{
  if(!selected){if(quick.hasDraft())return {error:'입력 중인 메모와 첨부를 먼저 저장한 뒤 맡겨 주세요.'};return {};}
  if(dirty())return {error:'수정 중인 글과 첨부를 먼저 저장한 뒤 맡겨 주세요.'};
  if(selected.archived_at||selected.ai_export_allowed!==true)return {error:'이 메모는 지금 AI에게 맡길 수 없어요. 보관 또는 AI 제외 상태를 확인해 주세요.'};
  return {noteId:selected.id};
},onPrepared:(count,request)=>{root.querySelector('[data-basket-handoff-scope]').textContent=request.noteId?'현재 메모 1개를 맡깁니다.':`최근 4주 · 미분류 · AI 허용 메모 ${count}개를 맡깁니다(최대 100개).`;},isBlocked:()=>busy,onBusy:value=>{handoffBusy=value;busy=value;root.querySelector('[data-handoff-copy]').disabled=value;},onClose:()=>root.querySelector('[data-handoff-copy]').focus()});
const classification = mountClassification(root.querySelector('[data-classification-host]'), {
  isBlocked:()=>busy, onBusy:value=>{busy=value;if(value)++epoch;},
  onOpen:()=>{handoff.close();closeDetail();if(selected)return false;list.hidden=true;return true;},
  onClose:()=>{handoff.close();list.hidden=false;root.querySelector('[data-classification-open]').focus();},
  onConfirmed:async(noteId,targets)=>{
    for(const target of targets){const key=target.kind==='project'?'project_id':'organization_id';
      if(!links.some(l=>l.note_id===noteId&&l[key]===target.target_id&&l.status==='confirmed'))
        links.push({note_id:noteId,status:'confirmed',[key]:target.target_id,[target.kind]:{name:target.name}});
    }
    renderList();
    const owner=scope();
    try { const current=await readBasket();if(owner!==scope())return;notes=current.notes;links=current.links;renderList(); }
    catch { return '연결했어요. 목록 새로고침은 다시 시도해 주세요.'; }
  }
});
const stateLabel=state=>({확정:'연결됨', '분류 제안됨':'정리 제안 있음'})[state]||state;
function paintHandoffScope(){
  root.querySelector('[data-basket-handoff-scope]').textContent=selected?'현재 메모 1개 · 연결된 메모도 다시 맡길 수 있어요.':`최근 4주 · 미분류 · AI 허용 메모 ${selectHandoffNotes(notes,links,new Date()).length}개(최대 100개).`;
  const photos=(selected?[selected]:selectHandoffNotes(notes,links,new Date())).flatMap(note=>note.attachments||[]).filter(file=>String(file.mime_type||'').startsWith('image/'));
  if(photos.length){let stored=false;for(const file of photos){try{stored ||= !!effectiveOcrText(file);}catch{/* Copy validation will refuse malformed OCR. */}}root.querySelector('[data-basket-handoff-scope]').textContent+=stored?' 저장된 사진 속 글자도 함께 맡깁니다.':'사진 속 글자는 아직 저장되지 않았습니다.';}
}
function renderList() {
  paintHandoffScope();
  root.querySelectorAll('[data-basket-filter]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.basketFilter === filter)));
  const visible = visibleNotes(notes, links, filter);
  root.querySelector('[data-basket-rows]').innerHTML = visible.map(note => {
    const state = noteState(note, links);
    const lines=String(note.raw_text||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean),file=note.attachments?.[0];
    const title=lines[0]||(file?`${String(file.mime_type||'').startsWith('image/')?'사진':'파일'} · ${file.file_name||'첨부'}`:'메모');
    return `<button type="button" class="basket-row" data-basket-row="${esc(note.id)}"><b class="basket-title">${esc([...title].slice(0,80).join(''))}</b>${lines.length>1?`<span class="basket-preview">${esc([...lines.slice(1).join(' ')].slice(0,120).join(''))}</span>`:''}<time>${esc(time(note))}</time><span>${stateLabel(state.status)}${note.attachments?.length ? ' · 첨부 ' + note.attachments.length + '개' : ''}</span>${state.destinations.map(d => `<span class="basket-destination">${esc(d)}</span>`).join('')}</button>`;
  }).join('');
  listStatus.textContent = visible.length ? `${visible.length}개 메모` : '메모가 없습니다.';
}
const textDirty = () => selected && detail.querySelector('[data-basket-text]')?.value !== selected.raw_text.replace(/\r\n?/g, '\n');
const dirty = () => textDirty() || upload.entries.some(e=>e.kind!=='success');
function clearNoteAddress(){
  requestedNote=null;
  const url=new URL(location.href);
  if(!url.searchParams.has('note'))return;
  url.searchParams.delete('note');
  history.replaceState(history.state,'',url.pathname+url.search+url.hash);
}
function closeDetail({focus = true, force = false, cleanAddress = true} = {}) {
  if (!force && dirty() && !window.confirm('수정 중인 글을 버리고 목록으로 돌아갈까요?')) return;
  handoff.close();
  const id = selected?.id; if(id&&cleanAddress)clearNoteAddress(); ++epoch; selected = null;ocrViewScope=null; upload=createUploadBatch();pickerFiles=null; detail.replaceChildren(); detail.hidden = true; list.hidden = false;paintHandoffScope();
  if (focus) (root.querySelector(`[data-basket-row="${CSS.escape(id || '')}"]`) || root.querySelector(`[data-basket-filter="${filter}"]`))?.focus();
}
function paintDetailState() {
  if (!selected) return;
  const state = noteState(selected, links);
  detail.querySelector('[data-basket-state]').textContent = [stateLabel(state.status), ...state.destinations].join(' · ');
  paintAttachments();
  detail.querySelector('[data-basket-archive]').textContent = selected.archived_at ? '보관 해제' : '보관';
}
function paintAttachments() {
  const openIds=new Set(Array.from(detail.querySelectorAll('[data-basket-ocr] details[open]'),node=>node.parentElement.dataset.basketOcr));
  detail.querySelector('[data-basket-attachments]').innerHTML = (selected?.attachments || []).map(file=>{const url=driveFileUrl(file.drive_file_id);return `<div class="library-selected-file"><div class="library-selected-file-main"><b>${esc(file.file_name)}</b><small>${esc(fileSize(file.size_bytes))}</small></div>${url?`<a href="${url}" target="_blank" rel="noopener noreferrer">Drive에서 열기</a>`:'<span>링크를 확인할 수 없습니다.</span>'}${ocrMarkup(file)}</div>`;}).join('');
  detail.querySelectorAll('[data-basket-ocr] details').forEach(node=>{node.open=openIds.has(node.parentElement.dataset.basketOcr);});
  paintOcrControls();
}
function openDetail(id) {
  handoff.close();
  selected = notes.find(n => n.id === id); if (!selected) return;
  // Keep the opened editor attached to this list snapshot until an explicit reload.
  ++epoch;ocrViewScope=captureOcrScope();
  for(const file of selected.attachments||[]){const view=ocrViews.get(ocrKey(file.drive_file_id));if(view){delete view.checkedAttempt;delete view.stamp;}}
  upload=createUploadBatch(selected.id,selected.attachments||[]);list.hidden = true; detail.hidden = false;
  detail.innerHTML = `<button type="button" data-basket-close>목록으로</button><p data-basket-state></p><time>${esc(time(selected))}</time><div class="basket-editor"><label class="basket-text-label">메모 원문<textarea data-basket-text rows="12"></textarea></label><div class="basket-editor-tools"><div data-basket-file-picker></div><button type="button" data-basket-upload>첨부 저장</button></div><div data-basket-file-selection></div></div><div data-basket-attachments class="library-selected-files"></div><button type="button" data-basket-reload hidden>메모 다시 불러오기</button><div class="basket-actions"><button type="button" data-basket-save>수정 저장</button><button type="button" data-basket-archive>보관</button></div><p data-basket-status role="status"></p>`;
  detail.querySelector('[data-basket-text]').value = selected.raw_text;
  pickerFiles=mountBasketPicker(detail.querySelector('[data-basket-file-picker]'),{id:'detailBasketFiles',filesHost:detail.querySelector('[data-basket-file-selection]'),dropTarget:detail.querySelector('.basket-editor'),getBatch:()=>upload,isBusy:()=>busy,onError:message=>detail.querySelector('[data-basket-status]').textContent=message});
  paintDetailState();paintHandoffScope(); detail.querySelector('[data-basket-text]').focus();
}
async function refresh() {
  if (busy) return;
  const run = ++epoch, owner = scope();
  listStatus.textContent = '불러오는 중…'; root.querySelector('[data-basket-retry]').hidden = true;
  try {
    const result = await readBasket();
    if (run !== epoch || owner !== scope()) return;
    notes = result.notes; links = result.links; renderList();
    if (requestedNote) {
      const id = requestedNote; requestedNote = null;
      if (notes.some(note => note.id === id)) openDetail(id);
      else listStatus.textContent = '메모를 찾을 수 없습니다. 접근 권한과 메모를 확인해 주세요.';
    }
  } catch (e) {
    if (run !== epoch || owner !== scope()) return;
    notes = []; links = []; root.querySelector('[data-basket-rows]').replaceChildren();
    listStatus.textContent = '메모를 불러오지 못했어요. 다시 시도해 주세요.';
    root.querySelector('[data-basket-retry]').hidden = false;
  }
}
async function patch(changes, message) {
  if (busy || !selected) return;
  const id = selected.id, run = ++epoch, owner = scope(); busy = true;
  detail.querySelectorAll('button,input,textarea').forEach(el => el.disabled = true);
  detail.querySelector('[data-basket-status]').textContent = '저장 중…';
  try {
    const note = await updateNote(id, changes);
    if (run !== epoch || owner !== scope()) return;
    notes = notes.map(n => n.id === id ? note : n); selected = note;upload.attachments=note.attachments||[];
    renderList(); paintDetailState(); detail.querySelector('[data-basket-status]').textContent = message;
  } catch (e) {
    if (run !== epoch || owner !== scope()) return;
    paintDetailState(); detail.querySelector('[data-basket-status]').textContent = '저장하지 못했어요. 다시 시도해 주세요.';
  } finally {
    busy = false; detail.querySelectorAll('button,input,textarea').forEach(el => el.disabled = false);paintOcrControls();
  }
}
async function saveAttachments() {
  if(busy||!selected)return;
  let batch=upload;const id=selected.id,owner=scope();const isCurrent=()=>scope()===owner&&selected?.id===id&&upload===batch&&run===epoch;
  const status=detail.querySelector('[data-basket-status]');
  if(!batch.entries.length){status.textContent='파일을 선택해 주세요.';return;}
  // A read started before this write must not restore stale attachment counts.
  const run=++epoch,captured=ocr.enabled?captureOcrScope():null,generation=ocrGeneration;
  const token={current:()=>ocrFlight===token&&generation===ocrGeneration&&isCurrent()&&currentOcrScope(captured)&&window.KPTURouter.current==='basket'};
  if(ocr.enabled)ocrFlight=token;
  const operation=ocr.enabled?basketOcrFor({rt,isCurrent:token.current,onChange:()=>{if(token.current()&&guardOcrPrivacy())paintOcrControls();}}):ocr;
  busy=true;detail.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=true);pickerFiles.render();status.textContent='업로드 중…';
  const paint=()=>{if(!isCurrent())return;selected.attachments=batch.attachments;renderList();paintAttachments();pickerFiles.render();};
  try{await uploadBatch(batch,{isCurrent,onChange:paint,ocr:operation,onOcrChange:value=>{if(token.current()&&guardOcrPrivacy())applyOcrOutcome(value);}});if(isCurrent()){upload=batch=createUploadBatch(id,batch.attachments);status.textContent='첨부를 저장했습니다.';}}
  catch(e){if(isCurrent()){status.textContent='메모를 다시 불러오지 못했어요. 다시 시도해 주세요.';detail.querySelector('[data-basket-reload]').hidden=!batch.blocked;}}
  finally{if(ocrFlight===token){ocrFlight=null;busy=false;}else if(!ocr.enabled)busy=false;if(isCurrent()&&!busy){detail.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=false);pickerFiles.render();paintOcrControls();}}
}
async function reloadDetail() {
  if(busy||!selected)return;
  if(dirty()&&!window.confirm('저장된 메모를 다시 불러올까요? 수정 중인 글과 미완료 파일 선택은 비워집니다.'))return;
  const id=selected.id,owner=scope(),run=++epoch;busy=true;
  detail.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=true);
  try{const result=await readBasket();if(run!==epoch||owner!==scope())return;notes=result.notes;links=result.links;renderList();if(notes.some(n=>n.id===id))openDetail(id);else closeDetail({force:true});}
  catch(e){if(run===epoch&&owner===scope())detail.querySelector('[data-basket-status]').textContent='메모를 다시 불러오지 못했어요. 다시 시도해 주세요.';}
  finally{busy=false;detail.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=false);pickerFiles?.render();paintOcrControls();}
}
root.addEventListener('click', e => {
  if(!guardOcrPrivacy())return;
  const b = e.target.closest('button'); if (!b||b.disabled) return;
  // Navigation cancels this handoff's read, but never releases another operation's lock.
  if (b.matches('[data-basket-filter],[data-classification-open],[data-basket-row],[data-basket-close]')) handoff.close();
  if (busy) return;
  if (b.hasAttribute('data-handoff-copy')) void handoff.copy();
  else if (b.hasAttribute('data-classification-open')) classification.open();
  else if(b.hasAttribute('data-basket-ocr-read'))void runOcr('read',b.dataset.basketOcrRead);
  else if(b.hasAttribute('data-basket-ocr-status'))void runOcr('status',b.dataset.basketOcrStatus);
  else if(b.hasAttribute('data-basket-ocr-reconcile'))void runOcr('reconcile',b.dataset.basketOcrReconcile);
  else if(b.hasAttribute('data-basket-ocr-cleanup'))void runOcr('cleanup',b.dataset.basketOcrCleanup);
  else if (b.hasAttribute('data-basket-row')) openDetail(b.dataset.basketRow);
  else if (b.hasAttribute('data-basket-filter')) { handoff.close(); filter = b.dataset.basketFilter; renderList(); }
  else if (b.hasAttribute('data-basket-close')) closeDetail();
  else if (b.hasAttribute('data-basket-retry')) void refresh();
  else if (b.hasAttribute('data-basket-save')) {
    // textarea normalizes CR/CRLF on display; do not rewrite an unchanged original.
    if (!textDirty()) detail.querySelector('[data-basket-status]').textContent = '저장된 글입니다.';
    else void patch({raw_text:detail.querySelector('[data-basket-text]').value}, '수정한 글을 저장했습니다.');
  }
  else if (b.hasAttribute('data-basket-upload')) void saveAttachments();
  else if (b.hasAttribute('data-basket-reload')) void reloadDetail();
  else if (b.hasAttribute('data-basket-archive')) void patch({archived_at:selected.archived_at ? null : new Date().toISOString()}, selected.archived_at ? '보관을 해제했습니다.' : '보관했습니다.');
});
window.addEventListener('storage',()=>guardOcrPrivacy());
root.addEventListener('keydown', e => { guardOcrPrivacy(); if (e.key === 'Escape' && selected && !busy) { e.preventDefault(); closeDetail(); } });
window.addEventListener('kptu:before-reload', e => {
  if (busy||quick?.isBusy()) e.preventDefault();
  else if (quick?.hasDraft()) e.detail.otherDraft=true;
  else if (dirty() || classification.hasDraft()) e.detail.otherDraft = true;
});
window.addEventListener('kptu:session-changed', () => {
  guardOcrPrivacy();
  const next = scope(); if (next === currentScope) return;
  currentScope = next; retainedForTraversal=false; requestedNote = null; epoch++; notes = []; links = []; closeDetail({focus:false,force:true,cleanAddress:false}); renderList();
});
window.addEventListener('kptu:before-view-change',e=>{
  if(retainedForTraversal&&((busy&&!handoffBusy)||quick?.isBusy()||quick?.hasDraft()||dirty()||classification.isOpen()))e.detail.retainBasketDraft=true;
  if(window.KPTURouter.current!=='basket'||e.detail?.view==='basket')return;
  // Without a native entry position, honor the traversal and retain the draft
  // in this mounted view. Never guess its direction or rewrite the destination.
  if(e.detail?.source==='popstate'&&!e.detail.canRestoreHistory&&((busy&&!handoffBusy)||quick?.isBusy()||quick?.hasDraft()||dirty())){
    e.detail.retainBasketDraft=true;return;
  }
  const blockedBusy=quick?.isBusy()||busy&&!handoffBusy&&(!classification.isOpen()||e.detail?.source==='popstate');
  if(blockedBusy||(quick?.hasDraft()&&!window.confirm('저장하지 않은 입력이 있어요. 다른 화면으로 갈까요? 입력은 이 탭에 남아요.'))||(dirty()&&!window.confirm('수정 중인 글을 버리고 다른 화면으로 갈까요?'))){
    e.preventDefault();
  }
});
window.addEventListener('kptu:view-changed',e=>{
  if(e.detail?.view==='basket'){retainedForTraversal=false;return;}
  ocrGeneration++;
  if(e.detail?.retainBasketDraft){retainedForTraversal=true;return;}
  retainedForTraversal=false;clearNoteAddress();closeDetail({focus:false,force:true});
});
window.KPTURouter.on('basket', () => {
  if (busy || classification.isOpen()) return;
  filter = 'unclassified'; renderList();
  // Keep the same editor and its unsaved text when returning from another view.
  if (dirty()) return;
  closeDetail({focus:false}); renderList(); void refresh();
});
renderList(); void refresh();
