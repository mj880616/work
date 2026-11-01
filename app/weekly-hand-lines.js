// WEEKLY-한흐름확정 ⑤ 남은 부분(요청함 11/01 01:20·01:24 — "모든 묶음에 [+ 추가]"): [주간 정리] '5. 주요 일정'과 '참고'의 손으로 더한 줄.
// 다른 묶음과 같은 모양: 묶음 제목 줄 오른쪽 작은 [+ 추가], 줄 끝 작은 ⋯([고치기]·[지우기]) — row-more.js.
// - 5. 주요 일정: 표 줄은 journal-weekly.js 가 달력 일정과 함께 그린다(손 표시 + ⋯, data-journal-hand-fix·delete="calendar:id").
//   이 자리는 [+ 추가]·고치기 칸(2) 주요 일정 줄과 같은 부품 dayRowForm — 날짜·시간·내용·장소)·결과 한 줄만 그린다. 날짜는 그 표의 2주 안.
// - 참고: 이 자리가 '내 메모' 줄(⋯)·[+ 추가]·한 줄 칸을 모두 그린다.
// - 저장: 그 주 주간보고 행 draft.hand(weekly-hand.mjs) — 누름 한 번 = changeWeekDocs 한 번(다시 읽고 그 칸만, 동작 기록 picks 를 같은 쓰기에).
// 자리 하나의 그리기 주인은 이 모듈 하나(journal.js 는 자리만 찾아 부른다). 브라우저 저장소에 아무것도 두지 않는다. 글은 로그에 쓰지 않는다.
import {changeWeekDocs, draftHand, withHand, withLinePick} from './weekly-draft-store.js';
import {withHandRow, withoutHandRow, handText, HAND_CALENDAR_MAX, HAND_NOTES_MAX, HAND_NOTE_MAX} from './weekly-hand.mjs';
import {cleanTime} from './weekly-schedule-rows.mjs';
import {dayRowForm} from './weekly-hq-schedule.js';
import {formDay} from './weekly-exec-requests.js';
import {TIME_HINT} from './time-input.js';
import {rowMore, partAdd} from './row-more.js';
import {waitHtml} from './wait-state.js';

const TEXT = Object.freeze({
  missing:'저장 칸이 아직 준비되지 않았어요(서버 적용 전).',
  failed:'불러오지 못했어요.',
  saveFailed:'저장하지 못했어요. 잠시 뒤 다시 해 주세요.',
  noTitle:'내용을 적어 주세요.',
  noDay:'날짜를 골라 주세요(표의 2주 안).',
  badTime:TIME_HINT,
  full:part => `줄은 ${part === 'calendar' ? HAND_CALENDAR_MAX : HAND_NOTES_MAX}개까지예요.`,
});
const LABEL = Object.freeze({calendar:'5. 주요 일정', notes:'참고 내 메모'});
const states = new Map(); // part → ui
const fresh = start => ({start, editing:null, draft:{}, saving:false, status:'', error:false, invalid:'', focus:''});

// slot: 자리(journal-part-slot), part: 'calendar' | 'notes', model: weeklySummary 결과(hand·calendar), start: 그 주 월요일.
export function paintHandLines(slot, {part, model, start, rt = window.KPTURuntime, onSaved = () => {}, redraw = () => {}}) {
  if (!slot) return;
  let ui = states.get(part);
  if (!ui || ui.start !== start) states.set(part, ui = fresh(start));
  const set = next => { ui = next; states.set(part, next); };
  const doc = slot.ownerDocument;
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const btn = (text, data, cls = 'mini') => { const b = el('button', cls, text); b.type = 'button'; b.dataset[data] = part; return b; };
  const hand = model?.hand;
  if (!hand || hand.loading) { slot.innerHTML = waitHtml({rows:1}); return; }
  if (hand.missing) { const p = el('p', 'journal-muted', TEXT.missing); p.dataset.journalHandMissing = part; slot.replaceChildren(p); return; }
  if (hand.failed || !hand.editable) { const p = el('p', 'wait-fail journal-failed', TEXT.failed); slot.replaceChildren(p); return; }
  const rows = part === 'calendar' ? hand.calendar : hand.notes, busy = ui.saving;
  const days = model.calendar?.days ?? [];
  const parts = [];
  if (!ui.editing) {
    const add = btn('+ 추가', 'journalHandAdd', 'journal-part-add-button'); add.setAttribute('aria-label', `${LABEL[part]} 줄 추가`);
    add.disabled = busy || rows.length >= (part === 'calendar' ? HAND_CALENDAR_MAX : HAND_NOTES_MAX);
    parts.push(partAdd(doc, [add]));
  }
  if (part === 'notes') {
    const ul = el('ul', 'journal-weekly-list journal-hand-notes'); ul.dataset.journalHandList = part;
    for (const r of rows) {
      const li = el('li'); li.dataset.journalHandRow = r.id;
      if (ui.editing === r.id) { li.append(noteForm()); ul.append(li); continue; }
      li.append(el('span', 'weekly-flow-text', r.text));
      if (!busy && !ui.editing) li.append(' ', more(r.id, r.text));
      ul.append(li);
    }
    if (ui.editing === 'new') { const li = el('li'); li.append(noteForm()); ul.append(li); }
    if (ul.children.length) parts.push(ul);
  } else if (ui.editing) {
    const row = ui.editing === 'new' ? null : rows.find(r => r.id === ui.editing);
    const form = dayRowForm(doc, {values:ui.draft, busy, invalid:ui.invalid, idBase:`journalHand-${ui.editing}`, field:'journalHandField', cancel:'journalHandCancel', save:'journalHandSave', tag:part, min:days[0] ?? '', max:days.at(-1) ?? ''});
    form.dataset.journalHandForm = row?.id ?? 'new';
    parts.push(form);
  }
  const say = el('p', 'journal-line-status', ui.status || ''); say.dataset.journalHandStatus = part; say.setAttribute('role', 'status'); say.setAttribute('aria-live', 'polite');
  if (ui.error) say.classList.add('journal-failed');
  parts.push(say);
  slot.replaceChildren(...parts);
  // 5. 주요 일정 표 줄의 ⋯ 는 자리 밖(같은 묶음 안 표)에 있어 묶음에서 받는다.
  const box = slot.closest('[data-journal-weekly]') ?? slot;
  box.onclick = onClick; box.oninput = onInput; box.onkeydown = onKey;
  if (ui.focus) { (box.querySelector(ui.focus))?.focus(); ui.focus = ''; }

  function more(id, text) {
    return rowMore(doc, {label:`고치기·지우기: ${text}`, data:{journalHandMore:`${part}:${id}`}, items:[
      {text:'고치기', data:{journalHandFix:`${part}:${id}`}, aria:`고치기: ${text}`},
      {text:'지우기', data:{journalHandDelete:`${part}:${id}`}, aria:`지우기: ${text}`, danger:true}]});
  }
  function noteForm() {
    const f = el('span', 'journal-file-edit weekly-flow-edit');
    const input = el('input'); input.type = 'text'; input.value = ui.draft.text ?? ''; input.maxLength = HAND_NOTE_MAX; input.dataset.journalHandField = 'text';
    input.setAttribute('aria-label', ui.editing === 'new' ? '메모 줄 추가' : '메모 줄 고치기'); input.disabled = busy; input.autocomplete = 'off';
    if (ui.invalid === 'text') input.setAttribute('aria-invalid', 'true');
    const cancel = btn('취소', 'journalHandCancel'), ok = btn('저장', 'journalHandSave', 'mini primary'); cancel.disabled = ok.disabled = busy;
    f.append(input, ' ', cancel, ok); // UI-저장자리: [취소] 왼쪽, [저장] 맨 오른쪽
    return f;
  }
  function onInput(event) {
    const t = event.target;
    if (!t.matches?.('[data-journal-hand-field]') || !ui.editing) return;
    ui.draft[t.dataset.journalHandField] = t.value;
    if (ui.invalid === t.dataset.journalHandField) { ui.invalid = ''; t.removeAttribute('aria-invalid'); }
  }
  function onKey(event) {
    const t = event.target;
    if (!t.matches?.('[data-journal-hand-field]') || event.isComposing) return;
    if (event.key === 'Enter' && t.type === 'text') { event.preventDefault(); void saveEdit(); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelEdit(); }
  }
  function onClick(event) {
    const b = event.target.closest?.('button');
    if (!b || b.disabled || !box.contains(b)) return;
    const own = v => String(v ?? '').startsWith(`${part}:`) ? String(v).slice(part.length + 1) : null;
    if (b.dataset.journalHandAdd === part) { set({...fresh(start), editing:'new', draft:part === 'calendar' ? {day:'', time:'', title:'', place:''} : {text:''}, focus:`[data-journal-hand-field="${part === 'calendar' ? 'day' : 'text'}"]`}); redraw(); return; }
    if (b.dataset.journalHandCancel === part) { cancelEdit(); return; }
    if (b.dataset.journalHandSave === part) { void saveEdit(); return; }
    const fix = own(b.dataset.journalHandFix), del = own(b.dataset.journalHandDelete);
    if (fix) {
      const r = rows.find(x => x.id === fix); if (!r || busy) return;
      set({...fresh(start), editing:r.id, draft:part === 'calendar' ? {day:r.day, time:r.time, title:r.title, place:r.place} : {text:r.text}, focus:`[data-journal-hand-field="${part === 'calendar' ? 'title' : 'text'}"]`});
      redraw(); return;
    }
    if (del) { if (busy) return; void save(h => withoutHandRow(h, part, del), 'cut', '줄을 지웠어요.', `[data-journal-hand-add="${part}"]`); }
  }
  function cancelEdit() { const id = ui.editing; set(fresh(start)); ui.focus = id && id !== 'new' ? `[data-journal-hand-more="${part}:${id}"] > summary` : `[data-journal-hand-add="${part}"]`; redraw(); }
  async function saveEdit() {
    if (!ui.editing || ui.saving) return;
    for (const input of box.querySelectorAll('[data-journal-hand-field]')) ui.draft[input.dataset.journalHandField] = input.value;
    const id = ui.editing === 'new' ? '' : ui.editing, d = {...ui.draft};
    const bad = (field, text) => { ui.status = text; ui.error = true; ui.invalid = field; ui.focus = `[data-journal-hand-field="${field}"]`; redraw(); };
    let row;
    if (part === 'calendar') {
      const time = cleanTime(d.time);
      if (time === null) return bad('time', TEXT.badTime);
      if (!days.includes(d.day)) return bad('day', TEXT.noDay);
      if (!String(d.title ?? '').trim()) return bad('title', TEXT.noTitle);
      // 시간을 비우면 '종일'(한글 파일 칸 규칙과 같게 — 화면과 파일이 같은 글).
      row = {id, day:d.day, time:time || '종일', title:d.title, place:d.place};
    } else {
      if (!String(d.text ?? '').trim()) return bad('text', TEXT.noTitle);
      row = {id, text:d.text};
    }
    const focus = id ? `[data-journal-hand-more="${part}:${id}"] > summary` : `[data-journal-hand-add="${part}"]`;
    await save(h => withHandRow(h, part, row), id ? 'fix' : 'add', id ? '고쳤어요.' : `${part === 'calendar' ? `${formDay(d.day)} ` : ''}줄을 더했어요.`, focus);
  }
  // change(hand) → {hand, row, before?} | null(넘침·빈 줄). 동작 기록(picks)을 같은 쓰기에 싣는다.
  async function save(change, act, done, focus) {
    if (ui.saving) return;
    let full = false;
    const keep = {...ui};
    ui.saving = true; ui.status = '저장하는 중…'; ui.error = false; redraw();
    try {
      const r = await changeWeekDocs({start, known:hand.row, change:draft => {
        const next = change(draftHand(draft));
        if (!next) { full = true; return draft; }
        return withLinePick(withHand(draft, next.hand), {cell:part, act, text:handText(part, next.row), before:next.before ? handText(part, next.before) : ''});
      }}, rt);
      if (r.missing) { set({...fresh(start), status:TEXT.missing, error:true}); redraw(); return; }
      if (full) { set({...keep, saving:false, status:act === 'cut' ? '' : TEXT.full(part), error:act !== 'cut'}); redraw(); return; }
      set({...fresh(start), status:done, focus});
      onSaved(r.row);
    } catch {
      set({...keep, saving:false, status:TEXT.saveFailed, error:true}); redraw();
    }
  }
}
