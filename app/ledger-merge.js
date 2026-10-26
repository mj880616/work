// MTG-기록겹침거르기 5단계(화면 ③, docs/design/record-overlap.md 4.3절): [원장] 화면 목록 위 "겹친 기록 n건" 칸(#ledgerMergeRoot). 이 모듈이 그 칸의 유일한 renderer다.
// - 겹침 표(app_record_overlaps)의 same 짝이 원장의 서로 다른 두 기록에 각각 걸려 있으면 한 줄로 합치자고 보인다(두 기록과 출처를 나란히). AI 호출 없음.
// - [합치기] → 해 보기(app_apply_ledger_fix p_dry_run=true)로 미리 확인 → [반영] 한 번 = 같은 요청을 한 번(남길 기록에 근거 추가 + 합쳐진 기록 폐기, 지우지 않음).
//   반영 직후 10초 [되돌리기], 그 뒤에는 "합친 기록 n건"에서 [합침 취소](app_undo_ledger_fix). 쓰기는 기존 수정 요청 함수 둘뿐이다(새 DB 함수·권한 없음).
// - 읽기는 소유자 RLS REST뿐. 겹침 표·원장 표가 없으면(404) 칸을 조용히 숨긴다. 상태는 이 탭 메모리에만 있다(브라우저 저장소 없음).
import { samePairs, locationsOf, mergeCandidates, mergeRequest, previewText, dryRunMatches, recentMerges, originLabel, kindLabel, sideLabel, MERGE_TEXT } from './ledger-merge-model.mjs';
import { fixErrorText, UNDO_MS } from './ledger-fix-model.mjs';
import { offerUndoNotice } from './basket-record-delete.js';

const rt = window.KPTURuntime;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const q = v => encodeURIComponent(v);
const workspaceId = () => rt?.context?.read?.()?.workspace?.id || null;
const isMissing = e => e?.status === 404 || /PGRST20[25]|42P01|42883|schema cache/i.test(String(e?.message || ''));
const CHUNK = 40;
const LIVE = 'validity=in.(current,needs_check,fulfilled)';

let state = fresh();
let seq = 0;
let bound = false;
function fresh() { return { phase: 'idle', candidates: [], recent: [], names: new Map(), open: '', preview: null, busy: '', error: '' }; }

const read = path => rt.api(path, { singleFlight: false });
const rowsOf = async path => { const rows = await read(path); if (!Array.isArray(rows)) throw new Error('read'); return rows; };
async function chunked(values, make) {
  const out = [];
  const list = [...new Set(values)];
  for (let i = 0; i < list.length; i += CHUNK) out.push(...await rowsOf(make(list.slice(i, i + CHUNK).map(q).join(','))));
  return out;
}

async function readCandidates(ws) {
  const overlaps = await rowsOf(`/rest/v1/app_record_overlaps?workspace_id=eq.${ws}&verdict=eq.same&select=a_ref,b_ref,verdict,decided_by&order=updated_at.desc&limit=200`);
  const pairs = samePairs(overlaps);
  if (!pairs.length) return [];
  const first = await chunked(locationsOf(pairs), ids => `/rest/v1/app_ledger_sources?workspace_id=eq.${ws}&status=eq.active&location=in.(${ids})&select=id,ledger_id,location,status&limit=1000`);
  if (!first.length) return [];
  const firstLinks = await chunked(first.map(s => s.id), ids => `/rest/v1/app_ledger_record_sources?workspace_id=eq.${ws}&source_id=in.(${ids})&select=record_id,source_id&limit=1000`);
  const records = await chunked(firstLinks.map(l => l.record_id), ids => `/rest/v1/app_ledger_records?workspace_id=eq.${ws}&id=in.(${ids})&${LIVE}&select=id,ledger_id,kind,title,validity&limit=1000`);
  if (records.length < 2) return [];
  const links = await chunked(records.map(r => r.id), ids => `/rest/v1/app_ledger_record_sources?workspace_id=eq.${ws}&record_id=in.(${ids})&select=record_id,source_id&limit=2000`);
  const sources = await chunked(links.map(l => l.source_id), ids => `/rest/v1/app_ledger_sources?workspace_id=eq.${ws}&id=in.(${ids})&select=id,ledger_id,location,status&limit=2000`);
  return mergeCandidates({ pairs, records, links, sources });
}

async function readRecent(ws) {
  const rows = await rowsOf(`/rest/v1/app_ledger_fix_requests?workspace_id=eq.${ws}&status=eq.applied&select=id,applied_at,request&order=applied_at.desc&limit=40`);
  const recent = recentMerges(rows);
  const names = new Map();
  if (recent.length) {
    const ids = recent.flatMap(r => [r.keep, r.drop]);
    for (const r of await chunked(ids, list => `/rest/v1/app_ledger_records?workspace_id=eq.${ws}&ledger_id=in.(${list})&select=ledger_id,title&limit=200`)) if (typeof r?.ledger_id === 'string') names.set(r.ledger_id, r.title);
  }
  return { recent, names };
}

async function load() {
  const ws = workspaceId();
  if (!ws || !document.querySelector('#ledgerMergeRoot')) return;
  const mine = ++seq;
  try {
    const candidates = await readCandidates(q(ws));
    const { recent, names } = await readRecent(q(ws));
    if (mine !== seq) return;
    const keep = state.open && candidates.some(c => c.key === state.open) ? { open: state.open, preview: state.preview } : { open: '', preview: null };
    state = { ...fresh(), phase: 'ready', candidates, recent, names, ...keep };
  } catch (e) {
    if (mine !== seq) return;
    state = { ...fresh(), phase: isMissing(e) ? 'hidden' : 'failed' };
  }
  render();
}

const changedLedger = () => {
  try { window.dispatchEvent(new CustomEvent('kptu:ledger-changed', { detail: { source: 'merge' } })); } catch { /* 다음 열기에 */ }
  window.KPTULedgerExport?.changed?.();
};

async function dryRun(request) {
  return rt.api('/rest/v1/rpc/app_apply_ledger_fix', { method: 'POST', body: { p_workspace_id: workspaceId(), p_request: request, p_dry_run: true }, singleFlight: false });
}
const find = key => state.candidates.find(c => c.key === key);

async function startMerge(key) {
  const c = find(key);
  if (!c || state.busy) return;
  const request = mergeRequest(c);
  if (!request) return;
  const mine = ++seq;
  state.busy = 'preview'; state.error = ''; state.open = key; state.preview = null; render();
  try {
    const dry = await dryRun(request);
    if (mine !== seq) return;
    if (!dryRunMatches(dry, request)) { state.error = MERGE_TEXT.failed; state.open = ''; return; }
    state.preview = { key, request, line: previewText(c) };
  } catch (e) {
    if (mine === seq) { state.error = fixErrorText(e); state.open = ''; }
  } finally {
    if (mine === seq) { state.busy = ''; render(); }
  }
}

async function applyMerge() {
  const p = state.preview;
  if (!p || state.busy) return;
  state.busy = 'apply'; state.error = ''; render();
  let fix = null;
  try {
    const out = await rt.api('/rest/v1/rpc/app_apply_ledger_fix', { method: 'POST', body: { p_workspace_id: workspaceId(), p_request: p.request, p_dry_run: false }, singleFlight: false });
    fix = typeof out?.fix_request_id === 'string' ? out.fix_request_id : null;
  } catch (e) {
    state.busy = ''; state.error = fixErrorText(e); render(); return;
  }
  state.busy = ''; state.open = ''; state.preview = null; render();
  changedLedger();
  if (fix) offerUndoNotice({ text: MERGE_TEXT.applied, ms: UNDO_MS, onUndo: () => undoFix(fix) });
}

async function undoFix(fix) {
  try { await rt.api('/rest/v1/rpc/app_undo_ledger_fix', { method: 'POST', body: { p_fix_request_id: fix }, singleFlight: false }); }
  catch (e) { return { message: fixErrorText(e) }; }
  changedLedger();
  return { message: MERGE_TEXT.undone };
}

async function undoRecent(fix) {
  if (state.busy || !state.recent.some(r => r.fixId === fix)) return;
  state.busy = 'undo'; state.error = ''; render();
  const result = await undoFix(fix);
  state.busy = '';
  if (result.message !== MERGE_TEXT.undone) state.error = result.message;
  render();
}

// ---------- 그리기 ----------
function sideHtml(side) {
  const origin = originLabel(side);
  return `<div class="lm-side"><span class="lm-kind">${esc(kindLabel(side.kind))}</span><span class="lm-title">${esc(sideLabel(side))}</span>${origin ? `<span class="lg-muted lm-origin">${esc(origin)}</span>` : ''}</div>`;
}
function candidateHtml(c) {
  const open = state.open === c.key;
  const busy = !!state.busy;
  const preview = open && state.preview ? `<div class="lf-preview" data-lm-preview><p class="lm-line">${esc(state.preview.line)}</p>
      <div class="lf-actions"><button type="button" class="primary" data-lm-action="apply"${busy ? ' disabled' : ''}>${state.busy === 'apply' ? '반영하는 중…' : MERGE_TEXT.apply}</button>
      <button type="button" class="lg-text-btn" data-lm-action="cancel"${busy ? ' disabled' : ''}>${MERGE_TEXT.cancel}</button></div></div>` : '';
  const action = open && state.preview ? '' : `<button type="button" class="secondary" data-lm-action="merge" data-lm-key="${esc(c.key)}"${busy ? ' disabled' : ''}>${open && state.busy === 'preview' ? MERGE_TEXT.working : MERGE_TEXT.merge}</button>`;
  return `<li class="lm-item" data-lm-item="${esc(c.key)}"><div class="lm-pair">${sideHtml(c.keep)}<span class="lm-same" aria-hidden="true">=</span>${sideHtml(c.drop)}</div>${action}${preview}</li>`;
}
function recentHtml(r) {
  const name = id => esc(clip(state.names.get(id)) || id);
  return `<li class="lm-item lm-recent" data-lm-recent="${esc(r.fixId)}"><span class="lm-title">${name(r.keep)} ← ${name(r.drop)}</span><button type="button" class="lg-text-btn" data-lm-action="undo" data-lm-fix="${esc(r.fixId)}"${state.busy ? ' disabled' : ''}>${MERGE_TEXT.undo}</button></li>`;
}
const clip = v => { const chars = [...String(v ?? '').replace(/\s+/g, ' ').trim()]; return chars.length > 40 ? chars.slice(0, 39).join('') + '…' : chars.join(''); };

function render() {
  const root = document.querySelector('#ledgerMergeRoot');
  if (!root) return;
  const show = state.phase === 'ready' && (state.candidates.length || state.recent.length);
  root.hidden = !show;
  root.dataset.ledgerMerge = show ? 'ready' : state.phase;
  if (!show) { root.innerHTML = ''; return; }
  const wasOpen = { cand: root.querySelector('[data-lm-group="cand"]')?.open, recent: root.querySelector('[data-lm-group="recent"]')?.open };
  const cand = state.candidates.length ? `<details class="lm-group" data-lm-group="cand"${wasOpen.cand || state.open ? ' open' : ''}><summary class="lm-summary">${esc(MERGE_TEXT.summary(state.candidates.length))}</summary><ul class="lm-list">${state.candidates.map(candidateHtml).join('')}</ul></details>` : '';
  const recent = state.recent.length ? `<details class="lm-group" data-lm-group="recent"${wasOpen.recent ? ' open' : ''}><summary class="lm-summary">${esc(MERGE_TEXT.recent(state.recent.length))}</summary><ul class="lm-list">${state.recent.map(recentHtml).join('')}</ul></details>` : '';
  root.innerHTML = `<section class="lg-card lm-card" aria-label="겹친 기록">${cand}${recent}${state.error ? `<p class="lg-error" role="alert" data-lm-error>${esc(state.error)}</p>` : ''}</section>`;
}

function bind() {
  if (bound) return;
  bound = true;
  document.addEventListener('click', e => {
    const button = e.target.closest?.('[data-lm-action]');
    const root = document.querySelector('#ledgerMergeRoot');
    if (!button || !root?.contains(button) || button.disabled) return;
    const action = button.dataset.lmAction;
    if (action === 'merge') void startMerge(button.dataset.lmKey);
    else if (action === 'apply') void applyMerge();
    else if (action === 'cancel') { seq++; state.open = ''; state.preview = null; state.error = ''; state.busy = ''; render(); }
    else if (action === 'undo') void undoRecent(button.dataset.lmFix);
  });
  window.addEventListener('kptu:ledger-changed', () => { if (document.querySelector('#ledgerMergeRoot')) void load(); });
  window.KPTURouter?.on?.('ledger', () => { void load(); }); // 원장 화면을 다시 열 때마다 새로 읽는다
}

window.addEventListener('kptu:session-changed', () => { seq++; state = fresh(); render(); if (document.querySelector('#ledgerMergeRoot') && workspaceId()) void load(); });
function boot() {
  bind();
  render();
  window.KPTULedgerMerge = Object.freeze({ reload: load });
  void load();
  return true;
}
window.__KPTU_LEDGER_MERGE_READY__ = Promise.resolve(boot());
