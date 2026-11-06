// LOAD-끝있는불러오기(S51-29, 요청함 11/06 23:31 ★급★): 모든 불러오기는 끝이 있다 — 공용 도우미 한 곳.
// - within(task, ms): task(약속 또는 signal을 받는 함수)가 ms 안에 끝나지 않으면 LoadTimeout으로 끝낸다.
//   함수로 주면 AbortSignal을 넘겨, 시간이 지나면 그 요청(fetch 등)도 끊는다. 늦게 온 답은 버린다(호출한 쪽은 이미 실패로 끝남).
// - isLoadTimeout(error): 시간 한도로 끝난 실패인지(자동으로 한 번 다시 할지 정할 때).
// - onResume(fn): 화면이 다시 보이거나(앱이 다시 앞에 옴 = visibilitychange visible) 뒤로가기 캐시에서 돌아올 때(pageshow) fn을 부른다.
//   멈춘·실패한 불러오기를 다시 시작하는 데 쓴다. 1초 안에 겹쳐 오면 한 번만.
// 화면 표시(회색 빈 줄·'불러오지 못했습니다 · [다시]')는 wait-state.js 하나가 그린다. 이 파일은 '끝'만 책임진다. 기기 저장 없음.
export const LOAD_MS = 30000;

export class LoadTimeout extends Error {
  constructor(ms) {
    super('load_timeout');
    this.name = 'LoadTimeout';
    this.code = 'timeout';
    this.ms = ms;
  }
}
export const isLoadTimeout = error => error?.name === 'LoadTimeout' || error?.code === 'timeout';

export function within(task, ms = LOAD_MS, {signal = null} = {}) {
  const limit = Number.isFinite(+ms) && +ms > 0 ? +ms : LOAD_MS;
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const onAbort = () => ctl?.abort();
  if (signal) { if (signal.aborted) ctl?.abort(); else signal.addEventListener?.('abort', onAbort, {once:true}); }
  let work;
  try { work = Promise.resolve(typeof task === 'function' ? task(ctl?.signal) : task); }
  catch (error) { work = Promise.reject(error); }
  let timer = 0;
  const late = new Promise((_, fail) => { timer = setTimeout(() => { fail(new LoadTimeout(limit)); ctl?.abort(); }, limit); });
  // 시간이 지난 뒤 끊긴 요청의 실패는 아무도 받지 않으므로 여기서 조용히 삼킨다(처리 안 된 거절 경고가 나지 않게).
  work.catch(() => {});
  return Promise.race([work, late]).finally(() => { clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort); });
}

export function onResume(fn, {win = globalThis.window, doc = globalThis.document} = {}) {
  let at = 0;
  const fire = () => { const now = Date.now(); if (now - at < 1000) return; at = now; try { fn(); } catch { /* 한 곳 실패가 다른 곳을 막지 않게 */ } };
  const vis = () => { if (doc?.visibilityState === 'visible') fire(); };
  const show = event => { if (event?.persisted) fire(); };
  doc?.addEventListener?.('visibilitychange', vis);
  win?.addEventListener?.('pageshow', show);
  return () => { doc?.removeEventListener?.('visibilitychange', vis); win?.removeEventListener?.('pageshow', show); };
}
