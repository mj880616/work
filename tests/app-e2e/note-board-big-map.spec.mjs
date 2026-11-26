import { test, expect } from '@playwright/test';
import { boardFixture } from './helpers/note-board-fixture.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { bigBoardSeed, centerBoardPoint } from './helpers/big-board-seed.mjs';

// S71-52 NOTE-큰생각지도(사용자 2026-11-26 "굉장히 광범위한 생각지도 … 무한정 뻗어나가는"): 주제 1,000개·선 1,000개 보드(가짜 글)를
// PC 1280·폰 390(CPU 4배 느리게)에서 열기·옮기기·확대/축소·끌기 시간과 프레임을 잰다. 잰 값은 BIG_BOARD_REPORT=1일 때 출력(PR 본문 표).
// 상한은 CI 기계 기준으로 넉넉히(목표: 열기 1초대, 끌기·이동 끊김 없음).
const BID = 'bbig0001';
const REPORT = !!process.env.BIG_BOARD_REPORT;
// 프레임은 한 번 튀는 값(max) 대신 평균·90% 값으로 본다(CI 기계가 바쁠 때 한 프레임만 늦는 것은 끊김으로 보지 않음).
const LIMIT = { open: 4000, avg: 100, p90: 250 };

async function bigBoard(page, width, { throttle = 1 } = {}) {
  const { texts, links } = bigBoardSeed({ bid: BID });
  const fx = await boardFixture(page, width, { bid: BID, seed: texts, links, open: false });
  if (throttle > 1) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle }); }
  const open = await page.evaluate(() => new Promise(done => {
    const t0 = performance.now();
    document.querySelector('.nv-switch [data-note-view="board"]').click();
    const tick = () => {
      const box = document.querySelector('[data-note-board]');
      if (box && Number(box.dataset.nbTexts) >= 1000) requestAnimationFrame(() => done(performance.now() - t0));
      else requestAnimationFrame(tick);
    };
    tick();
  }));
  return { ...fx, open };
}
// 프레임 기록: 동작하는 동안 requestAnimationFrame 간격(ms)을 모은다.
const startFrames = page => page.evaluate(() => { const f = window.__nbFrames = { list: [], on: true, last: performance.now() }; const loop = t => { if (!f.on) return; f.list.push(t - f.last); f.last = t; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
const stopFrames = page => page.evaluate(() => { const f = window.__nbFrames; f.on = false; const l = f.list.slice(1); const sum = l.reduce((a, b) => a + b, 0); const sorted = [...l].sort((a, b) => a - b); return { frames: l.length, max: Math.round(Math.max(0, ...l)), p90: Math.round(sorted[Math.floor(sorted.length * 0.9)] || 0), avg: Math.round(sum / Math.max(1, l.length) * 10) / 10, long: l.filter(x => x > 50).length }; });
async function center(page) { const b = await page.locator('[data-note-board] [data-nb-scroll]').boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }

for (const [width, throttle] of [[1280, 1], [390, 4]]) {
  test(`큰 생각 지도(주제 1,000·선 1,000) 열기·이동·확대·끌기 시간 (${width})`, async ({ page }) => {
    test.setTimeout(180000);
    const { errors, open } = await bigBoard(page, width, { throttle });
    await page.locator('[data-note-board] [data-nb-fit]').click();
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const c = await center(page);
    await page.mouse.move(c.x, c.y);
    await startFrames(page);
    for (let i = 0; i < 30; i++) await page.mouse.wheel(i % 2 ? 0 : 90, 60);
    const pan = await stopFrames(page);
    await startFrames(page);
    await page.keyboard.down('Control');
    for (let i = 0; i < 16; i++) await page.mouse.wheel(0, i < 8 ? 120 : -120);
    await page.keyboard.up('Control');
    const zoom = await stopFrames(page);
    // 끌기: 보이는 상자 하나를 잡고 30번 나눠 옮긴다.
    // 끌 상자: 첫 뿌리(판 좌표 3000, 3000 — big-board-seed) 둘레를 화면 가운데로.
    await centerBoardPoint(page, 3200, 3000);
    const b = await page.evaluate(() => { const s = document.querySelector('[data-nb-scroll]').getBoundingClientRect();
      const hit = [...document.querySelectorAll('[data-nb-texts] [data-nb-text] .nb-tx')].map(e => e.getBoundingClientRect()).find(r => r.left > s.left + 8 && r.right < s.right - 8 && r.top > s.top + 100 && r.bottom < s.bottom - 30);
      return hit && { x: hit.left, y: hit.top, width: hit.width, height: hit.height }; });
    expect(b).toBeTruthy();
    await startFrames(page);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 30; i++) await page.mouse.move(b.x + b.width / 2 + i * 6, b.y + b.height / 2 + i * 3);
    await page.mouse.up();
    const drag = await stopFrames(page);
    const dom = await page.evaluate(() => ({ texts: document.querySelectorAll('[data-nb-texts] [data-nb-text]').length, lines: document.querySelectorAll('[data-nb-lines] [data-nb-line]').length, branches: document.querySelectorAll('[data-nb-branches] path').length }));
    const row = { width, throttle, open: Math.round(open), pan, zoom, drag, dom };
    if (REPORT) console.log('BIG_BOARD', JSON.stringify(row));
    expect(errors).toEqual([]);
    expect(open).toBeLessThan(LIMIT.open * throttle);
    for (const m of [pan, zoom, drag]) { expect(m.avg).toBeLessThan(LIMIT.avg * throttle); expect(m.p90).toBeLessThan(LIMIT.p90 * throttle); }
  });
}

// 무한 판: 판을 왼쪽·위로 멀리 옮긴 뒤(판 좌표가 음수인 곳) 빈 곳 두 번 누르기로 주제를 만들면 그 자리(음수)로 저장되고,
// 다른 화면에 갔다 다시 열어도 [맞추기]로 그 주제가 그 자리에 보인다. 고치기 전에는 0으로 잘려 카드 옆으로 붙었다.
test('무한 판: 왼쪽·위 멀리(음수 좌표) 둔 주제가 그 자리로 저장되고 다시 열어도 그 자리 (1280)', async ({ page }) => {
  const { errors, textRows } = await boardFixture(page, 1280, { bid: BID });
  const s = await page.locator('[data-note-board] [data-nb-scroll]').boundingBox();
  const at = { x: s.x + s.width / 2, y: s.y + s.height / 2 };
  await page.mouse.move(at.x, at.y);
  for (let i = 0; i < 10; i++) await page.mouse.wheel(-400, -300); // 판을 오른쪽·아래로 → 화면에 음수 좌표 쪽이 보임
  const want = await page.evaluate(({ x, y }) => {
    const r = document.querySelector('[data-nb-scroll]').getBoundingClientRect(), m = document.querySelector('[data-nb-board]').style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\) scale\(([\d.]+)\)/);
    return { x: (x - r.left - Number(m[1])) / Number(m[3]), y: (y - r.top - Number(m[2])) / Number(m[3]) };
  }, at);
  expect(want.x).toBeLessThan(-1000); expect(want.y).toBeLessThan(-1000);
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.locator('[data-nb-text-edit]')).toBeFocused();
  await page.keyboard.type('멀리 둔 주제'); await page.keyboard.press('Enter');
  await expect.poll(() => textRows.find(t => t.body === '멀리 둔 주제')?.x ?? null).not.toBeNull();
  const row = textRows.find(t => t.body === '멀리 둔 주제');
  expect(row.x).toBeLessThan(-1000); expect(row.y).toBeLessThan(-1000);
  // 다른 화면 → 다시 노트 › 보드: [맞추기]로 멀리 둔 주제가 보이고 판 위 자리도 저장 값 그대로.
  await page.evaluate(() => window.KPTURouter.go('home'));
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await page.locator('.nv-switch [data-note-view="board"]').click();
  await page.locator('[data-note-board] [data-nb-fit]').click();
  const node = page.locator('[data-nb-texts] [data-nb-text]').filter({ hasText: '멀리 둔 주제' });
  await expect(node).toBeVisible();
  const placed = await node.evaluate(el => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top) }));
  expect(placed).toEqual({ x: row.x, y: row.y }); // 판 위 그 자리(음수) 그대로
  expect(errors).toEqual([]);
});
