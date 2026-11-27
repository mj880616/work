// S71-29 FORGET-머리한줄(사용자 결정 11/26 — 다른 화면처럼 한 줄로):
// 예전: 1줄 [W] 잊지 말기 · 찾기 / 2줄 (빈 칸) · [처리 전 ▾] · 최신화.
// 그 뒤: 한 줄 [W] 잊지 말기 · [처리 전 ▾] · (빈 칸) · 최신화(↻, aria-label '최신화') · 찾기. 따로 된 둘째 줄은 그리지 않는다(숨김 아님).
// 폰·폴드는 앱 머리 줄, PC 틀은 화면 안 첫 줄(.basket-head) 오른쪽 끝(S71-59 UI-화면메뉴안으로 — 맨 위 줄에는 앱 전체 것만). 최신화(찾기 다시)는 예전 그대로 동작한다.
// S71-58 FORGET-처리전만(사용자 결정 11/26): [처리 전 ▾]는 없앴다 → 한 줄 = [W] 잊지 말기 · (빈 칸) · ↻ · 찾기.
// 서버는 흉내(openHome 기본: 후보 없음, ai-assist todo_radar는 건너뜀 답). 글·이름은 지어낸 것.
import {test, expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';

const tools = page => page.locator('[data-sf-tools="forget"]');
const findButton = page => tools(page).locator('[data-inbox-find]');

async function openForget(page, width) {
  await page.setViewportSize({width, height: 900});
  const radar = [];
  await openHome(page);
  page.on('request', req => {
    if (!req.url().endsWith('/functions/v1/ai-assist') || req.method() !== 'POST') return;
    let body = null; try { body = req.postDataJSON(); } catch { body = null; }
    if (body?.kind === 'todo_radar') radar.push(body);
  });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await expect(page.locator('#basketView [data-forget-section]')).toBeVisible();
  await expect(findButton(page)).toBeVisible();
  return {radar};
}
const box = loc => loc.evaluate(el => { const r = el.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom, mid: r.y + r.height / 2}; });

for (const width of [344, 390, 690]) test(`폰·폴드 ${width}: 앱 머리 줄 한 줄 = [W] 잊지 말기 · (빈 칸) · ↻ · 찾기, 따로 된 둘째 줄 없음`, async ({page}) => {
  const f = await openForget(page, width);
  const head = page.locator('#appView > .mobile-shell-header');
  // 단추는 앱 머리 줄 안(화면 안이 아님). 옛 둘째 줄은 그리지 않는다.
  await expect(head.locator('[data-sf-tools="forget"]')).toBeVisible();
  await expect(page.locator('#basketView [data-forget-view-open], #basketView [data-inbox-find]')).toHaveCount(0);
  await expect(page.locator('#basketView .forget-head, #basketView .basket-switch-row')).toHaveCount(0);
  await expect(findButton(page)).toHaveAttribute('aria-label', '최신화');
  await expect(findButton(page).locator('svg')).toHaveCount(1);
  await expect(findButton(page)).toHaveText('');
  const name = await box(head.locator('[data-mobile-view-name]'));
  await expect(page.locator('[data-forget-view-open]')).toHaveCount(0);
  const find = await box(findButton(page)), h = await box(head);
  const search = await box(head.locator('[data-screen-find-slot] > :is(.sf-open, .gs-field):visible').first());
  // 한 줄 높이(머리 줄 44px 이하), 모두 같은 줄 가운데.
  expect(h.h).toBeLessThanOrEqual(44);
  for (const b of [name, find, search]) { expect(Math.abs(b.mid - name.mid)).toBeLessThanOrEqual(3); expect(b.y).toBeGreaterThanOrEqual(h.y - 1); expect(b.bottom).toBeLessThanOrEqual(h.bottom + 1); }
  // 차례: 이름 → ↻ → 찾기. ↻ 바로 뒤가 찾기(머리줄 규칙 '… · 찾기').
  expect(find.x).toBeGreaterThan(name.right - 1);
  expect(search.x).toBeGreaterThan(find.right - 1);
  expect(search.x - find.right).toBeLessThanOrEqual(12);
  // 접은 폰은 이름과 ↻ 사이가 빈 칸(↻는 돋보기 바로 앞, 오른쪽 끝 쪽).
  if (width < 600) { expect(find.x - name.right).toBeGreaterThan(24); expect(h.right - search.right).toBeLessThanOrEqual(4); }
  // 아이콘 단추 크기: 보이는 32px, 누르는 범위 44px(다른 머리 줄 아이콘 단추와 같음).
  expect(Math.round(find.w)).toBe(32); expect(Math.round(find.h)).toBe(32);
  expect(await findButton(page).evaluate(el => getComputedStyle(el, '::after').height)).toBe('44px');
  // 목록은 머리 줄 바로 아래(둘째 줄 자리 없음).
  const list = await box(page.locator('#basketView [data-forget-section]'));
  expect(list.y).toBeGreaterThanOrEqual(h.bottom);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // 최신화: 첫 줄에서 누르면 찾기를 다시 한다(같은 길 — ai-assist todo_radar).
  const before = f.radar.length;
  await expect(findButton(page)).toBeEnabled();
  await findButton(page).click();
  await expect.poll(() => f.radar.length).toBeGreaterThan(before);
  // 폰 찾기를 펼쳐도 같은 한 줄(칸이 남은 폭을 쓴다).
  if (width < 600) {
    await head.locator('[data-screen-find-slot] .sf-open').click();
    const field = await box(head.locator('[data-screen-find-slot] .gs-field'));
    expect(field.w).toBeGreaterThan(120);
    expect(Math.abs(field.mid - h.mid)).toBeLessThanOrEqual(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

// S71-59 UI-화면메뉴안으로 + S71-58 FORGET-처리전만: PC 맨 위 줄은 앱 전체 것만 — ↻는 화면 안 첫 줄(.basket-head) 오른쪽 끝, 보기 단추는 없다.
test('PC 1280: 화면 안 첫 줄 오른쪽 끝 ↻ — 맨 위 줄에는 없음, 따로 된 둘째 줄·보기 단추 없음, 동작 그대로', async ({page}) => {
  const f = await openForget(page, 1280);
  const top = page.locator('#appView > .app-topline');
  const line = page.locator('#basketView > .basket-head');
  await expect(top.locator('[data-sf-tools="forget"]')).toHaveCount(0);
  await expect(line.locator('[data-sf-tools="forget"]')).toBeVisible();
  await expect(page.locator('#basketView .forget-head, #basketView .basket-switch-row, #basketView [data-forget-view-open]')).toHaveCount(0);
  await expect(page.locator('[data-forget-view-open]')).toHaveCount(0);
  const t = await box(top), l = await box(line), find = await box(findButton(page));
  const panel = await box(page.locator('#basketView'));
  expect(Math.abs(find.mid - l.mid)).toBeLessThanOrEqual(3);
  expect(l.y).toBeGreaterThanOrEqual(t.bottom - 1);
  expect(panel.right - find.right).toBeLessThanOrEqual(24); // 오른쪽 끝
  const list = await box(page.locator('#basketView [data-forget-section]'));
  expect(list.y).toBeGreaterThanOrEqual(l.bottom - 1);
  const before = f.radar.length;
  await findButton(page).click();
  await expect.poll(() => f.radar.length).toBeGreaterThan(before);
  // 다른 화면이면 이 단추는 보이지 않는다.
  await page.evaluate(() => window.KPTURouter.go('calendar'));
  await expect(tools(page)).toBeHidden();
});
