import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// PHOTO-GIF움직임(요청함 11/06 01:24): 사진 크게 보기에서 GIF는 줄인 정지 그림 위에 원본(원드라이브 받기 주소)을 바로 겹쳐 움직이게 한다.
// 확대하지 않아도 받는다. GIF가 아닌 사진은 확대 전에는 원본을 받지 않는다. 지어낸 서버(네트워크 없음).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const CDN = 'https://od-thumb.example.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const N = 24;
const pad = (n, w = 3) => String(n).padStart(w, '0');
const MEDIA = Array.from({ length: N }, (_, i) => {
  const day = `2026-10-${pad(30 - Math.floor(i / 12), 2)}`;
  return { id: 'P' + pad(i), name: i === 5 ? 'move.GIF' : 'p.jpg', day, taken_at: `${day}T03:00:${pad(12 - (i % 12), 2)}.000Z`, approx: false, kind: 'photo', screenshot: false, duration_ms: null };
});

async function fixture(page, width) {
  const state = { media: [], originals: [], errors: [] };
  page.on('pageerror', e => state.errors.push(e.message));
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => { window.KPTUOdWarm = { run: () => null }; });
  const routes = async () => {
    state.prefs = await installViewPrefsServer(page, { photo_hint: 3 });
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === CDN, async r => {
      const [, size, file] = new URL(r.request().url()).pathname.split('/');
      if (size === 'orig') state.originals.push(file.replace(/\.png$/, ''));
      return r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PNG });
    });
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
      const body = r.request().postDataJSON();
      if (body.action === 'photo') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true } });
      if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false, changed: 0 } });
      if (body.action === 'media-url') { state.media.push({ id: body.id, purpose: body.purpose }); return r.fulfill({ json: { url: `${CDN}/orig/${body.id}.png`, kind: 'photo', name: 'p.jpg', expires_in: 3000 } }); }
      if (body.action === 'photo-urls') return r.fulfill({ json: { urls: Object.fromEntries(body.ids.map(id => [id, `${CDN}/${body.size}/${id}.png`])), failed: {} } });
      if (body.action === 'photos') {
        const days = {};
        if (body.month === '2026-10') for (const m of [...MEDIA].reverse()) (days[m.day] ||= []).push({ id: m.id, name: m.name, taken_at: m.taken_at, approx: false });
        return r.fulfill({ json: { days, truncated: false } });
      }
      if (body.action === 'library') {
        const c = body.cursor;
        const list = MEDIA.filter(m => !c || m.taken_at < c.t || (m.taken_at === c.t && m.id < c.id));
        const items = list.slice(0, body.limit), more = list.length > body.limit;
        return r.fulfill({ json: { items, next_cursor: more ? { t: items.at(-1).taken_at, id: items.at(-1).id } : null, indexing: false } });
      }
      if (body.action === 'months') return r.fulfill({ json: { months: { '2026-10': N }, total: N } });
      return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
    });
  };
  await openHome(page, { beforeLoad: routes });
  return state;
}
async function openPhotos(page, width) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav').getByRole('button', { name: '사진', exact: true }).click();
  } else await page.locator('#appView>.app-nav').getByRole('button', { name: '사진', exact: true }).click();
  await expect(page.locator('#photosView')).toBeVisible();
  await expect(page.locator('#photosRoot [data-photos-open="5"] .diary-photo')).toHaveAttribute('data-img-state', 'shown', { timeout: 15000 });
}
const viewer = page => page.locator('[data-diary-viewer]');
const photo = (page, i) => viewer(page).locator('.diary-slide').nth(i).locator('.diary-photo');

test('크게 보기: GIF는 확대 없이 원본을 겹쳐 움직이게, 다른 사진은 원본을 받지 않는다', async ({ page }) => {
  const f = await fixture(page, 412);
  await openPhotos(page, 412);
  await page.locator('#photosRoot [data-photos-open="5"]').click();
  await expect(viewer(page)).toBeVisible();
  await expect(photo(page, 5)).toHaveAttribute('data-img-state', 'shown');
  await expect.poll(() => f.media.filter(m => m.id === 'P005')).toEqual([{ id: 'P005', purpose: 'download' }]);
  await expect(photo(page, 5).locator('img.diary-viewer-hires')).toHaveCount(1);
  expect(f.originals).toContain('P005');
  // GIF가 아닌 앞뒤 사진은 확대하기 전에는 원본을 받지 않는다.
  expect(f.media.filter(m => m.id !== 'P005')).toEqual([]);
  expect(f.errors).toEqual([]);
});
