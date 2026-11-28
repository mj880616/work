import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// HOME-오늘사진은사진으로(S73-07, 2026-11-27 사용자 요청): 홈 '오늘 사진'의 썸네일·'+n'·[사진 보기 ›]는 일기가 아니라 [사진] 화면의 그날로 간다.
// 썸네일 = 그 사진 크게 보기, +n·[사진 보기 ›] = 그날 목록. 뒤로가기는 홈. 폰 412·PC 1280. 가짜 서버만(시계 2026-10-06 10:00 KST).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const kst = (h, m = 0) => new Date(Date.UTC(2026, 9, 6, h - 9, m)).toISOString();
const DAY = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'B1', 'B2', 'B3', 'B4', 'B5'].map((id, i) => ({ id, name: id + '.jpg', taken_at: kst(6 + i, 0), approx: false }));
const LIB = DAY.map(p => ({ ...p, day: '2026-10-06', size_bytes: 1000, kind: 'photo', width: 10, height: 10, duration_ms: null, screenshot: false, uploaded_at: p.taken_at })).reverse();
const SIZES = [[412, 915], [1280, 800]];

async function boot(page, width, height) {
  await page.setViewportSize({ width, height });
  const errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page, { beforeLoad: async () => {
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', r => {
      const body = r.request().postDataJSON();
      if (body.action === 'photo') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true } });
      if (body.action === 'photos') return r.fulfill({ json: { month: body.month, days: body.month === '2026-10' ? { '2026-10-06': DAY } : {}, truncated: false } });
      // [사진] 화면이 부르는 읽기들(전체 목록·달 수·주소). 쓰기는 하나도 없어야 한다.
      if (body.action === 'library') return r.fulfill({ json: { items: LIB, next_cursor: null, indexing: false } });
      if (body.action === 'months') return r.fulfill({ json: { months: { '2026-10': LIB.length }, total: LIB.length } });
      if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false, changed: 0 } });
      if (body.action === 'photo-urls') return r.fulfill({ json: { urls: Object.fromEntries((body.ids || []).map(id => [id, `${SB}/img/${id}.png`])), failed: {} } });
      if (/delete|move|rename|star|trash/.test(body.action || '')) writes.push(body.action);
      return r.fulfill({ json: {} });
    });
    await page.route(u => u.origin === SB && u.pathname.startsWith('/img/'), r => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PNG }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_photo_tags', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => {
      if (r.request().method() !== 'GET') { writes.push('star'); return r.fulfill({ status: 500, json: {} }); }
      return r.fulfill({ json: [] });
    });
  } });
  return { errors, writes };
}
const strip = page => page.locator('#journalRoot [data-journal-photos]');
const viewer = page => page.locator('[data-diary-viewer]');

for (const [width, height] of SIZES) {
  test(`${width}: 홈 오늘 사진 썸네일 → [사진] 화면에서 그 사진 크게 보기, 뒤로가기는 홈`, async ({ page }) => {
    const f = await boot(page, width, height);
    const cell = strip(page).locator('[data-journal-photo]').nth(1);
    await expect(cell).toBeVisible();
    const key = await cell.getAttribute('data-journal-photo-key') ?? await cell.evaluate(el => el.dataset.journalPhotoKey);
    await cell.click();
    await expect(page.locator('#photosView')).toBeVisible();
    await expect(page.locator('#diaryView')).toBeHidden();
    await expect(viewer(page)).toBeVisible();
    expect(key).toBeTruthy();
    await page.goBack();
    await expect(viewer(page)).toBeHidden();
    await page.goBack();
    await expect(page.locator('#homeView')).toBeVisible();
    expect(f.writes).toEqual([]);
    expect(f.errors).toEqual([]);
  });

  test(`${width}: 홈 [사진 보기 ›]·'+n' → [사진] 화면 그날 목록(일기 아님)`, async ({ page }) => {
    const f = await boot(page, width, height);
    await expect(strip(page).locator('[data-journal-photo]').first()).toBeVisible();
    await strip(page).locator('[data-journal-photos-open]').click();
    await expect(page.locator('#photosView')).toBeVisible();
    await expect(page.locator('#diaryView')).toBeHidden();
    await expect(page.locator('#photosView [data-photos-day^="2026-10-06"]').first()).toBeVisible();
    await expect(viewer(page)).toBeHidden();
    await page.goBack();
    await expect(page.locator('#homeView')).toBeVisible();
    const more = strip(page).locator('[data-journal-photo-more]');
    if (await more.count()) {
      await more.click();
      await expect(page.locator('#photosView [data-photos-day^="2026-10-06"]').first()).toBeVisible();
      await expect(page.locator('#diaryView')).toBeHidden();
    }
    expect(f.writes).toEqual([]);
    expect(f.errors).toEqual([]);
  });
}
