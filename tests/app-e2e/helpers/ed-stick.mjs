import { expect } from '@playwright/test';
// NOTE-제목서식줄고정(S61-16 ②): 편집기 위 띠(.ed-stick = 제목 칸·서식 줄)가 본문을 아래로 내려도 보이는 자리에 남는지 본다.
// root: 편집기를 품은 칸(locator). 편집기를 감싼 스크롤 칸(없으면 문서)을 끝까지 내린 뒤, 서식 줄 가운데 점에 실제로 서식 줄이 보이고
// (맨 위 줄 등 다른 것에 가리지 않음) 띠가 화면 안에 있는지 확인한다. 돌려주는 값: {band, bar, scrolled}.
export async function expectStickyBand(page, root) {
  const band = root.locator('.ed-stick').first();
  await expect(band).toBeVisible();
  const result = await band.evaluate(el => {
    const scroller = (() => { for (let n = el.parentElement; n; n = n.parentElement) { const s = getComputedStyle(n).overflowY; if (/(auto|scroll)/.test(s) && n.scrollHeight > n.clientHeight + 1) return n; } return document.scrollingElement; })();
    scroller.scrollTop = 0; const before = scroller.scrollTop; scroller.scrollTop = scroller.scrollHeight; const scrolled = scroller.scrollTop - before;
    const bar = el.querySelector('.ed-bar'), b = bar.getBoundingClientRect(), r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + 12, b.top + b.height / 2);
    const vv = window.visualViewport;
    return {scrolled, bandTop: r.top, bandBottom: r.bottom, barTop: b.top, barShown: !!hit && bar.contains(hit), viewH: vv ? vv.height : innerHeight};
  });
  expect(result.scrolled).toBeGreaterThan(200);
  expect(result.barShown).toBe(true);
  expect(result.bandTop).toBeGreaterThanOrEqual(-1);
  expect(result.bandBottom).toBeLessThan(result.viewH);
  return result;
}
