import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S49-18 PHOTO-꾹누르기메뉴 · PHOTO-삼성공유 (요청함 11/03 23:59·11/04 00:01).
// - 폰 앱 412: 사진 크게 보기에서 사진을 꾹 누르면 Web2 작은 메뉴 하나가 뜨고, [사진 복사] = 앱 다리 out:clip(안드로이드 클립보드).
//   손가락이 움직이면 취소, 우클릭(contextmenu)은 기본 메뉴를 막고 같은 메뉴 하나.
// - 삼성 인터넷 흉내(앱 아님·navigator.share·누른 효력 흉내): 크게 보기가 뜨면 바이트를 미리 받아 [공유] 한 번에 바로 share() 호출,
//   받는 중에 눌러 효력이 끝났으면 share()를 부르지 않고 '한 번 더 눌러 주세요' 안내, 두 번째 누름은 바로 넘어감.
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
            const step = m === 'out:go' || m === 'out:clip' ? 'sent' : m.slice(4).split(':')[0];
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


const menu = page => page.locator('#shareMenu');
const press = async (page, locator, { hold = 700, move = 0 } = {}) => {
  const b = await locator.boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  if (move) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + move, y }] });
  await page.waitForTimeout(hold);
  return { cdp, end: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) };
};

test.describe('폰 앱 412 — 꾹 누르기 메뉴', () => {
  test.use({ viewport: { width: 412, height: 915 }, userAgent: ANDROID, hasTouch: true, isMobile: true });

  async function openO1(page) {
    const state = await fixture(page, { app: true });
    await openPhotos(page, 412);
    await expect.poll(() => ids(page)).toEqual(['ph:1', 'O1']);
    await page.locator('#photosRoot [data-photos-id="O1"]').click();
    await expect(viewer(page)).toBeVisible();
    await expect(viewer(page).locator('.diary-slide .diary-photo[data-state="shown"]').first()).toBeVisible();
    return state;
  }

  test('사진을 꾹 누르면 작은 메뉴 하나 → [사진 복사] = 앱 클립보드(out:clip), 공유 창은 안 뜸', async ({ page }) => {
    const state = await openO1(page);
    const p = await press(page, viewer(page).locator('.diary-viewer-stage'));
    await expect(menu(page)).toBeVisible();
    await expect(menu(page).getByRole('button')).toHaveText(['사진 복사', '일기에 넣기', '업데이트로 보내기', '받기', '다른 앱으로 공유…']);
    await p.end();
    await page.waitForTimeout(100);
    await expect(menu(page)).toBeVisible(); // 손가락을 뗄 때 따라오는 클릭이 메뉴를 닫지 않는다
    await menu(page).getByRole('button', { name: '사진 복사' }).click();
    await expect.poll(() => outSent(page)).toEqual(['out:start:{"count":1}', expect.stringMatching(/^out:begin:\{"name":"[^"]+","mime":"image\/png","size":\d+\}$/), 'out:part', 'out:end', 'out:clip']);
    await expect(viewer(page).locator('[data-diary-viewer-note]')).toContainText('복사했어요');
    expect(await outSent(page)).not.toContain('out:go');
    expect(state.errors).toEqual([]);
  });

  test('꾹 누르다 손가락이 움직이면 메뉴가 뜨지 않는다(넘기기·밀기와 겹치지 않음)', async ({ page }) => {
    const state = await openO1(page);
    const p = await press(page, viewer(page).locator('.diary-viewer-stage'), { move: 40 });
    await expect(menu(page)).toBeHidden();
    await p.end();
    expect(state.errors).toEqual([]);
  });

  test('우클릭(contextmenu): 기본 메뉴를 막고 같은 작은 메뉴 하나', async ({ page }) => {
    const state = await openO1(page);
    const prevented = await viewer(page).locator('.diary-slide .diary-photo').first().evaluate(el => {
      const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 300 });
      el.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(prevented).toBe(true);
    await expect(menu(page)).toBeVisible();
    await expect(page.locator('#shareMenu:visible')).toHaveCount(1);
    expect(state.errors).toEqual([]);
  });
});

test.describe('삼성 인터넷 흉내 412 — 공유 한 번에', () => {
  test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

  async function setup(page, { slow = 0 } = {}) {
    await page.addInitScript(() => {
      window.__act = true; window.__shares = [];
      Object.defineProperty(navigator, 'userActivation', { configurable: true, get: () => ({ get isActive() { return window.__act; } }) });
      navigator.canShare = () => true;
      navigator.share = async data => { window.__shares.push(data.files.length); };
    });
    const state = await fixture(page, { app: false });
    if (slow) await page.route(u => u.origin === CDN && u.pathname.includes('/large/'), async r => { await new Promise(ok => setTimeout(ok, slow)); await r.fallback(); });
    await openPhotos(page, 412);
    await expect.poll(() => ids(page)).toEqual(['O1']);
    return state;
  }
  const shares = page => page.evaluate(() => window.__shares.length);

  test('크게 보기가 뜨면 바이트를 미리 받아 두어 [공유] 한 번에 바로 share()', async ({ page }) => {
    const state = await setup(page);
    await page.locator('#photosRoot [data-photos-id="O1"]').click();
    await expect(viewer(page)).toBeVisible();
    await expect(viewer(page).locator('.diary-slide .diary-photo[data-state="shown"]').first()).toBeVisible();
    await page.waitForTimeout(300);
    await viewer(page).locator('[data-diary-share]').click(); await page.locator('#shareMenu').getByRole('button', { name: '다른 앱으로 공유…' }).click();
    await expect.poll(() => shares(page)).toBe(1);
    await expect(viewer(page).locator('[data-diary-viewer-note] [data-wait]')).toHaveCount(0);
    expect(state.errors).toEqual([]);
  });

  test('받는 중에 눌러 누른 효력이 끝났으면 share()를 부르지 않고 "한 번 더" 안내, 두 번째 누름은 바로 넘어감', async ({ page }) => {
    const state = await setup(page, { slow: 1500 });
    await page.locator('#photosRoot [data-photos-id="O1"]').click();
    await expect(viewer(page)).toBeVisible();
    await viewer(page).locator('[data-diary-share]').click(); await page.locator('#shareMenu').getByRole('button', { name: '다른 앱으로 공유…' }).click();
    await page.evaluate(() => { window.__act = false; }); // 기다리는 사이 효력이 끝남(삼성 인터넷)
    await expect(viewer(page).locator('[data-diary-viewer-note]')).toContainText('[공유]를 한 번 더 눌러 주세요', { timeout: 15000 });
    expect(await shares(page)).toBe(0);
    await page.evaluate(() => { window.__act = true; });
    await viewer(page).locator('[data-diary-share]').click(); await page.locator('#shareMenu').getByRole('button', { name: '다른 앱으로 공유…' }).click();
    await expect.poll(() => shares(page)).toBe(1);
    expect(state.errors).toEqual([]);
  });
});
