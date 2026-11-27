import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S73-14 PHOTO-손잡이잡기넓힘(사용자 11/28 "2026년 6월 부분 잡아도 잡히게 … 바 부분도 터치영역 조금 관대하게", 표준 J3):
// 폰 412 진짜 터치(CDP)로 ① 날짜 말풍선을 잡고 끌면 손잡이와 같은 끌기(날짜 이동) ② 손잡이 옆 20px·막대 위 끝 바깥 12px도 잡힘
// ③ 손잡이가 숨은 뒤 말풍선 자리 누르기는 사진으로 간다 ④ 놓은 뒤 숨는다. 가짜 사진 칸(1x1 그림)과 지어낸 Supabase 응답만 쓴다.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const pad = n => String(n).padStart(2, '0');
const newest = (a, b) => b.taken_at.localeCompare(a.taken_at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
// years해 동안, 해마다 1·6·12월에 사진(해에 따라 장수 1~3장 — 사진이 적은 해가 몰리게).
// crowd: 2015년 이전 해는 사진이 많아(달마다 30장 더) 최근 해 눈금이 막대 위쪽에 몰린다(스크린샷의 붙어 보이던 모양).
function makeMedia(years, crowd = false) {
  const out = [];
  for (let y = 0; y < years; y++) {
    const year = 2026 - y;
    for (const m of [12, 6, 1]) {
      if (year === 2026 && m > 10) continue;
      const n = 1 + ((y + m) % 3) + (crowd && year < 2015 ? 30 : 0);
      for (let i = 0; i < n; i++) { const day = `${year}-${pad(m)}-${pad(10 + i)}`; out.push({ id: `P${year}${pad(m)}${i}`, name: 'p.jpg', day, taken_at: `${day}T0${i + 1}:00:00.000Z`, approx: false, kind: 'photo', screenshot: false, duration_ms: null }); }
    }
  }
  return out;
}
async function fixture(page, { width, years, crowd = false }) {
  const media = makeMedia(years, crowd);
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
      const list = media.filter(m => !c || m.taken_at < c.t || (m.taken_at === c.t && m.id < c.id)).sort(newest);
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
}
async function openPhotos(page, width) {
  if (width <= 760) {
    // S68-37: 저장된 메뉴 순서가 없는 계정은 [사진]이 기본 하단바 칸, 순서를 저장한 계정은 [메뉴] 창 칸이다.
    if (await page.locator('.mobile-tabs [data-view="photos"]').isVisible()) await page.locator('.mobile-tabs [data-view="photos"]').click();
    else { await page.locator('#mobileMenuTab').click(); await page.locator('#mobileMenu nav').getByRole('button', { name: '사진', exact: true }).click(); }
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '사진', exact: true }).click();
  await expect(page.locator('#photosView')).toBeVisible();
}
const root = page => page.locator('#photosRoot');
const railOf = page => root(page).locator('[data-photos-rail]');
const box = async loc => (await loc.boundingBox());



const railShown = rail => rail.evaluate(el => !el.hidden && el.classList.contains('is-awake') && getComputedStyle(el).pointerEvents !== 'none');
const W = 412;
async function setup(page) {
  await fixture(page, { width: W, years: 10 });
  await openPhotos(page, W);
  const rail = railOf(page), chip = rail.locator('[data-photos-rail-bubble]');
  await expect(root(page).locator('[data-photos-day]').first()).toBeVisible();
  const wake = async () => { await page.mouse.move(W / 2, 500); await page.mouse.wheel(0, 300); await expect(rail).toHaveClass(/is-awake/); await expect(chip).toBeVisible(); };
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  return { rail, chip, wake, touch };
}
const isDrag = rail => rail.evaluate(el => el.classList.contains('is-drag'));

test.describe('사진 빠른 이동 손잡이 잡기 넓힘 412', () => {
  test.use({ hasTouch: true, isMobile: true });
  test('① 날짜 말풍선을 잡고 끌면 손잡이를 잡은 것과 같이 날짜가 옮겨진다', async ({ page }) => {
    const { rail, chip, wake, touch } = await setup(page);
    await wake();
    const before = await chip.textContent();
    const c = await box(chip);
    const x = c.x + c.width / 2, y = c.y + c.height / 2;
    await touch('touchStart', x, y);
    await expect.poll(() => isDrag(rail)).toBe(true);
    for (let i = 1; i <= 8; i++) { await touch('touchMove', x, y + i * 40); await page.waitForTimeout(40); }
    await expect(chip).toBeVisible();
    await expect(chip).not.toHaveText(before);
    const dragged = await chip.textContent();
    await page.waitForTimeout(2200); // 잡고 있는 동안은 숨지 않는다(#3273)
    await expect(chip).toBeVisible();
    await touch('touchEnd');
    await expect(rail).not.toHaveClass(/is-drag/);
    await expect(rail).toHaveAttribute('aria-valuetext', dragged);
    // ④ 놓은 뒤에는 숨는다.
    await expect(chip).toBeHidden({ timeout: 4000 });
    await expect.poll(() => railShown(rail), { timeout: 6000 }).toBe(false);
  });

  test('② 손잡이 옆 20px·막대 위 끝 바깥 12px을 눌러도 잡힌다', async ({ page }) => {
    const { rail, wake, touch } = await setup(page);
    const r0 = async () => box(rail);
    for (const [dx, dy] of [[10, -12], [31, 0.5], [60, 0.5]]) {
      await wake();
      const r = await r0();
      // 보이는 손잡이(오른쪽 끝에서 3~11px)의 왼쪽 가장자리에서 dx만큼 떨어진 자리(dx=31 → 손잡이 왼쪽 20px 옆).
      const x = r.x + r.width - dx, y = dy < 0 ? r.y + dy : r.y + r.height * dy;
      await touch('touchStart', x, y);
      await expect.poll(() => isDrag(rail), { message: `dx=${dx} dy=${dy}` }).toBe(true);
      await touch('touchEnd');
      await expect(rail).not.toHaveClass(/is-drag/);
    }
    expect((await r0()).width).toBeGreaterThanOrEqual(44);
  });

  test('③ 손잡이가 숨은 뒤 말풍선 자리를 누르면 사진이 열린다(말풍선이 가리지 않음)', async ({ page }) => {
    const { rail, chip, wake } = await setup(page);
    await wake();
    const c = await box(chip);
    const x = c.x + c.width / 2, y = c.y + c.height / 2;
    await expect(chip).toBeHidden({ timeout: 4000 });
    await expect.poll(() => railShown(rail), { timeout: 6000 }).toBe(false);
    // 말풍선이 떠 있던 높이의 사진 칸 가운데를 누른다(손잡이가 숨었으므로 사진이 받는다).
    const cell = await page.evaluate(y => { const el = [...document.querySelectorAll('#photosRoot [data-photos-open]')].find(e => { const r = e.getBoundingClientRect(); return r.top + 8 < y && y < r.bottom - 8 && r.width > 0; }); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y }; }, y);
    expect(cell, '말풍선 높이에 사진 칸이 있어야 한다').not.toBeNull();
    const hit = await page.evaluate(([px, py]) => { const el = document.elementFromPoint(px, py); return { inRail: !!el?.closest('[data-photos-rail]'), photo: !!el?.closest('[data-photos-open]') }; }, [cell.x, cell.y]);
    expect(hit).toEqual({ inRail: false, photo: true });
    await page.touchscreen.tap(cell.x, cell.y);
    await expect(root(page).locator('[data-diary-viewer]')).toBeVisible();
  });
});
