import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// PHOTO-폰앱공유(요청함 11/01 21:26): 폰 앱 사진 크게 보기 [공유] → 앱 다리(out:*) → 안드로이드 공유 창.
// - 폰 앱 412(앱 다리 흉내, 0.4.7): 폰 사진 [공유] → out:start·out:phone:<번호>·out:go(바이트를 읽지 않음), 원드라이브 사진 → out:begin·part·end·go.
// - 공유를 기다리는 회색 칸(알림 줄)을 눌러도 [지우기]가 실행되지 않는다(목록·휴지통 요청 그대로).
// - 옛 앱(0.4.6, out 답 없음): 폰 사진 [공유] → 업데이트 안내 한 줄(회색 칸이 남지 않음).
// 네트워크 없음(지어낸 서버·지어낸 앱), 사진은 1×1 그림.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const CDN = 'https://od-thumb.example.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.4.7';
const KEY = 'PhoneKeyForTest_0123456789';
const OD = [
  { id: 'O1', name: 'a.png', day: '2026-10-30', taken_at: '2026-10-30T03:00:00.000Z', size_bytes: 111 },
].map(m => ({ ...m, approx: false, kind: 'photo', screenshot: false, duration_ms: null, uploaded_at: m.taken_at }));
const PHONE = [
  { id: '1', name: 'IMG_1.jpg', day: '2026-10-31', taken_at: '2026-10-31T03:00:00.000Z', size_bytes: 10 },
].map(m => ({ ...m, approx: false, kind: 'photo', width: 10, height: 10, duration_ms: null, screenshot: false, uploaded_at: m.taken_at }));

async function fixture(page, { app = false, edit = true, out = true } = {}) {
  const state = { errors: [], phoneReads: [], edge: [] };
  page.on('pageerror', e => state.errors.push(e.message));
  await page.addInitScript(() => { window.KPTUOdWarm = { run: () => null }; });
  if (app) {
    // 앱 다리 흉내: 상태(edit), 편집(번호 1·77은 바뀜, 원드라이브 사진은 폰에 없음), 받기(시작·조각·끝 → 번호 77).
    await page.addInitScript(({ key, edit, out }) => {
      const listeners = [];
      window.__photoSent = [];
      const say = data => setTimeout(() => listeners.forEach(fn => fn({ data })), 0);
      let got = 0;
      const prev = window.KPTUAppShell;
      window.KPTUAppShell = {
        postMessage(m) {
          m = String(m);
          window.__photoSent.push(m.startsWith('photos:save:part:') ? 'photos:save:part' : m.startsWith('out:part:') ? 'out:part' : m);
          if (m === 'photos:hello' || m === 'photos:ask') say(`photos:state:{"access":"full","key":"${key}","trash":true,"hide":true,"ops":true,"manage":false${edit ? ',"edit":true' : ''}}`);
          else if (m.startsWith('photos:edit:')) {
            const t = JSON.parse(m.slice('photos:edit:'.length));
            say(t.id ? 'photos:edited:{"ok":true,"changed":true,"error":""}' : 'photos:edited:{"ok":false,"changed":false,"error":"none"}');
          } else if (m.startsWith('photos:save:begin:')) { got = 0; say('photos:save:{"ok":true,"step":"begin","got":0,"error":""}'); }
          else if (m.startsWith('photos:save:part:')) { got += atob(m.slice('photos:save:part:'.length)).length; say(`photos:save:{"ok":true,"step":"part","got":${got},"error":""}`); }
          else if (m === 'photos:save:end') say(`photos:save:{"ok":true,"step":"end","got":${got},"id":"77","error":""}`);
          // PHOTO-폰앱공유(0.4.7): 공유 창 다리. out=false면 옛 앱(답 없음).
          else if (m.startsWith('out:') && out) {
            const step = m === 'out:go' ? 'sent' : m.slice(4).split(':')[0];
            if (step === 'hello') say('out:state:{"v":1}');
            else if (step === 'sent') say('out:sent:{"ok":true,"error":""}');
            else if (step !== 'cancel') say(`out:ack:{"ok":true,"step":"${step}","error":""}`);
          }
          prev?.postMessage?.(m);
        },
        addEventListener(type, fn) { if (type === 'message') listeners.push(fn); prev?.addEventListener?.(type, fn); },
      };
    }, { key: KEY, edit, out });
  }
  // PHOTO-기기별출처(S49-5): 폰 앱 기본은 폰 폴더만이므로, 원드라이브·폰 사진이 함께 보이는 목록을 쓰는 이 시험은 둘 다 켠 채 시작한다.
  await installViewPrefsServer(page, { photo_sources_phone: { onedrive: true, gdrive: false, phone: true } });
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
const outSent = page => page.evaluate(() => window.__photoSent.filter(m => m.startsWith('out:') && m !== 'out:hello'));
const trashSent = page => page.evaluate(() => window.__photoSent.filter(m => m.startsWith('photos:trash')));

test.describe('폰 앱 412', () => {
  test.use({ viewport: { width: 412, height: 915 }, userAgent: ANDROID, hasTouch: true, isMobile: true });

  test('폰 앱 공유: 폰 사진 [공유] → 안드로이드 공유 창(번호만, 바이트를 읽지 않음)', async ({ page }) => {
    const state = await fixture(page, { app: true });
    await openPhotos(page, 412);
    await expect.poll(() => ids(page)).toEqual(['ph:1', 'O1']);
    await page.locator('#photosRoot [data-photos-id="ph:1"]').click();
    await expect(viewer(page)).toBeVisible();
    const thumbs = state.phoneReads.length;
    await viewer(page).locator('[data-diary-share]').click();
    await expect.poll(() => outSent(page)).toEqual(['out:start:{"count":1}', 'out:phone:1', 'out:go']);
    await expect(viewer(page).locator('[data-diary-viewer-note] [data-wait]')).toHaveCount(0);
    expect(state.phoneReads.slice(thumbs).filter(p => p.includes('/thumb/') && p.includes('s=large'))).toEqual([]);
    expect(state.errors).toEqual([]);
  });

  test('폰 앱 공유: 원드라이브 사진 [공유] → 받은 그림을 조각으로 넘겨 공유 창', async ({ page }) => {
    const state = await fixture(page, { app: true });
    await openPhotos(page, 412);
    await expect.poll(() => ids(page)).toEqual(['ph:1', 'O1']);
    await page.locator('#photosRoot [data-photos-id="O1"]').click();
    await expect(viewer(page)).toBeVisible();
    await viewer(page).locator('[data-diary-share]').click();
    await expect.poll(() => outSent(page)).toEqual(['out:start:{"count":1}', expect.stringMatching(/^out:begin:\{"name":"[^"]+","mime":"image\/png","size":\d+\}$/), 'out:part', 'out:end', 'out:go']);
    expect(state.errors).toEqual([]);
  });

  test('알림 칸: 공유 기다림 회색 칸을 눌러도 아무 일 없다(지우기로 넘어가지 않음)', async ({ page }) => {
    const state = await fixture(page, { app: true, out: false });
    await openPhotos(page, 412);
    await expect.poll(() => ids(page)).toEqual(['ph:1', 'O1']);
    // 큰 그림을 늦게 주어 [공유]의 기다림 칸이 떠 있게 한다(작은 격자 칸은 이미 떴다).
    await page.route(u => u.pathname.includes('/__phone/') && u.search.includes('s=large'), async r => { await new Promise(ok => setTimeout(ok, 4000)); await r.fallback(); });
    await page.locator('#photosRoot [data-photos-id="ph:1"]').click();
    await expect(viewer(page)).toBeVisible();
    await viewer(page).locator('[data-diary-share]').click();
    const grey = viewer(page).locator('[data-diary-viewer-note] [data-wait]');
    await expect(grey).toHaveCount(1);
    const del = viewer(page).locator('[data-od-delete]');
    const g = await grey.boundingBox(), d = await del.boundingBox();
    // 회색 칸 아래 끝(버튼줄 쪽)과 회색 칸 한가운데를 누른다.
    await page.touchscreen.tap(g.x + g.width / 2, g.y + g.height - 1);
    await page.mouse.click(g.x + g.width / 2, g.y + g.height / 2);
    // 알림 줄 맨 아래(버튼줄 바로 위 1px)도 누른다.
    const n = await viewer(page).locator('[data-diary-viewer-note]').boundingBox();
    await page.mouse.click(d.x + d.width / 2, n.y + n.height - 1);
    await expect(viewer(page).locator('[data-diary-viewer-note]')).not.toContainText('휴지통으로 옮겼어요');
    await expect(viewer(page).locator('[data-diary-undo]')).toBeHidden();
    await expect(viewer(page).locator('[data-diary-viewer-count]')).toHaveText('1 / 2');
    expect(await trashSent(page)).toEqual([]);
    expect(state.errors).toEqual([]);
  });

  test('옛 앱(공유 창 길 없음): 폰 사진 [공유] → 업데이트 안내, 회색 칸이 남지 않음', async ({ page }) => {
    const state = await fixture(page, { app: true, out: false });
    await openPhotos(page, 412);
    await expect.poll(() => ids(page)).toEqual(['ph:1', 'O1']);
    await page.locator('#photosRoot [data-photos-id="ph:1"]').click();
    await expect(viewer(page)).toBeVisible();
    await viewer(page).locator('[data-diary-share]').click();
    await expect(viewer(page).locator('[data-diary-viewer-note]')).toContainText('앱을 새 판으로 업데이트해 주세요');
    await expect(viewer(page).locator('[data-diary-viewer-note] [data-wait]')).toHaveCount(0);
    expect(await outSent(page)).toEqual([]);
    expect(state.errors).toEqual([]);
  });
});
