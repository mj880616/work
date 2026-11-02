// WEEKLY-사업영역세부줄(요청함 11/01 01:12 할 것 5·01:17 덧붙임 + 11/02 놓친 작업 빠짐1, 명진 11/02 결정 '넣는다' — PR 1722의 '대상 밖' 판단 뒤집음):
// [주간 정리] '2. 기본·영역·의제 사업 › 2) 세부 내용 — 회의·활동 결과' 목록.
// - 모든 줄(회의·활동·사업 보고에서 온 줄) 끝 작은 ⋯ → [고치기]·[빼기](+ [이 종류 늘 빼기] — 서버 '빼는 회의 종류' 목록, + 고친 줄이면 [원래대로]).
// - 묶음 제목 줄 오른쪽 작은 [+ 추가](손으로 더한 줄, 같은 ⋯ [고치기]·[지우기]).
// - 저장: 그 주 주간보고 행 draft.hand 의 details(더한 줄)·details_edits(고친 글·뺀 줄, weekly-hand.mjs) — 누름 한 번 = changeWeekDocs 한 번,
//   동작 기록(picks, 칸 'details')을 같은 쓰기에. 원래 기록(회의·사업 보고)은 바꾸지 않는다(데이터 보존). 뺀 줄은 목록으로 남기지 않고
//   뺀 직후 작은 [되돌리기]만(명진 11/01 01:16 '다 보여주지마').
// 자리 하나의 그리기 주인은 이 모듈 하나(journal.js 는 자리만 찾아 부른다). 브라우저 저장소에 아무것도 두지 않는다. 글은 로그에 쓰지 않는다.
import {changeWeekDocs, draftHand, withHand, withLinePick, detailPick} from './weekly-draft-store.js';
import {withHandRow, withoutHandRow, withDetailEdit, detailEdits, handMax, HAND_NOTE_MAX, HAND_TAG} from './weekly-hand.mjs';
import {validKindKey} from './journal-meeting-kinds.js';
import {shortDay} from './task-due.mjs';
import {rowMore, partAdd} from './row-more.js';
import {emptyEl} from './wait-state.js';

const TEXT = Object.freeze({saveFailed:'저장하지 못했어요. 잠시 뒤 다시 해 주세요.', full:`줄은 ${handMax('details')}개까지예요.`, empty:'내용을 적어 주세요.'});
const states = new Map(); // start → ui (기기 메모리만)
const fresh = start => ({start, editing:null, value:null, saving:false, status:'', error:false, undo:null, focus:''});
const keyOf = item => (item.hand ? `hand:${item.hand}` : item.ref ?? '');

// slot: 자리, model: weeklySummary 결과(meetings), start: 그 주 월요일, onSaved(row): 서버에 쓴 뒤(journal.js 가 재료를 바꾸고 다시 그림).
export function paintDetailLines(slot, {model, start, rt = window.KPTURuntime, onSaved = () => {}, redraw = () => {}}) {
  if (!slot) return;
  let ui = states.get('weekly');
  if (!ui || ui.start !== start) states.set('weekly', ui = fresh(start));
  const set = next => { ui = next; states.set('weekly', next); };
  const doc = slot.ownerDocument;
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const btn = (text, data, cls = 'mini') => { const b = el('button', cls, text); b.type = 'button'; Object.assign(b.dataset, data); return b; };
  const mt = model?.meetings;
  if (!mt || mt.loading) return;
  const items = mt.items ?? [], can = !!mt.detailEditable, busy = ui.saving;
  const handCount = items.filter(i => i.hand).length;
  const parts = [];
  if (can && ui.editing !== 'new') {
    const add = btn('+ 추가', {journalDetailAdd:''}, 'journal-part-add-button'); add.setAttribute('aria-label', '2) 세부 내용 줄 추가');
    add.disabled = busy || handCount >= handMax('details');
    parts.push(partAdd(doc, [add]));
  }
  const ul = el('ul', 'journal-weekly-list'); ul.dataset.journalDetailList = '';
  for (const item of items) {
    const key = keyOf(item), li = el('li'); li.dataset.journalDetailItem = key;
    if (item.kind) li.dataset.journalKindLine = item.kind;
    if (item.day) li.append(el('span', 'journal-weekly-day', shortDay(item.day)));
    if (ui.editing === key) { li.append(form(ui.value ?? item.text, '줄 고치기')); ul.append(li); continue; }
    li.append(el('span', 'weekly-flow-text', item.text));
    if (item.hand) { const tag = el('span', 'journal-exec-carried', HAND_TAG); tag.title = '손으로 더한 줄'; tag.dataset.journalDetailHand = ''; li.append(' ', tag); }
    if (item.edited) { const n = el('span', 'journal-file-note', '고침'); n.title = `원래: ${item.original}`; n.dataset.journalDetailEdited = ''; li.append(' ', n); }
    const menu = [];
    if (can && key) {
      menu.push({text:'고치기', data:{journalDetailFix:key}, disabled:busy, aria:`고치기: ${item.text}`});
      if (item.edited) menu.push({text:'원래대로', data:{journalDetailReset:key}, disabled:busy, aria:`원래대로: ${item.text}`});
      menu.push({text:item.hand ? '지우기' : '빼기', data:{journalDetailDrop:key}, disabled:busy, danger:true, aria:`${item.hand ? '지우기' : '이번 주 보고에서 빼기'}: ${item.text}`});
    }
    // 그 회의 종류를 앞으로 늘 빼기(서버 '빼는 회의 종류' 목록, journal.js toggleKind) — 목록을 읽었을 때만.
    if (mt.editable && validKindKey(item.kind)) menu.push({text:'이 종류 늘 빼기', data:{journalKindToggle:item.kind, journalKindHide:'1', journalKindName:item.kindName}, aria:`${item.kindName} 종류를 주간보고에서 늘 빼기`});
    if (menu.length) li.append(rowMore(doc, {label:`줄 고치기·빼기: ${item.text}`, data:{journalDetailMore:key || item.kind || ''}, items:menu}));
    ul.append(li);
  }
  if (ui.editing === 'new') { const li = el('li'); li.dataset.journalDetailNew = ''; li.append(form(ui.value ?? '', '줄 추가')); ul.append(li); }
  if (ul.children.length) parts.push(ul); else parts.push(emptyEl('없음', {attrs:'data-journal-weekly-empty'}));
  const say = el('p', 'journal-line-status', ui.status || ''); say.dataset.journalDetailStatus = ''; say.setAttribute('role', 'status'); say.setAttribute('aria-live', 'polite');
  if (ui.error) say.classList.add('journal-failed');
  if (ui.undo && !busy) say.append(' ', btn('되돌리기', {journalDetailUndo:''}));
  parts.push(say);
  slot.replaceChildren(...parts);
  slot.onclick = onClick; slot.oninput = onInput; slot.onkeydown = onKey;
  if (ui.focus) { slot.querySelector(ui.focus)?.focus(); ui.focus = ''; }

  function form(value, aria) {
    const f = el('span', 'journal-file-edit weekly-flow-edit');
    const input = el('input'); input.type = 'text'; input.value = value; input.maxLength = HAND_NOTE_MAX; input.dataset.journalDetailInput = '';
    input.setAttribute('aria-label', aria); input.disabled = busy; input.autocomplete = 'off';
    const cancel = btn('취소', {journalDetailCancel:''}), ok = btn('저장', {journalDetailSave:''}, 'mini primary'); cancel.disabled = ok.disabled = busy;
    f.append(input, ' ', cancel, ok); // UI-저장자리: [취소] 왼쪽, [저장] 맨 오른쪽
    return f;
  }
  function onInput(event) { if (event.target.matches?.('[data-journal-detail-input]')) ui.value = event.target.value; }
  function onKey(event) {
    const t = event.target;
    if (!t.matches?.('[data-journal-detail-input]') || event.isComposing) return;
    if (event.key === 'Enter') { event.preventDefault(); void saveEdit(); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
  }
  function cancel() { const k = ui.editing; set({...fresh(start), focus:k && k !== 'new' ? `[data-journal-detail-more="${CSS.escape(k)}"] > summary` : '[data-journal-detail-add]'}); redraw(); }
  function onClick(event) {
    const b = event.target.closest?.('button');
    if (!b || b.disabled || !slot.contains(b)) return;
    const d = b.dataset, find = k => items.find(i => keyOf(i) === k);
    if (d.journalDetailAdd !== undefined) { set({...fresh(start), editing:'new', value:'', focus:'[data-journal-detail-input]'}); redraw(); return; }
    if (d.journalDetailCancel !== undefined) { cancel(); return; }
    if (d.journalDetailSave !== undefined) { void saveEdit(); return; }
    if (d.journalDetailFix) { const it = find(d.journalDetailFix); if (!it) return; set({...fresh(start), editing:d.journalDetailFix, value:it.text, focus:'[data-journal-detail-input]'}); redraw(); return; }
    if (d.journalDetailReset) { const it = find(d.journalDetailReset); if (!it?.ref) return; void save(h => withDetailEdit(h, it.ref, null), detailPick('none', it), '원래대로 했어요.'); return; }
    if (d.journalDetailDrop) {
      const it = find(d.journalDetailDrop); if (!it) return;
      if (it.hand) { void save(h => withoutHandRow(h, 'details', it.hand), {act:'cut', text:it.text}, '줄을 지웠어요.'); return; }
      const prev = detailEdits(draftHand(mt.row?.draft)).get(it.ref) ?? null;
      void save(h => withDetailEdit(h, it.ref, {drop:true}), detailPick('drop', it), '줄을 뺐어요.', {undo:{ref:it.ref, prev, item:it}});
      return;
    }
    if (d.journalDetailUndo !== undefined) { const u = ui.undo; if (!u) return; void save(h => withDetailEdit(h, u.ref, u.prev), (u.prev?.text ? detailPick('edit', u.item, u.prev.text) : detailPick('none', u.item)), '되돌렸어요.'); }
  }
  async function saveEdit() {
    if (!ui.editing || ui.saving) return;
    const text = String(slot.querySelector('[data-journal-detail-input]')?.value ?? ui.value ?? '').trim();
    if (!text) { ui.status = TEXT.empty; ui.error = true; ui.focus = '[data-journal-detail-input]'; redraw(); return; }
    const k = ui.editing;
    if (k === 'new') { await save(h => withHandRow(h, 'details', {text}), {act:'add', text}, '줄을 더했어요.'); return; }
    const it = items.find(i => keyOf(i) === k); if (!it) return;
    if (it.hand) { await save(h => withHandRow(h, 'details', {id:it.hand, text}), {act:'fix', text, before:it.text}, '고쳤어요.'); return; }
    // 원래 글과 같게 고치면 고침을 지운다(원래대로 — 동작 기록도 '고쳐서 넣음'을 지운 표시).
    const back = text === (it.original ?? it.text);
    await save(h => withDetailEdit(h, it.ref, back && it.edited ? null : {text}), back ? detailPick('none', it) : detailPick('edit', it, text), '고쳤어요.');
  }
  // WEEKLY-환류전칸(S48-35): 원래 기록에서 끌어온 줄은 '제안'이다 — 고치기 = 고쳐서 넣음(edit), 빼기 = 뺌(drop), 되돌리기·원래대로 = 지운 표시(none).
  // 열쇠는 늘 원래 기록 글(detailPick)이라 같은 줄의 고침·뺌·확정 때 그대로 넣음(take, journal-hwpx.js)이 한 열쇠로 모인다. 손으로 더한 줄은 보고서 줄 동작(add·fix·cut) 그대로.
  // change(hand) → {hand} | null(넘침·모양 밖). pick: 같은 쓰기에 실을 동작 기록 {act, text, before?}.
  async function save(change, pick, done, {undo = null} = {}) {
    if (ui.saving) return;
    let full = false;
    const keep = {...ui};
    ui.saving = true; ui.status = '저장하는 중…'; ui.error = false; ui.undo = null; redraw();
    try {
      const r = await changeWeekDocs({start, known:mt.row, change:draft => {
        const next = change(draftHand(draft));
        if (!next) { full = true; return draft; }
        return withLinePick(withHand(draft, next.hand), {cell:'details', ...pick});
      }}, rt);
      if (r.missing) { set({...fresh(start), status:'임시저장 칸이 아직 준비 전이에요.', error:true}); redraw(); return; }
      if (full) { set({...keep, saving:false, status:TEXT.full, error:true}); redraw(); return; }
      set({...fresh(start), status:done, undo, focus:'[data-journal-detail-add]'});
      onSaved(r.row);
    } catch {
      set({...keep, saving:false, status:TEXT.saveFailed, error:true}); redraw();
    }
  }
}
