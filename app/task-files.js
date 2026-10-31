import {emptyHtml} from './wait-state.js';
// TASK-파일붙이기: files attached to a Google task (read: app_task_attachments; change: google-tasks Edge action=attach / detach).
// The file lives in Google Drive ("자료실/할 일 첨부"); the Edge keeps the task-file link (owner RLS) and one link line per
// file in the task's notes, so the Google Tasks app shows a link. Detaching or deleting the task never deletes the Drive file.
// Deploy order: google-tasks Edge first, then the table. The menu item and file names appear only once the table answers,
// so an older Edge never gets an attach request.
import { fileAttrs, driveFileUrl } from './file-actions.js';
import { renameHostAttrs, renameButtonHtml, applyRenamed } from './file-rename.js'; // ATT-이름고치기: 첨부 이름 그 자리에서 고치기(할 일 첨부 표에 있는 파일만)
export { splitTaskNotes, joinTaskNotes, taskAttachments } from './task-note-files.mjs'; // TASK-첨부열기: 메모 속 '첨부:' 줄 읽기·쓰기는 이 한 곳 // FILE-누르면동작: 이름 누르기·작은 버튼 처리는 file-actions.js 전역 클릭 처리
const endpoint = action => `/functions/v1/google-tasks?action=${encodeURIComponent(action)}`;
export const MAX_TASK_FILES = 10;
export const MAX_TASK_FILE_BYTES = 100 * 1024 * 1024;
const LIST_CHUNK = 50;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export { driveFileUrl };

// task id -> files (attach order), read from the link table with the owner's session (owner RLS).
// Throws when the table is not there yet (migration not applied): the caller then hides the menu item and names.
export async function readTaskFiles(ids, {rt = window.KPTURuntime, expectedSessionEpoch = null} = {}) {
  const list = [...new Set((ids || []).filter(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(id)))];
  const out = new Map(), options = expectedSessionEpoch == null ? {} : {expectedSessionEpoch};
  const cols = 'select=google_task_id,drive_file_id,file_name,size_bytes&order=created_at.asc';
  // One request even with no tasks, so the answer still says whether the table exists.
  for (let i = 0; i === 0 || i < list.length; i += LIST_CHUNK) {
    const ids = list.slice(i, i + LIST_CHUNK);
    let rows;
    try { rows = await rt.api(`/rest/v1/app_task_attachments?${ids.length ? `google_task_id=in.(${ids.join(',')})&` : 'limit=1&'}${cols}`, options); }
    catch (e) { tableMissing(rt); throw e; }
    if (!Array.isArray(rows)) throw Error('할 일 파일을 확인하지 못했어요.');
    if (!ids.length) continue;
    for (const f of rows) {
      if (!f || typeof f.google_task_id !== 'string' || !driveFileUrl(f.drive_file_id)) continue;
      if (!out.has(f.google_task_id)) out.set(f.google_task_id, []);
      out.get(f.google_task_id).push({drive_file_id: f.drive_file_id, file_name: String(f.file_name || '파일'), size_bytes: Number(f.size_bytes) || 0});
    }
  }
  // TASK-추가창파일: the table answered, so the add windows may offer files without asking again (taskFilesAvailable).
  tableAnswered(ownerOf(rt));
  return out;
}

export function fileProblem(file, count) {
  if (count >= MAX_TASK_FILES) return `한 할 일에는 파일을 ${MAX_TASK_FILES}개까지 붙일 수 있습니다.`;
  if (!file?.size) return '빈 파일은 붙일 수 없습니다.';
  if (file.size > MAX_TASK_FILE_BYTES) return '파일은 100MB까지 붙일 수 있습니다.';
  return '';
}

// One file per request (the Edge reads the whole request into memory). The same upload budget as the basket.
export async function attachTaskFile(taskId, file, {rt = window.KPTURuntime} = {}) {
  const copy = await rt.copyUploadFile(file);
  const fd = new FormData();
  fd.append('task_id', taskId);
  fd.append('file', copy);
  try {
    return await rt.api(endpoint('attach'), {method: 'POST', body: fd, singleFlight: false, timeoutMs: Math.min(600000, 90000 + Math.ceil(file.size / 1048576) * 4000)});
  } finally { fd.delete('file'); }
}

export async function detachTaskFile(taskId, driveFileId, {rt = window.KPTURuntime} = {}) {
  return rt.api(endpoint('detach'), {method: 'POST', body: {action: 'detach', task_id: taskId, drive_file_id: driveFileId}, singleFlight: false});
}

// Small names under a task row; each opens the file in Drive.
export function fileLinksHtml(files, {taskId = '', tableIds = null} = {}) {
  if (!files?.length) return '';
  const spec = f => taskId && tableIds?.has(f.drive_file_id) ? {target: 'task', id: taskId, driveId: f.drive_file_id, name: f.file_name} : null;
  return `<div class="gt-files">${files.map(f => `<a class="gt-file" href="${esc(driveFileUrl(f.drive_file_id))}" target="_blank" rel="noopener noreferrer"${renameHostAttrs(spec(f))} ${fileAttrs({name: f.file_name, driveId: f.drive_file_id}, {press: true})} aria-label="첨부 파일 열기: ${esc(f.file_name)}">${esc(f.file_name)}</a>`).join('')}</div>`;
}

// The dialog behind ⋯ → 파일 붙이기: current files with [빼기], a picker, and a status line. The owner of the task list
// (google-tasks.js) passes the task, its files and onChange(files, task) to store answers; this dialog only shows them.
let dialog = null;
export function openTaskFilesDialog({task, files = [], rt = window.KPTURuntime, onChange = () => {}, isCurrent = () => true}) {
  if (!task?.id) return;
  if (!dialog) {
    document.body.insertAdjacentHTML('beforeend', `<div id="gtFilesModal" class="modal hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="gtFilesTitle"><div class="modal-card small-card"><div class="modal-head"><h2 id="gtFilesTitle">파일 붙이기</h2><button type="button" class="icon-btn" data-gt-files-close aria-label="닫기">×</button></div><p class="gt-files-task" data-gt-files-task></p><ul class="gt-files-list" data-gt-files-list></ul><p class="gt-scope-note">Google Drive "자료실/할 일 첨부"에 저장됩니다. Google Tasks 앱에서는 메모에 링크 한 줄로 보입니다. 빼거나 할 일을 지워도 Drive 파일은 남습니다. ${MAX_TASK_FILES}개까지 · 파일당 100MB</p><div class="gt-files-actions"><button type="button" class="secondary" data-gt-files-pick>파일 고르기</button><input type="file" multiple hidden data-gt-files-input></div><div class="status gt-files-status" data-gt-files-status role="status" aria-live="polite"></div></div></div>`);
    const m = document.querySelector('#gtFilesModal');
    dialog = {m, state: null};
    m.querySelector('[data-gt-files-close]').onclick = closeTaskFilesDialog;
    m.querySelector('[data-gt-files-pick]').onclick = () => { if (!dialog.state?.busy) m.querySelector('[data-gt-files-input]').click(); };
    m.querySelector('[data-gt-files-input]').onchange = e => { const picked = [...(e.target.files || [])]; e.target.value = ''; void upload(picked); };
  }
  dialog.state = {task, files: [...files], rt, onChange, isCurrent, busy: false};
  paint();
  status('');
  const m = dialog.m;
  m.classList.remove('hidden');
  m.setAttribute('aria-hidden', 'false');
  window.KPTUA11y?.dialog.activate(m, {trigger: document.activeElement, initialFocus: '[data-gt-files-pick]', onRequestClose: closeTaskFilesDialog});
}
export function closeTaskFilesDialog() {
  if (!dialog) return;
  const {m} = dialog;
  dialog.state = null;
  m.classList.add('hidden');
  m.setAttribute('aria-hidden', 'true');
  window.KPTUA11y?.dialog.deactivate(m, {restoreFocus: true});
}
function status(text, failed = false) {
  const el = dialog?.m.querySelector('[data-gt-files-status]');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('error', failed);
}
// ATT-이름고치기: 열린 [파일 붙이기] 창의 줄도 고친 이름으로.
if (typeof window !== 'undefined') window.addEventListener('kptu:file-renamed', e => { const s = dialog?.state; if (s && applyRenamed(s.files, e.detail)) paint(); });
function paint() {
  const s = dialog?.state;
  if (!s) return;
  const {m} = dialog;
  m.querySelector('[data-gt-files-task]').textContent = s.task.title || '제목 없음';
  const list = m.querySelector('[data-gt-files-list]');
  list.innerHTML = s.files.length
    ? s.files.map(f => { const rn = {target: 'task', id: s.task.id, driveId: f.drive_file_id, name: f.file_name}; return `<li data-fr-row><a class="gt-file" href="${esc(driveFileUrl(f.drive_file_id))}" target="_blank" rel="noopener noreferrer"${renameHostAttrs(rn)} ${fileAttrs({name: f.file_name, driveId: f.drive_file_id}, {press: true})}>${esc(f.file_name)}</a>${s.busy ? '' : renameButtonHtml(rn)}<button type="button" class="mini" data-fa-menu="open"${fileAttrs({name: f.file_name, driveId: f.drive_file_id})} aria-label="${esc(f.file_name)} Drive에서 열기">Drive에서 열기</button><button type="button" class="mini" data-fa-menu="download"${fileAttrs({name: f.file_name, driveId: f.drive_file_id})} aria-label="${esc(f.file_name)} 내려받기">내려받기</button><button type="button" class="mini" data-gt-file-detach="${esc(f.drive_file_id)}" aria-label="${esc(f.file_name)} 빼기"${s.busy ? ' disabled' : ''}>빼기</button></li>`; }).join('')
    : `<li class="gt-files-empty">${emptyHtml()}</li>`;
  list.querySelectorAll('[data-gt-file-detach]').forEach(b => { b.onclick = () => void detach(b.dataset.gtFileDetach); });
  const pick = m.querySelector('[data-gt-files-pick]');
  pick.disabled = s.busy || s.files.length >= MAX_TASK_FILES;
}
function accept(s, d) {
  if (Array.isArray(d?.files)) s.files = d.files.map(f => ({drive_file_id: f.drive_file_id, file_name: String(f.file_name || '파일'), size_bytes: Number(f.size_bytes) || 0}));
  s.onChange(s.files, d?.task || null);
}
const message = e => String(e?.message || e || '').trim() || '잠시 후 다시 시도해 주세요.';
async function upload(picked) {
  const s = dialog?.state;
  if (!s || s.busy || !picked.length) return;
  s.busy = true; paint();
  let done = 0, unsynced = false;
  try {
    for (const file of picked) {
      const problem = fileProblem(file, s.files.length);
      if (problem) { status(`${file.name}: ${problem}`, true); return; }
      status(`${file.name} 올리는 중… (${done + 1}/${picked.length})`);
      let d;
      try { d = await attachTaskFile(s.task.id, file, {rt: s.rt}); }
      catch (e) { if (dialog?.state === s && s.isCurrent()) status(`${file.name}: ${message(e)}`, true); return; }
      if (!s.isCurrent()) return;
      if (!d?.ok) { status(`${file.name}: 저장 결과를 확인하지 못했습니다. 할 일을 다시 열어 확인해 주세요.`, true); return; }
      // Saved on the server: the list owner hears it even if this dialog was closed meanwhile.
      accept(s, d); done++;
      if (dialog?.state !== s) return;
      if (d.notes_synced === false) unsynced = true;
      paint();
    }
    status(unsynced ? `${done}개 붙였습니다. Google 할 일 메모의 링크 줄은 다음 저장 때 붙습니다.` : `${done}개 붙였습니다.`);
  } finally {
    if (dialog?.state === s) { s.busy = false; paint(); }
  }
}
async function detach(id) {
  const s = dialog?.state;
  const f = s?.files.find(x => x.drive_file_id === id);
  if (!s || s.busy || !f) return;
  s.busy = true; paint(); status(`${f.file_name} 빼는 중…`);
  try {
    const d = await detachTaskFile(s.task.id, id, {rt: s.rt});
    if (!s.isCurrent()) return;
    if (!Array.isArray(d?.files)) s.files = s.files.filter(x => x.drive_file_id !== id);
    accept(s, d);
    if (dialog?.state !== s) return;
    status(d?.notes_synced === false ? `${f.file_name}을(를) 뺐습니다. 메모의 링크 줄은 다음 저장 때 정리됩니다.` : `${f.file_name}을(를) 뺐습니다. Drive 파일은 남아 있습니다.`);
  } catch (e) {
    if (dialog?.state === s && s.isCurrent()) {
      if (e?.status === 404) { s.files = s.files.filter(x => x.drive_file_id !== id); accept(s, null); status(`${f.file_name}은(는) 이미 빠졌습니다.`); }
      else status(`${f.file_name}: ${message(e)}`, true);
    }
  } finally {
    if (dialog?.state === s) { s.busy = false; paint(); }
  }
}

// TASK-추가창파일: files chosen in a task's add window (the task editor, the [할 일] quick input, the calendar's 할 일 등록) go
// up only after Google made the task: save → task id → one attach request per file, the same Edge action and Drive folder as
// ⋯ → 파일 붙이기. A file that did not go up leaves the task as it is; the caller says so and points at ⋯ → 파일 붙이기.
const available = new Map();
const readyEvents = typeof window === 'undefined' ? new EventTarget() : window;
function ownerOf(rt) { return rt?.context?.read?.()?.user?.id || rt?.session?.read?.()?.user?.id || ''; }
// TEST-홈빠른입력안정화: windows that keep the file part's place while the answer is out hear a yes and a failed read alike.
function tell(owner, yes) { try { readyEvents.dispatchEvent(new CustomEvent('kptu:task-files-ready', {detail: {owner, yes}})); } catch {} }
// A read of the table answered for this owner (the task list's own read or the check below). Only a yes is kept in memory.
function tableAnswered(owner) {
  if (!owner || available.get(owner)?.yes) return;
  const yes = Promise.resolve(true); yes.yes = true; available.set(owner, yes);
  tell(owner, true);
}
// A read failed (no table yet, or a network error): a window still keeping the place stops waiting. Nothing is stored.
function tableMissing(rt) {
  const owner = ownerOf(rt);
  if (!owner || available.get(owner)?.yes) return;
  tell(owner, false);
}
// Whether the link table answers for this owner (the same check that shows ⋯ → 파일 붙이기). Only a yes is remembered.
// ask:false only reports an answer already known (the [할 일] screen waits for its list's own read, see onTaskFilesReady).
export function taskFilesAvailable({rt = window.KPTURuntime, ask = true} = {}) {
  const owner = ownerOf(rt);
  if (!owner) return Promise.resolve(false);
  if (!available.has(owner)) {
    if (!ask) return Promise.resolve(false);
    available.set(owner, readTaskFiles([], {rt}).then(() => true, () => { if (!available.get(owner)?.yes) available.delete(owner); return false; }));
  }
  return available.get(owner);
}
// Whether a yes is already known for the signed-in owner (no request). Lets a window lay out its file row before it shows.
export function taskFilesKnown({rt = window.KPTURuntime} = {}) { return !!available.get(ownerOf(rt))?.yes; }
// Calls back once the table has answered for an owner (by any read; yes = true), and after a read failed (yes = false).
// Returns a function that stops listening.
export function onTaskFilesReady(callback) {
  const listener = e => callback(e.detail?.owner || '', e.detail?.yes !== false);
  readyEvents.addEventListener('kptu:task-files-ready', listener);
  return () => readyEvents.removeEventListener('kptu:task-files-ready', listener);
}
// The problem with adding these files to a new task's selection, or ''.
export function pickProblem(chosen, added) {
  let count = chosen.length;
  for (const file of added) { const problem = fileProblem(file, count++); if (problem) return `${file.name}: ${problem}`; }
  return '';
}
export async function attachNewTaskFiles(taskId, files, {rt = window.KPTURuntime, onProgress = () => {}} = {}) {
  const failed = [];
  let done = 0, saved = null, unsynced = false;
  for (const [index, file] of files.entries()) {
    const problem = fileProblem(file, done);
    if (problem) { failed.push({name: file.name, message: problem}); continue; }
    onProgress(index, files.length, file);
    try {
      const d = await attachTaskFile(taskId, file, {rt});
      if (!d?.ok) throw Error('저장 결과를 확인하지 못했습니다.');
      done++;
      if (Array.isArray(d.files)) saved = d.files.map(f => ({drive_file_id: f.drive_file_id, file_name: String(f.file_name || '파일'), size_bytes: Number(f.size_bytes) || 0}));
      if (d.notes_synced === false) unsynced = true;
    } catch (e) { failed.push({name: file.name, message: message(e)}); }
  }
  return {done, failed, files: saved, unsynced};
}
// One line for the add window (and the toast) when some files did not go up. Never silent.
export function newTaskFilesNotice(result) {
  if (!result?.failed?.length) return '';
  const names = result.failed.map(f => f.name).join(', '), first = result.failed[0].message;
  return `할 일은 저장했습니다. 파일 ${result.failed.length}개(${names})를 붙이지 못했습니다: ${first} 할 일 ⋯ → 파일 붙이기에서 확인하고 다시 붙일 수 있습니다.`;
}

// The [📎 파일 붙이기] button and the chosen-file list inside an add window. Nothing is uploaded here; the window reads files()
// after its own save. hidden until show(true) (the table answered).
export function mountNewTaskFilePick(host, {isBusy = () => false, onError = () => {}} = {}) {
  host.classList.add('gt-pick');
  host.hidden = true;
  host.innerHTML = `<div class="gt-pick-line"><button type="button" class="secondary gt-pick-btn" data-gt-pick><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M13.2 7.6 8.1 12.7a3.3 3.3 0 0 1-4.7-4.7l5.4-5.4a2.2 2.2 0 0 1 3.1 3.1l-5.4 5.4a1.1 1.1 0 0 1-1.6-1.6l5-5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>파일 붙이기</button><small class="gt-pick-hint">저장하면 Drive "자료실/할 일 첨부"에 올라갑니다 · ${MAX_TASK_FILES}개까지 · 파일당 100MB</small><input type="file" multiple hidden data-gt-pick-input></div><ul class="gt-pick-list" data-gt-pick-list></ul>`;
  const input = host.querySelector('[data-gt-pick-input]'), button = host.querySelector('[data-gt-pick]'), list = host.querySelector('[data-gt-pick-list]');
  let chosen = [];
  const render = () => {
    const busy = isBusy();
    button.disabled = busy || chosen.length >= MAX_TASK_FILES || host.hasAttribute('data-gt-pick-wait');
    list.hidden = !chosen.length;
    list.innerHTML = chosen.map((f, i) => `<li><span class="gt-pick-name">${esc(f.name)}</span><button type="button" class="icon-btn" data-gt-pick-remove="${i}" aria-label="${esc(f.name)} 선택 취소"${busy ? ' disabled' : ''}>×</button></li>`).join('');
  };
  button.onclick = () => { if (!isBusy()) input.click(); };
  input.onchange = () => {
    const added = [...(input.files || [])]; input.value = '';
    const problem = pickProblem(chosen, added);
    if (problem) { onError(problem); return; }
    chosen = [...chosen, ...added]; onError(''); render();
  };
  // TASK-첨부교체: PC can drop files on the part too (the same checks as the picker). The drop stays here (no page-level drop).
  const takesDrop = e => !host.hidden && !host.hasAttribute('data-gt-pick-wait') && !isBusy() && [...(e.dataTransfer?.types || [])].includes('Files');
  host.addEventListener('dragover', e => { if (!takesDrop(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; host.classList.add('is-drop'); });
  host.addEventListener('dragleave', e => { if (!host.contains(e.relatedTarget)) host.classList.remove('is-drop'); });
  host.addEventListener('drop', e => {
    host.classList.remove('is-drop');
    if (!takesDrop(e)) return;
    e.preventDefault(); e.stopPropagation();
    const added = [...(e.dataTransfer.files || [])], problem = pickProblem(chosen, added);
    if (problem) { onError(problem); return; }
    if (!added.length) return;
    chosen = [...chosen, ...added]; onError(''); render();
  });
  list.onclick = e => {
    const b = e.target.closest('[data-gt-pick-remove]'); if (!b || isBusy()) return;
    chosen.splice(Number(b.dataset.gtPickRemove), 1); render();
    (list.querySelector('button') || button).focus();
  };
  render();
  return {
    files: () => [...chosen],
    clear: () => { chosen = []; render(); },
    show: on => { host.hidden = !on; host.removeAttribute('data-gt-pick-wait'); if (!on) { chosen = []; } render(); },
    // TEST-홈빠른입력안정화: this load's answer is not in yet: keep the row's place, unseen and unusable.
    wait: () => { host.hidden = false; host.setAttribute('data-gt-pick-wait', ''); chosen = []; render(); },
    render,
  };
}


// TASK-첨부교체: the rows of the edit window's 첨부 box (pure: the box above draws it). Unchanged rows use the shared file-actions
// buttons (data-fa-menu) for [열기] [내려받기]; held changes show a small tag and [되돌리기] / [취소].
const ATT_ICON = '<svg class="gt-att-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M4 1.5h5l3 3v10H4z M9 1.5v3h3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
const keptCount = (base, edits, added) => base.filter(f => edits.get(f.drive_file_id)?.kind !== 'remove').length + added.length;
export function taskAttachHtml({base = [], edits = new Map(), added = [], editable = false, busy = false, taskId = ''} = {}) {
  const btn = (label, attr, aria, off) => `<button type="button" class="ghost gt-att-btn" ${attr} aria-label="${esc(aria)}"${off ? ' disabled' : ''}>${label}</button>`;
  const rows = base.map(f => {
    const id = esc(f.drive_file_id), name = esc(f.file_name), e = edits.get(f.drive_file_id);
    if (e?.kind === 'swap') {
      const next = esc(e.file.name);
      return `<div class="gt-att-row is-changed" data-gt-att-id="${id}">${ATT_ICON}<span class="gt-att-name" title="${next} (원래: ${name})">${next}</span><small class="gt-att-tag">교체</small>${btn('되돌리기', `data-gt-att-undo="${id}"`, `교체 되돌리기: ${f.file_name}`, busy)}</div>`;
    }
    if (e?.kind === 'remove') return `<div class="gt-att-row is-removed" data-gt-att-id="${id}">${ATT_ICON}<span class="gt-att-name" title="${name}">${name}</span><small class="gt-att-tag">뺌</small>${btn('되돌리기', `data-gt-att-undo="${id}"`, `빼기 되돌리기: ${f.file_name}`, busy)}</div>`;
    const attrs = fileAttrs({name: f.file_name, driveId: f.drive_file_id});
    // ATT-이름고치기: 할 일 첨부 표에 있는 파일만(메모 속 '첨부:' 줄만 있는 파일은 서버 줄이 없어 고칠 수 없음).
    const rn = editable && taskId && f.inTable ? {target: 'task', id: taskId, driveId: f.drive_file_id, name: f.file_name} : null;
    return `<div class="gt-att-row" data-gt-att-id="${id}" data-fr-row>${ATT_ICON}<span class="gt-att-name" title="${name}"${renameHostAttrs(rn)}>${name}</span>${busy ? '' : renameButtonHtml(rn)}<button type="button" class="ghost gt-att-btn" data-fa-menu="open"${attrs} aria-label="첨부 열기: ${name}">열기</button><button type="button" class="ghost gt-att-btn" data-fa-menu="download"${attrs} aria-label="첨부 내려받기: ${name}">내려받기</button>${editable ? btn('교체', `data-gt-att-swap="${id}"`, `첨부 교체: ${f.file_name}`, busy) + btn('빼기', `data-gt-att-remove="${id}"`, `첨부 빼기: ${f.file_name}`, busy) : ''}</div>`;
  });
  const fresh = added.map((f, i) => `<div class="gt-att-row is-new">${ATT_ICON}<span class="gt-att-name" title="${esc(f.name)}">${esc(f.name)}</span><small class="gt-att-tag">새 파일</small>${btn('취소', `data-gt-att-drop="${i}"`, `붙이기 취소: ${f.name}`, busy)}</div>`);
  const changed = edits.size > 0 || added.length > 0;
  const more = editable ? `<div class="gt-att-more">${btn('파일 붙이기', 'data-gt-att-add', '첨부 파일 붙이기', busy || keptCount(base, edits, added) >= MAX_TASK_FILES)}<small class="gt-att-hint">${changed ? '저장하면 반영됩니다 · 원래 파일은 Drive에 남습니다' : `${MAX_TASK_FILES}개까지 · 파일당 100MB`}</small></div>` : '';
  return rows.join('') + fresh.join('') + more;
}

// TASK-첨부교체: the 첨부 rows of the edit window, with changes held until [저장]. Each file: name · [열기] [내려받기] [교체] [빼기];
// a task without files: 첨부 [파일 붙이기]. [교체] picks one file in place of that row (PC: drop a file on the row too); [빼기]
// marks the row; drops elsewhere in the box add files. Nothing goes to the server here: the owner (google-tasks.js) reads plan()
// at [저장] and sends the same attach / detach requests as ⋯ → 파일 붙이기. Closing the window (set() on the next open) forgets
// the changes. Detaching never deletes the Drive file. editable:false (no link table yet) keeps only [열기] [내려받기].
export function mountTaskAttach(host, {isBusy = () => false, onError = () => {}, onChange = () => {}} = {}) {
  let base = [], editable = false, shown = false, edits = new Map(), added = [], swapFor = '', taskId = '';
  host.innerHTML = '<span class="gt-att-label">첨부</span><div class="gt-att-list" data-gt-att-list></div><input type="file" multiple hidden data-gt-att-add-input><input type="file" hidden data-gt-att-swap-input>';
  const list = host.querySelector('[data-gt-att-list]'), addInput = host.querySelector('[data-gt-att-add-input]'), swapInput = host.querySelector('[data-gt-att-swap-input]');
  const kept = () => keptCount(base, edits, added);
  const dirty = () => edits.size > 0 || added.length > 0;
  const changed = () => { onError(''); render(); onChange(); };
  function render() {
    host.classList.toggle('hidden', !shown || (!editable && !base.length));
    list.innerHTML = taskAttachHtml({base, edits, added, editable, busy: isBusy(), taskId});
  }
  function addFiles(files) {
    if (!editable || isBusy() || !files.length) return;
    let count = kept();
    for (const file of files) { const problem = fileProblem(file, count++); if (problem) { onError(`${file.name}: ${problem}`); return; } }
    added = [...added, ...files]; changed();
  }
  function swapFile(id, file) {
    if (!editable || isBusy() || !file || !base.some(f => f.drive_file_id === id)) return;
    const problem = fileProblem(file, 0);
    if (problem) { onError(`${file.name}: ${problem}`); return; }
    edits.set(id, {kind: 'swap', file}); changed();
    list.querySelector(`[data-gt-att-undo="${CSS.escape(id)}"]`)?.focus();
  }
  list.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled || isBusy()) return;
    if (b.hasAttribute('data-gt-att-add')) { addInput.click(); return; }
    if (b.dataset.gtAttSwap) { swapFor = b.dataset.gtAttSwap; swapInput.click(); return; }
    if (b.dataset.gtAttRemove) { const id = b.dataset.gtAttRemove; edits.set(id, {kind: 'remove'}); changed(); list.querySelector(`[data-gt-att-undo="${CSS.escape(id)}"]`)?.focus(); return; }
    if (b.dataset.gtAttUndo) { const id = b.dataset.gtAttUndo; edits.delete(id); changed(); list.querySelector(`[data-gt-att-swap="${CSS.escape(id)}"]`)?.focus(); return; }
    if (b.dataset.gtAttDrop != null) { added.splice(Number(b.dataset.gtAttDrop), 1); changed(); list.querySelector('[data-gt-att-add]')?.focus(); }
  });
  addInput.onchange = () => { const files = [...(addInput.files || [])]; addInput.value = ''; addFiles(files); };
  swapInput.onchange = () => { const file = swapInput.files?.[0]; swapInput.value = ''; const id = swapFor; swapFor = ''; if (file) swapFile(id, file); };
  // PC: drop a file on a row to put it in that row's place; anywhere else in the box adds it.
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  host.addEventListener('dragover', e => { if (!editable || isBusy() || !hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; host.classList.add('is-drop'); });
  host.addEventListener('dragleave', e => { if (!host.contains(e.relatedTarget)) host.classList.remove('is-drop'); });
  host.addEventListener('drop', e => {
    host.classList.remove('is-drop');
    if (!editable || isBusy() || !hasFiles(e)) return;
    e.preventDefault(); e.stopPropagation();
    const files = [...(e.dataTransfer.files || [])], row = e.target.closest?.('[data-gt-att-id]'), id = row?.dataset.gtAttId;
    if (id && files.length === 1 && edits.get(id)?.kind !== 'remove') swapFile(id, files[0]); else addFiles(files);
  });
  return {
    // files: the task's current files ({drive_file_id, file_name, inTable}); a new set forgets every held change.
    set(files = [], {editable: canEdit = false, shown: visible = true, taskId: id = ''} = {}) { base = files.map(f => ({...f})); editable = !!canEdit; shown = !!visible; taskId = String(id || ''); edits = new Map(); added = []; swapFor = ''; render(); },
    dirty,
    // What [저장] sends: rows to take off, rows to put a new file in place of, and new files.
    plan() {
      const remove = [], swap = [];
      for (const f of base) { const e = edits.get(f.drive_file_id); if (e?.kind === 'remove') remove.push(f); else if (e?.kind === 'swap') swap.push({from: f, file: e.file}); }
      return {remove, swap, add: [...added], tableCount: base.filter(f => f.inTable).length};
    },
    render,
    // ATT-이름고치기: 고친 이름을 들고 있는 줄에 반영한다(잡아 둔 교체·빼기는 그대로).
    renamed(detail) { if (applyRenamed(base, detail)) render(); },
  };
}

// TASK-첨부교체: [저장] of the edit window: the held plan goes to the server one request at a time. Takeoffs first (room under the
// 10-file limit), then each swap (the new file goes up before the old one comes off, so a failed upload keeps the old one; a full
// task takes the old one off first), then new files. A file known only from a notes line is taken off by the caller's notes save
// (gone + noteOnly). Never throws: every failure is named in the result.
export async function applyTaskAttachPlan(taskId, plan, {rt = window.KPTURuntime, onProgress = () => {}} = {}) {
  const failed = [], gone = new Set();
  let files = null, task = null, unsynced = false, count = Number(plan.tableCount) || 0;
  const take = d => { if (Array.isArray(d?.files)) { files = d.files.map(f => ({drive_file_id: f.drive_file_id, file_name: String(f.file_name || '파일'), size_bytes: Number(f.size_bytes) || 0})); count = files.length; } if (d?.task) task = d.task; if (d?.notes_synced === false) unsynced = true; };
  const off = async f => {
    if (f.inTable) {
      try { const d = await detachTaskFile(taskId, f.drive_file_id, {rt}); count = Math.max(0, count - 1); take(d); }
      catch (e) { if (e?.status !== 404) throw e; count = Math.max(0, count - 1); }
    }
    gone.add(f.drive_file_id);
  };
  const up = async file => {
    const problem = fileProblem(file, 0); if (problem) throw Error(problem);
    const d = await attachTaskFile(taskId, file, {rt});
    if (!d?.ok) throw Error('저장 결과를 확인하지 못했습니다.');
    count++; take(d);
  };
  const steps = plan.remove.length + plan.swap.length + plan.add.length;
  let step = 0;
  for (const f of plan.remove) {
    onProgress(step++, steps, f.file_name, '빼는 중');
    try { await off(f); } catch (e) { failed.push({name: f.file_name, message: message(e)}); }
  }
  for (const {from, file} of plan.swap) {
    onProgress(step++, steps, file.name, '올리는 중');
    const full = from.inTable && count >= MAX_TASK_FILES;
    try {
      if (full) { await off(from); await up(file); }
      else { await up(file); try { await off(from); } catch (e) { failed.push({name: from.file_name, message: `새 파일은 붙였지만 원래 파일을 빼지 못했습니다. ${message(e)}`}); } }
    } catch (e) { failed.push({name: file.name, message: message(e)}); }
  }
  for (const file of plan.add) {
    onProgress(step++, steps, file.name, '올리는 중');
    try { await up(file); } catch (e) { failed.push({name: file.name, message: message(e)}); }
  }
  return {failed, gone, files, task, unsynced};
}
// One line for the edit window when part of the plan did not go through. Never silent.
export function taskAttachNotice(result) {
  if (!result?.failed?.length) return '';
  const names = [...new Set(result.failed.map(f => f.name))].join(', ');
  return `할 일은 저장했습니다. 첨부 ${result.failed.length}건(${names})을 바꾸지 못했습니다: ${result.failed[0].message} 다시 해 주세요.`;
}
