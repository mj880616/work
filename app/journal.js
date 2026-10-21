// JOURNAL-일지 2단계(업무일지): the [일지] side of the schedule tab (?view=journal). This module is the only renderer of
// #journalRoot: the week's day-number row (Monday to Sunday, ‹ › moves a week, a green dot on days with a line — J4 ①)
// → the chosen day: "오늘 한 줄" on top, then that day's materials (일정·끝낸 할 일·조직 소식·회의·행사 결과 — JOURNAL-일지카드정리,
// then 프로젝트 소식·할 일 예정·자료실 새 자료·공유 페이지 — JOURNAL-주간보고허브),
// gathered on screen and never stored. [주간보고 초안 복사] copies the week as text in the weekly report form's order (the same
// grouping as [주간 정리], journal-weekly.js weeklyReportText; 2026-10-21 사용자 승인).
// JOURNAL-오늘한줄목록: [저장] adds the typed line under the input (saving order, oldest first) and empties the input.
// Pressing a line turns it into an edit box in place with [저장][취소][삭제]; a removed line can be put back for 5 seconds
// ([되돌리기], the app's existing undo notice). No ⋯ menu or popup. On a PC (≥1024) each line also has [수정][삭제], shown while
// the pointer is over the line or focus is inside it (journal.css); the phone keeps pressing the line.
// Only the lines are saved (journal-data.js, kind=work). A material group that cannot be read shows its own notice and
// [다시 시도]; the lines still work. A typed, unsaved line stays in memory per day until the owner changes.
// JOURNAL-주간보고허브 1단계: four more groups (프로젝트 소식·할 일 예정·자료실 새 자료·공유 페이지). A group with nothing on
// the day is not drawn as a box and is not named (JOURNAL-다듬기 removed the "기록 없는 묶음: …" line).
// JOURNAL-주간보고허브 2단계: [하루 | 주간 정리] above the week. [주간 정리] hides the day row and the day card and shows the same
// week's materials (the same reads, read once) in the weekly report's order (journal-weekly.js builds and draws it into
// [data-journal-weekly], a box this module owns). The chosen side is kept in memory only (not in browser storage).
import './enter-save.js'; // UI-엔터저장: shared Enter-to-save rule for the data-enter-save roots below
import {weekStart, weekDays, shiftWeek, todayKey, ownerScope, readWorkWeek, changeWorkDay, validateWorkLine, WORK_LINE_MAX,
  workLines, addLine, editLine, removeLine, restoreLine, readWeekEvents, readDoneTasksWindow, readBasketUpdates, readMovedNotes, movedNotesOn, readOrgUpdates, readProjectUpdates,
  readWeekMeetings, readWeekDocuments, readWeekSharePages, dayMaterials, readScheduleEvents, DONE_TASK_DAYS, GROUP_SOURCES, rangeNote, isFolded, QUIET_WHEN_EMPTY, WEEK_READ_CAP} from './journal-data.js';
import {loadDocumentCategories} from './document-categories.js';
import {formatSeoulTime, seoulParts} from './meeting-time.js';
import {copyText} from './md-editor.js';
import {offerUndoNotice, closeUndoNotice} from './basket-record-delete.js';
import {requestTagsHtml, normalizeRequests} from './update-requests.js';
import {recordMark} from './basket-link-records.js';
import {requestNoteDocOpen} from './basket-note-tasks.js';
import {weeklySummary, renderWeekly, weeklyReportText} from './journal-weekly.js';
import {mountWeeklyHwpx} from './journal-hwpx.js';
import {mountRadar} from './todo-radar.js';

// ORG-묶음순서: the shared organization order (window.KPTUOrganizationOrder) orders the 조직 소식 sections.
await import('./organization-order.js').catch(() => {});
// [주간 정리] places project records in the project tree and its order (PRJ-3단): the shared project catalog.
await import('./project-catalog.js').catch(() => {});

(() => {
if (window.KPTUJournal) return;
const root = document.querySelector('#journalRoot');
if (!root) return;
const rt = window.KPTURuntime;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const monthDay = day => formatSeoulTime(day, {month:'long', day:'numeric'});
const longDay = day => formatSeoulTime(day, {month:'long', day:'numeric', weekday:'long'});
const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];
const length = text => [...String(text ?? '')].length;

root.innerHTML = `<div class="journal-head"><div class="journal-mode-switch" role="group" aria-label="업무일지 보기"><button type="button" data-journal-mode="day" aria-pressed="true">하루</button><button type="button" data-journal-mode="week" aria-pressed="false">주간 정리</button></div><div class="journal-week-nav"><button type="button" class="mini" data-journal-prev aria-label="이전 주">‹</button><b data-journal-title aria-live="polite"></b><button type="button" class="mini" data-journal-next aria-label="다음 주">›</button><button type="button" class="mini" data-journal-today>이번 주</button></div><button type="button" class="secondary" data-journal-copy>주간보고 초안 복사</button></div>
<p class="journal-status" data-journal-status role="status" aria-live="polite"></p>
<div class="journal-days" data-journal-days role="group" aria-label="이번 주 날짜"></div>
<section class="journal-day" data-journal-day aria-labelledby="journalDayTitle">
<h3 id="journalDayTitle" tabindex="-1" data-journal-day-title></h3>
<form class="journal-line" data-journal-line data-enter-save novalidate><label class="journal-heading" for="journalLineInput">오늘 한 줄</label><div class="journal-line-row"><textarea id="journalLineInput" rows="2" data-journal-input data-enter-field="single" placeholder="오늘 한 일을 한 줄로 남겨 보세요" aria-describedby="journalLineCount journalLineStatus"></textarea><button type="submit" class="primary" data-journal-save>저장</button></div><div class="journal-line-meta"><small id="journalLineCount" data-journal-count></small><p id="journalLineStatus" class="journal-line-status" data-journal-line-status role="status" aria-live="polite"></p></div></form>
<ol class="journal-lines" data-journal-lines aria-label="이 날 한 줄 목록"></ol>
<section class="journal-radar" data-journal-radar hidden></section>
<div class="journal-materials" data-journal-materials></div>
</section>
<section class="journal-weekly" data-journal-weekly-root aria-labelledby="journalWeeklyTitle" hidden><h3 id="journalWeeklyTitle" tabindex="-1" data-journal-weekly-title></h3><p class="journal-muted journal-weekly-intro">주간보고 양식 순서로 이 주 기록을 모았어요. 화면에서 보기만 하고 저장하지 않아요.</p><div class="journal-hwpx" data-journal-hwpx></div><div class="journal-weekly-body" data-journal-weekly></div></section>`;
const $ = selector => root.querySelector(selector);
const days = $('[data-journal-days]'), input = $('[data-journal-input]'), lineStatus = $('[data-journal-line-status]'), status = $('[data-journal-status]');

let owner = ownerScope(rt), epoch = 0;
let start = weekStart(todayKey()), selected = todayKey();
let lines = new Map(), linesState = 'loading';
let materials = {};
let doneDays = DONE_TASK_DAYS; // days of finished tasks the Edge really covered (3 on an older Edge)
let drafts = new Map(), saving = false;
// The one line being edited in place: {day, index, before, value}.
let editing = null;
// 'day' (the day card) or 'week' ([주간 정리]); memory only.
let mode = 'day';
const current = (run, scope) => run === epoch && scope === ownerScope(rt);

function renderWeek() {
  const list = weekDays(start), today = todayKey(), last = list[6];
  $('[data-journal-title]').textContent = `${monthDay(list[0])} ~ ${seoulParts(list[0]).month === seoulParts(last).month ? `${seoulParts(last).day}일` : monthDay(last)}`;
  days.replaceChildren(...list.map((day, i) => {
    const button = document.createElement('button'), line = lines.get(day);
    button.type = 'button'; button.className = 'journal-date'; button.dataset.journalDate = day;
    if (i >= 5) button.classList.add(i === 6 ? 'sunday' : 'saturday');
    if (day === today) button.setAttribute('aria-current', 'date');
    button.setAttribute('aria-pressed', String(day === selected));
    button.setAttribute('aria-label', `${longDay(day)}${line ? ', 한 줄 있음' : ''}`);
    button.innerHTML = `<span class="journal-weekday" aria-hidden="true">${WEEKDAYS[i]}</span><span class="journal-num" aria-hidden="true">${seoulParts(day).day}</span>${line ? '<span class="journal-dot" data-journal-dot aria-hidden="true"></span>' : ''}`;
    return button;
  }));
}
function renderLine({keepStatus = false} = {}) {
  $('[data-journal-day-title]').textContent = longDay(selected);
  input.value = drafts.get(selected) ?? '';
  input.disabled = saving || linesState === 'loading';
  $('[data-journal-save]').disabled = saving || linesState === 'loading';
  if (!keepStatus) lineStatus.textContent = linesState === 'failed' ? '저장된 한 줄을 불러오지 못했어요. 지금 쓰면 그날 목록에 더해 저장해요.' : '';
  count();
  renderList();
}
// The chosen day's lines under the input, in saving order. One line at a time can be an edit box.
function renderList() {
  const list = $('[data-journal-lines]'), items = workLines(lines.get(selected));
  const edit = editing?.day === selected ? editing : null;
  list.replaceChildren(...items.map((text, index) => {
    const item = document.createElement('li');
    item.className = 'journal-line-item'; item.dataset.journalItem = String(index);
    if (edit?.index === index) {
      item.dataset.editing = ''; item.dataset.enterSave = '';
      item.innerHTML = `<textarea rows="2" data-journal-edit-input data-enter-field="single" aria-label="${index + 1}번째 줄 고치기" aria-describedby="journalEditCount journalEditStatus"></textarea><div class="journal-edit-meta"><small id="journalEditCount" data-journal-edit-count></small><p id="journalEditStatus" class="journal-line-status" data-journal-edit-status role="status" aria-live="polite"></p></div><div class="journal-edit-actions"><button type="button" class="mini primary" data-journal-edit-save data-enter-save-submit>저장</button><button type="button" class="mini" data-journal-edit-cancel>취소</button><button type="button" class="mini journal-delete" data-journal-edit-delete>삭제</button></div>`;
      const box = item.querySelector('[data-journal-edit-input]');
      box.value = edit.value; box.disabled = saving;
      item.querySelectorAll('button').forEach(button => { button.disabled = saving; });
      item.querySelector('[data-journal-edit-status]').textContent = edit.status || '';
      if (edit.invalid) box.setAttribute('aria-invalid', 'true');
      editCount(item);
      return item;
    }
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'journal-line-text'; button.dataset.journalEdit = String(index);
    button.disabled = saving || !!edit;
    button.textContent = text;
    button.setAttribute('aria-label', `${text} (눌러서 고치기)`);
    // PC: [수정][삭제] beside the line (hidden on the phone; shown on hover or keyboard focus — journal.css).
    const actions = document.createElement('span');
    actions.className = 'journal-line-actions';
    actions.innerHTML = `<button type="button" class="mini" data-journal-edit-open="${index}" aria-label="${index + 1}번째 줄 수정">수정</button><button type="button" class="mini journal-delete" data-journal-line-delete="${index}" aria-label="${index + 1}번째 줄 삭제">삭제</button>`;
    actions.querySelectorAll('button').forEach(b => { b.disabled = saving || !!edit; });
    item.append(button, actions);
    return item;
  }));
  list.hidden = !items.length;
}
function editCount(item = root.querySelector('[data-journal-item][data-editing]')) {
  const box = item?.querySelector('[data-journal-edit-input]'), counter = item?.querySelector('[data-journal-edit-count]');
  if (!box || !counter) return;
  const n = length(box.value.trim());
  counter.textContent = `${n}/${WORK_LINE_MAX}자`;
  counter.classList.toggle('over', n > WORK_LINE_MAX || /[\r\n]/.test(box.value));
}
function count() {
  const n = length(input.value.trim());
  const counter = $('[data-journal-count]');
  counter.textContent = `${n}/${WORK_LINE_MAX}자`;
  counter.classList.toggle('over', n > WORK_LINE_MAX || /[\r\n]/.test(input.value));
}
// JOURNAL-요청표시: a marked update's item starts with the same small tags as the basket list (update-requests.js).
const itemList = (texts, tags = []) => { const list = document.createElement('ul'); texts.forEach((text, i) => { const item = document.createElement('li'); item.innerHTML = requestTagsHtml(tags[i], esc); item.append(text); if (normalizeRequests(tags[i]).length) item.dataset.journalRequests = normalizeRequests(tags[i]).join(' '); list.append(item); }); return list; };
function renderMaterials() {
  const host = $('[data-journal-materials]');
  const groups = dayMaterials(materials, selected), range = {doneDays};
  // BASKET-일지로남기기: 기타 메모 shows only with items (its one read, the basket, already shows loading and failure in 조직 소식).
  const quiet = groups.filter(group => QUIET_WHEN_EMPTY.includes(group.key) && !group.items.length);
  const folded = groups.filter(group => !quiet.includes(group) && isFolded(group, selected, range));
  const boxes = groups.filter(group => !folded.includes(group) && !quiet.includes(group)).map(group => {
    const box = document.createElement('section');
    box.className = 'journal-group'; box.dataset.journalGroup = group.key;
    const head = document.createElement('h4'); head.className = 'journal-heading'; head.textContent = group.label; box.append(head);
    if (group.loading) { box.insertAdjacentHTML('beforeend', '<p class="journal-muted">불러오는 중…</p>'); return box; }
    if (group.sections.length) {
      for (const section of group.sections) {
        const part = document.createElement('div');
        part.className = 'journal-org'; part.dataset.journalOrg = section.name;
        const name = document.createElement('p'); name.className = 'journal-org-name'; name.textContent = section.name;
        part.append(name, itemList(section.items, section.tags));
        box.append(part);
      }
    } else if (group.items.length) box.append(itemList(group.items));
    if (group.capped) box.insertAdjacentHTML('beforeend', `<p class="journal-muted" data-journal-capped>이 주에 ${WEEK_READ_CAP}개가 넘어 앞의 ${WEEK_READ_CAP}개만 모였어요.</p>`);
    if (group.failed) {
      box.dataset.failed = '';
      box.insertAdjacentHTML('beforeend', `<p class="journal-muted journal-failed" data-journal-failed>${group.items.length ? `${esc(group.label)} 일부를` : `${esc(group.label)}을(를)`} 불러오지 못했어요. 한 줄은 그대로 쓸 수 있어요.</p><button type="button" class="mini" data-journal-retry="${group.key}">다시 시도</button>`);
      return box;
    }
    const note = rangeNote(group, selected, range);
    if (note) box.insertAdjacentHTML('beforeend', `<p class="journal-muted">${esc(note)}</p>`);
    return box;
  });
  // 노트로 옮긴 업데이트: a note moved from the basket shows as one "노트: (제목)" line on the update's own day; pressing it opens
  // the note. Quiet when empty or when its read failed; it is not one of GROUPS, so the weekly draft does not carry it.
  const moved = materials.movedNotes?.status === 'ok' ? movedNotesOn(materials.movedNotes.items, selected) : [];
  if (moved.length) {
    const box = document.createElement('section');
    box.className = 'journal-group'; box.dataset.journalMovedNotes = '';
    const head = document.createElement('h4'); head.className = 'journal-heading'; head.textContent = '노트로 옮긴 업데이트';
    const list = document.createElement('ul'); list.className = 'journal-moved-list';
    for (const note of moved) {
      const item = document.createElement('li'), button = document.createElement('button');
      button.type = 'button'; button.className = 'journal-note-open'; button.dataset.journalNoteOpen = note.id;
      button.innerHTML = recordMark({note_kind:'note'}, 'journal-note-mark');
      button.append(note.line);
      button.setAttribute('aria-label', `${note.line} (눌러서 노트 열기)`);
      item.append(button); list.append(item);
    }
    box.append(head, list);
    boxes.push(box);
  }
  host.replaceChildren(...boxes);
}
// JOURNAL-챙길것: the box above the day card shows the candidates found in the chosen day's records (todo-radar.js draws it).
// It belongs to the [하루] side; [주간 정리] hides it.
const radar = mountRadar($('[data-journal-radar]'), {place:'journal'});
const radarDay = () => { const list = weekDays(start); radar?.setDay(selected, list[0], list[6]); };
// [주간 정리]: the week in report order. Drawn only while that side is shown; every read that lands redraws it.
function renderWeekly_() {
  if (mode !== 'week') return;
  const list = weekDays(start);
  $('[data-journal-weekly-title]').textContent = `주간 정리 · ${longDay(list[0])} ~ ${longDay(list[6])}`;
  renderWeekly($('[data-journal-weekly]'), weeklySummary({start, lines, linesState, materials, doneDays}), esc);
  hwpx?.refresh();
}
// WEEKLY-한글초안 2단계: [주간보고 한글 파일 만들기] — journal-hwpx.js owns that box; it reads the shown week's grouping.
const hwpx = mountWeeklyHwpx($('[data-journal-hwpx]'), {rt, getWeek: () => ({start, model:weeklySummary({start, lines, linesState, materials, doneDays})})});
function renderMode() {
  root.dataset.journalMode = mode;
  root.querySelectorAll('[data-journal-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.journalMode === mode)));
  days.hidden = mode === 'week';
  $('[data-journal-day]').hidden = mode === 'week';
  radar?.setShown(mode === 'day');
  $('[data-journal-weekly-root]').hidden = mode !== 'week';
}
function setMode(next) {
  if (next === mode || !['day', 'week'].includes(next)) return;
  mode = next; editing = null;
  renderMode();
  if (mode === 'week') renderWeekly_(); else { renderWeek(); renderLine({keepStatus:true}); renderMaterials(); radarDay(); }
}
function render() { renderMode(); renderWeek(); renderLine({keepStatus:true}); renderMaterials(); renderWeekly_(); radarDay(); }

const readers = {
  events: () => readWeekEvents(start, rt),
  // 5. 주요 일정 of [주간 정리] and the draft: the two weeks from the Monday after the shown week (one more calendar read a week).
  upcoming: () => readScheduleEvents(start, rt),
  // One Google Tasks read: finished tasks (끝낸 할 일) and pending tasks in the server's range (할 일 예정).
  tasks: async () => { const read = await readDoneTasksWindow(rt); doneDays = read.days; return [...read.tasks, ...read.pending]; },
  basket: () => readBasketUpdates(rt),
  movedNotes: () => readMovedNotes(rt),
  orgUpdates: () => readOrgUpdates(start, rt),
  projectUpdates: () => readProjectUpdates(start, rt),
  meetings: () => readWeekMeetings(start, rt),
  documents: () => { void loadDocumentCategories({rt}).catch(() => {}); return readWeekDocuments(start, rt); },
  sharePages: () => readWeekSharePages(start, rt),
  // The project tree for [주간 정리] (read once per visit, like the basket). Without it records go under their project names.
  catalog: async () => {
    const c = rt.context.read(), catalog = window.KPTUProjectCatalog;
    if (!catalog || !c?.workspace?.id || !c?.user?.id) throw new Error('catalog');
    // force: the tree as it is now (a project reordered elsewhere since the last read shows in this visit).
    const snap = await catalog.load({workspaceId:c.workspace.id, userId:c.user.id, force:true});
    if (!snap?.loaded) throw new Error('catalog');
    return snap.tree;
  },
};
async function loadGroup(key, run = epoch, scope = owner) {
  materials[key] = {status:'loading'}; renderMaterials(); renderWeekly_();
  try {
    const items = await readers[key]();
    if (!current(run, scope)) return;
    materials[key] = {status:'ok', items};
  } catch {
    if (!current(run, scope)) return;
    materials[key] = {status:'failed'};
  }
  renderMaterials(); renderWeekly_();
}
async function loadLines(run, scope) {
  linesState = 'loading'; renderLine();
  try {
    const rows = await readWorkWeek(start, rt);
    if (!current(run, scope)) return;
    lines = new Map(rows.map(row => [row.journal_day, row])); linesState = 'ok';
  } catch {
    if (!current(run, scope)) return;
    lines = new Map(); linesState = 'failed';
  }
  renderWeek(); renderLine(); renderWeekly_();
}
// A new week reads its lines and that week's events (and the two weeks after it, 5. 주요 일정), organization/project records,
// meetings, new documents and changed share pages; Google tasks (done and pending) and basket updates are read once per visit (not per week).
function loadWeek({shared = false} = {}) {
  const changedOwner = owner !== ownerScope(rt);
  const run = ++epoch, scope = owner = ownerScope(rt);
  lines = new Map(); status.textContent = ''; editing = null;
  if (changedOwner) hwpx?.close(); else hwpx?.setWeek(start);
  const keys = shared ? Object.keys(readers) : ['events', 'upcoming', 'orgUpdates', 'projectUpdates', 'meetings', 'documents', 'sharePages'];
  for (const key of keys) materials[key] = {status:'loading'};
  render();
  loadLines(run, scope);
  for (const key of keys) loadGroup(key, run, scope);
}
function moveWeek(step) {
  const index = weekDays(start).indexOf(selected);
  start = shiftWeek(start, step); selected = weekDays(start)[Math.max(0, index)];
  loadWeek();
}
function goThisWeek() {
  const today = todayKey(), week = weekStart(today);
  if (week === start) { selectDay(today); return; }
  start = week; selected = today; loadWeek();
}
function selectDay(day) {
  if (day === selected) return;
  selected = day; editing = null; renderWeek(); renderLine(); renderMaterials(); radarDay();
}

const saveMessage = error => error?.status === 401 ? '로그인이 필요해요. 다시 로그인한 뒤 저장해 주세요.'
  : error?.status === 400 ? '한 줄 규칙에 맞지 않아 저장하지 못했어요. 줄바꿈 없이 300자 안으로 써 주세요.'
  : error?.message && !error.status ? error.message : '저장하지 못했어요. 다시 시도해 주세요.';
// One change of the chosen day through journal-data.js. Returns true when it was saved for the same owner.
async function apply(day, change, {onStale} = {}) {
  const run = epoch, scope = owner, row = lines.get(day) || null;
  saving = true; renderLine({keepStatus:true});
  try {
    const result = await changeWorkDay({day, row, change}, rt);
    if (scope !== ownerScope(rt)) return {stale:true};
    saving = false;
    if (run === epoch || weekDays(start).includes(day)) { if (result.row) lines.set(day, result.row); else lines.delete(day); }
    renderWeekly_();
    renderWeek(); renderLine({keepStatus:true});
    return {ok:true};
  } catch (error) {
    if (scope !== ownerScope(rt)) return {stale:true};
    saving = false;
    // A day another device changed is shown as it is now, so the owner sees what is there before trying again.
    if (error?.code === 'line_missing' || error?.code === 'day_changed') {
      try { const rows = await readWorkWeek(start, rt); if (scope === ownerScope(rt) && run === epoch) lines = new Map(rows.map(r => [r.journal_day, r])); } catch { /* keep what is shown */ }
      onStale?.();
    }
    renderWeek(); renderLine({keepStatus:true});
    return {error, message:saveMessage(error)};
  }
}
async function save() {
  if (saving || linesState === 'loading') return;
  const day = selected;
  let line;
  try { line = validateWorkLine(input.value); } catch (error) { lineStatus.textContent = error.message; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
  input.removeAttribute('aria-invalid');
  lineStatus.textContent = '저장하는 중…';
  const result = await apply(day, addLine(line));
  if (result.stale) return;
  if (result.ok) {
    drafts.delete(day);
    if (selected === day) { input.value = ''; count(); }
    lineStatus.textContent = '한 줄을 저장했어요.';
    if (selected === day) input.focus();
  } else lineStatus.textContent = result.message;
}
function startEdit(index) {
  if (saving) return;
  const text = workLines(lines.get(selected))[index];
  if (text === undefined) return;
  closeUndoNotice();
  editing = {day:selected, index, before:text, value:text};
  renderList();
  const box = root.querySelector('[data-journal-edit-input]');
  box?.focus(); box?.setSelectionRange(box.value.length, box.value.length);
}
function cancelEdit() {
  if (!editing) return;
  const index = editing.index; editing = null; renderList();
  root.querySelector(`[data-journal-edit="${index}"]`)?.focus();
}
async function saveEdit() {
  if (saving || !editing) return;
  const edit = editing, box = root.querySelector('[data-journal-edit-input]');
  if (box) edit.value = box.value;
  let line;
  try { line = validateWorkLine(edit.value); } catch (error) { edit.status = error.message; edit.invalid = true; renderList(); root.querySelector('[data-journal-edit-input]')?.focus(); return; }
  if (line === edit.before) { editing = null; renderList(); lineStatus.textContent = '바뀐 내용이 없어요.'; root.querySelector(`[data-journal-edit="${edit.index}"]`)?.focus(); return; }
  edit.status = '저장하는 중…'; edit.invalid = false;
  const result = await apply(edit.day, editLine(edit.index, edit.before, line), {onStale:() => { if (editing === edit) editing = null; }});
  if (result.stale || editing !== edit && !result.error) return;
  if (result.ok) {
    editing = null; renderList();
    lineStatus.textContent = '줄을 고쳤어요.';
    const index = workLines(lines.get(edit.day)).indexOf(line);
    root.querySelector(`[data-journal-edit="${index}"]`)?.focus();
  } else if (editing === edit) { edit.status = result.message; renderList(); root.querySelector('[data-journal-edit-input]')?.focus(); }
  else lineStatus.textContent = result.message;
}
// Removes one line right away and offers [되돌리기] for 5 seconds (the app's undo notice). From the edit box, or from [삭제] on a PC.
async function removeWithUndo(day, index, before, {onStale, onDone, onFail} = {}) {
  const result = await apply(day, removeLine(index, before), {onStale});
  if (result.stale) return;
  if (!result.ok) { onFail?.(result); return; }
  onDone?.();
  lineStatus.textContent = '';
  input.focus();
  const scope = owner;
  offerUndoNotice({text:'한 줄을 지웠어요.', onUndo:async () => {
    if (scope !== ownerScope(rt)) return {status:'stale'};
    const back = await apply(day, restoreLine(index, before));
    if (back.stale) return {status:'stale'};
    return {status:back.ok ? 'restored' : 'failed', message:back.ok ? '지운 줄을 되돌렸어요.' : back.message};
  }});
}
async function deleteEdit() {
  if (saving || !editing) return;
  const edit = editing;
  edit.status = '지우는 중…';
  await removeWithUndo(edit.day, edit.index, edit.before, {
    onStale:() => { if (editing === edit) editing = null; },
    onDone:() => { editing = null; renderList(); },
    onFail:result => { if (editing === edit) { edit.status = result.message; renderList(); } else lineStatus.textContent = result.message; },
  });
}
async function deleteLine(index) {
  if (saving || editing) return;
  const day = selected, before = workLines(lines.get(day))[index];
  if (before === undefined) return;
  closeUndoNotice();
  lineStatus.textContent = '지우는 중…';
  await removeWithUndo(day, index, before, {onFail:result => { lineStatus.textContent = result.message; }});
}

async function copyDraft() {
  const text = weeklyReportText(weeklySummary({start, lines, linesState, materials, doneDays}));
  const ok = await copyText(text);
  // movedNotes, catalog (the project order) and this week's events (the day card's 일정) are not draft material.
  const missing = Object.entries(materials).some(([key, state]) => !['movedNotes', 'catalog', 'events'].includes(key) && state?.status !== 'ok');
  status.textContent = ok ? `주간보고 양식 순서로 복사했어요.${missing ? ' 불러오지 못한 묶음은 빠졌어요.' : ''}` : '복사하지 못했어요. 다시 시도해 주세요.';
}

root.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || !root.contains(button) || button.disabled) return;
  if (button.matches('[data-journal-mode]')) return setMode(button.dataset.journalMode);
  if (button.matches('[data-journal-weekly-retry]')) {
    for (const key of button.dataset.journalWeeklyRetry.split(' ')) {
      if (key === 'lines') { if (linesState === 'failed') loadLines(epoch, owner); }
      else if (readers[key] && materials[key]?.status === 'failed') loadGroup(key);
    }
    return;
  }
  if (button.matches('[data-journal-date]')) return selectDay(button.dataset.journalDate);
  if (button.matches('[data-journal-prev]')) return moveWeek(-1);
  if (button.matches('[data-journal-next]')) return moveWeek(1);
  if (button.matches('[data-journal-today]')) return goThisWeek();
  if (button.matches('[data-journal-retry]')) { for (const key of GROUP_SOURCES[button.dataset.journalRetry] || []) if (materials[key]?.status === 'failed') loadGroup(key); return; }
  if (button.matches('[data-journal-note-open]')) { requestNoteDocOpen(button.dataset.journalNoteOpen, rt); window.KPTURouter?.go('basket', {source:'delegated'}); return; }
  if (button.matches('[data-journal-copy]')) return copyDraft();
  if (button.matches('[data-journal-edit]')) return startEdit(Number(button.dataset.journalEdit));
  if (button.matches('[data-journal-edit-open]')) return startEdit(Number(button.dataset.journalEditOpen));
  if (button.matches('[data-journal-line-delete]')) return deleteLine(Number(button.dataset.journalLineDelete));
  if (button.matches('[data-journal-edit-save]')) return saveEdit();
  if (button.matches('[data-journal-edit-cancel]')) return cancelEdit();
  if (button.matches('[data-journal-edit-delete]')) return deleteEdit();
});
// The edit box: Enter saves, Escape cancels, Shift+Enter is refused like a pasted line break.
const lists = $('[data-journal-lines]');
lists.addEventListener('keydown', event => {
  if (!event.target.matches('[data-journal-edit-input]') || event.isComposing) return;
  if (event.key === 'Escape') { event.preventDefault(); cancelEdit(); return; }
  // Enter saves through the shared rule (enter-save.js, data-enter-field="single"); Shift+Enter is refused here.
  if (event.key !== 'Enter' || !event.shiftKey || event.keyCode === 229) return;
  event.preventDefault();
  const note = root.querySelector('[data-journal-edit-status]'); if (note) note.textContent = '한 줄로 써 주세요. 줄바꿈은 넣을 수 없어요.'; if (editing) editing.status = note?.textContent;
});
lists.addEventListener('input', event => {
  if (!event.target.matches('[data-journal-edit-input]') || !editing) return;
  editing.value = event.target.value; editing.invalid = false; event.target.removeAttribute('aria-invalid');
  if (!saving) { editing.status = ''; const note = root.querySelector('[data-journal-edit-status]'); if (note) note.textContent = ''; }
  editCount();
});
$('[data-journal-line]').addEventListener('submit', event => { event.preventDefault(); save(); });
// Enter saves (a line has no line break); Shift+Enter is refused the same way as a pasted line break.
input.addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); lineStatus.textContent = '한 줄로 써 주세요. 줄바꿈은 넣을 수 없어요.'; }
});
input.addEventListener('input', () => {
  if (input.value === '') drafts.delete(selected); else drafts.set(selected, input.value);
  input.removeAttribute('aria-invalid');
  if (!saving) lineStatus.textContent = '';
  count();
});

window.addEventListener('kptu:session-changed', () => {
  if (owner === ownerScope(rt)) return;
  owner = ownerScope(rt); epoch++;
  drafts = new Map(); lines = new Map(); materials = {}; doneDays = DONE_TASK_DAYS; saving = false; editing = null; mode = 'day';
  start = weekStart(todayKey()); selected = todayKey();
  if (window.KPTURouter?.current === 'journal') enter();
});
// Each visit reads again from the week and day last seen in this sign-in (this week on the first visit).
function enter() { loadWeek({shared:true}); }
window.KPTURouter?.on?.('journal', enter);
// A renamed category list (자료실 분류) shows on the next draw of 자료실 새 자료.
window.addEventListener('kptu:document-categories-changed', () => { if (materials.documents?.status === 'ok') { renderMaterials(); renderWeekly_(); } });
window.KPTUJournal = {refresh:() => loadWeek({shared:true})};
if (window.KPTURouter?.current === 'journal') enter();
})();
