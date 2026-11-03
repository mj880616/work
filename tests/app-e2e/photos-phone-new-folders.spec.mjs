import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { phoneFolderKey } from '../../app/phone-folders-model.mjs';
// S48-31 새 폰 폴더는 꺼진 채(요청함 10/31 11:04 사진 폴더 [사용자 결정] '새로 생긴 폴더는 꺼진 채로 시작').
// - 처음(아는 폴더 없음): 지금 보이는 폰 폴더를 모두 '아는 폴더'(view_prefs.phone_folders_known, 지문)로 저장, 끈 목록은 그대로 — 보이는 사진 그대로.
// - 그 뒤 새로 생긴 폰 폴더: 끈 목록(phone_folders_off)에 더해져 [사진]에 안 보이고 [폴더] 스위치가 꺼진 채. 켜면 사진에 나오고 아는 폴더에 들어간다.
// - DB 적용 전(아는 폴더 칸 거절): 지금처럼 새 폴더가 켜진 채, 다른 화면 기억은 그대로.
// 네트워크 없음(지어낸 서버·지어낸 앱 다리), 사진은 1×1 그림.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.4.13';
const KEY = 'PhoneKeyForTest_0123456789';
const CAM = 'DCIM/Camera/', TG = 'Pictures/Telegram/', OLD = 'Pictures/숨김/';
const PHONE = [
  { id: '1', name: 'IMG_1.jpg', day: '2026-10-31', taken_at: '2026-10-31T03:00:00.000Z', size_bytes: 10, folder: CAM },
  { id: '2', name: 'TG_2.jpg', day: '2026-10-30', taken_at: '2026-10-30T03:00:00.000Z', size_bytes: 20, folder: TG },
  { id: '3', name: 'OLD_3.jpg', day: '2026-10-29', taken_at: '2026-10-29T03:00:00.000Z', size_bytes: 30, folder: OLD },
].map(m => ({ ...m, approx: false, kind: 'photo', width: 10, height: 10, duration_ms: null, screenshot: false, uploaded_at: m.taken_at }));

async function fixture(page, initial, options = {}) {
  const state = { errors: [], hides: [] };
  page.on('pageerror', e => state.errors.push(e.message));
  await page.addInitScript(() => { window.KPTUOdWarm = { run: () => null }; });
  await page.addInitScript(key => {
    const listeners = [];
    const prev = window.KPTUAppShell;
    window.KPTUAppShell = {
      postMessage(m) {
        if (m === 'photos:hello' || m === 'photos:ask') setTimeout(() => listeners.forEach(fn => fn({ data: `photos:state:{"access":"full","key":"${key}","trash":true,"hide":true,"ops":true}` })), 0);
        prev?.postMessage?.(m);
      },
      addEventListener(type, fn) { if (type === 'message') listeners.push(fn); prev?.addEventListener?.(type, fn); },
    };
  }, KEY);
  const prefs = await installViewPrefsServer(page, initial, options);
  await openHome(page, { beforeLoad: async () => {
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_photo_tags', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', r => {
      const body = r.request().postDataJSON();
      if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: false } });
      return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
    });
    // 앱이 WebView 안에서 답하는 폰 사진: hide(끈 폴더 JSON 배열)에 든 폴더 사진은 뺀다(앱 0.4.1+와 같음).
    await page.route('**/__phone/**', r => {
      const u = new URL(r.request().url());
      if (!u.pathname.includes(`/__phone/${KEY}/`)) return r.fulfill({ status: 404, body: '' });
      const hide = JSON.parse(u.searchParams.get('hide') || '[]');
      if (u.pathname.endsWith('/page')) {
        state.hides.push(hide);
        const folder = u.searchParams.get('folder');
        const list = PHONE.filter(m => (folder === null ? !hide.includes(m.folder) : m.folder === folder));
        return r.fulfill({ json: { items: list.map(({ folder: _f, ...m }) => m), next: null, total: list.length } });
      }
      if (u.pathname.endsWith('/folders')) return r.fulfill({ json: { folders: [
        { id: CAM, name: 'Camera', count: 1, cover: PHONE[0] },
        { id: TG, name: 'Telegram', count: 1, cover: PHONE[1] },
        { id: OLD, name: '숨김', count: 1, cover: PHONE[2] },
      ] } });
      if (u.pathname.endsWith('/months')) return r.fulfill({ json: { months: { '2026-10': 3 } } });
      if (u.pathname.endsWith('/days')) return r.fulfill({ json: { days: {} } });
      if (u.pathname.includes('/thumb/')) return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      return r.fulfill({ status: 404, body: '' });
    });
  } });
  return { state, prefs };
}
async function openPhotos(page) {
  await page.locator('#mobileMenuTab').click();
  await page.locator('#mobileMenu nav').getByRole('button', { name: '사진', exact: true }).click();
  await expect(page.locator('#photosView')).toBeVisible();
}
const ids = page => page.locator('#photosRoot [data-photos-list] [data-photos-open]').evaluateAll(els => els.map(e => e.dataset.photosId));
const sw = (page, path) => page.locator(`#photosRoot [data-photos-pf-sw="ph:${path}"]`);
const BASE = { photo_sources_phone: { onedrive: false, phone: true } };

test.describe('폰 앱 412', () => {
  test.use({ viewport: { width: 412, height: 915 }, userAgent: ANDROID, hasTouch: true, isMobile: true });

  test('처음: 지금 보이는 폰 폴더를 아는 폴더로 저장하고 보이는 사진은 그대로(끈 폴더만 빠짐)', async ({ page }) => {
    const { state, prefs } = await fixture(page, { ...BASE, phone_folders_off: [OLD] });
    await openPhotos(page);
    await expect.poll(() => ids(page)).toEqual(['ph:1', 'ph:2']);
    await expect.poll(() => prefs.value?.phone_folders_known).toEqual([phoneFolderKey(CAM), phoneFolderKey(TG)].sort());
    expect(prefs.value.phone_folders_off).toEqual([OLD]);
    expect(state.hides.every(h => JSON.stringify(h) === JSON.stringify([OLD]))).toBe(true);
    expect(state.errors).toEqual([]);
  });

  test('그 뒤 새로 생긴 폰 폴더는 꺼진 채: [사진]에 안 보이고 [폴더] 스위치 꺼짐, 켜면 보이고 아는 폴더에 들어감', async ({ page }) => {
    const { state, prefs } = await fixture(page, { ...BASE, phone_folders_off: [OLD], phone_folders_known: [phoneFolderKey(CAM)] });
    await openPhotos(page);
    await expect.poll(() => ids(page)).toEqual(['ph:1']);
    await expect.poll(() => prefs.value?.phone_folders_off).toEqual([TG, OLD].sort());
    expect(state.hides[0].sort()).toEqual([TG, OLD].sort());
    await page.locator('#photosRoot [data-photos-tab="folders"]').click();
    await expect(sw(page, TG)).toHaveAttribute('aria-checked', 'false');
    await expect(sw(page, CAM)).toHaveAttribute('aria-checked', 'true');
    await sw(page, TG).click();
    await expect(sw(page, TG)).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => prefs.value?.phone_folders_off).toEqual([OLD]);
    await expect.poll(() => prefs.value?.phone_folders_known).toEqual([phoneFolderKey(CAM), phoneFolderKey(TG)].sort());
    // 새로고침해도 켠 폴더는 다시 꺼지지 않는다(서버 기억).
    // 새로고침은 보던 [폴더] 탭으로 돌아올 수 있으므로(새로고침 뒤 같은 화면) [사진] 탭을 눌러 본다.
    await page.reload();
    await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
    if (!(await page.locator('#photosView').isVisible())) await openPhotos(page);
    await page.locator('#photosRoot [data-photos-tab="all"]').click();
    await expect.poll(() => ids(page)).toEqual(['ph:1', 'ph:2']);
    expect(prefs.value.phone_folders_off).toEqual([OLD]);
    expect(state.errors).toEqual([]);
  });

  test('DB 적용 전(아는 폴더 칸 거절): 지금처럼 새 폴더도 보이고 끈 목록은 그대로', async ({ page }) => {
    const { state, prefs } = await fixture(page, { ...BASE, phone_folders_off: [OLD] }, { denyKeys: ['phone_folders_known'] });
    await openPhotos(page);
    await expect.poll(() => ids(page)).toEqual(['ph:1', 'ph:2']);
    await page.waitForTimeout(1500);
    expect(prefs.value.phone_folders_known).toBeUndefined();
    expect(prefs.value.phone_folders_off).toEqual([OLD]);
    expect(state.errors).toEqual([]);
  });
});
