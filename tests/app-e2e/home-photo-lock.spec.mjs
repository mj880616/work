// S67-59: 홈 '오늘 사진' 칸 잠김은 '사진' 잠금만 따른다(2026-11-21 명진 "사진은 잠그지 않았는데 홈 화면에 사진이 잠겨있었음").
// ① 하루 기록만 잠금 → 오늘 사진은 모두 보인다(하루 기록에 넣은 사진 포함, 2026-11-21 08:32 명진).
// ② 사진 잠금 → '잠김' 한 줄(사진을 읽지 않음, 그 자리 창 제목 '사진 잠김'). ③ 잠금 설정을 아직 모름 → 자리만(사진도 '잠김'도 없음).
// 가짜 서버만 쓴다(값은 모두 합성). 시계는 2026-10-06 10:00 KST(home-entry.mjs).
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const DAY = ['P1', 'P2', 'P3'].map((id, i) => ({ id, name: id + '.jpg', taken_at: new Date(Date.UTC(2026, 9, 5, 23 + i)).toISOString(), approx: false }));

async function boot(page, { features = null } = {}) {
  await page.setViewportSize({ width: 412, height: 860 });
  const seen = { diaryReads: 0, odPhotos: 0 };
  const beforeLoad = async () => {
    await page.route(u => u.origin === SB && u.pathname.startsWith('/rest/v1/rpc/app_lock_'), async route => {
      const name = new URL(route.request().url()).pathname.split('/').pop();
      if (name === 'app_lock_read') {
        if (!features) return new Promise(() => {}); // 잠금 설정을 아직 모름(답이 오지 않음)
        return route.fulfill({ json: { has_pin: true, features, relock: '5m', left: 5, blocked_until: null } });
      }
      if (name === 'app_lock_note_folders') return route.fulfill({ json: { folders: [], covered: [], top_names: [] } });
      return route.fulfill({ status: 404, body: '' });
    });
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', r => {
      const body = r.request().postDataJSON();
      if (body.action === 'photo') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true } });
      if (body.action === 'photos') { seen.odPhotos++; return r.fulfill({ json: { month: body.month, days: body.month === '2026-10' ? { '2026-10-06': DAY } : {}, truncated: false } }); }
      return r.fulfill({ json: {} });
    });
    page.on('request', req => { const u = req.url(); if (u.startsWith(SB + '/rest/v1/app_notes') && /kind=eq\.diary/.test(u)) seen.diaryReads++; });
  };
  await openHome(page, { beforeLoad });
  return seen;
}
const box = page => page.locator('#journalRoot [data-journal-photos]');

test('하루 기록만 잠금 → 오늘 사진은 보이고(잠김 아님) 하루 기록에 넣은 사진도 읽는다', async ({ page }) => {
  const seen = await boot(page, { features: ['diary'] });
  await expect(box(page).locator('[data-journal-photo]').first()).toBeVisible();
  await expect(box(page).locator('[data-journal-photos-count]')).toHaveText('3');
  await expect(box(page).locator('[data-journal-photos-locked]')).toHaveCount(0);
  await expect.poll(() => seen.diaryReads).toBeGreaterThan(0);
});

test('사진 잠금 → 오늘 사진 "잠김" 한 줄 · 사진을 읽지 않음 · [풀기] 창 제목 "사진 잠김"', async ({ page }) => {
  const seen = await boot(page, { features: ['photos'] });
  await expect(box(page).locator('[data-journal-photos-locked]')).toBeVisible();
  await expect(box(page).locator('[data-journal-photo]')).toHaveCount(0);
  expect(seen.odPhotos).toBe(0);
  await box(page).locator('[data-journal-photos-locked] button.lk-open').click();
  await expect(page.locator('dialog.lk-here .lk-title')).toHaveText('사진 잠김');
});

test('잠금 설정을 아직 모름 → 자리만(사진도 "잠김"도 없음)', async ({ page }) => {
  const seen = await boot(page);
  await expect(box(page)).toBeVisible();
  expect(await page.evaluate(() => window.KPTUFeatureLock.settings())).toBe(null);
  await expect(box(page).locator('[data-journal-photos-locked]')).toHaveCount(0);
  await expect(box(page).locator('[data-journal-photo]')).toHaveCount(0);
  await expect(box(page).locator('[data-journal-photos-empty]')).toHaveCount(0);
  expect(seen.odPhotos).toBe(0);
  expect(seen.diaryReads).toBe(0);
});
