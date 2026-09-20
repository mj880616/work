import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const url = pathToFileURL(resolve('personal/arsenal-match-archive/index.html')).href;

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`score overview shows scorers, minutes and credited assists at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.locator('#seasonFilter').selectOption('2025-26');

    await page.locator('#archiveList .archive-item').filter({ hasText: '맨체스터 유나이티드 0-1 아스날' }).click();
    await expect(page.locator('.goal-side.home')).toContainText('득점 없음');
    await expect(page.locator('.goal-side.away')).toContainText('13′');
    await expect(page.locator('.goal-side.away')).toContainText('Calafiori');
    await expect(page.locator('.goal-side.away')).toContainText('도움 —');
    await expect(page.locator('.goal-source a')).toHaveAttribute('href', /^https:\/\//);
    await expect(page.locator('.goal-source a')).toHaveAttribute('rel', 'noopener noreferrer');

    await page.locator('#archiveList .archive-item').filter({ hasText: '아스날 2-1 울버햄프턴 원더러스' }).click();
    await expect(page.locator('.goal-side.home .goal-entry.own-goal')).toHaveCount(2);

    await page.locator('#archiveList .archive-item').filter({ hasText: '아스날 0-0 리버풀' }).click();
    await expect(page.locator('.goal-side.home')).toContainText('득점 없음');
    await expect(page.locator('.goal-side.away')).toContainText('득점 없음');

    await page.locator('#competitionFilter').selectOption('UEFA Champions League');
    await page.locator('#archiveList .archive-item').filter({ hasText: '아틀레틱 클루브 0-2 아스날' }).click();
    await expect(page.locator('.goal-side.away .goal-entry').first()).toContainText('도움 Leandro Trossard');
    await page.locator('#archiveList .archive-item').filter({ hasText: '아스날 3-2 카이라트' }).click();
    await expect(page.locator('.goal-source a')).toHaveCount(2);
    await page.locator('#archiveList .archive-item').filter({ hasText: '파리 생제르맹 1-1 아스날' }).click();
    await expect(page.locator('.goal-entry')).toHaveCount(2);
    await expect(page.locator('.goal-entry.penalty')).toHaveCount(1);

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });

  test(`archive filters, reviews and links at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);

    await page.locator('#seasonFilter').selectOption('2025-26');
    await expect(page.locator('#archiveList .archive-item')).toHaveCount(53);
    await page.locator('#competitionFilter').selectOption('Premier League');
    await expect(page.locator('#archiveList .archive-item')).toHaveCount(38);
    await page.getByRole('button', { name: '크리스털 팰리스 1-2 아스날 리뷰 보기' }).click();
    await expect(page.locator('#latestReview .match-review')).toContainText('크리스털 팰리스');
    await expect(page.locator('#latestReview .score')).toHaveText('1–2');
    await expect(page.locator('#latestReview .match-review')).toContainText('38R');

    await page.locator('#competitionFilter').selectOption('UEFA Champions League');
    await expect(page.locator('#archiveList .archive-item')).toHaveCount(15);
    await page.locator('#archiveList .archive-item').filter({ hasText: '파리 생제르맹' }).click();
    await expect(page.locator('#latestReview .match-review')).toContainText('결과 패');
    await expect(page.locator('#latestReview .score')).toHaveText('1–1');
    await expect(page.locator('#latestReview .match-review')).toContainText('승부차기');

    const media = page.locator('#latestReview .media-link');
    expect(await media.count()).toBeGreaterThan(0);
    for (const link of await media.all()) {
      expect(await link.getAttribute('href')).toMatch(/^https:\/\//);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }

    await page.locator('#searchInput').fill('아틀레티코');
    await expect(page.locator('#archiveList .archive-item')).toHaveCount(3);
    await page.locator('#archiveList .archive-item').filter({ hasText: 'Semi-final 1st Leg' }).click();
    await expect(page.locator('#latestReview .match-review')).toContainText('Semi-final 1st Leg');
    await page.locator('#archiveList .archive-item').filter({ hasText: 'Semi-final 2nd Leg' }).click();
    await expect(page.locator('#latestReview .match-review')).toContainText('Semi-final 2nd Leg');

    await page.locator('#searchInput').fill('');
    await page.locator('#competitionFilter').selectOption('all');
    await page.locator('#seasonFilter').selectOption('2026-27');
    await expect(page.locator('#archiveList .archive-item')).toHaveCount(7);
    await page.locator('#archiveList .archive-item').filter({ hasText: '브라이튼' }).click();
    await expect(page.locator('#latestReview .match-review')).toContainText('브라이튼');
    await expect(page.locator('#latestReview .goal-entry')).toHaveCount(3);

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
