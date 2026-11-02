// APP-공유노트할일(앱 0.4.8, 요청함 11/02 00:22): 폰 공유 창의 '웹2 노트'·'웹2 할 일'로 들어온 것을 넣는 작은 저장 창 하나.
// 받기는 basket-share.js가 정리함과 같은 길(KPTUAppShell 목록 + ./__share/<번호>/<순번>, 메모리에만)로 하고, 받은 글·파일을 이 창에 넘긴다.
// - 노트: 제목 = 첫 줄 또는 링크 제목, 본문 = [한 줄 더하기] + 받은 글, 사진·파일 = 노트 첨부. [폴더 ▾]로 넣을 폴더를 고른 뒤 [저장].
//   저장은 노트의 기존 길만 쓴다: createNoteDoc(app_notes, 주인 RLS) → 폴더(note-folder-pick put) → 첨부(uploadNoteFiles = basket-files).
// - 할 일: 제목 = 받은 글(또는 링크 제목, 고칠 수 있음), 링크 = 메모, 파일 = 할 일 첨부(10개까지). 기한 [오늘][내일][모레][다음주][기한 없음] 뒤 [저장].
//   저장은 할 일의 기존 길만 쓴다: createGoogleTask(google-tasks 함수) → attachNewTaskFiles(할 일 첨부 표가 답할 때만).
// 받은 글·파일은 외부 입력이다: 글자로만 넣고(textContent·value), 화면 HTML로 그리지 않는다. 폰·브라우저 저장소에 남기지 않는다.
// 창을 닫으면 아무것도 저장하지 않는다(앱은 이미 받은 항목을 버렸으므로 다시 공유해야 한다).
import {shareNoteDraft, shareTaskDraft, shareTaskFiles, shareSummary} from './share-intake-model.mjs';
import {QUICK_DUES, quickDueDay, weekdayLabel} from './task-due.mjs';
import {notify} from './small-notice.js';

const ID = 'shareTargetModal';
const LABEL = {note:'노트에 넣기', task:'할 일에 넣기'};
const SAVED = {note:'노트에 넣었어요', task:'할 일에 넣었어요'};

function ensureStyles() {
  const have = [...document.querySelectorAll('link[rel="stylesheet"]')].some(l => (l.getAttribute('href') || '').split('?')[0].endsWith('share-target.css'));
  if (have) return;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = './share-target.css'; link.dataset.kptuViewStyle = '1'; document.head.append(link);
}

let current = null;

function ensureModal() {
  let modal = document.getElementById(ID);
  if (modal) return modal;
  document.body.insertAdjacentHTML('beforeend', `<div id="${ID}" class="modal hidden share-target" data-kptu-history-all="1" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="shareTargetTitle"><div class="modal-card small-card share-target-card"><div class="modal-head"><h2 id="shareTargetTitle"></h2><button type="button" class="icon-btn" data-close="${ID}" data-st-close aria-label="닫기">×</button></div><p class="share-target-what" data-st-what></p><div class="share-target-note" data-st-note-row hidden><input type="text" data-st-line maxlength="500" enterkeyhint="done" placeholder="한 줄 더하기(선택)" aria-label="한 줄 더하기"><button type="button" class="ghost share-target-folder" data-st-folder aria-haspopup="dialog">폴더 없음 ▾</button></div><div class="share-target-task" data-st-task-row hidden><input type="text" data-st-title maxlength="1024" enterkeyhint="done" aria-label="할 일 제목"><div class="share-target-dues" role="group" aria-label="기한">${QUICK_DUES.map(([key, label]) => `<button type="button" class="ghost" data-st-due="${key}" aria-pressed="false">${label}</button>`).join('')}</div></div><div class="modal-action-footer"><div class="status" data-st-status role="status"></div><button type="button" class="primary" data-st-save>저장</button></div></div></div>`);
  modal = document.getElementById(ID);
  modal.querySelector('[data-st-close]').addEventListener('click', () => close());
  modal.querySelector('[data-st-save]').addEventListener('click', () => void save());
  modal.querySelector('[data-st-folder]').addEventListener('click', event => { const c = current; if (c?.folder && !c.saving) void c.folder.open(event.currentTarget); });
  modal.querySelectorAll('[data-st-due]').forEach(button => button.addEventListener('click', () => pickDue(button)));
  for (const field of modal.querySelectorAll('[data-st-line],[data-st-title]')) {
    field.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); void save(); } });
  }
  return modal;
}

function pickDue(button) {
  const c = current;
  if (!c || c.saving || c.target !== 'task') return;
  const key = button.dataset.stDue;
  if (key === 'week') {
    void import('./task-week-pick.js').then(({openWeekPick}) => openWeekPick(button, {selected:c.dueKind === 'week' ? c.due : '', onPick:day => { if (current !== c || c.saving) return; c.due = day; c.dueKind = 'week'; paint(); }}));
    return;
  }
  c.due = key === '' ? null : quickDueDay(key);
  c.dueKind = key;
  paint();
}

function paint() {
  const c = current, modal = document.getElementById(ID);
  if (!c || !modal) return;
  modal.querySelector('#shareTargetTitle').textContent = LABEL[c.target];
  modal.querySelector('[data-st-note-row]').hidden = c.target !== 'note';
  modal.querySelector('[data-st-task-row]').hidden = c.target !== 'task';
  const items = c.files.map(f => ({type:f.type || '', size:f.size || 0, name:f.name}));
  const what = [c.target === 'note' ? shareNoteDraft({subject:c.subject, text:c.text, items}).title : '', shareSummary({items, text:c.text, subject:c.subject})].filter(Boolean);
  modal.querySelector('[data-st-what]').textContent = what.join(' · ');
  const folder = modal.querySelector('[data-st-folder]');
  folder.textContent = `${c.folder?.label?.() || '폴더 없음'} ▾`;
  modal.querySelectorAll('[data-st-due]').forEach(b => {
    const on = b.dataset.stDue === c.dueKind;
    b.setAttribute('aria-pressed', String(on));
    if (b.dataset.stDue === 'week') b.textContent = on && c.due ? weekdayLabel(c.due) : '다음주';
  });
  modal.querySelectorAll('button,input').forEach(el => { if (!el.matches('[data-st-close]')) el.disabled = c.saving || c.locked; });
  modal.querySelector('[data-st-status]').textContent = c.status || c.skipped || '';
}

/**
 * 받은 공유를 노트·할 일 저장 창으로 연다. owner·scope: 연 때의 로그인(사용자:작업공간)과 지금 것을 읽는 함수(바뀌면 저장하지 않음).
 * status: 받다가 뺀 것 한 줄(basket-share.js skippedText).
 */
export function openShareTarget({target, subject = '', text = '', files = [], status = '', owner = '', scope = () => owner, rt = window.KPTURuntime}) {
  if (target !== 'note' && target !== 'task') return false;
  ensureStyles();
  if (current?.folder) current.folder.close?.();
  const modal = ensureModal();
  const c = current = {target, subject, text, files:Array.from(files), skipped:status, status:'', owner, scope, rt, saving:false, locked:false, due:null, dueKind:'', folder:null, task:null};
  modal.querySelector('[data-st-line]').value = '';
  const items = c.files.map(f => ({name:f.name}));
  modal.querySelector('[data-st-title]').value = target === 'task' ? shareTaskDraft({subject, text, items}).auto : '';
  if (target === 'note') {
    void import('./note-folder-pick.js').then(({createNoteFolderPick, lastViewedFolder}) => {
      if (current !== c) return;
      c.folder = createNoteFolderPick({rt, initial:lastViewedFolder(), onChange:() => { if (current === c) paint(); }});
      void c.folder.load();
      paint();
    }).catch(() => { /* 폴더를 못 읽어도 폴더 없이 저장한다. */ });
  }
  paint();
  modal.classList.remove('hidden'); modal.setAttribute('aria-hidden', 'false');
  window.KPTUA11y?.dialog?.activate?.(modal, {trigger:document.activeElement, initialFocus:target === 'task' ? '[data-st-title]' : '[data-st-line]', onRequestClose:close});
  return true;
}

export function close() {
  const modal = document.getElementById(ID), c = current;
  if (c?.saving) return;
  c?.folder?.close?.();
  current = null;
  if (!modal || modal.classList.contains('hidden')) return;
  modal.classList.add('hidden'); modal.setAttribute('aria-hidden', 'true');
  window.KPTUA11y?.dialog?.deactivate?.(modal, {restoreFocus:true});
}

function finish(c, message, note = '') {
  c.saving = false;
  if (current === c) close();
  notify(message, {ms:6000, note, error:false});
}

async function save() {
  const c = current;
  if (!c || c.saving || c.locked) return;
  if (c.scope() !== c.owner) { c.status = '로그인 계정이 바뀌어 넣지 않았어요. 다시 공유해 주세요.'; c.locked = true; paint(); return; }
  c.saving = true; c.status = '저장하는 중'; paint();
  try {
    if (c.target === 'note') await saveNote(c);
    else await saveTask(c);
  } catch (error) {
    c.saving = false;
    c.status = error?.message || '저장하지 못했어요. 다시 저장해 주세요.';
    if (current === c) { paint(); error?.focus?.focus?.(); }
  }
}

async function saveNote(c) {
  const modal = document.getElementById(ID);
  const draft = shareNoteDraft({subject:c.subject, text:c.text, items:c.files.map(f => ({name:f.name})), extra:modal.querySelector('[data-st-line]').value});
  if (!draft.title && !draft.raw_text && !c.files.length) throw new Error('넣을 내용이 없어요.');
  const [{createNoteDoc}, {createUploadBatch, uploadNoteFiles}] = await Promise.all([import('./basket-data.js'), import('./basket-upload.js')]);
  if (c.scope() !== c.owner) throw new Error('로그인 계정이 바뀌어 넣지 않았어요.');
  const note = await createNoteDoc({title:draft.title || '새 노트', raw_text:draft.raw_text, markdown:false}, c.rt);
  // 노트가 생긴 뒤의 실패는 노트를 다시 만들지 않는다(두 번 넣지 않음): 저장한 것과 못 한 것을 한 줄로 알리고 닫는다.
  c.locked = true;
  const left = [];
  try { await c.folder?.put?.(note); } catch { left.push('폴더에 넣지 못했어요(폴더 없음에 있어요).'); }
  if (c.files.length) {
    const batch = createUploadBatch();
    batch.entries = c.files.map(file => ({file, kind:'pending', label:'대기'}));
    try { await uploadNoteFiles(note.id, batch, {rt:c.rt, isCurrent:() => c.scope() === c.owner}); }
    catch (error) { left.push(`첨부를 올리지 못했어요. ${error?.message || ''}`.trim()); }
  }
  if (draft.cut) left.push('글이 길어 100,000자까지만 넣었어요.');
  window.dispatchEvent(new CustomEvent('kptu:basket-notes-restored'));
  finish(c, left.length ? '노트는 넣었어요. 아래를 확인해 주세요.' : SAVED.note, [c.skipped, ...left].filter(Boolean).join(' '));
}

async function saveTask(c) {
  const modal = document.getElementById(ID);
  const typed = modal.querySelector('[data-st-title]').value;
  const draft = shareTaskDraft({subject:c.subject, text:c.text, items:c.files.map(f => ({name:f.name})), title:typed});
  if (!draft.title) { const field = modal.querySelector('[data-st-title]'); throw Object.assign(new Error('할 일 제목을 입력해 주세요.'), {focus:field}); }
  const {keep, over} = shareTaskFiles(c.files);
  const [{createGoogleTask}, files] = await Promise.all([import('./quick-save.js'), import('./task-files.js')]);
  if (c.scope() !== c.owner) throw new Error('로그인 계정이 바뀌어 넣지 않았어요.');
  if (!c.task) {
    let result;
    try { result = await createGoogleTask({title:draft.title, due:c.due || null, notes:draft.notes, links:[], expectedSessionEpoch:c.rt.session.epoch()}, c.rt); }
    catch (error) {
      // 서버가 답하지 않았으면 만들어졌는지 모른다: 두 번 만들지 않도록 [저장]을 막고 할 일 목록에서 확인하게 한다.
      const status = Number(error?.status) || 0;
      if (!status || status >= 500) { c.locked = true; throw new Error('저장 결과를 확인하지 못했어요. 할 일 목록에서 확인해 주세요.'); }
      if (/연결되지|TASKS_SCOPE|다시 연결/.test(String(error?.message || ''))) throw new Error('구글 할 일 연결이 필요해요. 할 일 화면에서 연결해 주세요.');
      throw error;
    }
    if (result?.ok !== true || !result.task?.id) { c.locked = true; throw new Error('저장 결과를 확인하지 못했어요. 할 일 목록에서 확인해 주세요.'); }
    c.task = result.task;
  }
  c.locked = true;
  const left = [];
  if (keep.length) {
    if (await files.taskFilesAvailable({rt:c.rt})) {
      const result = await files.attachNewTaskFiles(c.task.id, keep, {rt:c.rt});
      const line = files.newTaskFilesNotice(result);
      if (line) left.push(line);
    } else left.push('파일은 붙이지 못했어요(할 일 첨부를 지금 쓸 수 없어요).');
  }
  if (over) left.push(`할 일에는 파일을 ${keep.length}개까지 붙여요 · ${over}개는 뺐어요.`);
  window.KPTUGoogleTasks?.invalidateAfterCreate?.();
  window.dispatchEvent(new CustomEvent('kptu:google-tasks-changed'));
  finish(c, left.length ? '할 일은 넣었어요. 아래를 확인해 주세요.' : SAVED.task, [c.skipped, ...left].filter(Boolean).join(' '));
}
