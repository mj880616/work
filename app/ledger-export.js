// AI-서버연동 S7-d: 원장 매주 Drive 내보내기(설계 docs/design/ledger-web2.md 9절).
// ① 매주 1회 자동: 소유자가 Web2를 열고 2분 뒤(시작 요청과 겹치지 않게, 한 탭에서 6시간에 한 번) drive-summary ?action=ledger_status를 보고
//    마지막 성공이 7일 넘었으면 ?action=ledger_export를 한 번 부른다. 화면 표시 없음, 실패는 조용히(다음 날 다시).
// ② 수동: [원장] 화면 #ledgerExportRoot 칸의 [지금 Drive로 내보내기]. 이 모듈이 그 칸의 유일한 renderer다.
// 원장 표는 service_role 권한이 없어 예약 실행(GitHub)이 원장을 읽을 수 없다. 그래서 내보내기는 이 앱(소유자 로그인 토큰)이 부른다.
// 요청에 본문 없음. 서버가 작업공간·소유자·폴더를 정한다. 응답의 내용·파일 ID는 그리지 않는다(시각·행 수·문서 링크만).
// 함수가 배포 전이면 상태 읽기가 405 → 칸을 숨기고 자동 실행도 하지 않는다.
import { ledgerFromStatus, exportDue, exportResult, failureText, CHECK_EVERY_MS, START_DELAY_MS } from './ledger-export-model.mjs';
import { formatSeoulTime } from './meeting-time.js';

const rt = window.KPTURuntime;
const STATUS = '/functions/v1/drive-summary?action=ledger_status';
const EXPORT = '/functions/v1/drive-summary?action=ledger_export';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DOC = /^https:\/\/docs\.google\.com\/document\/d\/[A-Za-z0-9_-]+\/edit$/;
const isOwner = () => {
  const c = rt?.context?.read?.(), s = rt?.session?.read?.();
  return !!s?.access_token && c?.user?.id === s?.user?.id && c?.workspace?.slug === 'kptu-work' && c?.membership?.role === 'owner';
};
const when = at => formatSeoulTime(at, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

let status = null, busy = false, message = '', link = '', lastCheck = 0, flight = null, started = false;

async function readStatus() {
  try { status = ledgerFromStatus(await rt.api(STATUS, { refreshSession: false, singleFlight: false, timeoutMs: 30000 })); }
  catch { status = null; }
  return status;
}

async function runExport() {
  let result;
  try { result = exportResult(await rt.api(EXPORT, { method: 'POST', refreshSession: false, singleFlight: false, timeoutMs: 150000 })); }
  catch { result = exportResult(null); }
  return result;
}

// ① 자동. 실패는 화면에 알리지 않는다(원장 원본은 그대로, 다음 날 또는 수동으로 다시).
async function autoCheck() {
  if (!started || !isOwner() || flight || busy || Date.now() - lastCheck < CHECK_EVERY_MS) return flight;
  lastCheck = Date.now();
  flight = (async () => {
    try {
      if (exportDue(await readStatus(), Date.now())) { await runExport(); await readStatus(); }
    } catch { /* 조용히 */ }
    finally { flight = null; render(); }
  })();
  return flight;
}

function render() {
  const root = document.querySelector('#ledgerExportRoot');
  if (!root) return;
  if (!status || !isOwner()) { root.hidden = true; root.innerHTML = ''; return; }
  const last = status.successAt !== null ? `마지막 내보내기 ${esc(when(status.successAt))}` : '아직 내보낸 적 없음';
  const failed = status.failedAt !== null && (status.successAt === null || status.failedAt > status.successAt)
    ? ` · <strong class="lg-error">최근 실패(${esc(when(status.failedAt))}): ${esc(failureText(status.code))}</strong>` : '';
  root.innerHTML = `<section class="lg-card" data-ledger-export aria-labelledby="leTitle">
    <h3 id="leTitle">Drive 내보내기</h3>
    <p class="lg-note">매주 한 번 Web2를 열 때 원장 전체를 Drive "Web2 읽기용 사본" 폴더로 자동 내보냅니다. 백업 JSON(최근 8개 보관)과 Claude가 읽는 문서 "원장 (읽기용 사본)"이 만들어집니다. 교섭·전략(S2) 기록은 문서에 제목만 싣습니다.</p>
    <p class="lg-note" data-le-last>${last}${failed}</p>
    <p><button type="button" class="lg-tool" data-le-action="export"${busy ? ' disabled' : ''}>${busy ? '내보내는 중…' : '지금 Drive로 내보내기'}</button></p>
    <p class="lg-note" role="status" data-le-message>${esc(message)}${link ? ` <a href="${esc(link)}" target="_blank" rel="noopener noreferrer">읽기용 문서 열기</a>` : ''}</p>
  </section>`;
  root.hidden = false;
}

async function manual() {
  if (busy || !isOwner()) return;
  busy = true; message = ''; link = ''; render();
  if (flight) await flight;
  // 실패 응답 본문은 runtime 오류에 남지 않는다 → 서버가 폴더에 적은 단계 코드(상태 읽기)로 안내한다.
  const data = await rt.api(EXPORT, { method: 'POST', refreshSession: false, singleFlight: false, timeoutMs: 150000 }).catch(() => null);
  const result = exportResult(data);
  await readStatus();
  if (result.ok) {
    message = `내보냈습니다(${when(result.at)}${result.records !== null ? `, 원장 기록 ${result.records}건` : ''}).`;
    link = DOC.test(String(data?.documents?.ledger || '')) ? data.documents.ledger : '';
  } else {
    const recorded = status && status.failedAt !== null && (status.successAt === null || status.failedAt > status.successAt) ? status.code : null;
    message = failureText(result.code === 'NOT_DEPLOYED' ? 'NOT_DEPLOYED' : recorded || result.code);
  }
  busy = false; render();
}

async function openView() {
  if (!isOwner()) { status = null; render(); return; }
  await readStatus();
  render();
}

function install() {
  if (window.KPTULedgerExport) return;
  document.addEventListener('click', e => {
    const button = e.target.closest?.('[data-le-action="export"]');
    if (!button || button.disabled || !document.querySelector('#ledgerExportRoot')?.contains(button)) return;
    void manual();
  });
  window.addEventListener('kptu:view-changed', e => { if (e.detail?.view === 'ledger') void openView(); });
  window.addEventListener('kptu:session-changed', () => { status = null; message = ''; link = ''; lastCheck = 0; render(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void autoCheck(); });
  window.KPTULedgerExport = Object.freeze({ open: openView, check: autoCheck });
  setTimeout(() => { started = true; void autoCheck(); }, START_DELAY_MS);
}

if (typeof window !== 'undefined' && rt) install();
window.__KPTU_LEDGER_EXPORT_READY__ = Promise.resolve(true);
