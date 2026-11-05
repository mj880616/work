import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S50-31 PHOTO-정보고치기 ②(명진 결정 E3 (가)·E4): PC 1440(폰 앱 없음)에서 원드라이브 사진 우클릭 → [정보수정] →
// 서버 photos-meta-read로 앞 값 → '모두 −8시간' → [저장] = photos-meta-write(confirm:true, ISO 시각) 한 번 → 되돌리기 기록 1줄(source onedrive, 열쇠 od:)
// → 알림 [되돌리기] = 앞 시각으로 다시 고치고 undone_at. 지어낸 서버(네트워크 없음), 그림은 1×1.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const CDN = 'https://od-thumb.example.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const OD = [
  { id: 'O1', name: 'a.jpg', day: '2026-10-30', taken_at: '2026-10-30T03:00:00.000Z', size_bytes: 111 },
  { id: 'O2', name: 'b.jpg', day: '2026-10-28', taken_at: '2026-10-28T03:00:00.000Z', size_bytes: 222 },
].map(m => ({ ...m, approx: false, kind: 'photo', screenshot: false, duration_ms: null, uploaded_at: m.taken_at }));

test.use({ viewport: { width: 1440, height: 900 } });

async function fixture(page) {
  const state = { errors: [], reads: [], writes: [], records: [], patches: [] };
  page.on('pageerror', e => state.errors.push(e.message));
  await page.addInitScript(() => { window.KPTUOdWarm = { run: () => null }; });
  await installViewPrefsServer(page, null);
  await openHome(page, { beforeLoad: async () => {
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_photo_tags', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/rpc/app_my_features', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === CDN, r => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PNG }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_photo_info_edits', async r => {
      const req = r.request(), method = req.method();
      if (method === 'POST') { state.records.push(...req.postDataJSON()); return r.fulfill({ status: 201, body: '' }); }
      if (method === 'PATCH') { state.patches.push({ url: req.url(), body: req.postDataJSON() }); return r.fulfill({ status: 204, body: '' }); }
      return r.fulfill({ json: [] });
    });
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
      const body = r.request().postDataJSON();
      if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true, whole: true } });
      if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false, changed: 0 } });
      if (body.action === 'photo-urls') return r.fulfill({ json: { urls: Object.fromEntries(body.ids.map(id => [id, `${CDN}/${body.size}/${id}.png`])), failed: {} } });
      if (body.action === 'library') return r.fulfill({ json: { items: body.folder_id ? [] : OD, next_cursor: null, indexing: false } });
      if (body.action === 'months') return r.fulfill({ json: { months: { '2026-10': OD.length }, total: OD.length } });
      if (body.action === 'folders-tree') return r.fulfill({ json: { top: { id: 'T', name: '카메라', count: OD.length, total: OD.length, enabled: true }, folders: [], indexing: false, whole: true } });
      if (body.action === 'photos-meta-read') {
        state.reads.push(body);
        return r.fulfill({ json: { items: body.ids.map(id => ({ id, can: true, taken: OD.find(p => p.id === id)?.taken_at, lat: null, lon: null, make: 'SONY', model: 'ILCE-7M4' })) } });
      }
      if (body.action === 'photos-meta-write') {
        state.writes.push(body);
        if (body.confirm !== true) return r.fulfill({ status: 400, json: { error: 'onedrive_request_invalid' } });
        return r.fulfill({ json: { done: body.items.map(it => ({ id: it.id, before: { taken: '2026-10-30T03:00:00.000Z', lat: null, lon: null }, after: { taken: it.taken, lat: null, lon: null } })), failed: {} } });
      }
      return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
    });
  } });
  return state;
}

test("PC: 원드라이브 사진 우클릭 [정보수정] → '−8시간' → 서버에 한 번(확인 포함) → 기록 od: → [되돌리기]", async ({ page }) => {
  const state = await fixture(page);
  await page.locator('#appView>.app-nav').getByRole('button', { name: '사진', exact: true }).click();
  await expect(page.locator('#photosView')).toBeVisible();
  const cell = page.locator('#photosRoot [data-photos-list] [data-photos-id="O1"]');
  await expect(cell).toBeVisible();
  await cell.click({ button: 'right' });
  const menu = page.locator('#photosPhotoMenu');
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: '정보수정', exact: true }).click();
  const dlg = page.locator('#photoInfoDialog');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('[data-pi-count]')).toHaveText('1장');
  await expect(dlg.locator('[data-pi-cloud]')).toBeVisible();
  await expect(dlg.locator('[data-pi-cam]')).toHaveText('카메라 SONY ILCE-7M4');
  expect(state.reads).toEqual([{ action: 'photos-meta-read', ids: ['O1'] }]);
  const row = dlg.locator('[data-pi-rows] tr', { hasText: 'a.jpg' });
  await expect(row.locator('td').nth(0)).toHaveText('2026.10.30 12:00');
  await dlg.locator('[data-pi-h]').fill('8');
  await expect(row.locator('td').nth(1)).toHaveText('2026.10.30 04:00');
  await expect(dlg.locator('[data-pi-status]')).toHaveText('1장을 고쳐요');
  await dlg.locator('[data-pi-save]').click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0]).toEqual({ action: 'photos-meta-write', confirm: true, items: [{ id: 'O1', taken: '2026-10-29T19:00:00.000Z' }] });
  await expect(dlg).toBeHidden();
  await expect.poll(() => state.records.length).toBe(1);
  expect(state.records[0]).toMatchObject({ source: 'onedrive', item_key: 'od:O1', before_taken: '2026-10-30T03:00:00.000Z', after_taken: '2026-10-29T19:00:00.000Z', loc_changed: false });
  expect(JSON.stringify(state.records)).not.toContain('a.jpg');
  await expect(page.locator('.kptu-notice')).toContainText('1장 고쳤어요');
  await page.locator('.kptu-notice-undo').click();
  await expect.poll(() => state.writes.length).toBe(2);
  expect(state.writes[1]).toEqual({ action: 'photos-meta-write', confirm: true, items: [{ id: 'O1', taken: '2026-10-30T03:00:00.000Z' }] });
  await expect.poll(() => state.patches.length).toBe(1);
  expect(decodeURIComponent(state.patches[0].url)).toContain('item_key=in.("od:O1")');
  expect(state.errors).toEqual([]);
});
