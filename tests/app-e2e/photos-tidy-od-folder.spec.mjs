import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S59-12 OPS-빠진일2차 6: 사진 정리 '있는 곳' 줄의 원드라이브 사본이 늘 '폴더 모름'이던 것.
// 서버 library가 사진마다 든 폴더 id(folder)를 주고, 화면은 폴더 나무(folders-tree)로 맨 위까지 이름을 이어 경로를 그린다.
// 전체 보기면 원드라이브 루트 이름은 빼고(루트 바로 안 = '맨 위'), 나무에 없는 폴더는 그대로 '폴더 모름'. 폰 412·PC 1280.
// 네트워크 없음(지어낸 서버·지어낸 앱, 가짜 자료만). 사진: S59_12_SHOTS 폴더가 있으면 docs/design/screens/s59-12/ 용으로 남긴다.
const SHOTS = process.env.S59_12_SHOTS || '';
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const CDN = 'https://od-thumb.example.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.4.1';
const KEY = 'PhoneKeyForTest_0123456789';
const T0 = Date.parse('2026-10-05T01:00:00.000Z');
const at = ms => new Date(T0 + ms).toISOString();
const m = (id, name, ms, size, folder, extra = {}) => ({ id: String(id), name, folder, day: at(ms).slice(0, 10), taken_at: at(ms), size_bytes: size, width: 400, height: 300,
  approx: false, kind: 'photo', duration_ms: null, screenshot: false, uploaded_at: at(ms), ...extra });
// 같은 사진 2곳(카메라·카톡, 찍은 시각 1초 차 · 같은 작은 그림).
const PHONE = [m(10, 'IMG_10.jpg', 60_000, 500_000, 'DCIM/Camera/'), m(11, 'IMG_10(1).jpg', 61_000, 500_000, 'Pictures/KakaoTalk/')]
  .sort((a, b) => b.taken_at.localeCompare(a.taken_at));
// 원드라이브 사본 3장: 사진/2026 폴더, 루트 바로 안, 나무에 없는 폴더.
const od = (id, folder) => ({ id, name: 'IMG_10.jpg', day: at(60_000).slice(0, 10), taken_at: at(60_000), size_bytes: 500_000, width: 400, height: 300, approx: false, kind: 'photo',
  duration_ms: null, screenshot: false, uploaded_at: at(60_000), folder });
const OD = [od('O1', 'Y!2'), od('O2', 'ROOT!0'), od('O3', 'GONE!9')];
const TREE = { top: { id: 'ROOT!0', name: 'OneDrive', count: 1, total: 3, enabled: true }, whole: true, indexing: false, folders: [
  { id: 'P!1', name: '사진', parent_id: 'ROOT!0', enabled: true, count: 0, total: 1 },
  { id: 'Y!2', name: '2026', parent_id: 'P!1', enabled: true, count: 1, total: 1 },
] };

async function fixture(page) {
  const state = { errors: [], actions: [] };
  page.on('pageerror', e => state.errors.push(e.message));
  await page.addInitScript(() => { window.KPTUOdWarm = { run: () => null }; });
  await page.addInitScript(key => {
    const listeners = [];
    const prev = window.KPTUAppShell;
    window.KPTUAppShell = {
      postMessage(msg) {
        if (msg === 'photos:hello' || msg === 'photos:ask') setTimeout(() => listeners.forEach(fn => fn({ data: `photos:state:{"access":"full","key":"${key}","trash":true,"hide":true}` })), 0);
        prev?.postMessage?.(msg);
      },
      addEventListener(type, fn) { if (type === 'message') listeners.push(fn); prev?.addEventListener?.(type, fn); },
    };
  }, KEY);
  await installViewPrefsServer(page, { photo_sources_phone: { onedrive: true, gdrive: false, phone: true } });
  await openHome(page, { beforeLoad: async () => {
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_photo_tags', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === CDN, r => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PNG }));
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
      const body = r.request().postDataJSON();
      state.actions.push(body.action);
      if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: 'OneDrive' }, whole: true, can_delete: true } });
      if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false, changed: 0 } });
      if (body.action === 'photo-urls') return r.fulfill({ json: { urls: Object.fromEntries(body.ids.map(id => [id, `${CDN}/${body.size}/${id}.png`])), failed: {} } });
      if (body.action === 'library') {
        const start = body.cursor ? OD.findIndex(x => x.id === body.cursor.id) + 1 : 0, limit = body.limit || 120;
        const items = OD.slice(start, start + limit), last = items.at(-1);
        return r.fulfill({ json: { items, next_cursor: start + limit < OD.length && last ? { t: last.taken_at, id: last.id } : null, indexing: false } });
      }
      if (body.action === 'months') return r.fulfill({ json: { months: { '2026-10': OD.length }, total: OD.length } });
      if (body.action === 'trash-watch') return r.fulfill({ json: { gone: 0 } });
      if (body.action === 'folders-tree') return r.fulfill({ json: TREE });
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
        { id: 'DCIM/Camera/', name: 'Camera', count: 1, cover: PHONE[1] },
        { id: 'Pictures/KakaoTalk/', name: 'KakaoTalk', count: 1, cover: PHONE[0] },
      ] } });
      if (u.pathname.endsWith('/months')) return r.fulfill({ json: { months: { '2026-10': PHONE.length } } });
      if (u.pathname.endsWith('/days')) return r.fulfill({ json: { days: {} } });
      if (u.pathname.includes('/thumb/')) return r.fulfill({ status: 200, contentType: 'image/jpeg', body: PNG });
      return r.fulfill({ status: 404, body: '' });
    });
  } });
  return state;
}
async function openPhotos(page, width) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav').getByRole('button', { name: '사진', exact: true }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '사진', exact: true }).click();
  await expect(page.locator('#photosView')).toBeVisible();
}
for (const width of [412, 1280]) {
  test.describe(`폰 앱 ${width}`, () => {
    test.use({ viewport: { width, height: 915 }, userAgent: ANDROID, hasTouch: true, isMobile: width <= 760 });
    test('사진 정리 있는 곳: 원드라이브 사본마다 폴더 경로(전체 보기는 루트 빼고, 루트 바로 안은 맨 위, 모르는 폴더는 폴더 모름)', async ({ page }) => {
      const state = await fixture(page);
      await openPhotos(page, width);
      const box = page.locator('#photosRoot [data-photos-tidy]');
      await page.locator('#photosRoot [data-photos-tidy-chip]').click();
      await expect(box.locator('.photos-tidy-at')).toContainText(`폰 ${PHONE.length}장 · 원드라이브 ${OD.length}장 확인`, { timeout: 30_000 });
      const dups = box.locator('details[data-k="dups"]');
      await dups.locator('summary').click();
      await expect(dups.locator('[data-photos-tidy-dupkind="copy"]')).toHaveText('같은 사진 1');
      const copy = dups.locator('[data-photos-tidy-dup="ph:10"]');
      await copy.locator('[data-photos-tidy-see="dup:ph:10"]').click();
      const slots = copy.locator('[data-photos-tidy-cmp="ph:10"] .photos-tidy-cmp-slot');
      await expect(slots).toHaveCount(2);
      const lines = ['원드라이브 · 사진/2026', '원드라이브 · 맨 위', '원드라이브 · 폴더 모름'];
      await expect(slots.nth(0).locator('.photos-tidy-where')).toHaveText(['폰 · DCIM/Camera', ...lines]);
      await expect(slots.nth(1).locator('.photos-tidy-where')).toHaveText(['폰 · Pictures/KakaoTalk', ...lines]);
      // 긴 줄이 칸 밖으로 넘치지 않는다(두 칸 나란히, 화면 폭 안).
      const [a, b] = [await slots.nth(0).boundingBox(), await slots.nth(1).boundingBox()];
      expect(Math.abs(a.y - b.y)).toBeLessThan(2);
      expect(b.x + b.width).toBeLessThanOrEqual(width + 1);
      for (const s of [slots.nth(0), slots.nth(1)]) {
        const over = await s.locator('.photos-tidy-where').evaluateAll(els => els.some(e => e.scrollWidth > e.parentElement.clientWidth + 1));
        expect(over).toBe(false);
      }
      // 폴더 나무는 찾을 때 한 번만 읽는다(사진 메뉴 [폴더] 보기와 같은 서버 동작).
      expect(state.actions.filter(x => x === 'folders-tree')).toHaveLength(1);
      if (SHOTS) {
        await copy.scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${SHOTS}/tidy-where-od-path-${width}.png` });
      }
      expect(state.errors).toEqual([]);
    });
  });
}
