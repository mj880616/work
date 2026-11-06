// S51-20 ③: 손가락 하나로 꾹 눌러(hold ms) 끌어 놓기를 Chromium 터치 입력으로 흉내 낸다(app/touch-drag.js 시험용).
// from·to는 locator(가운데) 또는 {x, y}. to가 없으면 움직이지 않고 뗀다(꾹 눌러 고르기).
const at = async l => { if (!l || Number.isFinite(l.x)) return l; await l.evaluate(e => e.scrollIntoView({ block: 'center', behavior: 'instant' })); const b = await l.boundingBox(); return { x: b.x + b.width / 2, y: b.y + Math.min(b.height / 2, 20) }; };
export async function touchDrag(page, from, to = null, { hold = 520, steps = 8, before = null } = {}) {
  const a = await at(from);
  const cdp = await page.context().newCDPSession(page);
  const tp = p => [{ x: p.x, y: p.y, id: 0 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(a) });
  await page.waitForTimeout(hold);
  if (to) {
    const b = Number.isFinite(to.x) ? to : await (async () => { const bb = await to.boundingBox(); return { x: bb.x + bb.width / 2, y: bb.y + Math.min(bb.height / 2, 20) }; })();
    for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp({ x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }) }); await page.waitForTimeout(16); }
    if (before) await before();
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
