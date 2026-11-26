import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S71-64 PHOTO-위로넘기기(사용자 11/26 22:40·22:42): 특정 달로 건너뛰어도 위로 넘기면 더 최근 달, 아래로 넘기면 더 옛날 달이 이어진다.
// 위쪽이 붙을 때 보던 칸은 화면에서 같은 자리. 'YYYY.MM부터 보는 중' 줄은 없고, 맨 위로는 머리 줄 아이콘 단추 '최신으로'.
// 가짜 사진(1x1 그림)과 지어낸 Supabase 응답만 쓴다. 2024-01 ~ 2026-10 달마다 30장(첫 쪽 120장 = 넉 달이라 2026.04는 처음에 안 받힘).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const pad = n => String(n).padStart(2, '0');
const newest = (a, b) => b.taken_at.localeCompare(a.taken_at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
function makeMedia() {
  const out = [];
  for (let y = 2024; y <= 2026; y++) for (let m = 1; m <= 12; m++) {
    if (y === 2026 && m > 10) continue;
    for (let i = 0; i < 30; i++) { const day = `${y}-${pad(m)}-${pad(1 + (i % 28))}`; out.push({ id: `P${y}${pad(m)}${pad(i)}`, name: 'p.jpg', day, taken_at: `${day}T0${i % 9}:${pad(i)}:00.000Z`, approx: false, kind: 'photo', screenshot: false, duration_ms: null }); }
  }
  return out.sort(newest);
}
async function fixture(page, width) {
  const media = makeMedia();
  const gate = { open: false, waiters: [], upCalls: 0 };
  gate.release = () => { gate.open = true; for (const w of gate.waiters.splice(0)) w(); };
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => { window.KPTUOdWarm = { run: () => null }; });
  await openHome(page);
  await installViewPrefsServer(page);
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => r.fulfill({ json: [] }));
  await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
    const body = r.request().postDataJSON();
    if (body.action === 'photo') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true } });
    if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false } });
    if (body.action === 'library') {
      const c = body.cursor;
      // 달 끝 기준(id '!')이면서 2026.04 끝보다 뒤 = 위쪽(더 최근)을 받는 요청. 시험이 보던 자리를 잰 뒤에 답한다.
      if (c && c.id === '!' && c.t > '2026-05-01') { gate.upCalls++; if (!gate.open) await new Promise(ok => gate.waiters.push(ok)); }
      const list = media.filter(m => !c || m.taken_at < c.t || (m.taken_at === c.t && m.id < c.id));
      const items = list.slice(0, body.limit), more = list.length > body.limit;
      return r.fulfill({ json: { items, next_cursor: more ? { t: items.at(-1).taken_at, id: items.at(-1).id } : null, indexing: false } });
    }
    if (body.action === 'months') {
      const months = {};
      for (const m of media) months[m.day.slice(0, 7)] = (months[m.day.slice(0, 7)] || 0) + 1;
      return r.fulfill({ json: { months, total: media.length } });
    }
    return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
  });
  return gate;
}
async function openPhotos(page, width) {
  if (width <= 760) {
    if (await page.locator('.mobile-tabs [data-view="photos"]').isVisible()) await page.locator('.mobile-tabs [data-view="photos"]').click();
    else { await page.locator('#mobileMenuTab').click(); await page.locator('#mobileMenu nav').getByRole('button', { name: '사진', exact: true }).click(); }
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '사진', exact: true }).click();
  await expect(page.locator('#photosView')).toBeVisible();
}
const root = page => page.locator('#photosRoot');
const dayOf = (page, key) => root(page).locator(`[data-photos-day^="${key}"]`);
// 막대에서 키보드로 그 달(맨 위 최신 달에서 k칸 아래)로 건너뛴다.
async function jumpDown(page, k) {
  const rail = root(page).locator('[data-photos-rail]');
  await expect(rail).toHaveAttribute('aria-valuemax', /\d+/);
  await rail.focus();
  for (let i = 0; i < k; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
}

for (const [width, touch] of [[390, true], [1280, false]]) {
  test.describe(`사진 양쪽 넘기기 ${width}`, () => {
    test.use({ hasTouch: touch, isMobile: touch });
    test('2026.04로 건너뛴 뒤 위로 넘기면 2026.05 이후, 보던 자리 그대로 · 아래로 넘기면 2026.03 이전 · [최신으로] 아이콘', async ({ page }) => {
      const gate = await fixture(page, width);
      await openPhotos(page, width);
      await expect(dayOf(page, '2026-10').first()).toBeVisible();
      const newestBtn = page.getByRole('button', { name: '최신으로', exact: true });
      await expect(newestBtn).toBeHidden();
      await jumpDown(page, 6); // 2026-10 → 2026-04
      const april = dayOf(page, '2026-04').first();
      await expect(april).toBeInViewport();
      await expect(dayOf(page, '2026-05')).toHaveCount(0);
      // 예전 글자 줄은 없고, 맨 위로는 아이콘 단추 하나.
      await expect(root(page).getByText('부터 보는 중')).toHaveCount(0);
      await expect(newestBtn).toBeVisible();
      expect(await newestBtn.locator('svg').count()).toBe(1);
      expect((await newestBtn.textContent()).trim()).toBe('');
      // 위쪽을 받기 시작했다(답은 잠시 붙잡아 둔다) → 보던 자리를 잰 뒤 답을 보낸다.
      await expect.poll(() => gate.upCalls).toBeGreaterThan(0);
      const before = (await april.boundingBox()).y;
      gate.release();
      await expect(dayOf(page, '2026-05').first()).toBeAttached();
      expect(Math.abs((await april.boundingBox()).y - before)).toBeLessThanOrEqual(2);
      // 위로 넘기면 더 최근 달이 차례로 이어져 맨 위 2026.10까지.
      for (let i = 0; i < 40 && !(await dayOf(page, '2026-10').count()); i++) await page.mouse.wheel(0, -1500).then(() => page.waitForTimeout(150));
      await expect(dayOf(page, '2026-10').first()).toBeAttached();
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(dayOf(page, '2026-10').first()).toBeInViewport();
      for (const key of ['2026-09', '2026-08', '2026-07', '2026-06', '2026-05']) await expect(dayOf(page, key).first()).toBeAttached();
      // 아래로 넘기면 2026.03 이전.
      await april.scrollIntoViewIfNeeded();
      for (let i = 0; i < 40 && !(await dayOf(page, '2026-02').count()); i++) await page.mouse.wheel(0, 1500).then(() => page.waitForTimeout(150));
      await expect(dayOf(page, '2026-03').first()).toBeAttached();
      await expect(dayOf(page, '2026-02').first()).toBeAttached();
      // [최신으로]: 맨 위 최신 사진부터, 단추는 사라진다.
      await newestBtn.click();
      await expect(dayOf(page, '2026-10').first()).toBeInViewport();
      await expect(newestBtn).toBeHidden();
      const nb = await page.getByRole('button', { name: '최신으로' }).evaluateAll(els => els.length);
      expect(nb).toBe(0);
    });
    test('[최신으로] 단추는 누르는 범위 44px', async ({ page }) => {
      await fixture(page, width).then(g => g.release());
      await openPhotos(page, width);
      await expect(dayOf(page, '2026-10').first()).toBeVisible();
      await jumpDown(page, 6);
      const btn = page.getByRole('button', { name: '최신으로', exact: true });
      await expect(btn).toBeVisible();
      const hit = await btn.evaluate(el => { const a = getComputedStyle(el, '::after'); return Math.max(el.getBoundingClientRect().height, parseFloat(a.height) || 0); });
      expect(hit).toBeGreaterThanOrEqual(44);
      await expect(btn).toHaveAttribute('title', '최신으로');
    });
  });
}
