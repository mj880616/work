import { readBasket, updateNote, noteState, visibleNotes } from './basket-data.js?v=2';

import { createUploadBatch, uploadBatch, mountBasketPicker, driveFileUrl, fileSize } from './basket-upload.js?v=2';

const root = document.querySelector('#basketView'), rt = window.KPTURuntime;
let notes = [], links = [], filter = 'unclassified', selected = null, busy = false, epoch = 0;
const scope = () => { const c = rt.context.read(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
let upload = createUploadBatch(), pickerFiles = null;
let currentScope = scope();
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time = note => { const d = new Date(note.occurred_at); return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'}).format(d); };
root.innerHTML = `<div class="basket-head"><h2>바구니</h2><button type="button" data-goto="home">홈에서 입력</button></div><div data-basket-list><div class="basket-filters" role="group" aria-label="바구니 보기"><button type="button" data-basket-filter="unclassified">미분류</button><button type="button" data-basket-filter="all">전체</button><button type="button" data-basket-filter="archived">보관</button></div><p data-basket-list-status role="status"></p><button type="button" data-basket-retry hidden>다시 시도</button><div data-basket-rows></div></div><div data-basket-detail hidden></div>`;
const list = root.querySelector('[data-basket-list]'), detail = root.querySelector('[data-basket-detail]'), listStatus = root.querySelector('[data-basket-list-status]');
function renderList() {
  root.querySelectorAll('[data-basket-filter]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.basketFilter === filter)));
  const visible = visibleNotes(notes, links, filter);
  root.querySelector('[data-basket-rows]').innerHTML = visible.map(note => {
    const state = noteState(note, links);
    return `<button type="button" class="basket-row" data-basket-row="${esc(note.id)}"><span class="basket-preview">${esc([...String(note.raw_text || '')].slice(0, 160).join(''))}</span><time>${esc(time(note))}</time><span>${state.status}${note.attachments?.length ? ' · 첨부 ' + note.attachments.length + '개' : ''}</span>${state.destinations.map(d => `<span class="basket-destination">${esc(d)}</span>`).join('')}</button>`;
  }).join('');
  listStatus.textContent = visible.length ? `${visible.length}개 메모` : '메모가 없습니다.';
}
const textDirty = () => selected && detail.querySelector('[data-basket-text]')?.value !== selected.raw_text.replace(/\r\n?/g, '\n');
const dirty = () => textDirty() || upload.entries.some(e=>e.kind!=='success');
function closeDetail({focus = true, force = false} = {}) {
  if (!force && dirty() && !window.confirm('수정 중인 글을 버리고 목록으로 돌아갈까요?')) return;
  const id = selected?.id; selected = null; upload=createUploadBatch();pickerFiles=null; detail.replaceChildren(); detail.hidden = true; list.hidden = false;
  if (focus) (root.querySelector(`[data-basket-row="${CSS.escape(id || '')}"]`) || root.querySelector(`[data-basket-filter="${filter}"]`))?.focus();
}
function paintDetailState() {
  if (!selected) return;
  const state = noteState(selected, links);
  detail.querySelector('[data-basket-state]').textContent = [state.status, ...state.destinations].join(' · ');
  paintAttachments();
  detail.querySelector('[data-basket-archive]').textContent = selected.archived_at ? '보관 해제' : '보관';
}
function paintAttachments() {
  detail.querySelector('[data-basket-attachments]').innerHTML = (selected?.attachments || []).map(file=>{const url=driveFileUrl(file.drive_file_id);return `<div class="library-selected-file"><div class="library-selected-file-main"><b>${esc(file.file_name)}</b><small>${esc(fileSize(file.size_bytes))}</small></div>${url?`<a href="${url}" target="_blank" rel="noopener noreferrer">Drive에서 열기</a>`:'<span>링크를 확인할 수 없습니다.</span>'}</div>`;}).join('');
}
function openDetail(id) {
  selected = notes.find(n => n.id === id); if (!selected) return;
  // Keep the opened editor attached to this list snapshot until an explicit reload.
  ++epoch;
  upload=createUploadBatch(selected.id,selected.attachments||[]);list.hidden = true; detail.hidden = false;
  detail.innerHTML = `<button type="button" data-basket-close>목록으로</button><p data-basket-state></p><time>${esc(time(selected))}</time><label class="basket-text-label">메모 원문<textarea data-basket-text rows="12"></textarea></label><div data-basket-attachments class="library-selected-files"></div><div data-basket-file-picker></div><button type="button" data-basket-upload>첨부 저장</button><button type="button" data-basket-reload hidden>메모 다시 불러오기</button><div class="basket-actions"><button type="button" data-basket-save>수정 저장</button><button type="button" data-basket-archive>보관</button></div><p data-basket-status role="status"></p>`;
  detail.querySelector('[data-basket-text]').value = selected.raw_text;
  pickerFiles=mountBasketPicker(detail.querySelector('[data-basket-file-picker]'),{id:'detailBasketFiles',getBatch:()=>upload,isBusy:()=>busy,onError:message=>detail.querySelector('[data-basket-status]').textContent=message});
  paintDetailState(); detail.querySelector('[data-basket-text]').focus();
}
async function refresh() {
  if (busy) return;
  const run = ++epoch, owner = scope();
  listStatus.textContent = '불러오는 중…'; root.querySelector('[data-basket-retry]').hidden = true;
  try {
    const result = await readBasket();
    if (run !== epoch || owner !== scope()) return;
    notes = result.notes; links = result.links; renderList();
  } catch (e) {
    if (run !== epoch || owner !== scope()) return;
    notes = []; links = []; root.querySelector('[data-basket-rows]').replaceChildren();
    listStatus.textContent = e.message || '메모를 불러오지 못했습니다.';
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
    paintDetailState(); detail.querySelector('[data-basket-status]').textContent = e.message || '저장하지 못했습니다.';
  } finally {
    busy = false; detail.querySelectorAll('button,input,textarea').forEach(el => el.disabled = false);
  }
}
async function saveAttachments() {
  if(busy||!selected)return;
  const batch=upload,id=selected.id,owner=scope();const isCurrent=()=>scope()===owner&&selected?.id===id&&upload===batch;
  const status=detail.querySelector('[data-basket-status]');
  if(!batch.entries.length){status.textContent='파일을 선택해 주세요.';return;}
  // A read started before this write must not restore stale attachment counts.
  ++epoch;busy=true;detail.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=true);pickerFiles.render();status.textContent='업로드 중…';
  const paint=()=>{if(!isCurrent())return;selected.attachments=batch.attachments;renderList();paintAttachments();pickerFiles.render();};
  try{await uploadBatch(batch,{isCurrent,onChange:paint});if(isCurrent())status.textContent='첨부를 저장했습니다.';}
  catch(e){if(isCurrent()){status.textContent=e.message;detail.querySelector('[data-basket-reload]').hidden=!batch.blocked;}}
  finally{busy=false;if(isCurrent()){detail.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=false);pickerFiles.render();}}
}
async function reloadDetail() {
  if(busy||!selected)return;
  if(dirty()&&!window.confirm('저장된 메모를 다시 불러올까요? 수정 중인 글과 미완료 파일 선택은 비워집니다.'))return;
  const id=selected.id,owner=scope(),run=++epoch;busy=true;
  detail.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=true);
  try{const result=await readBasket();if(run!==epoch||owner!==scope())return;notes=result.notes;links=result.links;renderList();if(notes.some(n=>n.id===id))openDetail(id);else closeDetail({force:true});}
  catch(e){if(run===epoch&&owner===scope())detail.querySelector('[data-basket-status]').textContent=e.message;}
  finally{busy=false;detail.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=false);pickerFiles?.render();}
}
root.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || busy) return;
  if (b.hasAttribute('data-basket-row')) openDetail(b.dataset.basketRow);
  else if (b.hasAttribute('data-basket-filter')) { filter = b.dataset.basketFilter; renderList(); }
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
  if (busy) e.preventDefault();
  else if (dirty()) e.detail.otherDraft = true;
});
window.addEventListener('kptu:session-changed', () => {
  const next = scope(); if (next === currentScope) return;
  currentScope = next; epoch++; notes = []; links = []; closeDetail({focus:false,force:true}); renderList();
});
window.KPTURouter.on('basket', () => {
  if (busy) return;
  filter = 'unclassified'; renderList();
  // Keep the same editor and its unsaved text when returning from another view.
  if (dirty()) return;
  closeDetail({focus:false}); renderList(); void refresh();
});
renderList(); void refresh();
