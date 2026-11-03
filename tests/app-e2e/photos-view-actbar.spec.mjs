import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S49-23 PHOTO-크게보기메뉴통일 (요청함 11/04 07:36): 사진 크게 보기 아래 줄 = 사진 고르기 아래 줄과 같은 부품·같은 목록.
// 폰 412·폴드 884·PC 1440에서 (1) 크게 보기 줄 항목이 고르기 줄과 같고(크게 보기에만 [정보]), (2) 버튼이 지금 사진 1장에 동작한다.
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
  const state = { errors: [], phoneReads: [], edge: [], moves: [] };
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
      if (body.action === 'folders-tree') return r.fulfill({ json: { top: { id: 'TOP', name: '카메라', count: 1, total: 1 }, folders: [{ id: 'F1', name: '여행', parent_id: 'TOP', count: 0, total: 0 }], indexing: false, whole: true } });
      if (body.action === 'photos-move') { state.moves.push({ ids: body.ids, to: body.parent_id }); return r.fulfill({ json: { moved: body.ids.map(id => ({ id, from: 'TOP' })), failed: {} } }); }
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


const bar = page => page.locator('[data-diary-viewer] .diary-viewer-actions');
const barNames = page => bar(page).locator('button:visible .kptu-act-tx').allTextContents();
const SELECT_NAMES = ['별표', '공유', '받기', '일기', '업데이트', '옮기기', '앨범', '편집', '정보수정', '지우기'];

for (const [label, width, height] of [['폰 412', 412, 915], ['폴드 884', 884, 800], ['PC 1440', 1440, 900]]) {
  test.describe(`${label} — 크게 보기 아래 줄`, () => {
    test.use({ viewport: { width, height }, userAgent: ANDROID, hasTouch: width < 761, isMobile: width < 761 });

    test('크게 보기 줄 = 고르기 줄(같은 목록·이름·순서), 크게 보기에만 [정보]', async ({ page }) => {
      const state = await fixture(page, { app: true });
      await openPhotos(page, width);
      await expect.poll(() => ids(page)).toEqual(['ph:1', 'O1']);
      // 고르기 줄: 폰 사진 1장을 고른 줄
      await page.locator('#photosRoot [data-photos-id="ph:1"]').click({ delay: 700 }).catch(() => {});
      const sel = await page.evaluate(() => [...document.querySelectorAll('[data-photos-act] button:not([hidden]) .kptu-act-tx')].map(e => e.textContent));
      // 크게 보기
      await page.evaluate(() => { document.querySelector('[data-photos-sel-off]')?.click(); });
      await page.locator('#photosRoot [data-photos-id="ph:1"]').click();
      await expect(viewer(page)).toBeVisible();
      await expect(viewer(page).locator('.diary-slide .diary-photo[data-state="shown"]').first()).toBeVisible();
      const names = await barNames(page);
      expect(names).toEqual(SELECT_NAMES.slice(0, 7).concat(['편집', '정보수정', '정보', '지우기']).filter(n => names.includes(n)));
      for (const n of ['별표', '공유', '받기', '일기', '업데이트', '옮기기', '앨범', '지우기']) expect(names).toContain(n);
      if (sel.length) expect(names.filter(n => n !== '정보')).toEqual(sel);
      // 한 줄: 넘치면 옆으로 민다(줄 바꿈·잘림 없음)
      const fit = await bar(page).evaluate(el => ({ wrap: new Set([...el.querySelectorAll('button:not([hidden])')].map(b => Math.round(b.getBoundingClientRect().top))).size, over: el.scrollWidth > el.clientWidth, ox: getComputedStyle(el).overflowX }));
      if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/viewer-${width}.png` });
      expect(fit.wrap).toBe(1);
      if (fit.over) expect(fit.ox).toBe('auto');
      expect(state.errors).toEqual([]);
    });

    test('버튼이 지금 사진 1장에 동작: 별표·받기·업데이트·일기·정보수정·지우기', async ({ page }) => {
      const state = await fixture(page, { app: true });
      await openPhotos(page, width);
      await expect.poll(() => ids(page)).toEqual(['ph:1', 'O1']);
      await page.locator('#photosRoot [data-photos-id="O1"]').click();
      await expect(viewer(page)).toBeVisible();
      await expect(viewer(page).locator('.diary-slide .diary-photo[data-state="shown"]').first()).toBeVisible();
      // 별표
      await bar(page).locator('[data-diary-star]').click();
      await expect(bar(page).locator('[data-diary-star]')).toHaveAttribute('aria-pressed', 'true');
      // 정보 판 열기
      await bar(page).locator('[data-diary-info]').click();
      await expect(viewer(page).locator('[data-diary-viewer-info]')).toBeVisible();
      await bar(page).locator('[data-diary-info]').click();
      // 앨범: 작은 메뉴가 사진 위에 뜨고 Esc로 닫힌다
      await bar(page).locator('[data-strip-act="tag"]').click();
      await expect(page.locator('#photosPickMenu')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('#photosPickMenu')).toBeHidden();
      // 옮기기: 폴더 메뉴 → 폴더를 고르면 지금 보는 사진 1장(O1)만 그 폴더로
      await bar(page).locator('[data-strip-act="move"]').click();
      await expect(page.locator('#photosPickMenu')).toBeVisible();
      await page.locator('#photosPickMenu [data-pick-folder="F1"]').click();
      await expect.poll(() => state.moves).toEqual([{ ids: ['O1'], to: 'F1' }]);
      // 지우기: 다음 사진으로 넘어간다(2장 → 1장)
      await expect(viewer(page).locator('[data-diary-viewer-count]')).toHaveText(/\/ 2/);
      await bar(page).locator('[data-od-delete]').click();
      await expect(viewer(page).locator('[data-diary-viewer-count]')).toHaveText(/\/ 1/);
      expect(state.errors).toEqual([]);
    });
  });
}
