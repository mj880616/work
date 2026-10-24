// LEDGER-자동기록 3단계(앱, docs/design/ledger-auto-record.md 3.1·5.2절): 저장 뒤 원장 자동 기록을 부른다. 화면 표시·버튼 없음.
// - 재료 여섯(업데이트·노트·업무일지 한 줄·사업 보고·담당조직 기록·프로젝트 기록)의 성공 저장(kptu:api-saved, 경로·방법만)을 받아
//   마지막 저장 10분 뒤(처음 저장부터 길어도 30분) ai-assist {kind:"ledger_auto"} 한 번. 원문·ID는 보내지 않는다(서버가 로그인 토큰으로 읽음).
// - 앱을 열고 3분 뒤 한 번: 탭을 닫아 놓친 저장은 서버 처리 표(app_ledger_auto_sources)가 기억하므로 여기서 이어서 처리된다.
// - 화면이 가려지거나 닫히면 기다리던 묶음을 keepalive 요청으로 바로 보낸다.
// - 서버가 배포 전(unsupported_kind·404)이거나 DB 함수가 없으면(ledger_not_ready) 이 탭에서는 끄고 조용히 넘어간다(console 한 줄).
//   저장 흐름은 이 모듈과 무관하게 이미 끝났다(구독자는 저장 결과를 바꾸지 못함).
// - 원장이 바뀌면 kptu:ledger-changed(목록 다시 읽기)와 KPTULedgerExport.changed()(Drive 사본 자동 갱신 예약)를 알린다.
// 상태는 이 탭 메모리에만 있다(브라우저 저장소 없음).
import { affectsLedger, createAutoBatcher, START_DELAY_MS } from './ledger-auto-model.mjs';
import { callAiAssist, AI_SUMMARY_PATH, AI_SUMMARY_TEXT } from './basket-ai-summary.js';

const AUTO_TIMEOUT_MS = 120000;
// 이 흐름이 따로 아는 서버 코드(문구는 쓰지 않음, 화면 표시 없음).
const CODES = Object.freeze({ ...AI_SUMMARY_TEXT, ledger_busy: '', ledger_record_failed: '' });

function install(win) {
  const rt = win.KPTURuntime;
  if (!rt || win.KPTULedgerAuto) return;
  const owner = () => {
    const c = rt.context?.read?.(), s = rt.session?.read?.();
    return !!s?.access_token && c?.user?.id === s?.user?.id && c?.workspace?.slug === 'kptu-work' && c?.membership?.role === 'owner';
  };
  const call = async ({ leaving }) => {
    if (!leaving) return callAiAssist({ kind: 'ledger_auto' }, { rt, timeoutMs: AUTO_TIMEOUT_MS }, CODES);
    const token = rt.session.read()?.access_token;
    if (!token) return { ok: false, code: 'session_required' };
    await fetch(rt.config.url + AI_SUMMARY_PATH, { method: 'POST', cache: 'no-store', keepalive: true,
      headers: { apikey: rt.config.key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'ledger_auto' }) });
    return { ok: true, data: { skipped: true } };
  };
  const batcher = createAutoBatcher({
    call, isOwner: owner,
    log: line => console.warn(line),
    onDone: () => {
      try { win.dispatchEvent(new CustomEvent('kptu:ledger-changed', { detail: { source: 'auto' } })); } catch { /* 목록 다시 읽기는 다음 열기에 */ }
      win.KPTULedgerExport?.changed?.();
    },
  });
  win.KPTULedgerAuto = Object.freeze({ saved: batcher.saved, isOff: batcher.isOff });
  win.addEventListener('kptu:api-saved', event => { if (owner() && affectsLedger(event.detail, rt.config.url)) batcher.saved(); });
  win.addEventListener('kptu:session-changed', () => { batcher.reset(); });
  win.document?.addEventListener('visibilitychange', () => { if (win.document.visibilityState === 'hidden') batcher.flush(); });
  win.addEventListener('pagehide', () => batcher.flush());
  setTimeout(() => batcher.opened(), START_DELAY_MS);
}

if (typeof window !== 'undefined') install(window);
