import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { basketKindButton } from './helpers/basket-kind.mjs';

// S70-15 QA-간헐실패(memo-more-targets 텔레그램 390): 아직 받지 못한 화면을 연 뒤, 그 화면이 오기 전에 폰 [메뉴] 창을 열면
// 늦게 온 화면이 창 밑에서 바뀌며 새 기록 칸을 창의 기록 칸 위에 쌓고 창 표시(kptuMobileMenu)까지 물려받았다. 그다음 창에서
// [노트]를 누르면 창을 닫는 뒤로가기가 앞 화면으로 돌아가고, 뒤로가기가 한 번 더 일어나 노트 대신 홈이 남았다.
// 이제 창을 연 것은 '기다리는 동안 연 것'으로 보아 늦게 온 화면으로 바꾸지 않는다(app-router.js, 앞선 STAB-노트폴더시험 규칙과 같은 뜻).
// 화면 프로그램 도착을 시험이 붙잡았다가 놓아, 늘 같은 순서로 재현한다.
test.use({ hasTouch: true });

test('폰: 화면이 오기 전에 연 [메뉴] 창 — 늦게 온 화면이 창 밑에서 바뀌지 않고, 창의 [노트]가 노트를 연다. 뒤로가기는 앞 화면으로 (390)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  let release;
  const held = new Promise(r => { release = r; });
  await openHome(page, { beforeLoad: async () => {
    await page.route(u => u.pathname === '/app/basket.js', async r => { await held; await r.fallback(); });
  } });
  await expect(page.locator('#homeView')).toBeVisible();
  expect(await page.evaluate(() => window.KPTUViewLoader.isLoaded('basket'))).toBe(false);
  const homeUrl = page.url();

  // 잊지 말기 화면을 부른다(프로그램은 아직 오지 않음) → 오기 전에 [메뉴] 창을 연다.
  expect(await page.evaluate(() => window.KPTURouter.go('basket'))).toBe(false);
  await page.locator('#mobileMenuTab').tap();
  await expect(page.locator('#mobileMenu')).toBeVisible();
  release();
  await expect.poll(() => page.evaluate(() => window.KPTUViewLoader.isLoaded('basket'))).toBe(true);
  // 늦게 온 화면 바꾸기는 프로그램을 받은 바로 다음에 일어난다. 한 번 더 그려질 틈을 준 뒤에도 창 밑은 홈 그대로다.
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))));
  await expect(page.locator('#homeView')).toBeVisible();
  await expect(page.locator('#basketView')).toBeHidden();
  await expect(page.locator('#mobileMenu')).toBeVisible();
  expect(page.url()).toBe(homeUrl);

  // 창의 [노트] → 노트 쪽이 열리고 창은 닫힌다.
  await basketKindButton(page, 'note').tap();
  await expect(page.locator('#basketView')).toHaveAttribute('data-kind', 'note');
  await expect(page.locator('#basketView')).toBeVisible();
  await expect(page.locator('#mobileMenu')).toBeHidden();
  await expect(page).toHaveURL(/[?&]view=basket(&|$)/);
  // 뒤로가기는 앞 화면(홈)으로 한 번. 창의 기록 칸이 남아 두 번 눌러야 하지 않는다.
  await page.goBack();
  await expect(page.locator('#homeView')).toBeVisible();
  expect(page.url()).toBe(homeUrl);
  expect(errors).toEqual([]);
});
