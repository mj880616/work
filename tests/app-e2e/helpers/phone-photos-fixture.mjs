import { expect } from '@playwright/test';
import { openHome } from './home-entry.mjs';
import { installViewPrefsServer } from './view-prefs-server.mjs';
// 폰 앱(KPTUAndroid) 사진 화면 흉내: 앱 다리(KPTUAppShell)·__phone 가로채기·onedrive-photos(Edge). photo-sources.spec.mjs와 같은 재료.
// S47-18 뒤로가기 시험(back-rest.spec.mjs)이 쓴다.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const CDN = 'https://od-thumb.example.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
export const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.3.9';
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

export async function phonePhotosFixture(page, { app = false } = {}) {
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
export async function openPhotos(page, width) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav').getByRole('button', { name: '사진', exact: true }).click();
  } else await page.locator('#appView>.app-nav').getByRole('button', { name: '사진', exact: true }).click();
  await expect(page.locator('#photosView')).toBeVisible();
}
