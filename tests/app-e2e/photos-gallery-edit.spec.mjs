import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// PHOTO-갤러리편집(요청함 11/01 19:00, A안): 사진 크게 보기 [✎ 편집] → 폰 앱이 삼성 갤러리 편집기로 넘긴다.
// - PC 1280(웹 브라우저): [편집] 없음.
// - 폰 앱 412(앱 다리 흉내, 0.4.6 = 상태에 edit): 폰 사진 [편집] → photos:edit:{"id"} → 돌아와 사진첩이 바뀌면 크게 보기를 닫고 사진 목록만 다시 읽는다.
//   원드라이브에만 있는 사진은 앱이 none → 한 줄 확인 → [편집] 한 번 더 → 기존 원본 받기(media-url download)로 받아 photos:save:begin|part|end → 그 번호로 편집.
// - 옛 앱(0.4.5, edit 없음): [편집] 없음.
// 네트워크 없음(지어낸 서버·지어낸 앱), 사진은 1×1 그림.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const CDN = 'https://od-thumb.example.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.4.6';
const KEY = 'PhoneKeyForTest_0123456789';
const OD = [
  { id: 'O1', name: 'a.png', day: '2026-10-30', taken_at: '2026-10-30T03:00:00.000Z', size_bytes: 111 },
].map(m => ({ ...m, approx: false, kind: 'photo', screenshot: false, duration_ms: null, uploaded_at: m.taken_at }));
const PHONE = [
  { id: '1', name: 'IMG_1.jpg', day: '2026-10-31', taken_at: '2026-10-31T03:00:00.000Z', size_bytes: 10 },
].map(m => ({ ...m, approx: false, kind: 'photo', width: 10, height: 10, duration_ms: null, screenshot: false, uploaded_at: m.taken_at }));

async function fixture(page, { app = false, edit = true } = {}) {
  const state = { errors: [], phoneReads: [], edge: [] };
  page.on('pageerror', e => state.errors.push(e.message));
  await page.addInitScript(() => { window.KPTUOdWarm = { run: () => null }; });
  if (app) {
    // 앱 다리 흉내: 상태(edit), 편집(번호 1·77은 바뀜, 원드라이브 사진은 폰에 없음), 받기(시작·조각·끝 → 번호 77).
    await page.addInitScript(({ key, edit }) => {
      const listeners = [];
      window.__photoSent = [];
      const say = data => setTimeout(() => listeners.forEach(fn => fn({ data })), 0);
      let got = 0;
      const prev = window.KPTUAppShell;
      window.KPTUAppShell = {
        postMessage(m) {
          m = String(m);
          window.__photoSent.push(m.startsWith('photos:save:part:') ? 'photos:save:part' : m);
          if (m === 'photos:hello' || m === 'photos:ask') say(`photos:state:{"access":"full","key":"${key}","trash":true,"hide":true,"ops":true,"manage":false${edit ? ',"edit":true' : ''}}`);
          else if (m.startsWith('photos:edit:')) {
            const t = JSON.parse(m.slice('photos:edit:'.length));
            say(t.id ? 'photos:edited:{"ok":true,"changed":true,"error":""}' : 'photos:edited:{"ok":false,"changed":false,"error":"none"}');
          } else if (m.startsWith('photos:save:begin:')) { got = 0; say('photos:save:{"ok":true,"step":"begin","got":0,"error":""}'); }
          else if (m.startsWith('photos:save:part:')) { got += atob(m.slice('photos:save:part:'.length)).length; say(`photos:save:{"ok":true,"step":"part","got":${got},"error":""}`); }
          else if (m === 'photos:save:end') say(`photos:save:{"ok":true,"step":"end","got":${got},"id":"77","error":""}`);
          prev?.postMessage?.(m);
        },
        addEventListener(type, fn) { if (type === 'message') listeners.push(fn); prev?.addEventListener?.(type, fn); },
      };
    }, { key: KEY, edit });
  }
  await installViewPrefsServer(page);
  await openHome(page, { beforeLoad: async () => {
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_diary_stars', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_photo_tags', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === CDN, r => r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PNG }));
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
      const body = r.request().postDataJSON();
      state.edge.push(body.action + (body.purpose ? ':' + body.purpose : ''));
      if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '카메라' }, can_delete: true } });
      if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false, changed: 0 } });
      if (body.action === 'photo-urls') return r.fulfill({ json: { urls: Object.fromEntries(body.ids.map(id => [id, `${CDN}/${body.size}/${id}.png`])), failed: {} } });
      if (body.action === 'media-url') return r.fulfill({ json: { url: `${CDN}/orig/${body.id}.png`, kind: 'photo', name: 'a.png', expires_in: 3000 } });
      if (body.action === 'library') return r.fulfill({ json: { items: OD, next_cursor: null, indexing: false } });
      if (body.action === 'months') return r.fulfill({ json: { months: { '2026-10': OD.length }, total: OD.length } });
      return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
    });
    await page.route('**/__phone/**', r => {
      const u = new URL(r.request().url());
      state.phoneReads.push(u.pathname.replace(/^.*__phone\//, '') + u.search);
      if (!u.pathname.includes(`/__phone/${KEY}/`)) return r.fulfill({ status: 404, body: '' });
      if (u.pathname.endsWith('/page')) return r.fulfill({ json: { items: PHONE, next: null, total: PHONE.length } });
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
  } else await page.locator('#appView>.app-nav').getByRole('button', { name: '사진', exact: true }).click();
  await expect(page.locator('#photosView')).toBeVisible();
}
const ids = page => page.locator('#photosRoot [data-photos-list] [data-photos-open]').evaluateAll(els => els.map(e => e.dataset.photosId));
const viewer = page => page.locator('[data-diary-viewer]');
const editBtn = page => viewer(page).locator('[data-strip-edit]');
const sent = page => page.evaluate(() => window.__photoSent.filter(m => /^photos:(edit|save)/.test(m)));

test.describe('PC 1280', () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test('사진 편집: PC 브라우저 크게 보기에는 [편집]이 없다', async ({ page }) => {
    const state = await fixture(page);
    await openPhotos(page, 1280);
    await expect.poll(() => ids(page)).toEqual(['O1']);
    await page.locator('#photosRoot [data-photos-id="O1"]').click();
    await expect(viewer(page)).toBeVisible();
    await expect(viewer(page).locator('[data-diary-share]')).toBeVisible();
    await expect(editBtn(page)).toBeHidden();
    expect(state.errors).toEqual([]);
  });
});

test.describe('폰 앱 412', () => {
  test.use({ viewport: { width: 412, height: 915 }, userAgent: ANDROID, hasTouch: true, isMobile: true });

  test('사진 편집: 폰 사진 [편집] → 편집기 → 바뀌면 크게 보기를 닫고 사진 목록만 다시 읽기', async ({ page }) => {
    const state = await fixture(page, { app: true });
    await openPhotos(page, 412);
    await expect.poll(() => ids(page)).toEqual(['ph:1', 'O1']);
    await page.locator('#photosRoot [data-photos-id="ph:1"]').click();
    await expect(viewer(page)).toBeVisible();
    await expect(editBtn(page)).toBeVisible();
    await expect(editBtn(page)).toHaveText('✎ 편집');
    const pages = state.phoneReads.filter(p => p.startsWith(`${KEY}/page?`)).length;
    await editBtn(page).click();
    await expect.poll(() => sent(page)).toEqual(['photos:edit:{"id":"1"}']);
    await expect(viewer(page)).toHaveCount(0);
    await expect(page.locator('.kptu-notice')).toContainText('편집한 사진을 반영했어요');
    await expect.poll(() => state.phoneReads.filter(p => p.startsWith(`${KEY}/page?`)).length).toBeGreaterThan(pages);
    await expect.poll(() => ids(page)).toEqual(['ph:1', 'O1']);
    expect(state.errors).toEqual([]);
  });

  test('사진 편집: 원드라이브에만 있는 사진은 한 줄 확인 뒤 원본을 폰에 받아 편집', async ({ page }) => {
    const state = await fixture(page, { app: true });
    await openPhotos(page, 412);
    await expect.poll(() => ids(page)).toEqual(['ph:1', 'O1']);
    await page.locator('#photosRoot [data-photos-id="O1"]').click();
    await expect(viewer(page)).toBeVisible();
    await editBtn(page).click();
    await expect(viewer(page).locator('[data-diary-viewer-note]')).toContainText('폰에 없는 사진이에요');
    expect(await sent(page)).toEqual(['photos:edit:{"name":"a.png","size":111,"taken":1793329200000}']);
    expect(state.edge.filter(a => a === 'media-url:download')).toEqual([]);
    await editBtn(page).click();
    await expect.poll(() => sent(page)).toEqual([
      'photos:edit:{"name":"a.png","size":111,"taken":1793329200000}',
      `photos:save:begin:{"name":"a.png","mime":"image/png","size":${PNG.length}}`,
      'photos:save:part',
      'photos:save:end',
      'photos:edit:{"id":"77"}',
    ]);
    expect(state.edge.filter(a => a === 'media-url:download')).toHaveLength(1);
    await expect(viewer(page)).toHaveCount(0);
    expect(state.errors).toEqual([]);
  });

  test('사진 편집: 옛 앱(편집 모름)에는 [편집]이 없다', async ({ page }) => {
    const state = await fixture(page, { app: true, edit: false });
    await openPhotos(page, 412);
    await expect.poll(() => ids(page)).toEqual(['ph:1', 'O1']);
    await page.locator('#photosRoot [data-photos-id="ph:1"]').click();
    await expect(viewer(page)).toBeVisible();
    await expect(editBtn(page)).toBeHidden();
    expect(state.errors).toEqual([]);
  });
});
