// FOLDER-나무새기준(S51-12): 두 손가락 벌리기('out')·오므리기('in')를 Chromium 터치 입력으로 흉내 낸다(folder-pinch.js 시험용).
// 두 손가락은 locator 가운데를 중심으로 좌우에 놓인다. 화면 확대는 나무 칸의 touch-action이 막는다.
export async function pinch(page, locator, dir) {
  // S51-24: 나무 ⇄ 그 폴더만 0.2초 움직임(folder-focus-motion.js)이 끝난 자리에서 손가락을 놓는다.
  // 화면이 바뀐 다음 장면에서 움직임이 시작되므로 두 장면을 기다린 뒤 잰다.
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running' && !(a instanceof CSSAnimation) && !(a instanceof CSSTransition)));
  await locator.evaluate(e => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const box = await locator.boundingBox();
  await pinchAt(page, box.x + box.width / 2, box.y + box.height / 2, dir);
}
// S51-24: 화면 좌표(cx, cy) 가운데로 두 손가락 벌리기·오므리기(빈 곳 손짓 시험용).
export async function pinchAt(page, cx, cy, dir) {
  const cdp = await page.context().newCDPSession(page);
  const points = d => [{ x: cx - d, y: cy, id: 0 }, { x: cx + d, y: cy, id: 1 }];
  const [from, to] = dir === 'out' ? [20, 90] : [90, 20];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(from) });
  for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(from + (to - from) * i / 6) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
// S51-24: 화면 좌표(x, y)에서 손가락 하나로 옆으로 dx만큼 밀기(빈 곳 손짓 시험용).
export async function swipeAt(page, x, y, dx) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 0 }] });
  for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 6, y, id: 0 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
// 내용이 끝난 아래 빈 곳(화면 좌표): items(내용 줄) 중 가장 아래 끝에서 gap px 아래, 가로 가운데. 하단 탭바보다 위여야 한다.
export async function emptySpot(page, items, gap = 40) {
  return page.evaluate(([sel, g]) => {
    const fixed = el => { for (let e = el; e; e = e.parentElement) if (getComputedStyle(e).position === 'fixed') return true; return false; };
    const bottom = Math.max(...[...document.querySelectorAll(sel)].filter(e => e.getClientRects().length && !fixed(e)).map(e => e.getBoundingClientRect().bottom));
    const bar = document.querySelector('nav.mobile-tabs');
    return { x: Math.round(innerWidth / 2), y: Math.round(bottom + g), barTop: bar?.getBoundingClientRect().top ?? innerHeight };
  }, [items, gap]);
}
// 그 자리 요소가 손짓 칸(sel) 안인가.
export const spotIn = (page, { x, y }, sel) => page.evaluate(([px, py, s]) => !!document.elementFromPoint(px, py)?.closest(s), [x, y, sel]);
