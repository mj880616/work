// WEEKLY-주요일정칸 B(요청함 10/30 13:17, 명진 결정 "ㅇㅋ"): [주간 정리] 1. 요청사항 › 2) 주요 일정(본부 주요 일정) 수기 표.
// 1) 요청사항 표와 같은 모양·부품: '일 | 시간 / 내용 / 장소 | [고치기]' + [+ 줄 추가], 날짜는 공용 날짜 칸(date-field.js가 붙음), ⠿로 끌어 순서(폰은 길게
// 눌러 끌기, 키보드는 ⠿에서 위·아래 — reorder-drag.js), 고치기 줄의 [빼기]. 작은 [달력에서 골라 넣기]: 한글 파일 상자 5. 주요 일정과 같은 달력·기억 읽기
// (journal-weekly.js weeklySummary의 calendar)에서 체크한 일정만 넣는다. 넣은 줄은 그 일정의 칸별 고침(draft.titles)을 보고 고치므로, 상자 5번에서
// 고친 값과 늘 같다(한 곳만 고치면 두 곳 같음). 저장은 그 주 주간보고 행(app_weekly_exec_requests.draft — hq·titles 칸, weekly-draft-store.js
// changeWeekDocs: 다시 읽고 그 칸만 바꿔 조건부 쓰기). 한글 파일 1. 2) 주요 일정 칸에도 같은 줄('- 11.6.(금) 13:00 / 내용 / 장소')이 들어간다.
// 이 자리(data-journal-weekly-hq-slot)는 이 모듈 하나가 그린다. 브라우저 저장소에 아무것도 두지 않는다.
// S46-27: 같은 표를 한글 파일 상자 1. 요청사항 안에도 그린다(place 'weekly' | 'box'). 고치기 상태·끌기는 자리마다 따로, 자료는 같은 그 주 행 하나.
import {changeWeekDocs, withHq, withTitleEdit, draftHq, withLinePick} from './weekly-draft-store.js';
import {withHqRow, withoutHqRow, movedHqRow, withPicked, eventFields, editFrom, cleanTime, hqLine, HQ_MAX, TITLE_MAX, PLACE_MAX} from './weekly-schedule-rows.mjs';
import {timeCell, TIME_HINT} from './time-input.js';
import {scheduleItems} from './weekly-hwpx/schedule.mjs';
import {formDay} from './weekly-exec-requests.js';
import {mountReorder} from './reorder-drag.js';
import {emptyEl, waitHtml} from './wait-state.js';
import {rowMore, partAdd} from './row-more.js'; // WEEKLY-화면디자인정리: 줄 끝 ⋯ · 제목 줄 오른쪽 [+ 추가]
import {majorRule} from './weekly-major-schedule.mjs'; // WEEKLY-주요일정기준: 넣을 일정의 기준(한 곳)
import {sortPicks, droppedOf, keptOf} from './weekly-picks.mjs';
import {learnFor} from './weekly-picks.js';

const TEXT = Object.freeze({
  missing:'2) 주요 일정 저장 칸이 아직 준비되지 않았어요(서버 적용 전).',
  failed:'2) 주요 일정을 불러오지 못했어요.',
  saveFailed:'저장하지 못했어요. 잠시 뒤 다시 해 주세요.',
  noTitle:'내용을 적어 주세요.',
  badTime:TIME_HINT,
  full:`줄은 ${HQ_MAX}개까지예요.`,
  noEvents:'이 2주 달력 일정이 없어요.',
});
const places = new Map(); // place → {ui, drag}
// 동작 기록에 남길 줄 글(한글 파일 줄과 같은 모양, 앞 '- ' 뺌).
const lineOf = f => hqLine({day:f.day ?? '', time:f.time ?? '', title:f.title ?? '', place:f.place ?? ''}).replace(/^-\s*/, '');
function fresh(start) { return {start, editing:null, draft:{}, picking:false, picked:new Set(), saving:false, status:'', error:false, undo:null}; }
// WEEKLY-주요일정기준 ①: 2주 달력 일정 가운데 기준(weekly-major-schedule.mjs)에 맞고 아직 표에 없는 것 → 제안(명진이 [넣기]를 눌러야 들어감).
// 제안 열쇠·학습은 [달력에서] 고르기와 같은 동작 기록(kind 'calendar', 칸 'requests:hq') — 뺀 제안은 다시 보이지 않고(목록 없음), 받은/뺀 셈이 다음 제안 순서·거르기에 쓰인다.
export function hqSuggestions(events, rows, titles, picks, learn) {
  const have = new Set((rows ?? []).map(r => r.event).filter(Boolean));
  const list = (events ?? []).filter(item => !have.has(item.key)).map(item => ({item, f:eventFields(item, titles?.get?.(item.key))})).filter(x => majorRule(x.f.title));
  const opts = {dropped:droppedOf(picks), kept:keptOf(picks), ...(learn ? {learn} : {})};
  return sortPicks(list, x => ({kind:'calendar', from:'calendar', cell:'requests:hq', org:'', text:lineOf(x.f)}), opts).shown;
}

// slot: 자리, model: weeklySummary 결과(hq·calendar), start: 그 주 월요일, onSaved(row): 서버에 쓴 뒤(journal.js가 재료를 바꾸고 다시 그림).
export function paintHqSchedule(slot, {model, start, rt = window.KPTURuntime, onSaved = () => {}, redraw = () => {}, place = 'weekly'}) {
  if (!slot) return;
  if (!places.has(place)) places.set(place, {ui:fresh(''), drag:null});
  const own = places.get(place);
  let ui = own.ui;
  if (ui.start !== start) ui = own.ui = fresh(start);
  own.drag?.destroy(); own.drag = null;
  const setUi = next => { ui = own.ui = next; };
  const doc = slot.ownerDocument;
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const btn = (text, data, cls = 'mini') => { const b = el('button', cls, text); b.type = 'button'; b.dataset[data] = ''; return b; };
  const hq = model?.hq;
  if (!hq || hq.loading) { slot.innerHTML = waitHtml({rows:1}); return; }
  if (hq.missing) { const p = el('p', 'journal-muted', TEXT.missing); p.dataset.journalHqMissing = ''; slot.replaceChildren(p); return; }
  if (hq.failed || !hq.editable) { const p = el('p', 'wait-fail journal-failed', TEXT.failed); slot.replaceChildren(p); return; }
  const rows = hq.rows, busy = ui.saving;
  const events = scheduleItems(model.calendar?.allRows ? {...model.calendar, rows:model.calendar.allRows} : model.calendar);
  const eventOf = key => hq.events.get(key);

  const table = el('table', 'journal-weekly-table journal-exec-table journal-hq-table'); table.dataset.journalHqTable = '';
  table.innerHTML = '<thead><tr><th scope="col">일</th><th scope="col">시간 / 내용 / 장소</th><th scope="col" class="journal-exec-tools-head" aria-label="고치기"></th></tr></thead>';
  const body = el('tbody'); body.dataset.reorderList = 'hq';
  for (const row of rows) {
    if (ui.editing === row.id) { body.append(editRow(row)); continue; }
    const tr = el('tr'); tr.dataset.journalHqRow = row.id; tr.dataset.reorderId = row.id;
    const th = el('th', 'journal-weekly-area', row.day ? formDay(row.day) : '—'); th.scope = 'row';
    const what = el('td', 'journal-weekly-what', [row.time, row.title, row.place].filter(Boolean).join(' / '));
    if (row.linked) { const tag = el('span', 'journal-exec-carried', '달력'); tag.title = '달력에서 넣은 줄 — 한글 파일 상자 5. 주요 일정과 같은 값'; tag.dataset.journalHqLinked = ''; what.append(' ', tag); }
    const tools = el('td', 'journal-exec-tools');
    const grip = el('button', 'mini journal-hwpx-grip', '⠿'); grip.type = 'button'; grip.dataset.reorderHandle = ''; grip.setAttribute('aria-label', `${row.title} 순서 옮기기(위·아래 화살표)`);
    // WEEKLY-화면디자인정리: 줄 끝 ⠿ + 작은 ⋯([고치기]·[빼기]). 고치는 중·저장 중에는 ⋯ 를 그리지 않는다(같은 버튼이 두 곳에 생기지 않게).
    tools.append(grip);
    if (busy || ui.editing || ui.picking) grip.disabled = true;
    else tools.append(rowMore(doc, {label:`${row.title} 고치기·빼기`, data:{journalHqMore:row.id}, items:[
      {text:'고치기', data:{journalHqEdit:row.id}, aria:`${row.title} 고치기`},
      {text:'빼기', data:{journalHqDelete:row.id}, aria:`${row.title} 줄 빼기`, danger:true}]}));
    tr.append(th, what, tools); body.append(tr);
  }
  if (ui.editing === 'new') body.append(editRow(null));
  table.append(body);
  const parts = [table];
  if (!rows.length && ui.editing !== 'new') parts.push(emptyEl('없음', {attrs:'data-journal-hq-empty'}));
  if (!ui.editing && !ui.picking) {
    // 묶음 제목 줄 오른쪽: 작은 [+ 추가] · [달력에서].
    const add = btn('+ 추가', 'journalHqAdd', 'journal-part-add-button'); add.setAttribute('aria-label', '2) 주요 일정 줄 추가'); add.disabled = busy || rows.length >= HQ_MAX;
    const pick = btn('달력에서', 'journalHqPick', 'journal-part-add-button'); pick.setAttribute('aria-label', '달력에서 골라 넣기'); pick.disabled = busy || rows.length >= HQ_MAX || !events.length;
    parts.unshift(partAdd(doc, [pick, add]));
  }
  if (ui.picking) parts.push(picker());
  // 기준에 맞는 달력 일정 제안(흐린 줄, 줄 끝 [넣기] · ⋯[빼기]). 고치는 중·고르는 중에는 그리지 않는다.
  const picks = hq.row?.draft?.picks ?? null;
  const suggested = !ui.editing && !ui.picking ? hqSuggestions(events, rows, hq.titles, picks, learnFor(start, picks, {rt, redraw}).learn) : [];
  if (suggested.length) {
    const sg = el('ul', 'weekly-flow-lines weekly-flow-suggest journal-hq-suggest'); sg.dataset.journalHqSuggest = '';
    for (const x of suggested) {
      const {item, f} = x.raw, text = x.text;
      const li = el('li'); li.dataset.journalHqSuggestItem = item.key;
      li.append(el('span', 'weekly-flow-tag', '캘린더'), el('span', 'weekly-flow-text', `${f.day ? formDay(f.day) : item.label} ${text}`));
      const take = el('button', 'mini weekly-flow-take', '넣기'); take.type = 'button'; take.dataset.journalHqSuggestTake = item.key; take.disabled = busy || rows.length >= HQ_MAX;
      take.setAttribute('aria-label', `2) 주요 일정에 넣기: ${text}`);
      li.append(take, rowMore(doc, {label:`제안 빼기: ${text}`, data:{journalHqSuggestMore:item.key}, items:[{text:'빼기', data:{journalHqSuggestDrop:item.key}, disabled:busy, danger:true, aria:`제안 빼기: ${text}`}]}));
      sg.append(li);
    }
    parts.push(sg);
  }
  const say = el('p', 'journal-line-status', ui.status || ''); say.dataset.journalHqStatus = ''; say.setAttribute('role', 'status'); say.setAttribute('aria-live', 'polite');
  if (ui.error) say.classList.add('journal-failed');
  // 뺀 직후에만 작은 [되돌리기](뺀 제안 목록은 두지 않음 — 요청함 11/01 01:16·23:43).
  if (ui.undo && !busy) { const back = el('button', 'mini', '되돌리기'); back.type = 'button'; back.dataset.journalHqSuggestUndo = ''; say.append(' ', back); }
  parts.push(say);
  slot.replaceChildren(...parts);
  slot.onclick = onClick; slot.oninput = onInput;
  if (!ui.editing && !busy) own.drag = mountReorder(slot, {listSelector:'[data-reorder-list="hq"]', itemSelector:'tr[data-reorder-id]',
    onDrop:({id, index}) => save(list => movedHqRow(list, id, index), '순서를 바꿨어요.'),
    onStep:(id, dir) => { const at = rows.findIndex(r => r.id === id); if (at >= 0) save(list => movedHqRow(list, id, Math.max(0, at + dir)), '순서를 바꿨어요.', `tr[data-reorder-id="${id}"] [data-reorder-handle]`); }});
  if (ui.focus) { slot.querySelector(ui.focus)?.focus(); ui.focus = ''; }
  return;

  function editRow(row) {
    const tr = el('tr', 'journal-exec-edit-row'); tr.dataset.journalHqEditRow = row?.id ?? 'new';
    const td = el('td'); td.colSpan = 3;
    const form = dayRowForm(doc, {values:ui.draft, busy, invalid:ui.invalid, idBase:`journalHq-${place}-${row?.id ?? 'new'}`, field:'journalHqField', cancel:'journalHqCancel', save:'journalHqSave'});
    form.dataset.journalHqForm = row?.id ?? 'new';
    td.append(form); tr.append(td);
    return tr;
  }
  function picker() {
    const box = el('div', 'journal-hq-picker'); box.dataset.journalHqPicker = '';
    if (!events.length) box.append(el('p', 'journal-muted', TEXT.noEvents));
    const have = new Set(rows.map(r => r.event).filter(Boolean));
    const list = el('ul', 'journal-calref-list');
    for (const item of events) {
      const f = eventFields(item, hq.titles.get(item.key));
      const li = el('li'); li.dataset.journalHqPickRow = item.key;
      const lab = el('label', 'journal-calref-item'); const cb = el('input'); cb.type = 'checkbox'; cb.dataset.journalHqPickCheck = item.key;
      cb.checked = have.has(item.key) || ui.picked.has(item.key); cb.disabled = have.has(item.key) || busy;
      lab.append(cb, el('span', 'journal-weekly-day', `${f.day ? formDay(f.day) : item.label} ${f.time}`), doc.createTextNode(`${f.title}${f.place ? ` / ${f.place}` : ''}${have.has(item.key) ? ' (넣음)' : ''}`));
      li.append(lab); list.append(li);
    }
    box.append(list);
    const actions = el('div', 'journal-edit-actions save-row');
    const cancel = btn('취소', 'journalHqPickCancel'), ok = btn('넣기', 'journalHqPickSave', 'mini primary');
    ok.disabled = busy || !ui.picked.size;
    actions.append(cancel, ok); box.append(actions);
    return box;
  }
  function onInput(event) {
    const t = event.target;
    if (t.matches?.('[data-journal-hq-field]')) { ui.draft[t.dataset.journalHqField] = t.value; if (ui.invalid === t.dataset.journalHqField) { ui.invalid = ''; t.removeAttribute('aria-invalid'); } }
    if (t.matches?.('[data-journal-hq-pick-check]')) { if (t.checked) ui.picked.add(t.dataset.journalHqPickCheck); else ui.picked.delete(t.dataset.journalHqPickCheck); const ok = slot.querySelector('[data-journal-hq-pick-save]'); if (ok) ok.disabled = !ui.picked.size; }
  }
  function onClick(event) {
    const b = event.target.closest?.('button');
    if (!b || !slot.contains(b) || b.disabled) return;
    if (b.matches('[data-journal-hq-add]')) { setUi({...fresh(start), editing:'new', draft:{day:'', time:'', title:'', place:''}, focus:'[data-journal-hq-field="day"]'}); redraw(); }
    else if (b.matches('[data-journal-hq-edit]')) { const row = rows.find(r => r.id === b.dataset.journalHqEdit); if (!row) return; setUi({...fresh(start), editing:row.id, draft:{day:row.day, time:row.time, title:row.title, place:row.place}, focus:'[data-journal-hq-field="title"]'}); redraw(); }
    else if (b.matches('[data-journal-hq-cancel]')) { const id = ui.editing; setUi(fresh(start)); ui.focus = id && id !== 'new' ? `[data-journal-hq-more="${id}"] > summary` : '[data-journal-hq-add]'; redraw(); }
    else if (b.matches('[data-journal-hq-save]')) void saveEdit();
    else if (b.matches('[data-journal-hq-delete]')) { const id = b.dataset.journalHqDelete, row = rows.find(r => r.id === id); void save(list => withoutHqRow(list, id), '줄을 뺐어요.', '[data-journal-hq-add]', null, row ? [{act:'cut', text:lineOf(row)}] : []); }
    else if (b.matches('[data-journal-hq-suggest-take]')) {
      const item = events.find(i => i.key === b.dataset.journalHqSuggestTake); if (!item) return;
      void save(list => withPicked(list, [item], {titles:hq.titles}), '넣었어요.', '', null, [{kind:'calendar', from:'calendar', act:'take', text:lineOf(eventFields(item, hq.titles.get(item.key)))}]);
    }
    else if (b.matches('[data-journal-hq-suggest-drop]')) {
      const item = events.find(i => i.key === b.dataset.journalHqSuggestDrop); if (!item) return;
      const text = lineOf(eventFields(item, hq.titles.get(item.key)));
      void save(list => list, '제안을 뺐어요.', '', null, [{kind:'calendar', from:'calendar', act:'drop', text}], {undo:text});
    }
    else if (b.matches('[data-journal-hq-suggest-undo]')) { const text = ui.undo?.text; if (text) void save(list => list, '되돌렸어요.', '', null, [{kind:'calendar', from:'calendar', act:'none', text}]); }
    else if (b.matches('[data-journal-hq-pick]')) { setUi({...fresh(start), picking:true}); redraw(); }
    else if (b.matches('[data-journal-hq-pick-cancel]')) { setUi(fresh(start)); redraw(); }
    else if (b.matches('[data-journal-hq-pick-save]')) {
      const picked = events.filter(i => ui.picked.has(i.key));
      // 달력 일정 고르기 = 제안 [넣기](kind 'calendar' take) — 동작 기록에 일정마다 한 줄.
      void save(list => withPicked(list, picked, {titles:hq.titles}), `${picked.length}줄을 넣었어요.`, '', null, picked.map(i => ({kind:'calendar', from:'calendar', act:'take', text:lineOf(eventFields(i, hq.titles.get(i.key)))})));
    }
  }
  async function saveEdit() {
    const id = ui.editing, d = {...ui.draft};
    const time = cleanTime(d.time);
    if (time === null) { ui.status = TEXT.badTime; ui.error = true; ui.invalid = 'time'; redraw(); return; }
    const row = rows.find(r => r.id === id), item = row?.event ? eventOf(row.event) : null;
    if (!String(d.title ?? '').trim() && !item) { ui.status = TEXT.noTitle; ui.error = true; ui.invalid = 'title'; redraw(); return; }
    const fields = {day:d.day, time, title:d.title, place:d.place};
    if (item) {
      // 달력에서 넣은 줄: 그 일정의 칸별 고침을 고친다(한글 파일 상자 5번과 같은 항목). 참석은 상자에서만 고치므로 그대로 둔다.
      const old = hq.titles.get(row.event);
      const cur = eventFields(item, old, '');
      let edit = editFrom(item, {...cur, ...fields, time:time || cur.time}, '');
      if (old?.who !== undefined) edit = {...(edit ?? {title:cur.title, place:cur.place}), who:old.who};
      const snap = eventFields(item, edit ?? undefined, '');
      await save(list => withHqRow(list, {...row, day:snap.day, time:snap.time, title:snap.title, place:snap.place}), '저장했어요.', `[data-journal-hq-more="${id}"] > summary`, draft => withTitleEdit(draft, row.event, edit), [{act:'fix', text:lineOf(snap), before:lineOf(row)}]);
      return;
    }
    const next = {...fields, title:String(d.title).trim()};
    await save(list => withHqRow(list, {...(row ?? {}), ...(row ? {id} : {}), ...next}), '저장했어요.', id && id !== 'new' ? `[data-journal-hq-more="${id}"] > summary` : '[data-journal-hq-add]', null,
      [row ? {act:'fix', text:lineOf(next), before:lineOf(row)} : {act:'add', text:lineOf(next)}]);
  }
  // change(list) → 새 줄 목록(null이면 넘침). extra(draft) → 같은 쓰기에 실을 다른 칸 바꿈(일정 칸별 고침).
  // picks: 같은 쓰기에 실을 동작 기록 [{act, text, before?, kind?, from?}](칸 'requests:hq', weekly-draft-store.js withLinePick). 순서 바꾸기는 남기지 않는다.
  async function save(change, done, focus = '', extra = null, picks = [], {undo = ''} = {}) {
    if (ui.saving) return;
    let full = false;
    ui.saving = true; ui.status = '저장하는 중…'; ui.error = false; redraw();
    try {
      const r = await changeWeekDocs({start, known:hq.row, change:draft => { const next = change(draftHq(draft)); if (!next) { full = true; return draft; } let out = withHq(draft, next); if (extra) out = extra(out); for (const p of picks) out = withLinePick(out, {cell:'requests:hq', ...p}); return out; }}, rt);
      if (r.missing) { setUi({...fresh(start), status:TEXT.missing, error:true}); redraw(); return; }
      setUi({...fresh(start), status:full ? TEXT.full : done, error:full, undo:undo ? {text:undo} : null});
      ui.focus = focus;
      onSaved(r.row);
    } catch {
      ui.saving = false; ui.status = TEXT.saveFailed; ui.error = true; redraw();
    }
  }
}

// 날짜·시간·내용·장소 한 줄 고치기 칸(2) 주요 일정 줄과 5. 주요 일정 손으로 더한 줄이 같은 부품 — weekly-hand-lines.js).
// values: {day, time, title, place}, field·cancel·save: dataset 이름(칸·[취소]·[저장]), tag: [취소]·[저장]의 dataset 값. 날짜 칸은 공용 날짜 칸(date-field.js 가 붙음),
// 시간 칸은 FORM-시간숫자(숫자 자판 + 작은 [종일], time-input.js). min·max: 고를 수 있는 날짜(주지 않으면 제한 없음).
export function dayRowForm(doc, {values = {}, busy = false, invalid = '', idBase, field, cancel, save, tag = '', min = '', max = ''}) {
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const form = el('div', 'journal-exec-form');
  for (const [name, label, type, maxLen] of [['day', '일', 'date'], ['time', '시간', 'text', 5], ['title', '내용', 'text', TITLE_MAX], ['place', '장소', 'text', PLACE_MAX]]) {
    const wrap = el('label', `journal-exec-field journal-exec-${name === 'title' ? 'what' : name}`); wrap.append(el('span', null, label));
    const input = el('input'); input.type = type; input.value = values[name] ?? ''; input.dataset[field] = name; input.id = `${idBase}-${name}`;
    if (maxLen) { input.maxLength = maxLen; input.autocomplete = 'off'; }
    if (type === 'date') { if (min) input.min = min; if (max) input.max = max; }
    if (invalid === name) input.setAttribute('aria-invalid', 'true');
    if (busy) input.disabled = true;
    wrap.append(name === 'time' ? timeCell(input, {label:'시간', allDay:true}) : input); form.append(wrap);
  }
  const actions = el('div', 'journal-edit-actions save-row');
  const mk = (text, data, cls) => { const b = el('button', cls, text); b.type = 'button'; b.dataset[data] = tag; if (busy) b.disabled = true; return b; };
  actions.append(mk('취소', cancel, 'mini'), mk('저장', save, 'mini primary')); // UI-저장자리: [취소] 왼쪽, [저장] 맨 오른쪽
  form.append(actions);
  return form;
}
