// S67-76(사용자 11/21 "이 화면 전체화면으로"): 잠긴 기능을 열면 뜨는 잠금 숫자 판(#lockView)은 폰 잠금 화면처럼 윗줄·하단바까지 덮는다.
// 덮인 하단바·윗줄은 눌리지 않고(그 자리를 누르면 잠금 화면이 받음), 판은 화면 안·가로 넘침 없음, 왼쪽 위 [✕]·뒤로 가기는 이전 화면,
// 넓은 화면(880)에서는 판 폭이 커지지 않는다. 설정 목록(계정 메뉴 [잠금])은 덮지 않는다. 서버(app_lock_*)는 흉내, 값은 모두 합성.
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const lockServer = async page => {
  await page.route(u => u.origin === SB && u.pathname.startsWith('/rest/v1/rpc/app_lock_'), async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const json = v => route.fulfill({ contentType: 'application/json', body: JSON.stringify(v) });
    if (name === 'app_lock_read') return json({ has_pin: true, features: ['diary'], relock: '5m', left: 5, blocked_until: null });
    if (name === 'app_lock_check') return json({ ok: (route.request().postDataJSON() || {}).p_pin === '1234', left: 4, blocked_until: null });
    return route.fulfill({ status: 404, body: '' });
  });
};
const go = (page, view) => page.evaluate(v => window.KPTURouter.go(v, { source: 'delegated' }), view);
const current = page => page.evaluate(() => window.KPTURouter.current);
const lockView = page => page.locator('#lockView');

// 덮인 윗줄·하단바: 보이는 단추마다 그 가운데를 누르면 잠금 화면이 받는지(가려진 단추가 눌리지 않음).
async function coversShell(page) {
  const hits = await page.evaluate(() => {
    const view = document.getElementById('lockView');
    const out = [];
    for (const el of document.querySelectorAll('.mobile-tabs a, .mobile-tabs button, .mobile-shell-header a, .mobile-shell-header button, .topbar a, .topbar button')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom <= 0 || r.top >= innerHeight) continue;
      const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
      out.push(view.contains(document.elementFromPoint(x, y)));
    }
    return out;
  });
  expect(hits.length).toBeGreaterThan(0);
  expect(hits.every(Boolean)).toBe(true);
}

for (const width of [390, 412]) {
  test(`폰 ${width}: 잠금 숫자 판이 화면 전체(윗줄·하단바 덮음) · 판은 화면 안 · [✕]와 뒤로 가기는 이전 화면`, async ({ page }) => {
    await page.setViewportSize({ width, height: 860 });
    await openHome(page, { beforeLoad: () => lockServer(page) });
    await go(page, 'diary');
    await expect(page.locator('#lockView .lk-pad .lk-title')).toHaveText('하루 기록 잠김');
    await expect(lockView(page)).toHaveAttribute('data-lk-full', '');
    const box = await lockView(page).boundingBox();
    expect([box.x, box.y, box.width, box.height]).toEqual([0, 0, width, 860]);
    await coversShell(page);
    // 판(숫자 칸 12개·✕)은 화면 안, 가로 넘침 없음, 카드 테두리 없음.
    const keys = await page.locator('#lockView .lk-key, #lockView .lk-close').evaluateAll(list => list.map(el => el.getBoundingClientRect()).map(r => [r.left, r.right, r.top, r.bottom]));
    expect(keys.length).toBe(13);
    for (const [l, r, t, b] of keys) { expect(l).toBeGreaterThanOrEqual(0); expect(r).toBeLessThanOrEqual(width); expect(t).toBeGreaterThanOrEqual(0); expect(b).toBeLessThanOrEqual(860); }
    expect(await lockView(page).evaluate(el => el.scrollWidth <= el.clientWidth && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('#lockView .lk-view').evaluate(el => getComputedStyle(el).borderTopWidth)).toBe('0px');
    // 판은 세로 가운데보다 살짝 위.
    const padBox = await page.locator('#lockView .lk-pad').boundingBox();
    const mid = padBox.y + padBox.height / 2;
    expect(mid).toBeLessThan(860 / 2 + 4);
    expect(mid).toBeGreaterThan(860 * 0.3);
    // 뒤로 가기는 이전 화면(홈) — 지금 동작 그대로.
    await page.goBack();
    await expect.poll(() => current(page)).toBe('home');
    await expect(lockView(page)).toBeHidden();
    await expect(page.locator('.mobile-tabs')).toBeVisible();
    // [✕]도 이전 화면(홈), 하단바가 다시 보이고 눌린다.
    await go(page, 'diary');
    await expect(page.locator('#lockView .lk-pad')).toBeVisible();
    await page.locator('#lockView [data-lk-close]').click();
    await expect.poll(() => current(page)).toBe('home');
    await expect(lockView(page)).toBeHidden();
    await expect(page.locator('.mobile-tabs')).toBeVisible();
  });
}

test('폰 390: 처음부터 잠긴 화면으로 열어도 [✕]는 홈으로 · 맞는 PIN이면 그 기능이 열리고 하단바가 돌아옴', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHome(page, { beforeLoad: () => lockServer(page), query: '?view=diary' });
  await expect(page.locator('#lockView .lk-pad .lk-title')).toHaveText('하루 기록 잠김', { timeout: 20000 });
  await expect(lockView(page)).toHaveAttribute('data-lk-full', '');
  await page.locator('#lockView [data-lk-close]').click();
  await expect.poll(() => current(page)).toBe('home');
  await go(page, 'diary');
  for (const d of '1234') await page.locator(`#lockView [data-lk-key="${d}"]`).click();
  await expect(page.locator('#diaryView')).toBeVisible();
  await expect(lockView(page)).toBeHidden();
  await expect(page.locator('.mobile-tabs')).toBeVisible();
});

test('880: 전체를 덮되 판 폭은 320px까지 가운데 · 설정 목록(계정 메뉴 [잠금])은 덮지 않음', async ({ page }) => {
  await page.setViewportSize({ width: 880, height: 900 });
  await openHome(page, { beforeLoad: () => lockServer(page) });
  await go(page, 'diary');
  await expect(page.locator('#lockView .lk-pad')).toBeVisible();
  const box = await lockView(page).boundingBox();
  expect([box.x, box.y, box.width, box.height]).toEqual([0, 0, 880, 900]);
  const pad = await page.locator('#lockView .lk-pad').boundingBox();
  expect(pad.width).toBeLessThanOrEqual(320);
  expect(Math.abs(pad.x + pad.width / 2 - 440)).toBeLessThan(2);
  const keys = await page.locator('#lockView .lk-keys').boundingBox();
  expect(keys.width).toBeLessThanOrEqual(300);
  await page.locator('#lockView [data-lk-close]').click();
  await expect.poll(() => current(page)).toBe('home');
  await go(page, 'lock');
  await expect(page.locator('#lockView .lk-list')).toBeVisible();
  await expect(lockView(page)).not.toHaveAttribute('data-lk-full', '');
  expect(await lockView(page).evaluate(el => getComputedStyle(el).position)).not.toBe('fixed');
  await expect(page.locator('#lockView [data-lk-close]')).toHaveCount(0);
});
