// WEEKLY-내양식자유변형 ④-2(시안 docs/design/mockups/weekly-own-form.html ③): '내 양식'이 있는 사람의 [주간 보고] — 내 양식 그대로 그 주 초안.
// 항목 제목·표 머리 칸은 '내 양식'(app_weekly_forms)에서, 글은 그 주 기록(journal-weekly.js weeklySummary)에서(weekly-own-draft-model.mjs).
// 이번 주 기록에서 채운 칸은 노란 칸. 칸(줄 목록 항목은 항목 통째, 표는 칸 하나)을 눌러 수정 → 고친 항목만 서버(app_weekly_own_drafts)에
// 읽은 판(updated_at) 조건으로 저장(weekly-own-draft-store.js). 고친 항목은 기록이 늦게 와도 덮지 않는다.
// 이 자리의 유일한 renderer. 항목마다 한 마디(data-own-draft-section)이고, 재료가 늦게 오면 바뀐 항목 마디만 바꿔 그린다(고치는 중인 항목은 끝난 뒤).
// 상태는 이 함수 안 메모리에만(브라우저 저장소 없음). 로그·오류에 보고 글을 쓰지 않는다.
// 쓴 공용 부품: button.row-act(+ 줄), 기다림 표시(wait-state.js). 칸 버튼·노란 칸 모양은 journal.css .journal-own-draft-*.
import {shownDraft, editSaved, sectionKey} from './weekly-own-draft-model.mjs';
import {readOwnDrafts, saveOwnDraft, OWN_DRAFT_TEXT} from './weekly-own-draft-store.js';
import {waitInlineHtml} from './wait-state.js';

export {OWN_DRAFT_TEXT};

// host: 그릴 자리. → {update({start, form, model})} — form이 없으면 비운다. rt는 시험·다른 자리용(기본 window.KPTURuntime).
export function mountOwnDraft(host, {rt} = {}) {
  const doc = host.ownerDocument;
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const api = rt ?? doc.defaultView.KPTURuntime;
  let start = '', form = null, model = null, read = null; // read: {state:'loading'|'ok'|'failed'|'missing', row, last}
  let run = 0, busy = false, editing = null, noteText = '';  // editing: {id, row?, col?, value?}
  let box = null, built = '', parts = new Map();           // parts: id → {el, key}

  function update(next) {
    if (!next?.form?.sections?.length) { form = null; built = ''; parts = new Map(); box = null; host.replaceChildren(); return; }
    if (next.start !== start) { start = next.start; read = {state: 'loading', row: null, last: null}; editing = null; noteText = ''; void load(start); }
    form = next.form; model = next.model ?? null;
    paint();
  }
  async function load(week) {
    const mine = ++run;
    let r;
    try { r = await readOwnDrafts(week, api); r = r.missing ? {state: 'missing', row: null, last: null} : {state: 'ok', row: r.row, last: r.last}; }
    catch { r = {state: 'failed', row: null, last: null}; }
    if (mine !== run || week !== start) return;
    read = r;
    if (r.state === 'failed') noteText = OWN_DRAFT_TEXT.readFailed;
    paint();
  }
  const canEdit = () => read?.state === 'ok' && !busy;

  function paint() {
    if (!form) return;
    if (read?.state === 'loading') { if (built !== 'wait') { built = 'wait'; parts = new Map(); box = null; host.innerHTML = waitInlineHtml(); } return; }
    const shown = shownDraft(form, model, read?.last ?? null, read?.row?.sections ?? []).sections;
    const shape = `${shown.map(s => s.id).join('|')}#${canEdit()}`;
    if (shape !== built || !box) {
      built = shape; parts = new Map();
      box = el('section', 'journal-own-draft'); box.dataset.ownDraft = '';
      const help = el('p', 'journal-muted journal-own-draft-help');
      const legend = el('span', 'journal-own-draft-mark', '노란 칸'); legend.setAttribute('aria-hidden', 'true');
      help.append(legend, ` ${OWN_DRAFT_TEXT.help.replace(/^노란 칸 /, '')}`);
      const note = el('p', 'journal-muted journal-own-draft-note'); note.dataset.ownDraftNote = ''; note.setAttribute('role', 'status'); note.setAttribute('aria-live', 'polite');
      box.append(help, note);
      for (const s of shown) { const part = sectionEl(s); parts.set(s.id, {el: part, key: sectionKey(s)}); box.append(part); }
      host.replaceChildren(box);
    } else {
      for (const s of shown) {
        const was = parts.get(s.id), key = sectionKey(s);
        if (was.key === key || editing?.id === s.id) continue; // 고치는 중인 항목은 그대로(끝나면 다시 그린다)
        const part = sectionEl(s); was.el.replaceWith(part); parts.set(s.id, {el: part, key});
      }
    }
    const note = box.querySelector('[data-own-draft-note]');
    if (busy) note.innerHTML = waitInlineHtml(); else note.textContent = noteText;
  }
  // 한 항목만 다시(고치기 시작·끝).
  function repaintSection(id) {
    const s = shownDraft(form, model, read?.last ?? null, read?.row?.sections ?? []).sections.find(x => x.id === id), was = parts.get(id);
    if (!s || !was) { built = ''; paint(); return; }
    const part = sectionEl(s); was.el.replaceWith(part); parts.set(id, {el: part, key: sectionKey(s)});
  }

  function cellButton(text, filled, label, onOpen) {
    const b = el('button', `journal-own-draft-cell${filled ? ' is-filled' : ''}${text ? '' : ' is-empty'}`);
    b.type = 'button'; b.disabled = !canEdit(); b.setAttribute('aria-label', label);
    if (Array.isArray(text)) { for (const t of text) b.append(el('span', 'journal-own-draft-line', t.text)); if (!text.length) b.append(el('span', 'journal-muted', '눌러서 쓰기')); }
    else b.textContent = text;
    b.addEventListener('click', onOpen);
    return b;
  }
  function editor(tag, value, label, commit) {
    const input = el(tag, 'journal-own-draft-input');
    if (tag === 'input') input.type = 'text';
    else { input.rows = 3; input.dataset.autogrow = ''; } // UI-입력칸자동높이: 세 줄에서 시작해 글만큼(공용 auto-grow.js, 열 때 초점이 들어오며 맞춤)
    input.value = value; input.setAttribute('aria-label', label);
    let done = false;
    const finish = ok => { if (done) return; done = true; commit(ok ? input.value : null); };
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      else if (e.key === 'Enter' && (tag === 'input' || e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(true); }
    });
    input.addEventListener('blur', () => finish(true));
    queueMicrotask(() => { input.focus(); try { input.setSelectionRange(input.value.length, input.value.length); } catch { /* 선택 없음 */ } });
    return input;
  }

  function sectionEl(s) {
    const part = el('div', `journal-own-draft-section${s.level === 2 ? ' is-sub' : ''}`); part.dataset.ownDraftSection = s.id;
    part.append(el(s.level === 2 ? 'h5' : 'h4', 'journal-own-draft-title', s.title));
    if (s.loading) { part.insertAdjacentHTML('beforeend', waitInlineHtml()); return part; }
    const mine = editing?.id === s.id ? editing : null;
    if (!s.columns.length) {
      const now = s.lines.map(l => l.text).join('\n');
      if (mine) part.append(editor('textarea', mine.value ?? now, `${s.title} 수정`, v => commit(s, v == null ? null : {lines: v}, v)));
      else part.append(cellButton(s.lines, s.lines.some(l => l.filled), `${s.title} 수정`, () => open({id: s.id})));
      return part;
    }
    const wrap = el('div', 'journal-own-draft-table-wrap'), table = el('table', 'journal-own-draft-table');
    const head = el('tr'); for (const c of s.columns) head.append(el('th', '', c));
    const thead = el('thead'); thead.append(head);
    const body = el('tbody');
    const rows = s.rows.map(r => r.map(c => ({...c})));
    if (mine && mine.row === rows.length) rows.push(s.columns.map(() => ({text: '', filled: false})));
    rows.forEach((r, ri) => {
      const tr = el('tr');
      r.forEach((c, ci) => {
        const td = el('td'), label = `${s.title} ${ri + 1}번째 줄 ${s.columns[ci]} 수정`;
        if (mine && mine.row === ri && mine.col === ci) td.append(editor('input', mine.value ?? c.text, label, v => commit(s, v == null ? null : {row: ri, col: ci, text: v}, v)));
        else td.append(cellButton(c.text, c.filled, label, () => open({id: s.id, row: ri, col: ci})));
        tr.append(td);
      });
      body.append(tr);
    });
    table.append(thead, body); wrap.append(table); part.append(wrap);
    const add = el('button', 'row-act', '+ 줄'); add.type = 'button'; add.dataset.ownDraftAdd = s.id; add.disabled = !canEdit() || !!mine;
    add.setAttribute('aria-label', `${s.title} 줄 추가`);
    add.addEventListener('click', () => open({id: s.id, row: s.rows.length, col: 0}));
    part.append(add);
    return part;
  }
  function open(at) {
    if (!canEdit() || editing) return;
    editing = at; noteText = ''; repaintSection(at.id);
  }
  async function commit(s, change, typed) {
    const at = editing; editing = null;
    if (!change) { repaintSection(s.id); return; }
    const before = s.columns.length ? s.rows.map(r => r.map(c => c.text)) : s.lines.map(l => l.text).join('\n');
    const nothing = s.columns.length ? (change.row === s.rows.length ? !String(change.text).trim() : before[change.row]?.[change.col] === String(change.text).replace(/\s+/g, ' ').trim()) : before === change.lines.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
    if (nothing) { repaintSection(s.id); return; }
    const week = start, sections = editSaved(read.row?.sections ?? [], s, change);
    busy = true; built = ''; paint();
    let saved = null;
    try { saved = await saveOwnDraft({known: read.row, start: week, sections}, api); }
    catch { saved = null; }
    busy = false;
    if (week !== start) return;
    if (saved?.ok) { read = {...read, row: saved.row}; noteText = OWN_DRAFT_TEXT.saved; }
    else if (saved?.conflict) { read = {...read, row: saved.row}; noteText = OWN_DRAFT_TEXT.conflict; }
    else { noteText = saved?.missing ? OWN_DRAFT_TEXT.notReady : OWN_DRAFT_TEXT.failed; if (!saved?.missing) editing = {...at, value: typed}; }
    built = ''; paint();
  }
  return {update};
}
