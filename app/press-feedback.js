// UI-눌림느낌(2026-10-27 명진 요청): 누르는 느낌과 '✓ 복사됨' 알림의 공용 부품. 모양 규칙은 ui-standard.css 한 곳(:active·[data-pressing]·[data-done]).
// 1) 눌림: 진짜 버튼류는 CSS :active가 맡는다. 이 파일은 (a) 버튼이 아닌데 눌리는 줄·카드·칩·라벨(cursor:pointer)을 누르는 동안
//    data-pressing으로 표시하고, (b) 폭·높이가 큰 줄·카드는 data-press-wide로 덜 작아지게 한다(3%가 아니라 1.5%). 저장소·서버에 아무것도 남기지 않는다.
// 2) flashDone(button): 결과가 눈에 안 보이는 동작([복사] 등)이 끝나면 버튼 글자가 1.5초 동안 '✓ 복사됨'(초록)으로 바뀌었다 돌아온다.
//    글자 없는 아이콘 버튼은 '✓'만 보이고 읽기 프로그램에는 '복사됨'이 읽힌다. 진동은 쓰지 않는다.

export const COPIED = '✓ 복사됨';
export const DONE_MS = 1500;
// CSS(ui-standard.css)가 :active로 직접 다루는 요소. 이 안에 들어 있으면 누른 것은 그 버튼이지 바깥 카드가 아니다.
export const NATIVE_PRESS = 'button,summary,a[href],[role="button"],[role="tab"],[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],[role="option"],[role="switch"],input[type="button"],input[type="submit"],input[type="reset"]';
const WIDE_W = 240, WIDE_H = 60;

// 큰 줄·카드는 같은 3%라도 눈에 띄게 많이 움직이므로 낮춘다.
export const isWide = rect => !!rect && (rect.width >= WIDE_W || rect.height >= WIDE_H);

// 눌린 곳에서 위로 올라가며 '눌리는 것'을 찾는다. 진짜 버튼이 먼저 나오면 그것(없으면 null이 아니라 그 버튼)이 대상이다.
// cursor는 물려받는 속성이라, 같은 손가락 모양이 이어지는 사슬의 맨 위가 그 줄·카드 자신이다.
export function pressTarget(start, {cursorOf = el => getComputedStyle(el).cursor, native = NATIVE_PRESS} = {}) {
  let el = start && start.nodeType === 1 ? start : start?.parentElement || null;
  if (!el) return null;
  const optOut = el.closest?.('[data-press="off"]');
  if (optOut) return null;
  const real = el.closest?.(native);
  if (real) return real.matches?.(':disabled,[aria-disabled="true"]') ? null : real;
  let top = null;
  for (let depth = 0; el && el !== document.body && depth < 8; depth++, el = el.parentElement) {
    if (cursorOf(el) === 'pointer') top = el; else if (top) break;
  }
  return top;
}

let pressed = null;
function release() {
  if (!pressed) return;
  pressed.removeAttribute('data-pressing'); pressed.removeAttribute('data-press-wide');
  pressed = null;
}

function onDown(event) {
  if (event.button > 0 || event.isPrimary === false) return;
  release();
  const target = pressTarget(event.target);
  if (!target) return;
  pressed = target;
  if (isWide(target.getBoundingClientRect())) target.setAttribute('data-press-wide', '');
  target.setAttribute('data-pressing', '');
}

export function bindPressFeedback(doc = document, win = window) {
  if (win.__KPTU_PRESS_BOUND__) return;
  win.__KPTU_PRESS_BOUND__ = true;
  doc.addEventListener('pointerdown', onDown, {capture: true, passive: true});
  for (const type of ['pointerup', 'pointercancel', 'dragstart', 'contextmenu']) doc.addEventListener(type, release, {capture: true, passive: true});
  win.addEventListener('blur', release);
  doc.addEventListener('visibilitychange', release);
}

// ── 완료 표시 ──────────────────────────────────────────────────────────────
const flashes = new WeakMap();

// button: 눌린 버튼(요소) 또는 그것을 돌려주는 함수(화면이 다시 그려져 요소가 바뀌는 곳은 다시 찾아 준다).
// 이미 켜져 있으면 처음 모습을 그대로 두고 시간만 새로 센다. 버튼 폭은 켜 있는 동안 고정해 옆 버튼이 밀리지 않게 한다.
export function flashDone(button, {text = COPIED, label = '복사됨', ms = DONE_MS, setTimer = setTimeout, clearTimer = clearTimeout} = {}) {
  const el = typeof button === 'function' ? button() : button;
  if (!el || !el.isConnected) return false;
  let saved = flashes.get(el);
  if (saved) clearTimer(saved.timer);
  else {
    const iconOnly = !String(el.textContent || '').trim();
    saved = {nodes: [...el.childNodes], iconOnly, label: el.getAttribute('aria-label'), title: el.getAttribute('title'), minWidth: el.style.minWidth};
    const width = el.getBoundingClientRect?.().width;
    if (width) el.style.minWidth = Math.ceil(width) + 'px';
    flashes.set(el, saved);
  }
  el.replaceChildren(document.createTextNode(saved.iconOnly ? '✓' : text));
  el.setAttribute('data-done', '');
  if (saved.label != null || saved.iconOnly) el.setAttribute('aria-label', label);
  if (saved.title != null) el.setAttribute('title', label);
  saved.timer = setTimer(() => {
    flashes.delete(el);
    el.replaceChildren(...saved.nodes);
    el.removeAttribute('data-done');
    if (saved.label == null) el.removeAttribute('aria-label'); else el.setAttribute('aria-label', saved.label);
    if (saved.title == null) el.removeAttribute('title'); else el.setAttribute('title', saved.title);
    el.style.minWidth = saved.minWidth || '';
  }, ms);
  return true;
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') bindPressFeedback();
