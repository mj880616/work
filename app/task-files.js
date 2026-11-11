import {emptyHtml} from './wait-state.js';
import {bindPaste} from './paste-files.mjs';
// TASK-파일붙이기: files attached to a Google task (read: app_task_attachments; change: google-tasks Edge action=attach / detach).
// The file lives in Google Drive ("자료실/할 일 첨부"); the Edge keeps the task-file link (owner RLS) and one link line per
// file in the task's notes, so the Google Tasks app shows a link. Detaching or deleting the task never deletes the Drive file.
// Deploy order: google-tasks Edge first, then the table. The menu item and file names appear only once the table answers,
// so an older Edge never gets an attach request.
import { fileAttrs, driveFileUrl } from './file-actions.js';
import { uploadTimeoutMs } from './upload-budget.mjs';
import { sendUploadApi } from './upload-send.mjs';
import { trackUpload, mountUploadRows, announceDock } from './upload-progress.js';
import { createAttachQueue, sendFilesBehind } from './basket-upload.js'; // BIZ-저장먼저닫기 3차: 할 일 첨부도 노트·업데이트와 같은 뒤 줄·끝 알림
import { renameHostAttrs, renameButtonHtml, applyRenamed, openRenameEditor } from './file-rename.js';
import { rowMore } from './row-more.js';
import { deleteAttachment } from './file-trash.js'; // FILE-첨부삭제 ②: [삭제] = 할 일에서 떼고 Drive 원본 휴지통(30일 안 되살림) + [되돌리기] // ATT-이름고치기: 첨부 이름 그 자리에서 고치기(할 일 첨부 표에 있는 파일만)
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
  if (!file?.size) return '빈 파일은 붙일 수 없어요.';
  if (file.size > MAX_TASK_FILE_BYTES) return '파일은 100MB까지 붙일 수 있습니다.';
  return '';
}

// One file per request (the Edge reads the whole request into memory). The same upload budget as the basket.
// UI-올리기진행표시 ②: 보내기는 공용 길(upload-send.mjs sendUploadApi = 실제 보낸 양), 표시는 공용 부품(upload-progress.js).
// 한 할 일의 메모 줄을 서버가 차례로 고치므로 한 번에 한 파일씩 보낸다(동시에 보내면 늦은 쪽이 메모 줄을 덮을 수 있다).
// 올리는 줄의 열쇠: job.scope = 'task:' + 할 일 id(창이 자기 할 일 것만 그린다). ✕는 다 보내기 전만(code upload_cancelled).
export async function attachTaskFile(taskId, file, {rt = window.KPTURuntime, job = null} = {}) {
  const shown = job || trackUpload({file, name: file?.name, size: file?.size});
  shown.scope = 'task:' + taskId;
  const fd = new FormData();
  try {
    const copy = await rt.copyUploadFile(file);
    fd.append('task_id', taskId);
    fd.append('file', copy);
    const data = await sendUploadApi(rt, endpoint('attach'), {body: fd, size: file?.size || 0, job: shown, timeoutMs: uploadTimeoutMs(file?.size)});
    shown.done();
    return data;
  } catch (e) {
    if (e?.code !== 'upload_cancelled') shown.fail(message(e));
    throw e;
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

// The dialog behind ⋯ → 파일 붙이기: current files with [빼기] [삭제], a picker, and a status line.
// [빼기] takes the link off only (the Drive file stays). [삭제] asks once, then also sends the Drive original to the Drive trash
// (file-trash.js; a file another record still uses stays in Drive) and offers [되돌리기] (puts it back on the task and out of the trash). The owner of the task list
// (google-tasks.js) passes the task, its files and onChange(files, task) to store answers; this dialog only shows them.
let dialog = null;
export function openTaskFilesDialog({task, files = [], rt = window.KPTURuntime, onChange = () => {}, isCurrent = () => true}) {
  if (!task?.id) return;
  if (!dialog) {
    document.body.insertAdjacentHTML('beforeend', `<div id="gtFilesModal" class="modal hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="gtFilesTitle"><div class="modal-card small-card"><div class="modal-head"><h2 id="gtFilesTitle">파일 붙이기</h2><button type="button" class="icon-btn" data-gt-files-close aria-label="닫기">×</button></div><p class="gt-files-task" data-gt-files-task></p><ul class="gt-files-list" data-gt-files-list></ul><p class="gt-scope-note">${MAX_TASK_FILES}개까지 · 파일당 100MB</p><div class="gt-files-actions"><button type="button" class="secondary" data-gt-files-pick>파일 선택</button><input type="file" multiple hidden data-gt-files-input></div><div data-gt-files-progress hidden></div><div class="status gt-files-status" data-gt-files-status role="status" aria-live="polite"></div></div></div>`);
    const m = document.querySelector('#gtFilesModal');
    mountUploadRows(m.querySelector('[data-gt-files-progress]'), {has: job => !!dialog?.state && job.scope === 'task:' + dialog.state.task.id});
    dialog = {m, state: null};
    m.querySelector('[data-gt-files-close]').onclick = closeTaskFilesDialog;
    m.querySelector('[data-gt-files-pick]').onclick = () => { if (canPick(dialog.state)) m.querySelector('[data-gt-files-input]').click(); };
    m.querySelector('[data-gt-files-input]').onchange = e => { const picked = [...(e.target.files || [])]; e.target.value = ''; void upload(picked); };
  }
  // UX-먼저묻고뒤에처리 3차: 같은 할 일의 올리기가 아직 돌고 있으면 그 줄을 이어서 보여 준다(다시 열어도 줄이 둘로 갈리지 않게).
  const running = runningUploads.get(task.id);
  if (running && running.rt === rt) { running.onChange = onChange; running.isCurrent = isCurrent; dialog.state = running; }
  else dialog.state = {task, files: [...files], rt, onChange, isCurrent, busy: false, uploading: false, queue: []};
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
// 뒤 줄이 그 할 일에 파일을 붙였다: 열린 [파일 붙이기] 창이 그 할 일이면 줄을 맞추고, 줄이 다 끝나면 잠금을 푼다.
function filesArrived(taskId, latest) {
  const s = dialog?.state;
  if (!s || s.task.id !== taskId) return;
  if (Array.isArray(latest?.files)) s.files = latest.files;
  paint();
  void taskFileLine.settled(taskId).then(() => { if (dialog?.state === s) paint(); });
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
  const lock = s.busy || s.uploading || taskFileLine.going(s.task.id); // 빼기·삭제·이름 고치기는 올리는 동안 잠근다(서버 목록이 엇갈리지 않게). 고르기만 줄 세움.
  // FILE-첨부삭제 ② 뒤 결정 2(2026-11-11 명진 '추천대로'): 줄 단추 5개(이름 수정·Drive에서 열기·내려받기·빼기·삭제) 때문에 폰 412에서
  // 파일 이름이 잘렸다 → 노트 첨부 줄처럼 줄마다 ⋯ 하나(공용 row-more.js)에 모으고 이름이 줄 너비를 다 쓴다. 이름 누르기(종류별 열기)·
  // 두 번 누르기/꾹 누르기(이름 고치기)는 그대로. 메뉴 항목의 누르기는 원래 처리(file-actions.js data-fa-menu, 아래 빼기·삭제·이름 수정) 그대로.
  list.innerHTML = s.files.length
    ? s.files.map(f => { const rn = {target: 'task', id: s.task.id, driveId: f.drive_file_id, name: f.file_name}; return `<li data-fr-row data-gt-file-row="${esc(f.drive_file_id)}"><a class="gt-file" href="${esc(driveFileUrl(f.drive_file_id))}" target="_blank" rel="noopener noreferrer"${renameHostAttrs(rn)} ${fileAttrs({name: f.file_name, driveId: f.drive_file_id}, {press: true})}>${esc(f.file_name)}</a></li>`; }).join('')
    : `<li class="gt-files-empty">${emptyHtml()}</li>`;
  list.querySelectorAll('[data-gt-file-row]').forEach(li => {
    const f = s.files.find(x => x.drive_file_id === li.dataset.gtFileRow); if (!f) return;
    const fa = {faName: f.file_name, faId: f.drive_file_id};
    li.append(rowMore(document, {label: `${f.file_name} 메뉴`, data: {gtFileMore: f.drive_file_id}, items: [
      {text: '이름 수정', data: {gtFileRename: f.drive_file_id}, disabled: lock},
      {text: 'Drive에서 열기', data: {faMenu: 'open', ...fa}},
      {text: '내려받기', data: {faMenu: 'download', ...fa}},
      {text: '빼기', data: {gtFileDetach: f.drive_file_id}, disabled: lock},
      {text: '삭제', data: {gtFileDelete: f.drive_file_id}, danger: true, disabled: lock},
    ]}));
  });
  list.querySelectorAll('[data-gt-file-rename]').forEach(b => { b.onclick = () => { const li = b.closest('li'); li?.querySelector('details.row-more')?.removeAttribute('open'); const host = li?.querySelector('[data-fr-host]'); if (host && !(dialog?.state?.busy || dialog?.state?.uploading)) openRenameEditor(host); }; });
  list.querySelectorAll('[data-gt-file-detach]').forEach(b => { b.onclick = () => void detach(b.dataset.gtFileDetach); });
  list.querySelectorAll('[data-gt-file-delete]').forEach(b => { b.onclick = () => void remove(b.dataset.gtFileDelete, b.closest('li')?.querySelector('details.row-more > summary') || b); });
  const pick = m.querySelector('[data-gt-files-pick]');
  pick.disabled = !canPick(s);
}
// 올리는 중에도 [파일 선택]은 열려 있다: 더 고른 파일은 올리는 줄 뒤에 선다. 빼기·삭제(busy) 중과 개수 한도에서만 잠근다.
function canPick(s) { return !!s && !s.busy && s.files.length + s.queue.length < MAX_TASK_FILES; }
function accept(s, d) {
  if (Array.isArray(d?.files)) s.files = d.files.map(f => ({drive_file_id: f.drive_file_id, file_name: String(f.file_name || '파일'), size_bytes: Number(f.size_bytes) || 0}));
  s.onChange(s.files, d?.task || null);
}
const message = e => String(e?.message || e || '').trim() || '잠시 후 다시 시도해 주세요.';
// UX-먼저묻고뒤에처리(요청함 11/09 18:04): 고른 파일은 창을 닫거나 다른 화면으로 옮겨도 끝까지 올린다(멈추는 것은 계정·로그인이 바뀔 때뿐).
// 진행은 공용 올리기 줄(창의 올리는 줄, 창을 닫았으면 하단바 위 한 줄). UX-알림하나로(S59-21): 끝·실패는 창이 열려 있든 닫혔든 하단바 위 한 줄
// 하나(announceDock, files — 창의 올리는 줄은 그 파일의 '실패'·'✓ 완료'를 따로 그리지 않는다). 창 상태 줄에 같은 말을 또 쓰지 않는다.
const shown = s => dialog?.state === s;
function tellEnd(s, text, {failed = false, note = '', files = []} = {}) {
  if (shown(s)) status('');
  announceDock({text: `${s.task.title || '할 일'}: ${text}`, note, error: failed, ms: failed ? 0 : undefined, files});
}
const runningUploads = new Map(); // 할 일 id → 올리는 중인 창 상태(메모리만, 새 저장소 아님)
async function upload(picked) {
  const s = dialog?.state;
  if (!s || s.busy || !picked.length) return;
  // UX-먼저묻고뒤에처리 3차: 올리는 중에 더 고르면 거절하지 않고 줄 뒤에 세운다.
  s.queue.push(...picked);
  if (s.uploading) { if (shown(s)) { status(`${s.queue.length}개 대기 중 · 앞 파일을 올린 뒤 이어서 올립니다.`); paint(); } return; }
  s.uploading = true; runningUploads.set(s.task.id, s); paint();
  // BIZ-저장먼저닫기 3차: 같은 할 일의 뒤 줄(저장 창에서 넘긴 파일)과 한 줄로 선다 — 앞 것이 끝난 뒤 이어서 올린다(한 할 일에 한 번에 한 파일).
  if (taskFileLine.going(s.task.id) && shown(s)) status('앞 파일을 올린 뒤 이어서 올립니다.');
  await taskFileLine.add(s.task.id, {note_id: s.task.id, entries: []}, () => uploadQueue(s));
  if (shown(s)) paint(); // 줄이 다 끝난 뒤(빼기·삭제 잠금이 풀린 뒤) 한 번 더 그린다
}
async function uploadQueue(s) {
  let done = 0, unsynced = false, stopped = false;
  const sentFiles = [];
  try {
    while (s.queue.length && !stopped) {
      const file = s.queue.shift();
      const problem = fileProblem(file, s.files.length);
      if (problem) { tellEnd(s, `${file.name} 못 올렸어요`, {failed: true, note: problem}); stopped = true; break; }
      if (shown(s)) { status(s.queue.length ? `${s.queue.length}개 대기 중` : ''); paint(); } // 올리는 파일의 진행은 올리는 줄(막대·%)이 그린다
      let d;
      try { d = await attachTaskFile(s.task.id, file, {rt: s.rt}); }
      catch (e) { if (e?.code === 'upload_cancelled') continue; if (!s.isCurrent()) { stopped = true; break; } tellEnd(s, `${file.name} 못 올렸어요`, {failed: true, note: message(e), files: [file]}); stopped = true; break; }
      if (!s.isCurrent()) { stopped = true; break; }
      if (!d?.ok) { tellEnd(s, `${file.name} 못 올렸어요`, {failed: true, note: '저장 결과를 확인하지 못했어요. 할 일을 다시 열어 확인해 주세요.', files: [file]}); stopped = true; break; }
      // Saved on the server: the list owner hears it even if this dialog was closed meanwhile.
      accept(s, d); done++; sentFiles.push(file);
      if (d.notes_synced === false) unsynced = true;
      if (shown(s)) paint();
    }
    if (!stopped) {
      if (done) tellEnd(s, `${done}개 붙였습니다.`, {note: unsynced ? 'Google 할 일 메모의 링크 줄은 다음 저장 때 붙습니다.' : '', files: sentFiles});
    }
  } finally {
    s.queue.length = 0; // 실패·계정 바뀜으로 멈추면 남은 대기는 버린다(메시지로 알렸다). 다시 고르면 된다.
    s.uploading = false;
    if (runningUploads.get(s.task.id) === s) runningUploads.delete(s.task.id);
    if (shown(s)) paint();
  }
}
async function detach(id) {
  const s = dialog?.state;
  const f = s?.files.find(x => x.drive_file_id === id);
  if (!s || s.busy || s.uploading || !f || taskFileLine.going(s.task.id)) return;
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
// FILE-첨부삭제 ②: [삭제]. The answers (taken off / put back) go to the list owner through accept(), even if this dialog was closed
// meanwhile (the [되돌리기] notice outlives it). A failure leaves the files as they were (the server put the Drive original back).
async function remove(id, button) {
  const s = dialog?.state;
  const f = s?.files.find(x => x.drive_file_id === id);
  if (!s || s.busy || s.uploading || !f || taskFileLine.going(s.task.id)) return;
  s.busy = true; status('');
  const changed = c => {
    if (!c || !s.isCurrent()) return;
    if (Array.isArray(c.task?.files)) accept(s, c.task);
    else { s.files = s.files.filter(x => x.drive_file_id !== id); accept(s, c.task); }
    if (dialog?.state === s) paint();
  };
  let result;
  try {
    result = await deleteAttachment({target: 'task', id: s.task.id, driveId: id, name: f.file_name}, {rt: s.rt, anchor: button, onChanged: changed, toast: text => { if (dialog?.state === s) status(text); }});
  } finally {
    if (dialog?.state === s) { s.busy = false; paint(); }
  }
  if (dialog?.state !== s || !s.isCurrent()) return;
  if (result.status === 'failed') status(`${f.file_name}: ${result.message}`, true);
  if (result.status === 'cancel') dialog.m.querySelector(`[data-gt-file-more="${CSS.escape(id)}"] > summary`)?.focus();
  else dialog.m.querySelector('[data-gt-files-pick]')?.focus();
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
// BIZ-저장먼저닫기 3차(S59-18): 할 일(글)이 저장되면 창은 바로 닫히고/입력칸은 바로 풀리고, 고른 파일은 이 할 일의 뒤 줄에서 하나씩 끝까지
// 올라간다(화면을 옮겨도 — 멈추는 것은 계정·작업공간이 바뀔 때뿐). 줄·대기 표시·끝 알림(하단바 위 한 줄)·[다시 올리기]는 노트·업데이트와 같은
// 공용 부품(basket-upload.js createAttachQueue·sendFilesBehind) 그대로이고 서버 길만 google-tasks attach다. 할 일 하나에 줄 하나: ⋯ [파일 붙이기]
// 창의 올리기도 같은 줄에 서서, 서버가 한 할 일의 메모 줄을 한 번에 한 파일씩 고친다. 파일은 그 탭 메모리에만 있다.
export const taskFileLine = createAttachQueue();
// 붙지 않은 것이 확실한 실패만 [다시 올리기]: 다 보내기 전에 멈춤·서버가 받고 거절함(4xx)·서버가 까닭을 말한 5xx(attach_result_unknown 말고 —
// 서버는 첨부 표에 넣은 뒤로는 그 코드만 쓴다, supabase/functions/google-tasks/task-files.ts attach). 나머지(답 없음·까닭 없는 5xx)는 붙었을 수 있어 다시 보내지 않는다.
const notSent = e => ['upload_not_sent', 'upload_timeout_sending', 'file_read_failed', 'session_required', 'task_file_problem'].includes(e?.code) || (e?.status >= 400 && e?.status < 500)
  || (e?.status >= 500 && typeof e?.serverCode === 'string' && e.serverCode !== 'attach_result_unknown');
const fileRows = list => list.map(f => ({drive_file_id: f.drive_file_id, file_name: String(f.file_name || '파일'), size_bytes: Number(f.size_bytes) || 0}));
/**
 * 할 일 하나에 붙일 파일을 그 할 일의 뒤 줄에 세운다(부른 곳은 기다리지 않고 창을 닫는다).
 * files: 새로 붙일 파일 · swaps: 수정 창 [교체]({from: 원래 파일(첨부 표에 있는 것) | null, file}) — 새 파일을 올린 뒤 원래 것을 빼고,
 * 10개가 차 있으면 원래 것을 먼저 뺀다(applyTaskAttachPlan과 같은 차례) · count: 지금 첨부 표의 파일 수(모르면 null — 서버가 한도를 본다).
 * 끝나면 kptu:task-files-sent {id, files, task, owner}(목록 주인이 파일 이름·메모를 맞춤)와 kptu:google-tasks-changed를 알린다.
 */
export function sendTaskFilesBehind({task, files = [], swaps = [], count = null, rt = window.KPTURuntime} = {}) {
  if (!task?.id || (!files.length && !swaps.length)) return Promise.resolve();
  const taskId = task.id, owner = ownerOf(rt);
  const batch = {note_id: taskId, attachments: [], blocked: null, count: Number.isFinite(count) ? count : null,
    entries: [...swaps.map(s => ({file: s.file, kind: 'pending', label: '대기', from: s.from?.drive_file_id ? s.from : null})), ...files.map(file => ({file, kind: 'pending', label: '대기'}))]};
  let latest = null;
  const kept = []; // 새 파일은 붙였지만 원래 파일을 빼지 못한 교체
  const take = d => { if (Array.isArray(d?.files)) { latest = {...latest, files: fileRows(d.files)}; batch.count = d.files.length; } if (d?.task) latest = {...latest, task: d.task}; };
  const off = async from => {
    try { take(await detachTaskFile(taskId, from.drive_file_id, {rt})); }
    catch (e) { if (e?.status !== 404) throw e; }
    if (batch.count != null) batch.count = Math.max(0, batch.count - 1);
  };
  return sendFilesBehind({line: taskFileLine, key: taskId, batch, rt, where: '할 일',
    send: async ({isCurrent, job}) => {
      let first = null;
      const mine = batch.entries.filter(entry => entry.kind !== 'success');
      for (const entry of mine) { const shown = job(entry.file); if (shown) shown.scope = 'task:' + taskId; } // 열린 [파일 붙이기] 창이 기다리는 줄도 그린다
      for (const entry of mine) {
        if (!isCurrent()) throw Object.assign(Error('로그인 계정이 바뀌었어요.'), {code: 'session_changed'});
        if (!batch.entries.includes(entry)) continue; // 앞 파일을 올리는 동안 ✕로 뺀 파일
        const file = entry.file, shown = job(file);
        entry.kind = 'uploading'; entry.label = '업로드 중'; entry.upFile = file;
        try {
          const problem = fileProblem(file, entry.from ? 0 : batch.count ?? 0); // 교체는 차 있으면 원래 것을 먼저 빼므로 개수 한도를 보지 않는다
          if (problem) throw Object.assign(Error(problem), {code: 'task_file_problem'});
          if (entry.from && batch.count != null && batch.count >= MAX_TASK_FILES) { await off(entry.from); entry.from = null; }
          const d = await attachTaskFile(taskId, file, {rt, job: shown});
          if (!d?.ok) throw Error('저장 결과를 확인하지 못했어요. 할 일을 다시 열어 확인해 주세요.');
          take(d); if (!Array.isArray(d.files) && batch.count != null) batch.count++;
          entry.kind = 'success'; entry.label = '완료'; entry.file = {name: file.name, size: file.size};
          if (entry.from) { const from = entry.from; entry.from = null; try { await off(from); } catch { kept.push(from); } }
        } catch (e) {
          if (e?.code === 'upload_cancelled') { const at = batch.entries.indexOf(entry); if (at >= 0) batch.entries.splice(at, 1); continue; }
          entry.kind = 'error'; entry.label = '실패';
          if (shown && shown.phase !== 'failed') shown.fail(message(e));
          first ||= e;
          // 결과를 알 수 없으면(붙었을 수 있음) 남은 파일도 보내지 않고 [다시 올리기]를 두지 않는다. 확실한 실패는 다음 파일로 이어 간다.
          if (!notSent(e)) { batch.blocked = e; break; }
        }
      }
      if (first) throw Object.assign(Error(message(first)), {code: first.code || 'task_attach_failed'});
    },
    finish: () => kept.length ? `원래 파일 ${kept.map(f => f.file_name).join(', ')}은(는) 빼지 못했어요. 할 일 ⋯ → 파일 붙이기에서 빼 주세요.` : '',
    done: () => {
      if (latest) filesArrived(taskId, latest);
      try {
        window.dispatchEvent(new CustomEvent('kptu:task-files-sent', {detail: {id: taskId, owner, files: latest?.files || null, task: latest?.task || null}}));
        window.KPTUGoogleTasks?.invalidateAfterCreate?.(); window.dispatchEvent(new CustomEvent('kptu:google-tasks-changed'));
      } catch { /* 화면 쪽 일이 끝 알림을 막지 않는다 */ }
    }});
}
// 줄은 메모리뿐이라 새로 고치면 남은 파일이 사라진다: 올리는 동안 [최신화]·당겨서 새로고침은 먼저 묻는다(노트·업데이트 줄과 같음).
if (typeof window !== 'undefined') window.addEventListener('kptu:before-reload', event => { if (event?.detail && taskFileLine.any()) event.detail.otherDraft = true; });

// The [📎 파일 붙이기] button and the chosen-file list inside an add window. Nothing is uploaded here; the window reads files()
// after its own save. hidden until show(true) (the table answered).
// CAL-일정첨부: 일정 창도 같은 고르기 칸을 쓴다(label·hint만 다르게: '+ 붙이기' · '사진 고르기 · 찍기 · 파일').
export function mountNewTaskFilePick(host, {isBusy = () => false, onError = () => {}, label = '파일 붙이기', hint = `${MAX_TASK_FILES}개까지 · 파일당 100MB`} = {}) {
  host.classList.add('gt-pick');
  host.hidden = true;
  host.innerHTML = `<div class="gt-pick-line"><button type="button" class="secondary gt-pick-btn" data-gt-pick><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M13.2 7.6 8.1 12.7a3.3 3.3 0 0 1-4.7-4.7l5.4-5.4a2.2 2.2 0 0 1 3.1 3.1l-5.4 5.4a1.1 1.1 0 0 1-1.6-1.6l5-5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>${esc(label)}</button><small class="gt-pick-hint">${esc(hint)}</small><input type="file" multiple hidden data-gt-pick-input></div><ul class="gt-pick-list" data-gt-pick-list></ul>`;
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
    take([...(e.dataTransfer.files || [])]);
  });
  // UPD-그림붙여넣기: Ctrl+V of a picture (or files) while the cursor is in this add window takes the same road as the drop.
  const take = added => {
    const problem = pickProblem(chosen, added);
    if (problem) { onError(problem); return; }
    if (!added.length) return;
    chosen = [...chosen, ...added]; onError(''); render();
  };
  bindPaste(host.closest('.modal-card, .modal, form') || host.parentElement || host, take, {key: 'new-task-files', canTake: () => !host.hidden && !host.hasAttribute('data-gt-pick-wait') && !isBusy(), taken: () => chosen.map(f => f.name)});
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
export function taskAttachHtml({base = [], edits = new Map(), added = [], editable = false, busy = false, taskId = '', auto = false} = {}) {
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
  const more = editable ? `<div class="gt-att-more">${btn('파일 붙이기', 'data-gt-att-add', '첨부 파일 붙이기', busy || keptCount(base, edits, added) >= MAX_TASK_FILES)}<small class="gt-att-hint">${changed ? (auto ? '잠시 뒤 저장됩니다 · 원래 파일은 Drive에 남습니다' : '저장하면 반영됩니다 · 원래 파일은 Drive에 남습니다') : `${MAX_TASK_FILES}개까지 · 파일당 100MB`}</small></div>` : '';
  return rows.join('') + fresh.join('') + more;
}

// TASK-첨부교체: the 첨부 rows of the edit window, with changes held until [저장]. Each file: name · [열기] [내려받기] [교체] [빼기];
// a task without files: 첨부 [파일 붙이기]. [교체] picks one file in place of that row (PC: drop a file on the row too); [빼기]
// marks the row; drops elsewhere in the box add files. Nothing goes to the server here: the owner (google-tasks.js) reads plan()
// at [저장] and sends the same attach / detach requests as ⋯ → 파일 붙이기. Closing the window (set() on the next open) forgets
// the changes. Detaching never deletes the Drive file. editable:false (no link table yet) keeps only [열기] [내려받기].
// S51-13: autoSave() true = the window saves by itself (할 일 '목록 | 상세' pane), so the hint says the change is saved shortly.
export function mountTaskAttach(host, {isBusy = () => false, onError = () => {}, onChange = () => {}, autoSave = () => false} = {}) {
  let base = [], editable = false, shown = false, edits = new Map(), added = [], swapFor = '', taskId = '';
  host.innerHTML = '<span class="gt-att-label">첨부</span><div class="gt-att-list" data-gt-att-list></div><input type="file" multiple hidden data-gt-att-add-input><input type="file" hidden data-gt-att-swap-input>';
  const list = host.querySelector('[data-gt-att-list]'), addInput = host.querySelector('[data-gt-att-add-input]'), swapInput = host.querySelector('[data-gt-att-swap-input]');
  const kept = () => keptCount(base, edits, added);
  const dirty = () => edits.size > 0 || added.length > 0;
  const changed = () => { onError(''); render(); onChange(); };
  function render() {
    host.classList.toggle('hidden', !shown || (!editable && !base.length));
    list.innerHTML = taskAttachHtml({base, edits, added, editable, busy: isBusy(), taskId, auto: !!autoSave()});
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
  // UPD-그림붙여넣기: a pasted picture while the cursor is in this edit window is added like a dropped file (never replaces a row).
  bindPaste(host.closest('.modal-card, .modal, form') || host.parentElement || host, files => addFiles(files), {key: 'task-attach', canTake: () => editable && shown && !isBusy(), taken: () => [...added.map(f => f.name), ...base.map(f => f.file_name)]});
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
    if (!d?.ok) throw Error('저장 결과를 확인하지 못했어요.');
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
      else { await up(file); try { await off(from); } catch (e) { failed.push({name: from.file_name, message: `새 파일은 붙였지만 원래 파일을 빼지 못했어요. ${message(e)}`}); } }
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
  return `할 일은 저장했어요. 첨부 ${result.failed.length}건(${names})을 바꾸지 못했어요: ${result.failed[0].message} 다시 해 주세요.`;
}
