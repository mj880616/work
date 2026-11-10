import { test, expect } from '@playwright/test';
import { ANDROID, phonePhotosFixture, openPhotos } from './helpers/phone-photos-fixture.mjs';
// LOAD-끝있는불러오기(S51-29, 요청함 11/06 23:31 ★급★): 폰 앱 [사진] 탭에서 폰 앱이 사진 목록 읽기에 답하지 않으면
// 전에는 회색 빈 줄만 끝없이 남았다(기다림 시간 없는 fetch + 받는 중 약속 하나가 다시 받기를 모두 막음).
// 이제: 한 번 읽기는 25초 안에 끝 → 처음 한 번은 바로 다시 → 또 답이 없으면 '불러오지 못했습니다 · 폰 앱이 답하지 않아요 · [다시]'.
// [다시]·다른 탭 갔다 오기·앱이 다시 앞에 옴(visibilitychange)이면 다시 불러온다. 시계는 Playwright 가짜 시계로 당긴다(기다림 없음).
const PAGE_READ = /(^|\/)page\?/;
const reads = state => state.phoneReads.filter(p => PAGE_READ.test(p)).length;
const ids = page => page.locator('#photosRoot [data-photos-list] [data-photos-open]').evaluateAll(els => els.map(e => e.dataset.photosId));

async function hangingPhone(page) {
  const ctl = { hang: true };
  const { state } = await phonePhotosFixture(page, { app: true });
  // 나중에 건 길이 먼저: hang이면 사진 목록(page) 읽기에 답하지 않는다(앱이 멈춘 것처럼). 아니면 원래 흉내로 넘긴다.
  await page.route('**/__phone/**', r => {
    const u = new URL(r.request().url());
    if (ctl.hang && u.pathname.endsWith('/page')) { state.phoneReads.push(u.pathname.replace(/^.*__phone\//, '') + u.search); return; }
    return r.fallback();
  });
  await page.clock.install();
  return { ctl, state };
}
const foot = page => page.locator('#photosRoot [data-photos-foot]');

test.describe('폰 앱 412 · 끝있는 불러오기', () => {
  test.use({ viewport: { width: 412, height: 915 }, userAgent: ANDROID, hasTouch: true, isMobile: true });

  test('답 없는 폰 출처 → 자동 한 번 다시 → 불러오지 못했습니다 · [다시] → 다시 누르면 보임', async ({ page }) => {
    const { ctl, state } = await hangingPhone(page);
    await openPhotos(page, 412);
    await expect(foot(page).locator('[data-wait]')).toHaveCount(1);
    await expect.poll(() => reads(state)).toBe(1);
    await page.clock.runFor(26000);
    // 처음 시간 초과 = 실패 글 없이 바로 한 번 더 읽는다(회색 빈 줄 그대로).
    await expect.poll(() => reads(state)).toBe(2);
    await expect(foot(page).locator('[data-wait-fail]')).toHaveCount(0);
    await page.clock.runFor(26000);
    const fail = foot(page).locator('[data-wait-fail]');
    await expect(fail).toContainText('불러오지 못했습니다');
    await expect(fail).toContainText('폰 앱이 답하지 않아요');
    await expect(foot(page).locator('[data-wait]')).toHaveCount(0);
    ctl.hang = false;
    await fail.getByRole('button', { name: '다시' }).click();
    await expect.poll(() => ids(page)).toEqual(['ph:1', 'O1', 'ph:2', 'O2', 'O3', 'ph:4']);
    expect(state.errors).toEqual([]);
  });

  test('실패한 뒤 다른 탭 갔다 오기·앱이 다시 앞에 옴 = 다시 불러옴', async ({ page }) => {
    const { ctl, state } = await hangingPhone(page);
    await openPhotos(page, 412);
    await expect.poll(() => reads(state)).toBe(1);
    await page.clock.runFor(26000);
    await expect.poll(() => reads(state)).toBe(2);
    await page.clock.runFor(26000);
    await expect(foot(page).locator('[data-wait-fail]')).toHaveCount(1);
    // 앱이 다시 앞에 옴(여전히 답 없음) → 다시 읽기 시작(회색 빈 줄) → 끝이 있음.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(() => reads(state)).toBe(3);
    await expect(foot(page).locator('[data-wait]')).toHaveCount(1);
    await page.clock.runFor(26000);
    await expect.poll(() => reads(state)).toBe(4);
    await page.clock.runFor(26000);
    await expect(foot(page).locator('[data-wait-fail]')).toHaveCount(1);
    // 폰 앱이 다시 답함 → [달력] 갔다 [사진]으로 돌아오면 다시 불러와 보인다.
    ctl.hang = false;
    await page.locator('#photosRoot [data-photos-view]').selectOption('calendar');
    await page.locator('#photosRoot [data-photos-view]').selectOption('all');
    await expect.poll(() => ids(page)).toEqual(['ph:1', 'O1', 'ph:2', 'O2', 'O3', 'ph:4']);
    await expect(foot(page).locator('[data-wait-fail]')).toHaveCount(0);
    expect(state.errors).toEqual([]);
  });
});
