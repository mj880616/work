import { expect } from '@playwright/test';
// NAV-조직사업합침(2026-11-28 사용자 결정): 주간 보고는 홈 [하루 | 주간 보고] 전환이 아니라 [조직·사업] 메뉴의 세 번째 큰 탭이다
// (라우터 이름 weekly — 업무일지 칸 #homeView/#journalRoot의 주간 쪽, 내용·확정 막대·동작은 그대로).
// 주간 보고 화면 시험은 이 길로 들어가고 나온다. 메뉴로 들어가는 길 자체는 tests/app-e2e/nav-org-biz-merge.spec.mjs가 지킨다.

/** [조직·사업] › [주간 보고]를 연다(이미 그 화면이면 그대로). 다른 화면에서 누른 것과 같은 라우터 길(기록 칸 하나). */
export async function openWeeklyTab(page) {
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
  await page.evaluate(() => { if (window.KPTURouter?.current !== 'weekly') window.KPTURouter?.go?.('weekly', { source: 'delegated' }); });
  await expect(page.locator('#homeView [data-orgbiz-tabs] [data-view="weekly"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#journalRoot')).toHaveAttribute('data-journal-mode', 'week');
}

/** 홈([하루])으로 돌아온다 — 메뉴 [홈]과 같은 길. */
export async function openDayHome(page) {
  await page.evaluate(() => { if (window.KPTURouter?.current !== 'home') window.KPTURouter?.go?.('home', { source: 'delegated' }); });
  await expect(page.locator('#journalRoot')).toHaveAttribute('data-journal-mode', 'day');
  await expect(page.locator('#homeView [data-orgbiz-tabs]')).toBeHidden();
}

/** 주간 보고 탭이 켜졌는지(옛 '[주간 보고] 단추 aria-pressed=true' 자리). */
export async function expectWeeklyTab(page) {
  await expect(page.locator('#homeView [data-orgbiz-tabs] [data-view="weekly"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#journalRoot')).toHaveAttribute('data-journal-mode', 'week');
}
