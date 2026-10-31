import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// PHOTO-전체화면확대(요청함 10/31 19:23): 사진 크게 보기 안 확대·축소. 지어낸 서버(네트워크 없음, 사진은 1×1 그림)로 본다.
// 폰 412(터치): 두 손가락 벌리기 = 확대, 확대 중 한 손가락 끌기 = 사진 안 움직이기(넘기기 없음), 두 번 톡 = 확대 ↔ 원래 크기,
//   원래 크기에서 좌우 넘기기 그대로, 다음 사진으로 넘기면 원래 크기. 확대하면 원본 해상도(원드라이브 받기 주소)를 한 번 받아 겹친다.
// PC 1280: 휠 = 확대·축소, 확대 중 끌기, 더블클릭 = 확대 ↔ 원래 크기.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const CDN = 'https://od-thumb.example.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const N = 24;
const pad = (n, w = 3) => String(n).padStart(w, '0');
const MEDIA = Array.from({ length: N }, (_, i) => {
  const day = `2026-10-${pad(30 - Math.floor(i / 12), 2)}`;
  return { id: 'P' + pad(i), name: 'p.jpg', day, taken_at: `${day}T03:00:${pad(12 - (i % 12), 2)}.000Z`, approx: false, kind: 'photo', screenshot: false, duration_ms: null };
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
const count = page => viewer(page).locator('[data-diary-viewer-count]');
const photo = (page, i) => viewer(page).locator('.diary-slide').nth(i).locator('.diary-photo');
const transformOf = loc => loc.evaluate(el => el.style.transform);
const scaleOf = async loc => Number((/scale\(([\d.]+)\)/.exec(await transformOf(loc)) || [0, 1])[1]);
async function openViewer(page, i = 5) {
  await page.locator(`#photosRoot [data-photos-open="${i}"]`).click();
  await expect(viewer(page)).toBeVisible();
  await expect(count(page)).toHaveText(`${i + 1} / ${N}`);
  await expect(photo(page, i)).toHaveAttribute('data-img-state', 'shown');
}
async function center(page) {
  const b = await page.locator('[data-diary-viewer-strip]').boundingBox();
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
}

test.describe('폰 412 터치', () => {
  test.use({ hasTouch: true });
  test('두 손가락 확대·끌기·두 번 톡, 원래 크기에서만 좌우 넘기기, 넘기면 원래 크기', async ({ page }) => {
    const f = await fixture(page, 412);
    await openPhotos(page, 412);
    await openViewer(page, 5);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    const { x, y } = await center(page);
    const tap = async (px = x, py = y) => { await touch('touchStart', [{ x: px, y: py, id: 0 }]); await touch('touchEnd', []); };
    const doubleTap = async (px, py) => { await tap(px, py); await page.waitForTimeout(60); await tap(px, py); };

    // 두 손가락 벌리기 = 확대(사진 칸만 커지고 화면 전체는 그대로).
    await touch('touchStart', [{ x: x - 30, y, id: 0 }, { x: x + 30, y, id: 1 }]);
    for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: x - 30 - i * 12, y, id: 0 }, { x: x + 30 + i * 12, y, id: 1 }]);
    await touch('touchEnd', []);
    await expect(viewer(page)).toHaveAttribute('data-strip-zoom', '');
    expect(await scaleOf(photo(page, 5))).toBeGreaterThan(2);
    expect(await page.evaluate(() => window.visualViewport?.scale || 1)).toBe(1);
    // 확대하면 원본 해상도(원드라이브 받기 주소)를 한 번 받아 같은 칸 위에 겹친다.
    await expect.poll(() => f.media).toEqual([{ id: 'P005', purpose: 'download' }]);
    await expect(photo(page, 5).locator('img.diary-viewer-hires')).toHaveCount(1);
    expect(f.originals).toContain('P005');

    // 확대 중 한 손가락 끌기 = 사진 안 움직이기(다음 사진으로 넘어가지 않음).
    const before = await transformOf(photo(page, 5));
    await touch('touchStart', [{ x, y, id: 0 }]);
    for (let i = 1; i <= 6; i++) await touch('touchMove', [{ x: x - i * 25, y, id: 0 }]);
    await touch('touchEnd', []);
    expect(await transformOf(photo(page, 5))).not.toBe(before);
    await page.waitForTimeout(300);
    await expect(count(page)).toHaveText(`6 / ${N}`);

    // 두 번 톡 = 원래 크기, 다시 두 번 톡 = 2.5배.
    await doubleTap(x, y);
    await expect(viewer(page)).not.toHaveAttribute('data-strip-zoom', '');
    await expect.poll(() => transformOf(photo(page, 5))).toBe('');
    await doubleTap(x + 40, y);
    await expect(viewer(page)).toHaveAttribute('data-strip-zoom', '');
    expect(await scaleOf(photo(page, 5))).toBe(2.5);
    await doubleTap(x, y);
    await expect(viewer(page)).not.toHaveAttribute('data-strip-zoom', '');

    // 원래 크기: 좌우 넘기기 그대로.
    await cdp.send('Input.synthesizeScrollGesture', { x, y, xDistance: -260, yDistance: 0, gestureSourceType: 'touch', speed: 1200 });
    await expect(count(page)).toHaveText(`7 / ${N}`);
    await expect(photo(page, 6)).toHaveAttribute('data-img-state', 'shown');

    // 확대한 채로는 좌우 넘기기가 쉬고, 다음 사진으로 넘기면(→) 원래 크기로 돌아온다.
    await doubleTap(x, y);
    await expect(viewer(page)).toHaveAttribute('data-strip-zoom', '');
    await cdp.send('Input.synthesizeScrollGesture', { x, y, xDistance: -260, yDistance: 0, gestureSourceType: 'touch', speed: 1200 });
    await page.waitForTimeout(400);
    await expect(count(page)).toHaveText(`7 / ${N}`);
    await page.keyboard.press('ArrowRight');
    await expect(count(page)).toHaveText(`8 / ${N}`);
    await expect(viewer(page)).not.toHaveAttribute('data-strip-zoom', '');
    expect(await transformOf(photo(page, 6))).toBe('');
    expect(f.errors).toEqual([]);
  });
});

test('PC 1280: 휠 확대·축소, 확대 중 끌기, 더블클릭 확대 ↔ 원래 크기, 넘기면 원래 크기', async ({ page }) => {
  const f = await fixture(page, 1280);
  await openPhotos(page, 1280);
  await openViewer(page, 5);
  const { x, y } = await center(page);
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -300);
  await expect(viewer(page)).toHaveAttribute('data-strip-zoom', '');
  const s1 = await scaleOf(photo(page, 5));
  expect(s1).toBeGreaterThan(1.2);
  await page.mouse.wheel(0, -200);
  await expect.poll(() => scaleOf(photo(page, 5))).toBeGreaterThan(s1);
  await expect.poll(() => f.media.map(m => m.id)).toEqual(['P005']);
  // 끌기 = 사진 안 움직이기.
  const before = await transformOf(photo(page, 5));
  await page.mouse.down(); await page.mouse.move(x - 120, y + 40, { steps: 6 }); await page.mouse.up();
  expect(await transformOf(photo(page, 5))).not.toBe(before);
  await expect(count(page)).toHaveText(`6 / ${N}`);
  // 아래로 굴리면 작아져 원래 크기까지.
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 300);
  await expect(viewer(page)).not.toHaveAttribute('data-strip-zoom', '');
  await expect.poll(() => transformOf(photo(page, 5))).toBe('');
  // 더블클릭 = 2.5배, 다시 더블클릭 = 원래 크기.
  await page.mouse.dblclick(x, y);
  await expect(viewer(page)).toHaveAttribute('data-strip-zoom', '');
  expect(await scaleOf(photo(page, 5))).toBe(2.5);
  await page.mouse.dblclick(x, y);
  await expect(viewer(page)).not.toHaveAttribute('data-strip-zoom', '');
  // 확대한 채 → 다음 사진: 원래 크기로.
  await page.mouse.dblclick(x, y);
  await expect(viewer(page)).toHaveAttribute('data-strip-zoom', '');
  await page.keyboard.press('ArrowRight');
  await expect(count(page)).toHaveText(`7 / ${N}`);
  await expect(viewer(page)).not.toHaveAttribute('data-strip-zoom', '');
  expect(await transformOf(photo(page, 5))).toBe('');
  expect(f.errors).toEqual([]);
});
