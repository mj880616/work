import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S73-11 PHOTO-빠른이동손잡이유지(사용자 11/27 "손으로 잡고 위아래로 움직이다보면 사라짐 사라지지않게 내가 놓기 전까지"):
// 폰 412 진짜 터치(CDP 터치 → pointerType touch)로 빠른 이동 손잡이를 잡고 여러 번 위아래로 끌며, 중간에 가만히 멈추고,
// 끄는 중 목록을 다시 그리게 해도(창 크기 바뀜 → 막대 다시 그리기) 놓기 전까지 손잡이(막대)·날짜 말풍선이 계속 보이고 손가락 자리 그대로인지,
// 놓은 뒤에는 기존 규칙대로 숨는지 본다. PC 1280은 마우스로 같은 것을 본다. 가짜 사진 칸(1x1 그림)과 지어낸 Supabase 응답만 쓴다.
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


// 막대가 눈에 보이는가(투명도까지 — Playwright toBeVisible은 opacity 0도 보인다고 본다).
const railShown = rail => rail.evaluate(el => !el.hidden && el.classList.contains('is-awake') && getComputedStyle(el).pointerEvents !== 'none');
async function expectHeld(rail, chip, y) {
  expect(await railShown(rail)).toBe(true);
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText(/^\d{4}년 \d{1,2}월$/);
  const c = await box(chip);
  expect(Math.abs(c.y + c.height / 2 - y)).toBeLessThanOrEqual(24); // 손가락 높이 근처(위·아래 끝에서는 손잡이 반 높이까지)
}

for (const [width, touch] of [[412, true], [1280, false]]) {
  test.describe(`사진 빠른 이동 손잡이 잡고 있는 동안 ${width}`, () => {
    test.use({ hasTouch: touch, isMobile: touch });
    test('잡고 위아래로 여러 번 끌고 멈춰도 놓기 전까지 손잡이·말풍선이 보이고, 놓으면 숨는다', async ({ page }) => {
      await fixture(page, { width, years: 10 });
      await openPhotos(page, width);
      const rail = railOf(page), chip = rail.locator('[data-photos-rail-bubble]');
      await expect(root(page).locator('[data-photos-day]').first()).toBeVisible();
      // 넘겨서 손잡이를 깨운다.
      await page.mouse.move(width / 2, 500);
      await page.mouse.wheel(0, 300);
      await expect(rail).toHaveClass(/is-awake/);
      const r = await box(rail), t = await box(rail.locator('[data-photos-rail-thumb]'));
      const x = r.x + r.width - 10;
      const ys = [0.3, 0.7, 0.15, 0.85, 0.5].map(f => r.y + r.height * f);
      let cdp = null;
      if (touch) {
        cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: t.y + t.height / 2 }] });
      } else {
        await page.mouse.move(x, t.y + t.height / 2);
        await page.mouse.down();
      }
      const moveTo = async (from, to) => {
        for (let i = 1; i <= 8; i++) {
          const y = from + (to - from) * i / 8;
          if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
          else await page.mouse.move(x, y);
          await page.waitForTimeout(40);
        }
      };
      let at = t.y + t.height / 2;
      for (const [i, y] of ys.entries()) {
        await moveTo(at, y); at = y;
        await expectHeld(rail, chip, y);
        if (i === 1) {
          // 가만히 멈춤(숨김 시간 1.8초보다 길게) — 그대로 보여야 한다.
          await page.waitForTimeout(2600);
          await expectHeld(rail, chip, y);
        }
        if (i === 2) {
          // 끄는 중 막대를 다시 그리게 한다(폰 주소줄·창 크기 바뀜과 같은 길) — 손잡이·말풍선은 손가락 자리 그대로.
          const before = await chip.textContent();
          await page.evaluate(() => window.dispatchEvent(new Event('resize')));
          await page.waitForTimeout(2200);
          await expectHeld(rail, chip, y);
          await expect(chip, `before=${before}`).toHaveText(before);
        }
      }
      expect(await rail.evaluate(el => el.classList.contains('is-drag'))).toBe(true);
      if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      else { await page.mouse.up(); await page.mouse.move(width / 2, 500); }
      // 놓은 뒤에는 기존 규칙대로: 말풍선 1초쯤, 손잡이 1.8초쯤 뒤 숨는다(PC는 막대에서 마우스를 뗀 뒤).
      await expect(rail).not.toHaveClass(/is-drag/);
      await expect(chip).toBeHidden({ timeout: 4000 });
      await expect.poll(() => railShown(rail), { timeout: 6000 }).toBe(false);
    });
  });
}
