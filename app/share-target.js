// APP-공유노트할일(요청함 11/02 00:22): 폰 공유 창 '웹2 노트'·'웹2 할 일'로 받은 것을 넣는 작은 창 하나(basket-share.js가 연다).
// 받기 길은 정리함과 같다(앱이 메모리에만 든 항목을 ./__share/<번호>/<순번>으로 흘려줌, basket-share.js receive). 들어갈 곳만 다르다.
// - 노트: 제목(첫 줄·링크 제목) · 폴더 고르기 · 한 줄 더하기 → [저장] = createNoteDoc(app_notes, 소유자 RLS) → 폴더 setNoteFolderRef →
//   창을 닫고 사진·파일은 그 노트의 뒤 줄(basket-upload.js sendNoteBehind → basket-files, 노트 첨부). 노트 화면과 같은 서버 길만 쓴다.
// - 할 일: 제목 · 기한 [오늘][내일][모레][다음주][기한 없음] · 한 줄 더하기 → [저장] = google-tasks action=create(quick-save.js) →
//   창을 닫고 파일은 그 할 일의 뒤 줄(task-files.js sendTaskFilesBehind → google-tasks action=attach). 할 일 화면과 같은 서버 길만 쓴다.
// 받은 글·파일 이름은 외부 입력이라 textContent·value로만 넣는다(HTML로 넣지 않음). 기기에는 아무것도 저장하지 않는다.
// 창은 <dialog>(뒤로가기·Esc·× = 닫기, 저장 중에는 닫지 않음). 닫으면 앱에 끝났다고 알려 앱이 든 항목을 버린다.
import {noteDraft, noteBodyWithExtra, taskDraft, taskNotesWithExtra, folderOptions, NOTE_TITLE_MAX, TASK_TITLE_MAX, EXTRA_MAX} from './share-target-model.mjs';
import {shareSummary, skippedText} from './share-intake-model.mjs';
import {QUICK_DUES, quickDueDay, nextWeekDays, weekdayLabel, newTaskDue} from './task-due.mjs';
import {notify} from './small-notice.js';

let dialog = null, state = null, seq = 0, layer = null;
const $ = sel => dialog.querySelector(sel);
const WORDS = {note:{title:'웹2 노트', saved:'노트에 넣었어요'}, task:{title:'웹2 할 일', saved:'할 일에 넣었어요'}};

function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'shareTargetDialog';
  dialog.className = 'share-target-dialog';
  dialog.setAttribute('aria-labelledby', 'shareTargetTitle');
  dialog.innerHTML = `<header class="share-target-head"><h2 id="shareTargetTitle"></h2><button type="button" class="icon-btn" data-st-close aria-label="닫기">×</button></header>
<div class="share-target-body"><input type="text" data-st-title aria-label="제목" autocomplete="off">
<select data-st-folder aria-label="폴더" hidden><option value="">폴더 밖</option></select>
<div class="share-target-dues" data-st-dues role="group" aria-label="기한" hidden></div>
<div class="share-target-dues share-target-week" data-st-week role="group" aria-label="다음 주 날짜" hidden></div>
<input type="text" data-st-extra maxlength="${EXTRA_MAX}" aria-label="한 줄 더하기" placeholder="한 줄 더하기 (선택)" autocomplete="off">
<p class="share-target-what" data-st-what></p></div>
<footer class="share-target-foot"><p class="status" data-st-status role="status" aria-live="polite"></p><button type="button" class="primary" data-st-save>저장</button></footer>`;
  document.body.append(dialog);
  dialog.addEventListener('cancel', e => { e.preventDefault(); if (!state?.saving) close(); });
  dialog.addEventListener('click', e => {
    if (e.target === dialog || e.target.closest('[data-st-close]')) { if (!state?.saving) close(); return; }
    const due = e.target.closest('[data-st-due]');
    if (due) return pickDue(due.dataset.stDue);
    const day = e.target.closest('[data-st-day]');
    if (day) { if (state && !state.saving) { state.due = day.dataset.stDay; state.week = false; paintDues(); } return; }
    if (e.target.closest('[data-st-save]')) void save();
  });
  dialog.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing && e.target.matches?.('input[type="text"]')) { e.preventDefault(); void save(); }
  });
  return dialog;
}

const say = (text, error = false) => { const el = $('[data-st-status]'); el.textContent = text || ''; el.className = 'status' + (error ? ' error' : ''); };
function dropLayer() { const l = layer; layer = null; l?.close(); }
function close() {
  dropLayer();
  if (dialog?.open) dialog.close();
  const s = state;
  state = null;
  try { s?.release?.(); } catch { /* 앱 다리가 사라진 화면: 앱이 끝날 때 버린다. */ }
}

function button(label, attrs) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mini secondary';
  b.textContent = label;
  for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
  return b;
}

function paintDues() {
  const box = $('[data-st-dues]'), week = $('[data-st-week]');
  const due = state?.due || '';
  const today = quickDueDay(0);
  const quick = ['0', '1', '2'].map(k => quickDueDay(k, today));
  const weekDay = !!due && !quick.includes(due);
  box.replaceChildren(...QUICK_DUES.map(([key, label]) => {
    const pressed = key === 'week' ? (!!state?.week || weekDay) : key === '' ? !due && !state?.week : !state?.week && due === quickDueDay(key, today);
    return button(key === 'week' && weekDay ? weekdayLabel(due) : label, {'data-st-due':key, 'aria-pressed':String(!!pressed)});
  }));
  week.hidden = !state?.week;
  if (state?.week) week.replaceChildren(...nextWeekDays(today).map(d => button(d.label, {'data-st-day':d.day, 'aria-pressed':String(d.day === due)})));
}

function pickDue(key) {
  if (!state || state.saving) return;
  if (key === 'week') { state.week = !state.week; paintDues(); return; }
  state.week = false;
  state.due = key === '' ? '' : quickDueDay(key);
  paintDues();
}

async function paintFolders() {
  const select = $('[data-st-folder]'), run = state?.run;
  try {
    const {loadNoteFolders} = await import('./note-folder-pick.js');
    const {folders} = await loadNoteFolders();
    if (!state || state.run !== run) return;
    state.folders = folders;
    const options = folderOptions(folders).map(f => {
      const o = document.createElement('option');
      o.value = f.id;
      o.textContent = `${'  '.repeat(Math.min(f.depth, 8))}${f.name}`;
      return o;
    });
    const out = document.createElement('option');
    out.value = '';
    out.textContent = '폴더 밖';
    select.replaceChildren(out, ...options);
    select.hidden = !options.length;
  } catch {
    if (state?.run === run) select.hidden = true;
  }
}

/**
 * 공유 하나를 창으로 연다. share = {target:'note'|'task', subject, text, items(넣을 파일 목록), skipped}.
 * receive() → {out:File[], failed, large, empty} (한 번만 부른다), release() = 앱에 끝났다고 알림, isCurrent() = 같은 로그인인가.
 */
export function openShareTarget({target, subject = '', text = '', items = [], skipped = {}, receive, release, isCurrent = () => true}) {
  ensureDialog();
  if (state) close();
  const kind = target === 'task' ? 'task' : 'note';
  const draft = kind === 'note' ? noteDraft({subject, text, files:items}) : taskDraft({subject, text, files:items});
  state = {kind, draft, receive, release, isCurrent, run:++seq, saving:false, files:null, got:null, due:kind === 'task' ? newTaskDue('') : '', week:false, folders:[], made:null};
  $('#shareTargetTitle').textContent = WORDS[kind].title;
  const title = $('[data-st-title]');
  title.maxLength = kind === 'note' ? NOTE_TITLE_MAX : TASK_TITLE_MAX;
  title.placeholder = kind === 'note' ? '노트 제목' : '할 일';
  title.value = draft.title;
  $('[data-st-extra]').value = '';
  const what = [shareSummary({items, text, subject}), skippedText(skipped)].filter(Boolean).join(' · ');
  $('[data-st-what]').textContent = what;
  const folder = $('[data-st-folder]');
  folder.hidden = true;
  $('[data-st-dues]').hidden = kind !== 'task';
  $('[data-st-week]').hidden = true;
  if (kind === 'task') paintDues();
  const btn = $('[data-st-save]');
  btn.disabled = false;
  btn.removeAttribute('aria-busy');
  say('');
  if (!dialog.open) dialog.showModal();
  if (!layer) layer = window.KPTURouter?.layer?.open('share-target', {close:() => { if (state?.saving) return false; layer = null; close(); return true; }}) || null;
  if (kind === 'note') void paintFolders();
  title.focus({preventScroll:true});
}

// 앱이 흘려주는 파일을 한 번만 받는다(앱은 다 열리면 번호를 버린다). 받은 File은 이 창 메모리에만 있다.
async function filesOf(s) {
  if (s.files) return s.files;
  const got = s.receive ? await s.receive() : {out:[], failed:0, large:0, empty:0};
  s.got = got;
  s.files = got.out || [];
  return s.files;
}

function lostText(s) {
  const g = s.got || {};
  return skippedText({failed:g.failed, large:g.large, empty:g.empty});
}

async function saveNote(s, title, extra) {
  const [{createNoteDoc, setNoteFolderRef}, {createUploadBatch, sendNoteBehind}] = await Promise.all([import('./basket-data.js'), import('./basket-upload.js')]);
  const files = await filesOf(s);
  if (!s.isCurrent()) throw new Error('로그인 계정이 바뀌어 넣지 않았어요. 다시 공유해 주세요.');
  const notes = [];
  if (!s.made) s.made = await createNoteDoc({title, raw_text:noteBodyWithExtra(s.draft.body, extra)});
  const row = s.made;
  if (!row?.id) throw new Error('저장한 노트를 확인하지 못했어요.');
  const folderId = $('[data-st-folder]').hidden ? '' : $('[data-st-folder]').value;
  const folder = folderId ? s.folders.find(f => f.id === folderId) : null;
  if (folder) { try { await setNoteFolderRef(row, folder); } catch { notes.push('폴더에는 넣지 못했어요(폴더 밖에 있어요).'); } }
  // BIZ-저장먼저닫기 2차(S59-8): 노트(글)가 저장되면 창을 닫는다. 받은 사진·파일은 그 노트의 뒤 줄에서 끝까지 올라간다(화면을 옮겨도 —
  // 끝·못 올림은 하단바 위 한 줄, 못 올린 것은 [다시 올리기]). 받은 파일은 이 탭 메모리에만 있다.
  if (files.length) {
    const batch = createUploadBatch();
    batch.entries = files.map(file => ({file, kind:'pending', label:'대기'}));
    void sendNoteBehind(row.id, batch);
    s.sending = true;
  }
  window.dispatchEvent(new CustomEvent('kptu:basket-note-created'));
  return notes;
}

async function saveTask(s, title, extra) {
  const [{createGoogleTask}, taskFiles] = await Promise.all([import('./quick-save.js'), import('./task-files.js')]);
  const files = await filesOf(s);
  if (!s.isCurrent()) throw new Error('로그인 계정이 바뀌어 넣지 않았어요. 다시 공유해 주세요.');
  const notes = [];
  if (!s.made) {
    const data = await createGoogleTask({title, notes:taskNotesWithExtra(s.draft.notes, extra), due:s.due || null});
    if (data?.ok === false || typeof data?.task?.id !== 'string' || !data.task.id) throw new Error('할 일 저장 결과를 확인하지 못했어요. 할 일 화면에서 확인해 주세요.');
    s.made = data.task;
  }
  // BIZ-저장먼저닫기 3차(S59-18): 할 일(글)이 저장되면 창을 닫는다. 받은 사진·파일은 그 할 일의 뒤 줄에서 끝까지 올라간다(화면을 옮겨도 —
  // 진행·끝·못 올림·[다시 올리기]는 하단바 위 한 줄 하나라, 그때는 위쪽 '할 일에 넣었어요' 알림을 띄우지 않는다).
  if (files.length) {
    if (await taskFiles.taskFilesAvailable()) {
      void taskFiles.sendTaskFilesBehind({task:s.made, files, count:0});
      s.sending = true;
    } else notes.push('파일은 붙이지 못했어요. 할 일 ⋯ → 파일 붙이기에서 다시 붙여 주세요.');
  }
  window.dispatchEvent(new CustomEvent('kptu:tasks-changed'));
  return notes;
}

async function save() {
  const s = state;
  if (!s || s.saving) return;
  const title = $('[data-st-title]').value.replace(/\s+/g, ' ').trim();
  const extra = $('[data-st-extra]').value;
  if (!title) { say(s.kind === 'note' ? '노트 제목을 입력해 주세요.' : '할 일을 입력해 주세요.', true); $('[data-st-title]').focus(); return; }
  const btn = $('[data-st-save]');
  s.saving = true; btn.disabled = true; btn.setAttribute('aria-busy', 'true'); say('저장 중…');
  let notes;
  try {
    notes = s.kind === 'note' ? await saveNote(s, title, extra) : await saveTask(s, title, extra);
  } catch (e) {
    if (state === s) { s.saving = false; btn.disabled = false; btn.removeAttribute('aria-busy'); say(e?.message || '저장하지 못했어요.', true); }
    return;
  }
  const lost = lostText(s);
  if (state === s) { s.saving = false; close(); }
  // UX-알림하나로(S59-21): 사진·파일을 올리는 진행·끝은 하단바 위 한 줄 하나가 말한다(여기서 '올리는 중이에요'를 또 쓰지 않는다).
  if (s.sending && !notes.length && !lost) return;
  notify(WORDS[s.kind].saved, {note:[...notes, lost].filter(Boolean).join(' '), ms:notes.length || lost ? 12000 : 5000});
}
