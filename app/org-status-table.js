// DESK-현황표(요청함 10/30 13:38, 명진 결정 "모두반영"): 담당조직 상세 [현황 표] 소탭 한 곳의 그리기·읽기·쓰기.
// 표 '일 | 주요 일정·현황 | [고치기]', 처음 4줄(나머지는 '지난 줄 n 펼치기'), [+ 줄 추가], 고치기 줄의 [빼기], ⠿ 끌어 순서(폰은 길게 눌러, 키보드는 위·아래),
// 날짜는 공용 날짜 칸(date-field.js가 붙음). [기록에서 다시 채우기 (AI)]는 서버 AI(ai-assist org_status_rows)가 그 조직 최근 기록에서 뽑은 줄로
// AI 줄(source=ai)만 바꾸고, 명진이 넣거나 고친 줄(source=user)은 덮어쓰지 않는다(판정은 org-status-model.mjs). 표가 비었고 기록이 있으면 처음 열 때 한 번 채운다.
// 자료는 app_org_status_rows(migration 20261030234000) 한 곳 — 주간보고 '3. 2) 투쟁 사업장 현황' 그 조직 칸이 같은 줄을 읽는다(journal-hwpx.js).
// 표가 없으면(DB 적용 전) '준비 중' 한 줄. 이 자리(#wdStatusTable)는 이 모듈 하나가 그린다. 브라우저 저장소에 아무것도 두지 않는다.
import {waitHtml, emptyHtml} from './wait-state.js';
import {missingTable} from './feed-model.mjs';
import {callAiAssist} from './basket-ai-summary.js';
import {seoulDateKey, formatSeoulTime} from './meeting-time.js';
import {mountReorder} from './reorder-drag.js';
import {sortRows, splitRows, dayLabel, cleanBody, validDay, refillPlan, insertRow, moveRow, orderChanges, ROWS_MAX, BODY_MAX} from './org-status-model.mjs';

const TABLE = '/rest/v1/app_org_status_rows';
const COLS = 'id,organization_id,day,body,sort_order,source,evidence,updated_at';
const enc = encodeURIComponent;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const TEXT = {
  missing: '현황 표는 준비 중이에요.', failed: '현황 표를 불러오지 못했어요.', saveFailed: '저장하지 못했어요. 다시 눌러 주세요.',
  noBody: '내용을 적어 주세요.', noDay: '날짜를 골라 주세요.', full: `줄은 ${ROWS_MAX}개까지예요.`,
  aiRun: 'AI가 기록에서 주요 일정을 뽑는 중…', aiNone: '기록에서 뽑을 주요 일정이 없었어요.', aiFail: 'AI로 채우지 못했어요. 잠시 뒤 다시 눌러 주세요.',
};

// 여러 조직의 표 줄(주간보고가 씀). 표가 없으면 {missing:true}, 읽지 못하면 throw. 반환 Map(조직 id → 줄들).
export async function readStatusRows({rt = window.KPTURuntime, workspaceId, orgIds = []} = {}) {
  const ids = [...new Set(orgIds.filter(Boolean))];
  const out = new Map(ids.map(id => [id, []]));
  if (!ids.length || !workspaceId) return {rows: out};
  try {
    for (let i = 0; i < ids.length; i += 50) {
      const rows = await rt.api(`${TABLE}?workspace_id=eq.${enc(workspaceId)}&organization_id=in.(${ids.slice(i, i + 50).map(enc).join(',')})&select=${COLS}&order=sort_order.asc,day.desc&limit=1000`, {singleFlight: false});
      if (!Array.isArray(rows)) throw new Error('rows');
      for (const r of rows) if (out.has(r.organization_id)) out.get(r.organization_id).push(r);
    }
  } catch (e) { if (missingTable(e)) return {missing: true, rows: out}; throw e; }
  return {rows: out};
}

let ui = null; // {host, orgId, orgName, workspaceId, canEdit, rt, getRecords, rows, status, editing, draft, busy, msg:{text,error}, run, invalid, focus}
const tried = new Set(); // 처음 채우기를 이번 접속에서 이미 시도한 조직
let drag = null;

export function paintStatusTable(opts) {
  const same = ui && ui.orgId === opts.orgId && ui.host === opts.host;
  ui = {rows: [], status: 'loading', editing: null, draft: null, busy: false, msg: {text: '', error: false}, invalid: '', focus: '',
    ...(same ? {rows: ui.rows, status: ui.status, editing: ui.editing, draft: ui.draft, busy: ui.busy, msg: ui.msg} : {}), ...opts, run: (ui?.run || 0) + 1};
  bind(ui.host);
  paint();
  void load(ui.run);
}
export function clearStatusTable() { drag?.destroy(); drag = null; if (ui) ui.host.replaceChildren(); ui = null; }

async function load(run) {
  const {rt, orgId, workspaceId} = ui;
  try {
    const r = await readStatusRows({rt, workspaceId, orgIds: [orgId]});
    if (!ui || ui.run !== run) return;
    ui.status = r.missing ? 'missing' : 'ready'; ui.rows = sortRows(r.rows.get(orgId) || []);
  } catch { if (!ui || ui.run !== run) return; ui.status = 'error'; }
  paint();
  maybeFirstFill(run);
}
// 처음: 표가 비었고 조직 기록이 있으면 AI로 한 번 채운다(이번 접속에서 조직마다 한 번).
function maybeFirstFill(run) {
  if (!ui || ui.run !== run || ui.status !== 'ready' || !ui.canEdit || ui.rows.length || ui.busy || ui.editing) return;
  if (tried.has(ui.orgId) || !(ui.getRecords?.() || []).length) return;
  tried.add(ui.orgId);
  void refill(true);
}

function recordText(x) {
  const t = String(x.raw_text ?? x.summary ?? x.note_text ?? x.text ?? '').replace(/\s+/g, ' ').trim();
  return [...t].slice(0, 60).join('') + ([...t].length > 60 ? '…' : '');
}
function evidenceHtml(row) {
  const ids = new Set(row.evidence || []);
  if (!ids.size) return '';
  const recs = (ui.getRecords?.() || []).filter(x => [x.id, x.note_id, x.noteId].some(v => v && ids.has(v)));
  const items = recs.map(x => `<li>${x.occurred_at ? `<small>${esc(formatSeoulTime(x.occurred_at, {month: 'numeric', day: 'numeric'}))}</small> ` : ''}${esc(recordText(x))}</li>`).join('');
  return `<details class="wd-st-ev"><summary>근거 ${ids.size}</summary>${items ? `<ul>${items}</ul>` : '<p>기록 목록에서 찾지 못했어요.</p>'}</details>`;
}
function rowHtml(r, disabled) {
  const label = esc(cleanBody(r.body));
  const tools = ui.canEdit ? `<td class="wd-st-tools"><button type="button" class="wd-st-btn wd-st-grip" data-reorder-handle aria-label="${label} 순서 옮기기(위·아래 화살표)"${disabled ? ' disabled' : ''}>⠿</button><button type="button" class="wd-st-btn" data-st-edit="${esc(r.id)}" aria-label="${label} 고치기"${disabled ? ' disabled' : ''}>고치기</button></td>` : '';
  return `<tr data-st-row="${esc(r.id)}" data-reorder-id="${esc(r.id)}"><th scope="row" class="wd-st-day">${esc(dayLabel(r.day) || '—')}</th><td class="wd-st-body">${label}${r.source === 'ai' ? '<span class="wd-st-tag" title="AI가 기록에서 뽑은 줄 — 고치면 내 줄이 돼요">AI</span>' : ''}${evidenceHtml(r)}</td>${tools}</tr>`;
}
function editHtml(row) {
  const d = ui.draft || {}, key = row?.id ?? 'new', busy = ui.busy;
  return `<tr class="wd-st-edit" data-st-edit-row="${esc(key)}"><td colspan="3"><div class="wd-st-form">`
    + `<label class="wd-st-f-day"><span>일</span><input type="date" data-st-field="day" value="${esc(d.day || '')}"${ui.invalid === 'day' ? ' aria-invalid="true"' : ''}${busy ? ' disabled' : ''}></label>`
    + `<label class="wd-st-f-body"><span>주요 일정·현황</span><input type="text" data-st-field="body" maxlength="${BODY_MAX}" autocomplete="off" value="${esc(d.body || '')}"${ui.invalid === 'body' ? ' aria-invalid="true"' : ''}${busy ? ' disabled' : ''}></label>`
    + `<div class="wd-st-actions">${row ? `<button type="button" class="wd-st-btn wd-st-del" data-st-delete="${esc(row.id)}"${busy ? ' disabled' : ''}>빼기</button>` : ''}<button type="button" class="wd-st-btn" data-st-cancel${busy ? ' disabled' : ''}>취소</button><button type="button" class="wd-st-btn primary" data-st-save${busy ? ' disabled' : ''}>저장</button></div>`
    + `</div></td></tr>`;
}
function paint() {
  if (!ui) return;
  drag?.destroy(); drag = null;
  const {host, status, rows, canEdit, editing, busy, msg} = ui;
  if (status === 'loading' && !rows.length) { host.innerHTML = waitHtml({rows: 3}); return; }
  if (status === 'missing') { host.innerHTML = `<p class="wd-st-note" data-st-missing>${TEXT.missing}</p>`; return; }
  if (status === 'error') { host.innerHTML = `<p class="wd-st-note" role="alert">${TEXT.failed} <button type="button" class="wd-st-btn" data-st-retry>다시 시도</button></p>`; return; }
  const {shown, older} = splitRows(rows), dis = busy || !!editing;
  const body = list => list.map(r => editing === r.id ? editHtml(r) : rowHtml(r, dis)).join('');
  const head = `<thead><tr><th scope="col" class="wd-st-day">일</th><th scope="col">주요 일정·현황</th>${canEdit ? '<th scope="col" class="wd-st-tools" aria-label="고치기"></th>' : ''}</tr></thead>`;
  const olderOpen = older.some(r => r.id === editing);
  let html = `<table class="wd-st-table" data-st-table>${head}<tbody data-reorder-list="st">${body(shown)}${editing === 'new' ? editHtml(null) : ''}</tbody></table>`;
  if (!rows.length && editing !== 'new') html += emptyHtml('없음', {attrs: 'data-st-empty'});
  if (older.length) html += `<details class="wd-st-older" data-st-older${olderOpen ? ' open' : ''}><summary>지난 줄 ${older.length} 펼치기</summary><table class="wd-st-table"><tbody data-reorder-list="st-older">${body(older)}</tbody></table></details>`;
  if (canEdit && !editing) html += `<div class="wd-st-bar"><button type="button" class="wd-st-btn" data-st-add${busy || rows.length >= ROWS_MAX ? ' disabled' : ''}>+ 줄 추가</button><button type="button" class="wd-st-btn" data-st-refill${busy ? ' disabled' : ''}>기록에서 다시 채우기 (AI)</button></div>`;
  html += `<p class="wd-st-hint">주간보고 투쟁 사업장 현황에 그대로 들어감</p><p class="wd-st-status${msg.error ? ' is-error' : ''}" role="status" aria-live="polite" data-st-status>${esc(msg.text)}</p>`;
  host.innerHTML = html;
  if (canEdit && !dis && rows.length > 1) drag = mountReorder(host, {listSelector: '[data-reorder-list]', itemSelector: 'tr[data-reorder-id]',
    onDrop: ({id, index}) => { const all = sortRows(ui.rows), from = all.findIndex(r => r.id === id); if (from < 0) return; const [it] = all.splice(from, 1); all.splice(Math.min(index, all.length), 0, it); void saveOrder(all.map((r, k) => ({...r, sort_order: k})), id); },
    onStep: (id, dir) => { const next = moveRow(ui.rows, id, dir); if (next) void saveOrder(next, id); }});
  if (ui.focus) { host.querySelector(ui.focus)?.focus({preventScroll: true}); ui.focus = ''; }
}
function say(text, error = false) { if (!ui) return; ui.msg = {text, error}; const el = ui.host.querySelector('[data-st-status]'); if (el) { el.textContent = text; el.classList.toggle('is-error', error); } }

function bind(host) {
  if (host.dataset.stBound) return;
  host.dataset.stBound = '1';
  host.addEventListener('input', e => { const t = e.target; if (!ui || ui.host !== host || !t.matches?.('[data-st-field]')) return; ui.draft = {...(ui.draft || {}), [t.dataset.stField]: t.value}; if (ui.invalid === t.dataset.stField) { ui.invalid = ''; t.removeAttribute('aria-invalid'); } });
  host.addEventListener('change', e => { const t = e.target; if (ui && ui.host === host && t.matches?.('[data-st-field]')) ui.draft = {...(ui.draft || {}), [t.dataset.stField]: t.value}; });
  host.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing && e.target.matches?.('[data-st-field]')) { e.preventDefault(); void saveEdit(); } else if (e.key === 'Escape' && ui?.editing) { e.preventDefault(); cancel(); } });
  host.addEventListener('click', e => {
    const b = e.target.closest?.('button'); if (!b || !ui || ui.host !== host || b.disabled) return;
    if ('stRetry' in b.dataset) { ui.status = 'loading'; paint(); void load(ui.run); }
    else if ('stAdd' in b.dataset) { ui.editing = 'new'; ui.draft = {day: seoulDateKey(Date.now()), body: ''}; ui.focus = '[data-st-field="body"]'; ui.msg = {text: '', error: false}; paint(); }
    else if (b.dataset.stEdit) { const r = ui.rows.find(x => x.id === b.dataset.stEdit); if (!r) return; ui.editing = r.id; ui.draft = {day: r.day, body: r.body}; ui.focus = '[data-st-field="body"]'; ui.msg = {text: '', error: false}; paint(); }
    else if ('stCancel' in b.dataset) cancel();
    else if ('stSave' in b.dataset) void saveEdit();
    else if (b.dataset.stDelete) void removeRow(b.dataset.stDelete);
    else if ('stRefill' in b.dataset) void refill(false);
  });
}
function cancel() { const id = ui.editing; ui.editing = null; ui.draft = null; ui.invalid = ''; ui.focus = id && id !== 'new' ? `[data-st-edit="${id}"]` : '[data-st-add]'; paint(); }

const scope = () => `workspace_id=eq.${enc(ui.workspaceId)}&organization_id=eq.${enc(ui.orgId)}`;
function changed() { window.dispatchEvent(new CustomEvent('kptu:org-status-changed', {detail: {organization_id: ui?.orgId}})); }
// 쓰기 하나를 감싼다: 바쁨 표시 → work() → 다시 읽기 → 알림. 실패해도 다시 읽어 서버 판을 보인다.
async function write(work, done, focus = '') {
  if (!ui || ui.busy) return false;
  const me = ui, run = ui.run;
  me.busy = true; say('저장하는 중…'); paint();
  let ok = true;
  try { await work(); } catch (e) { ok = false; console.warn('org status write failed', e?.message || e); }
  try { const r = await readStatusRows({rt: me.rt, workspaceId: me.workspaceId, orgIds: [me.orgId]}); if (ui === me && ui.run === run) ui.rows = sortRows(r.rows.get(me.orgId) || []); } catch { /* 다음에 다시 읽음 */ }
  if (ui !== me || ui.run !== run) return ok;
  me.busy = false;
  if (ok) { me.editing = null; me.draft = null; me.focus = focus; }
  me.msg = {text: ok ? done : TEXT.saveFailed, error: !ok};
  paint();
  if (ok) changed();
  return ok;
}
async function saveEdit() {
  if (!ui?.editing || ui.busy) return;
  const d = ui.draft || {}, body = cleanBody(d.body), day = d.day, id = ui.editing;
  if (!validDay(day)) { ui.invalid = 'day'; ui.msg = {text: TEXT.noDay, error: true}; paint(); return; }
  if (!body) { ui.invalid = 'body'; ui.msg = {text: TEXT.noBody, error: true}; paint(); return; }
  const {rt} = ui;
  if (id === 'new') {
    if (ui.rows.length >= ROWS_MAX) { ui.msg = {text: TEXT.full, error: true}; paint(); return; }
    const next = insertRow(ui.rows, {id: null, day, body, source: 'user', evidence: []}), at = next.findIndex(r => !r.id), prev = ui.rows;
    await write(async () => {
      await rt.api(`${TABLE}?select=id`, {method: 'POST', body: {workspace_id: ui.workspaceId, organization_id: ui.orgId, day, body, sort_order: at, source: 'user', evidence: []}, prefer: 'return=representation', singleFlight: false});
      for (const c of orderChanges(next.filter(r => r.id), prev)) await patchRow(c.id, {sort_order: c.sort_order});
    }, '줄을 넣었어요.', '[data-st-add]');
    return;
  }
  // 고친 줄은 내 줄(source=user)이 된다 — 다시 채우기가 덮어쓰지 않는다.
  await write(() => patchRow(id, {day, body, source: 'user', updated_at: new Date().toISOString()}), '저장했어요.', `[data-st-edit="${id}"]`);
}
async function patchRow(id, body) {
  const rows = await ui.rt.api(`${TABLE}?id=eq.${enc(id)}&${scope()}&select=id`, {method: 'PATCH', body, prefer: 'return=representation', singleFlight: false});
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('patch');
}
async function removeRow(id) {
  await write(async () => {
    const rows = await ui.rt.api(`${TABLE}?id=eq.${enc(id)}&${scope()}&select=id`, {method: 'DELETE', prefer: 'return=representation', singleFlight: false});
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error('delete');
  }, '줄을 뺐어요.', '[data-st-add]');
}
async function saveOrder(next, id) {
  const changes = orderChanges(next, ui.rows);
  if (!changes.length) return;
  await write(async () => { for (const c of changes) await patchRow(c.id, {sort_order: c.sort_order}); }, '순서를 바꿨어요.', `tr[data-reorder-id="${id}"] [data-reorder-handle]`);
}
// [기록에서 다시 채우기 (AI)] — 서버는 줄 후보만 돌려주고, 표에 넣는 것은 여기(내 로그인, owner RLS).
async function refill(first) {
  if (!ui || ui.busy || !ui.canEdit) return;
  const me = ui, run = ui.run;
  me.busy = true; say(TEXT.aiRun); paint();
  const r = await callAiAssist({kind: 'org_status_rows', organization_id: me.orgId}, {rt: me.rt}).catch(() => ({ok: false}));
  if (ui !== me || ui.run !== run) return;
  me.busy = false;
  if (!r?.ok) { me.msg = {text: first ? '' : TEXT.aiFail, error: !first}; paint(); return; }
  const ai = Array.isArray(r.data?.rows) ? r.data.rows : [];
  const plan = refillPlan(me.rows, ai);
  if (!plan.add.length && !plan.remove.length) { me.msg = {text: first ? '' : TEXT.aiNone, error: false}; paint(); return; }
  await write(async () => {
    if (plan.remove.length) {
      const gone = await me.rt.api(`${TABLE}?id=in.(${plan.remove.map(enc).join(',')})&${scope()}&source=eq.ai&select=id`, {method: 'DELETE', prefer: 'return=representation', singleFlight: false});
      if (!Array.isArray(gone)) throw new Error('delete');
    }
    if (plan.add.length) await me.rt.api(`${TABLE}?select=id`, {method: 'POST', body: plan.add.map(a => ({workspace_id: me.workspaceId, organization_id: me.orgId, day: a.day, body: a.body, sort_order: a.sort_order, source: 'ai', evidence: a.evidence})), prefer: 'return=representation', singleFlight: false});
    for (const c of plan.order) await patchRow(c.id, {sort_order: c.sort_order});
  }, plan.add.length ? `기록에서 ${plan.add.length}줄을 채웠어요.` : TEXT.aiNone, '[data-st-refill]');
}
