import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';

// PERF-첫로딩 P2(docs/design/first-load.md 6절): 홈 [주간 정리]·한글 파일 상자·다음 주 준비 모듈(journal-weekly-kit.js)은
// 홈 첫 화면이 보이기 전에는 받지 않는다. 하루 화면이면 보인 뒤 쉬는 틈에 받아 두고, 아직 안 왔을 때 [주간 정리]를 처음 누르면
// 기다림 표시 → 오면 그 자리에 그린다. 받기에 실패하면 [다시 시도]로 다시 부른다. 명진 결정: 첫 클릭이 0.5초쯤 늦어도 된다.
const KIT = /\/app\/journal-weekly-kit\.js(\?|$)/;
const DEFERRED = /\/app\/(journal-weekly-kit|journal-hwpx|journal-weekly|weekly-flow-cells|next-week-sheet-data)\.js(\?|$)/;

function watchScripts(page) {
  const seen = [];
  page.on('request', request => {
    if (DEFERRED.test(request.url())) seen.push({ url: new URL(request.url()).pathname, ready: false });
  });
  return seen;
}
const weekly = page => page.locator('#journalRoot [data-journal-weekly]');
const chapters = page => page.locator('#journalRoot [data-journal-weekly-chapter] > h4');

test('홈 첫 화면이 보이기 전에는 주간 정리 모듈을 받지 않고, 보인 뒤 쉬는 틈에 받아 두어 첫 클릭에 바로 그린다', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  let readyAt = 0;
  const before = [];
  await page.exposeFunction('__kitReady', () => { readyAt = Date.now(); });
  page.on('request', request => { if (DEFERRED.test(request.url()) && !readyAt) before.push(new URL(request.url()).pathname); });
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (document.querySelector('#appView')?.classList.contains('kptu-ui-ready') && !window.__kitMarked) { window.__kitMarked = true; window.__kitReady(); }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
  });
  const kit = page.waitForRequest(KIT);
  await openHome(page);
  await expect(page.locator('#journalRoot [data-journal-day]')).toBeVisible();
  await kit; // 보인 뒤 쉬는 틈에 받는다
  expect(readyAt).toBeGreaterThan(0);
  expect(before).toEqual([]);
  await page.waitForFunction(() => !!document.querySelector('#journalRoot') && window.KPTUJournal);
  await page.locator('#journalRoot [data-journal-mode="week"]').click();
  await expect(chapters(page)).toHaveText(['1. 요청사항', '2. 기본·영역·의제 사업', '3. 투쟁 사업장 현황', '4. 산하 조직 현황', '5. 주요 일정']);
  await expect(page.locator('#journalRoot [data-journal-weekly-title]')).toHaveText('주간 정리 · 10월 5일 월요일 ~ 10월 11일 일요일');
  await expect(page.locator('#journalRoot [data-weekly-flow-confirm] [data-hwpx-confirm]')).toBeVisible();
  await page.locator('#journalRoot [data-journal-mode="day"]').click();
  await expect(page.locator('#journalRoot [data-journal-day]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('[주간 정리] 첫 클릭 때 모듈이 아직 오는 중이면 기다림 표시 → 오면 그 자리에 그린다', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route(KIT, async route => { await held; await route.continue(); });
  await openHome(page);
  await expect(page.locator('#journalRoot [data-journal-day]')).toBeVisible();
  await page.locator('#journalRoot [data-journal-mode="week"]').click();
  await expect(page.locator('#journalRoot [data-journal-mode="week"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#journalRoot [data-journal-weekly-title]')).toHaveText('주간 정리 · 10월 5일 월요일 ~ 10월 11일 일요일');
  await expect(weekly(page).locator('[data-journal-kit-wait] [data-wait]')).toBeVisible();
  await expect(chapters(page)).toHaveCount(0);
  release();
  await expect(chapters(page)).toHaveCount(5);
  await expect(weekly(page).locator('[data-journal-kit-wait]')).toHaveCount(0);
  await expect(page.locator('#journalRoot [data-journal-next-week]')).not.toBeEmpty();
  expect(errors).toEqual([]);
});

test('[주간 정리] 모듈 받기에 실패하면 안내와 [다시], 누르면 다시 열어(주소 그대로) 주간 정리를 그린다', async ({ page }) => {
  let fail = true;
  await page.route(KIT, route => (fail ? route.abort() : route.continue()));
  await openHome(page);
  await expect(page.locator('#journalRoot [data-journal-day]')).toBeVisible();
  await page.locator('#journalRoot [data-journal-mode="week"]').click();
  const retry = weekly(page).locator('[data-journal-kit-retry]');
  await expect(retry).toBeVisible();
  await expect(weekly(page).locator('[data-wait-fail]')).toBeVisible();
  await expect(page).toHaveURL(/mode=week/);
  fail = false;
  await retry.click();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 }); // openHome과 같은 첫 화면 기다림
  await expect(page.locator('#journalRoot [data-journal-mode="week"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(chapters(page)).toHaveCount(5);
});

test('주소가 [주간 정리](?mode=week)면 새로고침 뒤에도 바로 그 화면을 그린다', async ({ page }) => {
  const seen = watchScripts(page);
  await openHome(page);
  await page.locator('#journalRoot [data-journal-mode="week"]').click();
  await expect(chapters(page)).toHaveCount(5);
  await expect(page).toHaveURL(/mode=week/);
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 }); // openHome과 같은 첫 화면 기다림
  await expect(page.locator('#journalRoot [data-journal-mode="week"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(chapters(page)).toHaveCount(5);
  expect(seen.length).toBeGreaterThan(0);
});
