// S46-27 주간보고 '1. 요청사항 › 3) 상집 논의 요청' 표(요청함 10/31 00:24, 시안 확정 10/31 21:15): 줄마다 '안건 한 줄 + 짧은 설명 + 관련 조직 고르기',
// [+ 줄 추가]·고치기 줄의 [×](빼기)·⠿로 끌어 순서(폰은 길게 눌러 끌기, 키보드는 ⠿에서 위·아래 — reorder-drag.js). 2) 주요 일정 표(weekly-hq-schedule.js)와
// 같은 모양·같은 부품·같은 저장(그 주 주간보고 행 draft.discuss, weekly-draft-store.js changeWeekDocs: 다시 읽고 그 칸만 바꿔 조건부 쓰기).
// 두 자리 — [주간 정리](place 'weekly')와 한글 파일 상자 1. 요청사항(place 'box') — 를 이 모듈 하나가 그린다. 고치기 상태는 자리마다, 자료는 하나.
// 관련 조직은 내 담당조직(my-organizations.js 규칙)에서 고른다. 브라우저 저장소에 아무것도 두지 않는다(조직 이름 목록은 이 화면 메모리에만).
import {changeWeekDocs, withDiscuss, draftDiscuss} from './weekly-draft-store.js';
import {withDiscussRow, withoutDiscussRow, movedDiscussRow, DISCUSS_MAX, DISCUSS_LIMITS} from './weekly-discuss.mjs';
import {pickMyOrganizations} from './my-organizations.js';
import {mountReorder} from './reorder-drag.js';
import {emptyEl, waitHtml} from './wait-state.js';

const TEXT = Object.freeze({
  missing:'3) 상집 논의 요청 저장 칸이 아직 준비되지 않았어요(서버 적용 전).',
  failed:'3) 상집 논의 요청을 불러오지 못했어요.',
  saveFailed:'저장하지 못했어요. 잠시 뒤 다시 해 주세요.',
  noTitle:'안건을 적어 주세요.',
  full:`줄은 ${DISCUSS_MAX}개까지예요.`,
});
const encode = encodeURIComponent;
const places = new Map(); // place → {ui, drag}
function fresh(start) { return {start, editing:null, draft:{}, saving:false, status:'', error:false, invalid:'', focus:''}; }

// 관련 조직 이름(내 담당조직, 가나다순). 작업공간마다 한 번 읽고 화면 메모리에만 둔다. 못 읽으면 빈 목록(고른 이름은 그대로 보임).
let orgCache = {workspace:'', names:null, flight:null};
function orgNames(rt, onReady) {
  const c = rt?.context?.read?.(), workspace = c?.workspace?.id, user = c?.user?.id;
  if (!workspace || !user) return [];
  if (orgCache.workspace !== workspace) orgCache = {workspace, names:null, flight:null};
  if (orgCache.names) return orgCache.names;
  if (!orgCache.flight) {
    const mine = orgCache;
    mine.flight = Promise.all([
      rt.api(`/rest/v1/app_suborganizations?workspace_id=eq.${encode(workspace)}&select=id,name,active&order=name.asc&limit=1000`),
      rt.api(`/rest/v1/app_suborganization_assignees?user_id=eq.${encode(user)}&select=organization_id`).catch(() => []),
    ]).then(([orgs, assignees]) => pickMyOrganizations(Array.isArray(orgs) ? orgs : [], Array.isArray(assignees) ? assignees : []).map(o => String(o.name ?? '').trim()).filter(Boolean))
      .catch(() => []).then(names => { if (orgCache === mine) { mine.names = [...new Set(names)].sort((a, b) => a.localeCompare(b, 'ko')); onReady(); } });
  }
  return [];
}

// slot: 자리, model: weeklySummary 결과(discuss), start: 그 주 월요일, onSaved(row): 서버에 쓴 뒤(journal.js가 재료를 바꾸고 두 자리를 다시 그림).
export function paintDiscuss(slot, {model, start, rt = window.KPTURuntime, onSaved = () => {}, redraw = () => {}, place = 'weekly'}) {
  if (!slot) return;
  if (!places.has(place)) places.set(place, {ui:fresh(''), drag:null});
  const own = places.get(place);
  let ui = own.ui;
  if (ui.start !== start) ui = own.ui = fresh(start);
  const setUi = next => { ui = own.ui = next; };
  own.drag?.destroy(); own.drag = null;
  const doc = slot.ownerDocument;
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const btn = (text, data, cls = 'mini') => { const b = el('button', cls, text); b.type = 'button'; b.dataset[data] = ''; return b; };
  const d = model?.discuss;
  if (!d || d.loading) { slot.innerHTML = waitHtml({rows:1}); return; }
  if (d.missing) { const p = el('p', 'journal-muted', TEXT.missing); p.dataset.journalDiscussMissing = ''; slot.replaceChildren(p); return; }
  if (d.failed || !d.editable) { const p = el('p', 'wait-fail journal-failed', TEXT.failed); slot.replaceChildren(p); return; }
  const rows = d.rows, busy = ui.saving;
  // 다시 그려도(조직 이름을 다 읽은 뒤 등) 고치던 칸의 초점은 그대로.
  const was = doc.activeElement, keepField = slot.contains(was) ? was?.dataset?.journalDiscussField : '';

  const table = el('table', 'journal-weekly-table journal-exec-table journal-discuss-table'); table.dataset.journalDiscussTable = '';
  table.innerHTML = '<thead><tr><th scope="col">안건</th><th scope="col">설명</th><th scope="col">관련 조직</th><th scope="col" class="journal-exec-tools-head" aria-label="고치기"></th></tr></thead>';
  const body = el('tbody'); body.dataset.reorderList = 'discuss';
  for (const row of rows) {
    if (ui.editing === row.id) { body.append(editRow(row)); continue; }
    const tr = el('tr'); tr.dataset.journalDiscussRow = row.id; tr.dataset.reorderId = row.id;
    const th = el('th', 'journal-weekly-what journal-discuss-title', row.title); th.scope = 'row';
    tr.append(th, el('td', 'journal-discuss-note', row.note ?? ''), el('td', 'journal-discuss-org', row.org ?? ''));
    const tools = el('td', 'journal-exec-tools');
    const grip = el('button', 'mini journal-hwpx-grip', '⠿'); grip.type = 'button'; grip.dataset.reorderHandle = ''; grip.setAttribute('aria-label', `${row.title} 순서 옮기기(위·아래 화살표)`);
    const edit = btn('고치기', 'journalDiscussEdit'); edit.dataset.journalDiscussEdit = row.id; edit.setAttribute('aria-label', `${row.title} 고치기`);
    if (busy || ui.editing) { edit.disabled = true; grip.disabled = true; }
    tools.append(grip, edit); tr.append(tools); body.append(tr);
  }
  if (ui.editing === 'new') body.append(editRow(null));
  table.append(body);
  const parts = [table];
  if (!rows.length && ui.editing !== 'new') parts.push(emptyEl('없음', {attrs:'data-journal-discuss-empty'}));
  if (!ui.editing) {
    const bar = el('div', 'journal-exec-bar');
    const add = btn('+ 줄 추가', 'journalDiscussAdd'); add.setAttribute('aria-label', '3) 상집 논의 요청 줄 추가'); add.disabled = busy || rows.length >= DISCUSS_MAX;
    bar.append(add); parts.push(bar);
  }
  const say = el('p', 'journal-line-status', ui.status || ''); say.dataset.journalDiscussStatus = ''; say.setAttribute('role', 'status'); say.setAttribute('aria-live', 'polite');
  if (ui.error) say.classList.add('journal-failed');
  parts.push(say);
  slot.replaceChildren(...parts);
  slot.onclick = onClick; slot.oninput = onInput; slot.onchange = onInput;
  if (!ui.editing && !busy) own.drag = mountReorder(slot, {listSelector:'[data-reorder-list="discuss"]', itemSelector:'tr[data-reorder-id]',
    onDrop:({id, index}) => save(list => movedDiscussRow(list, id, index), '순서를 바꿨어요.'),
    onStep:(id, dir) => { const at = rows.findIndex(r => r.id === id); if (at >= 0) save(list => movedDiscussRow(list, id, Math.max(0, at + dir)), '순서를 바꿨어요.', `tr[data-reorder-id="${id}"] [data-reorder-handle]`); }});
  if (ui.focus) { slot.querySelector(ui.focus)?.focus(); ui.focus = ''; }
  else if (keepField) slot.querySelector(`[data-journal-discuss-field="${keepField}"]`)?.focus();
  return;

  function editRow(row) {
    const tr = el('tr', 'journal-exec-edit-row'); tr.dataset.journalDiscussEditRow = row?.id ?? 'new';
    const td = el('td'); td.colSpan = 4;
    const form = el('div', 'journal-exec-form'); form.dataset.journalDiscussForm = row?.id ?? 'new';
    const v = ui.draft, key = row?.id ?? 'new';
    for (const [name, label, max] of [['title', '안건', DISCUSS_LIMITS.title], ['note', '설명', DISCUSS_LIMITS.note]]) {
      const wrap = el('label', `journal-exec-field journal-exec-${name === 'title' ? 'what' : 'place'}`); wrap.append(el('span', null, label));
      const input = el('input'); input.type = 'text'; input.value = v[name] ?? ''; input.dataset.journalDiscussField = name; input.id = `journalDiscuss-${place}-${key}-${name}`;
      input.maxLength = max; input.autocomplete = 'off';
      if (ui.invalid === name) input.setAttribute('aria-invalid', 'true');
      if (busy) input.disabled = true;
      wrap.append(input); form.append(wrap);
    }
    const wrap = el('label', 'journal-exec-field journal-exec-org'); wrap.append(el('span', null, '관련 조직'));
    const select = el('select'); select.dataset.journalDiscussField = 'org'; select.id = `journalDiscuss-${place}-${key}-org`;
    const names = orgNames(rt, redraw), cur = String(v.org ?? '');
    const none = el('option', null, '고르지 않음'); none.value = ''; select.append(none);
    for (const name of cur && !names.includes(cur) ? [cur, ...names] : names) { const o = el('option', null, name); o.value = name; select.append(o); }
    select.value = cur;
    if (busy) select.disabled = true;
    wrap.append(select); form.append(wrap);
    const actions = el('div', 'journal-edit-actions save-row');
    if (row) { const del = btn('×', 'journalDiscussDelete', 'mini journal-delete save-row-start'); del.dataset.journalDiscussDelete = row.id; del.setAttribute('aria-label', `${row.title} 줄 빼기`); actions.append(del); }
    const cancel = btn('취소', 'journalDiscussCancel'), ok = btn('저장', 'journalDiscussSave', 'mini primary');
    actions.append(cancel, ok);
    if (busy) for (const b of actions.children) b.disabled = true;
    form.append(actions); td.append(form); tr.append(td);
    return tr;
  }
  function onInput(event) {
    const t = event.target;
    if (!t.matches?.('[data-journal-discuss-field]')) return;
    ui.draft[t.dataset.journalDiscussField] = t.value;
    if (ui.invalid === t.dataset.journalDiscussField) { ui.invalid = ''; t.removeAttribute('aria-invalid'); }
  }
  function onClick(event) {
    const b = event.target.closest?.('button');
    if (!b || !slot.contains(b) || b.disabled) return;
    if (b.matches('[data-journal-discuss-add]')) { setUi({...fresh(start), editing:'new', draft:{title:'', note:'', org:''}, focus:'[data-journal-discuss-field="title"]'}); redraw(); }
    else if (b.matches('[data-journal-discuss-edit]')) { const row = rows.find(r => r.id === b.dataset.journalDiscussEdit); if (!row) return; setUi({...fresh(start), editing:row.id, draft:{title:row.title, note:row.note ?? '', org:row.org ?? ''}, focus:'[data-journal-discuss-field="title"]'}); redraw(); }
    else if (b.matches('[data-journal-discuss-cancel]')) { const id = ui.editing; setUi(fresh(start)); ui.focus = id && id !== 'new' ? `[data-journal-discuss-edit="${id}"]` : '[data-journal-discuss-add]'; redraw(); }
    else if (b.matches('[data-journal-discuss-save]')) void saveEdit();
    else if (b.matches('[data-journal-discuss-delete]')) { const id = b.dataset.journalDiscussDelete; void save(list => withoutDiscussRow(list, id), '줄을 뺐어요.', '[data-journal-discuss-add]'); }
  }
  async function saveEdit() {
    const id = ui.editing, v = {...ui.draft};
    if (!String(v.title ?? '').trim()) { ui.status = TEXT.noTitle; ui.error = true; ui.invalid = 'title'; ui.focus = '[data-journal-discuss-field="title"]'; redraw(); return; }
    const fields = {title:v.title, note:v.note, org:v.org};
    await save(list => withDiscussRow(list, {...(id && id !== 'new' ? {id} : {}), ...fields}), '저장했어요.', id && id !== 'new' ? `[data-journal-discuss-edit="${id}"]` : '[data-journal-discuss-add]');
  }
  // change(list) → 새 줄 목록(null이면 넘침).
  async function save(change, done, focus = '') {
    if (ui.saving) return;
    let full = false;
    ui.saving = true; ui.status = '저장하는 중…'; ui.error = false; redraw();
    try {
      const r = await changeWeekDocs({start, known:d.row, change:draft => { const next = change(draftDiscuss(draft)); if (!next) { full = true; return draft; } return withDiscuss(draft, next); }}, rt);
      if (r.missing) { setUi({...fresh(start), status:TEXT.missing, error:true}); redraw(); return; }
      setUi({...fresh(start), status:full ? TEXT.full : done, error:full});
      ui.focus = focus;
      onSaved(r.row);
    } catch {
      ui.saving = false; ui.status = TEXT.saveFailed; ui.error = true; redraw();
    }
  }
}
