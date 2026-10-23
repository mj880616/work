// LIB-글자채우기야간: 홈 "예전 자료 글자 읽기 끝남 (N개)" 한 줄. 서버가 매일 밤 예전 자료의 파일 안 글자를 읽다가(drive-summary
// POST ?action=text_backfill, .github/workflows/library-text-nightly.yml) 남은 것이 없어지면 끝난 시각·읽은 수를 기록한다.
// 이 파일이 그 줄의 유일한 상태 소유자이자 렌더러다. 값은 홈 수집 칸과 같은 drive-summary GET ?action=status 한 번(collection-status.js
// readDriveStatus, 탭 메모리 10분)에서 받는다. ✕는 서버(POST ?action=text_backfill_dismiss, 소유자 JWT)에 닫은 시각을 남긴다 —
// 브라우저 저장소를 쓰지 않으므로 다른 기기에서도 다시 나오지 않는다. 함수가 아직 배포 전이거나 실패하면 줄은 조용히 숨는다.
import {isOwner, readDriveStatus, updateDriveStatus} from './collection-status.js';

export const DISMISS_PATH = '/functions/v1/drive-summary?action=text_backfill_dismiss';
const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;
const time = v => typeof v === 'string' && v.length <= 40 && ISO.test(v) && Number.isFinite(Date.parse(v)) ? v : null;

// status 응답 → {doneAt, count, dismissed} 또는 null(끝나지 않음·옛 함수·모양이 다름).
export function noticeFromStatus(data) {
  const t = data && data.ok === true && data.text_backfill && typeof data.text_backfill === 'object' && !Array.isArray(data.text_backfill) ? data.text_backfill : null;
  const doneAt = t ? time(t.done_at) : null;
  if (!doneAt) return null;
  return {doneAt, count:Number.isInteger(t.count) && t.count >= 0 ? t.count : null, dismissed:time(t.dismissed_at) !== null};
}
export const noticeText = notice => `예전 자료 글자 읽기 끝남${notice?.count === null || notice?.count === undefined ? '' : ` (${notice.count}개)`}`;

export function mountTextBackfillNotice(host, {rt = window.KPTURuntime} = {}) {
  if (!host) return null;
  host.hidden = true;
  let alive = true, run = 0, busy = false;
  const clear = () => { host.hidden = true; host.innerHTML = ''; };
  function paint(notice, failed = false) {
    if (!notice || notice.dismissed) return clear();
    host.innerHTML = `<span class="text-done-label">${noticeText(notice)}</span>${failed ? '<span class="text-done-failed">닫지 못함</span>' : ''}<button type="button" class="text-done-close" data-text-done-dismiss aria-label="알림 닫기">✕</button>`;
    host.hidden = false;
  }
  async function refresh() {
    if (!isOwner(rt)) { clear(); return; }
    const mine = ++run, data = await readDriveStatus(rt);
    if (!alive || mine !== run) return;
    paint(noticeFromStatus(data));
  }
  async function dismiss(button) {
    if (busy) return;
    busy = true; button.disabled = true;
    let ok = false;
    try {
      const data = await rt.api(DISMISS_PATH, {method:'POST', body:{}, refreshSession:false, singleFlight:false, timeoutMs:30000});
      ok = data?.ok === true && time(data.dismissed_at) !== null;
      if (ok) updateDriveStatus(rt, s => ({...s, text_backfill:s.text_backfill && {...s.text_backfill, dismissed_at:data.dismissed_at}}));
    } catch { ok = false; }
    busy = false;
    if (!alive) return;
    run++; // 늦게 온 상태 읽기가 닫은 줄을 되살리지 않게.
    if (ok) clear();
    else { const current = noticeFromStatus(await readDriveStatus(rt).catch(() => null)); paint(current || null, true); host.querySelector('[data-text-done-dismiss]')?.focus({preventScroll:true}); }
  }
  const onClick = event => { const b = event.target.closest?.('[data-text-done-dismiss]'); if (b && host.contains(b)) void dismiss(b); };
  host.addEventListener?.('click', onClick);
  return {refresh, destroy() { alive = false; run++; host.removeEventListener?.('click', onClick); }};
}
