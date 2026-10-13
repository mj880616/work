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
  if(notes.some(note=>note.attachments?.some(file=>String(file.mime_type||'').startsWith('image/'))))root.querySelector('[data-basket-handoff-scope]').textContent+=' 사진 속 글과 내용은 아직 읽지 않아요.';
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
  const id = selected?.id; if(id&&cleanAddress)clearNoteAddress(); ++epoch; selected = null; upload=createUploadBatch();pickerFiles=null; detail.replaceChildren(); detail.hidden = true; list.hidden = false;paintHandoffScope();
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
  detail.querySelector('[data-basket-attachments]').innerHTML = (selected?.attachments || []).map(file=>{const url=driveFileUrl(file.drive_file_id);return `<div class="library-selected-file"><div class="library-selected-file-main"><b>${esc(file.file_name)}</b><small>${esc(fileSize(file.size_bytes))}</small></div>${url?`<a href="${url}" target="_blank" rel="noopener noreferrer">Drive에서 열기</a>`:'<span>링크를 확인할 수 없습니다.</span>'}</div>`;}).join('');
}
function openDetail(id) {
  handoff.close();
  selected = notes.find(n => n.id === id); if (!selected) return;
  // Keep the opened editor attached to this list snapshot until an explicit reload.
  ++epoch;
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
    busy = false; detail.querySelectorAll('button,input,textarea').forEach(el => el.disabled = false);
  }
}
async function saveAttachments() {
  if(busy||!selected)return;
  let batch=upload;const id=selected.id,owner=scope();const isCurrent=()=>scope()===owner&&selected?.id===id&&upload===batch;
  const status=detail.querySelector('[data-basket-status]');
  if(!batch.entries.length){status.textContent='파일을 선택해 주세요.';return;}
  // A read started before this write must not restore stale attachment counts.
  ++epoch;busy=true;detail.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=true);pickerFiles.render();status.textContent='업로드 중…';
  const paint=()=>{if(!isCurrent())return;selected.attachments=batch.attachments;renderList();paintAttachments();pickerFiles.render();};
  try{await uploadBatch(batch,{isCurrent,onChange:paint});if(isCurrent()){upload=batch=createUploadBatch(id,batch.attachments);status.textContent='첨부를 저장했습니다.';}}
  catch(e){if(isCurrent()){status.textContent='메모를 다시 불러오지 못했어요. 다시 시도해 주세요.';detail.querySelector('[data-basket-reload]').hidden=!batch.blocked;}}
  finally{busy=false;if(isCurrent()){detail.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=false);pickerFiles.render();}}
}
async function reloadDetail() {
  if(busy||!selected)return;
  if(dirty()&&!window.confirm('저장된 메모를 다시 불러올까요? 수정 중인 글과 미완료 파일 선택은 비워집니다.'))return;
  const id=selected.id,owner=scope(),run=++epoch;busy=true;
  detail.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=true);
  try{const result=await readBasket();if(run!==epoch||owner!==scope())return;notes=result.notes;links=result.links;renderList();if(notes.some(n=>n.id===id))openDetail(id);else closeDetail({force:true});}
  catch(e){if(run===epoch&&owner===scope())detail.querySelector('[data-basket-status]').textContent='메모를 다시 불러오지 못했어요. 다시 시도해 주세요.';}
  finally{busy=false;detail.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=false);pickerFiles?.render();}
}
root.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  // Navigation cancels this handoff's read, but never releases another operation's lock.
  if (b.matches('[data-basket-filter],[data-classification-open],[data-basket-row],[data-basket-close]')) handoff.close();
  if (busy) return;
  if (b.hasAttribute('data-handoff-copy')) void handoff.copy();
  else if (b.hasAttribute('data-classification-open')) classification.open();
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
root.addEventListener('keydown', e => { if (e.key === 'Escape' && selected && !busy) { e.preventDefault(); closeDetail(); } });
window.addEventListener('kptu:before-reload', e => {
  if (busy||quick?.isBusy()) e.preventDefault();
  else if (quick?.hasDraft()) e.detail.otherDraft=true;
  else if (dirty() || classification.hasDraft()) e.detail.otherDraft = true;
});
window.addEventListener('kptu:session-changed', () => {
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
