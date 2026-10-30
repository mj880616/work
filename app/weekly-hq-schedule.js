// WEEKLY-주요일정칸 B(요청함 10/30 13:17, 명진 결정 "ㅇㅋ"): [주간 정리] 1. 요청사항 › 2) 주요 일정(본부 주요 일정) 수기 표.
// 1) 요청사항 표와 같은 모양·부품: '일 | 시간 / 내용 / 장소 | [고치기]' + [+ 줄 추가], 날짜는 공용 날짜 칸(date-field.js가 붙음), ⠿로 끌어 순서(폰은 길게
// 눌러 끌기, 키보드는 ⠿에서 위·아래 — reorder-drag.js), 고치기 줄의 [빼기]. 작은 [달력에서 골라 넣기]: 한글 파일 상자 5. 주요 일정과 같은 달력·기억 읽기
// (journal-weekly.js weeklySummary의 calendar)에서 체크한 일정만 넣는다. 넣은 줄은 그 일정의 칸별 고침(draft.titles)을 보고 고치므로, 상자 5번에서
// 고친 값과 늘 같다(한 곳만 고치면 두 곳 같음). 저장은 그 주 주간보고 행(app_weekly_exec_requests.draft — hq·titles 칸, weekly-draft-store.js
// changeWeekDocs: 다시 읽고 그 칸만 바꿔 조건부 쓰기). 한글 파일 1. 2) 주요 일정 칸에도 같은 줄('- 11.6.(금) 13:00 / 내용 / 장소')이 들어간다.
// 이 자리(data-journal-weekly-hq-slot)는 이 모듈 하나가 그린다. 브라우저 저장소에 아무것도 두지 않는다.
import {changeWeekDocs, withHq, withTitleEdit, draftHq} from './weekly-draft-store.js';
import {withHqRow, withoutHqRow, movedHqRow, withPicked, eventFields, editFrom, cleanTime, HQ_MAX, TITLE_MAX, PLACE_MAX, ALL_DAY} from './weekly-schedule-rows.mjs';
import {scheduleItems} from './weekly-hwpx/schedule.mjs';
import {formDay} from './weekly-exec-requests.js';
import {mountReorder} from './reorder-drag.js';
import {emptyEl, waitHtml} from './wait-state.js';

const TEXT = Object.freeze({
  missing:'2) 주요 일정 저장 칸이 아직 준비되지 않았어요(서버 적용 전).',
  failed:'2) 주요 일정을 불러오지 못했어요.',
  saveFailed:'저장하지 못했어요. 잠시 뒤 다시 해 주세요.',
  noTitle:'내용을 적어 주세요.',
  badTime:'시간을 확인해 주세요(예: 0930 → 09:30, 종일).',
  full:`줄은 ${HQ_MAX}개까지예요.`,
  noEvents:'이 2주 달력 일정이 없어요.',
});
let ui = fresh(''), drag = null;
function fresh(start) { return {start, editing:null, draft:{}, picking:false, picked:new Set(), saving:false, status:'', error:false}; }

// slot: 자리, model: weeklySummary 결과(hq·calendar), start: 그 주 월요일, onSaved(row): 서버에 쓴 뒤(journal.js가 재료를 바꾸고 다시 그림).
export function paintHqSchedule(slot, {model, start, rt = window.KPTURuntime, onSaved = () => {}, redraw = () => {}}) {
  if (!slot) return;
  if (ui.start !== start) ui = fresh(start);
  drag?.destroy(); drag = null;
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
    const edit = btn('고치기', 'journalHqEdit'); edit.dataset.journalHqEdit = row.id; edit.setAttribute('aria-label', `${row.title} 고치기`);
    if (busy || ui.editing) { edit.disabled = true; grip.disabled = true; }
    tools.append(grip, edit); tr.append(th, what, tools); body.append(tr);
  }
  if (ui.editing === 'new') body.append(editRow(null));
  table.append(body);
  const parts = [table];
  if (!rows.length && ui.editing !== 'new') parts.push(emptyEl('없음', {attrs:'data-journal-hq-empty'}));
  if (!ui.editing && !ui.picking) {
    const bar = el('div', 'journal-exec-bar');
    const add = btn('+ 줄 추가', 'journalHqAdd'); add.setAttribute('aria-label', '2) 주요 일정 줄 추가'); add.disabled = busy || rows.length >= HQ_MAX;
    const pick = btn('달력에서 골라 넣기', 'journalHqPick'); pick.disabled = busy || rows.length >= HQ_MAX || !events.length;
    bar.append(add, pick); parts.push(bar);
  }
  if (ui.picking) parts.push(picker());
  const say = el('p', 'journal-line-status', ui.status || ''); say.dataset.journalHqStatus = ''; say.setAttribute('role', 'status'); say.setAttribute('aria-live', 'polite');
  if (ui.error) say.classList.add('journal-failed');
  parts.push(say);
  slot.replaceChildren(...parts);
  slot.onclick = onClick; slot.oninput = onInput;
  if (!ui.editing && !busy) drag = mountReorder(slot, {listSelector:'[data-reorder-list="hq"]', itemSelector:'tr[data-reorder-id]',
    onDrop:({id, index}) => save(list => movedHqRow(list, id, index), '순서를 바꿨어요.'),
    onStep:(id, dir) => { const at = rows.findIndex(r => r.id === id); if (at >= 0) save(list => movedHqRow(list, id, Math.max(0, at + dir)), '순서를 바꿨어요.', `tr[data-reorder-id="${id}"] [data-reorder-handle]`); }});
  if (ui.focus) { slot.querySelector(ui.focus)?.focus(); ui.focus = ''; }

  function editRow(row) {
    const tr = el('tr', 'journal-exec-edit-row'); tr.dataset.journalHqEditRow = row?.id ?? 'new';
    const td = el('td'); td.colSpan = 3;
    const form = el('div', 'journal-exec-form'); form.dataset.journalHqForm = row?.id ?? 'new';
    const d = ui.draft, key = row?.id ?? 'new';
    for (const [name, label, type, max] of [['day', '일', 'date'], ['time', '시간', 'text', 5], ['title', '내용', 'text', TITLE_MAX], ['place', '장소', 'text', PLACE_MAX]]) {
      const wrap = el('label', `journal-exec-field journal-exec-${name === 'title' ? 'what' : name}`); wrap.append(el('span', null, label));
      const input = el('input'); input.type = type; input.value = d[name] ?? ''; input.dataset.journalHqField = name; input.id = `journalHq-${key}-${name}`;
      if (max) { input.maxLength = max; input.autocomplete = 'off'; }
      if (name === 'time') input.placeholder = `10:30·${ALL_DAY}`;
      if (ui.invalid === name) input.setAttribute('aria-invalid', 'true');
      if (busy) input.disabled = true;
      wrap.append(input); form.append(wrap);
    }
    const actions = el('div', 'journal-edit-actions save-row');
    if (row) { const del = btn('빼기', 'journalHqDelete', 'mini journal-delete save-row-start'); del.dataset.journalHqDelete = row.id; del.setAttribute('aria-label', `${row.title} 줄 빼기`); actions.append(del); }
    const cancel = btn('취소', 'journalHqCancel'), ok = btn('저장', 'journalHqSave', 'mini primary');
    actions.append(cancel, ok);
    if (busy) for (const b of actions.children) b.disabled = true;
    form.append(actions); td.append(form); tr.append(td);
    return tr;
  }
  function picker() {
    const box = el('div', 'journal-hq-picker'); box.dataset.journalHqPicker = '';
    box.append(el('p', 'journal-muted', '넣을 일정을 고르세요(다음 주 월요일부터 2주 달력 일정). 넣은 뒤 줄에서 고칠 수 있어요.'));
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
    if (b.matches('[data-journal-hq-add]')) { ui = {...fresh(start), editing:'new', draft:{day:'', time:'', title:'', place:''}, focus:'[data-journal-hq-field="day"]'}; redraw(); }
    else if (b.matches('[data-journal-hq-edit]')) { const row = rows.find(r => r.id === b.dataset.journalHqEdit); if (!row) return; ui = {...fresh(start), editing:row.id, draft:{day:row.day, time:row.time, title:row.title, place:row.place}, focus:'[data-journal-hq-field="title"]'}; redraw(); }
    else if (b.matches('[data-journal-hq-cancel]')) { const id = ui.editing; ui = fresh(start); ui.focus = id && id !== 'new' ? `[data-journal-hq-edit="${id}"]` : '[data-journal-hq-add]'; redraw(); }
    else if (b.matches('[data-journal-hq-save]')) void saveEdit();
    else if (b.matches('[data-journal-hq-delete]')) { const id = b.dataset.journalHqDelete; void save(list => withoutHqRow(list, id), '줄을 뺐어요.'); }
    else if (b.matches('[data-journal-hq-pick]')) { ui = {...fresh(start), picking:true}; redraw(); }
    else if (b.matches('[data-journal-hq-pick-cancel]')) { ui = fresh(start); redraw(); }
    else if (b.matches('[data-journal-hq-pick-save]')) { const picked = events.filter(i => ui.picked.has(i.key)); void save(list => withPicked(list, picked, {titles:hq.titles}), `${picked.length}줄을 넣었어요.`); }
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
      await save(list => withHqRow(list, {...row, day:snap.day, time:snap.time, title:snap.title, place:snap.place}), '저장했어요.', `[data-journal-hq-edit="${id}"]`, draft => withTitleEdit(draft, row.event, edit));
      return;
    }
    await save(list => withHqRow(list, {...(row ?? {}), ...(row ? {id} : {}), ...fields, title:String(d.title).trim()}), '저장했어요.', id && id !== 'new' ? `[data-journal-hq-edit="${id}"]` : '[data-journal-hq-add]');
  }
  // change(list) → 새 줄 목록(null이면 넘침). extra(draft) → 같은 쓰기에 실을 다른 칸 바꿈(일정 칸별 고침).
  async function save(change, done, focus = '', extra = null) {
    if (ui.saving) return;
    let full = false;
    ui.saving = true; ui.status = '저장하는 중…'; ui.error = false; redraw();
    try {
      const r = await changeWeekDocs({start, known:hq.row, change:draft => { const next = change(draftHq(draft)); if (!next) { full = true; return draft; } const out = withHq(draft, next); return extra ? extra(out) : out; }}, rt);
      if (r.missing) { ui = {...fresh(start), status:TEXT.missing, error:true}; redraw(); return; }
      ui = {...fresh(start), status:full ? TEXT.full : done, error:full};
      ui.focus = focus;
      onSaved(r.row);
    } catch {
      ui.saving = false; ui.status = TEXT.saveFailed; ui.error = true; redraw();
    }
  }
}
