import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { openHeadMenu } from './helpers/photo-head.mjs';
// PHOTO-연속묶기(요청함 11/26): 짧은 시간에 연달아 찍은 사진은 [사진] 목록에서 대표 한 장 + 장수로 묶어 보이고, 크게 보기에서는 묶음 사진이 이어서 넘어간다.
// ⋯ 메뉴 [연속 사진 묶어 보기] 스위치(기본 켜짐)를 끄면 낱장, 켜고 끈 값은 서버(view_prefs.photo_view.burst)에 저장돼 새로 고쳐도 그대로.
// 가짜 사진 칸(1x1 그림)과 지어낸 Supabase 응답만 쓴다. 폰 412·PC 1280.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const mk = (id, day, at) => ({ id, name: `${id}.jpg`, day, taken_at: `${day}T${at}.000Z`, approx: false, kind: 'photo', screenshot: false, duration_ms: null, uploaded_at: `${day}T${at}.000Z`, size_bytes: 100 });
// 10-05: 한 장 + 5장 연사(20초 간격). 10-04: 30초 간격 2장(묶지 않음). 10-03: 3장(1분 간격).
const MEDIA = [
  mk('S1', '2026-10-05', '08:00:00'),
  ...['03:00:00', '03:00:20', '03:00:40', '03:01:00', '03:01:20'].map((at, i) => mk(`B${i + 1}`, '2026-10-05', at)),
  mk('P1', '2026-10-04', '05:00:00'), mk('P2', '2026-10-04', '05:00:30'),
  ...[0, 1, 2].map(i => mk(`C${i + 1}`, '2026-10-03', `02:0${i}:00`)),
];
const newest = (a, b) => b.taken_at.localeCompare(a.taken_at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
async function fixture(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => { window.KPTUOdWarm = { run: () => null }; });
  await openHome(page);
  const server = await installViewPrefsServer(page);
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => r.fulfill({ json: [] }));
  await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
    const body = r.request().postDataJSON();
    if (body.action === 'photo') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true } });
    if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false } });
    if (body.action === 'library') { const items = MEDIA.slice().sort(newest); return r.fulfill({ json: { items, next_cursor: null, indexing: false } }); }
    if (body.action === 'months') { const months = {}; for (const m of MEDIA) months[m.day.slice(0, 7)] = (months[m.day.slice(0, 7)] || 0) + 1; return r.fulfill({ json: { months, total: MEDIA.length } }); }
    return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
  });
  return server;
}
async function openPhotos(page, width) {
  if (width <= 760) {
    if (await page.locator('.mobile-tabs [data-view="photos"]').isVisible()) await page.locator('.mobile-tabs [data-view="photos"]').click();
    else { await page.locator('#mobileMenuTab').click(); await page.locator('#mobileMenu nav').getByRole('button', { name: '사진', exact: true }).click(); }
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '사진', exact: true }).click();
  await expect(page.locator('#photosView')).toBeVisible();
  await expect(page.locator('#photosRoot [data-photos-list] [data-photos-id]')).toHaveCount(MEDIA.length);
}
const cells = page => page.locator('#photosRoot [data-photos-list] .diary-grid-item:visible');
const dayCells = (page, day) => page.locator(`#photosRoot [data-photos-day="${day}"] + .photos-grid .diary-grid-item:visible`);
const marks = page => page.locator('#photosRoot [data-photos-burst-mark]');
const toggle = page => page.locator('#photosHeadMenu [data-photos-burst-toggle]');

for (const [width, touch] of [[412, true], [1280, false]]) {
  test.describe(`연속 사진 묶어 보기 ${width}`, () => {
    test.use({ hasTouch: touch, isMobile: touch });
    test('기본 켜짐: 연달아 찍은 3장 이상만 대표 한 장 + 장수로 묶인다', async ({ page }) => {
      await fixture(page, width);
      await openPhotos(page, width);
      await expect(cells(page)).toHaveCount(1 + 1 + 2 + 1);                 // 10-05: 한 장 + 연사 대표 · 10-04: 2장 그대로 · 10-03: 대표
      await expect(dayCells(page, '2026-10-05')).toHaveCount(2);
      await expect(dayCells(page, '2026-10-04')).toHaveCount(2);
      await expect(dayCells(page, '2026-10-03')).toHaveCount(1);
      await expect(marks(page)).toHaveCount(2);
      await expect(page.locator('#photosRoot [data-photos-burst="5"] [data-photos-burst-mark]')).toHaveText('5장');
      await expect(page.locator('#photosRoot [data-photos-burst="3"] [data-photos-burst-mark]')).toHaveText('3장');
      await expect(page.locator('#photosRoot [data-photos-burst="5"]')).toHaveAttribute('aria-label', /연속 사진 5장 묶음/);
      await expect(page.locator('#photosRoot [data-photos-id="B5"]')).toHaveAttribute('data-photos-burst', '5'); // 화면 순서 첫 장(가장 늦게 찍은 장)이 대표
      for (const id of ['B1', 'B2', 'B3', 'B4']) await expect(page.locator(`#photosRoot [data-photos-id="${id}"]`)).toBeHidden();
    });

    test('대표를 누르면 크게 보기에서 묶음 사진이 이어서 넘어간다', async ({ page }) => {
      await fixture(page, width);
      await openPhotos(page, width);
      await page.locator('#photosRoot [data-photos-id="B5"]').click();
      const count = page.locator('[data-diary-viewer-count]');
      await expect(count).toHaveText(`2 / ${MEDIA.length}`);                    // 한 장(S1) 다음이 대표
      await page.keyboard.press('ArrowRight');
      await expect(count).toHaveText(`3 / ${MEDIA.length}`);                    // 묶음 안 다음 사진(숨은 칸)으로 넘어감
      await page.keyboard.press('ArrowRight');
      await expect(count).toHaveText(`4 / ${MEDIA.length}`);
    });

    test('스위치를 끄면 낱장, 켜면 다시 묶음 · 서버에 저장돼 새로 고쳐도 유지', async ({ page }) => {
      const server = await fixture(page, width);
      await openPhotos(page, width);
      await openHeadMenu(page);
      await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
      await toggle(page).click();
      await expect(cells(page)).toHaveCount(MEDIA.length);
      await expect(marks(page)).toHaveCount(0);
      await expect.poll(() => server.value?.photo_view?.burst).toBe(false);
      // 새로 고쳐도 꺼진 채(서버 값).
      await page.reload();
      await openPhotos(page, width);
      await expect(cells(page)).toHaveCount(MEDIA.length);
      await openHeadMenu(page);
      await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
      // 다시 켜면 묶음, 기본값(켜짐)은 칸을 적지 않는다.
      await toggle(page).click();
      await expect(cells(page)).toHaveCount(5);
      await expect(marks(page)).toHaveCount(2);
      await expect.poll(() => server.value?.photo_view?.burst).toBeUndefined();
      await page.reload();
      await openPhotos(page, width);
      await expect(cells(page)).toHaveCount(5);
    });

    test('고르는 중에는 낱장으로 펼쳐지고, 고르기를 끝내면 다시 묶인다', async ({ page }) => {
      await fixture(page, width);
      await openPhotos(page, width);
      // 사진 한 장을 꾹 눌러(0.5초) 고르기를 시작한다.
      const b = await page.locator('#photosRoot [data-photos-id="S1"]').boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
      await expect(page.locator('#photosRoot.is-selecting')).toHaveCount(1);
      await expect(cells(page)).toHaveCount(MEDIA.length);
      await page.locator('[data-photos-sel-off]').click();
      await expect(page.locator('#photosRoot.is-selecting')).toHaveCount(0);
      await expect(cells(page)).toHaveCount(5);
    });
  });
}
