import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { clickView } from './helpers/shell-navigation.mjs';
// LOAD-끝있는불러오기(요청함 11/06 23:31 ★급★ 사진 폴더): 폰 [폴더] 나무에서 폴더를 펼쳤을 때 그 폴더 안 처음 몇 장을 못 읽으면
// 끝없는 회색 칸 대신 '불러오지 못했습니다 · 다시'가 보이고, [다시]를 누르면 사진이 뜬다. 지어낸 서버(네트워크 없음).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const media = (id, parent, day, hour) => ({ id, parent, name: id + '.jpg', day, taken_at: `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`, approx: false, kind: 'photo', screenshot: false, duration_ms: null });
const out = ({ parent, ...m }) => m;

async function fixture(page) {
  const state = { folders: [{ id: 'S2', name: '여행', parent_id: 'T' }], media: [media('A1', 'T', '2026-10-05', 3), media('B1', 'S2', '2026-10-03', 3), media('B2', 'S2', '2026-10-02', 3)], failS2: 99, s2Calls: 0, errors: [] };
  page.on('pageerror', e => state.errors.push(e.message));
  await page.setViewportSize({ width: 412, height: 900 });
  await openHome(page);
  await installViewPrefsServer(page);
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => r.fulfill({ json: [] }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_photo_tags', r => r.fulfill({ json: [] }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_photo_tag_items', r => r.fulfill({ json: [] }));
  await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
    const body = r.request().postDataJSON();
    if (body.action === 'photo') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true } });
    if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false } });
    if (body.action === 'months') return r.fulfill({ json: { months: { '2026-10': 3 }, total: 3 } });
    if (body.action === 'library') {
      if (body.folder_id === 'S2') { state.s2Calls++; if (state.failS2 > 0) { state.failS2--; return r.fulfill({ status: 500, json: { error: 'onedrive_unavailable' } }); } }
      const list = state.media.filter(m => (body.folder_id ? m.parent === body.folder_id : true));
      return r.fulfill({ json: { items: list.slice(0, body.limit).map(out), next_cursor: null, indexing: false } });
    }
    if (body.action === 'folders-tree') {
      return r.fulfill({ json: { top: { id: 'T', name: '카메라', count: 1, total: 3 }, folders: [{ id: 'S2', name: '여행', parent_id: 'T', enabled: true, count: 2, total: 2 }], indexing: false } });
    }
    return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
  });
  return state;
}

test('사진 [폴더] 폰: 펼친 폴더 안 사진을 못 읽으면 회색 칸이 아니라 실패 글 + [다시], 누르면 사진이 뜬다', async ({ page }) => {
  const f = await fixture(page);
  await clickView(page, 'photos');
  await expect(page.locator('#photosView')).toBeVisible();
  const root = page.locator('#photosRoot');
  await root.locator('[data-photos-view]').selectOption('folders');
  const box = root.locator('[data-photos-box="onedrive"]');
  await box.locator('[data-photos-ftog="o:S2"]').click();
  const strip = root.locator('[data-photos-strip="o:S2"]');
  await expect(strip.locator('[data-wait-fail]')).toContainText('불러오지 못했어요', { timeout: 40000 });
  await expect(strip.locator('.photos-fx-strip-wait')).toHaveCount(0);
  f.failS2 = 0; // 이제 서버가 답한다
  await strip.getByRole('button', { name: '다시' }).click();
  await expect(strip.locator('[data-photos-inline]')).toHaveCount(2);
  await expect(strip.locator('[data-wait-fail]')).toHaveCount(0);
  expect(f.s2Calls).toBeGreaterThanOrEqual(2);
  expect(f.errors).toEqual([]);
});
