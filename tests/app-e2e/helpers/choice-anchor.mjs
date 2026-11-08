import { expect } from '@playwright/test';
// S54-05 UI-고르기창버튼아래 ②(11/08 명진 결정): 버튼으로 연 공용 고르기 창(app/choice-sheet.js)은 폰·폴드·PC 모두 누른 버튼 바로 아래
// (아래 자리가 모자라면 바로 위) 작은 창이다. S54-04의 picker-anchor.mjs(폴더로 옮기기 창)와 같은 기준을 지킨다:
// ① 창이 버튼 바로 아래(또는 위)에 붙고 버튼과 가로로 겹친다(화면 아래에서 올라오는 넓은 시트가 아님),
// ② 화면 밖·아래 바(하단바·전환 줄)를 덮지 않는다, ③ 목록 첫 줄이 찾기 칸·제목에 가리지 않고 다 보인다.
export async function expectChoiceAtButton(page, sheet, trigger, { maxWidth = 480, firstRow = true } = {}) {
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveClass(/home-choice-anchored/);
  await page.waitForTimeout(120); // followAnchor는 다음 화면 그림 때 자리를 다시 맞춘다
  const g = await page.evaluate(([s, a]) => {
    const sr = s.getBoundingClientRect(), ar = a.getBoundingClientRect(), body = s.querySelector('[data-sheet-content]').getBoundingClientRect();
    const firstEl = [...s.querySelectorAll('[data-sheet-content] [data-sheet-value],[data-sheet-content] [data-aop-toggle],[data-sheet-content] [data-aop-empty]')].find(e => e.getClientRects().length);
    const first = firstEl?.getBoundingClientRect();
    const cs = getComputedStyle(document.documentElement), v = n => parseFloat(cs.getPropertyValue(n)) || 0;
    const tabs = document.querySelector('nav.mobile-tabs'), tr = tabs && getComputedStyle(tabs).display !== 'none' ? tabs.getBoundingClientRect() : null;
    const floor = Math.min(innerHeight - v('--kptu-mobile-tab-height') - v('--kptu-switch-dock'), tr && tr.height ? tr.top : innerHeight);
    return { s: { top: sr.top, bottom: sr.bottom, left: sr.left, right: sr.right, width: sr.width }, a: { top: ar.top, bottom: ar.bottom, left: ar.left, right: ar.right },
      side: s.dataset.anchorSide || '', bodyTop: body.top, first: first ? { top: first.top, bottom: first.bottom } : null, floor, vw: document.documentElement.clientWidth };
  }, [await sheet.elementHandle(), await trigger.elementHandle()]);
  expect(['below', 'above']).toContain(g.side);
  if (g.side === 'below') { expect(g.s.top).toBeGreaterThanOrEqual(g.a.bottom - 1); expect(g.s.top - g.a.bottom).toBeLessThanOrEqual(12); }
  else { expect(g.s.bottom).toBeLessThanOrEqual(g.a.top + 1); expect(g.a.top - g.s.bottom).toBeLessThanOrEqual(12); }
  expect(g.s.width).toBeLessThanOrEqual(maxWidth); // 작은 창(화면 폭 시트 아님)
  expect(g.s.left < g.a.right && g.s.right > g.a.left).toBe(true); // 누른 버튼과 가로로 겹친다
  expect(g.s.left).toBeGreaterThanOrEqual(0); expect(g.s.right).toBeLessThanOrEqual(g.vw);
  expect(g.s.top).toBeGreaterThanOrEqual(0);
  expect(g.s.bottom).toBeLessThanOrEqual(g.floor + 1); // 아래 메뉴 줄과 겹치지 않는다
  if (!firstRow) return g; // 이미 펼치거나 밀어 본 뒤에는 첫 줄 검사를 건너뛴다(열자마자의 검사는 따로)
  expect(g.first).not.toBeNull();
  expect(g.first.top).toBeGreaterThanOrEqual(g.bodyTop - 0.5); // 첫 줄이 목록 위쪽에 잘리지 않는다
  expect(g.first.bottom).toBeLessThanOrEqual(g.s.bottom + 0.5);
  return g;
}
