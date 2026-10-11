// Basket-only sequencing. The library/meeting picker styles remain the shared visual pattern.
const MAX_BYTES = 100 * 1024 * 1024;
const UNKNOWN = '저장 결과를 확인하지 못했습니다. 바구니에서 확인 후 다시 시도하세요';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const fileSize = size => size >= 1048576 ? `${(size / 1048576).toFixed(1)} MiB` : size >= 1024 ? `${(size / 1024).toFixed(1)} KiB` : `${size || 0} B`;
export function driveFileUrl(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id) ? `https://drive.google.com/file/d/${id}/view` : null;
}
export function createUploadBatch(note_id = null, attachments = []) {
  return {note_id, attachments, entries:[], blocked:null};
}
function uploadError(message, code, status = 0) { return Object.assign(new Error(message), {code, status}); }
function failure(e) {
  if (e.code === 'file_read_failed') return uploadError('파일을 읽지 못했습니다. 파일을 다시 선택해 주세요.', e.code);
  if (e.code === 'note_changed') return uploadError('메모가 변경되었습니다. 메모를 다시 불러온 후 첨부를 확인해 주세요.', e.code, e.status);
  if (e.code === 'note_save_result_unknown' || !e.status || e.status >= 500) return uploadError(UNKNOWN, 'note_save_result_unknown', e.status);
  if (e.status === 401) return uploadError('로그인이 필요합니다. 다시 로그인한 후 시도해 주세요.', e.code, e.status);
  if (e.status === 413) return uploadError('파일은 100MiB까지 첨부할 수 있습니다.', e.code, e.status);
  return uploadError('첨부를 저장하지 못했습니다. 선택한 파일과 Drive 연결 상태를 확인해 주세요.', e.code, e.status);
}
export function validateBatch(batch, raw_text = '') {
  if (batch.blocked) throw batch.blocked;
  if (!batch.note_id && [...raw_text.replace(/\r\n|\r|\n/g, '\r\n')].length > 20000) throw Error('글은 20,000자까지 저장할 수 있습니다.');
  const pending = batch.entries.filter(e => e.kind !== 'success');
  if (batch.attachments.length + pending.length > 20) throw Error('메모에는 파일을 20개까지 첨부할 수 있습니다.');
  for (const {file} of pending) {
    if (!file?.size) throw Error('빈 파일은 첨부할 수 없습니다.');
    if (file.size > MAX_BYTES) throw Error('파일은 100MiB까지 첨부할 수 있습니다.');
  }
}
export async function uploadBasketFile(fd, file, rt = window.KPTURuntime, fetcher = fetch, isCurrent = () => true) {
  if (!(await rt.session.ensure()) || !isCurrent()) throw uploadError('로그인이 필요합니다.', 'session_required', 401);
  const session = rt.session.read();
  if (!session?.access_token) throw uploadError('로그인이 필요합니다.', 'session_required', 401);
  let timer;
  // Match the established upload budget and native multipart fetch. No abort/replay on unknown outcomes.
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(uploadError(UNKNOWN, 'note_save_result_unknown')), Math.min(600000, 90000 + Math.ceil(file.size / 1048576) * 4000)); });
  try {
    return await Promise.race([(async () => {
      const response = await fetcher(rt.config.url + '/functions/v1/basket-files', {method:'POST',headers:{apikey:rt.config.key,Authorization:'Bearer ' + session.access_token},body:fd});
      const text = await response.text();
      let data; try { data = JSON.parse(text); } catch { data = null; }
      if (!response.ok) throw uploadError(data?.error || '첨부 저장 실패', data?.code || 'http_' + response.status, response.status);
      return data;
    })(), deadline]);
  } finally { clearTimeout(timer); }
}
export async function uploadBatch(batch, {raw_text = '', rt = window.KPTURuntime, onChange = () => {}, isCurrent = () => true, request = uploadBasketFile} = {}) {
  validateBatch(batch, raw_text);
  for (const entry of batch.entries.filter(e => e.kind !== 'success')) {
    if (!isCurrent()) throw Error('입력 세션이 변경되었습니다.');
    entry.kind = 'uploading'; entry.label = '업로드 중'; onChange();
    let fd;
    try {
      const copy = await rt.copyUploadFile(entry.file);
      if (!isCurrent()) throw uploadError('입력 세션이 변경되었습니다.', 'session_changed', 401);
      fd = new FormData(); fd.append('file', copy);
      if (batch.note_id) fd.append('note_id', batch.note_id);
      else if (raw_text) fd.append('raw_text', raw_text);
      const result = await request(fd, entry.file, rt, fetch, isCurrent);
      if (!isCurrent()) throw uploadError('입력 세션이 변경되었습니다.', 'session_changed', 401);
      if (!result?.ok || typeof result.note_id !== 'string' || !result.note_id || !Array.isArray(result.attachments) || (batch.note_id && result.note_id !== batch.note_id)) throw uploadError(UNKNOWN, 'note_save_result_unknown');
      batch.note_id = result.note_id; batch.attachments = result.attachments;
      entry.kind = 'success'; entry.label = '완료'; entry.file = {name:entry.file.name,size:entry.file.size};
      onChange();
    } catch (e) {
      const error = failure(e); entry.kind = 'error'; entry.label = '실패';
      if (['note_save_result_unknown','note_changed'].includes(error.code)) batch.blocked = error;
      onChange(); throw error;
    } finally { fd?.delete('file'); }
  }
  return {ok:true,note_id:batch.note_id,attachments:batch.attachments};
}
export function mountBasketPicker(host, {id, getBatch, isBusy, onChange = () => {}, onError}) {
  host.classList.add('library-file-block', 'basket-file-block');
  host.innerHTML = `<input id="${id}" class="library-file-input" type="file" multiple><label class="library-dropzone" for="${id}" tabindex="0" aria-label="바구니 파일 여러 개 선택 또는 끌어놓기"><strong class="library-picker-desktop">파일을 여기로 끌어다 놓거나 클릭하세요</strong><span class="library-picker-mobile library-picker-button">📎 파일 추가</span><span class="library-picker-hint">파일당 100MiB · 20개까지</span></label><div class="library-selected-files" data-basket-files aria-live="polite"></div>`;
  const input = host.querySelector('input'), zone = host.querySelector('label'), rows = host.querySelector('[data-basket-files]');
  let renderedBatch;
  function render() {
    const batch = getBatch();
    if (batch !== renderedBatch) { input.value = ''; renderedBatch = batch; }
    input.disabled = isBusy() || !!batch.blocked;
    zone.setAttribute('aria-disabled', String(input.disabled)); zone.tabIndex = input.disabled ? -1 : 0;
    rows.innerHTML = batch.entries.map((entry, index) => `<div class="library-selected-file ${entry.kind}" data-basket-file="${index}"><div class="library-selected-file-main"><b>${esc(entry.file.name)}</b><small>${esc(fileSize(entry.file.size))}</small></div><span class="library-upload-state">${esc(entry.label || '대기')}</span>${entry.kind === 'success' ? '' : `<button type="button" class="icon-btn" data-basket-remove="${index}" aria-label="${esc(entry.file.name)} 선택 취소"${isBusy() || batch.blocked ? ' disabled' : ''}>×</button>`}</div>`).join('');
  }
  function add(files) {
    if (isBusy() || getBatch().blocked) return;
    const batch = getBatch(), old = batch.entries;
    batch.entries = [...old, ...Array.from(files || []).map(file => ({file,kind:'pending',label:'대기'}))];
    try { validateBatch(batch); } catch(e) { batch.entries = old; render(); onError(e.message); return; }
    input.value = ''; render(); onChange();
  }
  input.addEventListener('change', () => add(input.files));
  zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!input.disabled) input.click(); } });
  for (const type of ['dragenter','dragover']) zone.addEventListener(type, e => { e.preventDefault(); if (!input.disabled) zone.classList.add('dragover'); });
  for (const type of ['dragleave','dragend']) zone.addEventListener(type, () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('dragover'); add(e.dataTransfer?.files); });
  rows.addEventListener('click', e => {
    const b = e.target.closest('[data-basket-remove]'), batch = getBatch();
    if (!b || isBusy() || batch.blocked) return;
    const index = Number(b.dataset.basketRemove); if (batch.entries[index]?.kind === 'success') return;
    batch.entries.splice(index, 1); render(); onChange();
    (rows.querySelectorAll('button')[Math.min(index, rows.querySelectorAll('button').length - 1)] || zone).focus();
  });
  render(); return {render};
}
