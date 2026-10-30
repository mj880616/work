import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// PHOTO-출처 ①(요청함 10/30 17:30): 사진 메뉴 위 줄 오른쪽 출처 아이콘 + 폰 사진 섞어 보기.
// - PC(1440, 웹 브라우저): 원드라이브·구글 드라이브(준비 중) 아이콘만, 폰 사진 아이콘 없음, 출처 표시 없음.
// - 폰 앱(412, 앱 다리 흉내 + __phone 가로채기 흉내): 폰 사진이 원드라이브 사진과 찍은 날 순서로 섞이고 칸 오른쪽 아래 출처 표시,
//   같은 사진(이름·크기 같음)은 한 장만. 폰 아이콘을 누르면 꺼지고(서버 view_prefs.photo_sources) 원드라이브 사진만 남는다.
// 네트워크 없음(지어낸 서버·지어낸 앱), 사진은 1×1 그림.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const CDN = 'https://od-thumb.example.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.3.9';
const KEY = 'PhoneKeyForTest_0123456789';
// 원드라이브: 10/30·10/28·10/26 (O3은 폰의 IMG_9.jpg와 같은 사진).
const OD = [
  { id: 'O1', name: 'a.jpg', day: '2026-10-30', taken_at: '2026-10-30T03:00:00.000Z', size_bytes: 111 },
  { id: 'O2', name: 'b.jpg', day: '2026-10-28', taken_at: '2026-10-28T03:00:00.000Z', size_bytes: 222 },
  { id: 'O3', name: 'IMG_9.jpg', day: '2026-10-26', taken_at: '2026-10-26T03:00:00.000Z', size_bytes: 999 },
].map(m => ({ ...m, approx: false, kind: 'photo', screenshot: false, duration_ms: null, uploaded_at: m.taken_at }));
// 폰: 10/31·10/29·10/26(같은 사진)·10/25.
const PHONE = [
  { id: '1', name: 'IMG_1.jpg', day: '2026-10-31', taken_at: '2026-10-31T03:00:00.000Z', size_bytes: 10 },
  { id: '2', name: 'IMG_2.jpg', day: '2026-10-29', taken_at: '2026-10-29T03:00:00.000Z', size_bytes: 20 },
  { id: '9', name: 'IMG_9.jpg', day: '2026-10-26', taken_at: '2026-10-26T03:00:00.000Z', size_bytes: 999 },
  { id: '4', name: 'IMG_4.jpg', day: '2026-10-25', taken_at: '2026-10-25T03:00:00.000Z', size_bytes: 40 },
].map(m => ({ ...m, approx: false, kind: 'photo', width: 10, height: 10, duration_ms: null, screenshot: false, uploaded_at: m.taken_at }));

async function fixture(page, { app = false } = {}) {
  const state = { errors: [], phoneReads: [], sent: [], edge: [] };
  page.on('pageerror', e => state.errors.push(e.message));
  await page.addInitScript(() => { window.KPTUOdWarm = { run: () => null }; });
  if (app) {
    // 앱 다리 흉내: photos:hello에 '전체 허용 + 열쇠'로 답하고, 보낸 말을 남긴다.
    await page.addInitScript(key => {
      const listeners = [];
      window.__photoSent = [];
      const prev = window.KPTUAppShell;
      window.KPTUAppShell = {
        postMessage(m) {
          window.__photoSent.push(String(m));
          if (m === 'photos:hello' || m === 'photos:ask') setTimeout(() => listeners.forEach(fn => fn({ data: `photos:state:{"access":"full","key":"${key}","trash":true}` })), 0);
          prev?.postMessage?.(m);
        },
        addEventListener(type, fn) { if (type === 'message') listeners.push(fn); prev?.addEventListener?.(type, fn); },
      };
    }, KEY);
  }
  const prefs = await installViewPrefsServer(page);
  await openHome(page, { beforeLoad: async () => {
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_photo_tags', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === CDN, r => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PNG }));
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
      const body = r.request().postDataJSON();
      state.edge.push(body.action);
      if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true } });
      if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false, changed: 0 } });
      if (body.action === 'photo-urls') return r.fulfill({ json: { urls: Object.fromEntries(body.ids.map(id => [id, `${CDN}/${body.size}/${id}.png`])), failed: {} } });
      if (body.action === 'library') return r.fulfill({ json: { items: OD, next_cursor: null, indexing: false } });
      if (body.action === 'months') return r.fulfill({ json: { months: { '2026-10': OD.length }, total: OD.length } });
      if (body.action === 'folders-tree') return r.fulfill({ json: { top: { id: 'T', name: '카메라', count: OD.length, total: OD.length + 0 }, folders: [{ id: 'S1', name: 'OneSyncFiles', parent_id: 'T', enabled: true, count: 0, total: 0 }], indexing: false } });
      if (body.action === 'trash-list') return r.fulfill({ json: { items: [], purged: 0, truncated: false } });
      return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
    });
    // 앱이 WebView 안에서 답하는 폰 사진(서버로 나가지 않음).
    await page.route('**/__phone/**', r => {
      const u = new URL(r.request().url());
      state.phoneReads.push(u.pathname.replace(/^.*__phone\//, '') + u.search);
      if (!u.pathname.includes(`/__phone/${KEY}/`)) return r.fulfill({ status: 404, body: '' });
      if (u.pathname.endsWith('/page')) {
        // PHOTO-출처모든칩: folder= 면 그 폰 폴더 사진만(Camera = 1·2, Screenshots = 9·4).
        const folder = u.searchParams.get('folder');
        const list = folder === null ? PHONE : PHONE.filter(m => (folder === 'DCIM/Camera/') === ['1', '2'].includes(m.id));
        return r.fulfill({ json: { items: list, next: null, total: list.length } });
      }
      if (u.pathname.endsWith('/folders')) return r.fulfill({ json: { folders: [
        { id: 'DCIM/Camera/', name: 'Camera', count: 2, cover: PHONE[0] },
        { id: 'Pictures/Screenshots/', name: 'Screenshots', count: 2, cover: PHONE[2] },
      ] } });
      if (u.pathname.endsWith('/months')) return r.fulfill({ json: { months: { '2026-10': PHONE.length } } });
      if (u.pathname.endsWith('/days')) return r.fulfill({ json: { days: {} } });
      if (u.pathname.includes('/thumb/')) return r.fulfill({ status: 200, contentType: 'image/jpeg', body: PNG });
      return r.fulfill({ status: 404, body: '' });
    });
  } });
  return { state, prefs };
}
async function openPhotos(page, width) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav').getByRole('button', { name: '사진', exact: true }).click();
  } else await page.locator('#appView>.app-nav').getByRole('button', { name: '사진', exact: true }).click();
  await expect(page.locator('#photosView')).toBeVisible();
}
const ids = page => page.locator('#photosRoot [data-photos-list] [data-photos-open]').evaluateAll(els => els.map(e => e.dataset.photosId));
const src = page => page.locator('#photosRoot [data-photos-src]');

test.describe('PC 1440', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test('사진 출처: PC는 원드라이브·구글 드라이브(준비 중)만, 폰 사진 아이콘·출처 표시 없음', async ({ page }) => {
    const { state } = await fixture(page);
    await openPhotos(page, 1440);
    await expect.poll(() => ids(page)).toEqual(['O1', 'O2', 'O3']);
    await expect(src(page).locator('visible=true')).toHaveCount(2);
    await expect(page.locator('#photosRoot [data-photos-src="onedrive"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#photosRoot [data-photos-src="gdrive"]')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('#photosRoot [data-photos-src="phone"]')).toBeHidden();
    await expect(page.locator('#photosRoot .photos-src-mark')).toHaveCount(0);
    expect(state.phoneReads).toEqual([]);
    expect(state.errors).toEqual([]);
  });
});

test.describe('폰 앱 412', () => {
  test.use({ viewport: { width: 412, height: 915 }, userAgent: ANDROID, hasTouch: true, isMobile: true });
  test('사진 출처: 폰 사진이 찍은 날 순서로 섞이고 출처 표시, 같은 사진은 한 장, 폰 아이콘으로 끄기(서버 저장)', async ({ page }) => {
    const { state, prefs } = await fixture(page, { app: true });
    await openPhotos(page, 412);
    // 10/31(폰) · 10/30(원) · 10/29(폰) · 10/28(원) · 10/26(원, 폰의 같은 사진은 빠짐) · 10/25(폰)
    await expect.poll(() => ids(page)).toEqual(['ph:1', 'O1', 'ph:2', 'O2', 'O3', 'ph:4']);
    const phoneBtn = page.locator('#photosRoot [data-photos-src="phone"]');
    await expect(phoneBtn).toBeVisible();
    await expect(phoneBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#photosRoot [data-photos-id="ph:1"] .photos-src-mark')).toHaveAttribute('data-src', 'phone');
    await expect(page.locator('#photosRoot [data-photos-id="O1"] .photos-src-mark')).toHaveAttribute('data-src', 'onedrive');
    await expect(page.locator('#photosRoot [data-photos-id="ph:1"] .diary-photo')).toHaveAttribute('data-img-state', 'shown');
    expect(state.phoneReads.some(p => p.startsWith(`${KEY}/page?`))).toBe(true);
    expect(await page.evaluate(() => window.__photoSent.filter(m => m.startsWith('photos:')))).toContain('photos:hello');
    // 끄기: 원드라이브 사진만, 출처 표시 없음, 서버에 photo_sources.phone=false.
    await phoneBtn.click();
    await expect(phoneBtn).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => ids(page)).toEqual(['O1', 'O2', 'O3']);
    await expect(page.locator('#photosRoot .photos-src-mark')).toHaveCount(0);
    await expect.poll(() => prefs.patches.at(-1)?.photo_sources).toEqual({ onedrive: true, gdrive: false, phone: false });
    // 크게 보기는 폰 사진도 같은 부품.
    await phoneBtn.click();
    await expect.poll(() => ids(page)).toEqual(['ph:1', 'O1', 'ph:2', 'O2', 'O3', 'ph:4']);
    await page.locator('#photosRoot [data-photos-id="ph:1"]').click();
    const viewer = page.locator('[data-diary-viewer]');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('[data-diary-viewer-count]')).toHaveText('1 / 6');
    expect(state.phoneReads.some(p => /thumb\/1\?s=large/.test(p))).toBe(true);
    expect(state.errors).toEqual([]);
  });
});

// PHOTO-출처모든칩(요청함 10/31 00:01): 출처 켜기/끄기가 [폴더]·[휴지통]·[앨범]에도, 폰 폴더 보기.
test.describe('폰 앱 412 · 모든 칩', () => {
  test.use({ viewport: { width: 412, height: 915 }, userAgent: ANDROID, hasTouch: true, isMobile: true });
  test('원드라이브를 끄면 [폴더]는 폰 폴더만·[휴지통]은 안내 한 줄, 다시 켜면 두 묶음, 모두 끄면 한 줄', async ({ page }) => {
    const { state } = await fixture(page, { app: true });
    await openPhotos(page, 412);
    await expect.poll(() => ids(page)).toEqual(['ph:1', 'O1', 'ph:2', 'O2', 'O3', 'ph:4']);
    const od = page.locator('#photosRoot [data-photos-src="onedrive"]'), phoneBtn = page.locator('#photosRoot [data-photos-src="phone"]');
    const tab = name => page.locator(`#photosRoot [data-photos-tab="${name}"]`);
    const bodyEl = page.locator('#photosRoot [data-photos-body]');
    // 둘 다 켜짐: [폴더]에 '원드라이브'·'폰' 두 묶음.
    await tab('folders').click();
    await expect(bodyEl.locator('[data-photos-fx-group="onedrive"]')).toHaveText('원드라이브');
    await expect(bodyEl.locator('[data-photos-fx-group="phone"]')).toHaveText('폰');
    await expect(bodyEl.locator('[data-photos-fx-open="S1"]')).toBeVisible();
    await expect(bodyEl.locator('[data-photos-pf-open]')).toHaveCount(2);
    // 원드라이브 끄기: 폰 폴더만(원드라이브 폴더·⋯·새 폴더 없음).
    await od.click();
    await expect(od).toHaveAttribute('aria-pressed', 'false');
    await expect(bodyEl.locator('[data-photos-fx-open]')).toHaveCount(0);
    await expect(bodyEl.locator('[data-photos-fx-more], [data-photos-fx-new]')).toHaveCount(0);
    await expect(bodyEl.locator('[data-photos-pf-open]')).toHaveText(['📁Camera2', '📁Screenshots2']);
    // 폰 폴더 열기 → 그 폴더 사진 격자, 뒤로가기로 목록.
    await bodyEl.locator('[data-photos-pf-open="DCIM/Camera/"]').click();
    await expect(bodyEl.locator('.photos-fx-here')).toContainText('Camera');
    await expect.poll(() => bodyEl.locator('[data-photos-open]').evaluateAll(els => els.map(e => e.dataset.photosId))).toEqual(['ph:1', 'ph:2']);
    expect(state.phoneReads.some(p => /page\?.*folder=DCIM%2FCamera%2F/.test(p))).toBe(true);
    await page.goBack();
    await expect(bodyEl.locator('[data-photos-pf-open]')).toHaveCount(2);
    // [휴지통]: 원드라이브 휴지통을 읽지 않고 안내 한 줄.
    const trashReads = state.edge.filter(a => a === 'trash-list').length;
    await tab('trash').click();
    await expect(bodyEl.locator('[data-photos-phone-trash]')).toHaveText('폰 휴지통은 갤러리 앱에서');
    await expect(bodyEl.locator('[data-photos-open]')).toHaveCount(0);
    expect(state.edge.filter(a => a === 'trash-list').length).toBe(trashReads);
    // 모두 끄기: 모든 칩에서 한 줄.
    await phoneBtn.click();
    for (const name of ['trash', 'folders', 'albums', 'all']) {
      await tab(name).click();
      await expect(bodyEl.locator('[data-photos-no-source]')).toHaveText('위 출처 아이콘을 켜 주세요.');
    }
    // 원드라이브만 다시 켜기: [폴더]는 원드라이브 폴더만, 묶음 이름 없음.
    await od.click();
    await tab('folders').click();
    await expect(bodyEl.locator('[data-photos-fx-open="S1"]')).toBeVisible();
    await expect(bodyEl.locator('[data-photos-pf-open], [data-photos-fx-group]')).toHaveCount(0);
    expect(state.errors).toEqual([]);
  });
});
