// DESK-전체현황표(요청함 11/03 07:48): 담당조직 화면 맨 위 작은 소탭 [목록 | 전체 표]. [전체 표] = 내 담당조직 전부를 묶음별 표 하나로
// (주간보고 '3. 2) 투쟁 사업장 현황'과 같은 모양): 조직 | 쟁의 단계 | 최근 주요 일정·현황(날짜·한 줄, 최신 순 3줄까지).
// - 내용은 각 조직 [현황 표] 줄을 그대로 읽고 쓴다 — 새 저장 자리 없음. 줄 쓰기·AI 채우기는 org-status-table.js의 같은 함수를 쓴다
//   (한 곳을 고치면 조직 상세 [현황 표]·주간보고 투쟁 사업장 칸에 같이 보임). 쟁의 단계는 org-dispute-stage.js 읽기만 한다.
// - 순서·묶음은 담당조직 목록과 같다(organization-order.js). 조직 이름을 누르면 [목록]으로 돌아가 그 조직 상세를 연다.
// - 폰은 표 대신 조직마다 한 덩이(CSS), 폴드 펼침·PC는 표. 칸 폭(조직·쟁의 단계)은 끌어 바꾸고 서버에 기억한다(view_prefs.col_widths.orgall).
// - 고른 소탭([목록|전체 표])은 이번 접속만 기억한다: 서버에 기억하려면 view_prefs 검사에 새 칸이 필요해(DB 변경) 이 PR에서는 하지 않았다(PR 본문 '남은 일').
// - 브라우저 저장소에 아무것도 두지 않는다.
import {readStatusRows, patchStatusRow, deleteStatusRow, createStatusRow, fetchAiRows, applyRefillPlan, editFormHtml, fitTextarea} from './org-status-table.js';
import {overviewRows, dayLabel, cleanBody, validDay, refillPlan, sortRows, ROWS_MAX} from './org-status-model.mjs';
import {loadDisputeState, peekDisputeState} from './org-dispute-stage.js';
import {stageOfOrg, stageLabel} from './org-dispute-stage-model.mjs';
import {mountColResize, gripHtml} from './col-resize.js';
import {seoulDateKey} from './meeting-time.js';
import {waitHtml, emptyHtml} from './wait-state.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const TEXT = {
  missing: '현황 표는 준비 중이에요.', failed: '전체 표를 불러오지 못했어요.', saveFailed: '저장하지 못했어요. 다시 눌러 주세요.',
  noBody: '내용을 적어 주세요.', noDay: '날짜를 골라 주세요.', full: `줄은 ${ROWS_MAX}개까지예요.`,
  aiNone: '기록에서 뽑을 새 줄이 없었어요.', aiFail: 'AI로 채우지 못했어요. 잠시 뒤 다시 눌러 주세요.', copied: '복사했어요.', copyFail: '복사하지 못했어요.',
};
let st = null; // {section, tabs, panel, orgs, workspaceId, rt, view, status, rows: Map(orgId → 줄들), editing:{orgId,id}|null, draft, invalid, busy, msg:{text,error}, run}

// suborganizations.js가 목록을 다시 그릴 때마다 부른다(같은 목록이면 다시 읽지 않는다).
export function syncOverview({orgs, workspaceId, rt}) {
  const section = document.querySelector('#soTeamSection');
  if (!section) return;
  if (!st || st.section !== section) {
    st = {section, orgs: [], workspaceId, rt, view: 'list', status: 'idle', rows: new Map(), editing: null, draft: null, invalid: '', busy: false, msg: {text: '', error: false}, run: 0};
    install();
  }
  const same = st.orgs.length === orgs.length && st.orgs.every((o, i) => o.id === orgs[i].id);
  st.orgs = orgs; st.workspaceId = workspaceId; st.rt = rt;
  section.classList.toggle('so-has-tabs', orgs.length > 0);
  if (st.tabs) st.tabs.hidden = !orgs.length;
  if (st.view === 'table' && (!same || st.status === 'idle')) void load();
}

function install() {
  const {section} = st;
  if (!section.querySelector('#soTeamTabs')) {
    section.querySelector('#soTeamHead')?.insertAdjacentHTML('afterend',
      '<div id="soTeamTabs" class="so-team-tabs" role="tablist" aria-label="담당조직 보기"><button type="button" role="tab" class="so-team-tab" data-so-view="list" aria-selected="true" tabindex="0">목록</button><button type="button" role="tab" class="so-team-tab" data-so-view="table" aria-selected="false" tabindex="-1">전체 표</button></div>');
  }
  if (!section.querySelector('#soOverview')) section.insertAdjacentHTML('beforeend', '<section id="soOverview" class="oa wd-st" aria-label="담당조직 전체 표" hidden></section>');
  st.tabs = section.querySelector('#soTeamTabs');
  st.panel = section.querySelector('#soOverview');
  st.tabs.addEventListener('click', e => { const b = e.target.closest?.('[data-so-view]'); if (b) setView(b.dataset.soView, {focus: false}); });
  st.tabs.addEventListener('keydown', e => {
    const b = e.target.closest?.('[data-so-view]'); if (!b) return;
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') next = b.dataset.soView === 'list' ? 'table' : 'list';
    else if (e.key === 'Home') next = 'list'; else if (e.key === 'End') next = 'table';
    if (!next) return;
    e.preventDefault(); setView(next, {focus: true});
  });
  bind(st.panel);
  window.addEventListener('kptu:org-status-changed', e => { if (st && st.view === 'table' && !st.busy && st.status === 'ready' && !st.editing && e.detail?.source !== 'overview') void load(true); });
  window.addEventListener('kptu:dispute-stages-changed', () => { if (st?.view === 'table') paint(); });
}

function setView(view, {focus = false} = {}) {
  if (!st) return;
  st.view = view === 'table' ? 'table' : 'list';
  const table = st.view === 'table';
  st.section.classList.toggle('so-view-table', table);
  st.panel.hidden = !table;
  st.tabs.querySelectorAll('[data-so-view]').forEach(b => { const on = b.dataset.soView === st.view; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus({preventScroll: true}); });
  if (table) void load();
}

async function load(quiet = false) {
  if (!st) return;
  const me = st, run = ++st.run;
  if (!quiet || st.status !== 'ready') { st.status = 'loading'; paint(); }
  try {
    const [r] = await Promise.all([
      readStatusRows({rt: st.rt, workspaceId: st.workspaceId, orgIds: st.orgs.map(o => o.id)}),
      loadDisputeState({rt: st.rt, workspaceId: st.workspaceId}).catch(() => null),
    ]);
    if (st !== me || st.run !== run) return;
    st.status = r.missing ? 'missing' : 'ready';
    st.rows = new Map([...r.rows].map(([id, rows]) => [id, sortRows(rows)]));
  } catch { if (st !== me || st.run !== run) return; st.status = 'error'; }
  paint();
}

function stageText(orgId) {
  const state = peekDisputeState();
  if (!state || state.status !== 'ready') return '';
  const cur = stageOfOrg(orgId, state.histories, state.stages);
  return stageLabel(cur) || '';
}
function groupsOf() {
  const order = window.KPTUOrganizationOrder;
  return order ? order.groups(st.orgs).map(g => ({name: order.groupName(g[0]), orgs: g})) : [{name: '', orgs: st.orgs}];
}
function lineHtml(orgId, r) {
  const label = esc(cleanBody(r.body));
  if (st.editing && st.editing.orgId === orgId && st.editing.id === r.id) {
    return `<div class="oa-edit" data-oa-edit-row="${esc(orgId)}">${editFormHtml({key: r.id, draft: st.draft || {}, invalid: st.invalid, busy: st.busy, canDelete: true, deleteId: r.id})}</div>`;
  }
  const dis = st.busy || !!st.editing;
  return `<div class="oa-line"><span class="oa-day">${esc(dayLabel(r.day) || '—')}</span><span class="oa-text${dis ? '' : ' is-edit'}"${dis ? '' : ` role="button" tabindex="0" data-oa-edit="${esc(r.id)}" data-oa-org="${esc(orgId)}" aria-label="${label} 고치기"`}>${label}</span>${r.source === 'ai' ? '<span class="wd-st-tag" title="AI가 기록에서 뽑은 줄 — 고치면 내 줄이 돼요">AI</span>' : ''}</div>`;
}
function cellHtml(o) {
  const rows = st.rows.get(o.id) || [], shown = overviewRows(rows, 3), dis = st.busy || !!st.editing;
  const adding = st.editing && st.editing.orgId === o.id && st.editing.id === 'new';
  let html = shown.map(r => lineHtml(o.id, r)).join('');
  if (adding) html += `<div class="oa-edit" data-oa-edit-row="${esc(o.id)}">${editFormHtml({key: 'new', draft: st.draft || {}, invalid: st.invalid, busy: st.busy})}</div>`;
  if (!rows.length && !adding) html += `<span class="oa-empty" data-oa-empty>비어 있음</span><button type="button" class="wd-st-btn" data-oa-fill="${esc(o.id)}"${dis ? ' disabled' : ''}>AI로 채우기</button>`;
  else if (rows.length > shown.length) html += `<span class="oa-more">외 ${rows.length - shown.length}줄 — 조직 상세에서</span>`;
  if (!adding) html += `<button type="button" class="wd-st-btn oa-add" data-oa-add="${esc(o.id)}"${dis || rows.length >= ROWS_MAX ? ' disabled' : ''} aria-label="${esc(o.name)} 줄 추가">+ 줄</button>`;
  return html;
}
function paint() {
  if (!st || !st.panel) return;
  const {panel, status} = st;
  if (status === 'loading' && !st.rows.size) { panel.innerHTML = waitHtml({rows: 4}); return; }
  if (status === 'missing') { panel.innerHTML = `<p class="wd-st-note" data-oa-missing>${TEXT.missing}</p>`; return; }
  if (status === 'error') { panel.innerHTML = `<p class="wd-st-note" role="alert">${TEXT.failed} <button type="button" class="wd-st-btn" data-oa-retry>다시 시도</button></p>`; return; }
  if (!st.orgs.length) { panel.innerHTML = emptyHtml(); return; }
  const dis = st.busy || !!st.editing;
  const bar = `<div class="oa-bar"><button type="button" class="wd-st-btn" data-oa-refill-all${dis ? ' disabled' : ''}>모두 다시 채우기 (AI)</button><button type="button" class="wd-st-btn" data-oa-copy>복사</button></div>`;
  const head = `<thead><tr><th scope="col" class="oa-c-org">조직${gripHtml('org', '조직', 1)}</th><th scope="col" class="oa-c-stage">쟁의 단계${gripHtml('stage', '쟁의 단계', 1)}</th><th scope="col">최근 주요 일정·현황</th></tr></thead>`;
  const groups = groupsOf().map(g => `<section class="oa-group" data-oa-group><h3 class="oa-group-h">${esc(g.name)}<small>${g.orgs.length}곳</small></h3><table class="oa-table">${head}<tbody>${g.orgs.map(o => `<tr data-oa-org-row="${esc(o.id)}"><th scope="row" class="oa-c-org"><button type="button" class="oa-name" data-oa-open="${esc(o.id)}">${esc(o.name)}</button></th><td class="oa-c-stage" data-label="쟁의 단계">${esc(stageText(o.id)) || '<span class="oa-none">—</span>'}</td><td class="oa-c-rows">${cellHtml(o)}</td></tr>`).join('')}</tbody></table></section>`).join('');
  panel.innerHTML = `${bar}${groups}<p class="wd-st-status${st.msg.error ? ' is-error' : ''}" role="status" aria-live="polite" data-oa-status>${esc(st.msg.text)}</p>`;
  mountColResize({host: panel, name: 'orgall', vars: {org: '--oa-w-org', stage: '--oa-w-stage'}, dir: 1, labels: {org: '조직', stage: '쟁의 단계'},
    fit: key => Math.ceil(Math.max(0, ...[...panel.querySelectorAll(key === 'org' ? '.oa-name' : 'td.oa-c-stage')].map(el => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().width; })))});
  panel.querySelectorAll('textarea[data-st-field]').forEach(fitTextarea);
  if (st.focus) {
    const el = panel.querySelector(st.focus);
    el?.focus({preventScroll: true});
    if (el?.matches('textarea,input')) panel.querySelector('[data-oa-edit-row]')?.scrollIntoView({block: 'nearest'});
    st.focus = '';
  }
}
function say(text, error = false) { if (!st) return; st.msg = {text, error}; const el = st.panel.querySelector('[data-oa-status]'); if (el) { el.textContent = text; el.classList.toggle('is-error', error); } }
const ctxFor = orgId => ({rt: st.rt, workspaceId: st.workspaceId, orgId});
const announce = orgId => window.dispatchEvent(new CustomEvent('kptu:org-status-changed', {detail: {organization_id: orgId, source: 'overview'}}));
async function reread(orgIds) {
  try {
    const r = await readStatusRows({rt: st.rt, workspaceId: st.workspaceId, orgIds});
    if (!r.missing) for (const [id, rows] of r.rows) st.rows.set(id, sortRows(rows));
  } catch { /* 다음에 다시 읽음 */ }
}

function bind(panel) {
  panel.addEventListener('input', e => { const t = e.target; if (!st || !t.matches?.('[data-st-field]')) return; if (t.tagName === 'TEXTAREA') fitTextarea(t); st.draft = {...(st.draft || {}), [t.dataset.stField]: t.value}; if (st.invalid === t.dataset.stField) { st.invalid = ''; t.removeAttribute('aria-invalid'); } });
  panel.addEventListener('change', e => { const t = e.target; if (st && t.matches?.('[data-st-field]')) st.draft = {...(st.draft || {}), [t.dataset.stField]: t.value}; });
  panel.addEventListener('keydown', e => {
    if (!st) return;
    const sp = e.target.closest?.('[data-oa-edit]');
    if (sp && e.target === sp && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); sp.click(); return; }
    if (e.key === 'Enter' && !e.isComposing && !e.shiftKey && e.target.matches?.('[data-st-field]')) { e.preventDefault(); void save(); }
    else if (e.key === 'Escape' && st.editing) { e.preventDefault(); cancel(); }
  });
  panel.addEventListener('click', e => {
    const b = e.target.closest?.('button,[data-oa-edit]'); if (!b || !st || b.disabled) return;
    const d = b.dataset;
    if ('oaRetry' in d) void load();
    else if (d.oaOpen) openOrg(d.oaOpen);
    else if (d.oaEdit) { const org = d.oaOrg, r = (st.rows.get(org) || []).find(x => x.id === d.oaEdit); if (!r) return; st.editing = {orgId: org, id: r.id}; st.draft = {day: r.day, body: r.body}; st.invalid = ''; st.focus = '[data-st-field="body"]'; say(''); paint(); }
    else if (d.oaAdd) { st.editing = {orgId: d.oaAdd, id: 'new'}; st.draft = {day: seoulDateKey(Date.now()), body: ''}; st.invalid = ''; st.focus = '[data-st-field="body"]'; say(''); paint(); }
    else if ('stCancel' in d) cancel();
    else if ('stSave' in d) void save();
    else if (d.stDelete) void remove(d.stDelete);
    else if (d.oaFill) void fill([d.oaFill]);
    else if ('oaRefillAll' in d) void fill(st.orgs.map(o => o.id));
    else if ('oaCopy' in d) void copy();
  });
}
function openOrg(orgId) {
  setView('list');
  const row = st.section.querySelector(`#soOrganizationList [data-so-org="${CSS.escape(orgId)}"]`);
  row?.click();
}
function cancel() { const e = st.editing; st.editing = null; st.draft = null; st.invalid = ''; st.focus = e ? (e.id === 'new' ? `[data-oa-add="${e.orgId}"]` : `[data-oa-edit="${e.id}"]`) : ''; paint(); }

async function run(work, done) {
  if (!st || st.busy) return false;
  const me = st, orgId = st.editing?.orgId;
  me.busy = true; say('저장하는 중…'); paint();
  let ok = true;
  try { await work(); } catch (e) { ok = false; console.warn('org overview write failed', e?.message || e); }
  if (orgId) await reread([orgId]);
  if (st !== me) return ok;
  me.busy = false;
  if (ok) { me.editing = null; me.draft = null; me.invalid = ''; }
  me.msg = {text: ok ? done : TEXT.saveFailed, error: !ok};
  paint();
  if (ok && orgId) announce(orgId);
  return ok;
}
async function save() {
  if (!st?.editing || st.busy) return;
  const {orgId, id} = st.editing, d = st.draft || {}, body = cleanBody(d.body), day = d.day;
  if (!validDay(day)) { st.invalid = 'day'; st.msg = {text: TEXT.noDay, error: true}; st.focus = '[data-st-field="day"]'; paint(); return; }
  if (!body) { st.invalid = 'body'; st.msg = {text: TEXT.noBody, error: true}; st.focus = '[data-st-field="body"]'; paint(); return; }
  const c = ctxFor(orgId);
  if (id === 'new') {
    const prev = st.rows.get(orgId) || [];
    if (prev.length >= ROWS_MAX) { st.msg = {text: TEXT.full, error: true}; paint(); return; }
    await run(() => createStatusRow(c, prev, {day, body}), '줄을 넣었어요.');
    return;
  }
  await run(() => patchStatusRow(c, id, {day, body, source: 'user', updated_at: new Date().toISOString()}), '저장했어요.');
}
async function remove(id) {
  if (!st?.editing) return;
  const c = ctxFor(st.editing.orgId);
  await run(() => deleteStatusRow(c, id), '줄을 뺐어요.');
}
// [AI로 채우기](한 조직) · [모두 다시 채우기 (AI)](전체). 사람이 넣거나 고친 줄은 덮지 않고, 같은 일의 줄은 더하지 않는다(refillPlan). AI 하루 한도에 걸리면 거기서 멈춘다.
async function fill(orgIds) {
  if (!st || st.busy || st.editing) return;
  const me = st;
  me.busy = true; say('AI가 기록에서 주요 일정을 뽑는 중…'); paint();
  let added = 0, failed = false, touched = [];
  for (const orgId of orgIds) {
    const c = ctxFor(orgId), r = await fetchAiRows(c);
    if (st !== me) return;
    if (!r.ok) { failed = true; break; }
    const plan = refillPlan(me.rows.get(orgId) || [], r.rows);
    if (!plan.add.length && !plan.remove.length) continue;
    try { await applyRefillPlan(c, plan); added += plan.add.length; touched.push(orgId); } catch (e) { console.warn('org overview fill failed', e?.message || e); failed = true; break; }
    if (orgIds.length > 1) await reread([orgId]);
  }
  await reread(touched.length ? touched : []);
  if (st !== me) return;
  me.busy = false;
  me.msg = failed ? {text: TEXT.aiFail, error: true} : {text: added ? `기록에서 ${added}줄을 채웠어요.` : TEXT.aiNone, error: false};
  paint();
  for (const id of touched) announce(id);
}
async function copy() {
  const lines = [];
  for (const g of groupsOf()) {
    if (g.name) lines.push(`[${g.name}]`);
    for (const o of g.orgs) {
      const stage = stageText(o.id);
      lines.push(`○ ${o.name}${stage ? ` (${stage})` : ''}`);
      for (const r of overviewRows(st.rows.get(o.id) || [], 3)) lines.push(`- ${dayLabel(r.day)} ${cleanBody(r.body)}`);
    }
  }
  try { await navigator.clipboard.writeText(lines.join('\n')); say(TEXT.copied); } catch { say(TEXT.copyFail, true); }
}
