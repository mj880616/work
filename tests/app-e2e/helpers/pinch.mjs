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
