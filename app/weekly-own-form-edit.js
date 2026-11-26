// WEEKLY-내양식자유변형 ③(시안 docs/design/mockups/weekly-own-form.html ②, 사용자 확정): '내 양식' 확인·짝짓기 화면.
// 항목마다 이름(눌러 수정)·채울 기록 선택·표 칸(칩, 눌러 이름 수정·빈 이름이면 빼기, [+ 칸])·⠿ 끌어서 순서(⋯ 안 [위로]·[아래로]는 키보드용)·[빼기],
// 맨 아래 [+ 항목 추가]·[취소]·[저장]. 이 칸의 유일한 renderer이며 상태(고치는 양식)는 이 함수 안 메모리에만 둔다(브라우저 저장소 없음).
// 저장은 부르는 쪽(journal.js)이 넘긴 onSave(form) — 서버 저장(weekly-own-form-store.js) 결과 글을 돌려준다.
// 쓴 공용 부품: button.primary(저장)·button.secondary(취소)·button.ds-chip(칸)·button.row-act(빼기·위로·아래로·+ 칸·+ 항목 추가)·button.icon-btn(⠿·⋯)·select(공용 고르기 상자). ⋯는 줄 아래에 [위로]·[아래로]·[빼기] 한 줄을 펼친다(떠 있는 창 없음 — 아래 바에 가리지 않게).
import {FILLS, FILL_LABEL, moveSection, renameSection, removeSection, setFill, addSection, addColumn, renameColumn, sameForm, readSummary, MAX_SECTIONS, MAX_COLUMNS, TITLE_MAX, COLUMN_MAX} from './weekly-own-form-model.mjs';
import {waitInlineHtml} from './wait-state.js';

export const EDIT_TEXT = Object.freeze({
  // read: 파일에서 읽은 직후면 읽은 수 한 줄을 앞에. 항목이 없으면 추가 안내.
  intro: (form, read) => (form.sections.length ? `${read ? `${readSummary(form)} ` : ''}항목마다 무엇으로 채울지 선택해 주세요.` : '[+ 항목 추가]로 항목을 만들어 주세요.'),
  help: '이름을 눌러 수정 · ⠿ 끌어서 순서 · ⋯ 빼기',
  addSection: '+ 항목 추가',
  addColumn: '+ 칸',
});

// host: 그릴 자리. → {form()} (지금 고치는 양식). onCancel(): 닫기.
// fresh: 올린 직후처럼 아직 저장 안 한 양식이면 고친 것이 없어도 [저장]을 누를 수 있다. onSave(form) → {ok, text}.
export function mountOwnFormEditor(host, {form, name = '', fresh = false, read = false, onSave, onCancel}) {
  const doc = host.ownerDocument;
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  let original = form;
  let cur = form, busy = false, editing = null, menuFor = ''; // editing: {id, col?} 이름을 수정하는 칸
  const box = el('section', 'journal-own-form');
  box.dataset.ownForm = '';
  const head = el('p', 'journal-own-form-head');
  head.append(el('b', '', '내 양식'), el('span', 'row-tail', name));
  const intro = el('p', 'journal-muted journal-own-form-intro');
  const list = el('ol', 'journal-own-form-list');
  list.setAttribute('aria-label', '내 양식 항목');
  const add = el('button', 'row-act', EDIT_TEXT.addSection); add.type = 'button'; add.dataset.ownFormAdd = '';
  const foot = el('div', 'journal-own-form-foot');
  const help = el('span', 'journal-muted', EDIT_TEXT.help);
  const note = el('span', 'journal-muted'); note.dataset.ownFormNote = ''; note.setAttribute('role', 'status'); note.setAttribute('aria-live', 'polite');
  const cancel = el('button', 'secondary', '취소'); cancel.type = 'button'; cancel.dataset.ownFormCancel = '';
  const save = el('button', 'primary', '저장'); save.type = 'button'; save.dataset.ownFormSave = '';
  foot.append(help, note, cancel, save);
  box.append(head, intro, list, add, foot);
  host.replaceChildren(box);

  function nameInput(value, max, label, commit) {
    const input = el('input', 'journal-own-form-input');
    input.type = 'text'; input.value = value; input.maxLength = max; input.setAttribute('aria-label', label);
    let done = false;
    const finish = ok => { if (done) return; done = true; editing = null; if (ok) commit(input.value); else paint(); };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
    input.addEventListener('blur', () => finish(true));
    return input;
  }
  function change(next) { cur = next; paint(); }

  function row(s, i) {
    const li = el('li', `journal-own-form-row${s.level === 2 ? ' is-sub' : ''}`);
    li.dataset.ownFormRow = s.id;
    const line = el('div', 'journal-own-form-line');
    const grip = el('button', 'icon-btn journal-own-form-grip', '⠿'); grip.type = 'button'; grip.dataset.ownFormGrip = s.id;
    grip.setAttribute('aria-label', `${s.title} 끌어서 순서 바꾸기`);
    let title;
    if (editing?.id === s.id && editing.col == null) title = nameInput(s.title, TITLE_MAX, '항목 이름', v => change(renameSection(cur, s.id, v)));
    else { title = el('button', 'row-act journal-own-form-title', s.title); title.type = 'button'; title.dataset.ownFormTitle = s.id; title.setAttribute('aria-label', `${s.title} 이름 수정`); }
    const pick = el('select', 'journal-own-form-fill'); pick.dataset.ownFormFill = s.id; pick.setAttribute('aria-label', `${s.title} 채울 기록`);
    for (const f of FILLS) { const o = el('option', '', FILL_LABEL[f]); o.value = f; o.selected = f === s.fill; pick.append(o); }
    const more = el('button', 'icon-btn'); more.type = 'button'; { const dots = el('span', 'more-dots', '⋯'); dots.setAttribute('aria-hidden', 'true'); more.append(dots); } more.dataset.ownFormMore = s.id; more.dataset.ctx = 'off';
    more.setAttribute('aria-label', `${s.title} 더 보기`); more.setAttribute('aria-expanded', String(menuFor === s.id));
    const act = (text, key, off) => { const b = el('button', 'row-act', text); b.type = 'button'; b.dataset.ownFormAct = key; b.dataset.id = s.id; b.disabled = !!off; return b; };
    line.append(grip, title, pick, more);
    li.append(line);
    if (menuFor === s.id) { const menu = el('div', 'journal-own-form-menu'); menu.append(act('위로', 'up', i === 0), act('아래로', 'down', i === cur.sections.length - 1), act('빼기', 'remove')); li.append(menu); }
    if (s.columns.length || editing?.id === s.id) {
      const cols = el('div', 'journal-own-form-cols');
      s.columns.forEach((c, k) => {
        if (editing?.id === s.id && editing.col === k) { cols.append(nameInput(c, COLUMN_MAX, '칸 이름(비우면 빼기)', v => change(renameColumn(cur, s.id, k, v)))); return; }
        const chip = el('button', 'ds-chip', c); chip.type = 'button'; chip.dataset.ownFormCol = `${s.id}:${k}`; chip.setAttribute('aria-label', `칸 ${c} 이름 수정`);
        cols.append(chip);
      });
      if (s.columns.length < MAX_COLUMNS) { const plus = el('button', 'row-act', EDIT_TEXT.addColumn); plus.type = 'button'; plus.dataset.ownFormAddCol = s.id; cols.append(plus); }
      li.append(cols);
    } else {
      const cols = el('div', 'journal-own-form-cols');
      const plus = el('button', 'row-act', EDIT_TEXT.addColumn); plus.type = 'button'; plus.dataset.ownFormAddCol = s.id; cols.append(plus);
      li.append(cols);
    }
    return li;
  }

  function paint() {
    intro.textContent = EDIT_TEXT.intro(cur, read);
    list.replaceChildren(...cur.sections.map(row));
    add.disabled = busy || cur.sections.length >= MAX_SECTIONS;
    save.disabled = busy || !cur.sections.length || (!fresh && sameForm(cur, original));
    cancel.disabled = busy;
    const input = list.querySelector('input');
    if (input) { input.focus(); input.select(); }
  }

  box.addEventListener('click', e => {
    if (busy) return;
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.ownFormMore) { menuFor = menuFor === t.dataset.ownFormMore ? '' : t.dataset.ownFormMore; paint(); return; }
    menuFor = '';
    if (t.dataset.ownFormTitle) { editing = {id: t.dataset.ownFormTitle}; paint(); return; }
    if (t.dataset.ownFormCol) { const [id, k] = t.dataset.ownFormCol.split(':'); editing = {id, col: Number(k)}; paint(); return; }
    if (t.dataset.ownFormAddCol != null && t.dataset.ownFormAddCol !== '') {
      const id = t.dataset.ownFormAddCol; cur = addColumn(cur, id, ''); editing = {id, col: cur.sections.find(s => s.id === id).columns.length - 1}; paint(); return;
    }
    if (t.dataset.ownFormAdd != null) { cur = addSection(cur); editing = {id: cur.sections.at(-1).id}; paint(); return; }
    if (t.dataset.ownFormAct) {
      const id = t.dataset.id, i = cur.sections.findIndex(s => s.id === id);
      if (t.dataset.ownFormAct === 'up') change(moveSection(cur, id, i - 1));
      else if (t.dataset.ownFormAct === 'down') change(moveSection(cur, id, i + 1));
      else change(removeSection(cur, id));
      return;
    }
    if (t.dataset.ownFormCancel != null) { onCancel?.(); return; }
    if (t.dataset.ownFormSave != null) void doSave();
  });
  box.addEventListener('change', e => { const s = e.target.closest('select[data-own-form-fill]'); if (s) change(setFill(cur, s.dataset.ownFormFill, s.value)); });

  // ⠿ 끌어서 순서: 누른 채 위아래로 움직이면 놓은 자리의 항목 앞으로(손가락·마우스 같음).
  let drag = null;
  box.addEventListener('pointerdown', e => {
    const g = e.target.closest('[data-own-form-grip]'); if (!g || busy) return;
    e.preventDefault(); drag = {id: g.dataset.ownFormGrip, row: g.closest('li')};
    drag.row.classList.add('is-drag'); g.setPointerCapture?.(e.pointerId);
  });
  box.addEventListener('pointermove', e => {
    if (!drag) return;
    const rows = [...list.children], y = e.clientY;
    rows.forEach(r => r.classList.toggle('is-drop', r !== drag.row && y >= r.getBoundingClientRect().top && y < r.getBoundingClientRect().bottom));
  });
  const endDrag = e => {
    if (!drag) return;
    const rows = [...list.children], y = e.clientY;
    let to = rows.findIndex(r => y < r.getBoundingClientRect().top + r.getBoundingClientRect().height / 2);
    if (to < 0) to = rows.length;
    const from = rows.indexOf(drag.row), id = drag.id;
    drag.row.classList.remove('is-drag'); rows.forEach(r => r.classList.remove('is-drop')); drag = null;
    if (e.type === 'pointerup' && to !== from && to !== from + 1) change(moveSection(cur, id, to > from ? to - 1 : to));
  };
  box.addEventListener('pointerup', endDrag);
  box.addEventListener('pointercancel', endDrag);

  async function doSave() {
    busy = true; paint(); note.innerHTML = waitInlineHtml();
    let r = {ok:false, text:''};
    try { r = await onSave(cur) ?? r; } catch { r = {ok:false, text:''}; } finally { busy = false; }
    if (r.ok) { original = cur; fresh = false; read = false; }
    if (box.isConnected) { paint(); note.textContent = r.text || ''; }
  }
  paint();
  return {form: () => cur};
}
