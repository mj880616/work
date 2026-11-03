// PHOTO-꾹누르기메뉴(S49-18, 요청함 11/03 23:59): 사진 크게 보기에서 사진을 꾹 누르면(PC는 우클릭) 브라우저·앱의 기본 이미지 메뉴 대신
// Web2 작은 메뉴(share-menu.js: [사진 복사][공유][다운로드][일기에 넣기][업데이트로 보내기])를 하나만 띄운다.
// - 폰 앱(WebView)은 '이미지 복사' 기본 메뉴가 없고, 삼성 인터넷·크롬은 기본 메뉴가 따로 떠서 둘이 겹치므로 기본 메뉴를 막고 이 메뉴 하나로 맞춘다.
// - 꾹 누르는 동안 손가락이 움직이거나(10px 넘게) 두 번째 손가락이 닿거나 스크롤되면 취소한다(넘기기·두 손가락 확대·세로 밀기와 겹치지 않음).
// - 메뉴가 뜬 직후 손가락을 뗄 때 따라오는 클릭이 메뉴를 바로 닫지 않게 그 클릭 하나를 삼킨다.
// 이 화면 메모리만 쓰고 저장하지 않는다. DOM 요소 하나(box)만 붙들며 box가 사라지면 함께 사라진다.
export const LONG_PRESS_MS = 500, LONG_PRESS_MOVE = 10, CLICK_SWALLOW_MS = 800;

// box: 크게 보기 껍데기. photoAt(target) → 꾹 눌린 자리가 메뉴 대상 사진이면 true. open(x, y)가 메뉴를 연다.
export function attachPhotoLongPress(box, {photoAt, open, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, win = globalThis.window} = {}) {
  if (!box || typeof photoAt !== 'function' || typeof open !== 'function') return () => {};
  let press = null, openedAt = -Infinity;
  const cancel = () => { if (press) clearTimer(press.timer); press = null; };
  // 손가락을 뗄 때 따라오는 클릭 하나를 창 맨 앞(캡처)에서 삼킨다. 공용 메뉴(anchored-menu)의 바깥 클릭 닫기가 문서 캡처에서 먼저 듣기 때문에 box에서는 늦다.
  let swallow = null;
  const dropSwallow = () => { if (swallow) { clearTimer(swallow.timer); win?.removeEventListener?.('click', swallow.fn, true); swallow = null; } };
  const fire = (x, y) => {
    openedAt = now(); dropSwallow();
    if (win?.addEventListener) {
      const fn = event => { event.preventDefault(); event.stopPropagation(); dropSwallow(); };
      swallow = {fn, timer:setTimer(dropSwallow, CLICK_SWALLOW_MS)};
      win.addEventListener('click', fn, true);
    }
    open(x, y);
  };
  box.addEventListener('touchstart', event => {
    cancel();
    if (event.touches.length !== 1 || !photoAt(event.target)) return;
    const t = event.touches[0], me = {x:t.clientX, y:t.clientY, timer:0};
    me.timer = setTimer(() => { if (press !== me) return; press = null; fire(me.x, me.y); }, LONG_PRESS_MS);
    press = me;
  }, {passive:true, capture:true});
  box.addEventListener('touchmove', event => {
    if (!press) return;
    const t = event.touches[0];
    if (event.touches.length > 1 || !t || Math.hypot(t.clientX - press.x, t.clientY - press.y) > LONG_PRESS_MOVE) cancel();
  }, {passive:true, capture:true});
  for (const name of ['touchend', 'touchcancel']) box.addEventListener(name, cancel, {passive:true, capture:true});
  box.addEventListener('scroll', cancel, {passive:true, capture:true});
  // 기본 이미지 메뉴는 언제나 막고(두 메뉴가 겹쳐 뜨지 않게), 꾹 누르기 타이머가 이미 열었으면 또 열지 않는다.
  box.addEventListener('contextmenu', event => {
    if (!photoAt(event.target)) return;
    event.preventDefault();
    cancel();
    if (now() - openedAt > CLICK_SWALLOW_MS) fire(event.clientX, event.clientY);
  }, true);
  return () => { cancel(); dropSwallow(); };
}

// 메뉴를 붙일 자리: 누른 점에 1px 보이지 않는 요소. 메뉴(anchored-menu)는 이 요소 곁에 열린다. box 안에 둬서 box와 함께 사라진다.
export function pointAnchor(box, x, y) {
  let a = box.querySelector('[data-press-anchor]');
  if (!a) {
    a = document.createElement('span');
    a.dataset.pressAnchor = ''; a.setAttribute('aria-hidden', 'true');
    a.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;';
    box.append(a);
  }
  a.style.left = `${Math.round(x)}px`; a.style.top = `${Math.round(y)}px`;
  return a;
}
