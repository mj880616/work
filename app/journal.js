import {waitHtml, waitInlineHtml, emptyHtml} from './wait-state.js';
// JOURNAL-일지 2단계(업무일지): the [일지] side of the schedule tab (?view=journal). This module is the only renderer of
// #journalRoot: the week's day-number row (Monday to Sunday, ‹ › moves a week, a green dot on days with a line — J4 ①)
// → the chosen day: "오늘 한 줄" on top, then that day's materials (일정·끝낸 할 일·조직 소식·회의·행사 결과 — JOURNAL-일지카드정리,
// then 프로젝트 소식·할 일 예정·자료실 새 자료·공유 페이지 — JOURNAL-주간보고허브),
// gathered on screen and never stored. [주간 정리]'s [복사] (beside [주간보고 한글 파일 만들기], journal-hwpx.js) copies the week as
// text in the weekly report form's order (journal-weekly.js weeklyReportText; 2026-10-21 사용자 승인). JOURNAL-주간정리다듬기
// (2026-10-22 사용자 결정): the top row has no copy button on either side any more.
// JOURNAL-오늘한줄목록: [저장] adds the typed line under the input (saving order, oldest first) and empties the input.
// Pressing a line turns it into an edit box in place with [저장][취소][삭제]; a removed line can be put back for 5 seconds
// ([되돌리기], the app's existing undo notice). No ⋯ menu or popup. On a PC (≥761) each line also has [수정][삭제], shown while
// the pointer is over the line or focus is inside it (journal.css); the phone keeps pressing the line.
// Only the lines are saved (journal-data.js, kind=work). A material group that cannot be read shows its own notice and
// [다시 시도]; the lines still work. A typed, unsaved line stays in memory per day until the owner changes.
// JOURNAL-주간보고허브 1단계: four more groups (프로젝트 소식·할 일 예정·자료실 새 자료·공유 페이지). A group with nothing on
// the day is not drawn as a box and is not named (JOURNAL-다듬기 removed the "기록 없는 묶음: …" line).
// JOURNAL-주간보고허브 2단계: [하루 | 주간 정리] above the week. [주간 정리] hides the day row and the day card and shows the same
// week's materials (the same reads, read once) in the weekly report's order (journal-weekly.js builds and draws it into
// [data-journal-weekly], a box this module owns). The chosen side is kept in memory only (not in browser storage).
// JOURNAL-하루개편 (2026-10-22 요청함 14:26·12:55): the [하루] card from top to bottom is ① 오늘 한 줄 → ② 할 일 / 한 일 (PC side by
// side from 761px, phone one above the other; 기한 지난 것 one folded line; JOURNAL-할일바로처리: each 할 일 line starts with a circle —
// pressing it completes the task (the task screen's own toggleTask) and the line moves to 한 일 with a 5-second [되돌리기]; each line's
// ⋯ holds [내일로 · 기한 바꾸기 · 고치기 · 지우기] (한 일: [다시 할 일로 · 고치기]) — on a PC (≥761) the ⋯ shows only on the line the
// pointer is over or focus is in, on the phone it is always shown; results are a short toast, not a line under the list) → ③ 그날 나온 챙길 것 (todo-radar.js draws it; this module only gives it its place) →
// ④ 주간보고 재료 in the report's order (회의·활동 결과 → 사업 소식 → 조직 소식) → ⑤ 그 밖의 기록, folded, with a count line.
// journal-data.js dayCard() builds the model; renderDay() below is the one renderer of ② and ④⑤ (the parts above are unchanged).
// ⑥ Every line opens its original (openOriginal): an organization or project record opens that screen at that record and
// highlights it for a moment; an update's ⋯ has [원래 업데이트 보기]. On a PC (≥761) the organization/project opens on its own
// screen (one history entry, so one back or the top line's ← returns here); on the phone it opens over this screen as the app's
// usual window (its own history entry), so one back also returns. Coming back by back/← keeps this card as it was (no re-read)
// and the same scroll and focus.
import './enter-save.js'; // UI-엔터저장: shared Enter-to-save rule for the data-enter-save roots below
import {weekStart, weekDays, shiftWeek, todayKey, ownerScope, readWorkWeek, changeWorkDay, validateWorkLine, WORK_LINE_MAX,
  workLines, addLine, editLine, removeLine, restoreLine, readWeekScheduleEvents, readDoneTasksWindow, readBasketUpdates, readMovedNotes, readOrgUpdates, readProjectUpdates,
  readWeekMeetings, readWeekDocuments, readWeekSharePages, readScheduleEvents, DONE_TASK_DAYS, WEEK_READ_CAP,
  dayCard, othersCount, DAY_SOURCES, dueDay, dayRangeNote, readWeekDrafts, requestDayDraft, readWeekCalls, readTaskMeetingNames, readUpcomingMilestones} from './journal-data.js';
import {dueLabel} from './task-due.mjs';
import {openGoogleEvent, eventAttrs} from './event-open.js';
import {shouldAskDraft, draftFor, draftMaterial} from './journal-draft-model.mjs';
import {loadWeekRefs, setIncluded} from './calendar-ref-data.js';
import {refsOnDay, daySummary, needsCheck} from './calendar-ref-model.mjs';
import {createTaskInline, objectParticle} from './task-inline.js';
import {loadDocumentCategories} from './document-categories.js';
import {formatSeoulTime, seoulParts, seoulClock} from './meeting-time.js';
import {copyText} from './copy-text.js';
import {offerUndoNotice, closeUndoNotice} from './basket-record-delete.js';
import {requestTagsHtml, normalizeRequests, noteRequests} from './update-requests.js';
import {recordMark} from './basket-link-records.js';
import {requestBasketNoteFrom, requestNoteDocFrom, requestTaskOpen, takeBasketReturn} from './basket-note-tasks.js';
import {weeklySummary, renderWeekly, weeklyReportText, renderNextWeekSheet} from './journal-weekly.js';
import {readNextWeekSheet, makeNextWeekSheet} from './next-week-sheet-data.js';
import {sheetView, shouldAutoMake, isAutoTime, seoulNow, openTarget as nextOpenTarget} from './next-week-sheet-model.mjs';
import {mountWeeklyHwpx} from './journal-hwpx.js';
import {requestLibraryDocument} from './basket-library-send.js';
import {readKinds, changeKind} from './journal-meeting-kinds.js';
import {readMemory, changeMemory, withoutKey, withRestored} from './weekly-schedule-memory.js';
import {readWeekDraft, changeWeekDocs, withDocEdit} from './weekly-draft-store.js';
import {mountHomeSummary} from './home-summary.js';
import {paintWeeklyLearn} from './weekly-learn-panel.js'; // WEEKLY-환류학습
import {readOrgSummaries, saveEditedSummary, requestOrgSummaries, resultMessage, cleanEdited} from './journal-org-summary.js';
import {readExecRequests, changeExecRequests, cleanItem, mergeCarried, isExecRecord} from './weekly-exec-requests.js';
import {readAutoPromises} from './journal-ledger.js';
import {readOverlapRows, askPairs, reviveOverlaps} from './overlap-weekly-data.js';
import {weekCandidates, reviveEdges, WEEK_BACK_WEEKS} from './overlap-weekly.mjs';

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

// HOME-업무일지홈(2026-10-30 명진 시안 v2 확정): 이 화면이 홈이다(#homeView, 라우터 이름 home). 위에서부터
//   날짜 제목·이번 주 날짜 줄(‹ 26 … 1 › 이번 주, 오늘은 갈색 테두리) → 요약 한 줄(home-summary.js) → 업데이트 입력줄(home-quick.js, 폰은 아래 고정)
//   → [그날 일정 | 할 일] 두 칸(PC 좌우, 폰 위아래) → 오늘 한 일(오늘 한 줄 + 끝낸 할 일) → 주간보고 재료·그 밖의 기록(접힘).
//   그날 나온 챙길 것 상자는 없앴다(요약 줄의 '챙길 것 n'이 정리함으로 간다). [하루 | 주간 정리]는 머리줄 오른쪽 끝.
root.innerHTML = `<div class="journal-head"><b class="journal-day-title" data-journal-title aria-live="polite"></b><div class="journal-week-nav"><button type="button" class="mini" data-journal-prev aria-label="이전 주">‹</button><div class="journal-days" data-journal-days role="group" aria-label="이번 주 날짜"></div><button type="button" class="mini" data-journal-next aria-label="다음 주">›</button><button type="button" class="mini" data-journal-today>이번 주</button></div><div class="journal-mode-switch" role="group" aria-label="홈 보기"><button type="button" data-journal-mode="day" aria-pressed="true">하루</button><button type="button" data-journal-mode="week" aria-pressed="false">주간 정리</button></div></div>
<p class="journal-status" data-journal-status role="status" aria-live="polite"></p>
<p class="home-summary" data-home-summary hidden></p>
<div class="home-quick-placeholder" aria-hidden="true"></div>
<section class="journal-day" data-journal-day>
<div class="journal-top-cols" data-journal-top-cols><section class="journal-group journal-schedule" data-journal-schedule aria-label="그날 일정"></section><section class="journal-tasks" data-journal-tasks aria-label="할 일"></section></div>
<section class="journal-done-day" data-journal-done-day aria-labelledby="journalDoneTitle"><h4 class="journal-heading" id="journalDoneTitle" data-journal-done-title>오늘 한 일</h4>
<form class="journal-line" data-journal-line data-enter-save novalidate><label class="a11y-only" for="journalLineInput">오늘 한 줄</label><div class="journal-line-row"><textarea id="journalLineInput" rows="2" data-journal-input data-enter-field="single" placeholder="오늘 한 일을 한 줄로 남겨 보세요" aria-describedby="journalLineCount journalLineStatus"></textarea><button type="submit" class="primary" data-journal-save>저장</button></div><div class="journal-line-meta"><small id="journalLineCount" data-journal-count></small><small class="journal-ai-note" data-journal-ai-note hidden>AI 초안 · 고쳐서 [저장]하면 확정</small><p id="journalLineStatus" class="journal-line-status" data-journal-line-status role="status" aria-live="polite"></p></div></form>
<ol class="journal-lines" data-journal-lines aria-label="이 날 한 줄 목록"></ol>
<div class="journal-done-tasks" data-journal-done-tasks></div>
</section>
<div class="journal-materials" data-journal-materials></div>
</section>
<section class="journal-weekly" data-journal-weekly-root aria-labelledby="journalWeeklyTitle" hidden><h3 id="journalWeeklyTitle" tabindex="-1" data-journal-weekly-title></h3><section class="journal-next-week" data-journal-next-week aria-label="다음 주 준비"></section><p class="journal-muted journal-weekly-intro">주간보고 양식 순서로 이 주 기록을 모았어요. 화면에서 보기만 하고 저장하지 않아요.</p><div class="journal-hwpx" data-journal-hwpx></div><div class="journal-weekly-body" data-journal-weekly></div></section>
<section class="home-quiet" data-home-quiet aria-labelledby="home-quiet-title" hidden></section>`;
const $ = selector => root.querySelector(selector);
// HOME-업무일지홈: 요약 한 줄과 업데이트 입력줄(home-summary.js · home-quick.js). 이 화면은 자리만 둔다.
// FEAT-1029묶음 ③ 연락 없는 조직: 홈 맨 아래 한 줄(org-quiet.js가 유일한 renderer, 무거운 읽기라 나중에 불러온다). 기준은 내 프로필 '수집·사용량' 칸.
void import('./org-quiet.js').then(({mountOrgQuiet}) => mountOrgQuiet(root.querySelector('[data-home-quiet]'))?.refresh()).catch(error => console.warn('org quiet load', error?.message || error));
const homeTop = mountHomeSummary({root:document.querySelector('#homeView') || root, line:root.querySelector('[data-home-summary]'), rt, onTasksChanged:() => refreshTasks()});
const days = $('[data-journal-days]'), input = $('[data-journal-input]'), lineStatus = $('[data-journal-line-status]'), status = $('[data-journal-status]');

let owner = ownerScope(rt), epoch = 0, sharedEpoch = 0;
let start = weekStart(todayKey()), selected = todayKey();
let lines = new Map(), linesState = 'loading';
let materials = {};
// JOURNAL-회의종류표시: my list of meeting kinds left out of the weekly report ({status:'loading'|'ok'|'unknown', list}); read once per visit.
let kinds = {status:'loading'}, kindsBusy = false;
// WEEKLY-환류: 주간보고 기억(내 프로필 칸 weekly_schedule_memory, weekly-schedule-memory.js) — read with the kinds; memoryUi = the folded list's state.
let memory = {status:'loading'}, memoryUi = {open:false, busy:false, status:'', error:false, undo:null};
// WEEKLY-자료요약 화면 ②: 자료 줄 [고치기]·[빼기]·[넣기] (그 주 임시저장 draft.docs, weekly-draft-store.js). fileUi = memory only.
const freshFileUi = () => ({editing:null, value:'', saving:false, status:'', error:false, open:new Set()});
let fileUi = freshFileUi();
// MTG-기록겹침거르기 4단계: 겹쳐서 뺀 줄 접힘·되살리기 상태(탭 메모리뿐, 판정은 서버 표에만 저장). overlapFor = 겹침 확인을 이미 한 주 읽기(epoch).
const freshOverlapUi = () => ({open:new Set(), busy:null, status:'', error:false});
let overlapUi = freshOverlapUi(), overlapFor = -1;
// JOURNAL-다음주준비: [다음 주] 칸 상태(탭 메모리뿐 — 장은 서버 표에만). nextAsked = 이번 방문에 자동 만들기를 이미 부른 주(owner:week).
let nextUi = {busy:false, message:'', error:false, open:new Set()};
const nextAsked = new Set();
let doneDays = DONE_TASK_DAYS; // days of finished tasks the Edge really covered (3 on an older Edge)
let drafts = new Map(), saving = false;
// JOURNAL-오늘한줄초안: days this visit already asked the server for an AI draft (owner:day; memory only, the server keeps one a day).
const draftAsked = new Set();
// The one line being edited in place: {day, index, before, value}.
let editing = null;
// HOME-업무일지홈 B: 할 일 id → 연결된 사업 보고 이름들(loadTaskMeetings).
let taskMeetings = new Map();
// 'day' (the day card) or 'week' ([주간 정리]); memory only.
let mode = 'day';
// JOURNAL-조직현황AI요약: the 4. 산하 조직 현황 summary controls of [주간 정리] (memory only; the summaries live in their table).
let orgUi = {busy:false, status:'', error:false, editing:null, open:new Set()};
// WEEKLY-임원요청정리: the request table's edit row (memory only; the rows themselves are saved on the server).
const freshExec = () => ({editing:null, draft:{}, status:'', error:false, invalid:'', saving:false});
let execUi = freshExec();
const current = (run, scope) => run === epoch && scope === ownerScope(rt);

function renderWeek() {
  const list = weekDays(start), today = todayKey(), last = list[6];
  // HOME-업무일지홈: 머리줄 제목은 [하루]면 고른 날('10월 30일 금요일'), [주간 정리]면 그 주 범위.
  $('[data-journal-title]').textContent = mode === 'week' ? `${monthDay(list[0])} ~ ${seoulParts(list[0]).month === seoulParts(last).month ? `${seoulParts(last).day}일` : monthDay(last)}` : longDay(selected);
  days.replaceChildren(...list.map((day, i) => {
    const button = document.createElement('button'), line = lines.get(day);
    button.type = 'button'; button.className = 'journal-date'; button.dataset.journalDate = day;
    if (i >= 5) button.classList.add(i === 6 ? 'sunday' : 'saturday');
    if (day === today) { button.setAttribute('aria-current', 'date'); button.classList.add('ds-today'); }
    button.setAttribute('aria-pressed', String(day === selected));
    button.setAttribute('aria-label', `${longDay(day)}${line ? ', 한 줄 있음' : ''}`);
    button.innerHTML = `<span class="journal-weekday" aria-hidden="true">${WEEKDAYS[i]}</span><span class="journal-num${day === today ? ' ds-today-num' : ''}" aria-hidden="true">${seoulParts(day).day}</span>${line ? '<span class="journal-dot" data-journal-dot aria-hidden="true"></span>' : ''}`;
    return button;
  }));
}
// HOME-업무일지홈: the chosen day is the head's title ([data-journal-title]) at every width, so the day card has no title line of its own
// (it is named by aria-label) and the PC top line stays "홈" (no kptu:where-item name).
function syncDayTitle() {
  const box = $('[data-journal-day]'); if (!box) return;
  box.querySelector('[data-journal-day-title]')?.remove(); box.removeAttribute('aria-labelledby'); box.setAttribute('aria-label', longDay(selected));
}
function renderLine({keepStatus = false} = {}) {
  syncDayTitle();
  // JOURNAL-오늘한줄초안: a day with no line shows its AI draft (not saved as a line yet) in dim text until it is edited or saved.
  const typed = drafts.get(selected), ai = typed === undefined && linesState === 'ok' ? aiDraft(selected) : '';
  input.value = typed ?? ai;
  input.classList.toggle('is-ai-draft', !!ai);
  $('[data-journal-ai-note]').hidden = !ai;
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
      item.innerHTML = `<textarea rows="2" data-journal-edit-input data-enter-field="single" aria-label="${index + 1}번째 줄 고치기" aria-describedby="journalEditCount journalEditStatus"></textarea><div class="journal-edit-meta"><small id="journalEditCount" data-journal-edit-count></small><p id="journalEditStatus" class="journal-line-status" data-journal-edit-status role="status" aria-live="polite"></p></div><div class="journal-edit-actions save-row"><button type="button" class="mini journal-delete save-row-start" data-journal-edit-delete>삭제</button><button type="button" class="mini" data-journal-edit-cancel>취소</button><button type="button" class="mini primary" data-journal-edit-save data-enter-save-submit>저장</button></div>`;
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
let opens = new Map(), openSeq = 0, othersOpen = false, calRefOpen = false, weeklyCalRefOpen = false;
// JOURNAL-할일바로처리: the Google task data stays where it is read (materials.tasks, one read for the whole week). The line's
// circle and ⋯ are the shared task-inline.js (TASK-바로처리통일), which changes a task only through the task screen's own functions
// (window.KPTUGoogleTasks toggleTask / deleteTask / openEditor) or the editor's update action (task-due.mjs moveTaskToDay) and asks
// this screen to draw the change (apply / saved / removed below). selfBusy > 0 while this screen itself changes a task, so the change
// event it causes does not trigger a second read.
let selfBusy = 0;
const keyFor = target => { if (!target) return ''; const key = `j${++openSeq}`; opens.set(key, target); return key; };
const WIDE = window.matchMedia?.('(min-width:761px)');
// ⋯ of one line: a native disclosure (as the meeting-kind ⋯ of [주간 정리]) holding small buttons.
function moreMenu(label, buttons) {
  const more = document.createElement('details');
  more.className = 'journal-item-more';
  more.innerHTML = `<summary aria-label="${esc(label)} 더 보기"><span class="more-dots" aria-hidden="true">⋯</span></summary>`;
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
// A task line: circle (complete; a filled circle on a finished one) + the text (opens the task) + ⋯ (journal.css shows it only on the
// hovered / focused line on a PC, always on the phone — ui-standard.css [data-task-inline-row]). [기한 바꾸기] is task-inline.js's date box.
function taskRow(item, {pending}) {
  const li = itemRow(item);
  li.dataset.journalTask = item.id; li.classList.add('journal-task-item');
  const name = item.text;
  // HOME-업무일지홈 B·C: 할 일 줄 끝에 기한(작은 진회색, task-due.mjs dueLabel — 없으면 안 씀)과 연결된 사업 보고 이름(흐린 글씨).
  // 할 일 화면처럼 제목 바로 아래 작은 줄(제목 버튼 글자에는 섞지 않는다).
  const open = li.querySelector('.journal-item-open');
  if (open && pending) {
    const due = dueLabel(dueDay(item.task)), meetings = taskMeetings.get(item.id);
    const parts = [due ? `<small class="task-due-text" data-journal-task-due>${esc(due)}</small>` : '', meetings?.length ? `<small class="task-meeting-text" data-journal-task-meeting>${esc(meetings.join(' · '))}</small>` : ''].filter(Boolean);
    if (parts.length) open.insertAdjacentHTML('afterend', `<span class="journal-task-meta">${parts.join('<span aria-hidden="true"> · </span>')}</span>`);
  }
  if (pending) {
    const check = document.createElement('button');
    check.type = 'button'; check.className = 'journal-check'; check.dataset.journalComplete = item.id;
    check.setAttribute('aria-label', `${name} 완료`); check.disabled = taskLine.isBusy(item.id);
    li.prepend(check);
  } else {
    const mark = document.createElement('span');
    mark.className = 'journal-check is-done'; mark.setAttribute('aria-hidden', 'true');
    li.prepend(mark);
  }
  li.dataset.taskInlineRow = '';
  const more = document.createElement('button');
  more.type = 'button'; more.className = 'journal-more-btn task-inline-more'; more.dataset.journalTaskMenu = item.id;
  more.setAttribute('aria-label', `${name} 더 보기`); more.setAttribute('aria-haspopup', 'true'); more.setAttribute('aria-expanded', 'false');
  more.setAttribute('aria-controls', 'journalTaskMenu'); more.disabled = taskLine.isBusy(item.id);
  more.innerHTML = '<span class="more-dots" aria-hidden="true">⋯</span>';
  li.append(more);
  return li;
}
function partNotes(box, part) {
  if (part.capped) box.insertAdjacentHTML('beforeend', `<p class="journal-muted" data-journal-capped>이 주에 ${WEEK_READ_CAP}개가 넘어 앞의 ${WEEK_READ_CAP}개만 모였어요.</p>`);
  if (part.failed) {
    box.dataset.failed = '';
    // UI-전수디자인점검 F24: 공용 실패 한 줄(wait-state.js .wait-fail 모양 — 작은 빨간 글자 + 작은 [다시]), 조사는 이름 끝 받침으로.
    box.insertAdjacentHTML('beforeend', `<p class="wait-fail journal-failed" data-journal-failed role="alert">${esc(part.label)}${part.items.length ? ' 일부를' : objectParticle(part.label)} 불러오지 못했어요. 한 줄은 그대로 쓸 수 있어요. <button type="button" class="wait-retry" data-journal-retry="${part.key}">다시</button></p>`);
  }
}
function partBox(part, {heading = 'h4'} = {}) {
  const box = document.createElement('section');
  box.className = 'journal-group'; box.dataset.journalGroup = part.key;
  const head = document.createElement(heading); head.className = 'journal-heading'; head.textContent = part.label; box.append(head);
  if (part.loading) { box.insertAdjacentHTML('beforeend', waitHtml({rows:2})); return box; }
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
// HOME-업무일지홈: 할 일 칸(그날 일정 칸 오른쪽, 폰은 아래)은 그날 기한인 할 일 + 기한 지난 것(접힌 한 줄)이고, 끝낸 할 일(한 일)은
// 아래 '오늘 한 일' 칸에 오늘 한 줄 목록 다음으로 그린다. 둘 다 이 함수가 유일한 renderer다.
function renderTasks(card) {
  const host = $('[data-journal-tasks]'), part = card.tasks, range = {doneDays};
  const box = document.createElement('section');
  box.className = 'journal-group journal-task-col'; box.dataset.journalGroup = 'todo';
  const head = document.createElement('div'); head.className = 'journal-schedule-head';
  const count = part.loading ? '' : String((part.todo || []).length + (part.overdue || []).length);
  head.innerHTML = `<span class="journal-head-name"><h4 class="journal-heading">할 일</h4><small class="journal-head-count" data-journal-todo-count>${count}</small></span><button type="button" class="journal-schedule-cal" data-journal-tasks-open aria-label="할 일 화면 열기">할 일 ›</button>`;
  box.append(head);
  if (part.loading) box.insertAdjacentHTML('beforeend', waitHtml({rows:2}));
  else {
    const items = part.todo || [];
    if (items.length) { const ul = document.createElement('ul'); ul.className = 'journal-items'; ul.append(...items.map(item => taskRow(item, {pending:true}))); box.append(ul); }
    else if (!part.failed) { const note = dayRangeNote('todo', selected, range); box.insertAdjacentHTML('beforeend', emptyHtml(note || '없음')); }
    // 기한 지난 것: one folded line under 할 일.
    if (part.overdue?.length) {
      const fold = document.createElement('details');
      fold.className = 'journal-overdue'; fold.dataset.journalOverdue = '';
      fold.innerHTML = `<summary>기한 지난 것 ${part.overdue.length}</summary>`;
      const ul = document.createElement('ul'); ul.className = 'journal-items'; ul.append(...part.overdue.map(item => taskRow(item, {pending:true})));
      fold.append(ul); box.append(fold);
    }
  }
  const after = document.createElement('div');
  partNotes(after, {...part, key:'tasks', label:'할 일', items:[...(part.todo || []), ...(part.done || [])]});
  host.replaceChildren(box, ...after.childNodes);
  // 오늘 한 일: 끝낸 할 일 줄(한 줄 목록 아래).
  const doneHost = $('[data-journal-done-tasks]'), done = document.createElement('section');
  done.className = 'journal-group journal-task-col journal-done-col'; done.dataset.journalGroup = 'done'; done.setAttribute('aria-label', '끝낸 할 일');
  if (part.loading) done.insertAdjacentHTML('beforeend', waitHtml({rows:1}));
  else if (part.done?.length) { const ul = document.createElement('ul'); ul.className = 'journal-items'; ul.append(...part.done.map(item => taskRow(item, {pending:false}))); done.append(ul); }
  else if (!part.failed) { const note = dayRangeNote('done', selected, range); if (note) done.insertAdjacentHTML('beforeend', emptyHtml(note)); }
  doneHost.replaceChildren(done);
  $('[data-journal-done-title]').textContent = selected === todayKey() ? '오늘 한 일' : '그날 한 일';
}
// JOURNAL-하루일정다시: 그날 일정 above 오늘 한 줄 — one line per event (time + the calendar's color bar + title; same look as the calendar's
// list rows), [달력 ›] at the right of the heading line. A line opens the calendar's own edit window (openOriginal 'event').
function eventRow(item) {
  const li = document.createElement('li');
  li.className = 'journal-event';
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'journal-item-open journal-event-open'; button.dataset.journalOpen = keyFor(item.open);
  button.setAttribute('aria-label', `${item.text} (일정 열기)`);
  const time = document.createElement('span'); time.className = 'journal-event-time'; time.textContent = item.time;
  const bar = document.createElement('span'); bar.className = 'journal-event-bar'; bar.setAttribute('aria-hidden', 'true');
  if (item.color) bar.style.setProperty('--journal-event-color', item.color);
  const title = document.createElement('span'); title.className = 'journal-event-title'; title.textContent = item.title;
  button.append(time, ' ', bar, ' ', title);
  li.append(button);
  return li;
}
function renderSchedule(card) {
  const host = $('[data-journal-schedule]'), part = card.events;
  const head = document.createElement('div'); head.className = 'journal-schedule-head';
  head.innerHTML = `<span class="journal-head-name"><h4 class="journal-heading">그날 일정</h4><small class="journal-head-count" data-journal-events-count>${part.loading ? '' : part.items.length}</small></span><button type="button" class="journal-schedule-cal" data-journal-calendar aria-label="이 날 달력 보기">달력 ›</button>`;
  host.replaceChildren(head);
  const dday = ddayLine();
  if (dday) host.append(dday);
  if (part.loading) { host.insertAdjacentHTML('beforeend', waitHtml({rows:2})); return; }
  if (part.items.length) { const ul = document.createElement('ul'); ul.className = 'journal-events'; ul.append(...part.items.map(eventRow)); host.append(ul); }
  else if (!part.failed) host.insertAdjacentHTML('beforeend', emptyHtml('없음', {attrs: 'data-journal-events-empty'}));
  partNotes(host, part);
  const refs = calRefFold();
  if (refs) host.append(refs);
}
// HOME-업무일지홈: 옛 홈 '주요 일정' D-day 칩(사업영역 주요 일정, 오늘부터 3개)은 오늘을 볼 때 그날 일정 칸 맨 위 한 줄. 3일 안은 진한 테두리.
// 달력에 이어진 것은 그 일정 수정 창(event-open.js), 아니면 그 사업영역 창. 못 읽거나 없으면 줄 없음.
function ddayLine() {
  const read = materials.milestones;
  if (selected !== todayKey() || read?.status !== 'ok' || !read.items?.length) return null;
  const line = document.createElement('div'); line.className = 'journal-dday'; line.dataset.journalDday = ''; line.setAttribute('aria-label', '주요 일정');
  line.innerHTML = read.items.map(m => `<button type="button" class="journal-dday-chip${m.days <= 3 ? ' is-soon' : ''}" data-journal-dday-project="${esc(m.project_id)}" ${m.google_event_id ? eventAttrs(m.google_event_id, m.google_calendar_id) : ''}>${m.days === 0 ? 'D-day' : 'D-' + m.days} ${esc(m.title)}</button>`).join('');
  return line;
}
// 원장 재료 C-4: 그날 참고 일정(개인 공유 캘린더)이 있으면 접힌 한 줄. 체크하면 원장·주간 정리 재료에 들어간다(설계 5.3).
// 체크를 바꾸면 명진이 정한 것(decided_by=user)이라 규칙이 다시 덮지 않는다. 일정 열기·고치기는 없다(제목과 시각만 저장한 참고 줄).
function calRefFold() {
  const read = materials.calendarRefs;
  if (read?.status !== 'ok' || !read.items?.configured) return null;
  const rows = refsOnDay(read.items.rows, selected), personal = read.items.personalByDay?.[selected] || 0;
  if (!rows.length && !personal) return null;
  const fold = document.createElement('details');
  fold.className = 'journal-calref'; fold.dataset.journalCalref = ''; fold.open = calRefOpen;
  fold.innerHTML = `<summary><small class="journal-others-count">${esc(rows.length ? daySummary(rows) : '개인 공유 캘린더 0')}${personal ? ` · 개인 ${personal}개 뺌` : ''}</small></summary>`;
  if (rows.length) {
    const ul = document.createElement('ul'); ul.className = 'journal-calref-list';
    for (const row of rows) ul.append(calRefItem(row));
    fold.append(ul);
  }
  fold.addEventListener('toggle', () => { calRefOpen = fold.open; });
  return fold;
}
function calRefItem(row) {
  const li = document.createElement('li'); li.dataset.journalCalrefRow = row.id;
  const label = document.createElement('label'); label.className = 'journal-calref-item';
  const box = document.createElement('input'); box.type = 'checkbox'; box.checked = !!row.included; box.dataset.journalCalrefCheck = row.id;
  const time = row.all_day || !row.start_at ? '' : seoulClock(row.start_at);
  const text = document.createElement('span'); text.textContent = `${time ? time + ' ' : ''}${row.title}${needsCheck(row) ? ' (애매)' : ''}`;
  label.append(box, text); li.append(label);
  return li;
}
function renderDay() {
  opens = new Map(); openSeq = 0;
  const card = dayCard(materials, selected, {kinds, tree:materials.catalog?.status === 'ok' ? materials.catalog.items : null});
  renderSchedule(card);
  renderTasks(card);
  const host = $('[data-journal-materials]');
  // ④ 주간보고 재료: the three parts in the report's order; a part with nothing that day is not drawn.
  const report = document.createElement('section');
  report.className = 'journal-report'; report.dataset.journalReport = '';
  report.innerHTML = '<h4 class="journal-heading journal-report-title">주간보고 재료</h4>';
  const parts = card.report.filter(part => part.loading || part.failed || part.items.length);
  if (parts.length) { const grid = document.createElement('div'); grid.className = 'journal-report-parts'; grid.append(...parts.map(part => partBox(part, {heading:'h5'}))); report.append(grid); }
  else report.insertAdjacentHTML('beforeend', emptyHtml('없음', {attrs: 'data-journal-report-empty'}));
  // ⑤ 그 밖의 기록: folded by default; the summary line counts what is inside.
  const shown = card.others.filter(part => part.loading || part.failed || part.items.length);
  const others = document.createElement('details');
  others.className = 'journal-others'; others.dataset.journalOthers = ''; others.open = othersOpen;
  const loading = card.others.some(part => part.loading), count = othersCount(card.others), failed = card.others.some(part => part.failed);
  // Folded, the summary still says when a part could not be read (its [다시 시도] is inside).
  others.innerHTML = `<summary><span class="journal-heading">그 밖의 기록</span> <small class="journal-others-count" data-journal-others-count>${count ? esc(count) : loading ? waitInlineHtml() : '없음'}</small>${failed ? '<small class="journal-failed" data-journal-others-failed>· 못 읽은 묶음 있음</small>' : ''}</summary>`;
  const body = document.createElement('div'); body.className = 'journal-others-parts';
  body.append(...shown.map(part => partBox(part, {heading:'h5'})));
  others.append(body);
  others.addEventListener('toggle', () => { othersOpen = others.open; });
  // LEDGER-자동기록: 그날 원장에 자동으로 기록된 약속이 있을 때만 한 줄(누르면 원장 화면의 약속 목록). 0건·못 읽음은 줄 없음.
  const promises = materials.ledgerPromises?.status === 'ok' ? materials.ledgerPromises.items.get(selected) || 0 : 0;
  const blocks = [report, others];
  if (promises > 0) {
    const line = document.createElement('p');
    line.className = 'journal-muted journal-ledger-line'; line.dataset.journalLedger = '';
    line.innerHTML = `<button type="button" class="journal-item-open" data-journal-ledger-open>새로 기록된 약속 ${promises}</button>`;
    blocks.unshift(line);
  }
  host.replaceChildren(...blocks);
}
// [주간 정리]: the week in report order. Drawn only while that side is shown; every read that lands redraws it.
function renderWeekly_() {
  if (mode !== 'week') return;
  const list = weekDays(start);
  $('[data-journal-weekly-title]').textContent = `주간 정리 · ${longDay(list[0])} ~ ${longDay(list[6])}`;
  const host = $('[data-journal-weekly]');
  // Keep which 원문 folds are open and the text being typed across redraws (a read landing must not lose them).
  // (a fold not drawn right now — its summary is being read again — keeps its last state.)
  for (const d of host.querySelectorAll('[data-journal-org-raw]')) { if (d.open) orgUi.open.add(d.dataset.journalOrgRaw); else orgUi.open.delete(d.dataset.journalOrgRaw); }
  const typing = host.querySelector('[data-journal-org-edit-input]'), focused = typing && typing === document.activeElement;
  if (typing && orgUi.editing?.id === typing.dataset.journalOrgEditInput) orgUi.editing.value = typing.value;
  // The request edit row keeps what is being typed and which field has the focus across redraws too.
  const execFocus = execDraftFromScreen(host);
  const memoryFold = host.querySelector('[data-journal-weekly-memory]'); if (memoryFold) memoryUi.open = memoryFold.open;
  const calRefFoldNow = host.querySelector('details[data-journal-weekly="note-calRefs"]'); if (calRefFoldNow) weeklyCalRefOpen = calRefFoldNow.open;
  // 자료 접힘(기록과 같아 뺀·뺀 자료)이 열려 있는지, 고치던 글과 초점도 다시 그려도 그대로.
  for (const d of host.querySelectorAll('[data-journal-file-fold-key]')) { if (d.open) fileUi.open.add(d.dataset.journalFileFoldKey); else fileUi.open.delete(d.dataset.journalFileFoldKey); }
  for (const d of host.querySelectorAll('[data-journal-overlap-fold]')) { if (d.open) overlapUi.open.add(d.dataset.journalOverlapFold); else overlapUi.open.delete(d.dataset.journalOverlapFold); }
  const fileInput = host.querySelector('[data-journal-file-edit-input]'), fileFocus = fileInput && fileInput === document.activeElement;
  if (fileInput && fileUi.editing === fileInput.dataset.journalFileEditInput) fileUi.value = fileInput.value;
  renderWeekly(host, weeklySummary({start, lines, linesState, materials, doneDays, kinds, memory}), esc, orgUi, execUi, memoryUi, fileUi, overlapUi);
  paintWeeklyLearn(host.querySelector('[data-journal-weekly-learn-slot]'), start); // WEEKLY-환류학습: 규칙·환류 보고(weekly-learn-panel.js)
  if (weeklyCalRefOpen) { const f = host.querySelector('details[data-journal-weekly="note-calRefs"]'); if (f) f.open = true; }
  if (fileFocus || (fileUi.editing && fileUi.focus)) { const f = host.querySelector('[data-journal-file-edit-input]'); if (f) { f.focus(); if (fileUi.focus) { f.select(); fileUi.focus = false; } } }
  renderNextWeek_();
  if (focused) host.querySelector('[data-journal-org-edit-input]')?.focus();
  if (execFocus) host.querySelector(`[data-journal-exec-field="${execFocus}"]`)?.focus();
  hwpx?.refresh();
}
// WEEKLY-한글초안 2단계: [주간보고 한글 파일 만들기] — journal-hwpx.js owns that box; it reads the shown week's grouping.
// WEEKLY-임원요청정리: it also gets the active project names (carry-over matching) and hands back last week's filtered request rows.
const projectNames = () => (materials.catalog?.status === 'ok' ? materials.catalog.items.map(entry => entry?.project?.name).filter(Boolean) : []);
// My '임원 요청' records (the update mark exec_schedule, or the words written in an update / organization / project record): the
// carry-over keeps last week's rows they point at. Only what this screen already read (the basket once a visit, the week's records).
const ok_ = key => (materials[key]?.status === 'ok' ? materials[key].items : null);
function execRecordTexts() {
  const out = [];
  for (const note of ok_('basket')?.notes ?? []) if (isExecRecord({text:note?.raw_text, requests:noteRequests(note)})) out.push(String(note.raw_text ?? ''));
  for (const row of ok_('orgUpdates') ?? []) if (isExecRecord({text:row?.raw_text})) out.push(String(row.raw_text));
  for (const row of ok_('projectUpdates') ?? []) if (isExecRecord({text:row?.summary})) out.push(String(row.summary));
  return out;
}
const hwpx = mountWeeklyHwpx($('[data-journal-hwpx]'), {rt, onCopy: () => copyDraft(), onCarry: (week, items) => carryRequests(week, items),
  // [확정] 뒤 [기억하기]: the box wrote my profile's memory; the screen follows the saved list.
  onMemory: list => { memory = {status:'ok', list}; renderWeekly_(); },
  getWeek: () => ({start, projects:projectNames(), requested:execRecordTexts(), model:weeklySummary({start, lines, linesState, materials, doneDays, kinds, memory})})});
function renderMode() {
  root.dataset.journalMode = mode;
  root.querySelectorAll('[data-journal-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.journalMode === mode)));
  days.hidden = mode === 'week';
  $('[data-journal-day]').hidden = mode === 'week';
  $('[data-journal-weekly-root]').hidden = mode !== 'week';
}
function setMode(next) {
  if (next === mode || !['day', 'week'].includes(next)) return;
  mode = next; editing = null;
  writePlace(); renderMode();
  if (mode === 'week') { renderWeek(); renderWeekly_(); void checkOverlaps(); maybeNextWeek(); } else { renderWeek(); renderLine({keepStatus:true}); renderDay(); }
}
// NAV-새로고침제자리: the day shown (?day=, left out for today) and [주간 정리] (?mode=week) are written to the address (no history
// entry of their own), so a reload opens the same day or the same weekly view; enter() reads them back.
function writePlace() {
  window.KPTURouter?.setPlace?.('home', {day:selected === todayKey() ? null : selected, mode:mode === 'week' ? 'week' : null});
}
function render() { writePlace(); renderMode(); renderWeek(); renderLine({keepStatus:true}); renderDay(); renderWeekly_(); }

// JOURNAL-오늘한줄초안: the AI draft of a day (only when the day has no line; '' otherwise or before the table exists).
const aiDraft = day => draftFor(materials.journalDrafts?.status === 'ok' ? materials.journalDrafts.items : null, day, !!lines.get(day));
// After 18:00 KST, on today with no line and no draft, ask the server once with the day's materials (일정·한 일·회의·소식·업무 통화).
// Waits until those reads have landed (a failed one is just left out). The server checks the same rules again and never overwrites.
const DRAFT_SOURCES = ['events', 'tasks', 'meetings', 'basket', 'orgUpdates', 'projectUpdates', 'calls', 'journalDrafts'];
// FEAT-1029묶음 ②: 18시(서울) 뒤 업무일지를 열면 내일 교섭·회의 전 한 장을 한 번 만든다(규칙·만들기는 pre-meeting-sheet.js 하나, 서버가 다시 봄).
function preMeetingAuto() {
  if (new Date(Date.now() + 9 * 3600 * 1000).getUTCHours() < 18) return;
  void import('./pre-meeting-sheet.js').then(m => m.autoMakeTomorrow(rt)).catch(() => {});
}
async function maybeDraft() {
  const day = todayKey(), key = `${ownerScope(rt)}:${day}`, read = materials.journalDrafts;
  if (mode !== 'day' || selected !== day || linesState !== 'ok' || read?.status !== 'ok') return;
  if (DRAFT_SOURCES.some(source => !materials[source] || materials[source].status === 'loading')) return;
  if (!shouldAskDraft({day, today:day, hour:seoulParts(new Date()).hour, hasLine:!!lines.get(day), drafts:read.items, asked:draftAsked.has(key)})) return;
  draftAsked.add(key);
  const card = dayCard(materials, day, {kinds, tree:materials.catalog?.status === 'ok' ? materials.catalog.items : null});
  let text = '';
  try { text = await requestDayDraft(day, draftMaterial(card), rt); } catch { text = ''; }
  if (!text || ownerScope(rt) !== key.slice(0, key.lastIndexOf(':')) || materials.journalDrafts !== read) return;
  read.items.map.set(day, text);
  if (selected === day && !saving && !editing) renderLine({keepStatus:true});
}

// JOURNAL-다음주준비: [주간 정리] 맨 위 [다음 주] 칸. 보이는 주의 다음 주 장(그 주 금요일에 만든 것)을 그린다.
function renderNextWeek_() {
  const box = $('[data-journal-next-week]');
  if (!box || mode !== 'week') return;
  for (const d of box.querySelectorAll('[data-journal-next-group]')) { if (d.open) nextUi.open.add(d.dataset.journalNextGroup); else nextUi.open.delete(d.dataset.journalNextGroup); }
  const read = materials.nextWeek, week = shiftWeek(start, 1), now = new Date();
  const state = !read || read.status === 'loading' ? 'loading' : read.status !== 'ok' ? 'failed' : read.items.missing ? 'missing' : 'ok';
  const sheet = state === 'ok' ? read.items.sheet : null;
  renderNextWeekSheet(box, {state, week, view:sheet ? sheetView(sheet, week) : null, canMake:start === seoulNow(now).thisMonday,
    afterTime:isAutoTime(now), busy:nextUi.busy, message:nextUi.message, error:nextUi.error, open:nextUi.open});
}
// 금요일 15시 뒤(또는 토·일) 이번 주 [주간 정리]가 처음 열릴 때 다음 주 장이 없으면 한 번 만든다(mode=auto). 서버가 같은 규칙을 다시
// 보고, 이미 있으면 덮지 않는다. [지금 만들기]·[다시 만들기]는 mode=user.
async function makeNextWeek(kind) {
  const run = epoch, scope = owner, week = shiftWeek(start, 1), thisMonday = start;
  if (nextUi.busy) return;
  nextUi.busy = true; nextUi.message = ''; nextUi.error = false; renderNextWeek_();
  let result;
  try { result = await makeNextWeekSheet({week, thisMonday, mode:kind}, rt); } catch { result = {ok:false, message:'만들지 못했어요. 잠시 뒤 다시 시도해 주세요.'}; }
  if (!current(run, scope)) { nextUi.busy = false; return; }
  nextUi.busy = false;
  if (result.ok) {
    if (result.sheet) materials.nextWeek = {status:'ok', items:{missing:false, sheet:result.sheet}};
    nextUi.message = kind === 'user' && result.sheet ? '다음 주 준비를 만들었어요.' : '';
  } else if (kind === 'user') { nextUi.message = result.message; nextUi.error = true; }
  else if (result.code === 'not_ready' || result.code === 'next_week_sheet_not_ready') materials.nextWeek = {status:'ok', items:{missing:true, sheet:null}};
  renderNextWeek_();
}
function maybeNextWeek() {
  if (mode !== 'week') return;
  const key = `${ownerScope(rt)}:${shiftWeek(start, 1)}`;
  if (!shouldAutoMake({shownStart:start, read:materials.nextWeek, asked:nextAsked.has(key)})) return;
  nextAsked.add(key);
  void makeNextWeek('auto');
}

const readers = {
  // JOURNAL-다음주준비: 보이는 주의 다음 주 장(표가 없으면 {missing:true}).
  nextWeek: () => readNextWeekSheet(shiftWeek(start, 1), rt),
  events: () => readWeekScheduleEvents(start, rt),
  // JOURNAL-오늘한줄초안: 업무 통화(업무 통화함만)와 그 주 AI 초안(표가 없으면 {missing:true}).
  calls: () => readWeekCalls(start, rt),
  journalDrafts: () => readWeekDrafts(start, rt),
  // 5. 주요 일정 of [주간 정리] and the draft: the two weeks from the Monday after the shown week (one more calendar read a week).
  upcoming: () => readScheduleEvents(start, rt),
  // One Google Tasks read: finished tasks (끝낸 할 일) and pending tasks in the server's range (할 일 예정).
  tasks: async () => { const read = await readDoneTasksWindow(rt); doneDays = read.days; return [...read.tasks, ...read.pending]; },
  // HOME-업무일지홈: 그날 일정 칸 안 D-day 주요 일정(오늘을 볼 때만 그린다).
  milestones: () => readUpcomingMilestones(rt),
  basket: () => readBasketUpdates(rt),
  movedNotes: () => readMovedNotes(rt),
  orgUpdates: () => readOrgUpdates(start, rt),
  projectUpdates: () => readProjectUpdates(start, rt),
  meetings: () => readWeekMeetings(start, rt),
  documents: () => { void loadDocumentCategories({rt}).catch(() => {}); return readWeekDocuments(start, rt); },
  sharePages: () => readWeekSharePages(start, rt),
  // JOURNAL-조직현황AI요약: the week's saved organization summaries (a missing table reads as {missing:true}).
  orgSummaries: () => readOrgSummaries(start, rt),
  // WEEKLY-임원요청정리: the week's request rows ({missing:true} before the table exists).
  execRequests: () => readExecRequests(start, rt),
  // WEEKLY-자료요약 화면 ②: 그 주 임시저장 행(자료 줄 고침 docs). 칸이 없으면 {missing:true} — 고침 버튼 없이 지금처럼.
  weekDraft: () => readWeekDraft(start, rt),
  // LEDGER-자동기록: 이 주에 자동으로 원장에 들어온 약속 수(날별). 표가 없으면 빈 값.
  ledgerPromises: () => readAutoPromises(start, rt),
  // 원장 재료 C-4: 개인 공유 캘린더 참고 일정(고르지 않았으면 아무 일도 안 함). 그 주와 다음 2주를 맞추고 그 주의 줄을 돌려준다.
  calendarRefs: () => loadWeekRefs(rt, weekDays(start)[0], shiftWeek(start, 1), shiftWeek(start, 3)),
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
// 방문당 한 번 읽는 재료(할 일·기록함 업데이트·옮긴 노트·프로젝트 트리)는 주를 넘겨도 다시 읽지 않으므로, 주 넘기기(epoch)가 아니라
// 방문(sharedEpoch)에 묶는다. 주를 먼저 넘기면 오는 중이던 읽기가 버려져 "불러오는 중"으로 남던 문제를 막는다.
// HOME-업무일지홈 B: 할 일을 읽을 때마다 연결된 사업 보고 이름을 한 번 다시 읽는다(taskMeetings, 탭 메모리만).
async function loadTaskMeetings(run, scope) {
  const pending = (materials.tasks?.items || []).filter(t => t?.id && t.status !== 'completed').map(t => t.id);
  try {
    const names = await readTaskMeetingNames(pending, rt);
    if (run !== sharedEpoch || scope !== ownerScope(rt)) return;
    taskMeetings = names; renderDay();
  } catch { /* 이름 없이 그대로 */ }
}
const SHARED_KEYS = new Set(['tasks', 'basket', 'movedNotes', 'catalog', 'milestones']);
const liveRun = (key, run, scope) => SHARED_KEYS.has(key) ? run === sharedEpoch && scope === ownerScope(rt) : current(run, scope);
async function loadGroup(key, run = SHARED_KEYS.has(key) ? sharedEpoch : epoch, scope = owner) {
  materials[key] = {status:'loading'}; renderDay(); renderWeekly_();
  try {
    const items = await readers[key]();
    if (!liveRun(key, run, scope)) return;
    materials[key] = {status:'ok', items};
  } catch {
    if (!liveRun(key, run, scope)) return;
    materials[key] = {status:'failed'};
  }
  renderDay(); renderWeekly_();
  if (key === 'tasks' && materials.tasks?.status === 'ok') void loadTaskMeetings(run, scope);
  void checkOverlaps();
  void maybeDraft();
  maybeNextWeek();
  preMeetingAuto();
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
  void maybeDraft();
}
// A new week reads its lines and that week's events (and the two weeks after it, 5. 주요 일정), organization/project records,
// meetings, new documents and changed share pages; Google tasks (done and pending) and basket updates are read once per visit (not per week).
async function loadKinds(run, scope) {
  kinds = {status:'loading'};
  const read = await readKinds(rt);
  if (run !== sharedEpoch || scope !== ownerScope(rt)) return;
  kinds = read; renderDay(); renderWeekly_();
  void checkOverlaps();
}
async function loadMemory(run, scope) {
  memory = {status:'loading'};
  const read = await readMemory(rt);
  if (run !== sharedEpoch || scope !== ownerScope(rt)) return;
  memory = read; renderWeekly_(); hwpx?.refresh();
}
function loadWeek({shared = false} = {}) {
  const changedOwner = owner !== ownerScope(rt);
  const run = ++epoch, scope = owner = ownerScope(rt);
  const sharedRun = shared || changedOwner ? ++sharedEpoch : sharedEpoch;
  overlapUi = freshOverlapUi(); nextUi = {busy:false, message:'', error:false, open:nextUi.open};
  lines = new Map(); status.textContent = ''; editing = null; orgUi = {busy:false, status:'', error:false, editing:null, open:new Set()}; execUi = freshExec(); fileUi = freshFileUi();
  if (changedOwner) hwpx?.close(); else hwpx?.setWeek(start);
  const keys = shared ? Object.keys(readers) : ['events', 'calls', 'journalDrafts', 'nextWeek', 'upcoming', 'orgUpdates', 'projectUpdates', 'meetings', 'documents', 'sharePages', 'orgSummaries', 'execRequests', 'weekDraft', 'ledgerPromises', 'calendarRefs'];
  for (const key of keys) materials[key] = {status:'loading'};
  delete materials.overlaps;
  if (shared || changedOwner) { loadKinds(sharedRun, scope); loadMemory(sharedRun, scope); memoryUi = {open:false, busy:false, status:'', error:false, undo:null}; }
  render();
  loadLines(run, scope);
  for (const key of keys) loadGroup(key, SHARED_KEYS.has(key) ? sharedRun : run, scope);
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
  selected = day; editing = null; writePlace(); renderWeek(); renderLine(); renderDay();
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
// todo-radar.js use); this module only asks and then marks the record. On a PC (≥761) they open on their own screen — a
// history entry, so back or ← returns here. On the phone they open over this screen as the app's usual window, whose own
// history entry back closes. A basket update, a note and a task open on their screens as from the other screens.
let pendingReturn = null;
function rememberReturn(trigger) {
  pendingReturn = {owner:ownerScope(rt), start, day:selected, scroll:window.scrollY, focus:trigger};
}
const goView = view => window.KPTURouter?.go?.(view, {source:'delegated'});
// The record on the opened screen: scrolled to the middle and lit for a moment (journal.css [data-journal-flash]). Waits for the
// owner module to draw it (a few frames at most); a record that is not drawn (folded away, gone) leaves the screen as opened.
// The owner module may draw its records once more right after opening (its link read lands); a record drawn again is marked again
// while the moment lasts, so the highlight is never lost to that redraw.
const FLASH_MS = 1600;
async function flashRecord(selector) {
  const find = () => [...document.querySelectorAll(selector)].find(node => node.getClientRects().length);
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  let el = null, until = 0;
  for (let i = 0; i < 90 && !el; i++) { el = find(); if (!el) await frame(); }
  if (!el) return false;
  const light = node => {
    node.scrollIntoView({block:'center', behavior:'instant'});
    node.removeAttribute('data-journal-flash'); void node.offsetWidth; node.setAttribute('data-journal-flash', '');
    node.addEventListener('animationend', () => node.removeAttribute('data-journal-flash'), {once:true});
  };
  light(el); until = performance.now() + FLASH_MS;
  while (performance.now() < until) {
    await frame();
    if (el.isConnected) continue;
    const again = find(); if (!again) return true;
    el = again; light(el);
  }
  return true;
}
// Phone: the organization/project/meeting opens as a window over this screen; when back (or its ×) closes it, the focus returns to
// the pressed line.
function refocusAfter(modalSelector, trigger, onClosed = null) {
  const modal = document.querySelector(modalSelector);
  if (!modal || !trigger) return;
  const watch = new MutationObserver(() => {
    if (!modal.classList.contains('hidden')) return;
    watch.disconnect();
    onClosed?.();
    requestAnimationFrame(() => {
      if (window.KPTURouter?.current !== 'home') return;
      // The project window writes ?project= into this screen's entry while it is open; once it is closed the journal's entry
      // must not keep it, or a later back to this entry would open the project again over the journal.
      const url = new URL(location.href);
      if (url.searchParams.has('project')) {
        url.searchParams.delete('project');
        const state = {...(history.state || {})}; delete state.project; delete state.kptuOverlay;
        history.replaceState(state, '', url.pathname + url.search + url.hash);
      }
      if (trigger.isConnected) trigger.focus({preventScroll:true});
    });
  });
  watch.observe(modal, {attributes:true, attributeFilter:['class']});
  window.addEventListener('kptu:view-changed', () => watch.disconnect(), {once:true});
}
const RECORD = {
  org:record => { const [kind, id] = String(record || '').split(/:(.*)/s); return !id ? '' : kind === 'up' ? `#wdUpdates [data-wd-up="${CSS.escape(id)}"]` : `#wdUpdates [data-basket-link="${CSS.escape(id)}"]`; },
  // MTG-프로젝트합치기 결정 ⑥: 사업영역 화면은 옛 진행 기록 줄을 그리지 않는다 → 그 기록은 사업영역 화면만 열고 강조할 줄은 없다.
  project:record => { const [kind, id] = String(record || '').split(/:(.*)/s); return !id || kind === 'progress' ? '' : `#ps3Body [data-basket-link="${CSS.escape(id)}"]`; },
};
// JOURNAL-다음주준비: 장의 한 줄(저장된 줄 번호) → 원래 기록. 약속은 원장 화면에서 그 약속을 펼친 채로, 챙길 것은 정리함.
async function openNextWeekLine(index, trigger) {
  const sheet = materials.nextWeek?.status === 'ok' ? materials.nextWeek.items.sheet : null;
  const target = nextOpenTarget(Array.isArray(sheet?.groups) ? sheet.groups[index] : null);
  if (!target) return;
  if (target.type === 'ledger') {
    try {
      await window.KPTUViewLoader?.load?.('ledger');
      rememberReturn(trigger);
      window.KPTULedgerBrowse?.show?.({openId:target.id});
      if (!goView('ledger')) pendingReturn = null;
    } catch { status.textContent = '원본을 열지 못했어요. 다시 시도해 주세요.'; }
    return;
  }
  if (target.type === 'todos') { rememberReturn(trigger); if (!goView('basket')) pendingReturn = null; return; }
  return openOriginal(target, trigger);
}
async function openOriginal(target, trigger) {
  const wide = !!WIDE?.matches, loader = window.KPTUViewLoader;
  status.textContent = '';
  try {
    // An update or a note opens in the basket as "opened from 업무일지" (basket-note-tasks.js): no history entry of its own, a
    // "← 업무일지로 돌아가기" line, and one back returns here.
    const from = {view:'home', id:selected, name:'홈'};
    if (target.type === 'note') { rememberReturn(trigger); requestBasketNoteFrom(target.note, from, rt); goView('basket'); return; }
    if (target.type === 'notedoc') { rememberReturn(trigger); requestNoteDocFrom(target.note, from, rt); goView('basket'); return; }
    if (target.type === 'task') { rememberReturn(trigger); requestTaskOpen(target.id, rt); goView('tasks'); return; }
    if (['calendar', 'library', 'pages'].includes(target.type)) { rememberReturn(trigger); goView(target.type); return; }
    // JOURNAL-하루일정다시: a 그날 일정 line opens the calendar's own edit window over this screen (the same window as a click on it in the
    // calendar, KPTUCalendarEvents.open); when it closes the day's events are read again (it may have been changed or deleted).
    if (target.type === 'event') {
      await loader.load('calendar');
      for (let i = 0; i < 300 && !window.__KPTU_CALENDAR_PERSISTENCE_READY__; i++) await new Promise(resolve => requestAnimationFrame(resolve));
      await window.__KPTU_CALENDAR_PERSISTENCE_READY__;
      if (!window.KPTUCalendarEvents?.open) throw new Error('calendar');
      window.KPTUCalendarEvents.open(target.id, target.calendarId);
      refocusAfter('#ciGoogleModal', trigger, () => { if (materials.events?.status === 'ok') void loadGroup('events'); if (materials.upcoming?.status === 'ok') void loadGroup('upcoming'); });
      return;
    }
    // [달력 ›]: that day in the calendar (the calendar view shows the week/month/list that holds it).
    if (target.type === 'calendar-day') {
      await loader.load('calendar'); rememberReturn(trigger);
      if (!goView('calendar')) { pendingReturn = null; return; }
      window.KPTUCalendarView?.showDay?.(target.day);
      return;
    }
    if (target.type === 'meeting') {
      if (wide) {
        await loader.load('meetings'); rememberReturn(trigger);
        if (!goView('meetings')) { pendingReturn = null; return; }
        // The meeting screen reads its list after it shows; choose the round once its row is drawn (the screen's own select).
        for (let i = 0; i < 300 && window.KPTURouter?.current === 'meetings'; i++) {
          if (document.querySelector(`#meetingList [data-meeting-round="${CSS.escape(String(target.id))}"], #meetingList [data-meeting-kind="${CSS.escape(target.kind || '')}"]`)) {
            window.KPTUMeetingColumns?.select?.({id:String(target.id), kind:target.kind});
            await flashRecord('#meetingList #mcolResult');
            break;
          }
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
        return;
      }
      await loader?.prepare?.('meetings'); await import('./meeting-round-detail.js');
      if (!(await window.__KPTU_MEETING_ROUND_DETAIL_READY__)) throw new Error('meeting');
      await window.KPTUMeetingRoundDetail.open(target.id);
      refocusAfter('#meetingRoundDetailModal', trigger);
      return;
    }
    if (target.type === 'org' || target.type === 'project') {
      const org = target.type === 'org';
      await loader.load(org ? 'team' : 'projects');
      // MTG-프로젝트합치기 ①: 사업영역은 화면이 아니라 창(area-window.js)이라 업무일지 위에 연다(닫으면 이 날 그대로).
      if (org && wide) { rememberReturn(trigger); if (!goView('team')) { pendingReturn = null; return; } }
      await (org ? window.KPTUWorkplace.open(target.org) : window.KPTUAreaWindow.open({ id: target.project, trigger }));
      if (!wide) refocusAfter(org ? '#wdModal' : '#ps3DetailModal', trigger);
      const selector = RECORD[target.type](target.record);
      if (selector) await flashRecord(selector);
    }
  } catch {
    status.textContent = '원본을 열지 못했어요. 다시 시도해 주세요.';
  }
}
// ── JOURNAL-할일바로처리: change one task from its line (task-inline.js does the change; this screen draws it) ──
const taskById = id => materials.tasks?.status === 'ok' ? materials.tasks.items.find(t => t.id === id) : null;
const patchTask = (id, patch) => { if (materials.tasks?.status === 'ok') materials.tasks = {status:'ok', items:materials.tasks.items.map(t => t.id === id ? (typeof patch === 'function' ? patch(t) : {...t, ...patch}) : t)}; };
const redraw = () => { renderDay(); renderWeekly_(); };
const groupOf = id => taskById(id)?.status === 'completed' ? 'done' : 'todo';
// After a line was changed or removed the focus would be lost with the redrawn row: it goes to the row's new place, else the heading.
function focusAfter(id, group) {
  const target = root.querySelector(`[data-journal-group="${group}"] [data-journal-task="${CSS.escape(id)}"] .journal-item-open`) || root.querySelector(`[data-journal-group="${group}"] > h4`);
  if (!target) return;
  if (target.tagName === 'H4') target.tabIndex = -1;
  target.focus({preventScroll:true});
}
const focusLost = () => !document.activeElement || document.activeElement === document.body;
const taskLine = createTaskInline({menuId:'journalTaskMenu', historyKey:'kptuJournalTaskMenu', menuAttr:'journalTaskMenu', find:id => taskById(id),
  begin:() => { selfBusy++; redraw(); },
  end:id => { selfBusy--; if (!current(epoch, owner)) return; redraw(); if (focusLost()) focusAfter(id, groupOf(id)); },
  // The circle: the line moves to 한 일 at once (and back when the save fails).
  apply:(id, done, original) => {
    patchTask(id, done === null ? t => ({...t, status:original.status, completed:original.completed ?? null})
      : done ? {status:'completed', completed:new Date().toISOString()} : {status:'needsAction', completed:null});
    redraw(); if (done !== null) focusAfter(id, done ? 'done' : 'todo');
  },
  saved:(id, task) => { patchTask(id, {...task}); redraw(); focusAfter(id, 'todo'); },
  removed:(id, task) => { materials.tasks = {status:'ok', items:materials.tasks.items.filter(t => t.id !== id)}; redraw(); focusAfter('', task.status === 'completed' ? 'done' : 'todo'); },
  reopenedText:task => dueDay(task) ? '다시 할 일로 돌려놨어요.' : '다시 할 일로 돌려놨어요. 기한이 없어 이 화면에는 안 보여요.'});
// A task changed somewhere else while this screen is shown (the editor window opened by [고치기]): read the tasks again, quietly.
let refreshSeq = 0;
async function refreshTasks() {
  if (materials.tasks?.status !== 'ok') return;
  const run = epoch, scope = owner, seq = ++refreshSeq;
  try {
    const items = await readers.tasks();
    if (!current(run, scope) || seq !== refreshSeq) return;
    materials.tasks = {status:'ok', items}; redraw();
  } catch { /* keep what is shown */ }
}
window.addEventListener('kptu:google-tasks-changed', () => { if (!selfBusy && window.KPTURouter?.current === 'home') void refreshTasks(); });

async function copyDraft() {
  const text = weeklyReportText(weeklySummary({start, lines, linesState, materials, doneDays, kinds, memory}));
  const ok = await copyText(text);
  // movedNotes, catalog (the project order) and this week's events (the day card's 일정) are not draft material.
  const missing = Object.entries(materials).some(([key, state]) => !['movedNotes', 'catalog', 'events', 'calls', 'journalDrafts', 'nextWeek', 'orgSummaries', 'weekDraft', 'overlaps'].includes(key) && state?.status !== 'ok');
  status.textContent = ok ? `주간보고 양식 순서로 복사했어요.${missing ? ' 불러오지 못한 묶음은 빠졌어요.' : ''}` : '복사하지 못했어요. 다시 시도해 주세요.';
  return ok;
}

// MTG-기록겹침거르기 4단계: [주간 정리]를 열 때 이 주에 보이는 줄의 겹침 표를 읽고, 판정이 없고 이어질 만한 짝만 서버 AI(overlap_check)에 물은 뒤
// (이번 주 포함 최근 WEEK_BACK_WEEKS주만, 한도·실패면 조용히 건너뜀) 표를 다시 읽어 모델에 넘긴다. 확인이 끝나기 전에는 아무것도 빼지 않는다(깜박임 방지).
// 표를 못 읽으면 빼는 것 없이 그대로 둔다.
async function checkOverlaps() {
  if (mode !== 'week' || overlapFor === epoch) return;
  if (['basket', 'projectUpdates', 'orgUpdates', 'meetings'].some(key => !materials[key] || materials[key].status === 'loading') || kinds?.status === 'loading') return;
  const run = epoch, scope = owner;
  overlapFor = run;
  const source = weeklySummary({start, lines, linesState, materials: {...materials, overlaps: undefined}, doneDays, kinds, memory}).overlapSource;
  materials.overlaps = {status:'loading'}; renderWeekly_();
  try {
    let read = await readOverlapRows(source.refs, rt);
    if (!current(run, scope)) return;
    if (!read.missing && start >= shiftWeek(weekStart(todayKey()), 1 - WEEK_BACK_WEEKS)) {
      const pairs = weekCandidates(source.records, source.meetings, read.rows);
      if (pairs.length && await askPairs(pairs, {rt}).catch(() => 0) > 0 && current(run, scope)) read = await readOverlapRows(source.refs, rt).catch(() => read);
    }
    if (!current(run, scope)) return;
    materials.overlaps = {status:'ok', items:read};
  } catch {
    if (!current(run, scope)) return;
    materials.overlaps = {status:'failed'};
  }
  renderWeekly_();
}
// [되살리기]: 그 줄이 겹침으로 이어진 짝을 사용자 판정 '같은 일 아님'(different)으로 서버에 쓰고, 성공하면 줄이 바로 돌아온다.
async function reviveOverlap(ref) {
  const read = materials.overlaps?.status === 'ok' ? materials.overlaps.items : null;
  if (overlapUi.busy || !read || read.missing) return;
  const source = weeklySummary({start, lines, linesState, materials, doneDays, kinds, memory}).overlapSource;
  const pairs = reviveEdges(ref, new Set(source.refs), read.rows);
  const run = epoch, scope = owner;
  overlapUi.busy = ref; overlapUi.status = ''; overlapUi.error = false; renderWeekly_();
  const saved = await reviveOverlaps(pairs, rt);
  if (!current(run, scope)) return;
  overlapUi.busy = null;
  if (saved) {
    const cut = new Set(pairs.map(p => `${p.a}|${p.b}`));
    materials.overlaps = {status:'ok', items:{missing:false, rows:[...read.rows.filter(r => !cut.has(`${r.a_ref}|${r.b_ref}`)), ...pairs.map(p => ({a_ref:p.a, b_ref:p.b, verdict:'different', decided_by:'user', reason:null}))]}};
    overlapUi.status = '되살렸어요.';
  } else { overlapUi.status = '되살리지 못했어요. 잠시 뒤 다시 눌러 주세요.'; overlapUi.error = true; }
  renderWeekly_();
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
// WEEKLY-자료요약 화면 ②: 자료 줄 고침 하나 → 그 주 임시저장 docs(다시 읽고 docs만 바꿔 조건부 쓰기). 그 주 보고 글만 바뀌고 자료 요약은 그대로.
async function changeFileEdit(id, patch, message) {
  if (fileUi.saving || materials.weekDraft?.status !== 'ok' || materials.weekDraft.items?.missing) return false;
  const run = epoch, scope = owner, week = start;
  fileUi.saving = true; fileUi.status = '저장하는 중…'; fileUi.error = false; renderWeekly_();
  try {
    const r = await changeWeekDocs({start:week, known:materials.weekDraft.items.row, change:draft => withDocEdit(draft, id, patch)}, rt);
    if (!current(run, scope)) return false;
    if (r.missing) { materials.weekDraft = {status:'ok', items:{missing:true, row:null}}; fileUi.status = '자료 줄 고침은 아직 준비 중이에요.'; return false; }
    materials.weekDraft = {status:'ok', items:{missing:false, row:r.row}};
    fileUi.status = message; return true;
  } catch {
    if (!current(run, scope)) return false;
    fileUi.status = '저장하지 못했어요. 다시 시도해 주세요.'; fileUi.error = true; return false;
  } finally { if (current(run, scope)) { fileUi.saving = false; renderWeekly_(); hwpx?.refresh(); } }
}
const fileItemText = id => root.querySelector(`[data-journal-weekly-file="${CSS.escape(id)}"] [data-journal-weekly-file-open]`)?.textContent ?? '';
function openFileEdit(id) { fileUi.editing = id; fileUi.value = fileItemText(id); fileUi.status = ''; fileUi.error = false; fileUi.focus = true; renderWeekly_(); }
function closeFileEdit() { const id = fileUi.editing; fileUi.editing = null; fileUi.value = ''; renderWeekly_(); if (id) root.querySelector(`[data-journal-weekly-file="${CSS.escape(id)}"] [data-journal-weekly-file-open]`)?.focus(); }
async function saveFileEdit(reset = false) {
  const id = fileUi.editing; if (!id) return;
  const input = root.querySelector('[data-journal-file-edit-input]'), value = String(input?.value ?? fileUi.value).replace(/\s+/g, ' ').trim();
  if (!reset && !value) { fileUi.status = '빈 줄은 저장하지 않아요. 빼려면 [빼기]를 써 주세요.'; fileUi.error = true; renderWeekly_(); return; }
  if (await changeFileEdit(id, {text:reset ? null : value}, reset ? '원래 줄로 되돌렸어요.' : '이번 주 보고 글만 고쳤어요(자료 요약은 그대로).')) closeFileEdit();
}
// WEEKLY-환류: '주간보고 기억'에서 [지우기] — 다시 읽고 그 항목만 빼서 내 프로필 칸에 쓴다. 바로 뒤 [되돌리기](몇 초)는 같은 항목을 다시 쓴다.
let undoTimer = 0;
async function changeMemoryFromList(change, done) {
  if (memoryUi.busy || memory.status !== 'ok') return;
  const scope = ownerScope(rt); memoryUi.busy = true; memoryUi.status = ''; memoryUi.error = false; renderWeekly_();
  try {
    const result = await changeMemory(change, rt);
    if (scope !== ownerScope(rt)) return;
    if (result.ok) { memory = {status:'ok', list:result.list}; done(); }
    else { memoryUi.status = '저장하지 못했어요. 다시 시도해 주세요.'; memoryUi.error = true; memoryUi.undo = null; }
  } finally { memoryUi.busy = false; renderWeekly_(); hwpx?.refresh(); }
}
function deleteMemory(key) {
  const entry = memory.status === 'ok' ? memory.list.find(e => e.key === key) : null;
  if (!entry) return;
  return changeMemoryFromList(list => withoutKey(list, key), () => {
    memoryUi.status = `‘${entry.origin}’ 기억을 지웠어요.`; memoryUi.undo = {entry};
    clearTimeout(undoTimer); undoTimer = setTimeout(() => { if (memoryUi.undo?.entry === entry) { memoryUi.undo = null; memoryUi.status = ''; renderWeekly_(); } }, 8000);
  });
}
function undoMemory() {
  const entry = memoryUi.undo?.entry;
  if (!entry) return;
  clearTimeout(undoTimer);
  return changeMemoryFromList(list => withRestored(list, entry), () => { memoryUi.status = `‘${entry.origin}’ 기억을 되돌렸어요.`; memoryUi.undo = null; });
}
// JOURNAL-조직현황AI요약 ----
// [요약 만들기]: one ai-assist call with the week and the shown organizations' ids; then the saved summaries are read again.
async function makeOrgSummaries() {
  const model = weeklySummary({start, lines, linesState, materials, doneDays, kinds, memory});
  const ids = (model.orgs.sections || []).map(section => section.id).filter(Boolean);
  if (orgUi.busy || !ids.length) return;
  const run = epoch, scope = owner, week = start;
  orgUi.busy = true; orgUi.status = ''; orgUi.error = false; renderWeekly_();
  const result = await requestOrgSummaries({start:week, organizationIds:ids});
  if (!current(run, scope)) return;
  orgUi.busy = false; orgUi.status = resultMessage(result); orgUi.error = !result.ok;
  if (result.ok) await loadGroup('orgSummaries', run, scope); else renderWeekly_();
  root.querySelector('[data-journal-org-ai-run]')?.focus();
}
function openOrgEdit(id) {
  const section = weeklySummary({start, lines, linesState, materials, doneDays, kinds, memory}).orgs.sections?.find(s => s.id === id);
  if (!section || orgUi.editing?.saving) return;
  orgUi.editing = {id, name:section.name, value:section.summary?.text || '', status:'', invalid:false, saving:false};
  renderWeekly_();
  const box = root.querySelector('[data-journal-org-edit-input]');
  box?.focus(); box?.setSelectionRange(box.value.length, box.value.length);
}
function closeOrgEdit() {
  const id = orgUi.editing?.id; orgUi.editing = null; renderWeekly_();
  root.querySelector(`[data-journal-org-edit-open="${id}"]`)?.focus();
}
async function saveOrgEdit() {
  const edit = orgUi.editing; if (!edit || edit.saving) return;
  const box = root.querySelector('[data-journal-org-edit-input]'); if (box) edit.value = box.value;
  try { cleanEdited(edit.value); } catch (error) { edit.status = error.message; edit.invalid = true; renderWeekly_(); root.querySelector('[data-journal-org-edit-input]')?.focus(); return; }
  const run = epoch, scope = owner, week = start, saved = materials.orgSummaries?.items?.get?.(edit.id) || null;
  edit.saving = true; edit.invalid = false; edit.status = '저장하는 중…'; renderWeekly_();
  try {
    await saveEditedSummary({start:week, organizationId:edit.id, row:saved, text:edit.value}, rt);
    if (!current(run, scope)) return;
    orgUi.editing = null; orgUi.status = `${edit.name} 요약을 저장했어요. 다시 만들어도 이 요약은 그대로예요.`; orgUi.error = false;
    await loadGroup('orgSummaries', run, scope);
    root.querySelector(`[data-journal-org-edit-open="${edit.id}"]`)?.focus();
  } catch (error) {
    if (!current(run, scope)) return;
    edit.saving = false; edit.status = error?.status === 401 ? '로그인이 필요해요. 다시 로그인한 뒤 저장해 주세요.' : '저장하지 못했어요. 다시 시도해 주세요.';
    renderWeekly_(); root.querySelector('[data-journal-org-edit-input]')?.focus();
  }
}
root.addEventListener('keydown', event => {
  if (event.target.matches?.('[data-journal-file-edit-input]') && !event.isComposing && event.keyCode !== 229) {
    if (event.key === 'Escape') { event.preventDefault(); closeFileEdit(); }
    else if (event.key === 'Enter') { event.preventDefault(); void saveFileEdit(); }
  }
  if (event.target.matches?.('[data-journal-org-edit-input]') && event.key === 'Escape' && !event.isComposing) { event.preventDefault(); closeOrgEdit(); }
  if (event.target.matches?.('[data-journal-exec-field]') && !event.isComposing && event.keyCode !== 229) {
    if (event.key === 'Escape') { event.preventDefault(); closeExecEdit(); }
    else if (event.key === 'Enter') { event.preventDefault(); void saveExecEdit(); }
  }
});
root.addEventListener('input', event => {
  if (!event.target.matches?.('[data-journal-exec-field]') || !execUi.editing) return;
  execUi.draft[event.target.dataset.journalExecField] = event.target.value;
  if (execUi.invalid === event.target.dataset.journalExecField) { execUi.invalid = ''; event.target.removeAttribute('aria-invalid'); }
});

// WEEKLY-임원요청정리 ---- 1. 요청사항 › 1) 임원 일정 배정·논의 요청: rows saved with the week (weekly-exec-requests.js).
function execDraftFromScreen(host) {
  if (!execUi.editing) return '';
  let focus = '';
  for (const input of host.querySelectorAll('[data-journal-exec-field]')) {
    execUi.draft[input.dataset.journalExecField] = input.value;
    if (input === document.activeElement) focus = input.dataset.journalExecField;
  }
  return focus;
}
const execRead = () => (materials.execRequests?.status === 'ok' && !materials.execRequests.items?.missing ? materials.execRequests.items : null);
const execRows = () => execRead()?.row?.items ?? [];
function openExecEdit(id) {
  if (execUi.saving || !execRead()) return;
  const item = id === 'new' ? null : execRows().find(row => row.id === id);
  if (id !== 'new' && !item) return;
  execUi = {...freshExec(), editing:id, draft:item ? {day:item.day, until:item.until || '', time:item.time, what:item.what, place:item.place, who:item.who} : {day:'', until:'', time:'', what:'', place:'', who:''}};
  renderWeekly_();
  root.querySelector('[data-journal-exec-field="day"]')?.focus();
}
function closeExecEdit(message = '') {
  const id = execUi.editing; execUi = {...freshExec(), status:message};
  renderWeekly_();
  (root.querySelector(`[data-journal-exec-edit="${id}"]`) || root.querySelector('[data-journal-exec-add]'))?.focus();
}
const execError = error => error?.status === 401 ? '로그인이 필요해요. 다시 로그인한 뒤 저장해 주세요.' : error?.code === 'changed' || error?.code === 'missing' || error?.code === 'too_many' ? error.message : '저장하지 못했어요. 다시 시도해 주세요.';
// One change of the week's rows; the screen then shows the saved row the server sent back.
async function writeExec(change, {carry = false} = {}) {
  const run = epoch, scope = owner, week = start, read = execRead();
  const result = await changeExecRequests({start:week, row:read?.row ?? null, change, carry}, rt);
  if (!current(run, scope)) return {stale:true};
  materials.execRequests = {status:'ok', items:{missing:false, row:result.row}};
  return result;
}
async function saveExecEdit() {
  if (!execUi.editing || execUi.saving) return;
  execDraftFromScreen(root);
  const id = execUi.editing;
  let item;
  try { item = cleanItem({...execUi.draft}, {id:id === 'new' ? undefined : id}); }
  catch (error) { execUi.status = error.message; execUi.error = true; execUi.invalid = error.field || ''; renderWeekly_(); root.querySelector(`[data-journal-exec-field="${execUi.invalid || 'day'}"]`)?.focus(); return; }
  execUi.saving = true; execUi.status = '저장하는 중…'; execUi.error = false; renderWeekly_();
  try {
    // An edited row is the owner's own now: the '지난주에서' mark goes.
    const result = await writeExec(list => (id === 'new' ? [...list, item] : list.some(row => row.id === id) ? list.map(row => (row.id === id ? item : row)) : [...list, item]));
    if (result.stale) return;
    closeExecEdit(id === 'new' ? '요청 줄을 더했어요.' : '요청 줄을 고쳤어요.');
  } catch (error) {
    execUi.saving = false; execUi.status = execError(error); execUi.error = true; renderWeekly_();
    root.querySelector('[data-journal-exec-field="what"]')?.focus();
  }
}
// Removes the row right away and offers [되돌리기] for 5 seconds (the app's undo notice), like the journal lines.
async function deleteExecRow(id) {
  if (execUi.saving) return;
  const removed = execRows().find(row => row.id === id);
  if (!removed) return;
  execUi.saving = true; execUi.status = '지우는 중…'; renderWeekly_();
  try {
    const result = await writeExec(list => list.filter(row => row.id !== id));
    if (result.stale) return;
  } catch (error) { execUi.saving = false; execUi.status = execError(error); execUi.error = true; renderWeekly_(); return; }
  closeExecEdit('');
  const scope = owner, week = start;
  offerUndoNotice({text:'요청 줄을 지웠어요.', onUndo:async () => {
    if (scope !== ownerScope(rt) || week !== start) return {status:'stale'};
    try {
      const back = await writeExec(list => (list.some(row => row.id === removed.id) ? null : [...list, removed]));
      if (back.stale) return {status:'stale'};
      renderWeekly_();
      return {status:'restored', message:'지운 요청 줄을 되돌렸어요.'};
    } catch (error) { return {status:'failed', message:execError(error)}; }
  }});
}
// From the .hwpx box: last week's request rows that are still to come and relate to my workplaces/projects, once a week.
// Returns {status:'saved'|'before'|'unsaved'|'failed'|'stale', added}.
async function carryRequests(week, items) {
  if (week !== start) return {status:'stale', added:0};
  // Not read yet (or the read failed): read the week's rows once more first, so a saved week is not carried twice.
  if (materials.execRequests?.status !== 'ok') { await loadGroup('execRequests', epoch, owner); if (week !== start) return {status:'stale', added:0}; }
  const read = materials.execRequests;
  if (read?.status !== 'ok' || read.items?.missing) return {status:'unsaved', added:0};
  if (read.items.row?.carried_at) return {status:'before', added:0};
  if (!items.length) return {status:'saved', added:0};
  try {
    let added = 0;
    const result = await writeExec((list, row) => { if (row?.carried_at) return null; const next = mergeCarried(list, items); added = next.length - list.length; return next; }, {carry:true});
    if (result.stale) return {status:'stale', added:0};
    renderWeekly_();
    return {status:result.skipped ? 'before' : 'saved', added:result.skipped ? 0 : added};
  } catch { return {status:'failed', added:0}; }
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
  if (button.matches('[data-journal-org-ai-run]')) return makeOrgSummaries();
  if (button.matches('[data-journal-org-edit-open]')) return openOrgEdit(button.dataset.journalOrgEditOpen);
  if (button.matches('[data-journal-org-edit-save]')) return saveOrgEdit();
  if (button.matches('[data-journal-org-edit-cancel]')) return closeOrgEdit();
  if (button.matches('[data-journal-exec-add]')) return openExecEdit('new');
  if (button.matches('[data-journal-exec-edit]')) return openExecEdit(button.dataset.journalExecEdit);
  if (button.matches('[data-journal-exec-save]')) return void saveExecEdit();
  if (button.matches('[data-journal-exec-cancel]')) return closeExecEdit();
  if (button.matches('[data-journal-exec-delete]')) return void deleteExecRow(button.dataset.journalExecDelete);
  if (button.matches('[data-journal-file-edit]')) return openFileEdit(button.dataset.journalFileEdit);
  if (button.matches('[data-journal-file-edit-save]')) return void saveFileEdit();
  if (button.matches('[data-journal-file-edit-reset]')) return void saveFileEdit(true);
  if (button.matches('[data-journal-file-edit-cancel]')) return closeFileEdit();
  if (button.matches('[data-journal-file-drop]')) return void changeFileEdit(button.dataset.journalFileDrop, {drop:true}, '이번 주 보고에서 뺐어요. 칸 아래 ‘뺀 자료’에서 다시 넣을 수 있어요.');
  if (button.matches('[data-journal-file-undrop]')) return void changeFileEdit(button.dataset.journalFileUndrop, {drop:null}, '다시 넣었어요.');
  if (button.matches('[data-journal-file-keep]')) return void changeFileEdit(button.dataset.journalFileKeep, {keep:true}, '이번 주 보고에 넣었어요.');
  if (button.matches('[data-journal-file-unkeep]')) return void changeFileEdit(button.dataset.journalFileUnkeep, {keep:null}, '다시 접었어요.');
  if (button.matches('[data-journal-overlap-revive]')) return void reviveOverlap(button.dataset.journalOverlapRevive);
  if (button.matches('[data-journal-memory-delete]')) return void deleteMemory(button.dataset.journalMemoryDelete);
  if (button.matches('[data-journal-memory-undo]')) return void undoMemory();
  if (button.matches('[data-journal-kind-toggle]')) return toggleKind(button.dataset.journalKindToggle, button.dataset.journalKindHide === '1', button.dataset.journalKindName);
  if (button.matches('[data-journal-date]')) return selectDay(button.dataset.journalDate);
  if (button.matches('[data-journal-prev]')) return moveWeek(-1);
  if (button.matches('[data-journal-next]')) return moveWeek(1);
  if (button.matches('[data-journal-today]')) return goThisWeek();
  if (button.matches('[data-journal-retry]')) { for (const key of DAY_SOURCES[button.dataset.journalRetry] || []) if (materials[key]?.status === 'failed') loadGroup(key); return; }
  // WEEKLY-자료요약: [주간 정리]의 자료 줄 → 자료실에서 그 자료를 연다(바구니·검색과 같은 열기 요청, 돌아오기는 다른 원본 열기와 같음).
  if (button.matches('[data-journal-weekly-file-open]')) { rememberReturn(button); requestLibraryDocument(button.dataset.journalWeeklyFileOpen, rt); goView('library'); return; }
  if (button.matches('[data-journal-calendar]')) { void openOriginal({type:'calendar-day', day:selected}, button); return; }
  // HOME-업무일지홈: 할 일 칸 머리 [할 일 ›] → 할 일 화면. D-day 칩 → 이어진 일정 수정 창, 아니면 그 사업영역 창.
  if (button.matches('[data-journal-tasks-open]')) { rememberReturn(button); goView('tasks'); return; }
  if (button.matches('[data-journal-dday-project]')) {
    if (button.dataset.googleEvent) { void openGoogleEvent(button.dataset.googleEvent, button.dataset.googleCalendar).catch(() => { status.textContent = '원본을 열지 못했어요. 다시 시도해 주세요.'; }); return; }
    void openOriginal({type:'project', project:button.dataset.journalDdayProject}, button); return;
  }
  // HOME-줄누르기 ⑦: [주간 정리]의 5. 주요 일정 칸·끝낸 할 일·할 일 예정 줄 → 하루 화면의 일정·할 일 줄과 같은 열기.
  if (button.matches('[data-journal-weekly-event]')) { void openOriginal({type:'event', id:button.dataset.journalWeeklyEvent, calendarId:button.dataset.journalWeeklyCalendar || 'primary'}, button); return; }
  if (button.matches('[data-journal-weekly-task]')) { void openOriginal({type:'task', id:button.dataset.journalWeeklyTask}, button); return; }
  // JOURNAL-다음주준비: [지금 만들기]·[다시 만들기], 줄 → 그 기록, 핵심 줄 → 근거 묶음을 열고 그 줄로.
  if (button.matches('[data-journal-next-make]')) { void makeNextWeek('user'); return; }
  if (button.matches('[data-journal-next-open]')) { void openNextWeekLine(Number(button.dataset.journalNextOpen), button); return; }
  if (button.matches('[data-journal-next-ref]')) {
    const li = root.querySelector(`[data-journal-next-item="${CSS.escape(button.dataset.journalNextRef)}"]`), fold = li?.closest('details');
    if (fold) { fold.open = true; nextUi.open.add(fold.dataset.journalNextGroup); }
    li?.scrollIntoView({block:'nearest'}); li?.querySelector('[data-journal-next-open]')?.focus({preventScroll:true});
    return;
  }
  if (button.matches('[data-journal-open]')) { const target = opens.get(button.dataset.journalOpen); if (target) void openOriginal(target, button); return; }
  if (button.matches('[data-journal-original]')) { const target = opens.get(button.dataset.journalOriginal); button.closest('details')?.removeAttribute('open'); if (target) void openOriginal(target, button.closest('li')?.querySelector('[data-journal-open]') || button); return; }
  if (button.matches('[data-journal-complete]')) return void taskLine.complete(button.dataset.journalComplete, button);
  if (button.matches('[data-journal-task-menu]')) return taskLine.openMenu(button);
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
  // JOURNAL-오늘한줄초안: once the AI draft is touched it is the owner's own unsaved text (an emptied draft stays empty).
  if (input.classList.contains('is-ai-draft')) { input.classList.remove('is-ai-draft'); $('[data-journal-ai-note]').hidden = true; }
  if (input.value === '' && !aiDraft(selected)) drafts.delete(selected); else drafts.set(selected, input.value);
  input.removeAttribute('aria-invalid');
  if (!saving) lineStatus.textContent = '';
  count();
});

window.addEventListener('kptu:session-changed', () => {
  if (owner === ownerScope(rt)) return;
  owner = ownerScope(rt); epoch++; sharedEpoch++;
  kinds = {status:'loading'}; memory = {status:'loading'}; memoryUi = {open:false, busy:false, status:'', error:false, undo:null}; fileUi = freshFileUi(); overlapUi = freshOverlapUi(); overlapFor = -1; drafts = new Map(); lines = new Map(); materials = {}; orgUi = {busy:false, status:'', error:false, editing:null, open:new Set()}; execUi = freshExec(); doneDays = DONE_TASK_DAYS; saving = false; editing = null; mode = 'day';
  pendingReturn = null; taskLine.close(); selfBusy = 0; othersOpen = false; taskMeetings = new Map();
  start = weekStart(todayKey()); selected = todayKey();
  if (window.KPTURouter?.current === 'home') enter();
});
// Each visit reads again from the week and day last seen in this sign-in (this week on the first visit) — except a return by
// back or the top line's ← from an original opened here (JOURNAL-하루개편 ⑥): then the card stays as it was, at the same scroll,
// with the focus back on the line that was pressed.
function enter(detail) {
  const back = pendingReturn; pendingReturn = null;
  homeTop?.enter();
  takeBasketReturn('home', rt); // an update/note opened from here has done its job once this screen shows again
  if (back && back.owner === ownerScope(rt) && back.start === start && back.day === selected && ['popstate', 'back'].includes(detail?.source)) {
    renderMode();
    window.scrollTo({top:back.scroll, behavior:'instant'});
    if (back.focus?.isConnected) back.focus.focus({preventScroll:true});
    writePlace();
    return;
  }
  const place = window.KPTURouter?.place?.('home') || {};
  if (/^\d{4}-\d{2}-\d{2}$/.test(place.day || '')) { selected = place.day; start = weekStart(place.day); }
  // HOME-업무일지홈: 홈 메뉴·로고·하단 탭으로 들어오면(주소에 날짜 없음) 오늘. 뒤로 가기로 돌아올 때는 보던 날 그대로.
  else if (!['popstate', 'back'].includes(detail?.source)) { selected = todayKey(); start = weekStart(selected); }
  if (place.mode === 'week') { mode = 'week'; editing = null; }
  else if (!['popstate', 'back'].includes(detail?.source) && !place.day) { mode = 'day'; editing = null; }
  loadWeek({shared:true});
}
window.KPTURouter?.on?.('home', enter);
// 원장 재료 C-4: 참고 일정 체크(하루 카드·주간 정리 같은 줄). 서버에 저장하고 같은 줄 상태를 바꿔 두 곳을 다시 그린다.
root.addEventListener('change', async event => {
  const box = event.target.closest?.('[data-journal-calref-check]');
  if (!box) return;
  const id = box.dataset.journalCalrefCheck, read = materials.calendarRefs, scope = ownerScope(rt), run = epoch;
  if (read?.status !== 'ok') return;
  box.disabled = true;
  try {
    const row = await setIncluded(rt, id, box.checked);
    if (run !== epoch || scope !== ownerScope(rt)) return;
    materials.calendarRefs = {status:'ok', items:{...read.items, rows:read.items.rows.map(r => r.id === id ? {...r, ...row} : r)}};
    status.textContent = '';
  } catch {
    if (run !== epoch || scope !== ownerScope(rt)) return;
    status.textContent = '참고 일정 체크를 저장하지 못했어요. 다시 눌러 주세요.';
  }
  renderDay(); renderWeekly_();
});
// LEDGER-자동기록: "새로 기록된 약속 N" → 원장 화면(약속만).
root.addEventListener('click', async event => {
  if (!event.target.closest?.('[data-journal-ledger-open]')) return;
  event.preventDefault();
  try {
    await window.KPTUViewLoader?.load?.('ledger');
    window.KPTULedgerBrowse?.show?.({kinds:['commitment']});
    window.KPTURouter?.go?.('ledger', {source:'delegated'});
  } catch (e) { console.error('journal ledger open', e?.name || 'Error'); }
});
// A renamed category list (자료실 분류) shows on the next draw of 자료실 새 자료.
window.addEventListener('kptu:document-categories-changed', () => { if (materials.documents?.status === 'ok') { renderDay(); renderWeekly_(); } });
// SEARCH-전체검색: a search result line of 업무일지 opens that day (its week, then the day).
function showDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return;
  if (mode !== 'day') setMode('day');
  const week = weekStart(day);
  if (week === start) { selectDay(day); return; }
  start = week; selected = day; loadWeek();
}
// MTG-프로젝트합치기 2단계: 사업 보고 [사업요약표 미리보기]의 [HWP로 내려받기] — 그 주의 [주간 정리]를 열고 기존 주간보고 한글 파일 상자를 연다
// (한글 양식·직전 주 확정본 담당 표기 규칙은 journal-hwpx.js 그대로, 결정 ③).
function showWeek(day, {hwpx:openHwpx = false} = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return;
  const week = weekStart(day);
  if (week !== start) { start = week; selected = day; loadWeek(); }
  if (mode !== 'week') setMode('week');
  if (openHwpx) queueMicrotask(() => $('[data-journal-hwpx] [data-hwpx-start]:not([hidden])')?.click());
}
window.KPTUJournal = {refresh:() => loadWeek({shared:true}), show:showDay, showWeek};
if (window.KPTURouter?.current === 'home') enter();
})();
