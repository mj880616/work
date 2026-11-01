import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S47-32 PHOTO-비슷한사진: 같은 사진·연사 묶음에 '비슷한 사진' 칩. 누르면 기기에서 작은 미리보기(thumb small)로 dHash를 만들어
// 10분 안 같은 장면을 묶는다. 원본(media)은 받지 않고 서버로 보내지 않는다. 비교 칸·남길 것 고르기는 19B 그대로. 네트워크 없음(지어낸 서버·지어낸 앱).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const CDN = 'https://od-thumb.example.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.4.1';
const KEY = 'PhoneKeyForTest_0123456789';
const T0 = Date.parse('2026-10-05T01:00:00.000Z');
const at = ms => new Date(T0 + ms).toISOString();
const m = (id, name, ms, size, folder, extra = {}) => ({ id: String(id), name, folder, day: at(ms).slice(0, 10), taken_at: at(ms), size_bytes: size, width: 40, height: 30,
  approx: false, kind: 'photo', duration_ms: null, screenshot: false, uploaded_at: at(ms), ...extra });
const PHONE = [
  // 같은 장면 3장(0·40초·2분, 왼쪽이 밝은 그림), 다른 장면 1장(1분 30초, 오른쪽이 밝은 그림), 같은 그림이지만 30분·1시간 뒤(10분 안 이웃 없음)
  m(1, 'A1.jpg', 0, 1_100_000, 'DCIM/Camera/'), m(2, 'A2.jpg', 40_000, 1_300_000, 'DCIM/Camera/'), m(3, 'A3.jpg', 120_000, 1_200_000, 'DCIM/Camera/'),
  m(4, 'B1.jpg', 90_000, 1_400_000, 'DCIM/Camera/'), m(5, 'A4.jpg', 30 * 60_000, 1_500_000, 'DCIM/Camera/'), m(6, 'A5.jpg', 60 * 60_000, 1_600_000, 'DCIM/Camera/'),
].sort((a, b) => b.taken_at.localeCompare(a.taken_at));
const svg = bright => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="90" height="80"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="${bright ? '#fff' : '#000'}"/><stop offset="1" stop-color="${bright ? '#000' : '#fff'}"/></linearGradient></defs><rect width="90" height="80" fill="url(#g)"/></svg>`);
const OD = [{ id: 'O1', name: 'A1.jpg', day: at(0).slice(0, 10), taken_at: at(0), size_bytes: 1_100_000, approx: false, kind: 'photo', duration_ms: null, screenshot: false, uploaded_at: at(0) }];
const N = 0;

async function fixture(page) {
  const state = { errors: [], thumbs: [], media: 0 };
  page.on('pageerror', e => state.errors.push(e.message));
  await page.addInitScript(() => { window.KPTUOdWarm = { run: () => null }; });
  await page.addInitScript(key => {
    const listeners = [];
    const prev = window.KPTUAppShell;
    window.KPTUAppShell = {
      postMessage(m) {
        if (m === 'photos:hello' || m === 'photos:ask') setTimeout(() => listeners.forEach(fn => fn({ data: `photos:state:{"access":"full","key":"${key}","trash":true,"hide":true}` })), 0);
        prev?.postMessage?.(m);
      },
      addEventListener(type, fn) { if (type === 'message') listeners.push(fn); prev?.addEventListener?.(type, fn); },
    };
  }, KEY);
  await installViewPrefsServer(page);
  await openHome(page, { beforeLoad: async () => {
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_photo_tags', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === CDN, r => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PNG }));
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
      const body = r.request().postDataJSON();
      if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true } });
      if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false, changed: 0 } });
      if (body.action === 'photo-urls') return r.fulfill({ json: { urls: Object.fromEntries(body.ids.map(id => [id, `${CDN}/${body.size}/${id}.png`])), failed: {} } });
      if (body.action === 'library') {
        const start = body.cursor ? OD.findIndex(x => x.id === body.cursor.id) + 1 : 0, limit = body.limit || 120;
        const items = OD.slice(start, start + limit), last = items.at(-1);
        return r.fulfill({ json: { items, next_cursor: start + limit < OD.length && last ? { t: last.taken_at, id: last.id } : null, indexing: false } });
      }
      if (body.action === 'months') return r.fulfill({ json: { months: { '2024-03': N }, total: OD.length } });
      if (body.action === 'trash-watch') return r.fulfill({ json: { gone: 0 } });
      if (body.action === 'folders-tree') return r.fulfill({ json: { top: { id: 'T', name: '카메라', count: OD.length, total: OD.length }, folders: [], indexing: false } });
      return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
    });
    await page.route('**/__phone/**', r => {
      const u = new URL(r.request().url());
      if (!u.pathname.includes(`/__phone/${KEY}/`)) return r.fulfill({ status: 404, body: '' });
      if (u.pathname.endsWith('/page')) {
        const offset = Number(u.searchParams.get('offset') || 0), limit = Number(u.searchParams.get('limit') || 120);
        const items = PHONE.slice(offset, offset + limit);
        return r.fulfill({ json: { items, next: offset + limit < PHONE.length ? offset + limit : null, total: PHONE.length } });
      }
      if (u.pathname.endsWith('/folders')) return r.fulfill({ json: { folders: [
        { id: 'DCIM/Camera/', name: 'Camera', count: N, cover: PHONE[3] },
      ] } });
      if (u.pathname.endsWith('/months')) return r.fulfill({ json: { months: { '2024-03': N } } });
      if (u.pathname.endsWith('/days')) return r.fulfill({ json: { days: {} } });
      if (u.pathname.includes('/thumb/')) {
        const id = u.pathname.split('/thumb/')[1];
        state.thumbs.push(`${id}:${u.searchParams.get('s')}`);
        return r.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg(id !== '4') });
      }
      if (u.pathname.includes('/media/')) { state.media++; return r.fulfill({ status: 404, body: '' }); }
      return r.fulfill({ status: 404, body: '' });
    });
  } });
  return state;
}
async function openPhotos(page, width) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav').getByRole('button', { name: '사진', exact: true }).click();
  } else await page.locator('#appView>.app-nav').getByRole('button', { name: '사진', exact: true }).click();
  await expect(page.locator('#photosView')).toBeVisible();
}
for (const width of [412, 1280]) {
  test.describe(`폰 앱 ${width}`, () => {
    test.use({ viewport: { width, height: 915 }, userAgent: ANDROID, hasTouch: true, isMobile: width <= 760 });
    test('비슷한 사진: 누를 때 작은 그림으로 계산·10분 안 같은 장면만 묶음·두 장 나란히 비교·남길 것 고르기', async ({ page }) => {
      const state = await fixture(page);
      await openPhotos(page, width);
      const box = page.locator('#photosRoot [data-photos-tidy]');
      await page.locator('#photosRoot [data-photos-tidy-chip]').click();
      await expect(box.locator('.photos-tidy-at')).toContainText(`폰 ${PHONE.length}장 · 원드라이브 1장 확인`, { timeout: 30_000 });
      const dups = box.locator('details[data-k="dups"]');
      await dups.locator('summary').click();
      await expect(dups.locator('summary .photos-tidy-help')).toContainText('비슷한 사진 = 10분 안에 같은 장면을 조금씩 다르게 찍은 사진');
      const chip = dups.locator('.photos-tidy-places [data-photos-tidy-dupkind="similar"]');
      await expect(chip).toHaveText('비슷한 사진');
      await expect(chip).toHaveAttribute('aria-pressed', 'true');
      const before = state.thumbs.length;
      await dups.locator('[data-photos-tidy-sim] [data-photos-tidy-dupkind="similar"]').click();
      await expect(chip).toHaveText('비슷한 사진 1', { timeout: 20_000 });
      await expect(dups.locator('[data-photos-tidy-sim]')).toHaveCount(0);
      // 계산에 쓴 것은 작은 미리보기뿐, 원본은 받지 않는다.
      expect(state.thumbs.slice(before).every(x => x.endsWith(':small'))).toBe(true);
      expect(state.media).toBe(0);
      await expect(dups.locator('.photos-tidy-line').first()).toHaveText('10분 안에 같은 장면을 조금씩 다르게 찍은 사진 · 묶음 1개 · 지울 수 있는 사진 2장 · 아낄 용량 2.3MB');
      await expect(dups.locator('[data-photos-tidy-dup]')).toHaveCount(1);
      const g = dups.locator('[data-photos-tidy-dup="ph:1"]');
      await expect(g.locator('.photos-tidy-num').first()).toHaveText('비슷한 사진 3장 · 아낄 2.3MB');
      await expect(g.locator('.photos-tidy-pick')).toHaveCount(3);
      // 비교: 왼쪽 = 가장 큰 파일(ph:2), 두 장 나란히(폰 412도), [이것 남기기].
      await g.locator('[data-photos-tidy-see="dup:ph:1"]').click();
      const slots = g.locator('.photos-tidy-cmp-slot');
      await expect(slots).toHaveCount(2);
      const [a, b] = [await slots.nth(0).boundingBox(), await slots.nth(1).boundingBox()];
      expect(Math.abs(a.y - b.y)).toBeLessThan(2);
      expect(b.x).toBeGreaterThan(a.x + a.width - 1);
      expect(a.x + a.width * 2).toBeLessThanOrEqual(width + 1);
      const ids = () => g.locator('[data-photos-tidy-cmp-open]').evaluateAll(els => els.map(e => e.dataset.photosTidyCmpOpen.split('|')[1]));
      await expect.poll(ids).toEqual(['ph:2', 'ph:1']);
      await slots.nth(1).locator('[data-photos-tidy-keep="ph:1|ph:1"]').click();
      await expect.poll(ids).toEqual(['ph:1', 'ph:2']);
      await expect(g.locator('.photos-tidy-pick[aria-pressed="true"]')).toHaveAttribute('data-photos-tidy-keep', 'ph:1|ph:1');
      // 지우기 단추는 19B와 같은 자리(원드라이브 사본 확인 안전장치를 거침).
      await expect(g.locator('[data-photos-tidy-trash="dup|ph:1"]')).toHaveText('나머지 지우기');
      await expect(dups.locator('[data-photos-tidy-trash="dups"]')).toBeVisible();
      expect(state.errors).toEqual([]);
    });
  });
}
