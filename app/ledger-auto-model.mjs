// LEDGER-자동기록 3단계(앱, docs/design/ledger-auto-record.md 3.1·5.2·6절): 저장 뒤 원장 자동 기록 호출의 순수 판단. DOM·네트워크 없음.
// - 무엇이 "재료 저장"인가(affectsLedger), 몇 분 모아 한 번 부르는 묶음(createAutoBatcher), 서버 답 해석(autoOutcome).
// - 상태는 이 탭 메모리에만 둔다(브라우저 저장소 없음). "아직 안 본 기록"은 서버 처리 표(app_ledger_auto_sources)가 정하므로
//   탭을 닫아 놓친 저장은 다음에 앱을 열 때 한 번 부르는 것으로 이어서 처리된다(서버 저장 기준).
export const WAIT_MS = 10 * 60 * 1000;      // 마지막 저장 10분 뒤(결정 ④)
export const MAX_WAIT_MS = 30 * 60 * 1000;  // 처음 저장부터 길어도 30분
export const RETRY_MS = 10 * 60 * 1000;     // 잠깐 실패(바쁨·시간 초과)면 10분 뒤 한 번만 다시
export const MAX_RETRIES = 1;
export const START_DELAY_MS = 3 * 60 * 1000; // 앱을 연 뒤 3분 기다렸다 밀린 것 한 번(시작 요청·사본 내보내기 확인과 겹치지 않게)

// 재료 여섯(업데이트·노트·업무일지 한 줄 = app_notes, 사업 보고 = app_meetings, 담당조직 기록, 프로젝트 기록)의 표.
// 서버(ai-assist ledger_auto)가 읽는 표와 같다. 일기·보관·AI 내보내기 비허용은 서버가 뺀다(여기서 거르지 않아도 AI를 부르지 않음).
export const LEDGER_SOURCE_TABLES = Object.freeze(['app_notes', 'app_meetings', 'app_suborganization_updates', 'app_project_progress_updates']);

// saved = kptu:api-saved detail(경로·방법·바뀐 열 이름만, 원문 없음). 지우기는 새로 볼 것이 없어 부르지 않는다.
export function affectsLedger(saved, baseUrl) {
  if (!saved || typeof saved.path !== 'string') return false;
  let url;
  try { url = new URL(saved.path, baseUrl); } catch { return false; }
  if (url.origin !== new URL(baseUrl).origin) return false;
  const method = String(saved.method || '').toUpperCase();
  if (!['POST', 'PATCH', 'PUT'].includes(method)) return false;
  if (!url.pathname.startsWith('/rest/v1/')) return false;
  const table = url.pathname.slice('/rest/v1/'.length);
  return LEDGER_SOURCE_TABLES.includes(table);
}

// 서버 답(callAiAssist 결과) → 다음 할 일.
//   done: 실행이 끝남(changed = 원장이 바뀜 → 목록 다시 읽기·Drive 사본 갱신 예약)
//   retry: 잠깐 실패 → 한 번만 다시
//   off: 이 탭에서는 더 부르지 않음(서버·DB 배포 전, 한도, 로그인 없음). 저장 흐름은 막지 않는다.
//   drop: 이번 묶음만 버림(다음 저장이 다시 부름)
const OFF = new Set(['not_ready', 'unsupported_kind', 'ledger_not_ready', 'ai_not_configured', 'daily_limit', 'monthly_limit', 'forbidden', 'session_required']);
const RETRY = new Set(['ai_busy', 'ai_timeout', 'ledger_busy', 'ledger_unavailable', 'usage_unavailable', 'read_unavailable', 'offline']);
const COUNTS = ['records_new', 'changes_linked', 'sources_added', 'needs_check'];
export function autoOutcome(r) {
  if (r && r.ok === true) {
    const d = r.data || {};
    if (d.skipped === true) return { action: 'done', changed: false, runId: null };
    const changed = COUNTS.some(k => Number.isInteger(d[k]) && d[k] > 0);
    const runId = typeof d.run_id === 'string' && /^[0-9a-f-]{36}$/i.test(d.run_id) ? d.run_id : null;
    return { action: 'done', changed, runId };
  }
  const code = typeof r?.code === 'string' ? r.code : 'internal_error';
  if (OFF.has(code)) return { action: 'off', code };
  if (RETRY.has(code)) return { action: 'retry', code };
  return { action: 'drop', code };
}

// 묶기: 저장마다 기다림을 다시 세되 처음 저장부터 maxWaitMs를 넘기지 않는다. 한 번에 하나만 부르고,
// 부르는 동안 들어온 저장은 끝난 뒤 한 번 더 묶는다. 잠깐 실패면 retryMs 뒤 maxRetries번만 다시(반복 실행 아님).
// 서버가 없거나 한도에 닿으면 이 탭에서는 끈다(off). 실패는 log 한 줄만 남기고 던지지 않는다.
export function createAutoBatcher({ call, isOwner, onDone = () => {}, log = () => {}, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout,
  waitMs = WAIT_MS, maxWaitMs = MAX_WAIT_MS, retryMs = RETRY_MS, maxRetries = MAX_RETRIES }) {
  let timer = null, firstAt = null, flight = null, dirty = false, off = false, retries = 0, generation = 0;
  const cancel = () => { if (timer !== null) clearTimer(timer); timer = null; };
  const arm = delay => { cancel(); timer = setTimer(() => { timer = null; void run(); }, Math.max(0, delay)); };
  const armWait = () => arm(Math.min(waitMs, firstAt + maxWaitMs - now()));
  function saved() {
    if (off || !isOwner()) return;
    dirty = true;
    if (firstAt === null) firstAt = now();
    if (!flight) armWait();
  }
  // 앱을 열 때: 밀린 것(서버 처리 표 기준)을 한 번 보게 한다.
  function opened() { if (off || !isOwner()) return; dirty = true; if (firstAt === null) firstAt = now(); if (!flight && timer === null) arm(0); }
  async function run(leaving = false) {
    if (flight || !dirty || off) return flight;
    if (!isOwner()) { reset(); return null; }
    cancel(); dirty = false; firstAt = null;
    const epoch = generation;
    flight = (async () => {
      let result;
      try { result = await call({ leaving }); } catch { result = { ok: false, code: 'internal_error' }; }
      if (epoch !== generation) return;
      const out = leaving ? { action: 'done', changed: false, runId: null } : autoOutcome(result);
      if (out.action === 'done') { retries = 0; if (out.changed) { try { onDone(out); } catch { /* 화면 갱신 실패는 기록 결과를 바꾸지 않는다 */ } } }
      else if (out.action === 'off') { off = true; log(`ledger_auto_off:${out.code}`); }
      else if (out.action === 'retry' && retries < maxRetries) { retries++; dirty = true; log(`ledger_auto_retry:${out.code}`); }
      else { retries = 0; log(`ledger_auto_skip:${out.code}`); }
    })().finally(() => {
      flight = null;
      if (epoch !== generation || off || !dirty || !isOwner()) return;
      if (retries > 0 && timer === null) arm(retryMs);
      else { firstAt ??= now(); armWait(); }
    });
    return flight;
  }
  // 화면이 가려지거나 닫힐 때 기다리던 묶음을 바로 보낸다(keepalive). 답은 기다리지 않는다.
  function flush() { if (timer !== null && !flight && dirty && !off) void run(true); }
  function reset() { cancel(); dirty = false; firstAt = null; retries = 0; off = false; generation++; }
  return { saved, opened, flush, reset, run, pending: () => timer !== null || dirty, busy: () => !!flight, isOff: () => off };
}
