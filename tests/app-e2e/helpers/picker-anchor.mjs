import { expect } from '@playwright/test';
// S54-04 UI-고르기창버튼아래(11/08 명진 결정 B): 버튼으로 연 공용 고르기 창(app/library-move-picker.js, place 'below')은
// 폰·폴드·PC 모두 누른 버튼 바로 아래(아래 자리가 모자라면 바로 위) 작은 창이다. 이 검사가 지키는 것:
// ① 창이 버튼 바로 아래(또는 위)에 붙고 버튼과 가로로 겹친다(화면 아래에서 올라오는 넓은 시트가 아님),
// ② 아래 바(하단바·전환 줄)·창 밖으로 나가지 않는다, ③ 목록 첫 줄이 찾기 칸에 가리지 않고 다 보인다(목록 맨 위에서 시작).
export async function expectPickerAtButton(page, picker, anchor) {
  await expect(picker).toBeVisible();
  await page.waitForTimeout(80); // followAnchor는 다음 화면 그림 때 자리를 다시 맞춘다
  const g = await page.evaluate(([p, a]) => {
    const pr = p.getBoundingClientRect(), ar = a.getBoundingClientRect(), list = p.querySelector('.lu-move-list'), lr = list.getBoundingClientRect();
    const find = p.querySelector('.lu-move-find').getBoundingClientRect(), first = list.querySelector('.lu-move-item')?.getBoundingClientRect();
    const cs = getComputedStyle(document.documentElement), v = n => parseFloat(cs.getPropertyValue(n)) || 0;
    const tabs = document.querySelector('nav.mobile-tabs'), tr = tabs && getComputedStyle(tabs).display !== 'none' ? tabs.getBoundingClientRect() : null;
    const floor = Math.min(innerHeight - v('--kptu-mobile-tab-height') - v('--kptu-switch-dock'), tr && tr.height ? tr.top : innerHeight);
    return { p: { top: pr.top, bottom: pr.bottom, left: pr.left, right: pr.right, width: pr.width }, a: { top: ar.top, bottom: ar.bottom, left: ar.left, right: ar.right },
      side: p.dataset.anchorSide || '', sheet: p.classList.contains('lu-move-sheet'), scrollTop: list.scrollTop, findBottom: find.bottom, listTop: lr.top,
      first: first ? { top: first.top, bottom: first.bottom } : null, floor, vw: document.documentElement.clientWidth };
  }, [await picker.elementHandle(), await anchor.elementHandle()]);
  expect(g.sheet).toBe(false);
  expect(['below', 'above']).toContain(g.side);
  if (g.side === 'below') { expect(g.p.top).toBeGreaterThanOrEqual(g.a.bottom - 1); expect(g.p.top - g.a.bottom).toBeLessThanOrEqual(12); }
  else { expect(g.p.bottom).toBeLessThanOrEqual(g.a.top + 1); expect(g.a.top - g.p.bottom).toBeLessThanOrEqual(12); }
  expect(g.p.width).toBeLessThanOrEqual(260); // 작은 창(화면 폭 시트 아님)
  expect(g.p.left < g.a.right && g.p.right > g.a.left).toBe(true); // 누른 버튼과 가로로 겹친다
  expect(g.p.left).toBeGreaterThanOrEqual(0); expect(g.p.right).toBeLessThanOrEqual(g.vw);
  expect(g.p.top).toBeGreaterThanOrEqual(0);
  expect(g.p.bottom).toBeLessThanOrEqual(g.floor + 1); // 아래 메뉴 줄과 겹치지 않는다
  expect(g.scrollTop).toBe(0);
  expect(g.first).not.toBeNull();
  expect(g.first.top).toBeGreaterThanOrEqual(g.findBottom - 0.5); // 첫 줄이 찾기 칸에 가리지 않는다
  expect(g.first.top).toBeGreaterThanOrEqual(g.listTop - 0.5);
  expect(g.first.bottom).toBeLessThanOrEqual(g.p.bottom + 0.5);
  return g;
}
