// DESK-현황표(요청함 10/30 13:38, 명진 결정 "모두반영"): 담당조직 상세 [현황 표] 소탭 한 곳의 그리기·읽기·쓰기.
// 표 '일 | 주요 일정·현황', 날짜 오름차순(DESK-현황오름차순)으로 가장 최근 4줄(그 앞 오래된 줄은 위 '지난 줄 n 펼치기'), [+ 줄 추가], 고치기 줄의 [빼기].
// 날짜는 공용 날짜 칸 두 개 [시작일] ~ [끝나는 날(선택)](DESK-일정기간, date-field.js가 붙음). 순서는 날짜가 정하므로 손으로 옮기는 기능은 없다. [기록에서 다시 채우기 (AI)]는 서버 AI(ai-assist org_status_rows)가 그 조직 최근 기록에서 뽑은 줄로
// AI 줄(source=ai)만 바꾸고, 명진이 넣거나 고친 줄(source=user)은 덮어쓰지 않는다(판정은 org-status-model.mjs). 표가 비었고 기록이 있으면 처음 열 때 한 번 채운다.
// 자료는 app_org_status_rows(migration 20261030234000) 한 곳 — 주간보고 '3. 2) 투쟁 사업장 현황' 그 조직 칸이 같은 줄을 읽는다(journal-hwpx.js).
// 표가 없으면(DB 적용 전) '준비 중' 한 줄. 이 자리(#wdStatusTable)는 이 모듈 하나가 그린다. 브라우저 저장소에 아무것도 두지 않는다.
// DESK-전체현황표: 줄 쓰기(넣기·고치기·빼기)와 AI 채우기는 아래 export 함수 한 곳이고, 담당조직 [전체 표](org-overview.js)도 같은 함수를 쓴다(새 저장 자리 없음).
// 줄 모양: '일 | 주요 일정·현황' 두 칸. 고치기 버튼 칸은 없다 — 줄(글)을 누르면 여러 줄 칸으로 열린다.
// 일 칸 폭은 끌어 바꾸고 서버에 기억한다(view_prefs.col_widths.orgst, S49-4 공용 col-resize.js).
import {waitHtml, emptyHtml} from './wait-state.js';
import {missingTable} from './feed-model.mjs';
import {callAiAssist} from './basket-ai-summary.js';
import {seoulDateKey, formatSeoulTime} from './meeting-time.js';
import {mountColResize, gripHtml} from './col-resize.js';
import {suggestOrgWeek} from './weekly-org-suggest.js';
import {sortRows, splitRows, periodLabel, cleanBody, validDay, validEnd, refillPlan, nextOrder, ROWS_MAX, BODY_MAX} from './org-status-model.mjs';

const TABLE = '/rest/v1/app_org_status_rows';
const COLS = 'id,organization_id,day,end_day,body,sort_order,source,evidence,updated_at';
const enc = encodeURIComponent;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const TEXT = {
  missing: '현황 표는 준비 중이에요.', failed: '현황 표를 불러오지 못했어요.', saveFailed: '저장하지 못했어요. 다시 눌러 주세요.',
  noBody: '내용을 적어 주세요.', noDay: '시작일을 골라 주세요.', badEnd: '끝나는 날은 시작일과 같거나 뒤여야 해요.', full: `줄은 ${ROWS_MAX}개까지예요.`,
  aiRun: 'AI가 기록에서 주요 일정을 뽑는 중…', aiNone: '기록에서 뽑을 주요 일정이 없었어요.', aiFail: 'AI로 채우지 못했어요. 잠시 뒤 다시 눌러 주세요.',
};

// 여러 조직의 표 줄(주간보고가 씀). 표가 없으면 {missing:true}, 읽지 못하면 throw. 반환 Map(조직 id → 줄들).
export async function readStatusRows({rt = window.KPTURuntime, workspaceId, orgIds = []} = {}) {
  const ids = [...new Set(orgIds.filter(Boolean))];
  const out = new Map(ids.map(id => [id, []]));
  if (!ids.length || !workspaceId) return {rows: out};
  try {
    for (let i = 0; i < ids.length; i += 50) {
      const rows = await rt.api(`${TABLE}?workspace_id=eq.${enc(workspaceId)}&organization_id=in.(${ids.slice(i, i + 50).map(enc).join(',')})&select=${COLS}&order=day.asc,sort_order.asc&limit=1000`, {singleFlight: false});
      if (!Array.isArray(rows)) throw new Error('rows');
      for (const r of rows) if (out.has(r.organization_id)) out.get(r.organization_id).push(r);
    }
  } catch (e) { if (missingTable(e)) return {missing: true, rows: out}; throw e; }
  return {rows: out};
}

let ui = null; // {host, orgId, orgName, workspaceId, canEdit, rt, getRecords, rows, status, editing, draft, busy, msg:{text,error}, run, invalid, focus}
const tried = new Set(); // 처음 채우기를 이번 접속에서 이미 시도한 조직

export function paintStatusTable(opts) {
  const same = ui && ui.orgId === opts.orgId && ui.host === opts.host;
  ui = {rows: [], status: 'loading', editing: null, draft: null, busy: false, msg: {text: '', error: false}, invalid: '', focus: '',
    ...(same ? {rows: ui.rows, status: ui.status, editing: ui.editing, draft: ui.draft, busy: ui.busy, msg: ui.msg} : {}), ...opts, run: (ui?.run || 0) + 1};
  bind(ui.host);
  paint();
  void load(ui.run);
}
export function clearStatusTable() { if (ui) ui.host.replaceChildren(); ui = null; }

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
  const day = esc(periodLabel(r.day, r.end_day) || '—');
  const dayCell = `<th scope="row" class="wd-st-day"><span class="wd-st-day-text">${day}</span></th>`;
  const text = ui.canEdit && !disabled
    ? `<span class="wd-st-text" role="button" tabindex="0" data-st-edit="${esc(r.id)}" aria-label="${label} 고치기">${label}</span>`
    : `<span class="wd-st-text">${label}</span>`;
  return `<tr data-st-row="${esc(r.id)}">${dayCell}<td class="wd-st-body">${text}${r.source === 'ai' ? '<span class="wd-st-tag" title="AI가 기록에서 뽑은 줄 — 고치면 내 줄이 돼요">AI</span>' : ''}${evidenceHtml(r)}</td></tr>`;
}
// 고치기·넣기 칸(상세 표와 전체 표가 함께 씀): 시작일 ~ 끝나는 날(선택)(달력 둘) + 주요 일정·현황(글 길이만큼 늘어나는 여러 줄 칸) + [빼기][취소][저장](같은 크기, 저장만 색).
export function editFormHtml({key, draft = {}, invalid = '', busy = false, canDelete = false, deleteId = ''}) {
  const d = draft, dis = busy ? ' disabled' : '';
  return `<div class="wd-st-form" data-st-form="${esc(key)}">`
    + `<div class="wd-st-f-days"><label class="wd-st-f-day"><span>시작일</span><input type="date" data-st-field="day" value="${esc(d.day || '')}"${invalid === 'day' ? ' aria-invalid="true"' : ''}${dis}></label>`
    + `<span class="wd-st-f-tilde" aria-hidden="true">~</span><label class="wd-st-f-day"><span>끝나는 날(선택)</span><input type="date" data-st-field="end_day" value="${esc(d.end_day || '')}"${d.day ? ` min="${esc(d.day)}"` : ''}${invalid === 'end_day' ? ' aria-invalid="true"' : ''}${dis}></label></div>`
    + `<label class="wd-st-f-body"><span>주요 일정·현황</span><textarea data-st-field="body" rows="2" maxlength="${BODY_MAX}" autocomplete="off"${invalid === 'body' ? ' aria-invalid="true"' : ''}${dis}>${esc(d.body || '')}</textarea></label>`
    + `<div class="wd-st-actions btn-row">${canDelete ? `<button type="button" class="wd-st-btn wd-st-del" data-st-delete="${esc(deleteId)}"${dis}>빼기</button>` : ''}<button type="button" class="wd-st-btn" data-st-cancel${dis}>취소</button><button type="button" class="wd-st-btn primary" data-st-save${dis}>저장</button></div>`
    + `</div>`;
}
// 글 길이만큼 높이를 늘린다(열 때 전체가 보이고, 쓰면서 늘어남).
export function fitTextarea(el) { if (!el) return; el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; }
function editHtml(row) {
  const key = row?.id ?? 'new';
  return `<tr class="wd-st-edit" data-st-edit-row="${esc(key)}"><td colspan="2">${editFormHtml({key, draft: ui.draft || {}, invalid: ui.invalid, busy: ui.busy, canDelete: !!row, deleteId: row?.id || ''})}</td></tr>`;
}
function paint() {
  if (!ui) return;
  const {host, status, rows, canEdit, editing, busy, msg} = ui;
  if (status === 'loading' && !rows.length) { host.innerHTML = waitHtml({rows: 3}); return; }
  if (status === 'missing') { host.innerHTML = `<p class="wd-st-note" data-st-missing>${TEXT.missing}</p>`; return; }
  if (status === 'error') { host.innerHTML = `<p class="wd-st-note" role="alert">${TEXT.failed} <button type="button" class="wd-st-btn" data-st-retry>다시 시도</button></p>`; return; }
  const {shown, older} = splitRows(rows), dis = busy || !!editing;
  const body = list => list.map(r => editing === r.id ? editHtml(r) : rowHtml(r, dis)).join('');
  const head = `<thead><tr><th scope="col" class="wd-st-day">일${gripHtml('day', '일', 1)}</th><th scope="col">주요 일정·현황</th></tr></thead>`;
  const olderOpen = older.some(r => r.id === editing);
  let html = '';
  if (older.length) html += `<details class="wd-st-older" data-st-older${olderOpen ? ' open' : ''}><summary>지난 줄 ${older.length} 펼치기</summary><table class="wd-st-table"><tbody>${body(older)}</tbody></table></details>`;
  html += `<table class="wd-st-table" data-st-table>${head}<tbody>${body(shown)}${editing === 'new' ? editHtml(null) : ''}</tbody></table>`;
  if (!rows.length && editing !== 'new') html += emptyHtml('없음', {attrs: 'data-st-empty'});
  if (canEdit && !editing) html += `<div class="wd-st-bar btn-row"><button type="button" class="wd-st-btn" data-st-add${busy || rows.length >= ROWS_MAX ? ' disabled' : ''}>+ 줄 추가</button><button type="button" class="wd-st-btn" data-st-refill${busy ? ' disabled' : ''}>기록에서 다시 채우기 (AI)</button></div>`;
  html += `<p class="wd-st-status${msg.error ? ' is-error' : ''}" role="status" aria-live="polite" data-st-status>${esc(msg.text)}</p>`;
  host.innerHTML = html;
  mountColResize({host, name: 'orgst', vars: {day: '--st-w-day'}, dir: 1, labels: {day: '일'}, fit: key => Math.ceil(Math.max(0, ...[...host.querySelectorAll('.wd-st-day-text')].map(el => el.getBoundingClientRect().width)))});
  host.querySelectorAll('textarea[data-st-field]').forEach(fitTextarea);
  if (ui.focus) {
    const el = host.querySelector(ui.focus);
    el?.focus({preventScroll: true});
    // 폰 키보드가 올라와도 입력칸·[저장]이 가려지지 않게: 열린 칸 전체를 화면 안으로(CSS scroll-margin이 키보드 높이만큼 여백).
    if (el && el.matches('textarea,input')) host.querySelector('.wd-st-edit')?.scrollIntoView({block: 'nearest'});
    ui.focus = '';
  }
}
function say(text, error = false) { if (!ui) return; ui.msg = {text, error}; const el = ui.host.querySelector('[data-st-status]'); if (el) { el.textContent = text; el.classList.toggle('is-error', error); } }

function bind(host) {
  if (host.dataset.stBound) return;
  host.dataset.stBound = '1';
  host.addEventListener('input', e => { const t = e.target; if (!ui || ui.host !== host || !t.matches?.('[data-st-field]')) return; if (t.tagName === 'TEXTAREA') fitTextarea(t); ui.draft = {...(ui.draft || {}), [t.dataset.stField]: t.value}; if (ui.invalid === t.dataset.stField) { ui.invalid = ''; t.removeAttribute('aria-invalid'); } });
  host.addEventListener('change', e => { const t = e.target; if (ui && ui.host === host && t.matches?.('[data-st-field]')) { ui.draft = {...(ui.draft || {}), [t.dataset.stField]: t.value}; if (t.dataset.stField === 'day') t.closest('.wd-st-form')?.querySelector('[data-st-field="end_day"]')?.setAttribute('min', t.value); } });
  host.addEventListener('keydown', e => { const sp = e.target.closest?.('[data-st-edit]'); if (sp && ui && ui.host === host && !ui.busy && !ui.editing && (e.key === 'Enter' || e.key === ' ') && e.target === sp) { e.preventDefault(); sp.click(); return; } if (e.key === 'Enter' && !e.isComposing && !e.shiftKey && e.target.matches?.('[data-st-field]')) { e.preventDefault(); void saveEdit(); } else if (e.key === 'Escape' && ui?.editing) { e.preventDefault(); cancel(); } });
  host.addEventListener('click', e => {
    const b = e.target.closest?.('button,[data-st-edit]'); if (!b || !ui || ui.host !== host || b.disabled) return;
    if ('stRetry' in b.dataset) { ui.status = 'loading'; paint(); void load(ui.run); }
    else if ('stAdd' in b.dataset) { ui.editing = 'new'; ui.draft = {day: seoulDateKey(Date.now()), end_day: '', body: ''}; ui.focus = '[data-st-field="body"]'; ui.msg = {text: '', error: false}; paint(); }
    else if (b.dataset.stEdit) { const r = ui.rows.find(x => x.id === b.dataset.stEdit); if (!r) return; ui.editing = r.id; ui.draft = {day: r.day, end_day: r.end_day || '', body: r.body}; ui.focus = '[data-st-field="body"]'; ui.msg = {text: '', error: false}; paint(); }
    else if ('stCancel' in b.dataset) cancel();
    else if ('stSave' in b.dataset) void saveEdit();
    else if (b.dataset.stDelete) void removeRow(b.dataset.stDelete);
    else if ('stRefill' in b.dataset) void refill(false);
  });
}
function cancel() { const id = ui.editing; ui.editing = null; ui.draft = null; ui.invalid = ''; ui.focus = id && id !== 'new' ? `[data-st-edit="${id}"]` : '[data-st-add]'; paint(); }

const scope = c => `workspace_id=eq.${enc(c.workspaceId)}&organization_id=eq.${enc(c.orgId)}`;
const ctxOf = () => ({rt: ui.rt, workspaceId: ui.workspaceId, orgId: ui.orgId});
function changed(orgId = ui?.orgId) { window.dispatchEvent(new CustomEvent('kptu:org-status-changed', {detail: {organization_id: orgId}})); }

// ---- 줄 쓰기·AI 채우기(상세 표와 담당조직 [전체 표]가 함께 씀). c = {rt, workspaceId, orgId}. 실패하면 throw — 부르는 쪽이 다시 읽어 서버 판을 보인다. ----
export async function patchStatusRow(c, id, body) {
  const rows = await c.rt.api(`${TABLE}?id=eq.${enc(id)}&${scope(c)}&select=id`, {method: 'PATCH', body, prefer: 'return=representation', singleFlight: false});
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('patch');
  suggestOrgWeek('status_row', id, {rt: c.rt}); // WEEKLY-메뉴짝짓기 P4: 그 주 조직보고 제안 줄(AI 없이 그대로, 기다리지 않음)
}
export async function deleteStatusRow(c, id) {
  const rows = await c.rt.api(`${TABLE}?id=eq.${enc(id)}&${scope(c)}&select=id`, {method: 'DELETE', prefer: 'return=representation', singleFlight: false});
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('delete');
}
// 내 줄 하나 넣기(순서는 날짜가 정하므로 sort_order는 맨 뒤 번호). rows = 그 조직의 지금 줄들. end_day가 비면 하루 일정.
export async function createStatusRow(c, rows, {day, end_day = null, body}) {
  const made = await c.rt.api(`${TABLE}?select=id`, {method: 'POST', body: {workspace_id: c.workspaceId, organization_id: c.orgId, day, ...(end_day ? {end_day} : {}), body, sort_order: nextOrder(rows), source: 'user', evidence: []}, prefer: 'return=representation', singleFlight: false});
  if (Array.isArray(made) && made[0]?.id) suggestOrgWeek('status_row', made[0].id, {rt: c.rt}); // WEEKLY-메뉴짝짓기 P4
}
// 서버 AI(ai-assist org_status_rows)에게 그 조직 줄 후보를 받는다. 서버는 표에 이미 있는 줄과 같은 일을 걸러서 준다. 반환 {ok, rows}.
export async function fetchAiRows(c) {
  const r = await callAiAssist({kind: 'org_status_rows', organization_id: c.orgId}, {rt: c.rt}).catch(() => ({ok: false}));
  return r?.ok ? {ok: true, rows: Array.isArray(r.data?.rows) ? r.data.rows : []} : {ok: false, rows: []};
}
// 다시 채우기 계획(org-status-model.mjs refillPlan)을 표에 적용: AI 줄만 지우고, 새 줄을 넣는다.
export async function applyRefillPlan(c, plan) {
  if (plan.remove.length) {
    const gone = await c.rt.api(`${TABLE}?id=in.(${plan.remove.map(enc).join(',')})&${scope(c)}&source=eq.ai&select=id`, {method: 'DELETE', prefer: 'return=representation', singleFlight: false});
    if (!Array.isArray(gone)) throw new Error('delete');
  }
  if (plan.add.length) await c.rt.api(`${TABLE}?select=id`, {method: 'POST', body: plan.add.map(a => ({workspace_id: c.workspaceId, organization_id: c.orgId, day: a.day, ...(a.end_day ? {end_day: a.end_day} : {}), body: a.body, sort_order: a.sort_order, source: 'ai', evidence: a.evidence})), prefer: 'return=representation', singleFlight: false});
}

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
  const d = ui.draft || {}, body = cleanBody(d.body), day = d.day, id = ui.editing, end_day = d.end_day || null;
  if (!validDay(day)) { ui.invalid = 'day'; ui.msg = {text: TEXT.noDay, error: true}; paint(); return; }
  if (!validEnd(day, end_day)) { ui.invalid = 'end_day'; ui.msg = {text: TEXT.badEnd, error: true}; paint(); return; }
  if (!body) { ui.invalid = 'body'; ui.msg = {text: TEXT.noBody, error: true}; paint(); return; }
  const c = ctxOf();
  if (id === 'new') {
    if (ui.rows.length >= ROWS_MAX) { ui.msg = {text: TEXT.full, error: true}; paint(); return; }
    const prev = ui.rows;
    await write(() => createStatusRow(c, prev, {day, end_day, body}), '줄을 넣었어요.', '[data-st-add]');
    return;
  }
  // 고친 줄은 내 줄(source=user)이 된다 — 다시 채우기가 덮어쓰지 않는다.
  await write(() => patchStatusRow(c, id, {day, end_day, body, source: 'user', updated_at: new Date().toISOString()}), '저장했어요.', `[data-st-edit="${id}"]`);
}
async function removeRow(id) {
  const c = ctxOf();
  await write(() => deleteStatusRow(c, id), '줄을 뺐어요.', '[data-st-add]');
}
// [기록에서 다시 채우기 (AI)] — 서버는 줄 후보만 돌려주고, 표에 넣는 것은 여기(내 로그인, owner RLS).
async function refill(first) {
  if (!ui || ui.busy || !ui.canEdit) return;
  const me = ui, run = ui.run, c = ctxOf();
  me.busy = true; say(TEXT.aiRun); paint();
  const r = await fetchAiRows(c);
  if (ui !== me || ui.run !== run) return;
  me.busy = false;
  if (!r.ok) { me.msg = {text: first ? '' : TEXT.aiFail, error: !first}; paint(); return; }
  const plan = refillPlan(me.rows, r.rows);
  if (!plan.add.length && !plan.remove.length) { me.msg = {text: first ? '' : TEXT.aiNone, error: false}; paint(); return; }
  await write(() => applyRefillPlan(c, plan), plan.add.length ? `기록에서 ${plan.add.length}줄을 채웠어요.` : TEXT.aiNone, '[data-st-refill]');
}
