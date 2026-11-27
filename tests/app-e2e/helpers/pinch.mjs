import { expect } from '@playwright/test';
// FOLDER-나무새기준(S51-12): 두 손가락 벌리기('out')·오므리기('in')를 Chromium 터치 입력으로 흉내 낸다(folder-pinch.js 시험용).
// 두 손가락은 locator 가운데를 중심으로 좌우에 놓인다. 화면 확대는 나무 칸의 touch-action이 막는다.
export async function pinch(page, locator, dir) {
  // S51-24: 나무 ⇄ 그 폴더만 0.2초 움직임(folder-focus-motion.js)이 끝난 자리에서 손가락을 놓는다.
  // 화면이 바뀐 다음 장면에서 움직임이 시작되므로 두 장면을 기다린 뒤 잰다.
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running' && !(a instanceof CSSAnimation) && !(a instanceof CSSTransition)));
  // STAB-저장먼저닫기흔들림: 나무 칸은 자료가 올 때마다 다시 그려진다(innerHTML). 줄을 찾은 뒤 따로 재면 그 사이 새로 그려져
  // 문서에서 떨어진 옛 줄을 재(boundingBox null) 깨졌다 — 지금 화면에 붙어 있는 줄을 한 번에 굴려 보이고 잰다(떨어진 줄이면 다시 찾는다).
  let box = null;
  await expect.poll(async () => (box = await locator.evaluate(e => {
    if (!e.isConnected) return null;
    e.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = e.getBoundingClientRect();
    return r.width && r.height ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  })), { message: '손짓할 줄이 화면에 붙어 있어야 함' }).not.toBeNull();
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
// 흔들림 정리(2026-11-27): 빈 곳을 재고(emptySpot) 그 자리가 손짓 칸 안인지(spotIn) 따로 물으면, 그 사이에 화면이 늦게 오는 줄을 그리거나
// 손짓 칸 높이(app/gesture-fill.js, 다음 그림 틀에 정함)를 다시 잡아 두 값이 서로 다른 그림을 본다(empty-space-gestures CI 7번 흔들림).
// 여기서는 기다릴 대상을 '그림이 멈춤'이라는 상태로 둔다: 내용 아래 끝·손짓 칸 위치·높이·아래 바 위치가 그림 틀 3번 연속 같으면,
// 그 같은 틀에서 빈 곳 좌표와 '손짓 칸 안' 여부를 함께 잰다(정한 시간만큼 기다리지 않는다. 5초 안에 멈추지 않으면 그때 값으로 실패하게 둔다).
export async function settledEmptySpot(page, items, host, gap = 40) {
  return page.evaluate(([sel, h, g]) => new Promise(resolve => {
    const fixed = el => { for (let e = el; e; e = e.parentElement) if (getComputedStyle(e).position === 'fixed') return true; return false; };
    const read = () => {
      const bottom = Math.max(...[...document.querySelectorAll(sel)].filter(e => e.getClientRects().length && !fixed(e)).map(e => e.getBoundingClientRect().bottom));
      const bar = document.querySelector('nav.mobile-tabs'), hb = document.querySelector(h);
      const hr = hb?.getBoundingClientRect();
      const spot = { x: Math.round(innerWidth / 2), y: Math.round(bottom + g), barTop: bar?.getBoundingClientRect().top ?? innerHeight };
      return { spot, key: [bottom, hr?.top, hr?.bottom, hb?.style.minHeight, spot.barTop, scrollY].join('|') };
    };
    const t0 = performance.now();
    let last = '', same = 0;
    const tick = () => {
      const { spot, key } = read();
      same = key === last ? same + 1 : 0;
      last = key;
      if (same >= 2 || performance.now() - t0 > 5000) {
        resolve({ ...spot, inside: !!document.elementFromPoint(spot.x, spot.y)?.closest(h) });
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), [items, host, gap]);
}
// 그 자리 요소가 손짓 칸(sel) 안인가.
export const spotIn = (page, { x, y }, sel) => page.evaluate(([px, py, s]) => !!document.elementFromPoint(px, py)?.closest(s), [x, y, sel]);
