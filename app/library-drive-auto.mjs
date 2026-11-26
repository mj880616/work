// S70-73 LIB-드라이브자동등록(명진 11/26 08:52 "자동으로 들어오게해야지 메뉴 없애고"): 자료실을 열 때 서버에 한 번
// '드라이브 자료실 폴더에 새로 생긴 파일 등록'을 부탁한다(library-files action drive-auto — 판정·등록은 모두 서버). 버튼·창 없음.
// 새로 들어온 게 있을 때만 목록을 다시 읽고 한 줄을 보인다. 실패는 조용히 넘긴다(다음에 자료실을 열면 다시).
// 같은 로그인·작업공간에서는 GAP_MS 안에 다시 부르지 않는다(화면 메모리만 — 기기 저장 없음). 드라이브 권한·자료실 폴더가 없다는 답이면
// 이 로그인 동안 다시 부르지 않는다. 순수 규칙(DOM 없음, api 주입). 시험: tests/library-drive-auto.test.mjs.
export const PATH = '/functions/v1/library-files';
export const GAP_MS = 3 * 60 * 1000;
export const WAIT_MS = 30000;
const HALT = new Set(['scope_missing', 'library_missing']);

export const addedLine = n => `드라이브 자료실 폴더에서 새 자료 ${n}개가 들어왔어요`;
// S70-73c: 드라이브에서 다른 폴더로 옮긴 자료는 서버가 자료실 폴더도 따라 옮긴다(followed). 들어온 것·옮긴 것을 한 줄로.
export const movedLine = m => `드라이브에서 옮긴 자료 ${m}개를 자료실에서도 같은 폴더로 옮겼어요`;
export const changedLine = (n, m) => n && m ? `${addedLine(n)} · ${movedLine(m)}` : n ? addedLine(n) : movedLine(m);

// api(path,{method,body,timeoutMs,singleFlight}), onAdded(n, moved): 목록 다시 읽기·한 줄(새로 들어온 수, 드라이브 따라 옮긴 수),
// isCurrent(): 아직 같은 로그인·자료실 화면인가. 돌려주는 값은 새로 들어온 수.
export function createDriveAuto({ api, onAdded, isCurrent = () => true, now = () => Date.now(), gapMs = GAP_MS }) {
  const last = new Map(), halted = new Set();
  let running = null;
  function start(scopeKey, current = isCurrent) {
    if (!scopeKey || running || halted.has(scopeKey)) return running;
    const at = last.get(scopeKey);
    if (at !== undefined && now() - at < gapMs) return null;
    last.set(scopeKey, now());
    running = (async () => {
      let r = null;
      try { r = await api(PATH, { method: 'POST', body: { action: 'drive-auto' }, timeoutMs: WAIT_MS, singleFlight: false }); }
      catch { return 0; }
      if (r && HALT.has(r.code)) halted.add(scopeKey);
      const n = r?.ok === true && Number.isSafeInteger(r.added) && r.added > 0 ? r.added : 0;
      const m = r?.ok === true && Number.isSafeInteger(r.followed) && r.followed > 0 ? r.followed : 0;
      if ((n || m) && current()) { try { await onAdded(n, m); } catch { /* 목록 다시 읽기 실패는 다음 열 때 */ } }
      return n;
    })().finally(() => { running = null; });
    return running;
  }
  return { start };
}
