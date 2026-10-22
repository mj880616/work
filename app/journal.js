// JOURNAL-일지 2단계(업무일지): the [일지] side of the schedule tab (?view=journal). This module is the only renderer of
// #journalRoot: the week's day-number row (Monday to Sunday, ‹ › moves a week, a green dot on days with a line — J4 ①)
// → the chosen day: "오늘 한 줄" on top, then that day's materials (일정·끝낸 할 일·조직 소식·회의·행사 결과 — JOURNAL-일지카드정리,
// then 프로젝트 소식·할 일 예정·자료실 새 자료·공유 페이지 — JOURNAL-주간보고허브),
// gathered on screen and never stored. [주간 정리]'s [복사] (beside [주간보고 한글 파일 만들기], journal-hwpx.js) copies the week as
// text in the weekly report form's order (journal-weekly.js weeklyReportText; 2026-10-21 사용자 승인). JOURNAL-주간정리다듬기
// (2026-10-22 사용자 결정): the top row has no copy button on either side any more.
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
// JOURNAL-하루개편 (2026-10-22 요청함 14:26·12:55): the [하루] card from top to bottom is ① 오늘 한 줄 → ② 할 일 / 한 일 (PC side by
// side from 761px, phone one above the other; 기한 지난 것 one folded line; [내일로] on each unfinished task — at the line's right on
// a wide screen, inside its ⋯ on the phone) → ③ 그날 나온 챙길 것 (todo-radar.js draws it; this module only gives it its place) →
// ④ 주간보고 재료 in the report's order (회의·활동 결과 → 사업 소식 → 조직 소식) → ⑤ 그 밖의 기록, folded, with a count line.
// journal-data.js dayCard() builds the model; renderDay() below is the one renderer of ② and ④⑤ (the parts above are unchanged).
// ⑥ Every line opens its original (openOriginal): an organization or project record opens that screen at that record and
// highlights it for a moment; an update's ⋯ has [원래 업데이트 보기]. On a PC (≥1024) the organization/project opens on its own
// screen (one history entry, so one back or the top line's ← returns here); on the phone it opens over this screen as the app's
// usual window (its own history entry), so one back also returns. Coming back by back/← keeps this card as it was (no re-read)
// and the same scroll and focus.
import './enter-save.js'; // UI-엔터저장: shared Enter-to-save rule for the data-enter-save roots below
import {weekStart, weekDays, shiftWeek, todayKey, ownerScope, readWorkWeek, changeWorkDay, validateWorkLine, WORK_LINE_MAX,
  workLines, addLine, editLine, removeLine, restoreLine, readWeekEvents, readDoneTasksWindow, readBasketUpdates, readMovedNotes, readOrgUpdates, readProjectUpdates,
  readWeekMeetings, readWeekDocuments, readWeekSharePages, readScheduleEvents, DONE_TASK_DAYS, WEEK_READ_CAP,
  dayCard, othersCount, DAY_SOURCES, moveTaskToTomorrow, dayRangeNote} from './journal-data.js';
import {loadDocumentCategories} from './document-categories.js';
import {formatSeoulTime, seoulParts} from './meeting-time.js';
import {copyText} from './md-editor.js';
import {offerUndoNotice, closeUndoNotice} from './basket-record-delete.js';
import {requestTagsHtml, normalizeRequests} from './update-requests.js';
import {recordMark} from './basket-link-records.js';
import {requestNoteDocOpen, requestBasketNote, requestTaskOpen} from './basket-note-tasks.js';
import {weeklySummary, renderWeekly, weeklyReportText} from './journal-weekly.js';
import {mountWeeklyHwpx} from './journal-hwpx.js';
import {readKinds, changeKind} from './journal-meeting-kinds.js';
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

root.innerHTML = `<div class="journal-head"><div class="journal-mode-switch" role="group" aria-label="업무일지 보기"><button type="button" data-journal-mode="day" aria-pressed="true">하루</button><button type="button" data-journal-mode="week" aria-pressed="false">주간 정리</button></div><div class="journal-week-nav"><button type="button" class="mini" data-journal-prev aria-label="이전 주">‹</button><b data-journal-title aria-live="polite"></b><button type="button" class="mini" data-journal-next aria-label="다음 주">›</button><button type="button" class="mini" data-journal-today>이번 주</button></div></div>
<p class="journal-status" data-journal-status role="status" aria-live="polite"></p>
<div class="journal-days" data-journal-days role="group" aria-label="이번 주 날짜"></div>
<section class="journal-day" data-journal-day aria-labelledby="journalDayTitle">
<h3 id="journalDayTitle" tabindex="-1" data-journal-day-title></h3>
<form class="journal-line" data-journal-line data-enter-save novalidate><label class="journal-heading" for="journalLineInput">오늘 한 줄</label><div class="journal-line-row"><textarea id="journalLineInput" rows="2" data-journal-input data-enter-field="single" placeholder="오늘 한 일을 한 줄로 남겨 보세요" aria-describedby="journalLineCount journalLineStatus"></textarea><button type="submit" class="primary" data-journal-save>저장</button></div><div class="journal-line-meta"><small id="journalLineCount" data-journal-count></small><p id="journalLineStatus" class="journal-line-status" data-journal-line-status role="status" aria-live="polite"></p></div></form>
<ol class="journal-lines" data-journal-lines aria-label="이 날 한 줄 목록"></ol>
<section class="journal-tasks" data-journal-tasks aria-label="할 일과 한 일"></section>
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
// JOURNAL-회의종류표시: my list of meeting kinds left out of the weekly report ({status:'loading'|'ok'|'unknown', list}); read once per visit.
let kinds = {status:'loading'}, kindsBusy = false;
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
// ── JOURNAL-하루개편: ② 할 일 / 한 일 and ④ 주간보고 재료 · ⑤ 그 밖의 기록 (one renderer: renderDay) ──
// Each drawn line that opens something gets a key into `opens` (rebuilt on every draw).
let opens = new Map(), openSeq = 0, othersOpen = false;
const moving = new Set(); // tasks whose [내일로] is being saved
let taskNote = '';        // the result line under 할 일 / 한 일
const keyFor = target => { if (!target) return ''; const key = `j${++openSeq}`; opens.set(key, target); return key; };
const WIDE = window.matchMedia?.('(min-width:1024px)');
// ⋯ of one line: a native disclosure (as the meeting-kind ⋯ of [주간 정리]) holding small buttons.
function moreMenu(label, buttons) {
  const more = document.createElement('details');
  more.className = 'journal-item-more';
  more.innerHTML = `<summary aria-label="${esc(label)} 더 보기"><span aria-hidden="true">⋯</span></summary>`;
  more.append(...buttons);
  return more;
}
function smallButton(text, data, value, aria) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'mini'; button.textContent = text; button.dataset[data] = value;
  if (aria) button.setAttribute('aria-label', aria);
  return button;
}
// One line: the text is a button that opens the original. Update lines keep the request tags (JOURNAL-요청표시) in front.
function itemRow(item) {
  const li = document.createElement('li');
  li.className = 'journal-item';
  const key = keyFor(item.open);
  const main = document.createElement(key ? 'button' : 'span');
  main.className = 'journal-item-open';
  if (key) { main.type = 'button'; main.dataset.journalOpen = key; main.setAttribute('aria-label', `${item.text} (원본 열기)`); }
  if (item.noteMark) main.innerHTML = recordMark({note_kind:'note'}, 'journal-note-mark');
  else main.innerHTML = requestTagsHtml(item.requests, esc);
  main.append(item.text);
  if (normalizeRequests(item.requests).length) li.dataset.journalRequests = normalizeRequests(item.requests).join(' ');
  const body = document.createElement('div'); body.className = 'journal-item-body'; body.append(main);
  // 회의·활동 결과: '보고 안 함' kinds are dimmed; the result's first line (or "결과 아직 없음") sits under the title.
  if (item.hidden) { li.dataset.journalReportOff = ''; main.insertAdjacentHTML('beforeend', ' <small class="journal-report-off">보고 안 함</small>'); }
  if ('summary' in item) body.insertAdjacentHTML('beforeend', item.summary ? `<p class="journal-item-summary">${esc(item.summary)}</p>` : '<p class="journal-item-summary journal-no-result" data-journal-no-result>결과 아직 없음</p>');
  li.append(body);
  // An update filed to an organization or a project: ⋯ [원래 업데이트 보기] opens the basket update itself.
  if (item.open?.note && ['org', 'project'].includes(item.open.type)) {
    li.append(moreMenu(item.text, [smallButton('원래 업데이트 보기', 'journalOriginal', keyFor({type:'note', note:item.open.note}))]));
  }
  return li;
}
const listOf = items => { const ul = document.createElement('ul'); ul.className = 'journal-items'; ul.append(...items.map(itemRow)); return ul; };
// A task line: open (the task) + [내일로] when unfinished — on a wide screen at the line's right, on the phone inside ⋯ (journal.css).
function taskRow(item, {pending}) {
  const li = itemRow(item);
  li.dataset.journalTask = item.id;
  if (!pending) return li;
  const busy = moving.has(item.id), label = `${item.text} 기한을 내일로`;
  const inline = smallButton(busy ? '옮기는 중…' : '내일로', 'journalTomorrow', item.id, label);
  inline.classList.add('journal-tomorrow-inline'); inline.disabled = busy;
  const inMenu = smallButton(busy ? '옮기는 중…' : '내일로', 'journalTomorrow', item.id, label); inMenu.disabled = busy;
  const menu = moreMenu(item.text, [inMenu]); menu.classList.add('journal-task-more');
  li.append(inline, menu);
  return li;
}
function partNotes(box, part) {
  if (part.capped) box.insertAdjacentHTML('beforeend', `<p class="journal-muted" data-journal-capped>이 주에 ${WEEK_READ_CAP}개가 넘어 앞의 ${WEEK_READ_CAP}개만 모였어요.</p>`);
  if (part.failed) {
    box.dataset.failed = '';
    box.insertAdjacentHTML('beforeend', `<p class="journal-muted journal-failed" data-journal-failed>${part.items.length ? `${esc(part.label)} 일부를` : `${esc(part.label)}을(를)`} 불러오지 못했어요. 한 줄은 그대로 쓸 수 있어요.</p><button type="button" class="mini" data-journal-retry="${part.key}">다시 시도</button>`);
  }
}
function partBox(part, {heading = 'h4'} = {}) {
  const box = document.createElement('section');
  box.className = 'journal-group'; box.dataset.journalGroup = part.key;
  const head = document.createElement(heading); head.className = 'journal-heading'; head.textContent = part.label; box.append(head);
  if (part.loading) { box.insertAdjacentHTML('beforeend', '<p class="journal-muted">불러오는 중…</p>'); return box; }
  if (part.sections.length) for (const section of part.sections) {
    const wrap = document.createElement('div');
    wrap.className = 'journal-org'; wrap.dataset.journalOrg = section.name;
    const name = document.createElement('p'); name.className = 'journal-org-name'; name.textContent = section.name;
    wrap.append(name, listOf(section.items.map((text, i) => ({text, requests:section.tags?.[i], open:section.opens?.[i]}))));
    box.append(wrap);
  } else if (part.items.length) box.append(listOf(part.items));
  partNotes(box, part);
  return box;
}
function renderTasks(card) {
  const host = $('[data-journal-tasks]'), part = card.tasks, range = {doneDays};
  const column = (key, label, items, pending, empty) => {
    const box = document.createElement('section');
    box.className = 'journal-group journal-task-col'; box.dataset.journalGroup = key;
    box.innerHTML = `<h4 class="journal-heading">${label}</h4>`;
    if (part.loading) { box.insertAdjacentHTML('beforeend', '<p class="journal-muted">불러오는 중…</p>'); return box; }
    if (items.length) { const ul = document.createElement('ul'); ul.className = 'journal-items'; ul.append(...items.map(item => taskRow(item, {pending}))); box.append(ul); }
    else if (!part.failed) { const note = dayRangeNote(key, selected, range); box.insertAdjacentHTML('beforeend', `<p class="journal-muted">${esc(note || empty)}</p>`); }
    return box;
  };
  const todo = column('todo', '할 일', part.todo || [], true, '이 날 기한인 남은 할 일이 없어요.');
  // 기한 지난 것: one folded line under 할 일.
  if (!part.loading && part.overdue?.length) {
    const fold = document.createElement('details');
    fold.className = 'journal-overdue'; fold.dataset.journalOverdue = '';
    fold.innerHTML = `<summary>기한 지난 것 ${part.overdue.length}</summary>`;
    const ul = document.createElement('ul'); ul.className = 'journal-items'; ul.append(...part.overdue.map(item => taskRow(item, {pending:true})));
    fold.append(ul); todo.append(fold);
  }
  const done = column('done', '한 일', part.done || [], false, '이 날 끝낸 할 일이 없어요.');
  const cols = document.createElement('div'); cols.className = 'journal-task-cols'; cols.append(todo, done);
  const after = document.createElement('div');
  partNotes(after, {...part, key:'tasks', label:'Google 할 일', items:[...(part.todo || []), ...(part.done || [])]});
  after.insertAdjacentHTML('beforeend', `<p class="journal-line-status" data-journal-task-status role="status" aria-live="polite">${esc(taskNote)}</p>`);
  host.replaceChildren(cols, ...after.childNodes);
}
function renderDay() {
  opens = new Map(); openSeq = 0;
  const card = dayCard(materials, selected, {kinds, tree:materials.catalog?.status === 'ok' ? materials.catalog.items : null});
  renderTasks(card);
  const host = $('[data-journal-materials]');
  // ④ 주간보고 재료: the three parts in the report's order; a part with nothing that day is not drawn.
  const report = document.createElement('section');
  report.className = 'journal-report'; report.dataset.journalReport = '';
  report.innerHTML = '<h4 class="journal-heading journal-report-title">주간보고 재료</h4>';
  const parts = card.report.filter(part => part.loading || part.failed || part.items.length);
  if (parts.length) { const grid = document.createElement('div'); grid.className = 'journal-report-parts'; grid.append(...parts.map(part => partBox(part, {heading:'h5'}))); report.append(grid); }
  else report.insertAdjacentHTML('beforeend', '<p class="journal-muted" data-journal-report-empty>이 날은 주간보고 재료가 없어요.</p>');
  // ⑤ 그 밖의 기록: folded by default; the summary line counts what is inside.
  const shown = card.others.filter(part => part.loading || part.failed || part.items.length);
  const others = document.createElement('details');
  others.className = 'journal-others'; others.dataset.journalOthers = ''; others.open = othersOpen;
  const loading = card.others.some(part => part.loading), count = othersCount(card.others);
  others.innerHTML = `<summary><span class="journal-heading">그 밖의 기록</span> <small class="journal-others-count" data-journal-others-count>${esc(count || (loading ? '불러오는 중…' : '없음'))}</small></summary>`;
  const body = document.createElement('div'); body.className = 'journal-others-parts';
  body.append(...shown.map(part => partBox(part, {heading:'h5'})));
  others.append(body);
  others.addEventListener('toggle', () => { othersOpen = others.open; });
  host.replaceChildren(report, others);
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
  renderWeekly($('[data-journal-weekly]'), weeklySummary({start, lines, linesState, materials, doneDays, kinds}), esc);
  hwpx?.refresh();
}
// WEEKLY-한글초안 2단계: [주간보고 한글 파일 만들기] — journal-hwpx.js owns that box; it reads the shown week's grouping.
const hwpx = mountWeeklyHwpx($('[data-journal-hwpx]'), {rt, onCopy: () => copyDraft(), getWeek: () => ({start, model:weeklySummary({start, lines, linesState, materials, doneDays, kinds})})});
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
  if (mode === 'week') renderWeekly_(); else { renderWeek(); renderLine({keepStatus:true}); renderDay(); radarDay(); }
}
function render() { renderMode(); renderWeek(); renderLine({keepStatus:true}); renderDay(); renderWeekly_(); radarDay(); }

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
  materials[key] = {status:'loading'}; renderDay(); renderWeekly_();
  try {
    const items = await readers[key]();
    if (!current(run, scope)) return;
    materials[key] = {status:'ok', items};
  } catch {
    if (!current(run, scope)) return;
    materials[key] = {status:'failed'};
  }
  renderDay(); renderWeekly_();
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
async function loadKinds(run, scope) {
  kinds = {status:'loading'};
  const read = await readKinds(rt);
  if (!current(run, scope)) return;
  kinds = read; renderDay(); renderWeekly_();
}
function loadWeek({shared = false} = {}) {
  const changedOwner = owner !== ownerScope(rt);
  const run = ++epoch, scope = owner = ownerScope(rt);
  lines = new Map(); status.textContent = ''; editing = null;
  if (changedOwner) hwpx?.close(); else hwpx?.setWeek(start);
  const keys = shared ? Object.keys(readers) : ['events', 'upcoming', 'orgUpdates', 'projectUpdates', 'meetings', 'documents', 'sharePages'];
  for (const key of keys) materials[key] = {status:'loading'};
  if (shared || changedOwner) loadKinds(run, scope);
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
  selected = day; editing = null; renderWeek(); renderLine(); renderDay(); radarDay();
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

// ── JOURNAL-하루개편 ⑥: open a line's original ──
// The org/project/meeting screens open through their own modules' open functions (the same ones the top line's ← → and
// todo-radar.js use); this module only asks and then marks the record. On a PC (≥1024) they open on their own screen — a
// history entry, so back or ← returns here. On the phone they open over this screen as the app's usual window, whose own
// history entry back closes. A basket update, a note and a task open on their screens as from the other screens.
let pendingReturn = null;
function rememberReturn(trigger) {
  pendingReturn = {owner:ownerScope(rt), start, day:selected, scroll:window.scrollY, focus:trigger};
}
const goView = view => window.KPTURouter?.go?.(view, {source:'delegated'});
// The record on the opened screen: scrolled to the middle and lit for a moment (journal.css [data-journal-flash]). Waits for the
// owner module to draw it (a few frames at most); a record that is not drawn (folded away, gone) leaves the screen as opened.
async function flashRecord(selector) {
  for (let i = 0; i < 90; i++) {
    const el = [...document.querySelectorAll(selector)].find(node => node.getClientRects().length);
    if (el) {
      el.scrollIntoView({block:'center', behavior:'instant'});
      el.removeAttribute('data-journal-flash'); void el.offsetWidth; el.setAttribute('data-journal-flash', '');
      el.addEventListener('animationend', () => el.removeAttribute('data-journal-flash'), {once:true});
      return true;
    }
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
  return false;
}
const RECORD = {
  org:record => { const [kind, id] = String(record || '').split(/:(.*)/s); return !id ? '' : kind === 'up' ? `#wdUpdates [data-wd-up="${CSS.escape(id)}"]` : `#wdUpdates [data-basket-link="${CSS.escape(id)}"]`; },
  project:record => { const [kind, id] = String(record || '').split(/:(.*)/s); return !id ? '' : kind === 'progress' ? `#ps3Body [data-ps3-record="${CSS.escape(id)}"]` : `#ps3Body [data-basket-link="${CSS.escape(id)}"]`; },
};
async function openOriginal(target, trigger) {
  const wide = !!WIDE?.matches, loader = window.KPTUViewLoader;
  status.textContent = '';
  try {
    if (target.type === 'note') { rememberReturn(trigger); requestBasketNote(target.note, rt); goView('basket'); return; }
    if (target.type === 'notedoc') { rememberReturn(trigger); requestNoteDocOpen(target.note, rt); goView('basket'); return; }
    if (target.type === 'task') { rememberReturn(trigger); requestTaskOpen(target.id, rt); goView('tasks'); return; }
    if (['calendar', 'library', 'pages'].includes(target.type)) { rememberReturn(trigger); goView(target.type); return; }
    if (target.type === 'meeting') {
      if (wide) {
        await loader.load('meetings'); rememberReturn(trigger);
        if (goView('meetings')) window.KPTUMeetingColumns?.select?.({id:String(target.id), kind:target.kind});
        return;
      }
      await loader?.prepare?.('meetings'); await import('./meeting-round-detail.js');
      if (!(await window.__KPTU_MEETING_ROUND_DETAIL_READY__)) throw new Error('meeting');
      await window.KPTUMeetingRoundDetail.open(target.id);
      return;
    }
    if (target.type === 'org' || target.type === 'project') {
      const org = target.type === 'org';
      await loader.load(org ? 'team' : 'projects');
      if (wide) { rememberReturn(trigger); if (!goView(org ? 'team' : 'projects')) { pendingReturn = null; return; } }
      await (org ? window.KPTUWorkplace.open(target.org) : window.KPTUProjects.open(target.project));
      const selector = RECORD[target.type](target.record);
      if (selector) await flashRecord(selector);
    }
  } catch {
    status.textContent = '원본을 열지 못했어요. 다시 시도해 주세요.';
  }
}
// [내일로]: the task's due date becomes tomorrow (journal-data.js moveTaskToTomorrow, the editor's own update action). The card
// shows the saved task; the other task screens hear the usual kptu:google-tasks-changed.
async function moveTomorrow(id) {
  const task = materials.tasks?.status === 'ok' ? materials.tasks.items.find(t => t.id === id) : null;
  if (!task || moving.has(id)) return;
  const scope = ownerScope(rt), name = task.title || '(제목 없음)';
  moving.add(id); taskNote = ''; renderDay();
  try {
    const saved = await moveTaskToTomorrow(task, rt);
    if (scope !== ownerScope(rt)) return;
    if (materials.tasks?.status === 'ok') materials.tasks = {status:'ok', items:materials.tasks.items.map(t => t.id === id ? {...t, ...saved} : t)};
    taskNote = `'${name}' 기한을 내일로 옮겼어요.`;
    window.KPTUGoogleTasks?.invalidateAfterCreate?.();
    window.dispatchEvent(new CustomEvent('kptu:google-tasks-changed'));
  } catch (error) {
    if (scope !== ownerScope(rt)) return;
    taskNote = error?.message && !error.status ? error.message : '기한을 바꾸지 못했어요. 다시 시도해 주세요.';
  } finally {
    moving.delete(id);
    if (scope === ownerScope(rt)) {
      renderDay();
      const again = root.querySelector(`[data-journal-task="${CSS.escape(id)}"] [data-journal-tomorrow]:not(.journal-task-more [data-journal-tomorrow])`);
      const head = root.querySelector('[data-journal-group="todo"] > h4');
      if (again && again.getClientRects().length) again.focus(); else if (head) { head.tabIndex = -1; head.focus(); }
    }
  }
}

async function copyDraft() {
  const text = weeklyReportText(weeklySummary({start, lines, linesState, materials, doneDays, kinds}));
  const ok = await copyText(text);
  // movedNotes, catalog (the project order) and this week's events (the day card's 일정) are not draft material.
  const missing = Object.entries(materials).some(([key, state]) => !['movedNotes', 'catalog', 'events'].includes(key) && state?.status !== 'ok');
  status.textContent = ok ? `주간보고 양식 순서로 복사했어요.${missing ? ' 불러오지 못한 묶음은 빠졌어요.' : ''}` : '복사하지 못했어요. 다시 시도해 주세요.';
}

// 주간보고에 올림 표시 바꾸기: only my profile's list column is written (journal-meeting-kinds.js); the screen follows the saved list.
async function toggleKind(key, hide, name) {
  if (kindsBusy || kinds.status !== 'ok') return;
  const scope = ownerScope(rt); kindsBusy = true; status.textContent = '';
  try {
    const result = await changeKind(key, hide, rt);
    if (scope !== ownerScope(rt)) return;
    if (result.ok) { kinds = {status:'ok', list:result.list}; status.textContent = hide ? `'${name}' 종류는 앞으로 주간보고에서 빼요.` : `'${name}' 종류를 주간보고에 다시 올려요.`; }
    else status.textContent = '저장하지 못했어요. 다시 시도해 주세요.';
    renderDay(); renderWeekly_();
  } finally { kindsBusy = false; }
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
  if (button.matches('[data-journal-kind-toggle]')) return toggleKind(button.dataset.journalKindToggle, button.dataset.journalKindHide === '1', button.dataset.journalKindName);
  if (button.matches('[data-journal-date]')) return selectDay(button.dataset.journalDate);
  if (button.matches('[data-journal-prev]')) return moveWeek(-1);
  if (button.matches('[data-journal-next]')) return moveWeek(1);
  if (button.matches('[data-journal-today]')) return goThisWeek();
  if (button.matches('[data-journal-retry]')) { for (const key of DAY_SOURCES[button.dataset.journalRetry] || []) if (materials[key]?.status === 'failed') loadGroup(key); return; }
  if (button.matches('[data-journal-open]')) { const target = opens.get(button.dataset.journalOpen); if (target) void openOriginal(target, button); return; }
  if (button.matches('[data-journal-original]')) { const target = opens.get(button.dataset.journalOriginal); button.closest('details')?.removeAttribute('open'); if (target) void openOriginal(target, button.closest('li')?.querySelector('[data-journal-open]') || button); return; }
  if (button.matches('[data-journal-tomorrow]')) { button.closest('details')?.removeAttribute('open'); return void moveTomorrow(button.dataset.journalTomorrow); }
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
  kinds = {status:'loading'}; drafts = new Map(); lines = new Map(); materials = {}; doneDays = DONE_TASK_DAYS; saving = false; editing = null; mode = 'day';
  pendingReturn = null; moving.clear(); taskNote = ''; othersOpen = false;
  start = weekStart(todayKey()); selected = todayKey();
  if (window.KPTURouter?.current === 'journal') enter();
});
// Each visit reads again from the week and day last seen in this sign-in (this week on the first visit) — except a return by
// back or the top line's ← from an original opened here (JOURNAL-하루개편 ⑥): then the card stays as it was, at the same scroll,
// with the focus back on the line that was pressed.
function enter(detail) {
  const back = pendingReturn; pendingReturn = null;
  if (back && back.owner === ownerScope(rt) && back.start === start && back.day === selected && ['popstate', 'trail', 'back'].includes(detail?.source)) {
    renderMode();
    window.scrollTo({top:back.scroll, behavior:'instant'});
    if (back.focus?.isConnected) back.focus.focus({preventScroll:true});
    return;
  }
  loadWeek({shared:true});
}
window.KPTURouter?.on?.('journal', enter);
// A renamed category list (자료실 분류) shows on the next draw of 자료실 새 자료.
window.addEventListener('kptu:document-categories-changed', () => { if (materials.documents?.status === 'ok') { renderDay(); renderWeekly_(); } });
window.KPTUJournal = {refresh:() => loadWeek({shared:true})};
if (window.KPTURouter?.current === 'journal') enter();
})();
