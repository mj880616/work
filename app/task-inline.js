// TASK-바로처리통일 (2026-10-23 사용자 결정 00:06): the one shared part behind every task line that can be handled in place —
// 업무일지 할 일 / 한 일 (journal.js), 홈 오늘 할 일·회의 후속 (home-read.js), 담당조직·프로젝트 상세의 연결된 할 일 (google-tasks.js
// mountLinked), 달력 날짜 목록 (calendar-tasks.js). It was JOURNAL-할일바로처리 (#1006) inside journal.js, lifted here unchanged in
// behavior so no screen keeps its own copy.
//   circle  → complete with the task screen's own KPTUGoogleTasks.toggleTask (one request); a 5-second '…을 끝냈어요 [되돌리기]'
//             (offerUndoNotice) undoes it with the same toggle; a failed save puts the line back and says so in the toast.
//             A finished line's circle reopens it.
//   ⋯       → the shared anchored menu (right-click opens the same menu, context-menu.js): pending [내일로 · 기한 바꾸기 · 고치기 ·
//             (the screen's own items) · 지우기], finished [다시 할 일로 · 고치기 · (the screen's own items)].
//   내일로·기한 바꾸기 → the editor's own google-tasks action=update with the task's title and notes (task-due.mjs moveTaskToDay);
//             기한 바꾸기 opens a small date box under the ⋯ (the device's own calendar), [바꾸기] saves.
//   고치기   → the task screen's editor window (KPTUGoogleTasks.openEditor), unless the screen gives its own way to open it.
//   지우기   → one confirmation, then KPTUGoogleTasks.deleteTask.
// State stays with each screen: the screen passes find(id, el) to read its own task and optional hooks to draw its own change
// (apply / saved / removed); this module keeps only which tasks are being saved now (in memory) and nothing in browser storage.
import {createAnchoredMenu} from './anchored-menu.js';
import {offerUndoNotice} from './basket-record-delete.js';
import {placeAnchored, followAnchor} from './anchored-popup.js';
import {moveTaskToDay, tomorrowKey, dueDay, shortDay} from './task-due.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const tasksApi = () => window.KPTUGoogleTasks;
// A list inside an open dialog keeps its menu and date box inside that dialog (its focus loop and outside-press rules).
const dialogOf = el => el?.closest?.('.modal[aria-modal="true"]:not(.hidden)') || document.body;
const ownerNow = () => window.KPTURuntime?.session?.read?.()?.user?.id || '';
export function toast(text) {
  const box = document.querySelector('#toast');
  if (!box) return;
  box.textContent = text; box.classList.remove('hidden');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => box.classList.add('hidden'), 3200);
}
// 을/를 by the last Hangul letter of the name (other endings: 을(를)).
export function objectParticle(name) {
  const last = [...String(name)].pop() || '', code = last.charCodeAt(0);
  if (code >= 0xAC00 && code <= 0xD7A3) return (code - 0xAC00) % 28 ? '을' : '를';
  return '을(를)';
}
export const shortName = name => { const chars = [...String(name || '(제목 없음)')]; return chars.length > 24 ? chars.slice(0, 24).join('') + '…' : chars.join(''); };
// The ⋯ of one line. attr is the screen's own data attribute (camelCase dataset name → data-… in HTML).
const dataName = attr => attr.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
export function moreButtonHtml({id, name, attr, menuId, className = ''}) {
  return `<button type="button" class="task-inline-more${className ? ' ' + className : ''}" data-${dataName(attr)}="${esc(id)}" aria-label="${esc(name || '(제목 없음)')} 더 보기" aria-haspopup="true" aria-expanded="false" aria-controls="${esc(menuId)}"><span aria-hidden="true">⋯</span></button>`;
}

// ── 기한 바꾸기: one small date box at a time, under the ⋯ that asked for it ──
let duePopup = null;
function closeDue({focus = true} = {}) {
  const open = duePopup;
  if (!open) return;
  duePopup = null; open.stop(); open.off();
  try { open.panel.hidePopover?.(); } catch { /* not shown as a popover */ }
  open.panel.remove();
  if (focus && open.anchor.isConnected) open.anchor.focus({preventScroll:true});
}
function openDue(anchor, {name, value, onPick}) {
  closeDue({focus:false});
  const host = dialogOf(anchor);
  const panel = document.createElement('div');
  panel.id = 'taskDuePopup'; panel.className = 'task-due-popup'; panel.setAttribute('role', 'group'); panel.setAttribute('aria-label', `${name} 기한 바꾸기`);
  panel.innerHTML = `<form class="task-due-form" data-task-due-form><input type="date" class="task-due-input" data-task-due-input value="${esc(value)}" aria-label="${esc(name)} 새 기한"><button type="submit" class="mini">바꾸기</button><button type="button" class="mini" data-task-due-cancel>취소</button></form>`;
  const popover = typeof panel.showPopover === 'function' && 'popover' in panel;
  if (popover) panel.setAttribute('popover', 'manual');
  host.append(panel);
  if (popover) { try { panel.showPopover(); } catch { panel.removeAttribute('popover'); } }
  const place = () => placeAnchored(panel, anchor, {maxWidth:280, maxHeight:120, minHeight:48});
  place();
  const form = panel.querySelector('form'), input = panel.querySelector('input');
  form.addEventListener('submit', event => { event.preventDefault(); const day = input.value; if (!day) return; closeDue(); onPick(day); });
  panel.querySelector('[data-task-due-cancel]').addEventListener('click', () => closeDue());
  const onKey = event => { if (event.key === 'Escape' && !event.isComposing && duePopup?.panel === panel) { event.preventDefault(); event.stopImmediatePropagation(); closeDue(); } };
  const onDown = event => { if (duePopup?.panel === panel && !panel.contains(event.target) && !anchor.contains(event.target)) closeDue({focus:false}); };
  document.addEventListener('keydown', onKey, true); document.addEventListener('pointerdown', onDown, true);
  const off = () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onDown, true); };
  duePopup = {panel, anchor, off, stop:followAnchor(panel, anchor, {place, lost:() => closeDue({focus:false})})};
  input.focus({preventScroll:true});
  try { input.showPicker?.(); } catch { /* the box itself still works */ }
}
window.addEventListener('kptu:session-changed', () => closeDue({focus:false}));

// One screen's line handling. Options:
//   menuId, historyKey, parent  the anchored menu (one per screen; by default it sits in the open dialog the line is in, else the page)
//   menuAttr                    the screen's dataset name on its ⋯ (e.g. 'journalTaskMenu')
//   find(id, el)                the task as the screen holds it (el = the pressed circle or ⋯)
//   extras(task, el)            the screen's own menu items: [{key, label, danger, run}]
//   edit(id, task, el)          open the editor the screen's way (default: KPTUGoogleTasks.openEditor)
//   begin(id) / end(id)         around every save (the screen may redraw busy lines or ignore its own change event)
//   apply(id, done, original)   draw the new completion at once; done === null puts the original back after a failure; screens whose list is
//                               drawn by google-tasks.js itself (home, linked lists) leave it out
//   saved(id, task)             the due date was saved; removed(id) the task was deleted
//   reopenedText(task)          the toast after ⋯ [다시 할 일로]
export function createTaskInline({menuId, historyKey, parent = dialogOf, menuAttr, find, extras = () => [], edit, begin, end, apply, saved, removed,
  reopenedText = () => '다시 할 일로 돌려놨어요.'} = {}) {
  // Saves under way per task (a count: the circle may be pressed again while the first toggle is still saving — toggleTask keeps
  // only the last wish — but 내일로·기한 바꾸기·지우기 wait until nothing is being saved for that task).
  const busy = new Map();
  const look = (id, el) => find(id, el) || null;
  const base = (id, task) => tasksApi()?.taskState?.(id)?.task || task;
  const start = id => { busy.set(id, (busy.get(id) || 0) + 1); begin?.(id); };
  const stop = id => { const n = (busy.get(id) || 1) - 1; if (n) busy.set(id, n); else busy.delete(id); end?.(id); };
  const missing = () => { toast('할 일 기능을 아직 불러오는 중이에요. 잠시 뒤 다시 눌러 주세요.'); return null; };
  async function setDone(id, done, {el = null, undo = true, viaMenu = false} = {}) {
    const task = look(id, el), api = tasksApi() || missing();
    if (!task || !api?.toggleTask) return;
    const owner = ownerNow(), name = shortName(task.title);
    start(id); apply?.(id, done, task);
    let result;
    try { result = await api.toggleTask({...base(id, task), status:done ? 'needsAction' : 'completed'}); } catch { result = {ok:false}; }
    finally { stop(id); }
    if (owner !== ownerNow()) return;
    if (result?.ok !== true) {
      apply?.(id, null, task);
      toast(result?.message || (done ? '완료를 저장하지 못해 되돌렸어요.' : '다시 할 일로 돌리지 못했어요.'));
      return;
    }
    // Pressed again meanwhile (the other way): no notice for a change that is no longer what the line shows.
    const now = look(id, el);
    if (now && (now.status === 'completed') !== done) return true;
    if (done && undo) {
      offerUndoNotice({text:`'${name}'${objectParticle(name)} 끝냈어요.`, onUndo:async () => {
        const again = look(id, el);
        if (owner !== ownerNow() || !again || again.status !== 'completed') return {status:'stale'};
        const ok = await setDone(id, false, {el, undo:false});
        return ok ? {status:'restored', message:'다시 할 일로 돌려놨어요.'} : {status:'failed', message:'되돌리지 못했어요.'};
      }});
    } else if (!done && viaMenu) toast(reopenedText(task));
    return true;
  }
  async function moveDue(id, day, el = null) {
    const task = look(id, el), api = tasksApi();
    if (!task || busy.has(id) || day === dueDay(task)) return;
    const owner = ownerNow(), name = shortName(task.title);
    start(id);
    try {
      const next = await moveTaskToDay(base(id, task), day, window.KPTURuntime);
      if (owner !== ownerNow()) return;
      saved?.(id, next);
      // The task screen's copy, the linked lists and every listening screen follow (google-tasks.js taskSaved).
      if (api?.taskSaved) api.taskSaved(next); else window.dispatchEvent(new CustomEvent('kptu:google-tasks-changed'));
      toast(day === tomorrowKey() ? `'${name}' 기한을 내일로 옮겼어요.` : `'${name}' 기한을 ${shortDay(day)}로 바꿨어요.`);
    } catch (error) {
      if (owner !== ownerNow()) return;
      toast(error?.message && !error.status ? error.message : '기한을 바꾸지 못했어요. 다시 시도해 주세요.');
    } finally { stop(id); }
  }
  async function remove(id, el = null) {
    const task = look(id, el), api = tasksApi() || missing();
    if (!task || !api?.deleteTask || busy.has(id)) return;
    if (!window.confirm('이 Google 할 일을 삭제할까요?')) return;
    const owner = ownerNow();
    start(id);
    let result;
    try { result = await api.deleteTask(base(id, task)); } catch { result = {ok:false}; }
    finally { stop(id); }
    if (owner !== ownerNow()) return;
    if (result?.ok) { removed?.(id, task); toast('할 일을 삭제했어요.'); }
    else toast(result?.message || '할 일을 삭제하지 못했어요.');
  }
  function openEditor(id, el = null) {
    const task = look(id, el), api = tasksApi() || missing();
    if (!task) return;
    if (edit) return void edit(id, task, el);
    if (api?.openEditor) void api.openEditor(base(id, task));
  }
  function chooseDue(id, anchor) {
    const task = look(id, anchor);
    if (!task || !anchor?.isConnected) return;
    openDue(anchor, {name:shortName(task.title), value:dueDay(task), onPick:day => void moveDue(id, day, anchor)});
  }
  let menu = null, menuExtras = new Map();
  function openMenu(trigger) {
    menu ||= createAnchoredMenu({id:menuId, className:'task-inline-menu', label:'할 일 관리', historyKey, parent, key:t => t.dataset[menuAttr],
      render:id => {
        const active = menu?.active?.trigger || document.querySelector(`[data-${dataName(menuAttr)}="${CSS.escape(id)}"]`);
        const task = look(id, active), done = task?.status === 'completed';
        const own = task ? extras(task, active) || [] : [];
        menuExtras = new Map(own.map(x => [x.key, x]));
        const item = (action, text, danger) => `<button type="button" data-task-inline-action="${esc(action)}"${danger ? ' class="task-inline-danger"' : ''}>${esc(text)}</button>`;
        const mine = own.map(x => item('x:' + x.key, x.label, x.danger)).join('');
        return done ? item('reopen', '다시 할 일로') + item('edit', '고치기') + mine
          : item('tomorrow', '내일로') + item('due', '기한 바꾸기') + item('edit', '고치기') + mine + item('delete', '지우기', true);
      },
      onAction:(button, active) => {
        const id = active.id, action = button.dataset.taskInlineAction, el = active.trigger;
        if (action === 'tomorrow') return void moveDue(id, tomorrowKey(), el);
        if (action === 'due') return chooseDue(id, el);
        if (action === 'edit') return openEditor(id, el);
        if (action === 'delete') return void remove(id, el);
        if (action === 'reopen') return void setDone(id, false, {el, undo:false, viaMenu:true});
        if (action?.startsWith('x:')) return void menuExtras.get(action.slice(2))?.run?.();
      }});
    menu.open(trigger);
  }
  return {
    // The circle: a pending line completes (with [되돌리기]), a finished one reopens.
    toggle:(id, el = null) => { const task = look(id, el); if (task) return setDone(id, task.status !== 'completed', {el}); },
    complete:(id, el = null) => setDone(id, true, {el}),
    openMenu, moveDue, remove, edit:openEditor,
    isBusy:id => busy.has(id),
    close:() => { menu?.close(); closeDue({focus:false}); },
  };
}
