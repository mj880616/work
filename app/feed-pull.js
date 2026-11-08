// S52-46 FEED-최신화즉시수집 3/3: 통화·텔레그램 화면 머리 줄의 작은 [최신화](공용 글자 버튼 ③ button.row-act, UI-버튼6가지)와 그 아래 한 줄.
// 누르면 drive-summary ?action=collector_pull 한 번 → 20초마다 화면의 기존 읽기 함수(reload)로 새 줄을 다시 읽고(최대 3분),
// 보내기 실행이 끝났다는 알림(status collectors.<출처>_send.reported_at)이 요청 뒤로 바뀌면 멈춘다. 상태는 이 부품 메모리뿐(기기 저장 없음).
// 운영자 확인·하루 20번·3분 간격은 서버가 한다(화면 숨김으로 막지 않음). 그리는 것은 각 화면의 renderer가 html()로 한다(새 그리기 주인 없음).
import {PULL_PATH, STATUS_PATH, PULL_POLL_MS, PULL_POLL_MAX, PULL_TEXT, pullFailText, pullErrorCode, pullAccepted, pullFinished, pullDoneText} from './feed-pull-model.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

/** @param {{source:'telegram'|'call', rt:any, scope:()=>string, reload:()=>Promise<void>|void, paint:()=>void, attr:string, wait?:(ms:number)=>Promise<void>}} o */
export function createFeedPull({source, rt, scope, reload, paint, attr, wait = ms => new Promise(r => setTimeout(r, ms))}) {
  let busy = false, text = '', owner = '', run = 0;
  const live = (me, who) => me === run && who === scope();
  async function start() {
    if (busy) return;
    const me = ++run, who = scope();
    busy = true; owner = who; text = PULL_TEXT.busy; paint();
    let requestedAt = null;
    try {
      requestedAt = pullAccepted(await rt.api(PULL_PATH, {method: 'POST', body: {source}, refreshSession: true, singleFlight: false, timeoutMs: 30000}), source);
      if (!requestedAt) throw new Error('');
    } catch (error) {
      if (!live(me, who)) return;
      busy = false; text = pullFailText(pullErrorCode(error)); paint(); return;
    }
    if (!live(me, who)) return;
    text = PULL_TEXT.sent; paint();
    for (let i = 0; i < PULL_POLL_MAX; i++) {
      await wait(PULL_POLL_MS);
      if (!live(me, who)) return;
      await Promise.resolve(reload()).catch(() => {});
      if (!live(me, who)) return;
      const status = await rt.api(STATUS_PATH, {refreshSession: false, singleFlight: false, timeoutMs: 30000}).catch(() => null);
      if (!live(me, who)) return;
      const done = pullFinished(status, source, requestedAt);
      if (done) { busy = false; text = pullDoneText(source, done.upstreamAt); paint(); return; }
    }
    busy = false; text = PULL_TEXT.late; paint();
  }
  // 다른 계정으로 바뀌면 진행 중인 다시 읽기를 멈추고 줄을 지운다.
  const current = () => (owner && owner !== scope() ? (run++, busy = false, text = '', owner = '', false) : true);
  return {
    start,
    button: () => (current(), `<button type="button" class="row-act" ${attr}${busy ? ' disabled aria-busy="true"' : ''}>최신화</button>`),
    line: () => (current() && text ? `<p class="feed-note" data-feed-pull="${source}" role="status">${esc(text)}</p>` : ''),
    get busy() { return busy; },
    get text() { return text; },
  };
}
