import {basketOcrFor} from './basket-ocr-runtime.js';
import {bindPaste} from './paste-files.mjs';
import {uploadTimeoutMs} from './upload-budget.mjs';
// UI-올리기진행표시: 보낸 양을 아는 공용 보내기(upload-send.mjs)와 올리는 중 표시 공용 부품(upload-progress.js).
import {sendUpload} from './upload-send.mjs';
import {trackUpload, setUploadRetry, mountUploadRows, paintUploadLine, watchUploads} from './upload-progress.js';
// Basket-only sequencing and clip picker; library/meeting uploads keep their own controls.
const MAX_BYTES = 100 * 1024 * 1024;
const UNKNOWN = '저장 결과를 확인하지 못했습니다. 정리함에서 확인 후 다시 시도하세요';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// UI-바구니상세개편: shown as KB·MB (1024 steps, the everyday labels) instead of KiB·MiB.
export const fileSize = size => size >= 1048576 ? `${(size / 1048576).toFixed(1)} MB` : size >= 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size || 0} B`;
export function driveFileUrl(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id) ? `https://drive.google.com/file/d/${id}/view` : null;
}
const EAGER_BYTES = 120 * 1048576;
export function createUploadBatch(note_id = null, attachments = []) {
  return {note_id, attachments, entries:[], blocked:null};
}
function uploadError(message, code, status = 0) { return Object.assign(new Error(message), {code, status}); }
function failure(e) {
  // 다 보내기 전에 끊김·한도: 서버는 파일을 받지 못했으므로 다시 보내도 겹치지 않는다(결과 불명이 아님).
  if (e.code === 'upload_not_sent' || e.code === 'upload_timeout_sending') return uploadError('연결이 끊겨 다 보내지 못했어요. 연결을 확인하고 다시 올려 주세요.', e.code);
  if (e.code === 'file_read_failed') return uploadError('파일을 읽지 못했습니다. 파일을 다시 선택해 주세요.', e.code);
  if (e.code === 'note_changed') return uploadError('업데이트가 변경되었습니다. 업데이트를 다시 불러온 후 첨부를 확인해 주세요.', e.code, e.status);
  if (e.code === 'note_save_result_unknown' || !e.status || e.status >= 500) return uploadError(UNKNOWN, 'note_save_result_unknown', e.status);
  if (e.status === 401) return uploadError('로그인이 필요합니다. 다시 로그인한 후 시도해 주세요.', e.code, e.status);
  if (e.status === 413) return uploadError('파일은 100MiB까지 첨부할 수 있습니다.', e.code, e.status);
  // NOTE-파일붙이기: basket-files refuses a shared (or unreadable) "노트 첨부" folder before it uploads anything.
  if (e.code === 'drive_folder_not_private') return uploadError('Drive의 "노트 첨부" 폴더가 공유되어 있어 올리지 않았어요. 공유를 끈 뒤 다시 시도해 주세요.', e.code, e.status);
  if (e.code === 'drive_folder_permissions_unavailable') return uploadError('Drive 폴더의 공유 상태를 확인하지 못해 올리지 않았어요. 잠시 뒤 다시 시도해 주세요.', e.code, e.status);
  return uploadError('첨부를 저장하지 못했습니다. 선택한 파일과 Drive 연결 상태를 확인해 주세요.', e.code, e.status);
}
export function validateBatch(batch, raw_text = '') {
  if (batch.blocked) throw batch.blocked;
  if (!batch.note_id && [...raw_text.replace(/\r\n|\r|\n/g, '\r\n')].length > 20000) throw Error('글은 20,000자까지 저장할 수 있습니다.');
  const pending = batch.entries.filter(e => e.kind !== 'success');
  if (batch.attachments.length + pending.length > 20) throw Error('업데이트에는 파일을 20개까지 첨부할 수 있습니다.');
  for (const {file} of pending) {
    if (!file?.size) throw Error('빈 파일은 첨부할 수 없습니다.');
    if (file.size > MAX_BYTES) throw Error('파일은 100MiB까지 첨부할 수 있습니다.');
  }
}
// fetcher: 시험에서만 넘긴다(그때는 보낸 양 없이 fetch). 화면에서는 XMLHttpRequest로 실제 보낸 양을 올리는 중 표시에 알린다.
// source: 표시가 찾는 원래 파일(일기는 줄인 사진을 보내므로 고른 사진). job: 화면이 미리 만든 표시(없으면 여기서 만든다).
export async function uploadBasketFile(fd, file, rt = window.KPTURuntime, fetcher = null, isCurrent = () => true, {source = null, job = null} = {}) {
  if (!(await rt.session.ensure()) || !isCurrent()) throw uploadError('로그인이 필요합니다.', 'session_required', 401);
  const session = rt.session.read();
  if (!session?.access_token) throw uploadError('로그인이 필요합니다.', 'session_required', 401);
  const shown = job || trackUpload({file: source || file, name: (source || file)?.name, size: file?.size});
  // The shared upload budget (upload-budget.mjs, by file size). No replay on unknown outcomes; ✕ stops only before everything is sent.
  try {
    const response = await sendUpload(rt.config.url + '/functions/v1/basket-files', {headers:{apikey:rt.config.key,Authorization:'Bearer ' + session.access_token}, body:fd, size:file?.size || 0,
      timeoutMs:uploadTimeoutMs(file?.size), signal:shown.signal, onProgress:shown.progress, ...(fetcher ? {Xhr:null, fetcher} : {})});
    let data; try { data = JSON.parse(response.text); } catch { data = null; }
    if (!response.ok) throw uploadError(data?.error || '첨부 저장 실패', data?.code || 'http_' + response.status, response.status);
    shown.done();
    return data;
  } catch (e) {
    if (e?.code !== 'upload_cancelled') shown.fail(failure(e).message);
    throw e;
  }
}
export async function uploadBatch(batch, {raw_text = '', rt = window.KPTURuntime, onChange = () => {}, onOcrChange = () => {}, isCurrent = () => true, request = uploadBasketFile, ocr} = {}) {
  validateBatch(batch, raw_text);
  const originalIds=new Set(batch.attachments.map(file=>file.drive_file_id));
  const hadPending=batch.entries.some(entry=>entry.kind!=='success');
  let cancelled=0, tried=0;
  for (const entry of batch.entries.filter(e => e.kind !== 'success')) {
    if (!isCurrent()) throw Error('입력 세션이 변경되었습니다.');
    // upFile: 올리는 중 표시가 이 줄을 찾는 열쇠(성공 뒤 entry.file은 이름·크기만 남으므로). 표시가 끝나면 고른 줄 그리기가 지운다.
    entry.kind = 'uploading'; entry.label = '업로드 중'; entry.upFile = entry.file; tried++; onChange();
    let fd;
    try {
      // UPD-사진여러장: a file read as soon as it was chosen (mountBasketPicker) is used as is; the rest are read now.
      const copy = entry.copy || await (entry.read || rt.copyUploadFile(entry.file));
      if (!isCurrent()) throw uploadError('입력 세션이 변경되었습니다.', 'session_changed', 401);
      fd = new FormData(); fd.append('file', copy);
      if (batch.note_id) fd.append('note_id', batch.note_id);
      else if (raw_text) fd.append('raw_text', raw_text);
      const result = await request(fd, entry.file, rt, null, isCurrent);
      if (!isCurrent()) throw uploadError('입력 세션이 변경되었습니다.', 'session_changed', 401);
      if (!result?.ok || typeof result.note_id !== 'string' || !result.note_id || !Array.isArray(result.attachments) || (batch.note_id && result.note_id !== batch.note_id)) throw uploadError(UNKNOWN, 'note_save_result_unknown');
      batch.note_id = result.note_id; batch.attachments = result.attachments;
      entry.kind = 'success'; entry.label = '완료'; entry.file = {name:entry.file.name,size:entry.file.size}; entry.copy = entry.read = null;
      // Multipart uses native fetch, so publish the same safe event as runtime.api
      // only after response, note ID and current input session validation succeed.
      try { globalThis.window?.dispatchEvent(new CustomEvent('kptu:api-saved', {detail:{path:'/functions/v1/basket-files',method:'POST',fields:['attachments'],action:'',projectLinked:false}})); } catch { /* A subscriber cannot turn a saved attachment into a failed upload. */ }
      onChange();
    } catch (e) {
      // ✕(올리기 취소): 다 보내기 전에 멈춘 그 파일만 고른 목록에서 빼고 다음 파일을 이어서 올린다.
      if (e?.code === 'upload_cancelled') { const at = batch.entries.indexOf(entry); if (at >= 0) batch.entries.splice(at, 1); cancelled++; onChange(); continue; }
      const error = failure(e); entry.kind = 'error'; entry.label = '실패';
      if (['note_save_result_unknown','note_changed'].includes(error.code)) batch.blocked = error;
      onChange(); throw error;
    } finally { fd?.delete('file'); }
  }
  // 고른 파일을 모두 ✕로 취소했으면 아무것도 올라가지 않았다: 부른 곳이 '저장함'으로 보지 않게 알린다(노트·일기 글 안 사진이 건너뜀).
  if (tried && cancelled === tried) throw uploadError('올리기를 취소했어요.', 'upload_cancelled');
  // Multipart success is final before this separate phase. An OCR failure never
  // changes upload entries, blocks the batch, or sends the source file again.
  if(hadPending && isCurrent()) {
    const controller=ocr||basketOcrFor({rt,isCurrent});
    const photos=batch.attachments.filter(file=>!originalIds.has(file.drive_file_id)&&['image/jpeg','image/png'].includes(file.mime_type));
    const notice=value=>{if(isCurrent()){try{onOcrChange(value);}catch{/* A notice cannot undo a confirmed upload. */}}};
    if((controller.enabled??controller.state.enabled) && photos.length) {
      let supported=false;
      try{supported=(await controller.capabilities()).ok===true;}catch{/* Saved sources remain saved. */}
      for(const file of photos) {
        if(!isCurrent())break;
        let result;
        try{result=supported?await controller.read(batch.note_id,file.drive_file_id):{ok:false,code:'OCR_UNSUPPORTED',result_unknown:false};}
        catch{result={ok:false,code:'OCR_RESULT_UNKNOWN',result_unknown:true};}
        if(!isCurrent())break;
        if(result.ok && result.attachment)batch.attachments=batch.attachments.map(source=>source.drive_file_id===file.drive_file_id?result.attachment:source);
        notice({...result,note_id:batch.note_id,drive_file_id:file.drive_file_id});
      }
    }
  }
  return {ok:true,note_id:batch.note_id,attachments:batch.attachments};
}
// NOTE-파일붙이기: files for a note go through the same basket-files upload with the note's id; the server puts them in
// Drive "노트 첨부" (it reads the row's kind itself). Photo text reading (OCR) is a basket-update feature and does not run here.
// A batch already tied to another row (a basket save waiting for its result) is never sent to this note.
const NO_OCR = Object.freeze({enabled:false});
export async function uploadNoteFiles(noteId, batch, {rt = window.KPTURuntime, isCurrent = () => true, onChange = () => {}, request} = {}) {
  if (batch.blocked) throw batch.blocked;
  if (batch.note_id && batch.note_id !== noteId) throw uploadError('앞선 업데이트의 첨부 저장 결과를 먼저 확인해 주세요.', 'batch_other_row');
  batch.note_id = noteId;
  try { return await uploadBatch(batch, {rt, isCurrent, onChange, ocr:NO_OCR, ...(request ? {request} : {})}); }
  catch (error) {
    // [다시]: 노트는 이미 있으므로 실패한 파일만 같은 노트로 다시 보낸다. 결과를 알 수 없는 실패(저장됐을 수 있음)는 [다시]를 두지 않는다.
    if (!batch.blocked) for (const entry of batch.entries.filter(e => e.kind === 'error')) setUploadRetry(entry.file, () => uploadNoteFiles(noteId, batch, {rt, isCurrent, onChange, request}).catch(() => {}));
    // The basket wording ("바구니에서 확인") is said in the note's own words; the code stays.
    if (error?.code === 'note_save_result_unknown') error.message = '첨부 저장 결과를 확인하지 못했어요. 노트를 다시 열어 첨부를 확인해 주세요.';
    else if (error?.code === 'note_changed') error.message = '노트가 그사이 바뀌었어요. 노트를 다시 열어 첨부를 확인해 주세요.';
    throw error;
  }
}
// A new note made only of files is titled with the first file's name (one line, 200 characters at most).
export const fileTitle = name => [...String(name || '').replace(/[\r\n]+/g, ' ').trim()].slice(0, 200).join('').trim();
// UPD-그림붙여넣기: pasteTarget (the input where the cursor is, or the box around it) takes Ctrl+V pictures into the same add() as the clip and the drop.
export function mountBasketPicker(host, {id, filesHost, dropTarget, pasteTarget = null, getBatch, isBusy, isActive = () => true, onChange = () => {}, onError}) {
  host.classList.add('basket-clip-picker');
  host.innerHTML = `<input id="${id}" class="library-file-input" type="file" multiple tabindex="-1" aria-hidden="true"><button type="button" class="basket-clip" data-basket-clip aria-label="파일 첨부" aria-controls="${id}"><svg class="basket-clip-icon" viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false"><path d="M13.2 7.6 8.1 12.7a3.3 3.3 0 0 1-4.7-4.7l5.4-5.4a2.2 2.2 0 0 1 3.1 3.1L6.6 11a1.1 1.1 0 0 1-1.6-1.6l4.8-4.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="basket-clip-label">첨부</span><span class="basket-clip-count" data-basket-count aria-hidden="true" hidden></span></button>`;
  filesHost.classList.add('basket-file-selection');
  filesHost.innerHTML = `<small class="basket-file-hint" data-basket-hint hidden>파일당 100MiB · 20개까지</small><div data-basket-progress hidden></div><div class="library-selected-files" data-basket-files aria-live="polite"></div>`;
  dropTarget.classList.add('basket-drop-target');
  const input = host.querySelector('input'), clip = host.querySelector('button'), badge = host.querySelector('[data-basket-count]'), hint = filesHost.querySelector('[data-basket-hint]'), rows = filesHost.querySelector('[data-basket-files]');
  let renderedBatch;
  let dragDepth = 0;
  // UI-올리기진행표시: 고른 줄은 그대로 두고, 올리는 동안 그 줄 안에 공용 막대 + % + ✕를 그린다(paintUploadLine).
  // 위 합계 줄과 '느려요 · [계속 기다리기]'는 공용 올리는 줄(compact). 끝나면 줄의 글자가 '완료'·'실패'로 바뀐다.
  const sentFile = entry => entry.upFile || entry.file;
  const progress = mountUploadRows(filesHost.querySelector('[data-basket-progress]'), {compact:true, failed:false, has: job => getBatch().entries.some(entry => sentFile(entry) === job.file)});
  function paintLines() {
    if (typeof rows.querySelectorAll !== 'function') return;
    const batch = getBatch();
    rows.querySelectorAll('[data-basket-file]').forEach(row => { const entry = batch.entries[Number(row.dataset.basketFile)]; if (entry) paintUploadLine(row, entry.kind === 'uploading' ? sentFile(entry) : null); });
  }
  watchUploads(() => { if (host.isConnected) paintLines(); });
  function clearDrag() { dragDepth = 0; dropTarget.classList.remove('basket-dragover'); }
  function render() {
    const batch = getBatch();
    if (batch !== renderedBatch) { input.value = ''; renderedBatch = batch; }
    input.disabled = isBusy() || !!batch.blocked || !isActive();
    clip.disabled = input.disabled;
    if (input.disabled) clearDrag();
    badge.textContent = String(batch.entries.length); badge.hidden = !batch.entries.length;
    hint.hidden = !batch.entries.length; filesHost.hidden = !batch.entries.length;
    for (const entry of batch.entries) if (entry.upFile && entry.kind !== 'uploading') entry.upFile = null;
    rows.innerHTML = batch.entries.map((entry, index) => `<div class="library-selected-file ${entry.kind}" data-basket-file="${index}"><div class="library-selected-file-main"><b>${esc(entry.file.name)}</b><small>${esc(fileSize(entry.file.size))}</small></div><span class="library-upload-state">${esc(entry.label || '대기')}</span>${entry.kind === 'success' ? '' : `<button type="button" class="icon-btn" data-basket-remove="${index}" aria-label="${esc(entry.file.name)} 선택 취소"${isBusy() || batch.blocked ? ' disabled' : ''}>×</button>`}</div>`).join('');
    paintLines();
  }
  // UPD-사진여러장: on the phone app a chosen photo is only a pointer the system picker lent for a moment, and the upload used to
  // read file 2, 3… minutes later, one request after another. Read each one into memory right away (within EAGER_BYTES in all);
  // one that cannot be read leaves the list at once with a plain line instead of failing in the middle of the upload.
  function readNow(batch, added) {
    const rt = window.KPTURuntime;
    if (typeof rt?.copyUploadFile !== 'function') return;
    let used = batch.entries.reduce((sum, e) => sum + (e.copy ? e.copy.size : 0), 0);
    for (const entry of added) {
      if (used + entry.file.size > EAGER_BYTES) continue;
      used += entry.file.size;
      entry.read = rt.copyUploadFile(entry.file).then(copy => { entry.copy = copy; return copy; });
      entry.read.catch(() => {
        const at = getBatch().entries.indexOf(entry);
        if (at < 0 || entry.kind !== 'pending') return;
        getBatch().entries.splice(at, 1);
        render(); onChange();
        onError(`사진을 못 받았어요 · 다시 골라 주세요 (${entry.file.name || '이름 없음'})`);
      });
    }
  }
  function add(files) {
    if (!isActive() || isBusy() || getBatch().blocked) return false;
    const batch = getBatch(), old = batch.entries;
    const added = Array.from(files || []).map(file => ({file,kind:'pending',label:'대기'}));
    batch.entries = [...old, ...added];
    try { validateBatch(batch); } catch(e) { batch.entries = old; render(); onError(e.message); return false; }
    input.value = ''; render(); onChange();
    readNow(batch, added);
    return true;
  }
  input.addEventListener('change', () => add(input.files));
  if (pasteTarget) bindPaste(pasteTarget, files => add(files), {key: id, canTake: () => isActive() && !isBusy() && !getBatch().blocked, taken: () => getBatch().entries.map(e => e.file.name)});
  // Native button activation covers touch, click, Enter and Space.
  clip.addEventListener('click', () => { if (!input.disabled) input.click(); });
  const fileDrag = e => Array.from(e.dataTransfer?.types || []).includes('Files');
  dropTarget.addEventListener('dragenter', e => {
    if (!isActive() || !fileDrag(e)) return;
    e.preventDefault();
    if (!input.disabled) { dragDepth++; dropTarget.classList.add('basket-dragover'); }
  });
  dropTarget.addEventListener('dragover', e => {
    if (!isActive() || !fileDrag(e)) return;
    e.preventDefault();
    if (!input.disabled) { e.dataTransfer.dropEffect = 'copy'; dropTarget.classList.add('basket-dragover'); }
  });
  dropTarget.addEventListener('dragleave', e => {
    if (!fileDrag(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) clearDrag();
  });
  dropTarget.addEventListener('dragend', clearDrag);
  dropTarget.addEventListener('drop', e => {
    clearDrag();
    if (!isActive() || !fileDrag(e)) return;
    e.preventDefault(); add(e.dataTransfer?.files);
  });
  rows.addEventListener('click', e => {
    const b = e.target.closest('[data-basket-remove]'), batch = getBatch();
    if (!b || isBusy() || batch.blocked) return;
    const index = Number(b.dataset.basketRemove); if (batch.entries[index]?.kind === 'success') return;
    batch.entries.splice(index, 1); render(); onChange();
    (rows.querySelectorAll('button')[Math.min(index, rows.querySelectorAll('button').length - 1)] || clip).focus();
  });
  render(); return {render, add, progress};
}
