// AI-서버연동 S7-d → LEDGER-자동기록 3단계(설계 docs/design/ledger-auto-record.md 6절): Claude용 원장 Drive 사본 자동 갱신.
// ① 원장이 바뀌면(자동 기록·되돌리기, kptu:ledger-changed) 10분 묶어 drive-summary ?action=ledger_export 한 번. 한 시간에 한 번을 넘지 않는다.
// ② 앱을 열고 2분 뒤(한 탭에서 6시간에 한 번) 상태를 보고, 마지막 성공이 하루 넘었고 그 뒤 원장이 바뀌었으면(또는 7일 넘었으면) 한 번.
// ③ [원장] 화면 맨 위 #ledgerExportRoot에 상태 한 줄만: 평소 "Claude용 사본 10/23 14:20 갱신", 멈췄을 때만 경고 + [다시 시도] 글자 링크.
//    [지금 Drive로 내보내기] 버튼과 칸은 없앴다(2026-10-24 결정). Drive 사본·백업 데이터는 그대로다. 이 모듈이 그 줄의 유일한 renderer다.
// 원장 표는 서버 키 권한이 없어 예약 실행(GitHub)이 원장을 읽을 수 없다. 그래서 내보내기는 이 앱(소유자 로그인 토큰)이 부른다.
// 요청에 본문 없음. 서버가 작업공간·소유자·폴더를 정한다. 함수가 배포 전이면 상태 읽기가 405 → 줄을 숨기고 자동 실행도 하지 않는다.
// 상태는 이 탭 메모리에만 있다(브라우저 저장소 없음). 실패는 화면 경고 한 줄 외에는 알리지 않는다.
import { ledgerFromStatus, exportDue, exportResult, failureText, copyState, nextExportDelay, CHECK_EVERY_MS, START_DELAY_MS } from './ledger-export-model.mjs';
import { formatSeoulTime } from './meeting-time.js';

const rt = window.KPTURuntime;
const STATUS = '/functions/v1/drive-summary?action=ledger_status';
const EXPORT = '/functions/v1/drive-summary?action=ledger_export';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isOwner = () => {
  const c = rt?.context?.read?.(), s = rt?.session?.read?.();
  return !!s?.access_token && c?.user?.id === s?.user?.id && c?.workspace?.slug === 'kptu-work' && c?.membership?.role === 'owner';
};
const when = at => formatSeoulTime(at, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const day = at => formatSeoulTime(at, { month: 'numeric', day: 'numeric' });
const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.+]+(Z|[+-]\d{2}:?\d{2})?$/;

let status = null, lastChangeAt = null, busy = false, lastCheck = 0, lastAttempt = null, flight = null, started = false, timer = null;

async function readStatus() {
  try { status = ledgerFromStatus(await rt.api(STATUS, { refreshSession: false, singleFlight: false, timeoutMs: 30000 })); }
  catch { status = null; }
  return status;
}
// 원장이 마지막으로 바뀐 시각(기록의 가장 늦은 updated_at, owner RLS 읽기). 못 읽으면 null(옛 7일 규칙만).
async function readLastChange() {
  const ws = rt?.context?.read?.()?.workspace?.id;
  if (!ws) return null;
  try {
    const rows = await rt.api(`/rest/v1/app_ledger_records?workspace_id=eq.${encodeURIComponent(ws)}&select=updated_at&order=updated_at.desc&limit=1`, { singleFlight: false });
    const at = Array.isArray(rows) && typeof rows[0]?.updated_at === 'string' && ISO.test(rows[0].updated_at) ? Date.parse(rows[0].updated_at) : NaN;
    lastChangeAt = Number.isFinite(at) ? Math.max(at, lastChangeAt ?? 0) : lastChangeAt;
  } catch { /* 모르면 그대로 */ }
  return lastChangeAt;
}

async function runExport() {
  lastAttempt = Date.now();
  let result;
  try { result = exportResult(await rt.api(EXPORT, { method: 'POST', refreshSession: false, singleFlight: false, timeoutMs: 150000 })); }
  catch { result = exportResult(null); }
  return result;
}
function once(job) {
  if (flight) return flight;
  flight = (async () => { try { await job(); } catch { /* 조용히 */ } finally { flight = null; render(); } })();
  return flight;
}

// ② 열 때 점검.
async function autoCheck() {
  if (!started || !isOwner() || flight || busy || Date.now() - lastCheck < CHECK_EVERY_MS) return flight;
  lastCheck = Date.now();
  return once(async () => {
    const [s, changed] = await Promise.all([readStatus(), readLastChange()]);
    if (exportDue(s, Date.now(), changed)) { await runExport(); await readStatus(); }
  });
}
// ① 원장이 바뀜 → 10분 묶어 한 번(한 시간 간격 지킴).
function changed() {
  if (!isOwner()) return;
  lastChangeAt = Date.now();
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (!isOwner()) return;
    if (flight) { changed(); return; }
    void once(async () => { if (!status) await readStatus(); if (!status) return; await runExport(); await readStatus(); });
  }, nextExportDelay(lastAttempt, Date.now()));
  render();
}

function render() {
  const root = document.querySelector('#ledgerExportRoot');
  if (!root) return;
  const state = isOwner() ? copyState(status, Date.now(), lastChangeAt) : null;
  if (!state) { root.hidden = true; root.innerHTML = ''; return; }
  let line;
  if (state.stalled) {
    const since = state.since !== null ? `${esc(day(state.since))}부터 ` : '';
    const why = state.code ? ` title="${esc(failureText(state.code))}"` : '';
    line = `<p class="lg-note lg-copy-line is-stalled" data-le-line="stalled" role="status"${why}><span aria-hidden="true">⚠</span> Claude용 사본이 ${since}멈췄어요 · <button type="button" class="lg-text-btn" data-le-action="retry"${busy || flight ? ' disabled' : ''}>${busy || flight ? '다시 하는 중…' : '다시 시도'}</button></p>`;
  } else {
    line = `<p class="lg-note lg-copy-line" data-le-line="ok">${state.at !== null ? `Claude용 사본 ${esc(when(state.at))} 갱신` : 'Claude용 사본 준비 중'}</p>`;
  }
  root.innerHTML = line;
  root.hidden = false;
}

async function retry() {
  if (busy || flight || !isOwner()) return;
  busy = true; render();
  await once(async () => { await runExport(); await readStatus(); });
  busy = false; render();
}

async function openView() {
  if (!isOwner()) { status = null; render(); return; }
  await Promise.all([readStatus(), readLastChange()]);
  render();
}

function install() {
  if (window.KPTULedgerExport) return;
  document.addEventListener('click', e => {
    const button = e.target.closest?.('[data-le-action="retry"]');
    if (!button || button.disabled || !document.querySelector('#ledgerExportRoot')?.contains(button)) return;
    void retry();
  });
  window.addEventListener('kptu:view-changed', e => { if (e.detail?.view === 'ledger') void openView(); });
  window.addEventListener('kptu:session-changed', () => {
    status = null; lastChangeAt = null; lastCheck = 0; lastAttempt = null;
    if (timer !== null) { clearTimeout(timer); timer = null; }
    render();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void autoCheck(); });
  window.KPTULedgerExport = Object.freeze({ open: openView, check: autoCheck, changed });
  setTimeout(() => { started = true; void autoCheck(); }, START_DELAY_MS);
}

if (typeof window !== 'undefined' && rt) install();
window.__KPTU_LEDGER_EXPORT_READY__ = Promise.resolve(true);
