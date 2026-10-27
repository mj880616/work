// LIB-이전파일정리: 매일 예약 실행(.github/workflows/library-prev-prune.yml)이 부르는 스크립트.
// drive-summary POST ?action=library_prev_prune[&dry_run=1]을 x-drive-summary-cron-secret 헤더로 한 번 부른다.
// 비밀값은 환경변수로만 받고 출력하지 않는다. 응답은 건수·단계 코드만 읽고, 파일 이름은 받지도 출력하지도 않는다.
export const BASE_URL = 'https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/drive-summary?action=library_prev_prune';
const STAGE = /^[A-Z][A-Z0-9_]{0,63}$/;
const COUNT = value => (Number.isInteger(value) && value >= 0 ? value : null);
const KEYS = ['documents', 'entries', 'pruned', 'kept', 'waiting', 'due', 'no_date'];
const REAL = ['trashed', 'already_trashed', 'list_only', 'referenced', 'retry', 'unknown', 'conflict', 'deferred'];
const DRY = ['would_trash', 'would_list_only', 'already_trashed', 'referenced', 'retry', 'not_checked', 'over_cap'];

export class PruneFailure extends Error {
  constructor(message, { retryable = false } = {}) { super(message); this.name = 'PruneFailure'; this.retryable = retryable; }
}

async function once({ secret, fetcher, url, timeoutMs, dryRun }) {
  let response;
  try {
    response = await fetcher(url, { method: 'POST', headers: { 'x-drive-summary-cron-secret': secret }, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new PruneFailure('이전 파일 정리 요청이 서버에 닿지 않았습니다(네트워크·시간 초과).', { retryable: true });
  }
  let data = null;
  try { data = await response.json(); } catch { /* JSON이 아니면 아래에서 실패 */ }
  const stage = typeof data?.error === 'string' && STAGE.test(data.error) ? data.error : null;
  if (response.status === 401) throw new PruneFailure('비밀값 불일치: Supabase Edge Function 비밀값 DRIVE_SUMMARY_CRON_SECRET이 등록되지 않았거나 GitHub 비밀값과 다릅니다.');
  if (!response.ok || data?.ok !== true) {
    throw new PruneFailure(`이전 파일 정리 실패: HTTP ${response.status}${stage ? `, 단계 ${stage}` : ''}`, { retryable: response.status >= 500 && stage !== 'SERVER_CONFIG_MISSING' });
  }
  if ((data.dry_run === true) !== dryRun) throw new PruneFailure('응답의 시험 실행 여부가 요청과 다릅니다(함수가 아직 이 기능 전 판일 수 있음).');
  const counts = {};
  for (const key of [...KEYS, ...(dryRun ? DRY : REAL)]) {
    const value = COUNT(data[key]);
    if (value === null) throw new PruneFailure('이전 파일 정리 응답에 건수가 없습니다(함수가 아직 이 기능 전 판일 수 있음).');
    counts[key] = value;
  }
  return counts;
}

// 네트워크·서버(5xx) 오류만 한 번 다시 시도한다. 쓰기 쪽은 서버가 이미 한 일을 다음 호출에서 다시 확인하므로 겹쳐도 안전하다.
export async function runPrune({ secret, dryRun = false, fetcher = fetch, url = BASE_URL, timeoutMs = 170000, retryDelayMs = 60000, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  if (typeof secret !== 'string' || !secret.trim()) throw new PruneFailure('비밀값 미등록: GitHub 저장소 Actions 비밀값 DRIVE_SUMMARY_CRON_SECRET이 없습니다.');
  const target = dryRun ? `${url}&dry_run=1` : url;
  const options = { secret, fetcher, url: target, timeoutMs, dryRun };
  try { return await once(options); } catch (error) {
    if (!(error instanceof PruneFailure) || !error.retryable) throw error;
    await sleep(retryDelayMs);
    return once(options);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const dryRun = process.env.DRY_RUN === '1';
    const c = await runPrune({ secret: process.env.DRIVE_SUMMARY_CRON_SECRET, dryRun });
    if (dryRun) {
      console.log(`[시험 실행: 아무것도 바꾸지 않음] 이전 파일이 있는 자료 ${c.documents}개, 이전 파일 ${c.entries}개 (정리됨 ${c.pruned} · 보관 ${c.kept} · 기다리는 중 ${c.waiting})`);
      console.log(`30일 지난 것 ${c.due}개: 휴지통으로 갈 것 ${c.would_trash} · 목록에서만 뺄 것(Web2가 올린 파일 아님) ${c.would_list_only} · 이미 휴지통 ${c.already_trashed} · 다른 곳에서도 쓰는 중이라 건너뜀 ${c.referenced} · 확인 못 함(오류) ${c.retry} · 확인 안 함(한도) ${c.not_checked}`);
      console.log(`하룻밤 한도(50개)를 넘어 며칠에 나눠 처리될 것 ${c.over_cap}개`);
    } else {
      console.log(`이전 파일 정리: 30일 지난 것 ${c.due}개 중 휴지통으로 ${c.trashed} · 이미 휴지통이라 기록만 ${c.already_trashed} · 목록에서만 뺌 ${c.list_only} · 다른 곳에서 쓰는 중 ${c.referenced} · 다음 날 다시 ${c.retry + c.unknown} · 한도로 미룸 ${c.deferred}`);
      if (c.conflict > 0) console.log(`::warning title=이전 파일 정리::기록이 다른 수정과 겹친 자료 ${c.conflict}개(다음 실행에서 다시 맞춤)`);
    }
  } catch (error) {
    const message = error instanceof PruneFailure ? error.message : '이전 파일 정리 실패(예상하지 못한 오류)';
    console.log(`::error title=이전 파일 정리::${message}`);
    process.exitCode = 1;
  }
}
