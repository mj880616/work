// LIB-편집열기느림(S55-15): HWP 편집기 부품 미리 받기(Web2 창 쪽). 화면에 안 보이는 칸막이 frame에 app/hwp-lab/warm.html을 띄워
// 편집기 frame과 같은 캐시 칸에 부품을 받아 두고, 끝나면 frame을 지운다. [HWP 편집]을 누를 때 편집기 준비가 내려받기 없이 끝난다.
// 이 창에서 한 번만 한다. 데이터 절약 모드·휴대폰 데이터(셀룰러)에서는 하지 않는다(한 번 받으면 판이 바뀔 때까지 다시 받지 않지만 처음 약 14MB).
// 저장소·로그인 정보·문서 내용은 쓰지 않는다. frame은 sandbox=allow-scripts만 줘서(고유 origin) Web2 창에 닿지 못한다.
const WARM_URL = new URL('./hwp-lab/warm.html', import.meta.url).href;
const WARM_TIMEOUT_MS = 180000;
let started = null;

export function hwpWarmAllowed(nav = globalThis.navigator) {
  const c = nav?.connection;
  if (c?.saveData) return false;
  if (c?.type === 'cellular') return false;
  return true;
}

// 미리 받기를 시작하고 끝(성공 'done' / 'failed' / 'skipped' / 'timeout')을 돌려준다. 두 번째 부르면 같은 결과.
export function warmHwpEditor({doc = globalThis.document, nav = globalThis.navigator, timeoutMs = WARM_TIMEOUT_MS} = {}) {
  if (started) return started;
  if (!doc?.body || !hwpWarmAllowed(nav)) return (started = Promise.resolve('skipped'));
  started = new Promise(resolve => {
    const frame = doc.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.title = 'HWP 편집 미리 받기';
    frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10px;top:-10px;border:0;opacity:0;pointer-events:none';
    let timer = 0;
    const finish = result => { clearTimeout(timer); window.removeEventListener('message', onMessage); frame.remove(); resolve(result); };
    const onMessage = e => {
      if (e.source !== frame.contentWindow) return;
      const v = e.data?.hwpWarm;
      if (v === 'done' || v === 'failed') finish(v);
    };
    window.addEventListener('message', onMessage);
    timer = setTimeout(() => finish('timeout'), timeoutMs);
    frame.src = WARM_URL;
    doc.body.appendChild(frame);
  });
  return started;
}

// 브라우저가 한가할 때 시작한다(화면 그리기·첫 읽기와 겹치지 않게).
export function warmHwpEditorWhenIdle(options) {
  const run = () => void warmHwpEditor(options);
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, {timeout: 5000});
  else setTimeout(run, 2000);
}
