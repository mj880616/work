// AI-서버연동 S7-b: [원장] 화면(?view=ledger, 사이드바·메뉴 판 [원장]). 이 모듈이 #ledgerRoot의 유일한 renderer다.
// 흐름: 파일 올리기(시트 탭별 CSV / xlsx 한 개 / Claude 가져오기 파일) → 브라우저 안 검사(ledger-import-model.mjs) →
// 고정 목록 대응표 확인 → [해 보기](DB에 남지 않음) → [적용](묶음 하나, 한 거래) → 숫자 확인 → [확인] 또는 [되돌리기].
// 파일 원문은 서버로 보내지 않고 로그에도 남기지 않는다. DB에는 검사를 통과한 행만 app_import_ledger_apply RPC로 보낸다.
// 원장 표(20261021082000)가 없으면 "원장 표 준비 전", 가져오기 함수(20261021150000)가 없으면 "가져오기 기능 준비 전"만 보인다.
// 원장 후보 확정(#ledgerCandidatesRoot, ledger-candidates.js)과 목록·검색(#ledgerBrowseRoot, ledger-browse.js)은 S7-c 모듈이,
// 맨 위 Claude용 사본 상태 한 줄(#ledgerExportRoot, ledger-export.js)은 그 모듈이 각자 그린다(LEDGER-자동기록: 내보내기 버튼 없음).
import {readInputFiles, analyze, numberCheck, TABS} from './ledger-import-model.mjs';
import {candidateFilePayload} from './ledger-candidate-model.mjs';
import {KIND_DISPLAY, KIND_HINT, KINDS} from './ledger-browse-model.mjs';

const rt = window.KPTURuntime;
const ZERO = '00000000-0000-0000-0000-000000000000';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const q = v => encodeURIComponent(v);
const STATUS_LABEL = {applied: '적용(확인 전)', confirmed: '확인', reverted: '되돌림'};
const ERRORS = [
  [/LEDGER_IMPORT_DUPLICATE_FILE/, '이미 가져온 파일입니다(같은 파일 지문). 되돌린 묶음의 파일만 다시 넣을 수 있습니다.'],
  [/LEDGER_IMPORT_EXISTING_ID:?\s*(.*)/, '이미 원장에 있는 ID가 있어 묶음 전체를 넣지 않았습니다.'],
  [/LEDGER_IMPORT_BROKEN_REF:?\s*(.*)/, '없는 ID를 가리키는 행이 있어 묶음 전체를 넣지 않았습니다.'],
  [/LEDGER_IMPORT_PREFIX_MISMATCH:?\s*(.*)/, '원장 번호표의 접두어와 파일의 접두어가 다릅니다.'],
  [/LEDGER_IMPORT_MODIFIED/, '가져온 뒤 고친 행이 있어 되돌릴 수 없습니다(고친 내용은 감사 기록에 있습니다).'],
  [/LEDGER_IMPORT_REVERT_BLOCKED/, '다른 행(손으로 붙인 연결·후보 등)이 이 묶음의 행을 가리켜 되돌릴 수 없습니다.'],
  [/LEDGER_IMPORT_NOT_OPEN/, '확인 전(적용) 묶음만 확인·되돌리기를 할 수 있습니다.'],
  [/LEDGER_IMPORT_CANDIDATES_LATER/, '후보 묶음은 [후보로 넣기]로 넣고 원장 후보 칸에서 확정합니다.'],
  [/LEDGER_QUEUE_BROKEN_REF:?\s*(.*)/, '원장에 없는 대상 기록을 가리키는 후보가 있어 묶음 전체를 넣지 않았습니다.'],
  [/LEDGER_QUEUE_BAD_CANDIDATE|LEDGER_QUEUE_BAD_FILE/, '후보 파일의 모양이 맞지 않아 넣지 않았습니다.'],
  [/LEDGER_QUEUE_NOT_OWNER/, '이 작업공간의 소유자만 후보를 넣을 수 있습니다.'],
  [/LEDGER_IMPORT_NOT_OWNER|42501|permission denied/i, '이 작업공간의 소유자만 가져올 수 있습니다.']
];

let state = freshState();
let bound = false;
function freshState() {
  return {phase: 'loading', ctx: null, imports: [], input: null, result: null, overrides: {}, label: '', mappingOk: false, mappingOpen: null,
    dry: null, dryKey: '', busy: '', message: '', error: '', check: null, readError: '', queueReady: false, cand: null, candDry: null, candDryKey: ''};
}
const workspaceId = () => rt?.context?.read?.()?.workspace?.id || null;

function installView() {
  if (document.querySelector('#ledgerView')) return;
  document.querySelector('#appView')?.insertAdjacentHTML('beforeend', `<section id="ledgerView" class="view-panel hidden" aria-labelledby="ledgerTitle"><div class="section-head"><div><h2 id="ledgerTitle">원장</h2><p>업무 원장(${KINDS.map(k => KIND_DISPLAY[k]).join('·')}·출처·조직)을 Web2로 옮기고 확인하는 화면입니다.</p></div></div><div class="lg-root"><div id="ledgerExportRoot" class="lg-root" hidden></div><div id="ledgerRoot" class="lg-root"></div><div id="ledgerCandidatesRoot" class="lg-root" hidden></div><div id="ledgerBrowseRoot" class="lg-root" hidden></div></div></section>`);
}

function friendly(error) {
  const text = String(error?.message || error || '');
  for (const [re, label] of ERRORS) {
    const m = text.match(re);
    if (m) return m[1] ? `${label} (${m[1].slice(0, 300)})` : label;
  }
  if (error?.status === 0 || /timeout|network|fetch/i.test(text)) return '연결이 끊겨 결과를 확인하지 못했습니다. [가져온 묶음]에서 상태를 확인한 뒤 다시 시도하세요.';
  return `DB가 거절했습니다: ${text.slice(0, 300)}`;
}

// 표가 있는지(없으면 PostgREST 404) → 가져오기 함수가 있는지(읽기 전용 counts 호출, 없으면 404).
async function probe() {
  try { await rt.api(`/rest/v1/app_ledger_imports?select=id&limit=1`, {singleFlight: false}); }
  catch (e) { return e?.status === 404 ? 'not-ready' : 'error'; }
  try { await rt.api('/rest/v1/rpc/app_import_ledger_counts', {method: 'POST', body: {p_import_id: ZERO}, singleFlight: false}); }
  catch (e) { return e?.status === 404 ? 'no-functions' : 'error'; }
  return 'ready';
}
// S7-c 후보 묶음 넣기 함수(20261021190000)가 있는지: 남의(없는) 작업공간으로 부르면 넣기 전에 소유자 아님으로 거절된다.
async function probeQueue() {
  try { await rt.api('/rest/v1/rpc/app_queue_ledger_candidates', {method: 'POST', body: {p_workspace_id: ZERO, p_file: {}, p_dry_run: true}, singleFlight: false}); return true; }
  catch (e) { return e?.status !== 404 && /LEDGER_QUEUE_NOT_OWNER/.test(String(e?.message || '')); }
}
async function fetchAll(path) {
  const rows = [];
  for (let offset = 0; offset < 200000; offset += 1000) {
    const page = await rt.api(`${path}&limit=1000&offset=${offset}`, {singleFlight: false});
    rows.push(...(page || []));
    if (!page || page.length < 1000) break;
  }
  return rows;
}
// 검사기에 줄 DB 상태: 번호표 접두어, 이미 있는 ID(중복 거부·참조 확인), 주제 목록(대응표), 담당조직(Web2 연결 확인).
async function loadContext() {
  const ws = q(workspaceId());
  const [counters, records, sources, orgs, topics, legacy, subs, imports] = await Promise.all([
    fetchAll(`/rest/v1/app_ledger_id_counters?workspace_id=eq.${ws}&select=scope,prefix&order=scope.asc`),
    fetchAll(`/rest/v1/app_ledger_records?workspace_id=eq.${ws}&select=ledger_id&order=ledger_id.asc`),
    fetchAll(`/rest/v1/app_ledger_sources?workspace_id=eq.${ws}&select=ledger_id&order=ledger_id.asc`),
    fetchAll(`/rest/v1/app_ledger_organizations?workspace_id=eq.${ws}&select=ledger_id,suborganization_id&order=ledger_id.asc`),
    fetchAll(`/rest/v1/app_ledger_topics?workspace_id=eq.${ws}&select=ledger_id,name,aliases&order=ledger_id.asc`),
    fetchAll(`/rest/v1/app_ledger_audit?workspace_id=eq.${ws}&event=eq.legacy_write_request&select=legacy_id&order=legacy_id.asc`),
    fetchAll(`/rest/v1/app_suborganizations?workspace_id=eq.${ws}&select=id&order=id.asc`),
    rt.api(`/rest/v1/app_ledger_imports?workspace_id=eq.${ws}&select=id,label,status,source_kind,created_at,decided_at,row_counts&order=created_at.desc&limit=20`, {singleFlight: false})
  ]);
  state.ctx = {
    prefixes: Object.fromEntries(counters.map(c => [c.scope, c.prefix])),
    existing: {records: new Set(records.map(r => r.ledger_id)), sources: new Set(sources.map(r => r.ledger_id)),
      organizations: new Set(orgs.map(r => r.ledger_id)), topics: new Set(topics.map(r => r.ledger_id)), legacy: new Set(legacy.map(r => r.legacy_id))},
    topics, suborganizations: new Set(subs.map(s => s.id)), linkedSuborganizations: new Set(orgs.map(o => o.suborganization_id).filter(Boolean))
  };
  state.imports = imports || [];
}

let loading = null;
function load() {
  if (!workspaceId()) return Promise.resolve();
  loading ||= loadOnce().finally(() => { loading = null; });
  return loading;
}
async function loadOnce() {
  if (state.phase !== 'ready') { state.phase = 'loading'; render(); }
  const status = await probe();
  if (status !== 'ready') { state.phase = status; render(); return; }
  try { await loadContext(); state.phase = 'ready'; state.queueReady = await probeQueue(); }
  catch { state.phase = 'error'; }
  if (state.input) reanalyze();
  render();
}

// 다시 검사한다. 넣을 행이 달라졌을 때만 해 보기 결과를 버린다(묶음 이름만 바꾼 것은 그대로).
function reanalyze() {
  if (!state.input) { state.result = null; state.dry = null; state.dryKey = ''; return; }
  state.result = analyze(state.input, state.ctx || {}, state.overrides, state.label);
  if (payloadKey() !== state.dryKey) { state.dry = null; state.dryKey = ''; }
  // S7-c: Claude 후보 파일은 검사한 후보만(S3·개인정보 모양 제외) 묶음으로 만든다.
  state.cand = state.result.kind === 'candidates' ? candidateFilePayload(state.input.data, state.input.sha256) : null;
  if (state.cand?.payload) state.cand.payload.label = state.label.trim().slice(0, 80) || state.cand.payload.label;
  if (candKey() !== state.candDryKey) { state.candDry = null; state.candDryKey = ''; }
}
const candKey = () => state.cand?.payload ? JSON.stringify(state.cand.payload) : '';
const candOk = () => state.phase === 'ready' && state.queueReady && !state.busy && !!state.cand?.payload && !state.cand.invalid.length && !!state.cand.payload.label;
async function callQueue(dry) {
  return rt.api('/rest/v1/rpc/app_queue_ledger_candidates', {method: 'POST', body: {p_workspace_id: workspaceId(), p_file: state.cand.payload, p_dry_run: dry}, singleFlight: false, timeoutMs: 120000});
}
async function candDryRun() {
  if (!candOk()) return;
  state.busy = 'cand-dry'; state.error = ''; state.message = ''; render();
  try { state.candDry = await callQueue(true); state.candDryKey = candKey(); state.message = '해 보기를 마쳤습니다. DB에는 아무것도 남지 않았습니다.'; }
  catch (e) { state.candDry = null; state.candDryKey = ''; state.error = friendly(e); }
  state.busy = ''; render();
}
async function candApply() {
  if (!candOk() || !state.candDry || state.candDryKey !== candKey()) return;
  if (!window.confirm('검사한 후보를 원장 후보(대기)로 넣을까요? 원장에는 아래 원장 후보 칸에서 [확정]한 것만 들어갑니다.')) return;
  state.busy = 'cand-apply'; state.error = ''; state.message = ''; render();
  try {
    const done = await callQueue(false);
    state.message = `후보 ${done?.added ?? 0}건을 넣었습니다${done?.skipped ? `(이미 대기 중인 같은 후보 ${done.skipped}건은 건너뜀)` : ''}. 원장 후보 칸에서 확정하세요.`;
    state.input = null; state.result = null; state.cand = null; state.candDry = null; state.candDryKey = ''; state.label = '';
    const file = document.querySelector('#lgFile'); if (file) file.value = '';
    await loadContext().catch(() => {});
    try { window.dispatchEvent(new CustomEvent('kptu:ledger-changed', {detail: {from: 'import'}})); } catch {}
  } catch (e) { state.error = friendly(e); }
  state.busy = ''; render();
}
const payloadKey = () => state.result?.payload ? JSON.stringify({...state.result.payload, label: ''}) : '';
const needsMappingCheck = () => !!state.result && Object.keys(state.result.mapping || {}).length > 0;
const canDry = () => state.phase === 'ready' && !state.busy && state.result?.ok;
const canApply = () => canDry() && !!state.dry && state.dryKey === payloadKey() && (!needsMappingCheck() || state.mappingOk);

async function onFiles(list) {
  const files = [...(list || [])];
  state.input = null; state.result = null; state.overrides = {}; state.mappingOk = false; state.mappingOpen = null; state.readError = ''; state.message = ''; state.error = ''; state.check = null;
  if (!files.length) { render(); return; }
  state.busy = 'read'; render();
  try {
    const read = [];
    for (const f of files) read.push({name: f.name, bytes: new Uint8Array(await f.arrayBuffer())});
    state.input = await readInputFiles(read);
    if (!state.label) state.label = defaultLabel(state.input);
    reanalyze();
  } catch (e) { state.readError = e?.message || '파일을 읽지 못했습니다.'; }
  state.busy = '';
  render();
}
function defaultLabel(input) {
  const day = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Seoul'}).format(new Date());
  if (input.type === 'json' && typeof input.data?.label === 'string' && input.data.label.trim()) return input.data.label.trim().slice(0, 80);
  return `${input.type === 'json' ? '가져오기 파일' : '시트 가져오기'} ${day}`;
}

async function callApply(dry) {
  const payload = state.result.payload;
  return rt.api('/rest/v1/rpc/app_import_ledger_apply', {method: 'POST', body: {p_workspace_id: workspaceId(), p_file: payload, p_dry_run: dry}, singleFlight: false, timeoutMs: 120000});
}
async function dryRun() {
  if (!canDry()) return;
  state.busy = 'dry'; state.error = ''; state.message = ''; render();
  try { state.dry = await callApply(true); state.dryKey = payloadKey(); state.message = '해 보기를 마쳤습니다. DB에는 아무것도 남지 않았습니다.'; }
  catch (e) { state.dry = null; state.dryKey = ''; state.error = friendly(e); }
  state.busy = ''; render();
}
async function applyNow() {
  if (!canApply()) return;
  if (!window.confirm('검사를 통과한 행을 원장에 넣을까요? 확인 전까지는 [되돌리기]로 이 묶음을 지울 수 있습니다.')) return;
  state.busy = 'apply'; state.error = ''; state.message = ''; render();
  try {
    const done = await callApply(false);
    state.check = done;
    state.message = '적용했습니다. 아래 숫자 확인에서 시트 행 수와 들어간 수를 맞춰 보세요.';
    state.input = null; state.result = null; state.dry = null; state.dryKey = ''; state.overrides = {}; state.mappingOk = false; state.label = '';
    const file = document.querySelector('#lgFile'); if (file) file.value = '';
    await loadContext().catch(() => {});
  } catch (e) { state.error = friendly(e); }
  state.busy = ''; render();
}
async function showCheck(id) {
  state.busy = 'check'; state.error = ''; render();
  try { state.check = await rt.api('/rest/v1/rpc/app_import_ledger_counts', {method: 'POST', body: {p_import_id: id}, singleFlight: false}); }
  catch (e) { state.error = friendly(e); }
  state.busy = ''; render();
  document.querySelector('#lgCheck')?.focus?.();
}
async function decide(id, action) {
  const ask = action === 'confirm' ? '숫자가 맞으면 이 묶음을 확인할까요? 확인한 뒤에는 되돌릴 수 없습니다.'
    : '이 묶음에서 들어온 행을 모두 지울까요? 지운 행은 감사 기록에 남고, 번호는 다시 쓰지 않습니다.';
  if (!window.confirm(ask)) return;
  state.busy = action; state.error = ''; state.message = ''; render();
  try {
    state.check = await rt.api(`/rest/v1/rpc/app_import_ledger_${action}`, {method: 'POST', body: {p_import_id: id}, singleFlight: false, timeoutMs: 120000});
    state.message = action === 'confirm' ? '확인했습니다. 이 묶음은 이제 잠겼습니다.' : '되돌렸습니다. 이 묶음의 행을 모두 지웠습니다.';
    await loadContext().catch(() => {});
    if (state.input) reanalyze();
  } catch (e) { state.error = friendly(e); }
  state.busy = ''; render();
}

// ---------- 그리기 ----------
function render() {
  const root = document.querySelector('#ledgerRoot');
  if (!root) return;
  root.dataset.ledgerState = state.phase;
  if (state.phase !== 'ready') {
    if (state.phase === 'loading') root.innerHTML = `<p class="lg-note" role="status">원장 표를 확인하는 중…</p>`;
    else if (state.phase === 'not-ready') root.innerHTML = `<div class="lg-notice" data-ledger-notice="not-ready"><strong>원장 표 준비 전</strong><p>원장 표가 아직 DB에 없습니다. 표가 적용되면 이 화면에서 시트를 가져올 수 있습니다.</p></div>`;
    else if (state.phase === 'no-functions') root.innerHTML = `<div class="lg-notice" data-ledger-notice="no-functions"><strong>가져오기 기능 준비 전</strong><p>원장 표는 있지만 가져오기 기능이 아직 DB에 없습니다. 기능이 적용되면 이 화면에서 가져올 수 있습니다.</p></div>`;
    else root.innerHTML = `<div class="lg-notice"><strong>원장 상태를 읽지 못했습니다</strong><p>연결을 확인한 뒤 다시 시도하세요.</p><button type="button" class="secondary" data-lg-action="reload">다시 읽기</button></div>`;
    return;
  }
  // 파일 고르기·묶음 이름 칸은 한 번만 만들고(고른 파일·입력 중 글자 유지), 나머지 칸만 다시 그린다.
  if (!root.querySelector('[data-lg-shell]')) root.innerHTML = shellHtml();
  const focus = document.activeElement?.id && root.contains(document.activeElement) ? document.activeElement.id : null;
  const file = root.querySelector('#lgFile'), label = root.querySelector('#lgLabel');
  file.disabled = !!state.busy; label.disabled = !!state.busy;
  if (label.value !== state.label) label.value = state.label;
  const r = state.result;
  root.querySelector('#lgRead').innerHTML = (state.busy === 'read' ? '<p class="lg-note" role="status">파일을 읽는 중…</p>' : '')
    + (state.readError ? `<p class="lg-error" role="alert">${esc(state.readError)}</p>` : '');
  root.querySelector('#lgResult').innerHTML = r ? resultHtml(r) : '';
  root.querySelector('#lgLive').innerHTML = state.message ? `<p class="lg-ok">${esc(state.message)}</p>` : '';
  root.querySelector('#lgError').innerHTML = state.error ? `<p class="lg-error" role="alert" data-lg-error>${esc(state.error)}</p>` : '';
  root.querySelector('#lgCheckBox').innerHTML = state.check ? checkHtml(state.check) : '';
  root.querySelector('#lgImportsBox').innerHTML = importsHtml();
  if (focus && focus !== 'lgFile' && focus !== 'lgLabel') document.getElementById(focus)?.focus?.({preventScroll: true});
}

function shellHtml() {
  return `<div data-lg-shell><section class="lg-card" aria-labelledby="lgImportTitle">
    <h3 id="lgImportTitle">원장 가져오기</h3>
    <ol class="lg-steps"><li>시트를 내려받아 올립니다(xlsx 한 개 또는 탭별 CSV 여러 개, Claude 가져오기 파일).</li><li>검사 결과와 대응표를 확인합니다.</li><li>[해 보기]로 DB에 남기지 않고 개수를 봅니다.</li><li>[적용] 뒤 숫자를 맞춰 보고 [확인]합니다. 이상하면 [되돌리기].</li></ol>
    <p class="lg-note">파일은 이 브라우저 안에서만 읽습니다. 원문은 서버로 보내지 않고, 검사를 통과한 행만 원장에 넣습니다.</p>
    <div class="lg-fields">
      <label class="lg-field"><span>파일</span><input id="lgFile" type="file" accept=".xlsx,.csv,.json,text/csv,application/json" multiple></label>
      <label class="lg-field"><span>묶음 이름</span><input id="lgLabel" class="lg-input" type="text" maxlength="80" placeholder="예: 시트 가져오기 1차"></label>
    </div>
    <div id="lgRead"></div>
    <div id="lgResult"></div>
    <div id="lgLive" class="lg-live" role="status" aria-live="polite"></div>
    <div id="lgError"></div>
  </section>
  <div id="lgCheckBox"></div>
  <div id="lgImportsBox"></div></div>`;
}

function resultHtml(r) {
  if (r.kind === 'candidates') {
    const c = state.cand || {total: 0, kinds: {}, invalid: [], excluded: 0, personal: 0};
    const dry = state.candDry && state.candDryKey === candKey() ? state.candDry : null;
    const kept = Object.values(c.kinds).reduce((a, b) => a + b, 0);
    const busyLabel = {'cand-dry': '해 보는 중…', 'cand-apply': '넣는 중…'}[state.busy];
    return `<div class="lg-result" data-lg-result="candidates"><h4>후보 묶음 <span class="lg-pill ${c.invalid.length ? 'is-bad' : 'is-ok'}" data-lg-verdict="${c.invalid.length ? 'rejected' : 'ok'}">${c.invalid.length ? `거부 ${c.invalid.length}건 — 파일을 고친 뒤 다시 올리세요` : `넣을 후보 ${kept}건`}</span></h4>
      <p>파일의 후보 ${c.total}건(${Object.entries(c.kinds).map(([k, n]) => `${KIND_DISPLAY[k] || k} ${n}`).join(', ') || '없음'})${c.excluded ? `, 민감 S3 ${c.excluded}건` : ''}${c.personal ? `, 개인정보 모양 ${c.personal}건` : ''}${c.excluded || c.personal ? '은 넣지 않음' : ''}.</p>
      ${c.invalid.length ? `<ul class="lg-list lg-issues-error" data-lg-cand-invalid>${c.invalid.slice(0, 10).map(i => `<li>${i.index >= 0 ? `${i.index + 1}번째 후보: ` : ''}${esc(i.reason)}</li>`).join('')}</ul>` : ''}
      ${!state.queueReady ? '<p class="lg-note" data-lg-cand-later>후보 넣기 기능이 아직 DB에 없습니다. 기능이 적용되면 여기서 넣을 수 있습니다.</p>' : `<div class="lg-actions">
        <button type="button" class="secondary" data-lg-action="cand-dry" ${candOk() ? '' : 'disabled'}>해 보기</button>
        <button type="button" class="primary" data-lg-action="cand-apply" ${candOk() && dry ? '' : 'disabled'}>후보로 넣기</button>
        ${busyLabel ? `<span class="lg-note" role="status">${busyLabel}</span>` : ''}</div>
        ${dry ? `<p class="lg-note" data-lg-cand-dry>해 보기 결과(DB에 남지 않음): 넣을 후보 ${dry.added}건${dry.skipped ? `, 이미 대기 중인 같은 후보 ${dry.skipped}건 건너뜀` : ''}.</p>` : '<p class="lg-note">[후보로 넣기]는 [해 보기]를 마친 뒤에 누를 수 있습니다. 원장에는 후보 칸에서 [확정]한 것만 들어갑니다.</p>'}`}
</div>`;
  }
  const tabs = r.tabs;
  return `<div class="lg-result" data-lg-result="sheet">
    <h4>검사 결과 <span class="lg-pill ${r.ok ? 'is-ok' : 'is-bad'}" data-lg-verdict="${r.ok ? 'ok' : r.errorCount ? 'rejected' : 'label'}">${r.ok ? '넣을 수 있음' : r.errorCount ? `거부 ${r.errorCount}건 — 시트를 고친 뒤 다시 올리세요` : '묶음 이름을 적으세요'}</span></h4>
    <div class="lg-table-wrap"><table class="lg-table" data-lg-summary><caption class="lg-sr">탭별 행 수</caption>
      <thead><tr><th scope="col">탭</th><th scope="col">시트 행</th><th scope="col">넣을 행</th><th scope="col">민감 제외</th><th scope="col">거부</th></tr></thead>
      <tbody>${tabs.map(t => `<tr data-lg-tab="${esc(t.key)}"><th scope="row">${esc(t.label)}</th><td>${t.sheetRows}</td><td>${t.importRows}</td><td>${t.excluded}</td><td>${t.rejected}</td></tr>`).join('') || '<tr><td colspan="5">가져올 탭이 없습니다.</td></tr>'}</tbody>
    </table></div>
    ${r.skipped?.length ? `<p class="lg-note">가져오지 않는 탭: ${r.skipped.map(s => `${esc(s.name)}(${esc(s.decision)})`).join(', ')}</p>` : ''}
    ${r.unknownTabs?.length ? `<p class="lg-note">모르는 탭(가져오지 않음): ${r.unknownTabs.map(s => esc(s.name)).join(', ')}</p>` : ''}
    ${columnsHtml(tabs)}
    ${r.idPrefixes && Object.keys(r.idPrefixes).length ? `<p class="lg-note" data-lg-prefixes>번호표 접두어: ${Object.entries(r.idPrefixes).map(([s, p]) => `${esc(TABS[s]?.label || s)} ${esc(p)}${state.ctx?.prefixes?.[s] ? '' : '(새로 등록)'}`).join(' · ')}</p>` : ''}
    ${issuesHtml(r)}
    ${mappingHtml(r)}
    ${actionsHtml(r)}
  </div>`;
}
function columnsHtml(tabs) {
  const rows = tabs.filter(t => t.matched?.length || t.unknown?.length || t.dropped?.length || t.missing?.length);
  if (!rows.length) return '';
  return `<details class="lg-details"><summary>칸 이름 확인</summary><ul class="lg-list">${rows.map(t => `<li><b>${esc(t.label)}</b>: ${t.matched.map(m => esc(m.header)).join(', ') || '없음'}${t.missing.length ? ` · <span class="lg-bad">없는 칸: ${esc(t.missing.join(', '))}</span>` : ''}${t.unknown.length ? ` · 맞는 원장 칸이 없어 비고에 보존: ${esc(t.unknown.join(', '))}` : ''}${t.dropped.length ? ` · 가져오지 않는 칸: ${esc(t.dropped.join(', '))}` : ''}</li>`).join('')}</ul></details>`;
}
function issuesHtml(r) {
  const block = (level, title) => {
    const list = r.summary?.[level] || [];
    if (!list.length) return '';
    return `<div class="lg-issues lg-issues-${level}" data-lg-issues="${level}"><h5>${title}</h5><ul class="lg-list">${list.map(e => `<li data-lg-reason="${esc(e.reason)}"><b>${esc(e.label)}</b> ${e.count}건${e.samples.length ? `<span class="lg-samples">${e.samples.map(esc).join(', ')}${e.count > e.samples.length ? ' …' : ''}</span>` : ''}</li>`).join('')}</ul></div>`;
  };
  return block('error', '거부(하나라도 있으면 묶음 전체를 넣지 않음)') + block('excluded', '민감으로 제외·빠진 연결') + block('warning', '알림');
}
function mappingHtml(r) {
  const fields = Object.entries(r.mapping || {});
  if (!fields.length) return '';
  const ambiguous = fields.reduce((n, [, m]) => n + m.values.filter(v => v.ambiguous).length, 0);
  return `<details class="lg-details lg-mapping" ${(state.mappingOpen ?? ambiguous > 0) ? 'open' : ''} data-lg-mapping><summary>고정 목록 대응표 (${fields.length}칸${ambiguous ? `, 확인 필요 ${ambiguous}개` : ''})</summary>
    <p class="lg-note">시트에 적힌 값을 원장의 고정 값으로 바꿉니다. 규칙으로 고른 초안이며, 애매한 값(⚠)은 기본값으로 두었습니다. 다르면 바꾸세요.</p>
    ${fields.map(([field, m]) => `<div class="lg-map-field"><h5>${esc(m.label)}</h5><div class="lg-table-wrap"><table class="lg-table lg-map-table"><thead><tr><th scope="col">시트 값</th><th scope="col">행</th><th scope="col">원장 값</th></tr></thead><tbody>
      ${m.values.map((v, i) => `<tr><th scope="row">${v.ambiguous ? '<span class="lg-warn" title="확인 필요">⚠</span> ' : ''}${v.raw ? esc(v.raw) : '<span class="lg-muted">(빈칸)</span>'}</th><td>${v.count}</td><td><select class="lg-select" id="lgMap-${esc(field)}-${i}" data-lg-map-field="${esc(field)}" data-lg-map-raw="${esc(v.raw)}" aria-label="${esc(m.label)} ${esc(v.raw || '빈칸')}" ${state.busy ? 'disabled' : ''}>${m.options.map(([value, label]) => `<option value="${esc(value)}" ${value === v.value ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></td></tr>`).join('')}
    </tbody></table></div></div>`).join('')}
  </details>
  <label class="lg-check"><input id="lgMappingOk" type="checkbox" ${state.mappingOk ? 'checked' : ''} ${state.busy ? 'disabled' : ''}> 대응표를 확인했습니다</label>`;
}
function countsRow(label, expected, got) {
  return `<tr><th scope="row">${esc(label)}</th><td>${expected}</td><td>${got ?? '-'}</td></tr>`;
}
function actionsHtml(r) {
  const c = r.counts || {};
  const dry = state.dry && state.dryKey === payloadKey() ? state.dry : null;
  const busyLabel = {dry: '해 보는 중…', apply: '적용하는 중…'}[state.busy];
  const kinds = KINDS;
  return `<div class="lg-actions">
    <button type="button" class="secondary" data-lg-action="dry" ${canDry() ? '' : 'disabled'}>해 보기</button>
    <button type="button" class="primary" data-lg-action="apply" ${canApply() ? '' : 'disabled'}>적용</button>
    ${busyLabel ? `<span class="lg-note" role="status">${busyLabel}</span>` : ''}
  </div>
  ${!r.ok ? '' : !dry ? '<p class="lg-note">[적용]은 [해 보기]를 마치고 대응표를 확인한 뒤에 눌 수 있습니다. 대응표를 바꾸면 다시 해 봅니다.</p>' : ''}
  ${dry ? `<div class="lg-table-wrap"><table class="lg-table" data-lg-dry><caption>해 보기 결과(DB에 남지 않음)</caption><thead><tr><th scope="col">표</th><th scope="col">파일</th><th scope="col">DB가 넣은 수</th></tr></thead><tbody>
    ${countsRow('업무주제', c.topics, dry.topics)}${countsRow('조직', c.organizations, dry.organizations)}${countsRow('출처', c.sources, dry.sources)}
    ${kinds.map(k => countsRow(KIND_DISPLAY[k], c.records?.[k] ?? 0, dry.records_by_kind?.[k] ?? 0)).join('')}
    ${countsRow('기록-출처 연결', c.record_sources, dry.record_sources)}${countsRow('기록 간 연결', c.links_to_records, dry.links_to_records)}${countsRow('조직연결', c.links_to_organizations, dry.links_to_organizations)}${countsRow('옛 쓰기요청', c.legacy_write_requests, dry.legacy_write_requests)}
  </tbody></table></div>${dry.registered_prefixes?.length ? `<p class="lg-note">적용하면 번호표에 등록할 접두어: ${dry.registered_prefixes.map(esc).join(', ')}</p>` : ''}` : ''}`;
}
function checkHtml(c) {
  const rows = numberCheck(c.file?.report, c);
  const allOk = rows.length && rows.every(r => r.ok);
  // 되돌린 묶음은 들어간 수가 0이 맞으므로 "다름" 대신 "되돌림"으로 보인다.
  const reverted = c.status === 'reverted';
  return `<section class="lg-card" id="lgCheck" tabindex="-1" aria-labelledby="lgCheckTitle" data-lg-check="${esc(c.status)}">
    <h3 id="lgCheckTitle">숫자 확인 — ${esc(c.label)} <span class="lg-pill">${esc(STATUS_LABEL[c.status] || c.status)}</span></h3>
    <p class="lg-note">${reverted ? '되돌린 묶음입니다. 이 묶음에서 들어온 행은 모두 지웠고(들어간 수 0), 같은 파일을 다시 올릴 수 있습니다.' : '탭마다 시트 행 수 = 들어간 수 + 민감 제외 + 거부 이어야 합니다. 들어간 수는 지금 DB에서 센 값입니다.'}</p>
    <div class="lg-table-wrap"><table class="lg-table" data-lg-numbers><thead><tr><th scope="col">탭</th><th scope="col">시트 행</th><th scope="col">들어간 수</th><th scope="col">민감 제외</th><th scope="col">거부</th><th scope="col">맞음</th></tr></thead><tbody>
      ${rows.map(r => `<tr data-lg-tab="${esc(r.key)}"><th scope="row">${esc(r.label)}</th><td>${r.sheet}${r.shift ? ` <span class="lg-muted" title="한 행에 기록 여러 개(+) 또는 겹치거나 담을 수 없어 뺀 연결(−)">(연결 ${r.shift > 0 ? '+' : ''}${r.shift})</span>` : ''}</td><td>${r.inserted}</td><td>${r.excluded}</td><td>${r.rejected}</td><td>${reverted ? '<span class="lg-muted">되돌림</span>' : r.ok ? '맞음' : '<span class="lg-bad">다름</span>'}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="lg-note">연결: 기록-출처 ${c.record_sources ?? 0}, 기록 간 ${c.links_to_records ?? 0}, 조직연결 ${c.links_to_organizations ?? 0}. 가져온 뒤 고친 행 ${c.modified ?? 0}.</p>
    ${c.status === 'applied' ? `<div class="lg-actions">
      <button type="button" class="primary" data-lg-action="confirm" data-lg-id="${esc(c.import_id)}" ${state.busy || !allOk ? 'disabled' : ''}>확인</button>
      <button type="button" class="secondary lg-danger" data-lg-action="revert" data-lg-id="${esc(c.import_id)}" ${state.busy || Number(c.modified) > 0 ? 'disabled' : ''}>되돌리기</button>
    </div>${!allOk ? '<p class="lg-note">숫자가 다르면 [되돌리기] 뒤 시트를 고쳐 다시 가져오세요.</p>' : ''}${Number(c.modified) > 0 ? '<p class="lg-note">가져온 뒤 고친 행이 있어 되돌릴 수 없습니다.</p>' : ''}` : ''}
  </section>`;
}
function importsHtml() {
  if (!state.imports.length) return `<section class="lg-card" aria-labelledby="lgImportsTitle"><h3 id="lgImportsTitle">가져온 묶음</h3><p class="lg-note">아직 가져온 묶음이 없습니다.</p></section>`;
  const fmt = v => v ? new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'}).format(new Date(v)) : '';
  return `<section class="lg-card" aria-labelledby="lgImportsTitle"><h3 id="lgImportsTitle">가져온 묶음</h3><ul class="lg-imports" data-lg-imports>
    ${state.imports.map(i => `<li data-lg-import="${esc(i.id)}" data-lg-status="${esc(i.status)}"><span class="lg-import-name">${esc(i.label)}</span><span class="lg-pill">${esc(STATUS_LABEL[i.status] || i.status)}</span><span class="lg-muted">${esc(fmt(i.created_at))}</span><button type="button" class="lg-tool" data-lg-action="check" data-lg-id="${esc(i.id)}" ${state.busy ? 'disabled' : ''}>숫자 확인</button></li>`).join('')}
  </ul></section>`;
}

function bind() {
  if (bound) return;
  bound = true;
  const root = () => document.querySelector('#ledgerRoot');
  document.addEventListener('change', e => {
    if (!root()?.contains(e.target)) return;
    if (e.target.id === 'lgFile') { void onFiles(e.target.files); return; }
    if (e.target.id === 'lgMappingOk') { state.mappingOk = e.target.checked; render(); return; }
    const field = e.target.dataset?.lgMapField;
    if (field) {
      (state.overrides[field] ||= {})[e.target.dataset.lgMapRaw] = e.target.value;
      state.mappingOk = false; state.mappingOpen = true;
      reanalyze(); render();
    }
  });
  document.addEventListener('input', e => {
    if (e.target.id !== 'lgLabel' || !root()?.contains(e.target)) return;
    state.label = e.target.value;
    if (state.input) { reanalyze(); render(); }
  });
  document.addEventListener('click', e => {
    const button = e.target.closest?.('[data-lg-action]');
    if (!button || !root()?.contains(button) || button.disabled) return;
    const action = button.dataset.lgAction, id = button.dataset.lgId;
    if (action === 'reload') void load();
    else if (action === 'dry') void dryRun();
    else if (action === 'apply') void applyNow();
    else if (action === 'check') void showCheck(id);
    else if (action === 'confirm' || action === 'revert') void decide(id, action);
    else if (action === 'cand-dry') void candDryRun();
    else if (action === 'cand-apply') void candApply();
  });
  // 대응표를 펼치고 접은 것은 다시 그려도 유지한다(toggle은 거품이 없어 capture로 받는다).
  document.addEventListener('toggle', e => { if (e.target?.matches?.('#ledgerRoot details[data-lg-mapping]')) state.mappingOpen = e.target.open; }, true);
  window.KPTURouter?.on?.('ledger', () => { void load(); });
}

window.addEventListener('kptu:session-changed', () => { state = freshState(); if (document.querySelector('#ledgerView') && workspaceId()) void load(); });
async function boot() {
  installView();
  bind();
  await load();
  window.KPTULedgerImport = {reload: load};
  return true;
}
window.__KPTU_LEDGER_IMPORT_READY__ = boot().catch(err => { console.error('ledger import init', err?.name || 'error'); return false; });
