// JOURNAL-일지 2단계(업무일지): the [일지] side of the schedule tab (?view=journal). This module is the only renderer of
// #journalRoot: the week's day-number row (Monday to Sunday, ‹ › moves a week, a green dot on days with a line — J4 ①)
// → the chosen day: "오늘 한 줄" on top, then that day's materials (일정·끝낸 할 일·바구니 메모·고친 노트), gathered
// on screen and never stored. [주간보고 초안 복사] copies the week's seven lines and the materials list.
// Only the line is saved (journal-data.js, kind=work). A material group that cannot be read shows its own notice and
// [다시 시도]; the line still works. A typed, unsaved line stays in memory per day until the owner changes.
import {weekStart, weekDays, shiftWeek, todayKey, ownerScope, readWorkWeek, saveWorkLine, validateWorkLine, WORK_LINE_MAX,
  readWeekEvents, readDoneTasks, readBasketMemos, readChangedNotes, dayMaterials, weeklyDraft, DONE_TASK_DAYS} from './journal-data.js';
import {formatSeoulTime, seoulParts, seoulDateKey, addSeoulDays} from './meeting-time.js';
import {copyText} from './md-editor.js';

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

root.innerHTML = `<div class="journal-head"><div class="journal-week-nav"><button type="button" class="mini" data-journal-prev aria-label="이전 주">‹</button><b data-journal-title aria-live="polite"></b><button type="button" class="mini" data-journal-next aria-label="다음 주">›</button><button type="button" class="mini" data-journal-today>이번 주</button></div><button type="button" class="secondary" data-journal-copy>주간보고 초안 복사</button></div>
<p class="journal-status" data-journal-status role="status" aria-live="polite"></p>
<div class="journal-days" data-journal-days role="group" aria-label="이번 주 날짜"></div>
<section class="journal-day" data-journal-day aria-labelledby="journalDayTitle">
<h3 id="journalDayTitle" tabindex="-1" data-journal-day-title></h3>
<form class="journal-line" data-journal-line novalidate><label for="journalLineInput">오늘 한 줄</label><div class="journal-line-row"><textarea id="journalLineInput" rows="2" data-journal-input placeholder="오늘 한 일을 한 줄로 남겨 보세요" aria-describedby="journalLineCount journalLineStatus"></textarea><button type="submit" class="primary" data-journal-save>저장</button></div><div class="journal-line-meta"><small id="journalLineCount" data-journal-count></small><p id="journalLineStatus" class="journal-line-status" data-journal-line-status role="status" aria-live="polite"></p></div></form>
<div class="journal-materials" data-journal-materials></div>
</section>`;
const $ = selector => root.querySelector(selector);
const days = $('[data-journal-days]'), input = $('[data-journal-input]'), lineStatus = $('[data-journal-line-status]'), status = $('[data-journal-status]');

let owner = ownerScope(rt), epoch = 0;
let start = weekStart(todayKey()), selected = todayKey();
let lines = new Map(), linesState = 'loading';
let materials = {};
let drafts = new Map(), saving = false;
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
  const row = lines.get(selected);
  input.value = drafts.has(selected) ? drafts.get(selected) : row?.raw_text || '';
  input.disabled = saving || linesState === 'loading';
  $('[data-journal-save]').disabled = saving || linesState === 'loading';
  $('[data-journal-save]').textContent = row ? '고치기' : '저장';
  if (!keepStatus) lineStatus.textContent = linesState === 'failed' ? '저장된 한 줄을 불러오지 못했어요. 지금 쓰면 그날 한 줄로 저장해요.' : '';
  count();
}
function count() {
  const n = length(input.value.trim());
  const counter = $('[data-journal-count]');
  counter.textContent = `${n}/${WORK_LINE_MAX}자`;
  counter.classList.toggle('over', n > WORK_LINE_MAX || /[\r\n]/.test(input.value));
}
function renderMaterials() {
  const host = $('[data-journal-materials]');
  const groups = dayMaterials(materials, selected);
  host.replaceChildren(...groups.map(group => {
    const box = document.createElement('section');
    box.className = 'journal-group'; box.dataset.journalGroup = group.key;
    const head = document.createElement('h4'); head.textContent = group.label; box.append(head);
    if (group.loading) { box.insertAdjacentHTML('beforeend', '<p class="journal-muted">불러오는 중…</p>'); return box; }
    if (group.failed) {
      box.dataset.failed = '';
      box.insertAdjacentHTML('beforeend', `<p class="journal-muted journal-failed" data-journal-failed>${esc(group.label)}을(를) 불러오지 못했어요. 한 줄은 그대로 쓸 수 있어요.</p><button type="button" class="mini" data-journal-retry="${group.key}">다시 시도</button>`);
      return box;
    }
    if (!group.items.length) {
      const old = group.key === 'tasks' && selected < seoulDateKey(addSeoulDays(todayKey(), -(DONE_TASK_DAYS - 1)));
      box.insertAdjacentHTML('beforeend', `<p class="journal-muted">${old ? `Google 할 일은 최근 ${DONE_TASK_DAYS}일 안에 끝낸 것만 모여요.` : '없어요.'}</p>`);
      return box;
    }
    const list = document.createElement('ul');
    for (const text of group.items) { const item = document.createElement('li'); item.textContent = text; list.append(item); }
    box.append(list);
    return box;
  }));
}
function render() { renderWeek(); renderLine({keepStatus:true}); renderMaterials(); }

const readers = {
  events: () => readWeekEvents(start, rt),
  tasks: () => readDoneTasks(rt),
  memos: () => readBasketMemos(rt),
  notes: () => readChangedNotes(start, rt),
};
async function loadGroup(key, run = epoch, scope = owner) {
  materials[key] = {status:'loading'}; renderMaterials();
  try {
    const items = await readers[key]();
    if (!current(run, scope)) return;
    materials[key] = {status:'ok', items};
  } catch {
    if (!current(run, scope)) return;
    materials[key] = {status:'failed'};
  }
  renderMaterials();
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
  renderWeek(); renderLine();
}
// A new week reads its lines, events and notes; done tasks and basket memos are read once per visit (not per week).
function loadWeek({shared = false} = {}) {
  const run = ++epoch, scope = owner = ownerScope(rt);
  lines = new Map(); status.textContent = '';
  const keys = shared ? Object.keys(readers) : ['events', 'notes'];
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
  selected = day; renderWeek(); renderLine(); renderMaterials();
}

async function save() {
  if (saving || linesState === 'loading') return;
  const day = selected, text = input.value;
  let line;
  try { line = validateWorkLine(text); } catch (error) { lineStatus.textContent = error.message; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
  input.removeAttribute('aria-invalid');
  const row = lines.get(day) || null;
  if (row && row.raw_text === line) { drafts.delete(day); lineStatus.textContent = '바뀐 내용이 없어요.'; return; }
  const run = epoch, scope = owner;
  saving = true; renderLine({keepStatus:true}); lineStatus.textContent = '저장하는 중…';
  try {
    const saved = await saveWorkLine({day, row, text}, rt);
    if (scope !== ownerScope(rt)) return;
    drafts.delete(day);
    if (run === epoch || weekDays(start).includes(day)) lines.set(saved.journal_day, saved);
    saving = false; renderWeek(); renderLine({keepStatus:true});
    lineStatus.textContent = row ? '한 줄을 고쳤어요.' : '한 줄을 저장했어요.';
  } catch (error) {
    if (scope !== ownerScope(rt)) return;
    saving = false; renderLine({keepStatus:true});
    lineStatus.textContent = error?.status === 401 ? '로그인이 필요해요. 다시 로그인한 뒤 저장해 주세요.'
      : error?.status === 400 ? '한 줄 규칙에 맞지 않아 저장하지 못했어요. 줄바꿈 없이 300자 안으로 써 주세요.'
      : error?.message && !error.status ? error.message : '한 줄을 저장하지 못했어요. 다시 시도해 주세요.';
  }
}

async function copyDraft() {
  const text = weeklyDraft({start, lines, materials});
  const ok = await copyText(text);
  const missing = Object.values(materials).some(state => state?.status !== 'ok');
  status.textContent = ok ? `이번 주 한 줄과 재료 목록을 복사했어요.${missing ? ' 불러오지 못한 묶음은 빠졌어요.' : ''}` : '복사하지 못했어요. 다시 시도해 주세요.';
}

root.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || !root.contains(button) || button.disabled) return;
  if (button.matches('[data-journal-date]')) return selectDay(button.dataset.journalDate);
  if (button.matches('[data-journal-prev]')) return moveWeek(-1);
  if (button.matches('[data-journal-next]')) return moveWeek(1);
  if (button.matches('[data-journal-today]')) return goThisWeek();
  if (button.matches('[data-journal-retry]')) return loadGroup(button.dataset.journalRetry);
  if (button.matches('[data-journal-copy]')) return copyDraft();
});
$('[data-journal-line]').addEventListener('submit', event => { event.preventDefault(); save(); });
// Enter saves (a line has no line break); Shift+Enter is refused the same way as a pasted line break.
input.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); if (!event.shiftKey) save(); else lineStatus.textContent = '한 줄로 써 주세요. 줄바꿈은 넣을 수 없어요.'; }
});
input.addEventListener('input', () => {
  const row = lines.get(selected);
  if (input.value === (row?.raw_text || '')) drafts.delete(selected); else drafts.set(selected, input.value);
  input.removeAttribute('aria-invalid');
  if (!saving) lineStatus.textContent = '';
  count();
});

window.addEventListener('kptu:session-changed', () => {
  if (owner === ownerScope(rt)) return;
  owner = ownerScope(rt); epoch++;
  drafts = new Map(); lines = new Map(); materials = {}; saving = false;
  start = weekStart(todayKey()); selected = todayKey();
  if (window.KPTURouter?.current === 'journal') enter();
});
// Each visit reads again from the week and day last seen in this sign-in (this week on the first visit).
function enter() { loadWeek({shared:true}); }
window.KPTURouter?.on?.('journal', enter);
window.KPTUJournal = {refresh:() => loadWeek({shared:true})};
if (window.KPTURouter?.current === 'journal') enter();
})();
