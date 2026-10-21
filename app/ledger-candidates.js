// AI-서버연동 S7-c: [원장] 화면의 원장 후보 칸(#ledgerCandidatesRoot). 이 모듈이 그 칸의 유일한 renderer다.
// 원장에 들어가는 문은 여기 하나다: 대기 후보를 명진이 [확정]·[고쳐서 확정]·[버림]. AI·Claude는 후보만 만들고 원장에 직접 쓰지 않는다.
// - [원장 후보 만들기]: 서버 ai-assist(kind=ledger_candidates)에 kind만 보낸다. 서버가 Web2 기록을 로그인 토큰으로 읽어 후보를 "대기"로 더한다.
// - [확정]·[고쳐서 확정]: app_confirm_ledger_candidate RPC(20261021190000, SECURITY INVOKER) 한 번. 한 거래로 기록·출처·연결을 만든다.
// - [버림]: 대기 후보의 상태만 바꾼다(owner RLS, 결정된 후보는 DB 트리거가 잠금).
// - [되돌리기](확정 직후 10초)·최근 확정 ⋯ [확정 취소]: app_unconfirm_ledger_candidate RPC(20261021234000) 한 번. 한 거래로 그 확정이 만든
//   출처 연결·기록 간 연결을 지우고 새 기록은 폐기, 후보는 대기로. 함수가 없으면(404) 두 버튼과 최근 확정 칸만 숨긴다.
// 후보 표 또는 확정 함수가 없으면(404) 칸 전체를 조용히 숨긴다. 원장이 바뀌면 kptu:ledger-changed로 다른 칸에 알린다.
import {callAiAssist, AI_SUMMARY_TEXT} from './basket-ai-summary.js';
import {candidateView, editPayload, confirmError, undoError, UNDO_SECONDS} from './ledger-candidate-model.mjs';
import {KIND_LABEL, EVENT_STATUS_LABEL, DECISION_TYPE_LABEL, EVIDENCE_TYPE_LABEL, COMMITMENT_STATUS_LABEL, SENSITIVITY_LABEL, RELATION_LABEL} from './ledger-browse-model.mjs';

const rt = window.KPTURuntime;
const ZERO = '00000000-0000-0000-0000-000000000000';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const q = v => encodeURIComponent(v);
const workspaceId = () => rt?.context?.read?.()?.workspace?.id || null;
const isMissing = e => e?.status === 404 || /PGRST20[25]|42P01|42883|schema cache|Could not find the function/i.test(String(e?.message || ''));
const FIELDS = 'id,origin,status,action,kind,target_record_id,title,payload,sensitivity,dedup_key,import_id,created_at';
const LIMIT = 100;
const CONFIRMED_LIMIT = 20;
// 서버는 OpenAI를 30초 기다리고 1번 다시 시도할 수 있고, 그 전에 기록을 여러 표에서 읽는다.
const AI_TIMEOUT_MS = 90000;
const LEDGER_AI_TEXT = Object.freeze({
  ...AI_SUMMARY_TEXT,
  not_ready: '원장 후보 만들기는 아직 준비 중이에요.',
  unsupported_kind: '원장 후보 만들기는 아직 준비 중이에요.',
  daily_limit: '오늘 원장 후보를 만들 수 있는 횟수를 다 썼어요. 내일 다시 만들어요.',
  monthly_limit: '이번 달 AI 한도에 닿았어요. 원장 후보 만들기는 다음 달에 다시 돼요.',
  ledger_not_ready: '원장 후보 기능이 아직 준비되지 않았어요.',
  ledger_unavailable: '원장 후보를 읽거나 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.'
});

let state = fresh();
let bound = false;
let undoTimer = null;
function fresh() {
  return {phase: 'loading', rows: [], more: false, busy: '', message: '', error: '', editing: null, form: null, formError: '', discarding: null, reason: '', targets: new Map(),
    undoReady: false, confirmed: [], results: new Map(), lastConfirmed: null, confirmedOpen: false};
}

async function probe() {
  try {
    await rt.api('/rest/v1/rpc/app_confirm_ledger_candidate', {method: 'POST', body: {p_candidate_id: ZERO, p_edit: null}, singleFlight: false});
  } catch (e) {
    if (isMissing(e)) return false;
    // 있는 함수는 없는 후보를 LEDGER_CANDIDATE_NOT_FOUND로 거절한다(아무것도 쓰지 않음).
    if (/LEDGER_CANDIDATE_NOT_FOUND/.test(String(e?.message || ''))) return true;
    throw e;
  }
  return true;
}
// 확정 취소 함수가 있는지: 없는 후보(0…0)를 보내면 있는 함수는 LEDGER_UNDO_NOT_FOUND로 거절한다(아무것도 쓰지 않음).
async function probeUndo() {
  try {
    await rt.api('/rest/v1/rpc/app_unconfirm_ledger_candidate', {method: 'POST', body: {p_candidate_id: ZERO}, singleFlight: false});
  } catch (e) {
    if (/LEDGER_UNDO_NOT_FOUND/.test(String(e?.message || ''))) return true;
    return false; // 없는 함수(404)·그 밖의 오류: 버튼을 숨긴다(확정·버림은 그대로).
  }
  return false; // 진짜 함수는 없는 후보를 꼭 거절한다. 거절이 없으면 다른 것으로 보고 숨긴다.
}
// 최근 확정한 후보(확정 취소용)와 그 결과 원장 기록의 ID·제목·유효상태.
async function readConfirmed() {
  if (!state.undoReady) { state.confirmed = []; state.results = new Map(); return; }
  const rows = await rt.api(`/rest/v1/app_ledger_candidates?workspace_id=eq.${q(workspaceId())}&status=eq.confirmed&select=id,action,kind,title,result_record_id,decided_at&order=decided_at.desc,id.asc&limit=${CONFIRMED_LIMIT}`, {singleFlight: false});
  state.confirmed = Array.isArray(rows) ? rows.filter(r => r && r.id) : [];
  const ids = [...new Set(state.confirmed.map(r => r.result_record_id).filter(Boolean))];
  state.results = new Map();
  if (ids.length) {
    const t = await rt.api(`/rest/v1/app_ledger_records?id=in.(${ids.map(q).join(',')})&select=id,ledger_id,title`, {singleFlight: false}).catch(() => []);
    for (const r of t || []) state.results.set(r.id, r);
  }
}
async function readRows() {
  const rows = await rt.api(`/rest/v1/app_ledger_candidates?workspace_id=eq.${q(workspaceId())}&status=eq.pending&select=${FIELDS}&order=created_at.desc,id.asc&limit=${LIMIT + 1}`, {singleFlight: false});
  const list = (Array.isArray(rows) ? rows : []).map(candidateView).filter(Boolean);
  state.more = list.length > LIMIT;
  state.rows = list.slice(0, LIMIT);
  // 대상 기록(출처 추가·대체 후보)의 ID·제목.
  const ids = [...new Set(state.rows.map(r => r.targetRecordId).filter(Boolean))];
  state.targets = new Map();
  if (ids.length) {
    const t = await rt.api(`/rest/v1/app_ledger_records?id=in.(${ids.map(q).join(',')})&select=id,ledger_id,title`, {singleFlight: false}).catch(() => []);
    for (const r of t || []) state.targets.set(r.id, r);
  }
}

let loading = null;
function load() {
  if (!workspaceId() || !document.querySelector('#ledgerCandidatesRoot')) return Promise.resolve();
  loading ||= (async () => {
    if (state.phase !== 'ready') { state.phase = 'loading'; render(); }
    try {
      await readRows();
      state.phase = (await probe()) ? 'ready' : 'hidden';
      state.undoReady = state.phase === 'ready' && await probeUndo();
      await readConfirmed().catch(() => { state.confirmed = []; });
    } catch (e) { state.phase = isMissing(e) ? 'hidden' : 'error'; }
    render();
  })().finally(() => { loading = null; });
  return loading;
}
const changed = () => { try { window.dispatchEvent(new CustomEvent('kptu:ledger-changed', {detail: {from: 'candidates'}})); } catch {} };

async function makeCandidates() {
  if (state.busy) return;
  state.busy = 'ai'; state.message = ''; state.error = ''; render();
  const r = await callAiAssist({kind: 'ledger_candidates'}, {timeoutMs: AI_TIMEOUT_MS}, LEDGER_AI_TEXT);
  if (!r.ok) state.error = LEDGER_AI_TEXT[r.code] || LEDGER_AI_TEXT.internal_error;
  else {
    const d = r.data, n = Number.isSafeInteger(d.added) ? d.added : 0, ex = Number.isSafeInteger(d.excluded) ? d.excluded : 0;
    state.message = (n ? `새 원장 후보 ${n}건을 더했어요.` : '새로 더할 원장 후보가 없었어요.')
      + (ex ? ` 민감(S3·개인정보)으로 ${ex}건은 넣지 않았어요.` : '') + (d.partial === true ? ' 기록이 많아 최근 것부터 일부만 봤어요.' : '');
    try { await readRows(); } catch {}
  }
  state.busy = ''; render();
}

async function confirmRow(id, edit = null) {
  if (state.busy) return;
  state.busy = id; state.message = ''; state.error = ''; state.formError = ''; render();
  try {
    const done = await rt.api('/rest/v1/rpc/app_confirm_ledger_candidate', {method: 'POST', body: {p_candidate_id: id, p_edit: edit}, singleFlight: false, timeoutMs: 60000});
    state.message = `${done?.ledger_id || '원장 기록'}${done?.action === 'add_source' ? '에 출처를 더했습니다.' : '(으)로 원장에 넣었습니다.'}`;
    state.editing = null; state.form = null;
    state.rows = state.rows.filter(r => r.id !== id);
    if (state.undoReady) offerUndo(id);
    try { await readConfirmed(); } catch {}
    changed();
  } catch (e) {
    const text = confirmError(e);
    if (state.editing === id) state.formError = text; else state.error = text;
  }
  state.busy = ''; render();
}
// 확정 직후 [되돌리기]를 UNDO_SECONDS초 동안 보인다(그 뒤에는 최근 확정 ⋯ [확정 취소]).
function offerUndo(id) {
  clearTimeout(undoTimer);
  state.lastConfirmed = id;
  undoTimer = setTimeout(() => { if (state.lastConfirmed === id) { state.lastConfirmed = null; render(); } }, UNDO_SECONDS * 1000);
}
async function undoConfirm(id) {
  if (!id || state.busy) return;
  state.busy = 'undo:' + id; state.message = ''; state.error = ''; render();
  try {
    const done = await rt.api('/rest/v1/rpc/app_unconfirm_ledger_candidate', {method: 'POST', body: {p_candidate_id: id}, singleFlight: false, timeoutMs: 60000});
    if (state.lastConfirmed === id) { clearTimeout(undoTimer); state.lastConfirmed = null; }
    state.message = `${done?.ledger_id || '원장 기록'} 확정을 취소했습니다. 후보는 대기로 돌아갔습니다.`
      + (done?.record_retired ? ` ${done?.ledger_id || '그 기록'}은 폐기 상태로 남고 번호는 다시 쓰지 않습니다.` : '');
    try { await readRows(); await readConfirmed(); } catch {}
    changed();
  } catch (e) { state.error = undoError(e); }
  state.busy = ''; render();
}
async function discard(ids, reason) {
  const list = ids.filter(Boolean);
  if (!list.length || state.busy) return;
  state.busy = list.length === 1 ? list[0] : 'batch'; state.message = ''; state.error = ''; render();
  try {
    const rows = await rt.api(`/rest/v1/app_ledger_candidates?workspace_id=eq.${q(workspaceId())}&id=in.(${list.map(q).join(',')})&status=eq.pending&select=id,status`,
      {method: 'PATCH', prefer: 'return=representation', body: {status: 'discarded', decided_at: new Date().toISOString(), discard_reason: reason || null}, singleFlight: false});
    const gone = new Set((Array.isArray(rows) ? rows : []).filter(r => r.status === 'discarded').map(r => r.id));
    state.rows = state.rows.filter(r => !gone.has(r.id));
    state.message = gone.size ? `후보 ${gone.size}건을 버렸습니다.` : '이미 처리된 후보입니다.';
    state.discarding = null; state.reason = '';
    if (gone.size !== list.length) { try { await readRows(); } catch {} }
  } catch { state.error = '버리지 못했습니다. 잠시 뒤 다시 시도하세요.'; }
  state.busy = ''; render();
}
function startEdit(id) {
  const v = state.rows.find(r => r.id === id);
  if (!v) return;
  const rec = v.record;
  state.editing = id; state.discarding = null; state.formError = '';
  state.form = {title: v.title, summary: rec.summary || '', date_start: rec.date_start || '', sensitivity: v.sensitivity, scope: rec.scope || 'work', note: rec.note || '',
    event_status: rec.event_status || 'tracking', decision_type: rec.decision_type || '', decision_reason: rec.decision_reason || '', evidence_type: rec.evidence_type || 'other',
    counterparty: rec.counterparty || '', commitment_status: rec.commitment_status || 'waiting', follow_up_on: rec.follow_up_on || ''};
  render();
  document.querySelector(`#lcEdit-${CSS.escape(id)} [name="title"]`)?.focus?.();
}
function submitEdit(id) {
  const v = state.rows.find(r => r.id === id);
  if (!v) return;
  const built = editPayload(v, state.form || {});
  if (built.error) { state.formError = built.error; render(); return; }
  void confirmRow(id, built.edit);
}

// ---------- 그리기 ----------
function render() {
  const root = document.querySelector('#ledgerCandidatesRoot');
  if (!root) return;
  root.dataset.ledgerCandidates = state.phase;
  root.hidden = state.phase === 'hidden';
  if (state.phase === 'hidden') { root.innerHTML = ''; return; }
  // 고치는 중인 칸은 다시 그리지 않는다(입력 중 글자·포커스 유지). 고치기 칸 밖만 바뀌면 고치기 칸 안의 상태 줄만 바꾼다.
  const active = document.activeElement;
  if (state.editing && active && root.querySelector(`#lcEdit-${CSS.escape(state.editing)}`)?.contains(active) && root.querySelector('[data-lc-shell]')) {
    const box = root.querySelector(`#lcEdit-${CSS.escape(state.editing)} [data-lc-form-status]`);
    if (box) box.innerHTML = formStatusHtml();
    root.querySelectorAll('[data-lc-action]').forEach(b => { b.disabled = !!state.busy; });
    return;
  }
  root.innerHTML = `<section class="lg-card" data-lc-shell aria-labelledby="lcTitle">
    <h3 id="lcTitle">원장 후보</h3>
    <p class="lg-note">AI·Claude가 만든 후보입니다. 원장에는 [확정]한 것만 들어갑니다. 고칠 것이 있으면 [고쳐서 확정], 필요 없으면 [버림].</p>
    <div class="lg-actions"><button type="button" class="secondary" data-lc-action="make" ${state.busy || state.phase !== 'ready' ? 'disabled' : ''}>원장 후보 만들기</button>
      ${state.busy === 'ai' ? '<span class="lg-note" role="status">Web2 기록에서 후보를 찾는 중…</span>' : ''}</div>
    <div class="lg-live" role="status" aria-live="polite">${state.message ? `<p class="lg-ok">${esc(state.message)}</p>` : ''}</div>
    ${undoOfferHtml()}
    ${state.error ? `<p class="lg-error" role="alert" data-lc-error>${esc(state.error)}</p>` : ''}
    ${bodyHtml()}
    ${confirmedHtml()}
  </section>`;
}
function undoOfferHtml() {
  if (!state.undoReady || !state.lastConfirmed) return '';
  const busy = state.busy === 'undo:' + state.lastConfirmed;
  return `<div class="lg-actions" data-lc-undo-offer><button type="button" class="lg-tool" data-lc-action="undo" data-lc-id="${esc(state.lastConfirmed)}" ${state.busy ? 'disabled' : ''}>${busy ? '되돌리는 중…' : '되돌리기'}</button>
    <span class="lg-note">${UNDO_SECONDS}초 안에 누르면 방금 확정을 취소합니다.</span></div>`;
}
// 최근 확정(접힘). 항목마다 ⋯ 안에 [확정 취소]. 기록이 확정 뒤 고쳐졌거나 다른 기록이 가리키면 서버가 거절하고 이유를 보인다.
function confirmedHtml() {
  if (!state.undoReady || state.phase !== 'ready' || !state.confirmed.length) return '';
  const items = state.confirmed.map(c => {
    const rec = state.results.get(c.result_record_id);
    const day = String(c.decided_at || '').slice(0, 10);
    const busy = state.busy === 'undo:' + c.id;
    return `<li class="lc-item lc-confirmed" data-lc-confirmed="${esc(c.id)}">
      <div class="lc-confirmed-line">
        <span class="lb-line"><span class="lg-pill">${esc(KIND_LABEL[c.kind] || c.kind)}</span><span class="lg-pill">확정됨</span>${rec ? `<span class="lb-id">${esc(rec.ledger_id)}</span>` : ''}${day ? `<span class="lb-id">${esc(day)}</span>` : ''}</span>
        <details class="lc-more"><summary class="lg-tool" aria-label="확정 관리: ${esc(c.title)}">⋯</summary>
          <div class="lc-more-panel" role="group" aria-label="확정 관리"><button type="button" class="lg-tool lg-danger" data-lc-action="undo-ask" data-lc-id="${esc(c.id)}" data-lc-ledger="${esc(rec?.ledger_id || '')}" ${state.busy ? 'disabled' : ''}>${busy ? '취소하는 중…' : '확정 취소'}</button></div>
        </details>
      </div>
      <span class="lb-title">${esc(c.title)}</span>
    </li>`;
  }).join('');
  return `<details class="lg-details lc-confirmed-box" data-lc-confirmed-box ${state.confirmedOpen ? 'open' : ''}><summary>최근 확정 ${state.confirmed.length}건 (확정 취소)</summary>
    <p class="lg-note">확정을 취소하면 그 확정이 만든 출처 연결·기록 간 연결을 지우고, 새로 만든 기록은 폐기 상태로 남기며(번호는 다시 쓰지 않음) 후보는 대기로 돌아갑니다.</p>
    <ul class="lc-list">${items}</ul></details>`;
}
function bodyHtml() {
  if (state.phase === 'loading') return '<p class="lg-note" role="status">원장 후보를 읽는 중…</p>';
  if (state.phase === 'error') return '<p class="lg-error" role="alert">원장 후보를 읽지 못했습니다.</p><button type="button" class="secondary" data-lc-action="reload">다시 읽기</button>';
  if (!state.rows.length) return '<p class="lg-note" data-lc-empty>대기 중인 원장 후보가 없습니다.</p>';
  const batches = new Map();
  for (const r of state.rows) if (r.importId) batches.set(r.importId, (batches.get(r.importId) || 0) + 1);
  const batchLine = [...batches].map(([id, n]) => `<li class="lg-note">Claude 파일 묶음 · 대기 ${n}건 <button type="button" class="lg-tool lg-danger" data-lc-action="discard-batch" data-lc-import="${esc(id)}" ${state.busy ? 'disabled' : ''}>이 묶음 대기 후보 모두 버림</button></li>`).join('');
  return `${batchLine ? `<ul class="lg-list lc-batches">${batchLine}</ul>` : ''}
    <p class="lg-note">대기 ${state.rows.length}건${state.more ? ` (최근 ${LIMIT}건만 보임)` : ''}</p>
    <ul class="lc-list" data-lc-list>${state.rows.map(rowHtml).join('')}</ul>`;
}
function rowHtml(v) {
  const target = v.targetRecordId ? state.targets.get(v.targetRecordId) : null;
  const pills = [`<span class="lg-pill">${esc(v.kindLabel)}</span>`, v.action !== 'new' ? `<span class="lg-pill">${esc(v.actionLabel)}</span>` : '',
    v.originLabel ? `<span class="lb-id">${esc(v.originLabel)}</span>` : '', v.sensitivity === 'S2' ? `<span class="lg-pill">${esc(SENSITIVITY_LABEL.S2)}</span>` : ''].join('');
  const sources = v.sources.map(s => s.source ? esc(s.source) : s.new ? esc(s.new.title || '새 출처') : '').filter(Boolean);
  const links = v.links.map(l => `${esc(RELATION_LABEL[l.relation] || '관련')} ${l.target_record ? esc(l.target_record) : l.target_organization ? esc(l.target_organization) : l.target_project_id ? 'Web2 프로젝트' : l.target_meeting_id ? 'Web2 회의' : ''}`);
  const kindExtra = [v.record.counterparty ? `상대측 ${esc(v.record.counterparty)}` : '', v.record.follow_up_on ? `후속확인일 ${esc(v.record.follow_up_on)}` : '',
    v.record.decision_type ? `결정유형 ${esc(DECISION_TYPE_LABEL[v.record.decision_type] || v.record.decision_type)}` : ''].filter(Boolean).join(' · ');
  const busy = state.busy === v.id;
  return `<li class="lc-item" data-lc-row="${esc(v.id)}" data-lc-kind="${esc(v.kind)}" data-lc-origin="${esc(v.origin)}">
    <span class="lb-line">${pills}${v.date ? `<span class="lb-id">${esc(v.date)}</span>` : ''}</span>
    <span class="lb-title">${esc(v.title)}</span>
    ${target ? `<span class="lb-meta">대상: ${esc(target.ledger_id)} ${esc(target.title)}</span>` : ''}
    ${v.summary ? `<span class="lb-summary">${esc(v.summary)}</span>` : ''}
    ${kindExtra ? `<span class="lb-meta">${kindExtra}</span>` : ''}
    ${v.originRef ? `<span class="lb-meta">Web2 원래 기록: ${esc(v.originRef.label)} ${esc(v.originRef.day)}</span>` : ''}
    ${sources.length ? `<span class="lb-meta">출처: ${sources.join(', ')}</span>` : ''}
    ${links.length ? `<span class="lb-meta">연결: ${links.join(', ')}</span>` : ''}
    ${v.supersedeReason ? `<span class="lb-meta">대체 이유: ${esc(v.supersedeReason)}</span>` : ''}
    ${state.editing === v.id ? editHtml(v) : state.discarding === v.id ? discardHtml(v) : `<div class="lg-actions">
      <button type="button" class="primary" data-lc-action="confirm" data-lc-id="${esc(v.id)}" ${state.busy || v.action === 'update' ? 'disabled' : ''}>${busy ? '확정하는 중…' : '확정'}</button>
      <button type="button" class="secondary" data-lc-action="edit" data-lc-id="${esc(v.id)}" ${state.busy || v.action === 'update' || v.action === 'add_source' ? 'disabled' : ''}>고쳐서 확정</button>
      <button type="button" class="secondary lg-danger" data-lc-action="discard" data-lc-id="${esc(v.id)}" ${state.busy ? 'disabled' : ''}>버림</button>
    </div>${v.action === 'update' ? '<p class="lg-note">기존 기록 고침 후보는 원장 기록을 직접 고친 뒤 [버림]으로 정리합니다.</p>' : ''}`}
  </li>`;
}
const option = (map, value, blank) => (blank ? `<option value="">${esc(blank)}</option>` : '') + Object.entries(map).map(([k, l]) => `<option value="${esc(k)}" ${k === value ? 'selected' : ''}>${esc(l)}</option>`).join('');
function editHtml(v) {
  const f = state.form || {};
  const id = v.id;
  const field = (name, label, control, wide = false) => `<label class="lg-field${wide ? ' lc-wide' : ''}"><span>${esc(label)}</span>${control}</label>`;
  const input = (name, type = 'text', max = 300) => `<input class="lg-input" name="${name}" type="${type}" ${type === 'text' ? `maxlength="${max}"` : ''} value="${esc(f[name] ?? '')}">`;
  const extra = {
    event: () => field('event_status', '사건 상태', `<select class="lg-select lb-select" name="event_status">${option(EVENT_STATUS_LABEL, f.event_status)}</select>`),
    decision: () => field('decision_type', '결정유형', `<select class="lg-select lb-select" name="decision_type">${option(DECISION_TYPE_LABEL, f.decision_type, '(비움)')}</select>`)
      + field('decision_reason', '결정이유', `<textarea class="lc-textarea" name="decision_reason" maxlength="2000">${esc(f.decision_reason)}</textarea>`, true),
    evidence: () => field('evidence_type', '근거 유형', `<select class="lg-select lb-select" name="evidence_type">${option(EVIDENCE_TYPE_LABEL, f.evidence_type)}</select>`),
    commitment: () => field('counterparty', '상대측', input('counterparty', 'text', 200)) + field('commitment_status', '이행상태', `<select class="lg-select lb-select" name="commitment_status">${option(COMMITMENT_STATUS_LABEL, f.commitment_status)}</select>`)
      + field('follow_up_on', '후속확인일', input('follow_up_on', 'date')),
    change: () => ''
  }[v.kind]?.() || '';
  return `<form class="lc-edit" id="lcEdit-${esc(id)}" data-lc-form="${esc(id)}" novalidate aria-label="${esc(KIND_LABEL[v.kind])} 후보 고치기">
    ${field('title', '제목', input('title'), true)}
    ${field('summary', '요지', `<textarea class="lc-textarea" name="summary" maxlength="4000">${esc(f.summary)}</textarea>`, true)}
    ${field('date_start', '기준일(하루)', input('date_start', 'date'))}
    ${field('sensitivity', '민감도', `<select class="lg-select lb-select" name="sensitivity">${option(SENSITIVITY_LABEL, f.sensitivity)}</select>`)}
    ${field('scope', '범위', `<select class="lg-select lb-select" name="scope"><option value="work" ${f.scope !== 'interest' ? 'selected' : ''}>업무</option><option value="interest" ${f.scope === 'interest' ? 'selected' : ''}>관심</option></select>`)}
    ${extra}
    ${field('note', '비고', `<textarea class="lc-textarea" name="note" maxlength="4000">${esc(f.note)}</textarea>`, true)}
    <div class="lc-wide" data-lc-form-status>${formStatusHtml()}</div>
    <div class="lg-actions lc-wide">
      <button type="submit" class="primary" data-lc-action="save" data-lc-id="${esc(id)}" ${state.busy ? 'disabled' : ''}>${state.busy === id ? '확정하는 중…' : '고친 내용으로 확정'}</button>
      <button type="button" class="secondary" data-lc-action="cancel" ${state.busy ? 'disabled' : ''}>취소</button>
    </div>
  </form>`;
}
const formStatusHtml = () => state.formError ? `<p class="lg-error" role="alert" data-lc-form-error>${esc(state.formError)}</p>` : '';
function discardHtml(v) {
  return `<div class="lc-edit" data-lc-discard="${esc(v.id)}">
    <label class="lg-field lc-wide"><span>버리는 이유(선택)</span><input class="lg-input" id="lcReason-${esc(v.id)}" name="reason" type="text" maxlength="500" value="${esc(state.reason)}" placeholder="예: 이미 원장에 있음"></label>
    <div class="lg-actions lc-wide">
      <button type="button" class="secondary lg-danger" data-lc-action="discard-yes" data-lc-id="${esc(v.id)}" ${state.busy ? 'disabled' : ''}>버림 확인</button>
      <button type="button" class="secondary" data-lc-action="cancel" ${state.busy ? 'disabled' : ''}>취소</button>
    </div>
  </div>`;
}

function bind() {
  if (bound) return;
  bound = true;
  const root = () => document.querySelector('#ledgerCandidatesRoot');
  document.addEventListener('input', e => {
    const form = e.target.closest?.('[data-lc-form]');
    if (form && root()?.contains(form) && state.form && e.target.name) { state.form[e.target.name] = e.target.value; return; }
    if (e.target.name === 'reason' && root()?.contains(e.target)) state.reason = e.target.value;
  });
  document.addEventListener('change', e => {
    const form = e.target.closest?.('[data-lc-form]');
    if (form && root()?.contains(form) && state.form && e.target.name) state.form[e.target.name] = e.target.value;
  });
  // 최근 확정 칸을 펼친 상태는 다시 그려도 유지한다(toggle은 버블링하지 않아 capture로 받는다).
  document.addEventListener('toggle', e => {
    if (e.target?.matches?.('[data-lc-confirmed-box]') && root()?.contains(e.target)) state.confirmedOpen = e.target.open;
  }, true);
  document.addEventListener('submit', e => {
    const form = e.target.closest?.('[data-lc-form]');
    if (!form || !root()?.contains(form)) return;
    e.preventDefault();
    if (!state.busy) submitEdit(form.dataset.lcForm);
  });
  document.addEventListener('click', e => {
    const button = e.target.closest?.('[data-lc-action]');
    if (!button || !root()?.contains(button) || button.disabled) return;
    const action = button.dataset.lcAction, id = button.dataset.lcId;
    if (action === 'save') return; // submit이 처리한다.
    if (action === 'make') void makeCandidates();
    else if (action === 'reload') void load();
    else if (action === 'confirm') void confirmRow(id);
    else if (action === 'undo') void undoConfirm(id);
    else if (action === 'undo-ask') {
      const label = button.dataset.lcLedger || '이 기록';
      if (window.confirm(`${label} 확정을 취소할까요? 후보는 대기로 돌아가고 ${label}은 폐기 상태로 남습니다.`)) void undoConfirm(id);
    }
    else if (action === 'edit') startEdit(id);
    else if (action === 'cancel') { state.editing = null; state.form = null; state.discarding = null; state.formError = ''; render(); }
    else if (action === 'discard') { state.discarding = id; state.editing = null; state.reason = ''; render(); document.querySelector(`#lcReason-${CSS.escape(id)}`)?.focus?.(); }
    else if (action === 'discard-yes') void discard([id], state.reason.trim().slice(0, 500));
    else if (action === 'discard-batch') {
      const ids = state.rows.filter(r => r.importId === button.dataset.lcImport).map(r => r.id);
      if (ids.length && window.confirm(`이 묶음의 대기 후보 ${ids.length}건을 모두 버릴까요?`)) void discard(ids, 'Claude 파일 묶음 버림');
    }
  });
  window.addEventListener('kptu:ledger-changed', e => { if (e.detail?.from !== 'candidates') void load(); });
  window.KPTURouter?.on?.('ledger', () => { void load(); });
}

window.addEventListener('kptu:session-changed', () => { clearTimeout(undoTimer); state = fresh(); if (document.querySelector('#ledgerCandidatesRoot') && workspaceId()) void load(); });
async function boot() {
  bind();
  await load();
  window.KPTULedgerCandidates = {reload: load};
  return true;
}
window.__KPTU_LEDGER_CANDIDATES_READY__ = boot().catch(err => { console.error('ledger candidates init', err?.name || 'error'); return false; });
