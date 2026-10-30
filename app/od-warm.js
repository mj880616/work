// OD-미리받기(2026-10-28 명진 요청): 앱을 켜면 첫 화면이 다 뜬 뒤 한가할 때, 뒤에서 원드라이브 연결 확인 + 이번 달 사진 목록 +
// 앞쪽 작은 그림 몇 장을 받아 둔다. 일기·일기 목록을 누르면 기다리지 않고 바로 그린다. 화면 표시·버튼 없음.
// - loader-v2.js가 첫 화면 공개(__KPTU_MARK_APP_UI_READY__) 뒤 requestIdleCallback으로 이 파일을 불러온다(시작 순서를 늦추지 않음).
// - 실제 받기는 diary-onedrive.js의 odWarm 하나. 받아 둔 것은 그 탭 메모리뿐이고, 작은 그림 바이트만 기존 OD-폰보관 예외(od-thumb-cache.js)를 쓴다.
// - 원드라이브를 연결하지 않았으면 상태 확인 한 번으로 끝난다. 미리 받는 양: 목록 한 달 + 작은 그림 8장까지, 그 뒤 이어서 사진 미리 받기
//   (PHOTO-미리받기앱시작 2026-10-30: 최근 100장 작은+큰 그림 → 옛날 작은 그림, diary-onedrive.js odWarmPrefetch).
// - 일기 화면이 이미 열려 있으면 일기가 스스로 받으므로 하지 않는다. 앱을 10분 넘게 가렸다가 다시 보면(폰에서 앱을 다시 켬) 한 번 더 한다.
export const WARM_START_MS = 1500, WARM_AGAIN_MS = 10 * 60 * 1000;

export function installOdWarm(win = window, {load = () => import('./diary-onedrive.js'), now = () => Date.now()} = {}) {
  const rt = win.KPTURuntime;
  if (!rt || win.KPTUOdWarm) return win.KPTUOdWarm || null;
  const doc = win.document;
  let last = 0, running = null;
  const idle = () => new Promise(resolve => {
    if (typeof win.requestIdleCallback === 'function') win.requestIdleCallback(() => resolve(), {timeout: 3000});
    else win.setTimeout(resolve, 200);
  });
  function run() {
    if (running || doc?.visibilityState === 'hidden' || win.KPTURouter?.current === 'diary') return running;
    running = (async () => {
      await idle();
      if (doc?.visibilityState === 'hidden' || win.KPTURouter?.current === 'diary') return {done: false, why: 'skipped'};
      last = now();
      const {odWarm, odWarmPrefetch} = await load();
      const out = await odWarm(rt);
      // PHOTO-미리받기앱시작: 일기를 열지 않아도 이어서 사진 미리 받기(최근 100장은 작은+큰 그림, 그다음 옛날 작은 그림)를 시작한다.
      // 연결·폴더가 있을 때만(odWarm이 done). 이미 돌고 있으면 그대로 둔다. 앱을 닫으면 멈춘다(diary-onedrive.js).
      if (out?.done && typeof odWarmPrefetch === 'function') odWarmPrefetch(rt).catch(() => false);
      return out;
    })().catch(() => ({done: false, why: 'error'})).finally(() => { running = null; });
    return running;
  }
  win.setTimeout(run, WARM_START_MS);
  doc?.addEventListener?.('visibilitychange', () => {
    if (doc.visibilityState === 'visible' && last && now() - last >= WARM_AGAIN_MS) run();
  });
  win.KPTUOdWarm = {run};
  return win.KPTUOdWarm;
}

if (typeof window !== 'undefined') installOdWarm(window);
