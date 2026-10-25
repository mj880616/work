// LEDGER-수정요청(설계 docs/design/ledger-auto-record.md 7절·10절 4번, 명진 요청 2026-10-24 07:17): 원장 고치기·기록하기 칸(#ledgerFixRoot).
// 이 모듈이 그 칸의 유일한 renderer다. 칸은 평소 닫혀 있고, 목록 위 [+ 기록하기] 또는 기록 상세 ⋯ [고치기]가 open()으로 연다.
// 입력칸 하나에 일상어 한 줄(예: "나 지부 2차 교섭은 11/4가 아니라 11/5였음") 또는 Claude 수정안 덩어리(kptu-ledger-fix JSON)를 쓴다.
//   일상어 → 서버 ai-assist {kind:"ledger_fix", text, target?}가 원장 형식으로 바꾸고 DB 해 보기까지 한 결과(request·preview)를 받는다.
//   덩어리 → 그대로 DB 함수 해 보기(app_apply_ledger_fix, p_dry_run=true).
// 미리보기는 일상어 한 줄씩("날짜 11/4 → 11/5로 고침. 옛 기록은 대체됨으로 남김"). [반영] 한 번 = 미리본 그 요청을 p_dry_run=false로 한 번.
// 미리보기 없이 바로 바뀌지 않는다. 입력을 고치면 미리보기를 지운다. 반영 직후 10초 [되돌리기] = app_undo_ledger_fix.
// LEDGER-기록바로업데이트: 기록 상세 ⋯ [내용 업데이트…]로 열면 대상이 그 기록으로 고정된다(그 기록 하나를 고치거나 폐기하는 요청만 미리보기·반영, 그 밖은 거절).
// 쓰기는 이 DB 함수 둘뿐(SECURITY INVOKER, owner RLS 그대로). 작성 중 글은 이 탭 메모리에만 있다(브라우저 저장소 없음).
import { readInput, serverBody, targetsOf, previewLines, appliedText, fixErrorText, anchoredViolation, UNDO_MS, FIX_TEXT_MAX } from './ledger-fix-model.mjs';
import { callAiAssist, AI_SUMMARY_TEXT } from './basket-ai-summary.js';
import { offerUndoNotice } from './basket-record-delete.js';

const rt = window.KPTURuntime;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const q = v => encodeURIComponent(v);
const workspaceId = () => rt?.context?.read?.()?.workspace?.id || null;
const LEDGER_ID = /^[A-Z]{2,6}-[0-9]{4,6}$/;
// 일상어 고치기가 서버에 아직 없을 때(배포 전): 덩어리 붙여 넣기는 그대로 된다.
const PLACEHOLDER_NEW = '예: 나 지부 2차 교섭은 11/4가 아니라 11/5였음 (Claude 수정안을 붙여 넣어도 돼요)';
const NOT_READY = '일상어 고치기는 아직 준비 중이에요. Claude 수정안 덩어리를 붙여 넣으면 바로 해 볼 수 있어요.';

let state = fresh();
let bound = false;
let seq = 0;
function fresh() {
  return { open: false, target: null, targetTitle: '', text: '', busy: '', error: '', note: '', request: null, lines: null };
}

function changedLedger() {
  try { window.dispatchEvent(new CustomEvent('kptu:ledger-changed', { detail: { source: 'fix' } })); } catch { /* 다음 열기에 */ }
  window.KPTULedgerExport?.changed?.();
}

// 미리보기 줄에 쓸 이름: 대상 기록 제목, 주제 이름(고정 ID·uuid 모두).
async function readNames(request) {
  const ws = q(workspaceId());
  const ids = targetsOf(request);
  const records = new Map(), topics = new Map(), kinds = new Map();
  try {
    if (ids.length) {
      const rows = await rt.api(`/rest/v1/app_ledger_records?workspace_id=eq.${ws}&ledger_id=in.(${ids.map(q).join(',')})&select=ledger_id,title,kind&limit=50`, { singleFlight: false });
      for (const r of Array.isArray(rows) ? rows : []) if (typeof r?.ledger_id === 'string' && typeof r.title === 'string') { records.set(r.ledger_id, r.title); if (typeof r.kind === 'string') kinds.set(r.ledger_id, r.kind); }
    }
    const wantsTopic = (request.items || []).some(i => i?.set && 'topic' in i.set);
    if (wantsTopic) {
      const rows = await rt.api(`/rest/v1/app_ledger_topics?workspace_id=eq.${ws}&select=id,ledger_id,name&limit=500`, { singleFlight: false });
      for (const t of Array.isArray(rows) ? rows : []) if (typeof t?.name === 'string') { topics.set(String(t.id), t.name); topics.set(String(t.ledger_id), t.name); }
    }
  } catch { /* 이름 없이 "그 기록" */ }
  return { records, topics, kinds };
}

async function dryRun(request) {
  return rt.api('/rest/v1/rpc/app_apply_ledger_fix', { method: 'POST', body: { p_workspace_id: workspaceId(), p_request: request, p_dry_run: true }, singleFlight: false });
}

async function preview() {
  if (state.busy) return;
  const input = readInput(state.text);
  if (input.error) { state.error = input.error; render(); return; }
  const mine = ++seq;
  state.busy = 'preview'; state.error = ''; state.note = ''; state.request = null; state.lines = null; render();
  try {
    let request, dry;
    if (input.mode === 'paste') {
      request = input.request;
      dry = await dryRun(request);
    } else {
      const r = await callAiAssist(serverBody(input.text, state.target));
      if (mine !== seq) return;
      if (!r.ok) {
        state.error = ['not_ready', 'unsupported_kind'].includes(r.code) ? NOT_READY : (AI_SUMMARY_TEXT[r.code] || AI_SUMMARY_TEXT.internal_error);
        return;
      }
      if (!r.data.request) { state.note = typeof r.data.question === 'string' && r.data.question ? r.data.question : '무엇을 고칠지 알아듣지 못했어요.'; return; }
      request = r.data.request;
      dry = { dry_run: true, items: r.data.preview };
    }
    if (mine !== seq) return;
    const outside = anchoredViolation(request, state.target);
    if (outside) { state.error = outside; return; }
    const names = await readNames(request);
    const lines = previewLines(dry, names);
    if (mine !== seq) return;
    if (!lines) { state.error = '미리보기를 만들지 못했어요. 다시 해 보세요.'; return; }
    state.request = request; state.lines = lines;
  } catch (e) {
    if (mine === seq) state.error = fixErrorText(e);
  } finally {
    if (mine === seq) { state.busy = ''; render(); }
  }
}

async function apply() {
  if (state.busy || !state.request) return;
  const request = state.request;
  state.busy = 'apply'; state.error = ''; render();
  try {
    const out = await rt.api('/rest/v1/rpc/app_apply_ledger_fix', { method: 'POST', body: { p_workspace_id: workspaceId(), p_request: request, p_dry_run: false }, singleFlight: false });
    const fix = typeof out?.fix_request_id === 'string' ? out.fix_request_id : null;
    const text = appliedText(out);
    state = fresh(); render();
    changedLedger();
    if (fix) offerUndoNotice({ text, ms: UNDO_MS, onUndo: async () => {
      try { await rt.api('/rest/v1/rpc/app_undo_ledger_fix', { method: 'POST', body: { p_fix_request_id: fix }, singleFlight: false }); }
      catch (e) { return { message: fixErrorText(e) }; }
      changedLedger();
      return { message: '되돌렸어요.' };
    } });
  } catch (e) {
    state.busy = ''; state.error = fixErrorText(e); render();
  }
}

// ---------- 그리기 ----------
function render() {
  const root = document.querySelector('#ledgerFixRoot');
  if (!root) return;
  root.dataset.ledgerFix = state.open ? (state.lines ? 'preview' : 'open') : 'closed';
  root.hidden = !state.open;
  if (!state.open) { root.innerHTML = ''; return; }
  if (!root.querySelector('[data-lf-shell]')) root.innerHTML = shellHtml();
  const title = root.querySelector('#lfTitle');
  title.textContent = state.target ? `내용 업데이트 · ${state.targetTitle || '이 기록'}` : '기록하기';
  root.querySelector('#lfText').placeholder = state.target ? '예: 기한을 11/5로 / 더 이상 추적 안 함 / 지켜졌음' : PLACEHOLDER_NEW;
  const area = root.querySelector('#lfText');
  if (area !== document.activeElement && area.value !== state.text) area.value = state.text;
  area.disabled = state.busy === 'apply';
  const run = root.querySelector('[data-lf-action="preview"]');
  run.disabled = !!state.busy;
  run.textContent = state.busy === 'preview' ? '만드는 중…' : '미리보기';
  run.setAttribute('aria-busy', String(state.busy === 'preview'));
  root.querySelector('#lfStatus').innerHTML = state.error ? `<p class="lg-error" role="alert" data-lf-error>${esc(state.error)}</p>`
    : state.note ? `<p class="lg-note" role="status" data-lf-note>${esc(state.note)}</p>` : '';
  root.querySelector('#lfPreview').innerHTML = state.lines ? `<div class="lf-preview" data-lf-preview>
      <ul class="lf-lines">${state.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
      <div class="lf-actions"><button type="button" class="primary" data-lf-action="apply"${state.busy ? ' disabled' : ''}>${state.busy === 'apply' ? '반영하는 중…' : '반영'}</button>
      <span class="lg-muted lf-hint">${state.request?.received_from === 'claude_chat' ? 'Claude 수정안' : '직접 기록'}으로 남아요</span></div></div>` : '';
}
function shellHtml() {
  return `<section class="lg-card lf-card" data-lf-shell aria-labelledby="lfTitle">
    <div class="lf-head"><h3 id="lfTitle" class="lf-h">기록하기</h3><button type="button" class="lg-text-btn lf-close" data-lf-action="close" aria-label="기록하기 닫기">✕</button></div>
    <label class="lg-sr" for="lfText">고칠 내용 또는 새로 넣을 내용</label>
    <textarea id="lfText" class="lf-text" rows="2" maxlength="60000" placeholder="${PLACEHOLDER_NEW}" autocomplete="off"></textarea>
    <div class="lf-row"><button type="button" class="secondary" data-lf-action="preview">미리보기</button><span class="lg-muted lf-hint">${FIX_TEXT_MAX}자까지 · 미리보기를 보고 [반영]해야 바뀌어요</span></div>
    <div id="lfStatus"></div>
    <div id="lfPreview"></div>
  </section>`;
}

// target: 기록 고정 ID(⋯ [고치기]), 없으면 새 기록([+ 기록하기]).
function open({ target = null, title = '' } = {}) {
  const t = typeof target === 'string' && LEDGER_ID.test(target) ? target : null;
  if (!state.open || state.target !== t) { seq++; state = { ...fresh(), open: true, target: t, targetTitle: String(title || '').slice(0, 60) }; }
  render();
  const root = document.querySelector('#ledgerFixRoot');
  root?.scrollIntoView?.({ block: 'nearest' });
  root?.querySelector('#lfText')?.focus?.({ preventScroll: true });
}
function close() { seq++; state = fresh(); render(); }

function bind() {
  if (bound) return;
  bound = true;
  const root = () => document.querySelector('#ledgerFixRoot');
  document.addEventListener('input', e => {
    if (e.target?.id !== 'lfText' || !root()?.contains(e.target)) return;
    state.text = e.target.value;
    // 입력을 고치면 앞서 본 미리보기는 더 이상 이 글의 것이 아니다.
    if (state.lines || state.error || state.note) { seq++; state.request = null; state.lines = null; state.error = ''; state.note = ''; state.busy = ''; render(); }
  });
  document.addEventListener('keydown', e => {
    if (e.target?.id !== 'lfText' || !root()?.contains(e.target)) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); void preview(); }
  });
  document.addEventListener('click', e => {
    const button = e.target.closest?.('[data-lf-action]');
    if (!button || !root()?.contains(button) || button.disabled) return;
    const action = button.dataset.lfAction;
    if (action === 'preview') void preview();
    else if (action === 'apply') void apply();
    else if (action === 'close') close();
  });
}

window.addEventListener('kptu:session-changed', () => { seq++; state = fresh(); render(); });
function boot() {
  bind();
  render();
  window.KPTULedgerFix = Object.freeze({ open, close });
  return true;
}
window.__KPTU_LEDGER_FIX_READY__ = Promise.resolve(boot());
